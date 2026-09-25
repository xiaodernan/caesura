import { describe, expect, it, vi } from 'vitest'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, Vec3, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import {
  IdbStore, MapStore, SAVE_VERSION, SaveGame, readSlot, slotCandidates, type KvStore, type Snapshot
} from '@/save/Serializer'
import { wrap } from '@/save/Integrity'
import { registerMigration, unregisterMigration } from '@/save/Migration'
import { AUTOSAVE_SLOT, MANUAL_SLOTS, SlotRoster, saveSlots } from '@/save/Slots'

/**
 * 存档槽名册（KI-025① / 需求 §45、ui-ux §8）。
 *
 * 这块逻辑要守住的不是"能不能存"（Phase 5-A 已经管过），而是**摘要卡敢不敢说真话**：
 * - 空格与坏格必须分得开：把"没写过"显示成"损坏"会让玩家以为丢了档；
 * - "恢复出来的"必须带来源：`.prev` 救的场与备份机救的场是两条不同的诊断结论；
 * - 老档缺的那一格（时间戳、成长数据）要留空，不能拿读档那一刻或出身基线去冒充（§78）；
 * - 全仓库只准有**一条**读档候选顺序：卡上写"可读取"而点下去读到别的格子，是玩家眼前的假账。
 */

registerGameData()

function world(now?: () => number, withRpg = true) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const rpg = withRpg ? new RpgRuntime() : undefined
  const saves = new SaveGame(
    { player, streaming, spawner, clock: rhythm, time, ...(rpg ? { rpg } : {}), ...(now ? { now } : {}) },
    new MapStore()
  )
  return { time, rhythm, player, streaming, spawner, combat, ai, rpg, saves }
}

/** 换一个位置/时刻，好让两张卡的内容能区分开（候选顺序那条测试靠这个当证人） */
function dirty(w: ReturnType<typeof world>, playTick: number, pos: Vec3): void {
  w.time.tick = playTick
  w.player.pos.x = pos.x; w.player.pos.y = pos.y; w.player.pos.z = pos.z
}

const AT_CAMP: Vec3 = { x: -120, y: 0, z: -310 }
const AT_DEEP: Vec3 = { x: 130, y: 64, z: -120 }

async function savedToWorld(now?: () => number) {
  const w = world(now)
  const store = new MapStore()
  const saves = new SaveGame(
    { player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, rpg: w.rpg, now },
    store
  )
  return { w, store, saves }
}

describe('存档槽名册：格子的形状', () => {
  it('名册是四格，自动槽在最前，其余是需求 §45 的三个手动槽', async () => {
    expect(saveSlots()).toEqual([AUTOSAVE_SLOT, ...MANUAL_SLOTS])
    expect(MANUAL_SLOTS).toHaveLength(3)
    const roster = new SlotRoster(new MapStore())
    const cards = await roster.list()
    expect(cards.map((c) => c.slot)).toEqual(saveSlots())
    expect(cards[0].kind).toBe('auto')
    expect(cards.slice(1).every((c) => c.kind === 'manual')).toBe(true)
  })

  it('自动槽永远不进"写入哪一格"的候选：候选清单就是不含它的那三份', () => {
    // 玩家侧的 enforcement 住在 `saveCardHtml` 的 `v.kind === 'manual'`（面板那格有它自己的置灰用例）；
    // 这里只钉数据侧的口径：`MANUAL_SLOTS` 是唯一的候选名单，而它不含自动槽——所以"自动槽能不能被选中"
    // 不需要第二个 `isManualSlot()` 谓词，也不需要第二个主人。
    expect(MANUAL_SLOTS).not.toContain(AUTOSAVE_SLOT)
    expect(saveSlots().filter((s) => s !== AUTOSAVE_SLOT)).toEqual(MANUAL_SLOTS)
  })

  it('空库四格全是 empty（不是 blocked）：没写过与坏了是两件事', async () => {
    const cards = await new SlotRoster(new MapStore()).list()
    expect(cards.every((c) => c.state === 'empty')).toBe(true)
    expect(cards.every((c) => c.problem === null && c.data === null)).toBe(true)
  })

  it('键位里躺着一坨非 JSON ⇒ 这一格 blocked 并带原因，而不是"空槽"或直接抛', async () => {
    const store = new MapStore()
    await store.set('slot2', '{"this is":"not an envelope"}')
    const c = await new SlotRoster(store).card('slot2')
    expect(c.state).toBe('blocked')
    expect(c.problem).toBe('magic')
    expect(c.data).toBeNull()
  })

  it('存一次就把那一格从 empty 变成 ok，卡上读数就是那一刻的世界', async () => {
    const { w, store, saves } = await savedToWorld()
    dirty(w, 60 * 372, AT_CAMP)
    expect((await new SlotRoster(store).card('slot1')).state).toBe('empty')
    await saves.save('slot1')
    const c = await new SlotRoster(store).card('slot1')
    expect(c.state).toBe('ok')
    expect(c.migrated).toBe(false)
    expect(c.schemaVersion).toBe(SAVE_VERSION)
    expect(c.data?.playSec).toBe(372)
    // 区域不是编的：卡上那个 id 必须真的能在区域表里查到（UI 靠它显示中文名）
    expect(regions.some((r) => r.id === c.data?.regionId)).toBe(true)
    // 其余三格没被这一次写入牵连
    const all = await new SlotRoster(store).list()
    expect(all.filter((x) => x.state === 'ok').map((x) => x.slot)).toEqual(['slot1'])
  })

  it('没有成长层的存档：音级与出身留空，不拿基线冒充"这局升过级"', async () => {
    const w = world(undefined, false)
    const store = new MapStore()
    await new SaveGame(
      { player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time }, store
    ).save('slot3')
    const c = await new SlotRoster(store).card('slot3')
    expect(c.state).toBe('ok')
    expect(c.data?.rank).toBeNull()
    expect(c.data?.originId).toBeNull()
    expect(c.data?.questsStarted).toBeNull()
  })
})

