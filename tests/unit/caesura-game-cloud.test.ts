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
})
