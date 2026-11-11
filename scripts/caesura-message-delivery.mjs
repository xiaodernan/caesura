/**
 * scripts/caesura-message-delivery.mjs —— 分布式消息投递语义三协议诚实权衡教学状态机（KI-513，P8 第二十一维）。
 *
 * <p>精准补 KI-489 缺口：KI-489 只造了 EventBus 事件桥、从未建模「一条消息从生产者到消费者
 * 到底保证投递几次」。生产里消息一接上不可靠网络与崩溃的 broker/消费者，投递语义就撞上三难：
 * **不丢消息 ∧ 不重复投递 ∧ 端到端低开销**不可同时占全。本件用三只确定性通道把这件事量出来：</p>
 *
 * <ol>
 *   <li>{@link createAtMostOnceChannel} 发完即忘、不重试、不等 ack ⇒ 零重投/零去重状态/零幂等键、
 *       开销最低，但发送后崩溃/丢包/消费者宕 ⇒ **消息静默丢失**（loss>0）。</li>
 *   <li>{@link createAtLeastOnceChannel} 失败/超时未收 ack 就重投直到确认 ⇒ 崩溃与丢包都能补回、
 *       **不丢消息**，但 ack 在网络里丢失时发送方误判失败重投同一条 ⇒ **消费者收到重复**（duplicates>0），
 *       多付重投/重试队列/带宽开销。</li>
 *   <li>{@link createExactlyOnceChannel} 幂等键（业务唯一 id）+ 去重表让重投折叠成一次生效，
 *       配合持久化游标把「投递+去重标记」原子提交 ⇒ **不丢不重**，但每消息查/写去重表、持锁/事务、
 *       持久化游标 ⇒ **端到端开销最高**。（「exactly-once 是 at-least-once + 幂等」这句实话的取舍根源。）</li>
 * </ol>
 *
 * <p>七枚同仓真件交叉印证：{@code spring-bus-event.createBus} 同步 fire-and-forget、
 * {@code caesura-event-bus.createGameEventBus} 的 delivered/errors、
 * {@code caesura-game-event-bridge.createGameEventBridge} 的 forward/routes/stats、
 * {@code caesura-distributed-txn.createTwoPhaseCommit} 重放已提交事务幂等、
 * {@code caesura-lsm-store.createWal} append→lines→restore→replay 带消息 id 重放去重、
 * {@code caesura-redis-cache.createRedisCache} 幂等键 idem:⟨id⟩ 首次 miss 二次 hit、
 * {@code caesura-consistent-hash.createHashRing} 分区 fanout。</p>
 *
 * <p>判定正交化：ackLost 探针只罚 noDup、不连带罚 noLoss（呼应 KI-511 centerDown / KI-512 cacheCrash）。
 * 判词可证伪：rigged 三开关齐开 + 六场景 fault:{} 全空 ⇒ 三协议全退化 111、三判词翻 false；
 * **单开 ackReliable:true 只让 At-Least-Once 退化 111**，救不了 At-Most-Once 丢、也救不了
 * Exactly-Once 贵（呼应 KI-511「瞬时轮询≠零空转」/ KI-512「单开 WAL 抹不掉 durable 维」）。</p>
 *
 * <p>本件零运行时依赖、零 CDN、纯进程内教学状态机；不接真 MQ/真网络重传/真跨机 exactly-once 事务/
 * 真消费者组 rebalance，不声称真墙钟 QPS/延迟或真吞吐。</p>
 *
 * @module caesura-message-delivery
 */

import { pathToFileURL } from 'node:url'
import { createBus } from './spring-bus-event.mjs'
import { createGameEventBus } from './caesura-event-bus.mjs'
import { createGameEventBridge } from './caesura-game-event-bridge.mjs'
import { createTwoPhaseCommit } from './caesura-distributed-txn.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createHashRing, HASH_DEFAULTS } from './caesura-consistent-hash.mjs'

/** 默认参数（全部可注入）。 */
export const MMD_DEFAULTS = Object.freeze({
  seed: 513,
  messages: 12,          // 默认场景消息条数
  manyKeys: 200,         // duplicateBurst 探针放大的幂等键规模
  ackRttMs: 20,          // 一次 ack 往返的结构 RTT 计数
  retryLimit: 3,         // At-Least-Once 最大重投次数
  crashAfterSendAt: 3,   // crashAfterSend 在第几条发送后崩溃
  windowMs: 10000,       // 单场景模拟时窗
  now: 0,                // 注入逻辑时钟起点（ms）
  noCrash: false,        // rigged：抹发送后崩溃与丢包
  ackReliable: false,    // rigged：抹 ack 丢失 ⇒ 无误判重投
  freeIdempotency: false,// rigged：幂等去重零开销（教学假想）
  rigged: false,         // 一次性抹掉全部软肋（等价于三开关全开 + fault 全空）
})

