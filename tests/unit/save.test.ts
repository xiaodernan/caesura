import { describe, expect, it, vi } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData, WorldStateDef } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import type { Vec3 } from '@/combat/EntityStats'
import { SaveGame, MapStore, SAVE_VERSION, migrateV9toV10, type KvStore, type Snapshot } from '@/save/Serializer'
import { Checkpoints } from '@/save/Checkpoint'
import { crc32, unwrap, wrap } from '@/save/Integrity'
import { migrateTo, registerMigration, unregisterMigration } from '@/save/Migration'
import { WorldStates } from '@/quest/WorldStates'
import { Quests } from '@/quest/Quests'
import type { Interactables } from '@/world/Interactables'

/**
 * 存档（需求 §45/§71）。存储层是可注入的 KV，所以「写一半被 kill」「校验和坏了」
 * 这些只能在真机上碰运气的情形，这里都能摆出来。
 */

registerGameData()

function world() {
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
  return { time, rhythm, player, streaming, spawner, combat, ai }
}

type GameWorld = ReturnType<typeof world>

function savesWith(w: GameWorld, primary: KvStore = new MapStore(), backup: KvStore | null = null) {
  return new SaveGame({ player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time }, primary, backup)
}

function dirtyState(w: GameWorld): void {
  w.streaming.setFlag('flag.left_resthold', true)
  w.streaming.setFlag('flag.bell_toll_rung', true)
  w.player.pos.x = 130
  w.player.pos.y = 64
  w.player.pos.z = -120
  w.player.stats.hp = 77
  w.player.stats.overdrive = 5
}

describe('往返：存进去的就是读出来的', () => {
  it('capture → save → 世界被搅乱 → load ⇒ 状态逐字段一致', async () => {
    const w = world()
    const store = new MapStore()
    const saves = savesWith(w, store)
    dirtyState(w)
    const snap = await saves.save('slot1')
    // 换一个「新会话」的世界：没有 flag、玩家回原点、状态满值
    const w2 = world()
    const loads = savesWith(w2, store)
    const back = await loads.load('slot1')
    expect(back).not.toBeNull()
    expect(back!.player).toEqual(snap.player)
    expect(back!.flags).toEqual(snap.flags)
    expect(back!.clearedSlots).toEqual(snap.clearedSlots)
    expect([w2.player.pos.x, w2.player.pos.y, w2.player.pos.z]).toEqual([130, 64, -120])
    expect(w2.player.stats.hp).toBe(77)
    expect(w2.player.stats.overdrive).toBe(5)
    expect(w2.streaming.hasFlag('flag.left_resthold')).toBe(true)
    expect(w2.streaming.hasFlag('flag.bell_toll_rung')).toBe(true)
    expect(w2.streaming.isRegionUnlocked(regions.find((r) => r.id === 'rg_whisperwode')!)).toBe(true)
    expect(w2.streaming.isRegionUnlocked(regions.find((r) => r.id === 'rg_earless_deeps')!)).toBe(false)
  })

  it('清剿记录跟着档走：读档后那些槽位不再刷怪，别的照常', async () => {
    const w = world()
    w.streaming.setFlag('flag.left_resthold', true)
    w.streaming.setFlag('flag.brokenbar_bridge_down', true)
    const key = chunkKeyOf(...Object.values(w.streaming.cellOf({ x: 206, y: 64, z: -244 })) as [number, number, number])
    w.streaming.teleport(0, { x: 206, y: 64, z: -244 })
    w.spawner.syncActive([key])
    const before = w.ai.enemies.length
    expect(before).toBeGreaterThan(0)
    const victim = w.ai.enemies[0]
    victim.stats.damage(9999)
    // 清剿记录的真源是 entity.died（SpawnDirector 监听它），所以测试也走这条公开事件
    bus.emit('entity.died', { id: victim.id, kind: 'enemy', position: { ...victim.pos } })
    const store = new MapStore()
    await savesWith(w, store).save('slot1')
    expect(w.spawner.clearedKeys().length).toBe(1)
    const w2 = world()
    w2.streaming.setFlag('flag.left_resthold', true)
    w2.streaming.setFlag('flag.brokenbar_bridge_down', true)
    const loads = savesWith(w2, store)
    await loads.load('slot1')
    w2.streaming.teleport(0, { x: 206, y: 64, z: -244 })
    w2.spawner.syncActive([key])
    expect(w2.ai.enemies.length, '清过的那只不再回来').toBe(before - 1)
  })
})

