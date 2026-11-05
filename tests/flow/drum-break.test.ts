import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'

/**
 * KI-404：combat.md §14.3「对鼓面 4 次震裂 → 鼓崩：全营节拍同步紊乱（据点战里 ＝ 巡逻表失效）」。
 *
 * 病：KI-402／403 只落了「鼓手死」这一条触发。§14.3 的弱点写的是**打鼓面**——鼓在驼鼓背上，
 * 玩家可以不打这只 Heavy 的血、只把它的鼓敲裂，同样把整营的拍拿走。这一条此前完全不存在：
 * 打鼓面与打身体走的是同一笔伤害，没有任何地方在数「鼓挨了几记」。
 *
 * 裁决（一个数据格 ＋ 一处命中钩子，复用同一段结算）：
 *  ① `ai.drumSurfaceHits = 4`；判据用既有的**背刺位**（`isBackstab`，> 0.72π）＋这一记真的
 *     叠了震裂层（轻击没有裂纹，敲不碎鼓皮）——不新造部位模型；
 *  ② 撞满 4 记 ⇒ `drumBroken`，走 `campLoseBeat`（与 KI-402 同一段：冻结一小节、落 Search、
 *     圈心鼓位、每 4 小节回头），播报换成「鼓皮碎了」；
 *  ③ 鼓手**活着**、它的招式照旧——碎的是鼓，不是人；鼓崩之后鼓手再死不会二次丢拍。
 *
 * 腿：
 *  ① 数据：驼鼓带 `drumSurfaceHits: 4`，别的怪没有；
 *  ② 三记背击震裂 ⇒ 计数 3、全营还没丢拍；第四记 ⇒ 计数 4、鼓崩、同营冻结 171 拍 + 落 Search，
 *     驼鼓自己还活着；
 *  ③ 正向锤：第一记就该计数 1（并且背刺位判据成立）；
 *  ④ 反向臂：同样四记重击、但**从正面**打 ⇒ 计数恒 0、鼓不崩、全营不丢拍；
 *  ⑤ 崩鼓之后再打、再杀鼓手 ⇒ 不重复丢拍（鼓早就不响了）。
 */

registerGameData()

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

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
  const notifies: string[] = []
  alive.push(bus.on('ui.notify', (p) => { notifies.push(p.text) }))
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, notifies }
}

/** 站到目标背后 1.3 米（按目标自己的 yaw），重击一记；返回这一记是否被判成背刺 */
function heavyAt(w: ReturnType<typeof makeWorld>, e: Enemy, behind: boolean): boolean {
  let backstab = false
  const off = bus.on('combat.hit', (h) => { if (h.victimId === e.id) backstab = h.backstab })
  alive.push(off)
  // 先把上一记的收招走完：新的一记在 action 未清时会被丢掉
  for (let i = 0; i < 150 && w.player.action !== null; i++) w.tick()
  const dir = behind ? e.yaw + Math.PI : e.yaw
  w.player.pos = { x: e.pos.x + Math.sin(dir) * 1.3, y: e.pos.y, z: e.pos.z + Math.cos(dir) * 1.3 }
  w.player.floorY = e.pos.y
  w.player.grounded = true
  w.player.stats.stamina = w.player.stats.staMax
  // 这一批量的是「鼓挨了几记」，不是四记重击能不能打死它：把血补满，别让死亡混进来
  e.stats.hp = e.stats.hpMax
  w.player.yaw = Math.atan2(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)
  w.player.camYawRef = w.player.yaw + Math.PI
  e.stunTicks = 90 // 让它别转身：背刺位是这一批的判据，不是手速
  w.tick(2)
  const hpBefore = e.stats.hp
  w.frame.held.add('attackHeavy')
  w.tick(1)
  w.frame.held.delete('attackHeavy')
  w.tick(1)
  for (let i = 0; i < 80 && e.stats.hp === hpBefore; i++) {
    w.player.stats.hp = w.player.stats.hpMax
    w.player.stunTicks = 0
    w.player.crumpleTicks = 0
    e.stunTicks = 90
    w.tick()
  }
  off()
  return backstab
}

