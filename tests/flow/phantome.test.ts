import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, FrameData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'

/**
 * 幽灵八 Phantome（需求 §59 自动化玩法流 / docs/combat.md §14.5「拍隙实体切换」）。
 *
 * 与 support.test 唯一的夹具差别是有意的：这里 `rhythm.update(TICK_DT)` 且每 tick `time.reset()`。
 * GameTime.hitStop 把 time.dt 压到 5%，若拍钟跟着 time.dt 走，一次命中就会让「帧表位置」和
 * 「拍网格」永久错位——而本机制的全部正确性都建立在那条对应关系上。表现层该被 hitstop 拖慢
 * （main.ts 用 time.dt 推音乐），逻辑层的相位不该。这条分工记在 docs/technical-architecture.md。
 */

registerGameData()

type Hit = { attackerId: string; victimId: string; damage: number; result: string }

/** 84 BPM：一拍 = 42.857 tick */
const BT = (60 / 84) * TICK_HZ

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const spear = registry.get<WeaponData>('wp_drawpin_spear')
  const player = new PlayerController(playerBase, spear, msOf(spear))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const hits: Hit[] = []
  const vfx: string[] = []
  const notifies: string[] = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push(p as unknown as Hit)),
    bus.on('vfx.request', (p) => vfx.push(p.key)),
    bus.on('ui.notify', (p) => notifies.push(p.text))
  ]

  /** 一个逻辑 tick。`each` 在拍钟推进之前跑 ⇒ 它读到的相位就是本 tick 各系统用过的相位 */
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

  const equip = (id: string): void => {
    const w = registry.get<WeaponData>(id)
    player.equip(w, msOf(w))
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, equip, hits, vfx, notifies, off }
}
type W = ReturnType<typeof makeWorld>

function ghost(w: W, x: number, z: number, seed = 'ghost'): Enemy {
  return w.ai.spawn('en_phantome', { x, y: 0, z }, seed)
}

/** 命中层用例专用：钉在 recover（站定、清空 attack），把变量收敛到「相位」这一条 */
function pin(e: Enemy): void {
  e.stats.crumpleTicksLeft = 600
  e.enter('recover')
}

/** 绕开随机选招：直接把敌人摆进某招的某一帧 */
function force(e: Enemy, id: string, tickIn = 0): void {
  const spec = e.data.attacks.find((a) => a.id === id)!
  e.attack = newAttack(spec, tickIn)
  e.enter('combat')
}

/** 离最近的「半拍网格」有多远（tick）。§2.1 要求敌人的时间单位踩在拍点/半拍点上 */

/** 按下轻击那一 tick action.tick 已经是 1 ⇒ 判定窗中心在 press + (start+end)/2 - 1 */
const windowCenter = (f: FrameData): number => (f.activeStart + f.activeEnd) / 2 - 1

/** 若此刻按下轻击，判定窗中心离最近拍点有多少 tick（0 = 正踩拍点，21.4 = 正踩半拍） */
function windowPhase(w: W, center: number): number {
  const at = (w.rhythm.beat * BT + center) % BT
  return Math.min(at, BT - at)
}

/** 空跑到「这一记的判定窗正踩拍点（beat）/ 正踩半拍（and）」那一帧，并在该帧按下轻击 */
function swingAt(w: W, where: 'beat' | 'and'): void {
  const c = windowCenter(w.player.moveset.actions.l1)
  for (let g = 0; g < 120; g++) {
    const d = windowPhase(w, c)
    if (where === 'beat' ? d <= 3 : d >= BT / 2 - 1.5) {
      w.frame.edges.add('attackLight')
      w.tick()
      return
    }
    w.tick()
  }
  throw new Error('等不到目标相位')
}

/**
 * 推到「下一 tick 必然在隐形段（hidden=true）/ 必然在实体段」那一帧，并在该帧按下这些键。
 * 隐形侧要求 d ≤ 窗宽−4：按键帧本身在窗内，之后还能再撑 3 tick（弹体那条用例要连续几帧穿过）；
 * 实体侧要求 d ≥ 窗宽+2：下一帧最差是窗宽+1，仍在窗外。keys 传空数组＝纯等相位。
 */
