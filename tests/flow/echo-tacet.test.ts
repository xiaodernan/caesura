import { describe, expect, it } from 'vitest'
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
import type { Enemy } from '@/ai/Enemy'
import type { Vec3 } from '@/combat/EntityStats'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { TIMBITE } from '@/rpg/Upgrade'
import { SCORE, movementConfig } from '@/rpg/Movements'

/**
 * §7.2 乐章 IV 的另两式（KI-037①）：**定音回响**与**无声协奏**第一次整句成立。
 *
 * 设计原文各只有一格（progression.md §7.2）：
 * - 定音回响「下一次弹反窗口 ×2（200ms）且必挂破势 | 过载 6 | 1/2/2 次充能」——
 *   加宽吃 `echo.windowMul`（6f 基准窗在 player.json），破势时长吃 reactions.json 的 R4，
 *   测试里一个毫秒数都不抄（§55）。
 * - 无声协奏「7s 内全部行动零噪音 + 伤害 +15%」——零噪音的闸口是 `noise()` 那**一个**函数，
 *   加伤挂在 `strikeEnemy` 那条**唯一**伤害通道上。两腿各测一条，另加冷却与到期。
 *
 * 弹反腿走真输入边沿 + 真招式落点（同 `milestone-grants.test.ts` 的打法）；
 * 伤害腿走同脚本两世界对照（同 `movements.test.ts` 的打法）。
 */

registerGameData()

const ECHO = 'mv_perfectingecho'
const TACET = 'mv_tacetconcerto'
const FOE = 'en_tympanus' // poise 90：一次普通弹反（+25 架势）压不垮它，"必挂破势"才分得出真假
const FOE_POS: Vec3 = { x: 0, y: 0, z: -1.5 }

const move = (id: string) => {
  const m = movementConfig().movements.find((x) => x.id === id)
  if (!m) throw new Error(`movements.json 里没有 ${id}：本用例的前提失效`)
  return m
}

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
    hasFlag: (k) => streaming.hasFlag(k)
  }, (p: Vec3) => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) })

  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  interface Hit { attackerId: string; victimId: string; damage: number }
  const hits: Hit[] = []
  const sounds: number[] = []
  const results: string[] = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push(p as unknown as Hit)),
    bus.on('combat.hit', (p) => results.push(p.result)),
    bus.on('sound.source', (p) => { if (p.id === 'player') sounds.push(p.loudness) })
  ]

  /** 把敌人钉成墙：位置/血量/架势全冻住，攻击一律作废（伤害对照腿只要一面会挨打的墙） */
  const pins: Array<{ e: Enemy; pos: Vec3 }> = []
  function pin(e: Enemy): Enemy { pins.push({ e, pos: { ...e.pos } }); return e }

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      player.stats.hp = player.stats.hpMax
      player.stats.stamina = player.stats.staMax
      player.stunTicks = 0
      player.crumpleTicks = 0
      for (const { e, pos } of pins) {
        if (!e.alive) continue
        e.stats.hp = e.stats.hpMax
        e.stats.dead = false
        e.stats.poiseAccum = 0
        e.stats.crumpleTicksLeft = 0
        e.attack = null
        e.pos.x = pos.x; e.pos.y = pos.y; e.pos.z = pos.z
      }
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, hits, sounds, results, pin, off }
}

type World = ReturnType<typeof makeWorld>

function reachRank(w: World, rank: number): void {
  for (let i = 0; i < 40 && w.rpg.prog.rank < rank; i++) w.rpg.prog.addResonance(300)
  expect(w.rpg.prog.rank, `抬不到音级 ${rank}`).toBeGreaterThanOrEqual(rank)
}

