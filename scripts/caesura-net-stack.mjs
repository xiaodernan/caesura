/**
 * scripts/caesura-net-stack.mjs —— 计网协议栈教学件（P8 第二件，KI-494）。
 *
 * <p>把 RFC 里天天在跑、却在本仓零建模的网络算法，做成零依赖、可注入时钟/随机、可确定性测的纯状态机：
 * TCP Reno/CUBIC 拥塞控制、Jacobson RTO 估计 + Karn 算法、滑动窗口 + 选择性 ACK、
 * QUIC 0-RTT 会话恢复 + 防重放、HTTP stale-while-revalidate + ETag 条件请求。</p>
 *
 * <p>判定权仍在 Node 侧（决策原则①）：所有阈值（ssthresh/α/β/C/TTL/replay 窗/maxAge）
 * 一律 opts 注入，本件只跑状态机与给读数，不写业务判定、不发包、不建连。与真 socket / 浏览器
 * HTTP 缓存无桥接——这是可断言的算法层，不是协议实现。</p>
 *
 * 六只工厂（各自独立、互不耦合）：
 *   createAimdCongestion / createCubicCongestion / createRtoEstimator /
 *   createSlidingWindow / createSessionTickets / createHttpCache
 */

/* ============================ ① Reno AIMD 拥塞控制 ============================ */

/**
 * Reno 风格 AIMD：慢启动指数增 → 到 ssthresh 转拥塞避免加性增；3 重传 ACK 快重传（乘性减）、
 * 超时慢启动重启（cwnd 回 1）。单位统一是 MSS 个数（拥塞窗口以段计）。
 * @param {object} [opts]
 * @param {number} [opts.initialCwnd=1] 初始拥塞窗口（MSS）
 * @param {number} [opts.ssthresh=16] 慢启动阈值（MSS）
 * @param {number} [opts.minCwnd=1] 快重传/超时的 cwnd 下限
 * @param {number} [opts.dupAckThreshold=3] 触发快重传的重复 ACK 数
 */
export function createAimdCongestion(opts = {}) {
  let cwnd = Math.max(1, Number(opts.initialCwnd ?? 1))
  let ssthresh = Math.max(1, Number(opts.ssthresh ?? 16))
  const minCwnd = Math.max(1, Number(opts.minCwnd ?? 1))
  const dupAckThreshold = Math.max(1, Number(opts.dupAckThreshold ?? 3))
  let mode = cwnd < ssthresh ? 'slow-start' : 'congestion-avoidance'
  const dupAcks = { count: 0 }
  const history = [{ event: 'init', cwnd, ssthresh, mode }]

  /** 收到一个**新** ACK：慢启动 +1（指数），拥塞避免 +1/cwnd（加性）。 */
  function onAck() {
    dupAcks.count = 0 // 新 ACK 清零重复计数
    if (mode === 'slow-start') {
      cwnd += 1
      if (cwnd >= ssthresh) mode = 'congestion-avoidance'
    } else {
      cwnd += 1 / cwnd // AIMD 的「加性增」
    }
    history.push({ event: 'ack', cwnd, ssthresh, mode })
    return cwnd
  }

  /** 收到一个重复 ACK；累计到 dupAckThreshold 触发一次快重传（乘性减、不回 1）。 */
  function onDupAck() {
    dupAcks.count += 1
    if (dupAcks.count >= dupAckThreshold) {
      ssthresh = Math.max(minCwnd, cwnd / 2)
      cwnd = ssthresh // fast recovery 简化：直接落到新阈值
      mode = 'congestion-avoidance'
      const fired = dupAcks.count
      dupAcks.count = 0
      history.push({ event: 'fast-retransmit', cwnd, ssthresh, mode, dupAcks: fired })
      return { fastRetransmit: true, cwnd, ssthresh }
    }
    return { fastRetransmit: false, cwnd, ssthresh, dupAcks: dupAcks.count }
  }

  /** 超时：ssthresh=cwnd/2、cwnd 回 1，重进慢启动（Reno 对丢包最保守的一条）。 */
  function onTimeout() {
    ssthresh = Math.max(minCwnd, cwnd / 2)
    cwnd = minCwnd
    mode = 'slow-start'
    dupAcks.count = 0
    history.push({ event: 'timeout', cwnd, ssthresh, mode })
    return { cwnd, ssthresh }
  }

  function state() {
    return { cwnd, ssthresh, mode, dupAcks: dupAcks.count, history: [...history] }
  }

  return { onAck, onDupAck, onTimeout, state, get cwnd() { return cwnd }, get ssthresh() { return ssthresh }, get mode() { return mode } }
}