function actAt(w: W, e: Enemy, hidden: boolean, keys: string[], extra?: () => boolean): void {
  const win = e.data.ai.beatGhost!.intangibleWindowTicks
  for (let g = 0; g < 200; g++) {
    let fire = false
    w.tick(1, () => {
      const d = w.rhythm.ticksFromBeatPoint()
      const phaseOk = hidden ? e.intangible && d <= win - 4 : !e.intangible && d >= win + 2
      fire = phaseOk && (extra ? extra() : true)
    })
    if (fire) {
      for (const k of keys) w.frame.edges.add(k)
      w.tick()
      return
    }
  }
  throw new Error(`等不到${hidden ? '隐形' : '实体'}段的按键帧`)
}

describe('§14.5 数据表：反相是一列拍位，不是一段 if', () => {
  const d = (): EnemyData => registry.get<EnemyData>('en_phantome')

  it('刺客位：80 血 / 24 韧 / 4.2 速，无防御也无弱点（硬碰硬不是解）', () => {
    const e = d()
    expect(e.archetype).toBe('assassin')
    expect(e.hp).toBe(80)
    expect(e.poise).toBe(24)
    expect(e.speed).toBeCloseTo(4.2, 5)
    expect(e.defense ?? 0).toBe(0)
    expect(e.weakpoint).toBeUndefined()
  })

  it('三招全部只在 .5 拍出手＝与全场反相；隐形窗 12 tick 略窄于 §2.1 的 ±208ms 容差', () => {
    const e = d()
    for (const a of e.attacks) expect(a.beat, `${a.id} 的拍位`).toEqual([1.5, 2.5, 3.5, 4.5])
    const g = e.ai.beatGhost!
    expect(g.intangibleWindowTicks).toBe(12)
    expect(2 * g.intangibleWindowTicks / BT, '一拍里约 56% 的时间它不在').toBeCloseTo(0.56, 2)
    expect(g.intangibleWindowTicks, '窗口比踩点容差(12.5 tick)窄，玩家才读得出来').toBeLessThanOrEqual(13)
  })

  it('synco2 不在任何距离带里：只能由 synco1 的 next 派生到达，且不可弹反', () => {
    const e = d()
    const reachable = e.ai.distBands.flatMap((b) => b.actions)
    expect(reachable).toEqual(['backcut', 'synco1', 'chase'])
    expect(reachable).not.toContain('synco2')
    expect(e.attacks.find((a) => a.id === 'synco1')!.frames.next).toBe('synco2')
    expect(e.attacks.find((a) => a.id === 'synco2')!.parryable, '二段只能靠相位解法对付').toBe(false)
  })

  it('斩击带闷音 4s：时长写在招式层', () => {
    expect(d().attacks.find((a) => a.id === 'backcut')!.statusOnHit)
      .toMatchObject({ tag: 'status.mute', ticks: 240 })
  })
})

describe('相位本体：intangible 是拍点的纯函数', () => {
  it('每一 tick 都满足 intangible ⇔「离最近拍点 ≤ 12 tick」，占比 ≈ 58%', () => {
    const w = makeWorld()
    const e = ghost(w, 0, -40) // 40m：超出 hearing 18m，排除任何显形干扰
    let hidden = 0
    w.tick(180, () => {
      expect(e.intangible).toBe(w.rhythm.ticksFromBeatPoint() <= 12)
      if (e.intangible) hidden++
    })
    // 窗口是 ≤12 的闭区间 ⇒ 一拍的 42.857 tick 里被采到 25 tick
    expect(hidden / 180).toBeCloseTo(25 / BT, 2)
    w.off()
  })

  it('隐形段一步都不走，实体段照常逼近（「仅半拍窗内位移」）', () => {
    const w = makeWorld()
    const e = ghost(w, 0, -12)
    e.alertness = 100
    e.enter('chase')
    let prev = { x: e.pos.x, z: e.pos.z }
    let hiddenMove = 0
    let visibleMove = 0
    w.tick(120, () => {
      const d = Math.hypot(e.pos.x - prev.x, e.pos.z - prev.z)
      if (e.intangible) hiddenMove += d
      else visibleMove += d
      prev = { x: e.pos.x, z: e.pos.z }
    })
    expect(hiddenMove, '拍点上的位移必须严格为 0').toBe(0)
    expect(visibleMove, '否则这条断言可以靠“它根本不动”蒙过去').toBeGreaterThan(1)
    w.off()
  })
})

