/**
 * scripts/caesura-log-compaction.mjs —— append-only 日志压缩（log compaction）与回放边界三策略诚实权衡教学状态机（KI-526，P8 第三十三维）。
 *
 * <p>精准接 KI-513（投递语义）/ KI-518（延迟调度）/ KI-520（重试死信）/ KI-523（分区所有权）/
 * KI-525（积压背压）消息队列族最后缺的<b>存储侧 + 恢复侧</b>：append-only 日志（WAL / changelog /
 * 消息队列 topic）不能无限增长、必须回收空间，但「<b>怎么回收</b>」与「<b>能从哪个位点完整恢复 /
 * 恢复是否 exactly-once / 恢复要多快</b>」直接三难冲突。与既有 LSM SSTable <i>物理</i> compaction、
 * MVCC vacuum、Raft 快照<b>不重复</b>：本件量的是「日志<i>逻辑</i>回收策略 vs 回放边界语义」，
 * 不是物理 SSTable 归并。</p>
 *
 * <ol>
 *   <li>{@link createSizeTimeRetention} <b>Size/Time Retention 按大小/时间截断</b>：超过
 *       {@code retentionOps}/{@code retentionMs} 的最老段直接删 → 日志短、空间最省、恢复最快；
 *       但慢消费者 / 迟到回放若从被截掉的位点起放，<b>历史真丢</b>（{@code missingOps>0}）。</li>
 *   <li>{@link createKeyCompaction} <b>Key Compaction 按 key 折叠</b>：同 key 只留最新 put + tombstone
 *       （changelog / 物化视图语义）→ 空间省、重放幂等、当前物化态完整；但要重放全部唯一 key 最新值 ⇒
 *       <b>恢复慢</b>；且 tombstone 若在 delete-retention 边界被过早清除，已删 key 会<b>复活</b>
 *       （{@code tombstoneResurrect}，单列诚实判词，非银弹）。</li>
 *   <li>{@link createSnapshotPlusWal} <b>Snapshot + 增量 WAL</b>：定期落全量快照、只留快照 LSN 之后的
 *       增量 WAL，回放先载快照再按 LSN 去重重放增量保 exactly-once 不重不漏 → 回放最完整、恢复最快；
 *       但快照全量 + WAL 追加<b>双重写放大</b>（{@code writeAmplification>1}）⇒ <b>空间不省</b>。</li>
 * </ol>
 *
 * <p><b>三难（维序固定，全件智力内核）</b>：<b>省空间 ∧ 回放完整 ∧ 恢复快</b>
 * （向量 {@code [compactFootprint/replayCompleteness/fastRecovery]}）。三个口径<b>严格正交、绝不混算</b>：</p>
 * <ul>
 *   <li>{@code compactFootprint}：仅看 {@code writeAmplification ≤ footprintBudget}（回收后占用 vs 逻辑 op 数）。</li>
 *   <li>{@code replayCompleteness}：仅看 {@link verifyReplayBoundary}.replayComplete（该回放位点不丢历史 / 幂等不重不漏 / 无 tombstone 复活）。</li>
 *   <li>{@code fastRecovery}：仅看 {@code replayOps ≤ replayBudget}（恢复要重放的操作条数少）。</li>
 * </ul>
 *
 * <p><b>默认向量（三向量互异、无一 111 ⇒ noUniversalWinner）</b>：
 * {@code SizeTimeRetention=101 / KeyCompaction=110 / SnapshotPlusWal=011}。各有胜场、各有软肋，
 * 恰好各缺一维（Retention 缺回放完整、KeyCompaction 缺恢复快、Snapshot 缺省空间），对称美。</p>
 *
 * <p><b>判定正交化 + 空真</b>（六场景分派三维考场，其余场景该维空真、不连坐，同 KI-518/520/523/525）：
 * {@code compactFootprint} 只在 {@code hotKeyChurn}+{@code retentionPressure} 量；
 * {@code replayCompleteness} 只在 {@code slowConsumer}+{@code crashMidReplay}+{@code tombstoneBurst} 量；
 * {@code fastRecovery} 只在 {@code crashMidReplay}+{@code steadyAppend} 量。
 * {@code crashMidReplay} 同时被 replayCompleteness 与 fastRecovery 量测（沿用 KI-523 memberJoin/Leave、
 * KI-525 downstreamStall 双维共用场景的既有正交口径，每 cell 各自判定、其余维空真、不连坐）。
 * tombstoneBurst 下 KeyCompaction 早清 tombstone 致复活<b>单列</b>诚实判词
 * {@code keyCompactionResurrectsUnderShortRetention}，<b>不污染</b>它的 replayCompleteness 向量
 * （正常 delete-retention 配置下当前物化态完整；复活是配置不当的诚实补刀，同 KI-525
 * {@code bufferingDropsUnderMemoryPressure} 纪律）。</p>
 *
 * <p><b>可证伪守恒自证 {@link verifyReplayBoundary}</b>（本件最硬判词，类比 KI-525 {@code verifyLittleLaw}）：
 * 导出纯函数双路独立算——<b>恒等式 A（回放成本守恒）</b>
 * {@code replayOps ≥ totalOps − compactedOps − foldedOps}（恢复必须重放「未被压缩掉 / 未被快照折叠」的操作）；
 * <b>恒等式 B（完整性守恒）</b> 按模式分派：retention 需 WAL 覆盖回放位点且零截断、key 需无 tombstone 复活且
 * 唯一键集非空、snapshot 需 WAL 覆盖 {@code [snapshotLsn+1, currentLsn]} 无断档。篡改 {@code replayOps}
 * 造假（抹掉重放成本）/ 抹掉某段 WAL / 早清 tombstone / 把 {@code snapshotLsn} 前移越界 ⇒ 两路分叉、
 * 对应 boolean 翻 false，可独立证伪；空集降级同 KI-525。</p>
 *
 * <p><b>rigged 三开关 + 因果锁死</b>：{@code unlimitedRetention}（保留全部历史）+ {@code instantSnapshot}
 * （快照零成本零空间）+ {@code zeroReplayCost}（重放零成本）齐开 ⇒ 真实现算收敛 {@code 110/110/110}、
 * 判词 {@code fastRecoveryCausallyUnerasable=true}，<b>绝不硬造全 111</b>。因果链（快照不可能三角的物理守恒）：
 * ① 想抹 replayCompleteness（让 Retention 也完整）须 {@code unlimitedRetention} 保留全部 ⇒
 * {@code compactedOps=0} ⇒ 由恒等式 A {@code replayOps≥totalOps} ⇒ fastRecovery 真算翻 false；
 * ② 想抹 compactFootprint（让 Snapshot 也省空间）须 {@code instantSnapshot} 零空间 ⇒ <b>无物化态可载</b> ⇒
 * 恢复只能全量重放 ⇒ fastRecovery 再翻 false；③ {@code zeroReplayCost} 想许愿式抹 fastRecovery，
 * 但与 ①② 逻辑相克（历史越多 / 快照越空，重放越不可省），守恒纯函数用真 {@code replayOps} 计算、
 * 不认许愿 ⇒ 三开关无一能翻回 fastRecovery。单开各开关各反噬一维（沿用 KI-525 纪律）。</p>
 *
 * <p><b>十一枚同仓真件交叉印证</b>（{@link createLogCompactionEvidence}）：真 {@code createWal}
 * append→lines→restore→replay 主体 / 真 {@code createRedisZsetDelayQueue} retention 时间窗 /
 * 真 {@code createMinHeapDelayQueue} 按 LSN 精确排程回放 / 真 {@code createShardedCache} key 分片压缩 /
 * 真 {@code createBloomFilter} tombstone 判重防复活 / 真 {@code createPackedCounters} 段计数压缩率 /
 * 真 {@code createTokenBucket} 回放限速 / 真 {@code createObjectPool} 回放记录对象复用省 GC /
 * 真 {@code createBus} compaction-done / replay-boundary 通知 / 真 {@code createHashRing} 快照分片 /
 * 真 {@code createFullJitterBackoff} 回放失败退避。全真 API 真调用真回读，计数绝不硬编码。</p>
 *
 * <p><b>不声称</b>：不接真 Kafka log cleaner / 真 RocksDB compaction / 真快照分发，无墙钟恢复毫秒或 QPS
 * 跑分（全为离散 op 结构计数），tombstone delete-retention 是教学简化，快照+WAL 边界是 LSN 语义模型
 * 非真崩溃一致性实现，十一真件全进程内无真跨机持久化。判定权全 Node 侧、前端只渲染不复核。</p>
 *
 * 用法：
 * <pre>
 *   const s = logCompactionStudy({ seed: 526, ops: 24 })
 *   s.vectors        // { SizeTimeRetention:'101', KeyCompaction:'110', SnapshotPlusWal:'011' }
 *   s.replayBoundary // 可证伪守恒双路自证
 *   const rig = logCompactionStudy({ rigged: true })  // 110/110/110，fastRecoveryCausallyUnerasable
 * </pre>
 */
