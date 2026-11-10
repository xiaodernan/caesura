import { describe, expect, it } from 'vitest'
import {
  HASH_DEFAULTS,
  fnv1a,
  ringHash,
  createHashRing,
  compareRemapping,
  createShardRouter,
} from '../../scripts/caesura-consistent-hash.mjs'

const KEYS = Array.from({ length: 4000 }, (_, i) => `k${i}`)
const NODES = ['a', 'b', 'c']

describe('caesura-consistent-hash (KI-499)', () => {
  it('① fnv1a / ringHash 是确定性的 32 位哈希，ringHash 对相近短串雪崩更散', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('abc')).toBeGreaterThanOrEqual(0)
    expect(fnv1a('abc')).toBeLessThan(0x100000000)
    expect(ringHash('abc')).toBe(ringHash('abc'))
    // 相近串 a#1 / a#2 的哈希高位数差：ringHash 应显著打散（不是相邻值）。
    const fnvGap = Math.abs((fnv1a('a#1') - fnv1a('a#2')) / 0x100000000)
    const ringGap = Math.abs((ringHash('a#1') - ringHash('a#2')) / 0x100000000)
    expect(ringGap).toBeGreaterThan(fnvGap)
    // 导出值是真函数（声明对账的前提）。
    expect(typeof fnv1a).toBe('function')
    expect(typeof ringHash).toBe('function')
  })

  it('② 环按虚拟节点数放点、环点有序、快照是纯数据（无函数/Map）', () => {
    const ring = createHashRing({ nodes: NODES, virtualNodes: 64 })
    const snap = ring.snapshot()
    expect(snap.nodes).toEqual(['a', 'b', 'c'])
    expect(snap.virtualNodes).toBe(64)
    expect(snap.virtualPoints).toBe(64 * 3)
    expect(snap.salt).toBe(HASH_DEFAULTS.salt)
    expect(snap.ring).toHaveLength(64 * 3)
    // 环点坐标非降序（二分查找的前提）。
    const pts = snap.ring!.map((p) => p.point)
    expect(pts).toEqual([...pts].sort((a, b) => a - b))
    expect(pts.every((p) => p >= 0 && p < 1)).toBe(true)
    expect(() => JSON.stringify(snap)).not.toThrow()
    // ring:false 省去明细（status 轮询用）。
    expect(ring.snapshot({ ring: false }).ring).toBeUndefined()
  })

  it('③ 同 key 恒落同一节点，二分比较次数对数级（非全环线性扫）', () => {
    const ring = createHashRing({ nodes: NODES, virtualNodes: 256 })
    const first = ring.lookup('player:42')
    for (let i = 0; i < 20; i++) expect(ring.lookup('player:42').nodeId).toBe(first.nodeId)
    expect(NODES).toContain(first.nodeId)
    expect(first.point).toBeGreaterThanOrEqual(0)
    expect(first.comparisons).toBeGreaterThan(0)
    expect(first.comparisons).toBeLessThan(ring.snapshot({ ring: false }).virtualPoints) // 二分 < 环点数
  })

  it('④ 增删节点：加节点只影响部分 key、移除后落点必不指向它、可 hasNode', () => {
    const ring = createHashRing({ nodes: ['a', 'b'] })
    const before = KEYS.map((k) => ring.lookup(k).nodeId)
    expect(ring.addNode('c').added).toBe(true)
    const moved = KEYS.filter((k, i) => ring.lookup(k).nodeId !== before[i]).length
    // 加第三只节点，迁移应远小于全量（一致性哈希的基本性质）。
    expect(moved / KEYS.length).toBeLessThan(0.6)
    expect(ring.hasNode('c')).toBe(true)
    expect(ring.removeNode('b').removed).toBe(true)
    expect(ring.hasNode('b')).toBe(false)
    expect(KEYS.every((k) => ring.lookup(k).nodeId !== 'b')).toBe(true)
  })

  it('⑤ 重复加/移除不存在节点诚实返回，不凭空造节点', () => {
    const ring = createHashRing({ nodes: ['a'] })
    expect(ring.addNode('a')).toEqual({ added: false, virtualPoints: HASH_DEFAULTS.virtualNodes })
    expect(ring.removeNode('ghost')).toEqual({ removed: false, virtualPoints: 0 })
    expect(ring.nodeIds()).toEqual(['a'])
    ring.reset()
    expect(ring.nodeIds()).toEqual([])
  })

  it('⑥ 空环 lookup 回 null 不编造落点，distribution([]) 不除零', () => {
    const empty = createHashRing()
    const r = empty.lookup('anything')
    expect(r.nodeId).toBe(null)
    expect(r.point).toBe(null)
    expect(r.comparisons).toBe(0)
    const d = empty.distribution([])
    expect(d.total).toBe(0)
    expect(d.unrouted).toBe(0)
    expect(d.balanceRatio).toBe(null)
    expect(() => JSON.stringify(d)).not.toThrow() // 无 NaN
  })

  it('⑦ 扩容最小重映射：一致性哈希趋理论下界 1/(N+1)，远低于取模 N/(N+1)', () => {
    const cmp = compareRemapping({ nodes: NODES, addNodes: ['d'], keys: KEYS })
    expect(cmp.delta).toBe(1)
    expect(cmp.beforeCount).toBe(3)
    expect(cmp.afterCount).toBe(4)
    expect(cmp.added).toEqual(['d'])
    expect(cmp.removed).toEqual([])
    expect(cmp.theoreticalRate).toBeCloseTo(0.25, 2)
    expect(cmp.consistent.rate).toBeGreaterThan(0.1) // 确实动了一部分
    expect(cmp.consistent.rate).toBeLessThan(0.35)   // 但接近下界 0.25
    expect(cmp.modulo.rate).toBeGreaterThan(0.4)     // 取模动约 3/4
    expect(cmp.consistent.rate).toBeLessThan(cmp.modulo.rate)
    expect(cmp.savedRate).toBeGreaterThan(0.15)
    expect(cmp.consistent.moved + (cmp.consistent.total - cmp.consistent.moved)).toBe(KEYS.length)
  })

  it('⑧ 缩容同样最小重映射，removed 如实列出、取模对照仍更高', () => {
    const cmp = compareRemapping({ nodes: NODES, removeNodes: ['c'], keys: KEYS })
    expect(cmp.delta).toBe(-1)
    expect(cmp.afterCount).toBe(2)
    expect(cmp.removed).toEqual(['c'])
    expect(cmp.added).toEqual([])
    expect(cmp.theoreticalRate).toBeCloseTo(1 / 3, 2)
    expect(cmp.consistent.rate).toBeLessThan(cmp.modulo.rate)
    expect(cmp.consistent.rate).toBeLessThan(0.45)
  })

  it('⑨ 空 keys 对照率全 0 不 NaN，纯数据可序列化', () => {
    const cmp = compareRemapping({ nodes: NODES, addNodes: ['d'], keys: [] })
    expect(cmp.keys).toBe(0)
    expect(cmp.consistent.rate).toBe(0)
    expect(cmp.modulo.rate).toBe(0)
    expect(cmp.savedRate).toBe(0)
    expect(() => JSON.stringify(cmp)).not.toThrow()
  })

  it('⑩ 加权节点按虚拟节点倍数分得更多 key（3:1 ≈ 0.75:0.25）', () => {
    const ring = createHashRing({
      nodes: ['light', 'heavy'], virtualNodes: 128,
      weightOf: (id) => id === 'heavy' ? 3 : 1,
    })
    expect(ring.snapshot({ ring: false }).weights).toEqual({ light: 1, heavy: 3 })
    const d = ring.distribution(KEYS)
    expect(d.perNode.heavy.ratio).toBeGreaterThan(0.65)
    expect(d.perNode.light.ratio).toBeLessThan(0.35)
    expect(d.emptyNodes).toEqual([])
  })

  it('⑪ 分布均匀度随虚拟节点数单调改善（8 → 128 → 512 的 balanceRatio 递减）', () => {
    const ratios = [8, 128, 512].map((vn) =>
      createHashRing({ nodes: NODES, virtualNodes: vn }).distribution(KEYS).balanceRatio!,
    )
    expect(ratios.every((r) => r !== null && Number.isFinite(r))).toBe(true)
    expect(ratios[0]).toBeGreaterThan(ratios[1])
    expect(ratios[1]).toBeGreaterThan(ratios[2])
    expect(ratios[2]).toBeLessThan(1.5) // 足量虚拟节点趋近均分
  })

  it('⑫ 弱哈希 + 少虚拟节点偏斜更大：balanceRatio 如实暴露「好哈希」为何必要', () => {
    const weak = createHashRing({ nodes: NODES, hashFn: fnv1a, virtualNodes: 8 })
    const strong = createHashRing({ nodes: NODES, hashFn: ringHash, virtualNodes: 8 })
    expect(weak.distribution(KEYS).balanceRatio!).toBeGreaterThan(strong.distribution(KEYS).balanceRatio!)
  })

  it('⑬ 缓存分片路由：同 key 恒落同分片同槽、空环 shard=null、扩节点报迁移读数', () => {
    const router = createShardRouter({ nodes: NODES, slotCount: 1024 })
    const r1 = router.route('player:7')
    expect(NODES).toContain(r1.shard)
    expect(r1.slot).toBeGreaterThanOrEqual(0)
    expect(r1.slot).toBeLessThan(1024)
    for (let i = 0; i < 10; i++) {
      const r = router.route('player:7')
      expect(r.shard).toBe(r1.shard)
      expect(r.slot).toBe(r1.slot)
    }
    for (let i = 0; i < 100; i++) router.route(`player:${i}`)
    const remap = router.remapOn(['a', 'b', 'c', 'd'])
    // player:7 前面已 route 过、这里 i=7 又命中同一个 key，trackedSet 去重 ⇒ 100 个唯一 key。
    expect(remap.total).toBe(100)
    expect(remap.moved).toBeGreaterThan(0)
    expect(remap.moved).toBeLessThan(remap.total * 0.6) // 扩容只迁移一小部分
    expect(remap.rate).toBeCloseTo(remap.moved / remap.total, 5)
    // 空环不凭空造分片，但槽仍是 key 的稳定哈希。
    const emptyRouter = createShardRouter()
    expect(emptyRouter.route('x').shard).toBe(null)
    expect(emptyRouter.route('x').slot).toBe(emptyRouter.route('x').slot)
  })

  it('⑭ 注入确定性：同 opts 两次构造读数逐字一致、注入 hashFn/selector 生效、快照可读', () => {
    const opts = { nodes: NODES, virtualNodes: 64, salt: 'custom', hashFn: (s: string) => ringHash(s, 42) }
    const a = createHashRing({ ...opts, nodes: [...NODES] })
    const b = createHashRing({ ...opts, nodes: [...NODES] })
    expect(a.distribution(KEYS)).toEqual(b.distribution(KEYS))
    expect(a.snapshot()).toEqual(b.snapshot())
    expect(a.salt).toBe('custom')
    // 注入返回 [0,1) 的 selector 也能用（同 KI-491 hashSelector 形状）。
    const sel = createHashRing({ nodes: NODES, hashFn: () => 0.5 })
    expect(NODES).toContain(sel.lookup('whatever').nodeId)
    // 注入非法哈希不产生 NaN（回退 ringHash）。
    const bad = createHashRing({ nodes: NODES, hashFn: () => Number.NaN })
    expect(NODES).toContain(bad.lookup('x').nodeId)
  })
})
