import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT, TICK_HZ, msToTicks } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { DEFAULT_GAMEPLAY_SETTINGS, GAMEPLAY_BOUNDS, GameplaySettingsStore, type GameplaySettings } from '@/settings/GameplaySettings'
import { readFileSync } from 'node:fs'

/**
 * KI-365：§6「手柄支持」那一行里剩下的第二格——**长按阈值 200–800ms**。
 *
 * 消费方不是新发明的：`ThirdPersonController` 里重键「按住再松」那一路一直由一个**魔数 8 tick**
 * 判「这一算轻点还是长按」（松手时 `chargeTicks < 8` ⇒ 出一记 `h`；够 8 而没蓄满 ⇒ 什么都不发；
 * 蓄满 ⇒ `charged`）。`TICK_HZ = 60` ⇒ 那条线今天写在 **133ms**，既不在玩家手里、也不在 §6 写的那一格界内。
 *
 * 本批把那条线从藏在句子中间的拍数变成表里的一格数（`gameplay.holdMs`，界 200–800、默认取 §6 那格的下限），
 * 判据仍只有一处（消费者自己那句比较），而它跟着设置走——所以「屏上那一格」与「手感那一条线」
 * 是同一个数的两个读者，不是两份状态。
 *
 * **要如实记下的一处行为变化**：默认从 133ms 抬到 200ms（那格的**下限**＝离今天最近的那一端）之后，
 * 133–200ms 那一小段松键今天什么都不发、本批之后出一记 `h`——那是把静默的输入洞收窄
 * （需求 §25「每次输入都要有可感知的反馈」），不是回归。腿②量的正是这一侧，腿⑥量另一侧（过线仍不发）。
 *
 * **量到的一处形状**：这把武器（`ms_sword`）没写逐武器 `chargeTicks` ⇒ 蓄满线是全局基线 48 拍＝800ms，
 * 恰好就是本格的**上限**。于是顶到 800 那一端时，「过了线又没蓄满 ⇒ 取消」那一档在这把武器上为空
 * （48 拍直接进 `charged`）。这不是漏，是两条线在同一个玩家可调区间顶端相遇——腿④把这件事当场量出来并写进注语。
 */
registerGameData()

function makeWorld(patch?: Partial<GameplaySettings>) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true, bufferSec: 0.2, frameAssist: false } as unknown as Input
  // 第五把消费者就是玩家自己：构造即灌一遍（`applyToTargets` 是唯一的灌入路径，测试不另写一份）
  const store = new GameplaySettingsStore({ input, rig: { shakeIntensity: 0 }, haptics: { scale: 1, weakScale: 1 }, combat, player }, patch)
  player.camYawRef = 0

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

  /** 按住重键 `holdTicks` 拍再松手 ⇒ 回读松手之后那一拍出手的是哪一式（没出手就是 undefined） */
  function pressThenRelease(holdTicks: number): string | undefined {
    frame.held.add('attackHeavy')
    tick(holdTicks)
    frame.held.delete('attackHeavy')
    tick(1)
    return player.action?.key
  }

  return { time, rhythm, player, ai, combat, frame, input, store, tick, pressThenRelease }
}

const TICKS_AT_200MS = msToTicks(200)

