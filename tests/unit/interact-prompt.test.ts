import { describe, expect, it, beforeAll, afterEach, afterAll } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData, regions } from '@/data'
import { Interactables } from '@/world/Interactables'

/**
 * 交互提示要**点名那个东西**（KI-184）。
 *
 * **病**：提示一律是「动词 · 区域名」⇒ 玩家看到的是「交谈 · 休垒 Resthold」——
 * **区域名不是他要交互的东西**（休垒里有 40 多个可交互位）。而**名字本来就在数据里**：
 * NPC 的 `displayName` 住在 `npcs.json`（"铃姨"），只是没人读它。
 *
 * 实机走查读到的那一格（`?fresh=1` 冷启动 + 手动步进）：走到铃姨面前，
 * 提示是「交谈 · 休垒 Resthold」；修完是「交谈 · 铃姨」。
 */
beforeAll(() => { registerGameData() })

let seen: { text: string | null; id: string | null } | null = null
const off = bus.on('ui.prompt', (p) => { seen = { text: p.text, id: p.id } })

afterEach(() => { seen = null })
afterAll(() => { off() })

describe('交互提示点名那个东西（KI-184）', () => {
  it('NPC ⇒ 那个人的名字（数据侧现读，不抄第二份）', () => {
    const it = new Interactables(regions, () => true)
    // 休垒的铃姨在 (8, 0, 26)
    it.update({ x: 8, y: 0, z: 24.4 })
    expect(seen?.id, '焦点是铃姨').toBe('npc_belltongue')
    expect(seen?.text, '提示要点名那个人').toContain('铃姨')
    expect(seen?.text, '不该拿区域名当对象名').not.toContain('休垒')
    it.dispose()
  })

  it('非 NPC ⇒ 仍是区域名（那些交互位的 verb 已经在点名："察看第四口钟"）', () => {
    const it = new Interactables(regions, () => true)
    // 休垒的调音桩（checkpoint）在 (-12, 0, 18)
    it.update({ x: -12, y: 0, z: 17 })
    expect(seen?.id).toBe('st_resthold')
    expect(seen?.text, '非 NPC 的提示形状不变').toContain('休垒')
    it.dispose()
  })

  it('焦点离开 ⇒ 提示清空（不许留着上一句）', () => {
    const it = new Interactables(regions, () => true)
    it.update({ x: 8, y: 0, z: 24.4 })
    expect(seen?.text).toBeTruthy()
    it.update({ x: 500, y: 0, z: 500 })
    expect(seen?.text, '走开了就不该还挂着提示').toBeNull()
    it.dispose()
  })
})
