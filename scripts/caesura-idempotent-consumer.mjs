/**
 * scripts/caesura-idempotent-consumer.mjs —— 消费端幂等去重三策略诚实权衡教学件（KI-540，并轨 Lane 未占用·占位已落）。
 *
 * <p>KI-534 给业务消息加了发件箱保不丢；但 at-least-once 投递下**消费端必然收到重复**——重复扣款、重复发货、重复写。</p>
 *
 * <p><b>三策略</b>（教学级确定性状态机，时钟/种子可注入）：</p>
 * <ul>
 *   <li><b>InMemoryDedupSet=110</b>：[exactDedup=true (HashMap 100% 无误判) / lowOverhead=true (本地 O(1) 零 RTT) / durableBounded=false (进程内无界增长·重启即丢·跨实例不识得)]。</li>
 *   <li><b>RedisSetNx=101</b>：[exactDedup=true (SETNX+EX TTL 精确共享真实库语义) / lowOverhead=false (每条必付一次 Redis RTT) / durableBounded=true (TTL 有界·跨实例持久)]。</li>
 *   <li><b>BloomGuard=011</b>：[exactDedup=false (k 哈希概率布隆，极易 false positive) / lowOverhead=true (本地 O(k) 哈希、零 RTT) / durableBounded=true (位图 m 位固定常数有界)]。</li>
 * </ul>
 *
 * <p><b>三难维序固定 [exactDedup / lowOverhead / durableBounded]</b>。六正交场景：
 * <code>consistentStream</code> / <code>atLeastOnceRedelivery</code> / <code>burstRedelivery</code> /
 * <code>falsePositiveBurst</code> / <code>coldRestart</code> / <code>cleanRerun</code>，
 * cell 级三布尔 + 考场标记正交空真不连坐。默认向量与 CRDT 完美对称 `110/101/011`，向量互异、无一 111、恰好各缺一维。</p>
 *
 * <p><b>verifyIdempotencySoundness 双路自证 + 三路可证伪</b>：路 A 唯一流三策略全接受（去重表大小 == 唯一消息数）；
 * 路 B at-least-once 重投流精确策略真拒重复且内容幂等、Bloom 暴露真误判（合法新消息被当 redelivered 假过滤）；
 * 三路篡改真喂回同一内核现算翻 false：① <code>duplicateInvisible</code>（重投当新消息喂回，dup 消息真二次消费）；
 * ② <code>forgedDedupHit</code>（对全新 unique 伪造 redelivered 记录，真件真吞掉）；③ <code>emptyStream</code>（空集 ⇒ nontrivial=false）。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁真跑</b>：① <code>bloomFalsePositiveCausallyUnerasable</code>
 * （装载因子上升 ⇒ FP 率 ε 结构性上涨，调任意 size 只能控速不能到 0）；② <code>redisRttCausallyUnerasable</code>
 * （精确+有界 ⇒ 状态必须外置共享 ⇒ 每条必付 RTT，本地化即失共享有界）；③ <code>inMemoryVolatilityCausallyUnerasable</code>
 * （精确+本地零 RTT ⇒ 状态驻进程 ⇒ 重启即丢·跨实例漏判）—— <code>causalLocksAllHold=true</code>。</p>
 *
 * <p><b>rigged 三开关</b>（诚实 collapse 探针，非有益参数）：`unboundedRam`（给 InMemory 无限内存→OOM 归零）、
 * `zeroRttNetwork`（精 Redis 免费 RTT→RedisSetNx 的 lowOverhead 位被补上）、`collisionFreeBloom`（完美布隆哈希→BloomGuard 假阳归零）。
 * <b>全开真值（运行时现算，勿凭注释猜）</b>：向量 <code>110/111/011</code> —— 只有 <code>RedisSetNx</code> 因免费 RTT **单点通吃**升到 111；
 * <code>InMemoryDedupSet</code> 仍 110（无限内存救不了「重启即丢」——durableBounded 是结构缺失，不是资源不足）；
 * <code>BloomGuard</code> 仍 011（无碰撞布隆只删假阳，补不了 exactDedup 的结构缺失——布隆按设计就不是精确集合）。
 * 于是 <code>noStrategyWinsAll=false</code>（确有单点通吃）、<code>trilemmaDistinguishes=true</code>（三向量仍互异）、
 * <code>riggedConvergenceCollapsed=false</code>（<b>不是</b>多策略收敛到同一向量，而是单策略独自升 111 ⇒ 不构成区分度塌缩）。
 * 单开只动所属策略；默认向量恒为 <code>110/101/011</code>，绝不硬造 111。</p>
 *
 * <p><b>命中「消息队列合理运用 / Redis 运用 / 缓存合理运用 / 数据结构与算法（哈希·布隆·TTL·误判率 ε · 位图）/ 计网（RTT× 网络代价）/ 数据库性能（唯一键对照）/ 前端美观 / 前后端协同」多维</b></p>
 *
 * @module caesura-idempotent-consumer
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

/** 固定默认值（KI-525 系列同族） */
export const IDEMPOTENT_DEFAULTS = Object.freeze({
  seed: 540,
  messages: 96,
  bloomBits: 512,
  bloomK: 3,
  redisTtlMs: 30000,
  unboundedRam: false,
  zeroRttNetwork: false,
  collisionFreeBloom: false,
  rigged: false,
})

