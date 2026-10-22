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
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-279：**§13.0「感知模型」那张表第一次在真链上被量**（combat.md §13.0 的四列：
 * **视觉**（视锥 距离 18-30m／角 100° ＋ 高度遮挡检查）／**震感**（半径 4-10m 内移动·落地·疾跑触发，
 * 「静止＝对震感隐形」）／**听觉**（全局事件总线：按噪音半径广播）／**Alertness 0-100**
 * （视觉 +34/s、震感瞬 +40、噪音按强度；≥60→Alert、≥100→Combat；衰减 −20/s；被弹反目击者 +100））。
 *
 * **量法**：把玩家摆在不同距离与不同朝向（一格一格逼近视距／视锥／震感半径／听觉半径）⇒
 * 读那只怪的**警觉值**涨了多少 ⇒ 那一列的半径、角与速率就量出来了。
 *
 * **三条量具纪律**：
 * ① **要在 combat 态量速率**（那一态没有警觉衰减 ⇒ 净涨就是感知那一路；在 idle 态量到的是
 *    是「+34/s 减去 20/s 的衰减」）；
 * ② **怪要钉住位置与朝向**（idle 态的 `faceSlow` 会把它转回出生点 ⇒ 视锥那一格量不干净）；
 * ③ **量震感要把怪背对玩家**（视觉那一支是 `else if` ⇒ 玩家在视锥里时震感那一支根本不跑）。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
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
  const off = bus.on('combat.hit', () => {})
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
  return { time, rhythm, player, ai, combat, streaming, spawner, frame, tick, off, pins }
}

type World = ReturnType<typeof makeWorld>
type Enemy = ReturnType<World['ai']['spawn']>

/** 一只怪：钉住位置与朝向（`faceSlow` 会把它转回去 ⇒ 不钉就读不到视锥那一格） */
function spawn(w: World, id = 'en_murkshell', x = 0, z = 0): Enemy {
  const e = w.ai.spawn(id, { x, y: 0, z }, 'probe')
  e.alertness = 0
  w.pins.push(() => {
    e.pos.x = x
    e.pos.z = z
  })
  return e
}

/** 把玩家摆到 (px,pz)，并把怪钉成朝向 yawDeg（缺省＝正对着玩家） */
function setup(w: World, e: Enemy, px: number, pz: number, yawDeg?: number): void {
  w.player.pos = { x: px, y: 0, z: pz }
  w.player.camYawRef = 0
  const yaw = yawDeg === undefined ? Math.atan2(px - e.pos.x, pz - e.pos.z) : (yawDeg * Math.PI) / 180
  e.yaw = yaw
  w.pins.push(() => { e.yaw = yaw })
}

/** 把它放进 combat 态并把警觉值拨到 40（那一态没有衰减 ⇒ 净涨就是感知那一路；40 也不是「警觉 < 40 ⇒ 换态」那一档） */
function armed(w: World, e: Enemy): void {
  e.enter('combat')
  e.alertness = 40
}

/** 体力条的花法：true ＝ 花过（不满）｜false ＝ 满 */
function stamina(w: World, spent: boolean): void {
  w.player.stats.stamina = spent ? 50 : w.player.stats.staMax
}

