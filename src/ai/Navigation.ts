/**
 * 敌人的绕路（KI-009 第二腿：导航网格烘焙 + 运行时加载，combat.md §595）。
 *
 * 两层走法并存：
 *   ① 烘焙网格（navmeshRef）：A* 在三角形网格上跑，邻接由共享边给出，代价 = 三角形中心欧氏距离。
 *      优点：离线化、无需每 tick 重建可见性图、适合大区域/复杂走廊。
 *   ② 运行时可见性图（回落）：当前的墙角展开 + A*，墙数 ≤12 时极快，与 ① 共用 `clear()` 判据。
 *      优点：零烘焙依赖、动态区域/测试环境直接可用、与箭/视线/挥砍共用同一把尺子。
 *
 * 选择策略：`syncAuthored` 时若区域有 `navmeshRef` 且烘焙文件存在 ⇒ 用 ①，否则回落 ②。
 * 两层的 **几何真源只有一份**：烘焙也读 `regions.json > walls`，`clear()` 依然走 `core/Occlusion.firstBlock(strict)`。
 * 这保证了"挡路"与"挡箭/挡眼/挡刀"永远是同一个答案。
 *
 * 为什么住在 `ai/`：读者只有一处（`Enemy.stepToward`），几何来自 `core/`，
 * 放在这里不新增依赖箭头（`ai → world` 尤其不新增）。
 */

import { firstBlock } from '@/core/Occlusion'
import type { BoxOccluder } from '@/core/Occlusion'
import type { Vec3, WallRef } from '@/data/schema'
import { registry } from '@/core/Registry'

/**
 * 烘焙导航网格的运行时形态（data/json/navmesh/*.navmesh.json 的结构）。
 */
export interface BakedNavmesh {
  regionId: string
  groundY: number
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  vertices: { x: number; y: number; z: number }[]
  triangles: number[][]
  edges: { v1: number; v2: number; tri1: number; tri2: number }[]
  centroids: { x: number; z: number }[]
  step: number
}

/**
 * 一层可走面：`groundY` 是**这一层的地板**（墙的 `pos.y` 与它被 validator 钉成同一个数）。
 * 导航只回答平面上的事——**查询点**全部落到这条线上（{@link Navigator.at}）。
 */
export interface NavRegion {
  groundY: number
  walls?: readonly WallRef[]
  navmeshRef?: string
  id?: string
}

/**
 * 注入给 `ai` 的绕路口（组合根持有名册，与 `SightGate` 同一套路）：
 * 「从 `from` 走到 `to`，这一步先朝哪儿迈」。
 * `null` = 场上没有可挡路的几何体（没有 authored 墙的野外、以及全部既有测试的口径）。
 */
export type NavGate = ((from: Vec3, to: Vec3, radius: number) => Vec3) | null

/**
 * 一次绕路最多认几面墙：超过这一数就不再建图、直接回落直线——**宁可走老路，不许掉帧**。
 */
const MAX_WALLS = 12

/**
 * 拐点的数值余量（**不是设计尺寸**）：拐点必须落在外扩盒之外这么远。
 */
const CORNER_MARGIN = 0.15

/** 拐点与查询点重合到这个距离以内就算「已经站在那儿了」：与 `stepToward` 的 0.05m 死区同一个数 */
const REACHED = 0.05

/** 点在三角形内（重心坐标法，仅 x/z 平面） */
function pointInTriangle(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
  const v0x = cx - ax, v0z = cz - az
  const v1x = bx - ax, v1z = bz - az
  const v2x = px - ax, v2z = pz - az
  const dot00 = v0x * v0x + v0z * v0z
  const dot01 = v0x * v1x + v0z * v1z
  const dot02 = v0x * v2x + v0z * v2z
  const dot11 = v1x * v1x + v1z * v1z
  const dot12 = v1x * v2x + v1z * v2z
  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01)
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom
  return u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6
}

export class Navigator {
  /** 与 `core/Occlusion` 同形：pos 是**底面中心**，halfX/halfZ 是半尺寸（数据里给的是全尺寸） */
  private occluders: BoxOccluder[] = []
  private groundY = 0

  /** 烘焙网格缓存：regionId → BakedNavmesh */
  private navmeshCache = new Map<string, BakedNavmesh>()

  /** 当前区域是否在用烘焙网格 */
  private usingBaked = false
  private currentNavmesh: BakedNavmesh | null = null

  /**
   * 换区域时调用一次（不在每 tick 的热路径上），与 `OcclusionField.syncAuthored` 同一处触发、
   * 同一份输入。传 `null` = 清空（"人不在任何区域里"时不许留着上一片天的墙）。
   */
  syncAuthored(region: NavRegion | null): void {
    const walls = region?.walls ?? []
    this.groundY = region?.groundY ?? 0
    this.occluders = walls.map((w) => ({
      id: `wall:${w.id}`, shape: 'box',
      pos: { x: w.pos.x, y: w.pos.y, z: w.pos.z },
      halfX: w.size.x / 2, halfZ: w.size.z / 2, heightM: w.heightM,
    }))

    // 尝试加载烘焙网格
    const ref = region?.navmeshRef
    if (ref) {
      const cached = this.navmeshCache.get(ref)
      if (cached) {
        this.currentNavmesh = cached
        this.usingBaked = true
        return
      }
      // 从 registry 读取（构建期已打包进 bundle，或运行时动态 import）
      const data = registry.maybeGet<BakedNavmesh>(ref)
      if (data) {
        this.navmeshCache.set(ref, data)
        this.currentNavmesh = data
        this.usingBaked = true
        return
      }
    }
    this.currentNavmesh = null
    this.usingBaked = false
  }

