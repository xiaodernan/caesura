import { describe, it, expect } from 'vitest'
import { registerGameData, progression } from '@/data'
import { affixValue } from '@/rpg/Inventory'
import { Rng } from '@/core/Math'

registerGameData()

/** 数据里真正给出随机数值的那一批（range 是数值的唯一来源） */
const AFFIXES = [...progression.affixes.prefix, ...progression.affixes.suffix].filter((a) => a.range)

/**
 * `affixValue` 的取数纪律（progression.md §5.3「档位内数值均匀随机（±10% 端差）」）。
 *
 * `rpg.test.ts` 只锁了「表外 id 给 0」这一条；取值域、取整纪律、退化区间**一条都没锁**。
 * 而这里两件事会静默漂移：
 *   1. 越界——公式若写成 `lo + (hi-lo)*rng.float(lo,hi)` 之类，数值会冲出设计带；
 *      面板上的「+12% 共鸣」实际可能是 30%，没人会注意到。
 *   2. 取整口径——行为型（帧数/次数）必须取整，数值型最多三位小数；混用会让
 *      「完美格挡 +1.4 帧」这种读数出现在 UI 上。
 * 数据里还有两个退化区间（[0.15,0.15] / [1,1]）与一个负区间（af_tacet [-0.35,-0.12]），
 * 一并钉住：退化的必须恒定（固定词缀不许抖），负区间证明公式没偷偷取绝对值。
 */
describe('affixValue：§5.3 取值域与取整纪律', () => {
  it('数据里真有带 range 的词缀（否则这条判据恒真）', () => {
    expect(AFFIXES.length).toBeGreaterThan(0)
  })

  it('逐词缀千次取值都落在 [lo, hi] 内，不越界', () => {
    for (const a of AFFIXES) {
      const [lo, hi] = a.range!
      const rng = new Rng(`bound-${a.id}`)
      for (let i = 0; i < 1000; i++) {
        const v = affixValue(a.id, rng)
        expect(v, `${a.id} 低于下界 ${lo}`).toBeGreaterThanOrEqual(lo)
        expect(v, `${a.id} 高于上界 ${hi}`).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('取整纪律：整数区间取整，小数区间最多三位小数', () => {
    for (const a of AFFIXES) {
      const [lo, hi] = a.range!
      const integral = Number.isInteger(lo) && Number.isInteger(hi)
      const rng = new Rng(`round-${a.id}`)
      for (let i = 0; i < 300; i++) {
        const v = affixValue(a.id, rng)
        if (integral) {
          expect(Number.isInteger(v), `${a.id} 是整数区间却给出小数`).toBe(true)
        } else {
          expect(Number.isInteger(v * 1000), `${a.id} 是小数区间却超过三位小数`).toBe(true)
        }
      }
    }
  })

  it('回归：之鸣钟（af_bellwarden）不再恒为 0 —— 行为型≠必须取整', () => {
    // 这条词缀的 behavior 是 bellBonus，但它是**比率**（消费方 CombatManager 当乘数用、
    // UI 用百分比显示），区间 [0.06,0.12]。从前 affixValue 按 behavior 一律取整，
    // Math.round(0.06..0.12) 恒为 0 ⇒ 整条词缀失效（实测 31/31 次掷出都是 0）。
    const rng = new Rng('bellwarden-regress')
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) {
      const v = affixValue('af_bellwarden', rng)
      expect(v, '之鸣钟又掷出 0 了').toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(0.12)
      seen.add(v)
    }
    expect(seen.size, '之鸣钟塌成一个点了').toBeGreaterThan(3)
  })

  it('整段区间都用上了：非退化词缀能摸到下界附近与上界附近', () => {
    for (const a of AFFIXES) {
      const [lo, hi] = a.range!
      const span = hi - lo
      const rng = new Rng(`spread-${a.id}`)
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < 3000; i++) {
        const v = affixValue(a.id, rng)
        if (v < min) min = v
        if (v > max) max = v
      }
      if (span === 0) {
        expect(min, `${a.id} 退化区间却抖了`).toBe(lo)
        expect(max, `${a.id} 退化区间却抖了`).toBe(lo)
      } else {
        expect(min, `${a.id} 摸不到下界附近`).toBeLessThanOrEqual(lo + span * 0.2)
        expect(max, `${a.id} 摸不到上界附近`).toBeGreaterThanOrEqual(lo + span * 0.8)
      }
    }
  })

  it('退化区间恒定：af_bountiful 恒 0.15、af_restkeeper 恒 1（固定词缀不许抖）', () => {
    for (let i = 0; i < 50; i++) {
      expect(affixValue('af_bountiful', new Rng(i))).toBe(0.15)
      expect(affixValue('af_restkeeper', new Rng(i))).toBe(1)
    }
  })

  it('负区间成立：af_tacet 取值恒为负（公式没偷偷取绝对值）', () => {
    const rng = new Rng('tacet')
    for (let i = 0; i < 300; i++) {
      const v = affixValue('af_tacet', rng)
      expect(v).toBeLessThan(0)
      expect(v).toBeGreaterThanOrEqual(-0.35)
      expect(v).toBeLessThanOrEqual(-0.12)
    }
  })

  it('同种子同值（确定性不破）', () => {
    for (const a of AFFIXES) {
      expect(affixValue(a.id, new Rng('same-seed'))).toBe(affixValue(a.id, new Rng('same-seed')))
    }
  })
})
