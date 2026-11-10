/**
 * scripts/caesura-sharded-cache.mjs —— 分片缓存客户端 / 扩缩容命中率保留率对照（Node.js 侧，KI-500）。
 *
 * <p>把 KI-493 的进程内缓存（`createRedisCache`：LRU+TTL+singleflight+字节预算）与 KI-499 的一致性
 * 哈希环（`createHashRing`）咬合成一只**分片缓存客户端**，回答分布式缓存最要紧的问题：
 * **节点扩缩容后缓存还剩多少能用**。朴素 `hash(key) mod N` 分片在加一只节点时几乎全部 key 换片、
 * 缓存集体失效（缓存雪崩）；一致性哈希分片理论上只让约 `1/(N+1)` 的条目换片、保住约 `N/(N+1)` 的命中。</p>
 *
 * <p><b>判定权仍 Node 侧（决策原则①）</b>：环、缓存工厂、哈希、虚拟节点数、分片集、时钟一律由
 * 构造/调用方注入；本件不写业务阈值。零依赖、可 headless 确定性测。</p>
 *
 * <p><b>诚实边界（不声称）</b>：①不是真 Redis Cluster / 分布式缓存生产客户端——无真网络、无副本、
 * 无故障转移、无数据搬迁执行、无热点迁移；各片是进程内 `createRedisCache`，`remapOn` 只把换片条目
 * **按失效计数**、不真搬数据（真集群换片要重取/迁移，归后端）。②默认 `shardedCache:false` 不装配，
 * 接进 cloud 也只挂 `status.shardedCache` 读数，不改任何调用路径（KI-493 缓存 / KI-491 灰度语义不动）。
 * ③`retentionRate` 是**条目落点的结构计数比**、不是真实负载下的命中率/墙钟/带宽，缺省参数仅教学值、
 * 真集群须实测调参。④不声称扩缩容零失效——一致性哈希仍有约 `1/(N+1)` 条目换片失效，`retentionRate`
 * 如实给出、不粉饰。⑤`load` 的 singleflight 是**片内**合并，跨片同 key 不会重复（同 key 恒落同片）。</p>
 *
 * 用法：
 *   const cache = createShardedCache({ shards: ['a', 'b', 'c'] })
 *   cache.set('player:42', { hp: 100 })
 *   cache.get('player:42')                       // 恒落同一片
 *   const cmp = compareHitRetention({ shards: ['a','b','c'], nextShards: ['a','b','c','d'], keys })
 *   cmp.consistent.retentionRate > cmp.modulo.retentionRate   // 一致性哈希保住更多缓存
 * </p>
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createHashRing, compareRemapping } from './caesura-consistent-hash.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'

/** 缺省教学参数。 */
export const SHARD_DEFAULTS = Object.freeze({
  virtualNodes: 128,
  salt: 'caesura-shard',
  defaultShards: ['shard-a', 'shard-b', 'shard-c'],
})

function makeModuloLocator(shards, hashFn) {
  const list = shards.slice().sort()
  const h = typeof hashFn === 'function' ? hashFn : (s) => {
    let x = 2166136261
    const str = String(s)
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619) }
    return x >>> 0
  }
  return (key) => list.length === 0 ? null : list[Math.floor((h(String(key)) / 0x100000000) * list.length) % list.length]
}

/**
 * 造一只分片缓存客户端：按一致性哈希环把 key 路由到某片，每片挂一只 Redis 风格缓存。
 * @param {object} [opts] { shards?:string[], ring?:HashRing, cacheFactory?:(id)=>cache,
 *   cacheOpts?:object, virtualNodes?:number, hashFn?, salt?, now? }
 */
