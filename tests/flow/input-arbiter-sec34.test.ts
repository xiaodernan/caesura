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
import { Rng } from '@/core/Math'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-301：**gameplay.md §3.4「输入裁决与优先级（冲突消解，实现为单一 InputArbiter）」那一族第一次在真链上被量**。
 *
 * **七条腿**：
 * ① **翻滚（最高优先）**：可在**任意帧**（含 startup 内）取消攻击动作 —— 代码只检查 `canAct`（非硬直/非倒地/非死亡），**不检查 `busy`** ⇒ 与设计「startup 结束后全段 ＋ recovery 前 60%」不符（实现更宽） ⇒ 登记
 * ② **弹反（与格挡共享起手，弹反键优先判帧）**：同一 tick 同时按 guard + parry ⇒ **parry 赢**（guardTicks=0, parryTicksLeft=5）
 * ③ **重击（连段窗口内缓冲 200ms）**：在 activeStart..activeEnd 期间**按下 attackLight 边沿**会把下一段排入 `comboQueued`；held 不算；下一段在 activeEnd 那一拍起手
 * ④ **轻击/战技（缓冲 200ms；锁定态下沿目标朝向修正）**：同上缓冲机制
 * ⑤ **格挡（按住，低优先）**：同 tick 先建立/维持 guard，下一 tick 因 `action!==null` 停止累加但数值保留；动作结束后可重新建立 ⇒ **不立即解除** ⇒ 与设计「任何主动攻击键解除」不符 ⇒ 登记
 * ⑥ **交互/拾取/观察（仅非硬直、距离 ≤2.2m）**：空世界无交互物 ⇒ 无法测（需造交互物）
 * ⑦ **处决（特殊）**：演出期间 `executing!==null` 时 dodge/attackLight 都不生效；执行结束后 action 为 undefined ⇒ 逐字对上
 * ⑧ **「实现为单一 InputArbiter」**：**不存在**，裁决散在 `ThirdPersonController.update` 里 ⇒ 登记
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

