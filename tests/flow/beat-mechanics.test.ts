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
 * KI-287：**§2.2「三大节拍机制」里剩下那两格 ＋ §3.1「家族定价红线」在真链上的复核**。
 *
 * **这一批量的四样东西**：
 * ① **节拍空隙**（幽灵八：只在拍间空隙移动与显形；拍点上定身 ＋ 半透明（不可被击中））；
 * ② **伪拍点**（投掷音色晶制造伪拍点逼它实体化）；
 * ③ **3/4 拍弹反窗**（奥斯塔拉：重拍弹反窗口扩大为 117ms（7f））；
 * ④ **家族定价红线**（「第一记轻击的伤害 ÷ 它的整段周期」在近战四族之间极差 ≤ **1.25×**）。
 *
 * **三条量具纪律**：
 * ① **幽灵八那一格要数拍**：它每一拍都在重算相位 ⇒ 「隐形的那几拍」要跟「离拍点 ≤ 12 拍的那几拍」对齐着数；
 * ② **奥斯塔拉那一格要让她的拍子真的接管时钟**（`AISystem.syncClock`：Boss 在 combat／chase 态才接管）⇒
 *    否则量的是**区域拍**（那是另一回事）；
 * ③ **定价红线要在真链上重算**：`tests/unit/movesets.test.ts` 那一道闸读的是**帧表** ⇒ 表守住了不等于真链守住了。
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
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, hits, off, pins }
}

