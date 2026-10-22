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
 * KI-273：**§4.8 乐章战技那一族**（七式）第一次在真链上被量。
 *
 * 设计那张表（combat.md §4.8）每一式给六格：Startup／Active／**Recovery（绝对帧）**／消耗／冷却 L1→L3／数据给的结算。
 * **这一批有十条腿**：①–⑦ **七式各自**（收势那一帧／消耗／冷却 L1／结算格里读得到的那几格）；
 * ⑧ 「**每用一次 +2**」那一格；⑨ **和弦爆的伤害那一格**（底数 vs 结算数）；
 * ⑩ **全音符斩的追加真伤**（记在下一记重击上、只兑一记）。
 *
 * **三条口径（都是那一族自己写的）**：
 * ① **Recovery 那一栏是整段结束的绝对帧**，不是后摇时长（引擎判据 `action.tick >= frame.recovery`）；
 * ② **消耗在出手那一拍就付**（过载／体力），**冷却也在出手那一拍起算**；
 * ③ **「每用一次 +2」那一格（休止斩／终止）**：那一记出手后价就涨了，但**过载条一攒满就把涨价清掉**
 *    ⇒ 运行时看得见的效果是「第二记必须等过载条重新攒满」（设计那一行的括注写的正是这句）。
 *
 * **三条量具纪律**：
 * ① **挨打的那只怪必须钉成被动**（KI-267 立的规矩：它一挨打就进 combat 状态反打 ⇒ 玩家的招式被打断）；
 * ② **过载条不会自己回涨**（它只有弹反／完美格挡／换气弹反三条入账）⇒ ⑧ 那个「复位」真的是「攒满」；
 * ③ **两个世界逐拍对齐比差值**（同一个种子 ⇒ 同一个随机项 ⇒ 差值与比值都是真读数）。
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

interface CastRead {
  /** 招式键 */
  key: string
  /** 命中那一拍（相对出手那一拍） */
  hit: number
  /** 敌身上的冻结生效那一拍（相对出手那一拍） */
  frozenAt: number
  /** 敌身上的冻结生效那一拍的冻结时长（设计那一格 48/60/72f、90/105/120f） */
  frozenTicks: number
  /** 敌身上的闷音生效那一拍的时长（设计那一格 180/210/240f） */
  muteTicks: number
  /** 玩家身上的消音挂上那一拍（相对出手那一拍） */
  tacetAt: number
  /** 玩家身上的回响充能挂上那一拍（相对出手那一拍） */
  echoAt: number
  /** 收势那一拍（相对出手那一拍）＝ 设计的 Recovery 绝对帧 */
  end: number
  /** 出手那一拍之后的过载余量 */
  overdrive: number
  /** 出手那一拍之后的冷却余量（拍） */
  cooldown: number
  /** 那一记的伤害 */
  damage: number
}

/** 出一记战技并量四格：收势帧／消耗／冷却／结算 */
function castMove(w: World, key: string, e: ReturnType<World['ai']['spawn']>, overdrive = 0): CastRead {
  const p = w.player
  w.player.stats.overdrive = overdrive
  const start = w.time.tick + 1
  expect(p.tryStartAction(key, w.time.tick), '过载付得起就该出式').toBe(true)
  const after = { overdrive: p.stats.overdrive, stamina: p.stats.stamina }
  const cooldown = p.skillCooldown(key)
  let hit = -1
  let damage = -1
  let end = -1
  let frozenAt = -1
  let frozenTicks = -1
  let muteTicks = -1
  let tacetAt = -1
  let echoAt = -1
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
    if (tacetAt < 0 && p.tacet !== null) tacetAt = w.time.tick - start + 1
    if (echoAt < 0 && p.echo !== null) echoAt = w.time.tick - start + 1
    if (!p.action) { end = w.time.tick - start + 1; break }
  }
  return { key, hit, frozenAt, frozenTicks, muteTicks, tacetAt, echoAt, end, overdrive: after.overdrive, cooldown, damage }
}

/** 出一记**和弦爆**并读它的伤害（过载条上剩几层由调用方给 ⇒ 那一层乘数由它决定） */
function chordDamage(overdrive: number): { damage: number; ton: number } {
  const w = makeWorld()
  const e = dummy(w)
  const key = equipMove(w, MOVE.chord)
  const r = castMove(w, key, e, overdrive)
  const ton = w.player.rpg.attrs.ton
  w.ai.despawn(e.id)
  w.off()
  return { damage: r.damage, ton }
}

