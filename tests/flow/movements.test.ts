import { movementName } from '@/rpg/Movements'
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { ItemData, MovesetData, WeaponData } from '@/data/schema'
import type { EnemyData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'
import type { Projectile } from '@/combat/Projectiles'
import type { Vec3 } from '@/combat/EntityStats'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { TIMBITE } from '@/rpg/Upgrade'
import { SCORE, movementConfig } from '@/rpg/Movements'
import { SaveGame, MapStore, SAVE_VERSION } from '@/save/Serializer'
import { wrap } from '@/save/Integrity'

/**
 * 乐章战技的**行为**验收（progression.md §7；需求 §59 自动化 gameplay flow）。
 * `tests/unit/movements.test.ts` 管「点亮/升级/装槽的账对不对」，这一份管
 * 「装上去之后打出去的那一下，是不是数据说的那一下」。全部走真通道：出手只经
 * `tryStartAction`，伤害只从 `CombatManager.strikeEnemy` 进，时间只靠手动 tick 步进。
 *
 * 对照类断言沿用 tests/flow/status.test.ts 的打法：同一颗种子、同一段动作序列 ⇒
 * `CombatManager.rng` 逐位相同，于是两世界的**差值**正好就是我们要验的那一笔。
 * 数值一律回读数据表，测试里不抄第二份常量（§55）。
 */

const WHOLE = 'mv_wholenotecut' // 乐章 I：自己不出伤害，把数值压在下一记重击上
const SYNC = 'mv_syncopace' // 乐章 II：瞬步
const BURST = 'mv_chordburst' // 乐章 III：全周环 + 闷音
const FOE = 'en_tympanus' // 240 血 / DEF 20 的近战杂兵：一记战技打不死，正好用来读伤害
/** 这个距离上武器的轻/重击与 4m 环都够得着，又不会贴到重叠 */
const FOE_POS: Vec3 = { x: 0, y: 0, z: -1.8 }

const move = (id: string) => {
  const m = movementConfig().movements.find((x) => x.id === id)
  if (!m) throw new Error(`movements.json 里没有 ${id}：本用例的前提失效`)
  return m
}

interface Hit { attackerId: string; victimId: string; damage: number; kind: string; result: string; poiseDamage: number }

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout()) // 与 main.ts 的 refreshRpg 同一个口径
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

  const hits: Hit[] = []
  const notes: string[] = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push(p as unknown as Hit)),
    bus.on('ui.notify', (p) => notes.push(p.text))
  ]

  const pins: Array<{ e: Enemy; pos: Vec3 }> = []
  /**
   * 把敌人钉成一面墙：位置、血量、**架势**都冻住，它的攻击一律作废。
   * 架势必须一起钉：破势的 ×1.5 是乘在伤害上的，两个世界只要出手时刻不同，就可能一个破势一个没破，
   * 那「差值恰好等于真伤」这类断言就被无关变量污染了。本文件不测破势（那是 combat/status 的事）。
   */
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
  const off = (): void => offs.forEach((f) => f())
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, hits, notes, pin, off }
}

type World = ReturnType<typeof makeWorld>

/** 把音级抬到 n：槽是音级开的，要装第几槽就先长到第几级 */
function reachRank(w: World, rank: number): void {
  for (let i = 0; i < 40 && w.rpg.prog.rank < rank; i++) w.rpg.prog.addResonance(300)
  expect(w.rpg.prog.rank, `抬不到音级 ${rank}：里程碑与等级曲线对不上`).toBeGreaterThanOrEqual(rank)
}

/** 点亮该式所在的页、开到该槽的音级、装上它、按 main.ts 的口径灌给玩家；返回输入动作名 */
function equipMove(w: World, movementId: string, slot: number): string {
  const book = w.rpg.moves
  const mv = move(movementId)
  const page = book.page(mv.page)
  if (!page) throw new Error(`谱册里没有页 ${mv.page}`)
  if (!book.isLit(page.id)) {
    if (page.unlock.flag) bus.emit('world.flag', { key: page.unlock.flag, value: true })
    else w.rpg.inv.add(page.unlock.item ?? '', page.unlock.count ?? 0)
    expect(book.unlockPage(page.id, w.rpg.inv).ok, page.id).toBe(true)
  }
  reachRank(w, book.slotRank(slot)!)
  expect(book.equip(slot, movementId, w.rpg.prog.rank).ok).toBe(true)
  w.player.applyRpg(w.rpg.mods())
  w.player.setSkills(w.rpg.skillLoadout())
  return book.cfg.slots[slot].action
}

/** 让玩家在原点朝住目标（朝向口径与 status.test 一致） */
function faceAt(w: World, p: Vec3): void {
  w.player.pos.x = 0; w.player.pos.y = 0; w.player.pos.z = 0
  w.player.yaw = Math.atan2(p.x - w.player.pos.x, p.z - w.player.pos.z)
  w.player.camYawRef = Math.PI + w.player.yaw
}

/**
 * **位移方向与朝向的夹角**（KI-209，度）：朝向向量 ＝ (sin yaw, cos yaw)，
 * 与 `hitTarget().facingYaw` 同一支笔。0°＝正对朝向，180°＝正对朝向的反面。
 */
function gapTo(yaw: number, dx: number, dz: number): number {
  const l = Math.hypot(dx, dz)
  if (l < 1e-9) return 0
  const d = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / l
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI
}

/** 让这一式自己收完（各把武器的收势帧不一样长，测试不替它猜） */
function settle(w: World): void {
  for (let i = 0; i < 200 && w.player.action; i++) w.tick()
  expect(w.player.action, '这一式收不完：帧表有问题').toBeNull()
}

/** 推进到「下一记落在 target 身上的玩家命中」；null = 预算内没打中 */
function nextHitOn(w: World, victim: Enemy, cap = 120): Hit | null {
  const seen = w.hits.length
  for (let i = 0; i < cap; i++) {
    w.tick()
    const h = w.hits.slice(seen).find((x) => x.attackerId === 'player' && x.victimId === victim.id)
    if (h) return h
  }
  return null
}

/** 武器淬到 +3（素声件的上限，见 rpg/Upgrade.ts） */
function buffWeapon(w: World): void {
  const gear = w.rpg.inv.gears.find((g) => registry.get<ItemData>(g.itemId).gear?.weaponId === w.player.weapon.id)
  expect(gear, '出身武器得在自己的背包里找得着').toBeTruthy()
  w.rpg.inv.add(TIMBITE, 500)
  w.rpg.inv.add('it_dross', 50)
  for (let i = 0; i < 3; i++) expect(w.rpg.upgrade(gear!.uid).ok, `+${i + 1}`).toBe(true)
  w.player.applyRpg(w.rpg.mods())
  expect(w.player.rpg.weaponDamageMul, '前提：强化真的写进了玩家乘数').toBeGreaterThan(1)
}

/** 和弦爆的一记最终伤害（可选：武器淬过没有、出手前攒了几层过载） */
function burstDamage(o: { buff: boolean; overdriveBefore: number }): number {
  const w = makeWorld()
  const key = equipMove(w, BURST, 0)
  if (o.buff) buffWeapon(w)
  const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'burst'))
  faceAt(w, e.pos)
  w.player.stats.overdrive = o.overdriveBefore
  expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
  const dmg = nextHitOn(w, e)?.damage ?? 0
  w.off()
  return dmg
}

/** 武器重击的一记最终伤害 */
function heavyDamage(o: { buff: boolean }): number {
  const w = makeWorld()
  if (o.buff) buffWeapon(w)
  const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'heavy'))
  faceAt(w, e.pos)
  expect(w.player.tryStartAction('h', w.time.tick), '手上这把得有重击这一式').toBe(true)
  const dmg = nextHitOn(w, e)?.damage ?? 0
  w.off()
  return dmg
}

