/** `scripts/spring-cloud-stream-client.mjs` 的声明：Spring Cloud Stream 消息驱动微服务客户端（Node.js 侧）。 */

/** 默认 binder 传输类型 */
export const DEFAULT_BINDER: string

/** 创建一个 binder（默认内存实现）。 */
export function createBinder(opts?: {
  transport?: string
  onEvent?: (e: object) => void
  onError?: (err: Error, env: object) => void
}): {
  transport: string
  subscribe(channel: string, handler: (env: { channel: string; message: unknown; ts: number }) => void | Promise<void>): () => void
  publish(channel: string, message: unknown): Promise<{ channel: string; delivered: number; errors: number }>
  channels(): string[]
}

/** 声明式流客户端：把 binder 收口成 producer / consumer 绑定。 */
export function createStreamClient(opts?: { binder?: ReturnType<typeof createBinder> } & object): {
  binder: ReturnType<typeof createBinder>
  publish(channel: string, message: unknown): Promise<{ channel: string; delivered: number; errors: number }>
  subscribe(channel: string, handler: (env: { channel: string; message: unknown; ts: number }) => void | Promise<void>): () => void
  bindProducer(channel: string): (message: unknown) => Promise<{ channel: string; delivered: number; errors: number }>
  bindConsumer(channel: string, handler: (env: { channel: string; message: unknown; ts: number }) => void | Promise<void>): () => void
  channels(): string[]
}
