import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * scripts/caesura-lsm-store.mjs —— LSM 风格存储引擎（P8 第四件，KI-496）。
 *
 * <p>落的是「数据库性能的合理运用」这件事本身：集大成主线把缓存（KI-493 内存 LRU）、
 * 计网、路由、鉴权做厚，却从没有一只持久化存储引擎。本件用零依赖、可注入、可确定性测的
 * 纯 JS 实现，把数据库内核的六件核心数据结构/算法收口成一条可断言的写读路径：
 * <b>memtable 概率跳表 → WAL 预写日志 → 不可变 SSTable（稀疏索引 + Bloom filter）
 * → leveled compaction 归并去重 → 点查/范围查 → 与线性扫描对照的性能证据</b>。</p>
 *
 * <p>设计取舍（判定权仍在 Node 侧，决策原则①）：maxLevel/p、Bloom 的 m/k 与哈希、
 * WAL sink、比较器、compaction 阈值/层乘数、时钟全由 opts 注入；本件只跑数据结构状态机与
 * 计数，不写任何业务阈值。与真 RocksDB/LevelDB/SQLite 无运行时依赖——无真实文件 I/O、
 * 无页缓存、无块设备对齐，`sink` 只是调用方给的「模拟落盘」收集器。</p>
 *
 * <p>为什么写多读少用 LSM 而非 B+ 树：B+ 树原地改页 ⇒ 随机写放大；LSM 把随机写转成
 * 「顺序追加 WAL + 内存跳表 + 顺序 flush 成不可变段」，用**顺序写**适配硬盘/SSD，
 * 代价是**读放大**（一个 key 可能要查多个段）与**空间放大**（待 compaction 回收）。
 * Bloom filter 就是把读放大压回去的关键：一个段若 Bloom 判「不在」，点查连二分都不做
 * （0 次段探测）。本件把这三笔账（comparisons / probes / mergedAway）都记进 stats，
 * 并给 `scanBaselineComparisons`（同一批 key 线性扫描的比较数）与 `speedup` 对照读数，
 * 让「点查少比较几倍」成为可断言判词，而不是一句口号。</p>
 *
 * 用法：
 *   const store = createLsmStore({ memtableMax: 64, levelMultiplier: 4 })
 *   store.put('boss:1', { hp: 100 })
 *   store.put('boss:2', { hp: 80 })
 *   store.del('boss:1')                 // 写 tombstone，不立刻抹数据
 *   store.flush()                       // memtable → L0 SSTable
 *   store.compact()                     // 相邻层归并去重、深层的 tombstone 可丢弃
 *   store.get('boss:2')                 // → { found:true, value:{hp:80}, ... }
 *   store.stats()                       // → { writes, reads, compactions, comparisons,
 *                                       //     scanBaselineComparisons, speedup, levels, ... }
 *   const c = store.compareScan([...keys]) // 一批 key 的 LSM vs 线性扫描对照证据
 */

/** 缺省比较器：按字符串字典序（key 缺省为 string；非 string key 请注入 `compare`）。 */
export function defaultCompare(a, b) {
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** FNV-1a：缺省双哈希的第一只（32 位无符号）。 */
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** djb2：缺省双哈希的第二只（与 FNV-1a 独立，供 double hashing）。 */
function djb2(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0
  }
  return h >>> 0
}

/** 缺省双哈希：返回一个 key 的两只独立 32 位哈希，供 Bloom double hashing 展开成 k 个位置。 */
export function defaultBaseHashes(key) {
  const s = String(key)
  return [fnv1a(s), djb2(s)]
}

/**
 * ① 概率跳表 —— 当 memtable（内存中有序表）。
 *
 * <p>为什么不是平衡树：跳表插入/删除只改局部 forward 指针、无需旋转/再平衡，
 * 概率层数由注入 `rand()` 抛硬币决定，实现短且期望 O(log n)；`compare` 可注入 ⇒
 * 任意 key 类型都能排。节点带 `forward[]`（每层一个后继）与 `span` 无关（教学不做 rank），
 * `get/put/del` 期望 O(log n)、`range` 为 O(log n + k)、`entries` 为 O(n) 顺序扫。</p>
 *
 * <p>删除不物理摘链，而是**覆盖成 tombstone entry**（`{key, value:undefined, seq, tombstone:true}`）——
 * 这是 LSM 的核心：删除也是一次写入，真正抹数据留到 compaction。同 key 的多次写只留
 * seq 最大那一条（最后写者赢），故 memtable 内 key 唯一、flush 出的段内 key 也唯一。</p>
 */
