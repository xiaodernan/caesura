import { describe, expect, it } from 'vitest'
import { bus, type StatusPulse } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, statuses, regions, progression } from '@/data'
import type { EnemyData, MovesetData, RegionData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { glossary } from '@/combat/Statuses'
import type { Enemy } from '@/ai/Enemy'
import type { Vec3 } from '@/combat/EntityStats'
import { defaultMods, RpgRuntime } from '@/rpg/Runtime'

/**
 * 状态系统的**行为**验收（combat.md §11；需求 §59 自动化 gameplay flow）。
 * 全部走真通道：伤害只从 `strikeEnemy` 进（这里用玩家近战与玩家弹体两种入口），
 * 计时只靠 tickFrame 手动步进。数值断言写成「基线 × 数据系数」而不是抄常量，
 * 所以改了 statuses.json 这些用例会跟着动——那正是我们要的耦合。
 */

registerGameData()

interface Hit { attackerId: string; victimId: string; damage: number; kind: string; result: string }

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>('ms_sword'))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const hits: Hit[] = []
  const pulses: StatusPulse[] = []
  const notes: string[] = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push(p as unknown as Hit)),
    bus.on('ui.status', (p) => pulses.push(p)),
    bus.on('ui.notify', (p) => notes.push(p.text))
  ]
  const upkeep: Array<{ e: Enemy; pos: Vec3 }> = []
  /** 把敌人钉在原地并回满血：让「谁被打了几下、有没有被打死」不污染本文件的数值断言 */
  function pin(e: Enemy): Enemy { upkeep.push({ e, pos: { ...e.pos } }); return e }

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
      for (const { e, pos } of upkeep) {
        if (!e.alive) continue
        e.stats.hp = e.stats.hpMax
        e.stats.dead = false
        e.pos.x = pos.x; e.pos.y = pos.y; e.pos.z = pos.z
      }
    }
  }
  const off = (): void => offs.forEach((f) => f())
  return { time, rhythm, player, ai, combat, frame, tick, hits, pulses, notes, pin, off }
}

/** 一记玩家弹体：走 projectileStrikesEnemy ⇒ strikeEnemy，layers 由调用方钉死 */
function shoot(w: ReturnType<typeof makeWorld>, at: Enemy, damage: number, layers = 0): void {
  w.combat.projectiles.spawn({
    hostile: false, ownerId: 'player', kind: 'spear',
    origin: { x: at.pos.x, y: at.pos.y + 1.1, z: at.pos.z + 2 }, dir: { x: 0, y: 0, z: -1 },
    speed: 60, range: 20, radius: 1.2, damage, poise: 0, hitStopMs: 0, layers, onBeat: false
  }, w.time.tick)
}

/**
 * 同一颗种子、同一套动作 ⇒ 两次运行的随机数序列逐位相同，才能做「基线 vs 加成」对照。
 * 读 `combat.hit` 上的最终伤害而不是血量差：血差会被"打死"截断（嘈壳只有 45 血）。
 */
function shotDamage(id: string, preLayers: number, hitLayers: number): { dmg: number; layers: number } {
  const w = makeWorld()
  const e = w.ai.spawn(id, { x: 0, y: 0, z: -30 }, 'ctl')
  for (let i = 0; i < preLayers; i++) e.stats.addFissure(1)
  const hp0 = e.stats.hp
  shoot(w, e, 40, hitLayers)
  for (let t = 0; t < 20 && e.stats.hp === hp0; t++) w.tick()
  const hit = w.hits.find((h) => h.attackerId === 'player' && h.victimId === e.id)
  const out = { dmg: hit?.damage ?? 0, layers: e.stats.fissureLayers }
  w.off()
  return out
}

function faceAt(w: ReturnType<typeof makeWorld>, p: Vec3): void {
  w.player.yaw = Math.atan2(p.x - w.player.pos.x, p.z - w.player.pos.z)
  w.player.camYawRef = Math.PI + w.player.yaw
}

