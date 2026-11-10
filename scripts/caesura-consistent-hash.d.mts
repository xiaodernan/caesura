/** `scripts/caesura-consistent-hash.mjs` 的声明：一致性哈希环 / 虚拟节点 / 缓存分片教学件（Node.js 侧，KI-499）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。 */

/** 缺省教学参数（判定仍由注入值定）。 */
export const HASH_DEFAULTS: Readonly<{
  virtualNodes: number
  salt: string
  slotCount: number
  maxTrackedKeys: number
}>

/** 纯 FNV-1a 32 位：确定性、无依赖；对相近短串雪崩差，仅供对照/注入。 */
export function fnv1a(str: unknown, seed?: number): number

/** 缺省环哈希：FNV-1a + 32 位雪崩终混，打散相近短串的环点成团。 */
export function ringHash(str: unknown, seed?: number): number

export type HashFn = (str: string) => number

export interface HashRingOptions {
  hashFn?: HashFn
  salt?: string
  virtualNodes?: number
  weightOf?: (nodeId: string) => number
  nodes?: string[]
}

export interface LookupResult {
  nodeId: string | null
  point: number | null
  virtualPoint: number | null
  comparisons: number
}

export interface NodeShare {
  hits: number
  ratio: number
}

export interface RingDistribution {
  total: number
  unrouted: number
  nodes: number
  perNode: Record<string, NodeShare>
  min: number
  max: number
  emptyNodes: string[]
  balanceRatio: number | null
}

export interface RingPoint {
  point: number
  nodeId: string
  vIndex: number
}

export interface RingSnapshot {
  nodes: string[]
  virtualNodes: number
  salt: string
  virtualPoints: number
  weights: Record<string, number>
  ring?: RingPoint[]
}

export interface AddNodeResult { added: boolean; virtualPoints: number }
export interface RemoveNodeResult { removed: boolean; virtualPoints: number }

/** 一只虚拟节点一致性哈希环（判定权 Node 侧，可注入哈希/虚拟节点数/权重）。 */
export interface HashRing {
  hashFn: HashFn
  salt: string
  virtualNodes: number
  addNode(id: unknown): AddNodeResult
  removeNode(id: unknown): RemoveNodeResult
  hasNode(id: unknown): boolean
  nodeIds(): string[]
  lookup(key: unknown): LookupResult
  distribution(keys: unknown[]): RingDistribution
  snapshot(opts?: { ring?: boolean }): RingSnapshot
  reset(): void
}

export function createHashRing(opts?: HashRingOptions): HashRing

export interface RemappingOptions {
  nodes?: string[]
  addNodes?: string[]
  removeNodes?: string[]
  keys?: unknown[]
  hashFn?: HashFn
  salt?: string
  virtualNodes?: number
  weightOf?: (nodeId: string) => number
}

export interface RemappingSide {
  moved: number
  total: number
  rate: number
}

/** 一致性哈希 vs 朴素取模在节点集变化时的迁移率对照证据。 */
export interface RemappingComparison {
  beforeNodes: string[]
  afterNodes: string[]
  beforeCount: number
  afterCount: number
  delta: number
  keys: number
  added: string[]
  removed: string[]
  consistent: RemappingSide
  modulo: RemappingSide
  savedRate: number
  theoreticalRate: number
  beforeVirtualPoints: number
  afterVirtualPoints: number
}

export function compareRemapping(opts?: RemappingOptions): RemappingComparison

export interface ShardRouterOptions extends HashRingOptions {
  ring?: HashRing
  shards?: string[]
  nodes?: string[]
  slotCount?: number
  maxTrackedKeys?: number
}

export interface ShardRoute {
  shard: string | null
  nodeId: string | null
  slot: number
  comparisons: number
}

export interface RemapResult {
  moved: number
  total: number
  rate: number
  from: string[]
  to: string[]
  snapshot: RingSnapshot
}

export interface ShardRouterSnapshot {
  slotCount: number
  trackedKeys: number
  nodes: string[]
  virtualPoints: number | null
}

/** 缓存分片定位器：同 key 恒落同一分片与同一槽，节点集变化时可读迁移数。 */
export interface ShardRouter {
  slotCount: number
  route(key: unknown): ShardRoute
  remapOn(nodes: unknown[], opts?: { mutate?: boolean }): RemapResult
  snapshot(): ShardRouterSnapshot
  nodes(): string[]
}

export function createShardRouter(opts?: ShardRouterOptions): ShardRouter