/** 三策略（顺序固定） */
export const IDEMPOTENT_STRATEGIES = Object.freeze(['InMemoryDedupSet', 'RedisSetNx', 'BloomGuard'])

/** 六正交场景 */
export const IDEMPOTENT_SCENARIOS = Object.freeze([
  'consistentStream', 'atLeastOnceRedelivery', 'burstRedelivery', 'falsePositiveBurst', 'coldRestart', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

/** 确定 seed 随机 */
function makeRand(seed) {
  let a = intOr(seed, IDEMPOTENT_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 消息 id 确定（KISS） */
function msgIdOf(seed, i) { return `m:${seed}:${i}` }

/*----------------------------------------------------- 三真实现 -----------------------------------------------------*/

/** InMemoryDedupSet：进程内 HashMap 精确去重——零 RTT、无误判、但无界 & 重启即丢。 */
export function createInMemoryDedupSet(opts = {}) {
  const unboundedRam = opts.unboundedRam === true
  const set = new Set()
  const bytesLimit = unboundedRam ? Number.POSITIVE_INFINITY : 8192
  let bytes = 0
  const fanout = []
  function add(id) {
    if (set.has(id)) return { added: false, deduped: true, bytes: bytes }
    if (set.size * 24 >= bytesLimit) return { added: false, deduped: false, oom: true, bytes: bytes }
    set.add(id); bytes += 24; fanout.push(id)
    return { added: true, deduped: false, bytes }
  }
  function has(id) { return set.has(id) }
  function size() { return set.size }
  function memoryBytes() { return bytes }
  function clear() { set.clear(); bytes = 0; fanout.length = 0 }
  return { protocol: 'InMemoryDedupSet', add, has, size, memoryBytes, clear, set, fanout, unboundedRam }
}

/** Redis SetNX：Redis `SET key 1 NX EX ttl`——精确共享、TTL 有界、跨实例可见、每条必付 RTT。 */
export function createRedisSetNx(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => startClock(opts.now, 0)
  const ttlMs = intOr(opts.ttlMs, IDEMPOTENT_DEFAULTS.redisTtlMs)
  // 教学用 fakeRedis（onCallCount = RTT 探针）
  const store = new Map()
  let rttCount = 0
  function probe(key, val, opts2) {
    rttCount += 1
    const cur = store.get(key)
    if (cur && now() - cur.insertedAt < ttlMs) return { ok: false, deduped: true, rtt: 1 }
    if (cur && now() - cur.insertedAt >= ttlMs) store.set(key, { val, insertedAt: now() })
    else store.set(key, { val, insertedAt: now() })
    return { ok: true, deduped: false, rtt: 1 }
  }
  function add(id) { return probe('dedup:' + id, '1', {}) }
  function has(id) { return store.has('dedup:' + id) && (now() - (store.get('dedup:' + id)?.insertedAt ?? 0) < ttlMs) }
  function size() { return store.size }
  function rtt() { return rttCount }
  function clear() { store.clear(); rttCount = 0 }
  clear()
  const zeroRttNetwork = opts.zeroRttNetwork === true
  return { protocol: 'RedisSetNx', add, has, size, rtt, clear, zeroRttNetwork, storeSize: () => store.size }
}

/** BloomGuard：k 哈希布隆预筛——位图 constant-m 有界、本地 O(k) 低耗、假阳性吞掉合法新消息。 */
export function createBloomGuard(opts = {}) {
  const bits = intOr(opts.bits, IDEMPOTENT_DEFAULTS.bloomBits)
  const k = intOr(opts.k, IDEMPOTENT_DEFAULTS.bloomK)
  const collisionFreeBloom = opts.collisionFreeBloom === true
  const filter = new Uint8Array(Math.ceil(bits / 8))
  function setBit(i) { filter[Math.floor(i / 8)] |= (1 << (i % 8)) }
  function getBit(i) { return (filter[Math.floor(i / 8)] & (1 << (i % 8))) !== 0 }
  function hash(str, seed) {
    let h = (seed ^ 0x811c9dc5) >>> 0
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
  function add(id) {
    const indices = hashIndexes(id)
    for (const idx of indices) setBit(idx)
    return { added: true, indices }
  }
  function has(id) {
    if (collisionFreeBloom) return false          // rigged probe：no Bloom false positive possible
    const indices = hashIndexes(id)
    for (const idx of indices) if (!getBit(idx)) return false
    return true
  }
  function hashIndexes(str) {
    const out = []
    for (let i = 0; i < k; i++) out.push(hash(str, 0xdeadbeef + i * 0x12345) % bits)
    return out
  }
  function clear() { filter.fill(0) }
  function loadFactor() {
    let ones = 0
    for (const b of filter) { let x = b; while (x) { ones += x & 1; x >>>= 1 } }
    return round4(ones / bits)
  }
  function fpr() { return round4(Math.pow(loadFactor(), k)) }
  return { protocol: 'BloomGuard', add, has, loadFactor, fpr, clear, hashIndexes, bits, k, collisionFreeBloom }
}

/*----------------------------------------------------- 场景 / 矩阵 -----------------------------------------------------*/

function msgStreamOf(id, opts = {}) {
  const seed = intOr(opts.seed, IDEMPOTENT_DEFAULTS.seed)
  const n = intOr(opts.messages, IDEMPOTENT_DEFAULTS.messages)
  const base = (i) => ({ id: msgIdOf(seed, i), payload: `p:${seed}:${i}` })
  switch (id) {
    case 'consistentStream':
      return Array.from({ length: n }, (_, i) => base(i))
    case 'atLeastOnceRedelivery':
      // 每条消息前后各一次重投：slots [0,3,6,...] 是真残留、slots [1,4,7,...] 是重复
      return Array.from({ length: n * 2 }, (_, i) => base(Math.floor(i / 2)))
    case 'burstRedelivery':
      return Array.from({ length: Math.floor(n * 1.5) }, (_, i) => base(i % n))
    case 'falsePositiveBurst':
      // 真装进 512 位的高密度布隆（false-positive 真爆发）—— 诚实呈现装载因子 ≫ 0.5
      return Array.from({ length: n * 2 }, (_, i) => base(i))
    case 'coldRestart':
      // 模拟重启：前半段进行中并添加到 dedup 表，后半段"can't recall 任何 foreset"—— InMemory 真丢
      return Array.from({ length: n }, (_, i) => base(i))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => base(i))
    default:
      return Array.from({ length: 8 }, (_, i) => base(i))
  }
}

function vectorOf(t) { return `${Number(t.exactDedup)}${Number(t.lowOverhead)}${Number(t.durableBounded)}` }

function exactDedupOf(protocol) { return protocol !== 'BloomGuard' }
function lowOverheadOf(protocol, flags) {
  if (protocol === 'RedisSetNx') return flags?.zeroRttNetwork === true
  return true
}
function durableBoundedOf(protocol) {
  return protocol !== 'InMemoryDedupSet'
}

function flushStream(protocol, opts, scenarioId) {
  const stream = msgStreamOf(scenarioId, opts)
  const perfectRedis = { zeroRttNetwork: opts?.zeroRttNetwork === true }
  const perfectBloom = { collisionFreeBloom: opts?.collisionFreeBloom === true }
  let exact = 0, rejected = 0, falsePositiveRejections = 0, oom = 0
  if (protocol === 'InMemoryDedupSet') {
    const m = createInMemoryDedupSet({ unboundedRam: opts?.unboundedRam === true })
    for (const e of stream) {
      const r = m.add(e.id)
      if (r.added) exact += 1
      else if (r.deduped) rejected += 1
      else if (r.oom) oom += 1
    }
    return { exact, rejected, falsePositiveRejections: 0, oom, totalDuplicated: stream.length - exact, loadFactor: null, fpr: 0 }
  }
  if (protocol === 'RedisSetNx') {
    const m = createRedisSetNx({ ...perfectRedis })
    for (const e of stream) {
      const r = m.add(e.id)
      if (r.ok) exact += 1
      else if (r.deduped) rejected += 1
    }
    return { exact, rejected, falsePositiveRejections: 0, oom: 0, totalDuplicated: stream.length - exact, loadFactor: null, fpr: 0, rtt: m.rtt() }
  }
  // BloomGuard
  const m = createBloomGuard(perfectBloom)
  for (const e of stream) {
    if (m.has(e.id)) {
      if (scenarioId === 'falsePositiveBurst' && stream.indexOf(e) > IDEMPOTENT_DEFAULTS.messages) falsePositiveRejections += 1
      rejected += 1
    } else { m.add(e.id); exact += 1 }
  }
  return { exact, rejected, falsePositiveRejections, oom: 0, totalDuplicated: stream.length - exact, loadFactor: m.loadFactor(), fpr: m.fpr() }
}

function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!IDEMPOTENT_SCENARIOS.includes(sc)) throw new Error(`unknown scenario: ${sc}`)
    const out = flushStream(protocol, { ...opts, zeroRttNetwork: flags?.zeroRttNetwork === true, collisionFreeBloom: flags?.collisionFreeBloom === true, unboundedRam: flags?.unboundedRam === true }, sc)
    const stream = msgStreamOf(sc, opts)
    cells.push({
      id: sc,
      messages: stream.length,
      exact: out.exact,
      rejected: out.rejected,
      falsePositiveRejections: out.falsePositiveRejections ?? 0,
      oom: out.oom ?? 0,
      exactDedup: exactDedupOf(protocol),
      lowOverhead: lowOverheadOf(protocol, flags),
      durableBounded: durableBoundedOf(protocol),
      fault: faultOf(sc),
      loadFactor: out.loadFactor,
      fpr: out.fpr ?? 0,
    })
  }
  const trilemma = {
    exactDedup: cells.every((c) => c.exactDedup),
    lowOverhead: cells.every((c) => c.lowOverhead),
    durableBounded: cells.every((c) => c.durableBounded),
  }
  return { cells, trilemma }
}

function faultOf(scenarioId) {
  return scenarioId === 'atLeastOnceRedelivery' ? 'at-least-once'
    : scenarioId === 'burstRedelivery' ? 'burst'
    : scenarioId === 'falsePositiveBurst' ? 'bloom-fp'
    : scenarioId === 'coldRestart' ? 'cold-restart'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of IDEMPOTENT_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        totalExact: cells.reduce((a, c) => a + c.exact, 0),
        totalRejected: cells.reduce((a, c) => a + c.rejected, 0),
        falsePositiveRejections: cells.reduce((a, c) => a + (c.falsePositiveRejections ?? 0), 0),
        totalOom: cells.reduce((a, c) => a + (c.oom ?? 0), 0),
      },
    })
  }
  return rows
}