/** 反复重按重击（点按＝'h'，它才是 §11 的「玩家重击命中挂影」那一格），直到这一记真的落在 target 身上 */
function landHeavy(w: ReturnType<typeof makeWorld>, target: Enemy): Hit | undefined {
  const landed = (): Hit | undefined =>
    w.hits.find((h) => h.attackerId === 'player' && h.victimId === target.id && h.kind === 'heavy')
  for (let attempt = 0; attempt < 6 && !landed(); attempt++) {
    w.player.stats.stamina = w.player.stats.staMax
    w.player.stats.hp = w.player.stats.hpMax
    faceAt(w, target.pos)
    w.frame.held.add('attackHeavy')
    w.tick(3)
    w.frame.held.delete('attackHeavy')
    w.tick(100)
  }
  return landed()
}

/** 以最快节奏反复点按重击（一落下硬直就接下一记），每 tick 结束回调一次 */
function mashHeavy(w: ReturnType<typeof makeWorld>, ticks: number, onEach?: () => void): void {
  let press = 0
  for (let t = 0; t < ticks; t++) {
    if (!w.player.action && !w.player.busy && w.player.stats.stamina >= 30) {
      if (press === 0) { w.frame.held.add('attackHeavy'); press = 3 }
      else if (--press === 0) w.frame.held.delete('attackHeavy')
    }
    w.player.stats.stamina = w.player.stats.staMax
    w.player.stats.hp = w.player.stats.hpMax
    w.tick()
    onEach?.()
  }
}

describe('§11 震裂：承伤、材质、碎裂', () => {
  it('每层 +4% 承伤，且这一击自己叠的那层要留给下一击', () => {
    const base = shotDamage('en_tympanus', 0, 0)
    expect(base.dmg, '无裂纹时不该有任何放大').toBeGreaterThan(0)
    const two = shotDamage('en_tympanus', 2, 0)
    expect(two.dmg).toBe(Math.round(base.dmg * (1 + 2 * statuses.fissure.dmgMulPerLayer)))
    const hit = shotDamage('en_tympanus', 0, 1)
    expect(hit.dmg, '叠层发生在结算之后：同一刀不能自我放大').toBe(base.dmg)
    expect(hit.layers, '层数留在身上').toBe(1)
  })

  it('铸出来的东西最怕同频敲击：材质倍率直接乘在每层加成上', () => {
    const per = statuses.fissure.dmgMulPerLayer
    const crystal = registry.get<EnemyData>('en_murkshell').fissureMul ?? 1
    const plain = registry.get<EnemyData>('en_tympanus').fissureMul ?? 1
    expect(crystal, '前提：嘈壳是晶体材质，普通怪不是').toBeGreaterThan(plain)
    const shell0 = shotDamage('en_murkshell', 0, 0)
    const shell2 = shotDamage('en_murkshell', 2, 0)
    const plain0 = shotDamage('en_tympanus', 0, 0)
    const plain2 = shotDamage('en_tympanus', 2, 0)
    expect(shell2.dmg, '晶体：两层 × 每层系数 × 材质倍率').toBe(Math.round(shell0.dmg * (1 + 2 * per * crystal)))
    expect(plain2.dmg, '普通材质：同一公式，只是倍率为 1').toBe(Math.round(plain0.dmg * (1 + 2 * per * plain)))
    expect(shell2.dmg / shell0.dmg, '同样两层裂纹，打在铸出来的壳上更疼')
      .toBeGreaterThan(plain2.dmg / plain0.dmg)
  })

  it('满 5 层当场碎裂：20 真伤 + 架势 40、层数归零，并且只此一次', () => {
    // 对照组：同样带着 4 层挨一记，但不越满层 ⇒ 差值就是碎裂那一份
    const control = shotDamage('en_tympanus', 4, 0)
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -30 }, 'burst')
    for (let i = 0; i < 4; i++) e.stats.addFissure(1)
    const hp0 = e.stats.hp
    shoot(w, e, 40, 1)
    for (let t = 0; t < 20 && e.stats.hp === hp0; t++) w.tick()
    expect(hp0 - e.stats.hp, '真伤不吃 DR，独立于这一击本身').toBe(control.dmg + statuses.fissure.burst.trueDamage)
    expect(e.stats.poiseAccum, '架势走独立通道').toBe(statuses.fissure.burst.poise)
    expect(e.stats.fissureLayers, '碎裂即清层').toBe(0)
    expect(w.notes.some((n) => n.includes('碎裂'))).toBe(true)
    const after = e.stats.hp
    for (let t = 0; t < 240; t++) w.tick()
    expect(e.stats.hp, '没有裂纹了就不要再每 tick 掉真伤').toBe(after)
    w.off()
  })

  it('异音（fis）属性放大异常强度：承伤、碎裂、回响三条一起吃这个乘数', () => {
    const w = makeWorld()
    w.player.rpg = { ...defaultMods(), statusPowerMul: 2 }
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -30 }, 'fis')
    for (let i = 0; i < 4; i++) e.stats.addFissure(1)
    const hp0 = e.stats.hp
    shoot(w, e, 40, 1)
    for (let t = 0; t < 20 && e.stats.hp === hp0; t++) w.tick()
    const d = hp0 - e.stats.hp
    const plain = shotDamage('en_tympanus', 4, 1)
    expect(d, '每层 8% + 碎裂 40').toBeGreaterThan(plain.dmg)
    w.off()
  })
})

