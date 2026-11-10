/**
 * scripts/spring-sleuth-trace.mjs —— Spring Cloud Sleuth 链路追踪客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**分布式链路追踪数据查询**：向 Zipkin/Trace 后端查询已记录的
 * Trace 和 Span 数据，供 Node.js 侧消费者构造链路分析逻辑。所有业务阈值与判定
 * 仍由 Node 侧负责；Spring 家族只负责编排/报告。
 *
 * **为什么不由 Java 直接查 Sleuth 数据**：Node.js 侧也需要知道跨服务调用链路的
 * 耗时与依赖关系，让每个 Node 模块各自构造 Sleuth 查询 = 多个主人；由本脚本
 * 统一抓取 = 唯一出处。
 *
 * **Zipkin API**：GET /api/v2/traces 返回最近的 Trace ID 列表；
 * GET /api/v2/trace/{traceId} 返回单个 Trace 的全部 Span。
 *
 * 用法：
 *   node scripts/spring-sleuth-trace.mjs [traceId] [Zipkin URL]
 *   例如：node scripts/spring-sleuth-trace.mjs abc123 http://localhost:9411
 *   例如：node scripts/spring-sleuth-trace.mjs   http://localhost:9411   （列出最近 traces）
 *
 * 退出码：0 = 成功；1 = HTTP 错误；2 = 用法不对；3 = 网络不通。
 */

/** 默认 Zipkin 服务器地址（Spring Cloud Sleuth 默认端口） */
const DEFAULT_ZIPKIN_URL = 'http://localhost:9411'

/** 查询单个 Trace 的全部 Span */
export async function getTrace(traceId, zipkinUrl) {
  const url = `${zipkinUrl.replace(/\/$/, '')}/api/v2/trace/${traceId}`
  try {
    const res = await globalThis.fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${res.statusText}${text ? ` ${text}` : ''}`)
    }
    const body = await res.json()
    return (body ?? []).map((s) => ({
      traceId: s.traceId,
      id: s.id,
      name: s.name,
      kind: s.kind,
      timestamp: s.timestamp,
      duration: s.duration,
      localEndpoint: s.localEndpoint,
      remoteEndpoint: s.remoteEndpoint,
      tags: s.tags,
      annotations: s.annotations,
      debug: s.debug,
      shared: s.shared,
    }))
  } catch (e) {
    throw new Error(`Sleuth trace 查询失败 ${traceId} from ${url}: ${e.message}`)
  }
}

/** 查询最近的 Trace ID 列表 */
export async function getTraceIds(zipkinUrl) {
  const url = `${zipkinUrl.replace(/\/$/, '')}/api/v2/traces`
  try {
    const res = await globalThis.fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${res.statusText}${text ? ` ${text}` : ''}`)
    }
    const body = await res.json()
    return body
  } catch (e) {
    throw new Error(`Sleuth trace 列表查询失败 from ${url}: ${e.message}`)
  }
}

/** 计算 Trace 的总耗时与服务依赖图 */
export function summarizeTrace(spans) {
  const traceId = spans.length > 0 ? spans[0].traceId : ''
  const services = new Set()
  const deps = new Map()
  let totalDurationMs = 0

  for (const s of spans) {
    if (s.localEndpoint?.serviceName) services.add(s.localEndpoint.serviceName)
    if (s.remoteEndpoint?.serviceName) services.add(s.remoteEndpoint.serviceName)
    if (s.duration) totalDurationMs += s.duration / 1_000_000 // ns → ms
    if (s.localEndpoint?.serviceName && s.remoteEndpoint?.serviceName) {
      const key = `${s.localEndpoint.serviceName}->${s.remoteEndpoint.serviceName}`
      deps.set(key, (deps.get(key) ?? 0) + 1)
    }
  }

  return {
    traceId,
    spanCount: spans.length,
    totalDurationMs,
    services: [...services],
    dependencies: [...deps.entries()].map(([key, count]) => {
      const [from, to] = key.split('->')
      return { from, to, count }
    }),
  }
}

/** CLI 主体：被直接运行时打印 JSON 并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const traceId = process.argv[2] ?? null
  const zipkinUrl = process.argv[3] ?? DEFAULT_ZIPKIN_URL
  try {
    if (traceId) {
      const spans = await getTrace(traceId, zipkinUrl)
      const summary = summarizeTrace(spans)
      console.log(JSON.stringify({ trace: summary, spans }, null, 2))
    } else {
      const traceIds = await getTraceIds(zipkinUrl)
      console.log(JSON.stringify(traceIds, null, 2))
    }
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
