import { describe, expect, it, vi } from 'vitest'
import { createFilterHandlers } from '../../scripts/spring-gateway-filter-handlers.mjs'

describe('spring-gateway-filter-handlers', () => {
  it('暴露五只 handler（KI-486 三只 + KI-492 Bulkhead/TimeLimiter），stats 初值为 0', () => {
    const f = createFilterHandlers()
    expect(Object.keys(f.handlers).sort()).toEqual(['Bulkhead', 'CircuitBreaker', 'RateLimit', 'Retry', 'TimeLimiter'])
    expect(f.stats()).toEqual({
      circuitBreaker: 0, retries: 0, rateLimited: 0, passed: 0, buckets: [], bulkheadActive: {},
      bulkheadRejected: 0, bulkheadWaitTimedOut: 0, bulkheadHeld: 0, timedOut: 0,
    })
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
    expect(f.stats()).toEqual({
      circuitBreaker: 0, retries: 0, rateLimited: 0, passed: 0, buckets: [], bulkheadActive: {},
      bulkheadRejected: 0, bulkheadWaitTimedOut: 0, bulkheadHeld: 0, timedOut: 0,
    })
    expect(external.reset).not.toHaveBeenCalled() // 注入的熔断器不归本件 reset
  })

  // —— KI-492：Bulkhead 并发舱壁 ——
  it('Bulkhead①：maxConcurrent=1 时第二个并发立即抛 bulkhead_full（控的是 in-flight 并发，非频率）', async () => {
    const f = createFilterHandlers()
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((r) => { releaseFirst = r })
    let runs = 0
    const heldNext = async () => { runs += 1; await firstGate; return 'first' }
    // 第一趟占住舱壁不放；第二趟并发进来应被立即拒。
    const p1 = f.handlers.Bulkhead({ key: 'k', maxConcurrent: 1 }, { serviceName: 'svc' }, heldNext)
    await Promise.resolve() // 让 p1 进入 next 并占票
    await expect(f.handlers.Bulkhead({ key: 'k', maxConcurrent: 1 }, { serviceName: 'svc' }, async () => 'second'))
      .rejects.toMatchObject({ message: 'bulkhead_full', key: 'k' })
    expect(runs).toBe(1) // 第二趟根本没执行下游
    expect(f.stats()).toMatchObject({ bulkheadRejected: 1, bulkheadHeld: 1, bulkheadActive: { k: 1 } })
    releaseFirst()
    expect(await p1).toBe('first')
    expect(f.stats().bulkheadActive).toEqual({ k: 0 }) // finally 归还
  })

  it('Bulkhead②：next 抛错也 finally 归还舱壁，下一趟可再进（不泄漏持位）', async () => {
    const f = createFilterHandlers()
    const fail = async () => { throw new Error('boom') }
    await expect(f.handlers.Bulkhead({ key: 'k', maxConcurrent: 1 }, {}, fail)).rejects.toThrow('boom')
    expect(f.stats().bulkheadActive).toEqual({ k: 0 })
    expect(await f.handlers.Bulkhead({ key: 'k', maxConcurrent: 1 }, {}, async () => 'ok')).toBe('ok') // 舱壁没被泄漏锁死
    expect(f.stats().bulkheadHeld).toBe(2)
  })

  it('Bulkhead③：maxWaitMs>0 时 FIFO 排队，持位归还后队首抢到票成功', async () => {
    let t = 0
    const sleeps: number[] = []
    // sleep 每次推进假时钟 ⇒ poll 循环能感知 elapsed；同时用 queueMicrotask 让第一个持票者有机会释放。
    const f = createFilterHandlers({ now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; await Promise.resolve() } })
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((r) => { releaseFirst = r })
    const order: string[] = []
    const p1 = f.handlers.Bulkhead({ key: 'k', maxConcurrent: 1, maxWaitMs: 100 }, {}, async () => { order.push('1'); await firstGate; return 1 })
    await Promise.resolve()
    const p2 = f.handlers.Bulkhead({ key: 'k', maxConcurrent: 1, maxWaitMs: 100 }, {}, async () => { order.push('2'); return 2 })
    releaseFirst() // 归还第一张票
    expect(await p1).toBe(1)
    expect(await p2).toBe(2) // 队首等到空位后成功进
    expect(order).toEqual(['1', '2'])
    expect(f.stats()).toMatchObject({ bulkheadHeld: 2, bulkheadRejected: 0, bulkheadWaitTimedOut: 0 })
    expect(sleeps.length).toBeGreaterThan(0) // 确实走了 poll 等待
  })

  it('Bulkhead④：排队超过 maxWaitMs ⇒ bulkhead_full 且标 waitTimedOut（注入时钟无需真等）', async () => {
    let t = 0
    const f = createFilterHandlers({ now: () => t, sleep: async (ms) => { t += ms } }) // sleep 只推时钟，不真睡
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((r) => { releaseFirst = r })
    const p1 = f.handlers.Bulkhead({ key: 'k', maxConcurrent: 1, maxWaitMs: 20 }, {}, async () => { await firstGate; return 1 })
    await Promise.resolve()
    // 持位不归还，队首 poll 到 deadline ⇒ 超时拒
    await expect(f.handlers.Bulkhead({ key: 'k', maxConcurrent: 1, maxWaitMs: 20 }, {}, async () => 2))
      .rejects.toMatchObject({ message: 'bulkhead_full', waitTimedOut: true })
    expect(f.stats()).toMatchObject({ bulkheadRejected: 1, bulkheadWaitTimedOut: 1 })
    releaseFirst()
    await p1
  })

  // —— KI-492：TimeLimiter 调用超时 ——
  it('TimeLimiter⑤：下游在 timeoutMs 内完成 ⇒ 原样返回，不误判超时', async () => {
    const f = createFilterHandlers()
    const res = await f.handlers.TimeLimiter({ timeoutMs: 1000 }, {}, async () => 'fast')
    expect(res).toBe('fast')
    expect(f.stats().timedOut).toBe(0)
  })

  it('TimeLimiter⑥：下游超过 timeoutMs ⇒ 抛 time_limiter_timeout、标 timedOut，且滞后拒绝不产生 unhandled', async () => {
    const f = createFilterHandlers()
    let rejectLate: (e: Error) => void = () => {}
    const never = new Promise<string>((_, rej) => { rejectLate = rej })
    await expect(f.handlers.TimeLimiter({ timeoutMs: 5 }, {}, async () => never))
      .rejects.toMatchObject({ message: 'time_limiter_timeout', timeoutMs: 5 })
    expect(f.stats().timedOut).toBe(1)
    // 超时判词已返回后，底层 in-flight 才 reject ⇒ 本件已挂 catch，不会 unhandledRejection。
    rejectLate(new Error('late boom'))
    await new Promise((r) => setTimeout(r, 10))
  })
})