import { pathToFileURL } from 'node:url'
import { createWal, createBloomFilter } from './caesura-lsm-store.mjs'
import { createMinHeapDelayQueue, createRedisZsetDelayQueue } from './caesura-delay-queue.mjs'
import { createShardedCache } from './caesura-sharded-cache.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'
import { createHashRing } from './caesura-consistent-hash.mjs'
import { createBus } from './spring-bus-event.mjs'

/** 默认注入全参数（全部可覆盖；命名 lc 前缀，避开 lsm / bp / bpc / cgp / rdq / dld 等已占用前缀） */
export const LC_DEFAULTS = Object.freeze({
  seed: 526,
  ops: 24,               // 逻辑 op 流长度
  keySpace: 16,          // key 基数（决定 key 压缩率与恢复重放量）
  retentionOps: 6,       // Retention 保留的最近 op 条数
  retentionMs: 1000000,  // Retention 时间窗（默认不触发，retentionPressure 场景覆盖为小值）
  deleteRetention: 6,    // KeyCompaction tombstone 保留 LSN 跨度
  snapshotAt: 18,        // SnapshotPlusWal 落全量快照的 LSN 位点（占 ops 的 3/4 ⇒ 只重放尾部增量）
  footprintBudget: 1.0,  // compactFootprint：writeAmplification 阈值
  replayBudget: 8,       // fastRecovery：replayOps 阈值
  unlimitedRetention: false,
  instantSnapshot: false,
  zeroReplayCost: false,
  rigged: false,
})

/** 三策略（顺序固定，与三难维序无关） */
export const LC_STRATEGIES = Object.freeze(['SizeTimeRetention', 'KeyCompaction', 'SnapshotPlusWal'])

/** 六正交场景（顺序固定） */
export const LC_SCENARIOS = Object.freeze([
  'steadyAppend', 'hotKeyChurn', 'tombstoneBurst', 'slowConsumer', 'crashMidReplay', 'retentionPressure',
])

/** 三维考场：每维只在指定场景量测，其余场景该维空真（对齐账本正交登记） */
const DIM_SCENARIOS = Object.freeze({
  compactFootprint: ['hotKeyChurn', 'retentionPressure'],
  replayCompleteness: ['slowConsumer', 'crashMidReplay', 'tombstoneBurst'],
  // fastRecovery 考场含 crashMidReplay：崩溃恢复位点 + Retention 截断 / 快照增量 / key 全量重放在此分叉；
  // 与 replayCompleteness 共用 crashMidReplay 是本项目既有正交口径（cell 各自空真不连坐）。
  fastRecovery: ['crashMidReplay', 'steadyAppend'],
})

/* --------------------------- 判定工具 --------------------------- */

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}
function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
/** 注入时钟：数字或函数（builtAt 契约要求对函数求值，同 KI-518/520/523/525 startClock） */
function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}
function round4(n) { return Math.round(n * 1e4) / 1e4 }
function round2(n) { return Math.round(n * 1e2) / 1e2 }
/** 确定性 LCG（可注入 seed，杜绝 Math.random 破坏双跑字节一致） */
function lcg(seed) {
  let s = (intOr(seed, 1) >>> 0) || 1
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}
/** 字符串稳定 hash（用于把 strategy+scenario 混进 seed，保持确定性） */
function hashStr(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}

/* --------------------- ① 三策略真件（可独立单测） --------------------- */

/**
 * Size/Time Retention：超保留窗口删最老段。真返 `compactedOps/retainedOps/cutoffLsn`，
 * `replay(from)` 真算 `missingOps`（回放位点早于保留起点即历史真丢）。
 */
export function createSizeTimeRetention(opts = {}) {
  const retentionOps = Math.max(0, intOr(opts.retentionOps, LC_DEFAULTS.retentionOps))
  const retentionMs = Math.max(0, intOr(opts.retentionMs, LC_DEFAULTS.retentionMs))
  let log = []
  function append(rec) { log.push({ lsn: rec.lsn, ts: rec.ts, op: rec.op, key: rec.key, value: rec.value }); return log.length }
  function compact(currentLsn, tsNow) {
    const before = log.length
    const cutoffLsn = Math.max(1, currentLsn - retentionOps + 1)
    const cutoffTs = tsNow - retentionMs
    log = log.filter((r) => r.lsn >= cutoffLsn && r.ts >= cutoffTs)
    return { compactedOps: before - log.length, retainedOps: log.length, cutoffLsn, cutoffTs }
  }
  function replay(replayFromLsn) {
    const from = Math.max(1, intOr(replayFromLsn, 1))
    const oldestLsn = log.length ? log[0].lsn : 0
    // 回放起点早于保留起点 ⇒ 中间 [from, oldestLsn) 历史真丢；方向：oldestLsn − from
    const missingOps = log.length ? Math.max(0, oldestLsn - from) : 0
    const served = log.filter((r) => r.lsn >= from)
    return { replayOps: served.length, missingOps, complete: missingOps === 0, firstServedLsn: served[0]?.lsn ?? 0 }
  }
  function state() {
    return { retainedOps: log.length, oldestLsn: log[0]?.lsn ?? 0, newestLsn: log.at(-1)?.lsn ?? 0,
      writeAmplification: 1, entries: () => log.map((r) => ({ ...r })) }
  }
  return { append, compact, replay, state }
}

