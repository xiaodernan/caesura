import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
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
    // KI-518 delayQueue：三协议 × 六场景矩阵 + 三难向量 + 七枚真件交叉印证真读数已固化进快照（第十六维）。
    expect(snap.systems.delayQueue.rows.length).toBe(3)
    expect(snap.systems.delayQueue.config.scenarios.length).toBe(6)
    const dqW = snap.systems.delayQueue.rows.find((r: any) => r.protocol === 'TimingWheel')!
    const dqH = snap.systems.delayQueue.rows.find((r: any) => r.protocol === 'MinHeap')!
    const dqZ = snap.systems.delayQueue.rows.find((r: any) => r.protocol === 'RedisZset')!
    expect(dqW.scenarios.find((s: any) => s.id === 'tickSkew')!.lateMs).toBeGreaterThan(0)     // 时间轮 tick 粒度晚点
    expect(dqH.totals.lateMs).toBe(0)                                                          // 最小堆零晚点
    expect(dqH.totals.opUnits).toBeGreaterThan(0)                                              // O(log n) 比较数
    expect(dqZ.scenarios.find((s: any) => s.id === 'workerRestart')!.lostOnRestart).toBe(0)    // ZSET 共享可持久不丢
    expect(dqZ.scenarios.find((s: any) => s.id === 'concurrentWorkers')!.duplicatePickups).toBeGreaterThan(0) // 非原子重复
    const ev = snap.systems.delayQueue.crosscheck.evidence
    expect(ev.hashRingNodes).toBe(2)
    expect(ev.hashRingEmptyNodes).toBe(0)   // 真 distribution().emptyNodes.length（新回读字段）
    expect(ev.walLines).toBe(2)             // 真 append('put',k,v) 3 参
    expect(ev.bplusRangeCount).toBe(30)     // 真 range() 条数
    expect(ev.poolAcquired).toBe(2)         // 真 stats().acquired（非硬编码）
    expect(ev.tokenBucketOk).toBe(true)     // refillPerSec 真生效
    expect(snap.systems.delayQueue.verdict.noUniversalWinner).toBe(true)
    expect(snap.systems.delayQueue.verdict.minHeapZeroLateMs).toBe(true)
    expect(snap.systems.delayQueue.verdict.redisZsetNeverSilentLossOnRestart).toBe(true)
    expect(snap.systems.delayQueue.vectors).toEqual({ TimingWheel: '100', MinHeap: '010', RedisZset: '001' })
    expect(fromBoot.systems.delayQueue).toEqual(snap.systems.delayQueue) // 第十六维同源
    // KI-523 consumerGroup：三协议 × 六场景 + 正交三难向量 + 九真件交叉印证真读数已固化进快照（第十八维）。
    expect(snap.systems.consumerGroup.rows.length).toBe(3)
    expect(snap.systems.consumerGroup.config.scenarios.length).toBe(6)
    const cgR = snap.systems.consumerGroup.rows.find((r: any) => r.protocol === 'Range')!
    const cgRR = snap.systems.consumerGroup.rows.find((r: any) => r.protocol === 'RoundRobin')!
    const cgS = snap.systems.consumerGroup.rows.find((r: any) => r.protocol === 'Sticky')!
    expect(cgR.scenarios.find((s: any) => s.id === 'partitionSkew')!.imbalance).toBeGreaterThan(1) // Range 多 topic 余数偏斜
    expect(cgR.scenarios.find((s: any) => s.id === 'memberJoin')!.moveRate).toBeGreaterThan(0)     // 成员加入迁移
    expect(cgS.metrics.moveSum).toBeLessThan(cgRR.metrics.moveSum)                                  // Sticky 迁移最少
    expect(cgS.metrics.opPerPart).toBeGreaterThan(cgR.metrics.opPerPart)                           // Sticky 最贵，非银弹
    // 正交布尔：每格只在负责维度判定，快照 cell 携带三布尔与 trilemma 同源
    for (const row of snap.systems.consumerGroup.rows) {
      for (const c of row.scenarios) {
        expect(typeof c.balanced).toBe('boolean')
        expect(typeof c.minimalMovement).toBe('boolean')
        expect(typeof c.cheap).toBe('boolean')
        const recomputed = `${Number(row.trilemma.balanced)}${Number(row.trilemma.minimalMovement)}${Number(row.trilemma.cheap)}`
        expect(snap.systems.consumerGroup.vectors[row.protocol]).toBe(recomputed) // 向量恒由 trilemma 现算
      }
    }
    const cgpEv = snap.systems.consumerGroup.crosscheck.evidence
    expect(Object.keys(cgpEv).length).toBe(16)
    expect(cgpEv.walReplayed).toBeGreaterThan(0)         // 真 WAL restore+replay
    expect(cgpEv.heapFired).toBeGreaterThan(0)           // 真最小堆 advance 出队
    expect(cgpEv.rebalanceNotices).toBeGreaterThan(0)    // 真总线通知
    expect(cgpEv.bucketRejected).toBeGreaterThan(0)      // 真令牌桶防抖拒流
    expect(snap.systems.consumerGroup.verdict.noUniversalWinner).toBe(true)
    expect(snap.systems.consumerGroup.verdict.stickyNotFreeLunch).toBe(true)
    expect(snap.systems.consumerGroup.vectors).toEqual({ Range: '001', RoundRobin: '100', Sticky: '110' })
    expect(fromBoot.systems.consumerGroup).toEqual(snap.systems.consumerGroup) // 第十八维同源
    // KI-525 backpressure：四策略 × 六负载 + 正交三难向量 + Little's Law 双路自证 + 十一真件交叉印证（第十九维）。
    const bp = snap.systems.backpressure
    expect(bp.rows.length).toBe(4)
    expect(bp.config.scenarios.length).toBe(6)
    expect(bp.config.scenarios).toEqual(['steadyTrickle', 'burstAbsorb', 'sustainedOverload', 'latencySpike', 'downstreamStall', 'memoryPressure'])
    expect(bp.vectors).toEqual({ Backpressure: '110', Buffering: '101', Shedding: '011', Scaling: '100' })
    // 向量恒由每 row 的 trilemma 现算（绝不前端阈值重算、绝不硬编码全 111）
    for (const row of bp.rows) {
      const recomputed = `${Number(row.trilemma.noLoss)}${Number(row.trilemma.lowLatency)}${Number(row.trilemma.highThroughput)}`
      expect(bp.vectors[row.strategy]).toBe(recomputed)
      expect(row.scenarios.length).toBe(6)
    }
    expect(new Set(Object.values(bp.vectors)).size).toBe(4)  // 四向量互异
    expect(Object.values(bp.vectors).every((v: any) => v !== '111')).toBe(true)
    const bpEv = bp.crosscheck.evidence
    expect(Object.keys(bpEv).length).toBe(20)                 // 十一真件 20 字段真回读
    expect(bpEv.bucketAllowed).toBeGreaterThan(0)            // 真令牌桶
    expect(bpEv.zqFired).toBeGreaterThan(0)                  // 真 RedisZset 缓冲
    expect(bpEv.heapFired).toBeGreaterThan(0)                // 真最小堆
    expect(bpEv.walReplayed).toBeGreaterThan(0)              // 真 WAL restore+replay
    expect(bpEv.poolReused).toBeGreaterThan(0)               // 真对象池复用
    expect(bp.littleLaw.steadyHolds).toBe(true)              // 稳态 L=λW 自证
    expect(bp.littleLaw.steadyNontrivial).toBe(true)         // 非平凡（非全零排队）
    expect(bp.littleLaw.overloadBreaks).toBe(true)           // 过载端稳态形式破裂
    expect(bp.verdict.noUniversalWinner).toBe(true)
    expect(bp.verdict.backpressureRejectsBursts).toBe(true)
    expect(bp.verdict.bufferingPaysLatency).toBe(true)
    expect(bp.verdict.sheddingDropsMessages).toBe(true)
    expect(bp.verdict.scalingStallsOnRebalance).toBe(true)
    expect(fromBoot.systems.backpressure).toEqual(bp)         // 第十九维双载体同源
    // KI-526 logCompaction：三策略 × 六场景 + 正交三难向量 + verifyReplayBoundary 双路守恒 + 十一真件交叉印证（第二十维）。
    const lc = snap.systems.logCompaction
    expect(lc.rows.length).toBe(3)
    expect(lc.config.scenarios.length).toBe(6)
    expect(lc.config.scenarios).toEqual(['steadyAppend', 'hotKeyChurn', 'tombstoneBurst', 'slowConsumer', 'crashMidReplay', 'retentionPressure'])
    expect(lc.vectors).toEqual({ SizeTimeRetention: '101', KeyCompaction: '110', SnapshotPlusWal: '011' })
    for (const row of lc.rows) {
      const recomputed = `${Number(row.trilemma.compactFootprint)}${Number(row.trilemma.replayCompleteness)}${Number(row.trilemma.fastRecovery)}`
      expect(lc.vectors[row.strategy]).toBe(recomputed)
      expect(row.scenarios.length).toBe(6)
    }
    expect(new Set(Object.values(lc.vectors)).size).toBe(3)  // 三向量互异
    expect(Object.values(lc.vectors).every((v: any) => v !== '111')).toBe(true)
    const lcEv = lc.crosscheck.evidence
    expect(Object.keys(lcEv).length).toBe(21)                 // 十一真件 21 字段真回读
    expect(lcEv.walReplayed).toBeGreaterThan(0)               // 真 WAL restore+replay
    expect(lcEv.heapFired).toBeGreaterThan(0)                 // 真最小堆 LSN 排程
    expect(lcEv.ringShardsUsed).toBeGreaterThan(0)            // 真哈希环快照分片
    expect(lc.replayBoundary.holds).toBe(true)                // 稳态守恒双路自证
    expect(lc.replayBoundary.nontrivial).toBe(true)           // 非平凡
    expect(lc.replayBoundary.falsifiable).toBe(true)          // 三路篡改可证伪
    expect(lc.verdict.noUniversalWinner).toBe(true)
    expect(lc.verdict.retentionDropsSlowConsumer).toBe(true)
    expect(lc.verdict.keyCompactionPaysRecovery).toBe(true)
    expect(lc.verdict.snapshotPaysWriteAmplification).toBe(true)
    expect(lc.verdict.snapshotExactlyOnce).toBe(true)         // exactly-once 真去重
    expect(fromBoot.systems.logCompaction).toEqual(lc)        // 第二十维双载体同源
    expect(Object.keys(fromBoot.systems).sort()).toEqual(Object.keys(snap.systems).sort())
  })

  it('⑯-backpressure buildBackpressureReading 真跑：bpc* 注入生效 / backpressure:false 关闭 / rigged 因果锁可证伪 / 六时钟同源（KI-525）', async () => {
    const { buildBackpressureReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 525000
    const bp = (await buildBackpressureReading({}, now))!
    expect(bp).not.toBe(null)
    expect(bp.builtAt).toBe(525000)                           // KI-517 母版：builtAt 对注入时钟求值
    // bpc* 注入（bpcSteps/bpcMu/bpcSeed），不复用被 B+ 树占用的 bp*
    const tuned = (await buildBackpressureReading({ bpcSteps: 20, bpcMu: 3, bpcSeed: 9 }, now))!
    expect(tuned.config.steps).toBe(20)
    expect(tuned.config.mu).toBe(3)
    expect(tuned.config.seed).toBe(9)
    // 三开关单开：各自反噬一维，绝不硬造全 111
    const zero = (await buildBackpressureReading({ bpcZeroLoss: true }, now))!
    expect(zero.verdict.zeroLossBackfiresLatency).toBe(true)
    const bounded = (await buildBackpressureReading({ bpcBoundedLatency: true }, now))!
    expect(bounded.verdict.boundedLatencyBackfiresNoLoss).toBe(true)
    // rigged 齐开：四向量退 110·高吞吐因果抹不掉，判词可证伪
    const rig = (await buildBackpressureReading({ bpcRigged: true }, now))!
    expect(rig.vectors).toEqual({ Backpressure: '110', Buffering: '110', Shedding: '110', Scaling: '110' })
    expect(rig.verdict.highThroughputCausallyUnerasable).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    // backpressure:false 关闭不连坐其它维
    const off = await buildSystems({ now, backpressure: false })
    expect(off.backpressure).toBe(null)
    expect(off.consumerGroup).not.toBe(null)
    expect(off.delayQueue).not.toBe(null)
    // 七时钟同源
    const full = await buildSystems({ now })
    const seven = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt]
    expect(seven.every((x) => x === 525000)).toBe(true)
  })

  it('⑰-logCompaction buildLogCompactionReading 真跑：lc* 注入生效 / logCompaction:false 关闭 / rigged 因果锁可证伪 / 单开三开关反噬（KI-526）', async () => {
    const { buildLogCompactionReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 526000
    const lc = (await buildLogCompactionReading({}, now))!
    expect(lc).not.toBe(null)
    expect(lc.builtAt).toBe(526000)                           // KI-517 母版：builtAt 对注入时钟求值
    expect(lc.rows.length).toBe(3)
    expect(lc.vectors).toEqual({ SizeTimeRetention: '101', KeyCompaction: '110', SnapshotPlusWal: '011' })
    // lc* 注入（lcOps/lcKeySpace/lcSeed），不复用被 LSM/B+ 树/背压占用的前缀
    const tuned = (await buildLogCompactionReading({ lcOps: 30, lcKeySpace: 20, lcSeed: 9 }, now))!
    expect(tuned.config.ops).toBe(30)
    expect(tuned.config.keySpace).toBe(20)
    expect(tuned.config.seed).toBe(9)
    // 三开关单开：各自反噬恢复快维，绝不硬造全 111
    const ur = (await buildLogCompactionReading({ lcUnlimitedRetention: true }, now))!
    expect(ur.verdict.unlimitedRetentionBackfiresRecovery).toBe(true)
    const ins = (await buildLogCompactionReading({ lcInstantSnapshot: true }, now))!
    expect(ins.verdict.instantSnapshotBackfiresRecovery).toBe(true)
    const zr = (await buildLogCompactionReading({ lcZeroReplayCost: true }, now))!
    expect(zr.verdict.zeroReplayCostErasesNothing).toBe(true)
    // rigged 齐开：三向量退 110·恢复快因果抹不掉，判词可证伪
    const rig = (await buildLogCompactionReading({ lcRigged: true }, now))!
    expect(rig.vectors).toEqual({ SizeTimeRetention: '110', KeyCompaction: '110', SnapshotPlusWal: '110' })
    expect(rig.verdict.fastRecoveryCausallyUnerasable).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    // logCompaction:false 关闭不连坐其它维
    const off = await buildSystems({ now, logCompaction: false })
    expect(off.logCompaction).toBe(null)
    expect(off.backpressure).not.toBe(null)
    expect(off.consumerGroup).not.toBe(null)
    expect(off.delayQueue).not.toBe(null)
    // 七时钟同源
    const full = await buildSystems({ now })
    const seven = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt]
    expect(seven.every((x) => x === 526000)).toBe(true)
  })

  it('⑱-bloomFilter buildBloomFilterReading 真跑：bf* 注入生效 / bloomFilter:false 关闭 / rigged 因果锁可证伪 / 新三开关单开反噬 / 八时钟同源（KI-527）', async () => {
    const { buildBloomFilterReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 527000
    const bf = (await buildBloomFilterReading({}, now))!
    expect(bf).not.toBe(null)
    expect(bf.builtAt).toBe(527000)                            // KI-517 母版：builtAt 对注入时钟求值
    expect(bf.rows.length).toBe(3)
    expect(bf.config.scenarios.length).toBe(6)
    expect(bf.vectors).toEqual({ Bloom: '110', CountingBloom: '011', Cuckoo: '101' })
    // bf* 注入（bfSeed/bfCapacity/bfBitsPerKey），不复用被其它维占用的前缀
    const tuned = (await buildBloomFilterReading({ bfSeed: 9, bfCapacity: 2048, bfBitsPerKey: 12 }, now))!
    expect(tuned.config.seed).toBe(9)
    expect(tuned.config.capacity).toBe(2048)
    // 新三开关单开：各自现算反噬判词，绝不硬造全 111
    const ur = (await buildBloomFilterReading({ bfUnlimitedRoom: true }, now))!
    expect(ur.verdict.unlimitedRoomBackfiresCompactFootprint).toBe(true)
    const es = (await buildBloomFilterReading({ bfEternalStasis: true }, now))!
    expect(es.verdict.eternalStasisBackfiresDeletes).toBe(true)
    const nd = (await buildBloomFilterReading({ bfNoDeletesNeeded: true }, now))!
    expect(nd.verdict.noDeletesNeededBackfiresDeletes).toBe(true)
    // 旧名兼容别名：bfZeroErrors→unlimitedRoom、bfDeleteImpossible→noDeletesNeeded，透传不静默失效
    const legacyZ = (await buildBloomFilterReading({ bfZeroErrors: true }, now))!
    expect(legacyZ.verdict.unlimitedRoomBackfiresCompactFootprint).toBe(true)
    const legacyD = (await buildBloomFilterReading({ bfDeleteImpossible: true }, now))!
    expect(legacyD.verdict.noDeletesNeededBackfiresDeletes).toBe(true)
    // rigged 齐开：三向量退 011·空间紧凑因果抹不掉，判词可证伪
    const rig = (await buildBloomFilterReading({ bfRigged: true }, now))!
    expect(rig.vectors).toEqual({ Bloom: '011', CountingBloom: '011', Cuckoo: '011' })
    expect(rig.verdict.compactFootprintCausallyUnerasable).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    // FP ceiling 双路自证 + 三路篡改真喂回
    expect(bf.crosscheck.fpCeiling.holds).toBe(true)
    expect(bf.crosscheck.fpCeiling.tamper.trustConfig.holds).toBe(false)
    expect(Object.keys(bf.crosscheck.evidence).length).toBe(21)
    // bloomFilter:false 关闭不连坐其它维
    const off = await buildSystems({ now, bloomFilter: false })
    expect(off.bloomFilter).toBe(null)
    expect(off.logCompaction).not.toBe(null)
    expect(off.backpressure).not.toBe(null)
    // 八时钟同源（systems + delayQueue/retryDlq/consumerGroup/backpressure/logCompaction/bloomFilter/builtAt）
    const full = await buildSystems({ now })
    const eight = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt]
    expect(eight.every((x) => x === 527000)).toBe(true)
  })

  it('⑲-cacheReplacement buildCacheReplacementReading 真跑：cr* 注入生效 / cacheReplacement:false 关闭 / rigged 因果锁可证伪 / 双路自证 + 十一真件 / 九时钟同源（KI-528）', async () => {
    const { buildCacheReplacementReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 528000
    const cr = (await buildCacheReplacementReading({}, now))!
    expect(cr).not.toBe(null)
    expect(cr.builtAt).toBe(528000)
    expect(cr.rows.length).toBe(3)
    expect(cr.config.scenarios.length).toBe(6)
    expect(cr.vectors).toEqual({ LRU: '010', '2Q': '110', ARC: '101' })
    // cr* 注入（crSeed/crCapacity/crAccesses），不复用被其它维占用的前缀
    const tuned = (await buildCacheReplacementReading({ crSeed: 9, crCapacity: 32, crAccesses: 128 }, now))!
    expect(tuned.config.seed).toBe(9)
    expect(tuned.config.capacity).toBe(32)
    expect(tuned.config.accesses).toBe(128)
    // 双开关单开：各自现算反噬，绝不硬造全 111
    const ur = (await buildCacheReplacementReading({ crUnlimitedRoom: true }, now))!
    expect(ur.verdict.trilemmaDistinguishes).toBe(false)
    const pf = (await buildCacheReplacementReading({ crPerfectFuture: true }, now))!
    expect(pf.vectors.LRU).toBe('110')
    // rigged 齐开：三向量退 110·自适应因果抹不掉，判词可证伪
    const rig = (await buildCacheReplacementReading({ crRigged: true }, now))!
    expect(rig.vectors).toEqual({ LRU: '110', '2Q': '110', ARC: '110' })
    expect(rig.verdict.adaptiveBalanceCausallyUnerasable).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    // 双路自证 + 三路篡改 + 十一真件 21 键
    expect((cr.crosscheck as any).dualSweep.holds).toBe(true)
    expect((cr.crosscheck as any).dualSweep.tamper.laneBSizedNull.holds).toBe(false)
    expect(Object.keys((cr.crosscheck as any).evidence).length).toBe(21)
    // cell 三布尔 + 考场标记直读同源
    const lru = cr.rows.find((r: any) => r.protocol === 'LRU')!
    expect(lru.scenarios.find((c: any) => c.id === 'scanFeast')!.scanResistance).toBe(false)
    // cacheReplacement:false 关闭不连坐
    const off = await buildSystems({ now, cacheReplacement: false })
    expect(off.cacheReplacement).toBe(null)
    expect(off.bloomFilter).not.toBe(null)
    // 九时钟同源
    const full = await buildSystems({ now })
    const nine = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt]
    expect(nine.every((x) => x === 528000)).toBe(true)
  })

  it('⑳-streamWindow buildStreamWindowReading 真跑：sw* 注入生效 / streamWindow:false 关闭 / rigged 因果锁可证伪 / 双路自证 + 十一真件 / 十时钟同源（KI-529）', async () => {
    const { buildStreamWindowReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 529000
    const sw = (await buildStreamWindowReading({}, now))!
    expect(sw).not.toBe(null)
    expect(sw.builtAt).toBe(529000)
    expect(sw.rows.length).toBe(3)
    expect(sw.config.scenarios.length).toBe(6)
    expect(sw.vectors).toEqual({ Tumbling: '011', Sliding: '110', Session: '101' })
    // sw* 注入（swSeed/swWindowSize/swSlideStep/swSessionGap/swAllowedLateness），不复用被其它维占用的前缀
    const tuned = (await buildStreamWindowReading({ swSeed: 9, swWindowSize: 80, swSlideStep: 20, swSessionGap: 30 }, now))!
    expect(tuned.config.seed).toBe(9)
    expect(tuned.config.windowSize).toBe(80)
    expect(tuned.config.slideStep).toBe(20)
    expect(tuned.config.sessionGap).toBe(30)
    // 单开关各自现算反噬
    const fz = (await buildStreamWindowReading({ swFrozenWatermark: true }, now))!
    expect(fz.verdict.frozenCollapsesCompleteness).toBe(true)
    const fr = (await buildStreamWindowReading({ swFreeState: true }, now))!
    expect(fr.verdict.freeRestoresSlidingState).toBe(true)
    const inf = (await buildStreamWindowReading({ swInfiniteLateness: true }, now))!
    expect(inf.verdict.infiniteRestoresSessionLate).toBe(true)
    // rigged 齐开：三向量退 011·结果完整因果抹不掉，判词可证伪
    const rig = (await buildStreamWindowReading({ swRigged: true }, now))!
    expect(rig.vectors).toEqual({ Tumbling: '011', Sliding: '011', Session: '011' })
    expect(rig.verdict.resultCompletenessCausallyUnerasable).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    // 双路自证 + 三路篡改 + 十一真件 21 键
    const wm = (sw.crosscheck as any).watermark
    expect(wm.holds).toBe(true)
    expect(wm.nontrivial).toBe(true)
    expect(wm.tamper.emptySet.holds).toBe(false)
    expect(Object.keys((sw.crosscheck as any).evidence).length).toBe(21)
    // cell 三布尔 + 考场标记直读同源
    const tum = sw.rows.find((r: any) => r.protocol === 'Tumbling')!
    expect(tum.scenarios.find((c: any) => c.id === 'boundaryStraddle')!.resultCompleteness).toBe(false)
    // streamWindow:false 关闭不连坐
    const off = await buildSystems({ now, streamWindow: false })
    expect(off.streamWindow).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    // 十时钟同源
    const full = await buildSystems({ now })
    const ten = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt]
    expect(ten.every((x) => x === 529000)).toBe(true)
  })

  it('㉑-cardinality buildCardinalityReading 真跑：hll* 注入生效 / hyperLogLog:false 关闭 / rigged 预言机可证伪 / 双路自证 + 十一真件 / 十一时钟同源（KI-530）', async () => {
    const { buildCardinalityReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 530000
    const hll = (await buildCardinalityReading({}, now))!
    expect(hll).not.toBe(null)
    expect(hll.builtAt).toBe(530000)
    expect(hll.rows.length).toBe(3)
    expect(hll.config.scenarios.length).toBe(6)
    expect(hll.vectors).toEqual({ ExactSet: '101', HyperLogLog: '110', LinearCounting: '010' })
    // hll* 注入（hllSeed/hllCardinality），不复用被其它维占用的前缀
    const tuned = (await buildCardinalityReading({ hllSeed: 7, hllCardinality: 2048 }, now))!
    expect(tuned.config.seed).toBe(7)
    expect(tuned.config.cardinality).toBe(2048)
    // 单开开关各自现算反噬
    const ph = (await buildCardinalityReading({ hllPerfectHash: true }, now))!
    expect(ph.verdict.perfectHashErasesError).toBe(true)
    expect(ph.vectors.HyperLogLog).toBe('110')
    const um = (await buildCardinalityReading({ hllUnlimitedMemory: true }, now))!
    expect(um.verdict.unlimitedRoomErasesGrowth).toBe(true)
    expect(um.vectors.ExactSet).toBe('111')
    // rigged 齐开：ExactSet 真收敛 111（预言机合并），HLL/LC 仍 110/010；causal 抹不掉饱和量
    const rig = (await buildCardinalityReading({ hllRigged: true }, now))!
    expect(rig.vectors).toEqual({ ExactSet: '111', HyperLogLog: '110', LinearCounting: '010' })
    expect(rig.verdict.linearCountingSaturationCausallyUnerasable).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.trilemmaDistinguishes).toBe(true)
    // 双路自证 + 三路篡改 + 十一真件 21 键
    const est = (hll.crosscheck as any).estimate
    expect(est.holds).toBe(true)
    expect(est.nontrivial).toBe(true)
    expect(est.tamper.emptySet.holds).toBe(false)
    expect(Object.keys((hll.crosscheck as any).evidence).length).toBe(21)
    // cell 三布尔 + 考场标记直读同源
    const lc = hll.rows.find((r: any) => r.protocol === 'LinearCounting')!
    expect(lc.scenarios.find((c: any) => c.id === 'highFill')!.estimatorAccuracy).toBe(false)
    // hyperLogLog:false 关闭不连坐
    const off = await buildSystems({ now, hyperLogLog: false, streamWindow: false })
    expect(off.hyperLogLog).toBe(null)
    expect(off.streamWindow).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    // 十一时钟同源
    const full = await buildSystems({ now })
    const eleven = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt]
    expect(eleven.every((x) => x === 530000)).toBe(true)
  })

  it('㉑-hyperLogLog buildCardinalityReading 真跑：hll* 注入生效 / hyperLogLog:false 关闭 / rigged 因果锁可证伪 / 双路自证 + 十一真件 / 十一时钟同源（KI-530）', async () => {
    const { buildCardinalityReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 530000
    const h = (await buildCardinalityReading({}, now))!
    expect(h).not.toBe(null)
    expect(h.builtAt).toBe(530000)
    expect(h.rows.length).toBe(3)
    expect(h.config.scenarios.length).toBe(6)
    expect(h.vectors).toEqual({ ExactSet: '101', HyperLogLog: '110', LinearCounting: '010' })
    // hll* 注入（hllSeed/hllCardinality/hllMRegisters），不复用被其它维占用的前缀
    const tuned = (await buildCardinalityReading({ hllSeed: 9, hllCardinality: 4096, hllMRegisters: 1024 }, now))!
    expect(tuned.config.seed).toBe(9)
    // 单开关各自现算反噬：LC 位图饱和因果锁死，perfectHash 抹不掉
    const ph = (await buildCardinalityReading({ hllPerfectHash: true }, now))!
    expect(ph.verdict.perfectHashErasesError).toBe(true)
    expect(ph.vectors.LinearCounting).toBe('010')
    const um = (await buildCardinalityReading({ hllUnlimitedMemory: true }, now))!
    expect(um.verdict.unlimitedRoomErasesGrowth).toBe(true)
    expect(um.vectors.ExactSet).toBe('111')
    // rigged 齐开：现算 111/110/010、LC 饱和因果抹不掉、绝不硬造全策略 111
    const rig = (await buildCardinalityReading({ hllRigged: true }, now))!
    expect(rig.vectors).toEqual({ ExactSet: '111', HyperLogLog: '110', LinearCounting: '010' })
    expect(rig.verdict.linearCountingSaturationCausallyUnerasable).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    // 双路自证 + 三路篡改 + 十一真件 21 键
    const ve = (h.crosscheck as any).estimate
    expect(ve.holds).toBe(true)
    expect(ve.nontrivial).toBe(true)
    expect(ve.tamper.registerCorrupted.holds).toBe(false)
    expect(ve.tamper.bitsTooBig.holds).toBe(false)
    expect(ve.tamper.emptySet.holds).toBe(false)
    expect(Object.keys((h.crosscheck as any).evidence).length).toBe(21)
    expect((h.crosscheck as any).evidence.jitterSpread).toBeGreaterThanOrEqual(0)
    // hyperLogLog:false 关闭不连坐
    const off = await buildSystems({ now, hyperLogLog: false })
    expect(off.hyperLogLog).toBe(null)
    expect(off.streamWindow).not.toBe(null)
    // 十一时钟同源
    const full = await buildSystems({ now })
    const eleven = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt]
    expect(eleven.every((x) => x === 530000)).toBe(true)
  })

  it('㉒-crdt buildCrdtReading 真跑：crdt* 注入生效 / crdt:false 关闭 / rigged 因果锁可证伪 / 双路自证 + 十一真件 / 十二时钟同源（KI-531）', async () => {
    const { buildCrdtReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 531000
    const crdt = (await buildCrdtReading({}, now))!
    expect(crdt).not.toBe(null)
    expect(crdt.builtAt).toBe(531000)
    expect(crdt.rows.length).toBe(3)
    expect(crdt.config.scenarios.length).toBe(6)
    expect(crdt.vectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    expect(crdt.baseVectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    const tuned = (await buildCrdtReading({ crdtSeed: 12, crdtOpsPerNode: 24 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.opsPerNode).toBe(24)
    const rig = (await buildCrdtReading({ crdtRigged: true }, now))!
    // rigged 三开关齐开：唯一翻 GCounter compact（100→101），三因果锁钉死，主教义不破
    expect(rig.vectors).toEqual({ LWWRegister: '011', GCounter: '101', OrSet: '110' })
    expect(rig.baseVectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    expect(rig.verdict.decrementCausallyUnerasable).toBe(true)
    expect(rig.verdict.lwwConcurrentLossCausallyUnerasable).toBe(true)
    expect(rig.verdict.orSetTagHistoryCausallyUnerasable).toBe(true)
    expect(rig.verdict.causalLocksAllHold).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(true)
    expect(rig.verdict.noUniversalWinnerStrict).toBe(true)
    const conv = (crdt.crosscheck as any).convergence
    expect(conv.holds).toBe(true)
    expect(conv.nontrivial).toBe(true)
    expect(conv.tamper.emptySet.holds).toBe(false)
    expect(Object.keys((crdt.crosscheck as any).evidence).length).toBe(21)
    const off = await buildSystems({ now, crdt: false, hyperLogLog: false })
    expect(off.crdt).toBe(null)
    expect(off.hyperLogLog).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const twelve = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt]
    expect(twelve.every((x) => x === 531000)).toBe(true)
  })

  it('㉒b-spring-batch buildSpringBatchReading 真跑：sb* 注入生效 / springBatch:false 关闭 / rigged 诚实收敛不硬造 111 / 双路自证 + 三路篡改真喂回 + 三因果锁 + 十一真件 / 十三时钟同源（KI-532）', async () => {
    const { buildSpringBatchReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 532000
    const sb = (await buildSpringBatchReading({}, now))!
    expect(sb).not.toBe(null)
    expect(sb.builtAt).toBe(532000)
    expect(sb.rows.length).toBe(3)
    expect(sb.config.scenarios.length).toBe(6)
    expect(sb.vectors).toEqual({ BulkWriter: '001', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(sb.rigged).toBe(false)
    expect(sb.noUniversalWinner).toBe(true)
    expect(sb.trilemmaDistinguishes).toBe(true)
    expect(sb.causalLocks.causalLocksAllHold).toBe(true)
    // 注入 items/chunkSize/skipLimit/seed 真生效（不是只改 config 显示）
    const tuned = (await buildSpringBatchReading({ sbSeed: 12, sbItems: 64, sbChunkSize: 16, sbSkipLimit: 5 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.items).toBe(64)
    expect(tuned.config.chunkSize).toBe(16)
    expect(tuned.config.skipLimit).toBe(5)
    expect(tuned.rows[0].scenarios[0].size).toBe(64)
    // rigged：预防剔除毒项干净流 ⇒ Bulk≡Skip=101 区分度诚实收敛、noStrategyWinsAll 仍真绝不硬造 111、三锁仍钉死
    const rig = (await buildSpringBatchReading({ sbRigged: true }, now))!
    expect(rig.vectors).toEqual({ BulkWriter: '101', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(rig.rigged).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)        // 区分度坍塌（诚实标注）
    expect(rig.trilemmaDistinguishes).toBe(false)
    expect(rig.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(true)         // 仍无一 111
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)    // 三锁与 rigged 输入无关
    // verifyCheckpoint 双路自证 + 三路篡改真喂回现算翻 false（带 baselineHolds）
    const cp = sb.crosscheck.checkpoint
    expect(cp.holds).toBe(true)
    expect(cp.baselineHolds).toBe(true)
    expect(cp.nontrivial).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.corruptedCheckpoint.holds).toBe(false)
    expect(cp.tamper.silentPoison.holds).toBe(false)
    expect(cp.tamper.emptyJob.holds).toBe(false)
    expect(Object.keys(sb.crosscheck.evidence).length).toBe(21)
    expect((sb.crosscheck.evidence as any).jitterSpread).toBeGreaterThan(0)
    // 关闭不连坐
    const off = await buildSystems({ now, springBatch: false, crdt: false })
    expect(off.springBatch).toBe(null)
    expect(off.crdt).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    // 十三时钟同源
    const full = await buildSystems({ now })
    const thirteen = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt]
    expect(thirteen.every((x) => x === 532000)).toBe(true)
  })

  it('㉒e-distributed-session buildDistributedSessionReading 真跑：ds* 注入生效 / distributedSession:false 关闭 / rigged 收敛明示粘性短板 / 双路自证 + 三路篡改真喂回 + 三因果锁 + 十一真件 / 十五时钟同源（KI-535）', async () => {
    const { buildDistributedSessionReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 535000
    const ds = (await buildDistributedSessionReading({}, now))!
    expect(ds).not.toBe(null)
    expect(ds.builtAt).toBe(535000)
    expect(ds.rows.length).toBe(3)
    expect(ds.config.scenarios.length).toBe(6)
    expect(ds.vectors).toEqual({ StickySession: '011', JwtStateless: '101', RedisSessionStore: '110' })
    expect(ds.rigged).toBe(false)
    expect(ds.noUniversalWinner).toBe(true)
    expect(ds.trilemmaDistinguishes).toBe(true)
    expect(ds.causalLocks.causalLocksAllHold).toBe(true)
    // 注入 sessions/sessions/ttlMs/seed 真生效（不是只改 config 显示）
    const tuned = (await buildDistributedSessionReading({ dsSeed: 12, dsSessions: 32, dsTtlMs: 1234 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.sessions).toBe(32)
    expect(tuned.config.ttlMs).toBe(1234)
    // rigged 三开齐：Sticky≡JWT=111 区分度诚实塌缩、Redis 仍 110、noUniversalWinner=false（绝不硬造默认 111）
    const rig = (await buildDistributedSessionReading({ dsRigged: true }, now))!
    expect(rig.vectors).toEqual({ StickySession: '111', JwtStateless: '111', RedisSessionStore: '110' })
    expect(rig.rigged).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(false)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
    // verifySessionCoherence 双路自证 + 三路篡改真翻 false
    const cp = ds.crosscheck.coherence
    expect(cp.holds).toBe(true)
    expect(cp.nontrivial).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.corruptedSession.holds).toBe(false)
    expect(cp.tamper.silentRevoke.holds).toBe(false)
    expect(cp.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(ds.crosscheck.evidence).length).toBe(21)
    // 关闭不连坐
    const off = await buildSystems({ now, distributedSession: false, springBatch: false, traceSampling: false, crdt: false })
    expect(off.distributedSession).toBe(null)
    expect(off.springBatch).toBe(null)
    expect(off.traceSampling).toBe(null)
    expect(off.crdt).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    // 十五时钟同源
    const full = await buildSystems({ now })
    const fifteen = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt]
    expect(fifteen.every((x) => x === 535000)).toBe(true)
  })

  it('㉒e-transactional-outbox buildTransactionalOutboxReading 真跑：to* 注入生效 / transactionalOutbox:false 关闭 / rigged 收敛明示 / 双路自证 + 十一真件 / 十六时钟同源（KI-534）', async () => {
    const { buildTransactionalOutboxReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 536000
    const ob = (await buildTransactionalOutboxReading({}, now))!
    expect(ob).not.toBe(null)
    expect(ob.builtAt).toBe(536000)
    expect(ob.rows.length).toBe(3)
    expect(ob.config.scenarios.length).toBe(6)
    expect(ob.vectors).toEqual({ DualWrite: '011', PollingOutbox: '101', CdcOutbox: '110' })
    expect(ob.rigged).toBe(false)
    expect(ob.noUniversalWinner).toBe(true)
    expect(ob.trilemmaDistinguishes).toBe(true)
    expect(ob.causalLocks.causalLocksAllHold).toBe(true)
    const tuned = (await buildTransactionalOutboxReading({ toSeed: 12, toItems: 32, toPollInterval: 8 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.items).toBe(32)
    expect(tuned.config.pollInterval).toBe(8)
    const rig = (await buildTransactionalOutboxReading({ toRigged: true }, now))!
    expect(rig.vectors).toEqual({ DualWrite: '011', PollingOutbox: '110', CdcOutbox: '110' })
    expect(rig.rigged).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(true)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
    const cp = ob.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.nontrivial).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.forgedCommit.holds).toBe(false)
    expect(cp.tamper.silentDrop.holds).toBe(false)
    expect(cp.tamper.duplicateRelease.holds).toBe(false)
    expect(Object.keys(ob.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, transactionalOutbox: false, distributedSession: false })
    expect(off.transactionalOutbox).toBe(null)
    expect(off.distributedSession).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const sixteen = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt]
    expect(sixteen.every((x) => x === 536000)).toBe(true)
  })

  it('㉒f-load-balance buildLoadBalanceReading 真跑：lb* 注入生效 / loadBalance:false 关闭 / rigged 收敛明示 / 双路自证 + 十一真件 / 十七时钟同源（KI-536）', async () => {
    const { buildLoadBalanceReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 537000
    const lb = (await buildLoadBalanceReading({}, now))!
    expect(lb).not.toBe(null)
    expect(lb.builtAt).toBe(537000)
    expect(lb.rows.length).toBe(3)
    expect(lb.config.scenarios.length).toBe(6)
    expect(lb.config.virtualNodes).toBe(16)
    expect(lb.vectors).toEqual({ WeightedRoundRobin: '101', LeastConnections: '100', ConsistentHash: '011' })
    expect(lb.rigged).toBe(false)
    expect(lb.noUniversalWinner).toBe(true)
    expect(lb.trilemmaDistinguishes).toBe(true)
    expect(lb.causalLocks.causalLocksAllHold).toBe(true)
    const tuned = (await buildLoadBalanceReading({ lbSeed: 12, lbRequests: 32, lbVirtualNodes: 4, lbCapacity: [2, 1] }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.requests).toBe(32)
    expect(tuned.config.virtualNodes).toBe(4)
    expect(tuned.config.capacity).toEqual([2, 1])
    const rig = (await buildLoadBalanceReading({ lbRigged: true }, now))!
    expect(rig.vectors).toEqual({ WeightedRoundRobin: '101', LeastConnections: '101', ConsistentHash: '111' })
    expect(rig.rigged).toBe(true)
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(false)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
    const cp = lb.crosscheck.routing
    expect(cp.holds).toBe(true)
    expect(cp.nontrivial).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.emptyRing.holds).toBe(false)
    expect(cp.tamper.silentAffinityDrop.holds).toBe(false)
    expect(cp.tamper.emptyEvents.holds).toBe(false)
    expect(Object.keys(lb.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, loadBalance: false, transactionalOutbox: false, distributedSession: false })
    expect(off.loadBalance).toBe(null)
    expect(off.transactionalOutbox).toBe(null)
    expect(off.distributedSession).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const seventeen = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt]
    expect(seventeen.every((x) => x === 537000)).toBe(true)
  })

  it('㉒g-circuit-breaker buildCircuitBreakerReading 真跑：cb* 注入生效 / circuitBreaker:false 关闭 / rigged 不动向量 / 双路自证 + 十一真件 / 十八时钟同源（KI-537）', async () => {
    const { buildCircuitBreakerReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 537500
    const c = (await buildCircuitBreakerReading({}, now))!
    expect(c).not.toBe(null)
    expect(c.builtAt).toBe(537500)
    expect(c.rows.length).toBe(3)
    expect(c.config.scenarios.length).toBe(6)
    expect(c.config.windowSize).toBe(16)
    expect(c.vectors).toEqual({ CountBasedBreaker: '100', RateBasedBreaker: '101', SlowCallBreaker: '011' })
    expect(c.rigged).toBe(false)
    expect(c.noUniversalWinner).toBe(true)
    expect(c.trilemmaDistinguishes).toBe(true)
    expect(c.causalLocks.causalLocksAllHold).toBe(true)
    expect(c.causalLocks.countThresholdIgnoresSlowCausallyUnerasable).toBe(true)
    expect(c.causalLocks.rateThresholdRequiresSampleCausallyUnerasable).toBe(true)
    expect(c.causalLocks.slowCallIgnoresHardFaultsCausallyUnerasable).toBe(true)
    const tuned = (await buildCircuitBreakerReading({ cbSeed: 12, cbCalls: 32, cbWindowSize: 8, cbSlowThresholdMs: 500 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.calls).toBe(32)
    expect(tuned.config.windowSize).toBe(8)
    expect(tuned.config.slowThresholdMs).toBe(500)
    const rig = (await buildCircuitBreakerReading({ cbRigged: true }, now))!
    expect(rig.vectors).toEqual({ CountBasedBreaker: '100', RateBasedBreaker: '101', SlowCallBreaker: '011' })
    expect(rig.rigged).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(true)
    expect(rig.verdict.riggedConvergenceCollapsed).toBe(false)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
    const cp = c.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.nontrivial).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.forgedLatency.holds).toBe(false)
    expect(cp.tamper.silentFailuresIgnored.holds).toBe(false)
    expect(cp.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(c.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, circuitBreaker: false, loadBalance: false })
    expect(off.circuitBreaker).toBe(null)
    expect(off.loadBalance).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const eighteen = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt]
    expect(eighteen.every((x) => x === 537500)).toBe(true)
  })

  it('㉒h-llm-gateway buildLlmGatewayReading 真跑：**默认 offline、绝不暗调** / llmGateway:false 关闭 / 注入规模恒 offline / 双路自证 + 十一真件 / 十九时钟同源（KI-538）', async () => {
    const { buildLlmGatewayReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 538500
    const g = (await buildLlmGatewayReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(538500)
    expect(g.config.mode).toBe('offline')
    expect(g.rows.length).toBe(3)
    expect(g.vectors).toEqual({ OfflineDouble: '011', LiveGrounded: '000', CachedLive: '000' })
    expect(g.rigged).toBe(false)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    // 五因果锁与核心件 caesura-llm-gateway.mjs / .d.mts 逐字同名同源（不得臆造锁名、不得只挑三枚漏测）
    for (const lock of ['offlineZeroCostCausallyUnerasable', 'offlineReproducibleCausallyUnerasable',
      'badJsonNeverGroundedCausallyUnerasable', 'cachedHitReproducibleCausallyUnerasable',
      'firstCallCostCausallyUnerasable'] as const) {
      expect(g.causalLocks[lock], '因果锁 ' + lock).toBe(true)
    }
    // 注入 seed 真生效（依然 offline）
    const tuned = (await buildLlmGatewayReading({ lgSeed: 12 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.mode).toBe('offline')
    // 双路自证 + 三路篡改
    const cp = g.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.missingKey.holds).toBe(false)
    expect(cp.tamper.badEndpoint.holds).toBe(false)
    expect(cp.tamper.badJson.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, llmGateway: false, circuitBreaker: false })
    expect(off.llmGateway).toBe(null)
    expect(off.circuitBreaker).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const nineteen = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt, full.llmGateway?.builtAt]
    expect(nineteen.every((x) => x === 538500)).toBe(true)
  })

  it('㉒i-gateway-routing buildGatewayRoutingReading 真跑：gr* 注入生效 / gatewayRouting:false 关闭 / rigged 不硬造 111 / 双路自证 + 十一真件 / 二十时钟同源（KI-539）', async () => {
    const { buildGatewayRoutingReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 539500
    const g = (await buildGatewayRoutingReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(539500)
    expect(g.rows.length).toBe(3)
    expect(g.config.requests).toBe(96)
    expect(g.vectors).toEqual({ PathPrefixRouting: '001', RegexCaptureRouting: '110', HeaderGroupRouting: '101' })
    expect(g.rigged).toBe(false)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    expect(g.causalLocks.pathPrefixMatchingConflictsCausallyUnerasable).toBe(true)
    expect(g.causalLocks.regexCaptureExtraCostCausallyUnerasable).toBe(true)
    expect(g.causalLocks.headerGroupHeaderDependencyCausallyUnerasable).toBe(true)
    const tuned = (await buildGatewayRoutingReading({ grSeed: 12, grRequests: 32 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.requests).toBe(32)
    const rig = (await buildGatewayRoutingReading({ grRigged: true }, now))!
    expect(rig.vectors.PathPrefixRouting).toBe('111')
    expect(rig.rigged).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(false)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
    const cp = g.crosscheck.routing
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.missingRoutes.holds).toBe(false)
    expect(cp.tamper.tryStrTruncation.holds).toBe(false)
    expect(cp.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, gatewayRouting: false, llmGateway: false })
    expect(off.gatewayRouting).toBe(null)
    expect(off.llmGateway).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })

    const twenty = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt, full.llmGateway?.builtAt, full.gatewayRouting?.builtAt]
    expect(twenty.every((x) => x === 539500)).toBe(true)
  })

  it('㉒j-idempotent-consumer buildIdempotentConsumerReading 真跑：idc* 注入生效 / idempotentConsumer:false 关闭 / rigged 不硬造 111 / 双路自证 + 十一真件 / 二十一时钟同源（KI-540）', async () => {
    const { buildIdempotentConsumerReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 540500
    const g = (await buildIdempotentConsumerReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(540500)
    expect(g.rows.length).toBe(3)
    expect(g.config.messages).toBe(96)
    expect(g.vectors).toEqual({ InMemoryDedupSet: '110', RedisSetNx: '101', BloomGuard: '011' })
    expect(g.rigged).toBe(false)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    expect(g.causalLocks.bloomFalsePositiveCausallyUnerasable).toBe(true)
    expect(g.causalLocks.redisRttCausallyUnerasable).toBe(true)
    expect(g.causalLocks.inMemoryVolatilityCausallyUnerasable).toBe(true)
    const tuned = (await buildIdempotentConsumerReading({ idcSeed: 12, idcMessages: 32 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.messages).toBe(32)
    const rig = (await buildIdempotentConsumerReading({ idcRigged: true }, now))!
    expect(rig.vectors.RedisSetNx).toBe('111')
    expect(rig.rigged).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(false)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
    const cp = g.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.duplicateInvisible.holds).toBe(false)
    expect(cp.tamper.forgedDedupHit.holds).toBe(false)
    expect(cp.tamper.emptyStream.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, idempotentConsumer: false, gatewayRouting: false })
    expect(off.idempotentConsumer).toBe(null)
    expect(off.gatewayRouting).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const twentyone = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt, full.llmGateway?.builtAt, full.gatewayRouting?.builtAt, full.idempotentConsumer?.builtAt]
    expect(twentyone.every((x) => x === 540500)).toBe(true)
  })
  it('㉒c-trace-sampling buildTraceSamplingReading 真跑：ts* 注入生效 / traceSampling:false 关闭 / rigged Head≡Tail=110 诚实塌缩不硬造 111 / 双路自证 + 三路篡改真喂回 + 三因果锁 + 十一真件 / 十四时钟同源（KI-533）', async () => {
    const { buildTraceSamplingReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 533000
    const ts = (await buildTraceSamplingReading({}, now))!
    expect(ts).not.toBe(null)
    expect(ts.builtAt).toBe(533000)
    expect(ts.rows.length).toBe(3)
    expect(ts.config.scenarios.length).toBe(6)
    expect(ts.vectors).toEqual({ HeadBasedSampler: '100', TailBasedSampler: '010', AdaptiveSampler: '101' })
    expect(ts.rigged).toBe(false)
    expect(ts.noUniversalWinner).toBe(true)
    expect(ts.trilemmaDistinguishes).toBe(true)
    expect(ts.causalLocks.causalLocksAllHold).toBe(true)
    expect(ts.causalLocks.decisionInvariant).toBe(true)
    // 注入 items/rate/windowSize/seed 真生效（不是只改 config 显示）
    const tuned = (await buildTraceSamplingReading({ tsSeed: 12, tsItems: 64, tsRate: 0.3, tsWindowSize: 8 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.items).toBe(64)
    expect(tuned.config.rate).toBe(0.3)
    expect(tuned.config.windowSize).toBe(8)
    // rigged：三开关分策略正交反事实 ⇒ Head≡Tail=110 区分度诚实塌缩、noStrategyWinsAll 仍真绝不硬造 111、三锁仍钉死
    const rig = (await buildTraceSamplingReading({ tsRigged: true }, now))!
    expect(rig.vectors).toEqual({ HeadBasedSampler: '110', TailBasedSampler: '110', AdaptiveSampler: '101' })
    expect(rig.rigged).toBe(true)
    expect(rig.noUniversalWinner).toBe(false)              // 区分度坍塌（诚实标注）
    expect(rig.trilemmaDistinguishes).toBe(false)
    expect(rig.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(true)       // 仍无一 111
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)  // 三锁与 rigged 输入无关
    // verifySamplingSoundness 双路自证 + 三路篡改真喂回现算翻 false（带 baselineHolds）
    const sm = ts.crosscheck.soundness
    expect(sm.holds).toBe(true)
    expect(sm.baselineHolds).toBe(true)
    expect(sm.nontrivial).toBe(true)
    expect(sm.falsifiable).toBe(true)
    expect(sm.tamper.forgedErrorSpan.holds).toBe(false)
    expect(sm.tamper.duplicateRelease.holds).toBe(false)
    expect(sm.tamper.emptyTraceSet.holds).toBe(false)
    expect(Object.keys(ts.crosscheck.evidence).length).toBe(21)
    expect((ts.crosscheck.evidence as any).jitterSpread).toBeGreaterThan(0)
    // 关闭不连坐
    const off = await buildSystems({ now, traceSampling: false, springBatch: false })
    expect(off.traceSampling).toBe(null)
    expect(off.springBatch).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    // 十四时钟同源
    const full = await buildSystems({ now })
    const fourteen = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt]
    expect(fourteen.every((x) => x === 533000)).toBe(true)
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

  it('buildDelayQueueReading 单开 dqZeroTick 只让时间轮精确、dq rigged 向量现算 111/111/001；单维关闭不连坐（KI-518）', async () => {
    const { buildSystems, buildDelayQueueReading, buildSnapshot } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 4242
    const zero = (await buildDelayQueueReading({ dqZeroTick: true }, now)) as NonNullable<Awaited<ReturnType<typeof buildDelayQueueReading>>>
    expect(zero.vectors).toEqual({ TimingWheel: '110', MinHeap: '010', RedisZset: '001' }) // 时间轮恒 lowCost=1，补 punctual ⇒ 110，仍缺共享持久
    // rigged 三开关齐开：向量由 trilemma 现算，ZSET 轮询软肋抹不掉 ⇒ 111/111/001，非硬覆盖全 111
    const rig = (await buildDelayQueueReading({ dqZeroTick: true, dqFreeHeapOps: true, dqSharedBackend: true }, now))!
    expect(rig.vectors).toEqual({ TimingWheel: '111', MinHeap: '111', RedisZset: '001' })
    for (const row of rig.rows) {
      const recomputed = `${Number(row.trilemma.lowCost)}${Number(row.trilemma.punctual)}${Number(row.trilemma.sharedDurable)}`
      expect(rig.vectors[row.protocol]).toBe(recomputed)
    }
    // 单维关闭落 null，不连坐第十五维
    const sys = await buildSystems({ now, delayQueue: false })
    expect(sys.delayQueue).toBe(null)
    expect(sys.messageDelivery).toBeTruthy() // 不连坐 KI-513
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, delayQueue: false })
    expect(snap.systems!.delayQueue).toBe(null)
    expect(snap.systems!.messageDelivery).toBeTruthy()
  })

  it('buildRetryDlqReading 真跑三协议×六场景矩阵 + 七枚真件交叉印证、注入时钟/规模/rigged 生效、单维关闭不连坐（KI-520）', async () => {
    const { buildRetryDlqReading, buildSystems, buildSnapshot } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 9393
    const reading = (await buildRetryDlqReading({}, now)) as NonNullable<Awaited<ReturnType<typeof buildRetryDlqReading>>>
    expect(reading).not.toBe(null)
    expect(reading.builtAt).toBe(9393)                          // 注入时钟真求值（KI-517 契约延伸）
    expect(reading.vectors).toEqual({ Immediate: '100', Exponential: '010', FullJitter: '011' })
    expect(reading.rows.length).toBe(3)
    expect(reading.rows[0].scenarios.length).toBe(6)
    expect(reading.config.messages).toBe(16)                    // 缺省规模
    expect(Object.keys(reading.crosscheck.evidence).sort()).toEqual(['bucketAllowed', 'bucketRejected', 'busListeners', 'deadNotices', 'hashRingEmptyNodes', 'hashRingNodes', 'heapFired', 'idemEntries', 'poolAcquired', 'walLines', 'walReplayed'])
    expect(reading.crosscheck.evidence.heapFired).toBe(12)
    expect(reading.crosscheck.evidence.walReplayed).toBe(3)
    expect(reading.verdict.noUniversalWinner).toBe(true)
    expect(reading.verdict.fullJitterNotFreeLunch).toBe(true)
    // 注入规模真生效：config 逐项带出，且向量随规模诚实地变（baseTicks=2 让 FullJitter 首档打散不足丢 noHerd、maxAttempts=3 让 Immediate 施压降到预算内）——不硬套默认向量
    const scaled = (await buildRetryDlqReading({ rdlqMessages: 8, rdlqMaxAttempts: 3, rdlqBaseTicks: 2 }, now))!
    expect(scaled.config.messages).toBe(8)
    expect(scaled.config.maxAttempts).toBe(3)
    expect(scaled.config.baseTicks).toBe(2)
    expect(scaled.vectors).toEqual({ Immediate: '110', Exponential: '010', FullJitter: '010' })
    for (const row of scaled.rows) {
      const recomputed = `${Number(row.trilemma.fastRecovery)}${Number(row.trilemma.noStorm)}${Number(row.trilemma.noHerd)}`
      expect(scaled.vectors[row.protocol]).toBe(recomputed)      // 规模变了向量仍由 trilemma 现算
    }
    // rigged 三开关：向量由 trilemma 现算 101/101/101、判词翻 false、noStorm 因果抹不掉
    const rig = (await buildRetryDlqReading({ rdlqZeroBackoff: true, rdlqPerfectJitter: true, rdlqNoRetryBudget: true }, now))!
    expect(rig.vectors).toEqual({ Immediate: '101', Exponential: '101', FullJitter: '101' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.trilemmaDistinguishes).toBe(false)
    expect(rig.verdict.noStormCausallyUnerasable).toBe(true)
    for (const row of rig.rows) {
      const recomputed = `${Number(row.trilemma.fastRecovery)}${Number(row.trilemma.noStorm)}${Number(row.trilemma.noHerd)}`
      expect(rig.vectors[row.protocol]).toBe(recomputed)
    }
    // 单维关闭落 null，不连坐第十六维
    const sys = await buildSystems({ now, retryDlq: false })
    expect(sys.retryDlq).toBe(null)
    expect(sys.delayQueue).toBeTruthy() // 不连坐 KI-518
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, retryDlq: false })
    expect(snap.systems!.retryDlq).toBe(null)
    expect(snap.systems!.delayQueue).toBeTruthy()
  })

  it('buildConsumerGroupReading 真跑三协议×六场景 + 正交三难向量 + 九真件、注入时钟/规模/rigged 生效、单维关闭不连坐（KI-523）', async () => {
    const { buildConsumerGroupReading, buildSystems, buildSnapshot } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 9393
    const reading = (await buildConsumerGroupReading({}, now)) as NonNullable<Awaited<ReturnType<typeof buildConsumerGroupReading>>>
    expect(reading).not.toBe(null)
    expect(reading.builtAt).toBe(9393)                          // 注入时钟真求值（KI-517 契约延伸）
    expect(reading.vectors).toEqual({ Range: '001', RoundRobin: '100', Sticky: '110' })
    expect(reading.rows.length).toBe(3)
    expect(reading.rows[0].scenarios.length).toBe(6)
    expect(Object.keys(reading.crosscheck.evidence).sort()).toEqual(['bucketAllowed', 'bucketRejected', 'busListeners', 'groupMetaEntries', 'hashRingEmptyNodes', 'hashRingNodes', 'heapFired', 'poolAcquired', 'rebalanceNotices', 'remapConsistentRate', 'remapModuloRate', 'remapSavedRate', 'routerMoved', 'routerRate', 'walLines', 'walReplayed'])
    expect(reading.crosscheck.evidence.walReplayed).toBeGreaterThan(0)
    expect(reading.verdict.noUniversalWinner).toBe(true)
    expect(reading.verdict.rangeCheapest).toBe(true)
    expect(reading.verdict.rangeSkews).toBe(true)
    expect(reading.verdict.roundRobinBalanced).toBe(true)
    expect(reading.verdict.roundRobinMigrates).toBe(true)
    expect(reading.verdict.stickyMinimalMovement).toBe(true)
    expect(reading.verdict.stickyNotFreeLunch).toBe(true)
    expect(reading.verdict.steadyStateVacuousTrue).toBe(true)
    // 向量恒由 row.trilemma 现算（与矩阵同源，杜绝硬覆盖撒谎）
    for (const row of reading.rows) {
      const recomputed = `${Number(row.trilemma.balanced)}${Number(row.trilemma.minimalMovement)}${Number(row.trilemma.cheap)}`
      expect(reading.vectors[row.protocol]).toBe(recomputed)
      // 每格三正交布尔齐备
      for (const c of row.scenarios) {
        expect(typeof c.balanced).toBe('boolean')
        expect(typeof c.minimalMovement).toBe('boolean')
        expect(typeof c.cheap).toBe('boolean')
      }
    }
    // 规模注入真生效：config 逐项带出，向量随规模诚实地变（bigPartitions=12 让 Range 首档省不住 cheap）——不硬套默认向量
    const scaled = (await buildConsumerGroupReading({ cgpBigPartitions: 12, cgpBigConsumers: 4, cgpMovePartitions: 6, cgpSeed: 77 }, now))!
    expect(scaled.config.bigPartitions).toBe(12)
    expect(scaled.config.bigConsumers).toBe(4)
    expect(scaled.config.movePartitions).toBe(6)
    expect(scaled.config.seed).toBe(77)
    for (const row of scaled.rows) {
      const recomputed = `${Number(row.trilemma.balanced)}${Number(row.trilemma.minimalMovement)}${Number(row.trilemma.cheap)}`
      expect(scaled.vectors[row.protocol]).toBe(recomputed)      // 规模变了向量仍由 trilemma 现算
    }
    // rigged 三开关：向量由 trilemma 现算 101/101/101、判词翻 false、minimalMovement 因果抹不掉
    const rig = (await buildConsumerGroupReading({ cgpPerfectBalance: true, cgpZeroMovement: true, cgpFreeCompute: true }, now))!
    expect(rig.vectors).toEqual({ Range: '101', RoundRobin: '101', Sticky: '101' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.trilemmaDistinguishes).toBe(false)
    expect(rig.verdict.minimalMovementCausallyUnerasable).toBe(true)
    for (const row of rig.rows) {
      const recomputed = `${Number(row.trilemma.balanced)}${Number(row.trilemma.minimalMovement)}${Number(row.trilemma.cheap)}`
      expect(rig.vectors[row.protocol]).toBe(recomputed)
    }
    // 单开 zeroMovement：冻结归属⇒新成员饥饿，balanced 反噬；单开 freeCompute 只抬 cheap
    const zm = (await buildConsumerGroupReading({ cgpZeroMovement: true }, now))!
    expect(zm.verdict.zeroMovementStarvesJoiner).toBe(true)
    expect(zm.verdict.minimalMovementCausallyUnerasable).toBe(false) // 未叠 perfectBalance，不触发因果锁
    const fc = (await buildConsumerGroupReading({ cgpFreeCompute: true }, now))!
    expect(fc.rows.every((r: any) => r.trilemma.cheap === true)).toBe(true) // freeCompute 只抹 cheap 维
    // 单维关闭落 null，不连坐第十六/十七维
    const sys = await buildSystems({ now, consumerGroup: false })
    expect(sys.consumerGroup).toBe(null)
    expect(sys.delayQueue).toBeTruthy()  // 不连坐 KI-518
    expect(sys.retryDlq).toBeTruthy()    // 不连坐 KI-520
    const snap = await buildSnapshot({ runner: fakeRunner(), driveNet: false, now: () => 1, consumerGroup: false })
    expect(snap.systems!.consumerGroup).toBe(null)
    expect(snap.systems!.delayQueue).toBeTruthy()
    expect(snap.systems!.retryDlq).toBeTruthy()
  })

  /* ---------------- ㉞㉟㊱ KI-515 控制台快照 CLI 真跑时钟确定性 ---------------- */
  const CLI = fileURLToPath(new URL('../../scripts/caesura-console-gen.mjs', import.meta.url))
  const TMP = resolve(' .scratch/ki515-test'.trim())  // 项目内 gitignore 目录，Node/Python 互通
  const FIXED = 1700000000000
  const runCli = (tag: string, now: number | null): { snap: any; snapRaw: string; bootRaw: string } => {
    // CLI 把 bootstrap.js 写在 out 同目录，故每个 tag 用独立子目录，双跑产物互不覆盖。
    const dir = resolve(TMP, tag)
    mkdirSync(dir, { recursive: true })
    const out = resolve(dir, 'snapshot.json')
    const args = [CLI, `--out=${out}`]
    if (now !== null) args.push(`--now=${now}`)
    execFileSync(process.execPath, args, { encoding: 'utf8', stdio: 'pipe' })
    const snapRaw = readFileSync(out, 'utf8')
    const bootRaw = readFileSync(resolve(dir, 'bootstrap.js'), 'utf8')
    return { snap: JSON.parse(snapRaw), snapRaw, bootRaw }
  }

  it('㉞ CLI --now=<ms> 注入生效：generatedAt / systems.builtAt 恒等于固定时钟（KI-515）', () => {
    const r = runCli('inject', FIXED)
    const snap = JSON.parse(r.snapRaw)
    expect(snap.generatedAt).toBe(FIXED)
    expect(snap.systems.builtAt).toBe(FIXED)
    // idGen 判词读数存在且成形（此处只钉注入后读数确定成形，判词不漂在 ㉟ 双跑里钉）
    expect(snap.systems.idGen).toBeTruthy()
    expect(snap.systems.messageDelivery.vectors).toEqual({ AtMostOnce: '011', AtLeastOnce: '101', ExactlyOnce: '110' })
    // bootstrap.js 是同一份 JSON 全局挂载，含固定 generatedAt
    expect(r.bootRaw).toContain(`"generatedAt":${FIXED}`)
    expect(r.bootRaw).toContain('__BOOTSTRAP_SNAPSHOT__')
  })

  it('㉟ CLI 固定时钟双跑：snapshot.json 与 bootstrap.js 逐字节一致、idGen 判词不漂（KI-515）', () => {
    const a = runCli('runA', FIXED)
    const b = runCli('runB', FIXED)
    expect(a.snapRaw).toBe(b.snapRaw)                       // snapshot.json 双跑逐字节一致
    expect(a.bootRaw).toBe(b.bootRaw)                       // bootstrap.js 双跑逐字节一致
    expect(JSON.stringify(a.snap.systems)).toBe(JSON.stringify(b.snap.systems))
    expect(JSON.stringify(a.snap.highlights)).toBe(JSON.stringify(b.snap.highlights))
    // 此前真实墙钟下 idGen unique 会因 Snowflake 同毫秒 sequence 归零 8→7 判词级漂移；固定时钟后恒稳
    const uA = JSON.stringify(a.snap.systems.idGen.totals ?? a.snap.systems.idGen)
    const uB = JSON.stringify(b.snap.systems.idGen.totals ?? b.snap.systems.idGen)
    expect(uA).toBe(uB)
    expect(a.snap.generatedAt).toBe(FIXED)
  })

  it('㊱ 缺省（不传 --now）保持真实墙钟语义、且 bootstrap↔snapshot 双载体 systems 逐字同源（KI-515）', () => {
    // 缺省走真实墙钟：generatedAt 为采集时刻（== 一个合理的近期毫秒），不恒等于 FIXED。
    const live = runCli('live', null)
    expect(typeof live.snap.generatedAt).toBe('number')
    expect(live.snap.generatedAt).toBeGreaterThan(1_600_000_000_000)
    expect(live.snap.systems.builtAt).toBe(live.snap.generatedAt)
    // 双载体同源：bootstrap.js 里的 __BOOTSTRAP_SNAPSHOT__ 与 snapshot.json 的 systems 逐字一致。
    const m = /__BOOTSTRAP_SNAPSHOT__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(live.bootRaw)
    expect(m, 'bootstrap.js 未挂出 __BOOTSTRAP_SNAPSHOT__').toBeTruthy()
    const bootObj = JSON.parse(m![1])
    expect(JSON.stringify(bootObj.systems)).toBe(JSON.stringify(live.snap.systems))
    expect(JSON.stringify(bootObj.highlights)).toBe(JSON.stringify(live.snap.highlights))
  })

  it('㉒k-consumer-rebalance buildConsumerRebalanceReading 真跑：reb* 注入生效 / consumerRebalance:false 关闭 / rigged 不硬造 111 / 双路自证 + 十一真件 / 二十二时钟同源（KI-541）', async () => {
    const { buildConsumerRebalanceReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 541500
    const g = (await buildConsumerRebalanceReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(541500)
    expect(g.rows.length).toBe(3)
    expect(g.config.partitions).toBe(6)
    expect(g.config.members).toBe(3)
    expect(g.vectors).toEqual({ Eager: '011', CooperativeSticky: '101', StaticMembership: '110' })
    expect(g.rigged).toBe(false)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    expect(g.causalLocks.eagerPauseCausallyUnerasable).toBe(true)
    expect(g.causalLocks.cooperativeIncrementalComplexityCausallyUnerasable).toBe(true)
    expect(g.causalLocks.staticSessionTimeoutCausallyUnerasable).toBe(true)
    const tuned = (await buildConsumerRebalanceReading({ rebSeed: 12, rebMembers: 2 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.members).toBe(2)
    const rig = (await buildConsumerRebalanceReading({ rebRigged: true }, now))!
    expect(rig.vectors.CooperativeSticky).toBe('111')
    expect(rig.vectors.StaticMembership).toBe('111')
    expect(rig.rigged).toBe(true)
    expect(rig.verdict.noStrategyWinsAll).toBe(false)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
    const cp = g.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.memberLeak.holds).toBe(false)
    expect(cp.tamper.staleAssignment.holds).toBe(false)
    expect(cp.tamper.emptyMembership.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, consumerRebalance: false, idempotentConsumer: false })
    expect(off.consumerRebalance).toBe(null)
    expect(off.idempotentConsumer).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const twentytwo = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt, full.llmGateway?.builtAt, full.gatewayRouting?.builtAt, full.idempotentConsumer?.builtAt, full.consumerRebalance?.builtAt]
    expect(twentytwo.every((x) => x === 541500)).toBe(true)
  })

  it('㉒l-priority-queue buildPriorityQueueReading 真跑：pq* 注入生效 / priorityQueue:false 关闭 / rigged 不硬造 111 / 双路自证 + 十一真件 / 二十三时钟同源（KI-542）', async () => {
    const { buildPriorityQueueReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 542500
    const g = (await buildPriorityQueueReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(542500)
    expect(g.rows.length).toBe(3)
    expect(g.config.capacity).toBe(64)
    expect(g.vectors).toEqual({ BoundedStrict: '100', MotionWeightedFair: '010', DeadlineScheduler: '101' })
    expect(g.rigged).toBe(false)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    expect(g.causalLocks.strictStarvationCausallyUnerasable).toBe(true)
    expect(g.causalLocks.fairVtimeAccountingCausallyUnerasable).toBe(true)
    expect(g.causalLocks.deadlineBlindnessCausallyUnerasable).toBe(true)
    const tuned = (await buildPriorityQueueReading({ pqSeed: 12, pqMessages: 32 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.messages).toBe(32)
    const rig = (await buildPriorityQueueReading({ pqRigged: true }, now))!
    expect(rig.rigged).toBe(true)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
    const cp = g.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.starvationAnchor.holds).toBe(false)
    expect(cp.tamper.vtimeDrift.holds).toBe(false)
    expect(cp.tamper.deadlineBlind.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, priorityQueue: false, consumerRebalance: false })
    expect(off.priorityQueue).toBe(null)
    expect(off.consumerRebalance).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const twentythree = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt, full.llmGateway?.builtAt, full.gatewayRouting?.builtAt, full.idempotentConsumer?.builtAt, full.consumerRebalance?.builtAt, full.priorityQueue?.builtAt]
    expect(twentythree.every((x) => x === 542500)).toBe(true)
  })

  it('㉒m-batch-stream-join buildBatchStreamJoinReading 真跑：bsj* 注入生效 / batchStreamJoin:false 关闭 / rigged 不硬造 111 / 双路自证 + 十一真件 / 二十四时钟同源（KI-543）', async () => {
    const { buildBatchStreamJoinReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 543500
    const g = (await buildBatchStreamJoinReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(543500)
    expect(g.rows.length).toBe(3)
    expect(g.config.batchSize).toBe(8)
    expect(g.vectors).toEqual({ MicroBatchJoin: '101', StreamWindowJoin: '010', CdcOutboxJoin: '110' })
    expect(g.rigged).toBe(false)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    expect(g.causalLocks.batchWindowCausallyUnerasable).toBe(true)
    expect(g.causalLocks.streamExactlyOnceCausallyUnerasable).toBe(true)
    expect(g.causalLocks.cdcReplayCausallyUnerasable).toBe(true)
    const tuned = (await buildBatchStreamJoinReading({ bsjSeed: 12, bsjMessages: 32 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.messages).toBe(32)
    const cp = g.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.batchBucketDrift.holds).toBe(false)
    expect(cp.tamper.windowMiss.holds).toBe(false)
    expect(cp.tamper.cdcDupe.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, batchStreamJoin: false, priorityQueue: false })
    expect(off.batchStreamJoin).toBe(null)
    expect(off.priorityQueue).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const twentyfour = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt, full.llmGateway?.builtAt, full.gatewayRouting?.builtAt, full.idempotentConsumer?.builtAt, full.consumerRebalance?.builtAt, full.priorityQueue?.builtAt, full.batchStreamJoin?.builtAt]
    expect(twentyfour.every((x) => x === 543500)).toBe(true)
  })

  it('㉒n-cdc-outbox-join buildCdcOutboxJoinReading 真跑：coj* 注入生效 / cdcOutboxJoin:false 关闭 / rigged 不硬造 111 / 双路自证 + 十一真件 / 二十五时钟同源（KI-544）', async () => {
    const { buildCdcOutboxJoinReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 544500
    const g = (await buildCdcOutboxJoinReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(544500)
    expect(g.rows.length).toBe(3)
    expect(g.config.interval).toBe(4)
    expect(g.vectors).toEqual({ LsmSnapshotJoin: '101', RawBinlogJoin: '011', OutboxAtomicJoin: '100' })
    expect(g.rigged).toBe(false)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    expect(g.causalLocks.snapshotCommitWindowCausallyUnerasable).toBe(true)
    expect(g.causalLocks.binlogBorderlineCausallyUnerasable).toBe(true)
    expect(g.causalLocks.outboxLockCausallyUnerasable).toBe(true)
    const tuned = (await buildCdcOutboxJoinReading({ cojSeed: 12, cojMessages: 32 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.messages).toBe(32)
    const cp = g.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.snapshotMismatched.holds).toBe(false)
    expect(cp.tamper.binlogMiss.holds).toBe(false)
    expect(cp.tamper.atomicLatchLeak.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, cdcOutboxJoin: false, batchStreamJoin: false })
    expect(off.cdcOutboxJoin).toBe(null)
    expect(off.batchStreamJoin).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const twentyfive = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt, full.llmGateway?.builtAt, full.gatewayRouting?.builtAt, full.idempotentConsumer?.builtAt, full.consumerRebalance?.builtAt, full.priorityQueue?.builtAt, full.batchStreamJoin?.builtAt, full.cdcOutboxJoin?.builtAt]
    expect(twentyfive.every((x) => x === 544500)).toBe(true)
  })

  it('㉒o-spring-stream-binding buildSpringStreamBindingReading 真跑：ssb* 注入生效 / springStreamBinding:false 关闭 / rigged 不硬造 111 / 双路自证 + 十一真件 / 二十六时钟同源（KI-545）', async () => {
    const { buildSpringStreamBindingReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 545500
    const g = (await buildSpringStreamBindingReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(545500)
    expect(g.rows.length).toBe(3)
    expect(g.config.messages).toBe(96)
    expect(g.vectors).toEqual({ ExclusiveConsumer: '101', SharedConsumer: '010', ClusteredConsumer: '011' })
    expect(g.rigged).toBe(false)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    expect(g.causalLocks.exclusiveLockCausallyUnerasable).toBe(true)
    expect(g.causalLocks.sharedThroughputCausallyUnerasable).toBe(true)
    expect(g.causalLocks.clusterAckCausallyUnerasable).toBe(true)
    const tuned = (await buildSpringStreamBindingReading({ ssbSeed: 12, ssbMessages: 32 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.messages).toBe(32)
    const cp = g.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.clusterRpcDrop.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    const off = await buildSystems({ now, springStreamBinding: false, cdcOutboxJoin: false })
    expect(off.springStreamBinding).toBe(null)
    expect(off.cdcOutboxJoin).toBe(null)
    expect(off.cacheReplacement).not.toBe(null)
    const full = await buildSystems({ now })
    const twentysix = [full.builtAt, full.delayQueue?.builtAt, full.retryDlq?.builtAt, full.consumerGroup?.builtAt, full.backpressure?.builtAt, full.logCompaction?.builtAt, full.bloomFilter?.builtAt, full.cacheReplacement?.builtAt, full.streamWindow?.builtAt, full.hyperLogLog?.builtAt, full.crdt?.builtAt, full.springBatch?.builtAt, full.traceSampling?.builtAt, full.distributedSession?.builtAt, full.transactionalOutbox?.builtAt, full.loadBalance?.builtAt, full.circuitBreaker?.builtAt, full.llmGateway?.builtAt, full.gatewayRouting?.builtAt, full.idempotentConsumer?.builtAt, full.consumerRebalance?.builtAt, full.priorityQueue?.builtAt, full.batchStreamJoin?.builtAt, full.cdcOutboxJoin?.builtAt, full.springStreamBinding?.builtAt]
    expect(twentysix.every((x) => x === 545500)).toBe(true)
  })

  it('㉒p-cache-consistency buildCacheConsistencyReading 真跑：cc* 注入生效 / cacheConsistency:false 关闭 / rigged 不硬造 111 / 双路自证 + 十一真件 / 时钟同源（KI-558）', async () => {
    const { buildCacheConsistencyReading, buildSystems } = await import('../../scripts/caesura-console-gen.mjs')
    const now = () => 557000
    const g = (await buildCacheConsistencyReading({}, now))!
    expect(g).not.toBe(null)
    expect(g.builtAt).toBe(557000)
    expect(g.rows.length).toBe(3)
    expect(g.config.writes).toBe(24)
    expect(g.vectors).toEqual({ DelayedDoubleDelete: '011', SubscribeBinlog: '101', OutboxPolling: '110' })
    expect(g.rigged).toBe(false)
    expect(g.noUniversalWinner).toBe(true)
    expect(g.noStrategyWinsAll).toBe(true)
    expect(g.verdict.vectorFromTrilemma).toBe(true)
    expect(g.causalLocks.causalLocksAllHold).toBe(true)
    expect(g.causalLocks.volatileInvalidationIntentCausallyUnerasable).toBe(true)
    expect(g.causalLocks.cdcOffsetDependencyCausallyUnerasable).toBe(true)
    expect(g.causalLocks.outboxSameTransactionCausallyUnerasable).toBe(true)
    const tuned = (await buildCacheConsistencyReading({ ccSeed: 12, ccWrites: 8 }, now))!
    expect(tuned.config.seed).toBe(12)
    expect(tuned.config.writes).toBe(8)
    const cp = g.crosscheck.soundness
    expect(cp.holds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.deleteLost.holds).toBe(false)
    expect(cp.tamper.offsetReset.holds).toBe(false)
    expect(cp.tamper.outboxNotAtomic.holds).toBe(false)
    expect(Object.keys(g.crosscheck.evidence).length).toBe(21)
    // 单开关只顶高自己那一家
    const onlyCdc = (await buildCacheConsistencyReading({ ccFreeCdcInfra: true }, now))!
    expect(onlyCdc.vectors.SubscribeBinlog).toBe('111')
    expect(onlyCdc.vectors.DelayedDoubleDelete).toBe('011')
    expect(onlyCdc.vectors.OutboxPolling).toBe('110')
    const off = await buildSystems({ now, cacheConsistency: false })
    expect(off.cacheConsistency).toBe(null)
    expect(off.promptCache).not.toBe(null)
    const full = await buildSystems({ now })
    expect(full.cacheConsistency?.builtAt).toBe(557000)
  })
})
