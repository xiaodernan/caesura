/**
 * scripts/caesura-event-bus.mjs —— 游戏事件总线适配层（集大成 P7 扩展）。
 *
 * <p>包住 `spring-cloud-stream-client` 的 binder / StreamClient，把「发布/订阅」收口成
 * 按事件类型（type）分发的游戏事件总线：游戏侧只关心 type，payload 随意。判定权仍 Node 侧
 * （频道名、transport 由调用方注入）。</p>
 *
 * <p>用法：
 *   const bus = createGameEventBus()
 *   const off = bus.onGameEvent('game.damage', (payload) => ...)
 *   await bus.publishGameEvent('game.damage', { amount: 10 })
 * </p>
 */

import { createBinder, createStreamClient } from './spring-cloud-stream-client.mjs'

/** 默认游戏事件频道。 */
export const DEFAULT_GAME_EVENT_CHANNEL = 'caesura.game.events'

/**
 * 创建一只游戏事件总线。
 * @param {{ channel?: string, transport?: string, binder?: ReturnType<typeof createBinder> }} [opts]
 * @returns {{ channel: string, binder: ReturnType<typeof createBinder>, publishGameEvent: (type: string, payload?: unknown) => Promise<{channel:string, delivered:number, errors:number}>, onGameEvent: (type: string, handler: (payload: any, message: any) => void) => (() => void), shutdown: () => { stopped: boolean } }}
 */
export function createGameEventBus(opts = {}) {
  const channel = opts.channel ?? DEFAULT_GAME_EVENT_CHANNEL
  const binder = opts.binder ?? createBinder({ transport: opts.transport })
  const client = createStreamClient({ binder })

  /** 发布一条游戏事件（按 type 分发）。 */
  function publishGameEvent(type, payload) {
    if (typeof type !== 'string' || type.length === 0) throw new Error('event type 必须是非空字符串')
    return client.publish(channel, { type, payload: payload ?? null, ts: Date.now() })
  }

  /** 订阅某类型事件，handler 收到 (payload, message)。返回取消订阅函数。 */
  function onGameEvent(type, handler) {
    if (typeof type !== 'string' || type.length === 0) throw new Error('event type 必须是非空字符串')
    if (typeof handler !== 'function') throw new Error('handler 必须是函数')
    return client.subscribe(channel, (env) => {
      const msg = env?.message ?? env
      if (msg && msg.type === type) handler(msg.payload, msg)
    })
  }

  return {
    channel,
    binder,
    publishGameEvent,
    onGameEvent,
    shutdown() { return { stopped: true } },
  }
}
