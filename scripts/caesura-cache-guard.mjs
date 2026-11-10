/**
 * scripts/caesura-cache-guard.mjs —— 缓存防护三件套：击穿 / 穿透 / 雪崩（Node.js 侧，KI-501）。
 *
 * <p>集大成主线已有缓存（KI-493 createRedisCache：LRU+TTL+singleflight+字节预算）、一致性哈希分片
 * （KI-499/500），却讲不出生产缓存最要紧的半边：**为什么缓存必须配防护、配了到底省多少回源**。
 * 本件把三大经典故障——①击穿（热点 key 过期瞬间并发一起穿透）、②穿透（查不存在的 key 次次打 DB）、
 * ③雪崩（大批 key 同一时刻集体过期）——各做成一只零依赖、可注入、可 headless 确定性测的对照教学件，
 * 并**复用** KI-493 缓存与 KI-496 Bloom filter 的真实现，不另抄一套。</p>
 *
 * <p><b>判定权仍 Node 侧（决策原则①）</b>：并发数、TTL、beta、jitter 比例、bucket 数、时钟、随机、
 * loader、缓存、Bloom 全由调用方 opts 注入；本件只跑状态机与结构计数，不写业务阈值、不实测墙钟。</p>
 *
 * <p><b>诚实边界（不声称）</b>：①不是生产缓存中间件 / 不接真 Redis 或真 DB——loader/cache/bloom 全
 * 进程内、可注入，是教学对照组。②回源次数、bucket 峰值都是**结构计数**（这段模拟里 loader 被调了几次、
 * 按注入时钟+rand 落进各 bucket 的条目数），不是真实压测的 QPS/墙钟/带宽。③布隆过滤器**不零误判**
 * （`bloomFalsePositives` 如实给出），空值缓存占内存有一致性窗（本件不建模）。④XFetch 的 `beta`、
 * jitter 的 `jitterRatio` 缺省仅教学值，真系统须实测调参。⑤加了防护≠永不故障：singleflight 只合并
 * 同 key、跨 key 仍需抖动，jitter 只削峰不减少总回源。⑥默认不参与运行时（cloud 里 cacheGuard:false
 * 缺省不装配，只挂 status.cacheGuard 读数、不改任何调用路径）。</p>
 *
 * 用法：
 *   const study = await cacheGuardStudy({ concurrency: 64, keys: 512 })
 *   study.stampede.singleflightLoads === 1          // 64 并发只回填一次
 *   study.penetration.bloomDbHits < study.penetration.naiveDbHits
 *   study.avalanche.jitterPeak < study.avalanche.uniformPeak
 *   npm run guard:bench                              // CLI 打印三件对照证据
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createBloomFilter } from './caesura-lsm-store.mjs'

/** 缺省教学参数（判定仍由注入值定；这里只是 CLI / 默认装配的起点）。 */
export const GUARD_DEFAULTS = Object.freeze({
  concurrency: 64,
  ttlMs: 1000,
  beta: 1,
  keys: 512,
  absentRatio: 0.5,
  rounds: 4,
  jitterRatio: 1,
  buckets: 16,
  missingValue: '__caesura_negative_tombstone__',
})

function rand01(seedRef) {
  // 可注入确定性 LCG；seedRef 是 {s} 对象，避免闭包外无法推进。
  seedRef.s = (Math.imul(seedRef.s, 1103515245) + 12345) & 0x7fffffff
  return seedRef.s / 0x7fffffff
}

/** 未注入 rand 时造一只确定性 LCG；注入则原样用调用方的。 */
function makeRand(opts) {
  if (typeof opts.rand === 'function') return opts.rand
  const ref = { s: Math.max(1, Math.floor(Number(opts.seed ?? 1979))) }
  return () => rand01(ref)
}

function round(x, digits = 6) {
  return Number.isFinite(x) ? Number(x.toFixed(digits)) : null
}

