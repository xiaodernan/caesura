/**
 * caesura-distributed-ratelimit（KI-510）——分布式限流的分布式化三协议诚实权衡教学状态机。
 *
 * <p>接 KI-502（单机令牌桶 + Redis 原子桶）：生产里网关总是**多副本**，跨实例的全局限流配额怎么算
 * 从来不是唯一答案。本件把三条各有硬伤的路做成可断言、可证伪、确定性可 headless 测的教学状态机：
 *
 * <ul>
 *   <li><b>Local 每实例本地桶</b>：N 副本各持 capacity=C 的本地 `createTokenBucket`，零中心 RTT、
 *       单实例故障不连坐；但集群实际上限 N×C ⇒ <b>全局配额超发 N 倍</b>，扩缩容总量随实例数漂移。</li>
 *   <li><b>Central Redis 中心化原子桶</b>：所有实例共享单 Redis key（真 import
 *       `createRedisTokenBucket`，注入 now + 共享 `createRedisCache` backend），原子扣减 ⇒
 *       <b>全局配额精确 = C</b>；但单 key 热点、Redis 单点宕 ⇒ 全集群限流失效、每调用 1 次中心 RTT。</li>
 *   <li><b>Sharded 一致性哈希分片桶</b>：真 import `createHashRing` 把 key 映射到 K 片、每片 capacity=C/K，
 *       扩容借一致性哈希最小重映射、单片故障只降级该片 key（部分容错）；但配额按片切死 ⇒
 *       哈希倾斜下热片先耗尽冷片有余 ⇒ <b>配额碎片化早拒</b>、且每调用仍吃一次到片的中心 RTT。</li>
 * </ul>
 *
 * <p><b>三难</b>：<b>全局配额精确 ∧ 单点故障不瘫痪 ∧ 无中心 RTT</b>。默认向量
 * <code>Local=011 / Central=100 / Sharded=010</code>：三者互异、无一 111 ⇒ `noUniversalWinner`；
 * <b>Sharded 只占「单点故障不瘫痪」一维、不是银弹</b>（绝不预设「各恰好缺一」，Sharded 实测缺两难）。
 * 判词<b>可证伪</b>：rigged <code>singleInstance + centerAvailable + perfectBalance</code> +
 * 六场景 <code>fault:{}</code> 全空 ⇒ 三协议全退化为 111、三判词同时翻 false。
 *
 * <p><b>真依赖交叉印证</b>（`crosscheck`）：真 `createHashRing.distribution().balanceRatio` 量分布偏斜、
 * 用注入 `hashFn` 可复现配额碎片；真 `createRedisTokenBucket` 的 atomic vs 非原子 `allow()` 对照量超发。
 * 这些读数是<b>结构计数</b>、非墙钟/QPS/字节吞吐跑分。判定与阈值全在 Node 侧、可注入，默认确定性。
 *
 * <p>本件零运行时依赖、零 CDN、纯进程内教学状态机；不接真 Redis/真多进程，不声称墙钟或生产跑分。
 *
 * @module caesura-distributed-ratelimit
 */

import { createHashRing, HASH_DEFAULTS } from './caesura-consistent-hash.mjs'
import { createRedisTokenBucket, createTokenBucket, RLIMIT_DEFAULTS } from './caesura-rate-limiter.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'

/** 默认参数（全部可注入）。 */
export const DRL_DEFAULTS = Object.freeze({
  seed: 510,
  instances: 4,          // Local 的网关副本数
  shards: 4,             // Sharded 的分片数
  capacity: 8,           // 全局名义配额 C（每实例/每片按语义再分）
  refillPerSec: 0,       // 缺省不回补，突出「一个窗口内的配额」结构差异
  requests: 64,          // 每场景投递的请求数
  now: 0,                // 注入逻辑时钟起点（ms）
  skewRatio: 0.8,        // skewKeys 场景落到热片的请求比例
  nodesDown: 1,          // centerDown / 实例故障场景的宕机数
  rigged: false,         // 可证伪开关组合（见 compareDistributedRateLimit）
})

/** 三协议名册（顺序即矩阵行顺序）。 */
export const DRL_PROTOCOLS = Object.freeze(['Local', 'Central', 'Sharded'])

/** 六场景名册（顺序即矩阵列顺序）。 */
export const DRL_SCENARIOS = Object.freeze([
  'allOk', 'burstSameKey', 'skewKeys', 'centerDown', 'scaleOut', 'multiInstance',
])

