/**
 * scripts/caesura-rate-limiter.mjs —— 网关限流算法族 + Redis 原子令牌桶（P8 第十件，KI-502）。
 *
 * <p><b>病</b>：家族已有 `spring-gateway-filter-handlers.RateLimit`（KI-486）——一只进程内令牌桶
 * handler，能跑、却不是「可对照的教学件」：讲不出①固定窗口的**边界突发**（自然分钟翻边处能放近 2×
 * 配额）、②滑动窗口日志的**精确但 O(n) 内存** vs 滑动窗口计数的 **O(1) 近似**、③令牌桶的**受控突发**
 * （capacity 攒桶、refill 补充）vs 漏桶的**恒定速率整形**（水位匀速漏、满则拒）这组限流核心权衡；
 * 更缺 Spring Cloud Gateway 生产真用的 `RedisRateLimiter` 内核——Redis + Lua 把「读 tokens/lastMs →
 * 按注入时钟补充 → 判定扣减 → 写回」做成一次**不被打断的原子调用**、跨实例共享同一桶，而客户端
 * 先 GET 再 SET 的非原子写法在并发下会**超发**（丢失更新）。</p>
 *
 * <p><b>落点</b>：五只进程内算法 + 一只 Redis 风格令牌桶，零依赖、可注入时钟/轨迹/backend/让出点、
 * 确定性可测，判定/阈值全 opts 注入（决策原则①，判定权 Node 侧）：</p>
 * <ul>
 *   <li><b>createFixedWindow</b> —— 按墙钟整窗对齐（<code>floor(t/windowMs)</code>）计数、翻边归零；
 *       整窗对齐是暴露边界突发的前提（按首请求对齐则数学上测不出 2× 放大）；</li>
 *   <li><b>createSlidingLog</b> —— 存每次请求时间戳、判定前裁掉窗外旧戳，精确，size 暴露 O(n) 内存；</li>
 *   <li><b>createSlidingCounter</b> —— 前窗计数按重叠比例加权 + 当前窗计数，O(1) 内存、近似；</li>
 *   <li><b>createTokenBucket</b> —— 攒桶 + 按注入时钟 refill，允许至多 capacity 的受控突发；</li>
 *   <li><b>createLeakyBucket</b> —— 水位按恒定速率漏、满则拒，输出恒定速率整形；</li>
 *   <li><b>createRedisTokenBucket</b> —— 复用 KI-493 <code>createRedisCache.command()</code> 存桶状态，
 *       <code>now</code> 作命令参数传入（对齐 Spring <code>RedisRateLimiter</code> 把时间戳交给 Lua、
 *       不用 Redis 服务器时钟）：<code>atomic:true</code>（默认）读-补-判-写一条**无 await 的同步**操作，
 *       在 JS 单线程内不被打断，等价 Redis Lua 脚本的串行原子；<code>atomic:false</code> 在读与写之间
 *       <code>await yield()</code> 让出事件循环，N 并发都读到同一旧 state ⇒ 复现 GET-SET 竞态超发；
 *       两实例共享同 backend + 同 key 即跨实例共享（真后端注入带 EVAL 的实现即真原子）；</li>
 *   <li><b>compareRateAlgorithms</b> —— 喂同一条「窗口翻边突发」轨迹，逐算法统计 allowed/rejected、
 *       任意 windowMs 内最大放行数与 burstRatio，钉死「只有固定窗口放大近 2×、其余压在 ≈1」；</li>
 *   <li><b>compareRedisAtomicity</b> —— 同 backend 上 N 并发分别跑原子/非原子路径，报放行数与超发量；</li>
 *   <li><b>rateLimiterStudy / rlSnapshot</b> —— 汇总成可 JSON 序列化的纯数据、供前端与 status 读取。</li>
 * </ul>
 *
 * <p><b>不声称</b>：不声称接了真 Redis / 真 EVAL（默认进程内 KI-493 缓存模拟，真后端靠注入
 * <code>backend</code>，且本件约定 backend.command 同步返回、不 await 其 Promise）；不声称「同步原子」
 * 是跨进程真原子（它只在单 JS 线程内等价 Lua 串行，跨进程原子性由注入的真后端保证）；不声称五只算法
 * 参数适配真实生产流量（全结构计数、注入时钟/轨迹、非墙钟 QPS/带宽/延迟，缺省仅教学值须实测调参）；
 * 不声称替代 KI-486 RateLimit handler（两者互补、本件不改动既有 handler 与调用路径）；不声称漏桶真排队
 * （超限即拒、不建模等待队列）；不声称滑动计数无偏差（它就是 O(1) 换来的近似，偏差在单测里显式量出）。</p>
 *
 * 用法：
 *   const fw = createFixedWindow({ limit: 8, windowMs: 1000, now: () => t })
 *   fw.allow()                                  // → { allowed, remaining, retryAfterMs, strategy }
 *   const cmp = compareRateAlgorithms({})       // 五算法同一突发轨迹对照
 *   const study = await rateLimiterStudy({})    // 算法族 + Redis 原子性汇总
 *   npm run ratelimit:bench                     // CLI 打印确定性结构读数
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRedisCache } from './caesura-redis-cache.mjs'

/** 缺省教学参数（判定阈值仍由调用方注入，本表只给可复现的缺省值）。 */
export const RLIMIT_DEFAULTS = Object.freeze({
  limit: 8,
  windowMs: 1000,
  capacity: 8,
  refillPerSec: 8,
  leakPerSec: 8,
  concurrency: 64,
  redisCapacity: 8,
  redisRefillPerSec: 0, // 原子性对照固定时钟、不补充，隔离出「超发」这一变量
})

