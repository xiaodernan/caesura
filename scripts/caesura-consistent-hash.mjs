/**
 * scripts/caesura-consistent-hash.mjs —— 一致性哈希环 / 虚拟节点 / 缓存分片教学件（Node.js 侧，KI-499）。
 *
 * <p>它解决的是分布式缓存分片与服务发现扩缩容的核心算法问题：朴素 `hash(key) mod N`
 * 在节点数 N 变化时几乎**全部 key 重新落点**（扩容 N→N+1 约 N/(N+1) 的 key 迁移），缓存命中率
 * 瞬间崩塌、会话全体重路由；**一致性哈希 + 虚拟节点**把迁移压到理论下界 `|M−N|/max(N,M)`
 * 并让负载均匀。这是 Redis Cluster / 分布式缓存 / 服务发现扩缩容的基石算法，本件把它做成
 * 可断言的纯 JS 状态机。</p>
 *
 * <p><b>判定权仍 Node 侧（决策原则①）</b>：哈希函数 `hashFn`、虚拟节点数 `virtualNodes`、
 * 加权 `weightOf`、槽数 `slotCount`、节点集一律由构造/调用方注入；本件不写业务阈值，
 * 缺省值只是教学常见值。全零依赖、可 headless 确定性测。</p>
 *
 * <p><b>诚实边界（不声称）</b>：①不是真 Redis Cluster / 生产一致性哈希——无副本、无虚拟节点
 * 持久化、无故障转移、无数据搬迁执行，只做**路由判定**与**迁移计数**；②默认 `hashRing:false`
 * 不参与负载均衡或缓存路由，接进 cloud 也只挂 `status.hashRing` 读数，不改任何调用结果；
 * ③重映射率是**结构计数比**、不是墙钟时间/网络带宽/缓存命中率，缺省 FNV-1a 是教学哈希
 * 非加密级，虚拟节点/权重/哈希全可注入、真集群须实测调参；④虚拟节点分布**不对所有 key 集
 * 都完美均匀**——`distribution().balanceRatio` 如实给出有限样本下的最大最小比，小虚拟节点数
 * 会偏斜，这条偏差本身就是可断言判词；另外纯 FNV-1a 对相近短串（如 `a#0/a#1`）雪崩差、环点会成团，
 * 故缺省哈希用 `ringHash`（FNV-1a + Murmur 风格 32 位雪崩终混）打散，注入纯 `fnv1a` 且虚拟节点
 * 少时可复现偏斜，正好量出「好哈希 + 足量虚拟节点」为何必要。⑤空环 `lookup` 回 `null`、不凭空造节点。</p>
 *
 * 用法：
 *   const ring = createHashRing({ nodes: ['cache-a', 'cache-b', 'cache-c'] })
 *   ring.lookup('player:42').nodeId            // 稳定落点
 *   const cmp = compareRemapping({ nodes: ['a','b','c'], addNodes: ['d'], keys })
 *   cmp.consistent.rate < cmp.modulo.rate      // 扩容只动约 1/(N+1)，取模动约 N/(N+1)
 *   const router = createShardRouter({ nodes: ['a','b','c'] })
 *   router.route('player:42')                  // { shard, nodeId, slot }
 * </p>
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** 缺省参数，导出供 runtime / 文档 / 测试引用（判定仍由注入值定，这里只是教学常见值）。 */
export const HASH_DEFAULTS = Object.freeze({
  virtualNodes: 128,
  salt: 'caesura-ring',
  slotCount: 16384,
  maxTrackedKeys: 50000,
})