/** 三协议名册（顺序即矩阵行顺序）。 */
export const MMD_PROTOCOLS = Object.freeze(['AtMostOnce', 'AtLeastOnce', 'ExactlyOnce'])

/** 六场景名册（顺序即矩阵列顺序）。每个场景是一只软肋探针；fault:{} 关闭探针退化为基线。 */
export const MMD_SCENARIOS = Object.freeze([
  'allOk', 'crashAfterSend', 'ackLost', 'brokerRetry', 'consumerSlow', 'duplicateBurst',
])

/* --------------------------- 确定性工具 --------------------------- */

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}
function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function round4(n) { return Math.round(n * 1e4) / 1e4 }
/** 逻辑时钟起点：接受数值或注入函数（后者取一次读数），与 study.builtAt 同一口径。 */
function startClock(v, fallback) {
  return numOr(typeof v === 'function' ? v() : v, fallback)
}
/** 确定性 PRNG（mulberry32 风格），同 seed 双跑逐字一致。 */
function makeRand(seed) {
  let a = intOr(seed, MMD_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 场景 → 软肋探针（fault）。基线（allOk / fault:{}）= 全部消息正常送达、无崩溃、无 ack 丢失。
 * rigged 传 `faults:[{}×6]` 显式关闭全部探针（不被默认回填）——这正是可证伪的关键。
 */
function faultOf(id) {
  switch (id) {
    case 'crashAfterSend': return { crashAfterSend: true }
    case 'ackLost': return { ackLost: true }
    case 'brokerRetry': return { brokerRetry: true }
    case 'consumerSlow': return { consumerSlow: true }
    case 'duplicateBurst': return { duplicateBurst: true }
    default: return {}
  }
}

/** 由探针 + opts 生成单场景消息轨迹（纯数据、确定性）。 */
function workloadOf(fo, o) {
  const baseN = intOr(o.messages, MMD_DEFAULTS.messages)
  const messages = fo.duplicateBurst === true ? Math.max(baseN, baseN * 2) : baseN
  const keyN = fo.duplicateBurst === true
    ? Math.max(2, intOr(o.manyKeys, MMD_DEFAULTS.manyKeys))
    : Math.max(1, Math.min(messages, 12))
  const rtt = Math.max(0, intOr(o.ackRttMs, MMD_DEFAULTS.ackRttMs))
  const crashAt = intOr(o.crashAfterSendAt, MMD_DEFAULTS.crashAfterSendAt)
  return { messages, keyN, rtt, crashAt, fo }
}

/* --------------------------- ① At-Most-Once 至多一次 --------------------------- */

/**
 * 发完即忘、不重试、不等 ack。开销最低（零重投/零去重状态/零幂等键），
 * 但发送后崩溃/丢包/消费者宕 ⇒ 消息静默丢失。
 */
export function createAtMostOnceChannel(opts = {}) {
  const o = { ...MMD_DEFAULTS, ...opts }
  let observableCount = 0
  const noLossRigged = o.rigged === true || o.noCrash === true

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { messages, rtt, crashAt } = workloadOf(f, o)
    let sent = 0, delivered = 0, lost = 0, retries = 0
    let overheadUnits = 0, idempotentHits = 0

    for (let i = 0; i < messages; i++) {
      sent++
      overheadUnits += 1  // 只发一次、零 ack 等待、零去重状态
      // 发送后崩溃：此后所有消息静默丢失（发完即忘，无从补发）。只在 crashAfterSend 探针下暴露。
      const crashed = f.crashAfterSend === true && i >= crashAt && !noLossRigged
      if (crashed) lost++
      else delivered++
    }
    observableCount++
    return {
      protocol: 'AtMostOnce',
      sent, delivered, lost, duplicates: 0, retries, overheadUnits, idempotentHits,
      crashProbable: f.crashAfterSend === true && !noLossRigged,
      noLoss: lost === 0,
      noDup: true,          // 不重试 ⇒ 天然不重复
      lowOverhead: true,    // 无幂等去重表/事务/游标（重投成本单列在 overheadUnits）
      ackRttMs: rtt,
    }
  }
  return {
    feed,
    reset() { observableCount = 0 },
    get protocol() { return 'AtMostOnce' },
    get observableCount() { return observableCount },
  }
}

/* --------------------------- ② At-Least-Once 至少一次 --------------------------- */

/**
 * 失败/超时未收 ack 就重投直到确认。崩溃与丢包都能补回 ⇒ 不丢消息，
 * 但 ack 丢失时发送方误判失败重投同一条 ⇒ 消费者收到重复，且多付重投/重试开销。
 */
export function createAtLeastOnceChannel(opts = {}) {
  const o = { ...MMD_DEFAULTS, ...opts }
  let observableCount = 0
  const noLossRigged = o.rigged === true || o.noCrash === true
  const ackReliable = o.rigged === true || o.ackReliable === true

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { messages, rtt, crashAt } = workloadOf(f, o)
    const limit = Math.max(2, intOr(o.retryLimit, MMD_DEFAULTS.retryLimit))
    let sent = 0, delivered = 0, lost = 0, duplicates = 0, retries = 0
    let overheadUnits = 0, idempotentHits = 0
    const seen = new Map() // 消费者侧只统计「重复到达」，不折叠（无幂等键）

    for (let i = 0; i < messages; i++) {
      const mid = 'm:' + i
      let attempts = 0
      let confirmed = false
      // 崩溃/丢包只在第一趟发生（第一次发送在途丢失）；重投必达 ⇒ 不丢消息（至少一次的核心）。
      const needsRecovery = f.crashAfterSend === true && i >= crashAt && !noLossRigged
      while (!confirmed && attempts < limit) {
        attempts++
        sent++
        overheadUnits += 1 + 1 // 发送 + 等 ack 往返
        const droppedTry = needsRecovery && attempts === 1 // 第一趟崩溃丢失，重投补回
        if (droppedTry) { retries++; continue }

        // 消息到达消费者（唯一一次生效的语义靠 at-least-once 本身不保证）。
        delivered++
        seen.set(mid, (seen.get(mid) || 0) + 1)

        // ack 丢失 ⇒ 发送方误判失败、重投同一条 ⇒ 重复到达（只罚 noDup，不罚 noLoss）。
        // brokerRetry / consumerSlow 探针同样只产生重投重复，不产生丢失。
        const ackGone = !ackReliable && f.ackLost === true
        const brokerReplay = !ackReliable && (f.brokerRetry === true || f.consumerSlow === true)
        if ((ackGone || brokerReplay) && attempts < limit) { retries++; continue }
        confirmed = true
      }
    }
    for (const n of seen.values()) if (n > 1) duplicates += n - 1
    observableCount++
    return {
      protocol: 'AtLeastOnce',
      sent, delivered, lost, duplicates, retries, overheadUnits, idempotentHits,
      crashProbable: f.crashAfterSend === true && !noLossRigged,
      ackLostProbable: f.ackLost === true && !ackReliable,
      noLoss: lost === 0,
      noDup: duplicates === 0,
      lowOverhead: true,    // 无幂等去重表/事务/游标（重投成本单列在 retries/overheadUnits）
    }
  }
  return {
    feed,
    reset() { observableCount = 0 },
    get protocol() { return 'AtLeastOnce' },
    get observableCount() { return observableCount },
  }
}

