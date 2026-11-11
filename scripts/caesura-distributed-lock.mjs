import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * scripts/caesura-distributed-lock.mjs —— 分布式锁与租约：单 Redis SETNX+TTL / Redlock 多数派 /
 * etcd Lease+Fencing Token 三协议诚实权衡对照（P8 第十六件，KI-508）。
 *
 * <p>补的是 KI-507 之后那一步。KI-507 用 Raft 共识把协调者日志复制到多数派、消除了 2PC 的协调者
 * 单点，却没碰生产里另一个更普遍的协调者单点——**互斥锁本身**：跨服务抢分布式锁 / 选主 / 幂等
 * 去重 / 全局资源配额，生产里是三条各有硬伤的路，没有一条能同时给你「绝对互斥 + 部分宕机还能用
 * + 低延迟」：</p>
 * <ol>
 *   <li>**单 Redis SETNX + TTL**：一次 RTT 最低延迟，TTL 到期自动释放。但**单点**（实例宕机即
 *       全盘不可用）、且**持锁者 GC 长暂停**时 TTL 在它仍以为持锁时耗尽 ⇒ 另一客户端拿锁成功 ⇒
 *       **双主写脏**；更没有 fencing，旧持锁者恢复后的写会被当正常写落库。</li>
 *   <li>**Redlock（多 Redis 实例多数派）**：N 个独立实例各自 SETNX，须在多数实例上拿到且总耗时
 *       < TTL 才算成功 ⇒ **少数实例宕机仍可加锁**（部分容错）。但它依赖各实例**本地墙钟**：实例间
 *       **时钟漂移**会让两个客户端各凑齐多数 ⇒ 双主写脏（Kleppmann 与 Sanfilippo 那场经典论战，
 *       本件不站队、只如实量代价）；且**没有 fencing**，同样兜不住旧持锁者的写；多数往返 ⇒ 延迟高。</li>
 *   <li>**etcd / ZooKeeper Lease + Fencing Token**：锁状态经 **Raft 多数派复制**、lease 靠**续租
 *       心跳**维持、每次成功 acquire 发一个**单调递增 fencing token**；后端记当前 token，**旧 token
 *       的写被拒**（`token < currentToken`）⇒ **即使锁被误授也永无双主写脏**，这正是 fencing 相对
 *       裸租约的价值。少数派分区凑不齐 quorum ⇒ 拒加锁（CP）；少数节点宕机多数还在 ⇒ 照常加锁。
 *       代价：Raft 多数派往返 ⇒ **延迟最高**、续租依赖客户端活跃度。</li>
 * </ol>
 *
 * <p>三只骨架 + 一只对照 + 三探针 + study/snapshot：</p>
 * <ol>
 *   <li>**`createRedisSetnxLock`**：单实例 SETNX 原语 `acquire/write/release/expire`，`fo.gcPause`
 *       的 `afterExpiry` 触发 TTL 过期双主、旧写 `fo.stale` 无 fencing 落库记 `dirtyWrites`。</li>
 *   <li>**`createRedlock`**：N 实例 quorum 原语，`fo.nodeDown` 少数宕机容错、`fo.clockDrift` 墙钟
 *       漂移双主、`fo.partitionMinority` 连不足多数拒加锁、旧写无 fencing 落库。</li>
 *   <li>**`createEtcdLeaseLock`**：Raft 复制租约 + 单调 `currentToken`，`write({token})` **真做数值
 *       比较**拒旧 token、`renew` 续租、`fo.partitionMinority` 少数派 CP 拒加锁、`fo.nodeDown` 多数
 *       容错；`fencingToken` 与 `staleWritesRejected` 都是真判据、非布尔桩。</li>
 *   <li>**`compareDistributedLock` 核心证据**：同一组**确定性故障场景**（全成功 / 持锁者 GC 暂停 /
 *       实例时钟漂移 / 少数节点宕机 / 客户端落少数派分区 / 旧持锁者过期凭证写）分喂三协议，数各
 *       `acquired/doubleOwners/dirtyWrites/blockedAcquires/staleWritesRejected/fencedProtected/messages/
 *       latency`，钉死「**SETNX** 最低延迟但单点 + GC 暂停双主写脏 / **Redlock** 抗少数宕机但靠墙钟、
 *       漂移破互斥、多数往返 / **etcd Lease+Fencing** 单调 token 兜底永无双主写脏 + Raft 容错，但
 *       多数往返延迟最高」这组最经典的真实取舍。</li>
 * </ol>
 *
 * <p>三难判据 = **互斥安全 ∧ 部分容错可用 ∧ 低延迟**。逐协议量**真实向量**（不假设「各恰好缺一」，
 * KI-506 初版过强假设的教训）：SETNX=[✓,✗,✓]=`001`、Redlock=[✗,✓,✗]=`010`、
 * ETCD=[✓,✓,✗]=`110`——三条**互不相同**、**没有一条三个全 ✓** ⇒ `noUniversalWinner` 真。**可证伪**：
 * 用 rigged 配置（单实例/单节点 = 抹掉多数派往返代价 + 六场景故障全置空）跑，三协议都退化为 `111`
 * ⇒ `trilemmaDistinguishes` / `noProtocolWinsAll` / `noUniversalWinner` 同时翻 false。单测钉住。</p>
 *
 * <p>诚实映射（不打不相关软肋）：`gcPause` 主攻单实例 SETNX 的 TTL 过期双主（Redlock 时间软肋集中
 * 在 `clockDrift` 量、无 fencing 软肋集中在 `staleFencing` 量，避免三协议同格重复计脏掩盖各自独立
 * 软肋）；`clockDrift` 只打靠墙钟的 Redlock（SETNX 单实例无跨实例时钟、etcd 用 Raft 逻辑租约不依赖
 * 实例墙钟）；`staleFencing` 同一次「旧凭证写」，etcd 真拒、SETNX/Redlock 无 token 兜不住落库脏写。</p>
 *
 * <p>设计取舍：时钟、实例/节点集、TTL、故障点、场景全由 opts 注入；本件只跑状态机与结构计数，不写
 * 业务阈值。与真 Redis / 真 etcd / 真 Raft / 真网络无运行时依赖——无真 SETNX 原子 Lua、无真 Raft
 * 日志/真 RPC、无真墙钟或跨进程互斥；所有读数都是**确定性故障场景上的结构计数**，不是墙钟、吞吐或
 * 真库一致性跑分。</p>
 *
 * 用法：
 *   const s = createRedisSetnxLock(); s.acquire('a'); s.acquire('b', {afterExpiry:true}) // 双主
 *   const r = createRedlock(); r.acquire('a'); r.acquire('b', {clockDrift:true})          // 漂移双主
 *   const e = createEtcdLeaseLock(); const a1 = e.acquire('old'); const a2 = e.acquire('new', {forceTakeover:true})
 *   e.write('old', {token:a1.fencingToken})                                              // 被拒
 *   const cmp = compareDistributedLock()
 *   const study = distributedLockStudy()               // 纯数据汇总
 *
 * CLI：node scripts/caesura-distributed-lock.mjs  （= npm run dlock:bench，注入固定时钟双跑字节一致）
 */

