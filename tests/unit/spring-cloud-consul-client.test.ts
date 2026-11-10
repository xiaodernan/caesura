import { describe, expect, it, vi } from 'vitest'
import { createConsulClient } from '../../scripts/spring-cloud-consul-client.mjs'

/**
 * Spring Cloud Consul 服务发现客户端单元测试（headless 可证，内存模式 + mock fetch）。
 */
describe('spring-cloud-consul-client', () => {
  it('内存模式 register/discover/health', async () => {
    const c = createConsulClient({ inMemory: true })
    const r = await c.register({ name: 'items', address: '10.0.0.1', port: 8080 })
    expect(r.stored).toBe('memory')
    const found = await c.discover('items')
    expect(found).toHaveLength(1)
    expect(found[0].address).toBe('10.0.0.1')
    const h = await c.health('items')
    expect(h[0].healthy).toBe(true)
  })

  it('deregister 移除实例', async () => {
    const c = createConsulClient({ inMemory: true })
    const r = await c.register({ name: 'items', address: '10.0.0.1', port: 8080 })
    await c.deregister(r.id)
    expect(await c.discover('items')).toHaveLength(0)
  })

  it('discover 未知服务返回空', async () => {
    const c = createConsulClient({ inMemory: true })
    expect(await c.discover('nope')).toEqual([])
  })

  it('register 非法抛错', async () => {
    const c = createConsulClient({ inMemory: true })
    await expect(c.register({ name: 'x' } as any)).rejects.toThrow()
  })

  it('真实 fetch 路径：register 走 consul API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response)
    const c = createConsulClient({ address: 'http://consul:8500', fetch: fetchImpl })
    await c.register({ name: 'g', address: '1.2.3.4', port: 9 })
    expect((fetchImpl.mock.calls[0][0] as string)).toContain('/v1/agent/service/register')
  })

  it('真实 fetch 路径：discover 映射 Service 字段', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve([{ Service: { ID: 'g-1-1', Service: 'g', Address: '1.1.1.1', Port: 1234 } }]),
    } as Response)
    const c = createConsulClient({ address: 'http://consul:8500', fetch: fetchImpl })
    const found = await c.discover('g')
    expect(found[0].address).toBe('1.1.1.1')
    expect(found[0].port).toBe(1234)
  })
})
