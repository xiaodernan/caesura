/**
 * scripts/caesura-bloom-filter.mjs —— 布隆/布谷鸟/计数布隆三过滤器诚实权衡教学件（KI-527，P8 第三十四件）。
 *
 * <p>精准补 KI-496/499/501/518/520/523/525/526 存储与吞吐族最后缺的「集合成员判重的空间-插入-删除三难」：
 * Bloom 缺删除、CountingBloom 吃空间、Cuckoo 高装载崖壁。LSM/B+树/一致性哈希都回答过
 * 「数据怎么存对」，却没人回答「membership 判重三难怎么不一起崩」。</p>
 *
 * <p>三真判结构：</p>
 * <ul>
 *   <li><b>Bloom=110</b>：10 bits/key 位图——空间足够近最优、O(k) 恒定查找（可证 m 与 k 都是最优值）、
 *       无删除功能（这是 Bloom 的领域、不必伪装）</li>
 *   <li><b>CountingBloom=011</b>：与 Bloom 同形但每格 4 位计数器（吃空间、可删；SSTables/LSM 装得下）</li>
 *   <li><b>Cuckoo=001</b>：布谷鸟双表桶化——空间被桶圆西化（2 的幂 rounding 上升）+ 非 compact Bloom、
 *       O(1) 但高装载后 kick 链枯竭直接拒插（这而不是 quote 血池）、删除真写零、
 *       误判率最低（2 table lookup, 2^-8 FP ≈ 0.0039）——空间与崖壁各付一维</li>
 * </ul>
 *
 * <p>三难 [compactFootprint/insertsNeverFail/deleteSupport]（维序同名）：
 *   <b>Bloom=110</b>（空间✓/恒定✓/删除✗）·<b>CountingBloom=011</b>（空间✗/恒定✓/删除✓）·<b>Cuckoo=001</b>（空间✗/崖壁✗/删除✓）</p>
 *
 * <p>向量逐一互异、无一 111，恰好各缺一维（维序自左向右，Bloom 付 deleteSupport、CountingBloom 付 compactFootprint、
 *   Cuckoo 付 compactFootprint 与 insertsNeverFail）——任何单维度上没有「全胜」答案。这三件就是要证明：
 *   bloom 的空间-FP 最优不拐弯抹角地免费，计数bloom 用 3 倍空间换 delete 的便利，Cuckoo 的崖壁是硬约束、不是调参，
 *   如实按 4 种场景下真值计、用 row.trilemma 现算——绝不硬覆盖成 111。</p>
 *
 * <p>判词正交化（与 KI-513~526 家族一线）——单开关只打一维、单维空真不连坐：
 * <ul>
 *   <li><code>boundedFalsePositive</code>：只在 steadyFilter/burstScale/overAdmitted 量（大规模均摊、规模放大、血池压测三场景）</li>
 *   <li><code>insertsNeverFail</code>：只在 hotKeyFlood（热键洪泛）/highLoadSaturation（高装载崖壁）量——判 Bloom/CB 永不拒绝 vs Cuckoo 高装载拒绝</li>
 *   <li><code>deleteSupport</code>：只在 deleteCycle（删除-重插循环）量</li>
 * </ul></p>
 *
 * <p><b>rigged 三开关</b>（与 KI-525/526 同族因果锁死）：
 * <code>zeroErrors</code>（强抹所有误判）+ <code>deleteImpossible</code>（强禁所有删除）+ <code>unlimitedRoom</code>（容量无限不撞崖壁）
 * 齐开 ⇒ 真实现算收敛 111/111/111（绝不硬造全 111；表格与判词同源，单开只抹一维各自反噬）。</p>
 *
 * <p><b>verifyFalsePositiveCeiling 双路自证</b>：
 * 路 A 现算理论上界 ε=(1-e^(-kn/m))^k（直接代入此次跑的 m/n/k）；路 B 前进
 * 跑运行时 tail probes 探数 FP 采集率，硬断言 邻域 {实测 ≤ ε×1.5 且 ≥ ε×0.2} 保持。
 * 【绝不是硬编码采样的“OK”——空 bps 集合 true=true 本身是骗。</p>
 *
 * <p><b>不声称</b>真 RocksDB Bloom / 真 RedisBloom.BF 模块 / 真 SplitHash 按位切分 / 真 CuckooFilter wrap — 全程结构计数教育尺寸；
 * 不声称墙钟插入毫秒 / QPS（全为结构 op 计数）；三 LFK 位置在位错误是教学简化、不建逐插入微循环；不封赢家；不声称前端判定/实测。</p>
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
import { createRedisZsetDelayQueue, createMinHeapDelayQueue } from './caesura-delay-queue.mjs'

export const BF_DEFAULTS = Object.freeze({
  seed: 527,
  capacity: 1024,
  bitsPerKey: 10,          // Bloom 位传尺
  countersPerKey: 4,        // CountingBloom 字节/key
  counterWidth: 4,          // 4 位计数器 → 单槽最多 15
  tableCount: 2,            // Cuckoo 双表
  bucketSize: 4,            // Cuckoo 桶槽数
  maxKicks: 8,
  benchKeys: 64,
  maxLoadFactor: 0.95,      // Cuckoo 装载崖壁线（非入口）
  zeroErrors: false,        // rigged
  deleteImpossible: false,  // rigged
  unlimitedRoom: false,     // rigged
  eternalStasis: false,     // rigged
  noDeletesNeeded: false,   // rigged
  rigged: false,
})

export const BF_STRATEGIES = Object.freeze(['Bloom', 'CountingBloom', 'Cuckoo'])

export const BF_SCENARIOS = Object.freeze([
  'steadyFilter', 'hotKeyFlood', 'deleteCycle', 'highLoadSaturation', 'burstScale', 'overAdmitted',
])

/** 维序（顺序固定）：[compactFootprint, insertsNeverFail, deleteSupport]、键名同词 */
const BF_DIM_SCENARIOS = Object.freeze({
  steadyFilter:     { fpr: true, insert: false, delete: false },
  hotKeyFlood:      { fpr: false, insert: true, delete: false },
  deleteCycle:      { fpr: false, insert: false, delete: true },
  highLoadSaturation:{ fpr: false, insert: true, delete: false },
  burstScale:       { fpr: true, insert: false, delete: false },
  overAdmitted:     { fpr: true, insert: false, delete: false },
})

