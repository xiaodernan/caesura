import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import { Rng } from '@/core/Math'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'

/**
 * 悬钟骑士（需求 §59 自动化玩法流 / docs/combat.md §14.7 野外精英）。
 * 夹具口径与 phantome.test 相同（`rhythm.update(TICK_DT)` + 每 tick `time.reset()`）：
 * 本文件三条机制里有两条挂在**小节网格**上（敲钟自鸣的 4 小节软计时器、二连的拍 1→拍 2），
 * 拍钟若被 hitStop 拖慢，测出来的就不再是玩家实际面对的时序。
 */

registerGameData()

/** 84 BPM：一拍 = 42.857 tick；4/4 一小节 = 171.43 tick */
const BEAT = (60 / 84) * TICK_HZ
const BAR = BEAT * 4
const ms = (ticks: number): number => Math.round((ticks / TICK_HZ) * 1000)

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const greatsword = registry.get<WeaponData>('wp_fortissimo_greatsword')
  const player = new PlayerController(playerBase, greatsword, msOf(greatsword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const hits: Array<{ victimId: string; damage: number; backstab: boolean }> = []
  const sfx: string[] = []
  const notifies: string[] = []
  const calls: Array<{ fromId: string; range: number }> = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push({ victimId: p.victimId, damage: p.damage, backstab: p.backstab })),
    bus.on('audio.sfx', (p) => sfx.push(p.key)),
    bus.on('ui.notify', (p) => notifies.push(p.text)),
    bus.on('ai.callAlly', (p) => calls.push({ fromId: p.fromId, range: p.range }))
  ]

  /** 一个逻辑 tick；`each` 跑在各系统之后 ⇒ 读到的就是本 tick 它们写过/用过的状态 */
  function tick(n = 1, each?: () => void): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      each?.()
      rhythm.update(TICK_DT)
    }
  }

  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, hits, sfx, notifies, calls, off }
}
type W = ReturnType<typeof makeWorld>

function knight(w: W, x: number, z: number, seed = 'knight'): Enemy {
  return w.ai.spawn('en_hanged_knight', { x, y: 0, z }, seed)
}

/** 站定不还手：把变量收敛到「这一刀从哪个方向来」「读条有没有断」这两件事上 */
function pin(e: Enemy): void {
  e.stats.crumpleTicksLeft = 600
  e.enter('recover')
}

/** 玩家站到「从 it 的朝向偏 offDeg 的射线」上，距离 dist（甲只认 ±arc/2 那个锥） */
function standAt(w: W, e: Enemy, dist: number, offDeg = 0): void {
  const a = e.yaw + (offDeg * Math.PI) / 180
  w.player.pos.x = e.pos.x + Math.sin(a) * dist
  w.player.pos.z = e.pos.z + Math.cos(a) * dist
  w.player.pos.y = e.pos.y
  w.player.yaw = Math.atan2(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)
}

/**
 * 打实一记并拿回伤害数字。方差只来自 `combat.rng` 的一次 float() ⇒ 每次出手前把种子
 * 摆回同一点，于是「同一记、只差朝向」的两次数可以严格比（0.6 就是 0.6，不用套区间）。
 */
function strike(w: W, e: Enemy, key: 'l1' | 'charged', offDeg = 0): number | null {
  pin(e)
  standAt(w, e, 3, offDeg)
  w.combat.rng = new Rng('elite-variance')
  w.player.stats.stamina = 100
  w.player.action = null
  w.player.roll = null
  if (!w.player.tryStartAction(key, w.time.tick, w.rhythm)) throw new Error(`出招失败：${key}`)
  const seen = w.hits.length
  for (let i = 0; i < 110; i++) {
    w.tick()
    const fresh = w.hits.slice(seen).find((h) => h.victimId === e.id)
    if (fresh) return fresh.damage
    if (!w.player.action) break
  }
  return null
}

