import { describe, expect, it } from 'vitest'
import { budgetFindings, parseBudgetArgs } from '../../scripts/perf-budget-rules.mjs'

/**
 * perf-budget-rules.mjs 单元测试（headless：纯函数，无 IO）。
 *
 * 预算对账的四种形状：不裁判 / 在预算内 / 超预算 / 量不出。
 */

describe('perf-budget-rules：budgetFindings', () => {
  const reading = { probe: 'ai.update', meanMs: 0.2764, p50Ms: 0.1698, p95Ms: 0.4931, p99Ms: 1.5205, maxMs: 18.6574, over2ms: 28 }

  it('不给预算 ⇒ 不裁判（空数组）', () => {
    expect(budgetFindings(reading, undefined)).toEqual([])
  })

  it('p95 在预算内（= 预算） ⇒ 空数组', () => {
    expect(budgetFindings(reading, 0.4931)).toEqual([])
    expect(budgetFindings(reading, 5)).toEqual([])
  })

  it('p95 超预算 ⇒ 一条点名的判决（含上下文）', () => {
    const out = budgetFindings(reading, 0.1)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('p95=0.4931')
    expect(out[0]).toContain('超预算 0.1')
  })

  it('p95 恰好等于预算 ⇒ 空数组（边界是 ≤）', () => {
    expect(budgetFindings({ ...reading, p95Ms: 10 }, 10)).toEqual([])
  })

  it('读数里没有 p95Ms ⇒ 一条「量不出」（不是空，不是假绿）', () => {
    const out = budgetFindings({ probe: 'ai.update' }, 5)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('p95Ms')
    expect(out[0]).toContain('不裁判')
  })
})

describe('perf-budget-rules：parseBudgetArgs', () => {
  it('不传任何参数 ⇒ 两个字段都不出现', () => {
    const out = parseBudgetArgs([])
    expect(out.budgetP95).toBeUndefined()
    expect(out.reportPath).toBeUndefined()
  })

  it('--budget=<ms> 解析为正数', () => {
    expect(parseBudgetArgs(['--budget=5']).budgetP95).toBe(5)
    expect(parseBudgetArgs(['--budget=0.5']).budgetP95).toBe(0.5)
  })

  it('--budget 非法 ⇒ 抛错', () => {
    expect(() => parseBudgetArgs(['--budget='])).toThrow()
    expect(() => parseBudgetArgs(['--budget=abc'])).toThrow()
    expect(() => parseBudgetArgs(['--budget=0'])).toThrow()
    expect(() => parseBudgetArgs(['--budget=-1'])).toThrow()
  })

  it('--report=<path> 原样截取', () => {
    expect(parseBudgetArgs(['--report=out/perf.json']).reportPath).toBe('out/perf.json')
  })

  it('两个 flag 同时给 ⇒ 两个都解析', () => {
    const out = parseBudgetArgs(['--budget=5', '--report=a.json'])
    expect(out.budgetP95).toBe(5)
    expect(out.reportPath).toBe('a.json')
  })
})
