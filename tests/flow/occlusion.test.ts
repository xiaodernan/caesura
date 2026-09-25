import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, Vec3, WeaponData } from '@/data/schema'
import { firstBlock, OcclusionField, type CylinderOccluder, type Occluder } from '@/core/Occlusion'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'

/**
 * 世界遮挡流程测试（KI-014①②，需求 §15.2「躲入断音柱后」+ §65「弹体不该穿过掩体」+ §577「视锥 + 遮挡检查」的几何地基）。
 *
 * 这一批要守住的不是"柱子有没有用"（`mainboss.test.ts` 已经管过那一格），而是
 * **遮挡第一次变成一条真的线段**：`core/Occlusion` 的那一个 `firstBlock` 被三个读者共用
 * （弹体的扫掠段、打在玩家身上的那一记、§14.4 的红线、敌人的视线），于是这几条腿必须同生同死。
 * 所以这里的判据全是几何量（"截在哪一点""离柱轴多少米"），不是"掉没掉血"那种间接读数——
 * 掉血只能证明某一格 if 生效，证明不了三个人读的是同一把尺子。
 *
 * ②那一批（authored 墙）新增的判据是**同一把尺子的第二种截面**：一条线穿过一堵薄墙和穿过
 * 一根柱子必须给出同一种答案（截在**进**那个面上、贴脸不算挡、起点在体内不算挡、`expand` 把
 * 墙加厚），否则"躲到墙后面"会根据玩家躲的是柱还是墙而 behave 不一样——那才是玩家真正会感到的那种割裂。
 *
 * 全 headless：`firstBlock` 是纯几何，`CombatManager` 是逻辑层，都不碰 three（tech-arch §5.8）。
 */

registerGameData()

/** 场地锚点：恩希尔的第一根断音柱，尺寸与位置**全部从数据读**（§55，测试不许抄一份常数） */
const COV = registry.get<EnemyData>('en_hersil').boss!.covers!
const AX = COV.positions[0]
/** 柱底在 AX.y 这一层；"胸口高"取柱底上方 1m，让纯几何腿与集成腿用同一个直观高度 */
const CHEST = AX.y + 1.0

/* ==================== A. 原语：一条线段 vs 一组竖直圆柱 ==================== */

/** 手工名册：几何腿要的是"我能自己算出答案的那个尺寸"，所以这里允许自定义半径/高度 */
const cyl = (id: string, x: number, z: number, radius = 2, heightM = 10, baseY = 0): Occluder =>
  ({ id, shape: 'cylinder', pos: { x, y: baseY, z }, radius, heightM })

/** 轴对齐盒：`size` 是**全尺寸**（与 `regions.json > walls` 同口径），这里折成半尺寸 */
const box = (id: string, x: number, z: number, sizeX: number, sizeZ: number, heightM = 10, baseY = 0): Occluder =>
  ({ id, shape: 'box', pos: { x, y: baseY, z }, halfX: sizeX / 2, halfZ: sizeZ / 2, heightM })

/** 判别联合不是用来在断言里到处开 `!` 的：要读 radius 就先把这一条钉成圆柱 */
const asCyl = (o: Occluder): CylinderOccluder => {
  expect(o.shape, `要读 radius，这一条就得是圆柱（实测 ${o.shape}）`).toBe('cylinder')
  return o as CylinderOccluder
}

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe('遮挡原语 firstBlock：一条线段只有一个答案', () => {
  it('直穿一根柱子 ⇒ 截在**靠我方**的那个柱面上，并交出挡住它的是哪一根', () => {
    const o = cyl('p', 0, 0)
    const hit = firstBlock([o], { x: -10, y: 5, z: 0 }, { x: 10, y: 5, z: 0 })
    expect(hit, '穿过柱面就是被挡').not.toBeNull()
    expect(hit!.occluderId, '要能回答"是哪根柱子救了我"（调试器与测试共用这一格）').toBe('p')
    expect(Math.hypot(hit!.at.x, hit!.at.z), '交点在柱面上').toBeCloseTo(2, 6)
    expect(hit!.at.x, '取的是**第一个**交点，不是穿出点').toBeCloseTo(-2, 6)
  })

  it('起点已经在柱内 ⇒ 不算被挡（"他也贴着柱子所以不算躲"那条不再需要手写）', () => {
    const o = cyl('p', 0, 0)
    expect(firstBlock([o], { x: 0, y: 5, z: 0 }, { x: 10, y: 5, z: 0 }), '柱面在身后').toBeNull()
    expect(firstBlock([o], { x: 1.9, y: 5, z: 0 }, { x: 9, y: 5, z: 0 })).toBeNull()
  })

  it('柱子整根在目标后面 ⇒ 不是掩体；线段走不到它面前', () => {
    expect(firstBlock([cyl('p', 0, 0)], { x: -10, y: 5, z: 0 }, { x: -5, y: 5, z: 0 })).toBeNull()
  })

  it('相切与连续：擦过柱面一寸不算挡住，但差一丝就要挡住（判据不许有缝）', () => {
    const o = cyl('p', 0, 0)
    const along = (offsetZ: number): boolean =>
      firstBlock([o], { x: -10, y: 5, z: offsetZ }, { x: 10, y: 5, z: offsetZ }) !== null
    expect(along(2.4), '离轴 2.4 > 半径 2 ⇒ 从旁边过去').toBe(false)
    expect(along(2), '正好相切 ⇒ disc=0，零宽的一寸不算遮挡').toBe(false)
    expect(along(1.99), '差一丝 ⇒ 立刻变回"挡住"，中间没有第三种答案').toBe(true)
  })

  it('遮挡体**有高度**：同一根线，柱高 3m 时从顶上飞过、柱高 8m 时被截住', () => {
    const a = { x: -10, y: 5, z: 0 }
    const b = { x: 10, y: 5, z: 0 }
    expect(firstBlock([cyl('矮', 0, 0, 2, 3)], a, b), 'y=5 从 3m 柱顶上方飞过').toBeNull()
    expect(firstBlock([cyl('高', 0, 0, 2, 8)], a, b), '8m 柱就在半路上').not.toBeNull()
    expect(firstBlock([cyl('悬', 0, 0, 2, 4, 6)], a, b), '6~10m 的悬空体：线在 5m，从底下钻过去').toBeNull()
  })

  it('运动的物体自己有半径：expand 把那一寸并进柱子里（球心贴柱掠过也算撞）', () => {
    const o = cyl('p', 0, 0, 2, 10)
    const a = { x: -10, y: 5, z: 2.3 }
    const b = { x: 10, y: 5, z: 2.3 }
    expect(firstBlock([o], a, b, 0), '球心离轴 2.3 > 2 ⇒ 只看轴心是掠过的').toBeNull()
    const hit = firstBlock([o], a, b, 0.5)
    expect(hit, '半径 0.5 的球并进柱子 ⇒ 2.3 < 2.5，撞上了').not.toBeNull()
    expect(Math.hypot(hit!.at.x, hit!.at.z), '交点是**球心**停下的地方：离轴 = 柱半径 + 球半径').toBeCloseTo(2.5, 6)
  })

  it('两根柱子取**最近**的那一根，而不是名册里排在前面的那一根', () => {
    const near = cyl('近', 6, 0, 1.5, 10)
    const far = cyl('远', -6, 0, 1.5, 10)
    const hit = firstBlock([far, near], { x: -12, y: 5, z: 0 }, { x: 12, y: 5, z: 0 })
    expect(hit!.occluderId, '名册顺序不该改变答案').toBe('远')
    expect(hit!.at.x, '先碰到 x=-7.5 那一根').toBeCloseTo(-7.5, 6)
    expect(firstBlock([near], { x: 0, y: 5, z: 0 }, { x: 12, y: 5, z: 0 })!.occluderId).toBe('近')
  })

  it('水平零位移的线段（垂直落体）不进二次方程：判无遮挡，而不是 NaN', () => {
    expect(firstBlock([cyl('p', 0, 0)], { x: 0, y: 20, z: 0 }, { x: 1e-10, y: 0, z: 0 })).toBeNull()
  })
})

