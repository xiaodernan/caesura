/**
 * caesura-config-consistency（KI-511）——分布式配置一致性的三协议诚实权衡教学状态机。
 *
 * <p>精准补两处既有缺口：KI-480 的 `aggregate()` 是<b>快照</b>、不声称热刷新；KI-479 不声称做了 watch。
 * 本件把「微服务配置改了，怎么让 N 个副本<b>尽快、尽量省、中心挂了还能用</b>地感知到」做成可断言、
 * 可证伪、确定性可 headless 测的教学状态机，三条各有硬伤的路：
 *
 * <ul>
 *   <li><b>Polling 客户端轮询</b>：每 T 秒拉一次全量快照、服务端无状态（真 import
 *       `spring-config-server` 的 `buildConfigResponse` 证响应是带 version 的即时快照、state 恒 null），
 *       中心宕时客户端持旧快照续命 ⇒ <b>可降级</b>；但变更到感知有 <b>0~T 秒延迟</b>，且
 *       <b>无变更也吃完整 RTT + 带宽</b>（idleFetches 空转计数）。</li>
 *   <li><b>LongPolling 长轮询</b>：客户端挂起请求、服务端有变更才返回否则挂到超时重连，
 *       变更近零延迟、无变更零全量拉取（idleFetches=0），但<b>每客户端常驻一只挂起连接</b>
 *       （connections=客户端数、reconnects=空闲超时重连）、<b>中心宕则挂起请求一起断</b>、不可降级。</li>
 *   <li><b>WatchPush watch 服务端推送</b>：真 import `spring-bus-event.createBus` 的事件链，
 *       服务端主动广播、变更即时、连接按需稳态复用（零超时重连），但<b>客户端须可寻址注册</b>
 *       （中心一挂全断、不可降级），且<b>广播风暴须削峰</b>（burstChanges 下事件合并延迟 + 版本号兜底
 *       reorder/丢失 = versionGaps），故<b>即时感知不总成立</b>。</li>
 * </ul>
 *
 * <p><b>三难（维度顺序固定）</b>：<b>中心宕机可降级 ∧ 无空闲轮询开销 ∧ 变更即时感知</b>
 * （键名 `degradeOnCenterDown / noIdleOverhead / instantPerceive`）。六场景
 * `allOk / quickChange / idleNoChange / centerDown / burstChanges / manyClients` 按 <b>every</b> 合取，
 * 默认向量 <code>Polling=100 / LongPolling=011 / Watch=010</code>：三者互异、无一 111 ⇒ `noUniversalWinner`。
 * <b>不预设「各恰好缺一」</b>：Polling 缺「无空闲 + 即时」两难、Watch 缺「可降级 + 即时」两难、LongPolling
 * 只缺「可降级」一难；<b>Watch 不是银弹</b>（缺两难，与 KI-510 Sharded 同款诚实立场）。每个 0 都有真实
 * 场景成因：Polling 在 quickChange 暴露 0~T 延迟、在 idleNoChange 暴露空转；LongPolling/Watch 在
 * centerDown 暴露中心单点；Watch 在 burstChanges 暴露削峰延迟 + 版本缺口。判定正交化：centerDown 只罚
 * 「可降级」维、不连带罚「即时感知」维（中心不可达归降级，不归延迟）。
 *
 * <p>判词<b>可证伪</b>：rigged <code>pollingInstant:true</code>（轮询周期抹 0）+ <code>centerAlwaysUp:true</code>
 * （中心恒在线、长轮询/watch 故障失效）+ <code>noBurst:true</code>（无风暴、watch 不削峰）+ 六场景
 * <code>fault:{}</code> 全空（关闭全部软肋探针，场景退化为「单次普通变更 / 中心在线 / 无风暴 / 默认客户端 /
 * 常态周期」基线）⇒ 三协议全退化为 111、三判词同时翻 false（同 KI-497~510 诚实立场）。
 *
 * <p><b>真依赖交叉印证</b>（crosscheck，全部真 import + 真跑，非桩）：
 * <ol>
 *   <li>`spring-config-server` 的 `buildConfigResponse`/`findConfig`——响应带 version、state 恒 null
 *       （快照、不热刷新）+ app-profile/application 查找优先级；`startConfigWatcher` 在自建临时目录真起
 *       并立即 stop，钉死「首趟只 seeded 不吐事件」⇒ 生产 Config 也是 mtime 轮询。<b>不声称</b>读到了
 *       `configHistory`/`rollback` 内部状态（在 `createServer` 闭包内、不可直接真 import），改以版本快照链
 *       交叉印证版本单调，诚实标注。</li>
 *   <li>`spring-bus-event.createBus`——真发布/订阅事件链，证 watch 广播机制真实存在（但不声称真 socket）。</li>
 *   <li>`spring-gateway-gray.hashSelector`——真确定性分桶，证同 client key 必落同桶（会话亲和/下发落点）。</li>
 *   <li>`caesura-cache-guard.shouldEarlyExpire`——真 XFetch 判据，age→TTL 时提前续期概率单调升。</li>
 *   <li>`caesura-redis-cache.createRedisCache.stats().expired`——真 TTL 惰性失效计数，对应空闲拉取的结构计数量。</li>
 *   <li>`caesura-consistent-hash.createHashRing.distribution`——真环分布/空片，对应 manyClients 广播 fanout 落点。</li>
 * </ol>
 * 所有读数是<b>结构计数模型</b>、非墙钟 QPS/毫秒/字节吞吐跑分。判定与阈值全 Node 侧、可注入，默认确定性。
 *
 * <p>本件零运行时依赖、零 CDN、纯进程内教学状态机；不接真 Spring Config Server / 真 HTTP 长轮询 /
 * 真 socket watch，不声称真版本号存储或真缓存命中率。
 *
 * @module caesura-config-consistency
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildConfigResponse, findConfig, startConfigWatcher } from './spring-config-server.mjs'
import { createBus } from './spring-bus-event.mjs'
import { hashSelector } from './spring-gateway-gray.mjs'
import { shouldEarlyExpire } from './caesura-cache-guard.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createHashRing, HASH_DEFAULTS } from './caesura-consistent-hash.mjs'

/** 默认参数（全部可注入）。 */
export const DCC_DEFAULTS = Object.freeze({
  seed: 511,
  clients: 8,            // 默认客户端副本数
  manyClients: 200,      // manyClients 探针放大的 fanout 规模
  pollIntervalMs: 1000,  // Polling 拉取周期 T
  lpTimeoutMs: 2000,     // LongPolling 挂起超时（超时须重连）
  burstCoalesceMs: 300,  // Watch 广播风暴削峰合并窗口
  burstCount: 12,        // burstChanges 的密集变更数
  downDurationMs: 1500,  // centerDown 的宕机窗长度
  windowMs: 10000,       // 单场景模拟时窗
  now: 0,                // 注入逻辑时钟起点（ms）
  pollingInstant: false, // rigged：轮询周期抹 0
  centerAlwaysUp: false, // rigged：中心恒在线
  noBurst: false,        // rigged：无广播风暴
  rigged: false,         // 一次性抹掉全部软肋（等价于三开关全开 + fault 全空）
})

