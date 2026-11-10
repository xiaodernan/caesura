/** `scripts/spring-sleuth-tracer.mjs` 的声明：Spring Cloud Sleuth 进程内 tracer（Node.js 侧）。 */

export interface TracerOptions {
  serviceName?: string
  sampler?: (name: string) => boolean
}

export interface SpanContext {
  traceId: string
  id: string
  parentId: string | null
  name: string
  kind: string
  timestamp: number
  duration: number
  localEndpoint?: { serviceName: string }
  remoteEndpoint?: { serviceName: string }
  tags: Record<string, string>
  annotations: unknown[]
  debug: boolean
  shared: boolean
}

/** 创建一只进程内 tracer。 */
export function createTracer(opts?: TracerOptions): {
  startSpan(name: string, parent?: SpanContext | null): SpanContext
  inject(span: SpanContext): string
  extract(headers: Record<string, unknown>): { traceId: string; parentId: string } | null
  finish(span: SpanContext, opts?: { timestamp?: number; remoteEndpoint?: { serviceName: string }; tags?: Record<string, string> }): SpanContext
  spans(): SpanContext[]
  isSampled(name: string): boolean
}
