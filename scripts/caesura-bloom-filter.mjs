/**
 * scripts/caesura-bloom-filter.mjs —— 布隆 / 计数布隆 / 布谷鸟三过滤器「空间—插入—删除」三难诚实权衡教学件（KI-527，P8 第三十四件）。
 *
 * <p>补 KI-496/499/501/518/520/523/525/526 存储与吞吐族最后缺的一维：<b>集合成员判重的三难</b>。
 * LSM/B+树/一致性哈希/回溯压都回答过「数据怎么存对、怎么压、怎么不丢」，却没人正面回答
 * 「membership 判重能不能同时紧凑、插入永不失败、又支持删除」——本件用三策略真跑给出诚实答案：<b>不能</b>。</p>
 *
 * <p>三难维序固定 <code>[compactFootprint, insertsNeverFail, deleteSupport]</code>。默认态向量
 * （全部由 <code>vecOf(row.trilemma)</code> 现算，<b>绝不硬造任何字符串、绝不硬造全 111</b>）：</p>
 * <ul>
 *   <li><b>Bloom = 110</b>：位图 ~10 bits/key（紧凑✓）· add 永不失败✓ · remove 恒 false（无删除✗）。</li>
 *   <li><b>CountingBloom = 011</b>：4×counter/key = 32 bits/key（吃空间✗）· add 永不失败✓ · 计数真减删除✓。</li>
 *   <li><b>Cuckoo = 101</b>：1 byte fingerprint / 95% 装载 = ~16 bits/key（紧凑✓）· 高装载撞真崖壁拒插✗ · 真写零删除✓。</li>
 * </ul>
 * <p>三向量互异、无一 111，故 <code>noUniversalWinner=true / trilemmaDistinguishes=true</code>：
 * 任何维度上都没有「全胜」策略——紧凑的不能删，能删的不省空间，省空间又会撞崖壁。</p>
 *
 * <p><b>正交考场（BF_DIM_SCENARIOS_F，单维只在本维考场分、其余空真不连坐）</b>：</p>
 * <ul>
 *   <li><code>boundedFalsePositive → compactFootprint</code>：只在 steadyFilter / burstScale / overAdmitted 量结构 bits/key。</li>
 *   <li><code>insertsNeverFail</code>：只在 hotKeyFlood / highLoadSaturation 量真插入失败数。</li>
 *   <li><code>deleteSupport</code>：只在 deleteCycle 量真删除成功率。</li>
 * </ul>
 *
 * <p><b>rigged 三开关（unlimitedRoom / eternalStasis / noDeletesNeeded）</b>与 KI-525/526 同族因果锁：
 * 三开关<b>真进入构造与场景</b>——<code>unlimitedRoom</code> 真放大三策略空间预算（Cuckoo 表拉满、不再撞崖壁），
 * <code>eternalStasis</code> 真让 deleteCycle 无 churn（delTries 真归零），<code>noDeletesNeeded</code> 真作为判据空真语义
 * （「无需删除」时删除维空真成立）。三者齐开时由 row.trilemma 现算收敛 <b>011 / 011 / 011</b>：inserts 与 delete
 * 两维被抹真，唯 <b>compactFootprint 因果抹不掉</b>（想让插入永不失败，就得为无限空间付账，bits/key 必然爆表）——
 * 即 <code>compactFootprintCausallyUnerasable</code>。向量非全 111、坍缩同向量，故
 * <code>noStrategyWinsAll=true / noUniversalWinner=false / trilemmaDistinguishes=false</code>。
 * 单开任一开关均<b>真跑矩阵</b>量出反噬判词（现算读数驱动，绝不硬编码 =true）：单开 unlimitedRoom 抹真 Cuckoo
 * 插入维却坐实其空间维翻假；单开 eternalStasis 只冻结删除、删除维仍不可证伪；单开 noDeletesNeeded 不静止则空真不生效。</p>
 *
 * <p><b>verifyFalsePositiveCeiling 双路自证 + 三路可证伪</b>：路 A 现算理论上界 ε=(1−e^(−kn/m))^k；
 * 路 B 用两枚独立否定集真探 FP，断言实测落在邻域 [ε×0.2, ε×1.5+0.5% 地板]，空集 nontrivial=false（绝不硬绿）。
 * 三路篡改（篡改 bits 让理论上界失真 / 零误判却给真否定集 / 绕过否定集 probes）被<b>真喂回 verify 函数本身</b>
 * 逐路现算翻 false，holds 由判定内核现算，绝不写死对象。</p>
 *
 * <p><b>Cuckoo 真装载崖壁</b>：单表 power-of-2 桶化、1 byte fingerprint、hardCapacity=floor(slots×maxLoad)；
 * add 在两候选桶 {i1, i1^hash(fp)} 都满时走带 <b>undo 回滚</b>的 kick 链，maxKicks 走完仍无处安放 ⇒ 回滚全部改动、
 * stashFailures++、add() 返回 false，<b>绝不覆盖已占 fingerprint 造成静默丢 key</b>；highLoadSaturation / overAdmitted
 * 真触发拒插。</p>
 *
 * <p><b>不声称</b>真 RocksDB Bloom / 真 RedisBloom.BF / 真 CuckooFilter C++ wrap / 墙钟毫秒 / QPS；三 LFK 位置在位错误
 * 是教学简化；evidence 的十一真件仅为「同一确定性事实/原语在此跑通」的交叉印证，不冒充过滤器内核实测；
 * builtAt 走注入时钟（KI-517 契约），CLI 固定 --now 双跑字节一致。</p>
 *
 * @module caesura-bloom-filter
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

export const BF_DEFAULTS = Object.freeze({
  seed: 527,
  capacity: 1024,
  bitsPerKey: 10,           // Bloom 位传尺（bits/key）
  countersPerKey: 4,        // CountingBloom 计数器/key（吃空间）
  counterWidth: 4,          // 4 位计数器 → 单槽最多 15
  tableCount: 2,            // 保留：Cuckoo 双候选位置语义（标准单表 xor）
  bucketSize: 4,            // Cuckoo 每桶槽数
  maxKicks: 8,
  benchKeys: 64,
  maxLoadFactor: 0.95,      // Cuckoo 装载崖壁线
  compactBitsPerKeyBudget: 20, // compactFootprint 预算线（≤ 判紧凑）
  riggedRoomFactor: 8,      // unlimitedRoom 空间放大倍率（因果守恒的价）
  // rigged 三开关（新）；旧 zeroErrors/deleteImpossible 由 verdict 现算别名承载，不再参与构造
  unlimitedRoom: false,
  eternalStasis: false,
  noDeletesNeeded: false,
  rigged: false,
})

export const BF_STRATEGIES = Object.freeze(['Bloom', 'CountingBloom', 'Cuckoo'])

export const BF_SCENARIOS = Object.freeze([
  'steadyFilter', 'hotKeyFlood', 'deleteCycle', 'highLoadSaturation', 'burstScale', 'overAdmitted',
])

/** 三难正交考场：一维只在本维负责的场景里打分，其余场景该维空真不连坐。 */
const BF_DIM_SCENARIOS_F = Object.freeze({
  boundedFalsePositive: new Set(['steadyFilter', 'burstScale', 'overAdmitted']), // → compactFootprint
  insertsNeverFail: new Set(['hotKeyFlood', 'highLoadSaturation']),
  deleteSupport: new Set(['deleteCycle']),
})

