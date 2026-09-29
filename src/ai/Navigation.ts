/**
 * 敌人的绕路（KI-009 的第一腿，combat.md §595）：Chase 那一格写的是
 * 「路径=简单导航网格（手工 Nav 点或 A* 网格，禁动态避障物理）」——这句话此前一个承载体都没有，
 * 于是追击是「朝目标走直线」：一堵 authored 的塌墙就能把它变成一幅壁画（它贴着墙蹭、在墙角抖，
 * 而玩家的箭与视线早就被**同一堵墙**挡住了）。
 *
 * **几何的真源只有一份**：路线走不走得通，问的是 `core/Occlusion.firstBlock`（`strict` 那一档）
 * ——和箭、视线、挥砍用的是同一个函数、同一份 `regions.json > walls`。KI-014②b 把「挡箭」与
 * 「挡眼」并到了一条线段上，这一腿把「挡路」也并进去：三件事不可能各有一套答案，也不会各差一格。
 *
 * **为什么住在 `ai/`**：读者只有一处（`Enemy.stepToward`），几何来自 `core/`，于是放在这里
 * 就不新增任何依赖箭头（`ai → world` 这一条尤其不新增——与 `SightGate` 让 `ai` 只拿一个函数
 * 是同一个理由）。技术架构的文件表里这一格本来写的就是 `ai/Navigation.ts`。
 *
 * **走法**：可见性图 + A*。节点＝每面墙**按这一只的半径外扩后的四个角**＋终点；一条边成立
 * ⇔ 那一段线段不被任何墙截断。贴着外扩角走就是这一版给出的全部「贴边」行为——不要求碰撞回弹，
 * 也不做动态避障（§595 明令禁）。
 *
 * **没有格子、没有路点表、没有代价权重**：这一版一个设计数字都不新增（要新增的数得连消费方
 * 一起写进表，§55）。唯二的数字是数值余量 `CORNER_MARGIN` 与保险丝 `MAX_WALLS`，两者都不是设计尺寸。
 *
 * **回落是逐字节的**：绕不过去、墙太多、或没有注入导航器 ⇒ 返回目标本身，`stepToward` 的行为
 * 与这一腿之前完全相同。「没有 authored 墙的野外」与全部既有测试里，脚步一格都没变。
 * 唯一的例外是"起点正压在墙的体格里"——那一格先迈出去（{@link Navigator.escape}），因为直线
 * 回落在那里等于穿墙。
 */
import { firstBlock } from '@/core/Occlusion'
import type { BoxOccluder } from '@/core/Occlusion'
import type { Vec3, WallRef } from '@/data/schema'

/**
 * 一层可走面：`groundY` 是**这一层的地板**（墙的 `pos.y` 与它被 validator 钉成同一个数）。
 * 导航只回答平面上的事——**查询点**全部落到这条线上（{@link Navigator.at}），于是「站在 y=0 的
 * 搜索圈心」这种只在 x/z 上有意义的点（`Enemy` 的 search/investigate 就是这么算的）不会把线段
 * 算到墙顶上方去。返回的拐点只在 x/z 上有意义：它们的 y 沿用调用方给的目标高度（末项更是原对象），
 * 好让"路线是朝着那个目标画的一条计划"这句话在读数里也成立。
 */
export interface NavRegion {
  groundY: number
  walls?: readonly WallRef[]
}

/**
 * 注入给 `ai` 的绕路口（组合根持有名册，与 `SightGate` 同一套路）：
 * 「从 `from` 走到 `to`，这一步先朝哪儿迈」。
 * `null` = 场上没有可挡路的几何体（没有 authored 墙的野外、以及全部既有测试的口径）。
 */
export type NavGate = ((from: Vec3, to: Vec3, radius: number) => Vec3) | null

/**
 * 一次绕路最多认几面墙：超过这一数就不再建图、直接回落直线——**宁可走老路，不许掉帧**。
 * 现状（7 区共 12 面墙、单区最多 4 面）离上限很远，它是给意外数据的保险丝而不是预算。
 * 真到那一天，该做的是「只认走廊附近几面墙」的裁剪（那要新增数），不是把上限往上抬。
 */
const MAX_WALLS = 12

