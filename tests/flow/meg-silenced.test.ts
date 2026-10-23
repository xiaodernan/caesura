import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions, worldstate } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Interactables } from '@/world/Interactables'
import { WorldState } from '@/quest/WorldState'
import { WorldStates } from '@/quest/WorldStates'
import { worldStates as stateTable } from '@/data'

/**
 * 盐歌 SILENCED 的世界读者（narrative §2.3 完成后状态：「她当夜收拾摊子离开」）。
 *
 * 在这一批之前，夺走声卷只写值域——任务收束了、她的人还站在休垒市集里原地兜售。
 * 本批落的两个机器形状：
 *  · **`stateSet` 规则**（worldstate 引擎的第 4 种触发）：值域落进关注的几格 ⇒ 派生旗。
 *    与旗标那三条同一条纪律（只听广播、幂等、真值一份）——值域记"走到哪一格"，
 *    旗记"发生过没有"，规则是把前者翻译成后者的那一句话。
 *  · **`absentFlag`**（交互物的不在场旗）：旗立 ⇒ 这件东西从世界里**消失**（收摊/撤离/沉没）。
 *    与 requiresState 的方向相反：那格说"走到哪一格时它在场"，这格说"发生了哪件事之后
 *    它不在"。缺席不是锁——nearby 不进、灰盒不画、use 拒收，比 locked 更彻底一档。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const interact = new Interactables(regions, () => true, 6, (req) => states.get(req.key) === req.value)
  const states = new WorldStates(stateTable)
  const worldState = new WorldState(worldstate, {
    hasFlag: (k) => streaming.hasFlag(k),
    setFlag: (k) => streaming.setFlag(k, true)
  })
  const at = (id: string): { x: number; y: number; z: number } => ({ ...interact.all.find((x) => x.id === id)!.pos })
  const use = (id: string): { ok: boolean; state: string; text?: string } => interact.use(id, at(id))
  const nearbyIds = (): string[] => interact.nearby(at('npc_meg')).map((x) => x.id)
  alive.push(() => { interact.dispose(); worldState.dispose(); states.dispose(); streaming.dispose() })
  const cleanup = (): void => { interact.dispose(); worldState.dispose(); states.dispose(); streaming.dispose() }
  return { streaming, interact, states, worldState, use, nearbyIds, at, cleanup }
}

describe('盐歌 SILENCED 的世界读者：值域落格 ⇒ 派生旗 ⇒ 她不在了', () => {
  it('stateSet 规则：SILENCED 落格 ⇒ flag.meg_gone 由规则立起（幂等：落两遍只立一次）', () => {
    const w = makeWorld()
    expect(w.streaming.hasFlag('flag.meg_gone')).toBe(false)
    w.states.set('state.meg.ending', 'SILENCED')
    expect(w.streaming.hasFlag('flag.meg_gone'), '值域那一格被翻译成旗——旗的既有读方零改动').toBe(true)
    w.states.set('state.meg.ending', 'SILENCED')
    expect(w.streaming.hasFlag('flag.meg_gone')).toBe(true)
    w.cleanup?.()
  })

  it('非 SILENCED 的落格不触发（说服/放弃/别的域都是她还在的世界）', () => {
    const w = makeWorld()
    w.states.set('state.meg.ending', 'CONVINCED')
    w.states.set('state.meg.ending', 'RELINQUISHED')
    w.states.set('state.haltrune.camp', 'OUTPOST')
    expect(w.streaming.hasFlag('flag.meg_gone'), '规则只认自己列的那几格').toBe(false)
  })

  it('缺席不是锁：她走后 nearby 不进、use 拒收（「已经不在了」而不是「状态未到」）', () => {
    const w = makeWorld()
    expect(w.nearbyIds()).toContain('npc_meg')
    w.states.set('state.meg.ending', 'SILENCED')
    expect(w.nearbyIds(), 'nearby 里没有她了——E 键根本不聚焦').not.toContain('npc_meg')
    const r = w.use('npc_meg')
    expect(r.ok).toBe(false)
    expect(r.text).toBe('已经不在了')
  })

  it('收摊之后的痕迹：卷起的摊布（requiresFlag 正向读者）恰好在她走后才在场', () => {
    const w = makeWorld()
    expect(w.nearbyIds()).not.toContain('in_resthold_meg_stall_rolled')
    w.states.set('state.meg.ending', 'SILENCED')
    expect(w.nearbyIds(), '她走了 ⇒ 摊布留下').toContain('in_resthold_meg_stall_rolled')
    const r = w.use('in_resthold_meg_stall_rolled')
    expect(r.ok).toBe(true)
  })

  it('读档态（旗先于世界存在）：absentFlag 的读数判定不靠事件重放', () => {
    const w = makeWorld()
    w.streaming.setFlag('flag.meg_gone', true) // 读档路径：旗已在，没有广播可听
    expect(w.nearbyIds(), '读档判定走 hasFlag 读数').not.toContain('npc_meg')
  })
})
