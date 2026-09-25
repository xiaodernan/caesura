import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, msToTicks } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, reactions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { EntityStats } from '@/combat/EntityStats'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * §8 受击反应分级表（KI-050）：表里只写了**有承载体**的那两行，每条腿负责说出承载体在哪。
 *
 * - **R1 行 ＝ 玩家受击那一行**。§8 玩家侧：「受击一律 R1 等效 200ms + 0.2m 位移，硬直可翻滚取消」。
 *   承载体是 `ThirdPersonController.takeDamage`——此前这两个数是写死在代码里的（12 格 / 0.2m）。
 *   「可翻滚取消」那半句早就成立：翻滚入口的判据刻意不看 `stunTicks`（见 dodge 那一行），
 *   所以这条腿不测它，只钉住"改翻滚判据会把 §8 玩家侧那半句弄丢"的可能性由现有用例分担。
 * - **R4 行 ＝ 破势时长**。承载体是 `EntityStats.addPoise` 破势那一刻写出的 `crumpleTicksLeft`，
 *   数值经 `combat/Reactions.ts:armCrumple` 在构造时装上（普通 1.8s；Boss/mini-boss 2.4s——
 *   后半句此前**从未实现**，小兵与 Boss 一样 108 格）。
 *
 * 期望值一律从 `reactions` 读、经 `msToTicks` 换算，不手算；"读到的就是表里那个"由改表法腿钉死。
 *
 * R0/R2/R3 那三档的敌人侧承载体在 **KI-052①** 之后才存在，证人在 `tests/flow/reaction-grade.test.ts`；
 * 本文件只留 KI-050 那两条腿（玩家受击 = R1 等效、破势 = R4）。R5 浮空到现在仍无承载体，不入表。
 */

registerGameData()

const subs: Array<() => void> = []
afterEach(() => { for (const f of subs.splice(0)) f() })

const FOE = 'en_tympanus'
const BOSS = 'en_ostlara'

type Hit = { attackerId: string; victimId: string; damage: number; kind: string; result: string }

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
  player.stats.hpMax = 9_999
  player.stats.hp = 9_999
  const hits: Hit[] = []
  const offs = [bus.on('combat.hit', (p) => hits.push(p as unknown as Hit))]

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  /** 一记从 -z 方向飞向玩家的敌对弹体：命中出口走 `resolveAgainstPlayer` 的受击那一支 */
  function shootAtPlayer(at: Vec3): void {
    combat.projectiles.spawn({
      hostile: true, ownerId: FOE, kind: 'note',
      origin: { x: at.x, y: at.y + 1.1, z: at.z + 1.4 },
      dir: { x: 0, y: 0, z: -1 },
      speed: 60, range: 20, radius: 1.2, damage: 6, poise: 0, hitStopMs: 80, onBeat: false
    }, time.tick)
  }
  /** 打到玩家身上的那一记（result==='hit'，不持盾 ⇒ 不走格挡/破防出口）。返回落地前的位置 */
  function landOneHitOnPlayer(): Vec3 | null {
    const before = { ...player.pos }
    shootAtPlayer(player.pos)
    for (let i = 0; i < 30 && !hits.some((h) => h.victimId === 'player' && h.result === 'hit'); i++) tick()
    return hits.some((h) => h.victimId === 'player' && h.result === 'hit') ? before : null
  }
  const off = (): void => { for (const f of offs) f() }
  subs.push(off)
  return { time, rhythm, player, ai, combat, frame, tick, hits, off, landOneHitOnPlayer }
}

describe('KI-050：§8 R1 那一行（玩家受击一律 R1 等效）住在 reactions.json', () => {
  it('在表：200ms 硬直 + 0.2m 位移，与 combat.md §8 R1 行逐字对得上', () => {
    expect(reactions.R1.stunMs).toBe(200)
    expect(reactions.R1.displaceM).toBe(0.2)
    expect(msToTicks(reactions.R1.stunMs), '§8 写的 "200ms/12f" 必须是同一个数的两种单位').toBe(12)
  })

  it('真挨一击：硬直格数与位移都从 R1 行派生，方向沿来袭的反向（玩家被推开）', () => {
    const w = makeWorld()
    const before = w.landOneHitOnPlayer()
    expect(before, '弹体没落到玩家身上：这条在量空气').toBeTruthy()
    expect(w.player.stunTicks).toBe(msToTicks(reactions.R1.stunMs))
    const dz = w.player.pos.z - before!.z
    expect(dz, '击退方向：弹体从 -z 飞来 ⇒ 玩家被朝 +z 推').toBeGreaterThan(0)
    expect(Math.abs(dz - reactions.R1.displaceM), '位移量 == 表里那格，不是代码里的 0.2').toBeLessThan(1e-9)
    w.off()
  })

  it('改表就改行为：stunMs/displaceM 各改一次，读数跟着走；还原后再量一次', () => {
    const saved = { ...reactions.R1 }
    reactions.R1.stunMs = 500
    reactions.R1.displaceM = 1.5
    try {
      const w = makeWorld()
      const before = w.landOneHitOnPlayer()
      expect(before, '弹体没落到玩家身上：这条在量空气').toBeTruthy()
      expect(w.player.stunTicks, '改了表却没改硬直 ⇒ 代码里还藏着第二个数').toBe(msToTicks(500))
      expect(Math.abs(w.player.pos.z - before!.z), '改了表却没改位移 ⇒ 0.2 还写死在 takeDamage 里').toBeCloseTo(1.5, 9)
      w.off()
    } finally {
      Object.assign(reactions.R1, saved)
    }
    expect(reactions.R1.stunMs, '量具不动生产数据：跑完要还原').toBe(200)
    const w = makeWorld()
    const before = w.landOneHitOnPlayer()
    expect(before).toBeTruthy()
    expect(w.player.stunTicks, '还原后要重新成立（防"改坏了也没人发现"）').toBe(12)
    expect(Math.abs(w.player.pos.z - before!.z)).toBeCloseTo(0.2, 9)
    w.off()
  })

  it('反证：翻滚入口不看 stunTicks ⇒「硬直可翻滚取消」不依赖 R1 的时长', () => {
    const w = makeWorld()
    const before = w.landOneHitOnPlayer()
    expect(before).toBeTruthy()
    expect(w.player.stunTicks, '前提：正处在硬直里').toBeGreaterThan(0)
    w.frame.edges.add('dodge')
    w.tick()
    expect(w.player.roll, '§8 玩家侧那半句：硬直中翻滚必须仍然按得出去').not.toBeNull()
    w.off()
  })
})

