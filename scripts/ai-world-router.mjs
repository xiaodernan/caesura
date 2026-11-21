/**
 * scripts/ai-world-router.mjs — KI-735 · LLM 驱动的条件路由世界状态机（作者侧，真 LLM）
 *
 * 补的缺口：项目早有 StateGraph + addConditionalEdges，但全仓零调用；ai-director 的图是八节点
 * 纯线性链，proposeTransitions 只产"流转提案"文本。本件第一次让 LLM 真正当 router：
 *   loadState → retrieveCanon → llmRoute（callLlm 真调 gpt-6.2-sol）→【条件边】→ 五分支之一
 *   → draft → writeArtifacts
 * router 的 next 由 LLM 输出经 normalizeDecision 归一；非法/失败归 breather fallback 并如实标 source。
 *
 * 三难（stateResponsive / canonGrounded / auditable）用 scripts/lib/llm-router.mjs 的 routeStudy
 * 在离线 fixture 上现算（真 LLM 调用逐条带回执也可审计），tamper 精确切片、rigged 诚实塌缩。
 *
 * 纪律：玩家进程零 LLM；产物 runtime:false/authorOnly:true/requiresHumanReview:true/
 * containsCredentials:false；密钥只走 env、绝不落盘；双拷贝字节一致（admin + authoring）。
 *
 * 运行：node --env-file=.env scripts/ai-world-router.mjs --live
 *       node scripts/ai-world-router.mjs            （offline 结构自检，零网络）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, applyAuthorProxyFromEnv, derivePromptCacheKey } from './caesura-llm-client.mjs'
import { StateGraph } from './lib/stategraph.mjs'
import { buildWorldCorpus, buildIndex, retrieve } from './lib/world-rag.mjs'
import { routeStudy, routerSnapshot, normalizeDecision, BRANCHES, FALLBACK } from './lib/llm-router.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const args = process.argv.slice(2)
const LIVE = args.includes('--live')
const SEED = (() => { const i = args.findIndex((a) => a === '--seed'); return i >= 0 && args[i + 1] ? args[i + 1] : 'canon' })()
const NOW = Date.now()

/** 路由分支的叙事任务模板（一个 next 对一个 node，供条件边连到不同生成节点）。 */
const BRANCH_TASK = {
  escalate: '张力逼近阈值：写一个冲突升格的世界事件（≤60字/≤40词），物件说话、不喧哗。',
  resolve: '张力回落：写一个未竟线索被了结的世界事件（≤60字/≤40词），留白。',
  branch: '未竟线索堆积：写一个新支线被开启的世界事件（≤60字/≤40词），只点名不铺陈。',
  foreshadow: '张力中位：写一个为后续铺垫的伏笔世界事件（≤60字/≤40词），克制。',
  breather: '低张力或路由失败：写一个喘息/日常的世界事件（≤60字/≤40词），细节见真章。',
}

/** 从现读账本/产物取世界状态快照——不写死数字，读不到就如实标 unknown。 */
function loadWorldState() {
  const readJson = (p) => { try { return JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) } catch { return null } }
  const site = readJson('site-latest.json') ?? {}
  const director = readJson('src/data/authoring/ai-director-latest.json') ?? {}
  const transitions = Array.isArray(director.transitions) ? director.transitions.length : 0
  const tension = (() => {
    const rows = (director.usage?.hitRates || [])
    const mean = rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null
    return mean === null ? 50 : Math.max(0, Math.min(100, Math.round(mean)))
  })()
  return {
    seed: SEED,
    head: site.head ?? null,
    subject: site.subject ?? null,
    tension,
    threads: transitions,
    lastKind: director.editorialGate?.verdict === 'pass' ? 'resolve' : 'foreshadow',
    anchors: [], // 由 retrieveCanon 填充，router 决策的 canon 必须命中其一
  }
}

/** 真 LLM router：把世界状态 + 五分支 + canon 锚点交给模型，要它选一个 next。 */
function makeLlmRouter(env) {
  return async ({ state, branches }) => {
    if (!LIVE) return null // offline 由 decideNext 的 fixture 接管，这里不发网络
    const system = [
      '你是止音纪元世界状态机的路由判据。只读世界状态，选一个最贴切的状态流转分支。',
      '分支：escalate(升格冲突) / resolve(了结线索) / branch(展开支线) / foreshadow(埋伏笔) / breather(喘息日常)。',
      '硬约束：next 只能是上述五个小写英文之一；reason ≤40字；canon 必须逐个照抄给定 anchors 里的一个，不许自造。',
      '只输出 JSON：{"next":"...","reason":"...","canon":"..."}。',
    ].join('\n')
    const body = {
      model: env.model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ tension: state.tension, threads: state.threads, lastKind: state.lastKind, anchors: state.anchors }) },
      ],
    }
    body.prompt_cache_key = derivePromptCacheKey(body.messages)
    let out
    try { out = await callLlm(body, { baseUrl: env.baseUrl, apiKey: env.apiKey }) } catch (e) { return { __error: String((e && e.message) || e) } }
    if (out.__error) return out
    return { text: out.text, usage: out.usage, cachedTokens: out.cachedTokens, status: out.status, raw: out.text }
  }
}

