import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveMarker, unresolvedMarkers } from '@/quest/Objectives'
import { regions } from '@/data'
import type { QuestData, RegionData } from '@/data/schema'

/**
 * **目标指示**的对账门（KI-137）。
 *
 * 玩家醒来后知道"要干什么"却不知道"往哪走"——任务行（KI-113②）回答了前半句，
 * 这一件回答后半句：当前目标在世界里的哪一个点。
 *
 * 三条纪律：
 *  · 指示只由**数据**说（任务步上的 `marker`），引擎不写死任何一处目标；
 *  · 指示必须**解析得出落点**（拼错的 npc/交互物/区域 id ⇒ 那个箭头永远指不到东西）；
 *  · 解析不出的就**不画**（返回 null），不许静默落到 (0,0,0)——那会让箭头指向世界的原点。
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const quests = JSON.parse(readFileSync(root + 'src/data/json/quests.json', 'utf8')) as QuestData[]

describe('目标指示（KI-137）', () => {
  it('每一步的 marker 都解析得出落点（表里不许留指向虚空的箭头）', () => {
    const markers = quests.flatMap((q) => q.steps.map((s) => s.marker))
    expect(markers.length, '带 marker 的步骤数').toBeGreaterThan(0)
    const bad = unresolvedMarkers(markers, regions as RegionData[])
    expect(
      bad.map((m) => `${m.kind}:${m.id ?? JSON.stringify(m.pos)}`),
      '这些指示解析不出落点（id 拼错了，或那个世界里没有这个东西）',
    ).toEqual([])
  })

  it('npc 指示落在那个人在世界里的位置（休垒的铃姨）', () => {
    const at = resolveMarker({ kind: 'npc', id: 'npc_belltongue' }, regions as RegionData[])
    expect(at, '铃姨在世界里有位置').not.toBeNull()
    const npc = regions.flatMap((r) => r.interactables ?? []).find((i) => i.npcId === 'npc_belltongue')
    expect(at).toEqual({ x: npc?.pos?.x, y: npc?.pos?.y, z: npc?.pos?.z })
  })

  it('区域指示落在那一区的中心（跨区目标只能指到"大概在哪儿"）', () => {
    const at = resolveMarker({ kind: 'region', id: 'rg_earless_deeps' }, regions as RegionData[])
    const rg = regions.find((r) => r.id === 'rg_earless_deeps')
    expect(at).toEqual({
      x: (rg!.bounds.minX + rg!.bounds.maxX) / 2,
      y: (rg!.bounds.minY + rg!.bounds.maxY) / 2,
      z: (rg!.bounds.minZ + rg!.bounds.maxZ) / 2,
    })
  })

  it('交互物指示落在那个交互物上', () => {
    const first = regions.flatMap((r) => r.interactables ?? []).find((i) => i.id && i.pos)
    expect(first, '世界里至少有一个带位置的交互物').toBeDefined()
    const at = resolveMarker({ kind: 'interact', id: first!.id! }, regions as RegionData[])
    expect(at).toEqual({ x: first!.pos!.x, y: first!.pos!.y, z: first!.pos!.z })
  })

  it('就地坐标那一形：pos 指示直接给世界坐标', () => {
    const at = resolveMarker({ kind: 'pos', pos: { x: 1, y: 2, z: 3 } }, regions as RegionData[])
    expect(at).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('认不出就返回 null（不猜、不落到原点）', () => {
    expect(resolveMarker(undefined, regions as RegionData[])).toBeNull()
    expect(resolveMarker({ kind: 'npc', id: 'npc_not_exist' }, regions as RegionData[])).toBeNull()
    expect(resolveMarker({ kind: 'region', id: 'rg_not_exist' }, regions as RegionData[])).toBeNull()
    expect(resolveMarker({ kind: 'interact', id: 'nope' }, regions as RegionData[])).toBeNull()
    expect(resolveMarker({ kind: 'pos' }, regions as RegionData[]), '缺坐标的 pos 指示').toBeNull()
    expect(resolveMarker({ kind: 'npc' }, regions as RegionData[]), '缺 id 的指示').toBeNull()
    expect(resolveMarker({ kind: '随便什么' }, regions as RegionData[]), '未知种类').toBeNull()
  })

  it('五种任务线都至少有一步带指示（每条线都得让玩家知道往哪走）', () => {
    for (const q of quests) {
      const withMarker = q.steps.filter((s) => s.marker).length
      expect(withMarker, `${q.id} 没有任何一步带指示`).toBeGreaterThan(0)
    }
  })
})