export function createSkipList(opts = {}) {
  const maxLevel = Math.max(1, Math.floor(Number(opts.maxLevel ?? 16)))
  const p = Math.min(0.95, Math.max(0.01, Number(opts.p ?? 0.5)))
  const rand = typeof opts.rand === 'function' ? opts.rand : Math.random
  const compare = typeof opts.compare === 'function' ? opts.compare : defaultCompare
  const header = { key: null, entry: null, forward: new Array(maxLevel).fill(null) }
  let level = 1
  let count = 0
  const counters = { comparisons: 0, puts: 0, gets: 0, dels: 0 }

  function randomLevel() {
    let lv = 1
    while (lv < maxLevel && rand() < p) lv++
    return lv
  }

  function cmp(a, b) { counters.comparisons++; return compare(a, b) }

  /** 返回每层的「前驱」节点，供 put/del 改链。 */
  function findPredecessors(key) {
    const update = new Array(maxLevel).fill(header)
    let x = header
    for (let i = level - 1; i >= 0; i--) {
      let next = x.forward[i]
      while (next && cmp(next.key, key) < 0) { x = next; next = x.forward[i] }
      update[i] = x
    }
    return update
  }

  function get(key) {
    counters.gets++
    let x = header
    for (let i = level - 1; i >= 0; i--) {
      let next = x.forward[i]
      while (next && cmp(next.key, key) < 0) { x = next; next = x.forward[i] }
    }
    x = x.forward[0]
    if (x && cmp(x.key, key) === 0) return x.entry
    return null
  }

  /** 写一条（可带 seq/tombstone）。同 key 覆盖为最新 entry。 */
  function put(key, value, seq = 0, tombstone = false) {
    counters.puts++
    const update = findPredecessors(key)
    const x = update[0].forward[0]
    if (x && cmp(x.key, key) === 0) {
      x.entry = { key, value, seq, tombstone: !!tombstone }
      return x.entry
    }
    const lv = randomLevel()
    if (lv > level) {
      for (let i = level; i < lv; i++) update[i] = header
      level = lv
    }
    const node = { key, entry: { key, value, seq, tombstone: !!tombstone }, forward: new Array(lv).fill(null) }
    for (let i = 0; i < lv; i++) { node.forward[i] = update[i].forward[i]; update[i].forward[i] = node }
    count++
    return node.entry
  }

  /** 删除 = 写一条 tombstone（若 key 不存在也写，保证下游旧版本被遮蔽）。 */
  function del(key, seq = 0) {
    counters.dels++
    return put(key, undefined, seq, true)
  }

  /** 顺序区间查 [lo, hi]（含端点），返回 entry 数组；lo/hi 为 undefined 表示该侧无界。 */
  function range(lo, hi) {
    const out = []
    let x = header.forward[0]
    // lo 无界时从头扫；有界时先前进到第一个 >= lo 的节点。
    while (x && lo !== undefined && cmp(x.key, lo) < 0) x = x.forward[0]
    while (x) {
      if (hi !== undefined && cmp(x.key, hi) > 0) break
      out.push(x.entry)
      x = x.forward[0]
    }
    return out
  }

  function entries() { return range(undefined, undefined) }
  function size() { return count }
  function stats() {
    return { size: count, level, maxLevel, comparisons: counters.comparisons, puts: counters.puts, gets: counters.gets, dels: counters.dels }
  }

  return { get, put, del, range, entries, size, stats, get currentLevel() { return level } }
}