/** 点亮页 → 开槽 → 装上 → 灌给玩家（与 main.ts 的 refreshRpg 同口径）；返回输入动作名 */
function equipMove(w: World, movementId: string, slot: number): string {
  const book = w.rpg.moves
  const mv = move(movementId)
  const page = book.page(mv.page)!
  if (!book.isLit(page.id)) {
    // 乐章 IV 的页走旗标解锁（KI-037）：写方在 worldstate 规则，此处等价发生
    if (page.unlock.flag) bus.emit('world.flag', { key: page.unlock.flag, value: true })
    else w.rpg.inv.add(page.unlock.item ?? '', page.unlock.count ?? 0)
    expect(book.unlockPage(page.id, w.rpg.inv).ok).toBe(true)
  }
  reachRank(w, book.slotRank(slot)!)
  expect(book.equip(slot, movementId, w.rpg.prog.rank).ok).toBe(true)
  w.player.applyRpg(w.rpg.mods())
  w.player.setSkills(w.rpg.skillLoadout())
  return book.cfg.slots[slot].action
}

function faceAt(w: World, p: Vec3): void {
  w.player.pos.x = 0; w.player.pos.y = 0; w.player.pos.z = 0
  w.player.yaw = Math.atan2(p.x - w.player.pos.x, p.z - w.player.pos.z)
  w.player.camYawRef = Math.PI + w.player.yaw
}

function settle(w: World): void {
  for (let i = 0; i < 200 && w.player.action; i++) w.tick()
  expect(w.player.action, '这一式收不完：帧表有问题').toBeNull()
}

/** 装上、付过载、出手、收到动作结束 */
function castMove(w: World, key: string): void {
  const cast = w.player.skills[key].cast
  w.player.stats.overdrive = cast.overdriveCost
  expect(w.player.tryStartAction(key, w.time.tick), '过载付得起就该出式').toBe(true)
  settle(w)
}

/** 只在**可弹的**那一记落下前开窗（同 milestone-grants 的真边沿打法）；返回结果序列里出现过的 outcome */
function waitForParry(w: World, e: Enemy, cap = 1200): boolean {
  for (let t = 0; t < cap; t++) {
    const p = w.player.pos
    w.player.yaw = Math.atan2(e.pos.x - p.x, e.pos.z - p.z)
    const atk = e.attack
    if (atk && atk.spec.id === 'mallet' && atk.tick === atk.spec.frames.startup - 3) {
      w.frame.edges.add('parry')
    }
    w.tick()
    if (w.results.includes('parry')) return true
    if (!e.alive) return false
  }
  return false
}

