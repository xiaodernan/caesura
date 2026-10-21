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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * KI-257：**§12「伤害公式」那一行第一次在真链上被量**
 * （combat.md §12：`final = base × wScale(attr) × combo × onBeatBonus × rand(0.95,1.05) × (1-DR)`）。
 *
 * **那一行的六项，逐项的载体在哪**：
 * - **base** ✔（招式表的帧伤害，走那一条伤害通道）
 * - **wScale(attr)** ✔（武器的 scaling × 玩家的属性）
 * - **combo** ✘（`comboStageMul` 在 `src/` 里**没有任何调用方**）
 * - **onBeatBonus** ✘（**只在架势那一侧**：拍点内 ×2 架势；**伤害这一侧没有承载体**）
 * - **rand(0.95,1.05)** ✔
 * - **(1-DR)** ✔（`DR = defense/(defense+120)`，远程那一层 ×0.6，封顶 0.55）
 *
 * **量具上的四条纪律（这一批自己撞出来的）**：
 * ① **随机项会把比值搅浑** ⇒ 两次测量要**逐拍对齐**（同样的步数 ⇒ 同一个种子 ⇒ 同一个随机数），
 *    否则比值里混着 ±5% 的随机噪声，比什么都量不准；
 * ② **敌人名册是模块级的**（`Enemy.bindEnemyRegistry`）⇒ 同一个进程里别的世界留下的怪还站在原地，
 *    ⇒ 事件必须**按 victimId 认领**（这一批第一稿就栽在这里：读到的是上一只死掉的怪）；
 * ③ **敌人的朝向会自己漂**（idle 状态也在转）⇒ `isBackstab` 那一判会随机翻面（背刺 ×2），
 *    ⇒ **每一拍把那只怪的朝向钉回面向玩家**，否则同一格两次读数能差一倍；
 * ④ **把底数抬起来再量**：舍入会把 ±5% 的随机项吃掉（9 点底数 ⇒ 每一记都取整成 9 ⇒ 随机项看不见了），
 *    ⇒ 用属性把底数抬到几百（`rpg.attrs`），或者用 `combat.damageScale` 把敌人那一记抬起来。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 * 设计那一行与真读数对不上时**腿钉住真读数、把差额写进消息** ⇒ 只量不裁（设计没裁）。
 */

registerGameData()

const FOE = 'en_tympanus'
const MALLET = registry.get<EnemyData>(FOE).attacks.find((a) => a.id === 'mallet')!

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
  const hits: any[] = []
  const off = bus.on('combat.hit', (p: any) => hits.push({ ...p }))
  /** 每拍都要做的事（把量具钉死：朝向、站位、体力） */
  const pins: Array<() => void> = []
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      for (const pin of pins) pin()
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, off, pins }
}

type World = ReturnType<typeof makeWorld>

/** 那只怪的朝向每拍都被钉回「面向玩家」⇒ 背刺那一判不会随机翻面 */
function pinFacing(w: World, e: { pos: { x: number; z: number }; yaw: number }): void {
  w.pins.push(() => {
    const p = w.player.pos
    e.yaw = Math.atan2(p.x - e.pos.x, p.z - e.pos.z)
  })
}

/** 玩家站在原地打的那只怪（认领用 id 过滤：模块级名册里还站着别的世界的怪） */
function dummy(w: World, id = 'en_murkshell') {
  const e = w.ai.spawn(id, { x: 0, y: 0, z: -1.6 }, 'probe')
  e.alertness = 0
  e.enter('idle')
  e.stats.hpMax = 999999
  e.stats.hp = 999999
  const p = w.player
  p.pos = { x: 0, y: 0, z: 0 }
  p.yaw = Math.PI
  p.camYawRef = Math.PI + p.yaw
  pinFacing(w, e)
  return e
}

/** 玩家出一记轻击，认领自己那只怪身上的那一记 */
function swing(w: World, e: ReturnType<World['ai']['spawn']>): { damage: number; poiseDamage: number; hitStopMs: number; backstab: boolean } {
  w.frame.edges.add('attackLight')
  w.tick()
  w.frame.edges.delete('attackLight')
  for (let i = 0; i < 120 && w.hits.filter((h) => h.victimId === e.id).length === 0; i++) w.tick()
  const h = w.hits.filter((x) => x.victimId === e.id)[0]
  return {
    damage: h?.damage ?? -1,
    poiseDamage: h?.poiseDamage ?? -1,
    hitStopMs: h?.hitStopMs ?? -1,
    backstab: h?.backstab ?? false,
  }
}

