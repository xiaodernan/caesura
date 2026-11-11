import { describe, it, expect } from 'vitest'
import {
  LOCK_DEFAULTS,
  LOCK_PROTOCOLS,
  LOCK_SCENARIOS,
  createRedisSetnxLock,
  createRedlock,
  createEtcdLeaseLock,
  runDistributedLockScenario,
  compareDistributedLock,
  distributedLockStudy,
  dlSnapshot,
} from '../../scripts/caesura-distributed-lock.mjs'

/** 固定时钟 + 固定随机：本件是确定性故障场景结构计数、非墙钟跑分，注入基线不影响任何判词。 */
const fixed = () => () => 0
const fixedRand = () => {
  let x = 0x9e3779b9 >>> 0
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 }
}
const inj = () => ({ now: fixed(), rand: fixedRand() })
const riggedScenarios = () => LOCK_SCENARIOS.map((s) => ({ id: s.id, label: s.label, fault: {} }))

describe('KI-508 分布式锁与租约：单 Redis SETNX+TTL / Redlock 多数派 / etcd Lease+Fencing 三协议诚实权衡', () => {
  it('① 缺省参数冻结、10 枚值导出齐全、三协议/六场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(LOCK_DEFAULTS)).toBe(true)
    expect(LOCK_PROTOCOLS.map((p) => p.short)).toEqual(['SETNX', 'Redlock', 'ETCD'])
    expect(LOCK_SCENARIOS.map((s) => s.id)).toEqual([
      'allOk', 'gcPause', 'clockDrift', 'nodeDown', 'partitionMinority', 'staleFencing',
    ])
    for (const fn of [
      createRedisSetnxLock, createRedlock, createEtcdLeaseLock, runDistributedLockScenario,
      compareDistributedLock, distributedLockStudy, dlSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(LOCK_DEFAULTS.instances).toBe(5)
    expect(LOCK_DEFAULTS.nodes.length).toBe(5)
    expect(LOCK_DEFAULTS.ttlMs).toBeGreaterThan(0)
    expect(LOCK_DEFAULTS.seed).toBeGreaterThan(0)
  })

  /* ---------------- ① 单 Redis SETNX + TTL ---------------- */
  it('② SETNX 单实例：一次 RTT 最低延迟 quorum=1、活着时互斥', () => {
    const c = createRedisSetnxLock(inj())
    const a = c.acquire('alice')
    expect(a.acquired).toBe(true)
    expect(a.latency).toBe(1)
    expect(a.quorum).toBe(1)
    expect(a.fencingToken).toBe(0)                // 没有 fencing
    const b = c.acquire('bob')                    // 锁还活着 ⇒ 抢不到
    expect(b.acquired).toBe(false)
    expect(b.reason).toBe('held')
    expect(c.stats().acquires).toBe(1)
  })

  it('③ SETNX TTL 到期自动释放（注入走时时钟，不依赖真实墙钟）', () => {
    let t = 0
    const c = createRedisSetnxLock({ now: () => t, ttlMs: 100 })
    c.acquire('a')
    t = 50
    expect(c.acquire('b').acquired).toBe(false)   // 未到期仍被占
    t = 101
    const r = c.acquire('b')
    expect(r.acquired).toBe(true)
    expect(c.stats().ttlExpires).toBe(1)
  })

  it('④ SETNX GC 暂停双主写脏：TTL 在旧主仍以为持锁时耗尽 ⇒ 新主上位 + 旧写落库', () => {
    const c = createRedisSetnxLock(inj())
    c.acquire('old')
    const n = c.acquire('new', { afterExpiry: true })
    expect(n.acquired).toBe(true)
    expect(c.stats().doubleOwners).toBe(1)
    const w = c.write('old', { stale: true })
    expect(w.written).toBe(true)
    expect(w.fenced).toBe(false)
    expect(c.stats().dirtyWrites).toBe(1)
  })

  it('⑤ SETNX 单点宕机即全盘不可用；release 后可重新加锁', () => {
    const c = createRedisSetnxLock(inj())
    expect(c.acquire('a', { nodeDown: true }).acquired).toBe(false)
    expect(c.stats().blockedAcquires).toBe(1)
    c.acquire('a')
    expect(c.release('a').released).toBe(true)
    expect(c.acquire('b').acquired).toBe(true)
  })

  /* ---------------- ② Redlock ---------------- */
  it('⑥ Redlock 5 实例 quorum=3、多数派加锁；少数实例宕机仍可加锁（容错）', () => {
    const c = createRedlock(inj())
    expect(c.quorum).toBe(3)
    expect(c.instances).toBe(5)
    const a = c.acquire('a')
    expect(a.acquired).toBe(true)
    expect(a.acks).toBe(3)
    expect(a.fencingToken).toBe(0)                // Redlock 也没有 fencing
    const b = createRedlock(inj()).acquire('b', { nodeDown: true }) // 挂 2 剩 3 = quorum
    expect(b.acquired).toBe(true)
  })

  it('⑦ Redlock 多数往返延迟居中（latency=quorum，非 SETNX 的单 RTT）', () => {
    expect(createRedlock(inj()).acquire('a').latency).toBe(3)
    expect(createRedisSetnxLock(inj()).acquire('a').latency).toBe(1)
  })

  it('⑧ Redlock 墙钟漂移 ⇒ 两客户端各凑齐多数、双主写脏（不站队论战、只量代价）', () => {
    const c = createRedlock(inj())
    c.acquire('c1')
    const drift = c.acquire('c2', { clockDrift: true })
    expect(drift.acquired).toBe(true)
    expect(drift.clockDrift).toBe(true)
    expect(drift.doubleOwners).toBe(1)
    const w = c.write('c1', { stale: true })       // 无 fencing ⇒ 旧写落库
    expect(w.fenced).toBe(false)
    expect(c.stats().dirtyWrites).toBe(1)
    expect(c.stats().clockDrifts).toBe(1)
  })

  it('⑨ Redlock 客户端落少数派分区（连不足 quorum）⇒ 拒加锁', () => {
    const c = createRedlock(inj())
    const r = c.acquire('a', { partitionMinority: true })
    expect(r.acquired).toBe(false)
    expect(r.reason).toBe('minority-partition')
    expect(c.stats().blockedAcquires).toBe(1)
  })

  /* ---------------- ③ etcd Lease + Fencing ---------------- */
  it('⑩ etcd 5 节点 quorum=3、Lease acquire 发单调递增 fencingToken', () => {
    const c = createEtcdLeaseLock(inj())
    expect(c.quorum).toBe(3)
    const a1 = c.acquire('old')
    expect(a1.acquired).toBe(true)
    expect(a1.fencingToken).toBe(1)
    const a2 = c.acquire('new', { forceTakeover: true })
    expect(a2.fencingToken).toBe(2)
    expect(c.currentToken).toBe(2)
  })

  it('⑪ Fencing 真判据：旧 token 的写被数值比较拒绝、不产生脏写', () => {
    const c = createEtcdLeaseLock(inj())
    const a1 = c.acquire('old')
    c.acquire('new', { forceTakeover: true })
    const stale = c.write('old', { token: a1.fencingToken! })
    expect(stale.written).toBe(false)
    expect(stale.fenced).toBe(true)
    expect(stale.reason).toBe('stale-fencing-token')
    expect(stale.token).toBe(1)
    expect(stale.currentToken).toBe(2)
    expect(c.stats().staleWritesRejected).toBe(1)
    expect(c.stats().dirtyWrites).toBe(0)         // 这是 fencing 相对裸租约的价值
    // 更新 token 的写正常落库
    const fresh = c.write('new', { token: 2 })
    expect(fresh.written).toBe(true)
  })

  it('⑫ Fencing release 也需带 token：旧主 release 不得踢掉持更新 token 的新主', () => {
    const c = createEtcdLeaseLock(inj())
    c.acquire('old')
    c.acquire('new', { forceTakeover: true })
    const staleRelease = c.release('old', { token: 1 })
    expect(staleRelease.released).toBe(false)
    expect(staleRelease.reason).toBe('stale-fencing-token')
    expect(c.stats().leaseOwner).toBe('new')
  })

  it('⑬ etcd 续租心跳：TTL 内 renew 成功、过期租约不可续（注入走时时钟）', () => {
    let t = 0
    const c = createEtcdLeaseLock({ now: () => t, ttlMs: 100 })
    c.acquire('a')
    t = 50
    expect(c.renew('a').renewed).toBe(true)
    expect(c.stats().renewals).toBe(1)
    t = 151
    expect(c.renew('a').renewed).toBe(false)
    expect(c.stats().leaseExpires).toBeGreaterThan(0)
  })

  it('⑭ etcd 少数派分区凑不齐 quorum ⇒ CP 拒加锁；少数节点宕机 ⇒ 容错成功', () => {
    const c = createEtcdLeaseLock(inj())
    const minority = c.acquire('a', { partitionMinority: true })
    expect(minority.acquired).toBe(false)
    expect(minority.reason).toBe('minority-partition')
    expect(createEtcdLeaseLock(inj()).acquire('b', { nodeDown: true }).acquired).toBe(true)
  })

  it('⑮ etcd 锁状态经 Raft 多数派复制 ⇒ 延迟最高（latency/raftRounds=quorum）', () => {
    const c = createEtcdLeaseLock(inj())
    const a = c.acquire('a')
    expect(a.latency).toBe(3)
    expect(a.raftRounds).toBe(3)
    expect(c.stats().raftRounds).toBe(3)
    // 诚实：Raft 逻辑租约不依赖实例墙钟 ⇒ 漂移不中
    expect(c.acquire('b', { forceTakeover: true, clockDrift: true }).clockDriftTolerated).toBe(true)
  })

  /* ---------------- ④ 场景编排 + 三难 ---------------- */
  it('⑯ 单协议 × 单场景统一读数：runDistributedLockScenario 形状齐、故障映射诚实', () => {
    const ok = runDistributedLockScenario({ ...inj(), protocol: 'SETNX', scenario: { id: 'allOk', fault: {} } })
    for (const k of ['protocol', 'scenario', 'acquired', 'doubleOwners', 'dirtyWrites', 'blockedAcquires', 'staleWritesRejected', 'fencedProtected', 'mutualExcluded', 'latency', 'quorum', 'messages', 'detail']) {
      expect(k in ok).toBe(true)
    }
    // gcPause 只打 SETNX 的双主，不打 Redlock/etcd
    expect(runDistributedLockScenario({ ...inj(), protocol: 'SETNX', scenario: { id: 'gcPause', fault: { at: 'gcPause' } } }).doubleOwners).toBeGreaterThan(0)
    expect(runDistributedLockScenario({ ...inj(), protocol: 'Redlock', scenario: { id: 'gcPause', fault: { at: 'gcPause' } } }).doubleOwners).toBe(0)
    // clockDrift 只打 Redlock
    expect(runDistributedLockScenario({ ...inj(), protocol: 'Redlock', scenario: { id: 'clockDrift', fault: { at: 'clockDrift' } } }).doubleOwners).toBeGreaterThan(0)
    expect(runDistributedLockScenario({ ...inj(), protocol: 'ETCD', scenario: { id: 'clockDrift', fault: { at: 'clockDrift' } } }).doubleOwners).toBe(0)
  })

  it('⑰ 六场景三难向量：SETNX=001 / Redlock=010 / ETCD=110，三者互异、无一 111', () => {
    const cmp = compareDistributedLock(inj())
    expect(cmp.protocols).toEqual(['SETNX', 'Redlock', 'ETCD'])
    expect(cmp.scenarios.map((s) => s.id)).toEqual(LOCK_SCENARIOS.map((s) => s.id))
    expect(cmp.trilemmaVectors).toEqual({ SETNX: '001', Redlock: '010', ETCD: '110' })
    const vecs = Object.values(cmp.trilemmaVectors)
    expect(new Set(vecs).size).toBe(3)
    expect(vecs.some((v) => v === '111')).toBe(false)
  })

  it('⑱ 判词逐条真：三协议软肋各就各位、noUniversalWinner 真', () => {
    const v = compareDistributedLock(inj()).verdict
    const keys: Array<keyof typeof v> = [
      'setnxGcPauseDoubleOwner', 'setnxSinglePointDown', 'setnxLowLatencyOnly',
      'redlockClockDriftDoubleOwner', 'redlockToleratesNodeDown', 'redlockMinorityRefuses', 'redlockNoFencing',
      'etcdNeverDirty', 'etcdToleratesNodeDown', 'etcdMinorityRefusesCP', 'etcdFencingRejectsStale', 'etcdPaysQuorumLatency',
      'trilemmaDistinguishes', 'noProtocolWinsAll', 'noUniversalWinner',
    ]
    for (const k of keys) expect(v[k]).toBe(true)
  })

  it('⑲ 可证伪：rigged 抹掉软肋（单实例/单节点 + 六场景故障全置空）⇒ 三协议全退化为 111、三判词翻 false', () => {
    const cmp = compareDistributedLock({ ...inj(), instances: 1, nodes: ['n1'], scenarios: riggedScenarios() })
    expect(cmp.trilemmaVectors).toEqual({ SETNX: '111', Redlock: '111', ETCD: '111' })
    expect(cmp.verdict.trilemmaDistinguishes).toBe(false)
    expect(cmp.verdict.noProtocolWinsAll).toBe(false)
    expect(cmp.verdict.noUniversalWinner).toBe(false)
  })

  it('⑳ 故障映射诚实：不打不相关软肋、fencedProtected 只在 etcd 真拒旧写时亮', () => {
    const cmp = compareDistributedLock(inj())
    // staleFencing：etcd 拒旧写亮护、SETNX/Redlock 无 fencing 落库脏写
    expect(cmp.matrix.ETCD!.scenarios.staleFencing!.fencedProtected).toBe(true)
    expect(cmp.matrix.ETCD!.scenarios.staleFencing!.dirtyWrites).toBe(0)
    expect(cmp.matrix.SETNX!.scenarios.staleFencing!.fencedProtected).toBe(false)
    expect(cmp.matrix.SETNX!.scenarios.staleFencing!.dirtyWrites).toBeGreaterThan(0)
    expect(cmp.matrix.Redlock!.scenarios.staleFencing!.dirtyWrites).toBeGreaterThan(0)
    // nodeDown：SETNX 单点阻、Redlock/etcd 容错成
    expect(cmp.matrix.SETNX!.scenarios.nodeDown!.acquired).toBe(false)
    expect(cmp.matrix.Redlock!.scenarios.nodeDown!.acquired).toBe(true)
    expect(cmp.matrix.ETCD!.scenarios.nodeDown!.acquired).toBe(true)
  })

  /* ---------------- ⑤ study / snapshot ---------------- */
  it('㉑ study 汇总：四探针全真、builtAt 走注入时钟、verdict 合流判词齐', () => {
    const study = distributedLockStudy({ ...inj(), now: () => 4242 })
    expect(study.generator).toBe('caesura-distributed-lock')
    expect(study.builtAt).toBe(4242)
    for (const k of ['mutexWhileLive', 'ttlAutoRelease', 'gcPauseDoubleOwner', 'singlePointDown', 'noFencing']) expect(study.setnx[k as keyof typeof study.setnx]).toBe(true)
    expect(study.redlock.quorumAcquire).toBe(true)
    expect(study.redlock.quorum).toBe(3)
    expect(study.fencing.tokenMonotonic).toBe(true)
    expect(study.fencing.rejectsStaleWrite).toBe(true)
    expect(study.fencing.noDirtyOnStale).toBe(true)
    expect(study.verdict.noUniversalWinner).toBe(true)
    expect(study.verdict.fencingTokenMonotonic).toBe(true)
    expect(study.verdict.fencingMinorityRefusesCP).toBe(true)
  })

  it('㉒ snapshot 只读结构：三行 × 六场景、config/verdict/probes 齐、JSON 往返', () => {
    const snap = dlSnapshot(distributedLockStudy(inj()))
    expect(snap).not.toBeNull()
    expect(snap!.rows.length).toBe(3)
    for (const row of snap!.rows) expect(row.scenarios.length).toBe(6)
    expect(snap!.config.protocols).toEqual(['SETNX', 'Redlock', 'ETCD'])
    expect(snap!.config.scenarios.map((s) => s.id)).toEqual(LOCK_SCENARIOS.map((s) => s.id))
    expect(snap!.setnx.noFencing).toBe(true)
    expect(snap!.fencing.fencedProtected).toBe(true)
    expect(snap!.verdict.noUniversalWinner).toBe(true)
    const round = JSON.parse(JSON.stringify(snap))
    expect(round.trilemmaVectors).toBeUndefined()  // 向量在 study.comparison，不在 snapshot（snapshot 用 rows[].trilemma）
    expect(round.rows.map((r: any) => `${r.protocol}:${Number(r.trilemma.mutualExclusion)}${Number(r.trilemma.partialFaultTolerance)}${Number(r.trilemma.lowLatency)}`)).toEqual(['SETNX:001', 'Redlock:010', 'ETCD:110'])
  })

  it('㉓ dlSnapshot null/undefined 入参诚实降级为 null', () => {
    expect(dlSnapshot(null)).toBeNull()
    expect(dlSnapshot(undefined)).toBeNull()
  })

  it('㉔ 注入确定性：同注入两次 study 的 trilemmaVectors/verdict/探针逐字一致', () => {
    const a = distributedLockStudy(inj())
    const b = distributedLockStudy(inj())
    expect(a.comparison.trilemmaVectors).toEqual(b.comparison.trilemmaVectors)
    expect(a.verdict).toEqual(b.verdict)
    expect(a.setnx).toEqual(b.setnx)
    expect(a.redlock).toEqual(b.redlock)
    expect(a.fencing).toEqual(b.fencing)
    expect(a.builtAt).toBe(b.builtAt)
  })
})