const BF_COMPACT_BUDGET_BITS_PER_KEY = 20

/* --------------------------- 判定工具 --------------------------- */

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}
function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
/** 注入时钟：数字或函数（builtAt 契约要求对函数求值，同 KI-517/KI-526 startClock 习惯）。 */
function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}
function round4(n) { return Math.round(n * 1e4) / 1e4 }
function round6(n) { return Math.round(n * 1e6) / 1e6 }
function makeRand(seed) {
  let a = intOr(seed, BF_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Murmur-ish 确定性串哈希（双哈希展开用）。 */
function hashString(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) | 0
    h = Math.imul(h, 0x5bd1e995)
    h ^= h >>> 13
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
/** 双哈希展开 k 个位置：h1 + i*h2 (mod m)，h2 取奇。 */
function positionsFor(key, k, m) {
  const h1 = hashString(key, 0x9e3779b9) >>> 0
  const h2 = hashString(key, 0x51ab3bae) | 1
  const out = new Array(k)
  for (let i = 0; i < k; i++) out[i] = (((h1 + i * h2) >>> 0) % Math.max(1, m))
  return out
}

/* --------------------------- 三策略真实现 --------------------------- */

/** Bloom Filter：m bits 位图、k 最优哈希（true/false 判重），无删除（remove 恒 false）。 */
export function createBloomFilter(opts = {}) {
  const cap = intOr(opts.capacity, BF_DEFAULTS.capacity)
  const baseBpk = intOr(opts.bitsPerKey, BF_DEFAULTS.bitsPerKey)
  const room = opts.unlimitedRoom === true ? BF_DEFAULTS.riggedRoomFactor : 1
  const m = intOr(opts.bits, Math.max(64, baseBpk * cap * room))
  const k = intOr(opts.hashFunctions, Math.max(2, Math.round(baseBpk * Math.LN2)))
  const table = new Uint8Array(Math.ceil(m / 8))
  let added = 0
  function positions(key) { return positionsFor(String(key), k, m) }
  function add(key) {
    for (const h of positions(key)) table[h >>> 3] |= (1 << (h & 7))
    added += 1
    return true
  }
  function contains(key) {
    for (const h of positions(key)) if ((table[h >>> 3] & (1 << (h & 7))) === 0) return false
    return true
  }
  function remove(_key) { return false } // Bloom 的领域：根本不支持删除
  return {
    protocol: 'Bloom', add, contains, remove,
    stats: () => ({ added, bits: m, bytes: table.length, hashFunctions: k, capacity: cap, fillRatio: added / cap, stashFailures: 0, insertFailures: 0, room }),
  }
}

/** CountingBloom Filter：每格计数（可真删），4×counter/key 吃空间。 */
export function createCountingBloomFilter(opts = {}) {
  const cap = intOr(opts.capacity, BF_DEFAULTS.capacity)
  const baseCpk = intOr(opts.countersPerKey, BF_DEFAULTS.countersPerKey)
  const room = opts.unlimitedRoom === true ? BF_DEFAULTS.riggedRoomFactor : 1
  const m = intOr(opts.counters, Math.max(64, baseCpk * cap * room))
  const k = intOr(opts.hashFunctions, Math.max(2, Math.round(baseCpk * Math.LN2)))
  const width = Math.min(8, Math.max(2, intOr(opts.counterWidth, BF_DEFAULTS.counterWidth)))
  const maxCount = (1 << width) - 1
  const table = new Uint8Array(m)
  let added = 0
  function positions(key) { return positionsFor(String(key), k, m) }
  function add(key) {
    for (const h of positions(key)) if (table[h] < maxCount) table[h] += 1
    added += 1
    return true
  }
  function contains(key) { for (const h of positions(key)) if (table[h] === 0) return false; return true }
  function remove(key) {
    const hashes = positions(key)
    for (const h of hashes) if (table[h] === 0) return false // 有格为 0 ⇒ 该 key 计数不足，不存在
    for (const h of hashes) table[h] -= 1
    added = Math.max(0, added - 1)
    return true
  }
  return {
    protocol: 'CountingBloom', add, contains, remove,
    stats: () => ({ added, counters: m, bytes: table.length, hashFunctions: k, capacity: cap, counterWidth: width, fillRatio: added / cap, stashFailures: 0, insertFailures: 0, room }),
  }
}

/**
 * Cuckoo Filter：单表 power-of-2 桶化 + 1 byte fingerprint + xor 双候选桶。
 * 真装载崖壁：hardCapacity 上限 + 带 undo 回滚的 kick 链；失败 stashFailures++、add() 返回 false、
 * 绝不覆盖已占 fingerprint 造成静默丢 key。
 */
export function createCuckooFilter(opts = {}) {
  const cap = intOr(opts.capacity, BF_DEFAULTS.capacity)
  const bucketSize = Math.max(1, intOr(opts.bucketSize, BF_DEFAULTS.bucketSize))
  const maxLoad = numOr(opts.maxLoadFactor, BF_DEFAULTS.maxLoadFactor)
  const room = opts.unlimitedRoom === true ? BF_DEFAULTS.riggedRoomFactor : 1
  const effectiveCap = cap * room
  const targetBuckets = effectiveCap / (bucketSize * maxLoad)
  const numBuckets = 2 ** Math.max(2, Math.ceil(Math.log2(Math.max(1, targetBuckets))))
  const mask = numBuckets - 1
  const fingerprintWidth = 1
  const table = new Uint8Array(numBuckets * bucketSize) // 0 = 空；非 0 = fingerprint
  const hardCapacity = Math.max(1, Math.floor(numBuckets * bucketSize * maxLoad))
  const maxKicks = intOr(opts.maxKicks, BF_DEFAULTS.maxKicks)
  const rand = makeRand(opts.seed ?? BF_DEFAULTS.seed)
  let inserted = 0, stashFailures = 0, insertFailures = 0

  const fpOf = (key) => (hashString(String(key), 0x7feb352d) & 0xff) | 1 // 非零 1 byte
  const i1Of = (key) => hashString(String(key), 0x9e3779b9) & mask
  const altOf = (bucket, fp) => bucket ^ (hashString(String(fp), 0x51ab3bae) & mask)
  function findInBucket(b, fp) {
    const s = b * bucketSize
    for (let i = 0; i < bucketSize; i++) if (table[s + i] === fp) return s + i
    return -1
  }
  function emptyInBucket(b) {
    const s = b * bucketSize
    for (let i = 0; i < bucketSize; i++) if (table[s + i] === 0) return s + i
    return -1
  }
  function contains(key) {
    const fp = fpOf(key), b1 = i1Of(key), b2 = altOf(b1, fp)
    return findInBucket(b1, fp) >= 0 || findInBucket(b2, fp) >= 0
  }
  function add(key) {
    if (contains(key)) return true // 幂等，避免重复 fingerprint 污染判重
    if (inserted >= hardCapacity) { stashFailures += 1; insertFailures += 1; return false } // 装载崖壁
    const fp = fpOf(key), b1 = i1Of(key), b2 = altOf(b1, fp)
    let slot = emptyInBucket(b1)
    if (slot >= 0) { table[slot] = fp; inserted += 1; return true }
    slot = emptyInBucket(b2)
    if (slot >= 0) { table[slot] = fp; inserted += 1; return true }
    // kick 链：每步把 curFp 落进被踢槽，被踢 victim 去它的 alt 桶；带 undo，失败整体回滚
    const undo = []
    let curFp = fp, curBucket = b1
    for (let n = 0; n < maxKicks; n++) {
      const pick = curBucket * bucketSize + Math.floor(rand() * bucketSize)
      const victim = table[pick] // 该候选桶已满 ⇒ victim 非 0
      undo.push({ slot: pick, prev: victim })
      table[pick] = curFp
      const alt = altOf(curBucket, victim)
      const es = emptyInBucket(alt)
      if (es >= 0) { table[es] = victim; inserted += 1; return true }
      curFp = victim
      curBucket = alt
    }
    // maxKicks 走完仍无处安放 ⇒ 回滚（绝不静默丢已占 key）
    for (let j = undo.length - 1; j >= 0; j--) table[undo[j].slot] = undo[j].prev
    stashFailures += 1
    insertFailures += 1
    return false
  }
  function remove(key) {
    const fp = fpOf(key), b1 = i1Of(key), b2 = altOf(b1, fp)
    let idx = findInBucket(b1, fp)
    if (idx < 0) idx = findInBucket(b2, fp)
    if (idx >= 0) { table[idx] = 0; inserted = Math.max(0, inserted - 1); return true }
    return false
  }
  return {
    protocol: 'Cuckoo', add, contains, remove,
    stats: () => ({
      inserted, numBuckets, bucketSize, fingerprintWidth, hardCapacity, maxKicks,
      maxLoadFactor: maxLoad, stashFailures, insertFailures, capacity: cap,
      fillRatio: inserted / cap, bytes: table.length, room,
    }),
  }
}

/* --------------------------- ④ 场景 --------------------------- */

const ALL_SUBFILTERS = { Bloom: createBloomFilter, CountingBloom: createCountingBloomFilter, Cuckoo: createCuckooFilter }
function subFilterFactory(protocol, opts) { return ALL_SUBFILTERS[protocol](opts) }

/** 六正交场景真跑：每场景真写入 + 真查询序列，输出真实 op/metric。flags 由 study 透传。 */
export function runBloomFilterScenario(protocol, scenarioId, o = {}) {
  const seedBase = intOr(o.seed, BF_DEFAULTS.seed)
  const rand = makeRand((seedBase ^ (Math.max(1, scenarioId.length) * 0x9e3779b1)) >>> 0)
  const randStream = (n, offset) => Array.from({ length: n }, (_, i) => `${offset}-key-${i}-${(rand() * 0xffffffff) >>> 0}`)
  const flags = o.flags || {}
  const capacity = intOr(o.capacity, BF_DEFAULTS.capacity)
  const mk = subFilterFactory(protocol, { seed: seedBase, capacity, unlimitedRoom: flags.unlimitedRoom === true })

  let inserted = 0, insertFailures = 0, falsePositives = 0, probes = 0, negProbes = 0
  let correctNegatives = 0, correctPositives = 0
  let deleteTries = 0, deleteSuccess = 0, deleteReinserted = 0, foldCount = 0

  const probePositive = (key) => { probes += 1; if (mk.contains(key)) correctPositives += 1 }
  const probeNegative = (key) => {
    probes += 1; negProbes += 1
    if (mk.contains(key)) falsePositives += 1; else correctNegatives += 1
  }
  const insertKey = (key) => { if (mk.add(key) === true) inserted += 1; else insertFailures += 1 }
  const queryRound = (insertCount, negCount, posCount, offset) => {
    const posKeys = randStream(insertCount, `${offset}-pos`)
    for (const k of posKeys) insertKey(k)
    for (const k of posKeys) probePositive(k)
    const negKeys = randStream(negCount, `${offset}-neg`)
    for (const k of negKeys) probeNegative(k)
    return { posKeys, negKeys }
  }

  switch (scenarioId) {
    case 'steadyFilter':
      queryRound(700, 400, 300, 1)
      break
    case 'hotKeyFlood': {
      const baseKeys = randStream(140, 2)
      for (const k of baseKeys) insertKey(k)
      for (let round = 0; round < 24; round++) for (const k of baseKeys) probePositive(k)
      for (let i = 0; i < 80; i++) probeNegative(`flood-miss-${i}`)
      break
    }
    case 'deleteCycle': {
      const keySet = randStream(500, 3)
      for (const k of keySet) insertKey(k)
      if (flags.eternalStasis !== true) {
        // 非静止：真删 250、真重插 150，并自查删除效果
        for (let i = 0; i < 250; i++) { const ok = mk.remove(keySet[i]); deleteTries += 1; if (ok) deleteSuccess += 1 }
        const reinserted = keySet.slice(0, 150)
        for (const k of reinserted) { insertKey(k); deleteReinserted += 1 }
        let afterDeletePresent = 0
        for (const k of keySet.slice(0, 250)) if (mk.contains(k)) afterDeletePresent += 1
        foldCount += afterDeletePresent
      }
      // eternalStasis=true：永恒静止、无 churn ⇒ deleteTries 真保持 0（判据改由 noDeletesNeeded 空真语义裁决）
      break
    }
    case 'highLoadSaturation':
      // 2× 装载压测 → Cuckoo ≈ 95% 装载必撞崖壁（hardCapacity / kick 枯竭），Bloom/CB 仍容
      queryRound(capacity * 2, 160, 40, 4)
      break
    case 'burstScale':
      queryRound(Math.floor(capacity / 2), 240, 120, 5)
      queryRound(Math.floor(capacity - 1), 240, 120, 6)
      break
    case 'overAdmitted':
      // 血池压满：4× 装载 → Cuckoo 内存满、kick 枯竭真拒插；Bloom/CB 位图/计数饱和但 add 仍成功
      queryRound(capacity * 4, 300, 200, 7)
      break
    default:
      queryRound(128, 64, 64, 9)
  }

  const stats = mk.stats()
  const bitsPerKey = round4((stats.bytes ?? 0) * 8 / Math.max(1, stats.capacity ?? capacity))
  const inFootprintExam = BF_DIM_SCENARIOS_F.boundedFalsePositive.has(scenarioId)
  const inInsertExam = BF_DIM_SCENARIOS_F.insertsNeverFail.has(scenarioId)
  const inDeleteExam = BF_DIM_SCENARIOS_F.deleteSupport.has(scenarioId)
  // 每格各自判定、其余维空真不连坐（同 KI-523/525/526 正交口径）：
  // 空间维按本格结构 bits/key 真算；插入维按本格真失败数；删除维只在 deleteCycle 考场真算，非考场空真 true。
  const compactFootprint = bitsPerKey <= BF_COMPACT_BUDGET_BITS_PER_KEY
  const insertsNeverFail = inInsertExam ? (insertFailures + (stats.stashFailures ?? 0) === 0) : true
  const deleteSupport = inDeleteExam
    ? (deleteTries > 0 ? (deleteSuccess / deleteTries >= 0.8) : (flags.noDeletesNeeded === true))
    : true
  return {
    id: scenarioId,
    strategy: protocol,
    inserted,
    insertFailures,
    probes,
    negProbes,
    falsePositives,
    correctNegatives,
    correctPositives,
    deleteTries,
    deleteSuccess,
    deleteReinserted,
    foldCount,
    fpRate: negProbes > 0 ? round4(falsePositives / negProbes) : 0,
    fillRatio: round4(stats.fillRatio ?? 0),
    m: stats.bits ?? stats.counters ?? stats.numBuckets ?? 0,
    capacity: stats.capacity ?? capacity,
    bitsPerKey,
    stashFailures: stats.stashFailures ?? 0,
    bytes: stats.bytes ?? 0,
    fault: scenarioId,
    // 三难正交三布尔 + 考场标记：前端矩阵/mesh-e2e ladder 直接读，绝不拿阈值重算
    compactFootprint,
    insertsNeverFail,
    deleteSupport,
    inFootprintExam,
    inInsertExam,
    inDeleteExam,
  }
}

/** 三难现算：全部从本维考场的真读数推布尔，绝不接受外部硬写的 trilemma。 */
function computeTrilemma(cells, flags) {
  const fpCells = cells.filter((c) => BF_DIM_SCENARIOS_F.boundedFalsePositive.has(c.id))
  const insCells = cells.filter((c) => BF_DIM_SCENARIOS_F.insertsNeverFail.has(c.id))
  const delCells = cells.filter((c) => BF_DIM_SCENARIOS_F.deleteSupport.has(c.id))

  // compactFootprint：结构 bits/key 预算（与场景插入数无关，取 FP 考场均值）
  const bitsPerKey = fpCells.length
    ? fpCells.reduce((a, c) => a + c.bitsPerKey, 0) / fpCells.length
    : BF_COMPACT_BUDGET_BITS_PER_KEY + 1
  const compactFootprint = bitsPerKey <= BF_COMPACT_BUDGET_BITS_PER_KEY

  // insertsNeverFail：本维考场真失败数（insertFailures + stashFailures）恒 0
  const anyFail = insCells.some((c) => c.insertFailures > 0 || c.stashFailures > 0)
  const insertsNeverFail = !anyFail

  // deleteSupport：本维考场真删除成功率；delTries=0 时按 noDeletesNeeded 空真语义裁决（默认 false，不可证伪）
  const delTries = delCells.reduce((a, c) => a + c.deleteTries, 0)
  const delSuc = delCells.reduce((a, c) => a + c.deleteSuccess, 0)
  const deleteSupport = delTries > 0 ? (delSuc / delTries >= 0.8) : (flags.noDeletesNeeded === true)

  return {
    trilemma: { compactFootprint, insertsNeverFail, deleteSupport },
    debug: { bitsPerKey: round4(bitsPerKey), delTries, delSuc, anyFail,
             totalFpRate: round4(fpCells.length ? fpCells.reduce((a, c) => a + c.fpRate, 0) / fpCells.length : 0) },
  }
}

/** 跑一整组 3 策略 × 场景矩阵，返回 rows（含从读数现算的 trilemma）。 */
function runMatrix(opts, flags, scenarioIds) {
  const seed = intOr(opts.seed, BF_DEFAULTS.seed)
  const capacity = intOr(opts.capacity, BF_DEFAULTS.capacity)
  const rows = []
  for (const p of BF_STRATEGIES) {
    const cells = scenarioIds.map((s) => runBloomFilterScenario(p, s, { seed, capacity, flags }))
    const { trilemma, debug } = computeTrilemma(cells, flags)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        bitsPerKey: debug.bitsPerKey,
        totalFpRate: debug.totalFpRate,
        totalInsertFailures: cells.reduce((a, c) => a + c.insertFailures, 0),
        totalStashFailures: cells.reduce((a, c) => a + c.stashFailures, 0),
        deleteAttempts: debug.delTries,
        deleteSuccess: debug.delSuc,
        deleteReinserted: cells.reduce((a, c) => a + c.deleteReinserted, 0),
        foldCount: cells.reduce((a, c) => a + c.foldCount, 0),
      },
    })
  }
  return rows
}

