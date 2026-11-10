/** `scripts/caesura-event-bus.mjs` 的声明：游戏事件总线适配层（集大成 P7 扩展）。 */

export const DEFAULT_GAME_EVENT_CHANNEL: string

export function createGameEventBus(opts?: {
  channel?: string
  transport?: string
  binder?: any
}): {
  channel: string
  binder: any
  publishGameEvent(type: string, payload?: unknown): Promise<{ channel: string; delivered: number; errors: number }>
  onGameEvent(type: string, handler: (payload: any, message: any) => void): () => void
  shutdown(): { stopped: boolean }
}
