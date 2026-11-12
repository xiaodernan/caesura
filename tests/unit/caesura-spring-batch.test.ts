import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  BATCH_DEFAULTS,
  BATCH_STRATEGIES,
  BATCH_SCENARIOS,
  createBulkWriter,
  createChunkedWriter,
  createSkipRetryWriter,
  streamOf,
  springBatchStudy,
  springBatchSnapshot,
  verifyCheckpoint,
  verifyCausalLocks,
  createBatchEvidence,
} from '../../scripts/caesura-spring-batch.mjs'

/**
 * KI-532 Spring Batch chunk-oriented R-P-W（P8 第三十九件 · 前端第二十六维）。
 * 与 KI-525..531 同族测试面——三真件真跑、向量由 vecOf(row.trilemma) 现算、三路篡改真喂回同一内核、绝不写死。
 */
const ROOT = resolve(process.cwd())
const ev = (n: number, poisonAt: number[] = []) =>
  Array.from({ length: n }, (_, i) => ({ id: i, poison: poisonAt.includes(i), payload: `k:${i}` }))

describe('caesura-spring-batch（KI-532）', () => {
  // ============ 配置与名册（1）============
  it('① BATCH_DEFAULTS / BATCH_STRATEGIES / BATCH_SCENARIOS 固定顺序、键名同词', () => {
    expect(BATCH_STRATEGIES).toEqual(['BulkWriter', 'ChunkedWriter', 'SkipRetryWriter'])
    expect(BATCH_SCENARIOS).toEqual(
      ['cleanRun', 'poisonOne', 'restartMidway', 'burstLoad', 'skipSaturation', 'cleanRerun'],
    )
    expect(BATCH_DEFAULTS.seed).toBe(532)
    expect(BATCH_DEFAULTS.items).toBe(96)
    expect(BATCH_DEFAULTS.chunkSize).toBe(8)
    expect(BATCH_DEFAULTS.skipLimit).toBe(2)
  })

  // ============ 三真写实现（7）============
  it('② BulkWriter：全流缓冲一次 flush、poison 即整批死、无 chk、无 skip', () => {
    const bw = createBulkWriter({})
    const result = bw.flush(ev(4, [2]))
    expect(result.flushed).toBe(false)
    expect(result.processed).toBe(0)
    expect(bw.stats().faults).toBe(1)
    expect(bw.stats().checkpoints).toBe(0)
    expect(bw.restart(ev(4, [2])).survivors).toBe(2)
    expect(bw.restartability()).toBe(false)
  })

  it('③ BulkWriter：无 poison 的流 ⇒ 一次 flush 全部通过', () => {
    const bw = createBulkWriter({})
    const result = bw.flush(ev(16))
    expect(result.flushed).toBe(true)
    expect(result.processed).toBe(16)
    expect(bw.stats().checkpoints).toBe(0)
  })

  it('④ ChunkedWriter：poison 杀当前 chunk、其余 chk 不被连坐', () => {
    const cw = createChunkedWriter({ chunkSize: 8 })
    const result = cw.flush(ev(24, [10]))
    expect(result.faults).toBe(1)
    expect(result.processed).toBe(8)   // 只有 chunk0 commit，poison chunk1 中断 flush
    expect(result.checkpoints).toBe(1)
    expect(cw.stats().dropped).toBe(8)
  })

  it('⑤ ChunkedWriter：restart(0) 真 chk 定界续跑——poison chunk 跳过、其余照 commit、已 commit 零重复', () => {
    const cw = createChunkedWriter({ chunkSize: 8 })
    const r = cw.restart(ev(24, [10]), 0)
    expect(r.committedChunks).toBe(2)       // chunk0 + chunk2
    expect(r.processed).toBe(16)            // 8 + 8，poison chunk1 的 8 项不 commit
    expect(r.faults).toBe(1)
    const ids = cw.seq.map((e) => e.id)
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23])
    expect(new Set(ids).size).toBe(ids.length) // 零重复写
    expect(cw.stats().checkpoints).toBe(2)
    expect(cw.restartability()).toBe(true)
  })

  it('⑥ ChunkedWriter：restart(fromChk>0) 跳过已 chk 的 chunk，从边界续跑', () => {
    const cw = createChunkedWriter({ chunkSize: 8 })
    const r = cw.restart(ev(24, [10]), 1)
    expect(r.committedChunks).toBeGreaterThanOrEqual(2)
    expect(r.faults).toBeGreaterThanOrEqual(1)
  })

  it('⑦ SkipRetryWriter：毒项记 skip 继续、skip 超 limit 真败、永久丢毒行', () => {
    const sr = createSkipRetryWriter({ skipLimit: 2 })
    const result = sr.flush(ev(10, [0, 2, 3, 4, 5]))
    expect(result.faults).toBe(1)
    expect(sr.stats().dropped).toBeGreaterThan(0)
    expect(sr.stats().checkpoints).toBe(0)  // skip 无 chk
    expect(sr.restartability()).toBe(false)
    expect(sr.seq.every((e) => !e.poison)).toBe(true)
  })

  it('⑧ SkipRetryWriter：unlimitedSkip=true ⇒ 无限 skip 也不 fatal，但 dropped 不减（silent loss）', () => {
    const sr = createSkipRetryWriter({ skipLimit: 2, unlimitedSkip: true })
    const result = sr.flush(ev(10, [0, 1, 2, 3, 4]))
    expect(result.faults).toBe(0)
    expect(result.skips).toBe(5)
    expect(sr.skips()).toBe(5)
    expect(sr.stats().dropped).toBe(5)      // 免 fatal 但不免丢
    expect(sr.stats().checkpoints).toBe(0)
  })

  // ============ 场景流（2）============
  it('⑨ streamOf：六场景确定性、clean 无 poison、含毒场景 poison 位置正确', () => {
    expect(streamOf('cleanRun', { items: 96 }).length).toBe(96)
    expect(streamOf('cleanRun', { items: 96 }).filter((e) => e.poison).length).toBe(0)
    expect(streamOf('burstLoad', { items: 96 }).length).toBe(192)
    for (const sc of ['poisonOne', 'restartMidway', 'cleanRerun']) {
      expect(streamOf(sc, { items: 96 }).filter((e) => e.poison).length).toBe(1)
    }
    expect(streamOf('skipSaturation', { items: 96 }).filter((e) => e.poison).length).toBeGreaterThan(2)
  })

  it('⑩ streamOf：同 seed 同流、不同 seed 不同 payload（确定性 + 注入生效）', () => {
    const a = streamOf('cleanRun', { seed: 1, items: 32 })
    const b = streamOf('cleanRun', { seed: 1, items: 32 })
    const c = streamOf('cleanRun', { seed: 2, items: 32 })
    expect(a).toEqual(b)
    expect(a[0].payload).not.toBe(c[0].payload)
    expect(streamOf('cleanRun', { items: 128 }).length).toBe(128)
  })

  // ============ verifyCheckpoint 双路 + 三路真喂回（4）============
  it('⑪ verifyCheckpoint（restartMidway）：holds=true baselineHolds=true nontrivial=true falsifiable=true', () => {
    const r = verifyCheckpoint({ events: streamOf('restartMidway', { items: 96 }), seed: 532, chunkSize: 8 })
    expect(r.holds).toBe(true)
    expect(r.baselineHolds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.laneA.baselineFaults).toBe(0)
    expect(r.laneA.baselineProcessed).toBe(96)
    expect(r.invariants).toEqual({
      laneAOk: true, poisonIsolated: true, noDuplicate: true, noLoss: true, poisonChunkDetected: true,
    })
  })

  it('⑫ verifyCheckpoint 空 jobs ⇒ holds=false nontrivial=false（绝不 0=0 假绿）', () => {
    const r = verifyCheckpoint({ events: [], seed: 532, chunkSize: 8 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
    expect(r.tamper.emptyJob.holds).toBe(false)
    expect(r.tamper.emptyJob.nontrivial).toBe(false)
  })

  it('⑬ verifyCheckpoint 三路篡改真喂回同一内核现算翻 false（非写死）', () => {
    const events = streamOf('restartMidway', { items: 96 })
    const r = verifyCheckpoint({ events, seed: 532, chunkSize: 8 })
    // 基线先真绿
    expect(r.baselineHolds).toBe(true)
    // corruptCheckpoint：真制造重复写 ⇒ noDuplicate 翻 false
    expect(r.tamper.corruptedCheckpoint.holds).toBe(false)
    expect(r.tamper.corruptedCheckpoint.invariants.noDuplicate).toBe(false)
    // silentPoison：真把毒当正常项 commit ⇒ poisonIsolated 翻 false
    expect(r.tamper.silentPoison.holds).toBe(false)
    expect(r.tamper.silentPoison.invariants.poisonIsolated).toBe(false)
    // emptyJob：nontrivial 翻 false
    expect(r.tamper.emptyJob.holds).toBe(false)
  })

  it('⑭ verifyCheckpoint 篡改带 baselineHolds 对照，篡改只翻对应不变量不连坐', () => {
    const events = streamOf('restartMidway', { items: 96 })
    const base = verifyCheckpoint({ events, seed: 532, chunkSize: 8 })
    const tuned = verifyCheckpoint({ events: streamOf('restartMidway', { items: 128 }), seed: 7, chunkSize: 16 })
    expect(base.holds).toBe(true)
    expect(tuned.holds).toBe(true)              // 换规模/时钟仍真撞合
    expect(tuned.laneA.baselineProcessed).toBe(128)
    expect(base.tamper.silentPoison.invariants.noDuplicate).toBe(true) // silent 只破隔离、不破去重的独立观测
  })

  // ============ verifyCausalLocks 三条因果锁（3）============
  it('⑮ 三因果锁真跑现算 allHold=true（chk 权衡 / skip 永久丢 / bulk 整批死）', () => {
    const locks = verifyCausalLocks({ items: 96, chunkSize: 8, skipLimit: 2 })
    expect(locks.checkpointTradeoffCausallyUnerasable).toBe(true)
    expect(locks.skipSilentLossCausallyUnerasable).toBe(true)
    expect(locks.bulkAllOrNothingCausallyUnerasable).toBe(true)
    expect(locks.causalLocksAllHold).toBe(true)
  })

  it('⑯ 因果锁与规模无关：不同 chunkSize/items 下仍 allHold=true', () => {
    for (const cfg of [{ items: 64, chunkSize: 4, skipLimit: 1 }, { items: 160, chunkSize: 16, skipLimit: 8 }]) {
      expect(verifyCausalLocks(cfg).causalLocksAllHold).toBe(true)
    }
  })

  it('⑰ 因果锁是可证伪的：反事实 API 真喂回会破（chunk 无 chk / skip 不丢）', () => {
    // 反事实：如果 ChunkedWriter 不落 chk（用 chunkSize 极大一次 commit 全场），restartability 依赖的 chk 分界就动
    // 这里以真 API 断言「有 chk ⇔ restartable ⇔ 非吞吐」，替换成没 chk 的 Skip/Bulk 时该维必翻——判据非恒真
    const raw = streamOf('poisonOne', { items: 96 })
    const chunk = createChunkedWriter({ chunkSize: 8 })
    chunk.flush(raw)
    const skip = createSkipRetryWriter({ skipLimit: 2 })
    skip.flush(raw)
    expect(chunk.stats().checkpoints).toBeGreaterThan(0)
    expect(skip.stats().checkpoints).toBe(0)
    expect(chunk.restartability()).toBe(true)
    expect(skip.restartability()).toBe(false)
    // skip 反事实：若 skip 不丢毒行，则 silentLoss 锁应翻——真观测 dropped>0 钉死它没翻
    expect(skip.stats().dropped).toBeGreaterThan(0)
  })

  // ============ study 矩阵 + 向量（6）============
  it('⑱ springBatchStudy 默认向量逐格互异、无一 111 ⇒ noUniversalWinner=true distinguishing', () => {
    const s = springBatchStudy({ now: () => 532000 })
    expect(s.vectors.BulkWriter).toBe('001')
    expect(s.vectors.ChunkedWriter).toBe('110')
    expect(s.vectors.SkipRetryWriter).toBe('101')
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
    expect(s.builtAt).toBe(532000)
  })

  it('⑲ 默认向量各自缺一维：Bulk 毒物整批死、Chunk 真 chk 但 commit 慢、Skip 永久丢毒行', () => {
    const s = springBatchStudy({})
    const bulk = s.rows.find((r) => r.protocol === 'BulkWriter')!
    const chunk = s.rows.find((r) => r.protocol === 'ChunkedWriter')!
    const skip = s.rows.find((r) => r.protocol === 'SkipRetryWriter')!
    expect(bulk.trilemma).toEqual({ faultIsolation: false, restartability: false, throughput: true })
    expect(chunk.trilemma).toEqual({ faultIsolation: true, restartability: true, throughput: false })
    expect(skip.trilemma).toEqual({ faultIsolation: true, restartability: false, throughput: true })
    expect(skip.metrics.itemsDropped).toBeGreaterThan(0)
    expect(chunk.metrics.chunkedCheckpoints).toBeGreaterThan(0)
  })

  it('⑳ row.trilemma 与 vectors 同源、cell 六字段 + 三考场标记正交空真不连坐', () => {
    const s = springBatchStudy({})
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.faultIsolation)}${Number(row.trilemma.restartability)}${Number(row.trilemma.throughput)}`)
      expect(row.scenarios.length).toBe(BATCH_SCENARIOS.length)
      for (const c of row.scenarios) {
        expect(typeof c.checkpoints).toBe('number')
        expect(typeof c.dropped).toBe('number')
        expect(typeof c.wholeBatchDied).toBe('boolean')
        expect(['boolean']).toContain(typeof c.inFaultExam)
        expect(['boolean']).toContain(typeof c.inRestartExam)
        expect(['boolean']).toContain(typeof c.inThroughputExam)
      }
    }
    // cleanRun 无 poison ⇒ 不在 fault 考场；Bulk clean cell 不 wholeBatchDied
    const bulkClean = s.rows[0].scenarios.find((c) => c.id === 'cleanRun')!
    expect(bulkClean.inFaultExam).toBe(false)
    expect(bulkClean.wholeBatchDied).toBe(false)
  })

  it('㉑ 注入 items/chunkSize/skipLimit/seed 真生效（不是只改 config 显示）', () => {
    const base = springBatchStudy({ now: () => 1 })
    const tuned = springBatchStudy({ now: () => 1, items: 128, chunkSize: 16, skipLimit: 5, seed: 7 })
    expect(tuned.config.items).toBe(128)
    expect(tuned.config.chunkSize).toBe(16)
    expect(tuned.config.skipLimit).toBe(5)
    expect(tuned.config.seed).toBe(7)
    expect(tuned.rows[0].scenarios[0].size).toBe(96 + 32) // 128
    expect(streamOf('cleanRun', { items: 128 }).length).toBe(128)
    expect(tuned.rows.find((r) => r.protocol === 'ChunkedWriter')!.metrics.chunkedCheckpoints).toBeGreaterThan(0)
    expect(base.rows[0].scenarios[0].size).toBe(96)
  })

  it('㉒ 单开 perfectOracle ⇒ Bulk 预防剔除毒、faultIsolation=true，但 chk=false 不变', () => {
    const s = springBatchStudy({ perfectOracle: true })
    expect(s.rows.find((r) => r.protocol === 'BulkWriter')!.trilemma.faultIsolation).toBe(true)
    expect(s.rows.find((r) => r.protocol === 'BulkWriter')!.trilemma.restartability).toBe(false)
    expect(s.verdict.perfectOracleErasesPoison).toBe(true)
    expect(s.verdict.bulkExplodesOnPoison).toBe(true) // 主教义恒以纯净基线标定，不翻
  })

  it('㉓ 单开 unlimitedSkip ⇒ Skip restartability 仍 false（unlimitedSkip 不创 chk）', () => {
    const s = springBatchStudy({ unlimitedSkip: true })
    expect(s.verdict.unlimitedSkipNoRestart).toBe(true)
    expect(s.rows.find((r) => r.protocol === 'SkipRetryWriter')!.trilemma.restartability).toBe(false)
    expect(s.verdict.causalLocksAllHold).toBe(true)
  })

  it('㉔ rigged 诚实标定：Bulk≡Skip=101 区分度收敛、不硬造 111、三因果锁仍钉死', () => {
    const s = springBatchStudy({ rigged: true, now: () => 532000 })
    expect(s.rigged).toBe(true)
    expect(s.vectors).toEqual({ BulkWriter: '101', ChunkedWriter: '110', SkipRetryWriter: '101' })
    expect(new Set(Object.values(s.vectors)).size).toBe(2)     // Bulk 与 Skip 收敛
    expect(s.verdict.riggedConvergenceCollapsed).toBe(true)    // 诚实标注，不假装仍互异
    expect(s.trilemmaDistinguishes).toBe(false)
    expect(s.verdict.noStrategyWinsAll).toBe(true)             // 仍无一 111
    expect(s.verdict.causalLocksAllHold).toBe(true)            // 三锁与 rigged 输入无关
    expect(s.verdict.bulkExplodesOnPoison).toBe(true)          // 主教义不翻
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('㉕ study.crosscheck 双路自证稳态真撞合、三路篡改真红、21 键 evidence 真回读', () => {
    const s = springBatchStudy({ now: () => 532000 })
    const cp = s.crosscheck.checkpoint
    expect(cp.holds).toBe(true)
    expect(cp.baselineHolds).toBe(true)
    expect(cp.falsifiable).toBe(true)
    expect(cp.tamper.corruptedCheckpoint.holds).toBe(false)
    expect(cp.tamper.silentPoison.holds).toBe(false)
    expect(cp.tamper.emptyJob.holds).toBe(false)
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
  })

  // ============ snapshot（2）============
  it('㉖ springBatchSnapshot：形状 + 顶层 rigged/noUniversalWinner/trilemmaDistinguishes/causalLocks 同源', () => {
    const s = springBatchStudy({ now: () => 532000 })
    const snap = springBatchSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.builtAt).toBe(532000)
    expect(snap.config).toEqual(s.config)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.verdict.vectors).toEqual(s.vectors)
    expect(snap.rigged).toBe(false)
    expect(snap.noUniversalWinner).toBe(true)
    expect(snap.trilemmaDistinguishes).toBe(true)
    expect(snap.causalLocks.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck && snap.crosscheck.evidence).toBeDefined()
    expect(snap.crosscheck && snap.crosscheck.checkpoint).toBeDefined()
    const rig = springBatchSnapshot(springBatchStudy({ rigged: true, now: () => 532000 }))!
    expect(rig.rigged).toBe(true)
    expect(rig.trilemmaDistinguishes).toBe(false)
    expect(rig.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('㉗ springBatchSnapshot(null)/({}) → null 反守卫', () => {
    expect(springBatchSnapshot(null as never)).toBe(null)
    expect(springBatchSnapshot({} as never)).toBe(null)
  })

  // ============ evidence（1）============
  it('㉘ createBatchEvidence 真件 ≥21 键 + 核心件真回读 + builtAt 注入不漂移', () => {
    const ev1 = createBatchEvidence({ seed: 532, now: () => 532000 }) as unknown as Record<string, number>
    const ev2 = createBatchEvidence({ seed: 532, now: () => 532000 }) as unknown as Record<string, number>
    const keys = Object.keys(ev1).sort()
    expect(keys.length).toBeGreaterThanOrEqual(21)
    expect(keys).toEqual(Object.keys(ev2).sort())
    expect(ev1).toEqual(ev2)
    expect(ev1.redisBitmapHits).toBeGreaterThan(0)
    expect(ev1.walReplayed).toBeGreaterThan(0)
    expect(ev1.counterSum).toBeGreaterThan(0)
    expect(ev1.jitterSpread).toBeGreaterThan(0)
  })

  // ============ CLI 双跑字节一致（1）============
  it('㉙ CLI 默认 + rigged 固定时钟双跑字节一致', () => {
    const cli = resolve(ROOT, 'scripts/caesura-spring-batch.mjs')
    const run = (args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
    expect(run(['--now=1000'])).toBe(run(['--now=1000']))
    expect(run(['--rigged', '--now=1000'])).toBe(run(['--rigged', '--now=1000']))
  })
})