/**
 * ② Bloom filter —— 概率集合成员查询。
 *
 * <p>m 位位数组 + k 个哈希位置（double hashing：`pos_i = (h1 + i·h2 + i²) mod m`，
 * 加 `i²` 是防 h2 为偶数时位置退化成步长 h2 的等差列）。`mightHave=false` 保证**一定不在**
 * （零假阴性），`true` 可能假阳性；理论假阳性率 `(1 − e^(−kn/m))^k` 由 `estimatedFpRate()`
 * 给出。两个基础哈希 `baseHashes` 可注入 ⇒ 用固定哈希就能确定性测假阳性。</p>
 *
 * <p>教学取舍：内部额外维护 `inserted: Set` **只为统计真假阳性**（`falsePositives`），
 * 真 Bloom filter 绝不存原始 key；`mightHave` 的判定本身只读位数组，不用 Set 走捷径。</p>
 */
export function createBloomFilter(opts = {}) {
  const numKeys = Math.max(1, Math.floor(Number(opts.numKeys ?? 100)))
  const bitsPerKey = Math.max(1, Number(opts.bitsPerKey ?? 10))
  const bits = Math.max(8, Math.floor(Number(opts.m ?? numKeys * bitsPerKey)))
  const k = Math.max(1, Math.floor(Number(opts.k ?? Math.max(1, Math.round((bits / numKeys) * Math.LN2)))))
  const baseHashes = typeof opts.baseHashes === 'function' ? opts.baseHashes : defaultBaseHashes
  const array = new Uint8Array(bits)
  const inserted = new Set()
  const counters = { inserted: 0, truePositives: 0, falsePositives: 0, negatives: 0 }

  function positions(key) {
    const [h1, h2] = baseHashes(key)
    const out = []
    for (let i = 0; i < k; i++) out.push(((h1 >>> 0) + i * (h2 >>> 0) + i * i) % bits)
    return out
  }

  function add(key) {
    for (const pos of positions(key)) array[pos] = 1
    if (!inserted.has(key)) { inserted.add(key); counters.inserted++ }
    return true
  }

  /** 可能在 ⇒ true；一定不在 ⇒ false。true 且从未 add 过即一次真假阳性，计入统计。 */
  function mightHave(key) {
    for (const pos of positions(key)) if (array[pos] === 0) { counters.negatives++; return false }
    if (inserted.has(key)) counters.truePositives++
    else counters.falsePositives++
    return true
  }

  function estimatedFpRate() {
    const n = counters.inserted
    return Math.pow(1 - Math.exp((-k * n) / bits), k)
  }

  function stats() {
    return {
      bits, k, inserted: counters.inserted, truePositives: counters.truePositives,
      falsePositives: counters.falsePositives, negatives: counters.negatives,
      estimatedFpRate: estimatedFpRate(),
    }
  }

  return { add, mightHave, estimatedFpRate, stats, get m() { return bits }, get numHashes() { return k } }
}

/**
 * ③ WAL —— 预写日志（Write-Ahead Log）。
 *
 * <p>LSM 的持久性靠「**先顺序追加 WAL，再写内存 memtable**」：进程崩在 flush 之前，
 * 重放 WAL 就能把没落盘的写补回 memtable。`append` 写一条带递增 seq 的纯数据行
 * （`{seq, op, key, value}`），`sink` 可注入（数组 push 或 `{write(line)}` 对象）模拟落盘；
 * `replay(fn)` 按序回调、`lines()` 回可序列化行供跨实例恢复。与真 WAL 无文件 I/O 桥接。</p>
 */
