import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
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
 * §13.0「听觉 Sound」的第四路（弹反冲击）与同节 Alertness 行的「被弹反/完美格挡目击者 +100
 * （瞬间报警）」。两条都写在设计表里，但在这次改动之前**一条都不成立**：金属相交只 emit 了
 * `audio.sfx`（那是给玩家耳朵的，世界听不见），而目击者什么也没得到。
 *
 * 夹具用调律剑（`noiseMul = 1`）不是随手选的：它是唯一让「弹反这一声」的读数**等于表值**的武器，
 * 于是断言测的是接线而不是换算系数。系数本身另有两条用例单独量。
 */

registerGameData()

type Noise = { id: string; loudness: number }

function makeWorld(weaponId = 'wp_tuning_sword') {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(weapon.movesetId))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const sounds: Noise[] = []
  const results: string[] = []
  const offs = [
    bus.on('sound.source', (e) => sounds.push({ id: e.id, loudness: e.loudness })),
    bus.on('combat.hit', (e) => { results.push(e.result) })
  ]

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(time.dt)
    }
  }

  const equip = (id: string): void => {
    const w = registry.get<WeaponData>(id)
    player.equip(w, registry.get<MovesetData>(w.movesetId))
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, equip, sounds, results, off }
}

/** 目击者必须是**又聋于这一击的响、又亮于这一击的影**的那只，否则分不清是哪条路径干的活：
 *  针喉 vision 30 / hearing 20，放在 25m ⇒ 声源到不了它，只有「看见」这条路能把 ALERTNESS 顶满。 */
const WITNESS = { id: 'en_skewer', dist: 25 }

/**
 * 逼出一记防御结果。`mode='parry'` 在前摇末段开弹反窗，`'block'` 在那一 tick 按住格挡。
 * 成功判据取 `combat.hit.result`（**不是**「听见了那一声」——那正是本文件要测的东西，
 * 拿它当判据会让断言变成自我循环）。返回结果落地的那一 tick；跑满上限仍没有 ⇒ -1。
 * `eye` 是可选的目击者：每 tick 钉住它的位置与朝向（这一条测的是感知，不是它怎么走神），
 * `alertness` 归零则是因为视觉每 tick +3.4 会一路磨上去，而我们要量的是「瞬间」那一下。
 */
function drive(
  w: ReturnType<typeof makeWorld>,
  attacker: Enemy,
  mode: 'parry' | 'block',
  eye?: { e: Enemy; face: 'toward' | 'away' }
): number {
  const want = mode === 'parry' ? 'parry' : 'perfectBlock'
  for (let t = 0; t < 900; t++) {
    const p = w.player.pos
    w.player.yaw = Math.atan2(attacker.pos.x - p.x, attacker.pos.z - p.z) // 面向攻击者，否则弹反判据不成立
    const atk = attacker.attack
    if (atk && atk.tick === atk.spec.frames.startup - 3) {
      if (mode === 'parry') w.player.parryTicksLeft = w.player.base.parry.activeTicks
      else w.frame.held.add('guard')
    }
    if (eye) {
      eye.e.pos.x = p.x
      eye.e.pos.z = p.z + WITNESS.dist
      eye.e.alertness = 0
      const s = eye.face === 'toward' ? 1 : -1
      eye.e.yaw = Math.atan2(s * (p.x - eye.e.pos.x), s * (p.z - eye.e.pos.z))
    }
    w.tick()
    if (w.results.includes(want)) return t
  }
  return -1
}

