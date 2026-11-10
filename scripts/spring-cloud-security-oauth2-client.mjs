/**
 * scripts/spring-cloud-security-oauth2-client.mjs —— Spring Cloud Security OAuth2 Resource Server 客户端（Node.js 侧）。
 *
 * <p>资源服务器端该做的事：解析 JWT、校验作用域、识别过期、必要时走 introspection 端点。
 * 本门只做这些轻量判定（签名校验交给调用方/网关），阈值（哪个作用域算够）由 Node 侧传入。</p>
 *
 * <p>用法（CLI 仅作探针）：
 *   node scripts/spring-cloud-security-oauth2-client.mjs [jwt-or-bearer]
 *
 * <p>退出码：0 = 解析成功；2 = 参数不对；1 = 解析/校验失败。</p>
 */

/** base64url 解码（Node 全局 Buffer 可用） */
function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64').toString('utf8')
}

/** 解码 JWT payload（不验签）。 */
export function decodeJwt(token) {
  if (typeof token !== 'string') throw new Error('token 必须是字符串')
  const parts = token.split('.')
  if (parts.length < 2) throw new Error('JWT 至少要有 header.payload 两段')
  let claims
  try { claims = JSON.parse(b64urlDecode(parts[1])) } catch { throw new Error('JWT payload 不是合法 JSON') }
  return claims
}

/** scope 归一：兼容字符串（空格分隔）与数组。 */
export function normalizeScopes(scope) {
  if (!scope) return []
  if (Array.isArray(scope)) return scope.map(String)
  return String(scope).split(/\s+/).filter(Boolean)
}

/** 声明是否含某作用域。 */
export function hasScope(claims, scope) {
  if (!claims || !scope) return false
  return normalizeScopes(claims.scope ?? claims.scopes).includes(scope)
}

/** 是否过期（exp 以秒计）。 */
export function isExpired(claims, now = Date.now()) {
  if (!claims || typeof claims.exp !== 'number') return false
  return claims.exp * 1000 <= now
}

/**
 * 校验 Bearer 令牌：解析 + 过期 + 必需作用域。
 * @param {string} bearer 形如 `Bearer <token>`
 * @param {{ requiredScopes?: string[] }} [opts]
 * @returns {any} 通过则返回 claims
 */
export function authorize(bearer, opts = {}) {
  if (!bearer || !/^\s*Bearer\s+/i.test(bearer)) throw new Error('缺少 Bearer 令牌')
  const token = bearer.replace(/^\s*Bearer\s+/i, '')
  let claims
  try { claims = decodeJwt(token) } catch (e) { throw new Error(`令牌解析失败: ${e.message}`) }
  if (isExpired(claims)) throw new Error('令牌已过期')
  for (const s of opts.requiredScopes ?? []) {
    if (!hasScope(claims, s)) throw new Error(`缺少所需作用域 ${s}`)
  }
  return claims
}

/** 走 introspection 端点校验（轻量封装）。 */
export async function introspectToken(token, introspectionUrl, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch
  let res
  try {
    res = await fetchImpl(introspectionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch (e) {
    throw new Error(`introspection 失败: ${e?.message ?? e}`)
  }
  if (!res.ok) throw new Error(`introspection 失败: ${res.status}`)
  return res.json()
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const input = process.argv[2] ?? ''
  const token = input.startsWith('Bearer ') ? input : `Bearer ${input}`
  try {
    const claims = authorize(token)
    console.log(JSON.stringify(claims))
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
