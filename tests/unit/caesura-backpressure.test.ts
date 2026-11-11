import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BP_DEFAULTS,
  BP_SCENARIOS,
  BP_STRATEGIES,
  backpressureSnapshot,
  backpressureStudy,
  compareBackpressure,
  createBackpressureAdmission,
  createBackpressureEvidence,
  createBufferingQueue,
  createScalingPool,
  createSheddingValve,
  verifyLittleLaw,
} from '../../scripts/caesura-backpressure.mjs'

/**
 * KI-525 消费者组积压背压 / 流量削峰：Backpressure / Buffering / Shedding / Scaling 四策略诚实权衡。
 * 全进程内确定性教学状态机，headless 可证；不接真 Kafka broker / 真 HPA 控制器。
 * 断言读数全部来自 CLI / study 实测，非拍脑袋硬编码。
 */

const SCRIPT = join(process.cwd(), 'scripts', 'caesura-backpressure.mjs')
const cli = (args: string[] = []) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
const cell = (s: any, strategy: string, id: string) =>
  s.rows.find((r: any) => r.strategy === strategy).scenarios.find((c: any) => c.id === id)
const vecOf = (r: any) => `${Number(r.trilemma.noLoss)}${Number(r.trilemma.lowLatency)}${Number(r.trilemma.highThroughput)}`

