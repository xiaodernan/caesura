import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchConfig, fetchConfigWithFallback } from '../../scripts/spring-config-client.mjs'

/**
 * Spring Cloud Config 客户端（Node.js 侧）单元测试。
 *
 * headless 可证：用 `vi.fetch` 模拟 HTTP，不启真 Config Server。
 * 验证配置获取与属性展平的正确性。
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
    json: () => Promise.resolve(body),
  } as Response)
}

describe('spring-config-client：Config Server 配置获取', () => {
  it('成功获取 ⇒ 属性被展平成单层键值对', async () => {
    mockFetch(200, {
      name: 'caesura-gate',
      profiles: ['default'],
      label: 'master',
      version: '1',
      state: null,
      propertySources: [
        { name: 'application', source: { 'spring.application.name': 'caesura-gate', 'server.port': 8081 } },
        { name: 'caesura-gate', source: { 'caesura.circuit.failure-threshold': 3, 'caesura.circuit.cooldown-sec': 120 } },
      ],
    })
    const config = await fetchConfig('caesura-gate', 'http://localhost:8888')
    expect(config['spring.application.name']).toBe('caesura-gate')
    expect(config['server.port']).toBe(8081)
    expect(config['caesura.circuit.failure-threshold']).toBe(3)
    expect(config['caesura.circuit.cooldown-sec']).toBe(120)
  })

  it('HTTP 错误 ⇒ 抛错并包含状态码', async () => {
    mockFetch(500, { error: 'Internal Server Error' }, false)
    await expect(fetchConfig('caesura-gate', 'http://localhost:8888')).rejects.toThrow(/HTTP 500/)
  })

  it('网络不通 ⇒ 抛错', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8888'))
    await expect(fetchConfig('caesura-gate', 'http://localhost:8888')).rejects.toThrow(/ECONNREFUSED/)
  })

  it('URL 末尾斜杠被归一化', async () => {
    mockFetch(200, {
      name: 'test-app',
      profiles: ['default'],
      label: 'master',
      version: '1',
      state: null,
      propertySources: [{ name: 'application', source: { 'key': 'value' } }],
    })
    const config = await fetchConfig('test-app', 'http://localhost:8888/')
    expect(config['key']).toBe('value')
  })

  it('fetchConfigWithFallback：成功获取时返回正常配置', async () => {
    mockFetch(200, {
      name: 'caesura-gate',
      profiles: ['default'],
      label: 'master',
      version: '1',
      state: null,
      propertySources: [{ name: 'application', source: { 'server.port': 8081 } }],
    })
    const config = await fetchConfigWithFallback('caesura-gate', 'http://localhost:8888')
    expect(config['server.port']).toBe(8081)
    expect(config['_configError']).toBeUndefined()
  })

  it('fetchConfigWithFallback：HTTP 错误时返回 fallback 并标记错误', async () => {
    mockFetch(500, { error: 'Internal Server Error' }, false)
    const config = await fetchConfigWithFallback('caesura-gate', 'http://localhost:8888', { 'server.port': 9090 })
    expect(config['server.port']).toBe(9090)
    expect(config['_configError']).toContain('HTTP 500')
  })

  it('fetchConfigWithFallback：网络不通时返回默认空 fallback', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8888'))
    const config = await fetchConfigWithFallback('caesura-gate', 'http://localhost:8888')
    expect(config).toEqual({ _configError: expect.stringContaining('ECONNREFUSED') })
  })
})