export function createWal(opts = {}) {
  const sink = opts.sink ?? null
  const encode = typeof opts.encode === 'function' ? opts.encode : (e) => JSON.stringify(e)
  const records = []
  let seq = Math.max(0, Math.floor(Number(opts.startSeq ?? 0)))

  function append(op, key, value) {
    const rec = { seq: ++seq, op: op === 'del' ? 'del' : 'put', key, value: value === undefined ? null : value }
    records.push(rec)
    const line = encode(rec)
    if (sink) {
      if (typeof sink.write === 'function') sink.write(line)
      else if (Array.isArray(sink)) sink.push(line)
    }
    return rec
  }

  /** 按序重放；回调抛错即中断（崩溃恢复语义：不吞错）。返回重放条数。 */
  function replay(fn) {
    let n = 0
    for (const rec of records) { fn(rec); n++ }
    return n
  }

  /** 从可序列化行重建（跨实例/模拟磁盘恢复）。返回装载条数。 */
  function restore(lines) {
    clear()
    let n = 0
    for (const line of lines) {
      const rec = typeof line === 'string' ? JSON.parse(line) : line
      records.push(rec)
      seq = Math.max(seq, Math.floor(Number(rec.seq) || 0))
      n++
    }
    return n
  }

  function entries() { return records.map((r) => ({ ...r })) }
  function lines() { return records.map(encode) }
  function clear() { records.length = 0 }
  function stats() { return { entries: records.length, lastSeq: seq } }

  return { append, replay, restore, entries, lines, clear, stats, get lastSeq() { return seq } }
}

/**
 * ④ SSTable —— 不可变有序段（Sorted String Table）。
 *
 * <p>由 `createSSTable(entries, opts)` 从一批有序 entry 建成，此后只读（真 LSM 靠这种
 * 不可变性把随机写变成顺序写）。内含：key 区间 `[minKey,maxKey]`（区间外的点查连 Bloom
 * 都不用）、**Bloom filter**（区间内先问它，判「不在」就 0 次段探测）、**稀疏索引**
 * （每 `indexEvery` 条记一个 `{key,offset}` 锚点，点查先二分定位块、再块内短扫）。</p>
 *
 * <p>`get(key)` 回带 `comparisons`/`probes`/`bloomRejected` 三笔账——这是性能证据的原子读数：
 * 区间外或 Bloom 负查 ⇒ 0 比较 0 探测；真查一次 ⇒ 比较数 ≈ log(索引块数) + 块长。`range`
 * 顺序扫（LSM 范围查比 B+ 树吃亏的地方，写明在案：本教学版用收集排序、非归并堆迭代）。</p>
 */
export function createSSTable(entries, opts = {}) {
  const compare = typeof opts.compare === 'function' ? opts.compare : defaultCompare
  const indexEvery = Math.max(1, Math.floor(Number(opts.indexEvery ?? 16)))
  const level = Math.max(0, Math.floor(Number(opts.level ?? 0)))
  const data = (Array.isArray(entries) ? entries : [])
    .map((e) => ({ key: e.key, value: e.value, seq: Number(e.seq) || 0, tombstone: !!e.tombstone }))
    .sort((a, b) => {
      const c = compare(a.key, b.key)
      return c !== 0 ? c : b.seq - a.seq // 同 key 取 seq 更大者在前
    })
  // 段内 key 唯一（建段前由 memtable/compaction 去重）；防御性再去一次，留 seq 最大那条。
  const dedup = []
  for (const e of data) {
    if (dedup.length && compare(dedup[dedup.length - 1].key, e.key) === 0) {
      if (e.seq > dedup[dedup.length - 1].seq) dedup[dedup.length - 1] = e
    } else dedup.push(e)
  }
  const minKey = dedup.length ? dedup[0].key : null
  const maxKey = dedup.length ? dedup[dedup.length - 1].key : null
  const bloom = createBloomFilter({
    numKeys: Math.max(1, dedup.length), bitsPerKey: opts.bitsPerKey ?? 10,
    k: opts.k, baseHashes: opts.baseHashes, m: opts.m,
  })
  for (const e of dedup) bloom.add(e.key)
  const index = []
  for (let i = 0; i < dedup.length; i += indexEvery) index.push({ key: dedup[i].key, offset: i })
  let comparisons = 0

  function cmp(a, b) { comparisons++; return compare(a, b) }

  /** 点查；comparisons/probes 是本次查询花掉的账，bloomRejected 证 Bloom 省了段探测。 */
  function get(key) {
    const c0 = comparisons
    let probes = 0
    if (dedup.length === 0) return { found: false, entry: null, comparisons: 0, probes: 0, bloomRejected: false }
    if (cmp(key, minKey) < 0 || cmp(key, maxKey) > 0) {
      return { found: false, entry: null, comparisons: comparisons - c0, probes: 0, bloomRejected: false }
    }
    if (!bloom.mightHave(key)) {
      return { found: false, entry: null, comparisons: comparisons - c0, probes: 0, bloomRejected: true }
    }
    // 稀疏索引二分：找最后一个 index[i].key <= key 的块起点。
    let lo = 0
    let hi = index.length - 1
    let block = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (cmp(index[mid].key, key) <= 0) { block = mid; lo = mid + 1 } else hi = mid - 1
    }
    probes = 1
    const start = index[block].offset
    for (let i = start; i < dedup.length; i++) {
      const c = cmp(dedup[i].key, key)
      if (c > 0) break
      if (c === 0) return { found: true, entry: dedup[i], comparisons: comparisons - c0, probes, bloomRejected: false }
    }
    return { found: false, entry: null, comparisons: comparisons - c0, probes, bloomRejected: false }
  }

  function range(lo, hi) {
    const out = []
    for (const e of dedup) {
      if (lo !== undefined && cmp(e.key, lo) < 0) continue
      if (hi !== undefined && cmp(e.key, hi) > 0) break
      out.push(e)
    }
    return out
  }

  function stats() {
    return {
      level, size: dedup.length, minKey, maxKey, indexBlocks: index.length,
      bloom: bloom.stats(), comparisons,
    }
  }

  /** 可序列化纯数据快照（给调用方做持久化或断言，不含函数/闭包）。 */
  function serializable() {
    return {
      level, minKey, maxKey, indexEvery,
      entries: dedup.map((e) => ({ key: e.key, value: e.value, seq: e.seq, tombstone: e.tombstone })),
    }
  }

  return {
    get, range, stats, serializable, mightHave: bloom.mightHave,
    get size() { return dedup.length },
    get minKey() { return minKey },
    get maxKey() { return maxKey },
    get level() { return level },
    entries: () => dedup.map((e) => ({ ...e })),
  }
}

