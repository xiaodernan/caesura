import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { bus } from '@/core/EventBus'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'

/**
 * 律具·音叉杖的两格独特属性（combat.md §4.5 独特属性行 + 战技槽行，progression.md §4 build7）：
 *  · **「乐章战技在此杖上有 +25% 射程」**——`skillRangeMul: 1.25`，只在 `action.skill` 那条
 *    弹体路上乘（武器自己的招式不吃这格）；
 *  · **「弹反成功 = 向目标回授 12 伤害（音叉共鸣叙事）」**——`parryReflect: 12`，在
 *    `resolveAgainstPlayer` 的弹反分支按 attackerId 回查实体（近战与弹体两条路都挂着同一格），
 *    走 strikeEnemy 同一条管线（吃防御阶梯，不是真伤）。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld(weaponId: string) {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  player.pos = { x: 0, y: 0, z: 0 }
  player.grounded = true
  player.floorY = 0
  player.camYawRef = 0
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.grounded = true
      player.floorY = 0
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  const cleanup = (): void => { for (const e of [...ai.enemies]) ai.despawn(e.id) }
  alive.push(cleanup)
  return { time, rhythm, player, ai, combat, input, frame, tick, cleanup }
}

describe('律具·音叉杖：战技射程 +25% 与弹反回授 12', () => {
  it('表形状：杖写 skillRangeMul 1.25 与 parryReflect 12；其余武器都没有这两格', () => {
    registerGameData()
    const st = registry.get<WeaponData>('wp_tuningfork_staff')
    expect(st.skillRangeMul).toBe(1.25)
    expect(st.parryReflect).toBe(12)
    for (const id of registry.ids('wp_').filter((x) => x !== 'wp_tuningfork_staff')) {
      const w = registry.get<WeaponData & { skillRangeMul?: number; parryReflect?: number }>(id)
      expect(w.skillRangeMul, `${id} 不该有战技射程格`).toBeUndefined()
      expect(w.parryReflect, `${id} 不该有回授格`).toBeUndefined()
    }
  })

  it('乐章战技的弹体射程 ×1.25：技能弹比表值飞得远（武器弹不受这格影响）', () => {
    const w = makeWorld('wp_tuningfork_staff')
    // 杖的远程是蓄力战技「共振弹」（ms_staff.charged，表值 range 22）——蓄力释放沿走的
    // 也是 tryStartAction('charged')，这里直接以该键出手（同一入口）
    const before = w.combat.projectiles.list().length
    expect(w.player.tryStartAction('charged', w.time.tick), '共振弹出手').toBe(true)
    // 出海**当拍**读剩余射程（rangeLeft 随飞行递减，读晚一拍就少一拍的路程）
    let got: number | null = null
    for (let t = 0; t < 40 && got === null; t++) {
      w.tick(1)
      if (w.combat.projectiles.list().length > before) {
        got = (w.combat.projectiles.list()[0] as unknown as { rangeLeft: number }).rangeLeft
      }
    }
    expect(got, '弹体已出海且当拍读到射程').not.toBeNull()
    // 出海当拍已积掉一拍的路程（24m/s ÷ 60 = 0.4m）：剩余 ∈ [27.5−0.4, 27.5]
    expect(got!, '共振弹射程 = 表值 22 × 1.25 = 27.5（扣一拍首程 0.4）').toBeGreaterThanOrEqual(22 * 1.25 - 24 / 60 - 1e-6)
    expect(got!).toBeLessThanOrEqual(22 * 1.25 + 1e-6)
    w.cleanup()
  })

  it('弹反回授 12（近战那条路）：真弹反那一拍，攻击者挨一记以 12 为底数的回授', () => {
    const w = makeWorld('wp_tuningfork_staff')
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 1.6 }, 'staff-parry')
    e.alertness = 100
    e.enter('chase')
    const playerHits: number[] = []
    const off = bus.on('combat.hit', (p) => { if (p.attackerId === 'player' && p.victimId === e.id) playerHits.push(p.damage) })
    let parried = false
    for (let t = 0; t < 900 && !parried; t++) {
      const atk = e.attack
      if (atk && atk.tick === atk.spec.frames.startup - 3) w.player.parryTicksLeft = w.player.base.parry.activeTicks
      w.player.stats.hp = w.player.stats.hpMax // 木桩的普通刀不杀我（读数对象是回授那一记）
      w.tick(1)
      parried = playerHits.length > 0
    }
    off()
    expect(parried, '900 tick 里弹反至少一次且回授落账').toBe(true)
    // 底数 12 × 管线（杖的属性 scaling 与 ±5% 随机项）。scaling 不抄第二份——用**参照比**钉：
    // 同一管线打一记已知底数的普通攻击（杖 l1 底数 7），回授/12 与参照/7 应同乘同一倍率
    const ref = referenceHit(w, 7)
    const k = ref / 7
    expect(playerHits[0] / 12, `回授底数 12 × 同一管线倍率（参照实测 k=${k.toFixed(2)}）±12%（两记各 ±5% 随机）`).toBeGreaterThanOrEqual(k * 0.88)
    expect(playerHits[0] / 12).toBeLessThanOrEqual(k * 1.12)
    w.cleanup()
  })

  it('别的武器弹反不回授（无 parryReflect ⇒ 分支不进）', () => {
    const w = makeWorld('wp_tuning_sword')
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 1.6 }, 'sword-parry')
    e.alertness = 100
    e.enter('chase')
    const playerHits: number[] = []
    const off = bus.on('combat.hit', (p) => { if (p.attackerId === 'player' && p.victimId === e.id) playerHits.push(p.damage) })
    for (let t = 0; t < 600 && playerHits.length === 0; t++) {
      const atk = e.attack
      if (atk && atk.tick === atk.spec.frames.startup - 3) w.player.parryTicksLeft = w.player.base.parry.activeTicks
      w.player.stats.hp = w.player.stats.hpMax
      w.tick(1)
    }
    off()
    expect(playerHits, '调律剑弹反 ⇒ 没有回授战报（玩家全程没按键攻击）').toEqual([])
    w.cleanup()
  })
})

/* ------------------------- 量具（测试私有，不进生产） ------------------------- */

/** 参照命中：同一玩家、同一敌人、同一管线打一记已知底数的攻击，返回实测伤害 */
function referenceHit(w: ReturnType<typeof makeWorld>, base: number): number {
  const e = w.ai.enemies.find((x) => x.alive)
  if (!e) throw new Error('参照命中需要一只活着的木桩')
  const got: number[] = []
  const off = bus.on('combat.hit', (p) => { if (p.attackerId === 'player' && p.victimId === e.id) got.push(p.damage) })
  const prevMax = e.stats.hpMax
  e.stats.hp = prevMax // 参照不掺回授那一段的掉血
  if (!w.player.tryStartAction('l1', w.time.tick)) throw new Error('参照攻击出手失败')
  for (let t = 0; t < 30 && w.player.action; t++) { e.pos.z = 1.5; w.tick(1) }
  off()
  if (got.length === 0) throw new Error('参照命中没落账')
  return got[0]
}

void (null as unknown as Enemy)