/**
 * ① 缓存击穿（stampede）对照。
 *
 * 三路真跑同一个热点 key 的 N 个并发 miss：
 *   - naive：无防护，N 个并发各调一次 loader ⇒ N 次回源（DB 被打 N 次）。
 *   - singleflight：**复用 KI-493 createRedisCache.load**，同 key 并发合并成一次 loader ⇒ 1 次回源。
 *   - xfetch：逻辑过期 / 概率提前续期——`shouldEarlyExpire` 在真过期前按 `age/ttl/beta/rand`
 *     判定是否单线程提前续上，报在过期瞬间之前就被续期、从而避免并发回源的次数。
 *
 * `naiveLoads` 恒等于本件真调 loader 的次数（对注入 loader 也逐次包装计数，不猜它内部行为）。
 *
 * @param {object} [opts] { concurrency?, ttlMs?, beta?, now?, rand?, seed?, loader?, cacheFactory? }
 */
export async function compareStampede(opts = {}) {
  const concurrency = Math.max(0, Math.floor(Number(opts.concurrency ?? GUARD_DEFAULTS.concurrency)))
  const ttlMs = Math.max(0, Number(opts.ttlMs ?? GUARD_DEFAULTS.ttlMs))
  const beta = Math.max(0, Number(opts.beta ?? GUARD_DEFAULTS.beta))
  const rand = makeRand(opts)

  // 空集降级：0 并发不调 loader、不除零，三路都诚实回 0。
  if (concurrency === 0) {
    return {
      concurrency: 0, ttlMs, beta, key: 'hot:player:1',
      naiveLoads: 0, singleflightLoads: 0, savedLoads: 0, amplification: null,
      xfetchEarlyRefreshes: 0, xfetchAvoidedMisses: 0,
    }
  }

  const baseLoader = typeof opts.loader === 'function' ? opts.loader : async () => ({ hp: 100 })
  // naive：无防护，N 个并发各真调一次 loader（await 一个微任务，让「并发」真正在途重叠）。
  let naiveLoads = 0
  const naiveLoader = async () => { naiveLoads++; return baseLoader() }
  const naivePromises = []
  for (let i = 0; i < concurrency; i++) naivePromises.push(naiveLoader())
  await Promise.all(naivePromises)

  // singleflight：复用 KI-493。用独立 sfLoader 数「真被合并到几次」，不依赖 naive 的 loader 内部。
  let sfLoads = 0
  const sfLoader = async () => { sfLoads++; await Promise.resolve(); return { hp: 100 } }
  const cache = typeof opts.cacheFactory === 'function'
    ? opts.cacheFactory()
    : createRedisCache({ now: opts.now })
  const sfPromises = []
  for (let i = 0; i < concurrency; i++) sfPromises.push(cache.load('hot:player:1', sfLoader, ttlMs))
  await Promise.all(sfPromises)

  // xfetch：在真过期前，按 shouldEarlyExpire 判定「这一路是否在过期瞬间前被单线程续上」。
  // 教学口径：对 concurrency 个观察点，各自在 age∈[0,ttl) 采样一次提前续期概率，
  // 命中者记一次提前刷新（真系统里这会挤掉过期那一刻的并发 miss）。
  let early = 0
  for (let i = 0; i < concurrency; i++) {
    const ageMs = rand() * ttlMs
    if (shouldEarlyExpire({ ageMs, ttlMs, beta, rand })) early++
  }

  return {
    concurrency, ttlMs, beta, key: 'hot:player:1',
    naiveLoads, singleflightLoads: sfLoads, savedLoads: naiveLoads - sfLoads,
    amplification: sfLoads > 0 ? round(naiveLoads / sfLoads, 2) : null,
    xfetchEarlyRefreshes: early,
    // 保守口径：提前续期最多能挤掉的并发回源数 = min(early, naiveLoads − 1)，不粉饰成全免。
    xfetchAvoidedMisses: Math.min(early, Math.max(0, naiveLoads - 1)),
  }
}

