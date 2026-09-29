import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, Vec3, WallRef, WeaponData } from '@/data/schema'
import { firstBlock, type BoxOccluder } from '@/core/Occlusion'
import { Navigator } from '@/ai/Navigation'
import { AISystem } from '@/ai/AISystem'
import { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-009 第一腿：敌人的**绕路**（combat.md §595「路径 = 简单导航网格，禁动态避障物理」）。
 *
 * 这一腿之前，追击是"朝目标走直线"：一堵 `regions.json > walls` 里 authored 的墙就能把它变成
 * 一幅壁画——它贴着墙蹭、在墙角抖，而**同一堵墙**早就挡住了玩家的箭与敌人的视线（KI-014②b）。
 * 判据分三层，每层量的是不同的东西：
 *
 * ① `firstBlock` 的**第二种口径**（`strict`）：这把尺子原来那两条"让着走"的规则（起点在体内不挡、
 *    贴面不挡）是给**打出去的线**写的——站在柱子旁也该能开枪，擦着柱面过去的一寸不该算掩体。
 *    而"这一步走不走得过去"问的是另一件事：体内、贴面都算挡。两种口径共用同一份 slab 与二次方程，
 *    于是"挡箭的几何"与"挡路的几何"不可能各写一份、各差一格。
 * ② `Navigator` 的纯几何：没有墙 ⇒ **逐字节回落**（返回目标本身那个对象）；有墙 ⇒ 第一个拐点是
 *    外扩盒之外的角，路线的**每一段都真的走得通**（用同一个 `firstBlock` 复验，不靠"看起来像绕了"）；
 *    墙太多 ⇒ 保险丝熔断、回落直线（宁可走老路，不许掉帧）。
 * ③ 集成：同一个敌人、同一段距离，注入绕路口与不注入各跑一遍——不注入的那一趟会**走进墙的脚印里**
 *    （本引擎没有位移碰撞，这正是"蹭墙"那幅壁画的来源），注入的那一趟**一次都不进**，
 *    而且跨过墙所在的那条线时人在墙的两头之外。
 *
 * 全 headless：几何是纯函数，`Navigator` 只 import `core/Occlusion`，集成腿不碰 three（tech-arch §5.8）。
 */

registerGameData()

/* ==================== A. 同一把尺子的第二种口径：strict ==================== */

/** 轴对齐盒：`size` 是全尺寸（与 `regions.json > walls` 同口径），这里折成半尺寸 */
const box = (id: string, x: number, z: number, sizeX: number, sizeZ: number, heightM = 6, baseY = 0): BoxOccluder =>
  ({ id, shape: 'box', pos: { x, y: baseY, z }, halfX: sizeX / 2, halfZ: sizeZ / 2, heightM })

/** 测试用的那堵墙：2m 厚、8m 长、6m 高，坐落在原点（与 `ww_ridge_east` 同形状） */
const WALL = box('t_wall', 0, 0, 2, 8)

const at = (x: number, z: number, y = 0): Vec3 => ({ x, y, z })

describe('firstBlock 的第二种口径（strict）：挡箭与挡路是同一把尺子上的两档', () => {
  it('起点已经在墙体内：默认口径说"挡不住"（那是给打出去的线写的），strict 说"走不过去"', () => {
    const from = at(0, 0, 1) // 站在墙肚子里
    expect(firstBlock([WALL], from, at(10, 0, 1)), '打出去的线：墙在身后').toBeNull()
    expect(firstBlock([WALL], from, at(10, 0, 1), 0, true), '脚步：体内就是走不过去').not.toBeNull()
  })

  it('起点正贴在墙面上：往墙里走是"挡"、往墙外走是"走得通"（同一把尺子，方向仍然是承重的）', () => {
    const from = at(1, 0, 1) // 正好贴在 +x 那一面
    // 往墙里（-x）：体内/贴面都该拦下来
    expect(firstBlock([WALL], from, at(-10, 0, 1)), '打出去的线：墙在身后，不算掩体').toBeNull()
    expect(firstBlock([WALL], from, at(-10, 0, 1), 0, true), '脚步：贴面往墙里走就是走不过去').not.toBeNull()
    // 往墙外（+x）：这一脚是**离开**这堵墙，两种口径都不该拦（拦下来等于把人钉在墙上）
    expect(firstBlock([WALL], from, at(10, 0, 1)), '离开那一面不是被挡').toBeNull()
    expect(firstBlock([WALL], from, at(10, 0, 1), 0, true), 'strict 只有一种含义：进不去；不是"碰了就停"').toBeNull()
  })

  it('从外面来的一线：两种口径给出**同一个交点**（分岔只在上面那两条赦免上）', () => {
    const a = at(-10, 0, 1), b = at(10, 0, 1)
    const soft = firstBlock([WALL], a, b)
    const hard = firstBlock([WALL], a, b, 0, true)
    expect(soft).not.toBeNull()
    expect(hard).not.toBeNull()
    expect(hard!.at.x, '截在靠我方那一面').toBeCloseTo(soft!.at.x, 9)
    expect(hard!.at.z).toBeCloseTo(soft!.at.z, 9)
    expect(hard!.occluderId).toBe(soft!.occluderId)
  })

  it('墙整堵在目标后面：两种口径都说不挡（strict 不是"一律说不通"）', () => {
    expect(firstBlock([WALL], at(-10, 0, 1), at(-6, 0, 1), 0, true)).toBeNull()
  })

  it('expand 把体格并进来：从墙头绕过去的那条线，体格一大就变"撞上"', () => {
    const a = at(-10, 6, 1), b = at(10, 6, 1) // 在墙的 z 端起外 2m 处平行走过（墙半长 4）
    expect(firstBlock([WALL], a, b), '没有体格时从墙头外面过去').toBeNull()
    expect(firstBlock([WALL], a, b, 0.4), '体格 0.4：外扩到 4.4，还是够不着 6').toBeNull()
    expect(firstBlock([WALL], a, b, 2.1), '体格 2.1：外扩到 6.1 ⇒ 这条线撞上去了').not.toBeNull()
  })
})

/* ==================== B. Navigator：拐点、回落与保险丝 ==================== */

const wallRef = (id: string, x: number, z: number, sx: number, sz: number, y = 0): WallRef =>
  ({ id, pos: { x, y, z }, size: { x: sx, z: sz }, heightM: 6 })

/** 每 tick 都用**同一个** firstBlock 复验一段路走不走得通（strict 口径，体格按调用方给） */
const clear = (walls: readonly WallRef[], a: Vec3, b: Vec3, radius: number): boolean =>
  firstBlock(walls.map((w) => box(w.id, w.pos.x, w.pos.z, w.size.x, w.size.z, w.heightM, w.pos.y)), a, b, radius, true) === null

describe('Navigator：第一个拐点、逐段可走、以及"绕不过去就回落直线"', () => {
  it('没有墙 ⇒ `next` 返回**目标本身那个对象**（回落是逐字节的，不是"等于"）', () => {
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls: [] })
    const to = at(10, 0, 3)
    expect(nav.next(at(0, 0), to, 0.4), '同一个引用').toBe(to)
    expect(nav.path(at(0, 0), to, 0.4)).toEqual([to])
  })

  it('墙在别处 ⇒ 目标原样（不问"场上有没有墙"，只问"这一条线通不通"）', () => {
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls: [wallRef('w', 0, 40, 2, 8)] }) // 离得远
    const to = at(10, 0)
    expect(nav.next(at(0, 0), to, 0.4)).toBe(to)
  })

  it('墙横在中间 ⇒ 第一个拐点不是目标，而**每一段都真的走得通**（用同一个判据复验）', () => {
    const walls = [wallRef('w', 0, 0, 2, 8)]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls })
    const from = at(-10, 0), to = at(10, 0)
    const route = nav.path(from, to, 0.4)
    expect(route, '有路可绕').not.toBeNull()
    expect(route!.length, '不是直线').toBeGreaterThan(1)
    expect(route![route!.length - 1], '末项就是调用方给的那个对象').toBe(to)
    // `next` 是**另一次调用**，路线与拐点都是新的对象 ⇒ 这里比的是值不是引用（引擎每 tick 只问一次，
    // 为一格读数建缓存才是多余的机制；"同一个引用"那句只对末项成立，那是刻意回原始对象）
    expect(nav.next(from, to, 0.4), '`next` 只交第一个拐点').toEqual(route![0])
    expect(nav.next(from, to, 0.4)).not.toBe(to)
    let prev = from
    for (const p of route!) {
      expect(clear(walls, prev, p, 0.4), `这一段走得通：${JSON.stringify(prev)} → ${JSON.stringify(p)}`).toBe(true)
      prev = p
    }
  })

  it('拐点落在外扩盒**之外**（体格半径并进去，另加数值余量）', () => {
    const walls = [wallRef('w', 0, 0, 2, 8)]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls })
    const route = nav.path(at(-10, 0), at(10, 0), 0.4)!
    const mid = route.slice(0, -1)
    expect(mid.length, '这条路上至少有一个拐点').toBeGreaterThan(0)
    for (const p of mid) {
      const outsideX = Math.abs(p.x) >= 1 + 0.4
      const outsideZ = Math.abs(p.z) >= 4 + 0.4
      expect(outsideX || outsideZ, `拐点 ${JSON.stringify(p)} 必须在外扩盒外`).toBe(true)
    }
  })

  it('余量必须大于"走到拐点的死区 + 一 tick 的步长"，否则绕角那一步会把身体放进盒里', () => {
    const walls = [wallRef('w', 0, 0, 2, 8)]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls })
    const route = nav.path(at(-10, 0), at(10, 0), 0.4)!
    // 引擎的到达死区是 0.05m（`stepToward` 与 `Navigator.REACHED` 同一个数），最快的一 tick 是
    // 0.077m（幽灵八 4.2×1.1÷60）⇒ 停在拐点前的那一次提前量最多 0.127m。拐点离外扩盒的距离
    // 只有大于它，"停在拐点前"才仍然在盒外；第一版余量 1e-6，实机就是在这里穿墙的。
    const DEAD_ZONE = 0.05
    const FASTEST_STEP = 4.2 * 1.1 / 60
    for (const p of route.slice(0, -1)) {
      const slackX = Math.abs(p.x) - 1.4
      const slackZ = Math.abs(p.z) - 4.4
      expect(Math.max(slackX, slackZ), '余量要盖得住死区 + 一步').toBeGreaterThan(DEAD_ZONE + FASTEST_STEP)
    }
  })

  it('起点正压在墙的体格里 ⇒ 先迈出去（`path` 没有合法路线，但 `next` 不许直线穿墙）', () => {
    const walls = [wallRef('w', 0, 0, 2, 8)]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls })
    const from = at(1.3, 2.0) // 身体压在墙里（半厚 1 + 体格 0.4 = 1.4）
    const to = at(10, 0)
    expect(nav.path(from, to, 0.4), '从体内出发：strict 下一个解都没有').toBeNull()
    const step = nav.next(from, to, 0.4)
    expect(step, '不是"直线冲目标"').not.toBe(to)
    expect(Math.hypot(step.x - from.x, step.z - from.z), '这一步有长度').toBeGreaterThan(0.05)
    const outsideX = Math.abs(step.x) >= 1.4
    const outsideZ = Math.abs(step.z) >= 4.4
    expect(outsideX || outsideZ, '迈出去的那一点在外扩盒之外').toBe(true)
  })

  it('已经站在头一个拐点上 ⇒ 它被摘掉（否则 `stepToward` 对 0.05m 内的目标原地不动，人抱着自己的角卡住）', () => {
    const walls = [wallRef('w', 0, 0, 2, 8)]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls })
    const corner = at(1.55, 4.55) // 外扩角（1 + 0.4 + 余量 0.15, 4 + 0.4 + 余量 0.15）
    const route = nav.path(corner, at(10, 0), 0.4)
    if (route) {
      const first = route[0]
      const same = Math.hypot(first.x - corner.x, first.z - corner.z) <= 0.05
      expect(same && route.length > 1, '第一项要么不是脚下这个角，要么它就是目标本身').toBe(false)
    }
  })

  it('墙太多 ⇒ 保险丝熔断，回落直线（宁可走老路，不许掉帧）', () => {
    // 第 0 面横在两人中间（否则"直线走得通"那条更早的分支会先把我们送回 [to]，这一刀就白挨了），
    // 另外十二面散在远处，把名册推过 `MAX_WALLS`
    const walls = [wallRef('block', 0, 0, 2, 8), ...Array.from({ length: 12 }, (_, i) => wallRef(`w${i}`, (i - 6) * 3, i % 2 === 0 ? -30 : 30, 2, 6))]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls })
    const to = at(10, 0)
    expect(nav.path(at(-10, 0), to, 0.4), '不建图').toBeNull()
    expect(nav.next(at(-10, 0), to, 0.4)).toBe(to)
  })

  it('被墙围死 ⇒ 回落直线，不抛错（"无路可绕"是一种正常读数）', () => {
    const walls = [
      wallRef('n', 0, -6, 20, 2), wallRef('s', 0, 6, 20, 2),
      wallRef('w', -6, 0, 2, 20), wallRef('e', 6, 0, 2, 20),
    ]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls })
    const to = at(10, 10)
    expect(nav.path(at(0, 0), to, 0.4)).toBeNull()
    expect(nav.next(at(0, 0), to, 0.4)).toBe(to)
  })

  it('查询点落到**这一层的地板**上（y 不参与几何判定），末项保留调用方给的那个对象', () => {
    // 墙站在 -40 层、高 6（占 -40~-34）。查询点本来给的是 y=7（远在墙顶之上）——**若不平移到地板**，
    // 这条线会从墙顶上飞过去；平移到 -40 之后它才真的撞在这堵墙上。这是"平面问题"那句的行为读数。
    const walls = [wallRef('w', 0, 0, 2, 8, -40)]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: -40, walls })
    const to = at(10, 0, 7)
    expect(nav.next(at(-10, 0, 7), to, 0.4), '查询点落在地板上 ⇒ 这堵墙挡得住').not.toBe(to)
    const route = nav.path(at(-10, 0, 999), to, 0.4)!
    expect(route[route.length - 1].y, '末项是调用方给的那个对象').toBe(7)
  })

  it('拐点的 y 沿用调用方给的目标高度（几何早已在查询那一步落到地板上，拐点只在 x/z 上有意义）', () => {
    const walls = [wallRef('w', 0, 0, 2, 8)]
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls })
    const route = nav.path(at(-10, 0), at(10, 0, 3), 0.4)!
    for (const p of route) expect(p.y, '一路跟着 To.y，不在这里另立一格高度').toBe(3)
  })

  it('换区域：`syncAuthored(null)` 清空（人不在任何区域里时不许留着上一片天的墙）', () => {
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls: [wallRef('w', 0, 0, 2, 8)] })
    const to = at(10, 0)
    expect(nav.next(at(-10, 0), to, 0.4), '先确认这一片天真的有墙可绕').not.toBe(to)
    nav.syncAuthored(null)
    expect(nav.next(at(-10, 0), to, 0.4)).toBe(to)
  })
})

