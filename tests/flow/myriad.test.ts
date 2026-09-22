import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'

/**
 * §15.3 隐藏 Boss 万籁 + §2.1「无耳深窖=无网格领域」。
 * 她的身份就是「不在拍上」：全作唯一的 onGrid:false 敌人 + 视觉=0 + 只靠 sound.source 定位。
 * 所以这份测试既测她，也测那张区域网格表（她住的深窖只有 60BPM 心跳）。
 */

registerGameData()

const HEARTBEAT = (60 / 60) * TICK_HZ // 深窖：60BPM ⇒ 一拍正好 60 tick

function makeWorld(bpm = 60, bars = 1) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(bpm, bars)
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

  const notes: string[] = []
  const offs = [bus.on('ui.notify', (p) => notes.push(p.text))]
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
  /** 玩家发声 = 走既有那条 sound.source 流（挥砍/翻滚/脚步本来就是它） */
  const noise = (pos: { x: number; y: number; z: number }, loudness = 0.3): void => {
    bus.emit('sound.source', { id: 'player', pos, loudness })
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, noise, notes, off }
}
type W = ReturnType<typeof makeWorld>

function myriad(w: W, x = 0, z = -14, seed = 'myriad'): Enemy {
  return w.ai.spawn('en_myriad', { x, y: -144, z }, seed)
}
const d = registry.get<EnemyData>('en_myriad')

describe('§2.1 区域网格表：深窖真的没有网格，只有 60BPM 心跳', () => {
  it('七个区域全部自己声明网格（没有一处把 84 写死在代码里）', () => {
    const table: Record<string, [number, number]> = {
      rg_resthold: [84, 4], rg_whisperwode: [84, 4], rg_drowned_choir: [96, 4],
      rg_brokenbar_camp: [84, 4], rg_fellcarillon: [92, 4], rg_earless_deeps: [60, 1],
      rg_unfinished_hall: [92, 4]
    }
    for (const r of regions) {
      expect(r.grid, `${r.id} 没声明网格`).toBeTruthy()
      expect([r.grid.bpm, r.grid.beatsPerBar], `${r.id} 与 combat.md §2.1 不符`).toEqual(table[r.id])
    }
    const deeps = regions.find((r) => r.id === 'rg_earless_deeps')!
    expect(deeps.grid.label, '无网格领域要在数据里说明白').toContain('60BPM')
  })

  it('区域基准之上才是 Boss 私有时钟；他下场后还的是**本区域**那一拍', () => {
    const w = makeWorld(60, 1)
    expect(w.rhythm.clockOwner).toBe('region')
    const o = w.ai.spawn('en_ostlara', { x: 0, y: -144, z: -6 }, 'o')
    o.alertness = 100
    o.enter('combat')
    w.tick(2)
    expect([w.rhythm.bpm, w.rhythm.beatsPerBar, w.rhythm.clockOwner]).toEqual([108, 3, 'boss'])
    w.ai.despawn(o.id)
    w.tick(2)
    expect([w.rhythm.bpm, w.rhythm.beatsPerBar, w.rhythm.clockOwner], '还的是深窖的 60/1，不是硬编码的 84/4')
      .toEqual([60, 1, 'region'])
    w.off()
  })
})

