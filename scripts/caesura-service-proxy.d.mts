/** `scripts/caesura-service-proxy.mjs` 的声明：服务代理（runtime.call + 内存熔断串联）。 */

export interface ServiceProxyBreakerOptions {
  failureThreshold?: number
  cooldownMs?: number
  halfOpenMax?: number
  windowSize?: number
}

/** 创建一只服务代理。 */
export function createServiceProxy(runtime: any, opts?: { breaker?: ServiceProxyBreakerOptions }): {
  call(serviceName: string, path: string, init?: any): Promise<{ ok: boolean; state: string; result?: any; error?: unknown }>
  breakerFor(serviceName: string): any
  breakers(): string[]
}
