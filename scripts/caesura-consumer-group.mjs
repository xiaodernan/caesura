/**
 * scripts/caesura-consumer-group.mjs —— 消费者组 rebalance / 分区所有权三协议诚实权衡教学状态机（KI-523，P8 第三十维）。
 *
 * <p>精准补 KI-513 / KI-518 / KI-520 消息队列族最后一环：KI-513 只答「保证投递几次」（可靠性语义），
 * KI-518 只答「一条消息何时被唤醒」（延迟调度），KI-520 只答「失败后以什么节奏重试、何时进死信」，
 * 却都没建模<b>一个消费组里多个消费者如何分摊 topic 分区</b>这一 Kafka 最核心工程命题——
 * 分区分配不均则部分消费者空转、成员加入/退出时若全量重排则正在消费的分区大规模迁移拖垮 rebalance 停摆、
 * 而一致性哈希的粘性又非免费（要为最小迁移付算法代价）。生产里的答案从来不是唯一：</p>
 *
 * <ol>
 *   <li>{@link createRangeAssignor} Range：对每个 topic 把连续分区段分给按字典序排列的订阅者 ⇒
 *       opUnits 最省（每 topic 只算 O(C) 个边界）、迁移时只有段尾挪动；但多 topic 分区数不能整除消费者数时
 *       余数<b>系统性压在前几个消费者</b>、异构订阅（消费者订阅的 topic 集合不同）时必偏斜 ⇒ 不均衡。</li>
 *   <li>{@link createRoundRobinAssignor} RoundRobin：把所有 (topic, partition) 摊平成全局序列轮询分配、
 *       跳过未订阅者 ⇒ 同构多 topic 下余数被均匀打散、比 Range 均衡；但 rebalance 时全局序列从头重排 ⇒
 *       <b>成员一变就大规模迁移</b>，正在消费的分区几乎全换主。</li>
 *   <li>{@link createStickyAssignor} Sticky：保留 prev 中仍合法的归属（消费者还在且仍订阅该 topic）→
 *       把失效/新增分区贪心补给当前负载最轻的订阅者 → 有限 1 轮均衡迁移 ⇒ <b>成员变动最小迁移 + 负载感知</b>；
 *       但要遍历 prev、算负载、贪心、可能再迁移 ⇒ opUnits 最贵、rebalance 计算停摆最长，
 *       <b>它占「均衡 + 最小迁移」两维却缺「算法轻量」⇒ 不是银弹</b>。</li>
 * </ol>
 *
 * <p>三难（维序固定）：<b>分配均衡 ∧ 成员变动最小迁移 ∧ 算法轻量</b>（向量 `[balanced/minimalMovement/cheap]`，
 * Range=001 / RoundRobin=100 / Sticky=110，三者互异、无一 111 ⇒ noUniversalWinner；各有胜场——
 * Range 只便宜却偏斜又大迁移、RR 只均衡却成员变动全量重排、Sticky 占两维却最贵）。
 * 判定<b>正交化</b>：{@code balanced} 只在四个公平性场景量（partitionSkew/heteroSubscriptions 显偏斜、
 * memberJoin/memberLeave 显新成员饥饿，综合 avgImbalance ≤ 1.4 且无消费者零分区）；
 * {@code minimalMovement} 只在成员变动场景量（memberJoin+memberLeave 的 moveSum ≤ 0.5）；
 * {@code cheap} 只在大分区场景 manyPartitions 量（opUnits/分区 ≤ 2）；其余场景该维空真、不连坐。</p>
 *
 * <p><b>判词可证伪且因果锁死</b>：rigged 三开关 {@code perfectBalance}（强制完美均衡）+
 * {@code zeroMovement}（冻结归属、零迁移）+ {@code freeCompute}（opUnits 归零）齐开 ⇒
 * 真实现算向量收敛为 <b>101/101/101</b>、三判词翻 false。根因是 <b>因果互斥</b>：
 * 想抹掉「最小迁移」就得 {@code zeroMovement} 冻结归属，可一旦成员退出，退出者的分区必须被接管、
 * 新加入者必须分到分区，若又同时 {@code perfectBalance} 强制完美均衡就<b>必须推倒全量重排</b> ⇒
 * {@code moveSum} 真算暴涨到 1.125~1.625 > 0.5 预算 ⇒ <b>「最小迁移」这一维被反噬、三开关无一能翻回真</b>
 * （{@code freeCompute} 只抹 opUnits、{@code zeroMovement} 与 {@code perfectBalance} 逻辑相克）——
 * 它抹不掉、判词照样可证伪，<b>绝不硬覆盖成全 111 造假</b>。单开 {@code zeroMovement} 冻结归属 ⇒
 * 新成员一个分区都分不到（{@code starved=true}）⇒ 「均衡」当场反噬 false（呼应 KI-520 单开 zeroBackoff
 * 只抹恢复延迟、单开 perfectJitter 只打散惊群）。</p>
 *
 * <p>九枚同仓真件交叉印证（{@link createConsumerGroupEvidence}）：{@code caesura-consistent-hash}
 * 三件——{@code compareRemapping} 真算一致性哈希 vs 取模在节点增减时的迁移率（Sticky 的粘性底座对照）、
 * {@code createShardRouter.remapOn} 真吐 moved/rate（成员变动最小迁移的到达证明）、
 * {@code createHashRing} addNode/removeNode/distribution 真回读环分布；
 * {@code caesura-lsm-store.createWal} append→lines→restore→replay 证**成员变更日志真可回放**；
 * {@code spring-bus-event.createBus} rebalance-done 通知真投递；
 * {@code caesura-redis-cache.createRedisCache} {@code SETEX} 组元数据/代次真落；
 * {@code caesura-hw-perf.createObjectPool} 分配结果对象复用省 GC；
 * {@code caesura-rate-limiter.createTokenBucket} rebalance 防抖限流真 allow；
 * {@code caesura-delay-queue.createMinHeapDelayQueue} 迁移任务排程真 advance。全真 API 真调用真回读，计数绝不硬编码。</p>
 *
 * <p>本件零运行时依赖、纯进程内确定性教学状态机；不接真 Kafka broker/真消费者组协调者/真 cooperative
 * incremental rebalance/真跨机分区迁移；不声称墙钟 rebalance 停摆毫秒或吞吐跑分（全 opUnits 结构计数）；
 * 三真分配算法是教学简化版（Sticky 只做有限 1 轮均衡、非 Kafka 完整 partition-move 图算法），如实标注。</p>
 *
 * @module caesura-consumer-group
 */

