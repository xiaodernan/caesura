/**
 * scripts/spring-gateway-filter-handlers.mjs —— Spring Cloud Gateway 内置 filter handler（Node.js 侧，KI-486/492）。
 *
 * <p>家族既有 `spring-gateway-route`（路由表）与 `spring-gateway-matcher`（predicate 求值 + 可重入 filter 链）
 * 只提供「链」，但没有一只现成的 handler 可执行——`runWithFilters` 的 handlers 全靠调用方临时写。本件补齐
 * Spring Cloud Gateway / Resilience4j 最常用的进程内 filter：</p>
 *
 * <ul>
 *   <li><b>CircuitBreaker</b>（KI-486）：包 `spring-resilience-breaker` 的进程内熔断，按 args.name 隔离；</li>
 *   <li><b>Retry</b>（KI-486）：失败重试 ≤ attempts 次，靠 `runWithFilters` 的可重入 `next` 真重跑下游；</li>
 *   <li><b>RateLimit</b>（KI-486）：令牌桶限流，超限抛 `rate_limited`，按 args.key 隔离桶；</li>
 *   <li><b>Bulkhead</b>（KI-492）：并发舱壁，按 args.key 隔离信号量子，maxConcurrent 满即拒/排队，控的是 in-flight 并发；</li>
 *   <li><b>TimeLimiter</b>（KI-492）：调用超时，Promise.race(next, timer) 到点抛 `time_limiter_timeout`。</li>
 * </ul>
 *
 * <p>判词仍由 Node 侧持有（决策原则①）：所有阈值（attempts / capacity / refillPerSec / maxConcurrent /
 * maxWaitMs / timeoutMs / breaker 阈值）一律由 args / opts 注入，本件只做状态机与计数，不写任何业务判定。
 * 与真 Resilience4j / Redis 无桥接。</p>
 */
import { createCircuitBreaker } from './spring-resilience-breaker.mjs'

/**
 * 创建网关 filter handler 的集合。
 * @param {object} [opts]
 * @param {(name:string)=>any} [opts.breakerFor] 按名取熔断器的工厂（缺省内部按 name 缓存 createCircuitBreaker）
 * @param {object} [opts.breakerOpts] 传给默认熔断器的阈值
 * @param {(ms:number)=>Promise<any>} [opts.sleep] Retry 退避等待 / Bulkhead 排队 poll（可注入免真实等待）
 * @param {()=>number} [opts.now] 单调时钟（Bulkhead 等待计时，可注入免真实时钟）
 * @returns {{ handlers: Record<string,Function>, stats: () => object, reset: () => void }}
 */
