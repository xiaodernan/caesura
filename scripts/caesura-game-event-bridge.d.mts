/** `scripts/caesura-game-event-bridge.mjs` 的声明：游戏真 EventBus ↔ 云事件总线 桥接件（KI-489）。 */

export const DIRECTIONS: string[]

export interface EventBridgeRoute {
  from: 'game' | 'cloud'
  key: string
  type: string
}

export interface EventBridgeStats {
  forward: number
  reverse: number
  dropped: number
  handlers: number
  gameRoutes: number
  cloudRoutes: number
}

export function createGameEventBridge(opts?: {
  gameBus?: { on(k: string, fn: Function): Function; emit(k: string, p: any): void }
  cloudBus?: { onGameEvent(t: string, fn: Function): Function; publishGameEvent(t: string, p?: any): Promise<any> }
  routes?: EventBridgeRoute[]
  onEvent?: (e: object) => void
}): {
  install(): { installed: boolean; handlers: number; reason?: string }
  uninstall(): { uninstalled: boolean; removed: number }
  isInstalled(): boolean
  stats(): EventBridgeStats
  forward(key: string, payload: any): Promise<any>
  routes(): EventBridgeRoute[]
}
