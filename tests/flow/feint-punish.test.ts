import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, msToTicks } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import type { Input } from '@/core/Input'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { newAttack } from '@/ai/Enemy'
import { CombatManager } from '@/combat/CombatManager'
import { reactionConfig } from '@/combat/Reactions'
import type { Projectile } from '@/combat/Projectiles'

/**
 * §14.4 那句「三叠箭第 2 拍为假动作（延迟 0.25 拍），骗翻滚后硬直 0.6s」的**惩罚腿**（KI-085）。
 *
 * 这份文件量的是那句话里的因果，不是数字：数字的合法性归 `scripts/burst-rules.mjs`
 * （那张表由 `tests/unit/burst-table.test.ts` 两端实测）。这里只管四件事——
 *  ① 诱饵被无敌帧吃掉 ⇒ 这一滚欠下一笔硬直；
 *  ② 那笔硬直在**翻滚自然结束**那一拍才兑现（文档说的是"骗翻滚后"）；
 *  ③ 没被骗的两种情形（站着挨下诱饵 / 真箭被滚掉）不欠任何东西，被打断的那一滚也不补；
 *  ④ 诱饵身份从数据表一路带到离手的那一发。
 *
 * 几何口径（照 `ranged.test.ts` 的 `hostile()` 那一套）：弹速 13 m/s ⇒ 每 tick 0.2167m，
 * 免伤窗是 `roll.iframeStart..iframeEnd` = 第 9..21 拍，翻滚位移 3.2m/30 拍。用例一律
 * **朝来弹方向翻滚**（输入 `move.y=1` 在 `camYawRef=0` 下就是世界 -Z），因为"无敌帧吃掉这一发"
 * 需要接触真的落进那 13 拍里：侧向滚会把命中窗推到免伤窗之外（那是"真躲开了"，另一条腿）。
 * 这一份量的是"吃掉之后欠的那笔账"，不是翻滚方向学。
 */

registerGameData()

type Hit = { attackerId: string; victimId: string; damage: number; result: string }

/** 诱饵从出手到被吃掉的那几拍：`roll.tick` 起手算 1，接触落在 14 拍（窗是 9..21） */
const DECOY_Z = -5

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_drawpin_spear')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.yaw = Math.PI
  const hits: Hit[] = []
  const off = bus.on('combat.hit', (p) => { hits.push(p as unknown as Hit) })

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, hits, off, tick }
}

/** 一枚飞向玩家的敌方弹体；`feintPunishMs` 只有诱饵那一发带（§14.4） */
function incoming(w: ReturnType<typeof makeWorld>, z: number, feintPunishMs?: number): Projectile {
  return w.combat.projectiles.spawn({
    hostile: true, ownerId: 'en_test', kind: 'shard', origin: { x: 0, y: 1.1, z }, dir: { x: 0, y: 0, z: 1 },
    speed: 13, range: 20, radius: 0.45, damage: 10, poise: 5, hitStopMs: 60, feintPunishMs
  }, w.time.tick)
}

/**
 * 起手一次"迎向来弹"的翻滚，并把它的第一拍走掉：返回时 `roll.tick === 1`，
 * 于是调用方紧接着 `incoming(w, DECOY_Z, …)` 的那一发正好在第 14 拍被无敌帧吃掉。
 */
function roll(w: ReturnType<typeof makeWorld>): void {
  w.frame.move = { x: 0, y: 1 } // camYawRef=0 ⇒ 世界 -Z，正对来弹
  w.frame.edges.add('dodge')
  w.tick()
  w.frame.move = { x: 0, y: 0 }
}

/** 推进到"这一发被无敌帧吃掉"，返回吃掉那一拍的 `roll.tick`（没有吃到返回 null） */
function untilEaten(w: ReturnType<typeof makeWorld>, maxTicks = 30): number | null {
  for (let t = 0; t < maxTicks && !w.hits.some((h) => h.result === 'immune'); t++) w.tick()
  return w.hits.some((h) => h.result === 'immune') ? (w.player.roll?.tick ?? null) : null
}

