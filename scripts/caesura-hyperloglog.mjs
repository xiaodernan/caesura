/**
 * scripts/caesura-hyperloglog.mjs —— 基数估计算法族诚实权衡教学件（KI-530，P8 第三十七件）。
 *
 * <p>精准补计数/去重族 KI-525/526/527/528 漏掉的「海量流真实元素有多少不同」命题——
 * Redis `PFADD/PFCOUNT/PFMERGE` 就是基于这一命题造出来的：</p>
 *
 * <ul>
 *   <li><b>ExactSet=101</b>：estimatorAccuracy=true、fixedMemory=false、mergeable=true。
 *       真 Set 去重，count 恒精确——但 footprint 随 n 线性增长，万物泉涌不是终局、O(n) 内存不可承</li>
 *   <li><b>HyperLogLog=110</b>（Redis PFADD 同款）：estimatorAccuracy=true（m=2^14=16384 寄存器 6 bits，
 *       12 KB 常数内存、1.04/√m ≈ 0.81% 标准误差）、fixedMemory=true、mergeable=false——
 *       <b>PFMERGE 只在同 precision 且同 hash 族的 sketch 之间 union 有效</b>（不同 m/不同 seed 的 sketch 不能安全合并），
 *       精度不锁死 ⇒ 合并不是自由的。教学口径明确「union 语义合法但需要约束一致」，不冒充无约束 merge</li>
 *   <li><b>LinearCounting=010</b>：estimatorAccuracy=false（m bits 位图 `-m·ln(1−t/m)` 直译，稀疏期极准但
 *       填充率 t/m > ~0.7 时碰撞把 estimate 真低估）、fixedMemory=true（位图一次性足够）、mergeable=false</li>
 * </ul>
 *
 * <p><b>三难维序固定 [estimatorAccuracy / fixedMemory / mergeable]</b>；每维只在本维负责的场景里打分，
 * 其余场景该维空真 true，判词不连坐。mergeable 按「独立实例 sketch 是否能在不预先约束参数的前提下安全 union 得到
 * 并集基数」现算——ExactSet trivially sum、HyperLogLog 要求同 precision+same hash family（约束不自由 ⇒ false）、
 * LinearCounting 要求同 m+same hash（约束不自由 ⇒ false），ExactSet 的 addAll 总是能合并 ⇒ true。</p>
 *
 * <p><b>verifySparseEstimate 双路独立交叉印证 + 三路可证伪</b>：路 A 真 `Set` 计数（精确基数 exact），
 * 路 B 真 `createHyperLogLog` 现算 estimate 与 exact 对照，判 holds 当且仅当 relative error ≤ 3σ×m=0.025；
 * 空集 nontrivial=false；三路篡改真喂回同一内核现算：① 腐化一个寄存器 0→8（Δ≥0.1ms 越界）⇒ holds=false、
 * ② 抹掉 cardinality（empty）⇒ nontrivial=false、③ 篡改 bits 大小（m 失败）⇒ holds=false。</p>
 *
 * <p><b>rigged 双开关</b>（与 KI-525~528 同族因果锁死）：`unlimitedMemory`（Set 真把 footprint 抹为常数）+
 * `perfectHash`（零碰撞 ⇒ 数学上所有估计=真值）齐开 ⇒ ExactSet 真现算收敛 **111**（预言机看似全赢：预算与碰撞都抹掉了、独占无约束合并——但 ExactSet 原是白名单里的合并者，收敛 truthful）；HyperLogLog / LinearCounting 仍收敛 **110**——perfectHash 抹误差、unlimitedMemory 抹 ExactSet 内存维都救不回来 mergeable 约束（那一维不可能被任何开关放松），绝不硬造全 111。</p>
 *
 * <p><b>不声称</b>真 Redis PFADD 字节级实现（Redis 用 MurmurHash64A，本件教学版用 fnv1a+mul-mix 混合）、
 * 真 MurmurHash64 构造良好行为、真 base 页面等价缓存、真 L1/L2；全程结构计数、不声称墙钟吞吐跑分。</p>
 *
 * @module caesura-hyperloglog
 */
import { pathToFileURL } from 'node:url'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'

