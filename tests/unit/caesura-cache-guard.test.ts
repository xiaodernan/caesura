import { describe, expect, it } from 'vitest'
import {
  GUARD_DEFAULTS,
  compareStampede,
  shouldEarlyExpire,
  comparePenetration,
  compareAvalanche,
  cacheGuardStudy,
  guardSnapshot,
} from '../../scripts/caesura-cache-guard.mjs'
import { createRedisCache } from '../../scripts/caesura-redis-cache.mjs'
import { createBloomFilter } from '../../scripts/caesura-lsm-store.mjs'

describe('caesura-cache-guard (KI-501)', () => {
  /* ---------------- ① 击穿 / stampede ---------------- */
  it('① 导出教学缺省值，字段自洽', () => {
    expect(GUARD_DEFAULTS.concurrency).toBeGreaterThan(1)
    expect(GUARD_DEFAULTS.ttlMs).toBeGreaterThan(0)
    expect(GUARD_DEFAULTS.rounds).toBeGreaterThan(1) // 空值墓碑要靠多轮才显出价值
    expect(GUARD_DEFAULTS.absentRatio).toBeGreaterThan(0)
    expect(GUARD_DEFAULTS.absentRatio).toBeLessThan(1)
  })

  it('② 击穿：N 并发无防护 N 次回源，singleflight 真合并到 1 次、省 N−1', async () => {
    const r = await compareStampede({ concurrency: 32, now: () => 1000, seed: 7 })
    expect(r.naiveLoads).toBe(32)
    expect(r.singleflightLoads).toBe(1) // 复用 KI-493 load，真合并
    expect(r.savedLoads).toBe(31)
    expect(r.amplification).toBe(32)
  })

  it('③ 击穿：注入 loader 时 naiveLoads 恒等真实调用次数（不猜 loader 内部）', async () => {
    let observed = 0
    const r = await compareStampede({
      concurrency: 10, seed: 3,
      loader: async () => { observed++; return { v: observed } },
    })
    expect(observed).toBe(10)   // naive 路逐次真调
    expect(r.naiveLoads).toBe(10)
    expect(r.singleflightLoads).toBe(1) // singleflight 路用独立 loader，不污染注入计数
  })

  it('④ 击穿空集降级：0 并发不调 loader、放大倍率诚实为 null', async () => {
    let calls = 0
    const r = await compareStampede({ concurrency: 0, loader: async () => { calls++; return 1 } })
    expect(calls).toBe(0)
    expect(r.naiveLoads).toBe(0)
    expect(r.singleflightLoads).toBe(0)
    expect(r.amplification).toBeNull()
    expect(r.xfetchAvoidedMisses).toBe(0)
  })

  it('⑤ XFetch 判据：age=0 永不提前、age=ttl 必提前、P 随 age 单调、ttl≤0 不除零', () => {
    const one = () => 0.999
    expect(shouldEarlyExpire({ ageMs: 0, ttlMs: 1000, beta: 1, rand: one })).toBe(false)
    expect(shouldEarlyExpire({ ageMs: 1000, ttlMs: 1000, beta: 1, rand: one })).toBe(true)
    expect(shouldEarlyExpire({ ageMs: 500, ttlMs: 1000, beta: 1, rand: () => 0.4 })).toBe(true)  // P=0.5
    expect(shouldEarlyExpire({ ageMs: 500, ttlMs: 1000, beta: 1, rand: () => 0.6 })).toBe(false)
    expect(shouldEarlyExpire({ ageMs: 500, ttlMs: 0, beta: 1, rand: one })).toBe(false)
    expect(shouldEarlyExpire({ ageMs: 10, ttlMs: 1000, beta: 0, rand: () => 0 })).toBe(false) // beta=0 关提前
  })

  it('⑥ 击穿：beta=0 时无提前续期；XFetch 避免数不超过 naive−1（不粉饰全免）', async () => {
    const off = await compareStampede({ concurrency: 20, beta: 0, seed: 5 })
    expect(off.xfetchEarlyRefreshes).toBe(0)
    expect(off.xfetchAvoidedMisses).toBe(0)
    const on = await compareStampede({ concurrency: 20, beta: 1, seed: 5 })
    expect(on.xfetchEarlyRefreshes).toBeGreaterThan(0)
    expect(on.xfetchAvoidedMisses).toBeLessThanOrEqual(on.naiveLoads - 1)
  })

  /* ---------------- ② 穿透 / penetration ---------------- */
  it('⑦ 穿透：无防护 = 不存在 key × 轮数；空值墓碑只首轮回源、布隆大幅省回源', () => {
    const r = comparePenetration({ keys: Array.from({ length: 200 }, (_, i) => `k${i}`), absentRatio: 0.5, rounds: 4, seed: 1 })
    expect(r.present).toBe(100)
    expect(r.absent).toBe(100)
    expect(r.naiveDbHits).toBe(400)        // 100 不存在 × 4 轮
    expect(r.negativeDbHits).toBe(100)     // 空值墓碑：只有首轮 100 次
    expect(r.bloomDbHits + r.bloomRejected).toBe(100) // 放行 + 拒绝 = 全部不存在 key
    expect(r.bloomDbHits).toBeLessThan(r.naiveDbHits)
    expect(r.bloomSavedRate).toBeGreaterThan(0.9)
  })

  it('⑧ 穿透：布隆负查零假阴性——被拒的 key 一定不在 presentKeys', () => {
    const present = ['a', 'b', 'c']
    const absent = ['x', 'y', 'z', 'w', 'v']
    const r = comparePenetration({ keys: [...present, ...absent], presentKeys: present,
      rounds: 1, bloomOpts: { numKeys: 3, bitsPerKey: 20 } })
    // 被 bloom 拒绝的绝不能是真存在的 key（零假阴性 = 只认 presentSet 之外的作 absent）。
    expect(r.absent).toBe(5)
    expect(r.bloomRejected + r.bloomDbHits).toBe(5)
  })

  it('⑨ 穿透：布隆假阳性如实暴露（不零误判），空 Bloom 注入也能读 stats', () => {
    const r = comparePenetration({ keys: Array.from({ length: 300 }, (_, i) => `k${i}`),
      absentRatio: 0.9, rounds: 2, seed: 11, bloomOpts: { numKeys: 30, bitsPerKey: 2, k: 1 } })
    expect(r.bloomFalsePositives).not.toBeNull()
    expect(r.bloomFalsePositives!).toBeGreaterThanOrEqual(0)
    // 高负载 + 小位数组 ⇒ 假阳性放行 = bloomDbHits，二者相等（每个假阳性都真回源一次）。
    expect(r.bloomDbHits).toBe(r.bloomFalsePositives)
  })

  it('⑩ 穿透：空键集降级不除零，rounds 钳到 ≥1', () => {
    const empty = comparePenetration({ keys: [], rounds: 0 })
    expect(empty.absent).toBe(0)
    expect(empty.naiveDbHits).toBe(0)
    expect(empty.bloomSavedRate).toBeNull()
    const one = comparePenetration({ keys: ['a', 'b'], presentKeys: ['a'], rounds: 0 })
    expect(one.rounds).toBe(1)
  })

  /* ---------------- ③ 雪崩 / avalanche ---------------- */
  it('⑪ 雪崩：统一 TTL 单桶峰值=全量；TTL 抖动削峰、摊到更多 bucket', () => {
    const r = compareAvalanche({ keys: 512, ttlMs: 1000, jitterRatio: 1, buckets: 16, seed: 9 })
    expect(r.uniformPeak).toBe(512)      // 全挤一个桶
    expect(r.uniformBuckets).toBe(1)
    expect(r.jitterPeak).toBeLessThan(r.uniformPeak)
    expect(r.jitterBuckets).toBeGreaterThan(r.uniformBuckets)
    expect(r.peakReduction).toBeGreaterThan(0.5)
    expect(r.peakReduction).toBeLessThanOrEqual(1)
    expect(r.totalExpirations).toBe(512) // 抖动只挪时刻，不减少总过期数
  })

  it('⑫ 雪崩：直方图两路各自求和=总 key 数；jitterRatio=0 退化为不削峰', () => {
    const r = compareAvalanche({ keys: 200, buckets: 8, seed: 4 })
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
    expect(sum(r.histogram.uniform)).toBe(200)
    expect(sum(r.histogram.jitter)).toBe(200)
    expect(r.histogram.uniform.length).toBe(8)
    expect(r.histogram.jitter.length).toBe(8)
    const noJitter = compareAvalanche({ keys: 200, jitterRatio: 0, buckets: 8, seed: 4 })
    expect(noJitter.jitterPeak).toBe(noJitter.uniformPeak) // 抖动为 0 ⇒ 两路重合
    expect(noJitter.peakReduction).toBe(0)
  })

  it('⑬ 雪崩空集降级：0 key 不除零、直方图为空', () => {
    const r = compareAvalanche({ keys: 0, buckets: 16, seed: 1 })
    expect(r.uniformPeak).toBe(0)
    expect(r.jitterPeak).toBe(0)
    expect(r.peakReduction).toBe(0)
    expect(r.histogram).toEqual({ uniform: [], jitter: [] })
  })

  /* ---------------- ④ 汇总 / 快照 / 注入 ---------------- */
  it('⑭ 汇总三件成纯数据、注入 now 确定性、快照同源且不含函数/Map', async () => {
    const study = await cacheGuardStudy({ concurrency: 16, keys: 128, now: () => 4242, seed: 21 })
    expect(study.builtAt).toBe(4242)
    expect(study.stampede.singleflightLoads).toBe(1)
    expect(study.penetration.negativeDbHits).toBeLessThan(study.penetration.naiveDbHits)
    expect(study.avalanche.jitterPeak).toBeLessThan(study.avalanche.uniformPeak)
    const snap = guardSnapshot(study)
    expect(snap).toEqual(study)
    // 纯数据：可安全 JSON 序列化，无函数/Map/缓存实例/Bloom 位数组泄漏。
    expect(() => JSON.parse(JSON.stringify(snap))).not.toThrow()
    expect(snap && Object.values(snap).some((v) => typeof v === 'function')).toBeFalsy()
    // 确定性：同 seed 同 now 两次三件读数逐字一致。
    const again = await cacheGuardStudy({ concurrency: 16, keys: 128, now: () => 4242, seed: 21 })
    expect(again).toEqual(study)
    // 空 study 快照诚实为 null。
    expect(guardSnapshot(null)).toBeNull()
  })

  it('⑮ 复用真件：击穿走 createRedisCache.load、穿透布隆走 createBloomFilter（非各抄一套）', async () => {
    // 注入现成缓存/Bloom 时只认调用方那一只，证明是咬合真件而非另起炉灶。
    const injectedCache = createRedisCache({ now: () => 500 })
    const study = await cacheGuardStudy({
      concurrency: 8, keys: 40, now: () => 500, seed: 2,
      cacheFactory: () => injectedCache,
    })
    // 注入的现成缓存真承接了 stampede 的 load（仍合并到 1 次）与穿透的墓碑写入。
    expect(study.stampede.singleflightLoads).toBe(1)
    // 同一只注入缓存在穿透轮后确有墓碑驻留（证明复用的是它，不是另起的一只内部缓存）。
    expect(injectedCache.stats().entries).toBeGreaterThan(0)
    const b = createBloomFilter({ numKeys: 20, bitsPerKey: 10 })
    const r = comparePenetration({ keys: Array.from({ length: 40 }, (_, i) => `k${i}`),
      absentRatio: 0.5, rounds: 2, bloom: () => b })
    expect(r.bloomRejected).toBeGreaterThan(0)
  })
})
