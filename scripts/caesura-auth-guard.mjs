/**
 * scripts/caesura-auth-guard.mjs —— 游戏鉴权守卫（集大成 P7 扩展）。
 *
 * <p>包住 `spring-cloud-security-oauth2-client`，把「Bearer 令牌进来 → 拿 claims → 按作用域把住一道门」
 * 收口成游戏侧可直接用的守卫。判定权仍 Node 侧（必需作用域由调用方注入）。</p>
 *
 * <p>用法：
 *   const guard = createAuthGuard({ requiredScopes: ['game:play'] })
 *   const claims = guard.authenticate('Bearer &lt;token&gt;')  // 失败抛错
 *   guard.requireScope(claims, 'game:play')                  // 缺域/过期抛错
 *   if (guard.canAccess(claims, 'game:play')) { ... }
 * </p>
 */

import {
  decodeJwt,
  hasScope,
  isExpired,
  authorize,
  introspectToken,
} from './spring-cloud-security-oauth2-client.mjs'

/**
 * 创建一只鉴权守卫。
 * @param {{ requiredScopes?: string[] }} [opts]
 * @returns {{ requiredScopes: string[], authenticate: (bearer: string) => any, requireScope: (claims: any, scope: string) => boolean, canAccess: (claims: any, scope: string) => boolean, decode: (token: string) => any, hasScope: (claims: any, scope: string) => boolean, isExpired: (claims: any, now?: number) => boolean, introspectToken: (token: string, url: string, opts?: any) => Promise<any> }}
 */
export function createAuthGuard(opts = {}) {
  const requiredScopes = [...(opts.requiredScopes ?? [])]

  /** 解析 Bearer 令牌：解析 + 过期 + 必需作用域；失败抛错，通过返回 claims。 */
  function authenticate(bearer) {
    return authorize(bearer, { requiredScopes })
  }

  /** 对已有 claims 做「过期 + 必需作用域」三重判定；通过返回 true，否则抛错。 */
  function requireScope(claims, scope) {
    if (!claims) throw new Error('claims 缺失')
    if (isExpired(claims)) throw new Error('令牌已过期')
    if (!hasScope(claims, scope)) throw new Error(`缺少所需作用域 ${scope}`)
    return true
  }

  /** requireScope 的布尔版：不过期且含域才 true。 */
  function canAccess(claims, scope) {
    if (!claims || isExpired(claims)) return false
    return hasScope(claims, scope)
  }

  return {
    requiredScopes,
    authenticate,
    requireScope,
    canAccess,
    decode: decodeJwt,
    hasScope,
    isExpired,
    introspectToken,
  }
}
