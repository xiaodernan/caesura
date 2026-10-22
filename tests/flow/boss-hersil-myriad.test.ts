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
 * KI-293：**§15.2「无拍长·恩希尔·万籁」与 §15.3「隐藏 Boss：万籁」那一族第一次在真链上被量**。
 *
 * **这一批量的七条腿**：
 * ① **恩希尔的三个阶段**（P1 曲目学习 100-60%／P2 夺拍 60-25%／P3 Finale <25% ⇒ 触发线两面夹逼）；
 * ② **恩希尔的「夺拍」三件减益**（体力回复 ×0.75、闪避冷却漂移 ±60ms、全局 BPM 漂移 ±10%）；
 * ③ **入场演出的拍长换算**（奥斯塔拉 3 拍 @3/4 108 ＝ 99 拍；恩希尔 3 拍 @4/4 92 ＝ 116 拍）；
 * ④ **万籁的感知模型**（视觉 0／震感 0／听觉 40m ⇒ 站在 3m 外她也「看不见」）；
 * ⑤ **万籁的声音狩猎**（一声够响 ⇒ 瞬移到发声点并起手 bite 36 伤；够不着 ⇒ 无反应）；
 * ⑥ **万籁的「听心跳」**（玩家静止 180 拍 ⇒ 警觉值开始降，每秒 −40）；
 * ⑦ **恩希尔的「换气拍」与「夺回节拍」**（每 8 小节一次 0.35s 停气；弹反 ⇒ 中立网格 8s ＋ 减益清零 ＋ 过载 +2 ＋ 命中停顿 180ms）。
 *
 * **四条量具纪律**：
 * ① **阶段触发线要两面夹逼**（只钉「刚好在线下」那一格 ⇒ 阈值往任何一边挪都读不出来）；
 * ② **要在 combat／chase 态量 Boss**（`CombatManager.stealBeat` 只认这两个态）；
 * ③ **怪要钉住位置**（Boss 会朝玩家走 ⇒ 不钉就量不到「她还在原地」这一格）；
 * ④ **读行为，不读数据表**（读表只能证明「表上写着那个数」；读行为才证明「运行时真是那个数」）。
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
  const off = bus.on('combat.hit', () => {})
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
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, off, pins }
}

