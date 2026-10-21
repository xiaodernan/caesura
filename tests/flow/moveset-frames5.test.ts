import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { bus } from '@/core/EventBus'

/**
 * KI-267：**§4.2–§4.6 那几张 Moveset 表剩下的行**（其余四把武器的连段那几行 ＋ 杖的 L1–L4 ＋ 弓的近身轻击）
 * 第一次在真链上被量（KI-261 量了 L1 与重击 H、KI-263 量了跑动／跳跃／速射 L、KI-265 量了直剑的连段与弓的三行）。
 *
 * **口径沿用 KI-265 立起来的那一套**：
 * ① **连段那一层只数「内部帧」**（内部拍号由停顿账本给：命中之后按住四拍，再双格补拍还债 ⇒ 内部帧 ≠ 墙钟）；
 * ② **打连段前先把那只怪的架势值拉高**（否则连段会把它打崩 ⇒ 伤害吃上破势那一档 ×1.5 ⇒ 底数读不出来）；
 * ③ **弓是抛射** ⇒ 它的帧列要读**箭离手那一刻的内部帧**（`Projectile.bornTick`），不是命中那一刻。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

function makeWorld(weaponId: string) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const hits: any[] = []
  const off = bus.on('combat.hit', (p: any) => hits.push({ ...p }))
  const pins: Array<() => void> = []
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      for (const pin of pins) pin()
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, off, pins, weapon }
}

type World = ReturnType<typeof makeWorld>

/** 一只挨打的怪：站位每拍钉回；血量与**架势值**都拉高（连段会把它打崩 ⇒ 伤害吃上 ×1.5） */
function dummy(w: World, z = -1.6) {
  const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z }, 'probe')
  e.alertness = 0
  e.enter('idle')
  e.stats.hpMax = 999999
  e.stats.hp = 999999
  e.stats.poiseMax = 999999
  const p = w.player
  p.pos = { x: 0, y: 0, z: 0 }
  p.yaw = Math.PI
  p.camYawRef = Math.PI + p.yaw
  for (const k of Object.keys(p.rpg.attrs)) (p.rpg.attrs as any)[k] = 0
  w.pins.push(() => {
    e.pos.x = 0
    e.pos.y = 0
    e.pos.z = z
    e.yaw = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z)
    // **量具纪律：挨打的那只怪必须是「被动」的** —— 它一挨打就进 combat 状态，
    // 0–1.9m 又是它的近战band ⇒ 它会反打玩家 ⇒ 玩家的招式被受击反应打断 ⇒
    // 读到的是「被打断」而不是招式表给的那一帧（大剑 L2 就栽在这里：读到第 26 帧就断了）。
    // 所以每拍把它的状态按回 idle 并清掉招式 ⇒ 它只挨打，不还手。
    if (e.state !== 'idle') e.enter('idle')
    e.attack = null
  })
  return e
}

interface StageRec {
  key: string
  startAt: number
  maxAt: number
  hits: Array<{ at: number; damage: number }>
}

/** 把连段一路按下去：每一段在「内部帧 ≥ 它自己的 activeStart」时排一次队 */
function driveChain(w: World, maxTicks = 460): StageRec[] {
  const p = w.player
  const stages: StageRec[] = []
  let lastKey = ''
  let prevHits = 0
  for (let i = 0; i < maxTicks; i++) {
    const key = p.action?.key ?? 'null'
    const f = p.action?.f
    let press = false
    if (key === 'null') press = true
    else if (key !== lastKey && f && p.action!.tick >= f.activeStart) { press = true; lastKey = key }
    if (press) w.frame.edges.add('attackLight')
    w.tick()
    if (press) w.frame.edges.delete('attackLight')
    const curKey = p.action?.key ?? 'null'
    const curAt = p.action?.tick ?? -1
    let stage = stages[stages.length - 1]
    if (!stage || stage.key !== curKey) {
      stage = { key: curKey, startAt: curAt, maxAt: curAt, hits: [] }
      stages.push(stage)
    }
    if (curAt > stage.maxAt) stage.maxAt = curAt
    for (let h = prevHits; h < w.hits.length; h++) stage.hits.push({ at: curAt, damage: w.hits[h].damage })
    prevHits = w.hits.length
  }
  return stages
}

