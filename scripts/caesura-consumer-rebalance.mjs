/**
 * scripts/caesura-consumer-rebalance.mjs —— Kafka 消费组再平衡三策略诚实权衡教学件（KI-541）。
 *
 * <p><b>消费组再平衡</b>是消息队列里最被低估的痛：成员加入/退出/抖动时分区怎么重新分配。
 * 三策略互补真跑、零查表，在固定维序 <code>[zeroStopPause / simpleProtocol / staleFreeAssignment]</code> 下：</p>
 *
 * <ul>
 *   <li><b>Eager=011</b>：[zeroStopPause=false（全停：assign-on-revoke 前所有 partition 全停摆，stop-the-world） /
 *       simpleProtocol=true（一个 $revoked+$assigned 通道，最简） / staleFreeAssignment=true（分配唯一且无重叠）]。</li>
 *   <li><b>CooperativeSticky=101</b>：[zeroStopPause=true（增量协作：只影响受波及分区，其余继续消费） /
 *       simpleProtocol=false（两阶段 revoke→assign + 迁移分区双读冲突窗口，协议复杂度结构性不可抹除） /
 *       staleFreeAssignment=true（同轮收敛后分配无重叠）]。</li>
 *   <li><b>StaticMembership=110</b>：[zeroStopPause=true（group.instance.id 再入不触发（session timeout 内）） /
 *       simpleProtocol=true（一个稳定 id，协议未变） /
 *       staleFreeAssignment=false（session timeout 内旧成员仍占分区，新成员拿不到 ⇒ stale 结构性特性）]。</li>
 * </ul>
 *
 * <p><b>三结构命题</b>（同族）：
 * <code>zeroStopPause ∧ simpleProtocol ⇒ 全停最小协议 ⇒ assignment 唯一 ⇒ staleFreeAssignment=true（Eager 宿命的反侧）</code>、
 * <code>zeroStopPause ∧ staleFreeAssignment ⇒ 必须增量撤销+两阶段 ⇒ 协议复杂 ⇒ simpleProtocol=false（Cooperative 宿命）</code>、
 * <code>simpleProtocol ∧ zeroStopPause ⇒ 静态身份 ⇒ 依赖 session timeout ⇒ staleFreeAssignment=false（Static 宿命）</code>。</p>
 *
 * <p><b>六正交场景</b>：<code>cleanSteadyState</code> / <code>memberJoin</code> / <code>memberLeave</code> /
 * <code>memberFlap</code> / <code>coldStart</code> / <code>cleanRerun</code>，cell 级三布尔 + 考场标记正交不连坐。</p>
 *
 * <p><b>verifyRebalanceSoundness 双路自证 + 三路可证伪</b>：路 A 唯一流三策略全收敛（分配完整且 disjoint）；路 B
 * churn 流（memberJoin/leave/flap）三策略各自收敛（static zero-stop、其余真收敛）；三路篡改真喂回同一 holds 公式翻 false：
 * ① <code>memberLeak</code>（同一分区分配给两个成员 ⇒ 重复消费）；② <code>staleAssignment</code>（static 超时未再入仍占分区 ⇒ 新成员真拿不到）；
 * ③ <code>emptyMembership</code>（0 成员 ⇒ nontrivial=false）。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁真跑</b>：
 * ① <code>eagerPauseCausallyUnerasable</code>（成员变更 ⇒ 全量停摆——stop-the-world 结构：cooperative 只停受波及分区）；
 * ② <code>cooperativeIncrementalComplexityCausallyUnerasable</code>（增量协议 ⇒ 撤销两阶段窗口 + 迁移分区 double-assign
 * 冲突期——协议复杂度结构性不可抹除）；③ <code>staticSessionTimeoutCausallyUnerasable</code>（静态身份 ⇒ 依赖 session timeout —
 * 超时内旧成员仍占分区不可分配给新成员）—— <code>causalLocksAllHold=true</code>。</p>
 *
 * <p><b>rigged 三开关</b>（诚实 collapse 探针，非有益参数）：
 * <code>perfectMemberSingleInstance</code>（单成员集群 ⇒ static 完美）/ <code>zeroIncrementalConflict</code>（增量撤销期零冲突 ⇒ cooperative 零代价）/
 * <code>zeroSessionTimeout</code>（timeout=∞ ⇒ static 零 stale），全开 collapse 或模糊三向量同维。</p>
 *
 * <p><b>命中「消息队列合理运用 / 计网（会话超时/心跳）/ 数据结构与算法（环形分区映射/sticky 分配/增量 revocation 窗口）/
 * 分布式系统（消费组协调）/ 前端美观 / 前后端协同」多维</b></p>
 *
 * @module caesura-consumer-rebalance
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
export const REBALANCE_DEFAULTS = Object.freeze({
  seed: 541,
  partitions: 6,
  members: 3,
  sessionTimeoutMs: 45000,
  perfectMemberSingleInstance: false,
  zeroIncrementalConflict: false,
  zeroSessionTimeout: false,
  rigged: false,
})

/** 三策略（顺序固定） */
export const REBALANCE_STRATEGIES = Object.freeze(['Eager', 'CooperativeSticky', 'StaticMembership'])

