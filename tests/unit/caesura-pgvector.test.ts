import { describe, expect, it } from 'vitest'
import {
  PG_DEFAULTS,
  PG_SCENARIOS,
  PG_STRATEGIES,
  genBellCorpus,
  genProbeTerms,
  trigramSet,
  trgmCandidates,
  exactKnn,
  buildDirectedNsw,
  greedyNswSearch,
  createBPlusOrdered,
  createTrgmGin,
  createVectorHnsw,
  pgVectorStudy,
  pgVectorSnapshot,
  verifyPgVectorSoundness,
  verifyCausalLocks,
  createPgVectorEvidence,
} from '../../scripts/caesura-pgvector.mjs'

/** KI-562 PostgreSQL 查询引擎教学件 · 2026-11-14 */

describe('caesura-pgvector（KI-562）', () => {
  it('默认值 / 策略 / 场景 / 诚实边界', () => {
    expect(PG_STRATEGIES).toEqual(['BPlusOrdered', 'TrgmGin', 'VectorHnsw'])
    expect(PG_SCENARIOS).toEqual(['rangeScan', 'fuzzyLike', 'vectorSearch', 'cleanRerun'])
    expect(PG_DEFAULTS.seed).toBe(562)
    expect(PG_DEFAULTS.recallFloor).toBe(0.75)
  })

  it('genBellCorpus：确定性、16 维单位向量、价格落在 1280..9279', () => {
    const a = genBellCorpus({ seed: 562, docs: 32, dims: 16 })
    const b = genBellCorpus({ seed: 562, docs: 32, dims: 16 })
    expect(a).toHaveLength(32)
    expect(a[3].title).toBe(b[3].title)
    expect(a[3].price).toBe(b[3].price)
    for (const d of a) {
      const norm = Math.sqrt(d.vec.reduce((acc, x) => acc + x * x, 0))
      expect(Math.abs(norm - 1)).toBeLessThan(1e-9)
      expect(d.price).toBeGreaterThanOrEqual(1280)
      expect(d.price).toBeLessThanOrEqual(9279)
    }
  })

  it('trigramSet：两端补两空格，按 3 字符取集合', () => {
    const grams = trigramSet('鸣钟')
    expect(grams.size).toBe(3)
    expect(grams).toContain('  鸣')
    expect(grams).toContain(' 鸣钟')
    expect(grams).toContain('鸣钟 ')
    expect(trigramSet('鸣钟').size).toBe(trigramSet('鸣钟').size)
  })

  it('trgmCandidates：对 <3 字探针不承诺，对 ≥3 字真匹配必包住（超集证书）', () => {
    const corpus = genBellCorpus({ seed: 562, docs: 256, dims: 16 })
    const probes = genProbeTerms(corpus, { maxProbes: 4, minCount: 1 })
    expect(probes.length).toBeGreaterThan(0)
    for (const term of probes) {
      expect(term.length).toBeGreaterThanOrEqual(3)
      const trueMatches = corpus.filter((d) => d.title.includes(term))
      const candidates = trgmCandidates(corpus, term)
      const candIds = new Set(candidates.map((d) => d.id))
      for (const d of trueMatches) expect(candIds.has(d.id)).toBe(true)
    }
  })

  it('genProbeTerms：确定性、按 (频次降序, 字典序升序)', () => {
    const corpus = genBellCorpus({ seed: 562, docs: 256, dims: 16 })
    const a = genProbeTerms(corpus, { maxProbes: 5, minCount: 2 })
    const b = genProbeTerms(corpus, { maxProbes: 5, minCount: 2 })
    expect(a).toEqual(b)
    for (const t of a) expect(t.length).toBe(3)
  })

  it('exactKnn / buildDirectedNsw / greedyNswSearch：recall@8 ≥ 0.75（固定 seed）', () => {
    const corpus = genBellCorpus({ seed: 562, docs: 256, dims: 16 })
    const adj = buildDirectedNsw(corpus, 8)
    expect(adj).toHaveLength(256)
    let tot = 0
    for (let qi = 0; qi < 16; qi++) {
      const exact = exactKnn(corpus, qi, 8)
      expect(exact).toHaveLength(8)
      const approx = greedyNswSearch(corpus, adj, 0, qi, 8, 48)
      const ex = new Set(exact)
      tot += approx.filter((i) => ex.has(i)).length / exact.length
    }
    expect(tot / 16).toBeGreaterThanOrEqual(0.75)
  })

  it('createBPlusOrdered / createTrgmGin / createVectorHnsw：三元组互斥', () => {
    const a = createBPlusOrdered()
    const b = createTrgmGin()
    const c = createVectorHnsw()
    expect(a.trilemma()).toEqual({ orderedRangeScan: true, fuzzyPatternMatch: false, vectorSimilarity: false })
    expect(b.trilemma()).toEqual({ orderedRangeScan: false, fuzzyPatternMatch: true, vectorSimilarity: false })
    expect(c.trilemma()).toEqual({ orderedRangeScan: false, fuzzyPatternMatch: false, vectorSimilarity: true })
  })

  it('pgVectorStudy：向量 100/010/001，无 111，三场景三英雄', () => {
    const s = pgVectorStudy({ now: () => 562 })
    expect(s.vectors).toEqual({ BPlusOrdered: '100', TrgmGin: '010', VectorHnsw: '001' })
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.verdict.scenarioDistinguishes).toBe(true)
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
    const bplus = s.rows.find((r) => r.protocol === 'BPlusOrdered')!
    const trgm = s.rows.find((r) => r.protocol === 'TrgmGin')!
    const h = s.rows.find((r) => r.protocol === 'VectorHnsw')!
    expect(bplus.scenarios.find((c) => c.id === 'rangeScan')!.state).toBe('hit')
    expect(trgm.scenarios.find((c) => c.id === 'fuzzyLike')!.state).toBe('hit')
    expect(h.scenarios.find((c) => c.id === 'vectorSearch')!.state).toBe('hit')
    expect(h.metrics.vectorRecall).toBeGreaterThanOrEqual(0.75)
    // 每个策略都在它不该赢的场景输：用 B+ 跑 fuzzyLike 应当 miss
    expect(bplus.scenarios.find((c) => c.id === 'fuzzyLike')!.state).toBe('miss')
    expect(trgm.scenarios.find((c) => c.id === 'rangeScan')!.state).toBe('miss')
    expect(h.scenarios.find((c) => c.id === 'rangeScan')!.state).toBe('miss')
  })

  it('pgVectorSnapshot：形状与结构 / 无 rows 时的 safety', () => {
    const snap = pgVectorSnapshot(pgVectorStudy({ now: () => 562 }))
    expect(snap.config.docs).toBe(256)
    expect(snap.rows).toHaveLength(3)
    expect(snap.rows[0].scenarios).toHaveLength(4)
    expect(snap.causalLocks.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck.soundness.holds).toBe(true)
  })

  it('verifyPgVectorSoundness：基准 holds + 三路篡改全部 false（可证伪）', () => {
    const s = verifyPgVectorSoundness({ seed: 562 }, { seed: 562 })
    expect(s.baselineHolds).toBe(true)
    expect(s.holds).toBe(true)
    expect(s.nontrivial).toBe(true)
    expect(s.falsifiable).toBe(true)
    expect(s.tamper.forcedSeqScan.holds).toBe(false)
    expect(s.tamper.strictEquality.holds).toBe(false)
    expect(s.tamper.invertedCosine.holds).toBe(false)
    expect(s.laneA.ordered).toBe(true)
    expect(s.laneA.complete).toBe(true)
    expect(s.laneB.supersetHolds).toBe(true)
    expect(s.laneC.holds).toBe(true)
  })

  it('verifyCausalLocks：三把因果锁全部 holds', () => {
    const cl = verifyCausalLocks()
    expect(cl.bplusFanoutCausallyUnerasable).toBe(true)
    expect(cl.trgmCandidateSupersetCausallyUnerasable).toBe(true)
    expect(cl.vectorRecallFloorCausallyUnerasable).toBe(true)
    expect(cl.causalLocksAllHold).toBe(true)
    expect(cl.probes.treeSplits).toBeGreaterThan(0)
    expect(cl.probes.treeHeight).toBeLessThanOrEqual(5)
    expect(cl.probes.recall8).toBeGreaterThanOrEqual(0.75)
  })

  it('createPgVectorEvidence：21 个真实模块证据全部产出', () => {
    const ev = createPgVectorEvidence({ seed: 562 })
    expect(ev.routerMoved).toBeGreaterThan(0)
    expect(ev.routerTracked).toBeGreaterThan(0)
    expect(ev.ringNodes).toBe(4)
    expect(ev.walLines).toBe(80)
    expect(ev.walReplayed).toBe(80)
    expect(ev.notices).toBe(12)
    expect(ev.redisBitmapHits).toBe(96)
    expect(ev.poolCreated).toBeGreaterThan(0)
    expect(ev.bucketAllowed).toBe(3)
    expect(ev.bucketRejected).toBe(4)
    expect(ev.heapFired).toBe(3)
    expect(ev.heapPending).toBe(0)
    expect(ev.counterSum).toBe(2080)
    expect(ev.remapConsistentRate).toBeGreaterThanOrEqual(0)
    expect(ev.remapModuloRate).toBeGreaterThanOrEqual(0)
    expect(ev.jitterSpread).toBeGreaterThanOrEqual(0)
  })

  it('rigged：假定世界里三策略全员 111——riggedConvergenceCollapsed=true 且 noStrategyWinsAll=false', () => {
    const s = pgVectorStudy({ rigged: true, now: () => 562 })
    expect(s.rigged).toBe(true)
    expect(s.verdict.rigged).toBe(true)
    for (const p of PG_STRATEGIES) expect(s.vectors[p]).toBe('111')
    expect(s.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(false)
    // 单边放宽：只放开 orderedRangeScan，BPlus 变 111，其余保持原样
    const partial = pgVectorStudy({ freeOrderedRangeScan: true, now: () => 562 })
    expect(partial.vectors.TrgmGin).toBe('110')
    expect(partial.vectors.VectorHnsw).toBe('101')
    expect(partial.vectors.BPlusOrdered).toBe('100')
  })
})
