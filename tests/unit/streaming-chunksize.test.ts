/**
 * StreamingSystem 构造的 chunkSize 一致性守卫（src/world/Streaming.ts）。
 *
 * 覆盖实测（v8，streaming*.test.ts）报 Streaming.ts 唯一未取分支在构造函数里这一格（源码 102）：
 *
 *     const sizes = new Set(regions.map((r) => r.chunkSize))
 *     if (sizes.size !== 1) throw new Error(`Streaming: regions disagree on chunkSize (${[...sizes].join(',')})`)
 *
 * 全库没有任何测试用**不一致的 chunkSize** 构造过 StreamingSystem（所有夹具都是 48）⇒ 这条抛腿从没被验。
 * 而它是真数据完整性契约：chunk key 由 (cell, chunkSize) 决定，若两块区域 chunkSize 不同还静默选一个，
 * 世界会被切成两套互不认的格子、流送与存档的 chunk key 全部错位。所以必须**当场抛**，不猜。
 */
import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import type { RegionData } from '@/data/schema'
import { StreamingSystem } from '@/world/Streaming'

registerGameData()

function region(id: string, chunkSize: number): RegionData {
  return {
    id, nameKey: `region.${id}`, displayName: id, order: 0, biome: 'forest',
    bounds: { minX: 0, maxX: 192, minY: 0, maxY: 48, minZ: 0, maxZ: 192 },
    chunkSize, weatherPresets: ['clear'], lightingPreset: 'lp_x',
    palette: { base: '#fff', accent: '#fff', glow: '#fff' },
    spawnGroups: [], landmarks: [], interactables: [],
    music: { explore: 'e', battle: 'b', ambience: 'a' },
    streamingPriority: 10, secrets: [], storyHooks: [],
  } as unknown as RegionData
}

describe('StreamingSystem 构造：chunkSize 必须全表一致', () => {
  it('两块区域 chunkSize 不一致 ⇒ 当场抛（不静默选一个，那会把 chunk key 弄脏）', () => {
    expect(() => new StreamingSystem([region('rg_a', 48), region('rg_b', 64)]))
      .toThrow(/chunkSize/)
  })

  it('一致时正常构造（对照：不误抛）', () => {
    expect(() => new StreamingSystem([region('rg_a', 48), region('rg_b', 48)])).not.toThrow()
  })
})
