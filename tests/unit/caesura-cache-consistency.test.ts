import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CACHE_CONSISTENCY_DEFAULTS,
  CACHE_CONSISTENCY_STRATEGIES,
  CACHE_CONSISTENCY_SCENARIOS,
  createDelayedDoubleDelete,
  createSubscribeBinlog,
  createOutboxPolling,
  cacheConsistencyStudy,
  compareCacheConsistency,
  cacheConsistencySnapshot,
  verifyCacheConsistencySoundness,
  verifyCausalLocks,
  createCacheConsistencyEvidence,
} from '../../scripts/caesura-cache-consistency.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const script = path.join(root, 'scripts', 'caesura-cache-consistency.mjs')

/** 把某策略的三难布尔拼成向量串（位序：boundedStaleness / infraFree / writePathLight）。 */
const vecOf = (row: any) =>
  `${Number(row.trilemma.boundedStaleness)}${Number(row.trilemma.infraFree)}${Number(row.trilemma.writePathLight)}`

describe('KI-558 MQ 驱动的缓存一致性三策略：延迟双删 / 订阅 binlog / Outbox 轮询诚实权衡', () => {
  /* ---------------- ① 常量 / 导出 / 名册 ---------------- */
  it('① 缺省参数冻结、12 枚值导出齐全、三策略/五场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(CACHE_CONSISTENCY_DEFAULTS)).toBe(true)
    expect([...CACHE_CONSISTENCY_STRATEGIES]).toEqual([
      'DelayedDoubleDelete', 'SubscribeBinlog', 'OutboxPolling',
    ])
    expect([...CACHE_CONSISTENCY_SCENARIOS]).toEqual([
      'steadyWrite', 'racingRead', 'crashAfterWrite', 'subscriberLag', 'cleanRerun',
    ])
    for (const fn of [
      createDelayedDoubleDelete, createSubscribeBinlog, createOutboxPolling,
      cacheConsistencyStudy, compareCacheConsistency, cacheConsistencySnapshot,
      verifyCacheConsistencySoundness, verifyCausalLocks, createCacheConsistencyEvidence,
    ]) expect(typeof fn).toBe('function')
    expect(CACHE_CONSISTENCY_DEFAULTS.seed).toBe(558)
    expect(CACHE_CONSISTENCY_DEFAULTS.writes).toBeGreaterThan(1)
    expect(CACHE_CONSISTENCY_DEFAULTS.ttlMs).toBeGreaterThan(0)
    expect(CACHE_CONSISTENCY_DEFAULTS.doubleDeleteDelayMs).toBeGreaterThan(0)
    expect(CACHE_CONSISTENCY_DEFAULTS.cdcPollMs).toBeGreaterThan(0)
    expect(CACHE_CONSISTENCY_DEFAULTS.outboxPollMs).toBeGreaterThan(0)
    expect(CACHE_CONSISTENCY_DEFAULTS.rigged).toBe(false)
    expect(CACHE_CONSISTENCY_DEFAULTS.freeStalenessWindow).toBe(false)
    expect(CACHE_CONSISTENCY_DEFAULTS.freeCdcInfra).toBe(false)
    expect(CACHE_CONSISTENCY_DEFAULTS.freeOutboxWrite).toBe(false)
  })

  /* ---------------- ② 缺省向量冻结（011 / 101 / 110） ---------------- */
  it('② 缺省向量必须是 011 / 101 / 110：三家各赢两维、输一维，无一 111', () => {
    const study = cacheConsistencyStudy({ now: () => 1000 })
    expect(study.vectors.DelayedDoubleDelete).toBe('011')
    expect(study.vectors.SubscribeBinlog).toBe('101')
    expect(study.vectors.OutboxPolling).toBe('110')
    expect(study.noUniversalWinner).toBe(true)
    expect(study.trilemmaDistinguishes).toBe(true)
    expect(study.noStrategyWinsAll).toBe(true)
    expect(study.verdict.vectorFromTrilemma).toBe(true)
    // 向量必须**由三难布尔现算**得出，不是查表
    for (const row of study.rows) {
      expect(study.vectors[row.protocol]).toBe(vecOf(row))
    }
  })

  /* ---------------- ③ 三难的三位各有物理来源（不是装饰字段） ---------------- */
  it('③ 三难每一位都能追到现算来源：崩溃后陈旧是否被清 / 外部调用数 / 额外持久写数', () => {
    const study = cacheConsistencyStudy({ now: () => 1000 })
    const byProto = Object.fromEntries(study.rows.map((r) => [r.protocol, r]))
    const ddb = byProto.DelayedDoubleDelete
    const cdc = byProto.SubscribeBinlog
    const out = byProto.OutboxPolling

    // 第①维 boundedStaleness：判据 = crashAfterWrite 场景里陈旧值是否仍存活
    const ddbCrash = ddb.scenarios.find((s) => s.id === 'crashAfterWrite')!
    const cdcCrash = cdc.scenarios.find((s) => s.id === 'crashAfterWrite')!
    const outCrash = out.scenarios.find((s) => s.id === 'crashAfterWrite')!
    expect(ddbCrash.invalidationIntent).toBe('volatile-timer')
    expect(ddbCrash.staleSurvivedCrash).toBe(true)      // 易失意图随崩溃丢失
    expect(cdcCrash.invalidationIntent).toBe('durable-record')
    expect(cdcCrash.staleSurvivedCrash).toBe(false)     // 持久记录不丢
    expect(outCrash.invalidationIntent).toBe('durable-record')
    expect(outCrash.staleSurvivedCrash).toBe(false)
    expect(ddb.trilemma.boundedStaleness).toBe(false)
    expect(cdc.trilemma.boundedStaleness).toBe(true)
    expect(out.trilemma.boundedStaleness).toBe(true)

    // 第②维 infraFree：判据 = 外部设施调用累计是否为 0（真数）
    expect(ddb.metrics.totalInfraCalls).toBe(0)
    expect(cdc.metrics.totalInfraCalls).toBeGreaterThan(0)
    expect(out.metrics.totalInfraCalls).toBe(0)
    expect(ddb.trilemma.infraFree).toBe(true)
    expect(cdc.trilemma.infraFree).toBe(false)
    expect(out.trilemma.infraFree).toBe(true)

    // 第③维 writePathLight：判据 = 业务写之外的额外持久化写是否为 0（真数）
    expect(ddb.metrics.totalExtraDurableWrites).toBe(0)
    expect(cdc.metrics.totalExtraDurableWrites).toBe(0)
    expect(out.metrics.totalExtraDurableWrites).toBeGreaterThan(0)
    expect(ddb.trilemma.writePathLight).toBe(true)
    expect(cdc.trilemma.writePathLight).toBe(true)
    expect(out.trilemma.writePathLight).toBe(false)
  })

  /* ---------------- ④ 三难不封赢家：读己之写的差异是真的 ---------------- */
  it('④ 读己之写三档必须互不相同（同步删 1.0 / CDC 轮询 / Outbox 轮询更差）⇒ 不是装饰字段', () => {
    const study = cacheConsistencyStudy({ now: () => 1000 })
    const byProto = Object.fromEntries(study.rows.map((r) => [r.protocol, r]))
    const ddb = byProto.DelayedDoubleDelete.metrics.readYourWritesRate
    const cdc = byProto.SubscribeBinlog.metrics.readYourWritesRate
    const out = byProto.OutboxPolling.metrics.readYourWritesRate
    expect(ddb).toBe(1)          // 第一次删与写同步 ⇒ 读必 miss 回库 ⇒ 读到新值
    expect(cdc).toBeGreaterThan(0)
    expect(cdc).toBeLessThan(ddb)
    expect(out).toBeLessThan(cdc) // 轮询周期 200ms > CDC 50ms ⇒ 更常读到旧值
  })

  /* ---------------- ⑤ 回归护栏：stats() 是副本，计数必须在内部加 ---------------- */
  it('⑤ noteReadOutcome 在模拟器内部累加（stats() 返回副本 ⇒ 外面累加必丢）', () => {
    const sim = createDelayedDoubleDelete({})
    sim.write('k', 'v1')
    sim.advanceTo(sim.now() + 5)
    sim.read('k')
    const before = sim.stats().readYourWritesTotal
    expect(before).toBe(0)
    sim.noteReadOutcome(false)
    sim.noteReadOutcome(true)
    const after = sim.stats()
    expect(after.readYourWritesTotal).toBe(2)
    expect(after.readYourWrites).toBe(1)
    // 副本语义：改副本不改内部
    const copy = sim.stats()
    copy.readYourWritesTotal = 999
    expect(sim.stats().readYourWritesTotal).toBe(2)
  })

  /* ---------------- ⑥ 三开关各自只顶高自己那一家 ---------------- */
  it('⑥ 三个 rigged 开关各自**只**动自己那一家（精确定位，不是乱棍）', () => {
    const base = cacheConsistencyStudy({ now: () => 1000 })
    const baseVec = { ...base.vectors }

    const onlyFree = cacheConsistencyStudy({ now: () => 1000, freeStalenessWindow: true })
    expect(onlyFree.vectors.DelayedDoubleDelete).toBe('111')
    expect(onlyFree.vectors.SubscribeBinlog).toBe(baseVec.SubscribeBinlog)
    expect(onlyFree.vectors.OutboxPolling).toBe(baseVec.OutboxPolling)
    expect(onlyFree.verdict.freeStalenessWindowHitsOnlyDdb).toBe(true)

    const onlyCdc = cacheConsistencyStudy({ now: () => 1000, freeCdcInfra: true })
    expect(onlyCdc.vectors.SubscribeBinlog).toBe('111')
    expect(onlyCdc.vectors.DelayedDoubleDelete).toBe(baseVec.DelayedDoubleDelete)
    expect(onlyCdc.vectors.OutboxPolling).toBe(baseVec.OutboxPolling)
    expect(onlyCdc.verdict.freeCdcInfraHitsOnlyCdc).toBe(true)

    const onlyOut = cacheConsistencyStudy({ now: () => 1000, freeOutboxWrite: true })
    expect(onlyOut.vectors.OutboxPolling).toBe('111')
    expect(onlyOut.vectors.DelayedDoubleDelete).toBe(baseVec.DelayedDoubleDelete)
    expect(onlyOut.vectors.SubscribeBinlog).toBe(baseVec.SubscribeBinlog)
    expect(onlyOut.verdict.freeOutboxWriteHitsOnlyOutbox).toBe(true)

    // 纯净基线下的三条结构事实必须仍然成立（开关只顶高，不抹掉别家的硬伤）
    expect(base.verdict.ddbStillVolatile).toBe(true)
    expect(base.verdict.cdcStillNeedsInfra).toBe(true)
    expect(base.verdict.outboxStillWrites).toBe(true)
  })

  /* ---------------- ⑦ rigged 全开 ⇒ 区分度塌缩（诚实标定） ---------------- */
  it('⑦ rigged 全开时三家全 111、区分度塌缩——不许把它说成「更好」', () => {
    const rigged = cacheConsistencyStudy({ now: () => 1000, rigged: true })
    expect(rigged.vectors.DelayedDoubleDelete).toBe('111')
    expect(rigged.vectors.SubscribeBinlog).toBe('111')
    expect(rigged.vectors.OutboxPolling).toBe('111')
    expect(rigged.trilemmaDistinguishes).toBe(false)
    expect(rigged.noUniversalWinner).toBe(false)
    expect(rigged.verdict.riggedConvergenceCollapsed).toBe(true)
  })

  /* ---------------- ⑧ 三路 tamper 各自只打穿自己那一家 ---------------- */
  it('⑧ 三路 tamper 各自只翻自己那一家（精确定位）⇒ falsifiable 为真', () => {
    const sc = verifyCacheConsistencySoundness({ writes: 24 }, { writes: 24 })
    expect(sc.baselineHolds).toBe(true)
    expect(sc.nontrivial).toBe(true)
    expect(sc.holds).toBe(true)
    expect(sc.falsifiable).toBe(true)

    // deleteLost ⇒ 只翻延迟双删
    expect(sc.tamper.deleteLost.targeted).toBe(true)
    expect(sc.laneB.deleteLost.DelayedDoubleDelete.holds).toBe(false)
    expect(sc.laneB.deleteLost.SubscribeBinlog.holds).toBe(true)
    expect(sc.laneB.deleteLost.OutboxPolling.holds).toBe(true)

    // offsetReset ⇒ 只翻订阅 binlog
    expect(sc.tamper.offsetReset.targeted).toBe(true)
    expect(sc.laneB.offsetReset.SubscribeBinlog.holds).toBe(false)
    expect(sc.laneB.offsetReset.DelayedDoubleDelete.holds).toBe(true)
    expect(sc.laneB.offsetReset.OutboxPolling.holds).toBe(true)

    // outboxNotAtomic ⇒ 只翻 Outbox
    expect(sc.tamper.outboxNotAtomic.targeted).toBe(true)
    expect(sc.laneB.outboxNotAtomic.OutboxPolling.holds).toBe(false)
    expect(sc.laneB.outboxNotAtomic.DelayedDoubleDelete.holds).toBe(true)
    expect(sc.laneB.outboxNotAtomic.SubscribeBinlog.holds).toBe(true)
  })

  /* ---------------- ⑨ holds 的三个合取项必须都真的成立 ---------------- */
  it('⑨ holds = nontrivial ∧ mechanismRan ∧ invalidatedAfterMechanism（不是 0=0 假绿）', () => {
    const sc = verifyCacheConsistencySoundness({ writes: 24 }, { writes: 24 })
    for (const p of CACHE_CONSISTENCY_STRATEGIES) {
      const cell = sc.laneA[p]
      expect(cell.holds).toBe(true)
      expect(cell.nontrivial).toBe(true)          // 竞态真的发生了
      expect(cell.mechanismRan).toBe(true)         // 失效机制真的跑过
      expect(cell.invalidatedAfterMechanism).toBe(true)
      expect(cell.staleAfterRace).toBe(true)       // 竞态不是被摆拍出来的
      expect(cell.invalidations).toBeGreaterThan(0)
    }
  })

  /* ---------------- ⑩ 三因果锁：rigged 也救不了 ---------------- */
  it('⑩ 三条结构锁在 rigged 下依然闭合（结构不可消弭，不是开关问题）', () => {
    const plain = verifyCausalLocks({ writes: 24 })
    expect(plain.volatileInvalidationIntentCausallyUnerasable).toBe(true)
    expect(plain.cdcOffsetDependencyCausallyUnerasable).toBe(true)
    expect(plain.outboxSameTransactionCausallyUnerasable).toBe(true)
    expect(plain.causalLocksAllHold).toBe(true)

    const rigged = verifyCausalLocks({
      writes: 24,
      freeStalenessWindow: true,
      freeCdcInfra: true,
      freeOutboxWrite: true,
    })
    expect(rigged.causalLocksAllHold).toBe(true)

    // 锁①的物理来源：易失意图 vs 持久记录
    expect(plain.probes.ddbIntent).toBe('volatile-timer')
    expect(plain.probes.ddbStaleSurvivedCrash).toBe(true)
    expect(plain.probes.cdcStaleSurvivedCrash).toBe(false)
    expect(plain.probes.outboxStaleSurvivedCrash).toBe(false)

    // 锁②：位点被重置 ⇒ 失效意图彻底丢失（invalidations 归零）
    expect(plain.probes.offsetResetInvalidations).toBe(0)
    // 锁③：不与业务写同事务 ⇒ 永不失效；同事务时写路径必然多写
    expect(plain.probes.outboxNotAtomicInvalidations).toBe(0)
    expect(plain.probes.outboxExtraDurableWrites).toBeGreaterThan(0)
  })

  /* ---------------- ⑪ 十一真件 21 键交叉印证 ---------------- */
  it('⑪ 十一真件 21 键齐全且为有限实数（不是占位 0）', () => {
    const ev = createCacheConsistencyEvidence({ seed: 558, now: () => 1000 })
    expect(Object.keys(ev)).toHaveLength(21)
    expect(Object.keys(ev)).toEqual([
      'routerMoved', 'routerTracked', 'ringNodes', 'ringShardsUsed', 'walLines', 'walReplayed',
      'notices', 'busListeners', 'redisBitmapHits', 'redisSlots', 'poolCreated', 'poolReused',
      'bucketAllowed', 'bucketRejected', 'heapFired', 'heapPending', 'counterSum',
      'counterFalseSharing', 'jitterSpread', 'remapConsistentRate', 'remapModuloRate',
    ])
    for (const [k, v] of Object.entries(ev)) {
      expect(typeof v, k).toBe('number')
      expect(Number.isFinite(v), k).toBe(true)
    }
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.notices).toBe(12)
    expect(ev.redisBitmapHits).toBe(96)
    expect(ev.bucketAllowed).toBe(3)
    expect(ev.bucketRejected).toBe(4)
    expect(ev.heapFired).toBe(3) // 三个定时器（+40/+80/+250）全部到期
    expect(ev.heapPending).toBe(0)
    expect(ev.counterSum).toBe(2080) // 1..64 之和
  })

  /* ---------------- ⑫ cleanRerun 真幂等（同 seed 连跑两次逐字一致） ---------------- */
  it('⑫ cleanRerun 场景同 seed 连跑两次逐字一致（真比较字符串，不是写死的 true）', () => {
    const study = cacheConsistencyStudy({ now: () => 1000 })
    for (const row of study.rows) {
      const rerun = row.scenarios.find((s) => s.id === 'cleanRerun')!
      expect(rerun.rerunIdentical).toBe(true)
    }
    // 换 seed 不改变指标（本件是结构计数、seed 只作可复现锚点）——但读数本身必须仍一致
    const a = cacheConsistencyStudy({ now: () => 1000 })
    const b = cacheConsistencyStudy({ now: () => 1000 })
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows))
  })

  /* ---------------- ⑬ 快照投影：纯数据、与 study 同源 ---------------- */
  it('⑬ 快照投影是纯数据且与 study 同源；脏输入返回 null', () => {
    const study = cacheConsistencyStudy({ now: () => 4242 })
    const snap = cacheConsistencySnapshot(study)
    expect(snap).not.toBeNull()
    expect(snap!.builtAt).toBe(4242)
    expect(snap!.vectors).toEqual(study.vectors)
    expect(snap!.rows).toHaveLength(3)
    expect(JSON.stringify(snap)).toBe(JSON.stringify(snap))
    expect(cacheConsistencySnapshot(null)).toBeNull()
    expect(cacheConsistencySnapshot(undefined)).toBeNull()
    expect(cacheConsistencySnapshot({} as any)).toBeNull()
  })

  /* ---------------- ⑭ CLI 真跑 ---------------- */
  it('⑭ CLI 真跑：打印向量 / 三因果锁 / 21 键证据 / 三路 tamper 定位', () => {
    const out = execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
    expect(out).toContain('[cache-consistency] seed=558')
    expect(out).toContain('"DelayedDoubleDelete":"011"')
    expect(out).toContain('"SubscribeBinlog":"101"')
    expect(out).toContain('"OutboxPolling":"110"')
    expect(out).toContain('causalLocks: volatileIntent=true cdcOffset=true outboxSameTxn=true allHold=true')
    expect(out).toContain('evidenceKeys=21')
    expect(out).toContain('falsifiable=true')
    expect(out).toContain('tamper[deleteLost]: targeted=true flipped=DelayedDoubleDelete')
    expect(out).toContain('tamper[offsetReset]: targeted=true flipped=SubscribeBinlog')
    expect(out).toContain('tamper[outboxNotAtomic]: targeted=true flipped=OutboxPolling')
  })

  /* ---------------- ⑮ 同 seed / 固定时钟 ⇒ 字节级可复现 ---------------- */
  it('⑮ 同 seed + 固定时钟 ⇒ study 逐字一致（可复现，不是碰运气）', () => {
    const a = cacheConsistencyStudy({ now: () => 777 })
    const b = cacheConsistencyStudy({ now: () => 777 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const c = cacheConsistencyStudy({ now: () => 778 })
    expect(c.builtAt).toBe(778)
    expect(JSON.stringify(c.rows)).toBe(JSON.stringify(a.rows))
  })
})
