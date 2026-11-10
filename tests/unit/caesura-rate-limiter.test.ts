import { describe, it, expect } from 'vitest'
import {
  RLIMIT_DEFAULTS,
  createFixedWindow,
  createSlidingLog,
  createSlidingCounter,
  createTokenBucket,
  createLeakyBucket,
  createRedisTokenBucket,
  defaultBurstArrivals,
  compareRateAlgorithms,
  compareRedisAtomicity,
  rateLimiterStudy,
  rlSnapshot,
} from '../../scripts/caesura-rate-limiter.mjs'
import { createRedisCache } from '../../scripts/caesura-redis-cache.mjs'

/** 造一只可控时钟：每次调用读外部游标，测试里手动推进。 */
function clock() {
  let t = 0
  return { now: () => t, set: (v: number) => { t = v }, get: () => t }
}

describe('KI-502 网关限流算法族 + Redis 原子令牌桶', () => {
  it('① 默认参数冻结、12 枚值导出齐全（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(RLIMIT_DEFAULTS)).toBe(true)
    expect(RLIMIT_DEFAULTS.limit).toBe(8)
    expect(RLIMIT_DEFAULTS.windowMs).toBe(1000)
    expect(RLIMIT_DEFAULTS.concurrency).toBe(64)
    for (const fn of [
      createFixedWindow, createSlidingLog, createSlidingCounter, createTokenBucket,
      createLeakyBucket, createRedisTokenBucket, defaultBurstArrivals,
      compareRateAlgorithms, compareRedisAtomicity, rateLimiterStudy, rlSnapshot,
    ]) expect(typeof fn).toBe('function')
  })

  it('② 固定窗口：按墙钟整窗计数、翻边归零、remaining 正确', () => {
    const c = clock()
    const w = createFixedWindow({ limit: 3, windowMs: 1000, now: c.now })
    c.set(100)
    expect(w.allow().allowed).toBe(true)  // count=1
    expect(w.allow().allowed).toBe(true)  // count=2
    const third = w.allow()
    expect(third.allowed).toBe(true)      // count=3
    expect(third.remaining).toBe(0)
    const over = w.allow()
    expect(over.allowed).toBe(false)
    expect(over.retryAfterMs).toBe(1000 - 100) // 到 windowStart+windowMs
    c.set(1100)                            // 翻到下一自然窗
    expect(w.allow().allowed).toBe(true)   // count 归零后放行
    expect(w.state().count).toBe(1)
  })

  it('③ 固定窗口墙钟对齐（非首请求对齐）：首请求 999 也落在 [0,1000) 窗', () => {
    const c = clock()
    const w = createFixedWindow({ limit: 1, windowMs: 1000, now: c.now })
    c.set(999)
    expect(w.allow().allowed).toBe(true)
    c.set(1000) // 只过了 1ms，但跨自然窗边界
    expect(w.allow().allowed).toBe(true) // 翻边放行 ⇒ 边界突发的根因
  })

  it('④ 滑动日志：精确裁窗外旧戳、size 反映 O(n) 内存、拒时 retry 指向最早戳滑出', () => {
    const c = clock()
    const w = createSlidingLog({ limit: 2, windowMs: 1000, now: c.now })
    c.set(100); expect(w.allow().allowed).toBe(true)
    c.set(200); expect(w.allow().allowed).toBe(true)
    c.set(300); const over = w.allow(); expect(over.allowed).toBe(false)
    expect(over.retryAfterMs).toBe(1100 - 300) // 最早戳 100 + 1000 - 300
    expect(w.state().size).toBe(2)
    expect(w.state().memory).toBe('O(n)')
    c.set(1101); expect(w.allow().allowed).toBe(true) // 100 已滑出（<=101）
    expect(w.state().size).toBe(3 - 1) // 裁掉 100，加 1101 ⇒ 2
  })

  it('⑤ 滑动日志 cost>1：一次申请多票，按票数占位', () => {
    const c = clock()
    const w = createSlidingLog({ limit: 3, windowMs: 1000, now: c.now })
    c.set(0)
    expect(w.allow(2).allowed).toBe(true)
    expect(w.state().size).toBe(2)
    expect(w.allow(2).allowed).toBe(false) // 2+2>3
    expect(w.allow(1).allowed).toBe(true)  // 2+1<=3
  })

  it('⑥ 滑动计数：O(1) 内存（仅 prev/curr 两计数）、无 size 数组', () => {
    const c = clock()
    const w = createSlidingCounter({ limit: 2, windowMs: 1000, now: c.now })
    c.set(0); w.allow(); w.allow()
    c.set(500); expect(w.allow().allowed).toBe(false) // 当前窗已满
    const s = w.state()
    expect(s.memory).toBe('O(1)')
    expect(s).not.toHaveProperty('size')
    expect(s.prevCount).toBe(0)
    expect(s.currCount).toBe(2)
  })

  it('⑦ 滑动计数跨窗加权：前窗按重叠权重计入 estimate（近似、非精确）', () => {
    const c = clock()
    const w = createSlidingCounter({ limit: 4, windowMs: 1000, now: c.now })
    c.set(100); w.allow(); w.allow(); w.allow() // 当前窗 currCount=3
    c.set(1100) // 跨窗，prevCount=3，overlap=1-(1100-1000)/1000=0.9
    expect(w.allow().allowed).toBe(true)  // est=3*0.9=2.7, +1=3.7<=4
    const s = w.state()
    expect(s.prevCount).toBe(3)
    expect(s.currCount).toBe(1)
    expect(s.estimate).toBeCloseTo(3.7, 1) // 近似值，显式量出
  })

  it('⑧ 令牌桶：capacity 受控突发 + refillPerSec 持续补充', () => {
    const c = clock()
    const b = createTokenBucket({ capacity: 3, refillPerSec: 1, now: c.now })
    c.set(0)
    expect(b.allow().allowed && b.allow().allowed && b.allow().allowed).toBe(true) // 突发放空 3
    expect(b.allow().allowed).toBe(false) // 空桶拒绝
    c.set(2000) // 补 2 个 token
    expect(b.allow().allowed).toBe(true)
    expect(b.allow().allowed).toBe(true)
    expect(b.allow().allowed).toBe(false)
  })

  it('⑨ 令牌桶 retryAfterMs：速率 0 时拒绝给 null（不编造 Infinity 假数）', () => {
    const c = clock()
    const b = createTokenBucket({ capacity: 1, refillPerSec: 0, now: c.now })
    c.set(0); b.allow()
    const over = b.allow()
    expect(over.allowed).toBe(false)
    expect(over.retryAfterMs).toBe(null)
  })

  it('⑩ 漏桶：恒定速率整形、满则拒、retry 按 leakPerSec 算', () => {
    const c = clock()
    const b = createLeakyBucket({ capacity: 2, leakPerSec: 1, now: c.now })
    c.set(0)
    expect(b.allow().allowed).toBe(true)  // level=1
    expect(b.allow().allowed).toBe(true)  // level=2
    const over = b.allow()
    expect(over.allowed).toBe(false)
    expect(over.retryAfterMs).toBe(1000) // (2+1-2)/1*1000
    c.set(1000) // 漏掉 1 ⇒ level=1
    expect(b.allow().allowed).toBe(true)  // level=2
  })

  it('⑪ 默认突发轨迹：窗口翻边两批 + 隔整窗一批，24 条确定性', () => {
    const a = defaultBurstArrivals(8, 1000)
    expect(a.length).toBe(24)
    expect(a.filter((t) => t === 999).length).toBe(8)
    expect(a.filter((t) => t === 1000).length).toBe(8)
    expect(a.filter((t) => t === 2000).length).toBe(8)
  })

  it('⑫ 五算法同一突发轨迹：固定窗口 burstRatio=2、其余=1，五句判词全真', () => {
    const r = compareRateAlgorithms({ limit: 8, windowMs: 1000, capacity: 8, refillPerSec: 8, leakPerSec: 8 })
    expect(r.strategies.fixedWindow.allowed).toBe(24) // 三批全放行
    expect(r.strategies.fixedWindow.burstRatio).toBe(2)
    for (const k of ['slidingLog', 'slidingCounter', 'tokenBucket', 'leakyBucket'] as const) {
      expect(r.strategies[k].allowed).toBe(16) // 翻边那批被拒
      expect(r.strategies[k].burstRatio).toBe(1)
    }
    expect(r.verdict).toEqual({
      fixedWindowBurst: true, slidingBounded: true, tokenControlled: true,
      leakySteady: true, counterIsO1: true,
    })
    expect(r.strategies.slidingLog.state.memory).toBe('O(n)')
    expect(r.strategies.slidingCounter.state.memory).toBe('O(1)')
  })

  it('⑬ 自定义轨迹注入：全落在同一时刻，各算法行为可断言（确定性）', () => {
    const r = compareRateAlgorithms({ limit: 4, windowMs: 1000, capacity: 4, arrivals: [0, 0, 0, 0, 0, 0] })
    expect(r.limit).toBe(4)
    expect(r.arrivals).toBe(6)
    expect(r.strategies.fixedWindow.allowed).toBe(4)
    expect(r.strategies.slidingLog.allowed).toBe(4)
    expect(r.strategies.tokenBucket.allowed).toBe(4)
  })

  it('⑭ Redis 令牌桶原子路径：N 并发恰好放行 capacity、不超发、remaining 有界', async () => {
    const backend = createRedisCache({ now: () => 0 })
    const b = createRedisTokenBucket({ backend, key: 'a', capacity: 5, refillPerSec: 0, now: () => 0, atomic: true })
    const rs = await Promise.all(Array.from({ length: 20 }, () => b.allow()))
    expect(rs.filter((r) => r.allowed).length).toBe(5)
    expect(b.state().tokens).toBe(0)
    expect(b.state().atomic).toBe(true)
    expect(b.key).toBe('a')
  })

  it('⑮ Redis 令牌桶非原子路径：读写间让出 ⇒ 全并发放行、超发；共享 backend 状态一致', async () => {
    const backend = createRedisCache({ now: () => 0 })
    const b = createRedisTokenBucket({ backend, key: 'b', capacity: 5, refillPerSec: 0, now: () => 0, atomic: false, yield: () => Promise.resolve() })
    const rs = await Promise.all(Array.from({ length: 20 }, () => b.allow()))
    expect(rs.filter((r) => r.allowed).length).toBe(20) // 全读到同一满桶 ⇒ 超发
    expect(b.state().atomic).toBe(false)
    // 两实例共享同 backend + key：A 扣减后 B 立刻看到。
    const a = createRedisTokenBucket({ backend, key: 'shared', capacity: 8, refillPerSec: 0, now: () => 0 })
    const c = createRedisTokenBucket({ backend, key: 'shared', capacity: 8, refillPerSec: 0, now: () => 0 })
    await a.allow(); await a.allow(); await a.allow()
    expect(a.state().tokens).toBe(5)
    expect(c.state().tokens).toBe(5) // 跨实例共享
  })

  it('⑯ Redis 原子性对照 + 汇总快照：atomicBounded/nonAtomicOverran/shared.consistent、纯数据可序列化', async () => {
    const atomicity = await compareRedisAtomicity({ concurrency: 32, capacity: 6, refillPerSec: 0, now: () => 0 })
    expect(atomicity.atomicAllowed).toBe(6)
    expect(atomicity.nonAtomicAllowed).toBe(32)
    expect(atomicity.overshoot).toBe(26)
    expect(atomicity.atomicBounded).toBe(true)
    expect(atomicity.nonAtomicOverran).toBe(true)
    expect(atomicity.shared.consistent).toBe(true)

    const study = await rateLimiterStudy({ now: () => 777, concurrency: 32, capacity: 6, redisCapacity: 6 })
    expect(study.builtAt).toBe(777)
    const snap = rlSnapshot(study)
    expect(Object.keys(snap.strategies)).toEqual(['fixedWindow', 'slidingLog', 'slidingCounter', 'tokenBucket', 'leakyBucket'])
    expect(snap.verdict.fixedWindowBurst).toBe(true)
    expect(snap.redis.atomicBounded).toBe(true)
    expect(snap.redis.shared.consistent).toBe(true)
    // 纯数据、不含函数/Error，可 JSON 往返。
    expect(() => JSON.stringify(snap)).not.toThrow()
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
})
