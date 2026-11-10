/** `scripts/spring-gateway-filter-handlers.mjs` 的声明：Spring Cloud Gateway 三只内置 filter handler（KI-486）。 */

export interface FilterHandlerStats {
  circuitBreaker: number
  retries: number
  rateLimited: number
  passed: number
  buckets: string[]
}

export function createFilterHandlers(opts?: {
  breakerFor?: (name: string) => any
  breakerOpts?: { failureThreshold?: number; cooldownMs?: number; halfOpenMax?: number; windowSize?: number }
  sleep?: (ms: number) => Promise<any>
  now?: () => number
}): {
  handlers: Record<string, (args: any, ctx: any, next: () => Promise<any>) => Promise<any>>
  stats(): FilterHandlerStats
  reset(): void
}
