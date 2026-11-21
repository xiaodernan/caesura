/**
 * scripts/lib/llm-router.mjs — LLM 驱动的条件路由判据内核（LangGraph addConditionalEdges 的可证伪底座）
 *
 * 为什么存在：本项目早有零依赖 StateGraph（scripts/lib/stategraph.mjs，含 addConditionalEdges），
 * 但全仓零调用——ai-director.mjs 的图是八节点纯线性链，proposeTransitions 只产"流转提案"文本，
 * 并不真的决定走向。本件把"router(state) → key → mapping[key]"这一步的**判据**做成可注入、可审计、
 * 可证伪的纯逻辑：call({state, branches}) 由调用方注入（离线 fixture / 真 LLM），本文件零网络零密钥。
 *
 * 三难（三难维序固定，逐字同源，禁止臆造）：
 *   - stateResponsive : router 在状态集上走出 ≥2 种不同分支（证明它真在读 state，不是常量）
 *   - canonGrounded   : 每条决策的 canon 字段命中该状态自带的 anchors（证明不是自由联想）
 *   - auditable       : 每条决策落在已知分支且带非空 reason（证明可追溯）
 *
 * 三路 tamper 各自只打穿自己那一家（精确切片）：
 *   noState       → call 忽略 state 恒出同一分支 ⇒ 只打穿 stateResponsive
 *   hallucinateCanon → call 的 canon 不在 anchors ⇒ 只打穿 canonGrounded
 *   noReason      → call 的 reason 为空 ⇒ 只打穿 auditable
 * rigged 全开 ⇒ 三家收敛 111 ⇒ 区分度诚实塌缩（riggedConvergenceCollapsed=true），绝不硬造优势。
 *
 * 纪律：state 必须可 JSON 序列化；非法 next / 解析失败一律归 fallback 并标 source，绝不静默当成功。
 */
export const BRANCHES = Object.freeze(['escalate', 'resolve', 'branch', 'foreshadow', 'breather'])
export const FALLBACK = 'breather'
export const TRILEMMA = Object.freeze(['stateResponsive', 'canonGrounded', 'auditable'])
export const TAMPER_MODES = Object.freeze(['none', 'noState', 'hallucinateCanon', 'noReason'])

/** 默认教学状态集：tension/threads/lastKind/anchors 足以让真 router 分辨，固定 seed 可复现。 */
export const DEFAULT_STATES = Object.freeze([
  { id: 's1', tension: 92, threads: 5, lastKind: 'breather', anchors: ['回廊钟'] },
  { id: 's2', tension: 18, threads: 1, lastKind: 'escalate', anchors: ['薄簿'] },
  { id: 's3', tension: 55, threads: 3, lastKind: 'resolve', anchors: ['余响集'] },
  { id: 's4', tension: 74, threads: 4, lastKind: 'foreshadow', anchors: ['低音之城'] },
  { id: 's5', tension: 33, threads: 2, lastKind: 'branch', anchors: ['盐'] },
])

/** 把 LLM 的原始输出归一为决策对象。非法分支 → valid:false（调用方归 fallback）。 */
export function normalizeDecision(raw, branches = BRANCHES) {
  let obj = raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
    try { obj = JSON.parse(fence ? fence[1] : t) } catch { return { next: null, reason: '', canon: '', valid: false, source: 'unparseable' } }
  }
  if (!obj || typeof obj !== 'object') return { next: null, reason: '', canon: '', valid: false, source: 'unparseable' }
  const next = typeof obj.next === 'string' ? obj.next.trim().toLowerCase() : ''
  const valid = branches.includes(next)
  return {
    next: valid ? next : null,
    reason: typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 200) : '',
    canon: typeof obj.canon === 'string' ? obj.canon.trim().slice(0, 80) : '',
    valid,
    source: valid ? 'llm' : 'invalid-branch',
  }
}

/** 单次决策：call 可注入；异常与非法输出都归 fallback 并如实标 source，绝不静默当成功。
 *  sourceTag：给非 LLM 的基线/夹具如实标注来源（'llm' / 'constant' / 'fixture'），llmCalls 只数真 'llm'。 */
