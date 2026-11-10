import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * scripts/caesura-distributed-txn.mjs —— 分布式事务：2PC 两阶段提交 + Saga 补偿事务 + TCC 资源预留三协议诚实权衡对照
 * （P8 第十四件，KI-506）。
 *
 * <p>补的是 KI-505 之后那一步。KI-505 落了**单机事务与并发控制**（MVCC 多版本可见性 + 五档隔离 +
 * 行锁 2PL 死锁检测），但它只管一个进程内的并发；业务一旦拆成跨 N 个服务 / N 个库，就撞上 CAP：
 * 一个业务写跨了 N 个资源，怎么保证「要么全成、要么全不成」？生产里的答案从来不是一个，而是
 * 三条各有代价的路：</p>
 * <ol>
 *   <li>**2PC / XA（两阶段提交）**：有个协调者，先 `prepare` 让所有参与者投票并**预留/持锁**，
 *       全 yes 才 `commit`、任一 no 就全局 `rollback`。强一致、有隔离，但**协调者在全员 yes 之后
 *       宕机**时，参与者既不能自己提交（没收到决策）也不能自己回滚（2PC 不允许单边中止，否则破坏
 *       原子性）⇒ 全体卡在 `prepared` **持锁阻塞，不可自愈**。这是分布式的经典「阻塞窗口 / 协调者单点」。</li>
 *   <li>**Saga（补偿事务）**：没有全局锁，把长事务拆成正 `T1..Tn`，每步配一个**反向补偿** `C1..Cn`；
 *       第 k 步失败就**逆序**跑 `C(k-1)…C1`。从不阻塞、长事务友好，但**放弃隔离**（中途状态别人看得见），
 *       而且补偿是业务反向操作（退款、撤邮件）——**可能失败甚至不可逆**，补偿失败就**留脏数据**。</li>
 *   <li>**TCC（Try-Confirm-Cancel）**：每个服务写**三套接口**——Try 先**预留**资源、Confirm 确认提交、
 *       Cancel 释放预留。全 Try 成功才逐 Confirm、任一 Try 失败逐 Cancel。Try 先占位 ⇒ 没有 Saga 那种
 *       隔夜脏，Confirm/Cancel 做成**幂等**后可重试自愈；代价是**业务侵入最重**（每服务三套接口）、
 *       预留期间占资源。</li>
 * </ol>
 *
 * <p>三只骨架 + 一只对照 + study/snapshot（缺一不可）：</p>
 * <ol>
 *   <li>**`createTwoPhaseCommit`**：`prepare()` 全员投 yes/no、全 yes 才 `commit()`、任一 no 即全局中止。
 *       注入 `coordinatorDownAfterPrepare` 钉死阻塞、`noVotes` 钉死中止；重复提交/回滚**幂等**（不重复记账）。</li>
 *   <li>**`createSaga`**：正向链逐步执行、`failAtStep` 触发**逆序补偿**；`compensateFailAt` 让补偿也失败，
 *       `dirtyData` 如实记账（不粉饰「补偿必成功」），`steps`/`trace` 记每步与每次补偿。</li>
 *   <li>**`createTcc`**：逐 Try 预留、全成功才逐 Confirm、任一失败逐 Cancel；`confirmFailAt` + `confirmFailTimes`
 *       触发**幂等重试**（重试次数入账）；`reservations`/`traces` 记三阶段状态。</li>
 *   <li>**`compareDistributedTxn` 核心证据**：同一组**确定性故障场景**（全成功 / 单点投 no / 协调者 prepare 后
 *       宕机 / 第 k 步失败 / 补偿再失败 / Confirm 半途失败）分喂三协议，数各 `committed/aborted/blocked/
 *       dirty/retries/messages` 与侵入度，钉死「**2PC 阻塞+协调者单点 / Saga 不阻塞但留脏且无隔离 /
 *       TCC 无隔夜脏可自愈但三套接口侵入最重**」这组最经典的真实取舍，并用**不阻塞 ∧ 不留脏 ∧ 侵入最低**
 *       这个三难判据证明**没有协议能同时占全**（`noUniversalWinner`，可证伪、非恒真）。</li>
 * </ol>
 *
 * <p>设计取舍：时钟、故障点、场景、参与方/步数、重试上限全由 opts 注入；本件只跑状态机与结构计数，
 * 不写业务阈值。与真 XA / 真网络 / 真数据库无运行时依赖——无两阶段落盘日志、无真跨进程协调者、
 * 无真幂等键/去重表；所有读数都是**确定性故障场景上的结构计数**，不是墙钟、吞吐或真库一致性跑分。</p>
 *
 * 用法：
 *   const two = createTwoPhaseCommit({ participants:['A','B','C'] })
 *   two.prepare(); two.commit()                       // → { committed:true, ... }
 *   const down = createTwoPhaseCommit(); down.prepare(); down.commit({ coordinatorDown:true })
 *   down.stats().blockedParticipants                  // → 参与者数（阻塞窗口）
 *   const saga = createSaga(); saga.run({ failAtStep:2, compensateFailAt:0 })  // 逆序补偿 + 留脏
 *   const tcc = createTcc(); tcc.run({ confirmFlakyAt:0, confirmFailTimes:1 }) // 幂等重试后提交
 *   const cmp = compareDistributedTxn()
 *   const study = distributedTxnStudy()               // 纯数据汇总
 *
 * CLI：node scripts/caesura-distributed-txn.mjs  （= npm run disttxn:bench，注入固定时钟双跑字节一致）
 */

