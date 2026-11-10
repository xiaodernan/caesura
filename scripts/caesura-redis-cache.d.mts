/** `scripts/caesura-redis-cache.mjs` 的声明：集大成缓存层（P8 / KI-493）。 */

export interface CacheStats {
  hits: number
  misses: number
  evicted: number
  expired: number
  inflight: number
  bytes: number
  entries: number
  hitRate: number
}

export interface RedisCacheBackend {
  command?(cmd: string, ...args: any[]): any
}

export interface RedisCacheOptions {
  maxEntries?: number
  maxBytes?: number
  ttlMs?: number
  now?: () => number
  sizeOf?: (key: string, value: any) => number
  backend?: RedisCacheBackend
}

export interface RedisCache {
  get<T = any>(key: string): T | undefined
  peek<T = any>(key: string): T | undefined
  set(key: string, value: any, ttlMs?: number): boolean
  del(key: string): boolean
  has(key: string): boolean
  load<T = any>(key: string, loader: () => T | Promise<T>, ttlMs?: number): Promise<T>
  evictExpired(at?: number): number
  stats(): CacheStats
  reset(): void
  command(cmd: string, ...args: any[]): any
  readonly maxEntries: number
  readonly maxBytes: number
  readonly defaultTtlMs: number
}

export function defaultSizeOf(key: string, value: any): number

export function createRedisCache(opts?: RedisCacheOptions): RedisCache
