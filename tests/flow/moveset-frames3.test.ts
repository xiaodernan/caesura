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
 * KI-265：**§4.1–§4.6 那六张 Moveset 表的连段那几行（L2…L4）＋ 弓的满弓／破鸣箭／跳跃射击**
 * 第一次在真链上被量（KI-261 量了 L1 与重击 H、KI-263 量了跑动／跳跃／速射 L）。
 *
 * **这一批先要把口径立住：连段那一层的拍数只能数「内部帧」，不能数墙钟。**
 * 内部的拍号由**停顿账本**给（`advanceActionFrames`）：命中那一拍之后账本把内部拍号**按住**
 * （`adv = 0`）几拍，随后**双格补拍**（`adv = 2`）还债 ⇒ ⇒ **内部帧号 ≠ 墙钟**。
 * ⇒ 设计的帧表记的是内部帧 ⇒ 腿钉的也是内部帧；墙钟只用来钉「下一式在第几拍接上」。
 *
 * **连段的机制（在真链上量出来的，不是读表）**：
 * - 下一式**不是**在上一式的判定窗末接上，而是在**上一式整段走完（内部帧 ＝ `f.recovery`）**才接上；
 * - 排队的那一下必须落在**内部帧 ≥ 那一式的 `activeStart`**（早一拍按下去会被丢掉）；
 * - 每一段只能被排一次队（`comboQueued` 会被消费掉）。
 *
 * **量具上的两条纪律（这一批自己撞出来的）**：
 * ① **打连段会把怪打崩**（架势累积 ≥ 怪自己的架势值 ⇒ 进入破势大踉跄）⇒ **破势中的怪身上伤害 ×1.5** ⇒
 *    ⇒ 想读招式表给的那个底数，**必须先把那只怪的架势值拉高**（否则读到的是 ×1.5 那一档）；
 * ② **弹体那一把（弓）**：它的帧列要读**箭离手的那一刻的内部帧**（`Projectile.bornTick`），不是命中那一刻。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

function makeWorld(weaponId = 'wp_tuning_sword') {
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

/**
 * 一只挨打的怪：站位每拍钉回（它 idle 也会自己走过来）；血量拉满；
 * **架势值拉高**（否则连段第 2、3 记就会把它打崩 ⇒ 伤害吃上破势那一档 ×1.5 ⇒ 底数就读不出来）。
 */
function dummy(w: World, z = -1.6, poiseHigh = true) {
  const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z }, 'probe')
  e.alertness = 0
  e.enter('idle')
  e.stats.hpMax = 999999
  e.stats.hp = 999999
  if (poiseHigh) e.stats.poiseMax = 999999
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
  })
  return e
}

interface StageRec {
  key: string
  startAt: number
  startWc: number
  maxAt: number
  hits: Array<{ at: number; damage: number; wc: number; crumpled: boolean }>
}

/** 把连段一路按下去：每一段在「内部帧 ≥ 它自己的 activeStart」时排一次队 */
function driveChain(w: World, e: any, maxTicks = 260): StageRec[] {
  const p = w.player
  const start = w.time.tick + 1
  const stages: StageRec[] = []
  let lastKey = ''
  let prevHits = 0
  for (let i = 0; i < maxTicks; i++) {
    const key = p.action?.key ?? 'null'
    const f = p.action?.f
    let press = false
    if (key === 'null') press = true
    else if (key !== lastKey && f && p.action!.tick >= f.activeStart) { press = true; lastKey = key }
    const crumpledBefore = e.stats.crumpleTicksLeft > 0 // 这一拍结算之前那只怪是不是已经破势了
    if (press) w.frame.edges.add('attackLight')
    w.tick()
    if (press) w.frame.edges.delete('attackLight')
    const wc = w.time.tick - start + 1
    const curKey = p.action?.key ?? 'null'
    const curAt = p.action?.tick ?? -1
    let stage = stages[stages.length - 1]
    if (!stage || stage.key !== curKey) {
      stage = { key: curKey, startAt: curAt, startWc: wc, maxAt: curAt, hits: [] }
      stages.push(stage)
    }
    if (curAt > stage.maxAt) stage.maxAt = curAt
    for (let h = prevHits; h < w.hits.length; h++) {
      stage.hits.push({ at: curAt, damage: w.hits[h].damage, wc, crumpled: crumpledBefore })
    }
    prevHits = w.hits.length
  }
  return stages
}