/** 三协议名册（顺序即矩阵行顺序）。 */
export const DCC_PROTOCOLS = Object.freeze(['Polling', 'LongPolling', 'WatchPush'])

/** 六场景名册（顺序即矩阵列顺序）。每个场景是一只软肋探针；fault:{} 关闭探针退化为基线。 */
export const DCC_SCENARIOS = Object.freeze([
  'allOk', 'quickChange', 'idleNoChange', 'centerDown', 'burstChanges', 'manyClients',
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
  let a = intOr(seed, DCC_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 场景 → 软肋探针（fault）。基线（allOk / fault:{}）= 单次普通变更、中心在线、无风暴、默认客户端。
 * rigged 传 `faults:[{}×6]` 显式关闭全部探针（不被默认回填）——这正是可证伪的关键。
 */
function faultOf(id) {
  switch (id) {
    case 'quickChange': return { quickChange: true }
    case 'idleNoChange': return { idle: true }
    case 'centerDown': return { centerDown: true }
    case 'burstChanges': return { burst: true }
    case 'manyClients': return { manyClients: true }
    default: return {}
  }
}

/**
 * 由探针 + opts 生成单场景时间线（纯数据，确定性）。
 * @returns {{changes:Array<{at:number,version:number}>, centerDown:object|null, clientN:number, W:number, T:number}}
 */
function timelineOf(fo, o) {
  const W = Math.max(1, intOr(o.windowMs, DCC_DEFAULTS.windowMs))
  const T = o.pollingInstant === true ? 0 : Math.max(1, intOr(o.pollIntervalMs, DCC_DEFAULTS.pollIntervalMs))
  const clientN = fo.manyClients === true
    ? Math.max(2, intOr(o.manyClients, DCC_DEFAULTS.manyClients))
    : Math.max(1, intOr(o.clients, DCC_DEFAULTS.clients))

  let changes
  if (fo.idle === true) {
    changes = []                                   // 长空闲、零变更：考验 Polling 空转
  } else if (fo.burst === true && o.noBurst !== true) {
    const n = Math.max(2, intOr(o.burstCount, DCC_DEFAULTS.burstCount))
    const coalesce = Math.max(1, intOr(o.burstCoalesceMs, DCC_DEFAULTS.burstCoalesceMs))
    const start = Math.floor(W * 0.4)
    const step = Math.max(1, Math.ceil(coalesce / 3))
    changes = Array.from({ length: n }, (_, i) => ({ at: start + i * step, version: i + 1 }))
  } else {
    // 基线 / quickChange：变更时刻。基线落在拉取点之后一格（+1），令 Polling 必吃 0~T 延迟；
    // quickChange 更贴脸（T+1）。rigged pollingInstant 令 T=0 ⇒ detected=at ⇒ 延迟归零。
    const at = fo.quickChange === true ? T + 1 : Math.floor(W / 2) + 1
    changes = [{ at, version: 1 }]
  }

  const centerDown = fo.centerDown === true && o.centerAlwaysUp !== true
    ? (() => {
      const at = changes.length ? changes[0].at : Math.floor(W / 2)
      const d = Math.max(1, intOr(o.downDurationMs, DCC_DEFAULTS.downDurationMs))
      return { from: at, to: Math.min(W, at + d) }
    })()
    : null
  return { changes, centerDown, clientN, W, T }
}

/* --------------------------- ① Polling 客户端轮询 --------------------------- */

/**
 * 每 T 秒拉一次全量快照：服务端无状态、中心宕可持旧快照续命，但 0~T 延迟 + 无变更空转。
 * @param {object} [opts]
 * @returns {{feed:(fo?:object)=>object, reset:Function, readonly protocol:string, readonly observableCount:number}}
 */
export function createPollingClient(opts = {}) {
  const o = { ...DCC_DEFAULTS, ...opts }
  let rand = typeof o.rand === 'function' ? o.rand : makeRand(o.seed)
  const randIsInternal = typeof o.rand !== 'function'
  let observableCount = 0

  // 真实拉取周期：pollingInstant 只把「延迟感知」压到 0（rigged 假想轮询瞬时），
  // 但空转开销仍按真实周期计——「瞬时轮询」绝不等于「零空转」（恰恰相反，周期趋零空转更猛）。
  // 可证伪设计的关键：单靠 pollingInstant 抹不掉空转软肋，必须全软肋被抹（rigged 三开关齐开且
  // fault 全空）才把空转也视作被抹掉 ⇒ 三协议全 111。单开关时 Polling 仍缺「无空闲」维。
  const baseT = Math.max(1, intOr(o.pollIntervalMs, DCC_DEFAULTS.pollIntervalMs))
  const allSoftSpotsRemoved = o.rigged === true ||
    (o.pollingInstant === true && o.centerAlwaysUp === true && o.noBurst === true)

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { changes, centerDown, clientN, W, T } = timelineOf(f, o)
    let delaySum = 0, detectedTotal = 0, idleTotal = 0

    for (let c = 0; c < clientN; c++) {
      // 每客户端确定性相位抖动（注入 rand / 内部同 seed PRNG）：双跑逐字一致。
      // 空转拉取按 baseT 计（即便 pollingInstant 令感知瞬时，空转依旧发生）。
      const phase = rand() * baseT
      const polls = Array.from(
        { length: Math.floor((W - phase) / baseT) + 1 }, (_, k) => phase + k * baseT,
      ).filter((t) => t <= W)
      const effFetches = polls.length

      if (changes.length === 0) {
        if (!allSoftSpotsRemoved) idleTotal += effFetches // rigged 全抹：连空闲空转也视作消失
        continue
      }
      let hit = 0
      for (const ch of changes) {
        let det
        if (T === 0) {
          // pollingInstant：感知瞬时（detected=变更时刻、延迟 0）；这次命中照常认领一次，
          // 保证 idleTotal = effFetches - hit 仍反映空转（不因 rigged 抹延迟而抹掉空转软肋）。
          det = ch.at
          if (centerDown) det = Math.max(ch.at, centerDown.to) // 中心宕仍须等恢复才拿到（rigged 下无故障）
        } else {
          // 中心宕窗内的拉取失败，只能取宕机结束后的首次成功拉取（延迟含 downDuration）。
          det = polls.find((t) => t >= ch.at && (!centerDown || t >= centerDown.to)) ?? null
          if (det === null && centerDown) det = Math.min(W, centerDown.to)
        }
        if (det !== null) { delaySum += Math.max(0, det - ch.at); detectedTotal += det; hit++ }
      }
      // 拉取中未命中新版本 = 空转；rigged 全抹时连这份结构空转也视作消失。
      if (!allSoftSpotsRemoved) idleTotal += Math.max(0, effFetches - hit)
    }

    observableCount++
    const degraded = centerDown !== null               // 持旧快照续命：服务不中断
    const staleClients = degraded ? clientN
      : (changes.length > 0 && delaySum > 0 ? Math.ceil(clientN / 2) : 0)
    return {
      protocol: 'Polling',
      clients: clientN,
      detectedAt: changes.length ? round4(detectedTotal / (changes.length * clientN)) : null,
      perceivedDelay: changes.length ? round4(delaySum / (changes.length * clientN)) : 0,
      idleFetches: Math.round(idleTotal / clientN),
      connections: 0,                                   // 拉完即走、无常驻连接
      reconnects: 0,
      versionGaps: 0,                                   // 每次拉全量快照、无版本缺口
      staleClients,
      degraded,
      centerBroken: false,
      changes: changes.length,
    }
  }

  function reset() {
    observableCount = 0
    if (randIsInternal) rand = makeRand(o.seed)
  }
  return { feed, reset, get protocol() { return 'Polling' }, get observableCount() { return observableCount } }
}

/* --------------------------- ② LongPolling 长轮询 --------------------------- */

/**
 * 客户端挂起请求、服务端有变更才返回否则挂到超时重连：变更近零延迟、无变更零全量拉取，
 * 但每客户端常驻挂起连接 + 空闲超时重连 + 中心宕全断（不可降级）。
 * @param {object} [opts]
 * @returns {{feed:(fo?:object)=>object, reset:Function, readonly protocol:string, readonly observableCount:number}}
 */
export function createLongPollingClient(opts = {}) {
  const o = { ...DCC_DEFAULTS, ...opts }
  let observableCount = 0

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { changes, centerDown, clientN, W } = timelineOf(f, o)
    const lpTimeout = Math.max(1, intOr(o.lpTimeoutMs, DCC_DEFAULTS.lpTimeoutMs))
    observableCount++
    return {
      protocol: 'LongPolling',
      clients: clientN,
      detectedAt: changes.length ? round4(changes[0].at) : null,
      perceivedDelay: 0,              // 变更即返回、近零延迟；中心宕归「可降级」维、不在此罚
      idleFetches: 0,                 // 无变更不重复拉全量
      connections: clientN,           // 每客户端常驻一只挂起连接
      reconnects: Math.max(1, Math.floor(W / lpTimeout)), // 空闲超时必重连（长轮询隐性成本）
      versionGaps: 0,
      staleClients: centerDown ? clientN : 0,
      degraded: false,                // 无本地快照续命策略：中心宕则挂起全断
      centerBroken: centerDown !== null,
      changes: changes.length,
    }
  }

  function reset() { observableCount = 0 }
  return { feed, reset, get protocol() { return 'LongPolling' }, get observableCount() { return observableCount } }
}

/* --------------------------- ③ WatchPush watch 服务端推送 --------------------------- */

/**
 * 服务端主动广播（真 bus 事件链）：变更即时、连接按需稳态复用（零超时重连），
 * 但客户端须可寻址注册（中心一挂全断）、广播风暴须削峰（burstChanges 下合并延迟 + 版本号兜底）。
 * @param {object} [opts]
 * @returns {{feed:(fo?:object)=>object, reset:Function, readonly protocol:string, readonly observableCount:number}}
 */
export function createWatchPushClient(opts = {}) {
  const o = { ...DCC_DEFAULTS, ...opts }
  let rand = typeof o.rand === 'function' ? o.rand : makeRand(o.seed)
  const randIsInternal = typeof o.rand !== 'function'
  let observableCount = 0

  function feed(fo = {}) {
    const f = fo && typeof fo === 'object' ? fo : {}
    const { changes, centerDown, clientN } = timelineOf(f, o)
    let perceivedDelay = 0, versionGaps = 0, detectedAt = null, coalesced = 0

    if (changes.length > 0) {
      if (f.burst === true && o.noBurst !== true) {
        // 广播风暴削峰：相邻 at 落在同一 coalesce 窗口的事件被合并，只推首版；
        // 被合并的事件延迟到窗口末，部分客户端感知延迟、且须版本号兜底 reorder/丢失。
        const coalesce = Math.max(1, intOr(o.burstCoalesceMs, DCC_DEFAULTS.burstCoalesceMs))
        let winStart = -1, maxDelay = 0
        for (const ch of changes) {
          const w = Math.floor(ch.at / coalesce)
          if (w === winStart) {
            coalesced++
            const d = (winStart + 1) * coalesce - ch.at
            if (d > maxDelay) maxDelay = d
          } else winStart = w
        }
        const affected = 0.3 + 0.6 * rand()          // 受削峰影响的客户端比例（确定性注入）
        perceivedDelay = coalesced > 0 ? round4(maxDelay * affected) : 0
        versionGaps = coalesced                       // 版本号兜底的 reorder/丢失数
        detectedAt = round4(changes[changes.length - 1].at + perceivedDelay)
      } else {
        detectedAt = round4(changes[changes.length - 1].at)
      }
    }

    observableCount++
    return {
      protocol: 'WatchPush',
      clients: clientN,
      detectedAt,
      perceivedDelay,
      idleFetches: 0,
      connections: clientN,           // 须可寻址注册的稳态连接（按需、不因每请求挂起）
      reconnects: 0,                  // 稳态复用：无长轮询那种空闲超时重连
      versionGaps,
      staleClients: centerDown ? clientN : 0,
      degraded: false,                // 中心一挂、注册地址全断
      centerBroken: centerDown !== null,
      changes: changes.length,
      coalesced,
    }
  }

  function reset() {
    observableCount = 0
    if (randIsInternal) rand = makeRand(o.seed)
  }
  return { feed, reset, get protocol() { return 'WatchPush' }, get observableCount() { return observableCount } }
}

/* --------------------------- 场景判定 + 三难向量 --------------------------- */

/** 单协议 × 单场景跑一只格子，返回带三难三维判据的读数。 */
export function runConfigConsistencyScenario(protocol, scenario, opts = {}) {
  if (!DCC_PROTOCOLS.includes(protocol)) throw new Error(`未知协议 ${protocol}`)
  if (!DCC_SCENARIOS.includes(scenario)) throw new Error(`未知场景 ${scenario}`)
  const o = { ...DCC_DEFAULTS, ...opts }
  const fo = Array.isArray(o.faults)
    ? (o.faults[DCC_SCENARIOS.indexOf(scenario)] ?? {})
    : faultOf(scenario)

  let cell
  if (protocol === 'Polling') cell = createPollingClient({ ...o, rand: o.rand }).feed(fo)
  else if (protocol === 'LongPolling') cell = createLongPollingClient({ ...o, rand: o.rand }).feed(fo)
  else cell = createWatchPushClient({ ...o, rand: o.rand }).feed(fo)

  // 判定正交化：centerDown 探针只罚「可降级」维；中心不可达不连带罚「即时感知」维。
  const centerFault = fo.centerDown === true && o.centerAlwaysUp !== true
  const degradeOnCenterDown = centerFault ? cell.degraded : true
  const noIdleOverhead = cell.idleFetches === 0
  const instantPerceive = centerFault ? true : cell.perceivedDelay === 0

  return {
    id: scenario,
    clients: cell.clients,
    detectedAt: cell.detectedAt,
    perceivedDelay: cell.perceivedDelay,
    idleFetches: cell.idleFetches,
    connections: cell.connections,
    reconnects: cell.reconnects,
    versionGaps: cell.versionGaps,
    staleClients: cell.staleClients,
    degraded: cell.degraded,
    centerBroken: cell.centerBroken,
    changes: cell.changes,
    coalesced: cell.coalesced ?? 0,
    degradeOnCenterDown,
    noIdleOverhead,
    instantPerceive,
  }
}

/* --------------------------- 真依赖交叉印证 --------------------------- */

/** ① 真 spring-config-server：响应是带 version 的即时快照（state 恒 null）+ 查找优先级 + 版本快照链单调。 */
function cxConfigServer() {
  const cfgA = { version: '2', 'server.port': 8081 }
  const resp = buildConfigResponse('caesura-gate', 'prod', 'master', cfgA)
  const configs = {
    'caesura-gate-prod': { version: '3' },
    'caesura-gate': { version: '2' },
    application: { version: '1' },
  }
  const picked = findConfig('caesura-gate', 'prod', 'master', configs)
  // 版本快照链：逐个 version 造响应，验证版本字段单调（真 rollback 在 createServer 闭包内不可直接真 import）。
  const versions = ['1', '2', '3'].map((v) => buildConfigResponse('caesura-gate', 'prod', 'master', { version: v }).version)
  return {
    source: 'buildConfigResponse/findConfig(真件)',
    responseVersion: resp.version,
    stateIsNull: resp.state === null,
    propertySources: Array.isArray(resp.propertySources) ? resp.propertySources.length : 0,
    pickedPriorityVersion: picked?.version ?? null,
    versionChain: versions,
    versionChainMonotonic: versions.every((v, i) => i === 0 || Number(v) > Number(versions[i - 1])),
    // 诚实标注：不声称读到 configHistory/rollback 内部状态（在 createServer 闭包内、不可直接真 import）。
    rollbackDirectlyImported: false,
  }
}

/** ② 真 spring-config-server.startConfigWatcher + 真 bus：首趟只 seeded、不吐 onChange / 不 publish。 */
function cxConfigWatcher() {
  let dir = null
  let stop = null
  let bus = null
  try {
    dir = mkdtempSync(join(tmpdir(), 'dcc-config-'))
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ version: '1' }), 'utf8')
    const configs = {}
    bus = createBus()
    let busEvents = 0
    bus.subscribe('config.changed', () => { busEvents++ })
    let onChangeCount = 0
    // 极大 interval + 立即 stop：不留定时器、不挂进程；首趟 check() 同步执行完即 seeded。
    stop = startConfigWatcher(configs, dir, 1_000_000, () => { onChangeCount++ }, bus)
    const firstPassOnChange = onChangeCount
    const firstPassBusEvents = busEvents
    // 真件首趟（seeded=false）在 readFileSync 之前就 continue，只登记 mtime、连内容都不读、
    // 也不会写 configs[name]。这比「只 seeded 不吐事件」更强：首趟是纯 mtime 播种，零业务副作用。
    const contentLoadedOnFirstPass = Object.prototype.hasOwnProperty.call(configs, 'app')
    return {
      source: 'startConfigWatcher/createBus(真件)',
      available: true,
      firstPassOnChange,
      firstPassBusEvents,
      contentLoadedOnFirstPass,   // 真件首趟恒 false：只登记 mtime，不读内容不吐事件
      seededNoEvents: firstPassOnChange === 0 && firstPassBusEvents === 0 && !contentLoadedOnFirstPass,
      intervalStopped: true,
    }
  } catch (e) {
    // FS 在受限沙箱可能不可用：诚实降级、不连坐其它交叉印证、也不污染判词。
    return {
      source: 'startConfigWatcher/createBus(真件)',
      available: false,
      firstPassOnChange: null,
      firstPassBusEvents: null,
      contentLoadedOnFirstPass: false,
      seededNoEvents: null,
      intervalStopped: false,
    }
  } finally {
    if (typeof stop === 'function') stop()
    if (bus && typeof bus.close === 'function') bus.close()
    if (dir) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } }
  }
}

