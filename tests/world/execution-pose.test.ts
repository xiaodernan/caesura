import { describe, expect, it } from 'vitest'
import { executionPose } from '@/world/ExecutionPose'

/**
 * §5.4 处决演出的姿态数学（KI-002 演出腿）。
 * 三条硬口径：受刑者的坍塌是 ease-in（重量感）、攻击者的劈砍是「高举-落下-保持」
 * 三段（刀不复位——拔出来的处决不叫处决）、两份量纲共用同一个进度源
 * （`player.executing` 的 tick/total，代码里没有第二份时长）。
 */
describe('处决姿态数学（KI-002 演出腿）', () => {
  it('端点：0 = 站立高举前，1 = 跪倒到底 + 刀落到底', () => {
    const start = executionPose(0)
    expect(start.tilt).toBe(0)
    expect(start.sink).toBe(0)
    expect(start.chop, '起手高举').toBe(0.6)
    const end = executionPose(1)
    expect(end.tilt, '跪倒 1.35 rad').toBeCloseTo(1.35, 10)
    expect(end.sink, '下沉 0.35m').toBeCloseTo(0.35, 10)
    expect(end.chop, '刀落到底并保持').toBe(-1.1)
  })

  it('坍塌是 ease-in：前 15% 静止（挨第一刀的那段），之后加速倒下', () => {
    expect(executionPose(0.1).tilt, '前 15% 站着').toBe(0)
    expect(executionPose(0.15).tilt).toBe(0)
    const a = executionPose(0.4).tilt
    const b = executionPose(0.7).tilt
    const c = executionPose(1).tilt
    expect(a).toBeGreaterThan(0)
    expect(c - b, '后段每 0.3 的增量比前段大（加速倒下）').toBeGreaterThan(b - a)
  })

  it('劈砍三段：高举保持 → 0.2 内落到底 → 保持；进度越界被夹住', () => {
    expect(executionPose(0.2).chop).toBe(0.6)
    expect(executionPose(0.35).chop).toBeCloseTo(0.6 - 0.5 * 1.7, 10)
    expect(executionPose(0.45).chop).toBe(-1.1)
    expect(executionPose(0.9).chop).toBe(-1.1)
    expect(executionPose(-0.5).tilt, '负进度夹住').toBe(0)
    expect(executionPose(2).tilt, '超进度夹住').toBe(1.35)
  })
})