describe('命中层：刃穿过拍隙，实体段照样吃打', () => {
  it('判定窗正踩拍点：不掉血、不占目标名额，只留一圈“穿过”回声（每记挥击一次）', () => {
    const w = makeWorld()
    const e = ghost(w, 0, 3.2) // 引针枪触达 = 3.2 + 0.506
    w.player.yaw = 0
    pin(e)
    const hp0 = e.stats.hp
    swingAt(w, 'beat')
    w.tick(40)
    expect(e.stats.hp).toBe(hp0)
    expect(w.hits.filter((h) => h.victimId === e.id)).toHaveLength(0)
    expect(w.vfx.filter((k) => k === 'ring_echo'), '几何确实重叠：证据不能是“打空”').toHaveLength(1)
    w.off()
  })

  it('同一记挥击挪到半拍上：立刻打得着（掉血 + combat.hit，且不再有穿过提示）', () => {
    const w = makeWorld()
    const e = ghost(w, 0, 3.2)
    w.player.yaw = 0
    pin(e)
    const hp0 = e.stats.hp
    swingAt(w, 'and')
    w.tick(40)
    expect(w.hits.some((h) => h.victimId === e.id && h.result === 'hit'),
      'spear l1 判定窗＝press+15..20，正落在实体段').toBe(true)
    expect(e.stats.hp).toBeLessThan(hp0)
    expect(w.vfx.filter((k) => k === 'ring_echo')).toHaveLength(0)
    w.off()
  })

  it('弹体从它身上穿过：不消耗、不掉血；它一显形，同一发弹体就命中', () => {
    const w = makeWorld()
    const e = ghost(w, 0, -6)
    pin(e)
    const hp0 = e.stats.hp
    // 只在隐形段「中途」放弹体：段外的实体帧它会合法命中，那样这条用例什么也没证明
    actAt(w, e, true, [])
    const pr = w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: 0, y: 1.1, z: -6 }, dir: { x: 0, y: 0, z: 1 },
      speed: 0.02, range: 60, radius: 1.2, damage: 9, poise: 4, hitStopMs: 0
    }, w.time.tick)
    for (let i = 0; i < 3; i++) {
      let hiddenNow = false
      w.tick(1, () => { hiddenNow = e.intangible })
      expect(hiddenNow, `第 ${i} tick 仍在隐形段`).toBe(true)
      expect(pr.dead, '穿过＝不消耗').toBe(false)
    }
    expect(e.stats.hp).toBe(hp0)
    bus.emit('sound.source', { id: 'player', pos: { x: 0, y: 0, z: -6 }, loudness: 0.9 })
    w.tick(6)
    expect(e.revealTicks, '180 − 已过的 tick：时长来自表而非硬编码').toBeGreaterThan(170)
    expect(e.stats.hp).toBeLessThan(hp0)
    expect(pr.dead).toBe(true)
    w.off()
  })
})

