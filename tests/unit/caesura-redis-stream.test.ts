import { describe, expect, it } from 'vitest'
import {
  REDIS_STREAM_DEFAULTS,
  REDIS_STREAM_SCENARIOS,
  REDIS_STREAM_STRATEGIES,
  createPubSub,
  createPersistentQueue,
  createStreamLog,
  redisStreamStudy,
  redisStreamSnapshot,
  verifyCausalLocks,
  verifyRedisStreamSoundness,
  createRedisStreamEvidence,
} from '../../scripts/caesura-redis-stream.mjs'

/** KI-553 Redis Stream 三策略教学件（P8 第六十件） */

describe('caesura-redis-stream（KI-553）', () => {
  it('默认值/策略/场景 顺序稳定', () => {
    expect(REDIS_STREAM_STRATEGIES).toEqual(['PubSub', 'PersistentQueue', 'StreamLog'])
    expect(REDIS_STREAM_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'consumerDisaster', 'cleanRerun'])
    expect(REDIS_STREAM_DEFAULTS.seed).toBe(553)
    expect(REDIS_STREAM_DEFAULTS.messages).toBe(96)
  })

  it('PubSub：durable=false · fanout=true · replayable=false（fire-and-forget）', () => {
    const p = createPubSub({})
    expect(p.durable).toBe(false)
    expect(p.fanout).toBe(true)
    expect(p.replayable).toBe(false)
    expect(p.invoke([{ id: 'x' }, { id: 'y' }]).processed).toBe(2)
  })

  it('PersistentQueue：durable=true · fanout=false · replayable=false（RPUSH+BLPOP 无 ack）', () => {
    const pq = createPersistentQueue({})
    expect(pq.durable).toBe(true)
    expect(pq.fanout).toBe(false)
    expect(pq.replayable).toBe(false)
    expect(pq.invoke(Array.from({ length: 5 }, (_, i) => ({ id: 'q' + i }))).processed).toBe(5)
  })

  it('StreamLog：durable=true · fanout=true · replayable=false（XREADGROUP+XACK；XRANGE 重读）', () => {
    const sl = createStreamLog({})
    expect(sl.durable).toBe(true)
    expect(sl.fanout).toBe(true)
    expect(sl.replayable).toBe(false)
    expect(sl.invoke(Array.from({ length: 5 }, (_, i) => ({ id: 's' + i, entry: i + 1 }))).processed).toBe(5)
  })

  it('四个场景 cell 全覆盖 · vectors 与 trilemma 同源', () => {
    const s = redisStreamStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(REDIS_STREAM_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.durable)}${Number(row.trilemma.fanout)}${Number(row.trilemma.replayable)}`)
    }
  })

  it('默认向量 010/100/110 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = redisStreamStudy({ now: () => 553000 })
    expect(s.vectors).toEqual({ PubSub: '010', PersistentQueue: '100', StreamLog: '110' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(553000)
  })

  it('单旗 rigged：freeDurability → PubSub 010→110', () => {
    const s = redisStreamStudy({ freeDurability: true, now: () => 553000 })
    expect(s.vectors.PubSub).toBe('110')
    expect(s.vectors.PersistentQueue).toBe('100')
    expect(s.vectors.StreamLog).toBe('110')
  })

  it('单旗 rigged：freeCap → StreamLog 110→111', () => {
    const s = redisStreamStudy({ freeCap: true, now: () => 553000 })
    expect(s.vectors.StreamLog).toBe('111')
    expect(s.vectors.PubSub).toBe('010')
    expect(s.vectors.PersistentQueue).toBe('100')
  })

  it('单旗 rigged：freeReplay → PersistentQueue 100→101', () => {
    const s = redisStreamStudy({ freeReplay: true, now: () => 553000 })
    expect(s.vectors.PersistentQueue).toBe('101')
    expect(s.vectors.PubSub).toBe('010')
    expect(s.vectors.StreamLog).toBe('110')
  })

  it('rigged 三路一起开 → 111/111/111 · noUniversalWinner=false', () => {
    const rig = redisStreamStudy({ rigged: true, now: () => 553000 })
    expect(rig.vectors).toEqual({ PubSub: '110', PersistentQueue: '101', StreamLog: '111' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.vectorFromTrilemma).toBe(true)
  })

  it('三因果锁全 hold（causalLocksAllHold=true）', () => {
    const r = verifyCausalLocks({ seed: 553 })
    expect(r.pubSubEphemeralCausallyUnerasable).toBe(true)
    expect(r.listNoAckCausallyUnerasable).toBe(true)
    expect(r.streamEntryCapCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifyRedisStreamSoundness：holds=true / nontrivial=true / falsifiable · 三路篡改真喂回 holds=false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'r:' + i, op: 'xadd', key: `stream:group:${i % 4}`, entry: i + 1 }))
    const r = verifyRedisStreamSoundness({ events, seed: 553, messages: 96 }, { seed: 553 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.persistentQueueProcessed).toBe(96)
    expect(r.laneB.streamProcessed).toBe(96)
    expect(r.tamper.pubSubNotDurable.holds).toBe(false)
    expect(r.tamper.listNoXackFlow.holds).toBe(false)
    expect(r.tamper.streamCapDiscard.holds).toBe(false)
  })

  it('空 events → holds=false / nontrivial=false', () => {
    const r = verifyRedisStreamSoundness({ events: [], seed: 553 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('redisStreamSnapshot：快照一致性 + null/{} 返回 null', () => {
    const s = redisStreamStudy({ now: () => 553000 })
    const snap = redisStreamSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(redisStreamSnapshot(null as never)).toBe(null)
    expect(redisStreamSnapshot({} as never)).toBe(null)
  })

  it('createRedisStreamEvidence：21 个证据键 + 关键 API 真跑过', () => {
    const ev = createRedisStreamEvidence({ seed: 553, now: () => 553000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.notices).toBe(12)
    expect(ev.counterSum).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence=21 键 + soundness holds + causalLocks allHold', () => {
    const s = redisStreamStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('consumerDisaster 场景含 xack-unacked-pending 标记（XACK 未完成 XPENDING 积压）', () => {
    const s = redisStreamStudy({})
    const row = s.rows.find((r) => r.protocol === 'StreamLog')!
    const cd = row.scenarios.find((c) => c.id === 'consumerDisaster')!
    expect(cd.fault).toBe('xack-unacked-pending')
    expect(cd.processed).toBe(cd.messages)
  })

  it('PersistentQueue 的 rigged 单旗不影响 StreamLog 向量（stream 永远不是 replayable 的，capability flag 独立）', () => {
    const s = redisStreamStudy({ freeReplay: true, now: () => 553000 })
    expect(s.vectors.StreamLog).toBe('110')
    expect(s.vectors.PubSub).toBe('010')
  })
})
