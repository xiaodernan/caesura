import { describe, expect, it, vi } from 'vitest'
import { createFilterHandlers } from '../../scripts/spring-gateway-filter-handlers.mjs'

describe('spring-gateway-filter-handlers', () => {
  it('暴露 CircuitBreaker/Retry/RateLimit 三只 handler，stats 初值为 0', () => {
    const f = createFilterHandlers()
    expect(Object.keys(f.handlers).sort()).toEqual(['CircuitBreaker', 'RateLimit', 'Retry'])
    expect(f.stats()).toEqual({ circuitBreaker: 0, retries: 0, rateLimited: 0, passed: 0, buckets: [] })
  })

  it('Retry：下游先失败 2 次第 3 次成功 ⇒ 返回成功、真重跑 3 趟、retries 记 2', async () => {
    const f = createFilterHandlers({ sleep: async () => {} })
    let runs = 0
    const next = async () => { runs += 1; if (runs < 3) throw new Error(`boom${runs}`); return 'ok' }
    const res = await f.handlers.Retry({ attempts: 3, backoffMs: 1 }, {}, next)
    expect(res).toBe('ok')
    expect(runs).toBe(3)
    expect(f.stats().retries).toBe(2)
    expect(f.stats().passed).toBe(1)
  })

  it('Retry：始终失败 ⇒ 到顶后抛最后一错，不无限重试', async () => {
    const f = createFilterHandlers({ sleep: async () => {} })
    let runs = 0
    const next = async () => { runs += 1; throw new Error('always') }
    await expect(f.handlers.Retry({ attempts: 2 }, {}, next)).rejects.toThrow('always')
    expect(runs).toBe(2)
    expect(f.stats().retries).toBe(1)
  })

  it('Retry：注入的 backoffMs 用注入 sleep 等待（不真睡）', async () => {
    const sleeps: number[] = []
    const f = createFilterHandlers({ sleep: async (ms) => { sleeps.push(ms) } })
    let runs = 0
    const next = async () => { runs += 1; if (runs < 2) throw new Error('once'); return 'ok' }
    await f.handlers.Retry({ attempts: 3, backoffMs: 7 }, {}, next)
    expect(sleeps).toEqual([7])
  })

  it('RateLimit：容量 2，第 3 趟抛 rate_limited，key 隔离', async () => {
    let t = 1000
    const f = createFilterHandlers({ now: () => t })
    const next = async () => 'yes'
    expect(await f.handlers.RateLimit({ capacity: 2 }, { serviceName: 'a' }, next)).toBe('yes')
    expect(await f.handlers.RateLimit({ capacity: 2 }, { serviceName: 'a' }, next)).toBe('yes')
    await expect(f.handlers.RateLimit({ capacity: 2 }, { serviceName: 'a' }, next)).rejects.toThrow('rate_limited')
    expect(await f.handlers.RateLimit({ capacity: 2 }, { serviceName: 'b' }, next)).toBe('yes') // b 桶独立
    expect(f.stats().rateLimited).toBe(1)
  })

  it('RateLimit：时间推进后令牌按 refillPerSec 回填', async () => {
    let t = 1000
    const f = createFilterHandlers({ now: () => t })
    const next = async () => 'yes'
    await f.handlers.RateLimit({ capacity: 1, refillPerSec: 1 }, { serviceName: 'a' }, next)
    await expect(f.handlers.RateLimit({ capacity: 1, refillPerSec: 1 }, { serviceName: 'a' }, next)).rejects.toThrow('rate_limited')
    t += 1500 // 过 1.5s，回填 1 枚（封顶 1）
    expect(await f.handlers.RateLimit({ capacity: 1, refillPerSec: 1 }, { serviceName: 'a' }, next)).toBe('yes')
  })

  it('CircuitBreaker：包住下游，失败达阈值后 OPEN 拒绝且不执行下游', async () => {
    const f = createFilterHandlers({ breakerOpts: { failureThreshold: 1, cooldownMs: 5000 } })
    let runs = 0
    const failing = async () => { runs += 1; throw new Error('boom') }
    await expect(f.handlers.CircuitBreaker({ name: 'svc' }, {}, failing)).rejects.toThrow('boom')
    await expect(f.handlers.CircuitBreaker({ name: 'svc' }, {}, failing)).rejects.toThrow('circuit_open')
    expect(runs).toBe(1) // 第二次被熔断挡下，没真执行
    expect(f.stats().circuitBreaker).toBe(2)
  })

  it('breakerFor 工厂注入时复用外部熔断器；reset 清空本件计数与桶（外部熔断器生命周期归调用方）', async () => {
    const external = { run: vi.fn(async (fn: any) => ({ ok: true, result: await fn() })), reset: vi.fn() }
    const f = createFilterHandlers({ breakerFor: () => external })
    expect(await f.handlers.CircuitBreaker({ name: 'x' }, {}, async () => 9)).toBe(9)
    expect(external.run).toHaveBeenCalledTimes(1)
    f.reset()
    expect(f.stats()).toEqual({ circuitBreaker: 0, retries: 0, rateLimited: 0, passed: 0, buckets: [] })
    expect(external.reset).not.toHaveBeenCalled() // 注入的熔断器不归本件 reset
  })
})
