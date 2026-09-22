import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'

/**
 * §15.2 P2「夺拍」+ §24「每 Boss 恰 2 或 3 阶段」。
 * 这一份测的是**关系**而不是数值：他把网格抢走之后，玩家的那套节奏工具（体力回复、闪避恢复、
 * 弹反）到底改挂到哪里去了，以及玩家能把网格抢回来的唯一时刻成不成立。
 */

registerGameData()


function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999

  const hits: Array<{ v: string; d: number }> = []
  const notes: string[] = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push({ v: p.victimId, d: p.damage })),
    bus.on('ui.notify', (p) => notes.push(p.text))
  ]
  function tick(n = 1, each?: () => void): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      each?.()
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  /** 把玩家摆到它的朝向上（弹反要判朝向，§5.3） */
  function face(e: Enemy, dist = 2.4): void {
    player.pos.x = e.pos.x + Math.sin(e.yaw) * dist
    player.pos.z = e.pos.z + Math.cos(e.yaw) * dist
    player.pos.y = e.pos.y
    player.yaw = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, face, hits, notes, off }
}
type W = ReturnType<typeof makeWorld>

function hersilP2(w: W, seed = 'steal'): Enemy {
  const e = w.ai.spawn('en_hersil', { x: 0, y: 152, z: -3 }, seed)
  w.player.pos.x = 0
  w.player.pos.y = 152
  w.player.pos.z = 0
  e.alertness = 100
  e.enter('combat')
  // 60% 血线：进 P2 并触发时钟重置（转阶段演出走 4-F 那条既有通道）
  e.stats.damage(Math.round(e.stats.hpMax * 0.5))
  w.tick(2)
  return e
}

describe('P2 上场：他把全局网格拿走了', () => {
  it('60% ⇒ 第二阶，stealBeat 生效，BPM 在他的手里游走（±10% 之内）', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    expect(e.bossPhase).toBe(1)
    expect(e.stealBeat?.bpmDrift).toBe(0.1)
    const drifts = new Set<number>()
    w.tick(900, () => drifts.add(Number(w.rhythm.drift.toFixed(4))))
    expect(w.rhythm.drift).not.toBe(0)
    expect(Math.abs(w.rhythm.drift)).toBeLessThanOrEqual(0.1)
    expect(drifts.size, '随机游走 ⇒ 不止一个值').toBeGreaterThan(3)
    w.off()
  })

  it('玩家体力改挂他的拍：窗外不回复，窗内才回复', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    w.tick(60)
    const p = w.player
    p.stats.stamina = 50
    p.exhausted = false
    let offWin = 0
    let onWin = 0
    let offGain = 0
    let onGain = 0
    let prev = p.stats.stamina
    w.tick(600, () => {
      const window = p.beatParasite?.windowTicks ?? 0
      const inWin = w.rhythm.ticksFromBeatPoint() <= window
      const gain = p.stats.stamina - prev
      prev = p.stats.stamina
      if (inWin) { onWin++; onGain += gain } else { offWin++; offGain += gain }
    })
    expect(onWin, '两种窗口都被采到').toBeGreaterThan(10)
    expect(offWin).toBeGreaterThan(10)
    expect(offGain, '他的拍点之外：一口气都不回').toBeLessThanOrEqual(0.01)
    expect(onGain, '他的拍点上才回气').toBeGreaterThan(1)
    expect(e.stealBeat?.staRegenMul, '回复还额外被打折（-25%）').toBe(0.75)
    w.off()
  })

  it('闪避恢复锁漂移：相邻两次翻滚的总长不再相同（±60ms 量级）', () => {
    const w = makeWorld()
    hersilP2(w)
    w.tick(120)
    const p = w.player
    const totals: number[] = []
    for (let i = 0; i < 6; i++) {
      p.stats.stamina = 100
      p.action = null
      p.roll = null
      w.frame.edges.add('dodge')
      w.tick(1)
      const rolling = (p as unknown as { roll: { total: number } | null }).roll
      if (rolling) totals.push(rolling.total)
      w.tick(40)
    }
    expect(totals.length, '翻滚真的做出来了').toBeGreaterThan(2)
    expect(new Set(totals).size, '恢复锁在漂 ⇒ 不是一串相同的数').toBeGreaterThan(1)
    const base = playerBase.roll.total
    for (const t of totals) {
      // §15.2 写的是 ±60ms，而 tick 是整数 ⇒ 表里取 4 tick = 66.7ms（0.4 tick 的差比再切一刀便宜）
      expect(Math.abs(t - base), `抖动量 ${t - base} tick`).toBeLessThanOrEqual(4)
      expect(Math.abs(t - base) * (1000 / TICK_HZ), '仍在 ±60ms 的量级上').toBeLessThanOrEqual(70)
    }
    w.off()
  })

  it('P2 的输出不可弹反 ⇒ 玩家只能躲、或者把拍抢回来', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    const spec = e.data.attacks.find((a) => a.id === 'noBeatLunge')!
    expect(spec.parryable, '表里就写着不可弹').toBe(false)
    e.attack = { spec, tick: spec.frames.startup - 1, hitDone: false, shots: 0, lungeApplied: 0 }
    w.face(e, 2.4)
    w.player.stats.hp = 3000
    w.player.parryTicksLeft = w.player.base.parry.activeTicks
    w.tick(2)
    expect(w.player.stats.hp, '弹反窗开着也弹不掉 ⇒ 真的掉血').toBeLessThan(3000)
    w.off()
  })

  it('无拍突进故意不落在网格上（教玩家改读身体 telegraph）', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    let grid = 0
    let hits = 0
    for (let i = 0; i < 2400 && hits < 3; i++) {
      const a = e.attack
      if (a && a.spec.onGrid === false && a.tick === a.spec.frames.activeStart) {
        hits++
        grid = Math.max(grid, w.rhythm.offsetFromBeatGrid(a.spec.beat))
      }
      w.tick(1)
    }
    expect(hits, '三段瞬移刺真的打出来了').toBeGreaterThanOrEqual(3)
    expect(grid, '命中帧落在拍与拍之间（>1 tick 才算真的不守拍）').toBeGreaterThan(1)
  })

  it('链式三段之间不抢别人的拍位插槽（onGrid:false 不参与仲裁）', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    const spec = e.data.attacks.find((a) => a.id === 'noBeatLunge')!
    e.attack = { spec, tick: spec.frames.activeStart, hitDone: true, shots: 0, lungeApplied: 0 }
    const order: string[] = []
    let prev: Enemy['attack'] = null
    w.tick(500, () => {
      const a = e.attack
      if (a && a !== prev) order.push(a.spec.id)
      prev = a
    })
    expect(order.slice(0, 3), '三段自己接得上').toEqual(['noBeatLunge', 'noBeatLunge2', 'noBeatLunge3'])
    w.off()
  })
})

