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
  /** KI-496：LSM 风格存储引擎。true 用缺省阈值建一只；对象逐项注入阈值，或直接塞一只现成 store。 */
  store?: boolean | Record<string, any> | { put(k: any, v: any): any; get(k: any): any; stats?(): any; snapshot?(): any }
  storeNow?: () => number
  /** KI-497：OS/硬件适配对照包。true 用缺省规模建；对象逐项注入规模/阈值（poolAccesses/counterCount/jumpStride/...）。 */
  hw?: boolean | Record<string, any>
  hwNow?: () => number
  /** KI-499：一致性哈希环 + 缓存分片。true 用缺省节点集建；对象逐项注入（nodes/virtualNodes/hashFn/weightOf/salt/remappingKeys/probeAddNodes），或直接塞一只现成 ring。 */
  hashRing?: boolean | Record<string, any> | { lookup(k: any): any; [k: string]: any }
  hashNow?: () => number
  /** KI-500：分片缓存客户端。true 用缺省三片建；对象逐项注入（shards/ring/cacheFactory/cacheOpts/virtualNodes/hashFn/salt/retentionKeys/retentionNextShards），或直接塞一只现成实例。 */
  shardedCache?: boolean | Record<string, any> | { shardOf(k: any): any; [k: string]: any }
  cacheNow?: () => number
  /** KI-501：缓存防护三件套（击穿/穿透/雪崩）。true 用缺省规模；对象逐项注入（concurrency/keys/ttlMs/beta/jitterRatio/buckets/rounds/queryKeys/...），或直接塞一只现成 study（带 stampede/penetration/avalanche）。 */
  cacheGuard?: boolean | Record<string, any> | { stampede: any; penetration: any; avalanche: any; [k: string]: any }
  guardNow?: () => number
  /** KI-502：网关限流算法族 + Redis 原子令牌桶。true 用缺省规模；对象逐项注入（limit/windowMs/capacity/
   * refillPerSec/leakPerSec/arrivals/concurrency/redisCapacity/redisRefillPerSec/backend/yield/...），或直接塞
   * 一只现成 study（带 algorithms/redis 两块）。 */
  rateLimit?: boolean | Record<string, any> | { algorithms: any; redis: any; [k: string]: any }
  rlNow?: () => number
  /** KI-503：服务故障检测器（φ 累积风险 + SWIM 成员协议 + 健康视图缓存）。true 用缺省规模；
   * 对象逐项注入（threshold/fixedTimeoutMs/windowSize/minStdDeviationMs/spikeCount/spikeGapMs/
   * stableCount/faultCapMs/stepMs/probeIntervalMs/suspicionMult/retransmitLimit/healthTtlMs/...），
   * 或直接塞一只现成 study（带 comparison/swim/health 三块）。 */
  failureDetector?: boolean | Record<string, any> | { comparison: any; swim: any; health: any; [k: string]: any }
  fdNow?: () => number
  /** KI-504：B+ 树索引引擎 + 与 LSM 三笔账诚实对照。true 用缺省规模；
   * 对象逐项注入（keyCount/order/leafCapacity/overwriteEvery/probeEvery/rangeFractions/rangeWidth/
   * extraMissKeys/lsmMemtableMax/lsmLevelMultiplier/lsmIndexEvery/lsmBitsPerKey/lcgSeed/heightLadder/...），
   * 或直接塞一只现成 study（带 comparison/heightLadder/verdict 三块）。 */
  bplusIndex?: boolean | Record<string, any> | { comparison: any; heightLadder: any[]; verdict: any; [k: string]: any }
  bpNow?: () => number
  /** KI-505：事务与并发控制（MVCC 多版本可见性 + 五档隔离异常矩阵 + 行锁 2PL 死锁检测）。true 用缺省规模；
   * 对象逐项注入（now/schedules/initialA/initialB/dirtyWrite/updateA1/updateA2/victim/gcVersions/
   * gcLongWaterMark/gcCleanWaterMark/...），或直接塞一只现成 study（带 comparison/deadlock/gc/verdict 四块）。 */
  mvccTxn?: boolean | Record<string, any> | { comparison: any; deadlock: any; gc: any; verdict: any; [k: string]: any }
  txnNow?: () => number
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
  /** KI-496：LSM 存储引擎实例（未配 opts.store 时为 null）；put/get/flush/compact/stats/snapshot。 */
  store: { put(k: any, v: any): any; get(k: any): any; del?(k: any): any; flush?(): any; compact?(level?: number): any; stats(): any; snapshot?(): any; [k: string]: any } | null
  /** KI-497：OS/硬件适配对照包（未配 opts.hw 时为 null）；snapshot() 现跑三件确定性对照。 */
  hw: { snapshot(): any } | null
  /** KI-499：一致性哈希环实例（未配 opts.hashRing 时为 null）；addNode/removeNode/lookup/distribution/snapshot。 */
  hashRing: { addNode(id: any): any; removeNode(id: any): any; hasNode(id: any): boolean; nodeIds(): string[]; lookup(k: any): any; distribution(keys: any[]): any; snapshot(opts?: { ring?: boolean }): any; [k: string]: any } | null
  /** KI-499：造一只缓存分片路由（同 key 恒落同分片/同槽）；无环时为 null，不改调用路径。 */
  shardRouter: (() => any) | null
  /** KI-500：分片缓存客户端实例（未配 opts.shardedCache 时为 null）；shardOf/get/set/load/remapOn/stats/snapshot。 */
  shardedCache: { shardOf(k: any): string | null; get(k: any): any; set(k: any, v: any, ttlMs?: number): boolean; load(k: any, loader: (...a: any[]) => any, ttlMs?: number): Promise<any>; remapOn(shards: any[], keys?: any[]): any; stats(): any; snapshot(opts?: any): any; [k: string]: any } | null
  /** KI-501：缓存防护三件套汇总的现算入口（未配 opts.cacheGuard 时为 null）；调一次真跑击穿/穿透/雪崩对照。 */
  runCacheGuardStudy: (() => Promise<any>) | null
  /** KI-502：限流算法族 + Redis 原子性汇总的现算入口（未配 opts.rateLimit 时为 null）。 */
  runRateLimiterStudy: (() => Promise<any>) | null
  /** KI-503：服务故障检测器汇总的现算入口（未配 opts.failureDetector 时为 null）；真跑固定 vs φ 对照 + SWIM + 健康视图。 */
  runFailureDetectorStudy: (() => Promise<any>) | null
  /** KI-504：B+ 树索引引擎 + LSM 三笔账汇总的现算入口（未配 opts.bplusIndex 时为 null）；真跑点查比较数 / 范围叶链顺序扫 / 写放大对照。 */
  runBplusStudy: (() => Promise<any>) | null
  /** KI-505：事务并发控制汇总的现算入口（未配 opts.mvccTxn 时为 null）；真跑五档隔离异常矩阵 + 死锁环检测 + gc 水位对照。 */
  runMvccTxnStudy: (() => Promise<any>) | null
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
