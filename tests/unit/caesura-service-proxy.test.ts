import { describe, expect, it } from 'vitest'
import { createCloudRuntime } from '../../scripts/caesura-cloud-runtime.mjs'
import { createServiceProxy } from '../../scripts/caesura-service-proxy.mjs'

function fakeRuntime(ok = true, data: any = { v: 1 }) {
  return {
    async call(_svc: string, _path: string) {
      if (!ok) return { ok: false, error: new Error('boom') }
      return { ok: true, data, error: undefined }
    },
  }
}

function mutableRuntime() {
  let ok = false
  return {
    setOk(v: boolean) { ok = v },
    async call() { return ok ? { ok: true, data: { v: 1 } } : { ok: false, error: new Error('boom') } },
  }
}

describe('caesura-service-proxy', () => {
  it('成功调用返回 breaker 结果并携带数据', async () => {
    const proxy = createServiceProxy(fakeRuntime(true, { v: 7 }))
    const res = await proxy.call('svc-a', '/x')
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ v: 7 })
    expect(res.state).toBe('CLOSED')
  })

  it('运行时失败计入熔断，达到阈值后打开并拒绝', async () => {
    const proxy = createServiceProxy(fakeRuntime(false), { breaker: { failureThreshold: 2, cooldownMs: 50 } })
    const r1 = await proxy.call('svc-a', '/x')
    expect(r1.ok).toBe(false); expect(r1.state).toBe('CLOSED')
    const r2 = await proxy.call('svc-a', '/x')
    expect(r2.ok).toBe(false); expect(r2.state).toBe('OPEN')
    const r3 = await proxy.call('svc-a', '/x')
    expect(r3.ok).toBe(false); expect(r3.state).toBe('OPEN')
    expect((r3.error as Error).message).toBe('circuit_open')
  })

  it('breakerFor 按服务名复用同一熔断器', async () => {
    const proxy = createServiceProxy(fakeRuntime(true))
    const a = proxy.breakerFor('svc-a')
    const b = proxy.breakerFor('svc-a')
    expect(a).toBe(b)
    expect(proxy.breakers()).toContain('svc-a')
  })

  it('熔断打开后冷却成功则回 CLOSED', async () => {
    const rt = mutableRuntime()
    const proxy = createServiceProxy(rt, { breaker: { failureThreshold: 1, cooldownMs: 10 } })
    rt.setOk(false)
    const r1 = await proxy.call('svc-a', '/x') // -> OPEN
    expect(r1.state).toBe('OPEN')
    await new Promise((r) => setTimeout(r, 25)) // 冷却到期
    rt.setOk(true)
    const r2 = await proxy.call('svc-a', '/x') // HALF_OPEN 成功 -> CLOSED
    expect(r2.ok).toBe(true)
    expect(r2.state).toBe('CLOSED')
  })

  it('不同服务名各自独立熔断', async () => {
    const proxy = createServiceProxy(fakeRuntime(false), { breaker: { failureThreshold: 1, cooldownMs: 50 } })
    await proxy.call('svc-a', '/x') // svc-a -> OPEN
    const rb = await proxy.call('svc-b', '/x') // svc-b 首次失败 -> OPEN
    expect(rb.state).toBe('OPEN')
    expect(proxy.breakers().sort()).toEqual(['svc-a', 'svc-b'])
  })

  it('代理与真实 runtime 串联（transport 命中）', async () => {
    const calls: any[] = []
    const rt = createCloudRuntime({
      sources: { eureka: () => [{ id: 'svc-a:1', name: 'svc-a', address: 'h', port: 9, healthy: true }] },
      gameId: 'g', gamePort: 1,
      transport: async (t: any, p: string) => { calls.push({ t, p }); return { hit: p } },
    })
    const proxy = createServiceProxy(rt)
    const res = await proxy.call('svc-a', '/ping')
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ hit: '/ping' })
    expect(calls.length).toBe(1)
  })
})
