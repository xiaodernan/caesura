/**
 * scripts/caesura-backpressure.mjs —— 消费者组积压背压 / 流量削峰四策略诚实权衡教学状态机（KI-525，P8 第三十二维）。
 *
 * <p>精准补 KI-513 / KI-518 / KI-520 / KI-523 消息队列族最后一环：前四件分别答「保证投递几次」
 * 「一条消息何时唤醒」「失败以什么节奏重试、何时进死信」「多条消费者如何分摊分区、成员变动如何最小迁移」，
 * 却都没建模<b>当生产速率 λ 超过消费速率 μ、积压（backlog）开始增长时，系统该用什么手段自保</b>这一
 * 每个真实消息系统迟早撞上的命题。λ≫μ 若不处理，要么内存爆、要么时延无界、要么下游被压垮——
 * 生产里的答案从来不是唯一的，也没有一个策略能同时拿到三样好东西。</p>
 *
 * <ol>
 *   <li>{@link createBackpressureAdmission} <b>Backpressure 背压准入</b>：令牌桶把入队速率钳到 ≈μ，
 *       超出的消息<b>反压退回上游</b>（{@code rejected}，不是丢弃）。队列近空 ⇒ 排队时延低、零主动丢弃；
 *       但突发时上游接纳率被压到 μ/λ ⇒ <b>吞吐受损（拖慢生产端）</b>。</li>
 *   <li>{@link createBufferingQueue} <b>Buffering 缓冲削峰填谷</b>：全量接纳排大队列，按 μ 匀速排空。
 *       上游零反压、零丢弃 ⇒ 吞吐与零丢失两维都占；但积压让 {@code avgWait} 随队长线性涨 ⇒
 *       <b>低时延不保</b>；且内存有界时缓冲打满会真丢弃（memoryPressure 场景诚实补刀，非银弹）。</li>
 *   <li>{@link createSheddingValve} <b>Shedding 过载丢弃</b>：队列钳在小阈值，超出的消息<b>主动丢弃</b>
 *       （{@code dropped}，但上游仍全速接纳、不反压）。排队时延低、吞吐不损；<b>但丢消息 ⇒ 零丢失不保</b>。</li>
 *   <li>{@link createScalingPool} <b>Scaling 弹性扩容</b>：检测到持续过载即「加消费者」把 μ 提上去（稳态治本），
 *       但扩容必须触发消费者组 <b>rebalance 空窗</b>（承接 KI-523）：停服 {@code stallTicks} 拍且拒绝接纳，
 *       空窗期间消息滞留 ⇒ 时延尖峰、吞吐反降；只占零丢失一维。<b>不是免费午餐。</b></li>
 * </ol>
 *
 * <p><b>三难（维序固定）</b>：<b>零丢失 ∧ 低时延 ∧ 高吞吐</b>（向量 {@code [noLoss/lowLatency/highThroughput]}）。
 * 三个口径<b>严格正交、绝不混算</b>，这是全件的智力内核：</p>
 * <ul>
 *   <li>{@code noLoss}（有没有主动丢弃）：仅看 {@code dropped == 0}。<b>反压退回不算丢</b>（消息退回上游仍可重试）。</li>
 *   <li>{@code lowLatency}（排队时延是否有界）：仅看逐消息 {@code avgWait = Σ(dequeueStep-enqueueStep)/served} ≤ 预算。</li>
 *   <li>{@code highThroughput}（上游是否被拖慢）：仅看 {@code acceptedRate = (arrivals-rejected)/arrivals} ≥ 阈值。
 *       <b>主动丢弃不拖慢上游</b>（系统照样全速吃下消息，只是内部丢），故 Shedding 吞吐不损——丢弃伤的是零丢失那一维。</li>
 * </ul>
 *
 * <p><b>默认向量（四向量互异、无一 111 ⇒ noUniversalWinner）</b>：
 * {@code Backpressure=110 / Buffering=101 / Shedding=011 / Scaling=100}。各有胜场、各有软肋。</p>
 *
 * <p><b>判定正交化</b>（六场景分派三维考场，其余场景该维空真、不连坐，同 KI-518/520/523）：
 * {@code noLoss} 只在 {@code sustainedOverload}+{@code downstreamStall} 量（持续过载/下游停摆才逼出丢弃决策）；
 * {@code lowLatency} 只在 {@code latencySpike}+{@code steadyTrickle} 量（尖峰考积压、稳态作基线）；
 * {@code highThroughput} 只在 {@code burstAbsorb}+{@code memoryPressure} 量（突发/内存压顶才逼出反压）。
 * {@code memoryPressure} 下 Buffering 缓冲打满<b>真丢弃</b>——但不污染它的 noLoss 向量（该场景归高吞吐维），
 * 而是单列诚实判词 {@code bufferingDropsUnderMemoryPressure}，如实标注「缓冲不是银弹」。</p>
 *
 * <p><b>判词可证伪且因果锁死（Little's Law L=λW）</b>：rigged 三开关 {@code zeroLoss}（不许丢）+
 * {@code boundedLatency}（W 有界 ⇒ 队列长度钳在 {@code latencyBudget·μ} 内）+ {@code unlimitedBuffer}（缓冲无限）
 * 齐开 ⇒ 由 L=λW，W 有界强制 L 有界；而 μ<λ 消化不过来，又不许丢，<b>唯一出路是把超出队列的消息反压退回上游</b>
 * ⇒ {@code acceptedRate} 被钳到 μ/λ ⇒ <b>highThroughput 真算翻 false、三开关无一能翻回该维</b>
 * （{@code unlimitedBuffer} 想靠无限缓冲全收，可缓冲吸收必产生 W，被 {@code boundedLatency} 当场压制、救不了吞吐）
 * ⇒ 四向量真实现算收敛为 <b>110/110/110/110</b>、判词翻 false、{@code highThroughputCausallyUnerasable=true}，
 * <b>绝不硬覆盖成全 111 造假</b>。单开亦有反噬：单开 {@code zeroLoss} 补 Shedding 的零丢失必令其积压、反噬低时延；
 * 单开 {@code boundedLatency} 补低时延必逼出丢弃、反噬零丢失；单开 {@code unlimitedBuffer} 只抹 memoryPressure
 * 下 Buffering 的溢出丢弃这一条诚实判词、不动任何向量（呼应 KI-511/512/513/518/520/523「单开一关只抹一局部」）。</p>
 *
 * <p><b>最硬自证判词 {@code littleLawHolds}</b>：对每个 cell 用<b>两条独立累计路径</b>撞同一个数——
 * 路径 A 逐拍积分队长 {@code L = ΣqueueLen(t)/steps}；路径 B 逐消息真排队 {@code W = Σ(dequeueStep-enqueueStep)/served}
 * 与逐消息接纳计数 {@code λ=accepted/steps}，再由 Little's Law 预测 {@code L_pred=λ·W}。
 * 稳态轻载场景（{@code steadyTrickle}，全部服务完、无积压）里 {@code L≈L_pred} 必成立；任何一处硬编码 wait
 * 或队长积分算错，两条路径当场分叉、判词红。持续过载场景（{@code sustainedOverload}，队列无界增长）
 * 稳态前提破裂、{@code L≫λ·W} 如实成立，单列 {@code overloadBreaksLittleLaw} 诚实边界——<b>不假装 Little's Law
 * 在过载系统里也成立</b>。</p>
 *
 * <p><b>十一枚同仓真件交叉印证</b>（{@link createBackpressureEvidence}）：真 {@code createTokenBucket} 准入 allow /
 * 真 {@code createLeakyBucket} 漏桶整形 state / 真 {@code createRedisZsetDelayQueue} durable 缓冲 setNow→schedule→poll /
 * 真 {@code createMinHeapDelayQueue} 精确排程 advance / 真 {@code createWal} 积压 append→restore→replay /
 * 真 {@code createShardedCache} 分片缓冲 set→get / 真 {@code createBloomFilter} 重复消费判重 add→mightHave /
 * 真 {@code createFullJitterBackoff} shedding 后退避 nextDelay / 真 {@code createPackedCounters} 队列深度紧凑计数 inc→get /
 * 真 {@code createObjectPool} 消息对象复用省 GC / 真 {@code createBus} 水位告警通知。全真 API 真调用真回读，计数绝不硬编码。</p>
 *
 * <p>本件零运行时依赖、纯进程内确定性教学状态机；不接真 Kafka broker / 真消费者组协调者 / 真弹性伸缩控制器 /
 * 真压测吞吐跑分（全为结构计数与离散 step 模拟）；四策略是教学简化模型（Scaling 只借 KI-523 的 rebalance
 * 空窗效果、不建完整 HPA 反馈环），如实标注。</p>
 *
 * @module caesura-backpressure
 */