describe('KI-050：§8 R4 那一行（破势 1.8s / Boss 2.4s）经 armCrumple 上弦', () => {
  it('在表：普通 1800ms=108f、Boss 2400ms=144f，与 §8 R4 行对得上', () => {
    expect(reactions.R4.crumpleMs).toBe(1800)
    expect(reactions.R4.bossCrumpleMs).toBe(2400)
    expect(msToTicks(reactions.R4.crumpleMs)).toBe(108)
    expect(msToTicks(reactions.R4.bossCrumpleMs)).toBe(144)
  })

  it('小兵破势 108 格；Boss 破势 144 格——同一次 `addPoise`，两个时长各来自表的一格', () => {
    const w = makeWorld()
    const foe = w.ai.spawn(FOE, { x: 0, y: 0, z: -30 }, 'cr-foe')
    const boss = w.ai.spawn(BOSS, { x: 0, y: -40, z: -60 }, 'cr-boss')
    expect(foe.isBoss, '前提：嘈壳不是 Boss').toBe(false)
    expect(boss.isBoss, '前提：奥斯塔拉是 Boss').toBe(true)
    foe.stats.poiseMax = 1
    boss.stats.poiseMax = 1
    expect(foe.stats.addPoise(2, w.time.tick), '这一压要真的破势').toBe(true)
    expect(foe.stats.crumpleTicksLeft).toBe(msToTicks(reactions.R4.crumpleMs))
    expect(boss.stats.addPoise(2, w.time.tick), '这一压要真的破势').toBe(true)
    expect(boss.stats.crumpleTicksLeft, '§8 R4 的「Boss 2.4s」此前从未实现——这条就是它落地的证人')
      .toBe(msToTicks(reactions.R4.bossCrumpleMs))
    w.off()
  })

  it('玩家侧读同一格（非 Boss 那一格）：破势时长与小兵同源', () => {
    const w = makeWorld()
    w.player.stats.poiseMax = 1
    w.player.stats.poiseAccum = 0
    expect(w.player.stats.addPoise(2, w.time.tick)).toBe(true)
    expect(w.player.stats.crumpleTicksLeft).toBe(msToTicks(reactions.R4.crumpleMs))
    w.off()
  })

  it('改表就改行为：bossCrumpleMs 改小，Boss 的破势跟着变；还原后回 144', () => {
    const saved = { ...reactions.R4 }
    reactions.R4.bossCrumpleMs = 600
    try {
      const w = makeWorld()
      const boss = w.ai.spawn(BOSS, { x: 0, y: -40, z: -60 }, 'cr-mut')
      boss.stats.poiseMax = 1
      expect(boss.stats.addPoise(2, w.time.tick)).toBe(true)
      expect(boss.stats.crumpleTicksLeft, '改了表却没改破势 ⇒ 144 还写死在别处').toBe(msToTicks(600))
      w.off()
    } finally {
      Object.assign(reactions.R4, saved)
    }
    expect(reactions.R4.bossCrumpleMs).toBe(2400)
    const w = makeWorld()
    const boss = w.ai.spawn(BOSS, { x: 0, y: -40, z: -60 }, 'cr-boss2')
    boss.stats.poiseMax = 1
    expect(boss.stats.addPoise(2, w.time.tick)).toBe(true)
    expect(boss.stats.crumpleTicksLeft).toBe(144)
    w.off()
  })

  it('没上弦就破势 = 接线错误 ⇒ 抛，不静默免疫（`addFissure` 同款纪律）', () => {
    const stats = new EntityStats(100, 100, 1)
    expect(stats.crumpleTicks, '未武装的 stats 手里没有时长').toBeNull()
    expect(() => stats.addPoise(2, 1)).toThrow(/arm/)
  })
})