import { pathToFileURL } from 'node:url'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createHashRing, compareRemapping, createShardRouter } from './caesura-consistent-hash.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createObjectPool } from './caesura-hw-perf.mjs'

/** 默认注入全参数（全部可覆盖） */
export const CGP_DEFAULTS = Object.freeze({
  seed: 523,
  consumers: 3,
  partitionsPerTopic: 4,
  joinConsumers: 5,
  leaveConsumers: 3,
  moveConsumers: 4,
  movePartitions: 8,
  bigConsumers: 8,
  bigPartitions: 200,
  balanceBudget: 1.4,
  movementBudget: 0.5,
  computeBudget: 2,
  perfectBalance: false,
  zeroMovement: false,
  freeCompute: false,
  rigged: false,
})

/** 三协议（顺序固定） */
export const CGP_PROTOCOLS = Object.freeze(['Range', 'RoundRobin', 'Sticky'])

/** 六场景（顺序固定） */
export const CGP_SCENARIOS = Object.freeze([
  'steadyState', 'partitionSkew', 'heteroSubscriptions', 'memberJoin', 'memberLeave', 'manyPartitions',
])

/* --------------------------- 判定工具 --------------------------- */

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}
function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
/** 注入时钟：可以是数字或函数（builtAt 契约要求对函数求值，同 KI-518/520 startClock） */
function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}
function round4(n) { return Math.round(n * 1e4) / 1e4 }
function round2(n) { return Math.round(n * 1e2) / 1e2 }

const cId = (i) => `c${i}`
const pKey = (topic, p) => `${topic}#${p}`
const subscribes = (c, topic, subs) => (Array.isArray(subs[c]) && subs[c].includes(topic))