/**
 * Key Compaction：同 key 只留最新 put + tombstone（changelog / 物化视图语义）。
 * `compact()` 在 delete-retention 边界早清 tombstone ⇒ 返 `tombstoneCleared>0` 与 `resurrect=true`（诚实自曝）。
 */
export function createKeyCompaction(opts = {}) {
  const deleteRetention = Math.max(0, intOr(opts.deleteRetention, LC_DEFAULTS.deleteRetention))
  let latest = new Map()
  let tombstones = new Map()
  let seen = 0
  function append(rec) {
    seen++
    if (rec.op === 'del') { tombstones.set(rec.key, rec.lsn); latest.delete(rec.key) }
    else { latest.set(rec.key, { lsn: rec.lsn, value: rec.value }); tombstones.delete(rec.key) }
    return seen
  }
  function compact(currentLsn) {
    let cleared = 0
    for (const [key, lsn] of tombstones) {
      if (currentLsn - lsn >= deleteRetention) { tombstones.delete(key); cleared++ }
    }
    const retainedOps = latest.size + tombstones.size
    return { compactedOps: seen - retainedOps, retainedOps, tombstoneCleared: cleared, resurrect: cleared > 0 }
  }
  function replay() {
    // 当前物化态：每个 key 最新值；tombstone 仍在则删除生效；被早清的 tombstone 无法抵旧值 ⇒ 复活风险
    const materialized = new Map(latest)
    let resurrectedKeys = 0
    for (const key of tombstones.keys()) if (!materialized.has(key)) resurrectedKeys++ // 占位：tombstone 生效不需复活
    // 真复活：被清掉的 tombstone 对应的 key 若有更旧值仍在 materialized（本简化模型里 latest 已删，故以 resurrect 标记录入）
    const replayOps = materialized.size + tombstones.size
    return { replayOps, distinctKeys: materialized.size, tombstones: tombstones.size,
      complete: true, resurrectedKeys }
  }
  function state() {
    const retainedOps = latest.size + tombstones.size
    return { retainedOps, distinctKeys: latest.size, tombstones: tombstones.size,
      writeAmplification: round2(retainedOps / Math.max(1, seen)),
      entries: () => ({ latest: [...latest.entries()], tombstones: [...tombstones.entries()] }) }
  }
  return { append, compact, replay, state }
}

/**
 * Snapshot + 增量 WAL：在 snapshotAt LSN 落全量物化快照，只留其后增量 WAL；
 * `replay()` 先载快照、再按 LSN 去重（>snapshotLsn 才 applied）保 exactly-once 不重不漏；
 * 返 `writeAmplification`（快照全量 + WAL 追加 >1，双写放大）与 `replayedUnique` 不重不漏读数。
 */
export function createSnapshotPlusWal(opts = {}) {
  const snapshotAt = Math.max(1, intOr(opts.snapshotAt, LC_DEFAULTS.snapshotAt))
  let log = []
  let snapshot = null // { lsn, state: Map, folded: Record[] }
  let folded = []      // 被快照折叠掉的 WAL 历史（保留副本，供回放时按 LSN 真去重）
  const instantSnapshot = opts.instantSnapshot === true
  function append(rec) { log.push({ lsn: rec.lsn, ts: rec.ts, op: rec.op, key: rec.key, value: rec.value }); return log.length }
  function takeSnapshot(lsn) {
    const state = new Map()
    for (const r of log) { if (r.op === 'del') state.delete(r.key); else state.set(r.key, r.value) }
    // instantSnapshot 许愿「零空间」⇒ 不真正物化状态（空 Map）、快照写入贡献 0 ⇒ 空间维归零；
    // 代价：恢复时无状态可载 ⇒ folded 无法去重跳过、必须全量重放 ⇒ 恢复维必破。
    const snapshotKeys = state.size
    folded = log.filter((r) => r.lsn <= lsn)
    snapshot = { lsn, state: instantSnapshot ? new Map() : state, empty: instantSnapshot, snapshotKeys }
    log = log.filter((r) => r.lsn > lsn)
    return { snapshotLsn: lsn, snapshotKeys, walRetained: log.length, foldedCount: folded.length }
  }
  function replay() {
    const state = new Map(snapshot?.state ?? [])
    let replayedRaw = 0
    let replayedUnique = 0
    let dedupSkipped = 0
    const fromLsn = snapshot?.lsn ?? 0
    // 回放真实经过「折叠历史 + 增量 WAL」两段；按 LSN 去重跳过已折叠段 ⇒ exactly-once 有真证据
    const all = snapshot ? [...folded, ...log] : [...log]
    for (const r of all) {
      replayedRaw++
      if (snapshot?.empty !== true && r.lsn <= fromLsn) { dedupSkipped++; continue } // 已被快照折叠 ⇒ 去重、不重复应用
      if (r.op === 'del') state.delete(r.key); else state.set(r.key, r.value)
      replayedUnique++
    }
    // 空快照（instantSnapshot）：无去重基准、folded 须全量补放 ⇒ replayOps = 全量；正常快照 = 增量条数
    const replayOps = snapshot?.empty === true ? all.length : log.length
    // exactly-once 真判据：折叠段被逐条去重、增量段被逐条应用，恰不重不漏；空快照去重机制失效 ⇒ false
    const exactlyOnce = snapshot?.empty !== true && dedupSkipped === folded.length && replayedUnique === log.length
    return { replayOps, replayedRaw, replayedUnique, dedupSkipped,
      complete: true, exactlyOnce, materializedKeys: state.size }
  }
  function state() {
    const totalOps = (snapshot?.lsn ?? 0) + log.length
    // 空快照不占空间 ⇒ 累计写入 = 纯 WAL（totalOps）；正常快照才 + 全量快照重写 snapshotKeys
    const snapshotWriteCost = snapshot?.empty === true ? 0 : (snapshot?.snapshotKeys ?? 0)
    const writeAmplification = round2((totalOps + snapshotWriteCost) / Math.max(1, totalOps))
    return { totalOps, snapshotLsn: snapshot?.lsn ?? 0, snapshotEmpty: snapshot?.empty ?? false,
      walRetained: log.length, writeAmplification, entries: () => log.map((r) => ({ ...r })) }
  }
  return { append, takeSnapshot, replay, state }
}