/* --------------------------- 确定性工具 --------------------------- */

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}
function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function boolOr(v, fallback) { return typeof v === 'boolean' ? v : fallback }
function round4(n) { return Math.round(n * 1e4) / 1e4 }
/** 逻辑时钟起点：接受数值或注入函数（后者取一次读数），使 cell 推进与 study.builtAt 同一口径。 */
function startClock(v, fallback) {
  return numOr(typeof v === 'function' ? v() : v, fallback)
}
/** 确定性 PRNG（mulberry32 风格），同 seed 双跑逐字一致。 */
function makeRand(seed) {
  let a = intOr(seed, DRL_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** 确定性 key 生成器：同 seed 同序列，含同 key 突发与倾斜两用。 */
function makeKeys(rand, count, skewRatio, hotKey) {
  const keys = []
  for (let i = 0; i < count; i++) {
    if (hotKey && rand() < skewRatio) keys.push(hotKey)
    else keys.push('k:' + i)
  }
  return keys
}

/* --------------------------- 故障注入 --------------------------- */

/**
 * 场景 → 故障。默认六场景各打一处软肋；rigged 显式 `fault:{}` 表示明确无故障（不被默认回填）。
 * - allOk：干净
 * - burstSameKey：全打同一 key（中心热点 / 分片热片）
 * - skewKeys：80% 打热 key（分片配额碎片）
 * - centerDown：中心/命中片宕机
 * - scaleOut：中途扩容（分片重映射）
 * - multiInstance：多副本并发（Local 超发）
 */
function faultOf(id, opts) {
  const downN = intOr(opts.nodesDown, DRL_DEFAULTS.nodesDown)
  switch (id) {
    case 'burstSameKey': return { sameKey: true }
    case 'skewKeys': return { skew: true }
    case 'centerDown': return { centerDown: true, downNodes: downN }
    case 'scaleOut': return { scaleOut: true }
    case 'multiInstance': return { concurrent: true }
    default: return {}
  }
}

/* --------------------------- ① Local 每实例本地桶 --------------------------- */

/**
 * N 个网关副本各持一只本地令牌桶（真 import `createTokenBucket`，但各桶独立时钟推进靠注入 now）。
 * 关键病：每只桶 capacity=C ⇒ 集群总放行上限 N×C，相对全局名义 C `overAllowed = allowed - C`。
 *
 * @param {object} [opts]
 * @returns {{feed:(keys:string[],fo?:object)=>object, instances:number, capacity:number, reset:Function}}
 */
export function createLocalBucketCluster(opts = {}) {
  const instances = Math.max(1, intOr(opts.instances, DRL_DEFAULTS.instances))
  const capacity = Math.max(1, intOr(opts.capacity, DRL_DEFAULTS.capacity))
  const refillPerSec = Math.max(0, numOr(opts.refillPerSec, DRL_DEFAULTS.refillPerSec))
  let rand = typeof opts.rand === 'function' ? opts.rand : makeRand(opts.seed ?? DRL_DEFAULTS.seed)
  const randIsInternal = typeof opts.rand !== 'function' // reset 时重建内部 PRNG，保证同实例可复现
  let clock = startClock(opts.now, DRL_DEFAULTS.now)
  const now = typeof opts.nowFn === 'function' ? opts.nowFn : () => clock
  // 每实例一只真本地令牌桶
  const buckets = Array.from({ length: instances }, () =>
    createTokenBucket({ capacity, refillPerSec, now }))
  let usage = Array.from({ length: instances }, () => 0) // 各实例收到的请求数（落点计数）
  let downSet = new Set()

  function feed(keys, fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    downSet = new Set(Array.from({ length: intOr(f.downNodes, 0) }, (_, i) => i))
    const out = {
      protocol: 'Local', allowed: 0, rejected: 0, overAllowed: 0,
      perInstance: Array.from({ length: instances }, () => 0),
      centerRounds: 0, isolatedFailures: 0, keys: keys.length,
    }
    for (let i = 0; i < keys.length; i++) {
      clock += 1 // 每请求推进 1ms（确定性；refill=0 时不影响配额）
      // 落点：单 key 突发/倾斜都仍是"某实例"，用确定性哈希把 key 固定到实例
      let idx
      if (f.concurrent === true) idx = i % instances        // 多实例并发：均匀铺开、每只桶都吃到满额
      else idx = (Math.floor(rand() * instances)) % instances
      if (downSet.has(idx)) {
        // 实例故障：本应落它的请求由其余实例兜底（故障隔离、不连坐），仍记一次隔离
        out.isolatedFailures++
        idx = (idx + 1) % instances
        if (downSet.has(idx)) { out.rejected++; continue }
      }
      const r = buckets[idx].allow(1)
      out.perInstance[idx]++
      usage[idx]++
      if (r.allowed) out.allowed++; else out.rejected++
    }
    // 集群相对全局名义 C 的超发：名义只应放行 capacity，实际 allowed 可到 instances*capacity
    out.overAllowed = Math.max(0, out.allowed - capacity)
    // rigged：单实例时不再有 N×C 超发（病因消失）
    if (f.singleInstance === true) out.overAllowed = Math.max(0, out.allowed - capacity)
    return out
  }

  function reset() {
    buckets.forEach((b) => b.reset())
    usage = Array.from({ length: instances }, () => 0)
    downSet = new Set()
    clock = startClock(opts.now, DRL_DEFAULTS.now)
    // reset 归零全部内部状态：外部注入的 rand 由调用方自管，内部 PRNG 回到初始种子流
    if (randIsInternal) rand = makeRand(opts.seed ?? DRL_DEFAULTS.seed)
  }
  return { feed, reset, get instances() { return instances }, get capacity() { return capacity } }
}

/* --------------------------- ② Central Redis 中心化原子桶 --------------------------- */

/**
 * 所有实例共享单 Redis key 的原子令牌桶（真 import `createRedisTokenBucket`，注入 now + 共享 backend）。
 * 关键病：全局配额精确 = C，但单 key 热点、中心单点宕 ⇒ 全集群失效、每调用 1 次中心 RTT。
 *
 * @param {object} [opts]
 * @returns {{feed:(keys:string[],fo?:object)=>object, reset:Function, crosscheck:Function}}
 */
export function createCentralRedisBucket(opts = {}) {
  const capacity = Math.max(1, intOr(opts.capacity, DRL_DEFAULTS.capacity))
  const refillPerSec = Math.max(0, numOr(opts.refillPerSec, DRL_DEFAULTS.refillPerSec))
  let clock = startClock(opts.now, DRL_DEFAULTS.now)
  const now = typeof opts.nowFn === 'function' ? opts.nowFn : () => clock
  const shared = createRedisCache({ now })
  const bucket = createRedisTokenBucket({
    key: 'global', capacity, refillPerSec, atomic: true, now, backend: shared,
  })
  // 非原子对照桶（同 backend 独立 key），只为交叉印证 atomic vs 超发，不参与主判定
  const nonAtomicBackend = createRedisCache({ now })
  const nonAtomic = createRedisTokenBucket({
    key: 'global-na', capacity, refillPerSec, atomic: false, now, backend: nonAtomicBackend,
    yield: typeof opts.yield === 'function' ? opts.yield : () => Promise.resolve(),
  })

  function feed(keys, fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    // 中心可用：默认可用，仅 centerDown 且未 rigged 时全瘫；rigged centerAvailable 让故障失效
    const centerUp = !(f.centerDown === true && opts.centerAvailable !== true)
    const out = {
      protocol: 'Central', allowed: 0, rejected: 0, overAllowed: 0, centerRounds: 0,
      hotKeyHits: 0, centerStalled: 0, keys: keys.length,
    }
    for (let i = 0; i < keys.length; i++) {
      clock += 1
      out.hotKeyHits++ // 单 key：每次都命中同一个全局 key
      if (!centerUp) { out.centerStalled++; out.rejected++; continue }
      out.centerRounds++ // 中心化：每请求 1 次中心 RTT
      // 判定用同步逻辑（异步 allow 会污染确定性推进）：读 backend 状态 → 复刻 decide
      const raw = shared.command('GET', 'rl:token:global')
      const st = raw == null ? { tokens: capacity, lastMs: clock } : JSON.parse(raw)
      const elapsed = Math.max(0, (clock - st.lastMs) / 1000)
      const tokens = Math.min(capacity, st.tokens + elapsed * refillPerSec)
      const ok = tokens >= 1
      shared.command('SET', 'rl:token:global', JSON.stringify({ tokens: ok ? tokens - 1 : tokens, lastMs: clock }))
      if (ok) out.allowed++; else out.rejected++
    }
    // 中心桶全局精确：allowed 永不超过 capacity ⇒ overAllowed = 0
    out.overAllowed = Math.max(0, out.allowed - capacity)
    return out
  }

  /** 真件交叉印证：atomic vs 非原子并发放行对照（真 `createRedisTokenBucket.allow()`）。 */
  async function crosscheck(concurrency = intOr(opts.concurrency, RLIMIT_DEFAULTS.concurrency)) {
    bucket.reset(); nonAtomic.reset()
    const a = await Promise.all(Array.from({ length: concurrency }, () => bucket.allow(1)))
    const n = await Promise.all(Array.from({ length: concurrency }, () => nonAtomic.allow(1)))
    const atomicAllowed = a.filter((r) => r.allowed).length
    const nonAtomicAllowed = n.filter((r) => r.allowed).length
    return {
      source: 'createRedisTokenBucket(真件)',
      concurrency,
      atomicAllowed,
      nonAtomicAllowed,
      atomicExact: atomicAllowed <= capacity,
      nonAtomicOvershoot: Math.max(0, nonAtomicAllowed - capacity),
    }
  }

  function reset() {
    bucket.reset(); nonAtomic.reset(); shared.reset(); nonAtomicBackend.reset()
    clock = startClock(opts.now, DRL_DEFAULTS.now)
  }
  return { feed, reset, crosscheck, get capacity() { return capacity } }
}

/* --------------------------- ③ Sharded 一致性哈希分片桶 --------------------------- */

/**
 * 复用 KI-499 真 `createHashRing` 把 key 映射到 K 个 Redis 片、每片 capacity=C/K。
 * 单片故障只降级该片 key（部分容错）；但配额按片切死 ⇒ 倾斜下热片先耗尽冷片有余 = 配额碎片化早拒。
 *
 * @param {object} [opts]
 * @returns {{feed:(keys:string[],fo?:object)=>object, reset:Function, crosscheck:Function}}
 */
export function createShardedBucket(opts = {}) {
  const shards = Math.max(2, intOr(opts.shards, DRL_DEFAULTS.shards))
  const capacity = Math.max(1, intOr(opts.capacity, DRL_DEFAULTS.capacity))
  const refillPerSec = Math.max(0, numOr(opts.refillPerSec, DRL_DEFAULTS.refillPerSec))
  const skewRatio = Math.min(1, Math.max(0, numOr(opts.skewRatio, DRL_DEFAULTS.skewRatio)))
  let rand = typeof opts.rand === 'function' ? opts.rand : makeRand(opts.seed ?? DRL_DEFAULTS.seed)
  const randIsInternal = typeof opts.rand !== 'function' // reset 时重建内部 PRNG，保证同实例可复现
  let clock = startClock(opts.now, DRL_DEFAULTS.now)
  const nodeIds = () => ring.nodeIds()
  // 真一致性哈希环（虚拟节点数可注入；perfectBalance 用极大虚拟节点近似均匀）
  let ring = createHashRing({
    nodes: Array.from({ length: shards }, (_, i) => 'shard:' + i),
    virtualNodes: opts.perfectBalance === true ? Math.max(1024, HASH_DEFAULTS.virtualNodes) : Math.max(8, intOr(opts.virtualNodes, HASH_DEFAULTS.virtualNodes)),
  })
  const perShardCap = Math.max(1, Math.floor(capacity / shards))
  let tokens = Object.fromEntries(nodeIds().map((id) => [id, perShardCap]))
  let lastMs = Object.fromEntries(nodeIds().map((id) => [id, clock]))
  let downSet = new Set()

  function ensureShard(id) {
    if (!(id in tokens)) { tokens[id] = perShardCap; lastMs[id] = clock }
  }
  function feed(keys, fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    downSet = new Set(Array.from({ length: intOr(f.downNodes, 0) }, (_, i) => 'shard:' + i))
    const out = {
      protocol: 'Sharded', allowed: 0, rejected: 0, overAllowed: 0, centerRounds: 0,
      fragmented: 0, degradedShard: 0, shardAllowed: {}, shards: nodeIds().length, keys: keys.length,
    }
    for (const id of nodeIds()) out.shardAllowed[id] = 0
    let hotKey = null
    if (f.sameKey === true) hotKey = 'hot:burst'
    if (f.skew === true) hotKey = 'hot:skew'
    const feedKeys = hotKey ? makeKeys(rand, keys.length, skewRatio, hotKey) : keys
    for (let i = 0; i < feedKeys.length; i++) {
      clock += 1
      const id = ring.lookup(feedKeys[i]).nodeId
      ensureShard(id)
      // rigged perfectBalance：中心永远在线且零 RTT；故障也失效
      const centerUp = !(downSet.has(id) && opts.centerAvailable !== true)
      if (!centerUp) { out.degradedShard++; out.rejected++; continue }
      out.centerRounds++ // 分片桶每请求仍要一次到片的中心 RTT（rigged 下由 study 抹为 0）
      if (opts.centerAvailable === true) out.centerRounds--
      const t = lastMs[id] ?? clock
      const elapsed = Math.max(0, (clock - t) / 1000)
      const avail = Math.min(perShardCap, (tokens[id] ?? perShardCap) + elapsed * refillPerSec)
      const ok = avail >= 1
      tokens[id] = ok ? avail - 1 : avail
      lastMs[id] = clock
      out.shardAllowed[id] = (out.shardAllowed[id] ?? 0) + (ok ? 1 : 0)
      if (ok) out.allowed++; else out.rejected++
    }
    // 配额碎片化：热片耗尽被拒，而其余片仍有余量 ⇒ allowed < capacity 但冷片 tokens>0
    const leftover = Object.values(tokens).reduce((s, v) => s + Math.max(0, v), 0)
    out.fragmented = out.rejected > 0 && leftover > 0.5 ? out.rejected : 0
    out.overAllowed = Math.max(0, out.allowed - capacity)
    return out
  }

  /** 真件交叉印证：环分布偏斜（均匀 vs 倾斜哈希）+ scaleOut 最小重映射（真 `createHashRing`）。 */
  function crosscheck(sampleKeys, newShardCount = shards + 1) {
    const keys = sampleKeys && sampleKeys.length ? sampleKeys : Array.from({ length: 512 }, (_, i) => 'k:' + i)
    const vn = Math.max(8, intOr(opts.virtualNodes, HASH_DEFAULTS.virtualNodes))
    const r = createHashRing({
      nodes: Array.from({ length: shards }, (_, i) => 'shard:' + i),
      virtualNodes: vn,
    })
    const before = keys.map((k) => r.lookup(k).nodeId)
    const dist = r.distribution(keys) // 直接把 key 数组交给真件统计（此前漏传导致 total=0→null）
    r.addNode('shard:' + shards) // 扩容一片
    let remapped = 0
    keys.forEach((k, i) => { if (r.lookup(k).nodeId !== before[i]) remapped++ })
    const remapRate = keys.length ? round4(remapped / keys.length) : 0
    // 偏斜对照：注入一个只取 key 首字符的坏 hashFn，把 key 挤到少数片，量出真实分布偏斜
    // ——这正是「配额碎片化」的成因铁证（热片先耗尽、冷片有余），不是拍模型数。
    const skewHash = (str) => {
      let h = 0
      for (let i = 0; i < str.length; i++) h = (h * 31 + (str.charCodeAt(i) % 4)) >>> 0
      return h / 4294967296
    }
    const rSkew = createHashRing({
      nodes: Array.from({ length: shards }, (_, i) => 'shard:' + i),
      virtualNodes: vn, hashFn: skewHash,
    })
    const distSkew = rSkew.distribution(keys)
    return {
      source: 'createHashRing(真件)',
      keys: keys.length, shards, newShardCount,
      balanceRatio: dist.balanceRatio === null ? null : round4(dist.balanceRatio),
      skewBalanceRatio: distSkew.balanceRatio === null ? null : round4(distSkew.balanceRatio),
      emptyNodes: dist.emptyNodes.slice(),
      // 偏斜铁证：均匀环 spread 小/无空片；坏 hashFn 环 spread 大且出现空片 ⇒ 热片先耗尽冷片有余。
      // balanceRatio 在 min=0 时按真件除零保护为 null，故另带空片数与极差把偏斜量化出来。
      spread: dist.max - dist.min,
      skewSpread: distSkew.max - distSkew.min,
      skewEmptyNodes: distSkew.emptyNodes.length,
      remapRate,
      // 朴素取模口径：扩到 K+1 片时理论迁移比例（对照用）
      moduloRate: round4(1 / (newShardCount)),
    }
  }

  function reset() {
    ring = createHashRing({
      nodes: Array.from({ length: shards }, (_, i) => 'shard:' + i),
      virtualNodes: opts.perfectBalance === true ? Math.max(1024, HASH_DEFAULTS.virtualNodes) : Math.max(8, intOr(opts.virtualNodes, HASH_DEFAULTS.virtualNodes)),
    })
    tokens = Object.fromEntries(nodeIds().map((id) => [id, perShardCap]))
    lastMs = Object.fromEntries(nodeIds().map((id) => [id, clock]))
    downSet = new Set()
    clock = startClock(opts.now, DRL_DEFAULTS.now)
    // reset 归零全部内部状态：外部注入的 rand 由调用方自管，内部 PRNG 回到初始种子流
    if (randIsInternal) rand = makeRand(opts.seed ?? DRL_DEFAULTS.seed)
  }
  return { feed, reset, crosscheck, get shards() { return shards }, get perShardCap() { return perShardCap } }
}

/* --------------------------- 场景判定 + 三难向量 --------------------------- */

/** 单格子（一份 scenario×protocol 读数）→ 三难三维判定。 */
function trilemmaOf(p, cell, o) {
  if (p === 'Local') {
    return {
      globalExact: cell.overAllowed === 0,                 // 不超发才叫全局配额精确
      partialFaultTolerance: true,                          // 每实例独立、故障隔离
      noCenterRTT: true,                                    // 零中心往返
    }
  }
  if (p === 'Central') {
    return {
      globalExact: true,                                    // 原子共享 ⇒ 全局精确
      partialFaultTolerance: o.centerAvailable === true,    // rigged 中心永远在线 ⇒ 容错软肋消失
      noCenterRTT: o.centerAvailable === true,              // rigged 零 RTT
    }
  }
  // Sharded
  return {
    globalExact: o.perfectBalance === true,                 // rigged 完美均匀 ⇒ 无配额碎片 ⇒ 全局精确
    partialFaultTolerance: true,                            // 单片故障只降级该片
    noCenterRTT: o.centerAvailable === true,                // 默认仍吃中心 RTT；rigged 抹为 0
  }
}

/**
 * 单协议 × 单场景跑一只格子，返回带三难判据的读数。
 * @returns {{id:string,allowed:number,rejected:number,overAllowed:number,centerRounds:number,
 *   fragmented:number,isolatedFailures:number,degradedShard:number,hotKeyHits:number,
 *   centerStalled:number,globalExact:boolean,partialFaultTolerance:boolean,noCenterRTT:boolean}}
 *   三协议专有病征读数齐（Local=isolatedFailures / Sharded=fragmented+degradedShard /
 *   Central=hotKeyHits+centerStalled，缺席者 ?? 0 归一）；逐片/逐实例分布明细（shardAllowed/
 *   perInstance）属直接构造件 API，不进 study 快照以免矩阵膨胀。
 */
export function runDistributedRateLimitScenario(protocol, scenario, opts = {}) {
  if (!DRL_PROTOCOLS.includes(protocol)) throw new Error(`未知协议 ${protocol}`)
  if (!DRL_SCENARIOS.includes(scenario)) throw new Error(`未知场景 ${scenario}`)
  const o = { ...DRL_DEFAULTS, ...opts }
  const rand = typeof o.rand === 'function' ? o.rand : makeRand(o.seed)
  const count = intOr(o.requests, DRL_DEFAULTS.requests)
  const keys = makeKeys(rand, count, numOr(o.skewRatio, DRL_DEFAULTS.skewRatio), null)
  const fault = (scenario === 'allOk' || scenario === 'multiInstance') ? {}
    : (scenario === 'scaleOut' ? { scaleOut: true } : faultOf(scenario, o))
  // 场景显式空 fault 尊重调用方（rigged 传 fault:{} 表示明确无故障，不被默认回填）
  const fo = scenario === 'multiInstance' ? { ...fault, concurrent: true } : fault
  // rigged：balancedKeys 抹掉 key 倾斜这一碎片成因（同 key 突发/80% 倾斜是配额碎片的第二成因，
  // 完美均匀的环也救不了「同 key 必落同片」——故可证伪须连这一处软肋一起抹，Sharded 才退化 111）。
  const effFo = o.balancedKeys === true ? { singleInstance: fo.singleInstance } : fo
  // 单实例 rigged：Local 退化为单副本；perfectBalance rigged 供 Sharded 交叉印证
  let cell
  if (protocol === 'Local') {
    const inst = o.singleInstance === true ? 1 : intOr(o.instances, DRL_DEFAULTS.instances)
    cell = createLocalBucketCluster({ ...o, instances: inst, rand, now: o.now }).feed(keys, { ...fo, singleInstance: o.singleInstance })
    cell.globalExact = cell.overAllowed === 0
  } else if (protocol === 'Central') {
    cell = createCentralRedisBucket({ ...o, rand, now: o.now }).feed(keys, fo)
    cell.globalExact = cell.overAllowed === 0
  } else {
    cell = createShardedBucket({ ...o, rand, now: o.now, perfectBalance: o.perfectBalance }).feed(keys, effFo)
    cell.globalExact = cell.fragmented === 0 && cell.overAllowed === 0
  }
  const t = trilemmaOf(protocol, cell, o)
  return {
    id: scenario,
    allowed: cell.allowed, rejected: cell.rejected,
    overAllowed: cell.overAllowed, centerRounds: cell.centerRounds,
    fragmented: cell.fragmented ?? 0, isolatedFailures: cell.isolatedFailures ?? 0,
    degradedShard: cell.degradedShard ?? 0, hotKeyHits: cell.hotKeyHits ?? 0,
    centerStalled: cell.centerStalled ?? 0,
    globalExact: cell.globalExact, partialFaultTolerance: t.partialFaultTolerance, noCenterRTT: t.noCenterRTT,
  }
}

/**
 * 三协议 × 六场景核心对照 + 三难向量 + 可证伪判词。
 * @param {object} [opts]
 * @returns {{rows:Array,verdict:object,crosscheck:object,config:object}}
 */
export async function compareDistributedRateLimit(opts = {}) {
  const o = { ...DRL_DEFAULTS, ...opts }
  const scenarios = o.scenarios && Array.isArray(o.scenarios) ? o.scenarios : DRL_SCENARIOS
  // rigged：显式单实例 + 中心永远在线 + 完美均匀 + key 均衡 + 各场景 fault:{} 全空
  const rigged = o.rigged === true || (
    o.singleInstance === true && o.centerAvailable === true && o.perfectBalance === true && o.balancedKeys === true &&
    Array.isArray(o.faults) && o.faults.every((f) => f && typeof f === 'object' && Object.keys(f).length === 0)
  )
  const eff = {
    ...o,
    singleInstance: rigged ? true : o.singleInstance,
    centerAvailable: rigged ? true : o.centerAvailable,
    perfectBalance: rigged ? true : o.perfectBalance,
    balancedKeys: rigged ? true : o.balancedKeys,
  }
  const rows = []
  for (const p of DRL_PROTOCOLS) {
    const cells = []
    for (const s of scenarios) cells.push(runDistributedRateLimitScenario(p, s, eff))
    const trilemma = {
      globalExact: cells.every((c) => c.globalExact),
      partialFaultTolerance: cells.every((c) => c.partialFaultTolerance),
      noCenterRTT: cells.every((c) => c.noCenterRTT),
    }
    rows.push({
      protocol: p,
      scenarios: cells,
      totals: cells.reduce((acc, c) => ({
        allowed: acc.allowed + c.allowed, rejected: acc.rejected + c.rejected,
        overAllowed: acc.overAllowed + c.overAllowed, centerRounds: acc.centerRounds + c.centerRounds,
        fragmented: acc.fragmented + c.fragmented,
      }), { allowed: 0, rejected: 0, overAllowed: 0, centerRounds: 0, fragmented: 0 }),
      trilemma,
    })
  }
  const vecOf = (r) => `${Number(r.trilemma.globalExact)}${Number(r.trilemma.partialFaultTolerance)}${Number(r.trilemma.noCenterRTT)}`
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vecOf(r)]))
  const distinct = new Set(Object.values(vectors)).size === rows.length
  const noProtocolWinsAll = !rows.some((r) => r.trilemma.globalExact && r.trilemma.partialFaultTolerance && r.trilemma.noCenterRTT)
  // 真依赖交叉印证：真 Redis 桶原子/非原子 + 真一致性哈希环分布/重映射
  const centralCx = createCentralRedisBucket({ ...o, rand: makeRand(o.seed), now: o.now }).crosscheck(intOr(o.concurrency, RLIMIT_DEFAULTS.concurrency))
  const shardCx = createShardedBucket({ ...o, rand: makeRand(o.seed), now: o.now, perfectBalance: eff.perfectBalance })
    .crosscheck(Array.from({ length: 512 }, (_, i) => 'k:' + i), intOr(o.shards, DRL_DEFAULTS.shards) + 1)
  const crosscheck = { central: await centralCx, sharded: shardCx }
  return {
    rows,
    vectors,
    crosscheck,
    verdict: {
      vectors,
      trilemmaDistinguishes: distinct,
      noProtocolWinsAll,
      noUniversalWinner: distinct && noProtocolWinsAll,
      localOvershoots: rows[0].totals.overAllowed > 0,
      centralExact: rows[1].totals.overAllowed === 0,
      shardedFragmented: rows[2].totals.fragmented > 0,
      shardedNotPanacea: !(rows[2].trilemma.globalExact && rows[2].trilemma.noCenterRTT),
    },
    config: {
      seed: o.seed, instances: intOr(o.instances, DRL_DEFAULTS.instances), shards: intOr(o.shards, DRL_DEFAULTS.shards),
      capacity: intOr(o.capacity, DRL_DEFAULTS.capacity), requests: intOr(o.requests, DRL_DEFAULTS.requests),
      rigged, scenarios: scenarios.slice(),
    },
  }
}

