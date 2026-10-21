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
 * KI-261：**§4.1–§4.6 那六张 Moveset 表的帧列（Startup／Active／Recovery）第一次在真链上被量**
 * （伤害／体力／架势那几列已由 KI-225／KI-259 量过；**帧列**此前没人从真链上读过）。
 *
 * 设计给的格子（直剑为例）：L1 ＝ 200ms/12f ／ 100ms/6f ／ 200ms/12f；重击 H ＝ 500ms/30f ／ 150ms/9f ／ 400ms/24f；
 * 蓄力重击 ＝ 蓄 800ms+H ／ 150ms/9f ／ 450ms/27f。
 *
 * **这一批量的是三个可观测量**（都不是读数据表）：
 * ① **命中那一拍** ＝ 设计的 Startup（出手那一拍算第 1 拍）；
 * ② **手能再动的那一拍** ＝ 设计的 Startup＋Active＋Recovery（**整段**）；
 * ③ **判定窗的最后一拍** ＝ 把怪在第 T 拍才挪进判定框里，看那一记还打不打得着
 *    ⇒ 打得着 ⇒ 窗是闭的（**比设计那几拍多一帧**）。
 *
 * **一处登记（与 KI-249 那条 i-frame 窗同一个口径问题）**：设计那几列的拍数是**半开区间**的算法
 * （Active 6f ＝ activeEnd − activeStart），而运行时的判定窗是**闭区间**（`tick >= activeStart && tick <= activeEnd`）
 * ⇒ 运行时真正活着的帧比设计那一列**多一帧**（直剑 L1：设计 6f，运行时 12–18 ＝ 7 帧）。
 *
 * **量具上的两条纪律（沿用 KI-257／KI-259 那一批）**：敌人会自己走过来 ⇒ 每拍把它的站位钉回；
 * 弹体那一把（弓）是抛射 ⇒ 命中那一拍要等弹着地。
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

/** 一只挨打的怪：站位每拍钉回（它 idle 也会自己走过来）；血量拉满（不会死） */
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

/** 出一记轻击，量：命中那一拍（相对出手那一拍）＋ 手能再动的那一拍 */
function lightTiming(w: World, e: ReturnType<World['ai']['spawn']>): { hit: number; end: number } {
  const p = w.player
  const start = w.time.tick + 1
  w.frame.edges.add('attackLight')
  w.tick()
  w.frame.edges.delete('attackLight')
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
  return { hit, end }
}