/**
 * XFetch / 概率提前过期判据（纯函数，可独立钉死）：
 * 当 `rand() < P(age)` 时提前续期，P 随 age 趋近 ttl 单调升到 beta。
 *   P = beta · (age/ttl)   （教学用线性风险函数；真 XFetch 用 (age/ttl)^beta）
 * @param {{ageMs:number,ttlMs:number,beta:number,rand:()=>number}} o
 */
export function shouldEarlyExpire(o) {
  const ttl = Number(o?.ttlMs ?? 0)
  if (ttl <= 0) return false
  const age = Math.max(0, Number(o?.ageMs ?? 0))
  const beta = Math.max(0, Number(o?.beta ?? 1))
  const p = Math.min(1, beta * (age / ttl))
  const r = typeof o.rand === 'function' ? o.rand() : 0.5
  return r < p
}

/**
 * ② 缓存穿透（penetration）对照。
 *
 * 只统计「**不存在**的 key」的回源次数（存在的 key 三路口径一致，不影响穿透对照）：
 *   - naive：次次打 DB（不存在的 key × rounds 轮）。
 *   - negativeCache：复用 KI-493 createRedisCache 写空值墓碑，同 key 第二次起命中墓碑、不再回源。
 *   - bloom：复用 KI-496 createBloomFilter 前置负查，mightHave=false 直接拒绝（0 次回源），
 *     true 才放行（假阳性会放进少量不存在的 key —— 如实计入 bloomFalsePositives）。
 *
 * @param {object} [opts] { keys?, keysCount?, presentKeys?, absentRatio?, rounds?, now?,
 *   negativeTtlMs?, tombstone?, cacheFactory?, bloom?, bloomOpts? }
 */
export function comparePenetration(opts = {}) {
  const keysRaw = Array.isArray(opts.keys) ? opts.keys : null
  const keys = keysRaw
    ? keysRaw.map(String)
    : Array.from({ length: Math.max(0, Math.floor(Number(opts.keysCount ?? GUARD_DEFAULTS.keys))) }, (_, i) => `q:${i}`)
  const presentKeys = Array.isArray(opts.presentKeys) ? opts.presentKeys.map(String) : null
  const absentRatio = Math.max(0, Math.min(1, Number(opts.absentRatio ?? GUARD_DEFAULTS.absentRatio)))
  // 未显式给 presentKeys 时，按 absentRatio 把前面一段当「库里真有」，其余当「查不存在」。
  const presentSet = new Set(presentKeys ?? (() => {
    const exists = Math.round(keys.length * (1 - absentRatio))
    return keys.slice(0, Math.max(0, Math.min(keys.length, exists)))
  })())
  const absent = keys.filter((k) => !presentSet.has(k))
  const tombstone = opts.tombstone ?? GUARD_DEFAULTS.missingValue
  const rounds = Math.max(1, Math.floor(Number(opts.rounds ?? GUARD_DEFAULTS.rounds)))

  // naive：不存在的 key 每轮都打 DB；rounds>1 模拟热点不存在 key 被反复查（爬虫/攻击）。
  const naiveDbHits = absent.length * rounds

  // negativeCache：复用 KI-493。首轮每个不存在的 key 回源一次并写墓碑；后续轮命中墓碑不再回源。
  const negCache = typeof opts.cacheFactory === 'function'
    ? opts.cacheFactory()
    : createRedisCache({ now: opts.now, maxEntries: Math.max(16, keys.length * 2) })
  let negativeDbHits = 0
  for (let r = 0; r < rounds; r++) {
    for (const k of absent) {
      if (negCache.get(k) === tombstone) continue   // 命中墓碑：挡住穿透
      negativeDbHits++                              // 缓存没有 ⇒ 回源一次
      negCache.set(k, tombstone, opts.negativeTtlMs ?? 0)
    }
  }

  // bloom：复用 KI-496。把「库里真有」的 key add 进去；不存在 key 负查命中 ⇒ 直接拒绝。
  const bloom = typeof opts.bloom === 'function' ? opts.bloom()
    : createBloomFilter({ numKeys: Math.max(1, presentSet.size), ...(opts.bloomOpts ?? {}) })
  for (const k of presentSet) bloom.add(k)
  let bloomDbHits = 0, bloomRejected = 0
  for (const k of absent) {
    if (!bloom.mightHave(k)) { bloomRejected++; continue }  // 一定不在 ⇒ 0 次回源
    bloomDbHits++                                            // 可能在（含假阳性）⇒ 放行一次回源
  }
  const bstats = typeof bloom.stats === 'function' ? bloom.stats() : {}

  return {
    keys: keys.length, present: presentSet.size, absent: absent.length, rounds,
    naiveDbHits, negativeDbHits, bloomDbHits, bloomRejected,
    bloomFalsePositives: bstats.falsePositives ?? null,
    bloomEstimatedFpRate: Number.isFinite(bstats.estimatedFpRate) ? round(bstats.estimatedFpRate, 6) : null,
    // 省下的回源比例（naive 为 0 时诚实给 null）。
    bloomSavedRate: naiveDbHits > 0 ? round((naiveDbHits - bloomDbHits) / naiveDbHits, 6) : null,
  }
}

