/**
 * Progression.addResonance 音级封顶余量守卫（src/rpg/Progression.ts）。
 *
 * 覆盖实测（v8 text reporter，src/rpg）报 Progression.ts 82.14% branch，未取分支正是
 * `addResonance` 里这一格（源码 113-115）：
 *
 *     if (this.rank >= this.data.maxRank) { out.overflow = this.xp; this.xp = 0 }
 *
 * progression-deadlegs.test.ts 只断言了 `amount <= 0` 与 `overflow: 0`（零额），**从没驱动过
 * "顶到音级上限后还有余量"这一格**。而这是真契约：到了封顶线，花不掉的遗响必须**如实进 overflow**
 * ——既不能被静默吞掉（玩家应得的没给），也不能回绕/累积成下一周的幽灵 xp（谎称还能再升）。
 *
 * 锁的要点（数值全部从 progression.json 现推，不手钉）：
 *   1. 刚好顶到 maxRank：余量**精确**等于 overflow、xp 归零、连升级数 = maxRank-1；
 *   2. 已在上限再给遗响：全额进 overflow、不再升级、xp 不累积；
 *   3. 边界对照：未到上限时的余量是**结转（xp）**、overflow 仍为 0——overflow 只在顶格那一刻出现。
 */
import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { Progression } from '@/rpg/Progression'

registerGameData()

describe('addResonance：音级封顶后的余量进 overflow，不被吞也不回绕', () => {
  it('刚好顶到 maxRank 的那一笔：余量精确进 overflow、xp 归零、级数=上限', () => {
    const p = new Progression()
    const totalCost = p.data.rankCurve.reduce((s, r) => s + r.xp, 0) // rank1→maxRank 全级费用（现推）
    const leftover = 12345
    const g = p.addResonance(totalCost + leftover)
    expect(p.rank).toBe(p.data.maxRank)
    expect(p.xp, '顶格后 xp 归零，不留幽灵进度').toBe(0)
    expect(g.levels, '从 1 级连升到上限').toBe(p.data.maxRank - 1)
    expect(g.ranks[g.ranks.length - 1]).toBe(p.data.maxRank)
    expect(g.overflow, '花不掉的余量如实上报，一分不少').toBe(leftover)
  })

  it('已在音级上限时再给遗响：全额进 overflow、不再升级、xp 不累积', () => {
    const p = new Progression()
    p.addResonance(10_000_000) // 先顶格
    const cap = p.data.maxRank
    const g = p.addResonance(500)
    expect(g.overflow).toBe(500)
    expect(g.levels, '顶格后不再升').toBe(0)
    expect(p.rank, '音级停在表上限').toBe(cap)
    expect(p.xp, '不累积成幽灵 xp').toBe(0)
  })

  it('未到上限时的余量是结转（xp），不是 overflow', () => {
    const p = new Progression()
    const need = p.xpToNext()!
    const g = p.addResonance(need - 1) // 差一格，升不了
    expect(g.levels).toBe(0)
    expect(g.overflow, '没顶格 ⇒ 没有 overflow').toBe(0)
    expect(p.xp, '余量结转成当前音级的 xp').toBe(need - 1)
  })
})