describe('§15.3 万籁：她不在任何拍上，只在你发出的声音里', () => {
  it('身份数据：视觉=0、只靠 40m 听觉、全招 onGrid:false 且不可弹反（零强制反应窗）', () => {
    expect(d.archetype).toBe('boss')
    expect(d.hp).toBe(380)
    expect(d.ai.vision.range, '视觉=0').toBe(0)
    expect(d.ai.vibration.range, '也感觉不到脚步震动').toBe(0)
    expect(d.ai.hearing.range, '听觉锥 40m').toBe(40)
    expect(d.ai.huntsSound, '声音狩猎写在表里').toBeTruthy()
    expect(d.ai.hearsHeartbeat, '听心跳写在表里').toBeTruthy()
    for (const a of d.attacks) {
      expect(a.onGrid, `${a.id} 不该守拍`).toBe(false)
      expect(a.parryable, `${a.id} 不给弹反窗`).toBe(false)
    }
    expect(d.attacks.find((a) => a.id === 'bite')?.frames.damage, '咬合 36 伤').toBe(36)
  })

  it('站着不动也不发出声音 ⇒ 她永远不醒（视觉与震动都是 0）', () => {
    const w = makeWorld()
    const e = myriad(w, 0, -5)
    w.tick(600)
    expect(e.alertness, '她没有被「看到」这条路').toBe(0)
    expect(e.state).not.toBe('combat')
    expect(w.player.stats.hp).toBe(9_999_999)
    w.off()
  })

  it('玩家一发声 ⇒ 她瞬移到那个点并咬一口（前摇 300ms 可读，不是贴脸必中）', () => {
    const w = makeWorld()
    const e = myriad(w, 0, -20)
    const spot = { x: 20, y: -144, z: 12 } // 在她 40m 听觉锥（=huntsSound.maxRange）之内
    w.tick(2)
    w.noise(spot, 0.3)
    w.tick(1)
    expect(Math.hypot(e.pos.x - spot.x, e.pos.z - spot.z), '她已经站在那个发声点上（允许当 tick 又走了一步）').toBeLessThanOrEqual(0.5)
    expect(e.attack?.spec.id, '落点即起手').toBe('bite')
    expect(e.attack!.tick, '前摇从 0 起算').toBeLessThanOrEqual(2)
    expect(w.notes.some((t) => t.includes('万籁听见了你'))).toBe(true)
    w.off()
  })

  it('瞬移有冷却：一串脚步不会让她连环跳', () => {
    const w = makeWorld()
    const e = myriad(w, 0, -20)
    const spots = [{ x: 18, y: -144, z: 0 }, { x: -18, y: -144, z: 0 }, { x: 0, y: -144, z: 20 }]
    for (let i = 0; i < 120; i++) {
      w.noise(spots[i % 3], 0.4) // 每 tick 一声，故意连环钓她
      w.tick(1)
    }
    const blinks = w.notes.filter((t) => t.includes('万籁听见了你')).length
    expect(blinks, '150 tick 冷却 ⇒ 120 tick 的噪声串只换来一次瞬移咬合').toBe(1)
    expect(['combat', 'chase']).toContain(e.state) // 咬完退回追击：她已经被惊动，不会再睡回去
    expect(d.ai.huntsSound!.cooldownTicks / TICK_HZ).toBe(2.5)
    w.off()
  })

  it('太轻的声音不算数（潜行武器与重击在表里被分开）', () => {
    const w = makeWorld()
    const e = myriad(w, 0, -20)
    const from = { x: 30, y: -144, z: 0 }
    w.noise(from, d.ai.huntsSound!.minLoudness - 0.01)
    w.tick(4)
    expect(e.attack, '低于阈值：没听见').toBeNull()
    expect(Math.hypot(e.pos.x - from.x, e.pos.z - from.z), '也没跳过去').toBeGreaterThan(20)
    w.off()
  })
})

describe('§15.3 万籁：不守拍的代价与好处', () => {
  it('她的命中帧落在拍与拍的缝里（深窖 60BPM：一拍 60 tick）', () => {
    const w = makeWorld()
    const e = myriad(w, 0, -5)
    w.tick(1)
    w.noise({ x: 0, y: -144, z: -3 }, 0.5)
    let offGrid = 0
    let strikes = 0
    w.tick(300, () => {
      const a = e.attack
      if (a && a.tick === a.spec.frames.activeStart) {
        strikes++
        offGrid = Math.max(offGrid, w.rhythm.offsetFromBeatGrid(a.spec.beat))
      }
    })
    expect(strikes, '她真的出手了').toBeGreaterThan(0)
    expect(offGrid, 'onGrid:false ⇒ 命中不落在任何拍点上').toBeGreaterThan(HEARTBEAT * 0.25)
    w.off()
  })

  it('不守拍 ≠ 抢别人的拍位：同场的 Boss 照样出得来', () => {
    const w = makeWorld()
    const e = myriad(w, 0, -4)
    w.noise({ x: 0, y: -144, z: -4 }, 0.6)
    const o = w.ai.spawn('en_ostlara', { x: 2, y: -144, z: -6 }, 'o')
    o.alertness = 100
    o.enter('combat')
    let herBite = false
    let hisCast = false
    w.tick(900, () => {
      if (e.attack?.spec.id === 'bite') herBite = true
      if (o.attack) hisCast = true
    })
    expect(herBite, '她咬了').toBe(true)
    expect(hisCast, '同场 Boss 的出手权没被她不守拍的瞬移挤掉（她不进插槽仲裁）').toBe(true)
    w.off()
  })

  it('听心跳：站住屏息几秒，她的警觉会回落；一跑就又锁定上来', () => {
    const w = makeWorld()
    const e = myriad(w, 0, -6)
    w.noise({ x: 0, y: -144, z: -6 }, 0.5)
    w.tick(2)
    expect(e.alertness).toBeGreaterThanOrEqual(100)
    w.tick(d.ai.hearsHeartbeat!.stillTicks + 300)
    const calm = e.alertness
    expect(calm, '静止 3s + 5s ⇒ 警觉确实掉了').toBeLessThan(100)
    w.tick(60, () => { w.frame.move.x = 1 })
    expect(e.alertness, '一跑就又锁定上来（屏息是缓释，不是隐身术）').toBeGreaterThan(calm)
    w.off()
  })
})