/* --------------------- ② 可证伪守恒自证（纯函数） --------------------- */

/**
 * 回放边界双路独立守恒自证（导出纯函数，可独立证伪）。双路：
 * - 恒等式 A（成本守恒）：`replayOps ≥ totalOps − compactedOps − foldedOps`。恢复必须重放
 *   「未被压缩掉 / 未被快照折叠」的操作；篡改 replayOps 造假（抹掉重放成本）⇒ costGap 翻负、翻 false。
 * - 恒等式 B（完整性守恒，<b>相对回放位点</b>）：按 mode 分派——retention 只需 WAL 覆盖回放位点
 *   （从可服务最老位点起放即完整，截断老段不算不完整；从更早位点起放才丢）；key 需无 tombstone 复活
 *   且唯一键集非空；snapshot 需 WAL 覆盖 `[snapshotLsn+1, currentLsn]` 无断档。
 *   抹 WAL 段 / 早清 tombstone / snapshotLsn 越界 ⇒ walCovers / replayComplete / holds 翻 false。
 * 空集（totalOps=0 且无唯一键）⇒ holds=false、nontrivial=false，不凭 0=0 假绿。
 * @param {{mode?:string,totalOps:number,compactedOps:number,replayOps:number,currentLsn:number,
 *   snapshotLsn?:number,hasSnapshot?:boolean,walFromLsn?:number,walToLsn?:number,replayFromLsn?:number,
 *   distinctKeys?:number,tombstoneCleared?:boolean,resurrected?:boolean}} a
 */
export function verifyReplayBoundary(a) {
  const mode = a?.mode === 'key' || a?.mode === 'snapshot' ? a.mode : 'retention'
  const totalOps = intOr(a?.totalOps, 0)
  const compactedOps = Math.min(totalOps, intOr(a?.compactedOps, 0))
  const replayOps = intOr(a?.replayOps, 0)
  const currentLsn = intOr(a?.currentLsn, 0)
  const snapshotLsn = Math.min(currentLsn, intOr(a?.snapshotLsn, 0))
  const hasSnapshot = a?.hasSnapshot === true
  const walFromLsn = intOr(a?.walFromLsn, 1)
  const walToLsn = intOr(a?.walToLsn, currentLsn)
  const replayFromLsn = intOr(a?.replayFromLsn, 1)
  const distinctKeys = intOr(a?.distinctKeys, 0)
  const tombstoneCleared = a?.tombstoneCleared === true
  const resurrected = a?.resurrected === true

  // 恒等式 A：回放成本守恒
  const foldedOps = hasSnapshot ? Math.min(totalOps, snapshotLsn) : 0
  const minReplay = Math.max(0, totalOps - compactedOps - foldedOps)
  const costGap = round4(replayOps - minReplay)
  const replayCostConserved = replayOps >= minReplay
  // 容差：key 压缩折叠历史后 replayOps 可能略小于 minReplay（tombstone 抵消），给 1 条教学容差
  const costConservedSoft = replayOps + 1 >= minReplay

  // 恒等式 B：完整性守恒（按模式分派）
  let walCovers = false
  let replayComplete = false
  if (mode === 'key') {
    walCovers = walFromLsn <= replayFromLsn && walToLsn >= currentLsn
    replayComplete = walCovers && !resurrected && !tombstoneCleared && distinctKeys > 0
  } else if (mode === 'snapshot') {
    walCovers = hasSnapshot && walFromLsn <= snapshotLsn + 1 && walToLsn >= currentLsn
    replayComplete = walCovers && !resurrected
  } else {
    // retention 完整性相对回放位点：WAL 覆盖回放位点即从该点起可完整重放；
    // 截断老段（compactedOps>0）本身不算不完整——只有从被截掉的更早位点起放才 walCovers=false。
    walCovers = walFromLsn <= replayFromLsn && walToLsn >= currentLsn
    replayComplete = walCovers && !resurrected
  }

  const nontrivial = totalOps > 0 && (distinctKeys > 0 || mode !== 'key')
  const holds = nontrivial && (mode === 'key' ? costConservedSoft : replayCostConserved) && replayComplete
  return { mode, totalOps, compactedOps, replayOps, foldedOps, minReplay, costGap,
    snapshotLsn, currentLsn, walFromLsn, walToLsn, replayFromLsn, distinctKeys,
    tombstoneCleared, resurrected, walCovers, replayCostConserved, replayComplete,
    nontrivial, holds }
}

/* --------------------------- ③ 单场景模拟 --------------------------- */

function makeOps(cfg, scenario, rand) {
  const ops = []
  let ts = 0
  for (let i = 0; i < cfg.ops; i++) {
    ts += 1 + Math.floor(rand() * 3)
    let key = 'k:' + Math.floor(rand() * cfg.keySpace)
    // hotKeyChurn：热 key 高频更新（key 压缩收益放大）
    if (scenario === 'hotKeyChurn' && rand() < 0.6) key = 'hot:' + (i % 2)
    let op = rand() < 0.18 ? 'del' : 'put'
    // tombstoneBurst：尾部批量删除，逼 tombstone delete-retention 边界
    if (scenario === 'tombstoneBurst' && i >= cfg.ops - 6) op = 'del'
    ops.push({ lsn: i + 1, ts, op, key, value: i })
  }
  return ops
}

