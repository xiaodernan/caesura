import { describe, expect, it, afterEach } from 'vitest'
import * as THREE from 'three'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { GPUParticles, getGPUParticles } from '@/vfx/GPUParticles'
import {
  DEFAULT_QUALITY,
  QUALITY_NAMES,
  QUALITY_PROFILES,
  QUALITY_TIERS,
  QualityStore,
  clampQuality,
  type QualityTier,
} from '@/settings/Quality'

/**
 * Phase 7 F2 第一格（headless 可证）：**画质档基础契约**。
 *
 * 画质档的实现只有一张主人表（QUALITY_PROFILES）：单元读数就读它，谁想改数都只准改这一处。
 * 本文件管住三件事：信任边界（clampQuality）、档位表本身（存在性/单调性/默认值）、
 * 两位真正数了的消费者——GPUParticles 的预算乘数 hook，以及 QualityStore 的灌注。
 *
 * 不在本文件里的（Phase 7 后续）：Streaming 环的实际接线、renderer 分档、UI 第七页之后的设置行——
 * 那些都要么被组合根零覆盖率挡住、要么要等 Phase 9/10 的数才能取，不是本批的范围。
 */

registerGameData()

const scenes: THREE.Scene[] = []
afterEach(() => {
  getGPUParticles()?.dispose()
  for (const s of scenes.splice(0)) s.clear()
})
const newScene = (): THREE.Scene => {
  const s = new THREE.Scene()
  scenes.push(s)
  return s
}

describe('KI-420｜QualityTier 信任边界（clampQuality）', () => {
  it('四档都原样通过', () => {
    for (const t of QUALITY_TIERS) expect(clampQuality(t)).toBe(t)
  })
  it('越界／非整数／非数／非对象 ⇒ 默认 2', () => {
    for (const raw of [-1, 4, 99, 1.5, NaN, Infinity, '高', 'high', '', null, undefined, {}, true, []] as unknown[]) {
      expect(clampQuality(raw), `raw=${JSON.stringify(raw)} 必须回落到默认`).toBe(DEFAULT_QUALITY)
    }
  })
})

describe('KI-420｜档位表（QUALITY_PROFILES）五腿', () => {
  it('名字与档位一一对应：低/中/高/极高', () => {
    expect(QUALITY_NAMES).toHaveLength(4)
    expect(QUALITY_TIERS).toEqual([0, 1, 2, 3])
    expect(QUALITY_NAMES).toEqual(['低', '中', '高', '极高'])
  })
  it('默认档等于 2（高），且表里每一格都有完整值——没有缺腿的格', () => {
    expect(DEFAULT_QUALITY).toBe(2)
    for (const t of QUALITY_TIERS) {
      const p = QUALITY_PROFILES[t]
      expect(p.particleSpawnMul).toBeGreaterThan(0)
      expect(p.particleSpawnMul).toBeLessThanOrEqual(2)
      expect(p.activateRingBonus).toBeGreaterThanOrEqual(-1)
      expect(p.activateRingBonus).toBeLessThanOrEqual(1)
      expect(p.preloadRingBonus).toBeGreaterThanOrEqual(-1)
      expect(p.preloadRingBonus).toBeLessThanOrEqual(1)
      expect(p.shadowMapSize).toBeGreaterThanOrEqual(512)
      expect(p.shadowMapSize).toBeLessThanOrEqual(2048)
      expect(p.shadowMapSize % 128).toBe(0)
      expect(p.resolutionScale).toBeGreaterThanOrEqual(0.5)
      expect(p.resolutionScale).toBeLessThanOrEqual(1.25)
    }
  })
  it('三个"越高越大"的格锁单调不减序列（粒子/阴影/分辨率/激活环）', () => {
    const seq = (getter: (t: QualityTier) => number): number[] => QUALITY_TIERS.map(getter)
    const nonDecreasing = (xs: number[]): boolean => xs.every((x, i) => i === 0 || x >= xs[i - 1]!)
    expect(nonDecreasing(seq((t) => QUALITY_PROFILES[t].particleSpawnMul)), '粒子预算').toBe(true)
    expect(nonDecreasing(seq((t) => QUALITY_PROFILES[t].shadowMapSize)), '阴影贴图边长').toBe(true)
    expect(nonDecreasing(seq((t) => QUALITY_PROFILES[t].resolutionScale)), '分辨率').toBe(true)
    expect(nonDecreasing(seq((t) => QUALITY_PROFILES[t].activateRingBonus)), '激活环').toBe(true)
    expect(nonDecreasing(seq((t) => QUALITY_PROFILES[t].preloadRingBonus)), '预载圈').toBe(true)
  })
  it('中档与高档今天行为一致（particleSpawnMul 都是 1.0）——发售原样不用动', () => {
    expect(QUALITY_PROFILES[1].particleSpawnMul).toBe(1.0)
    expect(QUALITY_PROFILES[2].particleSpawnMul).toBe(1.0)
  })
  it('预设表被冻结（谁写穿它，先红）', () => {
    expect(() => {
      ;(QUALITY_PROFILES as unknown as { 0: { particleSpawnMul: number } })[0].particleSpawnMul = 999
    }).toThrow()
  })
})

