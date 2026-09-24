import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, enemiesRaw } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'

/**
 * 支援位流程测试（需求 §59 / combat.md §14.6 叠唱 Refrein）。
 * 覆盖两件事：
 *  1) 「定调」光环完全由 buffAura 数据驱动（范围 + 两个倍率 + 单一最近来源）；
 *  2) 「走调时刻」= 击杀支援母 → 全场失衡，以及它的噪音弹给玩家挂的闷音时长取自数据。
 */

registerGameData()

type Hit = { attackerId: string; victimId: string; damage: number; result: string }

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_drawpin_spear')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.yaw = Math.PI
  const hits: Hit[] = []
  const notifies: string[] = []
  const offHit = bus.on('combat.hit', (p) => { hits.push(p as unknown as Hit) })
  const offNotify = bus.on('ui.notify', (p) => { notifies.push(p.text) })

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  const dist = (e: Enemy) => Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z)
  const off = () => { offHit(); offNotify() }
  return { time, rhythm, player, ai, combat, frame, tick, hits, notifies, dist, off }
}

function refrein(w: ReturnType<typeof makeWorld>, x = 0, z = -16): Enemy {
  const e = w.ai.spawn('en_refrein', { x, y: 0, z }, 'support')
  e.alertness = 100
  e.enter('chase')
  return e
}

/** 绕开随机选招：直接把敌人摆进某招的某一帧 */
function force(e: Enemy, id: string, tickIn = 0): void {
  const spec = e.data.attacks.find((a) => a.id === id)!
  e.attack = newAttack(spec, tickIn)
  e.enter('combat')
}

describe('叠唱 Refrein 数据表（§14.6）', () => {
  const d = () => registry.get<EnemyData>('en_refrein')

  it('支援位：12m 光环 + 攻速 1.15 + 伤害 1.1，全在表里而不在代码里', () => {
    const e = d()
    expect(e.archetype).toBe('support')
    expect(e.hp).toBe(65)
    expect(e.poise).toBe(30)
    expect(e.speed).toBeCloseTo(2.0, 5)
    const aura = e.ai.buffAura!
    expect(aura.range, '周围 12m 喧堕者').toBe(12)
    expect(aura.attackSpeedMul).toBeCloseTo(1.15, 5)
    expect(aura.dmgMul, '伤害 +10%').toBeCloseTo(1.1, 5)
  })

  it('弱点=不追不逃：距离带里只有伪动作 hold + 噪音弹，且没有近战判定盒', () => {
    const e = d()
    expect(e.ai.distBands[0].actions).toEqual(['hold', 'noise'])
    const noise = e.attacks.find((a) => a.id === 'noise')!
    expect(noise.frames.hitbox, '支援位不近身').toBeUndefined()
    expect(noise.frames.projectile?.range, '噪音弹直线 18m').toBe(18)
    expect(noise.frames.projectile?.muteOnHit, '闷音 2s = 120 tick').toBe(120)
    expect(noise.frames.damage).toBe(10)
    expect(e.ai.offTuneOnDeath).toMatchObject({ stunTicks: 90, resetAlertness: true })
  })

  it('闷音类 statusOnHit 必须自带时长：驼鼓只写 tag 时曾经空转（回归）', () => {
    let seen = 0
    for (const e of enemiesRaw as unknown as EnemyData[]) {
      for (const a of e.attacks) {
        const st = a.statusOnHit
        if (!st || !/(^|\.)mute$/.test(st.tag)) continue
        expect(st.ticks, `${e.id}/${a.id} 的闷音没有声明 ticks`).toBeGreaterThan(0)
        seen++
      }
    }
    expect(seen, '至少要有驼鼓的近战闷音在扫围内').toBeGreaterThan(0)
  })
})

