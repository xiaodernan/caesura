import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { CameraRig, SHAKE_TABLE } from '@/player/CameraRig'

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