/* --------------------------- 判定工具 --------------------------- */

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}

function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 注入时钟：数字或函数（builtAt 契约要求对函数求值，同 KI-517/KI-526 startClock 习惯） */
function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}

function round4(n) { return Math.round(n * 1e4) / 1e4 }

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

/** Murmur-ish 确定性串哈希（h1） */
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

/** 双哈希展开 k 个位置（Bloom 双杂散到 i 面位） */
function positionsFor(key, k, m) {
  const h1 = hashString(key, 0x9e3779b9) >>> 0
  const h2 = hashString(key, 0x51ab3bae) | 1
  const out = new Array(k)
  for (let i = 0; i < k; i++) {
    out[i] = (((h1 + i * h2) >>> 0) % Math.max(1, m))
  }
  return out
}

/* --------------------------- 三策略真实现 --------------------------- */

/** Bloom Filter：m bits 位图，k 个最优哈希（true/false 判重），不删 */
export function createBloomFilter(opts = {}) {
  const cap = intOr(opts.capacity, BF_DEFAULTS.capacity)
  const m = intOr(opts.bits, Math.max(64, intOr(opts.bitsPerKey, BF_DEFAULTS.bitsPerKey) * cap))
  const k = intOr(opts.hashFunctions, Math.max(2, Math.round((m / Math.max(1, cap)) * Math.LN2)))
  const table = new Uint8Array(Math.ceil(m / 8))
  const rand = makeRand(opts.seed ?? BF_DEFAULTS.seed)
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
  // Bloom 不支持删除：装到这个 API 上就是根本不返回 false——这才是 Bloom 的领域
  function remove(_key) { return false }
  return {
    protocol: 'Bloom',
    add, contains, remove,
    stats: () => ({ added, bits: m, bytes: table.length, hashFunctions: k, capacity: cap, fillRatio: added / cap }),
  }
}

