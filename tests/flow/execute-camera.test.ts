import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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
import { bus } from '@/core/EventBus'

/**
 * KI-237：**「处决演出的镜头与低通」那一行**第一次在真链上被量
 * （combat.md §5.4 镜头行：锁定式越肩推轨、**FOV 45°→38°**；背景**全频低通**（"休止"听感）；演出行：**2.2s** 蒙太奇）。
 *
 * 真链：真 `PlayerController` ＋ 真 `CameraRig` ＋ 真 `Enemy` ＋ 真 `CombatManager` ＋ 真事件。
 */

registerGameData()

// 相机那台 `PerspectiveCamera` 要读视口尺寸（headless 里没有 window ⇒ 摆上）
beforeAll(() => {
  Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
})

const FOE = 'en_tympanus'

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const rig = new CameraRig()
  rig.shakeIntensity = 0
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const muffles: boolean[] = []
  const off = bus.on('audio.muffle', (p) => muffles.push(p.on))

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      rig.update(TICK_DT, player, input.frame.look, null, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, rig, ai, combat, frame, tick, muffles, off }
}

type World = ReturnType<typeof makeWorld>

describe('KI-237 处决演出的镜头与低通（combat.md §5.4）', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /** 一只被钉住的杂兵（破势中 ⇒ 触发条件 A），玩家按处决键 */
  function execute(w: World): { e: ReturnType<World['ai']['spawn']> } {
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    e.stats.crumpleTicksLeft = 60
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI
    p.camYawRef = Math.PI + p.yaw
    w.frame.edges.add('interact')
    w.tick()
    w.frame.edges.delete('interact')
    return { e }
  }

  it('腿① FOV 那一格：处决演出期间镜头收窄「差值 7 度」（设计 §5.4「FOV 45°→38°」的那个差）', () => {
    const w = makeWorld()
    const { e } = execute(w)
    expect(w.player.executing, '前提：处决演出在进行').not.toBeNull()
    const fov0 = w.rig.cam.fov
    for (let i = 0; i < 60; i++) w.tick() // 让推轨收敛（演出本身只有 132 拍 ⇒ 读数得在演完之前拿）
    const fov1 = w.rig.cam.fov
    expect(fov1, '演出期间镜头收窄了（推轨的 FOV 差值起作用了）').toBeLessThan(fov0)
    expect(fov0 - fov1, '……收窄的差值奔着 7 度去（设计「45°→38°」的那个差；60 拍时推轨还没完全收敛，容差在这儿）').toBeGreaterThan(5.5)
    expect(fov0 - fov1, '……也不许更少').toBeLessThan(7.5)
    void e
    alive.push(w.off)
  })

  it('腿② 越肩推轨：处决演出期间镜头借用越肩构图瞄住受刑者（那 0.35 弧度的越肩偏置就是它的指纹）', () => {
    const w = makeWorld()
    const { e } = execute(w)
    for (let i = 0; i < 120; i++) w.tick()
    // 镜头朝向：越肩构图瞄住受刑者那一侧 ＋ 0.35 弧度那个偏置（`away + 0.35`）
    const toVictim = Math.atan2(w.player.pos.x - e.pos.x, w.player.pos.z - e.pos.z)
    const gap = Math.abs(Math.atan2(Math.sin(w.rig.yaw - toVictim), Math.cos(w.rig.yaw - toVictim)))
    expect(gap, '镜头已经转到受刑者那一侧 ＋ 越肩那 0.35 的偏置（不是还朝着别处）').toBeCloseTo(0.35, 1)
    alive.push(w.off)
  })

  it('腿③ 背景全频低通：处决演出期间「audio.muffle」被打开，演完关上', () => {
    const w = makeWorld()
    execute(w)
    expect(w.muffles[0], '演出一开始，低通就打开了（背景全频低通）').toBe(true)
    // 演完（durationTicks 拍）之后 ⇒ 低通关上
    for (let i = 0; i < playerBase.execution.durationTicks + 10; i++) w.tick()
    expect(w.muffles[w.muffles.length - 1], '演完之后低通关上').toBe(false)
    alive.push(w.off)
  })

  it('腿④ 演出的时长 = 2.2s（`durationTicks` 那一格）', () => {
    const w = makeWorld()
    execute(w)
    let n = 0
    while (w.player.executing && n < 600) { w.tick(); n++ }
    expect(n, '演出持续了 `durationTicks` 拍').toBe(playerBase.execution.durationTicks)
    expect(playerBase.execution.durationTicks / 60, '那一格折成秒 ＝ 2.2s（设计 §5.4 演出行）').toBeCloseTo(2.2, 2)
    alive.push(w.off)
  })
})
