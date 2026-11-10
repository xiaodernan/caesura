/**
 * scripts/caesura-failure-detector.mjs —— 服务故障检测器：φ 累积风险 + SWIM 成员协议 + 健康视图缓存（P8 第十一件，KI-503）。
 *
 * <p><b>病</b>：集大成主线把「服务注册/发现」（facade / mesh-registry / eureka / k8s / load-balancer / health-check）
 * 做厚了，却始终缺最关键的一环——<b>注册之后，怎么判定一个实例「死了」</b>。现有 `spring-health-check` /
 * `spring-mesh-health` 只看调用方传入的静态 `healthy` 布尔，既没有「心跳节奏本身说明什么」的自适应判定，
 * 也没有「偶发一次超时到底该不该剔除」的容错状态机；而微服务生产里这张判定表正是 Cassandra / Akka 的
 * <b>φ-accrual failure detector</b>、Consul / Seris 的 <b>SWIM gossip 成员协议</b> 在做的事。缺它，
 * 「剔除坏实例」就只剩一句硬编码超时，抖动一次就误杀、真死了又发现慢，且讲不出任何权衡判词。</p>
 *
 * <p><b>落点</b>：四只零依赖、可注入时钟/随机/探针、确定性可 headless 测的纯 JS 件（判定与阈值全 opts 注入，
 * 判定权 Node 侧，决策原则①）：</p>
 * <ul>
 *   <li><b>createPhiAccrualDetector</b> —— 连续量故障检测器：定长环形缓冲（Float64Array，缓存友好、无 GC 抖动）
 *       存最近 W 个心跳间隔；每次用 <b>Welford 在线算法</b>在窗口内重算 μ/σ（避开朴素 Σx²−(Σx)²/n 的抵消误差）；
 *       <code>φ(t) = −log₁₀(P(间隔 &gt; t−lastHeartbeat))</code>，尾概率用 <b>erfc 近似</b>（A&S 7.1.26，纯 JS）。
 *       σ 以 <code>minStdDeviationMs</code>（即 tolerated pause）为下限防历史过整齐时 φ 爆炸；样本不足
 *       <code>minSamples</code> 时 φ 返回 0（诚实：不凭空定罪）。<b>自适应</b>是它的灵魂：同一段延迟在规律心跳
 *       下 φ 高、在本来就抖动的历史下 φ 低，固定超时做不到这点。</li>
 *   <li><b>createSwimMembership</b> —— SWIM 风格三态成员机 alive→suspected→faulty：直接探测失败后走
 *       <b>间接探测</b>（请 K 个中继代 ping，任一成功即反证存活，避免单链路抖动误杀）；suspected 超过
 *       <code>suspicionMult×probeIntervalMs</code> 才被 reap 确认死亡；<code>applyGossip</code> 以
 *       <b>incarnation 单调</b>合并状态（旧 gossip 覆盖不了新反证）。判定/超时/中继全注入。</li>
 *   <li><b>createHealthView</b> —— 把「φ 判定 + SWIM alive 状态」收敛成负载均衡可读的健康实例列表，
 *       复用 KI-493 <code>createRedisCache</code> 做 <b>TTL 缓存</b>：服务发现客户端高频读健康视图，缓存命中
 *       不再扫全成员表、不重算 φ（呼应 KI-501 缓存防护的读放大治理）；成员变更 <code>invalidate</code> 主动失效。</li>
 *   <li><b>compareFixedVsPhi</b> —— <b>核心证据</b>：同一条含 GC 长暂停与真故障的确定性心跳轨迹，分别喂
 *       固定超时与 φ 检测器，数误报/真报、测真故障检测延迟，并做「同延迟·规律 vs 抖动」自适应对照。
 *       判词<b>不粉饰 φ 全面更优</b>：如实给出「固定超时检测更快但抖动期误报多 / φ 保守降误报但检测更慢」这组
 *       真实权衡（同 KI-497 SoA 跳跃退化、KI-501 布隆假阳性的诚实立场）。</li>
 * </ul>
 *
 * <p><b>不声称</b>：不声称接了真 Cassandra/Akka/Consul/Seris（纯进程内教学状态机、无 socket/无 UDP gossip/
 * 无真网络分区）；不声称 φ 的正态假设拟合真实网络尾延迟（是教学简化，真系统用分段/经验分布，参数须实测标定）；
 * 不声称 erfc 近似是精确数学库（A&S 7.1.26 约 1.5e−7 绝对误差，足够教学判词）；不声称测了墙钟时序或真 GC 暂停
 * （全注入时钟与结构计数，非 QPS/延迟跑分）；不声称替代 `spring-health-check`（本件只做判定教学、不改任何既有
 * 调用路径，默认 `failureDetector:false` 非破坏）；不声称健康视图缓存跨进程共享（进程内 KI-493 缓存，真后端靠注入）。</p>
 *
 * 用法：
 *   const d = createPhiAccrualDetector({ now: () => t })
 *   d.heartbeat(); t += 100; d.heartbeat()      // μ≈100
 *   t += 420; d.phi()                            // 长暂停后 φ 升高
 *   const study = await failureDetectorStudy()   // 对照 + SWIM 脚本 + 健康视图读数
 *   npm run detect:bench                         // CLI 打印确定性结构读数
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRedisCache } from './caesura-redis-cache.mjs'

/** 缺省教学参数（判定阈值仍由调用方注入，本表只给可复现的缺省值）。 */
export const FD_DEFAULTS = Object.freeze({
  threshold: 4,               // φ 越此值判 suspect（Cassandra 常用 8，教学取 4 让判词在短轨迹内可断言）
  minSamples: 5,              // 样本不足不定罪
  minStdDeviationMs: 150,     // σ 下限＝可容忍暂停；稳定轨迹也给它 150ms 宽度，长暂停才不至于 φ 立刻爆表
  windowSize: 20,             // 环形缓冲长度（保留最近 20 个间隔）
  phiCap: 100,                // φ 上限，防 Q 下溢成 0 ⇒ Infinity 污染 JSON
  fixedTimeoutMs: 250,        // 固定超时对照阈值
  probeIntervalMs: 1000,      // SWIM 探针周期（乘 suspicionMult 得怀疑超时）
  suspicionMult: 3,           // suspected 撑过 3 个周期才确认死亡
  retransmitLimit: 3,         // 间接探测最多请几个中继
  baseIntervalMs: 100,        // 默认轨迹的正常心跳间隔
  spikeGapMs: 420,            // 默认轨迹的 GC 长暂停间隔（> fixedTimeout ⇒ 固定超时误报）
  spikeCount: 3,              // 默认轨迹插入几次长暂停
  stableCount: 40,            // 默认轨迹正常心跳数
  faultCapMs: 3000,           // 真故障检测延迟的观测上限
  stepMs: 10,                 // 真故障延迟探测步长
  healthTtlMs: 5000,          // 健康视图缓存 TTL
})

