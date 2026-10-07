import { describe, expect, it } from 'vitest'
import { registerGameData, regions, worldstate } from '@/data'
import type { RegionData } from '@/data/schema'

/**
 * 环境叙事节拍（需求 §29「每区域 ≥4 条**不用一个字讲完的故事**」）的**落地守卫**。
 *
 * 为什么需要它：§4 的节拍表住 `docs/narrative.md`，落地形态是 `regions.json > interactables[kind='inspect']`
 * （只给一个"看什么"的动词，不讲出来的话靠场景被看见）。此前"某区落了几条"是**人眼核对的**——
 * 一条节拍被谁误删、或某个节点的 `pos.y` 飘离地板，没有任何东西会响。
 * 本文件把两件事钉住：
 *  ① **落地的节拍还在**（逐条点名，按区）；② **它们站在自己那块地板上**（`y === groundY`）。
 *
 * 口径说明：本表只登记**已落地**的节拍。§4 里"要真几何/敌人布置/光照"的那一族
 * （F1 坠落沟壑、W1 童谣树、W3/W4 漂调者与陷阱、C1 巡逻军阵、C4 停拍光照、E1 声音尸体、
 * E3 音色晶倾角、H2 凝声极光、H3 回廊刻拍号）**故意不在表里**——它们不是数据能兑现的，
 * 登记进这张表只会让守卫替一件做不到的事背书（KI-008）。
 */

registerGameData()

/** 已落地的节拍：区 → [节拍号, 节点 id]（节拍号照 `narrative.md §4` 的编号） */
const LANDED: Record<string, Array<[string, string]>> = {
  rg_resthold: [
    ['R1', 'in_resthold_gate_hooks'],
    ['R2', 'in_resthold_dome_reflection'],
    ['R3', 'in_resthold_forge_chimney'],
    ['R4', 'in_resthold_noticeboard'],
  ],
  rg_whisperwode: [
    ['W2', 'in_whisperwode_pickcamp'],
    ['W5', 'in_whisperwode_shrine'],
  ],
  rg_fellcarillon: [
    ['F2', 'in_fellcarillon_chisel_marks'],
    ['F3', 'it_fellcarillon_hanged_remains'],
    ['F4', 'in_fellcarillon_cliff_platform'],
  ],
  rg_drowned_choir: [
    ['D1', 'in_choir_choir_positions'],
    ['D2', 'in_choir_nameplate_wall'],
    ['D3', 'dc_corvin_cage'],
    ['D4', 'in_choir_organ_stop'],
    ['D5', 'in_drownedchoir_d5_scratch'],
  ],
  rg_brokenbar_camp: [
    ['C2', 'in_brokenbar_sandtable'],
    ['C3', 'in_brokenbar_execution_post'],
    ['C5', 'in_brokenbar_kitchen'],
  ],
  rg_earless_deeps: [
    ['E2', 'in_deeps_knock_plates'],
    ['E4', 'in_deeps_transcript_room'],
    ['E5', 'in_deeps_child_drawings'],
  ],
  rg_unfinished_hall: [
    ['H1', 'in_unfinishedhall_key_208'],
    ['H4', 'in_unfinishedhall_old_robe'],
  ],
}

/** 每区至少要有的节拍条数（§29 的下限是 4；不够 4 的区把差额写在这里当欠账，别装作达标） */
const FLOOR: Record<string, number> = {
  rg_resthold: 4,
  rg_whisperwode: 2,
  rg_fellcarillon: 3,
  rg_drowned_choir: 5,
  rg_brokenbar_camp: 3,
  rg_earless_deeps: 3,
  rg_unfinished_hall: 2,
}

const byId = new Map<string, RegionData>(regions.map((r) => [r.id, r]))