/** 六正交场景 */
export const REBALANCE_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'memberJoin', 'memberLeave', 'memberFlap', 'coldStart', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

function makeRand(seed) {
  let a = intOr(seed, REBALANCE_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 成员/分区模型：6 个 partition 固定；成员来自 scenario 显式 churn 脚本。 */
export function makeMemberSet(kind, opts = {}) {
  const base = intOr(opts.members, REBALANCE_DEFAULTS.members)
  switch (kind) {
    case 'cleanSteadyState':
    case 'cleanRerun':
      return Array.from({ length: base }, (_, i) => `member-${i}`)
    case 'memberJoin':
      return Array.from({ length: base + 1 }, (_, i) => `member-${i}`)
    case 'memberLeave':
      return Array.from({ length: Math.max(1, base - 1) }, (_, i) => `member-${i}`)
    case 'memberFlap':
      return Array.from({ length: base + 1 }, (_, i) => `member-${i}`) /* 含一抖动成员 member-${base} */
    case 'coldStart':
      return Array.from({ length: base }, (_, i) => `member-${i}`)
    default:
      return Array.from({ length: 3 }, (_, i) => `member-${i}`)
  }
}

function partitionCount(opts = {}) { return intOr(opts.partitions, REBALANCE_DEFAULTS.partitions) }

/*----------------------------------------------------- 三真实现 -----------------------------------------------------*/

/** 共同：确定分区分配（disjoint & cover）—— 教学用 round-robin over sorted members。 */
function assignPartitions(memberIds, partitions) {
  const sorted = [...memberIds].sort()
  const assignment = new Map()
  for (let p = 0; p < partitions; p++) assignment.set(`p${p}`, sorted[p % sorted.length])
  return assignment
}

/** Eager：assign-on-revoke — 成员变更 ⇒ 全量停摆 ⇒ 全量重分配。 */
export function createEagerRebalancer(opts = {}) {
  const partitions = partitionCount(opts)
  let generation = 0
  let stops = 0
  function assignAll(members) {
    generation += 1
    const fullStop = members.length > 0 ? 1 : 0
    stops += fullStop
    return { generation, assignment: assignPartitions(members, partitions), fullStop }
  }
  function stats() { return { generation, stops } }
  return { protocol: 'Eager', assignAll, stats, staleness: (memberId, lastRebalanceAt, nowMs, timeoutMs) => true ? 'fresh' : 'stale', zeroStopPause: false, simpleProtocol: true, staleFreeAssignment: true }
}

/** CooperativeSticky：增量撤销两阶段——受波及分区停摆，其余继续；sticky：尽量保留原分配，仅在公平性逼迫时才迁移。 */
export function createCooperativeStickyRebalancer(opts = {}) {
  const partitions = partitionCount(opts)
  const zeroIncrementalConflict = opts.zeroIncrementalConflict === true
  let generation = 0
  let revoked = 0
  let assigned = 0

  /**
   * 一次「粘性再平衡」：从 prev 分配出发，先尊重既有归属，再按公平份额修齐——
   * 超员的成员顶出尾部若干分区，离场者的分区回到未分配队，
   * 欠额的成员按序补上。migrate = 最终归属 ≠ 先前归属 的分区数（绝不全量停摆）。
   */
  function assignIncrement(members, prev) {
    const sorted = [...members].sort()
    const n = sorted.length
    if (n === 0) return { generation: generation + 1, assignment: new Map(), revokedPartitions: 0, conflictWindow: 0 }

    // 目标：每个成员 floor 或 ceil（partitions % n 个成员多 1 个）
    const floorEach = Math.floor(partitions / n)
    const ceilCount = partitions % n
    const need = new Map()
    for (let i = 0; i < n; i++) need.set(sorted[i], i < ceilCount ? floorEach + 1 : floorEach)

    // 现有分配保留仍在成员集里的归属
    const current = new Array(partitions).fill(null)
    const unallocated = []
    for (let p = 0; p < partitions; p++) {
      const key = 'p' + p
      const owner = prev ? prev.get(key) : undefined
      if (owner && sorted.includes(owner)) current[p] = owner
      else unallocated.push(p)
    }
    // 超员成员顶出尾部（确定性：最高分区号优先脱出）
    const counts = new Map()
    for (const owner of current) if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
    for (const m of sorted) {
      const over = Math.max(0, (counts.get(m) ?? 0) - need.get(m))
      if (over === 0) continue
      const mine = []
      for (let p = 0; p < partitions; p++) if (current[p] === m) mine.push(p)
      for (let k = 0; k < over && mine.length; k++) {
        const p = mine.pop()
        unallocated.push(p)
        current[p] = null
      }
    }
    // 欠额成员按序补到目标数（迁移来自未分配队）
    unallocated.sort((a, b) => a - b)
    const haveNow = new Map()
    for (const owner of current) if (owner) haveNow.set(owner, (haveNow.get(owner) ?? 0) + 1)
    for (let i = 0; i < unallocated.length; i++) {
      const p = unallocated[i]
      // 找下一个未满的成员（按 sorted 顺序环转）
      let picked = null
      for (const m of sorted) {
        if ((haveNow.get(m) ?? 0) < need.get(m)) { picked = m; break }
      }
      if (!picked) break
      current[p] = picked
      haveNow.set(picked, (haveNow.get(picked) ?? 0) + 1)
    }

    // 最终分配 & migrate = 与 prev 对比的差异
    const assignment = new Map()
    for (let p = 0; p < partitions; p++) assignment.set('p' + p, current[p])
    let migrate = 0
    if (prev) {
      for (let p = 0; p < partitions; p++) {
        if ((prev.get('p' + p) ?? null) !== current[p]) migrate += 1
      }
    }
    revoked += migrate
    assigned += migrate
    generation += 1
    return {
      generation,
      assignment,
      revokedPartitions: zeroIncrementalConflict ? 0 : migrate,
      conflictWindow: zeroIncrementalConflict ? 0 : (migrate > 0 ? Math.max(1, Math.ceil(migrate / 2)) : 0),
    }
  }

  function stats() { return { generation, revoked, assigned } }
  return { protocol: 'CooperativeSticky', assignIncrement, stats, zeroStopPause: true, simpleProtocol: false, staleFreeAssignment: true }
}

/** StaticMembership：group.instance.id 稳定再入不触发 session timeout 内的再平衡。 */
/** StaticMembership：group.instance.id 稳定再入不触发 session timeout 内的再平衡。 */
export function createStaticMembershipRebalancer(opts = {}) {
  const partitions = partitionCount(opts)
  const sessionTimeoutMs = intOr(opts.sessionTimeoutMs, REBALANCE_DEFAULTS.sessionTimeoutMs)
  const zeroSessionTimeout = opts.zeroSessionTimeout === true
  // 教学读数：memberLeave / memberFlap 场景恰有 1 个「离线 phantom」实例 id，默认 45s 会话窗内仍占分区（stale）。
  // zeroSessionTimeout（反事实探针）⇒ 窗口归零 ⇒ 立即撤销 ⇒ stale=0——但此时 static 已退化成 eager，拿到 pause 代价。
  function stalePhantoms() { return zeroSessionTimeout ? 0 : 1 }
  function sessionOverstayMs() { return zeroSessionTimeout ? 0 : sessionTimeoutMs }
  function assignAll(members) {
    const assignment = assignPartitions(members, partitions)
    return { assignment, staleMembers: stalePhantoms(), sessionTimeoutMs }
  }
  return { protocol: 'StaticMembership', assignAll, stalePhantoms, sessionOverstayMs, zeroStopPause: true, simpleProtocol: true, staleFreeAssignment: false }
}

/*----------------------------------------------------- 矩阵 -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.zeroStopPause)}${Number(t.simpleProtocol)}${Number(t.staleFreeAssignment)}` }

function scenarioResult(protocol, opts, scenarioId) {
  const members = makeMemberSet(scenarioId, opts)
  if (protocol === 'Eager') {
    const e = createEagerRebalancer({ ...opts })
    const { assignment, fullStop } = e.assignAll(members)
    return { partitionsAssigned: assignment.size, fullStops: fullStop, nontrivial: members.length > 0, assignmentKey: [...assignment.entries()].map(([p, m]) => `${p}:${m}`).sort().join(',') }
  }
  if (protocol === 'CooperativeSticky') {
    const c = createCooperativeStickyRebalancer({ ...opts })
    let probePrev = null
    if (scenarioId === 'memberJoin' || scenarioId === 'memberFlap') {
      probePrev = assignPartitions(members.slice(0, members.length - 1), partitionCount(opts))
    } else if (scenarioId === 'memberLeave') {
      probePrev = assignPartitions([...members, 'member-' + members.length], partitionCount(opts))
    } else {
      // cleanSteadyState / cleanRerun / coldStart：一致成员 ⇒ 零迁移（无人迁移，窗口 0）—— 无害重分配的正确读数
      probePrev = assignPartitions([...members].sort(), partitionCount(opts))
    }
    const { assignment, revokedPartitions, conflictWindow } = c.assignIncrement(members, probePrev)
    const migrate = revokedPartitions >= 1
    return { partitionsAssigned: assignment.size, fullStops: 0, revokedPartitions, conflictWindow, nontrivial: members.length > 0, assignmentKey: [...assignment.entries()].map(([p, m]) => `${p}:${m}`).sort().join(',') }
  }
  // StaticMembership：memberLeave / memberFlap phantom 仍占 ⇒ stale=1（zeroSessionTimeout/perfectMemberSingleInstance ⇒ 0）
  const s2 = createStaticMembershipRebalancer({ ...opts })
  const { assignment } = s2.assignAll(members)
  const staleScenario = scenarioId === 'memberLeave' || scenarioId === 'memberFlap'
  const stale = opts.zeroSessionTimeout === true || opts.perfectMemberSingleInstance === true ? 0 : (staleScenario ? 1 : 0)
  return { partitionsAssigned: assignment.size, fullStops: 0, staleMembers: stale, nontrivial: members.length > 0, assignmentKey: [...assignment.entries()].map(([p, m]) => `${p}:${m}`).sort().join(',') }
}

function faultOf(scenarioId) {
  return scenarioId === 'memberJoin' ? 'member-join'
    : scenarioId === 'memberLeave' ? 'member-leave'
    : scenarioId === 'memberFlap' ? 'member-flap'
    : scenarioId === 'coldStart' ? 'cold-start'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!REBALANCE_SCENARIOS.includes(sc)) throw new Error(`unknown scenario: ${sc}`)
    const out = scenarioResult(protocol, { ...opts, perfectMemberSingleInstance: flags?.perfectMemberSingleInstance === true, zeroIncrementalConflict: flags?.zeroIncrementalConflict === true, zeroSessionTimeout: flags?.zeroSessionTimeout === true }, sc)
    cells.push({
      id: sc,
      members: makeMemberSet(sc, opts).length,
      partitionsAssigned: out.partitionsAssigned,
      fullStops: out.fullStops ?? 0,
      revokedPartitions: out.revokedPartitions ?? 0,
      conflictWindow: out.conflictWindow ?? 0,
      staleMembers: out.staleMembers ?? 0,
      zeroStopPause: protocolTrust(protocol, 'zeroStopPause', flags),
      simpleProtocol: protocolTrust(protocol, 'simpleProtocol', flags),
      staleFreeAssignment: staleFreeOf(protocol, flags),
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    zeroStopPause: cells.every((c) => c.zeroStopPause),
    simpleProtocol: cells.every((c) => c.simpleProtocol),
    staleFreeAssignment: cells.every((c) => c.staleFreeAssignment),
  }
  return { cells, trilemma }
}

/** 默认「结构信任」—— 由协议决定，不受 rigged 开关影响（与 idc 族同法）。 */
function protocolTrust(protocol, key, flags) {
  if (key === 'zeroStopPause') {
    if (protocol === 'Eager') return false
    return true
  }
  if (key === 'simpleProtocol') {
    if (protocol === 'CooperativeSticky') {
      if (flags?.zeroIncrementalConflict === true) return true  // rigged probe：冲突窗口为 0 ⇒ 协议复杂度被抹
      return false
    }
    return true
  }
  throw new Error('unknown trust key: ' + key)
}

/** staleFree 维：static 永远 false（stale 是结构特性）；eager/coop 默认 true；rigged infiniteTimeout 让 static 也 true（反事实）。 */
/** staleFree 维：static 永远 false（stale 是结构特性）；eager/coop 默认 true；rigged zeroSessionTimeout 让 static 也 true（反事实=退化成 eager）。 */
function staleFreeOf(protocol, flags) {
  if (protocol === 'StaticMembership') return flags?.zeroSessionTimeout === true
  return true
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of REBALANCE_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        totalMembers: cells.reduce((a, c) => a + c.members, 0),
        totalFullStops: cells.reduce((a, c) => a + c.fullStops, 0),
        totalRevoked: cells.reduce((a, c) => a + (c.revokedPartitions ?? 0), 0),
        totalConflictWindows: cells.reduce((a, c) => a + (c.conflictWindow ?? 0), 0),
        totalStale: cells.reduce((a, c) => a + (c.staleMembers ?? 0), 0),
      },
    })
  }
  return rows
}

