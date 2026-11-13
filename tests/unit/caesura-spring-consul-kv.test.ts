import { describe, expect, it } from 'vitest'
import {
  CONSUL_KV_DEFAULTS,
  CONSUL_KV_SCENARIOS,
  CONSUL_KV_STRATEGIES,
  createPollingRead,
  createBlockingQuery,
  createSessionLockKV,
  springConsulStudy,
  springConsulSnapshot,
  verifyCausalLocks,
  verifySpringConsulSoundness,
  createSpringConsulEvidence,
} from '../../scripts/caesura-spring-consul-kv.mjs'

/** KI-551 Spring Cloud Consul KV 三策略教学件（P8 第五十八件） */

describe('caesura-spring-consul-kv（KI-551）', () => {
  it('默认值/策略/场景 顺序稳定', () => {
    expect(CONSUL_KV_STRATEGIES).toEqual(['PollingRead', 'BlockingQuery', 'SessionLockKV'])
    expect(CONSUL_KV_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'leaderChange', 'cleanRerun'])
    expect(CONSUL_KV_DEFAULTS.seed).toBe(551)
    expect(CONSUL_KV_DEFAULTS.messages).toBe(96)
  })

  it('PollingRead：strongConsistency=false · hotReloadEvents=false · sessionState=true', () => {
    const p = createPollingRead({})
    expect(p.strongConsistency).toBe(false)
    expect(p.hotReloadEvents).toBe(false)
    expect(p.sessionState).toBe(true)
    expect(p.invoke([{ id: 'x', raftIndex: 7 }, { id: 'y', raftIndex: 9 }]).processed).toBe(2)
  })

  it('BlockingQuery：strongConsistency=true · hotReloadEvents=true · sessionState=false（leader sequence blocking）', () => {
    const bq = createBlockingQuery({})
    expect(bq.strongConsistency).toBe(true)
    expect(bq.hotReloadEvents).toBe(true)
    expect(bq.sessionState).toBe(false)
  })

  it('SessionLockKV：strongConsistency=true · hotReloadEvents=false · sessionState=true（Raft KV + session 锁）', () => {
    const sl = createSessionLockKV({})
    expect(sl.strongConsistency).toBe(true)
    expect(sl.hotReloadEvents).toBe(false)
    expect(sl.sessionState).toBe(true)
    expect(sl.invoke([{ id: 'a' }]).processed).toBe(1)
  })

  it('四个场景 cell 全覆盖 · vectors 与 trilemma 同源', () => {
    const s = springConsulStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(CONSUL_KV_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.strongConsistency)}${Number(row.trilemma.hotReloadEvents)}${Number(row.trilemma.sessionState)}`)
    }
  })

  it('默认向量 001/110/101 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = springConsulStudy({ now: () => 551000 })
    expect(s.vectors).toEqual({ PollingRead: '001', BlockingQuery: '110', SessionLockKV: '101' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(551000)
  })

  it('单旗 rigged：freeStrong → PollingRead 001→101', () => {
    const s = springConsulStudy({ freeStrong: true, now: () => 551000 })
    expect(s.vectors.PollingRead).toBe('101')
    expect(s.vectors.BlockingQuery).toBe('110')
    expect(s.vectors.SessionLockKV).toBe('101')
  })

  it('单旗 rigged：freeReload → SessionLockKV 101→111', () => {
    const s = springConsulStudy({ freeReload: true, now: () => 551000 })
    expect(s.vectors.SessionLockKV).toBe('111')
    expect(s.vectors.PollingRead).toBe('001')
    expect(s.vectors.BlockingQuery).toBe('110')
  })

  it('rigged 三路一起开 → SessionLockKV=111 · noUniversalWinner=false · vectorFromTrilemma=true', () => {
    const rig = springConsulStudy({ rigged: true, now: () => 551000 })
    expect(rig.vectors).toEqual({ PollingRead: '101', BlockingQuery: '110', SessionLockKV: '111' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.vectorFromTrilemma).toBe(true)
  })

  it('三因果锁全 hold（causalLocksAllHold=true）', () => {
    const r = verifyCausalLocks({ seed: 551 })
    expect(r.consulPollingCausallyUnerasable).toBe(true)
    expect(r.consulSessionCausallyUnerasable).toBe(true)
    expect(r.consulRaftCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifySpringConsulSoundness：holds=true / nontrivial=true / falsifiable · 三路篡改真喂回 holds=false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'c:' + i, op: 'kv-set', key: 'app/config/v1', raftIndex: i + 1 }))
    const r = verifySpringConsulSoundness({ events, seed: 551, messages: 96 }, { seed: 551 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.pollingProcessed).toBe(96)
    expect(r.laneB.sessionProcessed).toBe(96)
    expect(r.tamper.staleIndex.holds).toBe(false)
    expect(r.tamper.sessionExpired.holds).toBe(false)
    expect(r.tamper.raftPartition.holds).toBe(false)
  })

  it('空 events → holds=false / nontrivial=false', () => {
    const r = verifySpringConsulSoundness({ events: [], seed: 551 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('springConsulSnapshot：快照一致性 + null/{} 返回 null', () => {
    const s = springConsulStudy({ now: () => 551000 })
    const snap = springConsulSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(springConsulSnapshot(null as never)).toBe(null)
    expect(springConsulSnapshot({} as never)).toBe(null)
  })

  it('createSpringConsulEvidence：21 个证据键 + 关键 API 真跑过', () => {
    const ev = createSpringConsulEvidence({ seed: 551, now: () => 551000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.notices).toBe(12)
    expect(ev.counterSum).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence=21 键 + soundness holds + causalLocks allHold', () => {
    const s = springConsulStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('leaderChange 场景含 raft-resettle 标记（leader 变更 index 倒退可观察）', () => {
    const s = springConsulStudy({})
    const row = s.rows.find((r) => r.protocol === 'BlockingQuery')!
    const lb = row.scenarios.find((c) => c.id === 'leaderChange')!
    expect(lb.fault).toBe('raft-resettle')
    expect(lb.processed).toBe(lb.messages)
  })

  it('rigged 旗标 freeSession 不参与 tilemma 冲突消解：SessionLockKV 保持 101', () => {
    const s = springConsulStudy({ freeSession: true, now: () => 551000 })
    expect(s.vectors.SessionLockKV).toBe('101')
    expect(s.vectors.PollingRead).toBe('001')
  })
})
