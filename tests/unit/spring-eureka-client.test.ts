import { describe, expect, it, vi, afterEach } from 'vitest'
import { getInstances, getAppNames } from '../../scripts/spring-eureka-client.mjs'

/**
 * Spring Cloud Eureka 客户端（Node.js 侧）单元测试。
 *
 * headless 可证：用 `vi.fetch` 模拟 HTTP，不启真 Eureka 服务器。
 * 验证服务发现查询与实例解析的正确性。
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

describe('spring-eureka-client：Eureka 服务发现', () => {
  it('查询指定应用 ⇒ 返回实例列表（含实例 ID、主机名、端口、状态）', async () => {
    mockFetch(200, {
      applications: {
        application: [
          {
            name: 'CAESURA-GATE',
            instance: [
              {
                instanceId: 'caesura-gate:8081',
                hostName: 'localhost',
                ipAddr: '127.0.0.1',
                port: { $: '8081', '@enabled': true },
                status: 'UP',
                homePageUrl: 'http://localhost:8081/',
              },
            ],
          },
        ],
      },
    })
    const instances = await getInstances('caesura-gate', 'http://localhost:8761')
    expect(instances.length).toBe(1)
    expect(instances[0].instanceId).toBe('caesura-gate:8081')
    expect(instances[0].hostName).toBe('localhost')
    expect(instances[0].port).toBe(8081)
    expect(instances[0].status).toBe('UP')
  })

  it('应用不存在 ⇒ 返回空数组', async () => {
    mockFetch(200, {
      applications: {
        application: [
          { name: 'CAESURA-GATE', instance: [] },
        ],
      },
    })
    const instances = await getInstances('nonexistent', 'http://localhost:8761')
    expect(instances).toEqual([])
  })

  it('查询全部应用 ⇒ 返回应用名列表', async () => {
    mockFetch(200, {
      applications: {
        application: [
          { name: 'CAESURA-GATE', instance: [] },
          { name: 'CAESURA-CONFIG', instance: [] },
          { name: 'CAESURA-REGISTRY', instance: [] },
        ],
      },
    })
    const names = await getAppNames('http://localhost:8761')
    expect(names).toEqual(['CAESURA-GATE', 'CAESURA-CONFIG', 'CAESURA-REGISTRY'])
  })

  it('HTTP 错误 ⇒ 抛错并包含状态码', async () => {
    mockFetch(500, { error: 'Internal Server Error' }, false)
    await expect(getInstances('caesura-gate', 'http://localhost:8761')).rejects.toThrow(/HTTP 500/)
  })

  it('网络不通 ⇒ 抛错', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8761'))
    await expect(getInstances('caesura-gate', 'http://localhost:8761')).rejects.toThrow(/ECONNREFUSED/)
  })

  it('URL 末尾斜杠被归一化', async () => {
    mockFetch(200, { applications: { application: [] } })
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    await getAppNames('http://localhost:8761/')
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8761/eureka/apps')
  })
})
