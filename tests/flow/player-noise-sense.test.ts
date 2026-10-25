import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { enemiesRaw, registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem } from '@/world/Streaming'
import { bus } from '@/core/EventBus'
import type { Enemy } from '@/ai/Enemy'

/**
 * KI-211：**「噪声 loudness → 侦测半径」的映射**第一次在真链上被量（KI-204 的「没做①」那一格）。
 *
 * 设计那边有两行都要"半径跟声音/动作走"：
 *  · combat.md §13.0 听觉 Sound：「全局事件总线：攻击/弓弦/破坏/弹反冲击**按噪音半径广播**」；
 *  · combat.md §13.0 震感 Vibration：「**半径 4-10m** 内移动/落地/疾跑触发（**静步半径 12m→4m**，
 *    见 gameplay.md §3.1）｜**静止=对震感隐形**」。
 *
 * 真链上量到的读数是：**半径根本不跟噪声走**——
 *  · **听觉那一路**：半径是**每个敌人表里那一格**（`ai.hearing.range`），
 *    `loudness` 只改**警觉值涨得多快**（×120），不参与"能不能听见"；
 *  · **震感那一路**：半径也是**敌人表里那一格**（`ai.vibration.range`），
 *    判据是"距离 ＋ 移动读数"，**一个字节的 loudness 都不看**。
 *
 * **"移动读数"到底是什么**（本批量到的一条）：`playerIsMoving` 判的是
 * **体力未回满 ＋ 落地 ＋ 有朝向 ＋ 不在招式里**——**不是速度** ⇒
 * 「静止=对震感隐形」那一半的判据其实是"**体力回满**"：站着不动但喘着气，一样会被震感发现。
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy` ＋ 真 `AISystem`（感知 10Hz 轮转）＋ 真声场总线。
 * 敌人钉在原点、脸朝 +z，玩家在它**背后** ⇒ 视觉那一支不成立，量到的只有震感／听觉。
 */

const FOE = 'en_tympanus'

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const offs: Array<() => void> = []

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  const off = (): void => { for (const f of offs.splice(0)) f() }
  return { time, rhythm, player, ai, combat, streaming, frame, tick, off }
}

type World = ReturnType<typeof makeWorld>

/** 敌人钉在原点、脸朝 +z（玩家在它背后 ⇒ 视觉那一支不成立） */
function pinEnemy(e: Enemy): void {
  e.pos.x = 0
  e.pos.z = 0
  e.yaw = 0
}

