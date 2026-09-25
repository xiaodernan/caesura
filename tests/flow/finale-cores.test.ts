import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem } from '@/world/Streaming'
import { PropSystem } from '@/world/Props'
import { bus } from '@/core/EventBus'

/**
 * KI-022②：恩希尔 Finale「场地出 3 个振源核（外露可处决件，每个 18% HP）」——§15.2 那一行
 * 在 KI-022① 之后剩下的最后一块。props 层（KI-023①）的第二位消费者。
 *
 * 裁决（§15.2 没写"碎了之后发生什么"）：**核就是她露在场地上的血条**——外露的器官没有甲，
 * 打在核上的每一分原始伤害**原样**变成对她的真伤（`world.propDamaged` → `EntityStats.damage`，
 * 与残响区同一入口：不吃防御阶梯、不触发受击反应——那是"器官上的血"不是"打在她身上的招"）；
 * 池子（18% × hpMax）打空 = 核碎。三颗核 ≡ 54% 的免甲输出窗口，Finale 的"DPS 竞速爽段"由此
 * 是机制而不是口号。`exposedWhen: { bossId, minPhase: 2 }` 让核在 Finale 之前**不存在**
 * （不参与命中、不渲染），而不是一直蹲在场上无敌。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(92, 4) // 未竟厅余拍
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const props = new PropSystem(regions, () => true)
  combat.props = props
  props.bossQuery = (dataId) => {
    const b = ai.enemies.find((e) => e.data.id === dataId && e.alive)
    return b ? { hpMax: b.stats.hpMax, phase: b.bossPhase, alive: true } : null
  }

  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }

  const prop = (id: string) => props.all.find((p) => p.id === id)!
  /** 站到核旁 1.2m，出一记轻击/重击并等完收势；返回起手式是否真的开始 */
  const swingAt = (id: string, heavy: boolean): boolean => {
    const core = prop(id)
    player.pos = { x: core.pos.x, y: core.pos.y, z: core.pos.z - 1.2 }
    player.floorY = core.pos.y // 传送必须连脚下层一起带（harness 没有 Surface 代算）
    player.yaw = Math.atan2(core.pos.x - player.pos.x, core.pos.z - player.pos.z)
    player.camYawRef = player.yaw + Math.PI
    player.stats.stamina = player.stats.staMax
    tick(2)
    if (heavy) {
      frame.held.add('attackHeavy')
      tick(1)
      frame.held.delete('attackHeavy')
      tick(1)
    } else {
      frame.edges.add('attackLight')
      tick(1)
    }
    const started = player.action !== null
    for (let t = 0; t < 70; t++) { player.stats.hp = player.stats.hpMax; player.stunTicks = 0; player.crumpleTicks = 0; tick() }
    return started
  }

  return { time, rhythm, player, ai, combat, streaming, props, tick, prop, swingAt }
}

