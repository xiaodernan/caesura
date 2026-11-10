/**
 * scripts/caesura-redis-cache.mjs —— 集大成缓存层（P8 首件，KI-493）。
 *
 * <p>落的是「缓存的合理运用」这件事本身：既有集大成主线把判定/编排/韧性/路由/鉴权做厚，
 * 却从没有一只带**淘汰策略 / 过期 / 并发合并 / 内存预算**的正经缓存。本件用零依赖、可注入、
 * 可确定性测的纯 JS 实现，把数据结构与算法（O(1) LRU / TTL / singleflight）、操作系统
 * （常驻工作集不越预算）、网络（防击穿/惊群）三件事收口在一只缓存里。</p>
 *
 * <p>设计取舍（判定权仍在 Node 侧，决策原则①）：TTL、maxEntries、maxBytes、sizeOf、时钟
 * 全由调用方 opts / 逐条 set 注入；本件只跑状态机与计数，不写任何业务阈值。与真 Redis
 * 无运行时依赖——默认进程内实现，真后端靠注入 `backend` 由 `command()` 适配。</p>
 *
 * <p>LRU 为什么是 Map + 双向链表而不是堆：读路径要 O(1) 命中即移到最新端，堆做不到 O(1)
 * 的「任意 key 提为新」，故刻意用链表；TTL 因此走「惰性 + 定期 O(n) 清扫」双策略，
 * 清扫显式可调度（不藏在前台 get 里摊成本），把复杂度诚实地写在明处。</p>
 *
 * 用法：
 *   const cache = createRedisCache({ maxEntries: 1000, maxBytes: 1<<20, ttlMs: 30_000, now: () => Date.now() })
 *   cache.set('k', { a: 1 })
 *   cache.get('k')                       // → { a: 1 }（命中移到 LRU 头）
 *   await cache.load('k', async () => fetchThing())  // singleflight：并发只回填一次
 *   cache.command('SETEX', 'k', 60, 'v') // RESP 风格命令，默认走进程内
 *   cache.stats()                        // → { hits, misses, evicted, expired, inflight, bytes, entries, hitRate }
 */

/** 统计读数（每次 stats() 现取，命中率由 hits/(hits+misses) 算，零请求时为 0）。 */
// @typedef {{hits:number,misses:number,evicted:number,expired:number,inflight:number,bytes:number,entries:number,hitRate:number}} CacheStats

/**
 * 缺省 sizeOf：按 key + value 的 UTF-16 字节粗估。
 * 字符串按 length*2；对象走一次 JSON 序列化长度*2（教学用途，真实系统应注入更准的估算）。
 * @param {string} key
 * @param {any} value
 * @returns {number}
 */
export function defaultSizeOf(key, value) {
  const k = typeof key === 'string' ? key.length * 2 : String(key).length * 2
  let v = 0
  if (typeof value === 'string') v = value.length * 2
  else if (value === null || value === undefined) v = 0
  else {
    try { v = JSON.stringify(value).length * 2 } catch { v = 64 }
  }
  return k + v + 32 // 32B 近似 entry 元数据开销
}

/**
 * 创建一只缓存。
 * @param {object} [opts]
 * @param {number} [opts.maxEntries=1024] 条目数上限（0=不限）
 * @param {number} [opts.maxBytes=0] 字节预算上限（0=不限；>0 时按 sizeOf 逐出到预算内）
 * @param {number} [opts.ttlMs=0] 默认 TTL 毫秒（0=永不过期；可被 set/load 逐条覆盖）
 * @param {() => number} [opts.now] 时钟注入（缺省 Date.now；测试可注入确定性时钟）
 * @param {(key:string,value:any)=>number} [opts.sizeOf] 单条字节估算（缺省 defaultSizeOf）
 * @param {{command?:(cmd:string,...args:any[])=>any}} [opts.backend] 真 Redis 适配器；给了则 command() 转发过去
 * @returns {object} RedisCache
 */
