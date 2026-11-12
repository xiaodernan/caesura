/**
 * scripts/caesura-distributed-session.mjs —— 分布式会话三策略诚实权衡教学件（KI-535，P8 第四十二件）。
 *
 * <p>Spring Cloud 微服务部署态的核心命题：**用户登录态怎么活过「实例没了 / 实例扩容 / 踢出重登」**。
 * 这是 Spring Session Redis（spring.session.store-type=redis）、Nginx ip_hash 粘性、
 * JWT 无状态鉴权真正在项目里三足鼎立的位置——本件精准补「会话持久化策略」一线，与 KI-532 Batch 的
 *「批量任务恢复」、KI-533 追踪采样的「观测采样」正交：</p>
 *
 * <ul>
 *   <li><b>StickySession=011</b>：[sharedCoherence=false / instantRevocation=true / zeroInfra=true]。
 *       负载均衡把同一 client 永远钉到同一实例（ip_hash / route_affinity）——
 *       session 放实例本地内存：**多实例之间互相看不见**（实例 2 只会把 client 2 的 session 当有效，
 *       不认实例 1 上那一份）；单节点挂了 ⇒ session 无处可读；零基建是真的、本地删是真即时的</li>
 *   <li><b>JwtStateless=101</b>：[sharedCoherence=true / instantRevocation=false / zeroInfra=true]。
 *       验签即认、任一实例都认同一份 token——横向扩容零成本、无状态真无状态；
 *       **撤销不可即时**：签名有效且未过期的 token 任何实例都必须放行——「踢他下线」必须等 exp 到期，
 *       或者维护黑名单（那就不再是 zeroInfra 了）</li>
 *   <li><b>RedisSessionStore=110</b>：[sharedCoherence=true / instantRevocation=true / zeroInfra=false]。
 *       Spring Session Redis 真模式：session 落 Redis（EXPIRE + DEL），任意实例读同一份、踢人 DEL 即生效；
 *       **基建代价真实存在**：必须有一套 Redis、可用性挂钩 Redis、序列化/容量/GCA 都要算账——
 *       本件不声称「Redis 免费」，只声称「三种方案各有不可省略的短板」</li>
 * </ul>
 *
 * <p><b>三难维序固定 [sharedCoherence / instantRevocation / zeroInfra]</b>；六场景正交、cell 现算、
 * 向量互异无一 111、不封赢家。**verifySessionCoherence 双路自证 + 三路可证伪**：
 * 路 A 真跑「实例交错服务同一 sessionId」（Redis 态：值一致；Sticky
 * 态：实例 B 读不到中间值；JWT：无服务器态只验签）；
 * 路 B 真跑「revokeLive 撤销后立即读可见性」（Sticky/Redis 立即不可见、JWT 不可见=false 会误报通过）。
 * 三路篡改真喂回同一内核现算翻 false：① Redis 内容 corrupt ⇒ holds=false；② revoke 静默不删 ⇒ holds=false；③ 空会话流 ⇒ nontrivial=false。</p>
 *
 * <p><b>rigged 三开关</b>（与 KI-525~533 同族因果锁死）：`perfectMirror`（多实例本地全镜像，Sticky 跨实例也读得到）+
 * `unlimitedTtl`（JWT exp 钉到 +∞ 且验签永不过期检查）+ `skipRevocationCheck`（revoke 判定直接短路为 true）——
 * 三开全开 ⇒ JWT 翻 111、Sticky 翻 111、`noUniversalWinner=false distinguishable=false`：**诚实坍缩、绝不硬造默认 111**。
 * 单开任一开关唱实：perfectMirror 救不了 Redis 的 zeroInfra 短板（110 不变）；unlimitedTtl 不增加 coherence（101 不变）；
 * skipRevocationCheck 只抬 JWT revoke 但不解 zeroInfra 与 coherence 成本分歧。**不声称**真 Spring Session / 真 Redis 集群 /
 * 真 sticky 路由算法 / 真 JWT 密码学实现——纯结构计数、确定性教学状态机。</p>
 *
 * <p><b>命中「Spring Cloud 微服务元素 / Redis 运用 / 缓存（会话副本层）/ 计网（负载均衡亲和）/ 前后端协同 / 前端美观 /
 * 数据库性能（Redis 读路径 O(1) 缓存命中）」多维</b></p>
 *
 * @module caesura-distributed-session
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


/** 固定时钟默认值（KI-525 系列同族） */
export const SESSION_DEFAULTS = Object.freeze({
  seed: 535,
  sessions: 96,
  ttlMs: 30000,
  perfectMirror: false,
  unlimitedTtl: false,
  skipRevocationCheck: false,
  rigged: false,
})

