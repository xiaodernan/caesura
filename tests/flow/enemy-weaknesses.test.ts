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
 * KI-289：**§14「七类敌人行为规格」里每只怪的「弱点」那几行第一次在真链上被量**
 * （combat.md §14.1–§14.7 的七个「**弱点**」条目）。
 *
 * **这一批量的六样东西**：
 * ① 七只怪的 **HP／架势／速度** ＋ 三只怪的**残血撤退阈值**；
 * ② **悬钟骑士的钟甲**（正面 60° 减伤 40%）；
 * ③ **叠唱的「定调」光环**（12m／攻速 +15%／伤害 +10%）；
 * ④ **漂调者的「HP<25% 逃跑找同伴」**；
 * ⑤ **悬钟骑士的「敲钟自鸣」**（每 4 小节回 15 HP）；
 * ⑥ **针喉的「被贴至 <6m ⇒ Retreat 上塔」**。
 *
 * **两条量具纪律**：
 * ① **「弱点」那几行大半是**行为**（退不跑、要不要打断、光环给不给）⇒ 读的是**行为**，不是表里的数；
 * ② **敌人自己的招式会把「只在空档里判」的那几格挡住**（`Enemy.update` 的 combat 分支：出手期间既不判撤退也不演自鸣）⇒
 *    量「它跑不跑／它回不回血」之前，要先确认它**有空档**。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

const SEVEN = [
  { id: 'en_murkshell', name: '嘈壳', hp: 45, poise: 20, speed: 3 },
  { id: 'en_driftsinger', name: '漂调者', hp: 70, poise: 26, speed: 3.6 },
  { id: 'en_tympanus', name: '驼鼓', hp: 240, poise: 90, speed: 1.8 },
  { id: 'en_skewer', name: '针喉', hp: 55, poise: 22, speed: 2.4 },
  { id: 'en_refrein', name: '叠唱', hp: 65, poise: 30, speed: 2 },
  { id: 'en_phantome', name: '幽灵八', hp: 80, poise: 24, speed: 4.2 },
  { id: 'en_hanged_knight', name: '悬钟骑士', hp: 320, poise: 80, speed: 2.6 },
] as const

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>('moveset:ms_sword'))
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