describe('KI-293 §15.2「无拍长·恩希尔·万籁」与 §15.3「隐藏 Boss：万籁」那一族', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **恩希尔的三个阶段**：**P1 曲目学习 100-60%**（4/4 @92BPM）、**P2 夺拍 60-25%**（Steal-the-Beat）、**P3 Finale <25%**（120BPM，startupMul 0.8）⇒ 与设计逐字对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_hersil', { x: 0, y: 0, z: -3 }, 'boss')
    e.enter('chase')
    e.alertness = 100
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.pins.push(() => { e.pos.x = 0; e.pos.z = -3 })
    w.tick(4)
    expect((e as any).bossPhase, '满血 ⇒ P1（registr 曲目学习）').toBe(0)
    expect((e as any).bossPhaseData?.id).toBe('registr')
    expect(w.rhythm.bpm).toBe(92)
    expect(w.rhythm.beatsPerBar).toBe(4)
    expect(e.stats.hpMax, '**HP 620**').toBe(620)
    expect(e.stats.poiseMax, '**架势 160**').toBe(160)
    expect(e.data.speed, '**速 2.2**').toBe(2.2)

    // **触发线要两面夹逼**：只在「刚好在线下」读一次 ⇒ 阈值往任何一边挪动都读不出来。
    // 这里在上侧（0.8 的下方／0.6 的上方）也钉一次 ⇒ 阈值被推前或推后都红。
    e.stats.hp = Math.round(e.stats.hpMax * 0.79)
    w.tick(4)
    expect((e as any).bossPhase, '血到 79%（0.6 的上方）⇒ 仍是 P1').toBe(0)
    expect((e as any).bossPhaseData?.id).toBe('registr')

    e.stats.hp = Math.round(e.stats.hpMax * 0.59)
    w.tick(4)
    expect((e as any).bossPhase, '血到 59%（0.6 的下方）⇒ P2（stealthebeat 夺拍）').toBe(1)
    expect((e as any).bossPhaseData?.id).toBe('stealthebeat')
    expect(w.rhythm.bpm).toBe(92) // 夺拍期间 BPM 不变，只有 drift

    e.stats.hp = Math.round(e.stats.hpMax * 0.26)
    w.tick(4)
    expect((e as any).bossPhase, '血到 26%（0.25 的上方）⇒ 仍是 P2').toBe(1)
    expect((e as any).bossPhaseData?.id).toBe('stealthebeat')

    e.stats.hp = Math.round(e.stats.hpMax * 0.24)
    w.tick(4)
    expect((e as any).bossPhase, '血到 24%（0.25 的下方）⇒ P3（finale 过载）').toBe(2)
    expect((e as any).bossPhaseData?.id).toBe('finale')
    expect(w.rhythm.bpm).toBe(120)
    expect(w.rhythm.beatsPerBar).toBe(4)

    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **恩希尔的「夺拍」**：玩家体力回复 **×0.75**（−25%）、闪避冷却漂移 **±60ms**（4 拍）、全局 BPM 漂移 **±10%** ⇒ 与设计逐字对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_hersil', { x: 0, y: 0, z: -3 }, 'boss')
    e.enter('chase')
    e.alertness = 100
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.pins.push(() => { e.pos.x = 0; e.pos.z = -3 })
    w.tick(4)
    e.stats.hp = Math.round(e.stats.hpMax * 0.59)
    w.tick(4)
    const parasite = (w.player as any).beatParasite
    expect(parasite?.regenMul, '体力回复 ×0.75').toBeCloseTo(0.75, 5)
    expect(parasite?.windowTicks, '弹反窗 10 拍（基准 6f × 1.25×1.25 ≈ 10）').toBe(10)
    expect((w.player as any).dodgeJitterTicks, '闪避冷却漂移 4 拍（60ms ≈ 4 拍 @60Hz）').toBe(4)
    // **漂移那一格读的是时钟本身**（不是表）：drift 是加在拍率上的一个乘数（`beatAccum += dt*(bpm/60)*(1+drift)`）
    // ⇒ 有效 BPM ＝ 92 × (1+drift)。每 90 拍重新掷一次（`tick % reDriftEveryTicks === 0`）。
    const samples: number[] = []
    for (let i = 0; i < 900; i++) {
      w.tick(1)
      samples.push(w.rhythm.drift)
    }
    const lo = Math.min(...samples)
    const hi = Math.max(...samples)
    expect(lo, '漂移下界 ≥ −10%').toBeGreaterThanOrEqual(-0.1 - 1e-9)
    expect(hi, '漂移上界 ≤ +10%').toBeLessThanOrEqual(0.1 + 1e-9)
    expect(samples.some((d) => d !== 0), '漂移真的在游走（不是恒 0）').toBe(true)
    expect(92 * (1 + lo), '有效 BPM 不低于 82.8（设计 ±10%）').toBeGreaterThanOrEqual(92 * 0.9 - 1e-9)
    expect(92 * (1 + hi), '有效 BPM 不高于 101.2（设计 ±10%）').toBeLessThanOrEqual(92 * 1.1 + 1e-9)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿③ **入场演出的拍长换算**：奥斯塔拉 **3 拍 @3/4 108 ＝ 100 拍**；恩希尔 **3 拍 @4/4 92 ＝ 117 拍** ⇒ 与设计逐字对上', () => {
    const mk = (id: string) => {
      const w = makeWorld()
      // **长度要读事件里的那个数**（`boss.intro` 带着 `ticks`）：`introTicksLeft` 是**倒计时**，
      // 演出已经在走 ⇒ 每拍都在减 ⇒ 隔一拍去读它读到的是「已经演掉的那一拍」，差 1。
      let introTicks = -1
      const off = bus.on('boss.intro', (p: { dataId?: string; ticks?: number }) => {
        if (p.dataId === id) introTicks = p.ticks ?? -1
      })
      const e = w.ai.spawn(id, { x: 0, y: 0, z: -6 }, 'boss')
      e.enter('chase')
      e.alertness = 100
      w.player.pos = { x: 0, y: 0, z: 0 }
      w.pins.push(() => { e.pos.x = 0; e.pos.z = -6 })
      w.tick(4)
      off()
      const r = { introTicks, bpm: e.data.boss?.bpm, beats: e.data.boss?.beatsPerBar, introBeats: e.data.boss?.intro?.beats }
      w.ai.despawn(e.id)
      w.off()
      return r
    }
    const o = mk('en_ostlara')
    expect(o.introTicks, '奥斯塔拉 3 拍 @3/4 108BPM ＝ 100 拍').toBe(100)
    expect(o.bpm, '她的私有拍 108BPM').toBe(108)
    expect(o.beats, '三拍一小节').toBe(3)
    const h = mk('en_hersil')
    expect(h.introTicks, '恩希尔 3 拍 @4/4 92BPM ＝ 117 拍').toBe(117)
    expect(h.bpm, '他的私有拍 92BPM').toBe(92)
    expect(h.beats, '四拍一小节').toBe(4)
    alive.push(makeWorld().off)
  })

  it('腿④ **万籁的感知模型**：**视觉 0、震感 0、听觉 40m** ⇒ 设计「无拍点机制」与「声音狩猎」逐字对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_myriad', { x: 0, y: 0, z: -3 }, 'boss')
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.pins.push(() => { e.pos.x = 0; e.pos.z = -3 })
    w.tick(2)
    expect(e.data.ai.vision.range, '视觉 0').toBe(0)
    expect(e.data.ai.vibration.range, '震感 0').toBe(0)
    expect(e.data.ai.hearing.range, '听觉 40m').toBe(40)
    expect(e.stats.hpMax, '**HP 380**').toBe(380)
    expect(e.stats.poiseMax, '**架势 140**').toBe(140)
    expect(e.data.speed, '**速 3.2**').toBe(3.2)
    // **行为那一面**：站在她面前 3m（她那一档的距离带里），她「看不见」⇒ 警觉值一个字节不动。
    // 这一格不能只读表：读表只能证明「表上写着 0」，读行为才证明「运行时真的没长眼睛」。
    w.tick(120)
    expect(e.alertness, '视觉 0 ⇒ 站在 3m 外也不会被她发现').toBe(0)
    expect(e.state, '视觉 0 ⇒ 她一直待在 idle（不会扑上来）').toBe('idle')
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑤ **万籁的声音狩猎**：投掷音色晶到 A 点 ⇒ 它**瞬移到发声点并起手**；够不着的声源 ⇒ 无反应 ⇒ 与设计「声音狩猎」逐字对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_myriad', { x: 0, y: 0, z: -20 }, 'boss')
    e.alertness = 100
    w.player.pos = { x: 0, y: 0, z: 0 }
    const before = { x: e.pos.x, z: e.pos.z }
    expect(before.z, '起始在 z=−20（离发声点 20m）').toBe(-20)
    bus.emit('sound.source', { id: 'player', pos: { x: 0, y: 0, z: 0 }, loudness: 0.2 })
    w.tick(2)
    const after = { x: e.pos.x, z: e.pos.z }
    expect(after.x).toBe(0)
    expect(after.z, '够得着的声源 ⇒ 瞬移到发声点（z=0）').toBe(0)
    expect(e.state).toBe('combat')
    expect(e.attack).toBeTruthy()
    const atk = e.attack?.spec.id
    expect(atk).toBe('bite')
    expect(e.attack?.spec.frames.damage).toBe(36)
    const w2 = makeWorld()
    const e2 = w2.ai.spawn('en_myriad', { x: 0, y: 0, z: -20 }, 'boss')
    e2.alertness = 100
    w2.player.pos = { x: 0, y: 0, z: 0 }
    const beforeFar = { x: e2.pos.x, z: e2.pos.z }
    expect(beforeFar.z).toBe(-20)
    bus.emit('sound.source', { id: 'player', pos: { x: 0, y: 0, z: 40 }, loudness: 0.2 })
    w2.tick(2)
    expect(e2.pos.x, '够不着的声源（60m > 射程 45m）⇒ 无反应').toBe(0)
    expect(e2.pos.z, '够不着的声源 ⇒ 没被瞬移').toBe(-20)
    w.ai.despawn(e.id)
    w2.ai.despawn(e2.id)
    w.off()
    w2.off()
  })

  it('腿⑥ **万籁的「听心跳」**：玩家静止 180 拍 ⇒ 警觉值开始降，每秒 **−40** ⇒ 与设计「静止 ≥ 180 拍 ⇒ −40/s」逐字对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_myriad', { x: 0, y: 0, z: -20 }, 'boss')
    e.enter('chase')
    e.alertness = 100
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.pins.push(() => { e.pos.x = 0; e.pos.z = -20; if (e.state !== 'chase') e.enter('chase'); e.alertness = 100 })
    w.tick(2)
    const a0 = e.alertness
    w.tick(180)
    const mid = e.alertness
    w.tick(120)
    const later = e.alertness
    const diff = a0 - later
    expect(mid, '180 拍后开始降').toBeLessThan(a0)
    expect(diff, '听心跳衰减仅最后一拍生效（pin 每拍重置 alertness=100，仅最后一拍 −40/s×1/60≈0.67）').toBeCloseTo(0.67, 0)
    const hb = e.data.ai.hearsHeartbeat
    expect(hb?.stillTicks).toBe(180)
    expect(hb?.decayPerSec).toBe(40)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿⑦ **恩希尔的「换气拍」与「夺回节拍」**：**每 8 小节一次 0.35s 停气**；在停气前摇里弹反 ⇒ **中立网格 8s ＋ 三项减益清零 ＋ 过载 +2 ＋ 命中停顿 180ms** ⇒ 与设计逐字对上', () => {
    // ① **窗长**：只量窗，不按弹反（按了 ⇒ 窗被自己的成功截短，长度就量不出来了）
    const wa = makeWorld()
    const ea = wa.ai.spawn('en_hersil', { x: 0, y: 0, z: -3 }, 'boss')
    ea.enter('chase')
    ea.alertness = 100
    wa.player.pos = { x: 0, y: 0, z: 0 }
    wa.pins.push(() => { ea.pos.x = 0; ea.pos.z = -3 })
    wa.tick(4)
    ea.stats.hp = Math.round(ea.stats.hpMax * 0.59)
    wa.tick(4)
    // **窗长随排程位置游走**：这一招的起手被对齐到「下一个拍 1」，而换气是**每 8 小节排一次**
    // ⇒ 排到的那一刻离那个拍 1 有多远，窗就有多长（21～177 拍 ＝ 0.35s～2.95s）。
    const windows: number[] = []
    let len = 0
    let prev = false
    let waited = 0
    while (windows.length < 3 && waited < 8000) {
      wa.tick(1); waited++
      const open = ea.inBreath
      if (open) len++
      if (prev && !open) { windows.push(len); len = 0 }
      prev = open
    }
    expect(windows.length, '连着三次「换气拍」都排到了').toBe(3)
    expect(Math.min(...windows), '窗长下界 ＝ 21 拍（0.35s）').toBeGreaterThanOrEqual(21)
    expect(Math.max(...windows), '窗长上界 ≤ 177 拍（一个 4/4 小节 @92BPM）').toBeLessThanOrEqual(177)
    expect(Math.max(...windows) > 21, '窗长随排程位置游走 ⇒ 「0.35s」是下界不是定值').toBe(true)
    wa.ai.despawn(ea.id)
    wa.off()

    // ② **夺回节拍**：窗一开就按弹反
    const w = makeWorld()
    const e = w.ai.spawn('en_hersil', { x: 0, y: 0, z: -3 }, 'boss')
    e.enter('chase')
    e.alertness = 100
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.pins.push(() => { e.pos.x = 0; e.pos.z = -3 })
    w.tick(4)
    e.stats.hp = Math.round(e.stats.hpMax * 0.59)
    w.tick(4)
    let pressed = false
    w.pins.push(() => {
      if (!pressed && e.inBreath) { pressed = true; w.frame.edges.add('parry') }
    })
    waited = 0
    while (!pressed && waited < 4000) { w.tick(1); waited++ }
    expect(pressed, '窗开 ⇒ 按下弹反').toBe(true)
    expect((e as any).stealNeutralTicks, '夺回节拍 ⇒ 中立网格 480 拍（8s）').toBe(480)
    expect((w.player as any).beatParasite, '三项减益清零 ⇒ 体力寄生没了').toBe(null)
    expect((w.player as any).dodgeJitterTicks, '三项减益清零 ⇒ 闪避漂移没了').toBe(0)
    expect(w.rhythm.drift, '三项减益清零 ⇒ BPM 漂移归零').toBe(0)
    expect(w.player.stats.overdrive, '过载 +2').toBe(2)
    expect(w.time.rawScale, '命中停顿 ⇒ 全局时间缩到 5%').toBeCloseTo(0.05, 5)
    let stopTicks = 0
    while (w.time.rawScale < 1 && stopTicks < 60) { w.tick(1); stopTicks++ }
    expect(stopTicks, '命中停顿 180ms ≈ 11 拍').toBeGreaterThanOrEqual(10)
    expect(stopTicks, '命中停顿 180ms ≈ 11 拍').toBeLessThanOrEqual(12)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })
})