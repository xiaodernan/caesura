import { describe, expect, it } from 'vitest'
import { attrScale, resolveDamage } from '@/combat/DamagePipeline'

/**
 * 批25：DamagePipeline 的 5 条死分支（cov_b24 排行）。
 * 纯函数单测：不进 GameTime/RhythmClock，也不进 CombatManager——
 * 那条链路的组合行为归 flow 测试，这里只把兜底腿与缺省倍率钉住。
 */

describe('DamagePipeline 死腿（批25）', () => {
  it('attrScale：scaling 声明的键不在 attrs 里 → 该键贡献 0（?? 0 右腿）', () => {
    // 只点 dex 的 scaling、面板只有 str：attrs.dex ?? 0 = 0 ⇒ 总和为 0 ⇒ 恒等 1.0
    expect(attrScale({ base: 0, attrs: { str: 10 }, scaling: { dex: 20 }, defense: 0 })).toBe(1)
  })

  it('attrScale：scaling 键值显式 undefined → 该键贡献 0（?? 0 右腿）', () => {
    // attrs 有 str=5，scaling.str 却是 undefined ⇒ 5 * (undefined ?? 0) = 0 ⇒ 恒等 1.0
    expect(attrScale({ base: 0, attrs: { str: 5 }, scaling: { str: undefined }, defense: 0 })).toBe(1)
  })

  it('attrScale：正常两腿对照（两表都有值）', () => {
    // 5 * 20 = 100 ⇒ 1 + 100/100 = 2.0
    expect(attrScale({ base: 0, attrs: { str: 5 }, scaling: { str: 20 }, defense: 0 })).toBe(2)
  })

  it('resolveDamage：背刺未给 backstabMul → 用缺省 2.0（?? 2.0 右腿）', () => {
    const r = resolveDamage({ base: 100, defense: 0, backstab: true, variance: 0 }, () => 0.5)
    expect(r.damage, '100 × 2.0').toBe(200)
    expect(r.crit, '背刺即暴击').toBe(true)
  })

  it('resolveDamage：weakpoint → ×1.8 且记暴击', () => {
    const r = resolveDamage({ base: 100, defense: 0, weakpoint: true, variance: 0 }, () => 0.5)
    expect(r.damage, '100 × 1.8').toBe(180)
    expect(r.crit, '弱点即暴击').toBe(true)
  })

  it('resolveDamage：暴击触发但未给 critMul → 用缺省 1.35（?? 1.35 右腿）', () => {
    // critRate=1：rand() 恒 < 1 ⇒ 必触发
    const r = resolveDamage({ base: 100, defense: 0, variance: 0, critRate: 1 }, () => 0.5)
    expect(r.damage, '100 × 1.35').toBe(135)
    expect(r.crit, '暴击成立').toBe(true)
  })
})