import { pathToFileURL } from 'node:url'
import { createTokenBucket, createLeakyBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue, createRedisZsetDelayQueue } from './caesura-delay-queue.mjs'
import { createWal, createBloomFilter } from './caesura-lsm-store.mjs'
import { createShardedCache } from './caesura-sharded-cache.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createBus } from './spring-bus-event.mjs'

/** 默认注入全参数（全部可覆盖） */
export const BP_DEFAULTS = Object.freeze({
  seed: 525,
  steps: 48,
  mu: 2,                 // 每拍基础服务能力
  acceptBudget: 0.9,     // highThroughput：上游接纳率阈值
  latencyBudget: 3,      // lowLatency：平均排队时延预算（拍）
  bufferCap: 100000,     // Buffering 默认缓冲容量（视为内存充足；memoryPressure 场景覆盖为小值）
  memoryCap: 8,          // memoryPressure 场景的缓冲容量
  shedThreshold: 3,      // Shedding 队列维持的小阈值
  detectTicks: 2,        // Scaling：连续多少拍过载才触发扩容
  stallTicks: 8,         // Scaling：rebalance 空窗拍数（停服 + 拒绝接纳）
  scaleFactor: 2,        // Scaling：扩容后的服务倍率
  zeroLoss: false,
  boundedLatency: false,
  unlimitedBuffer: false,
  rigged: false,
})

/** 四策略（顺序固定，与三难维序无关） */
export const BP_STRATEGIES = Object.freeze(['Backpressure', 'Buffering', 'Shedding', 'Scaling'])

/** 六正交负载场景（顺序固定） */
export const BP_SCENARIOS = Object.freeze([
  'steadyTrickle', 'burstAbsorb', 'sustainedOverload', 'latencySpike', 'downstreamStall', 'memoryPressure',
])

/** 三维考场：每个维度只在指定场景量测，其余场景该维空真（对齐账本正交登记） */
const DIM_SCENARIOS = Object.freeze({
  noLoss: ['sustainedOverload', 'downstreamStall'],
  // lowLatency 考场含 downstreamStall：下游停摆 + Scaling rebalance 空窗滞留（avgWait 飙升）才是它真正付时延代价处；
  // 与 noLoss 共用 downstreamStall 是本项目既有正交口径（同 KI-523 memberJoin/Leave 同时被两维量测，cell 各自空真不连坐）。
  lowLatency: ['latencySpike', 'downstreamStall'],
  highThroughput: ['burstAbsorb', 'memoryPressure'],
})