/**
 * ⑤+⑥ LSM 存储引擎 —— 组装并给性能证据。
 *
 * <p>写路径：`put/del` 先 `wal.append`（顺序写、可注入 sink）再进 memtable（跳表）；
 * memtable 超 `memtableMax` 或显式 `flush()` 才顺序落成 L0 SSTable（不可变）。
 * 读路径：`get` 按「memtable → L0 新到旧 → 更深各层」查，任一处命中即停——因为越新
 * 的层/段含越新的版本；命中 tombstone 回 `found:false`（删除遮蔽了更老数据）。</p>
 *
 * <p>compaction（leveled 简化为多级）：`compact(level?)` 把某层与下一层的所有段**归并去重**
 * （同 key 取 seq 最大者），产生的旧版本计 `mergedAway`；只有归并到**最深层**（下面再无
 * 更老数据）时才安全丢弃 tombstone，计 `tombstonesDropped`——否则更深层可能被复活。
 * 若目标层段数超 `levelMultiplier` 会级联到更深，必要时追加新层。这是「以读放大换写放大」
 * 里回收读放大的那一步。</p>
 *
 * <p>性能证据：`stats().comparisons` 记所有点查真正花掉的比较数（跳表 + SSTable 二分/短扫），
 * `stats().scanBaselineComparisons` 记「同样多次 get 若走线性扫描」要做的比较数（每次按
 * 当前唯一 key 数 N 计），`speedup = 基线 / 实际`。`compareScan(keys)` 用 stats 差分给一批
 * key 的 `lsmComparisons/scanComparisons/speedup` 对照，且 `bloomRejects` 证负查零探测。</p>
 */
