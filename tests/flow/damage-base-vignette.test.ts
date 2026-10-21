import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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
import { Hud } from '@/ui/Hud'
import { bus } from '@/core/EventBus'

/**
 * KI-259：**§10 那一行剩下的附加格（暗角 0.2 强度）＋ §12 那一行的零头（DR 的封顶 0.55、base 那一项）**
 * （KI-253／KI-255 量了 §10 那张表的九行；KI-257 量了 §12 那六项里的六项与载体情况）。
 *
 * | 腿 | 那一格 | 真读数 | 与设计 |
 * |---|---|---|---|
 * | ① | §10「玩家受击」那行的附加格「**暗角 0.2 强度**」 | HUD 那一圈暗角脉冲的峰值 alpha = **0.42** | **对不上**（差 +0.22）⇒ 登记 |
 * | ② | §12 的 **DR 封顶 0.55** | 防御 200 那一档 = 上一记 **× 0.45** | 逐字对上（不封顶会是 ×0.375） |
 * | ③ | §12 的 **base 那一项** | 六把武器的轻击 = 招式表给的那个数（9／21／12／7／10／7） | 逐字对上 |
 * | ④ | §12 的 **base 那一项**（换一档） | 直剑 l1 **9**／h **28**／蓄力 **42** | 逐字对上 |
 *
 * **量具上的三条纪律（沿用 KI-257 那一批）**：随机项会把比值搅浑 ⇒ 两次测量逐拍对齐；
 * 敌人名册是模块级的 ⇒ 事件按 victimId 认领；敌人的朝向会自己漂 ⇒ 每拍把朝向钉回面向玩家。
 * 另加一条这一批自己撞出来的：**底数那一格要么用「底数小到取整吃不掉噪声」的那一档，要么用「±5% 的带」**。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

const FOE = 'en_tympanus'
const MALLET = registry.get<EnemyData>(FOE).attacks.find((a) => a.id === 'mallet')!
const WEAPONS: Array<[string, number]> = [
  ['wp_tuning_sword', 9],
  ['wp_fortissimo_greatsword', 21],
  ['wp_drawpin_spear', 12],
  ['wp_needlesilence', 7],
  ['wp_overtone_bow', 10],
  ['wp_tuningfork_staff', 7],
]

function makeWorld(weaponId = 'wp_tuning_sword') {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const hits: any[] = []
  const off = bus.on('combat.hit', (p: any) => hits.push({ ...p }))
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
  return { time, rhythm, player, ai, combat, frame, tick, hits, off, pins, weapon }
}

type World = ReturnType<typeof makeWorld>

/** 那只怪的朝向每拍都被钉回「面向玩家」，站位每拍也被钉回出生点（idle 状态下它会自己走过来） */
function pinFacing(w: World, e: { pos: { x: number; y: number; z: number }; yaw: number }): void {
  const home = { ...e.pos }
  w.pins.push(() => {
    e.pos.x = home.x
    e.pos.y = home.y
    e.pos.z = home.z
    const p = w.player.pos
    e.yaw = Math.atan2(p.x - e.pos.x, p.z - e.pos.z)
  })
}

/** 一只挨打的怪（防御 0 ⇒ (1-DR) = 1；血量拉满 ⇒ 不会死、不会触发死亡那一支） */
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
  for (const k of Object.keys(p.rpg.attrs)) (p.rpg.attrs as any)[k] = 0 // 属性归零 ⇒ 属性倍率恒为 1 ⇒ 读数就是底数那一项
  pinFacing(w, e)
  return e
}

/** 玩家出一记（轻击／重击／蓄力重击），认领自己那只怪身上的那一记 */
function swing(w: World, e: ReturnType<World['ai']['spawn']>, mode: 'light' | 'heavy' | 'charged'): number {
  if (mode === 'light') {
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
  } else {
    w.frame.held.add('attackHeavy')
    for (let i = 0; i < (mode === 'charged' ? 100 : 5); i++) w.tick()
    w.frame.held.delete('attackHeavy')
    w.tick()
  }
  for (let i = 0; i < 300 && w.hits.filter((h) => h.victimId === e.id).length === 0; i++) w.tick()
  const h = w.hits.filter((x) => x.victimId === e.id)[0]
  return h?.damage ?? -1
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

// ── HUD 那一支：一个会记下渐变色标的假画布
interface GradientStop { offset: number; color: string }
const live: Hud[] = []

function makeHud(): { hud: Hud; stops: GradientStop[] } {
  const stops: GradientStop[] = []
  const store: Record<string, unknown> = {}
  const grad = {
    addColorStop: (offset: number, color: string) => { stops.push({ offset, color }) },
  }
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 10 })
      return () => {}
    },
    set(t, k: string, v) { t[k] = v; return true },
  })
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement
  const hud = new Hud(canvas)
  live.push(hud)
  return { hud, stops }
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})