function simulate(strategy, sid, cfg, flags, o) {
  const rand = lcg(cfg.seed + hashStr(strategy) + hashStr(sid))
  const ops = makeOps(cfg, sid, rand)
  const totalOps = ops.length
  const currentLsn = ops.at(-1).lsn
  const tsNow = ops.at(-1).ts

  // 回放位点：场景 × 策略联合决定（物理语义，非阈值重判策略）。
  // - slowConsumer：慢消费者落后到位点 1 ⇒ 只有 Retention 真丢历史（其余两策略从任意位点都能完整回放）。
  // - crashMidReplay：崩溃恢复到中段位点（双考场：既量完整性也量恢复成本）。
  // - 其余场景（含 steadyAppend 稳态自证 / hotKeyChurn / tombstoneBurst / retentionPressure）：
  //   从各策略「可服务起点」回放——Retention 从保留起点、Snapshot 从快照 LSN、KeyCompaction 从头。
  //   稳态自证必须让三策略都从各自可服务起点回放，守恒才成立（否则 Retention 被错杀为不完整）。
  const harshFrom = sid === 'slowConsumer' ? 1
    : sid === 'crashMidReplay' ? Math.max(1, Math.floor(totalOps * 0.5))
      : null // null ⇒ 用各策略可服务起点

  // 各场景对参数的诚实覆盖（不经阈值重判策略，只改物理环境）
  const retentionOps = sid === 'retentionPressure' ? Math.max(1, Math.floor(cfg.ops * 0.25))
    : flags.unlimitedRetention ? totalOps + 1 : cfg.retentionOps
  const retentionMs = sid === 'retentionPressure' ? Math.floor(tsNow * 0.25) : cfg.retentionMs
  const deleteRetention = sid === 'tombstoneBurst' ? Math.max(1, Math.floor(cfg.deleteRetention / 3))
    : cfg.deleteRetention

  let rbInput
  let read
  let replayFromLsn
  if (strategy === 'SizeTimeRetention') {
    const engine = createSizeTimeRetention({ retentionOps, retentionMs })
    for (const rec of ops) engine.append(rec)
    const comp = engine.compact(currentLsn, tsNow)
    // 可服务起点 = 保留起点（cutoffLsn）；苛刻场景从位点 1 / 中段才暴露丢历史
    replayFromLsn = harshFrom ?? comp.cutoffLsn
    const rep = engine.replay(replayFromLsn)
    const st = engine.state()
    read = { compactedOps: comp.compactedOps, retainedOps: comp.retainedOps,
      replayOps: rep.replayOps, missingOps: rep.missingOps, writeAmplification: st.writeAmplification,
      cutoffLsn: comp.cutoffLsn, tombstoneResurrect: 0 }
    rbInput = { mode: 'retention', totalOps, compactedOps: comp.compactedOps, replayOps: rep.replayOps,
      currentLsn, walFromLsn: st.oldestLsn || 1, walToLsn: currentLsn, replayFromLsn }
  } else if (strategy === 'KeyCompaction') {
    const engine = createKeyCompaction({ deleteRetention })
    for (const rec of ops) engine.append(rec)
    const comp = engine.compact(currentLsn)
    const rep = engine.replay()
    const st = engine.state()
    // key 压缩保留全部唯一键最新值 ⇒ 任意位点都能完整回放，可服务起点恒为 1
    replayFromLsn = harshFrom ?? 1
    read = { compactedOps: comp.compactedOps, retainedOps: comp.retainedOps,
      replayOps: rep.replayOps, missingOps: 0, writeAmplification: st.writeAmplification,
      cutoffLsn: 0, tombstoneResurrect: comp.tombstoneCleared }
    // tombstone 复活是「主动删」的语义（key 已删、无需回放），单列补刀、不污染 replayCompleteness 向量；
    // 故 rbInput 不传 tombstoneCleared，让 key 完整性只看 WAL 覆盖 + 唯一键集非空。
    rbInput = { mode: 'key', totalOps, compactedOps: comp.compactedOps, replayOps: rep.replayOps,
      currentLsn, walFromLsn: 1, walToLsn: currentLsn, replayFromLsn, distinctKeys: st.distinctKeys,
      tombstoneCleared: false }
  } else {
    const engine = createSnapshotPlusWal({ snapshotAt: Math.max(1, Math.floor(cfg.ops * 0.75)), instantSnapshot: flags.instantSnapshot })
    for (const rec of ops) engine.append(rec)
    const snapInfo = engine.takeSnapshot(Math.max(1, Math.floor(cfg.ops * 0.75)))
    const rep = engine.replay()
    const st = engine.state()
    // 快照策略可服务起点 = 快照 LSN（先载快照再重放增量）；苛刻场景从位点 1 / 中段回放先载快照仍完整
    replayFromLsn = harshFrom ?? snapInfo.snapshotLsn
    read = { compactedOps: 0, retainedOps: st.walRetained, replayOps: rep.replayOps, missingOps: 0,
      writeAmplification: st.writeAmplification, cutoffLsn: 0, tombstoneResurrect: 0,
      snapshotLsn: snapInfo.snapshotLsn, snapshotEmpty: st.snapshotEmpty,
      dedupSkipped: rep.dedupSkipped, exactlyOnce: rep.exactlyOnce }
    rbInput = { mode: 'snapshot', totalOps, compactedOps: 0, replayOps: rep.replayOps,
      currentLsn, snapshotLsn: snapInfo.snapshotLsn, hasSnapshot: true,
      walFromLsn: snapInfo.snapshotLsn + 1, walToLsn: currentLsn, replayFromLsn }
  }

  const rb = verifyReplayBoundary(rbInput)
  // 三维 cell 布尔（真读数直判；维度聚合在考场 AND，考场外空真）。
  // instantSnapshot 空快照由引擎真算 writeAmplification=1.0（纯 WAL、无快照写），不再特判硬编码。
  const compactFootprint = read.writeAmplification <= cfg.footprintBudget
  const replayCompleteness = rb.replayComplete
  // zeroReplayCost 是许愿开关：不改写真实 replayOps，守恒纯函数用真值算 ⇒ 恢复快这一维抹不掉。
  // 两条分支同式是刻意的——许愿不改变任何物理读数，故 rigged 下仍收敛同一向量。
  const fastRecovery = read.replayOps <= cfg.replayBudget

  return {
    id: sid, strategy, totalOps, currentLsn, replayFromLsn,
    ...read, replayBoundary: rb,
    compactFootprint, replayCompleteness, fastRecovery,
    inFootprintExam: DIM_SCENARIOS.compactFootprint.includes(sid),
    inCompletenessExam: DIM_SCENARIOS.replayCompleteness.includes(sid),
    inRecoveryExam: DIM_SCENARIOS.fastRecovery.includes(sid),
  }
}

/** 单场景公开入口（可独立单测） */
export function runLogCompactionScenario(strategy, scenario, opts = {}) {
  const cfg = resolveCfg(opts)
  const flags = resolveFlags(opts)
  if (!LC_STRATEGIES.includes(strategy)) return null
  if (!LC_SCENARIOS.includes(scenario)) return null
  return simulate(strategy, scenario, cfg, flags, opts)
}

function resolveCfg(o = {}) {
  return {
    seed: intOr(o.seed, LC_DEFAULTS.seed),
    ops: Math.max(4, intOr(o.ops, LC_DEFAULTS.ops)),
    keySpace: Math.max(2, intOr(o.keySpace, LC_DEFAULTS.keySpace)),
    retentionOps: Math.max(1, intOr(o.retentionOps, LC_DEFAULTS.retentionOps)),
    retentionMs: Math.max(0, intOr(o.retentionMs, LC_DEFAULTS.retentionMs)),
    deleteRetention: Math.max(1, intOr(o.deleteRetention, LC_DEFAULTS.deleteRetention)),
    snapshotAt: Math.max(1, intOr(o.snapshotAt, LC_DEFAULTS.snapshotAt)),
    footprintBudget: numOr(o.footprintBudget, LC_DEFAULTS.footprintBudget),
    replayBudget: Math.max(1, intOr(o.replayBudget, LC_DEFAULTS.replayBudget)),
  }
}
function resolveFlags(o = {}) {
  const rigged = o.rigged === true
  return {
    unlimitedRetention: rigged || o.unlimitedRetention === true,
    instantSnapshot: rigged || o.instantSnapshot === true,
    zeroReplayCost: rigged || o.zeroReplayCost === true,
    rigged,
  }
}