describe('KI-261 §4.1–§4.6 那六张 Moveset 表的帧列（Startup／Active／Recovery）', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 直剑 L1：命中在**第 12 拍**（设计 Startup 12f），手在**第 30 拍**又能动（设计 12＋6＋12 ＝ 30f）⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const t = lightTiming(w, e)
    expect(t.hit, '命中那一拍（设计的 Startup ＝ 12f）').toBe(12)
    expect(t.end, '手能再动的那一拍（设计的 Startup＋Active＋Recovery ＝ 12＋6＋12 ＝ 30f）').toBe(30)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② 直剑 L1 的**判定窗是闭区间**：怪在第 18 拍才进框 ⇒ 打得着；第 19 拍才进框 ⇒ **打不着** ⇒ 运行时那把窗比设计那 6f **多一帧** ⇒ 登记', () => {
    // 怪先站在判定框外，第 T 拍才挪进来
    const run = (T: number): number => {
      const w = makeWorld()
      const p = w.player
      p.pos = { x: 0, y: 0, z: 0 }
      p.yaw = Math.PI
      p.camYawRef = Math.PI + p.yaw
      for (const k of Object.keys(p.rpg.attrs)) (p.rpg.attrs as any)[k] = 0
      const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'probe')
      e.alertness = 0
      e.enter('idle')
      e.stats.hpMax = 999999
      e.stats.hp = 999999
      const start = w.time.tick + 1
      let moved = false
      w.pins.push(() => {
        // pin 在 `time.tick++` 之前跑 ⇒ 当前的拍号是 `time.tick - start + 2`
        if (!moved && w.time.tick - start + 2 >= T) {
          moved = true
          e.pos.x = 0
          e.pos.y = 0
          e.pos.z = -1.6
        }
        e.yaw = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z)
      })
      w.frame.edges.add('attackLight')
      w.tick()
      w.frame.edges.delete('attackLight')
      let hit = -1
      for (let i = 0; i < 120 && hit < 0; i++) {
        w.tick()
        if (w.hits.filter((h) => h.victimId === e.id).length > 0) hit = w.time.tick - start + 1
      }
      w.ai.despawn(e.id)
      w.off()
      return hit
    }
    expect(run(18), '怪在第 18 拍进框 ⇒ **那一记还打得着**（窗是闭的：12…18）').toBe(18)
    expect(run(19), '怪在第 19 拍进框 ⇒ **那一记打不着**（窗已经关了）⇒ 运行时那把窗 = 12…18 ＝ **7 帧**，设计那一列写的是 6f ⇒ 多一帧 ⇒ 登记（与 KI-249 那条 i-frame 窗同一个口径问题：设计写的是半开区间的拍数，运行时是闭区间）').toBe(-1)
  })

  it('腿③ 直剑重击 H：命中在**第 30 拍**（设计 Startup 30f），手在**第 63 拍**又能动（设计 30＋9＋24 ＝ 63f）⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const p = w.player
    const start = w.time.tick + 1
    w.frame.held.add('attackHeavy')
    w.tick(5)
    w.frame.held.delete('attackHeavy')
    w.tick()
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
    expect(hit, '重击命中那一拍（**重击那一式是从松手那一刻起算的**：按住 5 拍、第 6 拍松手 ⇒ 那一式从第 6 拍起算，命中落在它自己的第 30 拍 ＝ 6＋30−1 ＝ 35）').toBe(35)
    expect(end, '手能再动的那一拍（**那一式整段 ＝ 设计的 30＋9＋24 ＝ 63 拍** ⇒ 6＋63−1 ＝ 68）').toBe(68)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ 直剑的**蓄力阈值是 48 拍（800ms）**：按住 47 拍松手 ⇒ 什么也没发生；按住 48 拍松手 ⇒ 蓄力那一式出来了 ⇒ 逐字对上（设计「蓄 800ms」）', () => {
    // 47 拍：两边不靠 ⇒ 什么也没有
    const a = makeWorld()
    const ea = dummy(a)
    a.frame.held.add('attackHeavy')
    a.tick(47)
    a.frame.held.delete('attackHeavy')
    a.tick(3)
    expect(a.hits.filter((h) => h.victimId === ea.id).length, '**按住 47 拍松手 ⇒ 什么也没打出来**（< 8 拍给重击、≥ 48 拍给蓄力、8…47 那一段是死区）⇒ 登记').toBe(0)
    a.ai.despawn(ea.id)
    a.off()

    // 48 拍：蓄力那一式
    const b = makeWorld()
    const eb = dummy(b)
    const p = b.player
    const start = b.time.tick + 1
    b.frame.held.add('attackHeavy')
    b.tick(48)
    b.frame.held.delete('attackHeavy')
    b.tick()
    expect(p.action?.key, '**按住 48 拍松手 ⇒ 蓄力那一式出来了**（阈值 48 拍 ＝ 800ms ＝ 设计「蓄 800ms」那一格）').toBe('charged')
    let hit = -1
    for (let i = 0; i < 200 && hit < 0; i++) {
      b.tick()
      if (b.hits.filter((h) => h.victimId === eb.id).length > 0) hit = b.time.tick - start + 1
    }
    let end = -1
    for (let i = 0; i < 200 && end < 0; i++) {
      b.tick()
      if (!p.action) end = b.time.tick - start + 1
    }
    expect(hit, '蓄力那一记命中在第几拍（**相对出招那一拍**：松手在第 48 拍、那一式自己的起手是 20 拍 ⇒ 68）').toBe(68)
    expect(end, '蓄力那一式整段走完在第几拍（**相对出招那一拍**：48＋56 ＝ 104）').toBe(104)
    b.ai.despawn(eb.id)
    b.off()
  })

  it('腿⑤ 另外三把的 L1 帧列：枪 **16／37**、静默针 **11／22**、杖 **13／32** ⇒ 逐字对上（**弓那一把本批没量**：它是抛射 ⇒ 命中那一拍不等于是判定帧 ⇒ 设计 §4.4 那一行自己写的注记已经把它的口径钉住了）', () => {
    for (const [wid, hit, end] of [
      ['wp_drawpin_spear', 16, 37],
      ['wp_needlesilence', 11, 22],
      ['wp_tuningfork_staff', 13, 32],
    ] as const) {
      const w = makeWorld(wid)
      const e = dummy(w)
      const t = lightTiming(w, e)
      expect(t.hit, `${wid} 的 L1 命中那一拍（设计的 Startup）`).toBe(hit)
      expect(t.end, `${wid} 的 L1 整段走完那一拍（设计的 Startup＋Active＋Recovery）`).toBe(end)
      w.ai.despawn(e.id)
      w.off()
    }
  })
})
