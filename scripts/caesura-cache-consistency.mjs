/**
 * scripts/caesura-cache-consistency.mjs —— MQ 驱动的缓存一致性三策略教学件（KI-558，P8 第六十四件）。
 *
 * <p><b>为什么值得做这一件</b>：缓存与数据库的双写一致性是后端工程里最经典、也最容易被「随手一删」糊弄过去的题。
 * 真生产里三条主流路线各有硬伤，而三条路线**恰好各赢两维、输一维**：
 * 延迟双删（零外部设施、写路径不阻塞，但失效意图是**易失**的进程内任务）、
 * 订阅 binlog（陈旧窗口最小，但需要一套 CDC 基础设施）、
 * Outbox 轮询（零外部设施、失效意图持久，但写路径必须**多写一张表**）。
 * 本件把它们放进**同一台模拟器**（同一份 db / 同一份 cache / 同一个读路径）⇒
 * 差异**只**来自「失效怎么发生」，读数可比、因果可判。</p>
 *
 * <p><b>三难维序 [boundedStaleness / infraFree / writePathLight]</b>，三位**全部由模拟器现算**，零查表：</p>
 * <ul>
 *   <li><code>boundedStaleness</code>：陈旧窗口**由策略自身界定**——失效意图**持久化** ⇒ 进程崩溃后陈旧值仍会被清掉；
 *       若失效意图只活在进程内（易失定时器）⇒ 崩溃即永久丢失 ⇒ 只能靠 TTL 兜底 ⇒ 窗口不可由策略界定。
 *       判据 = <code>crashAfterWrite</code> 场景里陈旧值是否真的被清掉了（真跑，不写死）。</li>
 *   <li><code>infraFree</code>：全场景累计的**外部基础设施调用数**是否为 0（真数，不是声明）。</li>
 *   <li><code>writePathLight</code>：业务写之外**额外持久化写**的次数是否为 0（真数）。</li>
 * </ul>
 * <p>⇒ 默认向量 <b>DelayedDoubleDelete=011 / SubscribeBinlog=101 / OutboxPolling=110</b>，互异、无一 111、不封赢家。</p>
 *
 * <p><b>verifyCacheConsistencySoundness 唯一内核 + 三路可证伪</b>：内核只改「失效怎么发生」，
 * 三路 tamper <b>各自只打穿自己的那一家</b>（不是三家一起倒）：
 * ① <code>deleteLost</code>：延迟双删的第二次删除被抹掉（模拟延迟任务丢失）；
 * ② <code>offsetReset</code>：CDC 位点被重置到最新 ⇒ 中间事件永久跳过；
 * ③ <code>outboxNotAtomic</code>：outbox 行不在业务写的同一事务里 ⇒ 业务写成功但永不失效。
 * 三路喂回**同一条 holds 公式现算**；<code>falsifiable</code> 还额外要求「每路 tamper 恰好只翻自己那一家」
 * （若一路打穿三家 ⇒ 那不是精确定位，是乱棍）。</p>
 *
 * <p><b>三因果锁</b>：volatileInvalidationIntent / cdcOffsetDependency / outboxSameTransaction
 * —— 三条都是「结构上不可消弭」，任何 rigged 开关都救不了。</p>
 *
 * <p><b>不声称</b>：不接真 MySQL/Redis/Canal；不模拟真 binlog 格式与位点存储实现；不声称 Outbox 轮询「零延迟」；
 * 不声称延迟双删在生产不可用（它只是把窗口交给 TTL 兜底）；玩家运行时零 LLM。</p>
 *
 * @module caesura-cache-consistency
 */
import { pathToFileURL } from 'node:url'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'

/** 固定默认值（KI-558 系列同族） */
export const CACHE_CONSISTENCY_DEFAULTS = Object.freeze({
  seed: 558,
  writes: 24,
  /** 缓存 TTL（兜底 backstop；不是任何策略的一致性保证） */
  ttlMs: 5000,
  /** 延迟双删：第二次删除的延迟 */
  doubleDeleteDelayMs: 500,
  /** CDC 连接器轮询周期 */
  cdcPollMs: 50,
  /** Outbox 轮询周期 */
  outboxPollMs: 200,
  /** Outbox 额外持久化写的代价（毫秒） */
  outboxWriteCostMs: 2,
  /** 一次外部设施调用的代价（毫秒） */
  infraCallCostMs: 1,
  /** 下游滞后 */
  lagMs: 0,
  freeStalenessWindow: false,
  freeCdcInfra: false,
  freeOutboxWrite: false,
  rigged: false,
})

/** 三策略（顺序固定） */
export const CACHE_CONSISTENCY_STRATEGIES = Object.freeze(['DelayedDoubleDelete', 'SubscribeBinlog', 'OutboxPolling'])

