/** `scripts/caesura-game-cloud.mjs` 的声明：游戏侧「开箱即用」云入口（集大成最终收口）。 */

export interface GameCloudOptions {
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
  eventsChannel?: string
  eventsTransport?: string
  eventBinder?: any
  requiredScopes?: string[]
  gameBridgeRoutes?: Array<{ from: 'game' | 'cloud'; key: string; type: string }>
  onBridgeEvent?: (e: object) => void
  /** KI-491：LB 策略（round-robin/random/weight）与灰度/金丝雀决策器（true 或注入对象）。 */
  lbStrategy?: 'round-robin' | 'random' | 'weight'
  gray?: boolean | Record<string, any>
  /** KI-493：鉴权 introspection 缓存。true 用默认预算建一只；也可直接塞一只现成 cache。 */
  authCache?: boolean | { get(k: string): any; set(k: string, v: any, ttlMs?: number): any; stats?(): any }
  authCacheTtlMs?: number
  authCacheMaxEntries?: number
  authCacheMaxBytes?: number
  authNegativeTtlMs?: number
  /** KI-494：计网算法可观测包。true 用缺省阈值建一只；对象逐项注入六只状态机阈值。 */
  net?: boolean | Record<string, any>
  netNow?: () => number
}

/** 创建一只游戏侧开箱即用云。 */
export function createGameCloud(opts?: GameCloudOptions): {
  runtime: any
  proxy: any
  events: any
  auth: any
  /** KI-493：鉴权 introspection 缓存实例（未配 opts.authCache 时为 null）。 */
  authCache: any
  /** KI-494：计网算法可观测包（未配 opts.net 时为 null）；observeOutcome/snapshot。 */
  net: { observeOutcome(sig?: { ok?: boolean; rttMs?: number; retransmitted?: boolean }): any; snapshot(): any; [k: string]: any } | null
  /** KI-491：灰度/金丝雀决策器（未配 opts.gray 时为 null）。 */
  gray: any
  /** KI-489：把游戏真 EventBus（duck-typed {on,emit}）按白名单接进云事件总线。 */
  connectGameBus(gameBus: { on(k: string, fn: Function): Function; emit(k: string, p: any): void }, routes: Array<{ from: 'game' | 'cloud'; key: string; type: string }>): { installed: boolean; handlers: number; reason?: string }
  bridge(): any
  start(): Promise<any>
  call(serviceName: string, path: string, init?: any): Promise<any>
  proxyCall(serviceName: string, path: string, init?: any): Promise<any>
  shutdown(): Promise<any>
  status(): Promise<any>
}
