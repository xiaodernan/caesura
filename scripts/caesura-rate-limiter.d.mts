/** `scripts/caesura-rate-limiter.mjs` 的声明：网关限流算法族 + Redis 原子令牌桶（KI-502）。 */

/** 缺省教学参数（判定阈值仍由调用方注入）。 */
export const RLIMIT_DEFAULTS: Readonly<{
  limit: number
  windowMs: number
  capacity: number
  refillPerSec: number
  leakPerSec: number
  concurrency: number
  redisCapacity: number
  redisRefillPerSec: number
}>

/** 单次放行判定结果（五算法 + Redis 桶共用形状）。 */
export interface AllowResult {
  allowed: boolean
  remaining: number | null
  retryAfterMs: number | null
  strategy: string
  [k: string]: any
}

/** 算法实例统一面：allow 判定、state 纯数据快照、reset 归零。 */
export interface RateAlgo {
  allow(cost?: number): AllowResult
  state(): Record<string, any>
  reset(): void
}

export interface FixedWindowOptions { limit?: number; windowMs?: number; now?: () => number }
export interface SlidingOptions { limit?: number; windowMs?: number; now?: () => number }
export interface TokenBucketOptions { capacity?: number; refillPerSec?: number; now?: () => number }
export interface LeakyBucketOptions { capacity?: number; leakPerSec?: number; now?: () => number }

/** ① 固定窗口：按墙钟整窗对齐计数、翻边归零（整窗对齐是暴露边界突发的前提）。 */
export function createFixedWindow(opts?: FixedWindowOptions): RateAlgo
/** ② 滑动窗口日志：存每次请求戳、裁窗外旧戳，精确 O(n) 内存。 */
export function createSlidingLog(opts?: SlidingOptions): RateAlgo
/** ③ 滑动窗口计数：前窗按重叠权重 + 当前窗计数，O(1) 内存、近似。 */
export function createSlidingCounter(opts?: SlidingOptions): RateAlgo
/** ④ 令牌桶：攒桶 + refill，允许至多 capacity 的受控突发。 */
export function createTokenBucket(opts?: TokenBucketOptions): RateAlgo
/** ⑤ 漏桶：水位匀速漏、满则拒，恒定速率整形（不建模等待队列）。 */
export function createLeakyBucket(opts?: LeakyBucketOptions): RateAlgo

/** 可注入的 Redis 风格后端（KI-493 createRedisCache.command 形状，约定同步返回）。 */
export interface RateLimitBackend {
  command(cmd: string, ...args: any[]): any
}

export interface RedisTokenBucketOptions {
  backend?: RateLimitBackend
  key?: string
  capacity?: number
  refillPerSec?: number
  now?: () => number
  /** true（默认）：读改写一条无 await 的同步段，等价 Redis Lua 串行原子；false：读写间让出，复现 GET-SET 超发。 */
  atomic?: boolean
  /** 注入的非原子让出点（确定性单测可注入 Promise.resolve）。 */
  yield?: () => Promise<any>
}

/**
 * ⑥ Redis 风格令牌桶：桶状态存 backend 的 GET/SET，`now` 作命令参数传入（对齐 Spring
 * RedisRateLimiter 的时间戳交给 Lua）。两实例共享 backend + key 即跨实例共享。
 */
export function createRedisTokenBucket(opts?: RedisTokenBucketOptions): RateAlgo & {
  readonly key: string
  readonly atomic: boolean
}

/** 默认突发轨迹：窗口翻边前后各放满一批、再隔整窗来一批（确定性）。 */
export function defaultBurstArrivals(limit: number, windowMs: number): number[]

export interface StrategyComparison {
  allowed: number
  rejected: number
  /** 任意 windowMs 内最多放行数（双指针滑窗）。 */
  maxInWindow: number
  /** maxInWindow / limit；固定窗口≈2，其余≈1。 */
  burstRatio: number | null
  state: Record<string, any>
}

export interface AlgorithmVerdict {
  fixedWindowBurst: boolean
  slidingBounded: boolean
  tokenControlled: boolean
  leakySteady: boolean
  counterIsO1: boolean
}

