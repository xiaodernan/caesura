import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DQ_DEFAULTS,
  DQ_PROTOCOLS,
  DQ_SCENARIOS,
  compareDelayQueue,
  createDelayQueueEvidence,
  createMinHeapDelayQueue,
  createRedisZsetDelayQueue,
  createTimingWheel,
  delayQueueSnapshot,
  delayQueueStudy,
} from '../../scripts/caesura-delay-queue.mjs'

/**
 * KI-518 延迟消息队列调度三协议诚实权衡 · 单元测试。
 * 全部进程内确定性教学状态机，headless 可证；不接真 MQ/真 Redis/真 Lua。
 */

describe('KI-518 延迟消息队列：时间轮 / 最小堆 / Redis ZSET 三协议权衡', () => {
  it('默认导出：DQ_DEFAULTS / DQ_PROTOCOLS / DQ_SCENARIOS', () => {
    expect(DQ_DEFAULTS.tickMs).toBe(1000)
    expect(DQ_PROTOCOLS).toEqual(['TimingWheel', 'MinHeap', 'RedisZset'])
    expect(DQ_SCENARIOS).toEqual(['allOk', 'tickSkew', 'farFuture', 'manyCancels', 'workerRestart', 'concurrentWorkers'])
  })

  describe('createTimingWheel', () => {
    it('schedule + advance：到期任务按 tick 粒度发射', () => {
      const w = createTimingWheel({ tickMs: 100, wheelSlots: 8, now: 0 })
      w.schedule(1000, 'task-a')
      expect(w.pending()).toBe(1)
      w.advance(1100)
      expect(w.stats().fired).toBe(1)
      expect(w.stats().lateMs).toBeLessThanOrEqual(100)
    })

    it('cancel：惰性墓碑，到期不再发射', () => {
      const w = createTimingWheel({ tickMs: 100, wheelSlots: 8, now: 0 })
      const id = w.schedule(500, 'x')
      w.cancel(id)
      w.advance(2000)
      expect(w.stats().fired).toBe(0)
      expect(w.pending()).toBe(0)
    })

    it('tick 粒度晚点可测量（skew 对齐末端任务）', () => {
      const w = createTimingWheel({ tickMs: 1000, wheelSlots: 8, now: 0 })
      w.schedule(333, 'skew')
      w.advance(200000)
      expect(w.stats().lateMs).toBeGreaterThan(0)
    })

    it('zeroTick（rigged）：晚点恒 0', () => {
      const w = createTimingWheel({ tickMs: 1, wheelSlots: 8, now: 0 })
      w.schedule(333, 'skew')
      w.advance(200000)
      expect(w.stats().lateMs).toBe(0)
    })

    it('rescanSweeps > 0（远期任务反复整圈巡检计数）', () => {
      const w = createTimingWheel({ tickMs: 1000, wheelSlots: 4, now: 0 })
      for (let i = 0; i < 4; i++) w.schedule(50000 + i * 1000, 'far')
      w.advance(200000)
      expect(w.stats().rescanSweeps).toBeGreaterThan(0)
    })
  })

  describe('createMinHeapDelayQueue', () => {
    it('堆按 dueAt 严格有序弹出', () => {
      const h = createMinHeapDelayQueue({ now: 0 })
      h.schedule(900, 'a')
      h.schedule(100, 'b')
      h.schedule(500, 'c')
      const out = h.advance(100000)
      expect(out.map((t) => t.dueAt)).toEqual([100, 500, 900])
    })

    it('tickSkew：堆顶即绝对最近到期，lateMs 恒 0', () => {
      const h = createMinHeapDelayQueue({ now: 0 })
      h.schedule(1333, 'skew')
      h.schedule(4666, 'skew2')
      h.advance(100000)
      expect(h.stats().lateMs).toBe(0)
    })

    it('comparisons > 0（O(log n) 账目可读）', () => {
      const h = createMinHeapDelayQueue({ now: 0 })
      for (let i = 0; i < 20; i++) h.schedule(1000 + i * 100, 't')
      h.advance(100000)
      expect(h.stats().comparisons).toBeGreaterThan(0)
    })

    it('cancel：墓碑跳过，不发射', () => {
      const h = createMinHeapDelayQueue({ now: 0 })
      const id = h.schedule(100, 'x')
      h.cancel(id)
      h.advance(100000)
      expect(h.stats().fired).toBe(0)
    })

    it('peek：返回当前堆顶', () => {
      const h = createMinHeapDelayQueue({ now: 0 })
      h.schedule(900, 'a')
      h.schedule(100, 'b')
      h.schedule(500, 'c')
      expect(h.peek()?.dueAt).toBe(100)
    })
  })

  describe('createRedisZsetDelayQueue', () => {
    it('schedule + poll：到期批量捞、中心 RTT 计数', () => {
      const q = createRedisZsetDelayQueue({ now: 0, pollIntervalMs: 100 })
      q.schedule(150, 'a')
      q.schedule(350, 'b')
      q.setNow(200)
      const fired = q.poll()
      expect(fired.map((t) => t.id)).toEqual([1])
      expect(q.stats().centerRounds).toBeGreaterThan(0)
    })

    it('idlePolls：空轮也有中心 RTT 记账', () => {
      const q = createRedisZsetDelayQueue({ now: 0, pollIntervalMs: 100 })
      q.schedule(100000, 'far')
      q.poll()
      expect(q.stats().idlePolls).toBe(1)
      expect(q.stats().centerRounds).toBe(1)
    })

    it('concurrentWorkers（atomicPick=false）：同任务双捞 ⇒ duplicatePickups > 0', () => {
      const q = createRedisZsetDelayQueue({ now: 0, atomicPick: false })
      q.schedule(10, 'x')
      q.setNow(100)
      q.poll()
      expect(q.stats().duplicatePickups).toBeGreaterThan(0)
    })

    it('workerRestart（durable 后端）：restore 不丢 pending', () => {
      const q = createRedisZsetDelayQueue({ now: 0 })
      q.schedule(100000, 'a')
      const r = q.restore()
      expect(r.lostOnRestart).toBe(0)
      expect(q.stats().lostOnRestart).toBe(0)
    })

    it('workerRestart（非持久化后端）：restore 报告 pending 全丢', () => {
      const backend = {
        durable: false, _store: new Map<number, number>(),
        zadd(k: string, s: number) { this._store.set(Number(k), s); return 1 },
        zrem(k: string) { return this._store.delete(Number(k)) ? 1 : 0 },
        zrangebyscore(max: number) { return [...this._store.entries()].filter(([, s]) => s <= max).map(([k, s]) => ({ key: String(k), score: s })) },
        zcard() { return this._store.size },
      }
      const q = createRedisZsetDelayQueue({ now: 0, backend })
      q.schedule(100000, 'a')
      q.schedule(100000, 'b')
      const r = q.restore()
      expect(r.lostOnRestart).toBe(2)
    })
  })

  describe('compareDelayQueue / delayQueueStudy', () => {
    it('study 形状：六场景 × 三协议，cell 全字段在', () => {
      const s = delayQueueStudy({})
      expect(s.rows.map((r) => r.protocol)).toEqual(['TimingWheel', 'MinHeap', 'RedisZset'])
      for (const row of s.rows) {
        expect(row.scenarios.map((c) => c.id)).toEqual(DQ_SCENARIOS)
        for (const c of row.scenarios) {
          expect(typeof c.lateMs).toBe('number')
          expect(typeof c.opUnits).toBe('number')
          expect(typeof c.lowCost).toBe('boolean')
          expect(typeof c.punctual).toBe('boolean')
          expect(typeof c.sharedDurable).toBe('boolean')
        }
      }
    })

    it('study 是纯数据 + 与 seed 固定的双跑字节一致', () => {
      const a = delayQueueStudy({ seed: 518 })
      const b = delayQueueStudy({ seed: 518 })
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it('默认 vectors = 100/010/001，三者互异、noUniversalWinner=true', () => {
      const s = delayQueueStudy({})
      expect(s.vectors).toEqual({ TimingWheel: '100', MinHeap: '010', RedisZset: '001' })
      expect(s.verdict.trilemmaDistinguishes).toBe(true)
      expect(s.verdict.noUniversalWinner).toBe(true)
    })

    it('rigged（zeroTick+freeHeapOps+sharedBackend）：现算 111/111/001、判词翻 false', () => {
      const s = delayQueueStudy({ rigged: true })
      // 三开关抹掉时间轮 tick 晚点、堆 O(log n)、进程内重启丢 ⇒ 前两协议 cell 判定位真翻 111；
      // ZSET 轮询周期晚点 + 中心 RTT 无对应开关可抹 ⇒ 保留 001，向量由 trilemma 现算、不硬覆盖。
      expect(s.vectors).toEqual({ TimingWheel: '111', MinHeap: '111', RedisZset: '001' })
      expect(s.verdict.noUniversalWinner).toBe(false)
      expect(s.verdict.trilemmaDistinguishes).toBe(false)
      // 向量逐字来自 row.trilemma（表格与判词同源，杜绝撒谎式硬覆盖）
      for (const row of s.rows) {
        const recomputed = `${Number(row.trilemma.lowCost)}${Number(row.trilemma.punctual)}${Number(row.trilemma.sharedDurable)}`
        expect(s.vectors[row.protocol as keyof typeof s.vectors]).toBe(recomputed)
      }
      expect(s.rows[2].trilemma).toEqual({ lowCost: false, punctual: false, sharedDurable: true })
    })

    it('compareDelayQueue 别名 === delayQueueStudy（KI-513 同构 API）', () => {
      expect(compareDelayQueue).toBe(delayQueueStudy)
      expect(JSON.stringify(compareDelayQueue({ seed: 7 }))).toBe(JSON.stringify(delayQueueStudy({ seed: 7 })))
    })

    it('单开 zeroTick 只让 TimingWheel 到期精确（不连坐）', () => {
      const s = delayQueueStudy({ zeroTick: true })
      expect(s.vectors.TimingWheel).toBe('110')
      expect(s.vectors.MinHeap).toBe('010')
      expect(s.vectors.RedisZset).toBe('001')
      expect(s.verdict.noUniversalWinner).toBe(true)
    })

    it('workerRestart 只罚 sharedDurable 不连带罚 punctual（正交化）', () => {
      const s = delayQueueStudy({})
      const heapSkew = s.rows[1].scenarios.find((c) => c.id === 'tickSkew')!
      const heapRestart = s.rows[1].scenarios.find((c) => c.id === 'workerRestart')!
      expect(heapSkew.lateMs).toBe(0)
      expect(heapSkew.punctual).toBe(true)
      expect(heapRestart.sharedDurable).toBe(false)
      expect(heapRestart.punctual).toBe(true)
    })

    it('workRestart：进程内三件套 pending 全丢（教学模型自洽）', () => {
      const s = delayQueueStudy({})
      expect(s.rows[0].scenarios.find((c) => c.id === 'workerRestart')!.lostOnRestart).toBeGreaterThan(0)
      expect(s.rows[1].scenarios.find((c) => c.id === 'workerRestart')!.lostOnRestart).toBeGreaterThan(0)
      expect(s.rows[2].scenarios.find((c) => c.id === 'workerRestart')!.lostOnRestart).toBe(0)
    })

    it('concurrentWorkers：非原子摘取 ⇒ duplicatePickups > 0', () => {
      const s = delayQueueStudy({})
      expect(s.rows[2].scenarios.find((c) => c.id === 'concurrentWorkers')!.duplicatePickups).toBeGreaterThan(0)
    })
  })

  describe('delayQueueSnapshot / evidence / CLI', () => {
    it('delayQueueSnapshot：形状完整，null 输入回 null', () => {
      const s = delayQueueStudy({})
      const snap = delayQueueSnapshot(s)!
      expect(snap.config.tasks).toBe(12)
      expect(snap.rows.length).toBe(3)
      expect(snap.builtAt).toBe(s.builtAt)
      expect(delayQueueSnapshot(null as any)).toBeNull()
    })

    it('createDelayQueueEvidence：七枚真件读数齐全且全部真读（接手修 6 处假证据）', () => {
      const e = createDelayQueueEvidence({ seed: 518 })
      expect(e.hashRingNodes).toBe(2)            // distribution().nodes，非 Object.keys(perNode) 巧合
      expect(e.hashRingEmptyNodes).toBe(0)       // distribution().emptyNodes.length（新回读字段）
      expect(e.redisEntries).toBeGreaterThanOrEqual(1) // cache.stats().entries
      expect(e.walLines).toBe(2)                 // 真 append('put',k,v) 3 参 → lines().length
      expect(e.busDelivered).toBe(2)             // 真订阅回调计数
      expect(e.tokenBucketOk).toBe(true)         // 真 allow().allowed（refillPerSec 键真生效）
      expect(e.bplusRangeCount).toBe(30)         // 真 range() 条数
      expect(e.poolAcquired).toBe(2)             // 真 stats().acquired（原硬编码 2，回读数恰同，故另钉一行）
    })

    it('evidence 非硬编码：改 seed / 场景后读数随真件变化（反假证据门）', async () => {
      // 池 acquired 直接读 stats().acquired：多 acquire 一次，真读数必须 +1（硬编码则恒 2 _FAIL_）
      const { createObjectPool } = await import('../../scripts/caesura-hw-perf.mjs')
      const p = createObjectPool({ factory: () => ({ id: 0 }), maxSize: 8 })
      p.acquire(); p.acquire(); p.acquire(); p.release({ id: 1 })
      expect(p.stats().acquired).toBe(3)
      // hashRing virtualNodes/salt 真生效：不同 seed 的分布比例可变（salt 进哈希）
      const { createHashRing } = await import('../../scripts/caesura-consistent-hash.mjs')
      const d1 = createHashRing({ virtualNodes: 24, salt: '1' })
      d1.addNode('a'); d1.addNode('b')
      const r1 = d1.distribution(Array.from({ length: 12 }, (_, i) => `dq:${i}`))
      expect(r1.nodes).toBe(2)
      expect(Array.isArray(r1.emptyNodes)).toBe(true)
    })

    it('CLI 双跑字节一致 + rigged 向量现算（教学证据门）', () => {
      const cli = join(process.cwd(), 'scripts', 'caesura-delay-queue.mjs')
      const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
      const a = run()
      const b = run()
      expect(a).toBe(b)
      expect(a).toContain('vectors')
      expect(a).toContain('"TimingWheel":"100"')
      const rigged = run('--rigged')
      expect(rigged).toContain('"TimingWheel":"111"')
      expect(rigged).toContain('"RedisZset":"001"') // ZSET 轮询软肋三开关抹不掉，不硬覆盖全 111
      expect(rigged).toContain('noUniversalWinner=false')
    })
  })
})