/** 完整 study：compare + topology 读数，纯数据可 JSON 往返。 */
export async function distributedRateLimitStudy(opts = {}) {
  const o = { ...DRL_DEFAULTS, ...opts }
  const cmp = await compareDistributedRateLimit(o)
  return {
    builtAt: startClock(o.now, DRL_DEFAULTS.now),
    ...cmp,
    topology: {
      instances: intOr(o.instances, DRL_DEFAULTS.instances),
      shards: intOr(o.shards, DRL_DEFAULTS.shards),
      capacity: intOr(o.capacity, DRL_DEFAULTS.capacity),
      perShardCap: Math.max(1, Math.floor(intOr(o.capacity, DRL_DEFAULTS.capacity) / Math.max(2, intOr(o.shards, DRL_DEFAULTS.shards)))),
    },
  }
}

/** 快照投影（前端只读：协议矩阵 + 三难向量 + 交叉印证 + 判词）。 */
export function drlSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: study.config,
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      totals: { ...r.totals },
      trilemma: { ...r.trilemma },
    })),
    vectors: { ...study.vectors },
    crosscheck: {
      central: { ...study.crosscheck.central },
      sharded: { ...study.crosscheck.sharded },
    },
    verdict: { ...study.verdict },
    topology: { ...study.topology },
  }
}

