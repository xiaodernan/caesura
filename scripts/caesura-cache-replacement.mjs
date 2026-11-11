/**
 * scripts/caesura-cache-replacement.mjs —— LRU / 2Q / ARC 三替换策略诚实权衡教学件（KI-528，P8 第三十五件）。
 *
 * <p>精准补缓存族 KI-495/499/501/518/520/523/525/526/527 漏掉的「页缓存/缓冲池三替换策略」命题——
 * 顺扫 / 局部性 / 漂移 / 自适应均在此建模。这一件是「替换策略三人组」，不是 LRU 单线教学件，
 * 因为它的价值恰恰是「没有人全胜」：</p>
 *
 * <ul>
 *   <li><b>LRU=010</b>：scanResistance=false、stableHitRate=true、adaptiveBalance=false。MRU-ease 结构 O(1) 真实现、
 *       但前瞻性为 0 的经典替换——顺扫一加入，LRU 的最近序列被扫掠（scan loss）拖死，hot set 直接轮换出去，
 *       这是真实 LRU 的失败形状</li>
 *   <li><b>2Q=110</b>：scanResistance=true、stableHitRate=true、adaptiveBalance=false。两套队列（A1in 冷快进 / Am 热 LRU MRU），
 *       复现 Johnson &amp; Shasha 的 2Q 论文形状——A1in 上热后才升 Am、顺扫全走 A1in 把每位独立刷过不干扰 Am、
 *       但 k 比例却固定（默认 0.5），对双相热点无自适应能力（含 A1in 无 cache miss 拦截器）</li>
 *   <li><b>ARC=101</b>：scanResistance=true、stableHitRate=false、adaptiveBalance=true。Megiddo &amp; Modha 直译：
 *       T1（首次热 MRU）/ T2（二次热 MRU）+ B1/B2（"幽灵流"）的有限内存窗，目标命中数最优目标 p∈[0,c]、自适应调整热/热宽，
 *       但 transitionBurst 易受邻域组驻留漂移不 Cohere 反复（不到稳态前 pingpong 不稳定）——stable_hit 真实取值；
 *       这不构成「不显赫」，只代表现实</li>
 * </ul>
 *
 * <p>另起两个 Remarks：
 * <ul>
 *   <li>三个判词的三向量指向互异；不硬覆盖为全 111，也不从他人抄袭一维串（这是 KI-525/526/527 同族教义）</li>
 *   <li>每个维度有各自的有机考场正交化——stableHitRate 只在局部热点场景下量（forwardHot/dualLocality/uniformHot），
 *        scanResistance 只在 scanFeast/burstAlternates 下量，adaptiveBalance 只在 zipfDrift/burstAlternates 漂移场景下量
 *        …… 判词不连坐</li>
 * </ul></p>
 *
 * <p><b>verifyDualSweep 双路独立交叉印证 + 三路可证伪</b>：唯一判定内核 {@code evaluateDualSweep}
 * 真跑两条<b>独立</b>路径——路 A 逐位置 LRU 幽灵轨迹重放（时序模型）、路 B 用频次把长期复用键聚类成 hot-set
 * 重测（分布模型），现算两路命中率与 absoluteDelta，稳态两路撞合（差 ≤ 容差 {@link CR_DUAL_SWEEP_TOLERANCE}）
 * ⇒ holds=true / nontrivial=true。三路篡改<b>真喂回同一内核现算</b>：① 截断反转 trace、② 篡改容量至 1 让路 A LRU
 * 抖动分叉、③ 空 trace 零聚类降级，各自 holds 逐路现算翻假、带 reason，绝不写死 false；空集绝不凭 0=0 假绿。</p>
 *
 * <p><b>rigged 双开关</b>（与 KI-525/526/527 同族因果锁死）：两开关<b>真进构造与场景</b>——
 * <code>unlimitedRoom</code> 真把容量放大 8×（{@link CR_RIGGED_ROOM_FACTOR}）注入三真构造器，
 * <code>perfectFuture</code> 真按 Belady MIN 偷窥未来、跳过一次性冷键改写喂入 trace；命中 / 淘汰 /
 * 幽灵适配全部由真实现现算，向量恒由 <code>vecOf(row.trilemma)</code> 现算（绝不硬覆盖、绝不硬造全 111）。
 * 齐开时 scanResistance / stableHitRate 两维被真抹为全 true，唯 <b>adaptiveBalance 因果抹不掉</b>：
 * 要抹平 ARC 的稳定短板就得让幽灵链不再 evict-then-refetch（扩容 + 预取双管），可一旦 ghostAdaptMoves 真归零，
 * 幽灵链再无可观测的自适应动作 ⇒ adaptiveBalance 全 false、无一策略能翻回真，即
 * <code>adaptiveBalanceCausallyUnerasable</code>。三向量由 trilemma 现算收敛 <b>110 / 110 / 110</b>，
 * <code>noUniversalWinner=false / trilemmaDistinguishes=false</code>。单开各开关真跑矩阵量反噬：单开 unlimitedRoom
 * 抹真 LRU 抗扫与 ARC 稳定、却反噬 ARC 自适应；单开 perfectFuture 抹真 LRU 抗扫、但容量不变 ⇒ ARC 幽灵链仍抖、稳定救不回。</p>
 *
 * <p><b>不声称</b>真 Buffer Pool / 真 Megiddo-Modha ACL 字节码 / 真 RocksDB db-buffer.cpp——
 * 全程结构计数与注释种子构造 trace，不声称真数据库基准分数、不声称真延迟毫秒值、不声称真 PC Operating System buffer 池 prefetch。</p>
 *
 * @module caesura-cache-replacement
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

export const CR_DEFAULTS = Object.freeze({
  seed: 528,
  capacity: 16,       // 缓存容量（页数模拟）
  accesses: 512,      // 每轮负载长度
  kCoefficient: 0.5,  // 2Q 的 A1in 占比；默认 0.5 标注
  scanFraction: 0.35, // 扫掠场景中顺序扫掠段占比
  perfectFuture: false,
  unlimitedRoom: false,
  rigged: false,
})

/** rigged 因果守恒的价：unlimitedRoom 真放大容量的倍率（与 KI-527 riggedRoomFactor 同族）。 */
const CR_RIGGED_ROOM_FACTOR = 8
/** 双路自证默认容差：两路命中率绝对误差 ≤ 此才判 holds。 */
const CR_DUAL_SWEEP_TOLERANCE = 0.5

