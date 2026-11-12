import { describe, expect, it } from 'vitest'
import {
  SESSION_DEFAULTS,
  SESSION_SCENARIOS,
  SESSION_STRATEGIES,
  createJwtStatelessGuard,
  createRedisSessionStore,
  createStickySessionStore,
  distributedSessionStudy,
  distributedSessionSnapshot,
  verifyCausalLocks,
  verifySessionCoherence,
  createSessionEvidence,
} from '../../scripts/caesura-distributed-session.mjs'

/** KI-535 分布式会话三策略（P8 第四十二件 · Spring Cloud 微服务会话持久化一线）。 */

describe('caesura-distributed-session（KI-535）', () => {
  it('SESSION_DEFAULTS / STRATEGIES / SCENARIOS 固定顺序', () => {
    expect(SESSION_STRATEGIES).toEqual(['StickySession', 'JwtStateless', 'RedisSessionStore'])
    expect(SESSION_SCENARIOS).toEqual(['cleanServe', 'instanceFailover', 'revokeLive', 'burstScaleOut', 'idleExpiry', 'mixedLoad'])
    expect(SESSION_DEFAULTS.seed).toBe(535)
    expect(SESSION_DEFAULTS.sessions).toBe(96)
    expect(SESSION_DEFAULTS.ttlMs).toBe(30000)
  })

  it('StickySession：同实例可读、跨节点不通、revoke 本地即时、crashNode 后真丢', () => {
    const store = createStickySessionStore({})
    store.write(0, { id: 'sess:a', owner: 0, counter: 1 })
    expect(store.read(0, 'sess:a')).not.toBe(null)
    expect(store.read(1, 'sess:a')).toBe(null)
    store.crashNode(0)
    expect(store.read(0, 'sess:a')).toBe(null)
  })

  it('StickySession：perfectMirror ⇒ 任意实例兜底读到残影（coherence=true）', () => {
    const store = createStickySessionStore({ perfectMirror: true })
    store.write(0, { id: 'sess:b', owner: 0, counter: 2 })
    expect(store.read(2, 'sess:b')).not.toBe(null)
  })

  it('JwtStateless：任一持钥节点验签即认（coherence），但 revoke 不即时（skipRevocationCheck=false）', () => {
    const g = createJwtStatelessGuard({})
    g.issue({ id: 'sess:c', owner: 0, counter: 3 }, 0)
    expect(g.verify('jwt.sess:c', 0).ok).toBe(true)
    const r = g.revoke('jwt.sess:c')
    expect(r.scope).toBe('no-op')
    // 撤销后仍能验过（真语义：未过期签名有效）
    expect(g.verify('jwt.sess:c', 0).ok).toBe(true)
  })

  it('JwtStateless：skipRevocationCheck=true ⇒ revoke 短路生效（rigged）', () => {
    const g = createJwtStatelessGuard({ skipRevocationCheck: true })
    g.issue({ id: 'sess:d', owner: 0, counter: 4 }, 0)
    const r = g.revoke('jwt.sess:d')
    expect(r.scope).toBe('cheat')
  })

  it('RedisSessionStore：集群可写可读、revoke 即 DEL、冷启动读恒 null', () => {
    const fresh = createRedisSessionStore({})
    expect(fresh.read('sess:nothing')).toBe(null)
    const store = createRedisSessionStore({})
    store.set({ id: 'sess:e', owner: 0, counter: 5 })
    expect(store.read('sess:e')).not.toBe(null)
    store.revoke('sess:e')
    expect(store.read('sess:e')).toBe(null)
  })

  it('六场景都跑出 cell；vectors 与 trilemma 同源现算', () => {
    const s = distributedSessionStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(SESSION_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.sharedCoherence)}${Number(row.trilemma.instantRevocation)}${Number(row.trilemma.zeroInfra)}`)
    }
  })

  it('默认向量互异、无一 111、不封赢家、vectorFromTrilemma', () => {
    const s = distributedSessionStudy({ now: () => 535000 })
    expect(s.vectors).toEqual({ StickySession: '011', JwtStateless: '101', RedisSessionStore: '110' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(535000)
  })

  it('三难各找各自考场：Session 维序 [sharedCoherence / instantRevocation / zeroInfra]', () => {
    const s = distributedSessionStudy({})
    const sticky = s.rows.find((r) => r.protocol === 'StickySession')!
    const jwt = s.rows.find((r) => r.protocol === 'JwtStateless')!
    const redis = s.rows.find((r) => r.protocol === 'RedisSessionStore')!
    expect(sticky.trilemma).toEqual({ sharedCoherence: false, instantRevocation: true, zeroInfra: true })
    expect(jwt.trilemma).toEqual({ sharedCoherence: true, instantRevocation: false, zeroInfra: true })
    expect(redis.trilemma).toEqual({ sharedCoherence: true, instantRevocation: true, zeroInfra: false })
  })

  it('单开 perfectMirror ⇒ Sticky=111（coherence 被救回），其余不动', () => {
    const s = distributedSessionStudy({ perfectMirror: true })
    expect(s.rows.find((r) => r.protocol === 'StickySession')!.trilemma).toEqual({ sharedCoherence: true, instantRevocation: true, zeroInfra: true })
    expect(s.rows.find((r) => r.protocol === 'RedisSessionStore')!.trilemma.zeroInfra).toBe(false)
  })

  it('单开 skipRevocationCheck ⇒ JWT=111，SF=Sticky/Redis 不变', () => {
    const s = distributedSessionStudy({ skipRevocationCheck: true })
    expect(s.rows.find((r) => r.protocol === 'JwtStateless')!.trilemma).toEqual({ sharedCoherence: true, instantRevocation: true, zeroInfra: true })
    expect(s.rows.find((r) => r.protocol === 'StickySession')!.trilemma.sharedCoherence).toBe(false)
  })

  it('unlimitedTtl 不创 rev 可见性：JWT revoke 仍 false', () => {
    const s = distributedSessionStudy({ unlimitedTtl: true })
    expect(s.rows.find((r) => r.protocol === 'JwtStateless')!.trilemma.instantRevocation).toBe(false)
  })

  it('rigged 三开齐 ⇒ Sticky/JWT 坍缩 111、区分度塌缩（诚实硬造、明示）', () => {
    const s = distributedSessionStudy({ rigged: true })
    expect(s.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(s.verdict.noUniversalWinner).toBe(false)
    expect(s.vectors.StickySession).toBe('111')
    expect(s.vectors.JwtStateless).toBe('111')
    expect(s.vectors.RedisSessionStore).toBe('110')
    expect(s.verdict.vectorFromTrilemma).toBe(true)
  })

  it('verifySessionCoherence：holds=true nontrivial=true falsifiable=true；laneA 三读皆满，laneB jwtStillValid=true', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({
      id: `sess:535:${i}`, owner: i % 3, counter: (i + 1) * 3, revoked: i % 32 === 7,
    }))
    const r = verifySessionCoherence({ events, seed: 535 }, { seed: 535 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.redisReadable).toBe(events.length - 3)
    expect(r.laneA.jwtVerified).toBe(events.length - 3)
    expect(r.laneB.jwtStillValid).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.tamper.corruptedSession.holds).toBe(false)
    expect(r.tamper.silentRevoke.holds).toBe(false)
    expect(r.tamper.emptyStream.holds).toBe(false)
  })

  it('verifySessionCoherence 空会话流 ⇒ holds=false nontrivial=false（绝不 0=0 假绿）', () => {
    const r = verifySessionCoherence({ events: [], seed: 535 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('verifyCausalLocks：Sticky 单节点可丢 / JWT 撤销不即时 / Redis 冷启动读 null；allHold=true', () => {
    const r = verifyCausalLocks({ seed: 535 })
    expect(r.stickySingleNodeCausallyUnerasable).toBe(true)
    expect(r.jwtNoInstantRevokeCausallyUnerasable).toBe(true)
    expect(r.redisColdStartCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
    expect(r.revocationProbe).toBeGreaterThan(0)
  })

  it('distributedSessionSnapshot：形状 + verdict 同源；snapshot(null)/{} → null 反守卫', () => {
    const s = distributedSessionStudy({ now: () => 535000 })
    const snap = distributedSessionSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.causalLocks!.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(distributedSessionSnapshot(null as never)).toBe(null)
    expect(distributedSessionSnapshot({} as never)).toBe(null)
  })

  it('createSessionEvidence 真件 ≥ 21 键 + 核心件回读', () => {
    const ev = createSessionEvidence({ seed: 535, now: () => 535000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
  })

  it('study.crosscheck.evidence 21 键 + coherence 结构', () => {
    const s = distributedSessionStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.coherence.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
