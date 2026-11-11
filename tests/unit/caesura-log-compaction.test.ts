import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LC_DEFAULTS,
  LC_SCENARIOS,
  LC_STRATEGIES,
  compareLogCompaction,
  createKeyCompaction,
  createLogCompactionEvidence,
  createSizeTimeRetention,
  createSnapshotPlusWal,
  logCompactionSnapshot,
  logCompactionStudy,
  runLogCompactionScenario,
  verifyReplayBoundary,
} from '../../scripts/caesura-log-compaction.mjs'

/**
 * KI-526 append-only 日志压缩 / 回放边界：SizeTimeRetention / KeyCompaction / SnapshotPlusWal 三策略诚实权衡。
 * 全进程内确定性教学状态机，headless 可证；不接真 Kafka log cleaner / 真 RocksDB compaction / 真快照分发。
 * 断言读数全部来自 CLI / study / 真件实测，非拍脑袋硬编码。
 */

const SCRIPT = join(process.cwd(), 'scripts', 'caesura-log-compaction.mjs')
const cli = (args: string[] = []) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
const cell = (s: any, strategy: string, id: string) =>
  s.rows.find((r: any) => r.strategy === strategy).scenarios.find((c: any) => c.id === id)
const vecOf = (r: any) =>
  `${Number(r.trilemma.compactFootprint)}${Number(r.trilemma.replayCompleteness)}${Number(r.trilemma.fastRecovery)}`
const baseOps = () => Array.from({ length: 6 }, (_, i) => ({ lsn: i + 1, ts: (i + 1) * 10, op: 'put', key: `k${i + 1}`, value: i + 1 }))

