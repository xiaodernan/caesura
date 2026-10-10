import { describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
import { Interactables } from '@/world/Interactables'

/**
 * KI-105：Interactables.within —— Observe（观察波）的读方。
 *
 * 它和 `nearby` 共用同一套过滤口径（区域闸 / 消耗 / 值域 / `used`），差别只有两处：
 * 半径是调用方给的（观察 26m ≠ 交互 2m）且**不排序**（标记环不排座次）。
 * 四条过滤一视同仁——"不在场的东西显不了形"，所以这里逐条钉死。
 */

registerGameData()

const at = { x: 0, y: 0, z: 0 }

/** 在第一个区域里造一只测试用的交互物：坐标可挪、闸门可加（region0 原有交互物全清场） */
function regionWithInteractable(over: Record<string, unknown>) {
  const rg = structuredClone(regions[0])
  const pos = (over.pos as { x: number; y: number; z: number } | undefined) ?? { x: 0, y: 0, z: 0 }
  rg.interactables = [{ id: 'ga_lab', kind: 'chest', pos, ...over }]
  return [rg]
}

describe('Interactables.within：观察波的目标名单', () => {
  it('半径由调用方给：2m 内没有、26m 内就有（nearby 的 2m 不是观察的半径）', () => {
    const it = new Interactables(regionWithInteractable({ pos: { x: 10, y: 0, z: 0 } }), () => true)
    expect(it.within(at, 2), '10m 外的东西在 2m 半径里').toEqual([])
    expect(it.within(at, 26).map((i) => i.id), '观察的 26m 看得见它').toEqual(['ga_lab'])
    it.dispose()
  })

  it('过滤口径与 nearby 逐字相同：区域闸 / 消耗 / 值域三闸，旗标不决定在不在场', () => {
    // 区域关 ⇒ 什么都看不见
    const shut = new Interactables(regionWithInteractable({ pos: at }), () => false)
    expect(shut.within(at, 26), '区域没通路 ⇒ 不在场 ⇒ 显不了形').toEqual([])
    shut.dispose()

    // 一次性物用完 ⇒ 不在场
    const used = new Interactables(regionWithInteractable({ pos: at }), () => true)
    expect(used.use('ga_lab', at).ok, '先确认能用').toBe(true)
    expect(used.within(at, 26), '用过了就退场').toEqual([])
    used.dispose()

    // 旗标闸**不决定在不在场**（只改成色）：缺旗时仍在名单里，锁由 use 拒绝
    const gate = new Interactables(regionWithInteractable({ pos: at, requiresFlags: ['flag.lab.a', 'flag.lab.b'] }), () => true)
    gate.setFlag('flag.lab.a')
    expect(gate.within(at, 26).map((i) => i.id), '旗标不改在场性：缺一面也仍看得见').toEqual(['ga_lab'])
    expect(gate.use('ga_lab', at).ok, '看得见但按不动（lock 归 use 那一侧退）').toBe(false)
    gate.setFlag('flag.lab.b')
    expect(gate.use('ga_lab', at).ok, '旗齐了才真能用').toBe(true)
    gate.dispose()
  })

  it('值域闸（requiresState）也管：未到的读数看不见，到了才显形', () => {
    const rg = structuredClone(regions[0])
    rg.interactables = [{
      id: 'ga_state', kind: 'inspect', pos: { x: 0, y: 0, z: 0 },
      requiresState: { key: 'state.observe.gate', value: 'open' }
    }]
    // 值域闸是注入的回调（胶水层）：改读数 = 换一个 gate 开关
    const shut = new Interactables([rg], () => true, 6, () => false)
    expect(shut.within(at, 26), '值域未到 ⇒ 不在场').toEqual([])
    shut.dispose()
    const open = new Interactables([rg], () => true, 6, () => true)
    expect(open.within(at, 26).map((i) => i.id), '值域到了才看得见').toEqual(['ga_state'])
    open.dispose()
    // 缺省 gate（不注入）= 一律视作锁住：没给读方的交互物宁可不开
    const dflt = new Interactables([rg], () => true)
    expect(dflt.within(at, 26), '没给读方 ⇒ 看不见').toEqual([])
    dflt.dispose()
  })

  it('不排序：名单顺序就是表里的顺序（标记环不排座次）', () => {
    const rg = structuredClone(regions[0])
    rg.interactables = [
      { id: 'ga_far', kind: 'chest', pos: { x: 20, y: 0, z: 0 } },
      { id: 'ga_near', kind: 'chest', pos: { x: 2, y: 0, z: 0 } }
    ]
    const it = new Interactables([rg], () => true)
    expect(it.within(at, 26).map((i) => i.id), '不按距离排：远的在前就远的在前').toEqual(['ga_far', 'ga_near'])
    it.dispose()
  })
})