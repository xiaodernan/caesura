/** `scripts/caesura-auth-guard.mjs` 的声明：游戏鉴权守卫（集大成 P7 扩展 / KI-485 + KI-490 在线校验）。 */

export interface OnlineVerdict {
  ok: boolean
  source: 'local' | 'introspection'
  claims?: any
  reason?: string
  degraded?: boolean
  error?: unknown
  introspection?: any
}

export interface OnlineAuthOptions {
  introspectionUrl?: string
  fetch?: (url: string, init?: any) => Promise<any>
  activeField?: string
  scopeField?: string
  policy?: 'fail-open' | 'fail-closed'
  requiredScopes?: string[]
}

export function createAuthGuard(opts?: {
  requiredScopes?: string[]
}): {
  requiredScopes: string[]
  authenticate(bearer: string): any
  authorizeOnline(bearer: string, callOpts?: OnlineAuthOptions): Promise<OnlineVerdict>
  requireScope(claims: any, scope: string): boolean
  canAccess(claims: any, scope: string): boolean
  decode(token: string): any
  hasScope(claims: any, scope: string): boolean
  isExpired(claims: any, now?: number): boolean
  introspectToken(token: string, url: string, opts?: any): Promise<any>
}