describe('定调光环：范围、来源与两个倍率', () => {
  it('12m 内的同伴吃到 buff（fromId 指向叠唱），12m 外的没有', () => {
    const w = makeWorld()
    const s = refrein(w, 0, -16)
    const inside = w.ai.spawn('en_murkshell', { x: 6, y: 0, z: -16 }, 'in')
    const outside = w.ai.spawn('en_murkshell', { x: 30, y: 0, z: -16 }, 'out')
    w.tick()
    expect(inside.buff).toMatchObject({ fromId: s.id })
    expect(inside.buff!.attackSpeedMul).toBe(s.data.ai.buffAura!.attackSpeedMul)
    expect(inside.buff!.dmgMul).toBe(s.data.ai.buffAura!.dmgMul)
    expect(outside.buff, '超出 buffAura.range 就不该被定调').toBeNull()
    // 光环不移动施主：支援位站定唱
    expect(w.dist(s), 'hold = 不追不逃').toBeLessThan(20)
    w.off()
  })

  it('两个来源不叠加：只认最近的那一个', () => {
    const w = makeWorld()
    const near = refrein(w, 3, -16)
    const far = refrein(w, -6, -16)
    const target = w.ai.spawn('en_murkshell', { x: 4, y: 0, z: -16 }, 't')
    w.tick()
    expect(Math.hypot(far.pos.x - target.pos.x, far.pos.z - target.pos.z), '两只都覆盖到它，才能证明不叠加')
      .toBeLessThan(near.data.ai.buffAura!.range)
    expect(target.buff!.fromId, '取最近来源，不做乘算叠加').toBe(near.id)
    expect(target.buff!.dmgMul).toBeCloseTo(near.data.ai.buffAura!.dmgMul, 6)
    expect(far.alive).toBe(true)
    w.off()
  })

  it('施主一死光环立刻消失（每 tick 重算，不需要事件清理）', () => {
    const w = makeWorld()
    const s = refrein(w, 0, -16)
    const target = w.ai.spawn('en_murkshell', { x: 4, y: 0, z: -16 }, 't2')
    w.tick()
    expect(target.buff).not.toBeNull()
    s.stats.damage(s.stats.hpMax)
    s.enter('dead')
    w.tick()
    expect(target.buff, '死掉的支援不再提供定调').toBeNull()
    w.off()
  })

  it('伤害倍率走 activeHitbox：同一种怪，被定调的那只更痛', () => {
    const w = makeWorld()
    // 两只都摆在 40m 外：只读判定盒数值，不让它们真的打到玩家
    const s = refrein(w, 0, -40)
    const buffed = w.ai.spawn('en_murkshell', { x: 2, y: 0, z: -40 }, 'b')
    const plain = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -65 }, 'p')
    const id = plain.data.attacks.find((a) => !!a.frames.hitbox)!.id
    const start = plain.data.attacks.find((a) => a.id === id)!.frames.activeStart
    force(buffed, id, start)
    force(plain, id, start)
    w.tick()
    const base = plain.activeHitbox!.damage
    const mul = s.data.ai.buffAura!.dmgMul
    expect(buffed.buff).not.toBeNull()
    expect(plain.buff, '25m 外的同伴不在光环里').toBeNull()
    expect(buffed.activeHitbox!.damage, '= base × dmgMul').toBeCloseTo(base * mul, 5)
    w.off()
  })

  it('攻速倍率真的让招式提前结束，且整数帧累加不破坏 === startup 广播点', () => {
    const run = (withBuff: boolean): number => {
      const w = makeWorld()
      const ox = withBuff ? 0 : 60
      if (withBuff) refrein(w, ox, -40)
      const e = w.ai.spawn('en_murkshell', { x: ox + 2, y: 0, z: -40 }, 'x')
      const id = e.data.attacks.find((a) => !!a.frames.hitbox)!.id
      force(e, id, 0)
      let n = 0
      while (e.attack && n < 400) { w.tick(); n++ }
      w.off()
      return n
    }
    const plain = run(false)
    const buffed = run(true)
    const mul = registry.get<EnemyData>('en_refrein').ai.buffAura!.attackSpeedMul
    expect(buffed).toBeLessThan(plain)
    expect(buffed, '≈ plain / mul（整数帧累加允许 1 tick 误差）').toBeGreaterThanOrEqual(Math.floor(plain / mul) - 1)
  })
})

describe('走调时刻（§14.6 击杀支援 → 全营失衡）', () => {
  /** 走真实伤害通道（弹体 -> strikeEnemy -> onEnemyKilled），2 tick 内确定性地打死目标 */
  function kill(w: ReturnType<typeof makeWorld>, target: Enemy): void {
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: target.pos.x, y: target.pos.y + 1.1, z: target.pos.z }, dir: { x: 0, y: 0, z: 1 },
      speed: 2, range: 5, radius: 1, damage: 9999, poise: 0, hitStopMs: 0
    }, w.time.tick)
    for (let t = 0; t < 10 && target.alive; t++) w.tick()
  }

  it('射杀死一只叠唱：同伴全部硬直、警觉归零、正在读条的招式被打断', () => {
    const w = makeWorld()
    const s = refrein(w, 0, -8)
    const a = w.ai.spawn('en_murkshell', { x: -4, y: 0, z: -10 }, 'a')
    const b = w.ai.spawn('en_driftsinger', { x: 5, y: 0, z: -10 }, 'b')
    for (const e of [a, b]) { e.alertness = 100; e.enter('chase') }
    w.tick(2)
    const long = b.data.attacks.reduce((x, y) => (y.frames.recovery > x.frames.recovery ? y : x))
    force(b, long.id, 0)
    expect(b.attack, '先让它进入读条').not.toBeNull()
    expect(a.stunTicks).toBe(0)

    kill(w, s)
    expect(s.alive).toBe(false)
    expect(w.notifies.some((x) => x.includes('走调时刻'))).toBe(true)
    expect(b.attack, '正在读条的招式被打断').toBeNull()
    for (const e of [a, b]) {
      expect(e.stunTicks, '90 tick = 1.5s 失衡').toBeGreaterThan(60)
      expect(e.alertness, 'Alertness 归零').toBe(0)
    }
    w.off()
  })

  it('没有 offTuneOnDeath 的普通敌人死亡不会触发走调时刻', () => {
    const w = makeWorld()
    const plain = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -10 }, 'plain')
    const witness = w.ai.spawn('en_murkshell', { x: 3, y: 0, z: -10 }, 'wit')
    witness.alertness = 100
    witness.enter('chase')
    w.tick(2)
    kill(w, plain)
    expect(plain.alive).toBe(false)
    expect(w.notifies.some((x) => x.includes('走调时刻'))).toBe(false)
    expect(witness.stunTicks).toBe(0)
    expect(witness.alertness, '普通敌人死了不该重置同伴警觉').toBeGreaterThan(0)
    w.off()
  })
})

