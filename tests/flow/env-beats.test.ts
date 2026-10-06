import { describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
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