describe('环境叙事节拍（§4 / §29）：落地的还在，且站在自己的地板上', () => {
  it('逐条点名：每条已落地的节拍都在它那一区里，而且是可读的研读点', () => {
    for (const [regionId, beats] of Object.entries(LANDED)) {
      const region = byId.get(regionId)
      expect(region, `${regionId} 应当在 regions.json 里`).toBeTruthy()
      const ids = new Set(region!.interactables.map((i) => i.id))
      for (const [beat, nodeId] of beats) {
        expect(ids.has(nodeId), `${regionId} 的 §4.${beat} 节拍（${nodeId}）不该消失`).toBe(true)
        const node = region!.interactables.find((i) => i.id === nodeId)!
        expect(node.kind, `${nodeId} 是"看什么"的载体（研读点）`).toBe('inspect')
        expect(node.verb, `${nodeId} 必须给出一个"看什么"的动词`).toBeTruthy()
      }
    }
  })

  it('它们站在自己那块地板上（y === groundY），不会飘到半空或埋进地里', () => {
    for (const [regionId, beats] of Object.entries(LANDED)) {
      const region = byId.get(regionId)!
      for (const [beat, nodeId] of beats) {
        const node = region.interactables.find((i) => i.id === nodeId)!
        expect(node.pos.y, `${regionId} §4.${beat}（${nodeId}）应当站在 groundY=${region.groundY}`)
          .toBe(region.groundY)
      }
    }
  })


  it('§4.1 R3 是这一区唯一**带条件**的节拍：烟囱只在第一口钟修好之后才出现在世界里', () => {
    const rest = byId.get('rg_resthold')!
    const chimney = rest.interactables.find((i) => i.id === 'in_resthold_forge_chimney')!
    // 它的意义全在那道闸门上（"熄了七十三天的烟囱重新冒烟"）；闸门被谁摘掉，它就退化成一句普通陈设
    expect(chimney.requiresFlag, 'R3 的闸门').toBe('flag.bell_first_repaired')

    // 反向：§4.1 其余三条是纯陈列（无闸门）——"唯一带条件的那一条"这句话本身也要被量
    for (const [beat, id] of LANDED.rg_resthold) {
      if (id === 'in_resthold_forge_chimney') continue
      const node = rest.interactables.find((i) => i.id === id)!
      expect(node.requiresFlag, `§4.1 ${beat} 应当是无条件陈列`).toBeUndefined()
      expect(node.requiresState, `§4.1 ${beat} 应当是无条件陈列`).toBeUndefined()
    }
  })

  it('每区的条数不低于它登记的下限（§29 的 4 条是目标，差额写在下限表里当欠账）', () => {
    for (const [regionId, floor] of Object.entries(FLOOR)) {
      const landed = (LANDED[regionId] ?? []).length
      expect(landed, `${regionId} 已落 ${landed} 条，下限 ${floor}`).toBeGreaterThanOrEqual(floor)
    }
  })

  it('这张表自己不许说谎：登记的节点 id 在两区之间不重复，且每条都能在真表里找到', () => {
    const seen = new Map<string, string>()
    for (const [regionId, beats] of Object.entries(LANDED)) {
      for (const [, nodeId] of beats) {
        expect(seen.has(nodeId), `${nodeId} 同时挂在 ${seen.get(nodeId)} 与 ${regionId}`).toBe(false)
        seen.set(nodeId, regionId)
      }
    }
    // 反向：表里每个区都必须是真存在的区
    for (const regionId of Object.keys(LANDED)) expect(byId.has(regionId), `${regionId} 存在`).toBe(true)
  })
})

