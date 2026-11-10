import { describe, expect, it, vi, afterEach } from 'vitest'
import { getRoute, getRoutes } from '../../scripts/spring-gateway-route.mjs'

/**
 * Spring Cloud Gateway 路由客户端单元测试。
 *
 * headless 可证：用 `vi.fetch` 模拟 HTTP，不启真 Gateway 服务器。
 * 验证路由查询与解析的正确性。
 */

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

describe('spring-gateway-route：Gateway 路由查询', () => {
  it('getRoute：返回单个路由定义（id/uri/order/predicates/filters）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({
        id: 'caesura-gate-route',
        uri: 'lb://caesura-gate',
        order: 0,
        predicates: [{ name: 'Path', args: { pattern: '/gate/**' } }],
        filters: [{ name: 'RewritePath', args: { regexp: '/gate/(?<remaining>.*)', replacement: '/${remaining}' } }],
      }),
      text: () => Promise.resolve('{}'),
    } as Response)

    const route = await getRoute('caesura-gate-route', 'http://localhost:8099')
    expect(route.id).toBe('caesura-gate-route')
    expect(route.uri).toBe('lb://caesura-gate')
    expect(route.order).toBe(0)
    expect(route.predicates.length).toBe(1)
    expect(route.predicates[0].name).toBe('Path')
    expect(route.filters.length).toBe(1)
    expect(route.filters[0].name).toBe('RewritePath')
  })

  it('getRoutes：返回全部路由列表', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve([
        { id: 'route-1', uri: 'lb://service-1', order: 0, predicates: [], filters: [] },
        { id: 'route-2', uri: 'lb://service-2', order: 1, predicates: [], filters: [] },
      ]),
      text: () => Promise.resolve('{}'),
    } as Response)

    const routes = await getRoutes('http://localhost:8099')
    expect(routes.length).toBe(2)
    expect(routes[0].id).toBe('route-1')
    expect(routes[1].id).toBe('route-2')
  })

  it('HTTP 错误 ⇒ 抛错并包含状态码', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'fail' }),
      text: () => Promise.resolve('{}'),
    } as Response)

    await expect(getRoute('nonexistent', 'http://localhost:8099')).rejects.toThrow(/HTTP 500/)
  })

  it('网络不通 ⇒ 抛错', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8099'))
    await expect(getRoute('any', 'http://localhost:8099')).rejects.toThrow(/ECONNREFUSED/)
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
    await getRoutes('http://localhost:8099/')
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8099/actuator/gateway/routes')
  })
})