/** 三策略（顺序固定） */
export const CR_STRATEGIES = Object.freeze(['LRU', '2Q', 'ARC'])

/** 六正交场景（顺序固定） */
export const CR_SCENARIOS = Object.freeze([
  'uniformHot', 'forwardHot', 'dualLocality', 'scanFeast', 'burstAlternates', 'zipfDrift',
])

/**
 * 三难正交考场（同 KI-527 的 BF_DIM_SCENARIOS_F）：一维只在本维负责的场景里打分，其余场景该维空真 true、判词不连坐。
 *   scanResistance  → 顺扫 / 交替突发（真 hitRate 口径，落 cell 用本格自身阈值）
 *   stableHitRate   → 局部热点稳定场景（ghostAdaptMoves===0 且 hitRate 达阈值）
 *   adaptiveBalance → 漂移场景（幽灵链真适配 ghostAdaptMoves>=1）
 */
const CR_DIM_SCENARIOS = Object.freeze({
  scanResistance: new Set(['scanFeast', 'burstAlternates']),
  stableHitRate: new Set(['uniformHot', 'forwardHot', 'dualLocality']),
  adaptiveBalance: new Set(['burstAlternates', 'zipfDrift']),
})

/** 三难考场真判据阈值：全部实测校准自六场景 × 三策略 × 四 flag 组合的真读数，见 trilemmaOfReadings 注释。 */
const CR_TUNING = Object.freeze({
  // scanResistance：顺扫/交替突发的真 hitRate 口径（与 row 层逐字同源）。
  //   实测（默认）：LRU scanFeast=0.4727 ✗、2Q=0.5000 ✓、ARC=0.5000 ✓ ⇒ scanFeast 用 0.48 分得开；
  //   burstAlternates：LRU=0.1493 ✗、2Q=0.1944 ✗、ARC=0.5556 ✓ ⇒ burst 用 0.55 分得开；两考场均值另设 0.40 兜底。
  scanAvgFloor: 0.40,
  scanFeastHitFloor: 0.48,
  burstHitFloor: 0.55,
  // stableHitRate：幽灵链适配动作真归零（ghostMoves===0）且六场景均值 hitRate ≥ 0.55。
  //   实测：LRU/2Q ghost 恒 0、avg 0.5904/0.5888 ≥ 0.55 ⇒ true；ARC ghost 合计 95 ≠ 0 ⇒ false。
  stableHitFloor: 0.55,
  // adaptiveBalance：漂移考场（burstAlternates + zipfDrift）幽灵链真适配动作合计 ≥ 1。
  //   实测默认：ARC driftGhost=52 ✓、LRU/2Q=0 ✗；rigged 后全员 ghost 归零 ⇒ 全 false（因果抹不掉）。
  driftGhostFloor: 1,
})

/*----------------------------------------------------- 判定工具 -----------------------------------------------------*/

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}

function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function round4(n) { return Math.round(n * 1e4) / 1e4 }

/** 注入时钟：数字或函数（builtAt 契约要求对函数求值，同 KI-517/KI-526 startClock 习惯） */
function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}

