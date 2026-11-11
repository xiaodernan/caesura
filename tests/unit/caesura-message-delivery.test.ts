import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import {
  MMD_DEFAULTS,
  MMD_PROTOCOLS,
  MMD_SCENARIOS,
  createAtMostOnceChannel,
  createAtLeastOnceChannel,
  createExactlyOnceChannel,
  runMessageDeliveryScenario,
  compareMessageDelivery,
  messageDeliveryStudy,
  mmdSnapshot,
} from '../../scripts/caesura-message-delivery.mjs'

/** 固定时钟 + 固定 seed：本件是确定性故障场景结构计数、非墙钟/QPS 跑分，注入不影响任何判词。 */
const fixedNow = () => () => 1000
const inj = () => ({ seed: 513, now: fixedNow() })
const emptyFaults = () => MMD_SCENARIOS.map(() => ({}))
const riggedOpts = () => ({ ...inj(), rigged: true, faults: emptyFaults() })
/** 把某协议某场景格子的三难布尔拼成向量串（顺序 [不丢/不重/低开销]）。 */
const vecOf = (row: any) =>
  `${Number(row.trilemma.noLoss)}${Number(row.trilemma.noDup)}${Number(row.trilemma.lowOverhead)}`
/** 协议名均为合法常量，运行期必非 null；仅在类型层收窄，不放宽实现。 */
const sc = (p: string, s: string, o: any) =>
  runMessageDeliveryScenario(p, s, o) as NonNullable<ReturnType<typeof runMessageDeliveryScenario>>

