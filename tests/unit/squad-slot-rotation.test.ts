import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-380：仇恨归零以后队列冻住——第四个人整场拿不到槽位。
 *
 * KI-379 把「还在交战」的人留在名册里、并把入队闸改成不看仇恨数值，同屏最多三人因此守住了。
 * 可那一批只保证「不超三人」，不保证「轮得到」：名册留住之后，四个人的仇恨一起停在 0，
 * 排序退化成 `combatSince`（进入战斗的先后）——前三个人永远占着槽，第四个人**一次都轮不到**。
 *
 * 量出来的读数（修前，四人三槽，玩家不动手，7200 拍 = 2 分钟）：
 * 占槽拍数 `[7200, 7200, 7200, 0]`——前三人从头占到尾，第四人 0 拍。
 *
 * 裁决：冷队列（仇恨全归零）也要轮转。等满「一笔仇恨的寿命」还没轮到的人，把那一笔仇恨
 * 重新记上（数量沿用进入战斗那笔 = `combatEntryThreshold + 1`，不新造一个手感数字）：
 * 他因此排到冷队列前面、拿到槽位，再随着衰减自然退回去。一条命 = 阈值 ÷ 衰减。
 *
 * 两条腿：
 *  ① 7200 拍里四个人都拿到过槽位，且最少的那个人不低于最多的 20%（不是「偶尔赏一拍」）；
 *  ② 轮转不破上限：任意一拍占槽者不超过三人。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z }, hitTarget: () => ({ height: 1.7 }) }) as unknown as PlayerController

const driftBands = [{ min: 0, max: 99, actions: ['claw1'] }]

function arena(n: number) {
  const ai = new AISystem()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const player = fakePlayer(0, 0)
  const enemies: Enemy[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    const e = ai.spawn(
      'en_driftsinger',
      { x: Math.cos(ang) * 1.2, y: 0, z: Math.sin(ang) * 1.2 },
      'rot' + i,
    )
    e.data = { ...e.data, ai: { ...e.data.ai, distBands: driftBands } }
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  }
  return { ai, rhythm, player, enemies }
}

describe('KI-380 冷队列也会轮转', () => {
  it('四人三槽跑到 7200 拍：四个人都轮到过，没有谁被冻在队列外', () => {
    const w = arena(4)
    const held = [0, 0, 0, 0]
    for (let tick = 1; tick <= 7200; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      w.enemies.forEach((e, i) => {
        if (e.squadHasSlot) held[i]++
      })
    }
    expect(held.every((h) => h > 0), '四个人的占槽拍数 ' + JSON.stringify(held)).toBe(true)
    expect(
      Math.min(...held) / Math.max(...held),
      '最少 / 最多 = ' + Math.min(...held) + ' / ' + Math.max(...held),
    ).toBeGreaterThan(0.2)
  })

  it('换人不抖：冷下来以后占槽名单的变更次数是个位数级别', () => {
    const w = arena(4)
    let prev = w.enemies.map((e) => (e.squadHasSlot ? '1' : '0')).join('')
    let changes = 0
    for (let tick = 1; tick <= 7200; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      const cur = w.enemies.map((e) => (e.squadHasSlot ? '1' : '0')).join('')
      if (tick > 1200 && cur !== prev) changes++
      prev = cur
    }
    expect(changes, '冷下来以后占槽名单换了 ' + changes + ' 次').toBeLessThan(40)
  })

  it('轮转不破上限：任意一拍占槽者不超过三人', () => {
    const w = arena(4)
    let worst = 0
    let worstTick = 0
    for (let tick = 1; tick <= 7200; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      const n = w.enemies.filter((e) => e.squadHasSlot).length
      if (n > worst) {
        worst = n
        worstTick = tick
      }
    }
    expect(worst, '最多几人同拍占槽（最坏在第 ' + worstTick + ' 拍）').toBeLessThanOrEqual(3)
  })
})
