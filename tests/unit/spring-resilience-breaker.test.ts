import { describe, expect, it } from 'vitest'
import { createCircuitBreaker } from '../../scripts/spring-resilience-breaker.mjs'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('spring-resilience-breaker', () => {
  it('CLOSED 直通成功结果', async () => {
    const b = createCircuitBreaker('svc', { failureThreshold: 3, cooldownMs: 20 })
    const res = await b.run(async () => 42)
    expect(res.ok).toBe(true)
    expect(res.result).toBe(42)
    expect(res.state).toBe('CLOSED')
  })

  it('CLOSED 记录失败并在达到阈值后打开', async () => {
    const b = createCircuitBreaker('svc', { failureThreshold: 2, cooldownMs: 20 })
    const r1 = await b.run(async () => { throw new Error('x') })
    expect(r1.ok).toBe(false)
    expect(b.state()).toBe('CLOSED')
    const r2 = await b.run(async () => { throw new Error('x') })
    expect(r2.ok).toBe(false)
    expect(b.state()).toBe('OPEN')
  })

  it('OPEN 期间直接拒绝且不执行 fn', async () => {
    const b = createCircuitBreaker('svc', { failureThreshold: 1, cooldownMs: 50 })
    await b.run(async () => { throw new Error('x') })
    expect(b.state()).toBe('OPEN')
    let ran = false
    const r = await b.run(async () => { ran = true; return 1 })
    expect(ran).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.state).toBe('OPEN')
    expect((r.error as Error).message).toBe('circuit_open')
  })

  it('冷却后转 HALF_OPEN，成功则回 CLOSED', async () => {
    const b = createCircuitBreaker('svc', { failureThreshold: 1, cooldownMs: 10 })
    await b.run(async () => { throw new Error('x') })
    expect(b.state()).toBe('OPEN')
    await delay(25)
    const r = await b.run(async () => 'ok')
    expect(r.ok).toBe(true)
    expect(r.state).toBe('CLOSED')
  })

  it('HALF_OPEN 失败立即回到 OPEN', async () => {
    const b = createCircuitBreaker('svc', { failureThreshold: 1, cooldownMs: 10 })
    await b.run(async () => { throw new Error('x') })
    await delay(25)
    const r = await b.run(async () => { throw new Error('y') })
    expect(r.ok).toBe(false)
    expect(b.state()).toBe('OPEN')
  })

  it('metrics 记录失败/成功/拒绝计数', async () => {
    const b = createCircuitBreaker('svc', { failureThreshold: 1, cooldownMs: 50 })
    await b.run(async () => 'a')
    await b.run(async () => { throw new Error('x') }) // -> OPEN
    await b.run(async () => 'b') // rejected
    const m = b.metrics()
    expect(m.successes).toBe(1)
    expect(m.failures).toBe(1)
    expect(m.rejects).toBe(1)
  })

  it('reset 回到 CLOSED 并清空计数', async () => {
    const b = createCircuitBreaker('svc', { failureThreshold: 1, cooldownMs: 50 })
    await b.run(async () => { throw new Error('x') })
    expect(b.state()).toBe('OPEN')
    b.reset()
    expect(b.state()).toBe('CLOSED')
    expect(b.metrics().failures).toBe(0)
  })
})
