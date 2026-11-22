/** `scripts/lib/spring-registry-core.mjs` 的声明：服务注册租约 + 客户端有界故障转移的纯内核。 */

export const INSTANCE_STATE: { readonly UP: 'UP'; readonly DOWN: 'DOWN'; readonly OUT_OF_SERVICE: 'OUT_OF_SERVICE' }
export type InstanceState = 'UP' | 'DOWN' | 'OUT_OF_SERVICE'

export interface InstanceSpec {
  id: string
  service: string
  host?: string
  port?: number
  weight?: number
  state?: InstanceState
  at?: number
}

export interface Instance {
  id: string
  service: string
  host: string
  port: number
  weight: number
  state: InstanceState
  lastHeartbeat: number
  evictedAt: number | null
}

export interface Registry {
  ttl: number
  now: () => number
  register: (spec: InstanceSpec) => Instance
  heartbeat: (id: string, at?: number) => boolean
  deregister: (id: string) => boolean
  setState: (id: string, state: InstanceState) => boolean
  prune: (at?: number) => string[]
  lookup: (service: string, at?: number) => Instance[]
  snapshot: (at?: number) => {
    ttl: number
    at: number
    services: string[]
    up: number
    down: number
    outOfService: number
    instances: Instance[]
  }
  size: () => number
}

export function createRegistry(opts?: { leaseTtlMs?: number; now?: () => number }): Registry

export interface Attempt { id: string; ok: boolean }

export function callWithFailover<T = unknown>(opts: {
  registry: Registry
  service: string
  call: (inst: Instance) => { ok: boolean; result?: T }
  maxAttempts?: number
  at?: number
}): { ok: boolean; reason?: 'no-instance' | 'all-attempts-failed'; attempts: Attempt[]; result?: T; instance?: Instance }

export function roundRobinPicker(): (instances: Instance[]) => Instance | null
