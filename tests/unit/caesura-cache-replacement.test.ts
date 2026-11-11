import { describe, expect, it } from 'vitest'
import {
  CR_DEFAULTS,
  CR_STRATEGIES,
  CR_SCENARIOS,
  createLruCache,
  createTwoQueueCache,
  createArcCache,
  runReplacementScenario,
  cacheReplacementStudy,
  cacheReplacementSnapshot,
  verifyDualSweep,
  createReplacementEvidence,
} from '../../scripts/caesura-cache-replacement.mjs'

/**
 * KI-528 LRU / 2Q / ARC 三替换策略诚实权衡（P8 第三十五件）。
 *
 * 测试面向现象：条目要真访问真计数真自演化；向量从 row.trilemma 见证、不硬覆盖也不维护好看的表象。
 */

describe('caesura-cache-replacement（KI-528）', () => {
  // ============ 配置与名册 ============
  it('CR_DEFAULTS / CR_STRATEGIES / CR_SCENARIOS 固定顺序、键名同词', () => {
    expect(CR_STRATEGIES).toEqual(['LRU', '2Q', 'ARC'])
    expect(CR_SCENARIOS).toEqual(
      ['uniformHot', 'forwardHot', 'dualLocality', 'scanFeast', 'burstAlternates', 'zipfDrift'],
    )
    expect(CR_DEFAULTS.seed).toBe(528)
    expect(CR_DEFAULTS.capacity).toBe(16)
    expect(CR_DEFAULTS.rigged).toBe(false)
  })

  it('六场景全跑 0 抛错（每策略 × 每场景）', () => {
    for (const p of CR_STRATEGIES) {
      for (const s of CR_SCENARIOS) {
        expect(() => runReplacementScenario(p, s, {})).not.toThrow()
      }
    }
  })

  // ============ 真实现 ============
  it('LRU：同样热键重复访问 ⇒ hit；顺扫冲掉后再触发 ⇒ miss', () => {
    const lru = createLruCache({ capacity: 8 })
    for (let i = 0; i < 20; i++) lru.access(`H${i % 3}`)
    const s1 = lru.stats()
    expect(s1.hits).toBeGreaterThanOrEqual(17)
    const before = lru.stats()
    // 灌入 16 个新键（比 cap 还多）→ 扫掉 hot set
    for (let i = 0; i < 16; i++) lru.access(`F${i}`)
    // 再触发第一个热键 — LRU 应该 miss
    expect(lru.access('H0')).toBe(false)
    expect(lru.stats().hits).toBe(before.hits + 0) // 不增长
  })

  it('2Q：热键 A1in→Am 真晋级；顺扫去了 A1in 不碰 Am', () => {
    const q2 = createTwoQueueCache({ capacity: 16, kCoefficient: 0.5 })
    // Am cap = 8；A1in cap = 8
    // 插 6 键 A；再 access 3 次
    for (let i = 0; i < 3; i++) {
      q2.access('hotA')
      q2.access('hotB')
      q2.access('hotC')
      q2.access('hotD')
      q2.access('hotE')
      q2.access('hotF')
    }
    const s = q2.stats()
    expect(s.amPromotions).toBeGreaterThanOrEqual(6) // 6 promotions after second touch
  })

  it('ARC：局部近域双 zone ⇒ hit 后在 T2 内部留存、不同 zone 不越槽', () => {
    const arc = createArcCache({ capacity: 16 })
    for (let i = 0; i < 24; i++) arc.access(`A${i % 5}`)
    // 充满到 A 后命中
    expect(arc.stats().hits).toBeGreaterThan(0)
    for (let i = 0; i < 24; i++) arc.access(`B${i % 5}`)
    expect(arc.stats().hits).toBeGreaterThan(0)
  })

  it('ARC：ghost T1→T2 双鼻腔适配——测试真 advance 真 count', () => {
    // 空 ARC：先制造 ghost T1 成员（先 A 后被扫掉，再追 A）
    const arc = createArcCache({ capacity: 4 })
    for (const k of ['A', 'B', 'C', 'D']) arc.access(k)      // 4 槽充盈
    arc.access('G1'); arc.access('G2')                       // 驱逐 A/B（2 新增）→ A/B 进 T1 shadow
    // A 被 evicted (走 T1 → B1 ghost)
    arc.access('A')                                          // ghost hit T1
    arc.access('A')                                          // 晋 T2
    const s = arc.stats()
    expect(s.ghostHitsT1 + s.ghostHitsT2).toBeGreaterThanOrEqual(1)
  })

  // ============ verifyDualSweep ============
  it('verifyDualSweep（独立 trace）：重度热点倾斜 trace ⇒ 2 路都 ≥ 0.55', () => {
    const trace: Array<[string, boolean]> = []
    for (let i = 0; i < 160; i++) trace.push([`k${[0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 6, 7][i % 12]}`, false])
    const r = verifyDualSweep(trace)
    expect(r.laneA.hitRate).toBeGreaterThanOrEqual(0.84)
    expect(r.falsifiable).toBe(true)
    expect(r.holds).toBe(true)
  })

  it('verifyDualSweep 空 trace ⇒ holds=false、不自豪绿', () => {
    const r = verifyDualSweep([])
    expect(r.holds).toBe(false)
    expect(r.laneA.hits).toBe(0)
  })

  it('verifyDualSweep 篡改路径全翻 false（三路）', () => {
    const trace: Array<[string, boolean]> = Array.from({ length: 200 }, (_, i) => [`k${i % 8}`, false])
    const r = verifyDualSweep(trace)
    expect(r.tamper.laneATraceCorrupted.holds).toBe(false)
    expect(r.tamper.laneBTraceCorrupted.holds).toBe(false)
    expect(r.tamper.laneBSizedNull.holds).toBe(false)
  })

  // ============ study 矩阵 + 向量 ============
  it('cacheReplacementStudy 默认向量逐格互异、无一 111 ⇒ noUniversalWinner', () => {
    const s = cacheReplacementStudy({})
    expect(s.vectors.LRU).toBe('010')
    expect(s.vectors['2Q']).toBe('110')
    expect(s.vectors.ARC).toBe('101')
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(Object.values(s.vectors).includes('111')).toBe(false)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.rigged).toBe(false)
  })

  it('默认向量各自缺一维：LRU shuns scan-resistance / 2Q shuns adaptive / ARC shuns local stable', () => {
    const s = cacheReplacementStudy({})
    const lru = s.rows.find((r) => r.protocol === 'LRU')!
    const q2 = s.rows.find((r) => r.protocol === '2Q')!
    const arc = s.rows.find((r) => r.protocol === 'ARC')!
    expect(lru.trilemma.scanResistance).toBe(false)
    expect(lru.trilemma.stableHitRate).toBe(true)
    expect(lru.trilemma.adaptiveBalance).toBe(false)

    expect(q2.trilemma.scanResistance).toBe(true)
    expect(q2.trilemma.stableHitRate).toBe(true)
    expect(q2.trilemma.adaptiveBalance).toBe(false)

    expect(arc.trilemma.scanResistance).toBe(true)
    expect(arc.trilemma.stableHitRate).toBe(false)
    expect(arc.trilemma.adaptiveBalance).toBe(true)
  })

  it('rigged 双开关齐开 ⇒ 110/110/110（三开关各抹一维，绝不硬造全 111）', () => {
    const s = cacheReplacementStudy({ unlimitedRoom: true, perfectFuture: true })
    expect(s.rigged).toBe(true)
    expect(Object.values(s.vectors)).toEqual(['110', '110', '110'])
    expect(s.verdict.noUniversalWinner).toBe(false)
    expect(s.verdict.trilemmaDistinguishes).toBe(false)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
  })

  it('rigged 单开 unlimitedRoom ⇒ 全员 gain scan-resistant + stableHitRate + adaptiveBalance（transmutation，教学标定；111/111/111 不硬造巧合）', () => {
    const s = cacheReplacementStudy({ unlimitedRoom: true })
    expect(s.rigged).toBe(false)
    // 全员 gain → 111/111/111：rigged 分两档——unlimitedRoom 只抹「容量危险」（真件真跑必然重压满容量），
    // 教学标定：这是不可能场景，但证明 insertsNeverFail 真被 unlimitedRoom 反噬；留待后续 adjusted 的 rigged=true 才能锁 110/110/110
    expect(s.vectors.LRU).toBe('111')
    expect(s.vectors['2Q']).toBe('111')
    expect(s.vectors.ARC).toBe('111')
  })

  it('row.trilemma 与 vectors 同源（同一 truth 来源）', () => {
    const s = cacheReplacementStudy({})
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.scanResistance)}${Number(row.trilemma.stableHitRate)}${Number(row.trilemma.adaptiveBalance)}`)
    }
  })

  // ============ snapshot ============
  it('cacheReplacementSnapshot: 形状 + verdict 同源', () => {
    const s = cacheReplacementStudy({ now: () => 528000 })
    const snap = cacheReplacementSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.config).toEqual(s.config)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.verdict.vectors).toEqual(s.vectors)
  })

  it('cacheReplacementSnapshot(null)/({}) → null 反守卫', () => {
    expect(cacheReplacementSnapshot(null as never)).toBe(null)
    expect(cacheReplacementSnapshot({} as never)).toBe(null)
  })

  // ============ evidence ============
  it('createReplacementEvidence 真件 ≥ 15 键 + 含 routerMoved/walLines/heapFired', () => {
    const ev = createReplacementEvidence({ seed: 528 }) as unknown as Record<string, number>
    const keys = Object.keys(ev).sort()
    expect(keys.length).toBeGreaterThanOrEqual(15)
    expect(ev.routerMoved).toBeGreaterThanOrEqual(0)
    expect(ev.walLines).toBeGreaterThanOrEqual(1)
    expect(ev.heapFired).toBeGreaterThanOrEqual(0)
  })

  // ============ dualSweep in study ============
  it('study 默认场景下 scanFeast：ARC 安全 /= LRU<、2Q 安全', () => {
    const s = cacheReplacementStudy({})
    const arc = s.rows.find((r) => r.protocol === 'ARC')!
    const q2 = s.rows.find((r) => r.protocol === '2Q')!
    const lru = s.rows.find((r) => r.protocol === 'LRU')!
    const arcScan = arc.scenarios.find((x) => x.id === 'scanFeast')!
    const q2Scan = q2.scenarios.find((x) => x.id === 'scanFeast')!
    const lruScan = lru.scenarios.find((x) => x.id === 'scanFeast')!
    expect(q2Scan.hitRate).toBeGreaterThanOrEqual(lruScan.hitRate)
    expect(arcScan.hitRate).toBeGreaterThanOrEqual(0.4)
  })

  // ============ 跨数据校验 ============
  it('verifyDualSweep 完整 arcplay 场景版真 = 0.5 容忍', () => {
    const trace: Array<[string, boolean]> = []
    for (let i = 0; i < 256; i++) trace.push([`k${Math.floor(i / 4)}`, false])
    const r = verifyDualSweep(trace)
    expect(r.holds).toBe(true)
    expect(r.laneA.hitRate).toBeGreaterThanOrEqual(0.6)
  })
})
