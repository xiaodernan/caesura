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
 * KI-263：**§4.1–§4.6 那六张 Moveset 表剩下的行**（跑动攻击／跳跃攻击／弓的速射 L 与满弓／蓄力那一式的起手那一格）
 * 第一次在真链上被量（KI-261 量了 L1 与重击 H 那两行）。
 *
 * 设计给的格子：直剑**跑动攻击** ＝ 333ms/20f ／ 100ms/6f ／ 300ms/18f；
 * 直剑**跳跃攻击** ＝ 落地起 250ms/15f ／ 150ms/9f ／ 400ms/24f；
 * 弓**速射 L** ＝ 250ms/15f ／ 弹速 40m/s ／ 350ms/21f；
 * 直剑**蓄力重击** ＝ 蓄 800ms+H ／ 150ms/9f ／ 450ms/27f。
 *
 * **量具上的两个要点**：
 * ① **跑动那一式要真的在跑**（按住 sprint ＋ 推摇杆 ⇒ 招式键才是 `run`）；
 * ② **弓那一把是抛射** ⇒ 它的「拉弓」那一格读的是**箭的出生拍**（`Projectile.bornTick`），
 *    不是命中那一拍（箭还要飞一会儿）。
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

/** 一只挨打的怪：站位每拍钉回（它 idle 也会自己走过来）；血量拉满 */
function dummy(w: World, z = -1.6) {
  const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z }, 'probe')
  e.alertness = 0
  e.enter('idle')
  e.stats.hpMax = 999999
  e.stats.hp = 999999
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

describe('KI-263 §4.1–§4.6 那六张 Moveset 表剩下的行：跑动／跳跃／弓／蓄力那一式的起手', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **跑动攻击**那一行：命中第 **20** 拍（设计 20f），整段第 **44** 拍（设计 20＋6＋18 ＝ 44f）⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const p = w.player
    // 真的在跑：按住 sprint ＋ 推摇杆 ⇒ 招式键才是 run
    w.frame.held.add('sprint')
    w.frame.move.x = 0
    w.frame.move.y = 1
    w.tick(3)
    const start = w.time.tick + 1
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
    expect(p.action?.key, '那一式的键是 `run`（跑动攻击）').toBe('run')
    let hit = -1
    for (let i = 0; i < 200 && hit < 0; i++) {
      w.tick()
      if (w.hits.filter((h) => h.victimId === e.id).length > 0) hit = w.time.tick - start + 1
    }
    let end = -1
    for (let i = 0; i < 200 && end < 0; i++) {
      w.tick()
      if (!p.action) end = w.time.tick - start + 1
    }
    expect(hit, '跑动那一记命中在第几拍（设计的 Startup ＝ 20f）').toBe(20)
    expect(end, '手能再动的那一拍（设计的 20＋6＋18 ＝ 44f）').toBe(44)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **跳跃攻击**那一行：命中第 **15** 拍（设计「落地起 250ms/15f」），整段第 **48** 拍（设计 15＋9＋24 ＝ 48f）⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const p = w.player
    w.frame.edges.add('jump')
    w.tick()
    w.frame.edges.delete('jump')
    for (let i = 0; i < 60 && p.grounded; i++) w.tick()
    expect(p.grounded, '前提：人已经在空中了').toBe(false)
    const start = w.time.tick + 1
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
    expect(p.action?.key, '那一式的键是 `jump`（跳跃攻击）').toBe('jump')
    let hit = -1
    for (let i = 0; i < 200 && hit < 0; i++) {
      w.tick()
      if (w.hits.filter((h) => h.victimId === e.id).length > 0) hit = w.time.tick - start + 1
    }
    let end = -1
    for (let i = 0; i < 200 && end < 0; i++) {
      w.tick()
      if (!p.action) end = w.time.tick - start + 1
    }
    expect(hit, '空中那一记命中在第几拍（设计的「落地起 250ms/15f」＝ 15f）').toBe(15)
    expect(end, '手能再动的那一拍（设计的 15＋9＋24 ＝ 48f）').toBe(48)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿③ 弓的**速射 L**那一行：箭在第 **15** 拍出生（设计「250ms/15f」），那一式整段第 **36** 拍（设计 15＋0＋21 ＝ 36f）⇒ 逐字对上', () => {
    const w = makeWorld('wp_overtone_bow')
    dummy(w)
    const p = w.player
    const start = w.time.tick + 1
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
    let born = -1
    let end = -1
    for (let i = 0; i < 200; i++) {
      w.tick()
      const proj = w.combat.projectiles.list()[0]
      if (born < 0 && proj) born = proj.bornTick - start + 1
      if (end < 0 && !p.action) { end = w.time.tick - start + 1; break }
    }
    expect(born, '**箭的出生拍**（弓那一把是抛射 ⇒ 「拉弓」那一格读的是箭出发的那一刻，不是命中那一刻；设计写的是 250ms/15f）').toBe(15)
    expect(end, '那一式整段走完在第几拍（设计 15＋0＋21 ＝ 36f）').toBe(36)
    alive.push(w.off)
  })

  it('腿④ 蓄力那一式的**起手那一格**：设计写「蓄 800ms+H」（⇒ 那一式的起手是重击的 30 拍），运行时**那一式自己的起手是 20 拍** ⇒ 整段 **104** 拍、比设计那一格推出来的 111 拍**少 7 拍** ⇒ 登记', () => {
    const w = makeWorld()
    const e = dummy(w)
    const p = w.player
    const start = w.time.tick + 1
    w.frame.held.add('attackHeavy')
    w.tick(48)
    w.frame.held.delete('attackHeavy')
    w.tick()
    expect(p.action?.key, '按住 48 拍松手 ⇒ 蓄力那一式').toBe('charged')
    let hit = -1
    for (let i = 0; i < 200 && hit < 0; i++) {
      w.tick()
      if (w.hits.filter((h) => h.victimId === e.id).length > 0) hit = w.time.tick - start + 1
    }
    let end = -1
    for (let i = 0; i < 200 && end < 0; i++) {
      w.tick()
      if (!p.action) end = w.time.tick - start + 1
    }
    expect(hit, '蓄力那一记命中在第几拍（**蓄 48 拍 ＋ 那一式自己的起手 20 拍 − 1**）').toBe(68)
    expect(end, '蓄力那一式整段走完在第几拍（**48 ＋ 56 ＝ 104**；设计那一格写的是「蓄 800ms+H」⇒ 按重击的整段推是 48＋63 ＝ 111 ⇒ **少 7 拍** ⇒ 登记）').toBe(104)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })
})