/**
 * 拐点的数值余量（**不是设计尺寸**）：拐点必须落在外扩盒之外这么远。
 *
 * 为什么是 0.15 而不是 `core/Occlusion` 的 `EPS` 那一档：`strict` 把"起点在体内／贴面不算挡"
 * 这两条赦免关掉了，于是只要有一只敌人把**身体**探进外扩盒（它自己那一圈体格半径），从它出发的
 * **每一条边**都不成立 ⇒ A\* 一个解都没有 ⇒ 回落成"直线冲目标"，而本引擎没有位移碰撞，
 * 那一步就直接穿墙而过。
 *
 * 实测把它探进去的不是几何误差，是**死区**：`stepToward`（与这里的 {@link REACHED}）对 0.05m
 * 以内的目标原地不动，所以"走到拐点上"实际是"停在拐点前 0.05m"；拐点若正好压在外扩边界上，
 * 那一点提前量就已经把身体放进盒里了。第一版用 `1e-6`，实机读数：绕到墙角那一刻 `path` 返回 null、
 * 之后 73 tick 它一路从墙里穿过去。余量因此必须大于"死区 + 一 tick 的步长"：最快的敌人
 * （幽灵八 4.2 × 1.1 倍速 ÷ 60）一 tick 走 **0.077m**，加 0.05 死区 = 0.127 ⇒ 取 0.15。
 */
const CORNER_MARGIN = 0.15

/** 拐点与查询点重合到这个距离以内就算「已经站在那儿了」：与 `stepToward` 的 0.05m 死区同一个数 */
const REACHED = 0.05

export class Navigator {
  /** 与 `core/Occlusion` 同形：pos 是**底面中心**，halfX/halfZ 是半尺寸（数据里给的是全尺寸） */
  private occluders: BoxOccluder[] = []
  private groundY = 0

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
   *
   * 为什么不能回落"直线冲目标"：`strict` 那一档把"体内 = 走不过去"当判据，从体内出发的每一条边
   * 都不成立 ⇒ `path` 必然是 null，而 `next` 的常规回落是直奔目标——在起点压着墙时那正是最坏的
   * 答案（没有位移碰撞 ⇒ 它穿过去）。改成先出一面墙：那一点在盒外，迈出去之后下一 tick
   * 就回到正常的绕路流程。
   *
   * 它今天只在"作者把人摆进墙的体格里"这类输入上可达（{@link CORNER_MARGIN} 已经把正常走位
   * 那条路堵死了），所以它是保险而不是主路——`tests/unit/navigation.test.ts` 有一条用例专门喂它。
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
   * 与 {@link next} 分成两个口：引擎每 tick 只要「往哪迈」，而测试与调试要量的是「绕成什么样」。
   */
  path(from: Vec3, to: Vec3, radius: number): Vec3[] | null {
    const a = this.at(from)
    const b = this.at(to)
    if (this.clear(a, b, radius)) return [to] // 最常见的分支：一眼看穿，一次线段测试就返回
    if (this.occluders.length === 0 || this.occluders.length > MAX_WALLS) return null

    const nodes: Vec3[] = [a]
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
        // 先算账再看几何：这条边不可能更短时连线段都不用测。**顺序是承重的**——绕路这一支
        // 每 tick 都要跑一遍，把 `clear()` 放在前面等于给每只交战的敌人平白加上 N² 次 slab 裁剪。
        if (tentative >= g[i]) continue
        if (!this.clear(nodes[cur], nodes[i], radius)) continue
        g[i] = tentative; prev[i] = cur; f[i] = tentative + h(i)
      }
    }
    if (!Number.isFinite(g[goal])) return null

    const route: Vec3[] = []
    let i = goal
    for (let guard = 0; i > 0 && guard <= nodes.length; guard++) {
      // 末项回原始对象：`to` 的 y 是调用方给的（可能不是这一层的地板），别在这里改掉它
      route.unshift(i === goal ? to : { x: nodes[i].x, y: to.y, z: nodes[i].z })
      i = prev[i]
    }
    if (i !== 0) return null // 回溯没回到起点 ⇒ 图上有洞，宁可回落直线（老行为，不抛错）
    // 已经站在头一个拐点上时把它摘掉：`stepToward` 对"一步都不到 0.05m"的目标是**原地不动**，
    // 留着它就会让走到角上的敌人抱着自己的角卡住（这不是理论风险：路线的第一个拐点正是它刚踩到的那个角）。
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