describe('§7.2 定音回响：充能开花在弹反窗上（KI-037①）', () => {
  it('运行时读到的就是表里那格：充能数与加宽乘数都来自 movements.json', () => {
    const w = makeWorld()
    const mv = move(ECHO)
    const key = equipMove(w, ECHO, 0)
    const cast = w.player.skills[key].cast
    expect(cast.echoCharges, '充能').toBe(mv.levels[0].echoCharges)
    expect(cast.parryWindowMul, '乘数住在式子上的 echo 块，不是代码里的 ×2').toBe(mv.echo!.windowMul)
    expect(cast.overdriveCost).toBe(mv.cost.overdrive)
    castMove(w, key)
    expect(w.player.echo?.chargesLeft, '出手存进身上的充能数 == 表值').toBe(mv.levels[0].echoCharges!)
    w.off()
  })

  it('回响窗真的宽一倍、走完回落普通窗；充能在**开窗那一格**就花掉', () => {
    const w = makeWorld()
    const { activeTicks } = w.player.base.parry
    const mul = move(ECHO).echo!.windowMul
    const key = equipMove(w, ECHO, 0)
    castMove(w, key)

    w.frame.edges.add('parry')
    w.tick()
    expect(w.player.parryTicksLeft, '回响窗 == 基准窗 ×乘数（倒数已走一格）').toBe(activeTicks * mul - 1)
    expect(w.player.parryEchoLive).toBe(true)
    w.tick(activeTicks * mul - 1)
    expect(w.player.parryTicksLeft, '回响窗走完').toBe(0)
    expect(w.player.echo, 'L1 只有一格，花完就空').toBeNull()
    expect(w.player.parryEchoLive, '窗一关，回响这一格翻篇').toBe(false)
    expect(w.player.parryWhiffTicks, '落空账与 §5.3 共用同一本（KI-054）').toBe(w.player.base.parry.whiffRecovery)

    w.tick(w.player.base.parry.whiffRecovery)
    w.frame.edges.add('parry')
    w.tick()
    expect(w.player.parryTicksLeft, '没有充能了 ⇒ 普通窗').toBe(activeTicks - 1)
    w.off()
  })

  it('升到 L2 拿到 2 格：两扇窗都加宽，第三扇才是普通的（1/2/2 的表腿）', () => {
    const w = makeWorld()
    const { activeTicks } = w.player.base.parry
    const mul = move(ECHO).echo!.windowMul
    const key = equipMove(w, ECHO, 0)
    w.rpg.inv.add(TIMBITE, 400)
    w.rpg.inv.add(SCORE, 5)
    expect(w.rpg.moves.upgrade(ECHO, w.rpg.inv).ok, '升级的学费（残页+音色石）齐了就该升').toBe(true)
    w.player.applyRpg(w.rpg.mods())
    w.player.setSkills(w.rpg.skillLoadout())
    expect(w.player.skills[key].cast.level).toBe(2)

    castMove(w, key)
    for (const n of [1, 2]) {
      w.frame.edges.add('parry')
      w.tick()
      expect(w.player.parryTicksLeft, `第 ${n} 扇回响窗加宽`).toBe(activeTicks * mul - 1)
      w.tick(activeTicks * mul - 1)
      expect(w.player.parryTicksLeft).toBe(0)
      w.tick(w.player.base.parry.whiffRecovery) // 等落空锁走完再开下一扇
    }
    expect(w.player.echo, '两格花完').toBeNull()
    w.frame.edges.add('parry')
    w.tick()
    expect(w.player.parryTicksLeft, '第三扇回到普通宽度').toBe(activeTicks - 1)
    w.off()
  })

  it('必挂破势：回响窗弹中 Tympanus（poise 90）当场塌；对照组普通弹反只是失衡', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { ...FOE_POS }, 'echo-crush') as Enemy
    e.alertness = 100; e.enter('chase')
    const key = equipMove(w, ECHO, 0)
    castMove(w, key)
    faceAt(w, e.pos)
    expect(waitForParry(w, e), '1200 tick 没等到那记 mallet 被弹中').toBe(true)
    expect(e.stats.crumpleTicksLeft, '回响弹中 ⇒ 必挂破势（时长 = reactions.json R4）').toBeGreaterThan(0)
    expect(e.stats.crumpleTicksLeft).toBe(e.stats.crumpleTicks)
    w.off()

    const c = makeWorld()
    const foe = c.ai.spawn(FOE, { ...FOE_POS }, 'echo-control') as Enemy
    foe.alertness = 100; foe.enter('chase')
    expect(waitForParry(c, foe), '对照组也得弹中，否则这条 A/B 测的是空气').toBe(true)
    expect(foe.stats.crumpleTicksLeft, '没有回响：一发弹反的 25 架势压不垮 90 的 poise').toBe(0)
    c.off()
  })

  it('回响窗落空：充能照花，破势不欠——赌注与 §5.3 同一条账', () => {
    const w = makeWorld()
    const { activeTicks } = w.player.base.parry
    const mul = move(ECHO).echo!.windowMul
    const key = equipMove(w, ECHO, 0)
    castMove(w, key)
    w.frame.edges.add('parry')
    w.tick()
    expect(w.player.parryEchoLive).toBe(true)
    w.tick(activeTicks * mul - 1)
    expect(w.player.echo, '没弹到也已经在开窗那一格花掉了').toBeNull()
    expect(w.player.parryWhiffTicks, '落空后摇照挂').toBe(w.player.base.parry.whiffRecovery)
    w.off()
  })
})

