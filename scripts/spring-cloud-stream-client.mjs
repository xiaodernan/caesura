/**
 * scripts/spring-cloud-stream-client.mjs —— Spring Cloud Stream 消息驱动微服务客户端（Node.js 侧）。
 *
 * <p>提供 binder 抽象（默认内存实现；transport 仅作标签，可注入 HTTP/Kafka/Rabbit 适配器），
 * 把「发布/订阅」收口成声明式 producer / consumer 绑定。所有业务判定仍由 Node 侧负责；
 * Spring 家族只负责编排/重试/报告。</p>
 *
 * <p>用法（CLI 仅作探针）：
 *   node scripts/spring-cloud-stream-client.mjs [channel] [json-message]
 *
 * <p>退出码：0 = 成功；2 = 参数不对。</p>
 */

/** 默认 binder 传输类型 */
export const DEFAULT_BINDER = 'memory'

/**
 * 创建一个 binder。
 * @param {{ transport?: string, onEvent?: (e: object) => void, onError?: (err: Error, env: object) => void }} [opts]
 * @returns {{ transport: string, subscribe: (ch: string, h: Function) => (() => void), publish: (ch: string, m: unknown) => Promise<{channel:string, delivered:number, errors:number}>, channels: () => string[] }}
 */
export function createBinder(opts = {}) {
  const transport = opts.transport ?? DEFAULT_BINDER
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}
  const onError = typeof opts.onError === 'function' ? opts.onError : null
  /** @type {Map<string, Set<Function>>} */
  const subscribers = new Map()

  function subscribe(channel, handler) {
    if (typeof channel !== 'string' || channel.length === 0) throw new Error('channel 必须是非空字符串')
    if (typeof handler !== 'function') throw new Error('handler 必须是函数')
    if (!subscribers.has(channel)) subscribers.set(channel, new Set())
    const set = subscribers.get(channel)
    set.add(handler)
    onEvent({ type: 'subscribe', channel })
    return () => {
      set.delete(handler)
      onEvent({ type: 'unsubscribe', channel })
    }
  }

  async function publish(channel, message) {
    if (typeof channel !== 'string' || channel.length === 0) throw new Error('channel 必须是非空字符串')
    const set = subscribers.get(channel) ?? new Set()
    const envelope = { channel, message, ts: Date.now() }
    let errors = 0
    for (const h of [...set]) {
      try {
        await h(envelope)
      } catch (e) {
        errors += 1
        if (onError) onError(e, envelope)
      }
    }
    onEvent({ type: 'publish', channel, delivered: set.size })
    return { channel, delivered: set.size, errors }
  }

  return {
    transport,
    subscribe,
    publish,
    channels: () => [...subscribers.keys()],
  }
}

/**
 * 声明式流客户端：把 binder 收口成 producer / consumer 绑定。
 * @param {{ binder?: ReturnType<typeof createBinder> } & object} [opts]
 */
export function createStreamClient(opts = {}) {
  const binder = opts.binder ?? createBinder(opts)
  function bindProducer(channel) {
    return (message) => binder.publish(channel, message)
  }
  function bindConsumer(channel, handler) {
    return binder.subscribe(channel, handler)
  }
  return {
    binder,
    publish: binder.publish,
    subscribe: binder.subscribe,
    bindProducer,
    bindConsumer,
    channels: binder.channels,
  }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const channel = process.argv[2] ?? 'caesura.events'
  const binder = createBinder()
  binder.subscribe(channel, (env) => console.log('RECV', JSON.stringify(env.message)))
  let msg = { hello: 'world' }
  if (process.argv[3]) {
    try { msg = JSON.parse(process.argv[3]) } catch { msg = { raw: process.argv[3] } }
  }
  binder.publish(channel, msg)
    .then((r) => { console.log('SENT', JSON.stringify(r)); process.exit(0) })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
