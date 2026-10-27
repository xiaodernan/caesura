import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT, msToTicks } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'
import type { Vec3 } from '@/combat/EntityStats'
import { bus } from '@/core/EventBus'

/**
 * KI-306：§9 那张情境表在 KI-239／241／243 之后**已经量完**，本批做的是复核与纠错。
 *
 * 三件事：
 *  ① **帧列 ⇄ 运行时的换算不是我一个人以为的那样**：设计表的「帧」列在 90ms 写 6f、120ms 写 8f，
 *     而运行时的唯一换算是 `msToTicks = round(ms / (1000/60))` ⇒ **5 / 7 格**。其余八行逐字对上。
 *     运行时以**毫秒**为准，帧列是设计侧的取整写法 ⇒ 只量不裁，登记在 KI-306 的更正里。
 *  ② **完美格挡整行就是 90ms，没有「额外减免/追加 30ms」**：那一句是上一版 KI-306 错记的。
 *  ③ **30ms 的那一格属于拍点奖励**（combat.md §4.1「所有命中在拍点时 hitstop 额外 +30ms」）：
 *     同一记轻击，命中落在拍点上报 90ms、落在拍与拍中间报 60ms。它是**时机**的属性，不是格挡的属性。
 *
 * 读数一律从真链取：真 `PlayerController` ＋ 真 `Enemy` ＋ 真 `CombatManager` ＋ 真事件。
 * 设计值手钉在这里（不读数据表）：表一改，这条腿该红。
 */

registerGameData()

type Hit = { result: string; hitStopMs: number; victimId: string }

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hpMax = 9_999
  player.stats.hp = 9_999
  const hits: Hit[] = []
  const off = bus.on('combat.hit', (p) => hits.push({ result: p.result, hitStopMs: p.hitStopMs, victimId: p.victimId }))
  const pins: Array<{ e: Enemy; pos: Vec3 }> = []
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
      for (const p of pins) {
        if (!p.e.alive) continue
        p.e.stats.hp = p.e.stats.hpMax
        p.e.stats.dead = false
        p.e.pos.x = p.pos.x; p.e.pos.y = p.pos.y; p.e.pos.z = p.pos.z
      }
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, off, pins }
}
type World = ReturnType<typeof makeWorld>

/** 敌人守方停顿：返回「硬直倒数第一次动起来」前走过的 tick 数（含动的那一格） */
function enemyStop(w: World, e: Enemy, stopMs: number): number {
  e.onParried(w.time.tick)
  expect(e.stunTicks, '前提：她确实进了一段硬直').toBeGreaterThan(0)
  w.combat.projectiles.spawn({
    hostile: false, ownerId: 'player', kind: 'note',
    origin: { x: e.pos.x, y: e.pos.y + 1.1, z: e.pos.z - 1.4 },
    dir: { x: 0, y: 0, z: 1 },
    speed: 60, range: 20, radius: 1.2, damage: 6, poise: 0, hitStopMs: stopMs, onBeat: false,
  }, w.time.tick)
  for (let i = 0; i < 100 && !w.hits.some((h) => h.victimId === e.id); i++) w.tick()
  const s0 = e.stunTicks
  const t0 = w.time.tick
  for (let i = 0; i < 200 && e.stunTicks === s0; i++) w.tick()
  expect(e.stunTicks, '硬直倒数始终没动：停顿没有尽头？').not.toBe(s0)
  return w.time.tick - t0
}

/** 一记飞向玩家的弹体（飞行 9 拍 ⇒ 防御按键的时机由调用方给） */
function shootAtPlayer(w: World): void {
  w.combat.projectiles.spawn({
    hostile: true, ownerId: 'en_test', kind: 'shard', origin: { x: 0, y: 1.1, z: -4 }, dir: { x: 0, y: 0, z: 1 },
    speed: 13, range: 20, radius: 0.45, damage: 30, poise: 10, hitStopMs: 60,
  }, w.time.tick)
}

