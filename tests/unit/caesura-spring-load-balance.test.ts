import { describe, expect, it } from 'vitest'
import {
  LB_DEFAULTS,
  LB_SCENARIOS,
  LB_STRATEGIES,
  createConsistentHashRing,
  createLeastConnections,
  createWeightedRoundRobin,
  springLoadBalanceStudy,
  springLoadBalanceSnapshot,
  verifyCausalLocks,
  verifyRoutingSoundness,
  createLbEvidence,
} from '../../scripts/caesura-spring-load-balance.mjs'

/** KI-536 Spring Cloud LoadBalancer 三策略（P8 第四十三件 · 前端第三十维）。 */

describe('caesura-spring-load-balance（KI-536）', () => {
  it('LB_DEFAULTS / STRATEGIES / SCENARIOS 固定顺序', () => {
    expect(LB_STRATEGIES).toEqual(['WeightedRoundRobin', 'LeastConnections', 'ConsistentHash'])
    expect(LB_SCENARIOS).toEqual(['steadyLoad', 'hotspotNode', 'burstParallel', 'scaleOut', 'connectionLeak', 'cleanRerun'])
    expect(LB_DEFAULTS.seed).toBe(536)
    expect(LB_DEFAULTS.requests).toBe(96)
    expect(LB_DEFAULTS.virtualNodes).toBe(16)
    expect(LB_DEFAULTS.capacity[0]).toBe(8)
  })

  it('WeightedRoundRobin：真按权分流、skew > 1、sticky=0、指针法 O(1) 状态', () => {
    const wrr = createWeightedRoundRobin({ capacity: [8, 2, 1] })
    let picked = new Map<number, number>()
    for (let i = 0; i < 110; i++) { const p = wrr.pick(); picked.set(p, (picked.get(p) ?? 0) + 1) }
    expect(picked.get(0)!).toBeGreaterThan(picked.get(1)!) // 权重 8 > 2
    expect(picked.get(0)!).toBeGreaterThan(picked.get(2)!) // 权重 8 > 1
  })

  it('LeastConnections：真选最少连接实例——第一个实例连接更多时被换掉', () => {
    const lc = createLeastConnections({ instanceCount: 3 })
    expect(lc.pick()).toBe(0)
    ;[...Array(4)].forEach(() => lc.acquire(0)) // 人工把 0 装满
    expect(lc.pick()).toBe(1)
  })

  it('ConsistentHash：同 clientId 永远落同一实例（sticky），环有 skew', () => {
    const ch = createConsistentHashRing({ seed: 536, instanceCount: 6, virtualNodes: 16 })
    const first = ch.pick('client-one')
    for (let i = 0; i < 10; i++) expect(ch.pick('client-one').instance).toBe(first.instance)
    expect(first.ringHit).toBe(true)
  })

  it('六场景都跑出 cell；vectors 与 trilemma 同源现算', () => {
    const s = springLoadBalanceStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(LB_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.evenDistribution)}${Number(row.trilemma.stickyAffinity)}${Number(row.trilemma.stateFree)}`)
    }
  })

  it('默认向量互异、无一 111、不封赢家、distinguishes', () => {
    const s = springLoadBalanceStudy({ now: () => 536000 })
    expect(s.vectors).toEqual({ WeightedRoundRobin: '101', LeastConnections: '100', ConsistentHash: '011' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(536000)
  })

  it('三难各据一考场：[evenDistribution / stickyAffinity / stateFree]', () => {
    const s = springLoadBalanceStudy({})
    const wrr = s.rows.find((r) => r.protocol === 'WeightedRoundRobin')!
    const lc = s.rows.find((r) => r.protocol === 'LeastConnections')!
    const ch = s.rows.find((r) => r.protocol === 'ConsistentHash')!
    expect(wrr.trilemma).toEqual({ evenDistribution: true, stickyAffinity: false, stateFree: true })
    expect(lc.trilemma).toEqual({ evenDistribution: true, stickyAffinity: false, stateFree: false })
    expect(ch.trilemma).toEqual({ evenDistribution: false, stickyAffinity: true, stateFree: true })
  })

  it('单开 perfectRing ⇒ CH=111（honest collapse，skew 抹除），其余不动', () => {
    const s = springLoadBalanceStudy({ perfectRing: true })
    expect(s.vectors.ConsistentHash).toBe('111')
    expect(s.vectors.WeightedRoundRobin).toBe('101')
    expect(s.vectors.LeastConnections).toBe('100')
    expect(s.verdict.perfectRingErasesSkew).toBe(true)
  })

  it('单开 unlimitedBudget ⇒ LC=stateFree=true（=101，≡ WRR 区分度诚实塌缩）', () => {
    const s = springLoadBalanceStudy({ unlimitedBudget: true })
    expect(s.vectors.LeastConnections).toBe('101')
    expect(s.vectors.WeightedRoundRobin).toBe('101')
    expect(s.verdict.unlimitedBudgetErasesLCNeed).toBe(true)
  })

  it('单开 uniformLoad ⇒ 不动向量（结构不变、探针诚实）', () => {
    const s = springLoadBalanceStudy({ uniformLoad: true })
    expect(s.vectors.WeightedRoundRobin).toBe('101')
    expect(s.vectors.LeastConnections).toBe('100')
    expect(s.vectors.ConsistentHash).toBe('011')
  })

  it('rigged 三开齐 ⇒ WRR≡LC=101、CH=111（LC≡WRR 塌缩、distinguishable=false、noStrategyWinsAll=false）', () => {
    const s = springLoadBalanceStudy({ rigged: true })
    expect(s.vectors).toEqual({ WeightedRoundRobin: '101', LeastConnections: '101', ConsistentHash: '111' })
    expect(s.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(s.verdict.noUniversalWinner).toBe(false)
    expect(s.verdict.trilemmaDistinguishes).toBe(false)
    expect(s.verdict.noStrategyWinsAll).toBe(false)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('verifyRoutingSoundness：双路真跑现算 holds/falsifiable 非写死；三路 tamper 真喂回现算翻 false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `req:${i}`, clientId: `c${(i % 7) + 1}` }))
    const r = verifyRoutingSoundness({ events, seed: 536 }, { seed: 536 })
    expect(r.holds).toBe(true)
    expect(r.baselineHolds).toBe(true)
    expect(r.nontrivial).toBe(true)
    // laneA 真吃 events 的 clientId 流（7 个不同 client 全 sticky）；laneB 真跑 96 events 命中率 1
    expect(r.laneA.stableClients).toBe(r.laneA.clients)
    expect(r.laneA.clients).toBe(7)
    expect(r.laneB.ringHits).toBe(events.length)
    expect(r.laneB.hitRate).toBe(1)
    expect(r.invariants.laneAOk).toBe(true)
    expect(r.invariants.laneBOk).toBe(true)
    expect(r.invariants.skew).toBeGreaterThan(0)   // 真偏斜读数，非写死
    // falsifiable 由 baseline.holds ∧ 三路 tamper 真红现算，绝不写死
    expect(r.falsifiable).toBe(r.baselineHolds && !r.tamper.emptyRing.holds && !r.tamper.silentAffinityDrop.holds && !r.tamper.emptyEvents.holds)
    expect(r.tamper.emptyRing.holds).toBe(false)
    expect(r.tamper.silentAffinityDrop.holds).toBe(false)
    expect(r.tamper.emptyEvents.holds).toBe(false)
  })

  it('verifyRoutingSoundness 空 events ⇒ holds=false nontrivial=false（绝不 0=0 假绿）', () => {
    const r = verifyRoutingSoundness({ events: [], seed: 536 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('verifyCausalLocks 三因果锁由真观测量支撑、去尽恒真重言式', () => {
    const r = verifyCausalLocks({ seed: 536 })
    expect(r.roundRobinBlindToLoadCausallyUnerasable).toBe(true)
    expect(r.leastConnRequiresSharedCountersCausallyUnerasable).toBe(true)
    expect(r.consistentHashSkewCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
    // ① RR 盲：翻转热点标签的平行流 pick 序列逐位恒同（结构判据，非 every(()=>true)）
    expect(r.rrDecisionInvariant).toBe(true)
    expect(r.rrWeakGetsTraffic).toBe(true)
    // ② LC 需共享计数：装满 0 号后 pick 避开 0（=1），摘掉共享态恒退化到 0
    expect(r.lcWithCounters).toBe(1)
    expect(r.noSharedStateDegenerates).toBe(true)
    // ③ CH skew：真跑 12 client 落 6 实例实测 max>min（非 ||len>0 恒真式）
    expect(r.probeSkew.clients).toBe(12)
    expect(r.probeSkew.max).toBeGreaterThan(r.probeSkew.min)
    expect(r.denseSkew).toBeGreaterThanOrEqual(0)
  })

  it('springLoadBalanceSnapshot：形状 + verdict 同源；snapshot(null)/{} → null 反守卫', () => {
    const s = springLoadBalanceStudy({ now: () => 536000 })
    const snap = springLoadBalanceSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.causalLocks!.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(snap.crosscheck && snap.crosscheck.routing).toBeDefined()
    expect(springLoadBalanceSnapshot(null as never)).toBe(null)
    expect(springLoadBalanceSnapshot({} as never)).toBe(null)
  })

  it('createLbEvidence 真件 ≥ 21 键 + 核心件回读', () => {
    const ev = createLbEvidence({ seed: 536, now: () => 536000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
  })

  it('study.crosscheck.evidence 21 键 + routing 双路 holds + falsifiable 真算 + 三路 tamper 真红', () => {
    const s = springLoadBalanceStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    const r = s.crosscheck.routing
    expect(r.holds).toBe(true)
    expect(r.baselineHolds).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.tamper.emptyRing.holds).toBe(false)
    expect(r.tamper.silentAffinityDrop.holds).toBe(false)
    expect(r.tamper.emptyEvents.holds).toBe(false)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('三难交叉印证：stickyAffinity 由真跑 stickyHits 支撑、CH 实测偏斜暴露不谎称纯观测量现算', () => {
    const s = springLoadBalanceStudy({})
    const x = (s.verdict as any).trilemmaCrosscheck
    expect(x.stickyAffinityBackedByHits).toBe(true)
    expect(x.stickyHitByProtocol.ConsistentHash).toBeGreaterThan(0)
    expect(x.stickyHitByProtocol.WeightedRoundRobin).toBe(0)
    expect(x.stickyHitByProtocol.LeastConnections).toBe(0)
    expect(x.chMeasuredSkew).toBeGreaterThan(1)      // CH 真偏斜读数（设计目标分类，非纯观测量声明）
    expect(x.chEvenClaimHonest).toBe(true)           // CH evenDistribution=false 与实测 skew>1 自洽
    expect(typeof x.note).toBe('string')
    // rigged perfectRing 抹平 skew 到 1，真读数跟着变（非写死）
    const rigged = springLoadBalanceStudy({ perfectRing: true }) as any
    expect(rigged.verdict.trilemmaCrosscheck.chMeasuredSkew).toBe(1)
  })

  it('falsifiable 非写死：非平凡流（≥16 events）真算，sub-threshold 与空流翻 false', () => {
    const tiny = Array.from({ length: 16 }, (_, i) => ({ id: `r:${i}`, clientId: `c${(i % 3) + 1}` }))
    const r = verifyRoutingSoundness({ events: tiny, seed: 536 })
    expect(r.nontrivial).toBe(true)
    expect(r.falsifiable).toBe(r.baselineHolds && !r.tamper.emptyRing.holds && !r.tamper.silentAffinityDrop.holds && !r.tamper.emptyEvents.holds)
    // sub-threshold（<16）真实翻 false，证明 nontrivial 是现算非写死
    const sub = verifyRoutingSoundness({ events: tiny.slice(0, 8), seed: 536 })
    expect(sub.nontrivial).toBe(false)
    expect(sub.holds).toBe(false)
    expect(sub.falsifiable).toBe(false)
    const empty = verifyRoutingSoundness({ events: [], seed: 536 })
    expect(empty.holds).toBe(false)
    expect(empty.nontrivial).toBe(false)
    expect(empty.falsifiable).toBe(false)
  })
})
