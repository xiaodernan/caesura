import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBPlusTree } from './caesura-bplus-tree.mjs'

/**
 * scripts/caesura-idgen.mjs —— 分布式 ID 生成：UUIDv4 / Snowflake / Redis 号段(Leaf-segment)
 * 三协议诚实权衡对照，以 KI-504 B+ 树索引页分裂为性能落点（P8 第十七件，KI-509）。
 *
 * <p>补的是 KI-504 与 KI-508 之后那一步。KI-504 建了真 B+ 树索引引擎，KI-508 补了跨服务互斥，
 * 却没碰微服务分库分表最底层那一块——**全局唯一 ID 怎么发**，而主键选择**直接决定你建的这棵
 * B+ 树索引的页分裂与写放大**。生产里三条各有硬伤的路，没有一条能同时给你「索引友好 + 去中心
 * + 抗时钟异常」：</p>
 * <ol>
 *   <li>**UUIDv4**：128 位伪随机、本地生成、**无中心**、**不依赖墙钟** ⇒ 去中心 + 抗时钟全占。
 *       但**完全随机主键插 B+ 树** ⇒ 每次插入随机落点、中途分裂/页重写最重（本件真 import
 *       KI-504 `createBPlusTree` 量 `splits`，对照同 N 个递增 key 的 `sequentialBaseline`）。</li>
 *   <li>**Snowflake**（`timestamp<<22 | workerId<<12 | sequence`）：时间戳趋势递增 ⇒ **索引友好**、
 *       本地生成 ⇒ **去中心**。但**墙钟回拨** ⇒ `timestamp < lastTimestamp` ⇒ 保守实现**停发等待**
 *       （保唯一但不可用）、激进实现**发重复 ID**；且 `workerId` 需协调分配（不是完全无协调）。</li>
 *   <li>**Redis 号段(Leaf-segment)**：Redis INCR 批量取一段 `[lo,hi]` + **双 buffer 预取**，段内
 *       **严格递增**、**不依赖本地墙钟** ⇒ 索引友好 + 抗时钟全占。但**依赖中心 Redis/DB 取号**
 *       （中心宕 + 双 buffer 耗尽 ⇒ **发号中断**）、机器重启**段跳跃浪费** ID 不连续、取新段
 *       要**中心 RTT**。</li>
 * </ol>
 *
 * <p>三只骨架 + 一只对照 + 三探针 + study/snapshot：</p>
 * <ol>
 *   <li>**`createUuidV4`**：确定性伪随机 128 位（版本位/变体位正确），本地 `next()`，真树量随机
 *       主键 `pageSplits`；`sequentialIds:true` 可 rigged 成顺序主键（抹掉索引软肋、证伪用）。</li>
 *   <li>**`createSnowflake`**：真位布局 `timestamp<<22|workerId<<12|sequence`、`parse(id)` 反解三段、
 *       同毫秒 sequence 自增、跨毫秒重置；`fo.clockBackward` 回拨停发（`stalled`/`clockRollbacks`，
 *       `fo.forceDuplicate` 展示重复代价）、`fo.sequenceOverflow` 阻塞等下一毫秒（`waits`）。</li>
 *   <li>**`createLeafSegment`**：内存模拟中心 counter + 双 buffer 预取，段内严格递增；
 *       `fo.centerDown` 双 buffer 耗尽 ⇒ 发号中断、`fo.segmentGap` 重启跳号浪费（`wastedIds`、
 *       不连续）、`fo.sequenceOverflow` 取新段记 `centerRounds`（RTT 结构计数）。</li>
 *   <li>**`compareIdGen` 核心证据**：同一组**确定性故障场景**（全成功 / 随机主键插树 / 墙钟回拨 /
 *       中心宕机 / 同毫秒序列溢出 / 重启跳号浪费）分喂三协议，数各 `issued/duplicates/stalled/
 *       pageSplits/wastedIds/centerRounds/waits/messages`，钉死「**UUID** 无中心不怕回拨但随机主键
 *       伤索引 / **Snowflake** 趋势递增且去中心但时钟回拨致命 / **号段** 递增且不怕回拨但中心宕机
 *       中断 + 重启跳号浪费」这组真实取舍。</li>
 * </ol>
 *
 * <p>三难判据 = **索引友好 ∧ 去中心 ∧ 抗时钟异常**。逐协议量**真实向量**（不假设「各恰好缺一」，
 * KI-506 初版过强假设的教训）：UUID=[✓,✓,✗] 按「索引友好」为首位的字典序本件固定为 `011`
 * （索引友好 ✗ / 去中心 ✓ / 抗时钟 ✓）、Snowflake=[✓,✓,✗]=`110`、Segment=[✓,✗,✓]=`101`——
 * 三条**互不相同**、**没有一条三个全 ✓** ⇒ `noUniversalWinner` 真。**可证伪**：用 rigged 配置
 * （`sequentialIds:true` 抹掉 UUID 随机软肋 + 六场景故障全置空）跑，三协议都退化为 `111`
 * ⇒ `trilemmaDistinguishes` / `noProtocolWinsAll` / `noUniversalWinner` 同时翻 false。单测钉住。</p>
 *
 * <p>诚实映射（不打不相关软肋）：`randomKeyInsert` 主攻 UUID 随机主键页分裂（Snowflake/Segment
 * 趋势递增，真树 splits 接近顺序基线，不中）；`clockBackward` 只打依赖墙钟的 Snowflake（UUID 不用
 * 时钟、号段用中心单调 counter 不依赖本地墙钟）；`centerDown` 只打依赖中心的号段（UUID/Snowflake
 * 本地生成无中心）;`sequenceOverflow` 打 Snowflake（等下一毫秒）与号段（取新段 RTT）、UUID 无序列
 * 概念不中；`segmentGap` 只打号段预取跳跃、UUID/Snowflake 不中。</p>
 *
 * <p>设计取舍：时钟、随机、节点集、段长、B+ 树阶数/叶容量、故障点、场景全由 opts 注入；本件只跑
 * 状态机与结构计数，不写业务阈值。与真 Redis / 真 Snowflake 服务 / 真密码学 UUID / 真块设备无
 * 运行时依赖——唯一同仓 import 是 KI-504 真 B+ 树（`createBPlusTree`）用于**结构计数交叉印证**，
 * 不用它做字节/墙钟跑分。所有读数都是**确定性故障场景上的结构计数**，不是墙钟、吞吐或真库跑分。</p>
 *
 * 用法：
 *   const u = createUuidV4();                u.next()                       // 128 位伪随机
 *   const s = createSnowflake();             s.next({clockBackward:true})   // 回拨停发
 *   const g = createLeafSegment();           g.next({centerDown:true})       // 中心宕中断
 *   const cmp = compareIdGen();              // 六场景 × 三协议矩阵 + 三难判词
 *   const study = idGenStudy()               // 纯数据汇总
 *
 * CLI：node scripts/caesura-idgen.mjs  （= npm run idgen:bench，注入固定时钟双跑字节一致）
 */

