import { describe, expect, it } from 'vitest'
import {
  GATEWAY_RETRY_DEFAULTS,
  GATEWAY_RETRY_SCENARIOS,
  GATEWAY_RETRY_STRATEGIES,
  createImmediateRetry,
  createFixedBackoff,
  createExponentialFullJitter,
  gatewayRetryStudy,
  gatewayRetrySnapshot,
  verifyCausalLocks,
  verifyGatewayRetrySoundness,
  createGatewayRetryEvidence,
} from '../../scripts/caesura-gateway-retry.mjs'

/** KI-550 Spring Cloud Gateway Retry 三策略教学件（P8 第五十七件） */

describe('caesura-gateway-retry（KI-550）', () => {
  it('默认值/策略/场景 顺序稳定', () => {
    expect(GATEWAY_RETRY_STRATEGIES).toEqual(['ImmediateRetry', 'FixedBackoff', 'ExponentialFullJitter'])
    expect(GATEWAY_RETRY_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'backoffStorm', 'cleanRerun'])
    expect(GATEWAY_RETRY_DEFAULTS.seed).toBe(550)
    expect(GATEWAY_RETRY_DEFAULTS.messages).toBe(96)
  })

  it('ImmediateRetry：amplification=true · budgetBoundedness=false · tailAvoidance=false', () => {
    const i = createImmediateRetry({})
    expect(i.amplification).toBe(true)
    expect(i.budgetBoundedness).toBe(false)
    expect(i.tailAvoidance).toBe(false)
    expect(i.invoke([{ id: 'r1' }, { id: 'r2' }]).processed).toBe(2)
  })

  it('FixedBackoff：amplification=false · budgetBoundedness=true · tailAvoidance=false（固定退避·同步 convoy）', () => {
    const f = createFixedBackoff({})
    expect(f.amplification).toBe(false)
    expect(f.budgetBoundedness).toBe(true)
    expect(f.tailAvoidance).toBe(false)
    expect(f.invoke(Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i, attempt: 2 }))).processed).toBe(5)
  })

  it('ExponentialFullJitter：amplification=false · budgetBoundedness=true · tailAvoidance=true', () => {
    const e = createExponentialFullJitter({})
    expect(e.amplification).toBe(false)
    expect(e.budgetBoundedness).toBe(true)
    expect(e.tailAvoidance).toBe(true)
  })

  it('四个场景 cell 全覆盖 · vectors 与 trilemma 同源', () => {
    const s = gatewayRetryStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(GATEWAY_RETRY_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.amplification)}${Number(row.trilemma.budgetBoundedness)}${Number(row.trilemma.tailAvoidance)}`)
    }
  })

  it('默认向量 100/010/011 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = gatewayRetryStudy({ now: () => 550000 })
    expect(s.vectors).toEqual({ ImmediateRetry: '100', FixedBackoff: '010', ExponentialFullJitter: '011' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(550000)
  })

  it('单旗 rigged：freeBudget → ImmediateRetry 100→110', () => {
    const s = gatewayRetryStudy({ freeBudget: true, now: () => 550000 })
    expect(s.vectors.ImmediateRetry).toBe('110')
    expect(s.vectors.FixedBackoff).toBe('010')
    expect(s.vectors.ExponentialFullJitter).toBe('011')
  })

  it('单旗 rigged：freeConvoy → FixedBackoff 010→111', () => {
    const s = gatewayRetryStudy({ freeConvoy: true, now: () => 550000 })
    expect(s.vectors.FixedBackoff).toBe('111')
    expect(s.vectors.ImmediateRetry).toBe('100')
    expect(s.vectors.ExponentialFullJitter).toBe('011')
  })

  it('rigged 三路一起开 → noUniversalWinner=false · distinguishable=true', () => {
    const rig = gatewayRetryStudy({ rigged: true, now: () => 550000 })
    expect(rig.vectors.FixedBackoff).toBe('111')
    expect(rig.vectors.ImmediateRetry).toBe('110')
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.vectorFromTrilemma).toBe(true)
  })

  it('三因果锁全 hold（causalLocksAllHold=true）', () => {
    const r = verifyCausalLocks({ seed: 550 })
    expect(r.immediateSaturationCausallyUnerasable).toBe(true)
    expect(r.fixedBackoffConvoyCausallyUnerasable).toBe(true)
    expect(r.exponentialJitterTailCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifyGatewayRetrySoundness：holds=true / nontrivial=true / falsifiable · 三路篡改真喂回 holds=false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'g:' + i, key: 'vendor-x', attempt: 1, timeout: i % 9 === 0 }))
    const r = verifyGatewayRetrySoundness({ events, seed: 550, messages: 96 }, { seed: 550 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.immediateProcessed).toBe(96)
    expect(r.laneB.jitterProcessed).toBe(96)
    expect(r.tamper.immediateSaturates.holds).toBe(false)
    expect(r.tamper.fixedBackoffSync.holds).toBe(false)
    expect(r.tamper.exponentialTailRate.holds).toBe(false)
  })

  it('空 events → holds=false / nontrivial=false', () => {
    const r = verifyGatewayRetrySoundness({ events: [], seed: 550 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('gatewayRetrySnapshot：快照一致性 + null/{} 返回 null', () => {
    const s = gatewayRetryStudy({ now: () => 550000 })
    const snap = gatewayRetrySnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(gatewayRetrySnapshot(null as never)).toBe(null)
    expect(gatewayRetrySnapshot({} as never)).toBe(null)
  })

  it('createGatewayRetryEvidence：21 个证据键 + 关键 API 真跑过', () => {
    const ev = createGatewayRetryEvidence({ seed: 550, now: () => 550000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.notices).toBe(12)
  })

  it('study.crosscheck.evidence=21 键 + soundness holds + causalLocks allHold', () => {
    const s = gatewayRetryStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('backoffStorm 场景含 downstream-down 标记（下游彻底 down 的雪崩暴露）', () => {
    const s = gatewayRetryStudy({})
    const row = s.rows.find((r) => r.protocol === 'ImmediateRetry')!
    const storm = row.scenarios.find((c) => c.id === 'backoffStorm')!
    expect(storm.fault).toBe('downstream-down')
    expect(storm.processed).toBe(storm.messages)
  })

  it('ExponentialFullJitter 的 rigged 单旗无影响（trilemma 常数正确）', () => {
    const s = gatewayRetryStudy({ freeTail: true, now: () => 550000 })
    expect(s.vectors.ExponentialFullJitter).toBe('011')
    expect(s.vectors.ImmediateRetry).toBe('100')
    expect(s.vectors.FixedBackoff).toBe('010')
  })
})
