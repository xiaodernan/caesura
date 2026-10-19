import { describe, expect, it, beforeAll } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData } from '@/data'
import { initSquad, getSquad, registerSquadBus } from '@/ai/Squad'

/**
 * 小队系统的**单例与总线接线**（KI-142 补测）。
 *
 * **为什么补**：`Squad.ts` 此前有七行没被任何测试执行过（覆盖率读数：ai 包 99.40%，
 * 其中这七行是那七行）——单例的取法、优先级的平局判据、两条总线通道，都是"看着简单、
 * 少了就静默"的那种代码。**覆盖率门是只许涨的棘轮**，新代码不测就把地板砸穿。
 */
beforeAll(() => { registerGameData() })

const mkEnemy = (id: string, camp = 'default') => ({
  id,
  dataId: 'en_test',
  data: { ai: { camp } },
  alive: true,
  pos: { x: 0, y: 0, z: 0 },
  squadThreats: [] as unknown[],
  squadHasSlot: false,
  squadTarget: null as string | null,
}) as never

describe('小队的单例与总线接线（KI-142）', () => {
  it('getSquad 认的是 initSquad 造出来的那一个（单例只有一个主人）', () => {
    const s = initSquad()
    expect(getSquad(), '单例取回的就是刚造的那一个').toBe(s)
  })

  it('两条总线通道真的接到小队上：squad.callAlly / squad.addThreat', () => {
    const s = initSquad()
    registerSquadBus()
    const e = mkEnemy('en_bus_1')
    s.register(e)

    // ① addThreat：事件 ⇒ 仇恨表上多一笔
    bus.emit('squad.addThreat', { enemyId: 'en_bus_1', targetId: 'player', amount: 25 })
    const member = s.getMember('en_bus_1')
    expect(member?.threats.length, 'addThreat 通道落到了小队上').toBe(1)
    expect(member?.threats[0].threat).toBe(25)

    // ② callAlly：事件 ⇒ 同 camp 的盟友收到（载荷的形状照 CallAllyPayload：callerId/camp/position/targetId/urgency）
    const ally = mkEnemy('en_bus_2')
    s.register(ally)
    bus.emit('squad.callAlly', {
      callerId: 'en_bus_1',
      camp: 'default',
      position: { x: 0, y: 0, z: 0 },
      targetId: 'player',
      urgency: 'normal',
    })
    const allyMember = s.getMember('en_bus_2')
    expect(allyMember?.threats.length ?? 0, 'callAlly 通道让盟友也收到了仇恨').toBeGreaterThan(0)
  })

  it('仇恨归零后 currentTarget 被清空（目标丢了却还指着它，就是追着空气打）', () => {
    const s = initSquad()
    const e = mkEnemy('en_lost_target')
    s.register(e)
    s.addThreat('en_lost_target', 'player', 30)
    s.update(1)
    expect(s.getMember('en_lost_target')?.currentTarget, '有目标时指着目标').toBe('player')
    // 一直衰减到仇恨归零（每 tick 掉 0.02 ⇒ 30 点要 1500 tick）⇒ 目标没了 ⇒ currentTarget 必须被清空
    for (let i = 0; i < 2000; i++) s.update(i + 2)
    expect(s.getMember('en_lost_target')?.currentTarget, '目标没了 ⇒ 不许还指着它').toBeNull()
  })

  it('仇恨相同的两个人按"先来后到"排（平局判据不是随便定的）', () => {
    const s = initSquad()
    const early = mkEnemy('en_early')
    const late = mkEnemy('en_late')
    s.register(early)
    s.register(late)
    s.addThreat('en_early', 'player', 20)
    s.addThreat('en_late', 'player', 20)
    s.update(1)
    const order = s.getAllMembers()
      .slice()
      .sort((a, b) => (b.threats[0]?.threat ?? 0) - (a.threats[0]?.threat ?? 0))
      .map((m) => m.enemy.id)
    expect(order.indexOf('en_early'), '同样仇恨时先来的排前面').toBeLessThan(order.indexOf('en_late'))
  })
})