describe('§13.0 弹反冲击：金属相交第一次同时被世界听见、被同伴看见（KI-048）', () => {
  it('弹反发出一声 0.85（调律剑系数 1 ⇒ 读数就是 player.json 的表值）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'parry-noise')
    e.alertness = 100
    e.enter('chase')
    w.sounds.length = 0
    const t = drive(w, e, 'parry')
    expect(t, '900 tick 没等到弹反').toBeGreaterThanOrEqual(0)
    const mine = w.sounds.filter((s) => s.id === 'player')
    expect(mine.length, '一次弹反只该有一声').toBe(1)
    expect(mine[0].loudness, '响度 = parry.impactLoudness × 武器 1.0 × 词缀 1.0').toBeCloseTo(0.85, 5)
    w.off()
  })

  it('完美格挡那一声是闷的（0.5），而且惊不动幽灵八；弹反那一声能', () => {
    // 半拍鬼的门槛是 0.6 ⇒ 0.5 过不了、0.85 过：这一条同时是「响度标尺没接错」的反证
    const a = makeWorld()
    const ea = a.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'block-noise')
    ea.alertness = 100
    ea.enter('chase')
    const g1 = a.ai.spawn('en_phantome', { x: 8, y: 0, z: 0 }, 'block-ghost')
    g1.skipIntro()
    a.sounds.length = 0
    expect(drive(a, ea, 'block'), '900 tick 没等到完美格挡').toBeGreaterThanOrEqual(0)
    expect(a.sounds.filter((s) => s.id === 'player').map((s) => s.loudness), '格挡声 = guard.impactLoudness')
      .toEqual([0.5])
    expect(g1.revealTicks, '0.5 < fakeBeatLoudness 0.6 ⇒ 不该被拽出拍隙').toBe(0)
    a.off()

    const b = makeWorld()
    const eb = b.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'parry-ghost')
    eb.alertness = 100
    eb.enter('chase')
    const g2 = b.ai.spawn('en_phantome', { x: 8, y: 0, z: 0 }, 'parry-ghost2')
    g2.skipIntro()
    b.sounds.length = 0
    expect(drive(b, eb, 'parry'), '900 tick 没等到弹反').toBeGreaterThanOrEqual(0)
    expect(g2.revealTicks, '0.85 ≥ 0.6 ⇒ 这一嗓子是一个伪拍点').toBeGreaterThan(0)
    b.off()
  })

  it('听见之外的第二种告发：25m 外的目击者，一个 tick 从 0 到 100 并进 chase', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'witness')
    e.alertness = 100
    e.enter('chase')
    const eye = w.ai.spawn(WITNESS.id, { x: 0, y: 0, z: WITNESS.dist }, 'witness-eye')
    expect(WITNESS.dist, '夹具前提：这一声它听不见（> hearing.range），只有「看见」这条路能顶满')
      .toBeGreaterThan(eye.data.ai.hearing.range)
    w.sounds.length = 0
    expect(drive(w, e, 'parry', { e: eye, face: 'toward' }), '900 tick 没等到弹反').toBeGreaterThanOrEqual(0)
    expect(eye.alertness, '§13.0「目击者 +100（瞬间报警）」').toBe(100)
    expect(eye.state, '≥100 → Combat').toBe('chase')
    w.off()
  })

  it('负例：同样 25m，转过身去就什么也没看见 ⇒ 不报警', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'witness-blind')
    e.alertness = 100
    e.enter('chase')
    const eye = w.ai.spawn(WITNESS.id, { x: 0, y: 0, z: WITNESS.dist }, 'witness-back')
    w.sounds.length = 0
    expect(drive(w, e, 'parry', { e: eye, face: 'away' }), '900 tick 没等到弹反').toBeGreaterThanOrEqual(0)
    expect(eye.alertness, '判据是视觉锥，不是「事件发生了」').toBe(0)
    expect(eye.state).not.toBe('chase')
    w.off()
  })

  it('无眼的万籁不吃目击：vision.range=0 ⇒ sawImpact 对她什么都不做（她那条路是听觉）', () => {
    const w = makeWorld()
    const m = w.ai.spawn('en_myriad', { x: 0, y: 0, z: 12 }, 'myriad-eye')
    m.skipIntro()
    expect(m.data.ai.vision.range, '夹具前提：她是无眼').toBe(0)
    m.sawImpact({ x: 0, y: 0, z: 0 })
    expect(m.alertness, '视觉锥半径 0 ⇒ 目击判据不成立（她的 100 只能来自 huntsSound/hear）').toBe(0)
    expect(m.state).not.toBe('chase')
    w.off()
  })

  it('防御也吃武器噪音系数：强音大剑 ×1.5 ⇒ 1.275，换回引针枪 0.9 ⇒ 0.765', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'mul')
    e.alertness = 100
    e.enter('chase')
    w.equip('wp_fortissimo_greatsword')
    w.sounds.length = 0
    expect(drive(w, e, 'parry'), '900 tick 没等到弹反').toBeGreaterThanOrEqual(0)
    expect(w.sounds.filter((s) => s.id === 'player').map((s) => s.loudness))
      .toEqual([+(0.85 * 1.5).toFixed(4)])
    w.off()
  })
})
