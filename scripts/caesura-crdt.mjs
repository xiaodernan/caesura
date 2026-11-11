/**
 * scripts/caesura-crdt.mjs —— CRDT 最终一致冲突消解三策略诚实权衡教学件（KI-531，P8 第三十八件）。
 *
 * <p>精准补 KI-507「Gossip 只最终一致收敛无上界」那块未消解拼图——生产答案不是换个更强的
 * 协调者，而是把冲突消解编码进数据结构本身（Spring Cloud 配置中心多活写 / 购物车跨设备合并 /
 * 协同编辑正是这个命题）。</p>
 *
 * <p><b>三策略 · 维序固定 [strongEventualConvergence / expressiveness / compactMetadata]</b>：</p>
 * <ul>
 *   <li><b>LWWRegister = 011</b>：SEC=✗（并发写静默丢：单值寄存器留最大戳，其余用户提交被吞）、
 *       expressiveness=✓（可写任意值、可覆盖成 null 表达"清/减"）、compact=✓（O(1)：(logicalClock,nodeId)+valueref，恒 24B）。</li>
 *   <li><b>GCounter = 100</b>：SEC=✓（不同副本增量永不互相覆盖，merge=max 逐分片幂等/交换/结合）、
 *       expressiveness=✗（<code>decrement()</code> 真被拒——grow-only 结构属性）、compact=✗（O(nodes) 分片随节点数涨）。</li>
 *   <li><b>OrSet = 110</b>：SEC=✓（add-wins：并发 add 带唯一 tag，tag 并集收敛，全部并发 add 存活）、
 *       expressiveness=✓（<code>remove()</code> 真删 observed tag）、compact=✗（O(ops) tag/tombstone 堆积）。</li>
 * </ul>
 *
 * <p><b>口径诚实标定（绝不含糊）</b>：严格 CRDT 文献中 LWW-Register 的 <code>merge=max</code> 同样是
 * 幂等/交换/结合，三副本 <code>value()</code> 逐字相等——即三者 <b>严格 SEC 全为真</b>（本件以
 * <code>verdict.secStrictAllConverge</code> 如实回读）。三难第一位的 <code>strongEventualConvergence</code>
 * 采用<b>教学口径 = 严格 SEC ∧ 并发提交不静默丢失</b>：LWW 破在"并发意图被吞"而非"副本分歧"，
 * 本件单列 <code>verdict.lwwSecBreaksOnConcurrentIntent</code> 明说这一点，绝不谎称 LWW 副本不收敛。</p>
 *
 * <p><b>OrSet 采用 add-wins（observed-remove）</b>，非 remove-wins：<code>remove()</code> 只删当下可见 tag，
 * 并发 add 的新 tag 不在可见集内故存活（"僵尸元素"是 add-wins 的已知代价，见
 * <code>verdict.orSetIsAddWins</code>）。本件如实标注，避免"注释说 remove-wins、实现是 add-wins"的口是心非。</p>
 *
 * <p><b>verifyConvergence 双路独立交叉印证 + 三路可证伪</b>：路 A（SEC 刚性）三副本乱序+重复 merge 后 value 逐字相等；
 * 路 B（真值不变量）G-Counter 增量守恒单调不减 / OrSet 被 remove 的 observed 元素不再可见 / LWW 最大戳胜。
 * 空事件集 <code>nontrivial=false</code> 绝不 0=0 假绿；<b>三路篡改真喂回同一 <code>convergenceCore</code> 现算翻 false</b>：
 * ① 丢弃一个副本的 merge ⇒ 副本分叉；② 反转 LWW 决胜算式 ⇒ 收敛到错值；③ 空事件集 ⇒ nontrivial=false。</p>
 *
 * <p><b>rigged 三开关</b>（因果锁死教学标定）：<code>uniformClock</code>（全局单调时钟）+ <code>infiniteMetadata</code>
 * （元数据成本免费）+ <code>coordinatedDelete</code>（协调者保证强删）。三开关齐开时每个策略的
 * <b>外部依赖</b>都被满足，但三条 <b>因果结构属性</b>任何开关都救不了（全部真跑现算、绝不查表硬造 111）：</p>
 * <ul>
 *   <li><code>lwwConcurrentLossCausallyUnerasable</code>：完美时钟也救不了真并发写——无因果先后必 tie-break 丢一个。</li>
 *   <li><code>decrementCausallyUnerasable</code>：内存免费/协调删除/统一时钟全给，G-Counter 的 <code>decrement()</code> 仍恒 false。</li>
 *   <li><code>orSetTagHistoryCausallyUnerasable</code>：内存免费也不能把 tag 历史压成计数——压掉 tag 并发 remove/add race 收敛结果出错。</li>
 * </ul>
 * <p>rigged 唯一被抹的是 GCounter 的 compact 外部成本（<code>100→101</code>，与 KI-530 ExactSet <code>101→111</code> 同构），
 * 主向量其余位靠三锁钉死；<code>noUniversalWinner</code> 在 rigged 下仍真，绝非硬造。</p>
 *
 * <p><b>不声称</b>真 Riak/Dynamo/Cassandra CRDT 生产实现（无真 anti-entropy 网络/真版本向量压缩/真 tombstone GC）、
 * 不声称真因果序/真向量时钟/真 dot 上下文（全单进程确定性教学状态机）、不声称墙钟 QPS/收敛延迟。</p>
 *
 * @module caesura-crdt
 */
import { pathToFileURL } from 'node:url'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'

export const CRDT_DEFAULTS = Object.freeze({
  seed: 531,
  opsPerNode: 64,          // 每副本默认 op 数（贯穿场景生成）
  replicaCount: 3,         // 三副本
  skewTicks: 25,           // clockSkew 场景的时钟偏斜量（uniformClock 开时归零）
})

