/** `scripts/caesura-cloud-runtime.mjs` 的声明：集大成运行时（组合 facade/mesh-registry/gateway-route/load-balancer/game-adapter）。 */

/** 注入的发现源应返回此形状（与 spring-mesh-registry 的聚合视图一致）。 */
export interface RuntimeInstance {
  id: string
  name: string
  address: string
  port: number
  healthy?: boolean
  /** KI-491：灰度/加权元数据（canary/version/weight 等），须保真以驱动灰度决策与 weight 策略。 */
  metadata?: Record<string, unknown>
  securePort?: { enabled?: boolean }
}

export interface RuntimeTransportTarget {
  url: string
  serviceName: string
  instanceId: string
  host: string
  port: number
}

export interface RuntimeOptions {
  gameId?: string
  gameName?: string
  gameAddress?: string
  gamePort?: number
  gameHealth?: () => any
  sources?: Record<string, () => Promise<RuntimeInstance[]> | RuntimeInstance[]>
  routesFile?: string
  routesWatchInterval?: number
  transport?: (t: RuntimeTransportTarget, path: string, init?: any) => Promise<any>
  bus?: { publish(event: string, ...args: unknown[]): boolean }
  cloud?: any
  gateway?: any
  tracer?: any
  breakerOpts?: { failureThreshold?: number; cooldownMs?: number; halfOpenMax?: number; windowSize?: number }
  /** KI-487：自定义 filter handler / 覆盖内置 CircuitBreaker|Retry|RateLimit */
  filterHandlers?: Record<string, (args: any, ctx: any, next: () => Promise<any>) => Promise<any>>
  retryBackoff?: (ms: number) => Promise<any>
  filterNow?: () => number
  /** KI-491：负载均衡策略，round-robin（缺省）/ random / weight（按 metadata.weight）。 */
  lbStrategy?: 'round-robin' | 'random' | 'weight'
  /** KI-491：灰度/金丝雀路由。true 用缺省决策器；对象逐项注入阈值/亲和键/字段名/selector/rand；不配则不建。 */
  gray?: boolean | {
    stickyHeader?: string
    grayField?: string
    canaryValue?: string | number | boolean
    weightField?: string
    salt?: string
    canaryPercent?: number
    selector?: (ctx: { key: string; salt?: string }) => number
    rand?: () => number
  }
}

/** KI-491：一次灰度决策的可观测回传。 */
export interface GrayCallInfo {
  lane: 'canary' | 'primary' | null
  fallback: boolean
  reason?: string
  key: string
  bucket: number
  canaryPercent: number
}

/** 创建一只集大成运行时。 */
export function createCloudRuntime(opts?: RuntimeOptions): {
  cloud: any
  mesh: { registerSource(name: string, fn: () => any): string; aggregate(): Promise<Map<string, any[]>>; discover(name: string): Promise<any[]> }
  routes: { add(row: unknown): any; list(): any[]; size(): number; clear(): void; remove(id: string): boolean; get(id: string): any }
  game: { start(): Promise<any>; stop(): Promise<any>; reportHealth(): Promise<any>; getConfig(k: string): any; status(): Promise<any>; self(): any }
  filters: { handlers: Record<string, Function>; stats(): any; reset(): void }
  gray: any
  loadBalancerFor(serviceName: string): Promise<any>
  bootstrap(): Promise<{ started: any }>
  call(serviceName: string, path: string, init?: any): Promise<{ ok: boolean; target?: any; data?: any; route?: any; span?: any; gray?: GrayCallInfo; filterStats?: any; reason?: string; error?: unknown }>
  shutdown(): Promise<{ stopped: any }>
  status(): Promise<any>
}