/* ==================== A2. 盒截面：authored 墙与柱子共用同一套口径 ==================== */

describe('遮挡原语 firstBlock（盒截面）：一堵薄墙是一维的柱子，不是另一种规则', () => {
  it('直穿一堵墙 ⇒ 截在**朝向我方**的那个面上，并交出是哪堵墙', () => {
    // 墙：x∈[-0.75,0.75]（1.5m 厚），z∈[-9,9]（18m 长），高 3m
    const o = box('w', 0, 0, 1.5, 18, 3)
    const hit = firstBlock([o], { x: -10, y: 1.5, z: 0 }, { x: 10, y: 1.5, z: 0 })
    expect(hit, '穿过墙面就是被挡').not.toBeNull()
    expect(hit!.occluderId).toBe('w')
    expect(hit!.at.x, '取的是进面 x=-0.75，不是穿出面').toBeCloseTo(-0.75, 6)
    expect(hit!.at.z, '沿墙长方向直行时交点不该漂走').toBeCloseTo(0, 6)
  })

  it('与圆柱同一条口径：起点在墙肚子里 ⇒ 不算被挡（站内不会变成无敌房）', () => {
    const o = box('w', 0, 0, 4, 4, 3)
    expect(firstBlock([o], { x: 0, y: 1.5, z: 0 }, { x: 10, y: 1.5, z: 0 })).toBeNull()
    expect(firstBlock([o], { x: 1.9, y: 1.5, z: 0 }, { x: 9, y: 1.5, z: 0 })).toBeNull()
  })

  it('墙整块在目标后面 ⇒ 不是掩体；擦着墙角过去 ⇒ 一寸都不算挡住（判据不许有缝）', () => {
    const o = box('w', 0, 0, 2, 2, 3)
    expect(firstBlock([o], { x: -10, y: 1.5, z: 0 }, { x: -5, y: 1.5, z: 0 }), '走不到墙面前').toBeNull()
    expect(firstBlock([o], { x: -10, y: 1.5, z: 1.01 }, { x: 10, y: 1.5, z: 1.01 }), '离墙轴 1.01 > 半宽 1 ⇒ 从旁边过去').toBeNull()
    expect(firstBlock([o], { x: -10, y: 1.5, z: 0.99 }, { x: 10, y: 1.5, z: 0.99 }), '差一丝 ⇒ 立刻变回挡住').not.toBeNull()
  })

  it('墙**有高度**：同一根线，墙高 1m 时从顶上飞过、墙高 3m 时被截住；悬空的墙挡不住贴地的线', () => {
    const a = { x: -10, y: 1.5, z: 0 }
    const b = { x: 10, y: 1.5, z: 0 }
    expect(firstBlock([box('矮', 0, 0, 2, 8, 1)], a, b)).toBeNull()
    expect(firstBlock([box('高', 0, 0, 2, 8, 3)], a, b)).not.toBeNull()
    expect(firstBlock([box('悬', 0, 0, 2, 8, 2, 4)], a, b), '4~6m 的悬空体：线在 1.5m，从底下钻过去').toBeNull()
  })

  it('运动的物体自己有半径：expand 把墙加厚（球心贴墙掠过也算撞）', () => {
    const o = box('w', 0, 0, 2, 8, 3)
    const a = { x: -10, y: 1.5, z: 4.3 }
    const b = { x: 10, y: 1.5, z: 4.3 }
    expect(firstBlock([o], a, b, 0), '球心离轴 4.3 > 半宽 4 ⇒ 只看轴心是掠过的').toBeNull()
    const hit = firstBlock([o], a, b, 0.5)
    expect(hit, '半径 0.5 的球并进墙 ⇒ 4.3 < 4.5，撞上了').not.toBeNull()
    // 盒子与柱子在这里的区别是诚实的：柱面是弯的，球心停在"离轴 = 半径+弹宽"那一圈；
    // 墙的面是平的，加厚发生在**被穿的那一轴**上，掠过的那一轴只参与"够不够近"的判定。
    expect(hit!.at.x, '球心停在加厚之后的墙面前：x = -(半宽 + 球半径)').toBeCloseTo(-1.5, 6)
    expect(hit!.at.z, '掠过轴上的位置就是它飞过来的那个位置').toBeCloseTo(4.3, 6)
  })

  it('贴脸不算挡：起点正压在墙面上（lo=0）时与柱面同口径，否则玩家会被自己站的墙吃掉攻击', () => {
    const o = box('w', 0, 0, 2, 8, 3)
    expect(firstBlock([o], { x: -1, y: 1.5, z: 0 }, { x: 10, y: 1.5, z: 0 })).toBeNull()
  })

  it('线段是斜的、或者从负方向来，都必须照样挡住：三条轴的入口参数各要排好序（漏一次就整类漏判）', () => {
    const o = box('w', 0, 0, 2, 8, 4)
    expect(firstBlock([o], { x: -10, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }), '+x 方向').not.toBeNull()
    expect(firstBlock([o], { x: 10, y: 2, z: 0 }, { x: -10, y: 2, z: 0 }), '-x 方向（墙的另一面）').not.toBeNull()
    expect(firstBlock([o], { x: 0, y: 2, z: -10 }, { x: 0, y: 2, z: 10 }), '+z 方向').not.toBeNull()
    expect(firstBlock([o], { x: 0, y: 2, z: 10 }, { x: 0, y: 2, z: -10 }), '-z 方向').not.toBeNull()
    // 一条从胸口往脚下斜的线（抛射/马上挨的一记都是这种）：y 轴走负方向，入口参数在另一端
    expect(firstBlock([o], { x: -10, y: 6, z: 0 }, { x: 10, y: 0.5, z: 0 }), '下坡的线').not.toBeNull()
    expect(firstBlock([o], { x: -10, y: 0.5, z: 0 }, { x: 10, y: 6, z: 0 }), '上坡的线').not.toBeNull()
    expect(firstBlock([o], { x: -10, y: 9, z: 0 }, { x: 10, y: 4, z: 0 }), '整条下坡都从 4m 墙顶上方过去 ⇒ 不挡').toBeNull()
  })

  it('两种截面混在同一份名册里时，取的是**最近**的那一块，而不是名册顺序', () => {
    const wall = box('墙', 4, 0, 1, 12, 3)      // 进面在 x=3.5
    const pillar = cyl('柱', 0, 0, 1.5, 6)       // 柱面在 x=-1.5
    const a = { x: -10, y: 1.5, z: 0 }
    const b = { x: 10, y: 1.5, z: 0 }
    expect(firstBlock([wall, pillar], a, b)!.occluderId, '柱子更近').toBe('柱')
    expect(firstBlock([wall, cyl('远柱', 8, 0, 1.5, 6)], a, b)!.occluderId, '墙更近').toBe('墙')
  })
})

