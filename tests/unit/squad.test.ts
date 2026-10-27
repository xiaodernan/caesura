import { describe, expect, it, beforeEach } from 'vitest'
import { initSquad } from '@/ai/Squad'
import type { Enemy } from '@/ai/Enemy'

/**
 * Squad 系统测试（Phase B5：仇恨槽位、CallAlly、编队）。
 * 纯逻辑测试：不依赖 Three.js，用最小替身验仇恨槽位分配、CallAlly 广播、编队逻辑。
 */

/**
 * 最小敌人替身。`Squad` 对 `Enemy` 只读四格（`id` / `data.ai.camp` / `pos` / `alive`）与三格投影
 * （`squadThreats` / `squadHasSlot` / `squadTarget`），这正是 `Squad.ts` 头注承诺的依赖方向；
 * 真实 `Enemy` 的其余 100 多个成员这一层用不到，所以这里用一次显式断言把替身交给结构判据
 * （KI-130：此前这些字面量直接当 `Enemy` 传，`tsc` 的 25 条红全是这个形状）。
 */
function mkEnemy(
  id: string,
  camp = 'default',
  pos = { x: 0, y: 0, z: 0 },
  alive = true,
): Enemy {
  return {
    id,
    dataId: 'en_test',
    data: { ai: { camp } },
    pos,
    alive,
    squadThreats: [],
    squadHasSlot: false,
    squadTarget: null,
  } as unknown as Enemy
}

describe('Squad 系统：仇恨槽位与 CallAlly', () => {
  let squad: ReturnType<typeof initSquad>


  beforeEach(() => {
    squad = initSquad()
  })

  it('初始化配置正确（默认 maxAttackSlots=3）', () => {
    expect(squad.getConfig().maxAttackSlots).toBe(3)
    expect(squad.getConfig().callAllyRadius).toBe(24)
    expect(squad.getConfig().threatDecayPerTick).toBe(0.02)
  })

  it('自定义配置覆盖默认值', () => {
    const squad2 = initSquad({ maxAttackSlots: 5, callAllyRadius: 30 })
    expect(squad2.getConfig().maxAttackSlots).toBe(5)
    expect(squad2.getConfig().callAllyRadius).toBe(30)
  })
})

describe('Squad 成员注册与注销', () => {
  let squad: ReturnType<typeof initSquad>

  beforeEach(() => {
    squad = initSquad()
  })

  it('register: 成员加入后能在 getMember 找到', () => {
    const e = mkEnemy('e1', 'default', { x: 0, y: 0, z: 0 }, true)
    squad.register(e)
    const m = squad.getMember(e.id)
    expect(m).toBeDefined()
    expect(m?.enemy.id).toBe('e1')
  })

  it('unregister: 成员移除后 getMember 返回 undefined', () => {
    const e = mkEnemy('e1', 'default', { x: 0, y: 0, z: 0 }, true)
    squad.register(e)
    squad.unregister(e.id)
    expect(squad.getMember(e.id)).toBeUndefined()
  })

  it('unregister: 释放攻击槽位 —— 注销腾出的那一格由下一个候选接住', () => {
    // 只留 1 格：两个候选、同仇恨 ⇒ 排序退到「先来后到」，e1 拿槽；注销 e1 之后 e2 必须接住那一格。
    // 旧写法只 `if (m) m.hasAttackSlot = true` 再 unregister，一条断言都没有 —— 删掉释放逻辑照样绿。
    squad = initSquad({ maxAttackSlots: 1 })
    const a = mkEnemy('e1')
    const b = mkEnemy('e2')
    squad.register(a)
    squad.register(b)
    squad.addThreat('e1', 'player', 50)
    squad.addThreat('e2', 'player', 50)
    squad.update(1)
    expect(squad.getMember('e1')?.hasAttackSlot, '同仇恨时先来的拿槽').toBe(true)
    expect(squad.getMember('e2')?.hasAttackSlot, '只有 1 格 ⇒ 后到的排队').toBe(false)

    squad.unregister('e1')
    squad.update(2)
    expect(squad.getMember('e1'), '被注销者真的离场').toBeUndefined()
    expect(squad.getMember('e2')?.hasAttackSlot, '注销腾出的那一格由 e2 接住').toBe(true)
  })
})

describe('Squad 仇恨系统', () => {
  let squad: ReturnType<typeof initSquad>
  let enemy: any

  beforeEach(() => {
    squad = initSquad()
    enemy = mkEnemy('enemy_1', 'default', { x: 0, y: 0, z: 0 }, true)
    squad.register(enemy)
  })

  it('addThreat: 增加仇恨后 threats 列表更新', () => {
    squad.addThreat('enemy_1', 'player', 30)
    const m = squad.getMember('enemy_1')
    expect(m?.threats.length).toBe(1)
    expect(m?.threats[0].threat).toBe(30)
  })

  it('addThreat: 同一目标多次增加仇恨会累加', () => {
    squad.addThreat('enemy_1', 'player', 20)
    squad.addThreat('enemy_1', 'player', 15)
    const m = squad.getMember('enemy_1')
    expect(m?.threats[0].threat).toBe(35)
  })

  it('addThreat: 超过阈值会建立战斗状态', () => {
    squad.addThreat('enemy_1', 'player', 15) // 超过 combatEntryThreshold(10)
    squad.update(1) // 触发更新，tick 变为 1
    const m = squad.getMember('enemy_1')
    expect(m?.combatSince).toBeGreaterThan(0)
  })

  it('addThreat: 多目标仇恨按权重排序', () => {
    squad.addThreat('enemy_1', 'player_A', 10)
    squad.addThreat('enemy_1', 'player_B', 50)
    const m = squad.getMember('enemy_1')
    expect(m?.threats[0].targetId).toBe('player_B')
    expect(m?.threats[0].threat).toBe(50)
  })
})

