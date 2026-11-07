import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { Quests, seenKey, type QuestEvent } from '@/quest/Quests'
import type { QuestData } from '@/data/schema'

/**
 * `src/quest/Quests.ts`：叙事进度（Phase 6-B）——任务状态机 + NPC 关系 + 对话已读节点。
 *
 * 三条纪律：
 * 1. 任务推进只由旗标 / 值域状态 / 对话选择驱动（无计时器、无计数器）
 * 2. 关系值是 -5..+5 的整数，越界夹住
 * 3. 已读节点缓存进档，`once` 节点不会重复演
 */

const q = (id: string, states: string[] = ['a', 'b', 'c']): QuestData => ({
  id,
  nameKey: `quest.${id}`,
  displayName: `任务${id}`,
  npc: 'npc_test',
  outcome: `outcome-${id}`,
  steps: states.map((state, i) => ({
    state,
    label: `label-${i}`,
    advanceOn: i < states.length - 1 ? { flags: [`flag-${id}-${i}`] } : undefined,
  })),
})

describe('seenKey：对话已读节点的键名', () => {
  it('dialogueId#nodeId 形式，可复现', () => {
    expect(seenKey('d1', 'n1')).toBe('d1#n1')
    expect(seenKey('d1', 'n1')).toBe(seenKey('d1', 'n1'))
    expect(seenKey('d2', 'n1')).not.toBe(seenKey('d1', 'n1'))
  })
})

describe('Quests：构造与基础读取', () => {
  const data = [q('q1'), q('q2')]
  const events: QuestEvent[] = []
  const quests = new Quests(data, (e) => events.push(e))

  it('未开始的任务 state 为 null，isStarted 为 false，stepIndex 为 -1', () => {
    expect(quests.state('q1')).toBeNull()
    expect(quests.isStarted('q1')).toBe(false)
    expect(quests.stepIndex('q1')).toBe(-1)
  })

  it('不存在的任务所有读取都返回空/负值', () => {
    expect(quests.state('nope')).toBeNull()
    expect(quests.isStarted('nope')).toBe(false)
    expect(quests.stepIndex('nope')).toBe(-1)
    expect(quests.stepIndexOf('nope', 'a')).toBe(-1)
  })
})

describe('Quests：start / advance 推进', () => {
  const data = [q('q1', ['a', 'b', 'c'])]
  const events: QuestEvent[] = []
  const quests = new Quests(data, (e) => events.push(e))

  it('start：落到第一步，已开始的线不会打回', () => {
    expect(quests.start('q1')).toBe(true)
    expect(quests.state('q1')).toBe('a')
    expect(quests.stepIndex('q1')).toBe(0)
    expect(quests.isStarted('q1')).toBe(true)
    expect(quests.start('q1')).toBe(false) // 已开始，不打回
    expect(quests.state('q1')).toBe('a')
  })

  it('advance：顺推一步，事件带 index / state / label / started / completed', () => {
    quests.start('q1')
    expect(quests.advance('q1')).toBe(true)
    expect(quests.state('q1')).toBe('b')
    expect(quests.stepIndex('q1')).toBe(1)
    const ev = events[events.length - 1]
    expect(ev.questId).toBe('q1')
    expect(ev.state).toBe('b')
    expect(ev.index).toBe(1)
    expect(ev.label).toBe('label-1')
    expect(ev.started).toBe(false)
    expect(ev.completed).toBe(false)
  })

  it('advance：末步之后不再推进（单调）', () => {
    quests.advance('q1') // b -> c
    expect(quests.state('q1')).toBe('c')
    expect(quests.advance('q1')).toBe(false) // 末步，不许回头/重播
    expect(quests.state('q1')).toBe('c')
  })

  it('advance(to)：直接跳到指定 state，必须单调递增', () => {
    const q2 = new Quests([q('q2', ['x', 'y', 'z'])])
    q2.start('q2')
    expect(q2.advance('q2', 'z')).toBe(true)
    expect(q2.state('q2')).toBe('z')
    expect(q2.advance('q2', 'x')).toBe(false) // 回头不许
    expect(q2.state('q2')).toBe('z')
    expect(q2.advance('q2', 'z')).toBe(false) // 原地重播不许
  })

  it('不存在的任务不启动、不推进', () => {
    expect(quests.start('nope')).toBe(false)
    expect(quests.advance('nope')).toBe(false)
    expect(quests.advance('nope', 'a')).toBe(false)
  })

  it('旗标广播 ⇒ 顺推一步（advanceOn.flags 命中的那一步）', () => {
    const data = [q('q-flag', ['a', 'b', 'c'])]
    const quests = new Quests(data)
    quests.start('q-flag')
    expect(quests.state('q-flag')).toBe('a')
    bus.emit('world.flag', { key: 'flag-q-flag-0', value: true })
    expect(quests.state('q-flag')).toBe('b')
  })
})

describe('Quests：关系值 -5..+5 整数夹住', () => {
  const data = [q('q1')]
  const quests = new Quests(data)

  it('初始为 0；addRelation 累加并夹到 [-5, +5]', () => {
    expect(quests.relation('npc_a')).toBe(0)
    expect(quests.addRelation('npc_a', 3)).toBe(3)
    expect(quests.relation('npc_a')).toBe(3)
    expect(quests.addRelation('npc_a', 99)).toBe(5)
    expect(quests.relation('npc_a')).toBe(5)
    expect(quests.addRelation('npc_a', -99)).toBe(-5)
    expect(quests.relation('npc_a')).toBe(-5)
  })
})

describe('Quests：已读节点缓存', () => {
  const quests = new Quests([q('q1')])

  it('未读为 false；markSeen 后为 true；键由 dialogueId#nodeId 派生', () => {
    expect(quests.hasSeen('d1', 'n1')).toBe(false)
    quests.markSeen('d1', 'n1')
    expect(quests.hasSeen('d1', 'n1')).toBe(true)
    expect(quests.hasSeen('d2', 'n1')).toBe(false)
  })
})

describe('Quests：snapshot / restore 存档往返', () => {
  const data = [q('q1', ['a', 'b', 'c'])]

  it('空快照恢复 ⇒ 未开始；部分快照恢复到指定步', () => {
    const a = new Quests(data)
    a.start('q1')
    a.addRelation('npc_x', 2)
    a.markSeen('d1', 'n1')
    const snap = a.snapshot()

    const b = new Quests(data)
    b.restore(snap)
    expect(b.state('q1')).toBe('a')
    expect(b.relation('npc_x')).toBe(2)
    expect(b.hasSeen('d1', 'n1')).toBe(true)

    const c = new Quests(data)
    c.restore(null) // 老档无块 ⇒ 什么都不动
    expect(c.isStarted('q1')).toBe(false)
    expect(c.relation('npc_x')).toBe(0)
    expect(c.hasSeen('d1', 'n1')).toBe(false)
  })
})
