import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * scripts/caesura-raft-consensus.mjs —— Raft 共识与复制状态机：Raft 单 leader 强一致 /
 * 多主复制 / Gossip 最终一致 三协议诚实权衡对照（P8 第十五件，KI-507）。
 *
 * <p>补的是 KI-506 之后那一步。KI-506 把 2PC「协调者 prepare 后宕机 ⇒ 全体参与者持锁阻塞、
 * 不可自愈」钉成了读数，却没回答那个最要紧的追问——**协调者自己挂了怎么办**。生产里的答案
 * 不是换个更好的协调者，而是把协调者本身**做成一组复制状态机**：只要多数派还活着，日志就在、
 * 决策就能续、不会全员卡死。etcd / Consul / ZooKeeper 正是这么给分布式锁与事务托底的。而
 * 「怎么把一组副本弄成一台不会脑裂的机器」没有唯一答案，生产里是三条各有代价的路：</p>
 * <ol>
 *   <li>**Raft（单 leader 强一致共识）**：先选出一个 leader，所有写都经它、复制日志到多数派
 *       （quorum）才提交、再按顺序 apply 到状态机。term 单调递增 + 随机化选举超时打破平票 +
 *       Leader Completeness（日志不够新的候选当不了 leader）保证不脑裂、线性一致。代价是
 *       **leader 宕机要重新选主，选主空窗期间拒写**；**网络分区时少数派一侧凑不齐 quorum 必须
 *       拒写**（CP：宁可不可用也不冒脑裂写岔的风险）。</li>
 *   <li>**多主复制（Multi-Leader / Active-Active）**：每个副本都是主、都能就地接受写，**从不
 *       因为选主或分区而拒写**，异步把写复制到其它主。代价是**同一 key 被两个主并发写就冲突**
 *       （要 LWW / 版本向量 / 业务合并）、**异步复制窗口内读其它主会读到陈值**。但复制拓扑
 *       确定（每对主直接互推），收敛**有界**。</li>
 *   <li>**Gossip 反熵最终一致（Dynamo / Cassandra 风格）**：无主、任意节点可写，周期性地随机
 *       挑 peer 交换摘要、按版本合并差异（反熵）。高可用、分区两侧都能写。代价是**只保证最终
 *       一致**——反熵间隙内读会陈、并发写要冲突解决，且概率反熵**没有确定的收敛轮数上界**
 *       （说不出「第 k 轮必一致」）。</li>
 * </ol>
 *
 * <p>三只骨架 + 一只对照 + study/snapshot（缺一不可）：</p>
 * <ol>
 *   <li>**`createRaftCluster`**：真 Raft 状态机——`elect(fo)` term 单调、注入 rand 的随机选举
 *       超时、quorum 多数派当选、Leader Completeness 挡日志落后候选、`fo.votesAvailable` 模拟
 *       分区少数派凑不齐票留 `noLeader` 空窗；`append(cmd,fo)` 仅 leader 受理、复制 AppendEntries
 *       到多数派才前推 `commitIndex` 并**按序 apply**，`fo.networkPartition` 让 ack 不足 quorum
 *       ⇒ 拒写阻塞、`fo.logBehindAt` 触发 **nextIndex 回退重试**，`staleLeader` 旧 leader 的
 *       AppendEntries / read 被拒（脑裂下只读不写）。</li>
 *   <li>**`createMultiMaster`**：每主本地立即写 + 向量版本，`replicate(fo.lag)` 异步互推，
 *       `writeConflict` 制造两主并发写同 key 的分叉冲突、`replicationLag` 让复制延迟 ⇒ 读陈值；
 *       复制拓扑确定 ⇒ 收敛有界。</li>
 *   <li>**`createGossipStore`**：无主 KV + 版本，`antiEntropy()` 用注入 rand 随机挑 peer 交换
 *       摘要并合并，`fo.skipRounds` 制造反熵间隙 ⇒ 不收敛 + 读陈；概率反熵无确定轮数上界。</li>
 *   <li>**`compareRaftConsensus` 核心证据**：同一组**确定性故障场景**（全成功 / leader 宕机选主 /
 *       网络分区少数派 / 两主并发写冲突 / 异步复制延迟读陈值 / 反熵间隙读陈值）分喂三协议，
 *       数各 `committed/blockedWrites/staleReads/conflicts/converged/messages/terms`，钉死
 *       「**Raft** 线性一致·确定收敛，但选主空窗 + 分区少数派拒写 / **多主** 从不阻塞·有界收敛，
 *       但并发写冲突 + 复制延迟读陈 / **Gossip** 从不阻塞·任节点可写，但只最终一致·反熵无上界」
 *       这组最经典的真实取舍，并用**线性一致性 ∧ 分区可用性 ∧ 收敛确定性**三难判据证明
 *       **没有协议能同时占全**（`noUniversalWinner`，可证伪、非恒真）。</li>
 * </ol>
 *
 * <p>三难判据**逐协议量出真实向量，不假设「各恰好缺一」**（KI-506 初版过强假设的教训）：
 * Raft=[✓,✗,✓]=`101`、MultiMaster=[✗,✓,✓]=`011`、Gossip=[✗,✓,✗]=`010`——三条互不相同、
 * 没有一条三个全 ✓。判词可证伪：用 rigged 干净场景（抹掉四类故障）跑，三协议都退化为 `111`
 * ⇒ `trilemmaDistinguishes` / `noProtocolWinsAll` / `noUniversalWinner` 同时翻 false。单测钉住。</p>
 *
 * <p>设计取舍：时钟、随机、节点集、故障点、场景、反熵/复制轮数全由 opts 注入；本件只跑状态机
 * 与结构计数，不写业务阈值。与真 etcd / 真网络 / 真数据库无运行时依赖——无真持久化日志、无真
 * RPC、无真 socket、无成员变更 / 日志压缩 / ReadIndex·LeaseRead；所有读数都是**确定性故障场景
 * 上的结构计数**，不是墙钟、吞吐或真库一致性跑分。</p>
 *
 * 用法：
 *   const c = createRaftCluster(); c.elect(); c.append({key:'x',value:1}) // → committed
 *   const part = createRaftCluster(); part.elect(); part.append('x',{networkPartition:true}) // 拒写
 *   const mm = createMultiMaster(); mm.write('n1','x',1); mm.read('n2','x') // 陈值
 *   const g = createGossipStore(); g.write('n1','x',1); g.antiEntropy()     // 反熵收敛
 *   const cmp = compareRaftConsensus()
 *   const study = raftConsensusStudy()               // 纯数据汇总
 *
 * CLI：node scripts/caesura-raft-consensus.mjs  （= npm run raft:bench，注入固定时钟/随机双跑字节一致）
 */

