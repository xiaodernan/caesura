import { describe, expect, it } from 'vitest'
import {
  SPRING_BUS_DEFAULTS,
  SPRING_BUS_SCENARIOS,
  SPRING_BUS_STRATEGIES,
  createInMemoryLocalBus,
  createRedisPubSubBus,
  createKafkaBrokerBus,
  springBusStudy,
  springBusSnapshot,
  verifyCausalLocks,
  verifySpringBusSoundness,
  createSpringBusEvidence,
} from '../../scripts/caesura-spring-bus.mjs'

/** KI-548 Spring Cloud Bus 事件分发三策略教学件（P8 第五十五件） */

describe('caesura-spring-bus（KI-548）', () => {
  it('默认值/策略/场景 顺序稳定', () => {
    expect(SPRING_BUS_STRATEGIES).toEqual(['InMemoryLocalBus', 'RedisPubSubBus', 'KafkaBrokerBus'])
    expect(SPRING_BUS_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'busRefresh', 'cleanRerun'])
    expect(SPRING_BUS_DEFAULTS.seed).toBe(548)
    expect(SPRING_BUS_DEFAULTS.messages).toBe(96)
  })

  it('InMemoryLocalBus：persistent=false · orderedPerTopic=true · lowOverhead=true', () => {
    const local = createInMemoryLocalBus({})
    expect(local.persistent).toBe(false)
    expect(local.orderedPerTopic).toBe(true)
    expect(local.lowOverhead).toBe(true)
    expect(local.invoke([{ id: 'x' }, { id: 'y' }]).processed).toBe(2)
  })

  it('RedisPubSubBus：persistent=false · orderedPerTopic=false（跨 producer 无全局序）· lowOverhead=true', () => {
    const pub = createRedisPubSubBus({})
    expect(pub.persistent).toBe(false)
    expect(pub.orderedPerTopic).toBe(false)
    expect(pub.lowOverhead).toBe(true)
  })

  it('KafkaBrokerBus：persistent=true · orderedPerTopic=true · lowOverhead=false', () => {
    const kafka = createKafkaBrokerBus({})
    expect(kafka.persistent).toBe(true)
    expect(kafka.orderedPerTopic).toBe(true)
    expect(kafka.lowOverhead).toBe(false)
  })

  it('四个场景 cell 全覆盖 · vectors 与 trilemma 同源', () => {
    const s = springBusStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(SPRING_BUS_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.persistent)}${Number(row.trilemma.orderedPerTopic)}${Number(row.trilemma.lowOverhead)}`)
    }
  })

  it('默认向量 011/001/110 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = springBusStudy({ now: () => 548000 })
    expect(s.vectors).toEqual({ InMemoryLocalBus: '011', RedisPubSubBus: '001', KafkaBrokerBus: '110' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(548000)
  })

  it('单旗 rigged：freePersistent 只坍缩 InMemoryLocalBus（110→111）', () => {
    const s = springBusStudy({ freePersistent: true, now: () => 548000 })
    expect(s.vectors.InMemoryLocalBus).toBe('111')
    expect(s.vectors.KafkaBrokerBus).toBe('110')
    expect(s.vectors.RedisPubSubBus).toBe('001')
  })

  it('单旗 rigged：freeOrder 只坍缩 RedisPubSubBus（001→011）', () => {
    const s = springBusStudy({ freeOrder: true, now: () => 548000 })
    expect(s.vectors.RedisPubSubBus).toBe('011')
    expect(s.vectors.InMemoryLocalBus).toBe('011')
    expect(s.vectors.KafkaBrokerBus).toBe('110')
  })

  it('单旗 rigged：freeOverhead 只坍缩 KafkaBrokerBus（110→111）', () => {
    const s = springBusStudy({ freeOverhead: true, now: () => 548000 })
    expect(s.vectors.KafkaBrokerBus).toBe('111')
    expect(s.vectors.InMemoryLocalBus).toBe('011')
    expect(s.vectors.RedisPubSubBus).toBe('001')
  })

  it('rigged 三路一起开（freePersistent+freeOrder+freeOverhead）→ InMemoryLocalBus/KafkaBrokerBus 111、RedisPubSubBus 011；noUniversalWinner=false', () => {
    const rig = springBusStudy({ rigged: true, now: () => 548000 })
    expect(rig.vectors).toEqual({ InMemoryLocalBus: '111', RedisPubSubBus: '011', KafkaBrokerBus: '111' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.vectorFromTrilemma).toBe(true)
  })

  it('三因果锁全 hold（causalLocksAllHold=true）', () => {
    const r = verifyCausalLocks({ seed: 548 })
    expect(r.inMemoryVolatilityCausallyUnerasable).toBe(true)
    expect(r.redisPubSubNotExactlyCausallyUnerasable).toBe(true)
    expect(r.kafkaPartitionHotKeyCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifySpringBusSoundness：holds=true / nontrivial=true / falsifiable · 三路篡改真喂回 holds=false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'bus:' + i, topic: i % 5 === 0 ? 'config.changed' : 'service.registered', app: 'caesura-gate', seq: i + 1 }))
    const r = verifySpringBusSoundness({ events, seed: 548, messages: 96 }, { seed: 548 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.localDelivered).toBe(96)
    expect(r.laneB.redisDelivered).toBe(96)
    expect(r.laneB.subscribers).toBe(3)
    expect(r.tamper.subscriberStuck.holds).toBe(false)
    expect(r.tamper.pubSubLagging.holds).toBe(false)
    expect(r.tamper.topicSplit.holds).toBe(false)
  })

  it('空 events → holds=false / nontrivial=false（0=0 不可当证明）', () => {
    const r = verifySpringBusSoundness({ events: [], seed: 548 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('springBusSnapshot：快照一致性 + null/{} 返回 null', () => {
    const s = springBusStudy({ now: () => 548000 })
    const snap = springBusSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(springBusSnapshot(null as never)).toBe(null)
    expect(springBusSnapshot({} as never)).toBe(null)
  })

  it('createSpringBusEvidence：21 个证据键 + 关键 API 真跑过', () => {
    const ev = createSpringBusEvidence({ seed: 548, now: () => 548000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.notices).toBe(12)
  })

  it('study.crosscheck.evidence=21 键 + soundness holds + study.causalLocks allHold', () => {
    const s = springBusStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('busRefresh 场景含 reconnect 标记（Pub/Sub 掉队断线可观察）', () => {
    const s = springBusStudy({})
    const row = s.rows.find((r) => r.protocol === 'RedisPubSubBus')!
    const bf = row.scenarios.find((c) => c.id === 'busRefresh')!
    expect(bf.fault).toBe('reconnect-gap')
    expect(bf.processed).toBe(bf.messages)
  })

  it('KafkaBrokerBus 场景含 partition 计数（4 分片，partition 内 FIFO）', () => {
    const k = createKafkaBrokerBus({})
    const out = k.invoke(Array.from({ length: 9 }, (_, i) => ({ id: 'b' + i, seq: i + 1 })))
    expect(out.processed).toBe(9)
    expect(out.partitionCount).toBe(4)
  })
})