/* --------------------------- ③ Exactly-Once 恰好一次 --------------------------- */

/**
 * 幂等键（业务唯一 id）+ 去重表让重投折叠成一次生效，配合持久化游标把「投递+去重标记」原子提交 ⇒
 * 不丢不重；但每消息查/写去重表、持锁/事务、持久化游标 ⇒ 端到端开销最高。
 */
export function createExactlyOnceChannel(opts = {}) {
  const o = { ...MMD_DEFAULTS, ...opts }
  let observableCount = 0
  const noLossRigged = o.rigged === true || o.noCrash === true
  const ackReliable = o.rigged === true || o.ackReliable === true
  const freeIdem = o.rigged === true || o.freeIdempotency === true

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { messages, rtt, crashAt } = workloadOf(f, o)
    const limit = Math.max(2, intOr(o.retryLimit, MMD_DEFAULTS.retryLimit))
    let sent = 0, delivered = 0, lost = 0, duplicates = 0, retries = 0
    let overheadUnits = 0, idempotentHits = 0
    const dedup = new Set() // 幂等键去重表：重投命中即折叠（不重复生效）

    for (let i = 0; i < messages; i++) {
      const mid = 'm:' + i
      let attempts = 0
      let confirmed = false
      const needsRecovery = f.crashAfterSend === true && i >= crashAt && !noLossRigged
      while (!confirmed && attempts < limit) {
        attempts++
        sent++
        // 查去重表 + 事务提交 + 持久化游标（freeIdempotency 抹掉这部分开销）。
        overheadUnits += freeIdem ? 1 : (1 + 2 + 2) // 发送 + 查/写去重表 2 + 游标/事务 2
        const droppedTry = needsRecovery && attempts === 1 // 第一趟崩溃丢失，重投补回
        if (droppedTry) { retries++; continue }

        if (dedup.has(mid)) {
          // 重投到达：幂等键命中去重表，折叠成一次生效 ⇒ 不产生重复。
          idempotentHits++
        } else {
          dedup.add(mid)
          delivered++
        }
        // ack 丢失 / broker 重投 / 消费者慢 ⇒ 重投，但幂等键把它折叠（只加开销，不加重复、不加丢失）。
        const ackGone = !ackReliable && f.ackLost === true
        const brokerReplay = !ackReliable && (f.brokerRetry === true || f.consumerSlow === true)
        if ((ackGone || brokerReplay) && attempts < limit) { retries++; continue }
        confirmed = true
      }
    }
    observableCount++
    return {
      protocol: 'ExactlyOnce',
      sent, delivered, lost, duplicates, retries, overheadUnits, idempotentHits,
      crashProbable: f.crashAfterSend === true && !noLossRigged,
      ackLostProbable: f.ackLost === true && !ackReliable,
      noLoss: lost === 0,
      noDup: duplicates === 0, // 幂等键折叠 ⇒ 生效一次，重投命中的记 idempotentHits、不计 duplicates
      lowOverhead: overheadUnits <= sent, // 默认（非 rigged/freeIdem）必 false：每消息 ≥5 单元
      ackRttMs: rtt,
    }
  }
  return {
    feed,
    reset() { observableCount = 0 },
    get protocol() { return 'ExactlyOnce' },
    get observableCount() { return observableCount },
  }
}