/** 缺省教学参数（位布局、段长、B+ 树阶数、内部随机种子）。 */
export const IDGEN_DEFAULTS = Object.freeze({
  epoch: 0,                                  // Snowflake 纪元（教学 0，非真实毫秒墙钟）
  workerIdBits: 10,
  sequenceBits: 12,
  workerId: 1,
  segmentSize: 8,                            // 号段每段容量（小值便于双 buffer 耗尽演示中断）
  treeOrder: 8,                              // KI-504 B+ 树内节点阶数（偶数 ≥4）
  leafCapacity: 8,                           // KI-504 B+ 树叶容量（小值放大随机 vs 顺序页分裂差）
  keyCount: 24,                              // randomKeyInsert 场景插入 key 数
  nodes: Object.freeze(['redis-a', 'redis-b', 'redis-c']), // 号段中心（内存模拟）
  seed: 0x9e3779b9,
  zero: 0,
})

/** 三协议（顺序固定，短名作快照/矩阵 key）。 */
export const IDGEN_PROTOCOLS = Object.freeze([
  Object.freeze({ id: 'uuid-v4', short: 'UUID', label: 'UUIDv4' }),
  Object.freeze({ id: 'snowflake', short: 'Snowflake', label: 'Snowflake 位布局' }),
  Object.freeze({ id: 'leaf-segment', short: 'Segment', label: 'Redis 号段 Leaf-segment' }),
])
const PROTOCOL_SHORTS = Object.freeze(IDGEN_PROTOCOLS.map((p) => p.short))
const PROTOCOL_LABELS = Object.freeze(Object.fromEntries(IDGEN_PROTOCOLS.map((p) => [p.short, p.label])))

/** 六类确定性故障场景（矩阵列；fault.at 决定场景，诚实不打不相关软肋）。 */
export const IDGEN_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'allOk', label: '全成功' }),
  Object.freeze({ id: 'randomKeyInsert', label: '随机主键插 B+ 树' }),
  Object.freeze({ id: 'clockBackward', label: '墙钟回拨' }),
  Object.freeze({ id: 'centerDown', label: '中心 Redis 宕机' }),
  Object.freeze({ id: 'sequenceOverflow', label: '同毫秒序列溢出' }),
  Object.freeze({ id: 'segmentGap', label: '重启段跳跃浪费' }),
])

const asArr = (v) => Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v])
const uniq = (xs) => Array.from(new Set(xs))
const intOr = (v, d) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d
const namesOf = (v, fallback) => uniq((asArr(v).length ? asArr(v) : fallback).map(String))
const nowOf = (opts) => typeof opts.now === 'function' ? opts.now : () => Date.now()

/** 内部确定性 LCG（opts.rand 可注入；UUID 伪随机与 B+ 树随机 key 顺序都走它 ⇒ 双跑字节一致）。 */
function makeRand(seed) {
  let x = (Number.isFinite(Number(seed)) ? Number(seed) : IDGEN_DEFAULTS.seed) >>> 0
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 }
}

/* ============================================================
 * ① UUIDv4（128 位确定性伪随机）
 * ============================================================ */

/**
 * UUIDv4：128 位伪随机、本地生成、无中心、不依赖墙钟。用 4 个 32 位字表示，正确置版本位（第 4 组
 * 高位 0100）与变体位（第 5 组前两位 10）。`sequentialIds:true` 时退化为顺序递增 key，供 rigged
 * 证伪「随机主键伤索引」这一软肋——同构接口下只换 key 分布，不改真树量法。
 */
export function createUuidV4(opts = {}) {
  const rand = typeof opts.rand === 'function' ? opts.rand : makeRand(opts.seed)
  const sequentialIds = opts.sequentialIds === true
  let seq = 0
  const issued = []
  const words = []

  const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0')

  function next() {
    let id, key, variant = 0
    if (sequentialIds) {
      seq += 1
      key = seq                                     // 顺序数值 key（rigged）
      id = 'seq:' + String(seq).padStart(12, '0')
    } else {
      // 4 个 32 位字 → 32 hex 串，再按 UUID 的 8-4-4-4-12 切；版本/变体**按 hex 位置**打位标记，
      // 不按 32 位字边界（字边界与 UUID 组边界错位 4 bit，是初版变体位跑偏的根因）。
      const w = [0, 0, 0, 0]
      for (let i = 0; i < 4; i++) w[i] = Math.floor(rand() * 4294967296) >>> 0
      let h = hex8(w[0]) + hex8(w[1]) + hex8(w[2]) + hex8(w[3]) // 32 hex
      h = h.slice(0, 12) + '4' + h.slice(13)                    // 第 3 组首字符 = 版本 4 (index 12)
      const variantHex = '89ab'[Math.floor(rand() * 4)]          // 第 4 组首字符 = 变体 10xx (index 16)
      h = h.slice(0, 16) + variantHex + h.slice(17)
      words.push(w)
      // 数值 key 取首字（32 位）作可排序确定性键，比较器可直接排序、双跑一致。
      key = w[0]
      id = h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32)
      variant = parseInt(variantHex, 16) >= 8 ? 2 : 0
    }
    issued.push(id)
    return { id, key, version: sequentialIds ? 0 : 4, variant }
  }

  function stats() {
    return {
      generator: 'caesura-idgen/uuid-v4', issued: issued.length,
      unique: uniq(issued).length, distinctKeys: uniq(issued.map((_, i) => i)).length,
      bitLength: 128, version: sequentialIds ? 0 : 4, sequentialIds,
    }
  }
  function snapshot(t) {
    return { generator: 'caesura-idgen/uuid-v4', stats: stats(), builtAt: t !== undefined ? t : nowOf(opts)() }
  }
  function reset() { seq = 0; issued.length = 0; words.length = 0 }

  return { next, stats, snapshot, reset, get issued() { return issued.length }, get sequentialIds() { return sequentialIds } }
}

