/** `scripts/caesura-lsm-store.mjs` 的声明：LSM 风格存储引擎（P8 / KI-496）。 */

export type CompareFn = (a: any, b: any) => number

export interface SkipListOptions {
  maxLevel?: number
  p?: number
  rand?: () => number
  compare?: CompareFn
}

export interface LsmEntry {
  key: any
  value: any
  seq: number
  tombstone: boolean
}

export interface SkipList {
  get(key: any): LsmEntry | null
  put(key: any, value: any, seq?: number, tombstone?: boolean): LsmEntry
  del(key: any, seq?: number): LsmEntry
  range(lo?: any, hi?: any): LsmEntry[]
  entries(): LsmEntry[]
  size(): number
  stats(): { size: number; level: number; maxLevel: number; comparisons: number; puts: number; gets: number; dels: number }
  readonly currentLevel: number
}

export interface BloomFilterOptions {
  numKeys?: number
  bitsPerKey?: number
  m?: number
  k?: number
  baseHashes?: (key: any) => [number, number]
}

export interface BloomFilterStats {
  bits: number
  k: number
  inserted: number
  truePositives: number
  falsePositives: number
  negatives: number
  estimatedFpRate: number
}

export interface BloomFilter {
  add(key: any): boolean
  mightHave(key: any): boolean
  estimatedFpRate(): number
  stats(): BloomFilterStats
  readonly m: number
  readonly numHashes: number
}

export interface WalRecord {
  seq: number
  op: 'put' | 'del'
  key: any
  value: any
}

export interface WalOptions {
  sink?: any[] | { write(line: string): void } | null
  encode?: (rec: WalRecord) => string
  startSeq?: number
}

export interface Wal {
  append(op: 'put' | 'del', key: any, value?: any): WalRecord
  replay(fn: (rec: WalRecord) => void): number
  restore(lines: Array<string | WalRecord>): number
  entries(): WalRecord[]
  lines(): string[]
  clear(): void
  stats(): { entries: number; lastSeq: number }
  readonly lastSeq: number
}

export interface SSTableOptions {
  compare?: CompareFn
  indexEvery?: number
  level?: number
  bitsPerKey?: number
  k?: number
  m?: number
  baseHashes?: (key: any) => [number, number]
}

export interface SsTableGetResult {
  found: boolean
  entry: LsmEntry | null
  comparisons: number
  probes: number
  bloomRejected: boolean
}

export interface SsTableStats {
  level: number
  size: number
  minKey: any
  maxKey: any
  indexBlocks: number
  bloom: BloomFilterStats
  comparisons: number
}

export interface SSTable {
  get(key: any): SsTableGetResult
  range(lo?: any, hi?: any): LsmEntry[]
  stats(): SsTableStats
  serializable(): { level: number; minKey: any; maxKey: any; indexEvery: number; entries: LsmEntry[] }
  mightHave(key: any): boolean
  readonly size: number
  readonly minKey: any
  readonly maxKey: any
  readonly level: number
  entries(): LsmEntry[]
}

export interface LsmStoreOptions {
  memtableMax?: number
  levelMultiplier?: number
  compare?: CompareFn
  now?: () => number
  maxLevel?: number
  p?: number
  rand?: () => number
  indexEvery?: number
  bitsPerKey?: number
  k?: number
  m?: number
  baseHashes?: (key: any) => [number, number]
  sink?: any[] | { write(line: string): void } | null
  encode?: (rec: WalRecord) => string
  startSeq?: number
  wal?: Wal
}

export interface LsmGetResult {
  found: boolean
  value: any
  comparisons: number
  probes: number
  bloomRejected: number
  from: string | null
  level?: number | null
}

export interface CompactResult {
  from: number
  to: number
  inputEntries: number
  outputEntries: number
  mergedAway: number
  tombstonesDropped: number
}

export interface CompareScanResult {
  keys: number
  hits: number
  reads: number
  misses: number
  lsmComparisons: number
  scanComparisons: number
  speedup: number
  bloomRejects: number
}

export interface LsmStoreStats {
  writes: number
  reads: number
  gets: number
  misses: number
  flushes: number
  compactions: number
  mergedAway: number
  tombstonesDropped: number
  sstableGets: number
  bloomRejects: number
  comparisons: number
  scanBaselineComparisons: number
  speedup: number
  memtableSize: number
  uniqueKeys: number
  levels: Array<{ level: number; segments: number; entries: number }>
  wal: { entries: number; lastSeq: number }
  memtable: ReturnType<SkipList['stats']>
}

export interface LsmSnapshot {
  writes: number
  reads: number
  flushes: number
  compactions: number
  mergedAway: number
  tombstonesDropped: number
  comparisons: number
  scanBaselineComparisons: number
  speedup: number
  bloomRejects: number
  sstableGets: number
  memtableSize: number
  uniqueKeys: number
  levels: Array<{ level: number; segments: number; entries: number }>
  wal: { entries: number; lastSeq: number }
  builtAt: number
}

export interface LsmStore {
  put(key: any, value: any): boolean
  del(key: any): boolean
  get(key: any): LsmGetResult
  range(lo?: any, hi?: any): Array<{ key: any; value: any; seq: number }>
  flush(): SSTable | null
  compact(level?: number): CompactResult[]
  recover(lines?: Array<string | WalRecord>): number
  compareScan(keys: any[]): CompareScanResult
  stats(): LsmStoreStats
  snapshot(): LsmSnapshot
  readonly wal: Wal
  readonly memtable: SkipList
  readonly levels: SSTable[][]
}

export function defaultCompare(a: any, b: any): number

export function defaultBaseHashes(key: any): [number, number]

export function createSkipList(opts?: SkipListOptions): SkipList

export function createBloomFilter(opts?: BloomFilterOptions): BloomFilter

export function createWal(opts?: WalOptions): Wal

export function createSSTable(entries: LsmEntry[], opts?: SSTableOptions): SSTable

export function createLsmStore(opts?: LsmStoreOptions): LsmStore
