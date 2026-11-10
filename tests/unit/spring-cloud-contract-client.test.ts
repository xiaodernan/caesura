import { describe, expect, it } from 'vitest'
import { createContractRunner } from '../../scripts/spring-cloud-contract-client.mjs'

/**
 * Spring Cloud Contract 消费者驱动契约桩客户端单元测试（headless 可证）。
 */
describe('spring-cloud-contract-client', () => {
  it('serve 命中契约返回罐头响应', () => {
    const r = createContractRunner()
    r.addContract({ name: 'getHealth', request: { method: 'GET', path: '/health' }, response: { status: 200, body: { status: 'UP' } } })
    const out = r.serve({ method: 'GET', path: '/health' })
    expect(out.status).toBe(200)
    expect(out.body).toEqual({ status: 'UP' })
  })

  it('serve 未命中返回 404', () => {
    const r = createContractRunner()
    expect(r.serve({ method: 'GET', path: '/nope' }).status).toBe(404)
  })

  it('match 按 method + path 匹配', () => {
    const r = createContractRunner()
    const c = { name: 'c', request: { method: 'POST', path: '/x' }, response: { status: 201 } }
    r.addContract(c)
    expect(r.match(c, { method: 'POST', path: '/x' })).toBe(true)
    expect(r.match(c, { method: 'GET', path: '/x' })).toBe(false)
  })

  it('verify 逐条对账契约满足情况', () => {
    const r = createContractRunner()
    r.addContract({ name: 'a', request: { method: 'GET', path: '/a' }, response: { status: 200 } })
    r.addContract({ name: 'b', request: { method: 'GET', path: '/b' }, response: { status: 200 } })
    const report = r.verify(r.list(), [
      { request: { method: 'GET', path: '/a' }, response: { status: 200 } },
    ])
    expect(report.find((x) => x.name === 'a')?.satisfied).toBe(true)
    expect(report.find((x) => x.name === 'b')?.satisfied).toBe(false)
  })

  it('addContract 非法抛错', () => {
    const r = createContractRunner()
    expect(() => r.addContract({ name: 'x' } as any)).toThrow()
  })
})