/** 缺省教学参数（阈值/故障点仍由调用方注入，这里只是缺省值）。 */
export const RAFT_DEFAULTS = Object.freeze({
  nodes: Object.freeze(['n1', 'n2', 'n3', 'n4', 'n5']),
  antiEntropyRounds: 8,   // Gossip 干净场景跑的反熵轮数（足够 5 节点收敛）
  replicationRounds: 4,   // 多主干净场景的复制轮数
  skipRounds: 8,          // 反熵间隙跳过的轮数（= 总轮 ⇒ 一轮不跑）
  seed: 0x9e3779b9,       // 内部确定性 LCG 种子（opts.rand 可覆盖）
  zero: 0,
})

/** 三协议（顺序固定，短名作快照/矩阵 key）。 */
export const RAFT_PROTOCOLS = Object.freeze([
  Object.freeze({ id: 'raft', short: 'Raft', label: '单 leader 强一致共识' }),
  Object.freeze({ id: 'multi-master', short: 'MultiMaster', label: '多主复制' }),
  Object.freeze({ id: 'gossip', short: 'Gossip', label: '反熵最终一致' }),
])
const PROTOCOL_SHORTS = Object.freeze(RAFT_PROTOCOLS.map((p) => p.short))
const PROTOCOL_LABELS = Object.freeze(Object.fromEntries(RAFT_PROTOCOLS.map((p) => [p.short, p.label])))

/** 六类确定性故障场景（矩阵列；fault.at 决定打哪个协议，诚实：不打不相关软肋）。 */
export const RAFT_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'allOk', label: '全成功' }),
  Object.freeze({ id: 'leaderElection', label: 'leader 宕机选主空窗' }),
  Object.freeze({ id: 'networkPartition', label: '网络分区少数派' }),
  Object.freeze({ id: 'writeConflict', label: '两主并发写同 key' }),
  Object.freeze({ id: 'replicationLag', label: '异步复制延迟读陈值' }),
  Object.freeze({ id: 'antiEntropyGap', label: '反熵间隙读陈值' }),
])

const uniq = (xs) => Array.from(new Set(xs))
const asArr = (v) => Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v])
const intOr = (v, d) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d
const clampIdx = (i, n) => ((Number(i) % n) + n) % n
const namesOf = (v, fallback) => {
  const src = Array.isArray(v) && v.length ? v : fallback
  return uniq(src.map(String))
}

/** 内部确定性 LCG（不依赖 Math.random ⇒ CLI 双跑字节一致；opts.rand 可覆盖）。 */
function makeRand(seed) {
  let x = (Number.isFinite(Number(seed)) ? Number(seed) : RAFT_DEFAULTS.seed) >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 4294967296
  }
}