export function createRedisCache(opts = {}) {
  const maxEntries = Math.max(0, Number(opts.maxEntries ?? 1024))
  const maxBytes = Math.max(0, Number(opts.maxBytes ?? 0))
  const defaultTtlMs = Math.max(0, Number(opts.ttlMs ?? 0))
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const sizeOf = typeof opts.sizeOf === 'function' ? opts.sizeOf : defaultSizeOf
  const backend = opts.backend ?? null

  // LRU 双向链表：tail.prev 是最新（head），head.next 是最旧（tail 端）；用哨兵省去空判。
  // 这里让 newest 永远挂在 head哨兵 之后、oldest 挂在 tail哨兵 之前，逐出取 tail.prev。
  const HEAD = { key: null, prev: null, next: null }
  const TAIL = { key: null, prev: null, next: null }
  HEAD.next = TAIL
  TAIL.prev = HEAD

  /** key -> { key, value, expireAt, bytes, prev, next } */
  const map = new Map()
  /** key -> Promise（singleflight 在途回填） */
  const inflight = new Map()
  const counters = { hits: 0, misses: 0, evicted: 0, expired: 0 }
  let bytes = 0

  function linkNewest(node) {
    node.prev = HEAD
    node.next = HEAD.next
    HEAD.next.prev = node
    HEAD.next = node
  }
  function unlink(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
    node.prev = null
    node.next = null
  }
  function touch(node) {
    unlink(node)
    linkNewest(node)
  }
  function oldest() {
    return TAIL.prev === HEAD ? null : TAIL.prev
  }

  function isExpired(entry, t) {
    return entry.expireAt > 0 && t >= entry.expireAt
  }

  /** 惰性过期：命中一条已过期 entry 就删掉并按 miss 计。 */
  function dropExpired(entry) {
    unlink(entry)
    map.delete(entry.key)
    bytes -= entry.bytes
    counters.expired++
  }

  /** 逐出到条目数与字节预算都达标；返回被逐出的 key 数。 */
  function trim() {
    let n = 0
    while (true) {
      const old = oldest()
      if (!old) break
      const overCount = maxEntries > 0 && map.size > maxEntries
      const overBytes = maxBytes > 0 && bytes > maxBytes
      if (!overCount && !overBytes) break
      unlink(old)
      map.delete(old.key)
      bytes -= old.bytes
      counters.evicted++
      n++
    }
    return n
  }

  /** 读；命中移到 LRU 头。过期按 miss 处理并清除。 */
  function get(key) {
    const t = now()
    const entry = map.get(key)
    if (!entry) { counters.misses++; return undefined }
    if (isExpired(entry, t)) { dropExpired(entry); counters.misses++; return undefined }
    touch(entry)
    counters.hits++
    return entry.value
  }

  /** 只探不移动 LRU、不计命中率（给调试/探针用）。 */
  function peek(key) {
    const t = now()
    const entry = map.get(key)
    if (!entry) return undefined
    if (isExpired(entry, t)) { dropExpired(entry); return undefined }
    return entry.value
  }

  /** 写（存在则更新值/TTL/字节并移到最新端）；写完即按预算逐出。 */
  function set(key, value, ttlMs) {
    const t = now()
    const ttl = ttlMs === undefined ? defaultTtlMs : Math.max(0, Number(ttlMs))
    const expireAt = ttl > 0 ? t + ttl : 0
    const bytesNew = Math.max(0, Number(sizeOf(key, value)) || 0)
    const existing = map.get(key)
    if (existing) {
      bytes -= existing.bytes
      existing.value = value
      existing.expireAt = expireAt
      existing.bytes = bytesNew
      bytes += bytesNew
      touch(existing)
    } else {
      const node = { key, value, expireAt, bytes: bytesNew, prev: null, next: null }
      map.set(key, node)
      linkNewest(node)
      bytes += bytesNew
    }
    trim()
    return true
  }

  function del(key) {
    const entry = map.get(key)
    if (!entry) return false
    unlink(entry)
    map.delete(key)
    bytes -= entry.bytes
    return true
  }

  function has(key) {
    const t = now()
    const entry = map.get(key)
    if (!entry) return false
    if (isExpired(entry, t)) { dropExpired(entry); return false }
    return true
  }

  /**
   * singleflight 回填：miss 时调一次 loader，同 key 并发者共用同一 Promise。
   * loader 抛错 ⇒ 不写缓存、删除在途、把同一错误广播给所有等待者。
   * 回填期间该 key 若被 set/del，loader 结果仍会以 set 覆盖（最后写者赢，教学取舍，写明在案）。
   */
  async function load(key, loader, ttlMs) {
    // 先看在途：并发同 key 直接并进那一次回填，不各记一次 miss（singleflight 的判词就是 loader 只跑一次）。
    if (inflight.has(key)) return inflight.get(key)
    const hit = get(key)
    if (hit !== undefined) return hit
    // 先登记 deferred promise 再跑 loader：否则 loader **同步抛错**时 finally 会先于
    // inflight.set 执行，留一枚已 rejected 的 Promise 永久占住该 key（后续 load 全拿这枚旧拒绝）。
    let resolveP, rejectP
    const p = new Promise((res, rej) => { resolveP = res; rejectP = rej })
    inflight.set(key, p)
    ;(async () => {
      try {
        const value = await loader()
        // 只有 loader 真产出（含 false/0/'' 等值）才写；undefined 视作「没东西可缓存」。
        if (value !== undefined) set(key, value, ttlMs)
        resolveP(value)
      } catch (e) {
        rejectP(e)
      } finally {
        inflight.delete(key)
      }
    })()
    return p
  }

  /** 定期清扫：O(n) 扫全表清掉所有过期 entry，返回清除数（显式可调，不摊进前台 get）。 */
  function evictExpired(at) {
    const t = at === undefined ? now() : Number(at)
    let n = 0
    for (const entry of [...map.values()]) {
      if (isExpired(entry, t)) { dropExpired(entry); n++ }
    }
    return n
  }

  function stats() {
    const total = counters.hits + counters.misses
    return {
      hits: counters.hits,
      misses: counters.misses,
      evicted: counters.evicted,
      expired: counters.expired,
      inflight: inflight.size,
      bytes,
      entries: map.size,
      hitRate: total === 0 ? 0 : counters.hits / total,
    }
  }

  function reset() {
    for (const entry of map.values()) { entry.prev = null; entry.next = null }
    map.clear()
    inflight.clear()
    HEAD.next = TAIL
    TAIL.prev = HEAD
    HEAD.prev = null
    TAIL.next = null
    counters.hits = 0
    counters.misses = 0
    counters.evicted = 0
    counters.expired = 0
    bytes = 0
  }

  /**
   * RESP 风格命令面（Redis 语义的最小教学子集）。给了 backend 就整条转发给真适配器
   * （真 Redis 客户端返回 Promise；本件不 await，交回调用方处理，保持命令面形状一致）。
   * 默认进程内：GET/SET/SETEX/DEL/TTL/INCR/FLUSHDB。
   */
  function command(cmd, ...args) {
    if (backend && typeof backend.command === 'function') return backend.command(cmd, ...args)
    const c = String(cmd).toUpperCase()
    switch (c) {
      case 'GET': {
        const v = get(args[0])
        return v === undefined ? null : v
      }
      case 'SET':
        // Redis SET 默认永不过期；仅当调用方显式给第 3 参（毫秒）才设 TTL。
        set(args[0], args[1], args[2] === undefined ? 0 : Number(args[2]))
        return 'OK'
      case 'SETEX': {
        // SETEX key seconds value —— seconds 转 ms
        set(args[0], args[2], Math.max(0, Number(args[1])) * 1000)
        return 'OK'
      }
      case 'DEL':
        return args.reduce((n, k) => n + (del(k) ? 1 : 0), 0)
      case 'EXISTS':
        return args.reduce((n, k) => n + (has(k) ? 1 : 0), 0)
      case 'TTL': {
        const entry = map.get(args[0])
        if (!entry) return -2
        if (isExpired(entry, now())) return -2
        if (entry.expireAt <= 0) return -1
        return Math.max(0, Math.ceil((entry.expireAt - now()) / 1000))
      }
      case 'INCR': {
        const cur = get(args[0])
        const base = cur === undefined ? 0 : Number(cur)
        if (!Number.isFinite(base)) throw new Error('ERR value is not an integer')
        const next = base + 1
        set(args[0], next)
        return next
      }
      case 'FLUSHDB':
        reset()
        return 'OK'
      default:
        throw new Error(`ERR unknown command '${cmd}'`)
    }
  }

  return {
    get, peek, set, del, has, load, evictExpired, stats, reset, command,
    get maxEntries() { return maxEntries },
    get maxBytes() { return maxBytes },
    get defaultTtlMs() { return defaultTtlMs },
  }
}
