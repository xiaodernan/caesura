import { describe, expect, it, vi, afterEach } from 'vitest'
import { probeOne, probeAll, SERVICE_PORTS, HEALTH_PATH } from '../../scripts/spring-health-check.mjs'

/**
 * scripts/spring-health-check.mjs —— Spring Cloud 家族健康探针（KI-422 扩展）。
 *
 * headless 可证：不启真服务，用 `vi.fetch` 模拟 HTTP，验证探针形状与退出逻辑。
 * 探针本身「只量不决」：UP/DOWN 由调用方自己答，这里只负责把 HTTP 读数原样交出。
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
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response)
}

describe('KI-429/F2｜spring-health-check：探针形状与退出逻辑', () => {
  it('SERVICE_PORTS 六服务齐全（与 docker-compose.yml / application.yml 同源）', () => {
    expect([...SERVICE_PORTS.keys()].sort()).toEqual([
      'caesura-client', 'caesura-config', 'caesura-gate', 'caesura-gateway', 'caesura-registry', 'caesura-report'
    ])
    expect(SERVICE_PORTS.get('caesura-gate')).toBe(8081)
    expect(SERVICE_PORTS.get('caesura-config')).toBe(8888)
  })

  it('HEALTH_PATH 六服务各有一条（context-path + /actuator/health）', () => {
    expect(HEALTH_PATH.get('caesura-gate')).toBe('/gate/actuator/health')
    expect(HEALTH_PATH.get('caesura-report')).toBe('/report/actuator/health')
    expect(HEALTH_PATH.get('caesura-client')).toBe('/actuator/health')
  })

  it('probeOne 返回 UP 时 ok=true、status=200、body 解析为对象', async () => {
    mockFetch(200, { status: 'UP', service: 'caesura-gate' })
    const r = await probeOne('caesura-gate')
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ status: 'UP', service: 'caesura-gate' })
    expect(r.port).toBe(8081)
  })

  it('probeOne 返回非 2xx 时 ok=false，body 原样透传', async () => {
    mockFetch(503, { status: 'DOWN', detail: 'circuit open' }, false)
    const r = await probeOne('caesura-report')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ status: 'DOWN', detail: 'circuit open' })
  })

  it('probeOne 连不上（拒绝连接）⇒ ok=false、status=null、body 是错误消息', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8081'))
    const r = await probeOne('caesura-gate')
    expect(r.ok).toBe(false)
    expect(r.status).toBeNull()
    expect(r.body).toContain('ECONNREFUSED')
  })

  it('probeOne 未知服务 ⇒ ok=false、port=null、body 指名道姓', async () => {
    const r = await probeOne('caesura-nonexistent')
    expect(r.ok).toBe(false)
    expect(r.port).toBeNull()
    expect(r.body).toContain('未知服务：caesura-nonexistent')
  })

  it('probeAll 返回六份结果，每份都有 name/port/ok/status/body', async () => {
    mockFetch(200, { status: 'UP' })
    const results = await probeAll()
    expect(results.length).toBe(6)
    for (const r of results) {
      expect(r).toMatchObject({ name: expect.any(String), port: expect.any(Number), ok: expect.any(Boolean), status: expect.any(Number) })
    }
  })
})
