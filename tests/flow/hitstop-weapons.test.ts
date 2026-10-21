import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { bus } from '@/core/EventBus'

/**
 * KI-243：**§9 那张情境表在别的武器上还成不成立**，外加「Boss 转阶段砸地 250ms」那一行。
 *
 * KI-239 量了守方四行 ＋ 直剑的轻击，KI-241 量了直剑的重击与蓄力 ⇒ **§9 那张表在直剑上逐格对上**。
 * 这一批问的是**同一张表换一把武器还成不成立**，外加表里最后那两行（Boss 砸地那一行）。
 *
 * 表（docs/combat.md §9）：
 * | 轻击命中敌 60ms（4f）｜重击/尾段命中 90ms（6f）｜蓄力重击命中 120ms（8f）｜
 * | 命中被格挡 45ms｜完美格挡 90ms｜弹反成功 120ms｜玩家受击 80ms｜处决首刀 180ms｜
 * | Boss 转阶段砸地 250ms（15f） |
 *
 * **腿里手钉的是真读数**（读数就是那一格自己的数，不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了，
 * KI-239 那一批的头一稿就栽在这儿）。设计那一行与真读数对不上时，**腿钉住真读数、把差额写进消息**
 * ⇒ 只量不裁（设计没裁：不许在测试里替设计做决定）。
 *
 * **拍相位必须钉住**：运行时给**落在拍点上**的命中额外 +30ms（§4.2 大剑「独特属性」那一行写着这条），
 * 不钉相位的话同一格读数会随拍相位漂 ⇒ 所以每一条腿都先把拍相位冻在「拍与拍的正中间」
 * （＝离拍点 ±3 拍之外 ⇒ 拿不到那个 +30），腿⑧ 单独量「钉在拍点上」那一种。
 */

registerGameData()

type Mode = 'light' | 'heavy' | 'charged'

function makeWorld(weaponId: string) {
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
  const hits: Array<{ result: string; hitStopMs: number; damage: number }> = []
  const off = bus.on('combat.hit', (p) => hits.push({ result: p.result, hitStopMs: p.hitStopMs, damage: p.damage }))
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT) // 真实时间照走（hitStop 的坡道就靠它收）
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

/** 把拍相位钉在 target（0.5 = 拍与拍的正中间；0 = 拍点）并冻住 */
function freezePhase(w: World, target: number): number {
  for (let i = 0; i < 200; i++) {
    if (Math.abs(w.rhythm.info().phase - target) < 0.012) break
    w.tick()
  }
  w.rhythm.paused = true
  return w.rhythm.info().phase
}

/** 打一记（拍相位已冻住），返回那一记的停顿 */
function strike(w: World, mode: Mode): number | null {
  const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'probe')
  e.alertness = 0
  e.enter('idle')
  const p = w.player
  p.pos = { x: 0, y: 0, z: 0 }
  p.yaw = Math.PI
  p.camYawRef = Math.PI + p.yaw
  if (mode === 'light') {
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
  } else if (mode === 'heavy') {
    w.frame.held.add('attackHeavy')
    for (let i = 0; i < 5; i++) w.tick()
    w.frame.held.delete('attackHeavy')
    w.tick()
  } else {
    w.frame.held.add('attackHeavy')
    for (let i = 0; i < 100; i++) w.tick() // 蓄满（大剑的阈值 84 拍也够）
    w.frame.held.delete('attackHeavy')
    w.tick()
  }
  for (let i = 0; i < 120 && w.hits.length === 0; i++) w.tick()
  return w.hits.length ? w.hits[0].hitStopMs : null
}

/** 换一把武器，冻在拍与拍中间，出三记 */
function threeStops(weaponId: string): { light: number | null; heavy: number | null; charged: number | null } {
  const out: any = {}
  for (const mode of ['light', 'heavy', 'charged'] as Mode[]) {
    const w = makeWorld(weaponId)
    freezePhase(w, 0.5)
    out[mode] = strike(w, mode)
    w.off()
  }
  return out as { light: number | null; heavy: number | null; charged: number | null }
}

