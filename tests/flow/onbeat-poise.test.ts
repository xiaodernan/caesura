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
 * KI-245：**拍点那两条奖励（§2 那一行与 §4.1／§4.2 的「独特属性」两行）在真链上被量**。
 *
 * 设计的三句话：
 * - **§2 玩家侧**：进阶奖励：命中帧落在拍点 ±50ms 内 → **架势伤害 +1**（"踏音加成"，HUD 以极淡涟漪提示）。
 * - **§4.1 直剑「独特属性」那一行**：左手律具：可弹反（§5.3）；**拍点加成 ×2 架势（踏音）**。
 * - **§4.2 大剑「独特属性」那一行**：攻击声半径 ×1.5；**所有命中在拍点时 hitstop 额外 +30ms**。
 *
 * 真读数：拍点内外的**敌人架势累积**（`Enemy.stats.poiseAccum`）＋ 事件里报出来的 `poiseDamage`。
 * KI-243 已经量过那条 +30ms（运行时给**每把**武器，设计只写在 §4.2 大剑那一行 ⇒ 登记）；
 * 这一批量它的另一半：**架势 ×2**。
 *
 * **拍相位必须钉住**（KI-243 的纪律）：不钉相位，同一格读数会随拍在「底数」与「底数+30／×2」之间漂。
 * 每条腿都先把拍相位**冻在拍点（0）**或**拍与拍的正中间（0.5）**再出手。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 * 设计那一行与真读数对不上时**腿钉住真读数、把差额写进消息** ⇒ 只量不裁（设计没裁）。
 */

registerGameData()

type Mode = 'light' | 'heavy'

function makeWorld(weaponId: string) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const hits: Array<{ result: string; hitStopMs: number; damage: number; poiseDamage: number }> = []
  const off = bus.on('combat.hit', (p) => hits.push({
    result: p.result, hitStopMs: p.hitStopMs, damage: p.damage, poiseDamage: p.poiseDamage,
  }))
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, off }
}

type World = ReturnType<typeof makeWorld>

/** 把拍相位钉在 target（0.5 = 拍与拍的正中间；0 = 拍点）并冻住 */
function freezePhase(w: World, target: number): void {
  for (let i = 0; i < 200; i++) {
    if (Math.abs(w.rhythm.info().phase - target) < 0.012) break
    w.tick()
  }
  w.rhythm.paused = true
}

/** 出手一记，返回敌人身上的架势累积 ＋ 事件报出来的数 */
function swing(w: World, mode: Mode): { poise: number; reported: number } {
  const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'probe')
  e.alertness = 0
  e.enter('idle')
  const p = w.player
  p.pos = { x: 0, y: 0, z: 0 }
  p.yaw = Math.PI
  p.camYawRef = Math.PI + p.yaw
  if (mode === 'light') {
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
  } else {
    w.frame.held.add('attackHeavy')
    for (let i = 0; i < 5; i++) w.tick()
    w.frame.held.delete('attackHeavy')
    w.tick()
  }
  for (let i = 0; i < 120 && w.hits.length === 0; i++) w.tick()
  return { poise: e.stats.poiseAccum, reported: w.hits.length ? w.hits[0].poiseDamage : -1 }
}

/** 同一把武器，拍点内外各打一记 */
function pair(weaponId: string, mode: Mode): { off: { poise: number; reported: number }; on: { poise: number; reported: number } } {
  const a = makeWorld(weaponId)
  freezePhase(a, 0.5)
  const off = swing(a, mode)
  a.off()
  const b = makeWorld(weaponId)
  freezePhase(b, 0.0)
  const on = swing(b, mode)
  b.off()
  return { off, on }
}

