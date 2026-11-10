import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * scripts/caesura-hw-perf.mjs —— OS / 硬件适配性能教学件（P8 第五件，KI-497）。
 *
 * <p>落的是「程序如何与硬件/运行时相处」这件事本身：集大成主线把缓存、计网、数据库内核、
 * 前端都做成了可断言教学件，却从没有一只件回答「为什么高频路径不该每次 new」、「多核写
 * 相邻计数器为什么会互相拖慢」、「为什么扫对象数组的某个字段比扫类型化数组慢」。本件用
 * 零依赖、可注入、可确定性测的纯 JS 实现，把三件 OS/硬件常识收口成可复现的对照判词。</p>
 *
 * <p><b>诚实边界（重要，先写在头顶）</b>：本件<b>不实测墙钟时间 / GC 暂停时长 / 真实多核
 * cache coherence 流量</b>。JS 没有可靠的内存地址与时钟精度，实测只会给出会撒谎的数。
 * 因此三件都只给<b>结构性、确定性、可复现</b>的计数对照：①对象池给「分配次数」；②padding
 * 给「相邻计数器是否落同一 cache line」；③SoA 给「确定性 LRU 行缓存模型下的 miss 数」。
 * 真实收益取决于硬件 / 并发模式 / 数据规模，须实测调参——本件教的是<b>机制</b>，不是跑分。</p>
 *
 * <p>设计取舍（判定权仍在 Node 侧，决策原则①）：factory/reset/maxSize、cacheLineBytes、
 * cacheBytes/lineBytes、structBytes/fieldBytes/fieldOffset、stride 全由 opts 注入；本件只跑
 * 状态机与计数，不写任何业务阈值、不碰任何调用路径。</p>
 *
 * 用法：
 *   const pool = createObjectPool({ factory: () => ({x:0,y:0}), reset: (o) => { o.x=o.y=0 } })
 *   for (let i=0;i<1000;i++) { const o = pool.acquire(); o.x=i; pool.release(o) }
 *   pool.stats()                        // → { created:1, reused:999, reuseRate:0.999, ... }
 *
 *   const padded = createCacheLinePadder(4)   // 每计数器独占 64B 行，falseSharingPairs=0
 *   const packed = createPackedCounters(4)    // 紧凑排布，相邻计数器共享行 ⇒ false sharing
 *   compareLayouts({ count:10000 })           // → { aos:{misses}, soa:{misses}, speedup:... }
 */

/** 缺省 cache line 字节数（主流 x86-64 / ARM64 均为 64B；可注入）。 */
export const DEFAULT_CACHE_LINE_BYTES = 64
/** Float64Array 单元素字节数（本件 padded/packed 计数器固定用 Float64）。 */
const FLOAT64_BYTES = 8

/**
 * ① 对象池 —— 复用临时对象、压低 GC 分配次数。
 *
 * <p>为什么有效：高频路径每次 `new` 都向堆要一块内存，短命对象堆积触发 GC；对象池把用过的
 * 对象复位后留在空闲栈，下次 `acquire` 直接复用，堆分配只发生在池冷启动/扩容时。可断言的
 * 判词是 `created`（真 new 了几个）与 `reused`（复用几次）——n 次「取-还」循环只 new 一次，
 * 省下 n-1 次分配。这是**分配次数**证据，不是时间证据（时间不可靠，见头顶边界）。</p>
 *
 * <p>取舍：空闲栈 LIFO（复用最近归还的、缓存局部性好）；`maxSize`（缺省 1024）限制驻留
 * 空闲对象数，超出时 `release` 直接丢弃并计 `dropped`（宁可丢也不无限驻留占内存）；
 * `reset` 由调用方注入（池不知道业务对象哪些字段要清），不注入则跳过复位、由调用方自担；
 * 不做线程安全、不自动归还、不防重复归还（纯进程内教学件，写明在案）。</p>
 */