/** 缺省教学参数（阈值/故障点仍由调用方注入，这里只是缺省值）。 */
export const DTX_DEFAULTS = Object.freeze({
  participants: Object.freeze(['P1', 'P2', 'P3']),
  sagaSteps: Object.freeze(['T1', 'T2', 'T3']),
  tccSteps: Object.freeze(['S1', 'S2', 'S3']),
  failIndex: 1,              // 第 k 步失败（0-based，默认第 2 步）
  compensateFailIndex: 0,    // 哪一环补偿再失败（默认 C1）
  confirmFlakyIndex: 0,      // 哪一步 Confirm 半途失败（默认第 1 步）
  confirmFailTimes: 1,       // Confirm 前 N 次失败后幂等重试成功
  maxRetries: 3,             // 幂等重试上限（超过则记 dirty，诚实边界）
  zero: 0,
})

/** 三协议（顺序固定，短名作快照/矩阵 key）。 */
export const DTX_PROTOCOLS = Object.freeze([
  Object.freeze({ id: 'two-phase-commit', short: '2PC', label: '两阶段提交' }),
  Object.freeze({ id: 'saga', short: 'Saga', label: '补偿事务' }),
  Object.freeze({ id: 'tcc', short: 'TCC', label: '资源预留' }),
])
const PROTOCOL_SHORTS = Object.freeze(DTX_PROTOCOLS.map((p) => p.short))
const PROTOCOL_LABELS = Object.freeze(Object.fromEntries(DTX_PROTOCOLS.map((p) => [p.short, p.label])))

/** 六类确定性故障场景（矩阵列；fault 由 buildScenarios 依 opts 生成）。 */
export const DTX_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'allOk', label: '全成功' }),
  Object.freeze({ id: 'voteNo', label: '单点投 no / Try 失败' }),
  Object.freeze({ id: 'coordinatorDown', label: '协调者 prepare 后宕机' }),
  Object.freeze({ id: 'stepFail', label: '第 k 步失败' }),
  Object.freeze({ id: 'compensateFail', label: '补偿再失败' }),
  Object.freeze({ id: 'confirmFlaky', label: 'Confirm 半途失败' }),
])

const uniq = (xs) => Array.from(new Set(xs))
const asArr = (v) => Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v])
const intOrNull = (v) => Number.isInteger(v) ? v : null
const clampIdx = (i, n) => ((Number(i) % n) + n) % n
const namesOf = (v, fallback) => {
  const src = Array.isArray(v) && v.length ? v : fallback
  return uniq(src.map(String))
}

/* ============================================================
 * ① 2PC 两阶段提交
 * ============================================================ */

/**
 * 两阶段提交协调者（进程内教学状态机）。
 *
 * 阶段：init → prepared（全员 yes）→ committed / aborted；或 prepared → blocked（协调者宕机）。
 * `prepare(fo)`：`fo.noVotes` 指定哪些参与者投 no ⇒ 直接全局中止。
 * `commit(fo)`：`fo.coordinatorDown === true` 模拟「全员 yes、协调者发决策前宕机」⇒ 参与者停在
 *   prepared 持锁阻塞（`blockedParticipants`），且**不可自愈**——只有 `resolveBlocked()`（外部超时/
 *   人工介入）才解开。重复 `commit`/`rollback` 幂等（不重复发消息、不重复记账）。
 */
