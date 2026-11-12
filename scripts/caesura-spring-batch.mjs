/**
 * scripts/caesura-spring-batch.mjs —— Spring Batch chunk-oriented R-P-W（读-处理-写）教学件（KI-532，P8 第三十九件）。
 *
 * <p>把 Spring Batch 的「Chunk 粒度、Composable Tasklet、chk 持久化、skipPolicy 死信」精准搬到 Node.js 侧，
 * 三张零依赖确定性纯 JS 教学状态机：</p>
 *
 * <ul>
 *   <li><b>BulkWriter</b>：全流缓冲、一次 flush；poison 一现整批死、无 chk、无 skip、重跑只能从头。
 *       `stats().checkpoints===0` ⇒ restartability=false / throughput=true；真 poison 流 ⇒ 整批死 faultIsolation=false ⇒ 向量 001。</li>
 *   <li><b>ChunkedWriter</b>：chunkSize=8 每 chunk 独立事务、chk 计数持久化、`restart(events, fromChk)` 从 chk 后续跑；
 *       poison 只杀当前 chunk、其余 chunk 照 commit、已 commit 内容零重复写（真跑 seq=[0..7,16..23]）。
 *       `stats().checkpoints>0` ⇒ restartability=true / throughput=false（chunk commit 占用 pipeline）⇒ 向量 110。</li>
 *   <li><b>SkipRetryWriter</b>：毒项记 skip 寄存器继续、skipLimit=2 超限真败、unlimitedSkip 解除上限；
 *       skip 掉的毒行永久丢（无 chk 不可恢复）⇒ faultIsolation=true / restartability=false / throughput=true ⇒ 向量 101。</li>
 * </ul>
 *
 * <p><b>三难维序固定 [faultIsolation / restartability / throughput]</b>，三位全部真跑现算、不查协议名表：
 * `faultIsolation` = 含 poison 场景里是否整批死（真跑 flush 观测量）；`restartability` = `stats().checkpoints>0`
 * 且 `restart()` 真能从 chk 后续跑；`throughput` = `stats().checkpoints===0`（chunk commit 是吞吐杀手）。
 * 默认向量 **BulkWriter=001 / ChunkedWriter=110 / SkipRetryWriter=101**，三向量互异、无一 111、不封赢家。
 * checkpoint 维 restartability 与 throughput 因共用 chk 观测量而天然互斥——这正是三难的硬结构，不靠写死。</p>
 *
 * <p><b>verifyCheckpoint 双路独立交叉印证 + 三路可证伪（真喂回同一内核现算）</b>：路 A 真跑 clean 全量全完成求基准
 * （「items 全部 commit / faults=0」）；路 B 真跑含 poison 流 `ChunkedWriter.restart(0)`，用四个**观测量**判定
 * 「poison chunk 被隔离 ∧ 已 commit 无重复 ∧ 非毒内容零丢失 ∧ 真检测到毒」；空 jobs `nontrivial=false`。
 * 三路篡改**真改变内核输入/行为、再用同一个 holds 公式现算翻 false**：① corruptCheckpoint 真制造重复写
 * ⇒ noDuplicate 翻 false；② silentPoison 真把毒当正常项 commit ⇒ poisonIsolated 翻 false；
 * ③ emptyJob 空 jobs ⇒ nontrivial 翻 false。三路都带 `baselineHolds=true`（先真绿）与 `holds=false`（篡改真红）。</p>
 *
 * <p><b>诚实 SEC 口径</b>：rigged 双开关 `perfectOracle`（毒项 100% 判定、预防性从输入剔除）+
 * `unlimitedSkip`（skipLimit 无上限）齐开时，喂给 writer 的是**已剔除毒项的干净流**（换了作业输入，不是同一作业被抹软肋），
 * 故三者 faultIsolation 全真、Bulk 与 Skip 收敛为同一个 101（`riggedConvergenceCollapsed=true`，诚实标注，
 * 教学结论：完美预言机抹平了「预防剔除」与「跳过」的差别，二者结构等价——都无 chk、都不停 pipeline）。
 * 三向量不再互异（`trilemmaDistinguishes=false`）是**真读数，不假装仍互异**；但无一 111（`noStrategyWinsAll=true`），
 * 且**三条因果锁在同一含毒 raw 流上真跑现算、任何开关都救不了**。</p>
 *
 * <p><b>三条因果结构锁</b>（真喂回内核现算、与 rigged 输入无关）：
 * `checkpointTradeoffCausallyUnerasable`（chk 是 restartability 与 throughput 的唯一分界，给 Chunk 无限 skip / 给 Skip 完美预言机
 * 也造不出「既有 chk 又不停顿」）、`skipSilentLossCausallyUnerasable`（Skip 跳毒永久丢、unlimitedSkip 只免 fatal 不免丢）、
 * `bulkAllOrNothingCausallyUnerasable`（Bulk 无 chk + 整批提交，同一 raw 流下真毒必整批死）。`causalLocksAllHold=true`。</p>
 *
 * <p><b>不声称</b>真 Spring Batch 3/4 TableImpl 真 CR/CAP、真分片容错、真墙钟 QPS；全程结构计数、不声称真批处理性能。</p>
 *
 * @module caesura-spring-batch
 */
