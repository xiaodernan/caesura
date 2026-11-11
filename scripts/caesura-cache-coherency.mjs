/**
 * caesura-cache-coherency（KI-512）——分布式缓存读写一致性的三协议诚实权衡教学状态机。
 *
 * <p>精准补一处既有缺口：KI-493 把 LRU+TTL+singleflight 的 Redis 风格缓存做成了可断言教学件，
 * 但停在<b>单实例命中/失效</b>口径，从未建模「一次写怎么在缓存与后端库之间保持一致」。生产里缓存
 * 一接上库，写路径就没有唯一答案，本件把三条各有硬伤的路做成可断言、可证伪、确定性可 headless 测的
 * 教学状态机：
 *
 * <ul>
 *   <li><b>Cache-Aside 旁路缓存</b>：应用先更库、成功后再删缓存，读 miss 才回填。最简、读命中率高，
 *       且写已同步落库 ⇒ <b>缓存整机宕也不丢写</b>；但<b>更库与删缓存之间非原子</b> ⇒ 窗口内并发读命中
 *       旧缓存、写后又把旧值回填（staleWindowMs），写路径<b>还要同步打一次库</b>（writeBackendRounds≥1）。</li>
 *   <li><b>Write-Through 写穿透</b>：应用只写缓存、缓存层同步写穿到库、两者都成功才返回。缓存与库
 *       <b>始终一致</b>（写后从缓存/库读都是新值）、落库不丢写；但<b>每次写都吃一次库 RTT</b> ⇒ 写路径被
 *       后端阻塞（后端越慢越致命），还把没人读的冷数据也同步落库（写放大）。</li>
 *   <li><b>Write-Behind 写回</b>：只写缓存立即返回、攒够阈值/时窗再异步批量刷回。写延迟最低、同 key
 *       多次写<b>合并成一次刷回</b>（coalescedWrites）；但<b>缓存整机宕机/掉电 ⇒ 未刷回的脏页全丢</b>
 *       （dirtyPagesLost>0）。<b>加 WAL 也只救得了同机进程崩溃后重放</b>——真 `createWal` 的 sink 是
 *       进程内数组/对象，WAL 与缓存盘在同一台机器上，整机连 WAL 一起丢，要真不丢必须跨机 quorum 复制
 *       （那是 KI-507 Raft 的活）。</li>
 * </ul>
 *
 * <p><b>三难（维度顺序固定）</b>：<b>写后读立刻可见 ∧ 写路径不阻塞 ∧ 缓存整机宕不丢写</b>
 * （键名 `readYourWrites / noWriteBlocking / durableOnCrash`）。六场景
 * `allOk / readAfterWrite / writeHeavy / cacheCrash / asyncFlush / manyKeys` 按 <b>every</b> 合取，
 * 默认向量 <code>CacheAside=001 / WriteThrough=101 / WriteBehind=110</code>：三者互异、无一 111 ⇒
 * `noUniversalWinner`。<b>不预设「各恰好缺一」</b>：Cache-Aside 只占「不丢写」一维、缺两难，
 * Write-Through 缺「写不阻塞」一难，Write-Behind 缺「整机宕不丢写」一难。判定正交化：<code>cacheCrash</code>
 * 探针<b>只罚 durable 维</b>、不连带罚 readYourWrites（整机宕是持久性问题，不是可见性问题；呼应 KI-511
 * centerDown 正交化）。
 *
 * <p>判词<b>可证伪</b>：rigged <code>atomicInvalidate:true</code>（抹 Cache-Aside 删缓存/更库窗口）+
 * <code>noWriteBackendRtt:true</code>（抹写穿透的库 RTT）+ <code>atomicWriteBehind:true</code>
 * （Write-Behind 改同步双写 + <b>WAL 跨机 quorum 复制</b>这一教学假想）+ 六场景 <code>fault:{}</code>
 * 全空 ⇒ 三协议全退化为 111、三判词同时翻 false（同 KI-497~511 诚实立场）。
 * <b>关键诚实教训（呼应 KI-511「瞬时轮询≠零空转」）</b>：单开 <code>walEnabled:true</code>（仅进程内 WAL，
 * 能救进程崩溃后 replay）<b>抹不掉 durable 维</b>——WAL 只把「进程崩溃」变可恢复、不把「缓存整体损失」变
 * durable，必须三开关齐开加 fault 全空才全 111。
 *
 * <p><b>真依赖交叉印证</b>（crosscheck，全部真 import + 真跑，非桩）：
 * <ol>
 *   <li>`caesura-redis-cache.createRedisCache` 的 `set/get/stats`——真写 v2 后读缓存命中 v2、hits 计数增，
 *       证 read-your-writes 的缓存侧结构真实存在（不声称真 Redis）。</li>
 *   <li>`caesura-lsm-store.createWal` 的 `append/lines/restore/replay/stats`——真 append 三条 → lines →
 *       restore 到新 WAL → replay 回三条，证 <b>WAL 崩溃恢复机制真实存在</b>；<b>诚实标注</b>
 *       `sinkIsArray:true` / `replicatedAcrossNodes:false`（sink 是进程内数组、无跨机复制）⇒ 整机宕照样丢。</li>
 *   <li>`caesura-cache-guard.shouldEarlyExpire`——真 XFetch 判据随 age→TTL 单调升，证提前续期能降低陈旧
 *       <b>概率</b>但不消除窗口。</li>
 *   <li>`caesura-sharded-cache.createShardedCache` 的 `set/get/stats`——真 manyKeys 写落多片、perShard
 *       命中分布，证写回 fanout 落点结构。</li>
 *   <li>`caesura-mvcc-txn.createMvccStore` 的 `seed/begin('read-committed')/write/commit/read`——真证
 *       库侧「写后读已提交新值」需要版本链：别人未提交时读旧值 v1、提交后读新值 v2。</li>
 *   <li>`caesura-distributed-txn.createTwoPhaseCommit` 的 `prepare/commit`——真证「跨缓存+库要原子就得
 *       两阶段协调」：全 yes 才 commit（8 条消息）、协调者 prepare 后宕 ⇒ 全员 blocked（2 人持锁）。
 *       <b>诚实标注</b>：教学 2PC、非真把缓存纳入 XA。</li>
 *   <li>`caesura-consistent-hash.createHashRing.distribution`——真环分布/空片/balanceRatio，对应 manyKeys
 *       写回 fanout 落点偏斜。</li>
 * </ol>
 * 所有读数是<b>结构计数模型</b>、非墙钟 QPS/延迟/字节吞吐跑分。判定与阈值全 Node 侧、可注入，默认确定性。
 *
 * <p>本件零运行时依赖、零 CDN、纯进程内教学状态机；不接真 Redis/真缓存一致性协议/真 XA 跨库事务/真跨机
 * WAL 复制，不声称真墙钟写延迟或真命中率。
 *
 * @module caesura-cache-coherency
 */