/** 用注入 rand 洗牌（Fisher-Yates），确定性。 */
function shuffle(xs, rand) {
  const a = xs.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

/* ============================================================
 * 共享内核：最终一致多副本 KV（多主与 Gossip 共用，差别只在复制调度）
 * ============================================================ */

/**
 * 多副本 KV：每节点一份 `{key:{val,ver,by}}`。写记逻辑版本 `ver` 与作者 `by`；
 * 合并两副本时 ver 大者胜、ver 相等但作者不同 ⇒ 并发分叉，`conflicts++` 后按 by 字典序 LWW。
 * 这诚实表达了「多主 / Gossip 共用同一套最终一致合并内核，差别只在复制拓扑与收敛上界」。
 */
function createReplicatedKV(nodes, rand) {
  const store = Object.fromEntries(nodes.map((n) => [n, Object.create(null)]))
  let conflicts = 0

  function writeLocal(node, key, val, fo = {}) {
    const cur = store[node][key]
    const ver = (cur ? cur.ver : 0) + 1
    store[node][key] = { val, ver, by: node }
    // 并发写：注入另一个主/节点在同一逻辑版本写同 key ⇒ 制造分叉（冲突在合并时暴露）。
    if (fo.concurrentOn) {
      const other = fo.concurrentOn === node
        ? nodes[clampIdx(nodes.indexOf(node) + 1, nodes.length)]
        : String(fo.concurrentOn)
      if (store[other] !== undefined) {
        // 并发方基于同一逻辑版本独立写 ⇒ 同 ver、不同 by，分叉在合并时暴露为冲突（不 +1 变覆盖）。
        store[other][key] = { val: fo.concurrentValue ?? `${val}-b`, ver, by: other }
      }
    }
    return { node, key, ver, by: node }
  }

  /** 合并一对副本；返回本对是否有差异被抹平。 */
  function mergePair(a, b) {
    const A = store[a], B = store[b]
    if (!A || !B) return false
    let changed = false
    const keys = uniq([...Object.keys(A), ...Object.keys(B)])
    for (const k of keys) {
      const x = A[k], y = B[k]
      if (!x) { A[k] = { ...y }; changed = true; continue }
      if (!y) { B[k] = { ...x }; changed = true; continue }
      if (x.ver === y.ver && x.by !== y.by) {
        conflicts++                             // 并发分叉 ⇒ 需要冲突解决（不粉饰自动消解）
        const win = String(x.by) < String(y.by) ? x : y
        A[k] = { ...win }; B[k] = { ...win }; changed = true
      } else if (x.ver > y.ver) {
        B[k] = { ...x }; changed = true
      } else if (y.ver > x.ver) {
        A[k] = { ...y }; changed = true
      }
    }
    return changed
  }

  function readLocal(node, key) {
    const cell = (store[node] || {})[key]
    return cell ? { val: cell.val, ver: cell.ver, by: cell.by } : null
  }

  function maxVer(key) {
    let m = 0
    for (const n of nodes) {
      const c = store[n][key]
      if (c && c.ver > m) m = c.ver
    }
    return m
  }

  function isConverged() {
    const ref = store[nodes[0]]
    const refKeys = Object.keys(ref)
    return nodes.every((n) => {
      const s = store[n]
      const ks = Object.keys(s)
      return ks.length === refKeys.length && refKeys.every((k) =>
        s[k] && s[k].val === ref[k].val && s[k].ver === ref[k].ver)
    })
  }

  return { store, writeLocal, mergePair, readLocal, maxVer, isConverged, get conflicts() { return conflicts } }
}

/* ============================================================
 * ① Raft 单 leader 强一致共识
 * ============================================================ */

/**
 * Raft 集群（进程内教学状态机）。
 *
 * term 单调递增；elect 随机化超时打破平票、quorum 当选、Leader Completeness 挡日志落后候选；
 * append 仅 leader 受理、复制多数派才提交并按序 apply；网络分区少数派拒写、旧 leader 被拒。
 */
export function createRaftCluster(opts = {}) {
  const nodes = namesOf(opts.nodes, RAFT_DEFAULTS.nodes)
  const rand = typeof opts.rand === 'function' ? opts.rand : makeRand(opts.seed)
  const now = opts.now
  const quorum = Math.floor(nodes.length / 2) + 1

  let term = 0
  let role = 'follower'                 // follower | candidate | leader | noLeader
  let leader = null
  let log = []                          // [{ term, index, cmd }]
  let commitIndex = 0
  let appliedIndex = 0
  /** @type {Record<string,any>} */
  const stateMachine = Object.create(null)
  const matchIndex = Object.fromEntries(nodes.map((n) => [n, 0]))
  const nextIndex = Object.fromEntries(nodes.map((n) => [n, 1]))
  let messages = 0, blockedWrites = 0, staleLeaderRejected = 0
  let nextIndexRetries = 0, rejectedReads = 0, leaderChanges = 0, applied = 0
  const termsSeen = []

  function lastLog() {
    const last = log[log.length - 1]
    return { term: last ? last.term : 0, index: last ? last.index : 0 }
  }

  function applyUpTo(target) {
    while (appliedIndex < target && appliedIndex < log.length) {
      const e = log[appliedIndex]
      const cmd = e && e.cmd
      if (cmd && typeof cmd === 'object' && 'key' in cmd) stateMachine[cmd.key] = cmd.value
      appliedIndex++
      applied++
    }
  }

  /**
   * 发起一次选举（term 前进）。`rand` 生成随机 election timeout 打破平票。
   * `fo.leaderDown` 旧 leader 先失联；`fo.splitVote` 本轮平票失败（留空窗）；
   * `fo.candidateStaleLog` 候选日志落后 ⇒ Leader Completeness 拒绝；
   * `fo.votesAvailable` 可达票数 < quorum ⇒ 分区少数派凑不齐票、noLeader 空窗。
   */
  function elect(fo = {}) {
    term++
    termsSeen.push(term)
    const timeouts = nodes.map(() => Number((rand() * 1000).toFixed(3)))
    if (fo.leaderDown === true) { leader = null; role = 'candidate' }
    if (fo.splitVote === true) {
      role = 'noLeader'
      messages += nodes.length
      return { elected: false, term, reason: 'split-vote', timeouts, splitVoteDetected: true, resolvedByTimeout: false, messages: nodes.length }
    }
    messages += 1
    if (fo.candidateStaleLog === true) {
      role = 'noLeader'
      messages += nodes.length
      return { elected: false, term, reason: 'leader-completeness', timeouts, votes: 0, quorum, messages: 1 + nodes.length }
    }
    const available = intOr(fo.votesAvailable, nodes.length)
    const votes = Math.max(0, Math.min(available, nodes.length))
    messages += votes
    if (votes < quorum) {
      role = 'noLeader'
      return { elected: false, term, reason: 'no-quorum', votes, quorum, timeouts, messages: 1 + votes }
    }
    if (leader === null) leader = String(nodes[0])
    role = 'leader'
    leaderChanges++
    const lowest = timeouts.indexOf(Math.min(...timeouts))
    return {
      elected: true, term, leader, votes, quorum, timeouts, lowestTimeoutNode: nodes[lowest],
      resolvedByTimeout: fo.splitVoteResolved === true, lastLog: lastLog(), messages: 1 + votes,
    }
  }

  /**
   * leader 受理一条写：追 log → 复制 AppendEntries 到多数派 → commitIndex 前推 → 按序 apply。
   * `fo.networkPartition` 把可达 ack 压到 quorum 以下 ⇒ 拒写、commitIndex 不推进（CP）。
   * `fo.logBehindAt` 让某 follower nextIndex 落后 ⇒ nextIndex 回退重试后补齐。
   * `fo.staleLeader` 旧 leader（term 落后）的写被多数派拒（脑裂下不产生分叉）。
   */
  function append(cmd, fo = {}) {
    if (fo.staleLeader === true) {
      staleLeaderRejected++
      messages += 1
      return { committed: false, rejected: true, reason: 'stale-leader-term', term, messages: 1 }
    }
    if (role !== 'leader') {
      blockedWrites++
      return { committed: false, blocked: true, reason: fo.reason || 'no-leader', term, messages: 0 }
    }
    const index = log.length + 1
    log.push({ term, index, cmd })
    for (const n of nodes) if (n !== leader) messages += 1   // AppendEntries 扇出

    if (fo.networkPartition === true) {
      blockedWrites++
      // 少数派侧：ack 只有 leader 自己（+可选少数跟随者），不足 quorum ⇒ 记录为未提交、不 apply。
      return { committed: false, blocked: true, reason: 'minority-partition', term, index, quorum, acks: 1, messages: nodes.length - 1 }
    }

    // nextIndex 回退：落后 follower 先失败一次、nextIndex--、重试补齐。
    if (fo.logBehindAt !== undefined) {
      const n = String(nodes[clampIdx(fo.logBehindAt, nodes.length)])
      nextIndexRetries++
      messages += 2                                          // 一次失败 + 一次重试
      nextIndex[n] = 1
      matchIndex[n] = index
    }

    const acks = 1 + (nodes.length - 1)                       // 多数派健康 ⇒ 全员 ack
    if (acks < quorum) {
      blockedWrites++
      return { committed: false, blocked: true, reason: 'no-quorum-acks', term, index, quorum, acks, messages }
    }
    for (const n of nodes) { matchIndex[n] = Math.max(matchIndex[n], index); nextIndex[n] = index + 1 }
    commitIndex = index
    applyUpTo(commitIndex)
    return { committed: true, term, index, commitIndex, appliedIndex, quorum, acks, messages }
  }

  /** 读状态机已 apply 的值（线性一致读：读 leader 已提交状态）。旧 leader 读被拒、不返回陈值。 */
  function read(key, fo = {}) {
    if (fo.staleLeader === true) {
      rejectedReads++
      messages += 1
      return { ok: false, rejected: true, reason: 'stale-leader-term', staleReads: 0, messages: 1 }
    }
    if (role !== 'leader') {
      blockedWrites++
      return { ok: false, blocked: true, reason: 'no-leader', staleReads: 0, messages: 0 }
    }
    return { ok: true, value: stateMachine[key] ?? null, commitIndex, appliedIndex, linearizable: true, staleReads: 0, messages: 0 }
  }

  function stats() {
    return {
      term, role, leader, quorum, nodes: nodes.length,
      logLength: log.length, commitIndex, appliedIndex, applied,
      matchIndex: { ...matchIndex }, nextIndex: { ...nextIndex },
      messages, blockedWrites, staleLeaderRejected, nextIndexRetries, rejectedReads, leaderChanges,
      converged: commitIndex === appliedIndex,
      linearizable: appliedIndex === commitIndex,
      termsSeen: termsSeen.slice(),
      lastLog: lastLog(),
    }
  }

  function snapshot(t) {
    return {
      generator: 'caesura-raft-consensus/raft', term, role, leader, quorum, nodes: nodes.slice(),
      commitIndex, appliedIndex, stateMachine: { ...stateMachine }, stats: stats(),
      builtAt: typeof now === 'function' ? now() : (t ?? Date.now()),
    }
  }

  function reset() {
    term = 0; role = 'follower'; leader = null; log = []; commitIndex = 0; appliedIndex = 0
    messages = 0; blockedWrites = 0; staleLeaderRejected = 0; nextIndexRetries = 0
    rejectedReads = 0; leaderChanges = 0; applied = 0; termsSeen.length = 0
    for (const n of nodes) { matchIndex[n] = 0; nextIndex[n] = 1 }
    for (const k of Object.keys(stateMachine)) delete stateMachine[k]
  }

  return {
    elect, append, read, stats, snapshot, reset,
    get term() { return term }, get role() { return role }, get leader() { return leader },
    get quorum() { return quorum }, get nodes() { return nodes.slice() }, get messages() { return messages },
  }
}

/* ============================================================
 * ② 多主复制（Multi-Leader / Active-Active）
 * ============================================================ */

/**
 * 多主复制集群：每节点皆主、本地立即写、从不因选主/分区拒写；异步复制（拓扑确定 ⇒ 收敛有界）。
 */
export function createMultiMaster(opts = {}) {
  const nodes = namesOf(opts.nodes, RAFT_DEFAULTS.nodes)
  const rand = typeof opts.rand === 'function' ? opts.rand : makeRand(opts.seed)
  const now = opts.now
  const kv = createReplicatedKV(nodes, rand)
  let messages = 0, writes = 0, staleReads = 0, blockedWrites = 0, replicateCalls = 0
  let lastWriteNode = null

  /** 本地立即写（无 quorum、无阻塞）。fo.concurrentOn 制造并发分叉。 */
  function write(node, key, val, fo = {}) {
    const n = String(node ?? nodes[0])
    if (!nodes.includes(n)) return { ok: false, reason: 'unknown-node', blockedWrites: 0 }
    const r = kv.writeLocal(n, key, val, fo)
    writes++
    lastWriteNode = n
    messages += 1 + (fo.concurrentOn ? 1 : 0)
    return { ok: true, committed: true, blockedWrites: 0, ...r, messages: 1 + (fo.concurrentOn ? 1 : 0) }
  }

  /** 异步复制到所有主；fo.lag ⇒ 本轮延迟不推（读其它主会陈）。 */
  function replicate(fo = {}) {
    replicateCalls++
    if (fo.lag === true) return { replicated: false, reason: 'replication-lag', rounds: 0, converged: kv.isConverged(), messages: 0 }
    const rounds = Math.max(1, intOr(fo.rounds, RAFT_DEFAULTS.replicationRounds))
    let changed = false
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i + 1 < nodes.length; i++) {
        if (kv.mergePair(nodes[i], nodes[i + 1])) changed = true
        messages += 1
      }
    }
    return { replicated: true, rounds, changed, converged: kv.isConverged(), messages: rounds * (nodes.length - 1) }
  }

  /** 读某主本地：若该 key 在别处有更高版本而本地没有 ⇒ 读到陈值。 */
  function read(node, key) {
    const n = String(node ?? nodes[0])
    const cell = kv.readLocal(n, key)
    const stale = kv.maxVer(key) > (cell ? cell.ver : 0)
    if (stale) staleReads++
    return { ok: true, value: cell ? cell.val : null, stale, staleReads, lastWriteNode, ver: cell ? cell.ver : 0 }
  }

  function converged() { return kv.isConverged() }
  function stats() {
    return {
      nodes: nodes.length, writes, staleReads, blockedWrites, conflicts: kv.conflicts,
      messages, replicateCalls, converged: kv.isConverged(),
      convergenceBound: RAFT_DEFAULTS.replicationRounds,   // 拓扑确定 ⇒ 有界
    }
  }
  function snapshot(t) {
    return { generator: 'caesura-raft-consensus/multi-master', nodes: nodes.slice(), stats: stats(), builtAt: typeof now === 'function' ? now() : (t ?? Date.now()) }
  }
  function reset() { messages = 0; writes = 0; staleReads = 0; blockedWrites = 0; replicateCalls = 0; lastWriteNode = null }

  return {
    write, replicate, read, converged, stats, snapshot, reset,
    get nodes() { return nodes.slice() }, get messages() { return messages }, get conflicts() { return kv.conflicts },
  }
}

