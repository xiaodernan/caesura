import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, msToTicks } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, ProgressionData, WeaponData } from '@/data/schema'
import { Progression } from '@/rpg/Progression'
import { RpgRuntime } from '@/rpg/Runtime'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'

/**
 * §8.2 里程碑的「机制腿」（KI-054）：`progression.json.milestones` 的每一行都是对玩家喊出的
 * 数值承诺，此前 11 行里只有 2 行（战技槽）真的有机制在吃它。这次补的是第一批三条腿——
 * rank4 负重 +8（`Progression.derive`）、rank5 弹反落空 -50ms、rank12 处决 +5%
 * （后者经由 `PlayerMods` 流到 `ThirdPersonController` 与处决管线）。
 *
 * 同一批还第一次让 §5.3「失败」行整句成立：落空后摇 27f 从表里来（以前 `parryWhiffTicks`
 * 是个只初始化、只倒数、从不被赋值的死字段），「期间被击 ×1.25」从 `parry.whiffDmgMul` 来。
 * 赌注的口径：吃掉窗口的那一击本身就落在后摇的第一格 ⇒ 它吃 ×1.25（docs/combat.md §5.3）。
 */

registerGameData()

function makeWorld(rpgRank = 0) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(weapon.movesetId))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  let rpg: RpgRuntime | null = null
  if (rpgRank > 0) {
    rpg = new RpgRuntime('origin_tuner')
    rpg.prog.rank = rpgRank
    player.applyRpg(rpg.mods())
  }
  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const damages: number[] = []
  const results: string[] = []
  const offs = [
    bus.on('player.damaged', (e) => { damages.push(e.amount) }),
    bus.on('combat.hit', (e) => { results.push(e.result) })
  ]

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
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, rpg, tick, damages, results, off }
}

/** 用**真实输入边沿**开一扇弹反窗（不是直接写 parryTicksLeft——那会绕过 parryWhiffPending，
 *  而 pending 正是这次接线的核心：落空/成功的分岔全靠它）。 */
function openParry(w: ReturnType<typeof makeWorld>): void {
  const before = w.player.parryTicksLeft
  w.frame.edges.add('parry')
  w.tick()
  expect(w.player.parryTicksLeft, '开窗后当 tick 倒数一格').toBe(before + w.player.base.parry.activeTicks - 1)
}

describe('§8.2 里程碑机制腿：grant 只在到达 rank 后经 derive 累加（KI-054）', () => {
  it('rank4 的 loadFlat +8：rank3 拿不到、rank4 整额拿到（同属性对照）', () => {
    const p = new Progression('origin_tuner')
    p.rank = 3
    const before = p.derive().loadMax
    p.rank = 4
    const after = p.derive().loadMax
    const g = registry.get<ProgressionData>('progression').milestones.find((m) => m.id === 'ms_load_8')!.grant!.loadFlat!
    expect(after - before, '跨过 rank4 的增量 == grant 表值').toBe(g)
    p.rank = 12
    expect(p.derive().loadMax - before, '+8 是加数不是乘法，rank12 不叠加第二份').toBe(g)
  })

  it('改表法：loadFlat 8→99 立刻反映进 derive，还原后分毫不差（证明读的是表不是常数）', () => {
    const d = registry.get<ProgressionData>('progression')
    const row = d.milestones.find((m) => m.id === 'ms_load_8')!
    const backup = JSON.parse(JSON.stringify(row.grant))
    const p = new Progression('origin_tuner')
    p.rank = 4
    const base = p.derive().loadMax
    row.grant = { loadFlat: 99 }
    expect(p.derive().loadMax).toBe(base - 8 + 99)
    row.grant = backup
    expect(p.derive().loadMax).toBe(base)
  })

  it('rank5 的 parryWhiffMs -50：rank4 为 0，rank5 起为 -50（ms，未折算成 tick）', () => {
    const p = new Progression('origin_tuner')
    p.rank = 4
    expect(p.derive().parryWhiffMs, 'rank4 拿不到弹反那条腿').toBe(0)
    p.rank = 5
    expect(p.derive().parryWhiffMs).toBe(-50)
  })

  it('rank12 的 execMulPct 5：×1.05 只从 rank12 起挂上（同属性比值）', () => {
    const p = new Progression('origin_tuner')
    p.rank = 11
    const before = p.derive().execMul
    p.rank = 12
    expect(p.derive().execMul / before).toBeCloseTo(1.05, 10)
  })
})