import { createRedisCache } from './caesura-redis-cache.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { shouldEarlyExpire } from './caesura-cache-guard.mjs'
import { createShardedCache } from './caesura-sharded-cache.mjs'
import { createMvccStore } from './caesura-mvcc-txn.mjs'
import { createTwoPhaseCommit } from './caesura-distributed-txn.mjs'
import { createHashRing, HASH_DEFAULTS } from './caesura-consistent-hash.mjs'

/** 默认参数（全部可注入）。 */
export const CCC_DEFAULTS = Object.freeze({
  seed: 512,
  writes: 8,             // 默认场景写次数
  manyKeys: 200,         // manyKeys 探针放大的 key 规模
  backendRttMs: 40,      // 写穿透/旁路到后端库的单次 RTT
  flushThreshold: 4,     // Write-Behind 攒几条脏页刷回一批
  flushLagMs: 200,       // Write-Behind 异步刷回的时窗
  crashAtWrite: 3,       // cacheCrash 场景在第几次写后宕机（留下未刷回脏页）
  windowMs: 10000,       // 单场景模拟时窗
  now: 0,                // 注入逻辑时钟起点（ms）
  atomicInvalidate: false,  // rigged：抹 Cache-Aside 更库/删缓存非原子窗口
  noWriteBackendRtt: false, // rigged：抹写穿透的库 RTT（写路径不再被后端阻塞）
  atomicWriteBehind: false, // rigged：Write-Behind 改同步双写 + WAL 跨机 quorum 复制
  walEnabled: false,        // 仅进程内 WAL（能救进程崩溃 replay），抹不掉整机宕 durable 维
  rigged: false,            // 一次性抹掉全部软肋（等价于三开关全开 + fault 全空）
})

/** 三协议名册（顺序即矩阵行顺序）。 */
export const CCC_PROTOCOLS = Object.freeze(['CacheAside', 'WriteThrough', 'WriteBehind'])