export function createShardedCache(opts = {}) {
  const hashFn = opts.hashFn
  const salt = opts.salt ?? SHARD_DEFAULTS.salt
  const virtualNodes = opts.virtualNodes ?? SHARD_DEFAULTS.virtualNodes
  const cacheFactory = typeof opts.cacheFactory === 'function'
    ? opts.cacheFactory
    // 外层注入的 now 必须透传进每片 createRedisCache，否则 TTL/惰性过期用的是真 Date.now，注入确定性失效。
    : () => createRedisCache({ ...(opts.now ? { now: opts.now } : {}), ...(opts.cacheOpts ?? {}) })
  let shards = (Array.isArray(opts.shards) && opts.shards.length ? opts.shards : SHARD_DEFAULTS.defaultShards).map(String)
  let ring = opts.ring && typeof opts.ring.lookup === 'function'
    ? opts.ring
    : createHashRing({ nodes: shards, virtualNodes, hashFn, salt })
  /** shardId -> cache 实例（一片一只 LRU+TTL+singleflight）。 */
  let caches = new Map()
  for (const id of shards) caches.set(id, cacheFactory(id))
  // 失效记账：remapOn 时换片/被移除的条目数（不真搬数据）。
  const invalidation = { remaps: 0, keysInvalidated: 0, keysRetained: 0, added: [], removed: [] }

  function shardOf(key) { return ring.lookup(String(key == null ? '' : key)).nodeId }
  function cacheFor(key) {
    const id = shardOf(key)
    return id === null ? null : caches.get(id) ?? null
  }

  function get(key) { const c = cacheFor(key); return c ? c.get(key) : undefined }
  function peek(key) { const c = cacheFor(key); return c ? c.peek(key) : undefined }
  function set(key, value, ttlMs) {
    const c = cacheFor(key)
    if (!c) return false
    c.set(key, value, ttlMs)
    return true
  }
  function del(key) { const c = cacheFor(key); return c ? c.del(key) : false }
  function has(key) { const c = cacheFor(key); return c ? c.has(key) : false }
  /** 片内 singleflight 回填；空环回 undefined（不编造 loader 结果）。 */
  async function load(key, loader, ttlMs) {
    const c = cacheFor(key)
    if (!c) return undefined
    return c.load(key, loader, ttlMs)
  }
  function evictExpired(at) {
    let n = 0
    for (const c of caches.values()) n += (c.evictExpired ? c.evictExpired(at) : 0)
    return n
  }

  /** 逐片 + 汇总 stats；各片读数是真 createRedisCache.stats() 之和。 */
  function stats() {
    const perShard = {}
    let hits = 0, misses = 0, entries = 0, evicted = 0, expired = 0, bytes = 0, inflight = 0
    for (const id of shards.slice().sort()) {
      const s = caches.get(id)?.stats() ?? { hits: 0, misses: 0, entries: 0, evicted: 0, expired: 0, bytes: 0, inflight: 0 }
      perShard[id] = { hits: s.hits, misses: s.misses, entries: s.entries, hitRate: s.hitRate ?? 0 }
      hits += s.hits; misses += s.misses; entries += s.entries
      evicted += s.evicted ?? 0; expired += s.expired ?? 0; bytes += s.bytes ?? 0; inflight += s.inflight ?? 0
    }
    const total = hits + misses
    return { shards: shards.length, hits, misses, entries, evicted, expired, bytes, inflight,
      hitRate: total === 0 ? 0 : hits / total, perShard, invalidation: { ...invalidation } }
  }

  /**
   * 重绑到新的分片集：新片建空缓存，被移除片丢弃；逐 key 复查落点，**只保留落点未变的片内条目**，
   * 换片的条目按失效计（不真搬数据）。`trackedKeys` 是预热/访问过的键，缺省由调用方传入或已 load 的键集合。
   * 为不重复持有全量 key，这里只对调用方显式给出的 keys 做失效/保留计数；缓存实例本身不逐条搬迁。
   */
  function remapOn(nextShards, keys = []) {
    const before = new Map()
    for (const k of keys) before.set(String(k), shardOf(k))
    const oldShardSet = new Set(shards) // 重绑前记下旧片集合，added/removed 要对「片」比、不是对 key 比
    const next = (Array.isArray(nextShards) && nextShards.length ? nextShards : shards).map(String)
    const nextSet = new Set(next)
    const nextRing = createHashRing({ nodes: next, virtualNodes, hashFn, salt })
    const nextCaches = new Map()
    for (const id of next) nextCaches.set(id, caches.has(id) ? caches.get(id) : cacheFactory(id))
    let retained = 0, invalidated = 0
    for (const [k, oldId] of before) {
      const newId = nextRing.lookup(k).nodeId
      if (newId !== null && newId === oldId) retained++
      else invalidated++
    }
    shards = next
    ring = nextRing
    caches = nextCaches
    invalidation.remaps++
    invalidation.keysRetained += retained
    invalidation.keysInvalidated += invalidated
    invalidation.added = next.filter((id) => !oldShardSet.has(id))
    invalidation.removed = [...oldShardSet].filter((id) => !nextSet.has(id))
    return { retained, invalidated, total: keys.length,
      retentionRate: keys.length === 0 ? 0 : retained / keys.length,
      shards: next.slice().sort() }
  }

  function reset() {
    for (const c of caches.values()) c.reset?.()
    invalidation.remaps = 0; invalidation.keysInvalidated = 0; invalidation.keysRetained = 0
    invalidation.added = []; invalidation.removed = []
  }

  /** 纯数据快照（不含函数/Map）；`ring:false` 省去环点明细供 status 轮询。 */
  function snapshot(opts2 = {}) {
    const perShard = {}
    for (const id of shards.slice().sort()) {
      const s = caches.get(id)?.stats() ?? {}
      perShard[id] = { entries: s.entries ?? 0, hits: s.hits ?? 0, misses: s.misses ?? 0 }
    }
    return { shards: shards.slice().sort(), virtualNodes, salt,
      ring: ring.snapshot ? ring.snapshot({ ring: false }) : null,
      perShard, invalidation: { ...invalidation },
      ...(opts2.ring ? { ringPoints: ring.snapshot ? ring.snapshot().ring : [] } : {}) }
  }

  return { shardOf, get, peek, set, del, has, load, evictExpired, stats, remapOn, reset, snapshot,
    get shards() { return shards.slice() }, salt, virtualNodes }
}

