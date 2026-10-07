import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData, AttackSpec } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { Enemy, bindEnemyRegistry, newAttack } from '@/ai/Enemy'

/**
 * 批23：ai/Enemy.ts 死分支腿点亮（KI 死腿清扫）。
 * 与批22a/22b/22c 同一门禁：每条用例点名它负责的行号，
 * .scratch/check_b23.mjs 按行号逐一验亮（v8 分支 id 跨运行漂移，不按 tag 匹配）。
 * 本文件全程直调 e.update（不跑 ai.update），registry 注入态由用例自控。
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
  const notes: string[] = []
  const sfx: Array<{ key: string; gain?: number }> = []
  const sounds: Array<{ id: string; loudness: number }> = []
  bus.on('ui.notify', (p) => notes.push((p as { text: string }).text))
  bus.on('audio.sfx', (p) => sfx.push(p as { key: string; gain?: number }))
  bus.on('sound.source', (p) => sounds.push(p as { id: string; loudness: number }))
  const spawn = (id: string, x: number, z: number, seed: string): Enemy =>
    ai.spawn(id, { x, y: 0, z }, seed)
  const step = (e: Enemy, n = 1): void => {
    for (let i = 0; i < n; i++) e.update(TICK_DT, time.tick++, player, rhythm, () => false)
  }
  return { time, rhythm, player, ai, notes, sfx, sounds, spawn, step }
}

/** 临时改一个共享数据字段（registry 数据是全局对象），跑完 fn 恢复原值；原本没有的字段跑完删除 */
function withField(obj: object, key: string, value: unknown, fn: () => void): void {
  const rec = obj as Record<string, unknown>
  const had = key in rec
  const old = rec[key]
  rec[key] = value
  try { fn() } finally { if (had) rec[key] = old; else delete rec[key] }
}
function withoutField(obj: object, key: string, fn: () => void): void {
  const rec = obj as Record<string, unknown>
  const had = key in rec
  const old = rec[key]
  delete rec[key]
  try { fn() } finally { if (had) rec[key] = old }
}
const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z)

