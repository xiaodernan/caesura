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

/**
 * 启动配置文件监听器。
 * 启动时先给现存文件登记 mtime（不吐事件）；之后只对真的变了的文件触发。
 * 提供 `bus` 时，每次检测到变更都向总线发布 `config.changed`（载荷：appName, config）。
 *
 * @param configs 配置映射（变更时会被直接修改）
 * @param dir 配置目录路径
 * @param interval 检查间隔（毫秒）
 * @param onChange 配置变更回调 (appName, config) => void
 * @param bus 可选的 Spring Cloud Bus 事件总线（spring-bus-event.mjs 的 createBus()）
 * @returns 停止监听的函数
 */
export function startConfigWatcher(
  configs: Record<string, Record<string, unknown>>,
  dir: string,
  interval?: number,
  onChange?: (name: string, config: Record<string, unknown>) => void,
  bus?: { publish(event: string, ...args: unknown[]): boolean },
): () => void
