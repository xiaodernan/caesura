/** `scripts/caesura-hw-perf.mjs` 的声明：OS / 硬件适配性能教学件（P8 / KI-497）。 */

export const DEFAULT_CACHE_LINE_BYTES: number

export interface ObjectPoolOptions {
  factory?: () => any
  reset?: (obj: any) => void
  maxSize?: number
}

export interface ObjectPoolStats {
  created: number
  reused: number
  acquired: number
  released: number
  dropped: number
  idle: number
  inUse: number
  peakIdle: number
  reuseRate: number
}

export interface ObjectPool {
  acquire(): any
  release(obj: any): boolean
  reset(): number
  stats(): ObjectPoolStats
  readonly maxSize: number
}

export interface AllocationStudyOptions extends ObjectPoolOptions {
  accesses?: number
  touch?: (obj: any, i: number) => void
}

export interface AllocationStudy {
  accesses: number
  naiveCreated: number
  poolCreated: number
  saved: number
  reused: number
  dropped: number
  reuseRate: number
  peakIdle: number
}

export interface CounterOptions {
  cacheLineBytes?: number
}

export interface CounterStats {
  count: number
  padded: boolean
  cacheLineBytes: number
  elementsPerLine: number
  startIndices: number[]
  distinctLines: number
  falseSharingPairs: number
  spanBytes: number
  totalLines: number
  paddingOverhead: number
}

export interface PaddedCounters {
  inc(i: number, by?: number): number
  get(i: number): number
  lineOf(i: number): number
  sharesLine(a: number, b: number): boolean
  stats(): CounterStats
  readonly count: number
  readonly backing: Float64Array
  readonly elementsPerLine: number
}

export interface PackedCounters {
  inc(i: number, by?: number): number
  get(i: number): number
  lineOf(i: number): number
  sharesLine(a: number, b: number): boolean
  stats(): CounterStats
  readonly count: number
  readonly backing: Float64Array
}

export interface LruLineCacheOptions {
  lineBytes?: number
  cacheBytes?: number
}

export interface LruAccessResult {
  hit: boolean
  lineId: number
  evicted: number | null
}

export interface LruRangeResult {
  firstLine: number
  lastLine: number
  lines: number
  missed: number
}

export interface LruLineCacheStats {
  hits: number
  misses: number
  evictions: number
  accesses: number
  hitRate: number
  capacityLines: number
  lineBytes: number
  cacheBytes: number
  residentLines: number
}

export interface LruLineCache {
  access(address: number): LruAccessResult
  accessRange(startByte: number, lengthBytes?: number): LruRangeResult
  accessLine(lineId: number): { hit: boolean; miss: boolean; lineId: number; evicted: number | null }
  stats(): LruLineCacheStats
  reset(): void
  readonly capacityLines: number
}

export interface CompareLayoutsOptions {
  count?: number
  structBytes?: number
  fieldBytes?: number
  fieldOffset?: number
  stride?: number
  cacheBytes?: number
  lineBytes?: number
}

export interface LayoutSide {
  misses: number
  hits: number
  hitRate: number
  touchedLines: number
}

export interface LayoutComparison {
  count: number
  stride: number
  indices: number
  aos: LayoutSide
  soa: LayoutSide
  speedup: number
  model: { cacheBytes: number; lineBytes: number; capacityLines: number; structBytes: number; fieldBytes: number; fieldOffset: number }
}

export function createObjectPool(opts?: ObjectPoolOptions): ObjectPool

export function allocationStudy(opts?: AllocationStudyOptions): AllocationStudy

export function createCacheLinePadder(count: number, opts?: CounterOptions): PaddedCounters

export function createPackedCounters(count: number, opts?: CounterOptions): PackedCounters

export function createLruLineCache(opts?: LruLineCacheOptions): LruLineCache

export function compareLayouts(opts?: CompareLayoutsOptions): LayoutComparison
