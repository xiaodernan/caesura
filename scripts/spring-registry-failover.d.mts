/** `scripts/spring-registry-failover.mjs` 的声明：注册租约 → 自动摘除 → 有界故障转移的仿真与三难。 */

export interface SimCall {
  id: string
  at: number
  candidates: string[]
  chosen: string | null
  ok: boolean
  reason: string | null
  attempts: string[]
}

export interface SimRun {
  calls: SimCall[]
  snapshot: {
    ttl: number
    at: number
    services: string[]
    up: number
    down: number
    outOfService: number
    instances: Array<{
      id: string
      service: string
      host: string
      port: number
      weight: number
      state: 'UP' | 'DOWN' | 'OUT_OF_SERVICE'
      lastHeartbeat: number
      evictedAt: number | null
    }>
  }
  ttl: number
  mode: { picker: 'rr' | 'random'; pruneOnLookup: boolean; retry: 'bounded' | 'unbounded'; rigged: boolean }
}

export interface Trilemma { leaseAccurate: boolean; failoverBounded: boolean; deterministic: boolean }

export function simulate(opts?: {
  picker?: 'rr' | 'random'
  pruneOnLookup?: boolean
  retry?: 'bounded' | 'unbounded'
  rigged?: boolean
}): SimRun

export function study(opts?: Parameters<typeof simulate>[0]): { holds: Trilemma; run: SimRun; sound: boolean }

export function tamperStudy(): {
  rows: Array<{ case: string; expect: string; broken: string[]; exact: boolean }>
  falsifiable: boolean
}

export function riggedStudy(): { holds: Trilemma; vacuous: boolean; collapsed: boolean; distinguishable: boolean }