/** 五正交场景 */
export const CACHE_CONSISTENCY_SCENARIOS = Object.freeze([
  'steadyWrite', 'racingRead', 'crashAfterWrite', 'subscriberLag', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

/** 三难向量（位序固定：boundedStaleness / infraFree / writePathLight） */
const vectorOf = (t) => (t.boundedStaleness ? '1' : '0') + (t.infraFree ? '1' : '0') + (t.writePathLight ? '1' : '0')

/*----------------------------------------------------- 模拟器内核 -----------------------------------------------------*/

/**
 * **同一台模拟器**：db（真值）+ cache（副本）+ 读路径，三策略共用。
 * 差异**只**来自「失效怎么发生」——这是本件读数可比的前提。
 *
 * <p>两个定时器队列是本件的关键建模：</p>
 * <ul>
 *   <li><b>appTimers（易失）</b>：进程内的延迟任务。进程崩溃 ⇒ **随进程一起消失**。
 *       延迟双删的「第二次删除」就登记在这里 ⇒ 崩溃即永久丢失。</li>
 *   <li><b>serviceTimers（持久侧）</b>：独立于本进程的服务（CDC 连接器 / outbox 轮询器）。
 *       本进程崩溃它们**仍在跑**（它们读的是持久记录）。</li>
 * </ul>
 * <p>「失效意图是否持久」这个结构差异，就是 <code>boundedStaleness</code> 那一维的物理来源。</p>
 */
function makeSim(protocol, opts = {}) {
  const D = CACHE_CONSISTENCY_DEFAULTS
  const cfg = {
    ttlMs: intOr(opts.ttlMs, D.ttlMs),
    doubleDeleteDelayMs: intOr(opts.doubleDeleteDelayMs, D.doubleDeleteDelayMs),
    cdcPollMs: intOr(opts.cdcPollMs, D.cdcPollMs),
    outboxPollMs: intOr(opts.outboxPollMs, D.outboxPollMs),
    outboxWriteCostMs: intOr(opts.outboxWriteCostMs, D.outboxWriteCostMs),
    infraCallCostMs: intOr(opts.infraCallCostMs, D.infraCallCostMs),
    lagMs: intOr(opts.lagMs, D.lagMs),
    tamper: typeof opts.tamper === 'string' ? opts.tamper : 'normal',
    freeStalenessWindow: opts.freeStalenessWindow === true,
    freeCdcInfra: opts.freeCdcInfra === true,
    freeOutboxWrite: opts.freeOutboxWrite === true,
  }

  let t = 0
  let version = 0
  let timers = []
  let cdcPollScheduled = false
  let outboxPollScheduled = false
  let pending = null
  const db = new Map()
  const cache = new Map()
  const binlog = []
  const outbox = []
  let cdcOffset = 0
  let crashed = false

  const m = {
    writes: 0, reads: 0, staleReads: 0, extraDurableWrites: 0, infraCalls: 0,
    invalidations: 0, maxStaleMs: 0, sumStaleMs: 0,
    readYourWrites: 0, readYourWritesTotal: 0,
  }

  const scheduleApp = (at, fn) => { timers.push({ at, fn, durable: false }) }
  const scheduleService = (at, fn) => { timers.push({ at, fn, durable: true }) }

  function advanceTo(target) {
    for (;;) {
      let idx = -1
      let bestAt = Infinity
      for (let i = 0; i < timers.length; i++) {
        if (timers[i].at <= target && timers[i].at < bestAt) { bestAt = timers[i].at; idx = i }
      }
      if (idx < 0) break
      const tm = timers.splice(idx, 1)[0]
      if (tm.at > t) t = tm.at
      tm.fn()
    }
    if (target > t) t = target
  }

  /** 崩溃：易失定时器随进程一起消失；持久侧（binlog / outbox 表）不受影响，服务定时器继续跑。 */
  function crash() {
    crashed = true
    timers = timers.filter((x) => x.durable)
  }

  function ensureCdcPoll() {
    if (cdcPollScheduled) return
    cdcPollScheduled = true
    scheduleService(t + cfg.cdcPollMs + cfg.lagMs, () => {
      cdcPollScheduled = false
      // 【篡改 offsetReset】位点被重置到最新 ⇒ 未消费的事件被永久跳过（失效意图丢失）。
      if (cfg.tamper === 'offsetReset') cdcOffset = binlog.length
      for (let i = cdcOffset; i < binlog.length; i++) {
        cache.delete(binlog[i].key)
        m.invalidations += 1
      }
      cdcOffset = binlog.length
      if (!cfg.freeCdcInfra) m.infraCalls += 1
      t += cfg.infraCallCostMs
    })
  }

  function ensureOutboxPoll() {
    if (outboxPollScheduled) return
    outboxPollScheduled = true
    scheduleService(t + cfg.outboxPollMs, () => {
      outboxPollScheduled = false
      const n = outbox.length
      for (let i = 0; i < n; i++) {
        cache.delete(outbox[i].key)
        m.invalidations += 1
      }
      outbox.length = 0
    })
  }

  function write(key, value) {
    version += 1
    db.set(key, { value, version, writtenAt: t })
    m.writes += 1
    if (protocol === 'DelayedDoubleDelete') {
      // 第一次删：与业务写同步（所以读己之写成立）。
      cache.delete(key)
      // 第二次删：延迟任务。**默认登记在易失队列** ⇒ 崩溃即丢 ⇒ 陈旧窗口只能靠 TTL 兜底。
      if (cfg.tamper !== 'deleteLost') {
        const at = t + cfg.doubleDeleteDelayMs
        if (cfg.freeStalenessWindow) {
          // 【rigged】第二次删除被「免费持久化」⇒ 崩溃后仍会清掉 ⇒ 陈旧窗口由策略自身界定。
          scheduleService(at, () => { cache.delete(key); m.invalidations += 1 })
        } else {
          scheduleApp(at, () => { cache.delete(key); m.invalidations += 1 })
        }
      }
    } else if (protocol === 'SubscribeBinlog') {
      // 失效意图**持久**：写进 binlog（DB 自己的日志）⇒ 崩溃不丢。
      binlog.push({ seq: binlog.length + 1, key, version })
      ensureCdcPoll()
    } else {
      // Outbox：与业务写**同一事务** ⇒ 持久。篡改 outboxNotAtomic ⇒ 行没落库 ⇒ 永不失效。
      if (cfg.tamper !== 'outboxNotAtomic') {
        outbox.push({ key, version })
        if (!cfg.freeOutboxWrite) m.extraDurableWrites += 1
      }
      ensureOutboxPoll()
    }
  }

  function read(key) {
    m.reads += 1
    const truth = db.get(key)
    const cur = cache.get(key)
    if (cur && cur.expiresAt > t) {
      if (truth && cur.version < truth.version) {
        m.staleReads += 1
        const staleMs = t - truth.writtenAt
        if (staleMs > m.maxStaleMs) m.maxStaleMs = staleMs
        m.sumStaleMs += staleMs
        return { value: cur.value, version: cur.version, stale: true, stalenessMs: staleMs }
      }
      return { value: cur.value, version: cur.version, stale: false, stalenessMs: 0 }
    }
    cache.delete(key)
    if (!truth) return { value: undefined, version: 0, stale: false, stalenessMs: 0 }
    cache.set(key, { value: truth.value, version: truth.version, storedAt: t, expiresAt: t + cfg.ttlMs })
    return { value: truth.value, version: truth.version, stale: false, stalenessMs: 0 }
  }

  /** 读的第一阶段：抓一份**当时的** DB 快照（真并发读会在写提交前取到旧值）。 */
  function readBegin(key) {
    const snap = db.get(key)
    pending = { key, value: snap ? snap.value : undefined, version: snap ? snap.version : 0 }
  }

  /** 读的第二阶段：把快照写回缓存。若期间有写提交 ⇒ 缓存里躺着一个**陈旧值**。 */
  function readCommit() {
    if (!pending) return false
    cache.set(pending.key, { value: pending.value, version: pending.version, storedAt: t, expiresAt: t + cfg.ttlMs })
    pending = null
    return true
  }

  return {
    protocol, cfg,
    now: () => t,
    write, read, readBegin, readCommit, advanceTo, crash,
    stats: () => ({ ...m }),
    /**
     * 登记一次「写后读」的结果。
     *
     * <p><b>为什么必须单独开这个口</b>：<code>stats()</code> 返回的是<b>副本</b>（<code>{ ...m }</code>），
     * 在外面做 <code>sim.stats().x += 1</code> 会写进临时对象然后被丢掉 ⇒ 指标永远停在 0 ⇒
     * 一个「看起来在算、实则恒为 0」的假指标。所以计数只能由模拟器内部自己加。</p>
     */
    noteReadOutcome: (stale) => {
      m.readYourWritesTotal += 1
      if (stale !== true) m.readYourWrites += 1
      return m.readYourWritesTotal
    },
    intent: () => ({
      kind: protocol === 'DelayedDoubleDelete' ? 'volatile-timer' : 'durable-record',
      durable: protocol !== 'DelayedDoubleDelete',
    }),
    crashed: () => crashed,
  }
}

/*----------------------------------------------------- 三策略出口 -----------------------------------------------------*/

/** 延迟双删：写 DB → 同步删缓存 → 延迟 D 再删一次。零外部设施、写路径不阻塞；第二次删除是**易失**的。 */
export function createDelayedDoubleDelete(opts = {}) {
  return makeSim('DelayedDoubleDelete', opts)
}

/** 订阅 binlog（Canal/Debezium 式）：写 DB → binlog → 外部连接器轮询 → 删缓存。窗口最小；需 CDC 基础设施。 */
export function createSubscribeBinlog(opts = {}) {
  return makeSim('SubscribeBinlog', opts)
}

/** Outbox 轮询：业务写与 outbox 行同事务 → 轮询器扫表 → 删缓存。零外部设施、失效意图持久；写路径多写一张表。 */
export function createOutboxPolling(opts = {}) {
  return makeSim('OutboxPolling', opts)
}

const FACTORY = {
  DelayedDoubleDelete: createDelayedDoubleDelete,
  SubscribeBinlog: createSubscribeBinlog,
  OutboxPolling: createOutboxPolling,
}

/*----------------------------------------------------- 场景 -----------------------------------------------------*/

const settleWindowMs = (cfg) => Math.max(cfg.doubleDeleteDelayMs, cfg.cdcPollMs, cfg.outboxPollMs) + 20

/**
 * `steadyWrite`：连续写 + 每次写后立刻读 ⇒ 量「读己之写」是否成立 + 写路径开销。
 */
function scenarioSteadyWrite(protocol, opts) {
  const sim = FACTORY[protocol](opts)
  const n = intOr(opts.writes, CACHE_CONSISTENCY_DEFAULTS.writes)
  sim.write('k', 'v0')
  sim.advanceTo(sim.now() + 5)
  sim.read('k')
  for (let i = 1; i <= n; i++) {
    sim.write('k', 'v' + i)
    const r = sim.read('k')
    sim.noteReadOutcome(r.stale === true)
    sim.advanceTo(sim.now() + 10)
  }
  const s = sim.stats()
  return {
    id: 'steadyWrite', protocol,
    writes: s.writes, reads: s.reads, staleReads: s.staleReads,
    readYourWritesRate: s.readYourWritesTotal > 0 ? round4(s.readYourWrites / s.readYourWritesTotal) : 0,
    extraDurableWrites: s.extraDurableWrites,
    infraCalls: s.infraCalls,
    invalidations: s.invalidations,
    maxStaleMs: s.maxStaleMs,
    note: '写后立刻读：读己之写成立与否 + 写路径额外持久化/外部调用开销',
  }
}

/**
 * `racingRead`：cache-aside 经典竞态 —— 读抓到旧快照 → 写提交并删缓存 → 读把旧快照写回缓存 ⇒ 缓存里躺陈旧值。
 * 量：陈旧是否真的出现（nontrivial）、陈旧窗口多长、机制跑完后是否被清掉。
 */
function scenarioRacingRead(protocol, opts) {
  const sim = FACTORY[protocol](opts)
  sim.write('k', 'v1')
  sim.advanceTo(sim.now() + 5)
  sim.read('k')            // 填充缓存
  sim.readBegin('k')       // 抓到 v1
  sim.write('k', 'v2')     // 提交 v2 + 触发失效
  sim.readCommit()         // 把 v1 写回缓存 ⇒ 陈旧
  const raced = sim.read('k')
  const staleAfterRace = raced.stale === true
  const staleWindowMs = raced.stalenessMs
  sim.advanceTo(sim.now() + settleWindowMs(sim.cfg))
  const after = sim.read('k')
  const s = sim.stats()
  return {
    id: 'racingRead', protocol,
    staleAfterRace,
    staleWindowMs,
    clearedAfterMechanism: after.stale === false,
    staleReads: s.staleReads,
    invalidations: s.invalidations,
    extraDurableWrites: s.extraDurableWrites,
    infraCalls: s.infraCalls,
    maxStaleMs: s.maxStaleMs,
    note: 'cache-aside 竞态：读抓旧快照 → 写提交删缓存 → 读写回旧快照 ⇒ 陈旧；机制跑完后是否被清掉',
  }
}

/**
 * `crashAfterWrite`：陈旧值写回缓存后**进程崩溃**。
 * ⇒ 易失的失效意图（延迟双删的第二次删除）随进程消失；持久记录（binlog / outbox 表）不丢。
 * 这一格就是 `boundedStaleness` 那一维的**判据来源**。
 */
function scenarioCrashAfterWrite(protocol, opts) {
  const sim = FACTORY[protocol](opts)
  sim.write('k', 'v1')
  sim.advanceTo(sim.now() + 5)
  sim.read('k')
  sim.readBegin('k')
  sim.write('k', 'v2')
  sim.readCommit()
  const raced = sim.read('k')
  sim.crash()
  sim.advanceTo(sim.now() + settleWindowMs(sim.cfg))
  const after = sim.read('k')
  const s = sim.stats()
  return {
    id: 'crashAfterWrite', protocol,
    staleAfterRace: raced.stale === true,
    staleSurvivedCrash: after.stale === true,
    staleWindowMs: raced.stalenessMs,
    invalidations: s.invalidations,
    invalidationIntent: sim.intent().kind,
    extraDurableWrites: s.extraDurableWrites,
    infraCalls: s.infraCalls,
    note: '陈旧写回后崩溃：易失失效意图随进程消失、持久记录不丢 ⇒ 陈旧是否被清掉',
  }
}

/** `subscriberLag`：下游滞后（CDC 位点落后 / 轮询器排队）⇒ 陈旧窗口被拉长多少。 */
function scenarioSubscriberLag(protocol, opts) {
  const lag = intOr(opts.lagMs, CACHE_CONSISTENCY_DEFAULTS.lagMs) || 300
  const sim = FACTORY[protocol]({ ...opts, lagMs: lag })
  sim.write('k', 'v1')
  sim.advanceTo(sim.now() + 5)
  sim.read('k')
  sim.readBegin('k')
  sim.write('k', 'v2')
  sim.readCommit()
  const raced = sim.read('k')
  sim.advanceTo(sim.now() + settleWindowMs(sim.cfg) + lag)
  const after = sim.read('k')
  const s = sim.stats()
  return {
    id: 'subscriberLag', protocol,
    lagMs: lag,
    staleAfterRace: raced.stale === true,
    staleWindowMs: raced.stalenessMs,
    clearedAfterMechanism: after.stale === false,
    maxStaleMs: s.maxStaleMs,
    invalidations: s.invalidations,
    extraDurableWrites: s.extraDurableWrites,
    infraCalls: s.infraCalls,
    note: '下游滞后 ' + lag + 'ms ⇒ 陈旧窗口被拉长（窗口不是免费的）',
  }
}

/** `cleanRerun`：同 seed 连跑两次，逐字比较指标串 ⇒ 真的可复现（不是写死的 true）。 */
function scenarioCleanRerun(protocol, opts) {
  const a = scenarioSteadyWrite(protocol, opts)
  const b = scenarioSteadyWrite(protocol, opts)
  const pick = (c) => JSON.stringify({
    writes: c.writes, reads: c.reads, staleReads: c.staleReads,
    readYourWritesRate: c.readYourWritesRate, extraDurableWrites: c.extraDurableWrites,
    infraCalls: c.infraCalls, invalidations: c.invalidations,
  })
  const sa = pick(a)
  const sb = pick(b)
  return {
    id: 'cleanRerun', protocol,
    rerunIdentical: sa === sb,
    writes: a.writes, reads: a.reads, staleReads: a.staleReads,
    readYourWritesRate: a.readYourWritesRate,
    extraDurableWrites: a.extraDurableWrites, infraCalls: a.infraCalls, invalidations: a.invalidations,
    note: '同 seed 连跑两次逐字一致 ⇒ 可复现（真比较字符串，不是写死的 true）',
  }
}

const SCENARIO_FN = {
  steadyWrite: scenarioSteadyWrite,
  racingRead: scenarioRacingRead,
  crashAfterWrite: scenarioCrashAfterWrite,
  subscriberLag: scenarioSubscriberLag,
  cleanRerun: scenarioCleanRerun,
}

/*----------------------------------------------------- 矩阵 -----------------------------------------------------*/

function runMatrix(cfg, flags, scenarioIds) {
  const rows = []
  for (const protocol of CACHE_CONSISTENCY_STRATEGIES) {
    const scenarios = scenarioIds.map((id) => SCENARIO_FN[id](protocol, { ...cfg, ...flags }))
    const crash = scenarios.find((c) => c.id === 'crashAfterWrite')
    const infraCalls = scenarios.reduce((a, c) => a + (c.infraCalls ?? 0), 0)
    const extraDurableWrites = scenarios.reduce((a, c) => a + (c.extraDurableWrites ?? 0), 0)
    const trilemma = {
      // 【真跑现算】陈旧窗口是否由策略自身界定：崩溃后陈旧值是否仍被清掉。
      boundedStaleness: crash ? crash.staleSurvivedCrash === false : false,
      // 【真数】外部设施调用累计是否为 0。
      infraFree: infraCalls === 0,
      // 【真数】业务写之外的额外持久化写是否为 0。
      writePathLight: extraDurableWrites === 0,
    }
    rows.push({
      protocol,
      scenarios,
      trilemma,
      metrics: {
        totalWrites: scenarios.reduce((a, c) => a + (c.writes ?? 0), 0),
        totalReads: scenarios.reduce((a, c) => a + (c.reads ?? 0), 0),
        totalStaleReads: scenarios.reduce((a, c) => a + (c.staleReads ?? 0), 0),
        totalExtraDurableWrites: extraDurableWrites,
        totalInfraCalls: infraCalls,
        totalInvalidations: scenarios.reduce((a, c) => a + (c.invalidations ?? 0), 0),
        readYourWritesRate: (() => {
          const sw = scenarios.find((c) => c.id === 'steadyWrite')
          return sw ? sw.readYourWritesRate : 0
        })(),
        staleSurvivedCrash: crash ? crash.staleSurvivedCrash === true : false,
      },
    })
  }
  return rows
}

/*----------------------------------------------------- 教学件主体 -----------------------------------------------------*/

export function cacheConsistencyStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : CACHE_CONSISTENCY_SCENARIOS
  const seed = intOr(opts.seed, CACHE_CONSISTENCY_DEFAULTS.seed)
  const writes = intOr(opts.writes, CACHE_CONSISTENCY_DEFAULTS.writes)
  const cfg = {
    seed, writes,
    ttlMs: intOr(opts.ttlMs, CACHE_CONSISTENCY_DEFAULTS.ttlMs),
    doubleDeleteDelayMs: intOr(opts.doubleDeleteDelayMs, CACHE_CONSISTENCY_DEFAULTS.doubleDeleteDelayMs),
    cdcPollMs: intOr(opts.cdcPollMs, CACHE_CONSISTENCY_DEFAULTS.cdcPollMs),
    outboxPollMs: intOr(opts.outboxPollMs, CACHE_CONSISTENCY_DEFAULTS.outboxPollMs),
    outboxWriteCostMs: intOr(opts.outboxWriteCostMs, CACHE_CONSISTENCY_DEFAULTS.outboxWriteCostMs),
    infraCallCostMs: intOr(opts.infraCallCostMs, CACHE_CONSISTENCY_DEFAULTS.infraCallCostMs),
    lagMs: intOr(opts.lagMs, CACHE_CONSISTENCY_DEFAULTS.lagMs),
  }
  const freeStalenessWindow = opts.freeStalenessWindow === true
  const freeCdcInfra = opts.freeCdcInfra === true
  const freeOutboxWrite = opts.freeOutboxWrite === true
  const rigged = opts.rigged === true || (freeStalenessWindow && freeCdcInfra && freeOutboxWrite)
  const flags = {
    rigged,
    freeStalenessWindow: rigged || freeStalenessWindow,
    freeCdcInfra: rigged || freeCdcInfra,
    freeOutboxWrite: rigged || freeOutboxWrite,
  }

  const rows = runMatrix(cfg, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  // 纯净基线（无任何开关）——用于「三开关各自只动所属策略」的探针。
  const baseRows = runMatrix(cfg, { rigged: false, freeStalenessWindow: false, freeCdcInfra: false, freeOutboxWrite: false }, scenarioIds)
  const baseVectors = Object.fromEntries(baseRows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const ddbStillVolatile = baseRows.find((r) => r.protocol === 'DelayedDoubleDelete').metrics.staleSurvivedCrash === true
  const cdcStillNeedsInfra = baseRows.find((r) => r.protocol === 'SubscribeBinlog').metrics.totalInfraCalls > 0
  const outboxStillWrites = baseRows.find((r) => r.protocol === 'OutboxPolling').metrics.totalExtraDurableWrites > 0

  // 三开关探针：每一路都必须**只**顶高自己那一家。
  const mFree = runMatrix(cfg, { ...flags, freeStalenessWindow: true, freeCdcInfra: false, freeOutboxWrite: false }, scenarioIds)
  const mCdc = runMatrix(cfg, { ...flags, freeStalenessWindow: false, freeCdcInfra: true, freeOutboxWrite: false }, scenarioIds)
  const mOut = runMatrix(cfg, { ...flags, freeStalenessWindow: false, freeCdcInfra: false, freeOutboxWrite: true }, scenarioIds)
  const vecOf = (rs) => Object.fromEntries(rs.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const vFree = vecOf(mFree)
  const vCdc = vecOf(mCdc)
  const vOut = vecOf(mOut)
  const freeStalenessWindowHitsOnlyDdb = vFree.DelayedDoubleDelete === '111'
    && vFree.SubscribeBinlog === baseVectors.SubscribeBinlog
    && vFree.OutboxPolling === baseVectors.OutboxPolling
  const freeCdcInfraHitsOnlyCdc = vCdc.SubscribeBinlog === '111'
    && vCdc.DelayedDoubleDelete === baseVectors.DelayedDoubleDelete
    && vCdc.OutboxPolling === baseVectors.OutboxPolling
  const freeOutboxWriteHitsOnlyOutbox = vOut.OutboxPolling === '111'
    && vOut.DelayedDoubleDelete === baseVectors.DelayedDoubleDelete
    && vOut.SubscribeBinlog === baseVectors.SubscribeBinlog
  const riggedConvergenceCollapsed = flags.rigged === true && new Set(Object.values(vectors)).size <= 1

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    ddbStillVolatile,
    cdcStillNeedsInfra,
    outboxStillWrites,
    rigged_pkg: rigged,
    rigged_pkg_flags: { ...flags },
    riggedConvergenceCollapsed,
    freeStalenessWindowHitsOnlyDdb,
    freeCdcInfraHitsOnlyCdc,
    freeOutboxWriteHitsOnlyOutbox,
  }

  const crosscheck = {
    evidence: createCacheConsistencyEvidence({ seed, now: opts.now }),
    soundness: verifyCacheConsistencySoundness({ seed, writes }, { ...cfg }),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: {
      seed, writes,
      ttlMs: cfg.ttlMs,
      doubleDeleteDelayMs: cfg.doubleDeleteDelayMs,
      cdcPollMs: cfg.cdcPollMs,
      outboxPollMs: cfg.outboxPollMs,
      lagMs: cfg.lagMs,
      scenarios: scenarioIds,
      rigged, freeStalenessWindow: flags.freeStalenessWindow, freeCdcInfra: flags.freeCdcInfra, freeOutboxWrite: flags.freeOutboxWrite,
    },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    causalLocks: verifyCausalLocks({ ...cfg }),
    crosscheck,
    rigged,
  }
}

export const compareCacheConsistency = cacheConsistencyStudy

export function cacheConsistencySnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      trilemma: { ...r.trilemma },
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    verdict: { ...study.verdict },
    noUniversalWinner: study.noUniversalWinner ?? study.verdict?.noUniversalWinner,
    trilemmaDistinguishes: study.trilemmaDistinguishes ?? study.verdict?.trilemmaDistinguishes,
    noStrategyWinsAll: study.noStrategyWinsAll ?? study.verdict?.noStrategyWinsAll,
    causalLocks: study.causalLocks ? { ...study.causalLocks } : undefined,
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      soundness: study.crosscheck.soundness ? { ...study.crosscheck.soundness } : undefined,
    } : undefined,
    rigged: study.rigged,
  }
}

