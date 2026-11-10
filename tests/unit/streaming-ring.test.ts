import { describe, expect, it } from 'vitest'
import { StreamingSystem, DEFAULT_OPTIONS } from '@/world/Streaming'
import { registerGameData, regions } from '@/data'

/**
 * Phase 7 F2 第二批：Streaming ring 接线测试。
 *
 * 验证 `StreamingOptions.activateRingBonus` / `preloadRingBonus` 从画质档位
 * `QualityStore.profile()` 一次性叠加到激活环与预载圈上，构造后不再改。
 *
 * headless 可证：只读 StreamingSystem，不接 three、不接玩家。
 */
registerGameData()

describe('KI-429/F2-第二批：Streaming ring 接线（画质档位 bonus 一次性叠加）', () => {
  it('默认构造：activateRing/preloadRing 与 DEFAULT_OPTIONS 逐字一致', () => {
    const s = new StreamingSystem(regions)
    expect(s.options.activateRing).toBe(DEFAULT_OPTIONS.activateRing)
    expect(s.options.preloadRing).toBe(DEFAULT_OPTIONS.preloadRing)
    expect(s.options.activateRingBonus).toBe(0)
    expect(s.options.preloadRingBonus).toBe(0)
  })

  it('activateRingBonus=1：激活环从 1 变 2，预载圈不动', () => {
    const s = new StreamingSystem(regions, { activateRingBonus: 1 })
    expect(s.options.activateRing).toBe(2)
    expect(s.options.activateRingBonus).toBe(1)
    expect(s.options.preloadRing).toBe(DEFAULT_OPTIONS.preloadRing)
    expect(s.options.preloadRingBonus).toBe(0)
  })

  it('preloadRingBonus=-1：预载圈从 2 变 1，激活圈不动', () => {
    const s = new StreamingSystem(regions, { preloadRingBonus: -1 })
    expect(s.options.preloadRing).toBe(1)
    expect(s.options.preloadRingBonus).toBe(-1)
    expect(s.options.activateRing).toBe(DEFAULT_OPTIONS.activateRing)
    expect(s.options.activateRingBonus).toBe(0)
  })

  it('两者叠加：activateRing+1，preloadRing-1，互不干扰', () => {
    const s = new StreamingSystem(regions, { activateRingBonus: 1, preloadRingBonus: -1 })
    expect(s.options.activateRing).toBe(2)
    expect(s.options.preloadRing).toBe(1)
    expect(s.options.activateRingBonus).toBe(1)
    expect(s.options.preloadRingBonus).toBe(-1)
  })

  it('activateRingBonus=0 与不传等价（不再改基数）', () => {
    const a = new StreamingSystem(regions)
    const b = new StreamingSystem(regions, { activateRingBonus: 0 })
    expect(a.options.activateRing).toBe(b.options.activateRing)
    expect(a.options.preloadRing).toBe(b.options.preloadRing)
  })

  it('构造后不再重算：修改 options 对象不影响已建系统', () => {
    const opts = { activateRingBonus: 5 }
    const s = new StreamingSystem(regions, opts)
    expect(s.options.activateRing).toBe(DEFAULT_OPTIONS.activateRing + 5)
    opts.activateRingBonus = 99
    expect(s.options.activateRing).toBe(DEFAULT_OPTIONS.activateRing + 5)
  })
})