describe('解法 a「伪拍点声源」：够响的一声就把它从拍隙里震出来', () => {
  it('阈值 0.6 卡在潜行武器与重音武器之间（响度一律由武器/招式表算出）', () => {
    const g = registry.get<EnemyData>('en_phantome').ai.beatGhost!
    const loudOf = (wid: string, key: string): number => {
      const wp = registry.get<WeaponData>(wid)
      const f = registry.get<MovesetData>(`moveset:${wp.movesetId}`).actions[key]!
      return ((f.loudness ?? 3) / 10) * (wp.noiseMul ?? 1)
    }
    expect(loudOf('wp_drawpin_spear', 'charged'), '引针枪最响的一下也惊不动它').toBeLessThan(g.fakeBeatLoudness)
    expect(loudOf('wp_tuning_sword', 'l1'), '调律剑轻击＝潜行位').toBeLessThan(g.fakeBeatLoudness)
    expect(loudOf('wp_tuning_sword', 'charged'), '调律剑蓄力＝已经够响').toBeGreaterThanOrEqual(g.fakeBeatLoudness)
    expect(loudOf('wp_fortissimo_greatsword', 'l1'), '强音大剑＝起手就响').toBeGreaterThanOrEqual(g.fakeBeatLoudness)
  })

  it('太轻、太远、它自己出的声都不算；一到阈值就是整 180 tick', () => {
    const w = makeWorld()
    const e = ghost(w, 0, -14)
    const g = e.data.ai.beatGhost!
    const src = (id: string, loudness: number, z = -14): void => {
      bus.emit('sound.source', { id, pos: { x: 0, y: 0, z }, loudness })
    }
    src('player', g.fakeBeatLoudness - 0.1)
    expect(e.revealTicks, '低于阈值：不惊动').toBe(0)
    src('player', g.fakeBeatLoudness, -14 - 20)
    expect(e.revealTicks, `超出 hearing.range(${e.data.ai.hearing.range}m)`).toBe(0)
    src(e.id, 1)
    expect(e.revealTicks, '自己的动静不算一个伪拍点').toBe(0)
    src('player', g.fakeBeatLoudness)
    expect(e.revealTicks).toBe(g.fakeBeatRevealTicks)
    w.tick(1)
    expect(e.revealTicks, '每 tick 衰减 1').toBe(g.fakeBeatRevealTicks - 1)
    w.off()
  })

  it('拎强音大剑砍正踩拍点的那一记：刀风先把它震出来，同一记就不再穿过', () => {
    const w = makeWorld()
    w.equip('wp_fortissimo_greatsword')
    const e = ghost(w, 0, 3.2)
    w.player.yaw = 0
    pin(e)
    const hp0 = e.stats.hp
    swingAt(w, 'beat') // 同样的相位，换成枪就是穿过
    w.tick(60)
    expect(e.revealTicks, '挥击自身即声源 ⇒ 起手那一 tick 就显形').toBeGreaterThan(0)
    expect(e.stats.hp).toBeLessThan(hp0)
    expect(w.vfx.filter((k) => k === 'ring_echo'), '一次都没穿过').toHaveLength(0)
    w.off()
  })
})

describe('解法 b「拍点闪避」：在它的前摇里踩上拍点', () => {
  it('前摇 + 拍点 + 够得着：显形 60、定身 60、读条作废，并且显形期间相位失效', () => {
    const w = makeWorld()
    const e = ghost(w, 0, 1.5)
    e.alertness = 100
    force(e, 'backcut', -20)
    actAt(w, e, true, ['dodge'], () => !!e.attack && e.inStartup)
    w.tick(2)
    const g = e.data.ai.beatGhost!
    expect(e.revealTicks, 'dodgeRevealTicks − 已过 2 tick').toBe(g.dodgeRevealTicks - 2)
    expect(e.stunTicks, 'dodgeStunTicks − 已过 2 tick').toBe(g.dodgeStunTicks - 2)
    expect(e.attack, '正在读条的招式被打断').toBeNull()
    expect(w.notifies.some((t) => t.includes('拍点闪避'))).toBe(true)
    expect(w.vfx.filter((k) => k === 'parry_ring').length).toBeGreaterThan(0)

    let checked = false
    for (let i = 0; i < 60 && !checked; i++) {
      w.tick(1, () => {
        if (w.rhythm.ticksFromBeatPoint() <= 12) {
          expect(e.intangible, '显形窗内踩在拍点上也不免伤').toBe(false)
          checked = true
        }
      })
    }
    expect(checked, '60 tick 显形窗覆盖到了一整个隐形窗').toBe(true)
    w.off()
  })

  it('同一种情形但闪避落在实体段：什么都没有（这是节奏奖励，不是翻滚免疫）', () => {
    const w = makeWorld()
    const e = ghost(w, 0, 1.5)
    e.alertness = 100
    force(e, 'backcut', -20)
    actAt(w, e, false, ['dodge'], () => !!e.attack && e.inStartup)
    w.tick(2)
    expect(e.revealTicks).toBe(0)
    expect(e.stunTicks).toBe(0)
    expect(e.attack, '读条继续').not.toBeNull()
    expect(w.notifies.some((t) => t.includes('拍点闪避'))).toBe(false)
    w.off()
  })

  it('前摇在招式的 reach 之外：抓拍不成立（reach 用它自己那条 hitbox 算）', () => {
    const w = makeWorld()
    const e = ghost(w, 0, -8) // backcut 锥 r2.1 + 玩家 0.4
    e.alertness = 100
    force(e, 'backcut', -20)
    actAt(w, e, true, ['dodge'], () => !!e.attack && e.inStartup)
    w.tick(2)
    expect(e.revealTicks, '2.5m 的触达够不到 8m 外的它').toBe(0)
    expect(e.stunTicks).toBe(0)
    w.off()
  })
})