export function createObjectPool(opts = {}) {
  const factory = typeof opts.factory === 'function' ? opts.factory : () => ({})
  const reset = typeof opts.reset === 'function' ? opts.reset : null
  const maxSize = Math.max(0, Math.floor(Number(opts.maxSize ?? 1024)))
  const idle = []
  const counters = { created: 0, reused: 0, acquired: 0, released: 0, dropped: 0, peakIdle: 0 }
  let inUse = 0

  function acquire() {
    counters.acquired++
    inUse++
    let obj
    if (idle.length > 0) {
      obj = idle.pop()
      counters.reused++
    } else {
      obj = factory()
      counters.created++
    }
    return obj
  }

  /** 复位后归还；池满则丢弃（计 dropped）。返回是否成功入池。 */
  function release(obj) {
    if (obj === null || obj === undefined) return false
    counters.released++
    inUse = Math.max(0, inUse - 1)
    if (reset) reset(obj)
    if (maxSize > 0 && idle.length >= maxSize) { counters.dropped++; return false }
    idle.push(obj)
    if (idle.length > counters.peakIdle) counters.peakIdle = idle.length
    return true
  }

  /** 清空空闲栈（不回收调用方仍持有的对象）。返回丢弃数。 */
  function resetPool() {
    const n = idle.length
    idle.length = 0
    return n
  }

  function stats() {
    const total = counters.acquired
    return {
      created: counters.created,
      reused: counters.reused,
      acquired: total,
      released: counters.released,
      dropped: counters.dropped,
      idle: idle.length,
      inUse,
      peakIdle: counters.peakIdle,
      reuseRate: total === 0 ? 0 : counters.reused / total,
    }
  }

  return { acquire, release, reset: resetPool, stats, get maxSize() { return maxSize } }
}

/**
 * 对象池 vs 直接 new 的**分配次数**对照证据。
 *
 * <p>模拟 `accesses` 次「取一个对象、用完归还」：不用池时每次都要 `new`（naiveCreated=accesses）；
 * 用池时冷启动 new 一次、其余全复用（poolCreated=1，受 maxSize 影响可能略多）。`saved` 是省下的
 * 分配次数、`reuseRate` 是复用比例。factory 计「真分配了几次」，两只用同一只计数器口径对齐。</p>
 */
export function allocationStudy(opts = {}) {
  const accesses = Math.max(0, Math.floor(Number(opts.accesses ?? 10000)))
  const maxSize = opts.maxSize
  let naiveCreated = 0
  for (let i = 0; i < accesses; i++) { naiveCreated++ /* 直接 new：每次一次分配 */ }
  const pool = createObjectPool({ ...opts, maxSize })
  for (let i = 0; i < accesses; i++) {
    const o = pool.acquire()
    if (opts.touch) opts.touch(o, i)
    pool.release(o)
  }
  const s = pool.stats()
  return {
    accesses,
    naiveCreated,
    poolCreated: s.created,
    saved: naiveCreated - s.created,
    reused: s.reused,
    dropped: s.dropped,
    reuseRate: s.reuseRate,
    peakIdle: s.peakIdle,
  }
}

/** padded / packed 共用的计数器构造。padded=true 时每槽独占一整 cache line。 */
function makeCounters(count, padded, opts) {
  const n = Math.max(1, Math.floor(Number(count ?? 8)))
  const cacheLineBytes = Math.max(FLOAT64_BYTES, Math.floor(Number(opts.cacheLineBytes ?? DEFAULT_CACHE_LINE_BYTES)))
  const elementsPerLine = Math.max(1, Math.floor(cacheLineBytes / FLOAT64_BYTES))
  // padded：槽 i 起点 = i*elementsPerLine（独占一行、其余元素纯 padding）；
  // packed：槽 i 起点 = i（紧凑，相邻槽极可能落同一行 ⇒ false sharing）。
  const spanElements = padded ? n * elementsPerLine : n
  const backing = new Float64Array(spanElements)
  const startIndex = (i) => padded ? i * elementsPerLine : i
  const lineOf = (i) => Math.floor(startIndex(i) / elementsPerLine)
  const sharesLine = (a, b) => lineOf(a) === lineOf(b)
  const inc = (i, by = 1) => { backing[startIndex(i)] += by; return backing[startIndex(i)] }
  const get = (i) => backing[startIndex(i)]

  function stats() {
    let falseSharingPairs = 0
    for (let i = 0; i < n - 1; i++) if (sharesLine(i, i + 1)) falseSharingPairs++
    const distinctLines = new Set(Array.from({ length: n }, (_, i) => lineOf(i))).size
    return {
      count: n, padded, cacheLineBytes, elementsPerLine,
      startIndices: Array.from({ length: n }, (_, i) => startIndex(i)),
      distinctLines,
      falseSharingPairs,
      spanBytes: spanElements * FLOAT64_BYTES,
      totalLines: Math.ceil(spanElements / elementsPerLine),
    }
  }

  return { inc, get, lineOf, sharesLine, stats, get count() { return n }, get backing() { return backing } }
}

/**
 * ②a 缓存行 padding 计数器 —— 每槽独占一整 cache line，规避 false sharing。
 *
 * <p>多核各写一个计数器时，若两计数器落同一 cache line，写会互相使对方的核内副本失效
 * （cache coherence ping-pong），吞吐骤降。padded 让每个计数器起点隔开 `elementsPerLine`
 * 个 Float64（64B 行 ⇒ 8 个），相邻槽必不同行，`falseSharingPairs===0`。代价是空间放大
 * （`spanBytes = count*cacheLineBytes`），stats 的 `paddingOverhead` 量化这个取舍。</p>
 */