export function createTwoPhaseCommit(opts = {}) {
  const participants = namesOf(opts.participants, DTX_DEFAULTS.participants)
  const now = typeof opts.now === 'function' ? opts.now : null
  let phase = 'init'
  let coordinatorDown = false
  let resolvedBy = null
  let messages = 0
  let commitCalls = 0
  let rollbackCalls = 0
  /** @type {Map<string,'yes'|'no'>} */
  const votes = new Map()
  /** @type {Map<string,true>} */
  const acks = new Map()
  /** @type {Array<{i:number,t:string,[k:string]:any}>} */
  const trace = []

  function log(t, detail = {}) { trace.push({ i: trace.length, t, ...detail }) }

  function prepare(fo = {}) {
    if (phase !== 'init') return { ok: false, error: 'not-init', phase, messages }
    const noVotes = new Set(asArr(fo.noVotes).map(String))
    for (const p of participants) {
      messages += 2 // prepare 请求 + vote 回复
      const vote = noVotes.has(p) ? 'no' : 'yes'
      votes.set(p, vote)
      log('vote', { participant: p, vote })
    }
    const allYes = participants.every((p) => votes.get(p) === 'yes')
    if (!allYes) {
      phase = 'aborted' // 协调者收到任一 no ⇒ 立即全局中止（无需等全部 prepare 决策阶段）
      messages += participants.length * 2 // rollback 决策 + ACK
      for (const p of participants) acks.set(p, true)
      resolvedBy = 'coordinator'
      log('global-abort', { reason: 'vote-no', noVotes: Array.from(noVotes) })
      return { ok: true, allYes: false, phase, votes: Object.fromEntries(votes), messages }
    }
    phase = 'prepared'
    log('prepared', { participants: participants.length })
    return { ok: true, allYes: true, phase, votes: Object.fromEntries(votes), messages }
  }

  function commit(fo = {}) {
    if (phase === 'committed') return { committed: true, idempotent: true, phase, messages: 0, commitCalls }
    if (phase !== 'prepared') return { committed: false, error: 'not-prepared', phase, messages: 0 }
    commitCalls++
    if (fo.coordinatorDown === true) {
      coordinatorDown = true
      phase = 'blocked'
      log('coordinator-down', { afterPrepare: true })
      return { committed: false, phase, coordinatorDown: true, blockedParticipants: participants.length, messages }
    }
    for (const p of participants) {
      messages += 2 // commit 决策 + ACK
      acks.set(p, true)
      log('ack', { participant: p, decision: 'commit' })
    }
    phase = 'committed'
    resolvedBy = 'coordinator'
    log('global-commit', {})
    return { committed: true, idempotent: false, phase, acks: Array.from(acks.keys()), messages, commitCalls }
  }

  function rollback(fo = {}) {
    if (phase === 'aborted') return { aborted: true, idempotent: true, phase, messages: 0, rollbackCalls }
    if (phase !== 'prepared' && phase !== 'blocked') return { aborted: false, error: 'not-rollback-able', phase, messages: 0 }
    rollbackCalls++
    for (const p of participants) {
      messages += 2 // rollback 决策 + ACK
      acks.set(p, true)
      log('ack', { participant: p, decision: 'rollback' })
    }
    const wasBlocked = phase === 'blocked'
    phase = 'aborted'
    coordinatorDown = false
    resolvedBy = fo.rescued ? 'external-timeout' : 'coordinator'
    log('global-abort', { reason: wasBlocked ? 'resolved-block' : 'rollback' })
    return { aborted: true, idempotent: false, phase, rescued: wasBlocked, messages, rollbackCalls }
  }

  /** 教学落点：2PC 阻塞不可自愈，须外部超时 / 人工介入 `resolveBlocked` 才解开。 */
  function resolveBlocked(decision = 'rollback') {
    if (phase !== 'blocked') return { resolved: false, reason: 'not-blocked', phase }
    const r = decision === 'commit' ? commit() : rollback({ rescued: true })
    return { resolved: true, decision, ...r }
  }

  function stats() {
    return {
      phase,
      participants: participants.length,
      votesYes: Array.from(votes.values()).filter((v) => v === 'yes').length,
      votesNo: Array.from(votes.values()).filter((v) => v === 'no').length,
      coordinatorDown,
      blockedParticipants: phase === 'blocked' ? participants.length : 0,
      acks: acks.size,
      messages,
      commitCalls,
      rollbackCalls,
      resolvedBy,
      isolation: true,                 // prepare→commit 全程持锁，外界看不到中间态
      intrusion: participants.length,  // XA 由中间件托管，业务侵入最低（只需声明资源）
    }
  }

  function snapshot(t) {
    return {
      generator: 'caesura-distributed-txn/2pc',
      participants: [...participants],
      votes: Object.fromEntries(votes),
      acks: Array.from(acks.keys()),
      phase,
      trace: trace.map((x) => ({ ...x })),
      stats: stats(),
      builtAt: t === undefined ? (now ? Number(now()) || 0 : 0) : t,
    }
  }

  function reset() {
    phase = 'init'; coordinatorDown = false; resolvedBy = null; messages = 0
    commitCalls = 0; rollbackCalls = 0; votes.clear(); acks.clear(); trace.length = 0
  }

  return {
    prepare, commit, rollback, resolveBlocked, stats, snapshot, reset,
    get phase() { return phase },
    get messages() { return messages },
    participants: [...participants],
  }
}

/* ============================================================
 * ② Saga 补偿事务
 * ============================================================ */

/**
 * Saga 编排器（进程内教学状态机）：正向链 + 逆序补偿，无全局锁。
 *
 * `run(fo)`：`fo.failAtStep = k` 令第 k 步失败 ⇒ 逆序补偿已完成的 `C(k-1)…C0`；
 * `fo.compensateFailAt = j` 令第 j 环补偿也失败 ⇒ 该步 `dirtyData++`（补偿不总能回滚外部副作用）。
 * 无失败则全部成功 `committed`。**从不阻塞**（`blockedParticipants` 恒 0），但**放弃隔离**
 * （`isolation:false`，中间态对外可见），且补偿失败留脏（不假装已抹平）。
 */
