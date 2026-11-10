/** `scripts/spring-eureka-client.mjs` 的声明：Spring Cloud Eureka 客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** Eureka 单个实例的精简视图 */
export interface EurekaInstance {
  instanceId: string
  hostName: string
  ipAddr: string
  port: number
  status: string
  homePageUrl?: string
}

/** 查询指定应用的所有实例 */
export function getInstances(appName: string, eurekaUrl?: string): Promise<EurekaInstance[]>

/** 查询全部已注册应用名 */
export function getAppNames(eurekaUrl?: string): Promise<string[]>
