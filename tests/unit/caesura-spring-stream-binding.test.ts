import { describe, expect, it } from 'vitest'
import {
  SPRING_STREAM_DEFAULTS,
  SPRING_STREAM_SCENARIOS,
  SPRING_STREAM_STRATEGIES,
  createExclusiveConsumer,
  createSharedConsumer,
  createClusteredConsumer,
  springStreamBindingStudy,
  springStreamBindingSnapshot,
  verifyCausalLocks,
  verifySpringStreamBindingSoundness,
  createSpringStreamBindingEvidence,
} from '../../scripts/caesura-spring-stream-binding.mjs'

/** KI-545 Spring Cloud Stream 绑定三策略（P8 第五十二件 · Spring Cloud Stream）。 */

describe('caesura-spring-stream-binding（KI-545）', () => {
  it('SPRING_STREAM_DEFAULTS / STRATEGIES / SCENARIOS 固定顺序', () => {
    expect(SPRING_STREAM_STRATEGIES).toEqual(['ExclusiveConsumer', 'SharedConsumer', 'ClusteredConsumer'])
    expect(SPRING_STREAM_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'exclusiveRebalance', 'cleanRerun'])
    expect(SPRING_STREAM_DEFAULTS.seed).toBe(545)
    expect(SPRING_STREAM_DEFAULTS.messages).toBe(96)
  })

  it('ExclusiveConsumer：同 topic 真只处理 once', () => {
    const ex = createExclusiveConsumer({})
    const stream = [{ id: 'x1' }, { id: 'x2' }]
    ex.consume(stream, 'node-a')
    const second = ex.consume(stream, 'node-a')
    expect(second.processed).toBe(0)
  })

  it('SharedConsumer：每次 consume 真重复（at-least-once duplicates）', () => {
    const sh = createSharedConsumer({})
    const out = sh.consume([{ id: 'x1' }], [{ name: 's' }])
    expect(out.duplicates).toBe(1)
    expect(out.accepted).toBe(1)
  })

  it('ClusteredConsumer：确认 topic·leg-at-a-time match', () => {
    const cc = createClusteredConsumer({})
    const out = cc.consume(Array.from({ length: 4 }, (_, i) => ({ id: 'x' + i })))
    expect(out.confirmed).toBe(4)
    expect(out.ackRpcs).toBe(1)
  })

  it('四场景 cell 全真 · vectors 现算与 trilemma 同源', () => {
    const s = springStreamBindingStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(SPRING_STREAM_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.lowLatency)}${Number(row.trilemma.burstFriendly)}${Number(row.trilemma.exactlyOnce)}`)
    }
  })

  it('默认向量互异 101/010/011 · noUniversalWinner distinguishable vectorFromTrilemma', () => {
    const s = springStreamBindingStudy({ now: () => 545000 })
    expect(s.vectors).toEqual({ ExclusiveConsumer: '101', SharedConsumer: '010', ClusteredConsumer: '011' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(545000)
  })

  it('三因果锁 allHold', () => {
    const r = verifyCausalLocks({ seed: 545 })
    expect(r.exclusiveLockCausallyUnerasable).toBe(true)
    expect(r.sharedThroughputCausallyUnerasable).toBe(true)
    expect(r.clusterAckCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifySpringStreamBindingSoundness · holds=true nontrivial=true falsifiable · 三路篡改 false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'm:' + i, topic: 't:' + (i % 3), offset: i % 16 }))
    const r = verifySpringStreamBindingSoundness({ events, seed: 545, messages: 96 }, { seed: 545 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.exclusiveProcessed).toBe(96)
    expect(r.laneB.duplicates).toBe(96)
    expect(r.tamper.exclusiveLockGrab.holds).toBe(false)
    expect(r.tamper.sharedAckLost.holds).toBe(false)
    expect(r.tamper.clusterRpcDrop.holds).toBe(false)
  })

  it('空 events ⇒ holds=false nontrivial=false', () => {
    const r = verifySpringStreamBindingSoundness({ events: [], seed: 545 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('springStreamBindingSnapshot 形状 + null/{} → null 反守卫', () => {
    const s = springStreamBindingStudy({ now: () => 545000 })
    const snap = springStreamBindingSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(springStreamBindingSnapshot(null as never)).toBe(null)
    expect(springStreamBindingSnapshot({} as never)).toBe(null)
  })

  it('createSpringStreamBindingEvidence ≥ 21 键 + 核心件回读', () => {
    const ev = createSpringStreamBindingEvidence({ seed: 545, now: () => 545000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness；study.causalLocks allHold', () => {
    const s = springStreamBindingStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
