/** `scripts/caesura-spring-vault.mjs` —— Spring Cloud Vault 三策略教学件（KI-554） */

export const SPRING_VAULT_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freeStaticLease: boolean
  freeLeaseRefresh: boolean
  freeRotation: boolean
  rigged: boolean
}>
export const SPRING_VAULT_STRATEGIES: readonly string[]
export const SPRING_VAULT_SCENARIOS: readonly string[]

export interface K8sStaticInstance {
  protocol: 'K8sStatic'
  invoke(reqs: any[]): { processed: number }
  staticLease: boolean
  leaseRefresh: boolean
  rotation: boolean
}
export interface AppRoleLeaseInstance {
  protocol: 'AppRoleLease'
  invoke(reqs: any[]): { processed: number; leaseTtlSeconds: number }
  staticLease: boolean
  leaseRefresh: boolean
  rotation: boolean
}
export interface DynamicRotationInstance {
  protocol: 'DynamicRotation'
  invoke(reqs: any[]): { processed: number; rotationCount: number }
  staticLease: boolean
  leaseRefresh: boolean
  rotation: boolean
}
export function createK8sStatic(opts?: { freeStaticLease?: boolean }): K8sStaticInstance
export function createAppRoleLease(opts?: { freeLeaseRefresh?: boolean }): AppRoleLeaseInstance
export function createDynamicRotation(opts?: { freeRotation?: boolean }): DynamicRotationInstance

export interface VaultCell {
  id: string
  messages: number
  processed: number
  staticLease: boolean
  leaseRefresh: boolean
  rotation: boolean
  fault: string
}
export interface VaultRow {
  protocol: 'K8sStatic' | 'AppRoleLease' | 'DynamicRotation'
  scenarios: VaultCell[]
  trilemma: { staticLease: boolean; leaseRefresh: boolean; rotation: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface VaultCausalLocks {
  vaultSealCausallyUnerasable: boolean
  leaseExpiryCausallyUnerasable: boolean
  dynamicSecretCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface SpringVaultStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freeStaticLease: boolean
    freeLeaseRefresh: boolean
    freeRotation: boolean
  }
  rows: VaultRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    rigged_pkg: boolean
    rigged_pkg_flags?: Record<string, boolean>
    riggedConvergenceCollapsed: boolean
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: VaultCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { k8sStaticProcessed: number; expected: number }
      laneB: { appRoleLeaseProcessed: number; leaseTtlSeconds: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        k8sNoUnseal: { holds: boolean; reason: string }
        leaseExpiryCascade: { holds: boolean; reason: string }
        dynamicRpsLost: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function springVaultStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freeStaticLease?: boolean
  freeLeaseRefresh?: boolean
  freeRotation?: boolean
  rigged?: boolean
}): SpringVaultStudy
export const compareSpringVault: typeof springVaultStudy
export interface SpringVaultSnapshot extends Omit<SpringVaultStudy, 'causalLocks'> {
  causalLocks?: VaultCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function springVaultSnapshot(study: SpringVaultStudy | null | Record<string, never>): SpringVaultSnapshot | null
export function verifySpringVaultSoundness(input: {
  events?: Array<{ id: string; op: string; path: string; ttl: number }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): SpringVaultStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): VaultCausalLocks
export function createSpringVaultEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
