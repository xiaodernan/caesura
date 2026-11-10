import { describe, expect, it } from 'vitest'
import { createGameEventBridge, DIRECTIONS } from '../../scripts/caesura-game-event-bridge.mjs'

/** 复刻 src/core/EventBus 的 duck-typed 形状（on 返退订、emit 同步分发），但不 import 浏览器 src/。 */
function fakeGameBus() {
  const handlers = new Map<string, Set<Function>>()
  return {
    emitted: [] as Array<[string, any]>,
    on(k: string, fn: Function) {
      if (!handlers.has(k)) handlers.set(k, new Set())
      handlers.get(k)!.add(fn)
      return () => handlers.get(k)?.delete(fn)
    },
    emit(k: string, p: any) {
      this.emitted.push([k, p])
      for (const fn of [...(handlers.get(k) ?? [])]) fn(p)
    },
    listenerCount: (k: string) => handlers.get(k)?.size ?? 0,
  }
}

/** 复刻 caesura-event-bus 的形状。 */
function fakeCloudBus(failOn?: string) {
  const handlers = new Map<string, Set<Function>>()
  return {
    published: [] as Array<[string, any]>,
    onGameEvent(t: string, fn: Function) {
      if (!handlers.has(t)) handlers.set(t, new Set())
      handlers.get(t)!.add(fn)
      return () => handlers.get(t)?.delete(fn)
    },
    async publishGameEvent(t: string, p?: any) {
      if (t === failOn) throw new Error('publish failed')
      this.published.push([t, p])
      for (const fn of [...(handlers.get(t) ?? [])]) fn(p)
      return { channel: 'test', delivered: handlers.get(t)?.size ?? 0, errors: 0 }
    },
    /** 从云侧主动发一条，模拟远程事件到达。 */
    deliver(t: string, p: any) { for (const fn of [...(handlers.get(t) ?? [])]) fn(p) },
    listenerCount: (t: string) => handlers.get(t)?.size ?? 0,
  }
}

const routes = [
  { from: 'game' as const, key: 'boss.phase', type: 'game.boss.phase' },
  { from: 'game' as const, key: 'combat.hit', type: 'game.combat.hit' },
  { from: 'cloud' as const, type: 'remote.notice', key: 'ui.notify' },
]

describe('caesura-game-event-bridge', () => {
  it('导出方向名册 DIRECTIONS，未 install 时 stats 全 0', () => {
    expect(DIRECTIONS).toEqual(['game', 'cloud'])
    const b = createGameEventBridge({ gameBus: fakeGameBus(), cloudBus: fakeCloudBus(), routes })
    expect(b.isInstalled()).toBe(false)
    expect(b.stats()).toEqual({ forward: 0, reverse: 0, dropped: 0, handlers: 0, gameRoutes: 2, cloudRoutes: 1 })
  })

  it('游戏 → 云：游戏真事件 emit 后原样 publishGameEvent 到映射的云 type', async () => {
    const gameBus = fakeGameBus()
    const cloudBus = fakeCloudBus()
    const b = createGameEventBridge({ gameBus, cloudBus, routes })
    expect(b.install()).toEqual({ installed: true, handlers: 3 })
    gameBus.emit('boss.phase', { id: 'm', phase: 2, phases: 3, nameKey: 'k' })
    await Promise.resolve() // publishGameEvent 是异步 fire-and-forget
    expect(cloudBus.published).toEqual([['game.boss.phase', { id: 'm', phase: 2, phases: 3, nameKey: 'k' }]])
    expect(b.stats().forward).toBe(1)
  })

  it('白名单：未登记的游戏事件键不过桥', async () => {
    const gameBus = fakeGameBus()
    const cloudBus = fakeCloudBus()
    createGameEventBridge({ gameBus, cloudBus, routes }).install()
    gameBus.emit('ui.notify', { text: 'x' }) // 游戏→云没登记 ui.notify
    await Promise.resolve()
    expect(cloudBus.published).toEqual([])
  })

  it('云 → 游戏：云事件到达后原样 emit 到映射的游戏 key', () => {
    const gameBus = fakeGameBus()
    const cloudBus = fakeCloudBus()
    const b = createGameEventBridge({ gameBus, cloudBus, routes })
    b.install()
    cloudBus.deliver('remote.notice', { text: 'hello', kind: 'reward' })
    expect(gameBus.emitted).toEqual([['ui.notify', { text: 'hello', kind: 'reward' }]])
    expect(b.stats().reverse).toBe(1)
  })

  it('uninstall 摘掉全部订阅且幂等，计数保留', async () => {
    const gameBus = fakeGameBus()
    const cloudBus = fakeCloudBus()
    const b = createGameEventBridge({ gameBus, cloudBus, routes })
    b.install()
    expect(gameBus.listenerCount('boss.phase')).toBe(1)
    expect(cloudBus.listenerCount('remote.notice')).toBe(1)
    expect(b.uninstall()).toEqual({ uninstalled: true, removed: 3 })
    expect(gameBus.listenerCount('boss.phase')).toBe(0)
    expect(cloudBus.listenerCount('remote.notice')).toBe(0)
    gameBus.emit('boss.phase', {})
    await Promise.resolve()
    expect(cloudBus.published).toEqual([]) // 退桥后不再转发
    expect(b.uninstall()).toEqual({ uninstalled: true, removed: 0 }) // 幂等
    expect(b.stats().forward).toBe(0)
  })

  it('缺 bus 时 install 诚实报未装，不抛', () => {
    const b = createGameEventBridge({ routes })
    expect(b.install()).toMatchObject({ installed: false, reason: 'missing_bus' })
    expect(b.isInstalled()).toBe(false)
  })

  it('publishGameEvent 失败时计 dropped 且不影响其它转发', async () => {
    const gameBus = fakeGameBus()
    const cloudBus = fakeCloudBus('game.combat.hit')
    const seen: any[] = []
    const b = createGameEventBridge({ gameBus, cloudBus, routes, onEvent: (e) => seen.push(e) })
    b.install()
    gameBus.emit('combat.hit', { damage: 1 })
    gameBus.emit('boss.phase', { phase: 1 })
    await new Promise((r) => setTimeout(r, 0))
    expect(b.stats().forward).toBe(2)
    expect(b.stats().dropped).toBe(1)
    expect(cloudBus.published).toEqual([['game.boss.phase', { phase: 1 }]])
    expect(seen.some((e: any) => e.dropped)).toBe(true)
  })

  it('forward 手动转发：命中路由 publish，未命中记 dropped 且不发', async () => {
    const cloudBus = fakeCloudBus()
    const b = createGameEventBridge({ gameBus: fakeGameBus(), cloudBus, routes })
    const r1 = await b.forward('boss.phase', { phase: 3 })
    expect(r1.ok).toBe(true)
    expect(cloudBus.published).toEqual([['game.boss.phase', { phase: 3 }]])
    const r2 = await b.forward('unknown.event', {})
    expect(r2).toEqual({ ok: false, reason: 'not_routed' })
    expect(b.stats().dropped).toBe(1)
    expect(cloudBus.published.length).toBe(1)
  })
})
