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
import { resolveDamage } from '@/combat/DamagePipeline'
import type { Projectile } from '@/combat/Projectiles'

/**
 * KI-037 ①：泛音弓 + 律具·音叉杖入表后的**机制腿**（combat.md §4.4/§4.5）。
 * 帧表逐格对账住在 tests/unit/movesets.test.ts；这里量的是帧表读不出来、必须真跑一遍的东西：
 *   - 满弓泛音分叉：burst.count 含主箭，枝按 branchDamageMul 打折、以瞄准为中心对称排布；
 *   - rank12 里程碑 ms_bow_split 的 bowForkBranches：只往枝数上加，不动主箭；
 *   - 距离衰减：武器级 falloff（>20m ×0.85 / >40m ×0.6）按 traveled 逐档查；
 *   - 主箭自动吸附：没锁定时在 assistConeDeg 锥内挑最近的活敌，分叉枝不另找目标；
 *   - **双乘回归**：武器强化倍率只由 strikeEnemy 的 mvMul 乘一次（出海时不再乘）；
 *   - 音叉杖：敲击链 / 全周扩散环 multi=8 / 共振弹 note 弹体。
 */

registerGameData()

type Hit = { attackerId: string; victimId: string; damage: number; result: string; kind: string }
type World = ReturnType<typeof makeWorld>

function makeWorld(weaponId = 'wp_overtone_bow') {
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
  player.yaw = 0 // 面向 +Z：弹道方向就是 { sin(0), cos(0) }
  const hits: Hit[] = []
  const off = bus.on('combat.hit', (p) => { hits.push(p as unknown as Hit) })

  /** withAi=false：冻住 AI（敌人不走路不还手），让"飞了多远"这件事可复现 */
  function tick(n = 1, withAi = true): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      if (withAi) ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, off, weapon }
}

/** 蓄满再松手 ⇒ 走 charged 那一式（逐武器阈值：弓 48f、杖 54f；统一按 60 拍留余量，KI-117②） */
function chargeShot(w: World): void {
  w.frame.held.add('attackHeavy')
  w.tick(60)
  w.frame.held.delete('attackHeavy')
  w.tick(1)
}

/** 快按一下重击（chargeTicks < 8）⇒ 走 h 那一式 */
function tapHeavy(w: World): void {
  w.frame.held.add('attackHeavy')
  w.tick(1)
  w.frame.held.delete('attackHeavy')
  w.tick(1)
}

/** 把这一轮真的出了几发弹体按出手顺序收回来 */
function collect(w: World, ticks = 30): Projectile[] {
  const seen: Projectile[] = []
  for (let t = 0; t < ticks; t++) {
    w.tick()
    for (const p of w.combat.projectiles.list()) if (!seen.includes(p)) seen.push(p)
  }
  return seen
}

const yawOf = (p: Projectile): number => Math.atan2(p.vel.x, p.vel.z)
const DEG = Math.PI / 180

/** 与 strikeEnemy 里那次 resolveDamage 同参，只把随机数钉成 0.5（方差归零） */
function expectedHit(w: World, base: number, defense = 0): number {
  return resolveDamage({
    base, attrs: w.player.rpg.attrs, scaling: w.player.weapon.scaling,
    defense, ranged: true, critRate: w.player.rpg.critRate, critMul: w.player.rpg.critMul
  }, () => 0.5).damage
}

describe('泛音弓满弓：泛音分叉（§4.4）', () => {
  it('一发出手三支箭：主箭不偏、两枝对称 ±12°，枝伤 = 主箭的 60%', () => {
    const w = makeWorld()
    chargeShot(w)
    expect(w.player.action?.key).toBe('charged')
    const shots = collect(w)
    expect(shots).toHaveLength(3)
    expect(shots[1].damage, '18（主）').toBe(18)
    expect(shots[0].damage, '枝 = 60%').toBeCloseTo(10.8, 10)
    expect(shots[2].damage, '枝 = 60%').toBeCloseTo(10.8, 10)
    expect(yawOf(shots[1]), '主箭（中间那一发）不偏').toBeCloseTo(0, 6)
    expect(yawOf(shots[0]), '第一枝 -12°').toBeCloseTo(-12 * DEG, 6)
    expect(yawOf(shots[2]), '第二枝 +12°').toBeCloseTo(12 * DEG, 6)
    expect(shots.every((p) => p.kind === 'arrow')).toBe(true)
    w.off()
  })

  it('rank12 里程碑 ms_bow_split：分叉 2→3 枝，主箭仍是离中心最近的那一发', () => {
    const w = makeWorld()
    w.player.rpg.bowForkBranches = 1 // progression.json rank12 grant（若用弓）
    chargeShot(w)
    const shots = collect(w)
    expect(shots).toHaveLength(4)
    expect(shots[1].damage, '主箭仍是 18').toBe(18)
    for (const i of [0, 2, 3]) expect(shots[i].damage, `第 ${i} 枝`).toBeCloseTo(10.8, 10)
    expect(yawOf(shots[0]), 'count=4 ⇒ 中心在 1.5，四发各偏 ±18°/±6°').toBeCloseTo(-18 * DEG, 6)
    expect(yawOf(shots[1]), '并列时取下标小的一发当主箭 ⇒ shot1').toBeCloseTo(-6 * DEG, 6)
    expect(yawOf(shots[2])).toBeCloseTo(6 * DEG, 6)
    expect(yawOf(shots[3])).toBeCloseTo(18 * DEG, 6)
    w.off()
  })

  it('速射只有一发：没有 burst 就不该凭空分叉', () => {
    const w = makeWorld()
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect(w.player.action?.key).toBe('l1')
    const shots = collect(w)
    expect(shots).toHaveLength(1)
    expect(shots[0].damage).toBe(10)
    expect(yawOf(shots[0])).toBeCloseTo(0, 6)
    w.off()
  })

  it('移动中散布：出手那一刻在动 ⇒ 这一发被 seeded rng 推偏，但推不出 ±2° 半宽', () => {
    const w = makeWorld()
    w.frame.move = { x: 1, y: 0 }
    w.frame.edges.add('attackLight')
    w.tick(1)
    const shots = collect(w)
    expect(shots).toHaveLength(1)
    expect(w.player.moving, 'moveIntent 模 >0.5 才算在动').toBe(true)
    expect(Math.abs(yawOf(shots[0])), '±4°/2 = ±2° 半宽').toBeLessThanOrEqual(2 * DEG + 1e-9)
    w.off()
  })
})