/** FNV-1a 32 位：确定性、无依赖、可注入替代；返回 [0, 2^32) 无符号整数。 */
export function fnv1a(str, seed = 2166136261) {
  let h = seed >>> 0
  const s = String(str == null ? '' : str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** MurmurHash3 风格 32 位雪崩终混：把相近输入（如 `a#0/a#1`）的输出彻底打散。 */
function avalanche32(h) {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * 缺省环哈希：FNV-1a + 雪崩终混。纯 FNV-1a 对相近短串雪崩差（环点成团 ⇒ 分布偏斜），
 * 加一层终混后虚拟节点能均匀铺满环；仍可注入任意 `(str)=>number` 覆盖（含纯 `fnv1a`，用于对照偏斜）。
 */
export function ringHash(str, seed = 2166136261) {
  return avalanche32(fnv1a(str, seed))
}

function normalizeCount(v, dflt, min, max) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : dflt
}

function normalizeWeight(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 1
}

const round6 = (x) => Math.round(x * 1e6) / 1e6

/**
 * 把注入 hashFn 的返回值统一到 [0,1) 的环坐标：
 * - 注入缺省 fnv1a（uint32）⇒ 除以 2^32 归一；
 * - 注入返回 [0,1) 的 selector（如 KI-491 hashSelector）⇒ 直接用；
 * - 非数/抛错 ⇒ 回退 fnv1a，保证环确定性、不产生 NaN 排序键。
 */
function makeUnit(hashFn, salt) {
  const h = typeof hashFn === 'function' ? hashFn : ringHash
  const prefix = `${String(salt)}|`
  return (label) => {
    const str = prefix + String(label)
    let raw
    try { raw = h(str) } catch { raw = ringHash(str) }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) raw = ringHash(str)
    return raw >= 0 && raw < 1 ? raw : ((raw >>> 0) / 0x100000000)
  }
}

/** 环点稳定排序：先坐标，再节点 id、虚拟序号（同 hash 碰撞时仍确定性）。 */
function comparePoints(a, b) {
  if (a.point !== b.point) return a.point - b.point
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1
  return a.vIndex - b.vIndex
}

/**
 * 造一只虚拟节点一致性哈希环。
 * @param {object} [opts] {
 *   hashFn?:(str:string)=>number, salt?:string, virtualNodes?:number,
 *   weightOf?:(nodeId:string)=>number, nodes?:string[]
 * }
 */
export function createHashRing(opts = {}) {
  const hashFn = opts.hashFn
  const salt = opts.salt ?? HASH_DEFAULTS.salt
  const virtualNodes = normalizeCount(opts.virtualNodes, HASH_DEFAULTS.virtualNodes, 1, 4096)
  const weightOf = typeof opts.weightOf === 'function' ? opts.weightOf : () => 1
  const unit = makeUnit(hashFn, salt)
  const nodes = new Map() // id -> { id, weight, virtualPoints }
  let ring = []           // 排序后的全部虚拟环点
  let dirty = false

  /** 每实节点放 `round(virtualNodes × weight)` 枚虚拟点（至少 1、至多 4096 防爆）。 */
  function buildVirtualPoints(id, weight) {
    const count = Math.max(1, Math.min(4096, Math.round(virtualNodes * weight)))
    const vps = []
    for (let i = 0; i < count; i++) {
      vps.push({ point: unit(`${id}#${i}`), nodeId: id, vIndex: i })
    }
    return vps.sort(comparePoints)
  }

  function rebuild() {
    if (!dirty) return
    ring = []
    for (const n of nodes.values()) for (const vp of n.virtualPoints) ring.push(vp)
    ring.sort(comparePoints)
    dirty = false
  }

  /** 加实节点；已存在时不重复放点，返回 {added, virtualPoints}。 */
  function addNode(id) {
    const key = String(id)
    if (nodes.has(key)) return { added: false, virtualPoints: nodes.get(key).virtualPoints.length }
    const weight = normalizeWeight(weightOf(key))
    const vps = buildVirtualPoints(key, weight)
    nodes.set(key, { id: key, weight, virtualPoints: vps })
    dirty = true
    return { added: true, virtualPoints: vps.length }
  }

  /** 移除实节点；不存在返回 {removed:false, virtualPoints:0}，不凭空造节点。 */
  function removeNode(id) {
    const key = String(id)
    const n = nodes.get(key)
    if (!n) return { removed: false, virtualPoints: 0 }
    const count = n.virtualPoints.length
    nodes.delete(key)
    dirty = true
    return { removed: true, virtualPoints: count }
  }

  function hasNode(id) { return nodes.has(String(id)) }
  function nodeIds() { return [...nodes.keys()].sort() }

  /**
   * 查 key 归属：二分找首枚 `point ≥ hash(key)` 的虚拟点，越尾回绕到第 0 枚（环形）。
   * 空环回 `nodeId:null`；`comparisons` 是二分比较次数（教学读数）。
   */
  function lookup(key) {
    rebuild()
    if (ring.length === 0) return { nodeId: null, point: null, virtualPoint: null, comparisons: 0 }
    const target = unit(String(key == null ? '' : key))
    let lo = 0, hi = ring.length, comparisons = 0
    while (lo < hi) {
      comparisons++
      const mid = (lo + hi) >>> 1
      if (ring[mid].point < target) lo = mid + 1
      else hi = mid
    }
    const vp = ring[lo < ring.length ? lo : 0]
    return { nodeId: vp.nodeId, point: vp.point, virtualPoint: vp.vIndex, comparisons }
  }

  /**
   * 分布读数：拿一批 key 逐个 lookup，回各节点命中数/占比、最大最小比 `balanceRatio`
   * （虚拟节点越多越均匀）、`emptyNodes`（零命中节点，不除零）。
   */
  function distribution(keys) {
    rebuild()
    const list = Array.isArray(keys) ? keys : []
    const perNode = {}
    for (const id of nodes.keys()) perNode[id] = { hits: 0, ratio: 0 }
    let unrouted = 0
    for (const k of list) {
      const nodeId = lookup(k).nodeId
      if (nodeId === null) unrouted++
      else perNode[nodeId].hits++
    }
    const total = list.length
    let min = Infinity, max = 0
    const emptyNodes = []
    for (const [id, v] of Object.entries(perNode)) {
      v.ratio = total > 0 ? round6(v.hits / total) : 0
      if (v.hits === 0) emptyNodes.push(id)
      if (v.hits < min) min = v.hits
      if (v.hits > max) max = v.hits
    }
    if (!Number.isFinite(min)) min = 0
    return {
      total, unrouted, nodes: nodes.size, perNode, min, max, emptyNodes,
      balanceRatio: min > 0 ? round6(max / min) : null,
    }
  }

  /** 纯数据快照（不含函数/Map）；`ring:false` 可省去环点明细（status 轮询用）。 */
  function snapshot(opts2 = {}) {
    rebuild()
    const out = {
      nodes: nodeIds(), virtualNodes, salt, virtualPoints: ring.length,
      weights: Object.fromEntries([...nodes.values()].map((n) => [n.id, n.weight])),
    }
    if (opts2.ring !== false) out.ring = ring.map((vp) => ({ point: vp.point, nodeId: vp.nodeId, vIndex: vp.vIndex }))
    return out
  }

  function reset() { nodes.clear(); ring = []; dirty = false }

  for (const id of Array.isArray(opts.nodes) ? opts.nodes : []) addNode(id)

  return { hashFn: hashFn ?? ringHash, salt, virtualNodes, addNode, removeNode, hasNode, nodeIds, lookup, distribution, snapshot, reset }
}

/**
 * 最小重映射对照：对同一批 key，比较「一致性哈希环」与「朴素取模」在节点集变化时的迁移率。
 * @param {object} [opts] { nodes?:string[], addNodes?:string[], removeNodes?:string[], keys?:any[],
 *   hashFn?, salt?, virtualNodes?, weightOf? }
 */
export function compareRemapping(opts = {}) {
  const baseNodes = (Array.isArray(opts.nodes) ? opts.nodes : []).map(String)
  const add = (Array.isArray(opts.addNodes) ? opts.addNodes : []).map(String)
  const removedSet = new Set((Array.isArray(opts.removeNodes) ? opts.removeNodes : []).map(String))
  const baseSet = new Set(baseNodes)
  const afterSet = new Set(baseNodes)
  for (const id of add) afterSet.add(id)
  for (const id of removedSet) afterSet.delete(id)
  const afterNodes = [...afterSet].sort()

  const keys = Array.isArray(opts.keys) ? opts.keys : []
  const ringOpts = { hashFn: opts.hashFn, salt: opts.salt, virtualNodes: opts.virtualNodes, weightOf: opts.weightOf }
  const before = createHashRing({ ...ringOpts, nodes: baseNodes })
  const after = createHashRing({ ...ringOpts, nodes: afterNodes })
  const unit = makeUnit(opts.hashFn, opts.salt ?? HASH_DEFAULTS.salt)
  const N = baseNodes.length, M = afterNodes.length
  const modSlot = (key, count) => count > 0 ? Math.floor(unit(key) * count) % count : null

  let consistentMoved = 0, moduloMoved = 0
  for (const k of keys) {
    const str = String(k == null ? '' : k)
    if (before.lookup(str).nodeId !== after.lookup(str).nodeId) consistentMoved++
    if (modSlot(str, N) !== modSlot(str, M)) moduloMoved++
  }
  const total = keys.length
  const consistentRate = total > 0 ? round6(consistentMoved / total) : 0
  const moduloRate = total > 0 ? round6(moduloMoved / total) : 0
  const theoreticalRate = Math.max(N, M) > 0 ? round6(Math.abs(M - N) / Math.max(N, M)) : 0

  return {
    beforeNodes: baseNodes.slice().sort(), afterNodes, beforeCount: N, afterCount: M,
    delta: M - N, keys: total,
    added: afterNodes.filter((id) => !baseSet.has(id)),
    removed: baseNodes.filter((id) => !afterSet.has(id)).sort(),
    consistent: { moved: consistentMoved, total, rate: consistentRate },
    modulo: { moved: moduloMoved, total, rate: moduloRate },
    savedRate: round6(moduloRate - consistentRate),
    theoreticalRate,
    beforeVirtualPoints: before.snapshot({ ring: false }).virtualPoints,
    afterVirtualPoints: after.snapshot({ ring: false }).virtualPoints,
  }
}

/**
 * 缓存分片定位器：同 key 恒落同一分片与同一槽（类 Redis 槽位概念），节点集变化时可读迁移数。
 * @param {object} [opts] { ring?:HashRing, shards?:string[], nodes?:string[], slotCount?:number,
 *   maxTrackedKeys?:number, ...createHashRing 的注入项 }
 */
export function createShardRouter(opts = {}) {
  const slotCount = normalizeCount(opts.slotCount, HASH_DEFAULTS.slotCount, 1, 1e9)
  const maxTracked = normalizeCount(opts.maxTrackedKeys, HASH_DEFAULTS.maxTrackedKeys, 0, 1e7)
  const initialNodes = Array.isArray(opts.shards) ? opts.shards : (Array.isArray(opts.nodes) ? opts.nodes : [])
  let ring = opts.ring && typeof opts.ring.lookup === 'function'
    ? opts.ring
    : createHashRing({ ...opts, nodes: initialNodes })
  const unit = makeUnit(opts.hashFn, opts.salt ?? HASH_DEFAULTS.salt)
  const tracked = []
  const trackedSet = new Set()

  function track(str) {
    if (trackedSet.has(str) || tracked.length >= maxTracked) return
    trackedSet.add(str)
    tracked.push(str)
  }

  /** 路由：回 `{shard,nodeId,slot,comparisons}`；空环 shard 为 null、slot 仍是 key 的稳定槽。 */
  function route(key) {
    const str = String(key == null ? '' : key)
    track(str)
    const found = ring.lookup(str)
    return {
      shard: found.nodeId, nodeId: found.nodeId,
      slot: Math.floor(unit(str) * slotCount) % slotCount,
      comparisons: found.comparisons,
    }
  }

  /** 节点集变化后重绑环并报迁移键数（对已见过的 key 逐个复查）；默认替换当前环。 */
  function remapOn(nodes, opts2 = {}) {
    const list = Array.isArray(nodes) ? nodes.map(String) : []
    const before = {}
    for (const k of tracked) before[k] = ring.lookup(k).nodeId
    const next = createHashRing({ ...opts, nodes: list })
    let moved = 0
    for (const k of tracked) if (before[k] !== next.lookup(k).nodeId) moved++
    if (opts2.mutate !== false) ring = next
    return {
      moved, total: tracked.length,
      rate: tracked.length > 0 ? round6(moved / tracked.length) : 0,
      from: ring.nodeIds ? ring.nodeIds() : [],
      to: list.slice().sort(),
      snapshot: next.snapshot({ ring: false }),
    }
  }

  function snapshot() {
    return {
      slotCount, trackedKeys: tracked.length,
      nodes: ring.nodeIds ? ring.nodeIds() : [],
      virtualPoints: ring.snapshot ? ring.snapshot({ ring: false }).virtualPoints : null,
    }
  }

  return { slotCount, route, remapOn, snapshot, nodes: () => (ring.nodeIds ? ring.nodeIds() : []) }
}

/** CLI：直接运行时打印「扩容最小重映射 vs 取模」与分布均匀度证据；被 import 时只交出函数。 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = 10000
  const nodes = ['cache-a', 'cache-b', 'cache-c']
  const keys = Array.from({ length: count }, (_, i) => `player:${i}`)
  const ring = createHashRing({ nodes })
  const distribution = ring.distribution(keys)
  const grow = compareRemapping({ nodes, addNodes: ['cache-d'], keys })
  const shrink = compareRemapping({ nodes, removeNodes: ['cache-c'], keys })
  const router = createShardRouter({ nodes })
  const sample = router.route('player:42')
  const evidence = {
    nodes, keys: count, virtualNodes: HASH_DEFAULTS.virtualNodes,
    distribution: {
      perNode: Object.fromEntries(Object.entries(distribution.perNode).map(([id, v]) => [id, v.ratio])),
      balanceRatio: distribution.balanceRatio,
      emptyNodes: distribution.emptyNodes,
    },
    grow: { delta: grow.delta, consistentRate: grow.consistent.rate, moduloRate: grow.modulo.rate, theoreticalRate: grow.theoreticalRate, savedRate: grow.savedRate },
    shrink: { delta: shrink.delta, consistentRate: shrink.consistent.rate, moduloRate: shrink.modulo.rate, theoreticalRate: shrink.theoreticalRate, savedRate: shrink.savedRate },
    shardSample: sample,
  }
  console.log(JSON.stringify(evidence, null, 2))
  process.exit(0)
}