describe('§4.8 初句圣所：五环线索链的每一环都要有写方（KI-091 的claim，由这道守卫钉住）', () => {
  const DEEP = 'rg_earless_deeps'
  /** 那扇门要的四面线索旗（照 `regions.json` 的 `requiresFlags` 合取） */
  const CLUES = [
    'flag.clue_reverse_score',
    'flag.clue_dome_reflection',
    'flag.clue_d5_scratch',
    'flag.clue_lean_corpses',
  ]

  it('那扇门在深窖里，而且它要的正是那四面旗（合取闸门，不是"走近就开"）', () => {
    const deep = byId.get(DEEP)!
    const door = deep.interactables.find((i) => i.id === 'ga_deeps_firstphrase_door')
    expect(door, '门不该消失').toBeTruthy()
    expect(door!.kind).toBe('gate')
    expect([...door!.requiresFlags ?? []].sort()).toEqual([...CLUES].sort())
  })

  it('每一面线索旗都有写方（worldstate 规则），没有一面是"只被读、没人写"', () => {
    const written = new Set<string>()
    for (const rule of worldstate) {
      const f = (rule as { setFlag?: string }).setFlag
      if (f) written.add(f)
    }
    for (const clue of CLUES) {
      expect(written.has(clue), `${clue} 必须有写方（否则这扇门永远开不了）`).toBe(true)
    }
  })

  it('门后那个拓印箱还在，且带着自己的 secretId（写方与领取点成对）', () => {
    const deep = byId.get(DEEP)!
    const chest = deep.interactables.find((i) => i.id === 'ch_first_phrase')
    expect(chest, '拓印点不该消失').toBeTruthy()
    expect(chest!.secretId, '领取点必须挂回 secret').toBeTruthy()
    expect(chest!.verb, '它要有一个"拓下石刻上的初句"这样的动词').toBeTruthy()
  })

  it('"五环"这个说法要能对上数据：4 面线索旗 + 1 扇门 + 1 个拓印点（文档叫它五环，别让它悬着）', () => {
    const deep = byId.get(DEEP)!
    const gate = deep.interactables.find((i) => i.id === 'ga_deeps_firstphrase_door')!
    const chest = deep.interactables.find((i) => i.id === 'ch_first_phrase')!
    const clueFlags = [...(gate.requiresFlags ?? [])]
    // 四环 = 门要的那四面旗；第五环 = 门自己（"以休止轻触井底的门"那一下），
    // 而拓印点是它的**领取点**（KI-087：写方与领取点成对，缺哪一半都不算）
    expect(clueFlags.length, '门要的线索旗数').toBe(4)
    expect(gate.kind, '第五环是那扇门本身').toBe('gate')
    expect(chest.kind, '拓印点').toBe('chest')
    expect(chest.secretId, '拓印点挂着 secret').toBeTruthy()
    // 四环各自都要有写方（worldstate 规则）—— 与上一组断言同源，这里按"环"的读法再钉一次
    const written = new Set<string>()
    for (const rule of worldstate) {
      const f = (rule as { setFlag?: string }).setFlag
      if (f) written.add(f)
    }
    for (const clue of clueFlags) expect(written.has(clue), `线索旗 ${clue} 的写方`).toBe(true)
  })

  it('链尾有后果：拓下初句之后那面旗要打开一个**带奖励的 secret**（不是一个只进背包的奖励）', () => {
    // 上一轮我先把它写成"遍历 interactables 找 unlockFlag"——`tsc` 当场否掉了那个字段
    // （`InteractableRef` 上没有 `unlockFlag`）。**读方住在 `regions[].secrets[]`**：
    // `{ id, unlockFlag, rewardTable, pos }`。这条断言就是那次错假设的正确形状。
    const written = new Set<string>()
    for (const rule of worldstate) {
      const f = (rule as { setFlag?: string }).setFlag
      if (f) written.add(f)
    }
    expect(written.has('flag.found_first_phrase'), '写方：worldstate 规则').toBe(true)

    const secret = regions
      .flatMap((r) => r.secrets ?? [])
      .find((x) => x.unlockFlag === 'flag.found_first_phrase')
    expect(secret, '读方：深窖里那个 secret 拿它当解锁闸门').toBeTruthy()
    expect(secret!.rewardTable, '链尾必须通向一份奖励（否则这条链只是多了一件道具）').toBeTruthy()
  })
})

describe('营地三形态（§7 STATE.CAMP / KI-081）：每一种都要有**看得见**的一处', () => {
  it('OUTPOST 与 GARRISON 各有一处陈设按值域换组，闸门钉在正确的值上、且站在地板上', () => {
    const camp = byId.get('rg_brokenbar_camp')!
    const byState = (v: string) =>
      camp.interactables.filter((i) => i.requiresState?.value === v).map((i) => i.id)

    // 正向：两态各一处，且**点名到 id**（不是"有几处"这种糊涂话）
    expect(byState('OUTPOST')).toEqual(['in_brokenbar_outpost_banner'])
    expect(byState('GARRISON')).toEqual(['in_brokenbar_garrison_post'])

    // 反向：这两处**只在营地定了之后**才在场 —— 闸门键必须是那格值域、kind 必须是研读点、必须站在地板上
    for (const v of ['OUTPOST', 'GARRISON']) {
      for (const id of byState(v)) {
        const n = camp.interactables.find((i) => i.id === id)!
        expect(n.requiresState!.key, `${id} 的闸门键`).toBe('state.haltrune.camp')
        expect(n.kind, `${id} 是"看什么"的载体`).toBe('inspect')
        expect(n.pos.y, `${id} 站在营地的地板上`).toBe(camp.groundY)
      }
    }
    // 而缺省态（还没替他填名册）下这两处都不在场：值域是 INTACT 时上面两条 `byState` 都是空集
    expect(camp.interactables.some((i) => i.requiresState?.value === 'INTACT')).toBe(false)
  })
})