describe('存档时刻：只在注入时钟时才有，缺了就留空', () => {
  it('注入 now ⇒ 卡上的 savedAt 就是它给的那一个数', async () => {
    const { store, saves } = await savedToWorld(() => 1_700_000_000_123)
    await saves.save('slot1')
    const c = await new SlotRoster(store).card('slot1')
    expect(c.data?.savedAt).toBe(1_700_000_000_123)
  })

  it('不注入 ⇒ savedAt 是 null，而游玩时长照样读得出（缺格不牵连别的格）', async () => {
    const { w, store, saves } = await savedToWorld()
    dirty(w, 60 * 60, AT_CAMP)
    await saves.save('slot1')
    const c = await new SlotRoster(store).card('slot1')
    expect(c.data?.savedAt).toBeNull()
    expect(c.data?.playSec).toBe(60)
  })

  it('v9 老档：卡是 ok，但标"由 v9 升级"且时间戳为 null——不拿读档那一刻冒充', async () => {
    const { w, store, saves } = await savedToWorld()
    dirty(w, 60 * 33, AT_CAMP)
    await saves.save('slot1')
    // 把它退回到"落盘时还没有 savedAt 这一格"的那一版：删掉字段并把版本头改成 9 后重新封装
    const raw = JSON.parse((await store.get('slot1'))!) as { payload: { snapshot: Snapshot } }
    delete (raw.payload.snapshot as unknown as Record<string, unknown>).savedAt
    const v9 = { ...raw.payload.snapshot, version: 9 }
    const store2 = new MapStore()
    await store2.set('slot1', wrap(9, { snapshot: v9 }))
    const c = await new SlotRoster(store2).card('slot1')
    expect(c.state).toBe('ok')
    expect(c.schemaVersion).toBe(9)
    expect(c.migrated).toBe(true)
    expect(c.data?.savedAt).toBeNull()
    expect(c.data?.playSec).toBe(v9.playSec)
  })

  it('迁移链缺一步 ⇒ 明示"版本读不了"而不是静默当成空槽（problem = migration）', async () => {
    const { store, saves } = await savedToWorld()
    await saves.save('slot1')
    const raw = JSON.parse((await store.get('slot1'))!) as { payload: { snapshot: Snapshot } }
    const v9 = { ...raw.payload.snapshot, version: 9 }
    const store2 = new MapStore()
    await store2.set('slot1', wrap(9, { snapshot: v9 }))
    // 摘掉 v9→v10 那一步：这份档从此升到半路就断
    unregisterMigration(9)
    try {
      const c = await new SlotRoster(store2).card('slot1')
      expect(c.state).toBe('blocked')
      expect(c.problem).toBe('migration')
      expect(c.data).toBeNull()
    } finally {
      registerMigration(9, (p) => {
        const snap = { ...(p.snapshot as Record<string, unknown>) }
        snap.savedAt = null
        snap.version = 10
        return { ...p, snapshot: snap }
      })
    }
    // 装回去之后同一格立刻可读：证明上面那条红的是那一步，不是我的测试环境
    expect((await new SlotRoster(store2).card('slot1')).state).toBe('ok')
  })
})

