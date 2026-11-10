import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLsmStore, defaultCompare as lsmDefaultCompare } from './caesura-lsm-store.mjs'

/**
 * scripts/caesura-bplus-tree.mjs —— B+ 树索引引擎 + 与 LSM 三笔账诚实权衡对照（P8 第十二件，KI-504）。
 *
 * <p>补的正是 KI-496 埋下的那笔「纸面账」：那件注释反复拿 B+ 树当对照系——「B+ 树原地改页 ⇒
 * 随机写放大」「LSM 范围查比 B+ 树吃亏（收集所有段后排序、非叶链顺序扫）」——可仓里**从无一株
 * 真 B+ 树**，读者只能信那几行 prose。本件用零依赖、可注入、可确定性测的纯 JS 落一株**真 B+ 树**
 * （不是数组假扮），再把它与 `createLsmStore`(KI-496) 灌同一批 key，把数据库内核最经典的那一对
 * 取舍钉成三组可断言的结构计数对照：**① 点查比较数 ② 范围查结构代价 ③ 写放大 / I/O 模式**。</p>
 *
 * <p>真 B+ 树的三件骨架（缺一不可，缺了就是「数组冒充树」）：</p>
 * <ol>
 *   <li>**阶数可控 ⇒ 扇出决定层高**：`order`（内节点最大孩子数，强制偶数 ≥4）决定 `fanout=order`，
 *       叶子存满 `leafCapacity` 条才分裂；`heightEstimate(n,order,leafCap)` 给「百万 key 几层」的
 *       教学读数（B+ 树矮胖、层数 = log_扇out(叶数) + 1，这是它比二叉树少 I/O 的根本原因）。</li>
 *   <li>**数据只在叶子 + 叶子双向链表**：内节点只存分隔键与 child 指针；每条记录只落一个叶子，
 *       叶子用 `next/prev` 串成链。`range(lo,hi)` 先沿分隔键定位首叶、再沿链**顺序扫**，记 `leafHops`；
 *       这正是 B+ 树相对 LSM 读多 / 范围多的结构性优势——LSM 的 `range` 要把 memtable 与所有 SSTable
 *       的 entry 全收集进 Map 去重再排序（`caesura-lsm-store.mjs` 里写明的「本教学版用收集排序、
 *       非归并堆迭代」），结构代价随段数涨。</li>
 *   <li>**写路径含分裂与删除再平衡**：插入走自顶向下分裂（叶满 mid 上推、内节点满递归分裂长高）；
 *       删除走「先物理删、再自底向上修复」——下溢节点先向兄弟 `borrow`（借不到就 `merge`），
 *       根降高。分隔键是右子树最小 key 的**副本**，删除可能删掉某个副本的真值，故删除后统一
 *       自底向上 `refreshSeparators`（O(n) 教学取舍、不塞进 `comparisons` 读账、不污染点查对照）。</li>
 * </ol>
 *
 * <p>三笔账对照（`compareBplusVsLsm`，判定权全在 Node 侧）：同一批确定性 key 分灌两引擎，
 * 在同一组点查 / 范围查 / 写入上各记真实结构计数——点查比 `comparisons`（B+ 层高二分 vs
 * LSM memtable 跳表 + 多层 SSTable 稀疏索引 + Bloom 负查）；范围查比 **B+ 叶链顺序扫** vs
 * **LSM 跨段归并 + 全量排序**；写放大比 **B+ 原地改页重排**（`splits/merges/borrows` ⇒ `pageRewrites`
 * 模型）vs **LSM 顺序追加 + compaction**（`flushes/compactions/mergedAway/tombstonesDropped` ⇒
 * `seqWriteUnits` 模型）。判词**不封全局赢家**：如实给「B+ 点查 / 范围查结构代价稳，但写触发原地
 * 改页重排；LSM 顺序写适配 SSD，但读要跨层、范围查要全量归并、compaction 重复搬运」这组真实取舍
 * （同 KI-497 SoA 跳跃退化、KI-501 布隆假阳性、KI-503 固定超时更快但更吵的诚实立场）。</p>
 *
 * <p>设计取舍：比较器、`order`、`leafCapacity`、时钟、LSM 参数、确定性 key/探针/范围全由 opts 注入；
 * 本件只跑数据结构状态机与计数，不写任何业务阈值。与真 B+ 树 / 真 RocksDB 无运行时依赖——无真磁盘
 * 页、无缓冲池、无块设备对齐、无并发闩锁，`pageRewrites`/`seqWriteUnits` 是结构重写**模型**，
 * 不是字节或墙钟。</p>
 *
 * 用法：
 *   const tree = createBPlusTree({ order: 8, leafCapacity: 8 })
 *   tree.put('boss:1', 100); tree.put('boss:2', 80)
 *   tree.get('boss:2')            // → { found:true, value:80, comparisons, nodeVisits, ... }
 *   tree.range('boss:1','boss:9') // → [{key,value}, ...] 沿叶链顺序
 *   tree.del('boss:1')            // 下溢时 borrow/merge 再平衡
 *   tree.validate()               // → []（不变式无违例）或违例串数组
 *   const cmp = compareBplusVsLsm({ keys, probes, rangeQueries })
 *   const study = await bplusStudy({ ... })  // 纯数据汇总
 *
 * CLI：node scripts/caesura-bplus-tree.mjs  （= npm run bplus:bench）
 */