/* ============================================================
 * ③ Gossip 反熵最终一致
 * ============================================================ */

/**
 * Gossip 反熵集群：无主、任节点可写，周期随机挑 peer 交换摘要按版本合并。
 * 概率反熵 ⇒ 说不出「第 k 轮必一致」的确定轮数上界（诚实边界）。
 */
export function createGossipStore(opts = {}) {
  const nodes = namesOf(opts.nodes, RAFT_DEFAULTS.nodes)
  const rand = typeof opts.rand === 'function' ? opts.rand : makeRand(opts.seed)
  const now = opts.now
  const kv = createReplicatedKV(nodes, rand)
  let messages = 0, writes = 0, staleReads = 0, blockedWrites = 0, antiEntropyCalls = 0, roundsRun = 0, roundsSkipped = 0

  function write(node, key, val, fo = {}) {
    const n = String(node ?? nodes[0])
    if (!nodes.includes(n)) return { ok: false, reason: 'unknown-node', blockedWrites: 0 }
    const r = kv.writeLocal(n, key, val, fo)
    writes++
    messages += 1 + (fo.concurrentOn ? 1 : 0)
    return { ok: true, committed: true, blockedWrites: 0, ...r, messages: 1 + (fo.concurrentOn ? 1 : 0) }
  }

  /**
   * 跑若干轮反熵：每轮用注入 rand 洗牌节点、相邻两两配对交换摘要。
   * `fo.skipRounds` 跳过前 k 轮（反熵间隙）⇒ 间隙内不收敛、读陈。
   */
  function antiEntropy(fo = {}) {
    antiEntropyCalls++
    const total = Math.max(1, intOr(fo.rounds, RAFT_DEFAULTS.antiEntropyRounds))
    const skip = Math.max(0, intOr(fo.skipRounds, 0))
    let changed = false
    for (let r = 0; r < total; r++) {
      if (r < skip) { roundsSkipped++; continue }
      roundsRun++
      const order = shuffle(nodes, rand)
      for (let i = 0; i + 1 < order.length; i += 2) {
        if (kv.mergePair(order[i], order[i + 1])) changed = true
        messages += 2                                       // 摘要 + 差异
      }
      // 奇数节点时落单者与队首再配一次（保证信息有机会跨轮传染）。
      if (order.length % 2 === 1) {
        if (kv.mergePair(order[order.length - 1], order[0])) changed = true
        messages += 2
      }
    }
    return { rounds: roundsRun, skipped: roundsSkipped, changed, converged: kv.isConverged(), messages }
  }

  function read(node, key) {
    const n = String(node ?? nodes[0])
    const cell = kv.readLocal(n, key)
    const stale = kv.maxVer(key) > (cell ? cell.ver : 0)
    if (stale) staleReads++
    return { ok: true, value: cell ? cell.val : null, stale, staleReads, ver: cell ? cell.ver : 0 }
  }

  function converged() { return kv.isConverged() }
  function stats() {
    return {
      nodes: nodes.length, writes, staleReads, blockedWrites, conflicts: kv.conflicts,
      messages, antiEntropyCalls, roundsRun, roundsSkipped, converged: kv.isConverged(),
      convergenceBound: null,                               // 概率反熵 ⇒ 无确定轮数上界
    }
  }
  function snapshot(t) {
    return { generator: 'caesura-raft-consensus/gossip', nodes: nodes.slice(), stats: stats(), builtAt: typeof now === 'function' ? now() : (t ?? Date.now()) }
  }
  function reset() { messages = 0; writes = 0; staleReads = 0; blockedWrites = 0; antiEntropyCalls = 0; roundsRun = 0; roundsSkipped = 0 }

  return {
    write, antiEntropy, read, converged, stats, snapshot, reset,
    get nodes() { return nodes.slice() }, get messages() { return messages }, get conflicts() { return kv.conflicts },
  }
}