export function createSaga(opts = {}) {
  const steps = namesOf(opts.steps, DTX_DEFAULTS.sagaSteps)
  const compensations = Array.isArray(opts.compensations) && opts.compensations.length
    ? opts.compensations.map(String)
    : steps.map((_, i) => `C${i + 1}`)
  const now = typeof opts.now === 'function' ? opts.now : null
  let phase = 'init'
  let messages = 0
  let dirtyData = 0
  /** @type {number[]} 正向成功步索引 */
  const done = []
  /** @type {number[]} 已成功补偿步索引 */
  const compensated = []
  /** @type {Array<{i?:number,t:string,[k:string]:any}>} */
  const trace = []

  function log(t, detail = {}) { trace.push({ t, ...detail }) }

  function run(fo = {}) {
    if (phase !== 'init') return { ok: false, error: 'already-ran', phase, messages }
    const failAt = intOrNull(fo.failAtStep)
    const compFailAt = intOrNull(fo.compensateFailAt)
    for (let i = 0; i < steps.length; i++) {
      messages += 2 // 正向执行请求 + 结果
      if (failAt !== null && i === failAt) {
        log('step-fail', { i, step: steps[i] })
        const compensationOrder = []
        for (let j = done.length - 1; j >= 0; j--) { // 逆序
          const k = done[j]
          compensationOrder.push(k)
          messages += 2 // 补偿请求 + 结果
          if (compFailAt !== null && k === compFailAt) {
            dirtyData++
            log('compensate-fail', { i: k, step: steps[k], compensation: compensations[k] })
          } else {
            compensated.push(k)
            log('compensate', { i: k, step: steps[k], compensation: compensations[k] })
          }
        }
        phase = dirtyData > 0 ? 'dirty' : 'aborted'
        return {
          ok: true, committed: false, phase, stepsDone: done.length,
          compensationOrder, compensated: [...compensated], dirtyData, messages, isolation: false,
        }
      }
      done.push(i)
      log('step-ok', { i, step: steps[i] })
    }
    phase = 'committed'
    return { ok: true, committed: true, phase, stepsDone: done.length, compensationOrder: [], compensated: [], dirtyData: 0, messages, isolation: false }
  }

  function stats() {
    return {
      phase, steps: steps.length, stepsDone: done.length, compensated: compensated.length,
      dirtyData, messages, blockedParticipants: 0, isolation: false,
      intrusion: steps.length * 2, // 每步要写正向 + 补偿两套业务逻辑
    }
  }

  function snapshot(t) {
    return {
      generator: 'caesura-distributed-txn/saga',
      steps: [...steps], compensations: [...compensations], done: [...done],
      compensated: [...compensated], phase, dirtyData,
      trace: trace.map((x) => ({ ...x })),
      stats: stats(),
      builtAt: t === undefined ? (now ? Number(now()) || 0 : 0) : t,
    }
  }

  function reset() {
    phase = 'init'; messages = 0; dirtyData = 0; done.length = 0; compensated.length = 0; trace.length = 0
  }

  return {
    run, stats, snapshot, reset,
    get phase() { return phase },
    get messages() { return messages },
    steps: [...steps], compensations: [...compensations],
  }
}

/* ============================================================
 * ③ TCC Try-Confirm-Cancel
 * ============================================================ */

/**
 * TCC 协调器（进程内教学状态机）：逐 Try 预留、全成功逐 Confirm、任一 Try 失败逐 Cancel。
 *
 * `run(fo)`：`fo.tryFailAt = k` 令第 k 步 Try 失败 ⇒ 对已预留者逆序 Cancel；
 * `fo.confirmFlakyAt = k` + `fo.confirmFailTimes = n` 令第 k 步 Confirm 前 n 次失败 ⇒ **幂等重试**
 * （`retries` 记账，至多 `maxRetries` 次，超过则 `dirty`）；`fo.cancelFailAt = k` 演示预留系统自身
 * 故障也会留脏（诚实边界：TCC 的 Cancel 通常可靠，但非绝对）。Try 先占位 ⇒ 无 Saga 隔夜脏、
 * 有隔离；Confirm/Cancel 幂等可重试自愈；代价是每服务三套接口、`intrusion` 最重。
 */
