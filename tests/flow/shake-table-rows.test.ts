import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig } from '@/player/CameraRig'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack } from '@/ai/Enemy'

/**
 * KI-255：**§10「镜头震动参数表」那张表剩下的五行**第一次在真链上被量
 * （KI-253 量了那一张表的另外四行：玩家受击／弹反成功／Boss 阶段转换／驼鼓踏地）。
 *
 * | 情境 | 幅度 A | 频率 f | 持续 | 附加 |
 * | 轻击命中 | 0.3° | 18Hz | 100ms | — |
 * | 重击命中 | 0.8° | 12Hz | 200ms | FOV -1°/120ms |
 * | 破防/被破势 | 2.0° | 6Hz | 400ms | 0.3s 慢放 ×0.75 |
 * | 处决 | 1.0° | 8Hz | 300ms | 推轨另控（§5.4） |
 * | 落地摔落 | 1.5° | 7Hz | 300ms | — |
 *
 * **读数**：相机**自己记在身上的那笔账**（`CameraRig` 挂上去的震镜条目：幅度／频率／衰减 ＋ roll
 * ＋ FOV 脉冲）⇒ 读的是运行时**真的挂上去的**那几个数，不是表里的数。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 * 设计那一行与真读数对不上时**腿钉住真读数、把差额写进消息** ⇒ 只量不裁（设计没裁）。
 */

registerGameData()

Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })

interface ShakeEntry { amp: number; freq: number; decay: number; t: number; roll: number }
interface FovPulse { delta: number; dur: number; t: number }

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
  const rig = new CameraRig()
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
      rig.update(TICK_DT, player, frame.look, null, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, rig, frame, tick }
}

type World = ReturnType<typeof makeWorld>

/** 相机身上挂着的那几笔震镜账（运行时自己记的） */
function shakes(w: World): ShakeEntry[] {
  return (w.rig as unknown as { shakes: ShakeEntry[] }).shakes
}
/** 相机身上挂着的那几笔 FOV 脉冲（§10 的附加格） */
function pulses(w: World): FovPulse[] {
  return (w.rig as unknown as { fovPulses: FovPulse[] }).fovPulses
}

/** 一只不动的杂兵（只在原地挨打） */
function dummy(w: World) {
  const e = w.ai.spawn(FOE, { x: 0, y: 0, z: -1.6 }, 'prey')
  e.alertness = 0
  e.enter('idle')
  const p = w.player
  p.pos = { x: 0, y: 0, z: 0 }
  p.yaw = Math.PI
  p.camYawRef = Math.PI + p.yaw
  return e
}

/** 玩家出一记（轻击 ＝ 按一下；重击 ＝ 按住一下） */
function strike(w: World, mode: 'light' | 'heavy'): void {
  if (mode === 'light') {
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
  } else {
    w.frame.held.add('attackHeavy')
    for (let i = 0; i < 5; i++) w.tick()
    w.frame.held.delete('attackHeavy')
    w.tick()
  }
}

