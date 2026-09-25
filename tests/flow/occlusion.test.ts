import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, Vec3, WeaponData } from '@/data/schema'
import { firstBlock, OcclusionField, type Occluder } from '@/core/Occlusion'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'

/**
 * 世界遮挡流程测试（KI-014①，需求 §15.2「躲入断音柱后」+ §65「弹体不该穿过掩体」）。
 *
 * 这一批要守住的不是"柱子有没有用"（`mainboss.test.ts` 已经管过那一格），而是
 * **遮挡第一次变成一条真的线段**：`core/Occlusion` 的那一个 `firstBlock` 被三个读者共用
 * （弹体的扫掠段、打在玩家身上的那一记、§14.4 的红线），于是三条腿必须同生同死。
 * 所以这里的判据全是几何量（"截在哪一点""离柱轴多少米"），不是"掉没掉血"那种间接读数——
 * 掉血只能证明某一格 if 生效，证明不了三个人读的是同一把尺子。
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
  ({ id, pos: { x, y: baseY, z }, radius, heightM })

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

/* ==================== B. 名册：遮挡体跟着实体生灭 ==================== */

describe('遮挡名册 syncFrom：条目就地改写，尺寸来自数据', () => {
  const bearing = (id: string, positions: Vec3[], radius: number, heightM: number) =>
    ({ id, data: { boss: { covers: { positions, radius, heightM } } } })

  it('一具实体两根柱 ⇒ 两条名册，id 带"哪一具的第几根"，尺寸原样从数据来', () => {
    const f = new OcclusionField()
    f.syncFrom([bearing('en_hersil', [{ x: 1, y: 0, z: 2 }, { x: 3, y: 0, z: 4 }], 3.2, 7.5)])
    expect(f.live).toBe(2)
    expect(f.list().map((o) => o.id)).toEqual(['cover:en_hersil:0', 'cover:en_hersil:1'])
    expect(f.list()[0].radius, '半径不是代码里的常数').toBe(3.2)
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