export function createTcc(opts = {}) {
  const steps = namesOf(opts.steps, DTX_DEFAULTS.tccSteps)
  const maxRetries = Math.max(1, Math.floor(Number(opts.maxRetries) || DTX_DEFAULTS.maxRetries))
  const now = typeof opts.now === 'function' ? opts.now : null
  let phase = 'init'
  let messages = 0
  let retries = 0
  let dirtyData = 0
  /** @type {Map<string,string>} step → 三阶段状态 */
  const reservations = new Map()
  /** @type {Array<{t:string,step:string,[k:string]:any}>} */
  const traces = []

  function log(t, detail = {}) { traces.push({ t, ...detail }) }

  function run(fo = {}) {
    if (phase !== 'init') return { ok: false, error: 'already-ran', phase, messages }
    const tryFailAt = intOrNull(fo.tryFailAt)
    const confirmFlakyAt = intOrNull(fo.confirmFlakyAt)
    const confirmFailTimes = Math.max(0, Math.floor(Number(fo.confirmFailTimes) || 0))
    const cancelFailAt = intOrNull(fo.cancelFailAt)
    /** @type {number[]} 已预留步索引 */
    const reserved = []

    // 阶段一：逐 Try 预留
    for (let i = 0; i < steps.length; i++) {
      messages += 2
      if (tryFailAt !== null && i === tryFailAt) {
        reservations.set(steps[i], 'try-failed')
        log('try-fail', { i, step: steps[i] })
        const cancelOrder = []
        for (let j = reserved.length - 1; j >= 0; j--) { // 逆序 Cancel 已预留者
          const k = reserved[j]
          cancelOrder.push(k)
          messages += 2
          if (cancelFailAt !== null && k === cancelFailAt) {
            dirtyData++
            reservations.set(steps[k], 'cancel-failed')
            log('cancel-fail', { i: k, step: steps[k] })
          } else {
            reservations.set(steps[k], 'cancelled')
            log('cancel', { i: k, step: steps[k] })
          }
        }
        phase = dirtyData > 0 ? 'dirty' : 'aborted'
        return { ok: true, committed: false, phase, tryFailAt: i, cancelOrder, dirtyData, messages, retries, isolation: true }
      }
      reservations.set(steps[i], 'reserved')
      reserved.push(i)
      log('try-ok', { i, step: steps[i] })
    }

    // 阶段二：全 Try 成功 ⇒ 逐 Confirm（幂等重试）
    for (const k of reserved) {
      let attempt = 0
      while (true) {
        messages += 2
        attempt++
        const mustFail = confirmFlakyAt === k && attempt <= confirmFailTimes
        if (mustFail) {
          if (attempt > maxRetries) {
            dirtyData++
            reservations.set(steps[k], 'confirm-exhausted')
            log('confirm-exhausted', { i: k, step: steps[k], attempt })
            break
          }
          retries++
          reservations.set(steps[k], `confirm-retry-${attempt}`)
          log('confirm-retry', { i: k, step: steps[k], attempt })
          continue
        }
        reservations.set(steps[k], 'confirmed')
        log('confirm-ok', { i: k, step: steps[k], attempt })
        break
      }
    }
    phase = dirtyData > 0 ? 'dirty' : 'committed'
    return {
      ok: true, committed: phase === 'committed', phase,
      confirmed: reserved.length, dirtyData, messages, retries, isolation: true,
    }
  }

  function stats() {
    const values = Array.from(reservations.values())
    return {
      phase, steps: steps.length,
      tryOk: values.filter((v) => v !== 'try-failed').length,
      confirmed: values.filter((v) => v === 'confirmed').length,
      cancelled: values.filter((v) => v === 'cancelled' || v === 'cancel-failed').length,
      dirtyData, messages, retries, blockedParticipants: 0, isolation: true,
      intrusion: steps.length * 3, // 每服务 Try / Confirm / Cancel 三套接口
    }
  }

  function snapshot(t) {
    return {
      generator: 'caesura-distributed-txn/tcc',
      steps: [...steps], reservations: Object.fromEntries(reservations), phase, retries, dirtyData,
      traces: traces.map((x) => ({ ...x })),
      stats: stats(),
      builtAt: t === undefined ? (now ? Number(now()) || 0 : 0) : t,
    }
  }

  function reset() {
    phase = 'init'; messages = 0; retries = 0; dirtyData = 0; reservations.clear(); traces.length = 0
  }

  return {
    run, stats, snapshot, reset,
    get phase() { return phase },
    get messages() { return messages },
    steps: [...steps], maxRetries,
  }
}

/* ============================================================
 * ④ 同组故障场景 × 三协议对照
 * ============================================================ */

/** 依 opts 生成六个场景各自的故障注入（同一场景对三协议各有语义，见 runDtxnScenario）。 */
function buildScenarios(opts = {}) {
  const d = DTX_DEFAULTS
  const fi = opts.failIndex ?? d.failIndex
  const ci = opts.compensateFailIndex ?? d.compensateFailIndex
  const fli = opts.confirmFlakyIndex ?? d.confirmFlakyIndex
  const ft = opts.confirmFailTimes ?? d.confirmFailTimes
  const faultOf = (id) => {
    switch (id) {
      case 'allOk': return {}
      case 'voteNo': return { at: 'voteNo', index: fi }
      case 'coordinatorDown': return { at: 'coordinatorDown' }
      case 'stepFail': return { at: 'stepFail', index: fi }
      case 'compensateFail': return { at: 'compensateFail', index: fi, compIndex: ci }
      case 'confirmFlaky': return { at: 'confirmFlaky', index: fli, times: ft }
      default: return {}
    }
  }
  return DTX_SCENARIOS.map((s) => ({ id: s.id, label: s.label, fault: faultOf(s.id) }))
}

/**
 * 在某一协议上跑一个场景，返回**统一读数**（compare 与单测共用）。
 *
 * 故障对三协议的语义映射是诚实的：
 *  - `coordinatorDown` 只打击 2PC（Saga/TCC 无「协调者 prepare 后决策」这道坎）；
 *  - `compensateFail` 只打击 Saga（2PC 无补偿、TCC 的 Cancel 是释放预留不依赖外部副作用）；
 *  - `confirmFlaky` 只打击 TCC（2PC/Saga 无 Confirm 阶段）。
 * 这正是三协议各有软肋、无全局赢家的结构性根因。
 */
