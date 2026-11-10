import { describe, it, expect } from 'vitest'
import {
  RAFT_DEFAULTS,
  RAFT_PROTOCOLS,
  RAFT_SCENARIOS,
  createRaftCluster,
  createMultiMaster,
  createGossipStore,
  runRaftScenario,
  compareRaftConsensus,
  raftConsensusStudy,
  rcSnapshot,
} from '../../scripts/caesura-raft-consensus.mjs'

/** 固定时钟 + 固定随机：本件是确定性故障场景结构计数、非墙钟跑分，注入基线不影响任何判词。 */
const fixed = () => () => 0
const fixedRand = () => {
  let x = 0x9e3779b9 >>> 0
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 }
}
const inj = () => ({ now: fixed(), rand: fixedRand() })

describe('KI-507 Raft 共识：单 leader 强一致 / 多主复制 / Gossip 反熵 三协议诚实权衡', () => {
  it('① 缺省参数冻结、10 枚值导出齐全、三协议/六场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(RAFT_DEFAULTS)).toBe(true)
    expect(RAFT_PROTOCOLS.map((p) => p.short)).toEqual(['Raft', 'MultiMaster', 'Gossip'])
    expect(RAFT_SCENARIOS.map((s) => s.id)).toEqual([
      'allOk', 'leaderElection', 'networkPartition', 'writeConflict', 'replicationLag', 'antiEntropyGap',
    ])
    for (const fn of [
      createRaftCluster, createMultiMaster, createGossipStore, runRaftScenario,
      compareRaftConsensus, raftConsensusStudy, rcSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(RAFT_DEFAULTS.nodes.length).toBe(5)
    expect(RAFT_DEFAULTS.seed).toBeGreaterThan(0)
  })

  /* ---------------- ① Raft ---------------- */
  it('② Raft quorum 当选：5 节点 quorum=3，term 单调递增', () => {
    const c = createRaftCluster(inj())
    expect(c.quorum).toBe(3)
    const e1 = c.elect()
    const e2 = c.elect()
    expect(e1.elected).toBe(true)
    expect(e2.elected).toBe(true)
    expect(e2.term).toBeGreaterThan(e1.term)
    expect(c.role).toBe('leader')
    const terms = c.stats().termsSeen
    expect(terms.every((t, i) => i === 0 || t > terms[i - 1]!)).toBe(true)
  })

  it('③ Raft 随机选举超时打破平票（resolvedByTimeout），非硬编码', () => {
    const c = createRaftCluster(inj())
    c.elect()
    const split = c.elect({ leaderDown: true, splitVote: true })
    expect(split.elected).toBe(false)
    expect(split.reason).toBe('split-vote')
    expect(split.splitVoteDetected).toBe(true)
    expect(Array.isArray(split.timeouts)).toBe(true)
    const resolved = c.elect({ splitVoteResolved: true })
    expect(resolved.elected).toBe(true)
    expect(resolved.resolvedByTimeout).toBe(true)
    expect(resolved.timeouts!.length).toBe(5)
    expect(resolved.lowestTimeoutNode).toBeDefined()
  })

  it('④ Raft 分区少数派凑不齐票 ⇒ no-quorum 留 noLeader 空窗', () => {
    const c = createRaftCluster(inj())
    c.elect()
    const e = c.elect({ leaderDown: true, votesAvailable: 1 })
    expect(e.elected).toBe(false)
    expect(e.reason).toBe('no-quorum')
    expect(e.votes).toBe(1)
    expect(e.quorum).toBe(3)
    expect(c.role).toBe('noLeader')
    expect(c.append({ key: 'x', value: 1 }).blocked).toBe(true)
  })

  it('⑤ Raft Leader Completeness：日志落后候选当不了 leader', () => {
    const c = createRaftCluster(inj())
    c.elect()
    c.append({ key: 'x', value: 1 })
    const e = c.elect({ candidateStaleLog: true })
    expect(e.elected).toBe(false)
    expect(e.reason).toBe('leader-completeness')
  })

  it('⑥ Raft AppendEntries 多数派提交 + 按序 apply（commitIndex===appliedIndex）', () => {
    const c = createRaftCluster(inj())
    c.elect()
    const a = c.append({ key: 'x', value: 1 })
    const b = c.append({ key: 'y', value: 2 })
    const d = c.append({ key: 'x', value: 3 })
    expect(a.committed && b.committed && d.committed).toBe(true)
    const s = c.stats()
    expect(s.commitIndex).toBe(3)
    expect(s.appliedIndex).toBe(3)
    expect(s.applied).toBe(3)
    expect(s.converged).toBe(true)
    expect(c.read('x').value).toBe(3)
  })

  it('⑦ Raft nextIndex 回退重试：落后 follower 先退再补齐、仍能提交', () => {
    const c = createRaftCluster(inj())
    c.elect()
    c.append({ key: 'x', value: 1 })
    const before = c.stats().nextIndexRetries
    const r = c.append({ key: 'z', value: 4 }, { logBehindAt: 1 })
    expect(r.committed).toBe(true)
    expect(c.stats().nextIndexRetries).toBeGreaterThan(before)
    expect(c.stats().commitIndex).toBe(2)
  })

  it('⑧ Raft 网络分区少数派拒写、commitIndex 不推进（CP 不冒脑裂）', () => {
    const c = createRaftCluster(inj())
    c.elect()
    c.append({ key: 'x', value: 1 })
    const ci = c.stats().commitIndex
    const r = c.append({ key: 'w', value: 5 }, { networkPartition: true })
    expect(r.committed).toBe(false)
    expect(r.reason).toBe('minority-partition')
    expect(r.acks).toBeLessThan(r.quorum!)
    expect(c.stats().commitIndex).toBe(ci)
    expect(c.stats().blockedWrites).toBeGreaterThan(0)
  })

  it('⑨ Raft 脑裂旧 leader 只读不写：stale term 的写/读被拒、状态机不污染', () => {
    const c = createRaftCluster(inj())
    c.elect()
    c.append({ key: 'x', value: 1 })
    const t1 = c.term
    c.elect({ leaderDown: true })
    expect(c.term).toBeGreaterThan(t1)
    const w = c.append({ key: 'x', value: 999 }, { staleLeader: true })
    const r = c.read('x', { staleLeader: true })
    expect(w.rejected).toBe(true)
    expect(r.rejected).toBe(true)
    expect(r.staleReads).toBe(0) // 诚实：拒绝而非返回陈值
    expect(c.stats().staleLeaderRejected).toBeGreaterThan(0)
    expect(c.read('x').value).toBe(1)
  })

  it('⑩ Raft 读线性一致：从不读陈、无写冲突', () => {
    const c = createRaftCluster(inj())
    c.elect()
    c.append({ key: 'x', value: 1 }, { networkPartition: true }) // 未提交
    const r = c.read('x')
    expect(r.linearizable).toBe(true)
    expect(r.staleReads).toBe(0)
  })

  /* ---------------- ② 多主复制 ---------------- */
  it('⑪ 多主本地立即写：从不阻塞、每节点可写、无 leader 概念', () => {
    const m = createMultiMaster(inj())
    const a = m.write('n1', 'x', 1)
    const b = m.write('n3', 'y', 2)
    expect(a.committed && b.committed).toBe(true)
    expect(a.blockedWrites).toBe(0)
    expect(m.stats().blockedWrites).toBe(0)
  })

  it('⑫ 多主并发写同 key ⇒ 版本分叉 conflicts（需业务合并、不粉饰自动消解）', () => {
    const m = createMultiMaster(inj())
    m.write('n1', 'x', 1, { concurrentOn: 'n2', concurrentValue: 2 })
    expect(m.conflicts).toBe(0)        // 分叉在合并时暴露
    m.replicate()
    expect(m.conflicts).toBeGreaterThan(0)
    expect(m.stats().conflicts).toBeGreaterThan(0)
    expect(m.converged()).toBe(true)   // LWW 合并后确定收敛（有界）
  })

  it('⑬ 多主复制延迟 ⇒ 读其它主陈值；复制补齐后收敛有界', () => {
    const m = createMultiMaster(inj())
    m.write('n1', 'x', 1)
    const lag = m.replicate({ lag: true })
    expect(lag.replicated).toBe(false)
    const stale = m.read('n3', 'x')
    expect(stale.stale).toBe(true)     // 复制未到 ⇒ 读到落后状态
    expect(m.stats().staleReads).toBeGreaterThan(0)
    const rep = m.replicate()
    expect(rep.converged).toBe(true)
    expect(m.read('n3', 'x').stale).toBe(false)
    expect(m.stats().convergenceBound).not.toBeNull() // 拓扑确定 ⇒ 有界
  })

  /* ---------------- ③ Gossip ---------------- */
  it('⑭ Gossip 无主任意写 + 干净反熵最终收敛、读不陈', () => {
    const g = createGossipStore(inj())
    g.write('n1', 'x', 1)
    g.write('n5', 'y', 2)
    const ae = g.antiEntropy()
    expect(ae.converged).toBe(true)
    expect(g.converged()).toBe(true)
    expect(g.read('n3', 'x').stale).toBe(false)
    expect(g.stats().convergenceBound).toBeNull() // 概率反熵无确定上界（诚实）
  })

  it('⑮ Gossip 并发写也冲突；反熵合并解决（最终一致非强一致）', () => {
    const g = createGossipStore(inj())
    g.write('n1', 'x', 1, { concurrentOn: 'n3', concurrentValue: 2 })
    g.antiEntropy()
    expect(g.conflicts).toBeGreaterThan(0)
    expect(g.converged()).toBe(true)
  })

  it('⑯ Gossip 反熵间隙 ⇒ 不收敛 + 读陈（核心软肋）', () => {
    const g = createGossipStore(inj())
    g.write('n1', 'x', 1)
    const ae = g.antiEntropy({ skipRounds: RAFT_DEFAULTS.skipRounds })
    expect(ae.converged).toBe(false)
    expect(ae.skipped).toBe(RAFT_DEFAULTS.skipRounds)
    expect(g.read('n4', 'x').stale).toBe(true)
    expect(g.converged()).toBe(false)
  })

  /* ---------------- ④ 六场景三协议对照 ---------------- */
  it('⑰ 六场景喂三协议：三难向量 Raft=101 / MultiMaster=011 / Gossip=010，互异且无一 111', () => {
    const cmp = compareRaftConsensus(inj())
    expect(cmp.trilemmaVectors).toEqual({ Raft: '101', MultiMaster: '011', Gossip: '010' })
    expect(new Set(Object.values(cmp.trilemmaVectors)).size).toBe(3)
    for (const v of Object.values(cmp.trilemmaVectors)) expect(v).not.toBe('111')
    expect(cmp.verdict.noUniversalWinner).toBe(true)
    expect(cmp.verdict.trilemmaDistinguishes).toBe(true)
    expect(cmp.verdict.noProtocolWinsAll).toBe(true)
  })

  it('⑱ 判词可证伪：rigged 干净场景抹掉四类故障 ⇒ 三协议全退化为 111、三判词同时翻 false', () => {
    const rigged = [
      { id: 'clean1', label: '干净', fault: {} },
      { id: 'clean2', label: '干净', fault: {} },
      { id: 'clean3', label: '干净', fault: {} },
    ]
    const cmp = compareRaftConsensus({ ...inj(), scenarios: rigged })
    expect(cmp.trilemmaVectors).toEqual({ Raft: '111', MultiMaster: '111', Gossip: '111' })
    expect(cmp.verdict.trilemmaDistinguishes).toBe(false)
    expect(cmp.verdict.noProtocolWinsAll).toBe(false)
    expect(cmp.verdict.noUniversalWinner).toBe(false)
  })

  it('⑲ 判词逐条真：Raft 两处阻塞/线性一致、多主冲突+读陈、Gossip 间隙读陈不收敛', () => {
    const v = compareRaftConsensus(inj()).verdict
    expect(v.raftBlocksOnLeaderElection).toBe(true)
    expect(v.raftBlocksOnPartition).toBe(true)
    expect(v.raftNeverStale).toBe(true)
    expect(v.multiMasterPartitionAvailable).toBe(true)
    expect(v.multiMasterConflictsOnWrite).toBe(true)
    expect(v.multiMasterStaleOnLag).toBe(true)
    expect(v.gossipPartitionAvailable).toBe(true)
    expect(v.gossipStaleOnGap).toBe(true)
    expect(v.gossipDivergesOnGap).toBe(true)
  })

  it('⑳ 故障映射诚实：leaderElection/networkPartition 只打 Raft，writeConflict/replicationLag 不打 Raft', () => {
    const inj0 = inj()
    const le = runRaftScenario({ ...inj0, protocol: 'MultiMaster', scenario: { id: 'leaderElection', label: '选主', fault: { at: 'leaderElection' } } })
    expect(le.blockedWrites).toBe(0)
    const np = runRaftScenario({ ...inj0, protocol: 'Gossip', scenario: { id: 'networkPartition', label: '分区', fault: { at: 'networkPartition' } } })
    expect(np.blockedWrites).toBe(0)
    const wc = runRaftScenario({ ...inj0, protocol: 'Raft', scenario: { id: 'writeConflict', label: '并发写', fault: { at: 'writeConflict' } } })
    expect(wc.staleReads).toBe(0)
    expect(wc.conflicts).toBe(0)
    const rl = runRaftScenario({ ...inj0, protocol: 'Raft', scenario: { id: 'replicationLag', label: '复制延迟', fault: { at: 'replicationLag' } } })
    expect(rl.staleReads).toBe(0)
  })

  /* ---------------- ⑤ study / snapshot / 确定性 / 降级 ---------------- */
  it('㉑ study JSON 往返无损、builtAt 注入确定性、rcSnapshot 纯数据同源', () => {
    const a = raftConsensusStudy(inj())
    const b = raftConsensusStudy(inj())
    expect(a.builtAt).toBe(0)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const round = JSON.parse(JSON.stringify(a))
    expect(round.comparison.trilemmaVectors).toEqual(a.comparison.trilemmaVectors)
    const snap = rcSnapshot(a)!
    expect(snap.config.protocols).toEqual(['Raft', 'MultiMaster', 'Gossip'])
    expect(snap.config.scenarios.length).toBe(6)
    expect(snap.rows.length).toBe(3)
    expect(snap.rows[0]!.scenarios.length).toBe(6)
    expect(snap.verdict.noUniversalWinner).toBe(true)
    expect(snap.builtAt).toBe(0)
  })

  it('㉒ rcSnapshot 缺参诚实降级为 null，不编读数', () => {
    expect(rcSnapshot(null)).toBeNull()
    expect(rcSnapshot(undefined)).toBeNull()
  })

  it('㉓ 注入确定性：固定时钟+随机下 study 逐字一致；换 seed 仍不动三难向量（判词非偶然）', () => {
    const a = raftConsensusStudy(inj())
    const b = raftConsensusStudy(inj())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const other = raftConsensusStudy({ now: fixed(), rand: fixedRand(), seed: 12345 })
    expect(other.comparison.trilemmaVectors).toEqual(a.comparison.trilemmaVectors)
    expect(other.verdict.noUniversalWinner).toBe(true)
  })

  it('㉔ 三探针全真：选举/复制/安全性/Gossip 各自钉死教学判据', () => {
    const st = raftConsensusStudy(inj())
    expect(st.election.termMonotonic).toBe(true)
    expect(st.election.resolvedByTimeout).toBe(true)
    expect(st.election.noQuorumLeavesNoLeader).toBe(true)
    expect(st.election.leaderCompleteness).toBe(true)
    expect(st.replication.orderedApply).toBe(true)
    expect(st.replication.nextIndexRetried).toBe(true)
    expect(st.replication.minorityBlocked).toBe(true)
    expect(st.replication.staleLeaderRejected).toBe(true)
    expect(st.safety.noSplitBrainWrite).toBe(true)
    expect(st.gossip.convergesClean).toBe(true)
    expect(st.gossip.gapNotConverged).toBe(true)
    expect(st.gossip.gapReadStale).toBe(true)
    expect(st.gossip.noBound).toBe(true)
    expect(st.verdict.electionTermsMonotonic).toBe(true)
    expect(st.verdict.gossipNoConvergenceBound).toBe(true)
  })
})
