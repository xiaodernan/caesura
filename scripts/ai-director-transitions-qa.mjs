/**
 * scripts/ai-director-transitions-qa.mjs — KI-624 AI 导演第二阶段「流转 QA」
 *
 * 把 KI-620 产出的 4 条「世界状态流转提案」再喂回 LLM，做 **canon 一致性裁决**：
 *   - 提案里的 from→to / flag / 叙事后果是否与现有 canon（44 KB canon 证据 + 33 面对话旗标 + 7 条任务线）一致？
 *   - flag.proposed.* 是否会撞上已有旗标？
 *   - requiresHumanReview 的条目给出裁决：canon（可采纳）/ new-canon（新设定，需人审）/ conflict（与既定 canon 冲突，必须驳回）。
 *
 * 完全走 StateGraph（scripts/lib/stategraph.mjs）＋world-rag 检索（scripts/lib/world-rag.mjs），
 * 输出写双拷贝产物（src/data/authoring + admin）＋ docs/ai-director/TRANSITIONS-QA-<date>.md 人读证据。
 *
 * 纪律（不可绕过）：
 *   - 玩家进程零 LLM；产物 runtime:false / authorOnly:true；密钥只走 env，绝不落盘。
 *   - 本脚本只做 QA 裁决，不写 quests.json / dialogue.json / atlas-texts.ts——采纳与否由人工闸决定。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, applyAuthorProxyFromEnv } from './caesura-llm-client.mjs'
import { buildWorldCorpus, buildIndex, retrieve } from './lib/world-rag.mjs'
import { StateGraph } from './lib/stategraph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const args = process.argv.slice(2)
const MODE = args.includes('--live') ? 'live' : 'offline'
const TODAY = new Date().toISOString().slice(0, 10)
const NOW_ISO = new Date().toISOString()

/* ═══════════ 节点 ═══════════ */
async function nodeLoad(state) {
  const art = JSON.parse(readFileSync(resolve(ROOT, 'admin/ai-director-latest.json'), 'utf8'))
  const transitions = Array.isArray(art.transitions) ? art.transitions : []
  state.sourceGeneratedAt = art.generatedAt ?? null
  state.transitions = transitions
  // 旗标名册 + 任务线名册现读
  const dialogue = JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/dialogue.json'), 'utf8'))
  const flagRe = /flag\.[A-Za-z0-9_]+/g
  const flags = new Set()
  for (const tree of dialogue) {
    for (const node of tree.nodes ?? []) {
      if (node.condition) for (const m of String(node.condition).matchAll(flagRe)) flags.add(m[0])
      for (const c of node.choices ?? []) for (const m of JSON.stringify(c).matchAll(flagRe)) flags.add(m[0])
    }
  }
  state.roster = { dialogueFlags: [...flags].sort(), questLines: (JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/quests.json'), 'utf8')) ?? []).length }
}

async function nodeRetrieve(state) {
  const corpus = buildWorldCorpus(ROOT)
  const index = buildIndex(corpus)
  state.corpusSize = corpus.length
  state.ragPerTransition = state.transitions.map((t) => {
    const q = [t.fromZh, t.toZh, t.narrativeZh, t.flag].filter(Boolean).join(' ')
    return retrieve(index, q, 3).map((h) => h.chunk.slice(0, 220))
  })
}

const JUDGE_PREFIX = [
  '你是《止音纪元》的 canon gate judge。你的任务：对「状态流转提案」做裁决。',
  'canonFit 只许三种取值：',
  '- "canon"     —— 提案与检索到的 canon 片段一致（引用既有设定/地点/人物/法则），可采纳。',
  '- "new-canon" —— 不与既有 canon 冲突，但是**新引入**的设定，必须 requiresHumanReview:true，不得冒充既有 canon。',
  '- "conflict"  —— 与检索到的 canon 相矛盾（人物在错误的时间/地点、法则被推翻、flag 与既有旗标语义重叠或矛盾）。',
  '输出**严格的单个 JSON 对象**：{"verdicts":[{"flag":"...","canonFit":"canon|new-canon|conflict","conflicts":["≤40字"],"notesZh":"≤50字","notesEn":"≤30 words"}]}。',
  'verdicts 数组顺序必须与提案顺序一致，不要任何额外说明、不要代码块。',
].join('\n')

async function nodeJudge(state) {
  if (state.mode !== 'live') { state.verdicts = []; return }
  const env = authorLlmEnv()
  if (!env.apiKey) throw new Error('missing CAESURA_LLM_API_KEY（env 注入）')
  // 代理口径全走 caesura-llm-client（applyAuthorProxyFromEnv / curlSub2ApiFallback 自己会读 env）——
  // 这里不再直接触碰环境变量名册（KI-441 唯一入口纪律）
  await applyAuthorProxyFromEnv()
  const proposalText = state.transitions.map((t, i) => [
    `提案 ${i + 1} · ${t.flag}`,
    `from: ${t.fromZh}`,
    `to:   ${t.toZh}`,
    `叙事: ${t.narrativeZh}`,
    `canon 证据:`,
    ...state.ragPerTransition[i].map((c, j) => `${j + 1}. ${c}`),
  ].join('\n')).join('\n\n')
  const user = [
    `已有对话旗标名册（${state.roster.dialogueFlags.length} 面）：`,
    state.roster.dialogueFlags.join(' '),
    '',
    `任务线：${state.roster.questLines} 条`,
    '',
    proposalText,
    '',
    '请按 judge 规范裁决。',
  ].join('\n')
  const out = await callLlm({
    model: env.model, stream: true, stream_options: { include_usage: true },
    temperature: 0.3, max_tokens: 1300,
    messages: [{ role: 'system', content: JUDGE_PREFIX }, { role: 'user', content: user }],
  }, { baseUrl: env.baseUrl, apiKey: env.apiKey })
  state.usage.calls += 1
  state.usage.cachedTokens += out.cachedTokens || 0
  state.usage.statuses.push(out.status)
  const raw = String(out.text ?? '').replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim()
  const m = raw.match(/\{[\s\S]*\}/)
  let parsed = null
  try { parsed = JSON.parse(m ? m[0] : raw) } catch { /* keep null */ }
  if (!parsed?.verdicts) throw new Error(`judge: JSON 解析失败（head=${raw.slice(0, 120)}）`)
  state.verdicts = parsed.verdicts
}

function buildArtifacts(state) {
  return {
    $comment: 'KI-624 AI 导演第二阶段「流转 QA」产物 · 作者侧 · 不进玩家运行时 · 人工闸后方可采纳 · 绝不包含任何密钥',
    runtime: false,
    authorOnly: true,
    containsCredentials: false,
    requiresHumanReview: true,
    schema: 1,
    mode: state.mode,
    generatedAt: NOW_ISO,
    model: state.mode === 'live' ? authorLlmEnv().model : '(offline dry-run)',
    endpoint: state.mode === 'live' ? authorLlmEnv().baseUrl : '(offline)',
    source: state.sourceGeneratedAt ? `ai-director-latest.json @ ${state.sourceGeneratedAt}` : 'unknown',
    roster: { dialogueFlags: state.roster.dialogueFlags.length, questLines: state.roster.questLines },
    ragChunksPerTransition: 3,
    corpusSize: state.corpusSize ?? 0,
    transitionsRead: (state.transitions ?? []).length,
    verdicts: state.verdicts ?? [],
    usage: state.usage,
    graphCheckpoints: state.graphCheckpoints ?? [],
    errors: state.errors,
    humanGate: '人工审核通过前，任何提案一律不进 quests.json / dialogue.json / atlas-texts.ts',
  }
}

function writeArtifacts(state) {
  const art = buildArtifacts(state)
  const dirDocs = resolve(ROOT, 'docs/ai-director')
  mkdirSync(dirDocs, { recursive: true })
  const md = [
    `# AI 导演 · 流转 QA · TRANSITIONS-QA ${TODAY}${state.mode === 'offline' ? '（offline · 未触网）' : ''}`,
    '',
    `- mode: \`${state.mode}\` ｜ source: ${art.source} ｜ corpus: ${art.corpusSize} chunks`,
    `- LLM calls: ${art.usage.calls} ｜ cached_tokens: ${art.usage.cachedTokens} ｜ statuses: [${art.usage.statuses.join(',')}]`,
    `- 名册：dialogue flags ${art.roster.dialogueFlags} 面 · quest lines ${art.roster.questLines} 条`,
    '',
    '## 裁决（LLM canon gate judge · 顺序同提案）',
    '```json',
    JSON.stringify(art.verdicts, null, 2),
    '```',
    '',
    '## 图检查点',
    ...art.graphCheckpoints.map((c) => `- ${c.ok ? '✓' : '✗'} ${c.node} · ${c.ms}ms`),
    '',
    art.errors.length ? '## 错误（如实登记）\n' + art.errors.map((e) => `- [${e.node}] ${e.message}`).join('\n') : '## 错误\n- 无',
    '',
    '> 本报告由 `scripts/ai-director-transitions-qa.mjs` 机器生成；任何内容未经人工审核不进运行时数据。',
    '',
  ].join('\n')
  writeFileSync(resolve(dirDocs, `TRANSITIONS-QA-${TODAY}.md`), md, 'utf8')
  const body = JSON.stringify(art, null, 2) + '\n'
  writeFileSync(resolve(ROOT, 'src/data/authoring/ai-director-transitions-qa.json'), body, 'utf8')
  writeFileSync(resolve(ROOT, 'admin/ai-director-transitions-qa.json'), body, 'utf8')
}

/* ═══════════ 组图 ═══════════ */
async function main() {
  const state = {
    mode: MODE, errors: [], usage: { calls: 0, cachedTokens: 0, statuses: [] },
    transitions: [], roster: { dialogueFlags: [], questLines: 0 }, ragPerTransition: [], verdicts: [],
  }
  const graph = new StateGraph()
  graph
    .addNode('load', nodeLoad)
    .addNode('retrieve', nodeRetrieve)
    .addNode('judge', nodeJudge)
    .addNode('writeArtifacts', (s) => {
      s.graphCheckpoints = graph.checkpoints.map((c) => ({ ...c }))
      writeArtifacts(s)
    })
    .addEdge('load', 'retrieve')
    .addEdge('retrieve', 'judge')
    .addEdge('judge', 'writeArtifacts')
  await graph.run('load', state)
  state.graphCheckpoints = graph.checkpoints
  writeArtifacts(state)
  const failed = state.errors.length
  console.log(`[transitions-qa] mode=${state.mode} transitions=${state.transitions.length} verdicts=${(state.verdicts || []).length} cached=${state.usage.cachedTokens} errors=${failed}`)
  if (failed > 0) process.exit(2)
}

main().catch((e) => {
  console.error('[transitions-qa] FATAL', e)
  process.exit(1)
})
