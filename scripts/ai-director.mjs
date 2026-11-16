/**
 * scripts/ai-director.mjs — 《止音纪元·AI 导演引擎》（工作名：The Director）
 *
 * 这是「大模型深度嵌进项目整体能力」的主体落点，不是闲聊：
 *
 *   ① loadWorld        —— 现读真实世界状态（PHASE-STATUS 机读 KV / site-latest KV /
 *                          atlas 词条数 / story 篇章数 / 对话树与旗标现状），不许编数。
 *   ② retrieveCanon    —— 用 scripts/lib/world-rag.mjs（CJK bigram + BM25）在整个世界语料里
 *                          检索 canon 证据块（对白 / 设定 / 叙事 / 新陆 / 16 篇短篇全文）。
 *   ③ audit            —— LLM 做 canon 一致性审计：consistency 0–100 + risks[] + gaps[]。
 *   ④ proposeTransitions—— LLM 基于**真实 flags/任务状态**提出世界状态流转提案（from→to +
 *                          叙事后果 + NPC 反应 + 可入 Atlas 的钩子）——这是「LLM 让状态流转」
 *                          的作者侧真实现：提案经人工闸后才能落进 quests/dialogue/atlas-texts。
 *   ⑤ draftContent     —— LLM 产出第十七篇游记草稿（zh+en，≤2 侧各自≤120 字）+ 大纲。仍走人工闸。
 *   ⑥ writeArtifacts   —— 落盘三处：docs/ai-director/RUN-<date>.md（人读证据）、
 *                          src/data/authoring/ai-director-latest.json（runtime:false 名册）、
 *                          admin/ai-director-latest.json（同一份，Pages 上公开可读）。
 *
 * LangGraph 知识落地：实现一个零依赖的 StateGraph（addNode / addEdge / addConditionalEdges /
 * checkpoints），条件边按 mode 分流——offline 模式不触网、诚实落「未真跑」的占位产物；
 * live 模式三条 LLM 边共享同一 system 前缀（世界快照+canon 证据），首条调用即暖缓存。
 *
 * 纪律（不可绕过）：
 *   - 玩家进程零 LLM、零网络 —— 本脚本是作者侧工具，产物 runtime:false。
 *   - dialogue.json / atlas-texts.ts / quests.json / npcs.json 一律不由本脚本写。
 *   - API key 只从 env（CAESURA_LLM_API_KEY / LLM_API_KEY）注入；不落盘、不进 git、不进产物。
 *   - live 任一 LLM 节点失败 ⇒ 继续其余节点但 exit code 2，产物里如实标记，不伪造"全绿"。
 *
 * 用法：
 *   node scripts/ai-director.mjs              # offline（CI 安全，不触网）
 *   node scripts/ai-director.mjs --live       # 真跑（走 CAESURA_LLM_PROXY 或 127.0.0.1:7897）
 *   node scripts/ai-director.mjs --focus "…"  # 换 canon 检索焦点
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
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
const FOCUS_FLAG = args.indexOf('--focus')
const FOCUS = FOCUS_FLAG >= 0 ? String(args[FOCUS_FLAG + 1] ?? '').trim() : ''
const TODAY = new Date().toISOString().slice(0, 10)
const NOW_ISO = new Date().toISOString()

/* ═══════════ StateGraph 内核住 scripts/lib/stategraph.mjs（KI-624 抽出）═══════════ */

/* ═══════════ 读数小工具（全部现读，不许手写）═══════════ */
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

function kvFromPhaseStatus() {
  const raw = readFileSync(resolve(ROOT, 'docs/PHASE-STATUS.md'), 'utf8')
  const m = raw.match(/<!--\s*PHASE-STATUS:BEGIN-KV\s*-->\s*```([\s\S]*?)```/)
  const out = {}
  if (!m) return out
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Z0-9._-]+)=(.+)$/)
    if (kv) out[kv[1]] = kv[2].trim()
  }
  return out
}

function atlasEntryCount() {
  const raw = readFileSync(resolve(ROOT, 'src/ui/atlas-texts.ts'), 'utf8')
  return (raw.match(/^\s*no:\s*\d+/gm) || []).length
}