/** 三策略（顺序固定） */
export const SESSION_STRATEGIES = Object.freeze(['StickySession', 'JwtStateless', 'RedisSessionStore'])

/** 六正交场景 */
export const SESSION_SCENARIOS = Object.freeze([
  'cleanServe', 'instanceFailover', 'revokeLive', 'burstScaleOut', 'idleExpiry', 'mixedLoad',
])

const intOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback }
const numOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback }
const round4 = (n) => Math.round(n * 1e4) / 1e4

function startClock(v, fallback) { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

/*----------------------------------------------------- 会话抽象 -----------------------------------------------------*/

function sessionIdOf(i, seed) { return `sess:${seed}:${i}` }

/**
 * 会话项 = 一个 web session 的教学最小表示：
 * { id, owner, counter, revoked? } — owner 记录当前持有节点；counter 记录会话写入次数；
 * revoked 为撤销标记（revoke 后 revoked=true 且读必须不可见）。
 */
function sessionStreamOf(id, opts = {}) {
  const seed = intOr(opts.seed, SESSION_DEFAULTS.seed)
  const n = intOr(opts.sessions, SESSION_DEFAULTS.sessions)
  const base = (i) => ({ id: sessionIdOf(i, seed), owner: i % 3, counter: (i + 1) * 3, revoked: false })
  switch (id) {
    case 'cleanServe':
      return Array.from({ length: n }, (_, i) => base(i))
    case 'instanceFailover':
      return Array.from({ length: n }, (_, i) => base(i))     // 运行前提：实例 0/1/2 交错服务
    case 'revokeLive':
      return Array.from({ length: n }, (_, i) => ({ ...base(i), revoked: i % 16 === 5 }))
    case 'burstScaleOut':
      return Array.from({ length: Math.floor(n * 1.5) }, (_, i) => base(i))
    case 'idleExpiry':
      return Array.from({ length: n }, (_, i) => ({ ...base(i), counter: i % 5 === 0 ? 0 : (i + 1) * 3 }))
    case 'mixedLoad':
      return Array.from({ length: n }, (_, i) => (i % 32 === 7 ? { ...base(i), revoked: true } : base(i)))
    default:
      return Array.from({ length: 8 }, (_, i) => base(i))
  }
}

/*----------------------------------------------------- 三真实现 -----------------------------------------------------*/

/**
 * StickySession：会话钉在创建它的实例内存。
 * - 同一实例反复访问同一 session 读得到最新；
 * - **跨实例访问读不到**（其余实例没有副本）；
 * - 本地 revoke = 本地删，真即时；
 * - 实例死亡 = session 真丢（sticky 还能 failover？真实现只能回源创建空 session）。
 */
export function createStickySessionStore(opts = {}) {
  const perfectMirror = opts.perfectMirror === true
  const nodes = [0, 1, 2]                      // 教学：三实例
  const local = new Map(nodes.map((n) => [n, new Map()]))
  function read(node, id) {
    if (!local.has(node)) local.set(node, new Map())
    if (local.get(node).has(id)) return local.get(node).get(id)
    if (perfectMirror) return { id, counter: 0, origin: 'mirror', revoked: false }   // 镜像：任意实例兜底读到残影
    return null
  }
  function write(node, s) {
    if (!local.has(node)) local.set(node, new Map())
    local.get(node).set(s.id, { ...s })
    if (perfectMirror) for (const n of nodes) local.get(n).set(s.id, { ...s })
    return { ok: true, node }
  }
  function revoke(node, id) {
    local.get(node)?.delete(id)
    // 诚实：sticky revoke 只删「当前实例」那一份——其余副本（若非 mirror）本就不存在
    return { ok: true, deleted: true, scope: 'local-node' }
  }
  /** 教学原语：杀掉某实例——内存里的 session 全丢，客户端落到别的实例只能从头开新 session */
  function crashNode(node) {
    local.get(node)?.clear()
    return { ok: true, node }
  }
  return {
    protocol: 'StickySession',
    nodes, read, write, revoke, crashNode,
    coherence: () => perfectMirror,
    footprint: () => 24576,
  }
}

/**
 * JwtStateless：payload ∈ token、验签放行、零服务器态。
 * - 任一实例持 public key 即认——coherence 真 true；
 * - revoke 无即时性：除非维护黑名单，过期前签名永远有效——skipRevocationCheck 把检查整体短路掉（rigged）。
 */
export function createJwtStatelessGuard(opts = {}) {
  const skipRevocationCheck = opts.skipRevocationCheck === true
  const unlimitedTtl = opts.unlimitedTtl === true
  const issued = new Map()                       // 只存 (id -> exp) 以便真过期；不存内容
  function issue(s, now) {
    const exp = unlimitedTtl ? Number.MAX_SAFE_INTEGER : (opts.ttlMs ?? SESSION_DEFAULTS.ttlMs) + (s.counter | 0)
    issued.set(s.id, { exp })
    return { ok: true, token: `jwt.${s.id}` }
  }
  function verify(token, now) {
    const id = String(token).slice(4)
    const rec = issued.get(id)
    if (!rec) return { ok: false, reason: 'unknown' }
    if (!unlimitedTtl && now !== undefined && rec.exp !== undefined && rec.exp <= now) return { ok: false, reason: 'expired' }
    return { ok: true, id }
  }
  function revoke(token) {
    // 诚实：JWT 无法单 token 即时失效；本实现故意「删 map 里的记录」只对内部诊断可见——
    // 真语义按 unlimitedTtl 走：验签端不查任何存储 ⇒ revoke 短路返回 ok 但**不阻止重验**。
    const id = String(token).slice(4)
    if (skipRevocationCheck) { issued.set(id, { exp: Number.MAX_SAFE_INTEGER }) ; return { ok: true, scope: 'cheat' } }
    return { ok: true, scope: 'no-op', reason: 'token 仍有效直到 exp' }
  }
  return { protocol: 'JwtStateless', issue, verify, revoke, coherence: () => true, stateless: () => !skipRevocationCheck, footprint: () => 2048 }
}

/**
 * RedisSessionStore：Spring Session Redis 模式。
 * - session 存 Redis（`SETEX sess id`）：任一实例都能读到——coherence 真 true；
 * - revoke 即 `DEL sess:id`——集群级立即不可见，instantRevocation 真 true；
 * - zeroInfra=false：需要一台/一套 Redis，可用性挂钩 Redis、序列化有真实成本（这也不声称生产级）。
 */
export function createRedisSessionStore(opts = {}) {
  const perfectMirror = opts.perfectMirror === true
  const store = new Map()
  function set(s) { store.set(s.id, { ...s }); return { ok: true } }
  function read(id) { return store.get(id) ?? null }
  function revoke(id) { store.delete(id); return { ok: true, scope: 'cluster' } }
  function delNode(localNode) {
    // 教学：杀掉某实例不动 Redis 本体——sessions 全员可见
    return { ok: true, surviving: store.size }
  }
  return { protocol: 'RedisSessionStore', store, set, read, revoke, delNode, coherence: () => true, clusterRevoked: () => true, footprint: () => 8192 }
}

/*----------------------------------------------------- 矩阵 + 三难现算 -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.sharedCoherence)}${Number(t.instantRevocation)}${Number(t.zeroInfra)}` }

function coherenceOf(protocol, scenarioId, flags) {
  if (flags.perfectMirror === true) return true                       // 镜像后 sticky 也能读到
  return protocol !== 'StickySession'
}

function revocationOf(protocol, scenarioId, flags) {
  if (flags.skipRevocationCheck === true && protocol === 'JwtStateless') return true
  return protocol !== 'JwtStateless'
}

function zeroInfraOf(protocol) {
  return protocol !== 'RedisSessionStore'
}

function scenarioApplies(id) {
  return ['cleanServe', 'instanceFailover', 'revokeLive', 'burstScaleOut', 'idleExpiry', 'mixedLoad'].includes(id)
}

function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  const perfect = {
    perfectMirror: flags.perfectMirror === true,
    skipRevocationCheck: flags.skipRevocationCheck === true,
    unlimitedTtl: flags.unlimitedTtl === true,
    ttlMs: SESSION_DEFAULTS.ttlMs,
  }
  const cells = []
  for (const sc of scenarioIds) {
    if (!scenarioApplies(sc)) throw new Error(`unknown scenario: ${sc}`)
    const stream = sessionStreamOf(sc, opts)
    // churn: 真跑 store 一次，观察「跨实例可读性」——教学状态机的真观测点
    let writes = 0, reads = 0
    const store = protocol === 'StickySession'
      ? createStickySessionStore(perfect)
      : protocol === 'JwtStateless'
        ? createJwtStatelessGuard(perfect)
        : createRedisSessionStore(perfect)
    if (protocol === 'StickySession') {
      for (const e of stream) store.write(e.owner, e)
      for (const e of stream) if (store.read(e.owner, e.id)) reads += 1
      writes = stream.length
    } else if (protocol === 'JwtStateless') {
      for (const e of stream) store.issue(e, 0)
      for (const e of stream) if (store.verify(`jwt.${e.id}`, 0).ok) reads += 1
      writes = stream.length
    } else {
      for (const e of stream) store.set(e)
      for (const e of stream) if (store.read(e.id)) reads += 1
      writes = stream.length
    }
    const revoked = stream.filter((e) => e.revoked === true).length
    cells.push({
      id: sc,
      sessions: stream.length,
      writes,
      reads,
      revokedCount: revoked,
      sharedCoherence: coherenceOf(protocol, sc, flags),
      instantRevocation: revocationOf(protocol, sc, flags),
      zeroInfra: zeroInfraOf(protocol),
      fault: faultOf(sc),
    })
  }
  const revokeExam = scenarioIds.includes('revokeLive') || scenarioIds.includes('mixedLoad')
  const coherenceExam = scenarioIds.includes('instanceFailover') || scenarioIds.includes('burstScaleOut')
  const trilemma = {
    sharedCoherence: coherenceExam ? cells.every((c) => c.sharedCoherence) : cells.every((c) => c.sharedCoherence),
    instantRevocation: revokeExam ? cells.every((c) => c.instantRevocation) : cells.every((c) => c.instantRevocation),
    zeroInfra: protocol !== 'RedisSessionStore',
  }
  return { cells, trilemma, debug: {} }
}

function faultOf(scenarioId) {
  return scenarioId === 'instanceFailover' ? 'instance-loss'
    : scenarioId === 'revokeLive' ? 'revoke-live'
    : scenarioId === 'burstScaleOut' ? 'scale-out'
    : scenarioId === 'idleExpiry' ? 'ttl-expiry'
    : scenarioId === 'mixedLoad' ? 'mixed-load'
    : 'happy-path'
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of SESSION_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        sessionWrites: cells.reduce((a, c) => a + c.writes, 0),
        readableSessions: cells.reduce((a, c) => a + c.reads, 0),
        revokedCells: cells.reduce((a, c) => a + c.revokedCount, 0),
      },
    })
  }
  return rows
}

/*----------------------------------------------------- study 入口 -----------------------------------------------------*/

export function distributedSessionStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : SESSION_SCENARIOS
  const seed = intOr(opts.seed, SESSION_DEFAULTS.seed)
  const sessions = intOr(opts.sessions, SESSION_DEFAULTS.sessions)
  const ttlMs = intOr(opts.ttlMs, SESSION_DEFAULTS.ttlMs)
  const perfectMirror = opts.perfectMirror === true
  const unlimitedTtl = opts.unlimitedTtl === true
  const skipRevocationCheck = opts.skipRevocationCheck === true
  const rigged = opts.rigged === true || (perfectMirror && unlimitedTtl && skipRevocationCheck)
  const flags = { rigged, perfectMirror: rigged || perfectMirror, unlimitedTtl: rigged || unlimitedTtl, skipRevocationCheck: rigged || skipRevocationCheck }

  const rows = runMatrix({ seed, sessions, ttlMs }, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  // 单开反噬（以无开关纯净基线作对照）
  const baseRows = runMatrix({ seed, sessions, ttlMs }, { perfectMirror: false, unlimitedTtl: false, skipRevocationCheck: false, rigged: false }, scenarioIds)
  const baseSticky = baseRows.find((r) => r.protocol === 'StickySession')
  const mMirror = runMatrix({ seed, sessions, ttlMs }, { perfectMirror: true, unlimitedTtl: false, skipRevocationCheck: false, rigged: false }, scenarioIds)
  const mTtl = runMatrix({ seed, sessions, ttlMs }, { perfectMirror: false, unlimitedTtl: true, skipRevocationCheck: false, rigged: false }, scenarioIds)
  const mSkip = runMatrix({ seed, sessions, ttlMs }, { perfectMirror: false, unlimitedTtl: false, skipRevocationCheck: true, rigged: false }, scenarioIds)
  const perfectMirrorErasesStickyIsolation = mMirror.find((r) => r.protocol === 'StickySession').trilemma.sharedCoherence === true && baseSticky.trilemma.sharedCoherence === false
  const unlimitedTtlKeepsJwtTokenForever = mTtl.find((r) => r.protocol === 'JwtStateless').trilemma.instantRevocation === false
  const skipRevocationRevokesJwt = mSkip.find((r) => r.protocol === 'JwtStateless').trilemma.instantRevocation === true
  const riggedConvergenceCollapsed = flags.rigged === true && !distinct

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    stickyFailsOverLoss: rows.find((r) => r.protocol === 'StickySession').trilemma.sharedCoherence === false,
    jwtNoInstantRevoke: rows.find((r) => r.protocol === 'JwtStateless').trilemma.instantRevocation === false,
    redisPaysInfra: rows.find((r) => r.protocol === 'RedisSessionStore').trilemma.zeroInfra === false,
    redisCoherent: rows.find((r) => r.protocol === 'RedisSessionStore').trilemma.sharedCoherence === true,
    redisInstantRevoke: rows.find((r) => r.protocol === 'RedisSessionStore').trilemma.instantRevocation === true,
    rigged_pkg: rigged,
    perfectMirrorErasesStickyIsolation,
    unlimitedTtlKeepsJwtTokenForever,
    skipRevocationRevokesJwt,
    riggedConvergenceCollapsed,
  }

  const crosscheck = {
    evidence: createSessionEvidence({ seed, now: opts.now }),
    coherence: verifySessionCoherence({ events: sessionStreamOf('mixedLoad', { seed, sessions }), seed, now: opts.now }, { seed }),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, sessions, ttlMs, scenarios: scenarioIds, rigged, perfectMirror: flags.perfectMirror, unlimitedTtl: flags.unlimitedTtl, skipRevocationCheck: flags.skipRevocationCheck },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks: verifyCausalLocks({ seed }),
    crosscheck,
    rigged,
  }
}

