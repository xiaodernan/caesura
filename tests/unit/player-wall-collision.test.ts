import { describe, expect, it } from 'vitest'
import { registerGameData, playerBase, regions } from '@/data'
import { registry } from '@/core/Registry'
import { PlayerController } from '@/player/ThirdPersonController'
import { OcclusionField, type Occluder } from '@/core/Occlusion'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import type { Input } from '@/core/Input'
import type { MovesetData, RegionData, WeaponData } from '@/data/schema'

/**
 * **玩家与 authored 墙的碰撞**（KI-154）。
 *
 * **病（实测）**：玩家移动那一段只做"按指令速度积分"，**没有任何与墙的求交** ⇒ 玩家会
 * **穿过**看得见的塌墙（探针读数：破拍营地的 `wb_camp_watch_screen`，从北侧 6m 处直走 3 秒，
 * 穿过 1.8m 厚的墙走了 13.8m）。而同一堵墙在别处**是有承重作用的**：挡箭（KI-014②b）、
 * 挡视线（KI-014②b）、挡玩家自己挥出去的那一刀（KI-070）、逼敌人绕路（KI-009）。
 * **唯独对玩家自己它不是墙** —— 遮挡名册成了"敌人的掩体、玩家的装饰"（KI-070 那一行原话）。
 *
 * **这一份用**同一本**遮挡名册**（`core/Occlusion`）——与箭、视线、敌人绕路、相机撞墙同源。
 */
registerGameData()

const camp = regions.find((r) => r.id === 'rg_brokenbar_camp') as RegionData
const wall = camp.walls!.find((w) => w.id === 'wb_camp_watch_screen')!
const HALF_X = wall.size.x / 2
const HALF_Z = wall.size.z / 2

/** 造一个能走路的玩家：摇杆往前推 n 帧，返回它停在哪 */
function walk(
  steps: number,
  start: { x: number; z: number },
  dir: { x: number; y: number } = { x: 0, y: 1 },
  opts: { book?: boolean; occluders?: readonly Occluder[] } = {},
) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>('ms_sword')
  const player = new PlayerController(playerBase, weapon, moveset)
  if (opts.occluders) {
    // 直接喂一份名册（圆柱那一条腿用：断音柱是柱不是盒）
    player.occluders = () => opts.occluders!
  } else if (opts.book !== false) {
    // **同一本**遮挡名册：组合根注入的那一份（这里自己搭一份等价物）
    const occ = new OcclusionField()
    occ.syncAuthored(camp)
    player.occluders = () => occ.list()
  }

  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.pos.x = start.x
  player.pos.y = wall.pos.y
  player.pos.z = start.z
  player.floorY = wall.pos.y
  frame.move = dir
  for (let i = 0; i < steps; i++) {
    time.tick++
    player.update(1 / 60, time, input, time.tick, rhythm)
    frame.edges.clear()
  }
  return { x: player.pos.x, z: player.pos.z }
}

/** 站进了墙里没有 */
const insideWall = (x: number, z: number): boolean =>
  Math.abs(x - wall.pos.x) < HALF_X && Math.abs(z - wall.pos.z) < HALF_Z

