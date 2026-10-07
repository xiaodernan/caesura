import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Projectile } from '@/combat/Projectiles'

/**
 * 批22b：CombatManager 弹道组的死分支腿点亮（KI 死腿清扫第二批）。
 * 夹具与 tests/flow/combat-deadlegs.test.ts 同构，另注入 floorAt（晶要能落地碎裂）。
 * 每条用例点名它负责的行；门禁由 .scratch/check_b22b.mjs 按列级位置逐一验亮
 * （v8 分支 id 跨运行会漂移，永远不按 tag 匹配）。
 */

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>('ms_sword')
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  combat.floorAt = () => 0 // 地面在 y=0：晶的碎裂走『落地』出口（生产由 Surface 注入；sonic-decoy 同款）

  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const vfx: Array<{ key: string; scale?: number }> = []
  const sounds: Array<{ id: string; loudness: number }> = []
  const hits: Array<{ attackerId: string; victimId?: string; result: string }> = []
  bus.on('vfx.request', (p) => vfx.push(p as never))
  bus.on('sound.source', (p) => sounds.push(p as never))
  bus.on('combat.hit', (p) => hits.push(p as never))

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
  return { time, rhythm, player, ai, combat, frame, tick, vfx, sounds, hits }
}

type World = ReturnType<typeof makeWorld>

/** 一发玩家弹体沿 -z 直飞（batch22a 同款） */
function fireBolt(w: World, origin: { x: number; y: number; z: number }): Projectile {
  return w.combat.projectiles.spawn({
    hostile: false, ownerId: 'player', kind: 'bolt',
    origin, dir: { x: 0, y: 0, z: -1 },
    speed: 20, range: 12, radius: 0.3, gravity: 0,
    damage: 9, poise: 4, hitStopMs: 0, parryable: false,
    layers: 1, pinTicks: 0, onBeat: false, loudness: 4
  }, w.time.tick)
}

/** 蓄力 → 松手（ranged.test 同款节奏：60 拍蓄满，2 拍收势） */
function chargeRelease(w: World): void {
  w.frame.held.add('attackHeavy')
  w.tick(60)
  w.frame.held.delete('attackHeavy')
  w.tick(2)
}

