import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildSnapshot,
  realScenarioOpts,
  normalizeScenario,
  cwndSeries,
  driveNetSeries,
  deriveHighlights,
  buildSystems,
  SCENARIO_IDS,
  SCENARIO_TITLES,
} from '../../scripts/caesura-console-gen.mjs'

/** 确定性假 runner：按场景 id 吐固定判词，形状与真 runMeshE2E 一致。 */
function fakeRunner(overrides: Record<string, any> = {}) {
  const verdicts: Record<string, any> = {
    main: {
      started: { registered: true }, callRes: { ok: true },
      services: ['svc-a', 'caesura-gate', 'caesura-game'], spans: [{ traceId: 'a'.repeat(32) }],
      events: [{ type: 'game.started' }, { type: 'game.stopped' }], stopped: { registered: false },
    },
    gray: {
      started: { registered: true },
      grayProbes: [
        { key: 'v2-u', lane: 'canary', fallback: false, canaryPercent: 50, ok: true, instanceId: 'can:1' },
        { key: 'stable-u', lane: 'primary', fallback: false, canaryPercent: 50, ok: true, instanceId: 'stable:1' },
      ],
      grayStats: { decisions: 2, canary: 1, primary: 1, fallback: 0, noInstance: 0, droppedUnhealthy: 0 },
    },
    resilience: {
      started: { registered: true }, callRes: { ok: false, error: new Error('time_limiter_timeout') },
      filterStats: { retries: 2, rateLimited: 0, passed: 1, bulkheadRejected: 1, bulkheadHeld: 1, timedOut: 1 },
    },
    cache: {
      started: { registered: true },
      cacheProbe: { firstSource: 'introspection', secondSource: 'cache', secondCacheHit: true, stats: { hits: 1, misses: 1, hitRate: 0.5, bytes: 330, entries: 1 } },
    },
    net: {
      started: { registered: true },
      netSnapshot: {
        observes: 1,
        aimd: { cwnd: 2, ssthresh: 16, mode: 'slow-start', history: [{ event: 'init', cwnd: 1, mode: 'slow-start' }, { event: 'ack', cwnd: 2, mode: 'slow-start' }] },
        cubic: { cwnd: 15.6, Wmax: 16, K: 2 },
        rto: { srtt: 7, rttvar: 3.5, rto: 200, ignoredSamples: 0 },
        window: { windowSize: 4, inFlight: 0, sends: 1, blocked: 0 },
      },
    },
    ...overrides,
  }
  const gcFor = (id: string) => id === 'net' ? { net: { aimd: makeAimdLike() } } : {}
  return (id: string) => ({ run: async () => verdicts[id], gc: gcFor(id) })
}

function makeAimdLike() {
  let cwnd = 1
  const history: any[] = [{ event: 'init', cwnd: 1, mode: 'slow-start' }]
  return {
    onAck() { cwnd += 1; history.push({ event: 'ack', cwnd, mode: 'slow-start' }); return cwnd },
    onTimeout() { cwnd = 1; history.push({ event: 'timeout', cwnd, mode: 'slow-start' }) },
    onDupAck() { cwnd = Math.max(1, cwnd / 2); history.push({ event: 'fast-retransmit', cwnd, mode: 'congestion-avoidance' }) },
    state() { return { cwnd, ssthresh: 16, mode: 'slow-start', history } },
  }
}