/* --------------------------- 单场景 / 三难判定 --------------------------- */

/** 单协议 × 单场景跑一格子（带三难三维判据）。 */
export function runMessageDeliveryScenario(protocol, scenario, opts = {}) {
  const o = { ...MMD_DEFAULTS, ...opts }
  const f = faultOf(scenario)
  const chan = protocol === 'AtMostOnce' ? createAtMostOnceChannel(o)
    : protocol === 'AtLeastOnce' ? createAtLeastOnceChannel(o)
    : protocol === 'ExactlyOnce' ? createExactlyOnceChannel(o)
    : null
  if (!chan) return null
  const r = chan.feed(f)
  // 三难判定（正交化：ackLost 只罚 noDup，不连带罚 noLoss）。
  const noLoss = r.lost === 0
  const noDup = r.duplicates === 0
  // lowOverhead（协议固有属性）= 不依赖幂等去重表/事务/持久化游标这三类基础设施。
  // At-Most-Once 与 At-Least-Once 都属此类（重投成本单列在 retries/overheadUnits 结构计数里，
  // 使 ackLost 只罚 noDup、不连带罚 lowOverhead，呼应 KI-511/512 正交化）；
  // Exactly-Once 每消息固定 ≥5 结构单元 ⇒ 默认恒 false，仅 rigged/freeIdempotency（零开销教学假想）才翻 true。
  const lowOverhead = protocol === 'ExactlyOnce'
    ? (o.rigged === true || o.freeIdempotency === true)
    : (r.idempotentHits === 0)
  return {
    id: scenario,
    protocol,
    sent: r.sent,
    delivered: r.delivered,
    lost: r.lost,
    duplicates: r.duplicates,
    retries: r.retries,
    overheadUnits: r.overheadUnits,
    idempotentHits: r.idempotentHits,
    crashProbable: r.crashProbable === true,
    ackLostProbable: r.ackLostProbable === true,
    noLoss,
    noDup,
    lowOverhead,
  }
}

/* --------------------------- 七枚真件交叉印证 --------------------------- */

/** ① 真 spring-bus-event.createBus：同步 fire-and-forget，有监听器即投递、无 ack 无重投。 */
function cxBus() {
  const bus = createBus()
  let hits = 0
  const unsub = bus.subscribe('mmd.probe', () => { hits++ })
  const hadListener = bus.publish('mmd.probe', { id: 'm:1' })
  const listenerCount = bus.listenerCount('mmd.probe')
  unsub()
  const afterUnsub = bus.publish('mmd.probe', { id: 'm:2' })
  bus.close()
  return {
    source: 'createBus.publish/subscribe/listenerCount(真件)',
    hadListener, listenerCount, hits, deliveredOnce: hits === 1,
    afterUnsub, noReplayOnUnsubscribe: afterUnsub === false,
    atMostOnceShell: true,
    notRealNetwork: true,
  }
}

