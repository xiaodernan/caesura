import { describe, expect, it, afterEach } from 'vitest'
import * as THREE from 'three'
import { registerGameData } from '@/data'
import { GPUParticles, getGPUParticles } from '@/vfx/GPUParticles'
import { QualityStore, QUALITY_PROFILES } from '@/settings/Quality'

/**
 * Phase 7 F2 第三批：画质四档 → GPUParticles 预算乘数 接线验证。
 *
 * headless 可证：three 在 node 里可直接构造 Scene，不需要 WebGL 上下文。
 * 验证 QualityStore 的 targets.particles.spawnMul 能被用来初始化 GPUParticles 的
 * budgetMul，从而实现「设置档位 → 粒子生成预算」的端到端闭环。
 */

registerGameData()

function makeScene(): THREE.Scene {
  const s = new THREE.Scene()
  return s
}

const mkTargets = () => ({
  particles: { spawnMul: 1 },
  renderer: { resolutionScale: 1, shadowMapSize: 1536 },
})

describe('KI-420/F2 第三批：QualityStore → GPUParticles 预算乘数接线', () => {
  afterEach(() => {
    getGPUParticles()?.dispose()
  })

  it('QualityStore targets.particles.spawnMul 可作为 GPUParticles budgetMul 使用（低档 0.6）', () => {
    const targets = mkTargets()
    const store = new QualityStore(targets, 0 as const) // 低档：particleSpawnMul = 0.6
    expect(store.get()).toBe(0)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[0].particleSpawnMul) // 0.6

    const fx = new GPUParticles(makeScene(), { budgetMul: targets.particles.spawnMul })
    const emitter = fx.getEmitter('fx_dust')!
    expect(emitter.config.spawnRate).toBeCloseTo(6, 6) // 10 * 0.6
    expect(emitter.config.maxParticles).toBe(24) // floor(40 * 0.6)
    fx.dispose()
  })

  it('QualityStore targets.particles.spawnMul 可作为 GPUParticles budgetMul 使用（极高档 1.6）', () => {
    const targets = mkTargets()
    const store = new QualityStore(targets, 3 as const) // 极高档：particleSpawnMul = 1.6
    expect(store.get()).toBe(3)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[3].particleSpawnMul) // 1.6

    const fx = new GPUParticles(makeScene(), { budgetMul: targets.particles.spawnMul })
    const emitter = fx.getEmitter('fx_dust')!
    expect(emitter.config.spawnRate).toBeCloseTo(16, 6) // 10 * 1.6
    expect(emitter.config.maxParticles).toBe(64) // floor(40 * 1.6)
    fx.dispose()
  })

  it('clampQuality 拒绝 .5 档，GPUParticles budgetMul 始终基于有效档位', () => {
    const targets = mkTargets()
    const store = new QualityStore(targets)
    // 1.5 不是合法档位，会被 clamp 回 2（高档，spawnMul = 1.0）
    store.set(1.5 as unknown)
    expect(store.get()).toBe(2)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[2].particleSpawnMul) // 1.0

    const fx = new GPUParticles(makeScene(), { budgetMul: targets.particles.spawnMul })
    const emitter = fx.getEmitter('fx_dust')!
    expect(emitter.config.spawnRate).toBe(10) // 10 * 1.0，不变
    expect(emitter.config.maxParticles).toBe(40) // floor(40 * 1.0)
    fx.dispose()
  })

  it('QualityStore.set(0) → targets.particles.spawnMul 变为 0.6，GPUParticles 生成预算相应减少', () => {
    const targets = mkTargets()
    const store = new QualityStore(targets, 2 as const) // 初始高档 1.0
    expect(targets.particles.spawnMul).toBe(1.0)

    store.set(0) // 切到低档 0.6
    expect(store.get()).toBe(0)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[0].particleSpawnMul) // 0.6

    const fx = new GPUParticles(makeScene(), { budgetMul: targets.particles.spawnMul })
    const emitter = fx.getEmitter('fx_dust')!
    expect(emitter.config.spawnRate).toBeCloseTo(6, 6)
    expect(emitter.config.maxParticles).toBe(24)
    fx.dispose()
  })

  it('QualityStore.set(1) → targets.particles.spawnMul 变为 1.0，与高档 2 一致（发售原样行为）', () => {
    const targets = mkTargets()
    const store = new QualityStore(targets)

    store.set(1) // 中档
    expect(store.get()).toBe(1)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[1].particleSpawnMul) // 1.0

    store.set(2) // 高档
    expect(store.get()).toBe(2)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[2].particleSpawnMul) // 1.0，与中档一致

    const fx = new GPUParticles(makeScene(), { budgetMul: targets.particles.spawnMul })
    const emitter = fx.getEmitter('fx_dust')!
    expect(emitter.config.spawnRate).toBe(10) // 10 * 1.0，不变
    fx.dispose()
  })
})