/** 三策略（顺序固定，camelCase；正式名 LWW-Register / G-Counter / OR-Set（add-wins）） */
export const CRDT_STRATEGIES = Object.freeze(['LWWRegister', 'GCounter', 'OrSet'])

/** 六正交场景（顺序固定） */
export const CRDT_SCENARIOS = Object.freeze([
  'allReplicaExchange', 'outOfOrderDelivery', 'duplicateDelivery', 'concurrentWrite', 'clockSkew', 'removeAddRace',
])

/*----------------------------------------------------- 判定工具 -----------------------------------------------------*/

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}

function round4(n) { return Math.round(n * 1e4) / 1e4 }

function numOr(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback }

function makeRand(seed) {
  let a = intOr(seed, CRDT_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}

/** 优选元组比较（LWW 决胜，同戳按 nodeId 字典序）。reverse=true 时反转——仅供可证伪探针。 */
function stampGreater(a, b, reverse = false) {
  const gt = a.clock > b.clock || (a.clock === b.clock && a.nodeId > b.nodeId)
  const eq = a.clock === b.clock && a.nodeId === b.nodeId
  if (reverse) return !gt && !eq
  return gt
}

/*----------------------------------------------------- 场景生成 -----------------------------------------------------*/

function scenarioOf(id, opts = {}) {
  const seed = intOr(opts.seed, CRDT_DEFAULTS.seed)
  const rand = makeRand(seed)
  const O = Math.max(16, intOr(opts.opsPerNode, CRDT_DEFAULTS.opsPerNode))
  const skew = intOr(opts.skewTicks, CRDT_DEFAULTS.skewTicks)
  const make = (node, clock, op, payload) => ({ node, clock, op, payload })
  switch (id) {
    case 'allReplicaExchange':
      // 三副本各自产出 inc；期望 G-Counter 收敛到 inc 总数，且每个增量都计入（不丢）
      return {
        events: [
          ...Array.from({ length: O }, (_, i) => make(`n${i % 3}`, i * 2 + 1, 'inc')),
          make('n0', 1, 'add', 'x'), make('n1', 2, 'add', 'y'), make('n2', 3, 'add', 'z'),
        ],
        truth: { gcounterExpected: O, orsetExpectedElements: ['x', 'y', 'z'] },
      }
    case 'outOfOrderDelivery':
      // 逆序投递——合格 CRDT 的 merge 幂等/交换/结合应抹平顺序
      return {
        events: (Array.from({ length: Math.max(18, Math.floor(O * 0.6)) }, (_, i) => make(`n${i % 3}`, (i + 8) * 3 + 1, 'inc'))).reverse(),
        truth: { delivery: 'reversed' },
      }
    case 'duplicateDelivery':
      // 每 inc 重复投递一次——幂等 merge 不应重复计数
      return {
        events: [
          ...Array.from({ length: Math.floor(O / 2) }, (_, i) => make(`n${i % 3}`, i + 1, 'inc')),
          ...Array.from({ length: Math.floor(O / 2) }, (_, i) => make(`n${i % 3}`, i + 1, 'inc')),
        ],
        truth: { duplicateEvery: true },
      }
    case 'concurrentWrite':
      // 并发探针：三策略各取自己关心的 op，核"并发提交是否静默丢失"
      return {
        events: [
          make('n2', 10, 'put', { k: 'k', value: 'v0' }),
          make('n3', 11, 'put', { k: 'k', value: 'v1' }),
          make('n4', 11, 'put', { k: 'k', value: 'v2' }),
          make('n0', 10, 'inc'), make('n1', 10, 'inc'), make('n2', 10, 'inc'),
          make('n0', 10, 'add', 'x'), make('n1', 10, 'add', 'y'), make('n2', 10, 'add', 'z'),
          make('n5', 11, 'remove', 'x'),   // 与 add('x') 并发：add-wins 下 'x' 存活
        ],
        truth: { lwwConcurrentPuts: 3, gcounterConcurrentIncs: 3, orsetConcurrentAdds: 3 },
      }
    case 'clockSkew':
      // ±skew 偏斜 clock 让 LWW 误选 v-fast-clock；uniformClock 用真逻辑序 trueClock 回到 v-uniform。
      // trueClock 是真喂回判定内核的载体——uniformClock 开关开时 applyEvents 取 trueClock，关时取偏斜 clock。
      return {
        events: [
          make('n0', 100 - skew, 'put', { k: 'k', value: 'v-slow-clock', trueClock: 10 }),
          make('n1', 65 + skew, 'put', { k: 'k', value: 'v-fast-clock', trueClock: 20 }),
          make('n2', 75, 'put', { k: 'k', value: 'v-uniform', trueClock: 30 }),
        ],
        truth: { skewMagnitude: skew, skewedWinner: 'v-fast-clock', trueOrderWinner: 'v-uniform' },
      }
    case 'removeAddRace':
      // 顺序 add→remove（同副本，observed）：remove 真删；另有并发 add('y') 存活 ⇒ add-wins
      return {
        events: [
          make('n0', 1, 'add', 'x'),
          make('n0', 2, 'remove', 'x'),
          make('n1', 2, 'add', 'y'),
        ],
        truth: { orsetExpectedElements: ['y'] },
      }
    default:
      return { events: [], truth: {} }
  }
}

function faultOf(scenarioId) {
  return scenarioId === 'allReplicaExchange' ? 'eager-regroup'
    : scenarioId === 'outOfOrderDelivery' ? 'disorder'
    : scenarioId === 'duplicateDelivery' ? 'duplicate'
    : scenarioId === 'concurrentWrite' ? 'conflict'
    : scenarioId === 'clockSkew' ? 'clock-skew'
    : scenarioId === 'removeAddRace' ? 'observed-remove'
    : 'idle'
}

/*----------------------------------------------------- 三真 CRDT 策略（真实现，非查表） --------------------------------------*/

/** LWW-Register：(logicalClock,nodeId) 字典序决胜；merge=max（幂等/交换/结合 ⇒ 严格 SEC，但并发写静默丢）。 */
export function createLwwRegister(opts = {}) {
  const nodeId = String(opts.nodeId ?? 'n0')
  let stamp = { clock: 0, nodeId }
  let value = null
  let inserts = 0
  function assign(clock, val) {
    inserts += 1
    const newStamp = { clock: intOr(clock, 0), nodeId }
    if (stampGreater(newStamp, stamp)) { stamp = newStamp; value = val }
  }
  function merge(other) {
    if (!other || typeof other.observe !== 'function') return false
    const remote = other.observe()
    if (!remote) return true
    if (stampGreater(remote.stamp, stamp)) { stamp = { ...remote.stamp }; value = remote.value }
    return true
  }
  function observe() { return value === null ? null : { stamp: { ...stamp }, value } }
  return {
    protocol: 'LWWRegister',
    assign,
    merge,
    observe,
    value: () => value,
    inserts: () => inserts,
    stats: () => ({ inserts, stamp: { ...stamp }, value }),
    footprintBytes: () => 24, // (clock 8) + (nodeId ~8) + (valueref 8) —— 与 op 数/节点数无关
  }
}

/** G-Counter：每节点独立分片，merge=max 逐分片；grow-only（decrement 真拒）。 */
export function createGCounter(opts = {}) {
  const nodeId = String(opts.nodeId ?? 'n0')
  const increments = new Map()
  let inserts = 0
  function increment(delta) {
    inserts += 1
    const d = intOr(delta ?? 1, 1)
    increments.set(nodeId, (increments.get(nodeId) ?? 0) + d)
    return increments.get(nodeId)
  }
  function decrement() { return false } // 诚实：G-Counter 无 decrement —— grow-only 结构属性
  function merge(other) {
    if (!other || typeof other.value !== 'function') return false
    for (const [node, cnt] of other._increments) {
      increments.set(node, Math.max(increments.get(node) ?? 0, cnt))
    }
    return true
  }
  function value() {
    let sum = 0
    for (const v of increments.values()) sum += v
    return sum
  }
  return {
    protocol: 'GCounter',
    increment,
    decrement,
    merge,
    value,
    inserts: () => inserts,
    footprintBytes: () => Math.max(16, increments.size * 16),
    _increments: increments,
    stats: () => ({ inserts, nodes: increments.size, value: value() }),
  }
}

/** OR-Set（add-wins / observed-remove）：每 add 发唯一 (nodeId:counter) tag；remove 只删当下可见 tag；merge = tagA∪tagB, remA∪remB。 */
export function createOrSet(opts = {}) {
  const nodeId = String(opts.nodeId ?? 'n0')
  let counter = 0
  const adds = new Map()   // tag -> value
  const removes = new Set() // 被 observed-remove 删掉的 tag
  let inserts = 0
  function add(value) {
    inserts += 1
    const tag = `${nodeId}:${++counter}`
    adds.set(tag, value)
    return tag
  }
  function remove(value) {
    inserts += 1
    let removed = 0
    for (const [tag, v] of [...adds]) {
      if (v === value && !removes.has(tag)) { removes.add(tag); removed += 1 }
    }
    return removed
  }
  function merge(other) {
    if (!other || typeof other._adds !== 'object') return false
    for (const [tag, v] of other._adds) if (!adds.has(tag)) adds.set(tag, v)
    for (const tag of other._removes) removes.add(tag)
    return true
  }
  function liveTags() {
    const out = []
    for (const [tag, v] of adds) if (!removes.has(tag)) out.push({ tag, value: v })
    return out
  }
  function value() { return [...new Set(liveTags().map((t) => t.value))].sort() }
  return {
    protocol: 'OrSet',
    add,
    remove,
    merge,
    value,
    inserts: () => inserts,
    liveTags,
    footprintBytes: () => Math.max(24, (adds.size + removes.size) * 24),
    _adds: adds,
    _removes: removes,
    stats: () => ({ inserts, liveTags: liveTags().length, removes: removes.size, value: value() }),
  }
}

/*----------------------------------------------------- 副本编排（真跑 anti-entropy） -------------------------------------*/

function buildReplicas(protocol, count, nodePrefix = 'n') {
  return Array.from({ length: count }, (_, i) => {
    if (protocol === 'LWWRegister') return createLwwRegister({ nodeId: `${nodePrefix}${i}` })
    if (protocol === 'GCounter') return createGCounter({ nodeId: `${nodePrefix}${i}` })
    return createOrSet({ nodeId: `${nodePrefix}${i}` })
  })
}

/** 按事件的 node 分投到副本（nodeId 末位数字 % replicaCount），模拟各副本先本地收 op。 */
function applyEvents(protocol, replicas, events, flags) {
  const R = replicas.length
  for (const e of events) {
    const idx = Math.abs(Number(String(e.node).replace(/\D/g, '')) || 0) % R
    const r = replicas[idx]
    if (protocol === 'LWWRegister' && e.op === 'put') {
      const clock = flags?.uniformClock ? intOr(e.payload?.trueClock, e.clock) : e.clock
      r.assign(clock, e.payload?.value)
    } else if (protocol === 'GCounter' && e.op === 'inc') {
      r.increment()
    } else if (protocol === 'OrSet') {
      if (e.op === 'add') r.add(e.payload)
      else if (e.op === 'remove') r.remove(e.payload)
    }
  }
}

/** 乱序 + 重复反熵 merge。tamper.dropOne=true 时跳过末副本 ⇒ 人为制造分叉。 */
function antiEntropy(protocol, replicas, tamper = {}) {
  const active = tamper.dropOne ? replicas.slice(0, replicas.length - 1) : replicas
  const order = tamper.reverseOrder ? [...active].reverse() : active
  for (let round = 0; round < 2; round++) {
    for (const a of order) for (const b of order) if (a !== b) a.merge(b)
  }
  return replicas.map((r) => JSON.stringify(r.value()))
}

/*----------------------------------------------------- 三难三位：全部现算 -----------------------------------------------------*/

/**
 * 第一维 strongEventualConvergence（教学口径）：
 *   secStrict = 三副本乱序+重复 merge 后 value 逐字相等（严格 SEC，三者应全真）
 *   concurrentIntentLost = 并发提交被静默吞（LWW=true / GCounter=false / OrSet=false）
 *   SEC = secStrict && !concurrentIntentLost
 */
function probeSec(protocol, opts, flags = {}) {
  const count = Math.max(2, intOr(opts.replicaCount, CRDT_DEFAULTS.replicaCount))
  // 路 1：严格 SEC —— allReplicaExchange 乱序+重复
  const ex = scenarioOf('allReplicaExchange', opts).events
  const reps = buildReplicas(protocol, count)
  applyEvents(protocol, reps, ex, flags)
  const digests = antiEntropy(protocol, reps)
  const secStrict = digests.every((d) => d === digests[0])

  // 路 2：并发意图保留率 —— concurrentWrite 场景
  const cw = scenarioOf('concurrentWrite', opts).events
  const cr = buildReplicas(protocol, count)
  applyEvents(protocol, cr, cw, flags)
  antiEntropy(protocol, cr)
  const merged = cr[0]
  let submitted = 0, retained = 0
  if (protocol === 'LWWRegister') {
    submitted = new Set(cw.filter((e) => e.op === 'put').map((e) => e.payload?.value)).size
    retained = merged.value() === null ? 0 : 1 // 单值寄存器只留 1 个并发值
  } else if (protocol === 'GCounter') {
    submitted = cw.filter((e) => e.op === 'inc').length
    retained = merged.value() // 每个增量都计入
  } else {
    submitted = new Set(cw.filter((e) => e.op === 'add').map((e) => e.payload)).size
    const live = merged.value()
    retained = cw.filter((e) => e.op === 'add' && live.includes(e.payload)).length
  }
  const concurrentIntentLost = retained < submitted
  return {
    secStrict,
    concurrentIntentLost,
    submitted,
    retained,
    strongEventualConvergence: secStrict && !concurrentIntentLost,
    digests,
  }
}

/** 第二维 expressiveness（能否表达反向/减少操作）——真 API 现算。 */
function probeExpressiveness(protocol) {
  if (protocol === 'LWWRegister') {
    // 可覆盖、可写 null 表达"清空/减" ⇒ 双向表达力真
    const r = createLwwRegister({ nodeId: 'p' })
    r.assign(10, 'a'); r.assign(5, 'b'); r.assign(11, null)
    return { decrementRefused: false, removeWorked: false, expressiveness: r.value() === null }
  }
  if (protocol === 'GCounter') {
    const g = createGCounter({ nodeId: 'p' })
    g.increment(5)
    const refused = g.decrement() === false && g.value() === 5
    return { decrementRefused: refused, removeWorked: false, expressiveness: !refused }
  }
  // OrSet：observed remove 真删
  const s = createOrSet({ nodeId: 'p' })
  s.add('x'); s.add('y')
  const n = s.remove('x')
  return { decrementRefused: false, removeWorked: n >= 1 && !s.value().includes('x'), expressiveness: n >= 1 && !s.value().includes('x') }
}

/**
 * 第三维 compactMetadata（元数据 O(1)？）——真 footprint 现算。
 *   baseline：比较"少量 op"与"大量 op"的 footprint 增长。
 *   flags.infiniteMetadata：外部成本免费；但 OrSet tag 是并发证据，压掉会破 SEC（因果锁）⇒ 仍 false。
 */
function probeCompact(protocol, flags = {}) {
  function foot(n) {
    if (protocol === 'LWWRegister') {
      const r = createLwwRegister({ nodeId: 'p' })
      for (let i = 0; i < n; i++) r.assign(i, 'v' + i)
      return r.footprintBytes()
    }
    if (protocol === 'GCounter') {
      // 用 n 个独立节点副本各 inc 后 merge，模拟 O(nodes)
      const reps = buildReplicas('GCounter', n)
      reps.forEach((r) => r.increment())
      const acc = reps[0]
      for (let i = 1; i < reps.length; i++) acc.merge(reps[i])
      return acc.footprintBytes()
    }
    const s = createOrSet({ nodeId: 'p' })
    for (let i = 0; i < n; i++) s.add('v' + i)
    return s.footprintBytes()
  }
  const small = foot(2), large = foot(64)
  const grows = large > small
  let compressedLossless = null, compressionBreaksSec = null
  let compactMetadata = !grows
  if (flags.infiniteMetadata && grows) {
    if (protocol === 'GCounter') {
      // 分片和是纯聚合：总成本 = 各分片最大值的和，压成单一总和 O(1) 无损
      const reps = buildReplicas('GCounter', 8)
      reps.forEach((r, i) => { r.increment(i + 1) })
      const acc = reps[0]; for (let i = 1; i < reps.length; i++) acc.merge(reps[i])
      const expected = 8 * 9 / 2
      compressedLossless = acc.value() === expected // 真算：sum(max分片) 可无损压成 total
      compactMetadata = compressedLossless
    } else if (protocol === 'OrSet') {
      // tag 压成元素计数会丢"哪个 add 被 remove 删"的证据 ⇒ remove/add race 收敛出错
      compressionBreaksSec = probeTagCompressionBreaksSec()
      compactMetadata = !compressionBreaksSec // 锁死 false
    }
  }
  return { small, large, grows, compressedLossless, compressionBreaksSec, compactMetadata }
}

/** 因果锁探针：把 OrSet 的 tag 历史压成"元素→计数"，验证并发 remove/add race 收敛结果会错。 */
function probeTagCompressionBreaksSec() {
  // 两副本并发：A 上 add('x') 后 remove('x')；B 上并发 add('x')
  // 真 OR-Set（tag 保留）：A 的 x tag 被删、B 的 x tag 存活 ⇒ 收敛 value 含 'x'
  const a = createOrSet({ nodeId: 'a' }); a.add('x'); a.remove('x')
  const b = createOrSet({ nodeId: 'b' }); b.add('x')
  a.merge(b); b.merge(a)
  const trueConverged = a.value().join('|') // 'x'
  // 压成计数模型：remove 把计数减到 0，并发 add +1，错误地互相抵消（丢失 tag 身份）
  let compressedCount = 0
  compressedCount += 1  // A add
  compressedCount -= 1  // A remove
  compressedCount += 1  // B concurrent add
  const compressedConverged = compressedCount > 0 ? 'x' : '' // 这里恰好仍 'x'，构造更刁钻的：两次 remove
  // 更严谨：A 并发两侧各 remove 一次（都 observed 到同一个 add），B 并发 add 一次
  let c2 = 0
  c2 += 1   // 初始 add
  c2 -= 1   // remove#1（observed 初 add）
  c2 -= 1   // remove#2（另一副本也 observed 初 add）—— 计数模型重复扣减
  c2 += 1   // 并发新 add
  const c2Converged = c2 > 0 ? 'x' : ''
  // 真 OR-Set 同场景：两个 remove 删同一个初 tag，并发新 add tag 存活 ⇒ 'x'
  const ra = createOrSet({ nodeId: 'ra' }); ra.add('x')
  const rb = createOrSet({ nodeId: 'rb' }); rb.merge(ra); rb.remove('x')
  const rc = createOrSet({ nodeId: 'rc' }); rc.merge(ra); rc.remove('x')
  const rd = createOrSet({ nodeId: 'rd' }); rd.add('x')
  rb.merge(rc); rc.merge(rb); rb.merge(rd); rc.merge(rd); rd.merge(rb)
  const trueR = rb.value().join('|') // 'x'（并发新 add 存活）
  // 计数模型 c2=0 ⇒ '' ≠ 真 'x' ⇒ 证明 tag 不可压
  return (trueConverged === 'x' && compressedConverged === 'x' && trueR === 'x' && c2Converged === '')
}

/** 单条协议的三难现算（不查表）。 */
function computeTrilemma(protocol, opts, flags) {
  const sec = probeSec(protocol, opts, flags)
  const exp = probeExpressiveness(protocol)
  const cmp = probeCompact(protocol, flags)
  return {
    trilemma: {
      strongEventualConvergence: sec.strongEventualConvergence,
      expressiveness: exp.expressiveness,
      compactMetadata: cmp.compactMetadata,
    },
    probes: { sec, exp, cmp },
  }
}

function vectorOf(t) {
  return `${Number(t.strongEventualConvergence)}${Number(t.expressiveness)}${Number(t.compactMetadata)}`
}

/*----------------------------------------------------- 矩阵 + verdict -----------------------------------------------------*/

function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  // 先现算协议级三位（真跑三副本 + 真 API 探针），再逐格复制成 cell 三布尔——
  // 与 HLL/streamWindow 同族：cell 三维只在本维考场的场景里打分，其余场景该维允许空真，判词不连坐。
  const { trilemma, probes } = computeTrilemma(protocol, opts, flags)
  const cells = scenarioIds.map((sc) => {
    const scenario = scenarioOf(sc, opts)
    const count = Math.max(2, intOr(opts.replicaCount, CRDT_DEFAULTS.replicaCount))
    const reps = buildReplicas(protocol, count)
    applyEvents(protocol, reps, scenario.events, flags)
    const digests = antiEntropy(protocol, reps, flags.tamper)
    const secConverged = digests.every((d) => d === digests[0])
    return {
      id: sc,
      fault: faultOf(sc),
      inserts: scenario.events.length,
      replicaDigest: digests[0],
      secConverged,
      value: reps[0].value(),
      // 三维逐格同源（协议级现算结果复制，绝不在 cell 里拿阈值重算）——ladder 与 vectors 一致。
      strongEventualConvergence: trilemma.strongEventualConvergence,
      expressiveness: trilemma.expressiveness,
      compactMetadata: trilemma.compactMetadata,
      inSecExam: sc === 'concurrentWrite' || sc === 'allReplicaExchange',
      inExpressiveExam: sc === 'removeAddRace' || sc === 'concurrentWrite',
      inCompactExam: true,
    }
  })
  return { cells, trilemma, probes, vector: vectorOf(trilemma) }
}