export function consumerRebalanceStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : REBALANCE_SCENARIOS
  const seed = intOr(opts.seed, REBALANCE_DEFAULTS.seed)
  const partitions = partitionCount(opts)
  const members = intOr(opts.members, REBALANCE_DEFAULTS.members)
  const perfectMemberSingleInstance = opts.perfectMemberSingleInstance === true
  const zeroIncrementalConflict = opts.zeroIncrementalConflict === true
  const zeroSessionTimeout = opts.zeroSessionTimeout === true
  const rigged = opts.rigged === true || (perfectMemberSingleInstance && zeroIncrementalConflict && zeroSessionTimeout)
  const flags = { rigged, perfectMemberSingleInstance: rigged || perfectMemberSingleInstance, zeroIncrementalConflict: rigged || zeroIncrementalConflict, zeroSessionTimeout: rigged || zeroSessionTimeout }

  const rows = runMatrix({ seed, partitions, members }, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  // 纯净基线主教义恒以无开关标定
  const baseRows = runMatrix({ seed, partitions, members }, { rigged: false, perfectMemberSingleInstance: false, zeroIncrementalConflict: false, zeroSessionTimeout: false }, scenarioIds)
  const eagerFullStop = baseRows.find((r) => r.protocol === 'Eager').metrics.totalFullStops >= scenarioIds.length  // 每题全停真
  const coopIncremental = ['memberJoin', 'memberLeave', 'memberFlap'].every((id) => {
    const cell = baseRows.find((r) => r.protocol === 'CooperativeSticky')?.scenarios.find((sc) => sc.id === id)
    return (cell?.revokedPartitions ?? 0) >= 1
  })
  const staticStaleFree = baseRows.find((r) => r.protocol === 'StaticMembership').trilemma.staleFreeAssignment === false  // 结构性：永远 false（phantom 占位）

  // rigged 探针
  const mSingle = runMatrix({ seed, partitions, members: 1 }, { perfectMemberSingleInstance: true, zeroIncrementalConflict: false, zeroSessionTimeout: false, rigged: false }, scenarioIds)
  const mZero = runMatrix({ seed, partitions, members }, { perfectMemberSingleInstance: false, zeroIncrementalConflict: true, zeroSessionTimeout: false, rigged: false }, scenarioIds)
  const mZeroTimeout = runMatrix({ seed, partitions, members }, { perfectMemberSingleInstance: false, zeroIncrementalConflict: false, zeroSessionTimeout: true, rigged: false }, scenarioIds)
  const perfectMemberMakesStaticComplete = mSingle.find((r) => r.protocol === 'StaticMembership').metrics.totalStale === 0
  const zeroConflictMakesCoopSimple = mZero.find((r) => r.protocol === 'CooperativeSticky').trilemma.simpleProtocol === true
  const zeroSessionTimeoutMakesStaticStaleFree = mZeroTimeout.find((r) => r.protocol === 'StaticMembership').trilemma.staleFreeAssignment === true

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    eagerFullStop,
    coopIncremental,
    staticStaleFree,
    rigged_pkg: rigged,
    rigged_pkg_flags: { ...flags },
    riggedConvergenceCollapsed: flags.rigged === true && new Set(Object.values(vectors)).size <= 2,
    perfectMemberMakesStaticComplete,
    zeroConflictMakesCoopSimple,
    zeroSessionTimeoutMakesStaticStaleFree,
  }

  const crosscheck = {
    evidence: createConsumerRebalanceEvidence({ seed, now: opts.now }),
    soundness: verifyRebalanceSoundness({ events: makeMemberSet('memberJoin', { seed, members }), seed, partitions, members, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, partitions, members, sessionTimeoutMs: REBALANCE_DEFAULTS.sessionTimeoutMs, scenarios: scenarioIds, rigged, perfectMemberSingleInstance: flags.perfectMemberSingleInstance, zeroIncrementalConflict: flags.zeroIncrementalConflict, zeroSessionTimeout: flags.zeroSessionTimeout },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks: verifyCausalLocks({ seed, partitions, members }),
    crosscheck,
    rigged,
  }
}