function dialogueSnapshot() {
  const trees = readJson(resolve(ROOT, 'src/data/json/dialogue.json'))
  const nodes = trees.reduce((n, t) => n + (t.nodes?.length ?? 0), 0)
  const flags = new Set()
  const flagRe = /flag\.[A-Za-z0-9_]+/g
  for (const t of trees) {
    for (const n of t.nodes ?? []) {
      for (const c of n.choices ?? []) {
        const s = JSON.stringify(c)
        for (const m of s.matchAll(flagRe)) flags.add(m[0])
      }
      if (n.condition) for (const m of String(n.condition).matchAll(flagRe)) flags.add(m[0])
    }
  }
  return { trees: trees.length, nodes, distinctFlags: flags.size }
}

const worldSnapshot = () => {
  const kv = (() => { try { return readJson(resolve(ROOT, 'site-latest.json')).kv ?? {} } catch { return {} } })()
  const status = kvFromPhaseStatus()
  const stories = existsSync(resolve(ROOT, 'story'))
    ? readdirSync(resolve(ROOT, 'story'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : []
  const npcCount = (() => { try { return readJson(resolve(ROOT, 'src/data/json/npcs.json')).length } catch { return 0 } })()
  return {
    date: TODAY,
    phaseStatus: { KIrows: status['KI.rows'] ?? kv['KI.rows'] ?? '?', KIImplemented: status['KI.Implemented'] ?? kv['KI.Implemented'] ?? '?', SYSImplemented: status['SYS.Implemented'] ?? kv['SYS.Implemented'] ?? '?', ARCHSections: status['ARCH.sections'] ?? kv['ARCH.sections'] ?? '?' },
    atlasEntries: atlasEntryCount(),
    storyChapters: stories.length,
    storyList: stories,
    dialogue: dialogueSnapshot(),
    npcs: npcCount,
  }
}

/* ═══════════ LLM 调用（live 才有；三边共享同一 system 前缀 → 暖一条缓存）═══════════ */
const DIRECTOR_SYSTEM = [
  '你是《止音纪元》的「世界导演」（World Director）。你读过完整的世界圣经、叙事圣经、新陆设定与全部十七篇游记。',
  '你的工作不是写漂亮话，而是：① 对照 canon 证据审计世界现状；② 提出可落地的世界状态流转提案；③ 为下一篇游记产出可用的草稿。',
  '铁律：',
  '- 设定只能来自【canon 证据】片段；证据里没有的新设定必须标 requiresHumanReview:true 且不得伪造 canon 出处。',
  '- 写作纪律：禁复仇、禁新神、禁现代感叹词、禁动作括号、禁半句抒情。',
  '- 输出**严格的单个 JSON 对象**，不要 markdown 代码块、不要额外说明。',
].join('\n')

const snapshotToText = (w) => [
  `KI 行数=${w.phaseStatus.KIrows} 已实现=${w.phaseStatus.KIImplemented} 系统已实现=${w.phaseStatus.SYSImplemented} ARCH 章节=${w.phaseStatus.ARCHSections}`,
  `游记（Atlas）词条=${w.atlasEntries} 篇｜短篇篇章=${w.storyChapters}｜对话树=${w.dialogue.trees} 棵 / ${w.dialogue.nodes} 格 / 旗标=${w.dialogue.distinctFlags} 面｜NPC=${w.npcs}`,
  `短篇名单：${w.storyList.join('、')}`,
].join('\n')

async function callDirector(env, { stdinPrefix, task, temperature, maxTokens }) {
  const body = {
    model: env.model,
    stream: true,
    stream_options: { include_usage: true },
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: stdinPrefix },
      { role: 'user', content: task },
    ],
  }
  // 与正题逐字节相同的 system 前缀 ⇒ prompt_cache_key 按前缀派生（client 内处理）
  const { derivePromptCacheKey } = await import('./caesura-llm-client.mjs')
  body.prompt_cache_key = derivePromptCacheKey(body.messages)
  return callLlm(body, { baseUrl: env.baseUrl, apiKey: env.apiKey })
}