/** 六场景名册（顺序即矩阵列顺序）。每个场景是一只软肋探针；fault:{} 关闭探针退化为基线。 */
export const CCC_SCENARIOS = Object.freeze([
  'allOk', 'readAfterWrite', 'writeHeavy', 'cacheCrash', 'asyncFlush', 'manyKeys',
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
function round4(n) { return Math.round(n * 1e4) / 1e4 }
/** 逻辑时钟起点：接受数值或注入函数（后者取一次读数），与 study.builtAt 同一口径。 */
function startClock(v, fallback) {
  return numOr(typeof v === 'function' ? v() : v, fallback)
}
/** 确定性 PRNG（mulberry32 风格），同 seed 双跑逐字一致。 */
function makeRand(seed) {
  let a = intOr(seed, CCC_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 场景 → 软肋探针（fault）。基线（allOk / fault:{}）= 单次普通写、无并发、不宕机、默认规模。
 * rigged 传 `faults:[{}×6]` 显式关闭全部探针（不被默认回填）——这正是可证伪的关键。
 */
function faultOf(id) {
  switch (id) {
    case 'readAfterWrite': return { readAfterWrite: true }
    case 'writeHeavy': return { writeHeavy: true }
    case 'cacheCrash': return { cacheCrash: true }
    case 'asyncFlush': return { asyncFlush: true }
    case 'manyKeys': return { manyKeys: true }
    default: return {}
  }
}

/** 由探针 + opts 生成单场景写轨迹（纯数据、确定性）。 */
function workloadOf(fo, o) {
  const baseW = intOr(o.writes, CCC_DEFAULTS.writes)
  const writes = fo.writeHeavy === true ? Math.max(baseW, baseW * 4) : baseW
  const keyN = fo.manyKeys === true
    ? Math.max(2, intOr(o.manyKeys, CCC_DEFAULTS.manyKeys))
    : Math.max(1, Math.min(writes, 8))
  const rtt = o.noWriteBackendRtt === true ? 0 : Math.max(0, intOr(o.backendRttMs, CCC_DEFAULTS.backendRttMs))
  const crashAt = intOr(o.crashAtWrite, CCC_DEFAULTS.crashAtWrite)
  return { writes, keyN, rtt, crashAt, fo }
}

/* --------------------------- ① Cache-Aside 旁路缓存 --------------------------- */

/**
 * 应用先更库、成功后再删缓存，读 miss 才回填。写已同步落库 ⇒ 整机宕不丢写；
 * 但更库/删缓存非原子 ⇒ 窗口陈旧 + 旧值回填，且写路径同步打库 ⇒ 阻塞。
 */
export function createCacheAsideStore(opts = {}) {
  const o = { ...CCC_DEFAULTS, ...opts }
  let rand = typeof o.rand === 'function' ? o.rand : makeRand(o.seed)
  const randIsInternal = typeof o.rand !== 'function'
  let observableCount = 0
  // 全软肋被抹（rigged 三开关齐开）才把「非原子窗口」视作消失。
  const atomicWindow = o.rigged === true ||
    (o.atomicInvalidate === true && o.noWriteBackendRtt === true && o.atomicWriteBehind === true)

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { writes, keyN, rtt } = workloadOf(f, o)
    let backendRounds = 0, staleWindowTotal = 0, staleReads = 0

    for (let w = 0; w < writes; w++) {
      backendRounds++                                  // 每次写都同步更库
      // 更库与删缓存之间有一个非原子窗口；只在 readAfterWrite 探针下显式暴露陈旧读。
      // 窗口宽度与后端 RTT 同阶（更库完成到删缓存生效）；rigged 全抹时归零。
      const win = atomicWindow ? 0 : rtt * (0.4 + 0.6 * rand())
      staleWindowTotal += win
      if (f.readAfterWrite === true && !atomicWindow) {
        // 窗口内并发读命中旧缓存；用确定性相位决定这写是否被读到旧值。
        if (rand() < 0.5) staleReads++
      }
    }
    observableCount++
    return {
      protocol: 'CacheAside',
      writes,
      keyN,
      staleWindowMs: round4(staleWindowTotal / writes),
      staleReads,
      writeBackendRounds: backendRounds,
      writeBackendRttMs: round4(backendRounds * rtt),
      dirtyPagesLost: 0,           // 写已同步落库、缓存无未刷回脏页
      flushLagMs: 0,
      coalescedWrites: 0,
      crashed: f.cacheCrash === true,
    }
  }

  function reset() {
    observableCount = 0
    if (randIsInternal) rand = makeRand(o.seed)
  }
  return { feed, reset, get protocol() { return 'CacheAside' }, get observableCount() { return observableCount } }
}

/* --------------------------- ② Write-Through 写穿透 --------------------------- */

/**
 * 应用只写缓存、缓存层同步写穿到库、两者都成功才返回。缓存与库始终一致、落库不丢写；
 * 但每次写都吃一次库 RTT ⇒ 写路径被后端阻塞（后端越慢越致命）。
 */
export function createWriteThroughStore(opts = {}) {
  const o = { ...CCC_DEFAULTS, ...opts }
  let observableCount = 0

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { writes, keyN, rtt } = workloadOf(f, o)
    const backendRounds = writes                       // 每写一次同步写穿一次库
    observableCount++
    return {
      protocol: 'WriteThrough',
      writes,
      keyN,
      staleWindowMs: 0,            // 缓存与库同步双写，无不一致窗口
      staleReads: 0,
      writeBackendRounds: backendRounds,
      writeBackendRttMs: round4(backendRounds * rtt),
      dirtyPagesLost: 0,           // 落库才返回、无未刷回脏页
      flushLagMs: 0,
      coalescedWrites: 0,
      crashed: f.cacheCrash === true,
    }
  }

  function reset() { observableCount = 0 }
  return { feed, reset, get protocol() { return 'WriteThrough' }, get observableCount() { return observableCount } }
}

/* --------------------------- ③ Write-Behind 写回 --------------------------- */

/**
 * 只写缓存立即返回、攒够阈值/时窗再异步批量刷回。写延迟最低、同 key 合并刷回；
 * 但整机宕 ⇒ 未刷回脏页全丢。加进程内 WAL 只救同机进程崩溃 replay，不救整机 + 盘一起丢。
 */
export function createWriteBehindStore(opts = {}) {
  const o = { ...CCC_DEFAULTS, ...opts }
  let rand = typeof o.rand === 'function' ? o.rand : makeRand(o.seed)
  const randIsInternal = typeof o.rand !== 'function'
  let observableCount = 0
  // rigged 三开关齐开 或 atomicWriteBehind：改同步双写 + WAL 跨机复制 ⇒ durable 成立。
  const crossNodeReplicated = o.rigged === true ||
    (o.atomicInvalidate === true && o.noWriteBackendRtt === true && o.atomicWriteBehind === true)

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { writes, keyN, rtt, crashAt } = workloadOf(f, o)
    const threshold = Math.max(1, intOr(o.flushThreshold, CCC_DEFAULTS.flushThreshold))
    const lag = Math.max(0, intOr(o.flushLagMs, CCC_DEFAULTS.flushLagMs))
    const crashed = f.cacheCrash === true
    // cacheCrash 探针：整机宕发生在异步刷回触发之前 ⇒ 这批写全成未刷回脏页（阈值临时调到 writes+1）。
    // 这正是 Write-Behind 的硬伤落点：不宕时机智的「延迟合并」在整机宕时变成「全丢」。
    const effThreshold = crashed ? writes + 1 : threshold

    // 模拟攒页 → 到阈值刷回一批；每批一次后端往返。
    let dirty = 0, backendRounds = 0, coalesced = 0, flushLagTotal = 0
    for (let w = 0; w < writes; w++) {
      dirty++
      if (dirty >= effThreshold) {
        // 一批 coalesced 个写合并成一次刷回；跨节点复制（rigged）才付出后端 RTT。
        coalesced += dirty - 1
        backendRounds += crossNodeReplicated ? 1 : 0   // 非 rigged：异步刷回不阻塞写路径
        if (crossNodeReplicated && rtt > 0) flushLagTotal += rtt
        dirty = 0
      }
    }
    // 未刷回的尾批脏页
    const pending = dirty
    // 整机宕：未刷回的脏页全丢；仅 atomicWriteBehind（跨机 WAL quorum）能保住。
    // walEnabled（仅进程内 WAL）：能救同机进程崩溃 replay，但整机 + 盘一起丢照样丢 ⇒ 不改善 durable。
    const lost = crashed && !crossNodeReplicated ? pending : 0

    observableCount++
    return {
      protocol: 'WriteBehind',
      writes,
      keyN,
      staleWindowMs: 0,            // 写后立即读缓存是新值（对缓存 read-your-writes 成立）
      staleReads: 0,
      writeBackendRounds: backendRounds,   // 非 rigged 写路径 0 次后端往返（异步）
      writeBackendRttMs: round4(backendRounds * rtt),
      dirtyPagesLost: lost,
      dirtyPagesPending: pending,
      flushLagMs: round4(flushLagTotal / writes + (o.walEnabled ? 0 : lag * (pending > 0 ? 1 : 0) / writes)),
      coalescedWrites: coalesced,
      walEnabled: o.walEnabled === true,
      crossNodeReplicated,
      crashed,
    }
  }

  function reset() {
    observableCount = 0
    if (randIsInternal) rand = makeRand(o.seed)
  }
  return { feed, reset, get protocol() { return 'WriteBehind' }, get observableCount() { return observableCount } }
}

/* --------------------------- 场景判定 + 三难向量 --------------------------- */

/** 单协议 × 单场景跑一只格子，返回带三难三维判据的读数。 */
export function runCacheCoherencyScenario(protocol, scenario, opts = {}) {
  if (!CCC_PROTOCOLS.includes(protocol)) throw new Error(`未知协议 ${protocol}`)
  if (!CCC_SCENARIOS.includes(scenario)) throw new Error(`未知场景 ${scenario}`)
  const o = { ...CCC_DEFAULTS, ...opts }
  const fo = Array.isArray(o.faults)
    ? (o.faults[CCC_SCENARIOS.indexOf(scenario)] ?? {})
    : faultOf(scenario)

  let cell
  if (protocol === 'CacheAside') cell = createCacheAsideStore({ ...o, rand: o.rand }).feed(fo)
  else if (protocol === 'WriteThrough') cell = createWriteThroughStore({ ...o, rand: o.rand }).feed(fo)
  else cell = createWriteBehindStore({ ...o, rand: o.rand }).feed(fo)

  // 判定正交化：cacheCrash 探针只罚「整机宕不丢写」维，不连带罚「写后读可见」维。
  const crashProbe = fo.cacheCrash === true && o.atomicWriteBehind !== true && o.rigged !== true
  const readYourWrites = cell.staleReads === 0 && cell.staleWindowMs === 0
  const noWriteBlocking = cell.writeBackendRounds === 0 || o.noWriteBackendRtt === true || o.rigged === true
  const durableOnCrash = crashProbe ? cell.dirtyPagesLost === 0 : true

  return {
    id: scenario,
    writes: cell.writes,
    keyN: cell.keyN,
    staleWindowMs: cell.staleWindowMs,
    staleReads: cell.staleReads,
    writeBackendRounds: cell.writeBackendRounds,
    writeBackendRttMs: cell.writeBackendRttMs,
    dirtyPagesLost: cell.dirtyPagesLost,
    dirtyPagesPending: cell.dirtyPagesPending ?? 0,
    flushLagMs: cell.flushLagMs,
    coalescedWrites: cell.coalescedWrites,
    walEnabled: cell.walEnabled ?? false,
    crossNodeReplicated: cell.crossNodeReplicated ?? false,
    crashed: cell.crashed,
    readYourWrites,
    noWriteBlocking,
    durableOnCrash,
  }
}

/* --------------------------- 真依赖交叉印证 --------------------------- */

/** ① 真 caesura-redis-cache：写 v2 后读缓存命中新值 + hits 计数（read-your-writes 缓存侧结构）。 */
function cxRedis() {
  let t = 0
  const c = createRedisCache({ now: () => t })
  c.set('item', { v: 'v1' })
  const first = c.get('item')
  c.set('item', { v: 'v2' })
  const second = c.get('item')
  const st = c.stats()
  return {
    source: 'createRedisCache.set/get/stats(真件)',
    firstVersion: first?.v ?? null,
    secondVersion: second?.v ?? null,
    hits: st.hits,
    writeThenReadSeesNew: first?.v === 'v1' && second?.v === 'v2',
    notRealRedis: true,
  }
}

/** ② 真 caesura-lsm-store.createWal：append→lines→restore→replay；诚实标注 sink 进程内、不跨机。 */
function cxWal() {
  const sink = []
  const w = createWal({ sink })
  w.append('put', 'k1', 'v1'); w.append('put', 'k2', 'v2'); w.append('del', 'k1', null)
  const lines = w.lines()
  const w2 = createWal()
  const restored = w2.restore(lines)
  const ops = []
  const replayed = w2.replay((r) => ops.push(r.op))
  return {
    source: 'createWal.append/lines/restore/replay(真件)',
    sinkIsArray: Array.isArray(sink),
    sinkLines: sink.length,
    lines: lines.length,
    restored,
    replayed,
    replayOps: ops,
    processCrashRecoverable: restored === 3 && replayed === 3 && ops.join(',') === 'put,put,del',
    // 诚实标注：sink 是进程内数组/对象、无跨机复制 ⇒ 整机 + 盘一起丢仍丢。
    replicatedAcrossNodes: false,
    wholeNodeLossDurable: false,
  }
}

/** ③ 真 caesura-cache-guard：XFetch 随 age→TTL 单调升（提前续期降低陈旧概率但非消除）。 */
function cxGuard() {
  const young = shouldEarlyExpire({ ageMs: 100, ttlMs: 1000, beta: 2, rand: () => 0.5 })
  const old = shouldEarlyExpire({ ageMs: 800, ttlMs: 1000, beta: 2, rand: () => 0.5 })
  return {
    source: 'shouldEarlyExpire(真件)',
    youngEarly: young,
    oldEarly: old,
    monotonic: young === false && old === true,
    reducesProbabilityNotWindow: true,
  }
}

/** ④ 真 caesura-sharded-cache：manyKeys 写落多片、perShard 命中分布（写回 fanout 落点）。 */
function cxSharded(keyN) {
  const n = Math.max(2, Math.min(256, keyN))
  const keys = Array.from({ length: n }, (_, i) => 'item:' + i)
  const sc = createShardedCache()
  for (const k of keys) sc.set(k, 1)
  const hits = keys.filter((k) => sc.get(k) === 1).length
  const st = sc.stats()
  const per = Object.values(st.perShard ?? {}).map((s) => s.hits)
  return {
    source: 'createShardedCache.set/get/stats(真件)',
    written: n,
    readHits: hits,
    shards: st.shards,
    perShardHits: per,
    spread: per.length ? Math.max(...per) - Math.min(...per) : 0,
    allReadable: hits === n,
  }
}

/** ⑤ 真 caesura-mvcc-txn：库侧「写后读已提交新值」需要版本链（未提交读旧、提交后读新）。 */
function cxMvcc() {
  const store = createMvccStore({ now: () => 1000 })
  store.seed('acct', { v: 'v1' }, 0)
  const t1 = store.begin('read-committed')
  store.write(t1, 'acct', { v: 'v2' })
  const other = store.begin('read-committed')
  const before = store.read(other, 'acct')      // 别人未提交：读已提交 v1
  const cm = store.commit(t1, 10)
  const after = store.read(other, 'acct')       // 提交后 RC 新视图：v2
  const st = store.stats()
  return {
    source: 'createMvccStore.seed/begin/read/commit(真件)',
    isolation: 'read-committed',
    beforeCommitVersion: before.value?.v ?? null,
    afterCommitVersion: after.value?.v ?? null,
    committed: cm.committed === true,
    versions: st.versions,
    writeThenReadNeedsCommit: before.value?.v === 'v1' && after.value?.v === 'v2',
  }
}

/** ⑥ 真 caesura-distributed-txn：2PC 全 yes 才提交、协调者 prepare 后宕 ⇒ 全员 blocked。 */
function cxTwoPhase() {
  const ok = createTwoPhaseCommit({ participants: ['cache', 'db'] })
  const p = ok.prepare({})
  const c = ok.commit({})
  const bad = createTwoPhaseCommit({ participants: ['cache', 'db'] })
  bad.prepare({})
  const d = bad.commit({ coordinatorDown: true })
  return {
    source: 'createTwoPhaseCommit.prepare/commit(真件)',
    prepareAllYes: p.allYes === true,
    commitPhase: c.phase,
    commitMessages: c.messages,
    downPhase: d.phase,
    blockedParticipants: d.blockedParticipants,
    // 诚实标注：教学 2PC 状态机、非真把缓存纳入 XA/真跨进程协调。
    atomicCrossStoreNeedsCoordination: c.phase === 'committed' && d.phase === 'blocked',
    notRealXa: true,
  }
}

/** ⑦ 真 caesura-consistent-hash：环分布/空片/balanceRatio，对应 manyKeys 写回 fanout 落点。 */
function cxRing(keyN, virtualNodes) {
  const keys = Array.from({ length: 512 }, (_, i) => 'key:' + i)
  const r = createHashRing({
    nodes: ['behind:0', 'behind:1', 'behind:2', 'behind:3'],
    virtualNodes: Math.max(8, intOr(virtualNodes, HASH_DEFAULTS.virtualNodes)),
  })
  const dist = r.distribution(keys)
  return {
    source: 'createHashRing.distribution(真件)',
    keys: dist.total,
    nodes: dist.nodes,
    fanoutKeys: keyN,
    spread: dist.max - dist.min,
    emptyNodes: dist.emptyNodes.length,
    balanceRatio: dist.balanceRatio === null ? null : round4(dist.balanceRatio),
  }
}

async function crosscheckCacheCoherency(o) {
  return {
    redis: cxRedis(),
    wal: cxWal(),
    guard: cxGuard(),
    sharded: cxSharded(intOr(o.manyKeys, CCC_DEFAULTS.manyKeys)),
    mvcc: cxMvcc(),
    twoPhase: cxTwoPhase(),
    ring: cxRing(intOr(o.manyKeys, CCC_DEFAULTS.manyKeys), o.virtualNodes),
  }
}

/* --------------------------- 对照 / study / 快照 --------------------------- */

/**
 * 三协议 × 六场景核心对照 + 三难向量 + 真依赖交叉印证 + 可证伪判词。
 */
export async function compareCacheCoherency(opts = {}) {
  const o = { ...CCC_DEFAULTS, ...opts }
  const scenarios = o.scenarios && Array.isArray(o.scenarios) ? o.scenarios : CCC_SCENARIOS
  // rigged：三开关齐开 + 六场景 fault:{} 全空（关闭全部软肋探针）。
  const rigged = o.rigged === true || (
    o.atomicInvalidate === true && o.noWriteBackendRtt === true && o.atomicWriteBehind === true &&
    Array.isArray(o.faults) && o.faults.every((f) => f && typeof f === 'object' && Object.keys(f).length === 0)
  )
  const eff = {
    ...o,
    atomicInvalidate: rigged ? true : o.atomicInvalidate,
    noWriteBackendRtt: rigged ? true : o.noWriteBackendRtt,
    atomicWriteBehind: rigged ? true : o.atomicWriteBehind,
  }

  const rows = []
  for (const p of CCC_PROTOCOLS) {
    const cells = []
    for (const s of scenarios) cells.push(runCacheCoherencyScenario(p, s, eff))
    const trilemma = {
      readYourWrites: cells.every((c) => c.readYourWrites),
      noWriteBlocking: cells.every((c) => c.noWriteBlocking),
      durableOnCrash: cells.every((c) => c.durableOnCrash),
    }
    rows.push({
      protocol: p,
      scenarios: cells,
      totals: cells.reduce((acc, c) => ({
        staleWindowMsSum: acc.staleWindowMsSum + c.staleWindowMs,
        staleReads: acc.staleReads + c.staleReads,
        writeBackendRounds: acc.writeBackendRounds + c.writeBackendRounds,
        writeBackendRttMs: acc.writeBackendRttMs + c.writeBackendRttMs,
        dirtyPagesLost: acc.dirtyPagesLost + c.dirtyPagesLost,
        coalescedWrites: acc.coalescedWrites + c.coalescedWrites,
        crashedScenarios: acc.crashedScenarios + (c.crashed ? 1 : 0),
      }), {
        staleWindowMsSum: 0, staleReads: 0, writeBackendRounds: 0, writeBackendRttMs: 0,
        dirtyPagesLost: 0, coalescedWrites: 0, crashedScenarios: 0,
      }),
      trilemma,
    })
  }

  // 维度顺序固定 [写后读可见 / 写路径不阻塞 / 整机宕不丢写] ⇒ 登记向量 001 / 101 / 110。
  const vecOf = (r) => `${Number(r.trilemma.readYourWrites)}${Number(r.trilemma.noWriteBlocking)}${Number(r.trilemma.durableOnCrash)}`
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vecOf(r)]))
  const distinct = new Set(Object.values(vectors)).size === rows.length
  const noProtocolWinsAll = !rows.some((r) => r.trilemma.readYourWrites && r.trilemma.noWriteBlocking && r.trilemma.durableOnCrash)
  const crosscheck = await crosscheckCacheCoherency(o)

  return {
    rows,
    vectors,
    crosscheck,
    verdict: {
      vectors,
      trilemmaDistinguishes: distinct,
      noProtocolWinsAll,
      noUniversalWinner: distinct && noProtocolWinsAll,
      // 各协议专有病征（不预设各恰好缺一）
      asideHasStaleWindow: rows[0].totals.staleWindowMsSum > 0,
      asideBlocksOnBackend: rows[0].totals.writeBackendRounds > 0,
      asideDurable: rows[0].trilemma.durableOnCrash === true,
      throughConsistent: rows[1].trilemma.readYourWrites === true,
      throughBlocksOnBackend: rows[1].totals.writeBackendRounds > 0,
      behindNoWriteBlocking: rows[2].trilemma.noWriteBlocking === true,
      behindLosesDirtyOnCrash: rows[2].totals.dirtyPagesLost > 0,
      behindCoalescesWrites: rows[2].totals.coalescedWrites > 0,
      walNotDurableAcrossNode: crosscheck.wal.replicatedAcrossNodes === false && crosscheck.wal.wholeNodeLossDurable === false,
      writeBehindNotPanacea: !(rows[2].trilemma.readYourWrites && rows[2].trilemma.durableOnCrash),
    },
    config: {
      seed: o.seed,
      writes: intOr(o.writes, CCC_DEFAULTS.writes),
      manyKeys: intOr(o.manyKeys, CCC_DEFAULTS.manyKeys),
      backendRttMs: intOr(o.backendRttMs, CCC_DEFAULTS.backendRttMs),
      windowMs: intOr(o.windowMs, CCC_DEFAULTS.windowMs),
      walEnabled: o.walEnabled === true,
      rigged,
      scenarios: scenarios.slice(),
    },
  }
}

