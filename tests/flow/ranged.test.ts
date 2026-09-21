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
import { attrScale, damageReduction } from '@/combat/DamagePipeline'
import type { Projectile } from '@/combat/Projectiles'

/**
 * 弹道流程测试（需求 §59 自动化玩法流程 / combat.md §4.3 引针枪投掷 + §5 远程威胁）。
 * 全 headless：projectiles/combat/ai 都是逻辑层，不碰 three（tech-arch §5.8）。
 * 这里同时验收 KI-006 的关闭：投掷枪不再用「强力突刺」近似，而是真弹体 + 钉住定身。
 */

registerGameData()

type Hit = { attackerId: string; victimId: string; damage: number; result: string; kind: string }

function makeWorld(weaponId = 'wp_drawpin_spear') {
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
  const hits: Hit[] = []
  const off = bus.on('combat.hit', (p) => { hits.push(p as unknown as Hit) })

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(time.dt)
    }
  }
  /** 面向 -Z（把玩家摆在原点、目标摆在 -Z 轴上使用） */
  player.yaw = Math.PI
  return { time, rhythm, player, ai, combat, frame, tick, hits, off }
}

function hostile(w: ReturnType<typeof makeWorld>, from: Projectile['pos'], ownerId = 'en_test'): Projectile {
  return w.combat.projectiles.spawn({
    hostile: true, ownerId, kind: 'note', origin: { ...from }, dir: { x: 0, y: 0, z: 1 },
    speed: 13, range: 20, radius: 0.45, damage: 12, poise: 6, hitStopMs: 70
  }, w.time.tick)
}

/** 蓄力 → 松手 → 投掷枪出手 */
function throwSpear(w: ReturnType<typeof makeWorld>, hold = 60): void {
  w.frame.held.add('attackHeavy')
  w.tick(hold)
  w.frame.held.delete('attackHeavy')
  w.tick(2)
}

describe('玩家投掷枪（KI-006：真弹体替代突刺近似）', () => {
  it('蓄力松手后发射一枚弹体，12m 外命中并把敌人钉住', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -12 }, 'ranged')
    const before = e.stats.hp
    throwSpear(w)
    expect(w.player.action?.key).toBe('charged')
    expect(w.combat.projectiles.live).toBe(0) // 出手帧之前没有弹体
    let peak = 0
    let hitTick = -1
    for (let t = 0; t < 150; t++) {
      w.tick()
      peak = Math.max(peak, w.combat.projectiles.live)
      if (e.stats.hp < before) { hitTick = t; break }
    }
    expect(peak).toBe(1)
    expect(hitTick).toBeGreaterThan(8) // 飞过去的，不是原地摸到的
    expect(w.combat.projectiles.live).toBe(0)
    expect(e.stunTicks).toBeGreaterThan(0) // 钉住定身
    const hit = w.hits.find((h) => h.victimId === e.id)
    expect(hit?.attackerId).toBe('player')
    expect(hit?.kind).toBe('heavy')
    w.off()
  })

  it('远程命中走 DR×0.6：同一发对重甲靶的伤害高于近战减伤公式', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -10 }, 'dr')
    e.stats.defense = 120 // 重甲靶：近战减伤 0.5，远程减伤 0.3（DamagePipeline §12）
    const f = registry.get<MovesetData>('moveset:ms_spear').actions['charged']
    const scale = attrScale({ base: f.damage, defense: 0, attrs: playerBase.attrs, scaling: w.player.weapon.scaling })
    const ranged = [1, -1].map((s) => f.damage * scale * (1 + s * 0.05) * (1 - damageReduction(120, true)))
    const meleeHi = f.damage * scale * 1.05 * (1 - damageReduction(120, false))
    let dmg = 0
    throwSpear(w)
    for (let t = 0; t < 150 && !dmg; t++) {
      w.tick()
      dmg = w.hits.find((h) => h.victimId === e.id)?.damage ?? 0
    }
    expect(dmg).toBeGreaterThan(Math.min(...ranged) - 1)
    expect(dmg).toBeLessThan(Math.max(...ranged) + 1)
    expect(dmg, '远程减伤分支必须真的生效').toBeGreaterThan(meleeHi)
    w.off()
  })

  it('charged 帧表只剩弹道：没有近战判定盒（伤害只可能来自弹体）', () => {
    const f = registry.get<MovesetData>('moveset:ms_spear').actions['charged']
    expect(f.hitbox, '旧的强力突刺近似必须删掉').toBeUndefined()
    expect(f.projectile?.kind).toBe('spear')
    expect(f.projectile!.pinTicks).toBeGreaterThan(0)
    expect(f.projectile!.speed).toBeGreaterThan(10)
    const w = makeWorld()
    throwSpear(w)
    expect(w.player.action?.f.hitbox).toBeUndefined()
    w.off()
  })
})