/* ============================================================
 * ② Snowflake（timestamp<<workerIdBits+sequenceBits | workerId<<sequenceBits | sequence）
 * ============================================================ */

/**
 * Snowflake：真位布局，三段可 `parse` 反解。同毫秒 sequence 自增、跨毫秒重置；`fo.clockBackward`
 * 注入墙钟回拨（`timestamp < lastTimestamp`）⇒ 保守停发（`stalled`/`clockRollbacks`，保唯一但不可用），
 * `fo.forceDuplicate` 展示「不停发就发重复」的代价；`fo.sequenceOverflow` 同毫秒序列打满 ⇒ 阻塞等
 * 下一毫秒（`waits`）。索引友好（趋势递增）+ 去中心（本地），但墙钟回拨是硬伤。
 */
export function createSnowflake(opts = {}) {
  const now = nowOf(opts)
  const epoch = intOr(opts.epoch, IDGEN_DEFAULTS.epoch)
  const workerIdBits = Math.max(1, intOr(opts.workerIdBits, IDGEN_DEFAULTS.workerIdBits))
  const sequenceBits = Math.max(1, intOr(opts.sequenceBits, IDGEN_DEFAULTS.sequenceBits))
  const workerId = intOr(opts.workerId, IDGEN_DEFAULTS.workerId)
  const maxSequence = Math.pow(2, sequenceBits) - 1
  const workerShift = sequenceBits
  const timestampShift = workerIdBits + sequenceBits
  let lastTimestamp = -1
  let sequence = 0
  let issued = 0, duplicates = 0, stalled = 0, clockRollbacks = 0, waits = 0
  const ids = []

  function next(fo = {}) {
    messagesTick()
    let ts = Math.max(0, Math.trunc(now() - epoch))
    if (ts < lastTimestamp) {
      clockRollbacks++
      if (fo.forceDuplicate === true) {
        // 激进（错误）实现：不拦，沿用旧 lastTimestamp ⇒ 发重复 ID。如实量代价、不粉饰。
        duplicates++
        const dup = lastTimestamp * Math.pow(2, timestampShift) + workerId * Math.pow(2, workerShift) + sequence
        ids.push(dup); issued++
        return { id: dup, key: dup, timestamp: lastTimestamp, workerId, sequence, duplicate: true, stalled: false, reason: 'clock-backward-duplicate' }
      }
      // 保守实现：停发等待，时钟追上 lastTimestamp 才继续。
      stalled++
      return { id: null, key: null, issued: false, duplicate: false, stalled: true, reason: 'clock-backward-wait', timestamp: ts, lastTimestamp }
    }
    if (fo.sequenceOverflow === true && ts === lastTimestamp) {
      // 同毫秒序列打满 ⇒ 阻塞等下一毫秒（教学：直接推进逻辑时钟一格，不真睡）。
      waits++
      ts = lastTimestamp + 1
      sequence = 0
    } else if (ts === lastTimestamp) {
      sequence = (sequence + 1) % (maxSequence + 1)
      if (sequence === 0) { waits++; ts = lastTimestamp + 1 }  // 自然溢出也等下一毫秒
    } else {
      sequence = 0
    }
    lastTimestamp = ts
    const id = ts * Math.pow(2, timestampShift) + workerId * Math.pow(2, workerShift) + sequence
    ids.push(id); issued++
    return { id, key: id, timestamp: ts, workerId, sequence, duplicate: false, stalled: false, reason: 'ok' }
  }
  function messagesTick() { /* 本地生成不产生网络消息，占位与其余协议同形 */ }

  /** 反解三段（真位布局，不是布尔桩）。 */
  function parse(id) {
    const n = Math.trunc(Number(id))
    if (!Number.isSafeInteger(n) || n < 0) return null
    return {
      timestamp: Math.floor(n / Math.pow(2, timestampShift)),
      workerId: Math.floor(n / Math.pow(2, workerShift)) % Math.pow(2, workerIdBits),
      sequence: n % Math.pow(2, sequenceBits),
    }
  }

  function stats() {
    return {
      generator: 'caesura-idgen/snowflake', issued, unique: uniq(ids).length, duplicates, stalled,
      clockRollbacks, waits, bitLength: timestampShift + 2, workerIdBits, sequenceBits, workerId,
      lastTimestamp, messages: 0, latency: 1, centerRounds: 0,
    }
  }
  function snapshot(t) {
    return { generator: 'caesura-idgen/snowflake', stats: stats(), idSample: ids.slice(-8), builtAt: t !== undefined ? t : now() }
  }
  function reset() {
    lastTimestamp = -1; sequence = 0; issued = 0; duplicates = 0; stalled = 0; clockRollbacks = 0; waits = 0; ids.length = 0
  }

  return {
    next, parse, stats, snapshot, reset,
    get issued() { return issued }, get duplicates() { return duplicates }, get stalled() { return stalled },
    get clockRollbacks() { return clockRollbacks }, get lastTimestamp() { return lastTimestamp },
  }
}

/* ============================================================
 * ③ Redis 号段 Leaf-segment（内存模拟中心 counter + 双 buffer 预取）
 * ============================================================ */

/**
 * Redis 号段：内存模拟中心 counter，每次取一段 `[lo, lo+segmentSize-1]`，**双 buffer** 各持一段，
 * 当前段用尽切另一段并异步补新段（中心 RTT 记 `centerRounds`）。段内严格递增、不依赖本地墙钟。
 * `fo.centerDown` 中心不可达且双 buffer 都耗尽 ⇒ **发号中断**（`stalled`，钉死中心依赖）；
 * `fo.segmentGap` 重启/预取跳跃 ⇒ 未用完的段作废（`wastedIds`、ID 不连续）；
 * `fo.sequenceOverflow` 当前段用尽需取新段（`centerRounds` 增，RTT 代价）。
 */