const PHI_CAP = 100

/** 有限数保留 4 位；Infinity/NaN/非数落 null（绝不把假数写进快照）。 */
function round4(x) { return Number.isFinite(x) ? Number(Number(x).toFixed(4)) : null }
function round2(x) { return Number.isFinite(x) ? Number(Number(x).toFixed(2)) : null }
function clockOf(opts, fallback = () => Date.now()) { return typeof opts?.now === 'function' ? opts.now : fallback }
function timeOr(t, now) { return typeof t === 'number' && Number.isFinite(t) ? t : now() }

/**
 * erfc 互补误差函数近似（Abramowitz & Stegun 7.1.26，绝对误差 ≲1.5e−7）。
 * 导出供单测钉住数学正确性：erfc(0)=1、erfc(∞)→0、Q(0)=0.5。
 * @param {number} x
 */
export function erfc(x) {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * z)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  const e = poly * Math.exp(-z * z)
  return x >= 0 ? e : 2 - e
}

/** 标准正态右尾 Q(z)=P(Z&gt;z)=½·erfc(z/√2)。 */
function normalTailQ(z) {
  return 0.5 * erfc(z / Math.SQRT2)
}

/** 由「当前间隔 gap、历史均值 mean、有效标准差 stdEff」算 φ=−log₁₀(Q((gap−mean)/stdEff))。 */
function phiFromGap(gap, mean, stdEff, cap = PHI_CAP) {
  if (!(gap > mean) || !(stdEff > 0)) return 0
  const q = normalTailQ((gap - mean) / stdEff)
  if (!(q > 0)) return cap // 尾概率下溢 ⇒ φ 饱和到上限，不写 Infinity
  const phi = -Math.log10(q)
  return Number.isFinite(phi) ? Math.max(0, Math.min(cap, phi)) : cap
}

/* ==================== ① φ 累积故障检测器 ==================== */

/**
 * φ-accrual 故障检测器：连续量判词，替代「一个硬超时定生死」。
 * 环形缓冲定长 Float64Array（缓存行友好、无逐心跳分配）；μ/σ 用 <b>Welford</b> 在窗口内增量式
 * 单遍重算（数值稳定），不做增量删除（避免反向 Welford 在长轨迹上的数值漂移）——窗口小（缺省 20），
 * O(W) 全量重算的常数成本换来判词可信，这个取舍写在明处。
 * @param {object} [opts] { threshold?, minSamples?, minStdDeviationMs?, windowSize?, phiCap?, now? }
 */
