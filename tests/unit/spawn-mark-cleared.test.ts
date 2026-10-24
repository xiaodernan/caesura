/**
 * SpawnDirector.markCleared 守卫（src/world/SpawnDirector.ts）。
 *
 * 覆盖实测（v8 text reporter，src/world）报 SpawnDirector.ts 96% 行，未取分支正是
 * `markCleared` 里这一格（源码 171）：
 *
 *     if (!this.slots.some((s) => s.key === key)) return // 数据改过槽位身份 ⇒ 忽略陈旧记录而不是崩
 *
 * `markCleared` 全库只有一个调用方——读档路径（`Serializer.ts`：`for (const k of s.clearedSlots) markCleared(k)`），
 * 而**没有任何测试驱动过它的陈旧 key 分支**。这是真契约：存档里的清剿记录是稳定字符串
 * （`区域:组序号:成员序号`），但玩家手上的档可能是旧数据/改过数据时存的——那种 key 今天已不在槽位表里，
 * 读档必须**静默忽略**，既不能抛（读档即崩），也不能误标（把不存在的槽记成已清剿）。
 *
 * 锁的要点：
 *   1. 合法 key 落进 cleared，clearedKeys 如实反映；
 *   2. 陈旧 key ⇒ 静默忽略：不抛、不污染 cleared、且不影响之后合法 key 正常落进。
 */
import { describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
import type { RegionData, SpawnGroup, Vec3 } from '@/data/schema'
import { chunkKeyOf, StreamingSystem } from '@/world/Streaming'
import { SpawnDirector, type SpawnHost } from '@/world/SpawnDirector'

registerGameData()

function region(id: string, groups: SpawnGroup[]): RegionData {
  const base = regions[0]
  return {
    ...base, id, nameKey: `region.${id}`, displayName: id, order: 99,
    unlockFlag: undefined, bounds: { minX: -10000, maxX: 10000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1000 },
    spawnGroups: groups, landmarks: [], interactables: [], secrets: [], storyHooks: [],
  }
}
const group = (over: Partial<SpawnGroup> = {}): SpawnGroup => ({
  enemyId: 'en_murkshell', count: 1, center: { x: 0, y: 0, z: 0 }, radius: 12, ...over,
})
const host = (): SpawnHost => ({ spawn: () => ({ id: 'en#1' }), despawn: () => false, hasFlag: () => false })
function cellKey(): (p: Vec3) => string {
  const s = new StreamingSystem(regions)
  return (p) => { const c = s.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
}

describe('SpawnDirector.markCleared：读档灌回清剿记录，陈旧 key 静默忽略', () => {
  it('合法槽位 key 落进 cleared，clearedKeys 如实反映', () => {
    const g = group()
    const ck = cellKey()
    const d = new SpawnDirector([region('rg_a', [g])], host(), ck)
    const key = d.slotsInChunk(ck(g.center))[0].key
    expect(key, '槽位身份 = 区域:组序号:成员序号').toBe('rg_a:0:0')
    d.markCleared(key)
    expect(d.clearedCount).toBe(1)
    expect(d.clearedKeys()).toEqual([key])
  })

  it('陈旧 key（数据改过槽位身份）⇒ 静默忽略：不抛、不污染、不影响后续合法 key', () => {
    const g = group()
    const ck = cellKey()
    const d = new SpawnDirector([region('rg_a', [g])], host(), ck)
    expect(() => d.markCleared('rg_a:99:99')).not.toThrow()
    expect(d.clearedCount, '陈旧记录不污染 cleared').toBe(0)
    // 合法 key 之后仍能正常落进（陈旧那次没把表搞坏）
    d.markCleared(d.slotsInChunk(ck(g.center))[0].key)
    expect(d.clearedCount).toBe(1)
    expect(d.clearedKeys()).toEqual(['rg_a:0:0'])
  })
})