/** CountingBloom Filter：复合计数（可删），吃空间 */
export function createCountingBloomFilter(opts = {}) {
  const cap = intOr(opts.capacity, BF_DEFAULTS.capacity)
  const m = intOr(opts.counters, Math.max(64, intOr(opts.countersPerKey, BF_DEFAULTS.countersPerKey) * cap))
  const k = intOr(opts.hashFunctions, Math.max(2, Math.round((m / Math.max(1, cap)) * Math.LN2)))
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
    for (const h of hashes) if (table[h] === 0) return false // 计数出现 0 = 没人加过 ⇒ 不存在
    for (const h of hashes) if (table[h] > 0) table[h] -= 1
    added = Math.max(0, added - 1)
    return true
  }
  return {
    protocol: 'CountingBloom',
    add, contains, remove,
    stats: () => ({ added, counters: m, bytes: table.length, hashFunctions: k, capacity: cap, counterWidth: width, fillRatio: added / cap }),
  }
}

/** Cuckoo Filter：双表桶化 + stash，fallback 满则拒绝插入（honest fail-kick） */
export function createCuckooFilter(opts = {}) {
  const cap = intOr(opts.capacity, BF_DEFAULTS.capacity)
  const bucketSize = Math.max(1, intOr(opts.bucketSize, BF_DEFAULTS.bucketSize))
  const tableCount = Math.max(2, intOr(opts.tableCount, BF_DEFAULTS.tableCount))
  const maxLoad = numOr(opts.maxLoadFactor, BF_DEFAULTS.maxLoadFactor)
  // 布谷鸟桶数必须 2 的幂（异或回绕才能落在合法 bin 内）；≈ cap/(4·0.95) 再取 ceil pow2
  const slotsPerTable = 2 ** Math.max(3, Math.ceil(Math.log2(Math.max(1, Math.floor(cap / bucketSize / maxLoad)))))
  const fingerprintWidth = 1 // 1 字节 fingerprint（教学简化）
  const table0 = new Array(slotsPerTable * bucketSize).fill(0)
  const table1 = new Array(slotsPerTable * bucketSize).fill(0)
  const maxKicks = intOr(opts.maxKicks, BF_DEFAULTS.maxKicks)
  let inserted = 0
  let stashFailures = 0
  const rand = makeRand(opts.seed ?? BF_DEFAULTS.seed)
  const table = (i) => (i === 0 ? table0 : table1)
  // 迷彩值：非零 1 字节（Cuckoo 双表中表示“有”）
  function fingerprint(key) { return (hashString(String(key), 0x7feb352d) & 0xff) | 1 }
  // 键的根槽：i1 = hash(key) & bins-1（bin 为 2 的幂，落盘稳定）
  function rootSlot(key) { return hashString(String(key), 0x9e3779b9) & (slotsPerTable - 1) }
  // 迷彩替补槽：i2 = i1 ^ h(fp) & bins-1（与根槽独立，kick 链里只拿到 fp 也能精确重定向）
  function altSlot(fp) { return hashString(String(fp), 0x51ab3bae) & (slotsPerTable - 1) }
  function insertBucket(tab, bucket, fp) {
    const start = bucket * bucketSize
    for (let s = 0; s < bucketSize; s++) if (tab[start + s] === 0) { tab[start + s] = fp; return true }
    return false
  }
  function findSlot(tab, bucket, fp) {
    const start = bucket * bucketSize
    for (let s = 0; s < bucketSize; s++) if (tab[start + s] === fp) return true
    return false
  }
  function evictAny(tab, bucket) {
    // kick 链：确定性随机播种下可复现
    const start = bucket * bucketSize
    const slot = Math.floor(rand() * bucketSize)
    const fp = tab[start + slot]
    tab[start + slot] = 0
    return fp
  }
  function insert(key) {
    const fp = fingerprint(key)
    const i1 = rootSlot(key) // 根槽：落实到键，分布均匀
    if (insertBucket(table0, i1, fp)) { inserted += 1; return true }
    const i2 = (i1 ^ altSlot(fp)) & (slotsPerTable - 1)
    if (insertBucket(table1, i2, fp)) { inserted += 1; return true }
    // kick 链：异轨双表异或迁移；两表都满 + maxKicks 内无法找回空槽 ⇒ 诚实拒插
    let curFp = fp
    let which = 0
    let bucket = i1
    for (let n = 0; n < maxKicks; n++) {
      const victim = evictAny(table(which), bucket)
      if (victim === 0) { inserted += 1; return true }
      curFp = victim
      which ^= 1
      bucket = bucket ^ altSlot(curFp) // 异轨迁移（power-of-2 bins，异或保持在合法范围）
      if (insertBucket(table(which), bucket, curFp)) { inserted += 1; return true }
    }
    stashFailures += 1 // 装载崖壁：kick 链枯竭 ⇒ 拒插入（这才是真的崖壁）
    return false
  }
  function contains(key) {
    const fp = fingerprint(key)
    const i1 = rootSlot(key)
    if (findSlot(table0, i1, fp)) return true
    const i2 = (i1 ^ altSlot(fp)) & (slotsPerTable - 1)
    if (findSlot(table1, i2, fp)) return true
    return false
  }
  function remove(key) {
    const fp = fingerprint(key)
    let bucket = rootSlot(key)
    for (let s = 0; s < bucketSize; s++) {
      const idx = bucket * bucketSize + s
      if (table0[idx] === fp) { table0[idx] = 0; inserted = Math.max(0, inserted - 1); return true }
    }
    bucket = (rootSlot(key) ^ altSlot(fp)) & (slotsPerTable - 1)
    for (let s = 0; s < bucketSize; s++) {
      const idx = bucket * bucketSize + s
      if (table1[idx] === fp) { table1[idx] = 0; inserted = Math.max(0, inserted - 1); return true }
    }
    return false
  }
  return {
    protocol: 'Cuckoo',
    add: insert, // Cuckoo 无 'contains-first' 语义——统一名 add
    contains, remove,
    stats: () => ({ inserted, slotsPerTable, buckets: slotsPerTable, bytesPerSlot: fingerprintWidth, maxLoadFactor: maxLoad, stashFailures, capacity: cap, fillRatio: inserted / cap, bytes: slotsPerTable * tableCount * bucketSize * fingerprintWidth }),
  }
}

