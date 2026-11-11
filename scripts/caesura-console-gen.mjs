/**
 * scripts/caesura-console-gen.mjs —— 前端集大成控制台的真 E2E 数据生成器（P8 第三件，KI-495）。
 *
 * <p>「前端魅力」最怕两件事：假数据，和读不出后端在干什么。本件把 `console/` 门面的数据源头
 * 钉成**真跑 `runMeshE2E` 的多趟判词**——主链 / 灰度分池 / 韧性超时 / introspection 缓存 /
 * 计网观测各真跑一趟，汇成一份带时间戳的 `snapshot.json`。前端只渲染这份真判词，自己不做
 * 任何业务判定（判定权仍在 Node 侧，决策原则①）。</p>
 *
 * <p>可测性：`buildSnapshot({ runner })` 的 `runner` 可注入（缺省 `runMeshE2E`），单测喂一只
 * 确定性假 runner 即可断言快照形状/场景覆盖/序列有界，无需真跑五趟；CLI 才用真 runner 写盘。</p>
 *
 * CLI：
 *   node scripts/caesura-console-gen.mjs --out=console/snapshot.json
 *   npm run console:data   （package.json 里同一条）
 */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runMeshE2E } from './spring-family-mesh-e2e.mjs'
import { createLsmStore } from './caesura-lsm-store.mjs'
import { createGameCloud } from './caesura-game-cloud.mjs'
import { cacheGuardStudy } from './caesura-cache-guard.mjs'
import { rateLimiterStudy, rlSnapshot } from './caesura-rate-limiter.mjs'
import { failureDetectorStudy, fdSnapshot } from './caesura-failure-detector.mjs'
import { bplusStudy, bpSnapshot } from './caesura-bplus-tree.mjs'
import { mvccStudy, mvSnapshot } from './caesura-mvcc-txn.mjs'
import { distributedTxnStudy, dtSnapshot } from './caesura-distributed-txn.mjs'
import { raftConsensusStudy, rcSnapshot } from './caesura-raft-consensus.mjs'
import { distributedLockStudy, dlSnapshot } from './caesura-distributed-lock.mjs'
import { idGenStudy, igSnapshot } from './caesura-idgen.mjs'
import { distributedRateLimitStudy, drlSnapshot } from './caesura-distributed-ratelimit.mjs'
import { configConsistencyStudy, dccSnapshot } from './caesura-config-consistency.mjs'
import { cacheCoherencyStudy, cccSnapshot } from './caesura-cache-coherency.mjs'
import { messageDeliveryStudy, mmdSnapshot } from './caesura-message-delivery.mjs'

/** 场景 id 的固定顺序（前端按此排布，判词口径由本件拥有）。 */
export const SCENARIO_IDS = ['main', 'gray', 'resilience', 'cache', 'net']

/** 场景的中文标题（前端直接读，不在前端散落业务措辞）。 */
export const SCENARIO_TITLES = {
  main: '主链闭环',
  gray: '灰度 / 金丝雀分池',
  resilience: '韧性 filter 链',
  cache: '鉴权结果缓存',
  net: '计网可观测',
}

/**
 * 生成一份真 E2E 快照。
 * @param {object} [opts]
 * @param {(scenarioId:string)=>{run:()=>Promise<any>, gc?:any}} [opts.runner]
 *   每场景拿 id 返回 `{run,gc}` 形状的对象；缺省用真 `runMeshE2E` 按 id 配好 opts。
 * @param {() => number} [opts.now] 生成的时钟（毫秒时间戳；缺省 Date.now）
 * @returns {Promise<{schema:number, generatedAt:number, generator:string, scenarios:object[], highlights:object}>}
 */
export async function buildSnapshot(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const runner = typeof opts.runner === 'function'
    ? opts.runner
    : (id) => runMeshE2E(realScenarioOpts(id))

  const scenarios = []
  for (const id of SCENARIO_IDS) {
    const e = runner(id)
    const raw = await e.run()
    // net 场景：主链只喂了一次 ACK，曲线太短。用**同一只真实 AIMD 实例**再喂一段
    // 确定性 ACK/丢包序列，画得出「慢启动指数增 → 乘性减 → 再爬升」的锯齿，全是真算法读数。
    if (id === 'net' && e.gc?.net && opts.driveNet !== false) driveNetSeries(e.gc.net)
    scenarios.push(normalizeScenario(id, e.gc, raw))
  }

  // KI-498：五场景之外并一块「系统读数」（LSM 引擎 + OS/硬件适配），与 scenarios 平级、
  // 不扰动既有场景顺序与 highlights 口径。`systems:false` 可关（兼容旧快照/确定性单测）。
  const systems = opts.systems === false ? null : await buildSystems({
    now,
    lsmKeys: opts.lsmKeys,
    poolAccesses: opts.poolAccesses,
    layoutCount: opts.layoutCount,
    guards: opts.guards,
    guardConcurrency: opts.guardConcurrency,
    guardKeys: opts.guardKeys,
    rateLimit: opts.rateLimit,
    rlConcurrency: opts.rlConcurrency,
    rlCapacity: opts.rlCapacity,
    rlWindowMs: opts.rlWindowMs,
    failureDetector: opts.failureDetector,
    fdStableCount: opts.fdStableCount,
    fdSpikeCount: opts.fdSpikeCount,
    bplusIndex: opts.bplusIndex,
    bpKeyCount: opts.bpKeyCount,
    bpOrder: opts.bpOrder,
    bpLeafCapacity: opts.bpLeafCapacity,
    mvccTxn: opts.mvccTxn,
    mvGcVersions: opts.mvGcVersions,
    distributedTxn: opts.distributedTxn,
    dtxnRetries: opts.dtxnRetries,
    raftConsensus: opts.raftConsensus,
    rcRounds: opts.rcRounds,
    distributedLock: opts.distributedLock,
    dlockInstances: opts.dlockInstances,
    idGen: opts.idGen,
    idGenKeyCount: opts.idGenKeyCount,
    idGenTreeOrder: opts.idGenTreeOrder,
    distributedRateLimit: opts.distributedRateLimit,
    drlInstances: opts.drlInstances,
    drlShards: opts.drlShards,
    drlCapacity: opts.drlCapacity,
    configConsistency: opts.configConsistency,
    dccClients: opts.dccClients,
    dccPollIntervalMs: opts.dccPollIntervalMs,
    cacheCoherency: opts.cacheCoherency,
    cccWrites: opts.cccWrites,
    cccManyKeys: opts.cccManyKeys,
    cccBackendRttMs: opts.cccBackendRttMs,
    cccWalEnabled: opts.cccWalEnabled,
    messageDelivery: opts.messageDelivery,
    mmdMessages: opts.mmdMessages,
    mmdManyKeys: opts.mmdManyKeys,
    mmdRetryLimit: opts.mmdRetryLimit,
    mmdAckReliable: opts.mmdAckReliable,
  })

  return {
    schema: 1,
    generatedAt: now(),
    generator: 'caesura-console-gen',
    scenarios,
    highlights: deriveHighlights(scenarios),
    systems,
  }
}

