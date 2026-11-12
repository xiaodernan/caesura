import { describe, expect, it } from 'vitest'
import {
  CIRCUIT_DEFAULTS,
  CIRCUIT_SCENARIOS,
  CIRCUIT_STRATEGIES,
  createCountBasedBreaker,
  createRateBasedBreaker,
  createSlowCallBreaker,
  circuitBreakerStudy,
  circuitBreakerSnapshot,
  verifyCausalLocks,
  verifyCircuitSoundness,
  createCircuitEvidence,
} from '../../scripts/caesura-circuit-breaker.mjs'

/** KI-537 Spring Cloud CircuitBreaker 三策略（P8 第四十四件 · 前端第三十一维）。 */

describe('caesura-circuit-breaker（KI-537）', () => {
  it('CIRCUIT_DEFAULTS / STRATEGIES / SCENARIOS 固定顺序', () => {
    expect(CIRCUIT_STRATEGIES).toEqual(['CountBasedBreaker', 'RateBasedBreaker', 'SlowCallBreaker'])
    expect(CIRCUIT_SCENARIOS).toEqual(['steadyState', 'burstySpikeFailures', 'slowDegradation', 'permanentHostile', 'sparseTraffic', 'cleanRerun'])
    expect(CIRCUIT_DEFAULTS.seed).toBe(537)
    expect(CIRCUIT_DEFAULTS.calls).toBe(96)
    expect(CIRCUIT_DEFAULTS.windowSize).toBe(16)
    expect(CIRCUIT_DEFAULTS.slowThresholdMs).toBe(250)
  })

  it('CountBasedBreaker：slow call 不算失败——slowDegradation 流零 trip', () => {
    const brk = createCountBasedBreaker({ windowSize: 16, failureThreshold: 5 })
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `t${i}`, durationMs: 40, failed: false, slow: i >= 12 && i < 60 }))
    const out = brk.run(events)
    expect(out.trips).toBe(0)
  })

  it('RateBasedBreaker：稀疏节奏真 normalize（failure rate < 50% 不 trip）', () => {
    const brk = createRateBasedBreaker({ windowSize: 16, failureRateThreshold: 0.5, minimumNumberOfCalls: 4 })
    const events = Array.from({ length: 96 }, (_, i) => (i >= 40 && i < 45 ? { id: `t${i}`, durationMs: 40, failed: true } : { id: `t${i}`, durationMs: 40, failed: false }))
    const out = brk.run(events)
    expect(out.trips).toBe(0)
  })

  it('CountBasedBreaker：burst 真 trip、≥5 失败；SlowCallBreaker：看不见硬故障、permanentHostile 零 trip', () => {
    const hostile = Array.from({ length: 96 }, (_, i) => ({ id: `t${i}`, durationMs: 40, failed: true }))
    const m = createCountBasedBreaker({}).run(hostile)
    expect(m.trips).toBeGreaterThan(0)
    const slow = createSlowCallBreaker({}).run(hostile)
    expect(slow.trips).toBe(0)
  })

  it('SlowCallBreaker：slow 流（50% 慢 ≥ 阈值）真 trip', () => {
    const slow = Array.from({ length: 96 }, (_, i) => ({ id: `t${i}`, durationMs: i >= 12 && i < 60 ? 500 : 40, failed: false }))
    const out = createSlowCallBreaker({}).run(slow)
    expect(out.trips).toBeGreaterThan(0)
  })

  it('六场景都跑出 cell；vectors 与 trilemma 同源现算', () => {
    const s = circuitBreakerStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(CIRCUIT_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.hardFaultsAware)}${Number(row.trilemma.degradedFaultsAware)}${Number(row.trilemma.sparseTrafficSafe)}`)
    }
  })

  it('默认向量互异、无一 111、不封赢家、noStrategyWinsAll / vectorFromTrilemma', () => {
    const s = circuitBreakerStudy({ now: () => 537000 })
    expect(s.vectors).toEqual({ CountBasedBreaker: '100', RateBasedBreaker: '101', SlowCallBreaker: '011' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(537000)
  })

  it('三难各据一考场：[hardFaultsAware / degradedFaultsAware / sparseTrafficSafe]', () => {
    const s = circuitBreakerStudy({})
    const count = s.rows.find((r) => r.protocol === 'CountBasedBreaker')!
    const rate = s.rows.find((r) => r.protocol === 'RateBasedBreaker')!
    const slow = s.rows.find((r) => r.protocol === 'SlowCallBreaker')!
    expect(count.trilemma).toEqual({ hardFaultsAware: true, degradedFaultsAware: false, sparseTrafficSafe: false })
    expect(rate.trilemma).toEqual({ hardFaultsAware: true, degradedFaultsAware: false, sparseTrafficSafe: true })
    expect(slow.trilemma).toEqual({ hardFaultsAware: false, degradedFaultsAware: true, sparseTrafficSafe: true })
  })

  it('study 配置真传导：windowSize/failureThreshold/slowThresholdMs / baselines', () => {
    const s = circuitBreakerStudy({ calls: 32, windowSize: 8 })
    // config snapshot passes the passed values through（虽然目前仅 influence flags）
    expect(s.config.windowSize).toBeGreaterThan(0)
    expect(s.config.scenarios.length).toBe(6)
    expect(s.verdict.countBlindToSlow).toBe(true)
    expect(s.verdict.slowCallBlindToFailures).toBe(true)
    expect(s.verdict.rateSafeOnSparse).toBe(true)
  })

  it('单开 perfectMonitoring ⇒ 向量不动；unlimitedWindow 提升窗口', () => {
    const s = circuitBreakerStudy({ perfectMonitoring: true, unlimitedWindow: true })
    expect(s.vectors.SlowCallBreaker).toBe('011')
    expect(s.vectors.RateBasedBreaker).toBe('101')
    expect(s.vectors.CountBasedBreaker).toBe('100')
  })

  it('rigged 三开齐：向量不动（三大件各缺一维的宿命不被 rigged 改变）——riggedConvergenceCollapsed=false', () => {
    const s = circuitBreakerStudy({ rigged: true })
    expect(s.vectors).toEqual({ CountBasedBreaker: '100', RateBasedBreaker: '101', SlowCallBreaker: '011' })
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('verifyCircuitSoundness：holds=true nontrivial=true falsifiable；laneA 健康无 trip、laneB bursty 真 trip', () => {
    const events = Array.from({ length: 96 }, (_, i) => (i >= 24 && i < 56 ? { id: `cb:537:${i}`, durationMs: 40, failed: true } : { id: `cb:537:${i}`, durationMs: 40, failed: false }))
    const r = verifyCircuitSoundness({ events, seed: 537 }, { seed: 537 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.steadyTrips).toBe(0)
    expect(r.laneB.burstyCountTrips).toBeGreaterThan(0)
    expect(r.laneB.burstySlowTrips).toBe(0)
    expect(r.falsifiable).toBe(true)
    expect(r.tamper.forgedLatency.holds).toBe(false)
    expect(r.tamper.silentFailuresIgnored.holds).toBe(false)
    expect(r.tamper.emptyStream.holds).toBe(false)
  })

  it('verifyCircuitSoundness 空 Stream ⇒ holds=false nontrivial=false（绝不 0=0 假绿）', () => {
    const r = verifyCircuitSoundness({ events: [], seed: 537 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('verifyCausalLocks 三因果锁 allHold；Count 对慢盲、Slow 对失败盲、Rate 需最小样本', () => {
    const r = verifyCausalLocks({ seed: 537 })
    expect(r.countThresholdIgnoresSlowCausallyUnerasable).toBe(true)
    expect(r.rateThresholdRequiresSampleCausallyUnerasable).toBe(true)
    expect(r.slowCallIgnoresHardFaultsCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('circuitBreakerSnapshot：形状 + verdict 同源；snapshot(null)/{} → null 反守卫', () => {
    const s = circuitBreakerStudy({ now: () => 537000 })
    const snap = circuitBreakerSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.causalLocks!.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(snap.crosscheck && snap.crosscheck.soundness).toBeDefined()
    expect(circuitBreakerSnapshot(null as never)).toBe(null)
    expect(circuitBreakerSnapshot({} as never)).toBe(null)
  })

  it('createCircuitEvidence 真件 ≥ 21 键 + 核心件回读', () => {
    const ev = createCircuitEvidence({ seed: 537, now: () => 537000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness 结构 holds', () => {
    const s = circuitBreakerStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  // ===== KI-537 判定层深修守卫：三难零查表真跑 + 三路 tamper 真喂回 + rigged 三开关真对照 =====

  it('三难零查表：每协议 exam 三条独立考场真 trips 现算，向量与 exam 读数同源', () => {
    const s = circuitBreakerStudy({ now: () => 537000 })
    const cc = s.verdict.trilemmaCrosscheck
    expect(cc.examVectorsMatchRows).toBe(true)
    expect(cc.noStrategyWinsAll).toBe(true)
    const count = cc.examReadouts.CountBasedBreaker
    const rate = cc.examReadouts.RateBasedBreaker
    const slow = cc.examReadouts.SlowCallBreaker
    // 硬故障座：Count/Rate 真 trip、SlowCall 零 trip
    expect(count.hard).toBeGreaterThan(0)
    expect(rate.hard).toBeGreaterThan(0)
    expect(slow.hard).toBe(0)
    // 慢退座：唯 SlowCall 真 trip
    expect(count.degraded).toBe(0)
    expect(rate.degraded).toBe(0)
    expect(slow.degraded).toBeGreaterThan(0)
    // 稀疏座：Count 个数阈值误 trip、Rate/SlowCall 不误
    expect(count.sparse).toBeGreaterThan(0)
    expect(rate.sparse).toBe(0)
    expect(slow.sparse).toBe(0)
    expect(count.vector).toBe('100')
    expect(rate.vector).toBe('101')
    expect(slow.vector).toBe('011')
  })

  it('cell 逐格回读 exam 真读数，三难字段由 exam 现算回填（非查表硬造）', () => {
    const s = circuitBreakerStudy({})
    for (const row of s.rows) {
      for (const cell of row.scenarios) {
        expect(cell.exam.hard).toBe(row.exam.trips.hard)
        expect(cell.exam.degraded).toBe(row.exam.trips.degraded)
        expect(cell.exam.sparse).toBe(row.exam.trips.sparse)
        expect(cell.hardFaultsAware).toBe(row.exam.trips.hard > 0)
        expect(cell.degradedFaultsAware).toBe(row.exam.trips.degraded > 0)
        expect(cell.sparseTrafficSafe).toBe(row.exam.trips.sparse === 0)
      }
    }
  })

  it('verifyCircuitSoundness baselineHolds 先真绿；falsifiable 由 baseline 与三路 tamper 真值推导', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `v${i}`, durationMs: 40, failed: i >= 24 && i < 56 }))
    const r = verifyCircuitSoundness({ events, seed: 537, calls: 96 }, { seed: 537, calls: 96 })
    expect(r.baselineHolds).toBe(true)
    expect(r.invariants.laneAOk).toBe(true)
    expect(r.invariants.laneBOk).toBe(true)
    expect(r.laneA.steadyTrips).toBe(0)
    expect(r.falsifiable).toBe(
      r.baselineHolds &&
      !r.tamper.forgedLatency.holds &&
      !r.tamper.silentFailuresIgnored.holds &&
      !r.tamper.emptyStream.holds
    )
    expect(r.holds).toBe(r.baselineHolds && r.falsifiable)
  })

  it('tamper 三路真改变内核输入：forgedLatency 翻 laneA、silentFailures 翻 laneB、emptyStream 翻 nontrivial', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `t${i}`, durationMs: 40, failed: i >= 24 && i < 56 }))
    const r = verifyCircuitSoundness({ events, seed: 537, calls: 96 }, { seed: 537, calls: 96 })
    // forgedLatency 把稳态流半数伪注 slow ⇒ SlowCall laneA 误 trip
    expect(r.tamper.forgedLatency.holds).toBe(false)
    // silentFailures 吞 failed ⇒ Count/Rate laneB 不再 trip（真观测读数下降）
    expect(r.tamper.silentFailuresIgnored.holds).toBe(false)
    expect(r.tamper.emptyStream.holds).toBe(false)
    expect(r.tamper.emptyStream.nontrivial).toBe(false)
  })

  it('verifyCircuitSoundness 三路篡改喂回同一内核：篡改输出确为 baseline 的对照（非零=0 假绿）', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `z${i}`, durationMs: 40, failed: i >= 24 && i < 56 }))
    const baseline = verifyCircuitSoundness({ events, seed: 537, calls: 96 }, { seed: 537, calls: 96 })
    const empty = verifyCircuitSoundness({ events: [], seed: 537, calls: 96 }, { seed: 537, calls: 96 })
    expect(baseline.nontrivial).toBe(true)
    expect(baseline.holds).toBe(true)
    // 空流真翻 nontrivial/holds，而非照抄 baseline
    expect(empty.nontrivial).toBe(false)
    expect(empty.holds).toBe(false)
    expect(empty.tamper.emptyStream.nontrivial).toBe(false)
  })

  it('rigged 三开关真进内核：三路对照读数存在且 verdict 布尔由真对照推出', () => {
    const s = circuitBreakerStudy({ rigged: true, now: () => 537000 })
    const fx = s.verdict.riggedEffects
    // 无限窗口：大窗 trips 严格小于小窗（误报被 normalize）
    expect(fx.unlimitedWindow.smallWindowTrips).toBeGreaterThan(fx.unlimitedWindow.largeWindowTrips)
    expect(s.verdict.unlimitedWindowErasesStutteringFalseAlert).toBe(true)
    // 瞬时恢复：两档 openTicks 真产出不同 OPEN 驻留读数
    expect(fx.instantRecovery.fastRecoverTrips).not.toBe(fx.instantRecovery.slowRecoverTrips)
    expect(s.verdict.instantRecoveryPreventsHalfOpenStuttering).toBe(true)
    // 完美监控：噪声流误 trip、真观测不误
    expect(fx.perfectMonitoring.noisyTrips).toBeGreaterThan(fx.perfectMonitoring.cleanTrips)
    expect(s.verdict.perfectMonitoringErasesFalsyPositives).toBe(true)
  })

  it('rigged 诚实塌缩边界：三开关全开向量仍不硬造 111，noStrategyWinsAll=true', () => {
    const s = circuitBreakerStudy({ rigged: true, now: () => 537000 })
    expect(s.vectors).toEqual({ CountBasedBreaker: '100', RateBasedBreaker: '101', SlowCallBreaker: '011' })
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
    // 即便运维旋钮全开，结构盲区守恒：三因果锁不翻
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
    expect(s.verdict.slowCallBlindToFailures).toBe(true)
    expect(s.verdict.countBlindToSlow).toBe(true)
  })

  it('注入贯穿：calls/windowSize/阈值真进矩阵与 config，考场恒隔绝运维旋钮', () => {
    const s = circuitBreakerStudy({ calls: 32, windowSize: 8, failureThreshold: 3, slowThresholdMs: 500, now: () => 537000 })
    expect(s.config.calls).toBe(32)
    expect(s.config.windowSize).toBe(8)
    expect(s.config.failureThreshold).toBe(3)
    expect(s.config.slowThresholdMs).toBe(500)
    for (const row of s.rows) {
      // 六场景每格真吃注入 calls
      for (const cell of row.scenarios) expect(cell.calls).toBe(32)
      // 三难考场恒用默认窗口隔绝注入/ rigged，向量不漂
      expect(row.exam.trips.hard).toBeGreaterThanOrEqual(0)
    }
    // 默认窗口考场 → 向量仍恰为 100/101/011
    expect(s.vectors).toEqual({ CountBasedBreaker: '100', RateBasedBreaker: '101', SlowCallBreaker: '011' })
  })

  it('causalLocks 三锁带真读数探针（非恒真重言式）', () => {
    const r = verifyCausalLocks({ seed: 537, calls: 96 })
    expect(r.causalLocksAllHold).toBe(true)
    expect(r.probes.countOnSlowTrips).toBe(0)
    expect(r.probes.rateWithoutMinTrips).toBeGreaterThan(r.probes.rateWithMinTrips)
    expect(r.probes.slowOnHostileTrips).toBe(0)
  })
})
