import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { WorldStates } from '@/quest/WorldStates'
import type { WorldStateDef } from '@/data/schema'

describe('WorldStates — 值域状态唯一写口与快照/恢复', () => {
  let w: WorldStates
  const defs: WorldStateDef[] = [
    { key: 'state.test.a', displayName: 'Test A', values: ['X', 'Y', 'Z'], default: 'X', note: '' },
    { key: 'state.test.b', displayName: 'Test B', values: ['ON', 'OFF'], default: 'OFF', note: '' }
  ]

  beforeAll(() => {
    registry.register('states', defs)
  })

  afterEach(() => {
    w?.dispose()
  })

  it('构造：缺省值写入 values，def/all/get 都能读到', () => {
    w = new WorldStates(defs)
    expect(w.def('state.test.a')).not.toBeNull()
    expect(w.all().length).toBe(2)
    expect(w.get('state.test.a')).toBe('X')
    expect(w.get('state.test.b')).toBe('OFF')
    expect(w.get('state.nope')).toBe('')
    expect(w.isSet('state.test.a')).toBe(false)
    w.dispose()
  })

  it('set 未知 key ⇒ false + warn，值不变', () => {
    w = new WorldStates(defs)
    const warns: string[] = []
    const off = bus.on('log', (p) => { if (p.level === 'warn') warns.push(p.msg) })
    const ok = w.set('state.unknown', 'X')
    off()
    expect(ok).toBe(false)
    expect(w.get('state.test.a')).toBe('X')
    expect(warns.some((m) => m.includes('worldstate.unknown') && m.includes('state.unknown'))).toBe(true)
    w.dispose()
  })

  it('set 非法 value ⇒ false + warn，值不变', () => {
    w = new WorldStates(defs)
    const warns: string[] = []
    const off = bus.on('log', (p) => { if (p.level === 'warn') warns.push(p.msg) })
    const ok = w.set('state.test.a', 'WRONG')
    off()
    expect(ok).toBe(false)
    expect(w.get('state.test.a')).toBe('X')
    expect(warns.some((m) => m.includes('worldstate.badValue') && m.includes('state.test.a') && m.includes('X/Y/Z'))).toBe(true)
    w.dispose()
  })

  it('set 合法 ⇒ true，广播 world.state，written 记录该格', () => {
    w = new WorldStates(defs)
    const states: Array<{ key: string; value: string }> = []
    const off = bus.on('world.state', (p) => states.push(p))
    const ok = w.set('state.test.a', 'Y')
    off()
    expect(ok).toBe(true)
    expect(w.get('state.test.a')).toBe('Y')
    expect(w.isSet('state.test.a')).toBe(true)
    expect(states).toContainEqual({ key: 'state.test.a', value: 'Y' })
    w.dispose()
  })

  it('matches 只做当前值比较（缺省也参与）', () => {
    w = new WorldStates(defs)
    expect(w.matches('state.test.b', 'OFF')).toBe(true)
    w.set('state.test.b', 'ON')
    expect(w.matches('state.test.b', 'OFF')).toBe(false)
    expect(w.matches('state.test.b', 'ON')).toBe(true)
    w.dispose()
  })

  it('snapshot 只记写过的格，且按 key 排序', () => {
    w = new WorldStates(defs)
    w.set('state.test.b', 'ON')
    w.set('state.test.a', 'Z')
    const snap = w.snapshot()
    expect(Object.keys(snap)).toEqual(['state.test.a', 'state.test.b'])
    expect(snap).toEqual({ 'state.test.a': 'Z', 'state.test.b': 'ON' })
    w.dispose()
  })

  it('restore：白名单内的合法值生效；未知 key / 非法 value 被丢弃；stale 回缺省', () => {
    w = new WorldStates(defs)
    w.set('state.test.a', 'Y')
    w.set('state.test.b', 'ON')
    const events: Array<{ key: string; value: string }> = []
    const off = bus.on('world.state', (p) => events.push(p))
    w.restore({
      'state.test.a': 'Z',
      'state.test.b': 'BAD',
      'state.unknown': 'X'
    })
    off()
    expect(w.get('state.test.a')).toBe('Z')
    expect(w.get('state.test.b')).toBe('OFF')
    expect(w.isSet('state.test.a')).toBe(true)
    expect(w.isSet('state.test.b')).toBe(false)
    const written = events.map((e) => e.key).sort()
    expect(written).toEqual(['state.test.a', 'state.test.b'])
    expect(events.find((e) => e.key === 'state.test.b')?.value).toBe('OFF')
    w.dispose()
  })

  it('restore 空/undefined/null ⇒ 全部回缺省', () => {
    w = new WorldStates(defs)
    w.set('state.test.a', 'Y')
    w.set('state.test.b', 'ON')
    const events: Array<{ key: string; value: string }> = []
    const off = bus.on('world.state', (p) => events.push(p))
    w.restore({})
    w.restore(null)
    w.restore(undefined)
    off()
    expect(w.get('state.test.a')).toBe('X')
    expect(w.get('state.test.b')).toBe('OFF')
    expect(w.isSet('state.test.a')).toBe(false)
    expect(w.isSet('state.test.b')).toBe(false)
    expect(events.map((e) => e.key).sort()).toEqual(['state.test.a', 'state.test.b'])
    w.dispose()
  })
})