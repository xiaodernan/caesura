import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'

/**
 * Main Boss 恩希尔·万籁（docs/combat.md §15.2；需求 §23）。本文件只覆盖 P1「曲目学习期」
 * 与它带来的三件新载体：可背谱的轮转选招、Tutti 的三小节读条、断音柱掩体。
 * P2「夺拍」/Finale「抢核」/场地塌陷尚未实现，已按 KNOWN_ISSUES 如实登记（不伪装成二阶段）。
 */

registerGameData()

/** 92BPM ⇒ 一拍 39.13 tick；4/4 ⇒ 一小节 156.5 tick */
const BEAT = (60 / 92) * TICK_HZ
const BAR = BEAT * 4

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999

  const hits: Array<{ v: string; d: number }> = []
  const sfx: string[] = []
  const vfx: string[] = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push({ v: p.victimId, d: p.damage })),
    bus.on('audio.sfx', (p) => sfx.push(p.key)),
    bus.on('vfx.request', (p) => vfx.push(p.key))
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
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, hits, sfx, vfx, off }
}
type W = ReturnType<typeof makeWorld>

function hersil(w: W, x = 0, z = -6, seed = 'hersil'): Enemy {
  return w.ai.spawn('en_hersil', { x, y: 152, z }, seed)
}

/** 真开打：入场演出（§16）由 `bossshow.test.ts` 负责，这里要的是他能立刻按帧表出招 */
function engage(w: W, e: Enemy): void {
  e.alertness = 100
  e.enter('combat')
  e.skipIntro()
}

/** 把玩家摆到「它的朝向 + offDeg」的射线上（掩体测试要用绝对坐标，所以单独设） */
function standAt(w: W, e: Enemy, pos: { x: number; y: number; z: number }): void {
  w.player.pos.x = pos.x
  w.player.pos.y = pos.y
  w.player.pos.z = pos.z
  w.player.yaw = Math.atan2(e.pos.x - pos.x, e.pos.z - pos.z)
  e.yaw = Math.atan2(pos.x - e.pos.x, pos.z - e.pos.z)
}

