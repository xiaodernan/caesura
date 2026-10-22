import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { armCrumple } from '@/combat/Reactions'
import { EntityStats } from '@/combat/EntityStats'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-283：**§7「架势/破势系统」那一族剩下的几格 ＋ §8 的 R5 那一行**第一次在真链上被量
 * （combat.md §7 的五行／§8 的 R0–R5）。
 *
 * **这一批量的五样东西**：
 * ① **累积**（命中附带该招式的架势值）；
 * ② **攻击前摇期间受击 = 架势伤害 ×1.5**（反冲锋/惩罚贪刀核心）；
 * ③ **衰减**（未再受击 1.2s 后 12/s 向零）；
 * ④ **破势**（累积 ≥ 架势值 ⇒ 1.8s ＝ Boss 2.4s ＋ 架势归零）；
 * ⑤ **§8 的 R5「浮空」那一行**（滞空 0.5s ＋ 落地恢复 0.4s ＋ 落地前二次受击 ×0.8）。
 *
 * **三条量具纪律**：
 * ① **要读怪身上的 `poiseAccum`**（不是看它倒不倒）：那一格是「累积了多少」；
 * ② **前摇那一格要两个世界逐拍对齐**（同一个种子 ⇒ 同一个「打点上」因子 ⇒ 两读数之比就是那一个乘数）；
 * ③ **挨打的那只怪要钉成被动**（KI-267 立的规矩：它一挨打就进 combat 状态反打 ⇒ 玩家的招式被打断）。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>('moveset:ms_sword'))
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout())
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k),
  }, (p: Vec3) => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) })
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
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, hits, off, pins }
}

type World = ReturnType<typeof makeWorld>

/** 一只挨打的怪：站位每拍钉回、状态按回 idle、出手按回 null（它一挨打就进 combat 状态反打） */
function dummy(w: World, id: 'en_murkshell' | 'en_tympanus', z = -1.2) {
  const e = w.ai.spawn(id, { x: 0, y: 0, z }, 'probe')
  e.alertness = 0
  e.enter('idle')
  w.player.pos = { x: 0, y: 0, z: 0 }
  w.player.yaw = Math.PI
  w.pins.push(() => {
    e.pos.x = 0
    e.pos.z = z
    if (e.state !== 'idle') e.enter('idle')
    e.attack = null
  })
  return e
}

/** 出一记轻击并读怪身上的架势累积 */
function lightPoise(w: World, e: ReturnType<World['ai']['spawn']>): number {
  const before = e.stats.poiseAccum
  w.frame.edges.add('attackLight')
  w.tick(20)
  w.frame.edges.delete('attackLight')
  return e.stats.poiseAccum - before
}

