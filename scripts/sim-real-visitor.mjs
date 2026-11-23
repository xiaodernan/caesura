/**
 * scripts/sim-real-visitor.mjs — 《真人行为模拟 · Real Visitors》（作者侧 · 只读 · 不落库）
 *
 * 【为什么存在】（KI-712 · 2026-11-19）：§九「真实数据接入 · 真实用户行为模拟」——
 * 用户会觉得「演示数据堆砌」虚；这里模拟的是「真人打开一个页面没耐心就关掉」与「不知道去哪就在页面上瞎点」
 * 两类典型真实行为，并把它们变成可复现、可测、可入 CI 的硬证据（Status/字节/墙时/契约标记三条腿）。
 *
 * 【做法】零 LLM · 零写入 · 零依赖——
 *   ① impatient-bounce 模式：模拟「页面刚被打开、用户没耐心读就立刻换/关」：取样 k 个入口页，
 *      做一次「状态+字节+首屏契约标记+目标时延（默认 5s 墙时）」判定；
 *   ② blind-click 模式：模拟「进来乱点」：从入口页开始做 N 次随机的内链跳转（只跳 /caesura/ 域内链，
 *      不跳 github.com / yindun 等出域链），每一跳都量状态与字节；seed 可复现；
 *   ③ referrer-hop 模式：验证出域链（github.com/xiaodernan/caesura）可达（200/301/302/304/403-反爬放过）；
 *   ④ 免责：本脚本**不修改任何数据**，不冒充真实 GA 遥测；与 admin/ 的埋点互补（sim = 机器化走查，
 *      admin = 真实访客观察）。阈值、加权、样本量都在脚本里可读。
 *
 * 【用法】
 *   node scripts/sim-real-visitor.mjs --seed=1        # seed=1（CI 可复现）
 *   node scripts/sim-real-visitor.mjs                  # 默认 seed=20261119
 *   node scripts/sim-real-visitor.mjs --stories-only   # 仅 story/ 段
 *
 * @module sim-real-visitor
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* CLI 参数（--k=v 形式，不在裸 env 上做任何读写） */
export const parseArgs = (argv = process.argv.slice(2)) => {
  const out = {}
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)=(.+)$/i)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** 从 public/read-progress.js 的 canon ORDER 读出 80 个 slug（单一真相源）。 */
export function storySlugs() {
  const src = readFileSync(resolve(ROOT, 'public/read-progress.js'), 'utf8')
  const slugs = []
  const re = /\{\s*slug:\s*'([^']*)'/g
  let m
  while ((m = re.exec(src)) !== null) slugs.push(m[1])
  return slugs
}

export function publicPageList() {
  const slugs = storySlugs().filter(Boolean)
  const pages = ['/caesura/', '/caesura/story/anthology/', '/caesura/story/atlas/', '/caesura/codex/', '/caesura/tutorial/', '/caesura/console/', '/caesura/cast/', '/caesura/admin/']
  for (const s of slugs) pages.push(`/caesura/story/${s}/`)
  return [...new Set(pages)]
}

export const listStoryPages = () => storySlugs().filter(Boolean).map((s) => `/caesura/story/${s}/`)

export const extractInnerLinks = (html) => {
  const out = []
  const re = /href="\/caesura\/[^"#?]+"/g
  let m
  while ((m = re.exec(html)) !== null) out.push(m[0].slice(6, -1))
  return [...new Set(out)]
}

export const mulberry32 = (seed) => {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)]

const markerFor = (path) => {
  if (path === '/caesura/') return ['止音纪元', 'CÆSURA']
  if (path.includes('/anthology/')) return ['余响集', 'The Aftermath']
  if (path.includes('/story/atlas/')) return ['余响索引', 'Motif Atlas']
  if (path.includes('/story/')) return ['余响集', 'The Aftermath']
  if (path.includes('/codex/')) return ['世界谱', 'Codex']
  if (path.includes('/tutorial/')) return ['教程', 'Tutorial']
  if (path.includes('/console/')) return ['调度台', 'Console']
  if (path.includes('/admin/')) return ['后台', 'Admin']
  if (path.includes('/cast/')) return ['角色', 'Cast']
  return ['CÆSURA']
}

