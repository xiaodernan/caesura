import { describe, it, expect } from 'vitest'
import { registerGameData } from '@/data'
import { msToTicks } from '@/core/Time'
import { reactionConfig, reactionTier, materialFlashSeconds } from '@/combat/Reactions'

registerGameData()

const TIERS = ['R1', 'R2', 'R3'] as const

/**
 * §8 受击反应的运行时换算（KI-050 起表 → KI-052① 接线，`combat/Reactions.ts`）。
 *
 * 表住 `data/json/reactions.json`，代码只做「ms → tick」这一层换算——如果有人在
 * `reactionTier` 里另写一份常数，或把 msToTicks 换成 floor，"改个硬直毫秒数"
 * 就会在三个档位上各自漂成不同的 tick 数，而 nobody 会注意到。
 *
 * 零直接读者：`tests/flow/reaction.test.ts` 只锁了 R4（`armCrumple` 的 1.8s/2.4s），
 * R0–R3 这条读数链此前没有任何断言。
 */
describe('reactionTier：§8 R1–R3 硬直格数与位移米（数据 → tick 那一层）', () => {
  it('R1/R2/R3 定格数与设计表逐行一致', () => {
    expect(reactionTier('R1')).toEqual({ stunTicks: 12, displaceM: 0.2 })
    expect(reactionTier('R2')).toEqual({ stunTicks: 21, displaceM: 0.5 })
    expect(reactionTier('R3')).toEqual({ stunTicks: 36, displaceM: 2 })
  })

  it('硬直格数恒等于表的 msToTicks(stunMs)（不是另写的第二份常数）', () => {
    for (const t of TIERS) {
      expect(reactionTier(t).stunTicks).toBe(msToTicks(reactionConfig()[t].stunMs))
    }
  })

  it('位移米数是读数，与表逐行相等（不重抄）', () => {
    for (const t of TIERS) {
      expect(reactionTier(t).displaceM).toBe(reactionConfig()[t].displaceM)
    }
  })

  it('档位越重，硬直格数与位移都单调不减', () => {
    const [r1, r2, r3] = TIERS.map((t) => reactionTier(t))
    expect(r1.stunTicks).toBeLessThanOrEqual(r2.stunTicks)
    expect(r2.stunTicks).toBeLessThanOrEqual(r3.stunTicks)
    expect(r1.displaceM).toBeLessThanOrEqual(r2.displaceM)
    expect(r2.displaceM).toBeLessThanOrEqual(r3.displaceM)
  })
})

describe('materialFlashSeconds：§8 R0 材质发光秒数', () => {
  it('R0.flashMs / 1000，且与设计值 0.15s 相符', () => {
    expect(materialFlashSeconds()).toBeCloseTo(reactionConfig().R0.flashMs / 1000, 6)
    expect(materialFlashSeconds()).toBeCloseTo(0.15, 6)
  })

  it('是「秒」不是「毫秒」——数值必须小于 1 才说得通', () => {
    expect(materialFlashSeconds()).toBeLessThan(1)
  })
})
