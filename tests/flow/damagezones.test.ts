import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { Rng } from '@/core/Math'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { DamageBand, EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack } from '@/ai/Enemy'
import { bandDamage } from '@/combat/HitShapes'

/**
 * §15.1 P3「拍 1 落点震波**外环 20 内环 36**」（KI-057）。
 *
 * 这句设计文本在此之前是空的：一招收势帧只带一个 `damage`，`ring` 只有形状没有档位，
 * 于是"站得近更疼"在运行时一无所知——和 §8.2 那批「数值承诺没有机制腿」同一类债。
 * 现在它有一张表（`FrameData.bands`）和一个读者（`Enemy.bandedDamage`）。
 *
 * 分层：纯查表（口径边界）/ 数据表（那句数字逐字在表里）/ 玩法流（同一记，只挪腿）。
 */

registerGameData()

const ostlara = registry.get<EnemyData>('en_ostlara')
const SMASH = ostlara.attacks.find((a) => a.id === 'bellsmash')!
const PENDULUM = ostlara.attacks.find((a) => a.id === 'pendulum')!

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(108, 3)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const sword = registry.get<WeaponData>('wp_fortissimo_greatsword')
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  // 被测的是「她这一记落在哪一环」，不是玩家的续航
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999

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

  /**
   * 只走一格，但在 `ai.update` 与 `combat.update` **之间**插一刀。
   * 为什么要这个形状：bellsmash 带着 `lunge: 1.5`（§15.1「假慢真远」），AI 那一格会把爆心
   * 朝玩家挪 1.5m，于是"我摆了 2.6m"在结算那一格其实是 1.1m。那是时序腿的事，不该混进
   * 档位的尺子里——挪爆心的那一步与量距离的那一步之间，就是这里。
   */
  function tickPinned(pin: () => void): void {
    time.tick++
    time.reset()
    player.update(TICK_DT, time, input, time.tick, rhythm)
    ai.update(TICK_DT, time.tick, player, rhythm)
    pin()
    combat.update(time.tick, input, TICK_DT)
    frame.edges.clear()
    rhythm.update(TICK_DT)
  }
  return { time, rhythm, player, ai, combat, tick, tickPinned }
}
type W = ReturnType<typeof makeWorld>
function world(): W {
  const w = makeWorld()
  // 方差是 `resolveDamage` 的 ±5%，与档位无关；钉住种子 ⇒ 两档之差就是档位之差
  w.combat.rng = new Rng('zone-variance')
  return w
}

/**
 * 她站在原点，玩家摆在离她 `dist` 米处，一记 bellsmash 的判定窗当帧落下。
 * 返回玩家这一 tick 掉的血（0 = 这一记没打上——本文件禁止用 0 冒充"外环很轻"）。
 */
function eat(w: W, spec: typeof SMASH, dist: number, buffDmgMul?: number): number {
  const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: 0 }, 'zone')
  e.alertness = 100
  e.enter('combat')
  e.skipIntro()
  const p = w.player
  // 承伤侧清成公平量具：防御归零（否则两档被同一个 reduction 压掉，读数全带小数），
  // 格挡/硬直/演出压平——那些是防御阶梯的账，不是落点的账。
  p.stats.defense = 0
  p.guardTicks = 0
  p.stunTicks = 0
  p.executing = null
  p.roll = null
  p.action = null
  p.pos.x = dist
  p.pos.y = 0
  p.pos.z = 0
  p.yaw = Math.PI
  // 直接把招式摆进判定窗：前摇那 200 tick 是 §15.1 的时序，已由 boss.test.ts 钉住
  e.attack = newAttack(spec, spec.frames.activeStart)
  const before = p.stats.hp
  // 光环也在这里摆：`e.buff` 由 AISystem 每 tick 从光环来源重算，放在 tick 之前会被冲掉
  //（实测：冲掉之后 ×1.2 那条腿读回 37→37 的"没生效"，被当成生效就是假绿）。
  w.tickPinned(() => {
    e.pos.x = 0; e.pos.y = 0; e.pos.z = 0
    if (buffDmgMul) e.buff = { attackSpeedMul: 1, dmgMul: buffDmgMul, fromId: 'refrein-test' }
  })
  e.attack = null
  return before - p.stats.hp
}

/** 方差带：`resolveDamage` 的 ±5%（乘数在 [0.95,1.05)，向下取整） */
function inBand(dmg: number, base: number): boolean {
  return dmg >= Math.floor(base * 0.95) && dmg <= Math.ceil(base * 1.05)
}

describe('纯查表：bands 的三条口径', () => {
  const bands: DamageBand[] = [{ outer: 2.5, damage: 36 }, { outer: 5, damage: 20 }]

  it('由近及远取第一档；恰好压线算内环', () => {
    expect(bandDamage(bands, 0)).toBe(36)
    expect(bandDamage(bands, 2.5)).toBe(36)
    expect(bandDamage(bands, 2.51)).toBe(20)
    expect(bandDamage(bands, 5)).toBe(20)
  })

  it('球心落在最后一档之外 ⇒ 仍取最后一档（外沿），不是第一档', () => {
    // 能打上却在环外，只可能是目标体积从外沿探进来（判定容差 0.55m）。
    // 兜底若兜成内环，就是"你被体积蹭到所以最疼"——那是把容差当成惩罚。
    expect(bandDamage(bands, 5.55)).toBe(20)
    expect(bandDamage(bands, 99)).toBe(20)
  })

  it('查表按数组顺序 ⇒ 表必须有序；这条说明 validator 为什么逼 outer 严格递增', () => {
    // 乱序这份表先撞上外档：站 1m 读到 20。这不是"允许乱序"，是它的后果。
    expect(bandDamage([{ outer: 5, damage: 20 }, { outer: 2.5, damage: 36 }], 1)).toBe(20)
    expect(SMASH.frames.bands!.map((b) => b.outer), ' shipped 表有序').toEqual([2.5, 5])
  })
})