/** 缺省教学参数（实例/节点集、TTL、内部随机种子）。 */
export const LOCK_DEFAULTS = Object.freeze({
  instances: 5,                                      // Redlock 独立 Redis 实例数（quorum=3）
  nodes: Object.freeze(['n1', 'n2', 'n3', 'n4', 'n5']), // etcd Raft 节点集（quorum=3）
  ttlMs: 5000,                                       // 租约/锁 TTL（教学时间单位，非真实毫秒跑分）
  seed: 0x9e3779b9,
  zero: 0,
})

/** 三协议（顺序固定，短名作快照/矩阵 key）。 */
export const LOCK_PROTOCOLS = Object.freeze([
  Object.freeze({ id: 'redis-setnx', short: 'SETNX', label: '单 Redis SETNX+TTL' }),
  Object.freeze({ id: 'redlock', short: 'Redlock', label: 'Redlock 多数派' }),
  Object.freeze({ id: 'etcd-lease', short: 'ETCD', label: 'etcd Lease+Fencing' }),
])
const PROTOCOL_SHORTS = Object.freeze(LOCK_PROTOCOLS.map((p) => p.short))
const PROTOCOL_LABELS = Object.freeze(Object.fromEntries(LOCK_PROTOCOLS.map((p) => [p.short, p.label])))

/** 六类确定性故障场景（矩阵列；fault.at 决定场景，诚实不打不相关软肋）。 */
export const LOCK_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'allOk', label: '全成功' }),
  Object.freeze({ id: 'gcPause', label: '持锁者 GC 长暂停 TTL 过期' }),
  Object.freeze({ id: 'clockDrift', label: '实例墙钟漂移' }),
  Object.freeze({ id: 'nodeDown', label: '少数实例/节点宕机' }),
  Object.freeze({ id: 'partitionMinority', label: '客户端落少数派分区' }),
  Object.freeze({ id: 'staleFencing', label: '旧持锁者过期凭证写' }),
])

const asArr = (v) => Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v])
const uniq = (xs) => Array.from(new Set(xs))
const intOr = (v, d) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d
const namesOf = (v, fallback) => uniq((asArr(v).length ? asArr(v) : fallback).map(String))
const nowOf = (opts) => typeof opts.now === 'function' ? opts.now : () => Date.now()

/** 内部确定性 LCG（保留供 opts.rand 注入 / 双跑字节一致；本件默认不依赖随机）。 */
function makeRand(seed) {
  let x = (Number.isFinite(Number(seed)) ? Number(seed) : LOCK_DEFAULTS.seed) >>> 0
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 }
}

/* ============================================================
 * ① 单 Redis SETNX + TTL
 * ============================================================ */

/**
 * 单实例 SETNX 锁：一次 RTT、TTL 到期自动释放，但单点不可容错、GC 暂停致 TTL 过期即双主、
 * 无 fencing token 兜不住旧写。TTL 过期判定走注入 now()；场景层也可显式 `expire()` 推进，
 * 让测试/CLI 不依赖真实墙钟。
 */
