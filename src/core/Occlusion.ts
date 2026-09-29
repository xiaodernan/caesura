/**
 * 世界遮挡（KI-014①②）：`a → b` 这条线段被哪块几何**先**截断、截在哪一点。
 * 住在 `core/` 而不是 `world/`，因为它是一条纯几何查询（和 `core/Math` 同层），
 * 而它的读者分属两层——`combat`（弹体、打在玩家身上的那一线）与 `world` 表现层
 * （红线剪断、把遮挡体画成同尺寸的那一块）。遮挡体**名册**也在这里：`combat` 不许反向 import
 * `world`（tech-arch §3 的依赖箭头），而名册的两条输入都只是 `data/schema` 里已经存在的格
 * （实体的 `boss.covers`、区域的 `walls`），不需要认识任何实体类或区域类。
 *
 * **一条线段，一个主人。** 五处读取它，而且只有这五处：
 * - 弹体逐 tick 的**扫掠段**（`Projectile.prev → pos`）：弹体自己有半径，所以撞上的判据
 *   要把这一点并进遮挡体里算（`expand`），否则半根柱子可以让一枚"球心"贴过去。
 * - 打在玩家身上的那一记近战/锁定式 AoE：它的伤害本来就落在"攻击者→玩家"这条线上
 *   （§15.2 断音柱的原文判据），所以它是线段而不是扇形。
 * - §14.4 的 telegraph 红线：线是"它会打哪"的诚实承诺，被挡住的承诺不能画到墙后面。
 * - **敌人的视线**（KI-014②b，§13.0「视锥 + 遮挡检查」）：`ai` 不自己算几何，而是被组合根
 *   喂一个 {@link SightGate}。少了这一路就会出现"箭被墙挡住、敌人却仍然看得见你"——
 *   那比没有遮挡更糟，因为玩家已经有了"这堵墙是掩体"的可见证据。
 * - **玩家自己挥出去的那一刀**（KI-070，补齐 §15.2「长枪不再穿过掩体」的那半边）：这一处的判据是
 *   **两把尺子各量一件事**——扇形（`HitShapes.shapeHits`）管"谁在这一记里"，这条线段管"刃到得了吗"，
 *   线段只是否决权。拿它替掉扇形也会让上面几条腿全绿（背后的人却被结到），所以那条反向用例
 *   是这一格的承重墙。场地件（`world/Props`）吃同一条否决：不许"打不到墙后的人、却打得碎墙后的刺"。
 *
 * **为什么遮挡体是"竖直柱 + 轴对齐盒"这两种**：灰盒期真正有尺寸的实体只有这两类——
 * 断音柱/钟/地标棱柱是柱（`boss.covers`），塌墙/岩脊/回廊墩是盒（`regions.json > walls`，KI-014②）。
 * §55 不许我凭空发明一套自由形式墙体几何来"看起来像"有遮挡，所以输入全是**数据点名的**凸体，
 * 而不是从关卡网格推出来的。斜墙（带 yaw）留给有真几何的那一天，登记在 KI-014 行。
 *
 * **两条刻意的口径**（都不是遗漏）：
 * - 起点在遮挡体内 ⇒ **不算被挡**。这就是原来那句"攻击者也贴着柱子 ⇒ 不挡，否则柱子变无敌房"
 *   的几何版本：线段从内部出发时它没有"穿过柱面/墙面"，挡不住任何东西。
 *   近似实现里那条要手写，射线实现里它自己成立。
 * - 那条口径在**玩家这一侧同样成立**，而且它是**有方向的**：线段从出手者那一端量起，所以贴进墙里的人
 *   不会被自己贴着的那堵墙挡住攻击（KI-070 的探针 P5 把两端对调，量的就是这个方向）。
 *   曾经登记的"玩家的挥砍不接这条通道"那一格已在 KI-070 闭合——它的理由（扇形不是线段）今天仍然成立，
 *   解法因此不是"拿线段去替扇形"，而是在扇形点头之后再加一条线段否决。
 */
import type { Vec3, WallRef } from '@/data/schema'

