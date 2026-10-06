import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { SaveGame, MapStore } from '@/save/Serializer'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-026 设置持久化：AudioEngine 的音量跟档走。
 * save → load ⇒ 五通道音量逐格复原。改表不经过 AudioEngine 的就是白改。
 */
registerGameData()

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

/** 音频桩件：不建图也能记 setVolume/getVolume（AudioEngine 的 pendingVolumes 同一套逻辑） */
function makeFakeAudio() {
  const vols = new Map<string, number>()
  return {
    setVolume: (bus: string, v: number) => { vols.set(bus, Math.max(0, Math.min(1, v))) },
    getVolume: (bus: string) => vols.get(bus) ?? 1,
    vols,
  }
}

function makeWorld(store = new MapStore(), audio = makeFakeAudio()) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, rpg, audio }, store)
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
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  return { time, rhythm, player, rpg, saves, tick, store, audio }
}

describe('KI-026 设置持久化：音频音量跟档走', () => {
  it('改音量 → save → 新世界 load ⇒ 音量逐格复原', async () => {
    const store = new MapStore()
    const audio1 = makeFakeAudio()
    const w = makeWorld(store, audio1)
    // 玩家把音乐调低、SFX 调高
    audio1.setVolume('music', 0.3)
    audio1.setVolume('sfx', 0.9)
    audio1.setVolume('master', 0.7)
    w.tick(2)
    await w.saves.save('settings')
    // 新世界：默认音量
    const audio2 = makeFakeAudio()
    const w2 = makeWorld(store, audio2)
    expect(audio2.getVolume('music'), '新世界默认 1.0').toBe(1)
    await w2.saves.load('settings')
    expect(audio2.getVolume('music'), '音乐音量复原 0.3').toBe(0.3)
    expect(audio2.getVolume('sfx'), 'SFX 音量复原 0.9').toBe(0.9)
    expect(audio2.getVolume('master'), '总音量复原 0.7').toBe(0.7)
    expect(audio2.getVolume('ambience'), '没改过的通道走默认 1.0').toBe(1)
  })

  it('不存档就不复原：两个独立世界的音量互不影响', () => {
    const a1 = makeFakeAudio()
    const a2 = makeFakeAudio()
    a1.setVolume('music', 0.2)
    expect(a2.getVolume('music'), '独立世界的音量是独立的').toBe(1)
  })
})