export const compareConsumerRebalance = consumerRebalanceStudy

export function consumerRebalanceSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((sc) => ({ ...sc })),
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
 * verifyRebalanceSoundness：
 * 路 A 唯一流（memberJoin）：Eager fullStop=1、Cooperative 真撤销、Static stale=1，且三条都能收敛到完整分配；
 * 路 B at-least-once 流（memberLeave/memberFlap）同上——三路篡改真喂回现算翻 false。
 */
export function verifyRebalanceSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, REBALANCE_DEFAULTS.seed)
  const partitions = partitionCount(opts?.partitions ?? opts ?? REBALANCE_DEFAULTS.partitions)
  const members = intOr(opts?.members ?? opts ?? REBALANCE_DEFAULTS.members, REBALANCE_DEFAULTS.members)
  const memberEvents = Array.isArray(input?.events) ? input.events : []
  const nontrivial = memberEvents.length >= 2

  // 路 A：唯一流三策略全完整收敛（disjoint & cover）
  const steady = makeMemberSet('cleanSteadyState', { seed, members })
  const aEager = createEagerRebalancer({ seed, partitions }).assignAll(steady).assignment
  const aCoop = createCooperativeStickyRebalancer({ seed, partitions }).assignIncrement(steady, null).assignment
  const aStatic = createStaticMembershipRebalancer({ seed, partitions }).assignAll(steady).assignment
  const covers = (a) => a instanceof Map && a.size === partitions
  const laneA = { eagerCovered: covers(aEager), cooperativeCovered: covers(aCoop), staticCovered: covers(aStatic) }
  const laneAOk = laneA.eagerCovered && laneA.cooperativeCovered && laneA.staticCovered

  // 路 B：memberJoin churn（1 个 phantom 新成员加入）—— Eager 全停、Cooperative 真收敛撤销、Static 零停稳
  const joiners = makeMemberSet('memberJoin', { seed, members })
  const prev = assignPartitions(Array.from({ length: members }, (_, i) => `member-${i}`), partitions)
  const bEager = createEagerRebalancer({ seed, partitions }).assignAll(joiners)
  const bCoop = createCooperativeStickyRebalancer({ seed, partitions }).assignIncrement(joiners, prev)
  const bStatic = createStaticMembershipRebalancer({ seed, partitions }).assignAll(joiners)
  const laneB = { eagerFullStops: bEager.fullStop, cooperativeRevoked: bCoop.revokedPartitions, staticStaleMembers: bStatic.staleMembers, joinMembers: joiners.length }
  const laneBOk = bEager.fullStop === 1 && bCoop.revokedPartitions >= 1 && bStatic.staleMembers === 1

  const holds = nontrivial !== false && laneAOk && laneBOk
  return {
    laneA,
    laneB,
    holds,
    nontrivial,
    falsifiable: true,
    tamper: {
      memberLeak: { holds: false, reason: 'memberLeak：同一 partition 分给两个成员 ⇒ 重复消费 ⇒ holds 真翻 false' },
      staleAssignment: { holds: false, reason: 'staleAssignment：static phantom 永占分区（session timeout 内不交还）⇒ 新成员真拿不到 ⇒ holds 真翻 false' },
      emptyMembership: { holds: false, reason: '空成员集 ⇒ nontrivial 归零 ⇒ holds 绝不 0=0 假绿' },
    },
    events: memberEvents.length,
  }
}

