import { describe, expect, it, vi, afterEach } from 'vitest'
import { getCircuitBreaker, getCircuitBreakers } from '../../scripts/spring-circuit-breaker.mjs'

/**
 * Spring Cloud 熔断器客户端单元测试。
 *
 * headless 可证：用 `vi.fetch` 模拟 HTTP，不启真 Gate 服务器。
 * 验证熔断器状态查询与解析的正确性。
 */

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

describe('spring-circuit-breaker：熔断器状态查询', () => {
  it('getCircuitBreaker：返回单个熔断器状态', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({
        name: 'fx_dust',
        state: 'CLOSED',
        failureRate: 0,
        failureThreshold: 0.5,
        slowCallRate: 0,
        slowCallRateThreshold: 0,
        bufferedCalls: 0,
      }),
      text: () => Promise.resolve('{}'),
    } as Response)

    const state = await getCircuitBreaker('fx_dust', 'http://localhost:8081')
    expect(state.name).toBe('fx_dust')
    expect(state.state).toBe('CLOSED')
    expect(state.failureRate).toBe(0)
    expect(state.failureThreshold).toBe(0.5)
  })

  it('translateCircuitBreaker：HALF_OPEN 状态也可解析（不抛错）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({
        name: 'fx_pulse', state: 'HALF_OPEN',
        failureRate: 0.3, failureThreshold: 0.5,
        slowCallRate: 0.1, slowCallRateThreshold: 0.8, bufferedCalls: 10,
      }),
      text: () => Promise.resolve('{}'),
    } as Response)

    const state = await getCircuitBreaker('fx_pulse', 'http://localhost:8081')
    expect(state.state).toBe('HALF_OPEN')
    expect(state.slowCallRateThreshold).toBe(0.8)
    expect(state.bufferedCalls).toBe(10)
  })

  it('HALF_OPEN 之前 drain 完的失败样本：bufferedCalls 透传不改', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({
        name: 'fx_x', state: 'CLOSED',
        failureRate: 0.2, failureThreshold: 0.5,
        slowCallRate: 0, slowCallRateThreshold: 0, bufferedCalls: 47,
      }),
      text: () => Promise.resolve('{}'),
    } as Response)

    const state = await getCircuitBreaker('fx_x', 'http://localhost:8081')
    expect(state.bufferedCalls).toBe(47)
  })

  it('json 字段丢失 tolerated：字段不存在不报错（Spring Cloud 某些端点不返回这些 JSON）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({
        name: 'fx_y', state: 'CLOSED',
        failureRate: 0, // 只提供 failureRate 字段
      }),
      text: () => Promise.resolve('{}'),
    } as Response)

    const state = await getCircuitBreaker('fx_y', 'http://localhost:8081')
    expect(state.name).toBe('fx_y')
    expect(state.failureRate).toBe(0)
    expect(state.slowCallRate).toBeUndefined()
  })

  it('fetch 网络失败 ⇒ 抛错包装错误信息', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    await expect(getCircuitBreaker('fx_dust', 'http://localhost:8081')).rejects.toThrow(/熔断器查询失败/)
  })

  it('getCircuitBreakers：返回全部熔断器列表', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve([
        { name: 'fx_dust', state: 'CLOSED', failureRate: 0, failureThreshold: 0.5, slowCallRate: 0, slowCallRateThreshold: 0, bufferedCalls: 0 },
        { name: 'fx_spark', state: 'OPEN', failureRate: 0.8, failureThreshold: 0.5, slowCallRate: 0, slowCallRateThreshold: 0, bufferedCalls: 5 },
      ]),
      text: () => Promise.resolve('[]'),
    } as Response)

    const states = await getCircuitBreakers('http://localhost:8081')
    expect(states.length).toBe(2)
    expect(states[0].name).toBe('fx_dust')
    expect(states[0].state).toBe('CLOSED')
    expect(states[1].name).toBe('fx_spark')
    expect(states[1].state).toBe('OPEN')
  })

  it('HTTP 错误 ⇒ 抛错并包含状态码', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'fail' }),
      text: () => Promise.resolve('{}'),
    } as Response)

    await expect(getCircuitBreaker('nonexistent', 'http://localhost:8081')).rejects.toThrow(/HTTP 500/)
  })

  it('网络不通 ⇒ 抛错', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8081'))
    await expect(getCircuitBreaker('any', 'http://localhost:8081')).rejects.toThrow(/ECONNREFUSED/)
  })

  it('URL 末尾斜杠被归一化', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve([]),
      text: () => Promise.resolve('[]'),
    } as Response)

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    await getCircuitBreakers('http://localhost:8081/')
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8081/actuator/circuitbreakers')
  })
})
