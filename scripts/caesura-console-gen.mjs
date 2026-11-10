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
 * Redis 原子桶原子不超发 vs 非原子 GET-SET 超发 + 跨实例共享）。
 * 四者都是**真 Node 侧判词的结构计数**、可注入规模、时钟注入 ⇒ 确定性可测；本件不复核、不重算，
 * 缺哪块就落 null，前端据实降级。因击穿对照真跑并发 loader（Promise.all），本件为 async。</p>
 *
 * @param {object} [opts]
 * @param {() => number} [opts.now] 时钟（注入则 builtAt 确定性）
 * @param {boolean} [opts.guards=false] 关掉缓存防护维（兼容旧快照）
 * @param {boolean} [opts.rateLimit=false] 关掉网关限流维（兼容旧快照）
 * @returns {Promise<{lsm:object|null, hw:object|null, guards:object|null, rateLimit:object|null, builtAt:number}>}
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
  return { lsm, hw, guards, rateLimit, builtAt: now() }
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
    process.exit(0)
  }).catch((e) => { console.error(`[console] 生成失败：${e.message}`); process.exit(1) })
}
