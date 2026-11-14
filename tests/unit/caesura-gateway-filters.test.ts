import { describe, expect, it } from 'vitest'
import {
  GATEWAY_FILTERS_DEFAULTS,
  GATEWAY_FILTERS_SCENARIOS,
  GATEWAY_FILTERS_STRATEGIES,
  FILTER_REGISTRY,
  buildFilterChain,
  evaluateOnionChain,
  createRateLimitGate,
  createBreakerGate,
  createOrderedChain,
  createRateLimitGatewayFilter,
  createCircuitBreakerGatewayFilter,
  gatewayFiltersStudy,
  gatewayFiltersSnapshot,
  verifyGatewayFiltersSoundness,
  verifyCausalLocks,
  createGatewayFiltersEvidence,
} from '../../scripts/caesura-gateway-filters.mjs'

/** KI-563 Spring Cloud Gateway 过滤器全家桶教学件 · 2026-11-14 */

describe('caesura-gateway-filters（KI-563）', () => {
  it('默认值 / 策略 / 场景', () => {
    expect(GATEWAY_FILTERS_STRATEGIES).toEqual(['OrderedChain', 'RateLimitGatewayFilter', 'CircuitBreakerGatewayFilter'])
    expect(GATEWAY_FILTERS_SCENARIOS).toEqual(['normalTraffic', 'burstOverload', 'downstreamOutage', 'cleanRerun'])
    expect(GATEWAY_FILTERS_DEFAULTS.seed).toBe(563)
    expect(GATEWAY_FILTERS_DEFAULTS.capacity).toBe(2)
  })

  it('buildFilterChain：pre 升序 / post 降序 / 同 order 保留注册序（Onion 模型）', () => {
    const { pre, post, combined } = buildFilterChain(FILTER_REGISTRY)
    expect(pre).toEqual(['SecurityGatewayFilter', 'RewritePathGatewayFilter', 'RequestRateLimiter', 'CircuitBreakerGatewayFilter'])
    expect(post).toEqual(['CircuitBreakerGatewayFilter', 'RequestRateLimiter', 'RewritePathGatewayFilter', 'SecurityGatewayFilter'])
    expect(combined).toEqual([...pre, 'handler', ...post])
  })

  it('evaluateOnionChain：可见性序列确定性；乱序注册必翻车', () => {
    const seq = evaluateOnionChain(FILTER_REGISTRY)
    expect(seq).toEqual(['in:SecurityGatewayFilter', 'in:RewritePathGatewayFilter', 'in:RequestRateLimiter', 'in:CircuitBreakerGatewayFilter', 'handler', 'out:CircuitBreakerGatewayFilter', 'out:RequestRateLimiter', 'out:RewritePathGatewayFilter', 'out:SecurityGatewayFilter'])
    const broken = evaluateOnionChain([...FILTER_REGISTRY].reverse().map((r) => ({ ...r, order: 0 })))
    expect(broken).not.toEqual(seq)
  })

  it('createRateLimitGate：capacity=2/burst 7 恰 2 放行（真 createTokenBucket）', () => {
    const gate = createRateLimitGate({ capacity: 2, refillPerSec: 0, now: 0 })
    let allowed = 0
    for (let i = 0; i < 7; i++) if (gate.allow()) allowed += 1
    expect(allowed).toBe(2)
  })

  it('createBreakerGate：5 败必 OPEN；OPEN 必拒绝；cooldown 后必放 HALF_OPEN 探针；success 必回 CLOSED', () => {
    const br = createBreakerGate({ failureThreshold: 5, cooldownTicks: 10, halfOpenMax: 2 })
    const blow = () => { throw new Error('downstream-500') }
    for (let i = 0; i < 5; i++) br.call(blow)
    expect(br.state).toBe('OPEN')
    const rej = br.call(() => 'nope', 0)
    expect(rej.ok).toBe(false)
    expect(rej.reason).toBe('circuit_open')
    br.call(() => 'ok', 10)
    expect(br.state).toBe('CLOSED')
  })

  it('三策略工厂：三元组互斥（orderedCorrect / rateLimited / circuitBroken）', () => {
    expect(createOrderedChain().trilemma()).toEqual({ orderedCorrect: true, rateLimited: false, circuitBroken: false })
    expect(createRateLimitGatewayFilter().trilemma()).toEqual({ orderedCorrect: false, rateLimited: true, circuitBroken: false })
    expect(createCircuitBreakerGatewayFilter().trilemma()).toEqual({ orderedCorrect: false, rateLimited: false, circuitBroken: true })
  })

  it('gatewayFiltersStudy：向量 100/010/001，三场景三英雄', () => {
    const s = gatewayFiltersStudy({ now: () => 563 })
    expect(s.vectors).toEqual({ OrderedChain: '100', RateLimitGatewayFilter: '010', CircuitBreakerGatewayFilter: '001' })
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.scenarioDistinguishes).toBe(true)
    const o = s.rows.find((r) => r.protocol === 'OrderedChain')!
    const r = s.rows.find((r) => r.protocol === 'RateLimitGatewayFilter')!
    const c = s.rows.find((r) => r.protocol === 'CircuitBreakerGatewayFilter')!
    expect(o.scenarios.find((x) => x.id === 'normalTraffic')!.state).toBe('hit')
    expect(o.scenarios.find((x) => x.id === 'burstOverload')!.state).toBe('miss')
    expect(r.scenarios.find((x) => x.id === 'burstOverload')!.state).toBe('hit')
    expect(r.scenarios.find((x) => x.id === 'burstOverload')!.matched).toBe(GATEWAY_FILTERS_DEFAULTS.capacity)
    expect(c.scenarios.find((x) => x.id === 'downstreamOutage')!.state).toBe('hit')
    expect(o.scenarios.find((x) => x.id === 'downstreamOutage')!.state).toBe('miss')
    expect(r.scenarios.find((x) => x.id === 'downstreamOutage')!.state).toBe('miss')
  })

  it('gatewayFiltersSnapshot：形状与 causalLocks', () => {
    const snap = gatewayFiltersSnapshot(gatewayFiltersStudy({ now: () => 563 }))
    expect(snap.rows).toHaveLength(3)
    expect(snap.rows[0].scenarios).toHaveLength(4)
    expect(snap.causalLocks.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck.soundness.holds).toBe(true)
  })

  it('verifyGatewayFiltersSoundness：基准 holds + 三路篡改全部 false（可证伪）', () => {
    const s = verifyGatewayFiltersSoundness({ seed: 563 }, { seed: 563 })
    expect(s.baselineHolds).toBe(true)
    expect(s.holds).toBe(true)
    expect(s.nontrivial).toBe(true)
    expect(s.falsifiable).toBe(true)
    expect(s.tamper.reorderedFilter.holds).toBe(false)
    expect(s.tamper.overdraftBucket.holds).toBe(false)
    expect(s.tamper.alwaysClosed.holds).toBe(false)
    expect(s.laneA.orderedCorrect).toBe(true)
    expect(s.laneB.holds).toBe(true)
    expect(s.laneC.holds).toBe(true)
  })

  it('verifyCausalLocks：三把因果锁全部 holds', () => {
    const cl = verifyCausalLocks()
    expect(cl.onionWrapperCausallyUnerasable).toBe(true)
    expect(cl.bucketThroughputCausallyUnerasable).toBe(true)
    expect(cl.halfOpenRecoveryCausallyUnerasable).toBe(true)
    expect(cl.causalLocksAllHold).toBe(true)
    expect(cl.probes.burstAllowed).toBe(2)
    expect(cl.probes.openedAtFive).toBe(true)
    expect(cl.probes.closedAgain).toBe(true)
  })

  it('createGatewayFiltersEvidence：21 个真实模块证据全部产出', () => {
    const ev = createGatewayFiltersEvidence({ seed: 563 })
    expect(ev.routerMoved).toBeGreaterThan(0)
    expect(ev.routerTracked).toBeGreaterThan(0)
    expect(ev.ringNodes).toBe(4)
    expect(ev.walLines).toBe(80)
    expect(ev.walReplayed).toBe(80)
    expect(ev.notices).toBe(12)
    expect(ev.redisBitmapHits).toBe(96)
    expect(ev.bucketAllowed).toBe(3)
    expect(ev.bucketRejected).toBe(4)
    expect(ev.heapFired).toBe(3)
    expect(ev.heapPending).toBe(0)
    expect(ev.counterSum).toBe(2080)
    expect(ev.remapConsistentRate).toBeGreaterThanOrEqual(0)
    expect(ev.jitterSpread).toBeGreaterThanOrEqual(0)
  })

  it('rigged：假定世界三策略全员 111；单边放行各顶高自己那一家', () => {
    const s = gatewayFiltersStudy({ rigged: true, now: () => 563 })
    for (const p of GATEWAY_FILTERS_STRATEGIES) expect(s.vectors[p]).toBe('111')
    expect(s.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(false)
    const partial = gatewayFiltersStudy({ freeRateLimited: true, now: () => 563 })
    expect(partial.vectors.OrderedChain).toBe('110')
    expect(partial.vectors.RateLimitGatewayFilter).toBe('010')
    expect(partial.vectors.CircuitBreakerGatewayFilter).toBe('011')
  })
})
