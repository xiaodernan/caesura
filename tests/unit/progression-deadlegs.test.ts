import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { Progression } from '@/rpg/Progression'
import type { AttrKey } from '@/data/schema'

/**
 * 批27：Progression.ts 的 3 条死分支 + L80 恒死（cov_b26 排行）。
 * 数据走 registerGameData() 的真表（progression.json），测试不复制数值。
 */

registerGameData()

describe('Progression 死腿（批27）', () => {
  it('addResonance：amount <= 0 → 原样返回空收益，不动 xp（L89 true 腿）', () => {
    const p = new Progression()
    const before = p.xp
    const r0 = p.addResonance(0)
    expect(r0, '零额遗响不给点').toEqual({ levels: 0, ranks: [], overflow: 0 })
    expect(p.xp, 'xp 未被改动').toBe(before)
    const rNeg = p.addResonance(-7)
    expect(rNeg.levels, '负额同样吞掉').toBe(0)
    expect(p.xp).toBe(before)
  })

  it('effectiveAttr：attrs 表里查不到的 key → 原值直返（L144 !meta 兜底腿）', () => {
    const p = new Progression()
    expect(p.effectiveAttr('nope' as AttrKey, 42), '无元数据 ⇒ 不折算').toBe(42)
    // 对照：正常 key 走软上限折算路径，不被本批改动碰坏
    expect(p.effectiveAttr('str', 10)).toBe(10)
  })

  it('restore：存档缺 respecCount 字段 → 归 0；缺 originId → 保持现值（L210 ?? 0 右腿）', () => {
    const p = new Progression()
    p.respecCount = 2
    p.restore({ rank: 3, xp: 12, unspent: 4, attrs: { str: 11, dex: 9, ton: 8, vig: 7, ovr: 6, fis: 5 } })
    expect(p.respecCount, '老存档没有洗点次数字段 ⇒ 视为 0').toBe(0)
    expect(p.rank).toBe(3)
    expect(p.originId, '没写 originId 就沿用当前出身').toBe('origin_tuner')
  })

  it('对照：xpToNext 在正常等级返回曲线真值，不被恒死标注碰坏', () => {
    const p = new Progression()
    expect(p.xpToNext(), 'rank1 → rank2 的额度来自 progression.json').not.toBeNull()
  })
})
