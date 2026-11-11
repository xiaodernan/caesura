/** `scripts/spring-redis-cache.mjs` 的声明：Redis 子集 / 内存 LRU+TTL 缓存 + RESP 协议兼容服务端。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。
 */

export interface CacheInstance {
  get(key: string): string | null
  set(key: string, value: string, ttlSec?: number): string
  del(key: string): number
  exists(key: string): number
  keys(): string[]
  ttl(key: string): number
  expire(key: string, sec: number): number
  flushall(): string
  size(): number
}

export interface RedisServerHandle {
  server: import('node:net').Server
  cache: CacheInstance
}

export interface RedisClientHandle {
  /** 连接到外部 RESP 服务器（命名为 `connect` 但内部用 ensureConnected 避免 shadow import） */
  connect(): Promise<void>
  ping(): Promise<string>
  set(key: string, value: string): Promise<string>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
  exists(key: string): Promise<number>
  keys(): Promise<string[]>
  ttl(key: string): Promise<number>
  expire(key: string, sec: number): Promise<number>
  flushall(): Promise<string>
  quit(): Promise<void>
}

export function createCacheInstance(opts?: { maxKeys?: number; defaultTtlSec?: number }): CacheInstance
export function createRedisServer(opts?: { maxKeys?: number; defaultTtlSec?: number }): RedisServerHandle
export function createRedisClient(opts?: { host?: string; port?: number }): RedisClientHandle