describe('§45 防损坏：校验和、双写、迁移链', () => {
  it('CRC32 与 magic/version 三道闸各自都能拒掉坏档', () => {
    const body = wrap(1, { snapshot: { hello: 'world' } })
    expect(unwrap(body, [1]).ok).toBe(true)
    const env = JSON.parse(body) as { magic: string; crc: number; schemaVersion: number; payload: unknown }
    expect(crc32(JSON.stringify(env.payload))).toBe(env.crc)
    expect(unwrap(body.slice(0, body.length - 8) + '}}}}', [1]).ok).toBe(false)
    expect(unwrap(JSON.stringify({ ...env, magic: 'OTHER' }), [1])).toMatchObject({ ok: false, reason: 'magic' })
    expect(unwrap(JSON.stringify({ ...env, crc: env.crc ^ 0xff }), [1])).toMatchObject({ ok: false, reason: 'crc' })
    expect(unwrap(JSON.stringify({ ...env, schemaVersion: 7 }), [1])).toMatchObject({ ok: false, reason: 'version' })
  })

  it('主档坏了 ⇒ 自动回退上一份；两半都不合格 ⇒ 明确报「没有档」而不是崩', async () => {
    const w = world()
    const store = new MapStore()
    const saves = savesWith(w, store)
    dirtyState(w)
    const first = await saves.save('slot1')
    w.player.pos.x = 999
    const second = await saves.save('slot1')
    expect(second.player.x).toBe(999)
    // 篡改主档（模拟 bit rot / 截断）
    await store.set('slot1', '{"magic":"CAESURA-SAVE","schemaVersion":1,"crc":1,"payload":null}')
    const w2 = world()
    const loads = savesWith(w2, store)
    const warn = vi.fn()
    const off = bus.on('log', warn)
    const back = await loads.load('slot1')
    off()
    expect(back, '主档不合格 ⇒ 回退到 .prev 那一份').not.toBeNull()
    // prev 存的是「本次写之前」的那份，也就是 first：回退意味着回到上一个完整检查点，
    // 而不是丢掉全部进度（需求 §71「损失 ≤ 最近检查点」）
    expect(back!.player.x).toBe(first.player.x)
    expect(back!.player.x).not.toBe(second.player.x)
    expect(warn.mock.calls.some((c) => (c[0] as { msg: string }).msg.startsWith('save.bad'))).toBe(true)
  })

  it('写到一半被 kill ⇒ 主键位仍是完整的旧档（双写交换的意义）', async () => {
    const w = world()
    const store = new MapStore()
    const saves = savesWith(w, store)
    dirtyState(w)
    const ok = await saves.save('slot1')
    // 下一次写：tmp 落了、主键位还没换 ⇒ 进程在这里被 kill
    const crashing = new MapStore(store.raw)
    let killed = false
    const crashingStore: KvStore = {
      get: (k) => crashing.get(k),
      set: async (k, v) => {
        if (k === 'slot1' && !killed) { killed = true; throw new Error('kill -9') }
        await crashing.set(k, v)
      },
      remove: (k) => crashing.remove(k)
    }
    const w2 = world()
    const risky = savesWith(w2, crashingStore)
    w2.player.pos.x = 5
    await expect(risky.save('slot1')).rejects.toThrow(/kill/)
    // 新会话读档：拿到的还是旧的那份完整状态
    const w3 = world()
    const loads = savesWith(w3, crashing)
    const back = await loads.load('slot1')
    expect(back).not.toBeNull()
    expect(back!.player).toEqual(ok.player)
  })

  it('迁移链：v1 档一路升到现在 ⇒ 每一级补的东西都被**显式**写出来（不是静默丢字段），旧字段逐条保住', () => {
    // 手工造一份 v1 档：不能拿 save() 去造，因为它现在写的是最新版
    const v1 = {
      version: 1,
      playSec: 123,
      regionId: 'rg_whisperwode',
      player: { x: 1, y: 2, z: 3, hp: 44, stamina: 55, overdrive: 3, weaponId: 'wp_tuning_sword' },
      flags: ['flag.left_resthold'],
      clearedSlots: ['rg_whisperwode:g0:0']
    }
    const moved = migrateTo({ snapshot: v1 }, 1, SAVE_VERSION) as { snapshot: Snapshot }
    expect(moved.snapshot.version).toBe(SAVE_VERSION)
    // v1 的每个字段都还在（迁移不是「重新构造一份」）
    expect(moved.snapshot.playSec).toBe(123)
    expect(moved.snapshot.player.hp).toBe(44)
    expect(moved.snapshot.flags).toEqual(['flag.left_resthold'])
    expect(moved.snapshot.clearedSlots).toEqual(['rg_whisperwode:g0:0'])
    // v2 补的：老档没有成长数据，就明确写成 null，读档时保留运行时基线
    expect(moved.snapshot.rpg).toBeNull()
    // v3 补的：老档没有失谐概念，从零开始（那是如实，不是"当时也没积累"的假账）
    expect(moved.snapshot.player.corruption).toBe(0)
  })

  it('迁移链缺步骤 ⇒ 明确报错（不把半迁移的结果写回磁盘）', () => {
    expect(() => migrateTo({}, SAVE_VERSION, SAVE_VERSION + 1)).toThrow(new RegExp(`v${SAVE_VERSION}`))
    expect(() => migrateTo({}, 1, SAVE_VERSION)).not.toThrow()
  })

  it('v5→v6：一次性交互物的 used 集合从空集补起（不替老档编造"哪些箱子开过"）', () => {
    const v5 = { version: 5, playSec: 9, regionId: null, player: { x: 0, y: 0, z: 0, hp: 5, stamina: 5, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 }, flags: [], clearedSlots: [], rpg: null }
    const moved = migrateTo({ snapshot: v5 }, 5, SAVE_VERSION) as { snapshot: Snapshot }
    expect(moved.snapshot.version).toBe(SAVE_VERSION)
    expect(moved.snapshot.usedInteractables).toEqual([])
  })

  it('真实读档路径可达：磁盘上躺着一份 v1 老档 ⇒ load() 一路升到当前并灌回世界', async () => {
    // 这条测试钉的是一个已经发生过的真 bug：读档白名单曾经只有 [SAVE_VERSION]，
    // 于是老档在 unwrap 那步就被当成坏档，迁移链注册得再认真也永远跑不到。
    const v1 = {
      version: 1,
      playSec: 42,
      regionId: 'rg_whisperwode',
      player: { x: 1, y: 2, z: 3, hp: 44, stamina: 55, overdrive: 3, weaponId: 'wp_tuning_sword' } as Snapshot['player'],
      flags: ['flag.left_resthold'],
      clearedSlots: [],
      usedInteractables: [],
      brokenProps: [],
      quest: null,
      rpg: null
    }
    const store = new MapStore()
    await store.set('slot1', wrap(1, { snapshot: v1 }))
    const w = world()
    const loads = savesWith(w, store)
    const back = await loads.load('slot1')
    expect(back, '老档不能读不出来').not.toBeNull()
    expect(back!.version).toBe(SAVE_VERSION)
    expect(back!.player.corruption).toBe(0)
    expect(w.player.stats.hp).toBe(44)
    expect(w.streaming.hasFlag('flag.left_resthold')).toBe(true)
    // 迁移过一次就写回当前版本：下一轮读档不必再走链（也证明磁盘上那一份没被半迁移污染）
    const rewritten = await savesWith(w, store).save('slot1')
    expect(rewritten.version).toBe(SAVE_VERSION)
    expect(JSON.parse(store.raw.get('slot1')!).schemaVersion).toBe(SAVE_VERSION)
  })
})

