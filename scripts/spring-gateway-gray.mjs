/**
 * scripts/spring-gateway-gray.mjs —— Spring Cloud Gateway 灰度/金丝雀加权路由决策器（Node.js 侧，KI-491）。
 *
 * <p>家族里 `spring-gateway-matcher` 有 `Weight` predicate、`spring-load-balancer` 有 `weight` 策略，
 * 但两者此前各用各的判据（path 哈希 vs Math.random），且集大成运行时把实例 metadata 丢光、写死
 * round-robin ⇒ 灰度路由从没真正端到端跑通过。本件把「命中金丝雀」与「按权重选实例」收口成**同一只
 * 无状态决策器**：同一亲和 key 经确定性哈希**必落同一池**（会话亲和），池内按实例权重加权选。</p>
 *
 * <p><b>判定权仍 Node 侧（决策原则①）</b>：金丝雀阈值 `canaryPercent`、字段名 `grayField`/`weightField`、
 * 亲和头 `stickyHeader`、哈希 `salt`、随机源 `rand` 一律由构造/调用方注入；本件不写任何业务阈值，缺省
 * 0% ⇒ 零金丝雀、全部走稳定池（非破坏，未配置时运行时根本不建这只决策器）。</p>
 *
 * 用法：
 *   const gray = createGrayRouter({ canaryPercent: 10, stickyHeader: 'x-player-id' })
 *   const decision = gray.decide({ path: '/api/fight', headers: { 'x-player-id': 'p42' } })
 *   const picked = gray.select(instances, decision)   // { ok, lane:'canary'|'primary', fallback, instance }
 * </p>
 */

/** 缺省字段名/亲和头/盐，导出供 runtime 与文档引用（判定仍是注入值，这里只是默认值）。 */
export const GRAY_DEFAULTS = Object.freeze({
  stickyHeader: 'x-canary-key',
  grayField: 'canary',
  weightField: 'weight',
  salt: 'caesura-gray',
  canaryPercent: 0,
})

/** FNV-1a 归一到 [0,1)；同一 `salt|key` 必得同一桶 ⇒ 会话亲和判据可复现、可跨请求无状态复用。 */
export function hashSelector(salt = GRAY_DEFAULTS.salt) {
  const s = String(salt)
  return ({ key, salt: perKeySalt } = {}) => {
    const str = `${perKeySalt ?? s}|${String(key ?? '')}`
    let h = 2166136261
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return (h >>> 0) / 0xffffffff
  }
}

/**
 * 造一只灰度/金丝雀路由决策器。
 * @param {object} [opts] {
 *   stickyHeader?, grayField?, canaryValue?, weightField?, salt?, canaryPercent?,
 *   selector?:(ctx:{key:string,salt:string})=>number in [0,1), rand?:()=>number in [0,1)
 * }
 */
