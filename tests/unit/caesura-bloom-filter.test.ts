import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BF_DEFAULTS,
  BF_SCENARIOS,
  BF_STRATEGIES,
  bloomFilterSnapshot,
  bloomFilterStudy,
  compareBloomFilter,
  createBloomFilter,
  createBloomFilterEvidence,
  createCountingBloomFilter,
  createCuckooFilter,
  runBloomFilterScenario,
  verifyFalsePositiveCeiling,
} from '../../scripts/caesura-bloom-filter.mjs'

/**
 * KI-527 布隆/布谷鸟/计数布隆三过滤器诚实权衡：Bloom / CountingBloom / Cuckoo。
 * 全进程内确定性教学状态机，headless 可证；不接真 RocksDB Bloom / 真 RedisBloom 模块 / 真 CuckooFilter 库。
 * 断言读数全部来自 CLI / study / 真件实测，向量由 row.trilemma 现算，非硬编码覆盖。
 */

const SCRIPT = join(process.cwd(), 'scripts', 'caesura-bloom-filter.mjs')
const cli = (args: string[] = []) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
const cell = (s: any, proto: string, id: string) =>
  s.rows.find((r: any) => r.protocol === proto).scenarios.find((c: any) => c.id === id)
const vecOf = (r: any) =>
  `${Number(r.trilemma.compactFootprint)}${Number(r.trilemma.insertsNeverFail)}${Number(r.trilemma.deleteSupport)}`

/** 真 FP 理论上界样本：bits=10b/key×1024、k=7、否定集 4096、实测 0.0065（邻域内） */
const steadyCeiling = {
  bits: 10240, keys: 1024, hashFunctions: 7, negativeProbes: 4096,
  measuredFpr: 0.0065, secondMeasuredFpr: 0.0071,
}