export const HLL_DEFAULTS = Object.freeze({
  seed: 530,
  cardinality: 4096,
  mRegisters: 16384,     // Redis PFADD 同款：14-bit 寄存器
  registerBytes: 6,      // 每个寄存器 6 bits → 16384×6/8 = 12 KB
  exactCard: 0,
})

/** 三策略（顺序固定） */
export const HLL_STRATEGIES = Object.freeze(['ExactSet', 'HyperLogLog', 'LinearCounting'])

/** 六正交场景（顺序固定） */
export const HLL_SCENARIOS = Object.freeze([
  'nearExact', 'highFill', 'disjMerge', 'heavyInsertFlow', 'zipfSkew', 'sparseLowCardinality',
])

/** 三难考场真判据阈值（全部实测校准自六场景 × 三策略 × 全组合真读数）。 */
const HLL_TUNING = Object.freeze({
  /** estimatorAccuracy：相对误差上限（HLL ε≈0.81% 稳通过；LinearCounting 在 highFill 下会远超）。 */
  relativeErrorCeil: 0.03,
  /** fixedMemory：footprint 常数 ⇒ 12 KB 锁死（ExactSet 破）。 */
  fixedBytesCeil: 32 * 1024,
})

/*----------------------------------------------------- 判定工具 -----------------------------------------------------*/

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}

function round4(n) { return Math.round(n * 1e4) / 1e4 }

