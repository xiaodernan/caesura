import { describe, expect, it } from 'vitest'
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
import { allGearItems } from '@/rpg/Loot'
import { MapStore, SAVE_VERSION, SaveGame, migrateV9toV10, type Snapshot } from '@/save/Serializer'
import { wrap } from '@/save/Integrity'
import { registerMigration, unregisterMigration } from '@/save/Migration'
import { AUTOSAVE_SLOT, MANUAL_SLOTS, SlotRoster, type SlotCard } from '@/save/Slots'
import { playText, saveCardHtml, saveCards, savedAtText, slotLabel } from '@/ui/SaveSlots'

/**
 * 摘要卡的**显示侧车**（KI-025② / 需求 §45、ui-ux §8）。
 *
 * 这一层只干一件事：把 `save/Slots.ts` 的读数翻成玩家看得懂的话。它最容易犯的错不是排版，
 * 而是**替存档编内容**——查不到名字就把 id 印上去、缺时间戳就拿"今天"填、坏档与空格同一句说法。
 * 所以这里的卡一律由真实 `SaveGame` 写进真实 `MapStore`、再由真实 `SlotRoster` 读回来，
 * 侧车不接任何手搓的 `SlotCard`：手搓的卡能圆出任何一句漂亮话，真实名册才不给它这个自由。
 */

registerGameData()

const AT_CAMP: Vec3 = { x: -120, y: 0, z: -310 }

/** 真档 + 真名册：`patch` 用来改**已落盘**的快照（模拟老档缺字段/表里查不到的 id） */
async function rosterWith(
  opts: { now?: () => number; at?: Vec3; patch?: (s: Snapshot) => Snapshot; version?: number } = {}
): Promise<{ roster: SlotRoster; store: MapStore; snapshot: Snapshot }> {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  streaming.teleport(0, player.pos)
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, (p) => chunkKeyOf(streaming.cellOf(p).cx, 0, 0))
  const at = opts.at ?? AT_CAMP
  player.pos.x = at.x; player.pos.y = at.y; player.pos.z = at.z
  player.floorY = at.y
  time.tick = 90 * 60 // 1 分 30 秒的游玩时长，卡上应当读得出
  const rpg = new RpgRuntime()
  const store = new MapStore()
  const saves = new SaveGame(
    { player, streaming, spawner, clock: rhythm, time, rpg, ...(opts.now ? { now: opts.now } : {}) }, store
  )
  const slot = MANUAL_SLOTS[0]
  const version = opts.version ?? SAVE_VERSION
  const snapshot = await saves.save(slot)
  if (opts.patch || version !== SAVE_VERSION) {
    // 改写已落盘的那一份：版本头与快照内部的 version 一起改，才是一封"真在 v9 写下的信"
    const next = { ...(opts.patch ? opts.patch(snapshot) : snapshot), version }
    await store.set(slot, wrap(version, { snapshot: next }))
  }
  return { roster: new SlotRoster(store), store, snapshot }
}

const cardOf = async (roster: SlotRoster, slot: string): Promise<SlotCard> => roster.card(slot)

