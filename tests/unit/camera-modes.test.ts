import { describe, expect, it, beforeAll } from 'vitest'
import { CameraRig, CameraMode, MODE_CONFIG, EXEC_DOLLY, SHAKE_TABLE } from '@/player/CameraRig'
import { damp, clamp } from '@/core/Math'
import type { BoxOccluder } from '@/core/Occlusion'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * CameraRig 五模式测试（tech-arch §2 CameraRig 映射）。
 * 纯逻辑测试：不依赖 Three.js 场景，用最小替身验模式切换/配置/阻尼/边界。
 */

/**
 * 玩家替身：`CameraRig.update()` 只读 `pos` / `floorY` / `executing` / `moveSpeed`，
 * 写 `camYawRef`——替身只给这几格（`as unknown as PlayerController`：它不是控制器，
 * 说清这一点比 `as any` 诚实）。
 *
 * **刻意不给 `moveSpeed`**（KI-133）：相机不许被一个缺席的字段带走——`undefined * 0.15` 是 NaN，
 * 整条相机会飘走（地面钳制失效、震镜幅度算成 NaN）。这一格量的是"缺字段也不许 NaN"。
 */
const playerStub = {
  pos: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  floorY: 0,
  executing: null,
  camYawRef: 0,
} as unknown as PlayerController

const dt = 1 / 60
const look = { dx: 0, dy: 0 }
const lockTarget: Vec3 | null = null
const shakeDt = dt

// Mock browser globals
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.innerWidth = 1920
  g.innerHeight = 1080
  g.devicePixelRatio = 1
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})

function makeRig(): CameraRig {
  const rig = new CameraRig()
  return rig
}

describe('CameraRig 五模式配置与切换', () => {
  it('五个模式常量存在且互异', () => {
    expect(Object.values(CameraMode).length).toBe(5)
    expect(new Set(Object.values(CameraMode)).size).toBe(5)
  })

  it('每个模式在 MODE_CONFIG 里都有完整配置', () => {
    const modes = Object.values(CameraMode)
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]
      const cfg = MODE_CONFIG[mode]
      expect(cfg).toBeDefined()
      expect(cfg.yawDamp).toBeGreaterThan(0)
      expect(cfg.pitchDamp).toBeGreaterThan(0)
      expect(cfg.posDamp).toBeGreaterThan(0)
      expect(cfg.distMin).toBeLessThan(cfg.distMax)
      expect(cfg.fovBase).toBeGreaterThan(0)
    }
  })

  it('模式切换：setMode 更新内部模式；同模式再进一次也停在原地', () => {
    const rig = makeRig()

    expect(rig.getMode()).toBe(CameraMode.Exploration)

    rig.setMode(CameraMode.Combat)
    expect(rig.getMode()).toBe(CameraMode.Combat)

    rig.setMode(CameraMode.LockOn)
    expect(rig.getMode()).toBe(CameraMode.LockOn)

    rig.setMode(CameraMode.Boss)
    expect(rig.getMode()).toBe(CameraMode.Boss)

    rig.setMode(CameraMode.Cinematic)
    expect(rig.getMode()).toBe(CameraMode.Cinematic)

    rig.setMode(CameraMode.Cinematic)
    expect(rig.getMode(), '同模式再进一次不会跑到别的格').toBe(CameraMode.Cinematic)
  })

  it('Cinematic 模式可禁用碰撞', () => {
    const rig = makeRig()
    rig.setMode(CameraMode.Cinematic)
    const cfg = MODE_CONFIG[CameraMode.Cinematic]
    expect(cfg.collisionRadius).toBe(0)
    // `collisionDamp` 那一列在 KI-170 里删掉了：**没有读者、含义也没被裁**
    // （是"进墙的缓动"还是"出墙的缓动"？设计没说）⇒ 按 §55 不留一列空数据。
    // 要加回来，先说清它是什么。
  })
})

