import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * scripts/caesura-mvcc-txn.mjs —— 事务与并发控制：MVCC 多版本可见性 + 五档隔离级别异常对照 + 行锁 2PL 死锁检测
 * （P8 第十三件，KI-505）。
 *
 * <p>补的是数据库内核三件套的最后一块。KI-496 落了**存储引擎**（LSM：memtable/SSTable/compaction），
 * KI-504 落了**索引**（真 B+ 树），却始终没有**事务与并发控制**——于是讲不出「同一行被并发读写时
 * 谁看得见谁」，也讲不出五档隔离级别到底各挡得住哪几类经典异常、更讲不出两事务互等行锁的死锁怎么
 * 检测和打破。LSM 里的 `seq` 多版本与 `tombstone` 本就是 MVCC 的雏形，本件第一次把它显式化成
 * **事务可见性判词**，与 KI-496/504 合成「存储 + 索引 + 事务」三件套。</p>
 *
 * <p>四只骨架（缺一不可）：</p>
 * <ol>
 *   <li>**`createVersionChain` 多版本链**：单 key 的版本数组，每版带 `beginTs`/`commitTs`/`writerTxn`/
 *       `tombstone`。`visibleAt(readTs, readerTxn)` 按 MVCC 判据取对某快照可见的最新版——已提交且
 *       `commitTs<=readTs`、或**自己未提交的版本对己可见**、`tombstone` 表删除；`compact(waterMarkTs)`
 *       按水位回收旧版本，把「长事务拖住 gc」变成可断言读数（水位由调用方保证 ≥ 最老活跃快照）。</li>
 *   <li>**`createMvccStore` 事务管理器**：逻辑时钟（`now` + 内部单调计数器，Lamport 风格、注入即确定性）
 *       分配 `beginTs`/`commitTs`；`begin/commit/rollback/read/write/del/range` 齐全。`read` 的读视图按隔离
 *       级别取：RU 读未提交 / RC 每语句最新已提交 / RR·SI·Serializable 首读锁定快照；`commit` 在
 *       SI/Serializable 下做**写冲突检测**（first-committer-wins 中止后提交者），Serializable 再做
 *       **读写反依赖（SSI 简化）**挡写偏斜。写时即追加未提交版本、提交落定 `commitTs`、回滚丢弃，
 *       模型统一、可见性可测。</li>
 *   <li>**`createLockManager` + `detectDeadlock`**：S/X 行锁**兼容矩阵** + **两阶段锁**（growing→shrinking，
 *       释放后再申请判 2PL 违规）；`acquire/release` 记等待边，`waitForGraph()` 建有向图，
 *       `detectDeadlock()` 用 **DFS 三色标记找环**（真图算法，能报有环也能报无环、可证伪），
 *       `abortDeadlock()` 按注入策略（youngest / min-locks）选牺牲者、放锁、重解阻塞、复检环已破。</li>
 *   <li>**`compareIsolationLevels` 核心证据**：同一组**确定性并发调度**（脏读 / 不可重复读 / 幻读 /
 *       丢失更新 / 写偏斜经典双账户）分别喂五档隔离，数每档 `observed` 哪几类、`prevented` 哪几类、
 *       `aborted` 几次，钉死「RU 四类全出 / RC 挡脏读但出不可重复读+丢失更新 / RR 挡前三类但出丢失
 *       更新+写偏斜 / SI 挡前四类却**漏写偏斜** / Serializable 全挡但**中止率最高**」这组最反直觉的
 *       真实取舍。判词**不封 Serializable 全面赢家**（同 KI-497 SoA 跳跃退化、KI-503 固定超时更吵、
 *       KI-504 三笔账的诚实立场）——满分隔离要付中止重试的代价。</li>
 * </ol>
 *
 * <p>设计取舍：时钟、比较器、隔离级别、调度轨迹、牺牲者策略全由 opts 注入；本件只跑状态机与结构计数，
 * 不写业务阈值。与真 PostgreSQL/MySQL 无运行时依赖——无真磁盘页/缓冲池/WAL redo·undo/真谓词锁或
 * 完整 SSI；五档矩阵、中止率、环检测都是**确定性调度上的结构计数**，不是墙钟或 QPS 跑分。</p>
 *
 * 用法：
 *   const chain = createVersionChain()
 *   chain.append({ value:100, beginTs:0, commitTs:0, writerTxn:'seed' })
 *   chain.visibleAt(5, 'T1')            // → { found:true, value:100, ... }
 *   const store = createMvccStore({ now:()=>0 })
 *   const t1 = store.begin('snapshot-isolation')
 *   const r = store.read(t1, 'A')        // → { found:true, value, readTs, ... }
 *   store.write(t1, 'A', r.value + 1)
 *   store.commit(t1)
 *   const mgr = createLockManager({ victim:'youngest' })
 *   mgr.acquire('T1','A','X'); mgr.acquire('T2','B','X')
 *   mgr.acquire('T1','B','X'); mgr.acquire('T2','A','X')
 *   mgr.abortDeadlock()                  // → { resolved:true, victim:'T2', cycle:[...], ... }
 *   const cmp = compareIsolationLevels()
 *   const study = mvccStudy()            // 纯数据汇总
 *
 * CLI：node scripts/caesura-mvcc-txn.mjs  （= npm run txn:bench）
 */

/** 缺省教学参数（阈值/轨迹仍由调用方注入，这里只是缺省值）。 */
export const MV_DEFAULTS = Object.freeze({
  initialA: 100,
  initialB: 100,
  dirtyWrite: 200,
  updateA1: 101,
  updateA2: 102,
  zero: 0,
  rangeLo: 'A',
  rangeHi: 'Z',
  victimPolicy: 'youngest',
  gcVersions: 10,
  gcLongWaterMark: 2,
  gcCleanWaterMark: 9,
})

/** 五档隔离级别（顺序由弱到强，短名作快照/矩阵 key）。 */
export const ISOLATION_LEVELS = Object.freeze([
  Object.freeze({ id: 'read-uncommitted', short: 'RU', label: '读未提交' }),
  Object.freeze({ id: 'read-committed', short: 'RC', label: '读已提交' }),
  Object.freeze({ id: 'repeatable-read', short: 'RR', label: '可重复读' }),
  Object.freeze({ id: 'snapshot-isolation', short: 'SI', label: '快照隔离' }),
  Object.freeze({ id: 'serializable', short: 'SER', label: '可串行化' }),
])
const LEVEL_SHORTS = Object.freeze(ISOLATION_LEVELS.map((l) => l.short))
const LEVEL_IDS = Object.freeze(ISOLATION_LEVELS.map((l) => l.id))

