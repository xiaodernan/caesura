import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { CameraRig, SHAKE_TABLE } from '@/player/CameraRig'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * combat.hit 震镜分流（CameraRig 构造函数里的订阅）第一次有读者：
 * hit/graze 吃命中自带的 shakeKey（缺省回落 graze）、block/perfectBlock 一律按 graze 处理、
 * parry 走自己的行还带 roll=2 的横滚。`immune` 是反证腿：三档都不沾，队列不许动。
 * resize 也在此一并钉住（aspect 跟视口走）。
 * 之所以另起文件：camera-feedback.test 立了「不举真实例喂总线」的规矩（构造即挂常订阅、
 * 无卸载口）——这里整文件隔离，rig 与发射方都在本文件内自控，不越界污染别人的断言。
 */

Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
afterEach(() => {
  Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
})

const shakesOf = (rig: CameraRig): Array<{ amp: number; freq: number; roll: number }> =>
  (rig as unknown as { shakes: Array<{ amp: number; freq: number; roll: number }> }).shakes

const hitEvt = (result: string, shakeKey = ''): void => {
  bus.emit('combat.hit', {
    attackerId: 'p1', victimId: 'en_1', damage: 8, poiseDamage: 5,
    kind: 'light', point: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 },
    result: result as 'hit', hitStopMs: 40, shakeKey, backstab: false, weakpoint: false
  })
}

const rig = (): CameraRig => new CameraRig() // shakeIntensity 默认 1：量的是表值直通

describe('combat.hit 震镜分流（订阅侧）', () => {
  it('hit/graze 吃命中 shakeKey：heavy 进 2.0°/6Hz，空 key 回落 graze 0.3°', () => {
    const r = rig()
    hitEvt('hit', 'heavy')
    expect(shakesOf(r)).toHaveLength(1)
    expect(shakesOf(r)[0].amp).toBeCloseTo(SHAKE_TABLE.heavy.amp, 6)
    expect(shakesOf(r)[0].freq).toBeCloseTo(SHAKE_TABLE.heavy.freq, 6)
    hitEvt('graze') // shakeKey 缺省（falsy）⇒ ‖ 'graze'
    expect(shakesOf(r)).toHaveLength(2)
    expect(shakesOf(r)[1].amp).toBeCloseTo(SHAKE_TABLE.graze.amp, 6)
  })

  it('block/perfectBlock 一律按 graze 震——挡下来了也是接触', () => {
    const r = rig()
    hitEvt('block', 'heavy') // shakeKey 写了也不吃：分流只认结果档
    expect(shakesOf(r)).toHaveLength(1)
    expect(shakesOf(r)[0].amp).toBeCloseTo(SHAKE_TABLE.graze.amp, 6)
    hitEvt('perfectBlock')
    expect(shakesOf(r)).toHaveLength(2)
    expect(shakesOf(r)[1].amp).toBeCloseTo(SHAKE_TABLE.graze.amp, 6)
  })

  it('parry 走自己的行且带 roll=2 的横滚；immune 三档都不沾是反证腿', () => {
    const r = rig()
    hitEvt('parry', 'heavy')
    const s = shakesOf(r)
    expect(s).toHaveLength(1)
    expect(s[0].amp).toBeCloseTo(SHAKE_TABLE.parry.amp, 6)
    expect(s[0].freq).toBeCloseTo(SHAKE_TABLE.parry.freq, 6)
    expect(s[0].roll, '弹反的横滚是这一行独有的形状').toBe(2)
    hitEvt('immune', 'heavy')
    expect(shakesOf(r), '免疫不算接触：队列长度不动').toHaveLength(1)
  })

  it('resize 把 aspect 跟到当前视口', () => {
    const r = rig()
    expect(r.cam.aspect).toBeCloseTo(1280 / 720, 6)
    Object.defineProperty(globalThis, 'innerWidth', { value: 1920, configurable: true })
    Object.defineProperty(globalThis, 'innerHeight', { value: 1080, configurable: true })
    r.resize()
    expect(r.cam.aspect).toBeCloseTo(1920 / 1080, 6)
  })
})