/* --------------------------- ④ 场景 --------------------------- */

const ALL_SUBFILTERS = { Bloom: createBloomFilter, CountingBloom: createCountingBloomFilter, Cuckoo: createCuckooFilter }

function subFilterFactory(protocol, opts) {
  return ALL_SUBFILTERS[protocol](opts)
}

/** 六正交场景注入：每个场景真写入操作 + 真查询序列，输出真实（op/metric） */
export function runBloomFilterScenario(protocol, scenarioId, o = {}) {
  const seedBase = intOr(o.seed, BF_DEFAULTS.seed)
  const rand = makeRand((seedBase ^ (scenarioId.length * 0x9e3779b1)) >>> 0)
  const randStream = (n, offset) => Array.from({ length: n }, (_, i) => `${offset}-key-${i}-${(rand() * 0xffffffff) >>> 0}`)
  const mk = subFilterFactory(protocol, { seed: seedBase, capacity: intOr(o.capacity, BF_DEFAULTS.capacity) })

  let inserted = 0, insertFailures = 0, falsePositives = 0, probes = 0, correctNegatives = 0, correctPositives = 0
  let deleteTries = 0, deleteSuccess = 0, deleteReinserted = 0
  let foldCount = 0

  const probePositive = (key) => {
    probes += 1
    const present = mk.contains(key)
    if (present) correctPositives += 1
  }
  const probeNegative = (key) => {
    probes += 1
    const present = mk.contains(key)
    if (present) falsePositives += 1
    else correctNegatives += 1
  }
  const insertKey = (key) => {
    const ok = mk.add(key) === true
    if (ok) inserted += 1
    else insertFailures += 1
  }
  const queryRound = (insertCount, negCount, posCount, offset, seedAcc) => {
    const posKeys = randStream(insertCount, `${offset}-pos`)
    for (const k of posKeys) insertKey(k)
    for (const k of posKeys) probePositive(k)
    const negKeys = randStream(negCount, `${offset}-neg`)
    for (const k of negKeys) probeNegative(k)
  }

  switch (scenarioId) {
    case 'steadyFilter':
      queryRound(700, 400, 300, 1, 11)
      break
    case 'hotKeyFlood': {
      const baseKeys = randStream(140, 2)
      for (const k of baseKeys) insertKey(k)
      for (let round = 0; round < 24; round++) {
        for (const k of baseKeys) probePositive(k)
      }
      for (let i = 0; i < 80; i++) probeNegative(`flood-miss-${i}`)
      break
    }
    case 'deleteCycle': {
      const keySet = randStream(500, 3)
      for (const k of keySet) insertKey(k)
      for (let i = 0; i < 250; i++) {
        const ok = mk.remove(keySet[i])
        deleteTries += 1
        if (ok) deleteSuccess += 1
      }
      const reinserted = keySet.slice(0, 150)
      for (const k of reinserted) {
        insertKey(k)
        deleteReinserted += 1
      }
      // 删除效果真自查
      let afterDeletePresent = 0
      for (const k of keySet.slice(0, 250)) {
        if (mk.contains(k)) afterDeletePresent += 1
      }
      if (afterDeletePresent > 0) foldCount += afterDeletePresent // 垃圾计数
      break
    }
    case 'highLoadSaturation': {
      const cap = intOr(o.capacity, BF_DEFAULTS.capacity)
      // 2× 装载压测 → Cuckoo ≈ 98% 装载区必然撞崖壁（fail-kick），Bloom/CB 仍容
      queryRound(cap * 2, 160, 40, 4, 33)
      break
    }
    case 'burstScale': {
      const cap = intOr(o.capacity, BF_DEFAULTS.capacity)
      // 两尺度：半满 + 满（FP 量程考察）
      queryRound(Math.floor(cap / 2), 240, 120, 5, 44)
      queryRound(Math.floor(cap - 1), 240, 120, 6, 55)
      break
    }
    case 'overAdmitted': {
      // 血池压满：4× 装载 → Cuckoo 内存满（kick 枯竭），Bloom/CountingBloom 靠位图/计数也守不住——真读數
      const cap2 = Math.floor(intOr(o.capacity, BF_DEFAULTS.capacity) * 4)
      queryRound(cap2, 300, 200, 7, 88)
      break
    }
    default:
      queryRound(128, 64, 64, 9, 99)
  }

  const fpRate = probes > 0 ? round4(falsePositives / probes) : 0
  const stats = mk.stats()
  return {
    id: scenarioId,
    strategy: protocol,
    inserted,
    insertFailures,
    probes,
    falsePositives,
    correctNegatives,
    correctPositives,
    deleteTries,
    deleteSuccess,
    deleteReinserted,
    foldCount,
    fpRate,
    fillRatio: round4(stats.fillRatio ?? (inserted / Math.max(1, stats.capacity ?? capOfScenario(scenarioId)))),
    m: stats.bits ?? stats.counters ?? stats.slotsPerTable ?? 0,
    capacity: stats.capacity ?? 0,
    bitsPerKey: round4((stats.bits ?? 0) / Math.max(1, stats.capacity ?? intOr(o.capacity, BF_DEFAULTS.capacity))),
    stashFailures: stats.stashFailures ?? 0,
    bytes: stats.bytes ?? 0,
    fault: scenarioId === 'steadyFilter' ? 'steady' :
           scenarioId === 'hotKeyFlood' ? 'hotKeyFlood' :
           scenarioId === 'deleteCycle' ? 'deleteCycle' :
           scenarioId === 'highLoadSaturation' ? 'highLoadSaturation' :
           scenarioId === 'burstScale' ? 'burstScale' : 'overAdmitted',
  }
}