export function createRedisSetnxLock(opts = {}) {
  const now = nowOf(opts)
  const ttlMs = intOr(opts.ttlMs, LOCK_DEFAULTS.ttlMs)
  let owner = null
  let expiresAt = 0
  let acquires = 0, ttlExpires = 0, doubleOwners = 0, dirtyWrites = 0, blockedAcquires = 0, messages = 0

  function expireIfNeeded() {
    if (owner !== null && now() >= expiresAt) { owner = null; expiresAt = 0; ttlExpires++; return true }
    return false
  }
  /** 显式推进到 TTL 过期（场景/单测用，避免依赖真实时钟流逝）。 */
  function expire() {
    if (owner !== null) { owner = null; expiresAt = 0; ttlExpires++; return true }
    return false
  }

  function acquire(client = 'c1', fo = {}) {
    messages += 1                                    // 单实例一次 SETNX RTT ⇒ 最低延迟
    if (fo.nodeDown === true) { blockedAcquires++; return { acquired: false, reason: 'single-point-down', blockedAcquires: 1, messages: 1, latency: 1 } }
    expireIfNeeded()
    if (fo.forceTakeover === true) {                 // 旧主被判死、新主干净接管（不产生「双主并存」）
      if (owner !== null) { owner = null; expiresAt = 0 }
    } else if (fo.afterExpiry === true && owner !== null) {
      // 旧持锁者 GC 长暂停 ⇒ TTL 在它仍以为持锁时耗尽 ⇒ 新客户端上位，旧主未 release ⇒ 双主并存。
      owner = null; expiresAt = 0; ttlExpires++; doubleOwners++
    }
    if (owner !== null && owner !== String(client)) return { acquired: false, reason: 'held', owner, messages: 1, latency: 1 }
    owner = String(client); expiresAt = now() + ttlMs; acquires++
    return { acquired: true, owner, expiresAt, fencingToken: 0, quorum: 1, messages: 1, latency: 1 }
  }

  function write(client = 'c1', fo = {}) {
    messages += 1
    if (fo.stale === true) {
      // 旧凭证写：SETNX 没有 fencing token，后端无法区分新旧 ⇒ 旧写落库 ⇒ 脏写。
      dirtyWrites++
      return { written: true, fenced: false, dirtyWrite: 1, staleWritesRejected: 0, reason: 'no-fencing-token' }
    }
    expireIfNeeded()
    if (owner !== String(client)) return { written: false, fenced: false, reason: 'not-owner' }
    return { written: true, fenced: false, owner }
  }

  function release(client = 'c1') {
    if (owner === String(client)) { owner = null; expiresAt = 0; return { released: true } }
    return { released: false, reason: 'not-owner-or-expired' }
  }

  function stats() {
    return {
      owner, expiresAt, ttlMs, acquires, ttlExpires, doubleOwners, dirtyWrites, blockedAcquires,
      messages, latency: 1, quorum: 1, fencingToken: 0, fencedProtected: false, locked: owner !== null,
    }
  }
  function snapshot(t) {
    return { generator: 'caesura-distributed-lock/setnx', stats: stats(), builtAt: t !== undefined ? t : now() }
  }
  function reset() {
    owner = null; expiresAt = 0; acquires = 0; ttlExpires = 0; doubleOwners = 0; dirtyWrites = 0
    blockedAcquires = 0; messages = 0
  }

  return {
    acquire, write, release, expire, stats, snapshot, reset,
    get owner() { return owner }, get messages() { return messages },
    get doubleOwners() { return doubleOwners }, get dirtyWrites() { return dirtyWrites },
  }
}

/* ============================================================
 * ② Redlock（多 Redis 实例多数派）
 * ============================================================ */

/**
 * Redlock：N 个独立 Redis 实例各自 SETNX + 本地墙钟 TTL，须在 quorum 个实例上拿到才算成功。
 * 少数实例宕机（存活 ≥ quorum）仍可加锁；实例间墙钟漂移会让第二客户端也凑齐多数 ⇒ 双主；
 * 无 fencing token ⇒ 旧写落库。多数往返 ⇒ latency = quorum（教学结构计数，非真实轮次跑分）。
 */
export function createRedlock(opts = {}) {
  const now = nowOf(opts)
  const instances = Math.max(1, intOr(opts.instances, LOCK_DEFAULTS.instances))
  const ttlMs = intOr(opts.ttlMs, LOCK_DEFAULTS.ttlMs)
  const quorum = Math.floor(instances / 2) + 1
  /** @type {Array<{owner:string|null,expiresAt:number}>} */
  let inst = Array.from({ length: instances }, () => ({ owner: null, expiresAt: 0 }))
  let acquires = 0, blockedAcquires = 0, clockDrifts = 0, doubleOwners = 0, dirtyWrites = 0, messages = 0

  function expireIfNeeded() {
    let n = 0
    for (const x of inst) if (x.owner !== null && now() >= x.expiresAt) { x.owner = null; x.expiresAt = 0; n++ }
    return n
  }
  function expire() {
    let n = 0
    for (const x of inst) if (x.owner !== null) { x.owner = null; x.expiresAt = 0; n++ }
    return n
  }
  const reachableOf = (fo) => {
    if (fo.nodeDown !== true) return instances
    const down = Math.min(instances, intOr(fo.nodeDownCount, Math.max(0, instances - quorum)))
    return instances - down                          // 默认挂到刚好剩 quorum ⇒ 容错成功
  }

  function acquire(client = 'c1', fo = {}) {
    const reachable = reachableOf(fo)
    messages += reachable
    if (fo.partitionMinority === true) {
      blockedAcquires++
      return { acquired: false, reason: 'minority-partition', quorum, acks: Math.max(0, reachable), latency: quorum, messages: reachable }
    }
    if (fo.clockDrift === true) {
      // 墙钟漂移 ⇒ 各实例对 TTL 判断不一致 ⇒ 第二客户端也能凑齐多数（不站队论战、只量代价）。
      clockDrifts++; doubleOwners++
      return { acquired: true, reason: 'clock-drift-split', quorum, acks: quorum, latency: quorum, messages: reachable, doubleOwners: 1, clockDrift: true }
    }
    if (reachable < quorum) {
      blockedAcquires++
      return { acquired: false, reason: 'no-quorum', quorum, acks: reachable, latency: quorum, messages: reachable }
    }
    expireIfNeeded()
    if (fo.forceTakeover === true) expire()           // 旧主判死、新主干净接管（不计双主）
    for (const x of inst) if (x.owner === null) { x.owner = String(client); x.expiresAt = now() + ttlMs }
    acquires++
    return { acquired: true, quorum, acks: quorum, latency: quorum, messages: reachable, fencingToken: 0, owner: String(client) }
  }

  function write(client = 'c1', fo = {}) {
    messages += 1
    if (fo.stale === true) { dirtyWrites++; return { written: true, fenced: false, dirtyWrite: 1, staleWritesRejected: 0, reason: 'no-fencing-token' } }
    expireIfNeeded()
    let held = 0
    for (const x of inst) if (x.owner === String(client)) held++
    return held >= quorum
      ? { written: true, fenced: false, held }
      : { written: false, fenced: false, reason: 'not-quorum-owner', held }
  }

  function release(client = 'c1') {
    let released = 0
    for (const x of inst) if (x.owner === String(client)) { x.owner = null; x.expiresAt = 0; released++ }
    return { released, ok: released > 0 }
  }

  function stats() {
    return {
      instances, quorum, acquires, blockedAcquires, clockDrifts, doubleOwners, dirtyWrites,
      staleWritesRejected: 0, fencedProtected: false, messages, latency: quorum, fencingToken: 0,
      locked: inst.some((x) => x.owner !== null),
    }
  }
  function snapshot(t) {
    return { generator: 'caesura-distributed-lock/redlock', stats: stats(), instances: inst.map((x) => ({ ...x })), builtAt: t !== undefined ? t : now() }
  }
  function reset() {
    inst = Array.from({ length: instances }, () => ({ owner: null, expiresAt: 0 }))
    acquires = 0; blockedAcquires = 0; clockDrifts = 0; doubleOwners = 0; dirtyWrites = 0; messages = 0
  }

  return {
    acquire, write, release, expire, stats, snapshot, reset,
    get quorum() { return quorum }, get instances() { return instances }, get messages() { return messages },
    get doubleOwners() { return doubleOwners }, get dirtyWrites() { return dirtyWrites },
  }
}