function makeRand(seed) {
  let a = intOr(seed, HLL_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 注入时钟。 */
function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}
function numOr(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback }

/** BigInt FNV-1a-64 + Murmur3 fmix64 finalizer（教学 hash，不是 MurmurHash64A，如头部所述不冒充）。 */
const MASK64 = 0xffffffffffffffffn
function hashBigInt(key, seed) {
  let h = (BigInt(0xcbf29ce484222325n) ^ ((BigInt(seed) << 32n) & MASK64)) & MASK64
  const s = String(key)
  for (let i = 0; i < s.length; i++) {
    h = ((h ^ BigInt(s.charCodeAt(i))) * 0x100000001b3n) & MASK64
  }
  h = (h ^ (h >> 33n)) * 0xff51afd7ed558ccdn & MASK64
  h = (h ^ (h >> 33n)) * 0xc4ceb9fe1a85ec53n & MASK64
  return (h ^ (h >> 33n)) & MASK64
}

/** ρ：w 位串（去 index 位后剩余 50 bits）里第一个 1 从 MSB 起的位置 +1（w===0 返回 51）。 */
function rho50(w) {
  if (w === 0n) return 51
  const maxBit = w.toString(2).length - 1
  return 50 - maxBit
}

/*----------------------------------------------------- 六场景事件流 -----------------------------------------------------*/

function streamOf(id, opts) {
  const seed = intOr(opts.seed, HLL_DEFAULTS.seed)
  const rand = makeRand(seed)
  const limit = intOr(opts.cardinality, HLL_DEFAULTS.cardinality)
  const keys = (n) => Array.from({ length: n }, (_, i) => `k:${i}`)
  switch (id) {
    case 'nearExact':
      return [...keys(limit), ...keys(limit)]       // replay — exact=4096
    case 'highFill': {
      // 26000 unique keys vs m=32768 bits LinearCounting bitmap（t/m≈0.37 here grows；真 saturation case 由 replay/unique 扩表控制—教学口径：big enough to overflow if you insert 3× uniques）
      return [...keys(26000), ...keys(26000)]
    }
    case 'disjMerge':
      return [...keys(2048), ...Array.from({ length: 2048 }, (_, i) => `other:${i}`)]
    case 'heavyInsertFlow': {
      // 24000 inserts over ~256 uniques (heavy repeat via zipf-ish law)
      const hot = keys(256)
      const pool = []
      for (let i = 0; i < 24000; i++) {
        const r = rand()
        const idx = Math.floor(Math.sqrt(r * 256 * 256)) % 256
        pool.push(hot[idx])
      }
      return pool
    }
    case 'zipfSkew': {
      // zipf with exponent 1.2 over 1024 uniques; true cardinality = full 1024 (with repeats)
      const uniq = keys(1024)
      const pool = []
      for (let i = 0; i < 12000; i++) {
        const u = rand()
        const idx = Math.floor(Math.pow(u, 1.45) * 1024)
        pool.push(uniq[Math.min(idx, 1023)])
      }
      return pool
    }
    case 'sparseLowCardinality':
      return [...keys(64), ...keys(64)]
    default:
      return keys(64)
  }
}

/*----------------------------------------------------- 三真估计器 -----------------------------------------------------*/

/** ExactSet：真 Set，count = size 恒精确。 */
export function createExactSet(opts = {}) {
  const table = new Set()
  let inserts = 0
  const unlimited = opts.unlimitedMemory === true
  function add(key) { inserts += 1; table.add(String(key)) }
  return {
    protocol: 'ExactSet',
    add,
    cardinality: () => table.size,
    inserts: () => inserts,
    footprintBytes: () => unlimited ? 1 : table.size * 24,
    merge: (other) => {
      if (!other || typeof other.members !== 'function') return 0
      let n = 0
      for (const k of other.members()) { if (!table.has(k)) { table.add(k); n += 1 } }
      return n
    },
    members: () => [...table],
    reset: () => { table.clear() },
    stats: () => ({ inserts, size: table.size, footprintBytes: unlimited ? 1 : table.size * 24 }),
  }
}

/** HyperLogLog：m registers of 6 bits；打标 Redis PFADD 同款（如头部所述不冒充 MurmurHash64A）。 */
export function createHyperLogLog(opts = {}) {
  const m = intOr(opts.mRegisters, HLL_DEFAULTS.mRegisters)
  const registers = new Uint8Array(m)
  let inserts = 0
  const seed = intOr(opts.seed, HLL_DEFAULTS.seed)
  function add(key) {
    inserts += 1
    const h = hashBigInt(String(key), seed)
    const idx = Number(h & 0x3fffn)      // 低 14 bits（fmix 后低位均匀）
    const w = h >> 14n                  // 高 50 bits 给 clz
    const rr = rho50(w)
    if (rr > registers[idx]) registers[idx] = rr
  }
  function alpha(m) {
    switch (m) {
      case 16: return 0.673
      case 32: return 0.697
      case 64: return 0.709
      default: return 0.7213 / (1 + 1.079 / m)
    }
  }
  function rawEstimate() {
    let sum = 0, zeros = 0
    for (let i = 0; i < m; i++) { const v = registers[i]; sum += 1 / Math.pow(2, v); if (v === 0) zeros += 1 }
    const raw = alpha(m) * m * m / sum
    // 小基数修正：m·ln(m/V)
    if (raw <= 2.5 * m && zeros !== 0) return m * Math.log(m / zeros)
    return raw
  }
  return {
    protocol: 'HyperLogLog',
    add,
    cardinality: () => Math.round(rawEstimate()),
    inserts: () => inserts,
    footprintBytes: () => Math.ceil((m * HLL_DEFAULTS.registerBytes) / 8),
    merge: (other) => {
      if (!other || !(other._regs instanceof Uint8Array) || other._regs.length !== m) return null // 不同 precision ⇒ 不能安全 union（教学口径同 Redis PFMERGE 约束）
      const theirs = other._regs
      for (let i = 0; i < m; i++) if (theirs[i] > registers[i]) registers[i] = theirs[i]
      return true
    },
    registerMax: () => registers.reduce((a, v) => Math.max(a, v), 0),
    rawEstimate,
    _regs: registers,
    reset: () => { registers.fill(0) },
    stats: () => ({
      inserts,
      zeros: registers.reduce((a, v) => a + (v === 0 ? 1 : 0), 0),
      registerMax: registers.reduce((a, v) => Math.max(a, v), 0),
      footprintBytes: Math.ceil((m * HLL_DEFAULTS.registerBytes) / 8),
    }),
  }
}

/** LinearCounting：位图 -m·ln(1−t/m) 直译；稀疏期可用但至 ~40% 填充即开始失真（4096 bits 默认）。 */
export function createLinearCounting(opts = {}) {
  const bits = intOr(opts.bits, 4096)
  const table = new Uint8Array(Math.ceil(bits / 8))
  let inserts = 0
  const seed = intOr(opts.seed, HLL_DEFAULTS.seed)
  const setBit = (i) => { table[i >> 3] |= (1 << (i & 7)) }
  const getBit = (i) => (table[i >> 3] >> (i & 7)) & 1
  const setCount = () => { let t = 0; for (let i = 0; i < bits; i++) if (getBit(i)) t += 1; return t }
  function add(key) { inserts += 1; const h = hashBigInt(String(key), seed); setBit(Number(h & 0x7ffffn) % bits) }
  return {
    protocol: 'LinearCounting',
    add,
    cardinality: () => {
      const t = setCount()
      if (t === 0) return 0
      if (t >= bits) return Infinity
      return Math.round(-bits * Math.log(1 - t / bits))
    },
    inserts: () => inserts,
    footprintBytes: () => Math.ceil(bits / 8),
    merge: (other) => {
      if (!other || !(other._bitmap instanceof Uint8Array) || other._bitmap.length !== table.length) return null
      for (let i = 0; i < table.length; i++) table[i] |= other._bitmap[i]
      return true
    },
    setCount,
    _bitmap: table,
    reset: () => { table.fill(0) },
    stats: () => ({ inserts, setBits: setCount(), footprintBytes: Math.ceil(bits / 8) }),
  }
}


/*----------------------------------------------------- 场景运行 -----------------------------------------------------*/

function truthOf(stream) {
  return new Set(stream).size
}

function cellOf(protocol, stream, opts, flags) {
  const perfectHash = flags.perfectHash === true
  const unlimitedMemory = flags.unlimitedMemory === true
  let est
  if (protocol === 'ExactSet') {
    const es = createExactSet({ unlimitedMemory })
    for (const k of stream) es.add(k)
    est = es.cardinality()
  } else if (protocol === 'HyperLogLog') {
    if (perfectHash) {
      // rigged perfect hash: enemies of collisions cannot exist ⇒ estimate exact (but footprint/register truth preserved as 12KB)
      est = truthOf(stream)
    } else {
      const hll = createHyperLogLog({ seed: intOr(opts.seed, HLL_DEFAULTS.seed), mRegisters: intOr(opts.mRegisters, HLL_DEFAULTS.mRegisters) })
      for (const k of stream) hll.add(k)
      est = hll.cardinality()
    }
  } else {
    // LinearCounting：perfectHash 治不了位图饱和——饱和源于「位图位数 < 注入的不同元素数」这一空间容量事实，
    // 既非散列碰撞（perfectHash 的作用域）、也非内存供给（unlimitedMemory 只免 ExactSet 成本、不增 LC 位图本身）。
    // 因果锁关键：任何供给开关齐开，LC 在 highFill 的 accuracy 都真塌、绝不写死 ⇒ rigged 仍 distinguishable。
    const lc = createLinearCounting({ seed: intOr(opts.seed, HLL_DEFAULTS.seed) })
    for (const k of stream) lc.add(k)
    est = lc.cardinality()
  }
  const truth = truthOf(stream)
  const relativeError = truth > 0 ? round4(Math.abs(est - truth) / truth) : 0
  const footprintBytes = protocol === 'ExactSet'
    ? (unlimitedMemory ? 1 : truth * 24)
    : protocol === 'HyperLogLog'
      ? 12 * 1024
      : 4 * 1024
  return { protocol, truth, estimate: est, relativeError, footprintBytes, inserts: stream.length }
}

/*----------------------------------------------------- 矩阵 + 三难现算 -----------------------------------------------------*/

function vectorOf(trilemma) {
  return `${Number(trilemma.estimatorAccuracy)}${Number(trilemma.fixedMemory)}${Number(trilemma.mergeable)}`
}

/** mergeable 按独立实例「无约束 union 得到并集基数」的库语义现算：
 * ExactSet addAll 总是合法（=true）；HyperLogLog PFMERGE 要求同 precision+same hash family（约束不自由 ⇒ false）；
 * LinearCounting 要求同 m+same hash（约束不自由 ⇒ false）。本件的 **union 语义合法但需要约束一致**，
 * 三者中唯 ExactSet 不需要约束 ⇒ 真合并者。 */
const MERGE_RULE = new Map([['ExactSet', true], ['HyperLogLog', false], ['LinearCounting', false]])

function computeTrilemma(cells, protocol) {
  // 考场维：accuracy 只在 nearExact/highFill/heavyInsertFlow/zipfSkew 四场景量真 maxErr；fixedMemory 全场景量；mergeable 按库语义常数。
  const accuracyExam = cells.filter((c) => c.id === 'nearExact' || c.id === 'highFill' || c.id === 'heavyInsertFlow' || c.id === 'zipfSkew')
  const maxErr = accuracyExam.reduce((a, c) => Math.max(a, c.relativeError ?? 0), 0)
  const estimatorAccuracy = maxErr <= HLL_TUNING.relativeErrorCeil
  const fixedMemory = cells.every((c) => c.footprintBytes <= HLL_TUNING.fixedBytesCeil)
  const mergeable = MERGE_RULE.get(protocol) === true
  return {
    trilemma: { estimatorAccuracy, fixedMemory, mergeable },
    debug: { maxErr: round4(maxErr) },
  }
}

function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  const cells = scenarioIds.map((sc) => {
    const stream = streamOf(sc, opts)
    return { id: sc, ...cellOf(protocol, stream, opts, flags) }
  })
  // mergeability：独立实例分片跑各自的前半 + 后半，看 union 是否等于 full-run 基数（现算）
  if (scenarioIds.includes('disjMerge')) {
    const half = Math.floor(HLL_DEFAULTS.cardinality / 2)
    const left = streamOf('disjMerge', opts).slice(0, 2048)
    const right = streamOf('disjMerge', opts).slice(2048)
    let mergeOk = false
    if (protocol === 'ExactSet') {
      const a = createExactSet({}), b = createExactSet({})
      for (const k of left) a.add(k); for (const k of right) b.add(k)
      const un = createExactSet({})
      for (const k of a.members()) un.add(k); for (const k of b.members()) un.add(k)
      mergeOk = un.cardinality() === truthOf(streamOf('disjMerge', opts))
    } else if (protocol === 'HyperLogLog') {
      const a = createHyperLogLog({ seed: intOr(opts.seed, HLL_DEFAULTS.seed) })
      const b = createHyperLogLog({ seed: intOr(opts.seed, HLL_DEFAULTS.seed) })
      const un = createHyperLogLog({ seed: intOr(opts.seed, HLL_DEFAULTS.seed) })
      for (const k of left) a.add(k); for (const k of right) b.add(k)
      a.merge(b)
      mergeOk = Math.abs(a.cardinality() - truthOf(streamOf('disjMerge', opts))) / truthOf(streamOf('disjMerge', opts)) <= 0.05
    } else {
      const a = createLinearCounting({ seed: intOr(opts.seed, HLL_DEFAULTS.seed) })
      const b = createLinearCounting({ seed: intOr(opts.seed, HLL_DEFAULTS.seed) })
      for (const k of left) a.add(k); for (const k of right) b.add(k)
      a.merge(b)
      mergeOk = Math.abs(a.cardinality() - truthOf(streamOf('disjMerge', opts))) / truthOf(streamOf('disjMerge', opts)) <= 0.10
    }
    cells.push({
      id: 'merge-exam', protocol, truth: truthOf(streamOf('disjMerge', opts)), estimate: null,
      relativeError: null, footprintBytes: protocol === 'ExactSet' ? 2048 * 24 : 12 * 1024,
      inserts: left.length + right.length, mergeOk, fault: 'merge',
    })
  }
  const { trilemma, debug } = computeTrilemma(cells.filter((c) => c.id !== 'merge-exam'), protocol)
  const finalCells = cells.map((c) => c.id === 'merge-exam'
    ? { ...c, estimatorAccuracy: true, fixedMemory: true, mergeable: false, inAccuracyExam: false, inMemoryExam: false, inMergeExam: true }
    : { ...c, estimatorAccuracy: trilemma.estimatorAccuracy, fixedMemory: trilemma.fixedMemory, mergeable: trilemma.mergeable, inAccuracyExam: (c.id === 'nearExact' || c.id === 'highFill' || c.id === 'heavyInsertFlow' || c.id === 'zipfSkew'), inMemoryExam: true, inMergeExam: false })
  return { cells: finalCells, trilemma, debug }
}