export function runDtxnScenario(opts = {}) {
  const pid = PROTOCOL_SHORTS.includes(opts.protocol) ? opts.protocol : '2PC'
  const scenario = opts.scenario || { id: 'allOk', label: '全成功', fault: {} }
  const fault = scenario.fault || {}
  const now = opts.now
  const base = {
    protocol: pid, scenario: scenario.id || 'custom', label: scenario.label || scenario.id || '自定义',
    committed: false, aborted: false, blocked: 0, dirty: 0, retries: 0, messages: 0,
    isolation: false, intrusion: 0, atomic: false, detail: {},
  }

  if (pid === '2PC') {
    const mgr = createTwoPhaseCommit({ participants: opts.participants, now })
    const noVotes = []
    if (fault.at === 'voteNo' || fault.at === 'stepFail') {
      noVotes.push(String(mgr.participants[clampIdx(fault.index, mgr.participants.length)]))
    }
    const p = mgr.prepare({ noVotes })
    if (fault.at === 'coordinatorDown') mgr.commit({ coordinatorDown: true })
    else if (p.allYes) mgr.commit()
    const s = mgr.stats()
    return {
      ...base,
      committed: s.phase === 'committed',
      aborted: s.phase === 'aborted',
      blocked: s.blockedParticipants,
      messages: s.messages,
      isolation: true, intrusion: s.intrusion,
      atomic: s.phase !== 'blocked', // 阻塞 ⇒ 决策悬空、原子性无法落地（未提交也无部分写）
      detail: { phase: s.phase, votesYes: s.votesYes, votesNo: s.votesNo, coordinatorDown: s.coordinatorDown, blockedParticipants: s.blockedParticipants },
    }
  }

  if (pid === 'Saga') {
    const steps = namesOf(opts.sagaSteps, DTX_DEFAULTS.sagaSteps)
    const mgr = createSaga({ steps, now })
    let r
    if (fault.at === 'voteNo' || fault.at === 'stepFail') r = mgr.run({ failAtStep: clampIdx(fault.index, steps.length) })
    else if (fault.at === 'compensateFail') r = mgr.run({ failAtStep: clampIdx(fault.index, steps.length), compensateFailAt: clampIdx(fault.compIndex, steps.length) })
    else r = mgr.run() // allOk / coordinatorDown（无阻塞单点）/ confirmFlaky（无 Confirm）
    const s = mgr.stats()
    return {
      ...base,
      committed: s.phase === 'committed',
      aborted: s.phase === 'aborted' || s.phase === 'dirty',
      dirty: s.dirtyData,
      messages: s.messages,
      isolation: false, intrusion: s.intrusion,
      atomic: s.dirtyData === 0, // 补偿成功 ⇒ 业务等价回滚；留脏 ⇒ 原子性被破坏
      detail: { phase: s.phase, stepsDone: s.stepsDone, compensated: s.compensated, compensationOrder: r.compensationOrder || [], dirtyData: s.dirtyData },
    }
  }

  if (pid === 'TCC') {
    const steps = namesOf(opts.tccSteps, DTX_DEFAULTS.tccSteps)
    const mgr = createTcc({ steps, now, maxRetries: opts.maxRetries })
    let r
    if (fault.at === 'voteNo' || fault.at === 'stepFail') r = mgr.run({ tryFailAt: clampIdx(fault.index, steps.length) })
    else if (fault.at === 'confirmFlaky') r = mgr.run({ confirmFlakyAt: clampIdx(fault.index, steps.length), confirmFailTimes: fault.times })
    else r = mgr.run() // allOk / coordinatorDown（预留可超时自愈、不阻塞）/ compensateFail（Cancel 释放预留通常成功）
    const s = mgr.stats()
    return {
      ...base,
      committed: s.phase === 'committed',
      aborted: s.phase === 'aborted' || s.phase === 'dirty',
      dirty: s.dirtyData,
      retries: s.retries,
      messages: s.messages,
      isolation: true, intrusion: s.intrusion,
      atomic: s.dirtyData === 0,
      detail: { phase: s.phase, confirmed: s.confirmed, cancelled: s.cancelled, retries: s.retries, dirtyData: s.dirtyData },
    }
  }

  return base
}

/**
 * 核心对照：六场景 × 三协议的统一读数矩阵 + 三难判据 + verdict。
 *
 * 三难 = **不阻塞 ∧ 不留脏 ∧ 侵入最低**。逐协议量出**真实**三难向量（不假设「各恰好缺一」——
 * 那会把 Saga 缺两难这种更真实的取舍误判红）：
 *   2PC   = [不阻塞 ✗, 不留脏 ✓, 侵入最低 ✓]  —— 缺「不阻塞」（协调者宕机全员阻塞）
 *   Saga  = [不阻塞 ✓, 不留脏 ✗, 侵入最低 ✗]  —— 缺「不留脏」且侵入非最低
 *   TCC   = [不阻塞 ✓, 不留脏 ✓, 侵入最低 ✗]  —— 缺「侵入最低」（三套接口最重）
 * 三条向量**互不相同**、且**没有一条三个全 ✓** ⇒ 无全局赢家（`noUniversalWinner` 真）。
 * 判词可证伪：若用 rigged 场景（抹掉三种故障）跑，2PC 变 [✓,✓,✓] 全占、Saga 与 TCC 退化为
 * 同一条 [✓,✓,✗] ⇒ `noProtocolWinsAll` 与 `trilemmaDistinguishes` 同时翻 false。单测钉住这条。
 */