/* ============================================================
 * ③ etcd Lease + Fencing Token（Raft 复制租约）
 * ============================================================ */

/**
 * etcd 风格租约锁：锁状态经 Raft 多数派复制、lease 靠续租心跳维持、每次成功 acquire 发单调递增
 * `fencingToken`。`write({token})` **真做数值比较**：`token < currentToken` ⇒ 拒（stale token），
 * 这是「锁即使被误授也永不双主写脏」的真正机制。少数派分区凑不齐 quorum ⇒ CP 拒加锁；
 * 少数节点宕机多数还在 ⇒ 照常加锁。代价：Raft 多数派往返 ⇒ latency = quorum 最高、续租依赖活跃度。
 */
export function createEtcdLeaseLock(opts = {}) {
  const now = nowOf(opts)
  const nodes = namesOf(opts.nodes, LOCK_DEFAULTS.nodes)
  const quorum = Math.floor(nodes.length / 2) + 1
  const ttlMs = intOr(opts.ttlMs, LOCK_DEFAULTS.ttlMs)
  let currentToken = 0
  let leaseOwner = null
  let expiresAt = 0
  let acquires = 0, blockedAcquires = 0, leaseExpires = 0, renewals = 0, writes = 0
  let staleWritesRejected = 0, raftRounds = 0, messages = 0

  function expireIfNeeded() {
    if (leaseOwner !== null && now() >= expiresAt) { leaseOwner = null; expiresAt = 0; leaseExpires++; return true }
    return false
  }
  function expire() {
    if (leaseOwner !== null) { leaseOwner = null; expiresAt = 0; leaseExpires++; return true }
    return false
  }
  const reachableOf = (fo) => {
    if (fo.nodeDown !== true) return nodes.length
    const down = Math.min(nodes.length, intOr(fo.nodeDownCount, Math.max(0, nodes.length - quorum)))
    return nodes.length - down
  }

  function acquire(client = 'c1', fo = {}) {
    messages += quorum; raftRounds += quorum
    if (fo.partitionMinority === true) {
      blockedAcquires++
      return { acquired: false, reason: 'minority-partition', quorum, latency: quorum, raftRounds: quorum, messages: quorum }
    }
    const reachable = reachableOf(fo)
    if (reachable < quorum) {
      blockedAcquires++
      return { acquired: false, reason: 'no-quorum', quorum, acks: reachable, latency: quorum, raftRounds: quorum, messages: quorum }
    }
    expireIfNeeded()
    if (leaseOwner !== null && leaseOwner !== String(client) && fo.forceTakeover !== true) {
      return { acquired: false, reason: 'lease-held', fencingToken: currentToken, quorum, latency: quorum, messages: quorum }
    }
    if (fo.forceTakeover === true && leaseOwner !== null) { leaseOwner = null; expiresAt = 0 }
    currentToken++
    leaseOwner = String(client); expiresAt = now() + ttlMs; acquires++
    const r = { acquired: true, fencingToken: currentToken, quorum, acks: reachable, latency: quorum, raftRounds: quorum, messages: quorum, owner: leaseOwner }
    if (fo.clockDrift === true) r.clockDriftTolerated = true   // Raft 逻辑租约不依赖实例墙钟一致
    return r
  }

  /** 续租心跳：刷新 expiresAt；`renewFail` 模拟客户端失联 ⇒ lease 过期被回收。 */
  function renew(client = 'c1', fo = {}) {
    messages += 1
    if (fo.renewFail === true) { const did = expire(); return { renewed: false, reason: 'renew-failed', expired: did } }
    expireIfNeeded()
    if (leaseOwner !== String(client)) return { renewed: false, reason: 'not-owner' }
    expiresAt = now() + ttlMs; renewals++
    return { renewed: true, expiresAt }
  }

  /** 带 fencing token 的写：真数值比较，旧 token 被后端拒绝（不产生脏写）。 */
  function write(client = 'c1', fo = {}) {
    messages += 1
    const token = intOr(fo.token, currentToken)
    if (token < currentToken) {
      staleWritesRejected++
      return { written: false, fenced: true, reason: 'stale-fencing-token', token, currentToken, staleWritesRejected: 1 }
    }
    expireIfNeeded()
    if (leaseOwner !== String(client)) return { written: false, fenced: true, reason: 'not-owner', token, currentToken }
    writes++
    return { written: true, fenced: true, token, currentToken, owner: leaseOwner }
  }

  function release(client = 'c1', fo = {}) {
    // 与 write 判据顺序一致：token 数值落后**先拒**（哪怕 owner 名字对得上也不许踢掉持更新 token 的新主）。
    if (fo.token !== undefined && Number(fo.token) < currentToken) { staleWritesRejected++; return { released: false, reason: 'stale-fencing-token' } }
    if (leaseOwner !== String(client)) return { released: false, reason: 'not-owner' }
    expire(); return { released: true }
  }

  function stats() {
    return {
      nodes: nodes.length, quorum, currentToken, leaseOwner, expiresAt,
      acquires, blockedAcquires, leaseExpires, renewals, writes, staleWritesRejected,
      doubleOwners: 0, dirtyWrites: 0, messages, latency: quorum, raftRounds,
      fencedProtected: staleWritesRejected > 0, locked: leaseOwner !== null,
    }
  }
  function snapshot(t) {
    return { generator: 'caesura-distributed-lock/etcd', stats: stats(), nodes: nodes.slice(), builtAt: t !== undefined ? t : now() }
  }
  function reset() {
    currentToken = 0; leaseOwner = null; expiresAt = 0
    acquires = 0; blockedAcquires = 0; leaseExpires = 0; renewals = 0; writes = 0
    staleWritesRejected = 0; raftRounds = 0; messages = 0
  }

  return {
    acquire, renew, write, release, expire, stats, snapshot, reset,
    get quorum() { return quorum }, get nodes() { return nodes.slice() }, get messages() { return messages },
    get currentToken() { return currentToken }, get staleWritesRejected() { return staleWritesRejected },
  }
}

