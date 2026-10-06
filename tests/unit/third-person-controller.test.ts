import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import type { Input } from '@/core/Input'
import { bus } from '@/core/EventBus'
import { PlayerController } from '@/player/ThirdPersonController'

/**
 * PlayerController：核心分支补全（cov19 missing 31 行）。
 *
 * 覆盖清单：
 * - faceTowards (L310-313)：0.35 步长平滑转向 + 收敛
 * - beginExecute / 死检查 (L316-333)：处决蒙太奇入场；死亡只走 deadTicks 并在 240 格后重生
 * - jump 边界：grounded + busy + 体力 (L431-435)
 * - dodge 边界：overloaded 报警 / 体力不足静默 / 死亡早退 / 正常起滚 (L436-442)
 * - skill 位移：d && skill && tick in active (L462-468)
 * - sprint 耗尽 ⇒ exhausted (L505-515)
 * - 落地特效：fallSpeed > 8 ⇒ ring_dust + land_slam (L524-532)
 * - step up (STEP_UP) (L533-535)
 */

registerGameData()

const fresh = (): PlayerController => {
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  return new PlayerController(playerBase, sword, registry.get<MovesetData>(`moveset:${sword.movesetId}`))
}

/**
 * update 只读 `input.frame.{move,held,edges}`——给一个最小假件就够了，
 * 免得为真实 Input 的一套 window/document mock 把用例淹没在脚手架里。
 */
const frameInput = (edges: string[] = [], held: string[] = [], move: { x: number; y: number } = { x: 0, y: 0 }): Input =>
  ({ frame: { edges: new Set(edges), held: new Set(held), move } } as unknown as Input)

const TIME = (tick = 0): any => ({ tick, dt: 1 / 60, realMs: 16, paused: false })

/** update 只在 beatParasite 挂上时才碰 rhythm（L369 短路在前），headless 用例传 undefined 即可 */
function step(c: PlayerController, input: Input, tick = 0, dt = 1 / 60): void {
  c.update(dt, TIME(tick), input, tick, undefined as never)
}