/** 缺省参数（冻结；阈值不写死在逻辑里，全可注入）。 */
export const BP_DEFAULTS = Object.freeze({
  order: 32,
  leafCapacity: 32,
  keyCount: 512,
  probeEvery: 7,
  overwriteEvery: 13,
  rangeFractions: Object.freeze([0.0, 0.4, 0.85]),
  rangeWidth: 0.1,
  extraMissKeys: Object.freeze(['never:existed:a', 'never:existed:b', 'zzz:tail']),
  lsmMemtableMax: 64,
  lsmLevelMultiplier: 4,
  lsmIndexEvery: 16,
  lsmBitsPerKey: 10,
  lcgSeed: 42,
  minOrder: 4,
  heightLadder: Object.freeze([4, 8, 16, 32, 64, 128]),
})

/** 缺省比较器：按字符串字典序（key 缺省为 string；非 string key 请注入 `compare`）。 */
export function defaultCompare(a, b) {
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * B+ 树层高教学估计（含叶子那层），按 **mid 分裂的半填充稳态**：叶子稳态装 `leafCapacity/2`、
 * 内节点稳态扇出 `order/2`（自顶向下分裂 + 中间上推的必然结果，不是拍脑袋的系数）。
 * `leaves = ceil(n / 稳态叶容量)`，每上一层除以稳态扇出，直到根；**至少两层**（叶 + 根）——
 * 只要多于一叶就得有一层根来挂，绝不会像「满填充 + 单节点」那样报 1 层。
 * 用途是「百万 key 几层」这类可读判词与 `heightLadder`（order 越大扇出越高、层高越低）；
 * 它贴近本件实测 `height` 但**不替代**实测（插入顺序/删除形状仍会让实测差 ±1），两者并排、不混谈。
 * n ≤ 0 回 0（空集诚实降级，不除零）。
 */
export function heightEstimate(n, order, leafCapacity) {
  const count = Math.max(0, Math.floor(Number(n) || 0))
  if (count === 0) return 0
  let ord = Math.max(2, Math.floor(Number(order) || BP_DEFAULTS.order))
  if (ord % 2 !== 0) ord++
  const leafCap = Math.max(3, Math.floor(Number(leafCapacity) || BP_DEFAULTS.leafCapacity))
  const steadyLeaf = Math.max(1, Math.floor(leafCap / 2)) // mid 分裂 ⇒ 叶稳态半满
  const steadyFanout = Math.max(2, Math.floor(ord / 2))   // 内节点稳态扇出半满
  if (count <= steadyLeaf) return 1
  let leaves = Math.ceil(count / steadyLeaf)
  let height = 2                                           // 叶层 + 根层
  while (leaves > steadyFanout) { leaves = Math.ceil(leaves / steadyFanout); height++ }
  return height
}

/** 确定性 LCG（给 LSM memtable 跳表喂可复现的层高抛硬币，避免 Math.random 让对照读数漂移）。 */
function lcg(seed) {
  let s = (Math.floor(Number(seed)) >>> 0) || 1
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000
}

const isLeaf = (n) => n.leaf === true
const countKeys = (n) => n.keys.length

/**
 * 真 B+ 树。`order` 强制为 ≥minOrder 的**偶数**——奇数最大孩子数无法把满节点均分成两株合法子树
 * （m 个孩子要拆成两株各 ≥ceil(m/2)，奇数 m 时无解），故向上取偶并写明；这不是掩盖，是 B+ 树的
 * 结构性约束。
 */
export function createBPlusTree(opts = {}) {
  const compare = typeof opts.compare === 'function' ? opts.compare : defaultCompare
  // 偶数化：odd ⇒ +1，且 ≥minOrder（缺省 4，2 阶会退化成无法保证最小填充的链）。
  let order = Math.max(2, Math.floor(Number(opts.order) || BP_DEFAULTS.order))
  if (order % 2 !== 0) order++
  order = Math.max(Math.max(2, BP_DEFAULTS.minOrder), order)
  const leafCapacity = Math.max(3, Math.floor(Number(opts.leafCapacity) || BP_DEFAULTS.leafCapacity))
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const fanout = order
  const maxInternalKeys = order - 1            // children = keys + 1 ≤ order
  const minInternalKeys = order / 2 - 1        // 非根内节点最少 order/2 个孩子 ⇒ keys ≥ order/2−1
  // 叶下界必须与 mid 分裂自洽：size=leafCapacity 时 mid=floor(cap/2)，右半 cap−mid 条；
  // 顺序插入下某叶可能停在分裂那一半而不再被填，故真实下界是 floor((cap−1)/2)（cap=32 ⇒ 15），
  // 不是 floor(cap/2)=16——旧值连自己 split 造出的叶都判成下溢，validate 假报一条。
  const minLeafKeys = Math.floor((leafCapacity - 1) / 2)

  const counters = {
    puts: 0, dels: 0, gets: 0, ranges: 0,
    comparisons: 0,            // 所有比较（含写查路径）；点查/范围对照用 stats 差分取纯读账
    rangeLeafHops: 0,
    splits: 0, merges: 0, borrows: 0,
    separatorRefreshes: 0,     // 删除后刷新分隔键的趟数（O(n) 教学取舍，不塞进 comparisons）
  }
  let size = 0
  let root = makeLeaf([], [], null)

  function cmp(a, b) { counters.comparisons++; return compare(a, b) }
  function makeLeaf(keys, values, parent) { return { leaf: true, keys, values, next: null, prev: null, parent } }
  function makeInternal(keys, children, parent) {
    const n = { leaf: false, keys, children, parent }
    for (const c of children) c.parent = n
    return n
  }
  const isFull = (n) => isLeaf(n) ? countKeys(n) >= leafCapacity : countKeys(n) >= maxInternalKeys
  const minKeys = (n) => isLeaf(n) ? minLeafKeys : minInternalKeys

  /** 第一个 compare(keys[i], key) >= 0 的下标（叶子内定位）。 */
  function lowerBound(keys, key) {
    let lo = 0
    let hi = keys.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cmp(keys[mid], key) < 0) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  /** 第一个 compare(keys[i], key) > 0 的下标（内节点路由：等于分隔键 ⇒ 走右子树）。 */
  function upperBound(keys, key) {
    let lo = 0
    let hi = keys.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cmp(keys[mid], key) <= 0) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** 子树最小 key（内节点沿最左一路下到叶）；空子树回 undefined。 */
  function subtreeMinKey(node) {
    let x = node
    while (!isLeaf(x)) {
      if (x.children.length === 0) return undefined
      x = x.children[0]
    }
    return x.keys.length ? x.keys[0] : undefined
  }

  /** 自底向上把所有内节点分隔键重钉成「右孩子子树最小 key」。删除会删掉分隔键的真值，必须刷新。 */
  function refreshSeparators(node) {
    if (isLeaf(node)) return subtreeMinKey(node)
    const mins = []
    for (const c of node.children) mins.push(refreshSeparators(c))
    for (let i = 0; i < node.keys.length; i++) node.keys[i] = mins[i + 1]
    return mins[0]
  }

  /** 把满孩子 parent.children[idx] 分裂成两株，上推一个分隔键到 parent。要求 parent 尚有空位。 */
  function splitChild(parent, idx) {
    const child = parent.children[idx]
    counters.splits++
    if (isLeaf(child)) {
      const mid = Math.floor(child.keys.length / 2)
      const rightKeys = child.keys.splice(mid)
      const rightVals = child.values.splice(mid)
      const right = makeLeaf(rightKeys, rightVals, parent)
      right.next = child.next
      right.prev = child
      if (child.next) child.next.prev = right
      child.next = right
      parent.keys.splice(idx, 0, rightKeys[0]) // B+ 内节点分隔键 = 右子树最小 key（副本）
      parent.children.splice(idx + 1, 0, right)
    } else {
      const mid = Math.floor(child.keys.length / 2)
      const up = child.keys[mid]
      const leftKeys = child.keys.slice(0, mid)
      const rightKeys = child.keys.slice(mid + 1)
      const leftChildren = child.children.slice(0, mid + 1)
      const rightChildren = child.children.slice(mid + 1)
      child.keys = leftKeys
      child.children = leftChildren
      const right = makeInternal(rightKeys, rightChildren, parent)
      parent.keys.splice(idx, 0, up)
      parent.children.splice(idx + 1, 0, right)
    }
  }

  /** 合并 parent.children[idx] 与 children[idx+1] 成左株，删掉中间分隔键。返回合并后的节点。 */
  function mergeChildren(parent, idx) {
    const left = parent.children[idx]
    const right = parent.children[idx + 1]
    counters.merges++
    if (isLeaf(left)) {
      left.keys.push(...right.keys)
      left.values.push(...right.values)
      left.next = right.next
      if (right.next) right.next.prev = left
    } else {
      left.keys.push(parent.keys[idx]) // 两株之间的分隔键降为左株内一条
      left.keys.push(...right.keys)
      for (const c of right.children) { c.parent = left; left.children.push(c) }
      // 不能调 makeInternal(left.keys, left.children, left.parent)：那会 new 一个被丢弃的对象，
      // 把 children.parent 挂到那个死对象上（删除路径的悬挂指针）。逐个重挂到 left 本身。
    }
    parent.keys.splice(idx, 1)
    parent.children.splice(idx + 1, 1)
    return left
  }

  /** node 向左兄弟借一条（内节点：父分隔键下移、兄弟末孩过户）。 */
  function borrowFromLeft(parent, idx) {
    const node = parent.children[idx]
    const left = parent.children[idx - 1]
    counters.borrows++
    if (isLeaf(node)) {
      node.keys.unshift(left.keys.pop())
      node.values.unshift(left.values.pop())
      parent.keys[idx - 1] = node.keys[0]
    } else {
      const moved = left.children.pop()
      const sep = parent.keys[idx - 1]
      node.children.unshift(moved)
      node.keys.unshift(sep)
      moved.parent = node
      parent.keys[idx - 1] = left.keys.pop()
    }
  }

  /** node 向右兄弟借一条（内节点镜像）。 */
  function borrowFromRight(parent, idx) {
    const node = parent.children[idx]
    const right = parent.children[idx + 1]
    counters.borrows++
    if (isLeaf(node)) {
      node.keys.push(right.keys.shift())
      node.values.push(right.values.shift())
      parent.keys[idx] = right.keys.length ? right.keys[0] : undefined
    } else {
      const moved = right.children.shift()
      const sep = parent.keys[idx]
      node.children.push(moved)
      node.keys.push(sep)
      moved.parent = node
      parent.keys[idx] = right.keys.shift()
    }
  }

  /** 自底向上修复下溢：先借、再并、根收敛。 */
  function fixUnderflow(node) {
    while (node !== root) {
      const parent = node.parent
      if (!parent) break
      const idx = parent.children.indexOf(node)
      if (countKeys(node) >= minKeys(node)) break
      const left = idx > 0 ? parent.children[idx - 1] : null
      const right = idx < parent.children.length - 1 ? parent.children[idx + 1] : null
      if (left && countKeys(left) > minKeys(left)) { borrowFromLeft(parent, idx); break }
      if (right && countKeys(right) > minKeys(right)) { borrowFromRight(parent, idx); break }
      if (left) { mergeChildren(parent, idx - 1); node = parent }
      else if (right) { mergeChildren(parent, idx); node = parent }
      else break
    }
    if (!isLeaf(root) && root.children.length === 1) {
      root = root.children[0]
      root.parent = null
    }
  }

  function put(key, value) {
    counters.puts++
    if (countKeys(root) >= maxInternalKeys || (isLeaf(root) && isFull(root))) {
      const newRoot = makeInternal([], [root], null)
      root = newRoot
      splitChild(root, 0)
    }
    let node = root
    while (!isLeaf(node)) {
      let i = upperBound(node.keys, key)
      if (isFull(node.children[i])) {
        splitChild(node, i)
        if (cmp(key, node.keys[i]) > 0) i++
      }
      node = node.children[i]
    }
    const pos = lowerBound(node.keys, key)
    if (pos < node.keys.length && cmp(node.keys[pos], key) === 0) {
      node.values[pos] = value            // 覆盖，size 不变
    } else {
      node.keys.splice(pos, 0, key)
      node.values.splice(pos, 0, value)
      size++
    }
    return true
  }

  function get(key) {
    counters.gets++
    const c0 = counters.comparisons
    let node = root
    let nodeVisits = 0
    while (!isLeaf(node)) {
      nodeVisits++
      const i = upperBound(node.keys, key)
      node = node.children[i]
    }
    const pos = lowerBound(node.keys, key)
    const found = pos < node.keys.length && cmp(node.keys[pos], key) === 0
    return {
      found,
      value: found ? node.values[pos] : undefined,
      comparisons: counters.comparisons - c0,
      nodeVisits: nodeVisits + 1,
      from: 'leaf',
    }
  }

  /** 范围查 [lo,hi]（含端点），沿叶链顺序扫；lo/hi undefined 表示该侧无界。 */
  function range(lo, hi) {
    counters.ranges++
    const out = []
    let node = root
    while (!isLeaf(node)) {
      const i = lo === undefined ? 0 : upperBound(node.keys, lo)
      node = node.children[i]
    }
    let leaf = node
    let done = false
    while (leaf && !done) {
      for (let j = 0; j < leaf.keys.length; j++) {
        const k = leaf.keys[j]
        if (lo !== undefined && cmp(k, lo) < 0) continue
        if (hi !== undefined && cmp(k, hi) > 0) { done = true; break }
        out.push({ key: k, value: leaf.values[j] })
      }
      if (done || !leaf.next) break
      leaf = leaf.next
      counters.rangeLeafHops++
    }
    return out
  }

  function del(key) {
    counters.dels++
    let leaf = root
    while (!isLeaf(leaf)) leaf = leaf.children[upperBound(leaf.keys, key)]
    const pos = lowerBound(leaf.keys, key)
    if (pos >= leaf.keys.length || cmp(leaf.keys[pos], key) !== 0) return false
    leaf.keys.splice(pos, 1)
    leaf.values.splice(pos, 1)
    size--
    fixUnderflow(leaf)
    // 删除可能抹掉某分隔键的真值（分隔键是右子树最小 key 的副本），统一自底向上重钉。
    // 这是 O(n) 教学取舍：用独立计数器记、不并入 comparisons，以免污染点查/范围读账。
    counters.separatorRefreshes++
    refreshSeparators(root)
    return true
  }

  function entries() { return range(undefined, undefined) }
  function sizeOf() { return size }

  function heightOf() {
    let h = 1
    let x = root
    while (!isLeaf(x)) { h++; x = x.children[0] }
    return h
  }
  function leafCount() {
    let n = 0
    let x = root
    while (!isLeaf(x)) x = x.children[0]
    while (x) { n++; x = x.next }
    return n
  }
  function nodeCount() {
    let n = 0
    const walk = (x) => { n++; if (!isLeaf(x)) for (const c of x.children) walk(c) }
    walk(root)
    return n
  }

  /**
   * 不变式校验：返回违例串数组（空 = 健康）。钉住「真 B+ 树」而非数组冒充：所有叶同深度、
   * 分隔键 == 右孩子子树最小 key、节点填充上下界、叶链双向自洽、全局 key 严格递增、每条数据只在叶。
   * 给单测与 CLI 自证用，不计入读账。
   */
  function validate() {
    const bad = []
    const depths = new Set()
    const leaves = []
    // 分隔键语义（B+ 树特有）：内节点 keys[i] == 右孩子 keys[i+1] 子树**最小 key 的副本**。
    // 故每个子树落在 [lo, hi) 半开区间——等于 lo 的那个 key 合法（它正是分隔键本身对应的记录，
    // 归在右子树叶里），等于 hi 则越界（该归上一株）。旧写法用 `<= 0` 判下界，把每个叶的最小
    // key（= 分隔键副本）逐条误报，512 key / 32 叶正好 32 条假违例。
    const keyBound = (k, lo, hi, where) => {
      if (lo !== undefined && compare(k, lo) < 0) bad.push(`${where}: key ${String(k)} < 下界 ${String(lo)}`)
      if (hi !== undefined && compare(k, hi) >= 0) bad.push(`${where}: key ${String(k)} ≥ 上界 ${String(hi)}`)
    }
    const walk = (node, depth, lo, hi, where, isRoot) => {
      if (node.parent && (!isRoot ? true : false) && node.parent.children.indexOf(node) < 0) bad.push(`${where}: parent 不认这个孩子`)
      if (isLeaf(node)) {
        depths.add(depth)
        leaves.push(node)
        for (let i = 0; i < node.keys.length; i++) {
          keyBound(node.keys[i], lo, hi, where)
          if (i > 0 && compare(node.keys[i - 1], node.keys[i]) >= 0) bad.push(`${where}: 叶内 key 非严格递增 @${i}`)
        }
        if (!isRoot && (node.keys.length < minLeafKeys || node.keys.length > leafCapacity)) bad.push(`${where}: 叶填充 ${node.keys.length} ∉ [${minLeafKeys},${leafCapacity}]`)
      } else {
        if (node.children.length !== node.keys.length + 1) bad.push(`${where}: children ${node.children.length} ≠ keys+1 ${node.keys.length + 1}`)
        if (!isRoot && (node.keys.length < minInternalKeys || node.keys.length > maxInternalKeys)) bad.push(`${where}: 内节点填充 ${node.keys.length} ∉ [${minInternalKeys},${maxInternalKeys}]`)
        for (let i = 0; i < node.keys.length; i++) {
          if (i > 0 && compare(node.keys[i - 1], node.keys[i]) >= 0) bad.push(`${where}: 内节点 key 非严格递增 @${i}`)
          const childMin = subtreeMinKey(node.children[i + 1])
          if (childMin === undefined || compare(node.keys[i], childMin) !== 0) bad.push(`${where}: 分隔键 ${String(node.keys[i])} ≠ 右孩子最小 ${String(childMin)}`)
        }
        for (let i = 0; i < node.children.length; i++) {
          walk(node.children[i], depth + 1, i === 0 ? lo : node.keys[i - 1], i === node.keys.length ? hi : node.keys[i], `${where}/${i}`, false)
        }
      }
    }
    if (root.parent !== null) bad.push('root.parent ≠ null')
    walk(root, 1, undefined, undefined, 'R', true)
    if (depths.size > 1) bad.push(`叶深度不齐：${[...depths].join(',')}`)
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i].next !== (leaves[i + 1] ?? null)) bad.push(`叶链 next 断 @${i}`)
      if (i > 0 && leaves[i].prev !== leaves[i - 1]) bad.push(`叶链 prev 断 @${i}`)
    }
    let prev = undefined
    for (const leaf of leaves) for (const k of leaf.keys) {
      if (prev !== undefined && compare(prev, k) >= 0) bad.push(`全局 key 非严格递增：${String(prev)} → ${String(k)}`)
      prev = k
    }
    if (leaves.reduce((n, l) => n + l.keys.length, 0) !== size) bad.push(`叶 key 总数 ≠ size(${size})`)
    return bad
  }

  function stats() {
    return {
      size, order, fanout, leafCapacity,
      height: heightOf(), leafCount: leafCount(), nodeCount: nodeCount(),
      minLeafKeys, minInternalKeys, maxInternalKeys,
      comparisons: counters.comparisons,
      rangeLeafHops: counters.rangeLeafHops,
      puts: counters.puts, dels: counters.dels, gets: counters.gets, ranges: counters.ranges,
      splits: counters.splits, merges: counters.merges, borrows: counters.borrows,
      separatorRefreshes: counters.separatorRefreshes,
      // B+ 写放大模型：每次 put 至少原地重写 1 叶；每次结构重排额外写 2 页。非字节/墙钟。
      pageRewrites: counters.puts + 2 * (counters.splits + counters.merges + counters.borrows),
    }
  }

  /** 纯数据快照（给 status / 前端取，不夹带每行真值与闭包）。 */
  function snapshot() {
    const s = stats()
    return {
      size: s.size, order: s.order, fanout: s.fanout, leafCapacity: s.leafCapacity,
      height: s.height, heightEstimate: heightEstimate(s.size, s.order, s.leafCapacity),
      leafCount: s.leafCount, nodeCount: s.nodeCount,
      comparisons: s.comparisons, rangeLeafHops: s.rangeLeafHops,
      puts: s.puts, dels: s.dels, gets: s.gets, ranges: s.ranges,
      splits: s.splits, merges: s.merges, borrows: s.borrows,
      pageRewrites: s.pageRewrites,
      invariants: validate().length,
      builtAt: now(),
    }
  }

  function reset() {
    root = makeLeaf([], [], null)
    size = 0
    for (const k of Object.keys(counters)) counters[k] = 0
    return true
  }

  return {
    put, get, del, range, entries, size: sizeOf, height: heightOf, stats, snapshot, validate, reset,
    get order() { return order },
    get fanout() { return fanout },
    get leafCapacity() { return leafCapacity },
    readonlyRoot: () => root,
  }
}