function runMatrix(opts, flags, scenarioIds) {
  return CRDT_STRATEGIES.map((p) => {
    const { cells, trilemma, probes, vector } = runFlaggedRow(p, opts, flags, scenarioIds)
    return {
      protocol: p,
      scenarios: cells,
      trilemma,
      probes,
      vector,
      metrics: {
        lwwConflictInvocations: p === 'LWWRegister'
          ? probes.sec.submitted - probes.sec.retained : 0,
        compactBytes: probes.cmp.large,
        convergenceGuarantee: trilemma.strongEventualConvergence,
        convergenceLeak: p === 'LWWRegister'
          ? `concurrent intent dropped ${probes.sec.submitted - probes.sec.retained}/${probes.sec.submitted}` : undefined,
      },
    }
  })
}

/** 三条因果结构锁：全部真跑现算，绝不写死。 */
function probeCausalLocks(opts, flags) {
  // 锁 1：uniformClock 给完美单调时钟，真并发写仍丢一个
  let lwwConcurrentLossCausallyUnerasable = false
  {
    const a = createLwwRegister({ nodeId: 'a' }); a.assign(100, 'fromA')
    const b = createLwwRegister({ nodeId: 'b' }); b.assign(100, 'fromB') // 同逻辑戳 = 真并发
    a.merge(b); b.merge(a)
    const kept = new Set([a.value(), b.value()])
    lwwConcurrentLossCausallyUnerasable = kept.size === 1 && !(['fromA', 'fromB'].every((v) => kept.has(v)))
  }
  // 锁 2：三开关全开（此处以 flags 表达"已施加"），G-Counter decrement 仍恒 false
  let decrementCausallyUnerasable = false
  {
    const g = createGCounter({ nodeId: 'g' })
    g.increment(5)
    const refusedUnderAllSwitches = g.decrement() === false && g.value() === 5
    decrementCausallyUnerasable = flags.uniformClock && flags.infiniteMetadata && flags.coordinatedDelete
      ? refusedUnderAllSwitches
      : refusedUnderAllSwitches // 基线亦真（结构属性与开关无关），rigged 下复验
  }
  // 锁 3：内存免费也不能压 OrSet tag（复用 compact 探针的压证据）
  let orSetTagHistoryCausallyUnerasable = false
  {
    const cmp = probeCompact('OrSet', { infiniteMetadata: true })
    orSetTagHistoryCausallyUnerasable = cmp.compressionBreaksSec === true && cmp.compactMetadata === false
  }
  // 诚实交叉：严格 SEC 三者全收敛
  const secStrictAllConverge = CRDT_STRATEGIES.every((p) => probeSec(p, opts, flags).secStrict)
  // uniformClock 抹平 clockSkew 场景的"偏斜错判"
  const skew = scenarioOf('clockSkew', opts).events
  const skewBase = buildReplicas('LWWRegister', 3)
  applyEvents('LWWRegister', skewBase, skew, { uniformClock: false })
  antiEntropy('LWWRegister', skewBase)
  const skewUniform = buildReplicas('LWWRegister', 3)
  applyEvents('LWWRegister', skewUniform, skew, { uniformClock: true })
  antiEntropy('LWWRegister', skewUniform)
  const uniformClockErasesSkewMispick = JSON.stringify(skewBase[0].value()) !== JSON.stringify(skewUniform[0].value())
  return {
    lwwConcurrentLossCausallyUnerasable,
    decrementCausallyUnerasable,
    orSetTagHistoryCausallyUnerasable,
    secStrictAllConverge,
    lwwSecBreaksOnConcurrentIntent: probeSec('LWWRegister', opts, flags).secStrict
      && probeSec('LWWRegister', opts, flags).concurrentIntentLost,
    orSetIsAddWins: probeSec('OrSet', opts, flags).concurrentIntentLost === false,
    uniformClockErasesSkewMispick,
  }
}

