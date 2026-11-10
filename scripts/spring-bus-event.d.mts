/** `scripts/spring-bus-event.mjs` 的声明：Spring Cloud Bus 事件总线（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。
 */

/** 创建 Spring Cloud Bus 事件总线实例。 */
export function createBus(): {
  /** 订阅总线事件，返回取消订阅函数。 */
  subscribe: (eventName: string, listener: (...args: unknown[]) => void) => () => void
  /** 发布总线事件（同步），返回是否有监听器。 */
  publish: (eventName: string, ...args: unknown[]) => boolean
  /** 异步发布总线事件（fire-and-forget）。 */
  publishAsync: (eventName: string, ...args: unknown[]) => void
  /** 获取指定事件的监听器数量。 */
  listenerCount: (eventName: string) => number
  /** 获取所有已注册的事件名。 */
  eventNames: () => string[]
  /** 移除所有监听器（可选按事件名过滤）。 */
  removeAllListeners: (eventName?: string) => void
  /** 关闭总线，移除所有监听器。 */
  close: () => void
}

/** 默认总线实例。 */
export const defaultBus: ReturnType<typeof createBus>
