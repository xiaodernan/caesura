/**
 * scripts/ai-world-dispatch.mjs — KI-629 AI 导演 ·「世界巡礼周报」
 *
 * 让 LLM 以「史官」的笔法写一份关于止音纪元**世界本身**的一周纪要——不是这个 repo 的变更日志，
 * 而是世界里的人会读到的那份公告：钟摆被收拾了多少次、账页空白还认领着没有、第四下响过几回。
 * 输入 = 现读的世界状态快照（KV / site-latest / 篇十七十八两篇 + 远端 canon 锚点）＋ canon 检索；
 * 输出 = 双语 JSON → docs/ai-director/WORLD-DISPATCH-<ISOweek>.md（人工闸，机器初稿）。
 *
 * 纪律：玩家进程零 LLM；产物不落任何运行时数据；密钥只走 env。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, applyAuthorProxyFromEnv } from './caesura-llm-client.mjs'
import { buildWorldCorpus, buildIndex, retrieve } from './lib/world-rag.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const args = process.argv.slice(2)
const MODE = args.includes('--live') ? 'live' : 'offline'
const TODAY = new Date().toISOString().slice(0, 10)
/* ISO week for the file name */
const isoWeek = (() => {
  const d = new Date()
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const weekNo = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
})()
const NOW_ISO = new Date().toISOString()

const kv = (() => {
  try {
    const raw = readFileSync(resolve(ROOT, 'site-latest.json'), 'utf8')
    return JSON.parse(raw).kv ?? {}
  } catch { return {} }
})()

const world = {
  KIrows: kv['KI.rows'] ?? '?',
  KIImplemented: kv['KI.Implemented'] ?? '?',
  SYSImplemented: kv['SYS.Implemented'] ?? '?',
  ARCHSections: kv['ARCH.sections'] ?? '?',
  date: TODAY,
}

async function main() {
  const corpus = buildWorldCorpus(ROOT)
  const index = buildIndex(corpus)
  const canon = retrieve(index, '钟摆渡人 未竟账页 第四下 余响 低音之城 老大师 恩希尔 拾钟人 灯匠', 6).map((h) => h.chunk.slice(0, 240))

  const prefix = [
    '你是《止音纪元》的「史官」（Chronicler）。你替这个世界写「世界巡礼周报」——不是工程变更记录，是世界里会读到的一份纪要。',
    '风格：平实、物件说话、留白、不抒情；不出现"AI / 模型 / 提交 / 分支 / KI"等工程词汇；世界的计数（钟摆、账页、第四下）只许来自【世界现状】，不许编造其他事件。',
    '输出严格的单个 JSON 对象：{"titleZh":"≤14字","titleEn":"≤8 words","zh":"≤220字纪要","en":"≤140 words","signZh":"≤12字落款","signEn":"≤6 words"}。不要任何额外说明、不要代码块。',
  ].join('\n')
  const user = [
    '【世界现状】',
    `KI 账目记了 ${world.KIrows} 条（其中 ${world.KIImplemented} 件落成）；系统 ${world.SYSImplemented}；档案章 ${world.ARCHSections}；date: ${world.date}。`,
    '上周刚落成的事：第十七篇《未竟账页》被认领（末行空白不再无人对视）；第十八篇《第四下》开篇——世界的钟只响三下，第四下不需要钟，它一直都在你心里。',
    '【canon 锚点】',
    ...canon.map((c, i) => `${i + 1}. ${c}`),
    '',
    '写这周的世界巡礼。',
  ].join('\n')

  if (MODE !== 'live') { console.log('[dispatch] offline — 不触网；这就是全部内容（用 --live 真跑）。'); process.exit(0) }
  const env = authorLlmEnv()
  if (!env.apiKey) { console.error('missing CAESURA_LLM_API_KEY'); process.exit(2) }
  // 代理口径全走 caesura-llm-client（applyAuthorProxyFromEnv 自己会读 env）——
  // 这里不再直接触碰环境变量名册（KI-441 唯一入口纪律）
  await applyAuthorProxyFromEnv()
  const out = await callLlm({
    model: env.model, stream: true, stream_options: { include_usage: true },
    temperature: 0.85, max_tokens: 800,
    messages: [{ role: 'system', content: prefix }, { role: 'user', content: user }],
  }, { baseUrl: env.baseUrl, apiKey: env.apiKey })
  const raw = String(out.text ?? '').replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim()
  const m = raw.match(/\{[\s\S]*\}/)
  let parsed = null
  try { parsed = JSON.parse(m ? m[0] : raw) } catch { /* keep null */ }
  if (!parsed?.zh) throw new Error(`dispatch: JSON 解析失败（head=${raw.slice(0, 120)}）`)

  const dir = resolve(ROOT, 'docs/ai-director')
  mkdirSync(dir, { recursive: true })
  const md = [
    `# 世界巡礼 · 第 ${isoWeek} 周`,
    '',
    `> 机器初稿 · AI 导演生成（${env.model} · ${NOW_ISO.slice(0, 10)}）· 人工闸后登账 · 不进玩家运行时`,
    `> 依据：世界快照现读（KI ${world.KIImplemented}/${world.KIrows} · SYS ${world.SYSImplemented} · ARCH ${world.ARCHSections}）＋ canon RAG top-${canon.length}`,
    '',
    '## ' + (parsed.titleZh ?? '世界巡礼'),
    '',
    parsed.zh,
    '',
    parsed.signZh ? `—— ${parsed.signZh}` : '',
    '',
    '## ' + (parsed.titleEn ?? 'The World Dispatch'),
    '',
    parsed.en,
    '',
    parsed.signEn ? `— ${parsed.signEn}` : '',
    '',
    `statuses: [${out.status}] · cached_tokens: ${out.cachedTokens ?? 0} · corpus: ${corpus.length} chunks`,
    '',
  ].join('\n')
  const target = resolve(dir, `WORLD-DISPATCH-${isoWeek}.md`)
  writeFileSync(target, md, 'utf8')
  console.log('[dispatch] written', target, '· status', out.status, '· cached', out.cachedTokens ?? 0)
}

main().catch((e) => { console.error('[dispatch] FATAL', e); process.exit(1) })
