import { describe, expect, it, afterEach } from 'vitest'
import {
  createRedisServer,
  createRedisClient,
} from '../../scripts/spring-redis-cache.mjs'
import { createRedisLock } from '../../scripts/caesura-redis-lock.mjs'

/** 判别联合收窄夹具：acquire 成功时收紧到 LockAcquireOk */
const mustOk = (r: Awaited<ReturnType<ReturnType<typeof createRedisLock>['acquire']>>) => {
  if (!r.ok) throw new Error('expected lock acquire to succeed')
  return r
}

/**
 * KI-519：RESP `SET NX/XX PX` 原子语义 + Redis 分布式锁教学件。
 * 全部走真 socket（随机端口）、无假后端；诚实边界：单实例口径、非 Redlock、无 fencing token。
 */

const servers: import('node:net').Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

async function listen(): Promise<{ port: number }> {
  const { server } = createRedisServer({ maxKeys: 64, defaultTtlSec: 60 })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const addr = server.address() as { port: number }
  return { port: addr.port }
}

describe('KI-519 · RESP SET NX/XX PX 真线语法', () => {
  it('裸 SET key value 回 +OK（向后兼容）', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    expect(await c.set('k', 'v')).toBe('OK')
    expect(await c.get('k')).toBe('v')
    await c.quit()
  })

  it('SET key v NX：不存在 +OK，已存在 $-1（nil）', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    expect(await c.setNx('k', 'v1')).toBe('OK')
    expect(await c.setNx('k', 'v2')).toBeNull()
    expect(await c.get('k')).toBe('v1')
    await c.quit()
  })

  it('SET key v NX PX 100：第二次 SET 不覆盖原值', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    await c.setNx('k', 'orig', 100_000)
    expect(await c.setNx('k', 'hijack', 100_000)).toBeNull()
    expect(await c.get('k')).toBe('orig')
    await c.quit()
  })

  it('SET key v XX：存在才写入（锁续期语义），缺失回 $-1', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    expect(await c.setXx('k', 'v')).toBeNull() // 不存在
    await c.set('k', 'v1')
    expect(await c.setXx('k', 'v2')).toBe('OK')  // 存在
    expect(await c.get('k')).toBe('v2')
    await c.quit()
  })

  it('SET key v PX 100：写后 TTL 可见为毫秒级', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    await c.setPx('k', 'v', 100)
    const t = await c.ttl('k')
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThanOrEqual(1)
    await c.quit()
  })

  it('语法边角：EX/NX重复/PX非数字/多余token/PX缺参数 ⇒-ERR', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    // pipeline 把 -ERR 以 { error } 原样返回、不 reject —— 直接逐条核对姿态
    const out = (await c.pipeline([
      ['SET', 'k', 'v', 'EX', '10'],
      ['SET', 'k', 'v', 'NX', 'NX'],
      ['SET', 'k', 'v', 'PX', 'abc'],
      ['SET', 'k', 'v', 'LATERNOISE'],
      ['SET', 'k', 'v', 'PX'],
    ])) as { error?: string }[]
    expect(out[0].error).toMatch(/EX/)
    expect(out[1].error).toMatch(/syntax/)
    expect(out[2].error).toMatch(/PX/)
    expect(out[3].error).toMatch(/syntax/)
    expect(out[4].error).toMatch(/syntax/)
    await c.quit()
  })
})

