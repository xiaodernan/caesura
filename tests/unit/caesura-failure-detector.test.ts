import { describe, it, expect } from 'vitest'
import {
  FD_DEFAULTS,
  erfc,
  createPhiAccrualDetector,
  createSwimMembership,
  createHealthView,
  defaultTrace,
  compareFixedVsPhi,
  failureDetectorStudy,
  fdSnapshot,
} from '../../scripts/caesura-failure-detector.mjs'

/** 造一只可控时钟：每次调用读外部游标，测试里手动推进。 */
function clock(t0 = 0) {
  let t = t0
  return { now: () => t, set: (v: number) => { t = v }, add: (v: number) => { t += v }, get: () => t }
}

/** 喂 N 次规律心跳（间隔 gap），返回检测器与当前时钟。 */
function feedStable(gap = 100, count = 20, opts: any = {}) {
  const c = clock()
  const d = createPhiAccrualDetector({ minSamples: 5, windowSize: 20, ...opts, now: c.now })
  for (let i = 0; i < count; i++) { c.add(gap); d.heartbeat() }
  return { d, c }
}

describe('KI-503 服务故障检测器：φ 累积风险 + SWIM 成员协议 + 健康视图缓存', () => {
  it('① 默认参数冻结、9 枚值导出齐全（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(FD_DEFAULTS)).toBe(true)
    expect(FD_DEFAULTS.threshold).toBe(4)
    expect(FD_DEFAULTS.windowSize).toBe(20)
    for (const fn of [
      erfc, createPhiAccrualDetector, createSwimMembership, createHealthView,
      defaultTrace, compareFixedVsPhi, failureDetectorStudy, fdSnapshot,
    ]) expect(typeof fn).toBe('function')
  })

  it('② erfc 近似数学正确：erfc(0)=1、对称、单调递减、大 x→0，Q(0)=0.5 隐含', () => {
    expect(erfc(0)).toBeCloseTo(1, 6)
    expect(erfc(1)).toBeCloseTo(0.157299, 4)
    expect(erfc(-1)).toBeCloseTo(2 - erfc(1), 6)
    expect(erfc(3)).toBeLessThan(erfc(1))
    expect(erfc(10)).toBeLessThan(1e-40)
    // A&S 7.1.26 绝对误差量级：与已知值 erfc(0.5)≈0.479500 比
    expect(erfc(0.5)).toBeCloseTo(0.479500, 4)
  })

  it('③ φ 检测器：样本不足 minSamples 时恒 0（不凭空定罪），够样本后稳定历史 φ 极低', () => {
    const c = clock()
    const d = createPhiAccrualDetector({ minSamples: 5, windowSize: 20, now: c.now })
    c.add(100); d.heartbeat()
    c.add(100); d.heartbeat()
    c.add(500); d.heartbeat()      // 一次长间隔，但样本<5
    expect(d.phi()).toBe(0)       // 不定罪
    expect(d.snapshot().suspect).toBe(false)
    const { d: s } = feedStable(100, 20)
    expect(s.samples).toBe(19)    // 20 次心跳 = 19 个间隔
    expect(s.phi()).toBeLessThan(FD_DEFAULTS.threshold)
    expect(s.snapshot().suspect).toBe(false)
  })

  it('④ φ 随时间单调升高；长暂停后越过 threshold 判 suspect', () => {
    const { d, c } = feedStable(100, 20)
    const p0 = d.phi()             // 刚心跳完，gap=0
    c.add(300); const p1 = d.phi()
    c.add(300); const p2 = d.phi()
    c.add(300); const p3 = d.phi()
    expect(p0).toBe(0)
    expect(p1).toBeGreaterThan(0)
    expect(p2).toBeGreaterThan(p1) // 单调
    expect(p3).toBeGreaterThan(p2)
    expect(d.suspect()).toBe(true) // 规整历史下 σ 被 minStdDeviationMs 钳住，迟早越阈
  })

  it('⑤ σ 下限（可容忍暂停）防历史过整齐时 φ 爆炸；调大 minStdDeviationMs 更宽容', () => {
    // 同一段 300ms gap：窄 σ 下限 → φ 高；宽 σ 下限 → φ 低。
    const mk = (minStd: number) => {
      const c = clock()
      const d = createPhiAccrualDetector({ minSamples: 5, windowSize: 20, minStdDeviationMs: minStd, now: c.now })
      for (let i = 0; i < 20; i++) { c.add(100); d.heartbeat() }
      c.add(300)
      return d.phi()
    }
    const pTight = mk(10)
    const pLoose = mk(400)
    expect(pTight).toBeGreaterThan(pLoose)
    expect(pLoose).toBeLessThan(FD_DEFAULTS.threshold)
  })

  it('⑥ 环形缓冲有界：samples 封顶 windowSize、覆盖最旧（intervals 恒等长有界）', () => {
    const c = clock()
    const d = createPhiAccrualDetector({ minSamples: 3, windowSize: 5, now: c.now })
    for (let i = 0; i < 50; i++) { c.add(100 + (i % 2 ? 20 : 0)); d.heartbeat() }
    expect(d.samples).toBe(5)
    expect(d.intervals().length).toBe(5)
    expect(d.snapshot().intervalsSeen).toBe(49)
    // 最旧两条被冲掉：窗口内只剩 120/100 交替
    expect(d.intervals().every((x) => x === 100 || x === 120)).toBe(true)
  })

  it('⑦ Welford 数值稳定：混合尺度长轨迹 μ/σ 与全量公式一致，reset 归零、注入时钟确定性', () => {
    const c = clock()
    const d = createPhiAccrualDetector({ minSamples: 2, windowSize: 64, now: c.now })
    const gaps = Array.from({ length: 200 }, (_, i) => 80 + (i % 7) * 13 + (i % 3) * 0.5)
    for (const g of gaps) { c.add(g); d.heartbeat() }
    const window = gaps.slice(-64)
    const mean = window.reduce((a, b) => a + b, 0) / window.length
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1)
    expect(d.mean!).toBeCloseTo(mean, 2)
    expect(d.stddev!).toBeCloseTo(Math.sqrt(variance), 2)
    d.reset()
    expect(d.samples).toBe(0)
    expect(d.phi()).toBe(0)
    // 确定性：同轨迹重跑读数逐字一致
    const run = () => {
      const cc = clock(); const dd = createPhiAccrualDetector({ minSamples: 5, windowSize: 20, now: cc.now })
      for (let i = 0; i < 20; i++) { cc.add(100 + (i % 3)); dd.heartbeat() }
      cc.add(350); return dd.snapshot()
    }
    expect(run()).toEqual(run())
  })

  it('⑧ SWIM：直接探测存活 / 全失败标 suspected / 撑过怀疑超时被 reap 确认死亡', () => {
    const sw = createSwimMembership({ now: () => 0, suspicionMult: 2, probeIntervalMs: 1000 })
    sw.add('a'); sw.add('b')
    const ok = sw.probeIndirect('a', ['b'], (id, kind) => kind === 'direct', 0)
    expect(ok.via).toBe('direct'); expect(ok.alive).toBe(true)
    const fail = sw.probeIndirect('b', ['a'], () => false, 1000)
    expect(fail.via).toBe('suspected'); expect(fail.alive).toBe(false)
    expect(sw.state('b')!.state).toBe('suspected')
    // suspectAt=1000，怀疑超时=1000×2=2000，须到 t=3000 才满足 3000−1000≥2000
    expect(sw.reap(2999)).toEqual([])          // 未到点不动
    expect(sw.reap(3000)).toEqual(['b'])       // 到点确认
    expect(sw.state('b')!.state).toBe('faulty')
    expect(sw.stats().confirmations).toBe(1)
  })

  it('⑨ SWIM 间接探测：直接失败后中继代 ping 成功即反证存活（降单链路误判）', () => {
    const sw = createSwimMembership({ now: () => 0, retransmitLimit: 3 })
    sw.add('target'); sw.add('r1'); sw.add('r2')
    const r = sw.probeIndirect('target', ['r1', 'r2'], (_id, kind, relay) => kind === 'indirect' && relay === 'r2', 0)
    expect(r.alive).toBe(true)
    expect(r.via).toBe('indirect')
    expect(r.relay).toBe('r2')
    expect(r.refuted).toBe(false)   // 本来 alive，不是从 suspected 拉回
    expect(sw.state('target')!.state).toBe('alive')
    expect(sw.stats().indirectRescues).toBe(1)
    expect(sw.stats().directFailures).toBe(1)
    expect(sw.stats().suspected).toBe(0) // 未误标
  })

  it('⑩ SWIM alive 反证 + incarnation 单调：旧 gossip 覆盖不了新状态', () => {
    const sw = createSwimMembership({ now: () => 0 })
    sw.add('n', 5, 0)
    const s = sw.suspect('n', 100)
    expect(s.state).toBe('suspected'); expect(s.incarnation).toBe(6)
    const stale = sw.applyGossip({ id: 'n', state: 'suspected', incarnation: 6 }, 110)
    expect(stale.applied).toBe(false); expect(stale.reason).toBe('stale_incarnation')
    const refute = sw.applyGossip({ id: 'n', state: 'alive', incarnation: 7 }, 120)
    expect(refute.applied).toBe(true)
    expect(sw.state('n')!.state).toBe('alive')
    // 反证后 reap 不再杀它
    expect(sw.reap(99999)).toEqual([])
    expect(sw.stats().gossipsStale).toBe(1)
    expect(sw.stats().refutations).toBe(0) // refutation 只由 alive() 计，gossip 走另一计数
  })

  it('⑪ SWIM pickTarget 注入 rand 确定性 + 空成员/过滤 faulty + stats 快照纯数据', () => {
    const sw = createSwimMembership({ now: () => 0, rand: () => 0.99 })
    for (const id of ['a', 'b', 'c']) sw.add(id, 0, 0)
    expect(sw.pickTarget()).toBe('c')       // 0.99 → 最后一枚
    sw.dead('c')
    expect(sw.pickTarget()).toBe('b')       // faulty 被过滤
    const snap = sw.snapshot(42)
    expect(snap.strategy).toBe('swim')
    expect(snap.faulty).toBe(1)   // snapshot 顶层展开 stats()，faulty 是顶层字段
    expect(snap.alive).toBe(2)
    expect(snap.builtAt).toBe(42)
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
    sw.reset()
    expect(sw.pickTarget()).toBeNull()
    expect(sw.stats().total).toBe(0)
  })

  it('⑫ 健康视图：TTL 内二次读命中缓存、invalidate 后重算、faulty 被排除', () => {
    const sw = createSwimMembership({ now: () => 0 })
    for (const id of ['a', 'b', 'c']) sw.add(id, 0, 0)
    sw.dead('c')
    const hv = createHealthView({ membership: sw, now: () => 0, ttlMs: 1000 })
    for (const id of ['a', 'b']) for (let i = 0; i < 10; i++) hv.heartbeat(id, i * 100)
    const first = hv.getHealthy(950)
    expect(first.fromCache).toBe(false)
    expect(first.nodes.sort()).toEqual(['a', 'b']) // c 是 faulty，排除
    const second = hv.getHealthy(960)
    expect(second.fromCache).toBe(true)
    expect(second.nodes).toEqual(first.nodes)
    expect(hv.stats().computed).toBe(1)
    hv.invalidate()
    const third = hv.getHealthy(970)
    expect(third.fromCache).toBe(false)
    expect(hv.stats().computed).toBe(2)
    expect(hv.stats().invalidations).toBe(1)
    // φ 越阈的 alive 节点也应被剔除
    sw.alive('c', 980)                 // c 复活（faulty→ 仍 faulty，alive 不复活 faulty）
    expect(hv.snapshot(980).nodes).toContain('a')
  })

  it('⑬ 核心对照：六句判词全真，如实保留「固定更快但更吵」的权衡', () => {
    const c = compareFixedVsPhi()
    const v = c.verdict
    expect(v.fixedOverReactsToJitter).toBe(true)
    expect(v.phiReducesFalsePositives).toBe(true)
    expect(v.bothDetectRealFailure).toBe(true)
    expect(v.fixedFasterButNoisier).toBe(true)
    expect(v.phiAdaptiveToHistory).toBe(true)
    expect(v.phiNeverExceedsCap).toBe(true)
    expect(c.fixed.falsePositives).toBeGreaterThan(c.phi.falsePositives)
    expect(c.phi.falsePositives).toBe(0)
    expect(c.fixed.detectionLatencyMs!).toBeLessThan(c.phi.detectionLatencyMs!)
    expect(c.adaptation.jitteryPhi).toBeLessThan(c.adaptation.steadyPhi)
    // 同一条轨迹，确定性
    expect(compareFixedVsPhi()).toEqual(c)
  })

  it('⑭ study/snapshot：纯数据可 JSON 往返、SWIM 四脚本成立、健康视图三段读数、builtAt 注入确定性', async () => {
    const t = 5000
    const s = await failureDetectorStudy({ now: () => t })
    expect(s.swim.script.directAlive).toBe(true)
    expect(s.swim.script.indirectRescued).toBe(true)
    expect(s.swim.script.suspectAfterTotalFailure).toBe(true)
    expect(s.swim.script.gossipRefuted).toBe(true)
    const snap = fdSnapshot(s)
    expect(snap.health.firstFromCache).toBe(false)
    expect(snap.health.secondFromCache).toBe(true)
    expect(snap.health.thirdFromCache).toBe(false)
    expect(snap.health.nodes).toContain('gate-a')
    expect(snap.health.excluded).toContain('gate-c')
    expect(snap.verdict).toEqual(s.comparison.verdict)
    expect(snap.builtAt).toBe(5000)
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
    // 注入时钟 ⇒ 两次逐字一致（除 builtAt 由同一游标给定）
    const s2 = await failureDetectorStudy({ now: () => t })
    expect(fdSnapshot(s2)).toEqual(snap)
    void t
  })
})