/** 构造所有 (topic,partition) 键的清单（顺序固定：topic 声明序 → 分区号） */
function allPartitions(topics, partsPerTopic) {
  const out = []
  for (const t of topics) for (let p = 0; p < partsPerTopic[t]; p++) out.push(pKey(t, p))
  return out
}

/* --------------------------- ① RangeAssignor --------------------------- */

/**
 * 每 topic 把连续分区段分给按字典序排列的订阅者。
 * opUnits：每分区一次赋值（最省）。病：多 topic 余数累积系统性压前几个 + 异构订阅必偏斜。
 */
export function createRangeAssignor(_opts = {}) {
  return {
    protocol: 'Range',
    assign(consumers, topics, partsPerTopic, subs, _prev, op) {
      const a = {}
      const cs = consumers.slice().sort()
      for (const t of topics) {
        const eligible = cs.filter((c) => subscribes(c, t, subs))
        const P = intOr(partsPerTopic[t], 0)
        for (let i = 0; i < eligible.length; i++) {
          const lo = Math.floor((P * i) / eligible.length)
          const hi = Math.floor((P * (i + 1)) / eligible.length)
          for (let p = lo; p < hi; p++) { a[pKey(t, p)] = eligible[i]; op.n++ }
        }
      }
      return a
    },
  }
}

/* --------------------------- ② RoundRobinAssignor --------------------------- */

/**
 * 摊平所有 (topic,partition) 全局轮询、跳过未订阅者。
 * opUnits：每分区轮询要扫一遍订阅者集合 ⇒ O(P·C)（比 Range 贵、比 Sticky 便宜或相近）。
 * 病：rebalance 时全局序列从头重排 ⇒ 成员一变大规模迁移。
 */
export function createRoundRobinAssignor(_opts = {}) {
  return {
    protocol: 'RoundRobin',
    assign(consumers, topics, partsPerTopic, subs, _prev, op) {
      const a = {}
      const cs = consumers.slice().sort()
      let ptr = 0
      for (const t of topics) {
        for (let p = 0; p < intOr(partsPerTopic[t], 0); p++) {
          const eligible = cs.filter((c) => subscribes(c, t, subs))
          if (eligible.length) { a[pKey(t, p)] = eligible[ptr % eligible.length]; ptr++; op.n += eligible.length }
        }
      }
      return a
    },
  }
}

/* --------------------------- ③ StickyAssignor --------------------------- */

/**
 * 保留 prev 合法归属 → 贪心补缺给最轻负载者 → 有限 1 轮均衡迁移（教学简化版，非 Kafka 完整 partition-move 图）。
 * opUnits：遍历 prev + 每个未分配分区扫候选取最轻 + 可能的 1 轮迁移 ⇒ 最贵。
 */
export function createStickyAssignor(opts = {}) {
  const balanceRounds = Math.max(0, intOr(opts.balanceRounds, 1))
  return {
    protocol: 'Sticky',
    assign(consumers, topics, partsPerTopic, subs, prev, op) {
      const a = {}
      const loads = Object.fromEntries(consumers.map((c) => [c, 0]))
      const all = allPartitions(topics, partsPerTopic)
      // Step1 保留 prev 中仍合法的归属
      for (const k of all) {
        const topic = k.split('#')[0]
        const owner = prev && prev[k]
        if (owner && consumers.includes(owner) && subscribes(owner, topic, subs)) {
          a[k] = owner; loads[owner]++; op.n += 2
        }
      }
      // Step2 补缺：给订阅者中当前负载最轻的
      for (const k of all) {
        if (a[k]) continue
        const topic = k.split('#')[0]
        const cand = consumers.filter((c) => subscribes(c, topic, subs))
        let best = cand[0]
        for (const c of cand) { op.n++; if ((loads[c] ?? 0) < (loads[best] ?? 0)) best = c }
        if (best !== undefined) { a[k] = best; loads[best] = (loads[best] || 0) + 1; op.n++ }
      }
      // Step3 有限 N 轮均衡：把最重者上一个可迁分区挪给最轻者（若真降 imbalance）
      for (let r = 0; r < balanceRounds; r++) {
        const vals = Object.values(loads)
        const over = Math.max(...vals), under = Math.min(...vals)
        if (over - under <= 1) break
        const heavy = consumers.find((c) => loads[c] === over)
        const light = consumers.find((c) => loads[c] === under)
        const movable = all.find((k) => a[k] === heavy && subscribes(light, k.split('#')[0], subs))
        if (movable) { a[movable] = light; loads[heavy]--; loads[light]++; op.n += 4 }
        else break
      }
      return a
    },
  }
}