describe('泛音弓距离衰减：武器级 falloff（§4.4 独特属性）', () => {
  it('表上的档位原样上弹体：发射方照抄 weapon.falloff，不写在招式上', () => {
    const w = makeWorld()
    chargeShot(w)
    const shots = collect(w)
    expect(shots.length).toBeGreaterThan(0)
    for (const p of shots) expect(p.falloff).toEqual(w.weapon.falloff)
    expect(w.weapon.falloff).toEqual([{ beyond: 20, mul: 0.85 }, { beyond: 40, mul: 0.6 }])
    w.off()
  })

  it('按 traveled 逐档查：20m 内不衰减、>20m ×0.85、>40m ×0.6', () => {
    const w = makeWorld()
    w.combat.rng.float = () => 0.5 // 方差归零，只量衰减那一档
    const falloff = w.weapon.falloff!
    const shoot = (traveled: number): number => {
      const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -3 }, `f${traveled}`)
      const pr = w.combat.projectiles.spawn({
        hostile: false, ownerId: 'player', kind: 'arrow', origin: { x: 0, y: 1.2, z: 0 },
        dir: { x: 0, y: 0, z: -1 }, speed: 60, range: 45, radius: 0.4,
        damage: 100, poise: 0, hitStopMs: 0, falloff
      }, w.time.tick)
      for (let t = 0; t < 8; t++) {
        pr.traveled = traveled // 飞行中钉住"已经飞了多远"
        w.tick(1, false)
        const hit = w.hits.find((h) => h.victimId === e.id)
        if (hit) return hit.damage
      }
      throw new Error(`traveled=${traveled} 没打中`)
    }
    const near = shoot(15)
    const mid = shoot(25)
    const far = shoot(45)
    expect(near, '20m 内一档都不越').toBe(expectedHit(w, 100))
    expect(mid).toBe(expectedHit(w, 100 * 0.85))
    expect(far).toBe(expectedHit(w, 100 * 0.6))
    expect(mid).toBeLessThan(near)
    expect(far).toBeLessThan(mid)
    w.off()
  })
})

describe('泛音弓主箭吸附：没锁定时在锥内挑最近的活敌（§4.4「主箭优先最近目标」）', () => {
  it('锥内（45°/2）有敌人 ⇒ 主箭转向它，而不是沿出手朝向直飞', () => {
    const w = makeWorld()
    const off15 = { x: Math.sin(15 * DEG) * 10, y: 0, z: Math.cos(15 * DEG) * 10 }
    w.ai.spawn('en_murkshell', off15, 'cone')
    chargeShot(w)
    const shots = collect(w)
    expect(yawOf(shots[1]), '主箭瞄的是锥内那个 15° 方向上的目标').toBeCloseTo(15 * DEG, 5)
    w.off()
  })

  it('锥外（40°）没人 ⇒ 不吸附，主箭照直飞', () => {
    const w = makeWorld()
    w.ai.spawn('en_murkshell', { x: Math.sin(40 * DEG) * 10, y: 0, z: Math.cos(40 * DEG) * 10 }, 'out')
    chargeShot(w)
    const shots = collect(w)
    expect(yawOf(shots[1]), '40° > 22.5° 半角 ⇒ 吸不过来').toBeCloseTo(0, 6)
    w.off()
  })

  it('超出射程的邻居不算数：箭飞不到的人不该被吸过来', () => {
    const w = makeWorld()
    w.ai.spawn('en_murkshell', { x: Math.sin(15 * DEG) * 44, y: 0, z: Math.cos(15 * DEG) * 44 }, 'toofar')
    chargeShot(w)
    const shots = collect(w)
    expect(yawOf(shots[1]), '44m < 45m 射程内 ⇒ 这一个仍然吸得到').toBeCloseTo(15 * DEG, 5)
    w.off()
  })
})

