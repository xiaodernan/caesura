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
 * KI-024 结案：万籁的场地阶段（§16「阶段必有场地变化而非纯数值」× §15.3 的单阶冲突）。
 *
 * 裁决 = 为她补一条**真的** P2，而不是给 §16 写隐藏 Boss 例外：P2「聋乱期」的入口是
 * **场地事件**（三根音刺碎尽 ⇒ 她的巢穴不再汇聚噪音），不是血线——`belowHpFrac` 刻意不写。
 * 阶段换的是她的**感知模型**：听觉整条关掉（phases[].deaf），改读地面震动
 * （`vibrationRange: 10`，移动才算数——站定的屏息窗口在 P2 依旧成立）。
 * §16 那句话的"场地变化"就是音刺本身：机器可验（PropSystem 的 remainingByKind），
 * 不是一句文案。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const props = new PropSystem(regions, () => true)
  ai.noiseSink = (src) => props.sinkNoise(src)
  ai.props = props
  combat.props = props

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
  /** 在某根刺旁把它凿碎（真重击通道；万籁不在场 ⇒ 没人抢预算） */
  const breakSpine = (id: string): void => {
    const spine = prop(id)
    player.pos = { x: spine.pos.x, y: spine.pos.y, z: spine.pos.z - 1.2 }
    tick(2)
    for (let i = 0; i < 4; i++) {
      player.yaw = Math.atan2(spine.pos.x - player.pos.x, spine.pos.z - player.pos.z)
      player.camYawRef = player.yaw + Math.PI
      player.stats.stamina = player.stats.staMax
      frame.held.add('attackHeavy')
      tick(1)
      frame.held.delete('attackHeavy')
      tick(1)
      for (let t = 0; t < 70; t++) { player.stats.hp = player.stats.hpMax; player.stunTicks = 0; player.crumpleTicks = 0; tick() }
    }
  }
  const phaseEvents: Array<{ id: string; phase: number; phases: number }> = []
  alive.push(bus.on('boss.phase', (e) => phaseEvents.push({ id: e.id, phase: e.phase, phases: e.phases })))

  return { time, rhythm, player, ai, combat, streaming, props, tick, prop, breakSpine, phaseEvents, frame }
}

type World = ReturnType<typeof makeWorld>

/** 玩家处于「移动」读数（playerIsMoving 的判据：体力未满 + 落地 + 有朝向 + 不在招式里） */
function setMoving(w: World): void {
  w.player.stats.stamina = w.player.stats.staMax - 1
  w.player.grounded = true
  w.player.camYawRef = 0
  w.player.action = null
}
/** 玩家处于「静止」读数（体力回满 ⇒ 心跳回落的那些判据成立） */
function setStill(w: World): void {
  w.player.stats.stamina = w.player.stats.staMax
  w.player.action = null
}

