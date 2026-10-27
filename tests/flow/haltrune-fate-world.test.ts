import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions, worldStates as stateTable, worldstate } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Interactables } from '@/world/Interactables'
import { WorldState } from '@/quest/WorldState'
import { WorldStates } from '@/quest/WorldStates'

/**
 * 断弦线终局 fate 的世界读者（narrative §2.4 步 4 的完成后状态，STATE.HALTRUNE 的
 * 「营地夜声景」那半句的世界侧）：
 *  · **DRUM_LEGEND**：「他变成营地新传说：一个会自己打更的鼓，某些夜晚玩家路过真能听见」
 *    ——营地深处那面鼓成为可听的陈设（夜声景的**音频腿**是 AudioEngine 侧的环境层，
 *    本批落「路过能听见」的交互载体：走到跟前，按 E，那一声更在 verb 里）；
 *  · **PASSING_STILL**：用休止送走他——刑柱下安放的那条左臂（他断了几次的旧型号
 *    挂在同一根柱子上，C3 的七块石头就在旁边）。
 * fate 的三值变体（含 ALIVE_AT_POST 缺省）：三个世界各有一件只有自己在场的东西。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const states = new WorldStates(stateTable)
  // **stateSet 那一半也得在场**：fate 落到 DRUM_LEGOND 时，「旗」不是凭空立起来的——
  // 它由 `worldstate.json` 里那条 stateSet 规则派生（`state.haltrune.fate ∈ {DRUM_LEGEND}`
  // ⇒ `flag.haltrune_drum`），而跑那条规则的是 `WorldState`（`WorldStates` 只是那张登记表）。
  // 少建这一个 ⇒ 旗永远不立 ⇒ 那面鼓（`requiresFlag`）永远不在场——而这正是本批要量的那一格。
  const worldState = new WorldState(worldstate, {
    hasFlag: (k) => streaming.hasFlag(k),
    setFlag: (k) => streaming.setFlag(k, true)
  })
  const interact = new Interactables(regions, () => true, 6, (req) => states.get(req.key) === req.value)
  const nearby = (pos: { x: number; y: number; z: number }): string[] => interact.nearby(pos).map((x) => x.id)
  const use = (id: string): { ok: boolean } => interact.use(id, { ...interact.all.find((x) => x.id === id)!.pos })
  const cleanup = () => { interact.dispose(); worldState.dispose(); states.dispose(); streaming.dispose() }
  alive.push(cleanup)
  return { states, nearby, use, cleanup }
}

describe('断弦终局 fate 的世界读者：三个世界各有一件只有它在场的东西', () => {
  it('DRUM_LEGOND ⇒ 营地深处那面自己打更的鼓在场；别的世界没有', () => {
    const w = makeWorld()
    expect(w.nearby({ x: -100, y: 0, z: -330 })).not.toContain('st_brokenbar_nightdrum')
    w.states.set('state.haltrune.fate', 'DRUM_LEGEND')
    expect(w.nearby({ x: -100, y: 0, z: -330 }), '传说成真：那面鼓在').toContain('st_brokenbar_nightdrum')
    expect(w.use('st_brokenbar_nightdrum').ok).toBe(true)
    w.cleanup()
  })

  it('PASSING_STILL ⇒ 刑柱下安放的那条左臂在场（C3 的七块石头就在旁边）', () => {
    const w = makeWorld()
    expect(w.nearby({ x: -118, y: 0, z: -322 })).not.toContain('st_brokenbar_stilledarm')
    w.states.set('state.haltrune.fate', 'PASSING_STILL')
    expect(w.nearby({ x: -118, y: 0, z: -322 })).toContain('st_brokenbar_stilledarm')
    expect(w.use('st_brokenbar_stilledarm').ok).toBe(true)
    // 刑柱本体（它一直挂着旧臂）与安放的臂在同一点附近共存——一个是遗迹，一个是告别
    w.cleanup()
  })

  it('ALIVE_AT_POST（没走到告别）：两件都不在——传说与安息都属于已收束的线', () => {
    const w = makeWorld()
    expect(w.nearby({ x: -100, y: 0, z: -330 })).not.toContain('st_brokenbar_nightdrum')
    expect(w.nearby({ x: -118, y: 0, z: -322 })).not.toContain('st_brokenbar_stilledarm')
    w.cleanup()
  })
})
