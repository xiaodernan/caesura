/**
 * scripts/spring-family-e2e-check.mjs —— Spring Cloud 家族端到端验收器（KI-454 固化版）。
 *
 * <p>它只干一件事：**一次命令把整族从起到问答都量一遍**——按次序起六件 jar →
 * 等每件各自的健康端点 → 打几条真实的探针（registry/gate 名册/gateway 路由/report 汇总）→
 * 汇总成判决 → 收尾停掉自己起的子进程（除非 `--keep-running`）。
 * 不做判定：探针拿回来的原文交给调用方，判决口径住在下面的 `PROBES` 表里，改判据就是改那张表。
 *
 * 用法：
 *   node scripts/spring-family-e2e-check.mjs                 完整起六件、等六件、探四条、停六件
 *   node scripts/spring-family-e2e-check.mjs --keep-running   验完不停（留活给人看/继续用）
 *   node scripts/spring-family-e2e-check.mjs --timeout=180    每件健康等候上限秒数（默认 120）
 *   node scripts/spring-family-e2e-check.mjs --run-gate=<id>  健康后额外经网关跑一道门（如 gate-data，约 1s）
 *
 * 配置目录由各服务 application.yml 缺省值决定（`file:./config`＝进程工作目录 services/spring/config 那一份）。
 *
 * 退出码：0 = 全部探针 OK；1 = 至少一条探针红（服务没起/名册空/路由丢）；2 = 前提不满足
 *   （找不到 java／jar 没构建／端口占用）—— 前提不满足不算服务红，是环境不满足。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

/** 仓库根（脚本住在 `<root>/scripts/` 下，两层上去就是 root；中文路径要 decode，用 fileURLToPath） */
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 六件的启动次序：registry → config → gate → report → client → gateway */
export const START_ORDER = [
  'caesura-registry',
  'caesura-config',
  'caesura-gate',
  'caesura-report',
  'caesura-client',
  'caesura-gateway',
]

/** 各服务的 jar 相对路径（target/ 不入库；构建状态由前置检查负责） */
export const JAR_PATHS = new Map([
  ['caesura-registry', 'services/spring/caesura-registry/target/caesura-registry-0.1.0.jar'],
  ['caesura-config', 'services/spring/caesura-config/target/caesura-config-0.1.0.jar'],
  ['caesura-gate', 'services/spring/caesura-gate/target/caesura-gate-0.1.0.jar'],
  ['caesura-report', 'services/spring/caesura-report/target/caesura-report-0.1.0.jar'],
  ['caesura-client', 'services/spring/caesura-client/target/caesura-client-0.1.0.jar'],
  ['caesura-gateway', 'services/spring/caesura-gateway/target/caesura-gateway-0.1.0.jar'],
])

/** 端口（唯一出处：docker-compose.yml / 各 application.yml） */
export const SERVICE_PORTS = new Map([
  ['caesura-registry', 8761],
  ['caesura-config', 8888],
  ['caesura-gate', 8081],
  ['caesura-report', 8082],
  ['caesura-client', 8083],
  ['caesura-gateway', 8099],
])

/** 等待健康那段用的 URL（各服务 context-path 下的 actuator，registry 没有"健康"只有 apps 名册） */
export const HEALTH_URLS = new Map([
  ['caesura-registry', 'http://127.0.0.1:8761/eureka/apps'],
  ['caesura-config', 'http://127.0.0.1:8888/actuator/health'],
  ['caesura-gate', 'http://127.0.0.1:8081/gate/actuator/health'],
  ['caesura-report', 'http://127.0.0.1:8082/report/actuator/health'],
  ['caesura-client', 'http://127.0.0.1:8083/actuator/health'],
  ['caesura-gateway', 'http://127.0.0.1:8099/actuator/health'],
])

/** gate/report 真正依赖的那一份配置（config server 以 native 后端供 `caesura-gates`）：
 *  健康 200 不等于它能供出这一份——两个都在等块里才起 gate/report/client/gateway。 */
export const CONFIG_ROSTER_URL = 'http://127.0.0.1:8888/caesura-gates/default'

/** 探针表：每条给出名、URL、期望（matcher 返回 true = 这一格算过）；`retries` 可选——经网关的探针
 *  要等 gateway 拉完注册表才真正可达，给它一段窗口（默认 1 次；网关类给 15 次×2s = 30s） */
export const PROBES = [
  { name: 'registry 名册可读', url: 'http://127.0.0.1:8761/eureka/apps', expect: 'contains-CAESURA-GATE', retries: 15 },
  {
    name: 'gate 名册（经网关路由）',
    url: 'http://127.0.0.1:8099/gate/gates',
    expect: { jsonPath: ['count'], equals: 5 },
    retries: 15,
  },
  {
    name: 'report 汇总（经网关路由）',
    url: 'http://127.0.0.1:8099/report/roster',
    expect: { jsonPath: ['count'], equals: 5 },
    retries: 15,
  },
  {
    name: 'client 健康',
    url: 'http://127.0.0.1:8083/actuator/health',
    expect: { jsonPath: ['status'], equals: 'UP' },
    retries: 1,
  },
]

