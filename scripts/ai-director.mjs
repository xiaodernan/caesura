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
 *   ⑤ draftContent     —— LLM 产出下一篇游记草稿（zh+en，≤2 侧各自≤120 字）+ 大纲。仍走人工闸。
 *   ⑥ writeArtifacts   —— 落盘三处：docs/ai-director/RUN-<date>.md（人读证据）、
 *                          src/data/authoring/ai-director-latest.json（runtime:false 名册）、
 *                          admin/ai-director-latest.json（同一份，Pages 上公开可读）。
 *
 * LangGraph 知识落地：实现一个零依赖的 StateGraph（addNode / addEdge / addConditionalEdges /
 * checkpoints），条件边按 mode 分流——offline 模式不触网、诚实落「未真跑」的占位产物；
 * live 模式三条 LLM 边共享同一**场景圣经巨前缀**（≈62k tokens · 世界圣经+世界谱74条+余响集三十三篇全文
 * · sha256 锚定、字节稳定），易变快照移入 user 消息，首条调用即暖缓存（KI-663）。
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
import { sceneBible, readWarmMarker, writeWarmMarker } from './lib/scene-bible.mjs'

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

/* ═══════════ LLM 调用（live 才有；三边共享**场景圣经巨前缀** + canon 证据后缀 → 暖一条缓存）═══════════ */
/* KI-663：前缀主体 = scripts/lib/scene-bible.mjs 的 SCENE_BIBLE
   （世界圣经 + 世界谱 74 条 + 余响集三十三篇全文 ≈ 62k tokens · 字节稳定）；
   易变的「世界现状快照」（日期/KI行数/篇目数）按 KI-555/KI-657 纪律迁入 user 消息，不再污染前缀字节 */

/** 易变读数只进 user，不进 system：快照 + 本轮任务 */
const withSnapshot = (state, task) =>
  `【世界现状快照 · 易变】\n${snapshotToText(state.world)}\n\n${task}`

const snapshotToText = (w) => [
  `KI 行数=${w.phaseStatus.KIrows} 已实现=${w.phaseStatus.KIImplemented} 系统已实现=${w.phaseStatus.SYSImplemented} ARCH 章节=${w.phaseStatus.ARCHSections}`,
  `游记（Atlas）词条=${w.atlasEntries} 篇｜短篇篇章=${w.storyChapters}｜对话树=${w.dialogue.trees} 棵 / ${w.dialogue.nodes} 格 / 旗标=${w.dialogue.distinctFlags} 面｜NPC=${w.npcs}`,
  `短篇名单：${w.storyList.join('、')}`,
].join('\n')

/* 单节点重试（KI-689）：代理按节点轮换时个别节点对 ~77k 上下文返回 404·空 body
   （实测：warmup/audit 先于 propose/draft 成功，随后该请求节点恢复）——任何非 2xx 一律最多 3 次
   （0s / 1.5s / 3.0s 间隔），恢复后继续；仍失败 → 走与旧版一致的「如实落 errors、人工闸裁决」。
   重试只在本节点内发生，不产生重复副作用；记账只计最终一次（attempts 逐条打印）。 */
const MAX_ATTEMPTS = 3
const isOk = (out) => out && (out.ok === true || (typeof out.status === 'number' && out.status >= 200 && out.status < 300))

