import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, weaponsRaw } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack } from '@/ai/Enemy'
import { msToTicks } from '@/core/Time'
import { bus } from '@/core/EventBus'

/**
 * KI-213：**格挡（combat.md §5.1）那一族其余各格**第一次在真链上被量（KI-198 只量了"格挡中移动"那一格）。
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy`（那一记直接摆进判定窗）＋ 真 `CombatManager` ＋ 真事件。
 * 敌人站在原点、玩家在它正前方 ⇒ 那一记真的落在玩家身上（招式表与 AI 都走真的）。
 *
 * **量到的四格与设计逐字对上**：体力消耗＝**通过伤害 × 1.2**、bleed＝**25% 架势伤害**、
 * 破防＝**600ms 大踉跄**、减伤＝那一记的**成交伤害 = 伤害 × (1 − 55%)**。
 *
 * **量到的一处对不上（只量不裁）**：设计 §5.1「减伤」那一行写的是「减伤 55%」，
 * 而运行时**格挡扛住 = 掉体力不掉生命**（既有那条腿 `tests/flow/ranged.test.ts` 钉的就是这一格：
 * 「§5.1：格挡扛住 = 只付体力，不掉生命」）⇒ 那一行的「55%」落在**那一记的数**上
 * （`combat.hit` 报的成交伤害与体力的基数都是它），HP 那一侧是零。
 * 「减伤 55%」与「扛住不掉血」到底哪一句是设计意图，**没裁** ⇒ 本批只量不裁。
 */

registerGameData()

const FOE = 'en_tympanus'
const foeData = registry.get<EnemyData>(FOE)
const MALLET = foeData.attacks.find((a) => a.id === 'mallet')!

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
  const hits: Array<{ result: string; damage: number }> = []
  const off = bus.on('combat.hit', (p) => hits.push({ result: p.result, damage: p.damage }))

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, off }
}

type World = ReturnType<typeof makeWorld>

/** 敌人站在原点、玩家在它正前方 1.6m（锥形判定框 3.4m 内） */
function faceOff(w: World): ReturnType<World['ai']['spawn']> {
  const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'guard')
  e.alertness = 100
  e.enter('combat')
  e.skipIntro()
  e.yaw = Math.PI // 面朝 -z（玩家在那一侧）
  const p = w.player
  p.pos = { x: 0, y: 0, z: -1.6 }
  p.yaw = 0
  p.stats.stamina = p.stats.staMax
  return e
}

/** 把那一记摆进判定窗，让它真的落在玩家身上（招式表与 AI 都走真的） */
function strike(w: World, e: ReturnType<World['ai']['spawn']>): void {
  e.attack = newAttack(MALLET, MALLET.frames.activeStart)
  w.tick(1)
  e.attack = null
}

/** 按住格挡键，走过起手（`guard.startupTicks`） */
function holdGuard(w: World): void {
  w.frame.held.add('guard')
  w.tick(playerBase.guard.startupTicks + 2)
}

