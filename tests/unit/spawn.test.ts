/**
 * SpawnDirector 单元测试（Phase 3-C2，需求 §55 数据驱动 + §50 流送预算）。
 * 用假 host（SpawnHost 端口）验证整条生命周期：不需要 AISystem，也不需要 DOM。
 */
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { registerGameData, regions } from '@/data'
import type { RegionData, SpawnGroup, Vec3 } from '@/data/schema'
import { chunkKeyOf, StreamingSystem } from '@/world/Streaming'
import { SpawnDirector, evalCondition, type SpawnHost } from '@/world/SpawnDirector'

registerGameData()

function region(id: string, groups: SpawnGroup[]): RegionData {
  const base = regions[0]
  return {
    ...base, id, nameKey: `region.${id}`, displayName: id, order: 99,
    unlockFlag: undefined, bounds: { minX: -10000, maxX: 10000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1000 },
    spawnGroups: groups, landmarks: [], interactables: [], secrets: [], storyHooks: [],
  }
}

function host(flags = new Set<string>()): SpawnHost & { live: Map<string, string>; calls: string[] } {
  const live = new Map<string, string>() // instanceId -> enemyId
  const calls: string[] = []
  let n = 0
  return {
    live, calls,
    spawn: (enemyId, pos, seed) => {
      calls.push(`+${enemyId}@${Math.round(pos.x)},${Math.round(pos.z)}#${seed}`)
      const id = `en#${++n}`
      live.set(id, enemyId)
      return { id }
    },
    despawn: (id) => {
      if (!live.delete(id)) return false
      calls.push(`-${id}`)
      return true
    },
    hasFlag: (k) => flags.has(k),
  }
}

const group = (over: Partial<SpawnGroup> = {}): SpawnGroup => ({
  enemyId: 'en_murkshell', count: 3, center: { x: 0, y: 0, z: 0 }, radius: 12, ...over,
})

/** 事件的 key 必须与 director 的 cellKey 注入一致，否则它永远等不到自己那格 */
function cellKeyOf32(): (p: Vec3) => string {
  const s = new StreamingSystem(regions)
  return (p) => { const c = s.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
}

const active = (key: string): void => { bus.emit('world.chunk', { key, regionId: 'rg_x', cx: 0, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 }, state: 'active', priority: 0, tick: 1 }) }
const gone = (key: string): void => { bus.emit('world.chunk', { key, regionId: 'rg_x', cx: 0, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 }, state: 'unloaded', priority: 0, tick: 2 }) }

describe('spawn condition expressions', () => {
  it('支持 flag 与取反的合取，空表达式恒真', () => {
    const has = (k: string): boolean => k === 'flag.a'
    expect(evalCondition(undefined, has)).toBe(true)
    expect(evalCondition('   ', has)).toBe(true)
    expect(evalCondition('flag.a', has)).toBe(true)
    expect(evalCondition('flag.b', has)).toBe(false)
    expect(evalCondition('!flag.b', has)).toBe(true)
    expect(evalCondition('!flag.a', has)).toBe(false)
    expect(evalCondition('flag.a && !flag.b', has)).toBe(true)
    expect(evalCondition('flag.a && flag.b', has)).toBe(false)
  })
})

