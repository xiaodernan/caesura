import { describe, expect, it } from 'vitest'
import {
  BATCH_STREAM_DEFAULTS,
  BATCH_STREAM_SCENARIOS,
  BATCH_STREAM_STRATEGIES,
  createMicroBatchJoin,
  createStreamWindowJoin,
  createCdcOutboxJoin,
  batchStreamJoinStudy,
  batchStreamJoinSnapshot,
  verifyCausalLocks,
  verifyBatchStreamJoinSoundness,
  createBatchStreamJoinEvidence,
} from '../../scripts/caesura-batch-stream-join.mjs'

/** KI-543 批流 join 三策略（P8 第五十件 · 前端第三十七维教学现役）。 */

describe('caesura-batch-stream-join（KI-543）', () => {
  it('默认值/策略/场景固定顺序', () => {
    expect(BATCH_STREAM_STRATEGIES).toEqual(['MicroBatchJoin', 'StreamWindowJoin', 'CdcOutboxJoin'])
    expect(BATCH_STREAM_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'lateArrival', 'cleanRerun'])
    expect(BATCH_STREAM_DEFAULTS.seed).toBe(543)
    expect(BATCH_STREAM_DEFAULTS.batchSize).toBe(8)
  })

  it('MicroBatchJoin：桶式聚合，exactly-once 真落 · txn 计数', () => {
    const mb = createMicroBatchJoin({ batchSize: 8 })
    const order = Array.from({ length: 16 }, (_, i) => ({ id: 'm' + i, orderId: 'o:' + (i % 4), ts: 0 }))
    const shipment = Array.from({ length: 16 }, (_, i) => ({ id: 's' + i, orderId: 'o:' + (i % 4), ts: 0 }))
    const out = mb.join(order, shipment)
    expect(out.joins).toBeGreaterThan(0)
    expect(out.txnCount).toBe(2)
  })

  it('StreamWindowJoin：逐条真处理 · exactlyOnce=false', () => {
    const sw = createStreamWindowJoin({})
    expect(sw.exactlyOnce).toBe(false)
    expect(sw.bulkThroughput).toBe(false)
    expect(sw.lowLatency).toBe(true)
  })

  it('CdcOutbox：tail ≥ 1 · bulkThroughput=true · exactlyOnce=false · tailPosition 递增', () => {
    const cdc = createCdcOutboxJoin({})
    const order = Array.from({ length: 16 }, (_, i) => ({ id: 'm' + i, orderId: 'o:' + (i % 4), ts: 0 }))
    const ship = order.map((o) => ({ id: 's' + o.id, orderId: o.orderId, ts: 0 }))
    const out = cdc.join(order, ship, 0)
    expect(out.tailIncrement).toBe(1)
    expect(cdc.bulkThroughput).toBe(true)
    expect(cdc.exactlyOnce).toBe(false)
    expect(cdc.tailPosition()).toBe(1)
  })

  it('四场景 cell 全真 · vectors 与 trilemma 同源现算', () => {
    const s = batchStreamJoinStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(BATCH_STREAM_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.bulkThroughput)}${Number(row.trilemma.lowLatency)}${Number(row.trilemma.exactlyOnce)}`)
    }
  })

  it('默认向量互异 101/010/110 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = batchStreamJoinStudy({ now: () => 543000 })
    expect(s.vectors).toEqual({ MicroBatchJoin: '101', StreamWindowJoin: '010', CdcOutboxJoin: '110' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(543000)
  })

  it('三因果锁 allHold', () => {
    const r = verifyCausalLocks({ seed: 543 })
    expect(r.batchWindowCausallyUnerasable).toBe(true)
    expect(r.streamExactlyOnceCausallyUnerasable).toBe(true)
    expect(r.cdcReplayCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifyBatchStreamJoinSoundness · holds=true · nontrivial=true falsifiable · 三路篡改 false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'm' + i, orderId: 'o:' + (i % 4), ts: 0 }))
    const r = verifyBatchStreamJoinSoundness({ events, seed: 543, messages: 96 }, { seed: 543 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.microJoins).toBeGreaterThan(0)
    expect(r.laneB.cdcTailIncrement).toBeGreaterThanOrEqual(1)
    expect(r.tamper.batchBucketDrift.holds).toBe(false)
    expect(r.tamper.windowMiss.holds).toBe(false)
    expect(r.tamper.cdcDupe.holds).toBe(false)
  })

  it('空 events ⇒ holds=false nontrivial=false', () => {
    const r = verifyBatchStreamJoinSoundness({ events: [], seed: 543 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('batchStreamJoinSnapshot 形状 + verdict 同源 · null/{} → null', () => {
    const s = batchStreamJoinStudy({ now: () => 543000 })
    const snap = batchStreamJoinSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(batchStreamJoinSnapshot(null as never)).toBe(null)
    expect(batchStreamJoinSnapshot({} as never)).toBe(null)
  })

  it('createBatchStreamJoinEvidence ≥ 21 键 + 核心件回读', () => {
    const ev = createBatchStreamJoinEvidence({ seed: 543, now: () => 543000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness 结构 holds；study.causalLocks 三件 allHold', () => {
    const s = batchStreamJoinStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
