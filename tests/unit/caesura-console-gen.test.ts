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
})