async function main() {
  const state = loadWorldState()
  const errors = []
  const checkpoints = []
  const usage = { calls: 0, cachedTokens: 0, promptTokens: 0, statuses: [] }

  // canon 检索：给 router 一组真实锚点（从世界语料检索 top-5 的标签前缀）。
  let canon = []
  try {
    const corpus = buildWorldCorpus(ROOT)
    const index = buildIndex(corpus)
    canon = retrieve(index, '钟摆渡人 回廊钟 薄簿 余响 低音之城 盐 未竟账页', 5).map((h) => h.chunk.slice(0, 80))
  } catch (e) { errors.push({ node: 'retrieveCanon', message: String((e && e.message) || e) }) }
  state.anchors = canon.length ? canon : ['回廊钟'] // 无语料兜底单一真锚点，绝不空集

  // 离线三难研究（fixture，零网络）——真实数字由 lib 现算。
  const study = await routeStudy({ tamper: 'none', rigged: false })
  const snapshot = routerSnapshot(study, NOW)

  // ── 真 StateGraph：LLM 当 router，条件边连到不同分支节点 ──
  const graph = new StateGraph()
  let rawDecision = null
  let decision = null

  graph
    .addNode('loadState', (s) => { s.loaded = true })
    .addNode('retrieveCanon', (s) => { s.canonCount = canon.length })
    .addNode('llmRoute', async (s) => {
      const env = authorLlmEnv()
      if (LIVE && !env.apiKey) { errors.push({ node: 'llmRoute', message: 'missing CAESURA_LLM_API_KEY' }); s.decision = { next: FALLBACK, source: 'error-fallback' }; decision = s.decision; return }
      if (LIVE) await applyAuthorProxyFromEnv()
      const router = makeLlmRouter(env)
      const out = await router({ state: s, branches: BRANCHES })
      rawDecision = out
      if (!LIVE) { // offline：fixture 决策，保证图也真走一条条件边分支（零网络）
        const guess = s.tension >= 80 ? 'escalate' : s.tension <= 25 ? 'resolve' : (s.threads || 0) >= 4 ? 'branch' : 'foreshadow'
        decision = { next: guess, reason: `offline fixture（tension=${s.tension} threads=${s.threads}）`, canon: s.anchors[0], source: 'fixture' }
        s.decision = decision
        return
      }
      const content = out?.text ?? (typeof out === 'string' ? out : '')
      const d = normalizeDecision(content, BRANCHES)
      decision = d.valid
        ? { next: d.next, reason: d.reason, canon: d.canon, source: 'llm', status: out.status ?? null }
        : { next: FALLBACK, reason: d.reason || '解析失败/非法分支，保守归 breather', canon: null, source: out?.__error ? 'error-fallback' : d.source, error: out?.__error ?? null }
      s.decision = decision
      if (out && out.usage) {
        usage.calls += 1
        usage.cachedTokens += out.cachedTokens ?? 0
        usage.promptTokens += out.usage?.prompt_tokens ?? 0
        usage.statuses.push(out.status ?? null)
      }
    })

  // 五个分支节点：每个都真实存在、由条件边抵达，落一段 draft。
  for (const b of BRANCHES) {
    graph.addNode(`draft_${b}`, (s) => { s.draft = { branch: b, task: BRANCH_TASK[b], reached: true } })
  }
  graph.addNode('writeArtifacts', () => {})

  graph
    .addEdge('loadState', 'retrieveCanon')
    .addEdge('retrieveCanon', 'llmRoute')
    // ★ 条件边：router(state).next 决定真正走进哪个分支节点——这是全仓第一次真用 addConditionalEdges。
    .addConditionalEdges('llmRoute', (s) => s.decision?.next ?? FALLBACK, Object.fromEntries(BRANCHES.map((b) => [b, `draft_${b}`])))
  for (const b of BRANCHES) graph.addEdge(`draft_${b}`, 'writeArtifacts')

  await graph.run('loadState', state)
  checkpoints.push(...graph.checkpoints.map((c) => ({ ...c })))
  const reachedBranch = decision?.next ?? FALLBACK
  const branchReached = checkpoints.some((c) => c.node === `draft_${reachedBranch}` && c.ok)

  const artifact = {
    schema: 1,
    kind: 'llm-driven-stategraph-router',
    ki: 'KI-735',
    generatedAt: new Date(NOW).toISOString(),
    mode: LIVE ? 'live' : 'offline',
    model: LIVE ? authorLlmEnv().model : null,
    seed: SEED,
    worldState: { ...state, anchors: state.anchors.slice(0, 5) },
    decision,
    rawDecisionHead: rawDecision && typeof rawDecision === 'object' ? JSON.stringify(rawDecision).slice(0, 240) : String(rawDecision ?? '').slice(0, 240),
    branchReached,
    draft: state.draft ?? null,
    checkpoints,
    usage,
    trilemma: snapshot,
    errors,
    runtime: false,
    authorOnly: true,
    containsCredentials: false,
    requiresHumanReview: true,
  }

  const authorPath = resolve(ROOT, 'src/data/authoring/ai-world-router.json')
  const adminPath = resolve(ROOT, 'admin/ai-world-router.json')
  for (const p of [authorPath, adminPath]) {
    const eol = existsSync(p) && readFileSync(p, 'utf8').includes('\r\n') ? '\r\n' : '\n'
    const dir = dirname(p)
    if (!existsSync(dir)) throw new Error(`missing dir ${dir}`)
    writeFileSync(p, JSON.stringify(artifact, null, 2) + eol, 'utf8')
  }

  const hits = usage.calls ? Math.round((usage.cachedTokens / Math.max(1, usage.promptTokens)) * 1000) / 10 : 0
  console.log(`[ai-world-router] mode=${artifact.mode} model=${artifact.model ?? '-'} route=${reachedBranch} branchReached=${branchReached} checkpoints=${checkpoints.length} · llm_calls=${usage.calls} cached=${usage.cachedTokens} prompt=${usage.promptTokens} hit=${hits}% errors=${errors.length}`)
  if (errors.length) process.exitCode = 1
}

main().catch((e) => { console.error('[ai-world-router] fatal:', e?.message || e); process.exitCode = 1 })