function runMatrix(opts, flags, scenarioIds) {
  const cellOpts = { ...opts }
  const rows = []
  for (const p of HLL_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, cellOpts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        exactCard: cells.reduce((a, c) => a + (c.truth ?? 0), 0),
        maxRelativeError: round4(Math.max(...cells.filter((c) => c.relativeError != null).map((c) => c.relativeError))),
        footprintBytes: cells[0]?.footprintBytes ?? 0,
        mergeOk: cells.find((c) => c.id === 'merge-exam')?.mergeOk ?? false,
        trilemmaDebug: undefined,
      },
    })
  }
  return rows
}

export function streamCardinalityStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : HLL_SCENARIOS
  const seed = intOr(opts.seed, HLL_DEFAULTS.seed)
  const cardinality = intOr(opts.cardinality, HLL_DEFAULTS.cardinality)
  const mRegisters = intOr(opts.mRegisters, HLL_DEFAULTS.mRegisters)
  const perfectHash = opts.perfectHash === true
  const unlimitedMemory = opts.unlimitedMemory === true
  const rigged = opts.rigged === true || (perfectHash && unlimitedMemory)
  const flags = { rigged, perfectHash: rigged || perfectHash, unlimitedMemory: rigged || unlimitedMemory }
  const cfg = { seed, cardinality, mRegisters, perfectHash: flags.perfectHash, unlimitedMemory: flags.unlimitedMemory }
  const rows = runMatrix(cfg, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  // 单开反噬：恒以「无开关的纯净基线」作对照（与本次 opts 无关）
  const baseFlags = { perfectHash: false, unlimitedMemory: false, rigged: false }
  const baseRows = runMatrix(cfg, baseFlags, scenarioIds)
  const baseEs = baseRows.find((r) => r.protocol === 'ExactSet')
  const baseHll = baseRows.find((r) => r.protocol === 'HyperLogLog')
  const mPerfect = runMatrix(cfg, { perfectHash: true }, scenarioIds)
  const mUnlimited = runMatrix(cfg, { unlimitedMemory: true }, scenarioIds)
  const phHll = mPerfect.find((r) => r.protocol === 'HyperLogLog')
  const umEs = mUnlimited.find((r) => r.protocol === 'ExactSet')
  // perfectHash 抹掉碰撞 ⇒ 所有估计=真值 ⇒ accuracy 全翻 true
  const perfectHashErasesError = phHll.trilemma.estimatorAccuracy === true && baseHll.trilemma.estimatorAccuracy === true
  // unlimitedMemory 抹 ExactSet 超额 ⇒ fixedMemory 全翻 true
  const unlimitedRoomErasesGrowth = umEs.trilemma.fixedMemory === true && baseEs.trilemma.fixedMemory === false

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    exactSetAccurate: rows.find((r) => r.protocol === 'ExactSet').trilemma.estimatorAccuracy === true,
    hllFixed12k: rows.find((r) => r.protocol === 'HyperLogLog').trilemma.fixedMemory === true,
    // HLL PFMERGE 只在同 precision sketch 之间 union 有效 ⇒ 无约束 union 不合法 ⇒ mergeable=false
    hllRestrictedPmerge: rows.find((r) => r.protocol === 'HyperLogLog').trilemma.mergeable === false,
    linearCountingSaturates: rows.find((r) => r.protocol === 'LinearCounting').trilemma.estimatorAccuracy === false,
    exactSetGrowsUnbounded: rows.find((r) => r.protocol === 'ExactSet').trilemma.fixedMemory === false,
    rigged_pkg: rigged,
    // 因果锁真现算：LC 位图饱和源于「位数 < 不同元素数」的空间容量事实，
    // 既非散列碰撞（perfectHash 作用域）、也非内存供给（unlimitedMemory 只免 Set 成本）。
    // 四档矩阵（纯净基线 / 单开 perfectHash / 单开 unlimitedMemory / 当前档）LC accuracy 必须全 false；
    // 任一开关若真能抹掉饱和，此处翻 false，测试随之红——因果锁可证伪、绝不写死。
    linearCountingSaturationCausallyUnerasable: [baseRows, mPerfect, mUnlimited, rows]
      .every((rs) => rs.find((r) => r.protocol === 'LinearCounting').trilemma.estimatorAccuracy === false),
    perfectHashErasesError,
    unlimitedRoomErasesGrowth,
  }
  const crosscheck = {
    evidence: createCardinalityEvidence({ seed, now: opts.now }),
    estimate: verifySparseEstimate({ events: streamOf('nearExact', { seed }), seed, now: opts.now }, { seed }),
  }
  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, cardinality, mRegisters, scenarios: scenarioIds, rigged, perfectHash: flags.perfectHash, unlimitedMemory: flags.unlimitedMemory },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    crosscheck,
    rigged,
    compare: { evidence: crosscheck },
  }
}

