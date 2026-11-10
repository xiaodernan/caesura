import { describe, expect, it, vi, afterEach } from 'vitest'
import { getTrace, getTraceIds, summarizeTrace, type SpanData } from '../../scripts/spring-sleuth-trace.mjs'

/**
 * Spring Cloud Sleuth 客户端单元测试。
 *
 * headless 可证：用 `vi.fetch` 模拟 HTTP，不启真 Zipkin 服务器。
 * 验证链路追踪查询与 Trace 总结的正确性。
 */

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

describe('spring-sleuth-trace：链路追踪查询', () => {
  it('getTrace：返回单个 Trace 的全部 Span', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve([
        {
          traceId: 'abc123',
          id: 'span1',
          name: 'http:get',
          kind: 'SERVER',
          timestamp: 1000000000,
          duration: 50000000,
          localEndpoint: { serviceName: 'caesura-gate', ipv4: '127.0.0.1', port: 8081 },
          remoteEndpoint: { serviceName: 'caesura-config', ipv4: '127.0.0.1', port: 8888 },
          tags: { 'http.status_code': '200' },
          annotations: [{ timestamp: 1000000000, value: 'cr' }],
          debug: false,
          shared: false,
        },
        {
          traceId: 'abc123',
          id: 'span2',
          name: 'http:post',
          kind: 'CLIENT',
          timestamp: 1000050000,
          duration: 30000000,
          localEndpoint: { serviceName: 'caesura-gate', ipv4: '127.0.0.1', port: 8081 },
          remoteEndpoint: null,
          tags: {},
          annotations: [],
          debug: false,
          shared: false,
        },
      ]),
      text: () => Promise.resolve('[]'),
    } as Response)

    const spans = await getTrace('abc123', 'http://localhost:9411')
    expect(spans.length).toBe(2)
    expect(spans[0].traceId).toBe('abc123')
    expect(spans[0].name).toBe('http:get')
    expect(spans[0].localEndpoint?.serviceName).toBe('caesura-gate')
    expect(spans[1].kind).toBe('CLIENT')
  })

  it('getTraceIds：返回最近的 Trace ID 列表', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(['trace1', 'trace2', 'trace3']),
      text: () => Promise.resolve('[]'),
    } as Response)

    const traceIds = await getTraceIds('http://localhost:9411')
    expect(traceIds.length).toBe(3)
    expect(traceIds).toEqual(['trace1', 'trace2', 'trace3'])
  })

  it('HTTP 错误 ⇒ 抛错并包含状态码', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({ error: 'fail' }),
      text: () => Promise.resolve('{}'),
    } as Response)

    await expect(getTrace('abc123', 'http://localhost:9411')).rejects.toThrow(/HTTP 503/)
  })

  it('网络不通 ⇒ 抛错', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9411'))
    await expect(getTraceIds('http://localhost:9411')).rejects.toThrow(/ECONNREFUSED/)
  })

  it('summarizeTrace：计算总耗时与服务依赖图', () => {
    const spans: SpanData[] = [
      {
        traceId: 't1',
        id: 's1',
        name: 'op1',
        kind: 'SERVER',
        timestamp: 1000,
        duration: 100000000, // 100 ms
        localEndpoint: { serviceName: 'svc-a' },
        remoteEndpoint: { serviceName: 'svc-b' },
        tags: {},
        annotations: [],
        debug: false,
        shared: false,
      },
      {
        traceId: 't1',
        id: 's2',
        name: 'op2',
        kind: 'CLIENT',
        timestamp: 2000,
        duration: 200000000, // 200 ms
        localEndpoint: { serviceName: 'svc-a' },
        remoteEndpoint: { serviceName: 'svc-c' },
        tags: {},
        annotations: [],
        debug: false,
        shared: false,
      },
    ]

    const summary = summarizeTrace(spans)
    expect(summary.traceId).toBe('t1')
    expect(summary.spanCount).toBe(2)
    expect(summary.totalDurationMs).toBeCloseTo(300, 1) // 100 + 200 ms
    expect(summary.services).toContain('svc-a')
    expect(summary.services).toContain('svc-b')
    expect(summary.services).toContain('svc-c')
    expect(summary.dependencies.some((d) => d.from === 'svc-a' && d.to === 'svc-b')).toBe(true)
    expect(summary.dependencies.some((d) => d.from === 'svc-a' && d.to === 'svc-c')).toBe(true)
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
    await getTraceIds('http://localhost:9411/')
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:9411/api/v2/traces')
  })
})