/**
 * KI-498 + KI-501：真跑三维「系统读数」汇成一块独立数据（给前端「存储引擎 / 硬件适配 / 缓存防护」面板）。
 *
 * <p>与五趟 mesh E2E 判词**并列、不混算**：① LSM 引擎用 CLI benchmark 同款确定性序列
 * （写 N 个 key、每 7 个删一个、flush+compact、喂一批点查），落 flushes/compactions/
 * mergedAway/tombstonesDropped/bloomRejects/speedup/各层段数；② OS/硬件走
 * `createGameCloud({hw:true})` 装配的 `hw.snapshot()`（对象池/cache line/layout 三件对照）；
 * ③ 缓存防护走 `cacheGuardStudy`（击穿 singleflight 合并 / 穿透布隆+空值墓碑 / 雪崩 TTL 抖动削峰）；
 * ④ 网关限流走 `rateLimiterStudy`（五算法边界突发对照：固定窗口 2× vs 滑动/令牌/漏桶 ≈1，
 * Redis 原子桶原子不超发 vs 非原子 GET-SET 超发 + 跨实例共享）；
 * ⑤ 故障检测走 `failureDetectorStudy`（固定超时 vs φ 累积风险：抖动期固定超时误报多、φ 降误报但
 * 真故障检测更慢的诚实权衡 + SWIM 三态成员协议间接探测反证 + 健康视图 TTL 缓存）。
 * ⑥ B+ 树索引走 `bplusStudy`（真 B+ 树点查/叶链范围查 vs LSM 三笔账：B+ 点查/范围结构代价稳但
 * 写原地改页、LSM 顺序写适配 SSD 但读跨层/范围全量归并/compaction 重复搬运，不封全局赢家）。
 * 六者都是**真 Node 侧判词的结构计数**、可注入规模、时钟注入 ⇒ 确定性可测；本件不复核、不重算，
 * 缺哪块就落 null，前端据实降级。因击穿对照真跑并发 loader（Promise.all），本件为 async。</p>
 *
 * @param {object} [opts]
 * @param {() => number} [opts.now] 时钟（注入则 builtAt 确定性）
 * @param {boolean} [opts.guards=false] 关掉缓存防护维（兼容旧快照）
 * @param {boolean} [opts.rateLimit=false] 关掉网关限流维（兼容旧快照）
 * @param {boolean} [opts.failureDetector=false] 关掉故障检测维（兼容旧快照）
 * @param {boolean} [opts.bplusIndex=false] 关掉 B+ 树索引维（兼容旧快照）
 * @param {boolean} [opts.mvccTxn=false] 关掉事务并发控制维（兼容旧快照）
 * @param {boolean} [opts.distributedTxn=false] 关掉分布式事务维（兼容旧快照）
 * @param {boolean} [opts.raftConsensus=false] 关掉 Raft 共识维（兼容旧快照）
 * @param {boolean} [opts.distributedLock=false] 关掉分布式锁维（兼容旧快照）
 * @param {number} [opts.dlockInstances] Redlock 实例数（缺省 5）
 * @param {boolean} [opts.idGen=false] 关掉分布式 ID 维（兼容旧快照）
 * @param {number} [opts.idGenKeyCount] 真树交叉印证插入 key 数（缺省 24）
 * @param {number} [opts.idGenTreeOrder] KI-504 B+ 树阶数（缺省 8）
 * @param {boolean} [opts.distributedRateLimit=false] 关掉分布式限流维（兼容旧快照）
 * @param {number} [opts.drlInstances] Local 网关副本数（缺省 4）
 * @param {number} [opts.drlShards] Sharded 分片数（缺省 4）
 * @param {number} [opts.drlCapacity] 全局名义配额 C（缺省 8）
 * @param {boolean} [opts.configConsistency=false] 关掉配置一致性维（兼容旧快照）
 * @param {number} [opts.dccClients] 默认客户端副本数（缺省 8）
 * @param {number} [opts.dccPollIntervalMs] Polling 拉取周期 T（缺省 1000）
 * @param {boolean} [opts.cacheCoherency=false] 关掉缓存读写一致性维（兼容旧快照）
 * @param {number} [opts.cccWrites] 默认场景写次数（缺省 8）
 * @param {number} [opts.cccManyKeys] manyKeys 探针 key 规模（缺省 200）
 * @param {number} [opts.cccBackendRttMs] 写穿透后端库单次 RTT（缺省 40）
 * @param {boolean} [opts.cccWalEnabled] 仅进程内 WAL（抹不掉整机宕 durable 维）
 * @param {boolean} [opts.messageDelivery=false] 关掉消息投递语义维（兼容旧快照）
 * @param {number} [opts.mmdMessages] 默认场景消息条数（缺省 12）
 * @param {number} [opts.mmdManyKeys] duplicateBurst 探针幂等键规模（缺省 200）
 * @param {number} [opts.mmdRetryLimit] At-Least-Once 最大重投次数（缺省 3）
 * @param {boolean} [opts.mmdAckReliable] ack 可靠（抹掉 At-Least-Once 重复，抹不掉另两只软肋）
 * @returns {Promise<{lsm:object|null, hw:object|null, guards:object|null, rateLimit:object|null, failureDetector:object|null, bplusIndex:object|null, mvccTxn:object|null, distributedTxn:object|null, raftConsensus:object|null, distributedLock:object|null, idGen:object|null, distributedRateLimit:object|null, configConsistency:object|null, cacheCoherency:object|null, messageDelivery:object|null, builtAt:number}>}
 */
export async function buildSystems(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const lsm = buildLsmReading(opts)
  const hw = buildHwReading(opts)
  // KI-501：第三维「缓存防护」真跑三件套（击穿/穿透/雪崩），与 lsm/hw 平级、不混入五场景。
  // 异步：击穿对照真跑并发 loader + singleflight（Promise.all）；故 buildSystems/buildSnapshot 随之 async。
  const guards = opts.guards === false ? null : await buildGuardsReading(opts, now)
  // KI-502：第四维「网关限流」真跑五算法突发对照 + Redis 原子/非原子超发，与 lsm/hw/guards 平级、不混入五场景。
  const rateLimit = opts.rateLimit === false ? null : await buildRateLimitReading(opts, now)
  // KI-503：第五维「故障检测」真跑固定超时 vs φ 对照 + SWIM 三态 + 健康视图缓存，与其它四维平级、不混入五场景。
  const failureDetector = opts.failureDetector === false ? null : await buildFailureDetectorReading(opts, now)
  // KI-504：第六维「B+ 树索引」真跑点查比较数/叶链范围查/写放大 vs LSM 三笔账，与其它五维平级、不混入五场景。
  const bplusIndex = opts.bplusIndex === false ? null : await buildBplusReading(opts, now)
  const mvccTxn = opts.mvccTxn === false ? null : await buildMvccTxnReading(opts, now)
  // KI-506：第八维「分布式事务」真跑 2PC/Saga/TCC × 六场景矩阵 + 三难判词，与其它七维平级、不混入五场景。
  const distributedTxn = opts.distributedTxn === false ? null : await buildDistributedTxnReading(opts, now)
  // KI-507：第九维「Raft 共识」真跑 Raft/MultiMaster/Gossip × 六场景矩阵 + 三难判词，与其它八维平级、不混入五场景。
  const raftConsensus = opts.raftConsensus === false ? null : await buildRaftConsensusReading(opts, now)
  // KI-508：第十维「分布式锁」真跑 SETNX/Redlock/etcd × 六场景矩阵 + 三难判词，与其它九维平级、不混入五场景。
  const distributedLock = opts.distributedLock === false ? null : await buildDistributedLockReading(opts, now)
  // KI-509：第十一维「分布式 ID」真跑 UUID/Snowflake/号段 × 六场景矩阵 + 三难判词 + KI-504 真树交叉印证，与其它十维平级。
  const idGen = opts.idGen === false ? null : await buildIdGenReading(opts, now)
  // KI-510：第十二维「分布式限流」真跑 本地桶/中心桶/分片桶 × 六场景矩阵 + 三难判词 + 真 Redis 原子桶/真环交叉印证，与其它十一维平级。
  const distributedRateLimit = opts.distributedRateLimit === false ? null : await buildDistributedRateLimitReading(opts, now)
  // KI-511：第十三维「配置一致性」真跑 轮询/长轮询/watch 推送 × 六场景矩阵 + 三难判词 + 真 Config响应/watcher/bus/环交叉印证，与其它十二维平级。
  const configConsistency = opts.configConsistency === false ? null : await buildConfigConsistencyReading(opts, now)
  // KI-512：第十四维「缓存读写一致性」真跑 Cache-Aside/Write-Through/Write-Behind × 六场景矩阵 + 三难判词 + 七枚真件交叉印证，与其它十三维平级。
  const cacheCoherency = opts.cacheCoherency === false ? null : await buildCacheCoherencyReading(opts, now)
  // KI-513：第十五维「消息投递语义」真跑 At-Most-Once/At-Least-Once/Exactly-Once × 六场景矩阵 + 三难判词 + 七枚真件交叉印证，与其它十四维平级。
  const messageDelivery = opts.messageDelivery === false ? null : await buildMessageDeliveryReading(opts, now)
  return { lsm, hw, guards, rateLimit, failureDetector, bplusIndex, mvccTxn, distributedTxn, raftConsensus, distributedLock, idGen, distributedRateLimit, configConsistency, cacheCoherency, messageDelivery, builtAt: now() }
}