describe('相位与「抓不住」：处决、真 AI 的时序、以及切分连段', () => {
  it('背刺位摆在它身后：隐形段同一键什么都没抓到，实体段一键见血', () => {
    const w = makeWorld()
    const e = ghost(w, 0, 1.5) // 它在玩家身后、面朝 +z（背对玩家）
    e.yaw = 0
    e.alertness = 0
    e.stats.hp = e.stats.hpMax * 0.3 // 潜行处决的血线门槛（无鸣批加了 HP≤stealthKillFrac 的判据；默认 0.35）
    actAt(w, e, true, ['interact'])
    expect(w.player.executing, '抓不住一个不在那里的东西').toBeNull()
    expect(e.stats.hp).toBe(e.stats.hpMax * 0.3)
    actAt(w, e, false, ['interact'])
    w.tick(2)
    expect(w.player.executing, '同一位置、同一按键，实体段就抓得住').not.toBeNull()
    expect(e.stats.hp).toBeLessThan(e.stats.hpMax)
    w.off()
  })

  it('真 AI（不 force）排出来的那一记：命中帧精确踩在 .5 拍网格上，而那个位置她是实体的', () => {
    const w = makeWorld()
    const e = ghost(w, 0, 1.8)
    e.alertness = 100
    e.enter('chase')
    let gridErr = Infinity
    let hitFrames = 0
    let hitWhileHidden = 0
    w.tick(200, () => {
      const a = e.attack
      if (!a) return
      const f = a.spec.frames
      if (a.tick === f.activeStart) gridErr = Math.min(gridErr, w.rhythm.offsetFromBeatGrid(a.spec.beat))
      if (a.tick >= f.activeStart && a.tick <= f.activeEnd) {
        hitFrames++
        if (e.intangible) hitWhileHidden++
      }
    })
    expect(hitFrames, '这 200 tick 里它真的打过一记').toBeGreaterThan(0)
    expect(gridErr, '§2.1 的 ±50ms 容差：量化后误差 <1 tick = 16.7ms').toBeLessThanOrEqual(1)
    // §14.5 的正解（4-D 曾把它读反，见 technical-architecture §5.9.3 的更正）：
    // 她的命中帧落在 and 位——那正是她**实体**的窗口。她「打不着」靠的是拍点上的定身+半透明，
    // 不是「从隐形段里伸出一刀」；隐形段里她连动都不能动。
    expect(hitWhileHidden, '隐形段里她既不能动也不该出手').toBe(0)
    w.off()
  })
  it('synco1 → synco2：派生段量化到下一个半拍位，两段之间留下约半拍呼吸（§13.1 惩罚窗口）', () => {
    const w = makeWorld()
    const e = ghost(w, 0, -60) // 摆远：只看帧序列，不让它打到人
    force(e, 'synco1', 0)
    const order: string[] = []
    const startErr: number[] = []
    let rest = -1
    let prev = ''
    w.tick(200, () => {
      const a = e.attack
      if (!a) return
      if (!order.includes(a.spec.id)) order.push(a.spec.id)
      // 量的是**命中帧**落在网格上（§2.1），不是起手帧——起手按设计就是提前一整个前摇
      if (a.tick === a.spec.frames.activeStart && a.spec.id !== 'synco1') startErr.push(w.rhythm.offsetFromBeatGrid(a.spec.beat))
      if (prev === 'synco1' && a.spec.id === 'synco2' && a.tick < 0) rest = a.spec.frames.activeStart - a.tick
      prev = a.spec.id
    })
    expect(order, '第一段之后自己接出第二段').toEqual(['synco1', 'synco2'])
    expect(rest, '两段之间 ≈ 半拍（不是同拍硬顶）').toBeGreaterThanOrEqual(10)
    expect(startErr.length, '派生段的收势帧被观察到了').toBeGreaterThan(0)
    expect(Math.max(...startErr), '派生段（真 AI 排出来的那一记）命中帧精确踩在自己的拍网格上').toBeLessThanOrEqual(1)
    expect(e.attack, '连段有尽头：不会无限踏下去').toBeNull()
    w.off()
  })
})