describe('数据表：§15.1 那句「外环 20 内环 36」现在逐字在表里', () => {
  it('两档、内重外轻、最后一档正好铺满 r=5m 的落点', () => {
    const f = SMASH.frames
    expect(f.bands, '没写 bands ⇒ 这条设计文本又变回空话').toEqual([
      { outer: 2.5, damage: 36 },
      { outer: 5, damage: 20 }
    ])
    const hb = f.hitbox!
    expect(hb.shape).toBe('ring')
    if (hb.shape === 'ring') {
      expect(hb.outer + hb.forward, '档位外沿 == 可达外沿（留缝＝打得到却没档）').toBe(5)
    }
    expect(f.damage, 'damage 是"最深那一档"的读数，不是第三个主人').toBe(Math.max(...f.bands!.map((b) => b.damage)))
    expect(f.bands![0].damage, '内环必须比外环疼，否则"往里站"没有代价').toBeGreaterThan(f.bands![1].damage)
  })

  it('全场只有这一招分环：其余 ring 招式仍然单伤害（不为好看把每张表都改一遍）', () => {
    const all = registry.ids('en_').map((id) => registry.get<EnemyData>(id))
    const banded = all.flatMap((d) => d.attacks.filter((a) => a.frames.bands).map((a) => `${d.id}/${a.id}`))
    expect(banded).toEqual(['en_ostlara/bellsmash'])
  })
})

describe('玩法流：同一记拔钟抡砸，只挪一下腿，吃的伤害就不同', () => {
  it('贴身（1.8m）吃内环 36', () => {
    const dmg = eat(world(), SMASH, 1.8)
    expect(dmg, '一档都没吃着＝这一记根本没打上，别让 0 冒充"外环很轻"').toBeGreaterThan(0)
    expect(inBand(dmg, 36), `内环读数 ${dmg} 不在 36±5% 里`).toBe(true)
  })

  it('退到环边（4.2m）吃外环 20 —— 同一招、同一个种子、同一个判定窗', () => {
    const dmg = eat(world(), SMASH, 4.2)
    expect(inBand(dmg, 20), `外环读数 ${dmg} 不在 20±5% 里`).toBe(true)
  })

  it('档位边界（2.5m / 2.6m）真的在腿下一步之间翻转', () => {
    const a = eat(world(), SMASH, 2.5)
    const b = eat(world(), SMASH, 2.6)
    expect(inBand(a, 36) && inBand(b, 20), `边界两侧 ${a} / ${b}`).toBe(true)
  })

  it('5.6m：判定容差（5 + 0.55）之外 ⇒ 这一记落空，0 伤害', () => {
    // 钉的是"分环没有偷偷把射程拉长"——bands 只改伤害，不改 shapeHits。
    expect(eat(world(), SMASH, 5.6)).toBe(0)
  })

  it('定调光环（§14.6 dmgMul）乘的是"档位取完之后"的那个数：外环 ×1.2 ⇒ 24，不是内环的 43', () => {
    const plain = eat(world(), SMASH, 4.2)
    const buffed = eat(world(), SMASH, 4.2, 1.2)
    expect(inBand(plain, 20), `无光环 ${plain}`).toBe(true)
    expect(inBand(buffed, 24), `×1.2 之后 ${buffed}`).toBe(true)
    expect(inBand(buffed, 43), '若这一格读到 43，说明倍率乘到了错误的档位上').toBe(false)
  })

  it('bandedDamage 直读：三档边界逐字等值，没写 bands 的招式交白卷', () => {
    const w = world()
    const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: 0 }, 'buff')
    e.attack = newAttack(SMASH, SMASH.frames.activeStart)
    expect(e.bandedDamage({ x: 1.8, y: 0, z: 0 })).toBe(36)
    expect(e.bandedDamage({ x: 2.5, y: 0, z: 0 })).toBe(36)
    expect(e.bandedDamage({ x: 2.6, y: 0, z: 0 })).toBe(20)
    expect(e.bandedDamage({ x: 99, y: 0, z: 0 }), '环外取最后一档，不取第一档').toBe(20)
    e.buff = { attackSpeedMul: 1, dmgMul: 1.2, fromId: 'refrein-test' }
    expect(e.bandedDamage({ x: 1.8, y: 0, z: 0 })).toBe(Math.round(36 * 1.2))
    expect(e.bandedDamage({ x: 4.2, y: 0, z: 0 })).toBe(Math.round(20 * 1.2))
    e.attack = newAttack(PENDULUM, PENDULUM.frames.activeStart)
    expect(e.bandedDamage({ x: 1.8, y: 0, z: 0 }), '没写 bands 的招式必须交白卷，让调用方走 damage 那一格').toBeNull()
  })

  it('反向对照：没写 bands 的 pendulum 在远近两处吃同一个数（档位是声明式的，不是默认规则）', () => {
    // pendulum 是 inner 0.6 / outer 3.6 的环：两处都在环内，伤害必须同为 28。
    const near = eat(world(), PENDULUM, 1.2)
    const far = eat(world(), PENDULUM, 3.0)
    expect(inBand(near, 28), `近处 ${near}`).toBe(true)
    expect(inBand(far, 28), `远处 ${far}`).toBe(true)
    expect(far, '同一记的同一档，距离不该改数字').toBe(near)
  })
})