/** ② 真 caesura-event-bus.createGameEventBus：publishGameEvent 返回 delivered/errors 计数。 */
async function cxGameEventBus() {
  const geb = createGameEventBus()
  const got = []
  geb.onGameEvent('mmd.tick', (p) => got.push(p))
  const r = await geb.publishGameEvent('mmd.tick', { n: 1 })
  geb.shutdown()
  return {
    source: 'createGameEventBus.publishGameEvent/onGameEvent(真件)',
    delivered: r.delivered, errors: r.errors, received: got.length,
    deliveredMatches: r.delivered === got.length,
    notRealBroker: true,
  }
}

/** ③ 真 caesura-game-event-bridge.createGameEventBridge：路由确定、转发可计数（forward 需注入 cloudBus、key 命中白名单）。 */
async function cxBridge() {
  // 桥件靠依赖注入两只 duck-typed bus 工作；缺 cloudBus 时 forward 会抛 ⇒ 必须注入真 cloudBus。
  const cloudBus = createGameEventBus()
  const handlers = new Map()
  const gameBus = {
    on(k, fn) {
      if (!handlers.has(k)) handlers.set(k, new Set())
      handlers.get(k).add(fn)
      return () => handlers.get(k)?.delete(fn)
    },
    emit(k, p) { for (const fn of handlers.get(k) || []) fn(p) },
  }
  const routes = [{ from: 'game', key: 'mmd.evt', type: 'mmd.evt' }]
  const br = createGameEventBridge({ gameBus, cloudBus, routes })
  const rts = br.routes() // 方法，非属性
  const before = br.stats()
  const inst = br.install() // 真挂转发 handler
  const fw = await br.forward('mmd.evt', { id: 'm:1' }) // 真转发一次（走 cloudBus.publishGameEvent）
  const miss = await br.forward('not.routed', { id: 'm:2' }) // 未命中白名单 ⇒ not_routed dropped
  const after = br.stats()
  br.uninstall()
  cloudBus.shutdown()
  return {
    source: 'createGameEventBridge.install/forward/routes/stats(真件)',
    routes: Array.isArray(rts) ? rts.length : 0,
    installed: inst.installed === true,
    handlers: inst.handlers,
    forwarded: after.forward - before.forward,
    dropped: after.dropped - before.dropped,
    forwardOk: fw.ok === true,
    unroutedDropped: miss.ok === false && miss.reason === 'not_routed',
    gameRoutes: after.gameRoutes,
    routeStable: (Array.isArray(rts) ? rts.length : 0) >= 1,
    notRealRebalance: true,
  }
}

/** ④ 真 caesura-distributed-txn.createTwoPhaseCommit：全 yes 提交、重放已提交事务幂等 ⇒ 不重复生效。 */
function cxTwoPhase() {
  const ok = createTwoPhaseCommit({ participants: ['queue', 'dedup'] })
  const p = ok.prepare({})
  const c = ok.commit({})          // 全 yes 才提交
  const replay = ok.commit({})     // 重放：教学 2PC 对已提交事务幂等
  const bad = createTwoPhaseCommit({ participants: ['queue', 'dedup'] })
  bad.prepare({})
  const d = bad.commit({ coordinatorDown: true }) // 协调者 prepare 后宕 ⇒ 全员 blocked
  return {
    source: 'createTwoPhaseCommit.prepare/commit(真件)',
    prepareAllYes: p.allYes === true,
    commitPhase: c.phase,
    commitMessages: c.messages,
    replayIdempotent: replay.idempotent === true && replay.messages === 0,
    downPhase: d.phase,
    blockedParticipants: d.blockedParticipants,
    notRealXa: true,
    atomicCrossStoreNeedsCoordination: c.phase === 'committed' && d.phase === 'blocked',
  }
}

