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
 * KI-231：**「重击的回报」那一行的第四维（击倒/震裂层数）**第一次在真链上被量
 * （combat.md §3.1：「重击的回报必须住在**架势值、体力、噪声、击倒/震裂层数**这些维度里」；
 * §11 的震裂规则在 `data/json/statuses.json`：`maxLayers 5`／`burst {trueDamage 20, poise 40}`）。
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy` ＋ 真 `CombatManager` ＋ 真事件；
 * 敌人被钉住（不许它挨完打之后走开，否则下一记打空）。
 */

registerGameData()

function makeWorld(weaponId = 'wp_tuning_sword') {
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
  const off = bus.on('combat.hit', () => { /* 那一记真的落在敌人身上就够读了 */ })

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
  return { time, rhythm, player, ai, combat, frame, tick, off }
}

type World = ReturnType<typeof makeWorld>

describe('KI-231 震裂层数：「重击的回报」那一行的第四维第一次在真链上被量', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /** 敌人站在正前方 1.6m；打一记（`light` 轻击／`heavy` 重击 H／`charged` 蓄力重击）⇒ 返回敌人身上的震裂层数 */
  function swing(w: World, mode: 'light' | 'heavy' | 'charged'): number {
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI // 面朝 -z（敌人就在那儿）
    p.camYawRef = Math.PI + p.yaw
    p.stats.stamina = p.stats.staMax
    if (mode === 'light') {
      w.frame.edges.add('attackLight')
      w.tick()
      w.frame.edges.delete('attackLight')
    } else {
      w.frame.held.add('attackHeavy')
      for (let i = 0; i < (mode === 'charged' ? 60 : 5); i++) w.tick()
      w.frame.held.delete('attackHeavy')
      w.tick()
    }
    // 等那一记真的落在敌人身上（判定窗在起手之后 ⇒ 不能刚出手就读）
    const hp0 = e.stats.hp
    for (let i = 0; i < 60 && e.stats.hp === hp0; i++) {
      e.pos.x = 0
      e.pos.z = -1.6
      e.yaw = 0
      w.tick()
    }
    return e.stats.fissureLayers
  }

  it('腿① 轻击不挂震裂（0 层）', () => {
    const w = makeWorld()
    expect(swing(w, 'light'), '轻击那一记不给敌人挂震裂层（重击的回报才在这一维上）').toBe(0)
    alive.push(w.off)
  })

  it('腿② 重击挂 1 层震裂（帧表的按键默认：h ＝ 1）', () => {
    const w = makeWorld()
    expect(swing(w, 'heavy'), '重击 H 那一记给敌人挂 1 层震裂（设计 §3.1「重击的回报住在…击倒/震裂层数」）').toBe(1)
    alive.push(w.off)
  })

  it('腿③ 蓄力重击挂 2 层震裂（帧表的按键默认：charged ＝ 2）', () => {
    const w = makeWorld()
    expect(swing(w, 'charged'), '蓄力重击那一记给敌人挂 2 层震裂').toBe(2)
    alive.push(w.off)
  })

  it('腿④ 层数满了（5 层）⇒ 爆裂：真伤 20 ＋ 层数归零', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI
    p.camYawRef = Math.PI + p.yaw
    const layers: number[] = []
    const hpLost: number[] = []
    for (let i = 0; i < 6; i++) {
      p.stats.stamina = p.stats.staMax
      e.stats.hp = e.stats.hpMax
      const hp0 = e.stats.hp
      w.frame.held.add('attackHeavy')
      for (let k = 0; k < 5; k++) w.tick()
      w.frame.held.delete('attackHeavy')
      w.tick()
      for (let k = 0; k < 60 && e.stats.hp === hp0; k++) {
        e.pos.x = 0
        e.pos.z = -1.6
        e.yaw = 0
        w.tick()
      }
      layers.push(e.stats.fissureLayers)
      hpLost.push(Math.round((hp0 - e.stats.hp) * 10) / 10)
      // 等这一式收完（重击 H 的收势 63 拍 ⇒ 不等的话下一记根本出不来）
      for (let k = 0; k < 120 && p.action; k++) {
        e.pos.x = 0
        e.pos.z = -1.6
        e.yaw = 0
        w.tick()
      }
    }
    expect(layers.slice(0, 4), '前四记各挂一层（1／2／3／4）').toEqual([1, 2, 3, 4])
    expect(layers[4], '第五记把层数顶满 ⇒ 爆裂 ⇒ 层数归零').toBe(0)
    expect(layers[5], '第六记重新从 1 层起').toBe(1)
    // 第五记多挨了**爆裂的真伤 20**（`statuses.json > fissure.burst.trueDamage`）
    const burstExtra = hpLost[4] - hpLost[0]
    expect(burstExtra, '爆裂那一记比平常多挨 20 点真伤（设计 §11 的震裂规则）').toBeGreaterThan(15)
    alive.push(w.off)
  })
})