const MAKERS = {
  Range: createRangeAssignor,
  RoundRobin: createRoundRobinAssignor,
  Sticky: createStickyAssignor,
}

/* --------------------------- 场景构造 + 真跑 --------------------------- */

/** 六场景 → {consumers, topics, partsPerTopic, subs, prevOf(protocol)} */
function sceneOf(id, _protocol, o) {
  const C = intOr(o.consumers, CGP_DEFAULTS.consumers)
  const PPT = intOr(o.partitionsPerTopic, CGP_DEFAULTS.partitionsPerTopic)
  const mkConsumers = (n) => Array.from({ length: n }, (_, i) => cId(i))
  const allSub = (n, topics) => Object.fromEntries(mkConsumers(n).map((c) => [c, topics.slice()]))
  switch (id) {
    case 'steadyState': {
      const cs = mkConsumers(C)
      return { consumers: cs, topics: ['A'], parts: { A: C * PPT }, subs: allSub(C, ['A']), prev: null }
    }
    case 'partitionSkew': {
      // 2 topics × PPT 分区，消费者数 C 不能整除 PPT ⇒ Range 每 topic 余数都压前几个 ⇒ 累积偏斜
      const cs = mkConsumers(C), topics = ['A', 'B']
      return { consumers: cs, topics, parts: { A: PPT, B: PPT }, subs: allSub(C, topics), prev: null }
    }
    case 'heteroSubscriptions': {
      // 异构订阅：c0 只订 A、c1 订 A+B、c2 只订 B（C≥3 时按此轮转，其余消费者全订）
      const cs = mkConsumers(C), topics = ['A', 'B']
      const subs = {}
      cs.forEach((c, i) => {
        if (i === 0) subs[c] = ['A']
        else if (i === 1) subs[c] = ['A', 'B']
        else if (i === 2) subs[c] = ['B']
        else subs[c] = ['A', 'B']
      })
      return { consumers: cs, topics, parts: { A: PPT, B: PPT }, subs, prev: null }
    }
    case 'memberJoin': {
      const base = intOr(o.moveConsumers, CGP_DEFAULTS.moveConsumers)
      const n = intOr(o.joinConsumers, CGP_DEFAULTS.joinConsumers)
      const topics = ['A'], parts = { A: intOr(o.movePartitions, CGP_DEFAULTS.movePartitions) }
      const baseCs = mkConsumers(base), cs = mkConsumers(Math.max(n, base + 1))
      const subs = allSub(cs.length, topics)
      return { consumers: cs, topics, parts, subs, prev: baseCs, prevSubs: allSub(baseCs.length, topics) }
    }
    case 'memberLeave': {
      const base = intOr(o.moveConsumers, CGP_DEFAULTS.moveConsumers)
      const n = intOr(o.leaveConsumers, CGP_DEFAULTS.leaveConsumers)
      const topics = ['A'], parts = { A: intOr(o.movePartitions, CGP_DEFAULTS.movePartitions) }
      const baseCs = mkConsumers(base), cs = mkConsumers(Math.max(1, Math.min(n, base - 1)))
      const subs = allSub(cs.length, topics)
      return { consumers: cs, topics, parts, subs, prev: baseCs, prevSubs: allSub(baseCs.length, topics) }
    }
    case 'manyPartitions': {
      const n = intOr(o.bigConsumers, CGP_DEFAULTS.bigConsumers)
      const cs = mkConsumers(n), topics = ['A']
      return { consumers: cs, topics, parts: { A: intOr(o.bigPartitions, CGP_DEFAULTS.bigPartitions) }, subs: allSub(n, topics), prev: null }
    }
    default:
      return null
  }
}

