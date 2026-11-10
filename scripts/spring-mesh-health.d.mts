/** `scripts/spring-mesh-health.mjs` 的声明：Spring Cloud 服务网格健康聚合器（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** 单个服务的健康状态 */
export interface ServiceHealth {
  name: string
  instanceCount: number
  healthyCount: number
  unhealthyCount: number
  instances: Array<{
    instanceId: string
    host: string
    port: number
    status: string
    healthy: boolean
  }>
}

/** 探单个实例的健康状态 */
export function probeInstanceHealth(
  host: string,
  port: number,
  contextPath?: string,
): Promise<{ status: string; healthy: boolean }>

/** 聚合单个服务的健康状态 */
export function aggregateServiceHealth(
  serviceName: string,
  instances: Array<{ instanceId: string; host: string; port: number }>,
): Promise<ServiceHealth>

/** 聚合全部服务的健康状态 */
export function aggregateMeshHealth(eurekaUrl: string): Promise<ServiceHealth[]>

/** 打印健康聚合报告 */
export function printMeshHealthReport(healths: ServiceHealth[]): void
