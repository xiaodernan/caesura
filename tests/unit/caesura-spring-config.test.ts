import { describe, expect, it } from 'vitest'
import {
  SPRING_CONFIG_DEFAULTS,
  SPRING_CONFIG_SCENARIOS,
  SPRING_CONFIG_STRATEGIES,
  createGitBackend,
  createNativeBackend,
  createRedisBackend,
  springConfigStudy,
  springConfigSnapshot,
  verifyCausalLocks,
  verifySpringConfigSoundness,
  createSpringConfigEvidence,
} from '../../scripts/caesura-spring-config.mjs'

/** KI-547 Spring Cloud Config 分布式配置中心三策略教学件（P8 第五十四件） */

describe('caesura-spring-config（KI-547）', () => {
  it('默认值/策略/场景 顺序稳定', () => {
    expect(SPRING_CONFIG_STRATEGIES).toEqual(['GitBackend', 'NativeBackend', 'RedisBackend'])
    expect(SPRING_CONFIG_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'configDrift', 'cleanRerun'])
    expect(SPRING_CONFIG_DEFAULTS.seed).toBe(547)
    expect(SPRING_CONFIG_DEFAULTS.messages).toBe(96)
  })

  it('GitBackend：hotReload=true / scaleFriendly=true / consistency=false（commit lag 不可消弭）', () => {
    const g = createGitBackend({})
    expect(g.consistency).toBe(false)
    expect(g.hotReload).toBe(true)
    expect(g.scaleFriendly).toBe(true)
    expect(g.invoke([{ id: 'a' }, { id: 'b' }]).processed).toBe(2)
  })

  it('NativeBackend：hotReload=true / scaleFriendly=false / consistency=true（单主机本地绑定）', () => {
    const n = createNativeBackend({})
    expect(n.hotReload).toBe(true)
    expect(n.scaleFriendly).toBe(false)
    expect(n.consistency).toBe(true)
  })

  it('RedisBackend：hotReload=false / scaleFriendly=true / consistency=true（失效推送 RTT 不可绕过）', () => {
    const r = createRedisBackend({})
    expect(r.hotReload).toBe(false)
    expect(r.scaleFriendly).toBe(true)
    expect(r.consistency).toBe(true)
  })

  it('四个场景 cell 全覆盖 · vectors 与 trilemma 同源', () => {
    const s = springConfigStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(SPRING_CONFIG_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.hotReload)}${Number(row.trilemma.scaleFriendly)}${Number(row.trilemma.consistency)}`)
    }
  })

  it('默认向量 110/101/011 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = springConfigStudy({ now: () => 547000 })
    expect(s.vectors).toEqual({ GitBackend: '110', NativeBackend: '101', RedisBackend: '011' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(547000)
  })

  it('rigged 三路（freeHotReload / freeScale / freeConsistency）全部坍缩为 111，noUniversalWinner=false', () => {
    const rig = springConfigStudy({ rigged: true, now: () => 547000 })
    expect(rig.vectors).toEqual({ GitBackend: '111', NativeBackend: '111', RedisBackend: '111' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.noStrategyWinsAll).toBe(false)
    expect(rig.verdict.vectorFromTrilemma).toBe(true)
  })

  it('单旗 rigged：仅 freeConsistency 时只坍缩 GitBackend', () => {
    const s = springConfigStudy({ freeConsistency: true, now: () => 547000 })
    expect(s.vectors.GitBackend).toBe('111')
    expect(s.vectors.NativeBackend).toBe('101')
    expect(s.vectors.RedisBackend).toBe('011')
  })

  it('单旗 rigged：仅 freeScale 时只坍缩 NativeBackend', () => {
    const s = springConfigStudy({ freeScale: true, now: () => 547000 })
    expect(s.vectors.NativeBackend).toBe('111')
    expect(s.vectors.GitBackend).toBe('110')
    expect(s.vectors.RedisBackend).toBe('011')
  })

  it('单旗 rigged：仅 freeHotReload 时只坍缩 RedisBackend', () => {
    const s = springConfigStudy({ freeHotReload: true, now: () => 547000 })
    expect(s.vectors.RedisBackend).toBe('111')
    expect(s.vectors.GitBackend).toBe('110')
    expect(s.vectors.NativeBackend).toBe('101')
  })

  it('三因果锁全 hold（causalLocksAllHold=true）', () => {
    const r = verifyCausalLocks({ seed: 547 })
    expect(r.gitCommitLagCausallyUnerasable).toBe(true)
    expect(r.nativeHostAffinityCausallyUnerasable).toBe(true)
    expect(r.redisHotRttCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifySpringConfigSoundness：holds=true / nontrivial=true / falsifiable · 三路篡改真喂回 holds=false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'cf:' + i, key: 'app.name', op: i % 3 === 0 ? 'get' : 'set', version: 1 + Math.floor(i / 3) }))
    const r = verifySpringConfigSoundness({ events, seed: 547, messages: 96 }, { seed: 547 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.gitProcessed).toBe(96)
    expect(r.laneB.redisDelivered).toBe(96)
    expect(r.laneB.subscribers).toBe(3)
    expect(r.tamper.gitStaleCache.holds).toBe(false)
    expect(r.tamper.redisNotifyLoss.holds).toBe(false)
    expect(r.tamper.busEventStorm.holds).toBe(false)
  })

  it('空 events → holds=false / nontrivial=false（0=0 不可当证明）', () => {
    const r = verifySpringConfigSoundness({ events: [], seed: 547 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('springConfigSnapshot：快照一致性 + null/{} 返回 null', () => {
    const s = springConfigStudy({ now: () => 547000 })
    const snap = springConfigSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(springConfigSnapshot(null as never)).toBe(null)
    expect(springConfigSnapshot({} as never)).toBe(null)
  })

  it('createSpringConfigEvidence：21 个证据键 + 关键 API 真跑过', () => {
    const ev = createSpringConfigEvidence({ seed: 547, now: () => 547000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.remapConsistentRate).toBeGreaterThan(0)
    expect(ev.remapModuloRate).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence=21 键 + soundness holds + study.causalLocks allHold', () => {
    const s = springConfigStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('configDrift 场景含 drift 标记的 set 事件（副本 lag 窗口可观察）', () => {
    const s = springConfigStudy({})
    const row = s.rows.find((r) => r.protocol === 'GitBackend')!
    const drift = row.scenarios.find((c) => c.id === 'configDrift')!
    expect(drift.fault).toBe('drift')
    expect(drift.processed).toBe(drift.messages)
  })
})