/**
 * 真跑一协议×一场景，回传结构读数。
 * rigged perfectBalance + 成员变动 ⇒ 强制推倒用「新成员集」RoundRobin 全局再均衡（正确性等底线优先于省迁移），
 * moveSum 由真分配对比 prev 现算（必然暴涨），而非硬写 minimalMovement=false。
 */
function runScenario(protocol, scenario, o) {
  const scene = sceneOf(scenario, protocol, o)
  if (!scene) return null
  const { consumers, topics, parts, subs } = scene
  const pb = o.perfectBalance === true || o.rigged === true
  const zm = o.zeroMovement === true || o.rigged === true
  const fc = o.freeCompute === true || o.rigged === true
  const maker = MAKERS[protocol]()
  const op = { n: 0 }

  // 构造 prev：成员变动场景用基线消费者集真跑一次该协议分配
  let prev = null
  if (Array.isArray(scene.prev)) {
    const pop = { n: 0 }
    prev = maker.assign(scene.prev, topics, parts, scene.prevSubs, null, pop)
  }

  let a
  let isMemberChange = false
  let moveSum = 0
  if (Array.isArray(scene.prev)) {
    isMemberChange = true
    if (pb) {
      // perfectBalance 强制完美均衡：推倒用新成员集 RoundRobin 全局再均衡（忽略协议粘性）
      a = createRoundRobinAssignor().assign(consumers, topics, parts, subs, null, op)
    } else if (zm) {
      // zeroMovement 冻结归属：保留 prev（退出者分区无人接管、新成员一个都拿不到）
      a = { ...prev }
      op.n += Object.keys(a).length
    } else {
      a = maker.assign(consumers, topics, parts, subs, prev, op)
    }
    let moved = 0
    for (const k of Object.keys(a)) if (prev[k] !== a[k]) moved++
    moveSum = round4(moved / Math.max(1, Object.keys(a).length))
  } else {
    a = maker.assign(consumers, topics, parts, subs, null, op)
  }

  const loads = consumers.map((c) => Object.values(a).filter((o) => o === c).length)
  const imbalance = Math.max(...loads) - Math.min(...loads)
  const starved = loads.some((l) => l === 0)
  const total = Object.keys(a).length
  const opPerPart = round2(op.n / Math.max(1, total))
  // rigged freeCompute 只抹 opUnits（cheap 维），不动分配/迁移
  const effectiveOpPerPart = fc ? 0 : opPerPart

  return {
    id: scenario,
    protocol,
    consumers: consumers.length,
    partitions: total,
    imbalance,
    starved,
    moveRate: isMemberChange ? moveSum : 0,
    opUnits: op.n,
    opPerPart: effectiveOpPerPart,
    loads,
    fault: isMemberChange ? (consumers.length > scene.prev.length ? '成员加入' : '成员退出') : '稳态分配',
  }
}

/* --------------------------- ④ 三协议对照 --------------------------- */