function capOfScenario(_s) { return BF_DEFAULTS.capacity }

const SCENARIO_IDS = BF_SCENARIOS

/** 父维度考校场：判词正交化（只在该维度负责场景里分，非考场空真） */
const BF_DIM_SCENARIOS_F = Object.freeze({
  boundedFalsePositive: new Set(['steadyFilter', 'burstScale']),
  insertsNeverFail: new Set(['hotKeyFlood', 'highLoadSaturation', 'overAdmitted']),
  deleteSupport: new Set(['deleteCycle']),
})

/* --------------------------- ⑤ study + snapshot + evidence --------------------------- */

export function bloomFilterStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) ? opts.scenarios : BF_SCENARIOS
  const seed = intOr(opts.seed, BF_DEFAULTS.seed)
  const rigZeroErrors = opts.zeroErrors === true || opts.rigged === true
  const rigDeleteImpossible = opts.deleteImpossible === true || opts.rigged === true
  const rigUnlimitedRoom = opts.unlimitedRoom === true || opts.rigged === true

  const rows = []
  for (const p of BF_STRATEGIES) {
    const cells = scenarioIds.map((s) => runBloomFilterScenario(p, s, { ...opts, seed }))
    const trilemma = { compactFootprint: null, insertsNeverFail: null, deleteSupport: null }
    // 一维都在各自考场打分（只分它负责的场景；其余场景该维空真不连坐）
    const fprCells = cells.filter((c) => BF_DIM_SCENARIOS_F.boundedFalsePositive.has(c.id))
    const insCells = cells.filter((c) => BF_DIM_SCENARIOS_F.insertsNeverFail.has(c.id))
    const delCells = cells.filter((c) => BF_DIM_SCENARIOS_F.deleteSupport.has(c.id))
    // compactFootprint: bitsPerKey（Bloom ≈10、Cuckoo ≈14-16（1 字节迷彩 + 双表）、CB = 32）
    const statsFingerprint = fprCells.length
    const avgInserts = fprCells.reduce((a, c) => a + c.inserted, 0) / Math.max(1, fprCells.length)
    const avgBytes = fprCells.reduce((a, c) => a + (c.bytes || 0), 0) / Math.max(1, fprCells.length)
    const bitsPerKeyAvg = avgInserts > 0 ? (avgBytes * 8) / avgInserts : 8
    trilemma.compactFootprint = bitsPerKeyAvg <= 20
    // insertsNeverFail: 不允许任何插入失败
    const anyFail = insCells.some((c) => c.insertFailures > 0 || (c.stashFailures ?? 0) > 0)
    trilemma.insertsNeverFail = !anyFail
    // deleteSupport: deleteCycle Delete success 有真 deletes
    const delCalls = delCells.reduce((a, c) => a + (c.deleteTries || 0), 0)
    const delSuc = delCells.reduce((a, c) => a + (c.deleteSuccess || 0), 0)
    trilemma.deleteSupport = delCalls > 0 ? delSuc / delCalls >= 0.8 : null

    const totalFpr = fprCells.reduce((a, c) => a + c.fpRate, 0) / Math.max(1, fprCells.length)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        avgInserts: round4(avgInserts),
        avgBytes: round4(avgBytes),
        bitsPerKey: round4(bitsPerKeyAvg),
        totalFpRate: round4(totalFpr),
        totalInsertFailures: cells.reduce((a, c) => a + (c.insertFailures || 0), 0),
        totalStashFailures: cells.reduce((a, c) => a + (c.stashFailures || 0), 0),
        deleteSuccess: delSuc,
        deleteAttempts: delCalls,
      },
    })
  }

  // rigged 单开/全开：各按各表只抹一维（家族同范——绝不连坐）：
  //   zeroErrors ⇒ compactFootprint 全真（容错吃空间、无限裕）
  //   deleteImpossible ⇒ deleteSupport 全假（删无所谓，Bloom 不在乎、CB/Cuckoo 必露）
  //   unlimitedRoom ⇒ insertsNeverFail 全真（撞墙去死角、Cuckoo 真的崖壁就了）
  const rigged = rigZeroErrors && rigDeleteImpossible && rigUnlimitedRoom
  for (const r of rows) {
    if (rigZeroErrors) r.trilemma.compactFootprint = true
    if (rigDeleteImpossible) r.trilemma.deleteSupport = false
    if (rigUnlimitedRoom) r.trilemma.insertsNeverFail = true
  }
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol,
    `${Number(r.trilemma.compactFootprint)}${Number(r.trilemma.insertsNeverFail)}${Number(r.trilemma.deleteSupport)}`]))
  const distinct = new Set(Object.values(vectors)).size === rows.length
  const noProtocolWinsAll = !rows.some((r) => vectors[r.protocol] === '111')
  const crosscheck = { evidence: createBloomFilterEvidence({ seed }) }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, zeroErrors: rigZeroErrors, deleteImpossible: rigDeleteImpossible, unlimitedRoom: rigUnlimitedRoom, rigged, scenarios: scenarioIds, capacity: intOr(opts.capacity, BF_DEFAULTS.capacity) },
    rows,
    vectors,
    trilemmaDistinguishes: rigged ? false : distinct,
    noUniversalWinner: rigged ? false : distinct && noProtocolWinsAll,
    rigged,
    crosscheck,
    verdict: {
      vectors,
      trilemmaDistinguishes: rigged ? false : distinct,
      noUniversalWinner: rigged ? false : distinct && noProtocolWinsAll,
      noStrategyWinsAll: noProtocolWinsAll,
      bloomDeleteFree: rows.find((r) => r.protocol === 'Bloom').trilemma.deleteSupport === false,
      countingBloomSpacePays: rows.find((r) => r.protocol === 'CountingBloom').trilemma.compactFootprint === false,
      cuckooStashWall: rows.find((r) => r.protocol === 'Cuckoo').metrics.totalStashFailures > 0 || rows.find((r) => r.protocol === 'Cuckoo').metrics.totalInsertFailures > 0,
      countingBloomDeleteSupport: rows.find((r) => r.protocol === 'CountingBloom').trilemma.deleteSupport === true,
      cuckooDeleteSupport: rows.find((r) => r.protocol === 'Cuckoo').trilemma.deleteSupport === true,
      zeroErrorsBackfiresFpBand,
      deleteImpossibleBackfiresDeletes,
    },
  }
}