/** 有限数保留 4 位；Infinity/NaN/非数落 null（绝不把假数写进快照）。 */
function round4(x) {
  return Number.isFinite(x) ? Number(Number(x).toFixed(4)) : null
}
function clockOf(opts) {
  return typeof opts?.now === 'function' ? opts.now : () => Date.now()
}

/* ============================ ① 固定窗口 ============================ */

/**
 * 固定窗口计数：按**墙钟整窗** `floor(t/windowMs)` 对齐——这是暴露边界突发的关键（若按首个请求
 * 时刻对齐，前后两批必然相隔 >= windowMs，滑窗统计反而测不出 2× 放大）。
 * @param {object} [opts] { limit?, windowMs?, now? }
 */
export function createFixedWindow(opts = {}) {
  const limit = Math.max(1, Number(opts.limit ?? RLIMIT_DEFAULTS.limit))
  const windowMs = Math.max(1, Number(opts.windowMs ?? RLIMIT_DEFAULTS.windowMs))
  const now = clockOf(opts)
  let windowStart = null
  let count = 0

  function allow(cost = 1) {
    const t = now()
    const c = Math.max(1, Number(cost))
    const ws = Math.floor(t / windowMs) * windowMs
    if (windowStart === null) windowStart = ws
    if (ws > windowStart) { windowStart = ws; count = 0 } // 翻边归零
    const used = count + c
    if (used <= limit) {
      count = used
      return { allowed: true, remaining: limit - count, retryAfterMs: 0, strategy: 'fixedWindow', windowStart, count }
    }
    return { allowed: false, remaining: Math.max(0, limit - count), retryAfterMs: windowStart + windowMs - t, strategy: 'fixedWindow', windowStart, count }
  }
  function state() {
    const t = now()
    const ws = windowStart === null ? Math.floor(t / windowMs) * windowMs : windowStart
    const current = ws + windowMs > t ? count : 0
    return { strategy: 'fixedWindow', limit, windowMs, windowStart: ws, count: current, remaining: Math.max(0, limit - current) }
  }
  function reset() { windowStart = null; count = 0 }
  return { allow, state, reset }
}

/* ============================ ② 滑动窗口日志 ============================ */

