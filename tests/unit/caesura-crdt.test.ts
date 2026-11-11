import { describe, expect, it } from 'vitest'
import {
  CRDT_DEFAULTS,
  CRDT_STRATEGIES,
  CRDT_SCENARIOS,
  createLwwRegister,
  createGCounter,
  createOrSet,
  crdtStudy,
  crdtSnapshot,
  verifyConvergence,
  createCrdtEvidence,
} from '../../scripts/caesura-crdt.mjs'

/**
 * KI-531 CRDT 最终一致冲突消解三策略诚实权衡（P8 第三十八件 · 前端第二十五维）。
 * 与 KI-527/528/529/530 同族测试面——真件真跑、三位现算、rigged 因果锁死守、绝不查表硬造。
 *
 * 维序 [strongEventualConvergence / expressiveness / compactMetadata]：
 *   LWWRegister=011 / GCounter=100 / OrSet=110；rigged 唯一翻 GCounter compact ⇒ 101。
 */

type Ev = { node: string; clock: number; op: string; payload?: any }

describe('caesura-crdt（KI-531）', () => {
  const incEvents = (n: number): Ev[] =>
    Array.from({ length: n }, (_, i) => ({ node: `n${i % 3}`, clock: i + 1, op: 'inc' }))

  // ============ 配置与名册 ============
  it('1. CRDT_DEFAULTS / 三策略 / 六场景固定顺序', () => {
    expect(CRDT_STRATEGIES).toEqual(['LWWRegister', 'GCounter', 'OrSet'])
    expect(CRDT_SCENARIOS).toEqual([
      'allReplicaExchange', 'outOfOrderDelivery', 'duplicateDelivery', 'concurrentWrite', 'clockSkew', 'removeAddRace',
    ])
    expect(CRDT_DEFAULTS.seed).toBe(531)
    expect(CRDT_DEFAULTS.replicaCount).toBe(3)
    expect(CRDT_DEFAULTS.opsPerNode).toBe(64)
    expect(CRDT_DEFAULTS.skewTicks).toBe(25)
  })

  // ============ 三真 CRDT 实现 ============
  it('2. LWWRegister：(clock,nodeId) 决胜；低戳被高戳覆盖；footprint 恒 24B', () => {
    const lww = createLwwRegister({ nodeId: 'n1' })
    lww.assign(1, 'v1'); lww.assign(10, 'v10'); lww.assign(5, 'v5')
    expect(lww.value()).toBe('v10')
    expect(lww.footprintBytes()).toBe(24)
    const other = createLwwRegister({ nodeId: 'n2' }); other.assign(8, 'remote-8')
    expect(lww.merge(other)).toBe(true)
    expect(lww.value()).toBe('v10') // 远端戳 8 < 本地 10，不覆盖
    // footprint O(1)：独立实例跑 1000 op，常数 24B 与 op 数无关
    const hot = createLwwRegister({ nodeId: 'h' })
    for (let i = 0; i < 1000; i++) hot.assign(i, 'v' + i)
    expect(hot.footprintBytes()).toBe(24)
  })

  it('3. LWWRegister merge 真收敛：远端更大戳覆盖；observe 带完整戳', () => {
    const a = createLwwRegister({ nodeId: 'a' }); const b = createLwwRegister({ nodeId: 'b' })
    a.assign(100, 'old'); b.assign(200, 'new')
    const o0 = a.observe(); expect(o0?.value).toBe('old'); expect(o0?.stamp.clock).toBe(100)
    a.merge(b)
    expect(a.value()).toBe('new')
    b.merge(a); expect(b.value()).toBe('new') // 交换后一致
  })

  it('4. GCounter：increment 单调；merge=max 幂等/交换/结合；decrement 真被拒', () => {
    const a = createGCounter({ nodeId: 'a' }); const b = createGCounter({ nodeId: 'b' })
    for (let i = 0; i < 10; i++) a.increment()
    for (let i = 0; i < 8; i++) b.increment()
    a.merge(b); b.merge(a)
    expect(a.value()).toBe(18); expect(b.value()).toBe(18)
    const before = a.value()
    a.merge(b) // 幂等
    expect(a.value()).toBe(before)
    expect(a.decrement()).toBe(false) // grow-only 结构属性
    expect(a.value()).toBe(before)
  })

  it('5. GCounter footprint 随节点数线性增长（O(nodes)）', () => {
    const reps = Array.from({ length: 5 }, (_, i) => createGCounter({ nodeId: `n${i}` }))
    reps.forEach((r) => r.increment())
    const acc = reps[0]; for (let i = 1; i < reps.length; i++) acc.merge(reps[i])
    expect(acc.footprintBytes()).toBeGreaterThanOrEqual(5 * 16)
  })

  it('6. OrSet（add-wins）：add 发唯一 tag；observed remove 真删；并发 add 存活', () => {
    const s = createOrSet({ nodeId: 'r' })
    s.add('x'); s.add('y')
    expect(s.value()).toContain('x'); expect(s.value()).toContain('y')
    expect(s.remove('x')).toBeGreaterThanOrEqual(1)
    expect(s.value()).not.toContain('x'); expect(s.value()).toContain('y')
    // observed-remove：A 删自己可见的 x，B 并发 add x 的新 tag 存活
    const a = createOrSet({ nodeId: 'a' }); const b = createOrSet({ nodeId: 'b' })
    a.add('x'); a.remove('x'); b.add('x')
    a.merge(b); b.merge(a)
    expect(a.value()).toContain('x') // add-wins：并发新 tag 存活
  })

  it('7. OrSet footprint 随 ops 增长（O(ops)）', () => {
    const s = createOrSet({ nodeId: 'r' })
    for (let i = 0; i < 100; i++) s.add('v' + i)
    expect(s.footprintBytes()).toBeGreaterThanOrEqual(100 * 24)
  })

  // ============ 三难三位：现算，不查表 ============
  it('8. 默认向量逐格互异、无一 111 ⇒ noUniversalWinner', () => {
    const s = crdtStudy({ now: () => 531000 })
    expect(s.vectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.noUniversalWinnerStrict).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(531000)
  })

  it('9. 三位各有真探针支撑（secStrict/concurrentIntentLost/exp/cmp 现算）', () => {
    const s = crdtStudy({})
    const lww = s.rows.find((r) => r.protocol === 'LWWRegister')!
    const gc = s.rows.find((r) => r.protocol === 'GCounter')!
    const os = s.rows.find((r) => r.protocol === 'OrSet')!
    // LWW：严格 SEC 真（副本收敛），但并发意图被吞 ⇒ 教学 SEC=false
    expect(lww.probes.sec.secStrict).toBe(true)
    expect(lww.probes.sec.concurrentIntentLost).toBe(true)
    expect(lww.probes.exp.expressiveness).toBe(true)  // 可覆盖写 null
    expect(lww.probes.cmp.compactMetadata).toBe(true) // O(1)
    // GCounter：增量不丢、decrement 拒、O(nodes) 不紧凑
    expect(gc.probes.sec.concurrentIntentLost).toBe(false)
    expect(gc.probes.exp.decrementRefused).toBe(true)
    expect(gc.probes.exp.expressiveness).toBe(false)
    expect(gc.probes.cmp.grows).toBe(true)
    // OrSet：并发 add 全活、remove 生效、O(ops) 不紧凑
    expect(os.probes.sec.concurrentIntentLost).toBe(false)
    expect(os.probes.exp.removeWorked).toBe(true)
    expect(os.probes.cmp.grows).toBe(true)
  })

  it('10. 诚实口径标定：三者严格 SEC 全收敛；LWW 破在并发意图；OrSet 是 add-wins', () => {
    const s = crdtStudy({})
    expect(s.verdict.secStrictAllConverge).toBe(true)
    expect(s.verdict.lwwSecBreaksOnConcurrentIntent).toBe(true)
    expect(s.verdict.orSetIsAddWins).toBe(true)
    expect(s.verdict.lwwLosesConcurrentWrites).toBe(true)
    expect(s.verdict.gcounterSecConverges).toBe(true)
    expect(s.verdict.orSetConcurrentAddsSurvive).toBe(true)
    expect(s.rows.find((r) => r.protocol === 'LWWRegister')!.trilemma.strongEventualConvergence).toBe(false)
  })

  // ============ rigged 因果锁 ============
  it('11. rigged 三开关齐开：唯一翻 GCounter compact（100→101），主教义不破', () => {
    const s = crdtStudy({ rigged: true, now: () => 531000 })
    expect(s.rigged).toBe(true)
    expect(s.config.uniformClock).toBe(true)
    expect(s.config.infiniteMetadata).toBe(true)
    expect(s.config.coordinatedDelete).toBe(true)
    expect(s.vectors).toEqual({ LWWRegister: '011', GCounter: '101', OrSet: '110' })
    expect(s.baseVectors).toEqual({ LWWRegister: '011', GCounter: '100', OrSet: '110' })
    expect(s.verdict.noUniversalWinner).toBe(true)   // 仍无 111
    expect(s.verdict.noUniversalWinnerStrict).toBe(true)
    expect(s.verdict.gcounterCompactErasableByFreeMemory).toBe(true)
  })

  it('12. 三条因果结构锁真跑现算、rigged 下全 Hold（任何开关救不了）', () => {
    const base = crdtStudy({})
    const rigged = crdtStudy({ rigged: true })
    for (const s of [base, rigged]) {
      expect(s.verdict.lwwConcurrentLossCausallyUnerasable).toBe(true)
      expect(s.verdict.decrementCausallyUnerasable).toBe(true)
      expect(s.verdict.orSetTagHistoryCausallyUnerasable).toBe(true)
      expect(s.verdict.causalLocksAllHold).toBe(true)
    }
  })

  it('13. uniformClock 真抹平 clockSkew 偏斜错判；infiniteMetadata 不抹 OrSet tag 历史', () => {
    const s = crdtStudy({ rigged: true })
    expect(s.verdict.uniformClockErasesSkewMispick).toBe(true)
    expect(s.verdict.orSetCompactUnbounded).toBe(true) // tag 因果锁：仍不紧凑
    const os = s.rows.find((r) => r.protocol === 'OrSet')!
    expect(os.probes.cmp.compressionBreaksSec).toBe(true)
    expect(os.probes.cmp.compactMetadata).toBe(false)
  })

  it('14. 单开各开关各自真跑，向量不被单开关硬造 111', () => {
    for (const one of [{ uniformClock: true }, { infiniteMetadata: true }, { coordinatedDelete: true }]) {
      const s = crdtStudy(one)
      expect(s.rigged).toBe(false)
      expect(Object.values(s.vectors).some((v) => v === '111')).toBe(false)
      expect(s.verdict.vectorFromTrilemma).toBe(true)
    }
  })

  // ============ 注入贯穿 ============
  it('15. replicaCount / opsPerNode / skewTicks 真进 config 且进矩阵现算', () => {
    const s = crdtStudy({ replicaCount: 5, opsPerNode: 32, skewTicks: 40, now: 7 })
    expect(s.config.replicaCount).toBe(5)
    expect(s.config.opsPerNode).toBe(32)
    expect(s.config.skewTicks).toBe(40)
    expect(s.builtAt).toBe(7)
    const gc = s.rows.find((r) => r.protocol === 'GCounter')!
    expect(gc.metrics.compactBytes).toBeGreaterThan(0)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
  })

  it('16. row.vector 与 trilemma 逐格同源；每 cell 带六字段', () => {
    const s = crdtStudy({})
    for (const row of s.rows) {
      const t = row.trilemma
      expect(row.vector).toBe(`${+t.strongEventualConvergence}${+t.expressiveness}${+t.compactMetadata}`)
      for (const c of row.scenarios) {
        expect(c).toMatchObject({
          id: expect.any(String), fault: expect.any(String), inserts: expect.any(Number),
          secConverged: expect.any(Boolean), inSecExam: expect.any(Boolean),
          inExpressiveExam: expect.any(Boolean), inCompactExam: expect.any(Boolean),
        })
      }
    }
  })

  // ============ verifyConvergence 双路 + 三路可证伪 ============
  it('17. verifyConvergence 双路自证：SEC 收敛 + 真值守恒 + nontrivial', () => {
    const r = verifyConvergence({ events: incEvents(30), seed: 531 }, { seed: 531 })
    expect(r.holds).toBe(true); expect(r.nontrivial).toBe(true)
    expect(r.laneA.secConverged).toBe(true)
    expect(r.laneA.after).toEqual([30, 30, 30])
    expect(r.laneB.laneBOk).toBe(true)
    expect(r.laneB.orSetOk).toBe(true)
    expect(r.falsifiable).toBe(true)
  })

  it('18. 三路篡改真喂回同一内核现算翻 false，且基线先真绿（baselineHolds=true）', () => {
    const r = verifyConvergence({ events: incEvents(30), seed: 531 })
    expect(r.tamper.dropReplica.baselineHolds).toBe(true)
    expect(r.tamper.reverseLwwDecision.baselineHolds).toBe(true)
    expect(r.tamper.emptySet.baselineHolds).toBe(true)
    expect(r.tamper.dropReplica.holds).toBe(false)      // 丢副本 ⇒ 分叉
    expect(r.tamper.reverseLwwDecision.holds).toBe(false) // 反转决胜 ⇒ 错值
    expect(r.tamper.emptySet.holds).toBe(false)          // 空集 ⇒ nontrivial=false
  })

  it('19. 空事件集 ⇒ holds=false nontrivial=false，绝不 0=0 假绿', () => {
    const r = verifyConvergence({ events: [], seed: 531 })
    expect(r.holds).toBe(false); expect(r.nontrivial).toBe(false)
    expect(r.tamper.emptySet.holds).toBe(false)
  })

  // ============ snapshot / evidence ============
  it('20. crdtSnapshot 形状 + verdict/vectors/baseVectors 同源', () => {
    const s = crdtStudy({ now: () => 531000 })
    const snap = crdtSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.builtAt).toBe(531000)
    expect(snap.config).toEqual(s.config)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.baseVectors).toEqual(s.baseVectors)
    expect(snap.verdict.vectors).toEqual(s.vectors)
    expect(snap.crosscheck?.evidence).toBeDefined()
    expect(snap.crosscheck?.convergence).toBeDefined()
  })

  it('21. crdtSnapshot(null)/({}) → null 反守卫', () => {
    expect(crdtSnapshot(null as never)).toBe(null)
    expect(crdtSnapshot({} as never)).toBe(null)
  })

  it('22. createCrdtEvidence 十一真件 21 键真回读（无硬编码兜底）', () => {
    const ev = createCrdtEvidence({ seed: 531, now: () => 531000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBe(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.jitterSpread).toBeGreaterThanOrEqual(0)
  })

  // ============ 交叉校验 ============
  it('23. 六场景都跑出 cell 且三副本可证；study.crosscheck 双路同源', () => {
    const s = crdtStudy({})
    for (const row of s.rows) {
      expect(row.scenarios.length).toBe(CRDT_SCENARIOS.length)
      expect(row.scenarios.every((c) => typeof c.secConverged === 'boolean')).toBe(true)
    }
    expect(s.crosscheck.convergence.holds).toBe(true)
    expect(s.crosscheck.evidence).toBeDefined()
    expect(s.noUniversalWinner).toBe(s.verdict.noUniversalWinner)
    expect(s.trilemmaDistinguishes).toBe(s.verdict.trilemmaDistinguishes)
  })
})
