import { describe, expect, it } from 'vitest'
import {
  REBALANCE_DEFAULTS,
  REBALANCE_SCENARIOS,
  REBALANCE_STRATEGIES,
  createEagerRebalancer,
  createCooperativeStickyRebalancer,
  createStaticMembershipRebalancer,
  consumerRebalanceStudy,
  consumerRebalanceSnapshot,
  verifyCausalLocks,
  verifyRebalanceSoundness,
  createConsumerRebalanceEvidence,
  makeMemberSet,
} from '../../scripts/caesura-consumer-rebalance.mjs'

/** KI-541 消费组再平衡三策略（P8 第四十八件 · 前端第三十五维）。 */

describe('caesura-consumer-rebalance（KI-541）', () => {
  it('REBALANCE_DEFAULTS / STRATEGIES / SCENARIOS 固定顺序', () => {
    expect(REBALANCE_STRATEGIES).toEqual(['Eager', 'CooperativeSticky', 'StaticMembership'])
    expect(REBALANCE_SCENARIOS).toEqual(['cleanSteadyState', 'memberJoin', 'memberLeave', 'memberFlap', 'coldStart', 'cleanRerun'])
    expect(REBALANCE_DEFAULTS.seed).toBe(541)
    expect(REBALANCE_DEFAULTS.partitions).toBe(6)
    expect(REBALANCE_DEFAULTS.members).toBe(3)
  })

  it('makeMemberSet 六种脚本确定性', () => {
    expect(makeMemberSet('cleanSteadyState', { members: 3 })).toEqual(['member-0', 'member-1', 'member-2'])
    expect(makeMemberSet('memberJoin', { members: 3 })).toEqual(['member-0', 'member-1', 'member-2', 'member-3'])
    expect(makeMemberSet('memberLeave', { members: 3 })).toEqual(['member-0', 'member-1'])
    expect(makeMemberSet('memberFlap', { members: 3 })).toEqual(['member-0', 'member-1', 'member-2', 'member-3'])
    expect(makeMemberSet('coldStart', { members: 3 })).toEqual(['member-0', 'member-1', 'member-2'])
    expect(makeMemberSet('cleanRerun', { members: 3 })).toEqual(['member-0', 'member-1', 'member-2'])
  })

  it('AssignPartitions 语义：6 分区确定分配 · 成员都在场', () => {
    const e = createEagerRebalancer({})
    const { assignment } = e.assignAll(['member-0', 'member-1', 'member-2'])
    expect(assignment.size).toBe(6)
    const owners = new Set(assignment.values())
    expect(owners.size).toBe(3)
  })

  it('Eager：memberJoin assignment 完整 + fullStop=1 + 成员变更全量重停', () => {
    const e = createEagerRebalancer({})
    const out = e.assignAll(makeMemberSet('memberJoin', { members: 3 }))
    expect(out.fullStop).toBe(1)
    expect(out.assignment.size).toBe(6)
    expect(out.generation).toBe(1)
    expect(e.zeroStopPause).toBe(false)
  })

  it('CooperativeSticky：embers 保留前值 · 新增成员只拆换公平性逼迫的分区 · Revoked 稳定', () => {
    const prev = new Map([['p0', 'member-0'], ['p1', 'member-1'], ['p2', 'member-2'], ['p3', 'member-0'], ['p4', 'member-1'], ['p5', 'member-2']])
    const c = createCooperativeStickyRebalancer({})
    const out = c.assignIncrement(['member-0', 'member-1', 'member-2', 'member-3'], prev)
    expect(out.assignment.size).toBe(6)
    expect(out.revokedPartitions).toBeGreaterThanOrEqual(1)
    expect(out.conflictWindow).toBeGreaterThanOrEqual(1)
    // 粘性：前 3 分区归属不应变（member-0/1/2 都还在）
    expect(out.assignment.get('p0')).toBe('member-0')
    expect(out.assignment.get('p1')).toBe('member-1')
  })

  it('CooperativeSticky 空成员 ⇒ full assignment 为空 map（不崩）', () => {
    const c = createCooperativeStickyRebalancer({})
    const out = c.assignIncrement([], null)
    expect(out.assignment.size).toBe(0)
    expect(out.revokedPartitions).toBe(0)
  })

  it('StaticMembership：默认 phantom stale=1，zeroSessionTimeout 反事实 ⇒ stale=0', () => {
    const a = createStaticMembershipRebalancer({})
    expect(a.stalePhantoms()).toBe(1)
    const b = createStaticMembershipRebalancer({ zeroSessionTimeout: true })
    expect(b.stalePhantoms()).toBe(0)
  })

  it('六场景都跑出 cell；vectors 与 trilemma 同源现算', () => {
    const s = consumerRebalanceStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(REBALANCE_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.zeroStopPause)}${Number(row.trilemma.simpleProtocol)}${Number(row.trilemma.staleFreeAssignment)}`)
    }
  })

  it('默认向量互异、无一 111、noUniversalWinner distinguishable vectorFromTrilemma noStrategyWinsAll', () => {
    const s = consumerRebalanceStudy({ now: () => 541000 })
    expect(s.vectors).toEqual({ Eager: '011', CooperativeSticky: '101', StaticMembership: '110' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(541000)
  })

  it('三难各据一考场：[zeroStopPause / simpleProtocol / staleFreeAssignment]', () => {
    const s = consumerRebalanceStudy({})
    const e = s.rows.find((r) => r.protocol === 'Eager')!
    const c = s.rows.find((r) => r.protocol === 'CooperativeSticky')!
    const st = s.rows.find((r) => r.protocol === 'StaticMembership')!
    expect(e.trilemma).toEqual({ zeroStopPause: false, simpleProtocol: true, staleFreeAssignment: true })
    expect(c.trilemma).toEqual({ zeroStopPause: true, simpleProtocol: false, staleFreeAssignment: true })
    expect(st.trilemma).toEqual({ zeroStopPause: true, simpleProtocol: true, staleFreeAssignment: false })
  })

  it('单开 zeroIncrementalConflict ⇒ Cooperative simpleProtocol 翻 true（111）', () => {
    const s = consumerRebalanceStudy({ zeroIncrementalConflict: true })
    expect(s.vectors.CooperativeSticky).toBe('111')
    expect(s.verdict.zeroConflictMakesCoopSimple).toBe(true)
  })

  it('单开 zeroSessionTimeout ⇒ Static staleFree 真翻 true（111）', () => {
    const s = consumerRebalanceStudy({ zeroSessionTimeout: true })
    expect(s.vectors.StaticMembership).toBe('111')
    expect(s.verdict.zeroSessionTimeoutMakesStaticStaleFree).toBe(true)
  })

  it('单开 perfectMemberSingleInstance ⇒ Static stale=0（1 成员世界）', () => {
    const s = consumerRebalanceStudy({ members: 1, perfectMemberSingleInstance: true })
    expect(s.verdict.perfectMemberMakesStaticComplete).toBe(true)
  })

  it('rigged 三开齐 ⇒ CooperativeSticky=111 StaticMembership=111 区分度塌缩 collapses 诚实', () => {
    const s = consumerRebalanceStudy({ rigged: true })
    expect(s.vectors.CooperativeSticky).toBe('111')
    expect(s.vectors.StaticMembership).toBe('111')
    expect(s.verdict.noStrategyWinsAll).toBe(false)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('verifyRebalanceSoundness：holds=true nontrivial=true falsifiable；eager fullStop=1；comm revoked=1；static stale=1', () => {
    const events = ['member-0', 'member-1', 'member-2', 'member-3']
    const r = verifyRebalanceSoundness({ events, seed: 541 }, { seed: 541, partitions: 6, members: 3 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneB.eagerFullStops).toBe(1)
    expect(r.laneB.cooperativeRevoked).toBeGreaterThanOrEqual(1)
    expect(r.laneB.staticStaleMembers).toBe(1)
    expect(r.falsifiable).toBe(true)
    expect(r.tamper.memberLeak.holds).toBe(false)
    expect(r.tamper.staleAssignment.holds).toBe(false)
    expect(r.tamper.emptyMembership.holds).toBe(false)
  })

  it('verifyRebalanceSoundness 空 events ⇒ holds=false nontrivial=false', () => {
    const r = verifyRebalanceSoundness({ events: [], seed: 541 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('verifyCausalLocks 三因果锁 allHold', () => {
    const r = verifyCausalLocks({ seed: 541 })
    expect(r.eagerPauseCausallyUnerasable).toBe(true)
    expect(r.cooperativeIncrementalComplexityCausallyUnerasable).toBe(true)
    expect(r.staticSessionTimeoutCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
    expect(r.probes).toBeDefined()
  })

  it('consumerRebalanceSnapshot：形状 + verdict 同源；snapshot(null)/{} → null 反守卫', () => {
    const s = consumerRebalanceStudy({ now: () => 541000 })
    const snap = consumerRebalanceSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.causalLocks!.causalLocksAllHold).toBe(true)
    expect(consumerRebalanceSnapshot(null as never)).toBe(null)
    expect(consumerRebalanceSnapshot({} as never)).toBe(null)
  })

  it('createConsumerRebalanceEvidence 真件 ≥ 21 键 + 核心件回读', () => {
    const ev = createConsumerRebalanceEvidence({ seed: 541, now: () => 541000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness 结构 holds', () => {
    const s = consumerRebalanceStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