export function createLeafSegment(opts = {}) {
  const nodes = namesOf(opts.nodes, IDGEN_DEFAULTS.nodes)
  const segmentSize = Math.max(2, intOr(opts.segmentSize, IDGEN_DEFAULTS.segmentSize))
  let centerCounter = 0                              // 内存模拟 Redis INCR 的单调 counter
  /** @type {Array<{lo:number,hi:number,next:number}|null>} */
  let buffers = [null, null]
  let active = 0
  let issued = 0, segmentsFetched = 0, wastedIds = 0, centerRounds = 0, bufferRefills = 0, stalled = 0
  const ids = []

  function fetchSegment(fo = {}, warmup = false) {
    // 运行期取新段才算中心 RTT 代价；构造期预热是**一次性资本支出**，不计入场景故障代价
    // （否则 allOk/clockBackward 这些「不中」的场景也会被预热的 RTT 误染成 centerRounds>0）。
    // centerAvailable（rigged）：注入「中心永远在线/无成本」⇒ 不计 RTT、且 centerDown 故障失效，
    // 抹掉中心依赖软肋以证伪（否则 rigged 干净场景仍被 centerDown 打停、退化为 101 无法证伪）。
    if (!warmup && opts.centerAvailable !== true) centerRounds += 1
    if (fo.centerDown === true && opts.centerAvailable !== true) return null
    const lo = centerCounter + 1
    const hi = lo + segmentSize - 1
    centerCounter = hi
    segmentsFetched += 1
    return { lo, hi, next: lo }
  }
  /** 预热双 buffer（构造即取两段；CLI/单测确定性，warmup 不计 RTT）。 */
  buffers[0] = fetchSegment({}, true)
  buffers[1] = fetchSegment({}, true)

  function next(fo = {}) {
    let b = buffers[active]
    if (fo.segmentGap === true && b && b.next < b.hi) {
      // 重启/预取跳跃：当前段剩余作废、直接换新段 ⇒ 不连续但唯一。
      wastedIds += b.hi - b.next + 1
      const fresh = fetchSegment(fo)
      if (fresh) { buffers[active] = fresh; b = fresh } else { b = null }
    }
    if (b && b.next > b.hi) b = null
    if (!b) {
      // 当前段用尽：切另一 buffer。
      const other = 1 - active
      if (buffers[other] && buffers[other].next <= buffers[other].hi) {
        active = other; b = buffers[other]; bufferRefills += 1
        if (fo.sequenceOverflow === true) centerRounds += 1   // 显式取新段的 RTT 代价
        // 异步补刚用尽的那一 buffer。
        const refilled = fetchSegment(fo)
        buffers[1 - active] = refilled
      } else {
        // 双 buffer 都空：同步取新段。
        const fresh = fetchSegment(fo)
        if (!fresh) { stalled += 1; return { id: null, key: null, issued: false, stalled: true, reason: 'center-down', centerRounds } }
        buffers[active] = fresh; b = fresh; bufferRefills += 1
      }
    }
    const id = b.next++
    ids.push(id); issued++
    return { id, key: id, issued: true, stalled: false, reason: 'ok', segmentLo: b.lo, segmentHi: b.hi, centerRounds }
  }

  function stats() {
    return {
      generator: 'caesura-idgen/leaf-segment', nodes: nodes.slice(), segmentSize, issued,
      unique: uniq(ids).length, segmentsFetched, wastedIds, centerRounds, bufferRefills, stalled,
      centerCounter, messages: centerRounds, latency: centerRounds > 0 ? 2 : 1,
      contiguous: wastedIds === 0,
    }
  }
  function snapshot(t) {
    return {
      generator: 'caesura-idgen/leaf-segment', stats: stats(),
      buffers: buffers.map((b) => b ? { ...b } : null), active,
      builtAt: t !== undefined ? t : nowOf(opts)(),
    }
  }
  function reset() {
    centerCounter = 0; buffers = [null, null]; active = 0
    issued = 0; segmentsFetched = 0; wastedIds = 0; centerRounds = 0; bufferRefills = 0; stalled = 0; ids.length = 0
    buffers[0] = fetchSegment({}, true); buffers[1] = fetchSegment({}, true)
  }

  return {
    next, fetchSegment, stats, snapshot, reset,
    get issued() { return issued }, get stalled() { return stalled }, get centerRounds() { return centerRounds },
    get wastedIds() { return wastedIds }, get segmentsFetched() { return segmentsFetched },
    get nodes() { return nodes.slice() }, get segmentSize() { return segmentSize },
  }
}

/* ============================================================
 * ④ B+ 树页分裂交叉印证（真 import KI-504）
 * ============================================================ */

const numberCompare = (a, b) => Number(a) < Number(b) ? -1 : Number(a) > Number(b) ? 1 : 0

/**
 * 用 KI-504 真 B+ 树量「主键插入顺序」对索引代价的影响。喂同一批 N 个 key：
 *  - `sequential`：0..N-1 递增插入（趋势递增主键，模拟 Snowflake/Segment）；
 *  - `random`：确定性洗牌后插入（随机主键，模拟 UUIDv4）。
 * 读真树 `stats().comparisons / splits / pageRewrites`（结构计数，非字节/墙钟跑分）。
 *
 * **诚实反直觉铁证（KI-509 首跑纠错）**：mid 分裂 + 半满稳态下，纯顺序插入每叶只装一半就分裂，
 * `splits` 反而**多于**随机插入（如 n=24/leafCap=8：顺序 5 分裂 vs 随机 3）；所以「随机主键伤索引」
 * 的真相**不是** splits 更多，而是**插入定位比较次数稳定更高**（`comparisons`：随机 > 顺序，实测
 * n=24/64/200/500 全正）、缓存命中率更低、页填充分散。故「索引友好」判据锚定 `comparisons`
 * （`randomCmpGtSequential`），并**如实保留** `randomFewerSplits` 这个反转读数，不粉饰、不编造。
 *
 * `sequentialIds:true` 时不洗牌（random 退化为顺序）⇒ 比较相等 ⇒ rigged 可证伪三协议全 111。
 */