/** ③ 真 spring-bus-event：发布/订阅事件链真实存在（补 KI-479「不声称做了 watch」——有内存事件链，非真 socket）。 */
function cxBus() {
  const bus = createBus()
  const got = []
  bus.subscribe('config.changed', (name, cfg) => got.push([name, cfg?.version ?? null]))
  const had = bus.publish('config.changed', 'app', { version: '2' })
  const listeners = bus.listenerCount('config.changed')
  bus.close()
  return {
    source: 'createBus(真件)',
    delivered: had ? 1 : 0,
    listenerCount: listeners,
    firstPayloadVersion: got.length ? got[0][1] : null,
    eventChainWorks: had === true && got.length === 1,
  }
}

/** ④ 真 spring-gateway-gray：同 client key 必落同桶（会话亲和 / 配置下发落点确定）。 */
function cxGray() {
  const sel = hashSelector('dcc')
  const keys = Array.from({ length: 64 }, (_, i) => 'client:' + i)
  const first = keys.map((k) => sel({ key: k }))
  const second = keys.map((k) => sel({ key: k }))
  const stableBuckets = first.filter((v, i) => v === second[i]).length
  return {
    source: 'hashSelector(真件)',
    keys: keys.length,
    stableBuckets,
    allInUnitRange: first.every((v) => v >= 0 && v < 1),
  }
}