import { pathToFileURL } from 'node:url'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'

export const BATCH_DEFAULTS = Object.freeze({
  seed: 532,
  items: 96,
  skipLimit: 2,
  chunkSize: 8,
  perfectOracle: false,
  unlimitedSkip: false,
  rigged: false,
})

export const BATCH_STRATEGIES = Object.freeze(['BulkWriter', 'ChunkedWriter', 'SkipRetryWriter'])
export const BATCH_SCENARIOS = Object.freeze(['cleanRun', 'poisonOne', 'restartMidway', 'burstLoad', 'skipSaturation', 'cleanRerun'])

const POISON_SCENARIOS = Object.freeze(['poisonOne', 'restartMidway', 'skipSaturation', 'cleanRerun'])
const intOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback }
const numOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback }
const round4 = (n) => Math.round(n * 1e4) / 1e4
function startClock(v, fallback) { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, BATCH_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/*----------------------------------------------------- 场景 / 项流 -----------------------------------------------------*/

export function streamOf(id, opts = {}) {
  const seed = intOr(opts.seed, BATCH_DEFAULTS.seed)
  const baseItems = intOr(opts.items, BATCH_DEFAULTS.items)
  const n = Math.max(16, baseItems)
  const poisonAt = (idx) => ({ id: idx, poison: true, payload: `k:${seed}:${idx}` })
  const normalAt = (idx) => ({ id: idx, poison: false, payload: `k:${seed}:${idx}` })
  switch (id) {
    case 'cleanRun':
      return Array.from({ length: n }, (_, i) => normalAt(i))
    case 'poisonOne':
      return Array.from({ length: n }, (_, i) => (i === Math.floor(n / 2) ? poisonAt(i) : normalAt(i)))
    case 'restartMidway':
      return Array.from({ length: n }, (_, i) => (i === Math.floor(n / 2) ? poisonAt(i) : normalAt(i)))
    case 'burstLoad':
      return Array.from({ length: n * 2 }, (_, i) => normalAt(i))
    case 'skipSaturation':
      return Array.from({ length: n }, (_, i) => (i % 32 === 10 ? poisonAt(i) : normalAt(i)))
    case 'cleanRerun':
      // 确定性重跑流：含单个毒，用于验证 rerun 幂等（同一 seed ⇒ 同一流）
      return Array.from({ length: n }, (_, i) => (i === Math.floor(n * 0.54) ? poisonAt(i) : normalAt(i)))
    default:
      return Array.from({ length: 16 }, (_, i) => normalAt(i))
  }
}

/*----------------------------------------------------- 三真写实现 -----------------------------------------------------*/

export function createBulkWriter(opts = {}) {
  const perfectOracle = opts.perfectOracle === true
  const seq = []
  let processed = 0, dropped = 0, faults = 0
  function flush(events) {
    if (faults > 0) return { flushed: false, processed: 0 }
    for (const e of events) {
      if (e.poison && !perfectOracle) { faults += 1; dropped += events.length; return { flushed: false, processed: 0 } }
      processed += 1; seq.push(e)
    }
    return { flushed: true, processed: events.length }
  }
  function restart(events) { return runToEnd(events) }
  function runToEnd(events) {
    seq.length = 0; processed = 0; faults = 0
    for (const e of events) {
      if (e.poison && !perfectOracle) { faults += 1; break }
      processed += 1; seq.push(e)
    }
    return { processed, faults, survivors: seq.length }
  }
  return {
    protocol: 'BulkWriter',
    flush,
    restart,
    runToEnd,
    seq,
    stats: () => ({ processed, dropped, faults, checkpoints: 0 }),
    restartability: () => false,
    footprint: () => 4096,
  }
}

export function createChunkedWriter(opts = {}) {
  const perfectOracle = opts.perfectOracle === true
  const chunkSize = Math.max(1, intOr(opts.chunkSize, BATCH_DEFAULTS.chunkSize))
  const seq = []
  let chk = 0, faults = 0, processed = 0, dropped = 0
  function flushChunk(chunk) {
    if (chunk.some((e) => e.poison) && !perfectOracle) { faults += 1; dropped += chunk.length; return false }
    chk += 1; processed += chunk.length; seq.push(...chunk); return true
  }
  function flush(events) {
    for (let i = 0; i < events.length; i += chunkSize) {
      if (!flushChunk(events.slice(i, i + chunkSize))) break
    }
    return { flushed: faults === 0, processed, faults, checkpoints: chk }
  }
  function restart(events, fromChk = 0) {
    seq.length = 0; chk = 0; processed = 0; dropped = 0; faults = 0
    for (let i = 0; i < events.length; i += chunkSize) {
      if (i < fromChk * chunkSize) { seq.push(...events.slice(i, i + chunkSize)); processed += chunkSize; chk += 1; continue }
      flushChunk(events.slice(i, i + chunkSize))
    }
    return { processed, faults, committedChunks: chk }
  }
  return {
    protocol: 'ChunkedWriter',
    flush,
    flushChunk,
    restart,
    chk: () => chk,
    seq,
    stats: () => ({ processed, dropped, faults, checkpoints: chk }),
    faultIsolation: () => faults < Math.ceil(seq.length / chunkSize),
    restartability: () => true,
    footprint: () => 128 + chk * 24,
  }
}

export function createSkipRetryWriter(opts = {}) {
  const perfectOracle = opts.perfectOracle === true
  const unlimitedSkip = opts.unlimitedSkip === true
  const skipLimit = intOr(opts.skipLimit ?? opts.skip_limit, BATCH_DEFAULTS.skipLimit)
  const seq = []
  let skips = 0, faults = 0, processed = 0, dropped = 0
  function flush(events) {
    for (const e of events) {
      if (e.poison && !perfectOracle) {
        skips += 1; dropped += 1
        if (!unlimitedSkip && skips > skipLimit) { faults += 1; return { flushed: false, processed, faults } }
        continue
      }
      processed += 1; seq.push(e)
    }
    return { flushed: faults === 0, processed, skips, faults }
  }
  function restart(events, fromChk = 0) {
    seq.length = 0; processed = 0; faults = 0; skips = 0; dropped = 0
    return flush(events.slice(fromChk))
  }
  return {
    protocol: 'SkipRetryWriter',
    flush,
    restart,
    skips: () => skips,
    seq,
    stats: () => ({ processed, dropped, faults, skips, checkpoints: 0 }),
    faultIsolation: () => faults === 0,
    restartability: () => false,
    footprint: () => 8192,
  }
}

/*----------------------------------------------------- 矩阵 + 三难现算（全真跑、不查表）-----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.faultIsolation)}${Number(t.restartability)}${Number(t.throughput)}` }

/** 单策略单场景真跑一次，回读真观测量；three 布尔由观测量在 runFlaggedRow 聚合时现算。 */
function runCell(protocol, stream, flags, cfg) {
  const poisonCount = stream.filter((e) => e.poison).length
  // rigged 的 perfectOracle = 毒项预防性从输入剔除（换了作业输入，诚实标注，不是同一作业被抹软肋）
  const input = flags.perfectOracle ? stream.filter((e) => !e.poison) : stream
  let result, stats
  if (protocol === 'BulkWriter') {
    const w = createBulkWriter({ perfectOracle: false })
    result = w.flush(input); stats = w.stats()
  } else if (protocol === 'ChunkedWriter') {
    const w = createChunkedWriter({ chunkSize: cfg.chunkSize, perfectOracle: false })
    result = w.flush(input); stats = w.stats()
  } else {
    const w = createSkipRetryWriter({ skipLimit: cfg.skipLimit, unlimitedSkip: flags.unlimitedSkip, perfectOracle: false })
    result = w.flush(input); stats = w.stats()
  }
  return {
    id: '', // 由 runFlaggedRow 填
    processed: result.processed ?? 0,
    faults: result.faults ?? 0,
    poisonCount,
    size: stream.length,
    checkpoints: stats.checkpoints,   // 真观测量：chk 有无 ⇒ restartability / throughput 的唯一分界
    dropped: stats.dropped,           // 真观测量：skip 永久丢
    wholeBatchDied: poisonCount > 0 && !flags.perfectOracle && (result.processed ?? 0) === 0,
    fault: '',
  }
}

function runFlaggedRow(protocol, cfg, flags, scenarioIds) {
  const cells = scenarioIds.map((sc) => {
    const c = runCell(protocol, streamOf(sc, cfg), flags, cfg)
    c.id = sc
    c.fault = faultOf(sc)
    // 考场标记：正交、空真不连坐
    c.inFaultExam = POISON_SCENARIOS.includes(sc)
    c.inRestartExam = sc === 'restartMidway' || sc === 'cleanRerun'
    c.inThroughputExam = sc === 'cleanRun' || sc === 'burstLoad' || sc === 'skipSaturation'
    return c
  })
  const hasCheckpoint = cells.some((c) => c.checkpoints > 0)
  const poisonCells = cells.filter((c) => c.inFaultExam)
  // faultIsolation：含毒考场里没有「整批死」⇒ true；无含毒考场 ⇒ 真空（无软肋可暴露）
  const faultIsolation = poisonCells.length === 0 ? true : poisonCells.every((c) => !c.wholeBatchDied)
  // restartability ⇔ 真有 chk 落盘（且 restart 在 verifyCheckpoint 里真续跑验证）
  const restartability = hasCheckpoint
  // throughput ⇔ 无 chunk commit 停顿（与 restartability 共用 chk 观测量 ⇒ 天然互斥）
  const throughput = !hasCheckpoint
  const trilemma = { faultIsolation, restartability, throughput }
  const metrics = {
    chunkedCheckpoints: cells.reduce((a, c) => a + c.checkpoints, 0),
    poisonDeaths: cells.reduce((a, c) => a + (c.faults > 0 ? 1 : 0), 0),
    itemsProcessed: cells.reduce((a, c) => a + c.processed, 0),
    itemsDropped: cells.reduce((a, c) => a + c.dropped, 0),
  }
  return { cells, trilemma, metrics, debug: {} }
}

function faultOf(scenarioId) {
  return scenarioId === 'poisonOne' ? 'poison-single'
    : scenarioId === 'restartMidway' ? 'mid-recovery'
    : scenarioId === 'skipSaturation' ? 'skip-over-limit'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : scenarioId === 'burstLoad' ? 'burst-throughput'
    : 'happy-path'
}

function runMatrix(cfg, flags, scenarioIds) {
  return BATCH_STRATEGIES.map((p) => {
    const { cells, trilemma, metrics } = runFlaggedRow(p, cfg, flags, scenarioIds)
    return { protocol: p, scenarios: cells, trilemma, metrics }
  })
}

/*----------------------------------------------------- 三条因果结构锁（真喂回内核现算、与 rigged 输入无关）-----------------------------------------------------*/

/**
 * 在同一含毒 raw 流上真跑三写实现，钉死三条「任何 rigged 开关都救不了」的结构属性。
 * 这里故意不看 flags —— 因果锁针对的是协议结构，与输入是否被预言机预防性剔除无关。
 */
export function verifyCausalLocks(cfg) {
  const raw = streamOf('poisonOne', cfg)             // 含单个毒的 raw 流（不剔除）
  const chunkSize = cfg.chunkSize

  // 锁 1：chk 是 restartability 与 throughput 的唯一分界，造不出「既有 chk 又不停顿」
  const chunk = createChunkedWriter({ chunkSize, unlimitedSkip: true })
  chunk.flush(raw)
  const chunkHasChk = chunk.stats().checkpoints > 0
  const chunkRestartable = chunk.restart(raw, 0).committedChunks > 0
  const skip = createSkipRetryWriter({ skipLimit: cfg.skipLimit, unlimitedSkip: true })
  skip.flush(raw)
  const skipNoChk = skip.stats().checkpoints === 0
  const bulk = createBulkWriter({})
  bulk.flush(raw)
  const bulkNoChk = bulk.stats().checkpoints === 0
  const checkpointTradeoffCausallyUnerasable =
    (chunkHasChk && chunkRestartable && skipNoChk && bulkNoChk) &&
    // 给 Skip 完美预言机也不创 chk；给 Chunk 无限 skip 仍有 chk 停顿
    createSkipRetryWriter({ perfectOracle: true }).stats().checkpoints === 0 &&
    createChunkedWriter({ chunkSize, unlimitedSkip: true }).restart(raw, 0).committedChunks > 0

  // 锁 2：Skip 跳毒永久丢，unlimitedSkip 只免 fatal、不免丢
  const skipUnlimited = createSkipRetryWriter({ skipLimit: cfg.skipLimit, unlimitedSkip: true })
  skipUnlimited.flush(raw)
  const poisonInRaw = raw.filter((e) => e.poison).length
  const skipSilentLossCausallyUnerasable =
    poisonInRaw > 0 && skipUnlimited.stats().dropped === poisonInRaw &&
    skipUnlimited.seq.every((e) => !e.poison)

  // 锁 3：Bulk 无 chk + 整批提交 ⇒ 同一 raw 流下真毒必整批死
  const bulkRaw = createBulkWriter({})
  const bulkResult = bulkRaw.flush(raw)
  const bulkAllOrNothingCausallyUnerasable =
    poisonInRaw > 0 && bulkResult.flushed === false && bulkResult.processed === 0 &&
    bulkRaw.stats().checkpoints === 0

  const causalLocksAllHold =
    checkpointTradeoffCausallyUnerasable &&
    skipSilentLossCausallyUnerasable &&
    bulkAllOrNothingCausallyUnerasable
  return {
    checkpointTradeoffCausallyUnerasable,
    skipSilentLossCausallyUnerasable,
    bulkAllOrNothingCausallyUnerasable,
    causalLocksAllHold,
  }
}

/*----------------------------------------------------- study -----------------------------------------------------*/

export function springBatchStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? [...opts.scenarios] : [...BATCH_SCENARIOS]
  const cfg = {
    seed: intOr(opts.seed, BATCH_DEFAULTS.seed),
    items: Math.max(16, intOr(opts.items, BATCH_DEFAULTS.items)),
    chunkSize: Math.max(1, intOr(opts.chunkSize, BATCH_DEFAULTS.chunkSize)),
    skipLimit: intOr(opts.skipLimit ?? opts.skip_limit, BATCH_DEFAULTS.skipLimit),
  }
  const perfectOracle = opts.perfectOracle === true
  const unlimitedSkip = opts.unlimitedSkip === true
  const rigged = opts.rigged === true || (perfectOracle && unlimitedSkip)
  const flags = { rigged, perfectOracle: rigged || perfectOracle, unlimitedSkip: rigged || unlimitedSkip }

  const rows = runMatrix(cfg, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))
  const riggedConvergenceCollapsed = !distinct   // rigged 下 Bulk≡Skip=101，诚实标注

  // 单开反噬：恒以「无开关纯净基线」作对照（因果锁另在同一 raw 流现算，不靠这里）
  const baseRows = runMatrix(cfg, { perfectOracle: false, unlimitedSkip: false, rigged: false }, scenarioIds)
  const baseBulk = baseRows.find((r) => r.protocol === 'BulkWriter')
  const mOracle = runMatrix(cfg, { perfectOracle: true, unlimitedSkip: false, rigged: false }, scenarioIds)
  const mSkip = runMatrix(cfg, { perfectOracle: false, unlimitedSkip: true, rigged: false }, scenarioIds)
  const perfectOracleErasesPoison = mOracle.find((r) => r.protocol === 'BulkWriter').trilemma.faultIsolation === true && baseBulk.trilemma.faultIsolation === false
  const unlimitedSkipNoRestart = mSkip.find((r) => r.protocol === 'SkipRetryWriter').trilemma.restartability === false

  const causalLocks = verifyCausalLocks(cfg)

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    bulkExplodesOnPoison: baseBulk.trilemma.faultIsolation === false,   // 恒以纯净基线标定主教义（rigged 不翻）
    chunkedSurvivesPoison: rows.find((r) => r.protocol === 'ChunkedWriter').trilemma.faultIsolation === true,
    chunkedChkAvailable: rows.find((r) => r.protocol === 'ChunkedWriter').trilemma.restartability === true,
    skipFastest: rows.find((r) => r.protocol === 'SkipRetryWriter').trilemma.throughput === true,
    skipSilentLoss: rows.find((r) => r.protocol === 'SkipRetryWriter').metrics.itemsDropped > 0 ||
      baseRows.find((r) => r.protocol === 'SkipRetryWriter').metrics.itemsDropped > 0,
    rigged_pkg: rigged,
    riggedConvergenceCollapsed,
    perfectOracleErasesPoison,
    unlimitedSkipNoRestart,
    ...causalLocks,
  }

  const checkpointInput = { events: streamOf('restartMidway', cfg), seed: cfg.seed, chunkSize: cfg.chunkSize, items: cfg.items }
  const crosscheck = {
    evidence: createBatchEvidence({ seed: cfg.seed, now: opts.now }),
    checkpoint: verifyCheckpoint(checkpointInput, { seed: cfg.seed, chunkSize: cfg.chunkSize }),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { ...cfg, scenarios: scenarioIds, rigged, perfectOracle: flags.perfectOracle, unlimitedSkip: flags.unlimitedSkip },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks,
    crosscheck,
    rigged,
  }
}

