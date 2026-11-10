/**
 * scripts/caesura-auth-guard.mjs —— 游戏鉴权守卫（集大成 P7 扩展）。
 *
 * <p>包住 `spring-cloud-security-oauth2-client`，把「Bearer 令牌进来 → 拿 claims → 按作用域把住一道门」
 * 收口成游戏侧可直接用的守卫。判定权仍 Node 侧（必需作用域由调用方注入）。</p>
 *
 * <p>本地路径 `authenticate` 只解析 claims/过期/作用域（不验签，签名归网关/资源服务端）。
 * KI-490 起增加 `authorizeOnline`（RFC 7662 风格）：本地快速路径先跑（畸形/过期/缺域直接拒、不求助网络），
 * 配了 `introspectionUrl` 才走在线 introspection 端点并以其 `active`/scope 为权威；端点不可用时按
 * Node 侧注入的 `policy`（fail-closed 默认拒 / fail-open 降级放行）裁决，绝不把策略写死进本件。</p>
 *
 * <p>用法：
 *   const guard = createAuthGuard({ requiredScopes: ['game:play'] })
 *   const claims = guard.authenticate('Bearer &lt;token&gt;')  // 本地，失败抛错
 *   const verdict = await guard.authorizeOnline('Bearer &lt;token&gt;', {
 *     introspectionUrl: 'http://idp/oauth2/introspect', fetch: myFetch, policy: 'fail-closed',
 *   })  // → { ok, source:'local'|'introspection', claims?, reason?, degraded? }
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
 * @returns {{ requiredScopes: string[], authenticate: (bearer: string) => any, authorizeOnline: (bearer: string, opts?: object) => Promise<{ok:boolean, source:string, claims?:any, reason?:string, degraded?:boolean, error?:unknown}>, requireScope: (claims: any, scope: string) => boolean, canAccess: (claims: any, scope: string) => boolean, decode: (token: string) => any, hasScope: (claims: any, scope: string) => boolean, isExpired: (claims: any, now?: number) => boolean, introspectToken: (token: string, url: string, opts?: any) => Promise<any> }}
 */
export function createAuthGuard(opts = {}) {
  const requiredScopes = [...(opts.requiredScopes ?? [])]

  /** 解析 Bearer 令牌：解析 + 过期 + 必需作用域；失败抛错，通过返回 claims。 */
  function authenticate(bearer) {
    return authorize(bearer, { requiredScopes })
  }

  /**
   * RFC 7662 风格的在线校验（KI-490）。
   *
   * <p>步骤（判定权全在调用方注入的 opts / 构造 requiredScopes）：
   *   ① 本地快速路径 `authenticate`：若令牌**可解析**但过期 / 缺本地作用域 ⇒ 直接 `{ok:false,source:'local'}`，
   *      不把坏令牌送给 IdP；若**不可解析**（不透明令牌，RFC 7662 的主用途）且配了端点 ⇒ 穿过本地、
   *      交给 introspection 裁决（不配端点则照旧本地拒）；
   *   ② 未给 `introspectionUrl` 且本地通过 ⇒ `{ok:true,source:'local'}`（纯本地，向后兼容）；
   *   ③ 给端点 ⇒ `introspectToken`（fetch 可注入）：响应 `active===false` 拒；以其 `scope`（可为数组或
   *      空格串，字段由 `scopeField` 定）为准复核必需作用域；本地已解析过则以本地 claims 为身份源、
   *      仅用在线 scope 复核，不透明令牌则以端点响应为 claims 源；
   *   ④ 端点不可用（网络/非 2xx/非 JSON）⇒ `policy`：'fail-open' 降级放行并标 `degraded:true`，
   *      其余（含缺省 'fail-closed'）拒绝。绝不因为端点挂了就默认放行。</p>
   *
   * @param {string} bearer 形如 `Bearer <token>`
   * @param {{introspectionUrl?:string, fetch?:Function, activeField?:string, scopeField?:string, policy?:'fail-open'|'fail-closed', requiredScopes?:string[]}} [callOpts]
   */
  async function authorizeOnline(bearer, callOpts = {}) {
    const scopes = Array.isArray(callOpts.requiredScopes) ? callOpts.requiredScopes : requiredScopes
    const policy = callOpts.policy ?? 'fail-closed'
    const activeField = callOpts.activeField ?? 'active'
    const scopeField = callOpts.scopeField ?? 'scope'

    const url = callOpts.introspectionUrl
    const token = String(bearer).replace(/^\s*Bearer\s+/i, '')

    // ① 本地快速路径。区分「不可解析的不透明令牌」与「可解析但判定不通过」两种失败。
    let claims = null
    let opaque = false
    try {
      claims = authorize(bearer, { requiredScopes: scopes })
    } catch (e) {
      // 连 Bearer 前缀都没有 ⇒ 协议级畸形，永远本地拒（不是令牌，别往 IdP 送）。
      const hasBearer = /^\s*Bearer\s+\S+/i.test(String(bearer))
      let parseable = false
      try { decodeJwt(token); parseable = true } catch { /* 不透明令牌，不可解析 */ }
      // 可解析却过期/缺域，或无 Bearer 前缀 ⇒ 本地直接拒，不求助网络（防把坏令牌送给 IdP 套信息）。
      // 有 Bearer 前缀 + token 不可解析 + 有端点 ⇒ 视作 RFC 7662 不透明令牌，穿过本地交给 introspection。
      opaque = hasBearer && !parseable
      if (!opaque || !url) return { ok: false, source: 'local', reason: e?.message ?? String(e), error: e }
    }

    // ② 无端点且本地已通过：纯本地通过（保留旧行为）。
    if (!url) return { ok: true, source: 'local', claims }

    // ③ 在线 introspection。
    let response
    try {
      response = await introspectToken(token, url, { fetch: callOpts.fetch })
    } catch (e) {
      // ④ 端点不可用：按 Node 侧策略裁决。
      if (policy === 'fail-open') {
        return { ok: true, source: 'local', claims, degraded: true, reason: 'introspection_unavailable', error: e }
      }
      return { ok: false, source: 'introspection', claims, degraded: true, reason: 'introspection_unavailable', error: e }
    }

    if (response?.[activeField] === false) {
      return { ok: false, source: 'introspection', claims, reason: 'inactive' }
    }
    // 以 introspection 响应的 scope 为权威复核（可能比本地 claims 更新/更窄）。
    // 不透明令牌以端点响应为 claims 源（含 sub 等）；本地已解析过则保留本地 claims、仅归一 scope。
    // 注意：hasScope 只认 claims.scope / claims.scopes 两格，所以自定义 scopeField（如 authorities）
    // 的值必须归一进 scope 那一格才查得到——这里同时保留原字段名供调用方读。
    const scopeValue = response?.[scopeField]
    const baseClaims = opaque ? { ...(response ?? {}) } : { ...claims }
    const introClaims = { ...baseClaims, [scopeField]: scopeValue, scope: scopeValue }
    for (const s of scopes) {
      if (!hasScope(introClaims, s)) {
        return { ok: false, source: 'introspection', claims: introClaims, reason: `missing_scope:${s}` }
      }
    }
    return { ok: true, source: 'introspection', claims: introClaims, introspection: response }
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
    authorizeOnline,
    requireScope,
    canAccess,
    decode: decodeJwt,
    hasScope,
    isExpired,
    introspectToken,
  }
}
