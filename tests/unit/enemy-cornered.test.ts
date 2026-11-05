import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-398：§14 状态表的 Retreat 有两条出口——「距离恢复→Combat」与「被追上→Combat（攻速 +10% 困兽）」。
 *
 * 实现此前只有第一条：`dist > 10` 回战斗，或者伤好了回战斗。玩家贴着伤员追时，它就永远在撤退态里
 * 一边退一边吃刀（设计里的「背向逃 4m 或拉距」不会成功，`retreat` 也没有别的出口）。
 * 这批补上第二条：退开 0.4 秒（与 `chase` 的 `stateTick > 24` 同一条呼吸拍）之后玩家**还贴在它自己的
 * 近身带里**（`distBands[0]`，表里就是它够得着的那一条）⇒ 回头打，招式帧推进 ×1.1。
 *
 * 四条腿：
 *  ① 被追上：玩家每拍粘在 1.5m ⇒ 第 26 拍转回战斗、`cornered` 为真；
 *  ② 没被追上：玩家站住不动 ⇒ 它退到 10 米外回战斗，`cornered` 为假（撤退那条路不回退）；
 *  ③ 攻速真加了：同一招 `shrill`，困兽到判定帧 79 拍、对照组 86 拍（≈1/1.1），两侧都正好落在
 *     `activeStart` 那一格上（`advanceAttackFrames` 的钳制照旧：更快落爪不等于更长的判定窗）；
 *  ④ 反向臂：把「被追上」那一格关掉（`playerInPressingBand` 恒假）⇒ 玩家怎么粘都还在撤退。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({
    pos: { x, y: 0, z },
    hitTarget: () => ({ height: 1.7 }),
    stats: { stamina: 100, staMax: 100 },
    grounded: true,
    action: null,
  } as unknown as PlayerController)

function arena() {
  const ai = new AISystem({ maxAttackSlots: 3 })
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const player = fakePlayer(0, -1.5)
  const e = ai.spawn('en_driftsinger', { x: 0, y: 0, z: 0 }, 'cornered')
  e.alertness = 100
  e.enter('combat')
  return { ai, rhythm, player, e }
}

/** 玩家永远贴着 1.5 米（从敌人那一侧看过去），模拟「追着砍」 */
function gluePlayer(w: ReturnType<typeof arena>): void {
  const dx = w.player.pos.x - w.e.pos.x
  const dz = w.player.pos.z - w.e.pos.z
  const d = Math.hypot(dx, dz) || 1
  w.player.pos.x = w.e.pos.x + (dx / d) * 1.5
  w.player.pos.z = w.e.pos.z + (dz / d) * 1.5
}

describe('KI-398 撤退的第二条出口：被追上就变困兽', () => {
  it('玩家粘着追 ⇒ 半秒后退开无望，转回战斗且攻速挂上 +10%', () => {
    const w = arena()
    w.e.stats.hp = w.e.stats.hpMax * 0.25
    let retreated = -1
    let corneredAt = -1
    for (let tick = 1; tick <= 400; tick++) {
      if (tick > 1 && w.e.state === 'retreat') gluePlayer(w)
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      if (w.e.state === 'retreat' && retreated < 0) retreated = tick
      if (w.e.cornered && corneredAt < 0) corneredAt = tick
    }
    expect(retreated, '25% 血线进了撤退').toBeGreaterThan(0)
    expect(corneredAt, '先跑半步（24 拍）才判被追上').toBeGreaterThan(24)
    expect(corneredAt, '不该拖成一整秒').toBeLessThanOrEqual(40)
    expect(w.e.state, '已经在战斗态里').toBe('combat')
    expect(w.e.cornered, '困兽标记挂着').toBe(true)
  })

  it('玩家不追 ⇒ 它照设计拉开 10 米回战斗，不带困兽', () => {
    const w = arena()
    w.e.stats.hp = w.e.stats.hpMax * 0.25
    let retreated = -1
    let backToCombat = -1
    for (let tick = 1; tick <= 400; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      if (w.e.state === 'retreat' && retreated < 0) retreated = tick
      if (retreated > 0 && w.e.state !== 'retreat' && backToCombat < 0) backToCombat = tick
    }
    expect(backToCombat, '撤退有终点').toBeGreaterThan(0)
    expect(w.e.state).toBe('combat')
    expect(w.e.cornered, '没被追上就不是困兽').toBe(false)
  })

  it('困兽那 10% 真落在帧推进上：同一招到判定帧 79 拍对 86 拍', () => {
    const swing = (cornered: boolean) => {
      const w = arena()
      w.e.data = { ...w.e.data, ai: { ...w.e.data.ai, distBands: [{ min: 0, max: 99, actions: ['shrill'] }] } }
      w.e.cornered = cornered
      let start = -1
      let active = -1
      let frameAtActive = -1
      for (let tick = 1; tick <= 400 && active < 0; tick++) {
        w.ai.update(TICK_DT, tick, w.player, w.rhythm)
        w.rhythm.update(TICK_DT)
        if (w.e.attack && start < 0) start = tick
        if (w.e.attack && start > 0 && w.e.attack.tick >= w.e.attack.spec.frames.activeStart) {
          active = tick
          frameAtActive = w.e.attack.tick
        }
      }
      expect(start, '这一招起手了').toBeGreaterThan(0)
      expect(frameAtActive, '钳制照旧：落在判定窗第一格，不从里面扣').toBe(w.e.attack!.spec.frames.activeStart)
      return active - start
    }
    const normal = swing(false)
    const fast = swing(true)
    expect(normal, '对照组真的有 86 拍这么长').toBeGreaterThan(60)
    expect(fast, '困兽更短').toBeLessThan(normal)
    expect(fast / normal, '≈1/1.1（0.909），不是随手给个更快').toBeGreaterThan(0.87)
    expect(fast / normal).toBeLessThan(0.95)
  })

  it('反向臂：关掉「被追上」那一格 ⇒ 玩家怎么粘都还在撤退', () => {
    const w = arena()
    w.e.stats.hp = w.e.stats.hpMax * 0.25
    type Proto = { playerInPressingBand: (dist: number) => boolean }
    const proto = Enemy.prototype as unknown as Proto
    const original = proto.playerInPressingBand
    proto.playerInPressingBand = () => false
    let retreatTicks = 0
    let corneredAt = -1
    try {
      for (let tick = 1; tick <= 400; tick++) {
        if (tick > 1 && w.e.state === 'retreat') gluePlayer(w)
        w.ai.update(TICK_DT, tick, w.player, w.rhythm)
        w.rhythm.update(TICK_DT)
        if (w.e.state === 'retreat') retreatTicks++
        if (w.e.cornered && corneredAt < 0) corneredAt = tick
      }
    } finally {
      proto.playerInPressingBand = original
    }
    expect(retreatTicks, '旧行为：粘着追也永远在撤退').toBeGreaterThan(350)
    expect(corneredAt, '困兽一次都没触发').toBe(-1)
  })
})
