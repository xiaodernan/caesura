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


/**
 * §5.9.33③ 敌人浓度腿（`weather.json > gameplay.concentrationMul`）。
 *
 * **这条腿为什么是"铺开半径 ÷ 乘数"而不是"多刷几个"**：slot 的条数由
 * `regions.json > spawnGroups[].count` 写死，运行时没有任何合法来源能多造一颗怪——
 * 真要"Storm 期敌人浓度+"按条数兑现，得改关卡数据（给那一区加 spawnGroups），
 * 那不是天气读数能管的一格。所以这里量的是同一批怪**铺得有多聚**。
 */
describe('§5.9.33③ 敌人浓度腿：只改"下一次进格铺在哪"，不动已经活着的', () => {
  /** 记下每一颗怪**精确**落点的假 host（上面那个 `host()` 只记四舍五入过的坐标） */
  function posHost(): SpawnHost & { live: Map<string, string>; at: Vec3[] } {
    const live = new Map<string, string>()
    const at: Vec3[] = []
    let n = 0
    return {
      live, at,
      spawn: (enemyId, pos) => { const id = `en#${++n}`; live.set(id, enemyId); at.push({ ...pos }); return { id } },
      despawn: (id) => live.delete(id),
      hasFlag: () => true,
    }
  }

  it('浓度 1（缺省）⇒ 落点就是基准点：这一腿没接线之前与之后逐格相同', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 4, center: { x: 40, y: 0, z: 40 }, radius: 12 })
    const h = posHost()
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    const key = cellKey(g.center)
    const base = d.slotsInChunk(key).map((s) => s.pos)
    active(key)
    expect(h.at).toEqual(base)
    d.dispose()
  })

  it('浓度 2 ⇒ 每一颗都向组心收一半；基准点位不漂移（浓度回到 1 时这一组回得了家）', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 4, center: { x: 40, y: 0, z: 40 }, radius: 12 })
    const h = posHost()
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    const key = cellKey(g.center)
    const base = d.slotsInChunk(key).map((s) => s.pos)
    d.setConcentration(2)
    active(key)
    expect(h.at).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      expect(h.at[i].x, `第 ${i} 颗的 x 没有向组心收一半`).toBeCloseTo(40 + (base[i].x - 40) / 2, 10)
      expect(h.at[i].z, `第 ${i} 颗的 z 没有向组心收一半`).toBeCloseTo(40 + (base[i].z - 40) / 2, 10)
      expect(h.at[i].y, '高度不参与浓度（收拢的是水平铺开）').toBe(base[i].y)
    }
    // 基准没有被就地改写：否则浓度回到 1 时这一组铺不回原地（每次切换都再缩一圈）
    expect(d.slotsInChunk(key).map((s) => s.pos)).toEqual(base)
    d.setConcentration(1)
    gone(key)
    active(key)
    expect(h.at.slice(4), '浓度回到 1 之后这一组铺不回原地 = 基准被改写过').toEqual(base)
    d.dispose()
  })

  it('浓度 0.5 ⇒ 铺开一倍（同一个乘数两个方向都说得通：它就是"浓度"）', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 3, center: { x: 0, y: 0, z: 0 }, radius: 10 })
    const h = posHost()
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    const key = cellKey(g.center)
    const base = d.slotsInChunk(key).map((s) => s.pos)
    d.setConcentration(0.5)
    active(key)
    for (let i = 0; i < 3; i++) {
      expect(h.at[i].x).toBeCloseTo(base[i].x * 2, 10)
      expect(h.at[i].z).toBeCloseTo(base[i].z * 2, 10)
    }
    d.dispose()
  })

  it('只影响"下一次进格"：已经活着的怪一颗都不动，也不多刷也不少刷', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 3 })
    const h = posHost()
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    const key = cellKey(g.center)
    active(key)
    expect(h.live.size).toBe(3)
    const before = h.at.map((p) => ({ ...p }))
    d.setConcentration(3)
    expect(h.live.size, '换浓度把活着的怪收回去或者说掉了').toBe(3)
    expect(h.at, '换浓度之后没有任何新的 spawn/despawn').toEqual(before)
    // 离开再进格才按新浓度落位：新一批全部落在基准半径的三分之一之内
    gone(key)
    active(key)
    expect(h.at.slice(3)).toHaveLength(3)
    const baseR = Math.max(...before.map((p) => Math.hypot(p.x, p.z)))
    for (const p of h.at.slice(3)) expect(Math.hypot(p.x, p.z)).toBeLessThan(baseR / 3 + 1e-9)
    d.dispose()
  })

  it('≤0 按 1 收：浓度是半径的除数，0 会算出 Infinity 的落点', () => {
    const cellKey = cellKeyOf32()
    const g = group({ count: 2 })
    const h = posHost()
    const d = new SpawnDirector([region('rg_a', [g])], h, cellKey)
    const key = cellKey(g.center)
    const base = d.slotsInChunk(key).map((s) => s.pos)
    d.setConcentration(0)
    active(key)
    expect(h.at).toEqual(base)
    d.dispose()
  })
})
