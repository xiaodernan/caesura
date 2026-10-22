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
import { movementConfig } from '@/rpg/Movements'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-275：**§4.8 乐章战技那一族的「三级成长列（L1→L3）」** ＋ **「键不属于某一式」那一格**
 * 第一次在真链上被量（KI-273 量了那一族七式的 L1 那一列）。
 *
 * **这一批量的三样东西**：
 * ① **成长列**：冷却（L1→L3）＋ 每式自己那一格（伤害底数／闷音／冻结／消音／加成／充能／位移／真伤／震裂层）；
 * ② **帧那一列与消耗那一列不随等级变**（设计那张表的 Startup／Active／Recovery 与消耗两栏都只有一格）；
 * ③ **「键」那一格**：键名由 `movements.json > slots[]` 现推 ⇒ 同一式装进**槽 2** 也能出式，两式各占一槽 ⇒ 冷却各算各的。
 *
 * **三条口径（沿用 KI-273 立起来的那一套）**：
 * ① **升到 L2／L3 要真的把那一页研读到那一级**（`MovementBook.upgrade`：音色石 40＋乐谱残页 1 → L2；再 120＋2 → L3），
 *    升完要**重新把招式装回玩家**（`setSkills(skillLoadout())`）——不重装的话玩家手上还是 L1 那一套；
 * ② **每一级都在一个全新的世界里量**（冷却在出手那一拍就起算 ⇒ 同一个世界里连出两记会被自己的冷却挡住）；
 * ③ **伤害那一格是底数**（KI-273 登记过）：和弦爆 L2 的底数 36、L3 的底数 48 ⇒ 断言按 ±5% 的走（底数大于 9 ⇒ 取整吃不掉噪声）。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

const MOVE = {
  whole: 'mv_wholenotecut',
  pace: 'mv_syncopace',
  chord: 'mv_chordburst',
  caesura: 'mv_caesuracut',
  terminate: 'mv_terminate',
  echo: 'mv_perfectingecho',
  tacet: 'mv_tacetconcerto',
} as const

/** 升级要花的两样东西（`movements.json > upgradeCost`：L2 ＝ 音色石 40＋乐谱残页 1；L3 ＝ 120＋2） */
const TIMBITE = 'it_timbite'
const SCORE = 'it_score_fragment'

const moveCfg = (id: string) => {
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
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, hits, pins, off }
}

type World = ReturnType<typeof makeWorld>

/** 点亮页 → 开槽 → 装上 → 灌给玩家；返回输入动作名（§4.8 那一行：键不属于某一式） */
function equipMove(w: World, movementId: string, slot = 0): string {
  const book = w.rpg.moves
  const mv = moveCfg(movementId)
  const page = book.page(mv.page)!
  if (!book.isLit(page.id)) {
    if (page.unlock.flag) bus.emit('world.flag', { key: page.unlock.flag, value: true })
    else w.rpg.inv.add(page.unlock.item ?? '', page.unlock.count ?? 0)
    expect(book.unlockPage(page.id, w.rpg.inv).ok).toBe(true)
  }
  for (let i = 0; i < 40 && w.rpg.prog.rank < book.slotRank(slot)!; i++) w.rpg.prog.addResonance(300)
  expect(book.equip(slot, movementId, w.rpg.prog.rank).ok).toBe(true)
  w.player.applyRpg(w.rpg.mods())
  w.player.setSkills(w.rpg.skillLoadout())
  return book.cfg.slots[slot].action
}

/** **升到第 level 级**（L1 不用升）：升级要付音色石与乐谱残页；升完要把招式重新装回玩家 */
function upgradeTo(w: World, movementId: string, level: number): void {
  const book = w.rpg.moves
  for (let lv = book.levelOf(movementId); lv < level; lv++) {
    const need = book.upgradeNeed(movementId)
    expect(need, `升到 L${lv + 1} 的那一档代价得有`).toBeTruthy()
    w.rpg.inv.add(TIMBITE, need!.timbite)
    w.rpg.inv.add(SCORE, need!.score)
    expect(book.upgrade(movementId, w.rpg.inv).ok, `付得起就升得上 L${lv + 1}`).toBe(true)
  }
  expect(book.levelOf(movementId), '升级真的落到那一级').toBe(level)
  w.player.setSkills(w.rpg.skillLoadout())
}

