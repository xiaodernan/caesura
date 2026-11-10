import { describe, expect, it } from 'vitest'
import { createCloudRuntime } from '../../scripts/caesura-cloud-runtime.mjs'

function fakeCloud() {
  const published: Array<[string, ...unknown[]]> = []
  return {
    published,
    async request(svc: string, path: string, init?: any) { return { svc, path, init } },
    async publish(event: string, ...args: unknown[]) { published.push([event, ...args]); return { ok: true } },
    subscribe() { return () => {} },
    async status() { return { ok: true } },
  }
}

const sources = {
  eureka: () => [
    { id: 'svc-a:1', name: 'svc-a', address: '10.0.0.1', port: 8080, healthy: true },
    { id: 'svc-a:2', name: 'svc-a', address: '10.0.0.2', port: 8080, healthy: true },
  ],
}

describe('caesura-cloud-runtime', () => {
  it('bootstrap 注册游戏并广播 lifecycle:started 与 runtime:booted', async () => {
    const cloud = fakeCloud()
    const rt = createCloudRuntime({ cloud, sources, gameId: 'g1', gamePort: 7700 })
    await rt.bootstrap()
    expect(cloud.published.some(([e, p]) => e === 'caesura.lifecycle' && (p as any)?.type === 'game.started')).toBe(true)
    expect(cloud.published.some(([e]) => e === 'caesura.runtime.booted')).toBe(true)
  })

  it('mesh 聚合了注入源与 self', async () => {
    const rt = createCloudRuntime({ sources, gameId: 'g1', gamePort: 7700 })
    const agg = await rt.mesh.aggregate()
    expect(agg.has('svc-a')).toBe(true)
    expect(agg.has('caesura-game')).toBe(true)
  })

  it('loadBalancerFor 从聚合实例建出负载均衡器', async () => {
    const rt = createCloudRuntime({ sources, gameId: 'g1', gamePort: 7700 })
    const lb = await rt.loadBalancerFor('svc-a')
    expect(lb.targets.length).toBe(2)
  })

  it('call 经负载均衡后交给 transport，返回选中实例', async () => {
    const cloud = fakeCloud()
    const calls: any[] = []
    const rt = createCloudRuntime({
      cloud, sources, gameId: 'g1', gamePort: 7700,
      transport: async (t: any, p: string) => { calls.push({ t, p }); return { echo: p } },
    })
    const res = await rt.call('svc-a', '/ping')
    expect(res.ok).toBe(true)
    expect(calls.length).toBe(1)
    expect(calls[0].t.serviceName).toBe('svc-a')
    expect(res.data).toEqual({ echo: '/ping' })
  })

  it('call 无实例返回 ok:false', async () => {
    const rt = createCloudRuntime({ sources, gameId: 'g1', gamePort: 7700 })
    const res = await rt.call('svc-missing', '/x')
    expect(res.ok).toBe(false)
    expect(res.error).toBeInstanceOf(Error)
  })

  it('shutdown 注销游戏并广播 lifecycle:stopped 与 runtime:stopped', async () => {
    const cloud = fakeCloud()
    const rt = createCloudRuntime({ cloud, sources, gameId: 'g1', gamePort: 7700 })
    await rt.bootstrap()
    await rt.shutdown()
    expect(cloud.published.some(([e, p]) => e === 'caesura.lifecycle' && (p as any)?.type === 'game.stopped')).toBe(true)
    expect(cloud.published.some(([e]) => e === 'caesura.runtime.stopped')).toBe(true)
  })

  it('status 汇总服务与路由数', async () => {
    const rt = createCloudRuntime({ sources, gameId: 'g1', gamePort: 7700 })
    const s = await rt.status()
    expect(s.services).toContain('svc-a')
    expect(s.routeCount).toBe(0)
  })
})
