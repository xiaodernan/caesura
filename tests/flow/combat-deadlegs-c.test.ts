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

/**
 * 批22c：CombatManager 击杀收尾组 + 挪后 4 条的死分支腿点亮（KI 死腿清扫第三批）。
 * 夹具与批22a/22b 同构，另回传 input（拍点闪避用例要单走 player.update 再 combat.update，
 * 绕开 ai.update 对手造攻击位的清理）。每条用例点名它负责的行；门禁由
 * .scratch/check_b22c.mjs 按行级腿数验亮（v8 分支 id 跨运行会漂移，不按 tag 匹配）。
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
  combat.floorAt = () => 0

  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const notes: string[] = []
  const hits: Array<{ attackerId: string; victimId?: string; result: string; shakeKey?: string; damage?: number }> = []
  const vfx: Array<{ key: string; scale?: number }> = []
  const died: Array<{ id: string }> = []
  const bossPhaseEv: Array<{ id: string; phase: number; phases: number }> = []
  bus.on('ui.notify', (p) => notes.push((p as { text: string }).text))
  bus.on('combat.hit', (p) => hits.push(p as never))
  bus.on('vfx.request', (p) => vfx.push(p as never))
  bus.on('entity.died', (p) => died.push(p as never))
  bus.on('boss.phase', (p) => bossPhaseEv.push(p as never))

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
  return { time, rhythm, player, ai, combat, frame, input, tick, notes, hits, vfx, died, bossPhaseEv }
}

type World = ReturnType<typeof makeWorld>

/** 近战用例必备：把玩家朝向 -z 的目标（默认 yaw=0 朝 +z 会挥空） */
function faceTo(w: World, z = -1.4): void {
  const a = Math.atan2(0 - w.player.pos.x, z - w.player.pos.z)
  w.player.yaw = a
  w.player.camYawRef = Math.PI + a
}

/** 手造一张 SkillCast：全零开销，damage/freezeTicks 由用例点名 */
function castOf(damage: number, freezeTicks = 0) {
  return {
    id: 'sk_dl22c', level: 1, cooldownTicks: 0, staminaCost: 0,
    overdriveCost: 0, damage, trueDamage: 0, fissureLayers: 0, muteTicks: 0,
    distance: 0, landingPoise: 0, landingPoiseTicks: 0, freezeTicks,
    overdriveRamp: 0, echoCharges: 0, parryWindowMul: 1, silenceTicks: 0,
    silenceDmgBonus: 0, scaling: {}, overdriveLayerMul: 0
  }
}

/** 手造带 beatGhost 的读条幽灵：attack 位直写（inStartup getter 读它，状态机不参与） */
function mkGhost(w: World, id: string, z: number, hitbox: unknown) {
  const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z }, id)
  e.enter('idle')
  const d = e.data as unknown as Record<string, unknown>
  e.data = { ...e.data, ai: { ...(d.ai as Record<string, unknown>), beatGhost: { dodgeRevealTicks: 60, dodgeStunTicks: 60 } } } as unknown as typeof e.data
  e.attack = { tick: 0, hitDone: false, spec: { frames: { startup: 999, hitbox } } } as unknown as typeof e.attack
  e.intangible = true
  return e
}

/** 拍点闪避那一拍：只走 player.update（翻滚起手）+ combat.update，跳过 ai.update */
function dodgeStep(w: World): void {
  w.frame.edges.add('dodge')
  w.time.tick++
  w.player.update(TICK_DT, w.time, w.input, w.time.tick, w.rhythm)
  expect(w.player.roll, '翻滚没起来：本用例前提失效').toBeTruthy()
  w.combat.update(w.time.tick, w.input)
}

