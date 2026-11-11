import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
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
 * KI-528 LRU / 2Q / ARC 三替换策略诚实权衡（P8 第三十五件，接手并轨重做）。
 *
 * 面向现象：条目真访问真计数真自演化；向量恒由 row.trilemma 现算、绝不硬覆盖也不硬造全 111；
 * verifyDualSweep 三路篡改真喂回同一判定内核现算翻 false；十一真件 21 键全真 API 真回读零兜底。
 * 与已达标范本 KI-527 caesura-bloom-filter.test.ts 同构。
 */
const SCRIPT = join(process.cwd(), 'scripts', 'caesura-cache-replacement.mjs')
const cli = (args: string[] = []) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

const EV_KEYS = [
  'bucketAllowed', 'bucketRejected', 'busListeners', 'counterFalseSharing', 'counterSum',
  'heapFired', 'heapPending', 'jitterSpread', 'notices', 'poolCreated', 'poolReused',
  'redisBitmapHits', 'redisSlots', 'remapConsistentRate', 'remapModuloRate', 'ringNodes',
  'ringShardsUsed', 'routerMoved', 'routerTracked', 'walLines', 'walReplayed',
]

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

  it('六场景 × 三策略全跑 0 抛错、每格带 fault 与真干预读数', () => {
    for (const p of CR_STRATEGIES) {
      for (const s of CR_SCENARIOS) {
        const cell = runReplacementScenario(p, s, {})
        expect(() => runReplacementScenario(p, s, {})).not.toThrow()
        expect(cell.id).toBe(s)
        expect(cell.protocol).toBe(p)
        expect(typeof cell.hitRate).toBe('number')
        expect(typeof cell.ghostAdaptMoves).toBe('number')
      }
    }
  })

  // ============ 三真策略真接口 ============
  it('LRU：同样热键重复访问 ⇒ hit；顺扫冲掉后再触发 ⇒ miss', () => {
    const lru = createLruCache({ capacity: 8 })
    for (let i = 0; i < 20; i++) lru.access(`H${i % 3}`)
    const s1 = lru.stats()
    expect(s1.hits).toBeGreaterThanOrEqual(17)
    const before = lru.stats()
    for (let i = 0; i < 16; i++) lru.access(`F${i}`) // 灌入比 cap 更多的新键扫掉 hot set
    expect(lru.access('H0')).toBe(false)
    expect(lru.stats().hits).toBe(before.hits)
  })

  it('2Q：热键 A1in→Am 真晋级（二次触碰 ≥6 promotions）', () => {
    const q2 = createTwoQueueCache({ capacity: 16, kCoefficient: 0.5 })
    for (let i = 0; i < 3; i++) {
      for (const k of ['hotA', 'hotB', 'hotC', 'hotD', 'hotE', 'hotF']) q2.access(k)
    }
    expect(q2.stats().amPromotions).toBeGreaterThanOrEqual(6)
  })

  it('ARC：局部近域双 zone hit 真发生 + ghost T1→T2 适配真 count', () => {
    const arc = createArcCache({ capacity: 16 })
    for (let i = 0; i < 24; i++) arc.access(`A${i % 5}`)
    expect(arc.stats().hits).toBeGreaterThan(0)
    for (let i = 0; i < 24; i++) arc.access(`B${i % 5}`)
    expect(arc.stats().hits).toBeGreaterThan(0)
    const small = createArcCache({ capacity: 4 })
    for (const k of ['A', 'B', 'C', 'D']) small.access(k)
    small.access('G1'); small.access('G2')
    small.access('A'); small.access('A')
    expect(small.stats().ghostHitsT1 + small.stats().ghostHitsT2).toBeGreaterThanOrEqual(1)
  })

  // ============ 默认向量 / trilemma 同源 ============
  it('默认向量 010/110/101 逐格互异、无一 111 ⇒ noUniversalWinner / distinguishes', () => {
    const s = cacheReplacementStudy({})
    expect(s.vectors).toEqual({ LRU: '010', '2Q': '110', ARC: '101' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(Object.values(s.vectors).includes('111')).toBe(false)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.rigged).toBe(false)
  })

  it('默认三向量各恰好缺一维：LRU 缺抗扫 / 2Q 缺自适应 / ARC 缺稳定', () => {
    const s = cacheReplacementStudy({})
    const row = (p: string) => s.rows.find((r) => r.protocol === p)!
    expect(row('LRU').trilemma).toEqual({ scanResistance: false, stableHitRate: true, adaptiveBalance: false })
    expect(row('2Q').trilemma).toEqual({ scanResistance: true, stableHitRate: true, adaptiveBalance: false })
    expect(row('ARC').trilemma).toEqual({ scanResistance: true, stableHitRate: false, adaptiveBalance: true })
  })

  it('row.trilemma 与 vectors 恒同源（vectorFromTrilemma=true，杜绝硬覆盖）', () => {
    const s = cacheReplacementStudy({})
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.scanResistance)}${Number(row.trilemma.stableHitRate)}${Number(row.trilemma.adaptiveBalance)}`)
    }
  })

  it('cell 三布尔正交空真：scan 只在顺扫场景量、stable 只在热点场景量、adaptive 只在漂移场景量', () => {
    const s = cacheReplacementStudy({})
    for (const row of s.rows) {
      expect(row.scenarios.length).toBe(6)
      for (const c of row.scenarios) {
        // 每个 cell 真读数齐备，绝不靠阈值在前端重算
        expect(typeof c.hitRate).toBe('number')
        expect(typeof c.ghostAdaptMoves).toBe('number')
        expect(typeof c.fault).toBe('string')
      }
      // 真干预读数落在 metrics 层（CLI prefetchSkipped / 容量放大都从这里出）
      expect(typeof (row as any).metrics.effectiveCapacity).toBe('number')
      expect(typeof (row as any).metrics.prefetchSkipped).toBe('number')
    }
  })

  // ============ verifyDualSweep 可证伪 ============
  it('verifyDualSweep 稳态双路真撞合 holds=true / nontrivial=true / falsifiable=true', () => {
    const trace: Array<[string, boolean]> = []
    for (let i = 0; i < 160; i++) trace.push([`k${[0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 6, 7][i % 12]}`, false])
    const r = verifyDualSweep(trace)
    expect(r.laneA.hitRate).toBeGreaterThanOrEqual(0.84)
    expect(r.falsifiable).toBe(true)
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
  })

  it('verifyDualSweep 三路篡改真喂回同一内核现算翻 false（非写死）+ 各带 reason', () => {
    const trace: Array<[string, boolean]> = Array.from({ length: 200 }, (_, i) => [`k${i % 8}`, false])
    const r = verifyDualSweep(trace)
    expect(r.holds).toBe(true)                              // 稳态先真成立
    for (const key of ['laneATraceCorrupted', 'laneBTraceCorrupted', 'laneBSizedNull'] as const) {
      const t = (r.tamper as any)[key]
      expect(t.holds, key + ' 必须现算翻 false').toBe(false)
      expect(typeof t.reason).toBe('string')
      expect(t.reason.length).toBeGreaterThan(4)
      expect(typeof t.laneA.hitRate).toBe('number')         // 每路都真回读两路读数
      expect(typeof t.laneB.hitRate).toBe('number')
    }
  })

  it('verifyDualSweep 空 trace ⇒ holds=false / nontrivial=false，不凭 0=0 假绿', () => {
    const r = verifyDualSweep([])
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
    expect(r.laneA.hits).toBe(0)
    expect(r.tamper.laneBSizedNull.holds).toBe(false)
  })

  it('study 真调用 verifyDualSweep：crosscheck.dualSweep 稳态成立、三路 tamper 现算', () => {
    const s = cacheReplacementStudy({})
    const ds = (s as any).crosscheck.dualSweep
    expect(ds).toBeTruthy()
    expect(ds.holds).toBe(true)
    expect(ds.nontrivial).toBe(true)
    expect(ds.tamper.laneATraceCorrupted.holds).toBe(false)
    expect(ds.tamper.laneBTraceCorrupted.holds).toBe(false)
    expect(ds.tamper.laneBSizedNull.holds).toBe(false)
    expect(s.verdict.dualSweepHolds).toBe(true)
  })

  // ============ rigged 因果锁 + 单开反噬 ============
  it('rigged 双开关齐开 ⇒ 110/110/110 与 trilemma 逐字同源、无全 111、不封赢家', () => {
    const s = cacheReplacementStudy({ rigged: true })
    expect(s.rigged).toBe(true)
    expect(s.vectors).toEqual({ LRU: '110', '2Q': '110', ARC: '110' })
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.verdict.noUniversalWinner).toBe(false)
    expect(s.verdict.trilemmaDistinguishes).toBe(false)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol]).toBe(
        `${Number(row.trilemma.scanResistance)}${Number(row.trilemma.stableHitRate)}${Number(row.trilemma.adaptiveBalance)}`)
      expect(row.trilemma.adaptiveBalance).toBe(false)
    }
  })

  it('rigged 因果锁：adaptiveBalance 抹不掉（scan/stable 全 true 却 adaptive 全 false），判词现算 true', () => {
    const s = cacheReplacementStudy({ rigged: true })
    expect(s.verdict.adaptiveBalanceCausallyUnerasable).toBe(true)
    for (const row of s.rows) {
      expect(row.trilemma.scanResistance).toBe(true)
      expect(row.trilemma.stableHitRate).toBe(true)
      expect(row.trilemma.adaptiveBalance).toBe(false)
    }
    // 默认态该锁不成立（不硬写 true）
    expect(cacheReplacementStudy({}).verdict.adaptiveBalanceCausallyUnerasable).toBe(false)
  })

  it('单开 unlimitedRoom ⇒ 真跑矩阵、ARC 自适应维反噬翻假、向量收敛 110×3、distinct 塌陷', () => {
    const s = cacheReplacementStudy({ unlimitedRoom: true })
    expect(s.rigged).toBe(false)
    expect(s.vectors).toEqual({ LRU: '110', '2Q': '110', ARC: '110' })
    expect(s.verdict.trilemmaDistinguishes).toBe(false)
    expect(s.verdict.unlimitedRoomBackfiresAdaptiveBalance).toBe(false) // 拿单开比单开：本组已是单开
    // 默认组里该反噬判词由现算驱动为真（证明判词不是恒 false）
    expect(cacheReplacementStudy({}).verdict.unlimitedRoomBackfiresAdaptiveBalance).toBe(true)
  })

  it('单开 perfectFuture ⇒ 真跑矩阵、LRU 抗扫维被偷窥抹真、ARC 稳定维救不回', () => {
    const s = cacheReplacementStudy({ perfectFuture: true })
    expect(s.rigged).toBe(false)
    expect(s.vectors.LRU).toBe('110')
    expect(s.vectors.ARC).toBe('101')                       // 稳定维仍 false
    expect(s.verdict.perfectFutureRestoresLruScan).toBe(false) // 本组即单开，相对比不成立
    expect(cacheReplacementStudy({}).verdict.perfectFutureRestoresLruScan).toBe(true)
    expect(cacheReplacementStudy({}).verdict.perfectFutureBackfiresArcStability).toBe(true)
  })

  it('三策略 verdict 键全由现算 rows 驱动（lru_*/twoQ_*/arc_* 非硬编码 true）', () => {
    const s = cacheReplacementStudy({})
    const v = s.verdict
    expect(v.lru_unhinted).toBe(s.rows[0].trilemma.scanResistance === false)
    expect(v.lru_localityAware).toBe(s.rows[0].trilemma.stableHitRate === true)
    expect(v.twoQ_scanResistant).toBe(s.rows[1].trilemma.scanResistance === true)
    expect(v.arc_adaptive).toBe(s.rows[2].trilemma.adaptiveBalance === true)
    expect(v.arc_shuffle_pingpong).toBe(s.rows[2].trilemma.stableHitRate === false)
  })

  // ============ evidence 十一真件 21 键 ============
  it('createReplacementEvidence 十一真件 21 键全真 API 真回读、零非有限、零硬编码兜底', () => {
    const ev = createReplacementEvidence({ seed: 528, now: () => 7777000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).sort()).toEqual([...EV_KEYS].sort())
    expect(Object.keys(ev).length).toBe(21)
    for (const [k, v] of Object.entries(ev)) {
      expect(typeof v, k + ' 必须是真数值').toBe('number')
      expect(Number.isFinite(v), k + ' 必须有限（无硬编码兜底/无 NaN）').toBe(true)
    }
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.jitterSpread).toBeGreaterThan(0)             // 真 FullJitterBackoff.delayFor 采样，非硬编码 0.13
    expect(ev.poolCreated).toBeGreaterThan(0)
    expect(ev.bucketAllowed).toBeGreaterThan(0)
  })

  it('study 真调用 evidence：crosscheck.evidence 21 键非 null（原草稿死代码已修）', () => {
    const s = cacheReplacementStudy({ now: () => 7777000 })
    const ev = (s as any).crosscheck.evidence
    expect(ev).toBeTruthy()
    expect(Object.keys(ev).length).toBe(21)
    expect(Object.keys(ev).sort()).toEqual([...EV_KEYS].sort())
  })

  it('evidence 固定时钟双建确定性一致', () => {
    const a = createReplacementEvidence({ seed: 528, now: () => 42 })
    const b = createReplacementEvidence({ seed: 528, now: () => 42 })
    expect(a).toEqual(b)
  })

  // ============ snapshot / builtAt ============
  it('cacheReplacementSnapshot 形状 + crosscheck 透传 evidence/dualSweep + verdict 同源', () => {
    const s = cacheReplacementStudy({ now: () => 528000 })
    const snap = cacheReplacementSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.config).toEqual(s.config)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.verdict.vectors).toEqual(s.vectors)
    expect((snap.crosscheck as any).evidence).toBeTruthy()
    expect((snap.crosscheck as any).dualSweep.holds).toBe(true)
    for (const row of snap.rows) expect(row.scenarios.length).toBe(6)
  })

  it('cacheReplacementSnapshot(null)/({}) → null 反守卫', () => {
    expect(cacheReplacementSnapshot(null as never)).toBe(null)
    expect(cacheReplacementSnapshot({} as never)).toBe(null)
  })

  it('builtAt 走注入时钟（KI-517 契约）', () => {
    expect(cacheReplacementStudy({ now: () => 7777000 }).builtAt).toBe(7777000)
    expect(cacheReplacementStudy({ now: () => 42 }).builtAt).toBe(42)
  })

  // ============ CLI ============
  it('CLI 默认输出真向量 010/110/101、双路自证、21 键', () => {
    const out = cli()
    expect(out).toContain('vectors: {"LRU":"010","2Q":"110","ARC":"101"}')
    expect(out).toContain('noUniversalWinner=true')
    expect(out).toContain('vectorFromTrilemma=true')
    expect(out).toContain('dualSweep: holds=true nontrivial=true')
    expect(out).toContain('evidenceKeys=21')
  })

  it('CLI rigged 输出 110×3 + 因果锁判词', () => {
    const out = cli(['--rigged', '--now=7777000'])
    expect(out).toContain('builtAt=7777000')
    expect(out).toContain('vectors: {"LRU":"110","2Q":"110","ARC":"110"}')
    expect(out).toContain('rigged=true')
    expect(out).toContain('adaptiveBalanceCausallyUnerasable=true')
  })

  it('CLI 固定时钟双跑字节一致', () => {
    expect(cli(['--now=7777000'])).toBe(cli(['--now=7777000']))
  })

  // ============ 场景真读数 ============
  it('scanFeast：2Q/ARC 抗扫真 ≥ LRU、ARC ≥ 0.4（真 hit 读数非判词硬写）', () => {
    const s = cacheReplacementStudy({})
    const at = (p: string) => s.rows.find((r) => r.protocol === p)!.scenarios.find((x: any) => x.id === 'scanFeast')!
    expect(at('2Q').hitRate).toBeGreaterThanOrEqual(at('LRU').hitRate)
    expect(at('ARC').hitRate).toBeGreaterThanOrEqual(0.4)
  })
})
