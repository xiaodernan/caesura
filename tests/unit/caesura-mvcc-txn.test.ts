import { describe, it, expect } from 'vitest'
import {
  MV_DEFAULTS,
  ISOLATION_LEVELS,
  ANOMALIES,
  createVersionChain,
  createMvccStore,
  createLockManager,
  detectDeadlock,
  runSchedule,
  compareIsolationLevels,
  mvccStudy,
  mvSnapshot,
} from '../../scripts/caesura-mvcc-txn.mjs'

/** 固定时钟：逻辑时钟基线，内部单调 tick；注入即可确定性。 */
const fixed = () => () => 0

describe('KI-505 事务与并发控制：MVCC + 五档隔离异常矩阵 + 行锁 2PL 死锁检测', () => {
  it('① 默认参数冻结、11 枚值导出齐全、五档/五类常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(MV_DEFAULTS)).toBe(true)
    expect(ISOLATION_LEVELS.map((l) => l.short)).toEqual(['RU', 'RC', 'RR', 'SI', 'SER'])
    expect(ANOMALIES.map((a) => a.id)).toEqual(['dirtyRead', 'nonRepeatableRead', 'phantom', 'lostUpdate', 'writeSkew'])
    for (const fn of [
      createVersionChain, createMvccStore, createLockManager, detectDeadlock,
      runSchedule, compareIsolationLevels, mvccStudy, mvSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(MV_DEFAULTS.victimPolicy).toBe('youngest')
  })

  it('② 版本链 MVCC 可见性：commitTs<=readTs、未提交仅己见、tombstone 表删除', () => {
    const ch = createVersionChain()
    ch.append({ value: 100, beginTs: 0, commitTs: 1, writerTxn: 'seed' })
    ch.append({ value: 200, beginTs: 2, commitTs: 5, writerTxn: 'T1' })
    ch.append({ value: 999, beginTs: 6, commitTs: null, writerTxn: 'T2' }) // 未提交
    expect(ch.visibleAt(3, 'T9').value).toBe(100)      // 快照 3 只见 v1
    expect(ch.visibleAt(7, 'T9').value).toBe(200)      // 快照 7 见已提交 v2、跳过未提交 v3
    const own = ch.visibleAt(7, 'T2')                   // T2 读己之写
    expect(own.value).toBe(999)
    expect(own.uncommittedFrom).toBeNull()
    const dirty = ch.visibleAt(7, 'T9', true)           // RU 连别人未提交也认
    expect(dirty.value).toBe(999)
    expect(dirty.uncommittedFrom).toBe('T2')
    ch.append({ value: undefined, beginTs: 8, commitTs: 9, writerTxn: 'T3', tombstone: true })
    expect(ch.visibleAt(10, 'T9').deleted).toBe(true)   // tombstone 可见 ⇒ 该快照看不到此行
    expect(ch.visibleAt(10, 'T9').found).toBe(false)
  })

  it('③ 版本链 compact 按水位回收：低水位（长事务）保留多、高水位回收多', () => {
    const build = () => {
      const ch = createVersionChain()
      for (let i = 1; i <= 10; i++) ch.append({ value: i, beginTs: i - 1, commitTs: i, writerTxn: 'seed' })
      return ch
    }
    const long = build().compact(2)
    const clean = build().compact(9)
    expect(long.removed).toBeLessThan(clean.removed)
    expect(long.kept).toBeGreaterThan(clean.kept)
    expect(long.kept).toBe(10)   // 水位 2：只回收 <2 的 1 版里除基线外……10 版中 <2 仅 commitTs=1
    expect(clean.kept).toBe(3)   // 水位 9：<9 的 8 版只留基线 1 版 + >=9 的 2 版
    // 未提交版永不回收
    const ch = build()
    ch.append({ value: 0, beginTs: 10, commitTs: null, writerTxn: 'T9' })
    ch.compact(999)
    expect(ch.visibleAt(999, 'T9').value).toBe(0)
  })

  it('④ MVCC store 基本事务：seed 基线 / read 快照 / write 未提交对己可见 / commit 落定 / rollback 丢弃', () => {
    const s = createMvccStore({ now: fixed() })
    s.seed('A', 100)
    const t1 = s.begin('read-committed')
    expect(s.read(t1, 'A').value).toBe(100)
    s.write(t1, 'A', 150)
    expect(s.read(t1, 'A').value).toBe(150)             // 读己之写
    const outsider = s.begin('read-committed')
    expect(s.read(outsider, 'A').value).toBe(100)       // 别人看不到未提交
    expect(s.commit(t1).committed).toBe(true)
    expect(s.read(outsider, 'A').value).toBe(150)       // RC 每语句新视图，提交后可见
    const t2 = s.begin('read-committed')
    s.write(t2, 'A', 200)
    expect(s.rollback(t2).rolledBack).toBe(true)
    expect(s.read(outsider, 'A').value).toBe(150)       // 回滚丢弃
    expect(s.stats().committed).toBe(1)
    expect(s.stats().rollbacks).toBe(1)
  })

  it('⑤ 逻辑时钟注入确定性：now 固定时 beginTs/commitTs 严格单调、snapshot builtAt=注入值', () => {
    const s = createMvccStore({ now: () => 42 })
    const a = s.begin('read-committed')
    const b = s.begin('read-committed')
    expect(b.beginTs!).toBe(a.beginTs! + 1)
    s.write(b, 'X', 1)
    const c = s.commit(b)
    expect(c.commitTs!).toBeGreaterThan(b.beginTs!)
    expect(s.snapshot(42).builtAt).toBe(42)           // builtAt 由显式 t 注入（同 study 的 now）
  })

  it('⑥ S/X 锁兼容矩阵：S-S 兼容、S-X/X-S/X-X 冲突；读视图按锁模式记 waitFor', () => {
    const m = createLockManager()
    expect(m.acquire('T1', 'A', 'S').granted).toBe(true)
    expect(m.acquire('T2', 'A', 'S').granted).toBe(true)   // S-S 兼容
    const x = m.acquire('T3', 'A', 'X')
    expect(x.granted).toBe(false)
    expect(x.waitFor!.sort()).toEqual(['T1', 'T2'])
    // 纯兼容矩阵下 S-S 恒兼容：T4 的 S 与已持 S 的 T1/T2 不冲突 ⇒ 放行。
    // 本件**不实现写者优先/公平排队**，排在队列里的 X(T3) 不阻塞后来的 S ⇒ 写饥饿是诚实教学边界。
    expect(m.acquire('T4', 'A', 'S').granted).toBe(true)
  })

  it('⑦ 两阶段锁：growing 释放后进 shrinking，再 acquire 判 2PL 违规', () => {
    const m = createLockManager()
    expect(m.acquire('T1', 'A', 'X').granted).toBe(true)
    expect(m.release('T1', 'A').phase).toBe('shrinking')
    const late = m.acquire('T1', 'B', 'X')
    expect(late.granted).toBe(false)
    expect(late.reason).toBe('2pl-violation')
    expect(m.stats().plViolations).toBe(1)
  })

  it('⑧ wait-for graph 环检测：真 DFS 报 T1↔T2 环并给闭合路径', () => {
    const r = detectDeadlock({ T1: ['T2'], T2: ['T1'] })
    expect(r.hasCycle).toBe(true)
    expect(r.cycle.slice().sort()).toEqual(['T1', 'T2'])
    expect(r.closedCycle[0]).toBe(r.closedCycle[r.closedCycle.length - 1])
    expect(r.nodesVisited).toBeGreaterThanOrEqual(2)
  })

  it('⑨ DFS 非恒真：无环图如实报无环、自环能检出、空图 nodesVisited=0', () => {
    expect(detectDeadlock({ T1: ['T2'], T2: [] }).hasCycle).toBe(false)
    expect(detectDeadlock({ T1: [] }).hasCycle).toBe(false)
    expect(detectDeadlock({ T1: ['T1'] }).hasCycle).toBe(true)
    expect(detectDeadlock({}).nodesVisited).toBe(0)
  })

  it('⑩ 死锁脚本：T1 持 A、T2 持 B 互等 ⇒ 检出 → 选 youngest 牺牲者 → 放锁重解 → 环已破', () => {
    const m = createLockManager({ victim: 'youngest' })
    m.acquire('T1', 'A', 'X')
    m.acquire('T2', 'B', 'X')
    expect(m.acquire('T1', 'B', 'X').granted).toBe(false)
    expect(m.acquire('T2', 'A', 'X').granted).toBe(false)
    expect(m.waitForGraph()).toEqual({ T1: ['T2'], T2: ['T1'] })
    expect(m.detectDeadlock().hasCycle).toBe(true)
    const res = m.abortDeadlock()
    expect(res.resolved).toBe(true)
    expect(res.victim).toBe('T2')                 // T2 更晚 begin ⇒ youngest
    expect(res.regranted).toBeGreaterThanOrEqual(1)
    expect(res.after!.hasCycle).toBe(false)
    expect(m.stats().deadlocks).toBe(1)
  })

  it('⑪ min-locks 策略选牺牲者：持锁更少者被中止', () => {
    const m = createLockManager({ victim: 'min-locks' })
    m.acquire('T1', 'A', 'X'); m.acquire('T1', 'C', 'X') // T1 持 2 把
    m.acquire('T2', 'B', 'X')                             // T2 持 1 把
    m.acquire('T1', 'B', 'X'); m.acquire('T2', 'A', 'X') // 环
    expect(m.pickVictim(m.detectDeadlock().cycle, 'min-locks')).toBe('T2')
  })

  it('⑫ runSchedule 据实记录：RU 脏读调度读到别人未提交值并标 uncommittedFrom', () => {
    const cmp = compareIsolationLevels({ now: fixed() })
    const ruDirty = cmp.matrix.RU.trace.dirtyRead.steps.find((s) => s.t === 'read')!
    expect(ruDirty.uncommittedFrom).toBe('T2')
    expect(ruDirty.value).toBe(200)
    const rcDirty = cmp.matrix.RC.trace.dirtyRead.steps.find((s) => s.t === 'read')!
    expect(rcDirty.value).toBe(100)                  // RC 读已提交基线，挡住脏读
    expect(rcDirty.uncommittedFrom).toBeNull()
  })

  it('⑬ 五档隔离异常矩阵阶梯成立（RU 5 出 → … → SER 0 出，中止递增）', () => {
    const cmp = compareIsolationLevels({ now: fixed() })
    const obs = (l: string, a: string) => cmp.matrix[l as 'RU'].anomalies[a as 'dirtyRead'].observed
    expect(cmp.matrix.RU.observedCount).toBe(5)
    expect(obs('RC', 'dirtyRead')).toBe(false)
    expect(obs('RR', 'nonRepeatableRead')).toBe(false)
    expect(obs('RR', 'phantom')).toBe(false)
    expect(obs('SI', 'lostUpdate')).toBe(false)
    expect(obs('SI', 'writeSkew')).toBe(true)        // 核心：SI 漏写偏斜
    expect(obs('SER', 'writeSkew')).toBe(false)      // 只有 SER 挡住
    expect(cmp.matrix.SER.observedCount).toBe(0)
    expect(cmp.matrix.RU.aborted).toBeLessThan(cmp.matrix.SI.aborted)
    expect(cmp.matrix.SI.aborted).toBeLessThan(cmp.matrix.SER.aborted)
  })

  it('⑭ 诚实判词：不封 Serializable 全面赢家、每句可证伪（注入关掉冲突检测则翻红）', () => {
    const cmp = compareIsolationLevels({ now: fixed() })
    expect(cmp.verdict.matrixWellFormed).toBe(true)
    expect(cmp.verdict.siStopsLostUpdateButLeaksWriteSkew).toBe(true)
    expect(cmp.verdict.serializableCostsMostAborts).toBe(true)
    expect(cmp.verdict.noUniversalWinner).toBe(true)
    // 判词是算出来的、非恒真：注入一条刻意「SI 也成功挡写偏斜」的假调度，siStops... 必翻 false
    const rigged = {
      writeSkew: {
        anomaly: 'writeSkew' as const, label: '写偏斜（人为钉死不产生异常）',
        seed: [{ key: 'A', value: 100 }],
        steps: [{ t: 'begin', txn: 'T1' }, { t: 'read', txn: 'T1', key: 'A' }, { t: 'commit', txn: 'T1' }],
      },
    }
    const riggedCmp = compareIsolationLevels({ now: fixed(), schedules: rigged })
    expect(riggedCmp.verdict.siStopsLostUpdateButLeaksWriteSkew).toBe(false)
  })

  it('⑮ 空集/降级诚实：空链 visibleAt found=false、空调度不除零、空图无环', () => {
    const ch = createVersionChain()
    expect(ch.visibleAt(0, 'T1').found).toBe(false)
    expect(ch.lastCommittedTs()).toBeNull()
    expect(ch.stats().size).toBe(0)
    expect(detectDeadlock({}).hasCycle).toBe(false)
    const cmp = compareIsolationLevels({ now: fixed(), schedules: {} })
    expect(cmp.matrix.RU.observedCount).toBe(0)      // 没调度就没异常，不凭空报
    expect(cmp.matrix.RU.preventedCount).toBe(0)
  })

  it('⑯ mvccStudy / mvSnapshot 纯数据可 JSON 往返、注入 builtAt 确定、含全部读数', () => {
    const a = mvccStudy({ now: () => 777 })
    const b = mvccStudy({ now: () => 777 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))     // 注入确定性
    expect(a.builtAt).toBe(777)
    const snap = mvSnapshot(a)
    expect(snap).not.toBeNull()
    expect(snap!.levels.length).toBe(5)
    expect(snap!.deadlock.detected).toBe(true)
    expect(snap!.deadlock.resolved).toBe(true)
    expect(snap!.deadlock.acyclicProbeNoCycle).toBe(true)
    expect(snap!.twoPhaseLock.lateAcquireBlocked).toBe(true)
    expect(snap!.gc.longTxnRetainsMoreVersions).toBe(true)
    expect(Object.values(snap!.verdict).every(Boolean)).toBe(true)
    expect(JSON.parse(JSON.stringify(snap)).levels.length).toBe(5) // 纯数据可往返
    expect(mvSnapshot(null)).toBeNull()
  })
})
