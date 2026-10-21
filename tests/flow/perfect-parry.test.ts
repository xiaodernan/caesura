import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack } from '@/ai/Enemy'
import { bus } from '@/core/EventBus'

/**
 * KI-215：**完美格挡（combat.md §5.2）与弹反成功（§5.3）那两族的效果侧**第一次在真链上被量。
 *
 * KI-201 量的是弹反的**输入窗与落空**（窗亮 6 拍／落空 27 拍），
 * 完美格挡那一族（输入窗 5 拍）与**两族的效果**一次也没被量过。
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy`（那一记直接摆进判定窗）＋ 真 `CombatManager` ＋ 真事件。
 * 量具沿用 KI-213 那一批搭好的那一套（敌人站在原点、玩家在它正前方 1.6m ⇒ 那一记真的落在玩家身上）。
 *
 * **量到与设计逐字对上的**：完美格挡的**输入窗 5 拍**、**伤害 100% 免除**、**体力不花**（＝「返还 100%」）、
 * **过载 +1**、**架势反弹 8 给攻击者**；弹反成功的**目标架势 +25**、**目标硬直 300ms**、**玩家过载 +2**、
 * **反射弹道 100%**（对照完美格挡的 50%）。
 * **量到的一处登记**：**那个「8」写死在 `CombatManager` 里**（不在 `player.json`）⇒ 与本项目
 * 「数住在数据里」的那条纪律不合（§55）⇒ 本批只登记，不替它搬（搬了要动数据与门禁，另起一批）。
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
  const hits: Array<{ result: string; damage: number; hitStopMs: number }> = []
  const off = bus.on('combat.hit', (p) => hits.push({ result: p.result, damage: p.damage, hitStopMs: p.hitStopMs }))

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

function faceOff(w: World): ReturnType<World['ai']['spawn']> {
  const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'def')
  e.alertness = 100
  e.enter('combat')
  e.skipIntro()
  e.yaw = Math.PI
  const p = w.player
  p.pos = { x: 0, y: 0, z: -1.6 }
  p.yaw = 0
  p.stats.stamina = p.stats.staMax
  return e
}

function strike(w: World, e: ReturnType<World['ai']['spawn']>): void {
  e.attack = newAttack(MALLET, MALLET.frames.activeStart)
  w.tick(1)
  e.attack = null
}

/** 按住格挡键 gap 拍之后挨那一记（格挡：按住 ⇒ 第 gap+1 拍挨打） */
function defend(w: World, mode: 'guard' | 'parry', gap: number): void {
  if (mode === 'guard') {
    w.frame.held.add('guard')
    for (let i = 0; i < gap; i++) w.tick()
    return
  }
  // 弹反：先按下（边沿），再走 gap 拍 ⇒ 那一记落在按下之后的第 gap 拍
  w.frame.edges.add('parry')
  for (let i = 0; i < gap; i++) { w.tick(); w.frame.edges.delete('parry') }
}