describe('KI-255 §10 那张表剩下的五行：轻击命中／重击命中／破防／处决／落地摔落', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 轻击命中 → **graze**（0.3°／18Hz／100ms）：与设计那一行逐字对上（附加格「—」⇒ 没有 FOV 脉冲）', () => {
    const w = makeWorld()
    dummy(w)
    strike(w, 'light')
    for (let i = 0; i < 60 && shakes(w).length === 0; i++) w.tick()
    const s = shakes(w).find((x) => x.amp === 0.3)
    expect(s, '轻击命中那一记挂上去的震镜（设计 §10「轻击命中 0.3° 18Hz 100ms」）').toBeTruthy()
    expect(s!.freq, '频率（设计写 18Hz）').toBe(18)
    expect(Math.round(s!.decay * 3 * 1000), '持续（`decay` 是 τ，包络掉到 2% 要 ≈1.3 倍 τ ⇒ 设计写 100ms）').toBe(100)
    expect(s!.roll, '镜头 roll（设计那一行的附加格是「—」⇒ 没有回正）').toBe(0)
    expect(pulses(w).length, '那一记没有挂 FOV 脉冲（设计那一行的附加格是「—」）').toBe(0)
  })

  it('腿② 重击命中 → **normal**（0.8°／12Hz／200ms）：与设计那一行逐字对上；**附加格「FOV -1°/120ms」没有兑现**（那一记不挂 FOV 脉冲）⇒ 登记', () => {
    const w = makeWorld()
    dummy(w)
    strike(w, 'heavy')
    for (let i = 0; i < 60 && shakes(w).length === 0; i++) w.tick()
    const s = shakes(w).find((x) => x.amp === 0.8)
    expect(s, '重击命中那一记挂上去的震镜（设计 §10「重击命中 0.8° 12Hz 200ms」）').toBeTruthy()
    expect(s!.freq, '频率（设计写 12Hz）').toBe(12)
    expect(Math.round(s!.decay * 3 * 1000), '持续（设计写 200ms）').toBe(200)
    expect(pulses(w).length, '**那一记没有挂 FOV 脉冲**（设计那一行的附加格写着「FOV -1°/120ms」⇒ 运行时没兑现到这一记 ⇒ 只量不裁）').toBe(0)
  })

  it('腿③ 破防 → **heavy**（2.0°／6Hz／400ms ＋ 0.3s 慢放 ×0.75）：与设计那一行逐字对上；**那一记还挂了一个 FOV 脉冲 -1°/120ms**（设计的 -1°/120ms 写在「重击命中」那一行）⇒ 登记', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: 0 }, 'guard')
    e.alertness = 100
    e.enter('combat')
    e.skipIntro()
    e.yaw = Math.PI
    const p = w.player
    p.pos = { x: 0, y: 0, z: -1.6 }
    p.yaw = 0
    p.stats.stamina = p.stats.staMax
    // 按住格挡键，走过起手
    w.frame.held.add('guard')
    w.tick(playerBase.guard.startupTicks + 2)
    expect(p.guarding, '前提：格挡态起来了').toBe(true)
    p.stats.stamina = 1 // 付不起这一记 ⇒ 破防
    e.attack = newAttack(MALLET, MALLET.frames.activeStart)
    w.tick(1)
    e.attack = null

    const s = shakes(w).find((x) => x.amp === 2)
    expect(s, '破防那一记挂上去的震镜（设计 §10「破防/被破势 2.0° 6Hz 400ms」）').toBeTruthy()
    expect(s!.freq, '频率（设计写 6Hz）').toBe(6)
    expect(Math.round(s!.decay * 3 * 1000), '持续（设计写 400ms）').toBe(400)
    const ps = pulses(w)
    expect(ps.length, '**破防这一记还挂了一个 FOV 脉冲**（设计的 -1°/120ms 写在「重击命中」那一行 ⇒ 交叉了 ⇒ 只量不裁）').toBeGreaterThanOrEqual(1)
    expect(ps[0].delta, '那个 FOV 脉冲的度数（设计写 -1°）').toBeCloseTo(-1, 5)
    expect(Math.round(ps[0].dur * 1000), '那个 FOV 脉冲的时长（设计写 120ms）').toBe(120)

    // 附加格「0.3s 慢放 ×0.75」：时标落在 0.75；慢放落在 **19 拍**（设计的 0.3s ＝ 18 拍）
    expect(w.time.rawScale, '破防那一记的时标（设计写「慢放 ×0.75」）').toBe(0.75)
    let n = 0
    while (w.time.rawScale === 0.75 && n < 120) { w.tick(); n++ }
    expect(n, '慢放一共有几拍落在 0.75 上（破防那一拍 ＋ 后面这些拍 ＝ 19 拍 ＝ 316.7ms；设计的 0.3s ＝ 18 拍 ⇒ **多一拍**：`GameTime.step` 逐拍减 1/60，减到 ≤0 才复位 ⇒ 0.3 减 18 次还剩一点浮点余数 ⇒ 登记，不裁）').toBe(19)
  })

  it('腿④ 处决 → **execute**（1.0°／8Hz／300ms）：与设计那一行逐字对上（附加格「推轨另控（§5.4）」⇒ 那一格是 KI-237 量过的推轨，不是 FOV 脉冲）', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    e.stats.crumpleTicksLeft = 60
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI
    p.camYawRef = Math.PI + p.yaw
    w.frame.edges.add('interact')
    w.tick()
    w.frame.edges.delete('interact')
    expect(p.executing, '前提：处决演出起来了').not.toBeNull()

    const s = shakes(w).find((x) => x.amp === 1)
    expect(s, '处决那一记挂上去的震镜（设计 §10「处决 1.0° 8Hz 300ms」）').toBeTruthy()
    expect(s!.freq, '频率（设计写 8Hz）').toBe(8)
    expect(Math.round(s!.decay * 3 * 1000), '持续（设计写 300ms）').toBe(300)
    expect(s!.roll, '镜头 roll（那一行的附加格是「推轨另控」⇒ 没有回正）').toBe(0)
    expect(pulses(w).length, '那一记没有挂 FOV 脉冲（设计的附加格是「推轨另控（§5.4）」⇒ 推轨那一格由 KI-237 量过）').toBe(0)
  })

  it('腿⑤ **落地摔落那一行没有承载体**：从高处落下、落地那一拍，相机身上**没有挂任何震镜**（游戏里也没有摔落伤）⇒ 登记', () => {
    const w = makeWorld()
    const p = w.player
    const hp0 = p.stats.hp
    // 跳起来，再从空中落回地面
    w.frame.edges.add('jump')
    w.tick()
    w.frame.edges.delete('jump')
    for (let i = 0; i < 120 && p.grounded; i++) w.tick()
    expect(p.grounded, '人已经在空中了').toBe(false)
    const before = shakes(w).length
    let landed = false
    for (let i = 0; i < 240 && !landed; i++) {
      w.tick()
      if (p.grounded) landed = true
    }
    expect(landed, '人落回地面了').toBe(true)
    expect(shakes(w).length, '**落地那一拍没有挂任何震镜**（设计 §10「落地摔落 1.5° 7Hz 300ms」那一行在运行时没有承载体 ⇒ 只量不裁）').toBe(before)
    expect(p.stats.hp, '落地也没有掉血（**这个游戏里没有摔落伤**，KI-251 已量到 ⇒ 那一格免的不是不存在的东西）').toBe(hp0)
  })
})