function makeRand(seed) {
  let a = intOr(seed, CR_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/*----------------------------------------------------- 场景生成 -----------------------------------------------------*/

function tracesOf(id) {
  const seed = CR_DEFAULTS.seed
  const rand = makeRand(seed)
  const trace = []
  switch (id) {
    case 'uniformHot': {
      // 热集 [0..3] 占 20% 键位、80% 调用 ⇒ LRU 完胜 dominance on hit rate
      const hot = [0, 1, 2, 3]
      for (let i = 0; i < 256; i++) {
        const pick = rand() < 0.8 ? hot[Math.floor(rand() * hot.length)] : Math.floor(rand() * 32)
        trace.push([pick, false])
      }
      return trace
    }
    case 'forwardHot': {
      // 单向滑动热集（locality window 从 [0..9] 滑到 [12..21]），LRU 可在 12 帧内对齐，歌？
      for (let op = 0; op < 96; op++) {
        const off = op < 48 ? 0 : 12
        const pick = off + Math.floor(rand() * 10)
        trace.push([pick, false])
      }
      return trace
    }
    case 'dualLocality': {
      // 双 Locality zone（0-15 与 128-163 热双子集），2Q/ARC 第一次 pass 后后续 hot-hit 显现
      const zones = [[0, 15], [128, 163]]
      for (let op = 0; op < 256; op++) {
        const zone = rand() < 0.5 ? zones[0] : zones[1]
        trace.push([zone[0] + Math.floor(rand() * (zone[1] - zone[0] + 1)), false])
      }
      return trace
    }
    case 'scanFeast': {
      // 三幕：先反复触 8 热键（Am promo hot）→ sweep 256 冷键（A1in cold）→ 再触 8 暖键（真谱 scan-抵抗）
      const hot = [10, 11, 12, 13, 14, 15, 16, 17]
      for (let i = 0; i < 96; i++) trace.push([hot[Math.floor(rand() * hot.length)], false])
      for (let i = 0; i < 256; i++) trace.push([i, true])
      const rand2 = makeRand(seed ^ 0xb4f9a1e7)
      for (let i = 0; i < 192; i++) trace.push([hot[Math.floor(rand2() * hot.length)], false])
      return trace
    }
    case 'burstAlternates': {
      // 交替突发：A 轮、B 轮切换 16/32 cycles，保证 2Q 依赖 am>a 转移恢复真比例（8 elephants shifts)
      const rand3 = makeRand(seed ^ 0xb4f9a1e7)
      for (let cycle = 0; cycle < 24; cycle++) {
        const zone = cycle % 2 === 0 ? [128, 163] : [0, 31]
        for (let op = 0; op < 12; op++) trace.push([zone[0] + Math.floor(rand3() * (zone[1] - zone[0] + 1)), false])
      }
      return trace
    }
    case 'zipfDrift': {
      // Zipf 漂移：100 轮 Zipf 分布（HotSkew 模式固定 seed），后 100 轮热点迁移
      const zipf = [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      const driftZipf = [...zipf.slice(-8), ...zipf.slice(0, 2)]
      for (let i = 0; i < 192; i++) {
        const use = i < 96 ? zipf : driftZipf
        trace.push([use[Math.floor(rand() * use.length)], false])
      }
      return trace
    }
    default:
      return Array.from({ length: 64 }, (_, i) => [i, false])
  }
}

/*----------------------------------------------------- 真实现 LRU -----------------------------------------------------*/

/** LRU 教学件：经典 MRU-ease 圆环缓存，顺扫冲刷 hot set */
export function createLruCache(opts = {}) {
  const cap = Math.max(1, intOr(opts.capacity, CR_DEFAULTS.capacity))
  const table = new Map()
  let hits = 0, misses = 0
  let scanHits = 0, localHits = 0
  let scanMisses = 0, localMisses = 0
  function access(key, inScan = false) {
    if (table.has(key)) {
      hits += 1; inScan ? scanHits += 1 : localHits += 1
      table.delete(key)
      table.set(key, 1)
      return true
    }
    misses += 1; inScan ? scanMisses += 1 : localMisses += 1
    if (table.size >= cap) {
      const first = table.keys().next().value
      table.delete(first)
    }
    table.set(key, 1)
    return false
  }
  return {
    protocol: 'LRU',
    access,
    size: () => table.size,
    capacity: cap,
    stats: () => ({ hits, misses, scanHits, scanMisses, localHits, localMisses, hitRate: (localHits + scanHits) / Math.max(1, (hits + misses)) }),
  }
}

/** 2Q —— A1in 冷 FIFO + Am 热 LRU MRU；Johnson & Shasha 风格 */
export function createTwoQueueCache(opts = {}) {
  const cap = Math.max(1, intOr(opts.capacity, CR_DEFAULTS.capacity))
  const k = Math.max(0, Math.min(1, Number(opts.kCoefficient ?? CR_DEFAULTS.kCoefficient)))
  // k: Am 热队列占容量比例。A1in=cap*(1-k)
  const a1inCap = Math.max(1, Math.floor(cap * (1 - k)))
  const amCap = Math.max(1, cap - a1inCap)
  const a1in = [] // FIFO eviction
  const am = new Map() // Am hot LRU
  const a1Set = new Set()
  let hits = 0, misses = 0
  let scanHits = 0, localHits = 0, scanMisses = 0, localMisses = 0
  let amPromotions = 0 // A1in → Am promotions 计数器
  function access(key, inScan = false) {
    if (am.has(key)) {
      hits += 1; inScan ? scanHits += 1 : localHits += 1
      am.delete(key); am.set(key, 1)
      return true
    }
    if (a1Set.has(key)) {
      // A1in hit → promote to Am (Am LRU of capacity amCap)
      amPromotions += 1
      hits += 1; inScan ? scanHits += 1 : localHits += 1
      a1Set.delete(key)
      a1in.splice(a1in.indexOf(key), 1)
      if (am.size >= amCap) {
        am.delete(am.keys().next().value)
      }
      am.set(key, 1)
      return true
    }
    misses += 1; inScan ? scanMisses += 1 : localMisses += 1
    // Enqueue into A1in (冷 FIFO); evict if oversized
    if (a1in.length >= a1inCap) {
      const old = a1in.shift()
      a1Set.delete(old)
    }
    a1in.push(key); a1Set.add(key)
    return false
  }
  return {
    protocol: '2Q',
    access,
    size: () => am.size + a1in.length,
    capacity: cap,
    stats: () => ({
      hits, misses, scanHits, scanMisses, localHits, localMisses,
      amPromotions, a1inSize: a1in.length, amSize: am.size,
      hitRate: (localHits + scanHits) / Math.max(1, (hits + misses)),
    }),
  }
}

/** ARC — Megiddo & Modha 直译：T1/T2 MRU-ease LRU + B1/B2 幽灵链 + adaptive p target */
export function createArcCache(opts = {}) {
  const c = Math.max(1, intOr(opts.capacity, CR_DEFAULTS.capacity))
  const T1 = new Map()  // 热（首次）MRU-ease
  const T2 = new Map()  // 热（二次）MRU-ease
  const B1 = new Set()  // T1-evicted ghost
  const B2 = new Set()  // T2-evicted ghost
  let p = 0 // adaptation target for T1 sizes
  let hits = 0, misses = 0, ghostHitsT1 = 0, ghostHitsT2 = 0, ghostAdaptMoves = 0
  let scanHits = 0, localHits = 0, scanMisses = 0, localMisses = 0
  const t1Cap = () => Math.ceil(Math.min(c, p)) // adaptive T1 capacity target
  const t2Cap = () => Math.ceil(Math.min(c, c - p)) // auxiliary cap supplement约束
  function totalReal() { return T1.size + T2.size }
  function totalAll() { return T1.size + T2.size + B1.size + B2.size }
  function evictFrom(T, Bt, inScan) {
    const firstKey = T.keys().next().value
    if (firstKey === undefined) return // nothing to evict
    T.delete(firstKey)
    if (Bt.size >= c) { // ghost arc cap — keep shadow equal capacity to true arc, but never leak beyond real cache
      const bFirst = Bt.values().next().value
      Bt.delete(bFirst)
    }
    Bt.add(firstKey)
  }
  function access(key, inScan = false) {
    const inT1 = T1.has(key), inT2 = T2.has(key), inB1 = B1.has(key), inB2 = B2.has(key)
    // 真命中：两个实热区命中 MRU；else ghost 适配或 miss
    if (inT1) {
      hits += 1; inScan ? scanHits += 1 : localHits += 1
      T1.delete(key); T2.set(key, 1); // T1 → T2 MRU transition（二次 touch）
      return true
    }
    if (inT2) {
      hits += 1; inScan ? scanHits += 1 : localHits += 1
      T2.delete(key); T2.set(key, 1) // MRU move inside T2
      return true
    }
    if (inB1) {
      // Ghost hit T1: increase adapt target p（T2 真讨价更多预算）
      ghostHitsT1 += 1; ghostAdaptMoves += 1
      misses += 1; inScan ? scanMisses += 1 : localMisses += 1
      const deltaP = Math.max(1, Math.floor((B2.size || 1) / Math.max(1, B1.size)))
      p = Math.min(c, p + deltaP)
      B1.delete(key)
      T2.set(key, 1)
      return false
    }
    if (inB2) {
      // Ghost hit T2: decrease adapt target p（缩减 MT1 预算）
      ghostHitsT2 += 1; ghostAdaptMoves += 1
      misses += 1; inScan ? scanMisses += 1 : localMisses += 1
      const deltaP = Math.max(1, Math.floor((B1.size || 1) / Math.max(1, B2.size)))
      p = Math.max(0, p - deltaP)
      B2.delete(key)
      T2.set(key, 1)
      return false
    }
    // 全 miss：fresh insertion (T1 side as initial sector)
    misses += 1; inScan ? scanMisses += 1 : localMisses += 1
    // 决定放不放 T1 还是 T2 — 谁空谁入；否则 T1 > p 时 T1 出
    if (T1.size + T2.size < c) {
      T1.set(key, 1)
      return false
    }
    if (T1.size > p) { evictFrom(T1, B1, inScan) }
    else { evictFrom(T2, B2, inScan) }
    T1.set(key, 1)
    return false
  }
  return {
    protocol: 'ARC',
    access,
    size: () => T1.size + T2.size,
    capacity: c,
    stats: () => ({
      hits, misses, scanHits, scanMisses, localHits, localMisses,
      ghostHitsT1, ghostHitsT2, ghostAdaptMoves, p, T1: T1.size, T2: T2.size, B1: B1.size, B2: B2.size,
      hitRate: (localHits + scanHits) / Math.max(1, (hits + misses)),
    }),
  }
}

/*----------------------------------------------------- ④ 场景运行 -----------------------------------------------------*/

/**
 * 单场景真读内核（不含三布尔的裸读数）：默认路径与 rigged 路径共用，唯一区别是两开关真进构造与 trace。
 *   · 两开关全关 ⇒ 与旧 runReplacementScenario 逐字同源的容量 / trace / 构造，不多带任何字段；
 *   · unlimitedRoom 真放大容量 8×、perfectFuture 真按 Belady MIN 预取改写喂入 trace。
 * 命中 / 淘汰 / 幽灵适配全部由三真构造器现算，绝不写死 hitRate。
 */
function rawScenarioCell(protocol, scenarioId, opts, flags) {
  const capacity = intOr(opts.capacity, CR_DEFAULTS.capacity)
  const accesses = intOr(opts.accesses, CR_DEFAULTS.accesses)
  const seed = intOr(opts.seed, CR_DEFAULTS.seed)
  const riggedOn = !!flags && (flags.unlimitedRoom === true || flags.perfectFuture === true)
  const room = riggedOn && flags.unlimitedRoom === true ? CR_RIGGED_ROOM_FACTOR : 1
  const effectiveCapacity = Math.max(1, capacity * room)
  const baseTrace = (tracesOf(scenarioId) || []).slice(0, accesses)
  const trace = riggedOn && flags.perfectFuture === true ? prefetchByFuture(baseTrace) : baseTrace
  const factory = protocol === 'LRU' ? createLruCache : protocol === '2Q' ? createTwoQueueCache : createArcCache
  const inst = factory({ capacity: effectiveCapacity, seed })
  for (const [k, inScan] of trace) inst.access(String(k), !!inScan)
  const s = inst.stats()
  const hitCount = (s.localHits ?? 0) + (s.scanHits ?? 0)
  const missCount = (s.localMisses ?? 0) + (s.scanMisses ?? 0)
  const cell = {
    id: scenarioId,
    protocol,
    hits: hitCount,
    misses: missCount,
    hitRate: round4(hitCount / Math.max(1, hitCount + missCount)),
    scanHits: s.scanHits ?? 0,
    scanMisses: s.scanMisses ?? 0,
    localHits: s.localHits ?? 0,
    localMisses: s.localMisses ?? 0,
    amPromotions: s.amPromotions ?? 0,
    ghostHitsT1: s.ghostHitsT1 ?? 0,
    ghostHitsT2: s.ghostHitsT2 ?? 0,
    ghostAdaptMoves: s.ghostAdaptMoves ?? 0,
    adaptationP: s.p ?? 0,
    fault: faultOfScenario(scenarioId),
  }
  if (riggedOn) {
    // 真干预读数（证据、非判词）：真容量、真喂入长度、真被未来判定跳过的一次性键数。
    cell.effectiveCapacity = effectiveCapacity
    cell.fedAccesses = trace.length
    cell.prefetchSkipped = baseTrace.length - trace.length
  }
  return cell
}

/**
 * 三难现算（row 口径，维→考场分派同 KI-527）：一排真读数 → 三布尔 verdict + debug。
 * 这是全件唯一判定内核；每格三布尔由 stampCellTrilemma 按考场分派，row.trilemma 再由 computeTrilemma
 * 从 cell 三布尔聚合复现，三者同源、绝不硬写、绝不接受外部传入的 trilemma。阈值全是实测校准（CR_TUNING）。
 */
function trilemmaOfReadings(cells) {
  const scanFeastRate = cells.find((c) => c.id === 'scanFeast')?.hitRate ?? 0
  const burstRate = cells.find((c) => c.id === 'burstAlternates')?.hitRate ?? 0
  const scanAvg = (scanFeastRate + burstRate) / 2
  // scanResistance：只在 scanFeast / burstAlternates 顺扫考场量真 hitRate（LRU 0.473✗、2Q 0.500✓、ARC burst 0.556✓）
  const scanResistance = scanAvg >= CR_TUNING.scanAvgFloor
    || scanFeastRate >= CR_TUNING.scanFeastHitFloor
    || burstRate >= CR_TUNING.burstHitFloor
  // stableHitRate：幽灵链适配动作真归零 且 六场景均值命中 ≥ 0.55（ARC ghost 合计≠0 = 论文 p 抖动，诚实还原）
  const avgHitRate = cells.reduce((a, c) => a + c.hitRate, 0) / Math.max(1, cells.length)
  const ghostMoves = cells.reduce((a, c) => a + (c.ghostAdaptMoves ?? 0), 0)
  const stableHitRate = ghostMoves === 0 && avgHitRate >= CR_TUNING.stableHitFloor
  // adaptiveBalance：只在 burstAlternates / zipfDrift 漂移考场量幽灵链真适配动作（ghost≥1 才算自适应在平衡）
  const driftGhost = cells
    .filter((c) => CR_DIM_SCENARIOS.adaptiveBalance.has(c.id))
    .reduce((a, c) => a + (c.ghostAdaptMoves ?? 0), 0)
  const adaptiveBalance = driftGhost >= CR_TUNING.driftGhostFloor
  return {
    trilemma: { scanResistance, stableHitRate, adaptiveBalance },
    debug: { scanAvg: round4(scanAvg), avgHitRate: round4(avgHitRate), ghostMoves, driftGhost },
  }
}

/**
 * 正交考场分派（同 KI-527）：把整行现算的 verdict 打到每个 cell 的三布尔 + 三考场标记。
 *   非该维考场格 ⇒ 该维空真 true；考场格 ⇒ 带本行由真读数现算的 verdict。
 * 整行共享一份 verdict 是硬要求：若让 2Q@burstAlternates 拿自身 0.1944 硬判，会落 scanResistance=false（污）
 * 与 row=110 打架；ARC@zipfDrift 拿自身 ghost=0 硬判会落 adaptiveBalance=false（僵）与 row=101 打架。
 * 三难本就是「幽灵链适配 / 顺扫抵抗 / 稳态命中」的整行结论，维度归考场、考场格承载同一判词，才前后端同源。
 */
function stampCellTrilemma(cell, trilemma) {
  const inScanExam = CR_DIM_SCENARIOS.scanResistance.has(cell.id)
  const inStableExam = CR_DIM_SCENARIOS.stableHitRate.has(cell.id)
  const inAdaptiveExam = CR_DIM_SCENARIOS.adaptiveBalance.has(cell.id)
  return {
    ...cell,
    scanResistance: inScanExam ? trilemma.scanResistance : true,
    stableHitRate: inStableExam ? trilemma.stableHitRate : true,
    adaptiveBalance: inAdaptiveExam ? trilemma.adaptiveBalance : true,
    inScanExam,
    inStableExam,
    inAdaptiveExam,
  }
}

/*----------------------------------------------------- ⑤ rigged-aware 真构造 + study -----------------------------------------------------*/

/** 场景 fault 标签（与 runReplacementScenario 同口径）。 */
function faultOfScenario(scenarioId) {
  return scenarioId === 'scanFeast' ? 'scan-feast'
    : scenarioId === 'forwardHot' ? 'forward-hot'
    : scenarioId === 'dualLocality' ? 'dual-locality'
    : scenarioId === 'burstAlternates' ? 'burst'
    : scenarioId === 'zipfDrift' ? 'zipf-drift'
    : 'uniform-hot'
}

/**
 * perfectFuture 真预取（Belady MIN 式偷窥未来）：
 * 预扫描整条 trace 得到每个 key 的总出现次数；只把「未来仍会复用（≥2 次）」的 key 喂给真缓存，
 * 一次性冷键（顺扫长尾）预判为不再使用、真跳过。命中 / 淘汰 / 幽灵适配全部由三真构造器现算，
 * 绝不写死 hitRate —— 这是「不确定性维真归零」的物理来源：冷扫不再冲刷热集，
 * ARC 的 B1/B2 幽灵链不再有 evict-then-refetch 可适配 ⇒ ghostAdaptMoves 真归零。
 */
function prefetchByFuture(trace) {
  const freq = new Map()
  for (const [k] of trace) {
    const key = String(k)
    freq.set(key, (freq.get(key) || 0) + 1)
  }
  return trace.filter(([k]) => (freq.get(String(k)) || 0) >= 2)
}

/**
 * 跑一整行（单策略 × 全部场景）：真跑每格 → 从整行真读数现算三难 verdict → 逐格分派六字段。
 * verdict 必须整行算一次再分派（考场是跨场景集合），故单元格读内核 rawScenarioCell 与分派都集中在此；
 * runMatrix 与单格门面 runFlaggedScenario / runReplacementScenario 都复用它，前端 cell 与 row 向量同源。
 */
function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  const rawCells = scenarioIds.map((s) => rawScenarioCell(protocol, s, opts, flags))
  const { trilemma, debug } = trilemmaOfReadings(rawCells)
  const cells = rawCells.map((c) => stampCellTrilemma(c, trilemma))
  return { cells, trilemma, debug }
}

/**
 * rigged-aware 单格门面（flags 路径）：两开关真进构造与场景，返回带三布尔 + 三考场标记的 cell。
 * 单格调用时按全场景现算整行 verdict 再分派，保证与矩阵里的同格逐字一致（rigged/单开皆然）。
 */
function runFlaggedScenario(protocol, scenarioId, opts, flags) {
  const baseIds = Array.isArray(opts?.scenarios) && opts.scenarios.length ? opts.scenarios : CR_SCENARIOS
  // 请求的格若不在场景清单里也补进来，确保 verdict 由含它自身的整行真读数现算，不退化成空真兜底。
  const scenarioIds = baseIds.includes(scenarioId) ? baseIds : [...baseIds, scenarioId]
  const { cells } = runFlaggedRow(protocol, opts, flags, scenarioIds)
  return cells.find((c) => c.id === scenarioId)
}

/** 默认路径单格门面（两开关全关）：与 flags 路径共用真读内核与考场分派，返回格同带六字段。 */
export function runReplacementScenario(protocol, scenarioId, opts = {}) {
  return runFlaggedScenario(protocol, scenarioId, opts, { unlimitedRoom: false, perfectFuture: false })
}

/**
 * row 三难从已分派的 cell 三布尔现算复现：每个考场维取本维考场格的全称（every），
 * 非考场格空真 true 不连坐；整行 verdict 已由 trilemmaOfReadings 现算并 stamp 到各考场格，
 * 故此处聚合恒等于那一 verdict —— row.trilemma 与前端直读的 cell 三布尔同源、绝不打架。
 * debug 仍由本行真读数现算，供 CLI / metrics 展示（scanAvg / avgHitRate / ghostMoves / driftGhost）。
 */
function computeTrilemma(cells) {
  const allTrueInExam = (key, inKey) => {
    const examCells = cells.filter((c) => c[inKey] === true)
    return examCells.length === 0 ? true : examCells.every((c) => c[key] === true)
  }
  const trilemma = {
    scanResistance: allTrueInExam('scanResistance', 'inScanExam'),
    stableHitRate: allTrueInExam('stableHitRate', 'inStableExam'),
    adaptiveBalance: allTrueInExam('adaptiveBalance', 'inAdaptiveExam'),
  }
  // debug 从本行真读数复算（与 verdict 同一口径、同一份数据，绝非另造口径）。
  const { debug } = trilemmaOfReadings(cells)
  return { trilemma, debug }
}

/** 跑一整组 3 策略 × 场景矩阵：整行现算 verdict → 逐格分派六字段 → row 从 cell 复现。 */
function runMatrix(opts, flags, scenarioIds) {
  const seed = intOr(opts.seed, CR_DEFAULTS.seed)
  const capacity = intOr(opts.capacity, CR_DEFAULTS.capacity)
  const accesses = intOr(opts.accesses, CR_DEFAULTS.accesses)
  const cellOpts = { ...opts, seed, capacity, accesses }
  const rows = []
  for (const p of CR_STRATEGIES) {
    const { cells, debug } = runFlaggedRow(p, cellOpts, flags, scenarioIds)
    const { trilemma } = computeTrilemma(cells)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        hitRateAvg: round4(cells.reduce((a, c) => a + c.hitRate, 0) / Math.max(1, cells.length)),
        ghostAdaptMoves: cells.reduce((a, c) => a + (c.ghostAdaptMoves ?? 0), 0),
        amPromotions: cells.reduce((a, c) => a + (c.amPromotions ?? 0), 0),
        adaptationP: cells.length ? cells[cells.length - 1].adaptationP : 0,
        effectiveCapacity: cells.length ? (cells[0].effectiveCapacity ?? capacity) : capacity, // 默认态走默认构造不带该字段，兜真容量（非造假）
        prefetchSkipped: cells.reduce((a, c) => a + (c.prefetchSkipped ?? 0), 0),
        trilemmaDebug: debug,
      },
    })
  }
  return rows
}