/** 五类经典并发异常（矩阵行）。 */
export const ANOMALIES = Object.freeze([
  Object.freeze({ id: 'dirtyRead', label: '脏读' }),
  Object.freeze({ id: 'nonRepeatableRead', label: '不可重复读' }),
  Object.freeze({ id: 'phantom', label: '幻读' }),
  Object.freeze({ id: 'lostUpdate', label: '丢失更新' }),
  Object.freeze({ id: 'writeSkew', label: '写偏斜' }),
])
const ANOMALY_IDS = Object.freeze(ANOMALIES.map((a) => a.id))

const uniq = (xs) => Array.from(new Set(xs))
const inter = (a, b) => a.filter((x) => b.includes(x))
const cmpDefault = (a, b) => {
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/* ============================================================
 * ① 多版本链
 * ============================================================ */

/**
 * 单 key 的多版本链。`versions` 按追加顺序（近似 commitTs 升序，未提交版 commitTs=null 在尾）。
 *
 * MVCC 可见性判据 `visibleAt(readTs, readerTxn, includeUncommitted)`：
 *   - 已提交且 `commitTs <= readTs`（对 readTs 快照可见）；
 *   - 或 `writerTxn === readerTxn && commitTs === null`（自己未提交版本对己可见，读己之写）；
 *   - 或 `includeUncommitted`（RU 脏读：连别人的未提交版也认）。
 * 满足者取 commitTs 最大者（未提交视为 +∞ 最新；并列取最后追加）；`tombstone` 版命中表「该快照看不到此行」。
 */
export function createVersionChain(opts = {}) {
  const compare = typeof opts.compare === 'function' ? opts.compare : cmpDefault
  /** @type {Array<{value:any,beginTs:number,commitTs:number|null,writerTxn:string,tombstone:boolean}>} */
  let versions = []
  let appended = 0
  let compacted = 0

  function append(v) {
    const version = {
      value: v.value,
      beginTs: Number.isFinite(v.beginTs) ? v.beginTs : 0,
      commitTs: v.commitTs === null || v.commitTs === undefined ? null : Number(v.commitTs),
      writerTxn: String(v.writerTxn ?? 'seed'),
      tombstone: v.tombstone === true,
    }
    versions.push(version)
    appended++
    return version
  }

  function rank(v) {
    // 未提交版视为最新（+∞）；已提交按 commitTs；并列用追加序打破（数组下标即序）。
    return v.commitTs === null ? Number.POSITIVE_INFINITY : v.commitTs
  }

  function visibleAt(readTs, readerTxn, includeUncommitted = false) {
    const rt = Number.isFinite(readTs) ? readTs : 0
    const mine = readerTxn === null || readerTxn === undefined ? null : String(readerTxn)
    let best = -1
    let bestRank = -Infinity
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i]
      const committed = v.commitTs !== null && v.commitTs <= rt
      const ownUncommitted = v.commitTs === null && mine !== null && v.writerTxn === mine
      const foreignUncommitted = v.commitTs === null && includeUncommitted
      if (!(committed || ownUncommitted || foreignUncommitted)) continue
      const r = rank(v)
      if (r >= bestRank) { bestRank = r; best = i } // 并列取更晚追加者
    }
    if (best < 0) return { found: false, deleted: false, value: undefined, version: null, commitTs: null, uncommittedFrom: null, readTs: rt }
    const v = versions[best]
    const uncommittedFrom = v.commitTs === null && v.writerTxn !== mine ? v.writerTxn : null
    return {
      found: !v.tombstone,
      deleted: v.tombstone,
      value: v.tombstone ? undefined : v.value,
      version: best,
      commitTs: v.commitTs,
      writerTxn: v.writerTxn,
      uncommittedFrom,
      readTs: rt,
    }
  }

  function setCommitTs(writerTxn, ts) {
    let n = 0
    for (const v of versions) {
      if (v.commitTs === null && v.writerTxn === String(writerTxn)) { v.commitTs = Number(ts); n++ }
    }
    return n
  }

  function discardUncommitted(writerTxn) {
    const before = versions.length
    versions = versions.filter((v) => !(v.commitTs === null && v.writerTxn === String(writerTxn)))
    return before - versions.length
  }

  function lastCommittedTs() {
    let m = -Infinity
    for (const v of versions) if (v.commitTs !== null && v.commitTs > m) m = v.commitTs
    return Number.isFinite(m) ? m : null
  }

  function hasCommittedAfter(ts) {
    const t = Number(ts) || 0
    return versions.some((v) => v.commitTs !== null && v.commitTs > t)
  }

  function latestCommitted() {
    let best = null
    let bestTs = -Infinity
    for (const v of versions) {
      if (v.commitTs !== null && v.commitTs >= bestTs) { bestTs = v.commitTs; best = v }
    }
    return best
  }

  /**
   * 按水位回收旧版本：commitTs < waterMarkTs 的已提交版**只保留其中最新一版**（作为水位前基线），
   * 其余删除；未提交版（在途事务）永不回收。返回 removed/kept。
   * 正确性前提：水位 ≥ 最老活跃快照（调用方保证），否则更老的快照读会退化——教学边界，写明不粉饰。
   */
  function compact(waterMarkTs) {
    const wm = Number.isFinite(waterMarkTs) ? waterMarkTs : 0
    const pending = versions.filter((v) => v.commitTs === null)
    const committed = versions.filter((v) => v.commitTs !== null)
    const old = committed.filter((v) => v.commitTs < wm)
    const fresh = committed.filter((v) => v.commitTs >= wm)
    let keepOld = []
    if (old.length) {
      let maxTs = -Infinity
      for (const v of old) if (v.commitTs > maxTs) maxTs = v.commitTs
      keepOld = old.filter((v) => v.commitTs === maxTs) // 水位前保留最新一版
    }
    const removed = old.length - keepOld.length
    versions = [...pending, ...keepOld, ...fresh]
    compacted += removed
    return { removed, kept: versions.length, waterMarkTs: wm, liveVersions: versions.length }
  }

  function snapshot() {
    return {
      versions: versions.map((v) => ({ ...v })),
      size: versions.length,
      appended,
      compacted,
      lastCommittedTs: lastCommittedTs(),
    }
  }

  function stats() {
    return { size: versions.length, appended, compacted, lastCommittedTs: lastCommittedTs(), pending: versions.filter((v) => v.commitTs === null).length }
  }

  return { append, visibleAt, setCommitTs, discardUncommitted, lastCommittedTs, hasCommittedAfter, latestCommitted, compact, snapshot, stats, reset: () => { versions = []; appended = 0; compacted = 0 }, get size() { return versions.length }, compare }
}