describe('KI-527 布隆/布谷鸟/计数布隆：三策略 × 六场景 × 三难', () => {
  describe('① 默认导出 + 三真策略件', () => {
    it('BF_DEFAULTS / BF_STRATEGIES / BF_SCENARIOS 顺序钉死', () => {
      expect(BF_DEFAULTS.seed).toBe(527)
      expect(BF_DEFAULTS.capacity).toBe(1024)
      expect(BF_DEFAULTS.bitsPerKey).toBe(10)
      expect(BF_DEFAULTS.countersPerKey).toBe(4)
      expect(BF_DEFAULTS.counterWidth).toBe(4)
      expect(BF_DEFAULTS.maxLoadFactor).toBe(0.95)
      expect(BF_STRATEGIES).toEqual(['Bloom', 'CountingBloom', 'Cuckoo'])
      expect(BF_SCENARIOS).toEqual([
        'steadyFilter', 'hotKeyFlood', 'deleteCycle', 'highLoadSaturation', 'burstScale', 'overAdmitted',
      ])
    })

    it('createBloomFilter：add/contains 真位图、无假阴性、remove 恒 false（Bloom 领域）', () => {
      const b = createBloomFilter({ capacity: 256 })
      for (let i = 0; i < 120; i++) b.add(`k${i}`)
      let falseNeg = 0
      for (let i = 0; i < 120; i++) if (!b.contains(`k${i}`)) falseNeg++
      expect(falseNeg).toBe(0) // Bloom 零假阴性
      expect(b.remove('k0')).toBe(false) // 不支持删除，如实返回 false
      const st = b.stats()
      expect(st.added).toBe(120)
      expect(st.bytes).toBeGreaterThan(0)
      expect(st.hashFunctions).toBeGreaterThanOrEqual(2)
    })

    it('createCountingBloomFilter：真计数可删、删后 contains 翻 false、计数不为负', () => {
      const cb = createCountingBloomFilter({ capacity: 256 })
      cb.add('a'); cb.add('a'); cb.add('b')
      expect(cb.contains('a')).toBe(true)
      expect(cb.remove('a')).toBe(true)
      expect(cb.contains('a')).toBe(true) // 加了两次，删一次仍应存在
      expect(cb.remove('a')).toBe(true)
      expect(cb.contains('a')).toBe(false)
      expect(cb.remove('a')).toBe(false) // 已删空，再删拒绝（计数不为负）
    })

    it('createCuckooFilter：真桶化 + 高装载崖壁拒插，且成功插入的 key 零丢失', () => {
      const c = createCuckooFilter({ capacity: 1024 })
      const added: string[] = []
      let rejected = 0
      for (let i = 0; i < 2500; i++) {
        const k = `k${i}`
        if (c.add(k)) added.push(k)
        else rejected++
      }
      expect(rejected).toBeGreaterThan(0) // 崖壁真触发，非「永不失败的假 Cuckoo」
      const lost = added.filter((k) => !c.contains(k)).length
      expect(lost).toBe(0) // 拒插是回滚，不静默覆盖已占 fingerprint
      expect(c.stats().stashFailures).toBeGreaterThan(0)
      expect(c.remove(added[0])).toBe(true) // 可删
    })

    it('六场景 × 三策略全跑不抛错', () => {
      for (const p of BF_STRATEGIES) {
        for (const s of BF_SCENARIOS) {
          expect(() => runBloomFilterScenario(p, s, { seed: 527, capacity: 256 })).not.toThrow()
        }
      }
    })
  })

  describe('② 六场景 × 三策略矩阵 + 默认向量', () => {
    const study = bloomFilterStudy({ now: () => 1 })

    it('三策略全部六场景真跑、每 cell 有真计数', () => {
      expect(study.rows.length).toBe(3)
      for (const row of study.rows) {
        expect(row.scenarios.length).toBe(6)
        for (const c of row.scenarios) {
          expect(typeof c.inserted).toBe('number')
          expect(typeof c.probes).toBe('number')
          expect(c.fpRate).toBeGreaterThanOrEqual(0)
          expect(c.fpRate).toBeLessThanOrEqual(1)
          expect(BF_SCENARIOS).toContain(c.id as any)
        }
      }
    })

    it('默认向量 110/011/101 三者互异、无一 111、不封赢家', () => {
      expect(study.vectors).toEqual({ Bloom: '110', CountingBloom: '011', Cuckoo: '101' })
      for (const row of study.rows) expect(vecOf(row)).toBe(study.vectors[row.protocol])
      expect(study.noUniversalWinner).toBe(true)
      expect(study.trilemmaDistinguishes).toBe(true)
      expect(new Set(Object.values(study.vectors)).size).toBe(3)
      expect(Object.values(study.vectors)).not.toContain('111')
    })

    it('Bloom 空间省 + 插入不失败，但无删除（软肋：deleteSupport）', () => {
      const row = study.rows.find((r: any) => r.protocol === 'Bloom')!
      expect(row.trilemma.compactFootprint).toBe(true)
      expect(row.trilemma.insertsNeverFail).toBe(true)
      expect(row.trilemma.deleteSupport).toBe(false)
      const del = cell(study, 'Bloom', 'deleteCycle')
      expect(del.deleteSuccess).toBe(0) // Bloom remove 恒 false
    })

    it('CountingBloom 可删 + 插入不失败，但计数吃空间（软肋：compactFootprint）', () => {
      const row = study.rows.find((r: any) => r.protocol === 'CountingBloom')!
      expect(row.trilemma.compactFootprint).toBe(false)
      expect(row.trilemma.insertsNeverFail).toBe(true)
      expect(row.trilemma.deleteSupport).toBe(true)
      expect(row.metrics.bitsPerKey).toBeGreaterThan(20) // 计数远超预算
    })

    it('Cuckoo 空间省 + 可删，但高装载崖壁拒插（软肋：insertsNeverFail）', () => {
      const row = study.rows.find((r: any) => r.protocol === 'Cuckoo')!
      expect(row.trilemma.compactFootprint).toBe(true)
      expect(row.trilemma.insertsNeverFail).toBe(false)
      expect(row.trilemma.deleteSupport).toBe(true)
      expect(row.metrics.totalStashFailures).toBeGreaterThan(0) // 崖壁真触发
      expect(row.metrics.bitsPerKey).toBeLessThanOrEqual(20)
    })

    it('正交考场：删除维只在 deleteCycle 有 deleteTries，其余场景空真不连坐', () => {
      for (const row of study.rows) {
        for (const c of row.scenarios) {
          if (c.id !== 'deleteCycle') expect(c.deleteTries).toBe(0)
        }
      }
    })

    it('verdict 真判词齐、且由现算驱动', () => {
      expect(study.verdict.vectors).toEqual(study.vectors)
      expect(study.verdict.vectorFromTrilemma).toBe(true)
      expect(study.verdict.bloomDeleteFree).toBe(true)
      expect(study.verdict.countingBloomSpacePays).toBe(true)
      expect(study.verdict.cuckooStashWall).toBe(true)
      expect(study.verdict.fpCeilingHolds).toBe(true)
      expect(study.verdict.noStrategyWinsAll).toBe(true)
    })
  })

  describe('③ verifyFalsePositiveCeiling 双路守恒自证 + 三路可证伪', () => {
    it('稳态真撞合：理论上界 ε 与两颗独立否定集采样落在邻域内、非平凡', () => {
      const v = verifyFalsePositiveCeiling(steadyCeiling)
      expect(v.holds).toBe(true)
      expect(v.nontrivial).toBe(true)
      expect(v.falsifiable).toBe(true)
      expect(v.theory).toBeGreaterThan(0)
      expect(v.measured).toBeGreaterThanOrEqual(v.lower)
      expect(v.measured).toBeLessThanOrEqual(v.tolerated)
    })

    it('篡改 bits 让理论上界失真 ⇒ 真喂回现算 holds=false', () => {
      const v = verifyFalsePositiveCeiling({ ...steadyCeiling, bits: 640 })
      expect(v.holds).toBe(false)
      expect(v.tamper.trustConfig.holds).toBe(false)
    })

    it('零误判却给真否定集 ⇒ 跌破下界 holds=false', () => {
      const v = verifyFalsePositiveCeiling({ ...steadyCeiling, measuredFpr: 0 })
      expect(v.holds).toBe(false)
      expect(v.tamper.zeroFpr.holds).toBe(false)
    })

    it('绕过否定集 probes=0 ⇒ nontrivial 降级、不凭 0 假绿', () => {
      const v = verifyFalsePositiveCeiling({ ...steadyCeiling, negativeProbes: 0 })
      expect(v.holds).toBe(false)
      expect(v.nontrivial).toBe(false)
      expect(v.tamper.skipProbe.holds).toBe(false)
    })

    it('空集降级：holds=false / nontrivial=false，不凭 0=0 假绿', () => {
      const v = verifyFalsePositiveCeiling({} as any)
      expect(v.holds).toBe(false)
      expect(v.nontrivial).toBe(false)
    })

    it('三路 tamper 不是硬编码对象：各自带真读数 theory/measured/reason', () => {
      const v = verifyFalsePositiveCeiling(steadyCeiling)
      expect(typeof v.tamper.trustConfig.theory).toBe('number')
      expect(typeof v.tamper.zeroFpr.measured).toBe('number')
      expect(typeof v.tamper.skipProbe.reason).toBe('string')
    })
  })

  describe('④ rigged 三开关因果锁死，绝不硬造全 111', () => {
    const rig = bloomFilterStudy({ rigged: true, now: () => 1 })

    it('三开关齐开真值透传，向量由 row.trilemma 现算收敛 011×3', () => {
      expect(rig.config.unlimitedRoom).toBe(true)
      expect(rig.config.eternalStasis).toBe(true)
      expect(rig.config.noDeletesNeeded).toBe(true)
      expect(rig.rigged).toBe(true)
      expect(rig.vectors).toEqual({ Bloom: '011', CountingBloom: '011', Cuckoo: '011' })
      for (const row of rig.rows) expect(vecOf(row)).toBe(rig.vectors[row.protocol])
      expect(rig.noUniversalWinner).toBe(false)
      expect(rig.trilemmaDistinguishes).toBe(false)
    })

    it('rigged 绝不出现全 111，且 compactFootprint 因果抹不掉', () => {
      expect(Object.values(rig.vectors)).not.toContain('111')
      expect(rig.verdict.compactFootprintCausallyUnerasable).toBe(true)
    })

    it('单开 unlimitedRoom 只反噬 compactFootprint 一维，不封赢家', () => {
      const s = bloomFilterStudy({ unlimitedRoom: true, now: () => 1 })
      for (const row of s.rows) expect(row.trilemma.compactFootprint).toBe(false)
      expect(Object.values(s.vectors)).not.toContain('111')
      expect(s.verdict.unlimitedRoomBackfiresCompactFootprint).toBe(true)
    })

    it('单开 eternalStasis / noDeletesNeeded 各自反噬 deletes 维、不封赢家', () => {
      const e = bloomFilterStudy({ eternalStasis: true, now: () => 1 })
      const n = bloomFilterStudy({ noDeletesNeeded: true, now: () => 1 })
      expect(e.verdict.eternalStasisBackfiresDeletes).toBe(true)
      expect(n.verdict.noDeletesNeededBackfiresDeletes).toBe(true)
      expect(Object.values(e.vectors)).not.toContain('111')
      expect(Object.values(n.vectors)).not.toContain('111')
    })
  })

  describe('⑤ 十一真件 21 键交叉印证 + 注入 + 快照 + CLI', () => {
    it('createBloomFilterEvidence：21 键全真回读、无 NaN/undefined', () => {
      const e = createBloomFilterEvidence()
      expect(Object.keys(e).length).toBe(21)
      expect(Object.entries(e).filter(([, v]) => !Number.isFinite(v))).toEqual([])
      expect(e.walReplayed).toBe(e.walLines)
      expect(e.bucketAllowed + e.bucketRejected).toBeGreaterThan(0)
      expect('hashRingNodes' in e).toBe(false) // 旧草稿伪键已清除
    })

    it('evidence 真 API 名落键：21 键逐一钉死', () => {
      const e = createBloomFilterEvidence()
      for (const k of ['remapConsistentRate', 'remapModuloRate', 'routerMoved', 'routerTracked',
        'ringNodes', 'ringShardsUsed', 'walLines', 'walReplayed', 'notices', 'busListeners',
        'redisBitmapHits', 'redisSlots', 'poolCreated', 'poolReused', 'bucketAllowed',
        'bucketRejected', 'heapFired', 'heapPending', 'counterSum', 'counterFalseSharing', 'jitterSpread']) {
        expect(k in e).toBe(true)
      }
    })

    it('builtAt 走注入时钟（KI-517 契约）', () => {
      expect(bloomFilterStudy({ now: () => 7777000 }).builtAt).toBe(7777000)
      expect(bloomFilterStudy({ now: () => 42 }).builtAt).toBe(42)
    })

    it('compareBloomFilter 是 bloomFilterStudy 的同构别名', () => {
      expect(compareBloomFilter).toBe(bloomFilterStudy)
    })

    it('bloomFilterSnapshot 保留真值；null/空对象降级诚实', () => {
      const snap = bloomFilterSnapshot(bloomFilterStudy({ now: () => 1 }))
      expect(snap!.rows.length).toBe(3)
      expect(snap!.vectors).toEqual({ Bloom: '110', CountingBloom: '011', Cuckoo: '101' })
      expect(bloomFilterSnapshot(null)).toBeNull()
      expect(bloomFilterSnapshot({} as any)).toBeNull()
    })

    it('runBloomFilterScenario 单场景真跑结构化读数', () => {
      const c = runBloomFilterScenario('Cuckoo', 'highLoadSaturation', {})
      expect(c.strategy).toBe('Cuckoo')
      expect(c.id).toBe('highLoadSaturation')
      expect(Number.isFinite(c.fpRate)).toBe(true)
      expect(c.bytes).toBeGreaterThan(0)
    })

    it('CLI 默认态输出三向量 + 判词 + evidence 21 键，无 undefined', () => {
      const out = cli()
      expect(out).toContain('"Bloom":"110"')
      expect(out).toContain('"CountingBloom":"011"')
      expect(out).toContain('"Cuckoo":"101"')
      expect(out).toContain('noUniversalWinner=true')
      expect(out).toContain('evidenceKeys=21')
      expect(out).not.toContain('undefined')
    })

    it('CLI rigged 态输出 011×3 + 因果锁判词，绝不全 111', () => {
      const out = cli(['--rigged'])
      expect(out).toContain('"Bloom":"011"')
      expect(out).toContain('"CountingBloom":"011"')
      expect(out).toContain('"Cuckoo":"011"')
      expect(out).toContain('compactFootprintCausallyUnerasable=true')
      expect(out).not.toContain('"Bloom":"111"')
    })

    it('CLI 固定时钟双跑字节一致', () => {
      expect(cli(['--now=7777000'])).toBe(cli(['--now=7777000']))
    })
  })
})
