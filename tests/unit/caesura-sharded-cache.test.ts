import { describe, expect, it } from 'vitest'
import {
  SHARD_DEFAULTS,
  createShardedCache,
  compareHitRetention,
} from '../../scripts/caesura-sharded-cache.mjs'

const SHARDS = ['a', 'b', 'c']
const KEYS = Array.from({ length: 4000 }, (_, i) => `k${i}`)

describe('caesura-sharded-cache (KI-500)', () => {
  it('① 导出教学缺省值、按环分片、同 key 恒落同片', () => {
    expect(SHARD_DEFAULTS.virtualNodes).toBeGreaterThan(0)
    expect(SHARD_DEFAULTS.defaultShards.length).toBeGreaterThan(0)
    const c = createShardedCache({ shards: SHARDS })
    expect(c.shards).toEqual(SHARDS)
    expect(SHARDS).toContain(c.shardOf('player:42'))
    for (let i = 0; i < 20; i++) expect(c.shardOf('player:42')).toBe(c.shardOf('player:42'))
  })

  it('② 每片挂真 Redis 风格缓存：set/get/has/del 落同一片、stats 逐片可读', () => {
    const c = createShardedCache({ shards: SHARDS })
    expect(c.set('x', 1)).toBe(true)
    expect(c.get('x')).toBe(1)
    expect(c.has('x')).toBe(true)
    expect(c.peek('x')).toBe(1)
    expect(c.del('x')).toBe(true)
    expect(c.get('x')).toBeUndefined() // miss 不编造
    expect(c.has('x')).toBe(false)
    const st = c.stats()
    expect(st.shards).toBe(3)
    expect(Object.keys(st.perShard).sort()).toEqual(['a', 'b', 'c'])
    expect(st.hits).toBeGreaterThan(0)
    expect(st.misses).toBeGreaterThan(0)
    expect(st.hitRate).toBeCloseTo(st.hits / (st.hits + st.misses), 6)
  })

  it('③ 预热批量 key：entries 正好等于 key 数、各片分布接近、命中真判词', () => {
    const c = createShardedCache({ shards: SHARDS, cacheOpts: { maxEntries: KEYS.length } })
    for (const k of KEYS) c.set(k, k)
    const st = c.stats()
    expect(st.entries).toBe(KEYS.length) // LRU 上限够大 ⇒ 全部驻留
    const shares = Object.values(st.perShard).map((s) => s.entries)
    expect(Math.min(...shares)).toBeGreaterThan(0)
    expect(Math.max(...shares) / Math.min(...shares)).toBeLessThan(2) // 虚拟节点铺得较均
    expect(c.get(KEYS[7])).toBe(KEYS[7])
    expect(c.stats().hits).toBe(1) // get 之后重取 stats：只有这一次命中
  })

  it('④ load 片内 singleflight：同 key 并发回填只调 loader 一次、结果一致', async () => {
    const c = createShardedCache({ shards: SHARDS })
    let calls = 0
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      c.load('hot', async () => { calls++; return 42 })))
    expect(calls).toBe(1)
    expect(results.every((x) => x === 42)).toBe(true)
    // 再次 load 直接命中缓存，不再调 loader。
    expect(await c.load('hot', async () => { calls++; return 0 })).toBe(42)
    expect(calls).toBe(1)
  })

  it('⑤ 注入 now 透传进每片缓存：TTL 惰性过期确定性生效（非真 Date.now）', () => {
    let t = 1000
    const c = createShardedCache({ shards: SHARDS, cacheOpts: { maxEntries: 100, ttlMs: 10 }, now: () => t })
    c.set('ttl', 'v')
    expect(c.get('ttl')).toBe('v')  // @1000 命中
    t = 1005
    expect(c.get('ttl')).toBe('v')  // @1005 仍新鲜
    t = 1011
    expect(c.get('ttl')).toBeUndefined() // @1011 过期，不编造
    expect(c.stats().expired).toBe(1)
  })

  it('⑥ 自定义 cacheFactory 每片建一只、按 shardId 区分（窑口注入）', () => {
    const ids: string[] = []
    const c = createShardedCache({
      shards: SHARDS,
      cacheFactory: (id) => {
        ids.push(id)
        const m = new Map()
        return {
          get: (k: string) => m.get(k), set: (k: string, v: any) => { m.set(k, v) },
          del: (k: string) => m.delete(k), has: (k: string) => m.has(k),
          load: async (k: string, l: any) => m.get(k) ?? l(),
          stats: () => ({ hits: 0, misses: 0, entries: m.size, hitRate: 0 }),
          reset: () => m.clear(),
        }
      },
    })
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
    c.set('z', 9)
    expect(c.get('z')).toBe(9)
    expect(c.stats().entries).toBe(1)
  })

  it('⑦ remapOn 扩容：只计落点未变条目为保留、换片为失效，added/removed 如实', () => {
    const c = createShardedCache({ shards: SHARDS, cacheOpts: { maxEntries: KEYS.length } })
    for (const k of KEYS) c.set(k, k)
    const rm = c.remapOn([...SHARDS, 'd'], KEYS)
    expect(rm.total).toBe(KEYS.length)
    expect(rm.retentionRate).toBeCloseTo(rm.retained / rm.total, 6)
    expect(c.stats().invalidation).toMatchObject({ remaps: 1, added: ['d'], removed: [] })
    // 不真搬数据：remap 只做记账，stats 的 entries 是保留片原样（不新增/搬迁）。
    expect(c.shards).toEqual([...SHARDS, 'd'])
    expect(c.shardOf(KEYS[0])).toBe(SHARDS.concat('d').includes(c.shardOf(KEYS[0])!) ? c.shardOf(KEYS[0]) : null)
  })

  it('⑧ remapOn 缩容：移除片的缓存被丢弃、removed 记账、落点不变的仍可读', () => {
    const c = createShardedCache({ shards: SHARDS, cacheOpts: { maxEntries: KEYS.length } })
    for (const k of KEYS) c.set(k, k)
    const before = new Map(KEYS.map((k) => [k, c.shardOf(k)])) // 缩容前落点
    const rm = c.remapOn(['a', 'b'], KEYS)
    expect(c.shards).toEqual(['a', 'b'])
    expect(c.stats().invalidation.removed).toEqual(['c'])
    expect(c.stats().invalidation.added).toEqual([])
    expect(rm.retained + rm.invalidated).toBe(KEYS.length)
    // 落点缩容前后都没变（仍在 a/b）的 key ⇒ 缓存未失效、仍可读。
    const retained = KEYS.find((k) => before.get(k) === c.shardOf(k) && c.shardOf(k) !== 'c')!
    expect(c.get(retained)).toBe(retained)
    // 缩容前落 c（被删片）的 key ⇒ 缓存已丢、不搬数据 ⇒ undefined。
    const dropped = KEYS.find((k) => before.get(k) === 'c')!
    expect(c.get(dropped)).toBeUndefined()
  })

  it('⑨ 扩缩容命中率保留率：一致性哈希趋 N/(N+1)，取模明显更差', () => {
    const grow = compareHitRetention({ shards: SHARDS, nextShards: [...SHARDS, 'd'], keys: KEYS })
    expect(grow.consistent.delta).toBe(1)
    expect(grow.theoreticalConsistent).toBeCloseTo(0.75, 3) // N/(N+1)=3/4
    expect(grow.consistent.retentionRate).toBeGreaterThan(0.65)
    expect(grow.consistent.retentionRate).toBeLessThan(0.85) // 趋 0.75、不粉饰零失效
    expect(grow.modulo.retentionRate).toBeLessThan(0.6)
    expect(grow.consistent.retentionRate).toBeGreaterThan(grow.modulo.retentionRate)
    expect(grow.savedRate).toBeGreaterThan(0.1)
    expect(grow.consistent.retained + grow.consistent.moved).toBe(KEYS.length)
  })

  it('⑩ 缩容保留率同样一致性哈希更优，并与 remapOn 真缓存读数互为镜像', () => {
    const shrink = compareHitRetention({ shards: SHARDS, nextShards: SHARDS.slice(0, 2), keys: KEYS })
    expect(shrink.consistent.delta).toBe(-1)
    expect(shrink.theoreticalConsistent).toBeCloseTo(2 / 3, 3)
    expect(shrink.consistent.retentionRate).toBeGreaterThan(shrink.modulo.retentionRate)
    // 镜像：compareHitRetention 的扩容保留率 == 真缓存 remapOn 的保留率（同一致性哈希环/同 key 集）。
    const grow = compareHitRetention({ shards: SHARDS, nextShards: [...SHARDS, 'd'], keys: KEYS })
    const c = createShardedCache({ shards: SHARDS })
    const rm = c.remapOn([...SHARDS, 'd'], KEYS)
    expect(rm.retentionRate).toBeCloseTo(grow.consistent.retentionRate, 6)
  })

  it('⑪ 快照纯数据、逐片 stats + 失效账本可读、可序列化', () => {
    const c = createShardedCache({ shards: SHARDS, cacheOpts: { maxEntries: 100 } })
    c.set('a', 1)
    c.remapOn([...SHARDS, 'd'], ['a'])
    const snap = c.snapshot()
    expect(snap.shards).toEqual([...SHARDS, 'd'].sort())
    expect(snap.salt).toBe(SHARD_DEFAULTS.salt)
    expect(snap.ring?.nodes).toEqual([...SHARDS, 'd'].sort())
    expect(snap.invalidation.remaps).toBe(1)
    expect(Object.keys(snap.perShard).length).toBe(4)
    expect(() => JSON.stringify(snap)).not.toThrow()
    expect(() => JSON.stringify(c.stats())).not.toThrow()
    // ring:true 带环点明细。
    expect(Array.isArray(c.snapshot({ ring: true }).ringPoints)).toBe(true)
  })

  it('⑫ 诚实降级：空 key 集保留率 0 不 NaN、空环不造片、reset 清账本', () => {
    const empty = compareHitRetention({ shards: SHARDS, nextShards: [...SHARDS, 'd'], keys: [] })
    expect(empty.consistent.retentionRate).toBe(0)
    expect(empty.modulo.retentionRate).toBe(0)
    expect(empty.savedRate).toBe(0)
    expect(() => JSON.stringify(empty)).not.toThrow()
    const c = createShardedCache({ shards: SHARDS, cacheOpts: { maxEntries: 100 } })
    c.set('x', 1)
    c.reset()
    expect(c.stats().entries).toBe(0)
    expect(c.stats().invalidation.remaps).toBe(0)
    // 空分片集缺省回退到教学缺省三片（不凭空回 null）。
    expect(createShardedCache({ shards: [] }).shards).toEqual(SHARD_DEFAULTS.defaultShards)
  })

  it('⑬ 注入确定性：同 opts 两次构造读数逐字一致、注入 hashFn/salt/ring 生效', async () => {
    const opts = { shards: SHARDS, virtualNodes: 64, salt: 'custom', hashFn: (s: string) => s.length * 12345 }
    const a = createShardedCache({ ...opts, shards: [...SHARDS] })
    const b = createShardedCache({ ...opts, shards: [...SHARDS] })
    const keys = KEYS.slice(0, 500)
    for (const k of keys) { a.set(k, k); b.set(k, k) }
    expect(a.snapshot()).toEqual(b.snapshot())
    expect(a.stats().perShard).toEqual(b.stats().perShard)
    expect(a.salt).toBe('custom')
    // 注入现成 ring（窑口注入）也能装配。
    const { createHashRing } = await import('../../scripts/caesura-consistent-hash.mjs')
    const ring = createHashRing({ nodes: SHARDS })
    const injected = createShardedCache({ ring })
    expect(SHARDS).toContain(injected.shardOf('anything'))
    // compareHitRetention 注入同样确定。
    expect(compareHitRetention({ ...opts, shards: [...SHARDS], nextShards: [...SHARDS, 'd'], keys }))
      .toEqual(compareHitRetention({ ...opts, shards: [...SHARDS], nextShards: [...SHARDS, 'd'], keys }))
  })
})