describe('摘要卡：真档读回来的卡面不许有编出来的字', () => {
  it('一份正常的手动档 ⇒ 音级/出身/武器/区域/时长/时刻六格都有出处', async () => {
    const { roster } = await rosterWith({ now: () => 1770000000000 })
    const card = await cardOf(roster, MANUAL_SLOTS[0])
    const [v] = saveCards([card])
    expect(v.state).toBe('ok')
    expect(v.selectable).toBe(true)
    expect(v.badge).toBeNull()
    expect(v.note).toBeNull()
    expect(v.lines[0]).toBe(`音级 ${card.data!.rank} · 出身 ${originName(card.data!.originId!)}`)
    // 武器与区域都必须是表里的显示名，不是 wp_tuning_sword / rg_* 这种键
    expect(v.lines[1]).toBe(`武器 ${gearNameOfWeapon('wp_tuning_sword')}`)
    expect(v.lines[1], '显示名不是那个键').not.toBe('武器 wp_tuning_sword')
    expect(v.lines[2]).toBe(`区域 ${regions.find((r) => r.id === card.data!.regionId)?.displayName}`)
    expect(v.lines[3]).toBe('游玩 1分30秒')
    expect(v.lines[4]).toBe(savedAtText(1770000000000))
  })

  it('表里查不到的 id ⇒ 说「未知(id)」，不拿 id 冒充名字（这句本身就是诊断）', async () => {
    const { roster } = await rosterWith({
      patch: (s) => ({ ...s, regionId: 'rg_this_name_never_shipped' })
    })
    const [v] = saveCards([await cardOf(roster, MANUAL_SLOTS[0])])
    expect(v.lines[2]).toBe('区域 未知(rg_this_name_never_shipped)')
    expect(v.selectable, '名字查不到不影响这一格能不能读').toBe(true)
  })

  it('出身/音级缺格（v1 老档没有成长数据）⇒ 两格都写「未知」，不拿当前出身冒充', async () => {
    const { roster } = await rosterWith({ patch: (s) => ({ ...s, rpg: null }) })
    const card = await cardOf(roster, MANUAL_SLOTS[0])
    expect(card.data?.rank).toBeNull()
    expect(card.data?.originId).toBeNull()
    expect(saveCards([card])[0].lines[0]).toBe('音级 未知 · 出身 未知')
  })

  it('没有 savedAt 那一格（v9 及更早）⇒ 「时间未记录」而不是今天', async () => {
    const { roster } = await rosterWith({ now: () => 1770000000000, version: 9 })
    const card = await cardOf(roster, MANUAL_SLOTS[0])
    const [v] = saveCards([card])
    expect(v.badge).toBe('由 v9 升级')
    expect(v.lines[4]).toBe('时间未记录')
    expect(v.state).toBe('ok')
  })

  it('从 .prev 捡回来的档 ⇒ 黄标「已恢复备份」，且优先于升级标', async () => {
    const { roster, store } = await rosterWith({ now: () => 1770000000000 })
    const slot = MANUAL_SLOTS[0]
    // 先留一份好档在 .prev，再把主存位写坏：名册必须靠 .prev 出卡，并说清是从哪一格捡的
    store.raw.set(`${slot}.prev`, store.raw.get(slot)!)
    await store.set(slot, 'not-a-caesura-payload')
    const card = await cardOf(roster, slot)
    expect(card.state).toBe('restored')
    const [v] = saveCards([card])
    expect(v.badge).toBe('已恢复备份')
    expect(v.fromKey).toBe(`${slot}.prev`)
    expect(v.lines).toHaveLength(5)
  })

  it('坏档的每种原因都给得出原话：「读不出来 + 一句原话」，一格读数都不编', async () => {
    // 底子是一份真落盘的档：坏法各自只动一处，测的才是"那一条判据"而不是"这串字符很怪"
    const { store } = await rosterWith({ now: () => 1770000000000 })
    const env = JSON.parse(store.raw.get(MANUAL_SLOTS[0])!) as { magic: string; schemaVersion: number; crc: number; payload: unknown }
    const cases: Array<[string, string]> = [
      ['{ this is not even json', '存档文件读不出内容（可能不完整）'],
      [JSON.stringify({ ...env, magic: 'SOME-OTHER-GAME' }), '存档不是本游戏写的（文件头不认识）'],
      [JSON.stringify({ ...env, schemaVersion: 99 }), '不是本游戏能读的版本'],
      [JSON.stringify({ ...env, crc: env.crc ^ 0xff }), '存档文件已损坏']
    ]
    for (const [raw, text] of cases) {
      const bad = new MapStore()
      bad.raw.set(MANUAL_SLOTS[1], raw)
      const card = await cardOf(new SlotRoster(bad), MANUAL_SLOTS[1])
      expect(card.state, text).toBe('blocked')
      const [v] = saveCards([card])
      expect(v.lines, text).toEqual(['读不出来'])
      expect(v.note, text).toBe(text)
      expect(v.selectable, `坏档不许给"读取"，但卡片照旧渲染（原因要看得见）`).toBe(false)
    }
  })

  it('升级步骤缺失（v9→v10 那一步没了）⇒ ui-ux §8 点名的那句「版本过旧」', async () => {
    const { store } = await rosterWith({ version: 9 })
    const v9 = store.raw.get(MANUAL_SLOTS[0])!
    unregisterMigration(9)
    try {
      const bad = new MapStore()
      bad.raw.set(MANUAL_SLOTS[0], v9)
      const [v] = saveCards([await cardOf(new SlotRoster(bad), MANUAL_SLOTS[0])])
      expect(v.note).toBe('该存档版本过旧（缺少升级步骤）')
      expect(v.state).toBe('blocked')
    } finally {
      registerMigration(9, migrateV9toV10)
    }
    // 装回去之后同一格立刻可读：红的是那一步，不是这份测试自己
    const [back] = saveCards([await cardOf(new SlotRoster(store), MANUAL_SLOTS[0])])
    expect(back.state).toBe('ok')
    expect(back.badge).toBe('由 v9 升级')
  })

  it('空格 ⇒ 「空的」，并且它跟坏档不是同一句话', async () => {
    const card = await cardOf(new SlotRoster(new MapStore()), AUTOSAVE_SLOT)
    const [v] = saveCards([card])
    expect(v.state).toBe('empty')
    expect(v.lines).toEqual(['空的'])
    expect(v.note).toBeNull()
    expect(v.badge).toBeNull()
  })
})

