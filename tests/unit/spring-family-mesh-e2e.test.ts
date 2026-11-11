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
})