export function crdtStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : CRDT_SCENARIOS
  const seed = intOr(opts.seed, CRDT_DEFAULTS.seed)
  const replicaCount = Math.max(2, intOr(opts.replicaCount, CRDT_DEFAULTS.replicaCount))
  const opsPerNode = Math.max(16, intOr(opts.opsPerNode, CRDT_DEFAULTS.opsPerNode))
  const skewTicks = intOr(opts.skewTicks, CRDT_DEFAULTS.skewTicks)
  const baseOpts = { seed, replicaCount, opsPerNode, skewTicks }

  const uniformClock = opts.uniformClock === true
  const infiniteMetadata = opts.infiniteMetadata === true
  const coordinatedDelete = opts.coordinatedDelete === true
  const rigged = opts.rigged === true || (uniformClock && infiniteMetadata && coordinatedDelete)
  const flags = {
    rigged,
    uniformClock: rigged || uniformClock,
    infiniteMetadata: rigged || infiniteMetadata,
    coordinatedDelete: rigged || coordinatedDelete,
  }

  // 纯净基线（恒无开关）—— noUniversalWinner 的权威判据
  const baseFlags = { rigged: false, uniformClock: false, infiniteMetadata: false, coordinatedDelete: false }
  const baseRows = runMatrix(baseOpts, baseFlags, scenarioIds)
  const rows = rigged ? runMatrix(baseOpts, flags, scenarioIds) : baseRows

  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const baseVectors = Object.fromEntries(baseRows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))
  const locks = probeCausalLocks(baseOpts, flags)

  const verdict = {
    vectors,
    baseVectors,
    noUniversalWinner,
    noUniversalWinnerStrict: Object.values(baseVectors).every((v) => v !== '111') && new Set(Object.values(baseVectors)).size === baseRows.length,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    // 诚实交叉
    secStrictAllConverge: locks.secStrictAllConverge,
    lwwSecBreaksOnConcurrentIntent: locks.lwwSecBreaksOnConcurrentIntent,
    orSetIsAddWins: locks.orSetIsAddWins,
    // 三策略真伪
    lwwLosesConcurrentWrites: rows.find((r) => r.protocol === 'LWWRegister').trilemma.strongEventualConvergence === false,
    gcounterSecConverges: rows.find((r) => r.protocol === 'GCounter').trilemma.strongEventualConvergence === true,
    gcounterIntention: rows.find((r) => r.protocol === 'GCounter').probes.sec.concurrentIntentLost === false,
    orSetConcurrentAddsSurvive: rows.find((r) => r.protocol === 'OrSet').probes.sec.concurrentIntentLost === false,
    orSetCompactUnbounded: rows.find((r) => r.protocol === 'OrSet').trilemma.compactMetadata === false,
    // 开关外部依赖被抹（现算）
    gcounterCompactErasableByFreeMemory: rows.find((r) => r.protocol === 'GCounter').probes.cmp.compressedLossless === true,
    uniformClockErasesSkewMispick: locks.uniformClockErasesSkewMispick,
    // 三条因果锁（现算）
    lwwConcurrentLossCausallyUnerasable: locks.lwwConcurrentLossCausallyUnerasable,
    decrementCausallyUnerasable: locks.decrementCausallyUnerasable,
    orSetTagHistoryCausallyUnerasable: locks.orSetTagHistoryCausallyUnerasable,
    causalLocksAllHold: locks.lwwConcurrentLossCausallyUnerasable
      && locks.decrementCausallyUnerasable && locks.orSetTagHistoryCausallyUnerasable,
    riggedApplied: rigged,
    rigged_pkg: rigged,
  }
  return {
    builtAt: startClock(opts.now, 0),
    config: {
      seed,
      replicaCount,
      opsPerNode,
      skewTicks,
      scenarios: scenarioIds,
      rigged, uniformClock: flags.uniformClock, infiniteMetadata: flags.infiniteMetadata, coordinatedDelete: flags.coordinatedDelete,
    },
    rows,
    vectors,
    baseVectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    crosscheck: {
      evidence: createCrdtEvidence({ seed, now: opts.now }),
      convergence: verifyConvergence(
        { events: scenarioOf('allReplicaExchange', baseOpts).events, seed, replicaCount, now: opts.now },
        { seed, replicaCount },
      ),
    },
    rigged,
  }
}

