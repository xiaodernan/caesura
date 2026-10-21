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
import { bus } from '@/core/EventBus'

/**
 * KI-249：**§5.5「翻滚 Roll 与侧步 Sidestep」那张表剩下的几格第一次在真链上被量**。
 *
 * | 前/侧/后翻滚 | 500ms/30f | **Active 段 150-350ms（9-21f，共 12f=200ms）** | 3.2m（后向 2.6m） | 14 | 后摇 150ms/9f |
 * | 锁定侧步 | 300ms/18f | 100-267ms（4-16f，共 10f=167ms） | 1.6m 切线 | 10 | 后摇 100ms/6f |
 * | **节拍联动** | **i-frame 起点即拍点时（±50ms），翻滚后 0.4s 内下一次攻击架势 +2（"错拍步法"，高手向隐性奖励）** | | | | |
 *
 * KI-192／KI-223／KI-090 已经量过这一族里的位移／体力／后摇／冲刺终止几格；
 * 这一批量**两处 i-frame 窗**与**「节拍联动」那一行**。
 *
 * **读数**：翻滚每一拍的无敌状态（`PlayerController.iFrame`）——第一拍与最后一拍，以及**为真的那些拍数**；
 * 「节拍联动」那一行则读「滚完之后的下一记，架式涨没涨」（敌人身上的架式累积 `Enemy.stats.poiseAccum`）。
 *
 * **拍相位必须钉住**（KI-243 立的纪律）：i-frame 起点是不是落在拍点上，要先把拍相位冻住再算。
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

/** 滚一次，逐拍记下无敌状态（第一拍／最后一拍／为真的拍数） */
function rollAndWatch(w: World): { first: number; last: number; count: number; ticks: number[] } {
  const ticks: number[] = []
  let first = -1
  let last = -1
  let count = 0
  w.frame.edges.add('dodge')
  w.tick()
  w.frame.edges.delete('dodge')
  for (let i = 0; i < 60; i++) {
    if (w.player.roll) {
      ticks.push(w.player.roll.tick)
      if (w.player.iFrame) {
        count++
        if (first < 0) first = w.player.roll.tick
        last = w.player.roll.tick
      }
    }
    w.tick()
    if (!w.player.roll && i > 2) break
  }
  return { first, last, count, ticks }
}

/**
 * 滚完之后的下一记轻击，**事件报出来的架式数**。
 *
 * 读的是 `combat.hit` 的 `poiseDamage` 那一格（它就是架式底数 ＋ 落地加成那一项），
 * 不是敌人身上攒的数 ⇒ ⇒ **不受「拍点上 ×2」「敌人前摇 ×1.5」那两个乘数干扰**
 * （那两个乘数都加在**实际记账**上，不加在这一格上）⇒ 这一格只回答「翻滚给没给加成」。
 */
function poiseAfterRoll(w: World): number {
  const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'probe')
  e.alertness = 0
  e.enter('idle')
  const p = w.player
  p.pos = { x: 0, y: 0, z: 0 }
  p.yaw = Math.PI
  p.camYawRef = Math.PI + p.yaw
  let reported = -1
  const off = bus.on('combat.hit', (p2: any) => {
    if (p2.attackerId === 'player' && p2.victimId === e.id) reported = p2.poiseDamage
  })
  w.frame.edges.add('dodge')
  w.tick()
  w.frame.edges.delete('dodge')
  for (let i = 0; i < 60 && p.roll; i++) w.tick()
  // 滚完人已经位移过了 ⇒ 把敌人摆到**滚完之后**的身前 1.6m，这一记才够得着它
  e.pos = { x: p.pos.x, y: 0, z: p.pos.z - 1.6 }
  p.yaw = Math.PI
  p.camYawRef = Math.PI + p.yaw
  w.frame.edges.add('attackLight')
  w.tick()
  w.frame.edges.delete('attackLight')
  for (let i = 0; i < 90 && reported < 0; i++) w.tick()
  off()
  return reported
}

describe('KI-249 §5.5 那张表剩下的几格：两处 i-frame 窗 ＋ 「节拍联动」那一行', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 自由翻滚的 i-frame 窗：9–21f ⇒ 为真的拍数是 13（设计写「共 12f=200ms」）⇒ 登记', () => {
    const w = makeWorld()
    const r = rollAndWatch(w)
    expect(r.first, '无敌从这一拍开始（设计 §5.5 那一行写的是 9f）').toBe(9)
    expect(r.last, '无敌到这一拍为止（设计 §5.5 那一行写的是 21f）').toBe(21)
    expect(r.count, '无敌为真的**拍数**（设计写的是「共 12f=200ms」⇒ 真读数多一拍 ＝ 216.7ms ⇒ 只量不裁）').toBe(13)
  })

  it('腿② 锁定侧步的 i-frame 窗：4–16f ⇒ 为真的拍数是 13（设计写「共 10f=167ms」）⇒ 登记', () => {
    const w = makeWorld()
    // 锁定态：滚出去的是「锁定侧步」那一格（`rollProfile(locked)` 那条分支）
    w.player.lockedTarget = { getPos: () => ({ x: 0, y: 0, z: -3 }), radius: 2 }
    const r = rollAndWatch(w)
    expect(r.first, '无敌从这一拍开始（设计 §5.5 那一行写的是 4f）').toBe(4)
    expect(r.last, '无敌到这一拍为止（设计 §5.5 那一行写的是 16f）').toBe(16)
    expect(r.count, '无敌为真的**拍数**（设计写的是「共 10f=167ms」⇒ 真读数是 13 拍 ＝ 216.7ms ⇒ 只量不裁）').toBe(13)
  })

  it('腿③ 翻滚之后的那一记，架式**没有**多（设计 §5.5「节拍联动」那一行在运行时没有承载体 ⇒ 登记）', () => {
    const w = makeWorld()
    const poise = poiseAfterRoll(w)
    expect(poise, '滚完之后的下一记轻击，**事件报出来的架式数**（直剑 L1 的底数 6；设计写的是「翻滚后 0.4s 内下一次攻击架势 +2」⇒ 真读数里**没有那一档** ⇒ 只量不裁）').toBe(6)
  })

  it('腿④ **i-frame 起点落在拍点上**的那一滚，架式**照样**没有多 ⇒ 「i-frame 起点即拍点时（±50ms）」这个条件没有任何东西读它 ⇒ 登记', () => {
    const w = makeWorld()
    // 把拍相位冻在拍点上（相位 ≈ 0）⇒ 那一滚的 i-frame 起点（滚起手 +9 拍）正压在拍点上
    for (let i = 0; i < 200; i++) {
      if (Math.abs(w.rhythm.info().phase) < 0.012) break
      w.tick()
    }
    w.rhythm.paused = true
    const phase = w.rhythm.info().phase
    const poise = poiseAfterRoll(w)
    expect(phase, '这一滚的 i-frame 起点落在拍点上（设计的容差是 ±50ms ＝ ±0.07 拍）').toBeLessThan(0.07)
    expect(poise, '**踩着拍点滚**之后的那一记，架式还是底数（⇒ 那一行的拍点条件在运行时没有承载体）').toBe(6)
  })
})
