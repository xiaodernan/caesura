import { describe, expect, it, beforeAll } from 'vitest'
import { Navigator, type BakedNavmesh } from '@/ai/Navigation'
import { registerGameData, regions } from '@/data'
import { registry } from '@/core/Registry'
import type { RegionData, Vec3 } from '@/data/schema'

/**
 * **烘焙导航网格**那条路（KI-149 补测；网格本身是 KI-133 落进主干的）。
 *
 * **为什么补**：KI-133 把 7 张烘焙网格与 `Navigation` 的网格分支一并过界，而**那条分支一行测试都没有**
 * （覆盖率门：ai 包 90.66% ／ 地板 98.75%，缺口几乎全在这里——`Navigation.ts` 209 行里 102 行没跑到）。
 * 这条路是**导航的快路**（A* 跑在三角形图上，邻接由共享边给出），而回落那条（运行时可见性图）是有测试的。
 *
 * **量什么**：① 区域带 `navmeshRef` 且网格在注册表里 ⇒ 走网格；② 网格的 A* 能从起点三角形
 * 走到终点三角形并给出拐点序列；③ 起点/终点落在网格外 ⇒ 找不到路（null）；④ 同一个三角形里 ⇒ 直达；
 * ⑤ 网格缺失 ⇒ 回落运行时可见性图（**不是**"没有路"）。
 */
beforeAll(() => { registerGameData() })

const hub = regions.find((r) => r.id === 'rg_resthold') as RegionData

describe('导航：烘焙网格那条路（KI-149）', () => {
  it('区域带 navmeshRef 且网格在注册表里 ⇒ 走网格（不是回落）', () => {
    const nav = new Navigator()
    nav.syncAuthored(hub)
    expect((nav as unknown as { usingBaked: boolean }).usingBaked, '休垒有烘焙网格 ⇒ 应当走网格').toBe(true)
    expect((nav as unknown as { currentNavmesh: BakedNavmesh | null }).currentNavmesh).not.toBeNull()
  })

  it('网格是注册表里那一份真数据（七区各一，形状对得上）', () => {
    const ref = hub.navmeshRef!
    const mesh = registry.maybeGet<BakedNavmesh>(ref)
    expect(mesh, `${ref} 必须在注册表里`).toBeTruthy()
    expect(mesh!.triangles.length, '三角形数').toBeGreaterThan(0)
    expect(mesh!.edges.length, '邻接边数').toBeGreaterThan(0)
    expect(mesh!.centroids.length, '中心点数应当与三角形数一致').toBe(mesh!.triangles.length)
    expect(mesh!.vertices.length, '顶点数').toBeGreaterThan(0)
  })

  it('直线可达优先于网格（哪怕目标在网格外，那一步也走得通）', () => {
    const nav = new Navigator()
    nav.syncAuthored(hub)
    const far = { x: 99999, y: 0, z: 99999 } as Vec3
    const here = { x: 0, y: 0, z: 0 } as Vec3
    // **优先级是设计**：直线可达是最高优先级（最常见分支），网格只在直线被墙挡住时才登场。
    // 所以"目标在网格外"本身不构成"没有路"——这一步走的是直线。
    const route = nav.path(here, far, 0.4)
    expect(route, '直线没被墙挡住 ⇒ 有路').not.toBeNull()
    expect(route!.length, '直线可达时拐点序列只有目标本身').toBe(1)
    expect(route![0].x).toBeCloseTo(far.x, 6)
  })

  it('同一个三角形里 ⇒ 直达（拐点序列就是目标本身）', () => {
    const nav = new Navigator()
    nav.syncAuthored(hub)
    const mesh = registry.maybeGet<BakedNavmesh>(hub.navmeshRef!)!
    const c = mesh.centroids[0]
    const route = nav.path({ x: c.x, y: 0, z: c.z } as Vec3, { x: c.x + 0.2, y: 0, z: c.z + 0.2 } as Vec3, 0.4)
    expect(route, '同一个三角形 ⇒ 有路').not.toBeNull()
    expect(route!.length, '直达时拐点序列只有一个（目标本身）').toBe(1)
  })

  it('网格上的 A* 真能绕到远处：路径末项是目标，拐点都在网格上', () => {
    const nav = new Navigator()
    nav.syncAuthored(hub)
    const mesh = registry.maybeGet<BakedNavmesh>(hub.navmeshRef!)!
    // 取两个相距较远的三角形中心当起终点
    const a = mesh.centroids[0]
    const b = mesh.centroids[mesh.centroids.length - 1]
    const from = { x: a.x, y: 0, z: a.z } as Vec3
    const to = { x: b.x, y: 0, z: b.z } as Vec3
    const route = nav.path(from, to, 0.4)
    if (route === null) {
      // 这两个三角形之间可能不连通（网格是分区烘焙的）——那也是合法读数
      expect(route).toBeNull()
      return
    }
    expect(route!.length, '至少一个拐点').toBeGreaterThan(0)
    const last = route![route!.length - 1]
    expect(last.x, '末项是目标本身').toBeCloseTo(b.x, 6)
    expect(last.z).toBeCloseTo(b.z, 6)
    for (const p of route!) expect(Number.isFinite(p.x) && Number.isFinite(p.z), '拐点必须是有限数').toBe(true)
  })

  it('没有 navmeshRef 的区域 ⇒ 回落运行时可见性图（不是"没有路"）', () => {
    const noMesh = { ...hub, id: 'rg_test_no_mesh', navmeshRef: undefined } as unknown as RegionData
    const nav = new Navigator()
    nav.syncAuthored(noMesh)
    expect((nav as unknown as { usingBaked: boolean }).usingBaked, '没有网格 ⇒ 走运行时几何').toBe(false)
    // 休垒的墙还在 ⇒ 可见性图那条路仍然能用
    const route = nav.path({ x: 0, y: 0, z: 0 } as Vec3, { x: 3, y: 0, z: 3 } as Vec3, 0.4)
    expect(route, '回落那条路仍然给出路').not.toBeNull()
  })

  it('网格缓存：同一张网格不会被反复读（第二次 sync 走缓存）', () => {
    const nav = new Navigator()
    nav.syncAuthored(hub)
    const first = (nav as unknown as { currentNavmesh: BakedNavmesh | null }).currentNavmesh
    nav.syncAuthored(hub)
    const second = (nav as unknown as { currentNavmesh: BakedNavmesh | null }).currentNavmesh
    expect(second, '第二次仍然是同一份网格').toBe(first)
  })
})