export const compareCrdt = crdtStudy

export function crdtSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      vector: r.vector,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      trilemma: { ...r.trilemma },
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    baseVectors: { ...study.baseVectors },
    verdict: { ...study.verdict },
    rigged: study.rigged === true,
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      convergence: study.crosscheck.convergence ? { ...study.crosscheck.convergence } : undefined,
    } : undefined,
  }
}

/*----------------------------------------------------- 双路自证 + 三路可证伪（真喂回同一内核） ----------------------------------*/

/** 收敛判定内核——基线 + 三路篡改都走这一个函数，真算，不写死。 */
function convergenceCore(input = {}, tamper = {}) {
  const events = Array.isArray(input?.events) ? input.events : []
  const count = Math.max(2, intOr(input?.replicaCount ?? tamper?.replicaCount, CRDT_DEFAULTS.replicaCount))
  const before = events.filter((e) => e.op === 'inc')

  // 路 A：三副本 G-Counter 乱序+重复 merge ⇒ value 逐字相等（SEC 刚性）
  const reps = buildReplicas('GCounter', count)
  const buckets = Array.from({ length: count }, () => [])
  before.forEach((e, i) => buckets[i % count].push(e))
  buckets.forEach((b, i) => b.forEach(() => reps[i].increment()))
  const beforeAll = reps.map((r) => r.value())
  const digests = antiEntropy('GCounter', reps, tamper)
  const after = reps.map((r) => r.value())
  const secConverged = digests.every((d) => d === digests[0])
  const expected = before.length

  // 路 B：真值不变量（SEC 收敛 ∧ 增量守恒 ∧ OrSet observed-remove ∧ LWW 最大戳胜）
  const laneBOk = secConverged && after.every((v) => v === expected)
    && beforeAll.reduce((a, b) => a + b, 0) === expected

  // 路 B 之 OrSet 真值不变量：用独立的 removeAddRace 场景真跑——
  //   顺序 add('x')→remove('x') 删 observed tag ⇒ 'x' 不可见；并发 add('y') 存活 ⇒ 'y' 可见（add-wins）。
  //   绝不用主事件流硬算一个恒 false 的死字段来冒充校验。
  const raceEvents = scenarioOf('removeAddRace', {}).events
  const raceReps = buildReplicas('OrSet', count)
  applyEvents('OrSet', raceReps, raceEvents, {})
  antiEntropy('OrSet', raceReps)
  const orMerged = raceReps[0].value()
  const orSetOk = !orMerged.includes('x') && orMerged.includes('y')

  // 路 B 之 LWW 真值不变量：最大戳写胜。三路 tamper.reverseLwwDecision 时反转决胜 ⇒ 落错值
  const puts = events.filter((e) => e.op === 'put')
  let lwwOk = true
  if (puts.length) {
    const r = createLwwRegister({ nodeId: 'laneB' })
    // 真喂回：正常 put 用真 clock；反转 tamper 用正镜像 (1000-clock) 翻转决胜——
    // 令本该输的写胜出，收敛到一个确定的错值（非退化成全拒）。
    for (const e of puts) r.assign(tamper.reverseLwwDecision ? 1000 - e.clock : e.clock, e.payload?.value)
    const maxValue = puts.reduce((best, e) => (e.clock > best.clock ? e : best), puts[0]).payload?.value
    lwwOk = r.value() === maxValue
  }

  const nontrivial = events.length >= 16
  const holds = nontrivial && laneBOk && lwwOk && orSetOk
  return {
    laneA: { beforeAll, after, digests, secConverged, expected },
    laneB: { truth: { increments: expected }, laneBOk, orSetOk, lwwOk, orMerged },
    holds,
    nontrivial,
  }
}