/** 一只挨打的怪：站位每拍钉回；血量与架势值拉高；状态每拍按回 idle（它一挨打就进 combat 状态反打） */
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

interface LevelRead {
  /** 命中那一拍（相对出手那一拍） */
  hit: number
  /** 敌身上的冻结生效那一拍（相对出手那一拍） */
  frozenAt: number
  /** 敌身上的冻结生效那一拍的冻结时长 */
  frozenTicks: number
  /** 敌身上的闷音生效那一拍的时长 */
  muteTicks: number
  /** 收势那一拍（相对出手那一拍）＝ 设计的 Recovery 绝对帧 */
  end: number
  /** 出手那一拍之后的过载余量 */
  overdrive: number
  /** 出手那一拍付掉的体力 */
  stamina: number
  /** 出手那一拍之后的冷却余量（拍） */
  cooldown: number
  /** 那一记的伤害 */
  damage: number
  /** 沿当前朝向的位移（m） */
  distance: number
  /** 起手式挂的那一格 */
  followup: { layers: number; trueDamage: number } | null
  /** 回响充能那一格 */
  echo: { chargesLeft: number; windowMul: number } | null
  /** 消音那一格：还剩几拍 ＋ 加成 */
  tacet: { ticksLeft: number; dmgBonus: number } | null
  /** 消音的**总时长**（从出手那一拍起算 ⇒ 收势那一拍还剩的 ＋ 收势帧） */
  silenceTotal: number
  /** 消音期间的伤害加成 */
  bonus: number
}

/**
 * 出一记战技并读那一格。
 * **消耗在出手那一拍付** ⇒ 体力那一格在 `tryStartAction` 之后立刻读（别等整段走完：回复曲线会掺进来）。
 */
function castAt(w: World, key: string, e: ReturnType<World['ai']['spawn']>, overdrive = 10): LevelRead {
  const p = w.player
  p.stats.overdrive = overdrive
  const stam0 = p.stats.stamina
  const start = w.time.tick + 1
  const z0 = p.pos.z
  expect(p.tryStartAction(key, w.time.tick), '过载付得起就该出式').toBe(true)
  const cooldown = p.skillCooldown(key)
  const overdriveAfter = p.stats.overdrive
  const staminaCost = stam0 - p.stats.stamina
  let hit = -1
  let damage = -1
  let end = -1
  let frozenAt = -1
  let frozenTicks = -1
  let muteTicks = -1
  for (let i = 0; i < 300; i++) {
    w.tick()
    if (hit < 0 && w.hits.filter((h) => h.victimId === e.id).length > 0) {
      const mine = w.hits.filter((h) => h.victimId === e.id)
      hit = w.time.tick - start + 1
      damage = mine[mine.length - 1].damage
    }
    if (frozenAt < 0 && (e as any).frozenTicks > 0) {
      frozenAt = w.time.tick - start + 1
      frozenTicks = (e as any).frozenTicks
    }
    if (muteTicks < 0 && (e as any).stats.muteTicksLeft > 0) muteTicks = (e as any).stats.muteTicksLeft
    if (!p.action) { end = w.time.tick - start + 1; break }
  }
  const any = p as any
  return {
    hit, frozenAt, frozenTicks, muteTicks, end,
    overdrive: overdriveAfter, stamina: staminaCost, cooldown, damage,
    distance: Math.abs(p.pos.z - z0),
    followup: any.followup ? { layers: any.followup.layers, trueDamage: any.followup.trueDamage } : null,
    echo: any.echo ? { chargesLeft: any.echo.chargesLeft, windowMul: any.echo.windowMul } : null,
    tacet: any.tacet ? { ticksLeft: any.tacet.ticksLeft, dmgBonus: any.tacet.dmgBonus } : null,
    silenceTotal: any.tacet ? any.tacet.ticksLeft + end : -1,
    bonus: any.tacet ? any.tacet.dmgBonus : -1,
  }
}

/** **每一级都在一个全新的世界里量**（冷却在出手那一拍就起算 ⇒ 同一个世界里连出两记会被自己的冷却挡住） */
function castLevel(movementId: string, level: number, slot = 0): LevelRead {
  const w = makeWorld()
  const e = dummy(w)
  const key = equipMove(w, movementId, slot)
  upgradeTo(w, movementId, level)
  const r = castAt(w, key, e)
  w.ai.despawn(e.id)
  w.off()
  return r
}