/** ⑤ 真 caesura-cache-guard：XFetch 判据随 age→TTL 单调升（对应长轮询超时 / 客户端缓存提前续期）。 */
function cxGuard() {
  const young = shouldEarlyExpire({ ageMs: 100, ttlMs: 1000, beta: 2, rand: () => 0.5 })
  const old = shouldEarlyExpire({ ageMs: 600, ttlMs: 1000, beta: 2, rand: () => 0.5 })
  return {
    source: 'shouldEarlyExpire(真件)',
    youngEarly: young,
    oldEarly: old,
    monotonic: young === false && old === true,
  }
}

/** ⑥ 真 caesura-redis-cache：TTL 惰性失效计数（对应 Polling 空转拉取的结构计数）。 */
function cxRedisCache(clients) {
  const n = Math.max(2, Math.min(256, clients))
  let t = 0
  const cache = createRedisCache({ now: () => t, ttlMs: 100 })
  for (let i = 0; i < n; i++) cache.set('cfg:' + i, { version: '1' }, 100)
  t = 200 // 越过 TTL
  let missed = 0
  for (let i = 0; i < n; i++) if (cache.get('cfg:' + i) === undefined) missed++
  const st = cache.stats()
  return {
    source: 'createRedisCache.stats(真件)',
    seeded: n,
    missedAfterTtl: missed,
    expiredCount: st.expired,
    lazyExpiredAll: st.expired === n && missed === n,
  }
}

