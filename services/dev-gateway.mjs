#!/usr/bin/env node
/**
 * `services/dev-gateway.mjs` — 本地开发用的 Spring Cloud Gateway–shaped 网关。
 *
 * 这**不是**什么：不是 Spring Boot，不是 Eureka，不是生产后端，更不意味着这个单机游戏
 * 需要「微服务化」。游戏客户端自带渲染，没有任何生产流量要经过这一层。
 *
 * 它是什么：
 * 一个本地 HTTP 面，把「项目自己的工具与读数」聚合成统一的 `/api/*` 端点——对外部调用方而言，
 * 这就是 Spring Cloud Gateway（Simple routing）+ Spring Boot Actuator（health/details）+
 * Service Registry（这里以「路由名册」的形状出现）的**最小、诚实形状**，
 * 用在研胜或联机构建联机/遥测/排行榜管线时，这是叫得出名字的起点。
 *
 * 端点全是只读、全基于仓库里的真字节、无状态。谁注册了谁就能被找到——路由名册即 discovery。
 *
 * 运行：
 *   node services/dev-gateway.mjs                 # 127.0.0.1:8399（可用 CAESURA_GATEWAY_PORT 覆盖）
 *   curl -s http://127.0.0.1:8399/api/health     # 健康检查
 *   curl -s http://127.0.0.1:8399/api/registry   # 路由名册（discovery）
 *
 * 测试见 `tests/unit/dev-gateway.test.ts`（随 `npm run test` 一起跑）。
 */
import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize, resolve as pResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根：先算 ROOT，再定义 resolve()——反过来会 TDZ（ROOT 在自己初始化前被读到） */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function resolve(rel) {
  return join(ROOT, rel)
}

const PKG = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const FLOOR = JSON.parse(readFileSync(resolve('scripts/coverage-floor.json'), 'utf8'))
const CHANGELOG = readFileSync(resolve('docs/CHANGELOG.md'), 'utf8')

const monthCount = new Map()
for (const line of CHANGELOG.split('\n')) {
  const m = /^\| (\d{4}-\d{2}) \| (\d+) \|$/.exec(line.trim())
  if (m) monthCount.set(m[1], Number(m[2]))
}

const ROUTES = [
  { id: 'health', service: 'actuator/health', method: 'GET', path: '/api/health', note: '存活与环境摘要' },
  { id: 'status', service: 'actuator/phase-status', method: 'GET', path: '/api/status', note: 'KI/ARCH/PKG 的机读 rollup（复用 scripts/phase-status.mjs）' },
  { id: 'quality', service: 'configuration/quality', method: 'GET', path: '/api/quality', note: 'QUALITY_PROFILES 原始字节' },
  { id: 'coverage-floor', service: 'configuration/coverage-floor', method: 'GET', path: '/api/coverage-floor', note: 'scripts/coverage-floor.json 原样' },
  { id: 'metrics', service: 'telemetry/perf-probe', method: 'GET', path: '/api/metrics', note: 'artifacts/perf-probe-<date>.log 的最新一趟（KI-410 不入库）' },
  { id: 'changelog', service: 'registry/changelog', method: 'GET', path: '/api/changelog', note: '按月提交计数（来自 docs/CHANGELOG.md）' },
  { id: 'registry', service: 'registry/routes', method: 'GET', path: '/api/registry', note: '本网关所有路由（discovery 表）' },
]

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}
function notFound(res, path) {
  json(res, 404, { error: 'not_found', path, known: ROUTES.map((r) => `${r.method} ${r.path}`) })
}

/** 读取 logs_dir 最新一份 perf-probe 日志；没有就返回 null + 理由（绝不口头冒充量到了） */
function latestPerfProbe() {
  try {
    const logs = readdirSync(resolve('artifacts')).filter((f) => /^perf-probe-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort()
    const latest = logs.at(-1)
    if (!latest) return { latest: null, reason: 'artifacts/ 里没有任何 perf-probe 日志（跑一遍才有：node scripts/measure-probe.mjs）' }
    const text = readFileSync(resolve(`artifacts/${latest}`), 'utf8').trim().split('\n')
    const last = [...text].reverse().find((l) => l.trim().startsWith('{')) ?? null
    return { latest, content: last ? JSON.parse(last) : null, rawTail: text.slice(-1)[0] ?? null }
  } catch (err) {
    return { latest: null, reason: `artifacts/ 读不了（${String(err?.message ?? err)}）` }
  }
}

/** 对 /api/status：就地跑一下 phase-status（它快，且不需要网络） */
async function phaseStatus() {
  const { spawn } = await import('node:child_process')
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['scripts/phase-status.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      const parsed = Object.fromEntries(out.trim().split('\n').map((l) => l.split('=')).filter((p) => p.length === 2))
      resolvePromise({ exitCode: code, keys: parsed, raw: out.trim() })
    })
    child.on('error', (e) => resolvePromise({ exitCode: null, error: String(e) }))
  })
}

export function createGateway() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname

    if (req.method !== 'GET') return notFound(res, path)

    if (path === '/') {
      return json(res, 200, { service: 'caesura-dev-gateway', scope: 'local-dev', routes: ROUTES.map((r) => `${r.method} ${r.path}`) })
    }
    if (path === '/api/health') {
      return json(res, 200, { status: 'UP', scope: 'local-dev', version: PKG.version, node: process.version, uptimeSec: Math.round(process.uptime()), build: 'local-artifacts' })
    }
    if (path === '/api/status') {
      return json(res, 200, await phaseStatus())
    }
    if (path === '/api/quality') {
      const text = readFileSync(resolve('src/settings/Quality.ts'), 'utf8')
      const match = text.match(/QUALITY_PROFILES[^=]+= \(\(\) => \{([\s\S]*?)\}\)\(\)/)
      const leaf = match ? match[1].trim().replace(/\s+/g, ' ') : null
      return json(res, 200, { source: 'src/settings/Quality.ts', raw: leaf, parsed: null, note: 'consumer 侧请读 QUALITY_PROFILES（本端点只给字节的观察）' })
    }
    if (path === '/api/coverage-floor') return json(res, 200, FLOOR)
    if (path === '/api/metrics') return json(res, 200, latestPerfProbe())
    if (path === '/api/changelog') {
      const total = [...monthCount.values()].reduce((a, b) => a + b, 0)
      return json(res, 200, { source: 'docs/CHANGELOG.md', totalCommits: total, byMonth: Object.fromEntries([...monthCount].sort()) })
    }
    if (path === '/api/registry') return json(res, 200, { discovery: 'explicit-static-list', routes: ROUTES })
    return notFound(res, path)
  })
  return server
}

/** 启动一个绑定 port 0（随机）的网关——给测试用；返回句柄 */
export async function startGateway({ port = 0, host = '127.0.0.1' } = {}) {
  const server = createGateway()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolvePromise)
  })
  const addr = server.address()
  return {
    host,
    port: addr.port,
    url: `http://${host}:${addr.port}`,
    close: () => new Promise((r) => server.close(r)),
  }
}

const isMain = process.argv[1] && normalize(pResolve(process.argv[1])).toLowerCase() === normalize(fileURLToPath(import.meta.url)).toLowerCase()
if (isMain) {
  const port = Number(process.env.CAESURA_GATEWAY_PORT ?? 8399)
  const { url, close } = await startGateway({ port, host: '127.0.0.1' })
  console.log(`[dev-gateway] listening on ${url}`)
  for (const route of ROUTES) console.log(`  ${route.method} ${route.path}  — ${route.note}`)
  process.on('SIGINT', () => { console.log('\n[dev-gateway] bye'); close().then(() => process.exit(0)) })
}
