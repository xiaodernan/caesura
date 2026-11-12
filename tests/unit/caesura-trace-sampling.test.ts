import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  TRACE_DEFAULTS,
  TRACE_STRATEGIES,
  TRACE_SCENARIOS,
  TRACE_DIMS,
  createHeadBasedSampler,
  createTailBasedSampler,
  createAdaptiveSampler,
  createSampler,
  traceStreamOf,
  traceSamplingStudy,
  traceSamplingSnapshot,
  verifySamplingSoundness,
  verifyCausalLocks,
  createTraceSamplingEvidence,
} from '../../scripts/caesura-trace-sampling.mjs'

/**
 * KI-533 可观测性分布式追踪采样三策略诚实权衡（P8 第四十件 · 前端第二十七维）。
 * 与 KI-525..532 同族测试面——三真件真跑、向量由 vecOf(row.trilemma) 现算、三路篡改真喂回同一内核、绝不写死。
 */
const ROOT = resolve(process.cwd())
const vecOf = (t: { lowOverhead: boolean; anomalyCapture: boolean; loadAdaptive: boolean }) =>
  `${Number(t.lowOverhead)}${Number(t.anomalyCapture)}${Number(t.loadAdaptive)}`

describe('caesura-trace-sampling（KI-533）', () => {
  // ============ 配置与名册（1）============
  it('① TRACE_DEFAULTS / 三策略 / 六场景 / 三维名册固定顺序', () => {
    expect(TRACE_STRATEGIES).toEqual(['HeadBasedSampler', 'TailBasedSampler', 'AdaptiveSampler'])
    expect(TRACE_SCENARIOS).toEqual(['steadyLoad', 'errorBurst', 'spikeLoad', 'bufferPressure', 'coldStart', 'cleanRerun'])
    expect(TRACE_DIMS).toEqual(['lowOverhead', 'anomalyCapture', 'loadAdaptive'])
    expect(TRACE_DEFAULTS.seed).toBe(533)
    expect(TRACE_DEFAULTS.rate).toBe(0.5)
    expect(TRACE_DEFAULTS.maxRate).toBe(0.75)
  })

  // ============ 三真采样实现（7）============
  it('② HeadBasedSampler：root 即哈希决策、零缓冲、error trace 被盲丢', () => {
    const h = createHeadBasedSampler({ seed: 533, rate: 0.5 })
    const r = h.run(traceStreamOf('errorBurst', { seed: 533, items: 64 }))
    expect(r.stats.peakBufferedSpans).toBe(0)
    expect(r.stats.rateChanges).toBe(0)
    expect(r.stats.errorTracesTotal).toBeGreaterThan(0)
    expect(r.stats.errorTracesRetained).toBeLessThan(r.stats.errorTracesTotal) // 盲丢
    expect(r.kept.length + r.dropped.length).toBe(r.stats.tracesTotal)
    expect(h.oracleHead!()).toBe(false)
  })

  it('③ HeadBasedSampler：oracleHead（rigged）⇒ error trace 全留、低开销仍真', () => {
    const h = createHeadBasedSampler({ seed: 533, rate: 0.5, oracleHead: true })
    const r = h.run(traceStreamOf('errorBurst', { seed: 533, items: 64 }))
    expect(r.stats.errorTracesRetained).toBe(r.stats.errorTracesTotal)
    expect(r.stats.peakBufferedSpans).toBe(0)
    expect(h.oracleHead!()).toBe(true)
  })

  it('④ TailBasedSampler：缓冲整条、error 必留、peakBufferedSpans>0', () => {
    const t = createTailBasedSampler({ seed: 533, rate: 0.5 })
    const r = t.run(traceStreamOf('errorBurst', { seed: 533, items: 64 }))
    expect(r.stats.peakBufferedSpans).toBeGreaterThan(0)
    expect(r.stats.errorTracesRetained).toBe(r.stats.errorTracesTotal) // 确定性保异常
    expect(r.stats.spansIn).toBe(r.stats.spansKept + r.stats.spansDropped) // 缓冲守恒
  })

  it('⑤ TailBasedSampler：infiniteBuffer（rigged）⇒ peakBufferedSpans 观测量记 0（缓冲免费）但行为不变', () => {
    const t = createTailBasedSampler({ seed: 533, rate: 0.5, infiniteBuffer: true })
    const r = t.run(traceStreamOf('bufferPressure', { seed: 533, items: 64 }))
    expect(r.stats.peakBufferedSpans).toBe(0)
    expect(r.stats.errorTracesRetained).toBe(r.stats.errorTracesTotal)
    expect(r.stats.spansIn).toBe(r.stats.spansKept + r.stats.spansDropped)
    expect(t.infiniteBuffer!()).toBe(true)
  })

  it('⑥ AdaptiveSampler：突发真调率、零缓冲、但不读单条 error ⇒ 仍盲丢', () => {
    const a = createAdaptiveSampler({ seed: 533, rate: 0.5, windowSize: 16 })
    const r = a.run(traceStreamOf('spikeLoad', { seed: 533, items: 64 }))
    expect(r.stats.peakBufferedSpans).toBe(0)
    expect(r.stats.rateChanges).toBeGreaterThan(0)
    expect(r.stats.rate).toBeGreaterThanOrEqual(0.25)
    expect(r.stats.rate).toBeLessThanOrEqual(0.75)
    const burst = createAdaptiveSampler({ seed: 533, rate: 0.5, windowSize: 16 }).run(traceStreamOf('errorBurst', { seed: 533, items: 64 }))
    expect(burst.stats.errorTracesRetained).toBeLessThan(burst.stats.errorTracesTotal) // 头部仍盲
  })

  it('⑦ AdaptiveSampler：perfectFeedback 只降 errorBurst 丢失质量、不归零（maxRate 封顶）', () => {
    const base = createAdaptiveSampler({ seed: 533, rate: 0.5, windowSize: 16 }).run(traceStreamOf('errorBurst', { seed: 533, items: 64 })).stats
    const feed = createAdaptiveSampler({ seed: 533, rate: 0.5, windowSize: 16, perfectFeedback: true }).run(traceStreamOf('errorBurst', { seed: 533, items: 64 })).stats
    expect(feed.errorTracesTotal - feed.errorTracesRetained).toBeLessThan(base.errorTracesTotal - base.errorTracesRetained)
    expect(feed.errorTracesRetained).toBeLessThan(feed.errorTracesTotal) // 绝不补到全留
    expect(feed.rate).toBeLessThanOrEqual(0.75)
  })

  it('⑧ createSampler 协议分派 + 非法协议真拒', () => {
    expect(createSampler('HeadBasedSampler', { seed: 1 }).protocol).toBe('HeadBasedSampler')
    expect(createSampler('TailBasedSampler', { seed: 1 }).protocol).toBe('TailBasedSampler')
    expect(createSampler('AdaptiveSampler', { seed: 1 }).protocol).toBe('AdaptiveSampler')
    expect(() => createSampler('Bogus')).toThrow()
  })

  // ============ 六场景 trace 流（2）============
  it('⑨ traceStreamOf：六场景规模/负载/含 error 分布确定性', () => {
    expect(traceStreamOf('steadyLoad', { items: 64 }).length).toBe(64)
    expect(traceStreamOf('spikeLoad', { items: 64 }).length).toBe(192) // ×3
    expect(traceStreamOf('bufferPressure', { items: 64 }).length).toBe(64)
    expect(traceStreamOf('bufferPressure', { items: 64 })[0].spans.length).toBeGreaterThanOrEqual(12) // 大 trace
    expect(traceStreamOf('spikeLoad', { items: 64 })[0].loadFactor).toBe(2.6)
    expect(traceStreamOf('errorBurst', { items: 64 }).filter((t) => t.hasError).length).toBeGreaterThan(0)
    expect(traceStreamOf('steadyLoad', { items: 64 }).filter((t) => t.hasError).length).toBeGreaterThan(0)
  })

  it('⑩ traceStreamOf：同 seed 同流、cleanRerun 幂等、不同 seed 不同 span 指纹（注入生效）', () => {
    const a = traceStreamOf('errorBurst', { seed: 7, items: 64 })
    const b = traceStreamOf('errorBurst', { seed: 7, items: 64 })
    const c = traceStreamOf('errorBurst', { seed: 9, items: 64 })
    expect(a).toEqual(b)
    expect(a[0].spans[0].durationMs).not.toBe(c[0].spans[0].durationMs)
    expect(traceStreamOf('cleanRerun', { seed: 7, items: 64 })).toEqual(traceStreamOf('cleanRerun', { seed: 7, items: 64 }))
    expect(traceStreamOf('steadyLoad', { items: 128 }).length).toBe(128)
  })

  // ============ verifySamplingSoundness 双路 + 三路真喂回（4）============
  it('⑪ verifySamplingSoundness：holds/baselineHolds/nontrivial/falsifiable 全真、双路观测量自洽', () => {
    const r = verifySamplingSoundness({ traces: traceStreamOf('errorBurst', { seed: 533, items: 48 }), seed: 533, rate: 0.5 })
    expect(r.holds).toBe(true)
    expect(r.baselineHolds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.laneA.baselineSpansIn).toBe(r.laneA.baselineSpansKept + r.laneA.baselineSpansDropped)
    expect(r.laneB.errorTracesRetained).toBe(r.laneB.errorTracesTotal)
    expect(r.invariants).toEqual({
      laneAOk: true, errorAllRetained: true, noDuplicateSpans: true, spansIntact: true, normalByRate: true,
    })
  })

  it('⑫ verifySamplingSoundness 空 traces ⇒ holds=false nontrivial=false（绝不 0=0 假绿）', () => {
    const r = verifySamplingSoundness({ traces: [], seed: 533, rate: 0.5 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
    expect(r.tamper.emptyTraceSet.holds).toBe(false)
    expect(r.tamper.emptyTraceSet.nontrivial).toBe(false)
  })

  it('⑬ verifySamplingSoundness 三路篡改真喂回同一内核现算翻 false（非写死）', () => {
    const traces = traceStreamOf('errorBurst', { seed: 533, items: 48 })
    const r = verifySamplingSoundness({ traces, seed: 533, rate: 0.5 })
    expect(r.baselineHolds).toBe(true)
    // forgedErrorSpan：漏判哈希最大 error ⇒ 被哈希丢 ⇒ errorAllRetained 翻 false
    expect(r.tamper.forgedErrorSpan.holds).toBe(false)
    expect(r.tamper.forgedErrorSpan.invariants.errorAllRetained).toBe(false)
    // duplicateRelease：重复释放 ⇒ noDuplicateSpans 翻 false
    expect(r.tamper.duplicateRelease.holds).toBe(false)
    expect(r.tamper.duplicateRelease.invariants.noDuplicateSpans).toBe(false)
    // emptyTraceSet：nontrivial 翻 false
    expect(r.tamper.emptyTraceSet.holds).toBe(false)
  })

  it('⑭ verifySamplingSoundness 篡改只翻对应不变量、换规模/seed 仍真撞合', () => {
    const traces = traceStreamOf('errorBurst', { seed: 533, items: 48 })
    const base = verifySamplingSoundness({ traces, seed: 533, rate: 0.5 })
    const tuned = verifySamplingSoundness({ traces: traceStreamOf('errorBurst', { seed: 7, items: 64 }), seed: 7, rate: 0.4 })
    expect(base.holds).toBe(true)
    expect(tuned.holds).toBe(true) // 换规模/seed 仍真撞合
    expect(base.tamper.duplicateRelease.invariants.errorAllRetained).toBe(true) // dup 只破去重、不破保异常
    expect(base.tamper.forgedErrorSpan.invariants.noDuplicateSpans).toBe(true) // forged 只破保异常、不破去重
  })

  // ============ verifyCausalLocks 三条因果锁（3）============
  it('⑮ 三因果锁真跑现算 allHold=true（异常需缓冲 / 头部盲 / 自适应滞后）', () => {
    const locks = verifyCausalLocks({ seed: 533, items: 64, rate: 0.5 })
    expect(locks.anomalyRequiresBufferingCausallyUnerasable).toBe(true)
    expect(locks.headBlindnessCausallyUnerasable).toBe(true)
    expect(locks.adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable).toBe(true)
    expect(locks.causalLocksAllHold).toBe(true)
  })

  it('⑯ 因果锁与规模无关：不同 items/rate 下仍 allHold=true', () => {
    for (const cfg of [{ items: 48, rate: 0.4 }, { items: 160, rate: 0.7 }]) {
      expect(verifyCausalLocks({ seed: 533, ...cfg }).causalLocksAllHold).toBe(true)
    }
  })

  it('⑰ 因果锁是可证伪的：翻转 error 平行流逐 id 决策恒同、自适应滞后真读数', () => {
    const locks = verifyCausalLocks({ seed: 533, items: 64, rate: 0.5 })
    expect(locks.rateSweep.length).toBe(5)
    expect(locks.rateSweep.every((x) => typeof x.errorRate === 'number' && typeof x.normalRate === 'number')).toBe(true)
    // 头部盲是结构判据：翻转 hasError 后逐 id 决策必须恒同（零统计噪声、与样本量无关）
    expect(locks.decisionInvariant).toBe(true)
    expect(locks.maxBlindnessGap).toBeGreaterThanOrEqual(0) // 抽样偏差仅作展示读数，不当锁判据
    expect(locks.adaptivePerfectLost).toBeLessThan(locks.adaptiveBaseLost) // 完美反馈改善质量
    expect(locks.adaptivePerfectLost).toBeGreaterThan(0)                  // 但救不到零 ⇒ 锁未塌
  })

  // ============ study 矩阵 + 向量（7）============
  it('⑱ traceSamplingStudy 默认向量逐格互异、无一 111 ⇒ noUniversalWinner=true', () => {
    const s = traceSamplingStudy({ now: () => 533000 })
    expect(s.vectors.HeadBasedSampler).toBe('100')
    expect(s.vectors.TailBasedSampler).toBe('010')
    expect(s.vectors.AdaptiveSampler).toBe('101')
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
    expect(s.builtAt).toBe(533000)
  })

  it('⑲ 默认向量各自缺一维：Head 盲丢 / Tail 缓冲换保异常 / Adaptive 调率仍盲', () => {
    const s = traceSamplingStudy({})
    const head = s.rows.find((r) => r.protocol === 'HeadBasedSampler')!
    const tail = s.rows.find((r) => r.protocol === 'TailBasedSampler')!
    const adaptive = s.rows.find((r) => r.protocol === 'AdaptiveSampler')!
    expect(head.trilemma).toEqual({ lowOverhead: true, anomalyCapture: false, loadAdaptive: false })
    expect(tail.trilemma).toEqual({ lowOverhead: false, anomalyCapture: true, loadAdaptive: false })
    expect(adaptive.trilemma).toEqual({ lowOverhead: true, anomalyCapture: false, loadAdaptive: true })
    expect(tail.metrics.peakBufferedSpans).toBeGreaterThan(0)
    expect(adaptive.metrics.rateChanges).toBeGreaterThan(0)
    expect(s.verdict.headBlindLossOnErrorBurst).toBe(true)
  })

  it('⑳ row.trilemma 与 vectors 同源、cell 三考场标记正交空真不连坐', () => {
    const s = traceSamplingStudy({})
    for (const row of s.rows) {
      expect(s.vectors[row.protocol]).toBe(vecOf(row.trilemma))
      expect(row.scenarios.length).toBe(TRACE_SCENARIOS.length)
      for (const c of row.scenarios) {
        expect(typeof c.peakBufferedSpans).toBe('number')
        expect(typeof c.rateChanges).toBe('number')
        expect(typeof c.errorTracesRetained).toBe('number')
        // 逐格三布尔由本格真观测量现算（非查表/写死），与聚合 trilemma 同源
        expect(c.lowOverhead).toBe(c.peakBufferedSpans === 0)
        expect(c.loadAdaptive).toBe(c.rateChanges > 0)
        expect(c.anomalyCapture).toBe(c.errorTracesTotal > 0 ? c.errorTracesRetained === c.errorTracesTotal : true)
        expect(typeof c.inAnomalyExam).toBe('boolean')
        expect(typeof c.inOverheadExam).toBe('boolean')
        expect(typeof c.inAdaptiveExam).toBe('boolean')
      }
    }
    const headSteady = s.rows[0].scenarios.find((c) => c.id === 'steadyLoad')!
    expect(headSteady.inOverheadExam).toBe(false) // steady 不在开销考场
    expect(headSteady.inAnomalyExam).toBe(true)
  })

  it('㉑ 注入 items/rate/windowSize/seed 真生效（不是只改 config 显示）', () => {
    const base = traceSamplingStudy({ now: () => 1 })
    const tuned = traceSamplingStudy({ now: () => 1, items: 128, rate: 0.3, windowSize: 8, seed: 7 })
    expect(tuned.config.items).toBe(128)
    expect(tuned.config.rate).toBe(0.3)
    expect(tuned.config.windowSize).toBe(8)
    expect(tuned.config.seed).toBe(7)
    expect(tuned.rows[0].scenarios[0].spansIn).toBeGreaterThan(base.rows[0].scenarios[0].spansIn)
    expect(traceStreamOf('spikeLoad', { items: 128 }).length).toBe(384)
  })

  it('㉒ 单开 oracleHead ⇒ Head 补 anomaly 维 100→110，主教义 headBlindLoss 不翻', () => {
    const s = traceSamplingStudy({ oracleHead: true })
    expect(s.vectors.HeadBasedSampler).toBe('110')
    expect(s.vectors.TailBasedSampler).toBe('010')
    expect(s.verdict.oracleHeadErasesHeadBlindness).toBe(true)
    expect(s.verdict.headBlindLossOnErrorBurst).toBe(true) // 恒以纯净基线标定，不翻
    expect(s.verdict.causalLocksAllHold).toBe(true)
  })

  it('㉓ 单开 infiniteBuffer ⇒ Tail 补 lowOverhead 维 010→110，主教义 tailGuaranteesAnomaly 不翻', () => {
    const s = traceSamplingStudy({ infiniteBuffer: true })
    expect(s.vectors.TailBasedSampler).toBe('110')
    expect(s.vectors.HeadBasedSampler).toBe('100')
    expect(s.verdict.infiniteBufferErasesOverhead).toBe(true)
    expect(s.verdict.tailGuaranteesAnomaly).toBe(true)
    expect(s.verdict.causalLocksAllHold).toBe(true)
  })

  it('㉔ 单开 perfectFeedback ⇒ Adaptive 向量不变 101、只改善 errorBurst 质量', () => {
    const s = traceSamplingStudy({ perfectFeedback: true })
    expect(s.vectors.AdaptiveSampler).toBe('101')
    expect(s.verdict.perfectFeedbackImprovesBurstOnly).toBe(true)
    expect(s.verdict.adaptiveTracksLoad).toBe(true)
    expect(s.verdict.causalLocksAllHold).toBe(true)
  })

  it('㉕ rigged 诚实标定：Head≡Tail=110 区分度塌缩、不硬造 111、三因果锁仍钉死', () => {
    const s = traceSamplingStudy({ rigged: true, now: () => 533000 })
    expect(s.rigged).toBe(true)
    expect(s.vectors).toEqual({ HeadBasedSampler: '110', TailBasedSampler: '110', AdaptiveSampler: '101' })
    expect(new Set(Object.values(s.vectors)).size).toBe(2) // Head 与 Tail 收敛
    expect(s.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(s.trilemmaDistinguishes).toBe(false)
    expect(s.verdict.noStrategyWinsAll).toBe(true) // 仍无一 111
    expect(s.verdict.causalLocksAllHold).toBe(true)
    expect(s.verdict.headBlindLossOnErrorBurst).toBe(true) // 主教义不翻
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('㉖ study.crosscheck 双路自证稳态真撞合、三路篡改真红、21 键 evidence 真回读', () => {
    const s = traceSamplingStudy({ now: () => 533000 })
    const sm = s.crosscheck.soundness
    expect(sm.holds).toBe(true)
    expect(sm.baselineHolds).toBe(true)
    expect(sm.falsifiable).toBe(true)
    expect(sm.tamper.forgedErrorSpan.holds).toBe(false)
    expect(sm.tamper.duplicateRelease.holds).toBe(false)
    expect(sm.tamper.emptyTraceSet.holds).toBe(false)
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
  })

  // ============ snapshot（2）============
  it('㉗ traceSamplingSnapshot：形状 + 顶层 rigged/noUniversalWinner/trilemmaDistinguishes/causalLocks 同源', () => {
    const s = traceSamplingStudy({ now: () => 533000 })
    const snap = traceSamplingSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.builtAt).toBe(533000)
    expect(snap.config).toEqual(s.config)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.verdict.vectors).toEqual(s.vectors)
    expect(snap.rigged).toBe(false)
    expect(snap.noUniversalWinner).toBe(true)
    expect(snap.trilemmaDistinguishes).toBe(true)
    expect(snap.causalLocks.causalLocksAllHold).toBe(true)
    const rig = traceSamplingSnapshot(traceSamplingStudy({ rigged: true, now: () => 533000 }))!
    expect(rig.rigged).toBe(true)
    expect(rig.trilemmaDistinguishes).toBe(false)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('㉘ traceSamplingSnapshot(null)/({}) → null 反守卫', () => {
    expect(traceSamplingSnapshot(null as never)).toBe(null)
    expect(traceSamplingSnapshot({} as never)).toBe(null)
  })

  // ============ evidence（1）============
  it('㉙ createTraceSamplingEvidence 真件 21 键 + 核心件真回读 + builtAt 注入不漂移', () => {
    const e1 = createTraceSamplingEvidence({ seed: 533, now: () => 533000 }) as unknown as Record<string, number>
    const e2 = createTraceSamplingEvidence({ seed: 533, now: () => 533000 }) as unknown as Record<string, number>
    const keys = Object.keys(e1).sort()
    expect(keys.length).toBe(21)
    expect(keys).toEqual(Object.keys(e2).sort())
    expect(e1).toEqual(e2)
    expect(e1.redisBitmapHits).toBeGreaterThan(0)
    expect(e1.walReplayed).toBeGreaterThan(0)
    expect(e1.counterSum).toBeGreaterThan(0)
    expect(e1.jitterSpread).toBeGreaterThan(0)
  })

  // ============ CLI 双跑字节一致（1）============
  it('㉚ CLI 默认 + rigged 固定时钟双跑字节一致', () => {
    const cli = resolve(ROOT, 'scripts/caesura-trace-sampling.mjs')
    const run = (args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
    expect(run(['--now=1000'])).toBe(run(['--now=1000']))
    expect(run(['--rigged', '--now=1000'])).toBe(run(['--rigged', '--now=1000']))
  })
})
