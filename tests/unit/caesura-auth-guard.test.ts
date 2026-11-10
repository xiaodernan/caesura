import { describe, expect, it } from 'vitest'
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
})
