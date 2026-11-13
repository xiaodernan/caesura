import { describe, expect, it } from 'vitest'
import {
  SPRING_FEIGN_DEFAULTS,
  SPRING_FEIGN_SCENARIOS,
  SPRING_FEIGN_STRATEGIES,
  createStubDecoder,
  createReactiveClient,
  createBlockingClient,
  springFeignStudy,
  springFeignSnapshot,
  verifyCausalLocks,
  verifySpringFeignSoundness,
  createSpringFeignEvidence,
} from '../../scripts/caesura-spring-feign.mjs'

/** KI-546 Spring Cloud OpenFeign 三策略 Client（P8 第五十三件）。 */

describe('caesura-spring-feign（KI-546）', () => {
  it('默认值/策略/场景固定顺序', () => {
    expect(SPRING_FEIGN_STRATEGIES).toEqual(['StubDecoder', 'ReactiveClient', 'BlockingClient'])
    expect(SPRING_FEIGN_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'feignRetry', 'cleanRerun'])
    expect(SPRING_FEIGN_DEFAULTS.seed).toBe(546)
    expect(SPRING_FEIGN_DEFAULTS.messages).toBe(96)
  })

  it('StubDecoder：进程内 stub·100% 处理率·pipelineable=false', () => {
    const s = createStubDecoder({})
    expect(s.pipelineable).toBe(false)
    expect(s.invoke([{ id: 'a' }, { id: 'b' }]).processed).toBe(2)
  })

  it('ReactiveClient：batchFriendly=true·pipelineable=true（concatMap stream）', () => {
    const rc = createReactiveClient({})
    expect(rc.batchFriendly).toBe(true)
    expect(rc.invoke(Array.from({ length: 7 }, (_, i) => ({ id: `r:${i}` }))).processed).toBe(7)
    expect(rc.invoke.length).toBeDefined()
  })

  it('BlockingClient：blocking（lowLatency=true+batchFriendly=false+pipelineable=true ⇒ 001）', () => {
    const bc = createBlockingClient({})
    expect(bc.lowLatency).toBe(true)
    expect(bc.batchFriendly).toBe(false)
  })

  it('四场景 cell 全真 · vectors 现算与 trilemma 同源', () => {
    const s = springFeignStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(SPRING_FEIGN_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.lowLatency)}${Number(row.trilemma.batchFriendly)}${Number(row.trilemma.pipelineable)}`)
    }
  })

  it('默认向量互异 110/011/001 · noUniversalWinner distinguishable vectorFromTrilemma noStrategyWinsAll', () => {
    const s = springFeignStudy({ now: () => 546000 })
    expect(s.vectors).toEqual({ StubDecoder: '110', ReactiveClient: '011', BlockingClient: '001' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(546000)
  })

  it('三因果锁 allHold', () => {
    const r = verifyCausalLocks({ seed: 546 })
    expect(r.pipelineWriteFriendlyCausallyUnerasable).toBe(true)
    expect(r.stubNoNetworkCausallyUnerasable).toBe(true)
    expect(r.blockingPipelineAtomicityCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifySpringFeignSoundness · holds=true nontrivial=true falsifiable · 三路篡改 false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'r:' + i, method: i % 3 === 0 ? 'GET' : 'POST', url: '/api/items/' + (i % 8) }))
    const r = verifySpringFeignSoundness({ events, seed: 546, messages: 96 }, { seed: 546 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.stubProcessed).toBe(96)
    expect(r.laneB.reactiveProcessed).toBe(96)
    expect(r.tamper.stubShotgun.holds).toBe(false)
    expect(r.tamper.reactiveTimeout.holds).toBe(false)
    expect(r.tamper.blockingOverflow.holds).toBe(false)
  })

  it('空 events ⇒ holds=false nontrivial=false', () => {
    const r = verifySpringFeignSoundness({ events: [], seed: 546 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('springFeignSnapshot 形状 + null/{} → null 反守卫', () => {
    const s = springFeignStudy({ now: () => 546000 })
    const snap = springFeignSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(springFeignSnapshot(null as never)).toBe(null)
    expect(springFeignSnapshot({} as never)).toBe(null)
  })

  it('createSpringFeignEvidence ≥ 21 键 + 核心件回读', () => {
    const ev = createSpringFeignEvidence({ seed: 546, now: () => 546000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence 21 键 + soundness holds；study.causalLocks allHold', () => {
    const s = springFeignStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
