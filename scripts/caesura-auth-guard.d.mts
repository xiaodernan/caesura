/** `scripts/caesura-auth-guard.mjs` 的声明：游戏鉴权守卫（集大成 P7 扩展）。 */

export function createAuthGuard(opts?: {
  requiredScopes?: string[]
}): {
  requiredScopes: string[]
  authenticate(bearer: string): any
  requireScope(claims: any, scope: string): boolean
  canAccess(claims: any, scope: string): boolean
  decode(token: string): any
  hasScope(claims: any, scope: string): boolean
  isExpired(claims: any, now?: number): boolean
  introspectToken(token: string, url: string, opts?: any): Promise<any>
}
