import { describe, expect, it } from 'vitest'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions, quests as questTable } from '@/data'
import type { MovesetData, Vec3, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { Quests } from '@/quest/Quests'
import { SaveGame, MapStore } from '@/save/Serializer'
import { SlotRoster } from '@/save/Slots'

/**
 * 批28：save/Slots.ts 的 2 条死分支（cov_b27 排行）。
 * 现有名册测试（slots.test.ts）的 SaveGame 全都没挂 quests ⇒ summarize 里
 * `s.quest ?` 的真腿（L79/L80）从来没走过——挂上叙事层再存一次，两条一起点亮。
 * L78 corruption ?? 0 与 L86 fromStore===null 经核实为恒死（源码同行尾标注）。
 */

registerGameData()

/** 与 slots.test.ts 同一模具，withQuests 决定挂不挂叙事层（本批死腿的解锁钥匙） */
async function setup(withQuests: boolean) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const quests = withQuests ? new Quests(questTable) : undefined
  const store = new MapStore()
  const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, rpg, quests }, store)
  return { quests, store, saves }
}

describe('Slots 死腿（批28）', () => {
  it('带叙事层的存档：quest 非 null ⇒ 卡上真数任务条数，不再留空（L79/L80 真腿）', async () => {
    const { quests, store, saves } = await setup(true)
    expect(quests!.start('q_bells'), '铃姨那条线先开起来').toBe(true)
    await saves.save('slot1')
    const c = await new SlotRoster(store).card('slot1')
    expect(c.state).toBe('ok')
    expect(c.data?.questsStarted, '开过一条就是 1，不是 null').toBe(1)
    expect(c.data?.questsCompleted, '没收束也是数字 0，不是 null').toBe(0)
  })

  it('对照：同模具不挂 quests 的存档，两格照样留空（§78 口径，不被本批改动碰坏）', async () => {
    const { store, saves } = await setup(false)
    await saves.save('slot2')
    const c = await new SlotRoster(store).card('slot2')
    expect(c.data?.questsStarted).toBeNull()
    expect(c.data?.questsCompleted).toBeNull()
  })
})