/** 校验一株由 createBPlusTree 造的树（薄封装，单测/CLI 共用，值与 tree.validate() 同源）。 */
export function validateBPlusTree(tree) {
  return typeof tree?.validate === 'function' ? tree.validate() : ['不是 B+ 树实例']
}

/**
 * 确定性 key / 点查探针 / 范围区间生成（CLI 与 console-gen 共用一把尺，避免两处写死漂移）。
 * @param {number} n key 数
 * @param {object} [opts]
 * @returns {{keys:string[], probes:string[], rangeQueries:Array<[string,string]>}}
 */
export function deterministicKeys(n, opts = {}) {
  const count = Math.max(1, Math.floor(Number(n) || BP_DEFAULTS.keyCount))
  const probeEvery = Math.max(1, Math.floor(Number(opts.probeEvery) || BP_DEFAULTS.probeEvery))
  const keys = Array.from({ length: count }, (_, i) => `boss:${String(i).padStart(5, '0')}`)
  const probes = keys.filter((_, i) => i % probeEvery === 0)
    .concat(Array.isArray(opts.extraMissKeys) ? opts.extraMissKeys : BP_DEFAULTS.extraMissKeys)
  const width = Math.max(0, Math.min(1, Number(opts.rangeWidth ?? BP_DEFAULTS.rangeWidth)))
  const fractions = Array.isArray(opts.rangeFractions) ? opts.rangeFractions : BP_DEFAULTS.rangeFractions
  const rangeQueries = fractions.map((f) => {
    const start = Math.min(count - 1, Math.max(0, Math.floor(count * Number(f))))
    const end = Math.min(count - 1, Math.max(start, start + Math.max(1, Math.round(count * width))))
    return [keys[start], keys[end]]
  })
  return { keys, probes, rangeQueries }
}