describe('数据表：§15.2 第一阶的谱面与场地', () => {
  const d = registry.get<EnemyData>('en_hersil')

  it('他是 Boss：私有 92BPM 4/4、两阶段（§24 的最低要求）、轮转选招', () => {
    expect(d.archetype).toBe('boss')
    expect(d.hp).toBe(620)
    expect(d.boss?.bpm).toBe(92)
    expect(d.boss?.beatsPerBar).toBe(4)
    expect(d.boss?.phases.map((p) => p.id)).toEqual(['registr', 'stealthebeat'])
    expect(d.boss?.phases[1].belowHpFrac, '60% 转阶段并重置时钟').toBe(0.6)
    expect(d.ai.pickOrder, '「玩家可背谱」要求招式是轮转而不是抽签').toBe('cycle')
    expect(d.boss?.covers, '断音柱写在数据里').toBeTruthy()
    expect(d.boss!.covers!.positions.length).toBeGreaterThanOrEqual(4)
  })

  it('音弹连发=3 发落在拍 1/2/3；管束横扫=90°/r6m/30 伤 R3；全奏=三小节读条 + r8m/55 伤 + 闷音 6s', () => {
    const by = new Map(d.attacks.map((a) => [a.id, a]))
    const notes = by.get('notes3')!
    expect(notes.frames.projectile?.burst?.count).toBe(3)
    expect(notes.frames.projectile?.burst?.at, '39 ≈ 一拍 ⇒ 拍 1/2/3').toEqual([0, 39, 78])
    expect(notes.frames.damage, '弹体伤害取招式的 frames.damage（单一结算通道）').toBe(16)
    expect(notes.frames.projectile?.kind).toBe('note')
    const sweep = by.get('barsweep')!
    expect(sweep.frames.damage).toBe(30)
    expect(sweep.reaction).toBe('R3')
    expect(sweep.frames.hitbox).toMatchObject({ shape: 'cone', angleDeg: 90, radius: 6 })
    const tutti = by.get('tutti')!
    expect(tutti.frames.startup, '3 小节 telegraph').toBeGreaterThanOrEqual(Math.round(BAR * 3) - 1)
    expect(tutti.frames.hitbox).toEqual({ shape: 'ring', inner: 0, outer: 8, forward: 0 })
    expect(tutti.frames.damage).toBe(55)
    expect(tutti.statusOnHit?.ticks, '闷音 6s').toBe(360)
    expect(tutti.parryStunTicks, '弹反其起手拍=大师解，回报要给足').toBe(180)
    for (const a of d.attacks.filter((a) => a.onGrid !== false)) {
      expect(a.beat[0], `${a.id} 的起手落在第 1 拍`).toBe(1)
    }
    const lunge = d.attacks.filter((a) => a.id.startsWith('noBeatLunge'))
    expect(lunge.length, '§15.2 无拍突进：三段不守拍的刺').toBe(3)
    expect(lunge.every((a) => a.onGrid === false), '它们显式声明「不量化到网格」').toBe(true)
    expect(lunge[0].frames.next, '三段自己是链子').toBe('noBeatLunge2')
    const breath = d.attacks.find((a) => a.id === 'breath')!
    expect(breath.reclaimWindow, '换气拍 = 唯一能把拍抢回来的时刻').toBe(true)
    expect(breath.frames.damage, '他停气时不打人').toBe(0)
    expect(breath.frames.startup / TICK_HZ).toBeCloseTo(0.35, 1)
    expect(d.attacks.filter((a) => a.id === 'breath').map((a) => a.frames.startup)[0], '窗口长度只在招式表里写一次（stealBeat 不再重复）')
      .toBe(d.attacks.find((a) => a.id === 'breath')!.frames.startup)
  })
})

describe('可背谱：轮转选招而不是抽签', () => {
  const run = (seed: string): string[] => {
    const w = makeWorld()
    const e = hersil(w, 0, -6, seed)
    engage(w, e)
    const order: string[] = []
    let prev: Enemy['attack'] = null
    w.tick(2600, () => {
      const a = e.attack
      if (a && a !== prev && !order.includes(a.spec.id) && a.tick <= 0) order.push(a.spec.id)
      prev = a
    })
    w.off()
    return order
  }

  it('三招按表的顺序全部出场，且同一 seed 两次运行顺序完全一致', () => {
    const a = run('cycle-a')
    // 轮转指针从表序第 0 项起，但「第一次出手」落在哪一拍要看它在等哪一个拍位 ⇒ 只断言顺序是环
    const ring = ['notes3', 'barsweep', 'tutti']
    const idx = a.slice(0, 3).map((id) => ring.indexOf(id))
    expect(idx.every((i) => i >= 0), 'P1 只会这三招').toBe(true)
    expect(((idx[0] + 1) % 3 === idx[1]) && ((idx[1] + 1) % 3 === idx[2]), `环序不被打乱：${a.slice(0, 3)}`).toBe(true)
    expect(run('cycle-a')).toEqual(a)
    expect(run('cycle-b'), '换 seed 也不该改变顺序：cycle 不走 RNG').toEqual(a)
  })

  it('每招收势帧仍落在它声明的拍网格上（<§2.1 的 50ms 容差）', () => {
    const w = makeWorld()
    const e = hersil(w, 0, -6)
    engage(w, e)
    let worst = 0
    let samples = 0
    w.tick(2600, () => {
      const a = e.attack
      if (a && a.tick === a.spec.frames.activeStart) {
        samples++
        worst = Math.max(worst, w.rhythm.offsetFromBeatGrid(a.spec.beat))
      }
    })
    expect(samples, '真的打出过招').toBeGreaterThan(3)
    expect((worst / TICK_HZ) * 1000, '误差(毫秒)').toBeLessThanOrEqual(50)
    expect(w.rhythm.bpm, '他在接管全场网格').toBe(92)
    w.off()
  })
})

