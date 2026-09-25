import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, msToTicks } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, reactions } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'

/**
 * KI-022① + KI-052③：§15.2 给恩希尔写了三阶，数据里只有两阶 —— 今天补上 Finale 过载期，
 * 并把「Boss 不吃逐式硬直」这条免疫从**身份级**降级成**阶段级**。
 *
 * 三条腿各自钉住那一格新数据：
 * - `bpm`：全场网格由**这一阶**接管（§15.2「网格加速至 120BPM」）。读者是 `AISystem.syncClock`，
 *   所以量的也是它——玩家听到的网格，不是她身上的一个字段。
 * - `startupMul`：前摇缩短（0.8 ⇒ 每 tick 多走 1/4 帧），但**判定窗与收势一拍不短**：
 *   "更早落刀"不该顺手换来更长的破绽窗，那是两件事。
 * - `interruptOnHit`：R2/R3 的来袭档位在这一阶真的能打断她；**位移仍然免疫**——
 *   她的走位是断音柱/撞钟这类场地机关的输入，把她推出场地不是"DPS 竞速爽段"的意思。
 *   R1 仍然收不掉她：那一档连普通敌人的近战前摇都不打断（§8 R1 那一行）。
 */

registerGameData()

const HERSIL = 'en_hersil'

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hpMax = 9_999_999
  player.stats.hp = 9_999_999
  player.stats.poiseMax = 9_999_999
  player.stats.stamina = 100
  const hits: Array<{ victimId: string; result: string }> = []
  const sfx: string[] = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push({ victimId: p.victimId, result: p.result })),
    bus.on('audio.sfx', (p) => sfx.push(p.key)),
  ]
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
  /** 把她放进指定血线，并让阶段机真的跑一跑（syncBoss 在 update 里） */
  function hersilAt(hpFrac: number, seed = 'finale'): Enemy {
    const e = ai.spawn(HERSIL, { x: 0, y: 0, z: -12 }, seed)
    e.skipIntro()
    e.alertness = 100
    e.enter('combat')
    e.stats.poiseMax = 1e9
    e.stats.crumpleTicks = 1e9
    e.stats.damage(Math.round(e.stats.hpMax * (1 - hpFrac)))
    e.stats.hp = Math.round(e.stats.hpMax * hpFrac)
    tick(2)
    return e
  }
  const standAt = (e: Enemy, dist = 1.6): void => {
    player.pos.x = e.pos.x
    player.pos.z = e.pos.z + dist
    player.pos.y = e.pos.y
    player.yaw = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
  }
  /** 玩家对他出一记重击（kind=heavy ⇒ 默认档 R2），返回命中那一刻他身上的读数 */
  function strikeH(e: Enemy): { landed: boolean; stun: number; moved: number; attackGone: boolean } {
    // 硬直是命中那一 tick 挂上的，而"作废那一式"发生在下一 tick 的 `stunTicks > 0` 那一支
    // ⇒ 先就地读 stun/位移，再走两格才读 attack。
    standAt(e)
    e.stunTicks = 0
    player.action = null
    player.roll = null
    player.stunTicks = 0
    player.stats.stamina = 100
    expect(player.tryStartAction('h', time.tick, rhythm), '玩家这一记要真的出去').toBe(true)
    let stun = 0
    let moved = 0
    let attackGone = false
    const seen = hits.length
    let landed = false
    let attackAtHit: unknown = null
    for (let i = 0; i < 120 && !landed; i++) {
      const b = { x: e.pos.x, z: e.pos.z }
      // 她自己也在出招，会反过来把玩家那一记打断；这一段把她钉在 idle，
      // 被测的才是"挨这一下之后她身上多了什么"（她的式子是调用方摆好的，不受影响）
      e.alertness = 0
      e.enter('idle') // 她不再前进自己的式子，玩家也不会被她先一步打中而中断出手
      tick(1, () => {
        if (landed) return
        if (!hits.slice(seen).some((h) => h.victimId === e.id && h.result === 'hit')) return
        landed = true
        stun = e.stunTicks
        moved = Math.hypot(e.pos.x - b.x, e.pos.z - b.z)
        attackAtHit = e.attack
      })
    }
    if (landed) { tick(2); attackGone = e.attack === null }
    void attackAtHit
    return { landed, stun, moved, attackGone }
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, hersilAt, strikeH, standAt, hits, sfx, off }
}

const phases = () => registry.get<EnemyData>(HERSIL).boss?.phases ?? []