describe('KI-243 §9 那张表在别的武器上还成不成立 ＋ Boss 砸地那一行', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 「Boss 转阶段砸地 250ms」那一行：时间标掉下去 ＋ 坡道 15 拍 ＋ 低通 800ms（48 拍）', () => {
    const w = makeWorld('wp_tuning_sword')
    const phases: any[] = []
    const muffles: Array<{ on: boolean; tick: number }> = []
    const offP = bus.on('boss.phase', (p: any) => phases.push(p))
    const offM = bus.on('audio.muffle', (p: any) => muffles.push({ on: p.on, tick: w.time.tick }))
    const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -6 }, 'probe')
    e.alertness = 0
    e.enter('idle')
    e.stats.hp = e.stats.hpMax * 0.5 // 打到第二阶的血线以下 ⇒ 下一 tick 跳阶
    let roarTick = -1
    let scaleAtRoar = 1
    let downTicks = 0
    let recovered = false
    for (let i = 0; i < 200; i++) {
      w.tick()
      if (phases.length && roarTick < 0) { roarTick = w.time.tick; scaleAtRoar = w.time.rawScale }
      if (roarTick > 0) {
        if (w.time.rawScale < 1) downTicks++
        else if (downTicks > 0) recovered = true
      }
      if (recovered && muffles.length >= 2) break
    }
    expect(phases.length, '跳阶那一嗓子真的演了（`boss.phase` 事件）').toBe(1)
    expect(scaleAtRoar, '跳阶那一刻时间标掉下去（§9「Boss 转阶段砸地 250ms」那一行的落点）').toBeLessThan(1)
    expect(scaleAtRoar, '掉下去之后的那个值就是 hitStop 的地板（0.05）').toBe(0.05)
    expect(recovered, '时间标后来自己回来了（坡道会收）⇒ 那一格不是「一次性的」').toBe(true)
    expect(downTicks, '时间标掉下去的拍数（设计 §9 那一行写的是 250ms / 15f；真读数 16 拍 ＝ 250ms 的坡道 ＋ 起手那一拍已经在读数里）').toBe(16)
    const off = muffles.find((m) => m.on === false)
    const on = muffles.find((m) => m.on === true)
    expect(on, '低通在跳阶那一刻起来了（§15.1 那一件：hitstop ＋ 震镜 ＋ 全频低通）').toBeTruthy()
    expect(off, '低通后来自己撤了').toBeTruthy()
    expect(off!.tick - on!.tick, '低通的长度（设计 §15.1 写的是 `boss.roar.muffleMs` ＝ 800ms ＝ 48 拍）').toBe(48)
    offP(); offM()
    alive.push(w.off)
  })

  it('腿② 基准：直剑那三格（拍与拍中间）＝ 60／90／120，与 §9 逐格对上', () => {
    const s = threeStops('wp_tuning_sword')
    expect(s.light, '轻击命中敌那一行（设计 §9「60ms」）').toBe(60)
    expect(s.heavy, '重击/尾段命中那一行（设计 §9「90ms」）').toBe(90)
    expect(s.charged, '蓄力重击命中那一行（设计 §9「120ms」）').toBe(120)
  })

  it('腿③ 大剑那三格＝ 90／120／150：**三格都与 §9 对不上**（设计没写是哪把武器 ⇒ 只量不裁）', () => {
    const s = threeStops('wp_fortissimo_greatsword')
    expect(s.light, '大剑的轻击命中敌（设计 §9 那一行写的是 60ms ⇒ 差 +30）').toBe(90)
    expect(s.heavy, '大剑的重击命中（设计 §9 那一行写的是 90ms ⇒ 差 +30）').toBe(120)
    expect(s.charged, '大剑的蓄力重击命中（设计 §9 那一行写的是 120ms ⇒ 差 +30）').toBe(150)
  })

  it('腿④ 枪那三格＝ 60／90／110：**蓄力那一格与 §9 对不上**（差 −10）', () => {
    const s = threeStops('wp_drawpin_spear')
    expect(s.light, '枪的轻击命中敌（设计 §9「60ms」）').toBe(60)
    expect(s.heavy, '枪的重击命中（设计 §9「90ms」）').toBe(90)
    expect(s.charged, '枪的蓄力重击命中（设计 §9 那一行写的是 120ms ⇒ 差 −10）').toBe(110)
  })

  it('腿⑤ 静默针那两格＝ 50／120：**两格都与 §9 对不上**；且它没有蓄力式', () => {
    const s = threeStops('wp_needlesilence')
    expect(s.light, '静默针的轻击命中敌（设计 §9 那一行写的是 60ms ⇒ 差 −10）').toBe(50)
    expect(s.heavy, '静默针的重击命中（设计 §9 那一行写的是 90ms ⇒ 差 +30）').toBe(120)
    expect(s.charged, '静默针的帧表里**没有蓄力式** ⇒ 按满蓄力松手也不出那一招（这一格不是读数，是没有那一式）').toBeNull()
  })

  it('腿⑥ 弓那三格＝ 60／90／90：**蓄力那一格与 §9 对不上**（差 −30）', () => {
    const s = threeStops('wp_overtone_bow')
    expect(s.light, '弓的轻击命中敌（设计 §9「60ms」）').toBe(60)
    expect(s.heavy, '弓的重击命中（设计 §9「90ms」）').toBe(90)
    expect(s.charged, '弓的蓄力重击命中（设计 §9 那一行写的是 120ms ⇒ 差 −30）').toBe(90)
  })

  it('腿⑦ 杖那三格＝ 50／90／110：**轻击与蓄力两格与 §9 对不上**', () => {
    const s = threeStops('wp_tuningfork_staff')
    expect(s.light, '杖的轻击命中敌（设计 §9 那一行写的是 60ms ⇒ 差 −10）').toBe(50)
    expect(s.heavy, '杖的重击命中（设计 §9「90ms」）').toBe(90)
    expect(s.charged, '杖的蓄力重击命中（设计 §9 那一行写的是 120ms ⇒ 差 −10）').toBe(110)
  })

  it('腿⑧ 拍点 +30：落在拍点上的命中**每把武器**都多 30ms（设计只把这条写在 §4.2 大剑的「独特属性」那一行）', () => {
    // 大剑：设计给了它这条 ⇒ 拍点上应当是 底数 +30
    const g = makeWorld('wp_fortissimo_greatsword')
    freezePhase(g, 0.0)
    const gHeavy = strike(g, 'heavy')
    g.off()
    expect(gHeavy, '大剑的重击落在拍点上（设计 §4.2 明写「所有命中在拍点时 hitstop 额外 +30ms」）').toBe(150)
    // 直剑：设计没给直剑这条 ⇒ 拍点上本该还是 90，真读数却也是 +30 ⇒ 登记
    // （轻击与重击各用一个世界：同一个世界里第二记会被第一记的收势挡掉，读数会串）
    const sl = makeWorld('wp_tuning_sword')
    freezePhase(sl, 0.0)
    const sLight = strike(sl, 'light')
    sl.off()
    const s = makeWorld('wp_tuning_sword')
    freezePhase(s, 0.0)
    const sHeavy = strike(s, 'heavy')
    s.off()
    expect(sLight, '直剑的轻击落在拍点上（设计 §9「60ms」＋ 设计只把 +30 写给大剑 ⇒ 这里多出来的 30 登记）').toBe(90)
    expect(sHeavy, '直剑的重击落在拍点上（设计 §9「90ms」＋ 同样多出来的 30）').toBe(120)
  })
})
