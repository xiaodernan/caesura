import { describe, it, expect } from 'vitest'
import { createBPlusTree } from '../../scripts/caesura-bplus-tree.mjs'
import {
  IDGEN_DEFAULTS,
  IDGEN_PROTOCOLS,
  IDGEN_SCENARIOS,
  createUuidV4,
  createSnowflake,
  createLeafSegment,
  btreePageSplitEvidence,
  runIdGenScenario,
  compareIdGen,
  idGenStudy,
  igSnapshot,
} from '../../scripts/caesura-idgen.mjs'

/** 固定时钟 + 固定随机：本件是确定性故障场景结构计数、非墙钟跑分，注入基线不影响任何判词。 */
const fixedNow = () => () => 1000
const fixedRand = () => {
  let x = 0x9e3779b9 >>> 0
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 }
}
const inj = () => ({ now: fixedNow(), rand: fixedRand() })
const numberCompare = (a: any, b: any) => Number(a) < Number(b) ? -1 : Number(a) > Number(b) ? 1 : 0
const riggedScenarios = () => IDGEN_SCENARIOS.map((s) => ({ id: s.id, label: s.label, fault: {} }))

describe('KI-509 分布式 ID 生成：UUIDv4 / Snowflake / Redis 号段三协议诚实权衡（以 KI-504 B+ 树索引为性能落点）', () => {
  it('① 缺省参数冻结、10 枚值导出齐全、三协议/六场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(IDGEN_DEFAULTS)).toBe(true)
    expect(IDGEN_PROTOCOLS.map((p) => p.short)).toEqual(['UUID', 'Snowflake', 'Segment'])
    expect(IDGEN_SCENARIOS.map((s) => s.id)).toEqual([
      'allOk', 'randomKeyInsert', 'clockBackward', 'centerDown', 'sequenceOverflow', 'segmentGap',
    ])
    for (const fn of [
      createUuidV4, createSnowflake, createLeafSegment, btreePageSplitEvidence,
      runIdGenScenario, compareIdGen, idGenStudy, igSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(IDGEN_DEFAULTS.sequenceBits).toBe(12)
    expect(IDGEN_DEFAULTS.segmentSize).toBeGreaterThanOrEqual(2)
    expect(IDGEN_DEFAULTS.treeOrder).toBeGreaterThanOrEqual(4)
    expect(IDGEN_DEFAULTS.seed).toBeGreaterThan(0)
  })

  /* ---------------- ① UUIDv4 ---------------- */
  it('② UUIDv4 本地生成：128 位、版本 4、变体位 10、全局唯一', () => {
    const c = createUuidV4(inj())
    const a = c.next(), b = c.next()
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a.version).toBe(4)
    expect(c.stats().bitLength).toBe(128)
    expect(c.stats().unique).toBe(2)
    expect(c.stats().distinctKeys).toBe(2)
    expect(a.id).not.toBe(b.id)
    expect(b.id).toMatch(/-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/) // 两枚都合规版本/变体位
  })
  it('③ UUIDv4 注入 rand 确定性：同种子双跑字节一致', () => {
    const a = createUuidV4(inj()), b = createUuidV4(inj())
    const idsA = Array.from({ length: 8 }, () => a.next().id)
    const idsB = Array.from({ length: 8 }, () => b.next().id)
    expect(idsA).toEqual(idsB)
  })
  it('④ UUIDv4 reset 归零、sequentialIds rigged 退化顺序主键', () => {
    const c = createUuidV4(inj())
    c.next(); c.next(); expect(c.issued).toBe(2)
    c.reset(); expect(c.issued).toBe(0)
    const seq = createUuidV4({ ...inj(), sequentialIds: true })
    expect(seq.next().key).toBe(1)
    expect(seq.next().key).toBe(2)
    expect(seq.sequentialIds).toBe(true)
  })

  /* ---------------- ② Snowflake ---------------- */
  it('⑤ Snowflake 真位布局：parse 反解 timestamp/workerId/sequence', () => {
    let t = 1000
    const c = createSnowflake({ ...inj(), now: () => t, workerId: 7 })
    const a = c.next()
    const p = c.parse(a.id!)!
    expect(p.timestamp).toBe(1000)
    expect(p.workerId).toBe(7)
    expect(p.sequence).toBe(0)
  })
  it('⑥ Snowflake 同毫秒 sequence 自增、跨毫秒重置', () => {
    let t = 1000
    const c = createSnowflake({ ...inj(), now: () => t })
    const a = c.next(), b = c.next()
    expect(b.sequence).toBe(a.sequence! + 1)
    expect(b.timestamp).toBe(a.timestamp)
    t = 1001
    const d = c.next()
    expect(d.sequence).toBe(0)
    expect(d.id!).toBeGreaterThan(b.id!)
  })
  it('⑦ Snowflake 墙钟回拨 ⇒ 保守停发（stalled/clockRollbacks），不产生重复', () => {
    let t = 1000
    const c = createSnowflake({ ...inj(), now: () => t })
    c.next()
    t = 999
    const r = c.next({ clockBackward: true })
    expect(r.stalled).toBe(true)
    expect(r.id).toBe(null)
    expect(c.stats().clockRollbacks).toBeGreaterThan(0)
    expect(c.stats().duplicates).toBe(0)
  })
  it('⑧ Snowflake forceDuplicate ⇒ 激进实现真发重复 ID（如实量代价、不粉饰）', () => {
    let calls = 0
    const c = createSnowflake({ ...inj(), now: () => (calls++ === 0 ? 100 : 99) })
    c.next()
    const r = c.next({ clockBackward: true, forceDuplicate: true })
    expect(r.duplicate).toBe(true)
    expect(c.stats().duplicates).toBeGreaterThan(0)
    expect(c.stats().unique).toBeLessThan(c.stats().issued)
  })
  it('⑨ Snowflake 同毫秒序列溢出 ⇒ 阻塞等下一毫秒（waits），ID 仍单调', () => {
    const c = createSnowflake({ ...inj(), now: () => 1000 })
    const a = c.next()
    const b = c.next({ sequenceOverflow: true })
    expect(c.stats().waits).toBeGreaterThan(0)
    expect(b.id!).toBeGreaterThan(a.id!)
  })

  /* ---------------- ③ Redis 号段 ---------------- */
  it('⑩ 号段段内严格递增、双 buffer 预热 fetch=2、构造期不计 RTT', () => {
    const c = createLeafSegment(inj())
    const a = c.next(), b = c.next()
    expect(a.id).toBe(1)
    expect(b.id).toBe(2)
    expect(c.stats().segmentsFetched).toBe(2)
    expect(c.stats().centerRounds).toBe(0) // 预热是资本支出、不计场景 RTT
  })
  it('⑪ 号段中心宕 + 双 buffer 耗尽 ⇒ 发号中断（stalled）', () => {
    const c = createLeafSegment({ ...inj(), segmentSize: 2 })
    let stalls = 0
    for (let i = 0; i < 12; i++) if (c.next({ centerDown: i >= 2 }).stalled) stalls++
    expect(stalls).toBeGreaterThan(0)
    expect(c.stats().stalled).toBeGreaterThan(0)
  })
  it('⑫ 号段重启段跳跃 ⇒ 未用段作废（wastedIds>0、不连续）但 ID 不重复', () => {
    const c = createLeafSegment({ ...inj(), segmentSize: 4 })
    for (let i = 0; i < 9; i++) c.next({ segmentGap: i % 3 === 0 })
    expect(c.stats().wastedIds).toBeGreaterThan(0)
    expect(c.stats().contiguous).toBe(false)
    expect(c.stats().unique).toBe(c.stats().issued) // 跳号浪费但唯一性没破
  })
  it('⑬ 号段不依赖本地墙钟：注入回拨时钟仍照常发号', () => {
    let t = 1000
    const c = createLeafSegment({ ...inj(), now: () => t, segmentSize: 4 })
    c.next(); t = 1  // 时钟倒退
    const r = c.next()
    expect(r.stalled).toBe(false)
    expect(r.id).toBe(2)
  })
  it('⑭ 号段取新段记中心 RTT（centerRounds）、restart reset 归零', () => {
    const c = createLeafSegment({ ...inj(), segmentSize: 2 })
    for (let i = 0; i < 6; i++) c.next()
    expect(c.stats().centerRounds).toBeGreaterThan(0)
    expect(c.stats().messages).toBe(c.stats().centerRounds)
    c.reset()
    expect(c.issued).toBe(0)
    expect(c.stats().centerRounds).toBe(0)
  })
  it('⑮ centerAvailable rigged ⇒ 号段不计 RTT、不计 stalled（可证伪注入开关生效）', () => {
    const c = createLeafSegment({ ...inj(), centerAvailable: true, segmentSize: 2 })
    for (let i = 0; i < 8; i++) c.next({ centerDown: i >= 2 })
    expect(c.stats().centerRounds).toBe(0)
    expect(c.stats().stalled).toBe(0)
  })

  /* ---------------- ④ B+ 树交叉印证（集大成铁证） ---------------- */
  it('⑯ 真 import createBPlusTree 可用：随机/顺序两株树都合法（validate 空集）', () => {
    const t = createBPlusTree({ compare: numberCompare, order: 8, leafCapacity: 8 })
    for (let i = 0; i < 24; i++) t.put(i, i)
    expect(t.validate()).toEqual([])
    expect(t.stats().size).toBe(24)
  })
  it('⑰ 索引代价铁证：真树随机主键定位比较 > 顺序主键（comparisons）', () => {
    const ev = btreePageSplitEvidence(inj())
    expect(ev.randomCmpGtSequential).toBe(true)
    expect(ev.randomCmp).toBeGreaterThan(ev.sequentialCmpBaseline)
  })
  it('⑱ 诚实反直觉读数：mid 分裂下随机主键 splits 反而更少（不粉饰成「随机伤索引」）', () => {
    const ev = btreePageSplitEvidence(inj())
    expect(ev.randomFewerSplits).toBe(true)
    expect(ev.random.splits).toBeLessThan(ev.sequential.splits)
  })
  it('⑲ sequentialIds rigged ⇒ 真树随机退化为顺序，索引代价判据翻红（comparisons 相等）', () => {
    const ev = btreePageSplitEvidence({ ...inj(), sequentialIds: true })
    expect(ev.randomCmpGtSequential).toBe(false)
    expect(ev.randomCmp).toBe(ev.sequentialCmpBaseline)
  })

  /* ---------------- ⑤ 对照矩阵 + 三难 ---------------- */
  it('⑳ 六场景 × 三协议矩阵：三难向量 011/110/101、三者互异、无一 111', () => {
    const cmp = compareIdGen(inj())
    expect(cmp.trilemmaVectors).toEqual({ UUID: '011', Snowflake: '110', Segment: '101' })
    expect(new Set(Object.values(cmp.trilemmaVectors)).size).toBe(3)
    expect(Object.values(cmp.trilemmaVectors).every((v) => v !== '111')).toBe(true)
    for (const p of cmp.protocols) {
      expect(Object.keys(cmp.matrix[p].scenarios).length).toBe(6)
    }
  })
  it('㉑ 判词逐条真（含真树铁证 + 反直觉读数）、noUniversalWinner 真', () => {
    const v = compareIdGen(inj()).verdict
    const keys: Array<keyof typeof v> = [
      'uuidRandomKeyIndexCost', 'uuidPaysIndexCost', 'uuidDecentralizedClockRobust',
      'snowflakeIndexFriendly', 'snowflakeDecentralized', 'snowflakeClockBackwardFatal',
      'segmentIndexFriendly', 'segmentClockRobust', 'segmentCenterDownStalls',
      'segmentPaysCenterRounds', 'segmentRestartGaps', 'randomCmpGtSequential',
      'randomFewerSplits', 'trilemmaDistinguishes', 'noProtocolWinsAll', 'noUniversalWinner',
    ]
    for (const k of keys) expect(v[k], k).toBe(true)
  })
  it('㉒ 故障映射诚实：三协议软肋各打各的、不打不相关格', () => {
    const cmp = compareIdGen(inj())
    // UUID：只有 randomKeyInsert 中索引软肋，其余五场景照常发号。
    const uuid = cmp.matrix.UUID.scenarios
    expect(uuid.randomKeyInsert.indexFriendly).toBe(false)
    for (const id of ['clockBackward', 'centerDown', 'sequenceOverflow', 'segmentGap']) {
      expect((uuid as any)[id].issued).toBeGreaterThan(0)
      expect((uuid as any)[id].stalled).toBe(0)
    }
    // Snowflake：clockBackward 停发，但 randomKeyInsert 索引友好、无中心依赖。
    expect(cmp.matrix.Snowflake.scenarios.clockBackward.stalled).toBeGreaterThan(0)
    expect(cmp.matrix.Snowflake.scenarios.randomKeyInsert.indexFriendly).toBe(true)
    // 号段：centerDown 停发，但 clockBackward 不中、randomKeyInsert 索引友好。
    expect(cmp.matrix.Segment.scenarios.centerDown.stalled).toBeGreaterThan(0)
    expect(cmp.matrix.Segment.scenarios.clockBackward.stalled).toBe(0)
    expect(cmp.matrix.Segment.scenarios.randomKeyInsert.indexFriendly).toBe(true)
  })
  it('㉓ rigged 可证伪：抹掉三类软肋 ⇒ 三协议全退化 111、三判词同时翻 false', () => {
    const cmp = compareIdGen({
      ...inj(), sequentialIds: true, centerAvailable: true, nodes: ['redis-a'], scenarios: riggedScenarios(),
    })
    expect(cmp.trilemmaVectors).toEqual({ UUID: '111', Snowflake: '111', Segment: '111' })
    expect(cmp.verdict.trilemmaDistinguishes).toBe(false)
    expect(cmp.verdict.noProtocolWinsAll).toBe(false)
    expect(cmp.verdict.noUniversalWinner).toBe(false)
  })
  it('㉔ runIdGenScenario 单协议单场景形状齐、未知协议回落 UUID', () => {
    const r = runIdGenScenario({ ...inj(), protocol: 'Snowflake', scenario: { id: 'clockBackward', label: '回拨', fault: { at: 'clockBackward' } } })
    expect(r.protocol).toBe('Snowflake')
    expect(r.stalled).toBeGreaterThan(0)
    const fallback = runIdGenScenario({ ...inj(), protocol: 'bogus', scenario: { id: 'allOk', fault: {} } })
    expect(fallback.protocol).toBe('UUID')
  })

  /* ---------------- ⑥ study / snapshot / 降级 / 确定性 ---------------- */
  it('㉕ idGenStudy：27 枚 verdict 全真、三探针 + 真树证据、builtAt 走注入时钟', () => {
    const s = idGenStudy({ ...inj(), now: () => 4242 })
    expect(Object.values(s.verdict).every((v) => v === true)).toBe(true)
    expect(s.uuid.globallyUnique).toBe(true)
    expect(s.snowflake.parseRoundTrip).toBe(true)
    expect(s.segment.segmentMonotonic).toBe(true)
    expect(s.btree.randomCmpGtSequential).toBe(true)
    expect(s.builtAt).toBe(4242)
  })
  it('㉖ igSnapshot 纯数据：三行 × 六场景 + 三难 + 真树证据、JSON 往返一致', () => {
    const snap = igSnapshot(idGenStudy(inj()))
    expect(snap).not.toBe(null)
    expect(snap!.rows.length).toBe(3)
    expect(snap!.config.scenarios.length).toBe(6)
    expect(snap!.rows[0].scenarios.length).toBe(6)
    expect(snap!.btree.randomCmpGtSequential).toBe(true)
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
  it('㉗ igSnapshot(null/undefined) 诚实降级为 null（不连坐其它维）', () => {
    expect(igSnapshot(null)).toBe(null)
    expect(igSnapshot(undefined)).toBe(null)
  })
  it('㉘ 注入确定性：同注入双跑 study 的 snapshot 逐字一致', () => {
    const a = igSnapshot(idGenStudy(inj()))
    const b = igSnapshot(idGenStudy(inj()))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('㉙ 注入现成 study：idGenStudy 可注入 fixedRand 复现，双跑页代价读数一致', () => {
    const cmpA = compareIdGen(inj()), cmpB = compareIdGen(inj())
    expect(cmpA.trilemmaVectors).toEqual(cmpB.trilemmaVectors)
    expect(btreePageSplitEvidence(inj()).randomCmp).toBe(btreePageSplitEvidence(inj()).randomCmp)
  })
})
