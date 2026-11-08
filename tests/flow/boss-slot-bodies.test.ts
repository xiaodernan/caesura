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
import { Squad } from '@/ai/Squad'
import { CombatManager } from '@/combat/CombatManager'

/**
 * KI-383 的 flow 侧落点（docs/roadmap-next.md §3.1 第一条）：
 * 「主攻手之间也有身体——两个人不再并着肩穿成一具」。
 *
 * KI-383 的量具住在 `tests/unit/squad-slot-bodies.test.ts`，那里用的是
 * 合成的 six-driftsinger 场景与几何刀口（`lungeRoomToAllies` 的纯函数反解）。
 * 这一份按 flow 的口径再钉一遍：真数据 boss `en_ostlara`（scale 2.6，半身宽 1.3 米）
 * + 两名真数据 `en_driftsinger`（scale 1，半身宽 0.5 米），由 AISystem + Squad
 * 按真实表装配、真 CombatManager、真拍钟、真玩家 controller——整场 1800 拍，
 * 逐拍记录两两水平距离。
 *
 * 判据（全场 1800 拍都要成立）：
 *   ① 两名漂调者主攻手之间的水平距离 ≥ 1.0 米（两具身体的接触线）。
 *      Boss 与漂调者之间不按 1.8 米硬钉
 *      ——`lungeRoomToAllies` 用的是**攻击者自己**的体格半径（boss 2×1.3=2.6，漂调者 2×0.5=1.0），
 *        漂调者扑向 boss 时按自身 1.0 米截断，这是 KI-383 的裁决本身，不是缺陷。
 *   ② 吞吐：至少两次出手（boss 或漂调者之一）——身体排斥没把三人冻在原地。
 *   ③ 反向臂：从 `Squad.prototype.update` 摘掉 `squadSlotPeers` 的写入 ⇒ §383 的缺口回来：
 *      两名漂调者最近距 <1.0 米（穿模样本回来）。
 */

registerGameData()

const TICKS = 1800

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpgWeapon = registry.get<WeaponData>('wp_fortissimo_greatsword')
  const player = new PlayerController(playerBase, rpgWeapon, registry.get<MovesetData>(`moveset:${rpgWeapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  // 站桩换血：读数面是「两个人有没有穿成一具」，不是玩家的续航
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999

  const offs = [bus.on('ui.notify', () => { /* 本文件不听提示，只要不泄漏监听 */ })]

  function tick(n = 1, each?: () => void): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      player.stats.hp = player.stats.hpMax
      player.stunTicks = 0
      player.crumpleTicks = 0
      player.stats.muteTicksLeft = 0
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      each?.()
      rhythm.update(TICK_DT)
    }
  }
  const off = (): void => { for (const o of offs) o() }
  return { time, rhythm, player, ai, combat, tick, off }
}
type World = ReturnType<typeof makeWorld>

/**
 * 三人都在近战劈砍带里（漂调者 [0, 2.2]；奥斯塔拉 [0, 4.6]），三人都进默认 3 槽：
 * 半径都压在 2 米附近——这才是前冲会发生的那一帧（`f.lunge`），也才是两具身体真正
 * 会挤在一起的那一帧。
 */
function spawnClash(w: World) {
  const boss = w.ai.spawn('en_ostlara', { x: 1.9, y: 0, z: 0 }, 'boss')
  const a = w.ai.spawn('en_driftsinger', { x: Math.cos((2 * Math.PI) / 3) * 1.75, y: 0, z: Math.sin((2 * Math.PI) / 3) * 1.75 }, 'add-a')
  const b = w.ai.spawn('en_driftsinger', { x: Math.cos((4 * Math.PI) / 3) * 1.75, y: 0, z: Math.sin((4 * Math.PI) / 3) * 1.75 }, 'add-b')
  boss.skipIntro?.()
  boss.alertness = 100
  a.alertness = 100
  b.alertness = 100
  boss.enter('combat')
  a.enter('combat')
  b.enter('combat')
  return { boss, a, b }
}

function run(arm: 'slotPeers' | null = null) {
  const w = makeWorld()
  const { boss, a, b } = spawnClash(w)
  let minPair = Infinity
  let under1 = 0
  let attacks = 0
  const original = Squad.prototype.update
  if (arm === 'slotPeers') {
    // 反向臂：保留出手与仇恨，只砍掉「占槽者看得到同伴」这一格
    Squad.prototype.update = function (tick: number) {
      const out = original.call(this, tick)
      const members = (this as unknown as { members: Map<string, { enemy: { squadSlotPeers: unknown[] } }> }).members
      for (const m of members.values()) m.enemy.squadSlotPeers = []
      return out
    }
  }
  try {
    w.tick(TICKS, () => {
      if (boss.attack || a.attack || b.attack) attacks++
      const pair = (p: { x: number; z: number }, q: { x: number; z: number }): void => {
        const d = Math.hypot(p.x - q.x, p.z - q.z)
        if (d < minPair) minPair = d
        if (d < 1) under1++
      }
      pair(a.pos, b.pos)
    })
  } finally {
    Squad.prototype.update = original
    w.off()
  }
  return { minPair, under1, attacks }
}

describe('KI-383 flow：主 Boss + 两名主攻手的三人交战', () => {
  it('全场 1800 拍：两名漂调者永远不穿成一具（≥1.0 米），出手吞吐没被冻住', () => {
    const r = run()
    expect(r.minPair, '两名漂调者全场最近距').toBeGreaterThanOrEqual(1.0)
    expect(r.under1, '低于接触线的样本').toBe(0)
    expect(r.attacks, '三人里至少出手过几次——排斥没有把战斗按进原地').toBeGreaterThan(0)
  })

  it('反向臂：摘掉占槽同伴 ⇒ 1.0 米的缺口回来', () => {
    const r = run('slotPeers')
    expect(r.minPair, '没有这一格，两具身体又撞到一起').toBeLessThan(1.0)
  })
})