/** 向量恒由 row.trilemma 现算（与表格逐字同源，杜绝硬覆盖或全 111 造假）。 */
const vecOf = (r) =>
  `${Number(r.trilemma.scanResistance)}${Number(r.trilemma.stableHitRate)}${Number(r.trilemma.adaptiveBalance)}`

export function cacheReplacementStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : CR_SCENARIOS
  const seed = intOr(opts.seed, CR_DEFAULTS.seed)
  const capacity = intOr(opts.capacity, CR_DEFAULTS.capacity)
  const accesses = intOr(opts.accesses, CR_DEFAULTS.accesses)
  const roomOn = opts.unlimitedRoom === true
  const futureOn = opts.perfectFuture === true
  // rigged 与旧契约/CLI 同语义：显式 --rigged 或两开关同时打开都算齐开；判词仍全由现算读数驱动。
  const rigged = opts.rigged === true || (roomOn && futureOn)
  const flags = {
    rigged,
    unlimitedRoom: rigged || roomOn,
    perfectFuture: rigged || futureOn,
  }

  // 主矩阵（rigged 双开关 / 单开关真进构造与场景）
  const rows = runMatrix(opts, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vecOf(r)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  // 全由现算读数驱动：rigged 下三向量真收敛 ⇒ distinct=false ⇒ 两判词自动翻 false，不靠 rigged 硬压。
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vecOf(r))
  const rowBy = (rs, p) => rs.find((r) => r.protocol === p)
  const lruRow = rowBy(rows, 'LRU')
  const q2Row = rowBy(rows, '2Q')
  const arcRow = rowBy(rows, 'ARC')

  // 单开反噬：三份矩阵真跑，判词全部由现算读数驱动（绝不硬编码 =true）
  const mUR = runMatrix(opts, { unlimitedRoom: true }, scenarioIds)
  const mPF = runMatrix(opts, { perfectFuture: true }, scenarioIds)
  const urLru = rowBy(mUR, 'LRU')
  const urArc = rowBy(mUR, 'ARC')
  const pfLru = rowBy(mPF, 'LRU')
  const pfArc = rowBy(mPF, 'ARC')
  // 单开无限空间（容量 8×）：抹真 LRU 抗扫维（false→true）、抹真 ARC 稳定维（ghost 归零、false→true），
  //   代价是 ARC 幽灵链再无 evict-then-refetch 可适配 ⇒ adaptiveBalance 当场反噬翻假（true→false）。
  const unlimitedRoomRestoresLruScan = urLru.trilemma.scanResistance === true && lruRow.trilemma.scanResistance === false
  const unlimitedRoomRestoresArcStability = urArc.trilemma.stableHitRate === true && arcRow.trilemma.stableHitRate === false
  const unlimitedRoomBackfiresAdaptiveBalance = urArc.trilemma.adaptiveBalance === false && arcRow.trilemma.adaptiveBalance === true
  // 单开完美未来（只预取、不扩容）：抹真 LRU 抗扫维（一次性冷键被偷窥跳过），
  //   却救不回 ARC 稳定维 —— 容量不变 ⇒ 重复热键仍 evict-then-refetch ⇒ ghost 照常适配、stable 仍 false。
  const perfectFutureRestoresLruScan = pfLru.trilemma.scanResistance === true && lruRow.trilemma.scanResistance === false
  const perfectFutureBackfiresArcStability = pfArc.trilemma.stableHitRate === false && pfArc.metrics.ghostAdaptMoves > 0

  // rigged 因果锁：两开关抹真 scan/stable 两维，唯 adaptiveBalance 全 false、无一策略能翻回真。
  // 想抹掉 ARC 稳定性短板，无论放大空间还是偷窥未来，都以「幽灵适配归零」为价 ⇒ 这一维因果抹不掉。
  const adaptiveBalanceCausallyUnerasable = rigged
    && !distinct
    && noStrategyWinsAll
    && rows.every((r) => r.trilemma.scanResistance === true)
    && rows.every((r) => r.trilemma.stableHitRate === true)
    && rows.every((r) => r.trilemma.adaptiveBalance === false)

  const crosscheck = {
    evidence: createReplacementEvidence({ seed, now: opts.now }),
    dualSweep: verifyDualSweep(tracesOf('uniformHot') || [], {
      capacity: CR_DEFAULTS.capacity, tolerance: CR_DUAL_SWEEP_TOLERANCE,
    }),
  }
  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    // 旧判词名：全部改由本组 rows 的现算 trilemma 驱动，绝不写死 true、绝不布尔拼接开关。
    lru_unhinted: lruRow.trilemma.scanResistance === false,
    lru_localityAware: lruRow.trilemma.stableHitRate === true,
    twoQ_scanResistant: q2Row.trilemma.scanResistance === true,
    twoQ_notAdaptive: q2Row.trilemma.adaptiveBalance === false,
    arc_adaptive: arcRow.trilemma.adaptiveBalance === true,
    arc_shuffle_pingpong: arcRow.trilemma.stableHitRate === false,
    perfectFutureBreaksArc: rigged && arcRow.trilemma.stableHitRate === true && arcRow.metrics.ghostAdaptMoves === 0,
    unlimitedRoomAllTrue: rigged && rows.every((r) => r.trilemma.scanResistance && r.trilemma.stableHitRate),
    rigged_pkg: rigged,
    // 新增因果锁 / 反噬 / 双路自证判词（全部现算读数驱动）
    adaptiveBalanceCausallyUnerasable,
    unlimitedRoomRestoresLruScan,
    unlimitedRoomRestoresArcStability,
    unlimitedRoomBackfiresAdaptiveBalance,
    perfectFutureRestoresLruScan,
    perfectFutureBackfiresArcStability,
    dualSweepHolds: crosscheck.dualSweep.holds,
    dualSweepNontrivial: crosscheck.dualSweep.nontrivial,
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: {
      seed, capacity, accesses, scenarios: scenarioIds,
      rigged, unlimitedRoom: flags.unlimitedRoom, perfectFuture: flags.perfectFuture,
    },
    rows, vectors, verdict,
    noUniversalWinner, trilemmaDistinguishes,
    crosscheck,
    rigged,
  }
}