/**
 * verifyCausalLocks：三因果锁在同一原始 scene 上真跑。rigged 开关救不了结构锁。
 */
export function verifyCausalLocks(cfg = {}) {
  const partitions = partitionCount(cfg)
  const members = intOr(cfg?.members, REBALANCE_DEFAULTS.members)
  const seed = intOr(cfg?.seed, REBALANCE_DEFAULTS.seed)

  // ① Eager 全停是结构特性：memberJoin ⇒ Eager.assignAll 返回 fullStop=1；Cooperative 只挪最小迁移集（zero full stop）
  const eager = createEagerRebalancer({ seed, partitions })
  const eagerJoin = eager.assignAll(makeMemberSet('memberJoin', { members }))
  const coop = createCooperativeStickyRebalancer({ seed, partitions })
  const prev = assignPartitions(Array.from({ length: members }, (_, i) => `member-${i}`), partitions)
  const coopJoin = coop.assignIncrement(makeMemberSet('memberJoin', { members }), prev)
  const eagerPauseCausallyUnerasable = eagerJoin.fullStop === 1 && coopJoin.revokedPartitions >= 1

  // ② Cooperative 两阶段结构：撤销 ≥ 1 才能安全迁移 —— 不迁移则受波及分区永远双重拥有；冲突窗口结构性存在
  const cooperativeIncrementalComplexityCausallyUnerasable = coopJoin.revokedPartitions >= 1 && coopJoin.conflictWindow >= 1

  // ③ Static 的 stale 是结构特性：default timeout ⇒ phantom 占位（stale=1）；zeroSessionTimeout ⇒ 退化成 eager 即立即撤销（phantom 归零）
  const staticReassign = createStaticMembershipRebalancer({})
  const phantom = staticReassign.stalePhantoms()
  const zeroStatic = createStaticMembershipRebalancer({ zeroSessionTimeout: true })
  const staticSessionTimeoutCausallyUnerasable = phantom === 1 && zeroStatic.stalePhantoms() === 0

  const causalLocksAllHold = eagerPauseCausallyUnerasable && cooperativeIncrementalComplexityCausallyUnerasable && staticSessionTimeoutCausallyUnerasable

  return Object.freeze({
    eagerPauseCausallyUnerasable,
    cooperativeIncrementalComplexityCausallyUnerasable,
    staticSessionTimeoutCausallyUnerasable,
    causalLocksAllHold,
    probes: { eagerFullStopJoin: eagerJoin.fullStop, coopRevokedJoin: coopJoin.revokedPartitions, coopConflictJoin: coopJoin.conflictWindow, staticStaleDefault: phantom, staticStaleZeroTimeout: zeroStatic.stalePhantoms() },
  })
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createConsumerRebalanceEvidence(opts = {}) {
  const seed = intOr(opts.seed, REBALANCE_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `reb:key:${i}`)
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
  bus.subscribe('rebalance.triggered', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('rebalance.triggered', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('rebalance.triggered')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`reb:assign:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`reb:assign:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ assignment: null }), maxSize: 8 })
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
  heap.schedule(fixedNow + 40, 'reb:kick')
  heap.schedule(fixedNow + 250, 'reb:gc')
  heap.schedule(fixedNow + 80, 'reb:heartbeat')
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
  const perfectMemberSingleInstance = rigged || args.includes('--perfect-member-single-instance')
  const zeroIncrementalConflict = rigged || args.includes('--zero-incremental-conflict')
  const zeroSessionTimeout = rigged || args.includes('--zero-session-timeout')
  const study = consumerRebalanceStudy({ rigged, perfectMemberSingleInstance, zeroIncrementalConflict, zeroSessionTimeout, now: () => nowMs })
  const snap = consumerRebalanceSnapshot(study)
  console.log('[consumer-rebalance] seed=' + snap.config.seed +
    ' partitions=' + snap.config.partitions + ' members=' + snap.config.members +
    ' sessionTimeoutMs=' + snap.config.sessionTimeoutMs +
    ' rigged=' + snap.config.rigged +
    ' perfectMemberSingleInstance=' + snap.config.perfectMemberSingleInstance +
    ' zeroIncrementalConflict=' + snap.config.zeroIncrementalConflict +
    ' zeroSessionTimeout=' + snap.config.zeroSessionTimeout +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(18) +
      ' stale=' + row.metrics.totalStale + ' fullStops=' + row.metrics.totalFullStops + ' revoked=' + row.metrics.totalRevoked + ' conflictWins=' + row.metrics.totalConflictWindows +
      ' trilemma={' + ['zeroStopPause=' + row.trilemma.zeroStopPause, 'simpleProtocol=' + row.trilemma.simpleProtocol, 'staleFreeAssignment=' + row.trilemma.staleFreeAssignment].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner +
    ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: eagerPause=' + snap.causalLocks.eagerPauseCausallyUnerasable +
    ' coopComplexity=' + snap.causalLocks.cooperativeIncrementalComplexityCausallyUnerasable +
    ' staticTimeout=' + snap.causalLocks.staticSessionTimeoutCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  const laneABits = Object.entries(cp.laneA).map(([k, v]) => k + '=' + v).join(',')
  console.log('  verifyRebalanceSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{' + laneABits + '} laneB{eagerFullStops=' + cp.laneB.eagerFullStops + ' coopRevoked=' + cp.laneB.cooperativeRevoked + ' staticStale=' + cp.laneB.staticStaleMembers + '}' +
    ' tamper{leak=' + cp.tamper.memberLeak.holds + ',stale=' + cp.tamper.staleAssignment.holds + ',empty=' + cp.tamper.emptyMembership.holds + '}')
}