describe('CameraRig 模式差异化参数', () => {
  it('Exploration：最远距离、最宽 FOV、最低阻尼', () => {
    const e = MODE_CONFIG[CameraMode.Exploration]
    const c = MODE_CONFIG[CameraMode.Combat]
    const l = MODE_CONFIG[CameraMode.LockOn]
    const b = MODE_CONFIG[CameraMode.Boss]

    // distMax: Cinematic(20) > Boss(10) > Exploration(8) > Combat(6) > LockOn(5.5)
    expect(MODE_CONFIG[CameraMode.Cinematic].distMax).toBeGreaterThan(MODE_CONFIG[CameraMode.Boss].distMax)
    expect(MODE_CONFIG[CameraMode.Boss].distMax).toBeGreaterThan(e.distMax)
    expect(e.distMax).toBeGreaterThan(c.distMax)
    expect(c.distMax).toBeGreaterThan(l.distMax)

    expect(e.fovBase).toBeGreaterThan(c.fovBase)
    expect(e.fovBase).toBeGreaterThan(l.fovBase)
    expect(e.fovBase).toBeGreaterThan(b.fovBase)

    expect(e.posDamp).toBeLessThan(c.posDamp)
    expect(e.posDamp).toBeLessThan(l.posDamp)
  })

  it('Combat：比 Exploration 近、FOV 窄、阻尼大', () => {
    const e = MODE_CONFIG[CameraMode.Exploration]
    const c = MODE_CONFIG[CameraMode.Combat]
    expect(c.distBase).toBeLessThan(e.distBase)
    expect(c.fovBase).toBeLessThan(e.fovBase)
    expect(c.posDamp).toBeGreaterThan(e.posDamp)
  })

  it('LockOn：越肩距离最近、FOV 最窄、阻尼最大（除 Boss/Cinematic）', () => {
    const c = MODE_CONFIG[CameraMode.Combat]
    const l = MODE_CONFIG[CameraMode.LockOn]
    expect(l.distBase).toBeLessThan(c.distBase)
    expect(l.distBase).toBeLessThan(e0().distBase)
    expect(l.posDamp).toBeGreaterThan(c.posDamp)
    expect(l.yawDamp).toBeGreaterThan(c.yawDamp)
  })

  it('Boss：更远、更高、FOV 更窄、阻尼更大', () => {
    const l = MODE_CONFIG[CameraMode.LockOn]
    const b = MODE_CONFIG[CameraMode.Boss]
    expect(b.distBase).toBeGreaterThan(l.distBase)
    expect(b.heightOffset).toBeGreaterThan(l.heightOffset)
    expect(b.fovBase).toBeLessThan(l.fovBase)
    expect(b.posDamp).toBeGreaterThan(l.posDamp)
  })

  it('Cinematic：极低阻尼、极宽距离范围、无碰撞', () => {
    const c = MODE_CONFIG[CameraMode.Cinematic]
    expect(c.posDamp).toBeLessThan(MODE_CONFIG[CameraMode.Exploration].posDamp)
    expect(c.distMin).toBeLessThan(MODE_CONFIG[CameraMode.Exploration].distMin)
    expect(c.distMax).toBeGreaterThan(MODE_CONFIG[CameraMode.Boss].distMax)
    expect(c.collisionRadius).toBe(0)
  })
})

/** Exploration 那一格（上面的用例里要反复引它，抽成一处以免抄第二份名字） */
function e0(): typeof MODE_CONFIG[CameraMode.Exploration] {
  return MODE_CONFIG[CameraMode.Exploration]
}

describe('CameraRig 模式切换行为', () => {
  it('setMode 同模式重进只重摆 FOV，模式与距离边界不动', () => {
    const rig = makeRig()
    rig.setMode(CameraMode.Combat)
    const dist = rig.dist
    rig.setMode(CameraMode.Combat)
    expect(rig.getMode()).toBe(CameraMode.Combat)
    expect(rig.dist, '同模式不该把距离再夹一次').toBe(dist)
    rig.update(dt, playerStub, look, lockTarget, shakeDt)
    expect(rig.cam.fov, 'FOV 仍是战斗那一格').toBe(MODE_CONFIG[CameraMode.Combat].fovBase)
  })

  it('Cinematic 数据里只有 fov 是相机的：它压过模式那一格', () => {
    const rig = makeRig()
    rig.setMode(CameraMode.Cinematic, { fov: 30 })
    rig.update(dt, playerStub, look, lockTarget, shakeDt)
    expect(rig.getMode()).toBe(CameraMode.Cinematic)
    expect(rig.cam.fov, '演出给了 FOV 就用它').toBe(30)
  })

  it('getMode 返回当前模式', () => {
    const rig = makeRig()
    expect(rig.getMode()).toBe(CameraMode.Exploration)
    rig.setMode(CameraMode.LockOn)
    expect(rig.getMode()).toBe(CameraMode.LockOn)
  })
})

