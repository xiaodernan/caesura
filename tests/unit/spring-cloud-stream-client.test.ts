import { describe, expect, it } from 'vitest'
import { createBinder, createStreamClient, DEFAULT_BINDER } from '../../scripts/spring-cloud-stream-client.mjs'

/**
 * Spring Cloud Stream 消息驱动客户端单元测试（headless 可证，无网络）。
 */
describe('spring-cloud-stream-client', () => {
  it('默认 binder 是 memory', () => {
    expect(DEFAULT_BINDER).toBe('memory')
    expect(createBinder().transport).toBe('memory')
  })

  it('publish 把消息投递给订阅者', async () => {
    const b = createBinder()
    const got: any[] = []
    b.subscribe('ch', (e) => { got.push(e.message) })
    const r = await b.publish('ch', { a: 1 })
    expect(r.delivered).toBe(1)
    expect(got).toEqual([{ a: 1 }])
  })

  it('多订阅者都收到', async () => {
    const b = createBinder()
    let n = 0
    b.subscribe('ch', () => { n += 1 })
    b.subscribe('ch', () => { n += 1 })
    await b.publish('ch', 1)
    expect(n).toBe(2)
  })

  it('unsubscribe 后不再收到', async () => {
    const b = createBinder()
    let n = 0
    const off = b.subscribe('ch', () => { n += 1 })
    off()
    await b.publish('ch', 1)
    expect(n).toBe(0)
  })

  it('handler 抛错不阻断其他订阅者，且交给 onError', async () => {
    const errs: any[] = []
    const b = createBinder({ onError: (e) => errs.push(e) })
    let ok = 0
    b.subscribe('ch', () => { throw new Error('boom') })
    b.subscribe('ch', () => { ok += 1 })
    const r = await b.publish('ch', 1)
    expect(r.errors).toBe(1)
    expect(ok).toBe(1)
    expect(errs.length).toBe(1)
  })

  it('channel 非法抛错', async () => {
    const b = createBinder()
    await expect(b.publish('', 1)).rejects.toThrow()
    expect(() => b.subscribe('', () => {})).toThrow()
  })

  it('createStreamClient 收口 producer/consumer', async () => {
    const c = createStreamClient()
    const got: any[] = []
    c.bindConsumer('ev', (e) => { got.push(e.message) })
    const send = c.bindProducer('ev')
    await send({ x: 9 })
    expect(got).toEqual([{ x: 9 }])
  })
})