export function createPhiAccrualDetector(opts = {}) {
  const now = clockOf(opts)
  const threshold = Math.max(0, Number(opts.threshold ?? FD_DEFAULTS.threshold))
  const minSamples = Math.max(1, Math.floor(Number(opts.minSamples ?? FD_DEFAULTS.minSamples)))
  const minStdDeviationMs = Math.max(0, Number(opts.minStdDeviationMs ?? FD_DEFAULTS.minStdDeviationMs))
  const windowSize = Math.max(2, Math.floor(Number(opts.windowSize ?? FD_DEFAULTS.windowSize)))
  const phiCap = Math.max(1, Number(opts.phiCap ?? FD_DEFAULTS.phiCap))

  const buf = new Float64Array(windowSize)
  let start = 0   // 最旧元素槽位
  let len = 0     // 当前间隔数（≤ windowSize）
  let lastAt = null
  let mean = 0
  let m2 = 0
  let stddev = 0
  let heartbeats = 0
  let intervalsSeen = 0
  let lastGap = null

  const at = (i) => buf[(start + i) % windowSize]

  /** Welford 单遍重算窗口内 μ 与样本方差（n>1 用 M2/(n−1)）。 */
  function recompute() {
    if (len === 0) { mean = 0; m2 = 0; stddev = 0; return }
    let m = at(0)
    let acc = 0
    for (let i = 1; i < len; i++) {
      const x = at(i)
      const d = x - m
      m += d / (i + 1)
      const d2 = x - m
      acc += d * d2
    }
    mean = m
    m2 = acc
    stddev = len > 1 ? Math.sqrt(acc / (len - 1)) : 0
  }

  function push(gap) {
    if (len < windowSize) { buf[(start + len) % windowSize] = gap; len++ }
    else { buf[start] = gap; start = (start + 1) % windowSize } // 满则覆盖最旧并前移窗口
  }

  /** 记一次心跳到达；返回本条读数（含距上次间隔）。 */
  function heartbeat(t) {
    const tt = timeOr(t, now)
    if (lastAt !== null) {
      lastGap = Math.max(0, tt - lastAt)
      push(lastGap)
      intervalsSeen++
      recompute()
    }
    lastAt = tt
    heartbeats++
    return { heartbeats, samples: len, gap: lastGap, mean: round4(mean), stddev: round4(stddev) }
  }

  /** 当前疑难度：距上次心跳越久、历史越规律 ⇒ φ 越高。样本不足/无心跳 ⇒ 0（不定罪）。 */
  function phi(t) {
    if (lastAt === null || len < minSamples) return 0
    const gap = Math.max(0, timeOr(t, now) - lastAt)
    const stdEff = Math.max(stddev, minStdDeviationMs)
    return round4(phiFromGap(gap, mean, stdEff, phiCap))
  }

  function suspect(t) { return phi(t) >= threshold }

  function intervals() { const out = []; for (let i = 0; i < len; i++) out.push(at(i)); return out }

  function snapshot(t) {
    const tt = timeOr(t, now)
    const gap = lastAt === null ? null : Math.max(0, tt - lastAt)
    const stdEff = Math.max(stddev, minStdDeviationMs)
    const p = phi(tt)
    return {
      strategy: 'phiAccrual', threshold, minSamples, minStdDeviationMs, windowSize, phiCap,
      samples: len, heartbeats, intervalsSeen, lastHeartbeatAt: lastAt, gap: round4(gap),
      mean: round4(mean), stddev: round4(stddev), effectiveStddev: round4(stdEff),
      lastGap: round4(lastGap), phi: p, suspect: p >= threshold,
      intervals: intervals().map(round4), complexity: 'Welford over bounded ring O(W)',
    }
  }

  function reset() {
    start = 0; len = 0; lastAt = null; mean = 0; m2 = 0; stddev = 0
    heartbeats = 0; intervalsSeen = 0; lastGap = null
  }

  return {
    heartbeat, phi, suspect, snapshot, state: snapshot, reset, intervals,
    readonly: true,
    get threshold() { return threshold },
    get samples() { return len },
    get mean() { return round4(mean) },
    get stddev() { return round4(stddev) },
    get lastAt() { return lastAt },
  }
}

/* ==================== ② SWIM 三态成员协议 ==================== */

const SWIM_STATES = ['alive', 'suspected', 'faulty']

/**
 * SWIM 风格成员协议：alive → suspected → faulty，附间接探测反证与 incarnation 单调合并。
 * @param {object} [opts] { probeIntervalMs?, suspicionMult?, retransmitLimit?, now?, rand? }
 */