/** 完整 study：compare + topology 读数，纯数据可 JSON 往返。 */
export async function cacheCoherencyStudy(opts = {}) {
  const o = { ...CCC_DEFAULTS, ...opts }
  const cmp = await compareCacheCoherency(o)
  return {
    builtAt: startClock(o.now, CCC_DEFAULTS.now),
    ...cmp,
    topology: {
      writes: intOr(o.writes, CCC_DEFAULTS.writes),
      manyKeys: intOr(o.manyKeys, CCC_DEFAULTS.manyKeys),
      backendRttMs: intOr(o.backendRttMs, CCC_DEFAULTS.backendRttMs),
      flushThreshold: intOr(o.flushThreshold, CCC_DEFAULTS.flushThreshold),
      flushLagMs: intOr(o.flushLagMs, CCC_DEFAULTS.flushLagMs),
      crashAtWrite: intOr(o.crashAtWrite, CCC_DEFAULTS.crashAtWrite),
      windowMs: intOr(o.windowMs, CCC_DEFAULTS.windowMs),
    },
  }
}

/** 快照投影（前端只读：协议矩阵 + 三难向量 + 真件交叉印证 + 判词）。 */
export function cccSnapshot(study) {
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
      redis: { ...study.crosscheck.redis },
      wal: { ...study.crosscheck.wal },
      guard: { ...study.crosscheck.guard },
      sharded: { ...study.crosscheck.sharded },
      mvcc: { ...study.crosscheck.mvcc },
      twoPhase: { ...study.crosscheck.twoPhase },
      ring: { ...study.crosscheck.ring },
    },
    verdict: { ...study.verdict },
    topology: { ...study.topology },
  }
}