/* ============================================================
 * ④ 场景编排 + 对照矩阵
 * ============================================================ */

function faultOf(at) { return { at } }

/**
 * 跑「单协议 × 单场景」，统一读数矩阵形状。故障对三协议的语义映射是诚实的（不打不相关软肋）：
 *  - `gcPause` 主攻 SETNX 的 TTL 过期双主（Redlock 时间软肋在 clockDrift、无 fencing 在 staleFencing 量，
 *    etcd 靠 fencing 挡住旧写）；
 *  - `clockDrift` 只打靠墙钟的 Redlock（SETNX 单实例、etcd 逻辑租约不中）；
 *  - `nodeDown` 打单点 SETNX（不可用）/ 被 Redlock·etcd 多数容错挡住；
 *  - `partitionMinority` 打 Redlock·etcd（凑不齐 quorum 拒加锁）/ SETNX 无 quorum 概念不中；
 *  - `staleFencing` 同一次旧凭证写：etcd 真拒、SETNX·Redlock 无 token 落库脏写。
 */
export function runDistributedLockScenario(opts = {}) {
  const pid = PROTOCOL_SHORTS.includes(opts.protocol) ? opts.protocol : 'SETNX'
  const scenario = opts.scenario || { id: 'allOk', label: '全成功', fault: {} }
  const fault = scenario.fault || {}
  const at = fault.at || 'allOk'
  const base = {
    protocol: pid, scenario: scenario.id || 'custom', label: scenario.label || scenario.id || '自定义',
    acquired: false, doubleOwners: 0, dirtyWrites: 0, blockedAcquires: 0, staleWritesRejected: 0,
    fencedProtected: false, mutualExcluded: true, converged: true,
    messages: 0, latency: 1, quorum: 1, rounds: 0, detail: {},
  }
  /** @type {any} */
  let c, r, w

  if (pid === 'SETNX') {
    c = createRedisSetnxLock(opts)
    if (at === 'gcPause') {
      c.acquire('old')
      r = c.acquire('new', { afterExpiry: true })      // TTL 过期 ⇒ 双主并存
      w = c.write('old', { stale: true })              // 无 fencing ⇒ 旧写落库脏写
    } else if (at === 'staleFencing') {
      const a1 = c.acquire('old')
      r = c.acquire('new', { forceTakeover: true })    // 干净接管（不计双主）
      w = c.write('old', { token: a1.fencingToken, stale: true })
    } else if (at === 'nodeDown') {
      r = c.acquire('c1', { nodeDown: true })
    } else {
      // allOk / clockDrift / partitionMinority：单实例 SETNX 无跨实例时钟、无 quorum 概念 ⇒ 不中这些软肋。
      r = c.acquire('c1', fault)
    }
    const s = c.stats()
    return {
      ...base, acquired: r.acquired === true, doubleOwners: s.doubleOwners, dirtyWrites: s.dirtyWrites,
      blockedAcquires: s.blockedAcquires, staleWritesRejected: s.staleWritesRejected,
      fencedProtected: false, mutualExcluded: s.doubleOwners === 0 && s.dirtyWrites === 0,
      messages: s.messages, latency: s.latency, quorum: s.quorum, rounds: 0,
      detail: { reason: r.reason, owner: s.owner, ttlExpires: s.ttlExpires, writeFenced: w ? w.fenced : null, note: '单实例一次 RTT；GC 暂停 TTL 过期即双主' },
    }
  }

  if (pid === 'Redlock') {
    c = createRedlock(opts)
    if (at === 'clockDrift') {
      c.acquire('c1')
      r = c.acquire('c2', { clockDrift: true })        // 墙钟漂移 ⇒ 两客户端各凑齐多数
      w = c.write('c1', { stale: true })
    } else if (at === 'staleFencing') {
      c.acquire('old')
      r = c.acquire('new', { forceTakeover: true })
      w = c.write('old', { stale: true })              // 无 fencing ⇒ 脏写
    } else if (at === 'partitionMinority') {
      r = c.acquire('c1', { partitionMinority: true }) // 连不足 quorum ⇒ 拒加锁
    } else if (at === 'nodeDown') {
      r = c.acquire('c1', { nodeDown: true })          // 多数存活 ⇒ 容错成功
    } else {
      // allOk / gcPause：Redlock 时间软肋集中在 clockDrift 量，不在此重复计脏。
      r = c.acquire('c1', fault)
    }
    const s = c.stats()
    return {
      ...base, acquired: r.acquired === true, doubleOwners: s.doubleOwners, dirtyWrites: s.dirtyWrites,
      blockedAcquires: s.blockedAcquires, staleWritesRejected: s.staleWritesRejected,
      fencedProtected: false, mutualExcluded: s.doubleOwners === 0 && s.dirtyWrites === 0,
      messages: s.messages, latency: s.latency, quorum: s.quorum, rounds: s.quorum,
      detail: { reason: r.reason, instances: s.instances, quorum: s.quorum, acks: r.acks, clockDrifts: s.clockDrifts, writeFenced: w ? w.fenced : null, note: '墙钟 quorum 抗少数宕机，但漂移/无 fencing 破互斥' },
    }
  }

  if (pid === 'ETCD') {
    c = createEtcdLeaseLock(opts)
    if (at === 'gcPause') {
      const a1 = c.acquire('old')
      c.renew('old', { renewFail: true })              // 续租失败 ⇒ lease 过期
      r = c.acquire('new')                             // 新 token 上位
      w = c.write('old', { token: a1.fencingToken })   // 旧 token 写 ⇒ 真拒
    } else if (at === 'staleFencing') {
      const a1 = c.acquire('old')
      r = c.acquire('new', { forceTakeover: true })    // 旧主判死、新主接管（token++）
      w = c.write('old', { token: a1.fencingToken })   // 旧 token 写 ⇒ 真拒
    } else if (at === 'partitionMinority') {
      r = c.acquire('c1', { partitionMinority: true }) // 少数派 ⇒ CP 拒加锁
    } else if (at === 'nodeDown') {
      r = c.acquire('c1', { nodeDown: true })          // 多数存活 ⇒ 容错成功
    } else {
      // allOk / clockDrift：Raft 逻辑租约不依赖实例墙钟 ⇒ 漂移不中。
      r = c.acquire('c1', fault)
    }
    const s = c.stats()
    return {
      ...base, acquired: r.acquired === true, doubleOwners: s.doubleOwners, dirtyWrites: s.dirtyWrites,
      blockedAcquires: s.blockedAcquires, staleWritesRejected: s.staleWritesRejected,
      fencedProtected: s.fencedProtected, mutualExcluded: s.doubleOwners === 0 && s.dirtyWrites === 0,
      messages: s.messages, latency: s.latency, quorum: s.quorum, rounds: s.raftRounds,
      detail: { reason: r.reason, nodes: s.nodes, quorum: s.quorum, acks: r.acks, currentToken: s.currentToken, fencingToken: r.fencingToken, writeFenced: w ? w.fenced : null, note: 'Raft 复制租约 + 单调 fencing：锁误授也拒旧写，代价多数往返延迟' },
    }
  }
  return base
}

