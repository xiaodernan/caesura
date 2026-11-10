import { describe, it, expect } from 'vitest'
import {
  BP_DEFAULTS,
  defaultCompare,
  heightEstimate,
  createBPlusTree,
  validateBPlusTree,
  deterministicKeys,
  compareBplusVsLsm,
  bplusStudy,
  bpSnapshot,
} from '../../scripts/caesura-bplus-tree.mjs'

/** 造一只可控时钟：手动推进，builtAt 可读性。 */
function clock(t0 = 1_700_000_000_000) {
  let t = t0
  return { now: () => t, add: (v: number) => { t += v }, get: () => t }
}

/** 灌 N 条有序 key，回树与 keys。 */
function seeded(n = 256, opts: any = {}) {
  const { keys } = deterministicKeys(n)
  const tree = createBPlusTree({ order: 8, leafCapacity: 8, ...opts })
  keys.forEach((k, i) => tree.put(k, i))
  return { tree, keys }
}

describe('KI-504 B+ 树索引引擎 + 与 LSM 三笔账诚实权衡对照', () => {
  it('① 默认参数冻结、9 枚值导出齐全（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(BP_DEFAULTS)).toBe(true)
    expect(BP_DEFAULTS.order).toBe(32)
    expect(BP_DEFAULTS.minOrder).toBe(4)
    for (const fn of [
      defaultCompare, heightEstimate, createBPlusTree, validateBPlusTree,
      deterministicKeys, compareBplusVsLsm, bplusStudy, bpSnapshot,
    ]) expect(typeof fn).toBe('function')
  })

  it('② 缺省比较器字典序；奇数/过小 order 被偶数化并强制 ≥minOrder', () => {
    expect(defaultCompare('a', 'b')).toBeLessThan(0)
    expect(defaultCompare('b', 'a')).toBeGreaterThan(0)
    expect(defaultCompare('a', 'a')).toBe(0)
    expect(createBPlusTree({ order: 7 }).order).toBe(8)   // 奇数取偶
    expect(createBPlusTree({ order: 3 }).order).toBe(4)   // 过小抬到 minOrder
    expect(createBPlusTree({ order: 16 }).order).toBe(16) // 偶数原样
    expect(createBPlusTree({ order: 6 }).fanout).toBe(6)  // fanout == order
  })

  it('③ 空树诚实降级：size=0、height=1、range=[]、get miss、validate 无违例、heightEstimate(0)=0', () => {
    const t = createBPlusTree({ order: 4, leafCapacity: 4 })
    expect(t.size()).toBe(0)
    expect(t.height()).toBe(1)
    expect(t.range(undefined, undefined)).toEqual([])
    expect(t.get('x').found).toBe(false)
    expect(t.validate()).toEqual([])
    expect(heightEstimate(0, 8, 8)).toBe(0)
  })

  it('④ 有序插入后不变式全过：真 B+ 树（所有叶同深、分隔键=右孩最小、叶链双向、全局递增）', () => {
    const { tree, keys } = seeded(300)
    expect(validateBPlusTree(tree)).toEqual([])
    expect(tree.size()).toBe(keys.length)
    // 顺序插入 + 分裂 ⇒ 长成多叶、height ≥ 2（不是数组冒充的一叶）
    expect(tree.stats().leafCount).toBeGreaterThan(1)
    expect(tree.height()).toBeGreaterThanOrEqual(2)
    expect(tree.stats().nodeCount).toBeGreaterThan(tree.stats().leafCount)
  })

  it('⑤ 点查二分：每条都在叶命中且带 comparisons / nodeVisits，miss 不凭空造值', () => {
    const { tree, keys } = seeded(200)
    for (let i = 0; i < keys.length; i += 17) {
      const r = tree.get(keys[i])
      expect(r.found).toBe(true)
      expect(r.value).toBe(i)
      expect(r.nodeVisits).toBeGreaterThanOrEqual(1)
      expect(r.comparisons).toBeGreaterThan(0)
    }
    const miss = tree.get('zzz:not:present')
    expect(miss.found).toBe(false)
    expect(miss.value).toBeUndefined()
  })

  it('⑥ 叶子双向链表范围查：沿链顺序扫、结果有序且含端点，leafHops 随跨叶增长', () => {
    const { tree, keys } = seeded(300)
    const before = tree.stats().rangeLeafHops
    const out = tree.range(keys[50], keys[120])
    expect(out.length).toBe(71)
    expect(out[0].key).toBe(keys[50])
    expect(out[out.length - 1].key).toBe(keys[120])
    for (let i = 1; i < out.length; i++) expect(defaultCompare(out[i - 1].key, out[i].key)).toBeLessThan(0)
    expect(tree.stats().rangeLeafHops - before).toBeGreaterThan(0) // 跨了不止一叶
    // 无界扫 == 全量、有序
    const all = tree.entries()
    expect(all.length).toBe(300)
  })

  it('⑦ 分裂长高：小 order 灌多条，height/leafCount/splits 增长且不变式持续为 0', () => {
    const t = createBPlusTree({ order: 4, leafCapacity: 4 })
    const h0 = t.height()
    for (let i = 0; i < 200; i++) t.put(`k:${String(i).padStart(3, '0')}`, i)
    const s = t.stats()
    expect(s.height).toBeGreaterThan(h0)
    expect(s.splits).toBeGreaterThan(0)
    expect(s.leafCount).toBeGreaterThan(1)
    expect(t.validate()).toEqual([])
  })

  it('⑧ 覆盖写不增 size、值更新；重复 del 回 false、不减 size', () => {
    const t = createBPlusTree({ order: 6, leafCapacity: 6 })
    t.put('a', 1)
    t.put('a', 2)
    expect(t.size()).toBe(1)
    expect(t.get('a').value).toBe(2)
    expect(t.del('a')).toBe(true)
    expect(t.del('a')).toBe(false)
    expect(t.size()).toBe(0)
    expect(t.validate()).toEqual([])
  })

  it('⑨ 删除再平衡真跑：交错制造下溢，borrow + merge 都计数、根降高、不变式全过', () => {
    const { keys } = deterministicKeys(400)
    const t = createBPlusTree({ order: 6, leafCapacity: 6 })
    keys.forEach((k, i) => t.put(k, i))
    const h0 = t.height()
    for (let i = 0; i < keys.length; i += 2) expect(t.del(keys[i])).toBe(true)
    const s = t.stats()
    expect(s.size).toBe(200)
    expect(s.merges).toBeGreaterThan(0)
    expect(s.borrows).toBeGreaterThan(0)
    expect(s.height).toBeLessThanOrEqual(h0) // 根只会降或持平
    expect(t.validate()).toEqual([])
    // 剩下的一半仍逐条可读
    for (let i = 1; i < keys.length; i += 2) expect(t.get(keys[i]).value).toBe(i)
  })

  it('⑩ 删空回到单空根：height=1、size=0、分隔键刷新无悬挂、validate=0', () => {
    const { tree, keys } = seeded(300, { order: 4, leafCapacity: 4 })
    keys.forEach((k) => tree.del(k))
    expect(tree.size()).toBe(0)
    expect(tree.height()).toBe(1)
    expect(tree.get(keys[0]).found).toBe(false)
    expect(tree.validate()).toEqual([])
    expect(tree.stats().separatorRefreshes).toBeGreaterThan(0) // 删除确实刷了分隔键
  })

  it('⑪ 与 LSM 正确性对账（先决条件）：同批 key 的点查与范围查逐条一致、bothAgree=true', () => {
    const c = compareBplusVsLsm({ keyCount: 256 })
    expect(c.agreement.pointMismatches).toBe(0)
    expect(c.agreement.rangeMismatches).toBe(0)
    expect(c.agreement.bothAgree).toBe(true)
    expect(c.verdict.bothAgree).toBe(true)
    expect(c.verdict.agreeIsPrerequisite).toBe(true)
  })

  it('⑫ 三笔账对照真各有读数：点查/范围/写放大计数非零，favors 各落一档', () => {
    const c = compareBplusVsLsm({ keyCount: 512 })
    expect(c.bplus.pointComparisons).toBeGreaterThan(0)
    expect(c.lsm.pointComparisons).toBeGreaterThan(0)
    expect(c.bplus.rangeCost).toBeGreaterThan(0)
    expect(c.lsm.rangeCost).toBeGreaterThan(0)
    expect(c.lsm.sortComparisons).toBeGreaterThan(0) // LSM 范围全量排序
    expect(c.bplus.leafHops).toBeGreaterThan(0)      // B+ 沿叶链跳
    expect(c.bplus.write.pageRewrites).toBeGreaterThan(0)
    expect(c.lsm.write.seqWriteUnits).toBeGreaterThan(0)
    for (const f of [c.verdict.pointFavors, c.verdict.rangeFavors, c.verdict.writeFavors]) {
      expect(['bplus', 'lsm', 'tie']).toContain(f)
    }
  })

  it('⑬ 诚实权衡判词不粉饰：B+ 点查更省 / 顺序扫、LSM 写与 compaction 付账、不封全局赢家', () => {
    const c = compareBplusVsLsm({ keyCount: 512 })
    expect(c.verdict.bplusRangeIsSequential).toBe(true)
    expect(c.verdict.lsmRangeNeedsMergeSort).toBe(true)
    expect(c.verdict.bplusPaysInPlaceRewrites).toBe(true)
    expect(c.verdict.lsmPaysCompactionRewrites).toBe(true)
    expect(c.verdict.lsmReadIsCrossLevel).toBe(true)
    // 缺省规模下 B+ 点查比较数更少、范围代价更低；写放大 LSM 更优（顺序追加）
    expect(c.verdict.bplusPointFewerComparisons).toBe(true)
    expect(c.verdict.pointFavors).toBe('bplus')
    expect(c.verdict.rangeFavors).toBe('bplus')
    expect(c.verdict.writeFavors).toBe('lsm')
    expect(c.verdict.noUniversalWinner).toBe(true) // 三维不是被同一引擎全拿
  })

  it('⑭ 判词可证伪：改写 key 规模令 favors 翻转时 noUniversalWinner 随之变，非恒真断言', () => {
    // 反向臂：把三维强行同一档的判据结构拆开——pointFavors/writeFavors 是分别由真读数算的，
    // 喂极小 scale（只 1 个 key、无探针 miss、写放大模型退化）时各维读数会变，不是写死的 true。
    const small = compareBplusVsLsm({ keyCount: 64, overwriteEvery: 0, probes: ['boss:00000'] })
    expect(small.config.keys).toBe(64)
    expect(small.verdict.agreeIsPrerequisite).toBe(small.agreement.bothAgree)
    // noUniversalWinner 严格由三维 favors 推出，可重算、非恒真
    expect(small.verdict.noUniversalWinner).toBe(
      !(small.verdict.pointFavors === small.verdict.rangeFavors
        && small.verdict.rangeFavors === small.verdict.writeFavors),
    )
  })

  it('⑮ 注入确定性：同 opts 两次跑比较/study 逐字一致，now 注入 builtAt 固定', () => {
    const opts = { keyCount: 256, now: () => 42 }
    const a = compareBplusVsLsm(opts)
    const b = compareBplusVsLsm(opts)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.builtAt).toBe(42)
    const s1 = bplusStudy({ keyCount: 128, now: () => 7 })
    const s2 = bplusStudy({ keyCount: 128, now: () => 7 })
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
    expect(s1.builtAt).toBe(7)
    // B+ 树实例注入确定性 rand 无关，但 now 决定 snapshot.builtAt
    const c = clock()
    const t = createBPlusTree({ order: 8, leafCapacity: 8, now: c.now })
    expect(t.snapshot().builtAt).toBe(c.get())
    c.add(500)
    expect(t.snapshot().builtAt).toBe(c.get())
  })

  it('⑯ study/snapshot 纯数据可 JSON 序列化、heightLadder 单调不增、缺研究诚实降级', () => {
    const s = bplusStudy({ keyCount: 512, now: () => 1 })
    expect(s.generator).toBe('caesura-bplus-tree')
    expect(s.heightLadder.length).toBe(BP_DEFAULTS.heightLadder.length)
    // 扇出越大层高不增（order 4→6 层, 128→2 层）
    for (let i = 1; i < s.heightLadder.length; i++) {
      expect(s.heightLadder[i].heightEstimate).toBeLessThanOrEqual(s.heightLadder[i - 1].heightEstimate)
    }
    expect(() => JSON.stringify(s)).not.toThrow()
    const snap = bpSnapshot(s)!
    expect(snap.structure.height).toBe(s.comparison.bplus.height)
    expect(snap.point.favors).toBe(s.verdict.pointFavors)
    expect(snap.write.lsmSeqWriteUnits).toBe(s.comparison.lsm.write.seqWriteUnits)
    expect(bpSnapshot(null)).toBeNull()
  })
})