/* ============================================================
 * ② MVCC 事务存储
 * ============================================================ */

/**
 * 逻辑时钟：注入 now 取基线，其后内部单调 tick 保证 beginTs/commitTs 严格递增（Lamport 风格）。
 * now 固定 ⇒ 完全确定性；不注入才回落 Date.now。
 */
function makeClock(now) {
  const base = typeof now === 'function' ? Math.max(0, Math.floor(Number(now()) || 0)) : Math.max(0, Math.floor(Date.now()))
  let t = base
  return { tick: () => ++t, current: () => t }
}

/**
 * MVCC 事务存储。`begin(isolation)` 开事务；`read/write/del/range` 按隔离级别取读视图；
 * `commit` 在 SI/Serializable 下做写冲突中止、Serializable 再加 SSI 读写反依赖检测；`rollback` 丢弃未提交版。
 */
export function createMvccStore(opts = {}) {
  const compare = typeof opts.compare === 'function' ? opts.compare : cmpDefault
  const clock = makeClock(opts.now)
  const defaultIsolation = LEVEL_IDS.includes(opts.isolation) ? opts.isolation : 'read-committed'
  /** @type {Map<string, ReturnType<typeof createVersionChain>>} */
  const chains = new Map()
  /** @type {Map<string, any>} */
  const txns = new Map()
  const commitLog = []
  let nextTxn = 0
  const counters = { begins: 0, reads: 0, writes: 0, deletes: 0, ranges: 0, committed: 0, aborted: 0, rollbacks: 0, writeConflicts: 0, writeSkews: 0 }
  const seedTxn = 'seed'
  let seedSeq = 0

  function chainOf(key) {
    const k = String(key)
    if (!chains.has(k)) chains.set(k, createVersionChain({ compare }))
    return chains.get(k)
  }

  /** 播种一条已提交基线（教学用初始数据；不进 begins/committed 账）。 */
  function seed(key, value, ts = 0) {
    const ch = chainOf(key)
    const vTs = ts === 0 ? 0 : Number(ts)
    ch.append({ value, beginTs: 0, commitTs: vTs, writerTxn: seedTxn, tombstone: false })
    return { key: String(key), value, commitTs: vTs }
  }

  function begin(isolation) {
    const id = 'T' + (++nextTxn)
    const iso = LEVEL_IDS.includes(isolation) ? isolation : defaultIsolation
    const txn = {
      id, isolation: iso, beginTs: clock.tick(), firstReadTs: null,
      status: 'active', commitTs: null,
      readSet: new Set(), writeSet: new Set(),
    }
    txns.set(id, txn)
    counters.begins++
    return txnHandle(id)
  }

  function txnHandle(id) {
    return {
      id,
      get isolation() { return txns.get(id)?.isolation },
      get beginTs() { return txns.get(id)?.beginTs },
      get status() { return txns.get(id)?.status },
    }
  }

  function resolveReadTs(txn) {
    if (txn.isolation === 'repeatable-read' || txn.isolation === 'snapshot-isolation' || txn.isolation === 'serializable') {
      if (txn.firstReadTs === null) txn.firstReadTs = clock.current()
      return txn.firstReadTs
    }
    // RU / RC 每语句取当前时钟（最新）；RU 另在 visibleAt 开 includeUncommitted。
    return clock.current()
  }

  function live(id) {
    const txn = typeof id === 'string' ? txns.get(id) : null
    if (!txn) return { error: 'no-such-txn' }
    if (txn.status !== 'active') return { error: 'inactive-txn', status: txn.status }
    return { txn }
  }

  function read(txnOrId, key) {
    const l = live(typeof txnOrId === 'string' ? txnOrId : txnOrId?.id)
    if (l.error) return { found: false, error: l.error, value: undefined }
    const { txn } = l
    const readTs = resolveReadTs(txn)
    const from = txnHandle(txn.id)
    const includeUncommitted = txn.isolation === 'read-uncommitted'
    const res = chainOf(key).visibleAt(readTs, txn.id, includeUncommitted)
    txn.readSet.add(String(key))
    counters.reads++
    return { ...res, txn: from, key: String(key) }
  }

  function write(txnOrId, key, value) {
    const l = live(typeof txnOrId === 'string' ? txnOrId : txnOrId?.id)
    if (l.error) return { written: false, error: l.error }
    const { txn } = l
    chainOf(key).append({ value, beginTs: txn.beginTs, commitTs: null, writerTxn: txn.id, tombstone: false })
    txn.writeSet.add(String(key))
    counters.writes++
    return { written: true, key: String(key), value, writerTxn: txn.id }
  }

  /** 逻辑删除：追加 tombstone 多版本（旧版本不物理删，gc 水位后再回收）。 */
  function del(txnOrId, key) {
    const l = live(typeof txnOrId === 'string' ? txnOrId : txnOrId?.id)
    if (l.error) return { deleted: false, error: l.error }
    const { txn } = l
    chainOf(key).append({ value: undefined, beginTs: txn.beginTs, commitTs: null, writerTxn: txn.id, tombstone: true })
    txn.writeSet.add(String(key))
    counters.deletes++
    return { deleted: true, key: String(key), writerTxn: txn.id }
  }

  /** 教学版范围查：按 compare 排序键空间，对每 key 用同一 readTs 取可见版本（快照一致）。 */
  function range(txnOrId, lo, hi) {
    const l = live(typeof txnOrId === 'string' ? txnOrId : txnOrId?.id)
    if (l.error) return { results: [], error: l.error }
    const { txn } = l
    const readTs = resolveReadTs(txn)
    const includeUncommitted = txn.isolation === 'read-uncommitted'
    const keys = Array.from(chains.keys()).sort(compare)
    const results = []
    for (const k of keys) {
      if (compare(k, lo) < 0 || compare(k, hi) > 0) continue
      const res = chainOf(k).visibleAt(readTs, txn.id, includeUncommitted)
      if (res.found) {
        results.push({ key: k, value: res.value, commitTs: res.commitTs, uncommittedFrom: res.uncommittedFrom })
        txn.readSet.add(k)
      } else {
        // 幻读判据要「范围内被考察过的 key」也进 readSet（含被别的快照新建、本快照不可见的）。
        txn.readSet.add(k)
      }
    }
    counters.ranges++
    return { results, readTs, count: results.length }
  }

  function discardWrites(txn) {
    let n = 0
    for (const key of txn.writeSet) n += chainOf(key).discardUncommitted(txn.id)
    return n
  }

  function abort(txn, reason) {
    discardWrites(txn)
    txn.status = 'aborted'
    txn.commitTs = null
    counters.aborted++
    return { committed: false, aborted: true, reason, txn: txn.id }
  }

  function commit(txnOrId, ts) {
    const l = live(typeof txnOrId === 'string' ? txnOrId : txnOrId?.id)
    if (l.error) return { committed: false, error: l.error }
    const { txn } = l
    const detectsWrite = txn.isolation === 'snapshot-isolation' || txn.isolation === 'serializable'
    if (detectsWrite) {
      // first-committer-wins：任一写集 key 在 [beginTs, now] 被别人先提交 ⇒ 后提交者中止。
      let conflictKey = null
      for (const key of txn.writeSet) {
        if (chainOf(key).hasCommittedAfter(txn.beginTs)) { conflictKey = key; break }
      }
      if (conflictKey !== null) {
        counters.writeConflicts++
        return abort(txn, 'write-conflict')
      }
      // Serializable 再加 SSI 简化：与任一并发已提交事务构成双向读写反依赖 ⇒ 写偏斜环 ⇒ 中止本事务。
      if (txn.isolation === 'serializable') {
        for (const prev of commitLog) {
          if (prev.committedAt <= txn.beginTs) continue
          const prevReadsMineWrite = inter(prev.readSet, Array.from(txn.writeSet)).length > 0
          const myReadsPrevWrite = inter(Array.from(txn.readSet), prev.writeSet).length > 0
          if (prevReadsMineWrite && myReadsPrevWrite) {
            counters.writeSkews++
            return abort(txn, 'write-skew')
          }
        }
      }
    }
    const commitTs = ts === undefined ? clock.tick() : Number(ts)
    for (const key of txn.writeSet) chainOf(key).setCommitTs(txn.id, commitTs)
    txn.status = 'committed'
    txn.commitTs = commitTs
    counters.committed++
    commitLog.push({ txnId: txn.id, committedAt: commitTs, readSet: Array.from(txn.readSet), writeSet: Array.from(txn.writeSet) })
    return { committed: true, txn: txn.id, commitTs, writes: txn.writeSet.size }
  }

  function rollback(txnOrId) {
    const l = live(typeof txnOrId === 'string' ? txnOrId : txnOrId?.id)
    if (l.error) return { rolledBack: false, error: l.error }
    const { txn } = l
    const n = discardWrites(txn)
    txn.status = 'aborted'
    txn.commitTs = null
    counters.rollbacks++
    return { rolledBack: true, txn: txn.id, discarded: n }
  }

  /** 按水位回收所有 key 的旧版本（长事务拖 gc 的证据入口）。 */
  function gc(waterMarkTs) {
    let removed = 0
    let kept = 0
    for (const ch of chains.values()) {
      const r = ch.compact(waterMarkTs)
      removed += r.removed
      kept += r.kept
    }
    return { removed, kept, waterMarkTs: Number.isFinite(waterMarkTs) ? waterMarkTs : 0 }
  }

  function finalState() {
    const out = {}
    for (const [key, ch] of chains) {
      const v = ch.latestCommitted()
      if (v) out[key] = { value: v.value, commitTs: v.commitTs, tombstone: v.tombstone }
    }
    return out
  }

  function transactionStates() {
    const out = {}
    for (const [id, txn] of txns) {
      out[id] = {
        id, isolation: txn.isolation, beginTs: txn.beginTs, firstReadTs: txn.firstReadTs,
        status: txn.status, commitTs: txn.commitTs,
        readSet: Array.from(txn.readSet), writeSet: Array.from(txn.writeSet),
      }
    }
    return out
  }

  function stats() {
    return { ...counters, keys: chains.size, versions: Array.from(chains.values()).reduce((s, c) => s + c.size, 0), commitLogSize: commitLog.length, now: clock.current() }
  }

  function snapshot(t) {
    return {
      generator: 'caesura-mvcc-txn/store',
      stats: stats(),
      final: finalState(),
      transactions: transactionStates(),
      commitLog: commitLog.map((c) => ({ ...c })),
      builtAt: t === undefined ? clock.current() : t,
    }
  }

  return {
    begin, seed, read, write, del, range, commit, rollback, gc,
    finalState, transactionStates, stats, snapshot,
    chainOf, reset: () => { chains.clear(); txns.clear(); commitLog.length = 0; nextTxn = 0; seedSeq = 0; for (const k of Object.keys(counters)) counters[k] = 0 },
    get now() { return clock.current() },
  }
}

