import { describe, expect, it } from 'vitest'
import { executionPose } from '@/world/ExecutionPose'

/**
 * `src/world/ExecutionPose.ts`：§5.4 处决演出的灰盒姿态数学（KI-002 的演出腿；纯函数，无 three）。
 *
 * 设计口径：处决蒙太奇是**受刑者坍塌**的过程；攻击者只有一记「高举-落下」的劈砍。
 * 进度 0..1 与 `player.executing` 的 tick/total 同源，代码里不写第二份时长。
 * tilt 与 sink 共用同一条 ease-in（二次）⇒ 两者的重量是同一份。
 */

describe('executionPose：边界与 clamp', () => {
  it('progress 小于 0 ⇒ clamp 到 0；大于 1 ⇒ clamp 到 1', () => {
    expect(executionPose(-1)).toEqual(executionPose(0))
    expect(executionPose(2)).toEqual(executionPose(1))
  })

  it('progress = 0：受刑者站立（tilt=0, sink=0），攻击者高举（chop=0.6）', () => {
    const p = executionPose(0)
    expect(p.tilt).toBe(0)
    expect(p.sink).toBe(0)
    expect(p.chop).toBe(0.6)
  })

  it('progress = 1：受刑者跪倒（tilt=1.35, sink=0.35），刀留在身体里（chop=-1.1）', () => {
    const p = executionPose(1)
    expect(p.tilt).toBe(1.35)
    expect(p.sink).toBe(0.35)
    expect(p.chop).toBe(-1.1)
  })
})

describe('executionPose：坍塌曲线（前 15% 静止，之后 ease-in）', () => {
  it('前 15%（p=0.15）受刑者仍站立：tilt=0, sink=0', () => {
    const p = executionPose(0.15)
    expect(p.tilt).toBe(0)
    expect(p.sink).toBe(0)
  })

  it('坍塌段（p=0.5）：tilt < 1.35 × 3/7（ease-in 比匀速慢）', () => {
    const p = executionPose(0.5)
    // fall = (0.5-0.15)/0.85 = 0.4118，ease-in = 0.1697 ⇒ tilt ≈ 0.229
    expect(p.tilt).toBeGreaterThan(0)
    expect(p.tilt).toBeLessThan(1.35 * 0.5)
    // sink 与 tilt 同一条 ease（同一份重量）
    expect(p.sink / 0.35).toBeCloseTo(p.tilt / 1.35, 10)
  })

  it('坍塌段末端（p=1）：tilt=1.35, sink=0.35（整段到位）', () => {
    const p = executionPose(1)
    expect(p.tilt).toBe(1.35)
    expect(p.sink).toBe(0.35)
  })
})

describe('executionPose：劈砍三段（0.25 高举 → 0.45 落到底 → 保持）', () => {
  it('p < 0.25：高举过头（chop=0.6）', () => {
    expect(executionPose(0).chop).toBe(0.6)
    expect(executionPose(0.24).chop).toBe(0.6)
  })

  it('0.25 ≤ p < 0.45：劈砍下落（chop 从 0.6 降到 -1.1）', () => {
    const mid = executionPose(0.35).chop
    expect(mid).toBeLessThan(0.6)
    expect(mid).toBeGreaterThan(-1.1)
  })

  it('0.45 ≤ p：刀留在身体里，不复位（chop=-1.1）', () => {
    expect(executionPose(0.45).chop).toBeCloseTo(-1.1, 10)
    expect(executionPose(0.6).chop).toBe(-1.1)
    expect(executionPose(1).chop).toBe(-1.1)
  })
})