export function btreePageSplitEvidence(opts = {}) {
  const n = Math.max(2, intOr(opts.keyCount, IDGEN_DEFAULTS.keyCount))
  const order = intOr(opts.order, IDGEN_DEFAULTS.treeOrder)
  const leafCapacity = intOr(opts.leafCapacity, IDGEN_DEFAULTS.leafCapacity)
  const rand = typeof opts.rand === 'function' ? opts.rand : makeRand(opts.seed)
  const sequentialIds = opts.sequentialIds === true
  const sequentialKeys = Array.from({ length: n }, (_, i) => i)
  const randomKeys = sequentialKeys.slice()
  if (!sequentialIds) {                              // rigged：不洗牌 ⇒ random 退化为顺序
    for (let i = randomKeys.length - 1; i > 0; i--) { // Fisher-Yates 确定性洗牌
      const j = Math.floor(rand() * (i + 1))
      const t = randomKeys[i]; randomKeys[i] = randomKeys[j]; randomKeys[j] = t
    }
  }
  const feed = (keys) => {
    const tree = createBPlusTree({ compare: numberCompare, order, leafCapacity })
    const c0 = tree.stats().comparisons
    for (const k of keys) tree.put(k, k)
    const s = tree.stats()
    return {
      comparisons: s.comparisons - c0, splits: s.splits, pageRewrites: s.pageRewrites,
      puts: s.puts, size: s.size, leafCount: s.leafCount, height: s.height,
    }
  }
  const sequential = feed(sequentialKeys)
  const random = feed(randomKeys)
  return {
    generator: 'caesura-idgen/bplus-crosscheck', n, order, leafCapacity, sequentialIds,
    sequential, random,
    // 索引友好判据（真正稳定）：随机主键定位比较 > 顺序主键 ⇒ 随机伤索引（缓冲池局部性差）。
    sequentialCmpBaseline: sequential.comparisons,
    randomCmp: random.comparisons,
    randomCmpGtSequential: random.comparisons > sequential.comparisons,
    // 如实保留的反直觉读数：mid 分裂下随机主键 splits 反而更少（不拿它当「伤索引」判据）。
    randomFewerSplits: random.splits < sequential.splits,
    randomGtSequential: random.splits > sequential.splits,
    randomWriteAmplification: random.pageRewrites > sequential.pageRewrites,
  }
}

/* ============================================================
 * ⑤ 场景编排 + 对照矩阵
 * ============================================================ */

function faultOf(at) { return { at } }

/**
 * 跑「单协议 × 单场景」，统一读数矩阵形状。故障对三协议的语义映射是诚实的（不打不相关软肋）：
 *  - `randomKeyInsert` 主攻 UUID 随机主键**插入定位比较**（真树 `comparisons` 随机 > 顺序，
 *    mid 分裂下 splits 反而更少，如实保留；Snowflake/Segment 趋势递增 ≈ 顺序基线）；
 *  - `clockBackward` 只打靠墙钟的 Snowflake（UUID 不用时钟、号段用中心单调 counter）；
 *  - `centerDown` 只打依赖中心的号段（UUID/Snowflake 本地生成）；
 *  - `sequenceOverflow` 打 Snowflake（等下一毫秒）与号段（取新段 RTT）、UUID 无序列概念不中；
 *  - `segmentGap` 只打号段预取跳跃、UUID/Snowflake 不中。
 */