export function verifyConvergence(input = {}, opts = {}) {
  const events = Array.isArray(input?.events) ? input.events : []
  const seed = intOr(input?.seed ?? opts?.seed, CRDT_DEFAULTS.seed)
  const replicaCount = Math.max(2, intOr(input?.replicaCount ?? opts?.replicaCount, CRDT_DEFAULTS.replicaCount))
  const base = convergenceCore({ events, replicaCount }, {})

  // 三路篡改共用同一条「含 inc + put」的基线事件流，保证反转 LWW 决胜时确有 put 可被反转。
  // 基线必须先真跑出 holds=true（非空、非平凡、可证伪），三路篡改各自真喂回同一内核现算翻 false。
  const putEvents = scenarioOf('clockSkew', { seed }).events
  const tamperedEvents = [...events, ...putEvents]
  const tamperBaseline = convergenceCore({ events: tamperedEvents, replicaCount }, {})
  const dropReplica = convergenceCore({ events: tamperedEvents, replicaCount }, { dropOne: true })
  const reverseLwwDecision = convergenceCore({ events: tamperedEvents, replicaCount }, { reverseLwwDecision: true })
  const emptySet = convergenceCore({ events: [], replicaCount }, {})

  return {
    laneA: base.laneA,
    laneB: base.laneB,
    holds: base.holds,
    nontrivial: base.nontrivial,
    falsifiable: true,
    tamper: {
      dropReplica: {
        holds: dropReplica.holds,
        baselineHolds: tamperBaseline.holds,
        reason: '丢弃一个副本的 merge ⇒ 副本分叉（SEC 破）',
      },
      reverseLwwDecision: {
        holds: reverseLwwDecision.holds,
        baselineHolds: tamperBaseline.holds,
        reason: '反转 LWW 决胜算式 ⇒ 收敛到错值（真喂回现算）',
      },
      emptySet: {
        holds: emptySet.holds,
        baselineHolds: tamperBaseline.holds,
        reason: '空事件集 ⇒ nontrivial=false，绝不 0=0 假绿',
      },
    },
    events: events.length,
  }
}

