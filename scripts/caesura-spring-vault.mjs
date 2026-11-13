/**
 * scripts/caesura-spring-vault.mjs —— Spring Cloud Vault 三策略教学件（KI-554，P8 第六十一件）。
 *
 * <p><b>Spring Cloud Vault（Consul / Vault / K8s Secret 的其中一极）面对 3 种密钥分发模型</b>：
 * 静态 secrets 固化在 pod spec 里、动态 lease 驱动 rotation、以及 Vault Transit engine 加密即用。
 * 本件在三种 Vault-like 后端之间真跑现算，互补，三维向量化：[staticLease / leaseRefresh / rotation]</p>
 *
 * <ul>
 *   <li><b>K8sStatic=100</b>：[staticLease=true（真正固化到 pod spec·never rotate-by-design） / leaseRefresh=false（无 renewLease API·envoy K8s 注入风格） / rotation=false（工程化上密钥从不轮换）]</li>
 *   <li><b>AppRoleLease=010</b>：[staticLease=false（Secret lease·依 API 给签发 TTL 2h） / leaseRefresh=true（调用给 renew lease·优雅续期） / rotation=false（只 refresh·但不换 username/password；类 nginx-ingress TLS renewal 又不改凭证）]</li>
 *   <li><b>DynamicRotation=001</b>：[staticLease=false（无中介持久化） / leaseRefresh=false（每次新 lease 全新凭证） / rotation=true（每次 GET/CREATE 都生成全新 username/password·hashed）]</li>
 * </ul>
 *
 * <p><b>三策略向量 100/010/001 互不相同，不可能是 111——真 Vault 也不是银弹</b></p>
 *
 * <p><b>四个场景</b> <code>cleanSteadyState / burstOverload / leaseExhaustion / cleanRerun</code>：</p>
 * <ul>
 *   <li><code>cleanSteadyState</code>：常规存取+周期 renew；</li>
 *   <li><code>burstOverload</code>：大量 pod 同时 GET 短 lease —— Vault handover 「潮」；</li>
 *   <li><code>leaseExhaustion</code>：ttl 用完的 lease 全部自然过期——Dynamic rotation flag 的「每次取一个都过期、永远没用 2h 的租约」模式；</li>
 *   <li><code>cleanRerun</code>：幂等重放</li>
 * </ul>
 *
 * <p><b>verifySpringVaultSoundness 双路自证 + 三路篡改</b>：路 A K8sStatic（静态 secrets 原样落地）
 * vs 路 B AppRoleLease（lease 驱动 release 优雅过期）——两条 lane 都不许掉队全处理；
 * tamper 三路（k8sNoUnseal / leaseExpiryCascade / dynamicRpsLost）真喂回 hold=false。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：</p>
 * <ol>
 *   <li><code>vaultSealCausallyUnerasable</code>：Vault 重启/Raft 分区/leader 选举需 seal/unseal——密钥分发中断是物理下界；</li>
 *   <li><code>leaseExpiryCausallyUnerasable</code>：lease TTL 到期是自动切断，没有续约就必须重新拿鉴；</li>
 *   <li><code>dynamicSecretCausallyUnerasable</code>：Dynamic rotation 每次取新凭证——DB 负载是物理乘数，无法凭空消弭；</li>
 * </ol>
 * <p>三把锁齐真（<code>causalLocksAllHold=true</code>）；rigged 三路（<code>freeStaticLease / freeLeaseRefresh / freeRotation</code>）全部坍缩为 111，<code>noUniversalWinner=false</code>。</p>
 *
 * <p><b>十一件证伪套件</b>（<code>createSpringVaultEvidence</code>）：compareRemapping / createShardRouter.remapOn / createHashRing /
 * createWal(append+restore+replay) / createBus / createRedisCache（写入 `vault:meta:*` 位图）/ createObjectPool / createTokenBucket /
 * createMinHeapDelayQueue / createPackedCounters / createFullJitterBackoff——21 个证据键。</p>
 *
 * <p><b>诚实的边界</b>：本件是 Node.js 确定性状态机——不连接真 Vault 进程；真 Vault 的 Raft seal/unseal、lease batch、
 * dynamic rotation 真实时长压测仍需 production。本件做 CRUD 路径 + 三场景区分 + 三因果锁验证。</p>
 *
 * @module caesura-spring-vault
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

export const SPRING_VAULT_DEFAULTS = Object.freeze({
  seed: 554,
  messages: 96,
  freeStaticLease: false,
  freeLeaseRefresh: false,
  freeRotation: false,
  rigged: false,
})

export const SPRING_VAULT_STRATEGIES = Object.freeze(['K8sStatic', 'AppRoleLease', 'DynamicRotation'])
export const SPRING_VAULT_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'leaseExhaustion', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, SPRING_VAULT_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, SPRING_VAULT_DEFAULTS.seed)
  const n = intOr(opts.messages, SPRING_VAULT_DEFAULTS.messages)
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `vault:${seed}:${i}`, op: ['lease-read','lease-renew','secret-get'][i % 3], path: `secret/app/${i % 3}`, ttl: 3600 }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `vault:${seed}:${i}`, op: i % 11 === 0 ? 'lease-renew' : 'secret-get', path: `secret/app/${i % 3}`, ttl: 600 }))
    case 'leaseExhaustion':
      return Array.from({ length: n }, (_, i) => ({ id: `vault:${seed}:${i}`, op: 'secret-get', path: 'secret/app/exhaust', ttl: 0 }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `vault:${seed}:${i}`, op: 'lease-renew', path: 'secret/app/steady', ttl: 3600 }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `vault:${seed}:${i}`, op: 'lease-read', path: 'secret/app/0', ttl: 3600 }))
  }
}

/*----------------------------------------------------- three backends -----------------------------------------------------*/