const parseJsonLoose = (raw) => {
  const s = String(raw ?? '').replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim()
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/* ═══════════ 节点实现 ═══════════ */
async function nodeLoadWorld(state) { state.world = worldSnapshot() }

async function nodeRetrieveCanon(state) {
  const focus = FOCUS || '止音纪元 世界现状 十七篇游记 收尾 下一阶段 状态流转 flag 任务 钟 无耳 低音之城 余响'
  const t0 = Date.now()
  const corpus = buildWorldCorpus(ROOT)
  const index = buildIndex(corpus)
  state.corpusSize = corpus.length
  const hits = retrieve(index, focus, 10)
  state.canon = hits.map((h, i) => ({ rank: i + 1, score: Math.round(h.score * 1000) / 1000, preview: h.chunk.slice(0, 360) }))
  state.focus = focus
  state.canonRetrieveMs = Date.now() - t0
}

const directorPrefix = (state) =>
  DIRECTOR_SYSTEM + '\n\n【世界现状快照】\n' + snapshotToText(state.world) + '\n\n【canon 证据（RAG 检索 top-10）】\n' + (state.canon ?? []).map((c, i) => `${i + 1}. ${c.preview}`).join('\n')

async function nodeAudit(state) {
  if (state.mode !== 'live') { state.audit = null; return }
  const prefix = state.prefix || directorPrefix(state)
  const task = '【任务·一致性审计】基于上面的 canon 证据，给出：{"consistency":0-100整数,"verdictZh":"≤60字总评","verdictEn":"≤30 words","risks":[{"severity":"high|med|low","itemZh":"风险点","itemEn":"risk","detailZh":"≤50字","detailEn":"≤30 words"}],"gapsZh":["≤30字缺口"],"gapsEn":["≤15 words"]}。risks 至少 2 条、至多 4 条；gaps 至少 2 条。只许 JSON。'
  const out = await callDirector(state.env, { stdinPrefix: prefix, task, temperature: 0.4, maxTokens: 900 })
  state.usage.calls += 1
  state.usage.cachedTokens += out.cachedTokens || 0
  state.usage.statuses.push(out.status)
  const parsed = parseJsonLoose(out.text)
  if (!parsed) throw new Error(`audit: JSON 解析失败（head=${String(out.text).slice(0, 80)}）`)
  state.audit = parsed
}

async function nodeProposeTransitions(state) {
  if (state.mode !== 'live') { state.transitions = []; return }
  const task = '【任务·世界状态流转提案】现状：无耳深窖五环线索、低音之城、十七篇游记写尽。提出 4 条**可直接落为 quest/flag 的状态流转提案**：{"transitions":[{"fromZh":"起点状态","fromEn":"from-state","toZh":"终点状态","toEn":"to-state","flag":"flag.existing_or_proposed","narrativeZh":"≤80字叙事后果","narrativeEn":"≤45 words","npcReactionZh":"≤40字 NPC/世界反应","npcReactionEn":"≤25 words","atlasHookZh":"≤30字 可挂进 Atlas 的钩子","atlasHookEn":"≤18 words"}]}。只许 JSON。'
  const out = await callDirector(state.env, { stdinPrefix: state.prefix, task, temperature: 0.75, maxTokens: 1200 })
  state.usage.calls += 1
  state.usage.cachedTokens += out.cachedTokens || 0
  state.usage.statuses.push(out.status)
  const parsed = parseJsonLoose(out.text)
  if (!parsed?.transitions) throw new Error(`proposeTransitions: JSON 解析失败（head=${String(out.text).slice(0, 80)}）`)
  state.transitions = parsed.transitions
}

async function nodeDraftContent(state) {
  if (state.mode !== 'live') { state.atlasDraft = null; return }
  const task = '【任务·第十七篇游记草稿】以钟摆渡人/止音纪元的笔法，为下一篇游记产出草稿：{"no":17,"titleZh":"≤10字","titleEn":"≤6 words","pZh":"≤120字正文","pEn":"≤70 words","codaZh":"≤40字尾声","codaEn":"≤25 words","requiresHumanReview":true}。笔法：不喧哗、不抒情、物件说话、留白。只许 JSON。'
  const out = await callDirector(state.env, { stdinPrefix: state.prefix, task, temperature: 0.9, maxTokens: 800 })
  state.usage.calls += 1
  state.usage.cachedTokens += out.cachedTokens || 0
  state.usage.statuses.push(out.status)
  const parsed = parseJsonLoose(out.text)
  if (!parsed?.pZh) throw new Error(`draftContent: JSON 解析失败（head=${String(out.text).slice(0, 80)}）`)
  state.atlasDraft = { ...parsed, requiresHumanReview: true }
}

function buildArtifacts(state) {
  return {
    $comment: 'KI-620 AI 导演引擎产物 · 作者侧 · 不进玩家运行时 · dialogue.json/atlas-texts.ts/quests.json 零写入 · 人工闸后方可采纳 · 绝不包含任何密钥',
    runtime: false,
    authorOnly: true,
    containsCredentials: false,
    requiresHumanReview: true,
    schema: 1,
    mode: state.mode,
    generatedAt: NOW_ISO,
    model: state.mode === 'live' ? state.env.model : '(offline dry-run)',
    endpoint: state.mode === 'live' ? state.env.baseUrl : '(offline)',
    focus: state.focus ?? null,
    corpusSize: state.corpusSize ?? 0,
    canon: (state.canon ?? []).map((c) => ({ rank: c.rank, score: c.score, preview: c.preview })),
    worldSnapshot: state.world,
    audit: state.audit ?? null,
    transitions: state.transitions ?? [],
    atlasDraft: state.atlasDraft ?? null,
    usage: state.usage,
    graphCheckpoints: state.graphCheckpoints ?? [],
    errors: state.errors,
    humanGate: '人工审核通过前，本文件里的任何条目一律不进 dialogue.json / atlas-texts.ts / quests.json / npcs.json',
  }
}

function writeArtifacts(state) {
  const art = buildArtifacts(state)
  const dirDocs = resolve(ROOT, 'docs/ai-director')
  mkdirSync(dirDocs, { recursive: true })
  // ① 人读证据
  const md = [
    `# AI 导演引擎 · RUN ${TODAY}${state.mode === 'offline' ? '（offline dry-run · 未触网）' : ''}`,
    '',
    `- mode: \`${state.mode}\` ｜ model: ${art.model} ｜ endpoint: ${art.endpoint}`,
    `- corpus chunks: ${art.corpusSize} ｜ canon hits: ${art.canon.length} ｜ LLM calls: ${art.usage.calls} ｜ cached_tokens: ${art.usage.cachedTokens} ｜ statuses: [${art.usage.statuses.join(',')}]`,
    `- focus: ${art.focus ?? '(默认)'}`,
    '',
    '## 世界现状快照',
    '```',
    snapshotToText(state.world ?? {}),
    '```',
    '',
    '## canon 证据（RAG top-10 预览）',
    ...art.canon.map((c) => `- #${c.rank} (score ${c.score}) ${c.preview.replace(/\n/g, ' ')}`),
    '',
    '## 一致性审计',
    art.audit ? '```json\n' + JSON.stringify(art.audit, null, 2) + '\n```' : '_（offline 未真跑）_',
    '',
    '## 世界状态流转提案',
    art.transitions.length ? '```json\n' + JSON.stringify(art.transitions, null, 2) + '\n```' : '_（offline 未真跑）_',
    '',
    '## 第十七篇游记 · 草稿（人工闸 · 不落库）',
    art.atlasDraft ? '```json\n' + JSON.stringify(art.atlasDraft, null, 2) + '\n```' : '_（offline 未真跑）_',
    '',
    '## 图检查点（StateGraph checkpoints）',
    ...art.graphCheckpoints.map((c) => `- ${c.ok ? '✓' : '✗'} ${c.node} · ${c.ms}ms`),
    '',
    art.errors.length ? '## 错误（如实登记）\n' + art.errors.map((e) => `- [${e.node}] ${e.message}`).join('\n') : '## 错误\n- 无',
    '',
    '> 本报告由 `scripts/ai-director.mjs` 机器生成；任何内容在人工审核前不进运行时数据。',
    '',
  ].join('\n')
  writeFileSync(resolve(dirDocs, `RUN-${TODAY}.md`), md, 'utf8')
  // ② 机读名册（authoring）＋ ③ admin 公开镜像（同一份字节）
  const target1 = resolve(ROOT, 'src/data/authoring/ai-director-latest.json')
  const target2 = resolve(ROOT, 'admin/ai-director-latest.json')
  const body = JSON.stringify(art, null, 2) + '\n'
  writeFileSync(target1, body, 'utf8')
  writeFileSync(target2, body, 'utf8')
}

/* ═══════════ 组图 ═══════════ */
async function main() {
  const state = {
    mode: MODE, errors: [], usage: { calls: 0, cachedTokens: 0, statuses: [] },
    world: null, canon: [], audit: null, transitions: [], atlasDraft: null, env: null, prefix: '',
  }
  const graph = new StateGraph()
  graph
    .addNode('loadWorld', nodeLoadWorld)
    .addNode('retrieveCanon', nodeRetrieveCanon)
    .addNode('warmup', async (s) => {
      if (s.mode !== 'live') return
      s.env = authorLlmEnv()
      if (!s.env.apiKey) throw new Error('missing CAESURA_LLM_API_KEY（env 注入）')
      // 代理口径全走 caesura-llm-client（applyAuthorProxyFromEnv / curlSub2ApiFallback 自己会读 env）——
      // 这里不再直接触碰环境变量名册（KI-441 唯一入口纪律）
      await applyAuthorProxyFromEnv()
      // 烤**正题自己的前缀**（同一串 system → 首条 audit 即命中前缀缓存；而不是无关的 NPC bible）
      s.prefix = directorPrefix(s)
      const pre = await callLlm({
        model: s.env.model, stream: true, stream_options: { include_usage: true },
        temperature: 0, max_tokens: 8,
        messages: [{ role: 'system', content: s.prefix }, { role: 'user', content: '（预热：只回一个词）' }],
        prompt_cache_key: (await import('./caesura-llm-client.mjs')).derivePromptCacheKey([{ role: 'system', content: s.prefix }]),
      }, { baseUrl: s.env.baseUrl, apiKey: s.env.apiKey })
      s.usage.calls += 1
      s.usage.cachedTokens += pre.cachedTokens || 0
      s.usage.statuses.push(pre.status)
    })
    .addNode('audit', nodeAudit)
    .addNode('proposeTransitions', nodeProposeTransitions)
    .addNode('draftContent', nodeDraftContent)
    .addNode('writeArtifacts', (s) => {
      s.graphCheckpoints = graph.checkpoints.map((c) => ({ ...c }))
      writeArtifacts(s)
    })
    .addEdge('loadWorld', 'retrieveCanon')
    .addEdge('retrieveCanon', 'warmup')
    .addEdge('warmup', 'audit')
    .addEdge('audit', 'proposeTransitions')
    .addEdge('proposeTransitions', 'draftContent')
    .addEdge('draftContent', 'writeArtifacts')
  // 条件边演示：audit 失败（例如 live 解析失败）仍继续后续节点，产物如实登记
  await graph.run('loadWorld', state)
  // 二次落盘：graph.run 返回后 checkpoints 是完整七节点（writeArtifacts 自身的那一条也有了），
  // 重写产物让镜像 JSON 与 RUN 报告从此都是完整轨迹——避免少写一格又像什么都没发生。
  state.graphCheckpoints = graph.checkpoints
  writeArtifacts(state)
  const failed = state.errors.length
  console.log(`[ai-director] mode=${state.mode} canon=${state.corpusSize} chunks · llm_calls=${state.usage.calls} · cached_tokens=${state.usage.cachedTokens} · errors=${failed}`)
  state.graphCheckpoints = graph.checkpoints
  if (failed > 0) {
    // 产物已写盘（如实含 errors）；以非零码退出让门/人注意到
    process.exit(2)
  }
}

main().catch((e) => {
  console.error('[ai-director] FATAL', e)
  process.exit(1)
})