/**
 * 核心对照：六场景 × 三协议的统一读数矩阵 + 三难判据 + verdict。
 *
 * 三难 = **互斥安全 ∧ 部分容错可用 ∧ 低延迟**。逐协议量**真实**向量（不假设「各恰好缺一」）：
 *   SETNX   = [互斥 ✗, 容错 ✗, 低延迟 ✓] = `001`（GC 暂停双主 + 单点不可容错）
 *   Redlock = [互斥 ✗, 容错 ✓, 低延迟 ✗] = `010`（墙钟漂移双主 + 无 fencing + 多数往返）
 *   ETCD    = [互斥 ✓, 容错 ✓, 低延迟 ✗] = `110`（m fencing 兜底 + Raft 容错，但多数往返延迟最高）
 * 三条**互不相同**、**没有一条三个全 ✓** ⇒ 无全局赢家（`noUniversalWinner` 真）。判词可证伪：
 * rigged 配置（单实例/单节点 + 六场景故障全置空）跑，三协议都退化为 `111` ⇒ `trilemmaDistinguishes`
 * 与 `noProtocolWinsAll` 同时翻 false。单测钉住。
 */
export function compareDistributedLock(opts = {}) {
  const scenarios = Array.isArray(opts.scenarios) ? opts.scenarios.map((s) => ({
    // 尊重调用方显式给的 fault 对象：空 `{}` = 明确无故障（rigged 可证伪用），缺省才按场景 id 注入默认故障。
    id: s.id, label: s.label || s.id, fault: (s.fault && typeof s.fault === 'object') ? s.fault : faultOf(s.id || 'allOk'),
  })) : LOCK_SCENARIOS.map((s) => ({ id: s.id, label: s.label, fault: faultOf(s.id) }))
  const protocols = PROTOCOL_SHORTS
  /** @type {Record<string,any>} */
  const matrix = {}
  for (const p of protocols) {
    const cell = {
      protocol: p, label: PROTOCOL_LABELS[p], scenarios: {},
      totals: { acquired: 0, doubleOwners: 0, dirtyWrites: 0, blockedAcquires: 0, staleWritesRejected: 0, messages: 0, fencedCount: 0 },
      trilemma: { mutualExclusion: false, partialFaultTolerance: false, lowLatency: false },
    }
    for (const sc of scenarios) {
      const r = runDistributedLockScenario({ ...opts, protocol: p, scenario: sc })
      cell.scenarios[sc.id] = { ...r, label: sc.label, fault: sc.fault || {} }
      cell.totals.acquired += r.acquired ? 1 : 0
      cell.totals.doubleOwners += r.doubleOwners
      cell.totals.dirtyWrites += r.dirtyWrites
      cell.totals.blockedAcquires += r.blockedAcquires
      cell.totals.staleWritesRejected += r.staleWritesRejected
      cell.totals.messages += r.messages
      cell.totals.fencedCount += r.fencedProtected ? 1 : 0
    }
    matrix[p] = cell
  }

  const trilemma = {}
  for (const p of protocols) {
    const rows = Object.values(matrix[p].scenarios)
    trilemma[p] = {
      // 互斥安全：全场景无双主写脏（etcd 的 staleFencing 是「旧写被拒」、dirtyWrites=0，不破互斥）。
      mutualExclusion: rows.every((r) => r.doubleOwners === 0 && r.dirtyWrites === 0),
      // 部分容错：少数实例/节点宕机时仍能加锁（只量 nodeDown 这一件事，不混入 CP 的分区拒写）。
      partialFaultTolerance: matrix[p].scenarios.nodeDown?.acquired === true,
      // 低延迟：全场景加锁都无需多数派往返（rigged 单实例 quorum=1 ⇒ 退化为真）。
      lowLatency: rows.every((r) => r.latency === 1),
    }
    matrix[p].trilemma = trilemma[p]
  }

  const sc = (p, id) => matrix[p].scenarios[id]
  const vecOf = (p) => `${Number(trilemma[p].mutualExclusion)}${Number(trilemma[p].partialFaultTolerance)}${Number(trilemma[p].lowLatency)}`
  const vectors = protocols.map(vecOf)
  const trilemmaDistinguishes = new Set(vectors).size === protocols.length
  const noProtocolWinsAll = !protocols.some((p) => trilemma[p].mutualExclusion && trilemma[p].partialFaultTolerance && trilemma[p].lowLatency)

  const verdict = {
    setnxGcPauseDoubleOwner: (sc('SETNX', 'gcPause')?.doubleOwners ?? 0) > 0 && (sc('SETNX', 'gcPause')?.dirtyWrites ?? 0) > 0,
    setnxSinglePointDown: (sc('SETNX', 'nodeDown')?.acquired ?? true) === false,
    setnxLowLatencyOnly: trilemma.SETNX.lowLatency === true && trilemma.SETNX.mutualExclusion === false && trilemma.SETNX.partialFaultTolerance === false,
    redlockClockDriftDoubleOwner: (sc('Redlock', 'clockDrift')?.doubleOwners ?? 0) > 0,
    redlockToleratesNodeDown: (sc('Redlock', 'nodeDown')?.acquired ?? false) === true,
    redlockMinorityRefuses: (sc('Redlock', 'partitionMinority')?.acquired ?? true) === false,
    redlockNoFencing: (sc('Redlock', 'staleFencing')?.fencedProtected ?? true) === false && (sc('Redlock', 'staleFencing')?.dirtyWrites ?? 0) > 0,
    etcdNeverDirty: trilemma.ETCD.mutualExclusion === true,
    etcdToleratesNodeDown: (sc('ETCD', 'nodeDown')?.acquired ?? false) === true,
    etcdMinorityRefusesCP: (sc('ETCD', 'partitionMinority')?.acquired ?? true) === false,
    etcdFencingRejectsStale: (sc('ETCD', 'staleFencing')?.staleWritesRejected ?? 0) > 0 && (sc('ETCD', 'staleFencing')?.fencedProtected ?? false) === true,
    etcdPaysQuorumLatency: trilemma.ETCD.lowLatency === false,
    trilemmaDistinguishes,
    noProtocolWinsAll,
    noUniversalWinner:
      (sc('SETNX', 'gcPause')?.doubleOwners ?? 0) > 0 && trilemma.SETNX.partialFaultTolerance === false && trilemma.SETNX.lowLatency === true &&
      (sc('Redlock', 'clockDrift')?.doubleOwners ?? 0) > 0 && trilemma.Redlock.partialFaultTolerance === true && trilemma.Redlock.lowLatency === false &&
      trilemma.ETCD.mutualExclusion === true && trilemma.ETCD.partialFaultTolerance === true && trilemma.ETCD.lowLatency === false &&
      (sc('ETCD', 'staleFencing')?.staleWritesRejected ?? 0) > 0 &&
      trilemmaDistinguishes && noProtocolWinsAll,
  }

  return {
    generator: 'caesura-distributed-lock/compare',
    protocols,
    scenarios: scenarios.map((s) => ({ id: s.id, label: s.label, fault: s.fault || {} })),
    trilemmaVectors: Object.fromEntries(protocols.map((p) => [p, vecOf(p)])),
    matrix,
    verdict,
  }
}

