/** `scripts/spring-gateway-filter-handlers.mjs` 的声明：Spring Cloud Gateway 内置 filter handler（KI-486/492）。 */

export interface FilterHandlerStats {
  circuitBreaker: number
  retries: number
  rateLimited: number
  passed: number
  /** KI-492：Bulkhead 满位立即拒次数 */
  bulkheadRejected: number
  /** KI-492：Bulkhead 排队等到超时才拒的次数 */
  bulkheadWaitTimedOut: number
  /** KI-492：Bulkhead 成功持票进入 in-flight 的次数 */
  bulkheadHeld: number
  /** KI-492：TimeLimiter 触发超时的次数 */
  timedOut: number
  buckets: string[]
  /** KI-492：各 key 当前持票（in-flight）数 */
  bulkheadActive: Record<string, number>
}

export function createFilterHandlers(opts?: {
  breakerFor?: (name: string) => any
  breakerOpts?: { failureThreshold?: number; cooldownMs?: number; halfOpenMax?: number; windowSize?: number }
  /** Retry 退避等待 / Bulkhead 排队 poll（可注入免真实等待） */
  sleep?: (ms: number) => Promise<any>
  /** 单调时钟（Bulkhead 等待计时；RateLimit  refill 也用它） */
  now?: () => number
}): {
  /** CircuitBreaker / Retry / RateLimit / Bulkhead / TimeLimiter */
  handlers: Record<string, (args: any, ctx: any, next: () => Promise<any>) => Promise<any>>
  stats(): FilterHandlerStats
  reset(): void
}
