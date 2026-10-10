import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import type { Enemy } from '@/ai/Enemy'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { StreamingSystem } from '@/world/Streaming'
import { RpgRuntime } from '@/rpg/Runtime'
import { registry } from '@/core/Registry'
import { bus } from '@/core/EventBus'

/**
 * 断弦线步 1《巡逻线尽头》的机制判据（narrative §2.4 / KI-043）：
 * 「玩家以纯闪避不反击走完一遍完整巡逻周期」。
 *
 * 在这一批之前，`flag.haltrune_patrol_seen` 是对话选项自己写的——点两下「（跟着他们，
 * 走完一整圈）」就算走完，巡逻与出手全都是文案。本文件钉的是判据搬进机制后的整条链，
 * 全部从生产入口进：
 *  · 一圈 = 巡逻敌人在 patrol 态里真的把路径点走回第一格（`Enemy.onPatrolLoop`）；
 *  · 出手 = `tryStartAction` 成功那一拍发的 `input.action`（闪避不发它——「不动手」的判据
 *    要放得过翻滚，否则设计的字面承诺就是假的）；
 *  · 在跟 = 绕回那一拍玩家在队伍近旁（半径是敌人自己的 `ai.vision.range` 表值）；
 *  · 裁决 = `AISystem` 构造时装配的 `PatrolWatch`，成立那一拍走 `world.flag` 广播立旗
 *    （旗标的唯一写路径），旗再由任务步 1 的 `advanceOn` 收进《点名册》。
 * 跟队夹具把兵的警觉锁在 0：玩法本身就要求"别惊动他们"，惊动之后的分支归 AI 侧测试管。
 */

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const streaming = new StreamingSystem(regions)
  const rpg = new RpgRuntime('origin_tuner', 'patrol-watch')
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  player.pos = { x: 0, y: 0, z: 0 } // 站在军阵的巡逻圈心里跟着走
  player.grounded = true
  player.floorY = 0
  const ai = new AISystem()
  const patrollers: Enemy[] = []
  const frame = { move: { x: 0, y: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.grounded = true
      player.floorY = 0
      player.update(TICK_DT, time, input, time.tick, rhythm)
      for (const e of patrollers) e.alertness = 0
      ai.update(TICK_DT, time.tick, player, rhythm)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }

  /** 一具绕 1m 小圈巡逻的军阵兵：出生在圈外 1m，一圈 = 4 边 = 200 tick（每边 1m / 1.2m·s⁻¹） */
  function spawnPatroller(id = 'en_murkshell'): Enemy {
    const e = ai.spawn(id, { x: 2, y: 0, z: 0 }, 'patrol-watch')
    e.patrolPoints = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 0, z: 0 }
    ]
    e.enter('patrol')
    patrollers.push(e)
    return e
  }

  return { time, rhythm, streaming, player, ai, input, frame, tick, spawnPatroller }
}

describe('断弦线步 1：跟队走完一圈且没出手，旗由机制立', () => {
  it('跟队走完一整圈（真巡逻绕回）、期间没出手 ⇒ 旗立；之后不再重复', () => {
    const w = makeWorld()
    const spy = { n: 0 }
    const off = bus.on('world.flag', (f) => { if (f.key === 'flag.haltrune_patrol_seen' && f.value) spy.n++ })
    w.spawnPatroller()
    w.tick(210) // 一圈 200 tick —— 完整绕回一次
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen'), '绕回第一格、人在队旁、全程未出手 ⇒ 成立').toBe(true)
    w.tick(200)
    expect(spy.n, '成立是一次性事件：第二圈绕回不再发旗').toBe(1)
    off()
  })

  it('圈内出过一次手 ⇒ 这一圈作废；下一圈干净才立（出手弄脏的是"这一轮"，不是资格）', () => {
    const w = makeWorld()
    w.spawnPatroller()
    w.tick(60) // 第一圈走到一半
    expect(w.player.tryStartAction('l1', w.time.tick), '出手要真的发生（精力/状态都合法）').toBe(true)
    w.tick(400) // 第一圈绕回（作废）之后，第二圈也干净地绕回
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen'), '第一圈不算，第二圈没出手 ⇒ 成立').toBe(true)
  })

  it('出手之后不再跟队 ⇒ 旗不立（"没死人"不等于"走完了一圈"）', () => {
    const w = makeWorld()
    w.spawnPatroller()
    w.tick(20)
    w.player.tryStartAction('l1', w.time.tick)
    w.player.pos = { x: 0, y: 0, z: 999 } // 打完就走，人不在队伍旁
    w.tick(600)
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen'), '军阵还在走，但没有人在跟着走 ⇒ 不立').toBe(false)
  })

  it('跟到一半提前离场 ⇒ 绕回时人不在队伍旁 ⇒ 不立', () => {
    const w = makeWorld()
    w.spawnPatroller()
    w.tick(100) // 首段走完、圈走到 1/3 —— 第一次绕回（150t）还没到
    w.player.pos = { x: 40, y: 0, z: 40 } // 提前离开
    w.tick(300)
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen')).toBe(false)
  })

  it('不是军阵的巡逻（ranged 等）绕回多少圈都不算——判据认队伍，不认"任何绕圈的东西"', () => {
    const w = makeWorld()
    w.spawnPatroller('en_driftsinger')
    w.tick(300)
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen')).toBe(false)
  })

  it('`input.action` 只在真出手那一拍发：翻滚不发（「纯闪避」的字面承诺靠它成立）', () => {
    const w = makeWorld()
    const spy = { n: 0 }
    const off = bus.on('input.action', () => { spy.n++ })
    w.frame.edges.add('dodge')
    w.tick(6) // 真输入路径的 dodge 分支完整走一遍
    expect(spy.n, '翻滚不是出手').toBe(0)
    w.tick(60) // 等翻滚收招（roll 还在时 tryStartAction 会被拒——那是另一条门的事）
    expect(w.player.tryStartAction('l1', w.time.tick)).toBe(true)
    expect(spy.n, '出手那一拍恰好一条').toBe(1)
    off()
  })
})