/** 出一记**重击**并读它的伤害（KI-269／KI-271 那一套量法：按住 5 拍再松手 ⇒ 走的是「点一下」那条重击） */
function heavyDamage(w: World, e: ReturnType<World['ai']['spawn']>): number {
  w.frame.held.add('attackHeavy')
  w.tick(5)
  w.frame.held.delete('attackHeavy')
  w.tick()
  for (let i = 0; i < 260; i++) {
    w.tick()
    const mine = w.hits.filter((h) => h.victimId === e.id)
    if (mine.length > 0) return mine[mine.length - 1].damage
  }
  return -1
}

/** 出一记**轻击**并读它的伤害（轻击那一记兑不了重击那一格 —— 设计 §4.8 第三条） */
function lightDamage(w: World, e: ReturnType<World['ai']['spawn']>): number {
  w.frame.edges.add('attackLight')
  w.tick()
  w.frame.edges.delete('attackLight')
  for (let i = 0; i < 260; i++) {
    w.tick()
    const mine = w.hits.filter((h) => h.victimId === e.id)
    if (mine.length > 0) return mine[mine.length - 1].damage
  }
  return -1
}

describe('KI-273 §4.8 乐章战技那一族（七式）：收势帧／消耗／冷却／结算', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **全音符斩**：收势第 **44** 拍（设计的 Recovery **绝对帧** 44f）、过载 **2**、冷却 **120** 拍；起手式压在下一记上的是**震裂 2 层 ＋ 真伤 8** ⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const key = equipMove(w, MOVE.whole)
    const r = castMove(w, key, e, 10)
    expect(r.end, '收势那一拍（**那一栏是绝对帧**：44f ⇒ 第 44 拍收势）').toBe(44)
    expect(r.overdrive, '出手那一拍付掉的过载（设计「过载 2」）').toBe(8)
    expect(r.cooldown, '出手那一拍起算的冷却（设计「120→110→100f」的 L1）').toBe(120)
    const fu = (w.player as any).followup
    expect(fu, '**起手式压在下一记上**（设计「起手式挂震裂 2/2/3 层；追加真伤 8/12/18 记在下一记重击上」）').toBeTruthy()
    expect(fu.layers, '震裂层数（L1 ＝ 2）').toBe(2)
    expect(fu.trueDamage, '追加的真伤（L1 ＝ 8）').toBe(8)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **错拍步**：收势第 **20** 拍（设计 20f）、体力 **15**、冷却 **240** 拍、位移 **2.5m**（设计「沿当前朝向位移 2.5/3/3.5m」的 L1）⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const key = equipMove(w, MOVE.pace)
    const p = w.player
    const z0 = p.pos.z
    const stam0 = p.stats.stamina
    p.stats.stamina = 100
    const r = castMove(w, key, e, 0)
    expect(r.end, '收势那一拍（设计 20f）').toBe(20)
    expect(stam0 - p.stats.stamina, '出手那一拍付掉的体力（设计「体力 15」）').toBe(15)
    expect(r.cooldown, '冷却余量（设计「240→210→180f」的 L1）').toBe(240)
    expect(Math.abs(p.pos.z - z0), '沿当前朝向的位移（设计 L1 ＝ 2.5m；**位移与 BPM 无关**）').toBeCloseTo(2.5, 3)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿③ **和弦爆**：命中第 **16** 拍（设计的 Startup 16f）、收势第 **52** 拍（设计 52f）、过载 **3**、冷却 **300** 拍 ⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const key = equipMove(w, MOVE.chord)
    const r = castMove(w, key, e, 10)
    expect(r.hit, '命中那一拍（设计的 Startup ＝ 16f）').toBe(16)
    expect(r.end, '收势那一拍（设计 52f）').toBe(52)
    expect(r.overdrive, '出手那一拍付掉的过载（设计「过载 3」）').toBe(7)
    expect(r.cooldown, '冷却余量（设计「300→270→240f」的 L1）').toBe(300)
    expect(r.muteTicks, '**闷音那一格**（设计「闷音 180/210/240f」的 L1）').toBe(180)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ **休止斩**：冻结生效第 **12** 拍（设计的 Startup 12f ＝ 判定窗第一拍）、冻结 **48** 拍、收势第 **42** 拍、过载 **8**、冷却 **360** 拍 ⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const key = equipMove(w, MOVE.caesura)
    const r = castMove(w, key, e, 10)
    expect(r.frozenAt, '**冻结生效那一拍**（设计「判定窗第一记落下的那一 tick，场上每个还活着的敌人被按住」）').toBe(12)
    expect(r.frozenTicks, '**冻结时长那一格**（设计「freezeTicks: 48/60/72f」的 L1）').toBe(48)
    expect(r.end, '收势那一拍（设计 42f）').toBe(42)
    expect(r.overdrive, '出手那一拍付掉的过载（设计「过载 8」）').toBe(2)
    expect(r.cooldown, '冷却余量（设计「360→330→300f」的 L1）').toBe(360)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑤ **终止**：冻结生效第 **20** 拍（设计的 Startup 20f）、消音 **120** 拍（**从出手那一拍起算**）、收势第 **54** 拍、过载 **10**、冷却 **420** 拍 ⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const key = equipMove(w, MOVE.terminate)
    const r = castMove(w, key, e, 10)
    expect(r.frozenAt, '**冻结生效那一拍**（设计的 Startup ＝ 20f）').toBe(20)
    expect(r.frozenTicks, '**冻结时长那一格**（设计「freezeTicks: 90/105/120f」的 L1）').toBe(90)
    expect(r.tacetAt, '**消音在出手那一拍就挂上了**（不是判定窗第一拍）').toBe(1)
    expect(r.end, '收势那一拍（设计 54f）').toBe(54)
    expect(r.overdrive, '出手那一拍付掉的过载（设计「过载 10」）').toBe(0)
    expect(r.cooldown, '冷却余量（设计「420→390→360f」的 L1）').toBe(420)
    const tacet = (w.player as any).tacet
    expect(tacet, '**消音状态在出手那一拍就挂上了**（不是判定窗第一拍）').toBeTruthy()
    expect(tacet.ticksLeft, '消音还剩几拍（设计 120f；从出手那一拍起算 ⇒ 收势那一拍还剩 120−54 ＝ 66）').toBe(66)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑥ **定音回响**：收势第 **34** 拍（设计 34f）、过载 **6**、冷却 **300** 拍；回响充能 **1** 次、弹反窗加宽乘数 **2** ⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const key = equipMove(w, MOVE.echo)
    const r = castMove(w, key, e, 10)
    expect(r.end, '收势那一拍（设计 34f）').toBe(34)
    expect(r.overdrive, '出手那一拍付掉的过载（设计「过载 6」）').toBe(4)
    expect(r.cooldown, '冷却余量（设计「300→270→240f」的 L1）').toBe(300)
    const echo = (w.player as any).echo
    expect(echo, '**回响充能在出手那一拍就存下了**').toBeTruthy()
    expect(r.echoAt, '**回响充能挂上那一拍**（出手那一拍）').toBe(1)
    expect(echo.chargesLeft, '充能次数（L1 ＝ 1）').toBe(1)
    expect(echo.windowMul, '弹反窗加宽乘数（设计 2）').toBe(2)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑦ **无声协奏**：收势第 **40** 拍（设计 40f）、过载 **7**、冷却 **360** 拍；消音 **420** 拍（**从出手那一拍起算** ⇒ 那 420 拍里含着这一式自己的 14 拍起手**）⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = dummy(w)
    const key = equipMove(w, MOVE.tacet)
    const r = castMove(w, key, e, 10)
    expect(r.end, '收势那一拍（设计 40f）').toBe(40)
    expect(r.overdrive, '出手那一拍付掉的过载（设计「过载 7」）').toBe(3)
    expect(r.cooldown, '冷却余量（设计「360→330→300f」的 L1）').toBe(360)
    const tacet = (w.player as any).tacet
    expect(tacet, '**消音状态在出手那一拍就挂上了**').toBeTruthy()
    expect(tacet.ticksLeft, '消音还剩几拍（设计 420f；从出手那一拍起算 ⇒ 收势那一拍还剩 420−40 ＝ 380）').toBe(380)
    expect(tacet.dmgBonus, '消音期间的伤害加成（设计 15%）').toBe(0.15)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑧ 「**每用一次 +2**」那一格（休止斩）在运行时**不是涨价，而是「第二记必须先把过载条凑满」**：第一记出手后价就涨了（成本 8＋2 ＝ 10），过载条只有 2 ⇒ 第二记付不起 ⇒ 拒绝；等条子真的涨回满 ⇒ 涨价被清掉 ⇒ 第二记按底价 8 出 ⇒ 与设计那一行的括注「复位＝过载条重新攒满」同一口径 ⇒ 登记', () => {
    const w = makeWorld()
    const e = dummy(w)
    const key = equipMove(w, MOVE.caesura)
    const p = w.player
    // 第一记：过载满 ⇒ 出式 ⇒ 欠 8
    p.stats.overdrive = 10
    expect(p.tryStartAction(key, w.time.tick), '第一记：过载付得起就该出式').toBe(true)
    expect(p.stats.overdrive, '第一记付掉 8 ⇒ 余 2').toBe(2)
    expect(p.skillRampOf(key), '**那一记出手后价就涨了**（设计「每用一次 +2」）').toBe(2)
    for (let i = 0; i < 200 && p.action; i++) w.tick()
    // 冷却先挡着
    expect(p.skillCooldown(key), '冷却还在（设计 360f）').toBeGreaterThan(0)
    expect(p.tryStartAction(key, w.time.tick), '冷却没过 ⇒ 第二记被挡').toBe(false)
    // 等冷却过去（过载条**不会自己回涨**：它只有弹反／完美格挡／换气弹反三条入账 ⇒ 仍是 2）
    for (let i = 0; i < 400 && p.skillCooldown(key) > 0; i++) w.tick()
    expect(p.skillCooldown(key), '冷却过去了').toBe(0)
    expect(p.stats.overdrive, '过载条没有自己回涨（§11：只有弹反那三条入账）').toBe(2)
    expect(p.tryStartAction(key, w.time.tick), '**冷却过了但条子没满 ⇒ 第二记还是被拒**（涨价把成本顶到 10，而条上只有 2）').toBe(false)
    // 凑满 ⇒ 涨价被清掉 ⇒ 第二记按底价出
    p.addOverdrive(8)
    expect(p.stats.overdrive, '过载条凑满了').toBe(10)
    expect(p.skillRampOf(key), '**过载条一攒满 ⇒ 涨价被清掉**').toBe(0)
    expect(p.tryStartAction(key, w.time.tick), '凑满之后第二记按底价出式').toBe(true)
    expect(p.stats.overdrive, '第二记按底价 8 付 ⇒ 余 2').toBe(2)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑨ **和弦爆的伤害那一格：设计给的 26/36/48 是「底数」** —— 运行时那一记还要过两道乘数（**命中那一刻过载条上剩的层数 ×4%** ＋ **招式表自己那张音色标尺**）＋ ±5% 的随机项 ⇒ 两个世界逐拍对齐后逐字对上', () => {
    // 世界 A：过载恰好等于消耗（3）⇒ 命中那一拍过载条上是 0 ⇒ 过载那一层乘数是 1
    // 世界 B：过载 10 ⇒ 命中那一拍剩 7 ⇒ 那一层乘数是 1 + 7×0.04 = 1.28
    // 两个世界同一个种子 ⇒ 同一个随机项 ⇒ 两个读数之间的比例就是那一层乘数本身
    const a = chordDamage(3)
    const b = chordDamage(10)
    expect(a.damage, '过载 3（命中时剩 0 层）那一记打出了伤害').toBeGreaterThan(0)
    expect(b.damage, '过载 10（命中时剩 7 层）那一记打出了伤害').toBeGreaterThan(0)
    // 属性标尺：招式表自己那张小表（音色 ×1.5）⇒ 运行时那条 `1 + 音色×1.5/100`
    const attrScale = 1 + (a.ton * 1.5) / 100
    const loA = Math.floor(26 * attrScale * 0.95)
    const hiA = Math.ceil(26 * attrScale * 1.05)
    expect(a.damage, `**底数 26** × 属性标尺 ${attrScale.toFixed(3)} × ±5% 的随机项那一档`).toBeGreaterThanOrEqual(loA)
    expect(a.damage, '（……也在那一档的上沿之内）').toBeLessThanOrEqual(hiA)
    const loB = Math.floor(26 * 1.28 * attrScale * 0.95)
    const hiB = Math.ceil(26 * 1.28 * attrScale * 1.05)
    expect(b.damage, '**过载那一层乘数 1.28**（剩 7 层 ×4%）之后仍在那一档之内').toBeGreaterThanOrEqual(loB)
    expect(b.damage, '（……也在那一档的上沿之内）').toBeLessThanOrEqual(hiB)
    // 同一个随机项 ⇒ 两个读数的比例**恰好**是那一层乘数（取整只吃掉半格）
    const loRel = Math.round(1.28 * (a.damage - 0.5))
    const hiRel = Math.ceil(1.28 * (a.damage + 0.5)) - 1
    expect(b.damage, `**两世界逐拍对齐**：读数之比恰是 1.28（区间 ${loRel}–${hiRel}）`).toBeGreaterThanOrEqual(loRel)
    expect(b.damage, '（……也在那个区间之内）').toBeLessThanOrEqual(hiRel)
  })

  it('腿⑩ **全音符斩的「追加真伤 8 记在下一记重击上，只兑一记」**：那一笔在运行时是**直接加在结算数上**（不吃 DR、不吃钟甲）⇒ 两个世界逐拍对齐的差值恰为 **8**；**轻击兑不了那一记**；**兑掉之后就没了**；另：**起手式在出手那一拍就挂上了**（全音符斩自己**没有判定窗** ⇒ 它打不到任何人 ⇒ 设计第三条「真打到人之后才武装」在运行时不是那一格）⇒ 登记', () => {
    // 世界 A：先出全音符斩（起手式挂上），再出一记重击
    const a = makeWorld()
    const ea = dummy(a)
    const keyA = equipMove(a, MOVE.whole)
    a.player.stats.overdrive = 10
    expect(a.player.tryStartAction(keyA, a.time.tick), '过载付得起就该出式').toBe(true)
    expect((a.player as any).followup, '**起手式在出手那一拍就挂上了**（还没打中任何人）').toBeTruthy()
    for (let i = 0; i < 200 && a.player.action; i++) a.tick()
    expect(a.hits.filter((h) => h.victimId === ea.id).length, '**全音符斩自己一个判定窗都没有 ⇒ 它打不到任何人**（`movements.json` 那一式没有 `hitbox`）').toBe(0)
    const dmgA = heavyDamage(a, ea)
    expect(dmgA, '重击打出了伤害').toBeGreaterThan(0)
    expect((a.player as any).followup, '**兑掉之后就没了**（只兑一记）').toBe(null)
    // 世界 B：同一套世界，只是不出全音符斩 ⇒ 两个世界逐拍对齐（同一个种子 ⇒ 同一个随机项）
    const b = makeWorld()
    const eb = dummy(b)
    equipMove(b, MOVE.whole)
    const dmgB = heavyDamage(b, eb)
    expect(dmgB, '重击打出了伤害').toBeGreaterThan(0)
    expect(dmgA - dmgB, '**两世界逐拍对齐的差值恰为 8**（那一笔是直接加在结算数上的 ⇒ 不吃 DR）').toBe(8)
    // 世界 C：轻击兑不了那一记（轻击那一记不销这一格）
    const c = makeWorld()
    const ec = dummy(c)
    const keyC = equipMove(c, MOVE.whole)
    c.player.stats.overdrive = 10
    expect(c.player.tryStartAction(keyC, c.time.tick)).toBe(true)
    for (let i = 0; i < 200 && c.player.action; i++) c.tick()
    const light = lightDamage(c, ec)
    expect(light, '轻击打出了伤害').toBeGreaterThan(0)
    expect((c.player as any).followup, '**轻击没有把那一格兑掉**（设计第三条：轻击也兑不了重击那一记）').toBeTruthy()
    // （轻击之后那一记重击的差值本批**不重量**：轻击把随机项的序号挪了一位 ⇒ 两个世界不再逐拍对齐）
    c.ai.despawn(ec.id)
    a.ai.despawn(ea.id)
    b.ai.despawn(eb.id)
    alive.push(a.off, b.off, c.off)
  })
})