/**
 * 滑动窗口日志：存每次请求时间戳、判定前裁掉 `<= t-windowMs` 的旧戳。精确，但内存随窗口内请求数
 * 线性增长（size 读数即 O(n) 证据），换来零近似偏差。
 * @param {object} [opts] { limit?, windowMs?, now? }
 */
export function createSlidingLog(opts = {}) {
  const limit = Math.max(1, Number(opts.limit ?? RLIMIT_DEFAULTS.limit))
  const windowMs = Math.max(1, Number(opts.windowMs ?? RLIMIT_DEFAULTS.windowMs))
  const now = clockOf(opts)
  /** @type {number[]} */
  const hits = []

  function trim(t) {
    const cutoff = t - windowMs
    let d = 0
    while (d < hits.length && hits[d] <= cutoff) d++
    if (d > 0) hits.splice(0, d)
  }
  function allow(cost = 1) {
    const t = now()
    const c = Math.max(1, Number(cost))
    trim(t)
    if (hits.length + c <= limit) {
      for (let i = 0; i < c; i++) hits.push(t)
      return { allowed: true, remaining: limit - hits.length, retryAfterMs: 0, strategy: 'slidingLog', size: hits.length }
    }
    const retry = hits.length > 0 ? Math.max(0, hits[0] + windowMs - t) : 0
    return { allowed: false, remaining: Math.max(0, limit - hits.length), retryAfterMs: retry, strategy: 'slidingLog', size: hits.length }
  }
  function state() {
    const t = now()
    trim(t)
    return { strategy: 'slidingLog', limit, windowMs, size: hits.length, remaining: Math.max(0, limit - hits.length), memory: 'O(n)' }
  }
  function reset() { hits.length = 0 }
  return { allow, state, reset }
}

/* ============================ ③ 滑动窗口计数 ============================ */

/**
 * 滑动窗口计数：前一窗口计数 × 重叠权重 + 当前窗口计数做估算，O(1) 内存（只存两个计数器），
 * 换来「窗口边界附近可能高估/低估」的近似误差——偏差在单测里显式量出，不粉饰成精确。
 * @param {object} [opts] { limit?, windowMs?, now? }
 */
export function createSlidingCounter(opts = {}) {
  const limit = Math.max(1, Number(opts.limit ?? RLIMIT_DEFAULTS.limit))
  const windowMs = Math.max(1, Number(opts.windowMs ?? RLIMIT_DEFAULTS.windowMs))
  const now = clockOf(opts)
  let windowStart = null
  let prevCount = 0
  let currCount = 0

  function roll(t) {
    if (windowStart === null) { windowStart = Math.floor(t / windowMs) * windowMs; return }
    if (t - windowStart >= windowMs) {
      const elapsed = Math.floor((t - windowStart) / windowMs)
      prevCount = elapsed === 1 ? currCount : 0 // 跨 >1 窗则前窗已完全滑出
      currCount = 0
      windowStart += elapsed * windowMs
    }
  }
  function estimate(t) {
    if (windowStart === null) return 0
    const overlap = 1 - (t - windowStart) / windowMs // 前窗残留权重
    return prevCount * Math.max(0, Math.min(1, overlap)) + currCount
  }
  function allow(cost = 1) {
    const t = now()
    const c = Math.max(1, Number(cost))
    roll(t)
    const est = estimate(t)
    if (est + c <= limit) {
      currCount += c
      return { allowed: true, remaining: Math.max(0, limit - est - c), retryAfterMs: 0, strategy: 'slidingCounter', estimate: round4(est + c), prevCount, currCount }
    }
    return { allowed: false, remaining: Math.max(0, limit - est), retryAfterMs: Math.max(0, windowStart === null ? 0 : windowStart + windowMs - t), strategy: 'slidingCounter', estimate: round4(est), prevCount, currCount }
  }
  function state() {
    const t = now()
    roll(t)
    return { strategy: 'slidingCounter', limit, windowMs, prevCount, currCount, windowStart, estimate: round4(estimate(t)), memory: 'O(1)' }
  }
  function reset() { windowStart = null; prevCount = 0; currCount = 0 }
  return { allow, state, reset }
}

