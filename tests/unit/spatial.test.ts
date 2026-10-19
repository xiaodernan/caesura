/**
 * KI-083 那一步的唯一主人：`spatialize`（声源 → 听者的斜距 / 距离衰减 / 声像）。
 *
 * 为什么需要**独立**校验而不是沿用现有测试的读法：`ambience-field.test.ts` 与
 * `audio-engine.test.ts` 都把 `spatialize` 当**神谕**（`const want = spatialize(...)` 再拿
 * 组合节点的 pan/gain 去比它）——那样的用例证明的是「两条读者正确地把 spatialize 的结果接进了
 * 各自的节点」，一旦 spatialize 自己的算式/常数退化了，这些用例会跟着同一个错值一起绿。本文件
 * 反过来钉 `spatialize` 本身：期望值全部用手算的**字面数**（不用模块常量、不调用 spatialize）
 * 写死，于是常量 16/1.8/2/0.85/0.02 或其公式任何一处被改动都会在这里显形。
 *
 * 这与 KI-083 的设计意图同向：抽它出来就是为了「两条读者读同一个位置得到同一个声像」，
 * 那么这位主人的数字本身必须不能再漂。
 *
 * `spatial.ts` 零 import（纯数学），故本文件无需任何装配、不读数据表、不碰并行会话在途文件。
 */
import { describe, expect, it } from 'vitest'
import {
  spatialize,
  ATT_HALF_M,
  ATT_EXP,
  AUDIBLE_FLOOR,
  PAN_MIN_DIST,
  PAN_MAX,
} from '@/audio/spatial'

const ORIGIN = { x: 0, y: 0, z: 0, yaw: 0 } // yaw 0 = 面向 −Z（与 CameraRig 同一口径）

describe('spatialize 距离衰减 att：1/(1+(d/16)^1.8) 这五个数的形状', () => {
  it('dist=0 ⇒ 无损 1；半程 16m ⇒ 恰 0.5（钉住 ATT_HALF_M 与公式本身）', () => {
    const zero = spatialize({ x: 0, y: 0, z: 0 }, ORIGIN)
    expect(zero.dist).toBe(0)
    expect(zero.att).toBe(1)
    // 手算：1/(1+(16/16)^1.8) = 1/(1+1) = 0.5 —— 常量与推导都不调用模块侧
    expect(spatialize({ x: 16, y: 0, z: 0 }, ORIGIN).att).toBeCloseTo(0.5, 12)
  })

  it('att@32 ≈ 1/(1+2^1.8)：钉住指数就是 1.8（既不是 1/r 的 1.0，也不是 2.0）', () => {
    // 手算期望：1/(1+2^1.8) ≈ 0.2231；指数写成字面 1.8 而非 ATT_EXP，才是独立神谕
    const expected = 1 / (1 + Math.pow(2, 1.8))
    expect(spatialize({ x: 32, y: 0, z: 0 }, ORIGIN).att).toBeCloseTo(expected, 12)
    // 反向刻度：若指数被误改成 1.0，这两个读数会分叉
    expect(spatialize({ x: 32, y: 0, z: 0 }, ORIGIN).att).not.toBeCloseTo(1 / (1 + Math.pow(2, 1.0)), 6)
  })

  it('斜距含高度差：正上方 30m 的高度差完整计入 dist 与 att（不做水平近似）', () => {
    const up = spatialize({ x: 0, y: 30, z: 0 }, ORIGIN)
    expect(up.dist).toBe(30)
    expect(up.att).toBeCloseTo(1 / (1 + Math.pow(30 / 16, 1.8)), 12)
  })

  it('att 单调下降、永不超 1、远处逼近 0 并落到 AUDIBLE_FLOOR 之下', () => {
    expect(spatialize({ x: 8, y: 0, z: 0 }, ORIGIN).att).toBeGreaterThan(spatialize({ x: 16, y: 0, z: 0 }, ORIGIN).att)
    expect(spatialize({ x: 16, y: 0, z: 0 }, ORIGIN).att).toBeGreaterThan(spatialize({ x: 32, y: 0, z: 0 }, ORIGIN).att)
    // 近旁也严格小于 1（0 点才是 1）
    expect(spatialize({ x: 1, y: 0, z: 0 }, ORIGIN).att).toBeLessThan(1)
    // 远处落到「一个节点都不建」的门槛之下（字面 16/1.8 手算约 0.0105 < 0.02）
    expect(spatialize({ x: 200, y: 0, z: 0 }, ORIGIN).att).toBeLessThan(AUDIBLE_FLOOR)
  })
})

