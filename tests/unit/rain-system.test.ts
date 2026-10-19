import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { RainSystem } from '@/vfx/RainSystem'

/**
 * 雨粒子系统（Phase B3 结案落点，KI-149 补测）。
 *
 * **为什么补这一份**：KI-133 把 `RainSystem` 落进主干时，它**一条测试都没有**（覆盖率门
 * 的"新增零覆盖文件"那条当场把它点名）。而这一格是**天气那一半的唯一表现载体**——
 * KI-126 删掉那张没有发射方的 `weather.changed` 频道之后，天气改由组合根注入
 * （`main.ts` 的 `applyWeather` 调 `rain.setWeather(name)`，KI-130），所以"下不下雨"这件事
 * 如今只由这个类回答。
 *
 * **判的几件事**：① 两格 `docWeather: "rain"`（`drip`／`emberfall`）下雨，其余不下；
 * ② 建图在构造器一次完成，此后只开关可见性与雨强；③ 雨强只影响"画多少粒子"与"多透明"；
 * ④ 不下雨时 update 不动任何数；⑤ dispose 把网格从场景里摘干净。
 */
const makeRain = (): { rain: RainSystem; scene: THREE.Scene } => {
  const scene = new THREE.Scene()
  const rain = new RainSystem(scene)
  return { rain, scene }
}

const particlesOf = (rain: RainSystem): THREE.Points => {
  const p = (rain as unknown as { particles: THREE.Points | null }).particles
  if (!p) throw new Error('雨系统没有建出粒子网格')
  return p
}

describe('雨粒子系统（KI-149）', () => {
  it('构造器建一次图：场景里多一个 Points，开局不画（还没下雨）', () => {
    const { rain, scene } = makeRain()
    expect(scene.children.length, '场景里应当有雨粒子那一个').toBe(1)
    expect(particlesOf(rain).visible, '开局不是雨天 ⇒ 不画').toBe(false)
  })

  it('下不下雨只认两格天气名：drip / emberfall', () => {
    const { rain } = makeRain()
    for (const name of ['drip', 'emberfall']) {
      rain.setWeather(name)
      expect(particlesOf(rain).visible, `${name} 应当下雨`).toBe(true)
    }
    for (const name of ['clear', 'fog', 'dissonant-storm', null]) {
      rain.setWeather(name)
      expect(particlesOf(rain).visible, `${String(name)} 应当不下雨`).toBe(false)
    }
  })

  it('雨强决定画多少粒子与多透明（setIntensity 两格都改）', () => {
    const { rain } = makeRain()
    rain.setWeather('drip')
    rain.setIntensity(0.5)
    const geo = particlesOf(rain).geometry
    const mat = particlesOf(rain).material as THREE.PointsMaterial
    expect(geo.drawRange.count, '画一半的粒子').toBe(Math.round((rain as unknown as { maxParticles: number }).maxParticles * 0.5))
    expect(mat.opacity).toBeCloseTo(0.6 * 0.5, 6)
    rain.setIntensity(0)
    expect(geo.drawRange.count, '雨强 0 ⇒ 一个都不画').toBe(0)
  })

  it('下雨时 update 让粒子往下走；不下雨时一个数都不动', () => {
    const { rain } = makeRain()
    const attr = particlesOf(rain).geometry.getAttribute('position') as THREE.BufferAttribute
    const before = attr.array[1]
    rain.setWeather('drip')
    for (let i = 0; i < 10; i++) rain.update(1 / 60, new THREE.Vector3())
    expect(attr.array[1], '粒子应当往下掉').toBeLessThan(before)

    const { rain: dry } = makeRain()
    const dryAttr = particlesOf(dry).geometry.getAttribute('position') as THREE.BufferAttribute
    const dryBefore = dryAttr.array.slice()
    for (let i = 0; i < 10; i++) dry.update(1 / 60, new THREE.Vector3())
    expect(Array.from(dryAttr.array as Float32Array), '不下雨时位置一个都不许动').toEqual(Array.from(dryBefore as Float32Array))
  })

  it('落地的粒子会被回收（位置不会跑到无穷远，且没有 NaN）', () => {
    const { rain } = makeRain()
    rain.setWeather('drip')
    rain.setIntensity(1)
    const attr = particlesOf(rain).geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < 600; i++) rain.update(1 / 60, new THREE.Vector3())
    for (let i = 0; i < attr.array.length; i++) {
      expect(Number.isFinite(attr.array[i]), `第 ${i} 个分量必须是有限数`).toBe(true)
    }
  })

  it('dispose 把网格从场景里摘干净', () => {
    const { rain, scene } = makeRain()
    rain.dispose()
    expect(scene.children.length, '场景里不该剩下雨粒子').toBe(0)
  })
})