/* ============================ ④ 令牌桶 ============================ */

/**
 * 令牌桶：桶里攒 tokens、按注入时钟以 refillPerSec 补充、上限 capacity；允许至多 capacity 的受控
 * 突发（瞬时放空桶），持续速率受 refillPerSec 限制。
 * @param {object} [opts] { capacity?, refillPerSec?, now? }
 */
export function createTokenBucket(opts = {}) {
  const capacity = Math.max(1, Number(opts.capacity ?? RLIMIT_DEFAULTS.capacity))
  const refillPerSec = Math.max(0, Number(opts.refillPerSec ?? RLIMIT_DEFAULTS.refillPerSec))
  const now = clockOf(opts)
  let tokens = capacity
  let lastMs = now()

  function allow(cost = 1) {
    const t = now()
    const c = Math.max(1, Number(cost))
    const elapsed = Math.max(0, (t - lastMs) / 1000)
    tokens = Math.min(capacity, tokens + elapsed * refillPerSec)
    lastMs = t
    if (tokens >= c) {
      tokens -= c
      return { allowed: true, remaining: round4(tokens), retryAfterMs: 0, strategy: 'tokenBucket', tokens: round4(tokens) }
    }
    const retry = refillPerSec > 0 ? Math.ceil((c - tokens) / refillPerSec * 1000) : null
    return { allowed: false, remaining: round4(tokens), retryAfterMs: retry, strategy: 'tokenBucket', tokens: round4(tokens) }
  }
  function state() {
    const t = now()
    const elapsed = Math.max(0, (t - lastMs) / 1000)
    const live = Math.min(capacity, tokens + elapsed * refillPerSec)
    return { strategy: 'tokenBucket', capacity, refillPerSec, tokens: round4(live), lastMs }
  }
  function reset() { tokens = capacity; lastMs = now() }
  return { allow, state, reset }
}

/* ============================ ⑤ 漏桶 ============================ */

/**
 * 漏桶：水位 level 按恒定 leakPerSec 漏出，请求注入 cost 使水位升，满则拒；无论入流多猛，出流
 * 恒定 ⇒ 整形。不建模等待队列（超限即拒，边界如实写在文件头）。
 * @param {object} [opts] { capacity?, leakPerSec?, now? }
 */
export function createLeakyBucket(opts = {}) {
  const capacity = Math.max(1, Number(opts.capacity ?? RLIMIT_DEFAULTS.capacity))
  const leakPerSec = Math.max(0, Number(opts.leakPerSec ?? RLIMIT_DEFAULTS.leakPerSec))
  const now = clockOf(opts)
  let level = 0
  let lastMs = now()

  function allow(cost = 1) {
    const t = now()
    const c = Math.max(1, Number(cost))
    const elapsed = Math.max(0, (t - lastMs) / 1000)
    level = Math.max(0, level - elapsed * leakPerSec)
    lastMs = t
    if (level + c <= capacity) {
      level += c
      return { allowed: true, remaining: round4(capacity - level), retryAfterMs: 0, strategy: 'leakyBucket', level: round4(level) }
    }
    const retry = leakPerSec > 0 ? Math.ceil((level + c - capacity) / leakPerSec * 1000) : null
    return { allowed: false, remaining: round4(Math.max(0, capacity - level)), retryAfterMs: retry, strategy: 'leakyBucket', level: round4(level) }
  }
  function state() {
    const t = now()
    const elapsed = Math.max(0, (t - lastMs) / 1000)
    const live = Math.max(0, level - elapsed * leakPerSec)
    return { strategy: 'leakyBucket', capacity, leakPerSec, level: round4(live), lastMs }
  }
  function reset() { level = 0; lastMs = now() }
  return { allow, state, reset }
}

