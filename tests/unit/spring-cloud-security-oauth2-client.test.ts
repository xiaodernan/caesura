import { describe, expect, it, vi } from 'vitest'
import { decodeJwt, hasScope, isExpired, authorize, introspectToken } from '../../scripts/spring-cloud-security-oauth2-client.mjs'

/**
 * Spring Cloud Security OAuth2 Resource Server 客户端单元测试（headless 可证）。
 */
function makeJwt(claims: any): string {
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`
}

describe('spring-cloud-security-oauth2-client', () => {
  it('decodeJwt 解析 payload', () => {
    const c = decodeJwt(makeJwt({ sub: 'u1', scope: 'read write' }))
    expect(c.sub).toBe('u1')
    expect(c.scope).toBe('read write')
  })

  it('decodeJwt 畸形抛错', () => {
    expect(() => decodeJwt('notajwt')).toThrow()
  })

  it('hasScope 兼容数组/字符串', () => {
    expect(hasScope({ scope: 'read write' }, 'write')).toBe(true)
    expect(hasScope({ scopes: ['read', 'write'] }, 'read')).toBe(true)
    expect(hasScope({ scope: 'read' }, 'write')).toBe(false)
    expect(hasScope(null, 'x')).toBe(false)
  })

  it('isExpired', () => {
    expect(isExpired({ exp: Math.floor((Date.now() - 1000) / 1000) })).toBe(true)
    expect(isExpired({ exp: Math.floor((Date.now() + 100000) / 1000) })).toBe(false)
    expect(isExpired({})).toBe(false)
  })

  it('authorize 通过带作用域', () => {
    const claims = authorize(`Bearer ${makeJwt({ sub: 'u', scope: 'game:play', exp: Math.floor((Date.now() + 1000) / 1000) })}`, { requiredScopes: ['game:play'] })
    expect(claims.sub).toBe('u')
  })

  it('authorize 缺 Bearer 抛错', () => {
    expect(() => authorize('tokenonly')).toThrow(/Bearer/)
  })

  it('authorize 过期抛错', () => {
    expect(() => authorize(`Bearer ${makeJwt({ exp: 1 })}`)).toThrow(/过期/)
  })

  it('authorize 缺作用域抛错', () => {
    expect(() => authorize(`Bearer ${makeJwt({ scope: 'read', exp: Math.floor((Date.now() + 1000) / 1000) })}`, { requiredScopes: ['admin'] })).toThrow(/作用域/)
  })

  it('introspectToken 调端点', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ active: true, sub: 'u' }),
    } as Response)
    const r = await introspectToken('tok', 'http://auth/introspect', { fetch: fetchImpl })
    expect(r.active).toBe(true)
  })
})