export function runIdGenScenario(opts = {}) {
  const pid = PROTOCOL_SHORTS.includes(opts.protocol) ? opts.protocol : 'UUID'
  const scenario = opts.scenario || { id: 'allOk', label: '全成功', fault: {} }
  const fault = scenario.fault || {}
  const at = fault.at || 'allOk'
  const n = Math.max(2, intOr(opts.keyCount, IDGEN_DEFAULTS.keyCount))
  const base = {
    protocol: pid, scenario: scenario.id || 'custom', label: scenario.label || scenario.id || '自定义',
    issued: 0, unique: 0, duplicates: 0, stalled: 0, clockRollbacks: 0, waits: 0,
    pageSplits: 0, comparisons: 0, cmpBaseline: 0, wastedIds: 0, centerRounds: 0, messages: 0, latency: 1,
    indexFriendly: true, decentralized: true, clockRobust: true, uniqueIds: true, contiguous: true,
    detail: {},
  }
  /** @type {any} */
  let r

  if (pid === 'UUID') {
    const c = createUuidV4(opts)
    if (at === 'randomKeyInsert') {
      // 真树量 UUID 发出的 key 插索引代价；判据锚定 comparisons（稳定），splits 反转如实保留。
      const ev = btreePageSplitEvidence({ ...opts, keyCount: n, sequentialIds: opts.sequentialIds })
      const chosen = opts.sequentialIds ? ev.sequential : ev.random
      // 索引友好 = 定位比较不劣于顺序基线（非 rigged 随机比较更高 ⇒ false；rigged 顺序 ⇒ true）。
      const indexFriendly = opts.sequentialIds ? true : (ev.randomCmpGtSequential === false)
      return {
        ...base, issued: n, unique: n, pageSplits: chosen.splits,
        comparisons: chosen.comparisons, cmpBaseline: ev.sequentialCmpBaseline, indexFriendly,
        detail: {
          note: 'UUID 本地无中心、不依赖墙钟；随机主键真树定位比较更高（伤索引），mid 分裂下 splits 反而更少',
          cmpBaseline: ev.sequentialCmpBaseline, randomCmp: ev.random.comparisons,
          randomFewerSplits: ev.randomFewerSplits, mode: opts.sequentialIds ? 'sequentialIds(rigged)' : 'random',
        },
      }
    }
    if (at === 'centerDown' || at === 'clockBackward' || at === 'sequenceOverflow' || at === 'segmentGap') {
      // UUID 本地生成、无中心、无序列/墙钟软肋 ⇒ 这些故障不中，照常发号。
      for (let i = 0; i < n; i++) c.next()
    } else {
      for (let i = 0; i < n; i++) c.next()
    }
    const s = c.stats()
    return {
      ...base, issued: s.issued, unique: s.unique, uniqueIds: s.unique === s.issued,
      detail: { note: 'UUID 本地无中心、不依赖墙钟；随机主键真树定位比较更高、splits 反而更少（mid 分裂）', version: s.version, sequentialIds: s.sequentialIds },
    }
  }

  if (pid === 'Snowflake') {
    let c = createSnowflake(opts)
    if (at === 'clockBackward') {
      // 回拨必须注入**走时**时钟（opts.now 在 CLI 是固定时钟、触发不了 ts<lastTimestamp）：
      // 先 1000 发一枚建立 lastTimestamp，再把墙钟拨回 999。
      let tick = 1000
      c = createSnowflake({ ...opts, now: () => tick })
      c.next()
      tick = 999
      r = c.next({ clockBackward: true })             // 停发（或 forceDuplicate ⇒ 重复）
    } else if (at === 'sequenceOverflow') {
      for (let i = 0; i < n; i++) c.next({ sequenceOverflow: i === n - 1 })
    } else if (at === 'randomKeyInsert') {
      const ids = []
      for (let i = 0; i < n; i++) { const x = c.next(); if (x.id !== null) ids.push(x.id) }
      const ev = btreePageSplitEvidence({ ...opts, keyCount: n })
      // 趋势递增主键走顺序插入路径 ⇒ comparisons == 顺序基线 ⇒ 索引友好。
      return {
        ...base, issued: ids.length, unique: c.stats().unique, pageSplits: ev.sequential.splits,
        comparisons: ev.sequential.comparisons, cmpBaseline: ev.sequentialCmpBaseline,
        indexFriendly: ev.sequential.comparisons <= ev.sequentialCmpBaseline,
        detail: { note: 'Snowflake 时间戳趋势递增 ⇒ 真树定位比较 == 顺序基线（索引友好）；但墙钟回拨致命', cmpBaseline: ev.sequentialCmpBaseline, parsed: c.parse(ids[ids.length - 1]) },
      }
    } else {
      for (let i = 0; i < n; i++) c.next()
    }
    const s = c.stats()
    return {
      ...base, issued: s.issued, unique: s.unique, duplicates: s.duplicates, stalled: s.stalled,
      clockRollbacks: s.clockRollbacks, waits: s.waits, uniqueIds: s.duplicates === 0 && s.unique === s.issued,
      decentralized: s.centerRounds === 0, clockRobust: s.clockRollbacks === 0 && s.stalled === 0 && s.duplicates === 0,
      detail: { note: 'Snowflake 趋势递增+本地生成，但墙钟回拨⇒停发或重复', lastTimestamp: s.lastTimestamp, workerId: s.workerId },
    }
  }

  if (pid === 'Segment') {
    const c = createLeafSegment(opts)
    if (at === 'centerDown') {
      // 发到双 buffer 都耗尽 ⇒ 中心宕 ⇒ 中断。段长小，发 n 枚足以耗尽。
      for (let i = 0; i < n * 2; i++) c.next({ centerDown: i >= 2 })  // 前两枚用预热 buffer，之后 refill 失败
    } else if (at === 'segmentGap') {
      for (let i = 0; i < n; i++) c.next({ segmentGap: i % 3 === 0 })
    } else if (at === 'sequenceOverflow') {
      for (let i = 0; i < n; i++) c.next({ sequenceOverflow: i % 2 === 0 })
    } else if (at === 'clockBackward') {
      // 号段用中心单调 counter，不依赖本地墙钟 ⇒ 回拨不中，照常发号。
      for (let i = 0; i < n; i++) c.next()
    } else if (at === 'randomKeyInsert') {
      const ids = []
      for (let i = 0; i < n; i++) { const x = c.next(); if (x.id !== null) ids.push(x.id) }
      const ev = btreePageSplitEvidence({ ...opts, keyCount: n })
      // 号段段内严格递增 ⇒ 顺序插入路径 ⇒ comparisons == 顺序基线 ⇒ 索引友好。
      return {
        ...base, issued: ids.length, unique: c.stats().unique, pageSplits: ev.sequential.splits,
        comparisons: ev.sequential.comparisons, cmpBaseline: ev.sequentialCmpBaseline,
        indexFriendly: ev.sequential.comparisons <= ev.sequentialCmpBaseline,
        detail: { note: '号段段内严格递增 ⇒ 真树定位比较 == 顺序基线（索引友好）；但中心宕机中断', cmpBaseline: ev.sequentialCmpBaseline, contiguous: c.stats().contiguous },
      }
    } else {
      for (let i = 0; i < n; i++) c.next()
    }
    const s = c.stats()
    return {
      ...base, issued: s.issued, unique: s.unique, stalled: s.stalled, wastedIds: s.wastedIds,
      centerRounds: s.centerRounds, messages: s.messages, latency: s.latency,
      uniqueIds: s.unique === s.issued, contiguous: s.contiguous,
      // 号段默认依赖中心 Redis/DB 取号 ⇒ decentralized=false；
      // rigged centerAvailable=true 抹掉这一软肋（模拟中心永远在线/无成本）⇒ 退化为 true，供证伪。
      decentralized: opts.centerAvailable === true,
      clockRobust: true,                               // 不依赖本地墙钟
      detail: { note: '号段段内严格递增+不依赖墙钟，但中心宕机中断+重启跳号浪费', segmentSize: s.segmentSize, segmentsFetched: s.segmentsFetched },
    }
  }
  return base
}

/**
 * 核心对照：六场景 × 三协议的统一读数矩阵 + 三难判据 + verdict。
 *
 * 三难 = **索引友好 ∧ 去中心 ∧ 抗时钟异常**。逐协议量**真实**向量（不假设「各恰好缺一」）：
 *   UUID      = [索引 ✗, 去中心 ✓, 抗时钟 ✓] = `011`（随机主键伤索引）
 *   Snowflake = [索引 ✓, 去中心 ✓, 抗时钟 ✗] = `110`（墙钟回拨停发/重复）
 *   Segment   = [索引 ✓, 去中心 ✗, 抗时钟 ✓] = `101`（中心宕机中断）
 * 三条**互不相同**、**没有一条三个全 ✓** ⇒ 无全局赢家（`noUniversalWinner` 真）。判词可证伪：
 * rigged 配置（`sequentialIds:true` 抹掉 UUID 随机软肋 + 六场景故障全置空）跑，三协议都退化为
 * `111` ⇒ `trilemmaDistinguishes` 与 `noProtocolWinsAll` 同时翻 false。单测钉住。
 */