/** 真打起来：玩家血槽拉到不会死，被测的是它的时序而不是玩家的续航 */
function engage(w: W, e: Enemy): void {
  w.player.stats.hpMax = 99999
  w.player.stats.hp = 99999
  e.alertness = 100
  e.enter('combat')
}

/** 跑到第 everyBars 小节之后，沿途记录每次自鸣读条的开始 tick */
function watchTolls(w: W, e: Enemy, ticks: number, onStart?: (e: Enemy) => void): number[] {
  const started: number[] = []
  let tolling = false
  w.tick(ticks, () => {
    const now = e.attack?.spec.id === e.data.ai.selfToll!.attackId
    if (now && !tolling) {
      started.push(w.time.tick)
      onStart?.(e)
    }
    tolling = now
  })
  return started
}

describe('数据表：§14.7 的每一格都在 enemies.json 里，帧数换算回毫秒仍对得上', () => {
  const d = registry.get<EnemyData>('en_hanged_knight')

  it('骨架：elite / 320 血 / 80 架势 / 2.6m/s', () => {
    expect(d.archetype).toBe('elite')
    expect(d.hp).toBe(320)
    expect(d.poise).toBe(80)
    expect(d.speed).toBe(2.6)
  })

  it('钟锤二连 450/120/300 + 350/120/350：拍 1 打完自己量化到拍 2', () => {
    const [a, b] = d.attacks
    expect(a.id).toBe('bellswing1')
    // 450/120/300ms 换算到 60fps：27 / 7 / 18 tick（帧是整数，117ms 就是最接近 120 的那一帧）
    expect([a.frames.startup, a.frames.activeEnd - a.frames.activeStart + 1, a.frames.recovery - a.frames.activeEnd] as const)
      .toEqual([27, 7, 18])
    expect([ms(a.frames.startup), ms(a.frames.recovery - a.frames.activeEnd)] as const).toEqual([450, 300])
    expect(a.frames.damage).toBe(22)
    expect(a.beat).toEqual([1])
    expect(a.frames.next, '二段靠 4-D 的派生字段接，不在 AI 里写死连段').toBe('bellswing2')
    expect(b.id).toBe('bellswing2')
    expect([b.frames.startup, b.frames.activeEnd - b.frames.activeStart + 1, b.frames.recovery - b.frames.activeEnd] as const)
      .toEqual([21, 7, 21])
    expect([ms(b.frames.startup), ms(b.frames.recovery - b.frames.activeEnd)] as const).toEqual([350, 350])
    expect(b.frames.damage).toBe(24)
    expect(b.beat).toEqual([2])
    expect(b.parryStunTicks, '弹反第二段 → 钟体共振 2s').toBe(120)
    expect(a.parryStunTicks, '那份回报只在第二段').toBeUndefined()
  })

  it('荡钟横扫 600/200/450、30 伤 R3 不可弹反；钟鸣警戒=25m / 1.2s 读条', () => {
    const sway = d.attacks.find((a) => a.id === 'sway')!
    expect([sway.frames.startup, sway.frames.activeEnd - sway.frames.activeStart + 1, sway.frames.recovery - sway.frames.activeEnd] as const)
      .toEqual([36, 12, 27])
    expect([ms(sway.frames.startup), ms(sway.frames.recovery - sway.frames.activeEnd)] as const).toEqual([600, 450])
    expect(sway.frames.damage).toBe(30)
    expect(sway.reaction).toBe('R3')
    expect(sway.parryable, '环刃横扫弹不了').toBe(false)
    expect(sway.frames.hitbox, 'r=3m 的弧线').toEqual({ shape: 'ring', inner: 0.6, outer: 3, forward: 0 })
    expect(d.ai.callAlly, '警戒复用既有 CallAlly 通道').toEqual({ range: 25, broadcastTicks: 72 })
  })

  it('钟甲与自鸣全在表里：正面 60° 吃 40%、每 4 小节敲一次回 15', () => {
    expect(d.ai.armorFront).toEqual({ arcDeg: 60, dmgMul: 0.6 })
    expect(d.ai.selfToll).toEqual({ everyBars: 4, attackId: 'toll', heal: 15 })
    const toll = d.attacks.find((a) => a.id === 'toll')!
    expect(toll.frames.damage, '这一招不打人').toBe(0)
    expect(toll.parryable).toBe(false)
    expect(ms(toll.frames.startup), '前摇 ≥1.4s，够玩家跑过去打断').toBeGreaterThanOrEqual(1400)
  })
})