describe('§7 出手：战技与武器共用同一条结算通道', () => {
  it('和弦爆的命中被标成 skill，伤害来自等级表而不是武器帧', () => {
    const w = makeWorld()
    const key = equipMove(w, BURST, 0)
    const cast = w.player.skills[key].cast
    expect(cast.damage, '前提：这一式自己出伤害').toBeGreaterThan(0)
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'kind'))
    faceAt(w, e.pos)
    w.player.stats.overdrive = cast.overdriveCost
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
    const hit = nextHitOn(w, e)
    expect(hit, '战技没打中人，后面的断言都是空的').toBeTruthy()
    expect(hit!.kind, '战技走的还是那一条 strikeEnemy，只是标成 skill').toBe('skill')
    expect(hit!.damage).toBeGreaterThan(0)
    expect(e.stats.fissureLayers).toBe(cast.fissureLayers)
    w.off()
  })

  it('战技不吃武器强化：+3 的剑让普攻更重，却让同一记和弦爆一分不变', () => {
    expect(heavyDamage({ buff: true }), '前提：强化真的作用在武器出手上')
      .toBeGreaterThan(heavyDamage({ buff: false }))
    const before = 6 // 扣掉 3 层成本还剩 3 层：这样两条乘数通道都在工作状态
    const plain = burstDamage({ buff: false, overdriveBefore: before })
    expect(plain, '战技一记都没打中 ⇒ 相等只是两个 0 相等').toBeGreaterThan(0)
    expect(burstDamage({ buff: true, overdriveBefore: before }), '淬过剑的世界')
      .toBe(plain)
  })

  it('§11 过载列：每层 +4% 战技伤害，乘的是扣掉成本之后还留在身上的层数', () => {
    const per = movementConfig().damage.perOverdriveLayer
    const cost = move(BURST).cost.overdrive ?? 0
    expect(cost, '前提：这一式要过载').toBeGreaterThan(0)
    const bare = burstDamage({ buff: false, overdriveBefore: cost }) // 扣完就是 0 层余量
    const loaded = burstDamage({ buff: false, overdriveBefore: cost + 7 })
    expect(bare).toBeGreaterThan(0)
    expect(loaded, '余量越多越疼').toBeGreaterThan(bare)
    // 伤害是取整的，比率不可能逐位相等：留 0.05 的容差，够抓住「乘数根本没生效」这一类错
    expect(loaded / bare, `7 层余量 ⇒ ×(1+7×${per})`).toBeCloseTo(1 + 7 * per, 1)
  })

  it('命中者身上挂的就是等级表那个 muteTicks：时长来自施加方（§11）', () => {
    const w = makeWorld()
    const key = equipMove(w, BURST, 0)
    const cast = w.player.skills[key].cast
    expect(cast.muteTicks, '前提：这一式挂闷音').toBeGreaterThan(0)
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'mute'))
    faceAt(w, e.pos)
    w.player.stats.overdrive = cast.overdriveCost
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
    expect(nextHitOn(w, e), '战技没打中人就谈不上挂状态').toBeTruthy()
    expect(e.stats.muteTicksLeft, '下一个 tick 才开始走表 ⇒ 此刻正是施加值').toBe(cast.muteTicks)
    w.off()
  })
})

describe('§7.2 错拍步：位移是数据给的，不是拍子给的', () => {
  /**
   * 出手前后的净位移 + 同一世界里一次翻滚的持续 tick。
   * 移动输入仍在**出手前一 tick**给（旧实现的取法：方向取的是上一拍的输入）；
   * **KI-209 之后方向取的是出手那一刻的朝向**（combat.md §4.8「沿当前朝向位移」）⇒
   * 这里的输入只负责"让人先动一拍"，不再决定这一步的方向。
   */
  function step(o: { bpm?: number; jitter?: number } = {}): { dx: number; dz: number; distance: number; roll: number } {
    const w = makeWorld()
    if (o.bpm) w.rhythm.setBpm(o.bpm, 4)
    const key = equipMove(w, SYNC, 0)
    const distance = w.player.skills[key].cast.distance
    expect(distance, '前提：这一式是位移式').toBeGreaterThan(0)

    // 对照：夺拍的恢复锁漂移真的能拖长翻滚（不然后面那句「战技不受影响」就是空话）
    w.tick()
    w.player.dodgeJitterTicks = o.jitter ?? 0
    w.frame.edges.add('dodge')
    let roll = 0
    do { w.tick(); roll++ } while (w.player.roll && roll < 200)

    faceAt(w, { x: 0, y: 0, z: -10 }) // 朝 -z，位置清零
    w.frame.move = { x: 0, y: 1 } // 屏幕前方＝世界 -z
    w.tick()
    const from = { ...w.player.pos }
    w.frame.move = { x: 0, y: 0 }
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
    w.tick(40)
    const out = { dx: w.player.pos.x - from.x, dz: w.player.pos.z - from.z, distance, roll }
    w.off()
    return out
  }

  it('净位移恰等于等级表里的 distance，方向沿出手那一刻的**当前朝向**（KI-209：修前是沿输入方向）', () => {
    const s = step()
    expect(Math.hypot(s.dx, s.dz), '一步就是表里那么远，不多不少').toBeCloseTo(s.distance, 10)
    expect(s.dx, '没有往旁边漂').toBeCloseTo(0, 10)
    expect(s.dz, '沿朝向推进（这一式朝 -z）').toBeLessThan(0)
  })

  /**
   * **位移方向 ＝ 出手那一刻的朝向**（KI-209）：combat.md §4.8 那一行写的是「沿当前朝向位移」，
   * gameplay.md §3.1 那一行写的是「锁定态下沿目标朝向修正」——两处都要"朝向"这一支。
   *
   * **量法**：让**输入的方向与朝向不同**（输入给 +x，脸朝 -z，差 90°）⇒ 位移必须跟**朝向**。
   * 修前这一式走的是输入方向（而且是**上一拍**的输入：`moveIntent` 在 `update()` 里才刷新，
   * 出手却跑在 `update()` 之前）⇒ 这一条当时是红的。
   */
  it('战技位移沿出手那一刻的朝向（输入给的是别处也不改）', () => {
    const w = makeWorld()
    const key = equipMove(w, SYNC, 0)
    const distance = w.player.skills[key].cast.distance
    faceAt(w, { x: 0, y: 0, z: -10 }) // 脸朝 -z，位置清零
    w.frame.move = { x: 1, y: 0 } // 输入：侧移（+x）——与朝向差 90°
    w.tick()
    w.frame.move = { x: 0, y: 0 }
    const yawAtCast = w.player.yaw
    const from = { ...w.player.pos }
    expect(w.player.tryStartAction(key, w.time.tick), '错拍步没踏出去').toBe(true)
    w.tick(40)
    const dx = w.player.pos.x - from.x
    const dz = w.player.pos.z - from.z
    expect(Math.hypot(dx, dz), '一步就是表里那么远').toBeCloseTo(distance, 2)
    expect(gapTo(yawAtCast, dx, dz), '位移必须沿出手那一刻的朝向（不是输入方向）').toBeLessThan(0.5)
    w.off()
  })

  /**
   * **没有输入时这一步沿朝向走**（KI-209）：修前它往**朝向的反方向**跳
   * （`moveDir()` 在没有输入时回落的是朝向的反方向）⇒ 与 combat.md §4.8 那一行
   * 「沿当前朝向位移」、`schema.ts` 那句「无输入时沿面向」、`moveDir()` 自己的注释
   * 「没有输入就朝正前方」三处都对不上。
   */
  it('没有输入时这一步沿朝向走（修前它往朝向的反方向跳）', () => {
    const w = makeWorld()
    const key = equipMove(w, SYNC, 0)
    faceAt(w, { x: 0, y: 0, z: -10 }) // 脸朝 -z，位置清零
    w.frame.move = { x: 0, y: 0 }
    w.tick() // 没有任何输入
    const yawAtCast = w.player.yaw
    const from = { ...w.player.pos }
    expect(w.player.tryStartAction(key, w.time.tick), '错拍步没踏出去').toBe(true)
    w.tick(40)
    const dx = w.player.pos.x - from.x
    const dz = w.player.pos.z - from.z
    expect(dz, '没有输入时这一步该沿朝向（-z）推进，不许往回跳').toBeLessThan(0)
    expect(gapTo(yawAtCast, dx, dz), '位移方向就是出手那一刻的朝向').toBeLessThan(0.5)
    w.off()
  })

  it('换到 40 BPM 还是那一步：这一式的尺子不挂在拍子上（§7.2 深窖/夺拍保命锚）', () => {
    const fast = step()
    const slow = step({ bpm: 40 })
    expect(Math.hypot(fast.dx, fast.dz), '前提：这一步真的迈出去了').toBeGreaterThan(0)
    expect(Math.hypot(slow.dx, slow.dz)).toBeCloseTo(Math.hypot(fast.dx, fast.dz), 12)
  })

  it('恢复锁漂移拖得动翻滚，拖不动这一步', () => {
    const clean = step()
    const jittered = step({ jitter: 40 })
    expect(jittered.roll, '前提：jitter 真的作用在同一个世界的移动系统上').toBeGreaterThan(clean.roll)
    expect(Math.hypot(jittered.dx, jittered.dz), '战技不读恢复锁：该多少米就多少米')
      .toBeCloseTo(Math.hypot(clean.dx, clean.dz), 12)
  })
})

