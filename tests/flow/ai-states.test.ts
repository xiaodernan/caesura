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
 * KI-277：**§13.1「敌人 AI 状态机全表」那 11 态第一次在真链上被量**（combat.md §13.1）。
 *
 * 运行时那 11 个状态**都在**（`src/ai/Enemy.ts` 的 `AIState` 联合类型）⇒ 那一族不是"没有承载体"，
 * 而是**每一态的进入／退出条件与设计那一行对不对得上**。
 *
 * **量法（两条）**：
 * ① **一格一格喂它**：把警觉值拨到某一档、把怪直接放进某一态、把血拨到残、把玩家摆到某个距离
 *    ⇒ 读它**下一拍是什么态** ⇒ 那一格的条件就量出来了（阈值就在两档之间）；
 * ② **量它待多久**：某一态的退出有计时器（巡逻超时、调查超时、搜索超时、硬直重定音）⇒ 数它**第几拍**换态。
 *
 * **量具纪律**：① **玩家要摆到感知半径之外**（`en_murkshell` 的视距 12m／震感 8m）⇒ 否则警觉值会被感知抬上去，
 *    阈值那一格就量不干净；② **怪要背对玩家**（`yaw = π`）⇒ 视锥那一支不掺进来；③ **每一格量都换一个世界**
 *    （状态机有记忆：上一格的警觉值会漏进下一格）；④ **广播那一格是概率门**（每 36 拍掷一次 **30%**）
 *    ⇒ 量它的时候要把**警觉值按住在 80**（否则掷骰的次数由「警觉值活多久」决定 ⇒ 同一段代码换个跑法掷出的点数就变）。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
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
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, streaming, spawner, frame, tick, off }
}

type World = ReturnType<typeof makeWorld>
type Enemy = ReturnType<World['ai']['spawn']>

/** 把玩家摆到某个距离上（感知半径之外 ⇒ 警觉值不会被抬上去） */
function place(w: World, z: number): void {
  w.player.pos = { x: 0, y: 0, z }
  w.player.camYawRef = 0
}

/** 一只怪：背对玩家（视锥那一支不掺进来）、警觉值清零 */
function spawn(w: World, x = 0, z = 0): Enemy {
  const e = w.ai.spawn('en_murkshell', { x, y: 0, z }, 'probe')
  e.alertness = 0
  e.yaw = Math.PI
  return e
}

