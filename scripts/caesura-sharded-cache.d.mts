/** `scripts/caesura-sharded-cache.mjs` 的声明：分片缓存客户端 / 扩缩容命中率保留率对照（KI-500）。 */

/** 缺省教学参数（判定仍由注入值定）。 */
export const SHARD_DEFAULTS: Readonly<{
  virtualNodes: number
  salt: string
  defaultShards: string[]
}>

/** 一片 Redis 风格缓存的判定面（KI-493 createRedisCache）。 */
export interface ShardCache {
  get(k: any): any
  peek?(k: any): any
  set(k: any, v: any, ttlMs?: number): any
  del?(k: any): any
  has?(k: any): boolean
  load(k: any, loader: (...args: any[]) => any, ttlMs?: number): Promise<any>
  evictExpired?(at?: number): number
  stats(): { hits: number; misses: number; entries: number; evicted?: number; expired?: number; bytes?: number; inflight?: number; hitRate?: number }
  reset?(): void
  [k: string]: any
}

export interface ShardedCacheOptions {
  shards?: string[]
  ring?: { lookup(k: any): any; snapshot(opts?: { ring?: boolean }): any; [k: string]: any }
  cacheFactory?: (shardId: string) => ShardCache
  cacheOpts?: Record<string, any>
  virtualNodes?: number
  hashFn?: (str: string) => number
  salt?: string
  now?: () => number
}

export interface ShardShare { hits: number; misses: number; entries: number; hitRate: number }

export interface ShardedCacheStats {
  shards: number
  hits: number
  misses: number
  entries: number
  evicted: number
  expired: number
  bytes: number
  inflight: number
  hitRate: number
  perShard: Record<string, ShardShare>
  invalidation: InvalidationLedger
}

export interface InvalidationLedger {
  remaps: number
  keysInvalidated: number
  keysRetained: number
  added: string[]
  removed: string[]
}

export interface RemapOutcome {
  retained: number
  invalidated: number
  total: number
  retentionRate: number
  shards: string[]
}

export interface ShardedCacheSnapshot {
  shards: string[]
  virtualNodes: number
  salt: string
  ring: any
  perShard: Record<string, { entries: number; hits: number; misses: number }>
  invalidation: InvalidationLedger
  ringPoints?: any[]
}

/** 分片缓存客户端：按一致性哈希环把 key 路由到某片，每片挂一只 Redis 风格缓存。 */
export interface ShardedCache {
  shardOf(key: any): string | null
  get(key: any): any
  peek(key: any): any
  set(key: any, value: any, ttlMs?: number): boolean
  del(key: any): boolean
  has(key: any): boolean
  load(key: any, loader: (...args: any[]) => any, ttlMs?: number): Promise<any>
  evictExpired(at?: number): number
  stats(): ShardedCacheStats
  remapOn(nextShards: any[], keys?: any[]): RemapOutcome
  reset(): void
  snapshot(opts?: { ring?: boolean }): ShardedCacheSnapshot
  readonly shards: string[]
  readonly salt: string
  readonly virtualNodes: number
}

export function createShardedCache(opts?: ShardedCacheOptions): ShardedCache

export interface RetentionOptions {
  shards?: string[]
  nextShards?: string[]
  keys?: any[]
  /** 'consistent'=一致性哈希环，'modulo'=朴素取模（两侧都算，此字段仅保留兼容）。 */
  strategy?: 'consistent' | 'modulo'
  virtualNodes?: number
  hashFn?: (str: string) => number
  salt?: string
}

export interface RetentionSide {
  strategy: 'consistent' | 'modulo'
  shardsBefore: number
  shardsAfter: number
  delta: number
  keys: number
  retained: number
  moved: number
  retentionRate: number
}

/** 扩缩容命中率保留率对照证据（与 KI-499 compareRemapping 互为镜像）。 */
export interface RetentionComparison {
  shards: string[]
  nextShards: string[]
  keys: number
  consistent: RetentionSide
  modulo: RetentionSide
  savedRate: number
  theoreticalConsistent: number
}

export function compareHitRetention(opts?: RetentionOptions): RetentionComparison