describe('KI-404 打鼓面：4 记震裂背击 ⇒ 鼓崩、全营丢拍（§14.3）', () => {
  it('数据：驼鼓带 drumSurfaceHits: 4，其他怪没有', () => {
    expect(registry.get<EnemyData>('en_tympanus').ai.drumSurfaceHits).toBe(4)
    expect(registry.get<EnemyData>('en_murkshell').ai.drumSurfaceHits).toBeUndefined()
  })

  it('三记背击只裂到 3；第四记鼓崩：同营冻结 171 拍、落 Search，鼓手还活着', () => {
    const w = makeWorld()
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    const ally = w.ai.spawn('en_driftsinger', { x: 5, y: 0, z: -6 }, 'ally')
    w.tick(2)

    expect(heavyAt(w, tym, true), '第一记要判成背刺').toBe(true)
    expect(tym.drumFissureHits, '一记震裂').toBe(1)
    expect(heavyAt(w, tym, true)).toBe(true)
    expect(heavyAt(w, tym, true)).toBe(true)
    expect(tym.drumFissureHits).toBe(3)
    expect(tym.drumBroken, '三记还不崩').toBe(false)
    expect(ally.frozenTicks, '三记不丢拍').toBe(0)
    expect(ally.state).not.toBe('search')

    expect(heavyAt(w, tym, true)).toBe(true)
    expect(tym.drumFissureHits).toBe(4)
    expect(tym.drumBroken, '第四记鼓崩').toBe(true)
    expect(tym.alive, '碎的是鼓，不是人').toBe(true)
    expect(ally.frozenTicks, '同营丢拍一小节').toBe(171)
    expect(ally.state).toBe('search')
    expect(w.notifies.some((t) => t.includes('鼓皮碎了')), '屏上要说出来').toBe(true)
    const pause = Math.round(w.rhythm.beatTicks * w.rhythm.beatsPerBar)
    w.tick(pause)
    expect(ally.frozenTicks).toBe(0)
  })

  it('反向臂：四记重击全从正面 ⇒ 计数 0、鼓不崩、全营不丢拍', () => {
    const w = makeWorld()
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    const ally = w.ai.spawn('en_driftsinger', { x: 5, y: 0, z: -6 }, 'ally')
    w.tick(2)
    for (let i = 0; i < 4; i++) {
      expect(heavyAt(w, tym, false), '正面不是鼓面').toBe(false)
      expect(tym.drumFissureHits).toBe(0)
    }
    expect(tym.drumBroken).toBe(false)
    expect(ally.frozenTicks).toBe(0)
    expect(ally.state).not.toBe('search')
  })

  it('鼓崩之后：再打、再杀鼓手都不重复丢拍（那面鼓早就不响了）', () => {
    const w = makeWorld()
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    const ally = w.ai.spawn('en_driftsinger', { x: 5, y: 0, z: -6 }, 'ally')
    w.tick(2)
    for (let i = 0; i < 4; i++) heavyAt(w, tym, true)
    expect(tym.drumBroken).toBe(true)
    w.tick(200) // 冻结走完
    expect(ally.frozenTicks).toBe(0)

    expect(heavyAt(w, tym, true)).toBe(true)
    expect(tym.drumFissureHits, '计数停在 4').toBe(4)
    expect(ally.frozenTicks, '不再冻').toBe(0)

    // 杀掉鼓手：走死亡那一条，但 `drumBroken` 已经拦住了第二次丢拍
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: tym.pos.x, y: tym.pos.y + 1.1, z: tym.pos.z }, dir: { x: 0, y: 0, z: 1 },
      speed: 2, range: 5, radius: 1, damage: 9999, poise: 0, hitStopMs: 0
    }, w.time.tick)
    for (let i = 0; i < 10 && tym.alive; i++) w.tick()
    expect(tym.alive).toBe(false)
    expect(ally.frozenTicks, '死亡不再触发第二次丢拍').toBe(0)
  })
})