export function createFilterHandlers(opts = {}) {
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : (ms) => new Promise((r) => setTimeout(r, ms))
  const nowMs = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const breakerOpts = opts.breakerOpts ?? {}
  const ownBreakers = new Map()
  const breakerFor = typeof opts.breakerFor === 'function'
    ? opts.breakerFor
    : (name) => {
        if (!ownBreakers.has(name)) ownBreakers.set(name, createCircuitBreaker(name, breakerOpts))
        return ownBreakers.get(name)
      }

  // 计数器：供调用方 / E2E 读数证明某只 filter 真被触发（不是"配了但没跑"）。
  const counters = {
    circuitBreaker: 0, retries: 0, rateLimited: 0, passed: 0,
    bulkheadRejected: 0, bulkheadWaitTimedOut: 0, bulkheadHeld: 0, timedOut: 0,
  }
  const buckets = new Map() // key -> { tokens, lastRefillMs }
  const semaphores = new Map() // key -> { held, waiters:Array<{resolve,reject,deadlineMs}> }

  /** CircuitBreaker：把下游 next 包进进程内熔断，失败达阈值后 OPEN 直接拒绝。 */
  async function CircuitBreaker(args, ctx, next) {
    counters.circuitBreaker += 1
    const name = args?.name ?? ctx?.serviceName ?? 'default'
    const r = await breakerFor(name).run(() => next())
    if (!r.ok) throw r.error
    return r.result
  }

  /** Retry：失败重跑下游至多 attempts 次；可重入 next 保证每次都是真执行。 */
  async function Retry(args, ctx, next) {
    const attempts = Math.max(1, Number(args?.attempts ?? 3))
    const backoffMs = Math.max(0, Number(args?.backoffMs ?? 0))
    let last = null
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await next()
        counters.retries += i // 成功前失败重试了 i 次（首趟不算重试）
        counters.passed += 1
        return res
      } catch (error) {
        last = error
        if (backoffMs > 0 && i < attempts - 1) await sleep(backoffMs)
      }
    }
    counters.retries += attempts - 1
    throw last
  }

  /** RateLimit：令牌桶。每 key 一只桶，capacity 容量、refillPerSec  refill 速率；桶空抛 rate_limited。 */
  async function RateLimit(args, ctx, next) {
    const key = String(args?.key ?? ctx?.serviceName ?? 'default')
    const capacity = Math.max(1, Number(args?.capacity ?? 10))
    const refillPerSec = Math.max(0, Number(args?.refillPerSec ?? capacity))
    const tick = nowMs()
    let bucket = buckets.get(key)
    if (!bucket) { bucket = { tokens: capacity, lastRefillMs: tick }; buckets.set(key, bucket) }

    const elapsedSec = Math.max(0, (tick - bucket.lastRefillMs) / 1000)
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec)
      bucket.lastRefillMs = tick
    }
    if (bucket.tokens < 1) {
      counters.rateLimited += 1
      const err = new Error('rate_limited')
      err.key = key
      throw err
    }
    bucket.tokens -= 1
    counters.passed += 1
    return next()
  }

  /**
   * Bulkhead（KI-492）：并发舱壁。按 args.key 隔离信号量子，控的是**同时在途的 in-flight 调用数**
   * （与 RateLimit 控「单位时间请求数」正交）。持位期间 await next()，finally 必归还并唤醒队首。
   * 满位时 maxWaitMs<=0 立即抛 bulkhead_full；>0 则 FIFO 轮询等待（sleep 可注入 ⇒ 无真实等待），
   * 超 maxWaitMs 抛 bulkhead_full 并标 bulkheadWaitTimedOut。
   */
  function semaphoreFor(key) {
    if (!semaphores.has(key)) semaphores.set(key, { held: 0, waiters: [] })
    return semaphores.get(key)
  }
  /** 归还一票；队首的等待循环 poll 到空位会自行抢票（只有队首有资格，天然 FIFO）。 */
  function release(key) {
    const sem = semaphores.get(key)
    if (sem) sem.held = Math.max(0, sem.held - 1)
  }
  async function Bulkhead(args, ctx, next) {
    const key = String(args?.key ?? ctx?.serviceName ?? 'default')
    const maxConcurrent = Math.max(1, Number(args?.maxConcurrent ?? 10))
    const maxWaitMs = Math.max(0, Number(args?.maxWaitMs ?? 0))
    const sem = semaphoreFor(key)
    const full = () => sem.held >= maxConcurrent || sem.waiters.length > 0 // 有队列时新来者必须排到队尾，不准插队

    // 抢票：空位且无队列 ⇒ 直接持票；否则按 maxWaitMs 决定立即拒 / FIFO 排队。
    if (full() && maxWaitMs <= 0) {
      counters.bulkheadRejected += 1
      const err = new Error('bulkhead_full')
      err.key = key
      throw err
    }
    if (full()) {
      const ticket = { id: Symbol('waiter') }
      sem.waiters.push(ticket)
      const deadlineMs = nowMs() + maxWaitMs
      try {
        // 只有队首能在有空位时抢票；其余 poll 等待。sleep/now 可注入 ⇒ 无真实等待、可确定性测 FIFO/超时。
        while (sem.waiters[0] !== ticket || sem.held >= maxConcurrent) {
          if (nowMs() >= deadlineMs) {
            counters.bulkheadRejected += 1
            counters.bulkheadWaitTimedOut += 1
            const err = new Error('bulkhead_full')
            err.key = key
            err.waitTimedOut = true
            throw err
          }
          await sleep(Math.min(5, Math.max(1, deadlineMs - nowMs())))
        }
        // 原子交接：仍在队首时就先占住空位再离队，杜绝新来者在「离队↔持票」的空隙插队超限。
        sem.held += 1
      } finally {
        const i = sem.waiters.indexOf(ticket)
        if (i >= 0) sem.waiters.splice(i, 1) // 抢到票 / 超时 都离队，队尾补上
      }
    } else {
      sem.held += 1
    }
    counters.bulkheadHeld += 1
    try {
      return await next()
    } finally {
      release(key) // 无论成功/抛错都归还，避免舱壁被泄漏的 in-flight 永久占满
    }
  }

  /**
   * TimeLimiter（KI-492）：调用超时。Promise.race(next(), timer)；到点抛 time_limiter_timeout 并标 timedOut。
   * <p>不取消底层 in-flight 调用（Promise 无法取消）——给仍在跑的 next() 挂 `.catch(()=>{})` 防超时后
   * 它再 reject 变成 unhandledRejection；timer 只在 next() 先赢时 clear，超时那趟本就烧完。</p>
   */
  async function TimeLimiter(args, ctx, next) {
    const timeoutMs = Math.max(0, Number(args?.timeoutMs ?? 1000))
    const work = Promise.resolve().then(() => next())
    work.catch(() => {}) // 超时后 work 若再 reject，已有消费者，不会 unhandled
    let timer = null
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        counters.timedOut += 1
        const err = new Error('time_limiter_timeout')
        err.timeoutMs = timeoutMs
        reject(err)
      }, timeoutMs)
    })
    try {
      return await Promise.race([work, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return {
    handlers: { CircuitBreaker, Retry, RateLimit, Bulkhead, TimeLimiter },
    stats: () => ({
      ...counters,
      buckets: [...buckets.keys()],
      bulkheadActive: [...semaphores.entries()].reduce((m, [k, s]) => { m[k] = s.held; return m }, {}),
    }),
    reset() {
      counters.circuitBreaker = 0
      counters.retries = 0
      counters.rateLimited = 0
      counters.passed = 0
      counters.bulkheadRejected = 0
      counters.bulkheadWaitTimedOut = 0
      counters.bulkheadHeld = 0
      counters.timedOut = 0
      buckets.clear()
      semaphores.clear()
      for (const b of ownBreakers.values()) b.reset()
    },
  }
}
