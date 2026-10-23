import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
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
 * §4.5 杖「蓄力 共振弹」的残响柱（combat.md §4.5 蓄力行：「命中后残响柱停留 0.8s，
 * 区域内敌人减速 -15%」）：命中那一拍在落点立一根柱（`ProjectileSpec.pillar:
 * {radius:3, ticks:48, slowMul:0.85}`——半径 3m 是裁决，鸣和弦环外沿同口径）；
 * CombatManager 每 tick 维持（到期摘除、覆盖取最深写 `Enemy.slowMul`）；敌人移速的
 * 八个消费点统一走 `spd(factor) = 表值×档位×slowMul`。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuningfork_staff')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  player.pos = { x: 0, y: 0, z: 0 }
  player.grounded = true
  player.floorY = 0
  player.camYawRef = 0
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.grounded = true
      player.floorY = 0
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  const cleanup = (): void => { for (const e of [...ai.enemies]) ai.despawn(e.id) }
  alive.push(cleanup)
  const dummy = (dist: number, id = 'pill'): Enemy => {
    const e = ai.spawn('en_murkshell', { x: 0, y: 0, z: dist }, id)
    e.alertness = 0
    e.stunTicks = 99999
    return e
  }
  return { time, rhythm, player, ai, combat, input, frame, tick, dummy, cleanup }
}

describe('残响柱：命中落柱、区域减速、到期归位', () => {
  it('表形状：共振弹的弹体写 pillar {radius:3, ticks:48, slowMul:0.85}', () => {
    registerGameData()
    const ms = registry.get<MovesetData>('moveset:ms_staff')
    const acts = ms.actions as unknown as Record<string, { projectile?: { pillar?: { radius: number; ticks: number; slowMul: number } } }>
    expect(acts.charged.projectile?.pillar, '0.8s=48tick、-15%=0.85、半径 3m（鸣和弦同口径）').toEqual({ radius: 3, ticks: 48, slowMul: 0.85 })
  })

  it('真命中落柱：弹体打到人那一拍，命中点 3m 内的敌人 slowMul=0.85，圈外仍是 1', () => {
    const w = makeWorld()
    const inside = w.dummy(2) // 命中点（≈2m 处）圈内
    const outside = w.dummy(10, 'far') // 圈外
    expect(w.player.tryStartAction('charged', w.time.tick)).toBe(true)
    // 弹体 24m/s，命中 inside 需要几拍；等到 slowMul 被写下
    let landed = false
    for (let t = 0; t < 60 && !landed; t++) {
      w.tick(1)
      landed = inside.slowMul < 1
    }
    expect(landed, '共振弹真命中（reason=hit）⇒ 柱已落地').toBe(true)
    expect(inside.slowMul, '圈内敌人减速 15%').toBeCloseTo(0.85, 5)
    expect(outside.slowMul, '圈外敌人不受影响').toBe(1)
    w.cleanup()
  })

  it('空放不落柱（ground/wall 不是命中）：柱只认打到人那一拍', () => {
    const w = makeWorld()
    w.player.tryStartAction('charged', w.time.tick)
    for (let t = 0; t < 140; t++) w.tick(1) // 弹体飞完 27.5m 落地（没人可打）
    const anySlowed = w.ai.enemies.some((e) => e.slowMul < 1)
    expect(anySlowed, '空放的共鸣没有落点语义——没人被减速').toBe(false)
    w.cleanup()
  })

  it('停留 0.8s 后归位：柱到期那一拍 slowMul 回 1', () => {
    const w = makeWorld()
    const inside = w.dummy(2)
    w.player.tryStartAction('charged', w.time.tick)
    let landedAt = -1
    for (let t = 0; t < 60 && landedAt < 0; t++) {
      w.tick(1)
      if (inside.slowMul < 1) landedAt = w.time.tick
    }
    expect(landedAt).toBeGreaterThan(0)
    w.tick(48) // 0.8s = 48 tick
    expect(inside.slowMul, '柱停留 0.8s 后消失，减速归位').toBe(1)
    w.cleanup()
  })

  it('减速真的慢下来：聋巡逻者的行程 ≈ 平时的 85%（柱覆盖它、弹打的是旁边的祭品）', () => {
    const w = makeWorld()
    // 聋巡逻者：听觉短路 ⇒ 战斗声不惊动它，巡逻不断（行程读数不掺追击/出招）
    const walker = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1 }, 'walk')
    walker.applyDeaf(999999)
    // 巡逻点钉在祭品旁 1m 的小环上——默认三点环（±3m）会让它游走出柱圈（3m 半径盖不全环）
    walker.patrolPoints = [
      { x: 0, y: 0, z: -2.2 },
      { x: 0.5, y: 0, z: -3.2 },
      { x: -0.5, y: 0, z: -3.2 }
    ]
    walker.enter('patrol')
    // 玩家远处（>15m 听界），祭品贴着巡逻路径（弹打祭品 ⇒ 柱覆盖巡逻者）
    w.player.pos = { x: 0, y: 0, z: -16 }
    w.player.yaw = 0
    w.dummy(-3.2, 'bait') // 弹打祭品（它挨打挨晕），柱覆盖巡逻者——行程读数不掺命中
    // 基线：20 tick 巡逻行程
    const pathLen = (n: number): number => {
      let last = { x: walker.pos.x, z: walker.pos.z }
      let d = 0
      for (let i = 0; i < n; i++) { w.tick(1); d += Math.hypot(walker.pos.x - last.x, walker.pos.z - last.z); last = { x: walker.pos.x, z: walker.pos.z } }
      return d
    }
    const base = pathLen(60) // 整数个环周期：三点小环的转弯 tick 被平均掉
    expect(base, '巡逻在走（基线非零）').toBeGreaterThan(0.1)
    // 垫刀落柱
    expect(w.player.tryStartAction('charged', w.time.tick)).toBe(true)
    let slowed = false
    for (let t = 0; t < 80 && !slowed; t++) { w.tick(1); slowed = walker.slowMul < 1 }
    expect(slowed, '柱覆盖巡逻者（它没被打）').toBe(true)
    const slowedLen = pathLen(60)
    // 巡逻路径是三点小环，两段行程同构；85% 减速 ±20% 容差
    expect(slowedLen / base, `减速段行程 ≈ 基线 × 0.85（实测 ${slowedLen.toFixed(2)}/${base.toFixed(2)}）`).toBeGreaterThan(0.85 * 0.8)
    // 上界必须压在全速（1.0）之下——否则摘掉 slowMul 的刀咬不住（±20% 太宽，第一版就漏了）
    expect(slowedLen / base).toBeLessThan(0.93)
    w.cleanup()
  })
})