/** 伤害那一格：底数小的取整吃不掉噪声 ⇒ 精确值；底数大的用 ±5% 的带 */
function expectBase(dmg: number, base: number, what: string): void {
  if (base <= 9) {
    expect(dmg, `${what}（底数 ${base} 小到取整吃不掉噪声 ⇒ 精确值）`).toBe(base)
  } else {
    expect(dmg, `${what}（底数 ${base} × ±5% 的随机项那一档）`).toBeGreaterThanOrEqual(Math.floor(base * 0.95))
    expect(dmg, `${what}（……也在那一档的上沿之内）`).toBeLessThanOrEqual(Math.ceil(base * 1.05))
  }
}

/** 连段里某一段：命中落在**它自己的第几帧** ＋ 伤害 ＋ 那一式的最后一帧 */
function expectStage(stages: StageRec[], key: string, frame: number, base: number, last: number, what: string): void {
  const st = stages.find((s) => s.key === key)
  expect(st, `${what}：那一段（\`${key}\`）出现了`).toBeTruthy()
  expect(st!.hits.length, `${what}：那一段命中了`).toBeGreaterThan(0)
  expect(st!.hits[0].at, `${what}：命中落在**它自己的第 ${frame} 帧**`).toBe(frame)
  expectBase(st!.hits[0].damage, base, `${what}：那一记的伤害`)
  expect(st!.maxAt, `${what}：那一式走到的最后一帧（设计整段 ${last + 1}f ⇒ 最后一拍 ${last}）`).toBe(last)
}

describe('KI-267 §4.2–§4.6 那几张 Moveset 表剩下的行：大剑／枪／静默针／杖 的连段 ＋ 弓的近身轻击', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **大剑**的连段：L2 落在**它自己的第 24 帧**（设计 400ms/24f）、L3 落在**第 30 帧**（设计 500ms/30f），伤害 21／34 ⇒ 逐字对上', () => {
    const w = makeWorld('wp_fortissimo_greatsword')
    const e = dummy(w)
    const stages = driveChain(w, 320)
    expectStage(stages, 'l2', 24, 21, 58, '大剑 L2')
    expectStage(stages, 'l3', 30, 34, 71, '大剑 L3（尾段）')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **枪**的连段四段：L2 **14** 帧／L3 **15** 帧／L4 **16** 帧／L5 **21** 帧（设计 233ms/14f、250ms/15f、267ms/16f、350ms/21f），伤害 12／13／15／20 ⇒ 逐字对上', () => {
    const w = makeWorld('wp_drawpin_spear')
    const e = dummy(w)
    const stages = driveChain(w, 460)
    expectStage(stages, 'l2', 14, 12, 34, '枪 L2')
    expectStage(stages, 'l3', 15, 13, 37, '枪 L3')
    expectStage(stages, 'l4', 16, 15, 39, '枪 L4')
    expectStage(stages, 'l5', 21, 20, 54, '枪 L5（尾段）')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿③ **静默针**的连段四段：L2 **10** 帧／L3 **11** 帧／L4 **12** 帧／L5 **16** 帧（设计 167ms/10f、183ms/11f、200ms/12f、267ms/16f），伤害 7／8／9／15 ⇒ 逐字对上', () => {
    const w = makeWorld('wp_needlesilence')
    const e = dummy(w)
    const stages = driveChain(w, 420)
    expectStage(stages, 'l2', 10, 7, 26, '静默针 L2')
    expectStage(stages, 'l3', 11, 8, 28, '静默针 L3')
    expectStage(stages, 'l4', 12, 9, 31, '静默针 L4')
    expectStage(stages, 'l5', 16, 15, 45, '静默针 L5（尾段）')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ **杖**的 L1–L4 四段：命中分别落在**它们自己的第 13／12／12／17 帧**（设计 220/200/200/283ms ＝ 13/12/12/17f），伤害 7／7／8／10 ⇒ 逐字对上', () => {
    const w = makeWorld('wp_tuningfork_staff')
    const e = dummy(w)
    const stages = driveChain(w, 360)
    expectStage(stages, 'l1', 13, 7, 31, '杖 L1')
    expectStage(stages, 'l2', 12, 7, 30, '杖 L2')
    expectStage(stages, 'l3', 12, 8, 31, '杖 L3')
    expectStage(stages, 'l4', 17, 10, 43, '杖 L4（尾段）')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑤ 弓的**近身轻击**那一行（它是弓那一把的第二段）：命中落在**它自己的第 12 帧**（设计 200ms/12f）、伤害 6 ⇒ 逐字对上', () => {
    const w = makeWorld('wp_overtone_bow')
    const e = dummy(w)
    const stages = driveChain(w, 160)
    expectStage(stages, 'l2', 12, 6, 29, '弓 近身轻击')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })
})
