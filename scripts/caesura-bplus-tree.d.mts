/** `scripts/caesura-bplus-tree.mjs` 的声明：B+ 树索引引擎 + 与 LSM 三笔账诚实对照（P8 / KI-504）。 */

export interface BPlusDefaults {
  readonly order: number
  readonly leafCapacity: number
  readonly keyCount: number
  readonly probeEvery: number
  readonly overwriteEvery: number
  readonly rangeFractions: readonly number[]
  readonly rangeWidth: number
  readonly extraMissKeys: readonly string[]
  readonly lsmMemtableMax: number
  readonly lsmLevelMultiplier: number
  readonly lsmIndexEvery: number
  readonly lsmBitsPerKey: number
  readonly lcgSeed: number
  readonly minOrder: number
  readonly heightLadder: readonly number[]
}

export type CompareFn = (a: any, b: any) => number

export interface BPlusTreeOptions {
  compare?: CompareFn
  /** 阶数（内节点最大孩子数）；奇数向上取偶、强制 ≥4（奇数无法把满节点均分两株）。 */
  order?: number
  /** 叶子最多存多少条记录（≥3）。 */
  leafCapacity?: number
  now?: () => number
}

export interface BPlusGetResult {
  found: boolean
  value: any
  comparisons: number
  nodeVisits: number
  from: string
}

export interface BPlusTreeStats {
  size: number
  order: number
  fanout: number
  leafCapacity: number
  height: number
  leafCount: number
  nodeCount: number
  minLeafKeys: number
  minInternalKeys: number
  maxInternalKeys: number
  comparisons: number
  rangeLeafHops: number
  puts: number
  dels: number
  gets: number
  ranges: number
  splits: number
  merges: number
  borrows: number
  separatorRefreshes: number
  /** B+ 写放大模型：每次 put 至少重写 1 叶 + 每次结构重排 2 页。非字节/墙钟。 */
  pageRewrites: number
}

export interface BPlusSnapshot {
  size: number
  order: number
  fanout: number
  leafCapacity: number
  height: number
  heightEstimate: number
  leafCount: number
  nodeCount: number
  comparisons: number
  rangeLeafHops: number
  puts: number
  dels: number
  gets: number
  ranges: number
  splits: number
  merges: number
  borrows: number
  pageRewrites: number
  /** validate() 违例数；0 = 真 B+ 树不变式全过。 */
  invariants: number
  builtAt: number
}

export interface BPlusTree {
  put(key: any, value: any): boolean
  get(key: any): BPlusGetResult
  del(key: any): boolean
  range(lo?: any, hi?: any): Array<{ key: any; value: any }>
  entries(): Array<{ key: any; value: any }>
  size(): number
  height(): number
  stats(): BPlusTreeStats
  snapshot(): BPlusSnapshot
  /** 不变式校验：返回违例串数组（空 = 健康）。 */
  validate(): string[]
  reset(): boolean
  readonly order: number
  readonly fanout: number
  readonly leafCapacity: number
  /** 仅供调试的单根引用 getter（不给写权限）。 */
  readonlyRoot(): any
}

export interface DeterministicKeys {
  keys: string[]
  probes: string[]
  rangeQueries: Array<[string, string]>
}

export interface CompareOptions {
  keyCount?: number
  keys?: any[]
  probes?: any[]
  rangeQueries?: Array<[any, any]>
  order?: number
  leafCapacity?: number
  overwriteEvery?: number
  compare?: CompareFn
  now?: () => number
  rand?: () => number
  lcgSeed?: number
  probeEvery?: number
  rangeFractions?: number[]
  rangeWidth?: number
  extraMissKeys?: string[]
  lsmMemtableMax?: number
  lsmLevelMultiplier?: number
  lsmIndexEvery?: number
  lsmBitsPerKey?: number
}

export type Favors = 'bplus' | 'lsm' | 'tie'