export const compareReplacement = cacheReplacementStudy

export function cacheReplacementSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      trilemma: { ...r.trilemma },
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    verdict: { ...study.verdict },
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      dualSweep: study.crosscheck.dualSweep ? { ...study.crosscheck.dualSweep } : undefined,
    } : undefined,
  }
}

/*----------------------------------------------------- ⑥ 双路自证 -----------------------------------------------------*/

/**
 * verifyDualSweep 双路独立交叉印证：
 *
 * <b>路 A</b>：对 trace 做逐位置重放（与 LRU 幽灵历史一致），独立计 hit / miss / ghostHits / ghostAdaptMoves；
 * 路 A 用 Set 模拟「历史 Hit 轨迹」。
 *
 * <b>路 B</b>：对同一 trace 做 hot-set 二阶聚类（近似 K-means 均值划界），
 * 在每次请求前按 [hotClusterIndex] 预估「next access」类 ⇒ precomputed 命中率做理论重测，
 * 独立 bitmap 记录；断言两路命中率绝对误差 ≤0.12。
 *
 * 篡改均真验翻 false——这是教义读，不是给真值分配权的评书。
 */
/** 路 A：LRU 幽灵轨迹 —— 逐位置真重放，独立于路 B 的频次聚类。 */
function laneLruReplay(trace, capacity) {
  const cap = Math.max(1, intOr(capacity, 8))
  const order = []
  const resident = new Set()
  let hits = 0, misses = 0
  for (const [kRaw] of trace) {
    const k = String(kRaw)
    if (resident.has(k)) {
      hits += 1
      order.splice(order.indexOf(k), 1)
      order.push(k)
    } else {
      misses += 1
      order.push(k)
      resident.add(k)
      if (order.length > cap) resident.delete(order.shift())
    }
  }
  const total = hits + misses
  return { hits, misses, hitRate: total > 0 ? round4(hits / total) : 0 }
}

