import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { bus } from '@/core/EventBus'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { SaveGame, MapStore } from '@/save/Serializer'
import { QualityStore } from '@/settings/Quality'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-420 的持久化腿：**画质档原样复原**，老档缺块 ⇒ 不动（§78）。
 * 装配形状照抄 `settings-persistence.test.ts`——收集面共享，本文件只钉新增的那一格。
 */
registerGameData()

globalThis.innerWidth = 1280
globalThis.innerHeight = 720

const makeFakeAudio = () => {
  const vols = new Map<string, number>()
  return {
    setVolume: (bus: string, v: number) => { vols.set(bus, Math.max(0, Math.min(1, v))) },
    getVolume: (bus: string) => vols.get(bus) ?? 1,
    vols,
  }
}

const makeWorld = (store = new MapStore(), audio = makeFakeAudio(), withQuality = true) => {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const quality = withQuality ? new QualityStore({ particles: { spawnMul: 1 }, renderer: { resolutionScale: 1, shadowMapSize: 1536 } }) : undefined
  const saves = new SaveGame({
    player, streaming, spawner, clock: rhythm, time, rpg, audio,
    ...(quality ? { quality: { get: () => quality.get(), apply: (raw: unknown) => quality.apply(raw) } } : {}),
  }, store)
  const tick = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      time.tick++
      rhythm.update(TICK_DT)
    }
  }
  player.camYawRef = 0
  return { time, rhythm, player, rpg, saves, tick, store, audio, quality }
}

void bus

describe('KI-420｜画质档持久化：save → load 复原', () => {
  it('save ⇒ 档里带 quality=3；重建世界 load ⇒ 读到 3', async () => {
    const store = new MapStore()
    const audio = makeFakeAudio()
    const w = makeWorld(store, audio, true)
    w.quality!.set(3)
    w.tick(1)
    await w.saves.save('quality')

    const raw = store.raw.get('quality')!
    const parsed = JSON.parse(raw) as { payload: { snapshot: { settings?: { quality?: number } } } }
    expect(parsed.payload.snapshot.settings?.quality).toBe(3)

    const store2 = new MapStore()
    store2.raw.set('quality', raw)
    const w2 = makeWorld(store2, makeFakeAudio(), true)
    await w2.saves.load('quality')
    expect(w2.quality!.get()).toBe(3)
  })

  it('缺 quality 的老档 load ⇒ 不动——玩家手里的当前档不许被推回默认', async () => {
    const store = new MapStore()
    const audio = makeFakeAudio()
    const w = makeWorld(store, audio, true)
    w.quality!.set(3)
    await w.saves.save('quality')

    const raw = store.raw.get('quality')!
    const parsed = JSON.parse(raw) as { payload: { snapshot: { settings?: Record<string, unknown> } } }
    delete parsed.payload.snapshot.settings?.quality
    const store2 = new MapStore()
    store2.raw.set('quality', JSON.stringify(parsed))

    const w2 = makeWorld(store2, makeFakeAudio(), true)
    w2.quality!.set(1) // 玩家手里是中档
    await w2.saves.load('quality')
    expect(w2.quality!.get()).toBe(1) // 老档缺块 ⇒ 不动（§78）
  })

  it('没接 QualityStore 的世界 ⇒ 存档里一个字节的 quality 都不多', async () => {
    const store = new MapStore()
    const audio = makeFakeAudio()
    const w = makeWorld(store, audio, false)
    await w.saves.save('quality')
    const raw = store.raw.get('quality')!
    const parsed = JSON.parse(raw) as { payload: { snapshot?: { settings?: Record<string, unknown> } } }
    expect(parsed.payload.snapshot?.settings?.quality).toBeUndefined()
  })
})