export function createCacheLinePadder(count, opts = {}) {
  const c = makeCounters(count, true, opts)
  const base = c.stats()
  return {
    ...c,
    stats() {
      const s = c.stats()
      const packedSpan = s.count * FLOAT64_BYTES
      return { ...s, paddingOverhead: packedSpan === 0 ? 1 : s.spanBytes / packedSpan }
    },
    get elementsPerLine() { return base.elementsPerLine },
  }
}

/**
 * ②b 紧凑计数器（对照）—— 槽位连续排布，模拟 false sharing 的反面教材。
 *
 * <p>与 padding 版同接口，唯一差别是槽起点为 `i` 而非 `i*elementsPerLine`。当 `count>
 * elementsPerLine` 时相邻槽会落同一行，`falseSharingPairs>0`，正是多核写要避免的布局。
 * 两只并排跑，`stats().falseSharingPairs` 的对比就是「padding 规避了什么」的可断言证据。</p>
 */
export function createPackedCounters(count, opts = {}) {
  const c = makeCounters(count, false, opts)
  return {
    ...c,
    stats() {
      const s = c.stats()
      const packedSpan = s.count * FLOAT64_BYTES
      return { ...s, paddingOverhead: packedSpan === 0 ? 1 : s.spanBytes / packedSpan }
    },
  }
}

/**
 * ③ 确定性全相联 LRU 行缓存模型 —— 给数据布局对照当「尺子」。
 *
 * <p>用 JS `Map` 的插入序近似 LRU：命中就 `delete+set` 移到 MRU 端、未命中载入并在超容量时
 * 逐出最旧行（`map.keys().next().value`）。容量 `capacityLines = cacheBytes/lineBytes`。
 * 这是<b>教学用的插入序 LRU</b>，不是真硬件缓存（无组相联/替换策略/预取），只求确定性、可
 * 复现地数「一串地址访问会产生多少行 miss」——拿到同一把尺子，AoS/SoA 才可比。</p>
 */
export function createLruLineCache(opts = {}) {
  const lineBytes = Math.max(1, Math.floor(Number(opts.lineBytes ?? DEFAULT_CACHE_LINE_BYTES)))
  const cacheBytes = Math.max(lineBytes, Math.floor(Number(opts.cacheBytes ?? 512)))
  const capacityLines = Math.max(1, Math.floor(cacheBytes / lineBytes))
  const lines = new Map() // lineId -> true，插入序即 LRU 序（最旧在前）
  const counters = { hits: 0, misses: 0, evictions: 0 }

  /** 访问一段字节区间覆盖的所有 cache line（首行 floor(a/L)，末行 floor((a+len-1)/L)）。 */
  function accessRange(startByte, lengthBytes) {
    const len = Math.max(1, Math.floor(Number(lengthBytes ?? 1)))
    const first = Math.floor(startByte / lineBytes)
    const last = Math.floor((startByte + len - 1) / lineBytes)
    let missed = 0
    for (let id = first; id <= last; id++) {
      const r = accessLine(id)
      if (r.miss) missed++
    }
    return { firstLine: first, lastLine: last, lines: last - first + 1, missed }
  }

  function accessLine(lineId) {
    if (lines.has(lineId)) {
      lines.delete(lineId)
      lines.set(lineId, true) // 移到 MRU
      counters.hits++
      return { hit: true, miss: false, lineId, evicted: null }
    }
    counters.misses++
    let evicted = null
    lines.set(lineId, true)
    if (lines.size > capacityLines) {
      evicted = lines.keys().next().value
      lines.delete(evicted)
      counters.evictions++
    }
    return { hit: false, miss: true, lineId, evicted }
  }

  /** 兼容「只给地址」的调用（单字节访问）。 */
  function access(address) {
    const r = accessLine(Math.floor(Number(address) / lineBytes))
    return { hit: r.hit, lineId: r.lineId, evicted: r.evicted }
  }

  function stats() {
    const total = counters.hits + counters.misses
    return {
      hits: counters.hits, misses: counters.misses, evictions: counters.evictions,
      accesses: total, hitRate: total === 0 ? 0 : counters.hits / total,
      capacityLines, lineBytes, cacheBytes, residentLines: lines.size,
    }
  }

  function reset() { lines.clear(); counters.hits = 0; counters.misses = 0; counters.evictions = 0 }
  return { access, accessRange, accessLine, stats, reset, get capacityLines() { return capacityLines } }
}

