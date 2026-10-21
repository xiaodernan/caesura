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
 * KI-227：**「处决与背刺」那一族**（combat.md §5.4）第一次在真链上被量。
 *
 * | 触发条件 A | 目标处于 Crumple（§7 破势）→ 正面按处决键 |
 * | 触发条件 B | 目标 Alert 但非 Combat，且玩家在其背后 **40° 锥**内 ≤**1.8m** → 潜行处置（杂兵 HP<**35%** 直接静杀；**否则进入背刺动画**） |
 * | 触发条件 C | 共鸣过载 ≥8 → "休止处决"对任意硬直中敌人（耗 8，过载归零） |
 * | 伤害 | A/B：`目标最大 HP × **12%** + **30**`（对 Boss 上限 ×0.6 递减：第二次 8%、第三次 5%）；C：`18% + 45 真伤` |
 * | 演出 | 2.2s 蒙太奇；**演出期玩家无敌**；hitstop 首刀 **180ms** |
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy` ＋ 真 `CombatManager` ＋ 真事件。
 * 敌人被钉住（不许 AI 在结算前把它转开）⇒ 背后那一锥的判据是确定性的。
 */

registerGameData()

const FOE = 'en_tympanus'

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
  const hits: Array<{ result: string; damage: number; hitStopMs: number; backstab: boolean }> = []
  const off = bus.on('combat.hit', (p) => hits.push({ result: p.result, damage: p.damage, hitStopMs: p.hitStopMs, backstab: p.backstab }))

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
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
  return { time, rhythm, player, ai, combat, frame, tick, tickPinned, hits, off }
}

type World = ReturnType<typeof makeWorld>

describe('KI-227 处决与背刺（combat.md §5.4）那一族：第一次在真链上被量', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /** 玩家在原点面朝 +z；敌人在背后那一侧（yaw = π ⇒ 背对玩家） */
  function prey(w: World, opts: { hpFrac?: number; dist?: number; angleDeg?: number } = {}) {
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    const ang = ((opts.angleDeg ?? 0) * Math.PI) / 180
    const d = opts.dist ?? 1.5
    const at = { x: Math.sin(ang) * d, z: -Math.cos(ang) * d, yaw: Math.PI }
    e.pos.x = at.x
    e.pos.z = at.z
    e.yaw = at.yaw
    if (opts.hpFrac !== undefined) e.stats.hp = Math.round(e.stats.hpMax * opts.hpFrac)
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    return { e, at }
  }

  /** 按处决键（interact 边沿），敌人被钉在原处 */
  function pressExecute(w: World, e: ReturnType<World['ai']['spawn']>, at: { x: number; z: number; yaw: number }): void {
    w.frame.edges.add('interact')
    w.tickPinned(() => { e.pos.x = at.x; e.pos.z = at.z; e.yaw = at.yaw })
    w.frame.edges.delete('interact')
  }

  it('腿① 静杀：不知情 ＋ HP ≤ 35% ＋ 背后 ⇒ 它当场死（伤害 ＝ 它剩下的血）', () => {
    const w = makeWorld()
    const { e, at } = prey(w, { hpFrac: 0.3 })
    const hp0 = e.stats.hp
    pressExecute(w, e, at)
    // **35% 是设计那一行的数**（combat.md §5.4「杂兵 HP<35% 直接静杀」）⇒ 腿里手钉设计的数、
    // **不读数据表的数**：读数据表的话，数据一改腿也跟着改 ⇒ 那一格就没人守了。
    expect(hp0, '前提：这只杂兵的血在静杀线（设计写的 35%）以下').toBeLessThanOrEqual(e.stats.hpMax * 0.35)
    expect(e.alive, '静杀 ⇒ 它当场死了（设计 §5.4「杂兵 HP<35% 直接静杀」）').toBe(false)
    expect(hp0 - e.stats.hp, '静杀的伤害 ＝ 它剩下的血（不是 12% + 30）').toBe(hp0)
    expect(w.hits[0]?.backstab, '那一记挂着背刺的标记').toBe(true)
    alive.push(w.off)
  })

  it('腿② 登记：「否则进入背刺动画」那一格没有承载体（HP ≥ 35% 的不知情杂兵 ⇒ 什么也不发生）', () => {
    const w = makeWorld()
    const { e, at } = prey(w, { hpFrac: 1 })
    const hp0 = e.stats.hp
    pressExecute(w, e, at)
    expect(e.alive, '**登记**：设计 §5.4 触发条件 B 说"否则进入背刺动画"，而运行时**什么也不发生**（健康杂兵连处决键都不接）')
      .toBe(true)
    expect(e.stats.hp, '……它一根汗毛都没掉').toBe(hp0)
    expect(w.hits.length, '……也没有任何一刀').toBe(0)
    alive.push(w.off)
  })

  it('腿③ 那扇门：背后 40° 锥 ＋ ≤1.8m（偏 50° 或 2.2m ⇒ 什么也不发生）', () => {
    // **40° 与 1.8m 是设计那一行的数**（combat.md §5.4 触发条件 B）⇒ 门外的两个反例也照设计的数推
    const w = makeWorld()
    const cone = prey(w, { hpFrac: 0.3, angleDeg: 50 }) // 50° ＝ 设计的 40° ＋ 10
    pressExecute(w, cone.e, cone.at)
    expect(cone.e.alive, '偏 50°（锥外 40°）⇒ 处决键不接').toBe(true)
    alive.push(w.off)

    const w2 = makeWorld()
    const range = prey(w2, { hpFrac: 0.3, dist: 2.2 }) // 2.2m ＝ 设计的 1.8m ＋ 0.4
    pressExecute(w2, range.e, range.at)
    expect(range.e.alive, '2.2m（射程外 1.8m）⇒ 处决键不接').toBe(true)
    alive.push(w2.off)
  })

  it('腿④ 处决（条件 A）的伤害 ＝ 目标最大 HP × 12% + 30，且 hitstop 首刀 180ms', () => {
    const w = makeWorld()
    const { e, at } = prey(w, { hpFrac: 1 })
    e.stats.crumpleTicksLeft = 60 // 破势中 ⇒ 触发条件 A
    const hpMax = e.stats.hpMax
    pressExecute(w, e, at)
    const hit = w.hits[0]
    expect(hit, '那一刀该落下').toBeTruthy()
    // **12% 与 30、180ms 都是设计那一行的数**（§5.4 伤害行 ＋ 演出行）⇒ 腿里手钉设计的数
    expect(hit!.damage, `伤害 ＝ 最大 HP × 12% + 30（设计 §5.4 伤害行：${hpMax} × 0.12 + 30）`)
      .toBe(Math.round(hpMax * 0.12 + 30))
    expect(hit!.hitStopMs, 'hitstop 首刀 180ms（设计 §5.4 演出行）').toBe(180)
    expect(w.player.executing, '处决演出开始了').not.toBeNull()
    alive.push(w.off)
  })

  it('腿⑤ 演出期玩家无敌：处决演出期间挨一记 ⇒ 一个字节都不掉', () => {
    const w = makeWorld()
    const { e, at } = prey(w, { hpFrac: 0.3 })
    pressExecute(w, e, at)
    expect(w.player.executing, '前提：处决演出在进行').not.toBeNull()
    const hp0 = w.player.stats.hp
    expect(w.player.takeDamage(50, { x: 0, y: 0, z: 1 }), '那一记被挡在门外（`iFrame` 在演出期恒真）').toBe(false)
    expect(w.player.stats.hp, '演出期玩家无敌（设计 §5.4 演出行）').toBe(hp0)
    alive.push(w.off)
  })
})