/* ============================ ⑥ Redis 原子令牌桶 ============================ */

/**
 * Redis 风格令牌桶：桶状态以 JSON 存在 KI-493 `createRedisCache.command()` 的 GET/SET 面里，
 * `now` 作为命令参数传入（不用后端时钟，对齐 Spring RedisRateLimiter 的 Lua 时间戳做法）。
 *
 * 关键分歧——原子 vs 非原子**只差读写之间有没有让出点**：
 *  - atomic:true：allow 是 async 但体内**零 await**，读-补-判-写在单个同步段内完成，JS 单线程内
 *    不被别的调用打断 ⇒ 等价 Redis Lua 脚本串行执行；N 并发 Promise.all 下恰好放行 capacity 个。
 *  - atomic:false：读旧 state 后 `await yield()` 让出事件循环再写回，N 并发都读到同一满桶、各自
 *    判定放行 ⇒ 丢失更新、放行 N 个（超发）。这就是客户端 GET→SET 非原子写法的真实事故形状。
 *
 * @param {object} [opts] { backend?, key?, capacity?, refillPerSec?, now?, atomic?, yield? }
 */
export function createRedisTokenBucket(opts = {}) {
  const backend = opts.backend ?? createRedisCache({ now: clockOf(opts) })
  const key = String(opts.key ?? 'default')
  const stateKey = `rl:token:${key}`
  const capacity = Math.max(1, Number(opts.capacity ?? RLIMIT_DEFAULTS.redisCapacity))
  const refillPerSec = Math.max(0, Number(opts.refillPerSec ?? RLIMIT_DEFAULTS.redisRefillPerSec))
  const atomic = opts.atomic !== false
  const now = clockOf(opts)
  const yieldFn = typeof opts.yield === 'function' ? opts.yield : () => Promise.resolve()
  const counters = { allowed: 0, rejected: 0 }

  /** 读当前桶状态；无 key 视为满桶（首调用），lastMs 取注入时钟。 */
  function read(t) {
    const raw = backend.command('GET', stateKey)
    if (raw === null || raw === undefined) return { tokens: capacity, lastMs: t }
    try {
      const st = JSON.parse(raw)
      return { tokens: Number.isFinite(st.tokens) ? st.tokens : capacity, lastMs: Number.isFinite(st.lastMs) ? st.lastMs : t }
    } catch { return { tokens: capacity, lastMs: t } }
  }
  function write(st) { backend.command('SET', stateKey, JSON.stringify(st)) }
  /** 纯判定：补 tokens → 够则扣减放行；返回新状态与结果（原子/非原子共用同一判定逻辑）。 */
  function decide(st, cost, t) {
    const elapsed = Math.max(0, (t - st.lastMs) / 1000)
    const tokens = Math.min(capacity, st.tokens + elapsed * refillPerSec)
    const ok = tokens >= cost
    const next = { tokens: ok ? tokens - cost : tokens, lastMs: t }
    const result = {
      allowed: ok,
      remaining: round4(next.tokens),
      retryAfterMs: ok ? 0 : (refillPerSec > 0 ? Math.ceil((cost - tokens) / refillPerSec * 1000) : null),
      strategy: 'redisTokenBucket', key, atomic, tokens: round4(next.tokens),
    }
    return { next, result }
  }

  /**
   * 放行一次。**原子路径体内零 await**（async 仅为了两路返回形状一致、便于 Promise.all 对照）。
   * 真后端注入带 EVAL 的实现时，可把 read→decide→write 换成单条 Lua 命令；本件约定
   * backend.command 同步返回、不 await 其 Promise（真异步 Redis 适配不在本教学件范围）。
   */
  async function allow(cost = 1) {
    const t = now()
    const c = Math.max(1, Number(cost))
    const st = read(t)
    if (atomic) {
      const { next, result } = decide(st, c, t)
      write(next)
      if (result.allowed) counters.allowed++; else counters.rejected++
      return result
    }
    // 非原子：读旧 state 后让出，N 并发的写都基于同一旧值 ⇒ 丢失更新、超发。
    await yieldFn()
    const { next, result } = decide(st, c, t)
    write(next)
    if (result.allowed) counters.allowed++; else counters.rejected++
    return result
  }
  function state() {
    const t = now()
    const st = read(t)
    return { strategy: 'redisTokenBucket', key, capacity, refillPerSec, atomic, tokens: round4(st.tokens), lastMs: st.lastMs, ...counters }
  }
  function reset() { backend.command('DEL', stateKey); counters.allowed = 0; counters.rejected = 0 }
  return { allow, state, reset, get key() { return key }, get atomic() { return atomic } }
}

