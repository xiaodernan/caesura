/** `scripts/spring-resilience-breaker.mjs` 的声明：Spring Cloud Resilience4j 风格内存熔断器（Node.js 侧）。 */

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface BreakerOptions {
  failureThreshold?: number
  cooldownMs?: number
  halfOpenMax?: number
  windowSize?: number
}

export interface CircuitBreaker {
  run<T>(fn: () => Promise<T> | T): Promise<{ ok: boolean; state: BreakerState; result?: T; error?: unknown }>
  state(): BreakerState
  metrics(): { state: BreakerState; failures: number; successes: number; rejects: number }
  reset(): void
}

/** 创建一只内存熔断器。 */
export function createCircuitBreaker(name: string, opts?: BreakerOptions): CircuitBreaker
