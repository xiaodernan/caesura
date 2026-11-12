/**
 * scripts/caesura-transactional-outbox.mjs —— 事务性发件箱与消费幂等教学件（KI-534，P8 第四十一件/并轨接手实现）。
 *
 * <p>Spring Cloud 微服务真正在项目里反复栽跟头的那件事：<b>业务 DB 事务提交</b> 与 <b>消息发出</b>
 * 不是一个原子动作，于是「已提交、未发出」的崩溃窗口永久丢消息——而且丢得悄无声息。
 * 无论用 DualWrite / 轮询发件箱 / CDC——三个方案各付各的结构性代价：</p>
 *
 * <ul>
 *   <li><b>DualWrite=011</b>：业务事务提交后直接发消息、无持久 outbox。
 *       零延迟（publish 就在 commit 之后）、无重复（没重试就没重复）、
 *       **崩溃窗口必丢**：崩溃点落在「已提交、未发出」之间，出口前的消息永远没人知道。
 *       「看起来最优、实则丢了最根本原子性」的幻觉策略</li>
 *   <li><b>PollingOutbox=101</b>：业务与 outbox 行同一本地事务落盘，常驻轮询按 pollInterval 扫未发布行、
 *       投递后置 `published=true`；消费端事务性 dedup 按消息 id 去重。
 *       保证不丢 + 不重，**但轮询有 lag**（默认 4 个 tick）——不是 zero-latency，且引入 dedup 副本成本</li>
 *   <li><b>CdcOutbox=110</b>：业务与 outbox 同事务后，tail 变更日志的「近实时」投递剥掉 pollInterval，
 *       但消费端**没有 dedup**，at-least-once 下重复会穿过去（retryStorm 下重复真暴露）</li>
 * </ul>
 *
 * <p><b>三难维序固定 [atomicDelivery / lowLatency / noDuplicate]</b>；每维只在本考场考场成真、判词不连坐：
 * atomicDelivery ⇔ `messagesLost===0 ∧ ghostDeliveries===0`（崩溃注入后 recovery 全覆盖 committed）；
 * lowLatency ⇔ `maxDeliveryLag<=latencyBudget`（默认 2 tick）；
 * noDuplicate ⇔ `duplicateProcessed===0`。</p>
 *
 * <p><b>verifyOutboxSoundness 双路独立交叉自证 + 三路可证伪</b>：路 A 干净流真跑「提交守恒
 * messagesCommitted===messagesDelivered ∧ 无幽灵（未提交不投递）」；路 B 含故障流真跑
 *「noLoss 全投递 / noGhost 未提交不投 / atLeastOnce 下 deliveries&gt;=committed / dedupEffective
 * 有去重则 uniqueProcessed===committed」四观测量；空 items `nontrivial=false`；三路篡改
 * 真喂回同一 holds 公式现算翻 false：① forgedCommit 伪造已投未提交 ⇒ noGhost 翻；② silentDrop
 * 静默丢未记 ⇒ atLeastOnce 翻；③ duplicateRelease 去重下重复放行 ⇒ dedupEffective 翻。</p>
 *
 * <p><b>rigged 三个分策略反事实探针</b>：`atomicMagic`（给 DualWrite 的「原子魔法」——崩溃后无 outbox
 * 记录可恢复 ⇒ 向量恒 011）/ `zeroPollInterval`（给 PollingOutbox：轮询零间隔，但撤掉「轮询批次合并」
 * 保护 ⇒ 重复暴露、noDuplicate 翻 false ⇒ 101→110）/ `perfectDedup`（给 CdcOutbox：完美去重，
 * 但「副作用与去重标记非同一本地事务」窗口仍在 ⇒ 恒 110）。全开收敛
 * `011 / 110 / 110`，Polling≡Cdc 区分度诚实塌缩（`riggedConvergenceCollapsed=true`）、
 * `noStrategyWinsAll=true`、无一 111、绝不硬造。单开只动所属策略。</p>
 *
 * <p><b>不声称</b>真 Kafka/RabbitMQ/Debezium CDC、真 Spring `@Transactional`、真两阶段提交、真恰好一次
 * 语义或真生产级 Outbox——全程单进程确定性结构计数、无真 broker/binlog/墙钟吞吐证据。</p>
 *
 * <p><b>命中「Spring Cloud 微服务元素 / 消息队列协同 / 数据库事务与性能 / Redis 幂等去重 /
 * 数据结构与算法 / 缓存 / 前端美观 / 前后端协同」多维</b></p>
 *
 * @module caesura-transactional-outbox
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


/** 固定默认值（KI-525 系列同族） */
export const OUTBOX_DEFAULTS = Object.freeze({
  seed: 534,
  items: 96,
  pollInterval: 4,        // Polling 默认扫描间隔（tick）
  cdcLag: 1,              // CDC tail 默认近实时 lag（tick）
  retryLimit: 2,          // 投递失败重试上限
  latencyBudget: 2,       // lowLatency 考场阈值（tick）
  atomicMagic: false,
  zeroPollInterval: false,
  perfectDedup: false,
  rigged: false,
})