describe('§11 回响：那一音被世界再播一遍', () => {
  it('重击命中挂一影，delayTicks 后按 replayMul 在同位置重演', () => {
    const w = makeWorld()
    const e = w.pin(w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -2.6 }, 'echo'))
    const first = landHeavy(w, e)
    expect(first, '重击没打上，后面的断言无意义').toBeTruthy()
    expect(w.combat.echoesLive, '§11：重击命中挂"回声影"').toBe(1)
    const due = w.time.tick + statuses.echo.delayTicks
    while (w.time.tick < due) w.tick(1)
    expect(w.combat.echoesLive, '重演完就销账').toBe(0)
    const replay = w.hits.filter((h) => h.attackerId === 'player' && h.kind === 'skill')
    expect(replay.length, '对群：同一次重演只结算一次').toBe(1)
    expect(replay[0].damage).toBeCloseTo(first!.damage * statuses.echo.replayMul, 6)
    w.off()
  })

  it('回声不挑对手只挑位置：半径内的都挨一下，半径外的没有', () => {
    const w = makeWorld()
    const near = w.pin(w.ai.spawn('en_tympanus', { x: 1.4, y: 0, z: -3.0 }, 'n'))
    const far = w.pin(w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -14 }, 'f'))
    const first = landHeavy(w, near)
    expect(first).toBeTruthy()
    const victims = new Set<string>()
    for (let t = 0; t < statuses.echo.delayTicks + 6; t++) {
      w.tick()
      for (const h of w.hits) if (h.kind === 'skill' && h.attackerId === 'player') victims.add(h.victimId)
    }
    expect(victims.has(near.id), '重演打在半径内的目标身上').toBe(true)
    expect(victims.has(far.id), '14m 外的杂兵不在「同一位置」').toBe(false)
    w.off()
  })

  it('重演不再叠层、不再暴击、不吃 hitstop、不推连段（它不是新的一击）', () => {
    const w = makeWorld()
    const e = w.pin(w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -2.6 }, 'pure'))
    const first = landHeavy(w, e)
    const layers = e.stats.fissureLayers
    for (let t = 0; t < statuses.echo.delayTicks + 4; t++) w.tick()
    const replay = w.hits.filter((h) => h.kind === 'skill' && h.attackerId === 'player')
    expect(replay.length).toBeGreaterThan(0)
    expect(e.stats.fissureLayers, '回响自己不再叠震裂').toBe(layers)
    expect(replay.every((h) => h.damage === Math.round(first!.damage * statuses.echo.replayMul) ||
      h.damage === first!.damage * statuses.echo.replayMul)).toBe(true)
    w.off()
  })

  it('场上最多 maxShadows 个影（性能锁）：真实帧数据下攒得到 2 个，且不会超过', () => {
    const w = makeWorld()
    const e = w.pin(w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -2.6 }, 'lock'))
    faceAt(w, e.pos)
    let peak = 0
    mashHeavy(w, 600, () => { peak = Math.max(peak, w.combat.echoesLive) })
    expect(peak, '两次重击之间影还没重演完 ⇒ 攒出过 2 个，否则这条断言是空的').toBe(statuses.echo.maxShadows)
    for (let t = 0; t < 200; t++) w.tick()
    expect(w.combat.echoesLive, '没有影会永久挂着').toBe(0)
    w.off()
  })

  it('超预算的第三影直接丢掉：锁是硬上限，不是排队（把延迟拉长到能撞见它）', () => {
    const c = statuses.echo
    const original = c.delayTicks
    // 诚实说明：真实帧数据下两次重击的最小间隔(≈67 tick) < delayTicks(90)，丢弃分支跑不到。
    // 这里把延迟拉长到「三次重击都还在排队」，只为证明那道上限真的在拦东西。
    c.delayTicks = 10_000
    let hits = 0
    try {
      const w = makeWorld()
      const e = w.pin(w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -2.6 }, 'drop'))
      faceAt(w, e.pos)
      mashHeavy(w, 500, () => { hits = w.hits.filter((h) => h.kind === 'heavy' && h.attackerId === 'player').length })
      expect(hits, '前提：这 500 tick 里至少打实了三记重击').toBeGreaterThanOrEqual(3)
      expect(w.combat.echoesLive, '排到 maxShadows 就停，不再往里塞').toBe(c.maxShadows)
      w.off()
    } finally {
      c.delayTicks = original
    }
  })
})

