import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData, ProgressionData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { bus } from '@/core/EventBus'

/**
 * KI-247：**§2.1「全局节拍时钟」那张表剩下的几格第一次在真链上被量**。
 *
 * | 量化规则 | **敌人所有攻击的命中帧必须落在拍点或半拍点**（±50ms 容差由调度器吸收）… |
 * | 攻击插槽 | 同小节同拍位最多 1 个敌人发动"命中帧"；冲突则顺延至下一半拍（队列上限 3，超出改为走位） |
 * | 玩家侧 | 玩家不受网格约束…进阶奖励：命中帧落在拍点 ±50ms 内→架势伤害 +1（"踏音加成"，HUD 以极淡涟漪提示） |
 * | 可读性可视化 | ①节拍=环境尘环脉冲（每拍 1 次）②敌人前摇蓄光亮度…③Boss=乐句进度线… |
 *
 * 「玩家侧」那一行的架势那半边已由 **KI-245** 量过（×2 架势 ＋ §2 写「+1」的对不上 ＋
 * 「踩在拍点上」在事件里没有承载体）；这一批量**量化规则**那一行与**可读性可视化①**那一行，
 * 外加「玩家侧」那句话里的 **HUD 涟漪那一格**。
 *
 * **读数**：敌人自己出手打中玩家那一拍的**落点**（`RhythmClock.info()` 的小节内位置），
 * 换算成离「拍点或半拍点」有多远（毫秒）⇒ 与设计写的 ±50ms 对账。
 *
 * **一条量具上的纪律（这一批自己撞出来的）**：**不钉「出手了几次」**。
 * 敌人何时出手是 AI 的自由决策，而 AI 里有一份**模块级**的敌人名册（`Enemy.bindEnemyRegistry`）
 * 与一份**全局单例**的 Squad（`initSquad`）⇒ 同一个进程里别的测试文件先跑过还是后跑过，
 * 敌人出手的次数与拍位就会变 ⇒ ⇒ 腿只钉**与次数无关**的那几格（每一记落点都在容差内），
 * 次数只当下界用（「至少出手过这么多次」）。**这是量具纪律，不是这一格没量。**
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 * 设计那一行与真读数对不上时**腿钉住真读数、把差额写进消息** ⇒ 只量不裁（设计没裁）。
 */

registerGameData()

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
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick }
}

type World = ReturnType<typeof makeWorld>

/** 落点离「拍点或半拍点」有多远（毫秒） */
function offGridMs(info: { beatInBar: number; phase: number }): number {
  const posInBar = (info.beatInBar - 1) + info.phase
  const halves = posInBar * 2
  const d = Math.abs(halves - Math.round(halves)) / 2
  return d * (60000 / 84)
}

interface Landing {
  who: string
  tick: number
  bar: number
  beatInBar: number
  phase: number
  offGrid: number
}

/** 让敌人自己出手 n 拍，记下每一记命中帧的落点 */
function landings(w: World, who: (id: string) => boolean, ticks = 900): Landing[] {
  const out: Landing[] = []
  const off = bus.on('combat.hit', (p: any) => {
    if (!who(p.attackerId)) return
    const info = w.rhythm.info()
    out.push({
      who: p.attackerId, tick: w.time.tick, bar: info.bar, beatInBar: info.beatInBar, phase: info.phase,
      offGrid: offGridMs(info),
    })
  })
  for (let i = 0; i < ticks; i++) w.tick()
  off()
  return out
}

/** 摆一个敌人出来，盯着它，等它自己出手 */
function duel(w: World, id: string, x: number) {
  const e = w.ai.spawn(id, { x, y: 0, z: -2.0 }, 'probe')
  e.alertness = 100
  e.enter('combat')
  return e
}

describe('KI-247 §2.1 那张表剩下的几格：命中帧的落点、每拍一次的脉冲、以及那圈涟漪的门槛', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 量化规则（en_tympanus）：它的每一记命中帧都落在拍点或半拍点上（设计的容差是 ±50ms）', () => {
    const w = makeWorld()
    const e = duel(w, 'en_tympanus', 0)
    const ls = landings(w, (id) => id === e.id)
    expect(ls.length, '敌人自己出手打中玩家的次数（AI 的自由决策 ⇒ 只当下界用）').toBeGreaterThanOrEqual(1)
    expect(Math.max(...ls.map((l) => l.offGrid)), '最远的一记离「拍点或半拍点」有多远（设计 §2.1 那一行的容差是 ±50ms ⇒ 成立）').toBeLessThanOrEqual(50)
  })

  it('腿② 量化规则（en_murkshell）：它的每一记命中帧都落在拍点或半拍点上（±50ms）', () => {
    const w = makeWorld()
    const e = duel(w, 'en_murkshell', 0)
    const ls = landings(w, (id) => id === e.id)
    expect(ls.length, '敌人自己出手打中玩家的次数').toBeGreaterThanOrEqual(1)
    expect(Math.max(...ls.map((l) => l.offGrid)), '最远的一记离「拍点或半拍点」有多远（设计 §2.1 那一行的容差是 ±50ms ⇒ 成立）').toBeLessThanOrEqual(50)
  })

  it('腿③ 量化规则（两个敌人合看）：每一记命中帧都在 ±50ms 内 ⇒ 设计那一行成立', () => {
    const w = makeWorld()
    const e1 = duel(w, 'en_tympanus', 0)
    const e2 = duel(w, 'en_tympanus', 2.0)
    const ls = landings(w, (id) => id === e1.id || id === e2.id)
    expect(ls.length, '两个敌人合计出手打中玩家的次数').toBeGreaterThanOrEqual(1)
    expect(Math.max(...ls.map((l) => l.offGrid)), '最远的一记离「拍点或半拍点」有多远（设计 §2.1 那一行的容差是 ±50ms ⇒ 成立）').toBeLessThanOrEqual(50)
  })

  it('腿④ 可读性可视化①：「节拍=环境尘环脉冲（每拍 1 次）」——`rhythm.beat` 在 600 拍里响了 15 次（84BPM 一拍 42.86 拍）', () => {
    const w = makeWorld()
    let beats = 0
    const off = bus.on('rhythm.beat', () => beats++)
    for (let i = 0; i < 600; i++) w.tick()
    off()
    expect(w.rhythm.beatTicks, '84BPM 的一拍有多少逻辑拍').toBeCloseTo(42.857, 3)
    expect(beats, '600 拍里 `rhythm.beat` 事件的次数（设计 §2.1 可读性可视化①：每拍 1 次）').toBe(15)
  })

  it('腿⑤ HUD 那圈涟漪（§2 玩家侧那句「HUD 以极淡涟漪提示」）：载体是 rank 3 的里程碑 ⇒ rank 1–2 那一档没有 ⇒ 登记', () => {
    const milestones = registry.get<ProgressionData>('progression').milestones
    const ripple = milestones.find((m) => m.id === 'ms_beat_ripple')
    expect(ripple, 'HUD 那圈涟漪的里程碑在表里').toBeTruthy()
    expect(ripple!.rank, '**这圈涟漪要 rank ≥ 这一档才出现**（设计 §2 玩家侧那句没提这一层 ⇒ 登记）').toBe(3)
  })
})