describe('玩家与 authored 墙（KI-154）', () => {
  it('没有名册时照旧穿过（默认注入是空清单：没有墙的地方不该有任何阻挡）', () => {
    const end = walk(180, { x: wall.pos.x, z: wall.pos.z + 6 }, { x: 0, y: 1 }, { book: false })
    expect(end.z, '没有名册 ⇒ 照旧穿过（这一条钉住"注入之前"的行为）').toBeLessThan(wall.pos.z)
  })

  it('注入了名册 ⇒ 玩家**撞在墙前**，穿不过去', () => {
    const end = walk(180, { x: wall.pos.x, z: wall.pos.z + 6 })
    expect(insideWall(end.x, end.z), '玩家不许站进墙里').toBe(false)
    expect(end.z, '停在墙的北侧（没穿过去）').toBeGreaterThan(wall.pos.z + HALF_Z)
  })

  it('贴着墙走（斜着撞）：沿墙滑而不是被钉住', () => {
    // 斜着走向墙角：滑行解法应当让玩家贴着墙继续走，而不是卡在原地
    const end = walk(180, { x: wall.pos.x + 6, z: wall.pos.z + 6 }, { x: -0.7, y: 0.7 })
    expect(insideWall(end.x, end.z), '斜着撞也不许进墙里').toBe(false)
    expect(end.x, '切向那一轴照旧走得动（沿墙滑）').toBeLessThan(wall.pos.x + 6)
    expect(end.z, '撞墙那一轴被推回墙外').toBeGreaterThan(wall.pos.z + HALF_Z)
  })

  it('已经贴在墙面时：往旁边挪一步不许被冻住（贴面即挡会把人钉在墙前）', () => {
    // 圆心落在"墙面 + 半径"**之内 5mm**：**不是恰好落在面上**——恰好落在面上要靠浮点运气的福
    // （第一版就写在这儿：`-128 + 0.9 + 0.4` 的浮点结果比 `0.9 + 0.4` 差了一格，
    //  那个"贴面即冻"的臂因此没被这条腿抓到 ⇒ 腿是绿的，臂却没被抓住 ⇒ 判据靠运气 = 没有判据）
    const start = { x: wall.pos.x, z: wall.pos.z + HALF_Z + 0.4 - 0.005 }
    const end = walk(30, start, { x: 1, y: 0 })
    expect(Math.abs(end.x - start.x), '贴着墙面时切向挪一步必须挪得动').toBeGreaterThan(0.2)
    expect(end.z, '切向挪动不许把人推进墙里').toBeGreaterThan(wall.pos.z + HALF_Z - 0.01)
  })

  it('站进了墙里（出生点在墙体内）：要把人推出来，不许从墙里穿过去', () => {
    const end = walk(30, { x: wall.pos.x, z: wall.pos.z })
    expect(insideWall(end.x, end.z), '体内 ⇒ 被推出来（不许留在体内）').toBe(false)
    // **还要钉住"穿过去"**：只看"最终不在墙里"是不够的——从墙里一路走到墙的另一侧，
    // 最终也不在墙里，那条腿照样是绿的（第一版就写成那样 ⇒ 臂 D「体内不推」整条漏网）
    expect(end.z, '不许从墙里穿过去（最终仍该在墙的北侧）').toBeGreaterThan(wall.pos.z)
  })

  it('没有墙的地方照旧走得动（注入名册不许变成"走不动"）', () => {
    const end = walk(60, { x: 0, z: 0 })
    expect(end.z, '空旷处照旧走').toBeLessThan(-1)
  })

  it('柱也是墙：断音柱那种**圆柱**，人一样撞得住', () => {
    // 名册里有两种形状：**盒**（authored 塌墙）与**柱**（断音柱／钟／地标棱柱）。
    // 只认盒 ⇒ 人会从柱子里穿过去——**判据必须两种都认**
    const pillar: Occluder = {
      id: 'wall:断音柱', shape: 'cylinder', pos: { x: 0, y: 0, z: 0 }, radius: 2, heightM: 3.6,
    }
    const end = walk(120, { x: 0, z: 6 }, { x: 0, y: 1 }, { occluders: [pillar] })
    const d = Math.hypot(end.x, end.z)
    expect(d, '人停在柱面 + 人的半径上（2 + 0.4）').toBeCloseTo(2.4, 1)
    expect(d, '不许穿过柱心').toBeGreaterThan(2.3)
  })

  it('在墙体内、往侧面走：被推到最近的那一面（不许被推到墙的另一侧）', () => {
    // 起点在墙体内、靠东侧（x 方向穿得最浅）⇒ 该往东面推
    const start = { x: wall.pos.x + HALF_X - 0.1, z: wall.pos.z }
    const end = walk(3, start, { x: 1, y: 0 })
    expect(end.x, '被推到东面（离墙心 = 墙半宽 + 人的半径）').toBeGreaterThan(wall.pos.x + HALF_X + 0.2)
    expect(end.x, '不许被推到墙的西侧').toBeGreaterThan(start.x)
  })
})
