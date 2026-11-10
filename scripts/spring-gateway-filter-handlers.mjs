/**
 * scripts/spring-gateway-filter-handlers.mjs —— Spring Cloud Gateway 三只内置 filter handler（Node.js 侧，KI-486）。
 *
 * <p>家族既有 `spring-gateway-route`（路由表）与 `spring-gateway-matcher`（predicate 求值 + 可重入 filter 链）
 * 只提供「链」，但没有一只现成的 handler 可执行——`runWithFilters` 的 handlers 全靠调用方临时写。本件补齐
 * Spring Cloud Gateway 最常用的三只进程内 filter：</p>
 *
 * <ul>
 *   <li><b>CircuitBreaker</b>：包 `spring-resilience-breaker` 的进程内熔断，按 args.name 隔离；</li>
 *   <li><b>Retry</b>：失败重试 ≤ attempts 次，靠 `runWithFilters` 的可重入 `next` 真重跑下游；</li>
 *   <li><b>RateLimit</b>：令牌桶限流，超限抛 `rate_limited`，按 args.key 隔离桶。</li>
 * </ul>
 *
 * <p>判词仍由 Node 侧持有（决策原则①）：所有阈值（attempts / capacity / refillPerSec / breaker 阈值）一律
 * 由 args / opts 注入，本件只做状态机与计数，不写任何业务判定。与真 Resilience4j / Redis 无桥接。</p>
 */
import { createCircuitBreaker } from './spring-resilience-breaker.mjs'

/**
 * 创建三只网关 filter handler 的集合。
 * @param {object} [opts]
 * @param {(name:string)=>any} [opts.breakerFor] 按名取熔断器的工厂（缺省内部按 name 缓存 createCircuitBreaker）
 * @param {object} [opts.breakerOpts] 传给默认熔断器的阈值
 * @param {(ms:number)=>Promise<any>} [opts.sleep] Retry 退避等待（可注入免真实等待）
 * @returns {{ handlers: Record<string,Function>, stats: () => object, reset: () => void }}
 */
export function createFilterHandlers(opts = {}) {
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : (ms) => new Promise((r) => setTimeout(r, ms))
  const breakerOpts = opts.breakerOpts ?? {}
  const ownBreakers = new Map()
  const breakerFor = typeof opts.breakerFor === 'function'
    ? opts.breakerFor
    : (name) => {
        if (!ownBreakers.has(name)) ownBreakers.set(name, createCircuitBreaker(name, breakerOpts))
        return ownBreakers.get(name)
      }

  // 计数器：供调用方 / E2E 读数证明某只 filter 真被触发（不是"配了但没跑"）。
  const counters = { circuitBreaker: 0, retries: 0, rateLimited: 0, passed: 0 }
  const buckets = new Map() // key -> { tokens, lastRefillMs }

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
    const nowMs = typeof opts.now === 'function' ? opts.now() : Date.now()
    let bucket = buckets.get(key)
    if (!bucket) { bucket = { tokens: capacity, lastRefillMs: nowMs }; buckets.set(key, bucket) }

    const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000)
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec)
      bucket.lastRefillMs = nowMs
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

  return {
    handlers: { CircuitBreaker, Retry, RateLimit },
    stats: () => ({ ...counters, buckets: [...buckets.keys()] }),
    reset() {
      counters.circuitBreaker = 0
      counters.retries = 0
      counters.rateLimited = 0
      counters.passed = 0
      buckets.clear()
      for (const b of ownBreakers.values()) b.reset()
    },
  }
}