/**
 * ③ 缓存雪崩（avalanche）对照。
 *
 * 同一批 key 同时写入，两种过期口径：
 *   - uniform：全部用统一 ttlMs ⇒ 全落同一过期 bucket ⇒ 单桶峰值 = 全量（DB 瞬时被打爆）。
 *   - jitter：每片在 [ttl, ttl·(1+jitterRatio)) 内按注入 rand 抖动 ⇒ 摊到多 bucket ⇒ 峰值下降。
 * 读数是「落进各 bucket 的条目数」结构计数，不是墙钟 QPS。
 *
 * @param {object} [opts] { keys?, ttlMs?, jitterRatio?, buckets?, rand?, seed? }
 */
export function compareAvalanche(opts = {}) {
  const count = Math.max(0, Math.floor(Number(opts.keys ?? GUARD_DEFAULTS.keys)))
  const ttlMs = Math.max(0, Number(opts.ttlMs ?? GUARD_DEFAULTS.ttlMs))
  const jitterRatio = Math.max(0, Number(opts.jitterRatio ?? GUARD_DEFAULTS.jitterRatio))
  const buckets = Math.max(1, Math.floor(Number(opts.buckets ?? GUARD_DEFAULTS.buckets)))
  const rand = makeRand(opts)

  if (count === 0) {
    return {
      keys: 0, ttlMs, jitterRatio, buckets,
      uniformPeak: 0, jitterPeak: 0, peakReduction: 0,
      uniformBuckets: 0, jitterBuckets: 0, totalExpirations: 0,
      histogram: { uniform: [], jitter: [] },
    }
  }

  // 每条 TTL：uniform 全等；jitter 在 [ttl, ttl*(1+jitterRatio)) 抖动；换算到 bucket 下标。
  const span = Math.max(1, ttlMs * jitterRatio)
  const uniformHist = new Array(buckets).fill(0)
  const jitterHist = new Array(buckets).fill(0)
  for (let i = 0; i < count; i++) {
    const jitterTtl = ttlMs + rand() * span
    const uBucket = Math.min(buckets - 1, Math.floor((ttlMs / Math.max(1, ttlMs + span)) * buckets))
    const jBucket = Math.min(buckets - 1, Math.floor((jitterTtl / Math.max(1, ttlMs + span)) * buckets))
    uniformHist[uBucket]++
    jitterHist[jBucket]++
  }
  const peak = (h) => h.reduce((m, v) => Math.max(m, v), 0)
  const used = (h) => h.filter((v) => v > 0).length
  const uniformPeak = peak(uniformHist), jitterPeak = peak(jitterHist)

  return {
    keys: count, ttlMs, jitterRatio, buckets,
    uniformPeak, jitterPeak,
    peakReduction: uniformPeak > 0 ? round((uniformPeak - jitterPeak) / uniformPeak, 6) : 0,
    uniformBuckets: used(uniformHist), jitterBuckets: used(jitterHist),
    totalExpirations: count,
    histogram: { uniform: uniformHist.slice(), jitter: jitterHist.slice() },
  }
}