describe('§5.3「失败」行第一次整句成立：落空后摇与 ×1.25 赌注（KI-054）', () => {
  it('空挥落窗：表里的 27 格一格不多一格不少，pending 就地结清', () => {
    const w = makeWorld()
    const { activeTicks, whiffRecovery } = w.player.base.parry
    openParry(w)
    w.tick(activeTicks - 1) // 窗口在 openParry 那 tick 已走了一格
    expect(w.player.parryTicksLeft).toBe(0)
    expect(w.player.parryWhiffTicks, '落空后摇 == player.json 的 whiffRecovery（rank<5 无 grant）')
      .toBe(whiffRecovery)
    expect(w.player.parryWhiffPending, 'pending 是一次性的').toBe(false)
    w.tick(whiffRecovery)
    expect(w.player.parryWhiffTicks, '锁格走完').toBe(0)
    w.off()
  })

  it('rank5 之后同一扇窗只锁 27 + msToTicks(-50) = 24 格（里程碑真的改玩法）', () => {
    const w = makeWorld(5)
    openParry(w)
    w.tick(w.player.base.parry.activeTicks - 1)
    expect(w.player.parryWhiffTicks).toBe(w.player.base.parry.whiffRecovery + msToTicks(-50))
    expect(w.player.parryWhiffTicks).toBe(24)
    w.off()
  })

  it('后摇期间拒绝再次弹反；锁格走完才允许（输入边沿实测，不是判据复读）', () => {
    const w = makeWorld()
    openParry(w)
    w.tick(w.player.base.parry.activeTicks - 1) // 自然落空
    expect(w.player.parryWhiffTicks).toBe(w.player.base.parry.whiffRecovery)
    w.frame.edges.add('parry')
    w.tick()
    expect(w.player.parryTicksLeft, '锁定期内开不了新窗').toBe(0)
    w.tick(w.player.base.parry.whiffRecovery) // 锁格走完（上面已走 1 格）
    openParry(w)
    expect(w.player.parryTicksLeft, '解锁后可以再弹').toBeGreaterThan(0)
    w.off()
  })

  it('赌注实测：落空后摇里挨 8 点报 10（×1.25），对照组报 8 —— 数值全从表来', () => {
    const a = makeWorld()
    a.player.takeDamage(8)
    expect(a.damages, '对照：没有后摇就是原价').toEqual([8])
    a.off()

    const b = makeWorld()
    const mul = b.player.base.parry.whiffDmgMul
    expect(mul, '夹具前提：表值确实 >1，否则这条腿测的是空气').toBeGreaterThan(1)
    openParry(b)
    b.tick(b.player.base.parry.activeTicks - 1) // 落空
    b.player.takeDamage(8)
    expect(b.damages, 'player.damaged 报的是加重后的成交价').toEqual([Math.round(8 * mul)])
    b.off()
  })

  it('真挨打落空（背对攻击者乱开窗口）：那一击吃掉窗口 ⇒ 当场进后摇', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'whiff-hit')
    e.alertness = 100
    e.enter('chase')
    let armed = false
    for (let t = 0; t < 900; t++) {
      const p = w.player.pos
      const toward = Math.atan2(e.pos.x - p.x, e.pos.z - p.z)
      const atk = e.attack
      if (!armed && atk && atk.tick === atk.spec.frames.startup - 3) {
        w.frame.edges.add('parry')
        armed = true
      }
      // 开窗之后一直背对：facing 判据不成立 ⇒ 走「没弹着」的那支（beginParryWhiff）
      w.player.yaw = armed ? toward + Math.PI : toward
      w.tick()
      if (w.results.includes('hit')) break
    }
    expect(w.results, '900 tick 没等到那一记硬吃').toContain('hit')
    expect(w.player.parryWhiffTicks, '被吃掉窗口的落空照样进后摇').toBeGreaterThan(0)
    expect(w.player.parryTicksLeft, '窗口当场被清').toBe(0)
    expect(w.damages.length, '赌注：落空那一击本身就落在后摇第一格').toBe(1)
    expect(w.damages[0], '成交价 >0（精确 ×1.25 由直接受击那条腿钉，这里只钉接线）').toBeGreaterThan(0)
    w.off()
  })

  it('弹反成功清 pending：同样开一扇窗，弹中之后落空后摇一格都不欠', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'parry-ok')
    e.alertness = 100
    e.enter('chase')
    for (let t = 0; t < 900 && !w.results.includes('parry'); t++) {
      const p = w.player.pos
      w.player.yaw = Math.atan2(e.pos.x - p.x, e.pos.z - p.z)
      const atk = e.attack
      if (atk && atk.tick === atk.spec.frames.startup - 3) w.frame.edges.add('parry')
      w.tick()
    }
    expect(w.results, '900 tick 没等到弹反').toContain('parry')
    expect(w.player.parryWhiffPending, '成功支把 pending 撤掉').toBe(false)
    w.tick(30) // 窗口自然走完 + 一段余量
    expect(w.player.parryWhiffTicks, '弹中之后不欠后摇').toBe(0)
    w.off()
  })
})

describe('弹反落空的腿是数据腿：grant 改表即改玩法（反向实测）', () => {
  it('把 parryWhiffMs 的 grant 从 -50 抹成 0 ⇒ rank5 的后摇回到表头 27 格', () => {
    const d = registry.get<ProgressionData>('progression')
    const row = d.milestones.find((m) => m.id === 'ms_parry_whiff')!
    const backup = JSON.parse(JSON.stringify(row.grant))
    row.grant = {}
    const w = makeWorld(5)
    openParry(w)
    w.tick(w.player.base.parry.activeTicks - 1)
    expect(w.player.parryWhiffTicks, 'grant 抹掉后回落到 whiffRecovery 本体').toBe(w.player.base.parry.whiffRecovery)
    w.off()
    row.grant = backup
    const w2 = makeWorld(5)
    openParry(w2)
    w2.tick(w2.player.base.parry.activeTicks - 1)
    expect(w2.player.parryWhiffTicks, '还原后 -50ms 又生效').toBe(24)
    w2.off()
  })

  it('whiffDmgMul 改成 1 ⇒ 后摇里的成交价回到原价（乘数没有藏在代码里的第二份）', () => {
    const p = playerBase // registry 'player:base' 就是它本体：改它 == 改表
    const backup = p.parry.whiffDmgMul
    p.parry.whiffDmgMul = 1
    const w = makeWorld()
    openParry(w)
    w.tick(w.player.base.parry.activeTicks - 1)
    w.player.takeDamage(8)
    expect(w.damages).toEqual([8])
    w.off()
    p.parry.whiffDmgMul = backup
    const w2 = makeWorld()
    openParry(w2)
    w2.tick(w2.player.base.parry.activeTicks - 1)
    w2.player.takeDamage(8)
    expect(w2.damages, '还原后又是 ×1.25').toEqual([10])
    w2.off()
  })
})
