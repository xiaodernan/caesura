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
  [k: string]: any
}>
export const BF_STRATEGIES: readonly string[]
export const BF_SCENARIOS: readonly string[]

/** 三过滤器统一实例接口：add/contains/remove + stats */
export interface SubFilterInstance {
  protocol: 'Bloom' | 'CountingBloom' | 'Cuckoo'
  add(key: any): boolean
  contains(key: any): boolean
  remove(key: any): boolean
  stats(): Record<string, number | boolean | string | null | undefined>
}

export function createBloomFilter(opts?: {
  capacity?: number; bits?: number; bitsPerKey?: number; hashFunctions?: number; seed?: number; [k: string]: any
}): SubFilterInstance
export function createCountingBloomFilter(opts?: {
  capacity?: number; counters?: number; countersPerKey?: number; counterWidth?: number; hashFunctions?: number; seed?: number; [k: string]: any
}): SubFilterInstance
export function createCuckooFilter(opts?: {
  capacity?: number; bucketSize?: number; tableCount?: number; maxKicks?: number; maxLoadFactor?: number; seed?: number; [k: string]: any
}): SubFilterInstance

/** 六正交场景真跑 cell：全部为真实结构计数，非硬编码 */
export interface BloomCell {
  id: string
  strategy: string
  inserted: number
  insertFailures: number
  probes: number
  negProbes: number
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
  [k: string]: any
}

export interface BloomFilterTrilemma {
  compactFootprint: boolean
  insertsNeverFail: boolean
  deleteSupport: boolean
}

export interface BloomFilterMetrics {
  bitsPerKey: number
  totalFpRate: number
  totalInsertFailures: number
  totalStashFailures: number
  deleteAttempts: number
  deleteSuccess: number
  deleteReinserted: number
  foldCount: number
  [k: string]: any
}

export interface BloomRow {
  protocol: string
  scenarios: BloomCell[]
  trilemma: BloomFilterTrilemma
  metrics: BloomFilterMetrics
}

export function runBloomFilterScenario(
  protocol: string,
  scenarioId: string,
  o?: Record<string, any>,
): BloomCell

export interface BloomFilterVerdict {
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  bloomDeleteFree: boolean
  countingBloomSpacePays: boolean
  cuckooStashWall: boolean
  countingBloomDeleteSupport: boolean
  cuckooDeleteSupport: boolean
  compactFootprintCausallyUnerasable: boolean
  unlimitedRoomBackfiresCompactFootprint: boolean
  eternalStasisBackfiresDeletes: boolean
  noDeletesNeededBackfiresDeletes: boolean
  zeroErrorsBackfiresFpBand: boolean
  deleteImpossibleBackfiresDeletes: boolean
  fpCeilingHolds: boolean
  [k: string]: any
}

export interface BloomFilterStudy {
  builtAt: number
  config: Record<string, any>
  rows: BloomRow[]
  vectors: Record<string, string>
  verdict: BloomFilterVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  rigged: boolean
  crosscheck: Record<string, any>
}

export function bloomFilterStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  capacity?: number
  scenarios?: readonly string[]
  rigged?: boolean
  zeroErrors?: boolean
  deleteImpossible?: boolean
  unlimitedRoom?: boolean
  eternalStasis?: boolean
  noDeletesNeeded?: boolean
  [k: string]: any
}): BloomFilterStudy

/** compareBloomFilter 同构别名：指向同一 bloomFilterStudy。 */
export const compareBloomFilter: typeof bloomFilterStudy

export function bloomFilterSnapshot(study: BloomFilterStudy | null | undefined): {
  builtAt: number
  config: Record<string, any>
  rows: BloomRow[]
  vectors: Record<string, string>
  verdict: BloomFilterVerdict
} | null

export interface FpCeilingInput {
  bits: number
  keys: number
  hashFunctions: number
  negativeProbes: number
  measuredFpr: number
  secondMeasuredFpr?: number
  [k: string]: any
}

export interface FpCeilingReading {
  theory: number
  measured: number | null
  measuredAlt: number | null
  tolerated: number
  lower: number
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    trustConfig: Record<string, any>
    zeroFpr: Record<string, any>
    skipProbe: Record<string, any>
  }
}

/** 双路守恒自证：理论上界 ε=(1-e^(-kn/m))^k vs 真否定集采样，三路篡改真喂回现算翻 false */
export function verifyFalsePositiveCeiling(input: FpCeilingInput): FpCeilingReading

/** 十一枚同仓真件交叉印证，evidence 21 键全真 API 真回读、计数不硬编码 */
export function createBloomFilterEvidence(opts?: { seed?: number; [k: string]: any }): Record<string, number>
