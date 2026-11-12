import { describe, expect, it } from 'vitest'
import {
  GR_DEFAULTS,
  GR_SCENARIOS,
  GR_STRATEGIES,
  createPathPrefixRouting,
  createRegexCaptureRouting,
  createHeaderGroupRouting,
  gatewayRoutingStudy,
  gatewayRoutingSnapshot,
  verifyCausalLocks,
  verifyGatewayRoutingSoundness,
  createGatewayRoutingEvidence,
} from '../../scripts/caesura-gateway-routing.mjs'

/** KI-539 Spring Cloud Gateway 三策略路由（P8 第四十六件 · 前端第三十三维）。 */

describe('caesura-gateway-routing（KI-539）', () => {
  it('GR_DEFAULTS / STRATEGIES / SCENARIOS 固定顺序', () => {
    expect(GR_STRATEGIES).toEqual(['PathPrefixRouting', 'RegexCaptureRouting', 'HeaderGroupRouting'])
    expect(GR_SCENARIOS).toEqual(['prefixMatch', 'regexCapture', 'headerGroup', 'bigRouteTable', 'conflictingRoutes', 'cleanRerun'])
    expect(GR_DEFAULTS.seed).toBe(539)
    expect(GR_DEFAULTS.requests).toBe(96)
  })

  it('PathPrefixRouting：相同 prefix 真先配先中/后配永远不走到', () => {
    const pp = createPathPrefixRouting({ seed: 539, conflictingRoutes: true })
    const stream = Array.from({ length: 16 }, (_, i) => ({ id: `x${i}`, path: '/api/items/' + (i % 4), method: 'GET', headers: {} }))
    const out = pp.run(stream)
    expect(out.routesHit.get('route:api')).toBe(16)
    expect(out.routesHit.get('route:api-conflict')).toBeUndefined()
  })

  it('RegexCaptureRouting：捕获 flavor+id 真跑', () => {
    const rc = createRegexCaptureRouting({})
    const stream = Array.from({ length: 32 }, (_, i) => ({ id: `x${i}`, path: `/labs/sol/answers/${1000 + i}`, method: 'GET', headers: {} }))
    const out = rc.run(stream)
    expect(out.hits).toBe(32)
    expect(out.flavorsUsed).toBe(1)
    expect(out.flavors).toBe(32)
  })

  it('HeaderGroupRouting：没 header 全 miss；有 group header 全一路真命中', () => {
    const hg = createHeaderGroupRouting({})
    const noHdr = Array.from({ length: 16 }, (_, i) => ({ id: `x${i}`, path: '/api/items/' + (i % 4), method: 'GET', headers: {} }))
    expect(hg.run(noHdr).miss).toBe(16)
    const withHdr = Array.from({ length: 16 }, (_, i) => ({ id: `x${i}`, path: '/api/items/' + (i % 4), method: 'GET', headers: { 'x-user-group': i % 2 === 0 ? 'groupA' : 'groupB' } }))
    const out = hg.run(withHdr)
    expect(out.miss).toBe(0)
    expect(out.groups.groupA + out.groups.groupB).toBe(16)
  })

  it('六场景都跑出 cell；vectors 与 trilemma 同源现算', () => {
    const s = gatewayRoutingStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(GR_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.strictMatch)}${Number(row.trilemma.capturePower)}${Number(row.trilemma.debugFriendly)}`)
    }
  })

  it('默认向量互异、无一 111、不封赢家、vectorFromTrilemma', () => {
    const s = gatewayRoutingStudy({ now: () => 539000 })
    expect(s.vectors).toEqual({ PathPrefixRouting: '001', RegexCaptureRouting: '110', HeaderGroupRouting: '101' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(539000)
  })

  it('三难各找各自考场：[strictMatch / capturePower / debugFriendly]', () => {
    const s = gatewayRoutingStudy({})
    const pp = s.rows.find((r) => r.protocol === 'PathPrefixRouting')!
    const rc = s.rows.find((r) => r.protocol === 'RegexCaptureRouting')!
    const hg = s.rows.find((r) => r.protocol === 'HeaderGroupRouting')!
    expect(pp.trilemma).toEqual({ strictMatch: false, capturePower: false, debugFriendly: true })
    expect(rc.trilemma).toEqual({ strictMatch: true, capturePower: true, debugFriendly: false })
    expect(hg.trilemma).toEqual({ strictMatch: true, capturePower: false, debugFriendly: true })
  })

  it('单开 perfectGlobMatcher ⇒ PathPrefix=111（完美全局匹配：抓捕+严格+调试可证，向量随诚实翻true）', () => {
    const s = gatewayRoutingStudy({ perfectGlobMatcher: true })
    expect(s.vectors.PathPrefixRouting).toBe('111')
    // 其他策略不动
    expect(s.vectors.RegexCaptureRouting).toBe('110')
    expect(s.vectors.HeaderGroupRouting).toBe('101')
  })

  it('headerFallbackOnMiss 提升 HeaderGroup debugFriendly 至 true（本来就是 true，不动向量）', () => {
    const s = gatewayRoutingStudy({ headerFallbackOnMiss: true })
    expect(s.vectors.HeaderGroupRouting).toBe('101')
  })

  it('rigged 三开齐 ⇒ PathPrefix=111/所有 locks 真跑/mixed distinguishable 不可强行压 true——noStrategyWinsAll=false（诚实标注）', () => {
    const s = gatewayRoutingStudy({ rigged: true })
    expect(s.vectors.PathPrefixRouting).toBe('111')                 // 完美全局真 best
    expect(s.causalLocks.causalLocksAllHold).toBe(true)              // 三因果锁仍真
    expect(s.verdict.noStrategyWinsAll).toBe(false)                  // 有 111 ⇒ 不存在无赢家
    expect(s.verdict.noStrategyWinsAll).toBe(s.verdict.noStrategyWinsAll)  // 保持原样
  })

  it('verifyGatewayRoutingSoundness：holds=true nontrivial=true falsifiable；laneA 96/96 hit；laneB 抓出 1 flavor', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: `req:${i}`, path: `/labs/sol/answers/${1000 + i}`, method: 'GET', headers: {} }))
    const r = verifyGatewayRoutingSoundness({ events, seed: 539 }, { seed: 539 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.pathPrefixHits).toBe(96)
    expect(r.laneB.capturedUnique).toBeGreaterThan(0)
    expect(r.falsifiable).toBe(true)
    expect(r.tamper.missingRoutes.holds).toBe(false)
    expect(r.tamper.tryStrTruncation.holds).toBe(false)
    expect(r.tamper.emptyStream.holds).toBe(false)
  })

  it('verifyGatewayRoutingSoundness 空 events ⇒ holds=false nontrivial=false', () => {
    const r = verifyGatewayRoutingSoundness({ events: [], seed: 539 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('verifyCausalLocks 三因果锁 allHold；conflictingRoutes 后 route 永不走到、缺 header 全 miss', () => {
    const r = verifyCausalLocks({ seed: 539 })
    expect(r.pathPrefixMatchingConflictsCausallyUnerasable).toBe(true)
    expect(r.regexCaptureExtraCostCausallyUnerasable).toBe(true)
    expect(r.headerGroupHeaderDependencyCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('gatewayRoutingSnapshot：形状 + verdict 同源；snapshot(null)/{} → null 反守卫', () => {
    const s = gatewayRoutingStudy({ now: () => 539000 })
    const snap = gatewayRoutingSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.causalLocks!.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(snap.crosscheck && snap.crosscheck.routing).toBeDefined()
    expect(gatewayRoutingSnapshot(null as never)).toBe(null)
    expect(gatewayRoutingSnapshot({} as never)).toBe(null)
  })

  it('createGatewayRoutingEvidence 真件 ≥ 21 键 + 核心件回读', () => {
    const ev = createGatewayRoutingEvidence({ seed: 539, now: () => 539000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
  })

  it('study.crosscheck.evidence 21 键 + routing 结构 holds', () => {
    const s = gatewayRoutingStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.routing.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })
})