describe('机制 a「钟甲」：只有从正面锥里打进来的那一笔被吃掉', () => {
  it('正面 = 侧面的 0.6 倍（同一方差种子，只有朝向不同）', () => {
    const w = makeWorld()
    const e = knight(w, 0, -3)
    e.stats.damage(80) // 别把「没打上」误读成减伤
    const front = strike(w, e, 'l1', 0)
    const side = strike(w, e, 'l1', 90)
    expect(front, '正面那一记确实打上了').not.toBeNull()
    expect(side, '侧面那一记确实打上了').not.toBeNull()
    expect(front!).toBeLessThan(side!)
    expect(front! / side!).toBeCloseTo(0.6, 1)
    w.off()
  })

  it('锥是 60°（±30°）：偏 20° 仍在甲里，偏 45° 出锥', () => {
    const w = makeWorld()
    const e = knight(w, 0, -3)
    e.stats.damage(80)
    const headOn = strike(w, e, 'l1', 0)
    const inside = strike(w, e, 'l1', 20)
    const outside = strike(w, e, 'l1', 45)
    expect(inside, '20° 还在 30° 半角内 ⇒ 与正面同数').toBe(headOn)
    expect(outside, '45° 出锥 ⇒ 全额').toBeGreaterThan(inside!)
    w.off()
  })

  it('震裂满层碎甲：之后正面与侧面严格相等，且不会自己长回来', () => {
    const w = makeWorld()
    const e = knight(w, 0, -3)
    e.stats.damage(120)
    const armored = strike(w, e, 'l1', 0)
    expect(e.armorBroken, '普通命中不碎甲').toBe(false)
    e.stats.fissureLayers = 3
    strike(w, e, 'charged', 0) // charged 自带 3 层 ⇒ 6 层满 ⇒ 碎裂
    expect(e.armorBroken, '满层碎裂把甲一起带走').toBe(true)
    expect(w.notifies.some((t) => t.includes('钟甲碎裂'))).toBe(true)
    const side = strike(w, e, 'l1', 90)
    const frontAgain = strike(w, e, 'l1', 0)
    expect(frontAgain, '碎甲之后同一记不再打折').toBe(side)
    expect(frontAgain!).toBeGreaterThan(armored!)
    w.off()
  })

  it('处决不吃钟甲：它按生命比例结算，是「读通状态」的奖励而不是又一次减伤计算', () => {
    const w = makeWorld()
    const e = knight(w, 0, -3)
    e.stats.damage(200)
    pin(e)
    standAt(w, e, 1.4)
    const expected = Math.round(e.stats.hpMax * playerBase.execution.hpFrac) + playerBase.execution.flat
    const before = e.stats.hp
    w.frame.edges.add('interact')
    w.tick(2)
    expect(w.player.executing, '崩直位 + 处决键 = 抓住').not.toBeNull()
    expect(before - e.stats.hp, '正面甲完全不参与这一笔').toBe(expected)
    w.off()
  })
})