/**
 * ④ AoS vs SoA 数据布局局部性对照 —— 用③的 LRU 尺子数量化缓存友好度。
 *
 * <p>AoS（Array of Structures）：`[{x,y,z,id},...]` 对象数组，逻辑上元素 i 占 `structBytes`
 * 字节，字段 x 在偏移 `fieldOffset`。扫所有元素的 x 时，相邻 x 之间隔着整个 struct 的跨度，
 * 一个 cache line 里只装得下极少数 x ⇒ line 利用率低、miss 多。SoA（Structure of Arrays）：
 * 把 x 单独 compact 成 `Float64Array`，扫 x 时相邻值紧挨着，一条 line 装满多个 ⇒ miss 少。</p>
 *
 * <p>`stride=1` 顺序扫能吃到 SoA 红利（`speedup>1`）；`stride` 调大做跳跃扫时，AoS/SoA 每次
 * 访问几乎都落不同行、两者 miss 都逼近访问次数，局部性优势消失——这个「退化」本身就是真实
 * 判词，防止把 SoA 吹成万能。两只各用一只全新的 LRU 模型、同参数，保证可比。</p>
 */
export function compareLayouts(opts = {}) {
  const count = Math.max(1, Math.floor(Number(opts.count ?? 10000)))
  const structBytes = Math.max(FLOAT64_BYTES, Math.floor(Number(opts.structBytes ?? 4 * FLOAT64_BYTES)))
  const fieldBytes = Math.max(1, Math.floor(Number(opts.fieldBytes ?? FLOAT64_BYTES)))
  const fieldOffset = Math.max(0, Math.floor(Number(opts.fieldOffset ?? 0)))
  const stride = Math.max(1, Math.floor(Number(opts.stride ?? 1)))
  const cacheOpts = { cacheBytes: opts.cacheBytes ?? 512, lineBytes: opts.lineBytes ?? DEFAULT_CACHE_LINE_BYTES }
  const makeCache = () => createLruLineCache(cacheOpts)

  // 顺序或按 stride 跳跃，逐元素喂「该字段在内存中的字节区间」。
  const indices = []
  for (let i = 0; i < count; i += stride) indices.push(i)

  const aosCache = makeCache()
  let aosTouchedLines = 0
  for (const i of indices) {
    const startByte = i * structBytes + fieldOffset
    aosTouchedLines += aosCache.accessRange(startByte, fieldBytes).lines
  }
  const soaCache = makeCache()
  let soaTouchedLines = 0
  for (const i of indices) {
    const startByte = i * fieldBytes // SoA：字段独立紧凑数组
    soaTouchedLines += soaCache.accessRange(startByte, fieldBytes).lines
  }
  const as = aosCache.stats()
  const ss = soaCache.stats()
  return {
    count, stride, indices: indices.length,
    aos: { misses: as.misses, hits: as.hits, hitRate: as.hitRate, touchedLines: aosTouchedLines },
    soa: { misses: ss.misses, hits: ss.hits, hitRate: ss.hitRate, touchedLines: soaTouchedLines },
    speedup: ss.misses === 0 ? (as.misses > 0 ? Infinity : 1) : as.misses / ss.misses,
    model: { cacheBytes: as.cacheBytes, lineBytes: as.lineBytes, capacityLines: as.capacityLines, structBytes, fieldBytes, fieldOffset },
  }
}

/* ------------------------------- CLI ------------------------------- */
// node scripts/caesura-hw-perf.mjs —— 跑三件确定性对照，打印「OS/硬件适配」证据。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pool = allocationStudy({ accesses: 10000, maxSize: 64, factory: () => ({ x: 0, y: 0, z: 0 }), reset: (o) => { o.x = o.y = o.z = 0 } })
  const padded = createCacheLinePadder(8).stats()
  const packed = createPackedCounters(8).stats()
  const seq = compareLayouts({ count: 10000, stride: 1 })
  const jump = compareLayouts({ count: 10000, stride: 16 })
  console.log(JSON.stringify({
    generator: 'caesura-hw-perf',
    allocation: { accesses: pool.accesses, naiveCreated: pool.naiveCreated, poolCreated: pool.poolCreated, saved: pool.saved, reuseRate: Number(pool.reuseRate.toFixed(4)) },
    cacheLine: { paddedFalseSharing: padded.falseSharingPairs, packedFalseSharing: packed.falseSharingPairs, paddedSpanBytes: padded.spanBytes, packedSpanBytes: packed.spanBytes, paddingOverhead: Number((padded.spanBytes / packed.spanBytes).toFixed(1)) },
    layout: {
      sequential: { aosMisses: seq.aos.misses, soaMisses: seq.soa.misses, speedup: Number.isFinite(seq.speedup) ? Number(seq.speedup.toFixed(2)) : 'Infinity' },
      strided16: { aosMisses: jump.aos.misses, soaMisses: jump.soa.misses, speedup: Number.isFinite(jump.speedup) ? Number(jump.speedup.toFixed(2)) : 'Infinity' },
    },
  }, null, 2))
}