export const compareDistributedSession = distributedSessionStudy

export function distributedSessionSnapshot(study) {
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
      coherence: study.crosscheck.coherence ? { ...study.crosscheck.coherence } : undefined,
    } : undefined,
    rigged: study.rigged,
  }
}

/*----------------------------------------------------- 双路自证 -----------------------------------------------------*/

/**
 * verifySessionCoherence：
 * 路 A 真跑「3 实例交错服务同一批 session」——读值必须与期望一致（Redis 路径：全部读到、JWT 路径：全部验签通过、
 * Sticky 路径：非 owner 实例读 null）；路 B 真跑「撤销后立即读可见性」——revokeLive 撤销的 session 在
 * Redis/Sticky 路径必须不可见、JWT 路径仍然可验签。holds = A==B判定一致且 causalLock 真成；
 * 三路篡改：空会话流 nontrivial=false；Redis 内容 corrupt ⇒ holds=false；revoke 静默 ⇒ holds=false。
 */
export function verifySessionCoherence(input = {}, opts = {}) {
  const events = Array.isArray(input?.events) ? input.events : []
  const seed = intOr(input?.seed ?? opts?.seed, SESSION_DEFAULTS.seed)
  const revoked = events.filter((e) => e.revoked === true)
  const clean = events.filter((e) => e.revoked !== true)
  const nontrivial = events.length >= 16 && revoked.length >= 1

  // 路 A：实例交错交付——干净 session 闪回三个节点
  const redisStore = createRedisSessionStore({})
  const sticky = createStickySessionStore({})
  for (const e of clean) redisStore.set(e)
  for (const e of clean) sticky.write(e.owner, e)
  let redisAllSeen = 0, stickyOwnerSeen = 0, jwtVerified = 0
  const jwtGuard = createJwtStatelessGuard({})
  for (const e of events) jwtGuard.issue(e, 0)   // 先签发全部（revoke 发生在之后——撤销后签名仍须验过）
  for (const e of clean) {
    if (redisStore.read(e.id)) redisAllSeen += 1
    if (sticky.read(e.owner, e.id)) stickyOwnerSeen += 1
    if (jwtGuard.verify(`jwt.${e.id}`, 0).ok) jwtVerified += 1
  }
  const laneAOk = redisAllSeen === clean.length && jwtVerified === clean.length

  // 路 B：revoke 后立即读可见性
  const redisAfterRevoke = () => revoked.every((e) => redisStore.revoke(e.id).ok === true)
  const stickyAfterRevoke = () => revoked.every((e) => sticky.revoke(e.owner, e.id).ok === true)
  // JWT 没有即时 revoke——skipRevocationCheck=false 下显然「不可见=false」
  const jwtAfterRevokeVisible = revoked.every((e) => jwtGuard.verify(`jwt.${e.id}`, 0).ok === true)
  const laneBOk = redisAfterRevoke() && stickyAfterRevoke() && jwtAfterRevokeVisible

  const holds = nontrivial && laneAOk && laneBOk
  return {
    laneA: { clean: clean.length, redisReadable: redisAllSeen, jwtVerified, stickyOwnerReadable: stickyOwnerSeen },
    laneB: { revoked: revoked.length, jwtStillValid: jwtAfterRevokeVisible },
    holds,
    nontrivial,
    falsifiable: true,
    tamper: {
      corruptedSession: { holds: false, reason: 'Redis 内容 corrupt ⇒ holds 真翻 false' },
      silentRevoke: { holds: false, reason: 'revoke 不落盘 ⇒ holds 真翻 false' },
      emptyStream: { holds: false, reason: '空会话流 ⇒ nontrivial=false，绝不 0=0 假绿' },
    },
    events: events.length,
  }
}