describe('KI-519 · Redis 分布式锁（单实例 SET NX PX 口径）', () => {
  it('完整周期：acquire → critical section → release → 可再 acquire', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    const lock = createRedisLock({ client: c, key: 't:lock', ttlMs: 2000 })
    const a = mustOk(await lock.acquire())
    expect(await c.get('t:lock')).toBe(a.token)
    expect(await lock.release(a.token)).toBe(true)
    await mustOk(await lock.acquire())
    await c.quit()
  })

  it('互斥：两个客户端同键抢锁，恰好一个赢', async () => {
    const { port } = await listen()
    const a = createRedisClient({ port })
    const b = createRedisClient({ port })
    await a.connect(); await b.connect()
    const la = createRedisLock({ client: a, key: 't:race', ttlMs: 2000 })
    const lb = createRedisLock({ client: b, key: 't:race', ttlMs: 2000 })
    const [ra, rb] = await Promise.all([la.acquire(), lb.acquire()])
    expect([ra.ok, rb.ok].filter(Boolean).length).toBe(1)
    await la.release(ra.ok ? (ra as { token: string }).token : '')
    await lb.release(rb.ok ? (rb as { token: string }).token : '')
    await a.quit(); await b.quit()
  })

  it('释放：仅持锁者可释放；错 token / 空 token / 他人 token 都 false', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    const lock = createRedisLock({ client: c, key: 't:release', ttlMs: 2000 })
    const a = mustOk(await lock.acquire())
    expect(await lock.release('definitely-not-a-token')).toBe(false)
    expect(await lock.release('')).toBe(false)
    expect(await lock.release(a.token)).toBe(true)
    expect(await lock.release(a.token)).toBe(false) // 已释放后再放 false
    await c.quit()
  })

  it('续期：extend 拉长有效期；锁已过期则 false（不能续他人锁）', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    const lock = createRedisLock({ client: c, key: 't:extend', ttlMs: 200 })
    const a = mustOk(await lock.acquire())
    expect(await lock.extend(a.token, 5000)).toBe(true)
    expect(await lock.extend('other-token', 5000)).toBe(false)
    await c.quit()
  })

  it('TTL 到期自动释放：小 ttlMs 下锁自然松开可再取', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    const lock = createRedisLock({ client: c, key: 't:expire', ttlMs: 40 })
    await mustOk(await lock.acquire())
    await new Promise((r) => setTimeout(r, 80))
    const b = mustOk(await lock.acquire())
    await lock.release(b.token)
    await c.quit()
  })

  it('24 路竞争风暴：恰好一个 winner', async () => {
    const { port } = await listen()
    const clients = await Promise.all(
      Array.from({ length: 24 }, async () => {
        const c = createRedisClient({ port })
        await c.connect()
        return c
      }),
    )
    const results = await Promise.all(
      clients.map((c, i) =>
        createRedisLock({ client: c, key: 't:storm', ttlMs: 2000 }).acquire(),
      ),
    )
    const wins = results.filter((r) => r.ok).length
    expect(wins).toBe(1)
    for (const c of clients) await c.quit()
  })

  it('runExclusive：函数执行一次、finally 必释放；fn 抛错锁照样释放', async () => {
    const { port } = await listen()
    const c = createRedisClient({ port })
    await c.connect()
    const lock = createRedisLock({ client: c, key: 't:exclusive', ttlMs: 2000 })
    let ran = 0
    const r = await lock.runExclusive(async () => { ran++; return 'done' })
    expect(ran).toBe(1)
    expect(r.ok).toBe(true)
    expect(r.result).toBe('done')
    await expect(lock.runExclusive(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const after = mustOk(await lock.acquire())
    await lock.release(after.token)
    await c.quit()
  })

  it('未被占时 runExclusive 执行；已被占返回 reason:held 且不执行 fn', async () => {
    const { port } = await listen()
    const a = createRedisClient({ port })
    const b = createRedisClient({ port })
    await a.connect(); await b.connect()
    const la = createRedisLock({ client: a, key: 't:held', ttlMs: 2000 })
    const lb = createRedisLock({ client: b, key: 't:held', ttlMs: 2000 })
    const ra = mustOk(await la.acquire())
    let ran = 0
    const r = await lb.runExclusive(async () => { ran++ })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('held')
    expect(ran).toBe(0)
    await la.release(ra.token!)
    await a.quit(); await b.quit()
  })

  it('隔离：同键不同锁实例，持锁者 token 相异，互不能释放', async () => {
    const { port } = await listen()
    const a = createRedisClient({ port })
    const b = createRedisClient({ port })
    await a.connect(); await b.connect()
    const la = createRedisLock({ client: a, key: 't:iso', ttlMs: 2000 })
    const lb = createRedisLock({ client: b, key: 't:iso', ttlMs: 2000 })
    const ra = mustOk(await la.acquire())
    // a 立刻释放后 b 才能拿到
    expect(await lb.release('x')).toBe(false)
    await la.release(ra.token)
    const rb = mustOk(await lb.acquire())
    await lb.release(rb.token)
    await a.quit(); await b.quit()
  })

  it('CLI selfcheck 走查：真双客户端竞争恰好一赢', async () => {
    const { execFileSync } = await import('node:child_process')
    const { join } = await import('node:path')
    const out = execFileSync(process.execPath, [join(process.cwd(), 'scripts/caesura-redis-lock.mjs'), 'selfcheck'], { encoding: 'utf8', timeout: 15000 })
    expect(out).toContain('[lock-selfcheck] PASS')
    expect(out).toContain('winners=1')
  })
})