export interface CompareRateOptions {
  limit?: number
  windowMs?: number
  arrivals?: number[]
  capacity?: number
  refillPerSec?: number
  leakPerSec?: number
}

export interface RateAlgorithmComparison {
  limit: number
  windowMs: number
  capacity: number
  refillPerSec: number
  leakPerSec: number
  arrivals: number
  strategies: {
    fixedWindow: StrategyComparison
    slidingLog: StrategyComparison
    slidingCounter: StrategyComparison
    tokenBucket: StrategyComparison
    leakyBucket: StrategyComparison
  }
  verdict: AlgorithmVerdict
}

/** ⑦ 五算法喂同一条突发轨迹对照：allowed/rejected/任意窗最大放行/burstRatio + 五句判词。 */
export function compareRateAlgorithms(opts?: CompareRateOptions): RateAlgorithmComparison

export interface CompareRedisOptions {
  backend?: RateLimitBackend
  concurrency?: number
  capacity?: number
  refillPerSec?: number
  now?: () => number
  yield?: () => Promise<any>
}

export interface RedisAtomicityComparison {
  concurrency: number
  capacity: number
  refillPerSec: number
  /** 原子路径放行数（应 == capacity，不超发）。 */
  atomicAllowed: number
  /** 非原子路径放行数（并发全放行、超发）。 */
  nonAtomicAllowed: number
  /** nonAtomicAllowed − atomicAllowed，超发量。 */
  overshoot: number
  atomicBounded: boolean
  nonAtomicOverran: boolean
  /** 跨实例共享同 backend + key 的一致性证据。 */
  shared: { key: string; aRemaining: number | null; bSeenRemaining: number | null; consistent: boolean }
}

/** ⑧ 同 backend 上 N 并发分别跑原子/非原子令牌桶，隔离「读写间是否让出」这一变量 + 跨实例共享。 */
export function compareRedisAtomicity(opts?: CompareRedisOptions): Promise<RedisAtomicityComparison>

/**
 * 汇总选项：算法族用 capacity/refillPerSec/leakPerSec（见 CompareRateOptions），Redis 对照用
 * **独立的** redisCapacity/redisRefillPerSec（隔离「超发」这一个变量，避免与算法族阈值混淆），
 * 故不 extends CompareRedisOptions（它俩的 capacity/refillPerSec 语义与此处不同）。
 */
export interface RateLimiterStudyOptions extends CompareRateOptions {
  now?: () => number
  backend?: RateLimitBackend
  yield?: () => Promise<any>
  /** Redis 桶容量（默认 RLIMIT_DEFAULTS.redisCapacity）。 */
  redisCapacity?: number
  /** Redis 桶补充速率（默认 RLIMIT_DEFAULTS.redisRefillPerSec，固定时钟下为 0）。 */
  redisRefillPerSec?: number
  /** Redis 并发数（默认 RLIMIT_DEFAULTS.concurrency）。 */
  concurrency?: number
}

export interface RateLimiterStudy {
  algorithms: RateAlgorithmComparison
  redis: RedisAtomicityComparison
  builtAt: number
}

/** ⑨ 汇总五算法突发对照 + Redis 原子性对照成一份纯数据 study（缺省固定时钟 ⇒ CLI 确定性）。 */
export function rateLimiterStudy(opts?: RateLimiterStudyOptions): Promise<RateLimiterStudy>

/** ⑩ 把 study 收敛成前端友好的纯数据快照（round 浮点、剥实现细节）。 */
export function rlSnapshot(study: RateLimiterStudy): {
  limit: number
  windowMs: number
  arrivals: number
  strategies: Record<'fixedWindow' | 'slidingLog' | 'slidingCounter' | 'tokenBucket' | 'leakyBucket', {
    allowed: number
    rejected: number
    maxInWindow: number
    burstRatio: number | null
    memory: string | null
  }>
  verdict: AlgorithmVerdict
  redis: {
    concurrency: number
    capacity: number
    atomicAllowed: number
    nonAtomicAllowed: number
    overshoot: number
    atomicBounded: boolean
    nonAtomicOverran: boolean
    shared: { key: string; aRemaining: number | null; bSeenRemaining: number | null; consistent: boolean }
  }
  builtAt: number
}
