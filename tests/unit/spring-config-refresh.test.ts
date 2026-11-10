import { describe, expect, it, vi, afterEach } from 'vitest'
import { refreshApp, refreshAll } from '../../scripts/spring-config-refresh.mjs'

/**
 * Spring Cloud 配置刷新综合脚本单元测试。
 *
 * headless 可证：用 `vi.fetch` 模拟 HTTP，验证 refreshApp/refreshAll 的编排流程。
 */

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

describe('spring-config-refresh：配置刷新编排', () => {
  it('refreshApp：先拉取配置，再发 bus-refresh', async () => {
    // 第一个 fetch：config-client GET 配置
    // 第二个 fetch：bus-client POST bus-refresh
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      calls.push({ url: String(url), init })
      const urlStr = String(url)
      if (urlStr.includes('/eureka/apps/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ applications: { application: [{ name: 'CAESURA-GATE', instance: [] }] } }),
          text: () => Promise.resolve('{}'),
        } as Response)
      }
      if (urlStr.includes('/actuator/bus-refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ timestamp: '2026-11-10T00:00:00Z', status: 200 }),
          text: () => Promise.resolve('{}'),
        } as Response)
      }
      // config-server 返回
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ propertySources: [{ name: 'app', source: { 'key': 'value' } }] }),
        text: () => Promise.resolve('{}'),
      } as Response)
    })

    await refreshApp('caesura-gate', 'http://localhost:8761', 'http://localhost:8888')

    expect(calls.length).toBeGreaterThanOrEqual(2)
    // 第一个调用应该是 config-server（GET）
    expect(String(calls[0].url)).toContain('8888')
    // 最后一个调用应该是 bus-refresh（POST）
    const last = calls[calls.length - 1]
    expect(String(last.url)).toContain('bus-refresh')
    expect(last.init?.method).toBe('POST')
  })

  it('refreshApp：返回结构体（appName/configPropsCount/busRefreshEndpoint/busRefreshBody）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ propertySources: [{ name: 'app', source: { 'key1': 'a', 'key2': 'b' } }], status: 200 }),
      text: () => Promise.resolve('{}'),
    } as Response)

    const result = await refreshApp('caesura-gate', 'http://localhost:8761', 'http://localhost:8888')
    expect(result?.appName).toBe('caesura-gate')
    expect(result?.configPropsCount).toBe(2)
    expect(result?.busRefreshEndpoint).toBe('http://localhost:8081')
    expect((result as any)?.busRefreshBody?.status ?? (result as any)?.status).toBeDefined()
  })

  it('refreshApp：显式 busRefreshUrl 参数时用它（不覆盖前一默认值）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ propertySources: [{ name: 'app', source: {} }], status: 200 }),
      text: () => Promise.resolve('{}'),
    } as Response)

    const result = await refreshApp('caesura-gate', 'http://localhost:8761', 'http://localhost:8888', 'http://localhost:9999')
    expect(result?.busRefreshEndpoint).toBe('http://localhost:9999')
  })

  it('refreshApp：configUrl 包含 :8888 时自动推导 busRefreshUrl 为 :8081', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ propertySources: [{ name: 'app', source: {} }], status: 200 }),
      text: () => Promise.resolve('{}'),
    } as Response)

    const result = await refreshApp('caesura-gate', 'http://localhost:8761', 'http://localhost:8888')
    expect(result?.busRefreshEndpoint).toBe('http://localhost:8081')
  })

  it('refreshAll：列出全部应用，逐一刷新', async () => {
    const calls: Array<string> = []
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      calls.push(String(url))
      const urlStr = String(url)
      if (urlStr.includes('/eureka/apps') && !urlStr.includes('/eureka/apps/')) {
        // 列出全部应用
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({
            applications: {
              application: [
                { name: 'CAESURA-GATE', instance: [] },
                { name: 'CAESURA-CONFIG', instance: [] },
              ],
            },
          }),
          text: () => Promise.resolve('{}'),
        } as Response)
      }
      if (urlStr.includes('/eureka/apps/')) {
        // 查询单个应用实例
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ applications: { application: [{ name: 'CAESURA-GATE', instance: [] }] } }),
          text: () => Promise.resolve('{}'),
        } as Response)
      }
      if (urlStr.includes('/actuator/bus-refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ timestamp: '2026-11-10T00:00:00Z', status: 200 }),
          text: () => Promise.resolve('{}'),
        } as Response)
      }
      // config-server
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ propertySources: [] }),
        text: () => Promise.resolve('{}'),
      } as Response)
    })

    await refreshAll('http://localhost:8761', 'http://localhost:8888')

    // 应该调用 /eureka/apps 列出应用
    expect(calls.some((u) => u === 'http://localhost:8761/eureka/apps')).toBe(true)
    // 应该调用 bus-refresh（针对每个应用）
    expect(calls.filter((u) => u.includes('bus-refresh')).length).toBeGreaterThanOrEqual(2)
  })

  it('单个应用刷新失败 ⇒ 不影响其他应用（refreshAll 继续）', async () => {
    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      callCount++
      const urlStr = String(url)
      if (urlStr.includes('/eureka/apps') && !urlStr.includes('/eureka/apps/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({
            applications: {
              application: [
                { name: 'CAESURA-GATE', instance: [] },
                { name: 'CAESURA-BAD', instance: [] },
              ],
            },
          }),
          text: () => Promise.resolve('{}'),
        } as Response)
      }
      if (urlStr.includes('/eureka/apps/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ applications: { application: [{ name: 'CAESURA-GATE', instance: [] }] } }),
          text: () => Promise.resolve('{}'),
        } as Response)
      }
      if (urlStr.includes('bus-refresh')) {
        if (urlStr.includes('CAESURA-BAD')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Error',
            json: () => Promise.resolve({ error: 'fail' }),
            text: () => Promise.resolve('{}'),
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ timestamp: '2026-11-10T00:00:00Z', status: 200 }),
          text: () => Promise.resolve('{}'),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ propertySources: [] }),
        text: () => Promise.resolve('{}'),
      } as Response)
    })

    // 不应抛错，refreshAll 应该继续处理其他应用
    await expect(refreshAll('http://localhost:8761', 'http://localhost:8888')).resolves.toBeUndefined()
    expect(callCount).toBeGreaterThan(0)
  })
})