describe('§11 闷音：体力回复 −30%', () => {
  const recover = (muted: boolean): number => {
    const w = makeWorld()
    w.player.stats.stamina = 10
    if (muted) w.player.stats.muteTicksLeft = 10_000
    for (let t = 0; t < 60; t++) w.tick()
    const got = w.player.stats.stamina - 10
    w.off()
    return got
  }

  it('挂着闷音时回复被砍到 0.7 倍，且到点自己解除', () => {
    const clean = recover(false)
    expect(clean).toBeGreaterThan(0)
    expect(recover(true)).toBeCloseTo(clean * statuses.mute.regenMul, 1)
    const w = makeWorld()
    w.player.stats.muteTicksLeft = 10
    w.tick(10)
    expect(w.player.stats.muteTicksLeft, '它是会自己到期的量').toBe(0)
    w.off()
  })

  it('闷音由攻击方声明时长：带 muteTicks 的弹体命中才挂得上', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -30 }, 'm')
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: e.pos.x, y: e.pos.y + 1.1, z: e.pos.z + 2 }, dir: { x: 0, y: 0, z: -1 },
      speed: 60, range: 20, radius: 1.2, damage: 5, poise: 0, hitStopMs: 0, muteTicks: 120
    }, w.time.tick)
    for (let t = 0; t < 10 && e.stats.muteTicksLeft === 0; t++) w.tick()
    expect(e.stats.muteTicksLeft).toBe(120)
    expect(e.stats.muteRegenMul).toBeCloseTo(statuses.mute.regenMul, 10)
    w.off()
  })
})