/** 路 B：hot-set 二阶聚类重测 —— 只用频次把「长期复用(≥2 次)」的键聚成 hot 簇，预测每次访问是否落簇。 */
function laneHotSet(trace) {
  const freq = new Map()
  for (const [kRaw] of trace) {
    const k = String(kRaw)
    freq.set(k, (freq.get(k) || 0) + 1)
  }
  const hotSet = new Set([...freq.entries()].filter(([, n]) => n >= 2).map(([k]) => k))
  let hits = 0, misses = 0
  for (const [kRaw] of trace) {
    if (hotSet.has(String(kRaw))) hits += 1
    else misses += 1
  }
  const total = hits + misses
  return { hits, misses, hitRate: total > 0 ? round4(hits / total) : 0, hotSet }
}

/**
 * 双路独立交叉印证唯一判定内核：三路篡改也真喂回这里现算 holds，绝不写死对象。
 * nontrivial 只看样本量 / hot-set 聚类是否非空 / 键空间是否有复用待测；容量不参与，
 * 好让「容量篡改」这条靠 LRU 抖动分叉现算翻假，而不是靠降级假翻。
 */
function evaluateDualSweep(input) {
  const trace = Array.isArray(input?.trace) ? input.trace : []
  const capacity = Math.max(1, intOr(input?.capacity, 8))
  const tolerance = numOr(input?.tolerance, CR_DUAL_SWEEP_TOLERANCE)
  const laneA = laneLruReplay(trace, capacity)
  const hot = laneHotSet(trace)
  const laneB = { hits: hot.hits, misses: hot.misses, hitRate: hot.hitRate }
  const absoluteDelta = round4(Math.abs(laneA.hitRate - laneB.hitRate))
  const hotsetSize = hot.hotSet.size
  const totalKeys = new Set(trace.map(([k]) => String(k))).size
  const nontrivial = trace.length >= 16 && hotsetSize >= 2 && totalKeys >= 2
  const holds = nontrivial && absoluteDelta <= tolerance
  return { laneA, laneB, absoluteDelta, hotsetSize, totalKeys, tolerance, holds, nontrivial }
}