describe('§7 全周环与多目标：一次出手每人只挨一遍', () => {
  it('multi=8：打满 8 个名额，同一目标不被同一记结两遍，超额与环外的不算', () => {
    const w = makeWorld()
    const key = equipMove(w, BURST, 0)
    const f = w.player.skills[key].f
    const multi = f.multi ?? 1
    const box = f.hitbox
    const outer = box && box.shape === 'ring' ? box.outer : 0
    expect(multi, '前提：这一式写了多目标名额').toBeGreaterThan(1)
    expect(outer, '前提：这一式是全周环').toBeGreaterThan(0)

    const inRing: Enemy[] = []
    for (let i = 0; i < multi + 1; i++) {
      const a = (i / (multi + 1)) * Math.PI * 2
      inRing.push(w.pin(w.ai.spawn(FOE, { x: Math.sin(a) * 2.2, y: 0, z: Math.cos(a) * 2.2 }, `ring${i}`)))
    }
    const far = w.pin(w.ai.spawn(FOE, { x: 0, y: 0, z: -(outer + 6) }, 'far'))
    faceAt(w, inRing[0].pos)
    w.player.stats.overdrive = w.player.skills[key].cast.overdriveCost
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
    w.tick(40) // 整段判定窗跑完

    const byId = new Map<string, number>()
    for (const h of w.hits) if (h.attackerId === 'player') byId.set(h.victimId, (byId.get(h.victimId) ?? 0) + 1)
    expect(byId.size, '名额用尽前一人一记').toBe(multi)
    for (const [, n] of byId) expect(n, '判定窗有好几 tick：同一记不能把同一个人结两遍').toBe(1)
    expect(byId.has(far.id), '环外的没有人替它挨').toBe(false)
    expect(byId.has(inRing[multi].id), '排在名额之后的那个人不打').toBe(false)
    w.off()
  })
})

describe('§7.2 全音符斩：自己不出声，出声的是下一记重击', () => {
  /**
   * 世界 A 先走一次起手式，世界 B 什么都不干；两边都是「轻击 → 重击」，
   * 于是两世界的随机数序列停在同一格上 ⇒ 差值就是起手式那一份。
   */
  function heavyAfterOpening(withOpening: boolean): number {
    const w = makeWorld()
    let key = ''
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'seq'))
    faceAt(w, e.pos)
    if (withOpening) {
      key = equipMove(w, WHOLE, 0)
      const cast = w.player.skills[key].cast
      expect(cast.trueDamage, '前提：这一式把数值压在下一记上').toBeGreaterThan(0)
      w.player.stats.overdrive = cast.overdriveCost
      expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
      w.tick(50) // 起手式自己走完
      expect(w.hits.filter((h) => h.attackerId === 'player'), '这一式没有判定框：一记命中都不该有').toHaveLength(0)
    }
    expect(w.player.tryStartAction('l1', w.time.tick)).toBe(true)
    expect(nextHitOn(w, e)?.kind).toBe('light')
    settle(w)
    expect(w.player.tryStartAction('h', w.time.tick)).toBe(true)
    const dmg = nextHitOn(w, e)?.damage ?? 0
    w.off()
    return dmg
  }

  it('轻击不兑现它：打到人了也不是那一记（§7.2 明写「下一记重击」）', () => {
    const w = makeWorld()
    const key = equipMove(w, WHOLE, 0)
    const L = w.rpg.moves.level(WHOLE)!
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'light'))
    faceAt(w, e.pos)
    w.player.stats.overdrive = w.player.skills[key].cast.overdriveCost
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
    expect(w.player.followup, '起手式当场挂上').toEqual({ layers: L.fissureLayers, trueDamage: L.trueDamage })
    w.tick(50)
    expect(w.player.tryStartAction('l1', w.time.tick)).toBe(true)
    expect(nextHitOn(w, e), '轻击要真的打在人身上才谈得上"不消费"').toBeTruthy()
    expect(w.player.followup, '轻击不能把它花掉').not.toBeNull()
    expect(e.stats.fissureLayers, '轻击自己不叠层，起手式也没折进去').toBe(0)
    w.off()
  })

  it('挥空不兑现它：那一记重击必须真的打在人身上', () => {
    const w = makeWorld()
    const key = equipMove(w, WHOLE, 0)
    const e = w.pin(w.ai.spawn(FOE, { x: 0, y: 0, z: -20 }, 'whiff'))
    w.player.stats.overdrive = w.player.skills[key].cast.overdriveCost
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
    w.tick(50)
    faceAt(w, e.pos)
    expect(w.player.tryStartAction('h', w.time.tick)).toBe(true)
    expect(nextHitOn(w, e, 40), '20m 外的一记重击打不到人').toBeNull()
    expect(w.player.followup, '挥掉的力气不该把起手式一起用掉').not.toBeNull()
    w.off()
  })

  it('重击兑现它：差值精确等于表里的 trueDamage，那一笔不吃减伤', () => {
    const L = move(WHOLE).levels[0]
    expect(L.fissureLayers, '前提：起手式还带震裂层数').toBeGreaterThan(0)
    const plain = heavyAfterOpening(false)
    const cut = heavyAfterOpening(true)
    expect(plain, '重击本身要有伤害，否则差值没有意义').toBeGreaterThan(0)
    // 驼鼓 DEF 20 ⇒ 若这笔进了 base，差值会被 (1−DR) 削掉一截；精确等于表里的整数才证明它站在减伤之后
    expect(cut - plain).toBe(L.trueDamage ?? 0)
  })

  it('一次起手式只兑一记：兑现之后自己不会回来', () => {
    const w = makeWorld()
    const key = equipMove(w, WHOLE, 0)
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'once'))
    faceAt(w, e.pos)
    w.player.stats.overdrive = w.player.skills[key].cast.overdriveCost
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
    w.tick(50)
    expect(w.player.followup).not.toBeNull()
    expect(w.player.tryStartAction('h', w.time.tick)).toBe(true)
    expect(nextHitOn(w, e)).toBeTruthy()
    expect(w.player.followup, '兑过了就销账').toBeNull()
    settle(w)
    expect(w.player.tryStartAction('h', w.time.tick)).toBe(true)
    expect(nextHitOn(w, e)).toBeTruthy()
    expect(w.player.followup, '第二记重击不会自己再带一份起手式').toBeNull()
    w.off()
  })
})