describe('KI-215 完美格挡（§5.2）与弹反成功（§5.3）那两族的效果侧：第一次在真链上被量', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 完美格挡的输入窗：前 5 拍挨那一记 ⇒ 完美格挡；第 6 拍起 ⇒ 普通格挡', () => {
    const w = makeWorld()
    const e = faceOff(w)
    defend(w, 'guard', playerBase.perfectBlockWindow - 1) // 第 5 拍
    strike(w, e)
    expect(w.hits[0]?.result, '窗内（第 5 拍）⇒ 完美格挡').toBe('perfectBlock')
    alive.push(w.off)

    const w2 = makeWorld()
    const e2 = faceOff(w2)
    defend(w2, 'guard', playerBase.perfectBlockWindow) // 第 6 拍
    strike(w2, e2)
    expect(w2.hits[0]?.result, '窗外（第 6 拍）⇒ 普通格挡').toBe('block')
    alive.push(w2.off)
  })

  it('腿② 完美格挡：伤害 100% 免除 ＋ 体力不花（＝返还 100%）＋ 过载 +1', () => {
    const w = makeWorld()
    const e = faceOff(w)
    defend(w, 'guard', 1)
    const hp0 = w.player.stats.hp
    const sta0 = w.player.stats.stamina
    const od0 = w.player.stats.overdrive
    strike(w, e)
    expect(w.hits[0]?.result, '前提：这一记走的是完美格挡').toBe('perfectBlock')
    expect(w.hits[0]?.damage, '伤害 100% 免除（事件报 0）').toBe(0)
    expect(w.player.stats.hp, 'HP 一个字节都不许动').toBe(hp0)
    expect(sta0 - w.player.stats.stamina, '体力不花（＝「返还本次应有体力消耗的 100%」的净结果）').toBe(0)
    expect(w.player.stats.overdrive - od0, '共鸣过载 +1（设计 §5.2 那一行）').toBe(1)
    alive.push(w.off)
  })

  it('腿③ 完美格挡：架势反弹 8 给攻击者（**并登记：那个 8 写死在代码里，不在数据表**）', () => {
    const w = makeWorld()
    const e = faceOff(w)
    defend(w, 'guard', 1)
    const poise0 = e.stats.poiseAccum
    strike(w, e)
    expect(w.hits[0]?.result, '前提：这一记走的是完美格挡').toBe('perfectBlock')
    expect(e.stats.poiseAccum - poise0, '架势反弹 8（设计 §5.2 那一行；**这个 8 写死在 `CombatManager` 里** ⇒ 登记）').toBe(8)
    alive.push(w.off)
  })

  it('腿④ 弹反成功：目标架势 +25 ＋ 目标硬直 300ms', () => {
    const w = makeWorld()
    const e = faceOff(w)
    defend(w, 'parry', 1)
    const poise0 = e.stats.poiseAccum
    strike(w, e)
    expect(w.hits[0]?.result, '前提：这一记被弹反了').toBe('parry')
    expect(e.stats.poiseAccum - poise0, '目标架势 +25（设计 §5.3 那一行）').toBe(playerBase.parry.poiseDamage)
    expect(e.stunTicks, '目标硬直 300ms（`parry.stunTicks` 18 拍 ＝ 300ms）').toBe(playerBase.parry.stunTicks)
    alive.push(w.off)
  })

  it('腿⑤ 弹反成功：玩家过载 +2', () => {
    const w = makeWorld()
    const e = faceOff(w)
    defend(w, 'parry', 1)
    const od0 = w.player.stats.overdrive
    strike(w, e)
    expect(w.hits[0]?.result, '前提：这一记被弹反了').toBe('parry')
    expect(w.player.stats.overdrive - od0, '玩家过载 +2（设计 §5.3 那一行）').toBe(playerBase.parry.overdriveGain)
    alive.push(w.off)
  })

  it('腿⑥ 弹反的窗：窗内挨那一记 ⇒ 弹反；窗外 ⇒ 普通受击', () => {
    const w = makeWorld()
    const e = faceOff(w)
    defend(w, 'parry', playerBase.parry.activeTicks - 2) // 窗还没关
    strike(w, e)
    expect(w.hits[0]?.result, '窗内 ⇒ 弹反').toBe('parry')
    alive.push(w.off)

    const w2 = makeWorld()
    const e2 = faceOff(w2)
    defend(w2, 'parry', playerBase.parry.activeTicks) // 窗关了
    strike(w2, e2)
    expect(w2.hits[0]?.result, '窗外 ⇒ 普通受击').toBe('hit')
    alive.push(w2.off)
  })

  it('腿⑦ 弹反成功：反射弹道 100%（对照完美格挡的 50%）', () => {
    /** 弹体撞人：主人挨的那一下（弹反 ⇒ 反射回主人，伤害按表里的比例） */
    const reflect = (mode: 'parry' | 'guard'): number => {
      const w = makeWorld()
      const e = faceOff(w)
      const p = w.player
      p.pos = { x: 0, y: 0, z: 0 }
      e.pos = { x: 0, y: 0, z: -6 }
      p.yaw = Math.PI // 面朝来弹的方向（弹反那一支判「人面不面向来那一记」）
      e.stats.defense = 0 // 承伤侧清成公平量具（读的就是「反射回来多少伤害」）
      const ehp0 = e.stats.hp
      const pr = w.combat.projectiles.spawn({
        hostile: true, ownerId: e.id, kind: 'shard', origin: { x: 0, y: 1.1, z: -2 }, dir: { x: 0, y: 0, z: 1 },
        speed: 13, range: 20, radius: 0.45, damage: 30, poise: 10, hitStopMs: 60,
      }, w.time.tick)
      for (let i = 0; i < 5; i++) w.tick() // 弹体飞到玩家跟前
      if (mode === 'parry') {
        w.frame.edges.add('parry')
        w.tick()
        w.frame.edges.delete('parry')
      } else {
        w.frame.held.add('guard')
        w.tick()
      }
      for (let i = 0; i < 120 && w.combat.projectiles.live > 0; i++) w.tick()
      const lost = ehp0 - e.stats.hp
      void pr
      w.off()
      return lost
    }
    const parried = reflect('parry')
    const blocked = reflect('guard')
    expect(parried, '弹反的反射：主人挨的是**整记**伤害（`parry.projectileReflectMul` ＝ 1）').toBeGreaterThan(blocked)
    expect(blocked, '完美格挡的反射：主人挨的是一半（`guard.perfectBlockReflectMul` ＝ 0.5）').toBeGreaterThan(0)
    expect(parried, '两条反射的伤害比 ＝ 100% / 50% ＝ 2（容差留给结算那点方差）')
      .toBeGreaterThan(blocked * 1.6)
    alive.push(() => { /* 两个世界的 off 都在各自函数里摘了 */ })
  })
})
