import { describe, expect, it } from 'vitest'
import { createGameCloudBridge } from '../../scripts/caesura-game-bootstrap.mjs'

function fakeCloud() {
  const published: Array<[string, ...unknown[]]> = []
  return {
    published,
    async request() { return {} }
    ,
    async publish(event: string, ...args: unknown[]) { published.push([event, ...args]); return { ok: true } },
    subscribe() { return () => {} },
    async status() { return { ok: true } },
  }
}

function emitterGame() {
  const handlers: Record<string, Array<() => void>> = {}
  return {
    handlers,
    on(event: string, fn: () => void) { (handlers[event] ??= []).push(fn) },
    emit(event: string) { (handlers[event] ?? []).forEach((f) => f()) },
  }
}

describe('caesura-game-bootstrap', () => {
  it('bridge 收口了 gc + onBoot/onShutdown/install', () => {
    const bridge = createGameCloudBridge({ gameId: 'g1', gamePort: 7700, cloud: fakeCloud() })
    expect(bridge.gc).toBeTruthy()
    expect(typeof bridge.onBoot).toBe('function')
    expect(typeof bridge.install).toBe('function')
  })

  it('install 到 event-emitter 游戏后，触发 boot 事件即拉起云（注册游戏）', async () => {
    const cloud = fakeCloud()
    const game = emitterGame()
    const bridge = createGameCloudBridge({ gameId: 'g1', gamePort: 7700, cloud })
    const res = bridge.install(game)
    expect(res.installed).toBe(true)
    await game.handlers['boot'][0]()
    expect(cloud.published.some(([e, p]) => e === 'caesura.lifecycle' && (p as any)?.type === 'game.started')).toBe(true)
  })

  it('触发 shutdown 事件即注销云', async () => {
    const cloud = fakeCloud()
    const game = emitterGame()
    const bridge = createGameCloudBridge({ gameId: 'g1', gamePort: 7700, cloud })
    bridge.install(game)
    await game.handlers['boot'][0]()
    await game.handlers['shutdown'][0]()
    expect(cloud.published.some(([e, p]) => e === 'caesura.lifecycle' && (p as any)?.type === 'game.stopped')).toBe(true)
  })

  it('install 到非游戏对象返回 installed:false 但 handlers 仍在', () => {
    const bridge = createGameCloudBridge({ gameId: 'g1', gamePort: 7700, cloud: fakeCloud() })
    const res = bridge.install(null)
    expect(res.installed).toBe(false)
    expect(res.handlers.onBoot).toBeTruthy()
  })

  it('手动 start()/stop() 直接可用', async () => {
    const cloud = fakeCloud()
    const bridge = createGameCloudBridge({ gameId: 'g1', gamePort: 7700, cloud })
    await bridge.start()
    expect(cloud.published.some(([e, p]) => e === 'caesura.lifecycle' && (p as any)?.type === 'game.started')).toBe(true)
    await bridge.stop()
    expect(cloud.published.some(([e, p]) => e === 'caesura.lifecycle' && (p as any)?.type === 'game.stopped')).toBe(true)
  })
})
