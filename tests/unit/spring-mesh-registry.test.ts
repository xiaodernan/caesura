import { describe, expect, it } from 'vitest'
import { createMeshRegistry } from '../../scripts/spring-mesh-registry.mjs'

/**
 * Spring Cloud 统一服务注册表单元测试（headless 可证）。
 */
describe('spring-mesh-registry', () => {
  it('合并多来源、按 id 去重并叠加 sources', async () => {
    const reg = createMeshRegistry()
    reg.registerSource('eureka', async () => [{ id: 'a-1', name: 'svc', address: '1.1.1.1', port: 1, healthy: true }])
    reg.registerSource('consul', async () => [{ id: 'a-1', name: 'svc', address: '1.1.1.1', port: 1, healthy: true }])
    const m = await reg.aggregate()
    const inst = m.get('svc')!
    expect(inst).toHaveLength(1)
    expect(inst[0].sources.sort()).toEqual(['consul', 'eureka'])
  })

  it('不同来源的健康做与归并', async () => {
    const reg = createMeshRegistry()
    reg.registerSource('a', async () => [{ id: 'x', name: 'svc', healthy: true }])
    reg.registerSource('b', async () => [{ id: 'x', name: 'svc', healthy: false }])
    const m = await reg.aggregate()
    expect(m.get('svc')![0].healthy).toBe(false)
  })

  it('discover 取单服务', async () => {
    const reg = createMeshRegistry()
    reg.registerSource('eureka', async () => [{ id: 'a-1', name: 'svc', address: '1.1.1.1' }])
    const found = await reg.discover('svc')
    expect(found).toHaveLength(1)
  })

  it('来源报错被吞掉、不阻断其他来源', async () => {
    const reg = createMeshRegistry()
    reg.registerSource('bad', async () => { throw new Error('boom') })
    reg.registerSource('good', async () => [{ id: 'a-1', name: 'svc' }])
    const m = await reg.aggregate()
    expect(m.get('svc')).toHaveLength(1)
  })

  it('registerSource 参数非法抛错', () => {
    const reg = createMeshRegistry()
    expect(() => reg.registerSource('', () => [])).toThrow()
    expect(() => reg.registerSource('x', 5 as any)).toThrow()
  })
})