export function createSwimMembership(opts = {}) {
  const now = clockOf(opts)
  const probeIntervalMs = Math.max(1, Number(opts.probeIntervalMs ?? FD_DEFAULTS.probeIntervalMs))
  const suspicionMult = Math.max(1, Number(opts.suspicionMult ?? FD_DEFAULTS.suspicionMult))
  const retransmitLimit = Math.max(0, Math.floor(Number(opts.retransmitLimit ?? FD_DEFAULTS.retransmitLimit)))
  const rand = typeof opts.rand === 'function' ? opts.rand : Math.random
  const suspicionTimeoutMs = probeIntervalMs * suspicionMult
  /** @type {Map<string,{id:string,state:string,incarnation:number,suspectAt:number|null,addedAt:number}>} */
  const members = new Map()
  const counters = { probes: 0, directFailures: 0, indirectAttempts: 0, indirectRescues: 0, refutations: 0, confirmations: 0, gossipsApplied: 0, gossipsStale: 0 }

  function add(id, incarnation = 0, t) {
    const key = String(id)
    if (!members.has(key)) {
      members.set(key, { id: key, state: 'alive', incarnation: Math.max(0, Math.floor(Number(incarnation) || 0)), suspectAt: null, addedAt: timeOr(t, now) })
      return { added: true, state: 'alive' }
    }
    return { added: false, state: members.get(key).state }
  }
  function remove(id) { return { removed: members.delete(String(id)) } }
  function has(id) { return members.has(String(id)) }
  function state(id) { const m = members.get(String(id)); return m ? { id: m.id, state: m.state, incarnation: m.incarnation, suspectAt: m.suspectAt } : null }

  /** alive/suspected → suspected；faulty 不再回退。返回是否发生状态变化。 */
  function suspect(id, t) {
    const m = members.get(String(id)); if (!m || m.state === 'faulty') return { changed: false, state: m?.state ?? null }
    if (m.state === 'suspected') return { changed: false, state: 'suspected', incarnation: m.incarnation }
    m.state = 'suspected'; m.suspectAt = timeOr(t, now); m.incarnation++
    return { changed: true, state: 'suspected', incarnation: m.incarnation }
  }

  /** suspected → alive（反证成功）；incarnation++ 让旧 suspicion gossip 失效。 */
  function alive(id, t) {
    const m = members.get(String(id)); if (!m) { add(id, 0, t); return { changed: true, state: 'alive', created: true } }
    if (m.state === 'suspected') {
      m.state = 'alive'; m.suspectAt = null; m.incarnation++; counters.refutations++
      return { changed: true, state: 'alive', incarnation: m.incarnation }
    }
    return { changed: false, state: m.state, incarnation: m.incarnation }
  }

  /** 任意（非已 faulty）→ faulty：确认死亡。 */
  function dead(id) {
    const m = members.get(String(id)); if (!m) return { changed: false, state: null }
    if (m.state === 'faulty') return { changed: false, state: 'faulty', incarnation: m.incarnation }
    m.state = 'faulty'; m.suspectAt = null; m.incarnation++; counters.confirmations++
    return { changed: true, state: 'faulty', incarnation: m.incarnation }
  }

  /**
   * 间接探测：先直接 ping，失败再请中继代 ping；任一 ACK 即反证存活（SWIM 降误判核心），否则标 suspected。
   * @param {string} id 目标
   * @param {string[]} [relays] 中继候选（不含目标）
   * @param {(target:string, kind:'direct'|'indirect', relay?:string)=>boolean} [probeFn] 注入探针，缺省直接失败
   */
  function probeIndirect(id, relays, probeFn, t) {
    counters.probes++
    const ping = typeof probeFn === 'function' ? probeFn : () => false
    if (ping(String(id), 'direct')) return { target: String(id), alive: true, via: 'direct', attempts: 1 }
    counters.directFailures++
    const list = (Array.isArray(relays) ? relays : []).filter((r) => String(r) !== String(id)).slice(0, retransmitLimit)
    let attempts = 1
    for (const relay of list) {
      attempts++; counters.indirectAttempts++
      if (ping(String(id), 'indirect', relay)) {
        counters.indirectRescues++
        const r = alive(id, t)
        return { target: String(id), alive: true, via: 'indirect', relay: String(relay), attempts, refuted: r.changed }
      }
    }
    const r = suspect(id, t)
    return { target: String(id), alive: false, via: 'suspected', attempts, suspected: r.changed }
  }

  /** 旧 gossip 覆盖不了新状态：仅当 incarnation 更大才接受（相等视为陈旧）。 */
  function applyGossip(update, t) {
    const key = String(update?.id ?? '')
    if (!key) return { applied: false, reason: 'no_id' }
    const inc = Number.isFinite(update.incarnation) ? Math.floor(update.incarnation) : 0
    const st = SWIM_STATES.includes(update.state) ? update.state : 'alive'
    const m = members.get(key)
    if (!m) {
      members.set(key, { id: key, state: st, incarnation: inc, suspectAt: st === 'suspected' ? timeOr(t, now) : null, addedAt: timeOr(t, now) })
      counters.gossipsApplied++
      return { applied: true, state: st, incarnation: inc }
    }
    if (inc <= m.incarnation) { counters.gossipsStale++; return { applied: false, reason: 'stale_incarnation', incarnation: m.incarnation } }
    m.state = st; m.incarnation = inc; m.suspectAt = st === 'suspected' ? timeOr(t, now) : null
    counters.gossipsApplied++
    return { applied: true, state: st, incarnation: inc }
  }

  /** 扫描 suspected：撑过怀疑超时仍未反证者确认死亡，返回被判死 id 列表。 */
  function reap(t) {
    const tt = timeOr(t, now)
    const killed = []
    for (const m of members.values()) {
      if (m.state === 'suspected' && m.suspectAt !== null && tt - m.suspectAt >= suspicionTimeoutMs) {
        const r = dead(m.id); if (r.changed) killed.push(m.id)
      }
    }
    return killed
  }

  /** 随机挑一只非 faulty 成员做探针目标（注入 rand ⇒ 确定性）；无候选回 null。 */
  function pickTarget() {
    const pool = [...members.values()].filter((m) => m.state !== 'faulty')
    if (!pool.length) return null
    const r = rand()
    const idx = Math.min(pool.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * pool.length)))
    return pool[idx].id
  }

  function states() { return [...members.values()].map((m) => ({ id: m.id, state: m.state, incarnation: m.incarnation, suspectAt: m.suspectAt })) }
  function counts() {
    const c = { alive: 0, suspected: 0, faulty: 0 }
    for (const m of members.values()) c[m.state]++
    return { ...c, total: members.size }
  }
  function stats() { return { ...counts(), ...counters, suspicionTimeoutMs, retransmitLimit } }
  function snapshot(t) { return { strategy: 'swim', suspicionTimeoutMs, probeIntervalMs, suspicionMult, ...stats(), members: states(), builtAt: timeOr(t, now) } }
  function reset() { members.clear(); for (const k of Object.keys(counters)) counters[k] = 0 }

  return {
    add, remove, has, state, suspect, alive, dead, probeIndirect, applyGossip, reap, pickTarget,
    states, counts, stats, snapshot, reset, suspicionTimeoutMs,
  }
}

