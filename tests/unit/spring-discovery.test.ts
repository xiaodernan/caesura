import { describe, expect, it, vi, afterEach } from 'vitest'
import { discoverApp, discoverAll } from '../../scripts/spring-discovery.mjs'

/**
 * Spring Cloud 服务发现与配置综合客户端单元测试。
 *
 * headless 可证：用 `vi.fetch` 模拟 HTTP，不启真 Eureka/Config 服务器。
 * 验证 discoverApp/discoverAll 的合并输出与错误处理。
 */

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

describe('spring-discovery：服务发现 + 配置获取综合', () => {
  it('discoverApp：合并 Eureka 实例 + Config 配置', async () => {
    const responses: Record<string, unknown> = {
      'http://localhost:8761/eureka/apps/caesura-gate': {
        applications: {
          application: [{
            name: 'CAESURA-GATE',
            instance: [{
              instanceId: 'caesura-gate:8081',
              hostName: 'localhost',
              ipAddr: '127.0.0.1',
              port: { $: '8081', '@enabled': true },
              status: 'UP',
            }],
          }],
        },
      },
      'http://localhost:8888/caesura-gate/master': {
        propertySources: [{ name: 'app', source: { 'server.port': 8081 } }],
      },
    }
    globalThis.fetch = vi.fn().mockImplementation((u: string) => {
      const urlStr = String(u)
      for (const [key, value] of Object.entries(responses)) {
        if (urlStr.includes(key)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve(value),
            text: () => Promise.resolve(JSON.stringify(value)),
          } as Response)
        }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{}'),
      } as Response)
    })

    const view = await discoverApp('caesura-gate', 'http://localhost:8761', 'http://localhost:8888')
    expect(view.name).toBe('caesura-gate')
    expect(view.instances.length).toBe(1)
    expect(view.instances[0].port).toBe(8081)
    expect(view.instances[0].status).toBe('UP')
    expect(view.config['server.port']).toBe(8081)
  })

  it('discoverAll：逐个发现全部应用', async () => {
    const responses: Record<string, unknown> = {
      'http://localhost:8761/eureka/apps': {
        applications: {
          application: [
            { name: 'CAESURA-GATE', instance: [] },
            { name: 'CAESURA-CONFIG', instance: [] },
          ],
        },
      },
      'http://localhost:8761/eureka/apps/CAESURA-GATE': {
        applications: {
          application: [{ name: 'CAESURA-GATE', instance: [] }],
        },
      },
      'http://localhost:8761/eureka/apps/CAESURA-CONFIG': {
        applications: {
          application: [{ name: 'CAESURA-CONFIG', instance: [] }],
        },
      },
      'http://localhost:8888/caesura-gate/master': { propertySources: [] },
      'http://localhost:8888/caesura-config/master': { propertySources: [] },
    }
    globalThis.fetch = vi.fn().mockImplementation((u: string) => {
      const urlStr = String(u)
      for (const [key, value] of Object.entries(responses)) {
        if (urlStr.includes(key)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve(value),
            text: () => Promise.resolve(JSON.stringify(value)),
          } as Response)
        }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{}'),
      } as Response)
    })

    const views = await discoverAll('http://localhost:8761', 'http://localhost:8888')
    expect(views.length).toBe(2)
    expect(views.map((v) => v.name).sort()).toEqual(['CAESURA-CONFIG', 'CAESURA-GATE'])
  })

  it('单个应用发现失败 ⇒ discoverAll 不抛错', async () => {
    const responses: Record<string, unknown> = {
      'http://localhost:8761/eureka/apps': {
        applications: {
          application: [
            { name: 'CAESURA-GATE', instance: [] },
            { name: 'CAESURA-BAD', instance: [] },
          ],
        },
      },
      'http://localhost:8761/eureka/apps/CAESURA-GATE': {
        applications: {
          application: [{ name: 'CAESURA-GATE', instance: [] }],
        },
      },
      'http://localhost:8888/caesura-gate/master': { propertySources: [] },
    }
    globalThis.fetch = vi.fn().mockImplementation((u: string) => {
      const urlStr = String(u)
      // CAESURA-BAD 的 config 查询故意失败
      if (urlStr.includes('caesura-bad') && urlStr.includes(':8888')) {
        return Promise.reject(new Error('HTTP 500'))
      }
      for (const [key, value] of Object.entries(responses)) {
        if (urlStr.includes(key)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve(value),
            text: () => Promise.resolve(JSON.stringify(value)),
          } as Response)
        }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{}'),
      } as Response)
    })

    // 不应抛错
    const views = await discoverAll('http://localhost:8761', 'http://localhost:8888')
    expect(views.length).toBeGreaterThanOrEqual(1)
    expect(views.some((v) => v.name === 'CAESURA-GATE')).toBe(true)
  })
})