describe('CameraRig 配置差异化的阻尼数值', () => {
  it('posDamp 单调递增：Exploration < Combat < LockOn < Boss', () => {
    const e = MODE_CONFIG[CameraMode.Exploration].posDamp
    const c = MODE_CONFIG[CameraMode.Combat].posDamp
    const l = MODE_CONFIG[CameraMode.LockOn].posDamp
    const b = MODE_CONFIG[CameraMode.Boss].posDamp
    expect(e < c && c < l && l < b).toBe(true)
  })

  it('yawDamp 单调递增', () => {
    const e = MODE_CONFIG[CameraMode.Exploration].yawDamp
    const c = MODE_CONFIG[CameraMode.Combat].yawDamp
    const l = MODE_CONFIG[CameraMode.LockOn].yawDamp
    expect(e < c && c < l && l < MODE_CONFIG[CameraMode.Boss].yawDamp).toBe(true)
  })

  it('distBase 单调递减：Exploration > Combat > LockOn < Boss（Boss 最远）', () => {
    const e = MODE_CONFIG[CameraMode.Exploration].distBase
    const c = MODE_CONFIG[CameraMode.Combat].distBase
    const l = MODE_CONFIG[CameraMode.LockOn].distBase
    const b = MODE_CONFIG[CameraMode.Boss].distBase
    expect(e > c && c > l && b > l).toBe(true)
  })

  it('fovBase 单调递减', () => {
    const e = MODE_CONFIG[CameraMode.Exploration].fovBase
    const c = MODE_CONFIG[CameraMode.Combat].fovBase
    const l = MODE_CONFIG[CameraMode.LockOn].fovBase
    const b = MODE_CONFIG[CameraMode.Boss].fovBase
    expect(e > c && c > l && l > b).toBe(true)
  })
})

describe('CameraRig 阻尼/边界常量导出', () => {
  it('EXEC_DOLLY 导出用于测试与文档对账', () => {
    expect(EXEC_DOLLY).toEqual({ fovDelta: -7, distMul: 0.4, damp: 8 })
  })

  it('SHAKE_TABLE 所有键有完整字段', () => {
    for (const val of Object.values(SHAKE_TABLE)) {
      expect(val.amp).toBeGreaterThan(0)
      expect(val.freq).toBeGreaterThan(0)
      expect(val.dur).toBeGreaterThan(0)
      if (val.fov !== undefined) expect(val.fovMs).toBeDefined()
    }
  })
})

/**
 * update 路径（KI-133 补齐）：这一段原来只有半截骨架（import 了 `damp`/`clamp`/`BoxOccluder`
 * 与四个桩却一条用例都没写），tsc 直接报 6 条"未使用"——骨架不是门。
 * 下面这几条量的是 update 路径上**此前没有任何读者**的分支。
 */
