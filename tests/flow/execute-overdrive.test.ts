import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { bus } from '@/core/EventBus'

/**
 * KI-229：**「§5.4 伤害行」剩下的两格**第一次在真链上被量。
 *
 * | 触发条件 C | 共鸣过载 ≥8 → "休止处决"对任意硬直中敌人（耗 8，过载归零） |
 * | 伤害 | A/B：`目标最大 HP × 12% + 30`（对 Boss 上限 ×0.6 递减：第二次 8%、第三次 5%）；**C：`18% + 45 真伤`** |
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy` ＋ 真 `CombatManager` ＋ 真事件；
 * 敌人被钉住（不许 AI 在结算前把它转开）。
 *
 * **腿里手钉的是设计那一行的数**（8／18%／45／12%／8%／5%），**不读数据表的数**——
 * 读数据表的话，数据一改腿也跟着改 ⇒ 那一格就没人守了。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const hits: Array<{ damage: number; hitStopMs: number }> = []
  const off = bus.on('combat.hit', (p) => hits.push({ damage: p.damage, hitStopMs: p.hitStopMs }))

  /** 只走一格，但在 `ai.update` 与 `combat.update` **之间**插一刀（敌人不许在结算前转开） */
  function tickPinned(pin: () => void, n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      pin()
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tickPinned, hits, off }
}

type World = ReturnType<typeof makeWorld>

describe('KI-229 §5.4 伤害行剩下的两格：休止处决（条件 C）与 Boss 那条递减', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /** 玩家在原点；敌人在 1.5m 处（处决射程内），被钉住 */
  function prey(w: World, id: string) {
    const at = { x: 0, z: -1.5, yaw: Math.PI }
    const e = w.ai.spawn(id, { x: at.x, y: 0, z: at.z }, 'prey')
    e.alertness = 0
    e.enter('idle')
    e.pos.x = at.x
    e.pos.z = at.z
    e.yaw = at.yaw
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    return { e, at }
  }
  function press(w: World, e: ReturnType<World['ai']['spawn']>, at: { x: number; z: number; yaw: number }): void {
    w.frame.edges.add('interact')
    w.tickPinned(() => { e.pos.x = at.x; e.pos.z = at.z; e.yaw = at.yaw })
    w.frame.edges.delete('interact')
  }

  it('腿① 触发条件 C：过载 ≥ 8 ＋ 硬直中的敌人 ⇒ 处决落下（伤害 ＝ 最大 HP × 18% + 45）＋ 过载归零', () => {
    const w = makeWorld()
    const { e, at } = prey(w, 'en_tympanus')
    e.stunTicks = 60 // 硬直中 ⇒ stalled
    w.player.stats.overdrive = 8
    const hpMax = e.stats.hpMax
    const hp0 = e.stats.hp
    press(w, e, at)
    expect(w.hits.length, '那一刀该落下').toBe(1)
    expect(w.hits[0]!.damage, `伤害 ＝ 最大 HP × 18% + 45（设计 §5.4 伤害行：${hpMax} × 0.18 + 45）`)
      .toBe(Math.round(hpMax * 0.18 + 45))
    expect(hp0 - e.stats.hp, '……它真的挨了那一刀').toBe(w.hits[0]!.damage)
    expect(w.player.stats.overdrive, '过载归零（耗 8，设计 §5.4 触发条件 C）').toBe(0)
    alive.push(w.off)
  })

  it('腿② 过载不足 8 ⇒ 不接（什么也不发生）', () => {
    const w = makeWorld()
    const { e, at } = prey(w, 'en_tympanus')
    e.stunTicks = 60
    w.player.stats.overdrive = 7
    const hp0 = e.stats.hp
    press(w, e, at)
    expect(w.hits.length, '过载不够 ⇒ 处决键不接').toBe(0)
    expect(e.stats.hp, '……它一根汗毛都没掉').toBe(hp0)
    expect(w.player.stats.overdrive, '……过载也没被消耗').toBe(7)
    alive.push(w.off)
  })

  it('腿③ 那 45（与那 18%）是真伤：把敌人的防御拉到 100 ⇒ 伤害一个字节都不变', () => {
    const w = makeWorld()
    const { e, at } = prey(w, 'en_tympanus')
    e.stunTicks = 60
    e.stats.defense = 100 // 防御拉满：走防御阶梯的话伤害会被削掉
    w.player.stats.overdrive = 8
    const hpMax = e.stats.hpMax
    press(w, e, at)
    expect(w.hits[0]?.damage, '伤害没被防御削掉 ⇒ 那 45 与那 18% 都是真伤（设计 §5.4 伤害行 C）')
      .toBe(Math.round(hpMax * 0.18 + 45))
    alive.push(w.off)
  })

  it('腿④ Boss 那条递减：第一次 12%、第二次 8%、第三次 5%', () => {
    const w = makeWorld()
    const { e, at } = prey(w, 'en_ostlara')
    e.skipIntro()
    const hpMax = e.stats.hpMax
    const damages: number[] = []
    for (let i = 0; i < 3; i++) {
      e.stats.crumpleTicksLeft = 60
      const hp0 = e.stats.hp
      press(w, e, at)
      damages.push(hp0 - e.stats.hp)
      e.stats.hp = hpMax // 每一刀都从满血重来
      w.player.executing = null
      w.player.action = null
    }
    expect(damages[0], `第一次 12%（设计 §5.4 伤害行「对 Boss 上限 ×0.6 递减」：${hpMax} × 0.12）`)
      .toBe(Math.round(hpMax * 0.12))
    expect(damages[1], '第二次 8%').toBe(Math.round(hpMax * 0.08))
    expect(damages[2], '第三次 5%').toBe(Math.round(hpMax * 0.05))
    alive.push(w.off)
  })
})
