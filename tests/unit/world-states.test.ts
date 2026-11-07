import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { WorldStates } from '@/quest/WorldStates'
import type { WorldStateDef } from '@/data/schema'

/**
 * `src/quest/WorldStates.ts`：值域型世界状态（Phase 6-B，narrative §7 的 `STATE.<域>.<对象> = <枚举>`）。
 *
 * 三条纪律：
 * 1. 唯一写入口是 `set()`，key/value 都必须在登记表里
 * 2. 没写过 ⇒ 读登记表声明的 `default`
 * 3. snapshot 只记写过的格；restore 只认登记表 + 合法取值，其余丢弃／退回缺省
 */

const defs: WorldStateDef[] = [
  { key: 'state.meg', displayName: '无鸣的结局', values: ['resonant', 'silenced'], default: 'resonant' },
  { key: 'state.bells', displayName: '第四口钟', values: ['sealed', 'rung', 'melted', 'intact'], default: 'sealed' },
]

let ws: WorldStates | null = null
afterEach(() => { ws?.dispose(); ws = null })

describe('WorldStates：构造与缺省', () => {
  it('未写过的格子读到登记表里声明的 default', () => {
    ws = new WorldStates(defs)
    expect(ws.get('state.meg')).toBe('resonant')
    expect(ws.get('state.bells')).toBe('sealed')
    expect(ws.isSet('state.meg')).toBe(false)
  })

  it('不存在的 key 读到空串；def 返回 null', () => {
    ws = new WorldStates(defs)
    expect(ws.get('state.nope')).toBe('')
    expect(ws.def('state.nope')).toBeNull()
  })

  it('all：登记表里的全部 key', () => {
    ws = new WorldStates(defs)
    expect(ws.all().map((d) => d.key).sort()).toEqual(['state.bells', 'state.meg'])
  })
})

describe('WorldStates：set / 合法性 / 幂等', () => {
  it('登记表里 + 取值合法 ⇒ true，且值被写上', () => {
    ws = new WorldStates(defs)
    expect(ws.set('state.meg', 'silenced')).toBe(true)
    expect(ws.get('state.meg')).toBe('silenced')
    expect(ws.isSet('state.meg')).toBe(true)
    expect(ws.matches('state.meg', 'silenced')).toBe(true)
    expect(ws.matches('state.meg', 'resonant')).toBe(false)
  })

  it('不在登记表里的 key ⇒ false 且不写', () => {
    ws = new WorldStates(defs)
    expect(ws.set('state.nope', 'x')).toBe(false)
    expect(ws.isSet('state.nope')).toBe(false)
  })

  it('取值不在登记表 ⇒ false 且不写', () => {
    ws = new WorldStates(defs)
    expect(ws.set('state.meg', 'bogus')).toBe(false)
    expect(ws.get('state.meg')).toBe('resonant')
    expect(ws.isSet('state.meg')).toBe(false)
  })

  it('外部广播 world.state ⇒ 内部缓存跟上（自己也听它）', () => {
    ws = new WorldStates(defs)
    bus.emit('world.state', { key: 'state.meg', value: 'silenced' })
    expect(ws.get('state.meg')).toBe('silenced')
  })
})

describe('WorldStates：snapshot / restore', () => {
  it('snapshot 只记写过的格，按 key 排序', () => {
    ws = new WorldStates(defs)
    expect(ws.snapshot()).toEqual({})
    ws.set('state.bells', 'rung')
    ws.set('state.meg', 'silenced')
    const snap = ws.snapshot()
    expect(Object.keys(snap)).toEqual(['state.bells', 'state.meg'])
    expect(snap).toEqual({ 'state.bells': 'rung', 'state.meg': 'silenced' })
  })

  it('restore：未写过的格退回缺省；非法 key/value 丢弃', () => {
    ws = new WorldStates(defs)
    ws.set('state.meg', 'silenced')
    // 先写再 restore：档里没 meg，写回缺省
    ws.restore({ 'state.bells': 'rung', 'state.nope': 'x', 'state.meg': 'bogus' } as never)
    expect(ws.get('state.meg')).toBe('resonant') // 退回缺省
    expect(ws.get('state.bells')).toBe('rung')
    expect(ws.isSet('state.meg')).toBe(false)
  })

  it('restore(null/undefined) ⇒ 当前写着的全退回缺省', () => {
    ws = new WorldStates(defs)
    ws.set('state.meg', 'silenced')
    ws.restore(null)
    expect(ws.get('state.meg')).toBe('resonant')
    expect(ws.isSet('state.meg')).toBe(false)
  })
})