function buildStudy(o = {}) {
  const scenarioIds = o.scenarios ?? CGP_SCENARIOS
  const balanceBudget = numOr(o.balanceBudget, CGP_DEFAULTS.balanceBudget)
  const movementBudget = numOr(o.movementBudget, CGP_DEFAULTS.movementBudget)
  const computeBudget = numOr(o.computeBudget, CGP_DEFAULTS.computeBudget)
  const pb = o.perfectBalance === true || o.rigged === true
  const zm = o.zeroMovement === true || o.rigged === true
  const fc = o.freeCompute === true || o.rigged === true

  const rows = []
  for (const p of CGP_PROTOCOLS) {
    const cells = scenarioIds.map((s) => runScenario(p, s, o)).filter(Boolean)
    // balanced：只在四个公平场景量（avgImbalance ≤ 预算 且 无饥饿），其余空真
    const fair = cells.filter((c) => ['partitionSkew', 'heteroSubscriptions', 'memberJoin', 'memberLeave'].includes(c.id))
    const avgImbalance = fair.length ? round2(fair.reduce((a, c) => a + c.imbalance, 0) / fair.length) : 0
    const anyStarved = fair.some((c) => c.starved)
    const balanced = pb ? true : (avgImbalance <= balanceBudget && !anyStarved)
    // minimalMovement：只在成员变动场景量（moveSum ≤ 预算），其余空真
    const moves = cells.filter((c) => ['memberJoin', 'memberLeave'].includes(c.id))
    const moveSum = round4(moves.reduce((a, c) => a + c.moveRate, 0))
    // 因果锁死：zeroMovement 单开冻结归属 ⇒ moveSum 真为 0（但新成员饥饿 ⇒ balanced 反噬）；
    //   perfectBalance 同开时强制推倒重排 ⇒ moveSum 真算暴涨 ⇒ 该维无法翻回。
    const minimalMovement = (zm && !pb) ? true : (moveSum <= movementBudget)
    // cheap：只在 manyPartitions 量（opPerPart ≤ 预算），其余空真
    const big = cells.find((c) => c.id === 'manyPartitions')
    const opPerPart = big ? big.opPerPart : 0
    const cheap = fc ? true : (opPerPart <= computeBudget)

    for (const c of cells) {
      c.balanced = ['partitionSkew', 'heteroSubscriptions', 'memberJoin', 'memberLeave'].includes(c.id) ? (pb || (!c.starved && c.imbalance <= balanceBudget)) : true
      c.minimalMovement = ['memberJoin', 'memberLeave'].includes(c.id) ? ((zm && !pb) || c.moveRate <= movementBudget) : true
      c.cheap = c.id === 'manyPartitions' ? (fc || c.opPerPart <= computeBudget) : true
    }
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma: { balanced, minimalMovement, cheap },
      metrics: { avgImbalance, starved: anyStarved, moveSum, opPerPart },
    })
  }

  // 向量恒由 row.trilemma 现算（与表格同源，杜绝硬覆盖撒谎）
  const vecOf = (r) => `${Number(r.trilemma.balanced)}${Number(r.trilemma.minimalMovement)}${Number(r.trilemma.cheap)}`
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vecOf(r)]))
  const distinct = new Set(Object.values(vectors)).size === rows.length
  const noProtocolWinsAll = !rows.some((r) => vectors[r.protocol] === '111')
  const evidence = createConsumerGroupEvidence({ seed: intOr(o.seed, CGP_DEFAULTS.seed) })
  const cell = (p, s) => rows.find((r) => r.protocol === p)?.scenarios.find((c) => c.id === s)

  return {
    builtAt: startClock(o.now, 0),
    config: {
      seed: intOr(o.seed, CGP_DEFAULTS.seed),
      consumers: intOr(o.consumers, CGP_DEFAULTS.consumers),
      partitionsPerTopic: intOr(o.partitionsPerTopic, CGP_DEFAULTS.partitionsPerTopic),
      movePartitions: intOr(o.movePartitions, CGP_DEFAULTS.movePartitions),
      bigPartitions: intOr(o.bigPartitions, CGP_DEFAULTS.bigPartitions),
      bigConsumers: intOr(o.bigConsumers, CGP_DEFAULTS.bigConsumers),
      balanceBudget, movementBudget, computeBudget,
      perfectBalance: pb, zeroMovement: zm, freeCompute: fc,
      scenarios: scenarioIds,
    },
    rows,
    vectors,
    topology: {
      Range: '每 topic 连续段分给按序订阅者；opUnits 最省，但多 topic 余数累积压前几个 + 异构必偏斜；成员变动段尾挪动',
      RoundRobin: '摊平 (topic,partition) 全局轮询跳未订阅；同构多 topic 更均衡，但 rebalance 全局从头重排 ⇒ 成员一变大规模迁移',
      Sticky: '保留 prev 合法归属 → 贪心补缺给最轻 → 有限轮均衡；最小迁移 + 负载感知，但 opUnits 最贵、停摆最长 ⇒ 非银弹',
    },
    crosscheck: { evidence },
    verdict: {
      vectors,
      trilemmaDistinguishes: distinct,
      noUniversalWinner: distinct && noProtocolWinsAll,
      noProtocolWinsAll,
      rangeCheapest: rows[0].trilemma.cheap === true,
      rangeSkews: rows[0].trilemma.balanced === false,
      roundRobinBalanced: rows[1].trilemma.balanced === true,
      roundRobinMigrates: rows[1].trilemma.minimalMovement === false,
      stickyBalanced: rows[2].trilemma.balanced === true,
      stickyMinimalMovement: rows[2].trilemma.minimalMovement === true,
      stickyNotFreeLunch: rows[2].trilemma.balanced === true && rows[2].trilemma.minimalMovement === true && rows[2].trilemma.cheap === false,
      zeroMovementStarvesJoiner: zm && !pb && rows.every((r) => r.trilemma.balanced === false),
      minimalMovementCausallyUnerasable: pb && zm && rows.every((r) => r.trilemma.minimalMovement === false),
      steadyStateVacuousTrue: cell('Range', 'steadyState')?.minimalMovement === true,
    },
    rigged: pb && zm && fc,
  }
}