describe('KI-365 长按阈值那一格：那条线从句子中间的 8 tick 变成表里的一格数', () => {
  it('界两侧的两个相邻拍：11 拍出 h、12 拍什么都不发——线正好落在 200ms 上', () => {
    const tap = makeWorld()
    expect(tap.pressThenRelease(TICKS_AT_200MS - 1), '按住差一拍不到界 ⇒ 那一记算轻点，出 h').toBe('h')
    const hold = makeWorld()
    expect(hold.pressThenRelease(TICKS_AT_200MS), '恰好按满界 ⇒ 从这一拍起算长按，而长按没蓄满就是取消').toBeUndefined()
    expect(TICKS_AT_200MS, '200ms 在 60Hz 下是整整 12 拍：换算只有 `msToTicks` 一位主人，量具也不抄第二份').toBe(12)
  })

  it('行为变化那一侧：旧那把 8 拍的线不再是判据——今天沉默的松手，本批出一记 h', () => {
    const w = makeWorld()
    expect(w.player.holdMs, '消费者手里那一格先接上设置（不接的话下面两句都是空断言）').toBe(200)
    expect(w.pressThenRelease(8), '8 拍＝133ms：今天正好越过那把魔数线⇒什么都不发，默认线（200ms）之下它算轻点').toBe('h')
    const wide = makeWorld({ holdMs: 600 })
    expect(wide.pressThenRelease(msToTicks(600) - 1), '线拧到 600ms ⇒ 按到 583ms 仍算轻点：这一段今天全在沉默区里').toBe('h')
  })

  it('同一只手、同一记时长，线跟着那一格走：500ms 的松手在 600 那一边出手、在默认那一边不发', () => {
    const ticks = msToTicks(500)
    const wide = makeWorld({ holdMs: 600 })
    expect(wide.pressThenRelease(ticks), '界＝600ms ⇒ 500ms 还没到线，出的是 h').toBe('h')
    const tight = makeWorld()
    expect(tight.pressThenRelease(ticks), '同一记时长、界回到默认 ⇒ 过了线又没蓄满，取消').toBeUndefined()
  })

  it('顶到上限那一端：700ms 仍出 h，而 800ms 的线在这把武器上与蓄满线重合——取消那一档当场为空', () => {
    const top = GAMEPLAY_BOUNDS.holdMs.max
    const w = makeWorld({ holdMs: top })
    expect(w.pressThenRelease(msToTicks(700)), '界＝800ms ⇒ 700ms 的松手还没到线，出 h').toBe('h')
    expect(msToTicks(top), '本格上限的拍数与这把武器的蓄满线是同一个数：两条线在顶端相遇，不是谁吃掉谁')
      .toBe(w.player.chargeThreshold)
    const meet = makeWorld({ holdMs: top })
    expect(meet.pressThenRelease(msToTicks(top)), '所以正好按满界那一拍走的是蓄满那一支，而不是取消——量具不许替设计圆场')
      .toBe('charged')
  })

  it('蓄满那一档不归这条线管：界怎么挪，按满 100 拍出的都是 charged', () => {
    for (const ms of [200, 500, 800]) {
      const w = makeWorld({ holdMs: ms })
      expect(w.pressThenRelease(100), `界＝${ms}ms 时蓄满那一式不许跟着变`).toBe('charged')
    }
  })

  it('过线不发那一半也跟着线走（600ms 那一边）：过了线而离蓄满还差几拍 ⇒ 仍然是取消', () => {
    const w = makeWorld({ holdMs: 600 })
    const ticks = msToTicks(600) + 4
    expect(ticks < w.player.chargeThreshold, '取证前提：这一拍数在 600 那一边确实过了线、又没到蓄满（不是拿蓄满那一档冒充取消）')
      .toBe(true)
    expect(w.pressThenRelease(ticks), '取消那一档不是默认线专属的：线拧宽之后它住在新线上面').toBeUndefined()
    const moved = makeWorld({ holdMs: 600 })
    moved.store.set({ holdMs: 200 })
    expect(moved.player.holdMs, '`set` 走的也是同一条灌入路径：拧回去，玩家手里跟着变').toBe(200)
    expect(moved.pressThenRelease(msToTicks(500)), '同一记 500ms：600 那一边出 h（上面那条），拧回默认就过了线 ⇒ 线真的住在这一格里')
      .toBeUndefined()
  })

  it('判据只有一处，而且它读的是那一格：源文件里那句 `< 8` 不再出现，写的是 `msToTicks(this.holdMs)`', () => {
    const src = readFileSync(new URL('../../src/player/ThirdPersonController.ts', import.meta.url), 'utf8').split(/\r?\n/)
    const judge = src.filter((l) => /chargeTicks\s*</.test(l))
    expect(judge.length, '「按住多久算长按」这条判据在源码里只许住一处').toBe(1)
    expect(judge[0], '而那一处读的是那一格，不是写在句子中间的拍数').toContain('msToTicks(this.holdMs)')
    expect(src.filter((l) => /chargeTicks\s*<\s*8\b/.test(l)).length, '魔数 8 从判据里搬走：留下第二处就是两位主人').toBe(0)
  })

  it('数只有一个主人：表里那一格的默认＝消费者声明的那一个＝§6 那格的下限', () => {
    expect(DEFAULT_GAMEPLAY_SETTINGS.holdMs, '表里得有这一格，默认写在 §6 那格的下限').toBe(200)
    expect(GAMEPLAY_BOUNDS.holdMs, '而界也只有表里这一位说：200–800 抄的是 §6 那一行').toEqual({ min: 200, max: 800 })
    const weapon = registry.get<WeaponData>('wp_tuning_sword')
    const bare = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
    expect(bare.holdMs, '没接设置的玩家手里也是那一个数（声明处不抄第二份）').toBe(DEFAULT_GAMEPLAY_SETTINGS.holdMs)
    expect(msToTicks(200) * (1000 / TICK_HZ), '这一格落在 60Hz 的拍网格上：换算不产生半个判据').toBe(200)
  })

  it('界在灌之前夹：越界的数到不了消费者手里', () => {
    const over = makeWorld({ holdMs: 5000 })
    expect(over.store.get().holdMs, '表侧夹到上限').toBe(GAMEPLAY_BOUNDS.holdMs.max)
    expect(over.player.holdMs, '而消费者拿到的也是夹过的那一个：夹之后才灌，不是灌之后再兜').toBe(GAMEPLAY_BOUNDS.holdMs.max)
    const under = makeWorld({ holdMs: 1 })
    expect(under.player.holdMs, '下限那一端同样：1ms 到不了玩家手里（否则长按取消永远打不出来）').toBe(GAMEPLAY_BOUNDS.holdMs.min)
    const junk = makeWorld()
    junk.store.set({ holdMs: NaN })
    expect(junk.player.holdMs, 'NaN 连比较都不过 ⇒ 回默认，而不是把一个 NaN 灌成一条永远过不了的线').toBe(DEFAULT_GAMEPLAY_SETTINGS.holdMs)
    expect(junk.pressThenRelease(11), '夹回默认之后判据照样打得出：这一格不是只存在表里的装饰').toBe('h')
  })
})