describe('机制 b「弹反第二段 = 钟体共振」', () => {
  /** 把它摆进指定招式的前摇末段，在命中帧前给玩家弹反窗，再看结果 */
  function parryItsStrike(w: W, e: Enemy, id: string): void {
    const spec = e.data.attacks.find((a) => a.id === id)!
    standAt(w, e, 1.6, 0)
    e.attack = { spec, tick: spec.frames.startup - 6, hitDone: false, shots: 0, lungeApplied: 0 }
    for (let i = 0; i < 20; i++) {
      const a = e.attack
      if (a && a.tick === a.spec.frames.startup - 2) w.player.parryTicksLeft = w.player.base.parry.activeTicks
      w.tick()
      if (!e.attack) return
    }
    throw new Error(`没能弹反 ${id}`)
  }

  it('第二段被弹反：眩晕 120 tick（2s）+ 读条作废 + 零伤', () => {
    const w = makeWorld()
    const e = knight(w, 0, -3)
    engage(w, e)
    const hp = w.player.stats.hp
    parryItsStrike(w, e, 'bellswing2')
    expect(e.stunTicks).toBe(120)
    expect(w.notifies.some((t) => t.includes('钟体共振'))).toBe(true)
    expect(w.player.stats.hp, '弹反=零伤').toBe(hp)
    w.off()
  })

  it('第一段被弹反：只有通用 18 tick —— 回报是数据，不是所有弹反都白送两秒', () => {
    const w = makeWorld()
    const e = knight(w, 0, -3)
    engage(w, e)
    parryItsStrike(w, e, 'bellswing1')
    expect(e.stunTicks).toBe(18)
    expect(w.notifies.some((t) => t.includes('钟体共振'))).toBe(false)
    w.off()
  })
})

describe('机制 c「敲钟自鸣」：必须打断的软计时器', () => {
  it('第 4 小节自己开唱，走完前摇回 15 点、响一声大钟', () => {
    const w = makeWorld()
    const e = knight(w, 0, -2.4)
    engage(w, e)
    e.stats.damage(120)
    const before = e.stats.hp
    const started = watchTolls(w, e, Math.round(BAR * 4) + 600)
    expect(started.length, '到点就敲，不等 RNG 挑到它').toBeGreaterThanOrEqual(1)
    expect(e.stats.hp - before, '走完了 ⇒ +15').toBeGreaterThanOrEqual(15)
    expect(w.sfx.filter((k) => k === 'bell_toll').length).toBeGreaterThan(0)
    expect(w.notifies.some((t) => t.includes('敲钟自鸣'))).toBe(true)
    w.off()
  })

  it('前摇里砍它一刀（走 strikeEnemy 那条打断通道）：读条作废，一分不回、钟也不响', () => {
    const w = makeWorld()
    const e = knight(w, 0, -2.4)
    engage(w, e)
    e.stats.damage(120)
    const before = e.stats.hp
    let cut = false
    const started = watchTolls(w, e, Math.round(BAR * 4) + 600, (en) => {
      if (cut) return
      cut = true
      en.interruptBroadcast(w.time.tick) // 玩家命中时 strikeEnemy 无条件调的就是这一句
    })
    expect(started.length, '它确实开唱过').toBeGreaterThanOrEqual(1)
    expect(cut).toBe(true)
    expect(e.stats.hp, '打断=一分没回').toBe(before)
    expect(w.sfx.filter((k) => k === 'bell_toll'), '没敲响').toHaveLength(0)
    w.off()
  })

  it('另一条打断通道也不能漏：读条被硬直/破势抹掉时，那口挂起的气息一起作废', () => {
    // `attack = null` 不只来自玩家那一刀（stun、recover、走调时刻、处决都会直接清）。
    // 若挂起的读条后事不一起作废，它会在**下一招**的起手帧上偷偷生效——回 15 血、钟还响一声。
    const w = makeWorld()
    const e = knight(w, 0, -2.4)
    engage(w, e)
    e.stats.damage(120)
    const hp0 = Math.round(e.stats.hp)
    const bells0 = w.sfx.filter((k) => k === 'bell_toll').length
    let stunned = false
    const started = watchTolls(w, e, Math.round(BAR * 4) + 600, (en) => {
      if (stunned) return
      stunned = true
      en.stunTicks = 30 // 走 stun 那条路：下一 tick `attack` 归零，但没经过 interruptBroadcast
    })
    expect(started.length, '它开过读条').toBeGreaterThanOrEqual(1)
    w.tick(400) // 够它醒来再打完整一记二连（起手帧 27 —— 气息若还挂着就在这里生效）
    expect(Math.round(e.stats.hp), '一分没回').toBe(hp0)
    expect(w.sfx.filter((k) => k === 'bell_toll').length, '钟一声没响').toBe(bells0)
    w.off()
  })

  it('它是节拍器而不是随机冷却：1900 tick 里两次，间隔落在 4~6 小节', () => {
    const w = makeWorld()
    const e = knight(w, 0, -2.4)
    engage(w, e)
    e.stats.damage(300)
    const started = watchTolls(w, e, 1900)
    expect(started, '两个四小节周期 ⇒ 两次').toHaveLength(2)
    const gap = started[1] - started[0]
    expect(gap, '周期是 4 小节的小节网格；手上那招没打完 ⇒ 排队顺延，最多到 6 小节').toBeGreaterThanOrEqual(BAR * 4 - 1)
    expect(gap).toBeLessThanOrEqual(BAR * 6)
    w.off()
  })

  it('满血时它不敲（计时器照常推进，掉了血下一个周期补上）', () => {
    const w = makeWorld()
    const e = knight(w, 0, -2.4)
    engage(w, e)
    expect(watchTolls(w, e, Math.round(BAR * 4) + 600), '满血没人敲钟').toHaveLength(0)
    e.stats.damage(60)
    expect(watchTolls(w, e, Math.round(BAR * 4) + 600).length, '掉了血就补上').toBeGreaterThanOrEqual(1)
    w.off()
  })
})

