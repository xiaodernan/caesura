/** `scripts/caesura-game-bootstrap.mjs` 的声明：游戏生命周期 ↔ 云入口 桥接件（集大成最后一厘米）。 */

export interface GameCloudBridgeOptions {
  gameId?: string
  gameName?: string
  gameAddress?: string
  gamePort?: number
  gameHealth?: () => any
  sources?: Record<string, () => Promise<any[]> | any[]>
  gateway?: any
  tracer?: any
  breakerOpts?: { failureThreshold?: number; cooldownMs?: number; halfOpenMax?: number; windowSize?: number }
  transport?: (t: any, path: string, init?: any) => Promise<any>
  cloud?: any
  bus?: { publish(event: string, ...args: unknown[]): boolean }
  bootEvents?: string[]
  shutdownEvents?: string[]
}

/** 创建一只「游戏生命周期 ↔ 云入口」桥。 */
export function createGameCloudBridge(opts?: GameCloudBridgeOptions): {
  gc: any
  onBoot: () => Promise<any>
  onShutdown: () => Promise<any>
  install(game: any): { installed: boolean; handlers: { onBoot: () => Promise<any>; onShutdown: () => Promise<any> } }
  start(): Promise<any>
  stop(): Promise<any>
  status(): Promise<any>
}