describe('闷音（Mute）：时长一律取自数据', () => {
  it('站着挨一发噪音弹 → 掉血 + muteTicksLeft=120（2s，不是硬编码 4s）', () => {
    const w = makeWorld()
    const hp0 = w.player.stats.hp
    const pr = w.combat.projectiles.spawn({
      hostile: true, ownerId: 'en_refrein_test', kind: 'note',
      origin: { x: 0, y: 1.1, z: -4 }, dir: { x: 0, y: 0, z: 1 },
      speed: 20, range: 18, radius: 0.4, damage: 10, poise: 6, hitStopMs: 60, muteTicks: 120
    }, w.time.tick)
    for (let t = 0; t < 60 && !pr.dead; t++) w.tick()
    expect(w.player.stats.hp).toBeLessThan(hp0)
    expect(w.player.stats.muteTicksLeft).toBe(120)
    w.off()
  })

  it('闷音期间体力回复减速（§11 唯一已落地的消费方）', () => {
    const w = makeWorld()
    w.player.stats.stamina = 10
    w.tick(30)
    const plainGain = w.player.stats.stamina
    w.player.stats.stamina = 10
    w.player.stats.muteTicksLeft = 200
    w.tick(30)
    expect(w.player.stats.stamina, '−30% 回复').toBeLessThan(plainGain)
    w.off()
  })

  it('反射一颗带闷音的弹体，闷音跟着反射体回敬给射手', () => {
    const w = makeWorld()
    const shooter = w.ai.spawn('en_refrein', { x: 0, y: 0, z: -9 }, 'shooter')
    shooter.attack = null
    const pr = w.combat.projectiles.spawn({
      hostile: true, ownerId: shooter.id, kind: 'note',
      origin: { x: 0, y: 1.1, z: -3.4 }, dir: { x: 0, y: 0, z: 1 },
      speed: 20, range: 18, radius: 0.4, damage: 10, poise: 6, hitStopMs: 60, muteTicks: 120
    }, w.time.tick)
    let parried = false
    for (let t = 0; t < 120; t++) {
      if (!pr.dead && Math.hypot(pr.pos.x, pr.pos.z) < 2.6 && w.player.parryTicksLeft === 0) w.frame.edges.add('parry')
      w.tick()
      if (w.hits.some((h) => h.result === 'parry')) { parried = true; break }
    }
    expect(parried).toBe(true)
    const back = w.combat.projectiles.list()[0]
    expect(back?.ownerId).toBe('player')
    expect(back?.muteTicks, '沉默的时长跟着弹体反射，不重新计算').toBe(120)
    w.off()
  })

  it('近战闷音同样落地：驼鼓踏地（圆环 r=4m）打到人就挂 240 tick', () => {
    const w = makeWorld()
    const drum = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -2.2 }, 'drum')
    drum.alertness = 100
    const stomp = drum.data.attacks.find((a) => a.id === 'stomp')!
    expect(stomp.statusOnHit?.ticks, '时长声明在招式层，不是 frames 层').toBeGreaterThan(0)
    force(drum, 'stomp', stomp.frames.activeStart)
    let muted = 0
    for (let t = 0; t < 60; t++) { w.tick(); muted = Math.max(muted, w.player.stats.muteTicksLeft) }
    expect(w.hits.some((h) => h.attackerId === drum.id), '踏地波应该打到站着的人').toBe(true)
    expect(muted, '闷音 4s = 240 tick（§11）').toBe(240)
    w.off()
  })
})
