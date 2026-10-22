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
 * KI-271：**§4.2–§4.6 那几张 Moveset 表剩下的「跑动 ＋ 跳跃」那一族**第一次在真链上被量
 * （KI-261 量了直剑的 L1 与重击 H、KI-263 量了**直剑**的跑动／跳跃与弓的速射 L、
 * KI-265 量了直剑的连段与弓的三行、KI-267 量了其余四把的连段与杖的 L1–L4、KI-269 量了重击 H 与蓄力重击）。
 *
 * **口径沿用 KI-263／KI-267／KI-269 立起来的那一套**：
 * ① **跑动那一式要真的在跑** —— 按住 sprint ＋ 推摇杆 ⇒ 招式键才是 `run`（不跑就落回 L1）；
 * ② **跳跃那一式**要人在空中 ⇒ 招式键才是 `jump`；
 * ③ **挨打的那只怪必须是「被动」的**（KI-267 立起来的）：它一挨打就进 combat 状态反打 ⇒ 玩家的招式被打断；
 * ④ **打重击会把怪打崩** ⇒ 读底数前把那只怪的架势值拉高（否则吃上破势那一档 ×1.5）。
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

/** 一只挨打的怪：站位每拍钉回；血量与架势值都拉高；状态每拍按回 idle（它一挨打就进 combat 状态反打） */
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
    if (e.state !== 'idle') e.enter('idle')
    e.attack = null
  })
  return e
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

interface Timing {
  /** 招式键（'run' ／ 'jump' ／ 'l1'） */
  key: string
  /** 命中那一拍（相对出招那一拍） */
  hit: number
  /** 那一记的伤害 */
  damage: number
  /** 手能再动的那一拍（相对出招那一拍）＝ 那一式的整段 */
  end: number
  /** 弹体那一把：弹的出生拍（相对出招那一拍） */
  born: number
}

/** 出**一记跑动攻击**（真的在跑：按住 sprint ＋ 推摇杆）：量招式键、命中拍、伤害、整段 */
function runTiming(w: World, e: ReturnType<World['ai']['spawn']>): Timing {
  const p = w.player
  w.frame.held.add('sprint')
  w.frame.move.x = 0
  w.frame.move.y = 1
  w.tick(3)
  const start = w.time.tick + 1
  w.frame.edges.add('attackLight')
  w.tick()
  w.frame.edges.delete('attackLight')
  const key = p.action?.key ?? ''
  let hit = -1
  let damage = -1
  let end = -1
  let born = -1
  for (let i = 0; i < 260; i++) {
    w.tick()
    if (born < 0) {
      const proj = w.combat.projectiles.list()[0]
      if (proj) born = proj.bornTick - start + 1
    }
    if (hit < 0) {
      const mine = w.hits.filter((h) => h.victimId === e.id)
      if (mine.length > 0) {
        hit = w.time.tick - start + 1
        damage = mine[mine.length - 1].damage
      }
    }
    if (hit >= 0 && !p.action) { end = w.time.tick - start + 1; break }
  }
  return { key, hit, damage, end, born }
}

/** 出**一记跳跃攻击**（人在空中）：量招式键、命中拍、伤害、整段 */
function jumpTiming(w: World, e: ReturnType<World['ai']['spawn']>): Timing {
  const p = w.player
  w.frame.edges.add('jump')
  w.tick()
  w.frame.edges.delete('jump')
  const start = w.time.tick + 1
  w.frame.edges.add('attackLight')
  w.tick()
  w.frame.edges.delete('attackLight')
  const key = p.action?.key ?? ''
  let hit = -1
  let damage = -1
  let end = -1
  let born = -1
  for (let i = 0; i < 260; i++) {
    w.tick()
    if (born < 0) {
      const proj = w.combat.projectiles.list()[0]
      if (proj) born = proj.bornTick - start + 1
    }
    if (hit < 0) {
      const mine = w.hits.filter((h) => h.victimId === e.id)
      if (mine.length > 0) {
        hit = w.time.tick - start + 1
        damage = mine[mine.length - 1].damage
      }
    }
    if (hit >= 0 && !p.action) { end = w.time.tick - start + 1; break }
  }
  return { key, hit, damage, end, born }
}

