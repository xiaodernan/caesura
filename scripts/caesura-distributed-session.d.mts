/** `scripts/caesura-distributed-session.mjs` 的声明：分布式会话三策略诚实权衡教学件（KI-535）。 */

export const SESSION_DEFAULTS: Readonly<{
  seed: number
  sessions: number
  ttlMs: number
  perfectMirror: boolean
  unlimitedTtl: boolean
  skipRevocationCheck: boolean
  rigged: boolean
}>
export const SESSION_STRATEGIES: readonly string[]
export const SESSION_SCENARIOS: readonly string[]

export interface StickySessionStoreInstance {
  protocol: 'StickySession'
  nodes: number[]
  read(node: number, id: string): { id: string; counter: number; origin?: string; revoked?: boolean } | null
  write(node: number, s: { id: string; counter: number; owner?: number; revoked?: boolean }): { ok: boolean; node: number }
  revoke(node: number, id: string): { ok: boolean; deleted: boolean; scope: string }
  crashNode(node: number): { ok: boolean; node: number }
  coherence(): boolean
  footprint(): number
}
export interface JwtStatelessGuardInstance {
  protocol: 'JwtStateless'
  issue(s: { id: string; owner: number; counter: number }, now: number): { ok: boolean; token: string }
  verify(token: string, now?: number): { ok: boolean; id?: string; reason?: string }
  revoke(token: string): { ok: boolean; scope: string; reason?: string }
  coherence(): boolean
  stateless(): boolean
  footprint(): number
}
export interface RedisSessionStoreInstance {
  protocol: 'RedisSessionStore'
  store: Map<string, { id: string; owner: number; counter: number; revoked?: boolean }>
  set(s: { id: string; owner: number; counter: number; revoked?: boolean }): { ok: boolean }
  read(id: string): { id: string; owner: number; counter: number; revoked?: boolean } | null
  revoke(id: string): { ok: boolean; scope: string }
  delNode(localNode: number): { ok: boolean; surviving: number }
  coherence(): boolean
  clusterRevoked(): boolean
  footprint(): number
}

export function createStickySessionStore(opts?: { perfectMirror?: boolean; unlimitedTtl?: boolean }): StickySessionStoreInstance
export function createJwtStatelessGuard(opts?: { skipRevocationCheck?: boolean; unlimitedTtl?: boolean; ttlMs?: number }): JwtStatelessGuardInstance
export function createRedisSessionStore(opts?: { perfectMirror?: boolean }): RedisSessionStoreInstance

export interface SessionCell {
  id: string
  sessions: number
  writes: number
  reads: number
  revokedCount: number
  sharedCoherence: boolean
  instantRevocation: boolean
  zeroInfra: boolean
  fault: string
}
export interface SessionRow {
  protocol: 'StickySession' | 'JwtStateless' | 'RedisSessionStore'
  scenarios: SessionCell[]
  trilemma: { sharedCoherence: boolean; instantRevocation: boolean; zeroInfra: boolean }
  metrics: { sessionWrites: number; readableSessions: number; revokedCells: number }
}
export interface SessionCausalLocks {
  stickySingleNodeCausallyUnerasable: boolean
  jwtNoInstantRevokeCausallyUnerasable: boolean
  redisColdStartCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  revocationProbe: number
}
export interface SessionStudy {
  builtAt: number
  config: {
    seed: number
    sessions: number
    ttlMs: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    perfectMirror: boolean
    unlimitedTtl: boolean
    skipRevocationCheck: boolean
  }
  rows: SessionRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    stickyFailsOverLoss: boolean
    jwtNoInstantRevoke: boolean
    redisPaysInfra: boolean
    redisCoherent: boolean
    redisInstantRevoke: boolean
    rigged_pkg: boolean
    perfectMirrorErasesStickyIsolation: boolean
    unlimitedTtlKeepsJwtTokenForever: boolean
    skipRevocationRevokesJwt: boolean
    riggedConvergenceCollapsed: boolean
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: SessionCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    coherence: {
      laneA: { clean: number; redisReadable: number; jwtVerified: number; stickyOwnerReadable: number }
      laneB: { revoked: number; jwtStillValid: boolean }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        corruptedSession: { holds: boolean; reason: string }
        silentRevoke: { holds: boolean; reason: string }
        emptyStream: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function distributedSessionStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  sessions?: number
  ttlMs?: number
  scenarios?: readonly string[]
  perfectMirror?: boolean
  unlimitedTtl?: boolean
  skipRevocationCheck?: boolean
  rigged?: boolean
}): SessionStudy
export const compareDistributedSession: typeof distributedSessionStudy

export interface SessionSnapshot extends Omit<SessionStudy, 'causalLocks'> {
  causalLocks?: SessionCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function distributedSessionSnapshot(study: SessionStudy | null | Record<string, never>): SessionSnapshot | null

export function verifySessionCoherence(input: {
  events?: Array<{ id: string; owner: number; counter: number; revoked?: boolean }>
  seed?: number
  now?: number | (() => number)
}, opts?: { seed?: number }): SessionStudy['crosscheck']['coherence']

export function verifyCausalLocks(cfg?: { seed?: number }): SessionCausalLocks

export function createSessionEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