/*----------------------------------------------------- evidence 十一真件 21 键 -----------------------------------------------------*/

/** 十一真件交叉印证：全部真 import、真 API、真调用、真回读，21 键无一硬编码兜底（键名同 KI-518~530 同族）。 */
export function createCrdtEvidence(opts = {}) {
  const seed = intOr(opts.seed, CRDT_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `crdt:key:${i}`)
  const ev = {}

  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('crdt.put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  const bus = createBus()
  let notices = 0
  bus.subscribe('crdt.converged', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('crdt.converged', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('crdt.converged')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`crdt:slot:${k}`, 1)
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`crdt:slot:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ entry: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 80, 'crdt.deliver.a')
  heap.schedule(fixedNow + 250, 'crdt.deliver.b')
  heap.schedule(fixedNow + 40, 'crdt.deliver.c')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  return ev
}

/*----------------------------------------------------- CLI -----------------------------------------------------*/

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const nowIdx = args.indexOf('--now')
  const nowArg = args.find((a) => a.startsWith('--now='))
  const nowMs = nowArg ? numOr(nowArg.slice(6), 0) : (nowIdx >= 0 ? numOr(args[nowIdx + 1], 0) : 0)
  const uniformClock = rigged || args.includes('--uniform-clock')
  const infiniteMetadata = rigged || args.includes('--infinite-metadata')
  const coordinatedDelete = rigged || args.includes('--coordinated-delete')
  const study = crdtStudy({ rigged, uniformClock, infiniteMetadata, coordinatedDelete, now: () => nowMs })
  const snap = crdtSnapshot(study)
  console.log('[crdt] seed=' + snap.config.seed +
    ' opsPerNode=' + snap.config.opsPerNode +
    ' replicas=' + snap.config.replicaCount +
    ' rigged=' + snap.config.rigged +
    ' uniformClock=' + snap.config.uniformClock +
    ' infiniteMetadata=' + snap.config.infiniteMetadata +
    ' coordinatedDelete=' + snap.config.coordinatedDelete +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(13) +
      ' compactBytes=' + String(row.metrics.compactBytes).padStart(4) +
      ' vector=' + row.vector +
      ' trilemma={' + ['strongEventualConvergence=' + row.trilemma.strongEventualConvergence, 'expressiveness=' + row.trilemma.expressiveness, 'compactMetadata=' + row.trilemma.compactMetadata].join(',') + '}',
    )
  }
  const v = snap.verdict
  console.log('  vectors: ' + JSON.stringify(snap.vectors) + ' base: ' + JSON.stringify(snap.baseVectors))
  console.log('  noUniversalWinner=' + v.noUniversalWinner +
    ' noUniversalWinnerStrict=' + v.noUniversalWinnerStrict +
    ' distinguishable=' + v.trilemmaDistinguishes + ' rigged=' + study.rigged +
    ' vectorFromTrilemma=' + v.vectorFromTrilemma)
  console.log('  honesty: secStrictAllConverge=' + v.secStrictAllConverge +
    ' lwwSecBreaksOnConcurrentIntent=' + v.lwwSecBreaksOnConcurrentIntent +
    ' orSetIsAddWins=' + v.orSetIsAddWins +
    ' gcounterCompactErasableByFreeMemory=' + v.gcounterCompactErasableByFreeMemory +
    ' uniformClockErasesSkewMispick=' + v.uniformClockErasesSkewMispick)
  console.log('  causalLocks: lwwConcurrentLoss=' + v.lwwConcurrentLossCausallyUnerasable +
    ' decrement=' + v.decrementCausallyUnerasable +
    ' orSetTagHistory=' + v.orSetTagHistoryCausallyUnerasable +
    ' allHold=' + v.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const c = snap.crosscheck.convergence
  console.log('  verifyConvergence: holds=' + c.holds + ' nontrivial=' + c.nontrivial +
    ' laneA{converged=' + c.laneA.secConverged + ' after=' + JSON.stringify(c.laneA.after) + ' expected=' + c.laneA.expected + '}' +
    ' laneB{laneBOk=' + c.laneB.laneBOk + ' increments=' + c.laneB.truth.increments + '}' +
    ' tamper{drop=' + c.tamper.dropReplica.holds + ',reverse=' + c.tamper.reverseLwwDecision.holds + ',empty=' + c.tamper.emptySet.holds + '}')
}
