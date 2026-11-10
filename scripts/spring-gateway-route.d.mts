/** `scripts/spring-gateway-route.mjs` 的声明：Spring Cloud Gateway 路由客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** Gateway 路由定义形状 */
export interface GatewayRoute {
  id: string
  uri: string
  order: number
  predicates: Array<{ name: string; args: Record<string, unknown> }>
  filters: Array<{ name: string; args: Record<string, unknown> }>
}

/** 查询指定路由定义 */
export function getRoute(routeId: string, gatewayUrl: string): Promise<GatewayRoute>

/** 查询全部路由定义 */
export function getRoutes(gatewayUrl: string): Promise<GatewayRoute[]>