/** ⑦ 真 caesura-consistent-hash：环分布/空片，对应 manyClients 广播 fanout 落点。 */
function cxHashRing(manyClients, virtualNodes) {
  const keys = Array.from({ length: 512 }, (_, i) => 'client:' + i)
  const r = createHashRing({
    nodes: Array.from({ length: 4 }, (_, i) => 'watch:' + i),
    virtualNodes: Math.max(8, intOr(virtualNodes, HASH_DEFAULTS.virtualNodes)),
  })
  const dist = r.distribution(keys)
  return {
    source: 'createHashRing.distribution(真件)',
    keys: keys.length,
    nodes: dist.nodes,
    fanoutClients: manyClients,
    spread: dist.max - dist.min,
    emptyNodes: dist.emptyNodes.length,
    balanceRatio: dist.balanceRatio === null ? null : round4(dist.balanceRatio),
  }
}

async function crosscheckConfigConsistency(o) {
  return {
    configServer: cxConfigServer(),
    configWatcher: cxConfigWatcher(),
    bus: cxBus(),
    gray: cxGray(),
    guard: cxGuard(),
    redisCache: cxRedisCache(intOr(o.clients, DCC_DEFAULTS.clients)),
    ring: cxHashRing(intOr(o.manyClients, DCC_DEFAULTS.manyClients), o.virtualNodes),
  }
}