describe('§7.3 冷却与封锁', () => {
  it('冷却按输入槽记账：同一式装两槽各自计时，换装不退还刚交的学费', () => {
    const w = makeWorld()
    const a = equipMove(w, WHOLE, 0)
    const b = equipMove(w, WHOLE, 1)
    expect(b, '前提：两个槽是两个键').not.toBe(a)
    expect(w.rpg.moves.slots, '前提：两槽装的是同一式').toEqual([WHOLE, WHOLE])
    const cd = w.player.skills[a].cast.cooldownTicks

    w.player.stats.overdrive = 9
    expect(w.player.tryStartAction(a, w.time.tick)).toBe(true)
    expect(w.player.skillCooldown(a)).toBe(cd)
    expect(w.player.skillCooldown(b), '另一条槽的冷却是它自己的').toBe(0)
    w.tick(50) // 等这一式收完：之后 action 为空，再按被拒就只剩"冷却中"一个理由
    expect(w.player.action).toBeNull()
    const left = w.player.skillCooldown(a)
    expect(left, '冷却在走表').toBeGreaterThan(0)
    expect(left).toBeLessThan(cd)
    expect(w.player.tryStartAction(a, w.time.tick), '冷却中不能再接同一条槽').toBe(false)
    w.player.stats.overdrive = 9
    expect(w.player.tryStartAction(b, w.time.tick), '同一条式子从另一槽照样出得来').toBe(true)
    expect(w.player.skillCooldown(b)).toBe(cd)
    expect(w.player.skillCooldown(a), '装另一槽不把这条的账挪走').toBe(left)
    w.player.setSkills({}) // 在调音桩换装＝换一组 loadout，不是把冷却一起刷新
    expect(w.player.skillCooldown(b), '刚交的学费不该被换装退回来').toBe(cd)
    w.off()
  })

  it('闷音期间战技被封（§11）：武器出手不受影响，被封那次不起冷却', () => {
    const w = makeWorld()
    const key = equipMove(w, BURST, 0)
    w.player.stats.overdrive = 9
    w.player.stats.muteTicksLeft = 60
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(false)
    expect(w.player.action).toBeNull()
    expect(w.player.skillCooldown(key), '没出手就不该顺手把冷却起走').toBe(0)
    expect(w.player.stats.overdrive, '被拦下来的那次不扣资源').toBe(9)
    expect(w.notes.some((n) => n.includes('闷音') && n.includes('战技')), '要有句话告诉玩家为什么没出声').toBe(true)
    expect(w.player.tryStartAction('l1', w.time.tick), '闷音封的是战技/律具技，不是平A').toBe(true)
    w.player.action = null
    w.tick(61)
    expect(w.player.stats.muteTicksLeft, '它是会自己到期的量').toBe(0)
    w.player.stats.overdrive = 9
    expect(w.player.tryStartAction(key, w.time.tick), '到点自己解除').toBe(true)
    w.off()
  })

  it('过载不足不出手：不扣款、不起冷却、报一句话', () => {
    const w = makeWorld()
    const key = equipMove(w, BURST, 0)
    const cost = w.player.skills[key].cast.overdriveCost
    w.player.stats.overdrive = cost - 1
    expect(w.player.tryStartAction(key, w.time.tick)).toBe(false)
    expect(w.player.stats.overdrive).toBe(cost - 1)
    expect(w.player.skillCooldown(key)).toBe(0)
    expect(w.player.action).toBeNull()
    expect(w.notes.some((n) => n.includes('过载不足'))).toBe(true)
    w.off()
  })
})

describe('§45 存档：谱册跟着档走', () => {
  const saver = (w: World, store: MapStore): SaveGame =>
    new SaveGame({ player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, rpg: w.rpg }, store)

  it('v4 往返：读档后那一式真的能出手，带的还是升级后的数值', async () => {
    const w = makeWorld()
    const key = equipMove(w, WHOLE, 0)
    w.rpg.inv.add(TIMBITE, 999)
    w.rpg.inv.add(SCORE, 9)
    expect(w.rpg.moves.upgrade(WHOLE, w.rpg.inv).ok).toBe(true)
    w.player.setSkills(w.rpg.skillLoadout())
    const L2 = w.rpg.moves.level(WHOLE)!
    expect(L2.trueDamage, '前提：L2 与 L1 不同，往返才看得出来')
      .not.toBe(move(WHOLE).levels[0].trueDamage)

    const store = new MapStore()
    const snap = await saver(w, store).save('slot1')
    expect(snap.version).toBe(SAVE_VERSION)
    expect(snap.rpg?.movements?.levels[WHOLE]).toBe(2)

    const b = makeWorld()
    expect(await saver(b, store).load('slot1')).not.toBeNull()
    b.player.applyRpg(b.rpg.mods()) // bootWithSave 的那一步
    b.player.setSkills(b.rpg.skillLoadout())
    expect(b.rpg.prog.rank).toBe(w.rpg.prog.rank)
    expect(b.rpg.moves.slots).toEqual(w.rpg.moves.slots)
    expect(b.player.skills[key].cast.trueDamage).toBe(L2.trueDamage!)
    const e = b.pin(b.ai.spawn(FOE, { ...FOE_POS }, 'save'))
    faceAt(b, e.pos)
    b.player.stats.overdrive = b.player.skills[key].cast.overdriveCost
    expect(b.player.tryStartAction(key, b.time.tick)).toBe(true)
    expect(b.player.followup, '读回来的不只是一行 JSON：它得真能挂上起手式')
      .toEqual({ layers: L2.fissureLayers, trueDamage: L2.trueDamage })
    w.off()
    b.off()
  })

  it('v3 老档读进来是一张空谱：没有谱册字段就一式都没有，不白送第一页', async () => {
    const w = makeWorld()
    equipMove(w, WHOLE, 0)
    const store = new MapStore()
    const snap = await saver(w, store).save('slot1')
    // 手工退回 v3：抹掉 movements 字段，并按 v3 重新封装（校验和跟着 payload 走）
    await store.set('legacy', wrap(3, { snapshot: { ...snap, rpg: { ...snap.rpg!, movements: undefined } } }))

    const b = makeWorld()
    expect(await saver(b, store).load('legacy')).not.toBeNull()
    b.player.applyRpg(b.rpg.mods())
    b.player.setSkills(b.rpg.skillLoadout())
    expect(b.rpg.moves.snapshot().lit, '§78 如实：那份档里没有「学过哪几式」这件事').toEqual([])
    expect(b.rpg.skillLoadout()).toEqual({})
    expect(b.player.tryStartAction('weaponSkill', b.time.tick), '空谱 ⇒ 按 R 什么都没有').toBe(false)
    w.off()
    b.off()
  })
})


/**
 * 踏出这一步（错拍步），落地后空等 `wait` 个 tick，再补一记重击。
 * 返回那一记重击压出去的架式基数——落地窗口的 +3 应当出现在里面，窗口过期后应当消失。
 */
function swingPoiseAfterStep(wait: number): { poise: number; armed: number; landedAt: number } {
  const w = makeWorld()
  const key = equipMove(w, SYNC, 0)
  const e = w.pin(w.ai.spawn(FOE, { x: 0, y: 0, z: -4.2 }, `land-${wait}`))
  faceAt(w, e.pos)
  w.frame.move = { x: 0, y: 1 } // 方向在出手那一刻定死（口径与 step() 相同）
  w.tick()
  w.frame.move = { x: 0, y: 0 }
  expect(w.player.tryStartAction(key, w.time.tick), '错拍步没踏出去').toBe(true)
  let guard = 0
  const before = w.time.tick
  while (w.player.landingPoise === 0 && guard++ < 60) w.tick()
  expect(w.player.landingPoise, '落地窗口没打开：KI-035 那条收益没接线').toBeGreaterThan(0)
  const armed = w.player.landingPoise
  const landedAt = w.time.tick - before
  if (wait > 0) w.tick(wait)
  // 用轻击读这一笔：落地窗口只有 0.3s（18 tick），而重击的前摇比窗口还长——
  // 拿重击测就会看到"加成永远赶不上落点"，那是量具选错，不是机制没接。
  expect(w.player.tryStartAction('l1', w.time.tick), '这一记轻击没砍出去').toBe(true)
  const hit = nextHitOn(w, e)
  expect(hit, '轻击没打中人，差值断言就是空的').toBeTruthy()
  const out = { poise: hit!.poiseDamage, armed, landedAt }
  w.off()
  return out
}