/*----------------------------------------------------- 双路自证 -----------------------------------------------------*/

/**
 * **唯一 holds 公式**（baseline 与三路 tamper 共用，逐字不改）：
 *
 * <pre>
 *   holds(strategy) =
 *      nontrivial            // 竞态真的发生了（staleAfterRace === true）—— 绝不 0=0 假绿
 *   ∧ mechanismRan          // 策略自己的失效机制真的跑过（invalidations > 0）
 *   ∧ invalidatedAfterMechanism  // 机制跑完之后，陈旧值确实被清掉了（再读是新鲜的）
 * </pre>
 *
 * <p>三路 tamper **各自只打穿自己那一家**（不是三家一起倒）：</p>
 * <ul>
 *   <li><code>deleteLost</code>：延迟双删的第二次删除被抹掉 ⇒ 双删的 holds 翻 false；另两家不受影响。</li>
 *   <li><code>offsetReset</code>：CDC 位点被重置到最新 ⇒ 中间事件永久跳过 ⇒ 订阅的 holds 翻 false。</li>
 *   <li><code>outboxNotAtomic</code>：outbox 行不在同一事务 ⇒ 业务写成功但永不失效 ⇒ Outbox 的 holds 翻 false。</li>
 * </ul>
 */
function consistencyCore(input = {}, opts = {}, tamper = 'normal') {
  const writes = intOr(input?.writes ?? opts?.writes, CACHE_CONSISTENCY_DEFAULTS.writes)
  const per = {}
  for (const protocol of CACHE_CONSISTENCY_STRATEGIES) {
    const sim = FACTORY[protocol]({ ...opts, tamper, writes })
    sim.write('k', 'v1')
    sim.advanceTo(sim.now() + 5)
    sim.read('k')
    sim.readBegin('k')
    sim.write('k', 'v2')
    sim.readCommit()
    const raced = sim.read('k')
    const staleAfterRace = raced.stale === true
    sim.advanceTo(sim.now() + settleWindowMs(sim.cfg))
    const after = sim.read('k')
    const s = sim.stats()
    const nontrivial = staleAfterRace === true
    const mechanismRan = s.invalidations > 0
    const invalidatedAfterMechanism = after.stale === false
    const holds = nontrivial && mechanismRan && invalidatedAfterMechanism
    per[protocol] = {
      holds, nontrivial, mechanismRan, invalidatedAfterMechanism,
      staleAfterRace, staleWindowMs: raced.stalenessMs, invalidations: s.invalidations,
      clearedAfterMechanism: invalidatedAfterMechanism,
    }
  }
  return per
}

