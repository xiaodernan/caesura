import { describe, expect, it } from 'vitest'
import { createGameCloud } from '../../scripts/caesura-game-cloud.mjs'

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

describe('caesura-game-cloud', () => {
  it('createGameCloud 收口了 runtime 与 proxy', () => {
    const gc = createGameCloud({ gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud() })
    expect(gc.runtime).toBeTruthy()
    expect(gc.proxy).toBeTruthy()
    expect(typeof gc.start).toBe('function')
    expect(typeof gc.proxyCall).toBe('function')
  })

  it('start 注册游戏并广播 lifecycle:started 与 runtime:booted', async () => {
    const cloud = fakeCloud()
    const gc = createGameCloud({ gameId: 'g1', gamePort: 7700, sources, cloud })
    await gc.start()
    expect(cloud.published.some(([e, p]) => e === 'caesura.lifecycle' && (p as any)?.type === 'game.started')).toBe(true)
    expect(cloud.published.some(([e]) => e === 'caesura.runtime.booted')).toBe(true)
  })

  it('proxyCall 经负载均衡 + 进程内熔断返回数据', async () => {
    const cloud = fakeCloud()
    const calls: any[] = []
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources, cloud,
      transport: async (t: any, p: string) => { calls.push({ t, p }); return { echo: p } },
    })
    gc.runtime.routes.add({ id: 'r1', uri: 'lb://svc-a', order: 0, predicates: [{ name: 'Path', args: { patterns: '/api/**' } }], filters: [] })
    const res = await gc.proxyCall('svc-a', '/api/ping')
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ echo: '/api/ping' })
    expect(calls.length).toBe(1)
  })

  it('shutdown 注销游戏并广播 lifecycle:stopped 与 runtime:stopped', async () => {
    const cloud = fakeCloud()
    const gc = createGameCloud({ gameId: 'g1', gamePort: 7700, sources, cloud })
    await gc.start()
    await gc.shutdown()
    expect(cloud.published.some(([e, p]) => e === 'caesura.lifecycle' && (p as any)?.type === 'game.stopped')).toBe(true)
    expect(cloud.published.some(([e]) => e === 'caesura.runtime.stopped')).toBe(true)
  })

  it('status 汇总已聚合服务', async () => {
    const gc = createGameCloud({ gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud() })
    const s = await gc.status()
    expect(s.services).toContain('svc-a')
  })

  it('events 总线可用：start 后收到 game.started 事件，shutdown 后收到 game.stopped', async () => {
    const gc = createGameCloud({ gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud() })
    const got: any[] = []
    gc.events.onGameEvent('game.started', (p: any) => got.push(['started', p]))
    gc.events.onGameEvent('game.stopped', (p: any) => got.push(['stopped', p]))
    await gc.start()
    expect(got).toEqual([['started', { gameId: 'g1', gameName: 'g1' }]])
    await gc.shutdown()
    expect(got[1][0]).toBe('stopped')
  })

  it('auth 守卫可用：authenticate 解析 Bearer 返回 claims，canAccess 判定作用域', () => {
    const gc = createGameCloud({ gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud(), requiredScopes: ['game:play'] })
    const b64 = (obj: any) =>
      Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const token = `${b64({ alg: 'none' })}.${b64({ sub: 'u1', scope: 'game:play', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
    const claims = gc.auth.authenticate(`Bearer ${token}`)
    expect(claims.sub).toBe('u1')
    expect(gc.auth.canAccess(claims, 'game:play')).toBe(true)
    expect(gc.auth.requiredScopes).toEqual(['game:play'])
  })

  it('connectGameBus 把游戏真事件桥进云总线，shutdown 自动退桥（KI-489）', async () => {
    const gc = createGameCloud({ gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud() })
    const handlers = new Map<string, Set<Function>>()
    const gameBus = {
      on: (k: string, fn: Function) => {
        if (!handlers.has(k)) handlers.set(k, new Set())
        handlers.get(k)!.add(fn)
        return () => handlers.get(k)?.delete(fn)
      },
      emit: (k: string, p: any) => { for (const fn of [...(handlers.get(k) ?? [])]) fn(p) },
    }
    let crossed: any = null
    const off = gc.events.onGameEvent('game.boss.phase', (p: any) => { crossed = p })
    const inst = gc.connectGameBus(gameBus, [{ from: 'game', key: 'boss.phase', type: 'game.boss.phase' }])
    expect(inst.installed).toBe(true)
    expect(gc.bridge().isInstalled()).toBe(true)
    gameBus.emit('boss.phase', { id: 'b', phase: 1 })
    await Promise.resolve()
    expect(crossed).toEqual({ id: 'b', phase: 1 })
    const r = await gc.shutdown()
    expect(r.bridgeOff.removed).toBe(1)
    expect(handlers.get('boss.phase')?.size).toBe(0)
    off()
  })

  it('gray/lbStrategy 透传到 runtime，gc.gray 与 status 可见（KI-491）', async () => {
    const graySources = {
      graySrc: () => [
        { id: 'stable:1', name: 'gray-svc', address: '10.0.2.1', port: 8080, healthy: true, metadata: { version: 'v1' } },
        { id: 'can:1', name: 'gray-svc', address: '10.0.2.2', port: 8080, healthy: true, metadata: { version: 'v2' } },
      ],
    }
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources: graySources, cloud: fakeCloud(), lbStrategy: 'weight', gateway: false,
      gray: { canaryPercent: 100, grayField: 'version', canaryValue: 'v2', stickyHeader: 'x-p', selector: () => 0 },
      transport: async () => ({ ok: true }),
    })
    expect(gc.gray).toBeTruthy()
    expect(gc.gray.canaryValue).toBe('v2')
    const r = await gc.call('gray-svc', '/api/x', { headers: { 'x-p': 'u' } })
    expect(r.gray).toMatchObject({ lane: 'canary', fallback: false })
    const s = await gc.status()
    expect(s.gray.canaryPercent).toBe(100)
    expect(s.gray.stats.decisions).toBeGreaterThanOrEqual(1)

    // 未配 gray 时 gc.gray 为 null（非破坏）
    const plain = createGameCloud({ gameId: 'g2', gamePort: 7701, sources, cloud: fakeCloud() })
    expect(plain.gray).toBe(null)
  })

  it('authCache=true 装配 introspection 缓存，gc.authCache 与 status 可见（KI-493）', async () => {
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud(),
      authCache: true, authCacheTtlMs: 1000, requiredScopes: ['game:play'],
    })
    expect(gc.authCache).toBeTruthy()
    expect(typeof gc.authCache.get).toBe('function')
    expect(gc.auth.cacheStats()).toMatchObject({ hits: 0, entries: 0 })
    const s = await gc.status()
    expect(s.authCache).toMatchObject({ hits: 0, entries: 0 })
    expect(s.authScopes).toEqual(['game:play'])
    // 未配 authCache 时 gc.authCache 为 null、cacheStats 为 null（非破坏）
    const plain = createGameCloud({ gameId: 'g2', gamePort: 7701, sources, cloud: fakeCloud() })
    expect(plain.authCache).toBe(null)
    expect(plain.auth.cacheStats()).toBe(null)
  })

  it('net=true 装配计网可观测包，真实 call 喂 AIMD/RTO，status.net 可见（KI-494）', async () => {
    let t = 0
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud(), gateway: false,
      net: true, netNow: () => t,
      transport: async () => { t += 5; return { ok: true } },
    })
    expect(gc.net).toBeTruthy()
    expect(gc.net!.snapshot().observes).toBe(0)
    // 三次成功调用：每次都真喂一次 ACK + RTO 样本；RTO 估计首个样本 SRTT=5/RTTVAR=2.5/RTO=15。
    await gc.call('svc-a', '/api/x')
    await gc.call('svc-a', '/api/x')
    await gc.call('svc-a', '/api/x')
    const snap = gc.net!.snapshot()
    expect(snap.observes).toBe(3)
    expect(snap.aimd.cwnd).toBeGreaterThan(1) // 慢启动 ACK 增长
    expect(snap.rto.srtt).toBeGreaterThan(0) // RTT 样本被真采到
    const s = await gc.status()
    expect(s.net.observes).toBe(3)
    expect(s.net.window.windowSize).toBeGreaterThan(0)
    // 未配 net 时 gc.net 为 null、status.net 为 null（非破坏）
    const plain = createGameCloud({ gameId: 'g2', gamePort: 7701, sources, cloud: fakeCloud() })
    expect(plain.net).toBe(null)
    expect((await plain.status()).net).toBe(null)
  })

  it('store=true 装配 LSM 存储引擎，gc.store 可读写、status.store 可见（KI-496）', async () => {
    let t = 5000
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud(),
      store: { memtableMax: 4, levelMultiplier: 2 }, storeNow: () => (t += 1),
    })
    expect(gc.store).toBeTruthy()
    expect(typeof gc.store!.put).toBe('function')
    expect(gc.store!.stats().flushes).toBe(0)
    // 真写读 + flush/compact：结构读数走 status 暴露、不改任何调用路径。
    for (let i = 0; i < 12; i++) gc.store!.put('k' + i, i)
    expect(gc.store!.get('k3').value).toBe(3)
    gc.store!.flush?.()
    gc.store!.compact?.()
    const st = await gc.status()
    expect(st.store.flushes).toBeGreaterThan(0)
    expect(st.store.compactions).toBeGreaterThan(0)
    expect(st.store.uniqueKeys).toBe(12)
    expect(st.store.builtAt).toBeGreaterThan(5000)
    // 未配 store 时 gc.store 为 null、status.store 为 null（非破坏，与 net/authCache 同款）
    const plain = createGameCloud({ gameId: 'g2', gamePort: 7701, sources, cloud: fakeCloud() })
    expect(plain.store).toBe(null)
    expect((await plain.status()).store).toBe(null)
  })

  it('hw:true 装配 OS/硬件对照包，status.hw 读三件确定性证据（KI-497）', async () => {
    let t = 9000
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud(),
      hw: { poolAccesses: 500, counterCount: 6 }, hwNow: () => (t += 1),
    })
    expect(gc.hw).toBeTruthy()
    expect(typeof gc.hw!.snapshot).toBe('function')
    const st = await gc.status()
    expect(st.hw.builtAt).toBeGreaterThan(9000)
    // 对象池：500 次取还只 new 一次。
    expect(st.hw.allocation).toMatchObject({ accesses: 500, naiveCreated: 500, poolCreated: 1, saved: 499 })
    // cache line：padded 零假共享、packed 有假共享。
    expect(st.hw.cacheLine.paddedFalseSharing).toBe(0)
    expect(st.hw.cacheLine.packedFalseSharing).toBeGreaterThan(0)
    // 布局：顺序扫 SoA 更快（speedup>1）、跳跃扫退化到 ≈1。
    expect(st.hw.layout.sequential.speedup).toBeGreaterThan(1)
    expect(st.hw.layout.strided.speedup).toBeCloseTo(1, 1)
    // 未配 hw 时 gc.hw 为 null、status.hw 为 null（非破坏，与 net/store 同款）
    const plain = createGameCloud({ gameId: 'g2', gamePort: 7701, sources, cloud: fakeCloud() })
    expect(plain.hw).toBe(null)
    expect((await plain.status()).hw).toBe(null)
  })

  it('hashRing:true 装配一致性哈希环，status.hashRing 读扩容最小重映射证据（KI-499）', async () => {
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud(),
      hashRing: { nodes: ['a', 'b', 'c'], remappingKeys: 1000 }, hashNow: () => 8888,
    })
    expect(gc.hashRing).toBeTruthy()
    expect(gc.hashRing!.nodeIds()).toEqual(['a', 'b', 'c'])
    expect(typeof gc.shardRouter).toBe('function')
    // 分片路由同 key 恒落同片。
    const router = gc.shardRouter!()
    expect(router.route('key:42').shard).toBe(router.route('key:42').shard)
    const st = await gc.status()
    expect(st.hashRing.builtAt).toBe(8888)
    expect(st.hashRing.ring.nodes).toEqual(['a', 'b', 'c'])
    expect(st.hashRing.ring.virtualPoints).toBeGreaterThan(0)
    // 扩容最小重映射：一致性 < 取模，且趋理论下界 0.25。
    expect(st.hashRing.grow.consistentRate).toBeLessThan(st.hashRing.grow.moduloRate)
    expect(st.hashRing.grow.consistentRate).toBeLessThan(0.4)
    expect(st.hashRing.grow.moduloRate).toBeGreaterThan(0.4)
    expect(st.hashRing.grow.theoreticalRate).toBeCloseTo(0.25, 2)
    expect(st.hashRing.grow.delta).toBe(1)
    expect(st.hashRing.distribution.emptyNodes).toEqual([])
    // 惰性缓存：两次 status 读数逐字一致（不反复跑 benchmark）。
    expect((await gc.status()).hashRing).toBe(st.hashRing)
  })

  it('hashRing 默认 null 非破坏；可注入现成 ring（KI-499）', async () => {
    const plain = createGameCloud({ gameId: 'g2', gamePort: 7701, sources, cloud: fakeCloud() })
    expect(plain.hashRing).toBe(null)
    expect(plain.shardRouter).toBe(null)
    expect((await plain.status()).hashRing).toBe(null)
    // 窑口注入一只现成 ring（有 lookup 方法）也能装配。
    const { createHashRing } = await import('../../scripts/caesura-consistent-hash.mjs')
    const ring = createHashRing({ nodes: ['x', 'y'] })
    const injected = createGameCloud({ gameId: 'g3', gamePort: 7702, sources, cloud: fakeCloud(), hashRing: ring, hashNow: () => 1 })
    expect(injected.hashRing).toBe(ring)
    expect((await injected.status()).hashRing.ring.nodes).toEqual(['x', 'y'])
  })

  it('shardedCache:true 装配分片缓存，status.shardedCache 读命中率保留率证据（KI-500）', async () => {
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud(),
      shardedCache: { shards: ['a', 'b', 'c'], retentionKeys: 1000 }, cacheNow: () => 7777,
    })
    expect(gc.shardedCache).toBeTruthy()
    expect(gc.shardedCache!.shards).toEqual(['a', 'b', 'c'])
    // 真读写落片。
    gc.shardedCache!.set('k1', 1)
    expect(gc.shardedCache!.get('k1')).toBe(1)
    const st = await gc.status()
    expect(st.shardedCache.builtAt).toBe(7777)
    expect(st.shardedCache.cache.shards).toEqual(['a', 'b', 'c'])
    expect(st.shardedCache.cache.perShard['a'].entries).toBeGreaterThanOrEqual(0)
    // 扩缩容保留率：一致性哈希 > 取模，趋理论 0.75。
    expect(st.shardedCache.retention.consistentRetention).toBeGreaterThan(st.shardedCache.retention.moduloRetention)
    expect(st.shardedCache.retention.consistentRetention).toBeGreaterThan(0.6)
    expect(st.shardedCache.retention.consistentRetention).toBeLessThan(0.85)
    expect(st.shardedCache.retention.theoretical).toBeCloseTo(0.75, 2)
    expect(st.shardedCache.retention.savedRate).toBeGreaterThan(0.1)
    // 惰性缓存：两次 status 不反复预热 benchmark。
    expect((await gc.status()).shardedCache).toBe(st.shardedCache)
  })

  it('shardedCache 默认 null 非破坏；可注入现成实例（KI-500）', async () => {
    const plain = createGameCloud({ gameId: 'g2', gamePort: 7701, sources, cloud: fakeCloud() })
    expect(plain.shardedCache).toBe(null)
    expect((await plain.status()).shardedCache).toBe(null)
    const { createShardedCache } = await import('../../scripts/caesura-sharded-cache.mjs')
    const cache = createShardedCache({ shards: ['x', 'y'] })
    const injected = createGameCloud({ gameId: 'g3', gamePort: 7702, sources, cloud: fakeCloud(), shardedCache: cache, cacheNow: () => 1 })
    expect(injected.shardedCache).toBe(cache)
    expect((await injected.status()).shardedCache.cache.shards).toEqual(['x', 'y'].sort())
  })

  it('cacheGuard:true 装配防护三件套，status.cacheGuard 读三件对照证据、惰性同引用（KI-501）', async () => {
    const gc = createGameCloud({
      gameId: 'g1', gamePort: 7700, sources, cloud: fakeCloud(),
      cacheGuard: { concurrency: 16, keys: 128, rounds: 3 }, guardNow: () => 6666,
    })
    expect(gc.runCacheGuardStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.cacheGuard.builtAt).toBe(6666)
    // 击穿：N 并发合并到 1 次
    expect(st.cacheGuard.stampede.naiveLoads).toBe(16)
    expect(st.cacheGuard.stampede.singleflightLoads).toBe(1)
    expect(st.cacheGuard.stampede.savedLoads).toBe(15)
    // 穿透：空值墓碑 / 布隆都明显省回源
    expect(st.cacheGuard.penetration.negativeDbHits).toBeLessThan(st.cacheGuard.penetration.naiveDbHits)
    expect(st.cacheGuard.penetration.bloomDbHits).toBeLessThan(st.cacheGuard.penetration.naiveDbHits)
    // 雪崩：抖动削峰
    expect(st.cacheGuard.avalanche.jitterPeak).toBeLessThan(st.cacheGuard.avalanche.uniformPeak)
    expect(st.cacheGuard.avalanche.peakReduction).toBeGreaterThan(0)
    // 惰性缓存：两次 status 同一引用，不反复跑对照
    expect((await gc.status()).cacheGuard).toBe(st.cacheGuard)
    // runCacheGuardStudy 可重跑、确定性（同注入 now）
    const rerun = await gc.runCacheGuardStudy!()
    expect(rerun.stampede).toEqual(st.cacheGuard.stampede)
  })

  it('cacheGuard 默认 null 非破坏；可注入现成 study（KI-501）', async () => {
    const plain = createGameCloud({ gameId: 'g2', gamePort: 7701, sources, cloud: fakeCloud() })
    expect(plain.runCacheGuardStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.cacheGuard).toBe(null)
    expect(ps.hashRing).toBe(null)
    expect(ps.shardedCache).toBe(null)
    // 注入一只现成 study：直接用、不重跑，builtAt 原样带出。
    const { cacheGuardStudy } = await import('../../scripts/caesura-cache-guard.mjs')
    const study = await cacheGuardStudy({ concurrency: 4, keys: 32, now: () => 123 })
    const injected = createGameCloud({
      gameId: 'g3', gamePort: 7702, sources, cloud: fakeCloud(),
      cacheGuard: study, guardNow: () => 999,
    })
    const st = await injected.status()
    expect(st.cacheGuard.builtAt).toBe(123) // 注入 study 的 builtAt，不被 guardNow 覆盖
    expect(st.cacheGuard.stampede.singleflightLoads).toBe(1)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('rateLimit=true ⇒ 装配限流族、status.rateLimit 读真对照证据（KI-502）', async () => {
    const gc = createGameCloud({
      gameId: 'grl', gamePort: 7710, sources, cloud: fakeCloud(),
      rateLimit: { concurrency: 16, capacity: 4, redisCapacity: 4 }, rlNow: () => 6666,
    })
    expect(gc.runRateLimiterStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.rateLimit.builtAt).toBe(6666)
    // 五算法突发对照：固定窗口 2× 边界突发，其余压在 1
    expect(st.rateLimit.strategies.fixedWindow.burstRatio).toBe(2)
    expect(st.rateLimit.strategies.slidingLog.burstRatio).toBe(1)
    expect(st.rateLimit.verdict.fixedWindowBurst).toBe(true)
    // Redis 原子 vs 非原子：原子不超发、非原子超发、跨实例共享一致
    expect(st.rateLimit.redis.atomicAllowed).toBeLessThanOrEqual(st.rateLimit.redis.capacity)
    expect(st.rateLimit.redis.nonAtomicAllowed).toBeGreaterThan(st.rateLimit.redis.capacity)
    expect(st.rateLimit.redis.overshoot).toBeGreaterThan(0)
    expect(st.rateLimit.redis.shared.consistent).toBe(true)
    // 惰性缓存：两次 status 同一引用
    expect((await gc.status()).rateLimit).toBe(st.rateLimit)
    // 现算入口可重跑、确定性
    const rerun = await gc.runRateLimiterStudy!()
    expect(rerun.algorithms.strategies.fixedWindow.burstRatio).toBe(2)
  })

  it('rateLimit 默认 null 非破坏；可注入现成 study（KI-502）', async () => {
    const plain = createGameCloud({ gameId: 'grl2', gamePort: 7711, sources, cloud: fakeCloud() })
    expect(plain.runRateLimiterStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.rateLimit).toBe(null)
    expect(ps.hashRing).toBe(null)
    expect(ps.cacheGuard).toBe(null)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出。
    const { rateLimiterStudy } = await import('../../scripts/caesura-rate-limiter.mjs')
    const study = await rateLimiterStudy({ now: () => 123, concurrency: 8 })
    const injected = createGameCloud({
      gameId: 'grl3', gamePort: 7712, sources, cloud: fakeCloud(),
      rateLimit: study, rlNow: () => 999,
    })
    const st = await injected.status()
    expect(st.rateLimit.builtAt).toBe(123) // 注入 study 的 builtAt，不被 rlNow 覆盖
    expect(st.rateLimit.strategies.fixedWindow.burstRatio).toBe(2)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('failureDetector:true ⇒ 装配故障检测器、status.failureDetector 读真对照/三态/健康视图证据、惰性同引用（KI-503）', async () => {
    const gc = createGameCloud({
      gameId: 'gfd1', gamePort: 7713, sources, cloud: fakeCloud(),
      failureDetector: { stableCount: 20, spikeCount: 2 }, fdNow: () => 6666,
    })
    expect(gc.runFailureDetectorStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.failureDetector.builtAt).toBe(6666)
    expect(st.failureDetector.fixed.falsePositives).toBeGreaterThan(st.failureDetector.phi.falsePositives)
    expect(st.failureDetector.phi.falsePositives).toBe(0)
    expect(st.failureDetector.verdict.bothDetectRealFailure).toBe(true)
    expect(st.failureDetector.verdict.fixedFasterButNoisier).toBe(true)
    expect(st.failureDetector.swim.counts.total).toBeGreaterThan(0)
    expect(st.failureDetector.swim.script.indirectRescued).toBe(true)
    expect(st.failureDetector.health.nodes).toContain('gate-a')
    // 惰性缓存：二次 status 同引用，不反复跑对照
    expect((await gc.status()).failureDetector).toBe(st.failureDetector)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runFailureDetectorStudy!()
    expect(rerun.comparison.verdict).toEqual(st.failureDetector.verdict)
  })

  it('failureDetector 默认 null 非破坏；可注入现成 study（KI-503）', async () => {
    const plain = createGameCloud({ gameId: 'gfd2', gamePort: 7714, sources, cloud: fakeCloud() })
    expect(plain.runFailureDetectorStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.failureDetector).toBe(null)
    expect(ps.rateLimit).toBe(null)
    expect(ps.cacheGuard).toBe(null)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出。
    const { failureDetectorStudy } = await import('../../scripts/caesura-failure-detector.mjs')
    const study = await failureDetectorStudy({ now: () => 123, compare: { stableCount: 16 } })
    const injected = createGameCloud({
      gameId: 'gfd3', gamePort: 7715, sources, cloud: fakeCloud(),
      failureDetector: study, fdNow: () => 999,
    })
    const st = await injected.status()
    expect(st.failureDetector.builtAt).toBe(123) // 注入 study 的 builtAt，不被 fdNow 覆盖
    expect(st.failureDetector.verdict.bothDetectRealFailure).toBe(true)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('bplusIndex:true ⇒ 装配 B+ 树对照、status.bplusIndex 读真三笔账证据、惰性同引用（KI-504）', async () => {
    const gc = createGameCloud({
      gameId: 'gbp1', gamePort: 7716, sources, cloud: fakeCloud(),
      bplusIndex: { keyCount: 256, order: 8, leafCapacity: 8 }, bpNow: () => 8888,
    })
    expect(gc.runBplusStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.bplusIndex.builtAt).toBe(8888)
    expect(st.bplusIndex.structure.invariants).toBe(0) // 真 B+ 树不变式全过
    expect(st.bplusIndex.structure.height).toBeGreaterThanOrEqual(2)
    expect(st.bplusIndex.agreement.bothAgree).toBe(true) // 与 LSM 答案逐条一致
    expect(st.bplusIndex.point.bplusComparisons).toBeGreaterThan(0)
    expect(st.bplusIndex.point.lsmComparisons).toBeGreaterThan(0)
    expect(st.bplusIndex.range.lsmSortComparisons).toBeGreaterThan(0)
    expect(st.bplusIndex.write.bplusPageRewrites).toBeGreaterThan(0)
    expect(st.bplusIndex.write.lsmSeqWriteUnits).toBeGreaterThan(0)
    expect(st.bplusIndex.verdict.noUniversalWinner).toBe(true)
    expect(st.bplusIndex.structure.heightLadder.length).toBeGreaterThan(0)
    // 惰性缓存：二次 status 同引用，不反复跑对照
    expect((await gc.status()).bplusIndex).toBe(st.bplusIndex)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runBplusStudy!()
    expect(rerun.verdict).toEqual(st.bplusIndex.verdict)
  })

  it('bplusIndex 默认 null 非破坏；可注入现成 study（KI-504）', async () => {
    const plain = createGameCloud({ gameId: 'gbp2', gamePort: 7717, sources, cloud: fakeCloud() })
    expect(plain.runBplusStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.bplusIndex).toBe(null)
    expect(ps.failureDetector).toBe(null)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出。
    const { bplusStudy } = await import('../../scripts/caesura-bplus-tree.mjs')
    const study = bplusStudy({ keyCount: 64, now: () => 321 })
    const injected = createGameCloud({
      gameId: 'gbp3', gamePort: 7718, sources, cloud: fakeCloud(),
      bplusIndex: study, bpNow: () => 999,
    })
    const st = await injected.status()
    expect(st.bplusIndex.builtAt).toBe(321) // 注入 study 的 builtAt，不被 bpNow 覆盖
    expect(st.bplusIndex.agreement.bothAgree).toBe(true)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('mvccTxn:true ⇒ 装配事务并发控制、status.mvccTxn 读真五行矩阵/死锁/gc 证据、惰性同引用（KI-505）', async () => {
    const gc = createGameCloud({
      gameId: 'gmv1', gamePort: 7719, sources, cloud: fakeCloud(),
      mvccTxn: { gcVersions: 10 }, txnNow: () => 8888,
    })
    expect(gc.runMvccTxnStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.mvccTxn.builtAt).toBe(8888)
    expect(st.mvccTxn.levels.length).toBe(5)                    // RU/RC/RR/SI/SER 五行
    expect(st.mvccTxn.config.anomalies.length).toBe(5)           // 五类异常
    const si = st.mvccTxn.levels.find((l: any) => l.short === 'SI')
    const ser = st.mvccTxn.levels.find((l: any) => l.short === 'SER')
    const ru = st.mvccTxn.levels.find((l: any) => l.short === 'RU')
    expect(ru.observedCount).toBe(5)
    expect(si.anomalies.writeSkew.observed).toBe(true)          // SI 漏写偏斜
    expect(si.anomalies.lostUpdate.observed).toBe(false)        // SI 挡丢失更新
    expect(ser.observedCount).toBe(0)                           // SER 全挡
    expect(ser.aborted).toBeGreaterThan(ru.aborted)             // 但中止更多
    expect(st.mvccTxn.deadlock.detected).toBe(true)
    expect(st.mvccTxn.deadlock.resolved).toBe(true)
    expect(st.mvccTxn.deadlock.acyclicProbeNoCycle).toBe(true)
    expect(st.mvccTxn.twoPhaseLock.lateAcquireBlocked).toBe(true)
    expect(st.mvccTxn.gc.longTxnRetainsMoreVersions).toBe(true)
    expect(Object.values(st.mvccTxn.verdict).every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用，不反复跑对照
    expect((await gc.status()).mvccTxn).toBe(st.mvccTxn)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runMvccTxnStudy!()
    expect(rerun.verdict).toEqual(st.mvccTxn.verdict)
  })

  it('mvccTxn 默认 null 非破坏；可注入现成 study（KI-505）', async () => {
    const plain = createGameCloud({ gameId: 'gmv2', gamePort: 7720, sources, cloud: fakeCloud() })
    expect(plain.runMvccTxnStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.mvccTxn).toBe(null)
    expect(ps.bplusIndex).toBe(null)
    expect(ps.failureDetector).toBe(null)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出。
    const { mvccStudy } = await import('../../scripts/caesura-mvcc-txn.mjs')
    const study = mvccStudy({ now: () => 321 })
    const injected = createGameCloud({
      gameId: 'gmv3', gamePort: 7721, sources, cloud: fakeCloud(),
      mvccTxn: study, txnNow: () => 999,
    })
    const st = await injected.status()
    expect(st.mvccTxn.builtAt).toBe(321) // 注入 study 的 builtAt，不被 txnNow 覆盖
    expect(st.mvccTxn.deadlock.resolved).toBe(true)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('distributedTxn:true ⇒ 装配分布式事务、status.distributedTxn 读真三协议×六场景矩阵/三难判词、惰性同引用（KI-506）', async () => {
    const gc = createGameCloud({
      gameId: 'gdt1', gamePort: 7722, sources, cloud: fakeCloud(),
      distributedTxn: true, dtxnNow: () => 7777,
    })
    expect(gc.runDistributedTxnStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.distributedTxn.builtAt).toBe(7777)
    expect(st.distributedTxn.config.protocols).toEqual(['2PC', 'Saga', 'TCC'])
    expect(st.distributedTxn.config.scenarios.length).toBe(6)
    expect(st.distributedTxn.rows.length).toBe(3)
    const two = st.distributedTxn.rows.find((r: any) => r.protocol === '2PC')
    const saga = st.distributedTxn.rows.find((r: any) => r.protocol === 'Saga')
    const tcc = st.distributedTxn.rows.find((r: any) => r.protocol === 'TCC')
    expect(two.scenarios.find((s: any) => s.id === 'coordinatorDown').blocked).toBe(3) // 2PC 阻塞
    expect(saga.scenarios.find((s: any) => s.id === 'compensateFail').dirty).toBe(1)     // Saga 留脏
    expect(tcc.scenarios.find((s: any) => s.id === 'confirmFlaky').retries).toBeGreaterThan(0) // TCC 幂等重试
    expect(two.intrusion).toBeLessThan(saga.intrusion)
    expect(saga.intrusion).toBeLessThan(tcc.intrusion)
    expect(st.distributedTxn.verdict.noUniversalWinner).toBe(true)
    expect(Object.values(st.distributedTxn.verdict).every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用，不反复跑对照
    expect((await gc.status()).distributedTxn).toBe(st.distributedTxn)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runDistributedTxnStudy!()
    expect(rerun.verdict).toEqual(st.distributedTxn.verdict)
  })

  it('distributedTxn 默认 null 非破坏；可注入现成 study（KI-506）', async () => {
    const plain = createGameCloud({ gameId: 'gdt2', gamePort: 7723, sources, cloud: fakeCloud() })
    expect(plain.runDistributedTxnStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.distributedTxn).toBe(null)
    expect(ps.mvccTxn).toBe(null)
    expect(ps.bplusIndex).toBe(null)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 dtxnNow 覆盖。
    const { distributedTxnStudy } = await import('../../scripts/caesura-distributed-txn.mjs')
    const study = distributedTxnStudy({ now: () => 456 })
    const injected = createGameCloud({
      gameId: 'gdt3', gamePort: 7724, sources, cloud: fakeCloud(),
      distributedTxn: study, dtxnNow: () => 999,
    })
    const st = await injected.status()
    expect(st.distributedTxn.builtAt).toBe(456)
    expect(st.distributedTxn.verdict.noUniversalWinner).toBe(true)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('raftConsensus:true ⇒ 装配 Raft 共识三协议、status.raftConsensus 读真三协议×六场景矩阵/三难判词、惰性同引用（KI-507）', async () => {
    const gc = createGameCloud({
      gameId: 'grc1', gamePort: 7725, sources, cloud: fakeCloud(),
      raftConsensus: true, raftNow: () => 8888,
    })
    expect(gc.runRaftConsensusStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.raftConsensus.builtAt).toBe(8888)
    expect(st.raftConsensus.config.protocols).toEqual(['Raft', 'MultiMaster', 'Gossip'])
    expect(st.raftConsensus.config.scenarios.length).toBe(6)
    expect(st.raftConsensus.rows.length).toBe(3)
    const raft = st.raftConsensus.rows.find((r: any) => r.protocol === 'Raft')
    const mm = st.raftConsensus.rows.find((r: any) => r.protocol === 'MultiMaster')
    const gossip = st.raftConsensus.rows.find((r: any) => r.protocol === 'Gossip')
    expect(raft!.scenarios.find((s: any) => s.id === 'networkPartition')!.blockedWrites).toBeGreaterThan(0) // Raft 分区拒写
    expect(mm!.scenarios.find((s: any) => s.id === 'writeConflict')!.conflicts).toBeGreaterThan(0)          // 多主冲突
    expect(gossip!.scenarios.find((s: any) => s.id === 'antiEntropyGap')!.converged).toBe(false)           // Gossip 反熵间隙不收敛
    expect(st.raftConsensus.verdict.noUniversalWinner).toBe(true)
    expect(Object.values(st.raftConsensus.verdict).every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用，不反复跑对照
    expect((await gc.status()).raftConsensus).toBe(st.raftConsensus)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runRaftConsensusStudy!()
    expect(rerun.verdict).toEqual(st.raftConsensus.verdict)
  })

  it('raftConsensus 默认 null 非破坏；可注入现成 study（KI-507）', async () => {
    const plain = createGameCloud({ gameId: 'grc2', gamePort: 7726, sources, cloud: fakeCloud() })
    expect(plain.runRaftConsensusStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.raftConsensus).toBe(null)
    expect(ps.distributedTxn).toBe(null)
    expect(ps.mvccTxn).toBe(null)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 raftNow 覆盖。
    const { raftConsensusStudy } = await import('../../scripts/caesura-raft-consensus.mjs')
    const study = raftConsensusStudy({ now: () => 456 })
    const injected = createGameCloud({
      gameId: 'grc3', gamePort: 7727, sources, cloud: fakeCloud(),
      raftConsensus: study, raftNow: () => 999,
    })
    const st = await injected.status()
    expect(st.raftConsensus.builtAt).toBe(456)
    expect(st.raftConsensus.verdict.noUniversalWinner).toBe(true)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('distributedLock:true ⇒ 装配分布式锁三协议、status.distributedLock 读真三协议×六场景矩阵/三难判词、惰性同引用（KI-508）', async () => {
    const gc = createGameCloud({
      gameId: 'gdl1', gamePort: 7728, sources, cloud: fakeCloud(),
      distributedLock: true, dlockNow: () => 9999,
    })
    expect(gc.runDistributedLockStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.distributedLock.builtAt).toBe(9999)
    expect(st.distributedLock.config.protocols).toEqual(['SETNX', 'Redlock', 'ETCD'])
    expect(st.distributedLock.config.scenarios.length).toBe(6)
    expect(st.distributedLock.rows.length).toBe(3)
    const setnx = st.distributedLock.rows.find((r: any) => r.protocol === 'SETNX')
    const redlock = st.distributedLock.rows.find((r: any) => r.protocol === 'Redlock')
    const etcd = st.distributedLock.rows.find((r: any) => r.protocol === 'ETCD')
    expect(setnx!.scenarios.find((s: any) => s.id === 'gcPause')!.doubleOwners).toBeGreaterThan(0)            // SETNX GC 暂停双主
    expect(redlock!.scenarios.find((s: any) => s.id === 'clockDrift')!.doubleOwners).toBeGreaterThan(0)      // Redlock 漂移双主
    expect(etcd!.scenarios.find((s: any) => s.id === 'staleFencing')!.staleWritesRejected).toBeGreaterThan(0) // etcd fencing 拒旧写
    expect(st.distributedLock.verdict.noUniversalWinner).toBe(true)
    expect(Object.values(st.distributedLock.verdict).every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用，不反复跑对照
    expect((await gc.status()).distributedLock).toBe(st.distributedLock)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runDistributedLockStudy!()
    expect(rerun.verdict).toEqual(st.distributedLock.verdict)
  })

  it('distributedLock 默认 null 非破坏；可注入现成 study（KI-508）', async () => {
    const plain = createGameCloud({ gameId: 'gdl2', gamePort: 7729, sources, cloud: fakeCloud() })
    expect(plain.runDistributedLockStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.distributedLock).toBe(null)
    expect(ps.raftConsensus).toBe(null)
    expect(ps.distributedTxn).toBe(null)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 dlockNow 覆盖。
    const { distributedLockStudy } = await import('../../scripts/caesura-distributed-lock.mjs')
    const study = distributedLockStudy({ now: () => 555 })
    const injected = createGameCloud({
      gameId: 'gdl3', gamePort: 7730, sources, cloud: fakeCloud(),
      distributedLock: study, dlockNow: () => 1111,
    })
    const st = await injected.status()
    expect(st.distributedLock.builtAt).toBe(555)
    expect(st.distributedLock.verdict.noUniversalWinner).toBe(true)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('idGen:true ⇒ 装配分布式 ID 三协议、status.idGen 读真三协议×六场景矩阵/三难判词/真树交叉印证、惰性同引用（KI-509）', async () => {
    const gc = createGameCloud({
      gameId: 'gid1', gamePort: 7731, sources, cloud: fakeCloud(),
      idGen: true, idGenNow: () => 8888,
    })
    expect(gc.runIdGenStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.idGen.builtAt).toBe(8888)
    expect(st.idGen.config.protocols).toEqual(['UUID', 'Snowflake', 'Segment'])
    expect(st.idGen.config.scenarios.length).toBe(6)
    expect(st.idGen.rows.length).toBe(3)
    const uuid = st.idGen.rows.find((r: any) => r.protocol === 'UUID')
    const snow = st.idGen.rows.find((r: any) => r.protocol === 'Snowflake')
    const seg = st.idGen.rows.find((r: any) => r.protocol === 'Segment')
    expect(uuid!.scenarios.find((s: any) => s.id === 'randomKeyInsert')!.indexFriendly).toBe(false) // UUID 随机主键伤索引
    expect(snow!.scenarios.find((s: any) => s.id === 'clockBackward')!.stalled).toBeGreaterThan(0)   // Snowflake 回拨停发
    expect(seg!.scenarios.find((s: any) => s.id === 'centerDown')!.stalled).toBeGreaterThan(0)      // 号段中心宕中断
    expect(st.idGen.btree.randomCmpGtSequential).toBe(true)  // KI-504 真树交叉印证
    expect(st.idGen.verdict.noUniversalWinner).toBe(true)
    expect(Object.values(st.idGen.verdict).every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用，不反复跑真树对照
    expect((await gc.status()).idGen).toBe(st.idGen)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runIdGenStudy!()
    expect(rerun.verdict).toEqual(st.idGen.verdict)
  })

  it('idGen 默认 null 非破坏；可注入现成 study（KI-509）', async () => {
    const plain = createGameCloud({ gameId: 'gid2', gamePort: 7732, sources, cloud: fakeCloud() })
    expect(plain.runIdGenStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.idGen).toBe(null)
    expect(ps.distributedLock).toBe(null)
    expect(ps.raftConsensus).toBe(null)
    expect(ps.distributedTxn).toBe(null)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 idGenNow 覆盖。
    const { idGenStudy } = await import('../../scripts/caesura-idgen.mjs')
    const study = idGenStudy({ now: () => 666 })
    const injected = createGameCloud({
      gameId: 'gid3', gamePort: 7733, sources, cloud: fakeCloud(),
      idGen: study, idGenNow: () => 2222,
    })
    const st = await injected.status()
    expect(st.idGen.builtAt).toBe(666)
    expect(st.idGen.verdict.noUniversalWinner).toBe(true)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('distributedRateLimit:true ⇒ 装配分布式限流三协议、status.distributedRateLimit 读真三协议×六场景矩阵/三难判词/真件交叉印证、惰性同引用（KI-510）', async () => {
    const gc = createGameCloud({
      gameId: 'gid4', gamePort: 7734, sources, cloud: fakeCloud(),
      distributedRateLimit: true, drNow: () => 9999,
    })
    expect(gc.runDistributedRateLimitStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.distributedRateLimit.builtAt).toBe(9999)
    expect(st.distributedRateLimit.config.scenarios.length).toBe(6)
    expect(st.distributedRateLimit.rows.length).toBe(3)
    expect(st.distributedRateLimit.vectors).toEqual({ Local: '011', Central: '100', Sharded: '010' })
    const local = st.distributedRateLimit.rows.find((r: any) => r.protocol === 'Local')
    const central = st.distributedRateLimit.rows.find((r: any) => r.protocol === 'Central')
    const sharded = st.distributedRateLimit.rows.find((r: any) => r.protocol === 'Sharded')
    expect(local!.scenarios.every((s: any) => s.overAllowed > 0)).toBe(true)          // Local 全场景 N×C 超发
    expect(central!.scenarios.find((s: any) => s.id === 'centerDown')!.centerStalled).toBe(64) // 中心宕全瘫
    expect(sharded!.scenarios.find((s: any) => s.id === 'skewKeys')!.fragmented).toBeGreaterThan(0) // 分片配额碎片
    expect(st.distributedRateLimit.crosscheck.central.atomicExact).toBe(true)          // 真 Redis 原子桶
    expect(st.distributedRateLimit.crosscheck.sharded.skewEmptyNodes).toBeGreaterThan(0) // 真环偏斜空片
    expect(st.distributedRateLimit.verdict.noUniversalWinner).toBe(true)
    const verdictBools = Object.entries(st.distributedRateLimit.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).distributedRateLimit).toBe(st.distributedRateLimit)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runDistributedRateLimitStudy!()
    expect(rerun.verdict).toEqual(st.distributedRateLimit.verdict)
  })

  it('distributedRateLimit 默认 null 非破坏；可注入现成 study（KI-510）', async () => {
    const plain = createGameCloud({ gameId: 'gid5', gamePort: 7735, sources, cloud: fakeCloud() })
    expect(plain.runDistributedRateLimitStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.distributedRateLimit).toBe(null)
    expect(ps.idGen).toBe(null) // 不连坐 KI-509
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 drNow 覆盖。
    const { distributedRateLimitStudy } = await import('../../scripts/caesura-distributed-ratelimit.mjs')
    const study = await distributedRateLimitStudy({ now: () => 666 }) as any
    const injected = createGameCloud({
      gameId: 'gid6', gamePort: 7736, sources, cloud: fakeCloud(),
      distributedRateLimit: study, drNow: () => 2222,
    })
    const st = await injected.status()
    expect(st.distributedRateLimit.builtAt).toBe(666)
    expect(st.distributedRateLimit.verdict.noUniversalWinner).toBe(true)
    // 主链语义逐字不动
    expect(st.eventChannel).toBeTruthy()
  })

  it('configConsistency:true ⇒ 装配配置一致性三协议、status.configConsistency 读真三协议×六场景矩阵/三难判词/真件交叉印证、惰性同引用（KI-511）', async () => {
    const gc = createGameCloud({
      gameId: 'gid7', gamePort: 7737, sources, cloud: fakeCloud(),
      configConsistency: true, dccNow: () => 9999,
    })
    expect(gc.runConfigConsistencyStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.configConsistency.builtAt).toBe(9999)
    expect(st.configConsistency.config.scenarios.length).toBe(6)
    expect(st.configConsistency.rows.length).toBe(3)
    expect(st.configConsistency.vectors).toEqual({ Polling: '100', LongPolling: '011', WatchPush: '010' })
    const polling = st.configConsistency.rows.find((r: any) => r.protocol === 'Polling')
    const longPolling = st.configConsistency.rows.find((r: any) => r.protocol === 'LongPolling')
    const watch = st.configConsistency.rows.find((r: any) => r.protocol === 'WatchPush')
    expect(polling!.scenarios.find((s: any) => s.id === 'idleNoChange')!.idleFetches).toBeGreaterThan(0) // Polling 空转
    expect(polling!.scenarios.find((s: any) => s.id === 'centerDown')!.degraded).toBe(true)             // Polling 可降级
    expect(longPolling!.scenarios.find((s: any) => s.id === 'centerDown')!.centerBroken).toBe(true)      // 长轮询中心宕全断
    expect(watch!.scenarios.find((s: any) => s.id === 'burstChanges')!.versionGaps).toBeGreaterThan(0)   // Watch 广播风暴版本缺口
    expect(st.configConsistency.crosscheck.configWatcher.seededNoEvents).toBe(true)  // 真 watcher 首趟纯播种
    expect(st.configConsistency.crosscheck.bus.eventChainWorks).toBe(true)           // 真 bus 事件链
    expect(st.configConsistency.crosscheck.gray.stableBuckets).toBe(64)              // 真 hashSelector 稳定桶
    expect(st.configConsistency.verdict.noUniversalWinner).toBe(true)
    expect(st.configConsistency.verdict.watchNotPanacea).toBe(true)
    const verdictBools = Object.entries(st.configConsistency.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).configConsistency).toBe(st.configConsistency)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runConfigConsistencyStudy!()
    expect(rerun.verdict).toEqual(st.configConsistency.verdict)
  })

  it('configConsistency 默认 null 非破坏；可注入现成 study（KI-511）', async () => {
    const plain = createGameCloud({ gameId: 'gid8', gamePort: 7738, sources, cloud: fakeCloud() })
    expect(plain.runConfigConsistencyStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.configConsistency).toBe(null)
    expect(ps.distributedRateLimit).toBe(null) // 不连坐 KI-510
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 dccNow 覆盖。
    const { configConsistencyStudy } = await import('../../scripts/caesura-config-consistency.mjs')
    const study = await configConsistencyStudy({ now: () => 666 }) as any
    const injected = createGameCloud({
      gameId: 'gid9', gamePort: 7739, sources, cloud: fakeCloud(),
      configConsistency: study, dccNow: () => 2222,
    })
    const st = await injected.status()
    expect(st.configConsistency.builtAt).toBe(666)
    expect(st.configConsistency.verdict.noUniversalWinner).toBe(true)
    expect(st.eventChannel).toBeTruthy()
  })

  it('cacheCoherency:true ⇒ 装配缓存读写一致性三协议、status.cacheCoherency 读真三协议×六场景矩阵/三难判词/七枚真件交叉印证、惰性同引用（KI-512）', async () => {
    const gc = createGameCloud({
      gameId: 'gidc1', gamePort: 7741, sources, cloud: fakeCloud(),
      cacheCoherency: true, cccNow: () => 8888,
    })
    expect(gc.runCacheCoherencyStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.cacheCoherency.builtAt).toBe(8888)
    expect(st.cacheCoherency.config.scenarios.length).toBe(6)
    expect(st.cacheCoherency.rows.length).toBe(3)
    expect(st.cacheCoherency.vectors).toEqual({ CacheAside: '001', WriteThrough: '101', WriteBehind: '110' })
    const aside = st.cacheCoherency.rows.find((r: any) => r.protocol === 'CacheAside')
    const through = st.cacheCoherency.rows.find((r: any) => r.protocol === 'WriteThrough')
    const behind = st.cacheCoherency.rows.find((r: any) => r.protocol === 'WriteBehind')
    expect(aside!.scenarios.find((s: any) => s.id === 'readAfterWrite')!.staleReads).toBeGreaterThan(0) // 旁路窗口陈旧读
    expect(through!.scenarios.find((s: any) => s.id === 'writeHeavy')!.writeBackendRounds).toBeGreaterThan(0) // 写穿透阻塞
    expect(behind!.scenarios.find((s: any) => s.id === 'cacheCrash')!.dirtyPagesLost).toBeGreaterThan(0)        // 写回整机宕丢脏页
    expect(st.cacheCoherency.crosscheck.wal.replicatedAcrossNodes).toBe(false)   // 真 WAL 不跨机
    expect(st.cacheCoherency.crosscheck.wal.wholeNodeLossDurable).toBe(false)    // 整机宕不 durable
    expect(st.cacheCoherency.crosscheck.mvcc.writeThenReadNeedsCommit).toBe(true) // 真 MVCC 提交后才读新
    expect(st.cacheCoherency.crosscheck.twoPhase.downPhase).toBe('blocked')       // 真 2PC 协调者宕全员阻塞
    expect(st.cacheCoherency.crosscheck.redis.writeThenReadSeesNew).toBe(true)    // 真 Redis 写后读可见
    expect(Object.keys(st.cacheCoherency.crosscheck).sort()).toEqual(['guard', 'mvcc', 'redis', 'ring', 'sharded', 'twoPhase', 'wal'])
    expect(st.cacheCoherency.verdict.noUniversalWinner).toBe(true)
    expect(st.cacheCoherency.verdict.writeBehindNotPanacea).toBe(true)
    expect(st.cacheCoherency.verdict.walNotDurableAcrossNode).toBe(true)
    const verdictBools = Object.entries(st.cacheCoherency.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).cacheCoherency).toBe(st.cacheCoherency)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runCacheCoherencyStudy!()
    expect(rerun.verdict).toEqual(st.cacheCoherency.verdict)
    // 不连坐 KI-511
    expect(st.configConsistency).toBe(null)
  })

  it('cacheCoherency 默认 null 非破坏；walEnabled 单开关抹不掉 durable 维；可注入现成 study（KI-512）', async () => {
    const plain = createGameCloud({ gameId: 'gidc2', gamePort: 7742, sources, cloud: fakeCloud() })
    expect(plain.runCacheCoherencyStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.cacheCoherency).toBe(null)
    expect(ps.configConsistency).toBe(null) // 不连坐 KI-511
    // 单开 walEnabled（仅进程内 WAL）：WriteBehind 仍 110，durable 维不翻。
    const wal = createGameCloud({
      gameId: 'gidc3', gamePort: 7743, sources, cloud: fakeCloud(),
      cacheCoherency: { walEnabled: true }, cccNow: () => 5555,
    })
    const ws = await wal.status()
    expect(ws.cacheCoherency.vectors).toEqual({ CacheAside: '001', WriteThrough: '101', WriteBehind: '110' })
    expect(ws.cacheCoherency.verdict.noUniversalWinner).toBe(true)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 cccNow 覆盖。
    const { cacheCoherencyStudy } = await import('../../scripts/caesura-cache-coherency.mjs')
    const study = await cacheCoherencyStudy({ now: () => 444 }) as any
    const injected = createGameCloud({
      gameId: 'gidc4', gamePort: 7744, sources, cloud: fakeCloud(),
      cacheCoherency: study, cccNow: () => 2222,
    })
    const st = await injected.status()
    expect(st.cacheCoherency.builtAt).toBe(444)
    expect(st.cacheCoherency.verdict.noUniversalWinner).toBe(true)
    expect(st.eventChannel).toBeTruthy()
  })

  it('messageDelivery:true ⇒ 装配消息投递三协议、status.messageDelivery 读真三协议×六场景矩阵/三难判词/七枚真件交叉印证、惰性同引用（KI-513）', async () => {
    const gc = createGameCloud({
      gameId: 'gidm1', gamePort: 7751, sources, cloud: fakeCloud(),
      messageDelivery: true, mmdNow: () => 9999,
    })
    expect(gc.runMessageDeliveryStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.messageDelivery.builtAt).toBe(9999)
    expect(st.messageDelivery.config.scenarios.length).toBe(6)
    expect(st.messageDelivery.rows.length).toBe(3)
    expect(st.messageDelivery.vectors).toEqual({ AtMostOnce: '011', AtLeastOnce: '101', ExactlyOnce: '110' })
    const most = st.messageDelivery.rows.find((r: any) => r.protocol === 'AtMostOnce')
    const least = st.messageDelivery.rows.find((r: any) => r.protocol === 'AtLeastOnce')
    const once = st.messageDelivery.rows.find((r: any) => r.protocol === 'ExactlyOnce')
    expect(most!.scenarios.find((s: any) => s.id === 'crashAfterSend')!.lost).toBeGreaterThan(0)   // 发完即忘静默丢
    expect(least!.scenarios.find((s: any) => s.id === 'ackLost')!.duplicates).toBeGreaterThan(0)   // ack 丢误判重投致重复
    expect(once!.scenarios.find((s: any) => s.id === 'brokerRetry')!.idempotentHits).toBeGreaterThan(0) // 幂等折叠
    expect(once!.scenarios.find((s: any) => s.id === 'brokerRetry')!.duplicates).toBe(0)          // 折叠后不重复
    expect(once!.totals.overheadUnits).toBeGreaterThan(least!.totals.overheadUnits)               // 最贵
    expect(st.messageDelivery.crosscheck.bridge.forwardOk).toBe(true)          // 真桥注入后转发成功
    expect(st.messageDelivery.crosscheck.wal.distinctIds).toBe(2)              // 真 WAL 取到 key（非 null 假象）
    expect(st.messageDelivery.crosscheck.wal.replayIds).toEqual(['m:1', 'm:2', 'm:1'])
    expect(st.messageDelivery.crosscheck.wal.replayDedupePossible).toBe(true)
    expect(st.messageDelivery.crosscheck.wal.replicatedAcrossNodes).toBe(false) // 进程内不跨机
    expect(st.messageDelivery.crosscheck.twoPhase.replayIdempotent).toBe(true)  // 真 2PC 重放幂等
    expect(st.messageDelivery.crosscheck.bus.atMostOnceShell).toBe(true)        // 真 createBus 发完即忘
    expect(st.messageDelivery.crosscheck.redis.idempotentTable).toBe(true)      // 真 Redis 幂等键表
    expect(Object.keys(st.messageDelivery.crosscheck).sort()).toEqual(['bridge', 'bus', 'gameEventBus', 'redis', 'ring', 'twoPhase', 'wal'])
    expect(st.messageDelivery.verdict.noUniversalWinner).toBe(true)
    expect(st.messageDelivery.verdict.exactlyOnceNotFree).toBe(true)
    expect(st.messageDelivery.verdict.exactlyOnceIsAtLeastOncePlusIdempotency).toBe(true)
    const verdictBools = Object.entries(st.messageDelivery.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.every(Boolean)).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).messageDelivery).toBe(st.messageDelivery)
    // 现算入口可重跑、确定性（同注入 now）
    const rerun = await gc.runMessageDeliveryStudy!()
    expect(rerun.vectors).toEqual(st.messageDelivery.vectors)
    // 不连坐 KI-512
    expect(st.cacheCoherency).toBe(null)
  })

  it('messageDelivery 默认 null 非破坏；ackReliable 单开关只补 At-Least-Once 一维；可注入现成 study（KI-513）', async () => {
    const plain = createGameCloud({ gameId: 'gidm2', gamePort: 7752, sources, cloud: fakeCloud() })
    expect(plain.runMessageDeliveryStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.messageDelivery).toBe(null)
    expect(ps.cacheCoherency).toBe(null) // 不连坐 KI-512
    // 单开 ackReliable（faults 全空）：只 At-Least-Once 补 noDup 维成 111，救不了另两只。
    const ack = createGameCloud({
      gameId: 'gidm3', gamePort: 7753, sources, cloud: fakeCloud(),
      messageDelivery: { ackReliable: true, faults: Array.from({ length: 6 }, () => ({})), now: 0 }, mmdNow: () => 0,
    })
    const as = await ack.status()
    expect(as.messageDelivery.vectors).toEqual({ AtMostOnce: '011', AtLeastOnce: '111', ExactlyOnce: '110' })
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 mmdNow 覆盖。
    const { messageDeliveryStudy } = await import('../../scripts/caesura-message-delivery.mjs')
    const study = await messageDeliveryStudy({ now: () => 333 }) as any
    const injected = createGameCloud({
      gameId: 'gidm4', gamePort: 7754, sources, cloud: fakeCloud(),
      messageDelivery: study, mmdNow: () => 2222,
    })
    const st = await injected.status()
    expect(st.messageDelivery.builtAt).toBe(333)
    expect(st.messageDelivery.verdict.noUniversalWinner).toBe(true)
    expect(st.eventChannel).toBeTruthy()
  })

  it('delayQueue:true ⇒ 装配延迟队列三协议、status.delayQueue 读真矩阵/三难向量/七真件、惰性同引用（KI-518）', async () => {
    const gc = createGameCloud({
      gameId: 'giddq1', gamePort: 7761, sources, cloud: fakeCloud(),
      delayQueue: true, dqNow: () => 8888,
    })
    expect(gc.runDelayQueueStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.delayQueue.builtAt).toBe(8888)
    expect(st.delayQueue.config.scenarios.length).toBe(6)
    expect(st.delayQueue.rows.length).toBe(3)
    expect(st.delayQueue.vectors).toEqual({ TimingWheel: '100', MinHeap: '010', RedisZset: '001' })
    const w = st.delayQueue.rows.find((r: any) => r.protocol === 'TimingWheel')!
    const h = st.delayQueue.rows.find((r: any) => r.protocol === 'MinHeap')!
    const z = st.delayQueue.rows.find((r: any) => r.protocol === 'RedisZset')!
    expect(w.scenarios.find((s: any) => s.id === 'tickSkew')!.lateMs).toBeGreaterThan(0)   // 时间轮晚点
    expect(h.totals.lateMs).toBe(0)                                                        // 堆零晚点
    expect(h.totals.opUnits).toBeGreaterThan(0)                                            // 堆 O(log n)
    expect(z.scenarios.find((s: any) => s.id === 'workerRestart')!.lostOnRestart).toBe(0)  // ZSET 不丢
    expect(z.scenarios.find((s: any) => s.id === 'concurrentWorkers')!.duplicatePickups).toBeGreaterThan(0)
    const ev = st.delayQueue.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bplusRangeCount', 'busDelivered', 'hashRingEmptyNodes', 'hashRingNodes', 'poolAcquired', 'redisEntries', 'tokenBucketOk', 'walLines'])
    expect(ev.walLines).toBe(2)
    expect(ev.bplusRangeCount).toBe(30)
    expect(ev.poolAcquired).toBe(2)
    expect(st.delayQueue.verdict.noUniversalWinner).toBe(true)
    expect(st.delayQueue.verdict.minHeapZeroLateMs).toBe(true)
    expect(st.delayQueue.verdict.redisZsetNeverSilentLossOnRestart).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).delayQueue).toBe(st.delayQueue)
    // 现算入口可重跑、确定性
    const rerun = await gc.runDelayQueueStudy!()
    expect(rerun.vectors).toEqual(st.delayQueue.vectors)
    // 不连坐 KI-513
    expect(st.messageDelivery).toBe(null)
  })

  it('delayQueue 默认 null 非破坏；单开 zeroTick 只补时间轮 punctual；rigged 向量现算 111/111/001；可注入现成 study（KI-518）', async () => {
    const plain = createGameCloud({ gameId: 'giddq2', gamePort: 7762, sources, cloud: fakeCloud() })
    expect(plain.runDelayQueueStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.delayQueue).toBe(null)
    expect(ps.messageDelivery).toBe(null) // 不连坐 KI-513
    // 单开 zeroTick：时间轮恒 lowCost=1，补 punctual ⇒ 110，仍缺共享持久；救不了堆比较/ZSET 轮询
    const zero = createGameCloud({
      gameId: 'giddq3', gamePort: 7763, sources, cloud: fakeCloud(),
      delayQueue: { zeroTick: true, now: 0 }, dqNow: () => 0,
    })
    const zs = await zero.status()
    expect(zs.delayQueue.vectors).toEqual({ TimingWheel: '110', MinHeap: '010', RedisZset: '001' })
    // rigged 三开关：向量由 trilemma 现算，ZSET 保留 001，判词翻 false
    const rig = createGameCloud({
      gameId: 'giddq4', gamePort: 7764, sources, cloud: fakeCloud(),
      delayQueue: { zeroTick: true, freeHeapOps: true, sharedBackend: true, now: 0 }, dqNow: () => 0,
    })
    const rs = await rig.status()
    expect(rs.delayQueue.vectors).toEqual({ TimingWheel: '111', MinHeap: '111', RedisZset: '001' })
    expect(rs.delayQueue.verdict.noUniversalWinner).toBe(false)
    expect(rs.delayQueue.verdict.trilemmaDistinguishes).toBe(false)
    // 注入现成 study：直接用、不重跑，builtAt 原样带出、不被 dqNow 覆盖
    const { delayQueueStudy } = await import('../../scripts/caesura-delay-queue.mjs')
    const study = delayQueueStudy({ now: () => 555 })
    const injected = createGameCloud({
      gameId: 'giddq5', gamePort: 7765, sources, cloud: fakeCloud(),
      delayQueue: study, dqNow: () => 2222,
    })
    const st = await injected.status()
    expect(st.delayQueue.builtAt).toBe(555)
    expect(st.delayQueue.verdict.noUniversalWinner).toBe(true)
    expect(st.eventChannel).toBeTruthy()
  })

  it('retryDlq:true ⇒ 装配重试退避三协议、status.retryDlq 读真矩阵/三难向量/七真件、builtAt 随 rdlNow、惰性同引用（KI-520）', async () => {
    const gc = createGameCloud({
      gameId: 'gidrdlq1', gamePort: 7771, sources, cloud: fakeCloud(),
      retryDlq: true, rdlNow: () => 8888,
    })
    expect(gc.runRetryDlqStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.retryDlq.builtAt).toBe(8888)                       // 注入时钟真求值（KI-517 契约延伸）
    expect(st.retryDlq.config.scenarios.length).toBe(6)
    expect(st.retryDlq.rows.length).toBe(3)
    expect(st.retryDlq.vectors).toEqual({ Immediate: '100', Exponential: '010', FullJitter: '011' })
    const imm = st.retryDlq.rows.find((r: any) => r.protocol === 'Immediate')!
    const exp = st.retryDlq.rows.find((r: any) => r.protocol === 'Exponential')!
    const fj = st.retryDlq.rows.find((r: any) => r.protocol === 'FullJitter')!
    expect(imm.trilemma).toEqual({ fastRecovery: true, noStorm: false, noHerd: false }) // 快但风暴+惊群
    expect(exp.trilemma).toEqual({ fastRecovery: false, noStorm: true, noHerd: false }) // 不风暴但慢+仍惊群
    expect(fj.trilemma).toEqual({ fastRecovery: false, noStorm: true, noHerd: true })   // 占两维仍缺低延迟、非银弹
    expect(imm.scenarios.find((s: any) => s.id === 'manyAttempts')!.deadLettered).toBeGreaterThan(0) // 死信真落地
    const ev = st.retryDlq.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bucketAllowed', 'bucketRejected', 'busListeners', 'deadNotices', 'hashRingEmptyNodes', 'hashRingNodes', 'heapFired', 'idemEntries', 'poolAcquired', 'walLines', 'walReplayed'])
    expect(ev.heapFired).toBe(12)
    expect(ev.bucketAllowed).toBe(3)
    expect(ev.bucketRejected).toBe(2)
    expect(ev.walLines).toBe(3)
    expect(ev.walReplayed).toBe(3)
    expect(ev.idemEntries).toBe(1)
    expect(ev.deadNotices).toBe(2)
    expect(ev.busListeners).toBe(1)
    expect(ev.poolAcquired).toBe(3)
    expect(st.retryDlq.verdict.noUniversalWinner).toBe(true)
    expect(st.retryDlq.verdict.fullJitterNotFreeLunch).toBe(true)
    expect(st.retryDlq.verdict.noStormCausallyUnerasable).toBe(false) // 默认三开关未开
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).retryDlq).toBe(st.retryDlq)
    // 现算入口可重跑、确定性（builtAt 也随 rdlNow）
    const rerun = await gc.runRetryDlqStudy!()
    expect(rerun.vectors).toEqual(st.retryDlq.vectors)
    // 不连坐 KI-518
    expect(st.delayQueue).toBe(null)
  })

  it('retryDlq 默认 null 非破坏；单开 zeroBackoff/perfectJitter 各自局部、rigged 向量现算 101/101/101 因果锁死 noStorm；可注入现成 study（KI-520）', async () => {
    const plain = createGameCloud({ gameId: 'gidrdlq2', gamePort: 7772, sources, cloud: fakeCloud() })
    expect(plain.runRetryDlqStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.retryDlq).toBe(null)
    expect(ps.delayQueue).toBe(null)
    // 单开 zeroBackoff：恢复延迟归零抹 fastRecovery，但长故障施压暴涨 ⇒ noStorm 反噬，三协议全 100
    const zero = createGameCloud({
      gameId: 'gidrdlq3', gamePort: 7773, sources, cloud: fakeCloud(),
      retryDlq: { zeroBackoff: true, now: 0 }, rdlNow: () => 0,
    })
    expect((await zero.status()).retryDlq.vectors).toEqual({ Immediate: '100', Exponential: '100', FullJitter: '100' })
    // 单开 perfectJitter：只打散惊群，不给 Immediate 补 noStorm
    const perf = createGameCloud({
      gameId: 'gidrdlq4', gamePort: 7774, sources, cloud: fakeCloud(),
      retryDlq: { perfectJitter: true, now: 0 }, rdlNow: () => 0,
    })
    expect((await perf.status()).retryDlq.vectors).toEqual({ Immediate: '101', Exponential: '011', FullJitter: '011' })
    // rigged 三开关：向量由 trilemma 现算 101/101/101，noStorm 无一能翻回
    const rig = createGameCloud({
      gameId: 'gidrdlq5', gamePort: 7775, sources, cloud: fakeCloud(),
      retryDlq: { rigged: true, now: 0 }, rdlNow: () => 0,
    })
    const rs = await rig.status()
    expect(rs.retryDlq.vectors).toEqual({ Immediate: '101', Exponential: '101', FullJitter: '101' })
    expect(rs.retryDlq.verdict.noUniversalWinner).toBe(false)
    expect(rs.retryDlq.verdict.trilemmaDistinguishes).toBe(false)
    expect(rs.retryDlq.verdict.noStormCausallyUnerasable).toBe(true)
    for (const row of rs.retryDlq.rows) expect(row.trilemma.noStorm).toBe(false)
    // 注入现成 study：直接用、builtAt 原样带出、不被 rdlNow 覆盖
    const { retryDlqStudy } = await import('../../scripts/caesura-retry-dlq.mjs')
    const study = retryDlqStudy({ now: () => 555 })
    const injected = createGameCloud({
      gameId: 'gidrdlq6', gamePort: 7776, sources, cloud: fakeCloud(),
      retryDlq: study, rdlNow: () => 2222,
    })
    const st = await injected.status()
    expect(st.retryDlq.builtAt).toBe(555)
    expect(st.retryDlq.verdict.noUniversalWinner).toBe(true)
  })

  it('consumerGroup:true ⇒ 装配消费者组 rebalance 三协议、status.consumerGroup 读真矩阵/三难向量/九真件、builtAt 随 cgpNow、惰性同引用（KI-523）', async () => {
    const gc = createGameCloud({
      gameId: 'gidcgp1', gamePort: 7781, sources, cloud: fakeCloud(),
      consumerGroup: true, cgpNow: () => 8888,
    })
    expect(gc.runConsumerGroupStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.consumerGroup.builtAt).toBe(8888)                    // 注入时钟真求值（KI-517 契约延伸）
    expect(st.consumerGroup.config.scenarios.length).toBe(6)
    expect(st.consumerGroup.rows.length).toBe(3)
    expect(st.consumerGroup.vectors).toEqual({ Range: '001', RoundRobin: '100', Sticky: '110' })
    const range = st.consumerGroup.rows.find((r: any) => r.protocol === 'Range')!
    const rr = st.consumerGroup.rows.find((r: any) => r.protocol === 'RoundRobin')!
    const sticky = st.consumerGroup.rows.find((r: any) => r.protocol === 'Sticky')!
    expect(range.trilemma).toEqual({ balanced: false, minimalMovement: false, cheap: true })  // 只便宜
    expect(rr.trilemma).toEqual({ balanced: true, minimalMovement: false, cheap: false })      // 只均衡
    expect(sticky.trilemma).toEqual({ balanced: true, minimalMovement: true, cheap: false })   // 均衡+最小迁移、最贵非银弹
    // 六场景真读数（工程原型已校准）
    expect(range.scenarios.find((s: any) => s.id === 'partitionSkew')!.imbalance).toBe(2)
    expect(sticky.scenarios.find((s: any) => s.id === 'memberJoin')!.moveRate).toBe(0.125)
    expect(rr.scenarios.find((s: any) => s.id === 'manyPartitions')!.opPerPart).toBe(8)
    // 九真件交叉印证：16 字段真回读、非硬编码
    const ev = st.consumerGroup.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bucketAllowed', 'bucketRejected', 'busListeners', 'groupMetaEntries', 'hashRingEmptyNodes', 'hashRingNodes', 'heapFired', 'poolAcquired', 'rebalanceNotices', 'remapConsistentRate', 'remapModuloRate', 'remapSavedRate', 'routerMoved', 'routerRate', 'walLines', 'walReplayed'])
    expect(ev.remapConsistentRate).toBeLessThan(ev.remapModuloRate) // 一致性哈希比取模迁移少
    expect(ev.remapSavedRate).toBeGreaterThan(0)
    expect(ev.walLines).toBe(2)
    expect(ev.walReplayed).toBe(2)
    expect(ev.rebalanceNotices).toBe(2)
    expect(ev.bucketAllowed).toBe(2)
    expect(ev.bucketRejected).toBe(2)
    expect(ev.heapFired).toBe(9)
    expect(st.consumerGroup.verdict.noUniversalWinner).toBe(true)
    expect(st.consumerGroup.verdict.stickyNotFreeLunch).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).consumerGroup).toBe(st.consumerGroup)
    const rerun = await gc.runConsumerGroupStudy!()
    expect(rerun.vectors).toEqual(st.consumerGroup.vectors)
    // 不连坐 KI-518/520
    expect(st.delayQueue).toBe(null)
    expect(st.retryDlq).toBe(null)
  })

  it('consumerGroup 默认 null 非破坏；单开 zeroMovement/perfectBalance/freeCompute 各自局部、rigged 101/101/101 因果锁死 minimalMovement；可注入现成 study（KI-523）', async () => {
    const plain = createGameCloud({ gameId: 'gidcgp2', gamePort: 7782, sources, cloud: fakeCloud() })
    expect(plain.runConsumerGroupStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.consumerGroup).toBe(null)
    expect(ps.delayQueue).toBe(null)
    expect(ps.retryDlq).toBe(null)
    // 单开 zeroMovement：新成员饥饿 starved ⇒ balanced 反噬、minimalMovement 冻结为 true
    const zm = await (await createGameCloud({
      gameId: 'gidcgp3', gamePort: 7783, sources, cloud: fakeCloud(),
      consumerGroup: { zeroMovement: true, now: 0 },
    })).status()
    expect(zm.consumerGroup.vectors).toEqual({ Range: '011', RoundRobin: '010', Sticky: '010' })
    expect(zm.consumerGroup.verdict.zeroMovementStarvesJoiner).toBe(true)
    // 单开 freeCompute：只抹 cheap，Sticky 摸到 111（默认态够不着）
    const fc = await (await createGameCloud({
      gameId: 'gidcgp4', gamePort: 7784, sources, cloud: fakeCloud(),
      consumerGroup: { freeCompute: true, now: 0 },
    })).status()
    expect(fc.consumerGroup.vectors).toEqual({ Range: '001', RoundRobin: '101', Sticky: '111' })
    // rigged 三开关齐开：真实现算 101/101/101、因果锁死 minimalMovement
    const rig = await (await createGameCloud({
      gameId: 'gidcgp5', gamePort: 7785, sources, cloud: fakeCloud(),
      consumerGroup: { rigged: true, now: 0 },
    })).status()
    expect(rig.consumerGroup.vectors).toEqual({ Range: '101', RoundRobin: '101', Sticky: '101' })
    expect(rig.consumerGroup.verdict.minimalMovementCausallyUnerasable).toBe(true)
    expect(rig.consumerGroup.verdict.noUniversalWinner).toBe(false)
    // 注入现成 study（duck-typed）
    const { consumerGroupStudy } = await import('../../scripts/caesura-consumer-group.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gidcgp6', gamePort: 7786, sources, cloud: fakeCloud(),
      consumerGroup: consumerGroupStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.consumerGroup.builtAt).toBe(555)
    expect(injected.consumerGroup.config.seed).toBe(99)
  })

  it("backpressure:true ⇒ 装配积压背压四策略、status.backpressure 读真矩阵/三难向量/Little's Law/十一真件、builtAt 随 bpcNow、惰性同引用（KI-525）", async () => {
    const gc = createGameCloud({
      gameId: 'gidbp1', gamePort: 7791, sources, cloud: fakeCloud(),
      backpressure: true, bpcNow: () => 9999,
    })
    expect(gc.runBackpressureStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.backpressure.builtAt).toBe(9999)                    // 注入时钟真求值（KI-517 契约延伸）
    expect(st.backpressure.config.scenarios.length).toBe(6)
    expect(st.backpressure.rows.length).toBe(4)
    expect(st.backpressure.vectors).toEqual({ Backpressure: '110', Buffering: '101', Shedding: '011', Scaling: '100' })
    const bp = st.backpressure.rows.find((r: any) => r.strategy === 'Backpressure')!
    const buf = st.backpressure.rows.find((r: any) => r.strategy === 'Buffering')!
    const shed = st.backpressure.rows.find((r: any) => r.strategy === 'Shedding')!
    const scal = st.backpressure.rows.find((r: any) => r.strategy === 'Scaling')!
    expect(bp.trilemma).toEqual({ noLoss: true, lowLatency: true, highThroughput: false })   // 只丢吞吐
    expect(buf.trilemma).toEqual({ noLoss: true, lowLatency: false, highThroughput: true })  // 只亏时延
    expect(shed.trilemma).toEqual({ noLoss: false, lowLatency: true, highThroughput: true }) // 只丢消息
    expect(scal.trilemma).toEqual({ noLoss: true, lowLatency: false, highThroughput: false }) // 只占零丢失
    // Little's Law 双路：稳态非平凡成立 + 过载破裂
    expect(st.backpressure.littleLaw.steadyHolds).toBe(true)
    expect(st.backpressure.littleLaw.steadyNontrivial).toBe(true)
    expect(st.backpressure.littleLaw.overloadBreaks).toBe(true)
    // 十一真件交叉印证：21 字段真回读、非硬编码
    const ev = st.backpressure.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bloomHit', 'bloomMiss', 'bucketAllowed', 'bucketRejected', 'busListeners', 'counterFalseSharing', 'counterSum', 'heapFired', 'jitterSpread', 'leakyAllowed', 'leakyRejected', 'poolCreated', 'poolReused', 'shardHits', 'walLines', 'walReplayed', 'watermarkNotices', 'zqFired', 'zqLostOnRestart', 'zqPendingAfterRestore'])
    expect(ev.heapFired).toBe(9)
    expect(ev.walReplayed).toBe(4)
    expect(ev.watermarkNotices).toBe(2)
    expect(ev.bloomMiss).toBe(false)
    expect(ev.counterSum).toBe(36)
    expect(st.backpressure.verdict.noUniversalWinner).toBe(true)
    expect(st.backpressure.verdict.sheddingNotFreeLunch).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).backpressure).toBe(st.backpressure)
    const rerun = await gc.runBackpressureStudy!()
    expect(rerun.vectors).toEqual(st.backpressure.vectors)
    // 不连坐 KI-518/520/523
    expect(st.delayQueue).toBe(null)
    expect(st.retryDlq).toBe(null)
    expect(st.consumerGroup).toBe(null)
  })

  it('backpressure 默认 null 非破坏；单开 zeroLoss/boundedLatency/unlimitedBuffer 各自局部、rigged 110/110/110/110 因果锁死 highThroughput；可注入现成 study（KI-525）', async () => {
    const plain = createGameCloud({ gameId: 'gidbp2', gamePort: 7792, sources, cloud: fakeCloud() })
    expect(plain.runBackpressureStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.backpressure).toBe(null)
    expect(ps.delayQueue).toBe(null)
    expect(ps.consumerGroup).toBe(null)
    // 单开 zeroLoss：补 Shedding 零丢失必积压、反噬低时延
    const zl = await (await createGameCloud({
      gameId: 'gidbp3', gamePort: 7793, sources, cloud: fakeCloud(),
      backpressure: { zeroLoss: true, now: 0 },
    })).status()
    expect(zl.backpressure.verdict.zeroLossBackfiresLatency).toBe(true)
    // 单开 boundedLatency：补低时延必逼出丢弃、反噬零丢失
    const bl = await (await createGameCloud({
      gameId: 'gidbp4', gamePort: 7794, sources, cloud: fakeCloud(),
      backpressure: { boundedLatency: true, now: 0 },
    })).status()
    expect(bl.backpressure.verdict.boundedLatencyBackfiresNoLoss).toBe(true)
    // 单开 unlimitedBuffer：只抹 memoryPressure 溢出、不动向量
    const ub = await (await createGameCloud({
      gameId: 'gidbp5', gamePort: 7795, sources, cloud: fakeCloud(),
      backpressure: { unlimitedBuffer: true, now: 0 },
    })).status()
    expect(ub.backpressure.verdict.unlimitedBufferErasesOomOnly).toBe(true)
    // rigged 三开关齐开：真实现算 110/110/110/110、因果锁死 highThroughput
    const rig = await (await createGameCloud({
      gameId: 'gidbp6', gamePort: 7796, sources, cloud: fakeCloud(),
      backpressure: { rigged: true, now: 0 },
    })).status()
    expect(rig.backpressure.vectors).toEqual({ Backpressure: '110', Buffering: '110', Shedding: '110', Scaling: '110' })
    expect(rig.backpressure.verdict.highThroughputCausallyUnerasable).toBe(true)
    expect(rig.backpressure.verdict.noUniversalWinner).toBe(false)
    // 注入现成 study（duck-typed）
    const { backpressureStudy } = await import('../../scripts/caesura-backpressure.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gidbp7', gamePort: 7797, sources, cloud: fakeCloud(),
      backpressure: backpressureStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.backpressure.builtAt).toBe(555)
    expect(injected.backpressure.config.seed).toBe(99)
  })

  it("logCompaction:true ⇒ 装配日志压缩三策略、status.logCompaction 读真矩阵/三难向量/回放边界守恒/十一真件、builtAt 随 lcNow、惰性同引用（KI-526）", async () => {
    const gc = createGameCloud({
      gameId: 'gidlc1', gamePort: 7801, sources, cloud: fakeCloud(),
      logCompaction: true, lcNow: () => 8888,
    })
    expect(gc.runLogCompactionStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.logCompaction.builtAt).toBe(8888)                    // 注入时钟真求值（KI-517 契约延伸）
    expect(st.logCompaction.config.scenarios.length).toBe(6)
    expect(st.logCompaction.rows.length).toBe(3)
    expect(st.logCompaction.vectors).toEqual({ SizeTimeRetention: '101', KeyCompaction: '110', SnapshotPlusWal: '011' })
    const ret = st.logCompaction.rows.find((r: any) => r.strategy === 'SizeTimeRetention')!
    const key = st.logCompaction.rows.find((r: any) => r.strategy === 'KeyCompaction')!
    const snap = st.logCompaction.rows.find((r: any) => r.strategy === 'SnapshotPlusWal')!
    expect(ret.trilemma).toEqual({ compactFootprint: true, replayCompleteness: false, fastRecovery: true })   // 只丢回放完整
    expect(key.trilemma).toEqual({ compactFootprint: true, replayCompleteness: true, fastRecovery: false })  // 只亏恢复快
    expect(snap.trilemma).toEqual({ compactFootprint: false, replayCompleteness: true, fastRecovery: true }) // 只占空间
    // 回放边界守恒双路：稳态非平凡成立 + 三路篡改各自翻 false
    expect(st.logCompaction.replayBoundary.holds).toBe(true)
    expect(st.logCompaction.replayBoundary.nontrivial).toBe(true)
    expect(st.logCompaction.replayBoundary.falsifiable).toBe(true)
    // 十一真件交叉印证：21 字段真回读、非硬编码
    const ev = st.logCompaction.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bloomHit', 'bloomMiss', 'bucketAllowed', 'bucketRejected', 'busListeners', 'counterFalseSharing', 'counterSum', 'heapFired', 'jitterSpread', 'notices', 'poolCreated', 'poolReused', 'ringFirst', 'ringShardsUsed', 'shardHits', 'walLastSeq', 'walLines', 'walReplayed', 'zqFired', 'zqLostOnRestart', 'zqPendingAfterRestore'])
    expect(ev.walReplayed).toBe(6)
    expect(ev.walLastSeq).toBe(6)
    expect(ev.counterSum).toBe(36)
    expect(ev.notices).toBe(2)
    // exactly-once 真去重证据（非恒真）
    const crash = snap.scenarios.find((c: any) => c.id === 'crashMidReplay')
    expect(crash.dedupSkipped).toBeGreaterThan(0)
    expect(crash.exactlyOnce).toBe(true)
    expect(st.logCompaction.verdict.snapshotExactlyOnce).toBe(true)
    expect(st.logCompaction.verdict.noUniversalWinner).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).logCompaction).toBe(st.logCompaction)
    const rerun = await gc.runLogCompactionStudy!()
    expect(rerun.vectors).toEqual(st.logCompaction.vectors)
    // 不连坐 KI-518/520/523/525
    expect(st.delayQueue).toBe(null)
    expect(st.retryDlq).toBe(null)
    expect(st.consumerGroup).toBe(null)
    expect(st.backpressure).toBe(null)
  })

  it('logCompaction 默认 null 非破坏；单开 unlimitedRetention/instantSnapshot/zeroReplayCost 各自局部、rigged 110/110/110 因果锁死 fastRecovery；可注入现成 study（KI-526）', async () => {
    const plain = createGameCloud({ gameId: 'gidlc2', gamePort: 7802, sources, cloud: fakeCloud() })
    expect(plain.runLogCompactionStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.logCompaction).toBe(null)
    expect(ps.backpressure).toBe(null)
    // 单开 unlimitedRetention：补 Retention 回放完整必反噬快恢复
    const ur = await (await createGameCloud({
      gameId: 'gidlc3', gamePort: 7803, sources, cloud: fakeCloud(),
      logCompaction: { unlimitedRetention: true, now: 0 },
    })).status()
    expect(ur.logCompaction.verdict.unlimitedRetentionBackfiresRecovery).toBe(true)
    // 单开 instantSnapshot：补 Snapshot 省空间必反噬快恢复
    const is = await (await createGameCloud({
      gameId: 'gidlc4', gamePort: 7804, sources, cloud: fakeCloud(),
      logCompaction: { instantSnapshot: true, now: 0 },
    })).status()
    expect(is.logCompaction.verdict.instantSnapshotBackfiresRecovery).toBe(true)
    // 单开 zeroReplayCost 是许愿：向量一字不改
    const zr = await (await createGameCloud({
      gameId: 'gidlc5', gamePort: 7805, sources, cloud: fakeCloud(),
      logCompaction: { zeroReplayCost: true, now: 0 },
    })).status()
    expect(zr.logCompaction.verdict.zeroReplayCostErasesNothing).toBe(true)
    // rigged 三开关齐开：真实现算 110/110/110、因果锁死 fastRecovery
    const rig = await (await createGameCloud({
      gameId: 'gidlc6', gamePort: 7806, sources, cloud: fakeCloud(),
      logCompaction: { rigged: true, now: 0 },
    })).status()
    expect(rig.logCompaction.vectors).toEqual({ SizeTimeRetention: '110', KeyCompaction: '110', SnapshotPlusWal: '110' })
    expect(rig.logCompaction.verdict.fastRecoveryCausallyUnerasable).toBe(true)
    expect(rig.logCompaction.verdict.noUniversalWinner).toBe(false)
    // 注入现成 study（duck-typed）
    const { logCompactionStudy } = await import('../../scripts/caesura-log-compaction.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gidlc7', gamePort: 7807, sources, cloud: fakeCloud(),
      logCompaction: logCompactionStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.logCompaction.builtAt).toBe(555)
    expect(injected.logCompaction.config.seed).toBe(99)
  })

  it("bloomFilter:true ⇒ 装配布隆/布谷鸟/计数布隆三过滤器、status.bloomFilter 读真矩阵/三难向量/FP ceiling 双路自证/十一真件、builtAt 随 bfNow、惰性同引用（KI-527）", async () => {
    const gc = createGameCloud({
      gameId: 'gidbf1', gamePort: 7821, sources, cloud: fakeCloud(),
      bloomFilter: true, bfNow: () => 9999,
    })
    expect(gc.runBloomFilterStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.bloomFilter.builtAt).toBe(9999)                    // 注入时钟真求值（KI-517 契约延伸）
    expect(st.bloomFilter.config.scenarios.length).toBe(6)
    expect(st.bloomFilter.rows.length).toBe(3)
    expect(st.bloomFilter.vectors).toEqual({ Bloom: '110', CountingBloom: '011', Cuckoo: '101' })
    const bloom = st.bloomFilter.rows.find((r: any) => r.protocol === 'Bloom')!
    const cb = st.bloomFilter.rows.find((r: any) => r.protocol === 'CountingBloom')!
    const cuckoo = st.bloomFilter.rows.find((r: any) => r.protocol === 'Cuckoo')!
    expect(bloom.trilemma).toEqual({ compactFootprint: true, insertsNeverFail: true, deleteSupport: false })  // 只缺删
    expect(cb.trilemma).toEqual({ compactFootprint: false, insertsNeverFail: true, deleteSupport: true })    // 只缺空间
    expect(cuckoo.trilemma).toEqual({ compactFootprint: true, insertsNeverFail: false, deleteSupport: true }) // 只缺插入不失败
    expect(cuckoo.metrics.totalStashFailures).toBeGreaterThan(0) // Cuckoo 装载崖壁真拒插
    expect(cuckoo.metrics.totalInsertFailures).toBeGreaterThan(0)
    // FP ceiling 双路自证稳态成立 + 三路篡改真喂回现算翻 false
    const fc = st.bloomFilter.crosscheck.fpCeiling
    expect(fc.holds).toBe(true)
    expect(fc.nontrivial).toBe(true)
    expect(fc.falsifiable).toBe(true)
    expect(fc.tamper.trustConfig.holds).toBe(false)
    expect(fc.tamper.zeroFpr.holds).toBe(false)
    expect(fc.tamper.skipProbe.holds).toBe(false)
    // 十一真件交叉印证：21 键真回读、非硬编码
    const ev = st.bloomFilter.crosscheck.evidence
    expect(Object.keys(ev).sort()).toEqual(['bucketAllowed', 'bucketRejected', 'busListeners', 'counterFalseSharing', 'counterSum', 'heapFired', 'heapPending', 'jitterSpread', 'notices', 'poolCreated', 'poolReused', 'redisBitmapHits', 'redisSlots', 'remapConsistentRate', 'remapModuloRate', 'ringNodes', 'ringShardsUsed', 'routerMoved', 'routerTracked', 'walLines', 'walReplayed'])
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.heapFired).toBeGreaterThan(0)
    expect(ev.bucketAllowed).toBeGreaterThan(0)
    expect(st.bloomFilter.verdict.noUniversalWinner).toBe(true)
    expect(st.bloomFilter.verdict.trilemmaDistinguishes).toBe(true)
    expect(st.bloomFilter.verdict.bloomDeleteFree).toBe(true)
    expect(st.bloomFilter.verdict.cuckooStashWall).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).bloomFilter).toBe(st.bloomFilter)
    const rerun = await gc.runBloomFilterStudy!()
    expect(rerun.vectors).toEqual(st.bloomFilter.vectors)
    // 不连坐其它维
    expect(st.logCompaction).toBe(null)
    expect(st.backpressure).toBe(null)
    expect(st.consumerGroup).toBe(null)
  })

  it('bloomFilter 默认 null 非破坏；单开 unlimitedRoom/eternalStasis/noDeletesNeeded 各自局部、rigged 011/011/011 因果锁死 compactFootprint；可注入现成 study（KI-527）', async () => {
    const plain = createGameCloud({ gameId: 'gidbf2', gamePort: 7822, sources, cloud: fakeCloud() })
    expect(plain.runBloomFilterStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.bloomFilter).toBe(null)
    expect(ps.logCompaction).toBe(null)
    // 单开 unlimitedRoom：补 Cuckoo 不失败必反噬空间紧凑
    const ur = await (await createGameCloud({
      gameId: 'gidbf3', gamePort: 7823, sources, cloud: fakeCloud(),
      bloomFilter: { unlimitedRoom: true, now: 0 },
    })).status()
    expect(ur.bloomFilter.verdict.unlimitedRoomBackfiresCompactFootprint).toBe(true)
    // 单开 eternalStasis：抹删除必反噬 deletes 维
    const es = await (await createGameCloud({
      gameId: 'gidbf4', gamePort: 7824, sources, cloud: fakeCloud(),
      bloomFilter: { eternalStasis: true, now: 0 },
    })).status()
    expect(es.bloomFilter.verdict.eternalStasisBackfiresDeletes).toBe(true)
    // 单开 noDeletesNeeded：同样只反噬 deletes 维
    const nd = await (await createGameCloud({
      gameId: 'gidbf5', gamePort: 7825, sources, cloud: fakeCloud(),
      bloomFilter: { noDeletesNeeded: true, now: 0 },
    })).status()
    expect(nd.bloomFilter.verdict.noDeletesNeededBackfiresDeletes).toBe(true)
    // rigged 三开关齐开：真实现算 011/011/011、因果锁死 compactFootprint
    const rig = await (await createGameCloud({
      gameId: 'gidbf6', gamePort: 7826, sources, cloud: fakeCloud(),
      bloomFilter: { rigged: true, now: 0 },
    })).status()
    expect(rig.bloomFilter.vectors).toEqual({ Bloom: '011', CountingBloom: '011', Cuckoo: '011' })
    expect(rig.bloomFilter.verdict.compactFootprintCausallyUnerasable).toBe(true)
    expect(rig.bloomFilter.verdict.noUniversalWinner).toBe(false)
    // 注入现成 study（duck-typed）
    const { bloomFilterStudy } = await import('../../scripts/caesura-bloom-filter.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gidbf7', gamePort: 7827, sources, cloud: fakeCloud(),
      bloomFilter: bloomFilterStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.bloomFilter.builtAt).toBe(555)
    expect(injected.bloomFilter.config.seed).toBe(99)
  })

  it("cacheReplacement:true ⇒ 装配 LRU/2Q/ARC 三替换策略、status.cacheReplacement 读真矩阵/三难向量 010/110/101/双路自证/十一真件、builtAt 随 crNow、惰性同引用（KI-528）", async () => {
    const gc = createGameCloud({
      gameId: 'gidcr1', gamePort: 7831, sources, cloud: fakeCloud(),
      cacheReplacement: true, crNow: () => 9999,
    })
    expect(gc.runCacheReplacementStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.cacheReplacement.builtAt).toBe(9999)
    expect(st.cacheReplacement.config.scenarios.length).toBe(6)
    expect(st.cacheReplacement.rows.length).toBe(3)
    expect(st.cacheReplacement.vectors).toEqual({ LRU: '010', '2Q': '110', ARC: '101' })
    const lru = st.cacheReplacement.rows.find((r: any) => r.protocol === 'LRU')!
    const q2 = st.cacheReplacement.rows.find((r: any) => r.protocol === '2Q')!
    const arc = st.cacheReplacement.rows.find((r: any) => r.protocol === 'ARC')!
    expect(lru.trilemma).toEqual({ scanResistance: false, stableHitRate: true, adaptiveBalance: false })
    expect(q2.trilemma).toEqual({ scanResistance: true, stableHitRate: true, adaptiveBalance: false })
    expect(arc.trilemma).toEqual({ scanResistance: true, stableHitRate: false, adaptiveBalance: true })
    // cell 三布尔 + 考场标记直读同源，矩阵软肋字不靠阈值重算
    const scanCell = lru.scenarios.find((c: any) => c.id === 'scanFeast')!
    expect(scanCell.scanResistance).toBe(false)
    expect(scanCell.inScanExam).toBe(true)
    expect(arc.scenarios.find((c: any) => c.id === 'burstAlternates')!.adaptiveBalance).toBe(true)
    // 双路自证稳态成立 + 三路篡改真喂回现算翻 false
    const ds = st.cacheReplacement.crosscheck.dualSweep
    expect(ds.holds).toBe(true)
    expect(ds.nontrivial).toBe(true)
    expect(ds.tamper.laneATraceCorrupted.holds).toBe(false)
    expect(ds.tamper.laneBTraceCorrupted.holds).toBe(false)
    expect(ds.tamper.laneBSizedNull.holds).toBe(false)
    // 十一真件 21 键真回读
    const ev = st.cacheReplacement.crosscheck.evidence
    expect(Object.keys(ev).length).toBe(21)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.jitterSpread).toBeGreaterThan(0)
    expect(st.cacheReplacement.verdict.noUniversalWinner).toBe(true)
    expect(st.cacheReplacement.verdict.vectorFromTrilemma).toBe(true)
    expect(st.cacheReplacement.verdict.dualSweepHolds).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).cacheReplacement).toBe(st.cacheReplacement)
    const rerun = await gc.runCacheReplacementStudy!()
    expect(rerun.vectors).toEqual(st.cacheReplacement.vectors)
    // 不连坐其它维
    expect(st.bloomFilter).toBe(null)
    expect(st.logCompaction).toBe(null)
  })

  it('cacheReplacement 默认 null 非破坏；单开 unlimitedRoom/perfectFuture 各自局部、rigged 110/110/110 因果锁死 adaptiveBalance；可注入现成 study（KI-528）', async () => {
    const plain = createGameCloud({ gameId: 'gidcr2', gamePort: 7832, sources, cloud: fakeCloud() })
    expect(plain.runCacheReplacementStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.cacheReplacement).toBe(null)
    expect(ps.bloomFilter).toBe(null)
    // 单开 unlimitedRoom：抹 scan/stable 必反噬 adaptive
    const ur = await (await createGameCloud({
      gameId: 'gidcr3', gamePort: 7833, sources, cloud: fakeCloud(),
      cacheReplacement: { unlimitedRoom: true, now: 0 },
    })).status()
    expect(ur.cacheReplacement.verdict.trilemmaDistinguishes).toBe(false)
    expect(ur.cacheReplacement.vectors.ARC).toBe('110')
    // 单开 perfectFuture：抹 LRU 抗扫维
    const pf = await (await createGameCloud({
      gameId: 'gidcr4', gamePort: 7834, sources, cloud: fakeCloud(),
      cacheReplacement: { perfectFuture: true, now: 0 },
    })).status()
    expect(pf.cacheReplacement.vectors.LRU).toBe('110')
    // rigged 双开关齐开：真实现算 110/110/110、因果锁死 adaptiveBalance
    const rig = await (await createGameCloud({
      gameId: 'gidcr5', gamePort: 7835, sources, cloud: fakeCloud(),
      cacheReplacement: { rigged: true, now: 0 },
    })).status()
    expect(rig.cacheReplacement.vectors).toEqual({ LRU: '110', '2Q': '110', ARC: '110' })
    expect(rig.cacheReplacement.verdict.adaptiveBalanceCausallyUnerasable).toBe(true)
    expect(rig.cacheReplacement.verdict.noUniversalWinner).toBe(false)
    expect(rig.cacheReplacement.verdict.vectorFromTrilemma).toBe(true)
    // 注入现成 study（duck-typed）
    const { cacheReplacementStudy } = await import('../../scripts/caesura-cache-replacement.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gidcr6', gamePort: 7836, sources, cloud: fakeCloud(),
      cacheReplacement: cacheReplacementStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.cacheReplacement.builtAt).toBe(555)
    expect(injected.cacheReplacement.config.seed).toBe(99)
  })

  it("streamWindow:true ⇒ 装配 Tumbling/Sliding/Session 三策略、status.streamWindow 读真矩阵/三难向量 011/110/101/双路自证/十一真件、builtAt 随 swNow、惰性同引用（KI-529）", async () => {
    const gc = createGameCloud({
      gameId: 'gidsw1', gamePort: 7837, sources, cloud: fakeCloud(),
      streamWindow: true, swNow: () => 9999,
    })
    expect(gc.runStreamWindowStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.streamWindow.builtAt).toBe(9999)
    expect(st.streamWindow.config.scenarios.length).toBe(6)
    expect(st.streamWindow.rows.length).toBe(3)
    expect(st.streamWindow.vectors).toEqual({ Tumbling: '011', Sliding: '110', Session: '101' })
    const tum = st.streamWindow.rows.find((r: any) => r.protocol === 'Tumbling')!
    const sli = st.streamWindow.rows.find((r: any) => r.protocol === 'Sliding')!
    const ses = st.streamWindow.rows.find((r: any) => r.protocol === 'Session')!
    expect(tum.trilemma).toEqual({ resultCompleteness: false, lateTolerance: true, stateEfficiency: true })
    expect(sli.trilemma).toEqual({ resultCompleteness: true, lateTolerance: true, stateEfficiency: false })
    expect(ses.trilemma).toEqual({ resultCompleteness: true, lateTolerance: false, stateEfficiency: true })
    // cell 三布尔 + 考场标记直读同源
    const boundary = tum.scenarios.find((c: any) => c.id === 'boundaryStraddle')!
    expect(boundary.resultCompleteness).toBe(false)
    expect(boundary.inResultExam).toBe(true)
    expect(ses.scenarios.find((c: any) => c.id === 'lateBeyondGap')!.lateSideOutput).toBeGreaterThan(0)
    // 双路自证稳态成立 + 三路篡改真喂回现算翻 false
    const wm = st.streamWindow.crosscheck.watermark
    expect(wm.holds).toBe(true)
    expect(wm.nontrivial).toBe(true)
    expect(wm.laneA.closed).toBeGreaterThanOrEqual(1)
    expect(wm.tamper.watermarkInverted.holds).toBe(false)
    expect(wm.tamper.dispositionTampered.holds).toBe(false)
    expect(wm.tamper.emptySet.holds).toBe(false)
    // 十一真件 21 键真回读
    const ev = st.streamWindow.crosscheck.evidence
    expect(Object.keys(ev).length).toBe(21)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.jitterSpread).toBeGreaterThanOrEqual(0)
    expect(st.streamWindow.verdict.noUniversalWinner).toBe(true)
    expect(st.streamWindow.verdict.vectorFromTrilemma).toBe(true)
    expect(st.streamWindow.verdict.watermarkHolds).toBe(true)
    expect(st.streamWindow.verdict.frozenCollapsesCompleteness).toBe(true)
    expect(st.streamWindow.verdict.infiniteRestoresSessionLate).toBe(true)
    expect(st.streamWindow.verdict.freeRestoresSlidingState).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).streamWindow).toBe(st.streamWindow)
    const rerun = await gc.runStreamWindowStudy!()
    expect(rerun.vectors).toEqual(st.streamWindow.vectors)
    // 不连坐其它维
    expect(st.bloomFilter).toBe(null)
    expect(st.cacheReplacement).toBe(null)
  })

  it('streamWindow 默认 null 非破坏；单开 frozen/infinite/free 各自局部、rigged 011/011/011 因果锁死 resultCompleteness；可注入现成 study（KI-529）', async () => {
    const plain = createGameCloud({ gameId: 'gidsw2', gamePort: 7838, sources, cloud: fakeCloud() })
    expect(plain.runStreamWindowStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.streamWindow).toBe(null)
    expect(ps.cacheReplacement).toBe(null)
    // 单开 frozenWatermark：无窗定稿 ⇒ 结果完整维真塌
    const fz = await (await createGameCloud({
      gameId: 'gidsw3', gamePort: 7839, sources, cloud: fakeCloud(),
      streamWindow: { frozenWatermark: true, now: 0 },
    })).status()
    expect(fz.streamWindow.verdict.frozenCollapsesCompleteness).toBe(true)
    expect(fz.streamWindow.rows.every((r: any) => r.metrics.emittedWindows === 0)).toBe(true)
    expect(fz.streamWindow.rows.every((r: any) => r.trilemma.resultCompleteness === false)).toBe(true)
    // 单开 freeState：Sliding 放大归一 ⇒ 状态省维真抹
    const fr = await (await createGameCloud({
      gameId: 'gidsw4', gamePort: 7840, sources, cloud: fakeCloud(),
      streamWindow: { freeState: true, now: 0 },
    })).status()
    expect(fr.streamWindow.verdict.freeRestoresSlidingState).toBe(true)
    // 单开 infiniteLateness：Session 迟到维真抹
    const inf = await (await createGameCloud({
      gameId: 'gidsw5', gamePort: 7841, sources, cloud: fakeCloud(),
      streamWindow: { infiniteLateness: true, now: 0 },
    })).status()
    expect(inf.streamWindow.verdict.infiniteRestoresSessionLate).toBe(true)
    // rigged 三开关齐开：真实现算 011/011/011、因果锁死 resultCompleteness
    const rig = await (await createGameCloud({
      gameId: 'gidsw6', gamePort: 7842, sources, cloud: fakeCloud(),
      streamWindow: { rigged: true, now: 0 },
    })).status()
    expect(rig.streamWindow.vectors).toEqual({ Tumbling: '011', Sliding: '011', Session: '011' })
    expect(rig.streamWindow.verdict.resultCompletenessCausallyUnerasable).toBe(true)
    expect(rig.streamWindow.verdict.noUniversalWinner).toBe(false)
    expect(rig.streamWindow.verdict.vectorFromTrilemma).toBe(true)
    // 注入现成 study（duck-typed）
    const { streamWindowStudy } = await import('../../scripts/caesura-stream-window.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gidsw7', gamePort: 7843, sources, cloud: fakeCloud(),
      streamWindow: streamWindowStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.streamWindow.builtAt).toBe(555)
    expect(injected.streamWindow.config.seed).toBe(99)
  })

  it("hyperLogLog:true ⇒ 装配 ExactSet/HyperLogLog/LinearCounting 三估计器、status.hyperLogLog 读真矩阵/三难向量 101/110/010/双路自证/十一真件、builtAt 随 hllNow、惰性同引用（KI-530）", async () => {
    const gc = createGameCloud({
      gameId: 'gidhll1', gamePort: 7844, sources, cloud: fakeCloud(),
      hyperLogLog: true, hllNow: () => 53000,
    })
    expect(gc.runStreamCardinalityStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.hyperLogLog.builtAt).toBe(53000)
    expect(st.hyperLogLog.config.scenarios.length).toBe(6)
    expect(st.hyperLogLog.rows.length).toBe(3)
    expect(st.hyperLogLog.vectors).toEqual({ ExactSet: '101', HyperLogLog: '110', LinearCounting: '010' })
    const es = st.hyperLogLog.rows.find((r: any) => r.protocol === 'ExactSet')!
    const hll = st.hyperLogLog.rows.find((r: any) => r.protocol === 'HyperLogLog')!
    const lc = st.hyperLogLog.rows.find((r: any) => r.protocol === 'LinearCounting')!
    expect(es.trilemma).toEqual({ estimatorAccuracy: true, fixedMemory: false, mergeable: true })
    expect(hll.trilemma).toEqual({ estimatorAccuracy: true, fixedMemory: true, mergeable: false })
    expect(lc.trilemma).toEqual({ estimatorAccuracy: false, fixedMemory: true, mergeable: false })
    // 双路自证稳态成立 + 三路篡改真喂回现算翻 false
    const ve = st.hyperLogLog.crosscheck.estimate
    expect(ve.holds).toBe(true)
    expect(ve.nontrivial).toBe(true)
    expect(ve.tamper.registerCorrupted.holds).toBe(false)
    expect(ve.tamper.bitsTooBig.holds).toBe(false)
    expect(ve.tamper.emptySet.holds).toBe(false)
    // 十一真件 21 键真回读
    const ev = st.hyperLogLog.crosscheck.evidence
    expect(Object.keys(ev).length).toBe(21)
    expect(ev.jitterSpread).toBeGreaterThanOrEqual(0)
    expect(st.hyperLogLog.verdict.noUniversalWinner).toBe(true)
    expect(st.hyperLogLog.verdict.vectorFromTrilemma).toBe(true)
    expect(st.hyperLogLog.verdict.linearCountingSaturates).toBe(true)
    expect(st.hyperLogLog.verdict.linearCountingSaturationCausallyUnerasable).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).hyperLogLog).toBe(st.hyperLogLog)
    const rerun = await gc.runStreamCardinalityStudy!()
    expect(rerun.vectors).toEqual(st.hyperLogLog.vectors)
    // 不连坐其它维
    expect(st.streamWindow).toBe(null)
    expect(st.bloomFilter).toBe(null)
  })

  it('hyperLogLog 默认 null 非破坏；单开 perfectHash/unlimitedMemory 各自局部、rigged 111/110/010 因果锁死 LC 饱和；可注入现成 study（KI-530）', async () => {
    const plain = createGameCloud({ gameId: 'gidhll2', gamePort: 7845, sources, cloud: fakeCloud() })
    expect(plain.runStreamCardinalityStudy).toBe(null)
    const ps = await plain.status()
    expect(ps.hyperLogLog).toBe(null)
    expect(ps.cacheReplacement).toBe(null)
    // 单开 perfectHash：HLL/LC accuracy 抹，但 LC 位图饱和因果锁死仍 010
    const ph = await (await createGameCloud({
      gameId: 'gidhll3', gamePort: 7846, sources, cloud: fakeCloud(),
      hyperLogLog: { perfectHash: true, now: 0 },
    })).status()
    expect(ph.hyperLogLog.vectors.LinearCounting).toBe('010')
    expect(ph.hyperLogLog.verdict.perfectHashErasesError).toBe(true)
    // 单开 unlimitedMemory：ExactSet 内存维抹 ⇒ 111
    const um = await (await createGameCloud({
      gameId: 'gidhll4', gamePort: 7847, sources, cloud: fakeCloud(),
      hyperLogLog: { unlimitedMemory: true, now: 0 },
    })).status()
    expect(um.hyperLogLog.vectors.ExactSet).toBe('111')
    expect(um.hyperLogLog.verdict.unlimitedRoomErasesGrowth).toBe(true)
    // rigged 双开关齐开：现算 111/110/010、LC 饱和因果锁死、绝不硬造全策略 111
    const rig = await (await createGameCloud({
      gameId: 'gidhll5', gamePort: 7848, sources, cloud: fakeCloud(),
      hyperLogLog: { rigged: true, now: 0 },
    })).status()
    expect(rig.hyperLogLog.vectors).toEqual({ ExactSet: '111', HyperLogLog: '110', LinearCounting: '010' })
    expect(rig.hyperLogLog.verdict.noUniversalWinner).toBe(false)
    expect(rig.hyperLogLog.verdict.trilemmaDistinguishes).toBe(true)
    expect(rig.hyperLogLog.verdict.linearCountingSaturationCausallyUnerasable).toBe(true)
    expect(rig.hyperLogLog.verdict.vectorFromTrilemma).toBe(true)
    // 注入现成 study（duck-typed）
    const { streamCardinalityStudy } = await import('../../scripts/caesura-hyperloglog.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gidhll6', gamePort: 7849, sources, cloud: fakeCloud(),
      hyperLogLog: streamCardinalityStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.hyperLogLog.builtAt).toBe(555)
    expect(injected.hyperLogLog.config.seed).toBe(99)
  })

  it("crdt:true ⇒ 装配 LWWRegister/GCounter/OrSet 三真 CRDT、status.crdt 读真矩阵/三难向量 011/100/110/双路自证+三路可证伪/三因果锁/十一真件、builtAt 随 crdtNow、惰性同引用（KI-531）", async () => {
    const gc = createGameCloud({
      gameId: 'gidcrdt1', gamePort: 7854, sources, cloud: fakeCloud(),
      crdt: true, crdtNow: () => 53100,
    })
    expect(gc.runCrdtStudy).toBeTypeOf('function')
    const st = await gc.status()
    expect(st.crdt.builtAt).toBe(53100)
    expect(st.crdt.config.scenarios.length).toBe(6)
    expect(st.crdt.rows.length).toBe(3)
    expect(st.crdt.vectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    expect(st.crdt.baseVectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    const lww = st.crdt.rows.find((r: any) => r.protocol === 'LWWRegister')!
    const gc2 = st.crdt.rows.find((r: any) => r.protocol === 'GCounter')!
    const os = st.crdt.rows.find((r: any) => r.protocol === 'OrSet')!
    expect(lww.trilemma).toEqual({ strongEventualConvergence: false, expressiveness: true, compactMetadata: true })
    expect(gc2.trilemma).toEqual({ strongEventualConvergence: true, expressiveness: false, compactMetadata: false })
    expect(os.trilemma).toEqual({ strongEventualConvergence: true, expressiveness: true, compactMetadata: false })
    // 诚实口径：三者严格 SEC 全收敛、LWW 破在并发意图、OrSet add-wins
    expect(st.crdt.verdict.secStrictAllConverge).toBe(true)
    expect(st.crdt.verdict.lwwSecBreaksOnConcurrentIntent).toBe(true)
    expect(st.crdt.verdict.orSetIsAddWins).toBe(true)
    // 双路自证 + 三路篡改真喂回现算翻 false（基线先真绿）
    const vc = st.crdt.crosscheck.convergence
    expect(vc.holds).toBe(true)
    expect(vc.nontrivial).toBe(true)
    expect(vc.tamper.dropReplica.holds).toBe(false)
    expect(vc.tamper.dropReplica.baselineHolds).toBe(true)
    expect(vc.tamper.reverseLwwDecision.holds).toBe(false)
    expect(vc.tamper.emptySet.holds).toBe(false)
    // 十一真件 21 键真回读
    const ev = st.crdt.crosscheck.evidence
    expect(Object.keys(ev).length).toBe(21)
    expect(ev.jitterSpread).toBeGreaterThanOrEqual(0)
    expect(st.crdt.verdict.noUniversalWinner).toBe(true)
    expect(st.crdt.verdict.vectorFromTrilemma).toBe(true)
    expect(st.crdt.verdict.causalLocksAllHold).toBe(true)
    expect(st.crdt.verdict.decrementCausallyUnerasable).toBe(true)
    expect(st.crdt.verdict.lwwConcurrentLossCausallyUnerasable).toBe(true)
    expect(st.crdt.verdict.orSetTagHistoryCausallyUnerasable).toBe(true)
    // 惰性缓存：二次 status 同引用
    expect((await gc.status()).crdt).toBe(st.crdt)
    const rerun = await gc.runCrdtStudy!()
    expect(rerun.vectors).toEqual(st.crdt.vectors)
    // 不连坐其它维
    expect(st.hyperLogLog).toBe(null)
    expect(st.streamWindow).toBe(null)
  })

  it('crdt 默认 null 非破坏；rigged 三开关唯一翻 GCounter compact⇒101、三因果锁钉死不硬造 111；可注入现成 study（KI-531）', async () => {
    const bare = await createGameCloud({ gameId: 'gidcrdt2', gamePort: 7855, sources, cloud: fakeCloud() }).status()
    expect(bare.crdt).toBe(null)
    expect(bare.hyperLogLog).toBe(null)
    // 单开各开关向量仍 011/100/110，不硬造 111
    let port = 7856
    for (const one of [{ uniformClock: true }, { infiniteMetadata: true }, { coordinatedDelete: true }]) {
      const s = await (await createGameCloud({
        gameId: 'gidcrdt-single-' + port, gamePort: port++, sources, cloud: fakeCloud(),
        crdt: { ...one, now: 0 },
      })).status()
      expect(s.crdt.vectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
      expect(s.crdt.rigged).toBe(false)
    }
    // rigged 三开关齐开：唯一翻 GCounter compact、三条因果锁钉死、noUniversalWinner 仍真
    const rig = await (await createGameCloud({
      gameId: 'gidcrdt4', gamePort: 7857, sources, cloud: fakeCloud(),
      crdt: { rigged: true, now: 0 },
    })).status()
    expect(rig.crdt.vectors).toEqual({ LWWRegister: '011', GCounter: '101', OrSet: '110' })
    expect(rig.crdt.baseVectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    expect(rig.crdt.verdict.noUniversalWinner).toBe(true)
    expect(rig.crdt.verdict.noUniversalWinnerStrict).toBe(true)
    expect(rig.crdt.verdict.gcounterCompactErasableByFreeMemory).toBe(true)
    expect(rig.crdt.verdict.causalLocksAllHold).toBe(true)
    expect(rig.crdt.verdict.vectorFromTrilemma).toBe(true)
    // 注入现成 study（duck-typed）
    const { crdtStudy } = await import('../../scripts/caesura-crdt.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gidcrdt5', gamePort: 7858, sources, cloud: fakeCloud(),
      crdt: crdtStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.crdt.builtAt).toBe(555)
    expect(injected.crdt.config.seed).toBe(99)
  })

  // ============ KI-532 Spring Batch chunk-oriented R-P-W opt-in 装配（2 腿）============
  it('springBatch:true 装配真矩阵：001/110/101 互异不封赢家 + 三因果锁 + verifyCheckpoint 双路 + 三路篡改真喂回 + 21 键 + 惰性同引用（KI-532）', async () => {
    const gc = await createGameCloud({
      gameId: 'gid-sb1', gamePort: 7860, sources, cloud: fakeCloud(),
      springBatch: true, sbNow: () => 532000,
    })
    const st = (await gc.status()).springBatch
    expect(st).not.toBe(null)
    expect(st!.builtAt).toBe(532000)
    expect(st!.config.scenarios.length).toBe(6)
    expect(st!.config.items).toBe(96)
    expect(st!.rows.length).toBe(3)
    expect(st!.vectors).toEqual({ BulkWriter: '001', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(st!.rigged).toBe(false)
    expect(st!.noUniversalWinner).toBe(true)
    expect(st!.trilemmaDistinguishes).toBe(true)
    expect(st!.verdict.noStrategyWinsAll).toBe(true)
    expect(st!.verdict.vectorFromTrilemma).toBe(true)
    // 三因果结构锁
    expect(st!.causalLocks.causalLocksAllHold).toBe(true)
    expect(st!.causalLocks.checkpointTradeoffCausallyUnerasable).toBe(true)
    expect(st!.causalLocks.skipSilentLossCausallyUnerasable).toBe(true)
    expect(st!.causalLocks.bulkAllOrNothingCausallyUnerasable).toBe(true)
    // verifyCheckpoint 双路 + 三路篡改真喂回（带 baselineHolds）
    const cp = st!.crosscheck.checkpoint
    expect(cp.holds).toBe(true)
    expect(cp.baselineHolds).toBe(true)
    expect(cp.nontrivial).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.corruptedCheckpoint.holds).toBe(false)
    expect(cp.tamper.silentPoison.holds).toBe(false)
    expect(cp.tamper.emptyJob.holds).toBe(false)
    expect(Object.keys(st!.crosscheck.evidence).length).toBe(21)
    // 主教义恒以纯净基线标定
    expect(st!.verdict.bulkExplodesOnPoison).toBe(true)
    expect(st!.verdict.chunkedChkAvailable).toBe(true)
    expect(st!.verdict.skipSilentLoss).toBe(true)
    // 惰性缓存 + 可重跑同向量
    expect((await gc.status()).springBatch).toBe(st)
    expect(await gc.runSpringBatchStudy!()).toMatchObject({ vectors: st!.vectors })
    // 不连坐其它维
    expect(st!.rigged).toBe(false)
    const bare = await createGameCloud({ gameId: 'gid-sb0', gamePort: 7861, sources, cloud: fakeCloud() }).status()
    expect(bare.springBatch).toBe(null)
    expect(bare.crdt).toBe(null)
  })

  it('springBatch 默认 null 非破坏；单开开关主教义不破、rigged 区分度诚实收敛但不硬造 111；可注入现成 study（KI-532）', async () => {
    // 单开 perfectOracle：预防剔除毒项 ⇒ Bulk faultIsolation 真翻 101（oracle 抹掉整批死），但主教义恒以纯净基线标定不翻；
    // 单开 unlimitedSkip：不抹 faultIsolation、不创 chk ⇒ 默认向量仍 001/110/101。两者 rigged 都未齐开。
    const oracle = await (await createGameCloud({
      gameId: 'gid-sb-oracle', gamePort: 7862, sources, cloud: fakeCloud(),
      springBatch: { perfectOracle: true, now: 0 },
    })).status()
    expect(oracle.springBatch.vectors).toEqual({ BulkWriter: '101', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(oracle.springBatch.rigged).toBe(false)
    expect(oracle.springBatch.verdict.bulkExplodesOnPoison).toBe(true)
    expect(oracle.springBatch.verdict.perfectOracleErasesPoison).toBe(true)
    const skipOnly = await (await createGameCloud({
      gameId: 'gid-sb-skip', gamePort: 7863, sources, cloud: fakeCloud(),
      springBatch: { unlimitedSkip: true, now: 0 },
    })).status()
    expect(skipOnly.springBatch.vectors).toEqual({ BulkWriter: '001', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(skipOnly.springBatch.rigged).toBe(false)
    expect(skipOnly.springBatch.verdict.bulkExplodesOnPoison).toBe(true)
    expect(skipOnly.springBatch.verdict.unlimitedSkipNoRestart).toBe(true)
    // rigged：预防剔除毒项干净流 ⇒ Bulk≡Skip=101 区分度诚实收敛、noStrategyWinsAll 仍真、三锁钉死
    const rig = await (await createGameCloud({
      gameId: 'gid-sb-rig', gamePort: 7864, sources, cloud: fakeCloud(),
      springBatch: { rigged: true, now: 0 },
    })).status()
    expect(rig.springBatch.vectors).toEqual({ BulkWriter: '101', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(rig.springBatch.rigged).toBe(true)
    expect(rig.springBatch.trilemmaDistinguishes).toBe(false)
    expect(rig.springBatch.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.springBatch.verdict.noStrategyWinsAll).toBe(true)
    expect(rig.springBatch.verdict.bulkExplodesOnPoison).toBe(true)
    expect(rig.springBatch.causalLocks.causalLocksAllHold).toBe(true)
    // 注入 items/chunkSize/skipLimit 真生效
    const tuned = await (await createGameCloud({
      gameId: 'gid-sb-tuned', gamePort: 7865, sources, cloud: fakeCloud(),
      springBatch: { items: 128, chunkSize: 16, skipLimit: 5, seed: 7, now: 77 },
    })).status()
    expect(tuned.springBatch.config.items).toBe(128)
    expect(tuned.springBatch.config.chunkSize).toBe(16)
    expect(tuned.springBatch.rows[0].scenarios[0].size).toBe(128)
    expect(tuned.springBatch.builtAt).toBe(77)
    // 注入现成 study（duck-typed）
    const { springBatchStudy } = await import('../../scripts/caesura-spring-batch.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gid-sb-inj', gamePort: 7866, sources, cloud: fakeCloud(),
      springBatch: springBatchStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.springBatch.builtAt).toBe(555)
    expect(injected.springBatch.config.seed).toBe(99)
  })

  // ============ KI-533 可观测性追踪采样 opt-in 装配（2 腿）============
  it('traceSampling:true 装配真矩阵：100/010/101 互异不封赢家 + 三因果锁 + verifySamplingSoundness 双路 + 三路篡改真喂回 + 21 键 + 惰性同引用（KI-533）', async () => {
    const gc = await createGameCloud({
      gameId: 'gid-ts1', gamePort: 7870, sources, cloud: fakeCloud(),
      traceSampling: true, tsNow: () => 533000,
    })
    const st = (await gc.status()).traceSampling
    expect(st).not.toBe(null)
    expect(st!.builtAt).toBe(533000)
    expect(st!.config.scenarios.length).toBe(6)
    expect(st!.config.items).toBe(64)
    expect(st!.rows.length).toBe(3)
    expect(st!.vectors).toEqual({ HeadBasedSampler: '100', TailBasedSampler: '010', AdaptiveSampler: '101' })
    expect(st!.rigged).toBe(false)
    expect(st!.noUniversalWinner).toBe(true)
    expect(st!.trilemmaDistinguishes).toBe(true)
    expect(st!.verdict.noStrategyWinsAll).toBe(true)
    expect(st!.verdict.vectorFromTrilemma).toBe(true)
    // 三因果结构锁（含翻转标签逐 id 决策恒同的结构判据）
    expect(st!.causalLocks.causalLocksAllHold).toBe(true)
    expect(st!.causalLocks.anomalyRequiresBufferingCausallyUnerasable).toBe(true)
    expect(st!.causalLocks.headBlindnessCausallyUnerasable).toBe(true)
    expect(st!.causalLocks.adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable).toBe(true)
    expect(st!.causalLocks.decisionInvariant).toBe(true)
    // verifySamplingSoundness 双路 + 三路篡改真喂回（带 baselineHolds）
    const sm = st!.crosscheck.soundness
    expect(sm.holds).toBe(true)
    expect(sm.baselineHolds).toBe(true)
    expect(sm.nontrivial).toBe(true)
    expect(sm.falsifiable).toBe(true)
    expect(sm.tamper.forgedErrorSpan.holds).toBe(false)
    expect(sm.tamper.duplicateRelease.holds).toBe(false)
    expect(sm.tamper.emptyTraceSet.holds).toBe(false)
    expect(Object.keys(st!.crosscheck.evidence).length).toBe(21)
    // 主教义恒以纯净基线标定
    expect(st!.verdict.headBlindLossOnErrorBurst).toBe(true)
    expect(st!.verdict.tailGuaranteesAnomaly).toBe(true)
    expect(st!.verdict.adaptiveTracksLoad).toBe(true)
    // 惰性缓存 + 可重跑同向量
    expect((await gc.status()).traceSampling).toBe(st)
    expect(await gc.runTraceSamplingStudy!()).toMatchObject({ vectors: st!.vectors })
    // 不连坐其它维
    const bare = await createGameCloud({ gameId: 'gid-ts0', gamePort: 7871, sources, cloud: fakeCloud() }).status()
    expect(bare.traceSampling).toBe(null)
    expect(bare.springBatch).toBe(null)
  })

  it('traceSampling 默认 null 非破坏；三开关分策略正交反噬、rigged Head≡Tail=110 诚实塌缩但不硬造 111；可注入现成 study（KI-533）', async () => {
    // 单开 oracleHead：只翻 Head 补 anomaly 维 100→110，主教义恒以纯净基线标定不翻；
    // 单开 infiniteBuffer：只翻 Tail 补 lowOverhead 维 010→110；
    // 单开 perfectFeedback：Adaptive 向量不变 101、只改善 errorBurst 质量。
    const oracle = await (await createGameCloud({
      gameId: 'gid-ts-oracle', gamePort: 7872, sources, cloud: fakeCloud(),
      traceSampling: { oracleHead: true, now: 0 },
    })).status()
    expect(oracle.traceSampling.vectors).toEqual({ HeadBasedSampler: '110', TailBasedSampler: '010', AdaptiveSampler: '101' })
    expect(oracle.traceSampling.rigged).toBe(false)
    expect(oracle.traceSampling.verdict.oracleHeadErasesHeadBlindness).toBe(true)
    expect(oracle.traceSampling.verdict.headBlindLossOnErrorBurst).toBe(true)
    const buf = await (await createGameCloud({
      gameId: 'gid-ts-buf', gamePort: 7873, sources, cloud: fakeCloud(),
      traceSampling: { infiniteBuffer: true, now: 0 },
    })).status()
    expect(buf.traceSampling.vectors).toEqual({ HeadBasedSampler: '100', TailBasedSampler: '110', AdaptiveSampler: '101' })
    expect(buf.traceSampling.verdict.infiniteBufferErasesOverhead).toBe(true)
    expect(buf.traceSampling.verdict.tailGuaranteesAnomaly).toBe(true)
    const feed = await (await createGameCloud({
      gameId: 'gid-ts-feed', gamePort: 7874, sources, cloud: fakeCloud(),
      traceSampling: { perfectFeedback: true, now: 0 },
    })).status()
    expect(feed.traceSampling.vectors.AdaptiveSampler).toBe('101')
    expect(feed.traceSampling.verdict.perfectFeedbackImprovesBurstOnly).toBe(true)
    // rigged：三开关分策略正交反事实，Head≡Tail=110 区分度诚实塌缩、noStrategyWinsAll 仍真、三锁钉死
    const rig = await (await createGameCloud({
      gameId: 'gid-ts-rig', gamePort: 7875, sources, cloud: fakeCloud(),
      traceSampling: { rigged: true, now: 0 },
    })).status()
    expect(rig.traceSampling.vectors).toEqual({ HeadBasedSampler: '110', TailBasedSampler: '110', AdaptiveSampler: '101' })
    expect(rig.traceSampling.rigged).toBe(true)
    expect(rig.traceSampling.trilemmaDistinguishes).toBe(false)
    expect(rig.traceSampling.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.traceSampling.verdict.noStrategyWinsAll).toBe(true)
    expect(rig.traceSampling.verdict.headBlindLossOnErrorBurst).toBe(true)
    expect(rig.traceSampling.causalLocks.causalLocksAllHold).toBe(true)
    // 注入 items/rate/windowSize 真生效
    const tuned = await (await createGameCloud({
      gameId: 'gid-ts-tuned', gamePort: 7876, sources, cloud: fakeCloud(),
      traceSampling: { items: 128, rate: 0.3, windowSize: 8, seed: 7, now: 77 },
    })).status()
    expect(tuned.traceSampling.config.items).toBe(128)
    expect(tuned.traceSampling.config.rate).toBe(0.3)
    expect(tuned.traceSampling.config.windowSize).toBe(8)
    expect(tuned.traceSampling.rows[0].scenarios[0].spansIn).toBeGreaterThan(0)
    expect(tuned.traceSampling.builtAt).toBe(77)
    // 注入现成 study（duck-typed）
    const { traceSamplingStudy } = await import('../../scripts/caesura-trace-sampling.mjs')
    const injected = await (await createGameCloud({
      gameId: 'gid-ts-inj', gamePort: 7877, sources, cloud: fakeCloud(),
      traceSampling: traceSamplingStudy({ seed: 99, now: 555 }),
    })).status()
    expect(injected.traceSampling.builtAt).toBe(555)
    expect(injected.traceSampling.config.seed).toBe(99)
  })

  // ============ KI-535 Spring Cloud 分布式会话 opt-in 装配（2 腿）============
  it('distributedSession:true 装配真矩阵：011/101/110 互异不封赢家 + 三因果锁 + verifySessionCoherence 双路 + 三路篡改真喂回 + 21 键 + 惰性同引用（KI-535）', async () => {
    const gc = await createGameCloud({
      gameId: 'gid-ds1', gamePort: 7872, sources, cloud: fakeCloud(),
      distributedSession: true, dsNow: () => 535000,
    })
    const st = (await gc.status()).distributedSession
    expect(st).not.toBe(null)
    expect(st!.builtAt).toBe(535000)
    expect(st!.config.scenarios.length).toBe(6)
    expect(st!.config.sessions).toBe(96)
    expect(st!.rows.length).toBe(3)
    expect(st!.vectors).toEqual({ StickySession: '011', JwtStateless: '101', RedisSessionStore: '110' })
    expect(st!.rigged).toBe(false)
    expect(st!.noUniversalWinner).toBe(true)
    expect(st!.trilemmaDistinguishes).toBe(true)
    expect(st!.verdict.noStrategyWinsAll).toBe(true)
    expect(st!.verdict.vectorFromTrilemma).toBe(true)
    // 三因果结构锁
    expect(st!.causalLocks.causalLocksAllHold).toBe(true)
    expect(st!.causalLocks.stickySingleNodeCausallyUnerasable).toBe(true)
    expect(st!.causalLocks.jwtNoInstantRevokeCausallyUnerasable).toBe(true)
    expect(st!.causalLocks.redisColdStartCausallyUnerasable).toBe(true)
    // verifySessionCoherence 双路 + 三路篡改真喂回
    const cp = st!.crosscheck.coherence
    expect(cp.holds).toBe(true)
    expect(cp.nontrivial).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.corruptedSession.holds).toBe(false)
    expect(cp.tamper.silentRevoke.holds).toBe(false)
    expect(cp.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(st!.crosscheck.evidence).length).toBe(21)
    // 主教义
    expect(st!.verdict.stickyFailsOverLoss).toBe(true)
    expect(st!.verdict.jwtNoInstantRevoke).toBe(true)
    expect(st!.verdict.redisPaysInfra).toBe(true)
    // 惰性缓存 + 同引用 + 重跑同向量
    expect((await gc.status()).distributedSession).toBe(st)
    expect(await gc.runDistributedSessionStudy!()).toMatchObject({ vectors: st!.vectors })
    // 不连坐其它维
    const bare = await createGameCloud({ gameId: 'gid-ds0', gamePort: 7873, sources, cloud: fakeCloud() }).status()
    expect(bare.distributedSession).toBe(null)
    expect(bare.traceSampling).toBe(null)
    expect(bare.springBatch).toBe(null)
  })

  it('distributedSession 默认 null 非破坏；三开关分策略正交反噬、rigged Sticky≡JWT=111 诚实塌缩但不硬造默认 111；可注入现成 study（KI-535）', async () => {
    // 默认 null
    const idle = await createGameCloud({ gameId: 'gid-ds2', gamePort: 7874, sources, cloud: fakeCloud() }).status()
    expect(idle.distributedSession).toBe(null)
    // 单开 perfectMirror：StickySession coherence 翻 true（110 不再缺 coherence），Redis 仍 110
    const pm = (await (await createGameCloud({
      gameId: 'gid-ds3', gamePort: 7875, sources, cloud: fakeCloud(),
      distributedSession: { perfectMirror: true }, dsNow: () => 535000,
    })).status()).distributedSession
    expect(pm!.vectors.StickySession).toBe('111')
    expect(pm!.vectors.JwtStateless).toBe('101')
    expect(pm!.vectors.RedisSessionStore).toBe('110')
    // 单开 skipRevocationCheck：JWT 翻 true 不硬改其余
    const sr = (await (await createGameCloud({
      gameId: 'gid-ds4', gamePort: 7876, sources, cloud: fakeCloud(),
      distributedSession: { skipRevocationCheck: true }, dsNow: () => 535000,
    })).status()).distributedSession
    expect(sr!.vectors.JwtStateless).toBe('111')
    expect(sr!.vectors.StickySession).toBe('011')
    // unlimitedTtl 不创撤销可见性
    const lt = (await (await createGameCloud({
      gameId: 'gid-ds5', gamePort: 7877, sources, cloud: fakeCloud(),
      distributedSession: { unlimitedTtl: true }, dsNow: () => 535000,
    })).status()).distributedSession
    expect(lt!.vectors.JwtStateless).toBe('101')
    // rigged 三开齐：Sticky≡JWT=111，Redis 仍 110，区分度塌缩（诚实）
    const rig = (await (await createGameCloud({
      gameId: 'gid-ds6', gamePort: 7878, sources, cloud: fakeCloud(),
      distributedSession: { rigged: true }, dsNow: () => 535000,
    })).status()).distributedSession
    expect(rig!.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig!.verdict.noUniversalWinner).toBe(false)
    expect(rig!.vectors.StickySession).toBe('111')
    expect(rig!.vectors.JwtStateless).toBe('111')
    expect(rig!.vectors.RedisSessionStore).toBe('110')
    expect(rig!.causalLocks.causalLocksAllHold).toBe(true)
    // 可注入现成 study（鸭子类型：带 rows/vectors/verdict/crosscheck 四块）
    const { distributedSessionStudy } = await import('./../../scripts/caesura-distributed-session.mjs')
    const injected = (await (await createGameCloud({
      gameId: 'gid-ds7', gamePort: 7879, sources, cloud: fakeCloud(),
      distributedSession: distributedSessionStudy({ seed: 99, now: () => 555 }),
    })).status()).distributedSession
    expect(injected.builtAt).toBe(555)
    expect(injected.config.seed).toBe(99)
  })
})
