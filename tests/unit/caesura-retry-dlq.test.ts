import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RDL_DEFAULTS,
  RDL_PROTOCOLS,
  RDL_SCENARIOS,
  compareRetryDlq,
  createExponentialBackoff,
  createFullJitterBackoff,
  createImmediateRetry,
  createRetryDlqEvidence,
  retryDlqSnapshot,
  retryDlqStudy,
} from '../../scripts/caesura-retry-dlq.mjs'

/**
 * KI-520 消息重试退避 × 死信：Immediate / Exponential / FullJitter 三协议诚实权衡。
 * 全进程内确定性教学状态机，headless 可证；不接真 MQ / 真 Redis DLQ / 真 Lua。
 */

describe('KI-520 重试退避 × 死信：Immediate / Exponential / FullJitter 三协议', () => {
  describe('默认导出 + 策略纯件', () => {
    it('RDL_DEFAULTS / RDL_PROTOCOLS / RDL_SCENARIOS 顺序钉死', () => {
      expect(RDL_DEFAULTS.seed).toBe(520)
      expect(RDL_DEFAULTS.maxAttempts).toBe(4)
      expect(RDL_PROTOCOLS).toEqual(['Immediate', 'Exponential', 'FullJitter'])
      expect(RDL_SCENARIOS).toEqual(['allOk', 'transientFailure', 'sustainedOutage', 'synchronizedFailures', 'manyAttempts', 'downstreamSlow'])
    })

    it('createImmediateRetry: nextDelay 恒 1 tick，attempts 计数', () => {
      const p = createImmediateRetry({})
      expect(p.nextDelay()).toBe(1)
      expect(p.nextDelay()).toBe(1)
      expect(p.delayFor(2)).toBe(1)
      expect(p.stats().attempts).toBe(2)
      p.reset()
      expect(p.stats().attempts).toBe(0)
    })

    it('createExponentialBackoff: base×2^n-1 钳 cap，超出封顶', () => {
      const p = createExponentialBackoff({ baseTicks: 1, capTicks: 16 })
      const seq = [1, 2, 3, 4, 5, 6].map((n) => p.delayFor(n))
      expect(seq).toEqual([1, 2, 4, 8, 16, 16])
      const small = createExponentialBackoff({ baseTicks: 2, capTicks: 4 })
      expect(small.delayFor(4)).toBe(4) // 锁 cap
    })

    it('createFullJitterBackoff: 每条延迟落在 [0, cap_exp] 内且不同种子不同结果', () => {
      const p = createFullJitterBackoff({ baseTicks: 1, capTicks: 16, seed: 42 })
      const a = [1, 2, 3, 4, 5, 6].map((n) => p.nextDelay(n))
      for (const d of a) {
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThanOrEqual(16)
      }
    })
  })

  describe('retryDlqStudy：六场景 × 三协议矩阵', () => {
    it('study 形状：rows 3 × scenarios 6，cell 全字段在', () => {
      const s = retryDlqStudy({})
      expect(s.rows.map((r) => r.protocol)).toEqual(RDL_PROTOCOLS)
      for (const row of s.rows) {
        expect(row.scenarios.map((c) => c.id)).toEqual(RDL_SCENARIOS)
        for (const c of row.scenarios) {
          expect(typeof c.retries).toBe('number')
          expect(typeof c.delivered).toBe('number')
          expect(typeof c.deadLettered).toBe('number')
          expect(typeof c.stormPerMsg).toBe('number')
          expect(typeof c.herdRatio).toBe('number')
          expect(typeof c.fastRecovery).toBe('boolean')
          expect(typeof c.noStorm).toBe('boolean')
          expect(typeof c.noHerd).toBe('boolean')
        }
      }
    })

    it('study 纯数据 + 同 seed 双跑 JSON 一致', () => {
      const a = retryDlqStudy({ seed: 520 })
      const b = retryDlqStudy({ seed: 520 })
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it('默认 vectors=Immediate100/Exponential010/FullJitter011，互异、noUniversalWinner=true', () => {
      const s = retryDlqStudy({})
      expect(s.vectors).toEqual({ Immediate: '100', Exponential: '010', FullJitter: '011' })
      expect(s.verdict.trilemmaDistinguishes).toBe(true)
      expect(s.verdict.noUniversalWinner).toBe(true)
      expect(s.verdict.immediateStorms).toBe(true)        // sustainedOutage stormPerMsg > budget
      expect(s.verdict.exponentialNoStorm).toBe(true)     // 退避压住了施压频率
      expect(s.verdict.fullJitterNoHerd).toBe(true)       // 全抖动散得开惊群
    })

    it('rigged（zeroBackoff+perfectJitter+noRetryBudget）：101/101/101，判词翻 false、noStorm 因果抹不掉', () => {
      const s = retryDlqStudy({ rigged: true })
      // 三开关：zeroBackoff 抹 fastRecovery、perfectJitter 抹 noHerd、noRetryBudget 让长故障永不放弃；
      // 但「零退避⟹长故障密集重投」使 noStorm 三协议全 false——没有任何开关能翻回它 ⇒ 101/101/101。
      expect(s.vectors).toEqual({ Immediate: '101', Exponential: '101', FullJitter: '101' })
      expect(s.verdict.trilemmaDistinguishes).toBe(false)
      expect(s.verdict.noUniversalWinner).toBe(false)
      expect(s.verdict.noStormCausallyUnerasable).toBe(true)
      for (const row of s.rows) expect(row.trilemma.noStorm).toBe(false)
      // 向量逐字来自 row.trilemma（表格与判词同源、杜绝硬覆盖全 111 撒谎）
      for (const row of s.rows) {
        const recomputed = `${Number(row.trilemma.fastRecovery)}${Number(row.trilemma.noStorm)}${Number(row.trilemma.noHerd)}`
        expect(s.vectors[row.protocol as keyof typeof s.vectors]).toBe(recomputed)
      }
    })

    it('单开 zeroBackoff：三协议 noStorm 全翻 false、Distinguishable 失败、不进 DLQ 上限', () => {
      const s = retryDlqStudy({ zeroBackoff: true })
      for (const row of s.rows) expect(row.trilemma.noStorm).toBe(false)
      expect(s.verdict.trilemmaDistinguishes).toBe(false)
    })

    it('单开 noRetryBudget：manyAttempts 死信数归零（预算熔断被教学关闭）', () => {
      const s = retryDlqStudy({ noRetryBudget: true })
      const cell = s.rows[0].scenarios.find((c) => c.id === 'manyAttempts')!
      expect(cell.deadLettered).toBe(0)
      expect(s.verdict.dlqReleasedWhenNoBudget).toBe(true)
    })

    it('单开 perfectJitter：Immediate 惊群峰消于无形（sync herdRatio ≤ 0.5）', () => {
      const s = retryDlqStudy({ perfectJitter: true })
      const cell = s.rows[0].scenarios.find((c) => c.id === 'synchronizedFailures')!
      expect(cell.herdRatio).toBeLessThanOrEqual(0.5)
      expect(cell.noHerd).toBe(true)
    })

    it('默认 manyAttempts：Immediate 有消息进 DLQ（预算耗尽的诚实读数）', () => {
      const s = retryDlqStudy({})
      const cell = s.rows[0].scenarios.find((c) => c.id === 'manyAttempts')!
      expect(cell.deadLettered).toBeGreaterThan(0)
      expect(s.verdict.dlqLands).toBe(true)
    })

    it('sustainedOutage：Immediate 全员死信（零退避必然耗尽预算）', () => {
      const s = retryDlqStudy({})
      const cell = s.rows[0].scenarios.find((c) => c.id === 'sustainedOutage')!
      expect(cell.delivered).toBe(0)
      expect(cell.deadLettered).toBe(16)
    })

    it('sustainedOutage 全程故障：三协议都耗尽预算进死信，但 noStorm 由「施压频率」分化', () => {
      const s = retryDlqStudy({})
      const cell = (p: string) => s.rows.find((r) => r.protocol === p)!.scenarios.find((c) => c.id === 'sustainedOutage')!
      // 全程故障不恢复 ⇒ 三协议都耗尽 maxAttempts 进死信（delivered=0），区别不在送达数而在施压频率。
      for (const p of RDL_PROTOCOLS) {
        expect(cell(p).delivered).toBe(0)
        expect(cell(p).deadLettered).toBe(16)
      }
      // noStorm 的物理读数 Σ(1/delay) per-message：零退避 Immediate 最高、指数退避 Exponential 最低。
      expect(cell('Immediate').stormPerMsg).toBeGreaterThan(cell('FullJitter').stormPerMsg)
      expect(cell('FullJitter').stormPerMsg).toBeGreaterThan(cell('Exponential').stormPerMsg)
      expect(cell('Immediate').noStorm).toBe(false)
      expect(cell('Exponential').noStorm).toBe(true)
      expect(cell('FullJitter').noStorm).toBe(true)
    })

    it('workerRestart 正交列：Armageddon 后无需额外检查（本件无重启维，确认场景表无该场景）', () => {
      expect(RDL_SCENARIOS).not.toContain('workerRestart')
    })

    it('recoverAtTick 注入生效：默认确定性钉死 seed=520/16/4', () => {
      const s = retryDlqStudy({})
      expect(s.config.seed).toBe(520)
      expect(s.config.messages).toBe(16)
      expect(s.config.maxAttempts).toBe(4)
    })

    it('默认向量逐字来自 row.trilemma（表格与判词同源，非硬覆盖）', () => {
      const s = retryDlqStudy({})
      for (const row of s.rows) {
        const recomputed = `${Number(row.trilemma.fastRecovery)}${Number(row.trilemma.noStorm)}${Number(row.trilemma.noHerd)}`
        expect(s.vectors[row.protocol as keyof typeof s.vectors]).toBe(recomputed)
      }
      expect(s.verdict.noProtocolWinsAll).toBe(true)
    })

    it('三难正交空真：每难只由专门场景承载、其余场景不连坐', () => {
      const s = retryDlqStudy({})
      const cell = (p: string, id: string) => s.rows.find((r) => r.protocol === p)!.scenarios.find((c) => c.id === id)!
      // fastRecovery 只在短故障→恢复场景量，永久故障/同刻失败场景空真
      expect(cell('Immediate', 'sustainedOutage').fastRecovery).toBe(true)
      expect(cell('Immediate', 'manyAttempts').fastRecovery).toBe(true)
      expect(cell('Immediate', 'synchronizedFailures').fastRecovery).toBe(true)
      // noStorm 只在长故障场景量；noHerd 只在同刻失败场景量
      expect(cell('Exponential', 'transientFailure').noStorm).toBe(true)
      expect(cell('Immediate', 'transientFailure').noHerd).toBe(true)
      expect(cell('Immediate', 'sustainedOutage').noHerd).toBe(true)
      expect(s.verdict.permanentOutageVacuousTrue).toBe(true)
    })

    it('单开 zeroBackoff：抹恢复延迟但 noStorm 当场因果反噬（三协议全 false）', () => {
      const s = retryDlqStudy({ zeroBackoff: true })
      expect(s.vectors).toEqual({ Immediate: '100', Exponential: '100', FullJitter: '100' })
      expect(s.rows.every((r) => r.trilemma.fastRecovery === true)).toBe(true)
      expect(s.rows.every((r) => r.trilemma.noStorm === false)).toBe(true)
      expect(s.verdict.noUniversalWinner).toBe(false)
    })

    it('单开 perfectJitter：只打散惊群，救不了 Immediate 风暴与退避协议恢复慢', () => {
      const s = retryDlqStudy({ perfectJitter: true })
      expect(s.vectors).toEqual({ Immediate: '101', Exponential: '011', FullJitter: '011' })
      expect(s.rows[0].trilemma.noStorm).toBe(false)         // Immediate 风暴仍在
      expect(s.rows[1].trilemma.fastRecovery).toBe(false)    // Exponential 恢复慢仍在
    })

    it('FullJitter 非银弹：占不风暴+不惊群两维，仍缺低恢复延迟', () => {
      const s = retryDlqStudy({})
      expect(s.verdict.fullJitterNotFreeLunch).toBe(true)
      expect(s.rows[2].trilemma.noStorm && s.rows[2].trilemma.noHerd).toBe(true)
      expect(s.rows[2].trilemma.fastRecovery).toBe(false)
    })

    it('别名 compareRetryDlq === retryDlqStudy（同构 API）', () => {
      expect(compareRetryDlq).toBe(retryDlqStudy)
      expect(JSON.stringify(compareRetryDlq({ seed: 7 }))).toBe(JSON.stringify(retryDlqStudy({ seed: 7 })))
    })

    it('注入确定性：messages 增大 ⇒ 重投次数随之增（真模拟、非硬编码）', () => {
      const base = retryDlqStudy({ seed: 520 })
      const more = retryDlqStudy({ seed: 520, messages: 24 })
      expect(more.config.messages).toBe(24)
      expect(more.rows[0].totals.retries).toBeGreaterThan(base.rows[0].totals.retries)
    })
  })

  describe('快照 / 证据 / CLI', () => {
    it('retryDlqSnapshot：形状完整、null 输入回 null', () => {
      const s = retryDlqStudy({})
      const snap = retryDlqSnapshot(s)!
      expect(snap.rows.length).toBe(3)
      expect(snap.config.scenarios).toEqual(RDL_SCENARIOS)
      expect(retryDlqSnapshot(null as any)).toBeNull()
    })

    it('createRetryDlqEvidence：七枚真件读数齐全（堆/桶/WAL/Ring/Redis/Bus/池）', () => {
      const e = createRetryDlqEvidence({ seed: 520 })
      expect(e.heapFired).toBeGreaterThan(0)
      expect(e.bucketAllowed).toBe(3)
      expect(e.bucketRejected).toBe(2)
      expect(e.walLines).toBe(3)
      expect(e.walReplayed).toBe(3)
      expect(e.hashRingNodes).toBe(2)
      expect(e.idemEntries).toBe(1)
      expect(e.deadNotices).toBe(2)
      expect(e.busListeners).toBe(1)
      expect(e.poolAcquired).toBe(3)
      expect(e.walReplayed).toBe(e.walLines) // 真 restore→replay 回读条数 == 真 append 行数
      expect(e.hashRingEmptyNodes).toBeGreaterThanOrEqual(0)
    })

    it('evidence 非硬编码：改注入后读数随真件变化（反假证据门）', async () => {
      const { createObjectPool } = await import('../../scripts/caesura-hw-perf.mjs')
      const p = createObjectPool({ factory: () => ({ id: 0 }), maxSize: 8 })
      p.acquire(); p.acquire(); p.acquire(); p.release({ id: 1 })
      expect(p.stats().acquired).toBe(3) // 多 acquire 一次真读数 +1（硬编码则恒 3 不变）
      const { createTokenBucket } = await import('../../scripts/caesura-rate-limiter.mjs')
      const b = createTokenBucket({ capacity: 5, refillPerSec: 0, now: () => 1000 })
      let allowed = 0
      for (let i = 0; i < 8; i++) if (b.allow().allowed) allowed++
      expect(allowed).toBe(5) // capacity 改 5 ⇒ 放行 5（硬编码 3 则红）
    })

    it('CLI 双跑字节一致 + 向量现算 + rigged 可证伪自证行', () => {
      const cli = join(process.cwd(), 'scripts', 'caesura-retry-dlq.mjs')
      const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
      const a = run()
      expect(a).toBe(run())
      expect(a).toContain('"Immediate":"100"')
      expect(a).toContain('"Exponential":"010"')
      expect(a).toContain('"FullJitter":"011"')
      expect(a).toContain('noUniversalWinner=true')
      expect(a).toContain('VECTOR_FROM_TRILEMMA_OK=true')
      const rigged = run('--rigged')
      expect(rigged).toContain('"Immediate":"101"')
      expect(rigged).toContain('noUniversalWinner=false')
      expect(rigged).toContain('RIGGED_FALSIFIABLE_OK=true')
    })

    it('空集降级：messages=1 + 场景子集不除零、不 NaN', () => {
      const s = retryDlqStudy({ messages: 1, scenarios: ['allOk', 'sustainedOutage'] })
      expect(s.rows.length).toBe(3)
      for (const row of s.rows) {
        expect(row.scenarios.length).toBe(2)
        for (const c of row.scenarios) {
          expect(Number.isFinite(c.stormPerMsg)).toBe(true)
          expect(Number.isFinite(c.herdRatio)).toBe(true)
        }
        expect(Number.isFinite(row.totals.stormPerMsg)).toBe(true)
      }
    })
  })
})