/* --------------------------- 判定工具 --------------------------- */

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}
function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
/** 注入时钟：数字或函数（builtAt 契约要求对函数求值，同 KI-518/520/523 startClock） */
function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}
function round4(n) { return Math.round(n * 1e4) / 1e4 }
function round2(n) { return Math.round(n * 1e2) / 1e2 }
/** 确定性 LCG（可注入 seed；用于场景微扰，杜绝 Math.random 破坏双跑字节一致） */
function lcg(seed) {
  let s = (intOr(seed, 1) >>> 0) || 1
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

/**
 * Little's Law 双路自证（导出纯函数，可独立证伪）：给定四条真累计量，用两条独立路径撞 L=λW。
 * - 路径 A：逐拍积分队长 L = queueLenSum / steps。
 * - 路径 B：逐消息排队 W = waitSum / served；稳态吞吐 λ = served / steps；预测 Lpred = λ·W。
 * 稳态前提：队列最终排空（endQueue=0）。任一路硬编码/漏计 ⇒ L 与 Lpred 分叉 ⇒ holds 翻 false。
 * @param {{queueLenSum:number, waitSum:number, served:number, endQueue:number, steps:number}} a
 */
export function verifyLittleLaw(a) {
  const steps = Math.max(1, intOr(a?.steps, BP_DEFAULTS.steps))
  const queueLenSum = numOr(a?.queueLenSum, 0)
  const waitSum = numOr(a?.waitSum, 0)
  const served = intOr(a?.served, 0)
  const endQueue = intOr(a?.endQueue, 0)
  const L = round4(queueLenSum / steps)
  const W = served > 0 ? round4(waitSum / served) : 0
  const lambda = round4(served / steps)
  const Lpred = round4(lambda * W)
  const gap = round4(Math.abs(L - Lpred))
  const tol = Math.max(0.5, 0.12 * Math.max(L, Lpred))
  const steadyStateReached = endQueue === 0
  const holds = steadyStateReached && gap <= tol
  return { L, W, lambda, Lpred, gap, steadyStateReached, holds }
}

/**
 * 场景负载：返回 {lambda, mu, cap} 逐拍值或常量。
 * 全部确定性；o.jitter 为真时用注入 seed 的 LCG 对突发拍到达量做 ±1 微扰（仍双跑一致）。
 */
function sceneLoadOf(id, o, cfg) {
  const S = cfg.steps
  const mu = cfg.mu
  const rnd = lcg(cfg.seed)
  const jitter = o.jitter === true
  const j = (base) => Math.max(0, base + (jitter ? Math.floor(rnd() * 3) - 1 : 0))
  switch (id) {
    case 'steadyTrickle':
      // 周期批量到达（每 4 拍 +10/+1/+1/+1，平均 λ=3.25 < μ=4）⇒ 有真实、能排空的稳态排队：
      // Buffering/Scaling 的 L 与 λW 都是非零、量级可教学，由逐拍积分队长 vs 逐消息排队两条独立路径真撞合，
      // 而非 0=0 的平凡自证；Backpressure/Shedding 队列恒空（准入钳 μ / 小阈值丢弃）本就是物理特征。
      // 本场景不参与任何三难维度判定，仅作 Little's Law 稳态自证的承重场景。
      return { lambdaAt: (t) => (t % 4 === 0 ? 10 : 1), muAt: () => Math.max(mu, 4), cap: cfg.bufferCap }
    case 'burstAbsorb':
      return { lambdaAt: (t) => t < Math.floor(S / 3) ? j(8) : 1, muAt: () => mu, cap: cfg.bufferCap }
    case 'sustainedOverload':
      return { lambdaAt: () => 6, muAt: () => mu, cap: cfg.bufferCap }
    case 'latencySpike':
      return { lambdaAt: (t) => (t >= Math.floor(S / 2) - 1 && t < Math.floor(S / 2) + 2) ? j(30) : 1, muAt: () => mu, cap: cfg.bufferCap }
    case 'downstreamStall':
      return { lambdaAt: () => 2, muAt: (t) => (t >= Math.floor(S / 3) && t < Math.floor(2 * S / 3)) ? 0 : mu, cap: cfg.bufferCap }
    case 'memoryPressure':
      return { lambdaAt: () => 6, muAt: () => mu, cap: cfg.memoryCap }
    default:
      return null
  }
}

/* --------------------------- ① Backpressure 背压准入 --------------------------- */

/**
 * 令牌桶式准入：入队速率钳到 ≈μ，超出部分反压退回上游（rejected，非丢弃）。
 * 队列近空 ⇒ 时延低、零丢弃；突发时上游接纳率被压到 μ/λ ⇒ 吞吐受损。
 */
export function createBackpressureAdmission(opts = {}) {
  const refill = numOr(opts.refill, 1)
  return {
    id: 'Backpressure',
    decide(ctx) {
      const { arrivals, mu, acc } = ctx
      acc.bpTokens = Math.min(Math.max(1, mu) * refill, (acc.bpTokens ?? Math.max(1, mu)) + mu * refill)
      const admitted = Math.min(arrivals, Math.floor(acc.bpTokens + 1e-9))
      acc.bpTokens = Math.max(0, acc.bpTokens - admitted)
      return { admitted, rejected: arrivals - admitted, dropped: 0, muOverride: null }
    },
  }
}

/* --------------------------- ② Buffering 缓冲 --------------------------- */

/** 全量接纳排大队列、按 μ 匀速排空；容量满（memoryPressure）才真丢弃。 */
export function createBufferingQueue(opts = {}) {
  return {
    id: 'Buffering',
    decide(ctx) {
      const { arrivals, queue, cap, flags } = ctx
      const effectiveCap = flags.unlimitedBuffer ? Infinity : cap
      const room = Math.max(0, effectiveCap - queue.length)
      const admitted = Math.min(arrivals, room)
      return { admitted, rejected: 0, dropped: arrivals - admitted, muOverride: null }
    },
  }
}

/* --------------------------- ③ Shedding 过载丢弃 --------------------------- */

/** 队列钳在小阈值、超出主动丢弃；上游不反压（accepted 全收），但零丢失不保。 */
export function createSheddingValve(opts = {}) {
  const threshold = Math.max(1, intOr(opts.threshold, BP_DEFAULTS.shedThreshold))
  return {
    id: 'Shedding',
    decide(ctx) {
      const { arrivals, queue, flags } = ctx
      if (flags.zeroLoss) return { admitted: arrivals, rejected: 0, dropped: 0, muOverride: null }
      const room = Math.max(0, threshold - queue.length)
      const admitted = Math.min(arrivals, room)
      return { admitted, rejected: 0, dropped: arrivals - admitted, muOverride: null }
    },
  }
}

/* --------------------------- ④ Scaling 弹性扩容 --------------------------- */

/**
 * 持续过载 → 触发扩容，但先付 rebalance 空窗（停服 + 拒绝接纳，承接 KI-523），空窗后 μ 提升。
 * 稳态治本、零丢弃；突发瞬时因空窗而时延尖峰、吞吐反降。
 */
export function createScalingPool(opts = {}) {
  const detectTicks = Math.max(1, intOr(opts.detectTicks, BP_DEFAULTS.detectTicks))
  const stallTicks = Math.max(1, intOr(opts.stallTicks, BP_DEFAULTS.stallTicks))
  const scaleFactor = Math.max(1, numOr(opts.scaleFactor, BP_DEFAULTS.scaleFactor))
  return {
    id: 'Scaling',
    decide(ctx) {
      const { arrivals, mu, t } = ctx
      const st = ctx.acc.scaling ??= { over: 0, phase: 'steady', stallLeft: 0, rebalances: 0, scale: 1 }
      if (st.phase === 'steady') {
        if (arrivals > mu) st.over++
        else st.over = 0
        if (st.over >= detectTicks) {
          st.phase = 'stall'; st.stallLeft = stallTicks; st.rebalances++; st.over = 0
        }
      }
      if (st.phase === 'stall') {
        st.stallLeft--
        // 空窗：停服（muOverride=0）+ 拒绝接纳（rejected 全部），滞留由队列如实承担
        if (st.stallLeft <= 0) { st.phase = 'scaled'; st.scale = scaleFactor }
        return { admitted: 0, rejected: arrivals, dropped: 0, muOverride: 0 }
      }
      // steady 或 scaled：正常接纳、不丢；scaled 阶段 μ 已提升
      return { admitted: arrivals, rejected: 0, dropped: 0, muOverride: null, scale: st.scale }
    },
  }
}

const MAKERS = {
  Backpressure: createBackpressureAdmission,
  Buffering: createBufferingQueue,
  Shedding: createSheddingValve,
  Scaling: createScalingPool,
}

/* --------------------------- 场景真跑 --------------------------- */

/**
 * 真跑一策略 × 一场景。逐 step：到达入队 → 延迟上限钳制 → 服务出队 → 拍末积分队长。
 * 三条计数路径（逐拍队长 / 逐消息等待 / 逐消息接纳）完全独立累计，供 Little's Law 双路自证。
 */
function simulate(strategy, scenario, cfg, flags, strategyOpts) {
  const load = sceneLoadOf(scenario, strategyOpts ?? {}, cfg)
  if (!load) return null
  const maker = MAKERS[strategy]
  if (!maker) return null
  const strat = maker(strategyOpts ?? {})
  const queue = [] // {enqueue}
  const acc = {}
  let arrivalAccrual = 0
  let serviceAccrual = 0
  let arrivalsTotal = 0, rejectedTotal = 0, droppedTotal = 0, admittedTotal = 0, servedTotal = 0
  let waitSum = 0, queueLenSum = 0, peakQueue = 0, lateArrivals = 0

  for (let t = 0; t < cfg.steps; t++) {
    const mu = load.muAt(t)
    // 到达（确定性小数累积，产生非平凡但可复现的队长）
    arrivalAccrual += load.lambdaAt(t)
    let arrivals = 0
    while (arrivalAccrual >= 1) { arrivals++; arrivalAccrual -= 1 }
    arrivalsTotal += arrivals

    const d = strat.decide({ t, arrivals, mu, queue, cap: load.cap, acc, flags, strategy: strategy })
    let { admitted, rejected, dropped } = d
    admitted = intOr(admitted, 0); rejected = intOr(rejected, 0); dropped = intOr(dropped, 0)

    // zeroLoss 全局强制：把本要丢弃的改为入队（不丢，代价是积压 → 反噬低时延）
    if (flags.zeroLoss && dropped > 0) { admitted += dropped; dropped = 0 }
    // 不变量：arrivals == admitted + rejected + dropped
    const excess = arrivals - (admitted + rejected + dropped)
    if (excess > 0) { admitted += excess } else if (excess < 0) { rejected += -excess }

    for (let i = 0; i < admitted; i++) queue.push({ enqueue: t })
    admittedTotal += admitted; rejectedTotal += rejected; droppedTotal += dropped

    // boundedLatency 全局强制：队列长度钳到 latencyBudget·μ；超出部分若不许丢则反压退回、否则丢弃
    let capRejected = 0, capDropped = 0
    if (flags.boundedLatency) {
      const maxQ = Math.max(1, Math.ceil(cfg.latencyBudget * Math.max(1, mu)))
      while (queue.length > maxQ) {
        queue.pop()
        if (flags.zeroLoss) { capRejected++ } else { capDropped++ }
      }
      rejectedTotal += capRejected; droppedTotal += capDropped
      admittedTotal -= (capRejected + capDropped)
    }

    // 服务（Scaling 空窗可 muOverride=0）
    const effMu = d.muOverride === null || d.muOverride === undefined ? mu : d.muOverride
    serviceAccrual += effMu
    while (serviceAccrual >= 1 && queue.length > 0) {
      const m = queue.shift(); serviceAccrual -= 1
      waitSum += (t - m.enqueue); servedTotal++
    }
    // 拍末积分队长（路径 A）
    queueLenSum += queue.length
    if (queue.length > peakQueue) peakQueue = queue.length
    if (rejected > 0) lateArrivals++
  }

  // Little's Law 双路（导出纯函数 verifyLittleLaw；过载场景如实破裂，稳态前提=队列排空）
  // λ 用稳态吞吐率 served/steps 而非到达率——过载下到达≠离开、队列永不排空，用到达率会让 Lpred 假追上 L。
  const littleLaw = verifyLittleLaw({ queueLenSum, waitSum, served: servedTotal, endQueue: queue.length, steps: cfg.steps })
  const avgWait = servedTotal > 0 ? round4(waitSum / servedTotal) : 0
  const acceptedRate = arrivalsTotal > 0 ? round4((arrivalsTotal - rejectedTotal) / arrivalsTotal) : 1
  const { L, W, lambda: lambdaRate, Lpred, gap, steadyStateReached } = littleLaw

  // cell 三布尔：只有本场景负责的维度做真判定，其余空真（正交不连坐）
  const inDim = (dim) => (DIM_SCENARIOS[dim] ?? []).includes(scenario)
  const cNoLoss = inDim('noLoss') ? droppedTotal === 0 : true
  const cLowLatency = inDim('lowLatency') ? avgWait <= cfg.latencyBudget : true
  const cHighThroughput = inDim('highThroughput') ? acceptedRate >= cfg.acceptBudget : true

  return {
    id: scenario,
    strategy,
    arrivals: arrivalsTotal,
    accepted: admittedTotal + droppedTotal,
    admitted: admittedTotal,
    rejected: rejectedTotal,
    dropped: droppedTotal,
    served: servedTotal,
    endQueue: queue.length,
    waitSum,
    queueLenSum,
    avgWait,
    peakQueue,
    acceptedRate,
    muEffective: round2(servedTotal / cfg.steps),
    backpressureTicks: lateArrivals,
    littleLaw: { L, W, lambda: lambdaRate, Lpred, gap, steadyStateReached, holds: littleLaw.holds, nontrivial: L > 0 && W > 0 },
    noLoss: cNoLoss,
    lowLatency: cLowLatency,
    highThroughput: cHighThroughput,
    fault: scenario === 'downstreamStall' ? '下游停摆' : scenario === 'memoryPressure' ? '内存压顶'
      : scenario === 'burstAbsorb' ? '突发吸收' : scenario === 'latencySpike' ? '时延尖峰'
        : scenario === 'sustainedOverload' ? '持续过载' : '稳态轻载',
    ...(strat ? { rebalances: acc.scaling?.rebalances ?? 0 } : {}),
  }
}

/* --------------------------- ② 四策略对照 study --------------------------- */

function buildStudy(o = {}) {
  const scenarioIds = o.scenarios ?? BP_SCENARIOS
  const cfg = {
    steps: intOr(o.steps, BP_DEFAULTS.steps),
    mu: Math.max(0, numOr(o.mu, BP_DEFAULTS.mu)),
    acceptBudget: numOr(o.acceptBudget, BP_DEFAULTS.acceptBudget),
    latencyBudget: numOr(o.latencyBudget, BP_DEFAULTS.latencyBudget),
    bufferCap: intOr(o.bufferCap, BP_DEFAULTS.bufferCap),
    memoryCap: intOr(o.memoryCap, BP_DEFAULTS.memoryCap),
    seed: intOr(o.seed, BP_DEFAULTS.seed),
  }
  const rigged = o.rigged === true
  const flags = {
    zeroLoss: rigged || o.zeroLoss === true,
    boundedLatency: rigged || o.boundedLatency === true,
    unlimitedBuffer: rigged || o.unlimitedBuffer === true,
    rigged,
  }

  const rows = []
  for (const s of BP_STRATEGIES) {
    const cells = scenarioIds.map((sid) => simulate(s, sid, cfg, flags, o)).filter(Boolean)
    // 每维 = 其考场场景 cell 的 AND（非考场场景该维空真=true，不影响 AND）
    const dimOf = (dim) => cells.every((c) => c[dim] === true)
    const trilemma = { noLoss: dimOf('noLoss'), lowLatency: dimOf('lowLatency'), highThroughput: dimOf('highThroughput') }
    const cell = (sid) => cells.find((c) => c.id === sid)
    rows.push({
      strategy: s,
      scenarios: cells,
      trilemma,
      metrics: {
        dropped: cells.reduce((a, c) => a + c.dropped, 0),
        rejected: cells.reduce((a, c) => a + c.rejected, 0),
        avgWait: round2(cells.reduce((a, c) => a + c.avgWait, 0) / Math.max(1, cells.length)),
        peakQueue: cells.reduce((a, c) => Math.max(a, c.peakQueue), 0),
        rebalances: cell('sustainedOverload')?.rebalances ?? 0,
      },
    })
  }

  // 向量恒由 row.trilemma 现算（杜绝硬覆盖撒谎）
  const vecOf = (r) => `${Number(r.trilemma.noLoss)}${Number(r.trilemma.lowLatency)}${Number(r.trilemma.highThroughput)}`
  const vectors = Object.fromEntries(rows.map((r) => [r.strategy, vecOf(r)]))
  const distinct = new Set(Object.values(vectors)).size === rows.length
  const noWinsAll = !rows.some((r) => vecOf(r) === '111')
  const evidence = createBackpressureEvidence({ seed: cfg.seed })
  const cell = (p, s) => rows.find((r) => r.strategy === p)?.scenarios.find((c) => c.id === s)

  // Little's Law 双路：稳态场景全体成立；过载场景稳态前提破裂（如实，不假装也成立）
  const steadyCells = rows.map((r) => cell(r.strategy, 'steadyTrickle')).filter(Boolean)
  const overloadCells = rows.map((r) => cell(r.strategy, 'sustainedOverload')).filter(Boolean)
  const littleLawHolds = steadyCells.length > 0 && steadyCells.every((c) => c.littleLaw.holds === true)
  // 护栏：稳态场景至少要有一个策略给出非零 L/W 的真撞合，防止负载退化成全零排队时 0=0 假绿。
  const littleLawNontrivial = steadyCells.some((c) => c.littleLaw.nontrivial === true && c.littleLaw.holds === true)
  const overloadBreaksLittleLaw = overloadCells.some((c) => c.littleLaw.holds === false)
  const littleLaw = {
    steadyHolds: littleLawHolds,
    steadyNontrivial: littleLawNontrivial,
    overloadBreaks: overloadBreaksLittleLaw,
    steady: steadyCells.map((c) => ({ strategy: c.strategy, ...c.littleLaw })),
    overload: overloadCells.map((c) => ({ strategy: c.strategy, ...c.littleLaw })),
    note: 'L=λW 是稳态恒等式：周期批量轻载（平均 λ<μ、队列能排空）下逐拍积分队长 L 与逐消息 λ·W 双路在非零处真撞合；持续过载下队列无界增长、稳态前提破裂（endQueue>0），L≠λ·W 如实成立，不硬凑。',
  }

  const bpCell = cell('Backpressure', 'burstAbsorb')
  const bufCell = cell('Buffering', 'memoryPressure')
  const shedCell = cell('Shedding', 'sustainedOverload')
  const scalCell = cell('Scaling', 'burstAbsorb')
  const bufOverload = cell('Buffering', 'sustainedOverload')

  return {
    builtAt: startClock(o.now, 0),
    config: {
      ...cfg,
      acceptBudget: cfg.acceptBudget, latencyBudget: cfg.latencyBudget,
      zeroLoss: flags.zeroLoss, boundedLatency: flags.boundedLatency,
      unlimitedBuffer: flags.unlimitedBuffer, rigged,
      scenarios: scenarioIds,
    },
    rows,
    vectors,
    topology: {
      Backpressure: '令牌桶准入钳到≈μ、超出反压退回上游；队列近空⇒时延低+零丢，但突发接纳率被压到μ/λ⇒吞吐受损',
      Buffering: '全量接纳排大队列按μ匀速排空；零反压+零丢⇒吞吐+零丢失两维，但积压⇒时延线性涨，内存压顶打满真丢⇒非银弹',
      Shedding: '队列钳小阈值、超出主动丢弃；上游不反压⇒吞吐不损+时延低，但丢消息⇒零丢失不保',
      Scaling: '持续过载即扩容但先付rebalance空窗（停服+拒收，承接KI-523）；稳态治本+零丢，突发瞬时时延尖峰+吞吐反降，只占零丢失',
    },
    littleLaw,
    crosscheck: { evidence },
    verdict: {
      vectors,
      trilemmaDistinguishes: distinct,
      noUniversalWinner: distinct && noWinsAll,
      noStrategyWinsAll: noWinsAll,
      backpressureRejectsBursts: (bpCell?.rejected ?? 0) > 0 && rows[0].trilemma.highThroughput === false,
      bufferingPaysLatency: rows[1].trilemma.lowLatency === false,
      sheddingDropsMessages: (shedCell?.dropped ?? 0) > 0 && rows[2].trilemma.noLoss === false,
      sheddingNotFreeLunch: rows[2].trilemma.noLoss === false && rows[2].trilemma.lowLatency === true && rows[2].trilemma.highThroughput === true,
      scalingStallsOnRebalance: (scalCell?.rejected ?? 0) > 0 && rows[3].trilemma.highThroughput === false && rows[3].trilemma.lowLatency === false,
      bufferingDropsUnderMemoryPressure: (bufCell?.dropped ?? 0) > 0,
      bufferingAccumulatesUnderOverload: (bufOverload?.peakQueue ?? 0) > cfg.latencyBudget * cfg.mu,
      littleLawHolds,
      littleLawNontrivial,
      overloadBreaksLittleLaw,
      // 单开反噬：zeroLoss 补 Shedding 零丢失必令其积压、反噬低时延
      zeroLossBackfiresLatency: flags.zeroLoss && !flags.boundedLatency && rows[2].trilemma.noLoss === true && rows[2].trilemma.lowLatency === false,
      // 单开反噬：boundedLatency 补低时延必逼出丢弃、反噬零丢失
      boundedLatencyBackfiresNoLoss: flags.boundedLatency && !flags.zeroLoss && rows[1].trilemma.lowLatency === true && rows[1].trilemma.noLoss === false,
      // 单开 unlimitedBuffer 只抹 memoryPressure 下溢出丢弃、不动任何向量
      unlimitedBufferErasesOomOnly: flags.unlimitedBuffer && !flags.zeroLoss && !flags.boundedLatency &&
        (bufCell?.dropped ?? 0) === 0 && JSON.stringify(vectors) === JSON.stringify({ Backpressure: '110', Buffering: '101', Shedding: '011', Scaling: '100' }),
      // rigged 因果锁死：四向量收敛 110、highThroughput 无一能翻回、区分度与 noUniversalWinner 判词双双翻 false。
      // 注意：全 110 本就无一 111 ⇒ noWinsAll 恒 true，故判据不能写 noWinsAll=false（那是造假）；
      // 真正被抹掉的是「区分度」与「有全局赢家」这两个判词，highThroughput 这一维被 L=λW 因果锁死。
      highThroughputCausallyUnerasable: rigged && rows.every((r) => r.trilemma.highThroughput === false) &&
        rows.every((r) => r.trilemma.noLoss === true && r.trilemma.lowLatency === true) &&
        distinct === false && noWinsAll === true,
    },
    rigged,
  }
}

/** 纯数据 study（与 consumerGroupStudy 同参接口、无 DOM 依赖） */
export function backpressureStudy(opts = {}) { return buildStudy(opts) }

/** compareBackpressure 同构别名：研究入口的另一名字，指向同一 buildStudy。 */
export const compareBackpressure = backpressureStudy

/** 快照形态：consumerGroupSnapshot 同构裁剪 */
export function backpressureSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      strategy: r.strategy,
      scenarios: r.scenarios.map((s) => ({ ...s, littleLaw: { ...s.littleLaw } })),
      trilemma: { ...r.trilemma },
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    littleLaw: {
      steadyHolds: study.littleLaw.steadyHolds,
      steadyNontrivial: study.littleLaw.steadyNontrivial,
      overloadBreaks: study.littleLaw.overloadBreaks,
      steady: study.littleLaw.steady.map((x) => ({ ...x })),
      overload: study.littleLaw.overload.map((x) => ({ ...x })),
      note: study.littleLaw.note,
    },
    crosscheck: { evidence: study.crosscheck?.evidence ? { ...study.crosscheck.evidence } : study.crosscheck },
    verdict: { ...study.verdict },
    topology: { ...(study.topology ?? {}) },
  }
}