describe('KI-022① 表：§15.2 的第三阶终于齐了，而且每一格都有读者', () => {
  it('Finale 在 25% 血线接管：120BPM、前摇 ×0.8、受击即断', () => {
    const fin = phases()[2]
    expect(phases().map((p) => p.id), '三阶（§16「每 Boss 恰 2 或 3 阶段」）').toEqual(['registr', 'stealthebeat', 'finale'])
    expect(fin.belowHpFrac, '§15.2「Finale 过载期 <25%」').toBe(0.25)
    expect(fin.bpm, '§15.2「网格加速至 120BPM」').toBe(120)
    expect(fin.startupMul, '§15.2「攻击前摇 -20%」').toBe(0.8)
    expect(fin.interruptOnHit, '§15.2「受击即断（R2 可打断全部招）」').toBe(true)
    expect(fin.attacks.join(), '阶段换的是行为不是数值（§16）')
      .not.toEqual(phases()[1].attacks.join())
  })

  it('血线一掉过 25% 就进 Finale，而且阶段单调不会回退（血回满也不回去）', () => {
    const w = makeWorld()
    const e = w.hersilAt(0.3)
    expect(e.bossPhase, '30% 还在夺拍那一阶').toBe(1)
    e.stats.hp = Math.round(e.stats.hpMax * 0.2)
    w.tick(2)
    expect(e.bossPhase).toBe(2)
    e.stats.hp = e.stats.hpMax
    w.tick(2)
    expect(e.bossPhase, '§16：阶段是单调的，回血不许把她送回 P1').toBe(2)
    w.off()
  })
})

describe('KI-022① 阶段级拍速：全场网格跟着她过载（不是她一个人的事）', () => {
  it('夺拍那一阶 92BPM、Finale 那一阶 120BPM —— 读的是 rhythm，不是数据字段', () => {
    const w = makeWorld()
    const p2 = w.hersilAt(0.4, 'clock-p2')
    expect(p2.bossPhase, '前提：这一阶是夺拍').toBe(1)
    expect(w.rhythm.bpm, 'boss.bpm 的身份级接管照旧成立').toBe(92)
    p2.stats.hp = Math.round(p2.stats.hpMax * 0.2)
    w.tick(2)
    expect(p2.bossPhase, '前提：已经进 Finale').toBe(2)
    expect(w.rhythm.bpm, '§15.2「网格加速至 120BPM」没有读者 ⇒ 只是注释').toBe(120)
    w.off()
  })

  it('改表就改行为：finale.bpm 150 ⇒ 全场 150；还原回 120', () => {
    const fin = phases()[2]
    const saved = fin.bpm
    fin.bpm = 150
    try {
      const w = makeWorld()
      const e = w.hersilAt(0.2, 'mut-bpm')
      expect(e.bossPhase).toBe(2)
      expect(w.rhythm.bpm, '改了表却没改网格 ⇒ 120 还写死在别处').toBe(150)
      w.off()
    } finally {
      fin.bpm = saved
    }
    expect(phases()[2].bpm).toBe(120)
  })

  it('她不在了就还回区域基准拍：阶段级 override 不能变成永久状态', () => {
    const w = makeWorld()
    const e = w.hersilAt(0.2, 'release')
    expect(w.rhythm.bpm).toBe(120)
    e.enter('idle')
    e.alertness = 0
    w.tick(2)
    expect(w.rhythm.bpm, '脱战 ⇒ 归还（§23 的接管是有期限的）').toBe(84)
    w.off()
  })
})

describe('KI-022① 前摇倍率：更早落刀，但破绽窗一样长', () => {
  /** 从招式起手数到跨过 activeStart，再数判定窗里的 tick 数 */
  function startupSpan(w: ReturnType<typeof makeWorld>, e: Enemy, attackId: string): { toActive: number; window: number } {
    const spec = e.data.attacks.find((a) => a.id === attackId)!
    const mine = newAttack(spec, 0)
    e.attack = mine
    let toActive = -1
    let window = 0
    for (let i = 0; i < 90; i++) {
      // 招式只在 combat/attack 里推进；把她钉回 combat，测的才是"同一式走了几格"
      e.enter('combat')
      const was = mine.tick >= spec.frames.activeStart
      w.tick(1)
      if (e.attack !== mine) break
      if (!was && mine.tick >= spec.frames.activeStart) toActive = i + 1
      if (mine.tick >= spec.frames.activeStart && mine.tick <= spec.frames.activeEnd) window++
      if (mine.tick >= spec.frames.activeEnd) break
    }
    return { toActive, window }
  }

  it('同一记 noBeatLunge2：Finale 里前摇 15 tick（P2 是 18），判定窗仍是 7 tick', () => {
    const a = makeWorld()
    const p2 = a.hersilAt(0.4, 'mul-p2')
    const before = startupSpan(a, p2, 'noBeatLunge2')
    a.off()
    const b = makeWorld()
    const p3 = b.hersilAt(0.2, 'mul-p3')
    const after = startupSpan(b, p3, 'noBeatLunge2')
    a.off(); b.off()
    expect(before.toActive, 'P2 的起手就是帧表那个数').toBe(18)
    expect(after.toActive, '§15.2「前摇 -20%」：18 × 0.8 = 14.4 ⇒ 15 帧（整数 tick 向上取整）').toBe(15)
    expect(after.window, '判定窗被一起缩短 ⇒ "更早落刀"变成了"更多无敌帧之外的收益"').toBe(before.window)
    expect(after.window, '窗口 = activeEnd - activeStart + 1（帧表自己说的）').toBe(
      p3.data.attacks.find((x) => x.id === 'noBeatLunge2')!.frames.activeEnd
      - p3.data.attacks.find((x) => x.id === 'noBeatLunge2')!.frames.activeStart + 1)
  })

  it('起手音在加速下仍然响，而且一式只响一次（旧判定 `tick === 0` 会被跨过去）', () => {
    const w = makeWorld()
    const e = w.hersilAt(0.2, 'sfx')
    const spec = e.data.attacks.find((a) => a.id === 'noBeatLunge2')!
    w.sfx.length = 0
    e.attack = newAttack(spec, 0)
    w.tick(24)
    const heard = w.sfx.filter((k) => k === 'thrust_1').length
    w.off()
    expect(heard, '前摇音要么没发、要么一式响两次——两者都是玩家听见的假信息').toBe(1)
  })
})

