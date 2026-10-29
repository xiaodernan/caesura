import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { initSquad } from '@/ai/Squad'
import { Enemy } from '@/ai/Enemy'
import type { EnemyData } from '@/data/schema'
import { aiPanelText } from '@/tools/AIDebugger'

/**
 * KI-358：槽位排队第一次有**读数面**。
 *
 * KI-352 让「同屏最多 3 人同时出手」真的转起来之后，账上还欠一句「谁在等、轮谁」——
 * `squadHasSlot` 只是一个布尔，玩家/调试者都看不出第四个人排在第几、还要等谁。
 * 本批给 `Squad` 一个只读投影 `getSlotReport()`（攻击者与等待者各一份、按同一套
 * 「仇恨降序、进入早优先」排序），并把它接到 F4 的 `squad` 行。
 *
 * 三条口径：
 *  ① 排队名册与分槽用的是**同一套判据**（有仇恨、top ≥ combatEntryThreshold），不是另写一份；
 *  ② 只读：调用前后 `hasAttackSlot` 一格不动（看一眼不许改变谁在打）；
 *  ③ F4 行在**没接名册**时整行消失（旧调用方不用改，也不凭空多一行假读数）。
 */

registerGameData()

type FakeEnemy = ReturnType<typeof fake>

const fake = (id: string, alive = true) => ({
  id,
  dataId: 'en_test',
  data: { ai: { camp: 'test' } },
  alive,
  pos: { x: 0, y: 0, z: 0 },
  squadThreats: [] as unknown[],
  squadHasSlot: false,
  squadTarget: null as string | null,
})

const asEnemy = (f: FakeEnemy): Enemy => f as unknown as Enemy

describe('KI-358 槽位排队的只读名册', () => {
  it('四人同仇恨 ⇒ 前三个在打、第四个在等，顺序与分槽同一套（先来后到）', () => {
    const s = initSquad({ maxAttackSlots: 3, combatEntryThreshold: 10 })
    for (const id of ['a', 'b', 'c', 'd']) {
      s.register(asEnemy(fake(id)))
      s.addThreat(id, 'player', 20)
    }
    s.update(1)
    const r = s.getSlotReport()
    expect(r.attacking).toEqual(['a', 'b', 'c'])
    expect(r.waiting).toEqual(['d'])
    expect(r.attacking.every((id) => s.getMember(id)?.hasAttackSlot), '攻击者名册就是占槽者').toBe(true)
    expect(r.waiting.every((id) => !s.getMember(id)?.hasAttackSlot), '等待者名册就是没槽者').toBe(true)
  })

  it('仇恨高的插队：第四个人拉到 100 ⇒ 他进攻击者，仇恨最低的那个去等', () => {
    const s = initSquad({ maxAttackSlots: 3, combatEntryThreshold: 10 })
    for (const id of ['a', 'b', 'c', 'd']) {
      s.register(asEnemy(fake(id)))
      s.addThreat(id, 'player', 20)
    }
    s.addThreat('d', 'player', 80) // 20 + 80 = 100
    s.update(1)
    const r = s.getSlotReport()
    expect(r.attacking[0], '仇恨最高的排最前（轮谁）').toBe('d')
    expect(r.attacking).toEqual(['d', 'a', 'b'])
    expect(r.waiting).toEqual(['c'])
  })

  it('没到进入战斗阈值的不进名册：他们连排队都不算', () => {
    const s = initSquad({ maxAttackSlots: 3, combatEntryThreshold: 10 })
    s.register(asEnemy(fake('below')))
    s.addThreat('below', 'player', 5)
    s.update(1)
    expect(s.getSlotReport()).toEqual({ attacking: [], waiting: [] })
  })

  it('死人不进名册（名单与投影一起收）', () => {
    const s = initSquad({ maxAttackSlots: 3, combatEntryThreshold: 10 })
    s.register(asEnemy(fake('alive')))
    s.register(asEnemy(fake('dead')))
    s.addThreat('alive', 'player', 20)
    s.addThreat('dead', 'player', 20)
    ;(s.getMember('dead')!.enemy as unknown as { alive: boolean }).alive = false
    s.update(1)
    const r = s.getSlotReport()
    expect(r.attacking).toEqual(['alive'])
    expect(r.waiting).not.toContain('dead')
  })

  it('只读：看一眼不许改变谁在打', () => {
    const s = initSquad({ maxAttackSlots: 3, combatEntryThreshold: 10 })
    for (const id of ['a', 'b', 'c', 'd']) {
      s.register(asEnemy(fake(id)))
      s.addThreat(id, 'player', 20)
    }
    s.update(1)
    const before = ['a', 'b', 'c', 'd'].map((id) => s.getMember(id)?.hasAttackSlot)
    s.getSlotReport()
    s.getSlotReport()
    const after = ['a', 'b', 'c', 'd'].map((id) => s.getMember(id)?.hasAttackSlot)
    expect(after).toEqual(before)
  })
})

describe('KI-358 F4 的 squad 行', () => {
  const panel = (slots?: { attacking: string[]; waiting: string[] }): string => {
    const e = new Enemy(registry.get<EnemyData>('en_driftsinger'), { x: 0, y: 0, z: 0 }, 'ki358')
    return aiPanelText({
      target: e,
      player: { x: 0, y: 0, z: 2 },
      grid: { owner: 'region', bpm: 84, beatsPerBar: 4, bar: 1, beatInBar: 1, tick: 10 },
      armedSlots: [],
      ...(slots ? { slots } : {}),
    })
  }

  it('等待者报出排位与两份名册（轮谁看 attacking 的顺序）', () => {
    const e = new Enemy(registry.get<EnemyData>('en_driftsinger'), { x: 0, y: 0, z: 0 }, 'ki358b')
    const text = aiPanelText({
      target: e,
      player: { x: 0, y: 0, z: 2 },
      grid: { owner: 'region', bpm: 84, beatsPerBar: 4, bar: 1, beatInBar: 1, tick: 10 },
      armedSlots: [],
      slots: { attacking: ['en_a'], waiting: ['en_b', e.id] },
    })
    expect(text).toContain('squad  you WAIT #2')
    expect(text).toContain('attacking [en_a]')
    expect(text).toContain(`waiting [en_b ${e.id}]`)
  })

  it('没接名册的旧调用方不凭空多一行：squad 行整行消失', () => {
    expect(panel()).not.toContain('squad  you')
  })
})
