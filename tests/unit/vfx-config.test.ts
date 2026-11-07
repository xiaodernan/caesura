import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { blendingOf, colorOf, toDecalConfig, toEmitterConfig, toTrailConfig } from '@/vfx/VfxConfig'
import type { VfxDecalRow, VfxEmitterRow, VfxTrailRow } from '@/data/schema'

/**
 * `src/vfx/VfxConfig.ts`：表现层三件套的**配置转换层**（Phase B4，KI-135）。
 *
 * 数据表是纯 JSON，三个表现层模块内部用 three 的类型。转换必须发生在表现层——
 * 数据层不认识 three（依赖方向单向）。转换点只有一个：谁在表现层，谁转。
 */

describe('blendingOf：名字 → THREE.Blending', () => {
  it('additive / multiply / 其他 ⇒ 对应三混合模式', () => {
    expect(blendingOf('additive')).toBe(THREE.AdditiveBlending)
    expect(blendingOf('multiply')).toBe(THREE.MultiplyBlending)
    expect(blendingOf('normal')).toBe(THREE.NormalBlending)
    expect(blendingOf('unknown')).toBe(THREE.NormalBlending) // 回落，不抛
  })
})

describe('colorOf：hex 字符串 → THREE.Color', () => {
  it('#rrggbb / #rgb 都能解析出颜色通道', () => {
    const c = colorOf('#ff0000')
    expect(c.r).toBeCloseTo(1, 3)
    expect(c.g).toBeCloseTo(0, 3)
    expect(c.b).toBeCloseTo(0, 3)
  })

  it('认不出的串 ⇒ THREE.Color 自身行为（不抛，由判据那边红住）', () => {
    expect(colorOf('not-a-color')).toBeInstanceOf(THREE.Color)
  })
})

const decalRow: VfxDecalRow = {
  id: 'dec_bullet', type: 'bullet', lifetime: 30, fadeIn: 0.1, fadeOut: 0.5,
  size: { min: 0.1, max: 0.25 }, color: { base: '#202020', opacity: 0.9 },
  normalStrength: 0.8, roughnessOffset: 0.1, metalnessOffset: -0.2,
  randomRotation: true, randomScale: false, maxInstances: 16,
}

describe('toDecalConfig：一行贴花 → 表现层那份', () => {
  it('逐项映射正确（id/type/lifetime/size/color），color 是 THREE.Color', () => {
    const cfg = toDecalConfig(decalRow)
    expect(cfg.id).toBe('dec_bullet')
    expect(cfg.type).toBe('bullet')
    expect(cfg.lifetime).toBe(30)
    expect(cfg.size).toEqual({ min: 0.1, max: 0.25 })
    expect(cfg.color.base).toBeInstanceOf(THREE.Color)
    expect(cfg.color.base.getHexString()).toBe('202020')
    expect(cfg.color.opacity).toBe(0.9)
    expect(cfg.randomRotation).toBe(true)
    expect(cfg.randomScale).toBe(false)
    expect(cfg.maxInstances).toBe(16)
  })

  it('纹理可选：不写 textures ⇒ 输出没有该字段', () => {
    expect('textures' in toDecalConfig(decalRow)).toBe(false)
  })

  it('纹理写了 ⇒ 原样透传', () => {
    const row: VfxDecalRow = { ...decalRow, textures: { albedo: 'dec_a', normal: 'dec_n' } }
    const cfg = toDecalConfig(row)
    expect(cfg.textures).toEqual({ albedo: 'dec_a', normal: 'dec_n' })
  })
})

const trailRow: VfxTrailRow = {
  id: 'tr_sword', segments: 12, width: [0.3, 0.05], color: ['#ffffff', '#0000ff'],
  lifetime: 0.4, blending: 'additive', followRotation: true, minEmitDist: 0.2,
}

describe('toTrailConfig：一行拖尾 → 表现层那份', () => {
  it('逐项映射（width/color 各两格，color 是 THREE.Color，blending 转换）', () => {
    const cfg = toTrailConfig(trailRow)
    expect(cfg.id).toBe('tr_sword')
    expect(cfg.segments).toBe(12)
    expect(cfg.width).toEqual([0.3, 0.05])
    expect(cfg.color).toHaveLength(2)
    expect(cfg.color[0].getHexString()).toBe('ffffff')
    expect(cfg.color[1].getHexString()).toBe('0000ff')
    expect(cfg.blending).toBe(THREE.AdditiveBlending)
    expect(cfg.followRotation).toBe(true)
    expect(cfg.minEmitDist).toBe(0.2)
  })
})

const emitterRow: VfxEmitterRow = {
  id: 'em_hit', type: 'burst', maxParticles: 32, spawnRate: 16,
  spawnShape: 'sphere', spawnSize: { x: 0.5, y: 0.5, z: 0.5 },
  lifetime: { min: 0.3, max: 0.8 }, size: { start: 0.2, end: 0.05 },
  color: { start: '#ffffff', end: '#ff8800' },
  velocity: { min: { x: -1, y: 1, z: -1 }, max: { x: 1, y: 3, z: 1 } },
  acceleration: { x: 0, y: -5, z: 0 },
  gravity: -10, drag: 0.5, blending: 'additive', depthWrite: false, sizeAttenuation: true,
}

describe('toEmitterConfig：一行发射器 → 表现层那份', () => {
  it('逐项映射（spawnSize/acceleration 是 Vector3，color 是 THREE.Color，blending 切换）', () => {
    const cfg = toEmitterConfig(emitterRow)
    expect(cfg.id).toBe('em_hit')
    expect(cfg.type).toBe('burst')
    expect(cfg.maxParticles).toBe(32)
    expect(cfg.spawnRate).toBe(16)
    expect(cfg.spawnSize).toBeInstanceOf(THREE.Vector3)
    expect(cfg.spawnSize).toMatchObject({ x: 0.5, y: 0.5, z: 0.5 })
    expect(cfg.lifetime).toEqual({ min: 0.3, max: 0.8 })
    expect(cfg.color.start.getHexString()).toBe('ffffff')
    expect(cfg.color.end.getHexString()).toBe('ff8800')
    expect(cfg.velocity.min).toMatchObject({ x: -1, y: 1, z: -1 })
    expect(cfg.velocity.max).toMatchObject({ x: 1, y: 3, z: 1 })
    expect(cfg.gravity).toBe(-10)
    expect(cfg.blending).toBe(THREE.AdditiveBlending)
    expect(cfg.depthWrite).toBe(false)
    expect(cfg.sizeAttenuation).toBe(true)
  })

  it('trailLength / ribbonWidth 可选：不写 ⇒ 不出现', () => {
    const cfg = toEmitterConfig(emitterRow)
    expect('trailLength' in cfg).toBe(false)
    expect('ribbonWidth' in cfg).toBe(false)
  })

  it('trailLength / ribbonWidth 写了 ⇒ 透传', () => {
    const cfg = toEmitterConfig({ ...emitterRow, trailLength: 8, ribbonWidth: 0.4 })
    expect(cfg.trailLength).toBe(8)
    expect(cfg.ribbonWidth).toBe(0.4)
  })
})