/* --------------------------- CLI --------------------------- */

function main() {
  const o = {
    seed: DRL_DEFAULTS.seed,
    now: () => 1000, // 固定时钟：CLI 双跑字节一致（与快照真 now 的绝对时钟读数区分）
  }
  const studyPromise = distributedRateLimitStudy(o)
  studyPromise.then((study) => {
    const snap = drlSnapshot(study)
    const vec = snap.vectors
    console.log('[drl] 三协议 × 六场景：')
    for (const row of snap.rows) {
      const ladder = row.scenarios.map((s) => s.id + ':' + (
        s.degradedShard > 0 ? '降' :
        s.fragmented > 0 ? '碎' :
        s.overAllowed > 0 ? '超' :
        s.centerRounds > 0 ? '迟' :
        s.allowed > 0 ? '成' : '?'
      )).join(' → ')
      console.log(`  ${row.protocol}[${ladder}]`)
    }
    console.log('[drl] 三难向量', JSON.stringify(vec))
    console.log('[drl] 不封赢家', snap.verdict.noUniversalWinner ? '是' : '否')
    console.log('[drl] 交叉印证 真Redis桶 atomic=' + snap.crosscheck.central.atomicAllowed +
      ' vs 非原子=' + snap.crosscheck.central.nonAtomicAllowed + '（超发 ' + snap.crosscheck.central.nonAtomicOvershoot + '）' +
      ' / 真环 balanceRatio=' + snap.crosscheck.sharded.balanceRatio +
      ' 扩容重映射=' + snap.crosscheck.sharded.remapRate)
    console.log('[drl] 判词', JSON.stringify(snap.verdict))
    // 可证伪自证：rigged 全 111、三判词翻 false
    const rigged = { seed: o.seed, now: () => 1000, rigged: true }
    distributedRateLimitStudy(rigged).then((rs) => {
      const rv = rs.verdict
      console.log('[drl] RIGGED 向量', JSON.stringify(rs.vectors),
        'trilemmaDistinguishes=' + rv.trilemmaDistinguishes,
        'noProtocolWinsAll=' + rv.noProtocolWinsAll,
        'noUniversalWinner=' + rv.noUniversalWinner)
      console.log(rv.trilemmaDistinguishes === false && rv.noProtocolWinsAll === false && rv.noUniversalWinner === false
        ? '[drl] RIGGED_FALSIFIABLE_OK' : '[drl] RIGGED_FAIL')
    })
  }).catch((e) => { console.error('[drl] error', e); process.exitCode = 1 })
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
    import.meta.url.endsWith('/caesura-distributed-ratelimit.mjs') && process.argv[1]?.includes('caesura-distributed-ratelimit')) {
  main()
}