/**
 * 三件汇总成一份纯数据（供 status / 前端）。可注入规模参数与时钟/随机，确定性可测。
 * 未注入 rand 时给击穿 / 雪崩各用不同 seed 的独立 LCG，避免两件共享推进流互相污染。
 *
 * @param {object} [opts] { concurrency?, ttlMs?, beta?, keys?, queryKeys?, presentKeys?,
 *   absentRatio?, rounds?, jitterRatio?, buckets?, now?, rand?, seed?, loader?,
 *   cacheFactory?, bloom?, bloomOpts?, negativeTtlMs?, tombstone? }
 *   `keys` 是规模（穿透造 `keys` 个 q:i、雪崩跑 `keys` 个 key）；`queryKeys` 显式给穿透的 key 列。
 */
export async function cacheGuardStudy(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const seed = opts.seed ?? 1979
  const common = { now, cacheFactory: opts.cacheFactory }
  const stampede = await compareStampede({
    ...common, rand: opts.rand, seed, concurrency: opts.concurrency, ttlMs: opts.ttlMs,
    beta: opts.beta, loader: opts.loader,
  })
  const penetration = comparePenetration({
    ...common, keys: opts.queryKeys, keysCount: opts.keys, presentKeys: opts.presentKeys,
    absentRatio: opts.absentRatio, rounds: opts.rounds, negativeTtlMs: opts.negativeTtlMs,
    tombstone: opts.tombstone, bloom: opts.bloom, bloomOpts: opts.bloomOpts,
  })
  const avalanche = compareAvalanche({
    ...common, rand: opts.rand, seed: seed + 1, // 缺省时与 stampede 用不同流，互不污染
    keys: opts.keys, ttlMs: opts.ttlMs, jitterRatio: opts.jitterRatio, buckets: opts.buckets,
  })
  return { stampede, penetration, avalanche, builtAt: now() }
}

/** 纯数据快照（不夹带函数/Map/缓存实例/Bloom 位数组）。 */
export function guardSnapshot(study) {
  if (!study) return null
  return {
    stampede: { ...study.stampede },
    penetration: { ...study.penetration },
    avalanche: { ...study.avalanche },
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cacheGuardStudy().then((s) => {
    console.log(JSON.stringify({
      stampede: {
        concurrency: s.stampede.concurrency,
        naiveLoads: s.stampede.naiveLoads,
        singleflightLoads: s.stampede.singleflightLoads,
        savedLoads: s.stampede.savedLoads,
        amplification: s.stampede.amplification,
        xfetchEarlyRefreshes: s.stampede.xfetchEarlyRefreshes,
        xfetchAvoidedMisses: s.stampede.xfetchAvoidedMisses,
      },
      penetration: {
        keys: s.penetration.keys, present: s.penetration.present, absent: s.penetration.absent,
        rounds: s.penetration.rounds,
        naiveDbHits: s.penetration.naiveDbHits,
        negativeDbHits: s.penetration.negativeDbHits,
        bloomDbHits: s.penetration.bloomDbHits,
        bloomRejected: s.penetration.bloomRejected,
        bloomFalsePositives: s.penetration.bloomFalsePositives,
        bloomSavedRate: s.penetration.bloomSavedRate,
      },
      avalanche: {
        keys: s.avalanche.keys, buckets: s.avalanche.buckets,
        uniformPeak: s.avalanche.uniformPeak, jitterPeak: s.avalanche.jitterPeak,
        peakReduction: s.avalanche.peakReduction,
        uniformBuckets: s.avalanche.uniformBuckets, jitterBuckets: s.avalanche.jitterBuckets,
      },
    }, null, 2))
    process.exit(0)
  }).catch((e) => { console.error(`[guard] 生成失败：${e.message}`); process.exit(1) })
}