/* ============================ ⑦ 突发轨迹对照 ============================ */

/** 任意 windowMs 滑动窗口内「最多放行几条」——双指针，时刻差 < windowMs 才算同窗。 */
function maxInWindow(times, windowMs) {
  if (!times.length) return 0
  const ts = [...times].sort((a, b) => a - b)
  let best = 1
  let j = 0
  for (let i = 0; i < ts.length; i++) {
    if (j < i) j = i
    while (j + 1 < ts.length && ts[j + 1] - ts[i] < windowMs) j++
    best = Math.max(best, j - i + 1)
  }
  return best
}

/**
 * 默认突发轨迹：窗口翻边前后各放满一批，再隔一个整窗放一批。让固定窗口（墙钟对齐）在
 * `t=windowMs-1` 与 `t=windowMs` 两批都放行 ⇒ 1ms 内 2× 配额；滑动类/令牌/漏桶都压在 ≈1 批。
 * @param {number} limit 单窗配额
 * @param {number} windowMs 窗长
 */
export function defaultBurstArrivals(limit, windowMs) {
  const a = []
  for (let i = 0; i < limit; i++) a.push(windowMs - 1) // 窗口 0 末尾放满
  for (let i = 0; i < limit; i++) a.push(windowMs)      // 窗口 1 开头再放满（翻边突发）
  for (let i = 0; i < limit; i++) a.push(2 * windowMs)  // 隔整窗再来一批
  return a
}

/**
 * 五算法喂**同一条**突发轨迹对照。逐条请求把注入时钟推进到对应到达时刻，记录放行时刻，
 * 报 allowed/rejected、任意 windowMs 内最大放行数、burstRatio（相对 limit）。
 * @param {object} [opts] { limit?, windowMs?, arrivals?, capacity?, refillPerSec?, leakPerSec? }
 */
