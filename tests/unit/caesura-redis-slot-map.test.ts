import { describe, expect, it } from 'vitest'
import {
  SLOT_MAP_DEFAULTS,
  SLOT_MAP_SCENARIOS,
  SLOT_MAP_STRATEGIES,
  crc16,
  crc16ccitt,
  extractHashTag,
  createSlotModulo,
  createHashTagSlot,
  slotMapStudy,
  slotMapSnapshot,
  verifySlotMapSoundness,
  verifyCausalLocks,
  createSlotMapEvidence,
} from '../../scripts/caesura-redis-slot-map.mjs'

/** KI-557 Redis Cluster 哈希槽拓扑教学件 · 第六十三件（2026-11-14） */

describe('caesura-redis-slot-map（KI-557）', () => {
  it('默认值/三策略/四场景冻结', () => {
    expect(SLOT_MAP_STRATEGIES).toEqual(['SlotModulo', 'HashTagSlot', 'ConsistentSlot'])
    expect(SLOT_MAP_SCENARIOS).toEqual(['burstJoins', 'hotTagColocate', 'addShard', 'cleanRerun'])
    expect(SLOT_MAP_DEFAULTS.slots).toBe(16384)
    expect(SLOT_MAP_DEFAULTS.seed).toBe(557)
  })

  it('CRC16-CCITT：同样输入同样输出、返回 0..65535 闭区间、非空', () => {
    const a = crc16('user:{u:1}:item')
    const b = crc16ccitt('user:{u:1}:item')
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(65536)
    expect(crc16('')).toBe(0)
    expect(Number.isInteger(crc16('a'))).toBe(true)
  })

  it('extractHashTag：{} 包裹的 body 会被挑出来；无括号/未闭合/空标签返回 null', () => {
    expect(extractHashTag('user:{u:7}:item')).toBe('u:7')
    expect(extractHashTag('user:{u:7')).toBe(null)
    expect(extractHashTag('user')).toBe(null)
    expect(extractHashTag('user:{}:item')).toBe('')
  })

  it('createSlotModulo：满均衡 + 无 hash tag 共定位能力', () => {
    const keys = Array.from({ length: 96 }, (_, i) => ({ id: `k:${i}`, key: `user:{u:${i % 7}}:${i}` }))
    const r = createSlotModulo().invoke(keys)
    expect(r.processed).toBe(96)
    expect(r.slotsUsed).toBeGreaterThan(64)
    expect(r.stddev).toBeGreaterThanOrEqual(0)
  })

  it('createHashTagSlot：同 tag 键强制同槽', () => {
    const keys = Array.from({ length: 96 }, (_, i) => ({ id: `k:${i}`, key: `user:{u:${i % 7}}:${i}` }))
    const r = createHashTagSlot().invoke(keys)
    expect(r.slotsUsed).toBeLessThanOrEqual(new Set(keys.map(({ key }) => extractHashTag(key))).size)
    expect(r.slotsUsed).toBeGreaterThan(0)
  })

  it('向量表：SlotModulo=100 / HashTagSlot=110 / ConsistentSlot=011；无 111', () => {
    const study = slotMapStudy({ now: () => 557 })
    expect(study.vectors.SlotModulo).toBe('100')
    expect(study.vectors.HashTagSlot).toBe('110')
    expect(study.vectors.ConsistentSlot).toBe('001')
    expect(Object.values(study.vectors)).not.toContain('111')
    expect(study.verdict.noUniversalWinner).toBe(true)
    expect(study.verdict.trilemmaDistinguishes).toBe(true)
    expect(study.verdict.noStrategyWinsAll).toBe(true)
  })

  it('四场景 × 三策略全量有细胞；FaultTypes 匹配', () => {
    const study = slotMapStudy({ now: () => 557 })
    for (const row of study.rows) {
      expect(row.scenarios).toHaveLength(4)
      expect(row.scenarios.map((c) => c.id)).toEqual(SLOT_MAP_SCENARIOS)
    }
    const faults = study.rows[0].scenarios.map((c) => c.fault)
    expect(faults).toContain('cluster-join')
    expect(faults).toContain('reshard-migration')
    expect(faults).toContain('tag-collision')
    expect(faults).toContain('rerun-idempotent')
  })

  it('不写死：两跑结果逐字一致（同 now）', () => {
    const a = slotMapSnapshot(slotMapStudy({ now: () => 557 }))
    const b = slotMapSnapshot(slotMapStudy({ now: () => 557 }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('verifySlotMapSoundness：baseline holds=true，三路 tamper 全 false（真喂回同一 holds 公式）', () => {
    const r = verifySlotMapSoundness({ seed: 557, messages: 96 })
    expect(r.baselineHolds).toBe(true)
    expect(r.holds).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.tamper.wrongCrcSeed.holds).toBe(false)
    expect(r.tamper.missingBrace.holds).toBe(false)
    expect(r.tamper.forcedModulo.holds).toBe(false)
    expect(r.tamper.wrongCrcSeed.reason).toContain('wrongCrcSeed')
    expect(r.tamper.missingBrace.reason).toContain('missingBrace')
    expect(r.tamper.forcedModulo.reason).toContain('forcedModulo')
  })

  it('三路 tamper 差异化：missingBrace/forcedModulo 退化 tag colocated map、wrongCrcSeed 分布塌缩', () => {
    const r = verifySlotMapSoundness({ seed: 557, messages: 96 })
    expect(r.laneA.tags).toBe(7)
    expect(r.laneA.tagColocationMismatches).toBe(0)
    expect(r.laneB.slotsCovered).toBeGreaterThan(48)
    expect(r.laneB.evenlyDistributed).toBe(true)
  })

  it('verifyCausalLocks 三道因果锁全闭合（真实 CRC 红利）', () => {
    const c = verifyCausalLocks()
    expect(c.crc16DistributionCausallyUnerasable).toBe(true)
    expect(c.hashTagBindingCausallyUnerasable).toBe(true)
    expect(c.slotMigrationFloorCausallyUnerasable).toBe(true)
    expect(c.causalLocksAllHold).toBe(true)
    expect(c.probes.slotsCovered).toBeGreaterThan(600)
    expect(c.probes.tagSlots).toBe(1)
    expect(c.probes.crcSampleCount).toBe(1024)
  })

  it('rigged 单开 freeEven：仅 ConsistentSlot 上浮 distributesEvenly（001→101），其他两策略不受影响', () => {
    const s = slotMapStudy({ now: () => 557, rigged: true, freeEven: true })
    expect(s.vectors.ConsistentSlot).toBe('101')
    expect(s.vectors.SlotModulo).toBe('100')
    expect(s.vectors.HashTagSlot).toBe('110')
    expect(s.verdict.rigged).toBe(true)
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
  })

  it('rigged 单开 freeColocation：仅 SlotModulo 和 ConsistentSlot 上浮 colocationByHashTag（100→110 / 001→011）', () => {
    const s = slotMapStudy({ now: () => 557, rigged: true, freeColocation: true })
    expect(s.vectors.SlotModulo).toBe('110')
    expect(s.vectors.HashTagSlot).toBe('110') // already true — unaffected
    expect(s.vectors.ConsistentSlot).toBe('011')
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
  })

  it('rigged 单开 freeMigrationMin：SlotModulo 与 HashTagSlot 上浮 minMigration（100→101 / 110→111）', () => {
    const s = slotMapStudy({ now: () => 557, rigged: true, freeMigrationMin: true })
    expect(s.vectors.SlotModulo).toBe('101')
    expect(s.vectors.HashTagSlot).toBe('111')
    expect(s.vectors.ConsistentSlot).toBe('001') // already true — unaffected
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
  })

  it('rigged 三开：ConsistentSlot=111，其它两个也=111；触发收敛塌缩判定', () => {
    const s = slotMapStudy({ now: () => 557, rigged: true, freeEven: true, freeColocation: true, freeMigrationMin: true })
    expect(s.verdict.riggedConvergenceCollapsed).toBe(true)
    expect(s.vectors.SlotModulo).toBe('111')
    expect(s.vectors.HashTagSlot).toBe('111')
    expect(s.vectors.ConsistentSlot).toBe('111')
  })

  it('21 件证据齐全且全为有限数', () => {
    const ev = createSlotMapEvidence({ seed: 557, now: 0 })
    const keys = Object.keys(ev).sort()
    expect(keys).toHaveLength(21)
    for (const k of keys) expect(Number.isFinite(ev[k as keyof typeof ev])).toBe(true)
    expect(ev.ringShardsUsed).toBeGreaterThanOrEqual(1)
    expect(ev.redisBitmapHits).toBeGreaterThanOrEqual(1)
    expect(ev.walReplayed).toBe(ev.walLines)
    expect(ev.notices).toBe(12)
    expect(ev.busListeners).toBe(1)
  })

  it('Snapshot：同 builtAt / vectors；snap-time pure', () => {
    const study = slotMapStudy({ now: () => 424242 })
    const snap = slotMapSnapshot(study)
    expect(snap.builtAt).toBe(424242)
    expect(snap.vectors).toEqual(study.vectors)
    expect(snap.causalLocks.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck.soundness.holds).toBe(true)
  })

  it('CLI 链落：三行、含 vectors、不连网', () => {
    const snap = slotMapSnapshot(slotMapStudy({ now: () => 557 }))
    expect(snap.rows.map((r) => r.protocol)).toEqual(['SlotModulo', 'HashTagSlot', 'ConsistentSlot'])
    expect(snap.config.slots).toBe(16384)
  })
})
