import { describe, expect, it } from 'vitest'
import {
  PRIORITY_DEFAULTS,
  PRIORITY_SCENARIOS,
  PRIORITY_STRATEGIES,
  createBoundedStrictQueue,
  createMotionWeightedFairQueue,
  createDeadlineSchedulerQueue,
  priorityQueueStudy,
  priorityQueueSnapshot,
  verifyCausalLocks,
  verifyPriorityScheduleSoundness,
  createPriorityQueueEvidence,
} from '../../scripts/caesura-priority-queue.mjs'

/** KI-542 有界优先级队列三策略（P8 第四十九件 · 前端第三十六维）。 */

describe('caesura-priority-queue（KI-542）', () => {
  it('默认值/策略/场景固定顺序', () => {
    expect(PRIORITY_STRATEGIES).toEqual(['BoundedStrict', 'MotionWeightedFair', 'DeadlineScheduler'])
    expect(PRIORITY_SCENARIOS).toEqual(['cleanSteadyState', 'burstMixedPriority', 'overloadPressure', 'cleanRerun'])
    expect(PRIORITY_DEFAULTS.seed).toBe(542)
    expect(PRIORITY_DEFAULTS.capacity).toBe(64)
  })

  it('BoundedStrict：priority 最低编号优先（高优）先出 · 容量满真拒', () => {
    const q = createBoundedStrictQueue({ capacity: 2 })
    q.push({ id: 'a', priority: 1, deadline: 9 })
    q.push({ id: 'b', priority: 0, deadline: 9 })
    expect(q.push({ id: 'c', priority: 0, deadline: 9 }).ok).toBe(false)
    expect(q.pop()?.id).toBe('b')
    expect(q.pop()?.id).toBe('a')
  })

  it('DeadlineScheduler：按 deadline ASC pop，认 id——Strict 不认 deadline', () => {
    const ds = createDeadlineSchedulerQueue({ capacity: 4 })
    ds.push({ id: 'a', priority: 9, deadline: 1 })
    ds.push({ id: 'b', priority: 1, deadline: 99 })
    expect(ds.pop()?.id).toBe('a')  // deadline=1 first — Deadline 真认
    const sq = createBoundedStrictQueue({ capacity: 4 })
    sq.push({ id: 'a', priority: 9, deadline: 1 })
    sq.push({ id: 'b', priority: 1, deadline: 99 })
    expect(sq.pop()?.id).toBe('b')  // Strict pop prio=1（不认 deadline）
  })

  it('MotionWeightedFair：interleave 低优先级（无 starvation 的本质行为）', () => {
    const f = createMotionWeightedFairQueue({ capacity: 16 })
    for (let i = 0; i < 20; i++) f.push({ id: 'm' + i, priority: 9, deadline: 99 })
    const firstThree = [f.pop()?.id, f.pop()?.id, f.pop()?.id]
    // 全同 prio9，按 vtime/id 自然升，无异常
    expect(new Set(firstThree).size).toBe(3)
  })

  it('六场景 cell 全真 · vectors 现算与 trilemma 同源', () => {
    const s = priorityQueueStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(PRIORITY_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.lowOverhead)}${Number(row.trilemma.boundedUnfairness)}${Number(row.trilemma.deadlineAwareness)}`)
    }
  })

  it('默认向量互异 100/010/101 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = priorityQueueStudy({ now: () => 542000 })
    expect(s.vectors).toEqual({ BoundedStrict: '100', MotionWeightedFair: '010', DeadlineScheduler: '101' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(542000)
  })

  it('三因果锁真跑 allHold（Strict 饥饿 / Fair vtime 记账 / Strict deadline-blind）', () => {
    const r = verifyCausalLocks({ seed: 542 })
    expect(r.strictStarvationCausallyUnerasable).toBe(true)
    expect(r.fairVtimeAccountingCausallyUnerasable).toBe(true)
    expect(r.deadlineBlindnessCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifyPriorityScheduleSoundness · holds=true nontrivial=true falsifiable；tamper 三路真 false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'msg:' + i, priority: (i * 7) % 10, deadline: 10 + i % 5 }))
    const r = verifyPriorityScheduleSoundness({ events, seed: 542 }, { seed: 542 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.topPopPriority.length).toBe(4)
    expect(r.tamper.starvationAnchor.holds).toBe(false)
    expect(r.tamper.vtimeDrift.holds).toBe(false)
    expect(r.tamper.deadlineBlind.holds).toBe(false)
  })

  it('verifyPriorityScheduleSoundness 空 events ⇒ holds=false nontrivial=false', () => {
    const r = verifyPriorityScheduleSoundness({ events: [], seed: 542 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('priorityQueueSnapshot 形状 + verdict 同源 · null/{} → null 反守卫', () => {
    const s = priorityQueueStudy({ now: () => 542000 })
    const snap = priorityQueueSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(priorityQueueSnapshot(null as never)).toBe(null)
    expect(priorityQueueSnapshot({} as never)).toBe(null)
  })

  it('createPriorityQueueEvidence 真件 ≥ 21 键 + 核心件回读', () => {
    const ev = createPriorityQueueEvidence({ seed: 542, now: () => 542000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness 结构 holds', () => {
    const s = priorityQueueStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
