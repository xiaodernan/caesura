/**
 * 垂直分层地面查询（Phase 3-B，technical-architecture §3 world/Surface）。
 * 息声领地表/上层/地下共用 xz，所以 floorAt 必须按高度选层而不是按 regionAt 的首个匹配。
 */
import { describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
import type { RegionData } from '@/data/schema'
import { Surface } from '@/world/Surface'

registerGameData()

const s = new Surface(regions)

function synthetic(over: Partial<RegionData>): RegionData {
  return {
    id: 'rg_x', nameKey: 'region.x', displayName: 'X', order: 0, biome: 'forest',
    bounds: { minX: 0, maxX: 96, minY: 0, maxY: 48, minZ: 0, maxZ: 96 },
    groundY: 0, chunkSize: 48, weatherPresets: ['clear'], lightingPreset: 'lp_x',
    palette: { base: '#fff', accent: '#fff', glow: '#fff' },
    spawnGroups: [], landmarks: [], interactables: [],
    music: { explore: 'e', battle: 'b', ambience: 'a' },
    streamingPriority: 10, secrets: [], storyHooks: [],
    ...over,
  } as RegionData
}

const id = (rid: string): RegionData => regions.find((r) => r.id === rid)!

describe('Surface.floorAt（叠层世界落点）', () => {
  it('每块区域都有自己的地面高度，且与 bounds 自洽', () => {
    for (const r of regions) {
      expect(Number.isFinite(r.groundY), `${r.id} groundY`).toBe(true)
      expect(r.groundY, `${r.id} groundY inside bounds`).toBeGreaterThanOrEqual(r.bounds.minY)
      expect(r.groundY, `${r.id} groundY inside bounds`).toBeLessThan(r.bounds.maxY)
    }
    expect(id('rg_resthold').groundY).toBe(0)
    expect(id('rg_drowned_choir').groundY).toBe(-40)
    expect(id('rg_fellcarillon').groundY).toBe(64)
    expect(id('rg_earless_deeps').groundY).toBe(-144)
    expect(id('rg_unfinished_hall').groundY).toBe(152)
  })

  it('地表点落在地表层：休垒中心 = 0', () => {
    expect(s.floorAt({ x: 0, y: 0, z: 0 })).toEqual({ y: 0, regionId: 'rg_resthold' })
    expect(s.floorAt({ x: -60, y: 3, z: 60 })).toEqual({ y: 0, regionId: 'rg_resthold' })
  })

  it('上层 xz 重叠时取最高地板，不取 regions 数组里的第一个', () => {
    // 钟坠院 groundY 64 覆盖雾语林 groundY 0（xz 交叠区）
    const overlap = { x: 200, y: 80, z: -150 }
    expect(s.floorAt(overlap)?.regionId).toBe('rg_fellcarillon')
    expect(s.floorAt(overlap)?.y).toBe(64)
    // 同一 xz、高度在下层 ⇒ 归属地表
    expect(s.floorAt({ ...overlap, y: 30 })).toEqual({ y: 0, regionId: 'rg_whisperwode' })
    // 顺序反转也必须同样选高层（证明不是 regionAt 式的首个匹配）
    const reversed = new Surface([...regions].reverse())
    expect(reversed.floorAt(overlap)?.regionId).toBe('rg_fellcarillon')
  })

  it('地下层在其 bounds 高度以下接管脚下', () => {
    const below = { x: 300, y: -30, z: 0 } // 沉唱堂 groundY -40 在雾语林地板之下
    expect(s.floorAt(below)).toEqual({ y: -40, regionId: 'rg_drowned_choir' })
  })

  it('台阶容差：略低于地面（<= tolerance）仍吸附到该层，掉出世界返回 null', () => {
    expect(s.floorAt({ x: 0, y: -0.4, z: 0 })?.y).toBe(0)
    expect(s.floorAt({ x: 0, y: -0.6, z: 0 })).toBeNull()
    expect(s.floorAt({ x: 10_000, y: 0, z: 10_000 })).toBeNull()
  })

  it('bounds 上界开区间：接缝处只归属一侧，不会出现双层同时命中', () => {
    const b = id('rg_resthold').bounds
    expect(s.floorAt({ x: b.minX, y: 0, z: 0 })).not.toBeNull()
    expect(s.floorAt({ x: b.maxX, y: 0, z: 0 })?.regionId).not.toBe('rg_resthold')
  })

  it('同一 xz 上三层堆叠时逐层可选（吊桥/井道式结构）', () => {
    const stack = new Surface([
      synthetic({ id: 'rg_deep', groundY: -80, bounds: { minX: 0, maxX: 96, minY: -128, maxY: -48, minZ: 0, maxZ: 96 } }),
      synthetic({ id: 'rg_mid', groundY: 0, bounds: { minX: 0, maxX: 96, minY: -8, maxY: 40, minZ: 0, maxZ: 96 } }),
      synthetic({ id: 'rg_high', groundY: 48, bounds: { minX: 0, maxX: 96, minY: 40, maxY: 96, minZ: 0, maxZ: 96 } }),
    ], 0.1)
    expect(stack.floorAt({ x: 40, y: 60, z: 40 })?.regionId).toBe('rg_high')
    expect(stack.floorAt({ x: 40, y: 20, z: 40 })?.regionId).toBe('rg_mid')
    expect(stack.floorAt({ x: 40, y: -20, z: 40 })?.regionId).toBe('rg_deep')
    expect(stack.floorAt({ x: 40, y: -200, z: 40 })).toBeNull()
  })
})
