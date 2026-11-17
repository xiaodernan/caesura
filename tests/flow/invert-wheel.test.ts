import { describe, expect, it } from 'vitest'
import type { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig } from '@/player/CameraRig'
import { TICK_DT } from '@/core/Time'

/* CameraRig 构造里直接读 innerWidth/innerHeight（与 camera-feedback / mapui 同一口径） */
Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })

/**
 * KI-647 滚轮纵向（scroll Y）独立反转。
 *   用户固定诉求：「滚轮往上滑往上看、往下滑往下看」——即：
 *     invertWheelY=false：wheel deltaY>0（下滑）→ pitch 上升 → 相机抬高 → 视线朝下；
 *                          wheel deltaY<0（上滑）→ pitch 下降 → 相机沉低 → 视线朝上。
 *     invertWheelY=true：上述两方向互换。
 * mouseLook（look.dy）与滚轮（look.wheelDy）两字段不互相吞噬。
 */

type Vec = { x: number; y: number; z: number }
const stubPlayer = (pos: Vec): PlayerController =>
  ({ pos, camYawRef: 0 } as any) as PlayerController

describe('KI-647 invertWheelY', () => {
  const p = () => stubPlayer({ x: 0, y: 0, z: 0 })

  it('invertWheelY=false：滚轮下滑（wheelDy>0）抬相机 = 朝下看', () => {
    const rig = new CameraRig()
    rig.shakeIntensity = 0
    rig.invertWheelY = false
    const base = rig.pitch
    rig.update(TICK_DT, p(), { dx: 0, dy: 0, wheelDy: 0.5 }, null, TICK_DT)
    expect(rig.pitch).toBeGreaterThan(base)
  })

  it('invertWheelY=true：滚轮下滑反转 = 抬眼朝上（pitch 下降）', () => {
    const rig = new CameraRig()
    rig.shakeIntensity = 0
    rig.invertWheelY = true
    const base = rig.pitch
    rig.update(TICK_DT, p(), { dx: 0, dy: 0, wheelDy: 0.5 }, null, TICK_DT)
    expect(rig.pitch).toBeLessThan(base)
  })

  it('invertWheelY 不影响鼠标纵轴：invertMouseY=false 时 dy>0 依旧抬相机（看地）', () => {
    const rig = new CameraRig()
    rig.shakeIntensity = 0
    rig.invertMouseY = false
    rig.invertWheelY = true
    const base = rig.pitch
    rig.update(TICK_DT, p(), { dx: 0, dy: 0.5, wheelDy: 0 }, null, TICK_DT)
    expect(rig.pitch).toBeGreaterThan(base)
  })

  it('invertMouseY 不影响滚轮：invertWheelY=false 时 wheelDy>0 依旧抬相机', () => {
    const rig = new CameraRig()
    rig.shakeIntensity = 0
    rig.invertMouseY = true
    rig.invertWheelY = false
    const base = rig.pitch
    rig.update(TICK_DT, p(), { dx: 0, dy: 0, wheelDy: 0.5 }, null, TICK_DT)
    expect(rig.pitch).toBeGreaterThan(base)
  })

  it('mouse-up 与 wheel-up 两字段叠加生效：两路同时上滑时 pitch 变化量 > 单边', () => {
    const baseRig = () => { const r = new CameraRig(); r.shakeIntensity = 0; return r }
    const p = () => stubPlayer({ x: 0, y: 0, z: 0 })

    const onlyMouse = baseRig()
    const baseA = onlyMouse.pitch
    onlyMouse.update(TICK_DT, p(), { dx: 0, dy: -0.2, wheelDy: 0 }, null, TICK_DT)
    const dMouse = onlyMouse.pitch - baseA // 鼠标上滑 ⇒ pitch 下降 ⇒ 负数

    const onlyWheel = baseRig()
    const baseB = onlyWheel.pitch
    onlyWheel.update(TICK_DT, p(), { dx: 0, dy: 0, wheelDy: -0.1 }, null, TICK_DT)
    const dWheel = onlyWheel.pitch - baseB // 滚轮上滑 ⇒ pitch 下降 ⇒ 负数

    const both = baseRig()
    const baseC = both.pitch
    both.update(TICK_DT, p(), { dx: 0, dy: -0.2, wheelDy: -0.1 }, null, TICK_DT)
    const dBoth = both.pitch - baseC

    expect(dMouse).toBeLessThan(0)
    expect(dWheel).toBeLessThan(0)
    expect(dBoth).toBeLessThan(0)
    expect(dBoth).toBeCloseTo(dMouse + dWheel, 10) // 同一 tick 下同阻尼，应几乎逐字相加
  })
})
