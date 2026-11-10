import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CACHE_LINE_BYTES,
  createObjectPool,
  allocationStudy,
  createCacheLinePadder,
  createPackedCounters,
  createLruLineCache,
  compareLayouts,
} from '../../scripts/caesura-hw-perf.mjs'

describe('caesura-hw-perf (KI-497)', () => {
  // ——— ① 对象池 ———
  it('① 对象池：n 次取-还循环只 new 一次、其余全复用（分配次数证据）', () => {
    let made = 0
    const pool = createObjectPool({ factory: () => ({ made: ++made, x: 0 }), reset: (o) => { o.x = 0 } })
    for (let i = 0; i < 1000; i++) {
      const o = pool.acquire()
      o.x = i
      pool.release(o)
    }
    const s = pool.stats()
    expect(made).toBe(1)
    expect(s.created).toBe(1)
    expect(s.reused).toBe(999)
    expect(s.acquired).toBe(1000)
    expect(s.released).toBe(1000)
    expect(s.reuseRate).toBeCloseTo(0.999, 6)
    expect(s.idle).toBe(1) // 冷启动那只被复用并留在池里
  })

  it('② 对象池：release 调 reset 复位对象、inUse/idle 计数正确', () => {
    const pool = createObjectPool({ factory: () => ({ x: 0, y: 0 }), reset: (o) => { o.x = 0; o.y = 0 } })
    const a = pool.acquire(); a.x = 42; a.y = 9
    expect(pool.stats().inUse).toBe(1)
    expect(pool.release(a)).toBe(true)
    expect(a.x).toBe(0); expect(a.y).toBe(0) // reset 真跑
    expect(pool.stats().inUse).toBe(0)
    expect(pool.stats().idle).toBe(1)
  })

  it('③ 对象池：maxSize 限额下 release 丢弃超额对象并计 dropped、peakIdle 有界', () => {
    const pool = createObjectPool({ factory: () => ({}), maxSize: 2 })
    const held = Array.from({ length: 5 }, () => pool.acquire())
    for (const o of held) pool.release(o)
    const s = pool.stats()
    expect(s.created).toBe(5) // 同时持有 5 只、各 new 一次
    expect(s.dropped).toBe(3) // 只留 2 只驻留
    expect(s.idle).toBe(2)
    expect(s.peakIdle).toBe(2)
    expect(s.inUse).toBe(0)
  })

  it('④ 对象池：reset() 清空空闲栈、reuseRate 零请求为 0、release(null) 安全', () => {
    const pool = createObjectPool({ factory: () => ({}) })
    expect(pool.stats().reuseRate).toBe(0)
    expect(pool.release(null)).toBe(false)
    pool.release(pool.acquire())
    expect(pool.stats().idle).toBe(1)
    expect(pool.reset()).toBe(1)
    expect(pool.stats().idle).toBe(0)
  })

  it('⑤ allocationStudy：用池 vs 直接 new 的分配对照，saved=accesses−1', () => {
    const r = allocationStudy({ accesses: 10000, maxSize: 64, factory: () => ({}), reset: () => {} })
    expect(r.accesses).toBe(10000)
    expect(r.naiveCreated).toBe(10000)
    expect(r.poolCreated).toBe(1)
    expect(r.saved).toBe(9999)
    expect(r.reused).toBe(9999)
    expect(r.reuseRate).toBeCloseTo(0.9999, 6)
    expect(r.peakIdle).toBe(1)
  })

  // ——— ② cache line / false sharing ———
  it('⑥ padding：相邻计数器各占一整 cache line、falseSharingPairs=0', () => {
    const p = createCacheLinePadder(8) // 缺省 64B
    expect(DEFAULT_CACHE_LINE_BYTES).toBe(64)
    const s = p.stats()
    expect(s.padded).toBe(true)
    expect(s.elementsPerLine).toBe(8) // 64B / 8B
    expect(s.falseSharingPairs).toBe(0)
    expect(s.distinctLines).toBe(8)
    expect(s.startIndices).toEqual([0, 8, 16, 24, 32, 40, 48, 56])
    expect(p.sharesLine(0, 1)).toBe(false)
    expect(p.lineOf(0)).toBe(0)
    expect(p.lineOf(1)).toBe(1)
  })

  it('⑦ packed（对照）：相邻计数器共享行、falseSharingPairs>0', () => {
    const p = createPackedCounters(8)
    const s = p.stats()
    expect(s.padded).toBe(false)
    expect(s.falseSharingPairs).toBe(7) // 8 槽紧凑、相邻 7 对
    expect(s.distinctLines).toBe(1) // 都在同一 64B 行
    expect(p.sharesLine(0, 1)).toBe(true)
  })

  it('⑧ padding 用空间换隔离：spanBytes 与 paddingOverhead 诚实放大', () => {
    const padded = createCacheLinePadder(8).stats()
    const packed = createPackedCounters(8).stats()
    expect(padded.spanBytes).toBe(512) // 8 槽 * 64B
    expect(packed.spanBytes).toBe(64) // 8 槽 * 8B
    expect(padded.spanBytes / packed.spanBytes).toBeCloseTo(8, 6)
    expect(packed.paddingOverhead).toBe(1)
    expect(padded.paddingOverhead).toBeCloseTo(8, 6)
  })

  it('⑨ cacheLineBytes 可注入：32B 行 ⇒ 每 4 元素一行，隔离/共享判词随阈值变', () => {
    const padded = createCacheLinePadder(6, { cacheLineBytes: 32 }).stats()
    const packed = createPackedCounters(6, { cacheLineBytes: 32 }).stats()
    expect(padded.elementsPerLine).toBe(4)
    expect(padded.falseSharingPairs).toBe(0)
    expect(padded.distinctLines).toBe(6)
    expect(packed.falseSharingPairs).toBe(4) // 6 槽 / 每行 4 ⇒ 4 对相邻同行
    expect(packed.distinctLines).toBe(2)
  })

  it('⑩ 计数器 inc/get 独立不串扰（padded 各占独立 backing 位）', () => {
    const p = createCacheLinePadder(4)
    p.inc(0, 3); p.inc(0, 2)
    p.inc(1, 7)
    expect(p.get(0)).toBe(5)
    expect(p.get(1)).toBe(7)
    expect(p.get(2)).toBe(0)
  })

  // ——— ③ LRU 行缓存模型 ———
  it('⑪ LRU 容量 2 行经典序列：访问 0,64,128,64 ⇒ miss,miss,miss,hit', () => {
    const c = createLruLineCache({ cacheBytes: 128, lineBytes: 64 }) // 容量 2 行
    expect(c.capacityLines).toBe(2)
    const hits = [0, 64, 128, 64].map((a) => c.access(a).hit)
    expect(hits).toEqual([false, false, false, true])
    const s = c.stats()
    expect(s.misses).toBe(3)
    expect(s.hits).toBe(1)
    expect(s.evictions).toBe(1) // 访问 line2 逐出 line0
    expect(s.hitRate).toBeCloseTo(0.25, 6)
    expect(s.residentLines).toBe(2)
  })

  it('⑫ LRU：命中移到 MRU、不逐出；超容量逐最旧；reset 清零', () => {
    const c = createLruLineCache({ cacheBytes: 2 * 64, lineBytes: 64 })
    c.access(0); c.access(64) // line0,line1
    c.access(0) // 命中 line0 ⇒ 移到 MRU，line1 变最旧
    const r = c.access(128) // 载入 line2 ⇒ 应逐出最旧 line1
    expect(r.evicted).toBe(1)
    // 此刻缓存里是 line0(刚访问过更旧? 不)与 line2 —— 先验 line0 仍在（不再插入新 miss 污染）。
    expect(c.access(0).hit).toBe(true) // line0 命中（且移到 MRU）
    expect(c.access(64).hit).toBe(false) // line1 已被逐，重新访问是 miss
    c.reset()
    expect(c.stats()).toMatchObject({ accesses: 0, hits: 0, misses: 0, evictions: 0 })
  })

  it('⑬ accessRange：一段字节跨多行时逐行计入 missed', () => {
    const c = createLruLineCache({ cacheBytes: 512, lineBytes: 64 })
    const r = c.accessRange(60, 8) // 覆盖 [60,68) ⇒ line0 与 line1
    expect(r.firstLine).toBe(0)
    expect(r.lastLine).toBe(1)
    expect(r.lines).toBe(2)
    expect(r.missed).toBe(2)
    expect(c.stats().misses).toBe(2)
  })

  // ——— ④ AoS vs SoA ———
  it('⑭ 顺序扫单字段：SoA miss 显著少于 AoS、speedup>1（局部性证据）', () => {
    const r = compareLayouts({ count: 10000, stride: 1 })
    expect(r.aos.misses).toBeGreaterThan(r.soa.misses)
    expect(r.speedup).toBeGreaterThan(1)
    expect(r.speedup).toBeCloseTo(4, 1) // structBytes=32 ⇒ 每 64B 行 AoS 2 字段 / SoA 8 字段
    expect(r.model.structBytes).toBe(32)
    expect(r.model.lineBytes).toBe(64)
    expect(r.indices).toBe(10000)
  })

  it('⑮ 跳跃扫退化：stride 调大时 AoS/SoA miss 逼近访问数、红利消失', () => {
    const seq = compareLayouts({ count: 1000, stride: 1 })
    const jump = compareLayouts({ count: 1000, stride: 64 })
    expect(seq.speedup).toBeGreaterThan(1)
    expect(jump.speedup).toBeCloseTo(1, 6) // 每次访问都落不同行 ⇒ 无局部性差
    expect(jump.aos.misses).toBe(jump.soa.misses)
    expect(jump.aos.misses).toBe(jump.indices) // 全 miss
  })

  it('⑯ 数据布局参数可注入：structBytes 越大 AoS 越吃亏、fieldOffset 影响跨行', () => {
    const small = compareLayouts({ count: 2000, structBytes: 8, stride: 1 })
    const large = compareLayouts({ count: 2000, structBytes: 64, stride: 1 })
    expect(large.aos.misses).toBeGreaterThan(small.aos.misses)
    expect(large.speedup).toBeGreaterThan(small.speedup)
    // 字段跨行：fieldOffset=60、fieldBytes=8 ⇒ 每元素字段跨 2 行。
    const crossing = compareLayouts({ count: 100, structBytes: 64, fieldOffset: 60, fieldBytes: 8, stride: 1 })
    expect(crossing.aos.touchedLines).toBe(200) // 100 元素 * 每字段 2 行
  })
})
