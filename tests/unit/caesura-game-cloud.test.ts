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
})
