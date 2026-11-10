/** `scripts/spring-sleuth-trace.mjs` 的声明：Spring Cloud Sleuth 客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** Span 数据形状 */
export interface SpanData {
  traceId: string
  id: string
  name: string
  kind: string
  timestamp: number
  duration: number
  localEndpoint?: { serviceName: string; ipv4?: string; port?: number }
  remoteEndpoint?: { serviceName: string; ipv4?: string; port?: number }
  tags?: Record<string, string>
  annotations?: Array<{ timestamp: number; value: string; endpoint?: any }>
  debug: boolean
  shared: boolean
}

/** Trace 总结形状 */
export interface TraceSummary {
  traceId: string
  spanCount: number
  totalDurationMs: number
  services: string[]
  dependencies: Array<{ from: string; to: string; count: number }>
}

/** 查询单个 Trace 的全部 Span */
export function getTrace(traceId: string, zipkinUrl: string): Promise<SpanData[]>

/** 查询最近的 Trace ID 列表 */
export function getTraceIds(zipkinUrl: string): Promise<string[]>

/** 计算 Trace 的总耗时与服务依赖图 */
export function summarizeTrace(spans: SpanData[]): TraceSummary