/** 遮挡体的公共部分：`pos` 是**底面中心**（不是重心），`heightM` 是它的高度 */
export interface OccluderBase {
  id: string
  pos: Vec3
  heightM: number
}
/** 竖直圆柱截面（断音柱、钟、地标棱柱） */
export interface CylinderOccluder extends OccluderBase {
  shape: 'cylinder'
  radius: number
}
/** 轴对齐盒截面（authored 塌墙/岩脊/回廊墩，KI-014②）：`halfX`/`halfZ` 是**半尺寸** */
export interface BoxOccluder extends OccluderBase {
  shape: 'box'
  halfX: number
  halfZ: number
}
export type Occluder = CylinderOccluder | BoxOccluder

/** 线段被截断在哪：`at` 是线段**第一次**碰到遮挡体表面的那个点（灰尘要甩在那里） */
export interface BlockHit {
  /** 哪一块挡的：调试器与测试要靠它回答"救了我的是哪根柱子/哪堵墙" */
  occluderId: string
  at: Vec3
}

const EPS = 1e-7

/**
 * 线段 `a → b` 与遮挡体集合的第一个交点；没有交点返回 null。
 * `expand` 是把"运动的物体自己有半径"并进遮挡体里（截面与高度各加这么多），
 * 近战那条线的端点已经是身体中心/命中点，所以它传 0。
 *
 * `strict` 是**同一把尺子的第二种口径**（KI-092）：默认那两条"让着走"的规则——起点在体内
 * 不算挡、贴面与相切不算挡——是给**打出去的线**写的（站在柱子旁也该能开枪，擦着柱面过去
 * 的一寸不该算掩体）。而"这一条线**走不走得过去**"问的是另一件事：身体进不去墙，体内、
 * 贴面、相切都算挡。两种口径共用同一份 slab 与二次方程（`strict` 只关掉那两条赦免），
 * 于是"挡箭的几何"与"挡路的几何"不可能各写一份、各差一格——那正是 KI-092 要避免的东西。
 *
 * `strict` 下 t 允许 ≤ 0（起点已经在体内），布尔用户（导航）只问"是不是 null"；
 * **那种输入上 `at` 落在起点之后，不是可用的撞击点**，所以除导航外不要传 true。
 */
export function firstBlock(
  occluders: Iterable<Occluder>, a: Vec3, b: Vec3, expand = 0, strict = false,
): BlockHit | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  // 水平方向没有位移的线段（垂直落体）不可能"从侧面穿过"一块竖直遮挡体：它要么在体内要么在体外，
  // 而"整段都在体内"按上面那条口径是不挡（起点在体内）。至于"从墙顶垂直落进盒子里"——一条只有 y
  // 在动的线没有掩体可言，那一格归位移碰撞（KI-009），不在这里充数。所以直接判无遮挡，不进除零。
  if (Math.hypot(dx, dz) < EPS) return null
  let best: { t: number; at: Vec3; occluderId: string } | null = null
  for (const o of occluders) {
    const t = o.shape === 'box' ? boxEnter(o, a, dx, dy, dz, expand, strict) : cylEnter(o, a, dx, dy, dz, expand, strict)
    if (t === null) continue
    if (best && best.t <= t) continue
    best = { t, occluderId: o.id, at: { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t } }
  }
  return best ? { occluderId: best.occluderId, at: best.at } : null
}

/** 圆柱截面：xz 上解二次方程拿到进出参数，再看那一段有没有穿过 `[base,top]` 这一竖带 */
function cylEnter(o: CylinderOccluder, a: Vec3, dx: number, dy: number, dz: number, expand: number, strict: boolean): number | null {
  const r = o.radius + expand
  if (r <= 0) return null
  const base = o.pos.y - expand
  const top = o.pos.y + o.heightM + expand
  // |A + t·D − C|² = r² 在 xz 平面上的二次方程
  const fx = a.x - o.pos.x
  const fz = a.z - o.pos.z
  const q = dx * dx + dz * dz
  const lin = 2 * (fx * dx + fz * dz)
  const cst = fx * fx + fz * fz - r * r
  const disc = lin * lin - 4 * q * cst
  if (disc <= 0) return null // 不相交（含相切：擦过柱面的一寸都不算挡住）
  const sq = Math.sqrt(disc)
  const lo = (-lin - sq) / (2 * q)
  const hi = Math.min((-lin + sq) / (2 * q), 1)
  if (!strict && lo <= EPS) return null // 起点已经在柱内 ⇒ 柱面在身后，挡不住这一线（strict 下「体内」= 走不过去）
  if (hi <= lo) return null // 交点整段在 b 之后 ⇒ 柱子在目标后面，不是掩体
  return enterBand(a.y, a.y + dy, lo, hi, base, top)
}

