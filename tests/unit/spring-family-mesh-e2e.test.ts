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

  it('e2e KI-493：authCache + onlineAuth 缓存探针 ⇒ 同令牌二次 source=cache、端点只打一次', async () => {
    let introspections = 0
    const activeFetch = (async () => {
      introspections++
      return { ok: true, status: 200, json: async () => ({ active: true, scope: 'game:call', sub: 'u1' }) }
    }) as any
    const r = await runMeshE2E({
      bearer: null, // 跳开主链 auth 块，让 cacheProbe 自己控制两次调用（否则第一次已被主链填进缓存）
      transport: async (_t: any, p: string) => ({ path: p }),
      requiredScope: 'game:call',
      authCache: true,
      authCacheTtlMs: 60_000,
      onlineAuth: { introspectionUrl: 'http://idp/introspect', fetch: activeFetch, policy: 'fail-closed' },
      cacheProbe: { bearer: 'Bearer opaque-token' },
    }).run()
    expect(r.cacheProbe).not.toBeNull()
    expect(r.cacheProbe!.firstSource).toBe('introspection')
    expect(r.cacheProbe!.secondSource).toBe('cache')
    expect(r.cacheProbe!.secondCacheHit).toBe(true)
    expect(r.cacheProbe!.secondOk).toBe(true)
    expect(r.cacheProbe!.stats.hits).toBeGreaterThanOrEqual(1)
    // 两次 authorizeOnline 只有第一次真打端点；无缓存时 introspections 会是 2。
    expect(introspections).toBe(1)
    expect(r.authCacheStats).toMatchObject({ hits: 1, misses: 1 })
    expect(r.status.authCache).toMatchObject({ hits: 1 })
  })

  it('e2e KI-494：net=true 用真实 proxyCall 耗时喂计网包，cwnd 增长且 RTO 有样本', async () => {
    let t = 1000
    const r = await runMeshE2E({
      transport: async (_t: any, _p: string) => { t += 8; return { path: '/api/health' } },
      net: true,
      netNow: () => t,
    }).run()
    expect(r.netSnapshot).not.toBeNull()
    expect(r.netSnapshot!.observes).toBe(1) // 主链那一次 proxyCall 被真观测
    expect(r.netSnapshot!.aimd.cwnd).toBeGreaterThan(1) // 成功 ACK ⇒ 慢启动增长
    expect(r.netSnapshot!.rto.srtt).toBeGreaterThan(0) // 真实耗时被采样
    expect(r.status.net.observes).toBe(1)
    // 未配 net 时 netSnapshot 为 null（非破坏）
    const plain = await runMeshE2E({ transport: async () => ({}) }).run()
    expect(plain.netSnapshot).toBe(null)
  })

  it('e2e KI-492：路由挂 Bulkhead+TimeLimiter，挂起 transport ⇒ filterStats 读到 timedOut 真触发', async () => {
    // transport 直接挂住不返回；TimeLimiter 到点抛 time_limiter_timeout，整条 call 失败但 filterStats 留证。
    const hanging = async () => new Promise<any>(() => {})
    const e = runMeshE2E({
      bearer: null, transport: hanging,
      filters: [
        { name: 'Bulkhead', args: { key: 'e2e-gate', maxConcurrent: 2 } },
        { name: 'TimeLimiter', args: { timeoutMs: 15 } },
      ],
    })
    const r = await e.run()
    expect(r.callRes.ok).toBe(false)
    expect((r.callRes.error as Error).message).toBe('time_limiter_timeout')
    expect(r.filterStats.timedOut).toBe(1)
    expect(r.filterStats.bulkheadHeld).toBe(1) // 持票进入过（舱壁真在链上）
  })

  it('e2e KI-491：grayInstances + grayProbes ⇒ 同 key 稳定落同池、金丝雀命中、空池诚实回退', async () => {
    const transport = async (t: any, p: string) => ({ instanceId: t.instanceId, path: p })
    const grayInstances = [
      { id: 'stable:1', name: 'gray-svc', address: '10.0.3.1', port: 8080, healthy: true, metadata: { version: 'v1', weight: 1 } },
      { id: 'can:1', name: 'gray-svc', address: '10.0.3.2', port: 8080, healthy: true, metadata: { version: 'v2', canary: true, weight: 3 } },
    ]
    // selector 把 'v2-user*' 落桶 0（想走金丝雀）、'stable-user' 落桶 0.99（留稳定）。
    const selector = ({ key }: any) => String(key).startsWith('v2-user') ? 0 : 0.99
    const e = runMeshE2E({
      transport, bearer: null,
      grayInstances,
      gray: { canaryPercent: 50, grayField: 'version', canaryValue: 'v2', stickyHeader: 'x-player', selector, rand: () => 0 },
      grayProbes: [
        { service: 'gray-svc', headers: { 'x-player': 'v2-user-1' } },
        { service: 'gray-svc', headers: { 'x-player': 'v2-user-1' } }, // 同 key 再来一次 ⇒ 仍 can:1
        { service: 'gray-svc', headers: { 'x-player': 'stable-user' } },
        { service: 'empty-canary-svc', headers: { 'x-player': 'v2-user-2' }, canaryPercent: 100 },
      ],
    })
    // 空金丝雀池那一发要有实例可回退，单独注入一个纯稳定服务。
    e.gc.runtime.mesh.registerSource('onlyStable', () => [
      { id: 'es:1', name: 'empty-canary-svc', address: '10.0.3.9', port: 8080, healthy: true, metadata: {} },
    ])
    const r = await e.run()
    expect(r.grayProbes).toHaveLength(4)
    // 同 key 稳定落金丝雀池、命中同一实例（会话亲和）
    expect(r.grayProbes[0]).toMatchObject({ ok: true, lane: 'canary', fallback: false, instanceId: 'can:1' })
    expect(r.grayProbes[1]).toMatchObject({ lane: 'canary', instanceId: 'can:1' })
    // 桶 0.99 > 50% ⇒ 留稳定池
    expect(r.grayProbes[2]).toMatchObject({ lane: 'primary', instanceId: 'stable:1' })
    // 想走金丝雀但池空 ⇒ 诚实回退稳定、标 fallback
    expect(r.grayProbes[3]).toMatchObject({ ok: true, lane: 'primary', fallback: true, instanceId: 'es:1' })
    expect(r.grayStats!.canary).toBe(2)
    expect(r.grayStats!.fallback).toBe(1)
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

  it('e2e KI-499：hashRing=true ⇒ 主链照常跑通，hashRingSnapshot 带扩容最小重映射证据', async () => {
    const e = runMeshE2E({ hashRing: { nodes: ['svc-a:1', 'svc-a:2', 'gate:1'], remappingKeys: 1000 } })
    const r = await e.run()
    // 主链非破坏：注册/调用/关停都照常。
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    expect(r.stopped?.registered).toBe(false)
    const h = r.hashRingSnapshot
    expect(h).toBeTruthy()
    expect(h!.ring.nodes).toEqual(['gate:1', 'svc-a:1', 'svc-a:2'])
    expect(h!.ring.virtualPoints).toBeGreaterThan(0)
    expect(h!.grow.consistentRate).toBeLessThan(h!.grow.moduloRate)
    expect(h!.grow.consistentRate).toBeLessThan(0.4)
    expect(h!.grow.moduloRate).toBeGreaterThan(0.4)
    expect(h!.distribution.emptyNodes).toEqual([])
    expect(typeof h!.builtAt).toBe('number')
    // 未配 hashRing 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.hashRingSnapshot).toBe(null)
  })

  it('e2e KI-500：shardedCache=true ⇒ 主链照常跑通，shardedCacheSnapshot 带保留率对照证据', async () => {
    const e = runMeshE2E({ shardedCache: { shards: ['svc-a:1', 'svc-a:2', 'gate:1'], retentionKeys: 1000 } })
    const r = await e.run()
    // 主链非破坏：注册/调用/关停都照常。
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    expect(r.stopped?.registered).toBe(false)
    const s = r.shardedCacheSnapshot
    expect(s).toBeTruthy()
    expect(s!.cache.shards).toEqual(['gate:1', 'svc-a:1', 'svc-a:2'])
    expect(s!.retention.consistentRetention).toBeGreaterThan(s!.retention.moduloRetention)
    expect(s!.retention.consistentRetention).toBeGreaterThan(0.6)
    expect(s!.retention.consistentRetention).toBeLessThan(0.85)
    expect(s!.retention.theoretical).toBeCloseTo(0.75, 2)
    expect(s!.retention.savedRate).toBeGreaterThan(0.1)
    expect(typeof s!.builtAt).toBe('number')
    // 未配 shardedCache 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.shardedCacheSnapshot).toBe(null)
  })
})
