import { describe, expect, it } from 'vitest'
import { createGameMeshAdapter } from '../../scripts/caesura-mesh-adapter.mjs'

/**
 * 游戏侧微服务适配层单元测试（headless 可证，注入假 CaesuraCloud）。
 */
describe('caesura-mesh-adapter', () => {
  function fakeCloud() {
    const events: any[] = []
    const discovery = { _reg: [] as any[], register(s: any) { this._reg.push(s); return s }, deregister(id: string) { this._reg = this._reg.filter((s) => s.id !== id) } }
    return {
      events,
      discovery,
      config: { get: (k: string) => (k === 'world' ? 'hushbelt' : undefined) },
      publish: (ch: string, p: any) => { events.push({ ch, p }); return Promise.resolve() },
      status: () => Promise.resolve({ services: ['caesura-config'] }),
    }
  }

  it('start 注册实例并广播 lifecycle 事件', async () => {
    const cloud = fakeCloud()
    const a = createGameMeshAdapter({ cloud, gameId: 'g1' })
    const r = await a.start()
    expect(r.registered).toBe(true)
    expect(cloud.discovery._reg[0].id).toBe('g1')
    expect(cloud.events.some((e) => e.ch === 'caesura.lifecycle' && e.p.type === 'game.started')).toBe(true)
  })

  it('stop 注销并广播 stopped', async () => {
    const cloud = fakeCloud()
    const a = createGameMeshAdapter({ cloud, gameId: 'g1' })
    await a.start()
    const r = await a.stop()
    expect(r.registered).toBe(false)
    expect(cloud.discovery._reg.find((s) => s.id === 'g1')).toBeUndefined()
    expect(cloud.events.some((e) => e.p.type === 'game.stopped')).toBe(true)
  })

  it('reportHealth 发健康事件', async () => {
    const cloud = fakeCloud()
    const a = createGameMeshAdapter({ cloud, health: () => ({ status: 'UP', players: 3 }) })
    const h = await a.reportHealth()
    expect(h.status).toBe('UP')
    expect(cloud.events.some((e) => e.ch === 'caesura.health' && e.p.players === 3)).toBe(true)
  })

  it('getConfig 透传配置', async () => {
    const cloud = fakeCloud()
    const a = createGameMeshAdapter({ cloud })
    expect(await a.getConfig('world')).toBe('hushbelt')
  })

  it('status 聚合云状态', async () => {
    const cloud = fakeCloud()
    const a = createGameMeshAdapter({ cloud })
    const s = await a.status()
    expect(s.id).toBe('caesura-game')
    expect(s.registered).toBe(false)
    expect(s.cloud.services).toContain('caesura-config')
  })
})
