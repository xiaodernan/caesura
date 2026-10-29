import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { bindEnemyRegistry, Enemy } from '@/ai/Enemy'
import type { EnemyData } from '@/data/schema'
import { AISystem } from '@/ai/AISystem'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-352：Phase B5 的仇恨/槽位机器第一次在生产里有**写方**。
 *
 * 在此之前 `Squad.addThreat` 只有两个调用点，而两个都不是生产路径：一条是
 * `bus.on('squad.addThreat')`（没有任何生产发射方），另一条是 `Squad.callAlly`
 * （同样只由 `bus.on('squad.callAlly')` 调用）。于是「同屏最多 3 人同时出手」
 * （§1.2 的承诺）在生产里从来没有发生过——槽位表永远是空的那三格。
 *
 * 本文件量三件事，各自是一条腿：
 *  ① 进入战斗的第一笔仇恨由 `AISystem.update` 记（配置里的 `combatEntryThreshold`
 *    第一次有读者），同拍就分到槽位；
 *  ② 仇恨表里有人、却没拿到槽位 ⇒ `tryAttack` 不出手；槽位到手才出手；
 *  ③ 仇恨表是空的 ⇒ 不排队（否则开局第一眼就因为"还没人恨她"而永远不动手）。
 *
 * ②③ 用真 `Enemy` 状态机驱动，不碰 `PlayerController` 全家：update 的依赖面只有 `player.pos`。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z } }) as unknown as PlayerController

const driftData = (): EnemyData => {
  const base = registry.get<EnemyData>('en_driftsinger')
  return { ...base, ai: { ...base.ai, distBands: [{ min: 0, max: 99, actions: ['claw1'] }] } }
}

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

/** 把一只漂调者放进 combat 态，然后按 tick 喂它；`attack` 一出现就停。 */
const drive = (e: Enemy, rhythm: RhythmClock, maxTicks: number): void => {
  let tick = 0
  for (let i = 0; i < maxTicks && !e.attack; i++) {
    e.update(TICK_DT, ++tick, fakePlayer(1, 0), rhythm, () => false)
  }
}

const combatReady = (id: string): Enemy => {
  const e = new Enemy(driftData(), { x: 0, y: 0, z: 0 }, id)
  e.enter('combat')
  e.alertness = 100
  return e
}

describe('KI-352 仇恨的第一笔生产写入与攻击槽的真正读者', () => {
  it('进入战斗的那一笔由 AISystem 记下：同拍就分到槽位（combatEntryThreshold 第一次有读者）', () => {
    const ai = new AISystem()
    const e = ai.spawn('en_murkshell', { x: 0, y: 0, z: 0 }, 'aggro')
    bindEnemyRegistry([e])
    e.alertness = 100
    e.enter('combat')

    ai.update(TICK_DT, 1, fakePlayer(2, 0), rhythmOf())

    expect(e.squadThreats.length, '进入战斗 ⇒ 仇恨表上有一笔').toBeGreaterThan(0)
    expect(e.squadHasSlot, '三人以内 ⇒ 当拍就拿到攻击槽位').toBe(true)
  })

  it('仇恨表里有人、却没拿到槽位 ⇒ 不出手；槽位到手才出手', () => {
    const e = combatReady('gate-wait')
    e.squadThreats = [{ targetId: 'player', threat: 10, hasSlot: false, enteredAt: 1 }]
    e.squadHasSlot = false

    drive(e, rhythmOf(), 400)
    expect(e.attack, '没槽位 ⇒ 400 拍里一次都不出手').toBeNull()

    e.squadHasSlot = true
    drive(e, rhythmOf(), 400)
    expect(e.attack, '槽位到手 ⇒ 同一段代码出得了手').not.toBeNull()
  })

  it('仇恨表空着的那只不排队：开局第一眼就永远不动手才是 bug', () => {
    const e = combatReady('gate-free')
    e.squadThreats = []
    e.squadHasSlot = false

    drive(e, rhythmOf(), 400)
    expect(e.attack, '没人恨她 ⇒ 照旧出手（队列只挡仇恨表里已有的）').not.toBeNull()
  })
})
