import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CGP_DEFAULTS,
  CGP_PROTOCOLS,
  CGP_SCENARIOS,
  compareConsumerGroup,
  consumerGroupSnapshot,
  consumerGroupStudy,
  createConsumerGroupEvidence,
  createRangeAssignor,
  createRoundRobinAssignor,
  createStickyAssignor,
} from '../../scripts/caesura-consumer-group.mjs'

/**
 * KI-523 消费者组 rebalance / 分区所有权：Range / RoundRobin / Sticky 三协议诚实权衡。
 * 全进程内确定性教学状态机，headless 可证；不接真 Kafka broker / 真协调者。
 * 断言读数全部来自 CLI 实测，非拍脑袋硬编码。
 */

const SCRIPT = join(process.cwd(), 'scripts', 'caesura-consumer-group.mjs')
const cli = (args: string[] = []) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
const cell = (s: any, protocol: string, id: string) => s.rows.find((r: any) => r.protocol === protocol).scenarios.find((c: any) => c.id === id)

describe('KI-523 消费者组 rebalance：Range / RoundRobin / Sticky 三协议', () => {
  describe('① 默认导出 + 三真分配算法', () => {
    it('CGP_DEFAULTS / CGP_PROTOCOLS / CGP_SCENARIOS 顺序钉死', () => {
      expect(CGP_DEFAULTS.seed).toBe(523)
      expect(CGP_DEFAULTS.balanceBudget).toBe(1.4)
      expect(CGP_DEFAULTS.movementBudget).toBe(0.5)
      expect(CGP_DEFAULTS.computeBudget).toBe(2)
      expect(CGP_PROTOCOLS).toEqual(['Range', 'RoundRobin', 'Sticky'])
      expect(CGP_SCENARIOS).toEqual(['steadyState', 'partitionSkew', 'heteroSubscriptions', 'memberJoin', 'memberLeave', 'manyPartitions'])
    })

    it('createRangeAssignor: 每 topic 连续段、负载可偏斜、opUnits 最省', () => {
      const p = createRangeAssignor()
      const op = { n: 0 }
      const a = p.assign(['c0', 'c1', 'c2'], ['A', 'B'], { A: 4, B: 4 },
        { c0: ['A', 'B'], c1: ['A', 'B'], c2: ['A', 'B'] }, null, op)
      // 每 topic 4/3：连续段切 c0:[0]、c1:[1]、c2:[2,3] → 两 topic 累积 c0=2,c1=2,c2=4
      // （Range 的经典病：多 topic 余数系统性压在同一批尾部消费者，imbalance=4-2=2）
      expect(Object.keys(a).length).toBe(8)
      const loads = ['c0', 'c1', 'c2'].map((c) => Object.values(a).filter((o) => o === c).length)
      expect(loads).toEqual([2, 2, 4])
      expect(Math.max(...loads) - Math.min(...loads)).toBe(2) // 余数累积偏斜
      expect(op.n).toBe(8) // 每分区一次赋值，最省
    })

    it('createRoundRobinAssignor: 摊平轮询跳未订阅、同构更均衡', () => {
      const p = createRoundRobinAssignor()
      const op = { n: 0 }
      const a = p.assign(['c0', 'c1', 'c2'], ['A', 'B'], { A: 4, B: 4 },
        { c0: ['A', 'B'], c1: ['A', 'B'], c2: ['A', 'B'] }, null, op)
      const loads = ['c0', 'c1', 'c2'].map((c) => Object.values(a).filter((o) => o === c).length)
      expect(loads).toEqual([3, 3, 2]) // 余数被打散，比 Range 的 [4,2,2] 均衡
      expect(Math.max(...loads) - Math.min(...loads)).toBe(1)
      expect(op.n).toBeGreaterThan(8) // 轮询每分区扫订阅集合，比 Range 贵
    })

    it('createRoundRobinAssignor: 跳过未订阅 topic', () => {
      const p = createRoundRobinAssignor()
      const a = p.assign(['c0', 'c1', 'c2'], ['A', 'B'], { A: 4, B: 4 },
        { c0: ['A'], c1: ['A', 'B'], c2: ['B'] }, null, { n: 0 })
      for (let i = 0; i < 4; i++) {
        expect(a[`A#${i}`]).not.toBe('c2') // c2 不订 A
        expect(a[`B#${i}`]).not.toBe('c0') // c0 不订 B
      }
    })

    it('createStickyAssignor: 保留 prev 合法归属、最小迁移', () => {
      const p = createStickyAssignor()
      const rr = createRoundRobinAssignor()
      const subs = { c0: ['A'], c1: ['A'], c2: ['A'], c3: ['A'], c4: ['A'] }
      const prev = rr.assign(['c0', 'c1', 'c2', 'c3'], ['A'], { A: 8 }, subs, null, { n: 0 })
      const op = { n: 0 }
      const a = p.assign(['c0', 'c1', 'c2', 'c3', 'c4'], ['A'], { A: 8 }, subs, prev, op)
      let preserved = 0
      for (const k of Object.keys(prev)) if (prev[k] === a[k]) preserved++
      expect(preserved).toBeGreaterThanOrEqual(7) // 8 个分区只动 ≤1
    })

    it('createStickyAssignor: 成员退出时弃用离组者归属', () => {
      const p = createStickyAssignor()
      const subs = { c0: ['A'], c1: ['A'], c2: ['A'], c3: ['A'] }
      const prev = { 'A#0': 'c0', 'A#1': 'c1', 'A#2': 'c2', 'A#3': 'c3' }
      const a = p.assign(['c0', 'c1', 'c2'], ['A'], { A: 4 }, subs, prev, { n: 0 })
      expect(Object.values(a)).not.toContain('c3') // 退出者 c3 不再持有
      expect(Object.keys(a).length).toBe(4)
    })
  })

  describe('② consumerGroupStudy：六场景 × 三协议矩阵', () => {
    it('study 形状：rows 3 × scenarios 6、cell 全字段在', () => {
      const s = consumerGroupStudy({})
      expect(s.rows.map((r: any) => r.protocol)).toEqual(CGP_PROTOCOLS)
      for (const row of s.rows) {
        expect(row.scenarios.map((c: any) => c.id)).toEqual(CGP_SCENARIOS)
        for (const c of row.scenarios) {
          expect(typeof c.imbalance).toBe('number')
          expect(typeof c.starved).toBe('boolean')
          expect(typeof c.moveRate).toBe('number')
          expect(typeof c.opUnits).toBe('number')
          expect(typeof c.opPerPart).toBe('number')
          expect(typeof c.balanced).toBe('boolean')
          expect(typeof c.minimalMovement).toBe('boolean')
          expect(typeof c.cheap).toBe('boolean')
        }
      }
    })

    it('partitionSkew：Range 余数累积偏斜 imbalance=2，RR/Sticky=1', () => {
      const s = consumerGroupStudy({})
      expect(cell(s, 'Range', 'partitionSkew').imbalance).toBe(2)
      expect(cell(s, 'RoundRobin', 'partitionSkew').imbalance).toBe(1)
      expect(cell(s, 'Sticky', 'partitionSkew').imbalance).toBe(1)
    })

    it('heteroSubscriptions：Range/RR 异构偏斜=2，Sticky 负载感知=1', () => {
      const s = consumerGroupStudy({})
      expect(cell(s, 'Range', 'heteroSubscriptions').imbalance).toBe(2)
      expect(cell(s, 'RoundRobin', 'heteroSubscriptions').imbalance).toBe(2)
      expect(cell(s, 'Sticky', 'heteroSubscriptions').imbalance).toBe(1)
    })

    it('memberJoin：Sticky 最小迁移 0.125 << RR 0.5 << Range 0.75', () => {
      const s = consumerGroupStudy({})
      expect(cell(s, 'Sticky', 'memberJoin').moveRate).toBe(0.125)
      expect(cell(s, 'RoundRobin', 'memberJoin').moveRate).toBe(0.5)
      expect(cell(s, 'Range', 'memberJoin').moveRate).toBe(0.75)
    })

    it('memberLeave：Sticky 最小迁移 0.25，RR 0.625、Range 0.375', () => {
      const s = consumerGroupStudy({})
      expect(cell(s, 'Sticky', 'memberLeave').moveRate).toBe(0.25)
      expect(cell(s, 'RoundRobin', 'memberLeave').moveRate).toBe(0.625)
      expect(cell(s, 'Range', 'memberLeave').moveRate).toBe(0.375)
    })

    it('manyPartitions：Range opUnits 最省、RR/Sticky 昂贵（opPerPart 真读数）', () => {
      const s = consumerGroupStudy({})
      expect(cell(s, 'Range', 'manyPartitions').opPerPart).toBe(1)
      expect(cell(s, 'RoundRobin', 'manyPartitions').opPerPart).toBe(8)
      expect(cell(s, 'Sticky', 'manyPartitions').opPerPart).toBe(9)
      expect(cell(s, 'Range', 'manyPartitions').opUnits).toBe(200)
    })

    it('稳态全均衡、零迁移、零饥饿', () => {
      const s = consumerGroupStudy({})
      for (const p of CGP_PROTOCOLS) {
        const c = cell(s, p, 'steadyState')
        expect(c.imbalance).toBe(0)
        expect(c.starved).toBe(false)
        expect(c.moveRate).toBe(0)
      }
    })
  })

  describe('③ 三难向量 · 不封赢家 · 正交化', () => {
    it('默认向量 Range=001 / RoundRobin=100 / Sticky=110 三分、无一 111', () => {
      const s = consumerGroupStudy({})
      expect(s.vectors).toEqual({ Range: '001', RoundRobin: '100', Sticky: '110' })
      expect(s.verdict.noUniversalWinner).toBe(true)
      expect(s.verdict.trilemmaDistinguishes).toBe(true)
      expect(s.verdict.noProtocolWinsAll).toBe(true)
    })

    it('向量恒由 row.trilemma 现算（与表格同源，非硬覆盖）', () => {
      const s = consumerGroupStudy({})
      for (const row of s.rows) {
        const t = row.trilemma
        expect(s.vectors[row.protocol]).toBe(`${+t.balanced}${+t.minimalMovement}${+t.cheap}`)
      }
    })

    it('各有胜场：Range 只便宜、RR 只均衡、Sticky 均衡+最小迁移最贵', () => {
      const s = consumerGroupStudy({})
      expect(s.verdict.rangeCheapest).toBe(true)
      expect(s.verdict.rangeSkews).toBe(true)
      expect(s.verdict.roundRobinBalanced).toBe(true)
      expect(s.verdict.roundRobinMigrates).toBe(true)
      expect(s.verdict.stickyBalanced).toBe(true)
      expect(s.verdict.stickyMinimalMovement).toBe(true)
    })

    it('Sticky 非银弹：占两维但缺算法轻量', () => {
      const s = consumerGroupStudy({})
      expect(s.verdict.stickyNotFreeLunch).toBe(true)
      expect(s.rows[2].trilemma.cheap).toBe(false)
    })

    it('正交化：稳态无成员变动 ⇒ minimalMovement 空真', () => {
      const s = consumerGroupStudy({})
      expect(s.verdict.steadyStateVacuousTrue).toBe(true)
      for (const p of CGP_PROTOCOLS) expect(cell(s, p, 'steadyState').minimalMovement).toBe(true)
    })

    it('compareConsumerGroup === consumerGroupStudy 别名同引用', () => {
      expect(compareConsumerGroup).toBe(consumerGroupStudy)
      expect(JSON.stringify(compareConsumerGroup({ seed: 7 }))).toBe(JSON.stringify(consumerGroupStudy({ seed: 7 })))
    })
  })

  describe('④ rigged 可证伪 · 因果锁死 · 单开开关', () => {
    it('rigged 三开关齐开 ⇒ 101/101/101、三判词翻 false', () => {
      const s = consumerGroupStudy({ rigged: true })
      expect(s.vectors).toEqual({ Range: '101', RoundRobin: '101', Sticky: '101' })
      expect(s.rigged).toBe(true)
      expect(s.verdict.noUniversalWinner).toBe(false)
      expect(s.verdict.trilemmaDistinguishes).toBe(false)
    })

    it('因果锁死：minimalMovement 维无一协议能翻回（真算 moveSum>预算，非硬写）', () => {
      const s = consumerGroupStudy({ rigged: true })
      expect(s.verdict.minimalMovementCausallyUnerasable).toBe(true)
      for (const row of s.rows) {
        expect(row.trilemma.minimalMovement).toBe(false)
        expect(row.metrics.moveSum).toBeGreaterThan(0.5)
      }
    })

    it('单开 zeroMovement：新成员饥饿 starved=true、balanced 反噬 false', () => {
      const s = consumerGroupStudy({ zeroMovement: true })
      expect(s.verdict.zeroMovementStarvesJoiner).toBe(true)
      for (const row of s.rows) {
        expect(row.trilemma.balanced).toBe(false)
        expect(row.trilemma.minimalMovement).toBe(true) // 冻结归属 ⇒ moveSum=0
      }
      expect(cell(s, 'Sticky', 'memberJoin').starved).toBe(true)
    })

    it('单开 perfectBalance：只抹均衡维、不抹 minimalMovement', () => {
      const s = consumerGroupStudy({ perfectBalance: true })
      for (const row of s.rows) expect(row.trilemma.balanced).toBe(true)
      // perfectBalance + 成员变动强制推倒重排 ⇒ 迁移仍大
      expect(s.rows[0].trilemma.minimalMovement).toBe(false)
    })

    it('单开 freeCompute：只抹 cheap 维、不动 balanced/minimalMovement', () => {
      const s = consumerGroupStudy({ freeCompute: true })
      for (const row of s.rows) expect(row.trilemma.cheap).toBe(true)
      expect(s.vectors).toEqual({ Range: '001', RoundRobin: '101', Sticky: '111' })
    })
  })

  describe('⑤ 快照 · 时钟 · 九真件交叉印证', () => {
    it('builtAt 对注入时钟函数真求值（KI-517 契约）', () => {
      const s = consumerGroupStudy({ now: () => 1794391585499 })
      expect(s.builtAt).toBe(1794391585499)
    })

    it('注入规模生效（bigPartitions 改变 opUnits，真读数随之变）', () => {
      const s = consumerGroupStudy({ bigPartitions: 400 })
      for (const p of CGP_PROTOCOLS) expect(cell(s, p, 'manyPartitions').opUnits).toBeGreaterThan(200)
    })

    it('consumerGroupSnapshot 裁剪为空集降级 null', () => {
      expect(consumerGroupSnapshot(null as any)).toBe(null)
      expect(consumerGroupSnapshot({} as any)).toBe(null)
    })

    it('consumerGroupSnapshot 保留 rows/vectors/verdict/crosscheck', () => {
      const snap = consumerGroupSnapshot(consumerGroupStudy({}))
      expect(snap).not.toBe(null)
      expect(snap!.rows.length).toBe(3)
      expect(snap!.vectors).toEqual({ Range: '001', RoundRobin: '100', Sticky: '110' })
      expect(snap!.verdict.noUniversalWinner).toBe(true)
      expect(snap!.builtAt).toBe(0)
    })

    it('九真件交叉印证：全真 API 真回读、非硬编码零/NaN', () => {
      const e = createConsumerGroupEvidence({ seed: 523 })
      expect(Object.keys(e).length).toBe(16)
      for (const [k, v] of Object.entries(e)) {
        expect(typeof v).toBe('number')
        expect(Number.isFinite(v)).toBe(true)
        if (!['hashRingEmptyNodes', 'bucketRejected'].includes(k)) expect(v).toBeGreaterThan(0)
      }
      // 真件语义：一致性哈希迁移率 < 取模（粘性优势）、WAL 真回放、令牌桶真拒、最小堆真弹
      expect(e.remapConsistentRate).toBeLessThan(e.remapModuloRate)
      expect(e.remapSavedRate).toBeGreaterThan(0)
      expect(e.walLines).toBe(2)
      expect(e.walReplayed).toBe(2)
      expect(e.rebalanceNotices).toBe(2)
      expect(e.bucketAllowed).toBe(2)
      expect(e.bucketRejected).toBe(2)
      expect(e.heapFired).toBe(9)
    })

    it('evidence 随 seed 变化（非固定假读数）', () => {
      const a = createConsumerGroupEvidence({ seed: 1 })
      const b = createConsumerGroupEvidence({ seed: 999 })
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
    })
  })

  describe('⑥ CLI 自证', () => {
    it('CLI 默认向量 + 三分判词 + 向量现算自证行', () => {
      const out = cli()
      expect(out).toContain('"Range":"001","RoundRobin":"100","Sticky":"110"')
      expect(out).toContain('noUniversalWinner=true distinguishable=true')
      expect(out).toContain('VECTOR_FROM_TRILEMMA_OK=true')
    })

    it('CLI rigged 可证伪自证行', () => {
      const out = cli(['--rigged'])
      expect(out).toContain('"Range":"101","RoundRobin":"101","Sticky":"101"')
      expect(out).toContain('noUniversalWinner=false distinguishable=false')
      expect(out).toContain('RIGGED_FALSIFIABLE_OK=true')
    })

    it('CLI 双跑字节一致', () => {
      expect(cli()).toBe(cli())
    })
  })

  describe('⑦ 空集降级', () => {
    it('scenarios 空集 ⇒ rows 仍 3、trilemma 空真、不崩', () => {
      const s = consumerGroupStudy({ scenarios: [] })
      expect(s.rows.length).toBe(3)
      for (const row of s.rows) {
        expect(row.scenarios.length).toBe(0)
        expect(row.trilemma.balanced).toBe(true)
        expect(row.trilemma.minimalMovement).toBe(true)
        expect(row.trilemma.cheap).toBe(true)
      }
    })
  })
})
