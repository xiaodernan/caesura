import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, weaponsRaw } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { bus } from '@/core/EventBus'

/**
 * KI-225：**「重击的回报」那一行**第一次在真链上被量（combat.md §3.1 家族定价红线）：
 * 「重击的回报必须住在**架势值（22 对 5）、体力（18 对 8）、噪声（§14 听觉半径 ×1.5）**这些维度里；
 * 轻击的回报住在**出手频率、体力续航、安静、距离（3.2m 突刺）**」。
 *
 * 量的是**后果**（不是只读帧表）：重击那一记**真的落在敌人身上**（敌人涨的架势、掉的血）、
 * 玩家**真的付了体力**、声场总线**真的响了一声**。
 *
 * **量到的与账上要记的两笔**：
 *  ① **§3.1 那句概括的「22 对 5／18 对 8」与 §4.1 逐武器表对不上**
 *     （调律剑：轻击 体力 **9**／架势 **6**，重击 H 体力 **20**／架势 **24**）
 *     ⇒ 逐武器表是 KI-047 裁决的「玩家出手底数的唯一住处」⇒ **以它为准**，但那句概括得记下来。
 *  ② **「§14 听觉半径 ×1.5」那一半在运行时没有半径这一格**（KI-211 量过：半径是敌人表里那一格，
 *     与 loudness 无关）⇒ 噪声那一维真正成立的是**响度**（轻击 0.3 → 重击 0.5）与
 *     **重武器那一族的噪声乘子 1.5**（`wp_fortissimo_greatsword`）。
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
  const noises: number[] = []
  const off = bus.on('sound.source', (p: { id: string; loudness: number }) => {
    if (p.id === 'player') noises.push(p.loudness)
  })

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
  return { time, rhythm, player, ai, combat, frame, tick, noises, off }
}

type World = ReturnType<typeof makeWorld>

describe('KI-225 「重击的回报」那一行：三个维度第一次在真链上被量', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /**
   * 打一记（`'light'` ＝ 轻击；`'heavy'` ＝ 按住重击键不足 8 拍再松手 ⇒ 那一记「重击 H」），
   * 敌人就站在正前方 1.6m ⇒ **那一记真的落在它身上**。
   */
  function swing(w: World, mode: 'light' | 'heavy'): { staSpent: number; foePoise: number; firstNoise: number } {
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: -1.6 }, 'target')
    e.alertness = 0
    e.enter('idle')
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI // 面朝 -z（敌人就在那儿）
    p.camYawRef = Math.PI + p.yaw
    p.stats.stamina = p.stats.staMax
    const sta0 = p.stats.stamina
    const poise0 = e.stats.poiseAccum
    w.noises.length = 0
    if (mode === 'light') {
      w.frame.edges.add('attackLight')
      w.tick()
      w.frame.edges.delete('attackLight')
    } else {
      w.frame.held.add('attackHeavy') // 按住（不足 8 拍 ⇒ 松手出的是「重击 H」）
      for (let i = 0; i < 5; i++) w.tick()
      w.frame.held.delete('attackHeavy')
      w.tick()
    }
    // 体力在**回复起来之前**读（回复曲线 30 拍后才动）⇒ 出手后第一拍就记
    const staSpent = sta0 - p.stats.stamina
    const firstNoise = w.noises.length ? w.noises[0] : 0
    for (let i = 0; i < 40; i++) w.tick()
    return { staSpent, foePoise: e.stats.poiseAccum - poise0, firstNoise }
  }

  it('腿① 架势：重击那一记给敌人涨的架势 ＝ 24，轻击 ＝ 6（§4.1 逐武器表逐字对上；§3.1 那句概括的「22 对 5」对不上 ⇒ 登记）', () => {
    const w = makeWorld()
    const light = swing(w, 'light')
    expect(light.foePoise, '轻击那一记给敌人涨的架势（§4.1 调律剑 L1 那一行）').toBe(6)
    alive.push(w.off)

    const w2 = makeWorld()
    const heavy = swing(w2, 'heavy')
    expect(heavy.foePoise, '重击 H 那一记给敌人涨的架势（§4.1 调律剑「重击 H」那一行）').toBe(24)
    alive.push(w2.off)
  })

  it('腿② 体力：重击那一记付 20，轻击付 9（§4.1 逐武器表逐字对上；§3.1 那句概括的「18 对 8」对不上 ⇒ 登记）', () => {
    const w = makeWorld()
    const light = swing(w, 'light')
    expect(light.staSpent, '轻击那一记付的体力（§4.1 调律剑 L1 那一行）').toBe(9)
    alive.push(w.off)

    const w2 = makeWorld()
    const heavy = swing(w2, 'heavy')
    expect(heavy.staSpent, '重击 H 那一记付的体力（§4.1 调律剑「重击 H」那一行）').toBe(20)
    alive.push(w2.off)
  })

  it('腿③ 噪声：重击那一声更响（0.3 → 0.5）；重武器那一族的噪声乘子 ＝ 1.5（§3.1「噪声 ×1.5」有载体；「§14 听觉半径」那一半没有 ⇒ 登记）', () => {
    const w = makeWorld()
    const light = swing(w, 'light')
    expect(light.firstNoise, '轻击出手那一声（帧表 loudness 3 ⇒ 0.3）').toBeCloseTo(0.3, 6)
    alive.push(w.off)

    const w2 = makeWorld()
    const heavy = swing(w2, 'heavy')
    expect(heavy.firstNoise, '重击出手那一声（帧表 loudness 5 ⇒ 0.5）——比轻击响').toBeCloseTo(0.5, 6)
    expect(heavy.firstNoise, '……而且响得多（重击的回报住在噪声这一维上）').toBeGreaterThan(light.firstNoise)
    alive.push(w2.off)

    const greatsword = weaponsRaw.find((x) => x.id === 'wp_fortissimo_greatsword')!
    expect(greatsword.noiseMul, '重武器那一族的噪声乘子（§3.1 那句「噪声 ×1.5」有载体）').toBe(1.5)
  })
})