describe('恢复位：谁救的场要说得出名字', () => {
  it('主键位坏了、.prev 完好 ⇒ restored，并带来源键位与主键位的坏因', async () => {
    const { w, store, saves } = await savedToWorld()
    dirty(w, 60 * 100, AT_CAMP)
    await saves.save('slot1')          // 第一次：主键位 = 这份
    dirty(w, 60 * 200, AT_DEEP)
    await saves.save('slot1')          // 第二次：前一份进 .prev
    // 只改坏主键位的一个字符（校验和立刻对不上），.prev 保持完整
    const body = (await store.get('slot1'))!.split('')
    body[body.length - 30] = body[body.length - 30] === '9' ? '8' : '9'
    await store.set('slot1', body.join(''))
    const c = await new SlotRoster(store).card('slot1')
    expect(c.state).toBe('restored')
    expect(c.fromKey).toBe('slot1.prev')
    expect(c.problem).toBe('crc')
    expect(c.data?.playSec).toBe(100)  // 捡回来的是**上一份**，不是刚才那份
  })

  it('只有备份机上有 ⇒ 来源报成 @backup，不与主机同名键位混成一件事', async () => {
    const primary = new MapStore()
    const backup = new MapStore()
    const w = world()
    await new SaveGame(
      { player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, rpg: w.rpg },
      backup
    ).save('slot2')
    const c = await new SlotRoster(primary, backup).card('slot2')
    expect(c.state).toBe('restored')
    expect(c.fromKey).toBe('slot2@backup')
  })

  it('一条候选顺序，一个主人：名册与 load() 必须落在同一个键位上', async () => {
    const { w, store, saves } = await savedToWorld()
    dirty(w, 60 * 111, AT_CAMP)
    await saves.save('slot1')
    dirty(w, 60 * 222, AT_DEEP)
    await saves.save('slot1')
    // 主键位与 .prev 都是合法档，只是内容不同：谁赢由那一条顺序说了算
    await store.remove('slot1') // 主键位没了 ⇒ 顺序里下一格是 .tmp（也缺）⇒ .prev
    const c = await new SlotRoster(store).card('slot1')
    const loaded = await new SaveGame(
      { player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, rpg: w.rpg },
      store
    ).load('slot1')
    expect(c.fromKey).toBe('slot1.prev')
    expect(loaded?.playSec).toBe(c.data?.playSec)
    // 候选清单本身也只有一个来源：四格顺序写在这里，两处都从这里取
    const keys = slotCandidates(store, null, 'slot1').map((x) => `${x.where}:${x.key}`)
    expect(keys).toEqual(['primary:slot1', 'primary:slot1.tmp', 'primary:slot1.prev'])
  })

  it('四格全废 ⇒ blocked，且 tried 里四格都留了名字（诊断要能数）', async () => {
    const store = new MapStore()
    for (const k of ['slot3', 'slot3.tmp', 'slot3.prev']) await store.set(k, 'junk')
    const r = await readSlot(store, new MapStore(), 'slot3')
    expect(r.problem).not.toBeNull()
    expect(r.tried.map((t) => t.key)).toEqual(['slot3', 'slot3.tmp', 'slot3.prev', 'slot3'])
    expect((await new SlotRoster(store).card('slot3')).state).toBe('blocked')
  })
})

describe('删除与"还有地方写吗"', () => {
  it('erase 要连恢复位一起删：只删主键位会留下一个"删不干净"的卡', async () => {
    const { w, store, saves } = await savedToWorld()
    dirty(w, 60 * 50, AT_CAMP)
    await saves.save('slot1')
    dirty(w, 60 * 90, AT_CAMP)
    await saves.save('slot1')
    expect((await new SlotRoster(store).card('slot1')).state).toBe('ok')
    expect(await saves.erase('slot1')).toBe(true)
    expect((await new SlotRoster(store).card('slot1')).state).toBe('empty')
    // 主机与备份机上这个槽位的四种键位都不该再留下东西
    expect([...store.raw.keys()]).toEqual([])
  })

  it('对空槽 erase ⇒ 返回 false：UI 不该说一句"已删除"的谎', async () => {
    const { saves, store } = await savedToWorld()
    expect(await saves.erase('slot2')).toBe(false)
    expect(store.raw.size).toBe(0)
  })

  it('写满三个手动槽：三格都读得回来、内容互不串（"覆盖谁"由确认屏说清楚）', async () => {
    const { w, store, saves } = await savedToWorld()
    await saves.save('slot1')
    dirty(w, 60 * 10, AT_CAMP)
    await saves.save('slot2')
    dirty(w, 60 * 20, AT_CAMP)
    await saves.save('slot3')
    const cards = (await new SlotRoster(store).list()).filter((c) => c.slot !== AUTOSAVE_SLOT)
    expect(cards.map((c) => c.state)).toEqual(['ok', 'ok', 'ok'])
    // 三格是三份不同的世界读数：时刻逐格往前，谁也没被谁覆盖
    expect(cards.map((c) => c.data?.playSec)).toEqual([0, 10, 20])
    expect(await saves.erase('slot2')).toBe(true)
    expect((await new SlotRoster(store).card('slot1')).state).toBe('ok')
    expect((await new SlotRoster(store).card('slot3')).state).toBe('ok')
  })
})