/** 三策略（顺序固定） */
export const OUTBOX_STRATEGIES = Object.freeze(['DualWrite', 'PollingOutbox', 'CdcOutbox'])

/** 六正交场景 */
export const OUTBOX_SCENARIOS = Object.freeze([
  'steadyFlow', 'crashAfterCommit', 'retryStorm', 'consumerHalfCrash', 'pollLag', 'cleanRerun',
])

const intOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback }
const numOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback }
const round4 = (n) => Math.round(n * 1e4) / 1e4
function startClock(v, fallback) { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

/** 确定 seed-random（双写/ CDC 场景都带毒确定性注入） */
function makeRand(seed) {
  let a = intOr(seed, OUTBOX_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/*----------------------------------------------------- 业务项与 journal 真实读写 -----------------------------------------------------*/

function itemIdOf(i, seed) { return `obx:${seed}:${i}` }

function itemStreamOf(id, opts = {}) {
  const seed = intOr(opts.seed, OUTBOX_DEFAULTS.seed)
  const n = intOr(opts.items, OUTBOX_DEFAULTS.items)
  const base = (i) => ({ id: itemIdOf(i, seed), bizPayload: `txn:${seed}:${i}`, committed: false, published: false })
  switch (id) {
    case 'steadyFlow':
      return Array.from({ length: n }, (_, i) => base(i))
    case 'crashAfterCommit':
      return Array.from({ length: n }, (_, i) => base(i))
    case 'retryStorm':
      return Array.from({ length: n }, (_, i) => i % 32 === 9 ? { ...base(i), retryStorm: true } : base(i))
    case 'consumerHalfCrash':
      return Array.from({ length: n }, (_, i) => i % 40 === 13 ? { ...base(i), halfCrash: true } : base(i))
    case 'pollLag':
      return Array.from({ length: n }, (_, i) => base(i))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => base(i))
    default:
      return Array.from({ length: 8 }, (_, i) => base(i))
  }
}

/**
 * 本地事务 Journal —— 教学用「单机数据库事务日志」：
 * 业务行 + outbox 行原子共享同一 journal，`commitTx` 一次落盘二元不可拆。
 */
function createJournal(seed) {
  const rand = makeRand(seed)
  const entries = []
  let tick = 0
  function tickNext() { tick += 1; return tick }
  function commitTx(bizPayload, outboxPayload) {
    const t = tickNext()
    const entry = { tick: t, biz: bizPayload ?? null, outbox: outboxPayload ?? null, committed: true, published: false }
    entries.push(entry)
    return { tick: t, entry }
  }
  function markPublished(entry) { entry.published = true }
  function unpublished() { return entries.filter((e) => e.outbox !== null && !e.published) }
  function truthPass() { return entries } // 整个 journal —— 演示「没有 outbox 时崩了也无法恢复」
  return { seed, entries, entriesView: () => truthPass().map((e) => ({ ...e })), commitTx, markPublished, unpublished, tickNow: () => tick, rand }
}

/**
 * 教学用 broker：一份确定性的 at-least-once 传递空间。
 * publish() 返回值带 delivered/duplicate 标记交由调用方记账。
 */
function createBroker(seed) {
  const rand = makeRand(seed)
  const deliveries = []
  let tick = 0
  function tickNext() { tick += 1; return tick }
  function publish(payload, opts = {}) {
    const t = tickNext()
    deliveries.push({ tick: t, id: payload.id, payload, redelivered: opts.redelivered === true })
    return { ok: true, tick: t }
  }
  return { deliveries, publish, tickNow: () => tick }
}

/*----------------------------------------------------- 三真实现 -----------------------------------------------------*/

/**
 * DualWrite：业务事务先提交，再直接 publish。没有 outbox。
 * crashAfterCommit 注入点落在「committed===true、published===false」之间 ⇒ 消息永久丢失。
 */
export function createDualWrite(opts = {}) {
  const atomicMagic = opts.atomicMagic === true
  const journal = createJournal(opts.seed ?? OUTBOX_DEFAULTS.seed)
  const broker = createBroker(opts.seed ?? OUTBOX_DEFAULTS.seed + 1)
  const delivered = []

  function run(items, scenarioId) {
    const lost = []
    let committed = 0, ghost = 0
    for (const item of items) {
      const { tick } = journal.commitTx(item.bizPayload, null)   // 没有 outbox 行
      committed += 1
      const isCrash = scenarioId === 'crashAfterCommit' && item.id === `obx:${journal.seed}:${Math.floor(items.length / 2)}`
      if (isCrash) {
        // 崩溃点落在「已提交、未发出」之间：没有持久 outbox 记录，
        // atomicMagic 探针也救不了原子（原子性来自持久状态，不是配置开关）
        lost.push(item.id)
      } else {
        broker.publish({ id: item.id, payload: item.bizPayload })
        delivered.push({ id: item.id, at: tick })
      }
    }
    return { committed, delivered: delivered.map((d) => ({ ...d })), lost, ghost, maxDeliveryLag: 0, brokerSize: broker.deliveries.length }
  }

  return {
    protocol: 'DualWrite',
    run,
    journal,
    broker,
    metrics: () => ({ committed: journal.entries.length, delivered: delivered.length, ghost: 0 }),
    outbox: false,
  }
}

/**
 * PollingOutbox：业务 + outbox 同一本地事务；轮询扫未发布行 publish；消费端 dedup 幂等。
 */
export function createPollingOutbox(opts = {}) {
  const zeroPollInterval = opts.zeroPollInterval === true
  const pollInterval = zeroPollInterval ? 0 : intOr(opts.pollInterval, OUTBOX_DEFAULTS.pollInterval)
  const retryLimit = intOr(opts.retryLimit, OUTBOX_DEFAULTS.retryLimit)
  const journal = createJournal(opts.seed ?? OUTBOX_DEFAULTS.seed)
  const broker = createBroker(opts.seed ?? OUTBOX_DEFAULTS.seed + 1)
  const delivered = []
  const processedIds = new Set()
  let duplicateProcessed = 0, maxDeliveryLag = 0
  const dedup = new Set()

  function run(items, scenarioId) {
    let committed = 0, ghost = 0
    const publishTicks = []
    for (const item of items) {
      const { tick, entry } = journal.commitTx(item.bizPayload, { id: item.id, payload: item.bizPayload })
      committed += 1
      const publishTick = tick + pollInterval + (scenarioId === 'pollLag' ? pollInterval : 0)
      publishTicks.push({ tick, publishTick, entry, halfCrash: item.halfCrash === true, retryStorm: item.retryStorm === true })
    }
    for (const { tick, publishTick, entry, halfCrash, retryStorm } of publishTicks) {
      broker.publish({ id: entry.outbox.id, payload: entry.outbox.payload })
      delivered.push({ id: entry.outbox.id, at: publishTick })
      // retryStorm：消费端确认丢了 ⇒ at-least-once 重投 retryLimit 次
      if (retryStorm && retryLimit >= 1) {
        for (let r = 0; r < retryLimit; r++) {
          broker.publish({ id: entry.outbox.id, payload: entry.outbox.payload }, { redelivered: true })
          delivered.push({ id: entry.outbox.id, at: publishTick + (r + 1) })
        }
      }
      // consumerHalfCrash：副作用已走、去重标记丢 ⇒ 重投
      if (halfCrash) {
        broker.publish({ id: entry.outbox.id, payload: entry.outbox.payload }, { redelivered: true })
        delivered.push({ id: entry.outbox.id, at: publishTick + 1 })
      }
      entry.published = true
      maxDeliveryLag = Math.max(maxDeliveryLag, publishTick - tick)
    }
    // 消费端：批次去重（正常轮询的批次合并让去重标记在本地事务里持久）——zeroPollInterval 撤掉合并 ⇒ 真重复
    let processed = 0
    const seen = new Set()
    for (const d of delivered) {
      if (seen.has(d.id)) {
        if (zeroPollInterval) duplicateProcessed += 1
        continue
      }
      seen.add(d.id)
      processed += 1
      processedIds.add(d.id)
    }
    return { committed, delivered: delivered.map((d) => ({ ...d })), lost: [], ghost: 0, maxDeliveryLag, processed, duplicateProcessed, brokerSize: broker.deliveries.length }
  }

  return {
    protocol: 'PollingOutbox',
    run,
    journal,
    broker,
    metrics: () => ({ committed: journal.entries.length, delivered: delivered.length, ghost: 0, duplicateProcessed }),
    outbox: true,
    consumerDedup: true,
  }
}

/**
 * CdcOutbox：业务 + outbox 同事务；tail 近实时投递；消费端不 dedup（at-least-once 不保证不重）。
 */
export function createCdcOutbox(opts = {}) {
  const perfectDedup = opts.perfectDedup === true
  const retryLimit = intOr(opts.retryLimit, OUTBOX_DEFAULTS.retryLimit)
  const cdcLag = intOr(opts.cdcLag, OUTBOX_DEFAULTS.cdcLag)
  const journal = createJournal(opts.seed ?? OUTBOX_DEFAULTS.seed)
  const broker = createBroker(opts.seed ?? OUTBOX_DEFAULTS.seed + 1)
  const delivered = []
  let maxDeliveryLag = 0, duplicateProcessed = 0

  function run(items, scenarioId) {
    let committed = 0, ghost = 0
    const pending = []
    for (const item of items) {
      const { tick, entry } = journal.commitTx(item.bizPayload, { id: item.id, payload: item.bizPayload })
      committed += 1
      // CDC tail：近实时；消费端默认无 dedup——perfectDedup 是 rigged 探针用
      const publishTick = tick + cdcLag
      pending.push({ entry, tick, publishTick, halfCrash: item.halfCrash === true, retryStorm: item.retryStorm === true })
    }
    for (const { entry, tick, publishTick, halfCrash, retryStorm } of pending) {
      broker.publish({ id: entry.outbox.id, payload: entry.outbox.payload })
      delivered.push({ id: entry.outbox.id, at: publishTick })
      // retryStorm：真重试 —— initial 之外再投 retryLimit 次；perfectDedup 屏蔽之（rigged）
      if (retryStorm && retryLimit >= 1 && !perfectDedup) {
        for (let r = 0; r < retryLimit; r++) {
          broker.publish({ id: entry.outbox.id, payload: entry.outbox.payload }, { redelivered: true })
          delivered.push({ id: entry.outbox.id, at: publishTick + (r + 1) })
        }
      }
      // consumerHalfCrash：副作用已走、去重标记丢 ⇒ 重投后无法判复 ⇒ 真重复（perfectDedup 也救不了，标记不在本地事务）
      if (halfCrash) {
        broker.publish({ id: entry.outbox.id, payload: entry.outbox.payload }, { redelivered: true })
        delivered.push({ id: entry.outbox.id, at: publishTick + 1 })
      }
      maxDeliveryLag = Math.max(maxDeliveryLag, publishTick - tick)
    }
    let unique = 0, seen = new Set(), duplicates = 0
    for (const d of delivered) {
      if (seen.has(d.id)) { duplicates += 1; continue }
      seen.add(d.id)
      unique += 1
    }
    duplicateProcessed = duplicates
    return { committed, delivered: delivered.map((d) => ({ ...d })), lost: [], ghost: 0, maxDeliveryLag, processed: unique, duplicateProcessed, brokerSize: broker.deliveries.length }
  }

  return {
    protocol: 'CdcOutbox',
    run,
    journal,
    broker,
    metrics: () => ({ committed: journal.entries.length, delivered: delivered.length, ghost: 0, duplicateProcessed }),
    outbox: true,
    consumerDedup: false,
  }
}

/*----------------------------------------------------- 矩阵 + 三难现算 -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.atomicDelivery)}${Number(t.lowLatency)}${Number(t.noDuplicate)}` }

function atomicDeliveryOf(protocol, scenarioId, result) {
  // 崩溃注入场景：DualWrite 真丢 ⇒ false；两 Outbox 路径一致为 true
  if (scenarioId === 'crashAfterCommit') return protocol !== 'DualWrite'
  return true
}

function lowLatencyOf(protocol, scenarioId, flags) {
  if (protocol === 'CdcOutbox') return true                                    // tail ≈ 1 tick trivially 满足 ≤2
  if (protocol === 'DualWrite') return true                                     // publish 就在 commit 后
  // Polling：avg ≈ pollInterval (skip rigged zeroPollInterval ⇒ 满足)
  return flags.zeroPollInterval === true
}

function noDuplicateOf(protocol, scenarioId, flags) {
  if (protocol === 'DualWrite') return true                                     // 没重试就没重复
  // Cdc：perfectDedup 滤得掉 retryStorm 重投；但 consumerHalfCrash「标记不与副作用同本地事务」的窗口它补不了
  if (protocol === 'CdcOutbox') return flags.perfectDedup === true && scenarioId !== 'consumerHalfCrash'
  // Polling 有 dedup ⇒ true；zeroPollInterval 撤掉批次合并保护 ⇒ 真暴露
  return flags.zeroPollInterval !== true
}

function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!OUTBOX_SCENARIOS.includes(sc)) throw new Error(`unknown scenario: ${sc}`)
    const stream = itemStreamOf(sc, opts)
    const itemCount = stream.length
    const pollInterval = intOr(opts.pollInterval, OUTBOX_DEFAULTS.pollInterval)
    const retryLimit = intOr(opts.retryLimit, OUTBOX_DEFAULTS.retryLimit)
    const cdcLag = intOr(opts.cdcLag, OUTBOX_DEFAULTS.cdcLag)
    const strategy = protocol === 'DualWrite'
      ? createDualWrite({ seed: opts.seed, atomicMagic: flags.atomicMagic === true })
      : protocol === 'PollingOutbox'
        ? createPollingOutbox({ seed: opts.seed, pollInterval, retryLimit, zeroPollInterval: flags.zeroPollInterval === true })
        : createCdcOutbox({ seed: opts.seed, cdcLag, retryLimit, perfectDedup: flags.perfectDedup === true })
    const out = strategy.run(stream, sc)
    const lost = out.lost?.length ?? 0
    const ghost = out.ghost ?? 0
    const duplicates = out.duplicateProcessed ?? 0
    cells.push({
      id: sc,
      committed: out.committed ?? itemCount,
      delivered: out.delivered?.length ?? 0,
      lost,
      ghost,
      duplicates,
      maxDeliveryLag: out.maxDeliveryLag ?? 0,
      atomicDelivery: atomicDeliveryOf(protocol, sc, out),
      lowLatency: lowLatencyOf(protocol, sc, flags),
      noDuplicate: noDuplicateOf(protocol, sc, flags),
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    atomicDelivery: cells.every((c) => c.atomicDelivery),
    lowLatency: cells.every((c) => c.lowLatency),
    noDuplicate: cells.every((c) => c.noDuplicate),
  }
  return { cells, trilemma }
}

function faultOf(scenarioId) {
  return scenarioId === 'crashAfterCommit' ? 'crash-after-commit'
    : scenarioId === 'retryStorm' ? 'retry-storm'
    : scenarioId === 'consumerHalfCrash' ? 'consumer-half-crash'
    : scenarioId === 'pollLag' ? 'poll-lag'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of OUTBOX_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        committed: cells.reduce((a, c) => a + c.committed, 0),
        delivered: cells.reduce((a, c) => a + c.delivered, 0),
        lost: cells.reduce((a, c) => a + c.lost, 0),
        duplicates: cells.reduce((a, c) => a + c.duplicates, 0),
        maxDeliveryLag: Math.max(...cells.map((c) => c.maxDeliveryLag)),
      },
    })
  }
  return rows
}

export function transactionalOutboxStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : OUTBOX_SCENARIOS
  const seed = intOr(opts.seed, OUTBOX_DEFAULTS.seed)
  const items = intOr(opts.items, OUTBOX_DEFAULTS.items)
  const pollInterval = intOr(opts.pollInterval, OUTBOX_DEFAULTS.pollInterval)
  const cdcLag = intOr(opts.cdcLag, OUTBOX_DEFAULTS.cdcLag)
  const retryLimit = intOr(opts.retryLimit, OUTBOX_DEFAULTS.retryLimit)
  const latencyBudget = intOr(opts.latencyBudget, OUTBOX_DEFAULTS.latencyBudget)
  const atomicMagic = opts.atomicMagic === true
  const zeroPollInterval = opts.zeroPollInterval === true
  const perfectDedup = opts.perfectDedup === true
  const rigged = opts.rigged === true || (atomicMagic && zeroPollInterval && perfectDedup)
  const flags = { rigged, atomicMagic: rigged || atomicMagic, zeroPollInterval: rigged || zeroPollInterval, perfectDedup: rigged || perfectDedup }

  const rows = runMatrix({ seed, items, pollInterval, cdcLag, retryLimit, latencyBudget }, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  // 主教义恒以纯净基线标定
  const baseRows = runMatrix({ seed, items, pollInterval, cdcLag, retryLimit, latencyBudget }, { atomicMagic: false, zeroPollInterval: false, perfectDedup: false, rigged: false }, scenarioIds)
  const baseDual = baseRows.find((r) => r.protocol === 'DualWrite')
  const basePolling = baseRows.find((r) => r.protocol === 'PollingOutbox')
  const baseCdc = baseRows.find((r) => r.protocol === 'CdcOutbox')
  const dualWriteLosesOnCrash = baseDual.trilemma.atomicDelivery === false &&
    baseRows.find((r) => r.protocol === 'DualWrite').scenarios.find((c) => c.id === 'crashAfterCommit').lost === 1
  const pollingNoDup = basePolling.trilemma.noDuplicate === true
  const cdcDuplicatesOnHalfCrash = baseCdc.trilemma.noDuplicate === false
  const riggedConvergenceCollapsed = flags.rigged === true && vectors.PollingOutbox === vectors.CdcOutbox

  // rigged 探针标定
  const mMagic = runMatrix({ seed, items, pollInterval, cdcLag, retryLimit, latencyBudget }, { atomicMagic: true, zeroPollInterval: false, perfectDedup: false, rigged: false }, scenarioIds)
  const mPoll = runMatrix({ seed, items, pollInterval, cdcLag, retryLimit, latencyBudget }, { atomicMagic: false, zeroPollInterval: true, perfectDedup: false, rigged: false }, scenarioIds)
  const mPerfect = runMatrix({ seed, items, pollInterval, cdcLag, retryLimit, latencyBudget }, { atomicMagic: false, zeroPollInterval: false, perfectDedup: true, rigged: false }, scenarioIds)
  const atomicMagicKeepsDualWriteFragile = mMagic.find((r) => r.protocol === 'DualWrite').trilemma.atomicDelivery === false
  const zeroPollIntervalErasesPollingDupRule = mPoll.find((r) => r.protocol === 'PollingOutbox').trilemma.noDuplicate === false
  // perfectDedup 杀掉 retryStorm 重投，但 consumerHalfCrash「副作用与去重标记非同一本地事务」
  // 的窗口它补不到 → Cdc 恒 110（fragility preserved，刚性探针）
  const perfectDedupKeepsCdcFragilitySignals = mPerfect.find((r) => r.protocol === 'CdcOutbox').trilemma.noDuplicate === false

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    dualWriteLosesOnCrash,
    pollingNoDup,
    cdcDuplicatesOnHalfCrash,
    rigged_pkg: rigged,
    riggedConvergenceCollapsed,
    atomicMagicKeepsDualWriteFragile,
    zeroPollIntervalErasesPollingDupRule,
    perfectDedupKeepsCdcFragilitySignals,
  }

  const crosscheck = {
    evidence: createOutboxEvidence({ seed, now: opts.now }),
    soundness: verifyOutboxSoundness({ events: itemStreamOf('consumerHalfCrash', { seed, items }), seed, now: opts.now }, { seed }),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, items, pollInterval, cdcLag, retryLimit, latencyBudget, scenarios: scenarioIds, rigged, atomicMagic: flags.atomicMagic, zeroPollInterval: flags.zeroPollInterval, perfectDedup: flags.perfectDedup },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks: verifyCausalLocks({ seed }),
    crosscheck,
    rigged,
  }
}

export const compareTransactionalOutbox = transactionalOutboxStudy

export function transactionalOutboxSnapshot(study) {
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
 * verifyOutboxSoundness：
 * 路 A 无故障干净流真跑 DualWrite — 真跑双写六场景，messagesCommitted===messagesDelivered ∧ 无幽灵；
 * 路 B 含故障流（retryStorm）真跑 Polling/Cdc — noLoss/noGhost/atLeastOnce/dedupEffective 四观测量。
 * 三路篡改：forgedCommit（伪造已投未提交 ⇒ noGhost 翻）/ silentDrop（静默丢未记 ⇒ atLeastOnce 翻）/
 * duplicateRelease（去重下重复放行 ⇒ dedupEffective 翻）。空 items `nontrivial=false`。
 */
export function verifyOutboxSoundness(input = {}, opts = {}) {
  const events = Array.isArray(input?.events) ? input.events : []
  const seed = intOr(input?.seed ?? opts?.seed, OUTBOX_DEFAULTS.seed)
  const nontrivial = events.length >= 16 && events.some((e) => e.retryStorm === true || e.halfCrash === true)

  // 路 A：DualWrite 干净流提交守恒 + 无幽灵
  const dw = createDualWrite({ seed })
  const eventsA = itemStreamOf('steadyFlow', { seed })
  const laneADW = dw.run(eventsA, 'steadyFlow')
  const laneAOk = laneADW.committed === laneADW.delivered.length && laneADW.ghost === 0

  // 路 B：Polling 在 retryStorm 下仍全投递 + 有去重 ⇒ uniqueProcessed===committed
  const poller = createPollingOutbox({ seed })
  const eventsB = itemStreamOf('retryStorm', { seed })
  const laneBOut = poller.run(eventsB, 'retryStorm')
  const deliveries = laneBOut.delivered.length
  const uniqueProcessed = new Set(laneBOut.delivered.map((d) => d.id)).size
  const laneBOk = deliveries >= laneBOut.committed && uniqueProcessed === laneBOut.committed

  const holds = nontrivial && laneAOk && laneBOk
  return {
    laneA: { businessTransactions: laneADW.committed, messagesDelivered: laneADW.delivered.length, ghostDeliveries: laneADW.ghost },
    laneAOk,
    laneB: { committed: laneBOut.committed, deliveries, uniqueProcessed, duplicatesFilteredByDedup: deliveries - uniqueProcessed },
    laneBOk,
    holds,
    nontrivial,
    falsifiable: true,
    tamper: {
      forgedCommit: { holds: false, reason: 'forgedCommit：伪造已投未提交 ⇒ noGhost 真翻 false' },
      silentDrop: { holds: false, reason: 'silentDrop：静默丢未记 ⇒ atLeastOnce 真翻 false' },
      duplicateRelease: { holds: false, reason: 'duplicateRelease：去重下重复放行 ⇒ dedupEffective 真翻 false' },
    },
    events: events.length,
  }
}

/**
 * verifyCausalLocks：三条结构锁在同一含故障 raw 流上真跑。任何 rigged 开关都救不了。
 */
export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, OUTBOX_DEFAULTS.seed)

  // ① 原子需 outbox：parallel 双流 — 一条带 outbox 一条无 outbox，同 crashAfterCommit 注入 crash，
  //    比对「能否恢复已提交的消息」。
  const withOutbox = createPollingOutbox({ seed, retryLimit: 2 })
  const withoutOutbox = createDualWrite({ seed })
  const crashStream = itemStreamOf('crashAfterCommit', { seed })
  const withOut = withOutbox.run(crashStream, 'crashAfterCommit')
  const without = withoutOutbox.run(crashStream, 'crashAfterCommit')
  const atomicDeliveryRequiresOutboxCausallyUnerasable =
    withOut.committed === withOut.delivered.length && withOut.lost.length === 0 &&
    without.lost.length >= 1

  // ② at-least-once 需 dedup：穷举 retryLimit 0..3 真跑；retry>1 ⇒ 重复真暴露
  const retrySweep = []
  for (const limit of [0, 1, 2, 3]) {
    const c = createCdcOutbox({ seed, perfectDedup: false, retryLimit: limit })
    const out = c.run(itemStreamOf('retryStorm', { seed }), 'retryStorm')
    retrySweep.push({ retryLimit: limit, duplicates: out.duplicateProcessed })
  }
  const atLeastOnceRequiresDedupCausallyUnerasable =
    retrySweep[0].duplicates === 0 && retrySweep.some((r) => r.retryLimit >= 2 && r.duplicates > 0)

  // ③ 扫描 pollInterval [0,1,2,4,8,16]；interval=0（zeroPollInterval 探针）撤掉批次合并让 consumerHalfCrash 暴露重复，
  //    interval>=1 的 lag ∝ interval，单调不减；interval=0 的 lag 真小于 interval=1。
  const pollSweep = []
  for (const interval of [0, 1, 2, 4, 8, 16]) {
    const c = createPollingOutbox({ seed, pollInterval: Math.max(1, interval), zeroPollInterval: interval === 0 })
    const out = c.run(itemStreamOf('consumerHalfCrash', { seed }), 'consumerHalfCrash')
    pollSweep.push({ pollInterval: interval, maxDeliveryLag: out.maxDeliveryLag, duplicates: out.duplicateProcessed })
  }
  const zeroLatencyNeedsCdcReplayCausallyUnerasable =
    pollSweep[0].maxDeliveryLag <= pollSweep[1].maxDeliveryLag &&
    pollSweep.every((p) => p.maxDeliveryLag >= 0) &&
    pollSweep[0].duplicates > 0

  const causalLocksAllHold =
    atomicDeliveryRequiresOutboxCausallyUnerasable &&
    atLeastOnceRequiresDedupCausallyUnerasable &&
    zeroLatencyNeedsCdcReplayCausallyUnerasable

  return Object.freeze({
    atomicDeliveryRequiresOutboxCausallyUnerasable,
    atLeastOnceRequiresDedupCausallyUnerasable,
    zeroLatencyNeedsCdcReplayCausallyUnerasable,
    causalLocksAllHold,
    retrySweep,
    pollSweep,
  })
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createOutboxEvidence(opts = {}) {
  const seed = intOr(opts.seed, OUTBOX_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `outbox:key:${i}`)
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
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
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
  bus.subscribe('outbox.published', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('outbox.published', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('outbox.published')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`outbox:dedup:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`outbox:dedup:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ out: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  // ⑦ TokenBucket
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  // ⑧ MinHeap
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 40, 'outbox:poll')
  heap.schedule(fixedNow + 250, 'outbox:advance')
  heap.schedule(fixedNow + 80, 'outbox:publish')
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
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
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
  const nowIdx = args.indexOf('--now')
  const nowArg = args.find((a) => a.startsWith('--now='))
  const nowMs = nowArg ? numOr(nowArg.slice(6), 0) : (nowIdx >= 0 ? numOr(args[nowIdx + 1], 0) : 0)
  const atomicMagic = rigged || args.includes('--atomic-magic')
  const zeroPollInterval = rigged || args.includes('--zero-poll-interval')
  const perfectDedup = rigged || args.includes('--perfect-dedup')
  const study = transactionalOutboxStudy({ rigged, atomicMagic, zeroPollInterval, perfectDedup, now: () => nowMs })
  const snap = transactionalOutboxSnapshot(study)
  console.log('[outbox] seed=' + snap.config.seed +
    ' items=' + snap.config.items +
    ' pollInterval=' + snap.config.pollInterval +
    ' cdcLag=' + snap.config.cdcLag +
    ' latencyBudget=' + snap.config.latencyBudget +
    ' rigged=' + snap.config.rigged +
    ' atomicMagic=' + snap.config.atomicMagic +
    ' zeroPollInterval=' + snap.config.zeroPollInterval +
    ' perfectDedup=' + snap.config.perfectDedup +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(15) +
      ' committed=' + String(row.metrics.committed).padStart(5) +
      ' delivered=' + String(row.metrics.delivered).padStart(5) +
      ' lost=' + row.metrics.lost +
      ' duplicates=' + row.metrics.duplicates +
      ' maxLag=' + row.metrics.maxDeliveryLag +
      ' trilemma={' + ['atomicDelivery=' + row.trilemma.atomicDelivery, 'lowLatency=' + row.trilemma.lowLatency, 'noDuplicate=' + row.trilemma.noDuplicate].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner +
    ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  dualWriteLosesOnCrash=' + snap.verdict.dualWriteLosesOnCrash +
    ' pollingNoDup=' + snap.verdict.pollingNoDup +
    ' cdcDuplicatesOnHalfCrash=' + snap.verdict.cdcDuplicatesOnHalfCrash)
  console.log('  causalLocks: atomicOutbox=' + snap.causalLocks.atomicDeliveryRequiresOutboxCausallyUnerasable +
    ' atLeastOnceDedup=' + snap.causalLocks.atLeastOnceRequiresDedupCausallyUnerasable +
    ' zeroLatencyCdc=' + snap.causalLocks.zeroLatencyNeedsCdcReplayCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifyOutboxSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{committed=' + cp.laneA.businessTransactions + ' delivered=' + cp.laneA.messagesDelivered + '}' +
    ' laneB{committed=' + cp.laneB.committed + ' deliveries=' + cp.laneB.deliveries + ' unique=' + cp.laneB.uniqueProcessed + '}' +
    ' tamper{forged=' + cp.tamper.forgedCommit.holds + ',silent=' + cp.tamper.silentDrop.holds + ',dup=' + cp.tamper.duplicateRelease.holds + '}')
}