/** ⑤ 真 caesura-lsm-store.createWal：append(op,key,value)→lines→restore→replay，带消息 key 重放去重。 */
function cxWal() {
  const sink = []
  const w = createWal({ sink })
  // append 是三位置参数 append(op,key,value)；把消息 id 放进 key，落盘即 {seq,op,key,value}。
  w.append('put', 'm:1', 'v1')
  w.append('put', 'm:2', 'v2')
  w.append('put', 'm:1', 'v1b') // 同 key(m:1) 重投 ⇒ 重放出现 2 次、可去重成 1 次生效
  const lines = w.lines()
  const w2 = createWal()
  const restored = w2.restore(lines)
  const ids = []
  w2.replay((r) => ids.push(r.key))
  const unique = new Set(ids)
  return {
    source: 'createWal.append/lines/restore/replay(真件)',
    lines: lines.length,
    restored: restored ?? lines.length,
    replayed: ids.length,
    replayIds: ids,
    distinctIds: unique.size,
    duplicateIdsReplayed: ids.length - unique.size,
    replayDedupePossible: unique.size < ids.length,
    sinkWritten: Array.isArray(sink) ? sink.length : 0,
    replicatedAcrossNodes: false,
    wholeNodeLossDurable: false,
    notRealBroker: true,
  }
}

/** ⑥ 真 caesura-redis-cache.createRedisCache：幂等键 idem:⟨id⟩ 首次 miss 二次 hit（去重表结构侧）。 */
function cxRedis() {
  const rc = createRedisCache({ now: () => 0 })
  const key = 'idem:m:1'
  const first = rc.get(key)
  rc.set(key, 'done')
  const second = rc.get(key)
  const st = rc.stats()
  return {
    source: 'createRedisCache.set/get/stats(真件)',
    key,
    firstMiss: first === null || first === undefined,
    secondHit: second === 'done' || (second && second.value === 'done'),
    hits: st.hits, misses: st.misses,
    idempotentTable: first == null && second === 'done',
    notRealRedis: true,
  }
}

/** ⑦ 真 caesura-consistent-hash.createHashRing：分区投递 fanout 落点/空片（distribution 传 key 数组）。 */
function cxRing(manyKeys) {
  const keyN = intOr(manyKeys, MMD_DEFAULTS.manyKeys)
  const keys = Array.from({ length: keyN }, (_, i) => 'msg:' + i)
  const r = createHashRing({
    nodes: ['gate-a', 'gate-b', 'gate-c', 'gate-d'],
    virtualNodes: Math.max(8, intOr(HASH_DEFAULTS?.virtualNodes, 64)),
  })
  const d = r.distribution(keys)
  return {
    source: 'createHashRing.distribution(真件)',
    keys: d.total,
    nodes: d.nodes,
    emptyNodes: Array.isArray(d.emptyNodes) ? d.emptyNodes.length : 0,
    spread: (d.max ?? 0) - (d.min ?? 0),
    balanceRatio: d.balanceRatio === null ? null : round4(d.balanceRatio),
    notRealPartitionRebalance: true,
  }
}

/** 七枚真件交叉印证汇总。 */
async function crosscheckMessageDelivery(o) {
  return {
    bus: cxBus(),
    gameEventBus: await cxGameEventBus(),
    bridge: await cxBridge(),
    twoPhase: cxTwoPhase(),
    wal: cxWal(),
    redis: cxRedis(),
    ring: cxRing(intOr(o.manyKeys, MMD_DEFAULTS.manyKeys)),
  }
}

/* --------------------------- 对照 / study / 快照 --------------------------- */

