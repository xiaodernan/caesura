import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import {
  DCC_DEFAULTS,
  DCC_PROTOCOLS,
  DCC_SCENARIOS,
  createPollingClient,
  createLongPollingClient,
  createWatchPushClient,
  runConfigConsistencyScenario,
  compareConfigConsistency,
  configConsistencyStudy,
  dccSnapshot,
} from '../../scripts/caesura-config-consistency.mjs'

/** 固定时钟 + 固定 seed：本件是确定性故障场景结构计数、非墙钟/QPS 跑分，注入不影响任何判词。 */
const fixedNow = () => () => 1000
const inj = () => ({ seed: 511, now: fixedNow() })
const riggedFaults = () => DCC_SCENARIOS.map(() => ({}))

describe('KI-511 分布式配置一致性：轮询 / 长轮询 / watch 推送三协议诚实权衡', () => {
  /* ---------------- ① 常量 / 导出 / 名册 ---------------- */
  it('① 缺省参数冻结、10 枚值导出齐全、三协议/六场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(DCC_DEFAULTS)).toBe(true)
    expect([...DCC_PROTOCOLS]).toEqual(['Polling', 'LongPolling', 'WatchPush'])
    expect([...DCC_SCENARIOS]).toEqual([
      'allOk', 'quickChange', 'idleNoChange', 'centerDown', 'burstChanges', 'manyClients',
    ])
    for (const fn of [
      createPollingClient, createLongPollingClient, createWatchPushClient,
      runConfigConsistencyScenario, compareConfigConsistency, configConsistencyStudy, dccSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(DCC_DEFAULTS.clients).toBeGreaterThan(1)
    expect(DCC_DEFAULTS.manyClients).toBeGreaterThan(DCC_DEFAULTS.clients)
    expect(DCC_DEFAULTS.pollIntervalMs).toBeGreaterThan(0)
    expect(DCC_DEFAULTS.windowMs).toBeGreaterThan(0)
    expect(DCC_DEFAULTS.rigged).toBe(false)
    expect(DCC_DEFAULTS.seed).toBeGreaterThan(0)
  })

  /* ---------------- ② Polling 客户端轮询 ---------------- */
  it('② Polling 常态有 0~T 感知延迟、无变更空转（idleFetches>0）、零常驻连接', () => {
    const c = createPollingClient({ ...inj(), clients: 8, pollIntervalMs: 1000, windowMs: 10000 })
    const ok = c.feed({})                       // 基线：单次普通变更
    expect(ok.protocol).toBe('Polling')
    expect(ok.perceivedDelay).toBeGreaterThan(0) // 变更落在拉取点之后 ⇒ 必吃延迟
    expect(ok.idleFetches).toBeGreaterThan(0)    // 一次命中、多次空拉
    expect(ok.connections).toBe(0)               // 拉完即走
    expect(ok.reconnects).toBe(0)
    expect(ok.versionGaps).toBe(0)
    const idle = c.feed({ idle: true })
    expect(idle.changes).toBe(0)
    expect(idle.idleFetches).toBeGreaterThan(0)  // 长空闲全空转
    expect(idle.perceivedDelay).toBe(0)          // 无变更不算延迟
  })
  it('③ Polling 中心宕持旧快照续命：degraded=true、感知延迟含 downDuration、staleClients 满', () => {
    const c = createPollingClient({ ...inj(), clients: 8, downDurationMs: 1500 })
    const r = c.feed({ centerDown: true })
    expect(r.degraded).toBe(true)                // 可降级：服务不中断
    expect(r.staleClients).toBe(8)
    expect(r.perceivedDelay).toBeGreaterThanOrEqual(1500 / 1000)
    expect(r.centerBroken).toBe(false)
  })
  it('④ Polling 单 pollingInstant（T=0）⇒ 延迟归零但空转仍在（瞬时≠零空转）；reset 可复现', () => {
    const c = createPollingClient({ ...inj(), pollingInstant: true, clients: 8 })
    const r = c.feed({ quickChange: true })
    expect(r.perceivedDelay).toBe(0)
    expect(r.idleFetches).toBeGreaterThan(0)      // 周期趋零反而空转更猛：单开关抹不掉空转软肋
    expect(c.observableCount).toBe(1)
    c.reset()
    expect(c.observableCount).toBe(0)
    expect(c.feed({ quickChange: true })).toEqual(r) // reset 后完全复现（含相位流）
    // 三开关齐开（rigged 全抹）才连空转一起消失
    const rig = createPollingClient({ ...inj(), pollingInstant: true, centerAlwaysUp: true, noBurst: true })
    expect(rig.feed({ quickChange: true }).idleFetches).toBe(0)
  })
  it('⑤ Polling 注入确定性：同 seed 双跑读数逐字一致，不同 seed 相位不同', () => {
    const mk = () => createPollingClient({ ...inj(), clients: 8 })
    const a = mk().feed({})
    const b = mk().feed({})
    expect(a).toEqual(b)
    const other = createPollingClient({ seed: 999, now: fixedNow(), clients: 8 }).feed({})
    expect(other.perceivedDelay).not.toBe(a.perceivedDelay) // 不同相位 ⇒ 不同延迟均值
  })

  /* ---------------- ③ LongPolling 长轮询 ---------------- */
  it('⑥ LongPolling 变更近零延迟、无变更零空转，但每客户端一只挂起连接 + 空闲超时重连', () => {
    const c = createLongPollingClient({ ...inj(), clients: 8, lpTimeoutMs: 2000, windowMs: 10000 })
    const ok = c.feed({})
    expect(ok.protocol).toBe('LongPolling')
    expect(ok.perceivedDelay).toBe(0)
    expect(ok.idleFetches).toBe(0)
    expect(ok.connections).toBe(8)               // 连接常驻 = 客户端数
    expect(ok.reconnects).toBe(5)                // floor(10000/2000)
    const idle = c.feed({ idle: true })
    expect(idle.idleFetches).toBe(0)
    expect(idle.reconnects).toBe(5)              // 空闲也超时重连（隐性成本）
  })
  it('⑦ LongPolling 中心宕：挂起请求全断、不可降级、staleClients 满', () => {
    const c = createLongPollingClient({ ...inj(), clients: 8 })
    const r = c.feed({ centerDown: true })
    expect(r.centerBroken).toBe(true)
    expect(r.degraded).toBe(false)               // 无本地续命策略
    expect(r.staleClients).toBe(8)
    expect(r.perceivedDelay).toBe(0)             // 中心宕归可降级维、不罚即时维（正交化）
  })
  it('⑧ LongPolling manyClients fanout：connections 随客户端规模线性放大', () => {
    const c = createLongPollingClient({ ...inj(), clients: 8, manyClients: 200 })
    const r = c.feed({ manyClients: true })
    expect(r.clients).toBe(200)
    expect(r.connections).toBe(200)
  })

  /* ---------------- ④ WatchPush watch 推送 ---------------- */
  it('⑨ WatchPush 变更即时、连接按需稳态复用（零超时重连）、无空转', () => {
    const c = createWatchPushClient({ ...inj(), clients: 8 })
    const r = c.feed({})
    expect(r.protocol).toBe('WatchPush')
    expect(r.perceivedDelay).toBe(0)
    expect(r.idleFetches).toBe(0)
    expect(r.connections).toBe(8)                // 须可寻址注册
    expect(r.reconnects).toBe(0)                 // 稳态复用：无长轮询式超时重连
    expect(r.versionGaps).toBe(0)
  })
  it('⑩ WatchPush 广播风暴削峰：合并延迟 + 版本号兜底缺口；noBurst 抹掉', () => {
    const c = createWatchPushClient({ ...inj(), clients: 8, burstCount: 12, burstCoalesceMs: 300 })
    const r = c.feed({ burst: true })
    expect(r.coalesced).toBeGreaterThan(0)
    expect(r.perceivedDelay).toBeGreaterThan(0)  // 削峰 ⇒ 即时感知不总成立
    expect(r.versionGaps).toBeGreaterThan(0)     // reorder/丢失须版本号兜底
    const flat = createWatchPushClient({ ...inj(), noBurst: true }).feed({ burst: true })
    expect(flat.coalesced).toBe(0)
    expect(flat.perceivedDelay).toBe(0)
    expect(flat.versionGaps).toBe(0)
  })
  it('⑪ WatchPush 中心宕：须可寻址注册、中心一挂全断、不可降级', () => {
    const c = createWatchPushClient({ ...inj(), clients: 8 })
    const r = c.feed({ centerDown: true })
    expect(r.centerBroken).toBe(true)
    expect(r.degraded).toBe(false)
    expect(r.staleClients).toBe(8)
  })
  it('⑫ WatchPush 注入确定性 + reset PRNG 归零', () => {
    const mk = () => createWatchPushClient({ ...inj(), clients: 8 })
    const c = mk()
    const a = c.feed({ burst: true })
    c.feed({ burst: true })                      // 推进一次 PRNG
    c.reset()
    expect(c.feed({ burst: true })).toEqual(a)   // reset 归零内部 PRNG ⇒ 复现
  })

  /* ---------------- ⑤ 六场景 × 三难向量 ---------------- */
  it('⑬ 三协议 × 六场景默认向量 Polling=100 / LongPolling=011 / WatchPush=010，三者互异', async () => {
    const cmp = await compareConfigConsistency(inj())
    expect(cmp.vectors).toEqual({ Polling: '100', LongPolling: '011', WatchPush: '010' })
    expect(new Set(Object.values(cmp.vectors)).size).toBe(3)
    expect(cmp.verdict.trilemmaDistinguishes).toBe(true)
    expect(cmp.verdict.noProtocolWinsAll).toBe(true)
    expect(cmp.verdict.noUniversalWinner).toBe(true)
  })
  it('⑭ 维度语义：Polling 唯一占可降级、LongPolling 占无空闲+即时、Watch 只占无空闲（缺两难）', async () => {
    const cmp = await compareConfigConsistency(inj())
    const [polling, longPolling, watch] = cmp.rows
    expect(polling.trilemma).toEqual({ degradeOnCenterDown: true, noIdleOverhead: false, instantPerceive: false })
    expect(longPolling.trilemma).toEqual({ degradeOnCenterDown: false, noIdleOverhead: true, instantPerceive: true })
    expect(watch.trilemma).toEqual({ degradeOnCenterDown: false, noIdleOverhead: true, instantPerceive: false })
    // 不预设「各恰好缺一」：Polling 缺两难、Watch 缺两难、LongPolling 缺一难
    const ones = cmp.rows.map((r) => Object.values(r.trilemma).filter(Boolean).length)
    expect(ones).toEqual([1, 2, 1])
    expect(cmp.verdict.watchNotPanacea).toBe(true)
  })
  it('⑮ 六场景各打一处软肋：quickChange 迟 Polling / idleNoChange 空转 / centerDown 断推送 / burst 缺 Watch', async () => {
    const cmp = await compareConfigConsistency(inj())
    const cell = (p: number, s: string) => cmp.rows[p].scenarios.find((c) => c.id === s)!
    expect(cell(0, 'quickChange').perceivedDelay).toBeGreaterThan(0)      // Polling 迟
    expect(cell(0, 'idleNoChange').idleFetches).toBeGreaterThan(0)       // Polling 空
    expect(cell(1, 'centerDown').centerBroken).toBe(true)                // LongPolling 断
    expect(cell(2, 'centerDown').centerBroken).toBe(true)                // Watch 断
    expect(cell(2, 'burstChanges').versionGaps).toBeGreaterThan(0)       // Watch 缺
    expect(cell(0, 'centerDown').degraded).toBe(true)                    // Polling 可降级
  })
  it('⑯ run 层输入校验 + 三协议专有字段形状齐、缺席者 ?? 0 归一、判词全有限数', () => {
    expect(() => runConfigConsistencyScenario('Nope', 'allOk', inj())).toThrow(/未知协议/)
    expect(() => runConfigConsistencyScenario('Polling', 'Nope', inj())).toThrow(/未知场景/)
    const fields = [
      'perceivedDelay', 'idleFetches', 'connections', 'reconnects', 'versionGaps', 'staleClients', 'coalesced',
    ]
    for (const p of DCC_PROTOCOLS) for (const s of DCC_SCENARIOS) {
      const c = runConfigConsistencyScenario(p, s, inj())
      for (const f of fields) expect(Number.isFinite((c as any)[f])).toBe(true)
      expect(typeof c.degradeOnCenterDown).toBe('boolean')
      expect(typeof c.noIdleOverhead).toBe('boolean')
      expect(typeof c.instantPerceive).toBe('boolean')
    }
  })

  /* ---------------- ⑥ rigged 可证伪 ---------------- */
  it('⑰ rigged 三开关 + faults 全空 ⇒ 三协议全 111、三判词同时翻 false', async () => {
    const r = await compareConfigConsistency({ ...inj(), rigged: true, faults: riggedFaults() })
    expect(r.vectors).toEqual({ Polling: '111', LongPolling: '111', WatchPush: '111' })
    expect(r.verdict.trilemmaDistinguishes).toBe(false)
    expect(r.verdict.noProtocolWinsAll).toBe(false)
    expect(r.verdict.noUniversalWinner).toBe(false)
    expect(r.config.rigged).toBe(true)
  })
  it('⑱ 显式等价三开关（pollingInstant+centerAlwaysUp+noBurst）+ fault 全空同样可证伪', async () => {
    const r = await compareConfigConsistency({
      ...inj(), pollingInstant: true, centerAlwaysUp: true, noBurst: true, faults: riggedFaults(),
    })
    expect(Object.values(r.vectors).every((v) => v === '111')).toBe(true)
    expect(r.verdict.noUniversalWinner).toBe(false)
  })
  it('⑲ rigged 单开关不足：仅 pollingInstant 抹掉 Polling 延迟但抹不掉其空转软肋、更抹不掉 Watch 风暴', async () => {
    const r = await compareConfigConsistency({ ...inj(), pollingInstant: true })
    // 「瞬时轮询」≠「零空转」：周期趋零反而空转更猛 ⇒ Polling 仍缺「无空闲」维 = 101。
    expect(r.vectors.Polling).toBe('101')
    expect(r.vectors.WatchPush).toBe('010')      // Watch 不受 pollingInstant 影响
    expect(r.verdict.noUniversalWinner).toBe(true)
  })

  /* ---------------- ⑦ 真依赖交叉印证 ---------------- */
  it('⑳ 真 spring-config-server：响应带 version、state 恒 null、查找优先级、版本链单调、不声称真 rollback', async () => {
    const cx = (await compareConfigConsistency(inj())).crosscheck.configServer
    expect(cx.source).toContain('真件')
    expect(cx.responseVersion).toBe('2')
    expect(cx.stateIsNull).toBe(true)            // 快照语义、不热刷新（补 KI-480 缺口）
    expect(cx.propertySources).toBe(1)
    expect(cx.pickedPriorityVersion).toBe('3')   // app-profile 优先于 app / application
    expect(cx.versionChainMonotonic).toBe(true)
    expect(cx.rollbackDirectlyImported).toBe(false) // 诚实：不声称读到闭包内 configHistory
  })
  it('㉑ 真 startConfigWatcher + 真 bus：首趟纯 mtime 播种（不读内容/不吐事件）、stop 清定时器', async () => {
    const cx = (await compareConfigConsistency(inj())).crosscheck.configWatcher
    expect(cx.available).toBe(true)              // 本机 fs 可用
    expect(cx.contentLoadedOnFirstPass).toBe(false) // 真件首趟在读文件前就 continue：只登记 mtime
    expect(cx.seededNoEvents).toBe(true)         // onChange=0 且 bus=0 且未读内容
    expect(cx.firstPassOnChange).toBe(0)
    expect(cx.firstPassBusEvents).toBe(0)
    expect(cx.intervalStopped).toBe(true)
  })
  it('㉒ 真 createBus 发布/订阅事件链（补 KI-479：有内存事件链、非真 socket）', async () => {
    const cx = (await compareConfigConsistency(inj())).crosscheck.bus
    expect(cx.eventChainWorks).toBe(true)
    expect(cx.delivered).toBe(1)
    expect(cx.listenerCount).toBe(1)
    expect(cx.firstPayloadVersion).toBe('2')
  })
  it('㉓ 真 hashSelector 同 key 必落同桶、所有桶落在 [0,1)', async () => {
    const cx = (await compareConfigConsistency(inj())).crosscheck.gray
    expect(cx.keys).toBe(64)
    expect(cx.stableBuckets).toBe(64)            // 双跑逐 key 一致 = 会话亲和可复现
    expect(cx.allInUnitRange).toBe(true)
  })
  it('㉔ 真 shouldEarlyExpire XFetch 判据随 age→TTL 单调升', async () => {
    const cx = (await compareConfigConsistency(inj())).crosscheck.guard
    expect(cx.youngEarly).toBe(false)
    expect(cx.oldEarly).toBe(true)
    expect(cx.monotonic).toBe(true)
  })
  it('㉕ 真 createRedisCache TTL 惰性失效计数：越过 TTL 全部按 miss 计 expired', async () => {
    const cx = (await compareConfigConsistency({ ...inj(), clients: 8 })).crosscheck.redisCache
    expect(cx.seeded).toBe(8)
    expect(cx.missedAfterTtl).toBe(8)
    expect(cx.expiredCount).toBe(8)
    expect(cx.lazyExpiredAll).toBe(true)
  })
  it('㉖ 真 createHashRing 分布：节点数/fanout 规模/极差/balanceRatio 形状齐', async () => {
    const cx = (await compareConfigConsistency(inj())).crosscheck.ring
    expect(cx.source).toContain('真件')
    expect(cx.nodes).toBe(4)
    expect(cx.keys).toBe(512)
    expect(cx.fanoutClients).toBe(DCC_DEFAULTS.manyClients)
    expect(Number.isFinite(cx.spread)).toBe(true)
    expect(Number.isInteger(cx.emptyNodes)).toBe(true)
    expect(cx.balanceRatio === null || Number.isFinite(cx.balanceRatio)).toBe(true)
  })

  /* ---------------- ⑧ study / snapshot / 注入 / CLI ---------------- */
  it('㉗ study 纯数据可 JSON 往返、builtAt 现取注入时钟、topology 形状齐', async () => {
    const study = await configConsistencyStudy({ ...inj(), now: () => 9999 })
    expect(study.builtAt).toBe(9999)
    const round = JSON.parse(JSON.stringify(study))
    expect(round).toEqual(study)
    expect(study.topology).toMatchObject({
      clients: DCC_DEFAULTS.clients, manyClients: DCC_DEFAULTS.manyClients,
      pollIntervalMs: DCC_DEFAULTS.pollIntervalMs, windowMs: DCC_DEFAULTS.windowMs,
    })
  })
  it('㉘ dccSnapshot 投影结构齐、null/缺 rows 诚实降级、不连坐', async () => {
    const study = await configConsistencyStudy(inj())
    const snap = dccSnapshot(study)!
    expect(snap.builtAt).toBe(1000)
    expect(snap.rows).toHaveLength(3)
    expect(Object.keys(snap.crosscheck).sort()).toEqual(
      ['bus', 'configServer', 'configWatcher', 'gray', 'guard', 'redisCache', 'ring'],
    )
    expect(dccSnapshot(null)).toBeNull()
    expect(dccSnapshot(undefined)).toBeNull()
    expect(dccSnapshot({} as any)).toBeNull()
    expect(dccSnapshot({ rows: 'bad' } as any)).toBeNull()
  })
  it('㉙ CLI 固定时钟双跑字节一致（结构计数模型、非墙钟跑分）', () => {
    const script = path.resolve(__dirname, '../../scripts/caesura-config-consistency.mjs')
    const run = () => execFileSync(process.execPath, [script], { encoding: 'utf8' })
    const a = run()
    const b = run()
    expect(a).toBe(b)
    expect(a).toContain('"Polling":"100","LongPolling":"011","WatchPush":"010"')
    expect(a).toContain('RIGGED_FALSIFIABLE_OK')
    expect(a).toContain('真watcher首趟无事件=true')
  })
})
