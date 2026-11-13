import { describe, expect, it } from 'vitest'
import {
  REDIS_HA_DEFAULTS,
  REDIS_HA_SCENARIOS,
  REDIS_HA_STRATEGIES,
  createSentinel,
  createSyncPair,
  createCluster,
  redisHaStudy,
  redisHaSnapshot,
  verifyCausalLocks,
  verifyRedisHaSoundness,
  createRedisHaEvidence,
} from '../../scripts/caesura-redis-ha.mjs'

/** KI-552 Redis 高可用三策略教学件（P8 第五十九件） */

describe('caesura-redis-ha（KI-552）', () => {
  it('默认值/策略/场景 顺序稳定', () => {
    expect(REDIS_HA_STRATEGIES).toEqual(['Sentinel', 'SyncPair', 'Cluster'])
    expect(REDIS_HA_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'leaderChange', 'cleanRerun'])
    expect(REDIS_HA_DEFAULTS.seed).toBe(552)
    expect(REDIS_HA_DEFAULTS.messages).toBe(96)
  })

  it('Sentinel：autoFailover=true · zeroRpo=false · dataSharding=false', () => {
    const s = createSentinel({})
    expect(s.autoFailover).toBe(true)
    expect(s.zeroRpo).toBe(false)
    expect(s.dataSharding).toBe(false)
    expect(s.invoke([{ id: 'x' }, { id: 'y' }]).processed).toBe(2)
  })

  it('SyncPair：autoFailover=false · zeroRpo=true · dataSharding=false（WAIT ack 阻塞）', () => {
    const sp = createSyncPair({})
    expect(sp.autoFailover).toBe(false)
    expect(sp.zeroRpo).toBe(true)
    expect(sp.dataSharding).toBe(false)
    expect(sp.invoke(Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i }))).processed).toBe(5)
  })

  it('Cluster：autoFailover=true · zeroRpo=false · dataSharding=true（16384 slot 算法分片）', () => {
    const c = createCluster({})
    expect(c.autoFailover).toBe(true)
    expect(c.zeroRpo).toBe(false)
    expect(c.dataSharding).toBe(true)
    expect(c.invoke(Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i, slot: i }))).processed).toBe(9)
  })

  it('四个场景 cell 全覆盖 · vectors 与 trilemma 同源', () => {
    const s = redisHaStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(REDIS_HA_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.autoFailover)}${Number(row.trilemma.zeroRpo)}${Number(row.trilemma.dataSharding)}`)
    }
  })

  it('默认向量 100/010/101 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = redisHaStudy({ now: () => 552000 })
    expect(s.vectors).toEqual({ Sentinel: '100', SyncPair: '010', Cluster: '101' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(552000)
  })

  it('单旗 rigged：freeFailover → Sentinel 0→1（autoFailover 始终 true）', () => {
    const s = redisHaStudy({ freeFailover: true, now: () => 552000 })
    expect(s.vectors.Sentinel).toBe('110')
    expect(s.vectors.SyncPair).toBe('010')
    expect(s.vectors.Cluster).toBe('101')
  })

  it('单旗 rigged：freeRpo → SyncPair 010→110', () => {
    const s = redisHaStudy({ freeRpo: true, now: () => 552000 })
    expect(s.vectors.SyncPair).toBe('110')
    expect(s.vectors.Sentinel).toBe('100')
    expect(s.vectors.Cluster).toBe('101')
  })

  it('单旗 rigged：freeSharding → Cluster 101→111', () => {
    const s = redisHaStudy({ freeSharding: true, now: () => 552000 })
    expect(s.vectors.Cluster).toBe('111')
    expect(s.vectors.Sentinel).toBe('100')
    expect(s.vectors.SyncPair).toBe('010')
  })

  it('rigged 三路一起开 → 110/110/111 · noUniversalWinner=false · vectorFromTrilemma=true', () => {
    const rig = redisHaStudy({ rigged: true, now: () => 552000 })
    expect(rig.vectors).toEqual({ Sentinel: '110', SyncPair: '110', Cluster: '111' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.vectorFromTrilemma).toBe(true)
  })

  it('三因果锁全 hold（causalLocksAllHold=true）', () => {
    const r = verifyCausalLocks({ seed: 552 })
    expect(r.sentinelRpoCausallyUnerasable).toBe(true)
    expect(r.syncWriteCausallyUnerasable).toBe(true)
    expect(r.clusterCrossSlotCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifyRedisHaSoundness：holds=true / nontrivial=true / falsifiable · 三路篡改真喂回 holds=false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'h:' + i, op: 'set', key: 'ha:tenant:' + (i % 4), slot: i % 4 }))
    const r = verifyRedisHaSoundness({ events, seed: 552, messages: 96 }, { seed: 552 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.sentinelProcessed).toBe(96)
    expect(r.laneB.syncPairProcessed).toBe(96)
    expect(r.tamper.sentinelQuorumFlaky.holds).toBe(false)
    expect(r.tamper.syncWriteStall.holds).toBe(false)
    expect(r.tamper.clusterCrossSlotRegress.holds).toBe(false)
  })

  it('空 events → holds=false / nontrivial=false', () => {
    const r = verifyRedisHaSoundness({ events: [], seed: 552 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('redisHaSnapshot：快照一致性 + null/{} 返回 null', () => {
    const s = redisHaStudy({ now: () => 552000 })
    const snap = redisHaSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(redisHaSnapshot(null as never)).toBe(null)
    expect(redisHaSnapshot({} as never)).toBe(null)
  })

  it('createRedisHaEvidence：21 个证据键 + 关键 API 真跑过', () => {
    const ev = createRedisHaEvidence({ seed: 552, now: () => 552000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.notices).toBe(12)
    expect(ev.counterSum).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence=21 键 + soundness holds + causalLocks allHold', () => {
    const s = redisHaStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('leaderChange 场景含 raft-resettle 标记（leader 变更 index 倒退可观察）', () => {
    const s = redisHaStudy({})
    const row = s.rows.find((r) => r.protocol === 'Sentinel')!
    const lc = row.scenarios.find((c) => c.id === 'leaderChange')!
    expect(lc.fault).toBe('raft-resettle')
    expect(lc.processed).toBe(lc.messages)
  })

  it('SyncPair 空 slot Sharding 向量固定为 010 · Cluster 向量固定为 101', () => {
    const s = redisHaStudy({ now: () => 552000 })
    expect(s.vectors.SyncPair).toBe('010')
    expect(s.vectors.Cluster).toBe('101')
  })
})
