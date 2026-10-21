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
 * KI-217：**「弹反的限制」与「完美格挡的盾向通用」那两行**第一次在真链上被量
 * （combat.md §5.3 限制行 ＋ §5.2「对 Boss 大型挥砍同样生效（盾向通用）」）。
 *
 * KI-215 量的是"**能**弹反的那一记"的效果；这一批量的是"**不能**弹反的那一记"——
 * 每种攻击数据带一个 `parryable` 布尔（防万能解），于是同一记有两种结局：
 *
 * | | 弹反 | 完美格挡 |
 * |---|---|---|
 * | `parryable: true`（针喉的 mallet） | 弹反 | 完美格挡 |
 * | **`parryable: false`（针喉的 stomp／奥斯塔拉的 bellsmash）** | **吃不住**（按普通受击结算） | **照样接得住** |
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy`（那一记直接摆进判定窗）＋ 真 `CombatManager` ＋ 真事件。
 */

registerGameData()

const FOE = 'en_tympanus'
const STOMP = registry.get<EnemyData>(FOE).attacks.find((a) => a.id === 'stomp')!
const SMASH = registry.get<EnemyData>('en_ostlara').attacks.find((a) => a.id === 'bellsmash')!

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
type Spec = { id: string; frames: { damage: number; activeStart: number } }

/** 敌人站在原点、玩家在它正前方 1.6m（环 0..4／0..5 都罩得住） */
function faceOff(w: World, spec: Spec): ReturnType<World['ai']['spawn']> {
  const e = w.ai.spawn(spec.id === 'stomp' ? FOE : 'en_ostlara', { x: 0, y: 0, z: 0 }, 'def')
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

function strike(w: World, e: ReturnType<World['ai']['spawn']>, spec: Spec): void {
  e.attack = newAttack(spec as never, spec.frames.activeStart)
  w.tick(1)
  e.attack = null
}

describe('KI-217 弹反的限制与完美格挡的盾向通用：第一次在真链上被量', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 弹反吃不住不可弹反的招式（`parryable: false` ⇒ 那一记按普通受击结算）', () => {
    const w = makeWorld()
    const e = faceOff(w, STOMP as Spec)
    w.frame.edges.add('parry')
    w.tick()
    w.frame.edges.delete('parry')
    const od0 = w.player.stats.overdrive
    strike(w, e, STOMP as Spec)
    expect(STOMP.parryable, '前提：这一记在数据里就写着不可弹反').toBe(false)
    expect(w.hits[0]?.result, '弹反吃不住 ⇒ 那一记按普通受击结算（设计 §5.3 限制行）').toBe('hit')
    expect(w.player.stats.overdrive - od0, '弹反没有过载收益（那一记根本没被弹中）').toBe(0)
    alive.push(w.off)
  })

  it('腿② 那一记仍然吃掉弹反窗：落空赌注 ×1.25 ＋ 落空后摇（**设计只说"不生效"，没说"吃掉窗" ⇒ 只量不裁**）', () => {
    const plain = makeWorld()
    const e0 = faceOff(plain, STOMP as Spec)
    const hp0 = plain.player.stats.hp
    strike(plain, e0, STOMP as Spec)
    const plainLoss = hp0 - plain.player.stats.hp
    alive.push(plain.off)

    const w = makeWorld()
    const e = faceOff(w, STOMP as Spec)
    w.frame.edges.add('parry')
    w.tick()
    w.frame.edges.delete('parry')
    const hp1 = w.player.stats.hp
    strike(w, e, STOMP as Spec)
    const loss = hp1 - w.player.stats.hp
    expect(w.hits[0]?.result, '前提：这一记没被弹中').toBe('hit')
    // **这两个数是设计那一行写死的**（combat.md §5.3「失败」行：落空后摇 **450ms/27f**、期间被击伤害 **×1.25**）
    // ⇒ 腿里手钉设计的数、**不读数据表的数**：读数据表的话，数据一改腿也跟着改 ⇒ 那一格就没人守了。
    const ratio = loss / plainLoss
    expect(ratio, '落空赌注 ×1.25（设计 §5.3「失败」那一行；容差留给结算那点方差与取整）')
      .toBeGreaterThan(1.15)
    expect(ratio, '……而且只比它高一点点（不许更狠，也不许更轻）')
      .toBeLessThan(1.35)
    expect(w.player.parryWhiffTicks, '落空后摇 = 27 拍（设计 §5.3 那一行）').toBe(27)
    alive.push(w.off)
  })

  it('腿③ 完美格挡照样接得住不可弹反的招式（⇒ 与弹反**不对称**；设计 §5.2「盾向通用」那一行）', () => {
    const w = makeWorld()
    const e = faceOff(w, STOMP as Spec)
    w.frame.held.add('guard')
    w.tick()
    const hp0 = w.player.stats.hp
    const od0 = w.player.stats.overdrive
    strike(w, e, STOMP as Spec)
    expect(w.hits[0]?.result, '完美格挡不看 `parryable` ⇒ 照样接得住').toBe('perfectBlock')
    expect(w.player.stats.hp, '伤害 100% 免除').toBe(hp0)
    expect(w.player.stats.overdrive - od0, '共鸣过载 +1（完美格挡那一族的效果照旧）').toBe(1)
    alive.push(w.off)
  })

  it('腿④ Boss 那一记也一样：奥斯塔拉的 bellsmash（`parryable: false`、伤害 36）⇒ 弹反吃不住、完美格挡接得住', () => {
    const w = makeWorld()
    const e = faceOff(w, SMASH as Spec)
    w.frame.edges.add('parry')
    w.tick()
    w.frame.edges.delete('parry')
    strike(w, e, SMASH as Spec)
    expect(SMASH.parryable, '前提：那一记在数据里就写着不可弹反').toBe(false)
    expect(w.hits[0]?.result, 'Boss 的大型挥砍：弹反吃不住（设计 §5.3 限制行）').toBe('hit')
    alive.push(w.off)

    const w2 = makeWorld()
    const e2 = faceOff(w2, SMASH as Spec)
    w2.frame.held.add('guard')
    w2.tick()
    strike(w2, e2, SMASH as Spec)
    expect(w2.hits[0]?.result, '同一记：完美格挡照样接得住（设计 §5.2「对 Boss 大型挥砍同样生效（盾向通用）」）')
      .toBe('perfectBlock')
    alive.push(w2.off)
  })
})
