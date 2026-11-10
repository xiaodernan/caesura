/** `scripts/spring-cloud-security-oauth2-client.mjs` 的声明：OAuth2 Resource Server 客户端（Node.js 侧）。 */

/** 解码 JWT payload（不验签）。 */
export function decodeJwt(token: string): any

/** scope 归一：兼容字符串（空格分隔）与数组。 */
export function normalizeScopes(scope: string | string[] | undefined | null): string[]

/** 声明是否含某作用域。 */
export function hasScope(claims: any, scope: string): boolean

/** 是否过期（exp 以秒计）。 */
export function isExpired(claims: any, now?: number): boolean

/** 校验 Bearer 令牌：解析 + 过期 + 必需作用域。 */
export function authorize(bearer: string, opts?: { requiredScopes?: string[] }): any

/** 走 introspection 端点校验。 */
export function introspectToken(token: string, introspectionUrl: string, opts?: { fetch?: typeof fetch }): Promise<any>