/**
 * KI-016 缺口①：敌人近战招式过去**根本不发声**（active 帧只出 hitbox），
 * 所以「噪音越大越容易暴露相位」这条 §14.5 的规则对敌人之间完全不生效——
 * 设计原本指望的「驼鼓踏地顺手把幽灵八震出来」在实机里是空的（tech-arch 那段
 * 「一个被代码推翻的假设」记的就是这件事）。下面这几条不再由测试自己 `bus.emit`，
 * 全部走真招式的帧推进，把这条规则钉回可观察的事实。
 */
describe('敌人自己响：近战 active 帧接入 sound.source（KI-016 缺口①）', () => {
  /**
   * 只收「这一招自己」报出来的声：同一只怪在观察窗内可能接着出第二招，
   * 按招式名过滤才能让"一招收一次"这条断言不被邻居招式污染。
   * 声源事件不带招式 id，所以读的是发射那一刻它手上的招式。
   */
  function noiseOf(e: Enemy, attackId: string): { levels: number[]; off: () => void } {
    const levels: number[] = []
    const off = bus.on('sound.source', (s) => { if (s.id === e.id && e.attack?.spec.id === attackId) levels.push(s.loudness) })
    return { levels, off }
  }
  const g = registry.get<EnemyData>('en_phantome').ai.beatGhost!

  it('驼鼓踏地的 active 那一帧把它震出来：不需要谁替它 emit', () => {
    const w = makeWorld()
    const drum = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -3 }, 'drum')
    const e = ghost(w, 0, -9) // 两者相距 6m < hearing.range(18)
    const stomp = drum.data.attacks.find((a) => a.id === 'stomp')!
    expect((stomp.frames.loudness ?? 0) / 10, '这条用例的前提：踏地够响').toBeGreaterThanOrEqual(g.fakeBeatLoudness)
    expect(e.revealTicks).toBe(0)
    force(drum, 'stomp', stomp.frames.activeStart - 1)
    w.tick(1)
    expect(e.revealTicks, '0.8 的一次落地就是一个伪拍点 ⇒ 整 180 tick（同一 tick 它自己已衰一格）')
      .toBeGreaterThanOrEqual(g.fakeBeatRevealTicks - 1)
    w.off()
  })

  it('嘈壳撕咬（响度 0.2）不惊动它：补的是缺口，不是一条免死金牌', () => {
    const w = makeWorld()
    const shell = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -3 }, 'shell')
    const e = ghost(w, 0, -6)
    const bite = shell.data.attacks.find((a) => a.id === 'bite')!
    expect((bite.frames.loudness ?? 0) / 10).toBeLessThan(g.fakeBeatLoudness)
    force(shell, 'bite', bite.frames.activeStart - 1)
    w.tick(2)
    expect(e.revealTicks).toBe(0)
    w.off()
  })

  it('一记挥击只报一声（跨过 activeStart 只成立一次，收势段不会再响）', () => {
    const w = makeWorld()
    const drum = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -3 }, 'drum')
    const mallet = drum.data.attacks.find((a) => a.id === 'mallet')!
    const { levels, off } = noiseOf(drum, 'mallet')
    force(drum, 'mallet', -1)
    w.tick(mallet.frames.startup + mallet.frames.recovery + 20) // 覆盖前摇→判定→收势整段
    expect(levels, `整招只该有一声，实测 ${levels.length} 声`).toHaveLength(1)
    expect(levels[0]).toBeCloseTo((mallet.frames.loudness ?? 0) / 10, 5)
    off()
    w.off()
  })

  it('弹道招式不在 active 帧再响一遍（发射那一声归 CombatManager）', () => {
    const w = makeWorld()
    const sn = w.ai.spawn('en_skewer', { x: 0, y: 0, z: -9 }, 'sniper')
    const tri = sn.data.attacks.find((a) => a.id === 'tri')!
    expect(tri.frames.projectile, '前提：这是弹道招').toBeTruthy()
    const { levels, off } = noiseOf(sn, 'tri')
    force(sn, 'tri', -1)
    w.tick(tri.frames.startup + tri.frames.recovery + 60)
    const shots = tri.frames.projectile!.burst?.count ?? 1
    expect(shots, '三叠箭：这条断言要非平凡才成立').toBe(3)
    expect(levels.length, `发几声响几下（表里 count=${shots}），active 帧不加戏`).toBe(shots)
    off()
    w.off()
  })

  it('敌人之间的动静不给玩家拉仇恨：声源流只让「玩家的声音」进 perception', () => {
    const w = makeWorld()
    const drum = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -3 }, 'drum')
    const witness = w.ai.spawn('en_murkshell', { x: 1.5, y: 0, z: -3 }, 'witness') // 就站在踏地旁边
    witness.enter('idle')
    const stomp = drum.data.attacks.find((a) => a.id === 'stomp')!
    force(drum, 'stomp', stomp.frames.activeStart - 1)
    w.tick(2)
    expect(witness.alertness, '0.8 的一脚踩在耳边，也不该替玩家暴露位置').toBe(0)
    w.off()
  })

  it('读条招式（悬钟骑士敲钟自鸣）只响一次，响度来自招式表而不是代码里那个 0.9', () => {
    const w = makeWorld()
    const k = w.ai.spawn('en_hanged_knight', { x: 0, y: 0, z: -4 }, 'knight')
    k.skipIntro()
    k.alertness = 100
    k.enter('combat') // 自鸣是**交战时**的软计时器：不把它拉进 combat，等到的只是巡逻
    const e = ghost(w, 0, -9)
    const toll = k.data.attacks.find((a) => a.id === 'toll')!
    const { levels, off } = noiseOf(k, 'toll')
    let sawToll = false
    for (let i = 0; i < 1400 && !sawToll; i++) {
      w.player.stats.hp = w.player.stats.hpMax // 它是量具，不是对手
      // 钉在半血：满血时这条软计时器**故意**不演（`heal > 0 && hp >= hpMax` 就跳过），
      // 顶满血测出来的"没演"是设计，不是 bug——所以这里要给它一个演下去的理由。
      k.stats.hp = Math.floor(k.stats.hpMax / 2)
      w.tick(1, () => { if (k.attack?.spec.id === 'toll') sawToll = true })
    }
    expect(sawToll, '1400 tick 内没等到自鸣（everyBars=4 ≈ 686 tick 一响）').toBe(true)
    for (let i = 0; i < 200; i++) { // 走完读条（activeStart=90）再越过收势，看有没有第二声
      w.player.stats.hp = w.player.stats.hpMax
      k.stats.hp = Math.max(k.stats.hp, Math.floor(k.stats.hpMax / 2)) // 半血起跳：让回血真发生，但不顶满
      w.tick(1)
    }
    expect(levels, `自鸣这一招只该报一声，实测 ${levels.length}`).toHaveLength(1)
    expect(levels[0], 'frames.loudness=9 ⇒ 0.9（改前是代码里写死的那个数）').toBeCloseTo((toll.frames.loudness ?? 0) / 10, 5)
    expect(e.revealTicks, '这一嗓子同样是一次伪拍点').toBeGreaterThan(0)
    off()
    w.off()
  })
})