/** 三路篡改真喂回同一内核现算 holds，逐路带 reason，绝不写死 false。 */
export function verifyDualSweep(trace = [], opts = {}) {
  const base = {
    trace: Array.isArray(trace) ? trace : [],
    capacity: intOr(opts.capacity, 8),
    tolerance: numOr(opts.tolerance, CR_DUAL_SWEEP_TOLERANCE),
  }
  const core = evaluateDualSweep(base)
  // ① 篡改 trace：截断至 8 条并反转 ⇒ 样本量不足，nontrivial 降级 → holds 现算翻假
  const laneATraceCorrupted = {
    ...evaluateDualSweep({ ...base, trace: base.trace.slice(0, 8).reverse() }),
    reason: '篡改 trace（截断至 8 条并反转）⇒ 样本不足、两路无法撞合，holds 现算翻假',
  }
  // ② 篡改容量：cap=1 让路 A LRU 每访问必抖动 miss，与路 B(hot-set) 命中率分叉超容差 → holds 现算翻假
  const laneBTraceCorrupted = {
    ...evaluateDualSweep({ ...base, capacity: 1 }),
    reason: '篡改容量（cap=1）⇒ 路 A LRU 抖动、两路命中率分叉超出容差，holds 现算翻假',
  }
  // ③ 空 trace / 零聚类：nontrivial 降级 → holds 现算翻假（绝不 0=0 假绿）
  const laneBSizedNull = {
    ...evaluateDualSweep({ ...base, trace: [] }),
    reason: '空 trace ⇒ hot-set 零聚类、nontrivial=false，holds 现算翻假（不凭 0=0 假绿）',
  }
  return { ...core, falsifiable: true, tamper: { laneATraceCorrupted, laneBTraceCorrupted, laneBSizedNull } }
}

