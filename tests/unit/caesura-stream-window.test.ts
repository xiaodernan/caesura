import { describe, expect, it } from 'vitest'
import {
  SW_DEFAULTS,
  SW_STRATEGIES,
  SW_SCENARIOS,
  runStreamWindowScenario,
  streamWindowStudy,
  streamWindowSnapshot,
  verifyWatermarkMonotonicity,
  createStreamWindowEvidence,
} from '../../scripts/caesura-stream-window.mjs'

/**
 * KI-529 流式窗口聚合与 Watermark 迟到处置三策略诚实权衡（P8 第三十六件 · 前端第二十五维）。
 *
 * 测试面向现象：真实事件流驱动真三策略状态机，向量全部由现算读数收敛（`vecOf` 同源），
 * 绝不硬覆盖，也不维护好看的表象。
 */

describe('caesura-stream-window（KI-529）', () => {
  // ============ 配置与名册 ============
  it('SW_DEFAULTS / SW_STRATEGIES / SW_SCENARIOS 固定顺序、键名同词', () => {
    expect(SW_STRATEGIES).toEqual(['Tumbling', 'Sliding', 'Session'])
    expect(SW_SCENARIOS).toEqual(
      ['alignedBursts', 'boundaryStraddle', 'overlapReuse', 'sessionGaps', 'lateWithinAllowance', 'lateBeyondGap'],
    )
    expect(SW_DEFAULTS.seed).toBe(529)
    expect(SW_DEFAULTS.windowSize).toBe(100)
    expect(SW_DEFAULTS.slideStep).toBe(25)
    expect(SW_DEFAULTS.sessionGap).toBe(40)
    expect(SW_DEFAULTS.allowedLateness).toBe(20)
    expect(SW_DEFAULTS.rigged).toBe(false)
  })

  it('六场景全跑 0 抛错（每策略 × 每场景）', () => {
    for (const p of SW_STRATEGIES) {
      for (const s of SW_SCENARIOS) {
        expect(() => runStreamWindowScenario(p, s, {})).not.toThrow()
      }
    }
  })

  // ============ 真实现：boundary 分歧 ============
  it('Tumbling 跨边界对必切——boundaryStraddle pairCoverage === 0', () => {
    const r = runStreamWindowScenario('Tumbling', 'boundaryStraddle', {})
    expect(r.pairCoverage).toBe(0)
    expect(r.coveredPairs).toBe(0)
    expect(r.pairs).toBeGreaterThan(0)
  })

  it('Session 跨边界对必并入——boundaryStraddle pairCoverage ≥ 0.9', () => {
    const r = runStreamWindowScenario('Session', 'boundaryStraddle', {})
    expect(r.pairCoverage).toBeGreaterThanOrEqual(0.9)
  })

  it('Sliding 重叠窗必覆盖——overlapReuse pairCoverage ≥ 0.9 且 Tumbling 必为 0', () => {
    expect(runStreamWindowScenario('Sliding', 'overlapReuse', {}).pairCoverage).toBeGreaterThanOrEqual(0.9)
    expect(runStreamWindowScenario('Tumbling', 'overlapReuse', {}).pairCoverage).toBe(0)
  })

  it('Sliding 状态放大真件 > 1.5，Tumbling/Session 恒为 1', () => {
    expect(runStreamWindowScenario('Sliding', 'alignedBursts', {}).amplification).toBeGreaterThan(1.5)
    expect(runStreamWindowScenario('Tumbling', 'alignedBursts', {}).amplification).toBe(1)
    expect(runStreamWindowScenario('Session', 'alignedBursts', {}).amplification).toBe(1)
  })

  it('lateBeyondGap：Session 迟到全部 sideOutput ⇒ lateTolerance=false；Tumbling/Sliding 全纳入 ⇒ true', () => {
    const ses = runStreamWindowScenario('Session', 'lateBeyondGap', {})
    expect(ses.lateSideOutput).toBeGreaterThanOrEqual(48)
    expect(ses.lateAccepted).toBe(0)
    expect(runStreamWindowScenario('Tumbling', 'lateBeyondGap', {}).lateSideOutput).toBe(0)
    expect(runStreamWindowScenario('Sliding', 'lateBeyondGap', {}).lateSideOutput).toBeLessThan(
      runStreamWindowScenario('Sliding', 'lateWithinAllowance', {}).lateTotal, // 滑窗迟到纳入规模对照
    )
  })

  it('frozenWatermark ⇒ 无窗定稿 ⇒ coverage 真塌（因果锁）', () => {
    const r = runStreamWindowScenario('Tumbling', 'boundaryStraddle', { frozenWatermark: true })
    expect(r.emittedWindows).toBe(0)
    expect(r.pairCoverage).toBe(0)
  })

  // ============ verifyWatermarkMonotonicity ============
  it('verifyWatermarkMonotonicity（健康 lateWithinAllowance 流）holds=true nontrivial=true', () => {
    const s = streamWindowStudy({})
    const wm = s.crosscheck.watermark
    expect(wm.holds).toBe(true)
    expect(wm.nontrivial).toBe(true)
    expect(wm.laneA.steps).toBeGreaterThanOrEqual(16)
    expect(wm.laneB.accepted).toBeGreaterThanOrEqual(1)
    expect(wm.falsifiable).toBe(true)
  })

  it('verifyWatermarkMonotonicity 空事件集 ⇒ holds=false nontrivial=false（不凭 0=0 假绿）', () => {
    const r = verifyWatermarkMonotonicity([], { windowSize: 100, sessionGap: 40, allowedLateness: 20 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
    expect(r.tamper.emptySet.holds).toBe(false)
  })

  it('verifyWatermarkMonotonicity 三路篡改全部真喂回同一内核现算翻 false', () => {
    const s = streamWindowStudy({})
    const t = s.crosscheck.watermark.tamper
    expect(t.watermarkInverted.holds).toBe(false)
    expect(t.dispositionTampered.holds).toBe(false)
    expect(t.emptySet.holds).toBe(false)
  })

  // ============ study 矩阵 + 向量 ============
  it('streamWindowStudy 默认向量逐格互异、无一 111 ⇒ noUniversalWinner=true distinguishing', () => {
    const s = streamWindowStudy({ now: () => 529000 })
    expect(s.vectors.Tumbling).toBe('011')
    expect(s.vectors.Sliding).toBe('110')
    expect(s.vectors.Session).toBe('101')
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.rigged).toBe(false)
    expect(s.builtAt).toBe(529000)
  })

  it('默认向量各自缺一维：Tumbling 结果完整真塌 / Sliding 状态省 / Session 迟到容忍', () => {
    const s = streamWindowStudy({})
    const tum = s.rows.find((r) => r.protocol === 'Tumbling')!
    const sli = s.rows.find((r) => r.protocol === 'Sliding')!
    const ses = s.rows.find((r) => r.protocol === 'Session')!
    expect(tum.trilemma).toEqual({ resultCompleteness: false, lateTolerance: true, stateEfficiency: true })
    expect(sli.trilemma).toEqual({ resultCompleteness: true, lateTolerance: true, stateEfficiency: false })
    expect(ses.trilemma).toEqual({ resultCompleteness: true, lateTolerance: false, stateEfficiency: true })
  })

  it('rigged 三开关齐开 ⇒ 011/011/011（resultCompleteness 因果抹不掉，绝不硬造全 111）', () => {
    const s = streamWindowStudy({ rigged: true })
    expect(s.rigged).toBe(true)
    expect(s.vectors).toEqual({ Tumbling: '011', Sliding: '011', Session: '011' })
    expect(s.verdict.resultCompletenessCausallyUnerasable).toBe(true)
    expect(s.verdict.noUniversalWinner).toBe(false)
    expect(s.verdict.trilemmaDistinguishes).toBe(false)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
  })

  it('单开反噬判据：frozen 真抹完整维 / infinite 真抹 Session 迟到维 / free 真抹 Sliding 状态维（恒以纯净基线对照）', () => {
    const s = streamWindowStudy({})
    expect(s.verdict.frozenCollapsesCompleteness).toBe(true)
    expect(s.verdict.infiniteRestoresSessionLate).toBe(true)
    expect(s.verdict.freeRestoresSlidingState).toBe(true)
  })

  it('row.trilemma 与 vectors 同源（同一 truth 来源）', () => {
    const s = streamWindowStudy({})
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.resultCompleteness)}${Number(row.trilemma.lateTolerance)}${Number(row.trilemma.stateEfficiency)}`)
    }
  })

  // ============ snapshot ============
  it('streamWindowSnapshot: 形状 + verdict 同源', () => {
    const s = streamWindowStudy({ now: () => 529000 })
    const snap = streamWindowSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.builtAt).toBe(529000)
    expect(snap.config).toEqual(s.config)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.verdict.vectors).toEqual(s.vectors)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(snap.crosscheck && snap.crosscheck.watermark).toBeDefined()
  })

  it('streamWindowSnapshot(null)/({}) → null 反守卫', () => {
    expect(streamWindowSnapshot(null as never)).toBe(null)
    expect(streamWindowSnapshot({} as never)).toBe(null)
  })

  it('cells 的三布尔+考场标记都由考场分派生成（非考场格空真 ✓）', () => {
    const s = streamWindowStudy({})
    for (const row of s.rows) {
      for (const cell of row.scenarios) {
        expect(typeof cell.resultCompleteness).toBe('boolean')
        expect(typeof cell.lateTolerance).toBe('boolean')
        expect(typeof cell.stateEfficiency).toBe('boolean')
        if (!cell.inResultExam) expect(cell.resultCompleteness).toBe(true)
        if (!cell.inLateExam) expect(cell.lateTolerance).toBe(true)
        if (!cell.inStateExam) expect(cell.stateEfficiency).toBe(true)
      }
    }
  })

  // ============ evidence ============
  it('createStreamWindowEvidence 真件 ≥ 21 键 + 核心件真回读', () => {
    const ev = createStreamWindowEvidence({ seed: 529, now: () => 529000 }) as unknown as Record<string, number>
    const keys = Object.keys(ev).sort()
    expect(keys.length).toBeGreaterThanOrEqual(21)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.jitterSpread).toBeGreaterThanOrEqual(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
  })

  // ============ 交叉校验 verdict ============
  it('verdict.tumble/window 判词逐字同源：tumbling_crossBoundaryLoss=true、session_gapFragile=true', () => {
    const s = streamWindowStudy({})
    expect(s.verdict.tumbling_crossBoundaryLoss).toBe(true)
    expect(s.verdict.sliding_stateAmplified).toBe(true)
    expect(s.verdict.session_gapFragile).toBe(true)
    expect(s.verdict.sliding_overlapComplete).toBe(true)
    expect(s.verdict.session_stateCheap).toBe(true)
  })

  it('streamWindowStudy CLI 注入时钟 ⇒ builtAt 真吃注入（rigged/普通两种跑法字节一致）', () => {
    const a = streamWindowStudy({ now: () => 529000 })
    const b = streamWindowStudy({ now: () => 529000, rigged: true })
    expect(a.builtAt).toBe(529000)
    expect(b.builtAt).toBe(529000)
  })
})