describe('Finale 振源核（KI-022②：外露可处决件，每个 18% HP）', () => {
  it('Finale 之前核不存在：不参与命中、不进外露计数；她进 Finale（phase 2）的那一刻三颗全部外露', () => {
    const w = makeWorld()
    const her = w.ai.spawn('en_hersil', { x: 0, y: 152, z: -250 }, 'cores-a')
    her.skipIntro()
    w.tick(5)
    const core = w.prop('prop_core_west')
    expect(core.hpLeft, '池子懒物化：没挨过打之前没有绝对值（数据只写比例）').toBeUndefined()
    expect(w.props.hittable(core), 'P1/P2 的核不参与命中').toBe(false)
    expect(w.props.remainingByKind('resonance_core'), '没外露的核不存在').toBe(0)
    // 她进 Finale：血线打到 25% 以下（单调阶段机）
    her.stats.hp = her.stats.hpMax * 0.2
    w.tick(5)
    expect(her.bossPhase).toBe(2)
    expect(w.props.hittable(core), 'Finale 的核外露了').toBe(true)
    expect(w.props.remainingByKind('resonance_core')).toBe(3)
    // 池子仍是懒物化（外露本身不消耗任何东西）
    expect(core.hpLeft).toBeUndefined()
  })

  it('打在核上的每一分 = 她掉的每一滴血（真伤通道）：轻击也算数（外露器官无重量门槛）', () => {
    const w = makeWorld()
    const her = w.ai.spawn('en_hersil', { x: 0, y: 152, z: -250 }, 'cores-b')
    her.skipIntro()
    her.stats.hp = her.stats.hpMax * 0.2
    w.tick(5)
    const core = w.prop('prop_core_west')
    const hpBefore = her.stats.hp
    const l1Damage = registry.get<MovesetData>('moveset:ms_sword').actions.l1.damage
    // 轻击一记（底伤从帧表读：KI-039 重平衡后的 l1）
    const started = w.swingAt('prop_core_west', false)
    expect(started, '轻击要真的出手').toBe(true)
    expect(her.stats.hp, `她掉了恰好一记的原始伤害（${hpBefore} → ${her.stats.hp}）`).toBe(hpBefore - l1Damage)
    expect(core.hpLeft, '池子同步扣减').toBe(core.hpPool! - l1Damage)
    expect(core.hpPool, '池子 = round(0.18 × 620) = 112').toBe(112)
  })

  it('池子打空核碎：碎裂走真广播；三颗核 ≡ 54% 的免甲窗口（数值对账钉住）', () => {
    const w = makeWorld()
    const her = w.ai.spawn('en_hersil', { x: 0, y: 152, z: -250 }, 'cores-c')
    her.skipIntro()
    her.stats.hp = her.stats.hpMax * 0.2 // Finale（phase 2）核才外露
    w.tick(5)
    const hpBefore = her.stats.hp
    const damaged: Array<{ id: string; amount: number }> = []
    alive.push(bus.on('world.propDamaged', (p) => damaged.push({ id: p.id, amount: p.amount })))
    const core = w.prop('prop_core_west')
    // 用一次 9999 伤害的弹体通道打核？——不：核只吃玩家的出手。改成用 spikeEnemy 不行，
    // 用 hitProp 走 PropSystem 的正式入口（结算层就是这么调的）
    w.props.hitProp(core, { heavyFamily: true, rawDamage: 112 })
    w.tick(5)
    expect(core.hpLeft).toBe(0)
    expect(w.props.hittable(core), '碎核没有再被击中的资格').toBe(false)
    expect(damaged.filter((d) => d.id === 'prop_core_west').reduce((s, d) => s + d.amount, 0), '转移到她头上的账').toBe(112)
    expect(her.stats.hp, `她的血原样少了 112（${her.stats.hpMax} → ${her.stats.hp}）`).toBe(hpBefore - 112)
    // 三颗池子对账：3 × round(0.18 × 620) = 336 = 620 的 54%（允许整数取整 ±3）
    const total = ['prop_core_west', 'prop_core_east', 'prop_core_north']
      .reduce((s, id) => s + Math.round(w.ai.enemies[0].stats.hpMax * 0.18), 0)
    expect(total).toBe(336)
  })

  it('她死/不在场：核收回不存在（exposedWhen 的另一侧）', () => {
    const w = makeWorld()
    const her = w.ai.spawn('en_hersil', { x: 0, y: 152, z: -250 }, 'cores-d')
    her.skipIntro()
    her.stats.hp = her.stats.hpMax * 0.2
    w.tick(5)
    expect(w.props.hittable(w.prop('prop_core_east'))).toBe(true)
    // 她被打死（真通道：弹体）——核随之收回去
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: her.pos.x, y: her.pos.y + 1.1, z: her.pos.z }, dir: { x: 0, y: 0, z: 1 },
      speed: 2, range: 5, radius: 1, damage: 9999, poise: 0, hitStopMs: 0
    }, w.time.tick)
    for (let t = 0; t < 12 && her.alive; t++) w.tick()
    expect(her.alive).toBe(false)
    w.tick(3)
    expect(w.props.hittable(w.prop('prop_core_east')), 'Finale 结束，核不再是实体').toBe(false)
  })
})
