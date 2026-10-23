import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions, worldstate, worldStates as stateTable } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Interactables } from '@/world/Interactables'
import { WorldState } from '@/quest/WorldState'
import { WorldStates } from '@/quest/WorldStates'

/**
 * 无面童线的两个世界后果（narrative §2.5 完成后状态 + 失败分支的最后一格）：
 *  · **「全休垒孩子开始模仿它在地上画谱（不论结局）」**——identity 写定（VESSEL/CHILD/
 *    CHOSEN 任一）⇒ 水缸边出现孩子画谱的陈设（三个值变体：科温笼子/广场钟架同款
 *    「同位置变体、不成立的不在场」模式）；
 *  · **LOST 的「它某夜自行走进哑带」+「地上再没有孩子画谱」**——LOST 落格 ⇒
 *    `stateSet` 规则派生 `flag.faceless_gone` ⇒ 无面童本人 `absentFlag` 缺席；
 *    而孩子画谱变体只认三个非 LOST 值 ⇒ LOST 的世界里两张都没有。
 * 这是盐歌收摊批立的两台原语（stateSet/absentFlag）的第二次消费——原语的复用性
 * 本身就是那批的验证：第二家读者零引擎改动。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const states = new WorldStates(stateTable)
  const interact = new Interactables(regions, () => true, 6, (req) => states.get(req.key) === req.value)
  const worldState = new WorldState(worldstate, {
    hasFlag: (k) => streaming.hasFlag(k),
    setFlag: (k) => streaming.setFlag(k, true)
  })
  const at = (id: string) => ({ ...interact.all.find((x) => x.id === id)!.pos })
  const nearby = (pos: { x: number; y: number; z: number }): string[] => interact.nearby(pos).map((x) => x.id)
  alive.push(() => { interact.dispose(); worldState.dispose(); states.dispose(); streaming.dispose() })
  const cleanup = (): void => { interact.dispose(); worldState.dispose(); states.dispose(); streaming.dispose() }
  return { streaming, states, interact, nearby, at, cleanup }
}

const CHILD_SCORES = ['st_plaza_children_scores_vessel', 'st_plaza_children_scores_child', 'st_plaza_children_scores_chosen']

describe('无面童的两个世界后果：孩子画谱（不论结局）与走进哑带（LOST）', () => {
  it('identity 写定的三个非 LOST 值 ⇒ 水缸边各有各的画谱变体（同位置不抢格子）', () => {
    for (const value of ['VESSEL', 'CHILD', 'CHOSEN'] as const) {
      const w = makeWorld()
      w.states.set('state.faceless.identity', value)
      const got = w.nearby({ x: -22, y: 0, z: 10 }).filter((id) => CHILD_SCORES.includes(id))
      expect(got, `${value} ⇒ 只有自己的那份画谱（变体互斥）`).toEqual([`st_plaza_children_scores_${value.toLowerCase()}`])
      w.cleanup()
    }
  })

  it('INTACT（还没走到抉择）与 LOST ⇒ 水缸边没有画谱（「不论结局」的精确读法：非 LOST 的三个成色）', () => {
    const w1 = makeWorld()
    expect(w1.nearby({ x: -22, y: 0, z: 10 }).filter((id) => CHILD_SCORES.includes(id))).toEqual([])
    w1.cleanup()
    const w2 = makeWorld()
    w2.states.set('state.faceless.identity', 'LOST')
    expect(w2.nearby({ x: -22, y: 0, z: 10 }).filter((id) => CHILD_SCORES.includes(id)), 'LOST ⇒ 地上再没有孩子画谱').toEqual([])
    w2.cleanup()
  })

  it('LOST ⇒ 它走进哑带：stateSet 派生 faceless_gone，无面童本人缺席（第二台 absentFlag 读者）', () => {
    const w = makeWorld()
    const atFc = w.at('npc_faceless')
    expect(w.nearby(atFc)).toContain('npc_faceless')
    expect(w.streaming.hasFlag('flag.faceless_gone')).toBe(false)
    w.states.set('state.faceless.identity', 'LOST')
    expect(w.streaming.hasFlag('flag.faceless_gone'), '同一台 stateSet 原语、第二条规则').toBe(true)
    expect(w.nearby(atFc), '它不在水缸边了').not.toContain('npc_faceless')
    const r = w.interact.use('npc_faceless', atFc)
    expect(r.ok).toBe(false)
    expect(r.text).toBe('已经不在了')
    w.cleanup()
  })

  it('写定非 LOST 的世界它还在（缺席只属于走进哑带那一种结局）', () => {
    const w = makeWorld()
    w.states.set('state.faceless.identity', 'CHILD')
    expect(w.streaming.hasFlag('flag.faceless_gone')).toBe(false)
    expect(w.nearby(w.at('npc_faceless'))).toContain('npc_faceless')
    w.cleanup()
  })
})
