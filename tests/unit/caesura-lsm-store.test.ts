import { describe, expect, it } from 'vitest'
import {
  defaultCompare,
  defaultBaseHashes,
  createSkipList,
  createBloomFilter,
  createWal,
  createSSTable,
  createLsmStore,
} from '../../scripts/caesura-lsm-store.mjs'

/** 确定性 LCG，替代 Math.random 抛硬币 ⇒ 跳表层数可复现。 */
function lcg(seed = 1) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

function seedStore(opts: any = {}, keys = 200) {
  const store = createLsmStore({ memtableMax: 16, levelMultiplier: 2, rand: lcg(11), ...opts })
  for (let i = 0; i < keys; i++) store.put('k' + i, i)
  return store
}

describe('caesura-lsm-store (KI-496)', () => {
  // ——— ① memtable 概率跳表 ———
  it('① 跳表：put 后 entries 全局有序、range 闭区间、size/覆盖语义正确', () => {
    const sl = createSkipList({ maxLevel: 4, p: 0.5, rand: lcg(1) })
    for (const k of ['c', 'a', 'b', 'e', 'd']) sl.put(k, k)
    expect(sl.size()).toBe(5)
    expect(sl.entries().map((e) => e.key)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(sl.range('b', 'd').map((e) => e.key)).toEqual(['b', 'c', 'd'])
    expect(sl.range(undefined, 'c').map((e) => e.key)).toEqual(['a', 'b', 'c'])
    expect(sl.range('d', undefined).map((e) => e.key)).toEqual(['d', 'e'])
    // 同 key 覆盖：size 不增，值/seq 更新为最新。
    sl.put('c', 'C2', 99)
    expect(sl.size()).toBe(5)
    expect(sl.get('c')).toMatchObject({ value: 'C2', seq: 99 })
  })

  it('② 跳表：层数由注入 rand 抛硬币定、有上界、期望 O(log n)（比较数远小于 n）', () => {
    const sl = createSkipList({ maxLevel: 8, p: 0.5, rand: lcg(1) })
    const n = 1000
    for (let i = 0; i < n; i++) sl.put('k' + String(i).padStart(4, '0'), i)
    expect(sl.currentLevel).toBeGreaterThanOrEqual(1)
    expect(sl.currentLevel).toBeLessThanOrEqual(8)
    const before = sl.stats().comparisons
    sl.get('k0500')
    const perGet = sl.stats().comparisons - before
    expect(perGet).toBeLessThan(40) // log2(1000)≈10，含扫描常数也远小于线性 1000
  })

  it('③ 跳表：del 写 tombstone 而非物理摘链，get 能读到删除标记', () => {
    const sl = createSkipList()
    sl.put('x', 1, 1)
    sl.del('x', 2)
    expect(sl.size()).toBe(1) // tombstone 仍占位
    expect(sl.get('x')).toMatchObject({ tombstone: true, seq: 2 })
  })

  // ——— ② Bloom filter ———
  it('④ Bloom：零假阴性硬保证（add 过的可能在，绝不在的判 false）', () => {
    const bf = createBloomFilter({ numKeys: 200, bitsPerKey: 12, k: 4 })
    for (let i = 0; i < 200; i++) bf.add('k' + i)
    for (let i = 0; i < 200; i++) expect(bf.mightHave('k' + i)).toBe(true)
    expect(bf.stats().negatives).toBe(0)
  })

  it('⑤ Bloom：假阳性有界、estimatedFpRate 与位数组参数相连、注入哈希可复现', () => {
    const bf = createBloomFilter({ numKeys: 100, bitsPerKey: 10, k: 3 })
    for (let i = 0; i < 100; i++) bf.add('k' + i)
    let fp = 0
    for (let i = 100; i < 200; i++) if (bf.mightHave('k' + i)) fp++
    expect(fp).toBeLessThan(20) // 10 bits/key、k=3 理论 ≈1.7%，宽松上界防抖动
    expect(bf.stats().falsePositives).toBe(fp)
    expect(bf.estimatedFpRate()).toBeGreaterThan(0)
    expect(bf.estimatedFpRate()).toBeLessThan(0.1)
    const s = bf.stats()
    expect(s.bits).toBe(bf.m)
    expect(s.k).toBe(bf.numHashes)
    // 相同注入哈希 + 相同序列 ⇒ 相同判定（确定性）。
    const mk = () => {
      const b = createBloomFilter({ numKeys: 100, bitsPerKey: 10, k: 3 })
      for (let i = 0; i < 100; i++) b.add('k' + i)
      return b
    }
    expect(mk().mightHave('k77')).toBe(mk().mightHave('k77'))
  })

  it('⑥ 缺省双哈希：defaultBaseHashes 稳定、两只哈希不同、defaultCompare 三态', () => {
    expect(defaultBaseHashes('boss:1')).toEqual(defaultBaseHashes('boss:1'))
    expect(defaultBaseHashes('boss:1')).not.toEqual(defaultBaseHashes('boss:2'))
    expect(defaultCompare('a', 'b')).toBe(-1)
    expect(defaultCompare('b', 'a')).toBe(1)
    expect(defaultCompare('a', 'a')).toBe(0)
  })

  // ——— ③ WAL ———
  it('⑦ WAL：append 顺序递增 seq、sink 落行、replay 按序、lines 可跨实例恢复', () => {
    const lines: string[] = []
    const wal = createWal({ sink: lines })
    wal.append('put', 'a', 1)
    wal.append('put', 'b', 2)
    wal.append('del', 'a', undefined)
    expect(lines).toHaveLength(3)
    expect(wal.lastSeq).toBe(3)
    const seen: string[] = []
    expect(wal.replay((r) => seen.push(`${r.seq}:${r.op}:${r.key}`))).toBe(3)
    expect(seen).toEqual(['1:put:a', '2:put:b', '3:del:a'])
    // 跨实例：restore 后重放得到同序列。
    const wal2 = createWal()
    expect(wal2.restore(lines)).toBe(3)
    const seqs: number[] = []
    wal2.replay((r) => seqs.push(r.seq))
    expect(seqs).toEqual([1, 2, 3])
    expect(wal2.lastSeq).toBe(3)
  })

  it('⑧ WAL：replay 回调抛错即中断（崩溃恢复不吞错）', () => {
    const wal = createWal()
    wal.append('put', 'a', 1)
    wal.append('put', 'b', 2)
    let n = 0
    expect(() => wal.replay(() => { n++; if (n === 1) throw new Error('disk fail') })).toThrow('disk fail')
    expect(n).toBe(1)
  })

  // ——— ④ SSTable ———
  it('⑨ SSTable：有序建段、稀疏索引点查命中、区间外/Bloom 负查零探测', () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ key: 'k' + String(i).padStart(3, '0'), value: i, seq: i, tombstone: false }))
    const t = createSSTable(entries, { indexEvery: 8 })
    expect(t.size).toBe(40)
    expect(t.minKey).toBe('k000')
    expect(t.maxKey).toBe('k039')
    expect(t.stats().indexBlocks).toBe(5) // 每 8 条一锚点
    const r = t.get('k025')
    expect(r.found).toBe(true)
    expect(r.entry?.value).toBe(25)
    expect(r.probes).toBe(1)
    // 区间外：仅 2 次边界比较即剪枝、0 段探测（不该进稀疏索引/Bloom）。
    const out = t.get('zzz')
    expect(out.found).toBe(false)
    expect(out.probes).toBe(0)
    expect(out.comparisons).toBeLessThanOrEqual(2)
    // 区间内但不存在：过 Bloom，若被拒则 0 探测。
    const miss = t.get('k999')
    expect(miss.found).toBe(false)
    if (miss.bloomRejected) expect(miss.probes).toBe(0)
  })

  it('⑩ SSTable：build 时防御性去重（同 key 取 seq 最大）、serializable 是纯数据', () => {
    const t = createSSTable([
      { key: 'a', value: 'old', seq: 1, tombstone: false },
      { key: 'a', value: 'new', seq: 9, tombstone: false },
      { key: 'b', value: 2, seq: 2, tombstone: false },
    ], {})
    expect(t.size).toBe(2)
    expect(t.get('a').entry?.value).toBe('new')
    const snap = t.serializable()
    expect(snap.entries).toHaveLength(2)
    expect(() => JSON.stringify(snap)).not.toThrow()
    expect(snap.level).toBe(0)
  })

  it('⑪ SSTable：range 闭区间顺序扫、Bloom.mightHave 拦截', () => {
    const t = createSSTable([
      { key: 'a', value: 1, seq: 1, tombstone: false },
      { key: 'b', value: 2, seq: 2, tombstone: false },
      { key: 'c', value: 3, seq: 3, tombstone: false },
    ], {})
    expect(t.range('a', 'b').map((e) => e.key)).toEqual(['a', 'b'])
    expect(t.range(undefined, 'b').map((e) => e.key)).toEqual(['a', 'b'])
    expect(t.mightHave('a')).toBe(true)
  })

  // ——— ⑤+⑥ LSM 引擎 ———
  it('⑫ 写读路径：put→自动 flush 成段→get 命中；stats 记 flushes/levels 真值', () => {
    const st = createLsmStore({ memtableMax: 8, levelMultiplier: 4, rand: lcg(3) })
    for (let i = 0; i < 40; i++) st.put('k' + i, i * 10)
    const s = st.stats()
    expect(s.flushes).toBeGreaterThanOrEqual(4) // 40/8
    expect(s.writes).toBe(40)
    expect(s.levels[0].segments + s.levels[1].segments).toBeGreaterThan(0)
    expect(st.get('k7').value).toBe(70)
    expect(st.get('k39').value).toBe(390)
  })

  it('⑬ 最后写者赢 + tombstone 遮蔽：新版本覆盖旧版本、del 后 get 不复活', () => {
    const st = createLsmStore({ memtableMax: 2, levelMultiplier: 10, rand: lcg(7) })
    st.put('a', 'v1')
    st.put('a', 'v2')
    expect(st.get('a').value).toBe('v2')
    st.flush()
    st.del('a')
    st.flush()
    expect(st.get('a').found).toBe(false) // tombstone 遮蔽 v2
    // 跨层：旧版本进最深层后再删，compaction 不让它复活。
    const st2 = createLsmStore({ memtableMax: 2, levelMultiplier: 1, rand: lcg(7) })
    st2.put('x', 'OLD'); st2.flush(); st2.compact()
    st2.put('x', 'NEW'); st2.flush()
    st2.del('x'); st2.flush()
    expect(st2.get('x').found).toBe(false)
    st2.compact()
    expect(st2.get('x').found).toBe(false) // 深层 tombstone 丢弃后旧版本仍不复活
    expect(st2.stats().tombstonesDropped).toBeGreaterThan(0)
  })

  it('⑭ compaction：相邻层归并去重、mergedAway 记旧版本、输出段落到更深层', () => {
    // levelMultiplier 给大，避免 put 期间自动 compact；手动 flush 出多段再显式 compact。
    const st = seedStore({ memtableMax: 8, levelMultiplier: 100 }, 60)
    st.flush()
    const before = st.stats()
    expect(before.levels[0].segments).toBeGreaterThan(1) // L0 已堆多段
    const results = st.compact()
    const after = st.stats()
    expect(results.length).toBeGreaterThan(0)
    expect(after.compactions).toBeGreaterThan(before.compactions)
    expect(after.mergedAway).toBeGreaterThanOrEqual(0)
    expect(results[0]).toMatchObject({ from: 0, to: 1 })
    expect(results[0].inputEntries).toBeGreaterThan(0)
    expect(results[0].outputEntries).toBeLessThanOrEqual(results[0].inputEntries)
    // 归并后 L0 清空、数据落到更深层，且读数不丢。
    expect(after.levels[0].segments).toBe(0)
    expect(after.levels.slice(1).reduce((n, l) => n + l.entries, 0)).toBe(60)
  })

  it('⑮ 性能证据：compareScan 的 scanBaselineComparisons 显著大于 lsmComparisons、speedup>1', () => {
    const st = seedStore({ memtableMax: 16, levelMultiplier: 2 }, 300)
    st.flush()
    st.compact()
    const probes = Array.from({ length: 80 }, (_, i) => 'k' + (i * 3))
    const cmp = st.compareScan(probes)
    expect(cmp.keys).toBe(80)
    expect(cmp.hits).toBe(80)
    expect(cmp.scanComparisons).toBeGreaterThan(cmp.lsmComparisons) // 线性扫描基线更大
    expect(cmp.speedup).toBeGreaterThan(1)
    const s = st.stats()
    expect(s.scanBaselineComparisons).toBeGreaterThan(s.comparisons)
    expect(s.speedup).toBeGreaterThan(1)
  })

  it('⑯ Bloom 负查省段探测：区间内不存在的 key 令 bloomRejects 增长、点查比较数不爆炸', () => {
    const st = seedStore({ memtableMax: 16, levelMultiplier: 2 }, 200)
    st.flush()
    st.compact()
    // 用同前缀、落在 [k000,k199] 区间内但不存在的 key ⇒ 必过 Bloom 且被拒（0 段探测）。
    const cmp = st.compareScan(['k0x', 'k1x', 'k0050x', 'k199x', 'k099x'])
    expect(cmp.hits).toBe(0)
    expect(cmp.misses).toBe(5)
    expect(cmp.bloomRejects).toBeGreaterThan(0)
    expect(cmp.lsmComparisons).toBeLessThan(20) // 每查 ≤ 2 次边界比较，不进稀疏索引
    expect(st.stats().bloomRejects).toBeGreaterThan(0)
  })

  it('⑰ WAL 崩溃恢复：跨实例 restore 行重建 memtable、put/del 判词一致', () => {
    const lines: string[] = []
    const st = createLsmStore({ memtableMax: 1000, sink: lines, rand: lcg(5) })
    st.put('a', 1)
    st.put('b', 2)
    st.del('a')
    // 模拟崩溃：新实例用同一批 WAL 行恢复（未 flush，全靠 WAL）。
    const recovered = createLsmStore({ memtableMax: 1000, rand: lcg(5) })
    expect(recovered.recover(lines)).toBeGreaterThan(0)
    expect(recovered.get('a').found).toBe(false)
    expect(recovered.get('b').value).toBe(2)
  })

  it('⑱ range 范围查：跨 memtable 与多段聚组取最新、滤 tombstone、按 key 有序', () => {
    const st = createLsmStore({ memtableMax: 3, levelMultiplier: 4, rand: lcg(9) })
    for (const [k, v] of [['b', 2], ['a', 1], ['d', 4], ['c', 3], ['e', 5]] as [string, number][]) st.put(k, v)
    st.del('c')
    const all = st.range('a', 'e')
    expect(all.map((e) => e.key)).toEqual(['a', 'b', 'd', 'e']) // c 被删、全局有序
    expect(st.range('b', 'd').map((e) => e.key)).toEqual(['b', 'd'])
  })

  it('⑲ snapshot 只回结构读数、builtAt 取注入时钟、不夹带每行真值', () => {
    let t = 1000
    const st = createLsmStore({ memtableMax: 8, rand: lcg(2), now: () => (t += 1) })
    for (let i = 0; i < 20; i++) st.put('k' + i, i)
    const snap = st.snapshot()
    expect(snap.builtAt).toBeGreaterThan(1000)
    expect(snap).toMatchObject({ writes: 20 })
    expect(snap).not.toHaveProperty('entries')
    expect(Array.isArray(snap.levels)).toBe(true)
    expect(() => JSON.stringify(snap)).not.toThrow()
  })

  it('⑳ 判定权在 Node 侧：比较器/层乘数/位数全可注入，自定义 key 类型可跑', () => {
    // 数值 key + 数值比较器 ⇒ 跳表/段/引擎都能排。
    const cmp = (a: number, b: number) => a - b
    const sl = createSkipList({ compare: cmp })
    for (const n of [10, 2, 7, 1]) sl.put(n, n * 100)
    expect(sl.entries().map((e) => e.key)).toEqual([1, 2, 7, 10])
    const st = createLsmStore({ compare: cmp, memtableMax: 2, levelMultiplier: 4 })
    for (const n of [5, 3, 9, 1]) st.put(n, n)
    st.flush()
    expect(st.get(3).value).toBe(3)
    expect(st.range(1, 5).map((e) => e.key)).toEqual([1, 3, 5])
  })
})