describe('§7.2 错拍步的落地窗口（KI-035：落地后一段时间内，自己的攻击架式伤害加一档）', () => {
  it('窗口在"脚落地"那一刻打开，长度与加成都来自 movements.json', () => {
    const landed = swingPoiseAfterStep(0)
    const mv = move(SYNC)
    expect(mv.landing, '数据里要写这一格，否则本用例在自证').toBeTruthy()
    expect(landed.armed, '落地那一刻的加成值 = 表里的 poise').toBe(mv.landing!.poise)
    // 「落地」= 这一式结束、手又能动起来的那一刻。不是判定窗末：错拍步的恢复有 20 tick，
    // 而窗口只有 18 tick，从 activeEnd 起算的话加成会在玩家能出手之前就自己走完（那是量出来的，不是猜的）。
    expect(landed.landedAt, '窗口应在这一式结束的那一 tick 打开').toBe(mv.frame.recovery)
  })

  it('窗口里的那一记多压表里写的那点数；等过窗口就回到原值', () => {
    const inside = swingPoiseAfterStep(0)
    const mv = move(SYNC)
    const outside = swingPoiseAfterStep(mv.landing!.withinTicks + 8)
    expect(outside.poise, '前提：等过窗口之后落地加成确实归零了').toBe(inside.poise - mv.landing!.poise)
    expect(inside.poise - outside.poise, '差值必须恰好是表里那一点，多一分少一分都不行').toBe(mv.landing!.poise)
  })

  it('这颗旋钮住在数据里：改 movements.json 的 poise，差值跟着改', () => {
    swingPoiseAfterStep(0) // 先让 makeWorld() 把数据注册上
    const mv = move(SYNC)
    const backup = mv.landing!.poise
    try {
      mv.landing!.poise = backup + 6
      const inside = swingPoiseAfterStep(0)
      const outside = swingPoiseAfterStep(move(SYNC).landing!.withinTicks + 8)
      expect(inside.poise - outside.poise, '代码里若还留着一份 +3，这条就会红').toBe(backup + 6)
    } finally {
      mv.landing!.poise = backup
    }
  })

  it('没有落地窗口的式子（和弦爆）不吃这笔：加法项只从数据来', () => {
    const w = makeWorld()
    const key = equipMove(w, BURST, 0)
    expect(move(BURST).landing, '前提：那一式没写落地收益').toBeUndefined()
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'noland'))
    faceAt(w, e.pos)
    w.player.stats.overdrive = w.player.skills[key].cast.overdriveCost
    expect(w.player.tryStartAction(key, w.time.tick), '前提：和弦爆要能出手').toBe(true)
    w.tick(12)
    expect(w.player.landingPoise, '没写落地收益的战技不该凭空长出一段加成').toBe(0)
    w.off()
  })
})

/* ============================ 乐章 IV·休止 ============================ */

const CAESURA = 'mv_caesuracut' // 它不出伤害：它拿走的是别人的时间
const KNIGHT = 'en_hanged_knight' // 每 4 小节敲一次钟回 15 血的野外精英——一记 90 tick 的读条，量"时间停没停"的好尺子

/** 休止斩那一式的读条数据（测试不抄第二份常量：招式在 enemies.json 里） */
function tollSpec(e: Enemy): { id: string; startup: number; heal: number } {
  const t = e.data.ai.selfToll
  if (!t) throw new Error(`${e.data.id} 没有 selfToll：本用例的尺子失效`)
  const spec = e.data.attacks.find((a) => a.id === t.attackId)
  if (!spec) throw new Error(`表里没有读条招式 ${t.attackId}`)
  return { id: t.attackId, startup: spec.frames.startup, heal: t.heal ?? 0 }
}

/** 把玩家摆回"能出手"：本文件测的是敌人的时间，不该被一次无关的挨打打断 */
function ready(w: World): void {
  w.player.stats.hp = w.player.stats.hpMax
  w.player.stunTicks = 0
  w.player.crumpleTicks = 0
  w.player.action = null
}

function castCaesura(w: World, key: string): void {
  const cast = w.player.skills[key].cast
  ready(w)
  w.player.stats.overdrive = Math.max(w.player.stats.overdrive, cast.overdriveCost)
  expect(w.player.tryStartAction(key, w.time.tick), '休止斩没出手：本用例前提失效').toBe(true)
}

/** 一步步推到「冻结已经落在敌人身上」；返回是否等到（休止斩有 12 tick 前摇，不是举手就冻结） */
function waitFrozen(w: World, e: Enemy, cap = 40): boolean {
  for (let i = 0; i < cap && !(e.frozenTicks > 0); i++) w.tick()
  return e.frozenTicks > 0
}

/**
 * 把悬钟骑士推进到「敲钟自鸣正在读条」的那一刻。真打法：进战、挨它自己那几招、等 §14.7 的软计时器
 * 到点，全程只走 `maybeBarCast` 这条既有通道（不手搓 `attack`——手搓会把 `pendingBroadcast` 那份后事跳过，
 * 于是"回血"这一半根本没接线，测出来的冻结就是自证）。
 *
 * `startup - 14` 这个下界是给休止斩自己的 12 tick 前摇留的余量：要求"看到读条时它还早"，
 * 才不会出现"读条在冻结生效之前就走完、回血已经发生"这种把断言掏空的情形。等不到就等下一次自鸣（每 4 小节一次）。
 */
function tillTolling(w: World, e: Enemy): boolean {
  const t = tollSpec(e)
  for (let i = 0; i < 3200; i++) {
    w.tick()
    if (e.attack?.spec.id === t.id && e.attack.tick >= 0 && e.attack.tick <= t.startup - 14) return true
  }
  return false
}

/** 造一个"正在敲钟"的世界：受伤（满血不为回血演这一招）→ 进战 → 等到读条 */
function makeTollingWorld(): { w: World; e: Enemy; key: string; started: boolean } {
  const w = makeWorld()
  const key = equipMove(w, CAESURA, 0)
  const e = w.ai.spawn(KNIGHT, { x: 0, y: 0, z: -1.8 }, 'caesura-toll')
  e.stats.damage(80)
  e.alertness = 100
  e.enter('combat')
  faceAt(w, e.pos)
  return { w, e, key, started: tillTolling(w, e) }
}