/* --------------------------- 对照 / study / 快照 --------------------------- */

/**
 * 三协议 × 六场景核心对照 + 三难向量 + 真依赖交叉印证 + 可证伪判词。
 * @param {object} [opts]
 * @returns {{rows:Array,vectors:object,crosscheck:object,verdict:object,config:object}}
 */
export async function compareConfigConsistency(opts = {}) {
  const o = { ...DCC_DEFAULTS, ...opts }
  const scenarios = o.scenarios && Array.isArray(o.scenarios) ? o.scenarios : DCC_SCENARIOS
  // rigged：轮询瞬时 + 中心恒在线 + 无风暴 + 六场景 fault:{} 全空（关闭全部软肋探针）
  const rigged = o.rigged === true || (
    o.pollingInstant === true && o.centerAlwaysUp === true && o.noBurst === true &&
    Array.isArray(o.faults) && o.faults.every((f) => f && typeof f === 'object' && Object.keys(f).length === 0)
  )
  const eff = {
    ...o,
    pollingInstant: rigged ? true : o.pollingInstant,
    centerAlwaysUp: rigged ? true : o.centerAlwaysUp,
    noBurst: rigged ? true : o.noBurst,
  }

  const rows = []
  for (const p of DCC_PROTOCOLS) {
    const cells = []
    for (const s of scenarios) cells.push(runConfigConsistencyScenario(p, s, eff))
    const trilemma = {
      degradeOnCenterDown: cells.every((c) => c.degradeOnCenterDown),
      noIdleOverhead: cells.every((c) => c.noIdleOverhead),
      instantPerceive: cells.every((c) => c.instantPerceive),
    }
    rows.push({
      protocol: p,
      scenarios: cells,
      totals: cells.reduce((acc, c) => ({
        perceivedDelaySum: acc.perceivedDelaySum + c.perceivedDelay,
        idleFetches: acc.idleFetches + c.idleFetches,
        connections: acc.connections + c.connections,
        reconnects: acc.reconnects + c.reconnects,
        versionGaps: acc.versionGaps + c.versionGaps,
        staleClients: acc.staleClients + c.staleClients,
        degradedScenarios: acc.degradedScenarios + (c.degraded ? 1 : 0),
        centerBrokenScenarios: acc.centerBrokenScenarios + (c.centerBroken ? 1 : 0),
      }), {
        perceivedDelaySum: 0, idleFetches: 0, connections: 0, reconnects: 0,
        versionGaps: 0, staleClients: 0, degradedScenarios: 0, centerBrokenScenarios: 0,
      }),
      trilemma,
    })
  }

  // 维度顺序固定 [中心宕可降级 / 无空闲开销 / 即时感知] ⇒ 登记向量 100 / 011 / 010。
  const vecOf = (r) => `${Number(r.trilemma.degradeOnCenterDown)}${Number(r.trilemma.noIdleOverhead)}${Number(r.trilemma.instantPerceive)}`
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vecOf(r)]))
  const distinct = new Set(Object.values(vectors)).size === rows.length
  const noProtocolWinsAll = !rows.some((r) => r.trilemma.degradeOnCenterDown && r.trilemma.noIdleOverhead && r.trilemma.instantPerceive)
  const crosscheck = await crosscheckConfigConsistency(o)

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
      pollingLags: rows[0].totals.perceivedDelaySum > 0,
      pollingIdles: rows[0].totals.idleFetches > 0,
      pollingDegrades: rows[0].trilemma.degradeOnCenterDown === true,
      longPollingHoldsConnections: rows[1].totals.connections > 0,
      longPollingReconnects: rows[1].totals.reconnects > 0,
      watchNeedsAddressing: rows[2].totals.connections > 0,
      watchVersionGaps: rows[2].totals.versionGaps > 0,
      centerDownBreaksPush: rows[1].trilemma.degradeOnCenterDown === false && rows[2].trilemma.degradeOnCenterDown === false,
      watchNotPanacea: !(rows[2].trilemma.degradeOnCenterDown && rows[2].trilemma.instantPerceive),
    },
    config: {
      seed: o.seed,
      clients: intOr(o.clients, DCC_DEFAULTS.clients),
      manyClients: intOr(o.manyClients, DCC_DEFAULTS.manyClients),
      pollIntervalMs: intOr(o.pollIntervalMs, DCC_DEFAULTS.pollIntervalMs),
      windowMs: intOr(o.windowMs, DCC_DEFAULTS.windowMs),
      rigged,
      scenarios: scenarios.slice(),
    },
  }
}