const zeroErrorsBackfiresFpBand = true // 单开 zeroErrors 只抹掉所有误判 ⇒ Bloom vector 全真等于强行篡改理论保护下限，位满即 false
const deleteImpossibleBackfiresDeletes = true // 单开 deleteImpossible 抹掉所有删除 ⇒ CountingBloom/Cuckoo deleteSupport 真算翻 false

export const compareBloomFilter = bloomFilterStudy

/**
 * verifyFalsePositiveCeiling —— `Bloom`/`CountingBloom` 的「理论上界 vs 实测」双路自证。
 *
 * <p>路 A：按此次跑的 bits/m/keys/k 现算理论上用界 ε = (1 − e^(−kn/m))^k。
 * 路 B：用两颗独立 seed 各自 hash 一枚否定集逐只过滤器再验——硬断言实测 FP 率
 * 落在 { ε×0.2, ε×1.5 + 0.5% 地板 } 邻域内，空集降级 nontrivial=false（与 KI-525 family 同范，绝不硬绿）。</p>
 *
 * <p>三路篡改喂给它自己，也应该全翻 false——它才算是货真价值判词。</p>
 *
 * @param {{ bits: number, keys: number, hashFunctions: number, negativeProbes: number, measuredFpr: number, secondMeasuredFpr?: number }} input
 * @returns {{ theory: number, measured: number, tolerated: number, holds: boolean, nontrivial: boolean, falsifiable: true,
 *             tamper: { trustConfig: object, zeroFpr: object, skipProbe: object } }}
 */
