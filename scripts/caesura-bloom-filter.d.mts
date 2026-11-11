/** `scripts/caesura-bloom-filter.mjs` 的声明：布隆/布谷鸟/计数布隆三过滤器诚实权衡教学件（KI-527）。 */

export const BF_DEFAULTS: Readonly<{
  seed: number
  capacity: number
  bitsPerKey: number
  countersPerKey: number
  counterWidth: number
  tableCount: number
  bucketSize: number
  maxKicks: number
  benchKeys: number
  maxLoadFactor: number
  zeroErrors: boolean
  deleteImpossible: boolean
  unlimitedRoom: boolean
  eternalStasis: boolean
  noDeletesNeeded: boolean
  rigged: boolean
}>
export const BF_STRATEGIES: readonly string[]
export const BF_SCENARIOS: readonly string[]

export interface BloomStats {
  added: number
  bits: number
  bytes: number
  hashFunctions: number
  capacity: number
  fillRatio: number
}
export interface CountingBloomStats {
  added: number
  counters: number
  bytes: number
  hashFunctions: number
  capacity: number
  counterWidth: number
  fillRatio: number
}
export interface CuckooStats {
  inserted: number
  slotsPerTable: number
  buckets: number
  bytesPerSlot: number
  maxLoadFactor: number
  stashFailures: number
  capacity: number
  fillRatio: number
  bytes: number
}
export interface BloomFilterInstance {
  protocol: 'Bloom'
  add(key: string): boolean
  contains(key: string): boolean
  remove(_key: string): false
  stats(): BloomStats
}
export interface CountingBloomInstance {
  protocol: 'CountingBloom'
  add(key: string): boolean
  contains(key: string): boolean
  remove(key: string): boolean
  stats(): CountingBloomStats
}
export interface CuckooInstance {
  protocol: 'Cuckoo'
  add(key: string): boolean
  contains(key: string): boolean
  remove(key: string): boolean
  stats(): CuckooStats
}
export function createBloomFilter(opts?: { capacity?: number; bits?: number; bitsPerKey?: number; hashFunctions?: number; seed?: number }): BloomFilterInstance
export function createCountingBloomFilter(opts?: { capacity?: number; counters?: number; countersPerKey?: number; counterWidth?: number; hashFunctions?: number; seed?: number }): CountingBloomInstance
export function createCuckooFilter(opts?: { capacity?: number; bucketSize?: number; tableCount?: number; maxKicks?: number; maxLoadFactor?: number; seed?: number }): CuckooInstance

/** 六正交场景：稳态 filter / 热键洪泛 / 删除循环 / 高装载崖壁 / 规模放大 / 血池超载 */
export interface BloomCell {
  id: string
  strategy: string
  inserted: number
  insertFailures: number
  probes: number
  falsePositives: number
  correctNegatives: number
  correctPositives: number
  deleteTries: number
  deleteSuccess: number
  deleteReinserted: number
  foldCount: number
  fpRate: number
  fillRatio: number
  m: number
  capacity: number
  bitsPerKey: number
  stashFailures: number
  bytes: number
  fault: string
}
export interface BloomRow {
  protocol: 'Bloom' | 'CountingBloom' | 'Cuckoo'
  scenarios: BloomCell[]
  trilemma: { compactFootprint: boolean; insertsNeverFail: boolean; deleteSupport: boolean }
  metrics: {
    avgInserts: number
    avgBytes: number
    bitsPerKey: number
    totalFpRate: number
    totalInsertFailures: number
    totalStashFailures: number
    deleteSuccess: number
    deleteAttempts: number
  }
}
export interface BloomFilterStudy {
  builtAt: number
  config: {
    seed: number
    zeroErrors: boolean
    deleteImpossible: boolean
    unlimitedRoom: boolean
    eternalStasis: boolean
    noDeletesNeeded: boolean
    rigged: boolean
    scenarios: string[] | readonly string[]
    capacity: number
  }
  rows: BloomRow[]
  vectors: Record<string, string>
  trilemmaDistinguishes: boolean
  noUniversalWinner: boolean
  rigged: boolean
  verdict: {
    vectors: Record<string, string>
    trilemmaDistinguishes: boolean
    noUniversalWinner: boolean
    noStrategyWinsAll: boolean
    bloomDeleteFree: boolean
    countingBloomSpacePays: boolean
    cuckooStashWall: boolean
    countingBloomDeleteSupport: boolean
    cuckooDeleteSupport: boolean
    zeroErrorsBackfiresFpBand: boolean
    deleteImpossibleBackfiresDeletes: boolean
  }
}
export function bloomFilterStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  capacity?: number
  scenarios?: readonly string[]
  zeroErrors?: boolean
  deleteImpossible?: boolean
  unlimitedRoom?: boolean
  rigged?: boolean
}): BloomFilterStudy

/** compareBloomFilter 同构别名：指向同一 bloomFilterStudy。 */
export const compareBloomFilter: typeof bloomFilterStudy

export interface BloomFilterSnapshot {
  builtAt: number
  config: BloomFilterStudy['config']
  rows: BloomFilterStudy['rows']
  vectors: Record<string, string>
  verdict: BloomFilterStudy['verdict']
}
export function bloomFilterSnapshot(study: BloomFilterStudy | null | Record<string, never>): BloomFilterSnapshot | null

export function verifyFalsePositiveCeiling(input: {
  bits: number
  keys: number
  hashFunctions: number
  negativeProbes: number
  measuredFpr: number
  secondMeasuredFpr?: number
}): {
  theory: number
  measured: number
  measuredAlt: number | null
  tolerated: number
  lower: number
  holds: boolean
  nontrivial: boolean
  falsifiable: true
  tamper: {
    trustConfig: { holds: false; reason: string }
    zeroFpr: { holds: false; reason: string }
    skipProbe: { holds: false; reason: string }
  }
}

export interface BloomEvidence {
  remapConsistentRate: number
  remapModuloRate: number
  routerMoved: number
  hashRingNodes: number
  walLines: number
  walReplayed: number
  notices: number
  busListeners: number
  redisEntries: number
  poolCreated: number
  bucketAllowed: number
  bucketRejected: number
  heapFired: number
  counterSum: number
  jitterSpread: number
  [key: string]: number
}
export function createBloomFilterEvidence(opts?: { seed?: number }): BloomEvidence

export function runBloomFilterScenario(protocol: string, scenarioId: string, opts?: Record<string, unknown>): BloomCell
