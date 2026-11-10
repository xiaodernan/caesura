/** `scripts/caesura-cloud-runtime.mjs` 的声明：集大成运行时（组合 facade/mesh-registry/gateway-route/load-balancer/game-adapter）。 */

/** 注入的发现源应返回此形状（与 spring-mesh-registry 的聚合视图一致）。 */
export interface RuntimeInstance {
  id: string
  name: string
  address: string
  port: number
  healthy?: boolean
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
}

/** 创建一只集大成运行时。 */
export function createCloudRuntime(opts?: RuntimeOptions): {
  cloud: any
  mesh: { registerSource(name: string, fn: () => any): string; aggregate(): Promise<Map<string, any[]>>; discover(name: string): Promise<any[]> }
  routes: { add(row: unknown): any; list(): any[]; size(): number; clear(): void; remove(id: string): boolean; get(id: string): any }
  game: { start(): Promise<any>; stop(): Promise<any>; reportHealth(): Promise<any>; getConfig(k: string): any; status(): Promise<any>; self(): any }
  filters: { handlers: Record<string, Function>; stats(): any; reset(): void }
  loadBalancerFor(serviceName: string): Promise<any>
  bootstrap(): Promise<{ started: any }>
  call(serviceName: string, path: string, init?: any): Promise<{ ok: boolean; target?: any; data?: any; route?: any; span?: any; filterStats?: any; reason?: string; error?: unknown }>
  shutdown(): Promise<{ stopped: any }>
  status(): Promise<any>
}
