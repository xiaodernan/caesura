/** `scripts/spring-config-refresh.mjs` 的声明：Spring Cloud 配置刷新综合脚本（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** 刷新指定应用：先拉取配置，再广播 bus-refresh */
export function refreshApp(appName: string, eurekaUrl: string, configUrl: string): Promise<void>

/** 刷新全部应用：列出 Eureka 中的所有应用，逐一刷新 */
export function refreshAll(eurekaUrl: string, configUrl: string): Promise<void>
