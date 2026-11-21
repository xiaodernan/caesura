/**
 * scripts/stress-fanout.mjs — 全站扇出压力测试（KI-730 · 用户「海量用户/高并发/瞬间大数据量」指令）
 *
 * 与 stress-live 的区别：stress-live 打单一 URL 的 N 路并发；本脚本把**整本站点的全部故事页**
 * （从 public/read-progress.js 的 ORDER 现读，含最新落地篇）+ 关键静态页一次性扇出冲击：
 *   - 模拟「瞬间大数据量」：一轮内并发请求全部 85 篇 + 关键页（~90+ 独立 URL）；
 *   - 模拟「海量用户」：可叠加 --multiplier=N，把每个 URL 复制 N 份并发；
 *   - 逐资源判据：HTTP 200 + 非空 body；报告 min/mean/p50/p95/p99/max、总字节、失败率与 fail list。
 *
 * 诚实边界：这是只读 GET 冲击公开静态站（GitHub Pages CDN），不做写、不伪造真实访问、
 * 不声称通过了某个真实后端的鉴权；「高并发」= 本机并发 fetch，受本机带宽/代理限制，数字如实读取。
 *
 * 用法：
 *   node scripts/stress-fanout.mjs                          # 全站页 ×1 并发扇出
 *   node scripts/stress-fanout.mjs --multiplier=5           # 每页 5 份 = ~450 并发请求
 *   node scripts/stress-fanout.mjs --proxy=http://127.0.0.1:7897
 *
 * 退出码：0 = 全部 200 且非空；1 = 有失败；2 = 参数/网络/解析错误。
 */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ORIGIN = 'https://xiaodernan.github.io'

export function percentile(sorted, p) {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

/** 从 read-progress.js 现读全部 story slug（唯一真源，与 atlas no 一一对应） */
export function storyUrls() {
  const s = readFileSync(resolve(ROOT, 'public/read-progress.js'), 'utf8')
  const slugs = [...s.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1])
  // 首篇《盐》是 root（无 slug）
  const pages = ['/caesura/story/', ...slugs.map((slug) => `/caesura/story/${slug}/`)]
  // 关键静态页
  const key = ['/caesura/', '/caesura/story/anthology/', '/caesura/story/anthology/index.html',
    '/caesura/console/', '/caesura/admin/', '/caesura/codex/', '/caesura/tutorial/',
    '/caesura/cast/', '/caesura/site-latest.json']
  return [...new Set([...pages, ...key])]
}

function parseArgs(argv) {
  const args = { multiplier: 1, proxy: null, origin: ORIGIN }
  for (const a of argv) {
    const m = a.match(/^--([a-z]+)=(.+)$/)
    if (!m) continue
    const [, k, v] = m
    if (k === 'multiplier') args.multiplier = Math.max(1, Math.min(64, Number(v) || 1))
    else if (k === 'proxy') args.proxy = v
    else if (k === 'origin') args.origin = v
  }
  return args
}

async function fetchOne(url) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET', redirect: 'follow',
      headers: { 'user-agent': 'caesura-stress-fanout/1.0 (+readonly)', 'connection': 'close' },
      signal: AbortSignal.timeout(25_000),
    })
    const buf = await res.arrayBuffer()
    return { url, ok: res.status === 200 && buf.byteLength > 0, status: res.status, bytes: buf.byteLength, latencyMs: Date.now() - t0 }
  } catch (e) {
    return { url, ok: false, status: 0, bytes: 0, latencyMs: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.proxy) process.env.HTTPS_PROXY = args.proxy
  const urls = storyUrls()
  const targets = []
  for (let i = 0; i < args.multiplier; i++) for (const u of urls) targets.push(args.origin + u)
  console.log(`[stress-fanout] distinct=${urls.length} requests=${targets.length} multiplier=${args.multiplier} origin=${args.origin}`)

  const t0 = Date.now()
  const samples = await Promise.all(targets.map(fetchOne))
  const wallMs = Date.now() - t0
  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b)
  const mean = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
  const totalBytes = samples.reduce((a, s) => a + s.bytes, 0)
  const fails = samples.filter((s) => !s.ok)
  const report = {
    distinct: urls.length,
    requests: samples.length,
    wallMs,
    failures: fails.length,
    failureRate: samples.length ? fails.length / samples.length : 1,
    mean: Math.round(mean * 10) / 10,
    min: latencies[0] ?? 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies[latencies.length - 1] ?? 0,
    totalBytes,
    failSample: fails.slice(0, 5).map((s) => `${s.url} status=${s.status} ${s.error || ''}`),
  }
  console.log('[stress-fanout] ' + JSON.stringify(report, null, 2))
  process.exitCode = report.failures === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[stress-fanout] fatal:', (e && e.message) || e); process.exit(2) })
}