/**
 * 从"翻滚自然结束"那一拍起数，玩家还站不住多少 tick。
 *
 * 读数比表里的数**少一格**是这一趟 update 的形状，不是缺陷：翻滚结束那一拍里先兑现 `punishTicks`
 * 再走硬直的倒数（`ThirdPersonController.update` 的翻滚块在倒数之前），所以第 36 格花在"兑现那一拍"
 * 之内，能被观察到 `> 0` 的是随后 35 拍。用例因此按 `msToTicks(punishMs) - 1` 精确钉住，并把理由写在消息里。
 */
function lockAfterRoll(w: ReturnType<typeof makeWorld>, maxTicks = 120): number {
  let n = 0
  let sawRollEnd = false
  for (let t = 0; t < maxTicks; t++) {
    const before = w.player.roll
    w.tick()
    if (before && !w.player.roll) sawRollEnd = true
    if (sawRollEnd) {
      if (w.player.stunTicks > 0) n++
      else if (n > 0) break
    }
  }
  expect(sawRollEnd, '这腿走不到"翻滚自然结束"，测量本身失效').toBe(true)
  return n
}

describe('§14.4 三叠箭的诱饵惩罚（KI-085）', () => {
  it('诱饵被无敌帧吃掉 ⇒ 这一滚记下 0.6s 的欠账，翻滚结束时才兑现', () => {
    const w = makeWorld()
    const punishMs = 600
    roll(w)
    incoming(w, DECOY_Z, punishMs)
    const eatenTick = untilEaten(w)
    const r = w.player.roll
    expect(eatenTick, `没等到"被无敌帧吃掉"那一拍（玩家翻滚还在否：${r !== null}，此刻 tick=${r?.tick ?? '无'}）`)
      .not.toBeNull()
    expect(r, '吃掉诱饵时玩家还在滚——不然这笔账没有载体').not.toBeNull()
    expect(eatenTick! >= r!.iframeStart && eatenTick! <= r!.iframeEnd,
      `吃掉那一拍(${eatenTick}) 必须落在免伤窗(${r!.iframeStart}..${r!.iframeEnd})里`)
      .toBe(true)
    expect(r!.punishTicks, '欠账当场记在**这一滚**身上，还没兑现')
      .toBe(msToTicks(punishMs))
    expect(w.player.stunTicks, '硬直不能插在翻滚中间——那一段的锁是翻滚自己的')
      .toBe(0)
    expect(lockAfterRoll(w), '翻滚结束后站不住的长度 = 表里那 0.6s 折成的格数，少的那一格是"兑现那一拍"')
      .toBe(msToTicks(punishMs) - 1)
    w.off()
  })

  it('站着挨下诱饵：只有那一记的伤害与 R1 硬直，没有诱饵惩罚', () => {
    const w = makeWorld()
    const hp0 = w.player.stats.hp
    incoming(w, DECOY_Z, 600)
    for (let t = 0; t < 60 && !w.hits.some((h) => h.result === 'hit'); t++) w.tick()
    const hit = w.hits.find((h) => h.result === 'hit')
    expect(hit, '没翻滚就该实打实挨这一下').toBeTruthy()
    expect(w.player.stats.hp, '那一记的伤害照结算').toBeLessThan(hp0)
    expect(w.player.roll, '站着挨的，没有"这一滚"可以记账').toBeNull()
    expect(w.player.stunTicks, '只有 reactions.json 的 R1 那一格，诱饵的 0.6s 是另一笔账（没滚就不欠）')
      .toBeLessThanOrEqual(msToTicks(reactionConfig().R1.stunMs))
    w.off()
  })

  it('真箭被滚掉不欠账：只有 burst.feint.shot 那一发带惩罚', () => {
    const w = makeWorld()
    roll(w)
    incoming(w, DECOY_Z) // feintPunishMs 缺省 ⇒ 这一发是真威胁
    const eatenTick = untilEaten(w)
    expect(eatenTick, `没等到"被无敌帧吃掉"那一拍（此刻 tick=${w.player.roll?.tick ?? '不滚了'}）`)
      .not.toBeNull()
    expect(w.player.roll!.punishTicks, '用无敌帧躲掉真威胁是正确操作，不该罚').toBeUndefined()
    expect(lockAfterRoll(w, 60), '不欠账就没有"骗完之后站不稳"那一段').toBe(0)
    w.off()
  })

  it('翻滚中途被打断 ⇒ 那一滚不是"被骗空的一滚"，欠账一起作废', () => {
    const w = makeWorld()
    roll(w)
    incoming(w, DECOY_Z, 600)
    expect(untilEaten(w), `先确认诱饵确实被吃掉（此刻 tick=${w.player.roll?.tick ?? '不滚了'}）`)
      .not.toBeNull()
    expect(w.player.roll!.punishTicks, '先确认欠账确实记上了，否则下面那条红测的是别的东西')
      .toBeGreaterThan(0)
    // 免伤窗里 takeDamage 是不成立的（§5.4 那条 iFrame 判据先返回 false），所以等到窗关上再敲
    for (let t = 0; t < 30 && w.player.iFrame; t++) w.tick()
    expect(w.player.iFrame, '打断必须发生在免伤窗之外，否则 takeDamage 只是空转').toBe(false)
    const hp0 = w.player.stats.hp
    w.player.takeDamage(5)
    expect(w.player.roll, '受击把这一滚收走（§8：翻滚不是一条可以带着欠账走完的独立时间线）').toBeNull()
    let maxStun = 0
    for (let t = 0; t < 90; t++) {
      w.tick()
      maxStun = Math.max(maxStun, w.player.stunTicks)
    }
    expect(maxStun, '被打断的那一滚不该在之后补一笔 0.6s——最多只有这一记自己的 R1')
      .toBeLessThanOrEqual(msToTicks(reactionConfig().R1.stunMs))
    expect(w.player.stats.hp).toBeLessThan(hp0)
    w.off()
  })

  it('不在翻滚里就没有这一笔账（站着 / 处决演出的无敌 / 折成 0 格的数）', () => {
    const w = makeWorld()
    expect(w.player.beginFeintPunish(600), '站着时判据就不成立').toBe(false)
    expect(w.player.roll).toBeNull()
    expect(w.player.stunTicks, '返回 false 的同时也不许把硬直直接打在身上——那笔账没有载体就是不欠')
      .toBe(0)
    w.player.beginExecute({ x: 0, y: 0, z: -3 }, 60)
    expect(w.player.iFrame, '处决演出期确实是无敌的').toBe(true)
    expect(w.player.beginFeintPunish(600), '那句文档说的是骗**翻滚**，不是任何一次无敌').toBe(false)
    expect(w.player.stunTicks, '演出期挨的这一下同样不欠 0.6s').toBe(0)
    expect(w.player.beginFeintPunish(1), '折成 0 格的数不记账（表那边由 burst-rules 的 punishMs 判据先拒掉）')
      .toBe(false)
    w.off()
  })

  it('诱饵身份从数据表一路带到离手的那一发：三发里只有第 2 发带惩罚', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_skewer', { x: 0, y: 0, z: -20 }, 'skewer')
    e.alertness = 100
    e.attack = newAttack(e.data.attacks.find((a) => a.id === 'tri')!, 0)
    e.enter('combat')
    const launched: Array<{ at: number; punish: number | undefined }> = []
    const seen = new Set<number>()
    const start = w.time.tick
    for (let t = 0; t < 200; t++) {
      w.tick()
      for (const p of w.combat.projectiles.list()) {
        if (seen.has(p.id)) continue
        seen.add(p.id)
        launched.push({ at: p.bornTick - start, punish: p.feintPunishMs })
      }
      if (!e.attack) break
    }
    expect(launched.map((l) => l.at), '三叠箭按 at 帧位发满三发（这一腿的前提）')
      .toHaveLength(3)
    expect(launched.map((l) => l.punish), '只有 burst.feint.shot 指的那一发带惩罚，毫秒数来自 enemies.json')
      .toEqual([undefined, 600, undefined])
    w.off()
  })
})