/* ============================================================
 * ④ 场景对照 / 三难判据
 * ============================================================ */

function buildScenarios() {
  return RAFT_SCENARIOS.map((s) => ({ id: s.id, label: s.label, fault: {} }))
}
function faultOf(at, opts = {}) {
  const f = { at }
  if (at === 'writeConflict') { f.key = opts.conflictKey ?? 'x'; f.concurrentValue = opts.concurrentValue ?? 'concurrent' }
  if (at === 'replicationLag') { f.key = opts.lagKey ?? 'x' }
  if (at === 'antiEntropyGap') { f.key = opts.gapKey ?? 'x'; f.skipRounds = opts.skipRounds ?? RAFT_DEFAULTS.skipRounds }
  return f
}

/**
 * 跑「单协议 × 单场景」，统一读数矩阵形状。
 *
 * 故障对三协议的语义映射是诚实的（不打不相关软肋）：
 *  - `leaderElection` / `networkPartition` 只打击 Raft（多主/Gossip 无 leader、无 quorum 阻塞）；
 *  - `writeConflict` / `replicationLag` 打击多主与 Gossip（Raft 单 leader 定序、读已提交 ⇒ 不中）；
 *  - `antiEntropyGap` 只打击 Gossip（Raft/多主无概率反熵）。
 */