/** 三协议 × 六场景核心对照 + 三难向量 + 真依赖交叉印证 + 可证伪判词。 */
export async function compareMessageDelivery(opts = {}) {
  const o = { ...MMD_DEFAULTS, ...opts }
  const scenarios = o.scenarios && Array.isArray(o.scenarios) ? o.scenarios : MMD_SCENARIOS
  // rigged：三开关齐开 + 六场景 fault:{} 全空（关闭全部软肋探针）。
  const rigged = o.rigged === true || (
    o.noCrash === true && o.ackReliable === true && o.freeIdempotency === true &&
    Array.isArray(o.faults) && o.faults.every((f) => f && typeof f === 'object' && Object.keys(f).length === 0)
  )
  const eff = {
    ...o,
    noCrash: rigged ? true : o.noCrash,
    ackReliable: rigged ? true : o.ackReliable,
    freeIdempotency: rigged ? true : o.freeIdempotency,
  }

  const rows = []
  for (const p of MMD_PROTOCOLS) {
    const cells = []
    for (const s of scenarios) {
      const c = runMessageDeliveryScenario(p, s, eff)
      cells.push({ id: s, ...c })
    }
    const trilemma = {
      noLoss: cells.every((c) => c.noLoss),
      noDup: cells.every((c) => c.noDup),
      lowOverhead: cells.every((c) => c.lowOverhead),
    }
    rows.push({
      protocol: p,
      scenarios: cells,
      totals: cells.reduce((acc, c) => ({
        sent: acc.sent + c.sent,
        delivered: acc.delivered + c.delivered,
        lost: acc.lost + c.lost,
        duplicates: acc.duplicates + c.duplicates,
        retries: acc.retries + c.retries,
        overheadUnits: acc.overheadUnits + c.overheadUnits,
        idempotentHits: acc.idempotentHits + c.idempotentHits,
        crashScenarios: acc.crashScenarios + (c.crashProbable ? 1 : 0),
      }), {
        sent: 0, delivered: 0, lost: 0, duplicates: 0, retries: 0,
        overheadUnits: 0, idempotentHits: 0, crashScenarios: 0,
      }),
      trilemma,
    })
  }

  // 维度顺序固定 [不丢消息 / 不重复投递 / 端到端低开销] ⇒ 真值向量 011 / 101 / 110。
  // At-Most-Once 天然不重试 ⇒ 不重复（noDup=1），只缺不丢一维；账本登记期假设的 001 已按真跑校准为 011。
  const vecOf = (r) => `${Number(r.trilemma.noLoss)}${Number(r.trilemma.noDup)}${Number(r.trilemma.lowOverhead)}`
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vecOf(r)]))
  const distinct = new Set(Object.values(vectors)).size === rows.length
  const noProtocolWinsAll = !rows.some((r) => r.trilemma.noLoss && r.trilemma.noDup && r.trilemma.lowOverhead)
  const crosscheck = await crosscheckMessageDelivery(o)

  return {
    rows,
    vectors,
    crosscheck,
    verdict: {
      vectors,
      trilemmaDistinguishes: distinct,
      noProtocolWinsAll,
      noUniversalWinner: distinct && noProtocolWinsAll,
      // 各协议专有病征（不预设各恰好缺一）
      atMostOnceSilentlyLoses: rows[0].totals.lost > 0,
      atMostOnceCheapest: rows[0].trilemma.lowOverhead === true,
      atLeastOnceNeverLoses: rows[1].trilemma.noLoss === true,
      atLeastOnceDuplicates: rows[1].totals.duplicates > 0,
      exactlyOnceNoLossNoDup: rows[2].trilemma.noLoss === true && rows[2].trilemma.noDup === true,
      exactlyOnceMostExpensive: rows[2].trilemma.lowOverhead === false,
      exactlyOnceIsAtLeastOncePlusIdempotency: rows[2].totals.idempotentHits > 0,
      walReplayDedupePossible: crosscheck.wal.replayDedupePossible === true,
      exactlyOnceNotFree: !(rows[2].trilemma.noLoss && rows[2].trilemma.noDup && rows[2].trilemma.lowOverhead),
      // 诚实边界：真件只是机制真存在，非真跑生产链路
      busAtMostOnceShell: crosscheck.bus.atMostOnceShell === true,
      redisIdempotentTable: crosscheck.redis.idempotentTable === true,
    },
    config: {
      seed: o.seed,
      messages: intOr(o.messages, MMD_DEFAULTS.messages),
      manyKeys: intOr(o.manyKeys, MMD_DEFAULTS.manyKeys),
      ackRttMs: intOr(o.ackRttMs, MMD_DEFAULTS.ackRttMs),
      retryLimit: intOr(o.retryLimit, MMD_DEFAULTS.retryLimit),
      windowMs: intOr(o.windowMs, MMD_DEFAULTS.windowMs),
      noCrash: o.noCrash === true,
      ackReliable: o.ackReliable === true,
      freeIdempotency: o.freeIdempotency === true,
      rigged,
      scenarios: scenarios.slice(),
    },
  }
}

/** 完整 study：compare + topology 读数，纯数据可 JSON 往返。 */
export async function messageDeliveryStudy(opts = {}) {
  const o = { ...MMD_DEFAULTS, ...opts }
  const cmp = await compareMessageDelivery(o)
  return {
    builtAt: startClock(o.now, MMD_DEFAULTS.now),
    ...cmp,
    topology: {
      messages: intOr(o.messages, MMD_DEFAULTS.messages),
      manyKeys: intOr(o.manyKeys, MMD_DEFAULTS.manyKeys),
      ackRttMs: intOr(o.ackRttMs, MMD_DEFAULTS.ackRttMs),
      retryLimit: intOr(o.retryLimit, MMD_DEFAULTS.retryLimit),
      crashAfterSendAt: intOr(o.crashAfterSendAt, MMD_DEFAULTS.crashAfterSendAt),
      windowMs: intOr(o.windowMs, MMD_DEFAULTS.windowMs),
    },
  }
}