describe('KI-271 §4.2–§4.6 那几张 Moveset 表剩下的「跑动 ＋ 跳跃」那一族', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **大剑**的跑动攻击：命中第 **28** 拍（设计 467ms/28f），整段第 **65** 拍（28＋9＋28 ＝ 65f），伤害 **30** ⇒ 逐字对上', () => {
    const w = makeWorld('wp_fortissimo_greatsword')
    const e = dummy(w)
    const t = runTiming(w, e)
    expect(t.key, '那一式的键是 `run`（**要真的在跑**：按住 sprint ＋ 推摇杆）').toBe('run')
    expect(t.hit, '跑动那一记命中在第几拍（设计的 Startup ＝ 28f）').toBe(28)
    expect(t.end, '手能再动的那一拍（设计的 28＋9＋28 ＝ 65f）').toBe(65)
    expectBase(t.damage, 30, '大剑跑动攻击那一记的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **大剑**的跳跃攻击：命中第 **24** 拍（设计 400ms/24f），整段第 **66** 拍（24＋12＋30 ＝ 66f），伤害 **34** ⇒ 逐字对上', () => {
    const w = makeWorld('wp_fortissimo_greatsword')
    const e = dummy(w)
    const t = jumpTiming(w, e)
    expect(t.key, '那一式的键是 `jump`（人在空中）').toBe('jump')
    expect(t.hit, '跳跃那一记命中在第几拍（设计的 Startup ＝ 24f）').toBe(24)
    expect(t.end, '手能再动的那一拍（设计的 24＋12＋30 ＝ 66f）').toBe(66)
    expectBase(t.damage, 34, '大剑跳跃攻击那一记的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿③ **枪**的跑动攻击：命中第 **16** 拍（设计 267ms/16f），整段第 **43** 拍（16＋6＋21 ＝ 43f），伤害 **14** ⇒ 逐字对上', () => {
    const w = makeWorld('wp_drawpin_spear')
    const e = dummy(w)
    const t = runTiming(w, e)
    expect(t.key, '那一式的键是 `run`（**要真的在跑**：按住 sprint ＋ 推摇杆）').toBe('run')
    expect(t.hit, '跑动那一记命中在第几拍（设计的 Startup ＝ 16f）').toBe(16)
    expect(t.end, '手能再动的那一拍（设计的 16＋6＋21 ＝ 43f）').toBe(43)
    expectBase(t.damage, 14, '枪跑动攻击那一记的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ **枪**的跳跃攻击：命中第 **16** 拍（设计 267ms/16f），整段第 **49** 拍（16＋9＋24 ＝ 49f），伤害 **18** ⇒ 逐字对上', () => {
    const w = makeWorld('wp_drawpin_spear')
    const e = dummy(w)
    const t = jumpTiming(w, e)
    expect(t.key, '那一式的键是 `jump`（人在空中）').toBe('jump')
    expect(t.hit, '跳跃那一记命中在第几拍（设计的 Startup ＝ 16f）').toBe(16)
    expect(t.end, '手能再动的那一拍（设计的 16＋9＋24 ＝ 49f）').toBe(49)
    expectBase(t.damage, 18, '枪跳跃攻击那一记的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑤ **静默针**那一族**没有跑动／跳跃那两式** ⇒ 输入层缺省**回落成 L1**：真的在跑时出的键是 `l1`（命中第 **11** 拍、整段第 **22** 拍、伤害 **7**），人在空中出的键也是 `l1`（同前）⇒ 设计 §4.5 的注记说的回落是真的 ⇒ 登记', () => {
    const w = makeWorld('wp_needlesilence')
    const e = dummy(w)
    const r = runTiming(w, e)
    expect(r.key, '**真的在跑（按住 sprint ＋ 推摇杆）⇒ 出的键是 `l1` 而不是 `run`**（那一族没有 `run` 那一式 ⇒ 输入层按 §4.5 的注记缺省回落）').toBe('l1')
    expect(r.hit, '那一记命中在第几拍（静默针 L1 的 11f）').toBe(11)
    expect(r.end, '手能再动的那一拍（静默针 L1 的 11＋5＋6 ＝ 22f）').toBe(22)
    expectBase(r.damage, 7, '静默针 L1 那一记的伤害')

    const w2 = makeWorld('wp_needlesilence')
    const e2 = dummy(w2)
    const j = jumpTiming(w2, e2)
    expect(j.key, '**人在空中 ⇒ 出的键也是 `l1` 而不是 `jump`**（那一族没有 `jump` 那一式）').toBe('l1')
    expect(j.hit, '那一记命中在第几拍（静默针 L1 的 11f）').toBe(11)
    expect(j.end, '手能再动的那一拍（静默针 L1 的 22f）').toBe(22)
    w.ai.despawn(e.id)
    w2.ai.despawn(e2.id)
    alive.push(w.off)
    alive.push(w2.off)
  })

  it('腿⑥ **杖**那一族**也没有跑动／跳跃那两式** ⇒ 输入层缺省**回落成 L1**：真的在跑时出的键是 `l1`（命中第 **13** 拍、整段第 **32** 拍、伤害 **7**），人在空中出的键也是 `l1`（同前）⇒ 登记', () => {
    const w = makeWorld('wp_tuningfork_staff')
    const e = dummy(w)
    const r = runTiming(w, e)
    expect(r.key, '**真的在跑 ⇒ 出的键是 `l1` 而不是 `run`**（那一族没有 `run` 那一式）').toBe('l1')
    expect(r.hit, '那一记命中在第几拍（杖 L1 的 13f）').toBe(13)
    expect(r.end, '手能再动的那一拍（杖 L1 的 13＋6＋13 ＝ 32f）').toBe(32)
    expectBase(r.damage, 7, '杖 L1 那一记的伤害')

    const w2 = makeWorld('wp_tuningfork_staff')
    const e2 = dummy(w2)
    const j = jumpTiming(w2, e2)
    expect(j.key, '**人在空中 ⇒ 出的键也是 `l1` 而不是 `jump`**（那一族没有 `jump` 那一式）').toBe('l1')
    expect(j.hit, '那一记命中在第几拍（杖 L1 的 13f）').toBe(13)
    expect(j.end, '手能再动的那一拍（杖 L1 的 32f）').toBe(32)
    w.ai.despawn(e.id)
    w2.ai.despawn(e2.id)
    alive.push(w.off)
    alive.push(w2.off)
  })

  it('腿⑦ **弓**那一族表里**只有 `jump` 没有 `run`** ⇒ 跑动那一把也缺省**回落成 L1**（弓是抛射 ⇒ 判定帧读箭的出生拍：第 **15** 拍、整段第 **36** 拍、伤害 **10**）⇒ 登记', () => {
    const w = makeWorld('wp_overtone_bow')
    const e = dummy(w)
    const r = runTiming(w, e)
    expect(r.key, '**真的在跑 ⇒ 出的键是 `l1` 而不是 `run`**（弓那一族表里只有 `jump`）').toBe('l1')
    expect(r.born, '**箭的出生拍**（弓是抛射 ⇒ 判定帧读箭出发那一刻，不是命中那一刻；弓 L1 的 15f）').toBe(15)
    expect(r.end, '手能再动的那一拍（弓 L1 的 15＋0＋21 ＝ 36f）').toBe(36)
    expectBase(r.damage, 10, '弓 L1 那一箭的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })
})
