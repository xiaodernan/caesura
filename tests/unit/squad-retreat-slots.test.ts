import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-396：残血撤退的人在 10 米边界上每拍与战斗互踢——而且踢回战斗的那半拍还占着攻击槽。
 *
 * 设计（combat.md §14 那张状态表）的撤退出口是「距离恢复 → Combat；被追上 → Combat（困兽）」，
 * 两条出口都回战斗；可 `combat` 里进撤退的判据读的是**血量水位**（HP ≤ 阈值），伤员一回战斗就又满足它。
 * 实现在 `dist > 10` 那条出口上于是变成每拍翻转：六人三槽里三人掉到 10% 后 1800 拍翻了 **1163 次**，
 * 而且在「翻回战斗」的那半拍里被队列当成候选人、拿到槽位，下一拍又撤退 ⇒ 累计 **726 个槽位拍**（≈12 秒）
 * 挂在一个正在往外走的人身上（攻击率 95.5% → 94.1%）。
 *
 * 裁决两层：
 *  ① `Enemy.retreatArmed`：撤退只装填一次——撤过之后只有**伤好了**（> 阈值 × 1.8，既有的恢复线）
 *     才重新装填。这是设计隐含的迟滞，不新造数字，也不改任何一条阈值。
 *  ② `Squad.reallocateSlots`：撤退中（且没在挥）的人先交还槽位——他不在候选里，
 *     「按候选清位」那道循环碰不到他，槽位会一直挂着（这一层是兜底，防别的路径把槽留在撤退者身上）。
 *
 * 三条腿：
 *  ① 单人：占着槽的人进入 retreat ⇒ 下一拍槽位交出去、名次清空；
 *  ② 六人三槽、三人掉到 10%：1800 拍里「撤退且占槽」的拍数为 0，状态翻转总数 ≤ 12，出手率 > 85%；
 *  ③ 反向臂：每拍把 `retreatArmed` 重新置真（＝旧行为）⇒ 翻转回到 500 次以上，槽位拍也回来。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({
    pos: { x, y: 0, z },
    hitTarget: () => ({ height: 1.7 }),
    // `sense()` 的震动那一支会读这两格（KI-024）；只在「看不见」时才走，但假件要备齐。
    stats: { stamina: 100, staMax: 100 },
    grounded: true,
    action: null,
  } as unknown as PlayerController)

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

function arena(n: number, slots: number) {
  const ai = new AISystem({ maxAttackSlots: slots })
  const rhythm = rhythmOf()
  const player = fakePlayer(0, 0)
  const enemies: Enemy[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    const e = ai.spawn('en_driftsinger', { x: Math.cos(ang) * 1.6, y: 0, z: Math.sin(ang) * 1.6 }, 'ret' + i)
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  }
  return { ai, rhythm, player, enemies }
}

describe('KI-396 撤退的人不占队列也不占槽', () => {
  it('占着槽的人进入撤退 ⇒ 下一拍槽位交出去，名次也清空', () => {
    const w = arena(2, 1)
    for (let tick = 1; tick <= 6; tick++) w.ai.update(TICK_DT, tick, w.player, w.rhythm)
    const holder = w.enemies.find((e) => e.squadHasSlot)
    expect(holder, '先有一个人拿到槽位').toBeTruthy()
    const other = w.enemies.find((e) => e !== holder)!
    holder!.attack = null
    holder!.enter('retreat')
    w.ai.update(TICK_DT, 7, w.player, w.rhythm)
    expect(holder!.squadHasSlot, '撤退的人不再占着出手名额').toBe(false)
    expect(holder!.squadWaitRank, '也不进等待队列（他在往外走）').toBe(0)
    expect(other.squadHasSlot || other.squadWaitRank > 0, '名额与名次留给还在打的人').toBe(true)
  })

  it('六人三槽、三人掉到 10%：不再每拍翻转，撤退者一个槽位拍都不占', () => {
    const w = arena(6, 3)
    const prev = new Map<string, string>()
    let flips = 0
    let retreatSlot = 0
    let attackTicks = 0
    for (let tick = 1; tick <= 2400; tick++) {
      if (tick === 600) {
        for (const e of w.enemies.slice(0, 3)) e.stats.hp = Math.max(1, Math.round(e.stats.hpMax * 0.1))
      }
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      if (tick > 600 && w.enemies.some((e) => e.attack !== null)) attackTicks++
      for (const e of w.enemies) {
        const was = prev.get(e.id)
        if (was !== undefined && was !== e.state && tick > 600) flips++
        prev.set(e.id, e.state)
        if (tick > 600 && e.state === 'retreat' && e.squadHasSlot) retreatSlot++
      }
    }
    expect(retreatSlot, '撤退中占着槽的拍数').toBe(0)
    expect(flips, '三人各撤一次 ⇒ 六次上下的翻转，不再每拍互踢').toBeLessThanOrEqual(12)
    expect(100 * attackTicks / 1800, '出手没有因为这次修复被冻住').toBeGreaterThan(85)
  })

  it('反向臂：每拍重新装填撤退 ⇒ 10 米边界上的互踢与槽位拍一起回来', () => {
    const w = arena(6, 3)
    const original = Enemy.prototype.update as unknown as (...args: unknown[]) => void
    Enemy.prototype.update = function (this: Enemy, ...args: unknown[]): void {
      this.retreatArmed = true
      original.apply(this, args)
    } as unknown as typeof Enemy.prototype.update
    const prev = new Map<string, string>()
    let flips = 0
    let retreatSlot = 0
    try {
      for (let tick = 1; tick <= 2400; tick++) {
        if (tick === 600) {
          for (const e of w.enemies.slice(0, 3)) e.stats.hp = Math.max(1, Math.round(e.stats.hpMax * 0.1))
        }
        w.ai.update(TICK_DT, tick, w.player, w.rhythm)
        w.rhythm.update(TICK_DT)
        for (const e of w.enemies) {
          const was = prev.get(e.id)
          if (was !== undefined && was !== e.state && tick > 600) flips++
          prev.set(e.id, e.state)
          if (tick > 600 && e.state === 'retreat' && e.squadHasSlot) retreatSlot++
        }
      }
    } finally {
      Enemy.prototype.update = original as unknown as typeof Enemy.prototype.update
    }
    expect(flips, '旧行为每拍翻转').toBeGreaterThan(500)
    expect(retreatSlot, '旧行为下撤退者仍占着槽位').toBeGreaterThan(50)
  })
})