/* ============================ ② CUBIC 拥塞控制 ============================ */

/**
 * CUBIC 风格窗口：W(t) = C·(t−K)³ + Wmax，其中 K = cbrt(Wmax·(1−β)/C)，t 为
 * **自上次拥塞事件起**的可注入时钟秒数。以 AIMD 加性下界取 max，保证至少不比 Reno 差；
 * 凸（远离 Wmax 时加速）/凹（逼近 Wmax 时放缓）两段是 CUBIC 区别于 Reno 的判词。
 * @param {object} [opts]
 * @param {number} [opts.Wmax=16] 上次拥塞时的窗口峰值（MSS）
 * @param {number} [opts.C=0.4] CUBIC 缩放系数（RFC 常见 0.4，可注入）
 * @param {number} [opts.beta=0.2] 乘性减因子（RFC 常见 0.2，可注入）
 * @param {number} [opts.initialCwnd=1] 起始窗口
 * @param {() => number} [opts.now] 时钟（秒；缺省单调自增的「每 ACK 一刻度」）
 */
export function createCubicCongestion(opts = {}) {
  const C = Math.max(1e-6, Number(opts.C ?? 0.4))
  const beta = Math.min(1, Math.max(0, Number(opts.beta ?? 0.2)))
  const minCwnd = Math.max(1, Number(opts.initialCwnd ?? 1))
  const injectedNow = typeof opts.now === 'function' ? opts.now : null
  let tick = 0
  const nowSec = () => (injectedNow ? Number(injectedNow()) : tick)
  let Wmax = Math.max(minCwnd, Number(opts.Wmax ?? 16))
  let cwnd = minCwnd
  let epochStart = nowSec() // 上次拥塞/起始时刻
  // K = cbrt(Wmax·β/C)：取 β 为「乘性减掉的份额」，则降窗后 cwnd=(1−β)·Wmax，
  // 而 W(0)=Wmax−C·K³=Wmax−Wmax·β=(1−β)·Wmax，两条恰好对齐（epoch 起点目标=降窗后实际窗口）。
  let K = Math.cbrt((Wmax * beta) / C)

  /** 目标窗口 W(t)（纯函数读数，不推进状态）。 */
  function targetAt(tSec) {
    const t = Math.max(0, Number(tSec) - epochStart)
    return Math.max(minCwnd, C * Math.pow(t - K, 3) + Wmax)
  }

  /** 收到 ACK：推进一刻度（无注入时钟时），cwnd = max(CUBIC 目标, AIMD 下界 cwnd+1/cwnd)。 */
  function onAck() {
    if (!injectedNow) tick += 1
    const aimdFloor = cwnd + 1 / cwnd
    cwnd = Math.max(targetAt(nowSec()), aimdFloor)
    return cwnd
  }

  /** 拥塞事件：记录新的 Wmax 与 epoch 起点，cwnd 乘性减到 (1−β)·Wmax，并按新 Wmax 重算 K。 */
  function onCongestion() {
    Wmax = cwnd
    cwnd = Math.max(minCwnd, (1 - beta) * Wmax)
    K = Math.cbrt((Wmax * beta) / C)
    epochStart = nowSec()
    if (!injectedNow) tick += 1
    return { cwnd, Wmax, K, epochStart }
  }

  function state() {
    return { cwnd, Wmax, K, C, beta, epochStart, elapsed: nowSec() - epochStart }
  }

  return { onAck, onCongestion, targetAt, state, get cwnd() { return cwnd }, get Wmax() { return Wmax }, get K() { return K } }
}