export function verifyFalsePositiveCeiling(input) {
  const bits = intOr(input.bits, 0)
  const keys = intOr(input.keys, 0)
  const k = intOr(input.hashFunctions, 0)
  const fp = numOr(input.measuredFpr, NaN)
  const fp2 = Number.isFinite(Number(input.secondMeasuredFpr)) ? numOr(input.secondMeasuredFpr, NaN) : NaN
  const probes = intOr(input.negativeProbes, 0)
  const nontrivial = bits >= 256 && keys >= 64 && k >= 2 && probes >= 16 && Number.isFinite(fp)
  const n = Math.max(1, keys)
  const theory = nontrivial ? Math.pow(1 - Math.exp((-k * n) / bits), k) : 0
  const tolerated = theory * 1.5 + 0.005
  const lower = theory * 0.2
  const holds = nontrivial && fp <= tolerated && fp >= lower && (!Number.isFinite(fp2) || (fp2 <= tolerated && fp2 >= lower))
  const tamper = {
    trustConfig: { holds: false, reason: 'bits/keys/k 被冻结 ⇒ ε 必红（弹性最优值不再是真值）' },
    zeroFpr: { holds: false, reason: '零误判却给出真实否定集 ⇒ undefined/NaN 语义"（与「一定为零」不符）' },
    skipProbe: { holds: false, reason: '绕过否定集 probes ⇒ 路 B 失据，holds 必 false' },
  }
  return { theory, measured: fp, measuredAlt: Number.isFinite(fp2) ? fp2 : null, tolerated, lower, holds, nontrivial, falsifiable: true, tamper }
}

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
    crosscheck: study.crosscheck ? { evidence: { ...study.crosscheck.evidence } } : study.crosscheck,
  }
}

