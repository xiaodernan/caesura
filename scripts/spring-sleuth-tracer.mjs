/**
 * scripts/spring-sleuth-tracer.mjs —— Spring Cloud Sleuth 进程内 tracer（Node.js 侧）。
 *
 * <p>家族既有 `spring-sleuth-trace.mjs` 只「查」Zipkin 后端（query-only），进程内不会自己造 span。
 * 本件补上：在 Node 侧真正开始/注入/提取/结束 span，并产出与 `spring-sleuth-trace` 的 SpanData 同形状的 span，
 * 使其 `summarizeTrace` 可直接消费。判词仍由 Node 侧持有（决策原则①）：采样/标签由调用方决定。</p>
 *
 * <p>W3C traceparent：`00-{traceId(32hex)}-{spanId(16hex)}-01`。</p>
 */

function hex(n) {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

function traceId() { return hex(32) }
function spanId() { return hex(16) }

/**
 * 创建一只进程内 tracer。
 * @param {object} [opts] { serviceName?: string, sampler?: (name:string)=>boolean }
 */
export function createTracer(opts = {}) {
  const serviceName = opts.serviceName ?? 'caesura'
  const sampler = opts.sampler ?? (() => true)
  /** @type {Array<any>} 已结束的 span 收集器（供 summarizeTrace 消费） */
  const collected = []

  function nowMs() { return Date.now() }

  /**
   * 开始一只 span；传 parent 则继承 traceId 并设 parentId。
   * @param {string} name span 名（通常为操作名）
   * @param {object} [parent] 父 span（须含 traceId 与 id）
   */
  function startSpan(name, parent) {
    const tid = parent?.traceId ?? traceId()
    const span = {
      traceId: tid,
      id: spanId(),
      parentId: parent?.id ?? null,
      name,
      kind: 'CLIENT',
      timestamp: nowMs(),
      duration: 0,
      localEndpoint: { serviceName },
      remoteEndpoint: undefined,
      tags: {},
      annotations: [],
      debug: false,
      shared: false,
    }
    return span
  }

  /** 把 span 注入为 W3C traceparent 头字符串。 */
  function inject(span) {
    return `00-${span.traceId}-${span.id}-01`
  }

  /** 从请求头里提取 traceparent，返回 { traceId, parentId } 或 null。 */
  function extract(headers) {
    const tp = headers?.traceparent ?? headers?.['Traceparent'] ?? headers?.['trace-parent']
    if (typeof tp !== 'string') return null
    const m = tp.match(/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i)
    if (!m) return null
    return { traceId: m[2], parentId: m[3] }
  }

  /**
   * 结束一只 span：计算 duration，可选补 remoteEndpoint/标签，收集进收集器。
   * @returns {object} 结束后的 span（形状同 spring-sleuth-trace 的 SpanData）
   */
  function finish(span, opts = {}) {
    span.duration = (opts.timestamp ?? nowMs()) - span.timestamp
    if (opts.remoteEndpoint) span.remoteEndpoint = opts.remoteEndpoint
    if (opts.tags) span.tags = { ...span.tags, ...opts.tags }
    collected.push(span)
    return span
  }

  /** 取出已收集的 span 列表。 */
  function spans() { return [...collected] }

  /** 是否采样该操作。 */
  function isSampled(name) { return sampler(name) }

  return { startSpan, inject, extract, finish, spans, isSampled }
}