/** 十一枚真件交叉印证：返回每个真件的一小组真实读数（全真 API 真回读，计数不硬编码）。 */
export function createBackpressureEvidence(opts = {}) {
  const seed = intOr(opts.seed, BP_DEFAULTS.seed)

  // ① 真令牌桶：准入限流（固定时钟 capacity 放行、超预算真拒）
  const bucket = createTokenBucket({ capacity: 2, refillPerSec: 0, now: () => 1000 })
  let bucketAllowed = 0
  for (let i = 0; i < 5; i++) if (bucket.allow().allowed) bucketAllowed++

  // ② 真漏桶：整形（固定时钟无漏、超容量真拒）
  const leaky = createLeakyBucket({ capacity: 3, leakPerSec: 0, now: () => 1000 })
  let leakyAllowed = 0
  for (let i = 0; i < 5; i++) if (leaky.allow().allowed) leakyAllowed++

  // ③ 真 RedisZset durable 缓冲：setNow→schedule→poll 真吐、restore 真读 pending
  const zq = createRedisZsetDelayQueue({ now: 0 })
  for (let i = 0; i < 6; i++) zq.schedule(100, `bp:${i}`)
  zq.setNow(100)
  const zqFired = zq.poll().length
  const zqRestored = zq.restore()

  // ④ 真最小堆：精确排程 advance 真吐
  const heap = createMinHeapDelayQueue({ now: 0 })
  for (let i = 0; i < 9; i++) heap.schedule((i * 5 % 11) * 100 + 10, `wake:${i}`)
  const heapFired = heap.advance(100000).length

  // ⑤ 真 WAL：积压 append→lines→restore→replay 真回读
  const wal = createWal()
  for (let i = 0; i < 4; i++) wal.append('put', `bp:lag:${i}`, { n: i })
  const walLines = wal.lines().length
  const restoredWal = createWal()
  restoredWal.restore(wal.lines())
  let walReplayed = 0
  restoredWal.replay(() => { walReplayed++ })

  // ⑥ 真分片缓存：缓冲分片 set→get 命中
  const sharded = createShardedCache({ shards: ['s1', 's2', 's3'], salt: String(seed) })
  for (let i = 0; i < 8; i++) sharded.set(`key:${i}`, i, 0)
  let shardHits = 0
  for (let i = 0; i < 8; i++) if (sharded.get(`key:${i}`) === i) shardHits++

  // ⑦ 真布隆：重复消费判重 add→mightHave（命中真阳性 + 一个新 key 的真阴性）
  const bloom = createBloomFilter({ numKeys: 32, bitsPerKey: 8 })
  for (let i = 0; i < 12; i++) bloom.add(`msg:${i}`)
  const bloomHit = bloom.mightHave('msg:3')
  const bloomMiss = bloom.mightHave('msg:never-seen')

  // ⑧ 真全抖动退避：Shedding 后重试 nextDelay 真吐（多 msgId 撒开）
  const backoff = createFullJitterBackoff({ baseTicks: 2, capTicks: 16, seed })
  const delays = new Set()
  for (let i = 0; i < 6; i++) delays.add(backoff.nextDelay(i))
  const jitterSpread = delays.size

  // ⑨ 真紧凑计数：队列深度计数 inc→get + 布局真读
  const counters = createPackedCounters(8)
  for (let i = 0; i < 8; i++) counters.inc(i, i + 1)
  const counterSum = [0, 1, 2, 3, 4, 5, 6, 7].reduce((a, i) => a + counters.get(i), 0)
  const counterFalseSharing = counters.stats().falseSharingPairs

  // ⑩ 真对象池：消息对象复用（create/acquire/release/reuse 真读）
  const pool = createObjectPool({ factory: () => ({ lag: 0 }), maxSize: 4 })
  const m1 = pool.acquire(); const m2 = pool.acquire()
  pool.release(m1); pool.release(m2)
  const m3 = pool.acquire()
  const poolStats = pool.stats()

  // ⑪ 真总线：水位告警通知真投递
  const bus = createBus()
  let watermarkNotices = 0
  bus.subscribe('bp:watermark', () => { watermarkNotices++ })
  bus.publish('bp:watermark', { level: 'high' })
  bus.publish('bp:watermark', { level: 'critical' })
  const busListeners = bus.listenerCount('bp:watermark')

  return {
    bucketAllowed,
    bucketRejected: 5 - bucketAllowed,
    leakyAllowed,
    leakyRejected: 5 - leakyAllowed,
    zqFired,
    zqPendingAfterRestore: zqRestored.pending,
    zqLostOnRestart: zqRestored.lostOnRestart,
    heapFired,
    walLines,
    walReplayed,
    shardHits,
    bloomHit,
    bloomMiss,
    jitterSpread,
    counterSum,
    counterFalseSharing,
    poolCreated: poolStats.created,
    poolReused: poolStats.reused,
    watermarkNotices,
    busListeners,
  }
}