const vecOf = (r) =>
  `${Number(r.trilemma.compactFootprint)}${Number(r.trilemma.insertsNeverFail)}${Number(r.trilemma.deleteSupport)}`

/* --------------------------- ⑤ verify（可证伪） --------------------------- */

/** FP 理论上界判定内核：唯一真值来源，喂回篡改输入也走这里现算 holds。 */
function evaluateCeiling(input) {
  const bits = intOr(input?.bits, 0)
  const keys = intOr(input?.keys, 0)
  const k = intOr(input?.hashFunctions, 0)
  const probes = intOr(input?.negativeProbes, 0)
  const fp = numOr(input?.measuredFpr, NaN)
  const raw2 = input?.secondMeasuredFpr
  const fp2 = (raw2 === undefined || raw2 === null) ? NaN : numOr(raw2, NaN)
  const nontrivial = bits >= 256 && keys >= 64 && k >= 2 && probes >= 16 && Number.isFinite(fp)
  const theory = nontrivial ? Math.pow(1 - Math.exp((-k * keys) / bits), k) : 0
  const tolerated = theory * 1.5 + 0.005
  const lower = theory * 0.2
  const inBand = (v) => Number.isFinite(v) && v >= lower && v <= tolerated
  const holds = nontrivial && inBand(fp) && (!Number.isFinite(fp2) || inBand(fp2))
  return {
    theory: round6(theory), measured: fp, measuredAlt: Number.isFinite(fp2) ? fp2 : null,
    tolerated: round6(tolerated), lower: round6(lower), holds, nontrivial,
  }
}

