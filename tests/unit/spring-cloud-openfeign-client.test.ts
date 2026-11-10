import { describe, expect, it, vi } from 'vitest'
import { defineClient } from '../../scripts/spring-cloud-openfeign-client.mjs'

/**
 * Spring Cloud OpenFeign 声明式 REST 客户端单元测试（headless 可证，mock fetch）。
 */
function mockFetch(json: any, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: 'X',
    text: () => Promise.resolve(JSON.stringify(json)),
  } as Response)
}

describe('spring-cloud-openfeign-client', () => {
  it('baseUrl / spec 必填', () => {
    expect(() => defineClient(null as any, {})).toThrow()
    expect(() => defineClient('http://x', null as any)).toThrow()
  })

  it('GET 调端点：路径参数替换 + query', async () => {
    const fetchImpl = mockFetch({ id: '7', name: 'a' })
    const c = defineClient('http://svc/', { getOne: { method: 'GET', path: '/items/{id}' } }, { fetch: fetchImpl })
    const r = await c.getOne({ id: '7', sort: 'asc' })
    expect(r).toEqual({ id: '7', name: 'a' })
    const called = fetchImpl.mock.calls[0][0] as string
    expect(called).toContain('/items/7')
    expect(called).toContain('sort=asc')
  })

  it('POST 带 body', async () => {
    const fetchImpl = mockFetch({ ok: true }, 201)
    const c = defineClient('http://svc', { create: { method: 'POST', path: '/items' } }, { fetch: fetchImpl })
    await c.create({}, { name: 'z' })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ name: 'z' }))
  })

  it('非 2xx 抛带 status 的错', async () => {
    const fetchImpl = mockFetch({ msg: 'nope' }, 404)
    const c = defineClient('http://svc', { getOne: { method: 'GET', path: '/x' } }, { fetch: fetchImpl })
    await expect(c.getOne()).rejects.toMatchObject({ status: 404 })
  })

  it('接 load-balancer choose 选实例', async () => {
    const fetchImpl = mockFetch({ ok: 1 })
    const choose = vi.fn().mockResolvedValue({ address: '10.0.0.5', port: 9090 })
    const c = defineClient('http://fallback', { getOne: { method: 'GET', path: '/x', service: 'items' } }, { fetch: fetchImpl, choose })
    await c.getOne()
    expect(choose).toHaveBeenCalledWith('items')
    expect((fetchImpl.mock.calls[0][0] as string)).toContain('10.0.0.5:9090')
  })

  it('choose 返回空抛错', async () => {
    const fetchImpl = mockFetch({})
    const c = defineClient('http://fb', { getOne: { method: 'GET', path: '/x', service: 'items' } }, { fetch: fetchImpl, choose: () => null })
    await expect(c.getOne()).rejects.toThrow(/没有可用/)
  })

  it('fetch 网络失败被包装', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const c = defineClient('http://svc', { getOne: { method: 'GET', path: '/x' } }, { fetch: fetchImpl })
    await expect(c.getOne()).rejects.toThrow(/ECONNREFUSED/)
  })
})