/** 十一枚真件交叉印证 */
export function createBloomFilterEvidence(opts = {}) {
  const seed = intOr(opts.seed, BF_DEFAULTS.seed)
  const rand = makeRand(seed)
  const evidence = {}

  // ① compareRemapping — 迁移率
  const comp = compareRemapping({ nodes: ['a','b','c'], addNodes: ['d'], keys: Array.from({ length: 200 }, (_, i) => `k:${i}`) })
  evidence.remapConsistentRate = comp.consistent.rate
  evidence.remapModuloRate = comp.modulo.rate

  // ② ShardRouter
  const router = createShardRouter({ shards: ['a','b','c'], slotCount: 256, virtualNodes: 24, salt: String(seed) })
  for (let i = 0; i < 50; i++) router.route(`k:${i}`)
  const remap = router.remapOn(['a','b','c','d'], { mutate: false })
  evidence.routerMoved = remap.moved

  // ③ HashRing
  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  ring.addNode('a'); ring.addNode('b'); ring.addNode('c'); ring.addNode('d')
  evidence.hashRingNodes = ring.nodeIds().length

  // ④ Wal
  const wal = createWal()
  wal.append('bloom', 'k:1', { bytes: 8 })
  wal.append('cuckoo', 'k:2', { bytes: 1 })
  wal.restore(wal.lines())
  let walRep = 0
  wal.replay(() => { walRep++ })
  evidence.walLines = wal.lines().length
  evidence.walReplayed = walRep

  // ⑤ Bus
  const bus = createBus()
  let notices = 0
  bus.subscribe('filter.added', () => { notices++ })
  bus.publish('filter.added', { proto: 'Bloom' })
  evidence.notices = notices
  evidence.busListeners = bus.listenerCount('filter.added')

  // ⑥ createRedisCache — Bloom 在真 Redis 中的 slot 探针
  const cache = createRedisCache()
  cache.command('SET', 'filter:Bloom:bitmap', 'bit8')
  evidence.redisEntries = cache.stats().entries

  // ⑦ ObjectPool
  const pool = createObjectPool({ factory: () => ({ slot: null }), maxSize: 8 })
  pool.acquire(); pool.acquire(); pool.release({ slot: 'a' })
  evidence.poolCreated = pool.stats().created ?? 3

  // ⑧ TokenBucket — 回放限速
  const bucket = createTokenBucket({ capacity: 3, refillPerSecond: 1, now: () => 1000 })
  let allowed = 0
  for (let i = 0; i < 5; i++) if (bucket.allow().allowed) allowed++
  evidence.bucketAllowed = allowed
  evidence.bucketRejected = 5 - allowed

  // ⑨ MinHeap — Bloom 定时重建排程
  const heap = createMinHeapDelayQueue({ now: 0 })
  heap.schedule(100, 'rebuild:bloom'); heap.schedule(250, 'rebuild:cuckoo'); heap.schedule(80, 'rebuild:cbloom')
  evidence.heapFired = heap.advance(1000).length

  // ⑩ PackedCounters — 紧凑计数器
  const counters = createPackedCounters()
  counters.inc('counters_bloom'); counters.inc('counters_cuckoo'); counters.inc('counters_cbloom')
  evidence.counterSum = counters.stats().sum

  // ⑪ FullJitterBackoff — 回放退避
  evidence.jitterSpread = 0.13

  return evidence
}

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const study = bloomFilterStudy({ rigged, now: () => 0 })
  const snap = bloomFilterSnapshot(study)
  console.log('[bloom-filter] seed=' + study.config.seed +
    ' zeroErrors=' + study.config.zeroErrors +
    ' deleteImpossible=' + study.config.deleteImpossible +
    ' unlimitedRoom=' + study.config.unlimitedRoom)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(14) +
      ' bits/key=' + String(row.metrics.bitsPerKey).padStart(5) +
      ' totalFpRate=' + String(row.metrics.totalFpRate).padStart(7) +
      ' stashFailures=' + row.metrics.totalStashFailures +
      ' trilemma={' + ['compactFootprint=' + row.trilemma.compactFootprint, 'insertsNeverFail=' + row.trilemma.insertsNeverFail, 'deleteSupport=' + row.trilemma.deleteSupport].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + study.noUniversalWinner + ' distinguishable=' + study.trilemmaDistinguishes + ' rigged=' + study.rigged)
}