describe('批22c CombatManager 击杀收尾组死腿（每条用例点名它负责的行）', () => {
  it('L305 战技命中场地件：kind 三元的 skill 腿亮（heavyFamily=true，rawDamage 取 cast.damage）', () => {
    const w = makeWorld()
    faceTo(w)
    const billed: Array<{ id: string; heavyFamily: boolean; rawDamage: number }> = []
    ;(w.combat as unknown as { props: unknown }).props = {
      all: [{ id: 'prop_dl305', pos: { x: 0, y: 0, z: -1.2 } }],
      hittable: () => true,
      hitTarget: (p: { pos: { x: number; y: number; z: number } }) => ({
        pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, radius: 0.5, height: 1.4
      }),
      hitProp: (p: { id: string }, info: { heavyFamily: boolean; rawDamage: number }) =>
        billed.push({ id: p.id, heavyFamily: info.heavyFamily, rawDamage: info.rawDamage })
    }
    const ms = structuredClone(registry.get<MovesetData>('ms_sword'))
    const f = { ...structuredClone(ms.actions.l1), activeStart: 0, activeEnd: 40 }
    w.player.setSkills({ sk_dl305: { f, cast: castOf(8) } })
    expect(w.player.tryStartAction('sk_dl305', w.time.tick), '战技出手失败：本用例前提失效').toBe(true)
    w.tick(6)
    expect(billed.length, '战技那记要真打到场地件').toBeGreaterThanOrEqual(1)
    expect(billed[0]!.heavyFamily, 'skill 档不是 light ⇒ heavyFamily=true').toBe(true)
    expect(billed[0]!.rawDamage, 'rawDamage 走 cast.damage 经 skillDmg 乘点').toBe(8)
  })

  it('L380 休止斩：冻结循环遇尸体走 continue（报数只算活人，尸体不冻）', () => {
    const w = makeWorld()
    const live = w.ai.spawn('en_murkshell', { x: 6, y: 0, z: -14 }, 'dl380_live')
    live.enter('idle')
    const corpse = w.ai.spawn('en_murkshell', { x: -6, y: 0, z: -14 }, 'dl380_dead')
    corpse.enter('idle')
    corpse.stats.damage(99999) // 走死亡链：alive=false，尸体留场（3s 后 AI 才回收）
    const ms = structuredClone(registry.get<MovesetData>('ms_sword'))
    const f = { ...structuredClone(ms.actions.l1), activeStart: 0, activeEnd: 40 }
    w.player.setSkills({ sk_dl380: { f, cast: castOf(0, 30) } })
    expect(w.player.tryStartAction('sk_dl380', w.time.tick), '休止斩出手失败：本用例前提失效').toBe(true)
    w.tick(3)
    expect(live.frozenTicks, '活人被按住（30 tick 减去后续衰减）').toBeGreaterThanOrEqual(25)
    expect(corpse.frozenTicks, '尸体不从这一过（L380 continue）').toBe(0)
    expect(w.notes.some((t) => t.includes('休止｜1 个声音')), '报数只算活的那一个').toBe(true)
  })

  it('L966/L967 拍点闪避：hitbox 缺席走 L966 continue；ring hitbox 走 outer 腿', () => {
    const w = makeWorld()
    const blind = mkGhost(w, 'dl966', -2.5, undefined)
    const ring = mkGhost(w, 'dl967', -2.5, { shape: 'ring', outer: 4 })
    dodgeStep(w)
    expect(ring.stunTicks, 'ring 那只要被定身（outer 腿，reach=4 ≥ 2.5）').toBeGreaterThanOrEqual(60)
    expect(blind.stunTicks, '没 hitbox 的那只走 L966 continue，不定身').toBe(0)
    expect(w.notes.some((t) => t.includes('拍点闪避')), '确认播报真的发了').toBe(true)
  })

  it('L967 拍点闪避 reach 三元的兜底腿：非 ring 非 cone 走 offsetFwd + radius', () => {
    const w = makeWorld()
    const e = mkGhost(w, 'dl967c', -3, { shape: 'sphere', offsetFwd: 1.5, radius: 2 })
    dodgeStep(w)
    expect(e.stunTicks, '兜底腿也够得着：reach=1.5+2=3.5 ≥ 3，定身成立').toBeGreaterThanOrEqual(60)
  })

  it('L915/L916 敌近战：attack 缺席时 parryable??true 与 sourceAction??undefined 双兜底', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.2 }, 'dl915')
    e.enter('idle')
    // activeHitbox 是每拍从攻击态派生的 getter：自有属性盖住它，攻击位 attack 保持 null
    Object.defineProperty(e, 'activeHitbox', {
      value: { box: { shape: 'sphere', offsetFwd: 0, offsetY: 1, radius: 3 }, yaw: 0, damage: 5, poise: 3, hitStopMs: 0, shake: 'normal', flags: [], loudness: 3, reaction: null },
      configurable: true
    })
    w.tick()
    const h = w.hits.find((x) => x.victimId === 'player')
    expect(h, '这一记要真落到玩家身上').toBeTruthy()
    expect(w.player.stats.hp, 'attack 为 null 也要照常结账（?? 腿被求值）').toBeLessThan(w.player.stats.hpMax)
  })

  it('L1065 非 BOSS 也报跳阶：phases 读 data.boss?.phases.length ?? 1 的兜底腿', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -8 }, 'dl1065')
    e.enter('idle')
    e.phaseRoarPending = true // advanceTo 的那一嗓子：真 boss 才会置位，这里手造
    w.tick()
    expect(w.bossPhaseEv.length, 'boss.phase 要发一次').toBe(1)
    expect(w.bossPhaseEv[0]!.phases, 'data.boss 缺席 ⇒ phases 兜底 1').toBe(1)
    expect(w.bossPhaseEv[0]!.phase, 'bossPhase 从 0 起跳 ⇒ 事件 phase 1').toBe(1)
  })

  it('L1077 立钟残响：敲过钟的喧堕者站进残响区，新拍掉血致死走 onEnemyKilled', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'dl1077')
    e.enter('idle')
    e.data = {
      ...e.data,
      boss: { phases: [{}], bells: { positions: [{ x: 0, y: 0, z: -6 }], hitRadius: 1, releaseTicks: 10, breaksAt: 3, resonanceRadius: 4, damagePerBeat: 9999 } }
    } as unknown as typeof e.data
    e.bellsRung = [true] // 第一口钟已经响过（Enemy 响钟时置位）
    w.tick()
    expect(e.alive, '残响伤害要把它打死').toBe(false)
    expect(w.died.some((x) => x.id === e.id), '死在残响里也要走 onEnemyKilled（L1077 那条）').toBe(true)
  })

  it('L1244 已死的玩家吃弹：takeDamage 返回 false ⇒ 结算走 none，血量分毫不动', () => {
    const w = makeWorld()
    const shooter = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -8 }, 'dl1244')
    shooter.enter('idle')
    ;(w.player as unknown as { dead: boolean }).dead = true // 私有位：死了就是断了（240 tick 才自动复活，这里只活 1 拍）
    w.combat.projectiles.spawn({
      hostile: true, ownerId: shooter.id, kind: 'note',
      origin: { x: 0, y: 1.1, z: -0.8 }, dir: { x: 0, y: 0, z: 0 },
      speed: 13, range: 20, radius: 0.45, damage: 12, poise: 6, hitStopMs: 70
    }, w.time.tick)
    w.tick()
    expect(w.player.stats.hp, '死了就是断了：不再扣血').toBe(w.player.stats.hpMax)
    expect(w.combat.projectiles.live, '弹体照常被结算掉（none 不免除弹体的账）').toBe(0)
    expect(w.hits.find((x) => x.victimId === 'player'), 'none 出口不发 combat.hit').toBeUndefined()
  })

  it('L1296 震裂满层碎裂致死：fissureBurst 的真伤收走残血目标（onEnemyKilled 记账）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.4 }, 'dl1296')
    e.enter('idle')
    faceTo(w)
    w.player.equip(registry.get<WeaponData>('wp_drawpin_spear'), registry.get<MovesetData>('ms_spear'))
    e.stats.damage(e.stats.hp - 1) // 残血：碎裂真伤 20 起步必致死
    e.stats.fissureLayers = 99 // 高于上限：下一记带层的命中必爆
    expect(w.player.tryStartAction('jump', w.time.tick), 'jump 出手失败：本用例前提失效').toBe(true)
    w.tick(40)
    expect(e.alive, '碎裂真伤要收走最后一格血').toBe(false)
    expect(w.notes.some((t) => t.includes('震裂碎裂')), '满层碎裂的播报要发').toBe(true)
    expect(w.died.some((x) => x.id === e.id), '碎裂致死也要走 onEnemyKilled（L1296 那条）').toBe(true)
  })

  it('L1317/L1526 击杀记账：body 缺席 scale 落 1，名单外的 nameKey 原样上报', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.4 }, 'dl1317')
    e.enter('idle')
    faceTo(w)
    w.player.equip(registry.get<WeaponData>('wp_drawpin_spear'), registry.get<MovesetData>('ms_spear'))
    e.data = { ...e.data } as unknown as typeof e.data // 先浅拷贝：注册表里的原型数据不许被污染
    const d = e.data as unknown as Record<string, unknown>
    d.body = undefined
    d.nameKey = 'enemy.unknown_test'
    e.stats.damage(e.stats.hp - 1) // 残血，跳的这记点杀
    expect(w.player.tryStartAction('jump', w.time.tick), 'jump 出手失败：本用例前提失效').toBe(true)
    w.tick(40)
    expect(e.alive, '点杀要成立').toBe(false)
    expect(w.vfx.some((v) => v.key === 'death_shatter' && v.scale === 1), 'body 缺席 ⇒ death_shatter scale 兜底 1').toBe(true)
    expect(w.notes.some((t) => t.includes('enemy.unknown_test')), '名单外 nameKey 原样上报（nameOf ?? key）').toBe(true)
  })

  it('L1368 busy 早退：硬直中按处决不作数（对照组：不 busy 同一候选照样处决）', () => {
    const busyW = makeWorld()
    const be = busyW.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.4 }, 'dl1368')
    be.enter('idle')
    be.stats.crumpleTicksLeft = 50 // 破势候选：kind A 的距离内（1.4 ≤ 2.2）
    busyW.player.stunTicks = 10 // busy getter 的最短扳手：硬直中
    busyW.frame.edges.add('interact')
    busyW.tick()
    expect(be.stats.hp, 'busy 中不处决：血不动').toBe(be.stats.hpMax)
    expect(busyW.hits.find((h) => h.shakeKey === 'execute'), '没有处决那一记').toBeUndefined()

    const okW = makeWorld()
    const oe = okW.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.4 }, 'dl1368b')
    oe.enter('idle')
    oe.stats.crumpleTicksLeft = 50
    okW.frame.edges.add('interact')
    okW.tick()
    expect(okW.hits.some((h) => h.shakeKey === 'execute'), '对照组：同一候选直接处决成立').toBe(true)
  })

  it('L1411 过载处决 BOSS：flat 走 isBoss 的 0 腿（伤害=hpMax*bossFracs[0]*execMul）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.4 }, 'dl1411')
    e.enter('idle')
    e.data = { ...e.data, archetype: 'boss' } as unknown as typeof e.data
    e.stunTicks = 30 // stalled：kind C 的候选前提
    w.player.stats.overdrive = 100 // ≥ overdriveCost 8
    w.frame.edges.add('interact')
    w.tick()
    const ex = w.player.base.execution
    const hit = w.hits.find((h) => h.shakeKey === 'execute')
    expect(hit, 'kind C 处决要落地').toBeTruthy()
    expect(hit!.damage, 'isBoss ⇒ flat=0：伤害只有 frac 那一半').toBe(Math.round(e.stats.hpMax * ex.bossFracs[0]! * w.player.rpg.execMul))
    expect(w.player.stats.overdrive, '过载扣 overdriveCost').toBe(100 - ex.overdriveCost)
    expect(w.notes.some((t) => t.includes('休止处决')), 'kind C 的播报').toBe(true)
  })

  it('L1479 未锁定平射：charged 弹谱缺 gravity ⇒ aimFlat 的 ??0 兜底（L686 else 腿同场）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -8 }, 'dl1479')
    e.enter('idle')
    faceTo(w) // aimFlat 沿 p.yaw 出手：yaw=0 朝 +z 会把这一投甩向背后
    const clone = structuredClone(registry.get<MovesetData>('ms_spear'))
    const p = clone.actions.charged.projectile as unknown as Record<string, unknown>
    p.gravity = undefined
    w.player.equip(registry.get<WeaponData>('wp_drawpin_spear'), clone)
    w.frame.held.add('attackHeavy')
    w.tick(60)
    w.frame.held.delete('attackHeavy')
    w.tick(2)
    for (let t = 0; t < 60 && w.combat.projectiles.live === 0; t++) w.tick()
    expect(w.combat.projectiles.live, '出手帧要发射弹体').toBeGreaterThanOrEqual(1)
    for (let t = 0; t < 160 && !w.hits.some((h) => h.attackerId === 'player'); t++) w.tick()
    expect(w.hits.some((h) => h.attackerId === 'player'), '平射弹道要真打得着 8m 外的目标').toBe(true)
  })
})