describe('§7.2 休止斩的时停（KI-037 第一步：敌人侧的冻结原语）', () => {
  it('判定窗那一 tick：全场每个活敌人被按住表里的格数，玩家与世界的拍子照走', () => {
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const cast = w.player.skills[key].cast
    expect(cast.freezeTicks, '前提：这一式写的是时停').toBeGreaterThan(0)
    expect(cast.damage, '前提：这一式自己不出伤害').toBe(0)
    const near = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'frz-near'))
    const far = w.pin(w.ai.spawn(FOE, { x: -14, y: 0, z: 9 }, 'frz-far')) // 背后 17m：判据是「全场」，不是「面前这一圈」
    faceAt(w, near.pos)
    const seen = w.hits.length
    const beat0 = w.rhythm.info().beatIndex
    const pre = { near: near.stateTick, far: far.stateTick }
    castCaesura(w, key)
    expect(waitFrozen(w, near), '冻结没落到近处这个敌人身上').toBe(true)
    // 冻结之前它自己的时间照走：休止斩有前摇，它是「刀落在两个音中间」，不是举手就冻结
    expect(near.stateTick - pre.near, '前摇那几 tick 里它该是正常的').toBe(move(CAESURA).frame.activeStart)
    expect(near.frozenTicks, '生效那一刻应该正好是表里那一格').toBe(cast.freezeTicks)
    expect(far.frozenTicks, '远处那个没被按住 = 冻结不是范围判定，而是全场').toBe(cast.freezeTicks)
    const s0 = { near: near.stateTick, far: far.stateTick }
    for (let i = 0; i < cast.freezeTicks; i++) {
      w.tick()
      expect(near.stateTick, '冻结的整段里它自己的状态机一格都不该走').toBe(s0.near)
      expect(far.stateTick).toBe(s0.far)
      expect(near.frozenTicks, '它是在一格一格倒数，不是被随手抹了一段').toBe(cast.freezeTicks - 1 - i)
    }
    expect(near.frozenTicks, '窗口要走满，也要准时松开').toBe(0)
    expect(w.hits.slice(seen), '时停不是一条结算通道：这一式不该产出任何命中').toHaveLength(0)
    expect(w.notes, '玩家要看得见拍子停了').toContain(`${movementName('mv_caesuracut')}｜2 个声音停在拍上`)
    // 「松手之后它自己走回来」这一半不在这里量：`stateTick` 会在换状态时归零（冻结期间 AI 的感知
    // 照跑，解冻第一 tick 它就可能进 chase），那读数分不清"走回来了"和"归零了"。
    // 它由下面那两例用读条来钉：`attack.tick` 停住、松手后继续走完、该回的血一分不少。
    expect(w.player.action, '玩家不吃自己的时停：这一式在冻结期里自己收完了').toBeNull()
    expect(w.rhythm.info().beatIndex, '世界的拍网格不吃时停——停的是「它」的时间').toBeGreaterThan(beat0)
    w.off()
  })

  it('这颗旋钮住在数据里：改 movements.json 的 freezeTicks，被按住的 tick 数跟着改', () => {
    const observed = (override: number) => {
      const w = makeWorld()
      const key = equipMove(w, CAESURA, 0)
      const mv = move(CAESURA)
      const backup = mv.levels[0].freezeTicks!
      mv.levels[0].freezeTicks = override
      w.player.setSkills(w.rpg.skillLoadout()) // cast 在出手之前就折好等级，重灌一次才吃得到新数
      const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'knob'))
      faceAt(w, e.pos)
      castCaesura(w, key)
      expect(waitFrozen(w, e), '冻结没生效').toBe(true)
      // 量的不是 `frozenTicks` 的读数，而是「它自己的时间有几 tick 没走」：那个数才是玩家吃到的收益
      let held = 0
      for (let i = 0; i < override + 30 && e.frozenTicks > 0; i++) {
        const before = e.stateTick
        w.tick()
        if (e.stateTick === before) held++
      }
      w.off()
      mv.levels[0].freezeTicks = backup
      return held
    }
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const tabled = move(CAESURA).levels[0].freezeTicks!
    expect(w.player.skills[key].cast.freezeTicks, '运行时读到的必须就是表里那格').toBe(tabled)
    w.off()
    expect(observed(20), '代码里若还写死着 48，这一条就会红').toBe(20)
    expect(observed(tabled)).toBe(tabled)
  })

  it('没写时停的式子（和弦爆）一个敌人都不冻结', () => {
    const w = makeWorld()
    const key = equipMove(w, BURST, 0)
    expect(move(BURST).levels[0].freezeTicks, '前提：那一式没写时停').toBeUndefined()
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'nofreeze'))
    faceAt(w, e.pos)
    const s0 = e.stateTick
    w.player.stats.overdrive = w.player.skills[key].cast.overdriveCost
    expect(w.player.tryStartAction(key, w.time.tick), '前提：和弦爆要能出手').toBe(true)
    w.tick(move(CAESURA).levels[0].freezeTicks! + 8)
    expect(e.frozenTicks, '没有 freezeTicks 的式子不该凭空按住任何人').toBe(0)
    expect(e.stateTick, '它的状态机一整段都在走（这才叫"没被冻"）').toBeGreaterThan(s0)
    w.off()
  })

  it('时停 ≠ 定身：读条停在原地，松手后走完并照回那 15 血', () => {
    const { w, e, key, started } = makeTollingWorld()
    expect(started, '等不到一次还来得及被整段按住的自鸣读条').toBe(true)
    const t = tollSpec(e)
    const cast = w.player.skills[key].cast
    const hp0 = e.stats.hp
    castCaesura(w, key)
    expect(waitFrozen(w, e), '冻结没落到读条中的敌人身上').toBe(true)
    expect(e.attack?.spec.id, '冻结前它还在读这一招').toBe(t.id)
    const heldAt = e.attack!.tick
    for (let i = 0; i < cast.freezeTicks; i++) {
      w.tick()
      expect(e.attack?.spec.id, '招式不该在冻结里换掉').toBe(t.id)
      expect(e.attack!.tick, '时停把读条停在同一帧上，不是把它作废').toBe(heldAt)
      expect(e.stats.hp, '回血那一步在冻结里发生不了').toBe(hp0)
    }
    // 松手：读条从它停下的那一帧继续，走完该拿的回血一分不少
    let ticks = 0
    while (e.stats.hp === hp0 && ticks < t.startup + 60) { w.tick(); ticks++ }
    expect(e.stats.hp - hp0, '冻结松开后这一笔血该照旧回来').toBe(t.heal)
    expect(w.notes.some((n) => n.includes('回复')), '回血那句提示也该补上').toBe(true)
    w.off()
  })

  it('对照组：同一帧上给定身（既有通道），读条就地作废，那 15 血永远回不来', () => {
    const { w, e, key, started } = makeTollingWorld()
    expect(started, '等不到一次自鸣读条').toBe(true)
    const t = tollSpec(e)
    const hp0 = e.stats.hp
    // 定身是 `Enemy.update` 里既有的那条通道：它会 `attack = null`，挂在读条上的后事一起作废
    e.stunTicks = w.player.skills[key].cast.freezeTicks
    for (let i = 0; i < t.startup + 60; i++) {
      w.tick()
      if (e.stats.hp > hp0) break
    }
    expect(e.stats.hp, '定身把这一笔血掐掉了——这才说明「停在原地」和「作废」是两条语义').toBe(hp0)
    w.off()
  })
})