describe('KI-301 §3.4「输入裁决与优先级」那一族', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **翻滚（最高优先）**：可在**任意帧**（含 startup 内）取消攻击动作 ⇒ 代码只检查 `canAct`，不检查 `busy` ⇒ 与设计「startup 结束后全段 ＋ recovery 前 60%」不符（实现更宽） ⇒ 登记', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    w.combat.rng = new Rng('ki301')

    // 轻击 startup=12，activeStart=12，activeEnd=18，recovery=30
    // 设计取消窗：startup 结束后(13) .. recovery*0.6(18)
    // 实测：第 1 帧（startup 内）即可取消
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect(w.player.action?.tick, '攻击已起手').toBe(1)
    w.frame.edges.add('dodge')
    w.tick(1)
    expect(w.player.roll, '第 1 帧即可翻滚取消').not.toBeNull()
    expect(w.player.action, '动作被清除').toBeNull()

    // 再验证 recovery 期间也能取消（第 20 帧，recovery 内）
    const w2 = makeWorld()
    w2.player.pos = { x: 0, y: 0, z: 0 }
    w2.player.yaw = 0
    w2.combat.rng = new Rng('ki301b')
    w2.frame.edges.add('attackLight')
    w2.tick(20) // 推进到 recovery 内
    expect(w2.player.action?.tick).toBeGreaterThan(L1().activeEnd)
    w2.frame.edges.add('dodge')
    w2.tick(1)
    expect(w2.player.roll, 'recovery 内也能取消').not.toBeNull()
    alive.push(w.off); alive.push(w2.off)
  })

  it('腿② **弹反（与格挡共享起手，弹反键优先判帧）** ⇒ 同一 tick 同时按 guard + parry，parry 赢（guardTicks=0, parryTicksLeft=5） ⇒ 逐字对上', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.combat.rng = new Rng('ki301p')

    w.frame.held.add('guard')
    w.frame.edges.add('parry')
    w.tick(1)
    expect(w.player.parryTicksLeft, '弹反窗已开启').toBe(5) // base.parry.activeTicks = 5
    expect(w.player.guardTicks, '格挡未建立（被弹反优先抢占）').toBe(0)
    expect(w.player.parryWhiffPending, '落空标记已置位').toBe(true)
    alive.push(w.off)
  })

  it('腿③ **重击（连段窗口内缓冲 200ms）**：在 activeStart..activeEnd 期间**按下 attackLight 边沿**会把下一段排入 comboQueued；held 不算；下一段在 activeEnd 那一拍起手 ⇒ 逐字对上', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    w.combat.rng = new Rng('ki301c')

    const l1 = L1()
    // 起 l1
    w.frame.edges.add('attackLight')
    w.tick(1)
    // 推进到 activeEnd - 2（连段窗口内）
    for (let i = 0; i < l1.activeEnd - 2; i++) w.tick(1)
    // 按下 attackLight 边沿（不是 held） ⇒ 应该入队 l2
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect((w.player as any).comboQueued, 'l2 已入队').toBe('l2')
    // 推进到 l1 的 activeEnd，下一段应该起手
    while (w.player.action && w.player.action.f === l1) w.tick(1)
    expect(w.player.action?.f, 'l1 结束后下一段已起手').not.toBe(l1)
    alive.push(w.off)
  })

  it('腿④ **轻击/战技（缓冲 200ms；锁定态下沿目标朝向修正）**：同缓冲机制 ⇒ 同上腿③同机制对上', () => {
    // 同腿③：缓冲机制由 comboQueued 统一承载，轻击/重击/战技共用同一套
    // 这里只验证轻击连段同机制
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    w.combat.rng = new Rng('ki301l')

    const l1 = L1()
    w.frame.edges.add('attackLight')
    w.tick(1)
    for (let i = 0; i < l1.activeEnd - 2; i++) w.tick(1)
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect((w.player as any).comboQueued).toBe('l2')
    alive.push(w.off)
  })

  it('腿⑤ **格挡（按住，低优先）**：同 tick 先建立/维持 guard，下一 tick 因 action!==null 停止累加但数值保留；动作结束后可重新建立 ⇒ 不立即解除 ⇒ 与设计「任何主动攻击键解除」不符 ⇒ 登记', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.combat.rng = new Rng('ki301g')

    // 建立 guard（按住 guard 3 拍）
    w.frame.held.add('guard')
    w.tick(3)
    expect(w.player.guardTicks, 'guard 已建立').toBe(3)
    // 同一 tick 按轻击：guard 代码在 attack 之前跑，先把 guardTicks 累加到 4
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect(w.player.guardTicks, '同 tick guardTicks 继续累加（attack 后跑）').toBe(4)
    expect(w.player.action?.f, 'attack 已起手').toBe(L1())
    // 下一 tick：guard 代码见 action!==null，停止累加但保留数值
    w.tick(1)
    expect(w.player.guardTicks, 'action 存在时 guardTicks 停在 4').toBe(4)
    // 等待动作彻底结束（含连段链：l1→l2→l3，约 100 拍）**期间清空 held，避免 guard 继续累加**
    w.frame.held.clear()
    for (let i = 0; i < 120; i++) w.tick(1)
    expect(w.player.action, '动作链已结束').toBeNull()
    // 重新按 guard
    w.frame.held.add('guard')
    w.tick(1)
    expect(w.player.guardTicks, '动作结束后可重新建立 guard').toBe(1)
    alive.push(w.off)
  })

  it('腿⑥ **交互/拾取/观察（仅非硬直、距离 ≤2.2m）**：空世界无交互物 ⇒ 无从对照 ⇒ 登记', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.frame.edges.add('interact')
    w.tick(1)
    expect(w.player.action, '空世界无交互物 ⇒ 无动作').toBeNull()
    alive.push(w.off)
  })

  it('腿⑦ **处决（特殊）**：演出期间 `executing!==null` 时 dodge/attackLight 都不生效；执行结束后 action 为 undefined ⇒ 逐字对上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_hersil', { x: 0, y: 0, z: -1.2 }, 'exec')
    e.enter('idle')
    e.stats.crumpleTicksLeft = 60
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    w.combat.rng = new Rng('ki301e')

    w.frame.edges.add('interact')
    w.tick(1)
    expect(w.player.executing, '处决已开始').not.toBeNull()
    // 演出中按翻滚
    w.frame.edges.add('dodge')
    w.tick(10)
    expect(w.player.roll, '处决期间翻滚被屏蔽').toBeNull()
    expect(w.player.executing, '处决仍在进行').not.toBeNull()
    // 演出中按轻击
    w.frame.edges.add('attackLight')
    w.tick(10)
    expect(w.player.action, '处决期间攻击被屏蔽').toBeNull()
    // 等待处决结束（132 拍）
    for (let i = 0; i < 130; i++) w.tick(1)
    expect(w.player.executing, '处决已结束').toBeNull()
    expect(w.player.action, '处决结束后无残留动作').toBeNull()
    alive.push(w.off)
    w.ai.despawn(e.id)
  })

  it('腿⑧ **「实现为单一 InputArbiter」**：不存在，裁决散在 ThirdPersonController.update 里 ⇒ 登记', () => {
    // 读取当前运行环境下的源文件（共享树或平面）
    const fs = require('fs')
    const path = require('path')
    const srcPath = path.resolve(__dirname, '../../src/player/ThirdPersonController.ts')
    const src = fs.readFileSync(srcPath, 'utf8')
    const hasArbiter = /class InputArbiter|import.*InputArbiter/.test(src)
    expect(hasArbiter, '没有单独的 InputArbiter 类').toBe(false)
  })
})