describe('caesura-console-gen (KI-495)', () => {
  it('① 场景顺序与标题固定（前端按此排布，判词口径由本件拥有）', () => {
    expect(SCENARIO_IDS).toEqual(['main', 'gray', 'resilience', 'cache', 'net'])
    for (const id of SCENARIO_IDS) expect(SCENARIO_TITLES[id]).toBeTruthy()
  })

  it('② buildSnapshot 注入确定性 runner ⇒ 五场景全覆盖、schema/generator/generatedAt 齐', async () => {
    const snap = await buildSnapshot({ runner: fakeRunner(), now: () => 1_700_000_000_000, driveNet: false })
    expect(snap.schema).toBe(1)
    expect(snap.generator).toBe('caesura-console-gen')
    expect(snap.generatedAt).toBe(1_700_000_000_000)
    expect(snap.scenarios.map((s) => s.id)).toEqual(SCENARIO_IDS)
    expect(snap.scenarios.every((s) => s.ok === true)).toBe(true)
    expect(snap.highlights).toBeTruthy()
  })

  it('③ highlight 派生自真判词（不是写死的数）', async () => {
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false })
    expect(snap.highlights).toMatchObject({
      services: 3, spanCount: 1, canaryHits: 1, cacheHitRate: 0.5, timedOut: 1, cwnd: 2, rto: 200,
    })
    // 改一份判词 ⇒ highlight 跟着变（证它真从 scenarios 算）。
    const snap2 = await buildSnapshot({ runner: fakeRunner({ main: { started: { registered: true }, callRes: { ok: true }, services: ['a', 'b', 'c', 'd'], spans: [], events: [], stopped: {} } }), driveNet: false })
    expect(snap2.highlights.services).toBe(4)
    expect(snap2.highlights.spanCount).toBe(0)
  })

  it('④ driveNetSeries 用真 AIMD 实例喂出锯齿（爬升→超时乘性减→再爬）', () => {
    const net = { aimd: makeAimdLike() }
    const st = driveNetSeries(net)
    expect(st.history.length).toBeGreaterThan(20)
    const cwnds = st.history.map((h: any) => h.cwnd)
    expect(Math.max(...cwnds)).toBeGreaterThan(5) // 慢启动指数爬
    expect(cwnds).toContain(1) // 超时回 1
    expect(st.history.some((h: any) => h.event === 'timeout')).toBe(true)
    expect(st.history.some((h: any) => h.event === 'fast-retransmit')).toBe(true)
  })

  it('⑤ buildSnapshot driveNet=true 时 net.series 是加长的真算法轨迹', async () => {
    const snap = await buildSnapshot({ runner: fakeRunner(), now: () => 1 })
    const net = snap.scenarios.find((s) => s.id === 'net')!
    expect(net.series.length).toBeGreaterThan(20) // 主链 2 点 + driveNetSeries
    expect(net.series[0].cwnd).toBe(1)
    expect(net.series.some((p: any) => p.event === 'timeout')).toBe(true)
  })

  it('⑥ cwndSeries / normalize 对缺字段诚实降级：给 null 不编造', () => {
    expect(cwndSeries(undefined)).toEqual([])
    expect(cwndSeries(null)).toEqual([])
    const s = normalizeScenario('net', null, { started: { registered: true }, netSnapshot: null })
    expect(s.aimd.cwnd).toBe(null)
    expect(s.series).toEqual([])
    const c = normalizeScenario('cache', null, { started: { registered: true }, cacheProbe: null, authCacheStats: null })
    expect(c.secondSource).toBe(null)
    expect(c.stats.hitRate).toBe(null)
  })

  it('⑦ realScenarioOpts 每场景给出可跑的 opts（含失败面/缓存/计网的注入）', () => {
    expect(typeof realScenarioOpts('main').transport).toBe('function')
    const gray = realScenarioOpts('gray')
    expect(gray.grayInstances).toHaveLength(2)
    expect(gray.grayProbes.length).toBeGreaterThan(0)
    const res = realScenarioOpts('resilience')
    expect(res.filters.map((f: any) => f.name)).toEqual(['Bulkhead', 'TimeLimiter'])
    const cache = realScenarioOpts('cache')
    expect(cache.authCache).toBe(true)
    expect(cache.cacheProbe).toBeTruthy()
    expect(realScenarioOpts('net').net).toBe(true)
  })

  it('⑧ 真跑一趟 buildSnapshot（真 E2E）⇒ 五场景 ok、亮起来的是真读数', async () => {
    const snap = await buildSnapshot()
    expect(snap.scenarios.map((s) => s.id)).toEqual(SCENARIO_IDS)
    // 每个场景的 started.registered 都真为 true（真 E2E 都跑通）。
    expect(snap.scenarios.every((s) => s.ok)).toBe(true)
    const main = snap.scenarios.find((s) => s.id === 'main')!
    expect(main.callOk).toBe(true)
    expect(main.services).toContain('caesura-game')
    const cache = snap.scenarios.find((s) => s.id === 'cache')!
    expect(cache).toMatchObject({ firstSource: 'introspection', secondSource: 'cache', secondCacheHit: true })
    const resilience = snap.scenarios.find((s) => s.id === 'resilience')!
    expect(resilience.stats.timedOut).toBe(1)
  })

  it('⑨ 已提交的 snapshot.json 是真快照、形状与生成器一致、能喂前端', () => {
    const p = resolve(process.cwd(), 'console/snapshot.json')
    expect(existsSync(p)).toBe(true)
    const snap = JSON.parse(readFileSync(p, 'utf8'))
    expect(snap.schema).toBe(1)
    expect(snap.scenarios.map((s: any) => s.id)).toEqual(SCENARIO_IDS)
    expect(typeof snap.generatedAt).toBe('number')
    expect(snap.highlights).toBeTruthy()
    // JSON 里不残留 Error 对象/函数（都是可序列化纯数据）。
    expect(() => JSON.stringify(snap)).not.toThrow()
  })

  it('⑩ deriveHighlights 是 buildSnapshot 的唯一读数口径：逐字一致 + 空场景全 null', async () => {
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false })
    // buildSnapshot 内部正是 deriveHighlights(scenarios)；直接调用必须逐字相等，杜绝两套口径。
    expect(deriveHighlights(snap.scenarios)).toEqual(snap.highlights)
    // 空场景不编造：八个读数全部降级为 null，不吐 0 或假数。
    expect(deriveHighlights([])).toEqual({
      services: null, spanCount: null, canaryHits: null, cacheHitRate: null,
      timedOut: null, cwnd: null, rto: null,
    })
  })

  it('⑪ buildSystems 真跑 LSM + OS/硬件 + 缓存防护 + 网关限流 + 故障检测五维：形状齐、读数是真判词且有界（KI-498 / KI-501 / KI-502 / KI-503）', async () => {
    const sys = await buildSystems({ now: () => 1234, lsmKeys: 256, poolAccesses: 500, layoutCount: 1000, guardConcurrency: 16, guardKeys: 64 })
    expect(sys.builtAt).toBe(1234)
    // LSM：真跑 256 key，flush/compact/speedup 都是算法计数、speedup>1。
    expect(sys.lsm).toMatchObject({ keys: 256 })
    expect(sys.lsm!.flushes).toBeGreaterThan(0)
    expect(sys.lsm!.compactions).toBeGreaterThan(0)
    expect(sys.lsm!.tombstonesDropped).toBeGreaterThan(0)
    expect(sys.lsm!.speedup).toBeGreaterThan(1)
    expect(sys.lsm!.levels.every((l) => l.level >= 0 && l.segments >= 0)).toBe(true)
    // HW：对象池省分配、padding 假共享 0 vs packed>0、布局顺序 speedup>1 / 跳跃≈1。
    expect(sys.hw!.allocation).toMatchObject({ accesses: 500, naiveCreated: 500, poolCreated: 1 })
    expect(sys.hw!.allocation.saved).toBe(499)
    expect(sys.hw!.cacheLine.paddedFalseSharing).toBe(0)
    expect(sys.hw!.cacheLine.packedFalseSharing).toBeGreaterThan(0)
    expect(sys.hw!.layout.sequential.speedup).toBeGreaterThan(1)
    expect(sys.hw!.layout.strided.speedup).toBeCloseTo(1, 1)
    // Guards：击穿 singleflight 合并、穿透布隆省回源、雪崩抖动削峰，都是真判词。
    expect(sys.guards!.stampede.concurrency).toBe(16)
    expect(sys.guards!.stampede.singleflightLoads).toBe(1)
    expect(sys.guards!.stampede.savedLoads).toBe(15)
    expect(sys.guards!.penetration.bloomDbHits).toBeLessThan(sys.guards!.penetration.naiveDbHits)
    expect(sys.guards!.avalanche.jitterPeak).toBeLessThan(sys.guards!.avalanche.uniformPeak)
    expect(sys.guards!.avalanche.peakReduction).toBeGreaterThan(0)
    // RateLimit：五算法突发对照（固定窗口 2×、其余 1×）+ Redis 原子不超发/非原子超发/共享一致。
    expect(sys.rateLimit!.limit).toBeGreaterThan(1)
    expect(Object.keys(sys.rateLimit!.strategies)).toEqual(['fixedWindow', 'slidingLog', 'slidingCounter', 'tokenBucket', 'leakyBucket'])
    expect(sys.rateLimit!.strategies.fixedWindow.burstRatio).toBe(2)
    expect(sys.rateLimit!.strategies.slidingLog.burstRatio).toBe(1)
    expect(sys.rateLimit!.strategies.slidingCounter.memory).toBe('O(1)')
    expect(sys.rateLimit!.strategies.slidingLog.memory).toBe('O(n)')
    expect(sys.rateLimit!.verdict.fixedWindowBurst).toBe(true)
    expect(sys.rateLimit!.redis.atomicAllowed).toBeLessThanOrEqual(sys.rateLimit!.redis.capacity)
    expect(sys.rateLimit!.redis.nonAtomicAllowed).toBeGreaterThan(sys.rateLimit!.redis.capacity)
    expect(sys.rateLimit!.redis.overshoot).toBeGreaterThan(0)
    expect(sys.rateLimit!.redis.shared.consistent).toBe(true)
    // FailureDetector：固定超时抖动期误报多 / φ 降误报但真故障检测更慢 / SWIM 间接救回 / 健康视图首算。
    expect(sys.failureDetector!.fixed.falsePositives).toBeGreaterThan(sys.failureDetector!.phi.falsePositives)
    expect(sys.failureDetector!.phi.falsePositives).toBe(0)
    expect(sys.failureDetector!.verdict.bothDetectRealFailure).toBe(true)
    expect(sys.failureDetector!.verdict.fixedFasterButNoisier).toBe(true)
    expect(sys.failureDetector!.verdict.phiAdaptiveToHistory).toBe(true)
    expect(sys.failureDetector!.curve.length).toBeGreaterThan(10)
    expect(sys.failureDetector!.curve.every((p) => typeof p.phi === 'number' && p.phi >= 0)).toBe(true)
    expect(sys.failureDetector!.swim.script.indirectRescued).toBe(true)
    expect(sys.failureDetector!.swim.script.gossipRefuted).toBe(true)
    expect(sys.failureDetector!.health.nodes).toContain('gate-a')
    expect(sys.failureDetector!.health.excluded).toContain('gate-c')
    expect(sys.failureDetector!.health.firstFromCache).toBe(false)
    expect(sys.failureDetector!.health.secondFromCache).toBe(true)
    expect(sys.failureDetector!.health.thirdFromCache).toBe(false)
    // 可序列化纯数据、不含函数/Error。
    expect(() => JSON.stringify(sys)).not.toThrow()
  })

  it('⑫ buildSnapshot 默认带 systems 块；systems:false 关闭为 null（兼容旧快照/确定性单测）', async () => {
    const withSys = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, lsmKeys: 64, poolAccesses: 100, layoutCount: 200 })
    expect(withSys.systems).toBeTruthy()
    expect(withSys.systems!.lsm).toBeTruthy()
    expect(withSys.systems!.hw).toBeTruthy()
    expect(withSys.systems!.guards).toBeTruthy() // KI-501 第三维默认也在
    expect(withSys.systems!.rateLimit).toBeTruthy() // KI-502 第四维默认也在
    expect(withSys.systems!.failureDetector).toBeTruthy() // KI-503 第五维默认也在
    expect(withSys.systems!.bplusIndex).toBeTruthy() // KI-504 第六维默认也在
    expect(withSys.scenarios.map((s) => s.id)).toEqual(SCENARIO_IDS) // 五场景顺序不变
    // guards:false 可单独关掉缓存防护维，其余四维仍在（不连坐）。
    const noGuards = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, guards: false })
    expect(noGuards.systems!.guards).toBe(null)
    expect(noGuards.systems!.lsm).toBeTruthy()
    expect(noGuards.systems!.rateLimit).toBeTruthy()
    expect(noGuards.systems!.failureDetector).toBeTruthy()
    // rateLimit:false 可单独关掉网关限流维，其余四维仍在（不连坐）。
    const noRl = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, rateLimit: false })
    expect(noRl.systems!.rateLimit).toBe(null)
    expect(noRl.systems!.guards).toBeTruthy()
    expect(noRl.systems!.lsm).toBeTruthy()
    expect(noRl.systems!.failureDetector).toBeTruthy()
    // failureDetector:false 可单独关掉故障检测维，其余五维仍在（不连坐）。
    const noFd = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, failureDetector: false })
    expect(noFd.systems!.failureDetector).toBe(null)
    expect(noFd.systems!.lsm).toBeTruthy()
    expect(noFd.systems!.rateLimit).toBeTruthy()
    expect(noFd.systems!.bplusIndex).toBeTruthy()
    // bplusIndex:false 可单独关掉 B+ 树索引维，其余五维仍在（不连坐）。
    const noBp = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, bplusIndex: false })
    expect(noBp.systems!.bplusIndex).toBe(null)
    expect(noBp.systems!.lsm).toBeTruthy()
    expect(noBp.systems!.failureDetector).toBeTruthy()
    expect(noBp.systems!.rateLimit).toBeTruthy()
    // mvccTxn:false 可单独关掉事务并发控制维，其余六维仍在（不连坐）。
    const noMv = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, mvccTxn: false })
    expect(noMv.systems!.mvccTxn).toBe(null)
    expect(noMv.systems!.lsm).toBeTruthy()
    expect(noMv.systems!.bplusIndex).toBeTruthy()
    expect(noMv.systems!.failureDetector).toBeTruthy()
    const without = await buildSnapshot({ runner: fakeRunner(), driveNet: false, systems: false })
    expect(without.systems).toBe(null)
    expect(without.highlights).toBeTruthy() // 既有口径不受影响
  })

  it('⑬ 已提交 snapshot.json 带真 systems 块、与 bootstrap 同源、可喂前端', () => {
    const snap = JSON.parse(readFileSync(resolve(process.cwd(), 'console/snapshot.json'), 'utf8'))
    expect(snap.systems).toBeTruthy()
    expect(snap.systems.lsm.speedup).toBeGreaterThan(1)
    expect(snap.systems.lsm.flushes).toBeGreaterThan(0)
    expect(snap.systems.hw.allocation.saved).toBeGreaterThan(0)
    expect(snap.systems.hw.cacheLine.paddedFalseSharing).toBe(0)
    expect(snap.systems.hw.layout.sequential.speedup).toBeGreaterThan(1)
    expect(typeof snap.systems.builtAt).toBe('number')
    // KI-501 guards：三件真读数已固化进快照。
    expect(snap.systems.guards.stampede.singleflightLoads).toBe(1)
    expect(snap.systems.guards.stampede.savedLoads).toBeGreaterThan(0)
    expect(snap.systems.guards.penetration.bloomDbHits).toBeLessThan(snap.systems.guards.penetration.naiveDbHits)
    expect(snap.systems.guards.avalanche.jitterPeak).toBeLessThan(snap.systems.guards.avalanche.uniformPeak)
    // KI-502 rateLimit：四件真读数已固化进快照。
    expect(snap.systems.rateLimit.strategies.fixedWindow.burstRatio).toBe(2)
    expect(snap.systems.rateLimit.strategies.slidingLog.burstRatio).toBe(1)
    expect(snap.systems.rateLimit.redis.atomicAllowed).toBeLessThanOrEqual(snap.systems.rateLimit.redis.capacity)
    expect(snap.systems.rateLimit.redis.nonAtomicAllowed).toBeGreaterThan(snap.systems.rateLimit.redis.capacity)
    expect(snap.systems.rateLimit.redis.shared.consistent).toBe(true)
    // KI-503 failureDetector：固定 vs φ 对照 + SWIM 三态 + 健康视图读数已固化进快照。
    expect(snap.systems.failureDetector.fixed.falsePositives).toBeGreaterThan(snap.systems.failureDetector.phi.falsePositives)
    expect(snap.systems.failureDetector.phi.falsePositives).toBe(0)
    expect(snap.systems.failureDetector.verdict.bothDetectRealFailure).toBe(true)
    expect(snap.systems.failureDetector.curve.length).toBeGreaterThan(10)
    expect(snap.systems.failureDetector.swim.script.indirectRescued).toBe(true)
    expect(snap.systems.failureDetector.health.nodes).toContain('gate-a')
    // KI-504 bplusIndex：真 B+ 树不变式 0 违例、与 LSM 答案一致、三笔账各自真读数已固化进快照。
    expect(snap.systems.bplusIndex.structure.invariants).toBe(0)
    expect(snap.systems.bplusIndex.structure.height).toBeGreaterThanOrEqual(2)
    expect(snap.systems.bplusIndex.agreement.bothAgree).toBe(true)
    expect(snap.systems.bplusIndex.point.bplusComparisons).toBeGreaterThan(0)
    expect(snap.systems.bplusIndex.range.lsmSortComparisons).toBeGreaterThan(0)
    expect(snap.systems.bplusIndex.write.lsmSeqWriteUnits).toBeGreaterThan(0)
    expect(snap.systems.bplusIndex.verdict.noUniversalWinner).toBe(true)
    expect(snap.systems.bplusIndex.structure.heightLadder.length).toBeGreaterThan(0)
    // KI-505 mvccTxn：五档隔离 × 五类异常矩阵 + 死锁环 + 2PL + gc 水位真读数已固化进快照。
    expect(snap.systems.mvccTxn.levels.length).toBe(5)
    expect(snap.systems.mvccTxn.config.anomalies.length).toBe(5)
    expect(snap.systems.mvccTxn.levels.find((l: any) => l.short === 'RU')!.observedCount).toBe(5)
    expect(snap.systems.mvccTxn.levels.find((l: any) => l.short === 'SI')!.anomalies.writeSkew.observed).toBe(true)
    expect(snap.systems.mvccTxn.levels.find((l: any) => l.short === 'SER')!.observedCount).toBe(0)
    expect(snap.systems.mvccTxn.deadlock.detected).toBe(true)
    expect(snap.systems.mvccTxn.deadlock.resolved).toBe(true)
    expect(snap.systems.mvccTxn.twoPhaseLock.lateAcquireBlocked).toBe(true)
    expect(snap.systems.mvccTxn.gc.longTxnRetainsMoreVersions).toBe(true)
    expect(Object.values(snap.systems.mvccTxn.verdict).every(Boolean)).toBe(true)
    // KI-506 distributedTxn：三协议 × 六场景矩阵 + 三难判词真读数已固化进快照。
    expect(snap.systems.distributedTxn.rows.length).toBe(3)
    expect(snap.systems.distributedTxn.config.scenarios.length).toBe(6)
    const dt2 = snap.systems.distributedTxn.rows.find((r: any) => r.protocol === '2PC')!
    const dtS = snap.systems.distributedTxn.rows.find((r: any) => r.protocol === 'Saga')!
    const dtT = snap.systems.distributedTxn.rows.find((r: any) => r.protocol === 'TCC')!
    expect(dt2.scenarios.find((s: any) => s.id === 'coordinatorDown').blocked).toBe(3)
    expect(dtS.scenarios.find((s: any) => s.id === 'compensateFail').dirty).toBe(1)
    expect(dtT.scenarios.find((s: any) => s.id === 'confirmFlaky').retries).toBeGreaterThan(0)
    expect(snap.systems.distributedTxn.verdict.noUniversalWinner).toBe(true)
    // KI-507 raftConsensus：三协议 × 六场景矩阵 + 三难判词真读数已固化进快照。
    expect(snap.systems.raftConsensus.rows.length).toBe(3)
    expect(snap.systems.raftConsensus.config.scenarios.length).toBe(6)
    const rcR = snap.systems.raftConsensus.rows.find((r: any) => r.protocol === 'Raft')!
    const rcM = snap.systems.raftConsensus.rows.find((r: any) => r.protocol === 'MultiMaster')!
    const rcG = snap.systems.raftConsensus.rows.find((r: any) => r.protocol === 'Gossip')!
    expect(rcR.scenarios.find((s: any) => s.id === 'networkPartition').blockedWrites).toBeGreaterThan(0)
    expect(rcM.scenarios.find((s: any) => s.id === 'writeConflict').conflicts).toBeGreaterThan(0)
    expect(rcG.scenarios.find((s: any) => s.id === 'antiEntropyGap').converged).toBe(false)
    expect(snap.systems.raftConsensus.verdict.noUniversalWinner).toBe(true)
    // KI-508 distributedLock：三协议 × 六场景矩阵 + 三难判词真读数已固化进快照。
    expect(snap.systems.distributedLock.rows.length).toBe(3)
    expect(snap.systems.distributedLock.config.scenarios.length).toBe(6)
    const dlS = snap.systems.distributedLock.rows.find((r: any) => r.protocol === 'SETNX')!
    const dlR = snap.systems.distributedLock.rows.find((r: any) => r.protocol === 'Redlock')!
    const dlE = snap.systems.distributedLock.rows.find((r: any) => r.protocol === 'ETCD')!
    expect(dlS.scenarios.find((s: any) => s.id === 'gcPause').doubleOwners).toBeGreaterThan(0)
    expect(dlR.scenarios.find((s: any) => s.id === 'clockDrift').doubleOwners).toBeGreaterThan(0)
    expect(dlE.scenarios.find((s: any) => s.id === 'staleFencing').staleWritesRejected).toBeGreaterThan(0)
    expect(snap.systems.distributedLock.verdict.noUniversalWinner).toBe(true)
    // KI-509 idGen：三协议 × 六场景矩阵 + 三难判词 + KI-504 真树交叉印证真读数已固化进快照。
    expect(snap.systems.idGen.rows.length).toBe(3)
    expect(snap.systems.idGen.config.scenarios.length).toBe(6)
    const igU = snap.systems.idGen.rows.find((r: any) => r.protocol === 'UUID')!
    const igS = snap.systems.idGen.rows.find((r: any) => r.protocol === 'Snowflake')!
    const igG = snap.systems.idGen.rows.find((r: any) => r.protocol === 'Segment')!
    expect(igU.scenarios.find((s: any) => s.id === 'randomKeyInsert').indexFriendly).toBe(false)
    expect(igS.scenarios.find((s: any) => s.id === 'clockBackward').stalled).toBeGreaterThan(0)
    expect(igG.scenarios.find((s: any) => s.id === 'centerDown').stalled).toBeGreaterThan(0)
    expect(snap.systems.idGen.btree.randomCmpGtSequential).toBe(true)   // 真树铁证
    expect(snap.systems.idGen.btree.randomFewerSplits).toBe(true)       // 反直觉读数如实保留
    expect(snap.systems.idGen.verdict.noUniversalWinner).toBe(true)
    // KI-510 distributedRateLimit：三协议 × 六场景矩阵 + 三难判词 + 真 Redis 原子桶/真环交叉印证真读数已固化进快照。
    expect(snap.systems.distributedRateLimit.rows.length).toBe(3)
    expect(snap.systems.distributedRateLimit.config.scenarios.length).toBe(6)
    const drlL = snap.systems.distributedRateLimit.rows.find((r: any) => r.protocol === 'Local')!
    const drlC = snap.systems.distributedRateLimit.rows.find((r: any) => r.protocol === 'Central')!
    const drlS = snap.systems.distributedRateLimit.rows.find((r: any) => r.protocol === 'Sharded')!
    expect(drlL.scenarios.every((s: any) => s.overAllowed > 0)).toBe(true)                    // Local 六场景 N×C 超发
    expect(drlC.scenarios.find((s: any) => s.id === 'centerDown').centerStalled).toBeGreaterThan(0) // 中心宕全瘫
    expect(drlS.scenarios.find((s: any) => s.id === 'skewKeys').fragmented).toBeGreaterThan(0)     // 配额碎片化
    expect(snap.systems.distributedRateLimit.crosscheck.central.atomicExact).toBe(true)       // 真 Redis 原子桶
    expect(snap.systems.distributedRateLimit.crosscheck.sharded.skewEmptyNodes).toBeGreaterThan(0) // 真环偏斜
    expect(snap.systems.distributedRateLimit.verdict.shardedNotPanacea).toBe(true)            // Sharded 不是银弹
    expect(snap.systems.distributedRateLimit.verdict.noUniversalWinner).toBe(true)
    // KI-511 configConsistency：三协议 × 六场景矩阵 + 三难判词 + 七枚真件交叉印证真读数已固化进快照。
    expect(snap.systems.configConsistency.rows.length).toBe(3)
    expect(snap.systems.configConsistency.config.scenarios.length).toBe(6)
    const dccP = snap.systems.configConsistency.rows.find((r: any) => r.protocol === 'Polling')!
    const dccL = snap.systems.configConsistency.rows.find((r: any) => r.protocol === 'LongPolling')!
    const dccW = snap.systems.configConsistency.rows.find((r: any) => r.protocol === 'WatchPush')!
    expect(dccP.scenarios.find((s: any) => s.id === 'idleNoChange').idleFetches).toBeGreaterThan(0)  // Polling 空转
    expect(dccP.scenarios.find((s: any) => s.id === 'centerDown').degraded).toBe(true)              // Polling 可降级
    expect(dccL.scenarios.find((s: any) => s.id === 'centerDown').centerBroken).toBe(true)           // 长轮询中心宕全断
    expect(dccW.scenarios.find((s: any) => s.id === 'burstChanges').versionGaps).toBeGreaterThan(0)  // Watch 风暴版本缺口
    expect(snap.systems.configConsistency.crosscheck.configWatcher.seededNoEvents).toBe(true)        // 真 watcher 首趟纯播种
    expect(snap.systems.configConsistency.crosscheck.bus.eventChainWorks).toBe(true)                 // 真 bus 事件链
    expect(snap.systems.configConsistency.crosscheck.gray.stableBuckets).toBe(64)                    // 真 hashSelector 稳定桶
    expect(snap.systems.configConsistency.verdict.watchNotPanacea).toBe(true)                        // Watch 不是银弹
    expect(snap.systems.configConsistency.verdict.noUniversalWinner).toBe(true)
    expect(snap.systems.configConsistency.vectors).toEqual({ Polling: '100', LongPolling: '011', WatchPush: '010' })
    // bootstrap.js 与 snapshot.json 是同一份真快照（含十三维 systems）。
    const bootCode = readFileSync(resolve(process.cwd(), 'console/bootstrap.js'), 'utf8')
    const fromBoot = JSON.parse(bootCode.slice(bootCode.indexOf('=') + 1).trim().replace(/;\s*$/, ''))
    expect(fromBoot.systems.lsm.speedup).toBe(snap.systems.lsm.speedup)
    expect(fromBoot.systems.hw.allocation.saved).toBe(snap.systems.hw.allocation.saved)
    expect(fromBoot.systems.guards).toEqual(snap.systems.guards)
    expect(fromBoot.systems.rateLimit).toEqual(snap.systems.rateLimit)
    expect(fromBoot.systems.failureDetector).toEqual(snap.systems.failureDetector)
    expect(fromBoot.systems.bplusIndex).toEqual(snap.systems.bplusIndex)
    expect(fromBoot.systems.mvccTxn).toEqual(snap.systems.mvccTxn)
    expect(fromBoot.systems.distributedTxn).toEqual(snap.systems.distributedTxn)
    expect(fromBoot.systems.raftConsensus).toEqual(snap.systems.raftConsensus)
    expect(fromBoot.systems.distributedLock).toEqual(snap.systems.distributedLock)
    expect(fromBoot.systems.idGen).toEqual(snap.systems.idGen)
    expect(fromBoot.systems.distributedRateLimit).toEqual(snap.systems.distributedRateLimit)
    expect(fromBoot.systems.configConsistency).toEqual(snap.systems.configConsistency) // 第十三维同源
    // KI-512 cacheCoherency：三协议 × 六场景矩阵 + 三难判词 + 七枚真件交叉印证真读数已固化进快照。
    expect(snap.systems.cacheCoherency.rows.length).toBe(3)
    expect(snap.systems.cacheCoherency.config.scenarios.length).toBe(6)
    const ccA = snap.systems.cacheCoherency.rows.find((r: any) => r.protocol === 'CacheAside')!
    const ccT = snap.systems.cacheCoherency.rows.find((r: any) => r.protocol === 'WriteThrough')!
    const ccB = snap.systems.cacheCoherency.rows.find((r: any) => r.protocol === 'WriteBehind')!
    expect(ccA.scenarios.find((s: any) => s.id === 'readAfterWrite')!.staleReads).toBeGreaterThan(0) // CacheAside 非原子窗口陈旧读
    expect(ccT.scenarios.every((s: any) => s.writeBackendRttMs > 0)).toBe(true)                       // WriteThrough 每写吃库 RTT
    expect(ccB.scenarios.find((s: any) => s.id === 'cacheCrash')!.dirtyPagesLost).toBeGreaterThan(0) // WriteBehind 整机宕丢脏页
    expect(snap.systems.cacheCoherency.crosscheck.wal.replicatedAcrossNodes).toBe(false)             // 真 WAL 非跨机
    expect(snap.systems.cacheCoherency.crosscheck.wal.wholeNodeLossDurable).toBe(false)
    expect(snap.systems.cacheCoherency.crosscheck.twoPhase.blockedParticipants).toBeGreaterThan(0)   // 真 2PC 协调阻塞
    expect(snap.systems.cacheCoherency.verdict.writeBehindNotPanacea).toBe(true)                     // Write-Behind 不是银弹
    expect(snap.systems.cacheCoherency.verdict.noUniversalWinner).toBe(true)
    expect(snap.systems.cacheCoherency.vectors).toEqual({ CacheAside: '001', WriteThrough: '101', WriteBehind: '110' })
    expect(fromBoot.systems.cacheCoherency).toEqual(snap.systems.cacheCoherency) // 第十四维同源
    // KI-513 messageDelivery：三协议 × 六场景矩阵 + 三难判词 + 七枚真件交叉印证真读数已固化进快照。
    expect(snap.systems.messageDelivery.rows.length).toBe(3)
    expect(snap.systems.messageDelivery.config.scenarios.length).toBe(6)
    const mdM = snap.systems.messageDelivery.rows.find((r: any) => r.protocol === 'AtMostOnce')!
    const mdL = snap.systems.messageDelivery.rows.find((r: any) => r.protocol === 'AtLeastOnce')!
    const mdE = snap.systems.messageDelivery.rows.find((r: any) => r.protocol === 'ExactlyOnce')!
    expect(mdM.scenarios.find((s: any) => s.id === 'crashAfterSend')!.lost).toBeGreaterThan(0) // AtMostOnce 静默丢
    expect(mdL.scenarios.find((s: any) => s.id === 'ackLost')!.duplicates).toBeGreaterThan(0)  // AtLeastOnce 重复
    expect(mdE.scenarios.find((s: any) => s.id === 'brokerRetry')!.idempotentHits).toBeGreaterThan(0) // ExactlyOnce 幂等折叠
    expect(snap.systems.messageDelivery.crosscheck.bridge.forwardOk).toBe(true)               // 真桥注入转发
    expect(snap.systems.messageDelivery.crosscheck.wal.replayIds).toEqual(['m:1', 'm:2', 'm:1']) // 真 WAL 取到 key
    expect(snap.systems.messageDelivery.crosscheck.wal.replicatedAcrossNodes).toBe(false)
    expect(snap.systems.messageDelivery.crosscheck.twoPhase.replayIdempotent).toBe(true)
    expect(snap.systems.messageDelivery.verdict.exactlyOnceNotFree).toBe(true)
    expect(snap.systems.messageDelivery.verdict.noUniversalWinner).toBe(true)
    expect(snap.systems.messageDelivery.vectors).toEqual({ AtMostOnce: '011', AtLeastOnce: '101', ExactlyOnce: '110' })
    expect(fromBoot.systems.messageDelivery).toEqual(snap.systems.messageDelivery) // 第十五维同源
    expect(Object.keys(fromBoot.systems).sort()).toEqual(Object.keys(snap.systems).sort())
  })

  it('⑭ buildMvccTxnReading 真跑五档矩阵形状齐、读数是真判词、单维关闭不连坐（KI-505）', async () => {
    const { buildMvccTxnReading } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 4242
    const reading = await buildMvccTxnReading({ mvGcVersions: 10 }, now)
    expect(reading).not.toBe(null)
    expect(reading!.levels.length).toBe(5)
    expect(reading!.config.anomalies.length).toBe(5)
    for (const l of reading!.levels) {
      expect(l.anomalies.writeSkew).toBeTruthy()
      expect(l.anomalies.lostUpdate).toBeTruthy()
      expect(typeof l.observedCount).toBe('number')
      expect(typeof l.aborted).toBe('number')
    }
    // 真判词阶梯：RU 全出 / SI 漏写偏斜 / SER 全挡 / 不封全局赢家
    expect(reading!.levels.find((l) => l.short === 'RU')!.observedCount).toBe(5)
    expect(reading!.levels.find((l) => l.short === 'SI')!.anomalies.writeSkew.observed).toBe(true)
    expect(reading!.levels.find((l) => l.short === 'SER')!.observedCount).toBe(0)
    expect(reading!.deadlock.resolved).toBe(true)
    expect(reading!.verdict.noUniversalWinner).toBe(true)
    // 单维关闭由 buildSystems/buildSnapshot 层把关（与 buildBplusReading 一致，reading 本身只管真跑）：落 null，不动其它维
    const sys = await buildSystems({ now, mvccTxn: false })
    expect(sys.mvccTxn).toBe(null)
    expect(sys.bplusIndex).toBeTruthy() // 不连坐
    expect(sys.failureDetector).toBeTruthy() // 不连坐
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, mvccTxn: false })
    expect(snap.systems!.mvccTxn).toBe(null)
  })

  it('⑮ buildDistributedTxnReading 真跑三协议矩阵形状齐、读数是真判词、单维关闭不连坐（KI-506）', async () => {
    const { buildDistributedTxnReading } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 5252
    const reading = await buildDistributedTxnReading({ dtxnRetries: 2 }, now)
    expect(reading).not.toBe(null)
    expect(reading!.config.protocols).toEqual(['2PC', 'Saga', 'TCC'])
    expect(reading!.config.scenarios.length).toBe(6)
    expect(reading!.rows.length).toBe(3)
    for (const row of reading!.rows) {
      expect(row.scenarios.length).toBe(6)
      expect(typeof row.intrusion).toBe('number')
      expect(typeof row.totals.messages).toBe('number')
      expect(row.trilemma).toBeTruthy()
    }
    // 真判词：2PC 阻塞 / Saga 留脏 / TCC 幂等重试 / 三难向量互不相同 / 不封赢家
    const two = reading!.rows.find((r) => r.protocol === '2PC')!
    const saga = reading!.rows.find((r) => r.protocol === 'Saga')!
    const tcc = reading!.rows.find((r) => r.protocol === 'TCC')!
    expect(two.scenarios.find((s) => s.id === 'coordinatorDown')!.blocked).toBe(3)
    expect(saga.scenarios.find((s) => s.id === 'compensateFail')!.dirty).toBe(1)
    expect(tcc.scenarios.find((s) => s.id === 'confirmFlaky')!.retries).toBe(2) // 注入 2 次 Confirm 失败
    expect(two.intrusion).toBeLessThan(tcc.intrusion)
    expect(reading!.verdict.noUniversalWinner).toBe(true)
    expect(reading!.sagaOrder.reverseOrder).toBe(true)
    expect(reading!.tccRetry.retries).toBe(2)
    // 单维关闭由 buildSystems/buildSnapshot 层把关：落 null，不动其它维
    const sys = await buildSystems({ now, distributedTxn: false })
    expect(sys.distributedTxn).toBe(null)
    expect(sys.mvccTxn).toBeTruthy() // 不连坐
    expect(sys.bplusIndex).toBeTruthy() // 不连坐
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, distributedTxn: false })
    expect(snap.systems!.distributedTxn).toBe(null)
  })

  it('⑯ buildRaftConsensusReading 真跑三协议矩阵形状齐、读数是真判词、单维关闭不连坐（KI-507）', async () => {
    const { buildRaftConsensusReading } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 6262
    const reading = await buildRaftConsensusReading({ rcRounds: 8 }, now)
    expect(reading).not.toBe(null)
    expect(reading!.config.protocols).toEqual(['Raft', 'MultiMaster', 'Gossip'])
    expect(reading!.config.scenarios.length).toBe(6)
    expect(reading!.rows.length).toBe(3)
    for (const row of reading!.rows) {
      expect(row.scenarios.length).toBe(6)
      expect(typeof row.totals.messages).toBe('number')
      expect(typeof row.trilemma.linearizable).toBe('boolean')
    }
    // 真判词：Raft 分区拒写 / 多主并发写冲突 / Gossip 反熵间隙不收敛 / 三难向量互不相同 / 不封赢家
    const raft = reading!.rows.find((r) => r.protocol === 'Raft')!
    const mm = reading!.rows.find((r) => r.protocol === 'MultiMaster')!
    const gossip = reading!.rows.find((r) => r.protocol === 'Gossip')!
    expect(raft.scenarios.find((s) => s.id === 'networkPartition')!.blockedWrites).toBeGreaterThan(0)
    expect(mm.scenarios.find((s) => s.id === 'writeConflict')!.conflicts).toBeGreaterThan(0)
    expect(gossip.scenarios.find((s) => s.id === 'antiEntropyGap')!.converged).toBe(false)
    const vec = (r: any) => `${Number(r.trilemma.linearizable)}${Number(r.trilemma.partitionAvailable)}${Number(r.trilemma.boundedConvergence)}`
    expect([vec(raft), vec(mm), vec(gossip)]).toEqual(['101', '011', '010'])
    expect(reading!.verdict.noUniversalWinner).toBe(true)
    expect(reading!.election.resolvedByTimeout).toBe(true)
    expect(reading!.gossip.noBound).toBe(true)
    // 单维关闭由 buildSystems/buildSnapshot 层把关：落 null，不动其它维
    const sys = await buildSystems({ now, raftConsensus: false })
    expect(sys.raftConsensus).toBe(null)
    expect(sys.distributedTxn).toBeTruthy() // 不连坐
    expect(sys.mvccTxn).toBeTruthy() // 不连坐
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, raftConsensus: false })
    expect(snap.systems!.raftConsensus).toBe(null)
  })

  it('⑰ buildDistributedLockReading 真跑三协议矩阵形状齐、读数是真判词、单维关闭不连坐（KI-508）', async () => {
    const { buildDistributedLockReading } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 7272
    const reading = await buildDistributedLockReading({ dlockInstances: 5 }, now)
    expect(reading).not.toBe(null)
    expect(reading!.config.protocols).toEqual(['SETNX', 'Redlock', 'ETCD'])
    expect(reading!.config.scenarios.length).toBe(6)
    expect(reading!.rows.length).toBe(3)
    for (const row of reading!.rows) {
      expect(row.scenarios.length).toBe(6)
      expect(typeof row.totals.messages).toBe('number')
      expect(typeof row.trilemma.mutualExclusion).toBe('boolean')
    }
    // 真判词：SETNX GC 暂停双主 / Redlock 漂移双主 / etcd fencing 拒旧写 / 三难向量互不相同 / 不封赢家
    const setnx = reading!.rows.find((r) => r.protocol === 'SETNX')!
    const redlock = reading!.rows.find((r) => r.protocol === 'Redlock')!
    const etcd = reading!.rows.find((r) => r.protocol === 'ETCD')!
    expect(setnx.scenarios.find((s) => s.id === 'gcPause')!.doubleOwners).toBeGreaterThan(0)
    expect(redlock.scenarios.find((s) => s.id === 'clockDrift')!.doubleOwners).toBeGreaterThan(0)
    expect(etcd.scenarios.find((s) => s.id === 'staleFencing')!.staleWritesRejected).toBeGreaterThan(0)
    const vec = (r: any) => `${Number(r.trilemma.mutualExclusion)}${Number(r.trilemma.partialFaultTolerance)}${Number(r.trilemma.lowLatency)}`
    expect([vec(setnx), vec(redlock), vec(etcd)]).toEqual(['001', '010', '110'])
    expect(reading!.verdict.noUniversalWinner).toBe(true)
    expect(reading!.setnx.ttlAutoRelease).toBe(true)
    expect(reading!.redlock.toleratesNodeDown).toBe(true)
    expect(reading!.fencing.tokenMonotonic).toBe(true)
    expect(reading!.fencing.rejectsStaleWrite).toBe(true)
    // 单维关闭由 buildSystems/buildSnapshot 层把关：落 null，不动其它维
    const sys = await buildSystems({ now, distributedLock: false })
    expect(sys.distributedLock).toBe(null)
    expect(sys.raftConsensus).toBeTruthy() // 不连坐
    expect(sys.distributedTxn).toBeTruthy() // 不连坐
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, distributedLock: false })
    expect(snap.systems!.distributedLock).toBe(null)
  })

  it('⑱ buildIdGenReading 真跑三协议矩阵形状齐、真树交叉印证读数真判词、单维关闭不连坐（KI-509）', async () => {
    const { buildIdGenReading } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 8282
    const reading = await buildIdGenReading({ idGenKeyCount: 24, idGenTreeOrder: 8 }, now)
    expect(reading).not.toBe(null)
    expect(reading!.config.protocols).toEqual(['UUID', 'Snowflake', 'Segment'])
    expect(reading!.config.scenarios.length).toBe(6)
    expect(reading!.rows.length).toBe(3)
    for (const row of reading!.rows) {
      expect(row.scenarios.length).toBe(6)
      expect(typeof row.totals.issued).toBe('number')
      expect(typeof row.trilemma.indexFriendly).toBe('boolean')
    }
    // 真判词：UUID 随机主键索引代价 / Snowflake 回拨停发 / 号段中心宕中断 / 三难向量互不相同 / 不封赢家
    const uuid = reading!.rows.find((r) => r.protocol === 'UUID')!
    const snow = reading!.rows.find((r) => r.protocol === 'Snowflake')!
    const seg = reading!.rows.find((r) => r.protocol === 'Segment')!
    expect(uuid.scenarios.find((s) => s.id === 'randomKeyInsert')!.indexFriendly).toBe(false)
    expect(snow.scenarios.find((s) => s.id === 'clockBackward')!.stalled).toBeGreaterThan(0)
    expect(seg.scenarios.find((s) => s.id === 'centerDown')!.stalled).toBeGreaterThan(0)
    const vec = (r: any) => `${Number(r.trilemma.indexFriendly)}${Number(r.trilemma.decentralized)}${Number(r.trilemma.clockRobust)}`
    expect([vec(uuid), vec(snow), vec(seg)]).toEqual(['011', '110', '101'])
    expect(reading!.verdict.noUniversalWinner).toBe(true)
    // KI-504 真树交叉印证：定位比较铁证 + 反直觉 splits 读数如实保留
    expect(reading!.btree.randomCmpGtSequential).toBe(true)
    expect(reading!.btree.randomFewerSplits).toBe(true)
    expect(reading!.uuid.globallyUnique).toBe(true)
    expect(reading!.snowflake.parseRoundTrip).toBe(true)
    expect(reading!.segment.segmentMonotonic).toBe(true)
    // 单维关闭由 buildSystems/buildSnapshot 层把关：落 null，不动其它维
    const sys = await buildSystems({ now, idGen: false })
    expect(sys.idGen).toBe(null)
    expect(sys.distributedLock).toBeTruthy() // 不连坐
    expect(sys.raftConsensus).toBeTruthy() // 不连坐
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, idGen: false })
    expect(snap.systems!.idGen).toBe(null)
  })

  it('⑲ buildDistributedRateLimitReading 真跑三协议矩阵形状齐、真件交叉印证真判词、单维关闭不连坐（KI-510）', async () => {
    const { buildDistributedRateLimitReading } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 9393
    const reading = await buildDistributedRateLimitReading({ drlInstances: 4, drlShards: 4, drlCapacity: 8 }, now)
    expect(reading).not.toBe(null)
    expect(reading!.config.scenarios.length).toBe(6)
    expect(reading!.rows.length).toBe(3)
    expect(reading!.vectors).toEqual({ Local: '011', Central: '100', Sharded: '010' })
    for (const row of reading!.rows) {
      expect(row.scenarios.length).toBe(6)
      expect(typeof row.totals.allowed).toBe('number')
      expect(typeof row.trilemma.globalExact).toBe('boolean')
      for (const s of row.scenarios) {
        expect(typeof s.hotKeyHits).toBe('number')   // 三协议专有病征读数形状齐
        expect(typeof s.centerStalled).toBe('number')
      }
    }
    const local = reading!.rows.find((r) => r.protocol === 'Local')!
    const central = reading!.rows.find((r) => r.protocol === 'Central')!
    const sharded = reading!.rows.find((r) => r.protocol === 'Sharded')!
    expect(local.scenarios.every((s) => s.overAllowed > 0)).toBe(true)
    expect(central.scenarios.find((s) => s.id === 'centerDown')!.centerStalled).toBeGreaterThan(0)
    expect(sharded.scenarios.find((s) => s.id === 'skewKeys')!.fragmented).toBeGreaterThan(0)
    // 真件交叉印证
    expect(reading!.crosscheck.central.atomicExact).toBe(true)
    expect(reading!.crosscheck.central.nonAtomicOvershoot).toBeGreaterThan(0)
    expect(reading!.crosscheck.sharded.skewEmptyNodes).toBeGreaterThan(0)
    expect(reading!.crosscheck.sharded.remapRate).toBeLessThan(reading!.crosscheck.sharded.moduloRate)
    expect(reading!.verdict.shardedNotPanacea).toBe(true)
    expect(reading!.verdict.noUniversalWinner).toBe(true)
    expect(reading!.builtAt).toBe(9393)
    // 单维关闭由 buildSystems/buildSnapshot 层把关：落 null，不动其它维
    const sys = await buildSystems({ now, distributedRateLimit: false })
    expect(sys.distributedRateLimit).toBe(null)
    expect(sys.idGen).toBeTruthy() // 不连坐 KI-509
    expect(sys.distributedLock).toBeTruthy()
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, distributedRateLimit: false })
    expect(snap.systems!.distributedRateLimit).toBe(null)
  })

  it('㉛ buildConfigConsistencyReading 真跑三协议×六场景矩阵 + 七枚真件交叉印证、注入时钟/规模生效、单维关闭不连坐（KI-511）', async () => {
    const { buildConfigConsistencyReading, buildSystems, buildSnapshot } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 9393
    const reading = (await buildConfigConsistencyReading({ dccClients: 8 }, now)) as NonNullable<Awaited<ReturnType<typeof buildConfigConsistencyReading>>>
    expect(reading).not.toBe(null)
    expect(reading.vectors).toEqual({ Polling: '100', LongPolling: '011', WatchPush: '010' })
    for (const row of reading.rows) {
      expect(row.scenarios.length).toBe(6)
      expect(typeof row.totals.connections).toBe('number')
      expect(typeof row.trilemma.degradeOnCenterDown).toBe('boolean')
      for (const s of row.scenarios) {
        expect(typeof s.versionGaps).toBe('number')   // 三协议专有病征读数形状齐
        expect(typeof s.idleFetches).toBe('number')
      }
    }
    const polling = reading.rows.find((r) => r.protocol === 'Polling')!
    const longPolling = reading.rows.find((r) => r.protocol === 'LongPolling')!
    const watch = reading.rows.find((r) => r.protocol === 'WatchPush')!
    expect(polling.scenarios.find((s) => s.id === 'idleNoChange')!.idleFetches).toBeGreaterThan(0)
    expect(longPolling.scenarios.find((s) => s.id === 'centerDown')!.centerBroken).toBe(true)
    expect(watch.scenarios.find((s) => s.id === 'burstChanges')!.versionGaps).toBeGreaterThan(0)
    // 七枚真件交叉印证
    expect(reading.crosscheck.configServer.stateIsNull).toBe(true)
    expect(reading.crosscheck.configWatcher.seededNoEvents).toBe(true)
    expect(reading.crosscheck.bus.eventChainWorks).toBe(true)
    expect(reading.crosscheck.gray.stableBuckets).toBe(64)
    expect(reading.crosscheck.guard.monotonic).toBe(true)
    expect(reading.crosscheck.redisCache.expiredCount).toBeGreaterThan(0)
    expect(typeof reading.crosscheck.ring.emptyNodes).toBe('number')
    expect(reading.verdict.watchNotPanacea).toBe(true)
    expect(reading.verdict.noUniversalWinner).toBe(true)
    expect(reading.builtAt).toBe(9393)
    // 单维关闭落 null，不连坐其它维
    const sys = await buildSystems({ now, configConsistency: false })
    expect(sys.configConsistency).toBe(null)
    expect(sys.distributedRateLimit).toBeTruthy() // 不连坐 KI-510
    expect(sys.idGen).toBeTruthy()
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, configConsistency: false })
    expect(snap.systems!.configConsistency).toBe(null)
  })

  it('㉜ buildCacheCoherencyReading 真跑三协议×六场景矩阵 + 七枚真件交叉印证、注入时钟/规模/WAL 生效、单维关闭不连坐（KI-512）', async () => {
    const { buildCacheCoherencyReading } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 9393
    const reading = (await buildCacheCoherencyReading({ cccWrites: 6, cccManyKeys: 48, cccBackendRttMs: 12 }, now)) as NonNullable<Awaited<ReturnType<typeof buildCacheCoherencyReading>>>
    expect(reading).not.toBe(null)
    expect(reading.vectors).toEqual({ CacheAside: '001', WriteThrough: '101', WriteBehind: '110' })
    expect(reading.config.scenarios.length).toBe(6)
    expect(reading.rows.length).toBe(3)
    for (const row of reading.rows) {
      expect(row.scenarios.length).toBe(6)
      expect(typeof row.totals.writeBackendRttMs).toBe('number')
      expect(typeof row.trilemma.durableOnCrash).toBe('boolean')
      for (const s of row.scenarios) {
        expect(typeof s.staleReads).toBe('number')       // 三协议专有病征读数形状齐
        expect(typeof s.dirtyPagesLost).toBe('number')
        expect(typeof s.writeBackendRttMs).toBe('number')
      }
    }
    // 注入规模生效：manyKeys=48 ⇒ 交叉印证里 written=48。
    expect(reading.crosscheck.sharded.written).toBe(48)
    expect(reading.builtAt).toBe(9393)
    // 真判词：CacheAside 陈旧读 / WriteThrough 每写阻塞 / WriteBehind 宕丢脏页 + 合并。
    const aside = reading.rows.find((r) => r.protocol === 'CacheAside')!
    const through = reading.rows.find((r) => r.protocol === 'WriteThrough')!
    const behind = reading.rows.find((r) => r.protocol === 'WriteBehind')!
    expect(aside.scenarios.find((s) => s.id === 'readAfterWrite')!.staleReads).toBeGreaterThan(0)
    expect(through.scenarios.every((s) => s.writeBackendRttMs > 0)).toBe(true)
    expect(behind.scenarios.find((s) => s.id === 'cacheCrash')!.dirtyPagesLost).toBeGreaterThan(0)
    expect(behind.totals.coalescedWrites).toBeGreaterThan(0)
    // 七枚真件交叉印证
    expect(reading.crosscheck.redis.writeThenReadSeesNew).toBe(true)
    expect(reading.crosscheck.wal.replayed).toBeGreaterThan(0)
    expect(reading.crosscheck.wal.replicatedAcrossNodes).toBe(false)       // 进程内 WAL 不跨机
    expect(reading.crosscheck.wal.wholeNodeLossDurable).toBe(false)
    expect(reading.crosscheck.guard.monotonic).toBe(true)
    expect(reading.crosscheck.sharded.allReadable).toBe(true)
    expect(reading.crosscheck.mvcc.writeThenReadNeedsCommit).toBe(true)
    expect(reading.crosscheck.twoPhase.blockedParticipants).toBeGreaterThan(0)
    expect(reading.crosscheck.ring.emptyNodes).toBeGreaterThanOrEqual(0)
    expect(reading.verdict.writeBehindNotPanacea).toBe(true)
    expect(reading.verdict.noUniversalWinner).toBe(true)
    // 单开 WAL 抹不掉 durable 维：向量仍 110。
    const withWal = (await buildCacheCoherencyReading({ cccWalEnabled: true }, now)) as NonNullable<Awaited<ReturnType<typeof buildCacheCoherencyReading>>>
    expect(withWal.vectors).toEqual({ CacheAside: '001', WriteThrough: '101', WriteBehind: '110' })
    expect(withWal.config.walEnabled).toBe(true)
    // 单维关闭落 null，不连坐其它维
    const sys = await buildSystems({ now, cacheCoherency: false })
    expect(sys.cacheCoherency).toBe(null)
    expect(sys.configConsistency).toBeTruthy() // 不连坐 KI-511
    expect(sys.distributedRateLimit).toBeTruthy()
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, cacheCoherency: false })
    expect(snap.systems!.cacheCoherency).toBe(null)
  })

  it('㉝ buildMessageDeliveryReading 真跑三协议×六场景矩阵 + 七枚真件交叉印证、注入时钟/规模/ackReliable 生效、单维关闭不连坐（KI-513）', async () => {
    const { buildMessageDeliveryReading } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 7777
    const reading = (await buildMessageDeliveryReading({ mmdMessages: 8, mmdManyKeys: 48, mmdRetryLimit: 2 }, now)) as NonNullable<Awaited<ReturnType<typeof buildMessageDeliveryReading>>>
    expect(reading.builtAt).toBe(7777)
    expect(reading.vectors).toEqual({ AtMostOnce: '011', AtLeastOnce: '101', ExactlyOnce: '110' })
    expect(reading.rows.length).toBe(3)
    expect(reading.rows[0].scenarios.length).toBe(6)
    expect(reading.config.messages).toBe(8)
    expect(reading.config.manyKeys).toBe(48)
    expect(reading.config.retryLimit).toBe(2)
    expect(Object.keys(reading.crosscheck).sort()).toEqual(['bridge', 'bus', 'gameEventBus', 'redis', 'ring', 'twoPhase', 'wal'])
    expect(reading.crosscheck.bridge.forwardOk).toBe(true)
    expect(reading.crosscheck.wal.replayIds).toEqual(['m:1', 'm:2', 'm:1'])
    expect(reading.crosscheck.wal.distinctIds).toBe(2)
    expect(reading.crosscheck.wal.replayDedupePossible).toBe(true)
    expect(reading.crosscheck.wal.replicatedAcrossNodes).toBe(false)
    expect(reading.verdict.noUniversalWinner).toBe(true)
    expect(reading.verdict.exactlyOnceNotFree).toBe(true)
    expect(reading.verdict.exactlyOnceIsAtLeastOncePlusIdempotency).toBe(true)
    // 单开 ackReliable 只补 At-Least-Once 的 noDup 维成 111，救不了另两只。
    const withAck = (await buildMessageDeliveryReading({ mmdAckReliable: true }, now)) as NonNullable<Awaited<ReturnType<typeof buildMessageDeliveryReading>>>
    expect(withAck.vectors).toEqual({ AtMostOnce: '011', AtLeastOnce: '111', ExactlyOnce: '110' })
    expect(withAck.config.ackReliable).toBe(true)
    // 单维关闭落 null，不连坐其它维
    const sys = await buildSystems({ now, messageDelivery: false })
    expect(sys.messageDelivery).toBe(null)
    expect(sys.cacheCoherency).toBeTruthy()  // 不连坐 KI-512
    expect(sys.configConsistency).toBeTruthy() // 不连坐 KI-511
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, messageDelivery: false })
    expect(snap.systems!.messageDelivery).toBe(null)
  })
})