/**
 * verifyFalsePositiveCeiling —— Bloom/CountingBloom 的「理论上界 vs 实测」双路自证 + 三路可证伪。
 * 三路篡改被真喂回本函数（withTamper=false 走同一判定内核）逐路现算，holds 绝不写死。
 */
function verifyCeiling(input, withTamper) {
  const core = evaluateCeiling(input)
  if (!withTamper) return core
  const bits = intOr(input?.bits, 0)
  const k = intOr(input?.hashFunctions, 0)
  const fp2raw = input?.secondMeasuredFpr
  const base = {
    bits, keys: intOr(input?.keys, 0), hashFunctions: k,
    negativeProbes: intOr(input?.negativeProbes, 0), measuredFpr: numOr(input?.measuredFpr, NaN),
    ...((fp2raw === undefined || fp2raw === null) ? {} : { secondMeasuredFpr: numOr(fp2raw, NaN) }),
  }
  // ① 信任配置失真：把 bits 缩到 1/16（仍 ≥256 保 nontrivial）⇒ ε 暴涨，原实测跌破下界
  const tamperBits = Math.max(256, Math.floor(bits / 16))
  const trustConfig = { ...verifyCeiling({ ...base, bits: tamperBits }, false), tamperBits,
    reason: '篡改 bits ⇒ 理论上界 ε 失真，实测掉出邻域' }
  // ② 零误判却给真否定集：fp=0 但 probes>0、理论 ε>0 ⇒ 0 跌破 lower
  const zeroFpr = { ...verifyCeiling({ ...base, measuredFpr: 0, secondMeasuredFpr: 0 }, false),
    reason: '零误判却给真否定集 ⇒ 与 ε>0 矛盾，跌破下界' }
  // ③ 绕过否定集 probes：probes=0 ⇒ nontrivial=false ⇒ holds=false
  const skipProbe = { ...verifyCeiling({ ...base, negativeProbes: 0 }, false),
    reason: '绕过否定集 probes ⇒ nontrivial 降级，不可证伪' }
  return { ...core, falsifiable: true, tamper: { trustConfig, zeroFpr, skipProbe } }
}