/* ------------------- 真·存储形状：IdbStore 与 KvStore 的合同 ------------------- */

/**
 * 一台按**真的 IndexedDB** 语义说话的假库。要点只有一条：
 * `objectStore.get(缺失键)` 是 **success + `result === undefined`**，不是 error、也不是 null。
 *
 * 为什么要专门造一台这样的库：`MapStore` 替身替真库把缺失键归一成了 null，于是「空槽被报成
 * 损坏」这件事在整条 headless 门禁下完全不可见 —— 它是实机 5199 读出来的
 * （slot1/2/3 从没写过，四格卡里三格是 `blocked / parse`）。假件照抄真库的怪脾气，
 * 而不是照抄我们希望它有的行为，否则测试就在给自己发通行证。
 */
function fakeIdb(): { indexedDB: unknown; dump: () => Map<string, string> } {
  const data = new Map<string, string>()
  let hasStore = false
  const req = <T>(fill: () => T): { result?: T; onsuccess?: () => void; onerror?: () => void } => {
    const r: { result?: T; onsuccess?: () => void; onerror?: () => void } = {}
    queueMicrotask(() => { r.result = fill(); r.onsuccess?.() })
    return r
  }
  const objectStore = () => ({
    get: (k: string) => req(() => data.get(k)),
    put: (v: string, k: string) => req(() => { data.set(k, v); return k }),
    delete: (k: string) => req(() => { data.delete(k); return undefined })
  })
  const db = {
    // 真库在对象仓库不存在时是**同步抛** NotFoundError：留着这条，才证明 openDb 的建库那一步真的做了
    transaction: (_name: string, _mode?: string) => {
      if (!hasStore) throw new Error('NotFoundError: object store 还没建')
      return { objectStore }
    },
    createObjectStore: () => { hasStore = true },
    close: () => {}
  }
  return {
    indexedDB: {
      open: () => {
        const r: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: db }
        queueMicrotask(() => {
          if (!hasStore) r.onupgradeneeded?.()
          r.onsuccess?.()
        })
        return r
      }
    },
    dump: () => data
  }
}

/** 一个故意不守合同的适配器：把"没有这个键"读成 undefined（正是修好前的 IdbStore） */
class LooseStore implements KvStore {
  async get(): Promise<string | null> { return undefined as unknown as string | null }
  async set(): Promise<void> {}
  async remove(): Promise<void> {}
}

describe('IdbStore：备份机的形状', () => {
  it('缺失键归一成 null：KvStore 的合同由适配器守住，而不是由调用方猜', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    try {
      const idb = new IdbStore('caesura-save')
      expect(await idb.get('slot1')).toBeNull()
      await idb.set('slot1', 'hello')
      expect(await idb.get('slot1')).toBe('hello')
      await idb.remove('slot1')
      expect(await idb.get('slot1')).toBeNull()
      expect(fake.dump().size).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('备份机是一台真·IDB 语义的库时，没写过的格子依然是 empty（实机报过 blocked）', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    try {
      const cards = await new SlotRoster(new MapStore(), new IdbStore('caesura-save')).list()
      expect(cards.map((c) => c.state)).toEqual(['empty', 'empty', 'empty', 'empty'])
      expect(cards.every((c) => c.problem === null)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('写进备份机的档读得回来，来源标成 @backup（set 那条腿也走一遍真库语义）', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    try {
      const backup = new IdbStore('caesura-save')
      const w = world()
      dirty(w, 60 * 70, AT_CAMP)
      await new SaveGame(
        { player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, rpg: w.rpg },
        backup
      ).save('slot1')
      // 主机全空、只有备份机上有 ⇒ 卡是"恢复出来的"，名字要带上是哪台机器救的场
      const card = await new SlotRoster(new MapStore(), backup).card('slot1')
      expect(card.state).toBe('restored')
      expect(card.fromKey).toBe('slot1@backup')
      expect(card.data?.playSec).toBe(70)
      expect(fake.dump().has('slot1')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('读侧自己兜住不守合同的存储：一台把缺失键读成 undefined 的库，也不许让空格子背"损坏"的指控', async () => {
    const r = await readSlot(new LooseStore(), null, 'slot2')
    expect(r.problem).toBe('empty')
    expect(r.tried.every((t) => t.reason === 'empty')).toBe(true)
    expect((await new SlotRoster(new LooseStore()).card('slot2')).state).toBe('empty')
  })
})