/** LSM 引擎真跑一趟确定性 benchmark，回结构读数（不夹带每行真值）。 */
function buildLsmReading(opts) {
  try {
    const N = Math.max(32, Math.floor(Number(opts.lsmKeys ?? 512)))
    let seed = 42
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const store = createLsmStore({ memtableMax: 64, levelMultiplier: 4, rand })
    const key = (i) => 'boss:' + String(i).padStart(5, '0')
    for (let i = 0; i < N; i++) store.put(key(i), { hp: i * 10 })
    for (let i = 0; i < N; i += 7) store.del(key(i))
    store.flush()
    store.compact()
    const probes = []
    for (let i = 0; i < N; i += 5) probes.push(key(i))
    const cmp = store.compareScan(probes.concat(['never:a', 'never:b']))
    const s = store.stats()
    const round = (x) => Number.isFinite(x) ? Number(x.toFixed(2)) : null
    return {
      keys: N, flushes: s.flushes, compactions: s.compactions,
      mergedAway: s.mergedAway, tombstonesDropped: s.tombstonesDropped,
      bloomRejects: s.bloomRejects, comparisons: s.comparisons,
      scanBaselineComparisons: s.scanBaselineComparisons,
      speedup: round(cmp.speedup),
      levels: s.levels.map((l) => ({ level: l.level, segments: l.segments, entries: l.entries })),
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/** OS/硬件适配三件对照，走 createGameCloud.hw 装配（证接线也可用），回结构读数。 */
function buildHwReading(opts) {
  try {
    const count = Math.max(100, Math.floor(Number(opts.layoutCount ?? 2000)))
    const gc = createGameCloud({
      hw: {
        poolAccesses: Math.max(100, Math.floor(Number(opts.poolAccesses ?? 2000))),
        counterCount: 8, count, jumpStride: 16,
      },
      hwNow: opts.now,
    })
    const h = gc.hw.snapshot()
    const round = (x) => Number.isFinite(x) ? Number(x.toFixed(2)) : null
    return {
      allocation: {
        accesses: h.allocation.accesses, naiveCreated: h.allocation.naiveCreated,
        poolCreated: h.allocation.poolCreated, saved: h.allocation.saved,
        reuseRate: Number.isFinite(h.allocation.reuseRate) ? Number(h.allocation.reuseRate.toFixed(4)) : null,
      },
      cacheLine: {
        paddedFalseSharing: h.cacheLine.paddedFalseSharing,
        packedFalseSharing: h.cacheLine.packedFalseSharing,
        paddingOverhead: round(h.cacheLine.paddingOverhead),
      },
      layout: {
        sequential: { aosMisses: h.layout.sequential.aosMisses, soaMisses: h.layout.sequential.soaMisses, speedup: round(h.layout.sequential.speedup) },
        strided: { stride: h.layout.strided.stride, aosMisses: h.layout.strided.aosMisses, soaMisses: h.layout.strided.soaMisses, speedup: round(h.layout.strided.speedup) },
      },
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-501：真跑缓存防护三件套（击穿 / 穿透 / 雪崩），收敛成前端三面板的紧凑读数。
 * 与 lsm/hw 并列、都是 Node 侧真判词的结构计数；缺哪块就落 null，前端据实降级。
 * @param {object} opts { now?, guards?:false, guardConcurrency?, guardKeys? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildGuardsReading(opts, now) {
  try {
    const s = await cacheGuardStudy({
      concurrency: Math.max(2, Math.floor(Number(opts.guardConcurrency ?? 32))),
      keys: Math.max(8, Math.floor(Number(opts.guardKeys ?? 256))),
      now,
      seed: 1979, // 确定性：同一份快照重跑读数逐字一致
    })
    const round = (x) => Number.isFinite(x) ? Number(x.toFixed(2)) : null
    return {
      // 击穿：并发 → 无防护 vs singleflight 回源次数与放大倍数、XFetch 提前续期
      stampede: {
        concurrency: s.stampede.concurrency,
        naiveLoads: s.stampede.naiveLoads,
        singleflightLoads: s.stampede.singleflightLoads,
        savedLoads: s.stampede.savedLoads,
        amplification: round(s.stampede.amplification),
        xfetchAvoidedMisses: s.stampede.xfetchAvoidedMisses,
      },
      // 穿透：不存在 key 的三路回源 + 布隆假阳性（如实暴露，不零误判）
      penetration: {
        absent: s.penetration.absent,
        rounds: s.penetration.rounds,
        naiveDbHits: s.penetration.naiveDbHits,
        negativeDbHits: s.penetration.negativeDbHits,
        bloomDbHits: s.penetration.bloomDbHits,
        bloomRejected: s.penetration.bloomRejected,
        bloomFalsePositives: s.penetration.bloomFalsePositives,
        bloomSavedRate: round(s.penetration.bloomSavedRate),
      },
      // 雪崩：统一 TTL 单桶峰值 vs 抖动削峰 + bucket 分布
      avalanche: {
        keys: s.avalanche.keys,
        buckets: s.avalanche.buckets,
        uniformPeak: s.avalanche.uniformPeak,
        jitterPeak: s.avalanche.jitterPeak,
        peakReduction: round(s.avalanche.peakReduction),
        uniformBuckets: s.avalanche.uniformBuckets,
        jitterBuckets: s.avalanche.jitterBuckets,
        histogram: s.avalanche.histogram,
      },
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-502：真跑网关限流族（固定窗口 / 滑动日志 / 滑动计数 / 令牌桶 / 漏桶五算法突发对照 +
 * Redis 原子令牌桶原子 vs 非原子超发 + 跨实例共享），收敛成前端「限流算法族」面板紧凑读数。
 * 判定/阈值全 Node 侧；注入规模与固定时钟 ⇒ 快照重跑读数逐字一致；缺哪块就落 null，前端据实降级。
 * @param {object} opts { rateLimit?:false, rlConcurrency?, rlCapacity?, rlWindowMs? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildRateLimitReading(opts, now) {
  try {
    const capacity = Math.max(2, Math.floor(Number(opts.rlCapacity ?? 8)))
    const s = await rateLimiterStudy({
      limit: capacity,
      windowMs: Math.max(100, Math.floor(Number(opts.rlWindowMs ?? 1000))),
      capacity,
      refillPerSec: capacity,
      leakPerSec: capacity,
      concurrency: Math.max(8, Math.floor(Number(opts.rlConcurrency ?? 64))),
      redisCapacity: capacity,
      redisRefillPerSec: 0,
      now,
    })
    const snap = rlSnapshot(s)
    // 收敛成前端友好形状：五算法 allowed/burstRatio + Redis 原子/非原子/超发/共享，浮点已由 rlSnapshot round。
    return {
      limit: snap.limit,
      windowMs: snap.windowMs,
      arrivals: snap.arrivals,
      strategies: {
        fixedWindow: snap.strategies.fixedWindow,
        slidingLog: snap.strategies.slidingLog,
        slidingCounter: snap.strategies.slidingCounter,
        tokenBucket: snap.strategies.tokenBucket,
        leakyBucket: snap.strategies.leakyBucket,
      },
      verdict: snap.verdict,
      redis: snap.redis,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-503：真跑服务故障检测器（固定超时 vs φ 累积风险对照 + SWIM 三态成员协议 + 健康视图 TTL 缓存），
 * 收敛成前端「故障检测」两面板紧凑读数。判定/阈值全 Node 侧；注入规模与固定时钟 ⇒ 快照重跑读数
 * 逐字一致；φ 曲线是真判词逐点、非画假线；缺哪块就落 null，前端据实降级。
 * @param {object} opts { failureDetector?:false, fdStableCount?, fdSpikeCount? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildFailureDetectorReading(opts, now) {
  try {
    const compare = {
      stableCount: Math.max(8, Math.floor(Number(opts.fdStableCount ?? 40))),
      spikeCount: Math.max(1, Math.floor(Number(opts.fdSpikeCount ?? 3))),
    }
    const s = await failureDetectorStudy({ now, compare })
    const snap = fdSnapshot(s)
    // 收敛成前端友好形状：φ 曲线（真逐点）+ 固定/φ 对照 + SWIM 三态 + 健康视图命中；浮点已由 fdSnapshot round。
    return {
      threshold: snap.threshold,
      fixedTimeoutMs: snap.fixedTimeoutMs,
      fixed: snap.fixed,
      phi: snap.phi,
      adaptation: snap.adaptation,
      verdict: snap.verdict,
      curve: snap.curve,
      swim: {
        counts: snap.swim.counts,
        indirectRescues: snap.swim.indirectRescues,
        confirmations: snap.swim.confirmations,
        suspicionTimeoutMs: snap.swim.suspicionTimeoutMs,
        script: snap.swim.script,
        members: snap.swim.members,
      },
      health: snap.health,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-504：真跑 `bplusStudy`（B+ 树 vs LSM 三笔账）并收敛成前端「B+ 树索引」两面板紧凑读数。
 * 判定/阈值全 Node 侧；注入规模与固定时钟 ⇒ 快照重跑读数逐字一致；层高阶梯是真数学估计、
 * 三笔账是两引擎真结构计数、agreement 是逐条对账，缺哪块就落 null，前端据实降级。
 * @param {object} opts { bplusIndex?:false, bpKeyCount?, bpOrder?, bpLeafCapacity? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildBplusReading(opts, now) {
  try {
    const s = bplusStudy({
      now,
      keyCount: Math.max(32, Math.floor(Number(opts.bpKeyCount ?? 512))),
      order: opts.bpOrder ? Math.floor(Number(opts.bpOrder)) : undefined,
      leafCapacity: opts.bpLeafCapacity ? Math.floor(Number(opts.bpLeafCapacity)) : undefined,
    })
    const snap = bpSnapshot(s)
    // 收敛成前端友好形状（浮点与前端展示口径一致，不动 Node 侧判词）。
    return {
      config: snap.config,
      structure: snap.structure,
      point: snap.point,
      range: snap.range,
      write: snap.write,
      levels: snap.levels,
      agreement: snap.agreement,
      verdict: snap.verdict,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-505：真跑 `mvccStudy`（五档隔离 × 五类异常矩阵 + 死锁环检测 + 2PL + gc 水位）并收敛成前端
 * 「事务与并发控制」两面板紧凑读数。判定/阈值全 Node 侧；注入固定时钟 ⇒ 快照重跑逐字一致；
 * 五行矩阵是确定性调度真判词、死锁是真 DFS 环检测、判词不封 Serializable 全局赢家，缺哪块落 null。
 * @param {object} opts { mvccTxn?:false, mvGcVersions? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildMvccTxnReading(opts, now) {
  try {
    const s = mvccStudy({ now, ...(opts.mvGcVersions ? { gcVersions: Math.floor(Number(opts.mvGcVersions)) } : {}) })
    const snap = mvSnapshot(s)
    return {
      config: snap.config,
      levels: snap.levels,
      deadlock: snap.deadlock,
      twoPhaseLock: snap.twoPhaseLock,
      gc: snap.gc,
      store: snap.store,
      verdict: snap.verdict,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-506：真跑 `distributedTxnStudy`（2PC 阻塞 / Saga 补偿留脏 / TCC 三阶段幂等 × 六场景矩阵 +
 * 三难判词）并收敛成前端「分布式事务」两面板紧凑读数。判定/阈值全 Node 侧；注入固定时钟 ⇒
 * 快照重跑逐字一致；三协议阶梯是确定性故障场景真判词、判词不封任何协议全局赢家，缺哪块落 null。
 * @param {object} opts { distributedTxn?:false, dtxnRetries? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildDistributedTxnReading(opts, now) {
  try {
    const s = distributedTxnStudy({
      now,
      ...(opts.dtxnRetries ? { confirmFailTimes: Math.max(0, Math.floor(Number(opts.dtxnRetries))) } : {}),
    })
    const snap = dtSnapshot(s)
    return {
      config: snap.config,
      rows: snap.rows,
      idempotency: snap.idempotency,
      sagaOrder: snap.sagaOrder,
      tccRetry: snap.tccRetry,
      verdict: snap.verdict,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-507：真跑 `raftConsensusStudy`（Raft 单 leader 强一致 / 多主复制 / Gossip 反熵 × 六场景矩阵 +
 * 三难判词）并收敛成前端「Raft 共识」两面板紧凑读数。判定/阈值全 Node 侧；注入固定时钟 ⇒
 * 快照重跑逐字一致；三协议阶梯是确定性故障场景真判词、判词不封任何协议全局赢家，缺哪块落 null。
 * @param {object} opts { raftConsensus?:false, rcRounds? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildRaftConsensusReading(opts, now) {
  try {
    const s = raftConsensusStudy({
      now,
      ...(opts.rcRounds ? { antiEntropyRounds: Math.max(1, Math.floor(Number(opts.rcRounds))) } : {}),
    })
    const snap = rcSnapshot(s)
    return {
      config: snap.config,
      rows: snap.rows,
      election: snap.election,
      replication: snap.replication,
      safety: snap.safety,
      gossip: snap.gossip,
      verdict: snap.verdict,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-508：真跑 `distributedLockStudy`（单 Redis SETNX+TTL / Redlock 多数派 / etcd Lease+Fencing ×
 * 六场景矩阵 + 三难判词）并收敛成前端「分布式锁」两面板紧凑读数。判定/阈值全 Node 侧；注入固定
 * 时钟 ⇒ 快照重跑逐字一致；三协议阶梯是确定性故障场景真判词、判词不封任何协议全局赢家，缺哪块落 null。
 * @param {object} opts { distributedLock?:false, dlockInstances? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildDistributedLockReading(opts, now) {
  try {
    const s = distributedLockStudy({
      now,
      ...(opts.dlockInstances ? { instances: Math.max(1, Math.floor(Number(opts.dlockInstances))) } : {}),
    })
    const snap = dlSnapshot(s)
    return {
      config: snap.config,
      rows: snap.rows,
      setnx: snap.setnx,
      redlock: snap.redlock,
      fencing: snap.fencing,
      verdict: snap.verdict,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-509：真跑 `idGenStudy`（UUIDv4 / Snowflake / Redis 号段 × 六场景矩阵 + 三难判词 + KI-504 真
 * B+ 树交叉印证）并收敛成前端「分布式 ID」两面板紧凑读数。判定/阈值全 Node 侧；注入固定时钟/随机
 * ⇒ 快照重跑逐字一致；三协议阶梯是确定性故障场景真判词、判词不封任何协议全局赢家，缺哪块落 null。
 * @param {object} opts { idGen?:false, idGenKeyCount?, idGenTreeOrder? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildIdGenReading(opts, now) {
  try {
    const s = idGenStudy({
      now,
      ...(opts.idGenKeyCount ? { keyCount: Math.max(2, Math.floor(Number(opts.idGenKeyCount))) } : {}),
      ...(opts.idGenTreeOrder ? { order: Math.max(4, Math.floor(Number(opts.idGenTreeOrder))) } : {}),
    })
    const snap = igSnapshot(s)
    return {
      config: snap.config,
      rows: snap.rows,
      uuid: snap.uuid,
      snowflake: snap.snowflake,
      segment: snap.segment,
      btree: snap.btree,
      verdict: snap.verdict,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-510：真跑 `distributedRateLimitStudy`（本地桶 / Redis 中心桶 / 一致性哈希分片桶 × 六场景矩阵
 * + 三难判词 + 真 `createRedisTokenBucket` 原子对照 / 真 `createHashRing` 分布偏斜与最小重映射）
 * 并收敛成前端「分布式限流」两面板紧凑读数。判定/阈值全 Node 侧；注入固定时钟/seed ⇒ 快照重跑
 * 逐字一致；三协议阶梯是确定性故障场景真判词、判词不封任何协议全局赢家（Sharded 不是银弹），缺哪块落 null。
 * @param {object} opts { distributedRateLimit?:false, drlInstances?, drlShards?, drlCapacity? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildDistributedRateLimitReading(opts, now) {
  try {
    const s = await distributedRateLimitStudy({
      now,
      ...(opts.drlInstances ? { instances: Math.max(1, Math.floor(Number(opts.drlInstances))) } : {}),
      ...(opts.drlShards ? { shards: Math.max(2, Math.floor(Number(opts.drlShards))) } : {}),
      ...(opts.drlCapacity ? { capacity: Math.max(1, Math.floor(Number(opts.drlCapacity))) } : {}),
    })
    const snap = drlSnapshot(s)
    return {
      config: snap.config,
      rows: snap.rows,
      vectors: snap.vectors,
      crosscheck: snap.crosscheck,
      verdict: snap.verdict,
      topology: snap.topology,
      builtAt: snap.builtAt,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-511：真跑 `configConsistencyStudy`（客户端轮询 / 长轮询 / watch 服务端推送 × 六场景矩阵
 * + 三难判词 + 真 `buildConfigResponse` 快照 / 真 `startConfigWatcher` 首趟纯播种 / 真 `createBus` 事件链 /
 * 真 `hashSelector` 稳定桶 / 真 XFetch / 真 `createRedisCache` TTL 失效 / 真 `createHashRing` 分布）
 * 并收敛成前端「配置一致性」两面板紧凑读数。判定/阈值全 Node 侧；注入固定时钟/seed ⇒ 快照重跑
 * 逐字一致；三协议阶梯是确定性故障场景真判词、判词不封任何协议全局赢家（Watch 不是银弹），缺哪块落 null。
 * @param {object} opts { configConsistency?:false, dccClients?, dccPollIntervalMs? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildConfigConsistencyReading(opts, now) {
  try {
    const s = await configConsistencyStudy({
      now,
      ...(opts.dccClients ? { clients: Math.max(1, Math.floor(Number(opts.dccClients))) } : {}),
      ...(opts.dccPollIntervalMs ? { pollIntervalMs: Math.max(1, Math.floor(Number(opts.dccPollIntervalMs))) } : {}),
    })
    const snap = dccSnapshot(s)
    return {
      config: snap.config,
      rows: snap.rows,
      vectors: snap.vectors,
      crosscheck: snap.crosscheck,
      verdict: snap.verdict,
      topology: snap.topology,
      builtAt: snap.builtAt,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-512：真跑 `cacheCoherencyStudy`（Cache-Aside / Write-Through / Write-Behind × 六场景矩阵
 * + 三难判词 + 真 `createRedisCache` 写后读 / 真 `createWal` 进程内恢复但非跨机 / 真 `shouldEarlyExpire`
 * XFetch / 真 `createShardedCache` 多片 / 真 `createMvccStore` 版本链 / 真 `createTwoPhaseCommit` 协调阻塞 /
 * 真 `createHashRing` 分布）并收敛成前端「缓存读写一致性」两面板紧凑读数。判定/阈值全 Node 侧；注入
 * 固定时钟/规模 ⇒ 快照重跑逐字一致；三协议阶梯是确定性故障场景真判词、判词不封任何协议全局赢家
 * （Write-Behind 不是银弹，进程内 WAL 抹不掉整机宕 durable 维），缺哪块落 null。
 * @param {object} opts { cacheCoherency?:false, cccWrites?, cccManyKeys?, cccBackendRttMs?, cccWalEnabled? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildCacheCoherencyReading(opts, now) {
  try {
    const s = await cacheCoherencyStudy({
      now,
      ...(opts.cccWrites ? { writes: Math.max(1, Math.floor(Number(opts.cccWrites))) } : {}),
      ...(opts.cccManyKeys ? { manyKeys: Math.max(1, Math.floor(Number(opts.cccManyKeys))) } : {}),
      ...(opts.cccBackendRttMs ? { backendRttMs: Math.max(1, Math.floor(Number(opts.cccBackendRttMs))) } : {}),
      ...(opts.cccWalEnabled === true ? { walEnabled: true } : {}),
    })
    const snap = cccSnapshot(s)
    return {
      config: snap.config,
      rows: snap.rows,
      vectors: snap.vectors,
      crosscheck: snap.crosscheck,
      verdict: snap.verdict,
      topology: snap.topology,
      builtAt: snap.builtAt,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * KI-513：真跑 `messageDeliveryStudy`（At-Most-Once / At-Least-Once / Exactly-Once × 六场景矩阵
 * + 三难判词 + 真 `createBus` 发完即忘 / 真 `createGameEventBus` delivered/errors / 真 `createGameEventBridge`
 * 路由转发 / 真 `createTwoPhaseCommit` 重放幂等 / 真 `createWal` 带 key 重放去重但进程内不跨机 /
 * 真 `createRedisCache` 幂等键首 miss 二 hit / 真 `createHashRing` 分区 fanout）并收敛成前端
 * 「消息投递语义」两面板紧凑读数。判定/阈值全 Node 侧；注入固定时钟/规模 ⇒ 快照重跑逐字一致；
 * 三协议阶梯是确定性故障场景真判词、判词不封任何协议全局赢家（Exactly-Once 不丢不重却最贵，
 * 是 At-Least-Once + 幂等；单开 ackReliable 只补 At-Least-Once 一维），缺哪块落 null。
 * @param {object} opts { messageDelivery?:false, mmdMessages?, mmdManyKeys?, mmdRetryLimit?, mmdAckReliable? }
 * @param {()=>number} now 时钟（builtAt 注入则确定性）
 */
export async function buildMessageDeliveryReading(opts, now) {
  try {
    const s = await messageDeliveryStudy({
      now,
      ...(opts.mmdMessages ? { messages: Math.max(1, Math.floor(Number(opts.mmdMessages))) } : {}),
      ...(opts.mmdManyKeys ? { manyKeys: Math.max(1, Math.floor(Number(opts.mmdManyKeys))) } : {}),
      ...(opts.mmdRetryLimit ? { retryLimit: Math.max(2, Math.floor(Number(opts.mmdRetryLimit))) } : {}),
      ...(opts.mmdAckReliable === true ? { ackReliable: true } : {}),
    })
    const snap = mmdSnapshot(s)
    return {
      config: snap.config,
      rows: snap.rows,
      vectors: snap.vectors,
      crosscheck: snap.crosscheck,
      verdict: snap.verdict,
      topology: snap.topology,
      builtAt: snap.builtAt,
    }
  } catch (e) {
    return null // 缺哪块就落 null，前端据实降级；不编造假数
  }
}

/**
 * 真跑时每场景的 opts（判定权在此：场景参数固定，业务阈值仍来自各子系统默认/显式注入）。
 * @param {string} id
 */
export function realScenarioOpts(id) {
  const transport = (t, p) => ({ url: t?.url, serviceName: t?.serviceName, path: p })
  switch (id) {
    case 'main':
      return { transport }
    case 'gray': {
      const e = {
        transport: (t, p) => ({ instanceId: t?.instanceId, path: p }),
        bearer: null,
        grayInstances: [
          { id: 'stable:1', name: 'gray-svc', address: '10.0.3.1', port: 8080, healthy: true, metadata: { version: 'v1', weight: 1 } },
          { id: 'can:1', name: 'gray-svc', address: '10.0.3.2', port: 8080, healthy: true, metadata: { version: 'v2', canary: true, weight: 3 } },
        ],
        gray: {
          canaryPercent: 50, grayField: 'version', canaryValue: 'v2', stickyHeader: 'x-player',
          selector: ({ key }) => String(key).startsWith('v2-user') ? 0 : 0.99, rand: () => 0,
        },
        grayProbes: [
          { service: 'gray-svc', headers: { 'x-player': 'v2-user-1' } },
          { service: 'gray-svc', headers: { 'x-player': 'v2-user-1' } },
          { service: 'gray-svc', headers: { 'x-player': 'stable-user' } },
        ],
      }
      return e
    }
    case 'resilience':
      return {
        bearer: null,
        transport: () => new Promise(() => {}), // 挂起 ⇒ TimeLimiter 到点抛
        filters: [
          { name: 'Bulkhead', args: { key: 'e2e-gate', maxConcurrent: 2 } },
          { name: 'TimeLimiter', args: { timeoutMs: 15 } },
        ],
      }
    case 'cache': {
      let introspections = 0
      const activeFetch = () => {
        introspections++
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ active: true, scope: 'game:call', sub: 'u1' }) })
      }
      return {
        bearer: null, transport, requiredScope: 'game:call',
        authCache: true, authCacheTtlMs: 60_000,
        onlineAuth: { introspectionUrl: 'http://idp/introspect', fetch: activeFetch, policy: 'fail-closed' },
        cacheProbe: { bearer: 'Bearer opaque-snapshot' },
      }
    }
    case 'net': {
      let t = 1000
      return { transport: (_t, _p) => { t += 7; return { path: '/api/health' } }, net: true, netNow: () => t }
    }
    default:
      return { transport }
  }
}

/**
 * 把一趟 E2E 原始判词收敛成前端稳定读数（缺字段一律给 null，绝不臆造）。
 * @param {string} id
 * @param {any} gc 该场景的 cloud 实例（用于取 status）
 * @param {any} r run() 的返回
 */
export function normalizeScenario(id, gc, r) {
  const base = { id, title: SCENARIO_TITLES[id] ?? id, ok: !!r?.started?.registered }
  switch (id) {
    case 'main':
      return {
        ...base,
        registered: !!r.started?.registered,
        callOk: !!r.callRes?.ok,
        services: Array.isArray(r.services) ? [...r.services] : [],
        spanCount: Array.isArray(r.spans) ? r.spans.length : 0,
        events: (r.events ?? []).map((x) => x.type),
        stoppedRegistered: r.stopped?.registered ?? null,
      }
    case 'gray':
      return {
        ...base,
        probes: (r.grayProbes ?? []).map((p) => ({
          key: p.key ?? null, lane: p.lane ?? null, fallback: !!p.fallback,
          canaryPercent: p.canaryPercent ?? null, ok: !!p.ok, instanceId: p.instanceId ?? null,
        })),
        stats: sanitize(r.grayStats),
      }
    case 'resilience': {
      const f = r.filterStats ?? {}
      return {
        ...base,
        callOk: !!r.callRes?.ok,
        error: r.callRes?.error?.message ?? null,
        stats: {
          retries: num(f.retries), rateLimited: num(f.rateLimited), passed: num(f.passed),
          bulkheadRejected: num(f.bulkheadRejected), bulkheadHeld: num(f.bulkheadHeld),
          timedOut: num(f.timedOut),
        },
      }
    }
    case 'cache': {
      const st = r.cacheProbe?.stats ?? r.authCacheStats ?? {}
      return {
        ...base,
        firstSource: r.cacheProbe?.firstSource ?? null,
        secondSource: r.cacheProbe?.secondSource ?? null,
        secondCacheHit: !!r.cacheProbe?.secondCacheHit,
        stats: { hits: num(st.hits), misses: num(st.misses), hitRate: num(st.hitRate), bytes: num(st.bytes), entries: num(st.entries) },
      }
    }
    case 'net': {
      const n = r.netSnapshot ?? {}
      const a = n.aimd ?? {}
      const cu = n.cubic ?? {}
      const rt = n.rto ?? {}
      const w = n.window ?? {}
      // 若 driveNetSeries 真喂过同一只 gc.net.aimd，它的 history 会比 raw 快照更长——
      // 只在「确实被加长」时取实时 state，否则退回 raw。两种都是真算法读数，不编造。
      const live = gc?.net?.aimd?.state?.()
      const aimd = (live && Array.isArray(live.history) && live.history.length > (a.history?.length ?? 0)) ? live : a
      return {
        ...base,
        observes: num(n.observes),
        aimd: { cwnd: num(aimd.cwnd), ssthresh: num(aimd.ssthresh), mode: aimd.mode ?? null, history: Array.isArray(aimd.history) ? aimd.history : [] },
        cubic: { cwnd: num(cu.cwnd), Wmax: num(cu.Wmax), K: num(cu.K) },
        rto: { srtt: num(rt.srtt), rttvar: num(rt.rttvar), rto: num(rt.rto), ignoredSamples: num(rt.ignoredSamples) },
        window: { windowSize: num(w.windowSize), inFlight: num(w.inFlight), sends: num(w.sends), blocked: num(w.blocked) },
        series: cwndSeries(aimd.history),
      }
    }
    default:
      return base
  }
}

/**
 * 用真 AIMD 实例喂一段确定性序列：8 次成功 ACK（慢启动指数爬）→ 一次超时（乘性减回 1）→
 * 6 次 ACK（再爬）→ 3 次重复 ACK（快重传乘性减）→ 5 次 ACK。history 里每一步都是真算法读数。
 * @param {any} net createGameCloud({net:true}) 的可观测包
 */
export function driveNetSeries(net) {
  if (!net?.aimd) return null
  const a = net.aimd
  for (let i = 0; i < 8; i++) a.onAck()
  a.onTimeout()
  for (let i = 0; i < 6; i++) a.onAck()
  for (let i = 0; i < 3; i++) a.onDupAck()
  for (let i = 0; i < 5; i++) a.onAck()
  return a.state()
}

/** 从 AIMD history 抽出 cwnd 轨迹（前端曲线；没有就空数组，不补假点）。 */
export function cwndSeries(history) {
  if (!Array.isArray(history)) return []
  return history.map((h, i) => ({ step: i, cwnd: num(h.cwnd), event: h.event ?? null, mode: h.mode ?? null }))
}

/** 从五场景里派生前端顶部四个大数（都来自真判词，缺则 null）。 */
export function deriveHighlights(scenarios) {
  const by = (id) => scenarios.find((s) => s.id === id) ?? null
  const main = by('main')
  const gray = by('gray')
  const cache = by('cache')
  const net = by('net')
  const resilience = by('resilience')
  return {
    services: main?.services?.length ?? null,
    spanCount: main?.spanCount ?? null,
    canaryHits: gray?.stats ? num(gray.stats.canary) : null,
    cacheHitRate: cache?.stats?.hitRate ?? null,
    timedOut: resilience?.stats?.timedOut ?? null,
    cwnd: net?.aimd?.cwnd ?? null,
    rto: net?.rto?.rto ?? null,
  }
}

function num(x) { return typeof x === 'number' && Number.isFinite(x) ? x : null }
function sanitize(x) {
  if (!x || typeof x !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean' || typeof v === 'string') out[k] = v
  }
  return out
}

/* ------------------------------- CLI ------------------------------- */

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outArg = process.argv.slice(2).find((a) => a.startsWith('--out='))
  const outPath = outArg
    ? resolve(outArg.slice('--out='.length))
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'console', 'snapshot.json')
  buildSnapshot().then((snap) => {
    const json = JSON.stringify(snap)
    writeFileSync(outPath, JSON.stringify(snap, null, 2) + '\n', 'utf8')
    // 同一份真快照再写一份 `bootstrap.js` 全局，供 file:// 直开（fetch 被跨源策略挡）时回退——
    // 单一数据源、零重复维护、绝不编造第二套数。放在 snapshot.json 同目录。
    const bootstrapPath = resolve(dirname(outPath), 'bootstrap.js')
    writeFileSync(
      bootstrapPath,
      `/* 由 caesura-console-gen 真跑 E2E 生成，勿手改；file:// 直开时的同源回退快照。 */\nwindow.__BOOTSTRAP_SNAPSHOT__ = ${json};\n`,
      'utf8',
    )
    console.log(`[console] 真跑 ${SCENARIO_IDS.length} 趟 E2E ⇒ ${outPath} (+ bootstrap.js)`)
    console.log(`[console] highlights: ${JSON.stringify(snap.highlights)}`)
    if (snap.systems) console.log(`[console] systems: lsm.speedup=${snap.systems.lsm?.speedup ?? '—'}× / hw.poolSaved=${snap.systems.hw?.allocation?.saved ?? '—'} / hw.layoutSpeedup=${snap.systems.hw?.layout?.sequential?.speedup ?? '—'}×`)
    if (snap.systems?.guards) console.log(`[console] guards: stampede ${snap.systems.guards.stampede.naiveLoads}→${snap.systems.guards.stampede.singleflightLoads} 回源 / penetration 布隆省 ${((snap.systems.guards.penetration.bloomSavedRate ?? 0) * 100).toFixed(0)}% / avalanche 削峰 ${((snap.systems.guards.avalanche.peakReduction ?? 0) * 100).toFixed(0)}%`)
    if (snap.systems?.rateLimit) console.log(`[console] rateLimit: fixedWindow burst×${snap.systems.rateLimit.strategies.fixedWindow.burstRatio ?? '—'} / sliding burst×${snap.systems.rateLimit.strategies.slidingLog.burstRatio ?? '—'} / Redis 原子 ${snap.systems.rateLimit.redis.atomicAllowed} vs 非原子 ${snap.systems.rateLimit.redis.nonAtomicAllowed}（超发 ${snap.systems.rateLimit.redis.overshoot}）`)
    if (snap.systems?.failureDetector) console.log(`[console] failureDetector: 抖动误报 固定 ${snap.systems.failureDetector.fixed.falsePositives} vs φ ${snap.systems.failureDetector.phi.falsePositives} / 真故障检出 固定 ${snap.systems.failureDetector.fixed.detectionLatencyMs}ms vs φ ${snap.systems.failureDetector.phi.detectionLatencyMs}ms / SWIM 间接救回 ${snap.systems.failureDetector.swim.indirectRescues}`)
    if (snap.systems?.bplusIndex) console.log(`[console] bplusIndex: B+ 高 ${snap.systems.bplusIndex.structure.height} 层(估 ${snap.systems.bplusIndex.structure.heightEstimate})/叶 ${snap.systems.bplusIndex.structure.leafCount} / 点查比较 B+ ${snap.systems.bplusIndex.point.bplusComparisons} vs LSM ${snap.systems.bplusIndex.point.lsmComparisons}(${snap.systems.bplusIndex.point.favors}) / 写放大 B+ ${snap.systems.bplusIndex.write.bplusPageRewrites} vs LSM ${snap.systems.bplusIndex.write.lsmSeqWriteUnits}(${snap.systems.bplusIndex.write.favors}) / 对账 ${snap.systems.bplusIndex.agreement.bothAgree ? '一致' : '分叉'}`)
    if (snap.systems?.mvccTxn) {
      const mv = snap.systems.mvccTxn
      const ladder = mv.levels.map((l) => `${l.short}[${l.observedCount}出/${l.aborted}止]`).join(' → ')
      console.log(`[console] mvccTxn: 五档异常阶梯 ${ladder} / SI 漏写偏斜 ${mv.levels.find((l) => l.short === 'SI')?.anomalies.writeSkew.observed ? '是' : '否'} / 死锁 ${mv.deadlock.cycle?.join('↔')}→牺牲 ${mv.deadlock.victim}(${mv.deadlock.resolved ? '已破' : '未破'}) / 长事务保留版本 ${mv.gc.longTxnRetainsMoreVersions ? '是' : '否'}`)
    }
    if (snap.systems?.distributedTxn) {
      const dt = snap.systems.distributedTxn
      const stateOf = (s) => s.committed ? '成' : s.blocked > 0 ? '阻' : s.dirty > 0 ? '脏' : '止'
      const ladders = dt.rows.map((row) => `${row.protocol}[${row.scenarios.map((s) => s.id + ':' + stateOf(s)).join('/')}] 侵入${row.intrusion}`).join(' · ')
      console.log(`[console] distributedTxn: ${ladders} / 三难向量 ${JSON.stringify(Object.fromEntries(dt.rows.map((r) => [r.protocol, `${Number(r.trilemma.noBlock)}${Number(r.trilemma.noDirty)}${Number(r.trilemma.lowIntrusion)}`])))} / 不封赢家 ${dt.verdict.noUniversalWinner ? '是' : '否'}`)
    }
    if (snap.systems?.raftConsensus) {
      const rc = snap.systems.raftConsensus
      const stateOf = (s) => s.blockedWrites > 0 ? '阻' : s.staleReads > 0 ? '陈' : s.conflicts > 0 ? '冲' : s.converged === false ? '散' : s.committed ? '成' : '?'
      const ladders = rc.rows.map((row) => `${row.protocol}[${row.scenarios.map((s) => s.id + ':' + stateOf(s)).join('/')}]`).join(' · ')
      console.log(`[console] raftConsensus: ${ladders} / 三难向量 ${JSON.stringify(Object.fromEntries(rc.rows.map((r) => [r.protocol, `${Number(r.trilemma.linearizable)}${Number(r.trilemma.partitionAvailable)}${Number(r.trilemma.boundedConvergence)}`])))} / 不封赢家 ${rc.verdict.noUniversalWinner ? '是' : '否'}`)
    }
    if (snap.systems?.distributedLock) {
      const dl = snap.systems.distributedLock
      const stateOf = (s, protocol) => s.doubleOwners > 0 ? '双' : s.staleWritesRejected > 0 ? '护' : s.dirtyWrites > 0 ? '脏' : s.blockedAcquires > 0 ? (protocol === 'SETNX' ? '阻' : '拒') : s.acquired ? '成' : '?'
      const ladders = dl.rows.map((row) => `${row.protocol}[${row.scenarios.map((s) => s.id + ':' + stateOf(s, row.protocol)).join('/')}]`).join(' · ')
      console.log(`[console] distributedLock: ${ladders} / 三难向量 ${JSON.stringify(Object.fromEntries(dl.rows.map((r) => [r.protocol, `${Number(r.trilemma.mutualExclusion)}${Number(r.trilemma.partialFaultTolerance)}${Number(r.trilemma.lowLatency)}`])))} / 不封赢家 ${dl.verdict.noUniversalWinner ? '是' : '否'}`)
    }
    if (snap.systems?.idGen) {
      const ig = snap.systems.idGen
      const stateOf = (s) => s.duplicates > 0 ? '重' : s.stalled > 0 ? '停' : s.indexFriendly === false ? '裂' : s.wastedIds > 0 ? '隙' : s.centerRounds > 0 ? '迟' : s.issued > 0 ? '成' : '?'
      const ladders = ig.rows.map((row) => `${row.protocol}[${row.scenarios.map((s) => s.id + ':' + stateOf(s)).join('/')}]`).join(' · ')
      console.log(`[console] idGen: ${ladders} / 三难向量 ${JSON.stringify(Object.fromEntries(ig.rows.map((r) => [r.protocol, `${Number(r.trilemma.indexFriendly)}${Number(r.trilemma.decentralized)}${Number(r.trilemma.clockRobust)}`])))} / 不封赢家 ${ig.verdict.noUniversalWinner ? '是' : '否'} / 真树随机cmp${ig.btree.random.comparisons}>顺序cmp${ig.btree.sequential.comparisons}(splits反直觉${ig.btree.random.splits}<${ig.btree.sequential.splits})`)
    }
    if (snap.systems?.distributedRateLimit) {
      const drl = snap.systems.distributedRateLimit
      const stateOf = (s) => s.degradedShard > 0 ? '降' : s.fragmented > 0 ? '碎' : s.overAllowed > 0 ? '超' : s.centerRounds > 0 ? '迟' : s.allowed > 0 ? '成' : '?'
      const ladders = drl.rows.map((row) => `${row.protocol}[${row.scenarios.map((s) => s.id + ':' + stateOf(s)).join('/')}]`).join(' · ')
      console.log(`[console] distributedRateLimit: ${ladders} / 三难向量 ${JSON.stringify(Object.fromEntries(drl.rows.map((r) => [r.protocol, `${Number(r.trilemma.globalExact)}${Number(r.trilemma.partialFaultTolerance)}${Number(r.trilemma.noCenterRTT)}`])))} / 不封赢家 ${drl.verdict.noUniversalWinner ? '是' : '否'} / Sharded不是银弹 ${drl.verdict.shardedNotPanacea ? '是' : '否'} / 真Redis桶atomic${drl.crosscheck.central.atomicAllowed}vs非原子${drl.crosscheck.central.nonAtomicAllowed}(超发${drl.crosscheck.central.nonAtomicOvershoot}) 真环偏斜空片${drl.crosscheck.sharded.skewEmptyNodes}重映射${drl.crosscheck.sharded.remapRate}`)
    }
    if (snap.systems?.configConsistency) {
      const dcc = snap.systems.configConsistency
      const stateOf = (s) => s.centerBroken ? '断' : s.versionGaps > 0 ? '缺' : s.idleFetches > 0 ? '空' : s.perceivedDelay > 0 ? '迟' : s.connections > 0 ? '连' : '成'
      const ladders = dcc.rows.map((row) => `${row.protocol}[${row.scenarios.map((s) => s.id + ':' + stateOf(s)).join('/')}]`).join(' · ')
      console.log(`[console] configConsistency: ${ladders} / 三难向量 ${JSON.stringify(Object.fromEntries(dcc.rows.map((r) => [r.protocol, `${Number(r.trilemma.degradeOnCenterDown)}${Number(r.trilemma.noIdleOverhead)}${Number(r.trilemma.instantPerceive)}`])))} / 不封赢家 ${dcc.verdict.noUniversalWinner ? '是' : '否'} / Watch不是银弹 ${dcc.verdict.watchNotPanacea ? '是' : '否'} / 真Config快照version${dcc.crosscheck.configServer.responseVersion} 真watcher首趟无事件${dcc.crosscheck.configWatcher.seededNoEvents} 真bus链${dcc.crosscheck.bus.eventChainWorks} 真稳定桶${dcc.crosscheck.gray.stableBuckets}/${dcc.crosscheck.gray.keys} 真XFetch${dcc.crosscheck.guard.monotonic} 真TTL失效${dcc.crosscheck.redisCache.expiredCount} 真环空片${dcc.crosscheck.ring.emptyNodes}`)
    }
    if (snap.systems?.cacheCoherency) {
      const ccc = snap.systems.cacheCoherency
      const stateOf = (s) => s.dirtyPagesLost > 0 ? '丢' : s.staleReads > 0 ? '陈' : s.writeBackendRttMs > 0 ? '阻' : s.coalescedWrites > 0 ? '合' : s.writes > 0 ? '成' : '?'
      const ladders = ccc.rows.map((row) => `${row.protocol}[${row.scenarios.map((s) => s.id + ':' + stateOf(s)).join('/')}]`).join(' · ')
      console.log(`[console] cacheCoherency: ${ladders} / 三难向量 ${JSON.stringify(ccc.vectors)} / 不封赢家 ${ccc.verdict.noUniversalWinner ? '是' : '否'} / WriteBehind不是银弹 ${ccc.verdict.writeBehindNotPanacea ? '是' : '否'} / 真Redis写后读${ccc.crosscheck.redis.writeThenReadSeesNew} 真WAL恢复${ccc.crosscheck.wal.replayed}但整机丢${ccc.crosscheck.wal.wholeNodeLossDurable} 真XFetch单调${ccc.crosscheck.guard.monotonic} 真分片全可读${ccc.crosscheck.sharded.allReadable} 真MVCC需提交${ccc.crosscheck.mvcc.writeThenReadNeedsCommit} 真2PC阻塞${ccc.crosscheck.twoPhase.blockedParticipants} 真环空片${ccc.crosscheck.ring.emptyNodes}`)
    }
    if (snap.systems?.messageDelivery) {
      const mmd = snap.systems.messageDelivery
      const stateOf = (s) => s.lost > 0 ? '丢' : s.duplicates > 0 ? '重' : !s.lowOverhead ? '贵' : s.idempotentHits > 0 ? '等' : '成'
      const ladders = mmd.rows.map((row) => `${row.protocol}[${row.scenarios.map((s) => s.id + ':' + stateOf(s)).join('/')}]`).join(' · ')
      console.log(`[console] messageDelivery: ${ladders} / 三难向量 ${JSON.stringify(mmd.vectors)} / 不封赢家 ${mmd.verdict.noUniversalWinner ? '是' : '否'} / ExactlyOnce不是免费午餐 ${mmd.verdict.exactlyOnceNotFree ? '是' : '否'} / 真Bus发完即忘${mmd.crosscheck.bus.atMostOnceShell} 真GameEventBus交付${mmd.crosscheck.gameEventBus.delivered} 真桥转发${mmd.crosscheck.bridge.forwardOk} 真2PC重放幂等${mmd.crosscheck.twoPhase.replayIdempotent} 真WAL重放${mmd.crosscheck.wal.replayed}条(distinct ${mmd.crosscheck.wal.distinctIds} 可去重${mmd.crosscheck.wal.replayDedupePossible} 但跨机${mmd.crosscheck.wal.replicatedAcrossNodes}) 真Redis幂等键${mmd.crosscheck.redis.idempotentTable} 真环空片${mmd.crosscheck.ring.emptyNodes}`)
    }
    process.exit(0)
  }).catch((e) => { console.error(`[console] 生成失败：${e.message}`); process.exit(1) })
}