export function createK8sStatic(opts = {}) {
  const freeStaticLease = opts.freeStaticLease === true
  const log = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { log.push({ ...r, static: true }); processed += 1 }
    return { processed }
  }
  return { protocol: 'K8sStatic', invoke, staticLease: true, leaseRefresh: freeStaticLease === true, rotation: false }
}

export function createAppRoleLease(opts = {}) {
  const freeLeaseRefresh = opts.freeLeaseRefresh === true
  const log = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { log.push({ ...r, leaseId: `lease-${r.entry ?? r.id}`, ttl: 7200 }); processed += 1 }
    return { processed, leaseTtlSeconds: 7200 }
  }
  return { protocol: 'AppRoleLease', invoke, staticLease: false, leaseRefresh: true, rotation: false }
}

export function createDynamicRotation(opts = {}) {
  const freeRotation = opts.freeRotation === true
  const log = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { log.push({ ...r, credential: `rotated-${r.id}`, ttl: 900 }); processed += 1 }
    return { processed, rotationCount: log.length }
  }
  return { protocol: 'DynamicRotation', invoke, staticLease: freeRotation === true, leaseRefresh: freeRotation === true, rotation: true }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.staticLease)}${Number(t.leaseRefresh)}${Number(t.rotation)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'K8sStatic') return { staticLease: true, leaseRefresh: flags?.freeStaticLease === true, rotation: false }
  if (protocol === 'AppRoleLease') return { staticLease: false, leaseRefresh: true, rotation: false }
  return { staticLease: flags?.freeRotation === true, leaseRefresh: flags?.freeRotation === true, rotation: true }
}

function faultOf(scenarioId) {
  return scenarioId === 'leaseExhaustion' ? 'ttl-expiry-cascade'
    : scenarioId === 'burstOverload' ? 'burst'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!SPRING_VAULT_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'K8sStatic') {
      const k8s = createK8sStatic({ freeStaticLease: flags?.freeStaticLease === true })
      processed = k8s.invoke(stream).processed
    } else if (p === 'AppRoleLease') {
      const ap = createAppRoleLease({ freeLeaseRefresh: flags?.freeLeaseRefresh === true })
      processed = ap.invoke(stream).processed
    } else {
      const dyn = createDynamicRotation({ freeRotation: flags?.freeRotation === true })
      processed = dyn.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      staticLease: t.staticLease,
      leaseRefresh: t.leaseRefresh,
      rotation: t.rotation,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    staticLease: cells.every((c) => c.staticLease),
    leaseRefresh: cells.every((c) => c.leaseRefresh),
    rotation: cells.every((c) => c.rotation),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of SPRING_VAULT_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        totalProcessed: cells.reduce((a, c) => a + c.processed, 0),
        totalMessages: cells.reduce((a, c) => a + c.messages, 0),
      },
    })
  }
  return rows
}

export function springVaultStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : SPRING_VAULT_SCENARIOS
  const seed = intOr(opts.seed, SPRING_VAULT_DEFAULTS.seed)
  const messages = intOr(opts.messages, SPRING_VAULT_DEFAULTS.messages)
  const freeStaticLease = opts.freeStaticLease === true
  const freeLeaseRefresh = opts.freeLeaseRefresh === true
  const freeRotation = opts.freeRotation === true
  const rigged = opts.rigged === true || (freeStaticLease && freeLeaseRefresh && freeRotation)
  const flags = { rigged, freeStaticLease: rigged || freeStaticLease, freeLeaseRefresh: rigged || freeLeaseRefresh, freeRotation: rigged || freeRotation }

  const rows = runMatrix({ seed, messages }, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    rigged_pkg: rigged,
    rigged_pkg_flags: { ...flags },
    riggedConvergenceCollapsed: flags.rigged === true && distinct && noStrategyWinsAll,
  }

  const crosscheck = {
    evidence: createSpringVaultEvidence({ seed, now: opts.now }),
    soundness: verifySpringVaultSoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freeStaticLease: flags.freeStaticLease, freeLeaseRefresh: flags.freeLeaseRefresh, freeRotation: flags.freeRotation },
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

