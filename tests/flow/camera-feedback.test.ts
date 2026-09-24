import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { TICK_DT } from '@/core/Time'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig, EXEC_DOLLY, SHAKE_TABLE } from '@/player/CameraRig'
import { Enemy, newAttack } from '@/ai/Enemy'

/**
 * KI-051 —— §10 震镜表的三个附加格补上承载体：
 * ① FOV 脉冲（重击命中 -1°/120ms、驼鼓踏地 -2°/150ms）住进 `CameraRig.SHAKE_TABLE` 的列；
 * ② 踏地尘环 + 落帧震场：敌人 active 帧**挥空也执行**，走 `frames.vfx` / `frames.worldShake`；
 * ③ §5.4 处决推轨：`CameraRig` 直读 `player.executing`，越肩构图 + 距离压近 + FOV 收缩。
 * 反证口径（需求 §77）：每条正向断言配一条「行为不跟表走就是假绿」的腿——
 * 改表法两次（FOV 列、推轨常量），非落帧帧反证，无脉冲行反证。
 */

registerGameData()

Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })

const offs: Array<() => void> = []
afterEach(() => { while (offs.length) offs.pop()!() })

type Vec = { x: number; y: number; z: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubPlayer = (pos: Vec, extra?: any): PlayerController =>
  ({ pos, camYawRef: 0, ...extra } as any) as PlayerController

function newRig(): CameraRig {
  const rig = new CameraRig()
  rig.shakeIntensity = 0 // 设置项滑杆归零会污染断言：这些用例量的是波形本身
  return rig
}

function step(rig: CameraRig, player: PlayerController, n: number): void {
  for (let i = 0; i < n; i++) rig.update(TICK_DT, player, { dx: 0, dy: 0 }, null, TICK_DT)
}

describe('§10 表行对账：数据 ↔ CameraRig', () => {
  it('驼鼓踏地行在表里，且数字与 docs/combat.md §10 逐格相同', () => {
    const s = SHAKE_TABLE.stomp
    expect(s.amp, 'A=3.0°').toBeCloseTo(3.0)
    expect(s.freq, 'f=5Hz').toBeCloseTo(5)
    expect(s.dur, '持续 500ms').toBeCloseTo(0.5)
    expect(s.fov, 'FOV -2°').toBeCloseTo(-2)
    expect(s.fovMs, 'FOV 150ms').toBe(150)
    expect(SHAKE_TABLE.heavy.fov, '重击命中附加格 FOV -1°').toBeCloseTo(-1)
    expect(SHAKE_TABLE.heavy.fovMs, '重击命中附加格 120ms').toBe(120)
  })

  it('踏地招式（enemies.json）声明的正是这两格：尘环 + 落帧震场', () => {
    const tym = registry.get<EnemyData>('en_tympanus')
    const stomp = tym.attacks.find((a) => a.id === 'stomp')!
    expect(stomp.frames.vfx?.[0]).toBe('ring_dust')
    expect(stomp.frames.worldShake).toBe('stomp')
  })
})

describe('①FOV 脉冲：冲下去再自己回来', () => {
  it('heavy 的 -1°/120ms 被消费且按时自复；graze（无附加格）不动 FOV', () => {
    const p = stubPlayer({ x: 0, y: 0, z: 0 })
    const rig = newRig()
    rig.shake('heavy')
    const fovs: number[] = []
    for (let i = 0; i < 7; i++) { step(rig, p, 1); fovs.push(rig.cam.fov) }
    // 第 4 tick（t=4/60s）已过 120ms 的正中：sin 包络吃到 ~-0.985°，允许采样误差
    expect(Math.min(...fovs), '满幅接近 -1°（sin 峰在 3.6 tick 处，离散采样差 0.016°）').toBeGreaterThan(49.0)
    expect(Math.min(...fovs)).toBeLessThan(49.05)
    step(rig, p, 20)
    expect(rig.cam.fov, '脉冲走完：FOV 自己回到基准').toBeCloseTo(50, 6)

    const rig2 = newRig()
    rig2.shake('graze')
    step(rig2, p, 6)
    expect(rig2.cam.fov, '负例：这一行情境设计上就没有 FOV 附加格').toBe(50)
  })

  it('改表法：把 heavy 的 fov 列改成 -5°，行为立刻跟到 45°；还原后回到 49°', () => {
    const p = stubPlayer({ x: 0, y: 0, z: 0 })
    const saved = SHAKE_TABLE.heavy.fov
    SHAKE_TABLE.heavy.fov = -5
    try {
      const rig = newRig()
      rig.shake('heavy')
      step(rig, p, 4)
      expect(rig.cam.fov, '读数由表给，不由代码给').toBeGreaterThan(44.9)
      expect(rig.cam.fov).toBeLessThan(45.2)
    } finally {
      SHAKE_TABLE.heavy.fov = saved
    }
    const rig = newRig()
    rig.shake('heavy')
    step(rig, p, 4)
    expect(rig.cam.fov, '还原复验').toBeGreaterThan(48.9)
    expect(rig.cam.fov).toBeLessThan(49.2)
  })
})

describe('②落帧是世界事件：打没打中都扬灰、都震镜', () => {
  const capture = () => {
    const vfx: { key: string; pos: Vec; scale?: number }[] = []
    const shakes: { key: string; pos?: Vec }[] = []
    const sounds: string[] = []
    offs.push(
      bus.on('vfx.request', (v) => vfx.push(v as never)),
      bus.on('camera.shake', (s) => shakes.push(s as never)),
      bus.on('sound.source', (s) => sounds.push(s.id))
    )
    return { vfx, shakes, sounds }
  }

  const forceAt = (id: string, attackId: string, tick: number) => {
    const e = new Enemy(registry.get<EnemyData>(id), { x: 0, y: 0, z: -3 }, 'ki051')
    const spec = e.data.attacks.find((a) => a.id === attackId)!
    e.attack = newAttack(spec, tick)
    return e
  }

  it('越过 activeStart 的那一 tick：声 + 尘环 + camera.shake 同帧齐发（现场没有玩家，挥空是构造保证）', () => {
    const c = capture()
    const stomp = registry.get<EnemyData>('en_tympanus').attacks.find((a) => a.id === 'stomp')!
    const e = forceAt('en_tympanus', 'stomp', stomp.frames.activeStart - 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(e as any).advanceAttackFrames(1)
    expect(c.sounds.length, 'KI-016 的发声出口照常').toBe(1)
    expect(c.vfx.length).toBe(1)
    expect(c.vfx[0].key).toBe('ring_dust')
    expect(c.vfx[0].pos).toMatchObject({ x: 0, y: 0, z: -3 })
    expect(c.shakes.length, '§10 踏地行从此有发射方').toBe(1)
    expect(c.shakes[0].key).toBe('stomp')
    expect(c.shakes[0].pos, '震源=敌人落点：相机按它衰减').toMatchObject({ x: 0, y: 0, z: -3 })
  })

  it('反证：非落帧的 tick 不许扬灰（发射方若写成"每帧都发"，这条立刻红）', () => {
    const c = capture()
    const e = forceAt('en_tympanus', 'stomp', 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(e as any).advanceAttackFrames(1)
    expect(e.attack?.tick).toBe(5)
    expect(c.vfx.length + c.shakes.length + c.sounds.length).toBe(0)
  })

  it('没有声明 vfx/worldShake 的招式照旧安静（新消费方不是无条件广播）', () => {
    const tym = registry.get<EnemyData>('en_tympanus')
    const quiet = tym.attacks.find((a) => !a.frames.vfx && !a.frames.worldShake)
    expect(quiet, '前提：表里还有一招两样都没声明').toBeTruthy()
    const c = capture()
    const e = forceAt('en_tympanus', quiet!.id, quiet!.frames.activeStart - 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(e as any).advanceAttackFrames(1)
    expect(c.vfx.length).toBe(0)
    expect(c.shakes.length).toBe(0)
  })

  it('camera.shake 按震源距离衰减：隔半张图的踏地只剩底幅（幻痛不是反馈）', () => {
    const p = stubPlayer({ x: 0, y: 0, z: 0 })
    const rig = new CameraRig()
    rig.shakeIntensity = 1
    step(rig, p, 120) // 相机落到跟随位（距玩家 ~5.6m），距离量的是真位置
    const c = capture()
    bus.emit('camera.shake', { key: 'stomp', pos: { x: 0, y: 0, z: 0 } })
    const near = (rig as unknown as { shakes: { amp: number }[] }).shakes
    const nearAmp = near[near.length - 1].amp
    bus.emit('camera.shake', { key: 'stomp', pos: { x: 60, y: 0, z: 0 } })
    const farAmp = near[near.length - 1].amp
    expect(nearAmp, '近处：吃满 3° 的 ~77%（相机离震源就是 5.6m）').toBeGreaterThan(2.0)
    expect(farAmp, '远处：衰减到底 0.25×3=0.75°').toBeCloseTo(0.75, 6)
    expect(c.shakes.length, 'bus 通路本身就是这格的承载体').toBe(2)
  })
})

describe('③处决推轨：演出在，镜头就推；演出完，自己退', () => {
  it('executing 期间构图转向受刑者 + 距离压近 + FOV 收缩；结束缓回基准', () => {
    const p = stubPlayer({ x: 0, y: 0, z: 0 }, { executing: { tick: 0, total: 90, pos: { x: 0, y: 0, z: -3 } } })
    const rig = new CameraRig()
    step(rig, p, 120)
    expect(rig.cam.fov, '基准 50 + EXEC_DOLLY.fovDelta(-7)').toBeCloseTo(50 + EXEC_DOLLY.fovDelta, 2)
    // 推近：相机到原点的距离比不演出时近（同一玩家站同一格，锁都不锁；不推轨的跟随球面≈6.2）
    const distPulled = rig.cam.position.length()
    expect(distPulled).toBeLessThan(5.0)
    // 演出结束：退回去
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(p as any).executing = null
    step(rig, p, 240)
    expect(rig.cam.fov, '推轨不是单向门：演出一停 FOV 回 50').toBeCloseTo(50, 2)
  })

  it('改表法：EXEC_DOLLY.fovDelta 换成 -20，读数跟着到 30°；还原复验 43°', () => {
    const p = stubPlayer({ x: 0, y: 0, z: 0 }, { executing: { tick: 0, total: 90, pos: { x: 0, y: 0, z: -3 } } })
    const saved = EXEC_DOLLY.fovDelta
    EXEC_DOLLY.fovDelta = -20
    try {
      const rig = new CameraRig()
      step(rig, p, 150)
      expect(rig.cam.fov).toBeCloseTo(30, 2)
    } finally {
      EXEC_DOLLY.fovDelta = saved
    }
    const rig = new CameraRig()
    step(rig, p, 150)
    expect(rig.cam.fov, '还原复验').toBeCloseTo(43, 2)
  })
})