export interface BplusVsLsmVerdict {
  /** 先决条件：两引擎在同批 key 上的 get/range 答案逐条一致；false 则下面性能对照不作数。 */
  bothAgree: boolean
  pointFavors: Favors
  rangeFavors: Favors
  writeFavors: Favors
  bplusPointFewerComparisons: boolean
  bplusRangeIsSequential: boolean
  lsmRangeNeedsMergeSort: boolean
  bplusPaysInPlaceRewrites: boolean
  lsmPaysCompactionRewrites: boolean
  lsmReadIsCrossLevel: boolean
  noUniversalWinner: boolean
  agreeIsPrerequisite: boolean
}

export interface ComparisonConfig {
  keys: number
  probes: number
  rangeQueries: number
  order: number
  fanout: number
  leafCapacity: number
  overwriteEvery: number
  lsmMemtableMax: number
}

export interface BplusSide {
  height: number
  heightEstimate: number
  leafCount: number
  nodeCount: number
  invariants: number
  pointComparisons: number
  rangeComparisons: number
  leafHops: number
  rangeResults: number
  rangeCost: number
  write: {
    puts: number
    splits: number
    merges: number
    borrows: number
    pageRewrites: number
    height: number
    leafCount: number
  }
}

export interface LsmSide {
  levels: Array<{ level: number; segments: number; entries: number }>
  flushes: number
  compactions: number
  bloomRejects: number
  sstableGets: number
  pointComparisons: number
  rangeComparisons: number
  segmentsTouched: number
  entriesScanned: number
  sortComparisons: number
  rangeResults: number
  rangeCost: number
  write: {
    writes: number
    flushes: number
    compactions: number
    mergedAway: number
    tombstonesDropped: number
    walEntries: number
    seqWriteUnits: number
  }
}

export interface CompareResult {
  config: ComparisonConfig
  bplus: BplusSide
  lsm: LsmSide
  agreement: { pointMismatches: number; rangeMismatches: number; bothAgree: boolean }
  verdict: BplusVsLsmVerdict
  builtAt: number
}

export interface BplusStudyOptions extends CompareOptions {
  heightLadder?: number[]
}

export interface HeightLadderRow {
  order: number
  fanout: number
  heightEstimate: number
}

export interface BplusStudy {
  generator: string
  comparison: CompareResult
  heightLadder: HeightLadderRow[]
  verdict: BplusVsLsmVerdict
  builtAt: number
}

export interface BpSnapshot {
  config: ComparisonConfig
  structure: {
    height: number
    heightEstimate: number
    leafCount: number
    nodeCount: number
    order: number
    fanout: number
    invariants: number
    heightLadder: HeightLadderRow[]
  }
  point: { bplusComparisons: number; lsmComparisons: number; favors: Favors }
  range: {
    bplusCost: number
    lsmCost: number
    bplusLeafHops: number
    bplusResults: number
    lsmSegments: number
    lsmSortComparisons: number
    lsmResults: number
    favors: Favors
  }
  write: {
    bplusPageRewrites: number
    bplusSplits: number
    bplusMerges: number
    bplusBorrows: number
    lsmSeqWriteUnits: number
    lsmFlushes: number
    lsmCompactions: number
    lsmMergedAway: number
    favors: Favors
  }
  levels: Array<{ level: number; segments: number; entries: number }>
  agreement: { pointMismatches: number; rangeMismatches: number; bothAgree: boolean }
  verdict: BplusVsLsmVerdict
  builtAt: number
}

export const BP_DEFAULTS: BPlusDefaults

export function defaultCompare(a: any, b: any): number

/** 层高教学估计（mid 分裂半填充稳态，含叶+根至少两层）；n ≤ 0 回 0。 */
export function heightEstimate(n: number, order?: number, leafCapacity?: number): number

export function createBPlusTree(opts?: BPlusTreeOptions): BPlusTree

/** 校验一株树的不变式，返回违例串数组（与 tree.validate() 同源）。 */
export function validateBPlusTree(tree: BPlusTree | any): string[]

export function deterministicKeys(n?: number, opts?: { probeEvery?: number; rangeWidth?: number; rangeFractions?: number[]; extraMissKeys?: string[] }): DeterministicKeys

export function compareBplusVsLsm(opts?: CompareOptions): CompareResult

export function bplusStudy(opts?: BplusStudyOptions): BplusStudy

export function bpSnapshot(study: BplusStudy | null | undefined): BpSnapshot | null
