/**
 * PatrolWatch 守卫（src/quest/PatrolWatch.ts）。
 *
 * 断弦线步 1《巡逻线尽头》的判据裁判（narrative §2.4）：玩家以**纯闪避不反击**走完一整圈巡逻周期，
 * 才点亮 `flag.haltrune_patrol_seen`。本类把判据从文案挪回机制，且是事件型的（需求 §28：不许用计数器）。
 *
 * 这是模块级唯一读者为 0 的缺口——本文件之前没有任何测试 import 它，也没有别的真链/包装层覆盖它。
 * 锁的是它**自己独有的契约**，不是被其它地方验证过的东西：
 *   1. 出手（global `input.action`）只置位 dirty，不直接裁决；
 *   2. notePatrolLoop 在「非 watched / 已 done」时都是 no-op（不直接写旗）；
 *   3. 一圈之内出过手 ⇒ 这一圈作废（dirty 复位、不写旗），下一圈绕回才重新判；
 *   4. done 是永久的——成立之后绕回多少圈都不应再触发 onSeen；
 *   5. dispose() 必须真正摘掉 bus 订阅（否则全局 input.action 会持续把它弄脏）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { PatrolWatch } from '@/quest/PatrolWatch'

type E = { id: string; dataId: string; pos: { x: number; y: number; z: number } }
const e0: E = { id: 'npc_patrol_1', dataId: 'patrol_unit', pos: { x: 0, y: 0, z: 0 } }

// 用一个本地计数把「匿名回调」变成可断言的量：本类唯一的对外副作用就是 onSeen。
let seen: number
let watchedCalls: number
let watch: PatrolWatch

function make(watched: (e: E, p: { x: number; y: number; z: number } | null) => boolean): PatrolWatch {
  return new PatrolWatch(watched, () => { seen++ })
}

beforeEach(() => {
  seen = 0
  watchedCalls = 0
})

afterEach(() => {
  watch?.dispose()
})

describe('PatrolWatch', () => {
  it('一圈干净绕回（玩家在跟、全程未出手）→ 写旗一次', () => {
    watch = make((e, p) => { watchedCalls++; return e.id === 'npc_patrol_1' && p !== null })
    watch.notePatrolLoop(e0, { x: 1, y: 0, z: 0 })
    expect(seen).toBe(1)
    expect(watchedCalls).toBe(1)
  })

  it('watched 判定为假（玩家没在跟 / 不是那支队伍）→ 绕回也不写旗', () => {
    watch = make(() => false)
    watch.notePatrolLoop(e0, { x: 1, y: 0, z: 0 })
    watch.notePatrolLoop(e0, null)
    expect(seen).toBe(0)
  })

  it('出手只置位 dirty，不直接写旗——绕回前打一发，这一圈作废', () => {
    watch = make(() => true)
    bus.emit('input.action', { action: 'attackLight' })
    // dirty 已置位，但还没绕回：此刻不应写旗
    expect(seen).toBe(0)
    watch.notePatrolLoop(e0, { x: 1, y: 0, z: 0 })
    // 出过手 ⇒ 这一圈作废、dirty 复位、不写旗
    expect(seen).toBe(0)
  })

  it('作废之后下一圈绕回（未再出手）→ 才写旗（只此一次）', () => {
    watch = make(() => true)
    bus.emit('input.action', { action: 'heavy' }) // 第一圈作废
    watch.notePatrolLoop(e0, { x: 1, y: 0, z: 0 })
    expect(seen).toBe(0)
    watch.notePatrolLoop(e0, { x: 1, y: 0, z: 0 }) // 第二圈干净
    expect(seen).toBe(1)
  })

  it('done 是永久的——成立之后绕回更多圈也不再触发 onSeen', () => {
    watch = make(() => true)
    watch.notePatrolLoop(e0, { x: 1, y: 0, z: 0 })
    expect(seen).toBe(1)
    bus.emit('input.action', { action: 'skill' }) // 成立后出手也不该清除已成立的判据
    for (let i = 0; i < 5; i++) watch.notePatrolLoop(e0, { x: 1, y: 0, z: 0 })
    expect(seen).toBe(1)
  })

  it('dispose() 摘掉订阅——之后再 emit input.action 不会再弄脏判据', () => {
    watch = make(() => true)
    watch.dispose()
    bus.emit('input.action', { action: 'attackLight' }) // 已无订阅，不应置位
    watch.notePatrolLoop(e0, { x: 1, y: 0, z: 0 })
    // dirty 没被置位 ⇒ 干净一圈直接写旗，证明订阅确实摘掉了
    expect(seen).toBe(1)
  })
})
