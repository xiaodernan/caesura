import { describe, expect, it } from 'vitest'
import {
  CDC_JOIN_DEFAULTS,
  CDC_JOIN_SCENARIOS,
  CDC_JOIN_STRATEGIES,
  createLsmSnapshotJoin,
  createRawBinlogJoin,
  createOutboxAtomicJoin,
  cdcOutboxJoinStudy,
  cdcOutboxJoinSnapshot,
  verifyCausalLocks,
  verifyCdcOutboxJoinSoundness,
  createCdcOutboxJoinEvidence,
} from '../../scripts/caesura-cdc-outbox-join.mjs'

/** KI-544 CDC outbox join 三策略（P8 第五十一件 · 前端第三十八维）。 */

describe('caesura-cdc-outbox-join（KI-544）', () => {
  it('默认值/策略/场景固定顺序', () => {
    expect(CDC_JOIN_STRATEGIES).toEqual(['LsmSnapshotJoin', 'RawBinlogJoin', 'OutboxAtomicJoin'])
    expect(CDC_JOIN_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'orderBeforeShip', 'cleanRerun'])
    expect(CDC_JOIN_DEFAULTS.seed).toBe(544)
    expect(CDC_JOIN_DEFAULTS.interval).toBe(4)
  })

  it('LsmSnapshotJoin：Set 真 join·snapshotConsistent', () => {
    const j = createLsmSnapshotJoin({ interval: 4 })
    expect(j.snapshotConsistent).toBe(true)
    const orders = Array.from({ length: 16 }, (_, i) => ({ id: `o:${i}`, orderId: `o:${i % 4}` }))
    const shipments = orders.map((o) => ({ id: `s:${o.id}`, orderId: o.orderId }))
    expect(j.join(orders, shipments).joins).toBe(16)
  })

  it('RawBinlogJoin：fullScan 真扫·zeroDowntime=true', () => {
    const rb = createRawBinlogJoin({})
    expect(rb.zeroDowntime).toBe(true)
    expect(rb.snapshotConsistent).toBe(false)
    expect(rb.rendezvousCapable).toBe(true)
  })

  it('OutboxAtomicJoin：snapshotConsistent=true，rendezvousCapable=false', () => {
    const ob = createOutboxAtomicJoin({})
    expect(ob.snapshotConsistent).toBe(true)
    expect(ob.rendezvousCapable).toBe(false)
  })

  it('四场景 cell 全真 · vectors 现算与 trilemma 同源', () => {
    const s = cdcOutboxJoinStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(CDC_JOIN_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.snapshotConsistent)}${Number(row.trilemma.zeroDowntime)}${Number(row.trilemma.rendezvousCapable)}`)
    }
  })

  it('默认向量互异 101/011/100 · noUniversalWinner distinguishable vectorFromTrilemma noStrategyWinsAll', () => {
    const s = cdcOutboxJoinStudy({ now: () => 544000 })
    expect(s.vectors).toEqual({ LsmSnapshotJoin: '101', RawBinlogJoin: '011', OutboxAtomicJoin: '100' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(544000)
  })

  it('三因果锁 allHold', () => {
    const r = verifyCausalLocks({ seed: 544 })
    expect(r.snapshotCommitWindowCausallyUnerasable).toBe(true)
    expect(r.binlogBorderlineCausallyUnerasable).toBe(true)
    expect(r.outboxLockCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifyCdcOutboxJoinSoundness · holds=true nontrivial=true falsifiable · 三路篡改 false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `o:${i}`, orderId: `o:${i % 24}`, paid: true }))
    const r = verifyCdcOutboxJoinSoundness({ events, seed: 544, messages: 96 }, { seed: 544 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.snapshotJoins).toBeGreaterThan(0)
    expect(r.laneB.binlogJoins).toBeGreaterThan(0)
    expect(r.tamper.snapshotMismatched.holds).toBe(false)
    expect(r.tamper.binlogMiss.holds).toBe(false)
    expect(r.tamper.atomicLatchLeak.holds).toBe(false)
  })

  it('空 events ⇒ holds=false 不等同 trivial', () => {
    const r = verifyCdcOutboxJoinSoundness({ events: [], seed: 544 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('cdcOutboxJoinSnapshot 形状 + null/{} → null', () => {
    const s = cdcOutboxJoinStudy({ now: () => 544000 })
    const snap = cdcOutboxJoinSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(cdcOutboxJoinSnapshot(null as never)).toBe(null)
    expect(cdcOutboxJoinSnapshot({} as never)).toBe(null)
  })

  it('createCdcOutboxJoinEvidence ≥ 21 键 + 核心件回读', () => {
    const ev = createCdcOutboxJoinEvidence({ seed: 544, now: () => 544000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness holds；study.causalLocks allHold', () => {
    const s = cdcOutboxJoinStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
