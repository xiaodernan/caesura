import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
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
import { Rng } from '@/core/Math'
import { shapeHits } from '@/combat/HitShapes'
import { CombatDebugger } from '@/tools/CombatDebugger'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-297：**§17「实现说明（Three.js 落地约束）」那一族第一次在真链上被量**。
 *
 * **这一批量的六条腿**：
 * ① **帧数据/敌人表：调参零改码**（帧表那三格在运行时真走：判定落在第 12 拍、那一式在第 30 拍放手）；
 * ② **命中框：扇形（角度 60-120°）＋半径＋高度层；点-扇形解析式（不用物理引擎）**；
 * ③ **BeatClock：音频不是权威时钟**（运行时是**反过来的** ⇒ 登记）；
 * ④ **AI tick：感知 10Hz 轮转 ✓／状态机不是 30Hz**（⇒ 登记）；
 * ⑤ **32 实体／AI 预算 <2ms/帧**；
 * ⑥ **调试器：Combat Debugger**（**F2**，不是设计写的 F9；只读总线事件流 ⇒ 登记）。
 *
 * **三条量具纪律**：
 * ① **帧表要钉「运行时落在第几拍」**，不是钉「表里写着几」；
 * ② **解析式的边界要两面夹逼**（角度／外沿／高度层各量「打得上／打不上」那一对）；
 * ③ **预算格量中位数**（机器噪声大 ⇒ 最大值那一格不作数）。
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

const L1 = () => registry.get<MovesetData>('moveset:ms_sword').actions.l1

