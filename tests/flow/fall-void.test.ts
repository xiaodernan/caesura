import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem } from '@/world/Streaming'
import { Surface } from '@/world/Surface'
import { RpgRuntime } from '@/rpg/Runtime'
import { registry } from '@/core/Registry'
import { bus } from '@/core/EventBus'

/**
 * §8 R3「可坠崖（营地石桥杀点）」——KI-052 的最后一条行为账（2026-10-11）。
 *
 * 设计原文（combat.md §8 R3 行）：「600ms/36f，2m（滑行摩擦动画），中断+**可坠崖（营地
 * 石桥杀点）**」。在这一批之前，applyReactionTier 的注释自己承认「本作没有坠崖杀这条通道，
 * 因此留账」。通道的地形读法已经存在：`Surface.floorAt` 的注释写着「未开放区域：几何上也
 * 没有可站的面（灰盒期表现为深渊/断桥）」——**深渊 = 脚下没有可站的地板**，营地北边界外
 * （去未竟厅的石桥方向）正是这样一块：越界之后要么没有区域覆盖、要么只剩 groundY=152 的
 * 未竟厅（对 y=0 的实体高不可站）。
 *
 * 判据是**位置谓词**而不是反应档位：不管位移从哪来（R3 击退、弹体击退），人悬在深渊上就坠。
 * 检查走 CombatManager.update 每 tick 的点名，死亡走 `onEnemyKilled` 同一条结算
 * （击杀噪声、遗响、掉落、去重全链一致——坠崖杀也是玩家挣的杀）。
 */

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const streaming = new StreamingSystem(regions)
  const rpg = new RpgRuntime('origin_tuner', 'fall-void')
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  player.pos = { x: 0, y: 0, z: -300 } // 营地中部，离北边界 80m
  player.grounded = true
  player.floorY = 0
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  // 营地锁在 flag.left_resthold 后面——走真实流入口立旗（不然整片营地都是「未开放=深渊」）
  streaming.setFlag('flag.left_resthold', true)
  // 真实地形（与 main.ts 同款构造）：未解锁区域没有可站面 = 深渊
  combat.surface = new Surface(regions, 0.5, (r) => !streaming.isRegionUnlocked(r))
  const frame = { move: { x: 0, y: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.grounded = true
      player.floorY = 0
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }

  return { time, rhythm, streaming, player, ai, combat, input, frame, tick }
}

describe('§8 R3 可坠崖：深渊 = 脚下没有可站的地板', () => {
  it('营地北边界外是深渊：站上去的敌人当 tick 坠亡，走完整的死亡结算（去重只结一次）', () => {
    const w = makeWorld()
    const died: string[] = []
    const off = bus.on('entity.died', (d) => { if (d.kind === 'enemy') died.push(d.id) })
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -383 }, 'fall-void') // 北边界内 1m
    w.tick(30)
    expect(e.alive, '边界内是营地地板：怎么 tick 都不该死').toBe(true)
    e.pos.z = -385 // 越过 z=-384：身后没有区域覆盖（x<−96 段），脚下无地板
    w.tick(2)
    expect(e.alive, '悬在深渊上 ⇒ 坠亡').toBe(false)
    expect(died, '走的是 entity.died 同一条结算（掉落/首杀/任务规则都接得上）').toEqual([e.id])
    w.tick(30)
    expect(died, '尸体不会在深渊上反复结算').toHaveLength(1)
    off()
  })

  it('真 R3 击退把边界上的敌人推下桥：弹体带 R3 声明 → 命中位移 2m → 下一 tick 坠亡', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -383 }, 'fall-void')
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: 0, y: 1, z: -378 }, dir: { x: 0, y: 0, z: -1 },
      speed: 30, range: 12, radius: 1, damage: 0, poise: 0, hitStopMs: 0,
      reaction: 'R3'
    }, w.time.tick)
    w.tick(20)
    expect(e.alive, 'R3 的 2m 位移把他推出 z=-384 ⇒ 坠亡（位移来源不重要，深渊认位置）').toBe(false)
  })

  it('营地内的普通位移不误杀：R2 的半米在地板上只是半米', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: -80, y: 0, z: -200 }, 'fall-void') // 出怪中心，离边界远
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: -80, y: 1, z: -195 }, dir: { x: 0, y: 0, z: -1 },
      speed: 30, range: 12, radius: 1, damage: 0, poise: 0, hitStopMs: 0,
      reaction: 'R2'
    }, w.time.tick)
    w.tick(20)
    expect(e.alive, '位移后脚下仍有地板 ⇒ 活着').toBe(true)
    expect(e.pos.z, 'R2 的 0.5m 位移真的发生了（判据钉的是坠亡不是位移缺失）').toBeLessThan(-200.4)
  })

  it('Boss 豁免：演出实体不许被一记击退推下台（与 KI-052① 的位移豁免同源）', () => {
    const w = makeWorld()
    const boss = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -385 }, 'fall-void')
    boss.skipIntro()
    w.tick(30)
    expect(boss.alive, '她站在深渊正上方也活着：她的场地是 authored 的，走位是机关的输入').toBe(true)
  })
})
