/** `scripts/spring-bus-client.mjs` 的声明：Spring Cloud Bus 客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** Spring Cloud Bus bus-refresh 响应形状 */
export interface BusRefreshResponse {
  timestamp: string
  status: number
  error?: string
  message?: string
  path: string
}

/** 发送 bus-refresh 刷新事件，返回展平后的响应 */
export function busRefresh(serviceName: string | null, configUrl?: string): Promise<BusRefreshResponse>