describe('KI-526 日志压缩 / 回放边界：三策略 × 六场景 × 三难', () => {
  describe('① 默认导出 + 三真策略件', () => {
    it('LC_DEFAULTS / LC_STRATEGIES / LC_SCENARIOS 顺序钉死', () => {
      expect(LC_DEFAULTS.seed).toBe(526)
      expect(LC_DEFAULTS.ops).toBe(24)
      expect(LC_DEFAULTS.keySpace).toBe(16)
      expect(LC_DEFAULTS.retentionOps).toBe(6)
      expect(LC_DEFAULTS.replayBudget).toBe(8)
      expect(LC_DEFAULTS.footprintBudget).toBe(1.0)
      expect(LC_STRATEGIES).toEqual(['SizeTimeRetention', 'KeyCompaction', 'SnapshotPlusWal'])
      expect(LC_SCENARIOS).toEqual([
        'steadyAppend', 'hotKeyChurn', 'tombstoneBurst', 'slowConsumer', 'crashMidReplay', 'retentionPressure',
      ])
    })

    it('createSizeTimeRetention：超窗口删最老段，replay 从被截位点起放真算 missingOps', () => {
      const r = createSizeTimeRetention({ retentionOps: 3 })
      for (const rec of baseOps()) r.append(rec)
      const comp = r.compact(6, 60)
      expect(comp.compactedOps).toBe(3)
      expect(comp.retainedOps).toBe(3)
      expect(comp.cutoffLsn).toBe(4)
      expect(r.state().oldestLsn).toBe(4)
      const slow = r.replay(1)
      expect(slow.missingOps).toBe(3) // [1,4) 真丢
      expect(slow.complete).toBe(false)
      const ok = r.replay(4)
      expect(ok.missingOps).toBe(0)
      expect(ok.complete).toBe(true) // 从可服务起点回放即完整
      expect(r.state().writeAmplification).toBe(1) // 截断不产生写放大
    })

    it('createKeyCompaction：同 key 只留最新值 + tombstone，恢复要重放全部唯一键', () => {
      const k = createKeyCompaction({ deleteRetention: 3 })
      const ops = [
        { lsn: 1, ts: 1, op: 'put', key: 'a', value: 1 },
        { lsn: 2, ts: 2, op: 'put', key: 'a', value: 2 },
        { lsn: 3, ts: 3, op: 'put', key: 'b', value: 3 },
        { lsn: 4, ts: 4, op: 'del', key: 'b', value: null },
        { lsn: 5, ts: 5, op: 'put', key: 'c', value: 4 },
      ]
      for (const rec of ops) k.append(rec)
      const comp = k.compact(5)
      expect(comp.compactedOps).toBe(2) // a 的旧值 + b 的旧 put 被折叠
      expect(comp.retainedOps).toBe(3)  // a:2 + b:tombstone + c:4
      const st = k.state()
      expect(st.distinctKeys).toBe(2)
      expect(st.tombstones).toBe(1)
      expect(st.writeAmplification).toBeLessThan(1) // 压缩省空间
      const rep = k.replay()
      expect(rep.replayOps).toBe(3) // 全部唯一键 + tombstone
      expect(rep.complete).toBe(true)
    })

    it('createKeyCompaction：delete-retention 边界早清 tombstone ⇒ resurrect 自曝', () => {
      const k = createKeyCompaction({ deleteRetention: 2 })
      k.append({ lsn: 1, ts: 1, op: 'put', key: 'x', value: 1 })
      k.append({ lsn: 2, ts: 2, op: 'del', key: 'x', value: null })
      const comp = k.compact(10) // currentLsn 10 − tombstone lsn 2 = 8 ≥ 2 ⇒ 清掉
      expect(comp.tombstoneCleared).toBe(1)
      expect(comp.resurrect).toBe(true)
    })

    it('createSnapshotPlusWal：按 LSN 去重折叠段、exactly-once 真不重不漏', () => {
      const s = createSnapshotPlusWal({ snapshotAt: 3 })
      for (const rec of baseOps()) s.append(rec)
      const info = s.takeSnapshot(3)
      expect(info.snapshotKeys).toBe(6)
      expect(info.foldedCount).toBe(3)
      expect(info.walRetained).toBe(3)
      const rep = s.replay()
      expect(rep.replayedRaw).toBe(6)      // 折叠 3 + 增量 3
      expect(rep.dedupSkipped).toBe(3)     // 折叠段逐条去重（真证据）
      expect(rep.replayedUnique).toBe(3)   // 增量段逐条应用
      expect(rep.replayOps).toBe(3)        // 恢复只付增量成本
      expect(rep.exactlyOnce).toBe(true)
      expect(s.state().writeAmplification).toBe(2) // (6 WAL + 6 快照) / 6 ⇒ 双写放大
    })

    it('createSnapshotPlusWal：instantSnapshot 空快照 ⇒ 去重失效、全量重放、空间归零', () => {
      const s = createSnapshotPlusWal({ snapshotAt: 3, instantSnapshot: true })
      for (const rec of baseOps()) s.append(rec)
      s.takeSnapshot(3)
      const rep = s.replay()
      expect(rep.dedupSkipped).toBe(0)    // 无快照基准可去重
      expect(rep.replayedUnique).toBe(6)  // 全量补放
      expect(rep.replayOps).toBe(6)
      expect(rep.exactlyOnce).toBe(false) // 去重机制失效
      expect(s.state().writeAmplification).toBe(1) // 空快照零空间写入（真算，非硬编码）
    })
  })

  describe("② 可证伪守恒自证 verifyReplayBoundary（类比 KI-525 Little's Law）", () => {
    it('双路恒等式 A+B 稳态真撞合', () => {
      const rb = verifyReplayBoundary({
        mode: 'retention', totalOps: 10, compactedOps: 4, replayOps: 6,
        currentLsn: 10, walFromLsn: 5, walToLsn: 10, replayFromLsn: 5,
      })
      expect(rb.minReplay).toBe(6) // totalOps − compactedOps
      expect(rb.costGap).toBe(0)
      expect(rb.replayCostConserved).toBe(true)
      expect(rb.walCovers).toBe(true)
      expect(rb.replayComplete).toBe(true)
      expect(rb.nontrivial).toBe(true)
      expect(rb.holds).toBe(true)
    })

    it('retention 完整性相对回放位点：截断老段不算不完整，从被截位点起放才丢', () => {
      const fromService = verifyReplayBoundary({
        mode: 'retention', totalOps: 10, compactedOps: 4, replayOps: 6,
        currentLsn: 10, walFromLsn: 5, walToLsn: 10, replayFromLsn: 5,
      })
      expect(fromService.replayComplete).toBe(true) // 从可服务起点 5 起放
      const fromTooEarly = verifyReplayBoundary({
        mode: 'retention', totalOps: 10, compactedOps: 4, replayOps: 10,
        currentLsn: 10, walFromLsn: 5, walToLsn: 10, replayFromLsn: 1,
      })
      expect(fromTooEarly.walCovers).toBe(false) // 位点 1 < 保留起点 5
      expect(fromTooEarly.replayComplete).toBe(false)
      expect(fromTooEarly.holds).toBe(false)
    })

    it('篡改 replayOps（抹重放成本）⇒ 成本守恒翻 false', () => {
      const bad = verifyReplayBoundary({
        mode: 'retention', totalOps: 20, compactedOps: 4, replayOps: 0,
        currentLsn: 20, walFromLsn: 5, walToLsn: 20, replayFromLsn: 1,
      })
      expect(bad.replayCostConserved).toBe(false)
      expect(bad.holds).toBe(false)
    })

    it('抹掉某段 WAL（快照后断档）⇒ 完整性翻 false', () => {
      const bad = verifyReplayBoundary({
        mode: 'snapshot', totalOps: 20, compactedOps: 0, replayOps: 5,
        currentLsn: 20, snapshotLsn: 15, hasSnapshot: true,
        walFromLsn: 18, walToLsn: 20, replayFromLsn: 1,
      })
      expect(bad.walCovers).toBe(false)
      expect(bad.replayComplete).toBe(false)
      expect(bad.holds).toBe(false)
    })

    it('早清 tombstone ⇒ key 完整性翻 false', () => {
      const bad = verifyReplayBoundary({
        mode: 'key', totalOps: 20, compactedOps: 12, replayOps: 8,
        currentLsn: 20, walFromLsn: 1, walToLsn: 20, replayFromLsn: 1,
        distinctKeys: 8, tombstoneCleared: true,
      })
      expect(bad.replayComplete).toBe(false)
      expect(bad.holds).toBe(false)
    })

    it('空集降级不凭 0=0 假绿', () => {
      const empty = verifyReplayBoundary({})
      expect(empty.nontrivial).toBe(false)
      expect(empty.holds).toBe(false)
    })
  })

  describe('③ 三策略 × 六场景矩阵 + 默认三难向量', () => {
    const s = logCompactionStudy({ now: () => 0 })

    it('3 行 × 6 cell 全真跑', () => {
      expect(s.rows).toHaveLength(3)
      for (const row of s.rows) expect(row.scenarios).toHaveLength(6)
      for (const row of s.rows) for (const c of row.scenarios) {
        expect(c.totalOps).toBe(24)
        expect(c.replayBoundary).toBeTruthy()
        expect(typeof c.compactFootprint).toBe('boolean')
        expect(typeof c.replayCompleteness).toBe('boolean')
        expect(typeof c.fastRecovery).toBe('boolean')
      }
    })

    it('默认向量 101/110/011、三者互异、无一 111', () => {
      expect(s.vectors).toEqual({ SizeTimeRetention: '101', KeyCompaction: '110', SnapshotPlusWal: '011' })
      expect(new Set(Object.values(s.vectors)).size).toBe(3)
      expect(Object.values(s.vectors).every((v) => v !== '111')).toBe(true)
      expect(s.verdict.noUniversalWinner).toBe(true)
      expect(s.verdict.trilemmaDistinguishes).toBe(true)
    })

    it('向量恒由 row.trilemma 现算，非硬覆盖', () => {
      for (const row of s.rows) expect(vecOf(row)).toBe(s.vectors[row.strategy])
    })

    it('SizeTimeRetention 软肋：慢消费者丢历史（replayCompleteness=false）', () => {
      const slow = cell(s, 'SizeTimeRetention', 'slowConsumer')
      expect(slow.missingOps).toBeGreaterThan(0)
      expect(slow.replayBoundary.replayComplete).toBe(false)
      expect(s.rows[0].trilemma.replayCompleteness).toBe(false)
      expect(s.verdict.retentionDropsSlowConsumer).toBe(true)
    })

    it('SizeTimeRetention 优势：空间省 + 恢复快', () => {
      expect(s.rows[0].trilemma.compactFootprint).toBe(true)
      expect(s.rows[0].trilemma.fastRecovery).toBe(true)
    })

    it('KeyCompaction 软肋：恢复要重放全部唯一键（fastRecovery=false）', () => {
      const steady = cell(s, 'KeyCompaction', 'steadyAppend')
      expect(steady.replayOps).toBeGreaterThan(LC_DEFAULTS.replayBudget)
      expect(s.rows[1].trilemma.fastRecovery).toBe(false)
      expect(s.verdict.keyCompactionPaysRecovery).toBe(true)
    })

    it('KeyCompaction 优势：空间省 + 回放完整；tombstone 复活单列不污染向量', () => {
      expect(s.rows[1].trilemma.compactFootprint).toBe(true)
      expect(s.rows[1].trilemma.replayCompleteness).toBe(true)
      const tomb = cell(s, 'KeyCompaction', 'tombstoneBurst')
      expect(tomb.tombstoneResurrect).toBeGreaterThan(0)
      expect(s.verdict.keyCompactionResurrectsUnderShortRetention).toBe(true)
      expect(tomb.replayCompleteness).toBe(true) // 短 retention 是配置补刀，不污染该 cell 完整性维
    })

    it('SnapshotPlusWal 软肋：双写放大不省空间（compactFootprint=false）', () => {
      const press = cell(s, 'SnapshotPlusWal', 'retentionPressure')
      expect(press.writeAmplification).toBeGreaterThan(1)
      expect(s.rows[2].trilemma.compactFootprint).toBe(false)
      expect(s.verdict.snapshotPaysWriteAmplification).toBe(true)
    })

    it('SnapshotPlusWal 优势：回放完整 + 恢复快 + exactly-once 真去重', () => {
      expect(s.rows[2].trilemma.replayCompleteness).toBe(true)
      expect(s.rows[2].trilemma.fastRecovery).toBe(true)
      const crash = cell(s, 'SnapshotPlusWal', 'crashMidReplay')
      expect(crash.dedupSkipped).toBeGreaterThan(0) // 真去重证据，非恒真
      expect(crash.exactlyOnce).toBe(true)
      expect(s.verdict.snapshotExactlyOnce).toBe(true)
    })

    it('判定正交空真：每维只在考场 cell 落真判定标记', () => {
      for (const row of s.rows) for (const c of row.scenarios) {
        expect(c.inFootprintExam).toBe(LC_SCENARIOS.indexOf(c.id) === 1 || LC_SCENARIOS.indexOf(c.id) === 5)
        expect(c.inCompletenessExam).toBe([2, 3, 4].includes(LC_SCENARIOS.indexOf(c.id)))
        expect(c.inRecoveryExam).toBe(LC_SCENARIOS.indexOf(c.id) === 0 || LC_SCENARIOS.indexOf(c.id) === 4)
      }
    })
  })

  describe('④ 可证伪守恒双路自证（study 级）', () => {
    const s = logCompactionStudy({ now: () => 0 })
    it('稳态 holds + nontrivial + 三路篡改各自翻 false', () => {
      expect(s.replayBoundary.holds).toBe(true)
      expect(s.replayBoundary.nontrivial).toBe(true)
      expect(s.replayBoundary.falsifiable).toBe(true)
      expect(s.replayBoundary.tamper.replayOps.holds).toBe(false)
      expect(s.replayBoundary.tamper.walGap.replayComplete).toBe(false)
      expect(s.replayBoundary.tamper.tombstone.replayComplete).toBe(false)
      expect(s.verdict.replayBoundaryFalsifiable).toBe(true)
    })

    it('空集降级：0 op 场景 vectors 仍结构完整不崩', () => {
      const empty = logCompactionSnapshot(null as any)
      expect(empty).toBeNull()
      expect(logCompactionSnapshot({} as any)).toBeNull()
    })
  })

  describe('⑤ rigged 三开关 + fastRecovery 因果锁死', () => {
    const r = logCompactionStudy({ rigged: true, now: () => 0 })
    it('rigged 三向量收敛 110/110/110、区分度与 noUniversalWinner 翻 false', () => {
      expect(r.vectors).toEqual({ SizeTimeRetention: '110', KeyCompaction: '110', SnapshotPlusWal: '110' })
      expect(r.verdict.noUniversalWinner).toBe(false)
      expect(r.verdict.trilemmaDistinguishes).toBe(false)
      expect(r.verdict.noStrategyWinsAll).toBe(true) // 全 110 无 111，不造假
    })

    it('fastRecovery 因果锁死：三策略恢复维全 false、判词立', () => {
      expect(r.rows.every((row: any) => row.trilemma.fastRecovery === false)).toBe(true)
      expect(r.rows.every((row: any) => row.trilemma.compactFootprint === true && row.trilemma.replayCompleteness === true)).toBe(true)
      expect(r.verdict.fastRecoveryCausallyUnerasable).toBe(true)
    })

    it('rigged 下 Snapshot 空快照 exactly-once 真失效（去重归零）', () => {
      const crash = cell(r, 'SnapshotPlusWal', 'crashMidReplay')
      expect(crash.snapshotEmpty).toBe(true)
      expect(crash.dedupSkipped).toBe(0)
      expect(crash.exactlyOnce).toBe(false)
      expect(r.verdict.snapshotExactlyOnce).toBe(false)
    })

    it('单开 unlimitedRetention：补 Retention 回放完整必反噬快恢复', () => {
      const u = logCompactionStudy({ unlimitedRetention: true, now: () => 0 })
      expect(u.rows[0].trilemma.replayCompleteness).toBe(true)
      expect(u.rows[0].trilemma.fastRecovery).toBe(false)
      expect(u.verdict.unlimitedRetentionBackfiresRecovery).toBe(true)
    })

    it('单开 instantSnapshot：补 Snapshot 省空间必反噬快恢复', () => {
      const i = logCompactionStudy({ instantSnapshot: true, now: () => 0 })
      expect(i.rows[2].trilemma.compactFootprint).toBe(true)
      expect(i.rows[2].trilemma.fastRecovery).toBe(false)
      expect(i.verdict.instantSnapshotBackfiresRecovery).toBe(true)
    })

    it('单开 zeroReplayCost 是许愿：守恒用真 replayOps，向量一字不改', () => {
      const z = logCompactionStudy({ zeroReplayCost: true, now: () => 0 })
      expect(z.vectors).toEqual({ SizeTimeRetention: '101', KeyCompaction: '110', SnapshotPlusWal: '011' })
      expect(z.verdict.zeroReplayCostErasesNothing).toBe(true)
    })
  })

  describe('⑥ 十一真件交叉印证 + 接线契约', () => {
    const s = logCompactionStudy({ now: () => 0 })

    it('evidence 21 键全真回读（真 API 真调用真回读，计数不硬编码）', () => {
      const e = s.crosscheck.evidence
      expect(Object.keys(e).sort()).toEqual([
        'bloomHit', 'bloomMiss', 'bucketAllowed', 'bucketRejected', 'busListeners', 'counterFalseSharing',
        'counterSum', 'heapFired', 'jitterSpread', 'notices', 'poolCreated', 'poolReused', 'ringFirst',
        'ringShardsUsed', 'shardHits', 'walLastSeq', 'walLines', 'walReplayed', 'zqFired',
        'zqLostOnRestart', 'zqPendingAfterRestore',
      ])
      expect(e.walLastSeq).toBe(6)
      expect(e.walLines).toBe(6)
      expect(e.walReplayed).toBe(6)
      expect(e.bloomHit).toBe(true)
      expect(e.bloomMiss).toBe(false)
      expect(e.bucketAllowed + e.bucketRejected).toBe(6)
      expect(e.counterSum).toBe(36) // Σ(i+1), i=0..7
      expect(e.notices).toBe(2)
      expect(e.busListeners).toBe(1)
      expect(e.ringShardsUsed).toBeGreaterThan(0)
      expect(e.jitterSpread).toBeGreaterThan(0)
    })

    it('builtAt 对注入时钟函数求值（KI-517 契约）', () => {
      const a = logCompactionStudy({ now: () => 7777000 })
      expect(a.builtAt).toBe(7777000)
      const b = logCompactionStudy({ now: () => 0 })
      expect(b.builtAt).toBe(0)
    })

    it('compareLogCompaction 是同构别名，指向同一实现', () => {
      expect(compareLogCompaction).toBe(logCompactionStudy)
    })

    it('runLogCompactionScenario：单场景入口 + 非法入参降级 null', () => {
      const one = runLogCompactionScenario('KeyCompaction', 'steadyAppend', { now: () => 0 })
      expect(one?.strategy).toBe('KeyCompaction')
      expect(one?.id).toBe('steadyAppend')
      expect(runLogCompactionScenario('Bogus', 'steadyAppend')).toBeNull()
      expect(runLogCompactionScenario('KeyCompaction', 'bogus')).toBeNull()
    })

    it('logCompactionSnapshot：保留 study 结构、裁剪 verdict', () => {
      const snap = logCompactionSnapshot(logCompactionStudy({ now: () => 0 }))
      expect(snap?.rows).toHaveLength(3)
      expect(snap?.vectors).toEqual({ SizeTimeRetention: '101', KeyCompaction: '110', SnapshotPlusWal: '011' })
      expect(snap?.replayBoundary.holds).toBe(true)
      expect(snap?.crosscheck.evidence.walReplayed).toBe(6)
    })

    it('createLogCompactionEvidence 独立可调、确定性', () => {
      const a = createLogCompactionEvidence({ seed: 526 })
      const b = createLogCompactionEvidence({ seed: 526 })
      expect(a).toEqual(b)
      expect(a.walReplayed).toBe(6)
    })
  })

  describe('⑦ CLI 双跑字节一致 + rigged 可证伪', () => {
    it('默认 CLI 双跑字节一致', () => {
      expect(cli()).toBe(cli())
    })

    it('rigged CLI 双跑字节一致 + 判词真立', () => {
      const r1 = cli(['--rigged'])
      expect(r1).toBe(cli(['--rigged']))
      expect(r1).toContain('RIGGED_FALSIFIABLE_OK=true')
      expect(r1).toContain('"SizeTimeRetention":"110"')
      expect(r1).toContain('"SnapshotPlusWal":"110"')
    })

    it('CLI 默认打印真向量与 VECTOR_FROM_TRILEMMA_OK', () => {
      const out = cli()
      expect(out).toContain('"SizeTimeRetention":"101"')
      expect(out).toContain('"KeyCompaction":"110"')
      expect(out).toContain('"SnapshotPlusWal":"011"')
      expect(out).toContain('noUniversalWinner=true')
      expect(out).toContain('VECTOR_FROM_TRILEMMA_OK=true')
      expect(out).toContain('falsifiable=true')
    })
  })
})