/**
 * 扩缩容命中率保留率对照：一致性哈希分片 vs 朴素取模分片，谁在扩缩容后保住更多缓存条目。
 * 与 KI-499 `compareRemapping` 互为镜像：那边数「迁移了多少 key」，这边数「多少缓存条目仍有效」。
 * @param {object} [opts] { shards?:string[], nextShards?:string[], keys?:any[], strategy?,
 *   virtualNodes?, hashFn?, salt? }
 */
export function compareHitRetention(opts = {}) {
  const shards = (Array.isArray(opts.shards) ? opts.shards : SHARD_DEFAULTS.defaultShards).map(String)
  const next = (Array.isArray(opts.nextShards) ? opts.nextShards : [...shards, 'shard:new']).map(String)
  const keys = Array.isArray(opts.keys) ? opts.keys : []
  const hashFn = opts.hashFn
  const salt = opts.salt ?? SHARD_DEFAULTS.salt
  const virtualNodes = opts.virtualNodes ?? SHARD_DEFAULTS.virtualNodes

  function locator(set, strategy) {
    if (strategy === 'modulo') return makeModuloLocator(set, hashFn)
    const r = createHashRing({ nodes: set, virtualNodes, hashFn, salt })
    return (key) => r.lookup(key).nodeId
  }

  function side(strategy) {
    const before = locator(shards, strategy)
    const after = locator(next, strategy)
    let retained = 0
    for (const k of keys) {
      const key = String(k == null ? '' : k)
      if (before(key) !== null && before(key) === after(key)) retained++
    }
    const moved = keys.length - retained
    return { strategy, shardsBefore: shards.length, shardsAfter: next.length,
      delta: next.length - shards.length, keys: keys.length,
      retained, moved, retentionRate: keys.length === 0 ? 0 : Math.round((retained / keys.length) * 1e6) / 1e6 }
  }

  const consistent = side('consistent')
  const modulo = side('modulo')
  // 理论保留率：一致性哈希约 N/max(N,M)；取模在 N→M 且 gcd 小时约 1/M（每 key 落点碰巧相同的概率）。
  const N = shards.length, M = next.length
  const theoreticalConsistent = Math.max(N, M) > 0 ? Math.round((Math.min(N, M) / Math.max(N, M)) * 1e6) / 1e6 : 0
  return {
    shards, nextShards: next, keys: keys.length,
    consistent, modulo,
    savedRate: Math.round((consistent.retentionRate - modulo.retentionRate) * 1e6) / 1e6,
    theoreticalConsistent,
  }
}

/** CLI：直接运行打印「扩缩容命中率保留率：一致性哈希 vs 取模」证据；被 import 时只交出函数。 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = 10000
  const shards = ['cache-a', 'cache-b', 'cache-c']
  const keys = Array.from({ length: count }, (_, i) => `key:${i}`)
  const grow = compareHitRetention({ shards, nextShards: [...shards, 'cache-d'], keys })
  const shrink = compareHitRetention({ shards, nextShards: shards.slice(0, 2), keys })

  // 真分片缓存：预热 ⇒ 逐片 stats 有条目；remapOn 报失效/保留计数（不真搬数据）。
  // maxEntries 放大到能装下全部预热 key，让 beforeEntries 与 remap 的 1 万 key 口径一致（否则 LRU 逐出会让二者对不上）。
  const cache = createShardedCache({ shards, cacheOpts: { maxEntries: count } })
  for (const k of keys) cache.set(k, k)
  const before = cache.stats()
  const remap = cache.remapOn([...shards, 'cache-d'], keys)
  const after = cache.stats()

  console.log(JSON.stringify({
    shards, keys: count, virtualNodes: SHARD_DEFAULTS.virtualNodes,
    grow: { delta: grow.consistent.delta, consistentRetention: grow.consistent.retentionRate, moduloRetention: grow.modulo.retentionRate, theoretical: grow.theoreticalConsistent, savedRate: grow.savedRate },
    shrink: { delta: shrink.consistent.delta, consistentRetention: shrink.consistent.retentionRate, moduloRetention: shrink.modulo.retentionRate, theoretical: shrink.theoreticalConsistent, savedRate: shrink.savedRate },
    liveCache: { beforeEntries: before.entries, perShardBefore: Object.fromEntries(Object.entries(before.perShard).map(([id, s]) => [id, s.entries])), remap: { retained: remap.retained, invalidated: remap.invalidated, retentionRate: Math.round(remap.retentionRate * 1e6) / 1e6 }, afterShards: after.shards },
  }, null, 2))
  process.exit(0)
}