/* ============================================================
 * ⑤ 判词探针 / study / snapshot / CLI
 * ============================================================ */

/** SETNX 探针：活着时互斥、TTL 自然释放、GC 暂停双主写脏、单点宕机、无 fencing。 */
function setnxProbe(opts = {}) {
  const c = createRedisSetnxLock(opts)
  const a = c.acquire('old')
  const again = c.acquire('other')                    // 锁未过期 ⇒ 抢不到（正常互斥）
  c.acquire('new', { afterExpiry: true })             // TTL 过期 ⇒ 双主
  const dirty = c.write('old', { stale: true })       // 无 fencing ⇒ 旧写落库
  const down = c.acquire('x', { nodeDown: true })
  const s = c.stats()
  // TTL 自然释放：注入走时时钟，不依赖真实墙钟。
  let t = 0
  const c2 = createRedisSetnxLock({ ...opts, now: () => t })
  c2.acquire('a'); t = Number(opts.ttlMs ?? LOCK_DEFAULTS.ttlMs) + 1
  const after = c2.acquire('b')
  return {
    acquired: a.acquired === true,
    mutexWhileLive: again.acquired === false,
    ttlAutoRelease: after.acquired === true && c2.stats().ttlExpires >= 1,
    gcPauseDoubleOwner: s.doubleOwners > 0,
    gcPauseDirtyWrite: s.dirtyWrites > 0 && dirty.dirtyWrite === 1,
    singlePointDown: down.acquired === false,
    noFencing: dirty.fenced === false,
  }
}

