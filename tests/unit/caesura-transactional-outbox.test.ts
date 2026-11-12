import { describe, expect, it } from 'vitest'
import {
  OUTBOX_DEFAULTS,
  OUTBOX_SCENARIOS,
  OUTBOX_STRATEGIES,
  createCdcOutbox,
  createDualWrite,
  createPollingOutbox,
  transactionalOutboxStudy,
  transactionalOutboxSnapshot,
  verifyCausalLocks,
  verifyOutboxSoundness,
  createOutboxEvidence,
} from '../../scripts/caesura-transactional-outbox.mjs'

/** KI-534 事务性发件箱与消费幂等（P8 第四十一件《并轨 Lane 占位，本会实现》· 前端第二十八维）。 */

describe('caesura-transactional-outbox（KI-534）', () => {
  it('OUTBOX_DEFAULTS / STRATEGIES / SCENARIOS 固定顺序', () => {
    expect(OUTBOX_STRATEGIES).toEqual(['DualWrite', 'PollingOutbox', 'CdcOutbox'])
    expect(OUTBOX_SCENARIOS).toEqual(['steadyFlow', 'crashAfterCommit', 'retryStorm', 'consumerHalfCrash', 'pollLag', 'cleanRerun'])
    expect(OUTBOX_DEFAULTS.seed).toBe(534)
    expect(OUTBOX_DEFAULTS.items).toBe(96)
    expect(OUTBOX_DEFAULTS.pollInterval).toBe(4)
    expect(OUTBOX_DEFAULTS.cdcLag).toBe(1)
  })

  it('DualWrite：稳态提交守恒；crashAfterCommit 注入点真丢一条', () => {
    const dw = createDualWrite({ seed: 534 })
    const steady = dw.run(Array.from({ length: 96 }, (_, i) => ({ id: `obx:534:${i}`, bizPayload: `txn:534:${i}` })), 'steadyFlow')
    expect(steady.committed).toBe(96)
    expect(steady.delivered.length).toBe(96)
    expect(steady.lost).toEqual([])
    const crashed = createDualWrite({ seed: 534 }).run(
      Array.from({ length: 96 }, (_, i) => ({ id: `obx:534:${i}`, bizPayload: `txn:534:${i}` })),
      'crashAfterCommit',
    )
    expect(crashed.lost.length).toBe(1)
    expect(crashed.delivered.length).toBe(95)
  })

  it('PollingOutbox：全量投递、maxDeliveryLag == pollInterval；零 dup 滤掉重投', () => {
    const poller = createPollingOutbox({ seed: 534, pollInterval: 4 })
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `obx:534:${i}`, bizPayload: `txn:534:${i}`, retryStorm: i % 32 === 9 }))
    const out = poller.run(events, 'retryStorm')
    expect(out.lost).toEqual([])
    expect(out.maxDeliveryLag).toBe(4)
    expect(out.processed).toBe(96) // 全部被 dedup 滤掉
    expect(out.duplicateProcessed).toBe(0)
  })

  it('CdcOutbox：retryStorm 容复真重复（非 rigged）；完美去重滤掉但 consumerHalfCrash 仍暴露', () => {
    const cdc = createCdcOutbox({ seed: 534, retryLimit: 2 })
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `obx:534:${i}`, bizPayload: `txn:534:${i}`, retryStorm: i % 32 === 9 }))
    const out = cdc.run(events, 'retryStorm')
    expect(out.lost).toEqual([])
    expect(out.duplicateProcessed).toBeGreaterThan(0)
    const half = createCdcOutbox({ seed: 534, retryLimit: 2 }).run(
      Array.from({ length: 96 }, (_, i) => ({ id: `obx:534:${i}`, bizPayload: `txn:534:${i}`, halfCrash: i % 40 === 13 })),
      'consumerHalfCrash',
    )
    expect(half.duplicateProcessed).toBeGreaterThan(0)
    // Perfect dedup：滤得掉 retryStorm 重投
    const pd = createCdcOutbox({ seed: 534, perfectDedup: true }).run(events, 'retryStorm')
    expect(pd.duplicateProcessed).toBe(0)
  })

  it('六场景都跑出 cell；vectors 与 trilemma 同源现算', () => {
    const s = transactionalOutboxStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(OUTBOX_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.atomicDelivery)}${Number(row.trilemma.lowLatency)}${Number(row.trilemma.noDuplicate)}`)
    }
  })

  it('默认向量互异、无一 111、noUniversalWinner=true distinguishable vectorFromTrilemma noStrategyWinsAll', () => {
    const s = transactionalOutboxStudy({ now: () => 534000 })
    expect(s.vectors).toEqual({ DualWrite: '011', PollingOutbox: '101', CdcOutbox: '110' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(534000)
  })

  it('三难各找各自考场：[atomicDelivery / lowLatency / noDuplicate]', () => {
    const s = transactionalOutboxStudy({})
    const dual = s.rows.find((r) => r.protocol === 'DualWrite')!
    const polling = s.rows.find((r) => r.protocol === 'PollingOutbox')!
    const cdc = s.rows.find((r) => r.protocol === 'CdcOutbox')!
    expect(dual.trilemma).toEqual({ atomicDelivery: false, lowLatency: true, noDuplicate: true })
    expect(polling.trilemma).toEqual({ atomicDelivery: true, lowLatency: false, noDuplicate: true })
    expect(cdc.trilemma).toEqual({ atomicDelivery: true, lowLatency: true, noDuplicate: false })
  })

  it('单开 atomicMagic（只 DualWrite）⇒ 崩溃仍丢、vectors 不变、010/011', () => {
    const s = transactionalOutboxStudy({ atomicMagic: true })
    expect(s.vectors.DualWrite).toBe('011')
    expect(s.vectors.PollingOutbox).toBe('101')
    expect(s.vectors.CdcOutbox).toBe('110')
    expect(s.verdict.atomicMagicKeepsDualWriteFragile).toBe(true)
  })

  it('单开 zeroPollInterval（只 PollingOutbox）⇒ Polling=110（低延迟晋级、noDup 真翻）', () => {
    const s = transactionalOutboxStudy({ zeroPollInterval: true })
    expect(s.vectors.PollingOutbox).toBe('110')
    expect(s.vectors.DualWrite).toBe('011')
    expect(s.verdict.zeroPollIntervalErasesPollingDupRule).toBe(true)
  })

  it('单开 perfectDedup（只 CdcOutbox）⇒ retryStorm 被滤、但 consumerHalfCrash 窗口仍在 ⇒ 恒 110', () => {
    const s = transactionalOutboxStudy({ perfectDedup: true })
    expect(s.vectors.CdcOutbox).toBe('110')
    expect(s.vectors.DualWrite).toBe('011')
    expect(s.verdict.perfectDedupKeepsCdcFragilitySignals).toBe(true)
  })

  it('rigged 三开齐：DualWrite 恒 011、Polling≡Cdc=110 诚实塌缩、noStrategyWinsAll 仍真', () => {
    const s = transactionalOutboxStudy({ rigged: true })
    expect(s.vectors).toEqual({ DualWrite: '011', PollingOutbox: '110', CdcOutbox: '110' })
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(s.verdict.noUniversalWinner).toBe(false)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('verifyOutboxSoundness：holds=true nontrivial=true falsifiable；laneA 提交守恒、laneB 唯一处理数 == 提交数', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `obx:534:${i}`, bizPayload: `txn:534:${i}`, halfCrash: i % 40 === 13 }))
    const r = verifyOutboxSoundness({ events, seed: 534 }, { seed: 534 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.businessTransactions).toBe(96)
    expect(r.laneA.messagesDelivered).toBe(96)
    expect(r.laneAOk).toBe(true)
    expect(r.laneBOk).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.tamper.forgedCommit.holds).toBe(false)
    expect(r.tamper.silentDrop.holds).toBe(false)
    expect(r.tamper.duplicateRelease.holds).toBe(false)
  })

  it('verifyOutboxSoundness 空 items ⇒ holds=false nontrivial=false（绝不 0=0 假绿）', () => {
    const r = verifyOutboxSoundness({ events: [], seed: 534 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('verifyCausalLocks 三因果锁 allHold；sweep 单调可证', () => {
    const r = verifyCausalLocks({ seed: 534 })
    expect(r.atomicDeliveryRequiresOutboxCausallyUnerasable).toBe(true)
    expect(r.atLeastOnceRequiresDedupCausallyUnerasable).toBe(true)
    expect(r.zeroLatencyNeedsCdcReplayCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
    const retry = r.retrySweep
    expect(retry[0].duplicates).toBe(0)
    expect(retry.some((s) => s.retryLimit >= 1 && s.duplicates > 0)).toBe(true)
  })

  it('transactionalOutboxSnapshot：形状 + verdict 同源；snapshot(null)/{} → null 反守卫', () => {
    const s = transactionalOutboxStudy({ now: () => 534000 })
    const snap = transactionalOutboxSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.causalLocks!.causalLocksAllHold).toBe(true)
    expect(snap.noUniversalWinner).toBe(true)
    expect(snap.trilemmaDistinguishes).toBe(true)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(snap.crosscheck && snap.crosscheck.soundness).toBeDefined()
    expect(transactionalOutboxSnapshot(null as never)).toBe(null)
    expect(transactionalOutboxSnapshot({} as never)).toBe(null)
  })

  it('createOutboxEvidence 真件 ≥ 21 键 + 核心件回读', () => {
    const ev = createOutboxEvidence({ seed: 534, now: () => 534000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness 结构 holds', () => {
    const s = transactionalOutboxStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
