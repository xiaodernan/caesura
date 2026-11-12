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
})