/* ==================== C. 集成：同一个敌人，注入与不注入各跑一遍 ==================== */

const MV = (): { player: PlayerController; ai: AISystem; time: GameTime; rhythm: RhythmClock; input: Input; tick: (n: number) => void } => {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const tick = (n: number): void => {
    for (let i = 0; i < n; i++) {
      // 玩家站着不动：不给地板就会一直掉，掉出这一层之后所有几何读数都朝"没挡住"假绿
      player.floorY = 0; player.pos.y = 0; player.vy = 0; player.grounded = true
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { player, ai, time, rhythm, input, tick }
}

/**
 * 集成用的那堵墙：2m 厚、6m 长（半长 3）、6m 高。两人分站两头各 4m ⇒ 初始距离 8m
 * **小于嘈壳 12m 的视距**——这一点是承重的：视线默认不被墙挡（`ai.sightBlocked` 没注入），
 * 于是它一路都在 `chase` 里，量到的差别只来自脚下的路。（第一版把人摆在 ±10m，20m 远到
 * 看不见，它半途掉进 `search` 开始绕着 `lastKnown` 转圈 ⇒ 那条断言量的其实是状态机，不是导航。）
 */
const WALL_REF = wallRef('t_wall', 0, 0, 2, 6)
const HALF_Z = 3
const RADIUS = 0.5 * (registry.get<EnemyData>('en_murkshell').body?.scale ?? 1) // 与 `Enemy.agentRadius` 同一支笔
const insideFootprint = (p: Vec3): boolean =>
  Math.abs(p.x) <= 1 + RADIUS - 1e-6 && Math.abs(p.z) <= HALF_Z + RADIUS - 1e-6

/** 从 (-4,0) 追到 (4,0)，墙在中间；返回整趟的采样（每一趟都是一个**干净的世界**） */
function chase(withNav: boolean): { inside: number; crossedAt: Vec3 | null; maxX: number } {
  const w = MV()
  const enemy = w.ai.spawn('en_murkshell', at(-4, 0), 'nav')
  enemy.alertness = 100
  enemy.enter('combat')
  w.player.pos.x = 4; w.player.pos.z = 0
  if (withNav) {
    const nav = new Navigator()
    nav.syncAuthored({ groundY: 0, walls: [WALL_REF] })
    w.ai.nav = (from, to, radius) => nav.next(from, to, radius)
  } else {
    w.ai.nav = null
  }
  let inside = 0
  let crossedAt: Vec3 | null = null
  let maxX = enemy.pos.x
  for (let i = 0; i < 600; i++) {
    w.tick(1)
    if (insideFootprint(enemy.pos)) inside++
    if (crossedAt === null && enemy.pos.x > 1 + RADIUS) crossedAt = { ...enemy.pos }
    maxX = Math.max(maxX, enemy.pos.x)
  }
  return { inside, crossedAt, maxX }
}

describe('集成：不注入绕路口会走进墙里，注入之后一次都不进', () => {
  it('对照腿（`ai.nav = null`）：直线追击会**走进墙的脚印**——本引擎没有位移碰撞，这就是"蹭墙"那幅壁画', () => {
    const r = chase(false)
    expect(r.inside, '没注入时它当然照直走').toBeGreaterThan(0)
    expect(r.maxX, '它也确实"到了"对面（穿墙而过）').toBeGreaterThan(1)
  })

  it('注入绕路口：一次都不进墙的脚印，并且是**从墙的两头之外**跨过去的', () => {
    const r = chase(true)
    expect(r.inside, '绕路的意义就是不进墙').toBe(0)
    expect(r.crossedAt, '它还是到了对面（绕路不是"站着不动"）').not.toBeNull()
    expect(Math.abs(r.crossedAt!.z), '跨过墙所在那条线时，人在墙的两头之外').toBeGreaterThan(HALF_Z)
  })

  it('绕路的收益与它的代价都只有一份：`ai.nav` 每 tick 统一下发，改一次全场当帧生效', () => {
    const w = MV()
    const enemy = w.ai.spawn('en_murkshell', at(-4, 0), 'nav')
    w.ai.nav = null
    w.tick(1)
    expect(enemy.nav, '组合根没给 ⇒ 这一只身上也是 null（回落直线）').toBeNull()
    const gate = (from: Vec3, to: Vec3): Vec3 => to
    w.ai.nav = gate
    w.tick(1)
    expect(enemy.nav, '改一次就下发到名册里的每一只，不必等下一次 spawn').toBe(gate)
  })
})
