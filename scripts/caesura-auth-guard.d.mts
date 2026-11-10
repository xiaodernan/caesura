/** `scripts/caesura-auth-guard.mjs` 的声明：游戏鉴权守卫（集大成 P7 / KI-485 + KI-490 在线校验 + KI-493 缓存）。 */

export interface OnlineVerdict {
  ok: boolean
  source: 'local' | 'introspection' | 'cache'
  claims?: any
  reason?: string
  degraded?: boolean
  error?: unknown
  introspection?: any
  cacheHit?: boolean
}

export interface OnlineAuthOptions {
  introspectionUrl?: string
  fetch?: (url: string, init?: any) => Promise<any>
  activeField?: string
  scopeField?: string
  policy?: 'fail-open' | 'fail-closed'
  requiredScopes?: string[]
  /** KI-493：逐调用缓存（缺省用构造 opts.cache）；须有 get/set 两方法。 */
  cache?: { get(k: string): any; set(k: string, v: any, ttlMs?: number): any }
  cacheTtlMs?: number
  negativeTtlMs?: number
}

export interface GuardCacheOptions {
  cache?: { get(k: string): any; set(k: string, v: any, ttlMs?: number): any; stats?(): any }
  cacheTtlMs?: number
  negativeTtlMs?: number
}

/** 把令牌确定性哈希成缓存 key（FNV-1a 32 位），不落令牌明文。 */
export function tokenCacheKey(token: string): string

export function createAuthGuard(opts?: {
  requiredScopes?: string[]
  cache?: { get(k: string): any; set(k: string, v: any, ttlMs?: number): any; stats?(): any }
  cacheTtlMs?: number
  negativeTtlMs?: number
}): {
  requiredScopes: string[]
  authenticate(bearer: string): any
  authorizeOnline(bearer: string, callOpts?: OnlineAuthOptions): Promise<OnlineVerdict>
  cacheStats(): any | null
  requireScope(claims: any, scope: string): boolean
  canAccess(claims: any, scope: string): boolean
  decode(token: string): any
  hasScope(claims: any, scope: string): boolean
  isExpired(claims: any, now?: number): boolean
  introspectToken(token: string, url: string, opts?: any): Promise<any>
}
