/**
 * 世界遮挡（KI-014①）：`a → b` 这条线段被哪块几何**先**截断、截在哪一点。
 * 住在 `core/` 而不是 `world/`，因为它是一条纯几何查询（和 `core/Math` 同层），
 * 而它的三个读者分属两层——`combat`（弹体、打在玩家身上的那一线）与 `world` 表现层
 * （红线剪断、把柱子画成同尺寸的那一根）。遮挡体**名册**也在这里：`combat` 不许反向 import
 * `world`（tech-arch §3 的依赖箭头），而名册的输入只是 `data/schema` 里已经存在的那格
 * `boss.covers`，不需要认识任何实体类。
 *
 * **一条线段，一个主人。** 三处读取它，而且只有这三处：
 * - 弹体逐 tick 的**扫掠段**（`Projectile.prev → pos`）：弹体自己有半径，所以撞上的判据
 *   要把这一点并进柱子里算（`expand`），否则半根柱子可以让一枚"球心"贴过去。
 * - 打在玩家身上的那一记近战/锁定式 AoE：它的伤害本来就落在"攻击者→玩家"这条线上
 *   （§15.2 断音柱的原文判据），所以它是线段而不是扇形。
 * - §14.4 的 telegraph 红线：线是"它会打哪"的诚实承诺，被挡住的承诺不能画到墙后面。
 *
 * **为什么遮挡体是竖直圆柱**：灰盒期真正有尺寸的实体只有圆柱这一种（断音柱、钟、地标棱柱），
 * 而 §55 不许我凭空发明一套墙体几何来"看起来像"有遮挡。所以本模块的输入是**数据点名的**
 * 遮挡体（今天只有 `boss.covers`），不是从关卡网格推出来的。KI-014 剩下的那半句
 * "隔岩壁投掷"要的是 authored 墙体（KI-008 表现层同因），不在这一批里假装。
 *
 * **两条刻意的口径**（都不是遗漏）：
 * - 起点在柱内 ⇒ **不算被挡**。这就是原来那句"攻击者也贴着柱子 ⇒ 不挡，否则柱子变无敌房"
 *   的几何版本：线段从内部出发时它没有"穿过柱面"，挡不住任何东西。
 *   近似实现里那条要手写，射线实现里它自己成立。
 * - 玩家自己的**挥砍**不接这条通道。§15.2 的柱子是给"朝玩家打来的那一记"准备的，
 *   而玩家的近战是扇形/盒形命中框，不是线段——把线段判据套到扇形上等于用一把尺子量两件事，
 *   那一格留给真正有几何体的时候（登记在 KI-014 行，不当作已解决）。
 */
import type { Vec3 } from '@/data/schema'

/** 一块竖直圆柱遮挡体：`pos` 是**底面圆心**（不是重心），`heightM` 是它的高度 */
export interface Occluder {
  id: string
  pos: Vec3
  radius: number
  heightM: number
}

/** 线段被截断在哪：`at` 是线段**第一次**碰到柱面的那个点（灰尘要甩在那里） */
export interface BlockHit {
  /** 哪一块挡的：调试器与测试要靠它回答"救了我的是哪根柱子" */
  occluderId: string
  at: Vec3
}

const EPS = 1e-7

/**
 * 线段 `a → b` 与遮挡体集合的第一个交点；没有交点返回 null。
 * `expand` 是把"运动的物体自己有半径"并进遮挡体里（柱半径与柱高各加这么多），
 * 近战那条线的端点已经是身体中心/命中点，所以它传 0。
 */
export function firstBlock(
  occluders: Iterable<Occluder>, a: Vec3, b: Vec3, expand = 0,
): BlockHit | null {
  const dx = b.x - a.x
  const dz = b.z - a.z
  // 水平方向没有位移的线段（垂直落体）不可能"从侧面穿过"一根竖直柱：它要么在柱里要么在柱外，
  // 而"整段都在柱内"按上面那条口径是不挡（起点在柱内）。所以直接判无遮挡，不进二次方程除零。
  if (Math.hypot(dx, dz) < EPS) return null
  let best: { t: number; at: Vec3; occluderId: string } | null = null
  for (const o of occluders) {
    const r = o.radius + expand
    if (r <= 0) continue
    const top = o.pos.y + o.heightM + expand
    const base = o.pos.y - expand
    // |A + t·D − C|² = r² 在 xz 平面上的二次方程
    const fx = a.x - o.pos.x
    const fz = a.z - o.pos.z
    const q = (dx * dx + dz * dz)
    const lin = 2 * (fx * dx + fz * dz)
    const cst = fx * fx + fz * fz - r * r
    const disc = lin * lin - 4 * q * cst
    if (disc <= 0) continue // 不相交（含相切：擦过柱面的一寸都不算挡住）
    const sq = Math.sqrt(disc)
    const t1 = (-lin - sq) / (2 * q)
    const t2 = (-lin + sq) / (2 * q)
    if (t1 <= EPS) continue // 起点已经在柱内 ⇒ 柱面在身后，挡不住这一线
    const lo = t1
    const hi = Math.min(t2, 1)
    if (hi <= lo) continue // 交点整段在 b 之后 ⇒ 柱子在目标后面，不是掩体
    const tHit = enterBand(a.y, b.y, lo, hi, base, top)
    if (tHit === null) continue
    if (best && best.t <= tHit) continue
    best = {
      t: tHit,
      occluderId: o.id,
      at: { x: a.x + dx * tHit, y: a.y + (b.y - a.y) * tHit, z: a.z + dz * tHit },
    }
  }
  return best ? { occluderId: best.occluderId, at: best.at } : null
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
 * 遮挡体的**名册**：为什么不是一个纯函数？因为遮挡体跟着实体一起生灭（Boss 离场，
 * 她场地的柱子就该从判据里消失），而线段查询每 tick 要被问几十次。
 * 每 tick 由 {@link syncFrom} 重新点名，条目**就地改写**——这条通道在每帧的热路径上，
 * 造数组/造对象会让"场上有没有 Boss"变成 GC 压力的开关。
 */
export class OcclusionField {
  private items: Occluder[] = []

  syncFrom(entities: readonly CoverBearing[]): void {
    let n = 0
    for (const e of entities) {
      const c = e.data.boss?.covers
      if (!c) continue
      for (let i = 0; i < c.positions.length; i++) {
        const p = c.positions[i]
        let o = this.items[n]
        if (!o) {
          o = { id: '', pos: { x: 0, y: 0, z: 0 }, radius: 0, heightM: 0 }
          this.items.push(o)
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
