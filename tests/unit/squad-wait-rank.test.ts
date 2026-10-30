import { describe, expect, it } from 'vitest'
import { initSquad } from '@/ai/Squad'
import type { Enemy } from '@/ai/Enemy'

/**
 * KI-370：排队的**玩家-facing** 那一半，先在这里量它的数据侧。
 *
 * KI-358 给了 `getSlotReport()`（谁在打、谁在等、下一个轮谁），但那是调试面板的读数；
 * 屏幕上的敌人仍然看不出"我在等"。本批把排位做成 `Enemy.squadWaitRank`（0 = 没在等，
 * 1 = 下一个轮到，2 = 再下一个……），由 `Squad.reallocateSlots()` 每 tick 写一次，
 * `ActorVisuals` 用它画脚下的排队环。
 *
 * 四条口径：
 *  ① 排位与分槽是**同一套判据与同一份排序**（`rankedCandidates()` 一个主人）；
 *  ② 排位从 1 连续数到队尾，不跳号；`getSlotReport().waiting[i]` 的排位就是 i+1；
 *  ③ 掉出队列（死人 / 掉到阈值之下）⇒ 排位归 0，不留上一拍的名次；
 *  ④ `getSlotReport()` 只读：看一眼不改变任何人的排位。
 */

type FakeEnemy = ReturnType<typeof fake>

const fake = (id: string) => ({
  id,
  data: { ai: { camp: 'test' } },
  alive: true,
  pos: { x: 0, y: 0, z: 0 },
  squadThreats: [] as unknown[],
  squadHasSlot: false,
  squadWaitRank: 0,
  squadTarget: null as string | null,
})

const asEnemy = (f: FakeEnemy): Enemy => f as unknown as Enemy

const roster = (s: ReturnType<typeof initSquad>, ids: string[]): void => {
  for (const id of ids) {
    s.register(asEnemy(fake(id)))
    s.addThreat(id, 'player', 20)
  }
}

const rankOf = (s: ReturnType<typeof initSquad>, id: string): number =>
  s.getMember(id)!.enemy.squadWaitRank

describe('KI-370 排队排位（squadWaitRank）', () => {
  it('三人以内人人有槽 ⇒ 排位全是 0；第四、第五个人按序拿 1、2', () => {
    const s = initSquad({ maxAttackSlots: 3, combatEntryThreshold: 10 })
    roster(s, ['a', 'b', 'c', 'd', 'e'])
    s.update(1)

    expect(['a', 'b', 'c'].map((id) => rankOf(s, id)), '占着槽的人不在队列里').toEqual([0, 0, 0])
    expect(rankOf(s, 'd'), '第四个是下一个轮到的').toBe(1)
    expect(rankOf(s, 'e'), '第五个排在第二位').toBe(2)
    expect(s.getSlotReport().waiting).toEqual(['d', 'e'])
  })

  it('仇恨高的插队 ⇒ 排位跟着重排：被挤下去的人变成 1，而不是留着旧名次', () => {
    const s = initSquad({ maxAttackSlots: 3, combatEntryThreshold: 10 })
    roster(s, ['a', 'b', 'c', 'd', 'e'])
    s.update(1)
    expect(rankOf(s, 'd')).toBe(1)

    s.addThreat('d', 'player', 80) // 20 + 80 = 100
    s.update(2)

    expect(rankOf(s, 'd'), '插队的人拿到槽位').toBe(0)
    expect(rankOf(s, 'c'), '被挤下去的是下一个轮到的').toBe(1)
    expect(rankOf(s, 'e')).toBe(2)
    expect(s.getSlotReport().attacking).toEqual(['d', 'a', 'b'])
  })

  it('掉到进入战斗阈值之下 ⇒ 排位归 0（队列不再替他留着名次）', () => {
    const s = initSquad({ maxAttackSlots: 3, combatEntryThreshold: 10 })
    roster(s, ['a', 'b', 'c', 'd'])
    s.update(1)
    expect(rankOf(s, 'd')).toBe(1)

    s.getMember('d')!.threats[0].threat = 5
    s.update(2)

    expect(rankOf(s, 'd'), '低于阈值 ⇒ 不在队列里').toBe(0)
    expect(s.getSlotReport().waiting).toEqual([])
  })

  it('死人 ⇒ 排位归 0，后面的人补上来（队列不许留一个空名次）', () => {
    const s = initSquad({ maxAttackSlots: 2, combatEntryThreshold: 10 })
    roster(s, ['a', 'b', 'c', 'd'])
    s.update(1)
    expect([rankOf(s, 'c'), rankOf(s, 'd')], '先到的两个人在等').toEqual([1, 2])

    ;(s.getMember('c')!.enemy as unknown as { alive: boolean }).alive = false
    s.update(2)

    expect(rankOf(s, 'c'), '死人不再占着队列').toBe(0)
    expect(rankOf(s, 'd'), '后面的人从 2 补到 1').toBe(1)
    expect(s.getSlotReport().waiting).toEqual(['d'])
  })

  it('排位不跳号，而且与 F4 名册的顺序逐格对得上（一个主人，两份读数）', () => {
    const s = initSquad({ maxAttackSlots: 1, combatEntryThreshold: 10 })
    roster(s, ['a', 'b', 'c', 'd'])
    s.update(1)

    expect(['a', 'b', 'c', 'd'].map((id) => rankOf(s, id))).toEqual([0, 1, 2, 3])
    const waiting = s.getSlotReport().waiting
    expect(waiting).toEqual(['b', 'c', 'd'])
    expect(waiting.map((id) => rankOf(s, id)), 'waiting[i] 的排位恒等于 i+1').toEqual([1, 2, 3])
  })

  it('只读：连看两遍名册，排位与槽位一格不动', () => {
    const s = initSquad({ maxAttackSlots: 2, combatEntryThreshold: 10 })
    roster(s, ['a', 'b', 'c'])
    s.update(1)
    const before = ['a', 'b', 'c'].map((id) => `${rankOf(s, id)}:${s.getMember(id)!.hasAttackSlot}`)
    s.getSlotReport()
    s.getSlotReport()
    const after = ['a', 'b', 'c'].map((id) => `${rankOf(s, id)}:${s.getMember(id)!.hasAttackSlot}`)
    expect(after).toEqual(before)
  })
})