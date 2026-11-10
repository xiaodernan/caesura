import { describe, expect, it } from 'vitest'
import { QualityStore, type QualityTier } from '@/settings/Quality'
import { RendererQuality, applyRendererQuality, type RendererQualityTargets } from '@/renderer/QualityRenderer'

/**
 * src/renderer/QualityRenderer.ts 单元测试（headless 可证）。
 *
 * 验证画质档 → renderer 分档消费：shadowMapSize / resolutionScale 被原样灌入
 * 渲染器目标对象，且随 QualityStore 档位切换而变化。
 */

const mkTargets = (): RendererQualityTargets => ({
  shadowMapSize: 0,
  resolutionScale: 0,
})

describe('QualityRenderer：画质档→渲染器分档消费', () => {
  it('applyRendererQuality：低档 0 → shadowMapSize 512 / resolutionScale 0.7', () => {
    const targets = mkTargets()
    applyRendererQuality(targets, 0)
    expect(targets.shadowMapSize).toBe(512)
    expect(targets.resolutionScale).toBe(0.7)
  })

  it('applyRendererQuality：中档 1 → shadowMapSize 1024 / resolutionScale 0.85', () => {
    const targets = mkTargets()
    applyRendererQuality(targets, 1)
    expect(targets.shadowMapSize).toBe(1024)
    expect(targets.resolutionScale).toBe(0.85)
  })

  it('applyRendererQuality：高档 2 → shadowMapSize 1536 / resolutionScale 1.0', () => {
    const targets = mkTargets()
    applyRendererQuality(targets, 2)
    expect(targets.shadowMapSize).toBe(1536)
    expect(targets.resolutionScale).toBe(1.0)
  })

  it('applyRendererQuality：极高档 3 → shadowMapSize 2048 / resolutionScale 1.15', () => {
    const targets = mkTargets()
    applyRendererQuality(targets, 3)
    expect(targets.shadowMapSize).toBe(2048)
    expect(targets.resolutionScale).toBe(1.15)
  })

  it('RendererQuality 构造即 sync，读到默认档 2 的 renderer 参数', () => {
    const targets = mkTargets()
    const store = new QualityStore(null) // QualityStore 不写 targets，RendererQuality 独立灌入
    const rq = new RendererQuality(store, targets)
    expect(rq.shadowMapSize).toBe(1536) // 档 2
    expect(rq.resolutionScale).toBe(1.0)
    expect(rq.tier).toBe(2)
  })

  it('RendererQuality.sync()：档位切换后重新同步，targets 跟着变', () => {
    const targets = mkTargets()
    const store = new QualityStore(null)
    const rq = new RendererQuality(store, targets)

    expect(rq.shadowMapSize).toBe(1536)
    expect(rq.resolutionScale).toBe(1.0)

    store.set(0) // 切到低档
    rq.sync()
    expect(rq.shadowMapSize).toBe(512)
    expect(rq.resolutionScale).toBe(0.7)
    expect(rq.tier).toBe(0)

    store.set(3) // 切到极高档
    rq.sync()
    expect(rq.shadowMapSize).toBe(2048)
    expect(rq.resolutionScale).toBe(1.15)
    expect(rq.tier).toBe(3)
  })

  it('RendererQuality：三个"越高越大"的字段在 targets 里单调不减', () => {
    const targets = mkTargets()
    const store = new QualityStore(null)
    const rq = new RendererQuality(store, targets)

    const sizes: number[] = []
    const scales: number[] = []
    for (const t of [0, 1, 2, 3]) {
      store.set(t as QualityTier)
      rq.sync()
      sizes.push(rq.shadowMapSize)
      scales.push(rq.resolutionScale)
    }

    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!)
      expect(scales[i]!).toBeGreaterThanOrEqual(scales[i - 1]!)
    }
  })

  it('RendererQuality：headless 下 targets 只记不崩（没有 GL 上下文也能构造）', () => {
    const targets = mkTargets()
    const store = new QualityStore(null)
    const rq = new RendererQuality(store, targets)
    expect(rq.shadowMapSize).toBe(1536)
    expect(rq.resolutionScale).toBe(1.0)
    expect(() => rq.sync()).not.toThrow()
  })
})