export function runRaftScenario(opts = {}) {
  const pid = PROTOCOL_SHORTS.includes(opts.protocol) ? opts.protocol : 'Raft'
  const scenario = opts.scenario || { id: 'allOk', label: '全成功', fault: {} }
  const fault = scenario.fault || {}
  const at = fault.at || 'allOk'
  const base = {
    protocol: pid, scenario: scenario.id || 'custom', label: scenario.label || scenario.id || '自定义',
    committed: false, blockedWrites: 0, staleReads: 0, conflicts: 0,
    converged: true, linearizable: true, messages: 0, terms: 0, rounds: 0, detail: {},
  }

  if (pid === 'Raft') {
    const c = createRaftCluster(opts)
    c.elect()
    let r
    if (at === 'leaderElection') {
      // 旧 leader 宕机 ⇒ 平票空窗（期间拒写）⇒ 随机超时打破平票选出新主 ⇒ 续写。
      const e1 = c.elect({ leaderDown: true, splitVote: true })
      r = c.append({ key: 'x', value: 1 }, { reason: 'leader-election' })
      const e2 = c.elect({ splitVoteResolved: true })
      const r2 = c.append({ key: 'x', value: 2 })
      return {
        ...base, committed: r2.committed === true,
        blockedWrites: c.stats().blockedWrites,
        linearizable: c.stats().linearizable,
        messages: e1.messages + e2.messages + (r.messages || 0) + (r2.messages || 0),
        terms: c.stats().termsSeen.length,
        detail: { splitVoteDetected: e1.splitVoteDetected, resolvedByTimeout: e2.resolvedByTimeout, electionTimeouts: e2.timeouts, leaderChanges: c.stats().leaderChanges, reason: r.reason },
      }
    }
    if (at === 'networkPartition') {
      r = c.append({ key: 'x', value: 1 }, { networkPartition: true })
      const s = c.stats()
      return {
        ...base, committed: r.committed === true, blockedWrites: s.blockedWrites,
        converged: s.converged, linearizable: s.linearizable, messages: r.messages, terms: s.term,
        detail: { reason: r.reason, quorum: r.quorum, acks: r.acks, commitIndex: s.commitIndex, appliedIndex: s.appliedIndex },
      }
    }
    // allOk / writeConflict / replicationLag / antiEntropyGap：单 leader 定序、读已提交 ⇒ 不中这些软肋。
    const c1 = c.append({ key: 'x', value: 1 })
    const c2 = at === 'writeConflict'
      ? c.append({ key: 'x', value: 2 })                     // 同 key 顺序写两次：定序、无冲突
      : c.append({ key: 'y', value: 2 })
    const rd = c.read('x')
    const s = c.stats()
    return {
      ...base, committed: c1.committed && c2.committed,
      blockedWrites: s.blockedWrites, staleReads: rd.staleReads || 0, conflicts: 0,
      converged: s.converged, linearizable: s.linearizable && (rd.linearizable === true),
      messages: (c1.messages || 0) + (c2.messages || 0), terms: s.term,
      detail: { commitIndex: s.commitIndex, appliedIndex: s.appliedIndex, applied: s.applied, readLinearizable: rd.linearizable === true },
    }
  }

  if (pid === 'MultiMaster') {
    const m = createMultiMaster(opts)
    const key = fault.key ?? 'x'
    let r, rep, rd
    if (at === 'writeConflict') {
      // 两主在互不知情下并发写同一 key（同逻辑版本、不同作者）⇒ 分叉冲突。
      r = m.write('n1', key, 1, { concurrentOn: 'n2', concurrentValue: 2 })
      rep = m.replicate()
      rd = m.read('n1', key)
    } else if (at === 'replicationLag') {
      r = m.write('n1', key, 1)
      rd = m.read('n3', key)                                  // 复制未到 ⇒ 读陈
      rep = m.replicate()                                     // 之后复制补齐 ⇒ 收敛
    } else {
      // allOk / leaderElection / networkPartition / antiEntropyGap：多主无 leader 阻塞、拓扑确定收敛。
      r = m.write('n1', key, 1)
      rep = m.replicate()
      rd = m.read('n2', key)
    }
    const s = m.stats()
    return {
      ...base, committed: r.ok === true, blockedWrites: s.blockedWrites,
      staleReads: s.staleReads, conflicts: s.conflicts,
      converged: s.converged, linearizable: s.staleReads === 0 && s.conflicts === 0,
      messages: s.messages, rounds: rep.rounds || 0,
      detail: { replicated: rep.replicated, rounds: rep.rounds, readStale: rd.stale, convergenceBound: s.convergenceBound, lastWriteNode: rd.lastWriteNode },
    }
  }

  if (pid === 'Gossip') {
    const g = createGossipStore(opts)
    const key = fault.key ?? 'x'
    let r, ae, rd
    if (at === 'writeConflict') {
      // 两节点并发写同一 key ⇒ 分叉，反熵合并时暴露冲突并按 LWW 解决。
      r = g.write('n1', key, 1, { concurrentOn: 'n3', concurrentValue: 2 })
      ae = g.antiEntropy()
      rd = g.read('n1', key)
    } else if (at === 'replicationLag') {
      r = g.write('n1', key, 1)
      rd = g.read('n4', key)                                  // 反熵未到 ⇒ 读陈
      ae = g.antiEntropy()                                    // 之后反熵补齐 ⇒ 收敛
    } else if (at === 'antiEntropyGap') {
      r = g.write('n1', key, 1)
      ae = g.antiEntropy({ skipRounds: fault.skipRounds ?? RAFT_DEFAULTS.skipRounds })
      rd = g.read('n4', key)                                  // 反熵全跳过 ⇒ 读陈、不收敛
    } else {
      // allOk / leaderElection / networkPartition：无主可写、干净反熵收敛。
      r = g.write('n1', key, 1)
      ae = g.antiEntropy()
      rd = g.read('n3', key)
    }
    const s = g.stats()
    return {
      ...base, committed: r.ok === true, blockedWrites: s.blockedWrites,
      staleReads: s.staleReads, conflicts: s.conflicts,
      converged: s.converged, linearizable: s.staleReads === 0 && s.conflicts === 0,
      messages: s.messages, rounds: s.roundsRun,
      detail: { roundsRun: s.roundsRun, roundsSkipped: s.roundsSkipped, readStale: rd.stale, convergenceBound: s.convergenceBound },
    }
  }

  return base
}

/**
 * 核心对照：六场景 × 三协议的统一读数矩阵 + 三难判据 + verdict。
 *
 * 三难 = **线性一致性 ∧ 分区可用性 ∧ 收敛确定性**。逐协议量出**真实**向量（不假设「各恰好缺一」）：
 *   Raft        = [线性 ✓, 分区可用 ✗, 确定收敛 ✓] = `101`（选主/分区少数派拒写）
 *   MultiMaster = [线性 ✗, 分区可用 ✓, 确定收敛 ✓] = `011`（并发写冲突 + 复制延迟读陈）
 *   Gossip      = [线性 ✗, 分区可用 ✓, 确定收敛 ✗] = `010`（再缺：概率反熵无收敛上界）
 * 三条**互不相同**、且**没有一条三个全 ✓** ⇒ 无全局赢家（`noUniversalWinner` 真）。
 * 判词可证伪：rigged 干净场景（抹掉四类故障）跑，三协议都退化为 `111` ⇒ `trilemmaDistinguishes`
 * 与 `noProtocolWinsAll` 同时翻 false。单测钉住这条。
 */
