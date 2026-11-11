import { describe, expect, it } from 'vitest'
import {
  HLL_DEFAULTS,
  HLL_STRATEGIES,
  HLL_SCENARIOS,
  createExactSet,
  createHyperLogLog,
  createLinearCounting,
  streamCardinalityStudy,
  cardinalitySnapshot,
  verifySparseEstimate,
  createCardinalityEvidence,
} from '../../scripts/caesura-hyperloglog.mjs'

/**
 * KI-530 基数估计算法族诚实权衡（P8 第三十七件 · 前端第二十六维）。
 *
 * 与 KI-527/528/529 同族测试面——真件真跑、向量由 `vecOf(row.trilemma)` 现算、
 * 绝不硬覆盖、也不维护好看的表象。FNV-1a-64 + fmix64 是教学 hash，不冒充 MurmurHash64A。
 */

describe('caesura-hyperloglog（KI-530）', () => {
  // ============ 配置与名册 ============
  it('HLL_DEFAULTS / HLL_STRATEGIES / HLL_SCENARIOS 固定顺序、键名同词', () => {
    expect(HLL_STRATEGIES).toEqual(['ExactSet', 'HyperLogLog', 'LinearCounting'])
    expect(HLL_SCENARIOS).toEqual(
      ['nearExact', 'highFill', 'disjMerge', 'heavyInsertFlow', 'zipfSkew', 'sparseLowCardinality'],
    )
    expect(HLL_DEFAULTS.seed).toBe(530)
    expect(HLL_DEFAULTS.mRegisters).toBe(16384)   // Redis PFADD 同款
    expect(HLL_DEFAULTS.registerBytes).toBe(6)     // 16384 × 6 bits = 12 KB
  })

  // ============ 真实现：每门 ============
  it('ExactSet：add 同 key idempotent，cardinality = size 恒精', () => {
    const es = createExactSet({})
    for (let i = 0; i < 100; i++) es.add(`k${i % 20}`)   // 20 uniques × 5 replays
    expect(es.cardinality()).toBe(20)
    expect(es.inserts()).toBe(100)
    expect(es.merge(es)).toBe(0)
  })

  it('HyperLogLog：ε ≈ 1.04/√m（Redis PFADD）、est near true within 3%', () => {
    const hll = createHyperLogLog({ seed: 530 })
    for (let i = 0; i < 4096; i++) hll.add(`k${i}`)
    const est = hll.cardinality()
    const relErr = Math.abs(est - 4096) / 4096
    expect(relErr, `est=${est}, relErr=${relErr}`).toBeLessThan(0.03)
    expect(hll.stats().footprintBytes).toBe(12 * 1024)
    expect(hll.registerMax()).toBeGreaterThan(0)
  })

  it('LinearCounting：稀疏期小 error；26000 uniques 灌满后失真（estimatorAccuracy=false，诚实）', () => {
    const lc = createLinearCounting({ seed: 530, bits: 4096 })
    for (let i = 0; i < 64; i++) lc.add(`k${i}`)
    const few = lc.cardinality()
    expect(Math.abs(few - 64) / 64).toBeLessThan(0.15)
    const lc2 = createLinearCounting({ seed: 530, bits: 4096 })
    for (let i = 0; i < 26000; i++) lc2.add(`k${i}`)
    const many = lc2.cardinality()
    expect(Math.abs(many - 26000) / 26000).toBeGreaterThan(0.03)
  })

  it('HyperLogLog PFMERGE 只在同 precision sketch 之间 union 有效，不同 m 返回 null', () => {
    const a = createHyperLogLog({ seed: 530, mRegisters: 16384 })
    const b = createHyperLogLog({ seed: 530, mRegisters: 16384 })
    const c = createHyperLogLog({ seed: 530, mRegisters: 8192 })
    for (let i = 0; i < 100; i++) a.add(`a${i}`)
    for (let i = 0; i < 100; i++) b.add(`b${i}`)
    expect(a.merge(b), 'same m ⇒ true').toBe(true)
    expect(a.merge(c), 'different m ⇒ null').toBe(null)
  })

  it('ExactSet merge trivially valid anywhere（不同参数照并）', () => {
    const a = createExactSet({})
    const b = createExactSet({})
    for (const k of ['x', 'y', 'z']) a.add(k)
    for (const k of ['z', 'w']) b.add(k)
    expect(a.merge(b), 'z deduped').toBe(1)
    expect(a.cardinality()).toBe(4)
  })

  // ============ verifySparseEstimate ============
  it('verifySparseEstimate（nearExact stream）: holds=true nontrivial=true', () => {
    const events = Array.from({ length: 4096 }, (_, i) => `k${i}`)
    const r = verifySparseEstimate({ events, seed: 530 }, { seed: 530 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.exact).toBe(4096)
    expect(r.laneB.estimate).toBeGreaterThan(0)
    expect(r.falsifiable).toBe(true)
  })

  it('verifySparseEstimate 空事件集 ⇒ holds=false nontrivial=false（不凭 0=0 假绿）', () => {
    const r = verifySparseEstimate({ events: [], seed: 530 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
    expect(r.tamper.emptySet.holds).toBe(false)
  })

  it('verifySparseEstimate 三路篡改全部真喂回同一内核现算翻 false', () => {
    const events = Array.from({ length: 4096 }, (_, i) => `k${i}`)
    const r = verifySparseEstimate({ events, seed: 530 })
    expect(r.tamper.registerCorrupted.holds).toBe(false)
    expect(r.tamper.emptySet.holds).toBe(false)
    expect(r.tamper.bitsTooBig.holds).toBe(false)
  })

  // ============ study 矩阵 + 向量 ============
  it('streamCardinalityStudy 默认向量互异、无一 111 ⇒ noUniversalWinner distinguishing', () => {
    const s = streamCardinalityStudy({ now: () => 530000 })
    expect(s.vectors.ExactSet).toBe('101')
    expect(s.vectors.HyperLogLog).toBe('110')
    expect(s.vectors.LinearCounting).toBe('010')
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(Object.values(s.vectors).includes('111')).toBe(false)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.rigged).toBe(false)
    expect(s.builtAt).toBe(530000)
  })

  it('默认向量各自缺一维：ExactSet 内存超 O(n)、HLL mergeable 约束、LinearCounting 饱和失真', () => {
    const s = streamCardinalityStudy({})
    const es = s.rows.find((r) => r.protocol === 'ExactSet')!
    const hll = s.rows.find((r) => r.protocol === 'HyperLogLog')!
    const lc = s.rows.find((r) => r.protocol === 'LinearCounting')!
    expect(es.trilemma).toEqual({ estimatorAccuracy: true, fixedMemory: false, mergeable: true })
    expect(hll.trilemma).toEqual({ estimatorAccuracy: true, fixedMemory: true, mergeable: false })
    expect(lc.trilemma).toEqual({ estimatorAccuracy: false, fixedMemory: true, mergeable: false })
  })

  it('rigged 双开关齐开（unlimitedMemory + perfectHash）：ExactSet 反事实现算收敛 111、HLL 仍 110、LC 位图饱和因果锁死仍 010（绝不写死全策略 111）', () => {
    const s = streamCardinalityStudy({ rigged: true })
    expect(s.rigged).toBe(true)
    expect(s.vectors).toEqual({ ExactSet: '111', HyperLogLog: '110', LinearCounting: '010' })
    expect(s.verdict.noUniversalWinner).toBe(false)    // 现算出一个 111，非写死；HLL/LC 仍缺维
    expect(s.verdict.trilemmaDistinguishes).toBe(true)  // 111/110/010 三向量互异
    expect(s.verdict.linearCountingSaturates).toBe(true) // 因果锁：perfectHash 抹不掉 LC 位图饱和
    expect(s.verdict.linearCountingSaturationCausallyUnerasable).toBe(true) // 四档矩阵现算，非硬编码
  })

  it('单开 perfectHash ⇒ HLL accuracy 抹但 LC 饱和因果抹不掉；单开 unlimitedMemory ⇒ ExactSet 内存维抹；两开关各自抹得干净', () => {
    const ph = streamCardinalityStudy({ perfectHash: true })
    expect(ph.verdict.perfectHashErasesError).toBe(true)
    expect(ph.vectors.HyperLogLog).toBe('110')
    expect(ph.vectors.LinearCounting).toBe('010') // perfectHash 治不了位图饱和（因果锁）
    const um = streamCardinalityStudy({ unlimitedMemory: true })
    expect(um.verdict.unlimitedRoomErasesGrowth).toBe(true)
    expect(um.vectors.ExactSet).toBe('111')
    expect(um.vectors.LinearCounting).toBe('010')
  })

  it('row.trilemma 与 vectors 同源', () => {
    const s = streamCardinalityStudy({})
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.estimatorAccuracy)}${Number(row.trilemma.fixedMemory)}${Number(row.trilemma.mergeable)}`)
    }
  })

  // ============ snapshot ============
  it('cardinalitySnapshot: 形状 + verdict 同源', () => {
    const s = streamCardinalityStudy({ now: () => 530000 })
    const snap = cardinalitySnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.builtAt).toBe(530000)
    expect(snap.config).toEqual(s.config)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.verdict.vectors).toEqual(s.vectors)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(snap.crosscheck && snap.crosscheck.estimate).toBeDefined()
  })

  it('cardinalitySnapshot(null)/({}) → null 反守卫', () => {
    expect(cardinalitySnapshot(null as never)).toBe(null)
    expect(cardinalitySnapshot({} as never)).toBe(null)
  })

  // ============ evidence ============
  it('createCardinalityEvidence 真件 ≥ 21 键 + 核心件真回读（wal/heap/bucket/redis）', () => {
    const ev = createCardinalityEvidence({ seed: 530, now: () => 530000 }) as unknown as Record<string, number>
    const keys = Object.keys(ev).sort()
    expect(keys.length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.jitterSpread).toBeGreaterThanOrEqual(0)
  })

  // ============ 交叉校验 ============
  it('verdict.hllRestrictedPmerge=true / linearCountingSaturates=true / exactSetGrowsUnbounded=true（对应默认 110/110/010 的硬事实）', () => {
    const s = streamCardinalityStudy({})
    expect(s.verdict.hllRestrictedPmerge).toBe(true)
    expect(s.verdict.linearCountingSaturates).toBe(true)
    expect(s.verdict.exactSetGrowsUnbounded).toBe(true)
    expect(s.verdict.exactSetAccurate).toBe(true)
    expect(s.verdict.hllFixed12k).toBe(true)
  })

  it('六场景都能跑且每个 cell 的考场三布尔/考场标记齐备', () => {
    const s = streamCardinalityStudy({})
    for (const row of s.rows) {
      expect(row.scenarios.length).toBe(HLL_SCENARIOS.length + 1) // 六场景 + merge-exam
      for (const cell of row.scenarios) {
        expect(typeof cell.estimatorAccuracy).toBe('boolean')
        expect(typeof cell.fixedMemory).toBe('boolean')
        expect(typeof cell.mergeable).toBe('boolean')
      }
    }
  })
})
