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
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-281：**§6.1「体力消耗表」那张表剩下那几格第一次在真链上被量**（combat.md §6.1）。
 *
 * **这一批量的六样东西**：
 * ① **逐武器的轻击那一列**（设计「轻击（单段）7-12（武器表）」）；
 * ② **逐武器的重击那一列**（设计「重击 16-30」）；
 * ③ **逐武器的蓄力满那一列**（设计「蓄力满 24-40」）；
 * ④ **跳跃 6**；
 * ⑤ **处决 12**；
 * ⑥ **乐章战技「20-35 或过载支付」那一格**（七式里唯一付体力的是错拍步）；
 * 另：**「攀爬 12/s」与「定弦钩摆荡 10」那两格仍无承载体**（KI-204 已登记）⇒ 这一批把那件事**钉成机器判据**
 * （玩家的体力只从四个地方扣 ⇒ 那两个动词连扣体力的地方都没有）。
 *
 * **三条量具纪律**：
 * ① **消耗在出手那一拍付** ⇒ 读数要抢在回复曲线之前（**每一格都换一个世界**：上一记的招式还在手上会把下一记挡住）；
 * ② **体力条要摆到满**再出招（差值才是那一记的消耗）；
 * ③ **处决那一格要把敌人钉在玩家背后**（`faceSlow` 会把怪转回来 ⇒ 背后那一锥的判据就废了 ⇒ 钉在 AI 更新与结算**之间**）。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

const WEAPONS = [
  { id: 'wp_tuning_sword', name: '调律剑' },
  { id: 'wp_fortissimo_greatsword', name: '强音大剑' },
  { id: 'wp_drawpin_spear', name: '引针枪' },
  { id: 'wp_needlesilence', name: '无鸣' },
  { id: 'wp_overtone_bow', name: '泛音弓' },
  { id: 'wp_tuningfork_staff', name: '音叉杖' },
] as const

function makeWorld(weaponId = 'wp_tuning_sword') {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>(weaponId)
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
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  /** 只走一格，但在 `ai.update` 与 `combat.update` **之间**插一刀（敌人不许在结算前转开） */
  function tickPinned(pin: () => void, n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      pin()
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, tickPinned, off }
}

type World = ReturnType<typeof makeWorld>

/** 出一招并读它的体力消耗（**每一格都换一个世界** ⇒ 上一记的招式不会把下一记挡住） */
function costOf(w: World, act: (w: World) => void): number {
  const p = w.player
  p.stats.stamina = p.stats.staMax
  const s0 = p.stats.stamina
  act(w)
  return s0 - p.stats.stamina
}

/** 轻击那一记 */
function lightCost(w: World): number {
  const p = w.player
  p.stats.stamina = p.stats.staMax
  const s0 = p.stats.stamina
  w.frame.edges.add('attackLight')
  w.tick()
  w.frame.edges.delete('attackLight')
  return s0 - p.stats.stamina
}

/** 重击那一记（按住 5 拍再松手 ⇒ 走「点一下」那条） */
function heavyCost(w: World): number {
  const p = w.player
  p.stats.stamina = p.stats.staMax
  const s0 = p.stats.stamina
  w.frame.held.add('attackHeavy')
  w.tick(5)
  w.frame.held.delete('attackHeavy')
  w.tick()
  return s0 - p.stats.stamina
}

/** 蓄力满那一记（按住过阈值再松手） */
function chargedCost(w: World): number {
  const p = w.player
  p.stats.stamina = p.stats.staMax
  const s0 = p.stats.stamina
  w.frame.held.add('attackHeavy')
  w.tick(120)
  w.frame.held.delete('attackHeavy')
  w.tick()
  return s0 - p.stats.stamina
}