/** 两根弹体之间的**水平**夹角（度）：分叉那一格记的是偏航，不是空间角 */
function yawGapDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const ya = (Math.atan2(a.x, a.z) * 180) / Math.PI
  const yb = (Math.atan2(b.x, b.z) * 180) / Math.PI
  let d = ya - yb
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return Math.abs(d)
}

describe('KI-265 §4.x 连段那几行（L2…L4）＋ 破势那一档 ＋ 弓的满弓／破鸣箭／跳跃射击', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 连段的**第二段 L2**：下一式在**上一式整段走完**（内部帧 ＝ 30）才接上，L2 的命中落在**它自己的第 11 帧**（设计 L2 ＝ 183ms/11f）、伤害 9 ⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const stages = driveChain(w, e)
    const l1 = stages.find((s) => s.key === 'l1')
    const l2 = stages.find((s) => s.key === 'l2')
    expect(l1, '第一段的键是 `l1`').toBeTruthy()
    expect(l2, '第二段的键是 `l2`（连段接上了）').toBeTruthy()
    expect(l1!.maxAt, '**L1 整段走到的最后一拍** ＝ 29（设计 L1 ＝ 12＋6＋12 ＝ 30f ⇒ 手在第 30 拍又能动）').toBe(29)
    expect(l2!.startAt, '**L2 接上那一拍的内部帧** ＝ 0（它是在上一式的**整段**走完那一刻起算的，不是判定窗末）').toBe(0)
    expect(l2!.hits.length, 'L2 那一记命中了').toBeGreaterThan(0)
    expect(l2!.hits[0].at, '**L2 命中落在它自己的第 11 帧**（设计 L2 ＝ 183ms/11f）⇒ 逐字对上').toBe(11)
    expect(l2!.hits[0].damage, 'L2 那一记的伤害（设计 L2 的伤害格 ＝ 9）').toBe(9)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② 连段的**第三段 L3**：L3 的命中落在**它自己的第 13 帧**（设计 L3 ＝ 217ms/13f）、伤害 12 ⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const stages = driveChain(w, e)
    const l3 = stages.find((s) => s.key === 'l3')
    expect(l3, '第三段的键是 `l3`').toBeTruthy()
    expect(l3!.hits.length, 'L3 的那一记命中了').toBeGreaterThan(0)
    expect(l3!.hits[0].at, '**L3 命中落在它自己的第 13 帧**（设计 L3 ＝ 217ms/13f）⇒ 逐字对上').toBe(13)
    expect(l3!.hits[0].damage, 'L3 那一记的伤害（设计 L3 的伤害格 ＝ 12）').toBe(12)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿③ 连段的**尾段 L4**：L4 的命中落在**它自己的第 15 帧**（设计 L4 ＝ 250ms/15f）、伤害 18、整段走到**第 45 帧**（设计 15＋9＋21 ＝ 45f）⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const stages = driveChain(w, e, 300)
    const l4 = stages.find((s) => s.key === 'l4')
    expect(l4, '第四段的键是 `l4`（连段走到尾段）').toBeTruthy()
    expect(l4!.hits.length, 'L4 的那一记命中了').toBeGreaterThan(0)
    expect(l4!.hits[0].at, '**L4 命中落在它自己的第 15 帧**（设计 L4 ＝ 250ms/15f）⇒ 逐字对上').toBe(15)
    expect(l4!.hits[0].damage, 'L4 那一记的伤害（设计 L4 的伤害格 ＝ 18）').toBe(18)
    expect(l4!.maxAt, 'L4 整段走到的**最后一拍**（设计 15＋9＋21 ＝ 45f ⇒ 手在第 45 拍又能动）').toBe(44)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ **内部帧 ≠ 墙钟**：命中那一拍之后停顿账本把内部帧**按住**几拍、随后**双格补拍**还债 ⇒ 连段那一层的帧表只能数内部帧 ⇒ 登记', () => {
    const w = makeWorld()
    const e = dummy(w)
    const p = w.player
    const start = w.time.tick + 1
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
    const holds: number[] = []
    const doubles: number[] = []
    let last = -1
    for (let i = 0; i < 80; i++) {
      const before = p.action?.tick ?? -1
      w.tick()
      const after = p.action?.tick ?? -1
      if (before < 0 || after < 0) continue
      const d = after - before
      if (d === 0) holds.push(w.time.tick - start + 1)
      else if (d === 2) doubles.push(w.time.tick - start + 1)
      last = after
    }
    expect(holds.length, '**停顿账本把内部帧按住了几拍**（命中那一记的 hitstop ＝ 60ms ⇒ 四拍）').toBeGreaterThanOrEqual(3)
    expect(doubles.length, '**随后用双格补拍把债还了**（`adv = 2`）⇒ 墙钟那一段是「停—冲—停」').toBeGreaterThanOrEqual(2)
    expect(last, '（这一行只是把量具跑完的见证：内部帧最后走到了这里）').toBeGreaterThan(0)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑤ **破势中的怪身上伤害 ×1.5**：同一套连段，怪的架势值是默认值时 L3 ＝ **18**（＝12×1.5）、L4 ＝ **27**（＝18×1.5）⇒ **设计 §7/§8 那一族里没有这一格** ⇒ 登记', () => {
    const w = makeWorld()
    const e = dummy(w, -1.6, false) // **不**把架势值拉高 ⇒ 怪会被连段打崩
    const stages = driveChain(w, e, 300)
    const l2 = stages.find((s) => s.key === 'l2')
    const l3 = stages.find((s) => s.key === 'l3')
    const l4 = stages.find((s) => s.key === 'l4')
    expect(l2!.hits.length, 'L2 那一记命中了').toBeGreaterThan(0)
    expect(l2!.hits[0].damage, 'L2 那一记的伤害（**这一记结算时还没崩** ⇒ 底数 9）').toBe(9)
    expect(l2!.hits[0].crumpled, '前提：L2 那一记结算时那只怪**还没进破势**').toBe(false)
    expect(l3!.hits[0].crumpled, '**L3 那一记结算时那只怪已经破势了**（架势累积 ≥ 怪自己的架势值 20 ⇒ 进入破势大踉跄）').toBe(true)
    expect(l3!.hits[0].damage, 'L3 那一记的伤害（**破势中** ⇒ 12 × 1.5 ＝ 18）').toBe(18)
    expect(l4!.hits[0].damage, 'L4 那一记的伤害（**破势中** ⇒ 18 × 1.5 ＝ 27）').toBe(27)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑥ 弓的**满弓（轻蓄）**那一行：蓄满阈值 **48 拍（800ms）**、**三枝**（主箭 ＋ 两枝分叉）**每拍一枝**、分叉各 **12°**、伤害 **18（主）＋ 60%/枝**、整段 **53** 帧（设计 §4.4 的注记：20＋6＋27 ＝ 53）⇒ 逐字对上', () => {
    const w = makeWorld('wp_overtone_bow')
    dummy(w)
    const p = w.player
    const start = w.time.tick + 1
    w.frame.held.add('attackHeavy')
    w.tick(48)
    w.frame.held.delete('attackHeavy')
    w.tick()
    expect(p.action?.key, '按住 48 拍松手 ⇒ 满弓那一式（阈值 48 拍 ＝ 800ms ＝ 设计「蓄 800ms/48f」）').toBe('charged')
    const born: number[] = []
    const bornAt: number[] = []
    const dirs: Array<{ x: number; y: number; z: number }> = []
    const dmgs: number[] = []
    let maxAt = 0
    for (let i = 0; i < 200; i++) {
      w.tick()
      if (p.action) maxAt = Math.max(maxAt, p.action.tick)
      for (const pr of w.combat.projectiles.list()) {
        const t = pr.bornTick - start + 1
        if (!born.includes(t)) {
          born.push(t)
          bornAt.push(p.action?.tick ?? -1)
          dirs.push({ ...pr.vel })
          dmgs.push(pr.damage)
        }
      }
      if (!p.action && born.length >= 3 && i > 20) break
    }
    expect(born.length, '**这一式打出去三枝**（设计「泛音分叉 2 枝」＝ 主箭 ＋ 两枝分叉 ⇒ 加上主箭一共三枝）').toBe(3)
    expect(born[1] - born[0], '**每拍一枝**（burst 的 everyTicks ＝ 1）').toBe(1)
    expect(born[2] - born[1], '……还是每拍一枝').toBe(1)
    expect(bornAt[0], '**第一枝离手时那一式的内部帧**（设计「拉弓」＝ 蓄 48f 之后那一式的起手 20f）').toBe(20)
    const mainIdx = 1
    expect(dmgs[mainIdx], '**主箭的伤害**（设计「18（主）」）').toBe(18)
    expect(dmgs[0], '**一支分叉的伤害**（设计「60%/枝」⇒ 18 × 0.6）').toBeCloseTo(10.8, 5)
    expect(dmgs[2], '……另一支分叉也一样').toBeCloseTo(10.8, 5)
    expect(yawGapDeg(dirs[mainIdx], dirs[0]), '**分叉与主箭之间的水平夹角**（设计「12°」）').toBeCloseTo(12, 1)
    expect(yawGapDeg(dirs[mainIdx], dirs[2]), '……另一支分叉也是 12°').toBeCloseTo(12, 1)
    expect(maxAt, '那一式整段走到的**最后一拍**（设计 §4.4 注记：20＋6＋27 ＝ 53f）').toBe(52)
    alive.push(w.off)
  })

  it('腿⑦ 弓的**重击 H 破鸣箭**与**跳跃射击**那两行：破鸣箭的箭在**第 36 帧**离手（设计 600ms/36f）、整段 **72** 帧（36＋0＋36）、震裂 **2** 层；跳跃射击的箭在**第 12 帧**离手（设计「空中 200ms」）、整段 **30** 帧（12＋0＋18）⇒ 逐字对上', () => {
    // 破鸣箭：按住重击键（< 8 拍）松手 ⇒ 重击那一式
    const w = makeWorld('wp_overtone_bow')
    const e = dummy(w)
    const p = w.player
    w.frame.held.add('attackHeavy')
    w.tick(5)
    w.frame.held.delete('attackHeavy')
    w.tick()
    expect(p.action?.key, '按住 5 拍松手 ⇒ 重击那一式').toBe('h')
    let bornAt = -1
    let maxAt = 0
    for (let i = 0; i < 200; i++) {
      w.tick()
      if (p.action) maxAt = Math.max(maxAt, p.action.tick)
      const pr = w.combat.projectiles.list()[0]
      if (bornAt < 0 && pr) bornAt = p.action?.tick ?? -1
      if (!p.action && i > 20) break
    }
    expect(bornAt, '**破鸣箭离手时那一式的内部帧**（设计 600ms/36f）').toBe(36)
    expect(maxAt, '那一式整段走到的**最后一拍**（设计 36＋0＋36 ＝ 72f）').toBe(71)
    expect(e.stats.fissureLayers, '**震裂层数**（设计「震裂×2」⇒ 2 层）').toBe(2)
    w.ai.despawn(e.id)
    w.off()

    // 跳跃射击：空中出手
    const b = makeWorld('wp_overtone_bow')
    dummy(b)
    const bp = b.player
    b.frame.edges.add('jump')
    b.tick()
    b.frame.edges.delete('jump')
    for (let i = 0; i < 60 && bp.grounded; i++) b.tick()
    b.frame.edges.add('attackLight')
    b.tick()
    b.frame.edges.delete('attackLight')
    expect(bp.action?.key, '空中出手 ⇒ 跳跃射击那一式').toBe('jump')
    let bbornAt = -1
    let bmaxAt = 0
    for (let i = 0; i < 200; i++) {
      b.tick()
      if (bp.action) bmaxAt = Math.max(bmaxAt, bp.action.tick)
      const pr = b.combat.projectiles.list()[0]
      if (bbornAt < 0 && pr) bbornAt = bp.action?.tick ?? -1
      if (!bp.action && i > 20) break
    }
    expect(bbornAt, '**空中那一箭离手时那一式的内部帧**（设计「空中 200ms」＝ 12f）').toBe(12)
    expect(bmaxAt, '那一式整段走到的**最后一拍**（设计 §4.4 注记：12＋0＋18 ＝ 30f）').toBe(29)
    alive.push(b.off)
  })
})
