import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import {
  CCC_DEFAULTS,
  CCC_PROTOCOLS,
  CCC_SCENARIOS,
  createCacheAsideStore,
  createWriteThroughStore,
  createWriteBehindStore,
  runCacheCoherencyScenario,
  compareCacheCoherency,
  cacheCoherencyStudy,
  cccSnapshot,
} from '../../scripts/caesura-cache-coherency.mjs'

/** 固定时钟 + 固定 seed：本件是确定性故障场景结构计数、非墙钟/QPS 跑分，注入不影响任何判词。 */
const fixedNow = () => () => 1000
const inj = () => ({ seed: 512, now: fixedNow() })
const riggedOpts = () => ({
  ...inj(), rigged: true, faults: CCC_SCENARIOS.map(() => ({})),
})
/** 把某协议某场景格子的三难布尔拼成向量串。 */
const vecOf = (row: any) =>
  `${Number(row.trilemma.readYourWrites)}${Number(row.trilemma.noWriteBlocking)}${Number(row.trilemma.durableOnCrash)}`

describe('KI-512 分布式缓存读写一致性：Cache-Aside / Write-Through / Write-Behind 三协议诚实权衡', () => {
  /* ---------------- ① 常量 / 导出 / 名册 ---------------- */
  it('① 缺省参数冻结、10 枚值导出齐全、三协议/六场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(CCC_DEFAULTS)).toBe(true)
    expect([...CCC_PROTOCOLS]).toEqual(['CacheAside', 'WriteThrough', 'WriteBehind'])
    expect([...CCC_SCENARIOS]).toEqual([
      'allOk', 'readAfterWrite', 'writeHeavy', 'cacheCrash', 'asyncFlush', 'manyKeys',
    ])
    for (const fn of [
      createCacheAsideStore, createWriteThroughStore, createWriteBehindStore,
      runCacheCoherencyScenario, compareCacheCoherency, cacheCoherencyStudy, cccSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(CCC_DEFAULTS.writes).toBeGreaterThan(1)
    expect(CCC_DEFAULTS.manyKeys).toBeGreaterThan(CCC_DEFAULTS.writes)
    expect(CCC_DEFAULTS.backendRttMs).toBeGreaterThan(0)
    expect(CCC_DEFAULTS.flushThreshold).toBeGreaterThan(0)
    expect(CCC_DEFAULTS.windowMs).toBeGreaterThan(0)
    expect(CCC_DEFAULTS.rigged).toBe(false)
    expect(CCC_DEFAULTS.walEnabled).toBe(false)
    expect(CCC_DEFAULTS.seed).toBeGreaterThan(0)
  })

  /* ---------------- ②~⑤ Cache-Aside 旁路缓存 ---------------- */
  it('② Cache-Aside 常态：每次写同步更库（writeBackendRounds=writes）、有非原子窗口', () => {
    const c = createCacheAsideStore({ ...inj(), writes: 8, backendRttMs: 40 })
    const ok = c.feed({})
    expect(ok.protocol).toBe('CacheAside')
    expect(ok.writeBackendRounds).toBe(8)         // 写路径必打库 ⇒ 阻塞
    expect(ok.writeBackendRttMs).toBeGreaterThan(0)
    expect(ok.staleWindowMs).toBeGreaterThan(0)   // 更库/删缓存非原子窗口
    expect(ok.dirtyPagesLost).toBe(0)             // 写已落库 ⇒ 缓存无未刷回脏页
    expect(ok.staleReads).toBe(0)                 // 基线无并发读探针
  })

  it('③ Cache-Aside readAfterWrite 探针：窗口内并发读命中旧值（staleReads>0）', () => {
    const c = createCacheAsideStore({ ...inj(), writes: 12 })
    let totalStale = 0
    for (let i = 0; i < 8; i++) totalStale += c.feed({ readAfterWrite: true }).staleReads
    expect(totalStale).toBeGreaterThan(0)         // 相位抖动下必有一部分写被窗口内读到旧值
  })

  it('④ Cache-Aside 无中心故障也 durable：任何场景都不丢写（写已同步落库）', () => {
    const c = createCacheAsideStore(inj())
    expect(c.protocol).toBe('CacheAside')
    for (const id of CCC_SCENARIOS) {
      const cell = runCacheCoherencyScenario('CacheAside', id, inj())
      expect(cell.dirtyPagesLost).toBe(0)
      expect(cell.durableOnCrash).toBe(true)
    }
  })

  it('⑤ Cache-Aside reset 归零 observable + 内部 PRNG：同实例 reset 后重跑逐字一致', () => {
    const c = createCacheAsideStore({ ...inj(), writes: 12 })
    const a = c.feed({ readAfterWrite: true })
    const countA = c.observableCount
    c.reset()
    expect(c.observableCount).toBe(0)
    const b = c.feed({ readAfterWrite: true })
    expect(b).toEqual(a)
    expect(c.observableCount).toBe(countA)
  })

  /* ---------------- ⑥~⑨ Write-Through 写穿透 ---------------- */
  it('⑥ Write-Through 常态：每写一次同步写穿一次库、始终一致、不丢写', () => {
    const c = createWriteThroughStore({ ...inj(), writes: 6, backendRttMs: 40 })
    const ok = c.feed({})
    expect(ok.protocol).toBe('WriteThrough')
    expect(ok.writeBackendRounds).toBe(6)         // 每写一次同步穿透
    expect(ok.writeBackendRttMs).toBe(6 * 40)     // 后端越慢写越阻塞
    expect(ok.staleWindowMs).toBe(0)              // 同步双写、无窗口
    expect(ok.staleReads).toBe(0)
    expect(ok.dirtyPagesLost).toBe(0)             // 落库才返回
    expect(ok.coalescedWrites).toBe(0)
  })

  it('⑦ Write-Through writeHeavy 探针：写次数放大 ⇒ 后端 RTT 线性累积', () => {
    const base = runCacheCoherencyScenario('WriteThrough', 'allOk', inj())
    const heavy = runCacheCoherencyScenario('WriteThrough', 'writeHeavy', inj())
    expect(heavy.writeBackendRounds).toBeGreaterThan(base.writeBackendRounds)
    expect(heavy.writeBackendRttMs).toBeGreaterThan(base.writeBackendRttMs)
    expect(heavy.staleWindowMs).toBe(0)           // 放大写不破坏一致性
  })

  it('⑧ Write-Through 后端零 RTT 注入 ⇒ 写阻塞维翻 true（rigged 单维成因）', () => {
    const blocked = runCacheCoherencyScenario('WriteThrough', 'allOk', inj())
    expect(blocked.noWriteBlocking).toBe(false)
    const freed = runCacheCoherencyScenario('WriteThrough', 'allOk', { ...inj(), noWriteBackendRtt: true })
    expect(freed.noWriteBlocking).toBe(true)
    // 但一致性/持久两维不受影响
    expect(freed.readYourWrites).toBe(true)
    expect(freed.durableOnCrash).toBe(true)
  })

  it('⑨ Write-Through reset 归零 observable', () => {
    const c = createWriteThroughStore(inj())
    c.feed({}); c.feed({})
    expect(c.observableCount).toBe(2)
    c.reset()
    expect(c.observableCount).toBe(0)
    expect(c.feed({})).toEqual(c.feed({}))
  })

  /* ---------------- ⑩~⑮ Write-Behind 写回 ---------------- */
  it('⑩ Write-Behind 常态：写路径零后端往返、同 key 写合并、写后读缓存是新值', () => {
    const c = createWriteBehindStore({ ...inj(), writes: 8, flushThreshold: 4 })
    const ok = c.feed({})
    expect(ok.protocol).toBe('WriteBehind')
    expect(ok.writeBackendRounds).toBe(0)         // 异步刷回、写路径不阻塞
    expect(ok.writeBackendRttMs).toBe(0)
    expect(ok.coalescedWrites).toBeGreaterThan(0) // 多写合并成一批
    expect(ok.staleWindowMs).toBe(0)              // 写后立即读缓存是新值
    expect(ok.staleReads).toBe(0)
    expect(ok.dirtyPagesLost).toBe(0)             // 不宕不丢
  })

  it('⑪ Write-Behind cacheCrash 探针：整机宕 ⇒ 未刷回脏页全丢（durable 维翻 false）', () => {
    const cell = runCacheCoherencyScenario('WriteBehind', 'cacheCrash', inj())
    expect(cell.crashed).toBe(true)
    expect(cell.dirtyPagesLost).toBeGreaterThan(0)
    expect(cell.durableOnCrash).toBe(false)
    // 判定正交化：整机宕是持久性问题，不连带罚「写后读可见」
    expect(cell.readYourWrites).toBe(true)
    expect(cell.noWriteBlocking).toBe(true)
  })

  it('⑫ Write-Behind 判定正交化：cacheCrash 只罚 durable 维、不连坐 readYourWrites/noWriteBlocking', () => {
    const ok = runCacheCoherencyScenario('WriteBehind', 'allOk', inj())
    const crash = runCacheCoherencyScenario('WriteBehind', 'cacheCrash', inj())
    expect(ok.readYourWrites).toBe(crash.readYourWrites)
    expect(ok.noWriteBlocking).toBe(crash.noWriteBlocking)
    expect(ok.durableOnCrash).toBe(true)
    expect(crash.durableOnCrash).toBe(false)
  })

  it('⑬ 关键诚实：单开 walEnabled（仅进程内 WAL）抹不掉 durable 维——整机+盘一起丢仍丢', () => {
    const withWal = runCacheCoherencyScenario('WriteBehind', 'cacheCrash', { ...inj(), walEnabled: true })
    expect(withWal.walEnabled).toBe(true)
    expect(withWal.crossNodeReplicated).toBe(false)
    expect(withWal.dirtyPagesLost).toBeGreaterThan(0)
    expect(withWal.durableOnCrash).toBe(false)    // 呼应 KI-511「瞬时轮询≠零空转」
    // 即便整份 study 开 walEnabled，三难向量仍是 110（durable 维不翻）
  })

  it('⑬b 整份 study 开 walEnabled：WriteBehind 仍是 110，durable 维不翻', async () => {
    const cmp = await compareCacheCoherency({ ...inj(), walEnabled: true })
    const behind = cmp.rows.find((r) => r.protocol === 'WriteBehind')!
    expect(vecOf(behind)).toBe('110')
    expect(behind.trilemma.durableOnCrash).toBe(false)
    expect(cmp.config.walEnabled).toBe(true)
    expect(cmp.verdict.noUniversalWinner).toBe(true)
  })

  it('⑭ Write-Behind 确定性：同 seed 双跑读数逐字一致，注入 rand 相位可复现', () => {
    const mk = () => createWriteBehindStore({ ...inj(), writes: 12, flushThreshold: 4 })
    const a = mk().feed({})
    const b = mk().feed({})
    expect(a).toEqual(b)
    const custom = createWriteBehindStore({ ...inj(), rand: () => 0.42, writes: 12 }).feed({})
    expect(custom).toEqual(createWriteBehindStore({ ...inj(), rand: () => 0.42, writes: 12 }).feed({}))
  })

  it('⑮ Write-Behind reset 归零 observable + 内部 PRNG', () => {
    const c = createWriteBehindStore({ ...inj(), writes: 12 })
    const a = c.feed({ readAfterWrite: true })
    c.reset()
    expect(c.observableCount).toBe(0)
    expect(c.feed({ readAfterWrite: true })).toEqual(a)
  })

  /* ---------------- ⑯~⑱ 场景向量与不封赢家 ---------------- */
  it('⑯ 默认六场景三难向量 CacheAside=001 / WriteThrough=101 / WriteBehind=110（登记值）', async () => {
    const cmp = await compareCacheCoherency(inj())
    expect(Object.fromEntries(cmp.rows.map((r) => [r.protocol, vecOf(r)]))).toEqual({
      CacheAside: '001', WriteThrough: '101', WriteBehind: '110',
    })
    expect(cmp.verdict.noUniversalWinner).toBe(true)
    expect(cmp.verdict.trilemmaDistinguishes).toBe(true)
  })

  it('⑰ 不预设各恰好缺一：Cache-Aside 缺两难（只占 durable），另两只各缺一难', async () => {
    const cmp = await compareCacheCoherency(inj())
    const aside = cmp.rows.find((r) => r.protocol === 'CacheAside')!
    const through = cmp.rows.find((r) => r.protocol === 'WriteThrough')!
    const behind = cmp.rows.find((r) => r.protocol === 'WriteBehind')!
    // Cache-Aside：不写后可见 + 写阻塞，只 durable
    expect(aside.trilemma.readYourWrites).toBe(false)
    expect(aside.trilemma.noWriteBlocking).toBe(false)
    expect(aside.trilemma.durableOnCrash).toBe(true)
    // Write-Through：只缺写不阻塞
    expect(through.trilemma.readYourWrites).toBe(true)
    expect(through.trilemma.noWriteBlocking).toBe(false)
    expect(through.trilemma.durableOnCrash).toBe(true)
    // Write-Behind：只缺整机宕 durable
    expect(behind.trilemma.readYourWrites).toBe(true)
    expect(behind.trilemma.noWriteBlocking).toBe(true)
    expect(behind.trilemma.durableOnCrash).toBe(false)
  })

  it('⑱ Write-Behind 不是银弹：写延迟最低却以整机宕丢写为代价', async () => {
    const cmp = await compareCacheCoherency(inj())
    expect(cmp.verdict.behindNoWriteBlocking).toBe(true)
    expect(cmp.verdict.behindLosesDirtyOnCrash).toBe(true)
    expect(cmp.verdict.behindCoalescesWrites).toBe(true)
    expect(cmp.verdict.writeBehindNotPanacea).toBe(true)
    expect(cmp.verdict.asideHasStaleWindow).toBe(true)
    expect(cmp.verdict.throughBlocksOnBackend).toBe(true)
  })

  /* ---------------- ⑲~㉑ 可证伪 rigged ---------------- */
  it('⑲ rigged 三开关齐开 + fault 全空 ⇒ 三协议全 111、三判词同时翻 false', async () => {
    const cmp = await compareCacheCoherency(riggedOpts())
    for (const row of cmp.rows) expect(vecOf(row)).toBe('111')
    expect(cmp.verdict.trilemmaDistinguishes).toBe(false)
    expect(cmp.verdict.noProtocolWinsAll).toBe(false)
    expect(cmp.verdict.noUniversalWinner).toBe(false)
  })

  it('⑳ 单开关不足：只开 atomicInvalidate 不足以让三协议全 111', async () => {
    const cmp = await compareCacheCoherency({ ...inj(), atomicInvalidate: true })
    const aside = cmp.rows.find((r) => r.protocol === 'CacheAside')!
    // 单开 atomicInvalidate 只抹窗口可见性，抹不掉写阻塞 ⇒ aside 仍非 111
    expect(vecOf(aside)).not.toBe('111')
    expect(aside.trilemma.noWriteBlocking).toBe(false)
  })

  it('㉑ rigged 判定需 faults 全空：三开关齐开但 faults 带非探针故障不触发 rigged', async () => {
    const cmp = await compareCacheCoherency({
      ...inj(), atomicInvalidate: true, noWriteBackendRtt: true, atomicWriteBehind: true,
      faults: CCC_SCENARIOS.map((s) => (s === 'cacheCrash' ? { cacheCrash: true } : {})),
    })
    expect(cmp.config.rigged).toBe(false)
  })

  /* ---------------- ㉒~㉘ 真依赖交叉印证 / study / 快照 ---------------- */
  it('㉒ 七枚真件交叉印证块齐全、来源标注为「真件」', async () => {
    const cx = (await compareCacheCoherency(inj())).crosscheck
    expect(Object.keys(cx).sort()).toEqual(
      ['guard', 'mvcc', 'redis', 'ring', 'sharded', 'twoPhase', 'wal'],
    )
    for (const v of Object.values(cx)) expect((v as any).source).toMatch(/真件/)
  })

  it('㉓ 真 WAL 交叉印证：进程崩溃可恢复为真，但跨机复制=false、整机宕 durable=false', async () => {
    const cx = (await compareCacheCoherency(inj())).crosscheck.wal
    expect(cx.sinkIsArray).toBe(true)            // sink 是进程内数组
    expect(cx.lines).toBe(3)
    expect(cx.restored).toBe(3)
    expect(cx.replayed).toBe(3)
    expect(cx.replayOps).toEqual(['put', 'put', 'del'])
    expect(cx.processCrashRecoverable).toBe(true)
    expect(cx.replicatedAcrossNodes).toBe(false)
    expect(cx.wholeNodeLossDurable).toBe(false)
  })

  it('㉔ 真 Redis 写后读可见 + 真 MVCC 提交后才读新 + 真 XFetch 单调', async () => {
    const cx = (await compareCacheCoherency(inj())).crosscheck
    expect(cx.redis.writeThenReadSeesNew).toBe(true)
    expect(cx.redis.firstVersion).toBe('v1')
    expect(cx.redis.secondVersion).toBe('v2')
    expect(cx.redis.notRealRedis).toBe(true)
    expect(cx.mvcc.writeThenReadNeedsCommit).toBe(true)
    expect(cx.mvcc.beforeCommitVersion).toBe('v1')
    expect(cx.mvcc.afterCommitVersion).toBe('v2')
    expect(cx.mvcc.isolation).toBe('read-committed')
    expect(cx.guard.monotonic).toBe(true)
    expect(cx.guard.reducesProbabilityNotWindow).toBe(true)
  })

  it('㉕ 真 2PC 交叉印证：全 yes 提交、协调者 prepare 后宕 ⇒ 全员阻塞；非真 XA', async () => {
    const cx = (await compareCacheCoherency(inj())).crosscheck.twoPhase
    expect(cx.prepareAllYes).toBe(true)
    expect(cx.commitPhase).toBe('committed')
    expect(cx.commitMessages).toBeGreaterThan(0)
    expect(cx.downPhase).toBe('blocked')
    expect(cx.blockedParticipants).toBe(2)
    expect(cx.atomicCrossStoreNeedsCoordination).toBe(true)
    expect(cx.notRealXa).toBe(true)
  })

  it('㉖ 真分片缓存 + 真环：manyKeys 写落多片全可读、环分布有读数', async () => {
    const cx = (await compareCacheCoherency({ ...inj(), manyKeys: 200 })).crosscheck
    expect(cx.sharded.allReadable).toBe(true)
    expect(cx.sharded.shards).toBeGreaterThan(1)
    expect(cx.sharded.written).toBe(200)
    expect(cx.sharded.readHits).toBe(200)
    expect(cx.sharded.perShardHits.length).toBe(cx.sharded.shards)
    expect(cx.ring.keys).toBe(512)
    expect(cx.ring.nodes).toBe(4)
    expect(cx.ring.balanceRatio).toBeGreaterThanOrEqual(1)
  })

  it('㉗ study / cccSnapshot JSON 往返无损 + null 降级 + builtAt 注入口径', async () => {
    const study = await cacheCoherencyStudy(inj())
    expect(study.builtAt).toBe(1000)
    const round = JSON.parse(JSON.stringify(study))
    const snap = cccSnapshot(round)!
    expect(snap.rows).toHaveLength(3)
    expect(snap.vectors).toEqual({ CacheAside: '001', WriteThrough: '101', WriteBehind: '110' })
    expect(snap.topology.writes).toBe(CCC_DEFAULTS.writes)
    expect(cccSnapshot(null)).toBeNull()
    expect(cccSnapshot(undefined)).toBeNull()
    expect(cccSnapshot({} as any)).toBeNull()
    expect(cccSnapshot({ rows: 'bad' } as any)).toBeNull()
  })

  it('㉘ 场景名册可覆盖：scenarios 注入子集 ⇒ 矩阵按子集裁，不连坐默认判词', async () => {
    const cmp = await compareCacheCoherency({ ...inj(), scenarios: ['allOk', 'cacheCrash'] })
    expect(cmp.rows).toHaveLength(3)
    for (const row of cmp.rows) expect(row.scenarios).toHaveLength(2)
    expect(cmp.config.scenarios).toEqual(['allOk', 'cacheCrash'])
  })

  /* ---------------- ㉙ CLI 双跑字节一致 ---------------- */
  it('㉙ CLI 固定时钟双跑字节一致（结构计数模型、非墙钟跑分）', () => {
    const script = path.resolve(__dirname, '../../scripts/caesura-cache-coherency.mjs')
    const run = () => execFileSync(process.execPath, [script], { encoding: 'utf8' })
    const a = run()
    const b = run()
    expect(a).toBe(b)
    expect(a).toContain('"CacheAside":"001","WriteThrough":"101","WriteBehind":"110"')
    expect(a).toContain('RIGGED_FALSIFIABLE_OK')
    expect(a).toContain('真WAL进程崩溃可恢复=true 但跨机复制=false 整机宕durable=false')
  })
})
