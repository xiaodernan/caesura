/** `scripts/spring-load-balancer.mjs` 的声明：Spring Cloud LoadBalancer 客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** 单个负载均衡目标 */
export interface LoadBalancerTarget {
  serviceName: string
  instanceId: string
  host: string
  port: number
  scheme: 'http' | 'https'
  metadata: Record<string, unknown>
}

/** 负载均衡器 */
export interface LoadBalancer {
  serviceName: string
  strategy: 'round-robin' | 'random' | 'weight'
  targets: LoadBalancerTarget[]
  cursor: number
}

/** 构造负载均衡器 */
export function createLoadBalancer(
  serviceName: string,
  instances: any[],
  strategy?: 'round-robin' | 'random' | 'weight',
): LoadBalancer

/** 选择下一个目标实例 */
export function selectTarget(balancer: LoadBalancer): LoadBalancerTarget | null

/** 从 Eureka 查询并选择目标 */
export function selectFromEureka(
  serviceName: string,
  eurekaUrl: string,
  strategy?: 'round-robin' | 'random' | 'weight',
): Promise<LoadBalancerTarget | null>

/** 把目标实例格式化为完整 URL */
export function targetToUrl(target: LoadBalancerTarget, path?: string): string
