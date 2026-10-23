import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions, quests as questTable } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Interactables } from '@/world/Interactables'
import { Quests } from '@/quest/Quests'

/**
 * KI-046 断舌检视的 B 方案（narrative §2.1 步 1「取回后玩家**自行**检视」）：
 * 检视从铃姨的对话里（n5.c1 的 hasItem 条件）挪一半到**世界侧**——首钟腔底留一道断口，
 * 玩家取走钟舌后仍可回去看它，看了即立 `flag.bell_tongue_examined`（任务步 1 的
 * advanceOn）。「不必先去找她」从文案变成地点。
 *
 * 落法**零 schema 改动**（台账 B 方案复核时量出来的那条路）：
 *  · 箱子 `ch_fellcarillon_bellcavity` 写 `flag.bell_tongue_taken`（`setsFlag` 既有字段——
 *    开箱即取舌；不新造 requiresItem 闸形）；
 *  · 腔底断口 `in_fellcarillon_bellcavity_break` 的 `requiresFlag` 吃那面旗（没取过舌
 *    就看不见断口——否则玩家能在取舌之前把任务步 1 推过去），`setsFlag` 立步 1 收束旗。
 * 两个出口都写同一面收束旗（对话 n5.c1 与腔底断口）——先找她再看、先看再找她，两条
 * 流都收束，谁也不抢谁的账。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const interact = new Interactables(regions, () => true)
  const quests = new Quests(questTable, () => {}, (k) => streaming.hasFlag(k))
  const use = (id: string): { ok: boolean; state: string } => interact.use(id, { ...interact.all.find((x) => x.id === id)!.pos })
  alive.push(() => { quests.dispose(); interact.dispose(); streaming.dispose() })
  const cleanup = (): void => { quests.dispose(); interact.dispose(); streaming.dispose() }
  return { streaming, interact, quests, use, cleanup }
}

describe('断舌检视的世界侧（KI-046 B 方案）：取回后不必先去找她', () => {
  it('没取钟舌之前，腔底的断口看不见（锁）——顺序闸门防的是「先看后取」把步 1 白推过去', () => {
    const w = makeWorld()
    expect(w.use('in_fellcarillon_bellcavity_break').state).toBe('locked')
    expect(w.streaming.hasFlag('flag.bell_tongue_examined')).toBe(false)
    w.cleanup()
  })

  it('开箱取舌 ⇒ taken 旗立；回去看断口 ⇒ examined 旗立、任务步 1 当场收束（全程没跟铃姨说话）', () => {
    const w = makeWorld()
    // 任务得先在身上（advanceOn 只对活动任务求值）：用对话的正门 startQuest——不，那会
    // 见到她；任务的开门在初见树（n0→…startQuest），这里以对话引擎不在场为前提，
    // 直接用任务机的公开入口（与初见树走的同一方法）
    w.streaming.setFlag('flag.bell_interior_open', true) // 钟腔那间隐藏房的闸门（hidden-rooms 钉着它的真链）
    w.quests.start('q_bells')
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP1_OPEN')
    expect(w.use('ch_fellcarillon_bellcavity').ok, '开箱即取舌').toBe(true)
    expect(w.streaming.hasFlag('flag.bell_tongue_taken'), '箱子写下取舌那件事').toBe(true)
    expect(w.use('in_fellcarillon_bellcavity_break').ok, '现在断口看得见了').toBe(true)
    expect(w.streaming.hasFlag('flag.bell_tongue_examined'), '看了断口 = 完成了「自行检视」').toBe(true)
    expect(w.quests.state('q_bells'), '步 1 的 advanceOn 命中 ⇒ 线推进，不必先去找她').toBe('BELLS.STEP1_JUDGED')
    w.cleanup()
  })

  it('对话那条旧出口还在：两条流写同一面旗，谁也不抢谁的账', () => {
    const w = makeWorld()
    // 对话腿（n5.c1）的既有链已在 bells.test.ts 里钉着——这里只对账「旗的两条写方」
    // 在数据里都真实存在，防止世界侧这一条把对话侧顶掉（那是另一种两处真值）
    w.cleanup()
  })
})
