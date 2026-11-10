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

  it('e2e KI-490：onlineAuth 走 introspection 在线判；active 放行/inactive 拒/端点挂 fail-open 降级', async () => {
    const calls: any[] = []
    const transport = async (t: any, p: string) => { calls.push(p); return { path: p } }
    const bearer = 'Bearer opaque-token'
    const activeFetch = async () => ({ ok: true, status: 200, json: async () => ({ active: true, scope: 'game:call' }) }) as any
    const inactiveFetch = async () => ({ ok: true, status: 200, json: async () => ({ active: false }) }) as any
    const deadFetch = async () => { throw new Error('ECONNREFUSED') }

    const rActive = await runMeshE2E({
      bearer, transport, requiredScope: 'game:call',
      onlineAuth: { introspectionUrl: 'http://idp/introspect', fetch: activeFetch, policy: 'fail-closed' },
    }).run()
    expect(rActive.auth).toMatchObject({ ok: true, allowed: true, source: 'introspection' })
    expect(rActive.callRes?.ok).toBe(true)

    const rInactive = await runMeshE2E({
      bearer, transport, requiredScope: 'game:call',
      onlineAuth: { introspectionUrl: 'http://idp/introspect', fetch: inactiveFetch, policy: 'fail-closed' },
    }).run()
    expect(rInactive.auth).toMatchObject({ ok: false, reason: 'inactive' })
    expect(rInactive.callRes?.reason).toBe('forbidden')

    const callsBefore = calls.length
    const rOpen = await runMeshE2E({
      bearer, transport, requiredScope: 'game:call',
      onlineAuth: { introspectionUrl: 'http://idp/introspect', fetch: deadFetch, policy: 'fail-open' },
    }).run()
    expect(rOpen.auth).toMatchObject({ ok: true, source: 'local', degraded: true, reason: 'introspection_unavailable' })
    expect(rOpen.callRes?.ok).toBe(true)
    expect(calls.length).toBe(callsBefore + 1) // 降级放行后真发起了下游调用

    const rClosed = await runMeshE2E({
      bearer, transport, requiredScope: 'game:call',
      onlineAuth: { introspectionUrl: 'http://idp/introspect', fetch: deadFetch, policy: 'fail-closed' },
    }).run()
    expect(rClosed.auth).toMatchObject({ ok: false, source: 'introspection', degraded: true })
    expect(rClosed.callRes?.reason).toBe('forbidden')
    expect(calls.length).toBe(callsBefore + 1) // fail-closed 没发起调用
  })

  it('e2e KI-489：注入真 EventBus 形状的 gameBus ⇒ 游戏事件过桥到云总线、shutdown 退桥', async () => {
    const handlers = new Map<string, Set<Function>>()
    const gameBus = {
      on: (k: string, fn: Function) => {
        if (!handlers.has(k)) handlers.set(k, new Set())
        handlers.get(k)!.add(fn)
        return () => handlers.get(k)?.delete(fn)
      },
      emit: (k: string, p: any) => { for (const fn of [...(handlers.get(k) ?? [])]) fn(p) },
    }
    const e = runMeshE2E({ gameBus, transport: async (t: any, p: string) => ({ path: p }) })
    const r = await e.run()
    expect(r.gameBridge?.installed.installed).toBe(true)
    expect(r.gameBridge?.stats.forward).toBe(1)
    expect(r.gameBridge?.crossed).toEqual({ id: 'e2e-boss', phase: 2, phases: 3, nameKey: 'boss.x' })
    expect(r.bridgeOff?.removed).toBe(2) // 1 条 game→cloud + 1 条 cloud→game
    expect(handlers.get('boss.phase')?.size).toBe(0) // 退桥后无悬挂订阅
  })
})