/* ============================ ③ RTO 估计（Jacobson + Karn） ============================ */

/**
 * RTO 估计：SRTT/RTTVAR 指数平滑（α=1/8、β=1/4 可注入）、RTO=SRTT+4·RTTVAR、
 * 超时指数退避钳到 maxRto。Karn 算法：**重传段的 RTT 样本不参与估计**（无时间戳时不拿
 * 模糊样本污染 RTO），只回报 `ignored:true` 给调用方。
 * @param {object} [opts]
 * @param {number} [opts.alpha=0.125] SRTT 平滑因子
 * @param {number} [opts.beta=0.25] RTTVAR 平滑因子
 * @param {number} [opts.minRto=200] RTO 下限 ms
 * @param {number} [opts.maxRto=60000] RTO 上限 ms
 * @param {number} [opts.initialRto=1000] 首个 RTO（无样本时）
 */
export function createRtoEstimator(opts = {}) {
  const alpha = Number(opts.alpha ?? 0.125)
  const beta = Number(opts.beta ?? 0.25)
  const minRto = Math.max(1, Number(opts.minRto ?? 200))
  const maxRto = Math.max(minRto, Number(opts.maxRto ?? 60000))
  let srtt = null
  let rttvar = null
  let rto = Math.min(maxRto, Math.max(minRto, Number(opts.initialRto ?? 1000)))
  let timeouts = 0
  let ignoredSamples = 0

  const clamp = (x) => Math.min(maxRto, Math.max(minRto, x))

  /**
   * 喂一个 RTT 样本（ms）。`retransmitted=true` 时按 Karn 直接忽略、不动估计。
   * @returns {{used:boolean, ignored:boolean, srtt:number|null, rttvar:number|null, rto:number}}
   */
  function sample(rttMs, retransmitted = false) {
    if (retransmitted) {
      ignoredSamples++
      return { used: false, ignored: true, srtt, rttvar, rto } // Karn：不拿它估
    }
    const r = Math.max(0, Number(rttMs))
    if (srtt === null) {
      // RFC 6298 首个样本：SRTT=R、RTTVAR=R/2
      srtt = r
      rttvar = r / 2
    } else {
      rttvar = (1 - beta) * rttvar + beta * Math.abs(srtt - r)
      srtt = (1 - alpha) * srtt + alpha * r
    }
    rto = clamp(srtt + 4 * rttvar)
    timeouts = 0 // 收到非重传 ACK ⇒ 退避复位（链路恢复）
    return { used: true, ignored: false, srtt, rttvar, rto }
  }

  /** 超时：RTO 翻倍（指数退避）、钳到 maxRto。 */
  function onTimeout() {
    timeouts++
    rto = clamp(rto * 2)
    return { rto, timeouts }
  }

  function current() {
    return { srtt, rttvar, rto, timeouts, ignoredSamples, minRto, maxRto }
  }

  return { sample, onTimeout, current, get rto() { return rto }, get srtt() { return srtt }, get ignoredSamples() { return ignoredSamples } }
}

/* ============================ ④ 滑动窗口 + 选择性 ACK ============================ */

/**
 * 发送侧滑动窗口：累计 ACK 推进 `base`，并接受**选择性 ACK**（乱序确认落在 sack 集合，
 * base 只推进到连续确认的最前边界）。窗口满时 `send()` 返回 blocked，做流量控制。
 * @param {object} [opts]
 * @param {number} [opts.windowSize=4] 窗口大小（在途未确认段上限）
 */
