import { describe, expect, it, beforeAll } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData } from '@/data'
import { initSquad, getSquad, registerSquadBus } from '@/ai/Squad'

/**
 * 小队系统的**单例与总线接线**（KI-142 补测；KI-352 起两条写入口改认真频道）。
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

  it('小队的两个写入口认的是真频道：combat.hit 记账、ai.callAlly 叫盟友', () => {
    const s = initSquad()
    // 三次注册只许接一次线（生产里 main 与 AISystem 各调一次的历史形状）
    registerSquadBus()
    registerSquadBus()
    registerSquadBus()
    const e = mkEnemy('en_bus_1')
    s.register(e)

    // ① 受击：combat.hit 的受害者是小队成员 ⇒ 仇恨表上多一笔（权重就是这一记的伤害）
    bus.emit('combat.hit', {
      attackerId: 'player', victimId: 'en_bus_1', damage: 25, poiseDamage: 0,
      kind: 'light', point: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 1 },
      result: 'hit', hitStopMs: 0, shakeKey: 'heavy', backstab: false, weakpoint: false,
    })
    const member = s.getMember('en_bus_1')
    expect(member?.threats.length, 'combat.hit 落到了小队上（三条订阅会记三笔）').toBe(1)
    expect(member?.threats[0].threat, '权重就是这一记的伤害').toBe(25)
    expect(member?.threats[0].targetId).toBe('player')

    // ② 呼叫：ai.callAlly 的呼叫者在小队里 ⇒ 同 camp 盟友也收到（camp 从名册现查，不从载荷抄）
    const ally = mkEnemy('en_bus_2')
    s.register(ally)
    bus.emit('ai.callAlly', { fromId: 'en_bus_1', pos: { x: 0, y: 0, z: 0 }, range: 18 })
    const allyMember = s.getMember('en_bus_2')
    expect(allyMember?.threats.length ?? 0, 'callAlly 通道让盟友也收到了仇恨').toBeGreaterThan(0)
    expect(allyMember?.threats[0].threat, '载荷没写 urgency ⇒ 按 normal 的 50 记账').toBe(50)
  })

  it('urgency 从载荷进乘数：high 100 / normal 50 / low 25（不再永远是 normal）', () => {
    const cases = [['high', 100], ['normal', 50], ['low', 25]] as const
    for (const [urgency, expected] of cases) {
      const s = initSquad()
      registerSquadBus()
      const caller = mkEnemy(`en_caller_${urgency}`)
      const ally = mkEnemy(`en_ally_${urgency}`)
      s.register(caller)
      s.register(ally)
      bus.emit('ai.callAlly', { fromId: `en_caller_${urgency}`, pos: { x: 0, y: 0, z: 0 }, range: 18, urgency })
      expect(s.getMember(`en_ally_${urgency}`)?.threats[0]?.threat, `${urgency} 的乘数`).toBe(expected)
    }
  })

  it('受害者不在小队里（玩家挨打 / 名字对不上）⇒ 不凭空造成员', () => {
    const s = initSquad()
    registerSquadBus()
    bus.emit('combat.hit', {
      attackerId: 'en_ghost', victimId: 'player', damage: 12, poiseDamage: 0,
      kind: 'enemy', point: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 1 },
      result: 'hit', hitStopMs: 0, shakeKey: 'heavy', backstab: false, weakpoint: false,
    })
    bus.emit('ai.callAlly', { fromId: 'en_nowhere', pos: { x: 0, y: 0, z: 0 }, range: 18 })
    expect(s.getMember('player'), '玩家不是小队成员').toBeUndefined()
    expect(s.getMember('en_nowhere'), '没登记过的呼叫者不建成员').toBeUndefined()
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