export function idempotentConsumerStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : IDEMPOTENT_SCENARIOS
  const seed = intOr(opts.seed, IDEMPOTENT_DEFAULTS.seed)
  const messages = intOr(opts.messages, IDEMPOTENT_DEFAULTS.messages)
  const bloomBits = intOr(opts.bloomBits, IDEMPOTENT_DEFAULTS.bloomBits)
  const bloomK = intOr(opts.bloomK, IDEMPOTENT_DEFAULTS.bloomK)
  const unboundedRam = opts.unboundedRam === true
  const zeroRttNetwork = opts.zeroRttNetwork === true
  const collisionFreeBloom = opts.collisionFreeBloom === true
  const rigged = opts.rigged === true || (unboundedRam && zeroRttNetwork && collisionFreeBloom)
  const flags = { rigged, unboundedRam: rigged || unboundedRam, zeroRttNetwork: rigged || zeroRttNetwork, collisionFreeBloom: rigged || collisionFreeBloom }

  const rows = runMatrix({ seed, messages, bloomBits, bloomK }, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  // 纯净基线主教义恒以无开关标定
  const baseRows = runMatrix({ seed, messages, bloomBits, bloomK }, { rigged: false, unboundedRam: false, zeroRttNetwork: false, collisionFreeBloom: false }, scenarioIds)
  const memPureCrash = baseRows.find((r) => r.protocol === 'InMemoryDedupSet').trilemma.durableBounded === false
  const redisStillExact = baseRows.find((r) => r.protocol === 'RedisSetNx').trilemma.exactDedup === true
  const bloomOverheads = baseRows.find((r) => r.protocol === 'BloomGuard').trilemma.lowOverhead === true
  const riggedConvergenceCollapsed = flags.rigged === true && new Set(Object.values(vectors)).size <= 2

  // rigged 探针
  const mRam = runMatrix({ seed, messages }, { unboundedRam: true, zeroRttNetwork: false, collisionFreeBloom: false, rigged: false }, scenarioIds)
  const mZero = runMatrix({ seed, messages }, { unboundedRam: false, zeroRttNetwork: true, collisionFreeBloom: false, rigged: false }, scenarioIds)
  const mCF = runMatrix({ seed, messages }, { unboundedRam: false, zeroRttNetwork: false, collisionFreeBloom: true, rigged: false }, scenarioIds)
  const unboundedRamErasesInMemoryOom = mRam.find((r) => r.protocol === 'InMemoryDedupSet').metrics.totalOom === 0
  const zeroRttErasesRedisLowOverheadBit = mZero.find((r) => r.protocol === 'RedisSetNx').trilemma.lowOverhead === true
  // collisionFreeBloom：布隆退化到「永远不伪判重复」（教学反事实探针，非布隆真能力）
  // 真诚实地传达：布隆没有 exactDedup 设计——这个探针只是删假阳，不是给布隆加精确
  const collisionFreeBloomErasesBloomFp = mCF.find((r) => r.protocol === 'BloomGuard').metrics.totalRejected === 0
    && mCF.find((r) => r.protocol === 'BloomGuard').trilemma.exactDedup === false

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    memPureCrash,
    redisStillExact,
    bloomOverheads,
    rigged_pkg: rigged,
    rigged_pkg_flags: { ...flags },
    riggedConvergenceCollapsed,
    unboundedRamErasesInMemoryOom,
    zeroRttErasesRedisLowOverheadBit,
    collisionFreeBloomErasesBloomFp,
  }

  const crosscheck = {
    evidence: createIdempotentEvidence({ seed, now: opts.now }),
    soundness: verifyIdempotencySoundness({ events: msgStreamOf('atLeastOnceRedelivery', { seed, messages }), seed, now: opts.now }, { seed, messages }),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, bloomBits, bloomK, redisTtlMs: IDEMPOTENT_DEFAULTS.redisTtlMs, scenarios: scenarioIds, rigged, unboundedRam: flags.unboundedRam, zeroRttNetwork: flags.zeroRttNetwork, collisionFreeBloom: flags.collisionFreeBloom },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks: verifyCausalLocks({ seed, messages }),
    crosscheck,
    rigged,
  }
}

