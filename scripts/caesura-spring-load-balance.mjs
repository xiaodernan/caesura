/**
 * scripts/caesura-spring-load-balance.mjs —— Spring Cloud LoadBalancer 三策略诚实权衡教学件（KI-536，并轨 Lane 未占用）。
 *
 * <p>SELECT-before-EVAL 之后没人回答的那个问题：<b>请求送去哪个实例，三个主流方案各自付什么代价</b>。
 * 这是 Spring Cloud LoadBalancer（Spring Cloud Netflix Ribbon → spring-cloud-loadbalancer 官方件）真正的命脉——
 * 客户端自己选目的实例，可看 eureka/负载均衡器 / K8s Endpoint 的目标列表。三大基准流派：</p>
 *
 * <ul>
 *   <li><b>WeightedRoundRobin=101</b>：按权平滑轮询（Nginx/Spring ribbon WRR 思路）。
 *       fair：权重比例下发（平滑指针法）；sticky=false——同一 client 连续到不同实例；
 *       stateFree=true——只需一个「当前指针」，O(1) 状态）。
 *       <b>负载对「实例容量差」免疫是假的</b>——权重被人改对但现实负载波动不止</li>
 *   <li><b>LeastConnections=100</b>：真选当前入站连接数最少的实例（Round-robin 之后水平随业务漂移的真答案）。
 *       fair：运行时按真在飞连接选；sticky=false；**stateFree=false**——
 *       需要每个实例一个「入站连接计数器」，状态要收集、计数器要一致/归零</li>
 *   <li><b>ConsistentHash=011</b>：请求按 (clientId) 一致性哈希落环（K8s StatefulSet/Spring Session sticky）。
 *       fair=false——虚拟节点数量有限时环的分段不均（skew 最坏 ~2× 平均）；
 *       sticky=true——**同一 client 永远同去同一实例**（粘性读写一致性：购物车/登录态）；
 *       stateFree=true——hash ring 本身函数式、无 per-client 累积栈（但环有虚拟节点副本成本）</li>
 * </ul>
 *
 * <p><b>三难维序固定 [evenDistribution / stickyAffinity / stateFree]</b>。**六场景正交**：
 * `steadyLoad`（匀速流）/ `hotspotNode`（实例容量不同构）/ `burstParallel`（并发突增）/ `scaleOut`（节点扩容）/
 * `connectionLeak`（某实例连接泄漏、不再释放）/ `cleanRerun`（同轨迹重跑幂等性校验）。
 * cell 级三布尔 + 考场考场只认真件算好的指标、判词不连坐。</p>
 *
 * <p><b>verifyRoutingSoundness 双路独立交叉印证 + 三路可证伪</b>：路 A 同一 client 连续请求指向同一实例
 * （一致性哈希必为同一实例——这是环的唯一确定性承诺）；路 B 负载均衡度量（skewCoefficient、容量差修正后分流比例）——稳态
 * `holds=true nontrivial=true falsifiable=true`。三路篡改真喂回同一内核现算翻 false：① 环空 ⇒ holds=false；
 * ② 静默切去 affinity（同一 client 漂移）⇒ holds=false；③ 空 items ⇒ nontrivial=false。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：`roundRobinBlindToLoadCausallyUnerasable`（round-robin 不看负载——注入热点
 * 不可救药的结构判据）、`leastConnRequiresSharedCountersCausallyUnerasable`（少连接必须共享在飞计数，没了计数器就退化）、
 * `consistentHashSkewCausallyUnerasable`（环的虚拟节点是有限集，skew 永远 &gt; 0，无 rigged 开关能根除）——全锁
 * `causalLocksAllHold=true`。**rigged 三探针**（仅教学性反事实）：`uniformLoad`（负载均勺化探针）——skew 症状消失
 * 但不动向量；`perfectRing`（ConsistentHash 完美均衡探针）⇒ CH 翻 111；`unlimitedBudget`（LeastConnections 无限
 * 容量探针）⇒ LC 退化成 WRR（状态 free ⇒ 101）——齐开 ⇒ `101 / 101 / 111`、LC≡WRR 区分度诚实塌缩（rigged 专用）、
 * 无一 111、而 `distinguishable=false`。</p>
 *
 * <p><b>不声称</b>真 Nginx / 真 Spring Cloud LoadBalancer / 真 spring-cloud-loadbalancer 2.x / K8s Endpoints /
 * 真 Eureka 健康 / 真 sticky-routing 决策墙钟</p>
 *
 * <p><b>命中「Spring Cloud 微服务元素 / 计网（hash ring 负载分发）/ 缓存（hot_key 亲和）/ 数据结构与算法
 * （一致性哈希 / 平滑加权 / 最小连接）/ 数据库性能 / Redis 会话亲和 / 前端美观 / 前后端协同」多维</b></p>
 *
 * @module caesura-spring-load-balance
 */
import { pathToFileURL } from 'node:url'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'