describe('摘要卡：能做什么由宿主位置决定', () => {
  it('同一张手动卡在标题屏只给「读取」，在面板只给「写入/删除」', async () => {
    const { roster } = await rosterWith()
    const [v] = saveCards([await cardOf(roster, MANUAL_SLOTS[0])])
    const inTitle = saveCardHtml(v, ['load'])
    const inPanel = saveCardHtml(v, ['write', 'erase'])
    expect(inTitle).toContain('data-act="load"')
    expect(inTitle).not.toContain('data-act="write"')
    expect(inPanel).toContain('data-act="write"')
    expect(inPanel).toContain('data-act="erase"')
    expect(inPanel).not.toContain('data-act="load"')
    expect(inPanel).toContain('槽 I')
  })

  it('不可点的按钮照旧渲染但带 disabled 记号（按不动要看得见原因）', async () => {
    const store = new MapStore()
    const auto = saveCardHtml(saveCards([await cardOf(new SlotRoster(store), AUTOSAVE_SLOT)])[0], ['load', 'write', 'erase'])
    expect(auto).toContain('data-act="load" data-arg="autosave" data-disabled="1"')
    expect(auto).toContain('data-disabled="1">写入此处')
    const emptyManual = saveCardHtml(saveCards([await cardOf(new SlotRoster(store), MANUAL_SLOTS[2])])[0], ['write', 'erase'])
    expect(emptyManual, '空槽可以写，但没有东西可删').toContain('data-act="write" data-arg="slot3">写入此处')
    expect(emptyManual).toContain('data-act="erase" data-arg="slot3" data-disabled="1">删除')
  })

  it('坏档仍然可以写入——覆盖是唯一能把那一格救回来的动作', async () => {
    const store = new MapStore()
    await store.set(MANUAL_SLOTS[0], 'garbage')
    const [v] = saveCards([await cardOf(new SlotRoster(store), MANUAL_SLOTS[0])])
    expect(v.state).toBe('blocked')
    expect(saveCardHtml(v, ['write', 'erase'])).toContain('data-act="write" data-arg="slot1">写入此处')
  })
})