export function compareIdGen(opts = {}) {
  const scenarios = Array.isArray(opts.scenarios) ? opts.scenarios.map((s) => ({
    // 尊重调用方显式给的 fault 对象：空 `{}` = 明确无故障（rigged 可证伪用），缺省才按场景 id 注入默认故障。
    id: s.id, label: s.label || s.id, fault: (s.fault && typeof s.fault === 'object') ? s.fault : faultOf(s.id || 'allOk'),
  })) : IDGEN_SCENARIOS.map((s) => ({ id: s.id, label: s.label, fault: faultOf(s.id) }))
  const protocols = PROTOCOL_SHORTS
  /** @type {Record<string,any>} */
  const matrix = {}
  for (const p of protocols) {
    const cell = {
      protocol: p, label: PROTOCOL_LABELS[p], scenarios: {},
      totals: { issued: 0, unique: 0, duplicates: 0, stalled: 0, pageSplits: 0, comparisons: 0, wastedIds: 0, centerRounds: 0, waits: 0, messages: 0 },
      trilemma: { indexFriendly: false, decentralized: false, clockRobust: false },
    }
    for (const sc of scenarios) {
      const r = runIdGenScenario({ ...opts, protocol: p, scenario: sc })
      cell.scenarios[sc.id] = { ...r, label: sc.label, fault: sc.fault || {} }
      for (const k of Object.keys(cell.totals)) cell.totals[k] += Number(r[k]) || 0
    }
    matrix[p] = cell
  }

  const trilemma = {}
  for (const p of protocols) {
    const rows = Object.values(matrix[p].scenarios)
    trilemma[p] = {
      // 索引友好：randomKeyInsert 场景真树定位比较不劣于顺序基线（逐格读 indexFriendly 判据，锚定 comparisons）。
      indexFriendly: rows.every((r) => r.indexFriendly === true),
      // 去中心：全场景都无中心取号往返（messages/centerRounds 恒 0，号段 centerDown 场景 stalled 也证明依赖中心）。
      decentralized: rows.every((r) => r.decentralized === true),
      // 抗时钟异常：clockBackward 场景不回拨/不停发/不重复（逐格读 clockRobust 判据）。
      clockRobust: rows.every((r) => r.clockRobust === true),
    }
    matrix[p].trilemma = trilemma[p]
  }

  const sc = (p, id) => matrix[p].scenarios[id]
  const vecOf = (p) => `${Number(trilemma[p].indexFriendly)}${Number(trilemma[p].decentralized)}${Number(trilemma[p].clockRobust)}`
  const vectors = protocols.map(vecOf)
  const trilemmaDistinguishes = new Set(vectors).size === protocols.length
  const noProtocolWinsAll = !protocols.some((p) => trilemma[p].indexFriendly && trilemma[p].decentralized && trilemma[p].clockRobust)

  const verdict = {
    uuidRandomKeyIndexCost: (sc('UUID', 'randomKeyInsert')?.comparisons ?? 0) > 0,
    uuidPaysIndexCost: trilemma.UUID.indexFriendly === false,
    uuidDecentralizedClockRobust: trilemma.UUID.decentralized === true && trilemma.UUID.clockRobust === true,
    snowflakeIndexFriendly: (sc('Snowflake', 'randomKeyInsert')?.indexFriendly ?? false) === true,
    snowflakeDecentralized: trilemma.Snowflake.decentralized === true,
    snowflakeClockBackwardFatal: trilemma.Snowflake.clockRobust === false &&
      ((sc('Snowflake', 'clockBackward')?.stalled ?? 0) > 0 || (sc('Snowflake', 'clockBackward')?.duplicates ?? 0) > 0),
    segmentIndexFriendly: (sc('Segment', 'randomKeyInsert')?.indexFriendly ?? false) === true,
    segmentClockRobust: trilemma.Segment.clockRobust === true,
    segmentCenterDownStalls: (sc('Segment', 'centerDown')?.stalled ?? 0) > 0,
    segmentPaysCenterRounds: (sc('Segment', 'centerDown')?.centerRounds ?? 0) > 0 || (sc('Segment', 'sequenceOverflow')?.centerRounds ?? 0) > 0,
    segmentRestartGaps: (sc('Segment', 'segmentGap')?.wastedIds ?? 0) > 0,
    // 索引代价铁证：真树随机主键定位比较稳定 > 顺序主键（缓冲池局部性差的机制读数）。
    randomCmpGtSequential: btreePageSplitEvidence(opts).randomCmpGtSequential,
    // 诚实反直觉读数：mid 分裂下随机主键 splits 反而更少（不粉饰成「随机伤索引」）。
    randomFewerSplits: btreePageSplitEvidence(opts).randomFewerSplits,
    trilemmaDistinguishes,
    noProtocolWinsAll,
    noUniversalWinner:
      trilemma.UUID.indexFriendly === false && trilemma.UUID.decentralized === true && trilemma.UUID.clockRobust === true &&
      trilemma.Snowflake.indexFriendly === true && trilemma.Snowflake.decentralized === true && trilemma.Snowflake.clockRobust === false &&
      trilemma.Segment.indexFriendly === true && trilemma.Segment.decentralized === false && trilemma.Segment.clockRobust === true &&
      (sc('Segment', 'centerDown')?.stalled ?? 0) > 0 &&
      trilemmaDistinguishes && noProtocolWinsAll,
  }

  return {
    generator: 'caesura-idgen/compare',
    protocols,
    scenarios: scenarios.map((s) => ({ id: s.id, label: s.label, fault: s.fault || {} })),
    trilemmaVectors: Object.fromEntries(protocols.map((p) => [p, vecOf(p)])),
    matrix,
    verdict,
  }
}

/* ============================================================
 * ⑥ 判词探针 / study / snapshot / CLI
 * ============================================================ */

/** UUID 探针：128 位、版本/变体位、本地无中心、真树随机主键页分裂 > 顺序基线。 */
function uuidProbe(opts = {}) {
  const c = createUuidV4(opts)
  const a = c.next(), b = c.next()
  const ev = btreePageSplitEvidence(opts)
  return {
    issued: c.issued, globallyUnique: a.id !== b.id && c.stats().unique === c.stats().issued,
    version4: a.version === 4, variantBits: a.variant === 2, bitLength: c.stats().bitLength,
    localNoCenter: true, noWallClock: true,
    // 索引代价铁证：真树随机主键定位比较 > 顺序基线；splits 反转如实保留。
    randomCmp: ev.randomCmp, sequentialCmpBaseline: ev.sequentialCmpBaseline,
    randomCmpGtSequential: ev.randomCmpGtSequential,
    randomPageSplits: ev.random.splits, sequentialPageSplits: ev.sequential.splits,
    randomFewerSplits: ev.randomFewerSplits,
  }
}

