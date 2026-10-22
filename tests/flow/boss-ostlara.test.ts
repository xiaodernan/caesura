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
 * KI-291：**§15.1「悬钟骑士·奥斯塔拉」那一族第一次在真链上被量**（combat.md §15.1）。
 *
 * **这一批量的四样东西**：
 * ① **三个阶段的触发线**（P1 钟壳 100-60%／P2 双剑 60-25%／P3 拔钟 <25%）；
 * ② **钟壳那一格**（全身免疫 90% ＝ 伤害 ×0.1 ＋ 架势免疫）；
 * ③ **转阶段那一声钟鸣**（全频低通 0.8s ＋ hitstop 250ms）；
 * ④ **她的私有拍**（3/4 拍 @108BPM 接管全场时钟）。
 *
 * **两条量具纪律**：
 * ① **壳期那一格要用同一记打两次**（壳期 vs 换阶之后）⇒ 伤害与架势各读一次，差值就是那一格；
 * ② **低通是**声音**那一层**（`audio.muffle` 事件）⇒ **不是**「闷音」那个状态（玩家的 `muteTicksLeft` 一个字节不动）——
 *    读错通道就会把「低通 0.8s」读成「闷音 4s」。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

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

describe('KI-291 §15.1 悬钟骑士·奥斯塔拉：阶段／钟壳／钟鸣／私有拍', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **三个阶段的触发线**：满血 ＝ **P1 钟壳**、血到 **59%** ＝ **P2 双剑**、血到 **24%** ＝ **P3 拔钟** ⇒ 与设计「100-60%／60-25%／<25%」**逐字对上**；她的 HP **420**／架势 **120**／速 **2.4** 也对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -2 }, 'boss')
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.tick(2)
    expect((e as any).bossPhase, '**满血 ⇒ P1（钟壳）**').toBe(0)
    expect((e as any).bossPhaseData?.id, '（那一阶的名字）').toBe('bellshell')
    e.stats.hp = Math.round(e.stats.hpMax * 0.59)
    w.tick(2)
    expect((e as any).bossPhase, '**血到 59% ⇒ P2（双剑）**').toBe(1)
    expect((e as any).bossPhaseData?.id, '（那一阶的名字）').toBe('twinfugue')
    e.stats.hp = Math.round(e.stats.hpMax * 0.24)
    w.tick(2)
    expect((e as any).bossPhase, '**血到 24% ⇒ P3（拔钟）**').toBe(2)
    expect((e as any).bossPhaseData?.id, '（那一阶的名字）').toBe('greatbell')
    expect(e.stats.hpMax, '**HP 420**').toBe(420)
    expect(e.stats.poiseMax, '**架势 120**').toBe(120)
    expect(e.data.speed, '**速 2.4**').toBe(2.4)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **钟壳那一格**：壳期那一记只吃 **1** 点（8 × 0.1）而且**架势一点不涨**；换阶之后那一记 **8**、架势 **+6** ⇒ 与设计「钟甲护体（全身免疫 90%，架势免疫）」**逐字对上**', () => {
    const mk = (hpFrac: number) => {
      const w = makeWorld()
      const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -1.2 }, 'boss')
      e.alertness = 0
      e.enter('idle')
      w.player.pos = { x: 0, y: 0, z: 0 }
      w.player.yaw = Math.PI
      w.pins.push(() => { e.pos.x = 0; e.pos.z = -1.2; if (e.state !== 'idle') e.enter('idle'); e.attack = null })
      w.tick(3)
      if (hpFrac < 1) e.stats.hp = Math.round(e.stats.hpMax * hpFrac)
      w.tick(2)
      const poiseBefore = e.stats.poiseAccum
      w.frame.edges.add('attackLight')
      w.tick()
      w.frame.edges.delete('attackLight')
      let damage = 0
      for (let i = 0; i < 60; i++) {
        w.tick()
        const mine = w.hits.filter((h: any) => h.victimId === e.id)
        if (mine.length > 0) { damage = mine[mine.length - 1].damage; break }
      }
      const r = { damage, poiseGain: e.stats.poiseAccum - poiseBefore }
      w.ai.despawn(e.id)
      w.off()
      return r
    }
    const shell = mk(1)
    expect(shell.damage, '**壳期那一记只吃 1 点**（8 × 0.1 ＝ 0.8 ⇒ 取整 1）').toBe(1)
    expect(shell.poiseGain, '**壳期架势一点不涨**（设计「架势免疫」）').toBe(0)
    const after = mk(0.5)
    expect(after.damage, '**换阶之后那一记 8 点**').toBe(8)
    expect(after.poiseGain, '**架势照涨（6 点）**').toBe(6)
  })

  it('腿③ **转阶段那一声钟鸣**：**全频低通开 48 拍（0.8s）** ⇒ 与设计「全频低通 0.8s ＋ hitstop 250ms」**逐字对上**；**它不是「闷音」那个状态**（玩家的 `muteTicksLeft` 一个字节没动）⇒ 登记', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -2 }, 'boss')
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.tick(2)
    let onAt = -1
    let offAt = -1
    const off = bus.on('audio.muffle', (p: any) => {
      if (p.on && onAt < 0) onAt = w.time.tick
      if (!p.on && onAt >= 0 && offAt < 0) offAt = w.time.tick
    })
    const muteBefore = w.player.stats.muteTicksLeft
    e.stats.hp = Math.round(e.stats.hpMax * 0.59)
    w.tick(3)
    for (let i = 0; i < 120 && offAt < 0; i++) w.tick()
    expect(onAt, '**换阶那一拍低通就开了**').toBeGreaterThan(0)
    expect(offAt - onAt, '**低通开了 48 拍（0.8s）**（设计「实机跳阶读回 48 tick ＝ 0.8s」）').toBe(48)
    expect(w.player.stats.muteTicksLeft, '**玩家的闷音那一格一个字节没动**（低通是声音那一层，不是状态）').toBe(muteBefore)
    off()
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ **她的私有拍**：**3/4 拍 108BPM** 接管全场时钟 ⇒ 与设计「私有拍速 3/4 拍 @108BPM」**逐字对上**', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -2 }, 'boss')
    e.enter('chase')
    e.alertness = 100
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.pins.push(() => { e.pos.x = 0; e.pos.z = -2 })
    w.tick(4)
    expect(w.rhythm.bpm, '**时钟被换成 108**').toBe(108)
    expect(w.rhythm.beatsPerBar, '**三拍一小节**').toBe(3)
    expect(w.rhythm.clockOwner, '**时钟的主人是她**').toBe('boss')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })
})