describe('读数的口径', () => {
  it('槽位标签：自动 / 槽 I II III，认不出的键位原样回显', () => {
    expect(slotLabel(AUTOSAVE_SLOT)).toBe('自动')
    expect(MANUAL_SLOTS.map(slotLabel)).toEqual(['槽 I', '槽 II', '槽 III'])
    expect(slotLabel('slot9')).toBe('slot9')
  })

  it('游玩时长：分秒都到位，不出现 0.6 小时这种要玩家自己换算的数', () => {
    expect(playText(0)).toBe('0秒')
    expect(playText(59)).toBe('59秒')
    expect(playText(60)).toBe('1分00秒')
    expect(playText(220)).toBe('3分40秒')
    expect(playText(3600)).toBe('1小时00分')
    expect(playText(3661)).toBe('1小时01分')
    expect(playText(-5), '负数不印成 -5秒').toBe('0秒')
  })

  it('时刻：本地时间两位补齐，缺格说「时间未记录」', () => {
    const d = new Date(2026, 8, 26, 9, 5)
    expect(savedAtText(d.getTime())).toBe('2026-09-26 09:05')
    expect(savedAtText(null)).toBe('时间未记录')
  })
})

/** 名字从表里现取：测试不许把显示名抄成第二个真值 */
function gearNameOfWeapon(weaponId: string): string {
  const hit = allGearItems().find((i) => i.gear?.weaponId === weaponId)
  if (!hit) throw new Error(`表里没有weaponId=${weaponId}的装备`)
  return hit.displayName
}
function originName(id: string): string {
  const prog = registry.get<{ origins: Array<{ id: string; displayName: string }> }>('progression')
  return prog.origins.find((o) => o.id === id)?.displayName ?? id
}

describe('摘要卡分支死角（批 15）：表查不到的 id 与黄标卡面的真腿', () => {
  it('出身 id 不在 progression 表 ⇒ 「出身 未知(id)」，与区域那格同一口径', async () => {
    const { roster } = await rosterWith({
      patch: (s) => ({
        ...s,
        rpg: { ...s.rpg!, progression: { ...s.rpg!.progression, originId: 'origin_never_shipped' } }
      })
    })
    const [v] = saveCards([await cardOf(roster, MANUAL_SLOTS[0])])
    expect(v.lines[0]).toContain('出身 未知(origin_never_shipped)')
    expect(v.selectable, '名字查不到不影响这一格能不能读').toBe(true)
  })

  it('武器 id 不在装备表 ⇒ 「武器 未知(id)」（名字是诊断，不是把键冒充成名字）', async () => {
    const { roster } = await rosterWith({
      patch: (s) => ({ ...s, player: { ...s.player, weaponId: 'wp_never_shipped' } })
    })
    const [v] = saveCards([await cardOf(roster, MANUAL_SLOTS[0])])
    expect(v.lines[1]).toBe('武器 未知(wp_never_shipped)')
  })

  it('regionId 缺格（老档没记区域）⇒ 「区域 未知」，如实空着不编名字', async () => {
    const { roster } = await rosterWith({ patch: (s) => ({ ...s, regionId: null }) })
    const [v] = saveCards([await cardOf(roster, MANUAL_SLOTS[0])])
    expect(v.lines[2]).toBe('区域 未知')
  })

  it('restored 卡的 HTML：黄标 span 与来源行都渲染（badge / fromKey 的真腿）', async () => {
    const { roster, store } = await rosterWith()
    const slot = MANUAL_SLOTS[0]
    store.raw.set(`${slot}.prev`, store.raw.get(slot)!)
    await store.set(slot, 'not-a-caesura-payload')
    const [v] = saveCards([await cardOf(roster, slot)])
    expect(v.badge).toBe('已恢复备份')
    expect(v.fromKey).toBe(`${slot}.prev`)
    const html = saveCardHtml(v, ['load'])
    expect(html).toContain('class="badge"')
    expect(html).toContain('已恢复备份')
    expect(html).toContain(`来源 ${slot}.prev`)
  })
})