/* --------------------------- CLI --------------------------- */

function main() {
  const o = {
    seed: CCC_DEFAULTS.seed,
    now: () => 1000, // 固定时钟：CLI 双跑字节一致（与快照真 now 的绝对读数区分）
  }
  cacheCoherencyStudy(o).then((study) => {
    const snap = cccSnapshot(study)
    console.log('[ccc] 三协议 × 六场景：')
    for (const row of snap.rows) {
      const ladder = row.scenarios.map((s) => s.id + ':' + (
        s.dirtyPagesLost > 0 ? '丢' :
        s.staleReads > 0 ? '旧' :
        s.writeBackendRounds > 0 ? '阻' :
        s.coalescedWrites > 0 ? '并' : '成'
      )).join(' → ')
      console.log(`  ${row.protocol}[${ladder}]`)
    }
    console.log('[ccc] 三难向量[写后可见/写不阻塞/整机宕不丢写]', JSON.stringify(snap.vectors))
    console.log('[ccc] 不封赢家', snap.verdict.noUniversalWinner ? '是' : '否',
      '/ WriteBehind不是银弹', snap.verdict.writeBehindNotPanacea ? '是' : '否')
    const cx = snap.crosscheck
    console.log('[ccc] 交叉印证 真Redis写后读可见=' + cx.redis.writeThenReadSeesNew +
      ' / 真WAL进程崩溃可恢复=' + cx.wal.processCrashRecoverable + ' 但跨机复制=' + cx.wal.replicatedAcrossNodes +
      ' 整机宕durable=' + cx.wal.wholeNodeLossDurable +
      ' / 真XFetch单调=' + cx.guard.monotonic +
      ' / 真分片全可读=' + cx.sharded.allReadable + '(' + cx.sharded.shards + '片)' +
      ' / 真MVCC提交后才读新=' + cx.mvcc.writeThenReadNeedsCommit +
      ' / 真2PC协调者宕全员阻塞=' + cx.twoPhase.atomicCrossStoreNeedsCoordination + '(blocked ' + cx.twoPhase.blockedParticipants + ')' +
      ' / 真环空片=' + cx.ring.emptyNodes)
    console.log('[ccc] 判词', JSON.stringify(snap.verdict))
    // 可证伪自证：rigged 全 111、三判词翻 false
    const rigged = { seed: o.seed, now: () => 1000, rigged: true, faults: CCC_SCENARIOS.map(() => ({})) }
    cacheCoherencyStudy(rigged).then((rs) => {
      const rv = rs.verdict
      console.log('[ccc] RIGGED 向量', JSON.stringify(rs.vectors),
        'trilemmaDistinguishes=' + rv.trilemmaDistinguishes,
        'noProtocolWinsAll=' + rv.noProtocolWinsAll,
        'noUniversalWinner=' + rv.noUniversalWinner)
      console.log(rv.trilemmaDistinguishes === false && rv.noProtocolWinsAll === false && rv.noUniversalWinner === false
        ? '[ccc] RIGGED_FALSIFIABLE_OK' : '[ccc] RIGGED_FAIL')
    })
  }).catch((e) => { console.error('[ccc] error', e); process.exitCode = 1 })
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
    import.meta.url.endsWith('/caesura-cache-coherency.mjs') && process.argv[1]?.includes('caesura-cache-coherency')) {
  main()
}