/* ==================== ③ 健康视图缓存（φ + SWIM + KI-493 缓存） ==================== */

/**
 * 负载均衡可读的健康实例视图：把 SWIM 的 alive 状态与每节点的 φ 判定收敛成列表，
 * 用 KI-493 缓存做 TTL 命中（同 key 高频读不重算），成员变更时主动失效。
 * @param {object} [opts] { membership?, threshold?, minSamples?, minStdDeviationMs?, windowSize?, ttlMs?, now?, key? }
 */
export function createHealthView(opts = {}) {
  const now = clockOf(opts)
  const membership = opts.membership ?? createSwimMembership({ now })
  const threshold = Math.max(0, Number(opts.threshold ?? FD_DEFAULTS.threshold))
  const ttlMs = Math.max(0, Number(opts.ttlMs ?? FD_DEFAULTS.healthTtlMs))
  const key = String(opts.key ?? 'caesura:healthy')
  const cache = opts.cache ?? createRedisCache({ now })
  const phiCfg = {
    threshold, minSamples: opts.minSamples, minStdDeviationMs: opts.minStdDeviationMs,
    windowSize: opts.windowSize, now,
  }
  /** @type {Map<string, ReturnType<typeof createPhiAccrualDetector>>} */
  const detectors = new Map()
  const counters = { computed: 0, invalidations: 0, lastNodes: 0 }

  function detectorFor(id) {
    const k = String(id)
    if (!detectors.has(k)) detectors.set(k, createPhiAccrualDetector(phiCfg))
    return detectors.get(k)
  }
  /** 给某节点记一次心跳（喂它自己的 φ 检测器）。 */
  function heartbeat(id, t) { return detectorFor(id).heartbeat(t) }
  /** 该节点当前 φ（无心跳流回 null，交给 SWIM 状态裁决）。 */
  function phiOf(id, t) { return detectors.has(String(id)) ? detectors.get(String(id)).phi(t) : null }

  /** 取健康实例列表；TTL 内命中缓存不再扫成员表/重算 φ。 */
  function getHealthy(t) {
    const tt = timeOr(t, now)
    const hit = cache.get(key)
    if (hit !== undefined) return { nodes: [...hit.nodes], computedAt: hit.computedAt, fromCache: true, phi: { ...hit.phi } }
    counters.computed++
    const aliveIds = membership.states().filter((s) => s.state === 'alive').map((s) => s.id)
    const phi = {}
    const nodes = aliveIds.filter((id) => {
      const p = phiOf(id, tt)
      phi[id] = p
      // 没心跳流的节点交给 SWIM alive 状态裁定，不因「缺 φ」误杀；有流则 φ 越阈剔除。
      return p === null || p < threshold
    })
    const value = { nodes: [...nodes], computedAt: tt, phi }
    cache.set(key, value, ttlMs)
    counters.lastNodes = nodes.length
    return { nodes: [...nodes], computedAt: tt, fromCache: false, phi: { ...phi } }
  }

  /** 成员拓扑变更时主动失效（用 RESP DEL，绕开 set(undefined) 的语义坑）。 */
  function invalidate() { cache.command('DEL', key); counters.invalidations++; return true }

  function stats() { return { ...counters, cache: cache.stats(), ttlMs, key } }
  function snapshot(t) {
    const h = getHealthy(t)
    return { strategy: 'healthView', nodes: h.nodes, fromCache: h.fromCache, phi: h.phi, ...stats(), builtAt: timeOr(t, now) }
  }
  function reset() { detectors.clear(); cache.reset(); counters.computed = 0; counters.invalidations = 0; counters.lastNodes = 0 }

  return { getHealthy, heartbeat, phiOf, invalidate, stats, snapshot, reset, detectors, get size() { return detectors.size } }
}