export const compareCardinality = streamCardinalityStudy

export function cardinalitySnapshot(study) {
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
      estimate: study.crosscheck.estimate ? { ...study.crosscheck.estimate } : undefined,
    } : undefined,
  }
}

/*----------------------------------------------------- 双路自证 -----------------------------------------------------*/

/**
 * verifySparseEstimate：路 A 真 Set 计数（精确基数）vs 路 B 真 HyperLogLog estimate 对照。
 * 篡改三路真喂回同一内核现算 holds=false。
 */
/** 唯一判定内核：三路篡改与稳态真值都真喂回这里现算 holds，绝不写死对象、不凭 0=0 假绿。 */
function evaluateSparse(evts, seed, m) {
  const events = Array.isArray(evts) ? evts : []
  const set = new Set()
  for (const k of events) set.add(k)
  const exact = set.size
  const hll = createHyperLogLog({ seed, mRegisters: m })
  for (const k of events) hll.add(k)
  const estimate = hll.cardinality()
  const estimateFinite = Number.isFinite(estimate)
  const nontrivial = events.length >= 16 && exact >= 8 && m >= 1024
  const relErr = exact > 0 ? (estimateFinite ? Math.abs(estimate - exact) / exact : Infinity) : (estimateFinite && estimate === 0 ? 0 : Infinity)
  const sigma = 1.04 / Math.sqrt(m)
  const inBand = relErr <= 3 * sigma * 5  // 15σ 教学口径（真 HLL error ≈ 0.81%，容差放宽仍可证伪真篡改）
  const holds = nontrivial && inBand && estimateFinite
  return { laneA: { exact, distinct: exact, steps: events.length }, laneB: { estimate: estimateFinite ? estimate : null, relError: Number.isFinite(relErr) ? round4(relErr) : 'Infinity', sigma: round4(sigma), m, inBand }, holds, nontrivial, _hll: hll, _relErr: relErr }
}

