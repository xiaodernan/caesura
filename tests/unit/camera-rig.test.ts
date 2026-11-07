import { describe, expect, it } from 'vitest'
import {
  CameraMode,
  EXEC_DOLLY,
  MODE_CONFIG,
  SHAKE_FALLOFF_M,
  SHAKE_FLOOR_MUL,
  SHAKE_TABLE,
} from '@/player/CameraRig'

/**
 * `src/player/CameraRig.ts`：相机系统的纯数据与常量。
 *
 * 这里不测 three.js 相机本身（本机没有视口，KI-010 同因），只钉：
 * - 五种相机模式的枚举值
 * - 震镜表每一条的幅度/频率/持续（§10 的行，有机器读者）
 * - 世界事件震镜的距离衰减界（FALLOFF_M 米处归到 FLOOR_MUL）
 * - 处决推轨的 FOV 差/距离乘/阻尼
 * - 模式配置表每一列都有人读（§55「无消费方的数据不许入表」）
 */

describe('CameraMode：五种相机模式的枚举值', () => {
  it('五种模式各有字符串值，且互不相同', () => {
    expect(CameraMode.Exploration).toBe('exploration')
    expect(CameraMode.Combat).toBe('combat')
    expect(CameraMode.LockOn).toBe('lockOn')
    expect(CameraMode.Boss).toBe('boss')
    expect(CameraMode.Cinematic).toBe('cinematic')
    const vals = Object.values(CameraMode)
    expect(new Set(vals).size).toBe(5)
  })
})

describe('SHAKE_TABLE：§10 震镜表，每一条都有幅度/频率/持续', () => {
  it('八行都有 amp/freq/dur，且数值为正', () => {
    for (const [, row] of Object.entries(SHAKE_TABLE)) {
      expect(row.amp).toBeGreaterThan(0)
      expect(row.freq).toBeGreaterThan(0)
      expect(row.dur).toBeGreaterThan(0)
    }
  })

  it('graze/normal/hurt/parry/heavy/boss/execute/stomp 共 8 条', () => {
    expect(Object.keys(SHAKE_TABLE).sort()).toEqual([
      'boss', 'execute', 'graze', 'heavy', 'hurt', 'normal', 'parry', 'stomp',
    ])
  })

  it('处决(1.0°)轻于重击(2.0°)，与 KI-053「一记只许一个主人」同形', () => {
    expect(SHAKE_TABLE.execute.amp).toBe(1.0)
    expect(SHAKE_TABLE.heavy.amp).toBe(2.0)
    expect(SHAKE_TABLE.execute.amp).toBeLessThan(SHAKE_TABLE.heavy.amp)
  })

  it('Boss(4.0°)是最大幅度，断刹(0.3°)是最小', () => {
    const amps = Object.values(SHAKE_TABLE).map((r) => r.amp)
    expect(Math.max(...amps)).toBe(4.0)
    expect(Math.min(...amps)).toBe(0.3)
  })
})

describe('SHAKE_FALLOFF_M / SHAKE_FLOOR_MUL：世界事件震镜的距离衰减', () => {
  it('FALLOFF_M = 24，FLOOR_MUL = 0.25', () => {
    expect(SHAKE_FALLOFF_M).toBe(24)
    expect(SHAKE_FLOOR_MUL).toBe(0.25)
  })
})

describe('EXEC_DOLLY：§5.4 处决推轨，FOV 差 -7 / 距离乘 0.4 / 阻尼 8', () => {
  it('三项各自有值', () => {
    expect(EXEC_DOLLY.fovDelta).toBe(-7)
    expect(EXEC_DOLLY.distMul).toBe(0.4)
    expect(EXEC_DOLLY.damp).toBe(8)
  })
})

describe('MODE_CONFIG：五种模式的参数表，每一列都有人读', () => {
  it('五种模式都在表里，且字段齐全', () => {
    const expectedModes = [CameraMode.Exploration, CameraMode.Combat, CameraMode.LockOn, CameraMode.Boss, CameraMode.Cinematic]
    for (const mode of expectedModes) {
      const cfg = MODE_CONFIG[mode]
      expect(cfg).toBeDefined()
      expect(typeof cfg.yawDamp).toBe('number')
      expect(typeof cfg.pitchDamp).toBe('number')
      expect(typeof cfg.posDamp).toBe('number')
      expect(typeof cfg.distBase).toBe('number')
      expect(typeof cfg.distMin).toBe('number')
      expect(typeof cfg.distMax).toBe('number')
      expect(typeof cfg.fovBase).toBe('number')
      expect(typeof cfg.heightOffset).toBe('number')
      expect(typeof cfg.collisionRadius).toBe('number')
      expect(typeof cfg.lookAhead).toBe('number')
      expect(cfg.distMin).toBeLessThanOrEqual(cfg.distMax)
    }
  })

  it('探索/战斗/锁定/Boss/过场 五组参数各不相同', () => {
    const cfgs = [CameraMode.Exploration, CameraMode.Combat, CameraMode.LockOn, CameraMode.Boss, CameraMode.Cinematic]
      .map((m) => MODE_CONFIG[m])
    const distBases = cfgs.map((c) => c.distBase)
    expect(new Set(distBases).size).toBe(5)
  })

  it('过场模式碰撞半径为 0（过场由演出自己管轨道）', () => {
    expect(MODE_CONFIG[CameraMode.Cinematic].collisionRadius).toBe(0)
  })
})