/* ==================== B. 名册：遮挡体跟着实体生灭 ==================== */

describe('遮挡名册 syncFrom：条目就地改写，尺寸来自数据', () => {
  const bearing = (id: string, positions: Vec3[], radius: number, heightM: number) =>
    ({ id, data: { boss: { covers: { positions, radius, heightM } } } })

  it('一具实体两根柱 ⇒ 两条名册，id 带"哪一具的第几根"，尺寸原样从数据来', () => {
    const f = new OcclusionField()
    f.syncFrom([bearing('en_hersil', [{ x: 1, y: 0, z: 2 }, { x: 3, y: 0, z: 4 }], 3.2, 7.5)])
    expect(f.live).toBe(2)
    expect(f.list().map((o) => o.id)).toEqual(['cover:en_hersil:0', 'cover:en_hersil:1'])
    expect(asCyl(f.list()[0]).radius, '半径不是代码里的常数').toBe(3.2)
    expect(f.list()[0].heightM, '高度是 y 带的承重格，它必须真的来自数据').toBe(7.5)
    expect(f.list()[1].pos.x).toBe(3)
  })

  it('实体消失 ⇒ 名册清空，同一条线立刻不再被挡（Boss 离场后柱子不该还在吃伤害）', () => {
    const f = new OcclusionField()
    f.syncFrom([bearing('en_hersil', [{ x: 0, y: 0, z: 0 }], 2, 10)])
    const a = { x: -10, y: 5, z: 0 }
    const b = { x: 10, y: 5, z: 0 }
    expect(f.blocked(a, b)).toBe(true)
    f.syncFrom([])
    expect(f.live, '长度收缩而不是留一堆死人').toBe(0)
    expect(f.blocked(a, b), '清空之后的世界什么都不挡（这是回归保险，不是新功能）').toBe(false)
  })

  it('没有 covers 的普通敌人不贡献任何遮挡体', () => {
    const f = new OcclusionField()
    f.syncFrom([{ id: 'en_murkshell', data: {} }, bearing('empty', [], 1, 1)] as never[])
    expect(f.live, '招式表里没有场地的实体，就不该有掩体').toBe(0)
  })
})

/* ==================== B2. 第二条输入通道：关卡墙与实体柱子同住一个名册 ==================== */

/** 关卡侧输入：与 `regions.json > walls` 同口径（pos=底面中心、size=全尺寸） */
const wall = (id: string, x: number, z: number, sizeX: number, sizeZ: number, heightM = 3, baseY = 0) =>
  ({ id, pos: { x, y: baseY, z }, size: { x: sizeX, z: sizeZ }, heightM })

describe('遮挡名册 syncAuthored：墙按区域写一次，柱子仍按 tick 写', () => {
  const bearing = (id: string, positions: Vec3[], radius: number, heightM: number) =>
    ({ id, data: { boss: { covers: { positions, radius, heightM } } } })

  it('一片地方三面墙 ⇒ 三条盒名册，尺寸从数据折半而来，id 带"wall:"前缀', () => {
    const f = new OcclusionField()
    f.syncAuthored({ id: 'rg_x', walls: [wall('w1', 0, 0, 2, 8), wall('w2', 30, 0, 1.5, 6, 5, -40)] })
    expect(f.live, '没有实体时也已经有 authored 遮挡体').toBe(2)
    expect(f.authoredLive).toBe(2)
    expect(f.list().map((o) => o.id)).toEqual(['wall:w1', 'wall:w2'])
    const w2 = f.list()[1]
    expect(w2.shape, 'authored 的截面是盒，不是把墙硬塞成圆柱').toBe('box')
    expect((w2 as { halfX: number }).halfX).toBe(0.75)
    expect((w2 as { halfZ: number }).halfZ).toBe(3)
    expect(w2.heightM, '高度是 y 带的承重格，必须真的来自数据').toBe(5)
    expect(w2.pos.y, '底面中心而不是重心：区域层差靠这一格才不串层').toBe(-40)
  })

  it('不写 walls 的区域 ⇒ 空名册（"这一片天没有 authored 掩体"不是错误，是常态）', () => {
    const f = new OcclusionField()
    f.syncAuthored({ id: 'rg_hub' })
    expect(f.live).toBe(0)
    f.syncAuthored(null)
    expect(f.live, '人不在任何区域里 ⇒ 不许留着上一片天的墙').toBe(0)
  })

  it('两条通道共存：authored 段固定在前部，每 tick 的 syncFrom 只动尾巴（热路径仍是一次遍历）', () => {
    const f = new OcclusionField()
    f.syncAuthored({ id: 'rg_x', walls: [wall('w1', 0, 0, 2, 8), wall('w2', 20, 0, 2, 8)] })
    f.syncFrom([bearing('en_hersil', [{ x: 5, y: 0, z: 5 }], 2, 7)])
    expect(f.list().map((o) => o.id)).toEqual(['wall:w1', 'wall:w2', 'cover:en_hersil:0'])
    f.syncFrom([bearing('en_hersil', [{ x: 6, y: 0, z: 5 }, { x: 7, y: 0, z: 5 }], 2, 7)])
    expect(f.list().map((o) => o.id), '柱子换数量不许把墙挤掉或挤序').toEqual([
      'wall:w1', 'wall:w2', 'cover:en_hersil:0', 'cover:en_hersil:1',
    ])
    expect(f.authoredLive, 'authored 段不该被每 tick 的重写算回去').toBe(2)
    f.syncFrom([])
    expect(f.list().map((o) => o.id), 'Boss 离场只收走她的柱子，墙还在').toEqual(['wall:w1', 'wall:w2'])
  })

  it('换区域：墙从 2 条缩到 0 条之后，尾巴上的盒子不许被当成圆柱复用（否则读者拿到既厚又圆的东西）', () => {
    const f = new OcclusionField()
    f.syncAuthored({ id: 'rg_a', walls: [wall('w1', 0, 0, 2, 8), wall('w2', 20, 0, 2, 8)] })
    f.syncFrom([])
    f.syncAuthored({ id: 'rg_b' }) // 下一片天没有 authored 墙
    f.syncFrom([bearing('en_hersil', [{ x: 0, y: 0, z: 0 }], 3.2, 7.5)])
    expect(f.list().map((o) => o.shape), '名册里只剩圆柱，而且它真的是圆柱').toEqual(['cylinder'])
    expect(asCyl(f.list()[0]).radius, 'radius 来自数据，不是残留 halfX 那种错值').toBe(3.2)
    const a = { x: -10, y: 5, z: 0 }
    expect(f.blocked(a, { x: 10, y: 5, z: 0 }), '旧墙不该继续吃这一线').toBe(true)
    f.syncAuthored(null)
    f.syncFrom([])
    expect(f.blocked(a, { x: 10, y: 5, z: 0 })).toBe(false)
  })

  it('同一堵墙在两条通道下各自署名：调试器要靠 id 前缀回答"挡住我的是 authored 的还是 Boss 自己带的"', () => {
    const f = new OcclusionField()
    f.syncAuthored({ id: 'rg_x', walls: [wall('en_hersil_pillar', 0, 0, 4, 4, 10)] })
    f.syncFrom([bearing('en_hersil', [{ x: 0, y: 0, z: 0 }], 2, 10)])
    const hit = f.firstBlock({ x: -10, y: 5, z: 0 }, { x: 10, y: 5, z: 0 })
    expect(hit!.occluderId, '同尺寸同位置时 authored 在前 ⇒ 名字指向关卡那一条（判据只有一条线段，重复的遮挡体不影响"挡没挡"）').toBe('wall:en_hersil_pillar')
    expect(f.authoredLive).toBe(1)
    expect(f.live, '两条通道各占一条，不会互相覆盖').toBe(2)
  })
})


