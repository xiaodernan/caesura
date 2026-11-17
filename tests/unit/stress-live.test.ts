import { describe, expect, it } from 'vitest'
import { percentile, buildReport } from '../../scripts/stress-live.mjs'

/**
 * KI-660（用户「压力测试」指令 · scripts/stress-live.mjs）：
 *   ① percentile 的边界行为（空数组 → 0 · p50/p95/p99 对千分位数）；
 *   ② buildReport 从合成样本里如实对账（total / failures / failureRate / mean / p-distribution / 字节数）；
 *   ③ 全成功样本 ⇒ failureRate = 0 · 与冒烟同口径；④ 任一失败 ⇒ failureRate > 0（退出码非零的机器口径）。
 */
describe('KI-660 · stress-live 报告数学（scripts/stress-live.mjs）', () => {
  it('percentile：空数组返回 0，且 p50/p95/p99 取整正确', () => {
    expect(percentile([], 95)).toBe(0)
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(sorted, 50)).toBe(5)
    expect(percentile(sorted, 95)).toBe(10)
    expect(percentile(sorted, 99)).toBe(10)
    expect(percentile(sorted, 1)).toBe(1)
  })

  it('buildReport：两个轮次合成 8 个样本 · 2 失败 · failureRate 0.25', () => {
    const rounds = [
      { wallMs: 100, samples: [
        { ok: true, status: 200, bytes: 1000, latencyMs: 50 },
        { ok: true, status: 200, bytes: 1000, latencyMs: 70 },
        { ok: false, status: 500, bytes: 0, latencyMs: 80 },
        { ok: true, status: 200, bytes: 1000, latencyMs: 30 },
      ] },
      { wallMs: 200, samples: [
        { ok: true, status: 200, bytes: 1000, latencyMs: 90 },
        { ok: false, status: 0, bytes: 0, latencyMs: 100 },
        { ok: true, status: 200, bytes: 1000, latencyMs: 40 },
        { ok: true, status: 200, bytes: 1000, latencyMs: 60 },
      ] },
    ]
    const r = buildReport(rounds)
    expect(r.total).toBe(8)
    expect(r.failures).toBe(2)
    expect(r.failureRate).toBe(0.25)
    expect(r.mean).toBe(65)
    expect(r.min).toBe(30)
    expect(r.max).toBe(100)
    expect(r.totalBytes).toBe(6000)
  })

  it('buildReport：全成功 ⇒ failureRate = 0（与冒烟同口径）', () => {
    const rounds = [
      { wallMs: 50, samples: Array.from({ length: 16 }, (_, i) => ({ ok: true, status: 200, bytes: 500, latencyMs: 40 + i })) },
    ]
    const r = buildReport(rounds)
    expect(r.failures).toBe(0)
    expect(r.failureRate).toBe(0)
    expect(r.totalBytes).toBe(8000)
  })

  it('module 可 import 不触网（main guard 已就位）', () => {
    // import 本身不应发起任何 fetch —— 若 main 误跑，本文件会直接超时/失败
    expect(typeof buildReport).toBe('function')
    expect(typeof percentile).toBe('function')
  })
})
