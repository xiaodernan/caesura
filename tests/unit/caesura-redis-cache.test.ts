import { describe, expect, it } from 'vitest'
import { createRedisCache, defaultSizeOf } from '../../scripts/caesura-redis-cache.mjs'

describe('caesura-redis-cache (KI-493)', () => {
  it('① set/get 命中与未命中：命中移到 LRU 头、miss/hit 计数与 hitRate 正确', () => {
    const c = createRedisCache()
    expect(c.get('a')).toBeUndefined()
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
    expect(c.get('a')).toBe(1)
    const s = c.stats()
    expect(s.hits).toBe(2)
    expect(s.misses).toBe(1)
    expect(s.hitRate).toBeCloseTo(2 / 3)
    expect(s.entries).toBe(1)
  })

  it('② LRU 逐出顺序：超 maxEntries 从最旧端逐出，命中刷新使其免于逐出', () => {
    const c = createRedisCache({ maxEntries: 2 })
    c.set('a', 'A')
    c.set('b', 'B')
    expect(c.get('a')).toBe('A') // a 变最新，b 变最旧
    c.set('c', 'C') // 逐出 b
    expect(c.peek('b')).toBeUndefined()
    expect(c.peek('a')).toBe('A')
    expect(c.peek('c')).toBe('C')
    expect(c.stats().evicted).toBe(1)
  })

  it('③ TTL 惰性过期：到点 get 判 miss 并计 expired', () => {
    let t = 1000
    const c = createRedisCache({ now: () => t })
    c.set('k', 'v', 100) // expireAt=1100
    t = 1050
    expect(c.get('k')).toBe('v') // 未到点
    t = 1100
    expect(c.get('k')).toBeUndefined() // 到点惰性过期
    expect(c.stats().expired).toBe(1)
    expect(c.stats().entries).toBe(0)
  })

  it('④ TTL 定期清扫 evictExpired：一次清掉全部过期项，返回清除数', () => {
    let t = 0
    const c = createRedisCache({ now: () => t })
    c.set('a', 1, 10)
    c.set('b', 2, 10)
    c.set('c', 3, 1000)
    t = 20
    expect(c.evictExpired()).toBe(2)
    expect(c.stats().entries).toBe(1)
    expect(c.peek('a')).toBeUndefined()
    expect(c.peek('c')).toBe(3)
  })

  it('⑤ 默认 TTL 构造项 + 逐条覆盖（0=永不过期）', () => {
    let t = 0
    const c = createRedisCache({ now: () => t, ttlMs: 50 })
    c.set('short', 1) // 用默认 50
    c.set('forever', 2, 0) // 覆盖为永不过期
    t = 100
    expect(c.get('short')).toBeUndefined()
    expect(c.get('forever')).toBe(2)
  })

  it('⑥ singleflight：同 key 并发 load 只跑一次 loader，全部拿同一结果', async () => {
    const c = createRedisCache()
    let runs = 0
    const loader = async () => { runs++; await new Promise((r) => setTimeout(r, 5)); return 'value' }
    const [a, b, d] = await Promise.all([c.load('k', loader), c.load('k', loader), c.load('k', loader)])
    expect(a).toBe('value')
    expect(b).toBe('value')
    expect(d).toBe('value')
    expect(runs).toBe(1) // 关键判词：合并成一次
    expect(c.get('k')).toBe('value') // 回填已写缓存
  })

  it('⑦ singleflight：loader 异步抛错不缓存、唤醒全部等待者同错、在途清空', async () => {
    const c = createRedisCache()
    let runs = 0
    const loader = async () => { runs++; throw new Error('boom') }
    const r1 = c.load('k', loader).catch((e) => e.message)
    const r2 = c.load('k', loader).catch((e) => e.message)
    expect(await r1).toBe('boom')
    expect(await r2).toBe('boom')
    expect(runs).toBe(1) // 同一次
    expect(c.stats().inflight).toBe(0) // 在途已清
    expect(c.get('k')).toBeUndefined() // 失败不缓存
  })

  it('⑧ singleflight 边界：loader **同步**抛错也不留陈旧在途 Promise（回归坑）', async () => {
    const c = createRedisCache()
    const syncThrow = () => { throw new Error('sync-boom') }
    await expect(c.load('k', syncThrow)).rejects.toThrow('sync-boom')
    expect(c.stats().inflight).toBe(0) // 若 finally 先于 set 执行会留旧拒绝 ⇒ 这里红
    // 第二次应能重新尝试，而不是拿回那枚旧的、已 rejected 的 Promise。
    let runs = 0
    const ok = await c.load('k', () => { runs++; return 'fresh' })
    expect(ok).toBe('fresh')
    expect(runs).toBe(1)
  })

  it('⑨ maxBytes 字节预算：按 sizeOf 逐出到预算内，bytes 读数随之下降', () => {
    const c = createRedisCache({ maxBytes: 100, sizeOf: (_k, v) => Number(v) })
    c.set('a', 60)
    c.set('b', 60) // 累计 120 > 100 ⇒ 逐出最旧 a
    expect(c.peek('a')).toBeUndefined()
    expect(c.peek('b')).toBe(60)
    expect(c.stats().bytes).toBe(60)
    expect(c.stats().evicted).toBe(1)
  })

  it('⑩ del/has/reset：删除计数、has 触发惰性过期、reset 清空全部状态', () => {
    let t = 0
    const c = createRedisCache({ now: () => t })
    c.set('a', 1)
    c.set('b', 2, 10)
    expect(c.del('a')).toBe(true)
    expect(c.del('a')).toBe(false)
    t = 20
    expect(c.has('b')).toBe(false) // has 也惰性过期
    c.set('c', 3)
    c.reset()
    expect(c.stats()).toMatchObject({ hits: 0, misses: 0, evicted: 0, expired: 0, bytes: 0, entries: 0 })
    expect(c.get('c')).toBeUndefined()
  })

  it('⑪ RESP 命令面：SET/GET/SETEX/TTL/DEL/INCR/EXISTS/FLUSHDB 语义', () => {
    let t = 0
    const c = createRedisCache({ now: () => t })
    expect(c.command('SET', 'k', 'v')).toBe('OK')
    expect(c.command('GET', 'k')).toBe('v')
    expect(c.command('EXISTS', 'k', 'nope')).toBe(1)
    expect(c.command('INCR', 'n')).toBe(1)
    expect(c.command('INCR', 'n')).toBe(2)
    expect(c.command('TTL', 'k')).toBe(-1) // SET 永不过期
    expect(c.command('SETEX', 's', 10, 'sv')).toBe('OK') // 10 秒
    expect(c.command('TTL', 's')).toBe(10)
    t = 11_000
    expect(c.command('TTL', 's')).toBe(-2) // 已过期
    expect(c.command('DEL', 'k')).toBe(1)
    expect(c.command('FLUSHDB')).toBe('OK')
    expect(c.stats().entries).toBe(0)
    expect(() => c.command('BOGUS')).toThrow(/unknown command/)
  })

  it('⑫ 注入 backend：command() 整条转发给真 Redis 适配器', () => {
    const calls: any[] = []
    const c = createRedisCache({
      backend: { command: (...a: any[]) => { calls.push(a); return 'BACKEND' } },
    })
    expect(c.command('GET', 'x')).toBe('BACKEND')
    expect(calls[0]).toEqual(['GET', 'x'])
    expect(c.stats().hits).toBe(0) // 走后端，不动进程内读数
  })

  it('⑬ defaultSizeOf：字符串/对象/空值都给出非负字节估', () => {
    expect(defaultSizeOf('k', 'abc')).toBeGreaterThan(0)
    expect(defaultSizeOf('k', { a: 1 })).toBeGreaterThan(0)
    expect(defaultSizeOf('k', null)).toBeGreaterThan(0) // key 本身也占
  })
})
