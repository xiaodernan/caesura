/** `scripts/spring-family-mesh-e2e.mjs` 的声明：集大成家族端到端证据（headless 可证）。 */

export function runMeshE2E(opts?: any): {
  gc: any
  k8s: any
  tracer: any
  run(): Promise<{
    started: any
    callRes: any
    status: any
    stopped: any
    spans: any[]
    services: string[]
    /** KI-488①：事件总线收到的游戏生命周期事件 */
    events: Array<{ type: string; payload: any }>
    /** KI-488②：调用前鉴权守卫的判定（opts.bearer===null 时为 null） */
    auth: { ok: boolean; allowed: boolean; sub?: string; scope?: string; requiredScope: string; reason?: string } | null
    /** KI-488③：filter 链计数（retries/rateLimited/passed 等） */
    filterStats: any
    /** KI-489：注入 gameBus 时的桥接证据（installed/stats/crossed 过桥载荷） */
    gameBridge: any
    /** KI-489：shutdown 时退桥读数 */
    bridgeOff: any
    /** KI-491：每次灰度探针的判词（key/lane/fallback/canaryPercent/ok/reason/instanceId） */
    grayProbes: Array<{ key?: string; lane?: string; fallback: boolean; canaryPercent?: number; ok: boolean; reason?: string; instanceId?: string }>
    /** KI-491：灰度决策器累计计数（decisions/canary/primary/fallback/noInstance/droppedUnhealthy），未配 gray 为 null */
    grayStats: { decisions: number; canary: number; primary: number; fallback: number; noInstance: number; droppedUnhealthy: number } | null
    /** KI-493：缓存探针（两次同令牌在线校验的 source/cacheHit/ok 与命中读数），未配 cacheProbe 为 null */
    cacheProbe: { firstSource: string; secondSource: string; secondCacheHit: boolean; firstOk: boolean; secondOk: boolean; stats: any } | null
    /** KI-493：鉴权缓存 stats()，未配 authCache 为 null */
    authCacheStats: any | null
    /** KI-494：计网算法快照（aimd/cubic/rto/window/tickets/http），未配 net 为 null */
    netSnapshot: { observes: number; aimd: any; cubic: any; rto: any; window: any; tickets: any; http: any } | null
    /** KI-499：一致性哈希环快照（ring/grow/distribution），未配 hashRing 为 null */
    hashRingSnapshot: { ring: any; grow: { consistentRate: number; moduloRate: number; theoreticalRate: number; savedRate: number; delta: number }; distribution: any; builtAt: number } | null
    /** KI-500：分片缓存快照（cache/retention），未配 shardedCache 为 null */
    shardedCacheSnapshot: { cache: any; retention: { delta: number; consistentRetention: number; moduloRetention: number; theoretical: number; savedRate: number }; builtAt: number } | null
    /** KI-501：缓存防护三件套快照（stampede/penetration/avalanche），未配 cacheGuard 为 null */
    cacheGuardSnapshot: { stampede: any; penetration: any; avalanche: any; builtAt: number } | null
  }>
}
