import { describe, expect, it, vi } from 'vitest'
import { createVaultClient } from '../../scripts/spring-cloud-vault-client.mjs'

/**
 * Spring Cloud Vault 配置/密钥客户端单元测试（headless 可证，mock fetch）。
 */
describe('spring-cloud-vault-client', () => {
  it('address / token 必填', () => {
    expect(() => createVaultClient({} as any)).toThrow()
    expect(() => createVaultClient({ address: 'x' } as any)).toThrow()
  })

  it('readSecret 解析 data.data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ data: { data: { pw: 's3cr3t' } } }),
    } as Response)
    const v = createVaultClient({ address: 'http://vault:8200', token: 't', fetch: fetchImpl })
    const s = await v.readSecret('secret/app')
    expect(s).toEqual({ pw: 's3cr3t' })
    expect(fetchImpl.mock.calls[0][0]).toBe('http://vault:8200/v1/secret/app')
    expect(fetchImpl.mock.calls[0][1].headers['X-Vault-Token']).toBe('t')
  })

  it('缓存命中直接返回，不发第二次请求', async () => {
    let calls = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls += 1
      return { ok: true, status: 200, json: () => Promise.resolve({ data: { data: { n: calls } } }) } as Response
    })
    const v = createVaultClient({ address: 'http://v', token: 't', fetch: fetchImpl, cacheTtlMs: 100000 })
    const a = await v.readCached('p')
    const b = await v.readCached('p')
    expect(a).toEqual(b)
    expect(calls).toBe(1)
  })

  it('缓存过期后重读', async () => {
    let calls = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls += 1
      return { ok: true, status: 200, json: () => Promise.resolve({ data: { data: { n: calls } } }) } as Response
    })
    const v = createVaultClient({ address: 'http://v', token: 't', fetch: fetchImpl, cacheTtlMs: -1 })
    await v.readCached('p')
    await v.readCached('p')
    expect(calls).toBe(2)
  })

  it('403 标记 tokenExpired', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      json: () => Promise.resolve({}),
    } as Response)
    const v = createVaultClient({ address: 'http://v', token: 't', fetch: fetchImpl })
    let err: any
    try { await v.readSecret('p') } catch (e) { err = e }
    expect(err).toBeTruthy()
    expect(err.tokenExpired).toBe(true)
  })

  it('invalidate 清缓存', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ data: { data: { n: 1 } } }),
    } as Response)
    const v = createVaultClient({ address: 'http://v', token: 't', fetch: fetchImpl, cacheTtlMs: 100000 })
    await v.readCached('p')
    v.invalidate('p')
    await v.readCached('p')
    expect(fetchImpl.mock.calls.length).toBe(2)
  })
})