describe('KI-245 拍点那两条奖励：架势 ×2 到底是谁的、报给谁看', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 直剑的轻击：拍点外 6 → 拍点内 12（×2；设计 §2 那一行写的是「+1」⇒ 登记）', () => {
    const p = pair('wp_tuning_sword', 'light')
    expect(p.off.poise, '拍点外那一记的架势伤害（直剑 L1 的架式底数 6）').toBe(6)
    expect(p.on.poise, '拍点内那一记的架势伤害（×2；设计 §4.1 直剑那行写的是「拍点加成 ×2 架势」，**§2 那一行写的是「+1」** ⇒ 两句设计自己就对不上 ⇒ 登记）').toBe(12)
  })

  it('腿② 直剑的重击：拍点外 24 → 拍点内 48（×2）', () => {
    const p = pair('wp_tuning_sword', 'heavy')
    expect(p.off.poise, '拍点外那一记的架势伤害（直剑重击 H 的架式底数 24）').toBe(24)
    expect(p.on.poise, '拍点内那一记的架势伤害（×2）').toBe(48)
  })

  it('腿③ 枪的轻击：拍点外 5 → 拍点内 10（×2；设计只把这条写给直剑 ⇒ 归属登记）', () => {
    const p = pair('wp_drawpin_spear', 'light')
    expect(p.off.poise, '拍点外那一记的架势伤害（枪 L1 的架式底数 5）').toBe(5)
    expect(p.on.poise, '拍点内那一记的架势伤害（×2 ⇒ **设计只把「拍点加成 ×2 架势」写在 §4.1 直剑那一行**，枪也吃到了 ⇒ 归属没裁，登记）').toBe(10)
  })

  it('腿④ 大剑的轻击：拍点外 28 → 拍点内 55（×2 ＋ 这把武器自己的架式倍率 1.25）', () => {
    const p = pair('wp_fortissimo_greatsword', 'light')
    expect(p.off.poise, '拍点外那一记的架子伤害（大剑 L1 的底数 22 ＋ 它自己的架式倍率 1.25 ＝ 27.5 取整 28）').toBe(28)
    expect(p.on.poise, '拍点内那一记的架势伤害（22 × 2 × 1.25 ＝ 55 ⇒ 拍点那一份是 ×2，设计 §4.2 大剑那一行只给了它 +30ms 停顿、没给架势）').toBe(55)
  })

  it('腿⑤ 静默针的轻击：拍点外 4 → 拍点内 8（×2 ⇒ 归属登记）', () => {
    const p = pair('wp_needlesilence', 'light')
    expect(p.off.poise, '拍点外那一记的架势伤害（静默针 L1 的架式底数 4）').toBe(4)
    expect(p.on.poise, '拍点内那一记的架势伤害（×2 ⇒ 归属登记）').toBe(8)
  })

  it('腿⑥ 弓的轻击：拍点外 6 → 拍点内 12（×2 ⇒ 归属登记）', () => {
    const p = pair('wp_overtone_bow', 'light')
    expect(p.off.poise, '拍点外那一记的架势伤害（弓 L1 的架式底数 6）').toBe(6)
    expect(p.on.poise, '拍点内那一记的架势伤害（×2 ⇒ 归属登记）').toBe(12)
  })

  it('腿⑦ 杖的轻击：拍点外 4 → 拍点内 8（×2 ⇒ 归属登记）', () => {
    const p = pair('wp_tuningfork_staff', 'light')
    expect(p.off.poise, '拍点外那一记的架势伤害（杖 L1 的架式底数 4）').toBe(4)
    expect(p.on.poise, '拍点内那一记的架势伤害（×2 ⇒ 归属登记）').toBe(8)
  })

  it('腿⑧ 事件里的 `poiseDamage` 报的是**底数**（拍点内外都是 6）⇒ 「这一记踩在拍点上」这件事没有承载体', () => {
    const p = pair('wp_tuning_sword', 'light')
    expect(p.off.reported, '拍点外那一记事件报出来的架式数').toBe(6)
    expect(p.on.reported, '拍点内那一记事件报出来的架式数（**还是底数** ⇒ 事件里没有「踩在拍点上」这一格 ⇒ 想做那圈涟漪提示的人从这条事件上读不到 ⇒ 登记）').toBe(6)
  })
})
