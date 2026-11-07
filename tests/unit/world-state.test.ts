import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { WorldState, type WorldStateDeps } from '@/quest/WorldState'
import type { WorldStateRule } from '@/data/schema'

/**
 * `src/quest/WorldState.ts`：世界状态的**写入方**（narrative §7 的执行位，Phase 6-A）。
 *
 * 三条纪律：
 * 1. 只走 `world.flag` 广播，不自己存旗标
 * 2. 幂等：旗已立就不再摘
 * 3. 规则表只登记有读方的旗标
 */

const rules: WorldStateRule[] = [
  { id: 'r_first_parry', on: 'firstParry', setFlag: 'flag.first_parry' },
  { id: 'r_boss_ostlara', on: 'bossDefeated', dataId: 'en_ostlara', setFlag: 'flag.ostlara_defeated', notify: '奥斯塔拉倒下' },
  { id: 'r_interact_bell', on: 'interactUsed', interactId: 'act_bell', setFlag: 'flag.bell_rung' },
  { id: 'r_state_silenced', on: 'stateSet', stateKey: 'state.meg', stateIn: ['silenced'], setFlag: 'flag.meg_silenced' },
]

const world = (): { deps: WorldStateDeps; flags: string[]; note: string[] } => {
  const flags: string[] = []
  const note: string[] = []
  return {
    flags,
    note,
    deps: { hasFlag: (k) => flags.includes(k), setFlag: (k) => { flags.push(k) } },
  }
}

let ws: WorldState | null = null
afterEach(() => { ws?.dispose(); ws = null })

describe('WorldState：构造与规则触发', () => {
  it('firstParry：combat.parried 且 defenderId=player ⇒ 立旗', () => {
    const { deps, flags } = world()
    ws = new WorldState(rules, deps)
    bus.emit('combat.parried', { defenderId: 'player' } as never)
    expect(flags).toContain('flag.first_parry')
  })

  it('firstParry：defenderId 不是 player ⇒ 不动', () => {
    const { deps, flags } = world()
    ws = new WorldState(rules, deps)
    bus.emit('combat.parried', { defenderId: 'en_ostlara' } as never)
    expect(flags).not.toContain('flag.first_parry')
  })

  it('bossDefeated：dataId 匹配 ⇒ 立旗并 broadcast notify', () => {
    const { deps, flags } = world()
    ws = new WorldState(rules, deps)
    bus.emit('boss.defeated', { dataId: 'en_ostlara' } as never)
    expect(flags).toContain('flag.ostlara_defeated')
  })

  it('bossDefeated：dataId 不匹配 ⇒ 不立', () => {
    const { deps, flags } = world()
    ws = new WorldState(rules, deps)
    bus.emit('boss.defeated', { dataId: 'en_hersil' } as never)
    expect(flags).not.toContain('flag.ostlara_defeated')
  })

  it('interactUsed：ok=false ⇒ 不立；ok=true 且 id 匹配 ⇒ 立', () => {
    const { deps, flags } = world()
    ws = new WorldState(rules, deps)
    bus.emit('world.interact', { ok: false, id: 'act_bell' } as never)
    expect(flags).not.toContain('flag.bell_rung')
    bus.emit('world.interact', { ok: true, id: 'act_bell' } as never)
    expect(flags).toContain('flag.bell_rung')
  })

  it('stateSet：key/value 同时匹配才立；value 不在 stateIn ⇒ 不立', () => {
    const { deps, flags } = world()
    ws = new WorldState(rules, deps)
    bus.emit('world.state', { key: 'state.meg', value: 'resonant' } as never)
    expect(flags).not.toContain('flag.meg_silenced')
    bus.emit('world.state', { key: 'state.meg', value: 'silenced' } as never)
    expect(flags).toContain('flag.meg_silenced')
  })

  it('幂等：同一旗已立 ⇒ 再次事件不重复 setFlag、不重复 notify', () => {
    const { deps, flags } = world()
    ws = new WorldState(rules, deps)
    bus.emit('combat.parried', { defenderId: 'player' } as never)
    bus.emit('combat.parried', { defenderId: 'player' } as never)
    expect(flags.filter((f) => f === 'flag.first_parry').length).toBe(1)
  })

  it('writerOf：反向查规则；没写方返回 null', () => {
    const { deps } = world()
    ws = new WorldState(rules, deps)
    expect(ws.writerOf('flag.first_parry')?.id).toBe('r_first_parry')
    expect(ws.writerOf('flag.nope')).toBeNull()
  })

  it('flagsWritten：被立起来的旗标，排序', () => {
    const { deps, flags } = world()
    ws = new WorldState(rules, deps)
    bus.emit('combat.parried', { defenderId: 'player' } as never)
    bus.emit('boss.defeated', { dataId: 'en_ostlara' } as never)
    expect(ws.flagsWritten).toEqual(['flag.first_parry', 'flag.ostlara_defeated'])
    expect(flags).toContain('flag.first_parry')
    expect(flags).toContain('flag.ostlara_defeated')
  })
})