describe('批17 分支死角：update 路径（蒙太奇推轨 / 入地钳制 / 横滚 / 绕背 yaw 环绕）', () => {
  /** update 只读 pos/executing、写 camYawRef——手造最小桩，不举真控制器 */
  const fp = (over: Record<string, unknown> = {}): PlayerController =>
    ({ pos: { x: 0, y: 0, z: 0 }, executing: null, camYawRef: 0, ...over }) as unknown as PlayerController
  const posSmoothOf = (r: CameraRig): { x: number; y: number; z: number } =>
    (r as unknown as { posSmooth: { x: number; y: number; z: number } }).posSmooth

  it('未知 shakeKey 回落 graze 行（SHAKE_TABLE[key] ?? 的右腿）', () => {
    const r = rig()
    r.shake('no_such_row')
    expect(shakesOf(r)).toHaveLength(1)
    expect(shakesOf(r)[0].amp, '表里没有的键按 graze 兜底').toBeCloseTo(SHAKE_TABLE.graze.amp, 6)
  })

  it('处决蒙太奇（无锁定）：dist 压推轨系数、FOV 随 execPull 收缩到 50 以下', () => {
    const r = rig()
    r.update(0.016, fp({ executing: { tick: 10, total: 60, pos: { x: 0, y: 0, z: -2 } } }), { dx: 0, dy: 0 }, null)
    expect(r.cam.fov, 'EXEC_DOLLY.fovDelta=-7 乘 execPull（首帧已 >0）⇒ 比 50 低').toBeLessThan(50)
    expect(r.cam.fov, '但首帧 execPull 还小，远没到 43 的下限').toBeGreaterThan(43)
  })

  it('低谷地形 + 俯角拉满：posSmooth.y 钳在 0.35，镜头不许入地', () => {
    const r = rig()
    const p = fp({ pos: { x: 0, y: -2, z: 0 } })
    for (let i = 0; i < 12; i++) r.update(0.5, p, { dx: 0, dy: -0.8 }, null)
    expect(posSmoothOf(r).y, '期望位深陷地下 ⇒ 每帧都被抬回地板之上').toBe(0.35)
  })

  it('横滚项：parry 的 roll=2 真正累加进 rotation.z；roll=0 的行不带横滚', () => {
    const baseline = rig()
    baseline.update(0.01, fp(), { dx: 0, dy: 0 }, null) // 无震镜：rotation.z 只来自 lookAt 姿态
    const r = rig()
    r.shake('graze')
    r.update(0.01, fp(), { dx: 0, dy: 0 }, null)
    expect(Math.abs(r.cam.rotation.z - baseline.cam.rotation.z),
      'roll=0 的行不带横滚（残差只是 lookAt 姿态噪声）').toBeLessThan(0.002)
    const zBefore = r.cam.rotation.z
    r.shake('parry')
    r.update(0.01, fp(), { dx: 0, dy: 0 }, null)
    expect(r.cam.rotation.z - zBefore, 'roll=2 只有 parry 行有：多出 ~0.008 的横滚').toBeGreaterThan(0.004)
  })

  it('锁定绕背差角 > π：wrapNear 折进 (-π,π]（d>π 腿），yaw 朝折返后的目标追', () => {
    const r = rig()
    // **前置条件直给**（KI-133）：这一格量的是 `wrapNear` 的折返方向，不是"鼠标/摇杆怎么转 yaw"。
    // 原先的前置是"喂一帧 dx=3 让 yaw 走到 -2.4"——那依赖输入模型（`yaw -= look.dx`），
    // 而 CameraRig 改成按模式阻尼缩放（`look.dx * yawDamp * dt`）之后那一步算不出这个角度了。
    // 把 yaw 直接摆到折返所需的那一侧，这一格才真的只量折返。
    r.yaw = -2.4
    r.update(0.5, fp(), { dx: 0, dy: 0 }, { x: -3, y: 0, z: -1 }) // away≈1.25 ⇒ 原始差 ≈ 4.0 > π
    expect(r.yaw, '目标角折返到 -π 之外 ⇒ 朝更负方向收敛，而不是绕短弧走回头').toBeLessThan(-2.4)
  })

  it('锁定绕背差角 < -π：wrapNear 反向折返（d<-π 腿）', () => {
    const r = rig()
    r.yaw = 2.6 // 同上：前置直给，不借输入模型
    r.update(0.5, fp(), { dx: 0, dy: 0 }, { x: 3, y: 0, z: -1 }) // away≈-1.25 ⇒ 原始差 ≈ -3.5 < -π
    expect(r.yaw, '对称的另一侧：折返后朝更正方向收敛').toBeGreaterThan(2.6)
  })
})