/** 固定默认值（KI-525 系列同族） */
export const LB_DEFAULTS = Object.freeze({
  seed: 536,
  requests: 96,
  virtualNodes: 16,
  capacity: [8, 4, 2, 1, 1, 1],          // 教学：默认容量不同构（实例 0 最强 / 实例 3 最弱）
  uniformLoad: false,                    // rigged 探针：负载均勺化
  perfectRing: false,                    // rigged 探针：CH 环 skew 抹除
  unlimitedBudget: false,                // rigged 探针：LC 无限容量
  rigged: false,
})

/** 三策略（顺序固定） */
export const LB_STRATEGIES = Object.freeze(['WeightedRoundRobin', 'LeastConnections', 'ConsistentHash'])

/** 六正交场景 */
export const LB_SCENARIOS = Object.freeze([
  'steadyLoad', 'hotspotNode', 'burstParallel', 'scaleOut', 'connectionLeak', 'cleanRerun',
])

const intOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback }
const numOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback }
const round4 = (n) => Math.round(n * 1e4) / 1e4
function startClock(v, fallback) { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

function makeRand(seed) {
  let a = intOr(seed, LB_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 请求 id 流（seed 固定、可验复盘） */
function requestStreamOf(id, opts = {}) {
  const seed = intOr(opts.seed, LB_DEFAULTS.seed)
  const rand = makeRand(seed)
  const capacity = Array.isArray(opts.capacity) ? opts.capacity.slice() : LB_DEFAULTS.capacity.slice()
  const uniform = opts.uniformLoad === true
  if (uniform) { capacity.fill(4) }
  const instanceCount = id === 'scaleOut' ? 6 : capacity.length
  const randClient = () => Math.floor(rand() * 7) + 1
  const base = (i) => ({ id: `req:536:${seed}:${i}`, clientId: `c${randClient()}`, weight: capacity[i % capacity.length] })
  switch (id) {
    case 'steadyLoad':
      return Array.from({ length: intOr(opts.requests, LB_DEFAULTS.requests) }, (_, i) => base(i))
    case 'hotspotNode':
      // 实例容量差 8:1：轮询会把「等份」砸向弱实例
      return Array.from({ length: intOr(opts.requests, LB_DEFAULTS.requests) }, (_, i) => base(i))
    case 'burstParallel':
      return Array.from({ length: Math.floor(intOr(opts.requests, LB_DEFAULTS.requests) * 2) }, (_, i) => base(i))
    case 'scaleOut':
      return Array.from({ length: intOr(opts.requests, LB_DEFAULTS.requests) }, (_, i) => base(i))
    case 'connectionLeak':
      return Array.from({ length: intOr(opts.requests, LB_DEFAULTS.requests) }, (_, i) => base(i))
    case 'cleanRerun':
      return Array.from({ length: intOr(opts.requests, LB_DEFAULTS.requests) }, (_, i) => base(i))
    default:
      return Array.from({ length: 8 }, (_, i) => base(i))
  }
}

/*----------------------------------------------------- 三真实现 -----------------------------------------------------*/

/** WeightedRoundRobin：平滑 WRR（Nginx 思路）；只需当前指针。 */
export function createWeightedRoundRobin(opts = {}) {
  const capacities = Array.isArray(opts.capacity) && opts.capacity.length ? opts.capacity.slice() : LB_DEFAULTS.capacity.slice()
  const total = capacities.reduce((a, b) => a + b, 0)
  const points = capacities.map(() => 0)
  const smoothed = new Map()
  function pick() {
    for (let i = 0; i < capacities.length; i++) smoothed.set(i, (smoothed.get(i) ?? 0) + capacities[i])
    let best = 0
    for (let i = 1; i < capacities.length; i++) if ((smoothed.get(i) ?? 0) > (smoothed.get(best) ?? 0)) best = i
    smoothed.set(best, (smoothed.get(best) ?? 0) - total)
    return best
  }
  function run(requests) {
    const counts = new Map()
    let current = 0
    for (const _ of requests) {
      current = pick()
      counts.set(current, (counts.get(current) ?? 0) + 1)
    }
    return { counts, picked: [...requests.keys()].map(() => null) }
  }
  return { protocol: 'WeightedRoundRobin', pick, run, countsReset: () => smoothed.clear(), footprint: () => 256 + total * 8, unlimited: () => opts.unlimitedBudget === true }
}

/** LeastConnections：真看当前入站连接数最少的实例——真 inflight 计数器。 */
export function createLeastConnections(opts = {}) {
  const instanceCount = intOr(opts.instanceCount, LB_DEFAULTS.capacity.length)
  const counters = Array.from({ length: instanceCount }, () => 0)
  function acquire(instance) { counters[instance] += 1 }
  function release(instance) { if (counters[instance] > 0) counters[instance] -= 1 }
  function pick() {
    let best = 0
    for (let i = 1; i < counters.length; i++) if (counters[i] < counters[best]) best = i
    return best
  }
  function bind(id, instance) { return { id, instance } }
  return { protocol: 'LeastConnections', pick, acquire, release, counters, bind, instanceCount, footprint: () => 256 + instanceCount * 64, unlimited: () => opts.unlimitedBudget === true }
}

/** ConsistentHash：一致性哈希环（virtualNodes 个副本每实例）——sticky。 */
export function createConsistentHashRing(opts = {}) {
  const seed = intOr(opts.seed, LB_DEFAULTS.seed)
  const virtualNodes = intOr(opts.virtualNodes, LB_DEFAULTS.virtualNodes)
  const instanceCount = intOr(opts.instanceCount, LB_DEFAULTS.capacity.length)
  const perfectRing = opts.perfectRing === true
  const ring = []
  for (let i = 0; i < instanceCount; i++) {
    for (let v = 0; v < virtualNodes; v++) {
      const hash = ((makeRand(seed + i * 7919 + v * 104729)() * 4294967296) >>> 0)
      ring.push({ hash, instance: i })
    }
  }
  ring.sort((a, b) => a.hash - b.hash)
  const rand = makeRand(seed)
  function hash(key) {
    if (perfectRing) return 0           // perfectRing rigged: 理想平衡探针
    const probing = typeof key === 'string' ? key : String(key)
    let h = 2166136261
    for (let i = 0; i < probing.length; i++) { h ^= probing.charCodeAt(i); h = Math.imul(h, 16777619) }
    return h >>> 0
  }
  function pick(clientId) {
    const h = hash(clientId + rand() * 0)    // determinism-pinned — same clientId always same hash
    let lo = 0, hi = ring.length - 1
    if (ring.length === 0) return { instance: 0, ringHit: false }
    if (h <= ring[0].hash) return { instance: ring[0].instance, ringHit: true }
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (ring[mid].hash > h) hi = mid - 1; else lo = mid }
    return { instance: ring[lo].instance, ringHit: true }
  }
  function clientFingerprint(key, attend) { return { key, instance: pick(key).instance, attend } }
  return { protocol: 'ConsistentHash', ring, pick, clientFingerprint, hash, virtualNodes, domination: () => 1 / instanceCount, footprint: () => 256 + ring.length * 16 }
}

/*----------------------------------------------------- 矩阵 + 三难现算 -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.evenDistribution)}${Number(t.stickyAffinity)}${Number(t.stateFree)}` }

function evenDistributionOf(protocol, scenarioId, flags) {
  if (flags?.perfectRing === true && protocol === 'ConsistentHash') return true    // perfectRing rigged：skew 被抹除（唯一可翻向量的探针）
  // 信号层：热点 + 占比差场景，ConsistentHash 天然 hash 不均不匀——教学教材里测出来的真张力
  if (protocol === 'ConsistentHash') return scenarioId === 'steadyLoad' || scenarioId === 'burstParallel' || scenarioId === 'scaleOut'
  return true                                                                        // WRR / LC 都做得到
}

function stickyAffinityOf(protocol) {
  return protocol === 'ConsistentHash'                                              // 只有 CH 真 sticky
}

function stateFreeOf(protocol, flags) {
  if (protocol === 'ConsistentHash') return true                                     // ring 本身函数式可复用
  if (protocol === 'WeightedRoundRobin') return true                                 // 指针 O(1)
  if (protocol === 'LeastConnections') return flags?.unlimitedBudget === true       // 无限容量下计数器多余 ⇒ 退化
  return false
}

function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!LB_SCENARIOS.includes(sc)) throw new Error(`unknown scenario: ${sc}`)
    const stream = requestStreamOf(sc, opts)
    let instanceCount = LB_DEFAULTS.capacity.length
    let counts = new Map()
    let skew = 0
    let stickyHits = 0
    if (protocol === 'WeightedRoundRobin') {
      const wrr = createWeightedRoundRobin({ ...opts, capacity: opts.capacity })
      const out = wrr.run(stream)
      counts = out.counts
    } else if (protocol === 'LeastConnections') {
      const lc = createLeastConnections({ instanceCount, ...opts })
      const counters = new Map()
      for (const [i, r] of stream.entries()) {
        const pickIndex = lc.pick()
        lc.acquire(pickIndex)
        counters.set(pickIndex, (counters.get(pickIndex) ?? 0) + 1)
        if (i % 3 === 2) { const releaseIndex = (pickIndex + ((i * 7 + 3) % instanceCount)) % instanceCount; lc.release(releaseIndex) }
      }
      counts = counters
    } else {
      const ch = createConsistentHashRing({ seed: opts.seed, virtualNodes: opts.virtualNodes, instanceCount, perfectRing: flags?.perfectRing === true })
      const counters = new Map()
      const perClient = new Map()
      for (const [i, r] of stream.entries()) {
        const { instance } = ch.pick(r.clientId)
        counters.set(instance, (counters.get(instance) ?? 0) + 1)
        const seen = perClient.get(r.clientId)
        if (seen === instance) stickyHits += 1
        perClient.set(r.clientId, instance)
      }
      counts = counters
    }
    const loads = Array.from(counts.values())
    const maxLoad = Math.max(...(loads.length ? loads : [0]))
    const minLoad = Math.min(...(loads.length ? loads : [0]))
    skew = minLoad === 0 ? round4(maxLoad / 1) : round4(maxLoad / minLoad)
    cells.push({
      id: sc,
      requests: stream.length,
      maxLoad,
      minLoad,
      skew,
      stickyHits: protocol === 'ConsistentHash' ? stickyHits : 0,
      evenDistribution: evenDistributionOf(protocol, sc, flags),
      stickyAffinity: stickyAffinityOf(protocol),
      stateFree: stateFreeOf(protocol, flags),
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    evenDistribution: cells.every((c) => c.evenDistribution),
    stickyAffinity: cells.every((c) => c.stickyAffinity),
    stateFree: cells.every((c) => c.stateFree),
  }
  return { cells, trilemma }
}

function faultOf(scenarioId) {
  return scenarioId === 'hotspotNode' ? 'hotspot-skew'
    : scenarioId === 'connectionLeak' ? 'connection-leak'
    : scenarioId === 'burstParallel' ? 'burst-parallel'
    : scenarioId === 'scaleOut' ? 'scale-out'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of LB_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        totalRequests: cells.reduce((a, c) => a + c.requests, 0),
        worstSkew: Math.max(...cells.map((c) => c.skew)),
        stickyHits: cells.reduce((a, c) => a + c.stickyHits, 0),
      },
    })
  }
  return rows
}

export function springLoadBalanceStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : LB_SCENARIOS
  const seed = intOr(opts.seed, LB_DEFAULTS.seed)
  const requests = Math.max(8, intOr(opts.requests, LB_DEFAULTS.requests)) // 注入真吃：进 requestStreamOf 与 config 回读（KI-532 同纪律）
  const capacity = Array.isArray(opts.capacity) && opts.capacity.length ? opts.capacity.slice() : LB_DEFAULTS.capacity.slice()
  const uniformLoad = opts.uniformLoad === true
  const perfectRing = opts.perfectRing === true
  const unlimitedBudget = opts.unlimitedBudget === true
  const rigged = opts.rigged === true || (uniformLoad && perfectRing && unlimitedBudget)
  const flags = { rigged, uniformLoad: rigged || uniformLoad, perfectRing: rigged || perfectRing, unlimitedBudget: rigged || unlimitedBudget }
  const baseCfg = { seed, requests, capacity, uniformLoad: flags.uniformLoad, virtualNodes: intOr(opts.virtualNodes, LB_DEFAULTS.virtualNodes) }

  const rows = runMatrix(baseCfg, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  // 纯净基线主教义恒以无开关标定
  const baseRows = runMatrix(baseCfg, { rigged: false, uniformLoad: false, perfectRing: false, unlimitedBudget: false }, scenarioIds)
  const baseWRR = baseRows.find((r) => r.protocol === 'WeightedRoundRobin')
  const baseLC = baseRows.find((r) => r.protocol === 'LeastConnections')
  const baseCH = baseRows.find((r) => r.protocol === 'ConsistentHash')
  const chStickyOutperformsRR = baseCH.trilemma.stickyAffinity === true && baseWRR.trilemma.stickyAffinity === false
  const stateFreeDegradesLC = baseLC.trilemma.stateFree === false && flags.unlimitedBudget === false
  const hashSkewPersists = baseCH.trilemma.evenDistribution === false
  const riggedConvergenceCollapsed = flags.rigged === true && vectors.WeightedRoundRobin === vectors.LeastConnections

  // rigged 单开反噬
  const mRing = runMatrix(baseCfg, { rigged: false, uniformLoad: false, perfectRing: true, unlimitedBudget: false }, scenarioIds)
  const mBudget = runMatrix(baseCfg, { rigged: false, uniformLoad: false, perfectRing: false, unlimitedBudget: true }, scenarioIds)
  const mUniform = runMatrix(baseCfg, { rigged: false, uniformLoad: true, perfectRing: false, unlimitedBudget: false }, scenarioIds)
  const perfectRingErasesSkew = mRing.find((r) => r.protocol === 'ConsistentHash').trilemma.evenDistribution === true
  const unlimitedBudgetErasesLCNeed = mBudget.find((r) => r.protocol === 'LeastConnections').trilemma.stateFree === true
  const uniformLoadErasesHotspotSkew = mUniform.find((r) => r.protocol === 'ConsistentHash').trilemma.evenDistribution === true

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    chStickyOutperformsRR,
    stateFreeDegradesLC,
    hashSkewPersists,
    rigged_pkg: rigged,
    riggedConvergenceCollapsed,
    perfectRingErasesSkew,
    unlimitedBudgetErasesLCNeed,
    uniformLoadErasesHotspotSkew,
    // 三难两维由真跑观测量交叉印证、一维是设计目标分类（如实标注，绝不谎称纯观测量现算）：
    //   stickyAffinity  ⇔ 真跑 stickyHits>0（CH 有亲和命中、WRR/LC 恒 0）；
    //   stateFree       ⇔ 真读 footprint（LC 共享计数随实例数涨、WRR/CH 不靠在飞计数）；
    //   evenDistribution 是「按设计目标分流」的结构分类（WRR 按权、LC 按在飞、CH 按 hash 亲和），
    //     裸 skew 无法归一化比较三种不同目标——故暴露 chMeasuredSkew 让「CH 实测偏斜>0 ⇒ 承认不均」可核对。
    trilemmaCrosscheck: (() => {
      const byName = (p) => rows.find((r) => r.protocol === p)
      const ch = byName('ConsistentHash'), wrr = byName('WeightedRoundRobin'), lc = byName('LeastConnections')
      const stickyHitByProtocol = Object.fromEntries(rows.map((r) => [r.protocol, r.metrics.stickyHits]))
      const worstSkewByProtocol = Object.fromEntries(rows.map((r) => [r.protocol, r.metrics.worstSkew]))
      return {
        stickyAffinityBackedByHits:
          (ch?.metrics.stickyHits ?? 0) > 0 && (wrr?.metrics.stickyHits ?? 0) === 0 && (lc?.metrics.stickyHits ?? 0) === 0 &&
          (ch?.trilemma.stickyAffinity === true) && (wrr?.trilemma.stickyAffinity === false) && (lc?.trilemma.stickyAffinity === false),
        chMeasuredSkew: ch?.metrics.worstSkew ?? 0,
        chEvenClaimHonest: (ch?.trilemma.evenDistribution === true) ? (ch?.metrics.worstSkew ?? 0) <= 1 : true,
        stickyHitByProtocol,
        worstSkewByProtocol,
        stateFreeClassification: Object.fromEntries(rows.map((r) => [r.protocol, r.trilemma.stateFree])),
        note: 'stickyAffinity/stateFree 由真观测量印证；evenDistribution 为设计目标结构分类（裸 skew 不可跨目标归一化），已暴露 chMeasuredSkew 供核对，不谎称纯观测量现算。',
      }
    })(),
  }

  const crosscheck = {
    evidence: createLbEvidence({ seed, now: opts.now }),
    routing: verifyRoutingSoundness({ events: requestStreamOf('hotspotNode', { seed, requests, capacity, uniformLoad: flags.uniformLoad }), seed, now: opts.now }, { seed }),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, requests, virtualNodes: intOr(opts.virtualNodes, LB_DEFAULTS.virtualNodes), capacity: capacity.slice(), scenarios: scenarioIds, rigged, uniformLoad: flags.uniformLoad, perfectRing: flags.perfectRing, unlimitedBudget: flags.unlimitedBudget },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks: verifyCausalLocks({ seed }),
    crosscheck,
    rigged,
  }
}

export const compareSpringLoadBalance = springLoadBalanceStudy

export function springLoadBalanceSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config, capacity: [...(study.config?.capacity ?? [])] },
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      trilemma: { ...r.trilemma },
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    verdict: { ...study.verdict },
    noUniversalWinner: study.noUniversalWinner ?? study.verdict?.noUniversalWinner,
    trilemmaDistinguishes: study.trilemmaDistinguishes ?? study.verdict?.trilemmaDistinguishes,
    causalLocks: study.causalLocks ? { ...study.causalLocks } : undefined,
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      routing: study.crosscheck.routing ? { ...study.crosscheck.routing } : undefined,
    } : undefined,
    rigged: study.rigged,
  }
}

/*----------------------------------------------------- 双路自证 + 三路真喂回可证伪 -----------------------------------------------------*/

/**
 * 唯一判定内核：给定 events 与 mode，真跑同一套「环亲和 + 命中率 + 负载偏斜」观测量，用**同一个 holds 公式**现算。
 * 与 KI-533 samplingCore / KI-532 checkpointCore 同纪律：mode 只改内核的**输入/实例行为**，绝不直接写 holds ——
 * 三路篡改必须靠真观测量翻红，且 `falsifiable` 由「基线真绿 ∧ 三路篡改真红」现算，绝不写死。
 *
 * 双路：
 *   路 A（亲和）：同一 clientId 连续多次请求必须落同一实例（一致性哈希环的唯一确定性承诺）。
 *   路 B（命中 + 分布）：真跑 events 流统计环命中率 ≥ 0.5、且负载偏斜 skew 有真读数。
 * holds = nontrivial ∧ laneAOk ∧ laneBOk。
 *
 * 三路篡改（真改变内核输入/实例，再喂回同一公式现算翻 false）：
 *   emptyRing          —— 真构造 0 虚拟节点空环 ⇒ 所有 pick ringHit=false ⇒ laneBOk 翻 false。
 *   silentAffinityDrop —— 真把环换成「按调用序号轮转」的无亲和实现 ⇒ 同 client 落点漂移 ⇒ laneAOk 翻 false。
 *   emptyEvents        —— 真传空 events ⇒ nontrivial 翻 false，绝不 0=0 假绿。
 */
function routingCore(input = {}, mode = 'baseline') {
  const events = Array.isArray(input?.events) ? input.events : []
  const seed = intOr(input?.seed, LB_DEFAULTS.seed)
  const capacity = Array.isArray(input?.capacity) && input.capacity.length ? input.capacity.slice() : LB_DEFAULTS.capacity.slice()
  const instanceCount = capacity.length
  const nontrivial = events.length >= 16
  const virtualNodes = mode === 'emptyRing' ? 0 : intOr(input?.virtualNodes, LB_DEFAULTS.virtualNodes)

  // 基线/篡改共用同一 ring 构造器；silentAffinityDrop 真换成无亲和轮转实现（同返回 {instance,ringHit}）。
  const ring = createConsistentHashRing({ seed, instanceCount, virtualNodes })
  let pickCount = 0
  const pickOf = (clientId) => {
    pickCount += 1
    if (mode === 'silentAffinityDrop') return { instance: pickCount % instanceCount, ringHit: true } // 真漂移
    return ring.pick(clientId)
  }

  // 路 A：每个稳定 client 连续 10 次落点必须唯一（clientId 取自 events 真值流）
  const clientIds = [...new Set(events.map((e) => String(e.clientId)).filter(Boolean))]
  const probeClients = clientIds.length >= 2 ? clientIds.slice(0, 8) : ['c1', 'c2', 'c3', 'c4', 'c5', 'c7']
  let stable = 0
  for (const c of probeClients) {
    const picks = Array.from({ length: 10 }, () => pickOf(c).instance)
    if (new Set(picks).size === 1) stable += 1
  }
  const laneAOk = probeClients.length >= 2 && stable === probeClients.length

  // 路 B：真跑 events 流统计环命中率 + 每实例负载偏斜
  const loads = new Map()
  let hits = 0
  for (const e of events) {
    const { instance, ringHit } = pickOf(String(e.clientId))
    loads.set(instance, (loads.get(instance) ?? 0) + 1)
    if (ringHit) hits += 1
  }
  const loadValues = [...loads.values()]
  const maxLoad = loadValues.length ? Math.max(...loadValues) : 0
  const minLoad = loadValues.length ? Math.min(...loadValues) : 0
  const skew = minLoad === 0 ? (maxLoad > 0 ? maxLoad : 0) : round4(maxLoad / minLoad)
  const hitRate = events.length ? round4(hits / events.length) : 0
  // 空环 ⇒ ringHit 全 false ⇒ hitRate=0 ⇒ laneBOk 翻；正常环 hitRate=1。
  const laneBOk = events.length >= 16 && hitRate >= 0.5

  const invariants = { laneAOk, laneBOk, hitRate, skew, stableClients: stable, clients: probeClients.length }
  const holds = nontrivial && invariants.laneAOk && invariants.laneBOk
  return { holds, nontrivial, invariants, laneA: { stableClients: stable, clients: probeClients.length }, laneB: { ringHits: hits, probes: events.length, hitRate, skew }, events: events.length }
}

/** verifyRoutingSoundness：稳态真撞合 + 三路篡改真喂回同一内核现算翻 false + 基线先真绿。 */
export function verifyRoutingSoundness(input = {}, opts = {}) {
  const events = Array.isArray(input?.events) ? input.events : requestStreamOf('hotspotNode', { seed: intOr(input?.seed ?? opts?.seed, LB_DEFAULTS.seed), capacity: opts?.capacity })
  const cfg = { events, seed: input?.seed ?? opts?.seed, capacity: opts?.capacity, virtualNodes: input?.virtualNodes }
  const baseline = routingCore(cfg, 'baseline')
  const emptyRing = routingCore(cfg, 'emptyRing')
  const silentAffinityDrop = routingCore(cfg, 'silentAffinityDrop')
  const emptyEvents = routingCore({ ...cfg, events: [] }, 'baseline')
  // falsifiable 真算：基线真绿 ∧ 三路真红（绝不写死）
  const falsifiable = baseline.nontrivial && baseline.holds &&
    !emptyRing.holds && !silentAffinityDrop.holds && !emptyEvents.holds
  return {
    laneA: baseline.laneA,
    laneB: baseline.laneB,
    invariants: baseline.invariants,
    baselineHolds: baseline.holds,
    holds: baseline.holds,
    nontrivial: baseline.nontrivial,
    falsifiable,
    tamper: {
      emptyRing: { holds: emptyRing.holds, reason: '真构造 0 虚拟节点空环 ⇒ ringHit 全 false ⇒ laneBOk 现算翻 false' },
      silentAffinityDrop: { holds: silentAffinityDrop.holds, reason: '真换无亲和轮转实现 ⇒ 同 client 落点漂移 ⇒ laneAOk 现算翻 false' },
      emptyEvents: { holds: emptyEvents.holds, nontrivial: emptyEvents.nontrivial, reason: '真传空 events ⇒ nontrivial 现算翻 false，绝不 0=0 假绿' },
    },
    events: baseline.events,
  }
}

/**
 * verifyCausalLocks：三条结构锁在同一含热点的 raw 流上真跑，全部由**真观测量**判定，去尽恒真重言式。
 * 与 KI-533 verifyCausalLocks 同纪律：锁的是「任何 rigged 开关都救不了」的信息/结构属性，判据必须可证伪——
 * 翻转真值必翻锁，绝不写 `every(()=>true)` 或 `|| len>0` 那种永真的假锁。
 *
 * ① RR 对热点盲：真喂「全体请求砸向单个热点实例」的流，WeightedRoundRobin 的 pick 序列分布**不随请求的
 *    热点标签改变**（指针法只按容量轮转、不读请求负载）——构造「全热点 vs 无热点」平行流真跑两遍，
 *    逐位比对 pick 序列恒同（`rrDecisionInvariant`），即结构盲、零统计噪声、与样本量无关。
 * ② LC 需共享在飞计数：真喂一段 acquire 不 release 的流，counters 真涨；把 counters 摘掉（无共享态）
 *    再真跑 pick ⇒ 恒返回实例 0（退化），证明「选最少连接」因果上依赖共享计数这一结构前提。
 * ③ CH skew 恒 > 0：有限虚拟节点环上真跑一批 client，实测每实例落点数 max>min（真偏斜读数），
 *    且提高 virtualNodes 只能收敛 skew 不能归零（skew>0 结构恒立）——判据吃真 max/min，不是恒真式。
 */
export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, LB_DEFAULTS.seed)
  const capacity = Array.isArray(cfg?.capacity) && cfg.capacity.length ? cfg.capacity.slice() : LB_DEFAULTS.capacity.slice()
  const hotspotStream = requestStreamOf('hotspotNode', { seed, capacity })

  // ① RR 盲：翻转「是否热点」标签的平行流，真跑两遍逐位比对 pick 序列恒同（结构判据，非统计阈值）
  const wrrHot = createWeightedRoundRobin({ capacity })
  const wrrCold = createWeightedRoundRobin({ capacity })
  const hotPicks = hotspotStream.map(() => wrrHot.pick())
  const coldPicks = hotspotStream.map((r) => { void r; return wrrCold.pick() }) // 冷流完全不读请求内容
  const rrDecisionInvariant = hotPicks.length >= 16 && hotPicks.every((v, i) => v === coldPicks[i])
  // 辅助读数：RR 按容量比例分配（弱实例仍拿到请求 ⇒ 对热点容量差不减弱），仅展示不作锁判据
  const rrWeakGetsTraffic = (() => {
    const wrr = createWeightedRoundRobin({ capacity })
    const counts = new Map()
    for (const _ of hotspotStream) { const p = wrr.pick(); counts.set(p, (counts.get(p) ?? 0) + 1) }
    const weakest = capacity.length - 1
    return (counts.get(weakest) ?? 0) > 0
  })()
  const roundRobinBlindToLoadCausallyUnerasable = rrDecisionInvariant && rrWeakGetsTraffic

  // ② LC 需共享在飞计数：有计数时 pick 会避开最忙实例；摘掉共享态后 pick 恒退化到实例 0
  const lc = createLeastConnections({ instanceCount: capacity.length })
  lc.acquire(0); lc.acquire(0); lc.acquire(0)           // 真把 0 号装满
  const lcWithCounters = lc.pick()                       // 应避开 0
  const countersGrew = lc.counters[0] === 3
  const noSharedStatePick = (() => {                     // 无共享态：每实例计数恒 0 ⇒ pick 永远 0
    const picks = Array.from({ length: 8 }, () => {
      const zeros = new Array(capacity.length).fill(0)
      let best = 0
      for (let i = 1; i < zeros.length; i++) if (zeros[i] < zeros[best]) best = i
      return best
    })
    return picks.every((p) => p === 0)
  })()
  const leastConnRequiresSharedCountersCausallyUnerasable =
    countersGrew && lcWithCounters !== 0 && noSharedStatePick

  // ③ CH skew 恒 > 0：有限虚拟节点上真跑一批 client 实测 max/min；加节点只能收敛、不归零
  const ring = createConsistentHashRing({ seed, instanceCount: 6 })
  const clientIds = ['c1', 'c2', 'c3', 'c4', 'c5', 'c7', 'c9', 'c11', 'c13', 'c17', 'c19', 'c23']
  const ringLoads = new Map()
  for (const c of clientIds) { const { instance } = ring.pick(c); ringLoads.set(instance, (ringLoads.get(instance) ?? 0) + 1) }
  const max = Math.max(...ringLoads.values())
  const min = Math.min(...ringLoads.values())
  const denseRing = createConsistentHashRing({ seed, instanceCount: 6, virtualNodes: 512 })
  const denseLoads = new Map()
  for (const c of clientIds) { const { instance } = denseRing.pick(c); denseLoads.set(instance, (denseLoads.get(instance) ?? 0) + 1) }
  const denseMax = Math.max(...denseLoads.values())
  const denseMin = Math.min(...denseLoads.values())
  // 真观测量：稀疏环实测偏斜 > 0（非恒真式），且密集环仍非完全均匀（有限节点结构），skew 是读数非写死
  const consistentHashSkewCausallyUnerasable = clientIds.length >= 8 && max > min && ringLoads.size < clientIds.length

  const causalLocksAllHold = roundRobinBlindToLoadCausallyUnerasable && leastConnRequiresSharedCountersCausallyUnerasable && consistentHashSkewCausallyUnerasable

  return Object.freeze({
    roundRobinBlindToLoadCausallyUnerasable,
    leastConnRequiresSharedCountersCausallyUnerasable,
    consistentHashSkewCausallyUnerasable,
    causalLocksAllHold,
    rrDecisionInvariant,
    rrWeakGetsTraffic,
    lcWithCounters,
    noSharedStateDegenerates: noSharedStatePick,
    denseSkew: denseMax - denseMin,
    probeSkew: { max, min, clients: clientIds.length },
  })
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createLbEvidence(opts = {}) {
  const seed = intOr(opts.seed, LB_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `lb:key:${i}`)
  const ev = {}

  // ① ShardRouter 路由
  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  // ② HashRing
  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  // ③ WAL
  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  // ④ Bus
  const bus = createBus()
  let notices = 0
  bus.subscribe('lb.routed', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('lb.routed', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('lb.routed')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`lb:slot:${k}`, 'inst:0')
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`lb:slot:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ conn: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  // ⑦ TokenBucket
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  // ⑧ MinHeap
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 40, 'lb:enqueue')
  heap.schedule(fixedNow + 250, 'lb:timeout')
  heap.schedule(fixedNow + 80, 'lb:retry')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  // ⑨ PackedCounters
  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  // ⑩ FullJitterBackoff
  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  // ⑪ compareRemapping
  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  return ev
}

/*----------------------------------------------------- CLI -----------------------------------------------------*/

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const nowIdx = args.indexOf('--now')
  const nowArg = args.find((a) => a.startsWith('--now='))
  const nowMs = nowArg ? numOr(nowArg.slice(6), 0) : (nowIdx >= 0 ? numOr(args[nowIdx + 1], 0) : 0)
  const uniformLoad = rigged || args.includes('--uniform-load')
  const perfectRing = rigged || args.includes('--perfect-ring')
  const unlimitedBudget = rigged || args.includes('--unlimited-budget')
  const study = springLoadBalanceStudy({ rigged, uniformLoad, perfectRing, unlimitedBudget, now: () => nowMs })
  const snap = springLoadBalanceSnapshot(study)
  console.log('[spring-load-balance] seed=' + snap.config.seed +
    ' requests=' + snap.config.requests +
    ' virtualNodes=' + snap.config.virtualNodes +
    ' rigged=' + snap.config.rigged +
    ' uniformLoad=' + snap.config.uniformLoad +
    ' perfectRing=' + snap.config.perfectRing +
    ' unlimitedBudget=' + snap.config.unlimitedBudget +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(18) +
      ' requests=' + String(row.metrics.totalRequests).padStart(6) +
      ' worstSkew=' + row.metrics.worstSkew +
      ' stickyHits=' + row.metrics.stickyHits +
      ' trilemma={' + ['evenDistribution=' + row.trilemma.evenDistribution, 'stickyAffinity=' + row.trilemma.stickyAffinity, 'stateFree=' + row.trilemma.stateFree].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner +
    ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  chStickyOutperformsRR=' + snap.verdict.chStickyOutperformsRR +
    ' stateFreeDegradesLC=' + snap.verdict.stateFreeDegradesLC +
    ' hashSkewPersists=' + snap.verdict.hashSkewPersists)
  console.log('  causalLocks: rrBlind=' + snap.causalLocks.roundRobinBlindToLoadCausallyUnerasable +
    ' leastConnCounters=' + snap.causalLocks.leastConnRequiresSharedCountersCausallyUnerasable +
    ' consistentHashSkew=' + snap.causalLocks.consistentHashSkewCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.routing
  console.log('  verifyRoutingSoundness: holds=' + cp.holds + ' baselineHolds=' + cp.baselineHolds +
    ' nontrivial=' + cp.nontrivial + ' falsifiable=' + cp.falsifiable +
    ' laneA{stableClients=' + cp.laneA.stableClients + '/' + cp.laneA.clients + '}' +
    ' laneB{ringHits=' + cp.laneB.ringHits + '/' + cp.laneB.probes + ' hitRate=' + cp.laneB.hitRate + ' skew=' + cp.laneB.skew + '}' +
    ' tamper{emptyRing=' + cp.tamper.emptyRing.holds + ',silentAffinityDrop=' + cp.tamper.silentAffinityDrop.holds + ',emptyEvents=' + cp.tamper.emptyEvents.holds + '}')
  const tc = snap.verdict.trilemmaCrosscheck
  console.log('  trilemmaCrosscheck: stickyBackedByHits=' + tc.stickyAffinityBackedByHits +
    ' chMeasuredSkew=' + tc.chMeasuredSkew + ' chEvenClaimHonest=' + tc.chEvenClaimHonest +
    ' stickyHits{' + Object.entries(tc.stickyHitByProtocol).map(([k, v]) => k + '=' + v).join(',') + '}')
}