export async function decideNext({ state, call, branches = BRANCHES, fallback = FALLBACK, sourceTag = 'llm' } = {}) {
  const B = Array.isArray(branches) && branches.length ? branches : BRANCHES
  const F = B.includes(fallback) ? fallback : B[B.length - 1]
  let raw = null
  let err = null
  try { raw = await call({ state, branches: [...B] }) } catch (e) { err = String((e && e.message) || e) }
  const d = normalizeDecision(raw, B)
  if (!d.valid) return { ...d, next: F, source: err ? 'error-fallback' : d.source, error: err }
  return { ...d, source: sourceTag, error: err }
}

const CONSTANT_CALL = async () => ({ next: FALLBACK, reason: '保守喘息', canon: '' })

/** 由真实决策行现算三难——零查表、零硬编码结论。 */
function trilemmaOf(rows) {
  const distinct = new Set(rows.map((r) => r.next)).size
  const stateResponsive = distinct >= 2
  const canonGrounded = rows.length > 0 && rows.every((r) => r.canon && (r.anchors || []).includes(r.canon))
  const auditable = rows.length > 0 && rows.every((r) => r.valid && r.reason.length > 0 && BRANCHES.includes(r.next))
  return { stateResponsive, canonGrounded, auditable, distinctBranches: distinct }
}

const bits = (t) => (t.stateResponsive ? '1' : '0') + (t.canonGrounded ? '1' : '0') + (t.auditable ? '1' : '0')

/** 离线 fixture：按 state 真分辨的假 LLM（单测与 dry-run 用，绝不当真机读数）。 */
export function fixtureCall({ state, branches } = {}) {
  const s = state || {}
  if (s.tension >= 80) return { next: 'escalate', reason: `张力 ${s.tension} 逼近阈值，升格冲突`, canon: (s.anchors || [])[0] }
  if (s.tension <= 25) return { next: 'resolve', reason: `张力 ${s.tension} 已回落，了结线索`, canon: (s.anchors || [])[0] }
  if ((s.threads || 0) >= 4) return { next: 'branch', reason: `未竟线索 ${s.threads} 条，展开支线`, canon: (s.anchors || [])[0] }
  return { next: 'foreshadow', reason: '张力中位，埋设伏笔', canon: (s.anchors || [])[0] }
}

function tamperedCall(mode, call) {
  // 只打穿 stateResponsive：忽略 state 恒出同一分支，但 canon/reason 仍有效 ⇒ 另两位保持真。
  if (mode === 'noState') return async ({ state }) => ({ next: FALLBACK, reason: '恒定保守分支', canon: (state?.anchors || [])[0] })
  // 只打穿 canonGrounded：锚点伪造不在 state.anchors 内。
  if (mode === 'hallucinateCanon') return async (args) => ({ ...fixtureCall(args), canon: '不存在的锚点' })
  // 只打穿 auditable：reason 为空。
  if (mode === 'noReason') return async (args) => ({ ...fixtureCall(args), reason: '' })
  return call
}

/**
 * 在同一状态集上跑「LLM 决策」与「常量基线」两策略，三难从真实决策行现算。
 * @param {object} opts { states?, call?, branches?, fallback?, tamper?, rigged? }
 */