/** 底数大的那一格：按 ±5% 的带走（底数 ≤9 才取精确值） */
function expectBand(dmg: number, center: number, what: string): void {
  expect(dmg, `${what}（那一档的中心 ${center.toFixed(2)} × ±5% 的随机项那一档）`).toBeGreaterThanOrEqual(Math.floor(center * 0.95))
  expect(dmg, '（……也在那一档的上沿之内）').toBeLessThanOrEqual(Math.ceil(center * 1.05))
}

describe('KI-275 §4.8 乐章战技那一族的「三级成长列」 ＋「键不属于某一式」那一格', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **全音符斩的成长列**：冷却 **120→110→100** 拍、追加真伤 **8→12→18**、震裂层 **2→2→3** ⇒ 逐字对上', () => {
    const seen = [1, 2, 3].map((lv) => castLevel(MOVE.whole, lv))
    expect(seen.map((s) => s.cooldown), '**冷却那一列**（设计「120→110→100f」）').toEqual([120, 110, 100])
    expect(seen.map((s) => s.followup?.trueDamage), '**追加真伤那一列**（设计「真伤 8/12/18」）').toEqual([8, 12, 18])
    expect(seen.map((s) => s.followup?.layers), '**震裂层那一列**（设计「震裂 2/2/3 层」）').toEqual([2, 2, 3])
  })

  it('腿② **错拍步的成长列**：冷却 **240→210→180** 拍、位移 **2.5→3→3.5m** ⇒ 逐字对上', () => {
    const seen = [1, 2, 3].map((lv) => castLevel(MOVE.pace, lv))
    expect(seen.map((s) => s.cooldown), '**冷却那一列**（设计「240→210→180f」）').toEqual([240, 210, 180])
    expect(seen[0].distance, 'L1 的位移（设计 2.5m）').toBeCloseTo(2.5, 3)
    expect(seen[1].distance, 'L2 的位移（设计 3m）').toBeCloseTo(3, 3)
    expect(seen[2].distance, 'L3 的位移（设计 3.5m）').toBeCloseTo(3.5, 3)
  })

  it('腿③ **和弦爆的成长列**：冷却 **300→270→240** 拍、闷音 **180→210→240** 拍；伤害那一列 **36/48 是底数** ⇒ 结算落在 ±5% 的带里 ⇒ 逐字对上', () => {
    const seen = [1, 2, 3].map((lv) => castLevel(MOVE.chord, lv))
    expect(seen.map((s) => s.cooldown), '**冷却那一列**（设计「300→270→240f」）').toEqual([300, 270, 240])
    expect(seen.map((s) => s.muteTicks), '**闷音那一列**（设计「闷音 180/210/240f」）').toEqual([180, 210, 240])
    // 伤害那一列：设计给的是底数 ⇒ 运行时还要过「剩层×4%」与「音色标尺」两道乘数（KI-273 登记过）
    const w = makeWorld()
    const attrScale = 1 + (w.player.rpg.attrs.ton * 1.5) / 100
    w.off()
    expectBand(seen[1].damage, 36 * 1.28 * attrScale, 'L2 的伤害（底数 36）')
    expectBand(seen[2].damage, 48 * 1.28 * attrScale, 'L3 的伤害（底数 48）')
    // 三个等级各在一个新世界里，但**同一个种子 ⇒ 同一个随机项** ⇒ 三个读数之间的比例就是底数之间的比例
    const ratio2 = 36 / 26
    const ratio3 = 48 / 26
    const lo2 = Math.round(ratio2 * (seen[0].damage - 0.5))
    const hi2 = Math.ceil(ratio2 * (seen[0].damage + 0.5))
    expect(seen[1].damage, `**L2 与 L1 的读数之比恰是底数之比 36/26**（区间 ${lo2}–${hi2}）`).toBeGreaterThanOrEqual(lo2)
    expect(seen[1].damage, '（……也在那个区间之内）').toBeLessThanOrEqual(hi2)
    const lo3 = Math.round(ratio3 * (seen[0].damage - 0.5))
    const hi3 = Math.ceil(ratio3 * (seen[0].damage + 0.5))
    expect(seen[2].damage, `**L3 与 L1 的读数之比恰是底数之比 48/26**（区间 ${lo3}–${hi3}）`).toBeGreaterThanOrEqual(lo3)
    expect(seen[2].damage, '（……也在那个区间之内）').toBeLessThanOrEqual(hi3)
  })

  it('腿④ **休止斩的成长列**：冷却 **360→330→300** 拍、冻结 **48→60→72** 拍 ⇒ 逐字对上', () => {
    const seen = [1, 2, 3].map((lv) => castLevel(MOVE.caesura, lv))
    expect(seen.map((s) => s.cooldown), '**冷却那一列**（设计「360→330→300f」）').toEqual([360, 330, 300])
    expect(seen.map((s) => s.frozenTicks), '**冻结那一列**（设计「freezeTicks: 48/60/72f」）').toEqual([48, 60, 72])
  })

  it('腿⑤ **终止的成长列**：冷却 **420→390→360** 拍、冻结 **90→105→120** 拍、消音 **120→150→180** 拍（**从出手那一拍起算**）、加成 **15→20→25%** ⇒ 逐字对上', () => {
    const seen = [1, 2, 3].map((lv) => castLevel(MOVE.terminate, lv))
    expect(seen.map((s) => s.cooldown), '**冷却那一列**（设计「420→390→360f」）').toEqual([420, 390, 360])
    expect(seen.map((s) => s.frozenTicks), '**冻结那一列**（设计「freezeTicks: 90/105/120f」）').toEqual([90, 105, 120])
    expect(seen.map((s) => s.silenceTotal), '**消音那一列**（设计「silenceTicks: 120/150/180f」；从出手那一拍起算）').toEqual([120, 150, 180])
    expect(seen.map((s) => s.bonus), '**消音期间的伤害加成那一列**（设计「伤害 15/20/25%」）').toEqual([0.15, 0.2, 0.25])
  })

  it('腿⑥ **定音回响的成长列**：冷却 **300→270→240** 拍、充能 **1→2→2**、窗乘数 **2**（三级同值）⇒ 逐字对上', () => {
    const seen = [1, 2, 3].map((lv) => castLevel(MOVE.echo, lv))
    expect(seen.map((s) => s.cooldown), '**冷却那一列**（设计「300→270→240f」）').toEqual([300, 270, 240])
    expect(seen.map((s) => s.echo?.chargesLeft), '**充能次数那一列**（设计「echoCharges: 1/2/2」）').toEqual([1, 2, 2])
    expect(seen.map((s) => s.echo?.windowMul), '**窗乘数那一列**（设计「按 ×echo.windowMul（2）」）').toEqual([2, 2, 2])
  })

  it('腿⑦ **无声协奏的成长列**：冷却 **360→330→300** 拍；**消音 420 拍与加成 15% 三级同值**（设计「三级的时长与加成不涨——表没写成长，升级买的只是 CD」）⇒ 逐字对上', () => {
    const seen = [1, 2, 3].map((lv) => castLevel(MOVE.tacet, lv))
    expect(seen.map((s) => s.cooldown), '**冷却那一列**（设计「360→330→300f」）').toEqual([360, 330, 300])
    expect(seen.map((s) => s.silenceTotal), '**消音那一列**（设计「silenceTicks: 420f」＝三级同值）').toEqual([420, 420, 420])
    expect(seen.map((s) => s.bonus), '**加成那一列**（设计「三级的加成不涨」）').toEqual([0.15, 0.15, 0.15])
  })

  it('腿⑧ **帧那一列与消耗那一列不随等级变**（设计那张表这两栏都只有一格）：七式的**收势帧**三级同值（44／20／52／42／54／34／40）、**消耗**三级同值 ⇒ 与设计同口径', () => {
    const frames: Record<string, number[]> = {}
    const over: Record<string, number[]> = {}
    const stam: Record<string, number[]> = {}
    for (const id of Object.values(MOVE)) {
      const seen = [1, 2, 3].map((lv) => castLevel(id, lv))
      frames[id] = seen.map((s) => s.end)
      over[id] = seen.map((s) => s.overdrive)
      stam[id] = seen.map((s) => s.stamina)
    }
    expect(frames[MOVE.whole], '**全音符斩的收势帧三级同值**').toEqual([44, 44, 44])
    expect(frames[MOVE.pace], '**错拍步的收势帧三级同值**').toEqual([20, 20, 20])
    expect(frames[MOVE.chord], '**和弦爆的收势帧三级同值**').toEqual([52, 52, 52])
    expect(frames[MOVE.caesura], '**休止斩的收势帧三级同值**').toEqual([42, 42, 42])
    expect(frames[MOVE.terminate], '**终止的收势帧三级同值**').toEqual([54, 54, 54])
    expect(frames[MOVE.echo], '**定音回响的收势帧三级同值**').toEqual([34, 34, 34])
    expect(frames[MOVE.tacet], '**无声协奏的收势帧三级同值**').toEqual([40, 40, 40])
    expect(over[MOVE.whole], '**全音符斩的过载消耗三级同值**（出手那一拍付 2 ⇒ 余 8）').toEqual([8, 8, 8])
    expect(over[MOVE.chord], '**和弦爆的过载消耗三级同值**（付 3 ⇒ 余 7）').toEqual([7, 7, 7])
    expect(over[MOVE.caesura], '**休止斩的过载消耗三级同值**（付 8 ⇒ 余 2）').toEqual([2, 2, 2])
    expect(over[MOVE.terminate], '**终止的过载消耗三级同值**（付 10 ⇒ 余 0）').toEqual([0, 0, 0])
    expect(over[MOVE.echo], '**定音回响的过载消耗三级同值**（付 6 ⇒ 余 4）').toEqual([4, 4, 4])
    expect(over[MOVE.tacet], '**无声协奏的过载消耗三级同值**（付 7 ⇒ 余 3）').toEqual([3, 3, 3])
    expect(stam[MOVE.pace], '**错拍步的体力消耗三级同值**（付 15）').toEqual([15, 15, 15])
  })

  it('腿⑨ **「键不属于某一式」那一格**：键名由 `movements.json > slots[]` 现推（槽 1 ＝ `weaponSkill`／槽 2 ＝ `weaponSkillB`）；**同一式装进槽 2 也能出式**；两式各占一槽 ⇒ **两个键各打各的、冷却各算各的** ⇒ 与设计「每一式都写『槽 1/2 任选』」同一口径', () => {
    // 世界一：两式各占一槽
    const w = makeWorld()
    const e = dummy(w)
    const key1 = equipMove(w, MOVE.chord, 0)
    const key2 = equipMove(w, MOVE.pace, 1)
    expect(key1, '**槽 1 的键名**（`movements.json > slots[0].action` 现推）').toBe('weaponSkill')
    expect(key2, '**槽 2 的键名**（`movements.json > slots[1].action` 现推）').toBe('weaponSkillB')
    expect(Object.keys(w.player.skills).sort(), '**玩家手上那两把的键**').toEqual(['weaponSkill', 'weaponSkillB'])
    w.player.stats.overdrive = 10
    expect(w.player.tryStartAction(key2, w.time.tick), '**槽 2 那一键打得出式**').toBe(true)
    expect(w.player.skillCooldown(key2), '槽 2 那一式的冷却起来了').toBeGreaterThan(0)
    expect(w.player.skillCooldown(key1), '**槽 1 那一式的冷却没被带着起算**（冷却各算各的）').toBe(0)
    for (let i = 0; i < 200 && w.player.action; i++) w.tick()
    w.ai.despawn(e.id)
    alive.push(w.off)
    // 世界二：同一式装进槽 2 ⇒ 键名跟着槽走，不是跟着式子走
    const w2 = makeWorld()
    const e2 = dummy(w2)
    const sameKey2 = equipMove(w2, MOVE.chord, 1)
    expect(sameKey2, '**同一式装进槽 2 ⇒ 键名是槽 2 的那个**').toBe('weaponSkillB')
    w2.player.stats.overdrive = 10
    expect(w2.player.tryStartAction(sameKey2, w2.time.tick), '**同一式从槽 2 出得了式**').toBe(true)
    for (let i = 0; i < 200 && w2.player.action; i++) w2.tick()
    expect(w2.hits.filter((h) => h.victimId === e2.id).length, '**它打到了人**（和弦爆有判定窗）').toBeGreaterThan(0)
    w2.ai.despawn(e2.id)
    alive.push(w2.off)
  })
})