/**
 * 轴对齐盒截面（authored 墙）：三条轴各夹一块板（slab），交集非空就是被挡住，返回进入参数。
 * 与圆柱共用同两条口径：起点在体内不挡、贴脸（`lo <= EPS`）不挡。
 */
function boxEnter(o: BoxOccluder, a: Vec3, dx: number, dy: number, dz: number, expand: number, strict: boolean): number | null {
  const hx = o.halfX + expand
  const hz = o.halfZ + expand
  const yLo = o.pos.y - expand
  const yHi = o.pos.y + o.heightM + expand
  if (!strict && Math.abs(a.x - o.pos.x) <= hx && Math.abs(a.z - o.pos.z) <= hz && a.y >= yLo && a.y <= yHi) return null
  let lo = 0
  let hi = 1
  for (const [p, d, b, t] of [[a.x - o.pos.x, dx, -hx, hx], [a.y, dy, yLo, yHi], [a.z - o.pos.z, dz, -hz, hz]] as const) {
    if (Math.abs(d) < EPS) { if (p < b || p > t) return null; continue } // 与该轴平行：不在带里就永远进不来
    // 沿负方向走的那一轴，`b` 那一侧才是**离开**：先排好序，否则"进面"参数会是负数并把 hi 压到 0 以下
    // （实测：一条从胸口往下斜的线会整条被判为"没穿过墙"，红线不剪、近战不被吃）
    let e = (b - p) / d
    let x = (t - p) / d
    if (e > x) { const tmp = e; e = x; x = tmp }
    if (e > lo) lo = e
    if (x < hi) hi = x
    if (lo >= hi) return null // 有一轴先离开 ⇒ 擦着边过去，没穿过任何面
  }
  return strict ? lo : (lo <= EPS ? null : lo) // 起点正贴在墙面上：贴脸不算"被墙挡住"，与柱面同口径（strict 下贴面 = 走不过去）
}

/**
 * 线段在柱面区间 `[lo,hi]` 内是否穿过 `[base,top]` 这一竖带；返回**最早**那个穿过点的 t。
 * y 沿 t 线性，所以"穿过竖带"这一段要么从 `lo` 就已经在带里，要么在带边界那一格进带。
 */
function enterBand(ay: number, by: number, lo: number, hi: number, base: number, top: number): number | null {
  const yAt = (t: number): number => ay + (by - ay) * t
  const yLo = yAt(lo)
  const yHi = yAt(hi)
  if (yLo >= base && yLo <= top) return lo
  // 线段在这一段里的 y 覆盖 [min,max]，与竖带无交集 ⇒ 从柱顶上方飞过 / 从柱底下方钻过
  if (Math.max(yLo, yHi) < base || Math.min(yLo, yHi) > top) return null
  const target = yLo > top ? top : base
  const slope = by - ay
  if (Math.abs(slope) < EPS) return null // 两端等高却不在带里：整段都在带外
  const t = (target - ay) / slope
  return t >= lo && t <= hi ? t : null
}

/**
 * 遮挡体名册的输入形状：只要求"这一具有 `data.boss.covers`"，不要求认识 `Enemy` 类
 * （结构类型，调用方直接把 `ai.enemies` 递进来，零拷贝）。
 */
export interface CoverBearing {
  id: string
  data: {
    boss?: { covers?: { positions: readonly Vec3[]; radius: number; heightM: number } } | null
  }
}

/**
 * 关卡侧输入形状（KI-014②）：只要求"这一片地方带 `walls`"，不要求认识 `RegionData` 类，
 * 于是 `core` 仍然不认识 `world`（组合根把当前区域的那一条递进来）。
 */
export interface WallBearing {
  id: string
  walls?: readonly WallRef[]
}

