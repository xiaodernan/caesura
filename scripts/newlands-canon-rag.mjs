/**
 * scripts/newlands-canon-rag.mjs — NEW-LANDS 候选台词的「canon 检索增强」对账（作者侧）
 *
 * 做法（零 embedding / 零第三方依赖）：
 *   1) 从 `src/data/json/dialogue.json` 取作者侧 corpus：每行对白 → 一个 chunk（含 speaker/emotion）
 *   2) 从 `src/data/json/npcs.json` + `docs/WORLD-BIBLE.md` + `docs/narrative.md` + `docs/lore/NEW-LANDS.md`
 *      各切出带标签的小节（按空行切块）
 *   3) deterministic BM25-ish 打分（字符二元组）对候选行打分取 top-K
 *   4) 把 K 块+候选行发给 LLM judge → 单行 JSON verdict：{"verdict":"ok|dup|conflict|unsupported","reason":"≤30字"}
 *   5) 把结论与所检索到的块写进 `docs/lore/NEW-LANDS-VOICES.md`（append），不碰 dialogue.json
 *
 * 运行方法：
 *   $env:CAESURA_LLM_API_KEY = 'sk-...'
 *   node .scratch/newlands-canon-rag.mjs (or npm run llm:cand-canon)
 *
 * 纪律：作者侧工具，不在 runtime；不改 dialogue.json；env 注入，不落 git。
 */
import { readFileSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, buildBibleMessages } from './caesura-llm-client.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AUTHOR = authorLlmEnv()
if (!AUTHOR.apiKey) { console.error('missing CAESURA_LLM_API_KEY'); process.exit(2) }

// ---------- 1. corpus ----------
const dialogue = JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/dialogue.json'), 'utf8'))
const npcs = JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/npcs.json'), 'utf8'))
const npcName = (id) => (npcs.find((n) => n.id === id) ?? {}).displayName || id

const dialogueChunks = []
for (const tree of dialogue) {
  for (const node of tree.nodes ?? []) {
    const speaker = tree.npc ? npcName(tree.npc) : (node.speaker ?? tree.id)
    const text = String(node.text ?? '').trim()
    if (!text) continue
    dialogueChunks.push(`[对白][${tree.id}/${speaker}] ${text}`)
  }
}

const mdChunks = (file, tag) => {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  return raw.split(/\n{2,}/).map((p, i) => `[${tag}][${file}#${i + 1}] ${p.replace(/\n/g, ' ').trim()}`).filter((p) => p.length > 40)
}
const worldChunks = mdChunks('docs/WORLD-BIBLE.md', '设定')
const narrativeChunks = mdChunks('docs/narrative.md', '叙事')
const newLandsChunks = mdChunks('docs/lore/NEW-LANDS.md', '设定')

const corpus = [...dialogueChunks, ...worldChunks, ...narrativeChunks, ...newLandsChunks]
console.log(`corpus chunks: ${corpus.length} (dialogue ${dialogueChunks.length}, world ${worldChunks.length}, narrative ${narrativeChunks.length}, newlands ${newLandsChunks.length})`)

// ---------- 2. retrieval (BM25-ish on char bigrams) ----------
const tok = (s) => {
  const t = String(s ?? '')
  const out = []
  for (let i = 0; i < t.length; i += 1) {
    if (i + 1 < t.length) out.push(t.slice(i, i + 2))
  }
  if (t.length < 2) out.push(t)
  return out
}
const docFreq = new Map()
const docToks = corpus.map((c) => { const t = tok(c); for (const x of new Set(t)) docFreq.set(x, (docFreq.get(x) || 0) + 1); return t })
const N = corpus.length
const idf = (x) => Math.log(1 + (N - (docFreq.get(x) || 0) + 0.5) / ((docFreq.get(x) || 0) + 0.5))
const score = (q, t) => { let s = 0; for (const x of q) s += idf(x) * (t.filter((y) => y === x).length / t.length); return s }

