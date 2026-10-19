import { describe, expect, it, beforeAll } from 'vitest'
import { Navigator, type BakedNavmesh } from '@/ai/Navigation'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import type { RegionData, Vec3 } from '@/data/schema'

/**
 * **烘焙网格上的 A\***（KI-149 补测第二段：合成网格）。
 *
 * **为什么要合成**：真网格（七区那 7 张）是分区烘焙的大三角形，A\* 的邻接回溯分支
 * （走邻居、回溯三角形序列、取共享边中点当拐点）在真数据上很少被走到——那一段没被覆盖，
 * 就等于"它能不能绕路"没人验过。**合成网格把形状做成已知的**：一条走廊，中间一格是死的
 * （没有连边），A\* 必须绕过去。
 *
 * **合成形状**（三行两列的三角带）：
 * ```
 *   v0 —— v1 —— v2        上排
 *    |  \  |  \  |
 *   v3 —— v4 —— v5        下排
 * ```
 * 三角形：t0=(v0,v1,v3) t1=(v1,v4,v3) t2=(v1,v2,v4) t3=(v2,v5,v4)
 * 邻接：t0–t1、t1–t2、t2–t3（一条链）
 * **掐断 t1–t2** ⇒ 从左到右只能…没有别的路 ⇒ 走不通；**不掐** ⇒ 走三个三角形。
 */
beforeAll(() => { registerGameData() })

const buildMesh = (broken: boolean): BakedNavmesh => {
  const vertices = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
  ]
  const triangles = [
    [0, 1, 3],
    [1, 4, 3],
    [1, 2, 4],
    [2, 5, 4],
  ]
  const centroid = (t: number[]): { x: number; z: number } => {
    const a = vertices[t[0]], b = vertices[t[1]], c = vertices[t[2]]
    return { x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3 }
  }
  const centroids = triangles.map(centroid)
  const edge = (v1: number, v2: number, tri1: number, tri2: number) => ({ v1, v2, tri1, tri2 })
  const edges = [edge(1, 3, 0, 1), edge(1, 4, 1, 2), edge(2, 4, 2, 3)]
  if (broken) edges.splice(1, 1) // 掐断 t1–t2 ⇒ 左右两半不通
  return {
    regionId: 'rg_synthetic',
    groundY: 0,
    bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 1 },
    vertices,
    triangles,
    edges,
    centroids,
    step: 1,
  }
}

const regionWith = (ref: string, walls: unknown[] = []): RegionData =>
  ({
    id: 'rg_synthetic',
    groundY: 0,
    walls,
    navmeshRef: ref,
    interactables: [],
    landmarks: [],
    spawnGroups: [],
    secrets: [],
    storyHooks: [],
    palette: { base: '#000', accent: '#000', glow: '#000' },
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
    grid: { bpm: 84, beatsPerBar: 4 },
    chunkSize: 48,
    weatherPresets: [],
    music: { explore: '', battle: '', ambience: '' },
  }) as unknown as RegionData

describe('烘焙网格上的 A*（KI-149 · 合成网格）', () => {
  it('连通时 A* 走三个三角形并给出拐点（末项是目标）', () => {
    const ref = 'navmesh/synthetic_ok'
    registry.register(ref, buildMesh(false))
    const nav = new Navigator()
    nav.syncAuthored(regionWith(ref))
    expect((nav as unknown as { usingBaked: boolean }).usingBaked, '走网格').toBe(true)

    const from = { x: 0.2, y: 0, z: 0.2 } as Vec3 // t0 内
    const to = { x: 1.8, y: 0, z: 0.2 } as Vec3 // t3 内
    const route = nav.path(from, to, 0.05)
    // 直线没被墙挡（合成区域没有墙）⇒ 走直线那条优先分支，网格不被调用
    expect(route, '没有墙 ⇒ 直线可达').not.toBeNull()
    expect(route!.length, '直线可达时只有目标本身').toBe(1)
  })

  it('有墙挡着直线时，A* 在网格上绕出拐点', () => {
    const ref = 'navmesh/synthetic_wall'
    registry.register(ref, buildMesh(false))
    // 一面**正好挡在起终点之间**的墙（x=1 那一列）
    const wall = {
      id: 'w_mid',
      pos: { x: 1, y: 0, z: 0.5 },
      size: { x: 0.2, y: 2, z: 2 },
      heightM: 2,
    }
    const nav = new Navigator()
    nav.syncAuthored(regionWith(ref, [wall]))
    expect((nav as unknown as { usingBaked: boolean }).usingBaked, '走网格').toBe(true)

    const from = { x: 0.2, y: 0, z: 0.2 } as Vec3
    const to = { x: 1.8, y: 0, z: 0.2 } as Vec3
    const route = nav.path(from, to, 0.05)
    expect(route, '墙挡着 ⇒ 网格要给出绕路').not.toBeNull()
    expect(route!.length, '绕路 ⇒ 拐点不止一个').toBeGreaterThan(1)
    const last = route![route!.length - 1]
    expect(last.x, '末项是目标本身').toBeCloseTo(1.8, 6)
    expect(last.z).toBeCloseTo(0.2, 6)
    for (const p of route!) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.z), '拐点必须是有限数').toBe(true)
    }
  })

  it('网格断开时走不通（null）——A* 找不到路时不假装能走', () => {
    const ref = 'navmesh/synthetic_broken'
    registry.register(ref, buildMesh(true))
    const wall = {
      id: 'w_mid',
      pos: { x: 1, y: 0, z: 0.5 },
      size: { x: 0.2, y: 2, z: 2 },
      heightM: 2,
    }
    const nav = new Navigator()
    nav.syncAuthored(regionWith(ref, [wall]))
    const from = { x: 0.2, y: 0, z: 0.2 } as Vec3
    const to = { x: 1.8, y: 0, z: 0.2 } as Vec3
    expect(nav.path(from, to, 0.05), '网格断了 ⇒ 走不通').toBeNull()
  })

  it('起点在网格外 ⇒ 走不通（找不到起点三角形）', () => {
    const ref = 'navmesh/synthetic_out'
    registry.register(ref, buildMesh(false))
    const nav = new Navigator()
    nav.syncAuthored(regionWith(ref))
    const outside = { x: 500, y: 0, z: 500 } as Vec3
    const inside = { x: 0.2, y: 0, z: 0.2 } as Vec3
    // 直线可达优先 ⇒ 这一步仍走得通；**网格那条**才因起点在网格外而放弃。
    // 这里钉的是"网格分支自己会给 null"：把墙放在中间挡着直线，逼它走网格。
    const wall = { id: 'w_mid', pos: { x: 0.2, y: 0, z: 0.1 }, size: { x: 4, y: 2, z: 0.2 }, heightM: 2 }
    const nav2 = new Navigator()
    nav2.syncAuthored(regionWith(ref, [wall]))
    expect(nav2.path(outside, inside, 0.05), '起点在网格外 ⇒ 网格给不出路').toBeNull()
  })
})