describe('KI-052③ 受击即断：Boss 的免疫现在是阶段属性，不再是身份属性', () => {
  it('夺拍那一阶照旧打不断她；Finale 里同一记重击把那一式收掉', () => {
    const a = makeWorld()
    const p2 = a.hersilAt(0.4, 'cut-p2')
    // 全奏的读条有 469 帧：量具窗口之内她绝不会真的落刀，"被打断"读的就是这一式还在不在
    p2.attack = newAttack(p2.data.attacks.find((x) => x.id === 'tutti')!, 20)
    const before = a.strikeH(p2)
    expect(before.landed, '重击没落 her 身上：这条在量空气').toBe(true)
    expect(before.stun, 'P2 不该被这一刀打断（背谱判据仍然成立）').toBe(0)
    a.off()

    const b = makeWorld()
    const p3 = b.hersilAt(0.2, 'cut-p3')
    p3.attack = newAttack(p3.data.attacks.find((x) => x.id === 'tutti')!, 20)
    const after = b.strikeH(p3)
    expect(after.landed).toBe(true)
    expect(after.stun, '§15.2「受击即断（R2 可打断全部招）」没有承载体').toBe(msToTicks(reactions.R2.stunMs))
    expect(after.attackGone, '硬直挂上了，那一式却没作废 ⇒ 打不断还是打不断').toBe(true)
    b.off()
  })

  it('位置免疫不撤：两阶里同一记重击都推不动她（她的走位是场地机关的输入）', () => {
    const data = registry.get<EnemyData>(HERSIL)
    const savedSpeed = data.speed
    data.speed = 0 // 量具：她自己那一步（speed×dt）会混进位移读数，先把脚钉住
    try {
      for (const [frac, label] of [[0.4, '夺拍'], [0.2, 'Finale']] as const) {
        const w = makeWorld()
        const e = w.hersilAt(frac, `pos-${label}`)
        e.attack = newAttack(e.data.attacks.find((x) => x.id === 'tutti')!, 20)
        const r = w.strikeH(e)
        expect(r.landed, `${label} 那一记没落 her 身上`).toBe(true)
        expect(r.attackGone, '位置免疫不等于招式免疫：这一阶她的式子该被收掉').toBe(frac === 0.2)
        expect(r.moved, `${label} 那一阶把她推离断音柱/钟，不是"可打断"的意思`).toBeCloseTo(0, 9)
        w.off()
      }
    } finally {
      data.speed = savedSpeed
    }
    expect(registry.get<EnemyData>(HERSIL).speed, '量具不动生产数据').toBe(2.2)
  })

  it('R1 仍然收不掉 Finale 里的她：阶段撤的是更强的那几档，不是全部', () => {
    const w = makeWorld()
    const e = w.hersilAt(0.2, 'r1')
    const fin = phases()[2]
    const saved = fin.attacks.join()
    // kind=light ⇒ 默认档 R1。R1 那一行写的是"不打断重击与蓄力"，对 Boss 更不该收她的式。
    e.attack = newAttack(e.data.attacks.find((x) => x.id === 'noBeatLunge2')!, 2)
    w.standAt(e)
    w.player.stats.stamina = 100
    w.player.action = null
    expect(w.player.tryStartAction('l1', w.time.tick, w.rhythm)).toBe(true)
    const seen = w.hits.length
    let stun = -1
    for (let i = 0; i < 80 && stun < 0; i++) {
      w.tick(1, () => {
        if (stun >= 0) return
        if (w.hits.slice(seen).some((h) => h.victimId === e.id && h.result === 'hit')) stun = e.stunTicks
      })
    }
    expect(stun, '轻击就能打断过载期的 Boss ⇒ §8 R1 那一行被读宽了').toBe(0)
    expect(saved).not.toBe('')
    w.off()
  })
})