/* ============================================================
 * ③ 行锁 2PL + wait-for graph DFS 死锁检测
 * ============================================================ */

/**
 * 等待图环检测：三色 DFS，返回**真**环（cycle 为环上节点、closedCycle 首尾闭合）。
 * 无环 ⇒ hasCycle:false、cycle:[]（可证伪，非恒真）。`nodesVisited` 证真扫过图。
 */
export function detectDeadlock(graph) {
  const g = graph && typeof graph === 'object' ? graph : {}
  const nodes = Object.keys(g)
  const color = Object.create(null) // undefined=未访, 1=在栈, 2=完成
  const stack = []
  let cycle = null
  let visited = 0

  function dfs(u) {
    color[u] = 1
    stack.push(u)
    visited++
    for (const v of Array.isArray(g[u]) ? g[u] : []) {
      if (!(v in g)) continue
      if (!color[v]) {
        if (dfs(v)) return true
      } else if (color[v] === 1) {
        const i = stack.indexOf(v)
        cycle = stack.slice(i >= 0 ? i : 0)
        return true
      }
    }
    stack.pop()
    color[u] = 2
    return false
  }

  for (const n of nodes) {
    if (!color[n] && dfs(n)) break
  }
  const hasCycle = Array.isArray(cycle) && cycle.length > 0
  return {
    hasCycle,
    cycle: hasCycle ? cycle.slice() : [],
    closedCycle: hasCycle ? [...cycle, cycle[0]] : [],
    nodesVisited: visited,
    edgeCount: nodes.reduce((s, n) => s + (Array.isArray(g[n]) ? g[n].length : 0), 0),
  }
}

/** S/X 兼容：只有 S-S 兼容，其余全冲突。 */
function lockCompatible(held, req) {
  return held === 'S' && req === 'S'
}

/**
 * 行锁管理器：S/X 兼容矩阵 + 两阶段锁（growing→shrinking）。
 * `acquire` 在 shrinking 后判 2PL 违规；冲突记等待边；`waitForGraph` 由「被阻塞请求 ↔ 当前冲突持锁者」现算，
 * 故 release 后图自动更新；`abortDeadlock` 检测→选牺牲者→放全部锁→重解阻塞→复检环已破。
 */