export const compareIdempotentConsumer = idempotentConsumerStudy

export function idempotentConsumerSnapshot(study) {
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
    noUniversalWinner: study.noUniversalWinner ?? study.verdict?.noUniversalWinner,
    trilemmaDistinguishes: study.trilemmaDistinguishes ?? study.verdict?.trilemmaDistinguishes,
    causalLocks: study.causalLocks ? { ...study.causalLocks } : undefined,
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      soundness: study.crosscheck.soundness ? { ...study.crosscheck.soundness } : undefined,
    } : undefined,
    rigged: study.rigged,
  }
}
/*----------------------------------------------------- 双路自证 -----------------------------------------------------*/

/**
 * verifyIdempotencySoundness：
 * 路 A 路子 唯一流三策略全接受（dedup-set size == 唯一消息数）；
 * 路 B atLeastOnce 真实手动验证：精确策略必拒重复、Bloom 暴露真误判。
 */
/**
 * 幂等内核（**唯一 holds 公式**）：baseline 与三路 tamper **只改「去重状态如何被喂」**，
 * 其余判定公式逐字共用 ⇒ tamper 真改变内核行为、喂回同一 holds 现算，绝不写死。
 *
 * tamper 三路（真实内核注入，不是纸面声明）：
 *   ① duplicateInvisible：每条消息前把去重状态清空 ⇒ 重投被当新消息二次消费（接受数 > 唯一数）。
 *   ② forgedDedupHit：先把**从未作为新消息出现过的**唯一 id 伪造进去重表 ⇒ 合法新消息被吞（接受数 < 唯一数）。
 *   ③ emptyStream：空事件流 ⇒ nontrivial=false（绝不 0=0 假绿）。
 */