/**
 * verifyCacheConsistencySoundness：双路自证 + 三路可证伪。
 * `falsifiable` = baseline 三家全绿 ∧ 三路 tamper **各自只翻自己那一家**（精确定位，不是乱棍）。
 */
export function verifyCacheConsistencySoundness(input = {}, opts = {}) {
  const baseline = consistencyCore(input, opts, 'normal')
  const deleteLost = consistencyCore(input, opts, 'deleteLost')
  const offsetReset = consistencyCore(input, opts, 'offsetReset')
  const outboxNotAtomic = consistencyCore(input, opts, 'outboxNotAtomic')

  const baselineHolds = CACHE_CONSISTENCY_STRATEGIES.every((p) => baseline[p].holds === true)
  const deleteLostFlipsOnlyDdb = deleteLost.DelayedDoubleDelete.holds === false
    && deleteLost.SubscribeBinlog.holds === true
    && deleteLost.OutboxPolling.holds === true
  const offsetResetFlipsOnlyCdc = offsetReset.SubscribeBinlog.holds === false
    && offsetReset.DelayedDoubleDelete.holds === true
    && offsetReset.OutboxPolling.holds === true
  const outboxNotAtomicFlipsOnlyOutbox = outboxNotAtomic.OutboxPolling.holds === false
    && outboxNotAtomic.DelayedDoubleDelete.holds === true
    && outboxNotAtomic.SubscribeBinlog.holds === true
  const falsifiable = baselineHolds
    && deleteLostFlipsOnlyDdb
    && offsetResetFlipsOnlyCdc
    && outboxNotAtomicFlipsOnlyOutbox
  const holds = baselineHolds && falsifiable

  return {
    laneA: baseline,
    laneB: { deleteLost, offsetReset, outboxNotAtomic },
    baselineHolds,
    holds,
    nontrivial: CACHE_CONSISTENCY_STRATEGIES.every((p) => baseline[p].nontrivial === true),
    falsifiable,
    tamper: {
      deleteLost: {
        holds: deleteLost.DelayedDoubleDelete.holds,
        targeted: deleteLostFlipsOnlyDdb,
        reason: 'deleteLost：延迟双删的第二次删除被抹掉 ⇒ 陈旧值永不被清（invalidations='
          + deleteLost.DelayedDoubleDelete.invalidations + '）⇒ holds 真翻 false；另两家不受影响',
      },
      offsetReset: {
        holds: offsetReset.SubscribeBinlog.holds,
        targeted: offsetResetFlipsOnlyCdc,
        reason: 'offsetReset：CDC 位点被重置到最新 ⇒ 中间事件永久跳过 ⇒ 订阅的失效意图丢失 ⇒ holds 真翻 false',
      },
      outboxNotAtomic: {
        holds: outboxNotAtomic.OutboxPolling.holds,
        targeted: outboxNotAtomicFlipsOnlyOutbox,
        reason: 'outboxNotAtomic：outbox 行不在业务写的同一事务 ⇒ 业务写成功但永不失效 ⇒ holds 真翻 false',
      },
    },
  }
}