export function createLockManager(opts = {}) {
  const policy = opts.victim === 'min-locks' ? 'min-locks' : MV_DEFAULTS.victimPolicy
  /** key → Map<txnId, mode> */
  const locks = new Map()
  /** txnId → 'growing' | 'shrinking' */
  const phase = new Map()
  /** txnId → start order */
  const started = new Map()
  /** txnId → Map<key, mode> 被阻塞的请求 */
  const blocked = new Map()
  let order = 0
  const counters = { grants: 0, blocks: 0, releases: 0, conflicts: 0, deadlocks: 0, aborts: 0, plViolations: 0 }

  function begin(txnId) {
    const id = String(txnId)
    if (!phase.has(id)) { phase.set(id, 'growing'); started.set(id, ++order) }
    return { txn: id, phase: phase.get(id) }
  }

  function holdersOf(key) {
    if (!locks.has(key)) locks.set(key, new Map())
    return locks.get(key)
  }

  function conflictHolders(key, txnId, mode) {
    const h = locks.get(key)
    if (!h) return []
    return Array.from(h.entries()).filter(([id, m]) => id !== String(txnId) && !lockCompatible(m, mode)).map(([id]) => id)
  }

  function acquire(txnId, key, mode = 'X') {
    const id = String(txnId)
    const m = mode === 'S' ? 'S' : 'X'
    begin(id)
    if (phase.get(id) === 'shrinking') {
      counters.plViolations++
      return { granted: false, reason: '2pl-violation', txn: id, key: String(key), mode: m, phase: 'shrinking' }
    }
    const conflicts = conflictHolders(key, id, m)
    if (conflicts.length) {
      counters.blocks++
      counters.conflicts++
      if (!blocked.has(id)) blocked.set(id, new Map())
      blocked.get(id).set(String(key), m)
      return { granted: false, reason: 'conflict', txn: id, key: String(key), mode: m, waitFor: conflicts }
    }
    holdersOf(key).set(id, m)
    counters.grants++
    return { granted: true, txn: id, key: String(key), mode: m, phase: 'growing' }
  }

  function release(txnId, key) {
    const id = String(txnId)
    const k = String(key)
    const h = locks.get(k)
    let released = false
    if (h && h.has(id)) { h.delete(id); released = true; counters.releases++; if (!h.size) locks.delete(k) }
    const bw = blocked.get(id)
    if (bw) { bw.delete(k); if (!bw.size) blocked.delete(id) }
    if (phase.get(id) === 'growing') phase.set(id, 'shrinking') // 第一次释放即进 shrinking
    return { released, txn: id, key: k, phase: phase.get(id) || 'growing' }
  }

  function releaseAll(txnId) {
    const id = String(txnId)
    let n = 0
    for (const [k, h] of locks) {
      if (h.has(id)) { h.delete(id); n++; counters.releases++; if (!h.size) locks.delete(k) }
    }
    blocked.delete(id)
    phase.delete(id)
    started.delete(id)
    return { released: n, txn: id }
  }

  /** 被阻塞请求在冲突消失后自动补授（牺牲者放锁后重新解开等待队列）。 */
  function resolveBlocked() {
    let granted = 0
    for (const [id, keys] of blocked) {
      for (const [key, mode] of Array.from(keys)) {
        if (conflictHolders(key, id, mode).length === 0) {
          holdersOf(key).set(id, mode)
          keys.delete(key)
          counters.grants++
          granted++
        }
      }
      if (!keys.size) blocked.delete(id)
    }
    return granted
  }

  function waitForGraph() {
    const ids = uniq([...phase.keys(), ...blocked.keys()])
    const g = Object.fromEntries(ids.map((id) => [id, []]))
    for (const [id, keys] of blocked) {
      for (const key of keys.keys()) {
        const m = keys.get(key)
        for (const hid of conflictHolders(key, id, m)) {
          if (!g[id]) g[id] = []
          if (!g[id].includes(hid)) g[id].push(hid)
        }
      }
    }
    return g
  }

  function detectDeadlockNow() { return detectDeadlock(waitForGraph()) }

  function pickVictim(cycle, p = policy) {
    if (!Array.isArray(cycle) || !cycle.length) return null
    const lockCount = (id) => Array.from(locks.values()).filter((h) => h.has(id)).length
    let best = cycle[0]
    for (const id of cycle.slice(1)) {
      if (p === 'min-locks') {
        const a = lockCount(best)
        const b = lockCount(id)
        if (b < a || (b === a && (started.get(id) || 0) > (started.get(best) || 0))) best = id
      } else if ((started.get(id) || 0) > (started.get(best) || 0)) best = id // youngest
    }
    return best
  }

  function abortDeadlock(p = policy) {
    const d = detectDeadlockNow()
    if (!d.hasCycle) return { resolved: false, reason: 'no-cycle', ...d }
    const victim = pickVictim(d.cycle, p)
    releaseAll(victim)
    const regranted = resolveBlocked()
    counters.deadlocks++
    counters.aborts++
    const after = detectDeadlockNow()
    return { resolved: !after.hasCycle, victim, cycle: d.cycle, closedCycle: d.closedCycle, regranted, after, policy: p }
  }

  function state() {
    const held = {}
    for (const [k, h] of locks) held[k] = Array.from(h.entries()).map(([id, mode]) => ({ txn: id, mode }))
    const waiting = {}
    for (const [id, keys] of blocked) waiting[id] = Array.from(keys.entries()).map(([key, mode]) => ({ key, mode }))
    return { held, waiting, phases: Object.fromEntries(phase), graph: waitForGraph() }
  }

  function stats() { return { ...counters, heldKeys: locks.size, blockedTxns: blocked.size, activeTxns: phase.size, policy } }

  return {
    begin, acquire, release, releaseAll, waitForGraph, detectDeadlock: detectDeadlockNow,
    pickVictim, abortDeadlock, resolveBlocked, state, stats,
    reset: () => { locks.clear(); phase.clear(); started.clear(); blocked.clear(); order = 0; for (const k of Object.keys(counters)) counters[k] = 0 },
  }
}

/* ============================================================
 * ④ 五档隔离级别 × 五类异常确定性调度对照
 * ============================================================ */

