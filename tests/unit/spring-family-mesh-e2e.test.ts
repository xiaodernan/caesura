import { describe, expect, it } from 'vitest'
import { runMeshE2E } from '../../scripts/spring-family-mesh-e2e.mjs'

describe('spring-family-mesh-e2e', () => {
  it('e2e：游戏注册成功', async () => {
    const e = runMeshE2E({ transport: async (t: any, p: string) => ({ url: t.url, path: p }) })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
  })

  it('e2e：proxyCall 经网关+负载均衡+熔断调到 caesura-gate 并返回数据', async () => {
    const calls: any[] = []
    const e = runMeshE2E({
      transport: async (t: any, p: string) => { calls.push({ t, p }); return { echo: p } },
    })
    const r = await e.run()
    expect(r.callRes?.ok).toBe(true)
    expect(r.callRes?.result).toEqual({ echo: '/api/health' })
    expect(calls.length).toBe(1)
  })

  it('e2e：mesh 状态含 self/eureka/k8s 三来源服务', async () => {
    const e = runMeshE2E({ transport: async (t: any, p: string) => ({ path: p }) })
    const r = await e.run()
    expect(r.services).toContain('caesura-game') // self
    expect(r.services).toContain('svc-a') // eureka
    expect(r.services).toContain('caesura-gate') // k8s
  })

  it('e2e：调用链追踪产出了 span', async () => {
    const e = runMeshE2E({ transport: async (t: any, p: string) => ({ path: p }) })
    const r = await e.run()
    expect(r.spans.length).toBeGreaterThanOrEqual(1)
    expect(r.spans[0].traceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('e2e：关停后游戏注销', async () => {
    const e = runMeshE2E({ transport: async (t: any, p: string) => ({ path: p }) })
    const r = await e.run()
    expect(r.stopped?.registered).toBe(false)
  })
})
