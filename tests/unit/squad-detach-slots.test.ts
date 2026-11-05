import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import { Squad } from '@/ai/Squad'
import type { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-397：脱战的人还占着攻击槽。
 *
 * `Squad.reallocateSlots` 的注释写着「槽位仍只清候选那一批」——掉出候选的人（仇恨归零、
 * 又不在 combat/chase/alert/callAlly）不再参与排位，但**也没人去清他的 `hasAttackSlot`**。
 * 一个正在挥爪的人脱战那一拍 `attack` 还是真，`keep` 把他保下来；下一拍 `attack` 清空，
 * 而他已经不是候选，于是那枚布尔就一直挂着：玩家走远之后 1800 拍里累计 **4987 个槽位拍**
 * 挂在 search/patrol 的人身上（三个名额里常有三个是空名额），而这几个人的仇恨早已是 0。
 *
 * 三条腿：
 *  ① 单人：占着槽的人进入 search ⇒ 下一拍槽位交出去，排位也清空；
 *  ② 六人三槽、第 600 拍玩家瞬移 40 米、全员警觉归零 ⇒ 1800 拍里「非战斗态占槽」不超过
 *     6 拍（每人脱战当拍 1 拍：Squad 在 Enemy 之前跑）；末态三格全空；
 *  ③ 反向臂：把「非候选先交还槽位」那一步还原成旧行为 ⇒ 槽位拍回到 1000 以上。
 *
 * 与 KI-396 的关系：那批只把 `retreat` 一条写进兜底；这批把兜底改成「凡是不在候选里的人」，
 * 撤退自然也在里面（撤退者零槽位拍仍由 `squad-retreat-slots` 盯着）。
 */

registerGameData()

/** 候选闸挡掉的那几态（与 `Squad.ts` 的 `OUT_OF_FIGHT_STATES` 同一份判据） */
const OUT_OF_FIGHT = new Set(['retreat', 'idle', 'patrol', 'investigate', 'search'])

const fakePlayer = (x: number, z: number): PlayerController =>
  ({
    pos: { x, y: 0, z },
    hitTarget: () => ({ height: 1.7 }),
    // `sense()` 的震动那一支会读这两格（KI-024）
    stats: { stamina: 100, staMax: 100 },
    grounded: true,
    action: null,
  } as unknown as PlayerController)

function arena(n: number, slots = 3) {
  const ai = new AISystem({ maxAttackSlots: slots })
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const player = fakePlayer(0, 0)
  const enemies: Enemy[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    const e = ai.spawn('en_driftsinger', { x: Math.cos(ang) * 1.6, y: 0, z: Math.sin(ang) * 1.6 }, 'det' + i)
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  }
  return { ai, rhythm, player, enemies }
}

/** 第 600 拍玩家走远、全员警觉归零；数「非战斗态占槽」的拍数 */
function runDetached(w: ReturnType<typeof arena>, ticks = 2400) {
  let earlySlots = 0
  let lateSlots = 0
  let lateWait = 0
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick === 600) {
      w.player.pos.x = 40
      for (const e of w.enemies) e.alertness = 0
    }
    w.ai.update(TICK_DT, tick, w.player, w.rhythm)
    w.rhythm.update(TICK_DT)
    for (const e of w.enemies) {
      const stale = OUT_OF_FIGHT.has(e.state) && !e.attack
      if (e.squadHasSlot) {
        if (tick <= 600) earlySlots++
        else if (stale) lateSlots++
      }
      if (tick > 600 && stale && e.squadWaitRank > 0) lateWait++
    }
  }
  return { earlySlots, lateSlots, lateWait }
}

describe('KI-397 脱战的人不再占着攻击槽', () => {
  it('占着槽的人脱战 ⇒ 下一拍把名额与名次一起交出来', () => {
    const w = arena(2, 1)
    for (let tick = 1; tick <= 6; tick++) w.ai.update(TICK_DT, tick, w.player, w.rhythm)
    const holder = w.enemies.find((e) => e.squadHasSlot)
    expect(holder, '先有一个人拿到槽位').toBeTruthy()
    const other = w.enemies.find((e) => e !== holder)!
    holder!.attack = null
    holder!.alertness = 0
    holder!.enter('search')
    w.ai.update(TICK_DT, 7, w.player, w.rhythm)
    expect(holder!.squadHasSlot, '脱战的人不再占着出手名额').toBe(false)
    expect(holder!.squadWaitRank, '也不留在等待队列里').toBe(0)
    expect(other.squadHasSlot || other.squadWaitRank > 0, '名额留给还在打的人').toBe(true)
  })

  it('玩家走远、全员警觉归零：搜索/巡逻的人一个槽位拍都不占', () => {
    const w = arena(6, 3)
    const { earlySlots, lateSlots, lateWait } = runDetached(w)
    expect(earlySlots, '前 600 拍槽位确实在用（这条腿不是空跑）').toBeGreaterThan(1000)
    expect(lateSlots, '脱战之后还压在非战斗状态身上的槽位拍').toBeLessThanOrEqual(6)
    expect(lateWait, '脱战者也不该还挂着等待名次').toBeLessThanOrEqual(6)
    expect(w.enemies.every((e) => !e.squadHasSlot), '末态三格全空').toBe(true)
    expect(w.enemies.every((e) => e.squadWaitRank === 0), '也没有人还挂着排位').toBe(true)
    expect(w.enemies.every((e) => (e.squadThreats[0]?.threat ?? 0) === 0), '仇恨早已归零（不是靠仇恨闸挡的）').toBe(true)
  })

  it('反向臂：还原「只清候选」的旧行为 ⇒ 脱战者身上的槽位拍回来', () => {
    const w = arena(6, 3)
    type Proto = { reallocateSlots: () => void; members: Map<string, { hasAttackSlot: boolean; enemy: Enemy }> }
    const proto = Squad.prototype as unknown as Proto
    const original = proto.reallocateSlots
    proto.reallocateSlots = function (this: unknown) {
      const self = this as unknown as Proto
      const stale = [...self.members.values()].filter(
        (m) => m.hasAttackSlot && !m.enemy.attack && OUT_OF_FIGHT.has(m.enemy.state),
      )
      original.call(this)
      for (const m of stale) m.hasAttackSlot = true
    }
    let lateSlots = 0
    try {
      lateSlots = runDetached(w).lateSlots
    } finally {
      proto.reallocateSlots = original
    }
    expect(lateSlots, '旧行为下 search/patrol 的人一直占着名额').toBeGreaterThan(1000)
  })
})
