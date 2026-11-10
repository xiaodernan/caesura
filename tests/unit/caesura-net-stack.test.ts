import { describe, expect, it } from 'vitest'
import {
  createAimdCongestion,
  createCubicCongestion,
  createRtoEstimator,
  createSlidingWindow,
  createSessionTickets,
  createHttpCache,
} from '../../scripts/caesura-net-stack.mjs'

describe('caesura-net-stack (KI-494)', () => {
  // —— ① Reno AIMD ——
  it('① AIMD 慢启动：cwnd 每新 ACK +1（指数逼近 ssthresh），到阈值转拥塞避免', () => {
    const a = createAimdCongestion({ initialCwnd: 1, ssthresh: 4 })
    expect(a.mode).toBe('slow-start')
    expect(a.onAck()).toBe(2)
    expect(a.onAck()).toBe(3)
    expect(a.onAck()).toBe(4)
    expect(a.mode).toBe('congestion-avoidance') // 到阈值
    const c = a.cwnd
    expect(a.onAck()).toBeCloseTo(c + 1 / c) // 加性增 1/cwnd
  })

  it('② AIMD 3 重复 ACK ⇒ 快重传乘性减（cwnd 落 ssthresh、不回 1）', () => {
    const a = createAimdCongestion({ initialCwnd: 8, ssthresh: 16 })
    for (let i = 0; i < 4; i++) a.onAck() // cwnd=12, 拥塞避免
    const before = a.cwnd
    expect(a.onDupAck()).toMatchObject({ fastRetransmit: false })
    expect(a.onDupAck()).toMatchObject({ fastRetransmit: false })
    const r = a.onDupAck() // 第 3 个 ⇒ 触发
    expect(r.fastRetransmit).toBe(true)
    expect(a.cwnd).toBeCloseTo(before / 2)
    expect(a.mode).toBe('congestion-avoidance')
  })

  it('③ AIMD 超时 ⇒ ssthresh=cwnd/2、cwnd 回 1 重进慢启动', () => {
    const a = createAimdCongestion({ initialCwnd: 1, ssthresh: 32 })
    for (let i = 0; i < 10; i++) a.onAck() // cwnd=11
    const before = a.cwnd
    a.onTimeout()
    expect(a.cwnd).toBe(1)
    expect(a.ssthresh).toBeCloseTo(before / 2)
    expect(a.mode).toBe('slow-start')
    expect(a.state().history.some((h) => h.event === 'timeout')).toBe(true)
  })

  // —— ② CUBIC ——
  it('④ CUBIC：W(0)=(1−β)Wmax 与降窗对齐；离 epoch 越久增长越快（凸段）', () => {
    const c = createCubicCongestion({ Wmax: 40, C: 0.4, beta: 0.2, initialCwnd: 1, now: () => 0 })
    const w0 = c.targetAt(0)
    expect(w0).toBeCloseTo(0.8 * 40) // (1−β)·Wmax = 32
    const w5 = c.targetAt(5)
    const w10 = c.targetAt(10)
    expect(w10 - w5).toBeGreaterThan(w5 - w0) // 凸：后段增速更快
  })

  it('⑤ CUBIC 拥塞事件：Wmax 更新、cwnd 乘性减、K 按新 Wmax 重算', () => {
    let t = 0
    const c = createCubicCongestion({ Wmax: 16, C: 0.4, beta: 0.2, now: () => t })
    const k0 = c.K
    t = 10
    for (let i = 0; i < 5; i++) c.onAck() // 长到超越旧 Wmax
    const peak = c.cwnd
    const r = c.onCongestion()
    expect(peak).toBeGreaterThan(16)
    expect(r.Wmax).toBeCloseTo(peak)
    expect(r.cwnd).toBeCloseTo(0.8 * peak)
    expect(c.K).not.toBe(k0) // K 随新 Wmax 变
  })

  // —— ③ RTO / Karn ——
  it('⑥ RTO Jacobson 估计：首样本 SRTT=R/RTTVAR=R/2，RTO=SRTT+4·RTTVAR', () => {
    const r = createRtoEstimator({ minRto: 1, maxRto: 60_000 })
    const v = r.sample(100)
    expect(v.used).toBe(true)
    expect(v.srtt).toBe(100)
    expect(v.rttvar).toBe(50)
    expect(v.rto).toBe(300) // 100 + 4·50
  })

  it('⑦ RTO 平滑：后续样本按 α/β 更新，不跳变', () => {
    const r = createRtoEstimator({ alpha: 0.125, beta: 0.25, minRto: 1, maxRto: 60_000 })
    r.sample(100)
    const v = r.sample(200)
    expect(v.srtt).toBeCloseTo(112.5) // 100 + 0.125·(200−100)
    // RTTVAR 用「更新前的旧 srtt=100」算偏差：0.75·50 + 0.25·|100−200| = 37.5 + 25 = 62.5
    expect(v.rttvar).toBeCloseTo(62.5)
  })

  it('⑧ Karn 算法：重传段 RTT 样本不参与估计，只记 ignored', () => {
    const r = createRtoEstimator({ minRto: 1, maxRto: 60_000 })
    r.sample(100)
    const before = r.current()
    const ignored = r.sample(9999, true)
    expect(ignored.ignored).toBe(true)
    expect(ignored.used).toBe(false)
    expect(r.srtt).toBe(before.srtt) // 没被 9999 污染
    expect(r.ignoredSamples).toBe(1)
  })

  it('⑨ RTO 超时指数退避并钳到 maxRto；收到正常样本复位退避', () => {
    const r = createRtoEstimator({ minRto: 10, maxRto: 80, initialRto: 10 })
    expect(r.onTimeout().rto).toBe(20)
    expect(r.onTimeout().rto).toBe(40)
    expect(r.onTimeout().rto).toBe(80)
    expect(r.onTimeout().rto).toBe(80) // 钳位
    r.sample(50)
    expect(r.current().timeouts).toBe(0) // 复位
  })

  // —— ④ 滑动窗口 ——
  it('⑩ 滑动窗口：窗口满时 send 被 blocked，累计 ACK 推进 base 释放容量', () => {
    const w = createSlidingWindow({ windowSize: 2 })
    expect(w.send('a').sent).toBe(true)
    expect(w.send('b').sent).toBe(true)
    const blocked = w.send('c')
    expect(blocked).toMatchObject({ sent: false, reason: 'window_full' })
    expect(w.inFlight).toBe(2)
    w.ack(0) // 累计确认 seq0
    expect(w.base).toBe(1)
    expect(w.send('c').sent).toBe(true) // 有空位了
  })

  it('⑪ 选择性 ACK：乱序确认进 sack，base 只推进到连续边界，收到缺失段后连带吞掉', () => {
    const w = createSlidingWindow({ windowSize: 6 })
    for (let i = 0; i < 4; i++) w.send(`p${i}`) // seq 0,1,2,3
    w.ack(2, false) // 选择性确认 seq2（乱序）
    w.ack(3, false) // 选择性确认 seq3
    expect(w.state().sack).toEqual([2, 3])
    expect(w.base).toBe(0) // 缺 seq0/1，base 不动
    w.ack(0) // 累计确认 seq0 ⇒ base 推到 1
    expect(w.base).toBe(1)
    w.ack(1, false) // 确认 seq1 ⇒ base 连带吞掉 sack 里连续的 2、3
    expect(w.base).toBe(4)
    expect(w.state().sack).toEqual([])
  })

  // —— ⑤ QUIC 0-RTT ——
  it('⑫ 0-RTT：有效+幂等票据放行 0-RTT，重复 nonce 被防重放拒退 1-RTT', () => {
    const t = createSessionTickets({ now: () => 1000, ttlMs: 90_000 })
    const ticket = t.issue('c1')
    expect(t.accept(ticket)).toMatchObject({ mode: '0-RTT' })
    const replay = t.accept(ticket) // 同 nonce 再来
    expect(replay).toMatchObject({ mode: '1-RTT', reason: 'replay' })
    expect(t.stats().replayRejected).toBe(1)
    expect(t.stats().accepted0Rtt).toBe(1)
  })

  it('⑬ 0-RTT：过期票据 / 非幂等请求退 1-RTT；防重放集合按窗口 reap', () => {
    let now = 1000
    const t = createSessionTickets({ now: () => now, ttlMs: 5000, replayWindowMs: 1000, nonce: (() => { let n = 0; return () => `x${++n}` })() })
    const ticket = t.issue('c2')
    expect(t.accept(ticket, false)).toMatchObject({ mode: '1-RTT', reason: 'not_idempotent' }) // 非幂等不放行
    expect(t.accept(ticket)).toMatchObject({ mode: '0-RTT' }) // 幂等才用掉 nonce
    now = 6001 // 老票据 issuedAt=1000 + ttlMs=5000 = 6000，此刻已过期
    expect(t.accept(ticket)).toMatchObject({ mode: '1-RTT', reason: 'expired' })
    now = 8000
    t.reapReplay()
    expect(t.stats().replaySetSize).toBe(0) // 老 nonce 超 replayWindow 清出
  })

  // —— ⑥ HTTP 缓存 ——
  it('⑭ HTTP 缓存：maxAge 内 fresh、SWR 窗内 stale 且标 revalidate、超窗 miss', () => {
    let now = 0
    const h = createHttpCache({ now: () => now })
    h.put('/x', 'BODY', 'etag1', 10, 5) // fresh 10s + SWR 5s
    expect(h.get('/x')).toMatchObject({ state: 'fresh', body: 'BODY' })
    now = 12_000
    expect(h.get('/x')).toMatchObject({ state: 'stale', body: 'BODY', revalidate: true })
    now = 16_000
    expect(h.get('/x')).toMatchObject({ state: 'miss' })
    expect(h.stats()).toMatchObject({ freshHits: 1, staleHits: 1, misses: 1, entries: 0 })
  })

  it('⑮ ETag 条件请求：相同回 304 无体，不同回 200 带体', () => {
    const h = createHttpCache({ now: () => 0 })
    h.put('/r', { v: 1 }, 'v1', 100)
    const notMod = h.conditional('/r', 'v1')
    expect(notMod).toMatchObject({ status: 304 })
    expect(notMod.body).toBeUndefined()
    const ok200 = h.conditional('/r', 'old')
    expect(ok200).toMatchObject({ status: 200 })
    expect(ok200.body).toEqual({ v: 1 })
    expect(h.stats().notModified).toBe(1) // 只有一次命中 304
  })
})