describe('KI-287 §2.2 的节拍机制 ＋ §3.1 的家族定价红线', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **节拍空隙那一格**：幽灵八**在离拍点 ≤ 12 拍的那些拍里一律隐形**（= 拍点两侧各 12 拍，不只是拍点本身）**而且那些拍里它一动不动**；**出了那个窗口它才动** ⇒ 「拍点上定身 ＋ 半透明」与「只在拍间空隙移动」**逐字对上**，「只在拍点」这一半是 **±12 拍** ⇒ 登记', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_phantome', { x: 0, y: 0, z: -4 }, 'probe')
    e.alertness = 0
    e.enter('chase')
    e.alertness = 100
    w.player.pos = { x: 0, y: 0, z: 0 }
    let intangible = 0
    let nearBeat = 0
    let movedIntangible = 0
    let movedTangible = 0
    let prev = { x: e.pos.x, z: e.pos.z }
    for (let i = 0; i < 120; i++) {
      w.tick()
      const isIntangible = (e as any).intangible
      const fromBeat = w.rhythm.ticksFromBeatPoint()
      const moved = prev.x !== e.pos.x || prev.z !== e.pos.z
      if (isIntangible) { intangible++; if (moved) movedIntangible++ } else if (moved) movedTangible++
      if (fromBeat <= 12) nearBeat++
      prev = { x: e.pos.x, z: e.pos.z }
    }
    expect(nearBeat, '**离拍点 ≤ 12 拍的那些拍**（120 拍里占这么多）').toBeGreaterThan(50)
    expect(intangible, '**它隐形的那些拍**与上一行**一模一样** ⇒ 隐形窗口就是「拍点两侧各 12 拍」').toBe(nearBeat)
    expect(movedIntangible, '**它隐形的那些拍里一动不动**（设计「拍点上定身」）').toBe(0)
    expect(movedTangible, '**出了那个窗口它才动**（设计「只在拍间空隙移动」；这一行是对照组）').toBeGreaterThan(0)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **伪拍点那一格**：一声够响的（0.8）声源在听觉半径内 ⇒ **显形 180 拍**；够不着的一声 ⇒ 什么也没有 ⇒ 与设计「投掷音色晶制造伪拍点逼其实体化」**逐字对上**', () => {
    const a = makeWorld()
    const e = a.ai.spawn('en_phantome', { x: 0, y: 0, z: -1.2 }, 'probe')
    e.alertness = 0
    e.enter('idle')
    a.pins.push(() => { e.pos.x = 0; e.pos.z = -1.2 })
    a.tick(2)
    expect((e as any).revealTicks, '（还没显形）').toBe(0)
    bus.emit('sound.source', { id: 'player', pos: { x: 0, y: 0, z: 0 }, loudness: 0.8 })
    expect((e as any).revealTicks, '**够响的一声 ⇒ 显形 180 拍**').toBe(180)
    const b = makeWorld()
    const e2 = b.ai.spawn('en_phantome', { x: 0, y: 0, z: -1.2 }, 'probe')
    e2.alertness = 0
    e2.enter('idle')
    b.pins.push(() => { e2.pos.x = 0; e2.pos.z = -1.2 })
    b.tick(2)
    bus.emit('sound.source', { id: 'player', pos: { x: 0, y: 0, z: 40 }, loudness: 0.8 })
    expect((e2 as any).revealTicks, '**够不着的一声 ⇒ 什么也没发生**').toBe(0)
    a.ai.despawn(e.id)
    b.ai.despawn(e2.id)
    alive.push(a.off, b.off)
  })

  it('腿③ **3/4 拍弹反窗那一格**：奥斯塔拉接管时钟（**3/4 拍 108BPM**）之后，弹反窗**还是 6 拍**（按下那一拍自己吃掉 1 ⇒ 读到 5）⇒ 设计「重拍弹反窗口扩大为 117ms（7f）」**没有承载体** ⇒ 登记', () => {
    // 对照：区域拍下按下弹反 ⇒ 窗口几拍
    const a = makeWorld()
    const pa = a.player
    pa.stats.stamina = 100
    a.frame.edges.add('parry')
    a.tick()
    a.frame.edges.delete('parry')
    const base = pa.parryTicksLeft
    expect(base, '**区域拍下：按下那一拍之后窗口还剩 5 拍**（配置是 6 拍 ⇒ 按下那一拍自己吃掉 1）').toBe(5)
    // 奥斯塔拉接管时钟 ⇒ 再量一次
    const b = makeWorld()
    const pb = b.player
    const boss = b.ai.spawn('en_ostlara', { x: 0, y: 0, z: -3 }, 'boss')
    boss.enter('chase')
    boss.alertness = 100
    b.player.pos = { x: 0, y: 0, z: 0 }
    b.pins.push(() => { boss.pos.x = 0; boss.pos.z = -3 })
    b.tick(4)
    expect(b.rhythm.bpm, '**她的拍子真的接管了时钟**（3/4 拍 108BPM）——这一格的前提').toBe(108)
    pb.stats.stamina = 100
    b.frame.edges.add('parry')
    b.tick()
    b.frame.edges.delete('parry')
    expect(pb.parryTicksLeft, '**在她的拍子里，弹反窗一格没变宽**（设计要 7f）').toBe(base)
    a.ai.despawn('x')
    b.ai.despawn(boss.id)
    alive.push(a.off, b.off)
  })

  it('腿④ **家族定价红线在真链上**：逐武器的 L1「伤害 ÷ 整段拍数」＝ **0.300／0.333／0.297／0.318／0.278／0.219** ⇒ **近战四族的极差 1.12× ≤ 1.25×** ⇒ 红线守得住；但**设计给的三个锚点（9/30、12/37、21/60）是帧表的数** —— 真链上还要过**连段的 ×0.95**（大剑 21 → **20**、枪 12 → **11**）⇒ 登记', () => {
    const rows: Array<{ name: string; damage: number; end: number; dps: number }> = []
    for (const wpn of WEAPONS) {
      const w = makeWorld(wpn.id)
      const p = w.player
      const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.2 }, 'probe')
      e.alertness = 0
      e.enter('idle')
      p.pos = { x: 0, y: 0, z: 0 }
      p.yaw = Math.PI
      w.pins.push(() => { e.pos.x = 0; e.pos.z = -1.2; if (e.state !== 'idle') e.enter('idle'); e.attack = null })
      w.tick(3)
      const start = w.time.tick + 1
      w.frame.edges.add('attackLight')
      w.tick()
      w.frame.edges.delete('attackLight')
      let damage = 0
      let end = -1
      for (let i = 0; i < 200; i++) {
        w.tick()
        if (damage === 0) {
          const mine = w.hits.filter((h: any) => h.victimId === e.id)
          if (mine.length > 0) damage = mine[mine.length - 1].damage
        }
        if (damage !== 0 && !p.action) { end = w.time.tick - start + 1; break }
      }
      rows.push({ name: wpn.name, damage, end, dps: damage / end })
      w.ai.despawn(e.id)
      w.off()
    }
    const by = (n: string) => rows.find((r) => r.name === n)!
    expect(by('调律剑').damage, '**调律剑的 L1 伤害 9**').toBe(9)
    expect(by('调律剑').end, '（整段 30 拍）').toBe(30)
    expect(by('强音大剑').damage, '**大剑的 L1 伤害 20**（帧表是 21 ⇒ 真链上还过了一层连段 ×0.95）').toBe(20)
    expect(by('引针枪').damage, '**枪的 L1 伤害 11**（帧表是 12 ⇒ 同上）').toBe(11)
    expect(by('无鸣').damage, '（无鸣 7）').toBe(7)
    expect(by('泛音弓').damage, '（弓 10）').toBe(10)
    expect(by('音叉杖').damage, '（杖 7）').toBe(7)
    // 近战四族：直剑／大剑／枪／无鸣 ⇒ 极差 ≤ 1.25×
    const melee = [by('调律剑'), by('强音大剑'), by('引针枪'), by('无鸣')].map((r) => r.dps)
    const spread = Math.max(...melee) / Math.min(...melee)
    expect(spread, '**近战四族在真链上的极差 1.12× ≤ 1.25×** ⇒ 红线守得住').toBeLessThanOrEqual(1.25)
    expect(spread, '（设计那一栏的锚点算出来是 1.167× ⇒ 真链上因为 ×0.95 更紧）').toBeLessThan(1.167)
  })
})
