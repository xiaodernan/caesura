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
})