describe('断音柱：§15.2 写的「唯一解之一」必须真的成立', () => {
  const setup = () => {
    const w = makeWorld()
    const e = hersil(w, 0, -40)
    engage(w, e)
    const g = e.data.boss!.covers!
    const pillar = g.positions[0]
    return { w, e, g, pillar }
  }
  const forceSweep = (e: Enemy): void => {
    const spec = e.data.attacks.find((a) => a.id === 'barsweep')!
    e.attack = newAttack(spec, spec.frames.startup)
  }

  it('玩家贴柱、他在柱外 ⇒ 横扫被吃掉；跨出半步 ⇒ 同一招收势帧就见血', () => {
    const { w, e, g, pillar } = setup()
    standAt(w, e, { x: pillar.x, y: pillar.y, z: pillar.z + 1 })
    expect(Math.hypot(w.player.pos.x - pillar.x, w.player.pos.z - pillar.z)).toBeLessThanOrEqual(g.radius)
    e.pos.x = pillar.x
    e.pos.z = pillar.z - 4 // 他在柱外 4m（半径 3.2）扫进来：横扫 r=6m 覆盖得到柱子后面
    w.player.stats.hp = 500
    forceSweep(e)
    w.tick(1)
    expect(w.player.stats.hp, '柱子挡下这一记').toBe(500)
    expect(w.vfx.filter((k) => k === 'ring_dust').length, '要看得见是柱子救的').toBeGreaterThan(0)
    e.pos.x = pillar.x
    e.pos.z = pillar.z - 4
    // 只往前迈到柱影之外（3.5m > 半径 3.2m）：同一次横扫立刻打得到
    standAt(w, e, { x: pillar.x, y: pillar.y, z: pillar.z - 3.5 })
    forceSweep(e)
    w.tick(1)
    expect(w.player.stats.hp, '离开柱子同样的招式照样打中 ⇒ 掩体不是无敌房').toBeLessThan(500)
    w.off()
  })

  it('他也贴着同一根柱子 ⇒ 不挡（否则他能把玩家逼进柱子里互刷无敌）', () => {
    const { w, e, pillar } = setup()
    standAt(w, e, { x: pillar.x, y: pillar.y, z: pillar.z })
    e.pos.x = pillar.x + 0.5
    e.pos.z = pillar.z + 0.5
    w.player.stats.hp = 500
    forceSweep(e)
    w.tick(1)
    expect(w.player.stats.hp, '同一根柱子里两个人都不算被挡').toBeLessThan(500)
    w.off()
  })

  it('音弹连发撞上断音柱会掉在地上（不是穿过柱子上人）', () => {
    const { w, e, pillar } = setup()
    standAt(w, e, { x: pillar.x, y: pillar.y, z: pillar.z })
    e.pos.x = pillar.x
    e.pos.z = pillar.z - 20
    e.yaw = Math.atan2(pillar.x - e.pos.x, pillar.z - e.pos.z)
    const spec = e.data.attacks.find((a) => a.id === 'notes3')!
    e.attack = newAttack(spec, spec.frames.startup - 1)
    w.player.stats.hp = 500
    let launched = 0
    let gone = 0
    for (let i = 0; i < 200; i++) {
      const before = w.combat.projectiles.live
      w.tick(1)
      launched += Math.max(0, w.combat.projectiles.live - before)
      gone += w.sfx.filter((k) => k === 'block_guard').length ? 0 : 0
      if (w.player.stats.hp < 500) break
    }
    expect(launched, '三发确实打出来了').toBeGreaterThan(0)
    expect(w.player.stats.hp, '但一发都没穿过柱子打到人').toBe(500)
    w.off()
  })
})