/* ==================== ④ 固定超时 vs φ 对照证据 ==================== */

/** 确定性 LCG（注入 rand 的缺省实现），让轨迹与 CLI 逐字节可复现。 */
function lcg(seed) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
}

/**
 * 默认心跳轨迹：stableCount 个 ~baseInterval 的正常间隔，其中穿插 spikeCount 次 GC 长暂停
 * （spikeGapMs，> fixedTimeoutMs ⇒ 固定超时误报），末位追加一条 label='fault' 的真故障观测窗。
 * @returns {{intervals:number[], labels:string[], spikes:number}}
 */
export function defaultTrace(opts = {}) {
  const stableCount = Math.max(6, Math.floor(Number(opts.stableCount ?? FD_DEFAULTS.stableCount)))
  const base = Math.max(1, Number(opts.baseIntervalMs ?? FD_DEFAULTS.baseIntervalMs))
  const spikeGap = Math.max(base, Number(opts.spikeGapMs ?? FD_DEFAULTS.spikeGapMs))
  const spikeCount = Math.max(1, Math.floor(Number(opts.spikeCount ?? FD_DEFAULTS.spikeCount)))
  const faultCap = Math.max(spikeGap, Number(opts.faultCapMs ?? FD_DEFAULTS.faultCapMs))
  const rand = lcg(1979)
  const intervals = []
  const labels = []
  // 均匀撒 spikeCount 个长暂停（错开，不挨着），其余为 base±6% 抖动。
  const spikeAt = new Set()
  for (let k = 0; k < spikeCount; k++) {
    let idx = Math.floor((k + 1) * stableCount / (spikeCount + 1))
    while (spikeAt.has(idx)) idx++
    spikeAt.add(idx)
  }
  for (let i = 0; i < stableCount; i++) {
    const isSpike = spikeAt.has(i)
    intervals.push(isSpike ? spikeGap : base * (0.94 + 0.12 * rand()))
    labels.push(isSpike ? 'jitter' : 'normal')
  }
  intervals.push(faultCap); labels.push('fault')
  return { intervals, labels, spikes: spikeCount }
}

/**
 * 核心对照证据：同一条轨迹喂固定超时与 φ，数误报/真报、测真故障检测延迟，做自适应对照。
 * @param {object} [opts] { intervals?, labels?, threshold?, minSamples?, minStdDeviationMs?, windowSize?,
 *   fixedTimeoutMs?, faultCapMs?, stepMs?, now? }
 */
