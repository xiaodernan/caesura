/** `scripts/spring-config-server.mjs` 的声明：Spring Cloud Config Server 客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。
 */

/** 创建 Spring Cloud Config Server 实例。 */
export function createServer(configs: Record<string, Record<string, unknown>>): import('http').Server

/** 从配置目录加载所有 YAML/JSON 配置文件。 */
export function loadConfigs(configDir: string): Record<string, Record<string, unknown>>

/** 根据应用名、环境、标签查找配置。 */
export function findConfig(
  appName: string,
  profile: string,
  label: string,
  configs: Record<string, Record<string, unknown>>,
): Record<string, unknown> | undefined

/**
 * 构建 Spring Cloud Config Server 风格的响应体。
 */
export function buildConfigResponse(
  application: string,
  profile: string,
  label: string,
  config: Record<string, unknown>,
): Record<string, unknown>