/** 内置五类异常的确定性调度（每类一条，可注入 opts.schedules 覆盖）。 */
function buildDefaultSchedules(opts = {}) {
  const d = MV_DEFAULTS
  const A = opts.initialA ?? d.initialA
  const B = opts.initialB ?? d.initialB
  const dirty = opts.dirtyWrite ?? d.dirtyWrite
  const u1 = opts.updateA1 ?? d.updateA1
  const u2 = opts.updateA2 ?? d.updateA2
  const zero = opts.zero ?? d.zero
  const lo = opts.rangeLo ?? d.rangeLo
  const hi = opts.rangeHi ?? d.rangeHi
  return {
    dirtyRead: {
      anomaly: 'dirtyRead', label: '脏读',
      seed: [{ key: 'A', value: A }],
      steps: [
        { t: 'begin', txn: 'T1' },
        { t: 'begin', txn: 'T2' },
        { t: 'write', txn: 'T2', key: 'A', value: dirty },
        { t: 'read', txn: 'T1', key: 'A' },   // RU 读到 T2 未提交的 200 ⇒ 脏读
        { t: 'rollback', txn: 'T2' },
      ],
    },
    nonRepeatableRead: {
      anomaly: 'nonRepeatableRead', label: '不可重复读',
      seed: [{ key: 'A', value: A }],
      steps: [
        { t: 'begin', txn: 'T1' },
        { t: 'read', txn: 'T1', key: 'A' },   // 第一次（RR/SI/SER 在此锁快照）
        { t: 'begin', txn: 'T2' },
        { t: 'write', txn: 'T2', key: 'A', value: dirty },
        { t: 'commit', txn: 'T2' },
        { t: 'read', txn: 'T1', key: 'A' },   // 第二次：RU/RC 变了、RR/SI/SER 不变
      ],
    },
    phantom: {
      anomaly: 'phantom', label: '幻读',
      seed: [{ key: 'A', value: A }],
      steps: [
        { t: 'begin', txn: 'T1' },
        { t: 'range', txn: 'T1', lo, hi },    // 第一次只有 A
        { t: 'begin', txn: 'T2' },
        { t: 'write', txn: 'T2', key: 'B', value: B },
        { t: 'commit', txn: 'T2' },
        { t: 'range', txn: 'T1', lo, hi },    // 第二次：RU/RC 多出 B（幻影）
      ],
    },
    lostUpdate: {
      anomaly: 'lostUpdate', label: '丢失更新',
      seed: [{ key: 'A', value: A }],
      steps: [
        { t: 'begin', txn: 'T1' },
        { t: 'begin', txn: 'T2' },
        { t: 'read', txn: 'T1', key: 'A' },
        { t: 'read', txn: 'T2', key: 'A' },
        { t: 'write', txn: 'T1', key: 'A', value: u1 },
        { t: 'write', txn: 'T2', key: 'A', value: u2 },
        { t: 'commit', txn: 'T1' },
        { t: 'commit', txn: 'T2' },           // SI/SER 后提交者中止 ⇒ 挡住；RU/RC/RR 都成功 ⇒ 丢失
      ],
    },
    writeSkew: {
      anomaly: 'writeSkew', label: '写偏斜',
      seed: [{ key: 'A', value: A }, { key: 'B', value: B }],
      steps: [
        { t: 'begin', txn: 'T1' },
        { t: 'begin', txn: 'T2' },
        { t: 'read', txn: 'T1', key: 'A' },
        { t: 'read', txn: 'T1', key: 'B' },
        { t: 'read', txn: 'T2', key: 'A' },
        { t: 'read', txn: 'T2', key: 'B' },
        { t: 'write', txn: 'T1', key: 'A', value: zero },
        { t: 'write', txn: 'T2', key: 'B', value: zero },
        { t: 'commit', txn: 'T1' },
        { t: 'commit', txn: 'T2' },           // 只有 SER 的 SSI 双向反依赖检测挡住；SI 漏
      ],
    },
  }
}

/**
 * 在给定 store 上跑一条调度。opts.level 覆盖所有 begin 的隔离级别（对照的同轨变量）；
 * 逐步记录 read/range 读数，供异常判定器据实判 observed（非预设结论）。
 */
export function runSchedule(opts = {}) {
  const store = opts.store || createMvccStore({ now: opts.now })
  const level = LEVEL_IDS.includes(opts.level) ? opts.level : 'read-committed'
  const schedule = opts.schedule || {}
  const seed = Array.isArray(opts.seed) ? opts.seed : (Array.isArray(schedule.seed) ? schedule.seed : [])
  const steps = Array.isArray(opts.steps) ? opts.steps : (Array.isArray(schedule.steps) ? schedule.steps : [])
  for (const s of seed) store.seed(s.key, s.value, s.commitTs ?? 0)
  const handles = new Map()
  const trace = { level, anomaly: schedule.anomaly || opts.anomaly || null, steps: [], aborted: 0, committed: 0 }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const out = { i, t: s.t, txn: s.txn ?? null, key: s.key ?? null }
    switch (s.t) {
      case 'begin': {
        const h = store.begin(level)
        handles.set(s.txn, h)
        out.beginTs = h.beginTs
        break
      }
      case 'read': {
        const r = store.read(handles.get(s.txn) || s.txn, s.key)
        out.found = r.found
        out.value = r.value
        out.readTs = r.readTs
        out.uncommittedFrom = r.uncommittedFrom ?? null
        out.error = r.error ?? null
        break
      }
      case 'range': {
        const r = store.range(handles.get(s.txn) || s.txn, s.lo, s.hi)
        out.lo = s.lo
        out.hi = s.hi
        out.readTs = r.readTs
        out.results = (r.results || []).map((x) => ({ key: x.key, value: x.value, uncommittedFrom: x.uncommittedFrom ?? null }))
        out.count = r.count ?? out.results.length
        out.error = r.error ?? null
        break
      }
      case 'write': out.write = store.write(handles.get(s.txn) || s.txn, s.key, s.value); break
      case 'del': out.delete = store.del(handles.get(s.txn) || s.txn, s.key); break
      case 'commit': out.commit = store.commit(handles.get(s.txn) || s.txn); break
      case 'rollback': out.rollback = store.rollback(handles.get(s.txn) || s.txn); break
      default: out.error = 'unknown-step'
    }
    trace.steps.push(out)
  }
  trace.transactions = store.transactionStates()
  trace.final = store.finalState()
  trace.aborted = Object.values(trace.transactions).filter((t) => t.status === 'aborted').length
  trace.committed = Object.values(trace.transactions).filter((t) => t.status === 'committed').length
  trace.stats = store.stats()
  return trace
}