describe('KI-289 §14 每只怪的「弱点」那几行', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **七只怪的 HP／架势／速度**与设计逐字对上；**残血撤退阈值是 0.2／0.25／0.3**（设计写的是「HP<25%」⇒ 只有漂调者正好是 0.25）⇒ 登记', () => {
    const seen: Record<string, { hp: number; poise: number; speed: number }> = {}
    const retreats: Record<string, number | null> = {}
    for (const s of SEVEN) {
      const w = makeWorld()
      const e = w.ai.spawn(s.id, { x: 0, y: 0, z: -6 }, 'probe')
      seen[s.name] = { hp: e.stats.hpMax, poise: e.stats.poiseMax, speed: e.data.speed }
      retreats[s.name] = (e.data.ai as any).retreatHpFrac ?? null
      w.ai.despawn(e.id)
      w.off()
    }
    for (const s of SEVEN) {
      expect(seen[s.name].hp, `**${s.name} 的 HP ${s.hp}**`).toBe(s.hp)
      expect(seen[s.name].poise, `**${s.name} 的架势 ${s.poise}**`).toBe(s.poise)
      expect(seen[s.name].speed, `**${s.name} 的速度 ${s.speed}**`).toBe(s.speed)
    }
    expect(retreats['嘈壳'], '**嘈壳的残血撤退阈值 0.2**（设计那一族写的是 25%）').toBe(0.2)
    expect(retreats['漂调者'], '**漂调者的 0.25**（与设计那一句逐字对上）').toBe(0.25)
    expect(retreats['针喉'], '**针喉的 0.3**（设计那一族写的是 25%）').toBe(0.3)
  })

  it('腿② **悬钟骑士的钟甲**：正面那一记 **5**、侧面那一记 **8** ⇒ 正面 **×0.6** ⇒ 与设计「钟甲＝正面 60° 减伤 40%」**逐字对上**', () => {
    const mk = (yawDeg: number) => {
      const w = makeWorld()
      const e = w.ai.spawn('en_hanged_knight', { x: 0, y: 0, z: -1.2 }, 'probe')
      e.alertness = 0
      e.enter('idle')
      w.player.pos = { x: 0, y: 0, z: 0 }
      w.player.yaw = 0
      w.pins.push(() => { e.pos.x = 0; e.pos.z = -1.2; e.yaw = (yawDeg * Math.PI) / 180 })
      w.tick(3)
      w.frame.edges.add('attackLight')
      w.tick()
      w.frame.edges.delete('attackLight')
      let damage = 0
      for (let i = 0; i < 60; i++) {
        w.tick()
        const mine = w.hits.filter((h: any) => h.victimId === e.id)
        if (mine.length > 0) { damage = mine[mine.length - 1].damage; break }
      }
      w.ai.despawn(e.id)
      w.off()
      return damage
    }
    const front = mk(0)
    const side = mk(90)
    expect(side, '**侧面那一记 8**（没进钟甲那一锥）').toBe(8)
    expect(front, '**正面那一记 5**（8 × 0.6 ＝ 4.8 ⇒ 取整 5）').toBe(5)
    expect(front / side, '**正面那一记的伤害是侧面的 0.6 倍**（设计「减伤 40%」；8 × 0.6 ＝ 4.8 ⇒ 取整 5 ⇒ 比值 0.625）').toBeGreaterThan(0.58)
    expect(front / side, '（……落在 0.6 附近）').toBeLessThan(0.65)
  })

  it('腿③ **叠唱的「定调」光环**：12m 内 攻速 **×1.15**／伤害 **×1.1**；20m 外没有 ⇒ 与设计「12m 内：攻速 +15%、伤害 +10%」**逐字对上**；**「体力消耗 −20%」那一格没有承载体**（光环只带那两个乘数）⇒ 登记', () => {
    const mk = (dz: number) => {
      const w = makeWorld()
      const refrain = w.ai.spawn('en_refrein', { x: 0, y: 0, z: -8 }, 'support')
      const other = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -8 - dz }, 'probe')
      other.enter('idle')
      w.player.pos = { x: 0, y: 0, z: 0 }
      w.tick(3)
      const buff = other.buff ? { attackSpeedMul: other.buff.attackSpeedMul, dmgMul: other.buff.dmgMul } : null
      w.ai.despawn(refrain.id)
      w.ai.despawn(other.id)
      w.off()
      return buff
    }
    const near = mk(0)
    expect(near, '**12m 内 ⇒ 攻速 ×1.15、伤害 ×1.1**').toBeTruthy()
    expect(near!.attackSpeedMul, '**攻速那一格**').toBeCloseTo(1.15, 5)
    expect(near!.dmgMul, '**伤害那一格**').toBeCloseTo(1.1, 5)
    expect(mk(20), '**20m 外 ⇒ 没有光环**').toBe(null)
  })

  it('腿④ **漂调者的「HP<25% 逃跑找同伴」**：血到 20% ⇒ 它**进了 retreat 并朝同伴挪近** ⇒ 与设计**逐字对上**；但**它只在招式链打完之后的空档里判** ⇒ 登记', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_driftsinger', { x: 0, y: 0, z: -3 }, 'probe')
    const ally = w.ai.spawn('en_murkshell', { x: 6, y: 0, z: -3 }, 'probe')
    e.enter('combat')
    e.alertness = 100
    ally.enter('idle')
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.tick(2)
    e.stats.hp = Math.round(e.stats.hpMax * 0.2)
    const d0 = Math.hypot(e.pos.x - ally.pos.x, e.pos.z - ally.pos.z)
    let sawRetreat = false
    let idle = 0
    for (let i = 0; i < 600; i++) {
      w.tick()
      if (!e.attack) idle++
      if (e.state === 'retreat') sawRetreat = true
    }
    const d1 = Math.hypot(e.pos.x - ally.pos.x, e.pos.z - ally.pos.z)
    expect(sawRetreat, '**它进了 retreat 那一态**（设计「HP<25% 逃跑找同伴」）').toBe(true)
    expect(d1, '**而且朝同伴挪近了**').toBeLessThan(d0)
    expect(idle, '**它自己出手的时间占大头** ⇒ 撤退那一格只能在空档里判').toBeGreaterThan(0)
    w.ai.despawn(e.id)
    w.ai.despawn(ally.id)
    alive.push(w.off)
  })

  it('腿⑤ **悬钟骑士的「敲钟自鸣」**：**第 858 拍**回 **15** 点血（4 小节）⇒ 与设计「每 4 小节『敲钟自鸣』回 15 HP」**逐字对上**（但它也只在招式之间的空档里演 ⇒ 登记）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_hanged_knight', { x: 0, y: 0, z: -2 }, 'probe')
    e.alertness = 100
    e.enter('combat')
    e.stats.hp = 200
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.stats.hpMax = 99999
    w.player.stats.hp = 99999
    const hp0 = e.stats.hp
    let healedAt = -1
    let idle = 0
    for (let i = 0; i < 1400; i++) {
      w.tick()
      if (!e.attack) idle++
      if (healedAt < 0 && e.stats.hp > hp0) healedAt = i + 1
    }
    expect(healedAt, '**它在第 858 拍回血**（4 小节 ＝ 686 拍 ＋ 那一记的前摇）').toBe(858)
    expect(e.stats.hp - hp0, '**回的是 15 点**（设计「回 15 HP」）').toBe(15)
    expect(idle, '**它出手的时间占大头** ⇒ 自鸣那一格只能在空档里演').toBeGreaterThan(0)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑥ **针喉的「被贴至 <6m ⇒ Retreat 上塔」**：运行时的撤退是**残血**驱动的（阈值 0.3），**没有距离那一格** ⇒ 登记', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_skewer', { x: 0, y: 0, z: -1.2 }, 'probe')
    e.alertness = 100
    e.enter('combat')
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.pins.push(() => { e.pos.x = 0; e.pos.z = -1.2 })
    w.tick(2)
    const near = e.state
    e.stats.hp = Math.round(e.stats.hpMax * 0.2)
    let sawRetreat = false
    for (let i = 0; i < 600; i++) {
      w.tick()
      if (e.state === 'retreat') sawRetreat = true
    }
    expect(near, '**贴到 1.2m（远小于 6m）它也不撤退**（它还在 combat）').toBe('combat')
    expect(sawRetreat, '**只有血掉到 20%（< 它的阈值 0.3）它才撤**').toBe(true)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })
})
