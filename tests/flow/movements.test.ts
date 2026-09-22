import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { ItemData, MovesetData, WeaponData } from '@/data/schema'
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

interface Hit { attackerId: string; victimId: string; damage: number; kind: string; result: string }

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
      rhythm.update(time.dt)
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
    w.rpg.inv.add(page.unlock.item, page.unlock.count)
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
   * 移动输入只在**出手前一 tick**给：方向在那一刻就被 `moveDir()` 定死，之后按着走会污染测量。
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

  it('净位移恰等于等级表里的 distance，方向沿出手那一刻的移动输入', () => {
    const s = step()
    expect(Math.hypot(s.dx, s.dz), '一步就是表里那么远，不多不少').toBeCloseTo(s.distance, 10)
    expect(s.dx, '没有往旁边漂').toBeCloseTo(0, 10)
    expect(s.dz, '沿屏幕前方推进').toBeLessThan(0)
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