describe('§7.2 休止斩的连打涨价（overdriveRamp：每用一次贵一档，过载条攒满才归零）', () => {
  /** 底价、每档涨幅、默认过载上限——全部回读表，测试里不抄第二份数 */
  function rampPrices() {
    const mv = move(CAESURA)
    return { base: mv.cost.overdrive!, step: mv.cost.overdriveRamp! }
  }

  /** 出手一次；成功了就等冷却自己走完（冷却按 tick 计，见 movements.json 的口径） */
  function castOnce(w: World, key: string): boolean {
    const ok = w.player.tryStartAction(key, w.time.tick)
    if (ok) w.tick(w.player.skills[key].cast.cooldownTicks + 2)
    return ok
  }

  it('第一下按底价；从第二下起每下贵 overdriveRamp，涨价看得见', () => {
    const { base, step } = rampPrices()
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const cast = w.player.skills[key].cast
    expect(cast.overdriveCost, '运行时读到的底价就是表里那格').toBe(base)
    expect(cast.overdriveRamp, '运行时读到的涨幅就是表里那格').toBe(step)
    expect(w.player.skillRampOf(key), '没打过不该涨价').toBe(0)
    ready(w)
    w.player.stats.overdrive = base
    expect(castOnce(w, key), '第一下该按底价出手').toBe(true)
    expect(w.player.skillRampOf(key), '用过一次就该涨一档').toBe(step)
    ready(w)
    w.player.stats.overdrive = base
    const seen = w.notes.length
    expect(castOnce(w, key), '只给底价时第二下必须出手失败（这就是「防连发」）').toBe(false)
    expect(w.notes.slice(seen)).toContain(`过载不足｜连打已涨到 ${base + step}`)
    expect(w.player.skillRampOf(key), '被拒掉的一下不该再加价：涨价只在真出手时记').toBe(step)
    ready(w)
    w.player.stats.overdrive = base + step
    expect(castOnce(w, key), '凑够涨后的价就该出手').toBe(true)
    expect(w.player.skillRampOf(key)).toBe(step * 2)
    w.off()
  })

  it('涨价攒满即归零：过载条满了，价也回到底价——复位不靠第二个计时器', () => {
    const { base, step } = rampPrices()
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const max = w.player.stats.overdriveMax
    ready(w)
    w.player.stats.overdrive = base
    expect(castOnce(w, key)).toBe(true)
    ready(w)
    w.player.stats.overdrive = base + step
    expect(castOnce(w, key)).toBe(true)
    const third = base + step * 2
    expect(third > max, '设计意图：默认上限下第三次根本够不着（这正是 §7.2 要的「防连发」）').toBe(true)
    ready(w)
    w.player.stats.overdrive = max
    expect(castOnce(w, key), '满条也不该白给一次涨价后的出手').toBe(false)
    // 挣满一条 = 又把拍子抢回来了：涨价账整个清零，价回到底价
    w.player.addOverdrive(1)
    expect(w.player.stats.overdrive, '前提：addOverdrive 会把它钳在上限上').toBe(max)
    expect(w.player.skillRampOf(key), '攒满一次，连打的账就一笔勾销').toBe(0)
    ready(w)
    w.player.stats.overdrive = base
    expect(castOnce(w, key), '归零之后底价就能出手').toBe(true)
    w.off()
  })
})

/* ==================== KI-037 第二步：时停镜像到弹体 ==================== */

const SKEWER = 'en_skewer' // 14–26m 之间拉弦的狙击手：这一式要量的正是「已经离弦的那一发停不停」
const SKEWER_POS: Vec3 = { x: 0, y: 0, z: -15 }

/** 针喉 snipe 那一发的弹道数据（§55：测试不抄第二份常量，连手搓的样本弹也从表里取参数） */
function shotSpec(): { kind: string; speed: number; range: number; radius: number; offsetY: number } {
  const d = registry.get<EnemyData>(SKEWER)
  const a = d.attacks.find((x) => x.frames.projectile)
  const s = a?.frames.projectile
  if (!s) throw new Error(`${SKEWER} 表里没有弹道招式：本用例的尺子失效`)
  return { kind: s.kind, speed: s.speed, range: s.range, radius: s.radius, offsetY: s.offsetY ?? 1.1 }
}

/** 一发正在飞的敌方弹体（走 ProjectileSystem 真通道，只是不经 AI 的选招）；ownerId 可以是一个不存在的人 */
function hostileShot(w: World, from: Vec3, ownerId = SKEWER): Projectile {
  const s = shotSpec()
  return w.combat.projectiles.spawn({
    hostile: true, ownerId, kind: s.kind, origin: { ...from },
    dir: { x: 0, y: 0, z: 1 }, speed: s.speed, range: s.range, radius: s.radius,
    damage: 12, poise: 6, hitStopMs: 70
  }, w.time.tick)
}

/** 推到「场上有一发敌方弹体、且它离玩家还有 safe 米以上」；只等不手搓，走 AI 真出手 */
function tillIncomingShot(w: World, safe = 10, cap = 3000): Projectile | null {
  for (let i = 0; i < cap; i++) {
    w.tick()
    const pr = w.combat.projectiles.list().find((x) => x.hostile && !x.dead &&
      Math.hypot(x.pos.x - w.player.pos.x, x.pos.y - w.player.pos.y, x.pos.z - w.player.pos.z) > safe)
    if (pr) return pr
  }
  return null
}

/** 一步步推到「冻结已经落在这一发上」；休止斩有前摇，举手不等于冻结 */
function waitShotFrozen(w: World, pr: Projectile, cap = 40): boolean {
  for (let i = 0; i < cap && !(pr.frozenTicks > 0); i++) w.tick()
  return pr.frozenTicks > 0
}

describe('§7.2 休止斩把时停镜像到弹体（KI-037 第二步：飞着的那一发也停在拍上）', () => {
  it('真通道：针喉离弦的那一发在空中静止表里那一格的 tick 数，然后自己接着飞', () => {
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const cast = w.player.skills[key].cast
    const e = w.ai.spawn(SKEWER, { ...SKEWER_POS }, 'caesura-shot')
    e.alertness = 100
    e.enter('combat')
    const pr = tillIncomingShot(w)
    expect(pr, '3000 tick 里针喉没射出过一发够远的弹体：本用例前提失效').toBeTruthy()
    const beat0 = w.rhythm.info().beatIndex
    castCaesura(w, key)
    /**
     * 量的不是 `frozenTicks` 的读数，而是「它在空中静止了多少 tick」——那才是玩家吃到的那笔。
     * 顺带避开一处口径差：`Enemy.update` 跑在 `combat.update` 之前，`projectiles.update` 跑在之后，
     * 所以冻结落地的那一 tick 弹体已经自己扣掉了一格（两边**静止的总 tick 数**仍然严格相等）。
     */
    let run = 0, longest = 0, resumed = false
    let prev = { ...pr!.pos }
    let heldRange = 0
    for (let i = 0; i < cast.freezeTicks + 80 && !resumed; i++) {
      w.tick()
      const moved = Math.hypot(pr!.pos.x - prev.x, pr!.pos.y - prev.y, pr!.pos.z - prev.z) > 1e-9
      prev = { ...pr!.pos }
      if (moved) {
        if (longest > 0) resumed = true
        run = 0
      } else {
        if (run === 0) heldRange = pr!.rangeLeft
        run++
        longest = Math.max(longest, run)
        expect(pr!.rangeLeft, '射程是积分出来的：时间没过，射程也就没过').toBe(heldRange)
      }
    }
    expect(longest, '空中静止的 tick 数应该就是表里那一格').toBe(cast.freezeTicks)
    expect(resumed, '松手之后它自己会接着飞：停在原地而不是作废').toBe(true)
    expect(pr!.frozenTicks).toBe(0)
    expect(w.rhythm.info().beatIndex, '世界的拍网格不吃时停——停的是「那一发」的时间').toBeGreaterThan(beat0)
    w.off()
  })

  it('停在半空的弹体仍然是障碍物：冻结只停运动学，不停命中判定', () => {
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const pr = hostileShot(w, { x: 0, y: 1.0, z: -14 })
    castCaesura(w, key)
    expect(waitShotFrozen(w, pr), '冻结没落到弹体上').toBe(true)
    expect(pr.frozenTicks, '前提：这一下还在冻结窗口里').toBeGreaterThan(0)
    // 玩家自己撞上那一发：它没动，但它还在那儿
    faceAt(w, { x: 0, y: 0, z: -0.3 })
    pr.pos.x = 0; pr.pos.y = 0.9; pr.pos.z = -0.3
    const seen = w.hits.length
    w.tick()
    const h = w.hits.slice(seen).find((x) => x.victimId === 'player')
    expect(h, '撞上一记停住的弹体不该穿身而过：那是障碍物不是幻影').toBeTruthy()
    expect(h!.attackerId, '伤害记在发射者名下，与飞行中命中同一条通道').toBe(SKEWER)
    w.off()
  })

  it('不对称是刻意的：同一记把敌人的时间拿走，玩家自己那一发照旧送出去', () => {
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const cast = w.player.skills[key].cast
    const foe = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'caesura-own'))
    faceAt(w, foe.pos)
    const mine = w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear', origin: { x: 0, y: 1.0, z: -3 },
      dir: { x: 0, y: 0, z: -1 }, speed: 20, range: 30, radius: 0.3,
      damage: 10, poise: 5, hitStopMs: 60
    }, w.time.tick)
    castCaesura(w, key)
    expect(waitFrozen(w, foe), '敌人的冻结没生效').toBe(true)
    const s0 = foe.stateTick
    const p0 = { ...mine.pos }
    for (let i = 0; i < cast.freezeTicks; i++) {
      w.tick()
      expect(foe.stateTick, '敌人这一侧：状态机一格不走').toBe(s0)
      expect(mine.frozenTicks, '玩家那一侧：连一格账都没记').toBe(0)
    }
    expect(mine.pos, '§7.2 写的是「敌人时间冻结，玩家正常行动」：玩家的弹体属于玩家那一侧').not.toEqual(p0)
    w.off()
  })

  it('报数把「正在飞的音弹」算进声音：场上没有活人、只有她临死那一发时，玩家仍听得到那一嗓子', () => {
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const pr = hostileShot(w, { x: 0, y: 1.0, z: -16 }, 'en_dead_shooter')
    expect(w.ai.enemies.filter((x) => x.alive), '前提：场上没有活着的敌人').toHaveLength(0)
    castCaesura(w, key)
    expect(waitShotFrozen(w, pr)).toBe(true)
    expect(w.notes, '只数敌人的话，这一记就变成"什么都没停"的静音反馈').toContain(`${movementName('mv_caesuracut')}｜1 个声音停在拍上`)
    w.off()
  })

  it('后坐力检查：没有弹体在场时，这一步不改第一步那笔账（敌人照旧、无多余播报）', () => {
    const w = makeWorld()
    const key = equipMove(w, CAESURA, 0)
    const cast = w.player.skills[key].cast
    const foe = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'caesura-nopr'))
    faceAt(w, foe.pos)
    castCaesura(w, key)
    expect(waitFrozen(w, foe)).toBe(true)
    expect(foe.frozenTicks).toBe(cast.freezeTicks)
    expect(w.combat.projectiles.live, '前提：场上没有弹体').toBe(0)
    expect(w.notes).toContain(`${movementName('mv_caesuracut')}｜1 个声音停在拍上`)
    w.off()
  })
})

