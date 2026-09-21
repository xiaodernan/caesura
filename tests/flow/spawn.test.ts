/**
 * 出怪动线（Phase 3-C2，需求 §59 自动化玩法流）：
 * 真实 StreamingSystem + 真实 AISystem + SpawnDirector。人走进格子里敌人就该在，
 * 走远了就该被回收，杀过的回来不再刷新——main.ts 里不再有一行硬编码 ai.spawn。
 */
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData, regions } from '@/data'
import type { Vec3 } from '@/data/schema'
import { chunkKeyOf, StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { AISystem } from '@/ai/AISystem'

registerGameData()

function world(seed: string[] = []) {
  const ai = new AISystem()
  const stream = new StreamingSystem(regions)
  const flags = new Set<string>()
  const cellKey = (p: Vec3): string => { const c = stream.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
  const dir = new SpawnDirector(regions, {
    spawn: (id, pos, seed2) => ai.spawn(id, pos, seed2),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => flags.has(k),
  }, cellKey)
  /** 剧情 flag：同时给流送（解锁区域）与出怪（condition 判定） */
  const give = (k: string): void => { flags.add(k); stream.setFlag(k) }
  for (const k of seed) give(k)
  /** 玩家到位：等价 main.ts 的 streaming.teleport + spawner.syncActive */
  const walk = (pos: Vec3, tick: number): void => {
    stream.teleport(tick, pos)
    dir.syncActive(stream.byState('active').map((c) => c.key))
  }
  const dispose = (): void => { dir.dispose(); stream.dispose() }
  return { ai, stream, dir, cellKey, give, walk, dispose }
}

const YARD = { x: 200, y: 0, z: -100 } // 雾语林西侧 3 只嘈壳那格
const FAR = { x: -900, y: 0, z: 900 }

describe('spawn flow: 世界里有怪，不是代码里有怪', () => {
  it('休垒开场零敌人（安全屋设定）；出城门进雾语林才有 3 只嘈壳落地', () => {
    const w = world(['flag.left_resthold'])
    w.walk({ x: 0, y: 0, z: 0 }, 0)
    expect(w.ai.enemies).toHaveLength(0) // 休垒 spawnGroups = []
    w.walk(YARD, 60)
    const shells = w.ai.enemies.filter((e) => e.data.id === 'en_murkshell')
    expect(shells).toHaveLength(3)
    for (const e of shells) {
      expect(Math.hypot(e.pos.x - 160, e.pos.z + 100)).toBeLessThanOrEqual(14 * 1.3)
      expect(e.pos.y).toBe(0)
    }
    w.dispose()
  })

  it('未解锁区域即使几何上就在脚下也不出怪（流送闸门即出怪闸门）', () => {
    const w = world(['flag.left_resthold'])
    const choir = regions.find((r) => r.id === 'rg_drowned_choir')!
    const inside = choir.spawnGroups[0]!
    const key = w.cellKey(inside.center)
    expect(w.dir.slotsInChunk(key)).toHaveLength(inside.count)
    w.walk({ x: 250, y: 0, z: 60 }, 120) // 站到场地上方，但沉唱堂未解锁
    expect(w.ai.enemies.filter((e) => e.pos.y < 0)).toHaveLength(0)
    expect(w.dir.slotsInChunk(key).every((s) => s.instanceId === null)).toBe(true)
    w.give('flag.choir_entrance_open')
    w.walk({ x: 250, y: -40, z: 20 }, 180) // 下去：解锁后同一格立刻有怪
    expect(w.dir.slotsInChunk(key).some((s) => s.instanceId !== null)).toBe(true)
    w.dispose()
  })

  it('走远了回收、再回来重新出怪；杀过的槽位不再刷新', () => {
    const w = world(['flag.left_resthold'])
    w.walk(YARD, 60)
    const n0 = w.ai.enemies.length
    expect(n0).toBeGreaterThan(0)
    w.walk(FAR, 200)
    expect(w.ai.enemies).toHaveLength(0) // 离格即回收（不是死亡，不计清剿）
    expect(w.dir.clearedCount).toBe(0)
    w.walk(YARD, 260)
    expect(w.ai.enemies.length).toBe(n0)
    const victim = w.ai.enemies[0]!
    bus.emit('entity.died', { id: victim.id, kind: 'enemy', position: { ...victim.pos } })
    w.ai.despawn(victim.id) // AISystem 把淡出的尸体移出名单
    expect(w.dir.clearedCount).toBe(1)
    w.walk(FAR, 320)
    w.walk(YARD, 380)
    expect(w.ai.enemies.length).toBe(n0 - 1) // 少一只：那格已被清剿
    w.dispose()
  })

  it('破拍营地编队在营约解决后不再驻扎（condition 的取反项）', () => {
    const w = world(['flag.left_resthold'])
    const camp = regions.find((r) => r.id === 'rg_brokenbar_camp')!
    const g = camp.spawnGroups.find((x) => x.condition)
    expect(g, '数据里要有带 condition 的营地编队').toBeTruthy()
    const key = w.cellKey(g!.center)
    // 按 enemyId 收口：同一格现在还驻扎着别的新编种（Phase 4-C），闸门只对自己那支负责
    const live = (): number => w.dir.slotsInChunk(key).filter((s) => s.instanceId !== null && s.enemyId === g!.enemyId).length
    w.walk({ x: g!.center.x, y: 0, z: g!.center.z }, 60)
    expect(live()).toBe(g!.count)
    w.give('flag.brokenbar_resolved')
    w.walk(FAR, 120) // 先离场回收
    w.walk({ x: g!.center.x, y: 0, z: g!.center.z }, 180) // 再回来：这支编队不驻扎了
    expect(live()).toBe(0)
    w.dispose()
  })

  it('破拍营地按 §14.4/§14.6 编入远程与支援位：编队组成来自 regions.json', () => {
    const w = world(['flag.left_resthold'])
    const camp = regions.find((r) => r.id === 'rg_brokenbar_camp')!
    const ids = new Set<string>()
    camp.spawnGroups.forEach((g, i) => {
      w.walk({ x: g.center.x, y: 0, z: g.center.z }, 60 + i * 60)
      for (const s of w.dir.slotsInChunk(w.cellKey(g.center))) if (s.instanceId !== null) ids.add(s.enemyId)
    })
    expect(ids.has('en_skewer'), '针喉要在营').toBe(true)
    expect(ids.has('en_refrein'), '叠唱要在营').toBe(true)
    w.dispose()
  })

  it('同数据两次运行的点位与顺序完全一致（seededRng 可复现）', () => {
    const run = (): string[] => {
      const w = world(['flag.left_resthold'])
      w.walk(YARD, 60)
      const out = w.ai.enemies.map((e) => `${e.data.id}@${e.pos.x.toFixed(3)},${e.pos.z.toFixed(3)}`)
      w.dispose()
      return out
    }
    expect(run()).toEqual(run())
    expect(run().length).toBeGreaterThan(0)
  })
})
