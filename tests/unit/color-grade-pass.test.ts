import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ColorGrade } from '@/vfx/ColorGrade'

/**
 * F1 后处理链接口：`ColorGrade.colorGradePass()` 输出失谐乘数，供 Material pass 消费。
 *
 * 失谐 0 ⇒ 1（原样，画面未褪色）；失谐 1 ⇒ 0.7（VEIL_BRIGHTNESS_SLOPE 的下限）。
 * 与 `gradeFilter` 里的亮度斜率同一条口径，不独立设数。
 *
 * 头less 可证：three 在 node 里可直接构造 Scene，不需要 WebGL 上下文。
 */
function fakeCanvas(): HTMLCanvasElement {
  const style = { filter: '' }
  return { style } as unknown as HTMLCanvasElement
}

describe('KI-094/F1｜colorGradePass：失谐乘数供 Material pass 消费', () => {
  it('失谐 0 ⇒ 乘数 1（原样，画面未褪色）', () => {
    const scene = new THREE.Scene()
    const grade = new ColorGrade(scene, fakeCanvas())
    expect(grade.colorGradePass()).toBe(1)
  })

  it('失谐 0.5 ⇒ 乘数 0.85（1 − 0.5 × 0.3）', () => {
    const scene = new THREE.Scene()
    const grade = new ColorGrade(scene, fakeCanvas())
    grade.setVeil(0.5)
    expect(grade.colorGradePass()).toBeCloseTo(0.85, 6)
  })

  it('失谐 1 ⇒ 乘数 0.7（VEIL_BRIGHTNESS_SLOPE 下限）', () => {
    const scene = new THREE.Scene()
    const grade = new ColorGrade(scene, fakeCanvas())
    grade.setVeil(1)
    expect(grade.colorGradePass()).toBeCloseTo(0.7, 6)
  })

  it('setVeil 改后 colorGradePass 同步跟随（单输入单输出，无二义）', () => {
    const scene = new THREE.Scene()
    const c = fakeCanvas()
    const grade = new ColorGrade(scene, c)
    grade.setVeil(0.2)
    expect(grade.colorGradePass()).toBeCloseTo(0.94, 6)
    grade.setVeil(0.8)
    expect(grade.colorGradePass()).toBeCloseTo(0.76, 6)
  })

  it('colorGradePass 与 canvas 无关（headless 假画布也能读）', () => {
    const scene = new THREE.Scene()
    const grade = new ColorGrade(scene, fakeCanvas())
    grade.setVeil(0.6)
    expect(grade.colorGradePass()).toBeCloseTo(0.82, 6)
  })
})