describe('spatialize 声像 pan：水平投影 → listen 朝向系，钳到 ±PAN_MAX', () => {
  it('yaw=0 面向 −Z：右 +0.85 / 左 −0.85 / 正前与正后都 0', () => {
    expect(spatialize({ x: 100, y: 0, z: 0 }, ORIGIN).pan).toBeCloseTo(PAN_MAX, 12) // 右手边拉满到上限
    expect(spatialize({ x: -100, y: 0, z: 0 }, ORIGIN).pan).toBeCloseTo(-PAN_MAX, 12)
    expect(spatialize({ x: 0, y: 0, z: -100 }, ORIGIN).pan).toBeCloseTo(0, 12) // 正前方
    expect(spatialize({ x: 0, y: 0, z: 100 }, ORIGIN).pan).toBeCloseTo(0, 12) // 正后方
  })

  it('pan 随听者 yaw 旋转：同一世界 −Z 声源，听者转 90° 后从正前变右手边', () => {
    const facing = { x: 0, y: 0, z: 0, yaw: Math.PI / 2 } // 面向 +X
    const worldAhead = { x: 0, y: 0, z: -100 } // 世界的 −Z 一侧
    expect(spatialize(worldAhead, facing).pan).toBeCloseTo(PAN_MAX, 12) // 对转后的听者而言在右边
    const worldRight = { x: 100, y: 0, z: 0 } // 世界的 +X，此刻正在他正前方
    expect(spatialize(worldRight, facing).pan).toBeCloseTo(0, 12)
  })

  it('PAN_MIN_DIST：贴身（<2m）不跳满，pan = side / 2 × 0.85（去掉地板会从 0.6375 跳到 0.85）', () => {
    // 手算：dist=1.5<PAN_MIN_DIST ⇒ 分母按 2 计；1.5/2×0.85 = 0.6375
    expect(spatialize({ x: 1.5, y: 0, z: 0 }, ORIGIN).pan).toBeCloseTo(0.6375, 12)
  })

  it('pan 的分子是水平投影、分母是斜距：抬高 y 会把贴侧声源往中间收', () => {
    const ground = spatialize({ x: 100, y: 0, z: 0 }, ORIGIN)
    const raised = spatialize({ x: 100, y: 50, z: 0 }, ORIGIN)
    // 两侧 level 相同（水平分量 side 都是 100）⇒ 贴地时斜距=100，拉满 PAN_MAX
    expect(ground.pan).toBeCloseTo(PAN_MAX, 12)
    // 抬高 50m 后斜距变 √(100²+50²)，同一条水平分量除以更大的分母 ⇒ 声像朝中间收
    // 手算期望：(100 / √(100²+50²)) × 0.85 ≈ 0.7603；这是本函数的真实语义（分子水平、分母斜距）
    expect(raised.pan).toBeCloseTo((100 / Math.sqrt(100 * 100 + 50 * 50)) * PAN_MAX, 12)
    expect(raised.pan).toBeLessThan(ground.pan)
  })
})

describe('KI-083 五枚常量的字面值（两条读者共同主人的数字本身）', () => {
  it('ATT_HALF_M/ATT_EXP/PAN_MIN_DIST/PAN_MAX/AUDIBLE_FLOOR 逐枚是文档搬来的那五个数', () => {
    expect(ATT_HALF_M).toBe(16) // 半程：走这么远，增益掉到 0.5
    expect(ATT_EXP).toBe(1.8) // 比 1/r 更「贴着耳朵」
    expect(PAN_MIN_DIST).toBe(2) // 贴脸按 2m 算，防 pan 跳变
    expect(PAN_MAX).toBe(0.85) // 留一点对侧串音
    expect(AUDIBLE_FLOOR).toBe(0.02) // 低于它一个节点都不建
  })
})
