import { describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
import { resolveMarker } from '@/quest/Objectives'
import type { RegionData } from '@/data/schema'

/**
 * **序章目标**（KI-141）：开局到遇见铃姨之前，HUD 上要有一枚指向她的箭头。
 *
 * **病**：目标指示读的是"当前任务步的 marker"，而铃姨线**要跟她说话才开始**
 * （`DLG_BELLTONGUE` 的 n0 两个选项都带 `startQuest: q_bells`）⇒ 在那之前 HUD 空着，
 * 玩家在灰盒里只能自己乱转找那个白色人形。
 *
 * **落法**：区域行上多一个可选的 `prologueMarker`（形状与任务步的 marker 同一套），
 * 组合根在开跑时读它 ⇒ 箭头从第一帧就指着铃姨。
 */
registerGameData()

describe('序章目标（KI-141）', () => {
  it('休垒的序章指向铃姨（任务开始之前该先找的人）', () => {
    const hub = regions.find((r) => r.id === 'rg_resthold') as RegionData
    expect(hub.prologueMarker, '休垒要有序章指向').toBeTruthy()
    expect(hub.prologueMarker!.kind).toBe('npc')
    expect(hub.prologueMarker!.kind === 'npc' ? hub.prologueMarker!.id : null).toBe('npc_belltongue')
  })

  it('那一格解析得出世界坐标（箭头指得到人）', () => {
    const hub = regions.find((r) => r.id === 'rg_resthold') as RegionData
    const at = resolveMarker(hub.prologueMarker, regions as RegionData[])
    expect(at, '序章指向必须解析得出落点').not.toBeNull()
    // 落点应当就是那个交互位（铃姨站在休垒的 8/0/26）
    const npc = regions
      .flatMap((r) => r.interactables ?? [])
      .find((i) => i.npcId === 'npc_belltongue')
    expect(at!.x).toBeCloseTo(npc!.pos!.x, 6)
    expect(at!.z).toBeCloseTo(npc!.pos!.z, 6)
  })

  it('别的区没有序章指向时不装样子（那一格可以缺省）', () => {
    const others = regions.filter((r) => r.id !== 'rg_resthold')
    const withPrologue = others.filter((r) => r.prologueMarker !== undefined)
    expect(withPrologue.map((r) => r.id), '别的区要么也有序章、要么就空着（不许乱指）').toEqual(
      withPrologue.filter((r) => resolveMarker(r.prologueMarker, regions as RegionData[]) !== null).map((r) => r.id),
    )
  })
})
