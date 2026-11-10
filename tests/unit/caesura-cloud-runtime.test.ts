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

  it('gateway 路由匹配：命中则返回 route 并成功', async () => {
    const calls: any[] = []
    const rt = createCloudRuntime({
      sources, gameId: 'g1', gamePort: 7700, gateway: true,
      transport: async (t: any, p: string) => { calls.push({ t, p }); return { echo: p } },
    })
    rt.routes.add({ id: 'r1', uri: 'lb://svc-a', order: 0, predicates: [{ name: 'Path', args: { patterns: '/api/**' } }], filters: [] })
    const res = await rt.call('svc-a', '/api/ping')
    expect(res.ok).toBe(true)
    expect(res.route?.id).toBe('r1')
    expect(calls.length).toBe(1)
  })

  it('gateway 路由匹配：未命中返回 no_route', async () => {
    const rt = createCloudRuntime({ sources, gameId: 'g1', gamePort: 7700, gateway: true })
    rt.routes.add({ id: 'r1', uri: 'lb://svc-a', order: 0, predicates: [{ name: 'Path', args: { patterns: '/api/**' } }], filters: [] })
    const res = await rt.call('svc-a', '/other/x')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('no_route')
  })

  it('tracer：call 起 span 并把 traceparent 注入传输头', async () => {
    const rt = createCloudRuntime({
      sources, gameId: 'g1', gamePort: 7700, tracer: true,
      transport: async (t: any, p: string, init: any) => { return { tp: init?.headers?.['traceparent'], p } },
    })
    const res = await rt.call('svc-a', '/ping')
    expect(res.ok).toBe(true)
    expect(res.span).toBeTruthy()
    expect(res.span.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(res.data.tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('gateway Retry filter：transport 先失败两次后成功 ⇒ call 成功且真重试 3 趟、filterStats.retries=2（KI-487）', async () => {
    let tries = 0
    const rt = createCloudRuntime({
      sources, gameId: 'g1', gamePort: 7700, gateway: true,
      transport: async () => { tries += 1; if (tries < 3) throw new Error(`fail#${tries}`); return { ok: 'finally' } },
    })
    rt.routes.add({
      id: 'r1', uri: 'lb://svc-a', order: 0,
      predicates: [{ name: 'Path', args: { patterns: '/api/**' } }],
      filters: [{ name: 'Retry', args: { attempts: 3 } }],
    })
    const res = await rt.call('svc-a', '/api/x')
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ ok: 'finally' })
    expect(tries).toBe(3)
    expect(res.filterStats.retries).toBe(2)
    expect(res.filterStats.passed).toBe(1)
  })

  it('gateway RateLimit filter：令牌桶容量耗尽后 call 以 rate_limited 拒绝（KI-487）', async () => {
    const rt = createCloudRuntime({
      sources, gameId: 'g1', gamePort: 7700, gateway: true,
      transport: async () => 'served',
    })
    rt.routes.add({
      id: 'r1', uri: 'lb://svc-a', order: 0,
      predicates: [{ name: 'Path', args: { patterns: '/api/**' } }],
      filters: [{ name: 'RateLimit', args: { capacity: 1, refillPerSec: 0 } }],
    })
    const r1 = await rt.call('svc-a', '/api/x')
    const r2 = await rt.call('svc-a', '/api/x')
    expect(r1.ok).toBe(true)
    expect(r1.data).toBe('served')
    expect(r2.ok).toBe(false)
    expect((r2.error as Error).message).toBe('rate_limited')
    expect(r2.filterStats.rateLimited).toBe(1)
  })

  it('runtime 暴露 filters 包，stats 可读且可注入自定义 handler 覆盖内置（KI-487）', async () => {
    let customRuns = 0
    const rt = createCloudRuntime({
      sources, gameId: 'g1', gamePort: 7700, gateway: true,
      filterHandlers: { Echo: async (_a: any, _c: any, next: () => Promise<any>) => { customRuns += 1; return `echo:${await next()}` } },
      transport: async () => 'raw',
    })
    expect(rt.filters).toBeTruthy()
    expect(typeof rt.filters.stats).toBe('function')
    rt.routes.add({
      id: 'r1', uri: 'lb://svc-a', order: 0,
      predicates: [{ name: 'Path', args: { patterns: '/api/**' } }],
      filters: [{ name: 'Echo', args: {} }],
    })
    const res = await rt.call('svc-a', '/api/x')
    expect(res.ok).toBe(true)
    expect(res.data).toBe('echo:raw')
    expect(customRuns).toBe(1)
  })

  it('gateway CircuitBreaker filter：transport 多次失败则熔断打开并拒绝', async () => {
    let attempts = 0
    const rt = createCloudRuntime({
      sources, gameId: 'g1', gamePort: 7700, gateway: true, breakerOpts: { failureThreshold: 1, cooldownMs: 50 },
      transport: async () => { attempts++; throw new Error('boom') },
    })
    rt.routes.add({
      id: 'r1', uri: 'lb://svc-a', order: 0,
      predicates: [{ name: 'Path', args: { patterns: '/api/**' } }],
      filters: [{ name: 'CircuitBreaker', args: { name: 'svc-a' } }],
    })
    const r1 = await rt.call('svc-a', '/api/x')
    expect(r1.ok).toBe(false)
    const r2 = await rt.call('svc-a', '/api/x')
    expect(r2.ok).toBe(false)
    expect((r2.error as Error).message).toBe('circuit_open')
  })

  // —— KI-491：灰度/金丝雀加权路由接进运行时 ——
  const graySources = {
    graySrc: () => [
      { id: 'stable:1', name: 'gray-svc', address: '10.0.1.1', port: 8080, healthy: true, metadata: { version: 'v1', weight: 1 } },
      { id: 'can:1', name: 'gray-svc', address: '10.0.1.2', port: 8080, healthy: true, metadata: { version: 'v2', canary: true, weight: 1 } },
    ],
  }

  it('KI-491① metadata 保真 + lbStrategy=weight：实例权重/meta 不再被丢光', async () => {
    const rt = createCloudRuntime({ sources: graySources, lbStrategy: 'weight', gameId: 'g1', gamePort: 7700 })
    const lb = await rt.loadBalancerFor('gray-svc')
    expect(lb.strategy).toBe('weight')
    expect(lb.targets).toHaveLength(2)
    expect(lb.targets[1].metadata).toMatchObject({ version: 'v2', canary: true, weight: 1 }) // 灰度元数据进得了 LB
    expect(lb.targets[0].metadata.healthy).toBe(true)
  })

  it('KI-491② 配 gray：canaryPercent=100 + canaryValue=v2 ⇒ call 命中金丝雀池、回带 gray 判词', async () => {
    const hits: string[] = []
    const rt = createCloudRuntime({
      sources: graySources, gameId: 'g1', gamePort: 7700,
      gray: { canaryPercent: 100, grayField: 'version', canaryValue: 'v2', stickyHeader: 'x-player', selector: () => 0 },
      transport: async (t: any) => { hits.push(t.instanceId); return { ok: true } },
    })
    const r = await rt.call('gray-svc', '/api/fight', { headers: { 'x-player': 'p42' } })
    expect(r.ok).toBe(true)
    expect(r.gray).toMatchObject({ lane: 'canary', fallback: false, key: 'p42', canaryPercent: 100 })
    expect(hits).toEqual(['can:1'])
    expect((await rt.status()).gray.stats.canary).toBe(1) // status 暴露灰度计数
  })

  it('KI-491③ 空金丝雀池诚实回退稳定池 + 未配 gray 逐字维持 round-robin', async () => {
    const onlyStable = {
      graySrc: () => [{ id: 'stable:1', name: 'gray-svc', address: '10.0.1.1', port: 8000, healthy: true, metadata: {} }],
    }
    const hits: string[] = []
    const grayRt = createCloudRuntime({
      sources: onlyStable, gameId: 'g1', gamePort: 7700,
      gray: { canaryPercent: 100 },
      transport: async (t: any) => { hits.push(t.instanceId); return { ok: true } },
    })
    const r = await grayRt.call('gray-svc', '/api/x')
    expect(r.ok).toBe(true)
    expect(r.gray).toMatchObject({ lane: 'primary', fallback: true })
    expect(hits).toEqual(['stable:1']) // 回退到稳定实例，不路由到空

    const plain = createCloudRuntime({
      sources, gameId: 'g1', gamePort: 7700,
      transport: async (t: any) => { hits.push(t.instanceId); return { ok: true } },
    })
    expect(plain.gray).toBe(null) // 未配 gray 不建决策器
    const p1 = await plain.call('svc-a', '/p')
    const p2 = await plain.call('svc-a', '/p')
    expect(p1.ok && p2.ok).toBe(true)
    expect(p1.gray).toBeUndefined() // 老路径回带里没有 gray 字段
    expect(hits.slice(-2)).toEqual(['svc-a:1', 'svc-a:2']) // round-robin 仍轮转
  })
})