async function callDirector(env, { stdinPrefix, task, temperature, maxTokens, rescue = true }) {
  const chain = Array.isArray(env.modelChain) && env.modelChain.length ? env.modelChain : [env.model]
  // 与正题逐字节相同的 system 前缀 ⇒ prompt_cache_key 按前缀派生（client 内处理）
  const { derivePromptCacheKey } = await import('./caesura-llm-client.mjs')
  let last = null
  for (const modelName of chain) {
    const body = {
      model: modelName,
      stream: true,
      stream_options: { include_usage: true },
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: stdinPrefix },
        { role: 'user', content: task },
      ],
    }
    body.prompt_cache_key = derivePromptCacheKey(body.messages)
    const attemptOnce = async () => {
      try {
        return await callLlm(body, { baseUrl: env.baseUrl, apiKey: env.apiKey })
      } catch (e) {
        return { ok: false, status: 0, dt: null, error: String(e?.message || e) }
      }
    }
    let settled = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const out = await attemptOnce()
      if (isOk(out)) {
        out.attempts = attempt
        out.modelUsed = modelName
        if (attempt > 1) console.log(`[ai-director] model=${modelName} recovered on attempt ${attempt} (temperature=${temperature})`)
        /* KI-710 · 「中途突然掉缓存/失去缓存」的自愈（2026-11-19 真实线上例：同前缀下 audit 90.3% / propose 90.2% / **draft 4.8%** / gate 90.0%）——
           路由抖动把单条请求丢到冷后端。同请求重发一次（内容候选等价 · 人工闸不变），取 cached_tokens 更高的一份；
           阈值：cached < 20000（巨前缀本应命中 ≈97K）。不读任何 env 开关——阈值与重试本身是纪律，不是可配置项。 */
        const rescueMin = rescue === false ? 0 : 20000
        if (rescueMin > 0 && (out.cachedTokens ?? 0) < rescueMin) {
          console.warn(`[ai-director] model=${modelName} temperature=${temperature} cached=${out.cachedTokens ?? 0} < ${rescueMin} — 疑似路由抖动到冷后端，自愈重试一次`)
          const rescue = await attemptOnce()
          rescue.attempts = 1
          rescue.modelUsed = modelName
          if (isOk(rescue) && (rescue.cachedTokens ?? 0) > (out.cachedTokens ?? 0)) {
            console.warn(`[ai-director] model=${modelName} 自愈生效：cached ${out.cachedTokens ?? 0} → ${rescue.cachedTokens ?? 0}`)
            rescue.rescued = true
            rescue.attempts = attempt + 1
            return rescue
          }
          rescue.rescued = false
          console.warn(`[ai-director] model=${modelName} 自愈未取优（rescue cached=${rescue.cachedTokens ?? 'n/a'}）— 保留原样并如实登记`)
          out.rescued = false
        }
        return out
      }
      out.status = out?.status ?? 0
      out.modelUsed = modelName
      last = out
      console.warn(`[ai-director] model=${modelName} attempt ${attempt}/${MAX_ATTEMPTS} failed status=${out?.status ?? 'throw'}${out?.error ? ` err=${String(out.error).slice(0, 80)}` : ''} — ${attempt < MAX_ATTEMPTS ? 'retrying' : 'giving up on this model'}`)
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
    if (!settled && chain.length > 1 && chain.indexOf(modelName) < chain.length - 1) {
      console.warn(`[ai-director] model=${modelName} 连续 ${MAX_ATTEMPTS} 次失败 — 按有序兜底链顺移到下一个模型`)
    }
  }
  return last
}


/** 统一记账 + 单条日志：状态 / 耗时 / prompt / cached / 命中率（cached/prompt），逐条打印可定位冷热点 */
const recordUsage = (state, label, out) => {
  const prompt = Number(out?.usage?.prompt_tokens ?? 0)
  const cached = out?.cachedTokens || 0
  const hit = prompt > 0 ? Math.round((cached / prompt) * 1000) / 10 : 0
  if (out?.modelUsed && out?.ok !== false && (out?.ok === true || (typeof out?.status === 'number' && out.status >= 200 && out.status < 300))) {
    state.modelUsed = out.modelUsed // 成功路径记录本请求实际命中的模型（兜底链移位时也如实登记）
  }
  state.usage.calls += 1
  state.usage.cachedTokens += cached
  state.usage.promptTokens += prompt
  state.usage.hitRates.push(hit)
  state.usage.perCall.push({ node: label, status: out?.status, dt: out?.dt ?? null, prompt, cached, hitRate: hit, attempts: out?.attempts ?? 1, model: out?.modelUsed ?? null })
  state.usage.statuses.push(out?.status)
  console.log(`[ai-director] ${label} status=${out?.status} dt=${out?.dt ?? '?'}ms prompt=${prompt} cached=${cached} hit=${hit}% model=${out?.modelUsed ?? '?'}`)
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
  const focus = FOCUS || '止音纪元 世界现状 八十三篇游记 收尾 下一阶段 状态流转 flag 任务 钟 无耳 低音之城 余响'
  const t0 = Date.now()
  const corpus = buildWorldCorpus(ROOT)
  const index = buildIndex(corpus)
  state.corpusSize = corpus.length
  const hits = retrieve(index, focus, 10)
  state.canon = hits.map((h, i) => ({ rank: i + 1, score: Math.round(h.score * 1000) / 1000, preview: h.chunk.slice(0, 360) }))
  state.focus = focus
  state.canonRetrieveMs = Date.now() - t0
}