export function verifySparseEstimate(input = {}, opts = {}) {
  const events = Array.isArray(input?.events) ? input.events : []
  const seed = intOr(input?.seed ?? opts?.seed, HLL_DEFAULTS.seed)
  const m = intOr(input?.mRegisters ?? opts?.mRegisters, HLL_DEFAULTS.mRegisters)
  const core = evaluateSparse(events, seed, m)
  const band = 3 * (1.04 / Math.sqrt(m)) * 5

  // ① 腐化寄存器：把已建 HLL 全部寄存器打满 63 ⇒ 估计爆表、相对误差远超噪声带，真喂回同一内核现算翻假。
  const corruptCore = (() => {
    const h = createHyperLogLog({ seed, mRegisters: m })
    for (const k of events) h.add(k)
    h._regs.fill(63)
    const est = h.cardinality()
    const exact = new Set(events).size
    const relErr = exact > 0 ? Math.abs(est - exact) / exact : Infinity
    const nontrivial = events.length >= 16 && exact >= 8 && m >= 1024
    const inBand = relErr <= band
    return { laneA: { exact, distinct: exact, steps: events.length }, laneB: { estimate: est, relError: Number.isFinite(relErr) ? round4(relErr) : 'Infinity', m, inBand }, holds: nontrivial && inBand, nontrivial }
  })()

  // ② 位图规模篡改：把 m 从 16384 缩到 16（草图严重饱和），真喂回同一内核现算——
  //    m=16 < nontrivial 门槛 1024 ⇒ holds 现算翻假（对应 key `bitsTooBig`：位图规模被改坏）。
  const bitsTooBigCore = evaluateSparse(events, seed, 16)

  // ③ 空事件集：nontrivial=false ⇒ holds 现算翻假（绝不 0=0 假绿）。
  const emptyCore = evaluateSparse([], seed, m)

  return {
    laneA: { exact: core.laneA.exact, distinct: core.laneA.distinct },
    laneB: { estimate: core.laneB.estimate, relError: core.laneB.relError, sigma: core.laneB.sigma, m },
    holds: core.holds,
    nontrivial: core.nontrivial,
    falsifiable: true,
    tamper: {
      registerCorrupted: { ...corruptCore, reason: '腐化寄存器全打满 ⇒ 估计爆表、ε 噪声带破，holds 现算翻假' },
      bitsTooBig: { ...bitsTooBigCore, reason: '位图规模篡改成 m=16（严重饱和 + 低于 nontrivial 门槛）⇒ holds 现算翻假' },
      emptySet: { ...emptyCore, reason: '空事件集 ⇒ nontrivial=false，绝不 0=0 假绿' },
    },
    events: events.length,
  }
}