export function verifyFalsePositiveCeiling(input) { return verifyCeiling(input, true) }

/** 真跑一枚稳态 Bloom，用两枚独立否定集真探 FP，产出喂给 verify 的输入（真撞合、非硬绿）。 */
function runFpCeilingProbe(seed) {
  const capacity = BF_DEFAULTS.capacity
  const bitsPerKey = BF_DEFAULTS.bitsPerKey
  const bits = bitsPerKey * capacity
  const k = Math.max(2, Math.round(bitsPerKey * Math.LN2))
  const keys = capacity
  const negativeProbes = 4000
  const bf = createBloomFilter({ capacity, bitsPerKey, seed })
  for (let i = 0; i < keys; i++) bf.add(`ceiling-pos-${seed}-${i}`)
  let fa = 0, fb = 0
  for (let i = 0; i < negativeProbes; i++) if (bf.contains(`ceiling-neg-a-${seed}-${i}`)) fa++
  for (let i = 0; i < negativeProbes; i++) if (bf.contains(`ceiling-neg-b-${seed}-${i}`)) fb++
  return { bits, keys, hashFunctions: k, negativeProbes,
    measuredFpr: fa / negativeProbes, secondMeasuredFpr: fb / negativeProbes }
}

/* --------------------------- ⑥ study + snapshot + evidence --------------------------- */