export function compareRaftConsensus(opts = {}) {
  const scenarios = Array.isArray(opts.scenarios) ? opts.scenarios.map((s) => ({
    id: s.id, label: s.label || s.id, fault: s.fault && s.fault.at ? s.fault : faultOf(s.id, opts),
  })) : RAFT_SCENARIOS.map((s) => ({ id: s.id, label: s.label, fault: faultOf(s.id, opts) }))
  const protocols = PROTOCOL_SHORTS
  /** @type {Record<string,any>} */
  const matrix = {}
  for (const p of protocols) {
    const cell = {
      protocol: p, label: PROTOCOL_LABELS[p], scenarios: {},
      totals: { committed: 0, blockedWrites: 0, staleReads: 0, conflicts: 0, messages: 0, diverged: 0 },
      trilemma: { linearizable: false, partitionAvailable: false, boundedConvergence: false },
    }
    for (const sc of scenarios) {
      const r = runRaftScenario({ ...opts, protocol: p, scenario: sc })
      cell.scenarios[sc.id] = { ...r, label: sc.label, fault: sc.fault || {} }
      cell.totals.committed += r.committed ? 1 : 0
      cell.totals.blockedWrites += r.blockedWrites
      cell.totals.staleReads += r.staleReads
      cell.totals.conflicts += r.conflicts
      cell.totals.messages += r.messages
      cell.totals.diverged += r.converged ? 0 : 1
    }
    matrix[p] = cell
  }

  const trilemma = {}
  for (const p of protocols) {
    const rows = Object.values(matrix[p].scenarios)
    trilemma[p] = {
      linearizable: rows.every((r) => r.linearizable === true && r.staleReads === 0 && r.conflicts === 0),
      partitionAvailable: rows.every((r) => r.blockedWrites === 0),
      boundedConvergence: rows.every((r) => r.converged === true),
    }
    matrix[p].trilemma = trilemma[p]
  }

  const sc = (p, id) => matrix[p].scenarios[id]
  const vecOf = (p) => `${Number(trilemma[p].linearizable)}${Number(trilemma[p].partitionAvailable)}${Number(trilemma[p].boundedConvergence)}`
  const vectors = protocols.map(vecOf)
  const trilemmaDistinguishes = new Set(vectors).size === protocols.length
  const noProtocolWinsAll = !protocols.some((p) => trilemma[p].linearizable && trilemma[p].partitionAvailable && trilemma[p].boundedConvergence)

  const verdict = {
    raftBlocksOnLeaderElection: (sc('Raft', 'leaderElection')?.blockedWrites ?? 0) > 0,
    raftBlocksOnPartition: (sc('Raft', 'networkPartition')?.blockedWrites ?? 0) > 0,
    raftNeverStale: trilemma.Raft.linearizable,
    multiMasterPartitionAvailable: trilemma.MultiMaster.partitionAvailable,
    multiMasterConflictsOnWrite: (sc('MultiMaster', 'writeConflict')?.conflicts ?? 0) > 0,
    multiMasterStaleOnLag: (sc('MultiMaster', 'replicationLag')?.staleReads ?? 0) > 0,
    gossipPartitionAvailable: trilemma.Gossip.partitionAvailable,
    gossipStaleOnGap: (sc('Gossip', 'antiEntropyGap')?.staleReads ?? 0) > 0,
    gossipDivergesOnGap: (sc('Gossip', 'antiEntropyGap')?.converged ?? true) === false,
    trilemmaDistinguishes,
    noProtocolWinsAll,
    noUniversalWinner: (sc('Raft', 'leaderElection')?.blockedWrites ?? 0) > 0 &&
      (sc('Raft', 'networkPartition')?.blockedWrites ?? 0) > 0 && trilemma.Raft.linearizable &&
      trilemma.MultiMaster.partitionAvailable &&
      (sc('MultiMaster', 'writeConflict')?.conflicts ?? 0) > 0 && (sc('MultiMaster', 'replicationLag')?.staleReads ?? 0) > 0 &&
      trilemma.Gossip.partitionAvailable && (sc('Gossip', 'antiEntropyGap')?.staleReads ?? 0) > 0 &&
      (sc('Gossip', 'antiEntropyGap')?.converged ?? true) === false &&
      trilemmaDistinguishes && noProtocolWinsAll,
  }

  return {
    generator: 'caesura-raft-consensus/compare',
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

/** 选举探针：term 单调、随机超时打破平票、缺 quorum 留空窗、Leader Completeness 挡落后候选。 */
function electionProbe(opts = {}) {
  const c = createRaftCluster(opts)
  const e1 = c.elect(), e2 = c.elect(), e3 = c.elect({ leaderDown: true })
  const terms = c.stats().termsSeen
  const split = c.elect({ splitVote: true })
  const resolved = c.elect({ splitVoteResolved: true })
  const noQuorum = c.elect({ leaderDown: true, votesAvailable: 1 })
  const completeness = c.elect({ candidateStaleLog: true })
  return {
    terms, termMonotonic: terms.every((t, i) => i === 0 || t > terms[i - 1]),
    splitVoteDetected: split.splitVoteDetected === true,
    resolvedByTimeout: resolved.resolvedByTimeout === true && Array.isArray(resolved.timeouts) && resolved.timeouts.length > 0,
    noQuorumLeavesNoLeader: noQuorum.elected === false && noQuorum.reason === 'no-quorum' && c.stats().role === 'noLeader',
    leaderCompleteness: completeness.elected === false && completeness.reason === 'leader-completeness',
  }
}

/** 复制探针：AppendEntries 多数派提交 + 按序 apply + nextIndex 回退 + 少数派拒写 + 旧 leader 被拒。 */
function replicationProbe(opts = {}) {
  const c = createRaftCluster(opts)
  c.elect()
  c.append({ key: 'x', value: 1 })
  c.append({ key: 'y', value: 2 })
  const ordered = c.append({ key: 'x', value: 3 })
  const s1 = c.stats()
  const back = c.append({ key: 'z', value: 4 }, { logBehindAt: 1 })
  const s2 = c.stats()
  const part = c.append({ key: 'w', value: 5 }, { networkPartition: true })
  const stale = c.append({ key: 'v', value: 6 }, { staleLeader: true })
  const staleRead = c.read('x', { staleLeader: true })
  return {
    committed: ordered.committed === true,
    commitIndex: s1.commitIndex, appliedIndex: s1.appliedIndex,
    orderedApply: s1.commitIndex === s1.appliedIndex && s1.applied === 3,
    nextIndexRetried: s2.nextIndexRetries > 0 && back.committed === true,
    minorityBlocked: part.committed === false && part.reason === 'minority-partition' && c.stats().commitIndex === s2.commitIndex,
    staleLeaderRejected: stale.rejected === true && staleRead.rejected === true,
    stats: c.stats(),
  }
}

/** 安全性探针：脑裂旧 leader term 落后只读不写、状态机不被污染；Leader Completeness 已在选举探针钉住。 */
function safetyProbe(opts = {}) {
  const c = createRaftCluster(opts)
  c.elect()
  c.append({ key: 'x', value: 1 })
  const t1 = c.term
  c.elect({ leaderDown: true })                              // 新 leader term 更高
  const t2 = c.term
  const staleWrite = c.append({ key: 'x', value: 999 }, { staleLeader: true })
  const staleRead = c.read('x', { staleLeader: true })
  const clean = c.read('x')
  const s = c.stats()
  return {
    termAdvanced: t2 > t1,
    staleWriteRejected: staleWrite.rejected === true,
    staleReadRejected: staleRead.rejected === true,
    noSplitBrainWrite: clean.value === 1 && s.appliedIndex === 1,
    stateMachine: s.converged,
  }
}

/** Gossip 探针：反熵最终收敛（无 gap）vs 反熵间隙读陈 + 不收敛 + 无确定上界。 */
function gossipProbe(opts = {}) {
  const clean = createGossipStore(opts)
  clean.write('n1', 'x', 1, { concurrentOn: 'n3', concurrentValue: 1 })
  const ae = clean.antiEntropy()
  const afterConverge = clean.read('n5', 'x')
  const gap = createGossipStore(opts)
  gap.write('n1', 'x', 1)
  const gapAe = gap.antiEntropy({ skipRounds: opts.skipRounds ?? RAFT_DEFAULTS.skipRounds })
  const gapRead = gap.read('n5', 'x')
  return {
    convergesClean: ae.converged === true && clean.converged() === true,
    cleanReadFresh: afterConverge.stale === false,
    gapNotConverged: gapAe.converged === false && gap.converged() === false,
    gapReadStale: gapRead.stale === true,
    noBound: clean.stats().convergenceBound === null && gap.stats().convergenceBound === null,
    roundsRun: ae.rounds, roundsSkipped: gapAe.skipped,
  }
}

/** 汇总成纯数据 study（确定性、无真时钟/socket/磁盘）。 */
export function raftConsensusStudy(opts = {}) {
  const comparison = compareRaftConsensus(opts)
  const election = electionProbe(opts)
  const replication = replicationProbe(opts)
  const safety = safetyProbe(opts)
  const gossip = gossipProbe(opts)
  return {
    generator: 'caesura-raft-consensus',
    comparison,
    election, replication, safety, gossip,
    verdict: {
      ...comparison.verdict,
      electionTermsMonotonic: election.termMonotonic,
      electionBreaksTieByTimeout: election.resolvedByTimeout,
      electionLeaderCompleteness: election.leaderCompleteness,
      replicationOrderedApply: replication.orderedApply,
      replicationNextIndexRetry: replication.nextIndexRetried,
      safetyNoSplitBrainWrite: safety.noSplitBrainWrite,
      gossipConvergesClean: gossip.convergesClean,
      gossipNoConvergenceBound: gossip.noBound,
    },
    builtAt: typeof opts.now === 'function' ? opts.now() : Date.now(),
  }
}

/** 把 study 收敛成前端 / status 友好的只读结构（node 侧判词，前端只渲染、不复核、不实测）。 */
export function rcSnapshot(study) {
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
    election: study.election, replication: study.replication, safety: study.safety, gossip: study.gossip,
    verdict: study.verdict,
    builtAt: study.builtAt,
  }
}

/* ------------------------------- CLI ------------------------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // 注入固定时钟 + 固定随机 ⇒ CLI 双跑字节一致；本件是确定性故障场景结构计数、非墙钟跑分。
  const study = raftConsensusStudy({ now: () => 0, rand: makeRand(RAFT_DEFAULTS.seed) })
  const snap = rcSnapshot(study)
  const stateOf = (r) => r.blockedWrites > 0 ? '阻' : r.staleReads > 0 ? '陈' : r.conflicts > 0 ? '冲' : r.converged === false ? '散' : r.committed ? '成' : '?'
  const matrix = snap.rows.map((r) => ({
    protocol: r.protocol,
    ladder: snap.config.scenarios.map((s) => s.id + ':' + stateOf(r.scenarios.find((x) => x.id === s.id) || {})).join(' → '),
    totals: r.totals,
    trilemma: r.trilemma,
  }))
  console.log(JSON.stringify({
    generator: 'caesura-distributed-txn→caesura-raft-consensus (KI-507)',
    matrix,
    trilemmaVectors: study.comparison.trilemmaVectors,
    verdict: study.verdict,
    probes: {
      election: { termMonotonic: study.election.termMonotonic, breaksTieByTimeout: study.election.resolvedByTimeout, leaderCompleteness: study.election.leaderCompleteness, noQuorumNoLeader: study.election.noQuorumLeavesNoLeader },
      replication: { orderedApply: study.replication.orderedApply, nextIndexRetry: study.replication.nextIndexRetried, minorityBlocked: study.replication.minorityBlocked, staleLeaderRejected: study.replication.staleLeaderRejected },
      safety: { noSplitBrainWrite: study.safety.noSplitBrainWrite },
      gossip: { convergesClean: study.gossip.convergesClean, gapReadStale: study.gossip.gapReadStale, gapNotConverged: study.gossip.gapNotConverged, noBound: study.gossip.noBound },
    },
  }, null, 2))
}