/* ==================== C. 三条读者：同一个 firstBlock，三个调用点 ==================== */

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, registry.get<MovesetData>(`moveset:${sword.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999
  const dust: Vec3[] = []
  const off = bus.on('vfx.request', (p) => { if (p.key === 'ring_dust') dust.push(p.pos) })

  /**
   * 逐 tick 先跑 pin 再判定：几何腿要问的是"这条线被谁截了"，不是"AI 后来走去哪了"。
   * pin 里必须连 y 一起钉——控制器每 tick 会让她往下掉一小段，掉出柱子的 y 带之后
   * 所有"挡住了"的断言都会朝"没挡住"的方向假绿（那是最容易骗过自己的一种假绿）。
   */
  function tick(n: number, pin?: () => void): void {
    for (let i = 0; i < n; i++) {
      pin?.()
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, tick, dust, off: () => off() }
}
type W = ReturnType<typeof makeWorld>

/** 场地坐标：给一个相对柱轴的偏移，返回世界点（把所有腿都写成"相对柱子在哪"） */
const at = (dx: number, dz: number): Vec3 => ({ x: AX.x + dx, y: AX.y, z: AX.z + dz })

function hersil(w: W, at_: Vec3): Enemy {
  const e = w.ai.spawn('en_hersil', { x: at_.x, y: AX.y, z: at_.z }, 'occlusion')
  e.alertness = 100
  e.enter('combat')
  e.skipIntro()
  return e
}

const force = (e: Enemy, id: string): void => {
  const spec = e.data.attacks.find((a) => a.id === id)!
  e.attack = newAttack(spec, spec.frames.startup - 1)
}

/** 摆好两个人的位置（连 y 一起钉），返回一个可以直接塞进 tick 的 pin */
const place = (w: W, e: Enemy, bossAt: Vec3, playerAt: Vec3): (() => void) => () => {
  e.pos.x = bossAt.x; e.pos.y = AX.y; e.pos.z = bossAt.z
  w.player.pos.x = playerAt.x; w.player.pos.y = AX.y; w.player.pos.z = playerAt.z
  // floorY 在真机上是 world/Surface 按区域层给的；灰盒测试里它就是这一层的地面。
  // 不给的话她每 tick 往下掉，掉出柱子的 y 带之后所有"挡住了"都会朝"没挡住"假绿。
  w.player.floorY = AX.y; w.player.vy = 0; w.player.grounded = true
}

describe('读者一：打在玩家身上的那一记（§15.2「躲到断音柱**后面**」）', () => {
  /** Tutti：r8m 的环，从攻击者脚下量起；Boss 的 AoE 是最干净的"线段"读数 */
  const tutti = (w: W, e: Enemy, pin: () => void): void => {
    w.player.stats.hp = 500
    force(e, 'tutti')
    w.tick(3, pin)
  }

  it('玩家**没有**踩进柱子那个圆（离轴 3.6m > 半径 3.2m），但柱子确实在两人之间 ⇒ 这一记被吃掉', () => {
    const w = makeWorld()
    const e = hersil(w, at(0, -4.4))
    const pin = place(w, e, at(0, -4.4), at(0, 3.6))
    pin()
    expect(Math.hypot(w.player.pos.x - AX.x, w.player.pos.z - AX.z), '旧判据在这里会说"没躲进去"：他站在圆外')
      .toBeGreaterThan(COV.radius)
    expect(dist3(w.player.pos, e.pos), '但 r8m 的环够得到他 ⇒ 这不是"根本打不到"的假绿').toBeLessThan(8.4)
    tutti(w, e, pin)
    expect(w.player.stats.hp, '柱子在两人之间，55 伤就落在柱面上').toBe(500)
    expect(w.dust.some((p) => Math.abs(Math.hypot(p.x - AX.x, p.z - AX.z) - COV.radius) < 0.5),
      '灰尘撒在柱面上，不是撒在人身上').toBe(true)
    w.off()
  })

  it('同一个玩家、同一段距离，只是她换到柱子**旁边**起手 ⇒ 55 伤立刻落地（掩体不是无敌房）', () => {
    const w = makeWorld()
    const e = hersil(w, at(8.0, 3.6))
    const pin = place(w, e, at(8.0, 3.6), at(0, 3.6))
    pin()
    expect(dist3(w.player.pos, e.pos), '与上一条同样的 8.0m：唯一的差别是方位').toBeCloseTo(8.0, 3)
    expect(Math.hypot(w.player.pos.x - AX.x, w.player.pos.z - AX.z)).toBeGreaterThan(COV.radius)
    tutti(w, e, pin)
    expect(w.player.stats.hp, '柱面不在两人之间 ⇒ 同样的招式照样打中').toBeLessThan(500)
    w.off()
  })

  it('heightM 是承重的：把同一根柱子压到 0.2m，线段就从它头顶过去了（数据改一格，判据跟着改）', () => {
    const w = makeWorld()
    const e = hersil(w, at(0, -4.4))
    const pin = place(w, e, at(0, -4.4), at(0, 3.6))
    w.tick(1, pin)
    const a = { x: e.pos.x, y: e.pos.y + e.hitTarget().height / 2, z: e.pos.z }
    const b = { x: w.player.pos.x, y: w.player.pos.y + w.player.hitTarget().height / 2, z: w.player.pos.z }
    expect(w.combat.occlusion.list()[0].heightM, '名册里的尺寸就是数据里那一格').toBe(COV.heightM)
    expect(w.combat.occlusion.blocked(a, b), '7.5m 的柱子拦得住这条胸口高的线').toBe(true)
    const saved = COV.heightM
    try {
      COV.heightM = 0.2
      w.tick(1, pin)
      expect(w.combat.occlusion.list()[0].heightM, '名册真的每 tick 跟着数据走，不是启动时抄一次').toBe(0.2)
      expect(w.combat.occlusion.blocked(a, b), '20cm 的门槛不是掩体').toBe(false)
    } finally {
      COV.heightM = saved
    }
    w.tick(1, pin)
    expect(w.combat.occlusion.blocked(a, b), '改回去就挡得回去：这条腿读的是同一份数据').toBe(true)
    w.off()
  })
})

describe('读者二：弹体的扫掠段（§65「弹体不该穿过掩体」，而且对两边一样狠）', () => {
  /** 一枚从 `from` 飞向 `to` 的弹体：方向由两点自己算，测试里不再抄方向常数 */
  const shot = (w: W, hostile: boolean, ownerId: string, from: Vec3, to: Vec3, speed: number) => {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
    const l = Math.hypot(d.x, d.y, d.z) || 1
    return w.combat.projectiles.spawn({
      hostile, ownerId, kind: 'note', origin: { ...from },
      dir: { x: d.x / l, y: d.y / l, z: d.z / l }, speed,
      range: l * 4, radius: 0.45, damage: 12, poise: 6, hitStopMs: 70
    }, w.time.tick)
  }
  const offAxis = (p: Vec3): number => Math.hypot(p.x - AX.x, p.z - AX.z)

  it('一 tick 走 10m 的弹体可以整体跳过柱子的圆环 ⇒ 扫掠段截住它（逐 tick 采点会放它过去）', () => {
    const w = makeWorld()
    const e = hersil(w, at(0, -40))
    w.tick(1)
    const from = { x: AX.x - 3.8, y: CHEST, z: AX.z }
    const pr = shot(w, true, e.id, from, { x: AX.x + 8, y: CHEST, z: AX.z }, 600)
    expect(offAxis(from), '出生点在扩半径（柱半径+弹半径）之外').toBeGreaterThan(COV.radius + pr.radius)
    w.tick(1)
    expect(pr.dead, '两端都在柱外：只有"这一段路"能看见柱子').toBe(true)
    expect(pr.gone).toBe('wall')
    expect(offAxis(pr.pos), '停在并进弹体半径之后的那个面上').toBeCloseTo(COV.radius + pr.radius, 1)
    expect(w.dust.some((p) => Math.abs(offAxis(p) - (COV.radius + pr.radius)) < 0.2), '灰尘撒在撞击点').toBe(true)
    w.off()
  })

  it('她隔着一根柱子射我 ⇒ 这一发撞柱、玩家零伤；同一发从柱子旁边射来 ⇒ 上人（同一条判据的两个方位）', () => {
    const w = makeWorld()
    const e = hersil(w, at(0, -20))
    const me = at(0, 18)
    const chest = (p: Vec3): Vec3 => ({ ...p, y: CHEST })
    const pin = place(w, e, at(0, -20), me)
    w.tick(1, pin)
    w.player.stats.hp = 500
    const through = shot(w, true, e.id, chest(at(0, -20)), chest(me), 30)
    w.tick(120, pin)
    expect(through.gone, `路径穿过柱面 ⇒ 它到不了人（gone=${through.gone}）`).toBe('wall')
    expect(w.player.stats.hp, '所以这一下没伤到（这一百二十 tick 里她自己射的也只撞柱）').toBe(500)

    const round = shot(w, true, e.id, chest(at(14, -20)), chest(me), 30)
    w.tick(160, pin)
    expect(round.gone, '柱子让开了这条线 ⇒ 同一发照样结算').toBe('hit')
    expect(w.player.stats.hp, '并且真的疼').toBeLessThan(500)
    w.off()
  })

  it('玩家投出的长枪走同一条判据：柱子挡她的弹，也挡我的枪（不是只给 Boss 开的单边门）', () => {
    const w = makeWorld()
    const e = hersil(w, at(20, 0))
    w.tick(1)
    const hp0 = e.stats.hp
    const pr = shot(w, false, 'player', at(-12, 0), at(20, 0), 30)
    w.tick(20)
    expect(pr.gone, '我瞄着她射，但柱子先接到这一发').toBe('wall')
    expect(e.stats.hp, '所以这一下没到她身上（她也没别的原因掉血）').toBe(hp0)
    w.off()
  })
})

describe('读者三：§14.4 的 telegraph 红线（承诺要画到打得到的地方）', () => {
  const line = (w: W, e: Enemy): void => {
    const spec = e.data.attacks.find((a) => a.id === 'voiceChain')!
    expect(spec.frames.projectile?.telegraph, '这一招自己声明了红线').toBe(true)
    e.attack = newAttack(spec, 0)
  }
  const offAxis = (p: Vec3): number => Math.hypot(p.x - AX.x, p.z - AX.z)

  it('线被柱子挡住时剪在柱面上；玩家侧移一步，同一招的线重新拉长到射程', () => {
    const w = makeWorld()
    const e = hersil(w, at(0, -20))
    const pin = place(w, e, at(0, -20), at(0, 20))
    w.tick(1, pin) // 只为让 update 顶部点名一次名册
    pin(); line(w, e)
    const blocked = w.combat.telegraphs()
    expect(blocked.length, '前摇期间确实有一条线').toBeGreaterThan(0)
    expect(offAxis(blocked[0].to), '线头停在柱面上，不是画到玩家身上骗人').toBeCloseTo(COV.radius, 1)

    pin()
    w.player.pos.x = at(14, 20).x; w.player.pos.z = at(14, 20).z
    line(w, e)
    const open = w.combat.telegraphs()
    expect(open.length).toBeGreaterThan(0)
    expect(dist3(open[0].to, open[0].from), '柱子不在中间 ⇒ 线长回到射程，一寸不剪').toBeCloseTo(28, 1)
    expect(offAxis(open[0].to)).toBeGreaterThan(COV.radius + 1)
    w.off()
  })

  it('场上没有遮挡体时，红线永远画满：这条剪线不会自己咬人', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_skewer', { x: AX.x + 10, y: AX.y, z: AX.z }, 'occlusion')
    e.alertness = 100
    e.enter('combat')
    w.player.pos.x = AX.x - 10; w.player.pos.y = AX.y; w.player.pos.z = AX.z
    w.tick(1)
    expect(w.combat.occlusion.live, '针喉没有场地 ⇒ 她没有柱子').toBe(0)
    const spec = e.data.attacks.find((a) => a.frames.projectile?.telegraph)!
    e.attack = newAttack(spec, 0)
    const lines = w.combat.telegraphs()
    expect(lines.length).toBeGreaterThan(0)
    expect(dist3(lines[0].to, w.player.pos), '线终点=落点=玩家').toBeLessThan(1.5)
    w.off()
  })
})

/* ==================== D. authored 墙进三条读者：关卡几何不是装饰 ==================== */
describe('authored 墙：墙真的能挡住三条读者（KI-014②）', () => {
  /**
   * 两道灰盒墙，尺寸都是**测试自己 authored 的**（不抄区域数据，也不给区域数据背书）：
   * - `横墙`：18m 长（沿 x）、0.6m 厚、6m 高，横在两人中间——柱子帮不上忙的那种方位；
   * - `侧屏`：同样尺寸，但它是为了"谁救的我"这一格而摆到柱子前面。
   * 位置全部相对柱轴 AX 给，读起来与上面几节同一套坐标。
   */
  const lean = wall('wb_flow_lean', AX.x + 4, AX.z + 3.6, 0.6, 6, 6, AX.y)
  const inFront = wall('wb_flow_front', AX.x, AX.z - 3.8, 18, 0.6, 6, AX.y)
  /** 侧屏靠 Boss 那一面的 x（薄墙：Boss 在 +x 侧，所以近面是中心 + 半厚） */
  const LEAN_FACE = AX.x + 4 + 0.3
  /** 横墙靠玩家那一侧飞来的弹体，球心停在面外一个弹半径处 */
  const PR_R = 0.45

  const shotAt = (w: W, hostile: boolean, ownerId: string, from: Vec3, to: Vec3, speed: number) => {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
    const l = Math.hypot(d.x, d.y, d.z) || 1
    return w.combat.projectiles.spawn({
      hostile, ownerId, kind: 'note', origin: { ...from },
      dir: { x: d.x / l, y: d.y / l, z: d.z / l }, speed,
      range: l * 4, radius: PR_R, damage: 12, poise: 6, hitStopMs: 70
    }, w.time.tick)
  }

  const tuttiOn = (w: W, e: Enemy, pin: () => void): void => {
    w.player.stats.hp = 500
    force(e, 'tutti')
    w.tick(3, pin)
  }

  it('同一段 8m、同一个方位，只是中间多了一道 authored 墙 ⇒ 55 伤落在墙上（§14「躲一下再冲」的关卡腿）', () => {
    const w = makeWorld()
    // 这一组方位就是上面「掩体不是无敌房」那条：柱子帮不上忙（线离柱轴 3.6m > 半径 3.2m）
    const e = hersil(w, at(8.0, 3.6))
    const pin = place(w, e, at(8.0, 3.6), at(0, 3.6))
    w.combat.occlusion.syncAuthored({ id: 'rg_flow', walls: [lean] })
    pin(); w.tick(1, pin)
    expect(w.combat.occlusion.authoredLive, '每 tick 的 syncFrom 不许把 authored 段算回去').toBe(1)
    expect(w.combat.occlusion.live, '墙 + 她自己的四根柱子，两条通道同时在场').toBe(1 + COV.positions.length)
    const hit = w.combat.occlusion.firstBlock(
      { x: e.pos.x, y: e.pos.y + e.hitTarget().height / 2, z: e.pos.z },
      { x: w.player.pos.x, y: w.player.pos.y + w.player.hitTarget().height / 2, z: w.player.pos.z })
    expect(hit!.occluderId, '记账要能回答"是哪堵墙救了我"').toBe('wall:wb_flow_lean')
    expect(hit!.at.x, '截在靠 Boss 的那个面上').toBeCloseTo(LEAN_FACE, 6)
    tuttiOn(w, e, pin)
    expect(w.player.stats.hp, '墙在两人之间，这一记就落在墙面上').toBe(500)
    w.combat.occlusion.syncAuthored(null)
    pin(); tuttiOn(w, e, pin)
    expect(w.player.stats.hp, '把墙撤走 ⇒ 同一条线立刻上人：挡住他的是那堵墙，不是别的什么').toBeLessThan(500)
    w.off()
  })

  it('墙可以比柱子更近：谁挡的这一线由几何决定，不由"这条通道是后来才有的"决定', () => {
    const w = makeWorld()
    const e = hersil(w, at(0, -4.4))
    const pin = place(w, e, at(0, -4.4), at(0, 3.6))
    w.combat.occlusion.syncAuthored({ id: 'rg_flow', walls: [inFront] })
    pin(); w.tick(1, pin)
    const hit = w.combat.occlusion.firstBlock(
      { x: e.pos.x, y: e.pos.y + e.hitTarget().height / 2, z: e.pos.z },
      { x: w.player.pos.x, y: w.player.pos.y + w.player.hitTarget().height / 2, z: w.player.pos.z })
    expect(hit!.occluderId, '横墙的面（z=-4.1）比柱面（z=-3.2）更靠 Boss ⇒ 功劳记在墙上').toBe('wall:wb_flow_front')
    tuttiOn(w, e, pin)
    expect(w.player.stats.hp).toBe(500)
    w.off()
  })

  it('一发动在 authored 墙上的长枪：停在面外一个弹半径处，敌人零伤', () => {
    const w = makeWorld()
    // 用针喉：她没有 covers ⇒ 场上唯一的遮挡体就是那道 authored 墙，这一条绿得没有第二条解释
    const e = w.ai.spawn('en_skewer', { x: AX.x, y: AX.y, z: AX.z + 20 }, 'occlusion')
    const pin = place(w, e, at(0, 20), at(0, -9))
    w.combat.occlusion.syncAuthored({ id: 'rg_flow', walls: [inFront] })
    w.tick(1, pin)
    expect(w.combat.occlusion.authoredLive).toBe(1)
    const hp0 = e.stats.hp
    const pr = shotAt(w, false, 'player', at(0, -9), at(0, 20), 30)
    w.tick(30, pin)
    expect(pr.gone, `穿不过 authored 墙（gone=${pr.gone}）`).toBe('wall')
    expect(pr.pos.z, '球心停在进面之外一个半径处').toBeCloseTo(AX.z - 3.8 - 0.3 - PR_R, 1)
    expect(Math.abs(pr.pos.x - AX.x), '沿 x 没有漂走').toBeLessThan(0.01)
    expect(e.stats.hp, '所以这一下没到她身上').toBe(hp0)
    w.combat.occlusion.syncAuthored(null)
    const free = shotAt(w, false, 'player', at(0, -9), at(0, 20), 30)
    w.tick(30)
    expect(free.gone, '撤掉墙 ⇒ 同一发照样飞过去').not.toBe('wall')
    w.off()
  })

  it('红线剪在 authored 墙面前：玩家读到"这一发会撞在墙上"，而不是画到他背后的假承诺', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_skewer', { x: AX.x, y: AX.y, z: AX.z - 20 }, 'occlusion')
    const pin = place(w, e, at(0, -20), at(0, 18))
    w.combat.occlusion.syncAuthored({ id: 'rg_flow', walls: [inFront] })
    w.tick(1, pin)
    const spec = e.data.attacks.find((a) => a.frames.projectile?.telegraph)!
    pin(); e.attack = newAttack(spec, 0)
    const blocked = w.combat.telegraphs()
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked[0].to.z, '线头停在墙面上，不是穿到玩家身上').toBeCloseTo(AX.z - 3.8 - 0.3, 1)
    w.combat.occlusion.syncAuthored(null)
    pin(); e.attack = newAttack(spec, 0)
    const open = w.combat.telegraphs()
    // 撤掉墙之后线回到"它自己的射程尽头"（两人相距 38m，比这一招的射程远 ⇒ 落点本来就不是玩家）
    const len = Math.min(spec.frames.projectile!.range, 38)
    expect(open[0].to.z, '撤掉墙 ⇒ 线穿过墙原来那个位置，一路拉到射程尽头').toBeCloseTo(AX.z - 20 + len, 0)
    expect(open[0].to.z, '所以挡住它的确是那堵墙').toBeGreaterThan(AX.z - 3.8)
    w.off()
  })
})

describe('接线：名册每 tick 由 update 顶部重新点名（不靠调用方记得 sync）', () => {
  it('Spawn 之后不用任何显式调用，下一 tick 就认得她的柱子；despawn 之后一根都不剩', () => {
    const w = makeWorld()
    const a = { x: AX.x - 10, y: CHEST, z: AX.z }
    const b = { x: AX.x + 10, y: CHEST, z: AX.z }
    expect(w.combat.occlusion.live, '场上还没有人').toBe(0)
    expect(w.combat.occlusion.blocked(a, b)).toBe(false)
    const e = hersil(w, at(0, -40))
    w.tick(1)
    expect(w.combat.occlusion.live, '她一落地，她的四根柱子就在判据里了').toBe(COV.positions.length)
    expect(w.combat.occlusion.blocked(a, b)).toBe(true)
    w.ai.despawn(e.id)
    w.tick(1)
    expect(w.combat.occlusion.live, '她回到世界里去，她的场地跟着消失').toBe(0)
    expect(w.combat.occlusion.blocked(a, b), '否则玩家会站在一座不存在的柱子后面挨打').toBe(false)
    w.off()
  })
})

/* ==================== E. 第四个读者：敌人的视线（KI-014②b，§13.0「视锥 + 遮挡检查」的后半句） ==================== */

/**
 * 这一节的判据全是"看得见 / 看不见"的**直接读数**（alertness、lastKnown、state），不是"掉没掉血"。
 * 因为这一格要守的正是那件最割裂的事：同一堵墙把箭挡了下来，目光却没有 ⇒ 掩体成了一半真的东西。
 *
 * 视线两端口径与 `coverEatsLine` 一致（**身体中心**）：这里特意放了一块悬在头顶的盒子，
 * 如果谁把视线改成"从脚底量到脚底"，那一块就会把整片天都挡住，本节的 A/B 立刻对调。
 */
const EYE_AT = { x: AX.x, y: AX.y, z: AX.z }
/** 10m：在针喉的 vision.range(30) 里、在她 vibration.range(8) 外 ⇒ 站定时只有视觉这一条路 */
const EYE_P = { x: AX.x, y: AX.y, z: AX.z + 10 }
/** 立在两人正中间的一堵薄墙（8m 宽足以排除"从旁边看过去"这个解释） */
const EYE_WALL = wall('wb_eyes_between', AX.x, AX.z + 5, 8, 0.6, 3, AX.y)

function eyeRig(w: W, opts: { wall?: boolean; gate?: boolean; band?: 'ground' | 'sill' | 'over' } = {}) {
  const e = w.ai.spawn('en_skewer', { ...EYE_AT }, 'eyes')
  const walled = opts.wall ?? true
  // pos.y 是墙底。三档 y 带只为钉死"视线两端取身体中心"这一口径：
  // ground = 落地墙（两种量法都给"挡住"，所以它不承担判别），sill = 下沿 0.6m 的挡板
  // （胸口在带里、脚不在），over = 从 2.2m 才开始的悬空体（两者都不在带里）。
  const band = opts.band ?? 'ground'
  const baseY = band === 'sill' ? AX.y + 0.6 : band === 'over' ? AX.y + 2.2 : AX.y
  const wl = { ...EYE_WALL, pos: { x: EYE_WALL.pos.x, y: baseY, z: EYE_WALL.pos.z } }
  w.combat.occlusion.syncAuthored(walled ? { id: 'rg_eyes_probe', walls: [wl] } : null)
  if (opts.gate ?? true) w.ai.sightBlocked = (a, b) => w.combat.occlusion.blocked(a, b)
  const pin = () => {
    e.pos.x = EYE_AT.x; e.pos.y = EYE_AT.y; e.pos.z = EYE_AT.z
    e.yaw = 0 // 视锥朝 +z，玩家就在正前方：角度这一维钉死，只剩"有没有东西在中间"
    w.player.pos.x = EYE_P.x; w.player.pos.y = EYE_P.y; w.player.pos.z = EYE_P.z
    w.player.floorY = AX.y; w.player.vy = 0; w.player.grounded = true
  }
  return { e, pin }
}

describe('读者四：敌人的视线吃遮挡（§13.0 视觉列「视锥 + 遮挡检查」）', () => {
  it('夹具前提：这一格只有视觉一条路——站定、在震动半径之外、视野正中', () => {
    const w = makeWorld()
    const sk = registry.get<EnemyData>('en_skewer').ai
    expect(sk.vision.range, '10m 必须落在她的视觉锥里').toBeGreaterThan(10)
    expect(sk.vibration.range, '而 10m 必须在她的震动感知之外（否则看不见也会因移动被发现）').toBeLessThan(10)
    w.off()
  })

  it('没有墙：站定也看得见，警觉按 10Hz 往上爬', () => {
    const w = makeWorld()
    const { e, pin } = eyeRig(w, { wall: false })
    w.tick(13, pin)
    expect(e.alertness, '视锥里明摆站着个人 ⇒ 看见').toBeGreaterThan(0)
    expect(e.lastKnown.z, '最后已知位置 = 玩家站位').toBeCloseTo(EYE_P.z, 6)
    w.off()
  })

  it('同一位置、中间立一堵 authored 墙：视觉整条不成立，警觉一格不涨', () => {
    const w = makeWorld()
    const { e, pin } = eyeRig(w)
    expect(w.combat.occlusion.blocked(
      { x: EYE_AT.x, y: AX.y + 0.8, z: EYE_AT.z },
      { x: EYE_P.x, y: AX.y + 0.85, z: EYE_P.z },
    ), '几何腿先自证：这一线真的被那堵墙截了').toBe(true)
    w.tick(13, pin)
    expect(e.alertness, '墙挡住了箭，就该同样挡住目光').toBe(0)
    expect(e.lastKnown, '没看见就不许把玩家的站位记进去').toEqual({ ...EYE_AT }) // 还是出生点那一份
    expect(e.state, '更不会进 chase').toBe('idle')
    w.off()
  })

  it('撤掉那一堵墙 ⇒ 立刻恢复看见（证明上一条的答案来自那堵墙，不是闸门本身）', () => {
    const w = makeWorld()
    const { e, pin } = eyeRig(w)
    w.tick(13, pin)
    expect(e.alertness).toBe(0)
    w.combat.occlusion.syncAuthored({ id: 'rg_eyes_probe', walls: [] })
    w.tick(13, pin)
    expect(e.alertness, '同一个人、同一个闸门，只少了那堵墙 ⇒ 又看见了').toBeGreaterThan(0)
    w.off()
  })

  it('视线的两端是**身体中心**：一块下沿 0.6m 的挡板卡在胸口高 ⇒ 挡住（从脚底量就会假绿）', () => {
    const w = makeWorld()
    const { e, pin } = eyeRig(w, { band: 'sill' })
    w.tick(13, pin)
    expect(e.alertness, '胸口高那条线确实穿过了它 ⇒ 看不见；而贴地那条线从它下面钻得过去').toBe(0)
    w.off()
  })

  it('同一块挡板整体上移到头顶 2.2m 以上 ⇒ 不挡视线：两个站着的人照样对眼', () => {
    const w = makeWorld()
    const { e, pin } = eyeRig(w, { band: 'over' })
    w.tick(13, pin)
    expect(e.alertness, 'y 带不含身体中心 ⇒ 遮挡不成立').toBeGreaterThan(0)
    w.off()
  })

  it('敌人的身体不是遮挡体：名册里只有墙与柱，另一具身体站在中间不挡目光', () => {
    const w = makeWorld()
    const { e, pin } = eyeRig(w, { wall: false })
    // 正中间塞第二个人：她的位置恰好落在那条视线上
    const mid = w.ai.spawn('en_skewer', { x: AX.x, y: AX.y, z: AX.z + 5 }, 'eyes-mid')
    w.tick(13, pin)
    expect(w.ai.enemies.length, '夹具前提：场上确实有两个人站在视线上').toBe(2)
    expect(mid.alive).toBe(true)
    expect(w.combat.occlusion.live, '两具身体都没进名册 ⇒ 名册里只有被数据点名的遮挡体').toBe(0)
    expect(e.alertness, '所以视线仍然通').toBeGreaterThan(0)
    w.off()
  })

  it('没接闸门 = 全场照旧看不见墙：这一格的全部开关就是组合根那一行', () => {
    const w = makeWorld()
    const { e, pin } = eyeRig(w, { gate: false }) // 墙在中间，但 sightBlocked 仍是 null
    w.tick(13, pin)
    expect(e.alertness, '默认口径（既有全部测试与没有几何体的野外）不变').toBeGreaterThan(0)
    w.off()
  })

  it('目击报警（§13.0「目击者 +100 瞬间报警」）：那一记发生在墙后面就不算看见', () => {
    const w = makeWorld()
    const { e } = eyeRig(w)
    const gate = (a: Vec3, b: Vec3) => w.combat.occlusion.blocked(a, b)
    e.sawImpact({ ...EYE_P }, 1.7, gate)
    expect(e.alertness, '隔着墙听见金属相交 ≠ 目击').toBe(0)
    expect(e.state).toBe('idle')
    w.combat.occlusion.syncAuthored(null)
    e.sawImpact({ ...EYE_P }, 1.7, gate)
    expect(e.alertness, '撤了墙，同一次弹反立刻是目击：+100').toBe(100)
    expect(e.state, '并且瞬间进 chase').toBe('chase')
    w.off()
  })

  it('交战中的敌人：隔墙目击不把最后已知位置拽到墙后（那一支由 hear 负责，它给的是声音）', () => {
    const w = makeWorld()
    const { e } = eyeRig(w)
    e.enter('chase')
    const gate = (a: Vec3, b: Vec3) => w.combat.occlusion.blocked(a, b)
    const before = { ...e.lastKnown }
    e.sawImpact({ ...EYE_P }, 1.7, gate)
    expect(e.lastKnown, '墙后面那一声不该成为"我看见他在那儿"').toEqual(before)
    w.combat.occlusion.syncAuthored(null)
    e.sawImpact({ ...EYE_P }, 1.7, gate)
    expect(e.lastKnown.z, '看得见才更新').toBeCloseTo(EYE_P.z, 6)
    w.off()
  })
})

describe('接线：第四个读者挂在组合根上（不靠测试自己记得注入）', () => {
  it('main.ts 把 AI 的视线闸门接到 combat 的那份名册，且只接这一处', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8')
      .split(/\r?\n/)
    const wired = src.filter((l) => l.includes('sightBlocked'))
    expect(wired.length, '视线闸门在组合根里恰好一处赋值').toBe(1)
    expect(wired[0], '必须复用 combat.occlusion 那一份名册，而不是另算一套几何').toMatch(/combat\.occlusion\.blocked/)
    expect(wired[0].trim().startsWith('//'), '那一行是代码不是注释').toBe(false)
  })
})