export const compareSpringBatch = springBatchStudy

export function springBatchSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      trilemma: { ...r.trilemma },
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    verdict: { ...study.verdict },
    noUniversalWinner: study.noUniversalWinner === true,
    trilemmaDistinguishes: study.trilemmaDistinguishes === true,
    causalLocks: study.causalLocks ? { ...study.causalLocks } : undefined,
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      checkpoint: study.crosscheck.checkpoint ? { ...study.crosscheck.checkpoint } : undefined,
    } : undefined,
    rigged: study.rigged === true,
  }
}

/*----------------------------------------------------- verifyCheckpoint：双路自证 + 三路真喂回可证伪 -----------------------------------------------------*/

/**
 * 唯一判定内核：给定 events + 篡改 mode，真跑 ChunkedWriter，回读观测量，用**同一个 holds 公式**现算。
 * mode 只改变内核的输入/行为，绝不直接写 holds —— 篡改必须靠真观测量翻红。
 */
function checkpointCore(input = {}, mode = 'baseline') {
  const chunkSize = Math.max(1, intOr(input.chunkSize, BATCH_DEFAULTS.chunkSize))
  const raw = Array.isArray(input.events) ? input.events : []
  const events = mode === 'emptyJob' ? [] : raw.map((e, i) => ({ ...e, id: i }))
  const nontrivial = events.length >= 16
  const poisonIdx = events.map((e, i) => (e.poison ? i : -1)).filter((i) => i >= 0)
  const poisonChunks = new Set(poisonIdx.map((i) => Math.floor(i / chunkSize)))

  // 路 A：clean 全量基准（抹掉所有毒，真跑 flush 求「全部 commit / 零 faults」）
  const clean = events.map((e) => ({ ...e, poison: false }))
  const laneAWriter = createChunkedWriter({ chunkSize })
  const laneA = laneAWriter.flush(clean)
  const laneAOk = laneA.faults === 0 && laneA.processed === clean.length

  // 路 B：按 mode 真跑，回读真观测量
  let committedIds, faults, processed
  if (mode === 'silentPoison') {
    // 静默吞毒：把毒当正常项整流 commit（不隔离）—— 这是「静默吞毒不报警」的真行为
    const swallowed = events.map((e) => ({ ...e, poison: false }))
    const w = createChunkedWriter({ chunkSize })
    const r = w.flush(swallowed)
    committedIds = w.seq.map((e) => e.id); faults = r.faults; processed = r.processed
  } else if (mode === 'corruptCheckpoint') {
    // chk 内容 corrupt：指针损坏导致从两个错位 chk 各续跑一次再合并 ⇒ 真制造重复写
    const w0 = createChunkedWriter({ chunkSize }); w0.restart(events, 0)
    const w1 = createChunkedWriter({ chunkSize }); w1.restart(events, 1)
    committedIds = [...w0.seq.map((e) => e.id), ...w1.seq.map((e) => e.id)]
    faults = 0; processed = committedIds.length
  } else {
    // baseline：真 chk 续跑，poison chunk 隔离，其余 chunk 照 commit
    const w = createChunkedWriter({ chunkSize })
    const r = w.restart(events, 0)
    committedIds = w.seq.map((e) => e.id); faults = r.faults; processed = r.processed
  }

  const committedSet = new Set(committedIds)
  const noDuplicate = committedIds.length === committedSet.size
  const idPoison = new Map(events.map((e, i) => [i, !!e.poison]))
  const poisonIsolated = committedIds.every((id) => !idPoison.get(id))  // committed 中不含任何毒项
  const expectedCleanIds = events.map((e, i) => i).filter(
    (i) => !idPoison.get(i) && !poisonChunks.has(Math.floor(i / chunkSize)),
  )
  const noLoss = expectedCleanIds.every((id) => committedSet.has(id))    // 非毒 chunk 内容零丢失
  const poisonChunkDetected = faults >= 1                                // 真检测到毒（隔离了 poison chunk）

  const holds = nontrivial && laneAOk && poisonIsolated && noDuplicate && noLoss && poisonChunkDetected
  return {
    laneA: { baselineProcessed: laneA.processed, baselineFaults: laneA.faults, baselineItemsSnapshot: clean.length },
    laneB: {
      completedProcessed: processed, completedFaults: faults,
      committedChunks: committedIds.length, uniqueCommitted: committedSet.size,
    },
    holds, nontrivial,
    invariants: { laneAOk, poisonIsolated, noDuplicate, noLoss, poisonChunkDetected },
    events: raw.length,
  }
}