describe('KI-211 噪声 loudness → 侦测半径：真链上量到的是「半径与噪声无关」', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /**
   * **震感那一路**：玩家站在敌人背后 d 米处，站 12 拍（感知 10Hz ⇒ 两轮），读警觉值。
   *
   * 玩家**一步都不走** ⇒ 脚步一声没出 ⇒ 听觉那一路一个字都收不到
   * ⇒ 这一段量到的**只有震感**（"移动"的读数由体力撑着，见下）。
   */
  function sensed(w: World, e: Enemy, d: number, opts: { spent?: boolean } = {}): number {
    e.alertness = 0
    e.enter('idle')
    w.player.pos = { x: 0, y: 0, z: -d }
    w.player.grounded = true
    w.player.action = null
    w.player.camYawRef = 0
    for (let i = 0; i < 12; i++) {
      pinEnemy(e)
      // 体力每拍钉回去：回复曲线几拍就能把它填满 ⇒ 「移动」的读数会中途消失
      w.player.stats.stamina = opts.spent === false ? w.player.stats.staMax : w.player.stats.staMax - 1
      w.tick()
    }
    const a = e.alertness
    e.alertness = 0
    e.enter('idle')
    return a
  }

  /**
   * **每一记脚步给敌人涨了多少警觉值**（逐拍把警觉值清零 ⇒ 读到的就是"这一记"）。
   *
   * 玩家在 **12m** 处走：那是**震感半径外、听觉半径内**（`vibration.range` 10 ／ `hearing.range` 14）
   * ⇒ 这一段量到的**只有听觉那一路**。
   */
  function stepGains(w: World, e: Enemy, stick: [number, number], sprint: boolean, ticks = 120): number[] {
    const gains: number[] = []
    const handler = (p: { id: string; loudness: number }): void => {
      if (p.id === 'player') gains.push(e.alertness) // 敌人的 hear() 先跑（总线上的听众按注册顺序）⇒ 这里已经是涨完的数
    }
    const off = bus.on('sound.source', handler)
    alive.push(off)
    e.alertness = 0
    e.enter('idle')
    w.player.pos = { x: 0, y: 0, z: -12 }
    w.player.stats.stamina = w.player.stats.staMax - 1
    w.frame.move = { x: stick[0], y: stick[1] }
    w.frame.held = sprint ? new Set(['sprint']) : new Set<string>()
    for (let i = 0; i < ticks; i++) {
      e.alertness = 0 // 逐拍清零 ⇒ 读到的就是"这一记"涨了多少（衰减在一拍里可以忽略）
      pinEnemy(e)
      w.player.pos.x = 0
      w.player.pos.z = -12
      w.tick()
    }
    off()
    w.frame.move = { x: 0, y: 0 }
    w.frame.held = new Set<string>()
    return gains
  }

  /**
   * **走 n 拍，敌人涨了多少警觉值**（玩家真的在走 ⇒ 脚步真的发出来）。
   *
   * 玩家钉在 **d 米**处（距离不许漂），敌人在原点、脸朝 +z（玩家在它背后）。
   * d = 12m ⇒ **震感半径外、听觉半径内** ⇒ 涨的这些**只可能来自听觉**；
   * d = 15m ⇒ **听觉半径外** ⇒ 什么也收不到。
   */
  function walkAlert(w: World, e: Enemy, d: number, ticks = 120): number {
    e.alertness = 0
    e.enter('idle')
    w.player.pos = { x: 0, y: 0, z: -d }
    w.player.stats.stamina = w.player.stats.staMax - 1
    w.frame.move = { x: 0, y: 1 }
    w.frame.held = new Set<string>()
    for (let i = 0; i < ticks; i++) {
      pinEnemy(e)
      w.player.pos.x = 0
      w.player.pos.z = -d
      w.tick()
    }
    const a = e.alertness
    w.frame.move = { x: 0, y: 0 }
    e.alertness = 0
    e.enter('idle')
    return a
  }

  it('腿① 震感半径来自敌人表里那一格，与噪声 loudness 无关（这一段玩家一声没出）', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'ki211-a')
    const vr = e.data.ai.vibration.range
    const inside = sensed(w, e, vr - 0.5)
    expect(w.player.pos.z, '前提：玩家一步没走（这一段没有脚步声 ⇒ 涨的不是听来的）').toBeCloseTo(-(vr - 0.5), 6)
    const outside = sensed(w, e, vr + 0.5)
    expect(inside, `半径内（${vr - 0.5}m）移动 ⇒ 震感这一路该发现他（+40 一次感知）`).toBeGreaterThan(0)
    expect(outside, `半径外（${vr + 0.5}m）⇒ 震感这一路够不着`).toBe(0)
  })

  it('腿② 「静止=对震感隐形」那半句的判据是「体力回满」：站着但喘着气，一样会被发现', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'ki211-b')
    const vr = e.data.ai.vibration.range
    const spent = sensed(w, e, vr - 0.5) // 体力没回满 ⇒ 「移动」的读数成立
    const rested = sensed(w, e, vr - 0.5, { spent: false }) // 体力回满 ⇒ 「移动」的读数不成立
    expect(spent, '站着不动但体力没回满 ⇒ 震感照样发现他（判据不是速度，是体力）').toBeGreaterThan(0)
    expect(rested, '体力回满 ⇒ 对震感隐形（设计 §13.0「静止=对震感隐形」那半句）').toBe(0)
  })

  it('腿③ 听觉半径来自敌人表里那一格：半径内听得见，半径外听不见（脚步是同一档）', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'ki211-c')
    const hr = e.data.ai.hearing.range
    const inside = walkAlert(w, e, hr - 2) // 12m：震感半径外、听觉半径内
    const outside = walkAlert(w, e, hr + 1) // 15m：听觉半径外
    expect(inside, `半径内（${hr - 2}m）⇒ 听见了（脚步是同一档，差的只是距离）`).toBeGreaterThan(0)
    expect(outside, `半径外（${hr + 1}m）⇒ 听不见`).toBe(0)
  })

  it('腿④ 噪声的大小只改警觉值涨得多快（同一距离、同样一记：疾跑比走涨得多）', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'ki211-d')
    const walk = stepGains(w, e, [0, 1], false)
    const sprint = stepGains(w, e, [0, 1], true)
    expect(walk.length, '前提：走这一趟真的踩出了脚步').toBeGreaterThan(0)
    expect(sprint.length, '前提：疾跑这一趟真的踩出了脚步').toBeGreaterThan(0)
    expect(sprint[0], '疾跑那一记比走那一记涨得多（噪声大 ⇒ 涨得快）').toBeGreaterThan(walk[0])
  })

  it('腿⑤ 静步（轻推摇杆）与「走」是同一档 ⇒ 「静步半径 12m→4m」那一档没有承载体', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'ki211-e')
    const walk = stepGains(w, e, [0, 1], false)
    const sneak = stepGains(w, e, [0.3, 0], false, 300) // 轻推摇杆（静步）——走得慢 ⇒ 多跑几拍才有脚步
    expect(sneak.length, '前提：轻推这一趟也踩出了脚步').toBeGreaterThan(0)
    expect(sneak[0], '静步那一记与走那一记涨得一样多 ⇒ 静步与走是同一档（后果侧）').toBe(walk[0])
  })

  it('腿⑥ 登记：震感半径落在设计「4-10m」之外的那几个（设计没裁 ⇒ 只登记，不改数）', () => {
    const over = enemiesRaw
      .filter((e) => e.ai.vibration.range > 10)
      .map((e) => `${e.id}:${e.ai.vibration.range}`)
    expect(over, '设计 §13.0 那一行写的是「半径 4-10m」；超出的这几个登记在案（这条腿是**变更探测器**：表一改就红，逼着账本跟着改）')
      .toEqual(['en_hanged_knight:12', 'en_ostlara:14', 'en_hersil:16'])
  })
})