export function bloomFilterStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : BF_SCENARIOS
  const seed = intOr(opts.seed, BF_DEFAULTS.seed)
  const rigged = opts.rigged === true
  const flags = {
    rigged,
    unlimitedRoom: rigged || opts.unlimitedRoom === true,
    eternalStasis: rigged || opts.eternalStasis === true,
    noDeletesNeeded: rigged || opts.noDeletesNeeded === true,
  }

  // 主矩阵
  const rows = runMatrix(opts, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vecOf(r)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = rigged ? false : (distinct && noStrategyWinsAll)
  const trilemmaDistinguishes = rigged ? false : distinct
  const rowBy = (rs, p) => rs.find((r) => r.protocol === p)

  // 单开反噬：三份矩阵真跑，判词全部由现算读数驱动（绝不硬编码 =true）
  const mUR = runMatrix(opts, { unlimitedRoom: true }, scenarioIds)
  const mES = runMatrix(opts, { eternalStasis: true }, scenarioIds)
  const mND = runMatrix(opts, { noDeletesNeeded: true }, scenarioIds)
  const urCuckoo = rowBy(mUR, 'Cuckoo').trilemma
  const unlimitedRoomBackfiresCompactFootprint = urCuckoo.insertsNeverFail === true && urCuckoo.compactFootprint === false
  const eternalStasisBackfiresDeletes = BF_STRATEGIES.every((p) => rowBy(mES, p).trilemma.deleteSupport === false)
  const noDeletesNeededBackfiresDeletes = rowBy(mND, 'Bloom').trilemma.deleteSupport === false

  // rigged 因果锁：三维被两开关抹真，唯空间维因果抹不掉
  const compactFootprintCausallyUnerasable =
    rigged
    && rows.every((r) => r.trilemma.compactFootprint === false)
    && rows.every((r) => r.trilemma.insertsNeverFail === true)
    && rows.every((r) => r.trilemma.deleteSupport === true)
    && distinct === false
    && noStrategyWinsAll === true

  const bloomRow = rowBy(rows, 'Bloom')
  const cbRow = rowBy(rows, 'CountingBloom')
  const cuckooRow = rowBy(rows, 'Cuckoo')
  const crosscheck = {
    evidence: createBloomFilterEvidence({ seed, now: opts.now }),
    fpCeiling: verifyFalsePositiveCeiling(runFpCeilingProbe(seed)),
  }
  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma: rows.every((r) => vectors[r.protocol] === vecOf(r)),
    bloomDeleteFree: bloomRow.trilemma.deleteSupport === false,
    countingBloomSpacePays: cbRow.trilemma.compactFootprint === false,
    cuckooStashWall: cuckooRow.metrics.totalStashFailures > 0 || cuckooRow.metrics.totalInsertFailures > 0,
    countingBloomDeleteSupport: cbRow.trilemma.deleteSupport === true,
    cuckooDeleteSupport: cuckooRow.trilemma.deleteSupport === true,
    compactFootprintCausallyUnerasable,
    unlimitedRoomBackfiresCompactFootprint,
    eternalStasisBackfiresDeletes,
    noDeletesNeededBackfiresDeletes,
    // 旧判词名：现算别名（由单开矩阵读数驱动，绝不写死 true）
    zeroErrorsBackfiresFpBand: unlimitedRoomBackfiresCompactFootprint,
    deleteImpossibleBackfiresDeletes: noDeletesNeededBackfiresDeletes,
    fpCeilingHolds: crosscheck.fpCeiling.holds,
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: {
      seed, capacity: intOr(opts.capacity, BF_DEFAULTS.capacity), scenarios: scenarioIds,
      rigged, unlimitedRoom: flags.unlimitedRoom, eternalStasis: flags.eternalStasis, noDeletesNeeded: flags.noDeletesNeeded,
    },
    rows, vectors, verdict,
    noUniversalWinner, trilemmaDistinguishes,
    rigged,
    crosscheck,
  }
}