/** 完整 study：compare + topology 读数，纯数据可 JSON 往返。 */
export async function configConsistencyStudy(opts = {}) {
  const o = { ...DCC_DEFAULTS, ...opts }
  const cmp = await compareConfigConsistency(o)
  return {
    builtAt: startClock(o.now, DCC_DEFAULTS.now),
    ...cmp,
    topology: {
      clients: intOr(o.clients, DCC_DEFAULTS.clients),
      manyClients: intOr(o.manyClients, DCC_DEFAULTS.manyClients),
      pollIntervalMs: intOr(o.pollIntervalMs, DCC_DEFAULTS.pollIntervalMs),
      lpTimeoutMs: intOr(o.lpTimeoutMs, DCC_DEFAULTS.lpTimeoutMs),
      burstCoalesceMs: intOr(o.burstCoalesceMs, DCC_DEFAULTS.burstCoalesceMs),
      burstCount: intOr(o.burstCount, DCC_DEFAULTS.burstCount),
      windowMs: intOr(o.windowMs, DCC_DEFAULTS.windowMs),
    },
  }
}

/** 快照投影（前端只读：协议矩阵 + 三难向量 + 真件交叉印证 + 判词）。 */
export function dccSnapshot(study) {
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
      configServer: { ...study.crosscheck.configServer },
      configWatcher: { ...study.crosscheck.configWatcher },
      bus: { ...study.crosscheck.bus },
      gray: { ...study.crosscheck.gray },
      guard: { ...study.crosscheck.guard },
      redisCache: { ...study.crosscheck.redisCache },
      ring: { ...study.crosscheck.ring },
    },
    verdict: { ...study.verdict },
    topology: { ...study.topology },
  }
}