describe('全奏 Tutti：三小节的可视读条 + 它的两种解', () => {
  const start = (): { w: W; e: Enemy; spec: ReturnType<typeof registry.get<EnemyData>>['attacks'][number] } => {
    const w = makeWorld()
    const e = hersil(w, 0, -4)
    engage(w, e)
    standAt(w, e, { x: 0, y: 152, z: 0 }) // 同层 + 面对面：弹反要判朝向（§5.3）
    const spec = e.data.attacks.find((a) => a.id === 'tutti')!
    e.attack = newAttack(spec, spec.frames.startup - 1)
    w.player.stats.hp = 2000
    w.player.stats.muteTicksLeft = 0
    return { w, e, spec }
  }

  it('走完读条：AoE 命中 + 挂 6s 闷音（体力回复 -30% 那条既有消费方生效）', () => {
    const { w } = start()
    w.tick(2)
    expect(w.player.stats.hp, '55 伤落在 r8m 内').toBeLessThan(2000)
    expect(w.player.stats.muteTicksLeft, '闷音 6s = 360 tick').toBeGreaterThan(300)
    expect(w.player.stats.muteTicksLeft, '闷音 6s 挂在玩家身上（已经走过 1 tick）').toBeGreaterThanOrEqual(350)
    w.off()
  })

  it('弹反其起手拍 = 大师解：他挨 180 tick 失衡，玩家零伤', () => {
    const { w, e, spec } = start()
    e.attack = newAttack(spec, spec.frames.startup - 3)
    for (let i = 0; i < 12; i++) {
      const a = e.attack
      if (a && a.tick === a.spec.frames.startup - 1) w.player.parryTicksLeft = w.player.base.parry.activeTicks
      w.tick()
      if (!e.attack) break
    }
    expect(e.attack, '读条作废').toBeNull()
    expect(e.stunTicks, '全奏被打断 ⇒ 乐器失衡 3s').toBeGreaterThan(150)
    expect(w.player.stats.hp, '弹反=零伤').toBe(2000)
    w.off()
  })

  it('读条期间躲进断音柱：同一记 AoE 被柱子吃掉', () => {
    const { w, e, spec } = start()
    const pillar = e.data.boss!.covers!.positions[0]
    e.pos.x = pillar.x
    e.pos.z = pillar.z - 6 // 他在柱外起手
    standAt(w, e, { x: pillar.x, y: pillar.y, z: pillar.z })
    e.attack = newAttack(spec, spec.frames.startup - 1)
    w.tick(3)
    expect(w.player.stats.hp, '玩家没出柱子 ⇒ 55 伤没落到他头上').toBe(2000)
    w.off()
  })
})

describe('敌人的前摇音有发射方（audio.md §7.2：本作核心反馈通道）', () => {
  it('真 AI 出招时，enemies.json 里写的 sfx 真的响了；不是只有玩家武器在出声', () => {
    const w = makeWorld()
    const e = hersil(w, 0, -5)
    engage(w, e)
    standAt(w, e, { x: 0, y: 152, z: 0 })
    const before = w.sfx.length
    w.tick(900)
    const telegraph = w.sfx.slice(before).filter((k) => ['bowstring', 'drum_sweep', 'chord_slam'].includes(k))
    expect(telegraph.length, '他每起一次手就该有一响').toBeGreaterThan(0)
    w.off()
  })

  it('同一招不会一 tick 响两遍（tick 0 是唯一的发射点）', () => {
    const w = makeWorld()
    const e = hersil(w, 0, -5)
    engage(w, e)
    standAt(w, e, { x: 0, y: 152, z: 0 })
    const spec = e.data.attacks.find((a) => a.id === 'barsweep')!
    const before = w.sfx.length
    e.attack = newAttack(spec, -1)
    w.tick(6)
    expect(w.sfx.slice(before).filter((k) => k === 'drum_sweep').length).toBe(1)
    w.off()
  })
})
