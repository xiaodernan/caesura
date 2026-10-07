import { describe, expect, it } from 'vitest'
import { registerGameData, quests } from '@/data'

/**
 * 五条 NPC 线的**可收束性**——今早（2026-10-07）我是**人眼**数出来的
 * （`q_bells` 8 步 / `q_corvin` 5 / `q_meg` 4 / `q_faceless` 4 / `q_haltrune` 4，末步都有 `advanceOn`），
 * 但没有任何东西看着它。本守卫把那条结论钉住：
 *
 * **一条线"能走完"的判据 = 它的最后一步有 `advanceOn`**（`advanceOn` 是"这一步怎么算完成"，
 * 没有它 ⇒ `isComplete` 永远是 false ⇒ 这条线在代码里是死的）。断弦线曾经就栽在这上面：
 * 步 4 的 `advanceOn` 一度被设成 fate 状态，而那时任务还停在步 3（它的 `advanceOn` 是**营地**状态）
 * ⇒ 步 4 **根本进不去**（KI-043 记着那次失败）。
 *
 * 本守卫只查"末步有没有 `advanceOn`"，**不查那个条件今天成不成立**——后者是任务线的语义，
 * 要人（或那条线自己的 flow 测试）来判。
 */
registerGameData()

describe('五条 NPC 线的可收束性（末步必须有 advanceOn）', () => {
  it('每一条线的最后一步都交代了"怎么算完成"（否则这条线在代码里走不完）', () => {
    expect(quests.length, '任务线名册不该是空的').toBeGreaterThan(0)
    for (const q of quests) {
      const steps = q.steps ?? []
      expect(steps.length, `${q.id} 至少要有一步`).toBeGreaterThan(0)
      const last = steps[steps.length - 1]
      const a = last.advanceOn ?? {}
      // `QuestStep.advanceOn` 的真形状只有两形：`flags[]` 或 `state{key,in}`（schema 里写死的）
      const hasGate =
        (Array.isArray(a.flags) && a.flags.length > 0) || (a.state !== undefined && a.state !== null)
      expect(hasGate, `${q.id} 的末步 ${last.state} 没有 advanceOn ⇒ 这条线走不完`).toBe(true)
    }
  })

  it('步的身份（`state`）在它自己那条线里唯一且非空（重名会让 advanceOn 指到别处）', () => {
    for (const q of quests) {
      const keys = (q.steps ?? []).map((s) => s.state)
      expect(keys.every((k) => typeof k === 'string' && k.length > 0), `${q.id} 有空的步 state`).toBe(true)
      expect(new Set(keys).size, `${q.id} 的步 state 有重复：${keys.join(',')}`).toBe(keys.length)
    }
  })
})