/** 一条探针的判读（纯函数，可测） */
export function probeMatches(body, expect) {
  if (expect === 'contains-CAESURA-GATE') {
    return typeof body === 'string' && body.includes('CAESURA-GATE')
  }
  if (expect && Array.isArray(expect.jsonPath)) {
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body
      let cur = parsed
      for (const key of expect.jsonPath) {
        if (cur == null || typeof cur !== 'object') return false
        cur = cur[key]
      }
      return expect.equals === undefined ? cur !== undefined : cur === expect.equals
    } catch {
      return false
    }
  }
  return false
}

/** 把「前提全对不对」判成一串问题（纯函数，可测） */
export function preconditionFindings({ javaOk, jars, portsBusy }) {
  const out = []
  if (!javaOk) out.push('找不到 java（PATH 上没有 java.exe）——这一族起不来')
  for (const svc of START_ORDER) {
    if (!jars[svc]) out.push(`${svc} 的 jar 没构建：${JAR_PATHS.get(svc)}（先 mvn -DskipTests package）`)
  }
  for (const name of portsBusy) {
    out.push(`端口 ${SERVICE_PORTS.get(name)} 被 ${name} 的进程占用——先确认不是本族的残留（共享机器上别乱杀）`)
  }
  return out
}

/** TCP 端口探测（connect 成功=忙） */
export function portBusyViaConnect(timeoutMs = 400) {
  const results = []
  return new Promise((resolve) => {
    let pending = SERVICE_PORTS.size
    if (pending === 0) return resolve(results)
    for (const [name, port] of SERVICE_PORTS) {
      const socket = new net.Socket()
      socket.setTimeout(timeoutMs)
      socket.on('connect', () => {
        results.push(name)
        socket.destroy()
        if (--pending === 0) resolve(results)
      })
      socket.on('timeout', () => {
        socket.destroy()
        if (--pending === 0) resolve(results)
      })
      socket.on('error', () => {
        if (--pending === 0) resolve(results)
      })
      socket.connect(port, '127.0.0.1')
    }
  })
}

/** 拉 jar 启动（背后是 java -jar；stdout/stderr 丢 /dev/null 或到指定 log 路径） */
function spawnJar(jarPath, logPath) {
  const out = openSync(logPath, 'w')
  const err = openSync(logPath + '.err', 'w')
  const child = spawn('java', ['-jar', jarPath], {
    cwd: join(ROOT, 'services/spring'),
    detached: false,
    windowsHide: true,
    stdio: ['ignore', out, err],
    env: { ...process.env },
  })
  return child
}

/** 轮询某个 URL 直到 200 或超时（ms） */
async function waitHttp(url, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return { ok: true, status: res.status }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return { ok: false, status: null, error: String(lastErr) }
}

/** 一条探针的执行（纯调度；fetch 在这里；retries 是给 LB 层一段拉实例表的窗口） */
async function runProbe(probe) {
  const retries = probe.retries ?? 1
  let last = { name: probe.name, ok: false, status: null }
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(probe.url, { signal: AbortSignal.timeout(15000) })
      const body = await res.text()
      last = { name: probe.name, ok: probeMatches(body, probe.expect), status: res.status }
      if (last.ok) return last
    } catch (e) {
      last = { name: probe.name, ok: false, status: null, error: e.message }
    }
    if (i < retries - 1) {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  return last
}

/** 起一组 jar，返回 children 句柄 */
function spawnPhase(services, logDir) {
  const children = []
  for (const svc of services) {
    const jar = join(ROOT, JAR_PATHS.get(svc))
    console.log(`[e2e-check] 起 ${svc} …`)
    children.push({ svc, child: spawnJar(jar, join(logDir, svc + '.log')) })
  }
  return children
}

