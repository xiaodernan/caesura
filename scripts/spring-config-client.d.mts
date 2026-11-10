/** `scripts/spring-config-client.mjs` 的声明：Spring Cloud Config 客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** Spring Cloud Config Server 的响应形状 */
export interface ConfigServerResponse {
  name: string
  profiles: string[]
  label: string
  version: string
  state: null
  propertySources: Array<{
    name: string
    source: Record<string, unknown>
  }>
}

/** 获取指定应用的配置，返回展平后的键值对 */
export function fetchConfig(appName: string, configUrl?: string): Promise<Record<string, unknown>>