describe('KI-420｜QualityStore 的灌注（构造即灌、set/restore 各灌一次）', () => {
  const mkTargets = () => ({ particles: { spawnMul: 1 } })

  it('构造默认档 = 2，注入点直接读到表里的粒子预算', () => {
    const targets = mkTargets()
    new QualityStore(targets)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[2].particleSpawnMul)
  })
  it('restore(0) 先灌低档；而后 restore(undefined)/restore(null) ⇒ 什么都不动', () => {
    const targets = mkTargets()
    const s = new QualityStore(targets, 2 as QualityTier)
    s.restore(0)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[0].particleSpawnMul)
    const after0 = targets.particles.spawnMul
    s.restore(undefined)
    expect(targets.particles.spawnMul, 'restore(undefined) 是 §78 留空，不动').toBe(after0)
    s.restore(null)
    expect(targets.particles.spawnMul, 'restore(null) 和 undefined 同一个口径').toBe(after0)
  })
  it('set(3) 把灌入目标推到极高档读数（唯一与高/中档不重合的格）', () => {
    const targets = mkTargets()
    const s = new QualityStore(targets)
    s.set(3)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[3].particleSpawnMul)
    expect(s.get()).toBe(3)
  })
  it('坏档 restore ⇒ 回默认（不喂消费者）', () => {
    const targets = mkTargets()
    const s = new QualityStore(targets, 1 as QualityTier)
    s.set(2) // move off default to prove restore actually re-clamps
    s.restore(999 as unknown)
    expect(s.get()).toBe(DEFAULT_QUALITY)
    expect(targets.particles.spawnMul).toBe(QUALITY_PROFILES[DEFAULT_QUALITY].particleSpawnMul)
  })
  it('profile() 每次返回档位卡片（同名引用），测试改表也不写穿', () => {
    const s = new QualityStore(null)
    const p = s.profile()
    expect(p).toBe(QUALITY_PROFILES[s.get()])
  })
})

describe('KI-420｜GPUParticles budgetMul hook（唯一有真消费方的乘数）', () => {
  it('默认构造：fx_dust 行为不乘（spawnRate 10，池 40）', () => {
    const fx = new GPUParticles(newScene())
    const fx_dust = registry.get('vfx:emitters') as Array<{ id: string; maxParticles: number }>
    const row = fx_dust.find((e) => e.id === 'fx_dust')!
    const emitter = fx.getEmitter('fx_dust')!
    expect(emitter.config.maxParticles).toBe(row.maxParticles)
    expect(emitter.config.spawnRate).toBe(10) // fx_dust 的真表行（10/s）
  })
  it('budgetMul=2：fx_dust 的生成预算与池子都跟表缩小一倍关系（spawnRate*2, 池*2）', () => {
    const fx = new GPUParticles(newScene(), { budgetMul: 2 })
    const emitter = fx.getEmitter('fx_dust')!
    expect(emitter.config.maxParticles).toBe(80) // floor(40*2)
    expect(emitter.config.spawnRate).toBe(20) // 10*2
    expect(emitter.particles.length).toBe(80)
  })
  it('budgetMul=0.6：池子最小 1 ×（生成速率 6/s）', () => {
    const fx = new GPUParticles(newScene(), { budgetMul: 0.6 })
    const emitter = fx.getEmitter('fx_dust')!
    expect(emitter.config.maxParticles).toBe(24) // floor(40*0.6)
    expect(emitter.config.spawnRate).toBeCloseTo(6, 6)
    expect(emitter.particles.length).toBe(24)
  })
  it('getEmitter 同实例只建一次（预算是构造期决定，不每帧重算）', () => {
    const fx = new GPUParticles(newScene(), { budgetMul: 1.3 })
    const a = fx.getEmitter('fx_dust')!
    const b = fx.getEmitter('fx_dust')!
    expect(a).toBe(b)
  })
})