describe('自动存档触发器（调音桩 / Boss 跳阶 / 首次进区域）', () => {
  it('异步排队：一帧内的多次请求合并成一次写，且失败会说出来', async () => {
    const w = world()
    const store = new MapStore()
    let writes = 0
    const counting: KvStore = {
      get: (k) => store.get(k),
      set: async (k, v) => { if (!k.endsWith('.tmp') && !k.endsWith('.prev')) writes++; await store.set(k, v) },
      remove: (k) => store.remove(k)
    }
    const saves = savesWith(w, counting)
    const cp = new Checkpoints(saves)
    const notes: string[] = []
    const off = bus.on('ui.notify', (p) => notes.push(p.text))
    cp.request('rest')
    cp.request('rest')
    cp.request('region')
    await cp.flush()
    off()
    // 语义说清楚：正在写的那一次不回头改；写进行中排进来的请求合并成下一次一笔 ⇒
    // 同一帧三次请求最多两笔落盘（而不是三笔），且绝不会漏掉最后一次的原因
    expect(writes, '同一帧的三次请求不会写成三笔').toBeLessThanOrEqual(2)
    expect(cp.writes).toBe(writes)
    expect(cp.lastReason, '排在一起的请求会合并原因').toBe('rest+region')
    expect(notes.some((t) => t.includes('已存档 · 调音桩 · 进入新区域'))).toBe(true)
  })
})

