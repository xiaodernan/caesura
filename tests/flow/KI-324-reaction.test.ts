import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { msToTicks } from '@/core/Time'
import { EntityStats } from '@/combat/EntityStats'
import {
  armCrumple,
  materialFlashSeconds,
  reactionConfig,
  reactionTier,
} from '@/combat/Reactions'
import type { HitReactionTable } from '@/data/schema'

/**
 * KI-324：反应系统登记——框架声明与消费者核对。
 *
 * 数值真源在 `src/data/json/reactions.json`，这里只钉**表⇄运行时**的口径：
 *  ① R0 材质发光 flashMs = 150ms ⇒ `materialFlashSeconds()` = 0.15（Enemy.onDamaged 的消费方）
 *  ② R1 轻击中断 stunMs = 200ms、位移 0.2m ⇒ `reactionTier('R1')` = { stunTicks: 12, displaceM: 0.2 }
 *  ③ R2 重击硬直 stunMs = 350ms、位移 0.5m ⇒ `reactionTier('R2')` = { stunTicks: 21, displaceM: 0.5 }
 *  ④ R3 重硬直 stunMs = 600ms、位移 2m ⇒ `reactionTier('R3')` = { stunTicks: 36, displaceM: 2 }
 *  ⑤ R4 破势：普通 1800ms ⇒ 108 tick；Boss 2400ms ⇒ 144 tick（armCrumple 上弦）
 *  ⑥ R5 浮空不写——表里只有 R0–R4（本作敌人不会离地）
 *
 * 设计值读表现推，不手钉数值：表一改，腿该红在"换算"那一格，而不是抄第二份数。
 */
registerGameData()

describe('KI-324 反应系统：表 ⇄ 运行时对账', () => {
  it('表里恰好 R0–R4（R5 浮空本作不写）', () => {
    const table = registry.get<HitReactionTable>('reactions')
    expect(Object.keys(table).sort()).toEqual(['R0', 'R1', 'R2', 'R3', 'R4'])
    expect(Object.keys(table)).not.toContain('R5')
  })

  it('R0 材质发光：flashMs → 秒（材料闪烁 0.15s，Enemy.onDamaged 的消费方）', () => {
    expect(reactionConfig().R0.flashMs).toBe(150)
    expect(materialFlashSeconds()).toBeCloseTo(0.15, 10)
  })

  it('R1 轻击中断：stunMs/displaceM → ticks（msToTicks 换算，不另立常数）', () => {
    const t = reactionTier('R1')
    expect(t.stunTicks).toBe(msToTicks(200))
    expect(t.displaceM).toBe(0.2)
    expect(t.stunTicks).toBe(12)
  })

  it('R2 重击硬直：stunMs/displaceM → ticks', () => {
    const t = reactionTier('R2')
    expect(t.stunTicks).toBe(msToTicks(350))
    expect(t.displaceM).toBe(0.5)
    expect(t.stunTicks).toBe(21)
  })

  it('R3 硬直：stunMs/displaceM → ticks', () => {
    const t = reactionTier('R3')
    expect(t.stunTicks).toBe(msToTicks(600))
    expect(t.displaceM).toBe(2)
    expect(t.stunTicks).toBe(36)
  })

  it('R4 破势：普通 1800ms ⇒ 108 tick；Boss 2400ms ⇒ 144 tick（armCrumple 上弦）', () => {
    const normal = new EntityStats(100, 100, 50)
    armCrumple(normal, false)
    expect(normal.crumpleTicks).toBe(msToTicks(1800))
    expect(normal.crumpleTicks).toBe(108)

    const boss = new EntityStats(800, 100, 100)
    armCrumple(boss, true)
    expect(boss.crumpleTicks).toBe(msToTicks(2400))
    expect(boss.crumpleTicks).toBe(144)
  })

  it('reactionTier 只收 R1/R2/R3——R4 是破势账，R0 是材质发光，都不走这条桥', () => {
    expect(Object.keys(reactionConfig()).sort()).toEqual(['R0', 'R1', 'R2', 'R3', 'R4'])
  })
})
