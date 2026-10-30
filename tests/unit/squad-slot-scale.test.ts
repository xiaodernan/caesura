import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import type { SquadConfig } from '@/ai/Squad'
import type { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-381：队列在五人／六人／两槽／单槽下都守得住——上限跟着配置走，而且每个人都轮得到。
 *
 * KI-379／380 只量了「四人三槽」这一格：闸在仇恨归零后不破，冷队列按任期轮转。
 * 可 §1.2 的上限是「同屏最多 3 人同时出手」，实战里一队常有 5～6 只；而 `maxAttackSlots`
 * 是 `squad.json` 里的配置（KI-372），改成 2 或 1 时队列还该是同一套行为。这一批把这几格钉住：
 * 占槽人数与同时出手人数都 ≤ 配置值、每个成员都拿到过槽位、最少/最多不低于 0.5（不是「赏一拍」）。
 *
 * 读数（7200 拍、玩家不动手、漂调者同距围一圈）：
 *  五人三槽 `[4700, 4694, 4049, 4151, 4006]`；六人三槽 `[3606, 3635, 3635, 3594, 3565, 3565]`；
 *  五人两槽 `[3083, 3597, 1919, 2617, 3184]`；四人一槽 `[2092, 1705, 1715, 1688]`。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z }, hitTarget: () => ({ height: 1.7 }) }) as unknown as PlayerController

const driftBands = [{ min: 0, max: 99, actions: ['claw1'] }]

function arena(n: number, config: Partial<SquadConfig> = {}) {
  const ai = new AISystem(config)
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const player = fakePlayer(0, 0)
  const enemies: Enemy[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    const e = ai.spawn(
      'en_driftsinger',
      { x: Math.cos(ang) * 1.6, y: 0, z: Math.sin(ang) * 1.6 },
      'scale' + i,
    )
    e.data = { ...e.data, ai: { ...e.data.ai, distBands: driftBands } }
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  }
  return { ai, rhythm, player, enemies }
}

/** 跑一段，量四件事：每人占槽拍数、最多几人占槽、最多几人同时出手、名单变更次数。 */
function run(n: number, config: Partial<SquadConfig>, ticks = 7200) {
  const w = arena(n, config)
  const held = new Array(n).fill(0)
  let worstSlots = 0
  let worstAttacks = 0
  for (let tick = 1; tick <= ticks; tick++) {
    w.ai.update(TICK_DT, tick, w.player, w.rhythm)
    w.rhythm.update(TICK_DT)
    let slots = 0
    w.enemies.forEach((e, i) => {
      if (e.squadHasSlot) {
        held[i]++
        slots++
      }
    })
    worstSlots = Math.max(worstSlots, slots)
    worstAttacks = Math.max(worstAttacks, w.enemies.filter((e) => e.attack !== null && e.alive).length)
  }
  return { held, worstSlots, worstAttacks }
}

const expectFair = (held: number[]): void => {
  expect(held.every((h) => h > 0), '每个人都轮到过：' + JSON.stringify(held)).toBe(true)
  expect(
    Math.min(...held) / Math.max(...held),
    '最少 / 最多 = ' + Math.min(...held) + ' / ' + Math.max(...held),
  ).toBeGreaterThan(0.5)
}

describe('KI-381 队列在更多人、更少槽位下也守得住', () => {
  it('五人三槽：最多三人占槽、三人同时出手，五个人都轮得到', () => {
    const r = run(5, {})
    expect(r.worstSlots, '占槽人数').toBeLessThanOrEqual(3)
    expect(r.worstAttacks, '同时出手人数').toBeLessThanOrEqual(3)
    expectFair(r.held)
  })

  it('六人三槽：上限不随人数放宽，六个人都轮得到', () => {
    const r = run(6, {})
    expect(r.worstSlots, '占槽人数').toBeLessThanOrEqual(3)
    expect(r.worstAttacks, '同时出手人数').toBeLessThanOrEqual(3)
    expectFair(r.held)
  })

  it('五人两槽（配置说了算）：上限跟着 squad.json 的 maxAttackSlots 走', () => {
    const r = run(5, { maxAttackSlots: 2 })
    expect(r.worstSlots, '占槽人数').toBeLessThanOrEqual(2)
    expect(r.worstAttacks, '同时出手人数').toBeLessThanOrEqual(2)
    expectFair(r.held)
  })

  it('四人一槽：只剩一格也照样轮转', () => {
    const r = run(4, { maxAttackSlots: 1 })
    expect(r.worstSlots, '占槽人数').toBeLessThanOrEqual(1)
    expect(r.worstAttacks, '同时出手人数').toBeLessThanOrEqual(1)
    expectFair(r.held)
  })
})
