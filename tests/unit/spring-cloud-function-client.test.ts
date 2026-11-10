import { describe, expect, it } from 'vitest'
import { createFunctionRouter } from '../../scripts/spring-cloud-function-client.mjs'

/**
 * Spring Cloud Function 函数路由客户端单元测试（headless 可证）。
 */
describe('spring-cloud-function-client', () => {
  it('register/route 调起函数', async () => {
    const r = createFunctionRouter()
    r.register('double', (p) => p * 2)
    expect(await r.route('double', 21)).toBe(42)
  })

  it('list 返回已注册名', () => {
    const r = createFunctionRouter()
    r.register('a', () => 1)
    r.register('b', () => 2)
    expect(r.list().sort()).toEqual(['a', 'b'])
  })

  it('未注册函数抛错', async () => {
    const r = createFunctionRouter()
    await expect(r.route('missing', 1)).rejects.toThrow(/未注册/)
  })

  it('onError 在路由失败时收到错误', async () => {
    const errs: any[] = []
    const r = createFunctionRouter({ onError: (e) => errs.push(e) })
    await expect(r.route('x', 1)).rejects.toThrow()
    expect(errs.length).toBe(1)
  })

  it('unregister 移除函数', async () => {
    const r = createFunctionRouter()
    r.register('a', () => 1)
    expect(r.unregister('a')).toBe(true)
    await expect(r.route('a', 1)).rejects.toThrow()
  })

  it('register 参数非法抛错', () => {
    const r = createFunctionRouter()
    expect(() => r.register('', () => 1)).toThrow()
    expect(() => r.register('a', 5 as any)).toThrow()
  })
})