/* --- 异常判定器：全部基于 trace 真读数，非预设结论 --- */
function observedDirtyRead(trace) {
  return trace.steps.some((s) => s.t === 'read' && s.uncommittedFrom !== null && s.uncommittedFrom !== undefined)
}
function observedNonRepeatableRead(trace) {
  const byKeyTxn = new Map()
  for (const s of trace.steps) {
    if (s.t !== 'read' || s.error) continue
    const k = s.txn + '|' + s.key
    if (!byKeyTxn.has(k)) byKeyTxn.set(k, [])
    byKeyTxn.get(k).push(s.value)
  }
  for (const vals of byKeyTxn.values()) if (vals.length >= 2 && new Set(vals.map((v) => JSON.stringify(v))).size > 1) return true
  return false
}
function observedPhantom(trace) {
  const byRangeTxn = new Map()
  for (const s of trace.steps) {
    if (s.t !== 'range' || s.error) continue
    const k = s.txn + '|' + s.lo + '..' + s.hi
    if (!byRangeTxn.has(k)) byRangeTxn.set(k, [])
    byRangeTxn.get(k).push(s.count)
  }
  for (const counts of byRangeTxn.values()) if (counts.length >= 2 && new Set(counts).size > 1) return true
  return false
}
function observedLostUpdate(trace) {
  // 两个都成功提交的事务写了同一个 key ⇒ 先提交那家的更新被覆盖、丢失。
  const writers = Object.values(trace.transactions).filter((t) => t.status === 'committed' && t.writeSet.length > 0)
  for (let i = 0; i < writers.length; i++) {
    for (let j = i + 1; j < writers.length; j++) {
      if (inter(writers[i].writeSet, writers[j].writeSet).length > 0) return true
    }
  }
  return false
}
function observedWriteSkew(trace) {
  // 两个都成功提交、写集不相交，却构成双向读写反依赖（各读了对方写的 key）⇒ 写偏斜。
  const committed = Object.values(trace.transactions).filter((t) => t.status === 'committed' && t.writeSet.length > 0)
  for (let i = 0; i < committed.length; i++) {
    for (let j = i + 1; j < committed.length; j++) {
      const a = committed[i]
      const b = committed[j]
      if (inter(a.writeSet, b.writeSet).length > 0) continue // 有共同写集 ⇒ 归 lostUpdate
      const aReadsBWrite = inter(a.readSet, b.writeSet).length > 0
      const bReadsAWrite = inter(b.readSet, a.writeSet).length > 0
      if (aReadsBWrite && bReadsAWrite) return true
    }
  }
  return false
}
const OBSERVERS = Object.freeze({
  dirtyRead: observedDirtyRead,
  nonRepeatableRead: observedNonRepeatableRead,
  phantom: observedPhantom,
  lostUpdate: observedLostUpdate,
  writeSkew: observedWriteSkew,
})

/**
 * 核心对照：五类异常 × 五档隔离。每格真跑一份干净 store（注入 now ⇒ 确定性），
 * 按对应 observer 据实判 observed，回矩阵 + per-level aborted/observed/prevented + verdict。
 */
export function compareIsolationLevels(opts = {}) {
  const schedules = opts.schedules || buildDefaultSchedules(opts)
  const levels = LEVEL_IDS
  const matrix = {}
  for (const level of levels) {
    const short = LEVEL_SHORTS[levels.indexOf(level)]
    matrix[short] = { level, short, aborted: 0, committed: 0, observedCount: 0, preventedCount: 0, anomalies: {}, trace: {} }
    for (const anomaly of ANOMALY_IDS) {
      const schedule = schedules[anomaly]
      if (!schedule) continue
      const trace = runSchedule({ level, schedule, store: createMvccStore({ now: opts.now }), now: opts.now })
      const observed = OBSERVERS[anomaly](trace)
      matrix[short].anomalies[anomaly] = { observed, prevented: !observed, label: ANOMALIES.find((a) => a.id === anomaly)?.label }
      matrix[short].aborted += trace.aborted
      matrix[short].committed += trace.committed
      if (observed) matrix[short].observedCount++
      else matrix[short].preventedCount++
      matrix[short].trace[anomaly] = {
        observed,
        steps: trace.steps.map((s) => ({
          i: s.i, t: s.t, txn: s.txn, key: s.key,
          value: s.value, found: s.found, uncommittedFrom: s.uncommittedFrom,
          readTs: s.readTs, count: s.count,
          committed: s.commit?.committed ?? undefined, reason: s.commit?.reason ?? undefined,
        })),
        final: trace.final,
      }
    }
  }
  const obs = (lvl, a) => matrix[lvl].anomalies[a]?.observed === true
  const verdict = {
    // 每格 observed/prevented 恰一真 ⇒ 矩阵自洽（脏数据会当场红，非恒真）
    matrixWellFormed: LEVEL_SHORTS.every((l) => ANOMALY_IDS.every((a) => Number(obs(l, a)) + Number(!obs(l, a)) === 1)),
    ruSeesAllFive: ['RU'].every((l) => ANOMALY_IDS.every((a) => obs(l, a))),
    rcStopsDirtyRead: !obs('RC', 'dirtyRead') && ['nonRepeatableRead', 'lostUpdate', 'writeSkew'].every((a) => obs('RC', a)),
    rrFreezesReadView: !obs('RR', 'dirtyRead') && !obs('RR', 'nonRepeatableRead') && !obs('RR', 'phantom'),
    siStopsLostUpdateButLeaksWriteSkew: !obs('SI', 'lostUpdate') && obs('SI', 'writeSkew'),
    serializableStopsWriteSkew: !obs('SER', 'writeSkew'),
    serializableCostsMostAborts: matrix.SER.aborted > matrix.SI.aborted && matrix.SI.aborted >= matrix.RR.aborted,
    // 诚实判据：SER 满分隔离要有中止代价、且 RU 确实全出——任一不成立即翻红，可证伪，非恒真。
    noUniversalWinner: !obs('SER', 'writeSkew') && matrix.SER.aborted > 0 && ANOMALY_IDS.every((a) => obs('RU', a)),
  }
  return {
    generator: 'caesura-mvcc-txn/isolation',
    levels: LEVEL_SHORTS,
    anomalies: ANOMALY_IDS,
    levelLabels: Object.fromEntries(ISOLATION_LEVELS.map((l) => [l.short, l.label])),
    matrix,
    verdict,
  }
}

/* ============================================================
 * ⑤ study / snapshot / CLI
 * ============================================================ */

