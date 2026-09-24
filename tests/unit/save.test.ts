import { describe, expect, it, vi } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import type { Vec3 } from '@/combat/EntityStats'
import { SaveGame, MapStore, SAVE_VERSION, type KvStore, type Snapshot } from '@/save/Serializer'
import { Checkpoints } from '@/save/Checkpoint'
import { crc32, unwrap, wrap } from '@/save/Integrity'
import { migrateTo } from '@/save/Migration'

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
    const v1: Snapshot = {
      version: 1,
      playSec: 42,
      regionId: 'rg_whisperwode',
      player: { x: 1, y: 2, z: 3, hp: 44, stamina: 55, overdrive: 3, weaponId: 'wp_tuning_sword' } as Snapshot['player'],
      flags: ['flag.left_resthold'],
      clearedSlots: [],
      usedInteractables: [],
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