/* --------------------------- CLI --------------------------- */

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const s = backpressureStudy({ rigged, now: () => 0 })
  const snap = backpressureSnapshot(s)
  console.log('[backpressure] steps=' + s.config.steps + ' mu=' + s.config.mu +
    ' zeroLoss=' + s.config.zeroLoss + ' boundedLatency=' + s.config.boundedLatency + ' unlimitedBuffer=' + s.config.unlimitedBuffer)
  const stateOf = (c) => c.noLoss === false ? '丢' : c.lowLatency === false ? '滞' : c.highThroughput === false ? '压' : '✓'
  for (const row of snap.rows) {
    const cell = (sid) => row.scenarios.find((c) => c.id === sid)
    console.log(
      '  ' + row.strategy.padEnd(12) +
      ' burst.rej=' + String(cell('burstAbsorb').rejected).padStart(3) +
      ' over.drop=' + String(cell('sustainedOverload').dropped).padStart(3) +
      ' spike.wait=' + String(cell('latencySpike').avgWait).padStart(5) +
      ' mem.drop=' + String(cell('memoryPressure').dropped).padStart(3) +
      ' | steady=' + stateOf(cell('steadyTrickle')) + ' burst=' + stateOf(cell('burstAbsorb')) +
      ' over=' + stateOf(cell('sustainedOverload')) + ' spike=' + stateOf(cell('latencySpike')) +
      ' stall=' + stateOf(cell('downstreamStall')) + ' mem=' + stateOf(cell('memoryPressure')) +
      ' | trilemma=' + JSON.stringify(row.trilemma),
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.verdict.noUniversalWinner + ' distinguishable=' + snap.verdict.trilemmaDistinguishes + ' rigged=' + s.rigged)
  console.log('  littleLaw steadyHolds=' + snap.littleLaw.steadyHolds + ' steadyNontrivial=' + snap.littleLaw.steadyNontrivial +
    ' overloadBreaks=' + snap.littleLaw.overloadBreaks +
    ' | steady L/λW=' + snap.littleLaw.steady.map((x) => x.strategy + ':' + x.L + '/' + x.Lpred).join(' '))
  // 向量恒由 row.trilemma 现算：CLI 逐行重推作自证
  const recomputed = Object.fromEntries(snap.rows.map((r) => [r.strategy,
    `${Number(r.trilemma.noLoss)}${Number(r.trilemma.lowLatency)}${Number(r.trilemma.highThroughput)}`]))
  const sameSource = JSON.stringify(recomputed) === JSON.stringify(snap.vectors)
  console.log('  VECTOR_FROM_TRILEMMA_OK=' + sameSource + '（向量由表格现算，非硬覆盖）')
  if (s.rigged) {
    const falsifiable = snap.verdict.noUniversalWinner === false && snap.verdict.trilemmaDistinguishes === false &&
      snap.verdict.highThroughputCausallyUnerasable === true &&
      snap.rows.every((r) => r.trilemma.highThroughput === false) && sameSource
    console.log('  RIGGED_FALSIFIABLE_OK=' + falsifiable +
      '（真实现算 110/110/110/110；boundedLatency 锁短队列 + zeroLoss 禁丢，由 L=λW 逼出反压、acceptRate 钳到 μ/λ，unlimitedBuffer 靠缓冲全收必生 W 被当场压制，highThroughput 维无一能翻回，判词翻 false，不硬覆盖全 111）')
  }
}