describe('敌方远程：漂调者（en_driftsinger）', () => {
  it('数据表把它标成 ranged，并带一条只发弹体的招式', () => {
    const d = registry.get<import('@/data/schema').EnemyData>('en_driftsinger')
    expect(d.archetype).toBe('ranged')
    const shot = d.attacks.find((a) => !!a.frames.projectile)
    expect(shot, '应有一条 frames.projectile 招式').toBeTruthy()
    expect(shot!.frames.hitbox, '远程招式不带近战判定盒').toBeUndefined()
    const band = d.ai.distBands.find((b) => b.actions.includes(shot!.id))
    expect(band).toBeTruthy()
    expect(band!.min, '保持距离：不在贴身距离射击').toBeGreaterThan(2)
  })

  it('中距离自动放音弹，玩家站着就会被命中掉血', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_driftsinger', { x: 0, y: 0, z: -8 }, 'ai')
    e.alertness = 100
    e.enter('chase') // 只测弹道分支，感知由 spawn/ai 的既有用例覆盖
    const hp0 = w.player.stats.hp
    let sawShot = 0
    for (let t = 0; t < 900 && w.player.stats.hp === hp0; t++) {
      w.tick()
      sawShot = Math.max(sawShot, w.combat.projectiles.live)
    }
    expect(sawShot).toBeGreaterThanOrEqual(1)
    expect(w.player.stats.hp).toBeLessThan(hp0)
    const hit = w.hits.find((h) => h.attackerId === e.id)
    expect(hit?.result).toBe('hit')
    w.off()
  })

  it('翻滚无敌帧能穿弹（§5：弹体同样吃 i-frame）', () => {
    const w = makeWorld()
    const hp0 = w.player.stats.hp
    // 2.4m：倒退翻滚相对接近速度只剩 ~0.11m/tick，接触落在无敌帧（9~21）内
    hostile(w, { x: 0, y: 1.1, z: -2.4 })
    w.frame.edges.add('dodge')
    for (let t = 0; t < 90 && w.combat.projectiles.live; t++) w.tick()
    expect(w.player.stats.hp).toBe(hp0)
    expect(w.hits.some((h) => h.result === 'immune')).toBe(true)
    w.off()
  })

  it('弹反把音弹打散：不掉血、给过载、弹体消失', () => {
    const w = makeWorld()
    const hp0 = w.player.stats.hp
    const oc0 = w.player.stats.overdrive
    hostile(w, { x: 0, y: 1.1, z: -3.4 })
    let parried = false
    for (let t = 0; t < 120 && w.combat.projectiles.live; t++) {
      const p = w.combat.projectiles.list()[0]
      const dist = Math.hypot(p.pos.x, p.pos.z)
      if (dist < 2.6 && w.player.parryTicksLeft === 0) w.frame.edges.add('parry') // 贴着脸才抬手
      w.tick()
      if (w.hits.some((h) => h.result === 'parry')) { parried = true; break }
    }
    expect(parried).toBe(true)
    expect(w.player.stats.hp).toBe(hp0)
    expect(w.player.stats.overdrive).toBe(oc0 + playerBase.parry.overdriveGain)
    expect(w.combat.projectiles.live).toBe(0)
    w.off()
  })

  it('主人被流送回收后，它的弹体一并消失（§5.5 回收闭环）', () => {
    const w = makeWorld()
    hostile(w, { x: 0, y: 1.1, z: -6 }, 'en_42')
    expect(w.combat.projectiles.live).toBe(1)
    bus.emit('entity.despawned', { id: 'en_42', kind: 'enemy' })
    w.tick()
    expect(w.combat.projectiles.live).toBe(0)
    w.off()
  })

  it('格挡能扛音弹：不掉血但掉体力，且弹体不会穿人', () => {
    const w = makeWorld()
    const hp0 = w.player.stats.hp
    hostile(w, { x: 0, y: 1.1, z: -6 })
    w.frame.held.add('guard')
    for (let t = 0; t < 90 && w.combat.projectiles.live; t++) w.tick()
    const hit = w.hits.find((h) => h.attackerId === 'en_test')
    expect(hit?.result).toBe('block')
    expect(hit?.damage).toBeLessThan(12) // 12 点裸伤经 guard.reduction 减免
    expect(w.player.stats.hp).toBe(hp0) // §5.1：格挡扛住 = 只付体力，不掉生命
    expect(w.player.stats.stamina).toBeLessThan(w.player.stats.staMax)
    expect(w.combat.projectiles.live).toBe(0)
    w.off()
  })
})
