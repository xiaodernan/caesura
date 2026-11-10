import { describe, expect, it, vi } from 'vitest'
import { createGameEventBus, DEFAULT_GAME_EVENT_CHANNEL } from '../../scripts/caesura-event-bus.mjs'

describe('caesura-event-bus', () => {
  it('publishGameEvent 被同类型订阅者收到，payload 正确', async () => {
    const bus = createGameEventBus()
    const h = vi.fn()
    bus.onGameEvent('game.damage', h)
    const res = await bus.publishGameEvent('game.damage', { amount: 10 })
    expect(res.delivered).toBe(1)
    expect(h).toHaveBeenCalledTimes(1)
    expect(h.mock.calls[0][0]).toEqual({ amount: 10 })
  })

  it('onGameEvent 按 type 过滤：只收自己类型', async () => {
    const bus = createGameEventBus()
    const dmg = vi.fn()
    const heal = vi.fn()
    bus.onGameEvent('game.damage', dmg)
    bus.onGameEvent('game.heal', heal)
    await bus.publishGameEvent('game.damage', { a: 1 })
    await bus.publishGameEvent('game.heal', { b: 2 })
    expect(dmg).toHaveBeenCalledTimes(1)
    expect(heal).toHaveBeenCalledTimes(1)
    expect(dmg.mock.calls[0][0]).toEqual({ a: 1 })
    expect(heal.mock.calls[0][0]).toEqual({ b: 2 })
  })

  it('同一类型多订阅者都收到', async () => {
    const bus = createGameEventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.onGameEvent('x', a)
    bus.onGameEvent('x', b)
    await bus.publishGameEvent('x', 42)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('默认频道名是 caesura.game.events', () => {
    const bus = createGameEventBus()
    expect(bus.channel).toBe(DEFAULT_GAME_EVENT_CHANNEL)
    expect(DEFAULT_GAME_EVENT_CHANNEL).toBe('caesura.game.events')
  })

  it('shutdown 幂等返回 { stopped: true }', () => {
    const bus = createGameEventBus()
    expect(bus.shutdown()).toEqual({ stopped: true })
    expect(bus.shutdown()).toEqual({ stopped: true })
  })
})
