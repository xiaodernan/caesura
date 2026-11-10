import { describe, expect, it, vi } from 'vitest'
import { createAuthGuard } from '../../scripts/caesura-auth-guard.mjs'

function makeJwt(claims: any): string {
  const b64 = (obj: any) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`
}

const valid = () => makeJwt({ sub: 'u1', scope: 'game:play', exp: Math.floor(Date.now() / 1000) + 3600 })
const expired = () => makeJwt({ sub: 'u2', scope: 'game:play', exp: Math.floor(Date.now() / 1000) - 10 })

describe('caesura-auth-guard', () => {
  it('authenticate 合法 Bearer 通过并返回 claims', () => {
    const guard = createAuthGuard()
    const claims = guard.authenticate(`Bearer ${valid()}`)
    expect(claims.sub).toBe('u1')
    expect(guard.hasScope(claims, 'game:play')).toBe(true)
  })

  it('authenticate 缺 Bearer 前缀抛错', () => {
    const guard = createAuthGuard()
    expect(() => guard.authenticate('not-a-token')).toThrow()
  })

  it('authenticate 过期令牌抛错', () => {
    const guard = createAuthGuard()
    expect(() => guard.authenticate(`Bearer ${expired()}`)).toThrow(/过期/)
  })

  it('requireScope 缺必需作用域抛错，含域通过', () => {
    const guard = createAuthGuard()
    const claims = guard.authenticate(`Bearer ${valid()}`)
    expect(() => guard.requireScope(claims, 'game:admin')).toThrow(/作用域/)
    expect(guard.requireScope(claims, 'game:play')).toBe(true)
  })

  it('canAccess 布尔判定：含域 true、缺域 false、过期 false', () => {
    const guard = createAuthGuard()
    const claims = guard.authenticate(`Bearer ${valid()}`)
    expect(guard.canAccess(claims, 'game:play')).toBe(true)
    expect(guard.canAccess(claims, 'game:admin')).toBe(false)
    const exp = guard.decode(expired())
    expect(guard.canAccess(exp, 'game:play')).toBe(false)
  })

  // —— KI-490：authorizeOnline（RFC 7662 风格）——
  const introspectFetch = (body: object, ok = true) => async () => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
  }) as any

  it('authorizeOnline 本地快速路径：不配端点时纯本地通过 source=local', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:play'] })
    const v = await guard.authorizeOnline(`Bearer ${valid()}`)
    expect(v).toMatchObject({ ok: true, source: 'local' })
    expect(v.claims.sub).toBe('u1')
  })

  it('authorizeOnline 本地判定不通过时直接拒、不求助网络（畸形/过期/缺域）', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:play'] })
    const fetchSpy = vi.fn(introspectFetch({ active: true }))
    const opts = { introspectionUrl: 'http://idp/introspect', fetch: fetchSpy }
    expect((await guard.authorizeOnline('not-a-bearer', opts)).ok).toBe(false)
    expect((await guard.authorizeOnline(`Bearer ${expired()}`, opts)).reason).toMatch(/过期/)
    expect((await guard.authorizeOnline(`Bearer ${makeJwt({ sub: 'x', scope: 'other', exp: Date.now() / 1000 + 99 })}`, opts)).ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled() // 本地就拒了，没打端点
  })

  it('authorizeOnline 不透明令牌（非 JWT）有端点时穿过本地、交给 introspection 裁决（RFC 7662 主用途）', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:play'] })
    const v = await guard.authorizeOnline('Bearer opaque-random-string', {
      introspectionUrl: 'http://idp/introspect',
      fetch: introspectFetch({ active: true, scope: 'game:play', sub: 'opaque-u', client_id: 'caesura' }),
    })
    expect(v).toMatchObject({ ok: true, source: 'introspection' })
    expect(v.claims.sub).toBe('opaque-u') // 不透明令牌以端点响应为 claims 源
    expect(v.claims.client_id).toBe('caesura')
  })

  it('authorizeOnline 不透明令牌无端点 ⇒ 本地拒（不凭空放行）', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:play'] })
    const v = await guard.authorizeOnline('Bearer opaque-random-string')
    expect(v).toMatchObject({ ok: false, source: 'local' })
  })

  it('authorizeOnline 端点 active:true + 以响应 scope 为准 ⇒ source=introspection 通过', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:play'] })
    const v = await guard.authorizeOnline(`Bearer ${valid()}`, {
      introspectionUrl: 'http://idp/introspect',
      fetch: introspectFetch({ active: true, scope: 'game:play game:admin', sub: 'online' }),
    })
    expect(v.ok).toBe(true)
    expect(v.source).toBe('introspection')
    expect(v.introspection.active).toBe(true)
    expect(v.claims.sub).toBe('u1') // 本地 claims 保留，只用在线 scope 复核，不采信端点自报的 sub
    expect(v.claims.scope).toBe('game:play game:admin') // scope 以在线响应为准
  })

  it('authorizeOnline 端点 active:false ⇒ 拒（令牌已吊销），reason=inactive', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:play'] })
    const v = await guard.authorizeOnline(`Bearer ${valid()}`, {
      introspectionUrl: 'http://idp/introspect',
      fetch: introspectFetch({ active: false }),
    })
    expect(v).toMatchObject({ ok: false, source: 'introspection', reason: 'inactive' })
  })

  it('authorizeOnline 以在线响应 scope 为权威：本地有域但在线收窄 ⇒ 拒 missing_scope', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:admin'] })
    const v = await guard.authorizeOnline(`Bearer ${makeJwt({ sub: 'u', scope: 'game:admin', exp: Date.now() / 1000 + 99 })}`, {
      introspectionUrl: 'http://idp/introspect',
      fetch: introspectFetch({ active: true, scope: 'game:play' }), // 在线只给 play，没 admin
    })
    expect(v).toMatchObject({ ok: false, reason: 'missing_scope:game:admin' })
  })

  it('authorizeOnline 端点不可用：fail-closed 默认拒 / fail-open 降级放行并标 degraded', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:play'] })
    const boom = async () => { throw new Error('ECONNREFUSED') }
    const base = { introspectionUrl: 'http://idp/introspect', fetch: boom }
    const closed = await guard.authorizeOnline(`Bearer ${valid()}`, base)
    expect(closed).toMatchObject({ ok: false, source: 'introspection', degraded: true, reason: 'introspection_unavailable' })
    const opened = await guard.authorizeOnline(`Bearer ${valid()}`, { ...base, policy: 'fail-open' })
    expect(opened).toMatchObject({ ok: true, source: 'local', degraded: true, reason: 'introspection_unavailable' })
  })

  it('authorizeOnline 支持自定义 activeField / scopeField / 每次调用的 requiredScopes', async () => {
    const guard = createAuthGuard({ requiredScopes: ['game:play'] })
    // 令牌本地须先过 game:admin 这道快速路径，才会去端点用自定义字段复核。
    const token = makeJwt({ sub: 'u', scope: 'game:play game:admin', exp: Math.floor(Date.now() / 1000) + 99 })
    const v = await guard.authorizeOnline(`Bearer ${token}`, {
      introspectionUrl: 'http://idp/introspect',
      activeField: 'enabled',
      scopeField: 'authorities',
      requiredScopes: ['game:admin'],
      fetch: introspectFetch({ enabled: true, authorities: ['game:admin'] }),
    })
    expect(v.ok).toBe(true)
    expect(v.source).toBe('introspection')
    expect(v.claims.authorities).toEqual(['game:admin']) // 原字段名保留
  })
})