describe('KI-037 顺手销账：弹道伤害不再被武器强化倍率乘两次', () => {
  it('weaponDamageMul=1.5 时出海的那一发仍是帧表底数（18），不是 27', () => {
    const w = makeWorld()
    w.combat.rng.float = () => 0.5
    w.player.rpg.weaponDamageMul = 1.5
    chargeShot(w)
    const shots = collect(w)
    expect(shots[1].damage, 'mvMul 只由 strikeEnemy 乘，出海时不许先乘一遍').toBe(18)
    expect(shots[0].damage, '枝的折扣除外：它打折的是帧表底数').toBeCloseTo(10.8, 10)
    w.off()
  })

  it('同一发打中人：最终伤害 == 底数 × 1.5 × 属性标尺（一次，不是 1.5²）', () => {
    const w = makeWorld()
    w.combat.rng.float = () => 0.5
    w.player.rpg.weaponDamageMul = 1.5
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 8 }, 'mul')
    chargeShot(w)
    let dmg = 0
    for (let t = 0; t < 40 && !dmg; t++) {
      w.tick(1, false)
      dmg = w.hits.find((h) => h.victimId === e.id)?.damage ?? 0
    }
    expect(dmg, '18 × 1.5 × 标尺；双乘会变成 1.5² 的那一份').toBe(expectedHit(w, 18 * 1.5))
    expect(dmg).toBeLessThan(expectedHit(w, 18 * 1.5 * 1.5))
    w.off()
  })
})

describe('律具·音叉杖：敲击链 / 全周扩散环 / 共振弹（§4.5）', () => {
  it('L1 是锥形敲击（不是弹道），直接命中正前方 1.5m 的敌人', () => {
    const w = makeWorld('wp_tuningfork_staff')
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 1.5 }, 'l1')
    const before = e.stats.hp
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect(w.player.action?.key).toBe('l1')
    for (let t = 0; t < 20; t++) { w.tick(1, false); if (e.stats.hp < before) break }
    expect(e.stats.hp).toBeLessThan(before)
    expect(w.combat.projectiles.live, '敲击不发射弹体').toBe(0)
    w.off()
  })

  it('鸣和弦：以自身为圆心的全周环，一记同时命中环内多个目标（multi=8）', () => {
    const w = makeWorld('wp_tuningfork_staff')
    const ids = ['a', 'b', 'c'].map((k, i) => {
      const ang = (i * 2 * Math.PI) / 3
      return w.ai.spawn('en_murkshell', { x: Math.sin(ang) * 2.2, y: 0, z: Math.cos(ang) * 2.2 }, k).id
    })
    const before = new Map(ids.map((id) => [id, w.ai.enemies.find((e) => e.id === id)!.stats.hp]))
    tapHeavy(w)
    expect(w.player.action?.key).toBe('h')
    for (let t = 0; t < 24; t++) w.tick(1, false)
    const victims = w.hits.filter((h) => ids.includes(h.victimId)).map((h) => h.victimId)
    expect(new Set(victims).size, '三个方向各一个，同一记全吃到').toBe(3)
    for (const id of ids) {
      expect(w.ai.enemies.find((e) => e.id === id)!.stats.hp).toBeLessThan(before.get(id)!)
    }
    w.off()
  })

  it('环外的敌人不吃这一记：inner 0.3 / outer 3 是判据，不是文案', () => {
    const w = makeWorld('wp_tuningfork_staff')
    const far = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 6 }, 'far')
    const before = far.stats.hp
    tapHeavy(w)
    for (let t = 0; t < 24; t++) w.tick(1, false)
    expect(far.stats.hp).toBe(before)
    expect(w.hits.some((h) => h.victimId === far.id)).toBe(false)
    w.off()
  })

  it('共振弹：note 弹体 24m/s、32 伤害、射程 22m（比弓短，换来的是残响）', () => {
    const w = makeWorld('wp_tuningfork_staff')
    chargeShot(w)
    expect(w.player.action?.key).toBe('charged')
    const shots = collect(w)
    expect(shots).toHaveLength(1)
    expect(shots[0].kind).toBe('note')
    expect(shots[0].damage).toBe(32)
    expect(shots[0].rangeLeft).toBeGreaterThan(0)
    expect(w.weapon.falloff, '杖不吃弓的距离衰减（falloff 是武器级，杖没写）').toBeUndefined()
    w.off()
  })

  it('杖没有跳跃/跑动动作：输入层回退，不凭空造一式', () => {
    const w = makeWorld('wp_tuningfork_staff')
    w.player.grounded = false
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect(w.player.action?.key, '没有 jump ⇒ 回落到 l1').toBe('l1')
    w.off()
  })
})