function retrieve(q, k) {
  const qry = tok(q)
  const scored = docToks.map((t, i) => ({ i, score: score(qry, t) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k)
  return scored.map((x) => corpus[x.i])
}

// ---------- 3. judge ----------
const JUDGE_SYSTEM = `你是《止音纪元》的 canon gate judge。你的任务：判断「候选行」是否与检索到的 canon 片段相符。

- 如果候选行复述已有 canon 清楚的事实（比如：风替世界敲钟、千门、霜锤、低音之城），且不违反写作守则 ⇒ verdict="ok"。
- 如果候选行只是在换一种说法复述某处 canon 已经存在的台词/句子 ⇒ verdict="dup"。
- 如果候选行引入 canon 没有的设定（新地点/新人物/新法则）或与既有 canon 相矛盾 ⇒ verdict="conflict"。
- 如果检索不到足够 canon 来支持这条候选（比如全是全新 Lore），但它不违反写作纪律 ⇒ verdict="unsupported"（不为反对它，只记账）。
- 写作纪律：禁复仇、禁新神、禁现代感叹词、禁半句抒情、禁动作括号。

输出严格单行 JSON：{"verdict":"ok|dup|conflict|unsupported","reason":"≤30字"}，不要任何额外说明、不要代码块。`

async function judge(npcId, candidate, k = 5) {
  const chunks = retrieve(`${candidate} ${npcId}`, k)
  const user = [
    '检索到的最相关 canon 片段（候选行未登记进去的）：',
    ...chunks.map((c, i) => `${i + 1}. ${c}`),
    '',
    `候选行（${npcId}）：${candidate}`,
    '',
    '请按 judge 规范输出单行 JSON。',
  ].join('\n')

  const out = await callLlm(buildBibleMessages({ npcMode: 'short', user: JUDGE_SYSTEM + '\n' + user, temperature: 0.1, maxTokens: 220 }))
  const raw = out.text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed = null
  try { const m = raw.match(/\{[^}]+\}/); parsed = JSON.parse(m ? m[0] : raw) } catch { /* keep null */ }
  return { parsed, raw, cachedTokens: out.cachedTokens ?? 0, dt: out.dt }
}

const CAND_LINES = [
  ['DLG_WIND', '风掠过空钟，替沉默留了一道缝'],
  ['DLG_WIND', '你的尾音落下，风便转了方向'],
  ['DLG_WIND', '风擦过门缝，钟声偏低了一拍'],
  ['DLG_RAIN', '雨浸透半页，名字便不肯回声'],
  ['DLG_RAIN', '墨迹沉进纸里，像钟底积着的旧音'],
  ['DLG_RAIN', '雨敲窗沿，字句逐个哑下去'],
  ['DLG_STONETHROAT', '我喉底压着一口旧钟声，它不肯出来也不肯沉下去'],
  ['DLG_STONETHROAT', '我吞下去的那声回响，至今还在喉底磨着'],
  ['DLG_STONETHROAT', '这块石头守着我的喉咙，连一声叹息也不肯放走'],
  ['DLG_GATEKEEPER', '门扇记得每次敲击，人却总忘了回声'],
  ['DLG_GATEKEEPER', '门不开时，里面那口钟也不作答'],
  ['DLG_GATEKEEPER', '沉默留在门后，钥匙从不替它开口'],
  ['DLG_FROSTWRIGHT', '冰封的钟面，指针还压着一声未尽'],
  ['DLG_FROSTWRIGHT', '锤落得慢些，霜下的回音才肯出来'],
  ['DLG_FROSTWRIGHT', '每道冰纹都咬住一拍，谁也催不动它'],
  ['DLG_OWNER', '旧钟记得我年幼时，每一声都敲得清楚'],
  ['DLG_OWNER', '它替我留住的回声，比年岁还轻'],
  ['DLG_OWNER', '钟摆停下那天，我才听见自己的沉默'],
  ['DLG_WIND', '风替你敲了两声，门里没人应'],
  ['DLG_RAIN', '雨落在纸上，个个签名都不识得'],
  ['DLG_STONETHROAT', '喉咙里那块结石是它自己长上来的'],
  ['DLG_GATEKEEPER', '门，各自记得一声叩响'],
  ['DLG_FROSTWRIGHT', '冰冻住的每一秒，都曾敲响过'],
  ['DLG_OWNER', '它替你敲过的每一下，都是真的'],
]

async function main() {
  const rows = []
  let cachedSum = 0
  for (const [npcId, line] of CAND_LINES) {
    const r = await judge(npcId, line, 5)
    cachedSum += r.cachedTokens
    const verdict = r.parsed?.verdict ?? 'parse-error'
    const reason = r.parsed?.reason ?? String(r.raw).slice(0, 80)
    rows.push({ npcId, line, verdict, reason, dtMs: r.dt })
    console.log(`[${verdict}] ${npcId} :: ${line} — ${reason}`)
  }

  const today = new Date().toISOString().slice(0, 10)
  const md = [
    '',
    `## Canon 检索增强对账（${today} · wkapi.pro/v1 · gpt-6-sol · temp=0.1 · stream+include_usage）`,
    '',
    '> 做法：BM25-ish（字符二元组）对 `docs/` + `src/data/json/*.json` 所拉检索池 top-5（dialogue → WORLD-BIBLE → narrative.md → NEW-LANDS），',
    '> 然后让 judge 对着检索块对照候选给 verdict。不改 dialogue.json。',
    '',
    '| NPC | 候选 | Verdict | Reason | dt_ms |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.npcId} | ${r.line} | ${r.verdict} | ${r.reason ?? ''} | ${r.dtMs} |`),
    '',
    `累计 cached_tokens = ${cachedSum} · 总调用 ${rows.length} 次 · 本节仅登记结论，不入 dialogue.json。`,
    '',
  ]
  const out = resolve(ROOT, 'docs/lore/NEW-LANDS-VOICES.md')
  appendFileSync(out, md.join('\n'), 'utf8')
  console.log('appended to', out)
  console.log('total cached_tokens across run:', cachedSum)
}

main().catch((e) => { console.error(e); process.exit(1) })
