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

/**
 * 获取指定应用的配置，失败时降级返回 fallback（默认空对象）。
 * 用于 Config Server 不可用时的容灾。
 */
export function fetchConfigWithFallback(
  appName: string,
  configUrl?: string,
  fallback?: Record<string, unknown>,
): Promise<Record<string, unknown>>