describe('§7.2 无声协奏：七秒的静默与那 +15%（KI-037①）', () => {
  it('表值直通身上：silenceTicks 就是身上那格的余量，走完自己归零', () => {
    const w = makeWorld()
    const L = move(TACET).levels[0]
    const key = equipMove(w, TACET, 0)
    castMove(w, key)
    expect(w.player.tacet, '出手即生效（时长住在表里，代码没有第二份 7s）').toBeTruthy()
    const spent = w.time.tick
    expect(w.player.tacet!.ticksLeft).toBe(L.silenceTicks! - spent)
    w.tick(L.silenceTicks!)
    expect(w.player.tacet, '到点自然散场').toBeNull()
    w.off()
  })

  it('窗口内挥击的 sound.source 响度是 0；到期后同一式恢复发声', () => {
    const w = makeWorld()
    faceAt(w, { x: 0, y: 0, z: -5 })
    expect(w.player.tryStartAction('l1', w.time.tick)).toBe(true)
    settle(w)
    expect(w.sounds.at(-1), '前提交警：普通挥击本来是响的').toBeGreaterThan(0)
    const loud = w.sounds.at(-1)!

    const key = equipMove(w, TACET, 0)
    castMove(w, key)
    w.sounds.length = 0
    expect(w.player.tryStartAction('l1', w.time.tick)).toBe(true)
    settle(w)
    expect(w.sounds.length, '窗口内挥击要发出读数（事件照发，响度才是那条腿）').toBeGreaterThan(0)
    expect(w.sounds, '全部行动零噪音：每一个出口都是 0').toEqual(w.sounds.map(() => 0))

    w.player.tacet = null // 只快进时钟不重演机制：到期那条由上一条测
    w.sounds.length = 0
    expect(w.player.tryStartAction('l1', w.time.tick)).toBe(true)
    settle(w)
    expect(w.sounds.at(-1), '静默散了，同一记挥击回到原来的响度').toBe(loud)
    w.off()
  })

  it('伤害 +15% 挂在唯一通道上：同脚本两世界，差值恰好是 round(基准 × (1+表值))', () => {
    const bonus = move(TACET).levels[0].silenceDmgBonus!
    expect(bonus, '夹具前提：表值 >0').toBeGreaterThan(0)
    const strikeWith = (useTacet: boolean): number => {
      const w = makeWorld()
      let key = ''
      if (useTacet) {
        key = equipMove(w, TACET, 0)
        w.player.stats.overdrive = w.player.skills[key].cast.overdriveCost
        expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
      }
      const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'tacet-dmg'))
      faceAt(w, e.pos)
      w.tick(45) // 两世界同一长度：回响式的 recovery 40 < 45，出手世界等的是同一个相位
      expect(w.player.tryStartAction('l1', w.time.tick)).toBe(true)
      let dmg = 0
      for (let i = 0; i < 120 && !dmg; i++) {
        w.tick()
        dmg = w.hits.find((h) => h.attackerId === 'player' && h.victimId === e.id)?.damage ?? 0
      }
      w.off()
      return dmg
    }
    const plain = strikeWith(false)
    const hushed = strikeWith(true)
    expect(plain, '对照组没打出伤害：夹具失效').toBeGreaterThan(0)
    expect(hushed, '加伤等式：最终那一格正好乘在基准上（先取整再乘，同一先例）').toBe(Math.round(plain * (1 + bonus)))
  })

  it('冷却是数据腿：同一式在冷却里出不手，走完 CD 才再出（价 = 表里的 overdrive）', () => {
    const w = makeWorld()
    const mv = move(TACET)
    const key = equipMove(w, TACET, 0)
    castMove(w, key)
    w.player.stats.overdrive = mv.cost.overdrive!
    expect(w.player.tryStartAction(key, w.time.tick), '冷却中拒出手').toBe(false)
    w.tick(mv.levels[0].cooldownTicks + 2)
    w.player.stats.overdrive = mv.cost.overdrive!
    expect(w.player.tryStartAction(key, w.time.tick), 'CD 走完再出').toBe(true)
    w.off()
  })
})