/** Redlock 探针：quorum 加锁、少数宕机容错、少数派分区拒锁、墙钟漂移双主、无 fencing 脏写。 */
function redlockProbe(opts = {}) {
  const c = createRedlock(opts)
  const a = c.acquire('c1')
  const down = c.acquire('c2', { nodeDown: true })
  const minority = c.acquire('c3', { partitionMinority: true })
  c.acquire('c4')
  const drift = c.acquire('c5', { clockDrift: true })
  const dirty = c.write('c4', { stale: true })
  const s = c.stats()
  return {
    quorumAcquire: a.acquired === true && a.quorum === s.quorum,
    quorum: s.quorum, instances: s.instances,
    toleratesNodeDown: down.acquired === true,
    minorityRefuses: minority.acquired === false,
    clockDriftDoubleOwner: drift.doubleOwners === 1 && s.doubleOwners > 0,
    clockDrifts: s.clockDrifts > 0,
    noFencingDirtyWrite: s.dirtyWrites > 0 && dirty.fenced === false,
  }
}

/** Fencing 探针：token 单调、续租、过期租约不可续、旧 token 写被真拒、少数派 CP 拒锁、少数宕机容错。 */
function fencingProbe(opts = {}) {
  const c = createEtcdLeaseLock(opts)
  const a1 = c.acquire('old')
  const a2 = c.acquire('new', { forceTakeover: true })   // token++（旧主判死、新主接管）
  const stale = c.write('old', { token: a1.fencingToken }) // 旧 token 写 ⇒ 真拒
  const s = c.stats()
  const cMin = createEtcdLeaseLock(opts)
  const minority = cMin.acquire('c1', { partitionMinority: true })
  const cDown = createEtcdLeaseLock(opts)
  const down = cDown.acquire('c1', { nodeDown: true })
  // 续租：TTL 内成功；过期租约不可续（注入走时时钟）。
  let t = 0
  const cR = createEtcdLeaseLock({ ...opts, now: () => t })
  cR.acquire('a')
  const fresh = cR.renew('a')
  t = Number(opts.ttlMs ?? LOCK_DEFAULTS.ttlMs) + 1
  const expired = cR.renew('a')
  return {
    tokenMonotonic: a2.fencingToken > a1.fencingToken && s.currentToken === a2.fencingToken,
    firstToken: a1.fencingToken, nextToken: a2.fencingToken,
    rejectsStaleWrite: stale.written === false && stale.fenced === true && stale.reason === 'stale-fencing-token',
    noDirtyOnStale: s.dirtyWrites === 0 && s.staleWritesRejected > 0,
    fencedProtected: stale.fenced === true,
    minorityRefusesCP: minority.acquired === false,
    toleratesNodeDown: down.acquired === true,
    leaseRenewFresh: fresh.renewed === true,
    expiredLeaseCannotRenew: expired.renewed === false,
    quorum: s.quorum,
  }
}

/** 汇总成纯数据 study（确定性、无真时钟/socket/磁盘）。 */
export function distributedLockStudy(opts = {}) {
  const comparison = compareDistributedLock(opts)
  const setnx = setnxProbe(opts)
  const redlock = redlockProbe(opts)
  const fencing = fencingProbe(opts)
  return {
    generator: 'caesura-distributed-lock',
    comparison, setnx, redlock, fencing,
    verdict: {
      ...comparison.verdict,
      setnxMutexWhileLive: setnx.mutexWhileLive,
      setnxTtlAutoRelease: setnx.ttlAutoRelease,
      setnxGcPauseDoubleOwner: setnx.gcPauseDoubleOwner,
      setnxSinglePointDown: setnx.singlePointDown,
      redlockQuorumAcquire: redlock.quorumAcquire,
      redlockToleratesNodeDown: redlock.toleratesNodeDown,
      redlockMinorityRefuses: redlock.minorityRefuses,
      redlockClockDriftDoubleOwner: redlock.clockDriftDoubleOwner,
      redlockNoFencingDirtyWrite: redlock.noFencingDirtyWrite,
      fencingTokenMonotonic: fencing.tokenMonotonic,
      fencingLeaseRenewFresh: fencing.leaseRenewFresh,
      fencingExpiredLeaseNoRenew: fencing.expiredLeaseCannotRenew,
      fencingRejectsStaleWrite: fencing.rejectsStaleWrite,
      fencingNoDirtyOnStale: fencing.noDirtyOnStale,
      fencingMinorityRefusesCP: fencing.minorityRefusesCP,
    },
    builtAt: typeof opts.now === 'function' ? opts.now() : Date.now(),
  }
}

/** 把 study 收敛成前端 / status 友好的只读结构（node 侧判词，前端只渲染、不复核、不实测）。 */
export function dlSnapshot(study) {
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
    setnx: study.setnx, redlock: study.redlock, fencing: study.fencing,
    verdict: study.verdict,
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // 注入固定时钟 ⇒ CLI 双跑字节一致；本件是确定性故障场景结构计数、非墙钟跑分。
  const study = distributedLockStudy({ now: () => 0, rand: makeRand(LOCK_DEFAULTS.seed) })
  const snap = dlSnapshot(study)
  const stateOf = (r) => r.doubleOwners > 0 ? '双' : r.staleWritesRejected > 0 ? '护' : r.dirtyWrites > 0 ? '脏' : r.blockedAcquires > 0 ? (r.protocol === 'SETNX' ? '阻' : '拒') : r.acquired ? '成' : '?'
  const matrix = snap.rows.map((r) => ({
    protocol: r.protocol,
    ladder: snap.config.scenarios.map((s) => s.id + ':' + stateOf(r.scenarios.find((x) => x.id === s.id) || {})).join(' → '),
    totals: r.totals,
    trilemma: r.trilemma,
  }))
  console.log(JSON.stringify({
    generator: 'caesura-distributed-txn→caesura-raft-consensus→caesura-distributed-lock (KI-508)',
    matrix,
    trilemmaVectors: study.comparison.trilemmaVectors,
    verdict: study.verdict,
    probes: {
      setnx: study.setnx,
      redlock: study.redlock,
      fencing: study.fencing,
    },
  }, null, 2))
}