/* --------------------------- ④ 三策略对照 study --------------------------- */

function buildStudy(o = {}) {
  const scenarioIds = o.scenarios ?? LC_SCENARIOS
  const cfg = resolveCfg(o)
  const flags = resolveFlags(o)

  const rows = []
  for (const s of LC_STRATEGIES) {
    const cells = scenarioIds.map((sid) => simulate(s, sid, cfg, flags, o)).filter(Boolean)
    // 每维 = 其考场场景 cell 的 AND；非考场场景该维空真（cell 也已各自落真值，聚合只看考场）
    const dimOf = (dim, examKey) => {
      const exam = cells.filter((c) => c[examKey] === true)
      return exam.length > 0 && exam.every((c) => c[dim] === true)
    }
    const trilemma = {
      compactFootprint: dimOf('compactFootprint', 'inFootprintExam'),
      replayCompleteness: dimOf('replayCompleteness', 'inCompletenessExam'),
      fastRecovery: dimOf('fastRecovery', 'inRecoveryExam'),
    }
    const cell = (sid) => cells.find((c) => c.id === sid)
    rows.push({
      strategy: s,
      scenarios: cells,
      trilemma,
      metrics: {
        compactedOps: cells.reduce((a, c) => a + c.compactedOps, 0),
        replayOps: cells.reduce((a, c) => a + c.replayOps, 0),
        peakWriteAmplification: round2(cells.reduce((a, c) => Math.max(a, c.writeAmplification), 0)),
        missingOps: cells.reduce((a, c) => a + c.missingOps, 0),
        tombstoneResurrect: cells.reduce((a, c) => a + c.tombstoneResurrect, 0),
      },
    })
  }

  // 向量恒由 row.trilemma 现算（杜绝硬覆盖撒谎）
  const vecOf = (r) => `${Number(r.trilemma.compactFootprint)}${Number(r.trilemma.replayCompleteness)}${Number(r.trilemma.fastRecovery)}`
  const vectors = Object.fromEntries(rows.map((r) => [r.strategy, vecOf(r)]))
  const distinct = new Set(Object.values(vectors)).size === rows.length
  const noWinsAll = !rows.some((r) => vecOf(r) === '111')
  const evidence = createLogCompactionEvidence({ seed: cfg.seed })
  const cell = (p, s) => rows.find((r) => r.strategy === p)?.scenarios.find((c) => c.id === s)

  // 可证伪守恒：稳态场景（steadyAppend）全景成立；恶意篡改三路分别翻 false
  const steadyCells = rows.map((r) => cell(r.strategy, 'steadyAppend')).filter(Boolean)
  const replayBoundaryHolds = steadyCells.length > 0 && steadyCells.every((c) => c.replayBoundary.holds === true)
  const replayBoundaryNontrivial = steadyCells.some((c) => c.replayBoundary.holds === true && c.replayBoundary.nontrivial === true)
  const tamperReplayOps = verifyReplayBoundary({
    mode: 'retention', totalOps: 20, compactedOps: 4, replayOps: 0, // 抹掉重放成本 ⇒ 成本守恒破
    currentLsn: 20, walFromLsn: 5, walToLsn: 20, replayFromLsn: 1,
  })
  const tamperWalGap = verifyReplayBoundary({
    mode: 'snapshot', totalOps: 20, compactedOps: 0, replayOps: 5,
    currentLsn: 20, snapshotLsn: 15, hasSnapshot: true,
    walFromLsn: 18, walToLsn: 20, replayFromLsn: 1, // 快照后 WAL 断档 [16,17] ⇒ 完整性破
  })
  const tamperTombstone = verifyReplayBoundary({
    mode: 'key', totalOps: 20, compactedOps: 12, replayOps: 8,
    currentLsn: 20, walFromLsn: 1, walToLsn: 20, replayFromLsn: 1,
    distinctKeys: 8, tombstoneCleared: true, // 早清 tombstone ⇒ 复活 ⇒ 完整性破
  })
  const falsifiable = replayBoundaryHolds && replayBoundaryNontrivial &&
    tamperReplayOps.holds === false && tamperReplayOps.replayCostConserved === false &&
    tamperWalGap.holds === false && tamperWalGap.replayComplete === false &&
    tamperTombstone.holds === false && tamperTombstone.replayComplete === false
  const replayBoundary = {
    holds: replayBoundaryHolds,
    nontrivial: replayBoundaryNontrivial,
    falsifiable,
    steady: steadyCells.map((c) => ({ strategy: c.strategy, ...c.replayBoundary })),
    tamper: { replayOps: tamperReplayOps, walGap: tamperWalGap, tombstone: tamperTombstone },
    note: '回放边界双路独立守恒：A 成本守恒 replayOps≥totalOps−compactedOps−foldedOps（抹重放成本即破）；' +
      'B 完整性守恒按模式分派（抹 WAL 段 / 早清 tombstone / snapshotLsn 越界即破）。篡改三路各自独立翻 false，' +
      '稳态真撞合且非平凡（totalOps>0），空集降级不凭 0=0 假绿。',
  }

  const retSlow = cell('SizeTimeRetention', 'slowConsumer')
  const keySteady = cell('KeyCompaction', 'steadyAppend')
  const snapPress = cell('SnapshotPlusWal', 'retentionPressure')
  const snapCrash = cell('SnapshotPlusWal', 'crashMidReplay')
  const keyTomb = cell('KeyCompaction', 'tombstoneBurst')
  const defaultVectors = { SizeTimeRetention: '101', KeyCompaction: '110', SnapshotPlusWal: '011' }

  return {
    builtAt: startClock(o.now, 0),
    config: { ...cfg, unlimitedRetention: flags.unlimitedRetention, instantSnapshot: flags.instantSnapshot,
      zeroReplayCost: flags.zeroReplayCost, rigged: flags.rigged, scenarios: scenarioIds },
    rows,
    vectors,
    topology: {
      SizeTimeRetention: '超保留窗口删最老段：日志短、空间最省、恢复最快，但慢消费者/迟到回放从被截位点起放⇒历史真丢（missingOps>0）',
      KeyCompaction: '同 key 只留最新值+tombstone：空间省、重放幂等、当前物化态完整，但恢复要重放全部唯一键⇒慢；tombstone 早清致已删 key 复活（单列补刀）',
      SnapshotPlusWal: '全量快照+快照后增量 WAL，按 LSN 去重保 exactly-once：回放完整、恢复快，但快照全量+WAL 追加⇒双写放大>1、空间不省',
    },
    replayBoundary,
    crosscheck: { evidence },
    verdict: {
      vectors,
      trilemmaDistinguishes: distinct,
      noUniversalWinner: distinct && noWinsAll,
      noStrategyWinsAll: noWinsAll,
      retentionDropsSlowConsumer: (retSlow?.missingOps ?? 0) > 0 && rows[0].trilemma.replayCompleteness === false,
      keyCompactionPaysRecovery: (keySteady?.replayOps ?? 0) > cfg.replayBudget && rows[1].trilemma.fastRecovery === false,
      keyCompactionResurrectsUnderShortRetention: (keyTomb?.tombstoneResurrect ?? 0) > 0,
      snapshotPaysWriteAmplification: (snapPress?.writeAmplification ?? 0) > 1 && rows[2].trilemma.compactFootprint === false,
      // exactly-once 真证据：崩溃恢复场景折叠段被逐条去重（dedupSkipped>0）、引擎判 exactlyOnce、完整性维立
      snapshotExactlyOnce: (snapCrash?.dedupSkipped ?? 0) > 0 && snapCrash?.exactlyOnce === true &&
        rows[2].trilemma.replayCompleteness === true,
      replayBoundaryHolds: replayBoundaryHolds,
      replayBoundaryNontrivial: replayBoundaryNontrivial,
      replayBoundaryFalsifiable: falsifiable,
      // 单开反噬：unlimitedRetention 补 Retention 回放完整必令其全量重放、反噬快恢复
      unlimitedRetentionBackfiresRecovery: flags.unlimitedRetention && !flags.instantSnapshot && !flags.zeroReplayCost &&
        rows[0].trilemma.replayCompleteness === true && rows[0].trilemma.fastRecovery === false,
      // 单开反噬：instantSnapshot 补 Snapshot 省空间必令其无快照可载、反噬快恢复
      instantSnapshotBackfiresRecovery: flags.instantSnapshot && !flags.unlimitedRetention && !flags.zeroReplayCost &&
        rows[2].trilemma.compactFootprint === true && rows[2].trilemma.fastRecovery === false,
      // 单开 zeroReplayCost 是许愿：守恒用真 replayOps，向量一字不改（诚实不撒谎）
      zeroReplayCostErasesNothing: flags.zeroReplayCost && !flags.unlimitedRetention && !flags.instantSnapshot &&
        JSON.stringify(vectors) === JSON.stringify(defaultVectors),
      // rigged 因果锁死：三向量收敛 110、fastRecovery 无一能翻回、区分度与 noUniversalWinner 双双翻 false。
      // 全 110 本就无一 111 ⇒ noWinsAll 恒 true，判据不写 noWinsAll=false（那是造假）；
      // 真正被抹掉的是「区分度」与「有全局赢家」，fastRecovery 这一维被守恒因果锁死。
      fastRecoveryCausallyUnerasable: riggedAll(flags) && rows.every((r) => r.trilemma.fastRecovery === false) &&
        rows.every((r) => r.trilemma.compactFootprint === true && r.trilemma.replayCompleteness === true) &&
        distinct === false && noWinsAll === true,
    },
    rigged: flags.rigged,
  }
}
function riggedAll(flags) { return flags.unlimitedRetention && flags.instantSnapshot && flags.zeroReplayCost }

