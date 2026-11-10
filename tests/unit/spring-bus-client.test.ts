import { describe, expect, it, vi, afterEach } from 'vitest'
import { busRefresh } from '../../scripts/spring-bus-client.mjs'

/**
 * Spring Cloud Bus 客户端（Node.js 侧）单元测试。
 *
 * headless 可证：用 `vi.fetch` 模拟 HTTP，不启真 Bus 服务器。
 * 验证 bus-refresh 请求构造与响应处理的正确性。
 */

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

function mockFetch(status: number, body: unknown, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response)
}

describe('spring-bus-client：Bus 事件总线刷新', () => {
  it('广播全部服务 ⇒ POST /actuator/bus-refresh，无 destination body', async () => {
    mockFetch(200, { timestamp: '2026-11-10T00:00:00Z', status: 200, path: '/actuator/bus-refresh' })
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const result = await busRefresh(null, 'http://localhost:8081')
    expect(result.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8081/actuator/bus-refresh')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  it('指定服务 ⇒ body 带 destination 字段', async () => {
    mockFetch(200, { timestamp: '2026-11-10T00:00:00Z', status: 200, path: '/actuator/bus-refresh' })
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    await busRefresh('caesura-gate', 'http://localhost:8081')
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ destination: 'caesura-gate' }))
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('HTTP 错误 ⇒ 抛错并包含状态码', async () => {
    mockFetch(500, { error: 'Internal Server Error' }, false)
    await expect(busRefresh('caesura-gate', 'http://localhost:8081')).rejects.toThrow(/HTTP 500/)
  })

  it('网络不通 ⇒ 抛错', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8081'))
    await expect(busRefresh(null, 'http://localhost:8081')).rejects.toThrow(/ECONNREFUSED/)
  })

  it('URL 末尾斜杠被归一化', async () => {
    mockFetch(200, { timestamp: '2026-11-10T00:00:00Z', status: 200, path: '/actuator/bus-refresh' })
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    await busRefresh(null, 'http://localhost:8081/')
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8081/actuator/bus-refresh')
  })
})