export function createGrayRouter(opts = {}) {
  const stickyHeader = opts.stickyHeader ?? GRAY_DEFAULTS.stickyHeader
  const lowerStickyHeader = String(stickyHeader).toLowerCase()
  const grayField = opts.grayField ?? GRAY_DEFAULTS.grayField
  // 缺省把 metadata[grayField] 当布尔旗（truthy＝金丝雀）；给了 canaryValue 则按**精确值**匹配——
  // 这是 version 标签拓扑（stable=v1 / canary=v2）的必要判据，否则 v1/v2 都 truthy、全进金丝雀池。
  const canaryValue = opts.canaryValue
  const weightField = opts.weightField ?? GRAY_DEFAULTS.weightField
  const salt = opts.salt ?? GRAY_DEFAULTS.salt
  const defaultPercent = clampPercent(opts.canaryPercent ?? GRAY_DEFAULTS.canaryPercent)
  const selector = opts.selector ?? hashSelector(salt)
  const rand = opts.rand ?? Math.random

  const stats = { decisions: 0, canary: 0, primary: 0, fallback: 0, noInstance: 0, droppedUnhealthy: 0 }

  function clampPercent(v) {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
  }

  /** 从请求取亲和 key：命中 stickyHeader（大小写不敏感）优先，否则退 path；同 key 必落同桶。 */
  function affinityKey(req = {}) {
    const headers = req.headers ?? {}
    for (const [k, v] of Object.entries(headers)) {
      if (String(k).toLowerCase() === lowerStickyHeader && v !== undefined && v !== null && v !== '') {
        return String(v)
      }
    }
    return String(req.path ?? '')
  }

  /**
   * 决定这一请求是否想走金丝雀（无状态）。`req.canaryPercent` 可覆盖构造缺省，仍夹在 [0,100]。
   * @returns {{key:string, bucket:number, wantCanary:boolean, canaryPercent:number}}
   */
  function decide(req = {}) {
    const key = affinityKey(req)
    const pct = clampPercent(req.canaryPercent ?? defaultPercent)
    const bucket = selector({ key, salt })
    const wantCanary = bucket * 100 < pct
    stats.decisions++
    return { key, bucket, wantCanary, canaryPercent: pct }
  }

  /** 实例是否金丝雀：给了 canaryValue 按精确值比，否则取 metadata[grayField] 的 truthy。 */
  function isCanary(inst) {
    const v = inst?.metadata?.[grayField]
    return canaryValue !== undefined ? v === canaryValue : !!v
  }

  /** 按 `metadata[grayField]`（或 `canaryValue` 精确值）分稳定/金丝雀两池，`healthy===false` 一律滤掉并计数。 */
  function split(instances) {
    const primary = []
    const canary = []
    for (const inst of Array.isArray(instances) ? instances : []) {
      if (inst?.healthy === false || inst?.metadata?.healthy === false) { stats.droppedUnhealthy++; continue }
      if (isCanary(inst)) canary.push(inst)
      else primary.push(inst)
    }
    return { primary, canary }
  }

  /**
   * 池内按 `metadata[weightField]` 加权选一只。非法/缺失权重按 1 兜底；全 0 权重退化为等概率；
   * 选不出的空池返回 null。`rand()` 可注入 ⇒ 边界可确定性地测。
   */
  function weightedPick(pool) {
    if (!Array.isArray(pool) || pool.length === 0) return null
    const weights = pool.map((inst) => {
      const w = Number(inst?.metadata?.[weightField])
      return Number.isFinite(w) && w > 0 ? w : 1
    })
    const total = weights.reduce((a, b) => a + b, 0)
    let r = rand() * total
    for (let i = 0; i < pool.length; i++) {
      if (r < weights[i]) return pool[i]
      r -= weights[i]
    }
    return pool[pool.length - 1]
  }

  /**
   * 依决策选实例：想走金丝雀且该池非空 ⇒ canary；否则回退稳定池并标 `fallback:true`（宁可回退也不路由到空）。
   * 两池都空 ⇒ `{ok:false, reason:'no_instance'}`，绝不凭空造一个目标。
   * @returns {{ok:boolean, lane:'canary'|'primary'|null, fallback:boolean, instance:any, reason?:string}}
   */
  function select(instances, decision) {
    const { primary, canary } = split(instances)
    if (primary.length === 0 && canary.length === 0) {
      stats.noInstance++
      return { ok: false, lane: null, fallback: false, instance: null, reason: 'no_instance' }
    }
    const wantCanary = !!decision?.wantCanary
    if (wantCanary && canary.length > 0) {
      stats.canary++
      return { ok: true, lane: 'canary', fallback: false, instance: weightedPick(canary) }
    }
    // 想走金丝雀但池空 ⇒ 诚实回退稳定池；其余情形本就走稳定池。
    const fallback = wantCanary && canary.length === 0
    if (fallback) stats.fallback++
    else stats.primary++
    const pool = primary.length > 0 ? primary : canary
    return { ok: true, lane: 'primary', fallback, instance: weightedPick(pool) }
  }

  /** 一步到位：decide + select，结果回带 decision 便于观测/记账。 */
  function route(req, instances) {
    const decision = decide(req)
    const picked = select(instances, decision)
    return { ...picked, decision }
  }

  function statsSnapshot() { return { ...stats } }
  function reset() { for (const k of Object.keys(stats)) stats[k] = 0 }

  return {
    stickyHeader, grayField, canaryValue, weightField, salt, canaryPercent: defaultPercent,
    decide, split, weightedPick, select, route, stats: statsSnapshot, reset,
  }
}