describe('KI-259 §10 那一行的暗角附加格 ＋ §12 那一行的零头（DR 封顶 ＋ base）', () => {
  afterEach(() => { for (const h of live.splice(0)) h.dispose() })

  it('腿① §10「玩家受击」那行的附加格「**暗角 0.2 强度**」：运行时给的是 **0.42** ⇒ 登记（差 +0.22）', () => {
    const { hud, stops } = makeHud()
    bus.emit('player.damaged', { amount: 1, dir: { x: 0, y: 0, z: 1 } } as any)
    hud.render(0, 0) // realDelta ＝ 0 ⇒ 这一帧不衰减 ⇒ 读到的是**峰值**那一档
    const edge = stops.find((s) => s.offset === 1)
    expect(edge, '受击那一记在画面边缘画了一圈暗角（渐变的外沿那一档）').toBeTruthy()
    const alpha = Number(/,\s*([\d.]+)\)$/.exec(edge!.color)?.[1] ?? -1)
    expect(alpha, '**暗角脉冲的峰值强度**（设计 §10「玩家受击」那行的附加格写的是「暗角 0.2 强度」⇒ 运行时是 0.42 ⇒ 差 +0.22 ⇒ 只量不裁）').toBeCloseTo(0.42, 3)
  })

  it('腿② §12 **DR 的封顶 0.55**：防御顶到 200 那一档，比值是 **× 0.45**（不封顶会是 × 0.375）⇒ 逐字对上', () => {
    const z = makeWorld()
    const def0 = z.player.stats.defense
    z.off()
    const a = makeWorld()
    const d0 = hammer(a, 0, 20)
    a.off()
    const b = makeWorld()
    const d200 = hammer(b, 200, 20)
    b.off()
    expect(d0, '防御 0 那一记的伤害（大槌 34 × 20 ＝ 680 × 随机项）').toBe(696)
    expect(d200, '防御 200 那一记的伤害（＝ 上一记 × (1 − 0.55) ＝ × 0.45）').toBe(313)
    expect(d200 / d0, '两个世界的伤害之比（**封顶 0.55**：DR = 200/(200+120) = 0.625 ⇒ 不封顶的话比值是 0.375）').toBeCloseTo(0.45, 2)
    expect(def0, '顺带量到：玩家的 defense 默认**不是 0**（属性 vig 那一层给它 10）⇒ 封顶那一档（≥147）在默认配装上够不着 ⇒ 登记').toBe(10)
  })

  it('腿③ §12 **base 那一项**：六把武器的轻击，底数就是招式表给的那个数', () => {
    for (const [wid, base] of WEAPONS) {
      const w = makeWorld(wid)
      const e = dummy(w)
      let dmg = -1
      for (let shot = 0; shot < 8 && dmg < 0; shot++) {
        dmg = swing(w, e, 'light')
        if (dmg < 0) w.tick(60) // 弓那一把是弹体：偶尔撒偏 ⇒ 多打几箭
      }
      expect(dmg, `${wid} 的轻击伤害（设计 §12 的 base 那一项 ＝ 招式表的帧伤害 ${base}；带 ±5% 的随机项）`)
        .toBeGreaterThanOrEqual(Math.floor(base * 0.95))
      expect(dmg, '……也在那一档的上沿之内').toBeLessThanOrEqual(Math.ceil(base * 1.05))
      w.ai.despawn(e.id)
      w.off()
    }
  })

  it('腿④ §12 **base 那一项**（换一档）：直剑的轻击 9／重击 28／蓄力重击 42', () => {
    for (const [mode, base] of [['light', 9], ['heavy', 28], ['charged', 42]] as const) {
      const w = makeWorld()
      const e = dummy(w)
      const dmg = swing(w, e, mode)
      expect(dmg, `直剑 ${mode} 那一记的伤害（base 那一项 ＝ 招式表的帧伤害 ${base}；带 ±5% 的随机项）`)
        .toBeGreaterThanOrEqual(Math.floor(base * 0.95))
      expect(dmg, '……也在那一档的上沿之内').toBeLessThanOrEqual(Math.ceil(base * 1.05))
      w.ai.despawn(e.id)
      w.off()
    }
  })
})
