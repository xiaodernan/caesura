/** `scripts/spring-gateway-matcher.mjs` 的声明：Spring Cloud Gateway predicate 求值 + filter 链执行（Node.js 侧）。 */

export interface GatewayRequest {
  path: string
  method?: string
  headers?: Record<string, string>
}

export interface GatewayPredicate {
  name: string
  args?: Record<string, unknown>
}

export interface GatewayMatcherOptions {
  weightSelector?: (ctx: { group: string; path: string }) => number
}

/** 创建一只网关匹配器。 */
export function createGatewayMatcher(opts?: GatewayMatcherOptions): {
  evaluatePredicate(pred: GatewayPredicate, req: GatewayRequest): boolean
  matchRoute(table: any, req: GatewayRequest): { route: any; matched: Array<{ name: string; matched: boolean }> } | null
  planFilters(route: any): Array<{ name: string; args: any }>
  runWithFilters(route: any, ctx: any, handlers?: Record<string, (args: any, ctx: any, next: () => Promise<any>) => any>): Promise<any>
}
