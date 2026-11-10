/** `scripts/spring-discovery.mjs` 的声明：Spring Cloud 服务发现与配置综合客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** 单个服务的完整视图：实例 + 配置 */
export interface ServiceView {
  name: string
  instances: Array<{
    instanceId: string
    hostName: string
    ipAddr: string
    port: number
    status: string
  }>
  config: Record<string, unknown>
}

/** 发现指定应用：查实例 + 拉配置，合并输出 */
export function discoverApp(appName: string, eurekaUrl: string, configUrl: string): Promise<ServiceView>

/** 发现全部应用：列出 Eureka 中的所有应用，逐一查实例 + 拉配置 */
export function discoverAll(eurekaUrl: string, configUrl: string): Promise<ServiceView[]>