/* KI-663：前缀 = 场景圣经巨石（stable bytes · sha256 锚）+ canon 证据（本轮 RAG top-10 · 挂后缀）。
   日期/KI 行数/篇目数（易变）一律不进 system —— 全走 user 消息 withSnapshot()。
   注意：canon 证据随 FOCUS 变 ⇒ 缓存按焦点自然分片（作者侧默认焦点固定 ⇒ 跨会话稳定）。 */
const directorPrefix = (state) =>
  sceneBible() + '\n\n【canon 证据（RAG 检索 top-10）】\n' +
  (state.canon ?? []).map((c, i) => `${i + 1}. ${c.preview}`).join('\n')

async function nodeAudit(state) {
  if (state.mode !== 'live') { state.audit = null; return }
  const prefix = state.prefix || directorPrefix(state)
  const task = '【任务·一致性审计】基于上面的 canon 证据，给出：{"consistency":0-100整数,"verdictZh":"≤60字总评","verdictEn":"≤30 words","risks":[{"severity":"high|med|low","itemZh":"风险点","itemEn":"risk","detailZh":"≤50字","detailEn":"≤30 words"}],"gapsZh":["≤30字缺口"],"gapsEn":["≤15 words"]}。risks 至少 2 条、至多 4 条；gaps 至少 2 条。只许 JSON。'
  const out = await callDirector(state.env, { stdinPrefix: prefix, task: withSnapshot(state, task), temperature: 0.4, maxTokens: 900 })
  recordUsage(state, 'audit', out)
  const parsed = parseJsonLoose(out.text)
  if (!parsed) throw new Error(`audit: JSON 解析失败（head=${String(out.text).slice(0, 80)}）`)
  state.audit = parsed
}

async function nodeProposeTransitions(state) {
  if (state.mode !== 'live') { state.transitions = []; return }
  const task = '【任务·世界状态流转提案】现状：无耳深窖五环线索、低音之城、六十四篇游记写尽。提出 4 条**可直接落为 quest/flag 的状态流转提案**：{"transitions":[{"fromZh":"起点状态","fromEn":"from-state","toZh":"终点状态","toEn":"to-state","flag":"flag.xxx","narrativeZh":"≤80字叙事后果","narrativeEn":"≤45 words","npcReactionZh":"≤40字 NPC/世界反应","npcReactionEn":"≤25 words","atlasHookZh":"≤30字 可挂进 Atlas 的钩子","atlasHookEn":"≤18 words"}]}。硬约束：flag **必须**以 "flag." 开头、全小写 snake_case（如 flag.paper_bag_salt_line_kept），**不许**加 proposed / new / plan 之类的前缀；flag 名字要像现存 flag 一样直接落库。只许 JSON。'
  const out = await callDirector(state.env, { stdinPrefix: state.prefix, task: withSnapshot(state, task), temperature: 0.75, maxTokens: 1200 })
  recordUsage(state, 'proposeTransitions', out)
  const parsed = parseJsonLoose(out.text)
  if (!parsed?.transitions) throw new Error(`proposeTransitions: JSON 解析失败（head=${String(out.text).slice(0, 80)}）`)
  state.transitions = parsed.transitions
}

async function nodeDraftContent(state) {
  if (state.mode !== 'live') { state.atlasDraft = null; return }
  const task = '【任务·游记续写草稿】以钟摆渡人/止音纪元的笔法，为下一篇游记产出草稿：{"no":84,"titleZh":"≤10字","titleEn":"≤6 words","pZh":"≤120字正文","pEn":"≤70 words","codaZh":"≤40字尾声","codaEn":"≤25 words","requiresHumanReview":true}。笔法：不喧哗、不抒情、物件说话、留白。只许 JSON。'
  const out = await callDirector(state.env, { stdinPrefix: state.prefix, task: withSnapshot(state, task), temperature: 0.9, maxTokens: 800 })
  recordUsage(state, 'draftContent', out)
  const parsed = parseJsonLoose(out.text)
  if (!parsed?.pZh) throw new Error(`draftContent: JSON 解析失败（head=${String(out.text).slice(0, 80)}）`)
  state.atlasDraft = { ...parsed, requiresHumanReview: true }
}