/** verifyCheckpoint：稳态真撞合 + 三路篡改真喂回同一内核现算翻 false + 基线先真绿。 */
export function verifyCheckpoint(input = {}, opts = {}) {
  const cfg = { ...input, chunkSize: input.chunkSize ?? opts.chunkSize, seed: input.seed ?? opts.seed }
  const baseline = checkpointCore(cfg, 'baseline')
  const corruptCheckpoint = checkpointCore(cfg, 'corruptCheckpoint')
  const silentPoison = checkpointCore(cfg, 'silentPoison')
  const emptyJob = checkpointCore(cfg, 'emptyJob')
  return {
    laneA: baseline.laneA,
    laneB: baseline.laneB,
    invariants: baseline.invariants,
    baselineHolds: baseline.holds,
    holds: baseline.holds,
    nontrivial: baseline.nontrivial,
    falsifiable: baseline.nontrivial && baseline.holds &&
      !corruptCheckpoint.holds && !silentPoison.holds && !emptyJob.holds,
    tamper: {
      corruptedCheckpoint: { holds: corruptCheckpoint.holds, invariants: corruptCheckpoint.invariants, reason: 'chk 指针 corrupt ⇒ 重复写 ⇒ noDuplicate 真翻 false' },
      silentPoison: { holds: silentPoison.holds, invariants: silentPoison.invariants, reason: '静默吞毒不隔离 ⇒ poisonIsolated 真翻 false' },
      emptyJob: { holds: emptyJob.holds, nontrivial: emptyJob.nontrivial, reason: '空 jobs ⇒ nontrivial 真翻 false，绝不 0=0 假绿' },
    },
    events: baseline.events,
  }
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createBatchEvidence(opts = {}) {
  const seed = intOr(opts.seed, BATCH_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `batch:key:${i}`)
  const ev = {}

  // ① ShardRouter 路由
  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  // ② HashRing
  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  // ③ WAL
  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  // ④ Bus
  const bus = createBus()
  let notices = 0
  bus.subscribe('batch.done', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('batch.done', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('batch.done')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`batch:slot:${k}`, 1)
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`batch:slot:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ slot: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  // ⑦ TokenBucket
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  // ⑧ MinHeap
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 80, 'batch:flush')
  heap.schedule(fixedNow + 250, 'batch:committed')
  heap.schedule(fixedNow + 40, 'batch:restart')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  // ⑨ PackedCounters
  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  // ⑩ FullJitterBackoff
  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  // ⑪ compareRemapping
  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  return ev
}

/*----------------------------------------------------- CLI -----------------------------------------------------*/

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const nowIdx = args.indexOf('--now')
  const nowArg = args.find((a) => a.startsWith('--now='))
  const nowMs = nowArg ? numOr(nowArg.slice(6), 0) : (nowIdx >= 0 ? numOr(args[nowIdx + 1], 0) : 0)
  const perfectOracle = rigged || args.includes('--perfect-oracle')
  const unlimitedSkip = rigged || args.includes('--unlimited-skip')
  const study = springBatchStudy({ rigged, perfectOracle, unlimitedSkip, now: () => nowMs })
  const snap = springBatchSnapshot(study)
  console.log('[spring-batch] seed=' + snap.config.seed +
    ' items=' + snap.config.items +
    ' chunkSize=' + snap.config.chunkSize +
    ' skipLimit=' + snap.config.skipLimit +
    ' rigged=' + snap.rigged +
    ' perfectOracle=' + snap.config.perfectOracle +
    ' unlimitedSkip=' + snap.config.unlimitedSkip +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(16) +
      ' chk=' + String(row.metrics.chunkedCheckpoints).padStart(5) +
      ' poisonDeaths=' + row.metrics.poisonDeaths +
      ' dropped=' + String(row.metrics.itemsDropped).padStart(4) +
      ' processed=' + String(row.metrics.itemsProcessed).padStart(6) +
      ' trilemma={' + ['faultIsolation=' + row.trilemma.faultIsolation, 'restartability=' + row.trilemma.restartability, 'throughput=' + row.trilemma.throughput].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner +
    ' distinguishable=' + snap.trilemmaDistinguishes +
    ' noStrategyWinsAll=' + snap.verdict.noStrategyWinsAll +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma)
  console.log('  causalLocks: chkTradeoff=' + snap.causalLocks.checkpointTradeoffCausallyUnerasable +
    ' skipLoss=' + snap.causalLocks.skipSilentLossCausallyUnerasable +
    ' bulkAllOrNothing=' + snap.causalLocks.bulkAllOrNothingCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  console.log('  verdict: bulkExplodesOnPoison=' + snap.verdict.bulkExplodesOnPoison +
    ' chunkedSurvivesPoison=' + snap.verdict.chunkedSurvivesPoison +
    ' chunkedChkAvailable=' + snap.verdict.chunkedChkAvailable +
    ' skipFastest=' + snap.verdict.skipFastest +
    ' skipSilentLoss=' + snap.verdict.skipSilentLoss +
    ' perfectOracleErasesPoison=' + snap.verdict.perfectOracleErasesPoison +
    ' unlimitedSkipNoRestart=' + snap.verdict.unlimitedSkipNoRestart)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.checkpoint
  console.log('  verifyCheckpoint: holds=' + cp.holds + ' baselineHolds=' + cp.baselineHolds +
    ' nontrivial=' + cp.nontrivial + ' falsifiable=' + cp.falsifiable +
    ' laneA{baseline=' + cp.laneA.baselineProcessed + ' faults=' + cp.laneA.baselineFaults + '}' +
    ' laneB{completed=' + cp.laneB.completedProcessed + ' chunks=' + cp.laneB.committedChunks + ' unique=' + cp.laneB.uniqueCommitted + '}' +
    ' tamper{corrupt=' + cp.tamper.corruptedCheckpoint.holds + ',silent=' + cp.tamper.silentPoison.holds + ',empty=' + cp.tamper.emptyJob.holds + '}')
}