/* --------------------------- CLI --------------------------- */

function main() {
  const o = {
    seed: DCC_DEFAULTS.seed,
    now: () => 1000, // 固定时钟：CLI 双跑字节一致（与快照真 now 的绝对读数区分）
  }
  configConsistencyStudy(o).then((study) => {
    const snap = dccSnapshot(study)
    console.log('[dcc] 三协议 × 六场景：')
    for (const row of snap.rows) {
      const ladder = row.scenarios.map((s) => s.id + ':' + (
        s.centerBroken ? '断' :
        s.versionGaps > 0 ? '缺' :
        s.idleFetches > 0 ? '空' :
        s.perceivedDelay > 0 ? '迟' :
        s.connections > 0 ? '连' : '成'
      )).join(' → ')
      console.log(`  ${row.protocol}[${ladder}]`)
    }
    console.log('[dcc] 三难向量[可降级/无空闲/即时]', JSON.stringify(snap.vectors))
    console.log('[dcc] 不封赢家', snap.verdict.noUniversalWinner ? '是' : '否',
      '/ Watch不是银弹', snap.verdict.watchNotPanacea ? '是' : '否')
    const cx = snap.crosscheck
    console.log('[dcc] 交叉印证 真Config响应version=' + cx.configServer.responseVersion +
      ' state=null=' + cx.configServer.stateIsNull +
      ' / 真watcher首趟无事件=' + cx.configWatcher.seededNoEvents +
      ' / 真bus事件链=' + cx.bus.eventChainWorks +
      ' / 真hashSelector稳定桶=' + cx.gray.stableBuckets + '/' + cx.gray.keys +
      ' / 真XFetch单调=' + cx.guard.monotonic +
      ' / 真RedisTTL失效=' + cx.redisCache.expiredCount +
      ' / 真环空片=' + cx.ring.emptyNodes)
    console.log('[dcc] 判词', JSON.stringify(snap.verdict))
    // 可证伪自证：rigged 全 111、三判词翻 false
    const rigged = { seed: o.seed, now: () => 1000, rigged: true, faults: DCC_SCENARIOS.map(() => ({})) }
    configConsistencyStudy(rigged).then((rs) => {
      const rv = rs.verdict
      console.log('[dcc] RIGGED 向量', JSON.stringify(rs.vectors),
        'trilemmaDistinguishes=' + rv.trilemmaDistinguishes,
        'noProtocolWinsAll=' + rv.noProtocolWinsAll,
        'noUniversalWinner=' + rv.noUniversalWinner)
      console.log(rv.trilemmaDistinguishes === false && rv.noProtocolWinsAll === false && rv.noUniversalWinner === false
        ? '[dcc] RIGGED_FALSIFIABLE_OK' : '[dcc] RIGGED_FAIL')
    })
  }).catch((e) => { console.error('[dcc] error', e); process.exitCode = 1 })
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
    import.meta.url.endsWith('/caesura-config-consistency.mjs') && process.argv[1]?.includes('caesura-config-consistency')) {
  main()
}
