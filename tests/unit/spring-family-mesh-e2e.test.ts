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

  it('e2e KI-488①：事件总线在主链收到 game.started 与 game.stopped', async () => {
    const e = runMeshE2E({ transport: async (t: any, p: string) => ({ path: p }) })
    const r = await e.run()
    expect(r.events.map((x) => x.type)).toEqual(['game.started', 'game.stopped'])
    expect(r.events[0].payload).toMatchObject({ gameId: 'caesura-game' })
  })

  it('e2e KI-488②：鉴权守卫放行带 scope 的 Bearer；缺域则短路拒调', async () => {
    const calls: any[] = []
    const transport = async (t: any, p: string) => { calls.push({ t, p }); return { path: p } }
    const enc = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const token = (scope: string) => `Bearer ${enc({ alg: 'none' })}.${enc({ sub: 'u', scope, exp: Math.floor(Date.now() / 1000) + 99 })}.sig`

    const ok = runMeshE2E({ transport, requiredScope: 'game:call', bearer: token('game:call admin') })
    const rOk = await ok.run()
    expect(rOk.auth).toMatchObject({ ok: true, allowed: true })
    expect(rOk.callRes?.ok).toBe(true)
    expect(calls.length).toBe(1)

    const denied = runMeshE2E({ transport, requiredScope: 'game:admin', bearer: token('game:call') })
    const rDenied = await denied.run()
    expect(rDenied.auth).toMatchObject({ ok: true, allowed: false })
    expect(rDenied.callRes?.reason).toBe('forbidden')
    expect(calls.length).toBe(1) // 被短路，没有第二次真调用
  })

  it('e2e KI-488③：Retry filter + flaky transport ⇒ filterStats.retries 记到真重试且最终成功', async () => {
    let tries = 0
    const e = runMeshE2E({
      retryAttempts: 3,
      transport: async (t: any, p: string) => { tries += 1; if (tries < 3) throw new Error(`flaky#${tries}`); return { path: p, tries } },
    })
    const r = await e.run()
    expect(r.callRes?.ok).toBe(true)
    expect(r.callRes?.result).toEqual({ path: '/api/health', tries: 3 })
    expect(r.filterStats.retries).toBe(2)
    expect(tries).toBe(3)
  })
})
