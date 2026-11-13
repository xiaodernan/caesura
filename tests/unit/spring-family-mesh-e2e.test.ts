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

  it('e2e KI-501：cacheGuard=true ⇒ 主链照常跑通，cacheGuardSnapshot 带三件套对照证据', async () => {
    const e = runMeshE2E({ cacheGuard: { concurrency: 16, keys: 128, rounds: 3 }, guardNow: () => 5555 })
    const r = await e.run()
    // 主链非破坏：注册/调用/关停都照常。
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    expect(r.stopped?.registered).toBe(false)
    const g = r.cacheGuardSnapshot
    expect(g).toBeTruthy()
    expect(g!.builtAt).toBe(5555)
    // 击穿：singleflight 把并发合并到 1 次
    expect(g!.stampede.naiveLoads).toBe(16)
    expect(g!.stampede.singleflightLoads).toBe(1)
    expect(g!.stampede.savedLoads).toBe(15)
    // 穿透：布隆/空值缓存明显省回源
    expect(g!.penetration.bloomDbHits).toBeLessThan(g!.penetration.naiveDbHits)
    expect(g!.penetration.negativeDbHits).toBeLessThan(g!.penetration.naiveDbHits)
    // 雪崩：抖动削峰
    expect(g!.avalanche.jitterPeak).toBeLessThan(g!.avalanche.uniformPeak)
    expect(g!.avalanche.peakReduction).toBeGreaterThan(0)
    // 未配 cacheGuard 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.cacheGuardSnapshot).toBe(null)
  })

  it('e2e KI-502：rateLimit=true ⇒ 主链照常跑通，rateLimitSnapshot 带五算法突发 + Redis 原子性证据', async () => {
    const e = runMeshE2E({ rateLimit: { concurrency: 16, capacity: 4, redisCapacity: 4 }, rlNow: () => 7777 })
    const r = await e.run()
    // 主链非破坏：注册/调用/关停都照常。
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    expect(r.stopped?.registered).toBe(false)
    const g = r.rateLimitSnapshot
    expect(g).toBeTruthy()
    expect(g!.builtAt).toBe(7777)
    // 五算法：固定窗口 2× 突发，滑动窗口压在 1
    expect(g!.strategies.fixedWindow.burstRatio).toBe(2)
    expect(g!.strategies.slidingLog.burstRatio).toBe(1)
    expect(g!.verdict.fixedWindowBurst).toBe(true)
    // Redis 原子不超发 / 非原子超发 / 跨实例共享一致
    expect(g!.redis.atomicAllowed).toBeLessThanOrEqual(g!.redis.capacity)
    expect(g!.redis.nonAtomicAllowed).toBeGreaterThan(g!.redis.capacity)
    expect(g!.redis.overshoot).toBeGreaterThan(0)
    expect(g!.redis.shared.consistent).toBe(true)
    // 未配 rateLimit 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.rateLimitSnapshot).toBe(null)
  })

  it('e2e KI-503：failureDetector=true ⇒ 主链照常跑通，failureDetectorSnapshot 带固定 vs φ 对照 + SWIM 三态 + 健康视图证据', async () => {
    const e = runMeshE2E({ failureDetector: { stableCount: 20, spikeCount: 2 }, fdNow: () => 8888 })
    const r = await e.run()
    // 主链非破坏：注册/调用/关停都照常。
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    expect(r.stopped?.registered).toBe(false)
    const g = r.failureDetectorSnapshot
    expect(g).toBeTruthy()
    expect(g!.builtAt).toBe(8888)
    // 固定超时抖动期误报多；φ 降误报；两者都能检出真故障（如实保留「固定更快但更吵」权衡）
    expect(g!.fixed.falsePositives).toBeGreaterThan(g!.phi.falsePositives)
    expect(g!.phi.falsePositives).toBe(0)
    expect(g!.verdict.bothDetectRealFailure).toBe(true)
    expect(g!.verdict.fixedFasterButNoisier).toBe(true)
    // SWIM 间接探测救回 + 健康视图缓存首算
    expect(g!.swim.script.indirectRescued).toBe(true)
    expect(g!.health.nodes).toContain('gate-a')
    expect(g!.health.excluded).toContain('gate-c')
    // 未配 failureDetector 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.failureDetectorSnapshot).toBe(null)
  })

  it('e2e KI-504：bplusIndex=true ⇒ 主链照常跑通，bplusIndexSnapshot 带点查/范围/写放大三笔账 + 正确性对账证据', async () => {
    const e = runMeshE2E({ bplusIndex: { keyCount: 256, order: 8, leafCapacity: 8 }, bpNow: () => 9999 })
    const r = await e.run()
    // 主链非破坏：注册/调用/关停都照常。
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    expect(r.stopped?.registered).toBe(false)
    const g = r.bplusIndexSnapshot
    expect(g).toBeTruthy()
    expect(g!.builtAt).toBe(9999)
    // 真 B+ 树 + 与 LSM 答案逐条一致（对照成立的前提）
    expect(g!.structure.invariants).toBe(0)
    expect(g!.structure.height).toBeGreaterThanOrEqual(2)
    expect(g!.agreement.bothAgree).toBe(true)
    // 三笔账各有真读数，favors 各落一档
    expect(g!.point.bplusComparisons).toBeGreaterThan(0)
    expect(g!.point.lsmComparisons).toBeGreaterThan(0)
    expect(g!.range.lsmSortComparisons).toBeGreaterThan(0)
    expect(g!.write.bplusPageRewrites).toBeGreaterThan(0)
    expect(g!.write.lsmSeqWriteUnits).toBeGreaterThan(0)
    for (const f of [g!.point.favors, g!.range.favors, g!.write.favors]) {
      expect(['bplus', 'lsm', 'tie']).toContain(f)
    }
    expect(g!.verdict.noUniversalWinner).toBe(true)
    // 未配 bplusIndex 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.bplusIndexSnapshot).toBe(null)
  })

  it('e2e KI-505：mvccTxn=true ⇒ 主链照常跑通，mvccTxnSnapshot 带五行异常矩阵/死锁环/2PL/gc 证据', async () => {
    const e = runMeshE2E({ mvccTxn: { gcVersions: 10 }, txnNow: () => 9999 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const g = r.mvccTxnSnapshot
    expect(g).not.toBe(null)
    expect(g!.builtAt).toBe(9999)
    expect(g!.levels.length).toBe(5)                   // RU/RC/RR/SI/SER
    expect(g!.config.anomalies.length).toBe(5)
    const si = g!.levels.find((l: any) => l.short === 'SI')!
    const ser = g!.levels.find((l: any) => l.short === 'SER')!
    expect(si.anomalies.writeSkew.observed).toBe(true) // SI 漏写偏斜
    expect(si.anomalies.lostUpdate.observed).toBe(false)
    expect(ser.observedCount).toBe(0)                  // SER 全挡
    expect(g!.deadlock.detected).toBe(true)
    expect(g!.deadlock.resolved).toBe(true)
    expect(g!.deadlock.acyclicProbeNoCycle).toBe(true)
    expect(g!.twoPhaseLock.lateAcquireBlocked).toBe(true)
    expect(g!.gc.longTxnRetainsMoreVersions).toBe(true)
    expect(Object.values(g!.verdict).every(Boolean)).toBe(true)
    // 未配 mvccTxn 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.mvccTxnSnapshot).toBe(null)
  })

  it('e2e KI-506：distributedTxn=true ⇒ 主链照常跑通，distributedTxnSnapshot 带三协议×六场景矩阵/三难判词', async () => {
    const e = runMeshE2E({ distributedTxn: true, dtxnNow: () => 6666 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.distributedTxnSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(6666)
    expect(d!.config.protocols).toEqual(['2PC', 'Saga', 'TCC'])
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    const two = d!.rows.find((row: any) => row.protocol === '2PC')!
    const saga = d!.rows.find((row: any) => row.protocol === 'Saga')!
    const tcc = d!.rows.find((row: any) => row.protocol === 'TCC')!
    expect(two.scenarios.find((s: any) => s.id === 'coordinatorDown')!.blocked).toBe(3)
    expect(saga.scenarios.find((s: any) => s.id === 'compensateFail')!.dirty).toBe(1)
    expect(tcc.scenarios.find((s: any) => s.id === 'confirmFlaky')!.retries).toBeGreaterThan(0)
    expect(two.intrusion).toBeLessThan(tcc.intrusion)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(Object.values(d!.verdict).every(Boolean)).toBe(true)
    // 未配 distributedTxn 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.distributedTxnSnapshot).toBe(null)
  })

  it('e2e KI-507：raftConsensus=true ⇒ 主链照常跑通，raftConsensusSnapshot 带三协议×六场景矩阵/三难判词', async () => {
    const e = runMeshE2E({ raftConsensus: true, raftNow: () => 6666 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.raftConsensusSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(6666)
    expect(d!.config.protocols).toEqual(['Raft', 'MultiMaster', 'Gossip'])
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    const raft = d!.rows.find((row: any) => row.protocol === 'Raft')!
    const mm = d!.rows.find((row: any) => row.protocol === 'MultiMaster')!
    const gossip = d!.rows.find((row: any) => row.protocol === 'Gossip')!
    expect(raft.scenarios.find((s: any) => s.id === 'networkPartition')!.blockedWrites).toBeGreaterThan(0)
    expect(mm.scenarios.find((s: any) => s.id === 'writeConflict')!.conflicts).toBeGreaterThan(0)
    expect(gossip.scenarios.find((s: any) => s.id === 'antiEntropyGap')!.converged).toBe(false)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(Object.values(d!.verdict).every(Boolean)).toBe(true)
    // 未配 raftConsensus 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.raftConsensusSnapshot).toBe(null)
  })

  it('e2e KI-508：distributedLock=true ⇒ 主链照常跑通，distributedLockSnapshot 带三协议×六场景矩阵/三难判词', async () => {
    const e = runMeshE2E({ distributedLock: true, dlockNow: () => 7777 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.distributedLockSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(7777)
    expect(d!.config.protocols).toEqual(['SETNX', 'Redlock', 'ETCD'])
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    const setnx = d!.rows.find((row: any) => row.protocol === 'SETNX')!
    const redlock = d!.rows.find((row: any) => row.protocol === 'Redlock')!
    const etcd = d!.rows.find((row: any) => row.protocol === 'ETCD')!
    expect(setnx.scenarios.find((s: any) => s.id === 'gcPause')!.doubleOwners).toBeGreaterThan(0)
    expect(redlock.scenarios.find((s: any) => s.id === 'clockDrift')!.doubleOwners).toBeGreaterThan(0)
    expect(etcd.scenarios.find((s: any) => s.id === 'staleFencing')!.staleWritesRejected).toBeGreaterThan(0)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(Object.values(d!.verdict).every(Boolean)).toBe(true)
    // 未配 distributedLock 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.distributedLockSnapshot).toBe(null)
  })

  it('e2e KI-509：idGen=true ⇒ 主链照常跑通，idGenSnapshot 带三协议×六场景矩阵/三难判词/真树交叉印证', async () => {
    const e = runMeshE2E({ idGen: true, idGenNow: () => 8888 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.idGenSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(8888)
    expect(d!.config.protocols).toEqual(['UUID', 'Snowflake', 'Segment'])
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    const uuid = d!.rows.find((row: any) => row.protocol === 'UUID')!
    const snow = d!.rows.find((row: any) => row.protocol === 'Snowflake')!
    const seg = d!.rows.find((row: any) => row.protocol === 'Segment')!
    expect(uuid.scenarios.find((s: any) => s.id === 'randomKeyInsert')!.indexFriendly).toBe(false)
    expect(snow.scenarios.find((s: any) => s.id === 'clockBackward')!.stalled).toBeGreaterThan(0)
    expect(seg.scenarios.find((s: any) => s.id === 'centerDown')!.stalled).toBeGreaterThan(0)
    expect(d!.btree.randomCmpGtSequential).toBe(true) // KI-504 真树交叉印证透传到 E2E
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(Object.values(d!.verdict).every(Boolean)).toBe(true)
    // 未配 idGen 时为 null（非破坏）。
    const plain = await runMeshE2E().run()
    expect(plain.idGenSnapshot).toBe(null)
  })

  it('e2e KI-510：distributedRateLimit=true ⇒ 主链照常跑通，distributedRateLimitSnapshot 带三协议×六场景矩阵/三难判词/真件交叉印证', async () => {
    const e = runMeshE2E({ distributedRateLimit: true, drNow: () => 7777 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.distributedRateLimitSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(7777)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ Local: '011', Central: '100', Sharded: '010' })
    const local = d!.rows.find((row: any) => row.protocol === 'Local')!
    const central = d!.rows.find((row: any) => row.protocol === 'Central')!
    const sharded = d!.rows.find((row: any) => row.protocol === 'Sharded')!
    expect(local.scenarios.every((s: any) => s.overAllowed > 0)).toBe(true)
    expect(central.scenarios.find((s: any) => s.id === 'centerDown')!.centerStalled).toBe(64)
    expect(sharded.scenarios.find((s: any) => s.id === 'skewKeys')!.fragmented).toBeGreaterThan(0)
    expect(d!.crosscheck.central.atomicExact).toBe(true)             // 真 Redis 原子桶透传
    expect(d!.crosscheck.sharded.skewEmptyNodes).toBeGreaterThan(0)  // 真环偏斜透传
    expect(d!.verdict.noUniversalWinner).toBe(true)
    const verdictBools = Object.entries(d!.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 未配 distributedRateLimit 时为 null（非破坏、不连坐 KI-509）。
    const plain = await runMeshE2E().run()
    expect(plain.distributedRateLimitSnapshot).toBe(null)
    expect(plain.idGenSnapshot).toBe(null)
  })

  it('e2e KI-511：configConsistency=true ⇒ 主链照常跑通，configConsistencySnapshot 带三协议×六场景矩阵/三难判词/真件交叉印证', async () => {
    const e = runMeshE2E({ configConsistency: true, dccNow: () => 7777 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.configConsistencySnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(7777)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ Polling: '100', LongPolling: '011', WatchPush: '010' })
    const polling = d!.rows.find((row: any) => row.protocol === 'Polling')!
    const longPolling = d!.rows.find((row: any) => row.protocol === 'LongPolling')!
    const watch = d!.rows.find((row: any) => row.protocol === 'WatchPush')!
    expect(polling.scenarios.find((s: any) => s.id === 'idleNoChange')!.idleFetches).toBeGreaterThan(0)
    expect(longPolling.scenarios.find((s: any) => s.id === 'centerDown')!.centerBroken).toBe(true)
    expect(watch.scenarios.find((s: any) => s.id === 'burstChanges')!.versionGaps).toBeGreaterThan(0)
    expect(d!.crosscheck.configWatcher.seededNoEvents).toBe(true)   // 真 watcher 首趟纯播种透传
    expect(d!.crosscheck.bus.eventChainWorks).toBe(true)            // 真 bus 事件链透传
    expect(d!.crosscheck.gray.stableBuckets).toBe(64)               // 真 hashSelector 透传
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.watchNotPanacea).toBe(true)
    const verdictBools = Object.entries(d!.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 未配 configConsistency 时为 null（非破坏、不连坐 KI-510）。
    const plain = await runMeshE2E().run()
    expect(plain.configConsistencySnapshot).toBe(null)
    expect(plain.distributedRateLimitSnapshot).toBe(null)
  })

  it('e2e KI-512：cacheCoherency=true ⇒ 主链照常跑通，cacheCoherencySnapshot 带三协议×六场景矩阵/三难判词/七枚真件交叉印证', async () => {
    const e = runMeshE2E({ cacheCoherency: true, cccNow: () => 6666 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.cacheCoherencySnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(6666)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ CacheAside: '001', WriteThrough: '101', WriteBehind: '110' })
    const aside = d!.rows.find((row: any) => row.protocol === 'CacheAside')!
    const through = d!.rows.find((row: any) => row.protocol === 'WriteThrough')!
    const behind = d!.rows.find((row: any) => row.protocol === 'WriteBehind')!
    expect(aside.scenarios.find((s: any) => s.id === 'readAfterWrite')!.staleReads).toBeGreaterThan(0)
    expect(through.scenarios.find((s: any) => s.id === 'writeHeavy')!.writeBackendRounds).toBeGreaterThan(0)
    expect(behind.scenarios.find((s: any) => s.id === 'cacheCrash')!.dirtyPagesLost).toBeGreaterThan(0)
    expect(d!.crosscheck.wal.replicatedAcrossNodes).toBe(false)     // 真 WAL 不跨机透传
    expect(d!.crosscheck.wal.wholeNodeLossDurable).toBe(false)      // 整机宕不 durable 透传
    expect(d!.crosscheck.mvcc.writeThenReadNeedsCommit).toBe(true)  // 真 MVCC 透传
    expect(d!.crosscheck.twoPhase.downPhase).toBe('blocked')        // 真 2PC 透传
    expect(d!.crosscheck.redis.writeThenReadSeesNew).toBe(true)     // 真 Redis 透传
    expect(Object.keys(d!.crosscheck).sort()).toEqual(['guard', 'mvcc', 'redis', 'ring', 'sharded', 'twoPhase', 'wal'])
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.writeBehindNotPanacea).toBe(true)
    const verdictBools = Object.entries(d!.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 未配 cacheCoherency 时为 null（非破坏、不连坐 KI-511）。
    const plain2 = await runMeshE2E().run()
    expect(plain2.cacheCoherencySnapshot).toBe(null)
    expect(plain2.configConsistencySnapshot).toBe(null)
  })

  it('e2e KI-513：messageDelivery=true ⇒ 主链照常跑通，messageDeliverySnapshot 带三协议×六场景矩阵/三难判词/七枚真件交叉印证', async () => {
    const e = runMeshE2E({ messageDelivery: true, mmdNow: () => 7777 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.messageDeliverySnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(7777)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ AtMostOnce: '011', AtLeastOnce: '101', ExactlyOnce: '110' })
    const most = d!.rows.find((row: any) => row.protocol === 'AtMostOnce')!
    const least = d!.rows.find((row: any) => row.protocol === 'AtLeastOnce')!
    const once = d!.rows.find((row: any) => row.protocol === 'ExactlyOnce')!
    expect(most.scenarios.find((s: any) => s.id === 'crashAfterSend')!.lost).toBeGreaterThan(0)
    expect(least.scenarios.find((s: any) => s.id === 'ackLost')!.duplicates).toBeGreaterThan(0)
    expect(once.scenarios.find((s: any) => s.id === 'brokerRetry')!.idempotentHits).toBeGreaterThan(0)
    expect(d!.crosscheck.bridge.forwardOk).toBe(true)              // 真桥透传
    expect(d!.crosscheck.wal.replayIds).toEqual(['m:1', 'm:2', 'm:1']) // 真 WAL 取到 key 透传
    expect(d!.crosscheck.wal.replicatedAcrossNodes).toBe(false)
    expect(d!.crosscheck.twoPhase.replayIdempotent).toBe(true)
    expect(d!.crosscheck.bus.atMostOnceShell).toBe(true)
    expect(d!.crosscheck.redis.idempotentTable).toBe(true)
    expect(Object.keys(d!.crosscheck).sort()).toEqual(['bridge', 'bus', 'gameEventBus', 'redis', 'ring', 'twoPhase', 'wal'])
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.exactlyOnceNotFree).toBe(true)
    const verdictBools = Object.entries(d!.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 未配 messageDelivery 时为 null（非破坏、不连坐 KI-512 / KI-511）。
    const plain3 = await runMeshE2E().run()
    expect(plain3.messageDeliverySnapshot).toBe(null)
    expect(plain3.cacheCoherencySnapshot).toBe(null)
    expect(plain3.configConsistencySnapshot).toBe(null)
  })

  it('e2e KI-518：delayQueue=true ⇒ 主链照常跑通，delayQueueSnapshot 带三协议×六场景/三难向量/七真件交叉印证', async () => {
    const e = runMeshE2E({ delayQueue: true, dqNow: () => 8888 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.delayQueueSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(8888)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ TimingWheel: '100', MinHeap: '010', RedisZset: '001' })
    const w = d!.rows.find((row: any) => row.protocol === 'TimingWheel')!
    const h = d!.rows.find((row: any) => row.protocol === 'MinHeap')!
    const z = d!.rows.find((row: any) => row.protocol === 'RedisZset')!
    expect(w.scenarios.find((s: any) => s.id === 'tickSkew')!.lateMs).toBeGreaterThan(0)
    expect(h.totals.lateMs).toBe(0)
    expect(z.scenarios.find((s: any) => s.id === 'workerRestart')!.lostOnRestart).toBe(0)
    expect(Object.keys(d!.crosscheck.evidence).sort()).toEqual(['bplusRangeCount', 'busDelivered', 'hashRingEmptyNodes', 'hashRingNodes', 'poolAcquired', 'redisEntries', 'tokenBucketOk', 'walLines'])
    expect(d!.crosscheck.evidence.poolAcquired).toBe(2)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    const verdictBools = Object.entries(d!.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 未配 delayQueue 时为 null（非破坏、不连坐 KI-513）
    const plainDq = await runMeshE2E().run()
    expect(plainDq.delayQueueSnapshot).toBe(null)
    expect(plainDq.messageDeliverySnapshot).toBe(null)
  })

  it('e2e KI-520：retryDlq=true ⇒ 主链照常跑通，retryDlqSnapshot 带三协议×六场景/三难向量/七真件交叉印证', async () => {
    const e = runMeshE2E({ retryDlq: true, rdlNow: () => 8888 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.retryDlqSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(8888)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ Immediate: '100', Exponential: '010', FullJitter: '011' })
    const imm = d!.rows.find((row: any) => row.protocol === 'Immediate')!
    const fj = d!.rows.find((row: any) => row.protocol === 'FullJitter')!
    expect(imm.trilemma).toEqual({ fastRecovery: true, noStorm: false, noHerd: false })
    expect(fj.trilemma).toEqual({ fastRecovery: false, noStorm: true, noHerd: true })
    expect(imm.scenarios.find((s: any) => s.id === 'manyAttempts')!.deadLettered).toBeGreaterThan(0) // 死信真落地
    const ev = d!.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bucketAllowed', 'bucketRejected', 'busListeners', 'deadNotices', 'hashRingEmptyNodes', 'hashRingNodes', 'heapFired', 'idemEntries', 'poolAcquired', 'walLines', 'walReplayed'])
    expect(ev.heapFired).toBe(12)
    expect(ev.walReplayed).toBe(3)
    expect(ev.bucketRejected).toBe(2)
    expect(ev.idemEntries).toBe(1)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.fullJitterNotFreeLunch).toBe(true)
    expect(r).toHaveProperty('retryDlqSnapshot')
    // 未配 retryDlq 时为 null（非破坏、不连坐 KI-518）
    const plainRdlq = await runMeshE2E().run()
    expect(plainRdlq.retryDlqSnapshot).toBe(null)
    expect(plainRdlq.delayQueueSnapshot).toBe(null)
  })

  it('e2e KI-523：consumerGroup=true ⇒ 主链照常跑通，consumerGroupSnapshot 带三协议×六场景/三难向量/九真件交叉印证', async () => {
    const e = runMeshE2E({ consumerGroup: true, cgpNow: () => 8888 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.consumerGroupSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(8888)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ Range: '001', RoundRobin: '100', Sticky: '110' })
    const range = d!.rows.find((row: any) => row.protocol === 'Range')!
    const rr = d!.rows.find((row: any) => row.protocol === 'RoundRobin')!
    const sticky = d!.rows.find((row: any) => row.protocol === 'Sticky')!
    expect(range.trilemma).toEqual({ balanced: false, minimalMovement: false, cheap: true })
    expect(rr.trilemma).toEqual({ balanced: true, minimalMovement: false, cheap: false })
    expect(sticky.trilemma).toEqual({ balanced: true, minimalMovement: true, cheap: false })
    expect(range.scenarios.find((s: any) => s.id === 'partitionSkew')!.imbalance).toBe(2)
    expect(sticky.scenarios.find((s: any) => s.id === 'memberJoin')!.moveRate).toBe(0.125)
    const ev = d!.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bucketAllowed', 'bucketRejected', 'busListeners', 'groupMetaEntries', 'hashRingEmptyNodes', 'hashRingNodes', 'heapFired', 'poolAcquired', 'rebalanceNotices', 'remapConsistentRate', 'remapModuloRate', 'remapSavedRate', 'routerMoved', 'routerRate', 'walLines', 'walReplayed'])
    expect(ev.walReplayed).toBe(2)
    expect(ev.rebalanceNotices).toBe(2)
    expect(ev.heapFired).toBe(9)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.stickyNotFreeLunch).toBe(true)
    // rigged 透传：因果锁死 minimalMovement、101/101/101
    const rig = await runMeshE2E({ consumerGroup: { rigged: true } }).run()
    expect(rig.consumerGroupSnapshot!.vectors).toEqual({ Range: '101', RoundRobin: '101', Sticky: '101' })
    expect(rig.consumerGroupSnapshot!.verdict.minimalMovementCausallyUnerasable).toBe(true)
    // 未配 consumerGroup 时为 null（非破坏、不连坐 KI-518/520）
    const plain = await runMeshE2E().run()
    expect(plain.consumerGroupSnapshot).toBe(null)
    expect(plain.retryDlqSnapshot).toBe(null)
    expect(plain.delayQueueSnapshot).toBe(null)
  })

  it("e2e KI-525：backpressure=true ⇒ 主链照常跑通，backpressureSnapshot 带四策略×六场景/三难向量/Little's Law/十一真件交叉印证", async () => {
    const e = runMeshE2E({ backpressure: true, bpcNow: () => 9999 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.backpressureSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(9999)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(4)
    expect(d!.vectors).toEqual({ Backpressure: '110', Buffering: '101', Shedding: '011', Scaling: '100' })
    const bp = d!.rows.find((row: any) => row.strategy === 'Backpressure')!
    const buf = d!.rows.find((row: any) => row.strategy === 'Buffering')!
    const shed = d!.rows.find((row: any) => row.strategy === 'Shedding')!
    const scal = d!.rows.find((row: any) => row.strategy === 'Scaling')!
    expect(bp.trilemma).toEqual({ noLoss: true, lowLatency: true, highThroughput: false })
    expect(buf.trilemma).toEqual({ noLoss: true, lowLatency: false, highThroughput: true })
    expect(shed.trilemma).toEqual({ noLoss: false, lowLatency: true, highThroughput: true })
    expect(scal.trilemma).toEqual({ noLoss: true, lowLatency: false, highThroughput: false })
    expect(bp.scenarios.find((s: any) => s.id === 'burstAbsorb')!.rejected).toBeGreaterThan(0)
    expect(shed.scenarios.find((s: any) => s.id === 'sustainedOverload')!.dropped).toBeGreaterThan(0)
    const ev = d!.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bloomHit', 'bloomMiss', 'bucketAllowed', 'bucketRejected', 'busListeners', 'counterFalseSharing', 'counterSum', 'heapFired', 'jitterSpread', 'leakyAllowed', 'leakyRejected', 'poolCreated', 'poolReused', 'shardHits', 'walLines', 'walReplayed', 'watermarkNotices', 'zqFired', 'zqLostOnRestart', 'zqPendingAfterRestore'])
    expect(ev.heapFired).toBe(9)
    expect(ev.walReplayed).toBe(4)
    expect(d!.littleLaw.steadyHolds).toBe(true)
    expect(d!.littleLaw.overloadBreaks).toBe(true)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.sheddingNotFreeLunch).toBe(true)
    // rigged 透传：因果锁死 highThroughput、110/110/110/110
    const rig = await runMeshE2E({ backpressure: { rigged: true } }).run()
    expect(rig.backpressureSnapshot!.vectors).toEqual({ Backpressure: '110', Buffering: '110', Shedding: '110', Scaling: '110' })
    expect(rig.backpressureSnapshot!.verdict.highThroughputCausallyUnerasable).toBe(true)
    expect(rig.backpressureSnapshot!.verdict.noUniversalWinner).toBe(false)
    // 未配 backpressure 时为 null（非破坏、不连坐 KI-518/520/523）
    const plain = await runMeshE2E().run()
    expect(plain.backpressureSnapshot).toBe(null)
    expect(plain.consumerGroupSnapshot).toBe(null)
    expect(plain.retryDlqSnapshot).toBe(null)
    expect(plain.delayQueueSnapshot).toBe(null)
  })

  it("e2e KI-526：logCompaction=true ⇒ 主链照常跑通，logCompactionSnapshot 带三策略×六场景/三难向量/回放边界守恒/十一真件交叉印证", async () => {
    const e = runMeshE2E({ logCompaction: true, lcNow: () => 7777 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.logCompactionSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(7777)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ SizeTimeRetention: '101', KeyCompaction: '110', SnapshotPlusWal: '011' })
    const ret = d!.rows.find((row: any) => row.strategy === 'SizeTimeRetention')!
    const key = d!.rows.find((row: any) => row.strategy === 'KeyCompaction')!
    const snap = d!.rows.find((row: any) => row.strategy === 'SnapshotPlusWal')!
    expect(ret.trilemma).toEqual({ compactFootprint: true, replayCompleteness: false, fastRecovery: true })
    expect(key.trilemma).toEqual({ compactFootprint: true, replayCompleteness: true, fastRecovery: false })
    expect(snap.trilemma).toEqual({ compactFootprint: false, replayCompleteness: true, fastRecovery: true })
    expect(ret.scenarios.find((s: any) => s.id === 'slowConsumer')!.missingOps).toBeGreaterThan(0)
    const crash = snap.scenarios.find((s: any) => s.id === 'crashMidReplay')!
    expect(crash.dedupSkipped).toBeGreaterThan(0)     // exactly-once 真去重证据
    expect(crash.exactlyOnce).toBe(true)
    const ev = d!.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bloomHit', 'bloomMiss', 'bucketAllowed', 'bucketRejected', 'busListeners', 'counterFalseSharing', 'counterSum', 'heapFired', 'jitterSpread', 'notices', 'poolCreated', 'poolReused', 'ringFirst', 'ringShardsUsed', 'shardHits', 'walLastSeq', 'walLines', 'walReplayed', 'zqFired', 'zqLostOnRestart', 'zqPendingAfterRestore'])
    expect(ev.walReplayed).toBe(6)
    expect(d!.replayBoundary.holds).toBe(true)
    expect(d!.replayBoundary.falsifiable).toBe(true)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.snapshotExactlyOnce).toBe(true)
    // rigged 透传：因果锁死 fastRecovery、110/110/110
    const rig = await runMeshE2E({ logCompaction: { rigged: true } }).run()
    expect(rig.logCompactionSnapshot!.vectors).toEqual({ SizeTimeRetention: '110', KeyCompaction: '110', SnapshotPlusWal: '110' })
    expect(rig.logCompactionSnapshot!.verdict.fastRecoveryCausallyUnerasable).toBe(true)
    expect(rig.logCompactionSnapshot!.verdict.noUniversalWinner).toBe(false)
    // 未配 logCompaction 时为 null（非破坏、不连坐 KI-518/520/523/525）
    const plain = await runMeshE2E().run()
    expect(plain.logCompactionSnapshot).toBe(null)
    expect(plain.backpressureSnapshot).toBe(null)
    expect(plain.consumerGroupSnapshot).toBe(null)
  })

  it("e2e KI-527：bloomFilter=true ⇒ 主链照常跑通，bloomFilterSnapshot 带三策略×六场景/三难向量 110/011/101/FP ceiling 双路自证/十一真件交叉印证", async () => {
    const e = runMeshE2E({ bloomFilter: true, bfNow: () => 8888 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)          // 主链语义逐字不动
    expect(r.callRes?.ok).toBe(true)
    const d = r.bloomFilterSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(8888)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ Bloom: '110', CountingBloom: '011', Cuckoo: '101' })
    const bloom = d!.rows.find((row: any) => row.protocol === 'Bloom')!
    const cb = d!.rows.find((row: any) => row.protocol === 'CountingBloom')!
    const cuckoo = d!.rows.find((row: any) => row.protocol === 'Cuckoo')!
    expect(bloom.trilemma).toEqual({ compactFootprint: true, insertsNeverFail: true, deleteSupport: false })
    expect(cb.trilemma).toEqual({ compactFootprint: false, insertsNeverFail: true, deleteSupport: true })
    expect(cuckoo.trilemma).toEqual({ compactFootprint: true, insertsNeverFail: false, deleteSupport: true })
    expect(cuckoo.metrics.totalStashFailures).toBeGreaterThan(0) // Cuckoo 装载崖壁真拒插
    const ev = d!.crosscheck.evidence
    expect(Object.keys(ev).length).toBe(21)           // 十一真件 21 键真回读
    expect(ev.walReplayed).toBeGreaterThan(0)
    const fc = d!.crosscheck.fpCeiling
    expect(fc.holds).toBe(true)
    expect(fc.tamper.trustConfig.holds).toBe(false)   // 三路篡改真喂回现算翻 false
    expect(fc.tamper.zeroFpr.holds).toBe(false)
    expect(fc.tamper.skipProbe.holds).toBe(false)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.cuckooStashWall).toBe(true)
    // cell 级三布尔：前端/CLI  ladder 状态字只认真件算好的三布尔，绝不拿阈值重算
    const deleteCell = bloom.scenarios.find((s: any) => s.id === 'deleteCycle')!
    expect(deleteCell.deleteSupport).toBe(false)                 // Bloom 缺删
    expect(cb.scenarios.every((s: any) => s.compactFootprint === false)).toBe(true) // CB 六场景全吃空间
    const loadCell = cuckoo.scenarios.find((s: any) => s.id === 'highLoadSaturation')!
    expect(loadCell.insertsNeverFail).toBe(false)                // Cuckoo 高装载撞崖壁
    // rigged 透传：011/011/011 因果锁死 compactFootprint
    const rig = await runMeshE2E({ bloomFilter: { rigged: true } }).run()
    expect(rig.bloomFilterSnapshot!.vectors).toEqual({ Bloom: '011', CountingBloom: '011', Cuckoo: '011' })
    expect(rig.bloomFilterSnapshot!.verdict.compactFootprintCausallyUnerasable).toBe(true)
    expect(rig.bloomFilterSnapshot!.verdict.noUniversalWinner).toBe(false)
    // 未配 bloomFilter 时为 null（非破坏、不连坐其它维）
    const bare = await runMeshE2E().run()
    expect(bare.bloomFilterSnapshot).toBe(null)
    expect(bare.logCompactionSnapshot).toBe(null)
  })

  it("e2e KI-528：cacheReplacement=true ⇒ 主链照常跑通，cacheReplacementSnapshot 带三策略×六场景/三难向量 010/110/101/双路自证/十一真件交叉印证", async () => {
    const e = runMeshE2E({ cacheReplacement: true, crNow: () => 8888 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.cacheReplacementSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(8888)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ LRU: '010', '2Q': '110', ARC: '101' })
    const lru = d!.rows.find((row: any) => row.protocol === 'LRU')!
    const q2 = d!.rows.find((row: any) => row.protocol === '2Q')!
    const arc = d!.rows.find((row: any) => row.protocol === 'ARC')!
    expect(lru.trilemma).toEqual({ scanResistance: false, stableHitRate: true, adaptiveBalance: false })
    expect(q2.trilemma).toEqual({ scanResistance: true, stableHitRate: true, adaptiveBalance: false })
    expect(arc.trilemma).toEqual({ scanResistance: true, stableHitRate: false, adaptiveBalance: true })
    // cell 三布尔 + 考场标记直读同源（前端矩阵软肋字不靠阈值重算）
    const scanCell = lru.scenarios.find((s: any) => s.id === 'scanFeast')!
    expect(scanCell.scanResistance).toBe(false)
    expect(scanCell.inScanExam).toBe(true)
    expect(arc.scenarios.find((s: any) => s.id === 'zipfDrift')!.adaptiveBalance).toBe(true)
    const ev = d!.crosscheck.evidence
    expect(Object.keys(ev).length).toBe(21)
    expect(ev.jitterSpread).toBeGreaterThan(0)
    const ds = d!.crosscheck.dualSweep
    expect(ds.holds).toBe(true)
    expect(ds.tamper.laneATraceCorrupted.holds).toBe(false)
    expect(ds.tamper.laneBTraceCorrupted.holds).toBe(false)
    expect(ds.tamper.laneBSizedNull.holds).toBe(false)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    // rigged 透传：110/110/110 因果锁死 adaptiveBalance
    const rig = await runMeshE2E({ cacheReplacement: { rigged: true } }).run()
    expect(rig.cacheReplacementSnapshot!.vectors).toEqual({ LRU: '110', '2Q': '110', ARC: '110' })
    expect(rig.cacheReplacementSnapshot!.verdict.adaptiveBalanceCausallyUnerasable).toBe(true)
    expect(rig.cacheReplacementSnapshot!.verdict.noUniversalWinner).toBe(false)
    // 未配 cacheReplacement 时为 null（非破坏）
    const bare = await runMeshE2E().run()
    expect(bare.cacheReplacementSnapshot).toBe(null)
    expect(bare.bloomFilterSnapshot).toBe(null)
  })

  it("e2e KI-529：streamWindow=true ⇒ 主链照常跑通，streamWindowSnapshot 带三策略×六场景/三难向量 011/110/101/双路自证/十一真件交叉印证", async () => {
    const e = runMeshE2E({ streamWindow: true, swNow: () => 8888 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.streamWindowSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(8888)                  // swNow 注入时钟真求值
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ Tumbling: '011', Sliding: '110', Session: '101' })
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    // 双路自证稳态 + 三路篡改真喂回现算翻 false
    expect(d!.crosscheck.watermark.holds).toBe(true)
    expect(d!.crosscheck.watermark.nontrivial).toBe(true)
    expect(d!.crosscheck.watermark.tamper.watermarkInverted.holds).toBe(false)
    expect(d!.crosscheck.watermark.tamper.dispositionTampered.holds).toBe(false)
    expect(d!.crosscheck.watermark.tamper.emptySet.holds).toBe(false)
    // 十一真件 21 键
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // CLI 投影 ladder 软肋字口径与前端 swState 一致（只在 ===false 落 缺/迟/胀）
    const rig = await runMeshE2E({ streamWindow: { rigged: true } }).run()
    expect(rig.streamWindowSnapshot!.vectors).toEqual({ Tumbling: '011', Sliding: '011', Session: '011' })
    expect(rig.streamWindowSnapshot!.verdict.resultCompletenessCausallyUnerasable).toBe(true)
    expect(rig.streamWindowSnapshot!.verdict.noUniversalWinner).toBe(false)
    // 未配 streamWindow 时为 null（非破坏、不连坐其它维）
    const bare = await runMeshE2E().run()
    expect(bare.streamWindowSnapshot).toBe(null)
    expect(bare.cacheReplacementSnapshot).toBe(null)
    expect(bare.bloomFilterSnapshot).toBe(null)
    expect(bare.streamWindowSnapshot).toBe(null)
  })

  it("e2e KI-530：hyperLogLog=true ⇒ 主链透传、hyperLogLogSnapshot 双路现算、向量 101/110/010/双路自证/十一证据键", async () => {
    const e = runMeshE2E({ hyperLogLog: true, hllNow: () => 5300 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.hyperLogLogSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5300)                  // hllNow 注入时钟真值
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ ExactSet: '101', HyperLogLog: '110', LinearCounting: '010' })
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    // 双路自证恒等式 + 三路篡改现算翻 false
    expect(d!.crosscheck.estimate.holds).toBe(true)
    expect(d!.crosscheck.estimate.nontrivial).toBe(true)
    expect(d!.crosscheck.estimate.tamper.registerCorrupted.holds).toBe(false)
    expect(d!.crosscheck.estimate.tamper.emptySet.holds).toBe(false)
    expect(d!.crosscheck.estimate.tamper.bitsTooBig.holds).toBe(false)
    // 十一枚真件 21 键
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // rigged：预言机开关后 ExactSet 真收敛 111，HLL/LC 仍 110
    const rig = await runMeshE2E({ hyperLogLog: { rigged: true } }).run()
    expect(rig.hyperLogLogSnapshot!.vectors).toEqual({ ExactSet: '111', HyperLogLog: '110', LinearCounting: '010' })
    expect(rig.hyperLogLogSnapshot!.verdict.noUniversalWinner).toBe(false)
    expect(rig.hyperLogLogSnapshot!.verdict.trilemmaDistinguishes).toBe(true) // 111/110/010 三向量在 rigged 下依然互异（饱和相关容量——位图被填满不可抹）
    // 未配 hyperLogLog 时为 null、不装配不影响主链
    const bare = await runMeshE2E().run()
    expect(bare.hyperLogLogSnapshot).toBe(null)
  })

  it("e2e KI-531：crdt=true ⇒ 主链透传、crdtSnapshot 真跑，向量 011/100/110 / 双路自证 / 十一证据键 / rigged 因果锁", async () => {
    const e = runMeshE2E({ crdt: true, crdtNow: () => 5310 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.crdtSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5310)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    expect(d!.verdict.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.secStrictAllConverge).toBe(true)
    expect(d!.verdict.noUniversalWinner).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    // 双路自证 + 三路篡改现算翻 false
    expect(d!.crosscheck.convergence.holds).toBe(true)
    expect(d!.crosscheck.convergence.nontrivial).toBe(true)
    expect(d!.crosscheck.convergence.tamper.dropReplica.holds).toBe(false)
    expect(d!.crosscheck.convergence.tamper.reverseLwwDecision.holds).toBe(false)
    expect(d!.crosscheck.convergence.tamper.emptySet.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // rigged：三开关齐开唯一翻 GCounter compact（100→101），三因果结构锁钉死，主教义不破
    const rig = await runMeshE2E({ crdt: { rigged: true } }).run()
    expect(rig.crdtSnapshot!.vectors).toEqual({ LWWRegister: '011', GCounter: '101', OrSet: '110' })
    expect(rig.crdtSnapshot!.baseVectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    expect(rig.crdtSnapshot!.verdict.decrementCausallyUnerasable).toBe(true)
    expect(rig.crdtSnapshot!.verdict.lwwConcurrentLossCausallyUnerasable).toBe(true)
    expect(rig.crdtSnapshot!.verdict.orSetTagHistoryCausallyUnerasable).toBe(true)
    expect(rig.crdtSnapshot!.verdict.causalLocksAllHold).toBe(true)
    expect(rig.crdtSnapshot!.verdict.noUniversalWinner).toBe(true)
    expect(rig.crdtSnapshot!.verdict.noUniversalWinnerStrict).toBe(true)

    // 未配 crdt 时为 null、不连坐其它维
    const bare = await runMeshE2E().run()
    expect(bare.crdtSnapshot).toBe(null)
    expect(bare.hyperLogLogSnapshot).toBe(null)
  })

  it("e2e KI-532：springBatch=true ⇒ 主链透传、springBatchSnapshot 真跑，向量 001/110/101 / 双路自证 / 三路篡改真喂回 / 三因果锁 / rigged 诚实收敛", async () => {
    const e = runMeshE2E({ springBatch: true, sbNow: () => 5320 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.springBatchSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5320)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ BulkWriter: '001', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(d!.rigged).toBe(false)
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.noStrategyWinsAll).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    // 三因果结构锁
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.checkpointTradeoffCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.skipSilentLossCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.bulkAllOrNothingCausallyUnerasable).toBe(true)
    // verifyCheckpoint 双路自证 + 三路篡改现算翻 false（带 baselineHolds）
    expect(d!.crosscheck.checkpoint.holds).toBe(true)
    expect(d!.crosscheck.checkpoint.baselineHolds).toBe(true)
    expect(d!.crosscheck.checkpoint.falsifiable).toBe(true)
    expect(d!.crosscheck.checkpoint.tamper.corruptedCheckpoint.holds).toBe(false)
    expect(d!.crosscheck.checkpoint.tamper.silentPoison.holds).toBe(false)
    expect(d!.crosscheck.checkpoint.tamper.emptyJob.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // rigged：预防剔除毒项干净流 ⇒ Bulk≡Skip=101 区分度诚实收敛、noStrategyWinsAll 仍真、三锁钉死、主教义不破
    const rig = await runMeshE2E({ springBatch: { rigged: true } }).run()
    expect(rig.springBatchSnapshot!.vectors).toEqual({ BulkWriter: '101', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(rig.springBatchSnapshot!.trilemmaDistinguishes).toBe(false)
    expect(rig.springBatchSnapshot!.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.springBatchSnapshot!.verdict.noStrategyWinsAll).toBe(true)
    expect(rig.springBatchSnapshot!.verdict.bulkExplodesOnPoison).toBe(true)
    expect(rig.springBatchSnapshot!.causalLocks.causalLocksAllHold).toBe(true)
    // 主链非破坏：未配 springBatch 时为 null、不连坐 crdt/hyperLogLog 两维
    const bare = await runMeshE2E().run()
    expect(bare.springBatchSnapshot).toBe(null)
    expect(bare.crdtSnapshot).toBe(null)
    expect(bare.hyperLogLogSnapshot).toBe(null)
  })

  it("e2e KI-533：traceSampling=true ⇒ 主链透传、traceSamplingSnapshot 真跑，向量 100/010/101 / 双路自证 / 三路篡改真喂回 / 三因果锁 / rigged 诚实塌缩", async () => {
    const e = runMeshE2E({ traceSampling: true, tsNow: () => 5330 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.traceSamplingSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5330)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ HeadBasedSampler: '100', TailBasedSampler: '010', AdaptiveSampler: '101' })
    expect(d!.rigged).toBe(false)
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.noStrategyWinsAll).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    // 三因果结构锁（含翻转标签逐 id 决策恒同结构判据）
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.anomalyRequiresBufferingCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.headBlindnessCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.decisionInvariant).toBe(true)
    // 逐格三布尔由观测量现算（供前端矩阵状态字与 mesh ladder）
    for (const row of d!.rows) {
      expect(d!.vectors[row.protocol]).toBe(`${Number(row.trilemma.lowOverhead)}${Number(row.trilemma.anomalyCapture)}${Number(row.trilemma.loadAdaptive)}`)
      for (const c of row.scenarios) {
        expect(c.lowOverhead).toBe(c.peakBufferedSpans === 0)
        expect(c.loadAdaptive).toBe(c.rateChanges > 0)
      }
    }
    // verifySamplingSoundness 双路自证 + 三路篡改现算翻 false（带 baselineHolds）
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.baselineHolds).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.tamper.forgedErrorSpan.holds).toBe(false)
    expect(d!.crosscheck.soundness.tamper.duplicateRelease.holds).toBe(false)
    expect(d!.crosscheck.soundness.tamper.emptyTraceSet.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // rigged：三开关分策略正交反事实 ⇒ Head≡Tail=110 区分度诚实塌缩、noStrategyWinsAll 仍真、三锁钉死、主教义不破
    const rig = await runMeshE2E({ traceSampling: { rigged: true } }).run()
    expect(rig.traceSamplingSnapshot!.vectors).toEqual({ HeadBasedSampler: '110', TailBasedSampler: '110', AdaptiveSampler: '101' })
    expect(rig.traceSamplingSnapshot!.trilemmaDistinguishes).toBe(false)
    expect(rig.traceSamplingSnapshot!.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.traceSamplingSnapshot!.verdict.noStrategyWinsAll).toBe(true)
    expect(rig.traceSamplingSnapshot!.verdict.headBlindLossOnErrorBurst).toBe(true)
    expect(rig.traceSamplingSnapshot!.causalLocks.causalLocksAllHold).toBe(true)
    // 主链非破坏：未配 traceSampling 时为 null、不连坐 springBatch/crdt 两维
    const bare = await runMeshE2E().run()
    expect(bare.traceSamplingSnapshot).toBe(null)
    expect(bare.springBatchSnapshot).toBe(null)
    expect(bare.crdtSnapshot).toBe(null)
  })

  it("e2e KI-535：distributedSession=true ⇒ 主链透传、distributedSessionSnapshot 真跑，向量 011/101/110 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ distributedSession: true, dsNow: () => 5350 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.distributedSessionSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5350)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ StickySession: '011', JwtStateless: '101', RedisSessionStore: '110' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.verdict.redisPaysInfra).toBe(true)
    expect(d!.verdict.redisInstantRevoke).toBe(true)
    expect(d!.verdict.jwtNoInstantRevoke).toBe(true)
    expect(d!.verdict.stickyFailsOverLoss).toBe(true)
    // 双路自证 + 三路篡改现算翻 false
    expect(d!.crosscheck.coherence.holds).toBe(true)
    expect(d!.crosscheck.coherence.nontrivial).toBe(true)
    expect(d!.crosscheck.coherence.falsifiable).toBe(true)
    expect(d!.crosscheck.coherence.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // 三因果锁
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.stickySingleNodeCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.jwtNoInstantRevokeCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.redisColdStartCausallyUnerasable).toBe(true)
    // 成对零破坏
    const bare2 = await runMeshE2E().run()
    expect(bare2.distributedSessionSnapshot).toBe(null)
    expect(bare2.springBatchSnapshot).toBe(null)
  })

  it("e2e KI-534：transactionalOutbox=true ⇒ 主链透传、transactionalOutboxSnapshot 真跑，向量 011/101/110 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ transactionalOutbox: true, toNow: () => 5340 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.transactionalOutboxSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5340)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ DualWrite: '011', PollingOutbox: '101', CdcOutbox: '110' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.verdict.dualWriteLosesOnCrash).toBe(true)
    expect(d!.verdict.pollingNoDup).toBe(true)
    expect(d!.verdict.cdcDuplicatesOnHalfCrash).toBe(true)
    // 双路自证 + 三路篡改现算翻 false
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.nontrivial).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.tamper.duplicateRelease.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // 三因果锁
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.atomicDeliveryRequiresOutboxCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.atLeastOnceRequiresDedupCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.zeroLatencyNeedsCdcReplayCausallyUnerasable).toBe(true)
    const bare3 = await runMeshE2E().run()
    expect(bare3.transactionalOutboxSnapshot).toBe(null)
    expect(bare3.distributedSessionSnapshot).toBe(null)
  })

  it("e2e KI-536：loadBalance=true ⇒ 主链透传、loadBalanceSnapshot 真跑，向量 101/100/011 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ loadBalance: true, lbNow: () => 5360 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.loadBalanceSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5360)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ WeightedRoundRobin: '101', LeastConnections: '100', ConsistentHash: '011' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.verdict.chStickyOutperformsRR).toBe(true)
    expect(d!.verdict.hashSkewPersists).toBe(true)
    // 双路自证 + 三路篡改现算翻 false
    expect(d!.crosscheck.routing.holds).toBe(true)
    expect(d!.crosscheck.routing.nontrivial).toBe(true)
    expect(d!.crosscheck.routing.falsifiable).toBe(true)
    expect(d!.crosscheck.routing.tamper.emptyRing.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // 三因果锁
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.roundRobinBlindToLoadCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.leastConnRequiresSharedCountersCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.consistentHashSkewCausallyUnerasable).toBe(true)
    const bare4 = await runMeshE2E().run()
    expect(bare4.loadBalanceSnapshot).toBe(null)
    expect(bare4.transactionalOutboxSnapshot).toBe(null)
  })

  it("e2e KI-537：circuitBreaker=true ⇒ 主链透传、circuitBreakerSnapshot 真跑，向量 100/101/011 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ circuitBreaker: true, cbNow: () => 5370 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.circuitBreakerSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5370)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ CountBasedBreaker: '100', RateBasedBreaker: '101', SlowCallBreaker: '011' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.verdict.slowCallBlindToFailures).toBe(true)
    expect(d!.verdict.countBlindToSlow).toBe(true)
    expect(d!.verdict.rateSafeOnSparse).toBe(true)
    // 双路自证 + 三路篡改现算翻 false
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.nontrivial).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // 三因果锁
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.countThresholdIgnoresSlowCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.rateThresholdRequiresSampleCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.slowCallIgnoresHardFaultsCausallyUnerasable).toBe(true)
    const bare5 = await runMeshE2E().run()
    expect(bare5.circuitBreakerSnapshot).toBe(null)
    expect(bare5.loadBalanceSnapshot).toBe(null)
  })

  it("e2e KI-538：llmGateway=true ⇒ 主链透传、llmGatewaySnapshot 真跑，默认向量 011/000/000 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ llmGateway: true, lgNow: () => 5380 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.llmGatewaySnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5380)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors.OfflineDouble).toBe('011')
    expect(d!.vectors.LiveGrounded).toBe('000')
    expect(d!.vectors.CachedLive).toBe('000')
    expect(d!.trilemmaDistinguishes).toBe(false)
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    // 双路自证
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.tamper.badJson.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // 未配时 null、不连坐
    const bare6 = await runMeshE2E().run()
    expect(bare6.llmGatewaySnapshot).toBe(null)
    expect(bare6.circuitBreakerSnapshot).toBe(null)
  })

  it("e2e KI-539：gatewayRouting=true ⇒ 主链透传、gatewayRoutingSnapshot 真跑，向量 001/110/101 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ gatewayRouting: true, grNow: () => 5390 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.gatewayRoutingSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5390)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ PathPrefixRouting: '001', RegexCaptureRouting: '110', HeaderGroupRouting: '101' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.verdict.pathFindsHashMiss).toBe(true)
    expect(d!.verdict.regexDistinguishesLabs).toBe(true)
    expect(d!.verdict.headerGroupNotPowered).toBe(true)
    // 双路自证 + 三路篡改现算翻 false
    expect(d!.crosscheck.routing.holds).toBe(true)
    expect(d!.crosscheck.routing.nontrivial).toBe(true)
    expect(d!.crosscheck.routing.falsifiable).toBe(true)
    expect(d!.crosscheck.routing.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // 三因果锁
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.pathPrefixMatchingConflictsCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.regexCaptureExtraCostCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.headerGroupHeaderDependencyCausallyUnerasable).toBe(true)
    const bare7 = await runMeshE2E().run()
    expect(bare7.gatewayRoutingSnapshot).toBe(null)
    expect(bare7.llmGatewaySnapshot).toBe(null)
  })

  it("e2e KI-540：idempotentConsumer=true ⇒ 主链透传、idempotentConsumerSnapshot 真跑，向量 110/101/011 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ idempotentConsumer: true, idcNow: () => 5400 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.idempotentConsumerSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5400)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ InMemoryDedupSet: '110', RedisSetNx: '101', BloomGuard: '011' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.verdict.memPureCrash).toBe(true)
    expect(d!.verdict.redisStillExact).toBe(true)
    expect(d!.verdict.bloomOverheads).toBe(true)
    // 双路自证 + 三路篡改现算翻 false
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.nontrivial).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.laneA.consistentAcceptedInMemory).toBe(96)
    expect(d!.crosscheck.soundness.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // 三因果锁
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.bloomFalsePositiveCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.redisRttCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.inMemoryVolatilityCausallyUnerasable).toBe(true)
    const bare7 = await runMeshE2E().run()
    expect(bare7.idempotentConsumerSnapshot).toBe(null)
    expect(bare7.gatewayRoutingSnapshot).toBe(null)
  })

  it("e2e KI-541：consumerRebalance=true ⇒ 主链透传、consumerRebalanceSnapshot 真跑，向量 011/101/110 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ consumerRebalance: true, rebNow: () => 5410 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.consumerRebalanceSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5410)
    expect(d!.config.scenarios.length).toBe(6)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ Eager: '011', CooperativeSticky: '101', StaticMembership: '110' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.verdict.eagerFullStop).toBe(true)
    expect(d!.verdict.coopIncremental).toBe(true)
    expect(d!.verdict.staticStaleFree).toBe(true)
    // 双路自证 + 三路篡改现算翻 false
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.nontrivial).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.laneA.eagerCovered).toBe(true)
    expect(d!.crosscheck.soundness.tamper.emptyMembership.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    // 三因果锁
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.eagerPauseCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.cooperativeIncrementalComplexityCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.staticSessionTimeoutCausallyUnerasable).toBe(true)
    const bare8 = await runMeshE2E().run()
    expect(bare8.consumerRebalanceSnapshot).toBe(null)
    expect(bare8.idempotentConsumerSnapshot).toBe(null)
  })

  it("e2e KI-542：priorityQueue=true ⇒ 主链透传、priorityQueueSnapshot 真跑，向量 100/010/101 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ priorityQueue: true, pqNow: () => 5420 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.priorityQueueSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5420)
    expect(d!.config.scenarios.length).toBe(4)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ BoundedStrict: '100', MotionWeightedFair: '010', DeadlineScheduler: '101' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.nontrivial).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.tamper.deadlineBlind.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    expect(d!.causalLocks.strictStarvationCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.fairVtimeAccountingCausallyUnerasable).toBe(true)
    expect(d!.causalLocks.deadlineBlindnessCausallyUnerasable).toBe(true)
    const bare9 = await runMeshE2E().run()
    expect(bare9.priorityQueueSnapshot).toBe(null)
    expect(bare9.consumerRebalanceSnapshot).toBe(null)
  })

  it("e2e KI-543：batchStreamJoin=true ⇒ 主链透传、batchStreamJoinSnapshot 真跑，向量 101/010/110 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ batchStreamJoin: true, bsjNow: () => 5430 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.batchStreamJoinSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5430)
    expect(d!.config.scenarios.length).toBe(4)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ MicroBatchJoin: '101', StreamWindowJoin: '010', CdcOutboxJoin: '110' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.nontrivial).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.tamper.cdcDupe.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    const bare10 = await runMeshE2E().run()
    expect(bare10.batchStreamJoinSnapshot).toBe(null)
    expect(bare10.priorityQueueSnapshot).toBe(null)
  })

  it("e2e KI-544：cdcOutboxJoin=true ⇒ 主链透传、cdcOutboxJoinSnapshot 真跑，向量 101/011/100 / 双路自证 + 三路篡改 + 三因果锁", async () => {
    const e = runMeshE2E({ cdcOutboxJoin: true, cojNow: () => 5440 })
    const r = await e.run()
    expect(r.started?.registered).toBe(true)
    expect(r.callRes?.ok).toBe(true)
    const d = r.cdcOutboxJoinSnapshot
    expect(d).not.toBe(null)
    expect(d!.builtAt).toBe(5440)
    expect(d!.config.scenarios.length).toBe(4)
    expect(d!.rows.length).toBe(3)
    expect(d!.vectors).toEqual({ LsmSnapshotJoin: '101', RawBinlogJoin: '011', OutboxAtomicJoin: '100' })
    expect(d!.noUniversalWinner).toBe(true)
    expect(d!.trilemmaDistinguishes).toBe(true)
    expect(d!.verdict.vectorFromTrilemma).toBe(true)
    expect(d!.crosscheck.soundness.holds).toBe(true)
    expect(d!.crosscheck.soundness.nontrivial).toBe(true)
    expect(d!.crosscheck.soundness.falsifiable).toBe(true)
    expect(d!.crosscheck.soundness.tamper.atomicLatchLeak.holds).toBe(false)
    expect(Object.keys(d!.crosscheck.evidence).length).toBe(21)
    expect(d!.causalLocks.causalLocksAllHold).toBe(true)
    const bare11 = await runMeshE2E().run()
    expect(bare11.cdcOutboxJoinSnapshot).toBe(null)
    expect(bare11.batchStreamJoinSnapshot).toBe(null)
  })
})