/** Snowflake 探针：位布局可反解、同毫秒 sequence 自增、趋势单调、回拨停发、forceDuplicate 显重复。 */
function snowflakeProbe(opts = {}) {
  let t = 1000
  const c = createSnowflake({ ...opts, now: () => t })
  const a = c.next(), b = c.next()                  // 同毫秒 sequence 自增
  t = 1001
  const d = c.next()                                // 跨毫秒重置
  const pa = c.parse(a.id), pb = c.parse(b.id), pd = c.parse(d.id)
  const cBack = createSnowflake({ ...opts, now: () => t })
  cBack.next(); t = 999                              // 回拨
  const back = cBack.next({ clockBackward: true })
  // forceDuplicate：先 100 发一枚，再把墙钟拨回 99 ⇒ 激进实现发重复 ID（如实量代价）。
  let dupTick = 100; let dupCalls = 0
  const dupNow = createSnowflake({ ...opts, now: () => (dupCalls++ === 0 ? dupTick : 99) })
  dupNow.next(); const duplicate = dupNow.next({ clockBackward: true, forceDuplicate: true })
  return {
    parseRoundTrip: pa.timestamp === 1000 && pb.sequence === a.sequence + 1 && pd.timestamp === 1001,
    sameMsSequenceIncrement: pb.sequence === pa.sequence + 1 && pa.timestamp === pb.timestamp,
    trendMonotonic: d.id > b.id && b.id > a.id,
    firstId: a.id, nextId: b.id, parsed: pa,
    clockBackwardStalls: back.stalled === true && cBack.stats().clockRollbacks > 0,
    forceDuplicateReveals: duplicate.duplicate === true && dupNow.stats().duplicates > 0,
    localNoCenter: true,
  }
}

/** 号段探针：号段单调、双 buffer 预取、中心宕中断、重启跳号浪费、中心 RTT 计数、不依赖墙钟。 */
function segmentProbe(opts = {}) {
  const c = createLeafSegment(opts)
  const a = c.next(), b = c.next()
  const cDown = createLeafSegment(opts)
  for (let i = 0; i < Number(opts.keyCount ?? IDGEN_DEFAULTS.keyCount) * 2; i++) cDown.next({ centerDown: i >= 2 })
  const cGap = createLeafSegment(opts)
  for (let i = 0; i < Number(opts.keyCount ?? IDGEN_DEFAULTS.keyCount); i++) cGap.next({ segmentGap: i % 3 === 0 })
  const segStats = c.stats(), downStats = cDown.stats(), gapStats = cGap.stats()
  return {
    segmentMonotonic: b.id > a.id && a.id === 1,
    segmentsFetched: segStats.segmentsFetched, bufferRefills: segStats.bufferRefills,
    centerDownStalls: downStats.stalled > 0,
    centerRounds: downStats.centerRounds + gapStats.centerRounds,
    restartGaps: gapStats.wastedIds > 0, wastedIds: gapStats.wastedIds,
    contiguousWhenClean: segStats.contiguous === true,
    noWallClock: true,
  }
}

/** 汇总成纯数据 study（确定性、无真时钟/socket/磁盘）。 */
export function idGenStudy(opts = {}) {
  const comparison = compareIdGen(opts)
  const uuid = uuidProbe(opts)
  const snowflake = snowflakeProbe(opts)
  const segment = segmentProbe(opts)
  const btree = btreePageSplitEvidence(opts)
  return {
    generator: 'caesura-idgen',
    comparison, uuid, snowflake, segment, btree,
    verdict: {
      ...comparison.verdict,
      uuidGloballyUnique: uuid.globallyUnique,
      uuidVersion4: uuid.version4,
      uuidLocalNoCenter: uuid.localNoCenter,
      snowflakeParseRoundTrip: snowflake.parseRoundTrip,
      snowflakeTrendMonotonic: snowflake.trendMonotonic,
      snowflakeClockBackwardStalls: snowflake.clockBackwardStalls,
      snowflakeForceDuplicateReveals: snowflake.forceDuplicateReveals,
      segmentMonotonic: segment.segmentMonotonic,
      segmentCenterDownStalls: segment.centerDownStalls,
      segmentRestartGaps: segment.restartGaps,
      segmentNoWallClock: segment.noWallClock,
      // 真判词：随机主键定位比较 > 顺序基线（索引代价铁证）。
      btreeRandomCmpGtSequential: btree.randomCmpGtSequential,
      // 诚实反直觉读数：mid 分裂下随机主键 splits 反而更少（不作为「伤索引」判据）。
      btreeRandomFewerSplits: btree.randomFewerSplits,
    },
    builtAt: typeof opts.now === 'function' ? opts.now() : Date.now(),
  }
}

/** 把 study 收敛成前端 / status 友好的只读结构（node 侧判词，前端只渲染、不复核、不实测）。 */
export function igSnapshot(study) {
  if (!study || typeof study !== 'object') return null
  const c = study.comparison
  const rows = c.protocols.map((p) => {
    const m = c.matrix[p]
    return {
      protocol: p, label: m.label, trilemma: m.trilemma, totals: m.totals,
      scenarios: c.scenarios.map((s) => ({ id: s.id, label: s.label, ...m.scenarios[s.id] })),
    }
  })
  return {
    config: { protocols: c.protocols, scenarios: c.scenarios.map((s) => ({ id: s.id, label: s.label })) },
    rows,
    uuid: study.uuid, snowflake: study.snowflake, segment: study.segment,
    btree: study.btree,
    verdict: study.verdict,
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // 注入固定时钟 + 固定随机 ⇒ CLI 双跑字节一致；本件是确定性故障场景结构计数、非墙钟跑分。
  const study = idGenStudy({ now: () => 1000, rand: makeRand(IDGEN_DEFAULTS.seed) })
  const snap = igSnapshot(study)
  // 状态字：重=回拨重复 / 停=发号中断 / 裂=索引定位代价 / 隙=重启跳号 / 迟=中心 RTT / 成=正常。
  const stateOf = (r) => r.duplicates > 0 ? '重' : r.stalled > 0 ? '停' : r.indexFriendly === false ? '裂' : r.wastedIds > 0 ? '隙' : r.centerRounds > 0 ? '迟' : r.issued > 0 ? '成' : '?'
  const matrix = snap.rows.map((r) => ({
    protocol: r.protocol,
    ladder: snap.config.scenarios.map((s) => {
      const cell = r.scenarios.find((x) => x.id === s.id) || {}
      return s.id + ':' + stateOf(cell)
    }).join(' → '),
    totals: r.totals,
    trilemma: r.trilemma,
  }))
  console.log(JSON.stringify({
    generator: 'caesura-bplus-tree→caesura-distributed-lock→caesura-idgen (KI-509)',
    matrix,
    trilemmaVectors: study.comparison.trilemmaVectors,
    verdict: study.verdict,
    btree: study.btree,
    probes: { uuid: study.uuid, snowflake: study.snowflake, segment: study.segment },
  }, null, 2))
}