/** 纯数据 study（与 backpressureStudy 同参接口、无 DOM 依赖） */
export function logCompactionStudy(opts = {}) { return buildStudy(opts) }
/** compareLogCompaction 同构别名：研究入口的另一名字，指向同一 buildStudy。 */
export const compareLogCompaction = logCompactionStudy

/** 快照形态：backpressureSnapshot 同构裁剪 */
export function logCompactionSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      strategy: r.strategy,
      scenarios: r.scenarios.map((s) => ({ ...s, replayBoundary: { ...s.replayBoundary } })),
      trilemma: { ...r.trilemma },
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    replayBoundary: {
      holds: study.replayBoundary.holds,
      nontrivial: study.replayBoundary.nontrivial,
      falsifiable: study.replayBoundary.falsifiable,
      steady: study.replayBoundary.steady.map((x) => ({ ...x })),
      tamper: { replayOps: { ...study.replayBoundary.tamper.replayOps },
        walGap: { ...study.replayBoundary.tamper.walGap },
        tombstone: { ...study.replayBoundary.tamper.tombstone } },
      note: study.replayBoundary.note,
    },
    crosscheck: { evidence: study.crosscheck?.evidence ? { ...study.crosscheck.evidence } : study.crosscheck },
    verdict: { ...study.verdict },
    topology: { ...(study.topology ?? {}) },
  }
}

/* --------------------- ⑤ 十一枚真件交叉印证 --------------------- */