export function compareDistributedTxn(opts = {}) {
  const scenarios = Array.isArray(opts.scenarios) ? opts.scenarios : buildScenarios(opts)
  const protocols = PROTOCOL_SHORTS
  /** @type {Record<string,any>} */
  const matrix = {}
  for (const p of protocols) {
    const cell = {
      protocol: p, label: PROTOCOL_LABELS[p],
      scenarios: {},
      totals: { committed: 0, aborted: 0, blocked: 0, dirty: 0, retries: 0, messages: 0 },
      intrusion: 0, isolation: false, trilemma: { noBlock: false, noDirty: false, lowIntrusion: false },
    }
    for (const sc of scenarios) {
      const r = runDtxnScenario({ ...opts, protocol: p, scenario: sc })
      cell.scenarios[sc.id] = { ...r, label: sc.label, fault: sc.fault || {} }
      cell.totals.committed += r.committed ? 1 : 0
      cell.totals.aborted += r.aborted ? 1 : 0
      cell.totals.blocked += r.blocked
      cell.totals.dirty += r.dirty
      cell.totals.retries += r.retries
      cell.totals.messages += r.messages
    }
    matrix[p] = cell
  }

  const firstOf = (p) => cellOfScenario(matrix[p], scenarios)
  const intrusionOf = Object.fromEntries(protocols.map((p) => [p, firstOf(p)?.intrusion ?? 0]))
  const isolationOf = Object.fromEntries(protocols.map((p) => [p, firstOf(p)?.isolation === true]))
  const minIntrusion = Math.min(...protocols.map((p) => intrusionOf[p]))

  const trilemma = {}
  for (const p of protocols) {
    const rows = Object.values(matrix[p].scenarios)
    trilemma[p] = {
      noBlock: rows.every((r) => r.blocked === 0),
      noDirty: rows.every((r) => r.dirty === 0),
      lowIntrusion: intrusionOf[p] === minIntrusion,
    }
    matrix[p].intrusion = intrusionOf[p]
    matrix[p].isolation = isolationOf[p]
    matrix[p].trilemma = trilemma[p]
  }

  const sc = (p, id) => matrix[p].scenarios[id]
  const twoPcBlocksOnCoordinatorDown = (sc('2PC', 'coordinatorDown')?.blocked ?? 0) > 0
  const sagaLeaksDirtyOnCompensateFail = (sc('Saga', 'compensateFail')?.dirty ?? 0) > 0
  const sagaNeverBlocks = Object.values(matrix.Saga.scenarios).every((r) => r.blocked === 0)
  const tccSelfHealsConfirm = (sc('TCC', 'confirmFlaky')?.retries ?? 0) > 0 && sc('TCC', 'confirmFlaky')?.committed === true
  const tccMostIntrusive = intrusionOf.TCC > intrusionOf.Saga && intrusionOf.Saga > intrusionOf['2PC']
  // 三难向量三者互不相同（真区分度判据：rigged 抹掉故障后 Saga/TCC 退化为同一条 ⇒ 翻红、可证伪、非恒真）。
  const vecOf = (p) => `${Number(trilemma[p].noBlock)}${Number(trilemma[p].noDirty)}${Number(trilemma[p].lowIntrusion)}`
  const vectors = protocols.map(vecOf)
  const trilemmaDistinguishes = new Set(vectors).size === protocols.length
  // 没有一个协议三条全 ✓（各有软肋）。
  const noProtocolWinsAll = !protocols.some((p) => trilemma[p].noBlock && trilemma[p].noDirty && trilemma[p].lowIntrusion)

  const verdict = {
    twoPcBlocksOnCoordinatorDown,
    sagaLeaksDirtyOnCompensateFail,
    sagaNeverBlocks,
    tccSelfHealsConfirm,
    tccMostIntrusive,
    twoPcAndTccIsolated: isolationOf['2PC'] === true && isolationOf.TCC === true && isolationOf.Saga === false,
    trilemmaDistinguishes,
    noProtocolWinsAll,
    noUniversalWinner: twoPcBlocksOnCoordinatorDown && sagaLeaksDirtyOnCompensateFail &&
      tccSelfHealsConfirm && tccMostIntrusive && trilemmaDistinguishes && noProtocolWinsAll,
  }

  return {
    generator: 'caesura-distributed-txn/compare',
    protocols,
    scenarios: scenarios.map((s) => ({ id: s.id, label: s.label, fault: s.fault || {} })),
    trilemmaVectors: Object.fromEntries(protocols.map((p) => [p, vecOf(p)])),
    matrix,
    verdict,
  }
}

function cellOfScenario(cell, scenarios) {
  if (!scenarios.length) return null
  return cell.scenarios[scenarios[0].id] || null
}

/* ============================================================
 * ⑤ 判词探针 / study / snapshot / CLI
 * ============================================================ */