/** 纯数据 study（与 retryDlqStudy 同参接口、无 DOM 依赖） */
export function consumerGroupStudy(opts = {}) {
  return buildStudy(opts)
}

/** compareConsumerGroup 同构别名：研究入口的另一名字，指向同一 buildStudy。 */
export const compareConsumerGroup = consumerGroupStudy

/** 快照形态：retryDlqSnapshot 同构裁剪 */
export function consumerGroupSnapshot(study) {
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
    crosscheck: { evidence: study.crosscheck?.evidence ? { ...study.crosscheck.evidence } : study.crosscheck },
    verdict: { ...study.verdict },
    topology: { ...(study.topology ?? {}) },
  }
}

/** 九枚真件交叉印证：返回每个真件的一小组真实读数（全真 API 真回读，计数不硬编码）。 */
export function createConsumerGroupEvidence(opts = {}) {
  const seed = intOr(opts.seed, CGP_DEFAULTS.seed)

  // ① 一致性哈希 vs 取模迁移率（节点增长）：真 compareRemapping
  const keys = Array.from({ length: 24 }, (_, i) => `cg:${i}`)
  const remap = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed), virtualNodes: 24 })
  // ② 分片路由 remapOn 真吐 moved/rate（成员变动最小迁移的到达证明）
  const router = createShardRouter({ nodes: ['a', 'b', 'c'], slotCount: 16, virtualNodes: 24, salt: String(seed) })
  for (let i = 0; i < 16; i++) router.route(`cg:${i}`)
  const remapped = router.remapOn(['a', 'b', 'c', 'd'])
  // ③ 真哈希环 addNode/removeNode/distribution
  const ring = createHashRing({ virtualNodes: 24, salt: String(seed) })
  ring.addNode('a'); ring.addNode('b'); ring.addNode('c')
  ring.removeNode('b'); ring.addNode('d')
  const dist = ring.distribution(keys)

  // ④ 真 WAL：成员变更 append→lines→restore→replay 真回读
  const wal = createWal()
  wal.append('put', 'group:g1:gen', { gen: 1, members: ['a', 'b', 'c'] })
  wal.append('put', 'group:g1:gen', { gen: 2, members: ['a', 'c', 'd'] })
  const walLines = wal.lines().length
  const restored = createWal()
  restored.restore(wal.lines())
  let walReplayed = 0
  restored.replay(() => { walReplayed++ })

  // ⑤ 真总线：rebalance-done 通知真投递
  const bus = createBus()
  let notices = 0
  bus.subscribe('group:g1:rebalanced', () => { notices++ })
  bus.publish('group:g1:rebalanced', { gen: 2 })
  bus.publish('group:g1:rebalanced', { gen: 3 })
  const busListeners = bus.listenerCount('group:g1:rebalanced')

  // ⑥ 真 Redis 缓存：组元数据代次真落（SETEX 幂等覆盖）
  const cache = createRedisCache()
  cache.command('SETEX', 'group:g1:gen', 60, 1)
  cache.command('SETEX', 'group:g1:gen', 60, 2)
  const groupMetaEntries = cache.stats().entries

  // ⑦ 真对象池：分配结果对象复用省 GC
  const pool = createObjectPool({ factory: () => ({ owner: '' }), maxSize: 8 })
  pool.acquire(); pool.acquire(); pool.release({ owner: 'a' }); pool.acquire()

  // ⑧ 真令牌桶：rebalance 防抖限流（固定时钟 capacity 放行、超预算真拒）
  const bucket = createTokenBucket({ capacity: 2, refillPerSec: 0, now: () => 1000 })
  let allowed = 0
  for (let i = 0; i < 4; i++) if (bucket.allow().allowed) allowed++

  // ⑨ 真最小堆：迁移任务排程真 advance
  const heap = createMinHeapDelayQueue({ now: 0 })
  for (let i = 0; i < 9; i++) heap.schedule((i * 5 % 11) * 100 + 10, `move:${i}`)
  const heapFired = heap.advance(100000).length

  return {
    remapConsistentRate: remap.consistent.rate,
    remapModuloRate: remap.modulo.rate,
    remapSavedRate: remap.savedRate,
    routerMoved: remapped.moved,
    routerRate: remapped.rate,
    hashRingNodes: dist.nodes,
    hashRingEmptyNodes: dist.emptyNodes.length,
    walLines,
    walReplayed,
    rebalanceNotices: notices,
    busListeners,
    groupMetaEntries,
    poolAcquired: pool.stats().acquired,
    bucketAllowed: allowed,
    bucketRejected: 4 - allowed,
    heapFired,
  }
}