/** 死锁脚本：T1 持 A、T2 持 B，各自再请求对方那把 ⇒ 环；abortDeadlock 选牺牲者打破。 */
function deadlockScript(opts = {}) {
  const mgr = createLockManager({ victim: opts.victim })
  const before = []
  before.push({ ...mgr.acquire('T1', 'A', 'X'), step: 'T1 请求 A' })
  before.push({ ...mgr.acquire('T2', 'B', 'X'), step: 'T2 请求 B' })
  before.push({ ...mgr.acquire('T1', 'B', 'X'), step: 'T1 请求 B（被 T2 持）' })
  before.push({ ...mgr.acquire('T2', 'A', 'X'), step: 'T2 请求 A（被 T1 持）' })
  const graph = mgr.waitForGraph()
  const detected = mgr.detectDeadlock()
  // 判据的判据：无环图必须报无环（DFS 非恒真）
  const acyclicProbe = detectDeadlock({ T1: ['T2'], T2: [] })
  const resolution = mgr.abortDeadlock()
  return {
    before: before.map((s) => ({ step: s.step, granted: s.granted, reason: s.reason ?? null, waitFor: s.waitFor ?? [] })),
    graph,
    detected,
    acyclicProbe: { hasCycle: acyclicProbe.hasCycle, cycle: acyclicProbe.cycle },
    resolution,
    stats: mgr.stats(),
  }
}

/** 2PL 阶段探测：growing 释放后进 shrinking，再 acquire 判违规。 */
function twoPhaseLockProbe() {
  const mgr = createLockManager()
  mgr.acquire('T1', 'A', 'X')
  mgr.release('T1', 'A')              // → shrinking
  const late = mgr.acquire('T1', 'B', 'X') // 2PL 违规
  return { lateAcquireBlocked: late.granted === false && late.reason === '2pl-violation', reason: late.reason, stats: mgr.stats() }
}

/** 版本链 gc 水位对照：同一条 10 版链，长事务低水位 vs 无长事务高水位的回收量。 */
function gcStudy(opts = {}) {
  const n = Math.max(2, Math.floor(Number(opts.gcVersions) || MV_DEFAULTS.gcVersions))
  const longWm = opts.gcLongWaterMark ?? MV_DEFAULTS.gcLongWaterMark
  const cleanWm = opts.gcCleanWaterMark ?? MV_DEFAULTS.gcCleanWaterMark
  const build = () => {
    const ch = createVersionChain()
    for (let i = 1; i <= n; i++) ch.append({ value: i, beginTs: i - 1, commitTs: i, writerTxn: 'seed', tombstone: false })
    return ch
  }
  const long = build().compact(longWm)   // 长事务拖住水位
  const clean = build().compact(cleanWm) // 无长事务、水位推进
  return {
    versions: n,
    longWaterMark: long,
    cleanWaterMark: clean,
    longTxnRetainsMoreVersions: long.kept > clean.kept && long.removed < clean.removed,
  }
}

/** 汇总成纯数据 study（确定性、无真时钟/socket/磁盘）。 */
export function mvccStudy(opts = {}) {
  const comparison = compareIsolationLevels(opts)
  const deadlock = deadlockScript(opts)
  const twoPhaseLock = twoPhaseLockProbe()
  const gc = gcStudy(opts)
  // 单独跑一条 store 证 commit/rollback/writeConflict 真记账（不复用矩阵里的 store）。
  const store = createMvccStore({ now: opts.now })
  store.seed('A', MV_DEFAULTS.initialA)
  const t = store.begin('snapshot-isolation')
  const r = store.read(t, 'A')
  store.write(t, 'A', (Number(r.value) || 0) + 1)
  const c = store.commit(t)
  const storeStats = store.stats()
  return {
    generator: 'caesura-mvcc-txn',
    comparison,
    deadlock,
    twoPhaseLock,
    gc,
    store: { readValue: r.value, committed: c.committed, stats: storeStats, final: store.finalState() },
    verdict: {
      ...comparison.verdict,
      deadlockDetectedAndBroken: deadlock.detected.hasCycle && deadlock.resolution.resolved === true,
      dfsNotTautological: deadlock.detected.hasCycle && deadlock.acyclicProbe.hasCycle === false,
      twoPhaseLockEnforced: twoPhaseLock.lateAcquireBlocked,
      longTransactionRetainsVersions: gc.longTxnRetainsMoreVersions,
    },
    builtAt: typeof opts.now === 'function' ? opts.now() : Date.now(),
  }
}

/** 把 study 收敛成前端 / status 友好的只读结构（node 侧判词，前端只渲染、不复核、不实测）。 */
export function mvSnapshot(study) {
  if (!study || typeof study !== 'object') return null
  const c = study.comparison
  const rows = c.levels.map((short) => {
    const m = c.matrix[short]
    return {
      short,
      label: c.levelLabels[short],
      anomalies: Object.fromEntries(c.anomalies.map((a) => [a, { observed: m.anomalies[a]?.observed === true, label: m.anomalies[a]?.label }])),
      observedCount: m.observedCount,
      preventedCount: m.preventedCount,
      aborted: m.aborted,
    }
  })
  return {
    config: { levels: c.levels, anomalies: c.anomalies },
    levels: rows,
    deadlock: {
      graph: study.deadlock.graph,
      detected: study.deadlock.detected.hasCycle,
      cycle: study.deadlock.cycle || study.deadlock.detected.cycle,
      resolved: study.deadlock.resolution.resolved,
      victim: study.deadlock.resolution.victim ?? null,
      acyclicProbeNoCycle: study.deadlock.acyclicProbe.hasCycle === false,
      stats: study.deadlock.stats,
    },
    twoPhaseLock: study.twoPhaseLock,
    gc: study.gc,
    store: study.store,
    verdict: study.verdict,
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // 注入固定时钟 ⇒ CLI 双跑字节一致；本件是确定性调度结构计数、非墙钟跑分，固定 0 基线不影响任何判词。
  const study = mvccStudy({ now: () => 0 })
  const c = study.comparison
  const snap = mvSnapshot(study)
  const rows = snap.levels.map((r) => ({
    level: r.short,
    observed: c.anomalies.filter((a) => r.anomalies[a].observed),
    prevented: c.anomalies.filter((a) => !r.anomalies[a].observed),
    aborted: r.aborted,
  }))
  console.log(JSON.stringify({
    generator: 'caesura-bplus-tree→caesura-mvcc-txn (KI-505)',
    isolationMatrix: rows,
    verdict: study.verdict,
    deadlock: {
      graph: study.deadlock.graph,
      cycle: study.deadlock.detected.cycle,
      victim: study.deadlock.resolution.victim,
      resolved: study.deadlock.resolution.resolved,
      regranted: study.deadlock.resolution.regranted,
      acyclicProbeNoCycle: study.deadlock.acyclicProbe.hasCycle === false,
    },
    twoPhaseLock: { lateAcquireBlocked: study.twoPhaseLock.lateAcquireBlocked },
    gc: study.gc,
    store: study.store.stats,
  }, null, 2))
}