/** 让玩家挥一记轻击；`onBeat` 决定起手相位——L1 的命中在起手第 12 拍 */
function lightAttack(w: World, wantHitOnBeat: boolean): Hit {
  const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'sec9-' + wantHitOnBeat)
  e.alertness = 0
  e.enter('idle')
  w.pins.push({ e, pos: { ...e.pos } })
  const p = w.player
  p.pos = { x: 0, y: 0, z: 0 }
  p.yaw = Math.PI
  p.camYawRef = Math.PI + p.yaw
  let waited = 0
  if (wantHitOnBeat) {
    // 84BPM 一拍 42.857 拍；起手相位 0.70 再按，命中（+12 拍）正好越过拍点
    while (!(w.rhythm.info().phase > 0.68 && w.rhythm.info().phase < 0.76) && waited < 200) { w.tick(); waited++ }
  } else {
    while (w.rhythm.onBeat(50) && waited < 100) { w.tick(); waited++ }
  }
  w.frame.edges.add('attackLight')
  w.tick()
  w.frame.edges.delete('attackLight')
  for (let i = 0; i < 60 && w.hits.length === 0; i++) w.tick()
  const hit = w.hits.find((h) => h.victimId === e.id)
  expect(hit, '这一记轻击根本没打到人：这条断言在量空气').toBeTruthy()
  return hit!
}

describe('KI-318 §9 情境表复核：帧列换算、完美格挡的 90ms、拍点的 +30ms', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 帧列 ⇄ msToTicks：恰好 90ms／120ms 两行差一格（设计 6f／8f，运行时 5／7）', () => {
    // 设计表逐行手钉（不读数据表）：[毫秒, 帧列]
    const rows: Array<[number, number, string]> = [
      [60, 4, '轻击命中敌'], [90, 6, '重击/尾段'], [120, 8, '蓄力重击'],
      [45, 3, '命中被格挡'], [90, 6, '完美格挡'], [120, 8, '弹反成功'],
      [100, 6, '弹反失败被击'], [80, 5, '玩家受击'], [180, 11, '处决首刀'], [250, 15, 'Boss 砸地'],
    ]
    const mismatched = rows.filter(([ms, f]) => msToTicks(ms) !== f).map(([ms, f, name]) => `${name}: ${ms}ms 表 ${f}f / 运行时 ${msToTicks(ms)} 格`)
    expect(mismatched, '帧列与运行时换算的差集变了：要么设计表改了，要么 msToTicks 改了').toEqual([
      '重击/尾段: 90ms 表 6f / 运行时 5 格',
      '蓄力重击: 120ms 表 8f / 运行时 7 格',
      '完美格挡: 90ms 表 6f / 运行时 5 格',
      '弹反成功: 120ms 表 8f / 运行时 7 格',
    ])
  })

  it('腿② 真链上的冻结格数跟着毫秒走：90ms ⇒ 5 格、120ms ⇒ 7 格（不是帧列的 6／8）', () => {
    for (const ms of [90, 120]) {
      const w = makeWorld()
      const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'freeze' + ms)
      w.pins.push({ e, pos: { ...e.pos } })
      const moves = enemyStop(w, e, ms)
      expect(moves - 1, `${ms}ms 的停顿格数：msToTicks 是四舍五入，不是按帧列向上取整`).toBe(msToTicks(ms))
      alive.push(w.off)
    }
  })

  it('腿③ 完美格挡整行是 90ms，没在它上面再叠 30ms（上一版 KI-306 的错记当场反证）', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    shootAtPlayer(w)
    w.tick(11) // 弹体还有 3 拍到 ⇒ 按下格挡，落在完美格挡的前 5 拍里
    w.frame.held.add('guard')
    for (let i = 0; i < 30 && w.hits.length === 0; i++) w.tick()
    const hit = w.hits[0]
    expect(hit?.result, '这一记走了完美格挡').toBe('perfectBlock')
    expect(hit!.hitStopMs, '完美格挡那一行只有 90ms 这一个数，不是 90+30').toBe(90)
    alive.push(w.off)
  })

  it('腿④ 30ms 属于拍点：同一记轻击落拍 90ms、落拍与拍之间 60ms', () => {
    const on = makeWorld()
    const onBeatHit = lightAttack(on, true)
    expect(onBeatHit.hitStopMs, '拍点上的轻击：60ms 自己那一格 + 30ms 拍点奖励').toBe(90)
    alive.push(on.off)

    const off = makeWorld()
    const offBeatHit = lightAttack(off, false)
    expect(offBeatHit.hitStopMs, '拍与拍之间的同一记轻击：只有 60ms 自己那一格').toBe(60)
    alive.push(off.off)
  })
})