export function createLsmStore(opts = {}) {
  const memtableMax = Math.max(1, Math.floor(Number(opts.memtableMax ?? 64)))
  const levelMultiplier = Math.max(1, Math.floor(Number(opts.levelMultiplier ?? 4)))
  const compare = typeof opts.compare === 'function' ? opts.compare : defaultCompare
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const skiOpts = { maxLevel: opts.maxLevel, p: opts.p, rand: opts.rand, compare }
  const tableOpts = {
    compare, indexEvery: opts.indexEvery, bitsPerKey: opts.bitsPerKey,
    k: opts.k, m: opts.m, baseHashes: opts.baseHashes,
  }

  let memtable = createSkipList(skiOpts)
  const wal = opts.wal ?? createWal({ sink: opts.sink, encode: opts.encode, startSeq: opts.startSeq })
  let levels = [[], []] // levels[0]=L0（最新 flush），下标越大越旧；每项是 SSTable 数组
  const keySet = new Set()
  const counters = {
    writes: 0, reads: 0, gets: 0, misses: 0, flushes: 0, compactions: 0,
    mergedAway: 0, tombstonesDropped: 0, sstableGets: 0, bloomRejects: 0,
    comparisons: 0, scanBaselineComparisons: 0,
  }

  /** 当前唯一 key 数（线性扫描对照的 N；keySet 是见过的 key 上界，故为保守基线）。 */
  function uniqueKeyCount() { return keySet.size }

  function put(key, value) {
    const rec = wal.append('put', key, value)
    memtable.put(key, value, rec.seq, false)
    keySet.add(key)
    counters.writes++
    if (memtable.size() >= memtableMax) flush()
    return true
  }

  /** 删除即写 tombstone（seq 更大者），真正抹数据留到最深层 compaction。 */
  function del(key) {
    const rec = wal.append('del', key, undefined)
    memtable.del(key, rec.seq)
    keySet.add(key)
    counters.writes++
    if (memtable.size() >= memtableMax) flush()
    return true
  }

  /** 把 memtable 顺序落成 L0 SSTable；空表不落。返回新段或 null。 */
  function flush() {
    const entries = memtable.entries()
    if (entries.length === 0) return null
    const table = createSSTable(entries, { ...tableOpts, level: 0 })
    levels[0].unshift(table) // 同层新段在前
    memtable = createSkipList(skiOpts) // 换一张空 memtable（旧表不可变，等价 freeze）
    counters.flushes++
    if (levels[0].length > levelMultiplier) compact(0)
    return table
  }

  /** 归并 from 层与其下一层为一个段，落到 from+1 层；返回本次统计或 null。 */
  function compactOnce(from, canDropTombstone) {
    const cur = levels[from] || []
    const nxt = levels[from + 1] || []
    if (cur.length === 0 && nxt.length === 0) return null
    const all = []
    for (const t of [...cur, ...nxt]) for (const e of t.entries()) all.push(e)
    // 按 key 聚组、同 key 取 seq 最大（越新越赢）；tombstone 若可丢则丢弃。
    const byKey = new Map()
    for (const e of all) {
      const old = byKey.get(e.key)
      if (!old || e.seq > old.seq) byKey.set(e.key, e)
    }
    const kept = []
    let dropped = 0
    for (const e of byKey.values()) {
      if (e.tombstone && canDropTombstone) { dropped++; continue }
      kept.push(e)
    }
    const merged = createSSTable(kept, { ...tableOpts, level: from + 1 })
    levels[from] = []
    levels[from + 1] = merged.size > 0 ? [merged] : []
    counters.compactions++
    counters.mergedAway += all.length - kept.length
    counters.tombstonesDropped += dropped
    return { from, to: from + 1, inputEntries: all.length, outputEntries: kept.length, mergedAway: all.length - kept.length, tombstonesDropped: dropped }
  }

  /**
   * leveled compaction。给了 `level` 就归并该层一次；否则从 L0 级联归并到没有层超限。
   * 目标层若是最深层（下面再无更老数据）才丢 tombstone，防更深层旧版本复活。
   */
  function compact(level) {
    const results = []
    if (level !== undefined) {
      const from = Math.max(0, Math.floor(Number(level)))
      const isDeepest = from + 1 >= levels.length - 1
      const r = compactOnce(from, isDeepest)
      if (r) results.push(r)
      return results
    }
    let from = 0
    while (from < levels.length - 1) {
      const over = (levels[from] || []).length > 0 || (levels[from + 1] || []).length > levelMultiplier
      if (over) {
        const isDeepest = from + 1 >= levels.length - 1
        const r = compactOnce(from, isDeepest)
        if (r) results.push(r)
      }
      from++
    }
    // 最深层若仍超限，追加一层继续归并（这样深层 tombstone 才拿到「安全丢弃」的位置）。
    let deepest = levels.length - 1
    if ((levels[deepest] || []).length > levelMultiplier) {
      levels.push([])
      const r = compactOnce(deepest, true)
      if (r) results.push(r)
    }
    return results
  }

  /**
   * 点查：memtable → 各层各段（新到旧），命中即停。回带比较数/探测数/Bloom 拒绝数等账。
   * 每次 get 都按当前唯一 key 数累加线性扫描基线，供 speedup 对照。
   */
  function get(key) {
    counters.reads++
    counters.gets++
    counters.scanBaselineComparisons += uniqueKeyCount()
    const memBefore = memtable.stats().comparisons
    const inMem = memtable.get(key)
    let comparisons = memtable.stats().comparisons - memBefore
    let probes = 0
    let bloomRejected = 0
    let sstableGets = 0
    let levelFound = null
    if (inMem) {
      if (inMem.tombstone) { counters.misses++; counters.comparisons += comparisons; return { found: false, value: undefined, comparisons, probes, bloomRejected, from: 'tombstone' } }
      counters.comparisons += comparisons
      return { found: true, value: inMem.value, comparisons, probes, bloomRejected, from: 'memtable' }
    }
    outer:
    for (let lev = 0; lev < levels.length; lev++) {
      for (const table of levels[lev]) {
        const r = table.get(key)
        comparisons += r.comparisons
        probes += r.probes
        if (r.bloomRejected) bloomRejected++
        else sstableGets++
        if (r.found) {
          levelFound = lev
          break outer
        }
      }
    }
    counters.comparisons += comparisons
    counters.sstableGets += sstableGets
    counters.bloomRejects += bloomRejected
    // 只有真命中非 tombstone 才算 hit。
    let found = false
    let value
    let from = null
    if (levelFound !== null) {
      let winner = null
      for (const table of levels[levelFound]) {
        const r = table.get(key)
        if (r.found && (!winner || r.entry.seq > winner.seq)) winner = r.entry
      }
      if (winner && !winner.tombstone) { found = true; value = winner.value; from = `L${levelFound}` }
      else if (winner && winner.tombstone) from = 'tombstone'
    }
    if (!found) counters.misses++
    return { found, value, comparisons, probes, bloomRejected, from, level: levelFound }
  }

  /** 范围查 [lo,hi]：收集 memtable + 所有段的 entry，按 key 聚组取最新、滤 tombstone。 */
  function range(lo, hi) {
    const byKey = new Map()
    const consider = (e) => {
      const old = byKey.get(e.key)
      if (!old || e.seq > old.seq) byKey.set(e.key, e)
    }
    for (const e of memtable.entries()) consider(e)
    for (const tier of levels) for (const table of tier) for (const e of table.entries()) consider(e)
    const out = []
    for (const e of byKey.values()) {
      if (lo !== undefined && compare(e.key, lo) < 0) continue
      if (hi !== undefined && compare(e.key, hi) > 0) continue
      if (e.tombstone) continue
      out.push({ key: e.key, value: e.value, seq: e.seq })
    }
    out.sort((a, b) => compare(a.key, b.key))
    return out
  }

  /**
   * 崩溃恢复：从 WAL 行跨实例重建 memtable（先写 WAL 再写 memtable 的另一半证据）。
   * 已落进 SSTable 的写不重复进 memtable（恢复只补没 flush 的那段 WAL——教学上以
   * `wal.clear()` 在 flush 后截断模拟；若没截断，重放同 seq 的同 key 覆盖也幂等）。
   */
  function recover(lines) {
    if (Array.isArray(lines)) wal.restore(lines)
    memtable = createSkipList(skiOpts)
    wal.replay((rec) => {
      if (rec.op === 'del') memtable.del(rec.key, rec.seq)
      else memtable.put(rec.key, rec.value, rec.seq, false)
      keySet.add(rec.key)
    })
    return memtable.size()
  }

  /** 一批 key 的「LSM 点查 vs 线性扫描」对照证据（用 stats 差分，不污染累计口径）。 */
  function compareScan(keys) {
    const args = Array.isArray(keys) ? keys : []
    const c0 = counters.comparisons
    const b0 = counters.scanBaselineComparisons
    const r0 = counters.reads
    const m0 = counters.misses
    const bl0 = counters.bloomRejects
    let hits = 0
    for (const k of args) if (get(k).found) hits++
    const lsmComparisons = counters.comparisons - c0
    const scanComparisons = counters.scanBaselineComparisons - b0
    return {
      keys: args.length, hits, reads: counters.reads - r0, misses: counters.misses - m0,
      lsmComparisons, scanComparisons,
      speedup: lsmComparisons > 0 ? scanComparisons / lsmComparisons : (scanComparisons > 0 ? Infinity : 1),
      bloomRejects: counters.bloomRejects - bl0,
    }
  }

  function stats() {
    const tiers = levels.map((tier, i) => ({ level: i, segments: tier.length, entries: tier.reduce((n, t) => n + t.size, 0) }))
    return {
      writes: counters.writes, reads: counters.reads, gets: counters.gets, misses: counters.misses,
      flushes: counters.flushes, compactions: counters.compactions,
      mergedAway: counters.mergedAway, tombstonesDropped: counters.tombstonesDropped,
      sstableGets: counters.sstableGets, bloomRejects: counters.bloomRejects,
      comparisons: counters.comparisons,
      scanBaselineComparisons: counters.scanBaselineComparisons,
      speedup: counters.comparisons > 0 ? counters.scanBaselineComparisons / counters.comparisons : 1,
      memtableSize: memtable.size(), uniqueKeys: keySet.size,
      levels: tiers, wal: wal.stats(), memtable: memtable.stats(),
    }
  }

  /** 不含每行真值、只回结构读数（给 status/前端控制台取，避免把整个数据集塞进快照）。 */
  function snapshot() {
    const s = stats()
    return {
      writes: s.writes, reads: s.reads, flushes: s.flushes, compactions: s.compactions,
      mergedAway: s.mergedAway, tombstonesDropped: s.tombstonesDropped,
      comparisons: s.comparisons, scanBaselineComparisons: s.scanBaselineComparisons,
      speedup: s.speedup, bloomRejects: s.bloomRejects, sstableGets: s.sstableGets,
      memtableSize: s.memtableSize, uniqueKeys: s.uniqueKeys, levels: s.levels, wal: s.wal,
      builtAt: now(),
    }
  }

  return {
    put, del, get, range, flush, compact, recover, compareScan, stats, snapshot,
    get wal() { return wal },
    get memtable() { return memtable },
    get levels() { return levels },
  }
}

