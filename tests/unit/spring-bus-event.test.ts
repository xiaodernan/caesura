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
    const evbus = createBus()
    expect(evbus).toBeDefined()
    expect(typeof evbus.subscribe).toBe('function')
    expect(typeof evbus.publish).toBe('function')
    expect(typeof evbus.publishAsync).toBe('function')
    expect(typeof evbus.listenerCount).toBe('function')
    expect(typeof evbus.eventNames).toBe('function')
    expect(typeof evbus.removeAllListeners).toBe('function')
    expect(typeof evbus.close).toBe('function')
  })

  it('subscribe/publish：订阅并收到事件', () => {
    const evbus = createBus()
    const handler = vi.fn()

    evbus.subscribe('config.changed', handler)
    const result = evbus.publish('config.changed', 'caesura-gate', { port: 8081 })

    expect(result).toBe(true) // 有监听器
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('caesura-gate', { port: 8081 })
  })

  it('publish：无监听器时返回 false', () => {
    const evbus = createBus()
    const result = evbus.publish('config.changed', 'caesura-gate')
    expect(result).toBe(false)
  })

  it('subscribe：取消订阅后不再收到事件', () => {
    const evbus = createBus()
    const handler = vi.fn()

    const unsubscribe = evbus.subscribe('config.changed', handler)
    evbus.publish('config.changed', 'caesura-gate')
    expect(handler).toHaveBeenCalledTimes(1)

    unsubscribe()
    evbus.publish('config.changed', 'caesura-gate')
    expect(handler).toHaveBeenCalledTimes(1) // 未增加
  })

  it('listenerCount：返回监听器数量', () => {
    const evbus = createBus()
    expect(evbus.listenerCount('config.changed')).toBe(0)

    evbus.subscribe('config.changed', () => {})
    evbus.subscribe('config.changed', () => {})
    expect(evbus.listenerCount('config.changed')).toBe(2)

    evbus.subscribe('service.registered', () => {})
    expect(evbus.listenerCount('service.registered')).toBe(1)
    expect(evbus.listenerCount('config.changed')).toBe(2)
  })

  it('eventNames：返回所有已注册事件名', () => {
    const evbus = createBus()
    expect(evbus.eventNames()).toEqual([])

    evbus.subscribe('config.changed', () => {})
    evbus.subscribe('service.registered', () => {})
    expect(evbus.eventNames().sort()).toEqual(['config.changed', 'service.registered'])
  })

  it('removeAllListeners：移除指定事件的所有监听器', () => {
    const evbus = createBus()
    const h1 = vi.fn()
    const h2 = vi.fn()

    evbus.subscribe('config.changed', h1)
    evbus.subscribe('config.changed', h2)
    evbus.subscribe('service.registered', () => {})

    evbus.removeAllListeners('config.changed')
    expect(evbus.listenerCount('config.changed')).toBe(0)
    expect(evbus.listenerCount('service.registered')).toBe(1)
  })

  it('close：移除所有监听器', () => {
    const evbus = createBus()
    evbus.subscribe('config.changed', () => {})
    evbus.subscribe('service.registered', () => {})

    evbus.close()
    expect(evbus.listenerCount('config.changed')).toBe(0)
    expect(evbus.listenerCount('service.registered')).toBe(0)
    expect(evbus.eventNames()).toEqual([])
  })

  it('publishAsync：异步发布，回调在后续 tick 被调用', async () => {
    const evbus = createBus()
    const handler = vi.fn()

    evbus.subscribe('config.changed', handler)
    evbus.publishAsync('config.changed', 'caesura-gate')

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
    const evbus = createBus()
    const h1 = vi.fn()
    const h2 = vi.fn()

    evbus.subscribe('config.changed', h1)
    evbus.subscribe('config.changed', h2)
    evbus.publish('config.changed', 'caesura-gate', { port: 8081 })

    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
    expect(h1).toHaveBeenCalledWith('caesura-gate', { port: 8081 })
    expect(h2).toHaveBeenCalledWith('caesura-gate', { port: 8081 })
  })
})