describe('KI-513 分布式消息投递语义：At-Most-Once / At-Least-Once / Exactly-Once 三协议诚实权衡', () => {
  /* ---------------- ① 常量 / 导出 / 名册 ---------------- */
  it('① 缺省参数冻结、10 枚值导出齐全、三协议/六场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(MMD_DEFAULTS)).toBe(true)
    expect([...MMD_PROTOCOLS]).toEqual(['AtMostOnce', 'AtLeastOnce', 'ExactlyOnce'])
    expect([...MMD_SCENARIOS]).toEqual([
      'allOk', 'crashAfterSend', 'ackLost', 'brokerRetry', 'consumerSlow', 'duplicateBurst',
    ])
    for (const fn of [
      createAtMostOnceChannel, createAtLeastOnceChannel, createExactlyOnceChannel,
      runMessageDeliveryScenario, compareMessageDelivery, messageDeliveryStudy, mmdSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(MMD_DEFAULTS.messages).toBeGreaterThan(1)
    expect(MMD_DEFAULTS.manyKeys).toBeGreaterThan(MMD_DEFAULTS.messages)
    expect(MMD_DEFAULTS.retryLimit).toBeGreaterThan(1)
    expect(MMD_DEFAULTS.ackRttMs).toBeGreaterThan(0)
    expect(MMD_DEFAULTS.windowMs).toBeGreaterThan(0)
    expect(MMD_DEFAULTS.rigged).toBe(false)
    expect(MMD_DEFAULTS.noCrash).toBe(false)
    expect(MMD_DEFAULTS.ackReliable).toBe(false)
    expect(MMD_DEFAULTS.freeIdempotency).toBe(false)
    expect(MMD_DEFAULTS.seed).toBeGreaterThan(0)
  })

  /* ---------------- ②~⑤ At-Most-Once 至多一次 ---------------- */
  it('② At-Most-Once 常态：每条只发一次、零重投零去重、开销最低、不丢不重', () => {
    const c = createAtMostOnceChannel({ ...inj(), messages: 8 })
    const ok = c.feed({})
    expect(ok.protocol).toBe('AtMostOnce')
    expect(ok.sent).toBe(8)                  // 发完即忘
    expect(ok.delivered).toBe(8)
    expect(ok.lost).toBe(0)
    expect(ok.retries).toBe(0)               // 零重投
    expect(ok.idempotentHits).toBe(0)        // 零去重状态
    expect(ok.overheadUnits).toBe(8)         // 每消息 1 结构单元 ⇒ 最省
    expect(ok.noLoss).toBe(true)
    expect(ok.noDup).toBe(true)
    expect(ok.lowOverhead).toBe(true)
  })

  it('③ At-Most-Once crashAfterSend 探针：发送后崩溃 ⇒ 尾部消息静默丢失（noLoss 翻 false）', () => {
    const c = createAtMostOnceChannel({ ...inj(), messages: 10, crashAfterSendAt: 3 })
    const r = c.feed({ crashAfterSend: true })
    expect(r.crashProbable).toBe(true)
    expect(r.lost).toBeGreaterThan(0)        // 第 3 条之后全丢
    expect(r.delivered).toBe(3)
    expect(r.noLoss).toBe(false)
    // 正交：丢消息不连带制造重复（不重试 ⇒ 天然不重复）
    expect(r.duplicates).toBe(0)
    expect(r.noDup).toBe(true)
    expect(r.lowOverhead).toBe(true)
  })

  it('④ At-Most-Once noCrash 注入 ⇒ 抹掉崩溃丢失、noLoss 翻 true（rigged 单维成因）', () => {
    const crashed = sc('AtMostOnce', 'crashAfterSend', inj())
    expect(crashed.noLoss).toBe(false)
    const healed = sc('AtMostOnce', 'crashAfterSend', { ...inj(), noCrash: true })
    expect(healed.lost).toBe(0)
    expect(healed.noLoss).toBe(true)
    expect(healed.lowOverhead).toBe(true)    // 另两维不受影响
  })

  it('⑤ At-Most-Once reset 归零 observable + 同 seed 双跑逐字一致', () => {
    const c = createAtMostOnceChannel({ ...inj(), messages: 12 })
    const a = c.feed({ crashAfterSend: true })
    const countA = c.observableCount
    c.reset()
    expect(c.observableCount).toBe(0)
    expect(c.feed({ crashAfterSend: true })).toEqual(a)
    expect(c.observableCount).toBe(countA)
  })

  /* ---------------- ⑥~⑨ At-Least-Once 至少一次 ---------------- */
  it('⑥ At-Least-Once 常态：发+等 ack 两单元/条、重投补回崩溃 ⇒ 不丢、开销仍低', () => {
    const c = createAtLeastOnceChannel({ ...inj(), messages: 8 })
    const ok = c.feed({})
    expect(ok.protocol).toBe('AtLeastOnce')
    expect(ok.lost).toBe(0)
    expect(ok.retries).toBe(0)
    expect(ok.overheadUnits).toBe(16)        // 每消息发送+ack = 2 单元
    expect(ok.noLoss).toBe(true)
    expect(ok.noDup).toBe(true)
    expect(ok.lowOverhead).toBe(true)        // 无幂等基础设施
  })

  it('⑦ At-Least-Once crashAfterSend 探针：第一趟丢失、重投补回 ⇒ 不丢但有 retries', () => {
    const c = createAtLeastOnceChannel({ ...inj(), messages: 10, crashAfterSendAt: 3 })
    const r = c.feed({ crashAfterSend: true })
    expect(r.crashProbable).toBe(true)
    expect(r.lost).toBe(0)                   // 重投补回，至少一次核心
    expect(r.delivered).toBe(10)
    expect(r.retries).toBeGreaterThan(0)
    expect(r.noLoss).toBe(true)
    expect(r.noDup).toBe(true)               // 仅仅是补发，未产生重复生效
  })

  it('⑧ At-Least-Once ackLost 探针：ack 丢失 ⇒ 误判重投致重复（只罚 noDup，不连带罚 noLoss/低开销）', () => {
    const c = createAtLeastOnceChannel({ ...inj(), messages: 8, retryLimit: 3 })
    const r = c.feed({ ackLost: true })
    expect(r.ackLostProbable).toBe(true)
    expect(r.duplicates).toBeGreaterThan(0)  // 消费者收到重复
    expect(r.retries).toBeGreaterThan(0)
    expect(r.lost).toBe(0)
    expect(r.noLoss).toBe(true)              // 正交化：不丢仍在
    expect(r.noDup).toBe(false)              // 只罚不重复
    expect(r.lowOverhead).toBe(true)         // 不连带罚低开销（无幂等表/事务/游标）
  })

  it('⑨ At-Least-Once ackReliable 注入 ⇒ 抹误判重投、noDup 翻 true（rigged 单维成因）', () => {
    const dup = sc('AtLeastOnce', 'ackLost', inj())
    expect(dup.noDup).toBe(false)
    const healed = sc('AtLeastOnce', 'ackLost', { ...inj(), ackReliable: true })
    expect(healed.duplicates).toBe(0)
    expect(healed.retries).toBe(0)
    expect(healed.noDup).toBe(true)
    expect(healed.noLoss).toBe(true)
  })

  /* ---------------- ⑩~⑬ Exactly-Once 恰好一次 ---------------- */
  it('⑩ Exactly-Once 常态：每消息 ≥5 结构单元、幂等键折叠重投 ⇒ 不丢不重但最贵', () => {
    const c = createExactlyOnceChannel({ ...inj(), messages: 8 })
    const ok = c.feed({})
    expect(ok.protocol).toBe('ExactlyOnce')
    expect(ok.overheadUnits).toBeGreaterThanOrEqual(8 * 5) // 发送+查/写去重表2+游标/事务2
    expect(ok.lost).toBe(0)
    expect(ok.duplicates).toBe(0)
    expect(ok.noLoss).toBe(true)
    expect(ok.noDup).toBe(true)
    expect(ok.lowOverhead).toBe(false)       // 默认恒 false
  })

  it('⑪ Exactly-Once ackLost 探针：重投命中幂等键折叠成一次生效（idempotentHits>0，duplicates=0）', () => {
    const c = createExactlyOnceChannel({ ...inj(), messages: 8, retryLimit: 3 })
    const r = c.feed({ ackLost: true })
    expect(r.ackLostProbable).toBe(true)
    expect(r.idempotentHits).toBeGreaterThan(0) // 重投命中去重表
    expect(r.duplicates).toBe(0)                // 折叠 ⇒ 不产生重复
    expect(r.delivered).toBe(8)                 // 每 key 只生效一次
    expect(r.noDup).toBe(true)
    expect(r.noLoss).toBe(true)
  })

  it('⑫ Exactly-Once freeIdempotency 注入 ⇒ 抹掉去重基础设施开销、lowOverhead 翻 true', () => {
    const expensive = sc('ExactlyOnce', 'allOk', inj())
    expect(expensive.lowOverhead).toBe(false)
    const freed = sc('ExactlyOnce', 'allOk', { ...inj(), freeIdempotency: true })
    expect(freed.lowOverhead).toBe(true)
    expect(freed.noLoss).toBe(true)          // 另两维不受影响
    expect(freed.noDup).toBe(true)
  })

  it('⑬ Exactly-Once reset 归零 observable + 同 seed 双跑逐字一致', () => {
    const c = createExactlyOnceChannel({ ...inj(), messages: 12 })
    const a = c.feed({ brokerRetry: true })
    c.reset()
    expect(c.observableCount).toBe(0)
    expect(c.feed({ brokerRetry: true })).toEqual(a)
  })

  /* ---------------- ⑭~⑰ 场景向量与不封赢家 ---------------- */
  it('⑭ 默认六场景三难向量 AtMostOnce=011 / AtLeastOnce=101 / ExactlyOnce=110（真值）', async () => {
    const cmp = await compareMessageDelivery(inj())
    expect(Object.fromEntries(cmp.rows.map((r) => [r.protocol, vecOf(r)]))).toEqual({
      AtMostOnce: '011', AtLeastOnce: '101', ExactlyOnce: '110',
    })
    expect(cmp.verdict.noUniversalWinner).toBe(true)
    expect(cmp.verdict.trilemmaDistinguishes).toBe(true)
    expect(cmp.verdict.noProtocolWinsAll).toBe(true)
  })

  it('⑮ 不预设各恰好缺一：At-Most-Once 天然不重复（只缺不丢），另两只各缺一难', async () => {
    const cmp = await compareMessageDelivery(inj())
    const [most, least, once] = cmp.rows
    // At-Most-Once：不重试 ⇒ 不重复 + 低开销，只缺不丢
    expect(most.trilemma.noLoss).toBe(false)
    expect(most.trilemma.noDup).toBe(true)
    expect(most.trilemma.lowOverhead).toBe(true)
    // At-Least-Once：只缺不重复
    expect(least.trilemma.noLoss).toBe(true)
    expect(least.trilemma.noDup).toBe(false)
    expect(least.trilemma.lowOverhead).toBe(true)
    // Exactly-Once：只缺低开销
    expect(once.trilemma.noLoss).toBe(true)
    expect(once.trilemma.noDup).toBe(true)
    expect(once.trilemma.lowOverhead).toBe(false)
  })

  it('⑯ Exactly-Once 不是免费午餐：是 At-Least-Once + 幂等，代价是最高结构开销', async () => {
    const cmp = await compareMessageDelivery(inj())
    expect(cmp.verdict.atMostOnceSilentlyLoses).toBe(true)
    expect(cmp.verdict.atMostOnceCheapest).toBe(true)
    expect(cmp.verdict.atLeastOnceNeverLoses).toBe(true)
    expect(cmp.verdict.atLeastOnceDuplicates).toBe(true)
    expect(cmp.verdict.exactlyOnceNoLossNoDup).toBe(true)
    expect(cmp.verdict.exactlyOnceMostExpensive).toBe(true)
    expect(cmp.verdict.exactlyOnceIsAtLeastOncePlusIdempotency).toBe(true)
    expect(cmp.verdict.exactlyOnceNotFree).toBe(true)
    // 结构开销：Exactly-Once 明显 > At-Least-Once > At-Most-Once
    const [most, least, once] = cmp.rows
    expect(once.totals.overheadUnits).toBeGreaterThan(least.totals.overheadUnits)
    expect(least.totals.overheadUnits).toBeGreaterThan(most.totals.overheadUnits)
  })

  it('⑰ duplicateBurst 探针：消息规模放大、At-Least-Once 重复突发不丢、Exactly-Once 幂等全折叠', async () => {
    const regular = sc('AtLeastOnce', 'allOk', inj())
    const burst = sc('AtLeastOnce', 'duplicateBurst', inj())
    expect(burst.sent).toBeGreaterThan(regular.sent) // duplicateBurst 放大消息数
    const onceBurst = sc('ExactlyOnce', 'duplicateBurst', inj())
    expect(onceBurst.lost).toBe(0)
    expect(onceBurst.duplicates).toBe(0)
    expect(onceBurst.lowOverhead).toBe(false)        // 规模放大也不会变便宜
  })

  /* ---------------- ⑱~㉑ 可证伪 rigged + 单开关边界 ---------------- */
  it('⑱ rigged 三开关齐开 + fault 全空 ⇒ 三协议全 111、三判词同时翻 false', async () => {
    const cmp = await compareMessageDelivery(riggedOpts())
    for (const row of cmp.rows) expect(vecOf(row)).toBe('111')
    expect(cmp.verdict.trilemmaDistinguishes).toBe(false)
    expect(cmp.verdict.noProtocolWinsAll).toBe(false)
    expect(cmp.verdict.noUniversalWinner).toBe(false)
    expect(cmp.config.rigged).toBe(true)
  })

  it('⑲ 单开 ackReliable 只让 At-Least-Once 退化 111，救不了 At-Most-Once 丢、也救不了 Exactly-Once 贵', async () => {
    const cmp = await compareMessageDelivery({ ...inj(), ackReliable: true, faults: emptyFaults() })
    expect(vecOf(cmp.rows[0])).toBe('011')   // At-Most-Once 仍丢（崩溃未抹）
    expect(vecOf(cmp.rows[1])).toBe('111')   // 只这一只补全
    expect(vecOf(cmp.rows[2])).toBe('110')   // Exactly-Once 仍贵（幂等开销未抹）
    expect(cmp.config.rigged).toBe(false)    // 单开关 ≠ rigged
  })

  it('⑳ 单开 noCrash 只补 At-Most-Once 的 noLoss 维；单开 freeIdempotency 只补 Exactly-Once 低开销维', async () => {
    const noCrash = await compareMessageDelivery({ ...inj(), noCrash: true, faults: emptyFaults() })
    expect(vecOf(noCrash.rows[0])).toBe('111')   // At-Most-Once 不丢了
    expect(vecOf(noCrash.rows[1])).toBe('101')   // At-Least-Once 仍重复（ack 未可靠）
    expect(vecOf(noCrash.rows[2])).toBe('110')   // Exactly-Once 仍贵
    const freeIdem = await compareMessageDelivery({ ...inj(), freeIdempotency: true, faults: emptyFaults() })
    expect(vecOf(freeIdem.rows[0])).toBe('011')
    expect(vecOf(freeIdem.rows[1])).toBe('101')
    expect(vecOf(freeIdem.rows[2])).toBe('111')   // 只 Exactly-Once 变便宜
  })

  it('㉑ rigged 判定需 faults 全空：三开关齐开但 faults 带探针不触发 rigged', async () => {
    const cmp = await compareMessageDelivery({
      ...inj(), noCrash: true, ackReliable: true, freeIdempotency: true,
      faults: MMD_SCENARIOS.map((s) => (s === 'ackLost' ? { ackLost: true } : {})),
    })
    expect(cmp.config.rigged).toBe(false)
  })

  /* ---------------- ㉒~㉘ 真依赖交叉印证 / study / 快照 ---------------- */
  it('㉒ 七枚真件交叉印证块齐全、来源标注为「真件」', async () => {
    const cx = (await compareMessageDelivery(inj())).crosscheck
    expect(Object.keys(cx).sort()).toEqual(
      ['bridge', 'bus', 'gameEventBus', 'redis', 'ring', 'twoPhase', 'wal'],
    )
    for (const v of Object.values(cx)) expect((v as any).source).toMatch(/真件/)
  })

  it('㉓ 真 createBus 发完即忘 shell + 真 GameEventBus delivered/errors 计数', async () => {
    const cx = (await compareMessageDelivery(inj())).crosscheck
    expect(cx.bus.hadListener).toBe(true)
    expect(cx.bus.listenerCount).toBe(1)
    expect(cx.bus.deliveredOnce).toBe(true)
    expect(cx.bus.noReplayOnUnsubscribe).toBe(true) // 退订后重发不再投 ⇒ at-most-once shell
    expect(cx.bus.atMostOnceShell).toBe(true)
    expect(cx.bus.notRealNetwork).toBe(true)
    expect(cx.gameEventBus.delivered).toBe(1)
    expect(cx.gameEventBus.errors).toBe(0)
    expect(cx.gameEventBus.deliveredMatches).toBe(true)
    expect(cx.gameEventBus.notRealBroker).toBe(true)
  })

  it('㉔ 真 bridge 注入后 install/forward 成功、未路由被 drop（读数不自相矛盾）', async () => {
    const cx = (await compareMessageDelivery(inj())).crosscheck.bridge
    expect(cx.routes).toBeGreaterThanOrEqual(1)
    expect(cx.installed).toBe(true)
    expect(cx.handlers).toBeGreaterThanOrEqual(1)
    expect(cx.forwardOk).toBe(true)           // 真注入 cloudBus ⇒ 转发成功
    expect(cx.forwarded).toBe(1)
    expect(cx.unroutedDropped).toBe(true)    // 未命中白名单 ⇒ not_routed
    expect(cx.dropped).toBe(1)
    expect(cx.routeStable).toBe(true)
    expect(cx.notRealRebalance).toBe(true)
  })

  it('㉕ 真 2PC 全 yes 提交、重放已提交事务幂等、协调宕全员 blocked；非真 XA', async () => {
    const cx = (await compareMessageDelivery(inj())).crosscheck.twoPhase
    expect(cx.prepareAllYes).toBe(true)
    expect(cx.commitPhase).toBe('committed')
    expect(cx.commitMessages).toBeGreaterThan(0)
    expect(cx.replayIdempotent).toBe(true)   // 重投已提交事务不重复生效
    expect(cx.downPhase).toBe('blocked')
    expect(cx.blockedParticipants).toBe(2)
    expect(cx.atomicCrossStoreNeedsCoordination).toBe(true)
    expect(cx.notRealXa).toBe(true)
  })

  it('㉖ 真 WAL 三参数 append 带 key 重放：同 key 重投 distinct<replay ⇒ 去重可能，但进程内不跨机', async () => {
    const cx = (await compareMessageDelivery(inj())).crosscheck.wal
    expect(cx.lines).toBe(3)
    expect(cx.restored).toBe(3)
    expect(cx.replayed).toBe(3)
    expect(cx.replayIds).toEqual(['m:1', 'm:2', 'm:1']) // 真取到 key，非 null 假象
    expect(cx.distinctIds).toBe(2)
    expect(cx.duplicateIdsReplayed).toBe(1)
    expect(cx.replayDedupePossible).toBe(true)
    expect(cx.sinkWritten).toBe(3)            // sink 真收到落盘行
    expect(cx.replicatedAcrossNodes).toBe(false)
    expect(cx.wholeNodeLossDurable).toBe(false)
    expect(cx.notRealBroker).toBe(true)
  })

  it('㉗ 真 Redis 幂等键首 miss 二 hit + 真环分区 fanout 有读数', async () => {
    const cx = (await compareMessageDelivery({ ...inj(), manyKeys: 120 })).crosscheck
    expect(cx.redis.firstMiss).toBe(true)
    expect(cx.redis.secondHit).toBe(true)
    expect(cx.redis.idempotentTable).toBe(true)
    expect(cx.redis.notRealRedis).toBe(true)
    expect(cx.ring.keys).toBe(120)
    expect(cx.ring.nodes).toBe(4)
    expect(cx.ring.balanceRatio).toBeGreaterThanOrEqual(1)
    expect(cx.ring.notRealPartitionRebalance).toBe(true)
  })

  it('㉘ study / mmdSnapshot JSON 往返无损 + null 降级 + builtAt 注入口径', async () => {
    const study = await messageDeliveryStudy(inj())
    expect(study.builtAt).toBe(1000)
    const round = JSON.parse(JSON.stringify(study))
    const snap = mmdSnapshot(round)!
    expect(snap.rows).toHaveLength(3)
    expect(snap.vectors).toEqual({ AtMostOnce: '011', AtLeastOnce: '101', ExactlyOnce: '110' })
    expect(snap.topology.messages).toBe(MMD_DEFAULTS.messages)
    expect(snap.topology.retryLimit).toBe(MMD_DEFAULTS.retryLimit)
    expect(mmdSnapshot(null)).toBeNull()
    expect(mmdSnapshot(undefined)).toBeNull()
    expect(mmdSnapshot({} as any)).toBeNull()
    expect(mmdSnapshot({ rows: 'bad' } as any)).toBeNull()
  })

  it('㉙ 场景名册可覆盖：scenarios 注入子集 ⇒ 矩阵按子集裁，不连坐默认判词', async () => {
    const cmp = await compareMessageDelivery({ ...inj(), scenarios: ['allOk', 'ackLost'] })
    expect(cmp.rows).toHaveLength(3)
    for (const row of cmp.rows) expect(row.scenarios).toHaveLength(2)
    expect(cmp.config.scenarios).toEqual(['allOk', 'ackLost'])
  })

  /* ---------------- ㉚ CLI 双跑字节一致 + 可证伪自证 ---------------- */
  it('㉚ CLI 固定时钟双跑字节一致（结构计数模型、非墙钟跑分），rigged 可证伪自证 PASS', () => {
    const script = path.resolve(__dirname, '../../scripts/caesura-message-delivery.mjs')
    const run = () => execFileSync(process.execPath, [script], { encoding: 'utf8' })
    const a = run()
    const b = run()
    expect(a).toBe(b)
    expect(a).toContain('"AtMostOnce":"011","AtLeastOnce":"101","ExactlyOnce":"110"')
    expect(a).toContain('不封赢家 是')
    expect(a).toContain('ExactlyOnce不是免费午餐 是')
    expect(a).toContain('真WAL重放3条(distinct 2 可去重=true 但跨机复制=false)')
    expect(a).toContain('RIGGED_FALSIFIABLE_OK')
  })
})