export function compareFixedVsPhi(opts = {}) {
  const threshold = Math.max(0, Number(opts.threshold ?? FD_DEFAULTS.threshold))
  const minSamples = Math.max(1, Math.floor(Number(opts.minSamples ?? FD_DEFAULTS.minSamples)))
  const minStdDeviationMs = Math.max(0, Number(opts.minStdDeviationMs ?? FD_DEFAULTS.minStdDeviationMs))
  const windowSize = Math.max(2, Math.floor(Number(opts.windowSize ?? FD_DEFAULTS.windowSize)))
  const fixedTimeoutMs = Math.max(1, Number(opts.fixedTimeoutMs ?? FD_DEFAULTS.fixedTimeoutMs))
  const faultCapMs = Math.max(1, Number(opts.faultCapMs ?? FD_DEFAULTS.faultCapMs))
  const stepMs = Math.max(1, Number(opts.stepMs ?? FD_DEFAULTS.stepMs))
  const trace = (Array.isArray(opts.intervals) && opts.intervals.length)
    ? { intervals: opts.intervals.map(Number).filter(Number.isFinite), labels: Array.isArray(opts.labels) ? opts.labels : [], spikes: (opts.labels ?? []).filter((x) => x === 'jitter').length }
    : defaultTrace(opts)

  const det = createPhiAccrualDetector({ threshold, minSamples, minStdDeviationMs, windowSize, now: () => 0 })
  let t = 0
  const decisions = []
  const fixed = { timeoutMs: fixedTimeoutMs, falsePositives: 0, truePositives: 0 }
  const phi = { threshold, falsePositives: 0, truePositives: 0, maxPhi: 0 }

  for (let i = 0; i < trace.intervals.length; i++) {
    const gap = trace.intervals[i]
    const label = trace.labels[i] ?? 'normal'
    if (label === 'fault') break // 真故障另行按「停止心跳后探测」测延迟，不把观测窗当间隔喂进去
    if (i === 0) { det.heartbeat(t); decisions.push({ i, gap: round4(gap), label, phi: 0, fixedSuspect: false, phiSuspect: false }); continue }
    t += gap
    const p = det.phi(t)
    const fs = gap > fixedTimeoutMs
    const ps = p >= threshold
    // jitter 也是「节点其实活着」⇒ 判 suspect 算误报；normal 同理。
    if (fs) fixed.falsePositives++
    if (ps) phi.falsePositives++
    if (p > phi.maxPhi) phi.maxPhi = p
    decisions.push({ i, gap: round4(gap), label, phi: p, fixedSuspect: fs, phiSuspect: ps })
    det.heartbeat(t)
  }

  // 真故障：从最后一条正常心跳起停止喂，按 step 推进 now，测两者各自多久越阈。
  let fixedDetectionMs = null
  let phiDetectionMs = null
  for (let d = stepMs; d <= faultCapMs; d += stepMs) {
    if (fixedDetectionMs === null && d > fixedTimeoutMs) fixedDetectionMs = d
    if (phiDetectionMs === null && det.phi(t + d) >= threshold) phiDetectionMs = d
    if (fixedDetectionMs !== null && phiDetectionMs !== null) break
  }
  fixed.detectionLatencyMs = fixedDetectionMs
  fixed.truePositives = fixedDetectionMs === null ? 0 : 1
  phi.detectionLatencyMs = phiDetectionMs
  phi.truePositives = phiDetectionMs === null ? 0 : 1
  phi.maxPhi = round4(phi.maxPhi)

  // 自适应对照：同一段 260ms 延迟，喂给「规律历史」与「本就抖动的历史」，看 φ 是否更宽容。
  const probeDelay = Math.max(fixedTimeoutMs + 10, FD_DEFAULTS.baseIntervalMs * 2.6)
  const steady = createPhiAccrualDetector({ threshold, minSamples, minStdDeviationMs, windowSize, now: () => 0 })
  // 抖动历史用更大的 σ（间隔在 40..400 之间交替），让 stddev 真正高于 minStdDeviationMs 才有区分度。
  const jittery = createPhiAccrualDetector({ threshold, minSamples, minStdDeviationMs: 20, windowSize, now: () => 0 })
  let ts = 0, tj = 0
  for (let k = 0; k < windowSize; k++) { ts += FD_DEFAULTS.baseIntervalMs; steady.heartbeat(ts) }
  for (let k = 0; k < windowSize; k++) { tj += (k % 2 === 0 ? 40 : 400); jittery.heartbeat(tj) }
  const steadyPhi = steady.phi(ts + probeDelay)
  const jitteryPhi = jittery.phi(tj + probeDelay)
  const adaptation = {
    delayMs: round4(probeDelay), steadyPhi, jitteryPhi,
    jitteryMoreTolerant: jitteryPhi < steadyPhi,
    steadyMean: steady.mean, steadyStddev: steady.stddev,
    jitteryMean: jittery.mean, jitteryStddev: jittery.stddev,
  }

  const verdict = {
    fixedOverReactsToJitter: fixed.falsePositives > phi.falsePositives,
    phiReducesFalsePositives: phi.falsePositives <= fixed.falsePositives,
    bothDetectRealFailure: fixedDetectionMs !== null && phiDetectionMs !== null,
    fixedFasterButNoisier: fixedDetectionMs !== null && phiDetectionMs !== null && fixedDetectionMs < phiDetectionMs && fixed.falsePositives > phi.falsePositives,
    phiAdaptiveToHistory: adaptation.jitteryMoreTolerant,
    phiNeverExceedsCap: decisions.every((d) => d.phi <= 100),
  }

  return {
    trace: { count: trace.intervals.length, spikes: trace.spikes, faultCapMs, labels: [...trace.labels] },
    fixed, phi: { ...phi, cap: 100 }, adaptation, verdict, decisions,
  }
}

/* ==================== ⑤ 汇总 + 纯数据快照 ==================== */

/**
 * 真跑「固定 vs φ 对照 + 一段 SWIM 脚本 + 健康视图缓存读数」汇成纯数据 study。
 * 全注入确定性时钟/探针，无真 socket、无墙钟依赖。
 * @param {object} [opts] { now?, compare?, swim?, health? }
 */