  /**
   * 这一步该朝哪儿迈：直线走得通 ⇒ 目标本身；有路可绕 ⇒ 第一个拐点；
   * 起点正压在某面墙的体格里（没有合法路线）⇒ **先迈出那面墙**（见 {@link escape}）；
   * 绕不过去 ⇒ 目标本身。
   */
  next(from: Vec3, to: Vec3, radius: number): Vec3 {
    const route = this.path(from, to, radius)
    if (route) return route[0]
    return this.escape(from, radius) ?? to
  }

  /**
   * 起点已经在某面墙的外扩盒里时的**脱困一步**：走向那面墙最近的那个外扩角。
   */
  private escape(from: Vec3, radius: number): Vec3 | null {
    let best: Vec3 | null = null
    let bestD = Infinity
    for (const o of this.occluders) {
      const hx = o.halfX + radius
      const hz = o.halfZ + radius
      if (Math.abs(from.x - o.pos.x) > hx || Math.abs(from.z - o.pos.z) > hz) continue
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const p = { x: o.pos.x + sx * (hx + CORNER_MARGIN), y: from.y, z: o.pos.z + sz * (hz + CORNER_MARGIN) }
          const d = Math.hypot(p.x - from.x, p.z - from.z)
          if (d < bestD) { bestD = d; best = p }
        }
      }
    }
    return best
  }

  /**
   * 拐点序列（不含 `from`，末项恒为 `to`）；直线可达 ⇒ `[to]`；无路可绕 ⇒ `null`。
   * 优先用烘焙网格；回落可见性图。
   */
  path(from: Vec3, to: Vec3, radius: number): Vec3[] | null {
    const a = this.at(from)
    const b = this.at(to)

    // 直线可达是最高优先级（最常见分支），两层共用同一个 clear()
    if (this.clear(a, b, radius)) return [to]

    // 优先尝试烘焙网格
    if (this.usingBaked && this.currentNavmesh) {
      const bakedRoute = this.pathBaked(a, b, to, radius, this.currentNavmesh)
      if (bakedRoute) return bakedRoute
      // 烘焙网格找不到路时，不回落可见性图（烘焙覆盖全区域，找不到 = 真绕不过去）
    }

    // 回落：运行时可见性图（墙数 ≤12 时极快）
    if (this.occluders.length === 0 || this.occluders.length > MAX_WALLS) return null
    return this.pathVisibility(a, b, to, radius)
  }

  /**
   * 烘焙网格上的 A*：节点 = 三角形，邻接 = 共享边，代价 = 中心欧氏距离。
   * 起点/终点所在三角形通过点在三角形内判定找到。
   * 返回的路径：末项是原始 `to` 对象（保持引用），所有拐点 y = `to.y`。
   */
  private pathBaked(a: Vec3, b: Vec3, to: Vec3, radius: number, navmesh: BakedNavmesh): Vec3[] | null {
    const { triangles, edges, centroids, vertices } = navmesh

    // 找起点三角形
    let startTri = -1
    for (let i = 0; i < triangles.length; i++) {
      const [v1, v2, v3] = triangles[i]
      const p1 = vertices[v1], p2 = vertices[v2], p3 = vertices[v3]
      if (pointInTriangle(a.x, a.z, p1.x, p1.z, p2.x, p2.z, p3.x, p3.z)) {
        startTri = i
        break
      }
    }
    // 找终点三角形
    let goalTri = -1
    for (let i = 0; i < triangles.length; i++) {
      const [v1, v2, v3] = triangles[i]
      const p1 = vertices[v1], p2 = vertices[v2], p3 = vertices[v3]
      if (pointInTriangle(b.x, b.z, p1.x, p1.z, p2.x, p2.z, p3.x, p3.z)) {
        goalTri = i
        break
      }
    }
    if (startTri < 0 || goalTri < 0) return null
    if (startTri === goalTri) return [to]

    // A* 在三角形图上
    const n = triangles.length
    const g = new Array<number>(n).fill(Infinity)
    const f = new Array<number>(n).fill(Infinity)
    const prev = new Array<number>(n).fill(-1)
    const closed = new Array<boolean>(n).fill(false)
    const h = (i: number): number => Math.hypot(centroids[i].x - b.x, centroids[i].z - b.z)
    g[startTri] = 0
    f[startTri] = h(startTri)

    for (let popped = 0; popped < n; popped++) {
      let cur = -1
      let best = Infinity
      for (let i = 0; i < n; i++) if (!closed[i] && f[i] < best) { best = f[i]; cur = i }
      if (cur < 0 || cur === goalTri) break
      closed[cur] = true

      // 遍历邻接三角形（通过共享边）
      for (const e of edges) {
        let nei = -1
        if (e.tri1 === cur) nei = e.tri2
        else if (e.tri2 === cur) nei = e.tri1
        if (nei < 0) continue

        const step = Math.hypot(centroids[nei].x - centroids[cur].x, centroids[nei].z - centroids[cur].z)
        const tentative = g[cur] + step
        if (tentative >= g[nei]) continue
        g[nei] = tentative
        prev[nei] = cur
        f[nei] = tentative + h(nei)
      }
    }

    if (!Number.isFinite(g[goalTri])) return null

    // 回溯三角形序列
    const triPath: number[] = []
    let i = goalTri
    for (let guard = 0; i > -1 && guard <= n; guard++) {
      triPath.unshift(i)
      i = prev[i]
    }
    if (triPath[0] !== startTri) return null

    // 三角形序列 → 拐点序列（取共享边中点作为拐点，末项接原始 to，y = to.y）
    const route: Vec3[] = []
    for (let k = 0; k < triPath.length - 1; k++) {
      const t1 = triPath[k], t2 = triPath[k + 1]
      // 找共享边
      for (const e of edges) {
        if ((e.tri1 === t1 && e.tri2 === t2) || (e.tri1 === t2 && e.tri2 === t1)) {
          const v1 = vertices[e.v1], v2 = vertices[e.v2]
          route.push({ x: (v1.x + v2.x) / 2, y: to.y, z: (v1.z + v2.z) / 2 })
          break
        }
      }
    }
    route.push(to)

    // 已经站在头一个拐点上时摘掉（同 visibility 逻辑）
    while (route.length > 1 && Math.hypot(route[0].x - a.x, route[0].z - a.z) <= REACHED) route.shift()
    return route
  }

  /**
   * 运行时可见性图 A*：节点 = 墙的外扩角 + 终点。
   * `to` 是原始目标（保持引用、保留 y），`from`/`b` 是投影到地板的点（仅用于几何计算）。
   * 与原实现完全一致，保留作为回落与测试基线。
   */
  private pathVisibility(from: Vec3, b: Vec3, to: Vec3, radius: number): Vec3[] | null {
    if (this.occluders.length === 0 || this.occluders.length > MAX_WALLS) return null

    const nodes: Vec3[] = [from]
    for (const o of this.occluders) {
      const hx = o.halfX + radius + CORNER_MARGIN
      const hz = o.halfZ + radius + CORNER_MARGIN
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          nodes.push({ x: o.pos.x + sx * hx, y: this.groundY, z: o.pos.z + sz * hz })
        }
      }
    }
    nodes.push(b)
    const goal = nodes.length - 1

    const g = new Array<number>(nodes.length).fill(Infinity)
    const f = new Array<number>(nodes.length).fill(Infinity)
    const prev = new Array<number>(nodes.length).fill(-1)
    const closed = new Array<boolean>(nodes.length).fill(false)
    const h = (i: number): number => Math.hypot(nodes[i].x - b.x, nodes[i].z - b.z)
    g[0] = 0; f[0] = h(0)

    for (let popped = 0; popped < nodes.length; popped++) {
      let cur = -1
      let best = Infinity
      for (let i = 0; i < nodes.length; i++) if (!closed[i] && f[i] < best) { best = f[i]; cur = i }
      if (cur < 0 || cur === goal) break
      closed[cur] = true
      for (let i = 0; i < nodes.length; i++) {
        if (closed[i] || i === cur) continue
        const step = Math.hypot(nodes[i].x - nodes[cur].x, nodes[i].z - nodes[cur].z)
        const tentative = g[cur] + step
        if (tentative >= g[i]) continue
        if (!this.clear(nodes[cur], nodes[i], radius)) continue
        g[i] = tentative; prev[i] = cur; f[i] = tentative + h(i)
      }
    }
    if (!Number.isFinite(g[goal])) return null

    const route: Vec3[] = []
    let i = goal
    for (let guard = 0; i > 0 && guard <= nodes.length; guard++) {
      route.unshift(i === goal ? to : { x: nodes[i].x, y: to.y, z: nodes[i].z })
      i = prev[i]
    }
    if (i !== 0) return null
    while (route.length > 1 && Math.hypot(route[0].x - from.x, route[0].z - from.z) <= REACHED) route.shift()
    return route
  }

  /**
   * 线段走得过去吗（`radius` 是这一只的体格，并进遮挡体里算；`strict` 见 `core/Occlusion`）：
   * 「挡箭」与「挡路」是同一把尺子的两种口径，不是两把尺子。
   */
  private clear(a: Vec3, b: Vec3, radius: number): boolean {
    return firstBlock(this.occluders, a, b, radius, true) === null
  }

  /** 查询点落到这一层的地板上：导航是平面问题，y 由区域给（见 {@link NavRegion}） */
  private at(p: Vec3): Vec3 {
    return { x: p.x, y: this.groundY, z: p.z }
  }
}