describe('KI-281 §6.1 体力消耗表：轻击／重击／蓄力满／跳跃／处决／战技', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **逐武器的轻击那一列**：**9／18／8／7／10／8** ⇒ 设计「7-12（武器表）」⇒ **大剑的 18 落在带外** ⇒ 登记', () => {
    const seen: Record<string, number> = {}
    for (const wpn of WEAPONS) {
      const w = makeWorld(wpn.id)
      seen[wpn.name] = lightCost(w)
      w.off()
    }
    expect(seen['调律剑'], '调律剑的轻击').toBe(9)
    expect(seen['强音大剑'], '**大剑的轻击 18**（设计那一栏写的是 7-12 ⇒ 大剑落在带外）').toBe(18)
    expect(seen['引针枪'], '引针枪的轻击').toBe(8)
    expect(seen['无鸣'], '无鸣的轻击').toBe(7)
    expect(seen['泛音弓'], '泛音弓的轻击').toBe(10)
    expect(seen['音叉杖'], '音叉杖的轻击').toBe(8)
  })

  it('腿② **逐武器的重击那一列**：**20／30／18／16／20／22** ⇒ 设计「重击 16-30」⇒ **六把逐字对上**', () => {
    const seen: Record<string, number> = {}
    for (const wpn of WEAPONS) {
      const w = makeWorld(wpn.id)
      seen[wpn.name] = heavyCost(w)
      w.off()
    }
    expect(seen['调律剑'], '调律剑的重击').toBe(20)
    expect(seen['强音大剑'], '大剑的重击').toBe(30)
    expect(seen['引针枪'], '引针枪的重击').toBe(18)
    expect(seen['无鸣'], '无鸣的重击').toBe(16)
    expect(seen['泛音弓'], '泛音弓的重击').toBe(20)
    expect(seen['音叉杖'], '音叉杖的重击').toBe(22)
    for (const [name, v] of Object.entries(seen)) {
      expect(v, `${name} 的重击在设计那一栏 16-30 之内`).toBeGreaterThanOrEqual(16)
      expect(v, `${name} 的重击在设计那一栏 16-30 之内`).toBeLessThanOrEqual(30)
    }
  })

  it('腿③ **逐武器的蓄力满那一列**：**28／40／24／—（无那一式）／14／26** ⇒ 设计「蓄力满 24-40」⇒ **弓的 14 落在带外**，且**无鸣那一族根本没有蓄力满那一式** ⇒ 登记', () => {
    const seen: Record<string, number> = {}
    for (const wpn of WEAPONS) {
      const w = makeWorld(wpn.id)
      seen[wpn.name] = chargedCost(w)
      w.off()
    }
    expect(seen['调律剑'], '调律剑的蓄力满').toBe(28)
    expect(seen['强音大剑'], '大剑的蓄力满').toBe(40)
    expect(seen['引针枪'], '引针枪的蓄力满').toBe(24)
    expect(seen['无鸣'], '**无鸣那一族没有蓄力满那一式 ⇒ 扣 0**（按住过阈值也放不出那一记）').toBe(0)
    expect(seen['泛音弓'], '**弓的蓄力满 14**（设计那一栏写的是 24-40 ⇒ 落在带外）').toBe(14)
    expect(seen['音叉杖'], '音叉杖的蓄力满').toBe(26)
  })

  it('腿④ **跳跃那一格**：**6** ⇒ 与设计「跳跃 6」**逐字对上**', () => {
    const w = makeWorld()
    const p = w.player
    p.stats.stamina = p.stats.staMax
    const s0 = p.stats.stamina
    w.frame.edges.add('jump')
    w.tick()
    w.frame.edges.delete('jump')
    expect(s0 - p.stats.stamina, '**跳一下扣 6 点体力**').toBe(6)
    expect(p.grounded, '（跳起来之后人就离地了）').toBe(false)
    w.off()
  })

  it('腿⑤ **处决那一格**：运行时**一个体力都不扣**（设计「处决 12」）⇒ **那一格没有承载体** ⇒ 登记（静杀那一记本身是真的：怪当场死）', () => {
    const w = makeWorld()
    const p = w.player
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    const at = { x: 0, z: -1.5, yaw: Math.PI }
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = 0
    e.stats.hp = Math.round(e.stats.hpMax * 0.3) // 静杀线（设计 35%）
    p.stats.stamina = p.stats.staMax
    const s0 = p.stats.stamina
    w.frame.edges.add('interact')
    w.tickPinned(() => { e.pos.x = at.x; e.pos.z = at.z; e.yaw = at.yaw })
    w.frame.edges.delete('interact')
    expect((p as any).executing, '**处决的演出版进了（静杀那一记真的落下）**').toBeTruthy()
    expect(e.stats.hp, '（怪当场死）').toBe(0)
    expect(s0 - p.stats.stamina, '**体力一个字节没扣**（设计「处决 12」⇒ 那一格没有承载体）').toBe(0)
    w.ai.despawn(e.id)
    w.off()
  })

  it('腿⑥ **乐章战技那一格**（设计「20-35 或过载支付」）：**错拍步付 15 点体力**（落在带外）＋ **其余六式付过载、体力 0** ⇒ 登记', () => {
    // 错拍步：唯一付体力的一式
    const w = makeWorld()
    const book = w.rpg.moves
    const mv = movementConfig().movements.find((x) => x.id === 'mv_syncopace')!
    const page = book.page(mv.page)!
    if (!book.isLit(page.id)) {
      if (page.unlock.flag) bus.emit('world.flag', { key: page.unlock.flag, value: true })
      else w.rpg.inv.add(page.unlock.item ?? '', page.unlock.count ?? 0)
      expect(book.unlockPage(page.id, w.rpg.inv).ok).toBe(true)
    }
    for (let i = 0; i < 40 && w.rpg.prog.rank < book.slotRank(0)!; i++) w.rpg.prog.addResonance(300)
    expect(book.equip(0, 'mv_syncopace', w.rpg.prog.rank).ok).toBe(true)
    w.player.setSkills(w.rpg.skillLoadout())
    w.player.stats.overdrive = 10
    const cost = costOf(w, (ww) => {
      expect(ww.player.tryStartAction(book.cfg.slots[0].action, ww.time.tick), '错拍步出得了式').toBe(true)
    })
    expect(cost, '**错拍步扣 15 点体力**（设计那一栏写的是 20-35 ⇒ 落在带外）').toBe(15)
    expect(w.player.stats.overdrive, '（它不付过载）').toBe(10)
    w.off()
    // 全音符斩：付过载、体力 0
    const w2 = makeWorld()
    const book2 = w2.rpg.moves
    const mv2 = movementConfig().movements.find((x) => x.id === 'mv_wholenotecut')!
    const page2 = book2.page(mv2.page)!
    if (!book2.isLit(page2.id)) {
      if (page2.unlock.flag) bus.emit('world.flag', { key: page2.unlock.flag, value: true })
      else w2.rpg.inv.add(page2.unlock.item ?? '', page2.unlock.count ?? 0)
      expect(book2.unlockPage(page2.id, w2.rpg.inv).ok).toBe(true)
    }
    for (let i = 0; i < 40 && w2.rpg.prog.rank < book2.slotRank(0)!; i++) w2.rpg.prog.addResonance(300)
    expect(book2.equip(0, 'mv_wholenotecut', w2.rpg.prog.rank).ok).toBe(true)
    w2.player.setSkills(w2.rpg.skillLoadout())
    w2.player.stats.overdrive = 10
    const cost2 = costOf(w2, (ww) => {
      expect(ww.player.tryStartAction(book2.cfg.slots[0].action, ww.time.tick), '全音符斩出得了式').toBe(true)
    })
    expect(cost2, '**全音符斩不扣体力**（它付的是过载）').toBe(0)
    expect(w2.player.stats.overdrive, '（过载付掉 2 ⇒ 余 8）').toBe(8)
    w2.off()
  })

  it('腿⑦ **「攀爬 12/s」与「定弦钩摆荡 10」那两格仍无承载体**（KI-204 已登记）：玩家的体力**只从四个地方扣** ⇒ 那两个动词连扣体力的地方都没有 ⇒ 登记', () => {
    // 机器判据：全库 `spendStamina(` 的调用点只有四处（出手那一格／跳跃／翻滚／格挡）
    // **扫的是「这一份测试所在的那棵树」**（不是某个写死的绝对路径）⇒ 平面上跑的时候扫的就是平面的 `src`
    const sites: string[] = []
    const srcRoot = fileURLToPath(new URL('../../src', import.meta.url))
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = `${dir}/${name}`
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!name.endsWith('.ts')) continue
        readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => {
          if (l.includes('spendStamina(') && !l.includes('amount: number')) sites.push(`${p.slice(srcRoot.length + 1)}:${i + 1}`)
        })
      }
    }
    walk(srcRoot)
    expect(sites.length, `玩家的体力只从四处扣（出手／跳跃／翻滚／格挡）：${sites.join(' ')}`).toBe(4)
    expect(sites.some((s) => /climb|hook/i.test(s)), '**攀爬与定弦钩仍然没有扣体力的地方**').toBe(false)
  })
})