describe('KI-213 格挡（combat.md §5.1）那一族其余各格：第一次在真链上被量', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 减伤那一格：那一记的成交伤害 = 伤害 × (1 − reduction)；而格挡扛住 = 不掉生命', () => {
    const w = makeWorld()
    const e = faceOff(w)
    holdGuard(w)
    expect(w.player.guarding, '前提：格挡态已经起来了（起手走完）').toBe(true)
    const hp0 = w.player.stats.hp
    strike(w, e)
    const hit = w.hits.find((h) => h.result === 'block')
    const want = Math.round(MALLET.frames.damage * (1 - playerBase.guard.reduction))
    expect(hit, '那一记该走格挡那条出口').toBeTruthy()
    expect(hit!.damage, `成交伤害 = 伤害 × (1 − ${playerBase.guard.reduction})（设计 §5.1「减伤 55%」那一格落在这一记的数上）`)
      .toBe(want)
    expect(w.player.stats.hp, '格挡扛住 = 只付体力，不掉生命（既有那条腿 `ranged.test.ts` 钉的就是这一格）').toBe(hp0)
    alive.push(w.off)
  })

  it('腿② 体力消耗 = 通过伤害 × staPerDmg（设计 §5.1 那一行）', () => {
    const w = makeWorld()
    const e = faceOff(w)
    holdGuard(w)
    const sta0 = w.player.stats.stamina
    strike(w, e)
    const through = Math.round(MALLET.frames.damage * (1 - playerBase.guard.reduction))
    const want = through * playerBase.guard.staPerDmg
    expect(sta0 - w.player.stats.stamina, `体力消耗 = 通过伤害 ${through} × ${playerBase.guard.staPerDmg}（武器格挡那一格）`)
      .toBeCloseTo(want, 6)
    alive.push(w.off)
  })

  it('腿③ bleed：格挡仍受 25% 架势伤害累积（设计 §5.1「不许无脑龟」那一行）', () => {
    const w = makeWorld()
    const e = faceOff(w)
    holdGuard(w)
    const poise0 = w.player.stats.poiseAccum
    strike(w, e)
    const want = MALLET.frames.damage * playerBase.guard.bleedPoiseFrac
    expect(w.player.stats.poiseAccum - poise0, `架势累积 = 伤害 × ${playerBase.guard.bleedPoiseFrac}`)
      .toBeCloseTo(want, 6)
    alive.push(w.off)
  })

  it('腿④ 破防：体力归零 → 600ms 大踉跄（设计 §5.1 那一行）', () => {
    const w = makeWorld()
    const e = faceOff(w)
    holdGuard(w)
    w.player.stats.stamina = 1 // 付不起这一记 ⇒ 破防
    strike(w, e)
    const hit = w.hits.find((h) => h.result === 'hit')
    expect(hit, '破防那一记该走"体力归零"那条出口').toBeTruthy()
    expect(w.player.stats.stamina, '破防 ⇒ 体力归零').toBe(0)
    expect(w.player.exhausted, '破防 ⇒ exhausted 那一格起来').toBe(true)
    expect(w.player.stunTicks, `大踉跄 = msToTicks(${playerBase.guard.breakStunMs})（不是受击那一格）`)
      .toBe(msToTicks(playerBase.guard.breakStunMs))
    alive.push(w.off)
  })

  it('腿⑤ 登记：破防那一记的伤害是 round(通过伤害 × 1.3)（设计那一行写的是「该次伤害补至 70%」）', () => {
    const w = makeWorld()
    const e = faceOff(w)
    holdGuard(w)
    w.player.stats.stamina = 1
    const hp0 = w.player.stats.hp
    strike(w, e)
    const through = Math.round(MALLET.frames.damage * (1 - playerBase.guard.reduction))
    const want = Math.round(through * 1.3)
    expect(hp0 - w.player.stats.hp, '破防那一记掉的血（**变更探测器**：设计写的是「补至 70%」，代码是 round(通过伤害 × 1.3)——两处对不上，本批只登记不裁）')
      .toBe(want)
    alive.push(w.off)
  })

  it('腿⑥ 登记：对远程那一格没有承载体（远程那一记与近战同一口径）', () => {
    const w = makeWorld()
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.stats.stamina = p.stats.staMax
    holdGuard(w)
    const hp0 = p.stats.hp
    const sta0 = p.stats.stamina
    w.combat.projectiles.spawn({
      hostile: true, ownerId: 'en_test', kind: 'shard', origin: { x: 0, y: 1.1, z: -6 }, dir: { x: 0, y: 0, z: 1 },
      speed: 13, range: 20, radius: 0.45, damage: MALLET.frames.damage, poise: MALLET.frames.poise, hitStopMs: 60,
    }, w.time.tick)
    for (let i = 0; i < 60 && w.hits.length === 0; i++) w.tick()
    const hit = w.hits.find((h) => h.result === 'block')
    const through = Math.round(MALLET.frames.damage * (1 - playerBase.guard.reduction))
    expect(hit, '那一记该走格挡那条出口').toBeTruthy()
    expect(hit!.damage, '远程那一记与近战同一口径 ⇒ 设计「对远程统一 -15%」那一格没有承载体（**变更探测器**）')
      .toBe(through)
    expect(p.stats.hp, '远程那一记也扛住（不掉生命）').toBe(hp0)
    expect(sta0 - p.stats.stamina, '远程那一记的体力代价与近战同一口径').toBeCloseTo(through * playerBase.guard.staPerDmg, 6)
    alive.push(w.off)
  })

  it('腿⑦ 登记：盾 75%／×0.8 那一格没有承载体（游戏里没有盾）', () => {
    const shields = weaponsRaw.filter((w) => (w as unknown as { shield?: unknown }).shield !== undefined)
    expect(shields.map((w) => w.id), '武器表里没有盾 ⇒ 设计 §5.1「盾 75%」与「体力 ×0.8」那两格没有承载体（**变更探测器**：哪天有了盾，这条腿就红）')
      .toEqual([])
  })
})