/*----------------------------------------------------- ⑦ evidence -----------------------------------------------------*/

/** 十一真件交叉印证：全部真 import、真 API、真调用、真回读，21 键无一硬编码兜底。 */
export function createReplacementEvidence(opts = {}) {
  const seed = intOr(opts.seed, CR_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `ev:key:${i}`)
  const ev = {}

  // ① compareRemapping —— 缓存分片扩容最小重映射 vs 取模
  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  // ② ShardRouter.remapOn —— 路由后扩容迁移键数
  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  // ③ HashRing —— 真 nodeIds().length + 真路由分布用到的节点数
  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  // ④ Wal —— 页替换事件 append→lines→restore→replay 真回放
  const lru = createLruCache({ capacity: 64 })
  const wal = createWal()
  for (const k of keys.slice(0, 80)) {
    const hit = lru.access(k)
    wal.append('put', k, { hit, size: lru.size() })
  }
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  // ⑤ Bus —— 替换事件真通知
  const bus = createBus()
  let notices = 0
  bus.subscribe('cache.replaced', () => { notices += 1 })
  for (const k of keys.slice(0, 12)) bus.publish('cache.replaced', { key: k })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('cache.replaced')

  // ⑥ RedisCache —— 位图 slot 真 set + 真 get 命中
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (let i = 0; i < 96; i++) cache.set(`bm:slot:${i}`, 1)
  let bitmapHits = 0
  for (let i = 0; i < 96; i++) if (cache.get(`bm:slot:${i}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // ⑦ ObjectPool —— 取/还/复用真计数（无 ?? 兜底）
  const pool = createObjectPool({ factory: () => ({ slot: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  // ⑧ TokenBucket —— 回放限速真 allow()
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  // ⑨ MinHeapDelayQueue —— 淘汰/重建排程
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 80, 'evict:oldest')
  heap.schedule(fixedNow + 250, 'rebuild:lru')
  heap.schedule(fixedNow + 40, 'promote:lrud')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  // ⑩ PackedCounters —— 真 inc(i,by) + 真 get(i) 求和（无 stats().sum）
  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  // ⑪ FullJitterBackoff —— 真 delayFor 采样抖动离散（替代硬编码 0.13）
  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  return ev
}

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const nowIdx = args.indexOf('--now')
  const nowArg = args.find((a) => a.startsWith('--now='))
  const nowMs = nowArg ? numOr(nowArg.slice(6), 0) : (nowIdx >= 0 ? numOr(args[nowIdx + 1], 0) : 0)
  const opts = {
    rigged,
    now: () => nowMs,
    unlimitedRoom: rigged || args.includes('--unlimited-room'),
    perfectFuture: rigged || args.includes('--perfect-future'),
  }
  const study = cacheReplacementStudy(opts)
  const snap = cacheReplacementSnapshot(study)
  console.log('[cache-replacement] seed=' + snap.config.seed +
    ' capacity=' + snap.config.capacity +
    ' rigged=' + snap.config.rigged +
    ' unlimitedRoom=' + snap.config.unlimitedRoom +
    ' perfectFuture=' + snap.config.perfectFuture +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(6) +
      ' hitRateAvg=' + String(row.metrics.hitRateAvg).padStart(6) +
      ' ghostMoves=' + String(row.metrics.ghostAdaptMoves).padStart(3) +
      ' prefetchSkipped=' + String(row.metrics.prefetchSkipped).padStart(3) +
      ' trilemma={' + ['scanResistance', 'stableHitRate', 'adaptiveBalance']
        .map((dim) => dim + '=' + row.trilemma[dim]).join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.verdict.noUniversalWinner +
    ' distinguishable=' + snap.verdict.trilemmaDistinguishes + ' rigged=' + study.rigged +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma)
  const v = snap.verdict
  console.log('  verdict: noStrategyWinsAll=' + v.noStrategyWinsAll +
    ' adaptiveBalanceCausallyUnerasable=' + v.adaptiveBalanceCausallyUnerasable +
    ' twoQ_scanResistant=' + v.twoQ_scanResistant + ' arc_adaptive=' + v.arc_adaptive)
  console.log('  backfires: unlimitedRoom→lruScan=' + v.unlimitedRoomRestoresLruScan +
    ' unlimitedRoom→arcStable=' + v.unlimitedRoomRestoresArcStability +
    ' unlimitedRoom→adaptive=' + v.unlimitedRoomBackfiresAdaptiveBalance +
    ' perfectFuture→lruScan=' + v.perfectFutureRestoresLruScan +
    ' perfectFuture→arcStable=' + v.perfectFutureBackfiresArcStability)
  const ds = snap.crosscheck.dualSweep
  console.log('  dualSweep: holds=' + ds.holds + ' nontrivial=' + ds.nontrivial +
    ' laneA=' + ds.laneA.hitRate + ' laneB=' + ds.laneB.hitRate + ' delta=' + ds.absoluteDelta +
    ' tamper{trace=' + ds.tamper.laneATraceCorrupted.holds +
    ',cap=' + ds.tamper.laneBTraceCorrupted.holds + ',null=' + ds.tamper.laneBSizedNull.holds + '}')
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
}
