import { describe, expect, it, vi, afterEach } from 'vitest'
import { createBus, defaultBus } from '../../scripts/spring-bus-event.mjs'

/**
 * Spring Cloud Bus 事件总线单元测试。
 *
 * headless 可证：纯进程内事件发布/订阅，不启真总线。
 */

afterEach(() => {
  defaultBus.close()
  vi.restoreAllMocks()
})

describe('spring-bus-event：Spring Cloud Bus 事件总线', () => {
  it('createBus：创建总线实例', () => {
    const bus = createBus()
    expect(bus).toBeDefined()
    expect(typeof bus.subscribe).toBe('function')
    expect(typeof bus.publish).toBe('function')
    expect(typeof bus.publishAsync).toBe('function')
    expect(typeof bus.listenerCount).toBe('function')
    expect(typeof bus.eventNames).toBe('function')
    expect(typeof bus.removeAllListeners).toBe('function')
    expect(typeof bus.close).toBe('function')
  })

  it('subscribe/publish：订阅并收到事件', () => {
    const bus = createBus()
    const handler = vi.fn()

    bus.subscribe('config.changed', handler)
    const result = bus.publish('config.changed', 'caesura-gate', { port: 8081 })

    expect(result).toBe(true) // 有监听器
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('caesura-gate', { port: 8081 })
  })

  it('publish：无监听器时返回 false', () => {
    const bus = createBus()
    const result = bus.publish('config.changed', 'caesura-gate')
    expect(result).toBe(false)
  })

  it('subscribe：取消订阅后不再收到事件', () => {
    const bus = createBus()
    const handler = vi.fn()

    const unsubscribe = bus.subscribe('config.changed', handler)
    bus.publish('config.changed', 'caesura-gate')
    expect(handler).toHaveBeenCalledTimes(1)

    unsubscribe()
    bus.publish('config.changed', 'caesura-gate')
    expect(handler).toHaveBeenCalledTimes(1) // 未增加
  })

  it('listenerCount：返回监听器数量', () => {
    const bus = createBus()
    expect(bus.listenerCount('config.changed')).toBe(0)

    bus.subscribe('config.changed', () => {})
    bus.subscribe('config.changed', () => {})
    expect(bus.listenerCount('config.changed')).toBe(2)

    bus.subscribe('service.registered', () => {})
    expect(bus.listenerCount('service.registered')).toBe(1)
    expect(bus.listenerCount('config.changed')).toBe(2)
  })

  it('eventNames：返回所有已注册事件名', () => {
    const bus = createBus()
    expect(bus.eventNames()).toEqual([])

    bus.subscribe('config.changed', () => {})
    bus.subscribe('service.registered', () => {})
    expect(bus.eventNames().sort()).toEqual(['config.changed', 'service.registered'])
  })

  it('removeAllListeners：移除指定事件的所有监听器', () => {
    const bus = createBus()
    const h1 = vi.fn()
    const h2 = vi.fn()

    bus.subscribe('config.changed', h1)
    bus.subscribe('config.changed', h2)
    bus.subscribe('service.registered', () => {})

    bus.removeAllListeners('config.changed')
    expect(bus.listenerCount('config.changed')).toBe(0)
    expect(bus.listenerCount('service.registered')).toBe(1)
  })

  it('close：移除所有监听器', () => {
    const bus = createBus()
    bus.subscribe('config.changed', () => {})
    bus.subscribe('service.registered', () => {})

    bus.close()
    expect(bus.listenerCount('config.changed')).toBe(0)
    expect(bus.listenerCount('service.registered')).toBe(0)
    expect(bus.eventNames()).toEqual([])
  })

  it('publishAsync：异步发布，回调在后续 tick 被调用', async () => {
    const bus = createBus()
    const handler = vi.fn()

    bus.subscribe('config.changed', handler)
    bus.publishAsync('config.changed', 'caesura-gate')

    // 同步时不应被调用
    expect(handler).not.toHaveBeenCalled()

    // 等待下一个 tick
    await new Promise((resolve) => setImmediate(resolve))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('caesura-gate')
  })

  it('defaultBus：默认总线实例可用', () => {
    expect(defaultBus).toBeDefined()
    expect(typeof defaultBus.subscribe).toBe('function')
    expect(typeof defaultBus.publish).toBe('function')
  })

  it('多监听器：同一事件的多个监听器都会被调用', () => {
    const bus = createBus()
    const h1 = vi.fn()
    const h2 = vi.fn()

    bus.subscribe('config.changed', h1)
    bus.subscribe('config.changed', h2)
    bus.publish('config.changed', 'caesura-gate', { port: 8081 })

    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
    expect(h1).toHaveBeenCalledWith('caesura-gate', { port: 8081 })
    expect(h2).toHaveBeenCalledWith('caesura-gate', { port: 8081 })
  })
})