describe('万籁的场地阶段（KI-024：音刺碎尽 ⇒ 聋乱期）', () => {
  it('音刺在场：她停在 P1，听觉健全；碎一根不够（还剩两根）', () => {
    const w = makeWorld()
    const her = w.ai.spawn('en_myriad', { x: -250, y: -144, z: 250 }, 'phase-a')
    w.tick(10)
    expect(her.bossPhase, '音刺都在，她没有理由换阶').toBe(0)
    expect(her.deaf, 'P1 她听得见').toBe(false)

    w.breakSpine('prop_spine_mine')
    w.tick(10)
    expect(w.props.remainingByKind('soundspine')).toBe(2)
    expect(her.bossPhase, '还剩两根刺，聋乱期不开').toBe(0)
  })

  it('三根碎尽 ⇒ P2 聋乱期：跳阶有演出事件、deaf 常驻（不是 6s 窗）', () => {
    const w = makeWorld()
    const her = w.ai.spawn('en_myriad', { x: -250, y: -144, z: 250 }, 'phase-b')
    w.tick(5)
    w.breakSpine('prop_spine_mine')
    w.tick(5)
    w.breakSpine('prop_spine_gallery')
    w.tick(5)
    expect(her.bossPhase, '还剩巢穴那根，她还在 P1').toBe(0)
    w.breakSpine('prop_spine_lair')
    w.tick(5)
    expect(her.bossPhase, '碎尽 ⇒ 聋乱期').toBe(1)
    expect(w.phaseEvents.some((e) => e.id === her.id && e.phase === 2 && e.phases === 2), '跳阶走的是同一套 boss.phase 演出事件').toBe(true)
    expect(her.deaf, '阶段聋立即生效').toBe(true)
    // 临时窗与阶段聋是两格账：把 6s 窗自然耗尽之后，聋仍在——那半句才是「常驻」的证据
    w.tick(400)
    expect(her.deafTicks, '碎刺的临时窗已经走完').toBe(0)
    expect(her.deaf, '但阶段聋还在：P2 的聋不靠临时窗').toBe(true)

    // P2 的聋是常驻的：玩家在 20m 外响亮出手，她不得瞬移到发声点
    // （瞬移 = 位移一整个 20m；聋乱里她只可能自己溜达，量到的是几米级的步行）
    const at = { ...her.pos }
    w.player.pos = { x: at.x, y: at.y, z: at.z - 20 }
    w.player.yaw = 0; w.player.camYawRef = Math.PI
    w.frame.edges.add('attackLight')
    w.tick(70)
    const drift = Math.hypot(her.pos.x - at.x, her.pos.z - at.z)
    const toPlayer = Math.hypot(her.pos.x - w.player.pos.x, her.pos.z - w.player.pos.z)
    expect(drift, `聋乱期她没有瞬移（位移 ${drift.toFixed(2)}m = 步行量级）`).toBeLessThan(3)
    expect(toPlayer, `她也没有出现在玩家身边（${toPlayer.toFixed(2)}m）`).toBeGreaterThan(15)
  })

  it('P2 改读地面：半径内移动积累警觉，站定依旧安全（屏息窗口没有消失）', () => {
    const w = makeWorld()
    const her = w.ai.spawn('en_myriad', { x: -250, y: -144, z: 250 }, 'phase-c')
    w.tick(5)
    for (const id of ['prop_spine_mine', 'prop_spine_gallery', 'prop_spine_lair']) { w.breakSpine(id); w.tick(5) }
    expect(her.bossPhase).toBe(1)

    // 半径内（8m < vibrationRange 10）、移动读数 ⇒ sense() 每 6 tick +40
    w.player.pos = { x: her.pos.x, y: her.pos.y, z: her.pos.z - 8 }
    her.alertness = 0
    for (let i = 0; i < 13; i++) { setMoving(w); w.tick() } // 两轮 sense（每 6 拍一轮）；逐 tick 按住移动读数（体力会回满）
    expect(her.alertness, '她感觉到地面的脚步（P1 时这一路判据恒假：vibration.range=0）').toBeGreaterThan(0)

    // 站定 ⇒ 不积累（体力回满 = playerIsMoving 为假），已有的警觉按听心跳的规则回落
    her.alertness = 40
    setStill(w)
    const before = her.alertness
    w.tick(200)
    expect(her.alertness, '站定不给她任何新读数，警觉只会回落').toBeLessThanOrEqual(before)
  })

  it('阶段是单调的：进过聋乱期就不会因为任何原因退回 P1', () => {
    const w = makeWorld()
    const her = w.ai.spawn('en_myriad', { x: -250, y: -144, z: 250 }, 'phase-d')
    w.tick(5)
    for (const id of ['prop_spine_mine', 'prop_spine_gallery', 'prop_spine_lair']) { w.breakSpine(id); w.tick(5) }
    expect(her.bossPhase).toBe(1)
    // 玩家血线打到 P2 门槛以下（她没有血线门槛，但 syncBoss 的循环不该把她往回推）
    her.stats.hp = her.stats.hpMax * 0.1
    w.tick(20)
    expect(her.bossPhase, '血线循环对场地阶段没有回退权').toBe(1)
  })
})


