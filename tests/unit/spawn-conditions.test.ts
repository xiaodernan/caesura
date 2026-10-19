import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { evalCondition } from '@/world/SpawnDirector'
import type { RegionData } from '@/data/schema'

/**
 * **破拍营地的「营长」**（KI-019 结案，KI-143 落成）。
 *
 * 设计（gameplay.md §254 破拍营地 ×1）：营长是悬钟骑士，**仅在强攻线交战**——
 * 潜行线不该惊动它。断弦线的营地定性三选一（`state.haltrune.camp`）就是那条分线：
 *   · OUTPOST（友军哨站）—— 巡逻停摆 ⇒ 营长不在
 *   · RUINS（废墟）      —— 军阵散了 ⇒ 营长不在
 *   · GARRISON（恩希尔驻防地）—— "营地仍有人守" ⇒ 营长在
 *
 * **机制**：刷怪闸门的条件语言扩了一格（`state.KEY==VALUE` / `state.KEY!=VALUE`）。
 * **没有状态读方 ⇒ 那一组不刷**（宁可少刷，不可刷错）。
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const regions = JSON.parse(readFileSync(root + 'src/data/json/regions.json', 'utf8')) as RegionData[]

const camp = regions.find((r) => r.id === 'rg_brokenbar_camp')!
const captain = camp.spawnGroups.find((g) => g.enemyId === 'en_hanged_knight')

describe('刷怪闸门的条件语言（KI-143）', () => {
  it('旗标两形逐字不动（老形不许被扩格改坏）', () => {
    const has = (k: string) => k === 'flag.x'
    expect(evalCondition('flag.x', has)).toBe(true)
    expect(evalCondition('!flag.x', has)).toBe(false)
    expect(evalCondition('flag.y', has)).toBe(false)
    expect(evalCondition('!flag.y', has)).toBe(true)
    expect(evalCondition('flag.x && !flag.y', has)).toBe(true)
    expect(evalCondition(undefined, has)).toBe(true)
    expect(evalCondition('', has)).toBe(true)
  })

  it('状态两形：等于 / 不等于', () => {
    const state = (k: string) => (k === 'state.haltrune.camp' ? 'GARRISON' : null)
    expect(evalCondition('state.haltrune.camp==GARRISON', () => false, state)).toBe(true)
    expect(evalCondition('state.haltrune.camp==RUINS', () => false, state)).toBe(false)
    expect(evalCondition('state.haltrune.camp!=RUINS', () => false, state)).toBe(true)
    expect(evalCondition('state.haltrune.camp!=GARRISON', () => false, state)).toBe(false)
  })

  it('没有状态读方 ⇒ 那一项不满足（宁可少刷，不可刷错）', () => {
    expect(evalCondition('state.haltrune.camp==GARRISON', () => false)).toBe(false)
    expect(evalCondition('state.haltrune.camp!=GARRISON', () => false), '读不到时"不等于"也不能算真').toBe(false)
  })

  it('写坏了的形状 ⇒ 不满足（数据门那边会红，这里不许猜）', () => {
    const state = () => 'GARRISON'
    expect(evalCondition('state.haltrune.camp', () => false, state)).toBe(false)
    expect(evalCondition('state.haltrune.camp==', () => false, state)).toBe(false)
  })

  it('旗与状态可以混在一个表达式里（&& 连接）', () => {
    const has = (k: string) => k === 'flag.resolved'
    const state = (k: string) => (k === 'state.haltrune.camp' ? 'GARRISON' : null)
    expect(evalCondition('flag.resolved && state.haltrune.camp==GARRISON', has, state)).toBe(true)
    expect(evalCondition('!flag.resolved && state.haltrune.camp==GARRISON', has, state)).toBe(false)
  })
})

describe('破拍营地的营长（KI-143）', () => {
  it('布点存在：悬钟骑士 ×1，带营地的编队与那条状态闸门', () => {
    expect(captain, '营长的布点').toBeDefined()
    expect(captain!.count).toBe(1)
    expect(captain!.campId).toBe('camp_brokenbar')
    expect(captain!.condition, '闸门问的是营地那条世界线').toBe('state.haltrune.camp==GARRISON')
  })

  it('只有强攻线（GARRISON）才刷：三条营地定性各刷/不刷一次', () => {
    const state = (v: string) => (_k: string) => v
    expect(evalCondition(captain!.condition, () => false, state('GARRISON')), 'GARRISON ⇒ 刷').toBe(true)
    expect(evalCondition(captain!.condition, () => false, state('OUTPOST')), 'OUTPOST ⇒ 不刷').toBe(false)
    expect(evalCondition(captain!.condition, () => false, state('RUINS')), 'RUINS ⇒ 不刷').toBe(false)
    expect(evalCondition(captain!.condition, () => false, state('INTACT')), 'INTACT（还没定性）⇒ 不刷').toBe(false)
  })

  it('营地定性三选一的旗标闸门照旧有效（老形不许被新形挤掉）', () => {
    const murkshell = camp.spawnGroups.find((g) => g.enemyId === 'en_murkshell')!
    expect(murkshell.condition, '普通兵在营地定性之前才在').toBe('!flag.brokenbar_resolved')
    expect(evalCondition(murkshell.condition, () => false)).toBe(true)
  })
})
