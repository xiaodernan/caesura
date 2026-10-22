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
 * KI-269：**§4.2–§4.6 那几张 Moveset 表剩下的「重击 H ＋ 蓄力重击」那一族**第一次在真链上被量
 * （KI-261 量了直剑的 L1 与重击 H、KI-263 量了跑动／跳跃／速射 L 与蓄力那一式的起手那一格、
 * KI-265 量了直剑的连段与弓的三行、KI-267 量了其余四把的连段与杖的 L1–L4）。
 *
 * **口径沿用 KI-261／KI-263 立起来的那一套**：
 * ① **重击那一式是从松手那一刻起算的** —— 按住 5 拍、第 6 拍松手 ⇒ 那一式从第 6 拍起算
 *    ⇒ 命中落在它自己的第 N 拍时，相对出招那一拍的读数是 **N＋5**（直剑：30＋5 ＝ 35）；
 * ② **蓄力那一式** ＝ 按住 N 拍松手 ⇒ 相对读数是 **N＋那一式自己的起手**、整段是 **N＋那一式的整段**
 *    （直剑：48＋20 ＝ 68／48＋56 ＝ 104）；
 * ③ **弹体那一把**（枪的投掷枪／杖的共振弹）⇒ 「判定帧」读的是**弹的出生拍**（`Projectile.bornTick`），
 *    不是命中那一刻（命中还要等它飞过去）；
 * ④ **挨打的那只怪必须是「被动」的**（KI-267 立起来的）：它一挨打就进 combat 状态反打 ⇒ 玩家的招式被打断；
 * ⑤ **打连段／重击会把怪打崩** ⇒ 读底数前把那只怪的架势值拉高（否则吃上破势那一档 ×1.5）。
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

interface HeavyTiming {
  /** 松手那一拍之后的招式键（'h' ／ 'charged' ／ ''＝什么也没出） */
  key: string
  /** 命中那一拍（相对出招那一拍） */
  hit: number
  /** 那一记的伤害 */
  damage: number
  /** 那一式整段走完在第几拍（相对出招那一拍） */
  end: number
  /** 弹体那一把：弹的出生拍（相对出招那一拍） */
  born: number
}