describe('分支死角（批 15）：备份位、迁移链诊断与值域状态的落档', () => {
  const BELL: WorldStateDef = {
    key: 'state.test.bell', displayName: 'Test Bell', values: ['INTACT', 'RUNG'], default: 'INTACT', note: ''
  }

  it('v4→v5 迁移两条腿：rpg 有 loot 没 rollStreaks ⇒ 补空表；rpg 没有 loot ⇒ 原样留空', () => {
    const v4base = {
      version: 4, playSec: 9, regionId: null,
      player: { x: 0, y: 0, z: 0, hp: 5, stamina: 5, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
      flags: [], clearedSlots: []
    }
    const withLoot = migrateTo({ snapshot: { ...v4base, rpg: { loot: {} } } }, 4, 5) as unknown as {
      snapshot: { rpg: { loot: { rollStreaks: Record<string, number> } } }
    }
    expect(withLoot.snapshot.rpg.loot.rollStreaks).toEqual({})
    // 老档的 rpg 里根本没记过掉落 ⇒ ?? null 腿：不补 rollStreaks，rpg 原样保住
    const noLoot = migrateTo({ snapshot: { ...v4base, rpg: { movements: { lit: [], levels: {}, slots: [] } } } }, 4, 5) as unknown as {
      snapshot: { rpg: Record<string, unknown> }
    }
    expect('loot' in noLoot.snapshot.rpg).toBe(false)
  })

  it('值域状态：写过的格入档再灌回（capture 与 restore 的真腿都亮）', async () => {
    const w = world()
    const states = new WorldStates([BELL])
    const store = new MapStore()
    const saves = new SaveGame(
      { player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, states }, store
    )
    states.set('state.test.bell', 'RUNG')
    const snap = await saves.save('slot1')
    expect(snap.states).toEqual({ 'state.test.bell': 'RUNG' })
    // 读档：新世界先写一个脏值，load 后退回档里那份（restore 是唯一回写路径）
    const w2 = world()
    const states2 = new WorldStates([BELL])
    states2.set('state.test.bell', 'INTACT')
    const loads = new SaveGame(
      { player: w2.player, streaming: w2.streaming, spawner: w2.spawner, clock: w2.rhythm, time: w2.time, states: states2 }, store
    )
    try {
      await loads.load('slot1')
      expect(states2.get('state.test.bell')).toBe('RUNG')
      expect(states2.isSet('state.test.bell'), '档里写过的格恢复后仍是"写过"').toBe(true)
    } finally {
      states.dispose(); states2.dispose()
    }
  })

  it('备份位正常收档：save 同步写一份进 backup（try 的成功腿）', async () => {
    const w = world()
    const backup = new MapStore()
    await savesWith(w, new MapStore(), backup).save('slot1')
    expect(backup.raw.has('slot1')).toBe(true)
  })

  it('主备全坏 ⇒ 逐条报坏因，备份位那条带 @backup 后缀，最后报 load.none', async () => {
    const w = world()
    const primary = new MapStore()
    const backup = new MapStore()
    await savesWith(w, primary, backup).save('slot1')
    primary.raw.set('slot1', 'garbage-primary')
    backup.raw.set('slot1', 'garbage-backup')
    const warns: string[] = []
    const off = bus.on('log', (p) => { if (p.level === 'warn') warns.push(p.msg) })
    const back = await savesWith(world(), primary, backup).load('slot1')
    off()
    expect(back).toBeNull()
    expect(warns.some((m) => m.startsWith('save.bad slot1@backup ')), '备份位自己的坏因要带出处').toBe(true)
    expect(warns).toContain('load.none slot1')
  })

  it('迁移缺步发生在真实 load 路径 ⇒ save.migrate 把缺的那一级说出口，绝不静默', async () => {
    const w = world()
    const store = new MapStore()
    await savesWith(w, store).save('slot1')
    const raw = JSON.parse(store.raw.get('slot1')!) as { payload: { snapshot: Snapshot } }
    store.raw.set('slot1', wrap(9, { snapshot: { ...raw.payload.snapshot, version: 9 } }))
    unregisterMigration(9)
    try {
      const warns: string[] = []
      const off = bus.on('log', (p) => { if (p.level === 'warn') warns.push(p.msg) })
      const back = await savesWith(world(), store).load('slot1')
      off()
      expect(back).toBeNull()
      expect(warns.some((m) => m.startsWith('save.migrate slot1 ') && m.includes('v9'))).toBe(true)
    } finally {
      registerMigration(9, migrateV9toV10) // 装回真品：迁移函数只有一份，不许测试里养副本
    }
    expect(await savesWith(world(), store).load('slot1'), '装回那一步后同一格立刻可读').not.toBeNull()
  })

  it('主键位没写过、备份机上是好档 ⇒ 从备份读回，load.ok 记着 @backup 的出处', async () => {
    const manual: Snapshot = {
      version: SAVE_VERSION, playSec: 7, savedAt: null, regionId: null,
      player: { x: 1, y: 2, z: 3, hp: 30, stamina: 40, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 2 },
      flags: [], clearedSlots: [], usedInteractables: [], brokenProps: [],
      rpg: null, quest: null, states: {}
    }
    const backup = new MapStore()
    await backup.set('slot1', wrap(SAVE_VERSION, { snapshot: manual }))
    const w = world()
    const infos: string[] = []
    const off = bus.on('log', (p) => { if (p.level === 'info') infos.push(p.msg) })
    const back = await savesWith(w, new MapStore(), backup).load('slot1')
    off()
    expect(back, '备份机救场').not.toBeNull()
    expect(infos).toContain(`load.ok slot1@backup v${SAVE_VERSION}`)
    expect(w.player.stats.hp).toBe(30)
  })

  it('档里的 corruption 缺格（手改档才有的形态）⇒ apply 如实落 0，不 NaN', () => {
    const w = world()
    const broken = {
      version: SAVE_VERSION, playSec: 1, savedAt: null, regionId: null,
      player: { x: 0, y: 0, z: 0, hp: 50, stamina: 50, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: undefined },
      flags: [], clearedSlots: [], usedInteractables: [], brokenProps: [],
      rpg: null, quest: null, states: {}
    } as unknown as Snapshot
    savesWith(w, new MapStore()).apply(broken)
    expect(w.player.corruption.value).toBe(0)
  })

  it('v3→v4：rpg 在但没谱册 ⇒ 补空谱册（页全黑槽全空），不是替玩家点亮一页', () => {
    const v3 = {
      version: 3, playSec: 3, regionId: null,
      player: { x: 0, y: 0, z: 0, hp: 5, stamina: 5, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
      flags: [], clearedSlots: [], rpg: { inventory: { items: {} } }
    }
    const moved = migrateTo({ snapshot: v3 }, 3, 5) as unknown as {
      snapshot: { rpg: { movements: { lit: string[]; levels: Record<string, number>; slots: string[] } } }
    }
    expect(moved.snapshot.rpg.movements).toEqual({ lit: [], levels: {}, slots: [] })
  })

  it('v8→v9：谱册在但没被动栏 ⇒ 补空被动表（没学过的就是没学过）', () => {
    const v8 = {
      version: 8, playSec: 3, regionId: null,
      player: { x: 0, y: 0, z: 0, hp: 5, stamina: 5, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
      flags: [], clearedSlots: [], rpg: { movements: { lit: [], levels: {}, slots: [] } }
    }
    const moved = migrateTo({ snapshot: v8 }, 8, 9) as unknown as {
      snapshot: { rpg: { movements: { passives: Record<string, unknown> } } }
    }
    expect(moved.snapshot.rpg.movements.passives).toEqual({})
  })

  it('四件套世界件（quests/interact/props/audio）：capture 与 apply 的每一条真腿都亮', async () => {
    const w = world()
    const interact = { snapshot: () => ['ix_probe_tuned'], restore: () => {} } as unknown as Interactables
    let propsRestored: string[] | null = null
    const props = { snapshot: () => ['pr_probe_broken'], restore: (ids: string[] | null | undefined) => { propsRestored = ids ?? null } }
    const audio = { setVolume: () => {}, getVolume: () => 0.5 }
    const store = new MapStore()
    const saves = new SaveGame(
      {
        player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time,
        quests: new Quests([], () => {}), interact, props, audio
      }, store
    )
    const snap = await saves.save('slot1')
    expect(snap.quest, '空任务线也是叙事进度，不是 null').not.toBeNull()
    expect(snap.usedInteractables).toEqual(['ix_probe_tuned'])
    expect(snap.brokenProps).toEqual(['pr_probe_broken'])
    expect(snap.settings?.audio.master).toBe(0.5)
    // 读档：restore 的真腿逐件跑一遍（quest 灌回、交互物/碎刺复原、音量回灌）
    const w2 = world()
    const setCalls2: string[] = []
    const audio2 = { setVolume: (b: string) => setCalls2.push(b), getVolume: () => 0.5 }
    const loads = new SaveGame(
      {
        player: w2.player, streaming: w2.streaming, spawner: w2.spawner, clock: w2.rhythm, time: w2.time,
        quests: new Quests([], () => {}), interact, props, audio: audio2
      }, store
    )
    await loads.load('slot1')
    expect(propsRestored).toEqual(['pr_probe_broken'])
    expect(setCalls2, '五条音频总线逐一灌回').toHaveLength(5)
  })
})