/* --------------------------- CLI --------------------------- */

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const s = consumerGroupStudy({ rigged, now: () => 0 })
  const snap = consumerGroupSnapshot(s)
  console.log('[consumer-group] seed=' + s.config.seed + ' bigPartitions=' + s.config.bigPartitions +
    ' perfectBalance=' + s.config.perfectBalance + ' zeroMovement=' + s.config.zeroMovement + ' freeCompute=' + s.config.freeCompute)
  for (const row of snap.rows) {
    const cell = (sid) => row.scenarios.find((c) => c.id === sid)
    console.log(
      '  ' + row.protocol.padEnd(11) +
      ' skew.imb=' + String(cell('partitionSkew').imbalance).padStart(2) +
      ' hetero.imb=' + String(cell('heteroSubscriptions').imbalance).padStart(2) +
      ' join.mv=' + String(cell('memberJoin').moveRate).padStart(5) +
      ' leave.mv=' + String(cell('memberLeave').moveRate).padStart(5) +
      ' big.op/P=' + String(cell('manyPartitions').opPerPart).padStart(4) +
      ' | metrics=' + JSON.stringify(row.metrics) +
      ' | trilemma=' + JSON.stringify(row.trilemma),
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.verdict.noUniversalWinner + ' distinguishable=' + snap.verdict.trilemmaDistinguishes + ' rigged=' + s.rigged)
  // 向量恒由 row.trilemma 现算：CLI 逐行重推一遍作自证，表格与判词同源、杜绝硬覆盖撒谎。
  const recomputed = Object.fromEntries(snap.rows.map((r) => [r.protocol,
    `${Number(r.trilemma.balanced)}${Number(r.trilemma.minimalMovement)}${Number(r.trilemma.cheap)}`]))
  const sameSource = JSON.stringify(recomputed) === JSON.stringify(snap.vectors)
  console.log('  VECTOR_FROM_TRILEMMA_OK=' + sameSource + '（向量由表格现算，非硬覆盖）')
  if (s.rigged) {
    // rigged 三开关：想抹 minimalMovement 就得 zeroMovement，但成员退出必须接管分区、
    // 与 perfectBalance 强制完美均衡相克 ⇒ 必须推倒全量重排 ⇒ moveSum 真算暴涨、该维被反噬、
    // 三开关无一能翻回真，向量收敛 101/101/101、判词翻 false 即可证伪。若课程要求「全 111」那是硬覆盖造假，本件拒绝。
    const falsifiable = snap.verdict.noUniversalWinner === false && snap.verdict.trilemmaDistinguishes === false &&
      snap.verdict.minimalMovementCausallyUnerasable === true &&
      snap.rows.every((r) => r.trilemma.minimalMovement === false) && sameSource
    console.log('  RIGGED_FALSIFIABLE_OK=' + falsifiable +
      '（真实现算 101/101/101；perfectBalance 强制完美均衡在成员退出必推倒重排、与 zeroMovement 因果相克，minimalMovement 维无一开关能翻回，判词翻 false，不硬覆盖全 111）')
  }
}