export const compareBloomFilter = bloomFilterStudy

export function bloomFilterSnapshot(study) {
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
      fpCeiling: study.crosscheck.fpCeiling ? { ...study.crosscheck.fpCeiling } : undefined,
    } : undefined,
  }
}

/** 十一真件交叉印证：全部真 import、真 API、真调用、真回读，21 键无一硬编码兜底。 */
export function createBloomFilterEvidence(opts = {}) {
  const seed = intOr(opts.seed, BF_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `ev:key:${i}`)
  const ev = {}

  // ① compareRemapping —— 扩容最小重映射 vs 取模
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

  // ④ Wal —— Bloom 判重日志真回放
  const bf = createBloomFilter({ capacity: 256, bitsPerKey: 10, seed })
  const wal = createWal()
  for (const k of keys.slice(0, 80)) {
    bf.add(k)
    wal.append('put', k, { hit: bf.contains(k), slot: positionsFor(k, 3, 256)[0] })
  }
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  // ⑤ Bus —— 过滤器事件真通知
  const bus = createBus()
  let notices = 0
  bus.subscribe('filter.added', () => { notices += 1 })
  for (const k of keys.slice(0, 12)) bus.publish('filter.added', { key: k })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('filter.added')

  // ⑥ RedisCache —— 位图 slot 真 set + 真 get 命中
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (let i = 0; i < 96; i++) cache.set(`bm:slot:${i}`, 1)
  let bitmapHits = 0
  for (let i = 0; i < 96; i++) if (cache.get(`bm:slot:${i}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // ⑦ ObjectPool —— 取/还/复用真计数（无 ?? 兜底）
  const pool = createObjectPool({ factory: () => ({ slot: null }), maxSize: 8 })
  const p1 = pool.acquire(), p2 = pool.acquire()
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

  // ⑨ MinHeapDelayQueue —— Bloom 定时重建排程
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 80, 'rebuild:bloom')
  heap.schedule(fixedNow + 250, 'rebuild:cuckoo')
  heap.schedule(fixedNow + 40, 'rebuild:cbloom')
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

/* --------------------------- CLI --------------------------- */

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
    unlimitedRoom: rigged || args.includes('--unlimited-room') || args.includes('--unlimitedRoom'),
    eternalStasis: rigged || args.includes('--eternal-stasis') || args.includes('--eternalStasis'),
    noDeletesNeeded: rigged || args.includes('--no-deletes-needed') || args.includes('--noDeletesNeeded'),
  }
  const study = bloomFilterStudy(opts)
  const snap = bloomFilterSnapshot(study)
  console.log('[bloom-filter] seed=' + study.config.seed +
    ' rigged=' + study.config.rigged +
    ' unlimitedRoom=' + study.config.unlimitedRoom +
    ' eternalStasis=' + study.config.eternalStasis +
    ' noDeletesNeeded=' + study.config.noDeletesNeeded +
    ' builtAt=' + study.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(14) +
      ' bits/key=' + String(row.metrics.bitsPerKey).padStart(5) +
      ' totalFpRate=' + String(row.metrics.totalFpRate).padStart(7) +
      ' stashFailures=' + row.metrics.totalStashFailures +
      ' trilemma={' + ['compactFootprint', 'insertsNeverFail', 'deleteSupport']
        .map((dim) => dim + '=' + row.trilemma[dim]).join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + study.noUniversalWinner +
    ' distinguishable=' + study.trilemmaDistinguishes + ' rigged=' + study.rigged)
  const v = snap.verdict
  console.log('  verdict: compactFootprintCausallyUnerasable=' + v.compactFootprintCausallyUnerasable +
    ' noStrategyWinsAll=' + v.noStrategyWinsAll +
    ' vectorFromTrilemma=' + v.vectorFromTrilemma)
  console.log('  backfires: unlimitedRoom→compact=' + v.unlimitedRoomBackfiresCompactFootprint +
    ' eternalStasis→deletes=' + v.eternalStasisBackfiresDeletes +
    ' noDeletesNeeded→deletes=' + v.noDeletesNeededBackfiresDeletes)
  const fc = study.crosscheck.fpCeiling
  console.log('  fpCeiling: holds=' + fc.holds + ' nontrivial=' + fc.nontrivial +
    ' theory=' + fc.theory + ' measured=' + fc.measured +
    ' tamper{trust=' + fc.tamper.trustConfig.holds +
    ',zero=' + fc.tamper.zeroFpr.holds + ',skip=' + fc.tamper.skipProbe.holds + '}')
  const ev = study.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
}
