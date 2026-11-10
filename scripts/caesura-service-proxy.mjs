/**
 * scripts/caesura-service-proxy.mjs —— 服务代理：把 runtime.call（负载均衡选实例）与进程内熔断串成韧性调用链路。
 *
 * <p>判词仍由 Node 侧持有（决策原则①）：代理只负责「选好实例后，用熔断包住这次调用」，不写任何业务阈值。
 * 与 `spring-cloud-openfeign-client`（声明式客户端）形成互补：本件是「带熔断的运行期调用」，Feign 是「声明式契约」。</p>
 */
import { createCircuitBreaker } from './spring-resilience-breaker.mjs'

/**
 * 创建一只服务代理。
 * @param {object} runtime 含 `call(serviceName, path, init)` 的运行时（如 caesura-cloud-runtime）
 * @param {object} [opts] { breaker?: { failureThreshold, cooldownMs, halfOpenMax, windowSize } }
 */
export function createServiceProxy(runtime, opts = {}) {
  const breakers = new Map()

  /** 按服务名取（或建）一只熔断器，服务间相互隔离。 */
  function breakerFor(serviceName) {
    if (!breakers.has(serviceName)) {
      breakers.set(serviceName, createCircuitBreaker(serviceName, opts.breaker ?? {}))
    }
    return breakers.get(serviceName)
  }

  /**
   * 带熔断地调用目标服务。
   * @returns {Promise<{ok:boolean, state:string, result?:any, error?:unknown}>}
   */
  async function call(serviceName, path, init = {}) {
    const breaker = breakerFor(serviceName)
    return breaker.run(async () => {
      const res = await runtime.call(serviceName, path, init)
      if (!res.ok) throw res.error ?? new Error(`call to ${serviceName} failed`)
      return res.data
    })
  }

  return { call, breakerFor, breakers: () => [...breakers.keys()] }
}
