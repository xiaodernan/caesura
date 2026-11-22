import { describe, expect, it } from 'vitest'

import { INSTANCE_STATE, callWithFailover, createRegistry } from '../../scripts/lib/spring-registry-core.mjs'
import { riggedStudy, simulate, study, tamperStudy } from '../../scripts/spring-registry-failover.mjs'

/**
 * KI-740 · 注册租约 → 自动摘除 → 客户端有界故障转移。
 *
 * 这一件的价值不在于"脚本跑通"，而在于三条判据**都能被打穿**：
 * 租约（过期就该摘）、有界（不许无限重试）、确定（复算逐字一致）。
 * 所以每个 describe 都配一条反例腿——只证明"对的实现对"，不证明"判据是真的"。
 */

const T0 = 2_000_000
const TTL = 30_000

describe('KI-740 · 租约：活着是一个时间窗，不是一个布尔', () => {
  it('刚注册就在册，可以查到', () => {
    const r = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
    r.register({ id: 'a', service: 'gate', at: T0 })
    expect(r.lookup('gate', T0).map((i) => i.id)).toEqual(['a'])
  })

  it('TTL 内不续约仍在候选集；过了 TTL 掉成 DOWN 并从候选集消失（不是被删掉）', () => {
    const r = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
    r.register({ id: 'a', service: 'gate', at: T0 })
    expect(r.lookup('gate', T0 + TTL - 1).length).toBe(1)
    expect(r.lookup('gate', T0 + TTL + 1).length).toBe(0)
    const snap = r.snapshot(T0 + TTL + 1)
    expect(snap.down).toBe(1)
    expect(snap.instances[0].state).toBe(INSTANCE_STATE.DOWN)
    expect(snap.instances[0].evictedAt).toBe(T0 + TTL + 1)
    // 还在册：运维要看得见它曾经在（悄悄消失是最坏的实现）
    expect(r.size()).toBe(1)
  })

  it('心跳把 DOWN 拉回 UP（网络抖动不该需要人工重新注册）', () => {
    const r = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
    r.register({ id: 'a', service: 'gate', at: T0 })
    r.lookup('gate', T0 + TTL + 1)
    expect(r.snapshot(T0 + TTL + 1).down).toBe(1)
    expect(r.heartbeat('a', T0 + TTL + 2)).toBe(true)
    expect(r.lookup('gate', T0 + TTL + 3).length).toBe(1)
    // 不在册的 id 续约要返回 false，不许静默当成功
    expect(r.heartbeat('ghost', T0)).toBe(false)
  })

  it('人工摘流不吃租约：OUT_OF_SERVICE 永远不进候选集，也不因心跳复活', () => {
    const r = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
    r.register({ id: 'a', service: 'gate', at: T0 })
    r.setState('a', INSTANCE_STATE.OUT_OF_SERVICE)
    r.heartbeat('a', T0 + 1)
    expect(r.lookup('gate', T0 + 2).length).toBe(0)
    expect(r.snapshot(T0 + 2).outOfService).toBe(1)
  })

  it('候选集顺序稳定（同一时刻两次查同一个服务，id 序列逐字一致）', () => {
    const r = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
    ;['c', 'a', 'b'].forEach((id) => r.register({ id, service: 'gate', at: T0 }))
    expect(r.lookup('gate', T0).map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(r.lookup('gate', T0).map((i) => i.id)).toEqual(r.lookup('gate', T0).map((i) => i.id))
  })
})

describe('KI-740 · 有界故障转移：换实例，不换雪崩', () => {
  const reg = () => {
    const r = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
    ;['a', 'b', 'c'].forEach((id) => r.register({ id, service: 'gate', at: T0 }))
    return r
  }

  it('第一个实例打不通 ⇒ 换下一个，成功即停（尝试串 a- c+）', () => {
    const res = callWithFailover({
      registry: reg(), service: 'gate', at: T0,
      call: (i) => ({ ok: i.id !== 'a' }),
    })
    expect(res.ok).toBe(true)
    expect(res.attempts.map((x) => x.id + (x.ok ? '+' : '-'))).toEqual(['a-', 'b+'])
  })

  it('最多试 maxAttempts 个，且每次只试没试过的实例', () => {
    const res = callWithFailover({
      registry: reg(), service: 'gate', at: T0, maxAttempts: 2,
      call: () => ({ ok: false }),
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('all-attempts-failed')
    expect(res.attempts.length).toBe(2)
    expect(new Set(res.attempts.map((a) => a.id)).size).toBe(2)
  })

  it('候选集空 ⇒ 一次都不试就失败（全挂时不许拿重试当拖延）', () => {
    const empty = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
    const res = callWithFailover({ registry: empty, service: 'gate', at: T0, call: () => ({ ok: true }) })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('no-instance')
    expect(res.attempts.length).toBe(0)
  })

  it('反例：把重试改成无界（钉住同一个实例反复试）⇒ 有界那一位必须翻 false', () => {
    const s = study({ retry: 'unbounded' })
    expect(s.holds.failoverBounded).toBe(false)
    expect(s.holds.leaseAccurate).toBe(true)
  })
})

describe('KI-740 · 三难与三路篡改（各自只打穿自己）', () => {
  it('基线三条全立', () => {
    const s = study()
    expect(s.holds).toEqual({ leaseAccurate: true, failoverBounded: true, deterministic: true })
    expect(s.sound).toBe(true)
  })

  it('三路篡改各打穿一位（broken 恰好等于 expect）', () => {
    const t = tamperStudy()
    expect(t.rows.map((r) => [r.case, r.broken])).toEqual([
      ['noPrune', ['leaseAccurate']],
      ['unboundedRetry', ['failoverBounded']],
      ['randomPicker', ['deterministic']],
    ])
    expect(t.falsifiable).toBe(true)
  })

  it('rigged（实例永生 + 永不失败）= 111 的诚实塌缩：vacuous 为真、distinguishable 为假', () => {
    const r = riggedStudy()
    expect(Object.values(r.holds).every(Boolean)).toBe(true)
    expect(r.collapsed).toBe(true)
    expect(r.vacuous).toBe(true)
    expect(r.distinguishable).toBe(false)
  })

  it('轨迹可复算：同一入参两次 simulate 逐字一致（且真的跑过 14 次调用）', () => {
    const a = simulate()
    const b = simulate()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.calls.length).toBe(14)
    // 三个实例最后都过期：这是脚本刻意走到"全挂"那一段的证据
    expect(a.snapshot.down).toBe(3)
  })
})