describe('钟鸣警戒：叫人是既有 CallAlly 通道的又一次复用', () => {
  /** 停在「惊而未动」的窗口里——这正是 §14.7 警戒阶段的语义，之后它才会去拉响 */
  function holdAlert(w: W, e: Enemy, ticks: number, onCast?: (e: Enemy) => void): void {
    w.tick(ticks, () => {
      e.alertness = 90
      if (e.attack?.spec.id === 'callAlly' && e.inStartup) onCast?.(e)
    })
  }

  it('alert 态里它把 25m 的同伴叫醒', () => {
    const w = makeWorld()
    const e = knight(w, 0, -14)
    // 同伴离玩家 15m（>嘈壳的 12m 视觉），所以它被叫醒只可能是被广播叫来的
    const ally = w.ai.spawn('en_murkshell', { x: 6, y: 0, z: -14 }, 'ally')
    const farAlly = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -45 }, 'far')
    e.enter('alert')
    let woke = false
    for (let i = 0; i < 40 && !woke; i++) {
      holdAlert(w, e, 36)
      woke = w.calls.some((c) => c.fromId === e.id)
    }
    expect(woke, '1.2s 读条走完 ⇒ 广播发出').toBe(true)
    expect(w.calls.find((c) => c.fromId === e.id)!.range, '25m 来自表').toBe(25)
    expect(ally.state, '同伴被叫起来赶路了（而不是自己看见了玩家）').toBe('chase')
    expect(ally.alertness, '被叫来就是满警觉（之后按既有曲线衰减）').toBeGreaterThan(90)
    expect(farAlly.alertness, '31m 外不在 25m 广播里 ⇒ 还在睡').toBeLessThan(60)
    expect(farAlly.state).not.toBe('chase')
    w.off()
  }, 20000)

  it('读条中被打断就一声传不出去（同伴不会被叫醒）', () => {
    const w = makeWorld()
    const e = knight(w, 0, -6)
    const ally = w.ai.spawn('en_murkshell', { x: 6, y: 0, z: -6 }, 'ally')
    e.enter('alert')
    let interrupted = false
    for (let i = 0; i < 40 && !interrupted; i++) {
      holdAlert(w, e, 36, (en) => {
        if (!interrupted) {
          interrupted = true
          en.interruptBroadcast(w.time.tick)
        }
      })
    }
    expect(interrupted, '它开过读条').toBe(true)
    expect(w.calls.filter((c) => c.fromId === e.id), '但一声没传出去').toHaveLength(0)
    expect(ally.state, '同伴还在原地').not.toBe('alert')
    w.off()
  }, 20000)
})