/* ---------------- KI-120：出手播报那格报名的出处 ---------------- */

/**
 * 「弹《终止》时屏上印『无声协奏』」是 KI-119 顺出来的生产缺陷（§4.8 帧表对上了账，播报仍在说谎）。
 * 这一组钉的是**播报的式名与秒数都从 `movements.json` 现推**：式名走 `movementName(cast.id)`，
 * 秒数走 `TICK_HZ` 那把唯一的尺。式的名册在这里是从数据筛出来的（哪一级的 `echoCharges`/`silenceTicks`
 * 非零，哪一式就该播），测试不手抄第二份名单——手抄名单正是这一批要拆的东西。
 */
const ANNOUNCING = () => movementConfig().movements.filter((m) =>
  m.levels.some((l) => (l.echoCharges ?? 0) > 0 || (l.silenceTicks ?? 0) > 0))

/** 装好这一式（可指定升到第几级）并真的打出去，返回那个世界（`notes` 里就是它播的话） */
function castForAnnounce(movementId: string, slot: number, toLevel = 1): World {
  const w = makeWorld()
  const key = equipMove(w, movementId, slot)
  for (let i = 1; i < toLevel; i++) {
    const need = w.rpg.moves.upgradeNeed(movementId)
    expect(need, `${movementId} 没有第 ${i + 1} 级可升`).toBeTruthy()
    w.rpg.inv.add(TIMBITE, need!.timbite)
    w.rpg.inv.add(SCORE, need!.score)
    expect(w.rpg.moves.upgrade(movementId, w.rpg.inv).ok, `升不到 L${i + 1}`).toBe(true)
  }
  w.player.setSkills(w.rpg.skillLoadout()) // 等级变了，cast 里那组数要重新推一遍才算
  const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'announce'))
  faceAt(w, e.pos)
  const cast = w.player.skills[key].cast
  w.player.stats.overdrive = cast.overdriveCost
  expect(w.player.tryStartAction(key, w.time.tick), `${movementId} 在槽 ${slot} 出不了手`).toBe(true)
  return w
}

describe('§7.2 出手播报的式名从数据现推（KI-120）', () => {
  it('前提：会播的式是从表里筛出来的，而且不止一条', () => {
    expect(ANNOUNCING().length, '只筛出一条的话，"不许借别人的名字"那条断言是空的').toBeGreaterThanOrEqual(2)
    expect(ANNOUNCING().map((m) => m.id), '《终止》带着 silenceTicks，本该在名册里').toContain('mv_terminate')
  })

  it('每一式弹出时印的是它自己的名字，而不是同族里最先接线那一式的名字', () => {
    for (const mv of ANNOUNCING()) {
      const w = castForAnnounce(mv.id, 0)
      const own = w.notes.filter((n) => n.startsWith(`${mv.displayName}｜`))
      expect(own.length, `「${mv.id}」弹出里没有以「${mv.displayName}｜」开头的那条：${JSON.stringify(w.notes)}`)
        .toBeGreaterThan(0)
      for (const other of ANNOUNCING()) {
        if (other.id === mv.id) continue
        expect(w.notes.some((n) => n.startsWith(`${other.displayName}｜`)),
          `「${mv.id}」播成了「${other.displayName}」：报名抄在代码里就会这样`)
          .toBe(false)
      }
      w.off()
    }
  })

  it('静默秒数跟着等级表走：同一式升到 L2 再出手，播报里的数字换成那一级的读数', () => {
    const mv = ANNOUNCING().find((m) => new Set(m.levels.map((l) => l.silenceTicks ?? 0)).size > 1)
    expect(mv, '名册里没有跨级变长的静默式 ⇒ 这条腿测不到"数字跟着表走"').toBeTruthy()
    const id = mv!.id
    const a = castForAnnounce(id, 0, 1)
    const b = castForAnnounce(id, 1, 2) // 换一条槽：冷却按输入槽记，同槽连打会被上一记挡死
    const want = (lv: number) => `${mv!.displayName}｜${((mv!.levels[lv - 1].silenceTicks ?? 0) / TICK_HZ).toFixed(1)}s`
    expect(a.notes.some((n) => n.startsWith(want(1))), `L1 该播 ${want(1)}，实际 ${JSON.stringify(a.notes)}`).toBe(true)
    expect(b.notes.some((n) => n.startsWith(want(2))), `L2 该播 ${want(2)}，实际 ${JSON.stringify(b.notes)}`).toBe(true)
    a.off(); b.off()
  })

  it('播报里的那个秒数和身上真的挂了几 tick 是同一个数：屏上说的和引擎做的不许两套', () => {
    const mv = ANNOUNCING().find((m) => m.levels.some((l) => (l.silenceTicks ?? 0) > 0))
    expect(mv, '名册里没有带静默的式').toBeTruthy()
    const w = castForAnnounce(mv!.id, 0)
    const note = w.notes.find((n) => n.startsWith(`${mv!.displayName}｜`))
    expect(note, `弹出里没有「${mv!.displayName}｜」那一格`).toBeTruthy()
    const secs = Number(/([0-9.]+)s/.exec(note!)?.[1])
    expect(Number.isFinite(secs), `那一格里没有秒数：${note}`).toBe(true)
    expect(w.player.tacet, '前提：静默真的挂上了身').toBeTruthy()
    expect(secs).toBeCloseTo(w.player.tacet!.ticksLeft / TICK_HZ, 10)
    w.off()
  })
})