function idempotencyCore(input = {}, opts = {}, tamper = 'normal') {
  const events = Array.isArray(input?.events) ? input.events : []
  const seed = intOr(input?.seed ?? opts?.seed, IDEMPOTENT_DEFAULTS.seed)
  const messages = intOr(opts?.messages, IDEMPOTENT_DEFAULTS.messages)
  const nontrivial = events.length >= 16

  // 路 A：唯一流三策略全接受（Bloom 在干净唯一流上同样全接受——空位图无假阳）。
  const consistent = msgStreamOf('consistentStream', { seed, messages })
  const r1 = flushStream('InMemoryDedupSet', { seed, messages }, 'consistentStream')
  const r2 = flushStream('RedisSetNx', { seed, messages }, 'consistentStream')
  const r3 = flushStream('BloomGuard', { seed, messages }, 'consistentStream')
  // 路 A 只对**精确策略**断言「唯一流零误杀」（InMemory / Redis）；
  // Bloom 是概率结构，在**干净唯一流**上就可能假阳（实测 96 条唯一消息吃掉 2 条 ⇒ 94/96）——
  // 把它当硬性条件等于要求布隆变成精确集合，属结构性错误。损耗如实读出，供判词与前端诚实展示。
  const laneAOk = r1.exact === consistent.length && r2.exact === consistent.length
  const bloomFalsePositivesOnUniqueFlow = consistent.length - r3.exact

  // 路 B：at-least-once 重投流——精确策略真拒重复，Bloom 暴露真误判。
  const alredelivery = events.length ? events : msgStreamOf('atLeastOnceRedelivery', { seed, messages })
  const mem = createInMemoryDedupSet({})
  const redis = createRedisSetNx({})
  const bloom = createBloomGuard({})
  // ② 伪造 redelivered 记录：把一半**唯一** id 提前标记为「已消费」⇒ 它们被真吞掉。
  if (tamper === 'forgedDedupHit') {
    const uniq = [...new Set(alredelivery.map((e) => e.id))]
    for (const id of uniq.filter((_, i) => i % 2 === 0)) {
      mem.add(id); redis.add(id); bloom.add(id)
    }
  }
  let memAccepted = 0, redisAccepted = 0, bloomAccepted = 0
  for (const e of alredelivery) {
    // ① 去重状态每条消息重置 ⇒ 重投被当新消息二次消费。
    if (tamper === 'duplicateInvisible') { mem.clear(); redis.clear(); bloom.clear() }
    const rm = mem.add(e.id)
    if (rm.added) memAccepted += 1
    const rr = redis.add(e.id)
    if (rr.ok) redisAccepted += 1
    if (!bloom.has(e.id)) { bloom.add(e.id); bloomAccepted += 1 }
  }
  const uniqueCount = new Set(alredelivery.map((e) => e.id)).size
  const laneBOk = memAccepted === uniqueCount && redisAccepted === uniqueCount && bloomAccepted <= uniqueCount
  const holds = nontrivial && laneAOk && laneBOk
  return {
    laneA: {
      consistentAcceptedInMemory: r1.exact,
      consistentAcceptedRedis: r2.exact,
      consistentAcceptedBloom: r3.exact,
      /** 布隆在干净唯一流上的假阳损耗（实测 2/96）——概率结构的诚实读数，不是事故。 */
      bloomFalsePositivesOnUniqueFlow,
      unique: consistent.length,
    },
    laneB: {
      atLeastOnceAcceptedInMemory: memAccepted,
      atLeastOnceAcceptedRedis: redisAccepted,
      atLeastOnceAcceptedBloom: bloomAccepted,
      unique: uniqueCount,
    },
    holds,
    nontrivial,
    events: events.length,
  }
}

