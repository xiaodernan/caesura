import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { Rng } from '@/core/Math'
import type { Enemy } from '@/ai/Enemy'

/**
 * 需求 §16「Boss 不许是 HP 海绵：单阶段等效承伤时间 ≤90 秒（数值表断言）」。
 * 参照伤害取「强音大剑蓄力一记 + 一轮 ≈74 tick 的起手/收势/体力循环」——
 * 这是玩家在 Boss 战里能稳定复现的输出节奏，不是理论 DPS 上限。
 */

registerGameData()

function world() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const gs = registry.get<WeaponData>('wp_fortissimo_greatsword')
  const player = new PlayerController(playerBase, gs, msOf(gs))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999
  const hits: Array<{ v: string; d: number }> = []
  const offs = [bus.on('combat.hit', (p) => hits.push({ v: p.victimId, d: p.damage }))]
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  const swing = (e: Enemy): number => {
    e.stats.crumpleTicksLeft = 600
    e.enter('recover')
    player.stats.stamina = 100
    player.action = null
    player.roll = null
    player.executing = null
    player.stunTicks = 0
    player.pos.x = e.pos.x
    player.pos.z = e.pos.z + 3
    player.pos.y = e.pos.y
    player.yaw = Math.PI
    combat.rng = new Rng('budget')
    if (!player.tryStartAction('charged', time.tick, rhythm)) throw new Error('出招失败')
    const seen = hits.length
    for (let i = 0; i < 150; i++) {
      tick(1)
      const h = hits.slice(seen).find((x) => x.v === e.id)
      if (h) return h.d
      if (!player.action) break
    }
    throw new Error('这一记没打上')
  }
  return { time, rhythm, player, ai, combat, tick, swing, hits, off: () => { for (const f of offs) f() } }
}

/** 一轮蓄力的墙钟成本：起手+收招+回体力（实测 charged 全程 74 tick） */
const CYCLE_TICKS = 74

function phaseSeconds(dmg: number, hpTotal: number, frac: number, mul = 1): number {
  const effective = hpTotal * frac / mul
  return (Math.ceil(effective / dmg) * CYCLE_TICKS) / TICK_HZ
}

describe('§16：三个 Boss 的每一阶都要在 90 秒等效承伤之内', () => {
  const cases: Array<{ id: string; label: string; phases: Array<[string, number, number]> }> = [
    { id: 'en_ostlara', label: '悬钟骑士·奥斯塔拉', phases: [['P1 钟壳期（撞钟剥壳后）', 0.4, 1], ['P2 双剑狂板', 0.35, 1], ['P3 拔钟抡砸', 0.25, 1]] },
    { id: 'en_hersil', label: '无拍长·恩希尔', phases: [['P1 曲目学习期', 0.4, 1], ['P2 夺拍期', 0.35, 1], ['Finale 过载期', 0.25, 1]] },
    { id: 'en_myriad', label: '隐藏 Boss 万籁', phases: [['P1 听诊期（音刺在场）', 1, 1], ['P2 聋乱期（音刺碎尽，KI-024 场地入口非血线）', 1, 2]] }
  ]

  for (const kase of cases) {
    it(`${kase.label}`, () => {
      const w = world()
      const e = w.ai.spawn(kase.id, { x: 0, y: 0, z: -3 }, 'budget')
      const data = e.data
      const dmg = w.swing(e)
      expect(dmg, '参照伤害为正的').toBeGreaterThan(0)
      for (const [name, frac, mul] of kase.phases) {
        const seconds = phaseSeconds(dmg, data.hp, frac, mul)
        expect(seconds, `${name}：等效承伤 ${seconds.toFixed(1)}s（§16 上限 90s）`).toBeLessThanOrEqual(90)
      }
      // §16 处决递减：Boss 的三连处决之和必须远小于血量，否则处决就是答案本身
      const ex = playerBase.execution
      const execTotal = ex.bossFracs.reduce((a, f) => a + f, 0)
      expect(execTotal, '12%→8%→5% 的递减上限（防止无限处决）').toBeLessThanOrEqual(0.3)
      w.off()
    })
  }  it('§16 二/三阶段强制：两位主 Boss 的阶段数合规且每阶真的换招式', () => {
    const phases = (id: string) => registry.get<EnemyData>(id).boss?.phases ?? []
    const ost = phases('en_ostlara')
    const her = phases('en_hersil')
    expect(ost, '奥斯塔拉三阶（§15.1）').toHaveLength(3)
    expect(her, '恩希尔三阶已落（§15.2 的 Finale 由 KI-022① 补上）').toHaveLength(3)
    for (const list of [ost, her]) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i].belowHpFrac, '每一阶都由血线进入').toBeTypeOf('number')
        expect(list[i].attacks.join(), `${list[i].id} 必须换行为而不是换数值`)
          .not.toEqual(list[i - 1].attacks.join())
      }
    }
  })
})
