import { describe, expect, it, afterEach } from 'vitest'
import { startGateway } from '../../services/dev-gateway.mjs'

/**
 * KI-421｜`services/dev-gateway.mjs` 的合约：本地 Spring Cloud Gateway–shaped 面。
 * 所有断言来往走真 HTTP（不是 mock 自己的、也不是调 `handler()` 只看返回值）——
 * 别人（联机构建、CI）将来要用的就是这个形状。
 */

interface Gw { url: string; close(): Promise<void> | void; host: string; port: number }
const running: Gw[] = []
afterEach(async () => {
  for (const g of running.splice(0)) {
    try { await g.close() } catch { /* 已经关了 */ }
  }
})

const start = async (): Promise<Gw> => {
  const g = await startGateway({ port: 0 })
  running.push(g)
  return g
}

describe('KI-421｜dev-gateway：/api/health', () => {
  it('200 + 版本/范围/node 标识', async () => {
    const g = await start()
    const res = await fetch(`${g.url}/api/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'UP', scope: 'local-dev' })
    expect(typeof body.version).toBe('string')
    expect(String(body.node)).toMatch(/^v\d+/)
    expect(typeof body.uptimeSec).toBe('number')
  })
})

describe('KI-421｜dev-gateway：/api/registry 自洽', () => {
  it('名册包含 / 首页 event 自己；每条路由 id/service/method/path 齐', async () => {
    const g = await start()
    const res = await fetch(`${g.url}/api/registry`)
    const body = await res.json()
    expect(body.routes.length).toBeGreaterThanOrEqual(7)
    for (const r of body.routes) {
      expect(typeof r.id).toBe('string')
      expect(typeof r.service).toBe('string')
      expect(r.method).toBe('GET')
      expect(r.path.startsWith('/api/')).toBe(true)
    }
    const ids = body.routes.map((r: { id: string }) => r.id)
    for (const need of ['health', 'status', 'registry', 'changelog']) expect(ids).toContain(need)
  })
})

describe('KI-421｜dev-gateway：/api/changelog', () => {
  it('聚合月份计数 = 总数与 660+ 数对得上', async () => {
    const g = await start()
    const body = await (await fetch(`${g.url}/api/changelog`)).json()
    const sum = Object.values(body.byMonth as Record<string, number>).reduce((a, b) => a + b, 0)
    expect(body.totalCommits).toBe(sum)
    expect(body.totalCommits).toBeGreaterThan(600)
  })
})

describe('KI-421｜dev-gateway：/api/coverage-floor', () => {
  it('直接回 coverage 地板文件', async () => {
    const g = await start()
    const body = await (await fetch(`${g.url}/api/coverage-floor`)).json()
    expect(typeof body.linesPct).toBe('number')
    expect(body.linesPct).toBeGreaterThanOrEqual(90)
    expect(Array.isArray(body.zeroFiles)).toBe(true)
  })
})

describe('KI-421｜dev-gateway：/api/metrics 诚实', () => {
  it('没跑 measure-probe ⇒ 如实说没有；跑过 ⇒ 真 JSON + 计数', async () => {
    const g = await start()
    const res = await fetch(`${g.url}/api/metrics`)
    const body = await res.json()
    expect('latest' in body).toBe(true)
    if (body.latest === null) {
      expect(typeof body.reason, '没跑过也必须给理由').toBe('string')
      expect(body.metrics).toBeUndefined()
    } else {
      expect(body.latest).toMatch(/^perf-probe-\d{4}-\d{2}-\d{2}\.log$/)
      expect(typeof body.content).toBe('object')
    }
  })
})

describe('KI-421｜dev-gateway：边界（只 GET / 已知路由）', () => {
  it('未知路径 ⇒ 404 + 已知路由名册', async () => {
    const g = await start()
    const res = await fetch(`${g.url}/api/nope`)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
    expect(body.known.length).toBeGreaterThan(0)
    expect(body.known.some((k: string) => k.includes('/api/health'))).toBe(true)
  })
  it('POST 也是 404（只允许 GET）', async () => {
    const g = await start()
    const res = await fetch(`${g.url}/api/health`, { method: 'POST' })
    expect(res.status).toBe(404)
  })
  it('/ 返回 discovery JSON 且路由条数与 /api/registry 一致', async () => {
    const g = await start()
    const index = await (await fetch(`${g.url}/`)).json()
    const registry = await (await fetch(`${g.url}/api/registry`)).json()
    expect(index.service).toBe('caesura-dev-gateway')
    expect(index.routes.length).toBe(registry.routes.length)
  })
})

describe('KI-421｜dev-gateway：/api/status', () => {
  it('把 phase-status.mjs 现取摆上来（KI.rows 有数，ARCH 连续）', async () => {
    const g = await start()
    // 慢一点没事，spawn 一份 ~100ms
    const res = await fetch(`${g.url}/api/status`)
    expect(res.status).toBe(200)
    const body = await res.json()
    if (body.exitCode && body.error) {
      // 脚本崩了也必须给错误形状，不许把「没读到」装成「绿」
      expect(typeof body.error).toBe('string')
    } else {
      expect(typeof body.keys).toBe('object')
      expect(Number(body.keys['KI.rows'])).toBeGreaterThan(300)
      expect(body.keys['ARCH.holes']).toBe('none')
    }
  }, 30000)
})