describe('Squad 攻击槽位分配', () => {
  let squad: ReturnType<typeof initSquad>

  beforeEach(() => {
    squad = initSquad()
  })

  it('槽位上限为 3：4 个敌人只有前 3 个拿到槽位', () => {
    for (let i = 0; i < 4; i++) {
      const e = mkEnemy(`e${i}`, 'default', { x: 0, y: 0, z: 0 }, true)
      squad.register(e)
      squad.addThreat(`e${i}`, 'player', 50 - i * 10)
    }
    squad.update(1)
    const slotCount = squad.getAllMembers().filter(m => m.hasAttackSlot).length
    expect(slotCount).toBe(3)
  })

  it('槽位分配优先仇恨高、进入早', () => {
    const squad2 = initSquad({ maxAttackSlots: 2 })
    const e1 = mkEnemy('e1', 'default', { x: 0, y: 0, z: 0 }, true)
    const e2 = mkEnemy('e2', 'default', { x: 0, y: 0, z: 0 }, true)
    const e3 = mkEnemy('e3', 'default', { x: 0, y: 0, z: 0 }, true)
    squad2.register(e1)
    squad2.register(e2)
    squad2.register(e3)
    // 权重不同
    squad2.addThreat('e1', 'player', 30)
    squad2.addThreat('e2', 'player', 50) // 高仇恨
    squad2.addThreat('e3', 'player', 40) // 中等
    squad2.update(1)
    // e2(50) 和 e3(40) 应该拿到槽位（权重最高的两个）
    const m2 = squad2.getMember('e2')
    const m3 = squad2.getMember('e3')
    expect(m2?.hasAttackSlot).toBe(true)
    expect(m3?.hasAttackSlot).toBe(true)
    const m1 = squad2.getMember('e1')
    expect(m1?.hasAttackSlot).toBe(false)
  })
})

describe('Squad CallAlly 广播', () => {
  let squad: ReturnType<typeof initSquad>

  beforeEach(() => {
    squad = initSquad({ callAllyRadius: 20 })
  })

  it('CallAlly: 同阵营、在半径内的成员增加仇恨', () => {
    const caller = mkEnemy('caller', 'default', { x: 0, y: 0, z: 0 }, true)
    const ally1 = mkEnemy('ally1', 'default', { x: 10, y: 0, z: 0 }, true)
    const ally2 = mkEnemy('ally2', 'default', { x: 30, y: 0, z: 0 }, true)
    squad.register(caller)
    squad.register(ally1)
    squad.register(ally2)

    squad.callAlly({
      callerId: 'caller',
      camp: 'default',
      targetId: 'player',
      position: { x: 0, y: 0, z: 0 },
      urgency: 'normal',
    })

    // ally1 应该有仇恨（在半径内），ally2 不应该（超出半径）
    const m1 = squad.getMember('ally1')
    const m2 = squad.getMember('ally2')
    expect(m1?.threats.some(t => t.targetId === 'player')).toBe(true)
    expect(m2?.threats.some(t => t.targetId === 'player')).toBe(false)
  })

  it('CallAlly: urgency 影响仇恨倍率', () => {
    const squad2 = initSquad({ callAllyRadius: 20 })
    const c = mkEnemy('c', 'default', { x: 0, y: 0, z: 0 }, true)
    const a = mkEnemy('a', 'default', { x: 5, y: 0, z: 0 }, true)
    squad2.register(c)
    squad2.register(a)

    squad2.callAlly({ callerId: 'c', camp: 'default', targetId: 'player', position: { x: 0, y: 0, z: 0 }, urgency: 'high' })
    const m = squad2.getMember('a')
    const threat = m?.threats.find(t => t.targetId === 'player')
    expect(threat?.threat).toBeGreaterThan(50)
  })
})

describe('Squad 仇恨衰减', () => {
  it('威胁随时间自然衰减 - 配置正确', () => {
    const squad = initSquad({ threatDecayPerTick: 0.1 })
    const e = mkEnemy('e1', 'default', { x: 0, y: 0, z: 0 }, true)
    squad.register(e)
    squad.addThreat('e1', 'player', 100)
    const config = squad.getConfig()
    expect(config.threatDecayPerTick).toBe(0.1)
  })
})

describe('Squad 阵营统计', () => {
  let squad: ReturnType<typeof initSquad>

  beforeEach(() => {
    squad = initSquad()
  })

  it('getCampCount: 正确统计阵营存活成员数', () => {
    const e1 = mkEnemy('e1', 'default', { x: 0, y: 0, z: 0 }, true)
    const e2 = mkEnemy('e2', 'hostile', { x: 0, y: 0, z: 0 }, true)
    const e3 = mkEnemy('e3', 'default', { x: 0, y: 0, z: 0 }, false)
    squad.register(e1)
    squad.register(e2)
    squad.register(e3)

    expect(squad.getCampCount('default')).toBe(1) // e1 存活且 default
    expect(squad.getCampCount('hostile')).toBe(1) // e2 存活且 hostile
    // e3 死了不算
  })
})

describe('Squad 配置导出', () => {
  it('getConfig 返回当前配置副本', () => {
    const squad = initSquad({ maxAttackSlots: 5 })
    const cfg = squad.getConfig()
    expect(cfg.maxAttackSlots).toBe(5)
    // 修改返回的对象不应影响内部
    cfg.maxAttackSlots = 99
    expect(squad.getConfig().maxAttackSlots).toBe(5)
  })
})