describe('换气拍：唯一能把网格抢回来的 0.35s', () => {
  it('每 8 小节一次停气；窗口里按下弹反 ⇒ 夺拍（减益清零、过载 +2、中立网格 8s）', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    const s = e.stealBeat!
    let breathSeen = 0
    let reclaimed = false
    for (let i = 0; i < 3200 && !reclaimed; i++) {
      const a = e.attack
      if (a?.spec.reclaimWindow && a.tick < a.spec.frames.startup) {
        breathSeen++
        w.face(e, 2.4)
        w.frame.edges.add('parry')
      }
      w.tick(1)
      if (e.stealNeutralTicks > 0) reclaimed = true
    }
    expect(breathSeen, '8 小节一次：跑到这里应该已经等到一次换气').toBeGreaterThan(0)
    expect(reclaimed, '在停气窗里弹反 ⇒ 拍抢回来了').toBe(true)
    expect(w.rhythm.drift, '中立网格 ⇒ 不再游走').toBe(0)
    expect(w.player.stats.overdrive, '§15.2 的回报：过载 +2').toBeGreaterThanOrEqual(2)
    expect(w.player.beatParasite, '玩家身上的寄生减益清零').toBeNull()
    expect(w.player.dodgeJitterTicks).toBe(0)
    expect(e.attack, '他这口气被打断').toBeNull()
    expect(w.notes.some((t) => t.includes('夺回节拍'))).toBe(true)
    expect(e.stealNeutralTicks).toBeGreaterThanOrEqual(s.reclaim.neutralTicks - 4)
    w.off()
  })

  it('中立期内他不再夺拍；到期后重新拿走 ⇒ 不是一次性开关', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    e.stealNeutralTicks = 240
    w.tick(60)
    expect(w.rhythm.drift, '中立期网格归零').toBe(0)
    expect(w.player.beatParasite).toBeNull()
    w.tick(300)
    expect(e.stealNeutralTicks).toBe(0)
    expect(w.player.beatParasite, '到期之后夺拍重新生效').not.toBeNull()
    w.off()
  })

  it('窗口外按弹反不算夺拍（0.35s 的判据不能是「任何时候按 G」）', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    const p = w.player
    const before = p.stats.overdrive
    const other = e.data.attacks.find((a) => a.id === 'voiceChain')!
    expect(other.reclaimWindow, '这一招不是换气拍').toBeFalsy()
    w.face(e, 2.4)
    for (let i = 0; i < 120; i++) {
      // 把他钉在「非换气」的读条里：否则等着等着真的等到一次换气，测的就不是这条判据了
      e.attack = { spec: other, tick: 4, hitDone: false, shots: 0, lungeApplied: 0 }
      w.frame.edges.add('parry')
      w.tick(1)
    }
    expect(e.stealNeutralTicks, '他没停气 ⇒ 弹不到他手里的那口气').toBe(0)
    expect(p.stats.overdrive, '也不该白送过载').toBe(before)
    w.off()
  })

  it('转阶段 ⇒ 时钟重置：换气排程与中立余量都不跨阶段带过去', () => {
    const w = makeWorld()
    const e = hersilP2(w)
    e.stealNeutralTicks = 300
    w.tick(2)
    expect(e.stealNeutralTicks, '先确认它确实在生效').toBe(298)
    const spec = e.data.attacks.find((a) => a.id === 'tutti')!
    // 手动模拟回血到 60% 以上：阶段单调 ⇒ 不会回 P1，但跳阶那一瞬的重置必须发生
    e.stats.heal(Math.round(e.stats.hpMax * 0.2))
    e.bossPhase = 0
    e.attack = { spec, tick: spec.frames.startup - 1, hitDone: false, shots: 0, lungeApplied: 0 }
    w.tick(1)
    e.stats.damage(Math.round(e.stats.hpMax * 0.6))
    w.tick(2)
    expect(e.bossPhase, '血线再次低于 60% ⇒ 重新进 P2').toBe(1)
    w.off()
  })
})