export async function failureDetectorStudy(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => 0
  const comparison = compareFixedVsPhi({ ...(opts.compare ?? {}), now })
  const cfg = opts.swim ?? {}

  // SWIM 脚本：a 直接存活；b 直接失败→间接救回；c 全失败→suspect→reap 确认；d suspect 后被 gossip 反证。
  const sw = createSwimMembership({ now, probeIntervalMs: cfg.probeIntervalMs, suspicionMult: cfg.suspicionMult, retransmitLimit: cfg.retransmitLimit ?? 3 })
  for (const id of ['gate-a', 'gate-b', 'gate-c', 'gate-d']) sw.add(id, 0, 0)
  const a = sw.probeIndirect('gate-a', [], (id, kind) => kind === 'direct', 0)
  const b = sw.probeIndirect('gate-b', ['gate-c', 'gate-d'], (id, kind) => kind === 'indirect', 0)
  const c = sw.probeIndirect('gate-c', ['gate-a'], () => false, 1000)
  const dSuspect = sw.suspect('gate-d', 1000)
  // d 的反证 gossip 带更高 incarnation ⇒ 覆盖之前那条 suspicion。
  const dGossip = sw.applyGossip({ id: 'gate-d', state: 'alive', incarnation: (sw.state('gate-d')?.incarnation ?? 0) + 1 }, 1200)
  const killed = sw.reap(1000 + sw.suspicionTimeoutMs)
  const swim = {
    ...sw.snapshot(now()),
    script: {
      directAlive: a.alive === true, indirectRescued: b.via === 'indirect' && b.alive === true,
      suspectAfterTotalFailure: c.via === 'suspected' && c.alive === false,
      gossipRefuted: dSuspect.changed && dGossip.applied && sw.state('gate-d')?.state === 'alive',
      reaped: killed,
    },
  }

  // 健康视图：给仍 alive 的三只节点喂稳定心跳，getHealthy 一次 miss + 一次 TTL hit，再 invalidate 后重算。
  const hv = createHealthView({ membership: sw, now, threshold: comparison.phi.threshold, ttlMs: opts.health?.ttlMs ?? FD_DEFAULTS.healthTtlMs })
  for (const id of ['gate-a', 'gate-b', 'gate-d']) for (let i = 0; i < 10; i++) hv.heartbeat(id, i * 100)
  const first = hv.getHealthy(950)
  const second = hv.getHealthy(960)
  hv.invalidate()
  const third = hv.getHealthy(970)
  const health = {
    firstNodes: first.nodes, firstFromCache: first.fromCache,
    secondFromCache: second.fromCache, thirdFromCache: third.fromCache,
    excluded: ['gate-c'], stats: hv.stats(),
  }

  return { comparison, swim, health, builtAt: now() }
}

/** 把 study 收敛成前端 / status 友好的纯数据快照（浮点 round、剥实现细节、数组有界）。 */
export function fdSnapshot(study) {
  const c = study.comparison
  const s = study.swim
  const h = study.health
  const pickDecision = (d) => ({ i: d.i, gap: d.gap, label: d.label, phi: d.phi, fixedSuspect: d.fixedSuspect, phiSuspect: d.phiSuspect })
  return {
    threshold: c.phi.threshold,
    fixedTimeoutMs: c.fixed.timeoutMs,
    fixed: {
      falsePositives: c.fixed.falsePositives, truePositives: c.fixed.truePositives,
      detectionLatencyMs: c.fixed.detectionLatencyMs,
    },
    phi: {
      falsePositives: c.phi.falsePositives, truePositives: c.phi.truePositives,
      detectionLatencyMs: c.phi.detectionLatencyMs, maxPhi: c.phi.maxPhi, cap: c.phi.cap,
    },
    adaptation: { ...c.adaptation },
    verdict: { ...c.verdict },
    curve: c.decisions.map(pickDecision),
    swim: {
      counts: { alive: s.alive, suspected: s.suspected, faulty: s.faulty, total: s.total },
      probes: s.probes, indirectRescues: s.indirectRescues, refutations: s.refutations,
      confirmations: s.confirmations, gossipsApplied: s.gossipsApplied, gossipsStale: s.gossipsStale,
      suspicionTimeoutMs: s.suspicionTimeoutMs, script: { ...s.script, reaped: [...s.script.reaped] },
      members: s.members,
    },
    health: {
      nodes: [...h.firstNodes], excluded: [...h.excluded],
      firstFromCache: h.firstFromCache, secondFromCache: h.secondFromCache, thirdFromCache: h.thirdFromCache,
      computed: h.stats.computed, invalidations: h.stats.invalidations, hitRate: round4(h.stats.cache.hitRate), ttlMs: h.stats.ttlMs,
    },
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  failureDetectorStudy().then((s) => {
    console.log(JSON.stringify(fdSnapshot(s), null, 2))
    process.exit(0)
  }).catch((e) => { console.error(`[detect] 生成失败：${e.message}`); process.exit(1) })
}