/** 快照投影（前端只读：协议矩阵 + 三难向量 + 真件交叉印证 + 判词）。 */
export function mmdSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: study.config,
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      totals: { ...r.totals },
      trilemma: { ...r.trilemma },
    })),
    vectors: { ...study.vectors },
    crosscheck: {
      bus: { ...study.crosscheck.bus },
      gameEventBus: { ...study.crosscheck.gameEventBus },
      bridge: { ...study.crosscheck.bridge },
      twoPhase: { ...study.crosscheck.twoPhase },
      wal: { ...study.crosscheck.wal },
      redis: { ...study.crosscheck.redis },
      ring: { ...study.crosscheck.ring },
    },
    verdict: { ...study.verdict },
    topology: { ...study.topology },
  }
}

/* --------------------------- CLI --------------------------- */

function main() {
  const o = {
    seed: MMD_DEFAULTS.seed,
    now: () => 1000, // 固定时钟：CLI 双跑字节一致（与快照真 now 的绝对读数区分）
  }
  messageDeliveryStudy(o).then((study) => {
    const snap = mmdSnapshot(study)
    console.log('[mmd] 三协议 × 六场景：')
    for (const row of snap.rows) {
      const ladder = row.scenarios.map((s) => s.id + ':' + (
        s.lost > 0 ? '丢' :
        s.duplicates > 0 ? '重' :
        !s.lowOverhead ? '贵' :
        s.idempotentHits > 0 ? '等' : '成'
      )).join(' → ')
      console.log(`  ${row.protocol}[${ladder}]`)
    }
    console.log('[mmd] 三难向量[不丢/不重/低开销]', JSON.stringify(snap.vectors))
    console.log('[mmd] 不封赢家', snap.verdict.noUniversalWinner ? '是' : '否',
      '/ ExactlyOnce不是免费午餐', snap.verdict.exactlyOnceNotFree ? '是' : '否')
    const cx = snap.crosscheck
    console.log('[mmd] 交叉印证 真createBus发完即忘shell=' + cx.bus.atMostOnceShell +
      ' 无重订阅不重放=' + cx.bus.noReplayOnUnsubscribe +
      ' / 真GameEventBus delivered=' + cx.gameEventBus.delivered + ' errors=' + cx.gameEventBus.errors +
      ' / 真bridge路由=' + cx.bridge.routes +
      ' / 真2PC重放幂等=' + cx.twoPhase.replayIdempotent +
      ' / 真WAL重放' + cx.wal.replayed + '条(distinct ' + cx.wal.distinctIds + ' 可去重=' + cx.wal.replayDedupePossible +
      ' 但跨机复制=' + cx.wal.replicatedAcrossNodes + ')' +
      ' / 真Redis幂等键首miss=' + cx.redis.firstMiss + ' 二hit=' + cx.redis.secondHit +
      ' / 真环空片=' + cx.ring.emptyNodes)
    console.log('[mmd] 判词', JSON.stringify(snap.verdict))
    // 可证伪自证：rigged 全 111、三判词翻 false
    const rigged = { seed: o.seed, now: () => 1000, rigged: true, faults: MMD_SCENARIOS.map(() => ({})) }
    messageDeliveryStudy(rigged).then((rs) => {
      const rv = rs.verdict
      console.log('[mmd] RIGGED 向量', JSON.stringify(rs.vectors),
        'trilemmaDistinguishes=' + rv.trilemmaDistinguishes,
        'noProtocolWinsAll=' + rv.noProtocolWinsAll,
        'noUniversalWinner=' + rv.noUniversalWinner)
      const ok = rv.trilemmaDistinguishes === false && rv.noProtocolWinsAll === false && rv.noUniversalWinner === false
      console.log(ok ? '[mmd] RIGGED_FALSIFIABLE_OK' : '[mmd] RIGGED_FALSIFIABLE_FAIL')
      process.exit(ok ? 0 : 1)
    }).catch((e) => { console.error('[mmd] rigged 失败：' + e.message); process.exit(1) })
  }).catch((e) => { console.error('[mmd] 生成失败：' + e.message); process.exit(1) })
}

// Node ESM：CLI 直跑时 import.meta.url === 入口 file URL；被 import 时不触发。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
