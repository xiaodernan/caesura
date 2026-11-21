import { describe, expect, it } from 'vitest'
import {
  createLoginGuard,
  credentialStuffingSnapshot,
  runStuffing,
  STUFFING_DEFAULTS,
} from '../../scripts/stress-credential-stuffing.mjs'

/**
 * KI-721：撞库场景的**真值**护栏。
 * 静态站没有真实登录后端，所以这里压的是登录守卫模型本身；不冒充打过真站。
 * 每条断言都读真跑出来的计数，不写死 0/1 结果。
 */
describe('撞库压力场景（KI-721）', () => {
  it('错误口令不接受；连续失败达阈值真锁定，锁定期内正确口令也拒绝', () => {
    const g = createLoginGuard({ now: 0, lockMs: 1000 })
    expect(g.attempt('u1', 'wrong').accepted).toBe(false)
    expect(g.attempt('u1', 'bad').reason).toBe('bad-password')
    expect(g.attempt('u1', 'admin').reason).toBe('bad-password')
    expect(g.attempt('u1', 'qwerty').reason).toBe('bad-password')
    expect(g.attempt('u1', '111').reason).toBe('just-locked')
    expect(g.attempt('u1', '123').reason).toBe('locked')
    expect(g.lockState('u1').locked).toBe(true)
    expect(g.stats().falseAccepts).toBe(0)
  })

  it('锁定到期后正确口令恢复（不是永久锁死）', () => {
    const g = createLoginGuard({ now: 0, lockMs: 1000 })
    for (let i = 0; i < STUFFING_DEFAULTS.maxAttempts; i++) g.attempt('u', 'x' + i)
    expect(g.attempt('u', '123').accepted).toBe(false)
    g.advance(1001)
    expect(g.lockState('u').locked).toBe(false)
    expect(g.attempt('u', '123').accepted).toBe(true)
  })

  it('并发洪峰真跑：错误口令零误收，锁定真发生，延迟分位数与 heap 是实读', async () => {
    const run = await runStuffing({ attempts: 600, concurrency: 60, users: 8, seed: 721 })
    expect(run.attempts).toBe(600)
    expect(run.falseAccepts).toBe(0)
    expect(run.failures).toBeGreaterThan(0)
    expect(run.locked).toBeGreaterThan(0)
    expect(run.avgLatencyUs).toBeGreaterThanOrEqual(0)
    expect(run.p50Us).toBeGreaterThanOrEqual(0)
    expect(run.p95Us).toBeGreaterThanOrEqual(run.p50Us)
    expect(run.p99Us).toBeGreaterThanOrEqual(run.p95Us)
    expect(run.sound).toBe(true)
    const snap = credentialStuffingSnapshot(run)
    expect(snap.falseAccepts).toBe(0)
    expect(snap.rejected).toBe(run.failures + run.locked)
  })

  it('确定性：同 seed 两次跑出的计数逐字一致（墙钟与 heap 不进判据）', async () => {
    const a = await runStuffing({ attempts: 300, concurrency: 30, users: 6, seed: 9 })
    const b = await runStuffing({ attempts: 300, concurrency: 30, users: 6, seed: 9 })
    const pick = (r: typeof a) => ({
      attempts: r.attempts, failures: r.failures, locked: r.locked,
      accepted: r.accepted, reasons: r.reasons, falseAccepts: r.falseAccepts,
    })
    expect(pick(a)).toEqual(pick(b))
  })

  it('正确口令在未被锁定时接受（不把所有请求一律拒绝）', () => {
    const g = createLoginGuard({ now: 0 })
    expect(g.attempt('fresh', '123').accepted).toBe(true)
    expect(g.stats().accepted).toBe(1)
  })
})
