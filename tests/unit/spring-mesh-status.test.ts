import { describe, expect, it } from 'vitest'
import { collectMeshStatus } from '../../scripts/spring-mesh-status.mjs'

/**
 * Spring Cloud 微服务族可观测性聚合器单元测试（headless 可证）。
 */
describe('spring-mesh-status', () => {
  it('聚合多个服务并给 summary', async () => {
    const svcs = [{ name: 'a' }, { name: 'b' }]
    const r = await collectMeshStatus({
      services: svcs,
      health: (s) => Promise.resolve({ status: s.name === 'a' ? 'UP' : 'DOWN' }),
      circuit: () => Promise.resolve({ state: 'CLOSED' }),
      configVersion: (s) => Promise.resolve(s.name === 'a' ? 'v2' : null),
    })
    expect(r.services).toHaveLength(2)
    expect(r.summary.total).toBe(2)
    expect(r.summary.healthy).toBe(1)
    expect(r.summary.degraded).toBe(1)
    expect(r.services[0].configVersion).toBe('v2')
  })

  it('熔断 OPEN 计入 open', async () => {
    const r = await collectMeshStatus({
      services: [{ name: 'g' }],
      health: () => Promise.resolve({ status: 'UP' }),
      circuit: () => Promise.resolve({ state: 'OPEN' }),
    })
    expect(r.summary.open).toBe(1)
    expect(r.summary.healthy).toBe(0)
  })

  it('health 失败被计入 errors 而不是抛', async () => {
    const r = await collectMeshStatus({
      services: [{ name: 'x' }],
      health: () => Promise.reject(new Error('conn refused')),
      circuit: () => Promise.resolve({ state: 'CLOSED' }),
    })
    expect(r.services[0].errors.some((e: string) => e.includes('conn refused'))).toBe(true)
    expect(r.summary.errors).toBeGreaterThan(0)
  })

  it('空服务列表给出零 summary', async () => {
    const r = await collectMeshStatus({ services: [] })
    expect(r.summary).toEqual({ total: 0, healthy: 0, open: 0, degraded: 0, errors: 0 })
  })

  it('默认探测器全部 UP/CLOSED', async () => {
    const r = await collectMeshStatus({ services: [{ name: 'a' }] })
    expect(r.services[0].health).toEqual({ status: 'UP' })
    expect(r.services[0].circuit).toEqual({ state: 'CLOSED' })
  })
})