/**
 * 把同一批 key 分灌 B+ 树与 LSM，在**同一组**点查 / 范围查 / 写入上记三笔账结构计数对照。
 *
 * <p>正确性对账（比性能数字更要紧）：同一个 key 集合、同一组探针与区间，两引擎的 `get`（found+value）
 * 与 `range`（key+value 序列）必须逐条一致——`agreement.bothAgree` 为真是「对照成立」的前提；若哪天
 * 谁的答案分叉，`pointMismatches/rangeMismatches` 当场非零，性能读数不再可信。</p>
 *
 * <p>写入阶段先灌 N 个唯一 key 并各 flush 一道（让 LSM 产生多段读放大），再把每 `overwriteEvery` 个
 * key 覆写一版（让 LSM compaction 有旧版本可归并、`mergedAway>0`，也让 B+ 树走覆盖路径）。这些都在
 * 读账测量**之前**完成；点查/范围查用 `stats()` 差分取纯读账，不把写查路径塞进对照。</p>
 */
export function compareBplusVsLsm(opts = {}) {
  const n = Math.max(1, Math.floor(Number(opts.keyCount) || BP_DEFAULTS.keyCount))
  const order = opts.order
  const leafCapacity = opts.leafCapacity
  const built = deterministicKeys(n, opts)
  const keys = Array.isArray(opts.keys) && opts.keys.length ? opts.keys : built.keys
  const probes = Array.isArray(opts.probes) && opts.probes.length ? opts.probes : built.probes
  const rangeQueries = Array.isArray(opts.rangeQueries) && opts.rangeQueries.length
    ? opts.rangeQueries : built.rangeQueries
  const overwriteEvery = Math.max(0, Math.floor(Number(opts.overwriteEvery ?? BP_DEFAULTS.overwriteEvery)))
  const compare = typeof opts.compare === 'function' ? opts.compare : lsmDefaultCompare
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()

  const tree = createBPlusTree({ compare, order, leafCapacity })
  const lsm = createLsmStore({
    compare,
    memtableMax: opts.lsmMemtableMax ?? BP_DEFAULTS.lsmMemtableMax,
    levelMultiplier: opts.lsmLevelMultiplier ?? BP_DEFAULTS.lsmLevelMultiplier,
    indexEvery: opts.lsmIndexEvery ?? BP_DEFAULTS.lsmIndexEvery,
    bitsPerKey: opts.lsmBitsPerKey ?? BP_DEFAULTS.lsmBitsPerKey,
    rand: typeof opts.rand === 'function' ? opts.rand : lcg(opts.lcgSeed ?? BP_DEFAULTS.lcgSeed),
  })

  const valueOf = (i) => i
  for (let i = 0; i < keys.length; i++) { tree.put(keys[i], valueOf(i)); lsm.put(keys[i], valueOf(i)) }
  lsm.flush()
  for (let i = 0; i < keys.length; i++) {
    if (overwriteEvery > 0 && i % overwriteEvery === 0) {
      const v = keys.length + i
      tree.put(keys[i], v)
      lsm.put(keys[i], v)
    }
  }
  lsm.flush()
  lsm.compact()
  lsm.flush() // 让 memtable 清空，读账全部落在层/段上，读放大可复现

  // ── ① 点查比较数（stats 差分取纯读账）──
  const bpC0 = tree.stats().comparisons
  const lsmC0 = lsm.stats().comparisons
  let pointMismatches = 0
  for (const k of probes) {
    const a = tree.get(k)
    const b = lsm.get(k)
    if (a.found !== b.found || (a.found && !Object.is(a.value, b.value))) pointMismatches++
  }
  const bplusPointComparisons = tree.stats().comparisons - bpC0
  const lsmPointComparisons = lsm.stats().comparisons - lsmC0
  const lsmPoint = lsm.stats()

  // ── ② 范围查结构代价 ──
  const bpR0 = tree.stats().comparisons
  const hops0 = tree.stats().rangeLeafHops
  const lsmR0 = lsm.stats().comparisons
  let rangeMismatches = 0
  let bplusRangeResults = 0
  let lsmRangeResults = 0
  for (const [lo, hi] of rangeQueries) {
    const a = tree.range(lo, hi)
    const b = lsm.range(lo, hi)
    bplusRangeResults += a.length
    lsmRangeResults += b.length
    if (a.length !== b.length) { rangeMismatches++; continue }
    for (let i = 0; i < a.length; i++) {
      if (compare(a[i].key, b[i].key) !== 0 || !Object.is(a[i].value, b[i].value)) { rangeMismatches++; break }
    }
  }
  const bplusRangeComparisons = tree.stats().comparisons - bpR0
  const bplusLeafHops = tree.stats().rangeLeafHops - hops0
  const lsmRangeComparisons = lsm.stats().comparisons - lsmR0
  const lsmStats = lsm.stats()
  const lsmSegmentsTouched = lsmStats.levels.reduce((m, t) => m + t.segments, 0)
  const lsmEntriesScanned = lsmStats.levels.reduce((m, t) => m + t.entries, 0) + lsmStats.memtableSize
  // LSM 收集所有段后要全量排序（KI-496 明写「非归并堆迭代」）：n·log2(n) 模型比较数。
  const lsmSortComparisons = lsmRangeResults > 1 ? Math.round(lsmRangeResults * Math.log2(lsmRangeResults)) : 0
  // B+ 叶链顺序扫：定位首叶的二分 + 沿链跳，结果天然有序、无排序阶段。
  const bplusRangeCost = bplusRangeComparisons + bplusLeafHops
  const lsmRangeCost = lsmRangeComparisons + lsmEntriesScanned + lsmSortComparisons

  // ── ③ 写放大 / I/O 模式（两件各自的结构重写模型，横向摆、不混成一个数）──
  const bt = tree.stats()
  const bplusWrite = {
    puts: bt.puts, splits: bt.splits, merges: bt.merges, borrows: bt.borrows,
    pageRewrites: bt.pageRewrites, height: bt.height, leafCount: bt.leafCount,
  }
  const lsmWrite = {
    writes: lsmStats.writes, flushes: lsmStats.flushes, compactions: lsmStats.compactions,
    mergedAway: lsmStats.mergedAway, tombstonesDropped: lsmStats.tombstonesDropped,
    walEntries: lsmStats.wal.entries,
    // 顺序写盘单元模型：WAL 条 + flush 段 + compaction 次 + 被归并掉的旧版本数。非字节/墙钟。
    seqWriteUnits: lsmStats.wal.entries + lsmStats.flushes + lsmStats.compactions
      + lsmStats.mergedAway + lsmStats.tombstonesDropped,
  }

  // ── 判词：逐维给谁优，不封全局赢家 ──
  const pointFavors = bplusPointComparisons === lsmPointComparisons ? 'tie'
    : (bplusPointComparisons < lsmPointComparisons ? 'bplus' : 'lsm')
  const rangeFavors = bplusRangeCost === lsmRangeCost ? 'tie'
    : (bplusRangeCost < lsmRangeCost ? 'bplus' : 'lsm')
  const writeFavors = lsmWrite.seqWriteUnits === bplusWrite.pageRewrites ? 'tie'
    : (lsmWrite.seqWriteUnits < bplusWrite.pageRewrites ? 'lsm' : 'bplus')
  const bothAgree = pointMismatches === 0 && rangeMismatches === 0
  const verdict = {
    bothAgree,                                        // 先决条件：答案分叉则下面全不作数
    pointFavors,
    rangeFavors,
    writeFavors,
    bplusPointFewerComparisons: pointFavors === 'bplus',
    // 真判据（不是恒真）：B+ 范围查只沿叶链跳、结构代价 = 定位比较 + 叶跳，**没有**排序项；
    // LSM 则确确实实付了「跨段收集（entriesScanned）+ 全量排序（sortComparisons）」两项。
    // 摘掉任一侧结构事实这条就红，可被反向臂证伪。
    bplusRangeIsSequential: bplusLeafHops <= bt.leafCount && lsmSortComparisons > 0
      && bplusRangeCost === bplusRangeComparisons + bplusLeafHops,
    lsmRangeNeedsMergeSort: lsmEntriesScanned >= lsmRangeResults && lsmSortComparisons > 0,
    bplusPaysInPlaceRewrites: bplusWrite.pageRewrites > bplusWrite.puts,
    lsmPaysCompactionRewrites: lsmWrite.mergedAway > 0 || lsmWrite.compactions > 0,
    lsmReadIsCrossLevel: (lsmPoint.sstableGets ?? 0) + (lsmPoint.bloomRejected ?? 0) > 0,
    // 不封全局赢家：三维不是被同一引擎全拿（否则那只是这组 order/段数下的巧合，换配置会翻）。
    noUniversalWinner: !(pointFavors === rangeFavors && rangeFavors === writeFavors),
    agreeIsPrerequisite: bothAgree,                   // 答案一致才允许把下面的性能对照当真
  }

  return {
    config: {
      keys: keys.length, probes: probes.length, rangeQueries: rangeQueries.length,
      order: tree.order, fanout: tree.fanout, leafCapacity: tree.leafCapacity,
      overwriteEvery, lsmMemtableMax: opts.lsmMemtableMax ?? BP_DEFAULTS.lsmMemtableMax,
    },
    bplus: {
      height: bt.height, heightEstimate: heightEstimate(keys.length, tree.order, tree.leafCapacity),
      leafCount: bt.leafCount, nodeCount: bt.nodeCount, invariants: tree.validate().length,
      pointComparisons: bplusPointComparisons, rangeComparisons: bplusRangeComparisons,
      leafHops: bplusLeafHops, rangeResults: bplusRangeResults, rangeCost: bplusRangeCost,
      write: bplusWrite,
    },
    lsm: {
      levels: lsmStats.levels, flushes: lsmStats.flushes, compactions: lsmStats.compactions,
      bloomRejects: lsmPoint.bloomRejected ?? 0, sstableGets: lsmPoint.sstableGets ?? 0,
      pointComparisons: lsmPointComparisons, rangeComparisons: lsmRangeComparisons,
      segmentsTouched: lsmSegmentsTouched, entriesScanned: lsmEntriesScanned,
      sortComparisons: lsmSortComparisons, rangeResults: lsmRangeResults, rangeCost: lsmRangeCost,
      write: lsmWrite,
    },
    agreement: { pointMismatches, rangeMismatches, bothAgree },
    verdict,
    builtAt: now(),
  }
}
/**
 * 汇总成纯数据 study（给 status / 前端 / CLI 一份可 JSON 序列化的证据）。
 * `heightLadder` 用数学估计展示「order 越大扇出越高、层高越低」，与真树实测 height 并排、不混谈。
 */