describe('§11 失谐（褪色值）：区域压力机制，不是惩罚', () => {
  const deep = regions.find((r) => r.id === 'rg_earless_deeps') as RegionData

  it('被喧堕精英命中 +eliteHit；杂兵的一击不在身上写东西', () => {
    const once = (owner: string): number => {
      const w = makeWorld()
      const e = w.ai.spawn(owner, { x: 0, y: 0, z: -60 }, 'elite')
      w.combat.projectiles.spawn({
        hostile: true, ownerId: e.id, kind: 'note',
        origin: { x: 0, y: 1.1, z: -3 }, dir: { x: 0, y: 0, z: 1 },
        speed: 60, range: 10, radius: 1, damage: 5, poise: 0, hitStopMs: 0
      }, w.time.tick)
      for (let t = 0; t < 10 && w.player.corruption.value === 0; t++) w.tick()
      const v = w.player.corruption.value
      w.off()
      return v
    }
    expect(once('en_hanged_knight'), '精英＝archetype 数据，不是名字').toBe(statuses.corruption.eliteHit)
    expect(once('en_murkshell'), '杂兵不给失谐').toBe(0)
  })

  it('深窖里站着不动就在褪色；失谐属性只让它变慢，不能关掉它', () => {
    const w = makeWorld()
    const per = deep.corruption!.perSec
    for (let t = 0; t < 60; t++) { w.tick(); w.player.corruption.expose(TICK_DT, per) }
    expect(w.player.corruption.value, '1 秒 × perSec').toBeCloseTo(per, 4)

    // 把「异音」堆到超出任何合理 build，看耐受会不会把这条区域机制直接关掉
    const rpg = new RpgRuntime()
    rpg.prog.attrs.fis = 99
    const mods = rpg.mods()
    w.player.applyRpg(mods)
    expect(w.player.corruption.resistMul, '耐受由属性点派生，不是代码里的常数').toBeLessThan(1)
    const before = w.player.corruption.value
    for (let t = 0; t < 60; t++) { w.tick(); w.player.corruption.expose(TICK_DT, per) }
    const gained = w.player.corruption.value - before
    expect(gained, '褪色确实变慢了').toBeLessThan(per)
    expect(gained / per, '但有地板：满点也只是慢，不是免疫（§11 它是区域机制）')
      .toBeGreaterThanOrEqual(progression.derived.status.toleranceFloor - 1e-9)
    w.off()
  })

  it('满值后出安全区持续掉血，掉的是「褪色」不是「被打」：不吃无敌帧、不给硬直', () => {
    const w = makeWorld()
    w.player.corruption.value = statuses.corruption.max
    const hp0 = w.player.stats.hp
    const dt = 1 / TICK_HZ
    // 把玩家摆在翻滚无敌帧里：takeDamage 会拒收，fadeDamage 不该理它（§11 这是世界在拿走声音，不是谁打你）
    w.player.roll = { tick: 5, dir: { x: 0, y: 0, z: 1 }, dist: w.player.base.roll.dist, total: 30, iframeStart: 1, iframeEnd: 20 }
    expect(w.player.iFrame, '前提：此刻确实处于无敌帧').toBe(true)
    expect(w.player.takeDamage(5, { x: 0, y: 0, z: 1 }), '同一时刻的一击被无敌帧吃掉').toBe(false)
    for (let t = 0; t < 60; t++) {
      // 走 tickEnvironment：这才是主循环真正调的那一条（区域格同时管着累积与掉血）
      const dmg = w.player.corruption.tickEnvironment(dt, deep.corruption)
      if (dmg > 0) w.player.fadeDamage(dmg)
    }
    expect(w.player.stats.hp).toBeLessThan(hp0)
    expect(w.player.stats.hp).toBeCloseTo(hp0 - statuses.corruption.hpPerSec, 1)
    // 闸门在区域那一格上：站在没有 corruption 格的区域里，满值也不该见血
    const hp1 = w.player.stats.hp
    for (let t = 0; t < 120; t++) {
      const dmg = w.player.corruption.tickEnvironment(dt, undefined)
      if (dmg > 0) w.player.fadeDamage(dmg)
    }
    expect(w.player.stats.hp, '安全区满值不掉血（实机复验在这里抓到过接线漏网）').toBe(hp1)
    w.off()
  })

  it('调音桩休息归零；音色晶按数据里的 use.corruption 刮掉一截', () => {
    const w = makeWorld()
    w.player.corruption.add(80)
    expect(w.player.corruption.value).toBe(80)
    const crystal = registry.get<{ use?: { corruption?: number } }>('it_timbre_crystal')
    w.player.corruption.purge(-(crystal.use?.corruption ?? 0))
    expect(w.player.corruption.value).toBe(80 + (crystal.use?.corruption ?? 0))
    w.player.corruption.add(20)
    w.player.rest()
    expect(w.player.corruption.value, '§11「调音桩归零」').toBe(0)
    expect(w.player.stats.hp).toBe(w.player.stats.hpMax)
    w.off()
  })

  it('读数随 player.stats 发布，HUD 不必自己去读 meter；>60 起才有去色量', () => {
    const w = makeWorld()
    const seen: Array<{ c: number; v: number }> = []
    const off = bus.on('player.stats', (s) => seen.push({ c: s.corruption, v: s.corruptionVeil }))
    w.player.corruption.value = statuses.corruption.visualStart
    w.tick(2)
    expect(seen.at(-1)!.v, '正好在阈值上＝还没开始褪色').toBe(0)
    w.player.corruption.value = statuses.corruption.max
    w.tick(2)
    expect(seen.at(-1)!.c).toBe(statuses.corruption.max)
    expect(seen.at(-1)!.v).toBe(1)
    off()
    w.off()
  })

  it('深窖的失谐速率写在区域数据里，不是一个硬编码常数', () => {
    expect(deep.corruption?.perSec, '§11 环境累积').toBeGreaterThan(0)
    expect(regions.filter((r) => r.corruption).map((r) => r.id), '目前只有哑带系区域有压力')
      .toEqual(['rg_earless_deeps'])
  })
})