/** 出**一记重击**（按住 5 拍松手 ⇒ 那一式从松手那一刻起算）：量招式键、命中拍、伤害、整段 */
function heavyTiming(w: World, e: ReturnType<World['ai']['spawn']>): HeavyTiming {
  const p = w.player
  const start = w.time.tick + 1
  w.frame.held.add('attackHeavy')
  w.tick(5)
  w.frame.held.delete('attackHeavy')
  w.tick()
  const key = p.action?.key ?? ''
  let hit = -1
  let damage = -1
  let born = -1
  let end = -1
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

/** 出**一记蓄力重击**（按住 N 拍松手）：量招式键、命中拍（弹体读出生拍）、伤害、整段 */
function chargedTiming(w: World, e: ReturnType<World['ai']['spawn']>, hold: number): HeavyTiming {
  const p = w.player
  const start = w.time.tick + 1
  w.frame.held.add('attackHeavy')
  w.tick(hold)
  w.frame.held.delete('attackHeavy')
  w.tick()
  const key = p.action?.key ?? ''
  let hit = -1
  let damage = -1
  let born = -1
  let end = -1
  for (let i = 0; i < 300; i++) {
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

describe('KI-269 §4.2–§4.6 那几张 Moveset 表剩下的「重击 H ＋ 蓄力重击」那一族', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **大剑**的重击 H：命中在第 **47** 拍（它自己的第 42 拍 ＋ 松手那 5 拍，设计 700ms/42f），整段第 **95** 拍（42＋12＋36 ＝ 90 ＋ 5），伤害 **52** ⇒ 逐字对上', () => {
    const w = makeWorld('wp_fortissimo_greatsword')
    const e = dummy(w)
    const t = heavyTiming(w, e)
    expect(t.hit, '重击命中那一拍（**那一式是从松手那一刻起算的** ⇒ 它自己的第 42 拍 ＋ 按住的那 5 拍）').toBe(47)
    expect(t.end, '那一式整段走完在第几拍（设计 42＋12＋36 ＝ 90f ＋ 5）').toBe(95)
    expectBase(t.damage, 52, '大剑重击 H 那一记的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **枪**的重击 H：命中在第 **37** 拍（它自己的第 32 拍 ＋ 5，设计 533ms/32f），整段第 **75** 拍（32＋10＋28 ＝ 70 ＋ 5），伤害 **27** ⇒ 逐字对上', () => {
    const w = makeWorld('wp_drawpin_spear')
    const e = dummy(w)
    const t = heavyTiming(w, e)
    expect(t.hit, '重击命中那一拍（它自己的第 32 拍 ＋ 5）').toBe(37)
    expect(t.end, '那一式整段走完在第几拍（设计 32＋10＋28 ＝ 70f ＋ 5）').toBe(75)
    expectBase(t.damage, 27, '枪重击 H 那一记的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿③ **静默针**的重击 H：命中在第 **29** 拍（它自己的第 24 拍 ＋ 5，设计 400ms/24f），整段第 **61** 拍（24＋8＋24 ＝ 56 ＋ 5），伤害 **22** ⇒ 逐字对上', () => {
    const w = makeWorld('wp_needlesilence')
    const e = dummy(w)
    const t = heavyTiming(w, e)
    expect(t.hit, '重击命中那一拍（它自己的第 24 拍 ＋ 5）').toBe(29)
    expect(t.end, '那一式整段走完在第几拍（设计 24＋8＋24 ＝ 56f ＋ 5）').toBe(61)
    expectBase(t.damage, 22, '静默针重击 H 那一记的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ **杖**的重击 H（鸣和弦，环状判定）：命中在第 **29** 拍（它自己的第 24 拍 ＋ 5，设计 400ms/24f），整段第 **65** 拍（24＋9＋27 ＝ 60 ＋ 5），伤害 **20** ⇒ 逐字对上', () => {
    const w = makeWorld('wp_tuningfork_staff')
    const e = dummy(w)
    const t = heavyTiming(w, e)
    expect(t.hit, '重击命中那一拍（它自己的第 24 拍 ＋ 5）').toBe(29)
    expect(t.end, '那一式整段走完在第几拍（设计 24＋9＋27 ＝ 60f ＋ 5）').toBe(65)
    expectBase(t.damage, 20, '杖重击 H 那一记的伤害')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑤ **大剑**的蓄力重击：蓄满阈值是 **84 拍（1400ms）**（按住 83 拍松手 ⇒ 什么也没打出来；按住 84 拍 ⇒ 蓄力那一式出来了），那一式自己的起手 **20** 拍 ⇒ 命中第 **104** 拍、整段第 **158** 拍（84＋74），伤害 **80** ⇒ 逐字对上', () => {
    // 83 拍：落在死区里（8…83）⇒ 什么也没有
    const a = makeWorld('wp_fortissimo_greatsword')
    const ea = dummy(a)
    a.frame.held.add('attackHeavy')
    a.tick(83)
    a.frame.held.delete('attackHeavy')
    a.tick(3)
    expect(a.hits.filter((h) => h.victimId === ea.id).length, '**按住 83 拍松手 ⇒ 什么也没打出来**（阈值 84 拍 ⇒ 8…83 那一段是死区）⇒ 登记').toBe(0)
    expect(a.player.action, '**按住 83 拍松手 ⇒ 手上没有招式**').toBeFalsy()
    a.ai.despawn(ea.id)
    a.off()

    // 84 拍：蓄力那一式
    const b = makeWorld('wp_fortissimo_greatsword')
    const eb = dummy(b)
    const t = chargedTiming(b, eb, 84)
    expect(t.key, '**按住 84 拍松手 ⇒ 蓄力那一式出来了**（阈值 84 拍 ＝ 1400ms ＝ 设计「蓄 1400ms」那一格）').toBe('charged')
    expect(t.hit, '蓄力那一记命中在第几拍（**相对出招那一拍**：按住 84 拍 ＋ 那一式自己的起手 20 拍 ＝ 104）').toBe(104)
    expect(t.end, '蓄力那一式整段走完在第几拍（84＋那一式的整段 74 ＝ 158）').toBe(158)
    expectBase(t.damage, 80, '大剑蓄力重击那一记的伤害')
    b.ai.despawn(eb.id)
    alive.push(b.off)
  })

  it('腿⑥ **枪**的蓄力重击（投掷枪）：蓄满阈值是 **60 拍（1000ms）**（按住 59 拍 ⇒ 什么也没打出来；按住 60 拍 ⇒ 蓄力那一式出来了），弹在第 **80** 拍出生（60＋那一式自己的起手 20），整段第 **116** 拍（60＋56），伤害 **34** ⇒ 逐字对上', () => {
    const a = makeWorld('wp_drawpin_spear')
    const ea = dummy(a)
    a.frame.held.add('attackHeavy')
    a.tick(59)
    a.frame.held.delete('attackHeavy')
    a.tick(3)
    expect(a.hits.filter((h) => h.victimId === ea.id).length, '**按住 59 拍松手 ⇒ 什么也没打出来**（阈值 60 拍）⇒ 登记').toBe(0)
    a.ai.despawn(ea.id)
    a.off()

    const b = makeWorld('wp_drawpin_spear')
    const eb = dummy(b)
    const t = chargedTiming(b, eb, 60)
    expect(t.key, '**按住 60 拍松手 ⇒ 蓄力那一式出来了**（阈值 60 拍 ＝ 1000ms ＝ 设计「蓄 1000ms」那一格）').toBe('charged')
    expect(t.born, '**枪的出生拍**（投掷枪是抛射 ⇒ 判定帧读的是枪出发那一刻，不是命中那一刻；60＋20 ＝ 80）').toBe(80)
    expect(t.end, '蓄力那一式整段走完在第几拍（60＋那一式的整段 56 ＝ 116）').toBe(116)
    expectBase(t.damage, 34, '枪蓄力重击那一记的伤害')
    b.ai.despawn(eb.id)
    alive.push(b.off)
  })

  it('腿⑦ **杖**的蓄力重击（共振弹）：蓄满阈值是 **54 拍（900ms）**（按住 53 拍 ⇒ 什么也没打出来；按住 54 拍 ⇒ 蓄力那一式出来了），弹在第 **74** 拍出生（54＋那一式自己的起手 20），整段第 **104** 拍（54＋50），伤害 **32** ⇒ 逐字对上', () => {
    const a = makeWorld('wp_tuningfork_staff')
    const ea = dummy(a)
    a.frame.held.add('attackHeavy')
    a.tick(53)
    a.frame.held.delete('attackHeavy')
    a.tick(3)
    expect(a.hits.filter((h) => h.victimId === ea.id).length, '**按住 53 拍松手 ⇒ 什么也没打出来**（阈值 54 拍）⇒ 登记').toBe(0)
    a.ai.despawn(ea.id)
    a.off()

    const b = makeWorld('wp_tuningfork_staff')
    const eb = dummy(b)
    const t = chargedTiming(b, eb, 54)
    expect(t.key, '**按住 54 拍松手 ⇒ 蓄力那一式出来了**（阈值 54 拍 ＝ 900ms ＝ 设计「蓄 900ms」那一格）').toBe('charged')
    expect(t.born, '**共振弹的出生拍**（抛射 ⇒ 判定帧读的是弹出发那一刻；54＋20 ＝ 74）').toBe(74)
    expect(t.end, '蓄力那一式整段走完在第几拍（54＋那一式的整段 50 ＝ 104）').toBe(104)
    expectBase(t.damage, 32, '杖蓄力重击那一记的伤害')
    b.ai.despawn(eb.id)
    alive.push(b.off)
  })

  it('腿⑧ **静默针**的重击只有「点一下」才出得来：按住 20 拍松手 ⇒ 什么也没打出来（8…47 那一段是死区）；按住 48 拍松手 ⇒ **还是**什么也没打出来（那一族既没写 `chargeTicks` 也没写 `charged` 那一式 ⇒ 走全局阈值 48 ⇒ 那一式不存在 ⇒ 出不来）⇒ 设计 §4.6 给了重击 H 那一行却没给蓄力行 ⇒ 登记', () => {
    const a = makeWorld('wp_needlesilence')
    const ea = dummy(a)
    a.frame.held.add('attackHeavy')
    a.tick(20)
    a.frame.held.delete('attackHeavy')
    a.tick(3)
    expect(a.hits.filter((h) => h.victimId === ea.id).length, '**按住 20 拍松手 ⇒ 什么也没打出来**（8…47 那一段是死区）⇒ 登记').toBe(0)
    expect(a.player.action, '**按住 20 拍松手 ⇒ 手上没有招式**').toBeFalsy()
    a.ai.despawn(ea.id)
    a.off()

    const b = makeWorld('wp_needlesilence')
    const eb = dummy(b)
    b.frame.held.add('attackHeavy')
    b.tick(48)
    b.frame.held.delete('attackHeavy')
    b.tick(3)
    expect(b.hits.filter((h) => h.victimId === eb.id).length, '**按住 48 拍松手 ⇒ 还是什么也没打出来**（`ms_needlesilence` 既没写 `chargeTicks` 也没写 `charged` 那一式 ⇒ 走全局阈值 48 ⇒ 那一式不存在 ⇒ 出不来）⇒ 登记').toBe(0)
    expect(b.player.action, '**按住 48 拍松手 ⇒ 手上没有招式**').toBeFalsy()
    b.ai.despawn(eb.id)
    b.off()
  })
})