export function createSlidingWindow(opts = {}) {
  const windowSize = Math.max(1, Number(opts.windowSize ?? 4))
  let base = 0 // 最旧未确认序号
  let next = 0 // 下一个可发序号
  const sack = new Set() // 已确认但非连续的序号
  const inFlightSeqs = new Map() // seq -> 载荷（供重传读数）
  let sends = 0
  let blocked = 0
  let cumAcks = 0

  /** 发一段；窗口满返回 {sent:false,reason:'window_full'}，否则分配序号并入在途。 */
  function send(payload) {
    if (next - base >= windowSize) {
      blocked++
      return { sent: false, reason: 'window_full', base, next, windowSize }
    }
    const seq = next++
    inFlightSeqs.set(seq, payload)
    sends++
    return { sent: true, seq, payload }
  }

  /**
   * 确认一段。`cumulative=true`（默认）表示累计 ACK：推进 base 到连续已确认处，并清掉
   * 已被覆盖的 sack；`cumulative=false` 记为选择性 ACK（乱序），base 视连续性推进。
   */
  function ack(seq, cumulative = true) {
    const s = Number(seq)
    if (cumulative) {
      cumAcks++
      if (s >= base) {
        // 清掉 <= s 的 sack，再把 base 推到「下一个未确认」处（可能跨过先前的选择性确认）。
        for (const x of [...sack]) if (x <= s) sack.delete(x)
        let b = Math.max(base, s + 1)
        while (sack.has(b)) { sack.delete(b); b++ }
        base = b
      }
    } else {
      // 选择性 ACK：只有落在在途区间 [base, next) 的序号才记入。
      // 若恰好确认队首 ⇒ 推进 base，并连带吞掉其后已被选择性确认的连续段；否则进 sack 集合。
      if (s >= base && s < next) {
        if (s === base) {
          base++
          while (sack.has(base)) { sack.delete(base); base++ }
        } else {
          sack.add(s)
        }
      }
    }
    for (const x of [...inFlightSeqs.keys()]) if (x < base) inFlightSeqs.delete(x)
    return { base, next, sack: [...sack].sort((a, b) => a - b), inFlight: inFlightSeqs.size }
  }

  function state() {
    return { base, next, windowSize, inFlight: inFlightSeqs.size, sack: [...sack].sort((a, b) => a - b), sends, blocked, cumAcks }
  }

  return { send, ack, state, get inFlight() { return inFlightSeqs.size }, get base() { return base }, get windowSize() { return windowSize } }
}

/* ============================ ⑤ QUIC 0-RTT 会话票据 + 防重放 ============================ */

/**
 * QUIC/QUIC 风格 0-RTT：服务端发票据（签发时刻+TTL+唯一 nonce），客户端在有效期内、
 * 且该 nonce 从未被用过（防重放集合）才准 0-RTT；过期或重放退 1-RTT。
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=90000] 票据有效期（QUIC 常见量级，可注入）
 * @param {number} [opts.replayWindowMs=120000] 防重放集合里 nonce 的保留窗
 * @param {() => number} [opts.now]
 * @param {() => string} [opts.nonce] 唯一 nonce 生成器（缺省递增序号）
 */