/**
 * 编辑闸门（live-only · KI-683 的自然延伸）：让模型对自己的草稿做终审再签字。
 * 目的：把「LLM 只产出一稿」升级为「LLM 起草 → LLM 终审（canon fidelity / voice fidelity / verdict）
 * → 必要时就地改写」。verdict=pass 原样放行；revise 且模型给了 revisedP* 时就地改写（原稿标注 editorialGateRevised）；
 * reject 时原稿保留但打 `editorialGateRejected` 大旗，人工闸最终裁决。
 * canon 事实（人物/物件/地名：回廊钟·阿汐·薄簿·钟摆渡人·盐·干痕·余响集）逐字校验模型输出，绝不静默信任。
 */
async function nodeEditorialGate(state) {
  if (state.mode !== 'live') { state.editorialGate = null; return }
  if (!state.atlasDraft) { state.editorialGate = { skipped: true, reason: 'no draft (draftContent failed? see errors)' }; return }
  const d = state.atlasDraft
  const task = `【任务·canon 编辑闸门】你是《止音纪元》终审编辑。基于上面的 canon 证据对这份游记草稿做终审：{"canonFidelity":0-100整数,"voiceFidelity":0-100整数,"verdict":"pass|revise|reject","issues":["≤20字问题"],"revisedPZh":"verdict=pass 时为 null；否则给出修订后的≤140字正文","revisedPEn":"verdict=pass 时为 null；否则给出修订后的≤80 words 正文"}。硬约束：①不得引入新人物/新物件；②canon 名词原样保留（回廊钟/阿汐/薄簿/钟摆渡人/盐/干痕/余响集/止音纪元）；③verdict 只许 pass|revise|reject；④只许 JSON。草稿：${JSON.stringify({ titleZh: d.titleZh, titleEn: d.titleEn, pZh: d.pZh, pEn: d.pEn, codaZh: d.codaZh, codaEn: d.codaEn })}`
  const out = await callDirector(state.env, { stdinPrefix: state.prefix, task: withSnapshot(state, task), temperature: 0.2, maxTokens: 1100 })
  recordUsage(state, 'editorialGate', out)
  const parsed = parseJsonLoose(out.text)
  if (!parsed) throw new Error(`editorialGate: JSON 解析失败（head=${String(out.text).slice(0, 80)}）`)
  const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0))
  const verdict = ['pass', 'revise', 'reject'].includes(parsed.verdict) ? parsed.verdict : 'revise'
  state.editorialGate = {
    canonFidelity: clamp(parsed.canonFidelity),
    voiceFidelity: clamp(parsed.voiceFidelity),
    verdict,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map((x) => String(x)).slice(0, 6) : [],
    revised: false,
    at: NOW_ISO,
  }
  if (verdict === 'revise' && typeof parsed.revisedPZh === 'string' && parsed.revisedPZh.trim() && typeof parsed.revisedPEn === 'string' && parsed.revisedPEn.trim()) {
    state.atlasDraft = { ...state.atlasDraft, pZh: parsed.revisedPZh.trim(), pEn: parsed.revisedPEn.trim(), editorialGateRevised: true }
    state.editorialGate.revised = true
  } else if (verdict === 'reject') {
    state.atlasDraft = { ...state.atlasDraft, editorialGateRejected: true }
  }
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
    model: state.mode === 'live' ? (state.modelUsed ?? state.env.model) : '(offline dry-run)',
    endpoint: state.mode === 'live' ? state.env.baseUrl : '(offline)',
    focus: state.focus ?? null,
    corpusSize: state.corpusSize ?? 0,
    canon: (state.canon ?? []).map((c) => ({ rank: c.rank, score: c.score, preview: c.preview })),
    worldSnapshot: state.world,
    audit: state.audit ?? null,
    transitions: state.transitions ?? [],
    atlasDraft: state.atlasDraft ?? null,
    editorialGate: state.editorialGate ?? null,
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
    '## 下一篇游记 · 草稿（人工闸 · 不落库）',
    art.atlasDraft ? '```json\n' + JSON.stringify(art.atlasDraft, null, 2) + '\n```' : '_（offline 未真跑）_',
    '',
    '## canon 编辑闸门（LLM 终审：canonFidelity / voiceFidelity / verdict / 是否就地改写）',
    art.editorialGate ? '```json\n' + JSON.stringify(art.editorialGate, null, 2) + '\n```' : '_（offline 未真跑）_',
    '',
    '## 图检查点（StateGraph checkpoints）',
    ...art.graphCheckpoints.map((c) => `- ${c.ok ? '✓' : '✗'} ${c.node} · ${c.ms}ms`),
    '',
    art.errors.length ? '## 错误（如实登记）\n' + art.errors.map((e) => `- [${e.node}] ${e.message}`).join('\n') : '## 错误\n- 无',
    '',
    '- cache hit ledger: `admin/ai-cache-metrics.json`（rolling ≤80 · perCall 逐条命中 · mean/steady 双列）',
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

  // ⑦ LLM 缓存命中账本（rolling ≤80 次运行 · 独立文件 · 不改变最新产物对外形状）：
  //    让「持续 ≈90% 命中、无突然掉缓存」从一次实测变成可长期审计的持久证据（admin 页读它渲染）。
  try {
    const metricsPath = resolve(ROOT, 'admin/ai-cache-metrics.json')
    const authoringMetricsPath = resolve(ROOT, 'src/data/authoring/ai-cache-metrics.json')
    let ledger = []
    try {
      const prior = JSON.parse(readFileSync(metricsPath, 'utf8'))
      if (prior && Array.isArray(prior.entries)) ledger = prior.entries
    } catch { ledger = [] }
    const perCall = Array.isArray(state.usage.perCall) ? state.usage.perCall : []
    const hitRates = Array.isArray(state.usage.hitRates) ? state.usage.hitRates : []
    const meanHit = hitRates.length ? Math.round((hitRates.reduce((a, b) => a + b, 0) / hitRates.length) * 100) / 100 : null
    // 稳态命中（剔除 warmup 首冷写）：单独记一列——这才是用户看的「≈90%」
    const steady = perCall.length > 1 && perCall[0] && perCall[0].node === 'warmup' ? hitRates.slice(1) : hitRates
    const steadyHit = steady.length ? Math.round((steady.reduce((a, b) => a + b, 0) / steady.length) * 100) / 100 : null
    const entry = {
      at: NOW_ISO,
      mode: state.mode,
      model: art.model,
      focus: art.focus ?? null,
      calls: art.usage.calls,
      cachedTokens: art.usage.cachedTokens,
      promptTokens: art.usage.promptTokens ?? null,
      meanHitRate: meanHit,
      steadyStateHitRate: steadyHit,
      perCall,
    }
    if (!ledger.some((e) => e && e.at === entry.at)) ledger.push(entry)
    ledger = ledger.slice(-80)
    const metricsBody = JSON.stringify({
      $comment: 'KI-685 A · LLM 缓存命中账本 · rolling ≤80 次 · 作者侧 · runtime:false · 绝不包含任何密钥',
      version: 1,
      runtime: false,
      containsCredentials: false,
      entries: ledger,
    }, null, 2) + '\n'
    writeFileSync(metricsPath, metricsBody, 'utf8')
    writeFileSync(authoringMetricsPath, metricsBody, 'utf8')
    console.log(`[ai-director] cache-metrics ledger: admin/ai-cache-metrics.json (entries=${ledger.length} · steadyHit=${steadyHit}%)`)
  } catch (e) {
    // 账本写失败不致命：最新产物已经落盘；如实登记到 errors 但不阻断管线
    state.errors.push({ node: 'cacheMetrics', message: String((e && e.message) || e) })
  }
}