/** 敌人那一记（大槌）打在玩家身上；def 是玩家的 defense，scale 把底数抬起来 */
function hammer(w: World, def: number, scale: number): number {
  w.combat.damageScale = scale
  const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'probe')
  e.alertness = 100
  e.enter('combat')
  e.skipIntro()
  e.yaw = Math.PI
  const p = w.player
  p.pos = { x: 0, y: 0, z: -1.6 }
  p.yaw = 0
  p.stats.hpMax = 99999
  p.stats.hp = 99999
  p.stats.defense = def
  pinFacing(w, e)
  e.attack = newAttack(MALLET, MALLET.frames.activeStart)
  w.tick(1)
  e.attack = null
  for (let i = 0; i < 90 && w.hits.filter((h) => h.victimId === 'player').length === 0; i++) w.tick()
  const h = w.hits.filter((x) => x.victimId === 'player')[0]
  return h?.damage ?? -1
}

/** 远程弹体打在玩家身上 */
function shard(w: World, def: number, scale: number): number {
  w.combat.damageScale = scale
  const p = w.player
  p.pos = { x: 0, y: 0, z: 0 }
  p.stats.hpMax = 99999
  p.stats.hp = 99999
  p.stats.defense = def
  w.combat.projectiles.spawn({
    hostile: true, ownerId: 'en_test', kind: 'shard', origin: { x: 0, y: 1.1, z: -6 }, dir: { x: 0, y: 0, z: 1 },
    speed: 13, range: 20, radius: 0.45, damage: 30, poise: 10, hitStopMs: 60,
  }, w.time.tick)
  for (let i = 0; i < 90 && w.hits.filter((h) => h.victimId === 'player').length === 0; i++) w.tick()
  const h = w.hits.filter((x) => x.victimId === 'player')[0]
  return h?.damage ?? -1
}