export function createSessionTickets(opts = {}) {
  const ttlMs = Math.max(0, Number(opts.ttlMs ?? 90_000))
  const replayWindowMs = Math.max(0, Number(opts.replayWindowMs ?? 120_000))
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const nonceGen = typeof opts.nonce === 'function' ? opts.nonce : (() => { let n = 0; return () => `n${++n}` })()
  /** nonce -> 使用时刻（防重放集合） */
  const seen = new Map()
  let issued = 0
  let accepted0Rtt = 0
  let fellBack1Rtt = 0
  let replayRejected = 0

  /** 发票据给某客户端；票据自带签发时刻与 TTL（判定用服务端时钟，不信任客户端）。 */
  function issue(clientId) {
    issued++
    return { id: `t${issued}`, clientId, issuedAt: now(), ttlMs, nonce: nonceGen() }
  }

  /** 清掉防重放集合里过期的 nonce（超 replayWindowMs 的已无需记着）。 */
  function reapReplay(t) {
    for (const [k, at] of seen) if (t - at > replayWindowMs) seen.delete(k)
  }

  /**
   * 接受一张票据。`isIdempotent=false` 时即便票据有效也退 1-RTT（真实 QUIC 只允许幂等请求 0-RTT，
   * 避免重放造成非幂等副作用）。
   * @returns {{mode:'0-RTT'|'1-RTT', reason?:string, ticket?:object}}
   */
  function accept(ticket, isIdempotent = true) {
    const t = now()
    reapReplay(t)
    if (!ticket || typeof ticket !== 'object') { fellBack1Rtt++; return { mode: '1-RTT', reason: 'no_ticket' } }
    if (t > Number(ticket.issuedAt) + Number(ticket.ttlMs)) { fellBack1Rtt++; return { mode: '1-RTT', reason: 'expired', ticket } }
    if (seen.has(ticket.nonce)) { replayRejected++; fellBack1Rtt++; return { mode: '1-RTT', reason: 'replay', ticket } }
    if (!isIdempotent) { fellBack1Rtt++; return { mode: '1-RTT', reason: 'not_idempotent', ticket } }
    seen.set(ticket.nonce, t)
    accepted0Rtt++
    return { mode: '0-RTT', ticket }
  }

  function stats() {
    return { issued, accepted0Rtt, fellBack1Rtt, replayRejected, replaySetSize: seen.size }
  }

  return { issue, accept, stats, reapReplay }
}

/* ============================ ⑥ HTTP 缓存语义（SWR + ETag） ============================ */

/**
 * HTTP 缓存语义：新鲜度 `maxAge` 判 fresh；`staleWhileRevalidate` 窗口内可回陈旧副本并标
 * `revalidate:true`（stale-while-revalidate）；超窗判 miss；`conditional(key,etag)` 命中回 304。
 * @param {object} [opts]
 * @param {() => number} [opts.now]
 */
export function createHttpCache(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  /** key -> { body, etag, storedAt, maxAgeMs, swrMs } */
  const store = new Map()
  let freshHits = 0
  let staleHits = 0
  let misses = 0
  let notModified = 0

  /**
   * 存一份响应。`maxAgeSec` 为新鲜期、`swrSec` 为「过期后仍可回陈旧」的附加窗，均秒。
   */
  function put(key, body, etag, maxAgeSec, swrSec = 0) {
    store.set(key, {
      body, etag, storedAt: now(),
      maxAgeMs: Math.max(0, Number(maxAgeSec)) * 1000,
      swrMs: Math.max(0, Number(swrSec)) * 1000,
    })
    return { ok: true }
  }

  /**
   * 读：`fresh`（未过 maxAge）/ `stale`（过 maxAge 但仍在 maxAge+swr 内，标需后台回填）/
   * `miss`（超 swr 或无条目）。
   */
  function get(key) {
    const e = store.get(key)
    if (!e) { misses++; return { state: 'miss', body: undefined, revalidate: true } }
    const age = now() - e.storedAt
    if (age < e.maxAgeMs) { freshHits++; return { state: 'fresh', body: e.body, etag: e.etag, age } }
    if (age < e.maxAgeMs + e.swrMs) { staleHits++; return { state: 'stale', body: e.body, etag: e.etag, age, revalidate: true } }
    store.delete(key)
    misses++
    return { state: 'miss', body: undefined, revalidate: true, age }
  }

  /** 条件请求：ETag 相同回 304（无体重用缓存），不同回 200（带新体）。 */
  function conditional(key, requestEtag) {
    const e = store.get(key)
    if (e && e.etag === requestEtag) { notModified++; return { status: 304, body: undefined, etag: e.etag } }
    return { status: 200, body: e?.body, etag: e?.etag }
  }

  function stats() {
    return { freshHits, staleHits, misses, notModified, entries: store.size }
  }

  return { put, get, conditional, stats }
}
