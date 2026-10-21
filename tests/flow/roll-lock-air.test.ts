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

/**
 * KI-251：**§5.5 那张表最后两行（恢复锁那一列 ＋「空中翻滚」整行） ＋「攻击插槽」那一行的机制侧**。
 *
 * | 前/侧/后翻滚 | 500ms/30f | 9-21f | 3.2m | 14 | **后摇 150ms/9f** |
 * | 锁定侧步 | 300ms/18f | 4-16f | 1.6m | 10 | **后摇 100ms/6f** |
 * | **空中翻滚** | **落地帧起算** | **落地后 0-150ms 免摔落伤** | — | **8** | **200ms** |
 *
 * `src/data/schema.ts` 里那一句「表里另外两格今天仍然没有载体……「恢复锁」列（后摇）与「空中翻滚」整行」
 * 是**写在注释里的断言**；这一批把它**量到真链上**⇒ 断言与读数是两件事。
 *
 * **读数**：恢复锁＝无敌窗的最后一拍到「手又能动」那一拍之间的拍数（每拍试一次 `tryStartAction`，
 * 第一次成功的那一拍就是能动手的那一拍）；空中翻滚＝人在空中时那一滚的体力价与时长。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 * 设计那一行与真读数对不上时**腿钉住真读数、把差额写进消息** ⇒ 只量不裁（设计没裁）。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
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
  return { time, rhythm, player, ai, combat, frame, tick }
}

type World = ReturnType<typeof makeWorld>

interface RollReading {
  started: boolean
  iframeLast: number
  iframeLastTick: number
  actTick: number
  lockTicks: number
  staminaCost: number
  rollTotal: number
}

/** 滚一次（可选：空中／锁定），量它的无敌窗、恢复锁、体力价与总时长 */
function readRoll(w: World, opts: { locked?: boolean; airborne?: boolean } = {}): RollReading {
  const p = w.player
  if (opts.locked) p.lockedTarget = { getPos: () => ({ x: 0, y: 0, z: -3 }), radius: 2 }
  if (opts.airborne) {
    // 先跳起来，等它离地
    w.frame.edges.add('jump')
    w.tick()
    w.frame.edges.delete('jump')
    for (let i = 0; i < 120 && p.grounded; i++) w.tick()
  }
  const sta0 = p.stats.stamina
  w.frame.edges.add('dodge')
  w.tick()
  w.frame.edges.delete('dodge')
  const started = p.roll !== null
  // 体力价只看**起手那一拍**（多走几拍回复会灌进这个差里 ⇒ 那一记轻击的 9 点体力也会）
  const staAfterStart = p.stats.stamina
  let iframeLast = -1
  let iframeLastTick = -1
  let actTick = -1
  let rollTotal = -1
  for (let i = 0; i < 120; i++) {
    const r = p.roll
    if (r) {
      rollTotal = r.total
      if (p.iFrame) {
        iframeLast = r.tick
        iframeLastTick = w.time.tick
      }
    } else if (iframeLast >= 0 && actTick < 0) {
      // 这一滚已经结束 ⇒ 每拍试一次出手，第一次成功的那一拍就是「手又能动」的那一拍
      if (p.tryStartAction('l1', w.time.tick)) actTick = w.time.tick
    }
    if (actTick >= 0) break
    w.tick()
  }
  return {
    started,
    iframeLast,
    iframeLastTick,
    actTick,
    lockTicks: actTick >= 0 && iframeLastTick >= 0 ? actTick - iframeLastTick : -1,
    staminaCost: Math.round(sta0 - staAfterStart),
    rollTotal,
  }
}