describe('KI-279 §13.0 感知模型那张表：视觉／震感／听觉／警觉值', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **视觉的距离那一格是敌人表自己那一格**：11m 看得见（警觉值涨）、13m 看不见（不涨）⇒ 视距 12m（设计写的是 18-30m）⇒ 登记', () => {
    const a = makeWorld()
    const ea = spawn(a)
    setup(a, ea, 0, 11)
    const a0 = ea.alertness
    a.tick(60)
    expect(ea.alertness - a0, '**11m ⇒ 看得见**（警觉值涨）').toBeGreaterThan(0)
    const b = makeWorld()
    const eb = spawn(b)
    setup(b, eb, 0, 13)
    const b0 = eb.alertness
    b.tick(60)
    expect(eb.alertness - b0, '**13m ⇒ 看不见**（警觉值一个字节不动）').toBe(0)
    alive.push(a.off, b.off)
  })

  it('腿② **视觉的视锥那一格**：39° 看得见、41° 看不见 ⇒ 视锥 80°（半角 40°；设计写的是 100°）⇒ 登记', () => {
    const mk = (deg: number) => {
      const w = makeWorld()
      const e = spawn(w)
      setup(w, e, 0, 5, deg)
      stamina(w, false) // 体力满 ⇒ 震感那一支关着 ⇒ 这一格只量视觉
      armed(w, e)
      const a0 = e.alertness
      w.tick(6)
      return { rise: e.alertness - a0 }
    }
    expect(mk(39).rise, '**偏 39° ⇒ 看得见**（一个感知拍 +3.4）').toBeCloseTo(3.4, 5)
    expect(mk(41).rise, '**偏 41° ⇒ 看不见**（半角是 40°）').toBe(0)
    alive.push(makeWorld().off)
  })

  it('腿③ **视觉的速率**：**+34/s** ⇒ 与设计「视觉 +34/s」**逐字对上**', () => {
    const w = makeWorld()
    const e = spawn(w)
    setup(w, e, 0, 5)
    armed(w, e)
    const a0 = e.alertness
    w.tick(60)
    expect(e.alertness - a0, '**一秒（60 拍）涨 34**（10 次感知 × 3.4）').toBeCloseTo(34, 5)
    alive.push(w.off)
  })

  it('腿④ **震感那一格**：背后 4m ＋ 体力花过 ⇒ **+40**（一个感知拍）；**体力满 ⇒ 0**；9m ⇒ 0 ⇒ 半径是敌人表自己那一格（8m）＋ **「静止＝对震感隐形」在运行时是「体力条满了才隐形」** ⇒ 登记', () => {
    const mk = (dz: number, spent: boolean) => {
      const w = makeWorld()
      const e = spawn(w)
      setup(w, e, 0, dz, 180) // 怪背对玩家 ⇒ 视锥不成立 ⇒ 走震感那一支
      armed(w, e)
      stamina(w, spent)
      const a0 = e.alertness
      w.tick(6)
      return { rise: e.alertness - a0, w }
    }
    const near = mk(4, true)
    expect(near.rise, '**背后 4m ＋ 体力花过 ⇒ +40**（设计「震感瞬 +40」）').toBeCloseTo(40, 5)
    expect(mk(4, false).rise, '**体力条是满的 ⇒ 0**（「静止＝对震感隐形」在运行时是「体力条满了才隐形」）').toBe(0)
    expect(mk(9, true).rise, '**9m（超出震感半径 8m）⇒ 0**').toBe(0)
    alive.push(near.w.off)
  })

  it('腿⑤ **视觉与震感是互斥的两支**（设计把它们写成两条独立通道）：玩家在视锥里 ⇒ **震感那一支根本不跑**（只读到视觉的 +3.4，没有 +40）⇒ 登记', () => {
    const w = makeWorld()
    const e = spawn(w)
    setup(w, e, 0, 4)
    armed(w, e)
    stamina(w, true) // 体力花过 ⇒ 震感那一支本来是开着的
    const a0 = e.alertness
    w.tick(6)
    expect(e.alertness - a0, '**只涨视觉的 3.4，没有震感的 40**').toBeCloseTo(3.4, 5)
    alive.push(w.off)
  })

  it('腿⑥ **听觉那一格**：响度 0.5 ⇒ **+60**（＝响度 × 120）；14m 听得到、16m 听不到 ⇒ 半径是敌人表自己那一格（15m）', () => {
    const mk = (dz: number, loudness: number) => {
      const w = makeWorld()
      const e = spawn(w)
      setup(w, e, 0, dz, 180)
      const a0 = e.alertness
      bus.emit('sound.source', { id: 'player', pos: { x: 0, y: 0, z: dz }, loudness })
      return { rise: e.alertness - a0, w }
    }
    const near = mk(14, 0.5)
    expect(near.rise, '**14m 外的响度 0.5 ⇒ +60**（＝响度 × 120）').toBeCloseTo(60, 5)
    expect(mk(16, 0.5).rise, '**16m 外 ⇒ 0**（听觉半径 15m）').toBe(0)
    expect(mk(14, 1).rise, '**响度 1 ⇒ +120 被警觉值封在 100**').toBe(100)
    alive.push(near.w.off)
  })

  it('腿⑦ **目击报警那一格**：弹反冲击被看见 ⇒ 警觉值 **100** ＋ 进 chase；不在视锥里 ⇒ 什么也没有 ⇒ 与设计「被弹反／完美格挡目击者 +100（瞬间报警）」**逐字对上**', () => {
    const a = makeWorld()
    const ea = spawn(a)
    setup(a, ea, 0, 5)
    ea.sawImpact({ x: 0, y: 0, z: 5 }, 1, null)
    expect(ea.alertness, '**警觉值直接 100**').toBe(100)
    expect(ea.state, '**进 chase**').toBe('chase')
    const b = makeWorld()
    const eb = spawn(b)
    setup(b, eb, 0, 5, 180)
    eb.sawImpact({ x: 0, y: 0, z: 5 }, 1, null)
    expect(eb.alertness, '**不在视锥里 ⇒ 什么也没有**').toBe(0)
    expect(eb.state, '（状态也没动）').toBe('idle')
    alive.push(a.off, b.off)
  })

  it('腿⑧ **那些半径是逐怪取的，不是全局常数**：tympanus 看得见 **17m**、看不见 **19m**（它的视距 18m）⇒ 设计「18-30m」只是表里的一段 ⇒ 登记', () => {
    const mk = (dz: number) => {
      const w = makeWorld()
      const e = spawn(w, 'en_tympanus')
      setup(w, e, 0, dz)
      const a0 = e.alertness
      w.tick(60)
      return { rise: e.alertness - a0, w }
    }
    const near = mk(17)
    expect(near.rise, '**tympanus 看得见 17m**').toBeGreaterThan(0)
    expect(mk(19).rise, '**tympanus 看不见 19m**').toBe(0)
    alive.push(near.w.off)
  })
})
