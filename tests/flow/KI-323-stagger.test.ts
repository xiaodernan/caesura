import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import { msToTicks, TICK_HZ } from '@/core/Time'
import { EntityStats } from '@/combat/EntityStats'
import { armCrumple, reactionConfig } from '@/combat/Reactions'
import type { HitReactionTable } from '@/data/schema'

/**
 * KI-323：§14 破势系统——真链上的对账。
 *
 * 数值真源在 `src/data/json/reactions.json`（R4 破势时长）与 `combat/EntityStats.ts`
 * （架势累积/衰减）。这里不抄第二份常数，只钉表⇄运行时的对账：
 *  ① R4 破势时长：普通 1800ms / Boss 2400ms → armCrumple 上弦 ⇒ crumpleTicks
 *  ② 未上弦（构造方漏调 armCrumple）⇒ 架势积满时直接抛错——不是"这只怪免疫破势"
 *  ③ 破势 = 架势条清零 + crumpleTicksLeft > 0；破势期不再叠架势（积满不再触发）
 *  ④ update：无新击 72 tick（1.2s）后，poiseAccum 按 12/s 衰减（×poiseDecayMul）
 *  ⑤ 表里没有 R5 浮空（本作敌人不会离地）
 */
registerGameData()

const r4 = (): HitReactionTable['R4'] => reactionConfig().R4
const armed = (poise = 50): EntityStats => {
  const s = new EntityStats(100, 100, poise)
  armCrumple(s, false)
  return s
}

describe('KI-323 §14 破势：表⇄运行时对账', () => {
  it('R4 破势时长来自 reactions.json（普通/Boss 两格）', () => {
    expect(r4().crumpleMs).toBe(1800)
    expect(r4().bossCrumpleMs).toBe(2400)
  })

  it('armCrumple：普通怪 108 tick / Boss 144 tick（不另立常数，走 msToTicks）', () => {
    const normal = new EntityStats(100, 100, 50)
    armCrumple(normal, false)
    expect(normal.crumpleTicks).toBe(msToTicks(1800))
    expect(normal.crumpleTicks).toBe(108)

    const boss = new EntityStats(800, 100, 200)
    armCrumple(boss, true)
    expect(boss.crumpleTicks).toBe(144)
  })

  it('未上弦 ⇒ 积满时抛错（不是静默免疫）', () => {
    const bare = new EntityStats(100, 100, 10) // 没 armCrumple
    expect(() => bare.addPoise(10, 0)).toThrow()
  })

  it('破势：架势清零 + crumpleTicksLeft 置满；破势期不再叠架势', () => {
    const s = armed(50)
    expect(s.addPoise(50, 0)).toBe(true) // 积满 ⇒ 破势
    expect(s.crumpleTicksLeft).toBe(108)
    expect(s.poiseAccum).toBe(0)
    expect(s.addPoise(100, 1)).toBe(false) // 破势期不叠
    expect(s.crumpleTicksLeft).toBe(108)
  })

  it('update：无新击 72 tick 后 poiseAccum 按 12/s 衰减（×poiseDecayMul）', () => {
    const s = armed(50)
    s.addPoise(30, 100) // lastHitTick=100
    s.update(1 / TICK_HZ, 110, false) // 只过了 10 tick，不衰减
    expect(s.poiseAccum).toBe(30)
    // tick=200（距 lastHit=100，已过 100 tick > 72）开始衰减；一帧 dt=1/60
    s.update(1 / TICK_HZ, 200, false)
    // (12/60) * (1/60 * 60) * 1 = 0.2 / frame，这里只走过一帧
    expect(s.poiseAccum).toBe(29.8)
    // 连续多帧后按 12/s 衰减：过 60 帧 = 12/s 量级
    for (let t = 200; t < 260; t++) s.update(1 / TICK_HZ, t, false)
    expect(s.poiseAccum).toBeLessThan(29.8)
  })

  it('表里没有 R5：本作敌人不会离地', () => {
    const table = registry.get<HitReactionTable>('reactions')
    expect(Object.keys(table).sort()).toEqual(['R0', 'R1', 'R2', 'R3', 'R4'])
    expect(Object.keys(table)).not.toContain('R5')
  })
})
