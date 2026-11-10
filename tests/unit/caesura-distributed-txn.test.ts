import { describe, it, expect } from 'vitest'
import {
  DTX_DEFAULTS,
  DTX_PROTOCOLS,
  DTX_SCENARIOS,
  createTwoPhaseCommit,
  createSaga,
  createTcc,
  runDtxnScenario,
  compareDistributedTxn,
  distributedTxnStudy,
  dtSnapshot,
} from '../../scripts/caesura-distributed-txn.mjs'

/** 固定时钟：本件是确定性故障场景结构计数、非墙钟跑分，注入 0 基线不影响任何判词。 */
const fixed = () => () => 0

describe('KI-506 分布式事务：2PC 阻塞 / Saga 逆序补偿留脏 / TCC 三阶段幂等 三协议诚实权衡', () => {
  it('① 缺省参数冻结、10 枚值导出齐全、三协议/六场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(DTX_DEFAULTS)).toBe(true)
    expect(DTX_PROTOCOLS.map((p) => p.short)).toEqual(['2PC', 'Saga', 'TCC'])
    expect(DTX_SCENARIOS.map((s) => s.id)).toEqual([
      'allOk', 'voteNo', 'coordinatorDown', 'stepFail', 'compensateFail', 'confirmFlaky',
    ])
    for (const fn of [
      createTwoPhaseCommit, createSaga, createTcc, runDtxnScenario,
      compareDistributedTxn, distributedTxnStudy, dtSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(DTX_DEFAULTS.maxRetries).toBe(3)
  })

  /* ---------------- 2PC ---------------- */
  it('② 2PC 全 yes 提交：prepare 全员投票、commit 全局提交、逐参与者 ACK、有隔离', () => {
    const m = createTwoPhaseCommit({ participants: ['A', 'B', 'C'] })
    const p = m.prepare()
    expect(p.allYes).toBe(true)
    expect(m.phase).toBe('prepared')
    const c = m.commit()
    expect(c.committed).toBe(true)
    expect(m.phase).toBe('committed')
    const s = m.stats()
    expect(s.votesYes).toBe(3)
    expect(s.acks).toBe(3)
    expect(s.blockedParticipants).toBe(0)
    expect(s.isolation).toBe(true)
    expect(s.intrusion).toBe(3) // XA 侵入最低
  })

  it('③ 2PC 任一 no ⇒ 全局中止，不进 prepared 提交态', () => {
    const m = createTwoPhaseCommit({ participants: ['A', 'B', 'C'] })
    const p = m.prepare({ noVotes: ['B'] })
    expect(p.allYes).toBe(false)
    expect(m.phase).toBe('aborted')
    expect(m.commit().committed).toBe(false) // 中止后不能提交
    const s = m.stats()
    expect(s.votesNo).toBe(1)
    expect(s.phase).toBe('aborted')
    expect(s.blockedParticipants).toBe(0) // 投 no 直接中止，不进 prepared、无阻塞窗口
  })

  it('④ 2PC 协调者 prepare 后宕机 ⇒ 全员阻塞、不可自愈，外部介入才解开（核心病）', () => {
    const m = createTwoPhaseCommit({ participants: ['A', 'B', 'C'] })
    m.prepare()
    const c = m.commit({ coordinatorDown: true })
    expect(c.committed).toBe(false)
    expect(m.phase).toBe('blocked')
    expect(c.blockedParticipants).toBe(3)
    expect(m.stats().blockedParticipants).toBe(3)
    expect(m.stats().coordinatorDown).toBe(true)
    expect(m.commit().committed).toBe(false)          // 宕机态下重复 commit 也解不开
    const r = m.resolveBlocked('rollback')
    expect(r.resolved).toBe(true)
    expect(m.phase).toBe('aborted')
    expect(m.stats().blockedParticipants).toBe(0)
    expect(m.stats().resolvedBy).toBe('external-timeout')
  })

  it('⑤ 2PC 幂等：重复 commit 不重复发消息、提交后 rollback 被拒', () => {
    const m = createTwoPhaseCommit({ participants: ['A', 'B'] })
    m.prepare()
    const a = m.commit()
    const b = m.commit()
    expect(a.committed).toBe(true)
    expect(b.idempotent).toBe(true)
    expect(b.messages).toBe(0)                  // 重放零消息
    expect(m.rollback().aborted).toBe(false)    // 提交后回滚拒绝
  })

  /* ---------------- Saga ---------------- */
  it('⑥ Saga 全成功：逐步正向、无补偿、无阻塞、但放弃隔离', () => {
    const m = createSaga({ steps: ['T1', 'T2', 'T3'] })
    const r = m.run()
    expect(r.committed).toBe(true)
    expect(m.phase).toBe('committed')
    const s = m.stats()
    expect(s.stepsDone).toBe(3)
    expect(s.compensated).toBe(0)
    expect(s.blockedParticipants).toBe(0)
    expect(s.isolation).toBe(false)             // Saga 的中间态对外可见
    expect(s.intrusion).toBe(6)                 // 每步正向+补偿两套
  })

  it('⑦ Saga 第 k 步失败 ⇒ 逆序补偿已完成步（C(k-1)…C0）', () => {
    const m = createSaga({ steps: ['T1', 'T2', 'T3'], compensations: ['C1', 'C2', 'C3'] })
    const r = m.run({ failAtStep: 2 })          // 第 3 步失败，补偿 T1/T2
    expect(r.committed).toBe(false)
    expect(m.phase).toBe('aborted')
    expect(r.compensationOrder).toEqual([1, 0]) // 严格逆序
    expect(m.stats().compensated).toBe(2)
    expect(m.stats().dirtyData).toBe(0)         // 补偿成功不留脏
    const traceTypes = m.snapshot().trace.map((x: any) => x.t)
    expect(traceTypes).toContain('compensate')
    expect(traceTypes.indexOf('compensate')).toBeGreaterThan(traceTypes.indexOf('step-fail'))
  })

  it('⑧ Saga 补偿再失败 ⇒ dirtyData 记账，不粉饰「补偿必成功」（核心病）', () => {
    const m = createSaga({ steps: ['T1', 'T2', 'T3'] })
    const r = m.run({ failAtStep: 2, compensateFailAt: 0 }) // C1 补偿失败
    expect(m.phase).toBe('dirty')
    expect(r.dirtyData).toBe(1)
    expect(m.stats().dirtyData).toBe(1)
    expect(m.stats().compensated).toBe(1)       // C2 成功、C1 失败
    expect(m.stats().blockedParticipants).toBe(0)
  })

  it('⑨ Saga 第一步就失败 ⇒ 无已完成步要补偿、补偿顺序空集', () => {
    const m = createSaga({ steps: ['T1', 'T2'] })
    const r = m.run({ failAtStep: 0 })
    expect(r.compensationOrder).toEqual([])
    expect(m.stats().compensated).toBe(0)
    expect(m.stats().dirtyData).toBe(0)
  })

  /* ---------------- TCC ---------------- */
  it('⑩ TCC 全 Try 成功 ⇒ 逐 Confirm 提交、三阶段状态齐、侵入最重', () => {
    const m = createTcc({ steps: ['S1', 'S2', 'S3'] })
    const r = m.run()
    expect(r.committed).toBe(true)
    expect(m.phase).toBe('committed')
    const s = m.stats()
    expect(s.confirmed).toBe(3)
    expect(s.blockedParticipants).toBe(0)
    expect(s.isolation).toBe(true)
    expect(s.intrusion).toBe(9)                 // 每服务 Try/Confirm/Cancel 三套
    const res = m.snapshot().reservations
    expect(Object.values(res).every((v) => v === 'confirmed')).toBe(true)
  })

  it('⑪ TCC Confirm 半途失败 ⇒ 幂等重试后提交，retries 入账、无脏（核心优势）', () => {
    const m = createTcc({ steps: ['S1', 'S2'] })
    const r = m.run({ confirmFlakyAt: 0, confirmFailTimes: 2 })
    expect(r.committed).toBe(true)
    expect(r.retries).toBe(2)
    expect(r.dirtyData).toBe(0)
    expect(m.stats().retries).toBe(2)
    expect(m.snapshot().reservations.S1).toBe('confirmed')  // 重试 2 次后落到 confirmed 终态
    expect(m.snapshot().traces.filter((x: any) => x.t === 'confirm-retry')).toHaveLength(2) // 重试轨迹可数
  })

  it('⑫ TCC Try 失败 ⇒ 逆序 Cancel 已预留者；重试超上限才留脏（诚实边界）', () => {
    const a = createTcc({ steps: ['S1', 'S2', 'S3'] })
    const ra = a.run({ tryFailAt: 2 })          // 第 3 步 Try 失败，Cancel S1/S2
    expect(ra.committed).toBe(false)
    expect(a.phase).toBe('aborted')
    expect(ra.cancelOrder).toEqual([1, 0])
    expect(a.stats().cancelled).toBe(2)
    expect(a.stats().dirtyData).toBe(0)

    const b = createTcc({ steps: ['S1'], maxRetries: 2 })
    const rb = b.run({ confirmFlakyAt: 0, confirmFailTimes: 5 }) // 重试耗尽
    expect(b.phase).toBe('dirty')
    expect(rb.dirtyData).toBe(1)
    expect(b.stats().blockedParticipants).toBe(0)
  })

  /* ---------------- 对照 ---------------- */
  it('⑬ 同组六场景喂三协议：2PC 阻塞 / Saga 留脏 / TCC 幂等重试，阶梯读数真实', () => {
    const cmp = compareDistributedTxn({ now: fixed() })
    expect(cmp.protocols).toEqual(['2PC', 'Saga', 'TCC'])
    expect(Object.keys(cmp.matrix['2PC'].scenarios)).toHaveLength(6)
    // 2PC 协调者宕机 ⇒ 全员阻塞；其余协议不阻塞
    expect(cmp.matrix['2PC'].scenarios.coordinatorDown.blocked).toBe(3)
    expect(cmp.matrix.Saga.scenarios.coordinatorDown.blocked).toBe(0)
    expect(cmp.matrix.TCC.scenarios.coordinatorDown.blocked).toBe(0)
    // Saga 补偿失败 ⇒ 留脏；2PC/TCC 无此坎
    expect(cmp.matrix.Saga.scenarios.compensateFail.dirty).toBe(1)
    expect(cmp.matrix['2PC'].scenarios.compensateFail.dirty).toBe(0)
    expect(cmp.matrix.TCC.scenarios.compensateFail.dirty).toBe(0)
    // TCC Confirm 半途失败 ⇒ 幂等重试自愈提交
    expect(cmp.matrix.TCC.scenarios.confirmFlaky.retries).toBeGreaterThan(0)
    expect(cmp.matrix.TCC.scenarios.confirmFlaky.committed).toBe(true)
    // 侵入度阶梯 3 < 6 < 9
    expect(cmp.matrix['2PC'].intrusion).toBeLessThan(cmp.matrix.Saga.intrusion)
    expect(cmp.matrix.Saga.intrusion).toBeLessThan(cmp.matrix.TCC.intrusion)
  })

  it('⑭ 三难判据：三协议三难向量互不相同、无一全占 ⇒ noUniversalWinner 真', () => {
    const cmp = compareDistributedTxn({ now: fixed() })
    const v = cmp.verdict
    expect(cmp.trilemmaVectors['2PC']).toBe('011')   // 缺不阻塞
    expect(cmp.trilemmaVectors.Saga).toBe('100')     // 缺不留脏 + 侵入低
    expect(cmp.trilemmaVectors.TCC).toBe('110')      // 缺侵入低
    expect(new Set(Object.values(cmp.trilemmaVectors)).size).toBe(3)
    expect(v.trilemmaDistinguishes).toBe(true)
    expect(v.noProtocolWinsAll).toBe(true)
    expect(v.twoPcBlocksOnCoordinatorDown).toBe(true)
    expect(v.sagaLeaksDirtyOnCompensateFail).toBe(true)
    expect(v.tccSelfHealsConfirm).toBe(true)
    expect(v.sagaNeverBlocks).toBe(true)
    expect(v.twoPcAndTccIsolated).toBe(true)
    expect(v.noUniversalWinner).toBe(true)
  })

  it('⑮ 判词可证伪：rigged 场景（抹掉三种故障）⇒ 三难退化、noUniversalWinner 翻 false', () => {
    const rigged = [
      { id: 'allOk', label: '全成功', fault: {} },
      { id: 'clean2', label: '干净', fault: {} },
      { id: 'clean3', label: '干净', fault: {} },
    ]
    const cmp = compareDistributedTxn({ now: fixed(), scenarios: rigged })
    // 无故障：2PC 不阻塞+不留脏+侵入最低 ⇒ 三条全占；Saga/TCC 退化为同一向量 ⇒ 区分度丢失
    expect(cmp.trilemmaVectors['2PC']).toBe('111')
    expect(cmp.trilemmaVectors.Saga).toBe(cmp.trilemmaVectors.TCC)
    expect(cmp.verdict.trilemmaDistinguishes).toBe(false)
    expect(cmp.verdict.noProtocolWinsAll).toBe(false)
    expect(cmp.verdict.noUniversalWinner).toBe(false)
  })

  /* ---------------- runDtxnScenario / 空集降级 ---------------- */
  it('⑯ runDtxnScenario 单场景可跑；空集 scenarios ⇒ 矩阵各格空、不崩、判词诚实降级', () => {
    const one = runDtxnScenario({ protocol: '2PC', scenario: { id: 'coordinatorDown', label: '宕机', fault: { at: 'coordinatorDown' } }, now: fixed() })
    expect(one.blocked).toBe(3)
    expect(one.atomic).toBe(false)              // 决策悬空、原子性未落地
    expect(one.isolation).toBe(true)
    const empty = compareDistributedTxn({ now: fixed(), scenarios: [] })
    for (const p of empty.protocols) {
      expect(Object.keys(empty.matrix[p].scenarios)).toHaveLength(0)
      expect(empty.matrix[p].totals.messages).toBe(0)
    }
    expect(empty.verdict.noUniversalWinner).toBe(false)
  })

  /* ---------------- study / snapshot / 确定性 ---------------- */
  it('⑰ distributedTxnStudy 纯数据、可 JSON 往返；三判词探针（幂等/逆序/重试）全真', () => {
    const study = distributedTxnStudy({ now: fixed() })
    expect(study.generator).toBe('caesura-distributed-txn')
    expect(study.builtAt).toBe(0)               // 固定时钟
    expect(study.verdict.twoPcCommitIdempotent).toBe(true)
    expect(study.verdict.sagaCompensatesInReverse).toBe(true)
    expect(study.verdict.tccConfirmIdempotentRetry).toBe(true)
    expect(study.verdict.noUniversalWinner).toBe(true)
    const round = JSON.parse(JSON.stringify(study))
    expect(round.comparison.verdict.noUniversalWinner).toBe(true)
    expect(round.sagaOrder.compensationOrder).toEqual(study.sagaOrder.compensationOrder)
  })

  it('⑱ dtSnapshot 收敛成前端只读结构、null 降级；注入时钟 ⇒ 双跑字节一致', () => {
    const snap = dtSnapshot(distributedTxnStudy({ now: fixed() }))
    expect(snap).not.toBeNull()
    expect(snap!.config.protocols).toEqual(['2PC', 'Saga', 'TCC'])
    expect(snap!.rows).toHaveLength(3)
    for (const row of snap!.rows) {
      expect(row.scenarios).toHaveLength(6)
      expect(row.totals.messages).toBeGreaterThan(0)
    }
    expect(snap!.verdict.noUniversalWinner).toBe(true)
    expect(dtSnapshot(null)).toBeNull()
    expect(dtSnapshot(undefined)).toBeNull()
    // 注入固定时钟 ⇒ 两次 study 逐字一致（CLI 双跑字节一致的根）
    expect(JSON.stringify(distributedTxnStudy({ now: fixed() })))
      .toBe(JSON.stringify(distributedTxnStudy({ now: fixed() })))
  })
})
