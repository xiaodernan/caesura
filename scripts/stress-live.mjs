#!/usr/bin/env node
/**
 * 止音纪元 · stress-live（KI-660 · 用户「压力测试」指令落地）
 *
 * 冲击公开站：N 路并发 × R 轮，逐资源判据：HTTP 200 + 非空 body；报告 wall 时间、
 * min/mean/p50/p95/p99/max、总字节与道歉式失败率。零依赖、纯 fetch、只读。
 *
 * 用法：
 *   node scripts/stress-live.mjs                       # 默认打 https://xiaodernan.github.io/caesura/ 32 路 × 3 轮
 *   node scripts/stress-live.mjs --target=/caesura/changelog.html --concurrency=64 --rounds=2
 *   node scripts/stress-live.mjs --target=<url> --proxy=http://127.0.0.1:7897
 *
 * 退出码：0 = 全部 200 且非空；1 = 有失败（失败率>0 即非零）；2 = 参数/网络错误。
 * 纪律：只读 · 不出模块 · 不碰本机系统（纯 fetch）；gen 里任何人类可读数都可被归因复核。
 */
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const ORIGIN = 'https://xiaodernan.github.io'

function parseArgs(argv) {
  const args = { target: '/caesura/', concurrency: 32, rounds: 3, proxy: null }
  for (const a of argv) {
    const m = a.match(/^--([a-z]+)=(.+)$/)
    if (!m) continue
    const [, k, v] = m
    if (k === 'concurrency' || k === 'rounds') args[k] = Math.max(1, Math.min(512, Number(v) || 32))
    else if (k === 'target') args.target = v
    else if (k === 'proxy') args.proxy = v
  }
  return args
}

export function percentile(sorted, p) {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

export function buildReport(rounds) {
  const samples = []
  let failures = 0
  let totalBytes = 0
  for (const r of rounds) {
    for (const s of r.samples) {
      samples.push(s.latencyMs)
      totalBytes += s.bytes
      if (!s.ok) failures += 1
    }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0
  return {
    total: samples.length,
    failures,
    failureRate: samples.length ? failures / samples.length : 1,
    mean: Math.round(mean * 10) / 10,
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    totalBytes,
  }
}

async function fetchOne(url, proxy) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'caesura-stress-live/1.0 (+readonly)', 'connection': 'close' },
      signal: AbortSignal.timeout(20_000),
    })
    const buf = await res.arrayBuffer()
    const latencyMs = Date.now() - t0
    return { ok: res.status === 200 && buf.byteLength > 0, status: res.status, bytes: buf.byteLength, latencyMs }
  } catch (e) {
    return { ok: false, status: 0, bytes: 0, latencyMs: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.proxy) process.env.HTTPS_PROXY = args.proxy
  const url = args.target.startsWith('http') ? args.target : ORIGIN + args.target
  console.log(`[stress-live] target=${url} concurrency=${args.concurrency} rounds=${args.rounds}`)
  const rounds = []
  let anyFatal = false
  for (let r = 1; r <= args.rounds; r++) {
    const t0 = Date.now()
    const samples = await Promise.all(Array.from({ length: args.concurrency }, () => fetchOne(url, args.proxy)))
    const wallMs = Date.now() - t0
    rounds.push({ wallMs, samples })
    const ok = samples.filter((s) => s.ok).length
    const worst = samples.reduce((a, b) => (b.latencyMs > a.latencyMs ? b : a))
    console.log(`[round ${r}] wall=${wallMs}ms ok=${ok}/${samples.length} slowest=${worst.latencyMs}ms p50=${percentile([...samples.map((s) => s.latencyMs)].sort((a, b) => a - b), 50)}ms`)
    if (ok !== samples.length) anyFatal = true
  }
  const report = buildReport(rounds)
  console.log('[stress-live] total=%d failures=%d failureRate=%s mean=%sms min=%sms p50=%sms p95=%sms p99=%sms max=%sms bytes=%d',
    report.total, report.failures, report.failureRate.toFixed(4), report.mean, report.min, report.p50, report.p95, report.p99, report.max, report.totalBytes)
  /* 让进程自然排空（connection: close 已断 keep-alive），只标记退出码，不硬 exit——
     Windows 上硬 exit 会撞 undici 的 closing-handle 断言（UV_HANDLE_CLOSING） */
  process.exitCode = report.failures === 0 ? 0 : 1
}

/* 只在作为入口脚本时运行——单元测试 import 不该真开冲击 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[stress-live] fatal:', (e && e.message) || e); process.exit(2) })
}