describe('KI-257 §12 伤害公式那一行：rand／(1-DR)／wScale／onBeat／combo', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **rand(0.95,1.05) 那一项有承载体**：同一记连打六次，伤害**不是常数**，而且每一记都落在那一档里', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'probe')
    e.alertness = 100
    e.enter('combat')
    e.skipIntro()
    const p = w.player
    p.pos = { x: 0, y: 0, z: -1.6 }
    p.yaw = 0
    p.stats.hpMax = 999999
    p.stats.hp = 999999
    p.stats.defense = 0 // 玩家自己的 defense 不是 0（属性 vig 那一层会给它一点）⇒ 不钉住的话 (1-DR) 会从那一档里咬掉一口
    e.stats.hpMax = 999999
    e.stats.hp = 999999
    w.combat.damageScale = 20 // 大槌的帧伤害 34 × 20 ＝ 680 ⇒ 舍入吃不掉 ±5%
    pinFacing(w, e)
    const seen: number[] = []
    for (let k = 0; k < 6; k++) {
      e.attack = newAttack(MALLET, MALLET.frames.activeStart)
      w.tick(1)
      e.attack = null
      for (let i = 0; i < 60 && w.hits.filter((h) => h.victimId === 'player').length === k; i++) w.tick()
      const h = w.hits.filter((x) => x.victimId === 'player')[k]
      seen.push(h?.damage ?? -1)
      p.stats.hp = 999999
    }
    const lo = 680 * 0.95
    const hi = 680 * 1.05
    for (const d of seen) {
      expect(d, `每一记都落在 680 × [0.95, 1.05] ＝ [${lo}, ${hi}] 里（设计 §12「rand(0.95,1.05)」那一项）`).toBeGreaterThanOrEqual(Math.floor(lo))
      expect(d, '……也在那一档的上沿之内').toBeLessThanOrEqual(Math.ceil(hi))
    }
    expect(new Set(seen).size, '**六记里至少有两个不同的数**（随机项真的在（同一记、同一目标、同一底数））').toBeGreaterThanOrEqual(2)
    expect(Math.max(...seen) - Math.min(...seen), '六记的落差（不是舍入那一档的抖动 ⇒ 随机项的幅度看得见）').toBeGreaterThan(1)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿② **(1-DR) 那一项有承载体**：防御 0 与 60 的两个世界，伤害之比是 **2/3**（＝ 1 − 60/(60+120)）', () => {
    const a = makeWorld()
    const d0 = hammer(a, 0, 20)
    a.off()
    const b = makeWorld()
    const d60 = hammer(b, 60, 20)
    b.off()
    expect(d0, '防御 0 那一记的伤害（大槌 34 × 20 ＝ 680 × 随机项）').toBe(696)
    expect(d60, '防御 60 那一记的伤害（＝ 上一记 × (1 − 60/(60+120)) ＝ × 2/3）').toBe(464)
    expect(d60 / d0, '两个世界的伤害之比（**DR = defense/(defense+120)** ⇒ (1−DR) = 2/3；两个世界逐拍对齐 ⇒ 同一个随机数 ⇒ 比值干净）').toBeCloseTo(2 / 3, 2)
  })

  it('腿③ **DR 的远程那一层（dr × 0.6）有承载体**：同一对防御，远程那一记之比是 **0.8**（＝ 1 − 0.6 × 1/3）', () => {
    const a = makeWorld()
    const d0 = shard(a, 0, 20)
    a.off()
    const b = makeWorld()
    const d60 = shard(b, 60, 20)
    b.off()
    expect(d0, '防御 0 那一记远程伤害（弹体 30 × 20 ＝ 600 × 随机项）').toBe(614)
    expect(d60, '防御 60 那一记远程伤害（＝ 上一记 × (1 − 0.6 × 1/3) ＝ × 0.8）').toBe(491)
    expect(d60 / d0, '两个世界的远程伤害之比（**远程那一层：DR 先乘 0.6**；两个数都取整过 ⇒ 容差放在舍入那一档上）').toBeCloseTo(0.8, 2)
  })

  it('腿④ **wScale(attr) 那一项有承载体**：属性吃进伤害（str 0 ↔ 1000，dex 固定 1000 ⇒ 比值 1.6）', () => {
    const a = makeWorld()
    const e0 = dummy(a)
    a.player.rpg.attrs.dex = 1000
    a.player.rpg.attrs.str = 0
    const d0 = swing(a, e0)
    expect(d0.backstab, '前提：这一记**不是背刺**（背刺是 ×2 ⇒ 那一项不是本腿要量的）').toBe(false)
    a.ai.despawn(e0.id)
    a.off()
    const b = makeWorld()
    const e1 = dummy(b)
    b.player.rpg.attrs.dex = 1000
    b.player.rpg.attrs.str = 1000
    const d1 = swing(b, e1)
    expect(d1.backstab, '前提：这一记**不是背刺**').toBe(false)
    b.ai.despawn(e1.id)
    b.off()
    expect(d0.damage, 'str 0 那一记的伤害（底数 9 × 属性倍率 10）').toBe(92)
    expect(d1.damage, 'str 1000 那一记的伤害（底数 9 × 属性倍率 16 ⇒ str 的 scaling 是 0.6、dex 的是 0.9）').toBe(147)
    expect(d1.damage / d0.damage, '两个世界的伤害之比（＝ (1 + (1000×0.6 + 1000×0.9)/100) ÷ (1 + (0×0.6 + 1000×0.9)/100) ＝ 16 ÷ 10）').toBeCloseTo(1.6, 2)
  })

  it('腿⑤ **onBeatBonus 那一项在伤害这一侧没有承载体**：拍点内外**伤害一模一样**（它只加在架势上）⇒ 登记', () => {
    const on = makeWorld()
    for (let i = 0; i < 200; i++) {
      if (Math.abs(on.rhythm.info().phase) < 0.012) break
      on.tick()
    }
    on.rhythm.paused = true
    const eOn = dummy(on)
    const hOn = swing(on, eOn)
    const poiseOn = eOn.stats.poiseAccum
    on.off()

    const off = makeWorld()
    for (let i = 0; i < 200; i++) {
      if (Math.abs(off.rhythm.info().phase - 0.5) < 0.012) break
      off.tick()
    }
    off.rhythm.paused = true
    const eOff = dummy(off)
    const hOff = swing(off, eOff)
    const poiseOff = eOff.stats.poiseAccum
    off.off()

    expect(hOn.hitStopMs, '拍点内那一记的停顿（**60 + 30** ⇒ 拍点分支真的走了；设计 §9「命中落在拍点 ±50ms 内额外 +30ms」，KI-243 已量）').toBe(90)
    expect(hOff.hitStopMs, '拍点外那一记的停顿（60）').toBe(60)
    expect(poiseOn, '拍点内那一记打在敌人身上的架势累积（**×2**：6 → 12；KI-245 已量过架势那一半）').toBe(12)
    expect(poiseOff, '拍点外那一记的架势累积（6）').toBe(6)
    expect(hOn.damage, '**拍点内那一记的伤害**（与拍点外**一模一样** ⇒ 设计 §12 那个式子里的 `onBeatBonus` 在伤害这一侧没有承载体 ⇒ 只量不裁）').toBe(hOff.damage)
  })

  it('腿⑥ **combo 那一项没有承载体**：`comboStageMul` 在 `src/` 里只有定义、没有调用方（`src/combat/DamagePipeline.ts`）', () => {
    const root = join(process.cwd(), 'src')
    const files: string[] = []
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name)
        if (name.endsWith('.ts')) files.push(p)
        else if (name.endsWith('.mts')) files.push(p)
        else {
          try { walk(p) } catch { /* 不是目录 */ }
        }
      }
    }
    walk(root)
    const callers = files.filter((f) => readFileSync(f, 'utf8').includes('comboStageMul(') && !f.endsWith('DamagePipeline.ts'))
    expect(callers, '**`comboStageMul` 在 `src/` 里没有任何调用方** ⇒ 设计 §12 那个式子里的 `combo` 那一项在运行时没有承载体（链上量不出来：随机项 ±5% 盖住了那 0.95 ⇒ 只量不裁）').toEqual([])
  })
})