describe('KI-277 §13.1 敌人 AI 状态机全表（11 态）：进入条件／行为／退出条件', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **Idle**：设计写「感知>0 → Investigate」，运行时是**警觉值 > 20**；外加一格设计没写的退出：**第 181 拍 → Patrol**；本态的警觉衰减 **20/s**（设计与运行时同口径）⇒ 登记三处', () => {
    // 阈值：21 进 investigate、20 留在 idle
    const a = makeWorld()
    place(a, 30)
    const ea = spawn(a)
    expect(ea.state, '初始态').toBe('idle')
    ea.alertness = 21
    a.tick()
    expect(ea.state, '**警觉 21 ⇒ 进 investigate**（设计写「感知>0」）').toBe('investigate')
    const b = makeWorld()
    place(b, 30)
    const eb = spawn(b)
    eb.alertness = 20
    b.tick(3)
    expect(eb.state, '**警觉 20 ⇒ 仍留在 idle**').toBe('idle')
    // 超时：第 181 拍进 patrol
    const c = makeWorld()
    place(c, 30)
    const ec = spawn(c)
    c.tick(180)
    expect(ec.state, '第 180 拍还 idle').toBe('idle')
    c.tick()
    expect(ec.state, '**第 181 拍进 patrol**（设计那一行没写这一格）').toBe('patrol')
    // 本态的衰减 20/s
    const d = makeWorld()
    place(d, 30)
    const ed = spawn(d)
    ed.alertness = 20
    d.tick(60)
    expect(ed.alertness, '**idle 态的警觉衰减 20/s**（设计「衰减 −20/s」）').toBeCloseTo(0, 5)
    alive.push(a.off, b.off, c.off, d.off)
  })

  it('腿② **Patrol**：设计写「感知 → Investigate/Alert」，运行时是**警觉值 ≥ 60 → Investigate**（没有 Alert 那一支）⇒ 登记', () => {
    const a = makeWorld()
    place(a, 30)
    const ea = spawn(a)
    ea.enter('patrol')
    ea.alertness = 60
    a.tick()
    expect(ea.state, '**警觉 60 ⇒ 进 investigate**（设计写 Investigate/Alert 两支）').toBe('investigate')
    const b = makeWorld()
    place(b, 30)
    const eb = spawn(b)
    eb.enter('patrol')
    eb.alertness = 59
    b.tick(3)
    expect(eb.state, '**警觉 59 ⇒ 仍留在 patrol**').toBe('patrol')
    alive.push(a.off, b.off)
  })

  it('腿③ **Investigate**：设计写「找到 → Alert」，运行时是**警觉值 ≥ 100 → Chase**；**第 289 拍（12s）没果 → Idle**（这一族是 basic）＋ 警觉值 **×0.4**；本态的衰减 **8/s**（设计写 −20/s）⇒ 登记三处', () => {
    const a = makeWorld()
    place(a, 30)
    const ea = spawn(a)
    ea.enter('investigate')
    ea.alertness = 100
    a.tick()
    expect(ea.state, '**警觉 100 ⇒ 进 chase**（设计写「找到 → Alert」）').toBe('chase')
    const b = makeWorld()
    place(b, 30)
    const eb = spawn(b)
    eb.enter('investigate')
    eb.alertness = 99
    b.tick(3)
    expect(eb.state, '**警觉 99 ⇒ 仍留在 investigate**').toBe('investigate')
    // 超时：第 289 拍 ⇒ idle（basic 那一族）＋ 警觉 ×0.4
    const c = makeWorld()
    place(c, 30)
    const ec = spawn(c)
    ec.enter('investigate')
    ec.alertness = 50
    c.tick(288)
    expect(ec.state, '第 288 拍还 investigate').toBe('investigate')
    const before = ec.alertness
    expect(before, '**超时之前警觉值还在**（这一族在 investigate 里的衰减只有 8/s ⇒ 288 拍后还剩 11.6）').toBeGreaterThan(0)
    c.tick()
    expect(ec.state, '**第 289 拍（12s）⇒ 进 idle**（设计「12s 无果→Patrol/Idle」）').toBe('idle')
    const after = ec.alertness
    expect(after / before, '**警觉值被乘了 0.4**（运行时多出来的那一格）').toBeLessThan(0.4)
    expect(after / before, '（……而且不是清零）').toBeGreaterThan(0.3)
    // 本态的衰减 8/s
    const d = makeWorld()
    place(d, 30)
    const ed = spawn(d)
    ed.enter('investigate')
    ed.alertness = 50
    d.tick(60)
    expect(50 - ed.alertness, '**investigate 态的警觉衰减只有 8/s**（设计写 −20/s）').toBeCloseTo(8, 5)
    alive.push(a.off, b.off, c.off, d.off)
  })

  it('腿④ **Alert**：设计写「≥60 且未确认玩家 → 举械朝向，不攻击」，运行时**这一态只有一个入口**（同伴的广播）⇒ 而且广播把警觉值直接顶到 100 ⇒ **下一拍就掉进 chase** ⇒ 那一格**没有承载体** ⇒ 登记', () => {
    const a = makeWorld()
    place(a, 30)
    const ea = spawn(a)
    bus.emit('ai.callAlly', { fromId: 'someone-else', pos: { x: 0, y: 0, z: 0 }, range: 14 })
    expect(ea.state, '**同伴的广播 ⇒ 同步进 alert**').toBe('alert')
    expect(ea.alertness, '**广播把警觉值顶到 100**').toBe(100)
    a.tick()
    expect(ea.state, '**下一拍就掉进 chase**（因为警觉值已经是 100）⇒ 设计「举械朝向，不攻击」那一格没有承载体').toBe('chase')
    // 广播够不着 ⇒ 什么也不发生
    const b = makeWorld()
    place(b, 30)
    const eb = spawn(b)
    bus.emit('ai.callAlly', { fromId: 'someone-else', pos: { x: 0, y: 0, z: 20 }, range: 14 })
    expect(eb.state, '**20m 外的广播 ⇒ 什么也没发生**').toBe('idle')
    expect(eb.alertness, '（警觉值也没动）').toBe(0)
    alive.push(a.off, b.off)
  })

  it('腿⑤ **Chase**：设计写「进入攻击距离且插槽空 → Combat」——运行时**逐字对上**（**第 25 拍**出手，出的那一拍就换态）；外加一格设计没写的退出：**警觉 < 40 → Search** ⇒ 登记一处', () => {
    const a = makeWorld()
    place(a, 1.2)
    const ea = spawn(a)
    ea.enter('chase')
    ea.alertness = 100
    a.tick(24)
    expect(ea.state, '第 24 拍还在 chase').toBe('chase')
    expect(ea.attack, '**第 24 拍还没出手**').toBe(null)
    a.tick()
    expect(ea.state, '**第 25 拍出手 ⇒ 同一拍进 combat**（设计「进入攻击距离且插槽空 → Combat」）').toBe('combat')
    expect(ea.attack, '（它确实在出手）').toBeTruthy()
    const b = makeWorld()
    place(b, 30)
    const eb = spawn(b)
    eb.enter('chase')
    eb.alertness = 39
    b.tick()
    expect(eb.state, '**警觉 39 ⇒ 进 search**（设计那一行没写这一格）').toBe('search')
    alive.push(a.off, b.off)
  })

  it('腿⑥ **Combat**：设计写「玩家脱离 12m → Chase」「HP<阈值 → Retreat」「架势破 → Recover」——**12m 与 Recover 两格逐字对上**；**HP 那一格是敌人表自己的 0.2（设计写 25%）** ⇒ 登记一处', () => {
    // 12m
    const a = makeWorld()
    place(a, 11.5)
    const ea = spawn(a)
    ea.enter('combat')
    ea.alertness = 100
    a.tick()
    expect(ea.state, '**11.5m ⇒ 仍留在 combat**').toBe('combat')
    const b = makeWorld()
    place(b, 12.5)
    const eb = spawn(b)
    eb.enter('combat')
    eb.alertness = 100
    b.tick()
    expect(eb.state, '**12.5m ⇒ 进 chase**（设计「玩家脱离 12m」）').toBe('chase')
    // 残血
    const c = makeWorld()
    place(c, 1.2)
    const ec = spawn(c)
    ec.enter('combat')
    ec.alertness = 100
    ec.stats.hp = ec.stats.hpMax * 0.2
    c.tick()
    expect(ec.state, '**血剩 20% ⇒ 进 retreat**（设计写「HP<25%」，运行时是敌人表自己的 `retreatHpFrac` ＝ 0.2）').toBe('retreat')
    // 破势
    const d = makeWorld()
    place(d, 1.2)
    const ed = spawn(d)
    ed.enter('combat')
    ed.alertness = 100
    ed.stats.crumpleTicksLeft = 30
    d.tick()
    expect(ed.state, '**破势 ⇒ 进 recover**（设计「架势破 → Recover」）').toBe('recover')
    alive.push(a.off, b.off, c.off, d.off)
  })

  it('腿⑦ **Retreat**：设计写「距离恢复 → Combat」，运行时是**血量恢复（> 阈值的 1.8 倍）→ Combat** ⇒ 登记一处', () => {
    const a = makeWorld()
    place(a, 1.2)
    const ea = spawn(a)
    ea.enter('retreat')
    ea.alertness = 100
    ea.stats.hp = ea.stats.hpMax * 0.1
    a.tick(3)
    expect(ea.state, '**血剩 10% ⇒ 仍留在 retreat**').toBe('retreat')
    const b = makeWorld()
    place(b, 1.2)
    const eb = spawn(b)
    eb.enter('retreat')
    eb.alertness = 100
    eb.stats.hp = eb.stats.hpMax * 0.5
    b.tick()
    expect(eb.state, '**血回到 50% ⇒ 进 combat**（设计写的是「距离恢复」）').toBe('combat')
    alive.push(a.off, b.off)
  })

  it('腿⑧ **Search**：设计写「超时 → Patrol」——运行时**逐字对上**（**第 1201 拍 ＝ 20s** ⇒ 警觉值清零）；外加**螺旋半径比设计的 8m 小**（实测离「最后已知位置」最远 **2.93m**）⇒ 登记一处', () => {
    const a = makeWorld()
    place(a, 30)
    const ea = spawn(a)
    ea.enter('search')
    ea.alertness = 50
    ea.lastKnown = { x: 0, y: 0, z: 0 }
    const radii: number[] = []
    for (let i = 0; i < 1200; i++) {
      a.tick()
      radii.push(Math.hypot(ea.pos.x - ea.lastKnown.x, ea.pos.z - ea.lastKnown.z))
    }
    expect(ea.state, '第 1200 拍还 search').toBe('search')
    a.tick()
    expect(ea.state, '**第 1201 拍（20s）⇒ 进 patrol**（设计「超时→Patrol」）').toBe('patrol')
    expect(ea.alertness, '**警觉值清零**').toBe(0)
    const max = Math.max(...radii)
    expect(max, '**螺旋搜索离「最后已知位置」最远 2.93m**（设计写 8m 半径 ⇒ 运行时的更小）').toBeGreaterThan(2.5)
    expect(max, '（……也不是一步没挪）').toBeLessThan(3.5)
    alive.push(a.off)
  })

  it('腿⑨ **CallAlly**：设计写「0.6s 前摇广播」「可视 25m 内同伴 +100 Alertness」「打断广播 → 该敌 2s 内无法重呼」——**前摇与 +100 逐字对上**，**广播半径是 14m（不是 25m）** ⇒ 登记一处', () => {
    const a = makeWorld()
    place(a, 20)
    const ea = spawn(a)
    const listener = spawn(a, 5, 0)
    let broadcastAt = -1
    const off = bus.on('ai.callAlly', () => { if (broadcastAt < 0) broadcastAt = a.time.tick })
    ea.enter('alert')
    ea.alertness = 80
    let callAllyAt = -1
    for (let i = 0; i < 400 && broadcastAt < 0; i++) {
      // **把警觉值按住在 80**：广播那一格是**概率门**（每 36 拍掷一次 30%）⇒ 警觉值一掉到 60 以下
      // 那扇门就关上了 ⇒ 掷骰的次数由「警觉值活多久」决定。按住它，这一格才量得稳。
      ea.alertness = 80
      a.tick()
      if (callAllyAt < 0 && ea.state === 'callAlly') callAllyAt = a.time.tick
    }
    expect(callAllyAt, '**它进了 callAlly 那一态**').toBeGreaterThan(0)
    expect(ea.attack?.spec.frames.startup, '**广播的前摇 36 拍 ＝ 0.6s**（设计「0.6s 前摇广播」）').toBe(36)
    expect(broadcastAt - callAllyAt, '**广播在读条走完之后才发出去**（正好 36 拍 ＝ 前摇那一格）').toBe(36)
    expect(listener.alertness, '**听到广播的同伴警觉值被顶到 100**（设计「+100 Alertness」；它自己那一拍还挨了一次衰减 ⇒ 读到 99.67）').toBeGreaterThan(99.5)
    expect(listener.alertness, '（……没被顶过头）').toBeLessThanOrEqual(100)
    expect(listener.state, '（**它连 alert 那一拍都没待住** ⇒ 广播把警觉值顶到 100 ⇒ 当拍就掉进 chase）').toBe('chase')
    off()
    // 广播半径：13m 收到、15m 收不到
    const b = makeWorld()
    place(b, 30)
    const near = spawn(b, 13, 0)
    bus.emit('ai.callAlly', { fromId: 'someone-else', pos: { x: 0, y: 0, z: 0 }, range: 14 })
    expect(near.alertness, '**13m 外的同伴收到了广播**').toBe(100)
    const c = makeWorld()
    place(c, 30)
    const farOne = spawn(c, 15, 0)
    bus.emit('ai.callAlly', { fromId: 'someone-else', pos: { x: 0, y: 0, z: 0 }, range: 14 })
    expect(farOne.alertness, '**15m 外的同伴没收到** ⇒ 广播半径 14m（设计写 25m）').toBe(0)
    alive.push(a.off, b.off, c.off)
  })

  it('腿⑩ **Recover**：设计写「单膝重定音 1.2s，架势清零」——运行时**逐字对上**（**第 73 拍**换态 ＋ 架势清零）', () => {
    const a = makeWorld()
    place(a, 1.2)
    const ea = spawn(a)
    ea.enter('recover')
    ea.alertness = 100
    ea.stats.crumpleTicksLeft = 10
    ea.stats.poiseAccum = 50
    a.tick(72)
    expect(ea.state, '第 72 拍还 recover').toBe('recover')
    a.tick()
    expect(ea.state, '**第 73 拍（1.2s）⇒ 进 combat**').toBe('combat')
    expect(ea.stats.poiseAccum, '**架势清零**（设计「架势清零」）').toBe(0)
    alive.push(a.off)
  })

  it('腿⑪ **挨打 ⇒ 进 chase**（设计 Idle 那一行写的是「被攻击 → Combat」）⇒ 登记一处', () => {
    const a = makeWorld()
    place(a, 1.2)
    const ea = spawn(a)
    ea.onDamaged()
    expect(ea.state, '**挨打那一记 ⇒ 进 chase**（设计写的是 Combat）').toBe('chase')
    expect(ea.alertness, '（警觉值直接顶到 100）').toBe(100)
    alive.push(a.off)
  })
})
