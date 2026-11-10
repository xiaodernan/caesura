import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  getRoute,
  getRoutes,
  refreshRoutes,
  createRouteTable,
  loadRoutesFromFile,
  watchRoutes,
} from '../../scripts/spring-gateway-route.mjs'
import { createBus } from '../../scripts/spring-bus-event.mjs'

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

  it('refreshRoutes：POST /actuator/gateway/refresh ⇒ 触发网关热重载', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('Routes refreshed'),
    } as Response)

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const result = await refreshRoutes('http://localhost:8099/')
    expect(result.ok).toBe(true)
    expect(result.body).toBe('Routes refreshed')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8099/actuator/gateway/refresh')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('refreshRoutes：HTTP 错误 ⇒ 抛错', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('boom'),
    } as Response)

    await expect(refreshRoutes('http://localhost:8099')).rejects.toThrow(/HTTP 500/)
  })
})

describe('spring-gateway-route：动态路由表（进程内热加载）', () => {
  it('createRouteTable：add/get/list 按 order 升序', () => {
    const table = createRouteTable()
    table.add({ id: 'b', uri: 'lb://b', order: 10 })
    table.add({ id: 'a', uri: 'lb://a', order: 1 })
    table.add({ id: 'c', uri: 'lb://c', order: 10 })
    expect(table.size()).toBe(3)
    expect(table.list().map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(table.get('b')!.uri).toBe('lb://b')
  })

  it('createRouteTable：add 覆盖同 id 路由；缺 id/uri 抛错', () => {
    const table = createRouteTable()
    table.add({ id: 'a', uri: 'lb://a', order: 0 })
    table.add({ id: 'a', uri: 'lb://a2', order: 5 })
    expect(table.get('a')!.uri).toBe('lb://a2')
    expect(table.size()).toBe(1)
    expect(() => table.add({ uri: 'lb://x' } as unknown)).toThrow(/缺少 id/)
    expect(() => table.add({ id: 'x' } as unknown)).toThrow(/缺少 uri/)
  })

  it('createRouteTable：remove/clear 生效', () => {
    const table = createRouteTable()
    table.add({ id: 'a', uri: 'lb://a' })
    expect(table.remove('a')).toBe(true)
    expect(table.remove('a')).toBe(false)
    table.add({ id: 'b', uri: 'lb://b' })
    table.clear()
    expect(table.size()).toBe(0)
  })

  it('loadRoutesFromFile：routes.json 数组整体替换表内容', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caesura-routes-'))
    const file = path.join(tmpDir, 'routes.json')
    fs.writeFileSync(file, JSON.stringify([
      { id: 'r1', uri: 'lb://service-1', order: 1, predicates: [{ name: 'Path', args: {} }] },
      { id: 'r2', uri: 'lb://service-2', order: 0 },
    ]))

    const table = createRouteTable()
    table.add({ id: 'stale', uri: 'lb://stale' })
    const routes = loadRoutesFromFile(table, file)
    expect(routes.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(table.get('stale')).toBeUndefined() // 旧内容被清空
    expect(table.get('r1')!.predicates).toHaveLength(1)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('loadRoutesFromFile：非数组 JSON ⇒ 抛错', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caesura-routes-'))
    const file = path.join(tmpDir, 'routes.json')
    fs.writeFileSync(file, JSON.stringify({ not: 'an-array' }))

    const table = createRouteTable()
    expect(() => loadRoutesFromFile(table, file)).toThrow(/数组/)
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('watchRoutes：首趟只取快照不触发；改文件后触发（added/removed）+ 广播 route.changed', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caesura-routes-'))
    const file = path.join(tmpDir, 'routes.json')
    fs.writeFileSync(file, JSON.stringify([{ id: 'r1', uri: 'lb://service-1', order: 0 }]))

    const table = createRouteTable()
    const evbus = createBus()
    const events: Array<{ added: string[]; removed: string[] }> = []
    evbus.subscribe('route.changed', (...args: unknown[]) => {
      const [added, removed] = args as [string[], string[]]
      events.push({ added, removed })
    })

    const stop = watchRoutes(table, file, 60, undefined, evbus)
    expect(table.list().map((r) => r.id)).toEqual(['r1'])

    // 追加 r2 并改写 routes.json → 应该触发 route.changed
    fs.writeFileSync(file, JSON.stringify([
      { id: 'r1', uri: 'lb://service-1', order: 0 },
      { id: 'r2', uri: 'lb://service-2', order: 1 },
    ]))

    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        stop()
        evbus.close()
        fs.rmSync(tmpDir, { recursive: true })
        try {
          expect(events.length).toBe(1)
          expect(events[0]!.added).toEqual(['r2'])
          expect(events[0]!.removed).toEqual([])
          expect(table.list().map((r) => r.id).sort()).toEqual(['r1', 'r2'])
          resolve()
        } catch (e) {
          reject(e)
        }
      }, 300)
    })
  })

  it('watchRoutes：删除路由也触发 route.changed', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caesura-routes-'))
    const file = path.join(tmpDir, 'routes.json')
    fs.writeFileSync(file, JSON.stringify([
      { id: 'r1', uri: 'lb://service-1', order: 0 },
      { id: 'r2', uri: 'lb://service-2', order: 1 },
    ]))

    const table = createRouteTable()
    const events: Array<{ added: string[]; removed: string[] }> = []

    const stop = watchRoutes(table, file, 60, (added, removed) => {
      events.push({ added, removed })
    })

    fs.writeFileSync(file, JSON.stringify([{ id: 'r1', uri: 'lb://service-1', order: 0 }]))

    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        stop()
        fs.rmSync(tmpDir, { recursive: true })
        try {
          expect(events.length).toBe(1)
          expect(events[0]!.added).toEqual([])
          expect(events[0]!.removed).toEqual(['r2'])
          resolve()
        } catch (e) {
          reject(e)
        }
      }, 300)
    })
  })
})