export function compareRateAlgorithms(opts = {}) {
  const limit = Math.max(1, Number(opts.limit ?? RLIMIT_DEFAULTS.limit))
  const windowMs = Math.max(1, Number(opts.windowMs ?? RLIMIT_DEFAULTS.windowMs))
  const capacity = Math.max(1, Number(opts.capacity ?? limit))
  const refillPerSec = Math.max(0, Number(opts.refillPerSec ?? RLIMIT_DEFAULTS.refillPerSec))
  const leakPerSec = Math.max(0, Number(opts.leakPerSec ?? RLIMIT_DEFAULTS.leakPerSec))
  const arrivals = Array.isArray(opts.arrivals) && opts.arrivals.length
    ? opts.arrivals.map(Number).filter(Number.isFinite)
    : defaultBurstArrivals(limit, windowMs)

  /**
   * 用时钟游标把一条轨迹喂给某只算法：每趟请求前把游标推到该到达时刻，算法内 `now()` 读到的
   * 就是真实到达时刻（**不能写死常量时钟**，否则固定窗口永不翻边、边界突发测不出来）。
   * @param {(now:()=>number)=>{allow:Function,state:Function}} makeAlgo 注入游标时钟的算法工厂
   */
  function run(makeAlgo) {
    let cursor = 0
    const algo = makeAlgo(() => cursor)
    const allowedAt = []
    let allowed = 0
    let rejected = 0
    for (const t of arrivals) {
      cursor = t
      const r = algo.allow()
      if (r.allowed) { allowed++; allowedAt.push(t) } else rejected++
    }
    const maxWindow = maxInWindow(allowedAt, windowMs)
    return { allowed, rejected, maxInWindow: maxWindow, burstRatio: round4(maxWindow / limit), state: algo.state() }
  }

  const strategies = {
    fixedWindow: run((now) => createFixedWindow({ limit, windowMs, now })),
    slidingLog: run((now) => createSlidingLog({ limit, windowMs, now })),
    slidingCounter: run((now) => createSlidingCounter({ limit, windowMs, now })),
    tokenBucket: run((now) => createTokenBucket({ capacity, refillPerSec, now })),
    leakyBucket: run((now) => createLeakyBucket({ capacity, leakPerSec, now })),
  }
  const verdict = {
    // 只有固定窗口被墙钟翻边放大到 >1.5×；其余四只把任意窗内放行压在 ≈1 批。
    fixedWindowBurst: strategies.fixedWindow.burstRatio > 1.5,
    slidingBounded: strategies.slidingLog.burstRatio <= 1.1 && strategies.slidingCounter.burstRatio <= 1.1,
    tokenControlled: strategies.tokenBucket.maxInWindow <= limit,
    leakySteady: strategies.leakyBucket.maxInWindow <= limit,
    counterIsO1: strategies.slidingCounter.state.memory === 'O(1)' && strategies.slidingLog.state.memory === 'O(n)',
  }
  return { limit, windowMs, capacity, refillPerSec, leakPerSec, arrivals: arrivals.length, strategies, verdict }
}

/* ============================ ⑧ Redis 原子性对照 ============================ */

/**
 * 同 backend 上 N 并发分别跑原子 / 非原子令牌桶，隔离出「读改写之间有没有让出点」这一个变量。
 * 固定时钟（默认 `() => 0`）+ refillPerSec=0 ⇒ 时间不补充，超发完全归因于竞态而非补充。
 * @param {object} [opts] { backend?, concurrency?, capacity?, refillPerSec?, now?, yield? }
 */
export async function compareRedisAtomicity(opts = {}) {
  const concurrency = Math.max(2, Number(opts.concurrency ?? RLIMIT_DEFAULTS.concurrency))
  const capacity = Math.max(1, Number(opts.capacity ?? RLIMIT_DEFAULTS.redisCapacity))
  const refillPerSec = Math.max(0, Number(opts.refillPerSec ?? RLIMIT_DEFAULTS.redisRefillPerSec))
  const now = typeof opts.now === 'function' ? opts.now : () => 0
  const backend = opts.backend ?? createRedisCache({ now })
  const yld = typeof opts.yield === 'function' ? opts.yield : () => Promise.resolve()

  // 两路用不同 key、各自 reset，互不污染；共享同一 backend 证「状态存储同源」。
  const atomicBucket = createRedisTokenBucket({ backend, key: 'atomic:probe', capacity, refillPerSec, now, atomic: true, yield: yld })
  atomicBucket.reset()
  const nonAtomicBucket = createRedisTokenBucket({ backend, key: 'nonatomic:probe', capacity, refillPerSec, now, atomic: false, yield: yld })
  nonAtomicBucket.reset()

  const atomicResults = await Promise.all(Array.from({ length: concurrency }, () => atomicBucket.allow()))
  const nonAtomicResults = await Promise.all(Array.from({ length: concurrency }, () => nonAtomicBucket.allow()))
  const atomicAllowed = atomicResults.filter((r) => r.allowed).length
  const nonAtomicAllowed = nonAtomicResults.filter((r) => r.allowed).length

  // 跨实例共享：A/B 挂同一 backend + 同 key，A 扣减后 B 立刻看到剩余（真 Redis Cluster 分片前的共享语义）。
  const sharedKey = 'shared:probe'
  const a = createRedisTokenBucket({ backend, key: sharedKey, capacity, refillPerSec, now, atomic: true })
  const b = createRedisTokenBucket({ backend, key: sharedKey, capacity, refillPerSec, now, atomic: true })
  a.reset()
  for (let i = 0; i < 3; i++) await a.allow()
  const aRemaining = a.state().tokens
  const bSeenRemaining = b.state().tokens

  return {
    concurrency, capacity, refillPerSec,
    atomicAllowed, nonAtomicAllowed,
    overshoot: nonAtomicAllowed - atomicAllowed,
    atomicBounded: atomicAllowed <= capacity,
    nonAtomicOverran: nonAtomicAllowed > capacity,
    shared: { key: sharedKey, aRemaining, bSeenRemaining, consistent: aRemaining === bSeenRemaining },
  }
}

