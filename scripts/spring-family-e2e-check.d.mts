/** `scripts/spring-family-e2e-check.mjs` 的声明：Spring Cloud 家族端到端验收器。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。
 */

/** 六件的启动次序 */
export const START_ORDER: readonly string[]
/** 各服务的 jar 相对路径 */
export const JAR_PATHS: ReadonlyMap<string, string>
/** 端口名册 */
export const SERVICE_PORTS: ReadonlyMap<string, number>
/** 各服务健康 URL */
export const HEALTH_URLS: ReadonlyMap<string, string>
/** gate/report 的 fail-fast 配置来源 URL（config server 供出的 caesura-gates 名册） */
export const CONFIG_ROSTER_URL: string
/** 探针表（PROBES[i] = { name, url, expect, retries? }） */
export const PROBES: ReadonlyArray<{
  name: string
  url: string
  expect: string | { jsonPath: readonly string[]; equals?: unknown }
  retries?: number
}>

/** 一条探针的判读（纯函数） */
export function probeMatches(
  body: unknown,
  expect: string | { jsonPath: readonly string[]; equals?: unknown },
): boolean

/** 把「前提全对不对」判成一串问题（纯函数） */
export function preconditionFindings(input: {
  javaOk: boolean
  jars: Record<string, boolean>
  portsBusy: readonly string[]
}): string[]

/** TCP 端口探测（connect 成功=忙） */
export function portBusyViaConnect(timeoutMs?: number): Promise<string[]>
