import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig } from '@/player/CameraRig'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'

/**
 * KI-253：**§10「镜头震动参数表」那张表第一次在真链上被量**（KI-051 那一族量过 FOV 脉冲那一列，
 * **震镜本身的 A／f／持续**这三列与「哪一记发哪一把震镜」这一层还没被量过）。
 *
 * | 情境 | 幅度 A | 频率 f | 持续 | 附加 |
 * | 轻击命中 | 0.3° | 18Hz | 100ms | — |
 * | 重击命中 | 0.8° | 12Hz | 200ms | FOV -1°/120ms |
 * | 玩家受击 | 1.2° | 10Hz | 250ms | 暗角 0.2 强度 |
 * | 弹反成功 | 0.5° 单snap | 24Hz | 60ms | 镜头 roll 2° 回正（"定音"感） |
 * | 破防/被破势 | 2.0° | 6Hz | 400ms | 0.3s 慢放 ×0.75 |
 * | 处决 | 1.0° | 8Hz | 300ms | 推轨另控（§5.4） |
 * | 驼鼓踏地 | 3.0° | 5Hz | 500ms | FOV -2°/150ms + 尘环 |
 * | Boss 阶段转换 | 4.0° | 3.5Hz | 900ms | 低通扫频 0.8s |
 * | 落地摔落 | 1.5° | 7Hz | 300ms | — |
 *
 * **读数**：相机**自己记在身上的那笔账**（`CameraRig` 挂上去的震镜条目：幅度／频率／衰减 ＋ roll）
 * 与 FOV 脉冲那两个数 ⇒ ⇒ 读的是运行时**真的挂上去的**那几个数，不是文档里的数。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 * 设计那一行与真读数对不上时**腿钉住真读数、把差额写进消息** ⇒ 只量不裁（设计没裁）。
 */

registerGameData()

Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })

interface ShakeEntry { amp: number; freq: number; decay: number; t: number; roll: number }

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const rig = new CameraRig()
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      rig.update(TICK_DT, player, frame.look, null, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, rig, frame, tick }
}

type World = ReturnType<typeof makeWorld>

/** 相机身上挂着的那几笔震镜账（运行时自己记的） */
function shakes(w: World): ShakeEntry[] {
  return (w.rig as unknown as { shakes: ShakeEntry[] }).shakes
}

/** 一记飞向玩家的弹体（飞行 14 拍） */
function shoot(w: World): void {
  w.combat.projectiles.spawn({
    hostile: true, ownerId: 'en_test', kind: 'shard', origin: { x: 0, y: 1.1, z: -4 }, dir: { x: 0, y: 0, z: 1 },
    speed: 13, range: 20, radius: 0.45, damage: 30, poise: 10, hitStopMs: 60,
  }, w.time.tick)
}

describe('KI-253 §10 镜头震动参数表：A／f／持续 与「哪一记发哪一把震镜」', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 玩家受击 → **hurt**（1.2°／10Hz／250ms）：与设计那一行逐字对上', () => {
    const w = makeWorld()
    shoot(w)
    for (let i = 0; i < 40 && shakes(w).length === 0; i++) w.tick()
    const s = shakes(w).find((x) => x.amp === 1.2)
    expect(s, '玩家受击那一记挂上去的震镜（设计 §10「玩家受击 1.2° 10Hz 250ms」）').toBeTruthy()
    expect(s!.freq, '频率（设计写 10Hz）').toBe(10)
    expect(Math.round(s!.decay * 3 * 1000), '持续（`decay` 是 τ，包络掉到 2% 要 ≈1.3 倍 τ ⇒ 设计写 250ms）').toBe(250)
  })

  it('腿② 弹反成功 → **parry**（0.5°／24Hz／60ms ＋ roll 2° 回正）：与设计那一行逐字对上', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = Math.PI
    w.player.camYawRef = Math.PI + w.player.yaw
    shoot(w)
    w.tick(10)
    w.frame.edges.add('parry')
    w.tick()
    w.frame.edges.delete('parry')
    for (let i = 0; i < 40 && !shakes(w).some((x) => x.amp === 0.5); i++) w.tick()
    const s = shakes(w).find((x) => x.amp === 0.5)
    expect(s, '弹反成功那一记挂上去的震镜（设计 §10「弹反成功 0.5° 24Hz 60ms」）').toBeTruthy()
    expect(s!.freq, '频率（设计写 24Hz）').toBe(24)
    expect(Math.round(s!.decay * 3 * 1000), '持续（设计写 60ms）').toBe(60)
    expect(s!.roll, '镜头 roll 2° 回正（设计那一行的附加格）').toBe(2)
  })

  it('腿③ Boss 阶段转换 → **boss**：频率与持续与设计逐字对上（3.5Hz／900ms），**幅度是 4.8 而不是 4.0**（多了一个 1.2 倍的震镜倍率，设计那张表里没有这一层）⇒ 登记', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -6 }, 'probe')
    e.alertness = 100
    e.enter('combat')
    e.stats.hp = e.stats.hpMax * 0.5 // 跨过第二阶的血线 ⇒ 跳阶
    for (let i = 0; i < 40 && !shakes(w).some((x) => x.freq === 3.5 && x.amp > 4); i++) w.tick()
    const s = shakes(w).find((x) => x.freq === 3.5 && x.amp > 4)
    expect(s, '跳阶那一记挂上去的震镜（设计 §10「Boss 阶段转换 4.0° 3.5Hz 900ms」）').toBeTruthy()
    expect(s!.amp, '幅度（设计写 4.0°；**运行时是 4.0 × 1.2 ＝ 4.8** ⇒ 那一层倍率设计表里没有 ⇒ 只量不裁）').toBe(4.8)
    expect(Math.round(s!.decay * 3 * 1000), '持续（设计写 900ms）').toBe(900)
  })

  it('腿④ 驼鼓踏地 → **stomp**：频率与持续与设计逐字对上（5Hz／500ms），FOV 脉冲 -2°/150ms 也对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -2.0 }, 'probe')
    e.alertness = 100
    e.enter('combat')
    for (let i = 0; i < 400 && !shakes(w).some((x) => x.freq === 5); i++) w.tick()
    const s = shakes(w).find((x) => x.freq === 5)
    expect(s, '踏地那一记挂上去的震镜（设计 §10「驼鼓踏地 3.0° 5Hz 500ms」）').toBeTruthy()
    expect(Math.round(s!.decay * 3 * 1000), '持续（设计写 500ms）').toBe(500)
    expect(s!.amp, '幅度（设计写 3.0°；运行时带**距离衰减**，所以它比 3.0 小 ⇒ 那一列不是设计表里的数）').toBeLessThanOrEqual(3)
    const pulses = (w.rig as unknown as { fovPulses: Array<{ delta: number; dur: number }> }).fovPulses
    expect(pulses.length, 'FOV 脉冲挂上去了（设计那一行的附加格：FOV -2°/150ms）').toBeGreaterThanOrEqual(1)
    expect(pulses[0].delta / s!.amp, 'FOV 脉冲与震镜带**同一个距离衰减** ⇒ 它们的比值仍是设计那一行的 −2° 对 3.0°').toBeCloseTo(-2 / 3, 5)
    expect(Math.round(pulses[0].dur * 1000), 'FOV 脉冲的时长（设计写 150ms）').toBe(150)
  })
})