describe('deterministic placement (§55 零硬编码、可复现)', () => {
  it('同数据两次构建点位完全一致，且都在半径内、y 取层高原', () => {
    const g = group({ count: 5, center: { x: 160, y: 8, z: -100 }, radius: 14 })
    const cellKey = cellKeyOf32()
    const a = new SpawnDirector([region('rg_a', [g])], host(), cellKey)
    const b = new SpawnDirector([region('rg_a', [g])], host(), cellKey)
    const posA = a.slotsInChunk(cellKey(g.center)).map((s) => s.pos)
    const posB = b.slotsInChunk(cellKey(g.center)).map((s) => s.pos)
    expect(posA).toEqual(posB)
    expect(posA).toHaveLength(5)
    for (const p of posA) {
      expect(Math.hypot(p.x - 160, p.z + 100)).toBeLessThanOrEqual(14 * 1.3)
      expect(p.y).toBe(8)
    }
    // 成员不叠在同一颗点上（5 个点位 → 至少 5 个不同 xz）
    expect(new Set(posA.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size).toBe(5)
    a.dispose(); b.dispose()
  })

  it('组按 center 所在 cell 归格（与流送同一套 key）', () => {
    const g = group({ center: { x: 300, y: 0, z: 120 } })
    const cellKey = cellKeyOf32()
    const d = new SpawnDirector([region('rg_a', [g])], host(), cellKey)
    expect(d.slotsInChunk(cellKey(g.center))).toHaveLength(3)
    expect(d.slotsInChunk('99,99,99')).toHaveLength(0)
    expect(d.slotCount).toBe(3)
    d.dispose()
  })

  it('真实 7 区数据展开出的槽位数 = Σcount，且 enemyId 全部可解析', () => {
    const cellKey = cellKeyOf32()
    const d = new SpawnDirector(regions, host(), cellKey)
    const expect_n = regions.reduce((n, r) => n + r.spawnGroups.reduce((m, g) => m + g.count, 0), 0)
    expect(d.slotCount).toBe(expect_n)
    expect(expect_n).toBeGreaterThanOrEqual(15)
    for (const r of regions) for (const g of r.spawnGroups) expect(registry.has(g.enemyId), g.enemyId).toBe(true)
    d.dispose()
  })
})

describe('chunk-driven lifecycle', () => {
  it('进格出怪、离格回收、再进格重新出怪', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 3 })
    const h = host()
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    const key = cellKey(g.center)
    expect(h.live.size).toBe(0)
    active(key)
    expect(h.live.size).toBe(3)
    expect(d.aliveCount).toBe(3)
    gone(key)
    expect(h.live.size).toBe(0)
    active(key)
    expect(h.live.size).toBe(3)
    d.dispose()
  })

  it('击杀过的槽位不再刷新，其它槽位照常（清剿是持久的）', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 3 })
    const h = host()
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    const key = cellKey(g.center)
    active(key)
    const first = d.alive()[0]!
    const deadId = first.instanceId!
    bus.emit('entity.died', { id: deadId, kind: 'enemy', position: { x: 0, y: 0, z: 0 } })
    expect(d.clearedCount).toBe(1)
    h.live.delete(deadId) // 模拟 AISystem 把淡出的尸体移出名单
    expect(h.live.size).toBe(2)
    gone(key)
    active(key)
    expect(h.live.size).toBe(2) // 回到本格：只补没死过的那两个槽位
    expect(d.clearedCount).toBe(1)
    d.dispose()
  })

  it('condition 未满足不出怪，flag 到位后下一次进格即出', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 2, condition: 'flag.quest_done && !flag.camp_rebuilt' })
    const flags = new Set<string>()
    const h = host(flags)
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    const key = cellKey(g.center)
    active(key)
    expect(h.live.size).toBe(0)
    flags.add('flag.camp_rebuilt') // 取反项被踩 → 依旧不出
    active(key)
    expect(h.live.size).toBe(0)
    flags.delete('flag.camp_rebuilt')
    flags.add('flag.quest_done')
    active(key)
    expect(h.live.size).toBe(2)
    d.dispose()
  })

  it('AI 同时激活上限：超额不落地，但会发 warn 日志（不静默丢弃）', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 6 })
    const h = host()
    const warns: string[] = []
    const off = bus.on('log', (l) => { if (l.level === 'warn') warns.push(l.msg) })
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey, { maxAlive: 4 })
    active(cellKey(g.center))
    expect(h.live.size).toBe(4)
    expect(warns.join('|')).toContain('AI 上限')
    off()
    d.dispose()
  })

  it('dispose 后不再响应流送事件', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 2 })
    const h = host()
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    d.dispose()
    active(cellKey(g.center))
    expect(h.live.size).toBe(0)
  })
})