describe('§11 状态读数：边沿量走 ui.status', () => {
  it('震裂 chip 随层数变化，碎裂归零时也发一次（不然 HUD 挂在满层下不来）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -30 }, 'chip')
    shoot(w, e, 1, 2)
    for (let t = 0; t < 20; t++) w.tick()
    expect(w.pulses.filter((p) => p.id === 'fissure').at(-1)).toMatchObject({ value: 2, max: statuses.fissure.maxLayers, on: true })
    // 再从真实通道补满第 5 层 ⇒ 碎裂清层，读数必须跟着撤下
    shoot(w, e, 1, statuses.fissure.maxLayers - 2)
    for (let t = 0; t < 20; t++) w.tick()
    expect(e.stats.fissureLayers, '前提：真的碎裂了').toBe(0)
    const last = w.pulses.filter((p) => p.id === 'fissure').at(-1)!
    expect(last, '满层碎裂后读数要撤下').toMatchObject({ value: 0, on: false })
    w.off()
  })

  it('每个状态本局第一次发生时播一句世界观解释（需求 §19），之后不再刷屏', () => {
    glossary.forgetAll() // 「本局」的台账是进程单例；这条用例要的是新开局的第一次
    const w = makeWorld()
    const e = w.pin(w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -2.6 }, 'gloss'))
    const glosses = (): number => w.notes.filter((n) => n.startsWith(`${statuses.echo.displayName}｜`)).length
    expect(landHeavy(w, e)).toBeTruthy()
    expect(glosses(), '挂上影的那一刻就该解释一次').toBe(1)
    for (let t = 0; t < statuses.echo.delayTicks + 4; t++) w.tick()
    expect(landHeavy(w, e)).toBeTruthy()
    for (let t = 0; t < statuses.echo.delayTicks + 4; t++) w.tick()
    expect(glosses(), '第二次就闭嘴：查表看说明是文档，不是玩法').toBe(1)
    w.off()
  })
})