/** 2PC 幂等探针：重复 commit 不重复记账、提交后 rollback 被拒（线性状态机）。 */
function idempotencyProbe(opts = {}) {
  const m = createTwoPhaseCommit({ participants: opts.participants, now: opts.now })
  m.prepare()
  const a = m.commit()
  const b = m.commit()          // 幂等重放
  const c = m.rollback()        // 提交后再回滚：拒绝
  return {
    firstCommitted: a.committed === true,
    replayIdempotent: b.idempotent === true && b.messages === 0,
    messagesFirst: a.messages, messagesReplay: b.messages,
    rollbackAfterCommitRejected: c.aborted === false,
    stats: m.stats(),
  }
}

/** Saga 逆序补偿探针：n 步在第 n 步失败 ⇒ 补偿顺序应为 [n-2 … 0]（严格逆序）。 */
function sagaOrderProbe(opts = {}) {
  const steps = namesOf(opts.sagaSteps, DTX_DEFAULTS.sagaSteps)
  const m = createSaga({ steps, now: opts.now })
  const r = m.run({ failAtStep: steps.length - 1 })
  const expected = steps.slice(0, -1).map((_, i) => i).reverse()
  return {
    compensationOrder: r.compensationOrder || [],
    expected,
    reverseOrder: (r.compensationOrder || []).join(',') === expected.join(','),
    dirtyData: r.dirtyData,
  }
}

/** TCC 幂等重试探针：Confirm 前 n 次失败后重试成功，retries 入账、最终提交、无脏。 */
function tccRetryProbe(opts = {}) {
  const steps = namesOf(opts.tccSteps, DTX_DEFAULTS.tccSteps)
  const m = createTcc({ steps, now: opts.now, maxRetries: opts.maxRetries })
  const times = opts.confirmFailTimes ?? DTX_DEFAULTS.confirmFailTimes
  const r = m.run({ confirmFlakyAt: 0, confirmFailTimes: times })
  return {
    committed: r.committed === true, retries: r.retries, phase: r.phase,
    dirtyData: r.dirtyData, messages: r.messages, stats: m.stats(),
  }
}

/** 汇总成纯数据 study（确定性、无真时钟/socket/磁盘）。 */
export function distributedTxnStudy(opts = {}) {
  const comparison = compareDistributedTxn(opts)
  const idempotency = idempotencyProbe(opts)
  const sagaOrder = sagaOrderProbe(opts)
  const tccRetry = tccRetryProbe(opts)
  return {
    generator: 'caesura-distributed-txn',
    comparison,
    idempotency,
    sagaOrder,
    tccRetry,
    verdict: {
      ...comparison.verdict,
      twoPcCommitIdempotent: idempotency.replayIdempotent,
      sagaCompensatesInReverse: sagaOrder.reverseOrder,
      tccConfirmIdempotentRetry: tccRetry.retries > 0 && tccRetry.committed,
    },
    builtAt: typeof opts.now === 'function' ? opts.now() : Date.now(),
  }
}

/** 把 study 收敛成前端 / status 友好的只读结构（node 侧判词，前端只渲染、不复核、不实测）。 */
export function dtSnapshot(study) {
  if (!study || typeof study !== 'object') return null
  const c = study.comparison
  const rows = c.protocols.map((p) => {
    const m = c.matrix[p]
    return {
      protocol: p, label: m.label, intrusion: m.intrusion, isolation: m.isolation,
      trilemma: m.trilemma, totals: m.totals,
      scenarios: c.scenarios.map((s) => ({ id: s.id, label: s.label, ...m.scenarios[s.id] })),
    }
  })
  return {
    config: { protocols: c.protocols, scenarios: c.scenarios.map((s) => ({ id: s.id, label: s.label })) },
    rows,
    idempotency: study.idempotency,
    sagaOrder: study.sagaOrder,
    tccRetry: study.tccRetry,
    verdict: study.verdict,
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // 注入固定时钟 ⇒ CLI 双跑字节一致；本件是确定性故障场景结构计数、非墙钟跑分，固定 0 基线不影响任何判词。
  const study = distributedTxnStudy({ now: () => 0 })
  const snap = dtSnapshot(study)
  const stateOf = (r) => r.committed ? '成' : r.blocked > 0 ? '阻' : r.dirty > 0 ? '脏' : r.aborted ? '止' : '?'
  const matrix = snap.rows.map((r) => ({
    protocol: r.protocol,
    ladder: snap.config.scenarios.map((s) => s.id + ':' + stateOf(r.scenarios.find((x) => x.id === s.id) || {})).join(' → '),
    totals: r.totals,
    intrusion: r.intrusion,
    isolation: r.isolation,
    trilemma: r.trilemma,
  }))
  console.log(JSON.stringify({
    generator: 'caesura-mvcc-txn→caesura-distributed-txn (KI-506)',
    matrix,
    verdict: study.verdict,
    probes: {
      twoPcIdempotent: study.idempotency.replayIdempotent,
      sagaReverseOrder: study.sagaOrder.reverseOrder,
      tccRetries: study.tccRetry.retries,
    },
  }, null, 2))
}