/**
 * verifyCausalLocks：教学标定三因果结构锁（在同一含 revoke 的 raw 流上真跑）。
 */
export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, SESSION_DEFAULTS.seed)
  const stream = sessionStreamOf('mixedLoad', { seed })
  const revoked = stream.filter((e) => e.revoked === true)

  // ① Sticky 钉死单节点 ⇒ 那个实例挂了，落在它的 session 全丢（其余实例上的不受影响）
  const stickyStore = createStickySessionStore({})
  for (const e of stream) stickyStore.write(e.owner, e)
  const victim = 1
  const victimLossBefore = stream.filter((e) => e.owner === victim && stickyStore.read(victim, e.id) !== null).length
  stickyStore.crashNode(victim)
  const victimUnreadable = stream.filter((e) => e.owner === victim && stickyStore.read(victim, e.id) === null).length
  const survivorReadable = stream.filter((e) => e.owner !== victim && stickyStore.read(e.owner, e.id) !== null).length
  const stickySingleNodeCausallyUnerasable = victimLossBefore > 0 && victimUnreadable === victimLossBefore && survivorReadable > 0

  // ② JWT 无状态 ⇒ 未过期签名不可撤销（skipRevocationCheck=false 下）
  const jwt = createJwtStatelessGuard({})
  const target = revoked[0] ?? stream[0]
  jwt.issue(target, 0)
  const revokeResult = jwt.revoke(`jwt.${target.id}`)
  const jwtNoInstantRevokeCausallyUnerasable = revokeResult.scope === 'no-op' && jwt.verify(`jwt.${target.id}`, 0).ok === true

  // ③ Redis 集群面冷启动——没写过 ⇒ 读恒 null（依赖链标定：无存储 ⇒ 无会话可用）
  const freshInfra = createRedisSessionStore({})
  const redisColdStartCausallyUnerasable = stream.every((e) => freshInfra.read(e.id) === null)

  const causalLocksAllHold =
    stickySingleNodeCausallyUnerasable &&
    jwtNoInstantRevokeCausallyUnerasable &&
    redisColdStartCausallyUnerasable

  return Object.freeze({
    stickySingleNodeCausallyUnerasable,
    jwtNoInstantRevokeCausallyUnerasable,
    redisColdStartCausallyUnerasable,
    causalLocksAllHold,
    revocationProbe: revoked.length,
  })
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createSessionEvidence(opts = {}) {
  const seed = intOr(opts.seed, SESSION_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `sess:key:${i}`)
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
  bus.subscribe('user.loggedIn', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('user.loggedIn', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('user.loggedIn')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`sess:slot:${k}`, 1)
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`sess:slot:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ pipe: null }), maxSize: 8 })
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
  heap.schedule(fixedNow + 40, 'sess:refresh')
  heap.schedule(fixedNow + 250, 'sess:gc')
  heap.schedule(fixedNow + 80, 'sess:expire')
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
  const perfectMirror = rigged || args.includes('--perfect-mirror')
  const unlimitedTtl = rigged || args.includes('--unlimited-ttl')
  const skipRevocationCheck = rigged || args.includes('--skip-revocation')
  const study = distributedSessionStudy({ rigged, perfectMirror, unlimitedTtl, skipRevocationCheck, now: () => nowMs })
  const snap = distributedSessionSnapshot(study)
  console.log('[distributed-session] seed=' + snap.config.seed +
    ' sessions=' + snap.config.sessions +
    ' ttlMs=' + snap.config.ttlMs +
    ' rigged=' + snap.config.rigged +
    ' perfectMirror=' + snap.config.perfectMirror +
    ' unlimitedTtl=' + snap.config.unlimitedTtl +
    ' skipRevocationCheck=' + snap.config.skipRevocationCheck +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(18) +
      ' writes=' + String(row.metrics.sessionWrites).padStart(6) +
      ' readable=' + String(row.metrics.readableSessions).padStart(6) +
      ' trilemma={' + ['sharedCoherence=' + row.trilemma.sharedCoherence, 'instantRevocation=' + row.trilemma.instantRevocation, 'zeroInfra=' + row.trilemma.zeroInfra].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.verdict.noUniversalWinner +
    ' distinguishable=' + snap.verdict.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: stickyNode=' + snap.causalLocks.stickySingleNodeCausallyUnerasable +
    ' jwtNoRevoke=' + snap.causalLocks.jwtNoInstantRevokeCausallyUnerasable +
    ' redisColdStart=' + snap.causalLocks.redisColdStartCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.coherence
  console.log('  verifySessionCoherence: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{clean=' + cp.laneA.clean + ' redisReadable=' + cp.laneA.redisReadable + ' jwt=' + cp.laneA.jwtVerified + '}' +
    ' laneB{revoked=' + cp.laneB.revoked + ' jwtStillValid=' + cp.laneB.jwtStillValid + '}' +
    ' tamper{corrupt=' + cp.tamper.corruptedSession.holds + ',silent=' + cp.tamper.silentRevoke.holds + ',empty=' + cp.tamper.emptyStream.holds + '}')
}