describe('KI-297 §17「实现说明（Three.js 落地约束）」那一族', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **帧数据/敌人表：调参零改码** ⇒ 帧表那三格在运行时真走：判定落在**第 12 拍**、那一式在**第 30 拍**放手、一次出手**只结算一次** ⇒ 与设计逐字对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 1.2 }, 'dummy')
    e.enter('idle')
    const hits: Array<{ t: number; d: number }> = []
    const off = bus.on('combat.hit', (p) => { if (p.victimId === e.id) hits.push({ t: w.time.tick, d: p.damage }) })
    w.combat.rng = new Rng('ki297')
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    w.player.camYawRef = 0
    const l1 = L1()
    const t0 = w.time.tick
    w.frame.edges.add('attackLight')
    w.tick(1)
    let freedAt = -1
    for (let i = 0; i < 80; i++) {
      w.tick(1)
      if (freedAt < 0 && w.player.action === null) freedAt = w.time.tick
    }
    expect(hits.length, '一次出手只结算一次').toBe(1)
    expect(hits[0].t - t0, '判定落在帧表写的那一拍（activeStart ＝ 12）').toBe(12)
    expect(freedAt - t0, '那一式在 recovery ＝ 30 那一拍放手').toBe(30)
    expect(l1.activeStart, '表上写的就是 12').toBe(12)
    expect(l1.recovery, '表上写的就是 30').toBe(30)
    // **伤害那一格钉的是读数，不是「表里的数乘一下」**——后者是恒真式（表一改它也跟着改 ⇒ 谁都抓不到）。
    // 这一刀的读数是 **10**：帧表基数 9 × 属性标尺 1.084 × 浮动（±5%）× 减伤（那具假人的 defense）取整。
    expect(hits[0].d, '那一刀的伤害（钉住的读数：表里的基数 × 标尺 × 浮动 × 减伤）').toBe(10)
    off()
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **命中框＝扇形（角度 60-120°）＋半径＋高度层；点-扇形解析式（不用物理引擎）** ⇒ 角度边 **70.14°**、外沿 **2.65m**、高度层 **1.7m**，三道边界都两面夹逼 ⇒ 与设计逐字对上', () => {
    const l1 = L1()
    const box = l1.hitbox!
    if (box.shape !== 'cone') throw new Error('这一记的 Active 段不是扇形')
    expect(box.shape, 'Active 段是扇形（cone）').toBe('cone')
    expect(box.angleDeg, '角度落在设计的 60-120° 那一段').toBeGreaterThanOrEqual(60)
    expect(box.angleDeg, '角度落在设计的 60-120° 那一段').toBeLessThanOrEqual(120)
    const origin = { x: 0, y: 0, z: 0 }
    const target = { pos: { x: 0, y: 0, z: 1.5 }, facingYaw: 0, radius: 0.55, height: 1.8 }
    const at = (deg: number, dist: number, y = 0) => {
      const a = (deg * Math.PI) / 180
      return shapeHits(box, origin, 0, { ...target, pos: { x: Math.sin(a) * dist, y, z: Math.cos(a) * dist } })
    }
    // **角度边**：扇形半角 ＋ 目标自己的半径摊出来的那一点（`atan2(r, dist)`）
    const angEdge = box.angleDeg / 2 + (Math.atan2(target.radius, 1.5) * 180) / Math.PI
    expect(angEdge, '角度边界＝半角 50° ＋ 目标半径摊出来的 20.14°').toBeCloseTo(70.14, 1)
    expect(at(70, 1.5), '70° 打得上').toBe(true)
    expect(at(71, 1.5), '71° 打不上').toBe(false)
    // **外沿**：扇形半径 ＋ 目标自己的半径
    expect(box.radius + target.radius, '外沿 ＝ 2.1 ＋ 0.55 ＝ 2.65').toBeCloseTo(2.65, 5)
    expect(at(0, 2.65), '2.65m 打得上（边界含在内）').toBe(true)
    expect(at(0, 2.66), '2.66m 打不上').toBe(false)
    // **高度层**：扇形高度 ＋ 目标身高，两者各取一半
    expect((box.height + target.height) / 2, '高度层 ＝ (1.6 ＋ 1.8)/2 ＝ 1.7').toBeCloseTo(1.7, 5)
    expect(shapeHits(box, origin, 0, { ...target, pos: { x: 0, y: 1.6, z: 1.5 } }), '1.6m 打得上').toBe(true)
    expect(shapeHits(box, origin, 0, { ...target, pos: { x: 0, y: 1.7, z: 1.5 } }), '1.7m 打不上（边界不含在内）').toBe(false)
    // **解析式**：同一组坐标永远同一结果 ⇒ 不依赖任何物理步、不依赖帧序
    const same = [0, 1, 2, 3, 4].map(() => at(30, 1.8))
    expect(new Set(same).size, '同一组坐标反复判定，答案永远一样（没有物理引擎的随机性）').toBe(1)
  })

  it('腿③ **BeatClock：音频不是权威时钟** ⇒ 拍网**按 tick 推进**（每拍 ＋`(bpm/60)×(1/60)`）、`audio.music.grid` **只在网格真的变了**时发 ⇒ 与设计「WebAudio `currentTime` 驱动」**反过来** ⇒ 登记', () => {
    const w = makeWorld()
    const grids: Array<{ bpm: number; beatsPerBar: number }> = []
    const off = bus.on('audio.music.grid', (g) => grids.push({ bpm: g.bpm, beatsPerBar: g.beatsPerBar }))
    w.tick(120)
    expect(grids.length, '120 拍里网格没变 ⇒ 只发第一条').toBe(1)
    expect(grids[0].bpm, '发布的那一条带着当前网格').toBe(84)
    expect(w.rhythm.beat, '拍位按 tick 推进：120 拍 ＝ 120×(84/60)×(1/60) ＝ 1.4 拍').toBeCloseTo(120 * (84 / 60) * (1 / TICK_HZ), 6)
    // **确定**：同样的拍数永远落在同一个拍位（这是「逻辑钟权威」的那一半）
    const w2 = makeWorld()
    w2.tick(120)
    expect(w2.rhythm.beat, '另一个世界里同样 120 拍 ⇒ 同一个拍位').toBeCloseTo(w.rhythm.beat, 9)
    // 网格真的变了 ⇒ 再发一条（**由 Boss 接管**这一条路：区域基准被私有拍顶掉）
    const e = w.ai.spawn('en_hersil', { x: 0, y: 0, z: -6 }, 'boss')
    e.enter('chase')
    e.alertness = 100
    w.tick(4)
    expect(grids.length, '网格被 Boss 接管 ⇒ 至少再发一条').toBeGreaterThanOrEqual(2)
    expect(grids.map((g) => g.bpm), '那一条带着新网格（恩希尔的 92BPM）').toContain(92)
    w.ai.despawn(e.id)
    off()
    alive.push(w.off); alive.push(w2.off)
  })

  it('腿④ **AI tick：感知 10Hz 轮转 ✓／状态机不是 30Hz** ⇒ 警觉值**每 6 拍涨一次**（＝10Hz）；`stateTick` **每拍都涨**（＝60Hz，不是设计的 30Hz）⇒ 登记', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -3 }, 'dummy')
    e.enter('idle')
    w.player.pos = { x: 0, y: 0, z: 0 }
    const ups: number[] = []
    let last = 0
    for (let i = 0; i < 80; i++) {
      w.tick(1)
      if (e.alertness > last + 1e-3) ups.push(w.time.tick)
      last = e.alertness
    }
    expect(ups.length, '80 拍里她「看见」了至少七次').toBeGreaterThanOrEqual(7)
    const gaps: number[] = []
    for (let i = 1; i < ups.length; i++) gaps.push(ups[i] - ups[i - 1])
    expect(new Set(gaps), '每一次间隔都恰好 6 拍（＝10Hz 轮转）').toEqual(new Set([6]))
    expect(60 / 6, '那正是 10Hz').toBe(10)
    // **状态机**：每拍都推进（60Hz），不是设计的 30Hz
    const e2 = w.ai.spawn('en_murkshell', { x: 8, y: 0, z: -3 }, 'dummy2')
    const st: number[] = []
    let prev = -1
    for (let i = 0; i < 10; i++) {
      w.tick(1)
      if (e2.stateTick !== prev) { st.push(e2.stateTick); prev = e2.stateTick }
    }
    expect(st, '状态计数每拍都涨一格').toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    w.ai.despawn(e.id); w.ai.despawn(e2.id)
    alive.push(w.off)
  })

  it('腿⑤ **32 实体／AI 预算 <2ms/帧** ⇒ **32 个敌人每一拍都被更新到**（没有一个被漏掉）；一帧的 AI 耗时**中位数 0.082ms** ⇒ 与设计「32 实体/AI 预算 <2ms/帧」逐字对上（量**中位数**，最大值那一格是机器噪声不作数）', () => {
    const w = makeWorld()
    const mobs: ReturnType<typeof w.ai.spawn>[] = []
    for (let i = 0; i < 32; i++) mobs.push(w.ai.spawn('en_murkshell', { x: i * 2, y: 0, z: -10 }, 'budget'))
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.tick(10)
    const before = mobs.map((m) => m.stateTick)
    w.tick(1)
    const after = mobs.map((m) => m.stateTick)
    expect(after.filter((v, i) => v === before[i] + 1).length, '32 个敌人**每一个**都在这一拍被更新到').toBe(32)
    const samples: number[] = []
    for (let i = 0; i < 120; i++) {
      const a = process.hrtime.bigint()
      w.ai.update(TICK_DT, w.time.tick + i, w.player, w.rhythm)
      const b = process.hrtime.bigint()
      samples.push(Number(b - a) / 1e6)
    }
    samples.sort((x, y) => x - y)
    const median = samples[60]
    expect(median, '32 个实体一帧的 AI 耗时中位数（设计上限 2ms）').toBeLessThan(2)
    expect(median, '这一格离上限还有一个数量级（实测约 0.08ms）').toBeLessThan(0.5)
    alive.push(w.off)
  })

  it('腿⑥ **调试器：Combat Debugger** ⇒ 呼出键是 **F2**（**不是设计写的 F9**）；面板**只读总线事件流**（体力/架势数值、拍点刻度尺都从总线来）⇒ 与设计「屏幕显示 当前帧阶段 S/A/R、hitbox 线框、体力/架势数值、拍点刻度尺；开发期按 F9」**三格对上、两格没有承载体** ⇒ 登记', () => {
    const g = globalThis as unknown as Record<string, unknown>
    const created: Array<{ style: Record<string, string>; textContent: string; remove: () => void }> = []
    const keys: Array<(e: unknown) => void> = []
    const prevDoc = g.document
    const prevWin = g.window
    g.document = {
      createElement: () => { const el = { style: {} as Record<string, string>, textContent: '', remove: () => {} }; created.push(el); return el },
      body: { appendChild: () => {} },
    }
    g.window = {
      addEventListener: (k: string, fn: (e: unknown) => void) => { if (k === 'keydown') keys.push(fn) },
      removeEventListener: () => {},
    }
    const dbg = new CombatDebugger()
    const panel = created[0]
    const press = (key: string) => { for (const fn of keys) fn({ key, preventDefault: () => {} }) }
    try {
      expect(panel.style.cssText, '开局是收着的').toContain('display:none')
      press('F9')
      expect(panel.style.cssText, '**按 F9 什么都不发生**（设计写的是 F9）').toContain('display:none')
      expect(panel.style.display, 'F9 没有改过 display').toBe(undefined)
      press('F2')
      expect(panel.style.display, '**按 F2 才呼出**').toBe('block')
      // **面板只读总线事件流** ⇒ 体力/架势数值那一行从 `player.stats` 来
      bus.emit('player.stats', {
        hp: 87, hpMax: 120, stamina: 40, staminaMax: 100,
        poise: 33, poiseMax: 60, overdrive: 2, overdriveMax: 10,
        rank: 3, corruption: 0, corruptionMax: 100, corruptionVeil: 0, muteTicksLeft: 0,
      })
      expect(panel.textContent, '体力/架势数值那一行来自总线').toContain('HP 87/120')
      expect(panel.textContent, '体力/架势数值那一行来自总线').toContain('POI 33/60')
      // **拍点刻度尺**从 `rhythm.beat` 来
      bus.emit('rhythm.beat', { beatIndex: 0, beatInBar: 1, bar: 0, isBarStart: true, phase: 0 })
      expect(panel.textContent, '拍点刻度尺来自总线').toContain('beats:')
      expect(panel.textContent, '小节头那一拍用 │ 标').toContain('│1')
      press('F2')
      expect(panel.style.display, '再按一次 F2 收起来').toBe('none')
    } finally {
      dbg.dispose()
      g.document = prevDoc
      g.window = prevWin
    }
  })
})