export function bplusStudy(opts = {}) {
  const comparison = compareBplusVsLsm(opts)
  const orders = Array.isArray(opts.heightLadder) ? opts.heightLadder : BP_DEFAULTS.heightLadder
  const leafCap = opts.leafCapacity ?? BP_DEFAULTS.leafCapacity
  const heightLadder = orders.map((o) => {
    let order = Math.max(2, Math.floor(Number(o) || BP_DEFAULTS.order))
    if (order % 2 !== 0) order++
    return { order, fanout: order, heightEstimate: heightEstimate(comparison.config.keys, order, leafCap) }
  })
  return {
    generator: 'caesura-bplus-tree',
    comparison,
    heightLadder,
    verdict: comparison.verdict,
    builtAt: typeof opts.now === 'function' ? opts.now() : Date.now(),
  }
}

/** 把 study 收敛成前端友好的只读结构（node 侧判词，前端只渲染、不复核、不实测）。 */
export function bpSnapshot(study) {
  if (!study || typeof study !== 'object') return null
  const c = study.comparison
  return {
    config: c.config,
    structure: {
      height: c.bplus.height, heightEstimate: c.bplus.heightEstimate,
      leafCount: c.bplus.leafCount, nodeCount: c.bplus.nodeCount,
      order: c.config.order, fanout: c.config.fanout, invariants: c.bplus.invariants,
      heightLadder: study.heightLadder,
    },
    point: {
      bplusComparisons: c.bplus.pointComparisons, lsmComparisons: c.lsm.pointComparisons,
      favors: c.verdict.pointFavors,
    },
    range: {
      bplusCost: c.bplus.rangeCost, lsmCost: c.lsm.rangeCost,
      bplusLeafHops: c.bplus.leafHops, bplusResults: c.bplus.rangeResults,
      lsmSegments: c.lsm.segmentsTouched, lsmSortComparisons: c.lsm.sortComparisons,
      lsmResults: c.lsm.rangeResults, favors: c.verdict.rangeFavors,
    },
    write: {
      bplusPageRewrites: c.bplus.write.pageRewrites, bplusSplits: c.bplus.write.splits,
      bplusMerges: c.bplus.write.merges, bplusBorrows: c.bplus.write.borrows,
      lsmSeqWriteUnits: c.lsm.write.seqWriteUnits, lsmFlushes: c.lsm.write.flushes,
      lsmCompactions: c.lsm.write.compactions, lsmMergedAway: c.lsm.write.mergedAway,
      favors: c.verdict.writeFavors,
    },
    levels: c.lsm.levels,
    agreement: c.agreement,
    verdict: c.verdict,
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const study = bplusStudy()
  const c = study.comparison
  const round = (x) => Number.isFinite(x) ? Number(x.toFixed(2)) : x
  console.log(JSON.stringify({
    generator: 'caesura-bplus-tree',
    config: c.config,
    bplus: {
      height: c.bplus.height, heightEstimate: c.bplus.heightEstimate,
      leafCount: c.bplus.leafCount, nodeCount: c.bplus.nodeCount, invariants: c.bplus.invariants,
      pointComparisons: c.bplus.pointComparisons,
      range: { cost: c.bplus.rangeCost, leafHops: c.bplus.leafHops, results: c.bplus.rangeResults },
      write: c.bplus.write,
    },
    lsm: {
      levels: c.lsm.levels, flushes: c.lsm.flushes, compactions: c.lsm.compactions,
      bloomRejects: c.lsm.bloomRejects, sstableGets: c.lsm.sstableGets,
      pointComparisons: c.lsm.pointComparisons,
      range: { cost: c.lsm.rangeCost, segments: c.lsm.segmentsTouched, sortComparisons: c.lsm.sortComparisons, results: c.lsm.rangeResults },
      write: c.lsm.write,
    },
    heightLadder: study.heightLadder,
    agreement: c.agreement,
    verdict: c.verdict,
    ratios: {
      pointBplusVsLsm: round(c.bplus.pointComparisons / Math.max(1, c.lsm.pointComparisons)),
      rangeBplusVsLsm: round(c.bplus.rangeCost / Math.max(1, c.lsm.rangeCost)),
      writeBplusVsLsm: round(c.bplus.write.pageRewrites / Math.max(1, c.lsm.write.seqWriteUnits)),
    },
  }, null, 2))
}