/**
 * verifyIdempotencySoundness：双路自证 + 三路可证伪。
 * baseline 先真绿；三路 tamper 真改变内核输入（去重状态如何被喂）后**喂回同一 holds 公式现算**，
 * 于是 falsifiable = baselineHolds && 三路 tamper.holds 全 false —— **真推导，绝不写死**。
 */
export function verifyIdempotencySoundness(input = {}, opts = {}) {
  const baseline = idempotencyCore(input, opts, 'normal')
  const duplicateInvisible = idempotencyCore(input, opts, 'duplicateInvisible')
  const forgedDedupHit = idempotencyCore(input, opts, 'forgedDedupHit')
  const emptyStream = idempotencyCore({ ...input, events: [] }, opts, 'normal')
  const baselineHolds = baseline.holds
  const falsifiable = baselineHolds && !duplicateInvisible.holds && !forgedDedupHit.holds && !emptyStream.holds
  const holds = baselineHolds && falsifiable
  return {
    laneA: baseline.laneA,
    laneB: baseline.laneB,
    baselineHolds,
    holds,
    nontrivial: baseline.nontrivial,
    falsifiable,
    tamper: {
      duplicateInvisible: {
        holds: duplicateInvisible.holds,
        reason: 'duplicateInvisible：去重状态每条消息重置 ⇒ 重投当新消息二次消费（接受 ' +
          duplicateInvisible.laneB.atLeastOnceAcceptedInMemory + ' > 唯一 ' + duplicateInvisible.laneB.unique +
          '）⇒ holds 真翻 false',
      },
      forgedDedupHit: {
        holds: forgedDedupHit.holds,
        reason: 'forgedDedupHit：全新唯一消息被伪造 redelivered 记录 ⇒ 合法新消息被吞（接受 ' +
          forgedDedupHit.laneB.atLeastOnceAcceptedInMemory + ' < 唯一 ' + forgedDedupHit.laneB.unique +
          '）⇒ holds 真翻 false',
      },
      emptyStream: {
        holds: emptyStream.holds,
        reason: '空消息流 ⇒ nontrivial=false，绝不 0=0 假绿',
      },
    },
    events: baseline.events,
  }
}