describe('CameraRig update 路径：输入缩放按模式、缺字段不 NaN、地面钳制、遮挡回弹', () => {
  it('输入按模式阻尼缩放：同一份 dx，探索转得比过场快', () => {
    const explore = makeRig()
    explore.update(dt, playerStub, { dx: 1, dy: 0 }, lockTarget, shakeDt)
    const cinematic = makeRig()
    cinematic.setMode(CameraMode.Cinematic)
    cinematic.update(dt, playerStub, { dx: 1, dy: 0 }, lockTarget, shakeDt)
    expect(Math.abs(explore.yaw - 0.6), '探索 yawDamp=3 ⇒ 转得比过场（yawDamp=1）多').toBeGreaterThan(
      Math.abs(cinematic.yaw - 0.6),
    )
  })

  it('替身缺 moveSpeed 也不许把相机算成 NaN', () => {
    const rig = makeRig()
    const player = { ...playerStub, camYawRef: 0 } as unknown as PlayerController
    for (let i = 0; i < 30; i++) rig.update(dt, player, look, lockTarget, shakeDt)
    expect(Number.isFinite(rig.cam.position.x), 'x 必须是有限数').toBe(true)
    expect(Number.isFinite(rig.cam.position.y), 'y 必须是有限数').toBe(true)
    expect(Number.isFinite(rig.cam.position.z), 'z 必须是有限数').toBe(true)
    expect(Number.isFinite(player.camYawRef), 'camYawRef 必须是有限数（相机写回玩家那一格）').toBe(true)
  })

  it('地面钳制：玩家在坑底时相机不许跟着入地（floorY + 0.35）', () => {
    const rig = makeRig()
    const sunken = { ...playerStub, pos: { x: 0, y: -2, z: 0 }, floorY: -2 } as unknown as PlayerController
    for (let i = 0; i < 30; i++) rig.update(dt, sunken, look, lockTarget, shakeDt)
    expect(rig.cam.position.y, '钳在地板之上 0.35m').toBeGreaterThanOrEqual(-2 + 0.35 - 1e-6)
  })

  it('遮挡回弹：盒子挡在视线中间时相机停在盒子前面（不进墙）', () => {
    const box: BoxOccluder = { id: 'ob_wall', shape: 'box', pos: { x: 2, y: 0, z: 3 }, heightM: 4, halfX: 0.5, halfZ: 0.5 }
    const blocked = makeRig()
    blocked.setOccluders([box])
    for (let i = 0; i < 60; i++) blocked.update(dt, playerStub, look, lockTarget, shakeDt)
    const free = makeRig()
    for (let i = 0; i < 60; i++) free.update(dt, playerStub, look, lockTarget, shakeDt)

    const distBlocked = Math.hypot(blocked.cam.position.x, blocked.cam.position.z)
    const distFree = Math.hypot(free.cam.position.x, free.cam.position.z)
    expect(distBlocked, '被挡时相机拉近').toBeLessThan(distFree)
    const insideBox =
      Math.abs(blocked.cam.position.x - box.pos.x) < box.halfX && Math.abs(blocked.cam.position.z - box.pos.z) < box.halfZ
    expect(insideBox, '相机不许停在墙肚子里').toBe(false)
  })

  it('跟随是指数阻尼：残余距离每帧按同一系数收缩（damp 的口径，不是线性插值）', () => {
    const cfg = MODE_CONFIG[CameraMode.Exploration]
    const run = (n: number): { x: number; y: number; z: number } => {
      const rig = makeRig()
      for (let i = 0; i < n; i++) rig.update(dt, playerStub, look, lockTarget, shakeDt)
      return { x: rig.cam.position.x, y: rig.cam.position.y, z: rig.cam.position.z }
    }
    const settled = run(300) // 收敛点
    const after1 = run(1)
    const after2 = run(2)
    const residual = (p: { x: number; y: number; z: number }): number =>
      Math.hypot(p.x - settled.x, p.y - settled.y, p.z - settled.z)
    // `damp` 的定义：lerp(a, b, 1 - e^{-λdt}) ⇒ 残余（到收敛点）每帧剩 e^{-λdt}
    const expectFactor = 1 - damp(0, 1, cfg.posDamp, dt)
    expect(residual(after2) / residual(after1), '残余收缩比 = e^{-λdt}').toBeCloseTo(expectFactor, 3)
  })

  it('距离被夹在 distMin..distMax 之间（clamp 那把尺子）', () => {
    const rig = makeRig()
    for (let i = 0; i < 120; i++) rig.update(dt, playerStub, look, lockTarget, shakeDt)
    const cfg = MODE_CONFIG[CameraMode.Exploration]
    const d = Math.hypot(rig.cam.position.x - playerStub.pos.x, rig.cam.position.z - playerStub.pos.z)
    expect(d, '不许超过 distMax').toBeLessThanOrEqual(cfg.distMax + 1e-6)
    expect(d, '不许低于 distMin（俯角让水平距离略小）').toBeGreaterThanOrEqual(clamp(cfg.distBase, cfg.distMin, cfg.distMax) * 0.9)
  })
})