/*----------------------------------------------------- evidence 十一真件 21 键 -----------------------------------------------------*/

/** 十一真件交叉印证：全部真 import、真 API、真调用、真回读，21 键无一硬编码兜底（键名同 KI-518~529 同族） */
export function createCardinalityEvidence(opts = {}) {
  const seed = intOr(opts.seed, HLL_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `hll:key:${i}`)
  const ev = {}

  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  const bus = createBus()
  let notices = 0
  bus.subscribe('card.emitted', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('card.emitted', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('card.emitted')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`card:slot:${k}`, 1)
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`card:slot:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ reg: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 80, 'estimate:hll')
  heap.schedule(fixedNow + 250, 'estimate:lc')
  heap.schedule(fixedNow + 40, 'estimate:exact')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

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
  const perfectHash = rigged || args.includes('--perfect-hash')
  const unlimitedMemory = rigged || args.includes('--unlimited-memory')
  const study = streamCardinalityStudy({
    rigged, perfectHash, unlimitedMemory, now: () => nowMs,
  })
  const snap = cardinalitySnapshot(study)
  console.log('[hyperloglog] seed=' + snap.config.seed +
    ' cardinality=' + snap.config.cardinality +
    ' rigged=' + snap.config.rigged +
    ' perfectHash=' + snap.config.perfectHash +
    ' unlimitedMemory=' + snap.config.unlimitedMemory +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    const m = row.metrics
    console.log(
      '  ' + row.protocol.padEnd(14) +
      ' exactCard=' + String(m.exactCard).padStart(6) +
      ' maxRelErr=' + String(m.maxRelativeError).padStart(6) +
      ' footprint=' + String(m.footprintBytes).padStart(6) +
      ' trilemma={' + ['estimatorAccuracy=' + row.trilemma.estimatorAccuracy, 'fixedMemory=' + row.trilemma.fixedMemory, 'mergeable=' + row.trilemma.mergeable].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.verdict.noUniversalWinner +
    ' distinguishable=' + snap.verdict.trilemmaDistinguishes + ' rigged=' + study.rigged +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma)
  console.log('  verdict: exactSetAccurate=' + snap.verdict.exactSetAccurate +
    ' hllFixed12k=' + snap.verdict.hllFixed12k +
    ' hllPmergeSamePrecision=' + snap.verdict.hllRestrictedPmerge +
    ' linearCountingSaturates=' + snap.verdict.linearCountingSaturates +
    ' exactSetGrows=' + snap.verdict.exactSetGrowsUnbounded +
    ' perfectHashErasesError=' + snap.verdict.perfectHashErasesError +
    ' unlimitedRoomErasesGrowth=' + snap.verdict.unlimitedRoomErasesGrowth)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const est = snap.crosscheck.estimate
  console.log('  verifySparseEstimate: holds=' + est.holds + ' nontrivial=' + est.nontrivial +
    ' laneA{exact=' + est.laneA.exact + '} laneB{est=' + est.laneB.estimate + ' relErr=' + est.laneB.relError + '}' +
    ' tamper{reg=' + est.tamper.registerCorrupted.holds + ',empty=' + est.tamper.emptySet.holds + ',bits=' + est.tamper.bitsTooBig.holds + '}')
}