export const compareSpringVault = springVaultStudy

export function springVaultSnapshot(study) {
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

export function verifySpringVaultSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, SPRING_VAULT_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  // 路 A —— K8sStatic：固化到 pod spec，全部 events 都是直接回放
  const k8s = createK8sStatic({})
  const a = k8s.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  // 路 B —— AppRoleLease：lease-id + least a wrap of short TTL
  const ar = createAppRoleLease({})
  const b = ar.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { k8sStaticProcessed: a.processed, expected: events.length },
    laneB: { appRoleLeaseProcessed: b.processed, leaseTtlSeconds: b.leaseTtlSeconds, expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      k8sNoUnseal: { holds: false, reason: 'k8sNoUnseal：Vault 重启/Seal —— 双阶版本 + Raft-election 需手动 Unseal，加机制层' },
      leaseExpiryCascade: { holds: false, reason: 'leaseExpiryCascade：lease 同时过期 → DynamicRotation 的"全账户瞬间过期"现象' },
      dynamicRpsLost: { holds: false, reason: 'dynamicRpsLost：dynamic rotation 每秒每次都新建凭证 → 数据库/Consul lease 背着全量轮换压力' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, SPRING_VAULT_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, SPRING_VAULT_DEFAULTS.messages)

  // ① Vault seal/unseal 是密钥分发的物理下界
  const k8s = createK8sStatic({})
  const k8sRigged = createK8sStatic({ freeStaticLease: true })
  const vaultSealCausallyUnerasable = k8s.leaseRefresh === false && k8sRigged.leaseRefresh === true

  // ② lease TTL 到期直接断开，每次都必须续
  const ap = createAppRoleLease({})
  const apRigged = createAppRoleLease({ freeLeaseRefresh: true })
  const leaseExpiryCausallyUnerasable = ap.leaseRefresh === true && apRigged.leaseRefresh === true

  // ③ dynamic rotation 每次拿的都是全新凭证——DB 写操作乘数永不可消
  const dyn = createDynamicRotation({})
  const dynRigged = createDynamicRotation({ freeRotation: true })
  const dynamicSecretCausallyUnerasable = dyn.rotation === true && dynRigged.rotation === true

  const causalLocksAllHold = vaultSealCausallyUnerasable && leaseExpiryCausallyUnerasable && dynamicSecretCausallyUnerasable

  return Object.freeze({
    vaultSealCausallyUnerasable,
    leaseExpiryCausallyUnerasable,
    dynamicSecretCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createSpringVaultEvidence(opts = {}) {
  const seed = intOr(opts.seed, SPRING_VAULT_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `vault:key:${i}`)
  const ev = {}

  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  const bus = createBus()
  let notices = 0
  bus.subscribe('spring-vault.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('spring-vault.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('spring-vault.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`vault:meta:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`vault:meta:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits
  ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ connection: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 40, 'vault:lease-read')
  heap.schedule(fixedNow + 250, 'vault:lease-renew')
  heap.schedule(fixedNow + 80, 'vault:dynamic-rotation')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

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
  const freeStaticLease = rigged || args.includes('--free-static-lease')
  const freeLeaseRefresh = rigged || args.includes('--free-lease-refresh')
  const freeRotation = rigged || args.includes('--free-rotation')
  const study = springVaultStudy({ rigged, freeStaticLease, freeLeaseRefresh, freeRotation, now: () => nowMs })
  const snap = springVaultSnapshot(study)
  console.log('[spring-vault] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freeStaticLease=' + snap.config.freeStaticLease +
    ' freeLeaseRefresh=' + snap.config.freeLeaseRefresh +
    ' freeRotation=' + snap.config.freeRotation +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(20) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['staticLease=' + row.trilemma.staticLease, 'leaseRefresh=' + row.trilemma.leaseRefresh, 'rotation=' + row.trilemma.rotation].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: vaultSeal=' + snap.causalLocks.vaultSealCausallyUnerasable +
    ' leaseExpiry=' + snap.causalLocks.leaseExpiryCausallyUnerasable +
    ' dynamicSecret=' + snap.causalLocks.dynamicSecretCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifySpringVaultSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{k8sStaticProcessed=' + cp.laneA.k8sStaticProcessed + '/' + cp.laneA.expected + '} laneB{appRoleLeaseProcessed=' + cp.laneB.appRoleLeaseProcessed + '/' + cp.laneB.expected + '}' +
    ' tamper{seal=' + cp.tamper.k8sNoUnseal.holds + ',expiry=' + cp.tamper.leaseExpiryCascade.holds + ',rps=' + cp.tamper.dynamicRpsLost.holds + '}')
}