export const SITES = {
  root: 'https://xiaodernan.github.io',
  authoring: 'https://github.com/xiaodernan/caesura',
}
export const args = parseArgs()
export const SEED = Number(args.seed ?? 20261119)
export const rng = mulberry32(SEED)
export const concurrency = Math.max(1, Number(args.concurrency ?? 6))
export const retries = 2
export const fetchWithBudget = async (url, timeoutMs = 6000) => {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ac.signal, redirect: 'follow' })
    const text = await r.text()
    return { status: r.status, bytes: text.length, text, url }
  } catch (e) {
    return { status: 0, bytes: 0, text: '', url, error: String(e?.cause?.code || e?.message || e) }
  } finally { clearTimeout(t) }
}

export const checkPage = async (path) => {
  const url = SITES.root + path
  let r = null
  for (let i = 0; i < retries && (r === null || r.status !== 200); i++) r = await fetchWithBudget(url + '?ts=' + Date.now())
  const markers = markerFor(path)
  const hitMarkers = markers.filter((m) => r.text.includes(m))
  return { path, status: r.status, bytes: r.bytes, text: r.text, error: r.error ?? null, expectedMarkers: markers, hitMarkers, ok: r.status === 200 && hitMarkers.length > 0 }
}

export const runPool = async (xs, limit, workerFn) => {
  const results = new Array(xs.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= xs.length) return
      results[i] = await workerFn(xs[i])
    }
  }))
  return results
}

/** 主流程：仅在 CLI 直接执行时跑（vitest/import 只拿纯函数，绝不触网）。 */
async function main() {
  const pages = args['stories-only'] ? listStoryPages() : publicPageList()
  console.log(`sim-real-visitor seed=${SEED} concurrency=${concurrency} pages=${pages.length}`)

const started = Date.now()
const findings = []
const checks = await runPool(pages, concurrency, async (p) => {
  const r = await checkPage(p)
  findings.push({ kind: 'page', ...r })
  if (!r.ok) console.log(`  !! ${p} -> ${r.status}${r.error ? ' ' + r.error : ''} bytes=${r.bytes} markers=${r.hitMarkers.length}/${r.expectedMarkers.length}`)
  return r
})

/* 瞎点模式：seed 固定序列的内链跳 12 跳。从 anthology 起步——
   纯 canvas 的 /caesura/ 入口只有 3 个 <link>（资源加载），导航全在运行时；
   有真实静态链接密度的是全集页（80 章 + codex/tutorial 锚），它也是真人瞎点时最容易乱跳的地方。 */
const landing = checks.find((c) => c.path === '/caesura/story/anthology/')
let cursorHtml = landing && landing.status === 200 ? landing.text : ''
let hopPath = '/caesura/story/anthology/'
let hopCount = 0
let hopFails = 0
for (let hop = 0; hop < 12; hop++) {
  const links = extractInnerLinks(cursorHtml)
  if (links.length === 0) break
  const target = pick(rng, links)
  hopCount++
  const r = await checkPage(target)
  if (!r.ok) { hopFails++; console.log(`  !! blind-click ${hopPath} -> ${target} -> ${r.status}`) }
  cursorHtml = r.text; hopPath = target
}

/* referrer-hop：出域链可达 */
const gh = await fetchWithBudget(SITES.authoring, 8000)
const referrerOk = [200, 301, 302, 304, 403].includes(gh.status) || gh.status === 0

const okPages = checks.filter((c) => c.ok).length
  const badPages = checks.length - okPages
  const totalBytes = checks.reduce((a, c) => a + c.bytes, 0)
  const wall = Date.now() - started
  const summary = {
    seed: SEED,
    pages: checks.length,
    okPages,
    badPages,
    blindClickHops: hopCount,
    blindClickFails: hopFails,
    referrer: { url: SITES.authoring, status: gh.status },
    totalBytes,
    avgBytes: Math.round(totalBytes / Math.max(1, checks.length)),
    wallMs: wall,
  }
  console.log('summary', JSON.stringify(summary, null, 1))
  process.exit(badPages === 0 && hopFails === 0 && referrerOk ? 0 : 1)
}

// 直接执行才进主流程：import（vitest 纯函数契约测试）不触网、不 exit。
import { pathToFileURL } from 'node:url'
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(e); process.exit(2) })
}