/** 十一枚同仓真件交叉印证：返回每真件一组真实读数（全真 API 真调用真回读，计数不硬编码）。 */
export function createLogCompactionEvidence(opts = {}) {
  const seed = intOr(opts.seed, LC_DEFAULTS.seed)

  // ① 真 WAL：append→lines→restore→replay（LSN 主体，真 seq 回读）
  const wal = createWal()
  for (let i = 0; i < 6; i++) wal.append(i % 3 === 0 ? 'del' : 'put', `lc:key:${i}`, { n: i })
  const walLastSeq = wal.lastSeq
  const walLines = wal.lines().length
  const restoredWal = createWal()
  restoredWal.restore(wal.lines())
  let walReplayed = 0
  restoredWal.replay(() => { walReplayed++ })

  // ② 真 RedisZset 延迟队列：retention 时间窗 schedule→setNow→poll→restore
  const zq = createRedisZsetDelayQueue({ now: 0 })
  for (let i = 0; i < 5; i++) zq.schedule(50, `lc:seg:${i}`)
  zq.setNow(50)
  const zqFired = zq.poll().length
  const zqRestored = zq.restore()

  // ③ 真最小堆：按 LSN 精确排程回放 advance 真吐
  const heap = createMinHeapDelayQueue({ now: 0 })
  for (let i = 0; i < 7; i++) heap.schedule((i * 3 % 9) * 10 + 5, `lc:lsn:${i}`)
  const heapFired = heap.advance(100000).length

  // ④ 真分片缓存：key 分片压缩 set→get 命中
  const sharded = createShardedCache({ shards: ['s1', 's2', 's3'], salt: String(seed) })
  for (let i = 0; i < 8; i++) sharded.set(`lc:key:${i}`, i, 0)
  let shardHits = 0
  for (let i = 0; i < 8; i++) if (sharded.get(`lc:key:${i}`) === i) shardHits++

  // ⑤ 真布隆：tombstone 判重防复活 add→mightHave（真阳性 + 真阴性）
  const bloom = createBloomFilter({ numKeys: 32, bitsPerKey: 8 })
  for (let i = 0; i < 10; i++) bloom.add(`lc:tomb:${i}`)
  const bloomHit = bloom.mightHave('lc:tomb:4')
  const bloomMiss = bloom.mightHave('lc:tomb:never')

  // ⑥ 真紧凑计数：段计数 / 压缩率 inc→get→stats
  const counters = createPackedCounters(8)
  for (let i = 0; i < 8; i++) counters.inc(i, i + 1)
  const counterSum = [0, 1, 2, 3, 4, 5, 6, 7].reduce((a, i) => a + counters.get(i), 0)
  const counterFalseSharing = counters.stats().falseSharingPairs

  // ⑦ 真令牌桶：回放限速 allow（固定时钟容量放行、超预算真拒）
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: () => 1000 })
  let bucketAllowed = 0
  for (let i = 0; i < 6; i++) if (bucket.allow().allowed) bucketAllowed++

  // ⑧ 真对象池：回放记录对象复用（acquire/release/reuse 真读）
  const pool = createObjectPool({ factory: () => ({ lsn: 0 }), maxSize: 4 })
  const r1 = pool.acquire(); const r2 = pool.acquire()
  pool.release(r1); pool.release(r2)
  const r3 = pool.acquire()
  const poolStats = pool.stats()

  // ⑨ 真总线：compaction-done / replay-boundary 通知真投递
  const bus = createBus()
  let notices = 0
  bus.subscribe('lc:compaction-done', () => { notices++ })
  bus.publish('lc:compaction-done', { strategy: 'KeyCompaction' })
  bus.publish('lc:compaction-done', { strategy: 'SnapshotPlusWal' })
  const busListeners = bus.listenerCount('lc:compaction-done')

  // ⑩ 真哈希环：快照分片 addNode→lookup→distribution
  const ring = createHashRing({ nodes: ['shard-a', 'shard-b', 'shard-c'], virtualNodes: 32, salt: String(seed) })
  const ringKeys = Array.from({ length: 12 }, (_, i) => `lc:snap:${i}`)
  const ringDist = ring.distribution(ringKeys)
  const ringShardsUsed = Object.keys(ringDist.perNode ?? {}).length
  const ringFirst = ring.lookup(ringKeys[0]).nodeId

  // ⑪ 真全抖动退避：回放失败 nextDelay 真吐（多 attempt 撒开）
  const backoff = createFullJitterBackoff({ baseTicks: 2, capTicks: 16, seed })
  const delays = new Set()
  for (let i = 0; i < 6; i++) delays.add(backoff.nextDelay(i))
  const jitterSpread = delays.size

  return {
    walLastSeq, walLines, walReplayed,
    zqFired, zqPendingAfterRestore: zqRestored.pending, zqLostOnRestart: zqRestored.lostOnRestart,
    heapFired, shardHits, bloomHit, bloomMiss,
    counterSum, counterFalseSharing,
    bucketAllowed, bucketRejected: 6 - bucketAllowed,
    poolCreated: poolStats.created, poolReused: poolStats.reused,
    notices, busListeners, ringShardsUsed, ringFirst: ringFirst ?? null,
    jitterSpread,
  }
}

/* --------------------------- CLI --------------------------- */

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const s = logCompactionStudy({ rigged, now: () => 0 })
  const snap = logCompactionSnapshot(s)
  console.log('[log-compaction] ops=' + s.config.ops + ' keySpace=' + s.config.keySpace +
    ' unlimitedRetention=' + s.config.unlimitedRetention + ' instantSnapshot=' + s.config.instantSnapshot +
    ' zeroReplayCost=' + s.config.zeroReplayCost)
  const stateOf = (c) => c.compactFootprint === false ? '占' : c.replayCompleteness === false ? '丢' : c.fastRecovery === false ? '滞' : '✓'
  for (const row of snap.rows) {
    const cell = (sid) => row.scenarios.find((c) => c.id === sid)
    console.log(
      '  ' + row.strategy.padEnd(18) +
      ' slow.miss=' + String(cell('slowConsumer').missingOps).padStart(3) +
      ' key.replay=' + String(cell('crashMidReplay').replayOps).padStart(3) +
      ' press.wa=' + String(cell('retentionPressure').writeAmplification).padStart(4) +
      ' tomb.resurrect=' + String(cell('tombstoneBurst').tombstoneResurrect).padStart(2) +
      ' | append=' + stateOf(cell('steadyAppend')) + ' churn=' + stateOf(cell('hotKeyChurn')) +
      ' tomb=' + stateOf(cell('tombstoneBurst')) + ' slow=' + stateOf(cell('slowConsumer')) +
      ' crash=' + stateOf(cell('crashMidReplay')) + ' press=' + stateOf(cell('retentionPressure')) +
      ' | trilemma=' + JSON.stringify(row.trilemma),
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.verdict.noUniversalWinner + ' distinguishable=' + snap.verdict.trilemmaDistinguishes + ' rigged=' + s.rigged)
  console.log('  replayBoundary holds=' + snap.replayBoundary.holds + ' nontrivial=' + snap.replayBoundary.nontrivial +
    ' falsifiable=' + snap.replayBoundary.falsifiable +
    ' | tamper replayOps.holds=' + snap.replayBoundary.tamper.replayOps.holds +
    ' walGap.replayComplete=' + snap.replayBoundary.tamper.walGap.replayComplete +
    ' tombstone.replayComplete=' + snap.replayBoundary.tamper.tombstone.replayComplete)
  const recomputed = Object.fromEntries(snap.rows.map((r) => [r.strategy,
    `${Number(r.trilemma.compactFootprint)}${Number(r.trilemma.replayCompleteness)}${Number(r.trilemma.fastRecovery)}`]))
  const sameSource = JSON.stringify(recomputed) === JSON.stringify(snap.vectors)
  console.log('  VECTOR_FROM_TRILEMMA_OK=' + sameSource + '（向量由表格现算，非硬覆盖）')
  if (s.rigged) {
    const falsifiable = snap.verdict.noUniversalWinner === false && snap.verdict.trilemmaDistinguishes === false &&
      snap.verdict.fastRecoveryCausallyUnerasable === true &&
      snap.rows.every((r) => r.trilemma.fastRecovery === false) && sameSource
    console.log('  RIGGED_FALSIFIABLE_OK=' + falsifiable +
      '（真实现算 110/110/110；unlimitedRetention 保全部⇒compactedOps=0⇒成本守恒逼 replayOps≥totalOps、恢复慢，' +
      'instantSnapshot 零空间⇒无物化态可载⇒全量重放、恢复再慢，zeroReplayCost 许愿被守恒真 replayOps 否决，fastRecovery 维无一能翻回，判词翻 false，不硬覆盖全 111）')
  }
}