describe('KI-283 §7 架势/破势 ＋ §8 的 R5 那一行', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **累积那一格**：命中附带该招式的架势值 ⇒ 调律剑的轻击 **+6**、重击 **+24**（设计「命中附带该招式的架势值」）', () => {
    const a = makeWorld()
    const ea = dummy(a, 'en_tympanus')
    a.tick(3)
    const light = lightPoise(a, ea)
    expect(light, '**一记轻击给怪累积 6 点架势**').toBe(6)
    const b = makeWorld()
    const eb = dummy(b, 'en_tympanus')
    b.tick(3)
    const before = eb.stats.poiseAccum
    b.frame.held.add('attackHeavy')
    b.tick(5)
    b.frame.held.delete('attackHeavy')
    b.tick(30)
    expect(eb.stats.poiseAccum - before, '**一记重击给怪累积 24 点架势**').toBe(24)
    a.ai.despawn(ea.id)
    b.ai.despawn(eb.id)
    alive.push(a.off, b.off)
  })

  it('腿② **攻击前摇期间受击 = 架势伤害 ×1.5**：怪在前摇里挨一记 ⇒ **9**；不在前摇里挨同一记 ⇒ **6** ⇒ 两个世界逐拍对齐，**比值恰是 1.5** ⇒ 与设计「攻击前摇期间受击=架势伤害 ×1.5」**逐字对上**', () => {
    // 世界一：怪站着不动（不在前摇里）
    const a = makeWorld()
    const ea = dummy(a, 'en_murkshell')
    a.tick(3)
    const idlePoise = lightPoise(a, ea)
    expect(idlePoise, '**不在前摇里 ⇒ 6**').toBe(6)
    // 世界二：怪自己起手（它在 chase 态、玩家在近战带里）⇒ 玩家的那一记落在它的前摇里
    const b = makeWorld()
    const eb = b.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.2 }, 'probe')
    eb.alertness = 0
    eb.enter('idle')
    b.player.pos = { x: 0, y: 0, z: 0 }
    b.player.yaw = Math.PI
    b.pins.push(() => { eb.pos.x = 0; eb.pos.z = -1.2 })
    eb.enter('chase')
    eb.alertness = 100
    let started = false
    for (let i = 0; i < 200 && !started; i++) {
      b.tick()
      if (eb.attack) started = true
    }
    expect(started, '**怪自己起手了**').toBe(true)
    const startupPoise = lightPoise(b, eb)
    expect(startupPoise, '**在前摇里 ⇒ 9**（6 × 1.5）').toBe(9)
    expect(startupPoise / idlePoise, '**两个世界逐拍对齐 ⇒ 比值恰是 1.5**').toBe(1.5)
    a.ai.despawn(ea.id)
    b.ai.despawn(eb.id)
    alive.push(a.off, b.off)
  })

  it('腿③ **衰减那一格**：未再受击 **72 拍（1.2s）**之后按 **12/s** 向零 ⇒ 与设计「未再受击 1.2s 后，12/s 向零衰减」**逐字对上**', () => {
    const w = makeWorld()
    const e = dummy(w, 'en_tympanus')
    let hitTick = -1
    const offHit = bus.on('combat.hit', () => { if (hitTick < 0) hitTick = w.time.tick })
    w.tick(3)
    lightPoise(w, e)
    offHit()
    const afterHit = e.stats.poiseAccum
    expect(afterHit, '（打中之后手上是 6）').toBe(6)
    expect(hitTick, '（这一记落在哪一拍，记下来了）').toBeGreaterThan(0)
    let firstDropTick = -1
    const marks: number[] = []
    for (let i = 0; i < 130; i++) {
      w.tick()
      marks.push(e.stats.poiseAccum)
      if (firstDropTick < 0 && e.stats.poiseAccum < afterHit) firstDropTick = w.time.tick
    }
    expect(firstDropTick - hitTick, '**挨过那一记之后第 73 拍才开始掉**（硬缓冲 72 拍 ＝ 1.2s）').toBe(73)
    const dropIndex = marks.findIndex((m) => m < afterHit)
    expect(dropIndex, '（衰减是从这一刻开始的）').toBeGreaterThan(0)
    expect(marks[dropIndex + 5] - marks[dropIndex + 15], '**十拍掉 2 点**（＝ 12/s）').toBeCloseTo(2, 5)
    expect(marks[119], '**最后归零**').toBe(0)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ **破势那一格**：累积 ≥ 架势值 ⇒ **1.8s（杂兵 108 拍）／2.4s（Boss 144 拍）** ＋ 架势归零 ⇒ 与设计「1.8s 大踉跄；Boss 为 2.4s」**逐字对上**', () => {
    const w = makeWorld()
    const e = dummy(w, 'en_murkshell')
    w.tick(3)
    let crumpleAt = -1
    for (let i = 0; i < 200 && crumpleAt < 0; i++) {
      w.frame.edges.add('attackLight')
      w.tick(1)
      w.frame.edges.delete('attackLight')
      if (e.stats.crumpleTicksLeft > 0) crumpleAt = i
      w.tick(20)
    }
    expect(crumpleAt, '**压到破势线上了**').toBeGreaterThanOrEqual(0)
    expect(e.stats.poiseAccum, '**破势之后架势归零**').toBe(0)
    expect(e.stats.crumpleTicks, '**破势时长 108 拍 ＝ 1.8s**（设计「1.8s 大踉跄」）').toBe(108)
    // Boss 那一档：同一个函数、另一个开关
    const bossStats = new EntityStats(100, 100, 100)
    armCrumple(bossStats, true)
    expect(bossStats.crumpleTicks, '**Boss 那一档 144 拍 ＝ 2.4s**（设计「Boss 为 2.4s」）').toBe(144)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑤ **§8 的 R5「浮空」那一行没有承载体**：`reactions.json` 里**只有 R0–R4**（R5 浮空不写——本作敌人不会离地）⇒ 登记', () => {
    // **读的是「这一份测试所在的那棵树」**（不是某个写死的绝对路径）⇒ 平面上跑的时候读的就是平面的表
    const raw = readFileSync(fileURLToPath(new URL('../../src/data/json/reactions.json', import.meta.url)), 'utf8')
    const rows = Object.keys(JSON.parse(raw))
    expect(rows, '**R5 那一行在表里不存在**（设计「R5 浮空 Launch：滞空 0.5s+落地恢复 0.4s」）').toEqual(['R0', 'R1', 'R2', 'R3', 'R4'])
    expect(rows.includes('R5'), '**没有 R5** ⇒ 那一行在运行时没有承载体').toBe(false)
  })
})