describe('批22b CombatManager 弹道组死腿（每条用例点名它负责的行）', () => {
  it('L665/L884 投晶真出手：spec 缺 offsetY 与 loudness，出手点与碎裂声各落一次兜底', () => {
    const w = makeWorld()
    w.combat.crystalSource = () => ({
      available: 3, consume: () => {},
      spec: { speed: 12, range: 10, radius: 0.3, gravity: 30, loudness: undefined as unknown as number }
    })
    w.frame.edges.add('throwCrystal')
    w.tick(40) // 晶出手（offsetY 兜底 1.2）→ 重力 30 压低抛物线 → y<=0.06 落地碎裂
    const slam = w.sounds.find((s) => s.id === 'player')
    expect(slam, '碎裂必须广播一次伪声源（解法循环的 A 点）').toBeTruthy()
    expect(slam!.loudness, 'crystalLoudness 缺席 ⇒ 落 0.8 兜底').toBeCloseTo(0.8, 5)
    expect(w.vfx.some((v) => v.key === 'death_shatter'), '碎裂演出要发').toBe(true)
  })

  it('L679-697 克隆谱册发射：burst 帧位、锁定 target、拍窗 80 与一串缺省兜底', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -12 }, 'dl679')
    e.enter('idle')
    const clone = structuredClone(registry.get<MovesetData>('moveset:ms_spear'))
    const f = clone.actions.charged
    const p = f.projectile as unknown as Record<string, unknown>
    p.offsetY = undefined; p.pinTicks = undefined; p.shake = undefined
    p.burst = { count: 2, everyTicks: 8 }
    const fr = f as unknown as Record<string, unknown>
    fr.shake = undefined; fr.loudness = undefined
    w.player.equip(registry.get<WeaponData>('wp_drawpin_spear'), clone)
    w.player.lockedTarget = { getPos: () => e.pos, radius: 0.6 }
    w.player.beatGraceTicks = 200 // 60 拍蓄力衰减后仍 >0 ⇒ onBeat 走 80 那一档
    chargeRelease(w)
    for (let t = 0; t < 60 && w.combat.projectiles.live === 0; t++) w.tick()
    expect(w.combat.projectiles.live, '出手帧要发射弹体').toBeGreaterThanOrEqual(1)
    for (let t = 0; t < 120 && !w.hits.some((h) => h.attackerId === 'player'); t++) w.tick()
    const h = w.hits.find((x) => x.attackerId === 'player')
    expect(h, '锁定目标的那一投必须真飞过去').toBeTruthy()
    expect(e.stats.hp).toBeLessThan(e.stats.hpMax)
  })

  it("L692 层别链：h 与 l1 借用弹体帧位 ⇒ charged 三元链的 else 腿亮", () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'dl692')
    e.enter('idle')
    const clone = structuredClone(registry.get<MovesetData>('moveset:ms_spear'))
    const spec = { kind: 'spear' as const, speed: 28, range: 26, radius: 0.38, gravity: 0, pierce: 0 }
    clone.actions.h.projectile = spec
    clone.actions.l1.projectile = { ...spec }
    w.player.equip(registry.get<WeaponData>('wp_drawpin_spear'), clone)
    expect(w.player.tryStartAction('h', w.time.tick), '重击出手失败：本用例前提失效').toBe(true)
    for (let t = 0; t < 90 && w.combat.projectiles.live === 0; t++) w.tick()
    expect(w.combat.projectiles.live, 'h 的弹体要出手').toBeGreaterThanOrEqual(1)
    for (let t = 0; t < 160 && w.player.action; t++) w.tick()
    expect(w.player.tryStartAction('l1', w.time.tick), '轻击出手失败：本用例前提失效').toBe(true)
    const before = w.combat.projectiles.list().length
    for (let t = 0; t < 60 && w.combat.projectiles.list().length <= before; t++) w.tick()
    expect(w.combat.projectiles.list().length, 'l1 的弹体也要出手').toBeGreaterThan(before)
  })

  it('L717-734 敌射账本：buff 加成、shake/loudness/sfx 全兜底（手造 pending 连发）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'dl717')
    e.enter('idle')
    // pendingProjectile 是每 tick 从攻击态派生的 getter；手造一发"永远待发"的弹
    // （getter 在原型上，自有属性把它盖住；markShotFired 在 attack=null 时是空操作）
    const pending = {
      spec: { kind: 'note', speed: 13, range: 20, radius: 0.4, gravity: 0 },
      frames: { damage: 6, poise: 3, hitStopMs: 0 },
      reaction: null, feintPunishMs: null
    }
    // §14.6 定调光环：AISystem 每 tick 先清 buff 再按 aura 重算——手工赋值活不过一拍，
    // 得真站一只 refrein 当 aura 源，发射那拍 buff 才非空（L717 access 腿由此点亮）
    w.ai.spawn('en_refrein', { x: 0, y: 0, z: -5 }, 'dl717_aura')
    Object.defineProperty(e, 'pendingProjectile', { value: pending, configurable: true })
    w.tick(7) // 连发七拍：期间光环加成在读（buff 非空），自有属性常驻每拍出手
    delete (e as unknown as { pendingProjectile?: unknown }).pendingProjectile // 收弹：自有属性撤掉，getter 回来说没有
    for (let t = 0; t < 120 && w.hits.filter((h) => h.attackerId === e.id).length < 2; t++) w.tick()
    const fired = w.hits.filter((h) => h.attackerId === e.id)
    expect(fired.length, '这一串都要真的离手并打到玩家').toBeGreaterThanOrEqual(2)
    const wail = w.sounds.find((s) => s.id === e.id)
    expect(wail, '离手那一 tick 要报一次声源').toBeTruthy()
    expect(wail!.loudness, 'frames.loudness 缺席 ⇒ (4)/10 兜底').toBeCloseTo(0.4, 5)
  })

  it('L825/L836 反射账本：贴脸零速弹被弹反，hypot||1 与拍窗 80 双兜底', () => {
    const w = makeWorld()
    const shooter = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -8 }, 'dl825')
    shooter.enter('idle')
    w.player.yaw = Math.PI // 面朝 -z：facing 判的是弹相对玩家的方位角，背身弹反不算
    w.player.beatGraceTicks = 100
    w.frame.edges.add('parry')
    w.tick() // 先把弹反的窗口架起来，弹体下一拍才到
    w.combat.projectiles.spawn({
      hostile: true, ownerId: shooter.id, kind: 'note',
      origin: { x: 0, y: 1.1, z: -0.8 }, dir: { x: 0, y: 0, z: 0 },
      speed: 13, range: 20, radius: 0.45, damage: 12, poise: 6, hitStopMs: 70
    }, w.time.tick)
    w.tick()
    expect(w.hits.some((h) => h.result === 'parry'), '贴脸零速弹必须在弹反窗口内被接下').toBe(true)
    const back = w.combat.projectiles.list()[0]
    expect(back, '原弹不该凭空消失：反射体就位').toBeTruthy()
    expect(back!.hostile, '反射体是友方的').toBe(false)
  })

  it('L856 诚实赤线：发射点与目标完全重合 ⇒ dir 零向量落 || 1 兜底', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 0 }, 'dl856')
    e.enter('idle')
    e.pos = { x: 0, y: 0, z: 0 } // 与玩家完全重合：from == target（offsetY 0.9 对齐目标胸口）
    Object.defineProperty(e, 'telegraphProjectile', {
      value: {
        spec: { kind: 'note', speed: 13, range: 20, radius: 0.3, offsetY: 0.9, gravity: 0 },
        ticksLeft: 10, totalTicks: 48
      },
      configurable: true
    })
    const lines = w.combat.telegraphs()
    expect(lines.length, '重合点也要给出一条零长的诚实线').toBe(1)
    expect(lines[0]!.to.x, '线长为零：终点就在发射点').toBe(lines[0]!.from.x)
    expect(lines[0]!.to.z).toBe(lines[0]!.from.z)
  })

  it("L889 撞墙的灰：ring_dust 给 1.4 档（落地只有 0.4）", () => {
    const w = makeWorld()
    w.combat.occlusion.syncAuthored({
      id: 'rg_dl889',
      walls: [{ id: 'wb_dl889', pos: { x: 0, y: 0, z: -2 }, size: { x: 6, z: 0.6 }, heightM: 3 }]
    })
    fireBolt(w, { x: 0, y: 1.2, z: 0 }) // y=1.2 < 墙高 3 ⇒ 6 tick 内撞在柱面上
    w.tick(12)
    const dust = w.vfx.find((v) => v.key === 'ring_dust')
    expect(dust, '撞墙必须撒一撮灰').toBeTruthy()
    expect(dust!.scale, '墙灰比落地灰大：1.4 对 0.4').toBe(1.4)
    // 落地腿：一发朝地的弹自然触地，走 0.4 小尘（wall 1.4 的对面那条腿）
    w.combat.projectiles.spawn({
      hostile: true, ownerId: 'dl889', kind: 'note',
      origin: { x: 0, y: 1, z: -3 }, dir: { x: 0, y: -1, z: 0 },
      speed: 10, range: 20, radius: 0.4, damage: 4, poise: 2, hitStopMs: 0
    }, w.time.tick)
    for (let t = 0; t < 40; t++) w.tick()
    const groundDust = w.vfx.filter((v) => v.key === 'ring_dust').at(-1)
    expect(groundDust, '落地也得撒灰').toBeTruthy()
    expect(groundDust!.scale, '落地灰是 0.4 档').toBe(0.4)
  })
})