/* ------------------------------- CLI ------------------------------- */
// node scripts/caesura-lsm-store.mjs —— 跑一趟确定性benchmark，打印「LSM vs 线性扫描」证据。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const N = 512
  const seedKeys = Array.from({ length: N }, (_, i) => `boss:${String(i).padStart(4, '0')}`)
  const store = createLsmStore({ memtableMax: 64, levelMultiplier: 4, rand: (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff })() })
  for (const k of seedKeys) store.put(k, { hp: k.length * 10 })
  for (let i = 0; i < seedKeys.length; i += 7) store.del(seedKeys[i])
  store.flush()
  store.compact()
  const probes = seedKeys.filter((_, i) => i % 5 === 0).concat(['never:existed:a', 'never:existed:b'])
  const cmp = store.compareScan(probes)
  const s = store.stats()
  console.log(JSON.stringify({
    generator: 'caesura-lsm-store', keys: N, probes: probes.length,
    levels: s.levels, flushes: s.flushes, compactions: s.compactions,
    mergedAway: s.mergedAway, tombstonesDropped: s.tombstonesDropped,
    bloomRejects: cmp.bloomRejects, hits: cmp.hits,
    lsmComparisons: cmp.lsmComparisons, scanBaselineComparisons: cmp.scanComparisons,
    speedup: Number.isFinite(cmp.speedup) ? Number(cmp.speedup.toFixed(2)) : 'Infinity',
  }, null, 2))
}