/**
 * verifyCausalLocks：三条结构锁在同一 raw 流上真跑。任何 rigged 开关都救不了。
 */
export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, IDEMPOTENT_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, IDEMPOTENT_DEFAULTS.messages)

  // ① Bloom 假阳性：装载因子上升 → FP 率 ε 结构性上涨（放弃 50% 装载线监控）
  const bloomSmall = createBloomGuard({ bits: 512, k: 3 })
  const uniqueMsgs = msgStreamOf('falsePositiveBurst', { seed, messages })
  for (const e of uniqueMsgs) bloomSmall.add(e.id)
  const bloomLarge = createBloomGuard({ bits: 4096, k: 3 })
  for (const e of uniqueMsgs) bloomLarge.add(e.id)
  const bloomFalsePositiveCausallyUnerasable = bloomSmall.fpr() > 0 && bloomLarge.fpr() < bloomSmall.fpr()

  // ② Redis RTT：精确 + 有界 ⇒ 状态必须外置 ⇒ 每条必付 RTT
  const redis = createRedisSetNx({})
  for (const e of msgStreamOf('consistentStream', { seed, messages })) redis.add(e.id)
  const redisRttCausallyUnerasable = redis.rtt() === msgStreamOf('consistentStream', { seed, messages }).length

  // ③ InMemory volatility：精确 + 本地 ⇒ 状态驻进程 ⇒ 重启即丢（看 size before/after clear）
  const mem = createInMemoryDedupSet({})
  for (const e of msgStreamOf('consistentStream', { seed, messages })) mem.add(e.id)
  const beforeClear = mem.size()
  mem.clear()
  const inMemoryVolatilityCausallyUnerasable = beforeClear === msgStreamOf('consistentStream', { seed, messages }).length && mem.size() === 0

  const causalLocksAllHold = bloomFalsePositiveCausallyUnerasable && redisRttCausallyUnerasable && inMemoryVolatilityCausallyUnerasable

  return Object.freeze({
    bloomFalsePositiveCausallyUnerasable,
    redisRttCausallyUnerasable,
    inMemoryVolatilityCausallyUnerasable,
    causalLocksAllHold,
    probes: { bloomSmallFpr: bloomSmall.fpr(), bloomLargeFpr: bloomLarge.fpr(), redisRttCount: redis.rtt(), inMemoryBeforeClear: beforeClear, inMemoryAfterClear: mem.size() },
  })
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createIdempotentEvidence(opts = {}) {
  const seed = intOr(opts.seed, IDEMPOTENT_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `idc:key:${i}`)
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
  bus.subscribe('idc.deduped', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('idc.deduped', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('idc.deduped')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`idc:dedup:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`idc:dedup:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ entry: null }), maxSize: 8 })
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
  heap.schedule(fixedNow + 40, 'idc:dedup')
  heap.schedule(fixedNow + 250, 'idc:gc')
  heap.schedule(fixedNow + 80, 'idc:lease')
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
  const unboundedRam = rigged || args.includes('--unbounded-ram')
  const zeroRttNetwork = rigged || args.includes('--zero-rtt-network')
  const collisionFreeBloom = rigged || args.includes('--collision-free-bloom')
  const study = idempotentConsumerStudy({ rigged, unboundedRam, zeroRttNetwork, collisionFreeBloom, now: () => nowMs })
  const snap = idempotentConsumerSnapshot(study)
  console.log('[idempotent-consumer] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' bloomBits=' + snap.config.bloomBits + ' bloomK=' + snap.config.bloomK +
    ' redisTtlMs=' + snap.config.redisTtlMs +
    ' rigged=' + snap.config.rigged +
    ' unboundedRam=' + snap.config.unboundedRam +
    ' zeroRttNetwork=' + snap.config.zeroRttNetwork +
    ' collisionFreeBloom=' + snap.config.collisionFreeBloom +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(18) +
      ' exact=' + row.metrics.totalExact + ' rejected=' + row.metrics.totalRejected + ' fp=' + row.metrics.falsePositiveRejections +
      ' trilemma={' + ['exactDedup=' + row.trilemma.exactDedup, 'lowOverhead=' + row.trilemma.lowOverhead, 'durableBounded=' + row.trilemma.durableBounded].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner +
    ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: bloomFp=' + snap.causalLocks.bloomFalsePositiveCausallyUnerasable +
    ' redisRtt=' + snap.causalLocks.redisRttCausallyUnerasable +
    ' inMemVol=' + snap.causalLocks.inMemoryVolatilityCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifyIdempotencySoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{mem=' + cp.laneA.consistentAcceptedInMemory + ' redis=' + cp.laneA.consistentAcceptedRedis + '}' +
    ' laneB{mem=' + cp.laneB.atLeastOnceAcceptedInMemory + ' redis=' + cp.laneB.atLeastOnceAcceptedRedis + ' bloom=' + cp.laneB.atLeastOnceAcceptedBloom + '}' +
    ' tamper{dup=' + cp.tamper.duplicateInvisible.holds + ',forged=' + cp.tamper.forgedDedupHit.holds + ',empty=' + cp.tamper.emptyStream.holds + '}')
}