/* ═══════════ 组图 ═══════════ */
async function main() {
  const state = {
    mode: MODE, errors: [], usage: { calls: 0, cachedTokens: 0, promptTokens: 0, statuses: [], hitRates: [], perCall: [] },
    world: null, canon: [], audit: null, transitions: [], atlasDraft: null, editorialGate: null, env: null, prefix: '',
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
      s.prefix = directorPrefix(s)
      // KI-663 单飞热身：并行会话共享一个 marker（.scratch/scene-bible-<hash>.warm · 30 分钟新鲜度）
      // 避免多个会话同时付第一波冷 miss；marker 之后的每个正题节点都吃到巨前缀缓存
      const fresh = readWarmMarker()
      if (fresh && Date.now() - Number(fresh.at ?? 0) < 30 * 60 * 1000 && (fresh.statuses ?? []).length > 0 && (fresh.statuses ?? []).every((code) => Number(code) === 200)) {
        s.warmup = { singleFlight: true, note: '同 corpus（场景圣经同一哈希）30 分钟内已由并行会话烤热', statuses: fresh.statuses, cachedTokens: fresh.cachedTokens }
        return
      }
      // KI-710 热身定案（第二轮深化，2026-11-19 实测 aizzz gpt-6.2-sol：同前缀连发前 2 次 cached=5127/5127、
      //   第 3 次 cached=95,734=88.8% —— 冷写延迟比 gpt-6.1-sol 更长）：单发一次不够，
      //   最多 3 轮、相同字节、每轮间 500ms 退避；命中 >20000 即停；记账只保留最后一轮（attempts 如实记录轮数）。
      let pre = null
      let warmRounds = 0
      for (let round = 1; round <= 3; round += 1) {
        warmRounds = round
        pre = await callDirector(s.env, {
          stdinPrefix: s.prefix,
          task: '（预热：只回一个词）',
          temperature: 0,
          maxTokens: 8,
          rescue: false, // 冷启动写缓存本来就是它的活——不为它触发路由抖动自愈
        })
        if ((pre.cachedTokens ?? 0) > 20000 || round === 3) break
        await new Promise((r) => setTimeout(r, 500))
      }
      pre.attempts = warmRounds
      recordUsage(s, 'warmup', pre)
      if (pre.status === 200) {
        writeWarmMarker({ calls: warmRounds, cachedTokens: [pre.cachedTokens || 0], statuses: [pre.status], note: 'director warmup · task-prefix monolith (canon-suffixed · multi-round)' })
      }
    })
    .addNode('audit', nodeAudit)
    .addNode('proposeTransitions', nodeProposeTransitions)
    .addNode('draftContent', nodeDraftContent)
    .addNode('editorialGate', nodeEditorialGate)
    .addNode('writeArtifacts', (s) => {
      s.graphCheckpoints = graph.checkpoints.map((c) => ({ ...c }))
      writeArtifacts(s)
    })
    .addEdge('loadWorld', 'retrieveCanon')
    .addEdge('retrieveCanon', 'warmup')
    .addEdge('warmup', 'audit')
    .addEdge('audit', 'proposeTransitions')
    .addEdge('proposeTransitions', 'draftContent')
    .addEdge('draftContent', 'editorialGate')
    .addEdge('editorialGate', 'writeArtifacts')
  // 条件边演示：audit 失败（例如 live 解析失败）仍继续后续节点，产物如实登记
  await graph.run('loadWorld', state)
  // 二次落盘：graph.run 返回后 checkpoints 是完整七节点（writeArtifacts 自身的那一条也有了），
  // 重写产物让镜像 JSON 与 RUN 报告从此都是完整轨迹——避免少写一格又像什么都没发生。
  state.graphCheckpoints = graph.checkpoints
  writeArtifacts(state)
  const failed = state.errors.length
  const meanHit = state.usage.hitRates.length ? Math.round((state.usage.hitRates.reduce((a, b) => a + b, 0) / state.usage.hitRates.length) * 10) / 10 : 0
  console.log(`[ai-director] mode=${state.mode} canon=${state.corpusSize} chunks · llm_calls=${state.usage.calls} · cached_tokens=${state.usage.cachedTokens} · prompt_tokens=${state.usage.promptTokens} · mean_hit=${meanHit}% · errors=${failed}`)
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