/**
 * 视线闸门（KI-014②b）：问「`a → b` 这一线被挡住没有」，挡住 ⇒ `true`。
 * 为什么是一个函数而不让 `ai` 直接 import {@link OcclusionField}：名册的**主人**是 `combat`
 * （它每 tick 重点名），`ai` 要的只是"能不能看见"这一问；给一个函数就把"谁持有名册"这件事
 * 留在了组合根，两层的依赖箭头不因此新增。
 * `null` = 场上没有可挡视线的几何体（没有 authored 墙的野外、以及全部既有测试的口径）。
 */
export type SightGate = ((a: Vec3, b: Vec3) => boolean) | null

/**
 * 遮挡体的**名册**：为什么不是一个纯函数？因为遮挡体跟着实体一起生灭（Boss 离场，
 * 她场地的柱子就该从判据里消失），而线段查询每 tick 要被问几十次。
 * 每 tick 由 {@link syncFrom} 重新点名，条目**就地改写**——这条通道在每帧的热路径上，
 * 造数组/造对象会让"场上有没有 Boss"变成 GC 压力的开关。
 *
 * **两条输入通道，一个名册**（KI-014②）：{@link syncAuthored} 写关卡墙（换区域才重写一次），
 * {@link syncFrom} 写实体柱子（每 tick 重名点）。两者住同一个数组，authored 段固定在**前部**，
 * 于是热路径上仍然只有一次遍历，而"墙"与"柱子"在读者眼里没有区别——它们都是"这一线被什么截断"。
 */
export class OcclusionField {
  private items: Occluder[] = []
  /** `items` 的前这么多条来自关卡；剩下的那条尾巴每 tick 被 {@link syncFrom} 重写 */
  private authored = 0

  /**
   * 换区域时调用一次（不在每 tick 的热路径上，所以这里允许重建条目）。
   * 传 `null` = 清空（组合根在"人不在任何区域里"时走这一支，不许留着上一片天的墙）。
   */
  syncAuthored(region: WallBearing | null): void {
    const walls = region?.walls ?? []
    const next: Occluder[] = walls.map((w) => ({
      // id 直接取数据里的墙名：它全场唯一（validator 钉），读它的人要能回答"是哪堵墙"
      id: `wall:${w.id}`, shape: 'box', pos: { x: w.pos.x, y: w.pos.y, z: w.pos.z },
      halfX: w.size.x / 2, halfZ: w.size.z / 2, heightM: w.heightM,
    }))
    this.items.splice(0, this.authored, ...next)
    this.authored = next.length
  }

  syncFrom(entities: readonly CoverBearing[]): void {
    let n = this.authored
    for (const e of entities) {
      const c = e.data.boss?.covers
      if (!c) continue
      for (let i = 0; i < c.positions.length; i++) {
        const p = c.positions[i]
        let o = this.items[n]
        if (!o || o.shape !== 'cylinder') {
          // 复用槽位只认"同一种截面"：authored 段缩小之后，尾巴上可能还剩着上一片天的盒子，
          // 给它挂 radius 会让类型撒谎（而 box 的 halfX 还留着，读者会拿到一块既厚又圆的东西）
          o = { id: '', shape: 'cylinder', pos: { x: 0, y: 0, z: 0 }, radius: 0, heightM: 0 }
          if (n < this.items.length) this.items[n] = o
          else this.items.push(o)
        }
        // id 带**这一具**里的序号（不是全场序号）：读它的人要能回答"是哪根柱子救了我"
        o.id = `cover:${e.id}:${i}`
        o.pos.x = p.x; o.pos.y = p.y; o.pos.z = p.z
        o.radius = c.radius; o.heightM = c.heightM
        n++
      }
    }
    this.items.length = n
  }

  get live(): number { return this.items.length }
  /** 关卡墙的数量：调试器与测试要靠它区分"挡住我的是 authored 的还是 Boss 自己带的" */
  get authoredLive(): number { return this.authored }

  /** 只读视图：调试器与测试要靠它回答"场上现在有哪几块遮挡体、尺寸是从哪份数据来的" */
  list(): readonly Occluder[] { return this.items }

  /** 两点之间有没有挡着东西 */
  blocked(a: Vec3, b: Vec3, expand = 0): boolean {
    return firstBlock(this.items, a, b, expand) !== null
  }

  firstBlock(a: Vec3, b: Vec3, expand = 0): BlockHit | null {
    return firstBlock(this.items, a, b, expand)
  }
}
