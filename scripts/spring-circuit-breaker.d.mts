/** `scripts/spring-circuit-breaker.mjs` 的声明：Spring Cloud 熔断器客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** 熔断器状态形状 */
export interface CircuitBreakerState {
  name: string
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  failureRate: number
  failureThreshold: number
  slowCallRate: number
  slowCallRateThreshold: number
  bufferedCalls: number
}

/** 查询单个熔断器状态 */
export function getCircuitBreaker(name: string, gateUrl: string): Promise<CircuitBreakerState>

/** 查询全部熔断器状态 */
export function getCircuitBreakers(gateUrl: string): Promise<CircuitBreakerState[]>