describe('PlayerController：核心分支补全', () => {
  it('faceTowards：一步只转 35%，反复调用收敛到目标方位（L310-313）', () => {
    const c = fresh()
    c.yaw = 0
    c.faceTowards({ x: 10, y: 0, z: 0 }) // 目标方位 atan2(10, 0) = π/2
    expect(c.yaw).toBeGreaterThan(0)
    expect(c.yaw).toBeLessThan(Math.PI / 2) // 平滑转向：一步不瞬移
    for (let i = 0; i < 200; i++) c.faceTowards({ x: 10, y: 0, z: 0 })
    expect(c.yaw).toBeCloseTo(Math.PI / 2, 2)
  })

  it('beginExecute：处决入场面向受刑者、清掉手上动作；演出期 update 只推进蒙太奇（L316-361）', () => {
    const c = fresh()
    c.beginExecute({ x: 5, y: 0, z: 5 }, 30)
    expect(c.executing).not.toBeNull()
    expect(c.yaw).toBeCloseTo(Math.PI / 4, 5) // atan2(5, 5)：入场瞬间已面向受刑者
    expect(c.action).toBeNull()
    expect(c.roll).toBeNull()
    step(c, frameInput()) // 演出期内：蒙太奇走一格，输入路径整体关闭
    expect(c.executing!.tick).toBe(1)
  })

  it('死检查：hp ≤ 0 ⇒ update 只走 deadTicks，走满就自己 respawn（L328-333）', () => {
    const c = fresh()
    c.fadeDamage(99999)
    expect(c.dead_).toBe(true)
    for (let i = 0; i < 300 && c.dead_; i++) step(c, frameInput())
    expect(c.dead_, 'deadTicks 走满就该从 respawn 回来：死亡不该是单程票').toBe(false)
    expect(c.stats.hp).toBe(c.stats.hpMax)
  })

  it('jump：grounded + 空手 + 体力足 ⇒ 起跳；busy / 体力不足 ⇒ 不跳（L431-435）', () => {
    const c = fresh()
    c.grounded = true
    c.stats.stamina = c.stats.staMax
    const staBefore = c.stats.stamina
    step(c, frameInput(['jump']))
    expect(c.vy).toBeGreaterThan(0)
    expect(c.grounded).toBe(false)
    expect(c.stats.stamina).toBeLessThan(staBefore) // 起跳花了体力

    const b = fresh()
    b.grounded = true
    b.stunTicks = 1 // busy 的来源之一：硬直
    step(b, frameInput(['jump']))
    expect(b.vy).toBe(0)

    const s = fresh()
    s.grounded = true
    s.stats.stamina = 0 // 一帧的回复远够不到 6 点门槛：spendStamina 拒绝
    step(s, frameInput(['jump']))
    expect(s.vy).toBe(0)
  })

  it('dodge：超载 ⇒ 把拒判说出口；体力不足 ⇒ 静默拒绝；死亡 ⇒ 早退；正常 ⇒ 起滚（L436-442）', () => {
    const o = fresh()
    o.rpg.overloaded = true
    step(o, frameInput(['dodge']))
    expect(o.roll).toBeNull()
    expect(o.overloadWarnTicks).toBe(120) // 拒的同时说清是哪一维在拦（需求 §25）

    const s = fresh()
    s.stats.stamina = 0
    step(s, frameInput(['dodge']))
    expect(s.roll).toBeNull()
    expect(s.overloadWarnTicks).toBe(0) // 不是超载，不冒充超载警告

    const d = fresh()
    d.fadeDamage(99999)
    step(d, frameInput(['dodge'])) // 死亡分支在 update 入口就返回，根本走不到 dodge
    expect(d.roll).toBeNull()

    const c = fresh()
    c.stats.stamina = c.stats.staMax
    step(c, frameInput(['dodge'], [], { x: 0, y: 1 }))
    expect(c.roll).not.toBeNull()
    expect(c.stats.stamina).toBeLessThan(c.stats.staMax) // 翻滚付了体力
  })

  it('skill 位移：dir && skill && tick 在判定窗内 ⇒ 按窗长分步位移（L462-468）', () => {
    const c = fresh()
    c.pos = { x: 0, y: 0, z: 0 }
    c.action = {
      key: 'test', f: { startup: 0, activeStart: 2, activeEnd: 6, recovery: 10 } as any,
      tick: 3, hitDone: false, shots: 0, hitIds: new Set<string>(), stopTicks: 0, stopDebt: 0,
      skill: { distance: 5, landingPoise: 0 } as any, dir: { x: 1, y: 0, z: 0 },
    }
    step(c, frameInput())
    // 窗长 = activeEnd - activeStart + 1 = 5；tick 3 在窗内、advance 一格 ⇒ 位移 5/5 × 1 = 1
    expect(c.pos.x).toBeCloseTo(1, 5)
    expect(c.pos.z).toBeCloseTo(0, 5)
    expect(c.action!.tick).toBe(4)
  })

  it('sprint：按住疾跑耗体力，耗尽 ⇒ exhausted（L505-515）', () => {
    const c = fresh()
    c.stats.stamina = 5
    c.base.sprintCostPerSec = 100
    c.rpg.overloaded = false
    step(c, frameInput([], ['sprint'], { x: 0, y: 1 }), 0, 1) // dt=1：一秒疾跑烧干这 5 点
    expect(c.exhausted).toBe(true)
  })

  it('落地：fallSpeed > 8 ⇒ ring_dust + land_slam（L524-532）', () => {
    const c = fresh()
    const vfx: string[] = []
    const sfx: string[] = []
    bus.on('vfx.request', (p) => vfx.push(p.key))
    bus.on('audio.sfx', (p) => sfx.push(p.key))
    c.grounded = false
    c.vy = -12
    c.floorY = 0
    c.pos = { x: 0, y: 0, z: 0 }
    step(c, frameInput())
    expect(c.grounded).toBe(true)
    expect(vfx).toContain('ring_dust')
    expect(sfx).toContain('land_slam')
  })

  it('step up：floorY - pos.y 在 (0, STEP_UP] ⇒ 抬上台阶；超出容差不瞬移（L533-535）', () => {
    const c = fresh()
    c.grounded = true
    c.vy = 0
    c.pos = { x: 0, y: 0, z: 0 }
    c.floorY = 0.5
    step(c, frameInput())
    expect(c.pos.y).toBe(0.5)

    const far = fresh()
    far.grounded = true
    far.vy = 0
    far.pos = { x: 0, y: 0, z: 0 }
    far.floorY = 3
    step(far, frameInput())
    expect(far.pos.y).toBe(0) // 3 层的落差不在台阶容差内：不许被人拎起来
  })
})

describe('PlayerController：takeDamage 的死亡腿（L799-803 第一次有读者）', () => {
  it('打空血 ⇒ dead 置位、deadTicks 归零、player.died 恰发一声；死了再打不收', () => {
    const c = fresh()
    const deaths: number[] = []
    const off = bus.on('player.died', () => { deaths.push(1) })
    expect(c.takeDamage(c.stats.hpMax)).toBe(true)
    off()
    expect(c.dead_).toBe(true)
    expect((c as any).deadTicks).toBe(0)
    expect(deaths).toEqual([1])
    // 亡者不收刀：early return 挡在 iFrame/dead 那一行，讣告不重发
    expect(c.takeDamage(5)).toBe(false)
    expect(deaths).toEqual([1])
  })
})