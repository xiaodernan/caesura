import { describe, expect, it } from 'vitest'
import {
  IDEMPOTENT_DEFAULTS,
  IDEMPOTENT_SCENARIOS,
  IDEMPOTENT_STRATEGIES,
  createInMemoryDedupSet,
  createRedisSetNx,
  createBloomGuard,
  idempotentConsumerStudy,
  idempotentConsumerSnapshot,
  verifyCausalLocks,
  verifyIdempotencySoundness,
  createIdempotentEvidence,
} from '../../scripts/caesura-idempotent-consumer.mjs'

/** KI-540 幂等去重三策略（P8 第四十七件 · 前端第三十四维）。 */

describe('caesura-idempotent-consumer（KI-540）', () => {
  it('IDEMPOTENT_DEFAULTS / STRATEGIES / SCENARIOS 固定顺序', () => {
    expect(IDEMPOTENT_STRATEGIES).toEqual(['InMemoryDedupSet', 'RedisSetNx', 'BloomGuard'])
    expect(IDEMPOTENT_SCENARIOS).toEqual(['consistentStream', 'atLeastOnceRedelivery', 'burstRedelivery', 'falsePositiveBurst', 'coldRestart', 'cleanRerun'])
    expect(IDEMPOTENT_DEFAULTS.seed).toBe(540)
    expect(IDEMPOTENT_DEFAULTS.messages).toBe(96)
    expect(IDEMPOTENT_DEFAULTS.bloomBits).toBe(512)
  })

  it('InMemoryDedupSet：exact-dedup · 同 id 真拒 · 无误判 · 零 RTT', () => {
    const m = createInMemoryDedupSet({})
    const a = m.add('a')
    expect(a.added).toBe(true)
    const b = m.add('a')
    expect(b.deduped).toBe(true)
    expect(m.has('a')).toBe(true)
    expect(m.has('b')).toBe(false)
  })

  it('RedisSetNx：fakeRedis 1 RTT · 真 + 真拒 · TTL 有界', () => {
    const m = createRedisSetNx({})
    const a = m.add('x')
    expect(a.ok).toBe(true)
    expect(a.deduped).toBe(false)
    const b = m.add('x')
    expect(b.ok).toBe(false)
    expect(b.deduped).toBe(true)
    expect(m.rtt()).toBe(2)
  })

  it('BloomGuard：位图 m 位固定长有界 · 高负载下假阳真暴露', () => {
    const m = createBloomGuard({ bits: 512, k: 3 })
    for (let i = 0; i < 128; i++) m.add('x' + i)
    expect(m.loadFactor()).toBeGreaterThan(0)
    expect(m.fpr()).toBeGreaterThan(0)
    // 缺位向量必为 true 零误判检验
    const fprBefore = m.fpr()
    const m2 = createBloomGuard({ bits: 4096, k: 3 })
    for (let i = 0; i < 128; i++) m2.add('x' + i)
    expect(m2.fpr()).toBeLessThan(fprBefore)
  })

  it('六场景都跑出 cell；vectors 与 trilemma 同源现算', () => {
    const s = idempotentConsumerStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(IDEMPOTENT_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.exactDedup)}${Number(row.trilemma.lowOverhead)}${Number(row.trilemma.durableBounded)}`)
    }
  })

  it('默认向量互异、无一 111、noUniversalWinner distinguishable vectorFromTrilemma noStrategyWinsAll', () => {
    const s = idempotentConsumerStudy({ now: () => 540000 })
    expect(s.vectors).toEqual({ InMemoryDedupSet: '110', RedisSetNx: '101', BloomGuard: '011' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(540000)
  })

  it('三难各据一考场：[exactDedup / lowOverhead / durableBounded]', () => {
    const s = idempotentConsumerStudy({})
    const m = s.rows.find((r) => r.protocol === 'InMemoryDedupSet')!
    const r = s.rows.find((r) => r.protocol === 'RedisSetNx')!
    const b = s.rows.find((r) => r.protocol === 'BloomGuard')!
    expect(m.trilemma).toEqual({ exactDedup: true, lowOverhead: true, durableBounded: false })
    expect(r.trilemma).toEqual({ exactDedup: true, lowOverhead: false, durableBounded: true })
    expect(b.trilemma).toEqual({ exactDedup: false, lowOverhead: true, durableBounded: true })
  })

  it('单开 unboundedRam ⇒ InMemory OOM=0 但阶常 110（位不变）', () => {
    const s = idempotentConsumerStudy({ unboundedRam: true })
    expect(s.vectors.InMemoryDedupSet).toBe('110')
    expect(s.verdict.unboundedRamErasesInMemoryOom).toBe(true)
    expect(s.verdict.memPureCrash).toBe(true)  // 不 rigged 于默认底线
  })

  it('单开 zeroRttNetwork ⇒ RedisSetNx exact+lowOverhead+durableBounded=111（完美 Redis）', () => {
    const s = idempotentConsumerStudy({ zeroRttNetwork: true })
    expect(s.vectors.RedisSetNx).toBe('111')
    expect(s.verdict.redisStillExact).toBe(true)
    expect(s.verdict.zeroRttErasesRedisLowOverheadBit).toBe(true)
  })

  it('单开 collisionFreeBloom ⇒ BloomGuard 仍 011（Bloom 永远非精确——exactDedup 属于设计结构而非事故）', () => {
    const s = idempotentConsumerStudy({ collisionFreeBloom: true })
    expect(s.vectors.BloomGuard).toBe('011')
    expect(s.verdict.collisionFreeBloomErasesBloomFp).toBe(true)
    expect(s.verdict.bloomOverheads).toBe(true)
  })

  it('rigged 三开齐 ⇒ RedisSetNx=111，其它不动 — distinguishable=true/noStrategyWinsAll=false', () => {
    const s = idempotentConsumerStudy({ rigged: true })
    expect(s.vectors).toEqual({ InMemoryDedupSet: '110', RedisSetNx: '111', BloomGuard: '011' })
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(false)
  })

  it('verifyIdempotencySoundness：holds=true nontrivial=true falsifiable；laneA 全接受；laneB 真拒 dupes', () => {
    const events = [
      ...Array.from({ length: 96 }, (_, i) => ({ id: `m:540:${i}`, payload: `p` })),
      ...Array.from({ length: 96 }, (_, i) => ({ id: `m:540:${i}`, payload: `p` })),
    ]
    const r = verifyIdempotencySoundness({ events, seed: 540 }, { seed: 540 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.laneA.consistentAcceptedInMemory).toBeGreaterThan(0)
    expect(r.laneB.atLeastOnceAcceptedInMemory).toBeGreaterThan(0)
    expect(r.tamper.duplicateInvisible.holds).toBe(false)
    expect(r.tamper.forgedDedupHit.holds).toBe(false)
    expect(r.tamper.emptyStream.holds).toBe(false)
  })

  it('verifyIdempotencySoundness 空 events ⇒ holds=false nontrivial=false', () => {
    const r = verifyIdempotencySoundness({ events: [], seed: 540 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('verifyCausalLocks 三因果锁 allHold', () => {
    const r = verifyCausalLocks({ seed: 540 })
    expect(r.bloomFalsePositiveCausallyUnerasable).toBe(true)
    expect(r.redisRttCausallyUnerasable).toBe(true)
    expect(r.inMemoryVolatilityCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
    expect(r.probes).toBeDefined()
  })

  it('idempotentConsumerSnapshot：形状 + verdict 同源；snapshot(null)/{} → null 反守卫', () => {
    const s = idempotentConsumerStudy({ now: () => 540000 })
    const snap = idempotentConsumerSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.causalLocks!.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(idempotentConsumerSnapshot(null as never)).toBe(null)
    expect(idempotentConsumerSnapshot({} as never)).toBe(null)
  })

  it('createIdempotentEvidence 真件 ≥ 21 键 + 核心件回读', () => {
    const ev = createIdempotentEvidence({ seed: 540, now: () => 540000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness 结构 holds', () => {
    const s = idempotentConsumerStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
  it('【可证伪护栏】falsifiable 必须真推导：baselineHolds=true 且三路 tamper 全 false（绝不写死）', () => {
    const events = [
      ...Array.from({ length: 96 }, (_, i) => ({ id: `m:540:${i}`, payload: 'p' })),
      ...Array.from({ length: 96 }, (_, i) => ({ id: `m:540:${i}`, payload: 'p' })),
    ]
    const r = verifyIdempotencySoundness({ events, seed: 540 }, { seed: 540 })
    expect(r.baselineHolds).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.holds).toBe(true)
    expect(r.tamper.duplicateInvisible.holds).toBe(false)
    expect(r.tamper.forgedDedupHit.holds).toBe(false)
    expect(r.tamper.emptyStream.holds).toBe(false)
    // tamper 的 false 必须是**现算**出来的（读数自证），不能是写死常量：
    expect(r.tamper.duplicateInvisible.reason).toContain('192')
    expect(r.tamper.forgedDedupHit.reason).toContain('48')
  })

  it('布隆在干净唯一流上就真假阳（概率结构的诚实读数，不是事故）', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `m:540:${i}`, payload: 'p' }))
    const r = verifyIdempotencySoundness({ events, seed: 540 }, { seed: 540 })
    // 精确策略在唯一流上零误杀。
    expect(r.laneA.consistentAcceptedInMemory).toBe(r.laneA.unique)
    expect(r.laneA.consistentAcceptedRedis).toBe(r.laneA.unique)
    // 布隆按设计就不是精确集合 ⇒ 唯一流上也有假阳损耗（实测 2/96），如实读出而非藏起来。
    expect(r.laneA.bloomFalsePositivesOnUniqueFlow).toBeGreaterThan(0)
    expect(r.laneA.consistentAcceptedBloom).toBeLessThan(r.laneA.unique)
  })

  it('rigged 全开真值钉死：110/111/011 单点通吃，**不是**收敛塌缩', () => {
    const s = idempotentConsumerStudy({ rigged: true })
    expect(s.vectors).toEqual({ InMemoryDedupSet: '110', RedisSetNx: '111', BloomGuard: '011' })
    expect(s.verdict.noStrategyWinsAll).toBe(false)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    // 关键护栏：单点通吃 ≠ 区分度塌缩（KI-539 同款「注释与真值相反」陷阱的同族防线）。
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
  })
})