describe('KI-525 积压背压 / 流量削峰：四策略 × 六场景 × 三难', () => {
  describe('① 默认导出 + 四真策略', () => {
    it('BP_DEFAULTS / BP_STRATEGIES / BP_SCENARIOS 顺序钉死', () => {
      expect(BP_DEFAULTS.seed).toBe(525)
      expect(BP_DEFAULTS.acceptBudget).toBe(0.9)
      expect(BP_DEFAULTS.latencyBudget).toBe(3)
      expect(BP_DEFAULTS.shedThreshold).toBe(3)
      expect(BP_DEFAULTS.detectTicks).toBe(2)
      expect(BP_DEFAULTS.stallTicks).toBe(8)
      expect(BP_STRATEGIES).toEqual(['Backpressure', 'Buffering', 'Shedding', 'Scaling'])
      expect(BP_SCENARIOS).toEqual([
        'steadyTrickle', 'burstAbsorb', 'sustainedOverload', 'latencySpike', 'downstreamStall', 'memoryPressure',
      ])
    })

    it('createBackpressureAdmission: 令牌桶准入钳到 μ、超出反压退回（rejected 非 dropped）', () => {
      const p = createBackpressureAdmission()
      const acc: any = {}
      const d = p.decide({ t: 0, arrivals: 10, mu: 2, queue: [], cap: 1000, acc, flags: {} as any, strategy: 'Backpressure' })
      expect(d.muOverride).toBeNull()
      expect(d.dropped).toBe(0) // 绝不主动丢
      expect(d.admitted + d.rejected).toBe(10)
      expect(d.admitted).toBeLessThanOrEqual(2) // 准入钳到 ≈μ
      expect(d.rejected).toBeGreaterThanOrEqual(8) // 突发被反压退回
    })

    it('createBufferingQueue: 全量接纳排队、容量满才真丢（非银弹）', () => {
      const p = createBufferingQueue()
      const base = { t: 0, arrivals: 5, mu: 2, cap: 1000, acc: {}, flags: { unlimitedBuffer: false } as any, strategy: 'Buffering' }
      const ok = p.decide({ ...base, queue: [] } as any)
      expect(ok.admitted).toBe(5)
      expect(ok.rejected).toBe(0)
      expect(ok.dropped).toBe(0)
      const full = p.decide({ ...base, arrivals: 5, queue: [{ enqueue: 0 }, { enqueue: 0 }], cap: 3 } as any)
      expect(full.dropped).toBe(4) // 容量 3 已有 2，只能再收 1，丢 4
      expect(full.admitted).toBe(1)
      const inf = p.decide({ ...base, arrivals: 5, queue: [{ enqueue: 0 }], cap: 3, flags: { unlimitedBuffer: true } as any } as any)
      expect(inf.dropped).toBe(0) // unlimitedBuffer 抹掉溢出丢弃
      expect(inf.admitted).toBe(5)
    })

    it('createSheddingValve: 队列钳小阈值、超出主动丢弃（dropped 非 rejected）', () => {
      const p = createSheddingValve({ threshold: 3 })
      const ctx = { t: 0, arrivals: 8, mu: 2, cap: 1000, acc: {}, flags: { zeroLoss: false } as any, strategy: 'Shedding' }
      const shed = p.decide({ ...ctx, queue: [{ enqueue: 0 }, { enqueue: 0 }] } as any)
      expect(shed.rejected).toBe(0) // 上游不反压
      expect(shed.admitted).toBe(1) // room = 3-2
      expect(shed.dropped).toBe(7) // 主动丢弃
      const noloss = p.decide({ ...ctx, flags: { zeroLoss: true } as any, queue: [] } as any)
      expect(noloss.dropped).toBe(0) // zeroLoss 强制不丢
      expect(noloss.admitted).toBe(8) // 全收 ⇒ 积压 ⇒ 反噬低时延
    })

    it('createScalingPool: 持续过载触发扩容，先付 rebalance 空窗（停服 + 拒收）', () => {
      const p = createScalingPool({ detectTicks: 2, stallTicks: 8, scaleFactor: 2 })
      const acc: any = {}
      const mk = (t: number, arrivals: number) => ({ t, arrivals, mu: 2, queue: [] as any[], cap: 1000, acc, flags: {} as any, strategy: 'Scaling' })
      const s0 = p.decide(mk(0, 6)); expect(s0.rejected).toBe(0) // 第 1 拍过载，仅累计
      const s1 = p.decide(mk(1, 6)); expect(s1.rejected).toBe(6); expect(s1.muOverride).toBe(0) // 第 2 拍触发空窗，全拒收+停服
      expect(acc.scaling.rebalances).toBe(1)
      for (let t = 2; t < 10; t++) p.decide(mk(t, 6)) // 空窗 8 拍
      const s2 = p.decide(mk(10, 6)); expect(s2.muOverride).toBeNull(); expect(s2.scale).toBe(2) // 空窗后扩容生效
    })
  })

  describe('② 六场景 × 四策略矩阵 + 正交三难向量', () => {
    const s = backpressureStudy({ now: () => 9393 })

    it('矩阵完整：4 行 × 6 场景，每 cell 带 arrived/accepted/rejected/dropped/avgWait + 三布尔', () => {
      expect(s.rows).toHaveLength(4)
      for (const row of s.rows) {
        expect(row.scenarios).toHaveLength(6)
        for (const c of row.scenarios) {
          expect(BP_SCENARIOS).toContain(c.id)
          for (const k of ['arrivals', 'accepted', 'admitted', 'rejected', 'dropped', 'served', 'avgWait', 'acceptedRate']) {
            expect(typeof (c as any)[k]).toBe('number')
          }
          for (const k of ['noLoss', 'lowLatency', 'highThroughput']) expect(typeof (c as any)[k]).toBe('boolean')
        }
      }
    })

    it('默认四向量 110 / 101 / 011 / 100、四向量互异、无一 111', () => {
      expect(s.vectors).toEqual({ Backpressure: '110', Buffering: '101', Shedding: '011', Scaling: '100' })
      expect(s.verdict.trilemmaDistinguishes).toBe(true)
      expect(s.verdict.noUniversalWinner).toBe(true)
      expect(s.verdict.noStrategyWinsAll).toBe(true)
      expect(Object.values(s.vectors).some((v) => v === '111')).toBe(false)
    })

    it('向量恒由 row.trilemma 现算（表格与判词同源，非硬覆盖）', () => {
      for (const row of s.rows) expect(vecOf(row)).toBe(s.vectors[row.strategy])
    })

    it('Backpressure：突发被反压（rejected>0）⇒ highThroughput=false；零丢+低时延两维占', () => {
      expect(cell(s, 'Backpressure', 'burstAbsorb').rejected).toBeGreaterThan(0)
      expect(s.rows[0].trilemma).toEqual({ noLoss: true, lowLatency: true, highThroughput: false })
    })

    it('Buffering：过载积压（峰队长超预算）⇒ lowLatency=false，但零丢+高吞吐占', () => {
      expect(cell(s, 'Buffering', 'sustainedOverload').peakQueue).toBeGreaterThan(BP_DEFAULTS.latencyBudget * BP_DEFAULTS.mu)
      expect(cell(s, 'Buffering', 'latencySpike').avgWait).toBeGreaterThan(BP_DEFAULTS.latencyBudget)
      expect(s.rows[1].trilemma).toEqual({ noLoss: true, lowLatency: false, highThroughput: true })
    })

    it('Shedding：过载主动丢弃（dropped>0）⇒ noLoss=false，但低时延+高吞吐占（非银弹）', () => {
      expect(cell(s, 'Shedding', 'sustainedOverload').dropped).toBeGreaterThan(0)
      expect(cell(s, 'Shedding', 'downstreamStall').dropped).toBeGreaterThan(0)
      expect(s.rows[2].trilemma).toEqual({ noLoss: false, lowLatency: true, highThroughput: true })
      expect(s.verdict.sheddingNotFreeLunch).toBe(true)
    })

    it('Scaling：rebalance 空窗吞吐受损 + 下游停摆滞留 ⇒ 只占零丢失（100）', () => {
      expect(cell(s, 'Scaling', 'burstAbsorb').rejected).toBeGreaterThan(0)
      expect(cell(s, 'Scaling', 'downstreamStall').avgWait).toBeGreaterThan(BP_DEFAULTS.latencyBudget)
      expect(s.rows[3].trilemma).toEqual({ noLoss: true, lowLatency: false, highThroughput: false })
      expect(s.verdict.scalingStallsOnRebalance).toBe(true)
    })

    it('正交：memoryPressure 下 Buffering 缓冲打满真丢，但不污染其 noLoss 向量（该场景归 highThroughput 考场）', () => {
      expect(cell(s, 'Buffering', 'memoryPressure').dropped).toBeGreaterThan(0)
      expect(s.verdict.bufferingDropsUnderMemoryPressure).toBe(true)
      expect(s.rows[1].trilemma.noLoss).toBe(true)
    })

    it('正交：非考场场景该维空真（如 steadyTrickle 的 noLoss/highThroughput 恒 true）', () => {
      for (const row of s.rows) {
        const st = cell(s, row.strategy, 'steadyTrickle')
        expect(st.noLoss).toBe(true)
        expect(st.highThroughput).toBe(true)
      }
    })
  })

  describe("③ Little's Law 双路自证（可证伪）", () => {
    it('verifyLittleLaw: 稳态真撞合 L≈λW、holds=true', () => {
      const r = verifyLittleLaw({ queueLenSum: 96, waitSum: 96, served: 108, endQueue: 0, steps: 48 })
      expect(r.L).toBe(2)
      expect(r.Lpred).toBe(2)
      expect(r.gap).toBe(0)
      expect(r.holds).toBe(true)
      expect(r.steadyStateReached).toBe(true)
    })

    it('verifyLittleLaw 可证伪：篡改 waitSum 让两路分叉、holds 翻 false', () => {
      const tampered = verifyLittleLaw({ queueLenSum: 96, waitSum: 999, served: 108, endQueue: 0, steps: 48 })
      expect(tampered.holds).toBe(false)
      expect(tampered.gap).toBeGreaterThan(tampered.L) // 逐拍积分 L=2 vs 逐消息 λW=20.8 ⇒ 两路分叉
      expect(tampered.Lpred).toBeGreaterThan(tampered.L * 5)
    })

    it('verifyLittleLaw 过载：endQueue>0 稳态前提破裂、holds=false（不硬凑）', () => {
      const overload = verifyLittleLaw({ queueLenSum: 4704, waitSum: 4704, served: 96, endQueue: 192, steps: 48 })
      expect(overload.steadyStateReached).toBe(false)
      expect(overload.holds).toBe(false)
    })

    it('稳态场景非零撞合（nontrivial）且全体成立；持续过载如实破裂', () => {
      expect(sLittle().verdict.littleLawHolds).toBe(true)
      expect(sLittle().verdict.littleLawNontrivial).toBe(true)
      expect(sLittle().verdict.overloadBreaksLittleLaw).toBe(true)
      const nt = sLittle().littleLaw.steady.filter((x: any) => x.nontrivial === true && x.holds === true)
      expect(nt.length).toBeGreaterThan(0)
      expect(nt.every((x: any) => x.L > 0 && x.W > 0 && x.gap <= Math.max(0.5, 0.12 * Math.max(x.L, x.Lpred)))).toBe(true)
    })
  })

  describe('④ rigged 因果锁死 + 三开关单开反噬', () => {
    it('rigged 三开关齐开 ⇒ 真实现算 110/110/110/110、判词翻 false、绝不硬造 111', () => {
      const r = backpressureStudy({ rigged: true, now: () => 0 })
      expect(r.rigged).toBe(true)
      expect(r.config.zeroLoss).toBe(true)
      expect(r.config.boundedLatency).toBe(true)
      expect(r.config.unlimitedBuffer).toBe(true)
      expect(r.vectors).toEqual({ Backpressure: '110', Buffering: '110', Shedding: '110', Scaling: '110' })
      expect(r.verdict.trilemmaDistinguishes).toBe(false)
      expect(r.verdict.noUniversalWinner).toBe(false)
      expect(r.verdict.highThroughputCausallyUnerasable).toBe(true)
      expect(Object.values(r.vectors).some((v) => v === '111')).toBe(false)
    })

    it('rigged 机制：boundedLatency 锁短队列 + zeroLoss 禁丢 ⇒ 全策略在突发被反压（rejected>0、dropped=0）', () => {
      const r = backpressureStudy({ rigged: true })
      for (const row of r.rows) {
        const b = cell(r, row.strategy, 'burstAbsorb')
        expect(b.rejected).toBeGreaterThan(0)
        expect(b.dropped).toBe(0)
        expect(row.trilemma.highThroughput).toBe(false)
        expect(row.trilemma.noLoss).toBe(true)
        expect(row.trilemma.lowLatency).toBe(true)
      }
    })

    it('单开 zeroLoss：补 Shedding 零丢失必令其积压、反噬低时延', () => {
      const r = backpressureStudy({ zeroLoss: true })
      expect(r.rows[2].trilemma.noLoss).toBe(true) // 丢被抹掉
      expect(r.rows[2].trilemma.lowLatency).toBe(false) // 积压反噬
      expect(r.verdict.zeroLossBackfiresLatency).toBe(true)
    })

    it('单开 boundedLatency：补低时延必逼出丢弃、反噬零丢失', () => {
      const r = backpressureStudy({ boundedLatency: true })
      expect(r.rows[1].trilemma.lowLatency).toBe(true)
      expect(r.rows[1].trilemma.noLoss).toBe(false) // 队列钳短超出必丢
      expect(r.verdict.boundedLatencyBackfiresNoLoss).toBe(true)
    })

    it('单开 unlimitedBuffer：只抹 memoryPressure 下 Buffering 溢出丢弃，不动任何向量', () => {
      const r = backpressureStudy({ unlimitedBuffer: true })
      expect(cell(r, 'Buffering', 'memoryPressure').dropped).toBe(0)
      expect(r.vectors).toEqual({ Backpressure: '110', Buffering: '101', Shedding: '011', Scaling: '100' })
      expect(r.verdict.unlimitedBufferErasesOomOnly).toBe(true)
    })
  })

  describe('⑤ 十一条真件交叉印证（反假证据）', () => {
    it('createBackpressureEvidence: 十一枚真件全部真读数（计数非硬编码）', () => {
      const e = createBackpressureEvidence({ seed: 525 })
      // ① 令牌桶 ② 漏桶
      expect(e.bucketAllowed + e.bucketRejected).toBe(5)
      expect(e.bucketAllowed).toBeGreaterThan(0)
      expect(e.leakyAllowed + e.leakyRejected).toBe(5)
      // ③ RedisZset ④ 最小堆
      expect(e.zqFired).toBeGreaterThan(0)
      expect(e.zqLostOnRestart).toBe(0) // durable 后端重启不丢
      expect(e.heapFired).toBe(9)
      // ⑤ WAL
      expect(e.walLines).toBe(4)
      expect(e.walReplayed).toBe(4)
      // ⑥ 分片缓存 ⑦ 布隆
      expect(e.shardHits).toBe(8)
      expect(e.bloomHit).toBe(true)
      expect(e.bloomMiss).toBe(false) // 从没 add 过 ⇒ 一定不在（真阴性）
      // ⑧ 全抖动 ⑨ 紧凑计数 ⑩ 对象池 ⑪ 总线
      expect(e.jitterSpread).toBeGreaterThan(1) // 全抖动真撒开
      expect(e.counterSum).toBe(36) // Σ(i+1), i=0..7 = 1+2+…+8
      expect(e.counterFalseSharing).toBeGreaterThan(0) // packed 布局相邻槽共享缓存行
      expect(e.poolReused).toBeGreaterThan(0)
      expect(e.watermarkNotices).toBe(2)
      expect(e.busListeners).toBe(1)
    })

    it('evidence 反假证据：换 seed 抖动撒开读数仍自洽、计数恒不越界', () => {
      const a = createBackpressureEvidence({ seed: 1 })
      const b = createBackpressureEvidence({ seed: 9999 })
      for (const e of [a, b]) {
        expect(e.bucketAllowed).toBeLessThanOrEqual(5)
        expect(e.zqFired).toBe(6)
        expect(e.shardHits).toBe(8)
        expect(e.poolCreated + e.poolReused).toBeGreaterThanOrEqual(3)
      }
    })

    it('study.crosscheck.evidence 真挂十一件（前端/CLI 可回读，非硬编码）', () => {
      const s = backpressureStudy()
      const e = s.crosscheck.evidence
      expect(e.heapFired).toBe(9)
      expect(e.walReplayed).toBe(4)
      expect(e.watermarkNotices).toBe(2)
    })
  })

  describe('⑥ 快照 / builtAt 注入 / CLI 双跑 / 空集降级', () => {
    it('builtAt 随注入函数求值（六时钟同源契约）', () => {
      const s = backpressureStudy({ now: () => 777 })
      expect(s.builtAt).toBe(777)
      expect(backpressureSnapshot(s)!.builtAt).toBe(777)
    })

    it('backpressureSnapshot：无 study 落 null；结构裁剪保留 rows/verdict/littleLaw/crosscheck', () => {
      expect(backpressureSnapshot(null as any)).toBeNull()
      expect(backpressureSnapshot({} as any)).toBeNull()
      const snap = backpressureSnapshot(backpressureStudy({ now: () => 1 }))!
      expect(snap.rows).toHaveLength(4)
      expect(snap.vectors).toEqual({ Backpressure: '110', Buffering: '101', Shedding: '011', Scaling: '100' })
      expect(snap.littleLaw.steadyHolds).toBe(true)
      expect(snap.verdict.noUniversalWinner).toBe(true)
      expect(snap.crosscheck.evidence.heapFired).toBe(9)
      expect(snap.topology.Backpressure).toContain('反压')
    })

    it('compareBackpressure 是 backpressureStudy 的同构别名', () => {
      expect(compareBackpressure).toBe(backpressureStudy)
      expect(compareBackpressure({ rigged: true }).vectors).toEqual(backpressureStudy({ rigged: true }).vectors)
    })

    it('CLI 默认双跑字节一致', () => {
      expect(cli()).toBe(cli())
    })

    it("CLI 自证：向量来自 trilemma、不封赢家、Little's Law 稳态成立过载破裂", () => {
      const out = cli()
      expect(out).toContain('vectors: {"Backpressure":"110","Buffering":"101","Shedding":"011","Scaling":"100"}')
      expect(out).toContain('noUniversalWinner=true distinguishable=true')
      expect(out).toContain('VECTOR_FROM_TRILEMMA_OK=true')
      expect(out).toContain('littleLaw steadyHolds=true steadyNontrivial=true overloadBreaks=true')
    })

    it('CLI --rigged 自证可证伪（非硬造 111）', () => {
      const out = cli(['--rigged'])
      expect(out).toContain('vectors: {"Backpressure":"110","Buffering":"110","Shedding":"110","Scaling":"110"}')
      expect(out).toContain('noUniversalWinner=false distinguishable=false rigged=true')
      expect(out).toContain('RIGGED_FALSIFIABLE_OK=true')
    })

    it('空 scenarios 降级：rows 保留但无 cell、不崩', () => {
      const s = backpressureStudy({ scenarios: [], now: () => 0 })
      expect(s.rows).toHaveLength(4)
      for (const row of s.rows) expect(row.scenarios).toHaveLength(0)
    })

    it('未知 scenario 被过滤、不污染向量', () => {
      const s = backpressureStudy({ scenarios: ['steadyTrickle', 'noSuchScene'] as any })
      for (const row of s.rows) expect(row.scenarios.every((c: any) => c.id !== 'noSuchScene')).toBe(true)
    })
  })
})

function sLittle() { return backpressureStudy({ now: () => 1 }) }
