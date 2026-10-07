import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController, clampAngleDiff } from '@/player/ThirdPersonController'
import type { Input } from '@/core/Input'

/**
 * 批24：player/ThirdPersonController.ts 死分支腿点亮（KI 死腿清扫）。
 * 纯玩家夹具（不摆 AISystem/CombatManager）：每条用例点名它负责的行号，
 * .scratch/check_b24.mjs 按行号逐一验亮（v8 分支 id 跨运行漂移，不按 tag 匹配）。
 * L595 || 1 为结构性恒死（旋转保范数），已同行尾标注。
 */

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>('ms_sword')
  const player = new PlayerController(playerBase, weapon, moveset)
  const sfx: Array<{ key: string; gain?: number }> = []
  const sounds: Array<{ id: string; loudness: number }> = []
  bus.on('audio.sfx', (p) => sfx.push(p as { key: string; gain?: number }))
  bus.on('sound.source', (p) => sounds.push(p as { id: string; loudness: number }))
  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      player.update(TICK_DT, time, input, time.tick, rhythm)
      time.tick++
      frame.edges.clear()
    }
  }
  return { time, rhythm, player, frame, tick, sfx, sounds }
}

describe('批24 ThirdPersonController 死腿（每条用例点名它负责的行）', () => {
  it('L112 chargeProgress：非蓄力读数恒 0', () => {
    const w = makeWorld()
    expect(w.player.chargeProgress, '没在蓄力：进度必须落 0').toBe(0)
  })

  it('L262 equip 同 id 早退：不换装不发 ui_select', () => {
    const w = makeWorld()
    const before = w.sfx.filter((s) => s.key === 'ui_select').length
    w.player.equip(registry.get<WeaponData>('wp_tuning_sword'), registry.get<MovesetData>('ms_sword'))
    expect(w.sfx.filter((s) => s.key === 'ui_select').length, '同 id 早退：不得播换装音').toBe(before)
  })

  it('L213/L307/L709/L711 兜底三连：武器缺 noiseMul、招式缺 sfx → ?? 1 与 swing_1 接住', () => {
    const w = makeWorld()
    const base = registry.get<WeaponData>('wp_tuning_sword')
    const ms = registry.get<MovesetData>('ms_sword')
    const fw = { ...base, id: 'wp_b24_quiet' } as unknown as Record<string, unknown>
    delete fw.noiseMul
    const l1 = { ...ms.actions.l1 } as Record<string, unknown>
    delete l1.sfx
    const fm = { ...ms, id: 'ms_b24', actions: { ...ms.actions, l1: l1 } } as unknown as MovesetData
    w.player.equip(fw as unknown as WeaponData, fm)
    expect(w.player.tryStartAction('l1', w.time.tick), '轻击出手失败：本用例前提失效').toBe(true)
    // L709：sfx 缺席 → 键兜底 swing_1；L711：noiseMul 缺席 → 声源响度按 1 乘
    expect(w.sfx.some((s) => s.key === 'swing_1'), 'L709 sfx 缺席：键必须兜底 swing_1').toBe(true)
    expect(w.sounds.some((s) => s.loudness === 0.3), 'L711 noiseMul 缺席：响度 = 3/10 × 1').toBe(true)
    // 推进到判定窗：L213 的 noiseMul ?? 1 由 activeHitbox 读取点亮
    let sawHitbox = false
    for (let i = 0; i < 30; i++) {
      w.tick()
      if (w.player.activeHitbox !== null) { sawHitbox = true; break }
    }
    expect(sawHitbox, '判定窗必须到达').toBe(true)
    expect(w.player.weaponImpactNoise(5), 'L307 noiseMul 缺席：刀兵相交噪音 = 5 × 1').toBe(5)
  })

  it('L391 举盾中弹反：开窗同时清掉盾条', () => {
    const w = makeWorld()
    w.frame.held.add('guard')
    w.tick()
    expect(w.player.guardTicks, '举盾一格：前提失效则本用例无意义').toBeGreaterThan(0)
    w.frame.edges.add('parry')
    w.tick()
    expect(w.player.parryTicksLeft, '弹反窗必须开着').toBeGreaterThan(0)
    expect(w.player.guardTicks, 'L391 盾中弹反：guardTicks 必须当场清零').toBe(0)
  })

  it('L422/L531 跳斩：空中轻击派生 jump 招，落地那格把招式帧抬到判定窗', () => {
    const w = makeWorld()
    w.frame.edges.add('jump')
    w.tick()
    expect(w.player.grounded, '起跳后必须离地：前提失效则本用例无意义').toBe(false)
    w.frame.edges.add('attackLight')
    w.tick()
    expect(w.player.action?.key, '空中轻击必须派生 jump 招').toBe('jump')
    for (let i = 0; i < 70 && !w.player.grounded; i++) w.tick()
    expect(w.player.grounded, '70 tick 内必须落地').toBe(true)
    expect(w.player.action?.key, '落地时跳斩还在收势（recovery 48 > 滞空）').toBe('jump')
    expect(w.player.action!.tick, 'L531 落地抬帧到判定窗起点').toBeGreaterThanOrEqual(15)
  })

  it('L423 冲刺刺击：sprint + 移动中轻击派生 run 招', () => {
    const w = makeWorld()
    w.frame.held.add('sprint')
    w.frame.move.y = 1
    w.frame.edges.add('attackLight')
    w.tick()
    expect(w.player.action?.key, '冲刺中轻击必须派生 run 招').toBe('run')
  })

  it('L480 常拍脚：学过 §7.3 后招式落地即挂常拍宽限', () => {
    const w = makeWorld()
    w.player.setBeatGrace(1.5)
    w.frame.edges.add('attackLight')
    w.tick()
    for (let i = 0; i < 60 && w.player.action !== null; i++) w.tick()
    expect(w.player.action, 'l1 必须收完：前提失效则本用例无意义').toBeNull()
    expect(w.player.beatGraceTicks, 'L480 落地起算：宽限必须挂上').toBeGreaterThan(0)
  })

  it('L502 举盾移速：同输入下盾行距离必须明显短于常行', () => {
    const w = makeWorld()
    w.frame.move.y = 1
    w.tick(30)
    const distFree = Math.abs(w.player.pos.z)
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.frame.held.add('guard')
    w.tick(30)
    const distGuard = Math.abs(w.player.pos.z)
    expect(distGuard, '举盾必须仍在移动').toBeGreaterThan(0)
    expect(distGuard, 'L502 盾行 0.35×：必须明显短于常行').toBeLessThan(distFree * 0.6)
  })

  it('L577 freezeAction 身份不符：别人的账不按到自己头上', () => {
    const w = makeWorld()
    w.frame.edges.add('attackLight')
    w.tick()
    expect(w.player.action, 'l1 必须在手：前提失效则本用例无意义').not.toBeNull()
    expect(w.player.freezeAction(50, {}), 'src 非这一招：必须吃 0').toBe(0)
  })

  it('L664 beginFeintPunish 0ms：骗罚时长不过尺子', () => {
    const w = makeWorld()
    w.frame.edges.add('dodge')
    w.tick()
    expect(w.player.roll, '翻滚必须在滚：前提失效则本用例无意义').not.toBeNull()
    expect(w.player.beginFeintPunish(0), 'ms=0 → ticks=0：不得记账').toBe(false)
  })

  it('L774 弹反窗内 takeDamage：上游已接管 → false 且不掉血', () => {
    const w = makeWorld()
    w.frame.edges.add('parry')
    w.tick()
    expect(w.player.parryTicksLeft, '弹反窗必须开着：前提失效则本用例无意义').toBeGreaterThan(0)
    const hp = w.player.stats.hp
    expect(w.player.takeDamage(9), '窗内受击归弹反通道：不得结账').toBe(false)
    expect(w.player.stats.hp).toBe(hp)
  })

  it('L842 fadeDamage 双臂：0 额与死体都不结账', () => {
    const w = makeWorld()
    const hp = w.player.stats.hp
    w.player.fadeDamage(0)
    expect(w.player.stats.hp, 'amount 0：不得掉血').toBe(hp)
    expect(w.player.takeDamage(99999), '一记致命：必须死').toBe(true)
    expect((w.player as unknown as { dead: boolean }).dead, '前提：玩家已死').toBe(true)
    w.player.fadeDamage(5)
    expect(w.player.stats.hp, '死体不重复结账').toBe(0)
  })

  it('L870 clampAngleDiff 负角回绕：-5 rad 必须绕回正域', () => {
    expect(clampAngleDiff(0, -5), 'd < -π 的回绕臂').toBeCloseTo(1.2832, 3)
  })
})
