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
import { KillSettlement } from '@/rpg/Settlement'

/**
 * Phase 10 测试矩阵的「多敌同帧死亡」一格（需求 §72）：
 * 同一 tick 里多个敌人被打死（AOE/范围结算的正常结果），死亡账要**各到各的**——
 * 每个敌人各发一次 entity.died、各走一遍击杀结算；而**同一个**敌人同帧被两笔伤害
 * 致死（近战+弹体是真实战况）只许结算一次（CombatManager.killed 那道门）。
 * 全部 headless：伤害入口用公开的 `strikeEnemy`（base 压成必杀），不借 hitbox 几何。
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

  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

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
  // strikeEnemy 是组合根内部接线（私有）：矩阵项关心的是死亡账，不重画 hitbox，从私有入口打
  const strike = (combat as unknown as { strikeEnemy: (e: unknown, s: unknown, t: number) => number }).strikeEnemy.bind(combat)
  return { time, rhythm, player, ai, combat, tick, strike }
}

/** 一记必杀的直击（base 拉满，绕开数值表——这里关心的是死亡账，不是伤害数值）。形状对齐 CombatManager 内部的 EnemyStrike */
function lethalStrike(at: { x: number; y: number; z: number }) {
  return {
    base: 999999, poise: 0, hitStopMs: 0, kind: 'light', layers: 0,
    mute: false, backstab: false, onBeat: false, ranged: false, pinTicks: 0,
    point: at, dir: { x: 0, y: 0, z: 1 }, shakeKey: 'shake_light'
  }
}

describe('多敌同帧死亡（Phase 10 矩阵：§72）', () => {
  it('同帧两敌双杀：两份死亡账各到各的（entity.died ×2，id 不同、各一次结算播报）', () => {
    const w = makeWorld()
    const eA = w.ai.spawn('en_murkshell', { x: 2, y: 0, z: -6 }, 'multikill')
    const eB = w.ai.spawn('en_murkshell', { x: -2, y: 0, z: -6 }, 'multikill')
    const died: Array<{ id: string; dataId?: string }> = []
    let shatter = 0
    bus.on('entity.died', (p) => { died.push({ id: p.id, dataId: p.dataId }) })
    bus.on('vfx.request', (p) => { if (p.key === 'death_shatter') shatter++ })
    const notify: string[] = []
    bus.on('ui.notify', (p) => { notify.push(p.text) })

    w.tick()
    const tick0 = w.time.tick
    w.strike(eA, lethalStrike(eA.pos), tick0)
    w.strike(eB, lethalStrike(eB.pos), tick0)

    expect(eA.alive).toBe(false)
    expect(eB.alive).toBe(false)
    expect(died.map((d) => d.id).sort()).toEqual([eA.id, eB.id].sort())
    expect(died.every((d) => d.dataId === 'en_murkshell')).toBe(true)
    expect(shatter, '每个死者各自一次碎裂特效，一个都不许被吞').toBe(2)
    expect(notify.filter((t) => t.includes('崩解')).length, '每个死者各自一条崩解播报').toBe(2)
  })

  it('同一敌同帧被两笔伤害致死：killed 门只结算一次（died ×1）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'multikill')
    let died = 0
    bus.on('entity.died', () => { died++ })
    let shatter = 0
    bus.on('vfx.request', (p) => { if (p.key === 'death_shatter') shatter++ })

    w.tick()
    const tick0 = w.time.tick
    w.strike(e, lethalStrike(e.pos), tick0)
    w.strike(e, lethalStrike(e.pos), tick0) // 近战+弹体同帧：第二笔打在尸体上

    expect(e.alive).toBe(false)
    expect(died, '同一敌人的死亡只许播报一次（重复致死不重播账目）').toBe(1)
    expect(shatter).toBe(1)
  })

  it('结算层同帧两个死亡事件：KillSettlement 各结算一份 XP，不吞不重', () => {
    registerGameData()
    let refresh = 0
    const checkpoints: string[] = []
    const rpgStub = {
      prog: {
        rank: 1,
        milestoneAt: (_r: number) => null,
      },
      onEnemyKilled: () => [{ type: 'xp' as const, count: 10 }],
    }
    const s = new KillSettlement({
      rpg: rpgStub as never,
      refresh: () => { refresh++ },
      checkpoint: (k: string) => { checkpoints.push(k) },
    } as never)
    try {
      bus.emit('entity.died', { id: 'a', kind: 'enemy', dataId: 'en_murkshell', position: { x: 0, y: 0, z: 0 } })
      bus.emit('entity.died', { id: 'b', kind: 'enemy', dataId: 'en_murkshell', position: { x: 2, y: 0, z: 0 } })
      expect(refresh, '两个死者各刷一次面板').toBe(2)
      expect(checkpoints, '没升级就没有 levelup 检查点').toEqual([])
    } finally {
      s.dispose()
    }
  })

  it('同帧双杀触发两档独立升级判定：第一个事件升级后，第二个事件以新 rank 为基准', () => {
    registerGameData()
    const checkpoints: string[] = []
    let rank = 1
    const rpgStub = {
      prog: {
        get rank() { return rank },
        milestoneAt: (r: number) => `里程碑 ${r}`,
      },
      onEnemyKilled: () => { rank++; return [{ type: 'xp' as const, count: 10 }] },
    }
    const s = new KillSettlement({
      rpg: rpgStub as never,
      refresh: () => {},
      checkpoint: (k: string) => { checkpoints.push(k) },
    } as never)
    try {
      bus.emit('entity.died', { id: 'a', kind: 'enemy', dataId: 'en_murkshell', position: { x: 0, y: 0, z: 0 } })
      bus.emit('entity.died', { id: 'b', kind: 'enemy', dataId: 'en_murkshell', position: { x: 2, y: 0, z: 0 } })
      expect(rank).toBe(3)
      expect(checkpoints, '两次升级各落一次 levelup 检查点').toEqual(['levelup', 'levelup'])
    } finally {
      s.dispose()
    }
  })
})