/**
 * verifyCausalLocks：三条结构锁在同一套模拟器上真跑，任何 rigged 开关都救不了。
 */
export function verifyCausalLocks(cfg = {}) {
  const c = { ...cfg }
  const crashRows = runMatrix(c, { rigged: false, freeStalenessWindow: false, freeCdcInfra: false, freeOutboxWrite: false }, ['crashAfterWrite'])
  const ddb = crashRows.find((r) => r.protocol === 'DelayedDoubleDelete')
  const cdc = crashRows.find((r) => r.protocol === 'SubscribeBinlog')
  const out = crashRows.find((r) => r.protocol === 'OutboxPolling')

  // ① 延迟双删的失效意图是**易失**的（登记在进程内定时器）⇒ 崩溃即丢 ⇒ 陈旧窗口只能靠 TTL 兜底。
  //    另两家的失效意图落在**持久记录**上（binlog / outbox 表）⇒ 崩溃不丢。结构差异是真的。
  const ddbIntentVolatile = ddb.scenarios[0].invalidationIntent === 'volatile-timer'
  const ddbStaleSurvivedCrash = ddb.metrics.staleSurvivedCrash === true
  const durableIntentsSurvive = cdc.metrics.staleSurvivedCrash === false && out.metrics.staleSurvivedCrash === false
  const volatileInvalidationIntentCausallyUnerasable = ddbIntentVolatile && ddbStaleSurvivedCrash && durableIntentsSurvive

  // ② CDC 的正确性依赖**位点持久化**：位点被重置 ⇒ 中间事件被跳过 ⇒ 失效意图永久丢失。
  const offsetCore = consistencyCore({ writes: c.writes }, c, 'offsetReset')
  const cdcOffsetDependencyCausallyUnerasable = offsetCore.SubscribeBinlog.holds === false
    && offsetCore.SubscribeBinlog.invalidations === 0

  // ③ Outbox 的正确性来自「与业务写**同一事务**」⇒ 必须**多写一张持久表**。
  //    两半都要真跑出来：① 拆开事务 ⇒ 永不失效；② 不拆 ⇒ 写路径必然多写。
  const notAtomicCore = consistencyCore({ writes: c.writes }, c, 'outboxNotAtomic')
  const outboxRows = runMatrix(c, { rigged: false, freeStalenessWindow: false, freeCdcInfra: false, freeOutboxWrite: false }, ['steadyWrite'])
    .find((r) => r.protocol === 'OutboxPolling')
  const outboxSameTransactionCausallyUnerasable = notAtomicCore.OutboxPolling.holds === false
    && notAtomicCore.OutboxPolling.invalidations === 0
    && outboxRows.metrics.totalExtraDurableWrites > 0

  const causalLocksAllHold = volatileInvalidationIntentCausallyUnerasable
    && cdcOffsetDependencyCausallyUnerasable
    && outboxSameTransactionCausallyUnerasable

  return Object.freeze({
    volatileInvalidationIntentCausallyUnerasable,
    cdcOffsetDependencyCausallyUnerasable,
    outboxSameTransactionCausallyUnerasable,
    causalLocksAllHold,
    probes: {
      ddbIntent: ddb.scenarios[0].invalidationIntent,
      ddbStaleSurvivedCrash,
      cdcStaleSurvivedCrash: cdc.metrics.staleSurvivedCrash,
      outboxStaleSurvivedCrash: out.metrics.staleSurvivedCrash,
      offsetResetInvalidations: offsetCore.SubscribeBinlog.invalidations,
      outboxExtraDurableWrites: outboxRows.metrics.totalExtraDurableWrites,
      outboxNotAtomicInvalidations: notAtomicCore.OutboxPolling.invalidations,
    },
  })
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createCacheConsistencyEvidence(opts = {}) {
  const seed = intOr(opts.seed, CACHE_CONSISTENCY_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `cc:key:${i}`)
  const ev = {}

  // ① ShardRouter 路由
  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  // ② HashRing
  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  const dist = ring.distribution(keys)
  ev.ringNodes = ring.nodeIds().length
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  // ③ WAL
  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  // ④ Bus
  const bus = createBus()
  let notices = 0
  bus.subscribe('cc.invalidated', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('cc.invalidated', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('cc.invalidated')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`cc:cache:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`cc:cache:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ entry: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  // ⑦ TokenBucket
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0
  let bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  // ⑧ MinHeap
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 40, 'cc:secondDelete')
  heap.schedule(fixedNow + 250, 'cc:gc')
  heap.schedule(fixedNow + 80, 'cc:lease')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  // ⑨ PackedCounters
  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  // ⑩ FullJitterBackoff
  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples)
  const sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  // ⑪ compareRemapping
  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  return ev
}

/*----------------------------------------------------- CLI -----------------------------------------------------*/

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const nowArg = args.find((a) => a.startsWith('--now='))
  const nowMs = nowArg ? numOr(nowArg.slice(6), 0) : 0
  const study = cacheConsistencyStudy({
    rigged,
    freeStalenessWindow: rigged || args.includes('--free-staleness-window'),
    freeCdcInfra: rigged || args.includes('--free-cdc-infra'),
    freeOutboxWrite: rigged || args.includes('--free-outbox-write'),
    now: () => nowMs,
  })
  const snap = cacheConsistencySnapshot(study)
  console.log('[cache-consistency] seed=' + snap.config.seed +
    ' writes=' + snap.config.writes +
    ' doubleDeleteDelayMs=' + snap.config.doubleDeleteDelayMs +
    ' cdcPollMs=' + snap.config.cdcPollMs +
    ' outboxPollMs=' + snap.config.outboxPollMs +
    ' rigged=' + snap.config.rigged +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(20) +
      ' staleReads=' + row.metrics.totalStaleReads +
      ' readYourWrites=' + row.metrics.readYourWritesRate +
      ' extraDurableWrites=' + row.metrics.totalExtraDurableWrites +
      ' infraCalls=' + row.metrics.totalInfraCalls +
      ' staleSurvivedCrash=' + row.metrics.staleSurvivedCrash +
      ' trilemma={' + ['boundedStaleness=' + row.trilemma.boundedStaleness, 'infraFree=' + row.trilemma.infraFree, 'writePathLight=' + row.trilemma.writePathLight].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  if (args.includes('--bench')) {
    const ddb = snap.rows.find((r) => r.protocol === 'DelayedDoubleDelete')
    const cdc = snap.rows.find((r) => r.protocol === 'SubscribeBinlog')
    const out = snap.rows.find((r) => r.protocol === 'OutboxPolling')
    const sc = snap.crosscheck.soundness
    console.log('[cache-consistency:bench] seed=' + snap.config.seed +
      ' writes=' + snap.config.writes +
      ' ddb=' + snap.vectors.DelayedDoubleDelete + ' cdc=' + snap.vectors.SubscribeBinlog + ' outbox=' + snap.vectors.OutboxPolling +
      ' ddbReadYourWrites=' + (ddb ? ddb.metrics.readYourWritesRate : '?') +
      ' cdcReadYourWrites=' + (cdc ? cdc.metrics.readYourWritesRate : '?') +
      ' outboxReadYourWrites=' + (out ? out.metrics.readYourWritesRate : '?') +
      ' cdcInfraCalls=' + (cdc ? cdc.metrics.totalInfraCalls : '?') +
      ' outboxExtraWrites=' + (out ? out.metrics.totalExtraDurableWrites : '?') +
      ' noUniversalWinner=' + snap.noUniversalWinner +
      ' soundness=' + (sc ? sc.holds : '?') +
      ' falsifiable=' + (sc ? sc.falsifiable : '?') +
      ' causalLocks=' + (snap.causalLocks ? snap.causalLocks.causalLocksAllHold : '?') +
      ' evidenceKeys=' + Object.keys(snap.crosscheck.evidence).length)
    process.exit(0)
  }
  console.log('  noUniversalWinner=' + snap.noUniversalWinner +
    ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: volatileIntent=' + snap.causalLocks.volatileInvalidationIntentCausallyUnerasable +
    ' cdcOffset=' + snap.causalLocks.cdcOffsetDependencyCausallyUnerasable +
    ' outboxSameTxn=' + snap.causalLocks.outboxSameTransactionCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const sc = snap.crosscheck.soundness
  console.log('  soundness: holds=' + sc.holds + ' baselineHolds=' + sc.baselineHolds + ' falsifiable=' + sc.falsifiable + ' nontrivial=' + sc.nontrivial)
  // tamper 打印必须说清「哪一家翻了」——只打印 holds 布尔会被误读成「三路都没生效」。
  for (const [name, t] of Object.entries(sc.tamper)) {
    const flipped = CACHE_CONSISTENCY_STRATEGIES.filter((p) => sc.laneB[{
      deleteLost: 'deleteLost', offsetReset: 'offsetReset', outboxNotAtomic: 'outboxNotAtomic',
    }[name]][p].holds === false)
    console.log('  tamper[' + name + ']: targeted=' + t.targeted +
      ' flipped=' + (flipped.length ? flipped.join('+') : 'none') +
      ' ⇒ ' + t.reason)
  }
  process.exit(0)
}
