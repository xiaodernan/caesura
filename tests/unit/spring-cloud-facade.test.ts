import { describe, expect, it, vi } from 'vitest'
import { createCloud } from '../../scripts/spring-cloud-facade.mjs'

/**
 * CaesuraCloud 统一门面单元测试（headless 可证，注入假子客户端）。
 */
describe('spring-cloud-facade (CaesuraCloud)', () => {
  it('默认内存 discovery + roundRobin + 熔断闭合 → request 路由到实例', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve('{}') } as Response)
    const cloud = createCloud({ fetch: fetchImpl })
    cloud.discovery.register({ name: 'items', address: '10.0.0.5', port: 8080 })
    const res = await cloud.request('items', '/health')
    expect((fetchImpl.mock.calls[0][0] as string)).toBe('http://10.0.0.5:8080/health')
    expect(res.ok).toBe(true)
  })

  it('无实例抛错', async () => {
    const cloud = createCloud({ fetch: vi.fn() })
    await expect(cloud.request('ghost', '/x')).rejects.toThrow(/没有可用/)
  })

  it('熔断打开 → request 直接抛错，不发起请求', async () => {
    const fetchImpl = vi.fn()
    const cloud = createCloud({
      fetch: fetchImpl,
      circuit: { isOpen: () => Promise.resolve(true), snapshot: () => ({ ghost: 'OPEN' }) },
    })
    cloud.discovery.register({ name: 'ghost', address: '1.1.1.1', port: 1 })
    await expect(cloud.request('ghost', '/x')).rejects.toThrow(/熔断/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('publish/subscribe 经 stream', async () => {
    const cloud = createCloud()
    const got: any[] = []
    cloud.subscribe('ev', (e: any) => { got.push(e.message) })
    await cloud.publish('ev', { v: 1 })
    expect(got).toEqual([{ v: 1 }])
  })

  it('status 聚合', async () => {
    const cloud = createCloud()
    cloud.discovery.register({ name: 'a', address: '1.1.1.1', port: 1 })
    const s = await cloud.status()
    expect(s.services).toContain('a')
    expect(s.gateway).toBe(true)
  })

  it('注入真实子客户端：request 走 load-balancer choose', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve('{}') } as Response)
    const choose = vi.fn().mockReturnValue({ address: '9.9.9.9', port: 7777 })
    const cloud = createCloud({ fetch: fetchImpl, loadBalancer: { choose } })
    cloud.discovery.register({ name: 'svc', address: '1.1.1.1', port: 1 })
    await cloud.request('svc', '/p')
    expect(choose).toHaveBeenCalledWith([{ name: 'svc', address: '1.1.1.1', port: 1 }])
    expect((fetchImpl.mock.calls[0][0] as string)).toBe('http://9.9.9.9:7777/p')
  })
})