/** 主体 */
async function main() {
  const args = process.argv.slice(2)
  const keep = args.includes('--keep-running')
  const timeoutArg = args.find((a) => a.startsWith('--timeout='))
  const timeoutSec = timeoutArg ? Number(timeoutArg.slice('--timeout='.length)) : 120
  const runGate = args.find((a) => a.startsWith('--run-gate='))?.slice('--run-gate='.length)

  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    console.error('用法：--timeout=<秒> 必须是正数')
    process.exit(2)
  }

  // ── 前提检查 ─────────────────────────────────────────────────────
  const javaOk = (() => {
    try {
      const r = spawnSync('java', ['-version'], { stdio: 'ignore' })
      return r.status === 0
    } catch { return false }
  })()

  const jars = {}
  for (const svc of START_ORDER) {
    jars[svc] = existsSync(join(ROOT, JAR_PATHS.get(svc)))
  }

  const busy = await portBusyViaConnect().catch(() => [])
  const findings = preconditionFindings({ javaOk, jars, portsBusy: busy })
  if (findings.length > 0) {
    console.error('[e2e-check] 前提不满足：')
    for (const f of findings) console.error(`  - ${f}`)
    // 端口忙但不是本族的话，不替你杀——只列出来
    process.exit(2)
  }

  // ── 起（分三段：registry → config → 其余四件；gate/report/client/gateway 启动即 fail-fast 拉配置，必须等 config 能供出名册）──
  const logDir = join(ROOT, '.scratch', 'e2e-check')
  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    // .scratch 建不起来（例如权限）就写当前工作目录——反正只作临时日志，不入库
  }

  const children = []
  const timeoutMs = timeoutSec * 1000
  const fail = (msg) => {
    console.error(`[e2e-check] ${msg}`)
    for (const item of children.splice(0)) {
      try { item.child.kill('SIGKILL') } catch {}
    }
    process.exit(1)
  }

  // 阶段 1：registry
  children.push(...spawnPhase(['caesura-registry'], logDir))
  {
    const r = await waitHttp(HEALTH_URLS.get('caesura-registry'), timeoutMs, 1000)
    if (!r.ok) fail(`caesura-registry 健康等候超时（${timeoutSec}s）：${r.error ?? `HTTP ${r.status}`}`)
    console.log('[e2e-check] caesura-registry 起来了（:8761）')
  }

  // 阶段 2：config（先健康，再确认它真能供出 caesura-gates 名册——gate 起不来的多半死在这一格）
  children.push(...spawnPhase(['caesura-config'], logDir))
  {
    const r = await waitHttp(HEALTH_URLS.get('caesura-config'), timeoutMs, 1000)
    if (!r.ok) fail(`caesura-config 健康等候超时（${timeoutSec}s）：${r.error ?? `HTTP ${r.status}`}`)
    console.log('[e2e-check] caesura-config 健康了，等它供出名册…')
    const ro = await waitHttp(CONFIG_ROSTER_URL, timeoutMs, 1000)
    if (!ro.ok) fail(`caesura-config 起来了但名册取不回来：${ro.error ?? `HTTP ${ro.status}`}（gate 会 fail-fast，别起）`)
    console.log('[e2e-check] caesura-config 名册已就位（:8888）')
  }

  // 阶段 3：gate / report / client / gateway
  children.push(...spawnPhase(['caesura-gate', 'caesura-report', 'caesura-client', 'caesura-gateway'], logDir))
  for (const svc of ['caesura-gate', 'caesura-report', 'caesura-client', 'caesura-gateway']) {
    const r = await waitHttp(HEALTH_URLS.get(svc), timeoutMs, 1000)
    if (!r.ok) fail(`${svc} 健康等候超时（${timeoutSec}s）：${r.error ?? `HTTP ${r.status}`}（日志：.scratch/e2e-check/${svc}.log）`)
    console.log(`[e2e-check] ${svc} 起来了（:${SERVICE_PORTS.get(svc)}）`)
  }

  // ── 探 ───────────────────────────────────────────────────────────
  let allOk = true
  for (const probe of PROBES) {
    const r = await runProbe(probe)
    const mark = r.ok ? 'pass' : 'FAIL'
    console.log(`[e2e-check] 探针 ${mark} — ${probe.name}（:${r.status ?? '-'}）`)
    if (!r.ok) allOk = false
  }

  // ── 可选：经网关跑一道真门 ────────────────────────────────────────
  if (runGate) {
    try {
      const res = await fetch(`http://127.0.0.1:8099/gate/gates/${encodeURIComponent(runGate)}/run`, {
        method: 'POST',
        signal: AbortSignal.timeout(300000),
      })
      const body = await res.text()
      const parsed = JSON.parse(body)
      const ok = parsed.verdict === 'green'
      console.log(`[e2e-check] 探针 ${ok ? 'pass' : 'FAIL'} — 经网关跑门 ${runGate}：verdict=${parsed.verdict} durationMs=${parsed.durationMs}`)
      if (!ok) allOk = false
    } catch (e) {
      console.error(`[e2e-check] 探针 FAIL — 经网关跑门 ${runGate}：${e.message}`)
      allOk = false
    }
  }

  // ── 收尾 ─────────────────────────────────────────────────────────
  if (keep) {
    console.log('[e2e-check] --keep-running：六件保持运行（手动停：Get-NetTCPConnection -State Listen | ? LocalPort in 8761,8888,8081,8082,8083,8099 | Stop-Process）')
  } else {
    for (const item of children.splice(0)) {
      try { item.child.kill() } catch {}
    }
    console.log('[e2e-check] 六件已停')
  }

  process.exit(allOk ? 0 : 1)
}

const isCliInvocation = !!process.argv[1] && existsSync(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

/** CLI 主体：被直接运行时走 main；被 import 时只交出函数。 */
if (isCliInvocation) {
  main().catch((e) => {
    console.error(`[e2e-check] 崩了：${e.message}`)
    process.exit(1)
  })
}