/* ============================ ⑨ 汇总 + 纯数据快照 ============================ */

/**
 * 汇总「五算法突发对照 + Redis 原子性对照」成一份纯数据 study。缺省固定时钟 ⇒ CLI 确定性。
 * @param {object} [opts] { now?, limit?, windowMs?, arrivals?, capacity?, refillPerSec?, leakPerSec?,
 *   concurrency?, redisCapacity?, redisRefillPerSec?, backend?, yield? }
 */
export async function rateLimiterStudy(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => 0
  const limit = Math.max(1, Number(opts.limit ?? RLIMIT_DEFAULTS.limit))
  const windowMs = Math.max(1, Number(opts.windowMs ?? RLIMIT_DEFAULTS.windowMs))
  const capacity = Math.max(1, Number(opts.capacity ?? limit))
  const refillPerSec = Math.max(0, Number(opts.refillPerSec ?? RLIMIT_DEFAULTS.refillPerSec))
  const leakPerSec = Math.max(0, Number(opts.leakPerSec ?? RLIMIT_DEFAULTS.leakPerSec))
  const algorithms = compareRateAlgorithms({ limit, windowMs, capacity, refillPerSec, leakPerSec, arrivals: opts.arrivals })
  const redis = await compareRedisAtomicity({
    now,
    backend: opts.backend,
    yield: opts.yield,
    concurrency: opts.concurrency ?? RLIMIT_DEFAULTS.concurrency,
    capacity: opts.redisCapacity ?? RLIMIT_DEFAULTS.redisCapacity,
    refillPerSec: opts.redisRefillPerSec ?? RLIMIT_DEFAULTS.redisRefillPerSec,
  })
  return { algorithms, redis, builtAt: now() }
}

/** 把 study 收敛成前端友好的纯数据快照（round 浮点、剥掉 state 里的实现细节）。 */
export function rlSnapshot(study) {
  const a = study.algorithms
  const pick = (s) => ({ allowed: s.allowed, rejected: s.rejected, maxInWindow: s.maxInWindow, burstRatio: s.burstRatio, memory: s.state.memory ?? null })
  const r = study.redis
  return {
    limit: a.limit, windowMs: a.windowMs, arrivals: a.arrivals,
    strategies: {
      fixedWindow: pick(a.strategies.fixedWindow),
      slidingLog: pick(a.strategies.slidingLog),
      slidingCounter: pick(a.strategies.slidingCounter),
      tokenBucket: pick(a.strategies.tokenBucket),
      leakyBucket: pick(a.strategies.leakyBucket),
    },
    verdict: { ...a.verdict },
    redis: {
      concurrency: r.concurrency, capacity: r.capacity,
      atomicAllowed: r.atomicAllowed, nonAtomicAllowed: r.nonAtomicAllowed, overshoot: r.overshoot,
      atomicBounded: r.atomicBounded, nonAtomicOverran: r.nonAtomicOverran,
      shared: { ...r.shared },
    },
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rateLimiterStudy().then((s) => {
    console.log(JSON.stringify(rlSnapshot(s), null, 2))
    process.exit(0)
  }).catch((e) => { console.error(`[ratelimit] 生成失败：${e.message}`); process.exit(1) })
}