export async function routeStudy({ states, call, branches = BRANCHES, fallback = FALLBACK, tamper = 'none', rigged = false } = {}) {
  const S = Array.isArray(states) && states.length ? states : DEFAULT_STATES
  const T = TAMPER_MODES.includes(tamper) ? tamper : 'none'
  const realCall = typeof call === 'function' ? call : fixtureCall
  const llmCall = rigged ? fixtureCall : tamperedCall(T, realCall)

  async function run(strategyName, fn, sourceTag = 'llm') {
    const rows = []
    for (const st of S) {
      const d = await decideNext({ state: st, call: fn, branches, fallback, sourceTag })
      rows.push({ id: st.id, next: d.next, reason: d.reason, canon: d.canon, source: d.source, valid: d.valid, anchors: st.anchors || [] })
    }
    const study = trilemmaOf(rows)
    return {
      strategy: strategyName,
      key: bits(study),
      llmCalls: rows.filter((r) => r.source === 'llm').length,
      ...study,
      rows,
      publicRows: rows.map(({ anchors, ...r }) => r),
    }
  }

  // llmDecided 用经过 tamper 的 call（rigged 时忽略 tamper）；sourceTag 一律 'llm'。
  // 常量基线用 CONSTANT_CALL、sourceTag='constant'——它永不花 LLM 调用，llmCalls 如实为 0。
  const llmDecided = await run('LLMDecided', llmCall, 'llm')
  const constantBaseline = await run('ConstantBaseline', CONSTANT_CALL, 'constant')
  const strategies = [llmDecided, constantBaseline]

  // rigged：三家（含被 tamper 的一家）全部收敛 111 ⇒ 区分度塌缩，诚实标注，绝不硬造差异。
  const convergenceCollapsed = strategies.every((s) => s.key === '111')
  if (rigged || convergenceCollapsed) {
    for (const s of strategies) {
      s.stateResponsive = true
      s.canonGrounded = true
      s.auditable = true
      s.key = '111'
      s.rigged = true
    }
  }

  // falsifiable：由真值推导，不写死。基线 = 无 tamper 的 fixture 三难；tamper 后的 llmDecided 三难只应差一位。
  // 若打穿了不止一位（乱棍）或根本没打穿（假护栏），都为 false。全部取自本次真实跑出的 rows，零二次调用。
  const base = trilemmaOf(DEFAULT_STATES.map((st) => ({ ...decideNextSync(fixtureCall, st), anchors: st.anchors })))
  let expected = { stateResponsive: true, canonGrounded: true, auditable: true }
  if (T === 'noState') expected = { ...expected, stateResponsive: false }
  if (T === 'hallucinateCanon') expected = { ...expected, canonGrounded: false }
  if (T === 'noReason') expected = { ...expected, auditable: false }
  const rawLlm = trilemmaOf(llmDecided.rows)
  const dims = TRILEMMA
  const pierced = dims.filter((k) => rawLlm[k] !== base[k])
  const falsifiable = !rigged && T === 'none'
    ? base.stateResponsive && base.canonGrounded && base.auditable
    : !rigged && pierced.length === 1 && expected[pierced[0]] === false && dims.every((k) => k === pierced[0] || rawLlm[k] === base[k])

  return {
    states: S.length,
    branches: [...branches],
    dims: [...TRILEMMA],
    strategies: strategies.map(({ rows, publicRows, ...s }) => s),
    rows: { LLMDecided: llmDecided.publicRows, ConstantBaseline: constantBaseline.publicRows },
    tamper: T,
    rigged,
    riggedConvergenceCollapsed: rigged || convergenceCollapsed,
    falsifiable,
    noUniversalWinner: llmDecided.stateResponsive && !constantBaseline.stateResponsive && constantBaseline.llmCalls < llmDecided.llmCalls,
  }
}

function decideNextSync(fn, st) {
  // fixture 是同步的；用一次微任务前的同步取值仅供基线纯计算，不发网络。
  const r = fn({ state: st, branches: BRANCHES })
  const d = normalizeDecision(r, BRANCHES)
  return { next: d.valid ? d.next : FALLBACK, reason: d.reason, canon: d.canon, valid: d.valid, source: d.source }
}

/** 给 console/admin 用的稳定快照（去掉函数、保留可审计数字）。 */
export function routerSnapshot(study, now = Date.now()) {
  return {
    generatedAt: now,
    states: study.states,
    branches: study.branches,
    dims: study.dims,
    strategies: study.strategies,
    tamper: study.tamper,
    rigged: study.rigged,
    riggedConvergenceCollapsed: study.riggedConvergenceCollapsed,
    falsifiable: study.falsifiable,
    noUniversalWinner: study.noUniversalWinner,
  }
}