describe('批23 Enemy.ts 死腿（每条用例点名它负责的行）', () => {
  it('L195 callAlly 半径兜底：无配置的敌人也按 14m 接住呼援（显式 range 同证左腿）', () => {
    const w = makeWorld()
    const a = w.spawn('en_refrein', 0, -2, 'b23_195a')
    const b = w.spawn('en_murkshell', 0, -4, 'b23_195b')
    bus.emit('ai.callAlly', { fromId: 'b23_caller', pos: { x: 0, y: 0, z: -6 }, range: 5 })
    expect(a.state, 'refrein 无 callAlly 配置：?? 14 兜底必须接住 4m 内的呼援').toBe('alert')
    expect(a.alertness).toBe(100)
    expect(b.state, 'murkshell 显式 range 14：左腿照常').toBe('alert')
  })

  it('L235 fissureEffectMul：抬壳 boss 的 shell 缺 fissureMul → 该侧回落 1', () => {
    const w = makeWorld()
    const e = w.spawn('en_ostlara', 0, -5, 'b23_235')
    const shell = e.data.boss!.phases[0].shell!
    expect(e.fissureEffectMul, '表上 fissureMul 2 在：本体侧 × 壳侧').toBe((e.data.fissureMul ?? 1) * shell.fissureMul!)
    withoutField(shell, 'fissureMul', () => {
      expect(e.fissureEffectMul, 'shell 缺 fissureMul：壳侧必须回落 1').toBe(e.data.fissureMul ?? 1)
    })
  })

  it('L294/L308 弹道派生：burst 缺 at[] 用 everyTicks 排发；无 telegraph 不报赤线', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -2, 'b23_294')
    const bite = e.data.attacks.find((a) => a.id === 'bite')!
    withField(bite.frames, 'projectile', {
      speed: 10, range: 8, radius: 0.3,
      burst: { count: 2, everyTicks: 7 }
    } as unknown as AttackSpec['frames']['projectile'], () => {
      e.attack = newAttack(bite, bite.frames.activeStart)
      const p = e.pendingProjectile
      expect(p, 'burst 无 at[]：第 0 发的发射时刻回落 shots*everyTicks=0，activeStart 即离手').toBeTruthy()
      expect(p!.feintPunishMs, 'feint 缺席 → 诱饵惩罚为 null').toBeNull()
      expect(e.telegraphProjectile, '无 telegraph 字段：赤线读取口必须返回 null').toBeNull()
    })
  })

  it('L337/L902 无攻击位守卫：advanceAttackFrames / progressAttack 直调均安全回落', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -2, 'b23_337')
    const adv = e as unknown as { advanceAttackFrames(m: number): number }
    const prog = e as unknown as { progressAttack(dt: number, tick: number, player: unknown, rhythm: unknown): void }
    expect(adv.advanceAttackFrames(1), 'attack 为 null：帧推进必须吃 0').toBe(0)
    prog.progressAttack(TICK_DT, 0, w.player, w.rhythm)
    expect(e.attack, 'progressAttack 守卫：无攻击位不得生事').toBeNull()
  })

  it('L358/L914 落帧声源与前摇音的 loudness 兜底（?? 3 / ?? 4）', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -2, 'b23_358')
    const bite = e.data.attacks.find((a) => a.id === 'bite')!
    withoutField(bite.frames, 'loudness', () => {
      e.attack = newAttack(bite, bite.frames.activeStart - 1)
      e.enter('combat')
      w.step(e)
      expect(w.sounds.some((s) => s.loudness === 0.3), 'L358 loudness 缺席：声源响度必须落到 3/10').toBe(true)
      const e2 = w.spawn('en_murkshell', 0, -2, 'b23_914')
      e2.attack = newAttack(bite, 0)
      e2.enter('combat')
      const before = w.sfx.filter((x) => x.key === 'gnash').length
      w.step(e2)
      const g = w.sfx.filter((x) => x.key === 'gnash').slice(before)
      expect(g.length, 'L914 前摇音必须发一声').toBe(1)
      expect(g[0].gain, 'loudness 缺席：gain 兜底 0.55 + 4/20').toBeCloseTo(0.75, 5)
      expect(w.sounds.length, 'tick 0→1 未跨 activeStart：不得补发声源').toBe(1)
    })
  })

  it('L452 sawImpact 死体早退：活体目击进 chase，尸体无感', () => {
    const w = makeWorld()
    const live = w.spawn('en_murkshell', 0, -2, 'b23_452a')
    live.yaw = 0
    live.sawImpact({ x: 0, y: 0, z: 0 }, 1.2, null)
    expect(live.state, '活体目击：瞬间满警觉进 chase').toBe('chase')
    const dead = w.spawn('en_murkshell', 0, -2, 'b23_452b')
    dead.yaw = 0
    dead.stats.damage(dead.stats.hp) // damage() 才置 dead（update 不判血线）
    expect(dead.alive).toBe(false)
    dead.sawImpact({ x: 0, y: 0, z: 0 }, 1.2, null)
    expect(dead.state, '死体早退：状态不得被目击改写').toBe('idle')
    expect(dead.alertness).toBe(0)
  })

  it('L483 huntSound 选招落空：huntsSound.attackId 指向不存在的招 → 瞬移取消', () => {
    const w = makeWorld()
    const e = w.spawn('en_myriad', 0, -3, 'b23_483')
    const h = e.data.ai.huntsSound!
    withField(e.data.ai, 'huntsSound', { ...h, attackId: 'b23_no_such_attack' }, () => {
      e.hear({ pos: { x: 0, y: 0, z: 0 }, loudness: 5 }, 10)
      expect(e.pos.x, 'spec 落空：不得瞬移').toBe(0)
      expect(e.pos.z).toBe(-3)
      expect(e.attack, '不得起手').toBeNull()
      expect(w.notes.join('|'), '不得报听见了你').not.toContain('万籁听见了你')
    })
  })

  it('L530 tickIntro：introQueued 误挂而数据无 intro → 静默吞掉', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -2, 'b23_530')
    const box = e as unknown as { introQueued: boolean; introTicksLeft: number }
    box.introQueued = true
    w.step(e)
    expect(box.introQueued, '无 boss.intro：spec 落空必须原样保留队列标记').toBe(true)
    expect(box.introTicksLeft).toBe(0)
  })

  it('L602 investigate 超时：basic 回 idle、其余回 patrol，警觉 ×0.4', () => {
    const w = makeWorld()
    const basic = w.spawn('en_murkshell', 0, -2, 'b23_602a')
    basic.enter('investigate')
    basic.alertness = 50
    basic.stateTick = 300
    w.step(basic)
    expect(basic.state, 'archetype basic：超时回 idle').toBe('idle')
    expect(basic.alertness, '警觉衰减 ×0.4').toBeLessThan(21)
    expect(basic.alertness).toBeGreaterThan(18)
    const elite = w.spawn('en_hanged_knight', 0, -2, 'b23_602b')
    elite.enter('investigate')
    elite.alertness = 50
    elite.stateTick = 300
    w.step(elite)
    expect(elite.state, '非 basic：超时回 patrol').toBe('patrol')
  })

  it('L611 alert 超时 1800ms → patrol', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -2, 'b23_611')
    e.enter('alert')
    e.alertness = 50
    e.stateTick = 1800
    w.step(e)
    expect(e.state).toBe('patrol')
  })

  it('L1069/L658 registry 未注入 nearestAlly 回 null；撤退回血过线则回 combat', () => {
    const w = makeWorld()
    bindEnemyRegistry(null as unknown as Enemy[])
    const e = w.spawn('en_murkshell', 0, -2, 'b23_658')
    e.enter('retreat')
    w.step(e)
    expect(e.state, '满血高于 retreatHpFrac*1.8：必须回 combat').toBe('combat')
  })

  it('L659 撤退离玩家 >10 → 放弃撤退回 combat', () => {
    const w = makeWorld()
    bindEnemyRegistry(null as unknown as Enemy[])
    const e = w.spawn('en_murkshell', 0, 20, 'b23_659')
    e.stats.hp = Math.floor(e.stats.hpMax * 0.2)
    e.enter('retreat')
    w.step(e)
    expect(e.state, '血线未恢复但距离 20 > 10：dist 腿必须接住').toBe('combat')
  })

  it('L669/L670 search：满警觉进 chase；超时 1200 清零警觉回 patrol', () => {
    const w = makeWorld()
    const a = w.spawn('en_murkshell', 0, -2, 'b23_669')
    a.enter('search')
    a.alertness = 100
    w.step(a)
    expect(a.state, 'alertness ≥ 100：立刻进 chase').toBe('chase')
    const b = w.spawn('en_murkshell', 0, -2, 'b23_670')
    b.enter('search')
    b.alertness = 30
    b.stateTick = 1200
    w.step(b)
    expect(b.state).toBe('patrol')
    expect(b.alertness, '超时清零').toBe(0)
  })

  it('L674 callAlly 状态收束：无攻击位按警觉分流 chase/alert', () => {
    const w = makeWorld()
    const a = w.spawn('en_murkshell', 0, -2, 'b23_674a')
    a.enter('callAlly')
    a.alertness = 100
    w.step(a)
    expect(a.state, '警觉满：进 chase').toBe('chase')
    const b = w.spawn('en_murkshell', 0, -2, 'b23_674b')
    b.enter('callAlly')
    b.alertness = 50
    w.step(b)
    expect(b.state, '警觉未满：回 alert').toBe('alert')
  })

  it('L729 maybeBarCast 选招落空：selfToll.attackId 指向不存在的招 → 返回 false', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -2, 'b23_729')
    withField(e.data.ai, 'selfToll', { everyBars: 0, attackId: 'b23_no_such_attack' }, () => {
      const cast = e as unknown as { maybeBarCast(r: RhythmClock): boolean }
      expect(cast.maybeBarCast(w.rhythm), 'spec 落空必须返回 false 且不排读条').toBe(false)
      expect(e.attack).toBeNull()
    })
  })

  it('L743/L745 敲钟自鸣广播：toll 招缺 sfx/loudness → bell_toll 键与响度 0.3 兜底 + 回血', () => {
    const w = makeWorld()
    const e = w.spawn('en_hanged_knight', 0, -2, 'b23_743')
    const toll = e.data.attacks.find((a) => a.id === 'toll')!
    e.stats.hp = e.stats.hpMax - 20
    ;(e as unknown as { tollDueBar: number }).tollDueBar = w.rhythm.info().bar
    withoutField(toll.frames, 'sfx', () => {
      withoutField(toll.frames, 'loudness', () => {
        e.enter('combat')
        w.step(e, 200)
      })
    })
    expect(w.sfx.some((s) => s.key === 'bell_toll' && s.gain === 1), 'sfx 缺席：键兜底 bell_toll、gain 1').toBe(true)
    expect(w.sounds.some((s) => s.loudness === 0.3), 'loudness 缺席：响度兜底 3/10').toBe(true)
    expect(e.stats.hp, '读条走完回血 15').toBe(e.stats.hpMax - 20 + 15)
  })

  it('L775 checkFieldPhase 守卫：无 boss 数据与死体都直接返回', () => {
    const w = makeWorld()
    const plain = w.spawn('en_murkshell', 0, -2, 'b23_775a')
    expect(() => plain.checkFieldPhase({ remainingByKind: () => 0 })).not.toThrow()
    expect(plain.bossPhase).toBe(0)
    const boss = w.spawn('en_ostlara', 0, -5, 'b23_775b')
    boss.stats.damage(boss.stats.hp)
    boss.checkFieldPhase({ remainingByKind: () => 0 })
    expect(boss.alive).toBe(false)
    expect(boss.bossPhase, '死体不得跳阶').toBe(0)
  })

  it('L840 ringBells 无 bells 配置：charge 落帧静默返回、招式不被收掉', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -2, 'b23_840')
    const bite = e.data.attacks.find((a) => a.id === 'bite')!
    withField(bite.frames, 'flags', ['charge'], () => {
      e.attack = newAttack(bite, bite.frames.startup)
      e.enter('combat')
      w.step(e)
      expect(e.attack, '无钟可撞：读条必须原样保留').not.toBeNull()
      expect(e.bellsRung.length).toBe(0)
      expect(w.notes.join('|'), '不得有立钟通知').not.toContain('立钟鸣响')
    })
  })

  it('L858 撞满 breaksAt 且多阶：钟壳碎裂就地跳阶（bossPhase 0→1 + 怒吼标记）', () => {
    const w = makeWorld()
    const e = w.spawn('en_ostlara', 0, -5, 'b23_858')
    e.enter('combat')
    e.skipIntro()
    const charge = e.data.attacks.find((a) => a.id === 'charge')!
    const bells = e.data.boss!.bells!
    e.pos = { ...bells.positions[0] }
    e.attack = newAttack(charge, charge.frames.startup)
    w.step(e)
    expect(e.bellsRung[0], '第一口钟必须被撞响').toBe(true)
    expect(w.notes.join('|')).toContain('立钟鸣响')
    expect(e.shellBroken, '只撞 1 口 < breaksAt 2：壳不碎').toBe(false)
    e.pos = { ...bells.positions[1] }
    e.attack = newAttack(charge, charge.frames.startup)
    w.step(e)
    expect(e.bellsRung[1]).toBe(true)
    expect(e.shellBroken, '撞满 2 口：壳碎').toBe(true)
    expect(e.bossPhase, 'L858 多阶腿：就地进 P2').toBe(1)
    expect(e.phaseRoarPending, '跳阶怒吼标记挂起').toBe(true)
    expect(e.attack).toBeNull()
  })

  it('L881 tryAttack 选招落空：distBands 里混入不存在的招名 → 起手取消', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -1.5, 'b23_881')
    const band0 = e.data.ai.distBands[0]
    withField(e.data.ai, 'pickOrder', 'cycle', () => {
      withField(band0, 'actions', ['b23_ghost_attack', 'bite'], () => {
        e.enter('combat')
        e.alertness = 100
        e.stateTick = 30
        w.step(e)
        expect(e.attack, 'pick 命中 ghost → spec 落空：不得起手').toBeNull()
        expect(e.state).toBe('combat')
      })
    })
  })

  it('L1029 agentRadius：body 缺席时导航半径兜底 0.5×1', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -6, 'b23_1029')
    let seenRadius = -1
    const nav = (from: unknown, to: { x: number; y: number; z: number }, r?: number) => {
      seenRadius = r ?? -1
      return to
    }
    withoutField(e.data, 'body', () => {
      e.nav = nav as never
      e.enter('chase')
      e.alertness = 100
      w.step(e)
      expect(seenRadius, 'body 缺席：agentRadius 必须落到 0.5×1').toBe(0.5)
      expect(e.pos.z, '追击照常朝玩家走（nav 原样放行）').toBeGreaterThan(-6)
    })
    e.nav = null
  })

  it('L1041/L1042 风筝背退：kiteRange 缺席不设限；离巢超限则停步', () => {
    const w = makeWorld()
    const e = w.spawn('en_murkshell', 0, -1, 'b23_1041')
    const band0 = e.data.ai.distBands[0]
    withField(band0, 'actions', ['bite', 'shellburst', 'backstep'], () => {
      withoutField(e.data.ai, 'kiteRange', () => {
        e.enter('chase')
        e.alertness = 100
        const d0 = dist2(e.pos, w.player.pos)
        w.step(e)
        expect(dist2(e.pos, w.player.pos), 'limit 0：必须继续远离玩家').toBeGreaterThan(d0)
      })
      withField(e.data.ai, 'kiteRange', 0.3, () => {
        e.pos = { x: 0, y: 0, z: -1.4 }
        w.step(e)
        expect(e.pos.z, '离巢 0.4m ≥ limit 0.3：背退必须停步').toBe(-1.4)
      })
    })
  })
})
