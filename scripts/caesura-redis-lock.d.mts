/** `scripts/caesura-redis-lock.mjs` 的声明：Redis 分布式锁（单实例 SET NX PX 口径）教学件（KI-519）。 */

export interface LockAcquireOk {
  ok: true
  token: string
  ttlMs: number
  key: string
}

export interface LockAcquireFailed {
  ok: false
  key: string
}

export interface RedisLockHandle {
  acquire(token?: string): Promise<LockAcquireOk | LockAcquireFailed>
  release(token: string): Promise<boolean>
  extend(token: string, pxMs?: number): Promise<boolean>
  runExclusive<T>(fn: () => Promise<T> | T, token?: string): Promise<{ ok: boolean; result?: T; token?: string; reason?: 'held' }>
  key: string
  ttlMs: number
}

export interface RedisLockOpts {
  client: {
    setNx(key: string, value: string, pxMs?: number): Promise<string | null>
    setXx(key: string, value: string, pxMs?: number): Promise<string | null>
    get(key: string): Promise<string | null>
    del(key: string): Promise<number>
  }
  key?: string
  ttlMs?: number
}

export function createRedisLock(opts: RedisLockOpts): RedisLockHandle
