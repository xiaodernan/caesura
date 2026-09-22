import { describe, expect, it } from 'vitest'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData, playerBase, regions } from '@/data'
import { registry } from '@/core/Registry'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { Interactables } from '@/world/Interactables'
import { SaveGame, MapStore } from '@/save/Serializer'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * 一次性交互物的状态跟着存档走（需求 §45「只存世界状态」里的一笔漏账）。
 *
 * 区域 flag 与出怪清剿记录很早就入档了，`Interactables.used` 却没有：读档等于全世界的遗箱
 * 重新能开一次（音色石/装备复制），"此路已尽"这条判据整条丢失。这里钉住三件事：
 * 开过的箱子读档后依然是开过的（且理由必须是 `used`，不是"离得太远"这种蒙混）、
 * 老档缺这一格时如实从空集开始、快照排序稳定（存档 diff 与断言都靠可比对）。
 */

function makeWorld(store = new MapStore()) {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, s) => ai.spawn(id, pos, s),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  // 区域闸门全开 + 前置 flag 由测试自己置位：这条链要测的是"用过一次"，不是通路
  const interact = new Interactables(regions, () => true)
  const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, interact }, store)
  return { player, ai, combat, streaming, spawner, interact, saves, store }
}

const standAt = (w: ReturnType<typeof makeWorld>, id: string): void => {
  const it = w.interact.all.find((x) => x.id === id)!
  w.player.pos = { ...it.pos }
}

describe('§45 一次性交互物入档：开过的箱子读档后依然是开过的', () => {
  it('used 集合进存档：读档后再按同一只箱子 = 此路已尽', async () => {
    const w = makeWorld()
    const chest = w.interact.all.find((i) => i.kind === 'chest' && i.lootTable)!
    if (chest.requiresFlag) w.interact.setFlag(chest.requiresFlag, true)
    standAt(w, chest.id)
    expect(w.interact.use(chest.id, w.player.pos).ok, '第一次打得开').toBe(true)
    expect(w.interact.use(chest.id, w.player.pos).ok, '同一局内第二次就再也打不开').toBe(false)

    const snap = await w.saves.save('slot1')
    expect(snap.usedInteractables, '落盘的快照要带上它').toContain(chest.id)

    const w2 = makeWorld(w.store)
    expect(await w2.saves.load('slot1')).not.toBeNull()
    expect(w2.interact.snapshot(), '读档后 used 集合复原').toContain(chest.id)
    if (chest.requiresFlag) w2.interact.setFlag(chest.requiresFlag, true)
    standAt(w2, chest.id)
    const again = w2.interact.use(chest.id, w2.player.pos)
    expect(again.ok, '读档后不该能再开一次：那就是掉落复制').toBe(false)
    expect(again.state, '理由必须是 used').toBe('used')
  })

  it('采集点与吊桥同样复原（单向锁不许靠读档回退）', async () => {
    const w = makeWorld()
    const gather = w.interact.all.find((i) => i.kind === 'gather')!
    const bridge = w.interact.all.find((i) => i.kind === 'bridge' || i.kind === 'soundwall')!
    for (const it of [gather, bridge]) {
      if (it.requiresFlag) w.interact.setFlag(it.requiresFlag, true)
      standAt(w, it.id)
      expect(w.interact.use(it.id, w.player.pos).ok, `${it.id} 第一次要用得通`).toBe(true)
    }
    await w.saves.save('slot2')
    const w2 = makeWorld(w.store)
    await w2.saves.load('slot2')
    expect(w2.interact.usedCount, '两处一次性设施都复原').toBe(2)
    for (const it of [gather, bridge]) {
      standAt(w2, it.id)
      expect(w2.interact.use(it.id, w2.player.pos).state, `${it.id} 读档后仍是已用`).toBe('used')
    }
    // 调音桩与 NPC 是对话/休息设施，本来就该反复可用：不许被这条规则误伤
    const cp = w.interact.all.find((i) => i.kind === 'checkpoint')!
    standAt(w2, cp.id)
    expect(w2.interact.use(cp.id, w2.player.pos).ok, '调音桩读档后照样能休息').toBe(true)
  })

  it('老档（没有这一格）读进来不崩：明确从空集开始', () => {
    const w = makeWorld()
    const gather = w.interact.all.find((i) => i.kind === 'gather')!
    standAt(w, gather.id)
    expect(w.interact.use(gather.id, w.player.pos).ok).toBe(true)
    expect(() => w.saves.apply({ ...w.saves.capture(), usedInteractables: [] })).not.toThrow()
    expect(w.interact.usedCount, '那份档确实没记过谁被开过 ⇒ 如实为空，不替老档编历史').toBe(0)
  })

  it('读档把 flag 同时送回交互层：立过的旗标不许只有流送层记得', async () => {
    // 写 flag 的唯一路径是 bus `world.flag`。存档 apply 走的是 streaming.setFlag ——
    // 它以前只登记不广播，于是读档后：区域解锁了，箱子却仍回答"上着锁"（两套缓存各记各的）。
    const w = makeWorld()
    const gated = w.interact.all.find((i) => !!i.requiresFlag && i.kind === 'chest')!
    const flag = gated.requiresFlag!
    w.streaming.setFlag(flag, true)
    await w.saves.save('slot3')

    const w2 = makeWorld(w.store)
    await w2.saves.load('slot3')
    expect(w2.streaming.hasFlag(flag), '流送层记得').toBe(true)
    expect(w2.interact.hasFlag(flag), '交互层也必须记得').toBe(true)
    standAt(w2, gated.id)
    const r = w2.interact.use(gated.id, w2.player.pos)
    expect(r.state, `读档后 ${gated.id} 不该还回答"上着锁"`).not.toBe('locked')
    expect(r.ok).toBe(true)
  })

  it('快照排序稳定且 restore 幂等', () => {
    const w = makeWorld()
    const ids = w.interact.all.filter((i) => i.kind === 'gather').map((i) => i.id)
    expect(ids.length).toBeGreaterThanOrEqual(2)
    for (const id of [...ids].reverse()) {
      standAt(w, id)
      w.interact.use(id, w.player.pos)
    }
    const a = w.interact.snapshot()
    expect(a, '快照按 id 排序 ⇒ 两份同样的档给出可比对的串').toEqual([...a].sort())
    const w2 = makeWorld()
    w2.interact.restore(a)
    w2.interact.restore(a)
    expect(w2.interact.snapshot()).toEqual(a)
  })
})