describe('KI-251 §5.5 那张表最后两行 ＋ 攻击插槽的机制侧', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 自由翻滚的恢复锁：无敌窗（9-21f）之后还要等 **9 拍**（设计写「后摇 150ms/9f」⇒ 对上）', () => {
    const w = makeWorld()
    const r = readRoll(w)
    expect(r.started, '这一滚真的滚出去了').toBe(true)
    expect(r.iframeLast, '无敌窗的最后一拍').toBe(21)
    expect(r.lockTicks, '从无敌窗结束到「手又能动」之间的拍数（设计 §5.5 那一行写的是 150ms/9f）').toBe(9)
  })

  it('腿② 锁定侧步的恢复锁：只有 **2 拍**（设计写「后摇 100ms/6f」⇒ 差 −4 拍 ⇒ 登记）', () => {
    const w = makeWorld()
    const r = readRoll(w, { locked: true })
    expect(r.started, '这一记侧步真的出去了').toBe(true)
    expect(r.iframeLast, '无敌窗的最后一拍（设计写的是 16f）').toBe(16)
    expect(r.lockTicks, '从无敌窗结束到「手又能动」之间的拍数（设计 §5.5 那一行写的是 100ms/6f ⇒ 真读数只有 2 拍 ＝ 33ms ⇒ 只量不裁）').toBe(2)
  })

  it('腿③ 空中翻滚：体力价与地面那一滚**一模一样**（设计写的是 8 ⇒ 那一格没有承载体）＋ 总时长 30 拍 ⇒ 登记', () => {
    const ground = makeWorld()
    const g = readRoll(ground)
    const air = makeWorld()
    const a = readRoll(air, { airborne: true })
    expect(g.staminaCost, '地面那一滚付的体力（自由翻滚那一格）').toBe(14)
    expect(a.started, '空中那一滚真的滚出去了（运行时没有「空中翻滚」这一式 ⇒ 走的是自由翻滚那一格）').toBe(true)
    expect(a.staminaCost, '空中那一滚付的体力（**与地面那一滚一模一样** ⇒ 设计 §5.5「空中翻滚」那一行写的 8 点**没有承载体** ⇒ 只量不裁）').toBe(g.staminaCost)
    expect(a.rollTotal, '空中那一滚的总时长（拍）（设计写的是「恢复锁 200ms」）').toBe(30)
  })

  it('腿④ 空中翻滚落地：玩家的血**一点没少** ⇒ 「落地后 0-150ms 免摔落伤」那一格要么没有承载体，要么这件事本身还不存在 ⇒ 登记', () => {
    const w = makeWorld()
    const p = w.player
    const hp0 = p.stats.hp
    w.frame.edges.add('jump')
    w.tick()
    w.frame.edges.delete('jump')
    for (let i = 0; i < 120 && p.grounded; i++) w.tick()
    // 在空中滚一次，再落地
    w.frame.edges.add('dodge')
    w.tick()
    w.frame.edges.delete('dodge')
    for (let i = 0; i < 120 && (p.roll || !p.grounded); i++) w.tick()
    for (let i = 0; i < 30; i++) w.tick()
    expect(p.stats.hp, '从高处落下（中途还滚了一次）之后，掉的血量（设计 §5.5「空中翻滚」那一行写着「落地后 0-150ms 免摔落伤」⇒ **这个游戏里没有摔落伤** ⇒ 那一格免的不是不存在的东西）').toBe(hp0)
  })

  it('腿⑤ 攻击插槽的机制侧：槽位键是 **`bar:beatInBar:招式拍`**，前两段是**领用时**的小节与拍位 ⇒ 那一行运行时没守住（KI-247 已登记）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -2.0 }, 'probe')
    e.alertness = 100
    e.enter('combat')
    const seen: Array<{ key: string; bar: number; beatInBar: number }> = []
    for (let i = 0; i < 900; i++) {
      w.tick()
      for (const key of w.ai.armedSlots) {
        if (seen.some((s) => s.key === key)) continue
        const info = w.rhythm.info()
        seen.push({ key, bar: info.bar, beatInBar: info.beatInBar })
      }
    }
    expect(seen.length, '敌人出手时领到的槽位（次数随 AI 的自由决策变 ⇒ 只当下界用）').toBeGreaterThanOrEqual(1)
    for (const s of seen) {
      expect(s.key, '槽位键的形状是 `bar:beatInBar:招式拍`').toMatch(/^\d+:\d+:[\d.]+$/)
      expect(`${s.bar}:${s.beatInBar}`, '**键的前两段就是领用那一刻的小节与拍位**（⇒ 它算的是「领用时的拍位」，不是「落点那一拍」⇒ 设计那一行「同小节同拍位最多 1 个敌人发动命中帧」在运行时没守住，KI-247 已登记）').toBe(s.key.split(':').slice(0, 2).join(':'))
    }
  })
})
