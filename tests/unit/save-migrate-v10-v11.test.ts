/**
 * migrateV10toV11 守卫（src/save/Serializer.ts）。
 *
 * v10 → v11（值域型世界状态 `state.*`）。老档里没有任何一格被写过 ⇒ 迁移**写空表**，
 * 让每一格读到 `states.json` 声明的 default（= 那个抉择还没做）。这是如实的：老档确实没做过
 * 《该不该敲响》的抉择，**不能**反推成"已经选了某个结局"（与 v1→v2 的 `rpg:null`、v6→v7 的
 * `quest:null` 同一条纪律，§78 留空是如实，补一个是假账）。
 *
 * 为什么不是冗余：save.test.ts 走的是 v5→SAVE_VERSION / v4→5 / v1→SAVE_VERSION 的前向链，
 * 那些快照不是 v10 形状，也从不断言「v10 这一步把 states 置成 {}、version 顶到 11、其余字段原样保留」。
 * 这一刀直接锁 `migrateV10toV11` 自己的契约，并顺带确认它在迁移链上真的被接上（migrateTo(10→11)）。
 *
 * 锁的要点：
 *   1. 输出 `snapshot.version === 11`（顶到 11，不多不少）；
 *   2. 输出 `snapshot.states` 是**空对象** `{}`——绝不伪造一份默认抉择；
 *   3. 即便输入带了一坨脏 states，也要被**强制清空**（防"把老档没选过的事实写成了选过"）；
 *   4. 其它快照字段（flags / rpg / regions）**原样保留**，且函数不修改入参（纯迁移）。
 */
import { describe, expect, it } from 'vitest'
import { migrateV10toV11 } from '@/save/Serializer'
import { migrateTo } from '@/save/Migration'

function v10(): Record<string, unknown> {
  return {
    snapshot: {
      version: 10,
      flags: { 'flag.left_resthold': true, 'flag.bell_toll_rung': false },
      rpg: { rank: 7, loot: { taken: ['a', 'b'] } },
      regions: [{ id: 'rg_resthold', cleared: true }],
    },
  }
}

describe('migrateV10toV11', () => {
  it('直接调用：version 顶到 11、states 置空、其余字段原样保留', () => {
    const out = migrateV10toV11(v10()) as { snapshot: Record<string, unknown> }
    expect(out.snapshot.version).toBe(11)
    expect(out.snapshot.states).toEqual({})
    expect(out.snapshot.flags).toEqual({ 'flag.left_resthold': true, 'flag.bell_toll_rung': false })
    expect(out.snapshot.rpg).toEqual({ rank: 7, loot: { taken: ['a', 'b'] } })
    expect(out.snapshot.regions).toEqual([{ id: 'rg_resthold', cleared: true }])
  })

  it('诚实空表：states 必须是空对象，而不是伪造一份默认抉择', () => {
    const out = migrateV10toV11(v10()) as { snapshot: Record<string, unknown> }
    const states = out.snapshot.states as Record<string, unknown>
    expect(Object.keys(states)).toHaveLength(0)
  })

  it('即便输入带脏 states，也要被强制清空（防"把没选过写成选过"）', () => {
    const dirty = v10()
    ;(dirty.snapshot as Record<string, unknown>).states = { 'state.bells.fourth_dumb': 'rung' }
    const out = migrateV10toV11(dirty) as { snapshot: Record<string, unknown> }
    expect(out.snapshot.states).toEqual({})
  })

  it('纯迁移：不修改入参（原始 snapshot.version / states 不动）', () => {
    const input = v10()
    const before = JSON.stringify(input)
    migrateV10toV11(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('在迁移链上真的被接上：migrateTo(p, 10, 11) 等价于直接调这一步', () => {
    const out = migrateTo(v10(), 10, 11) as { snapshot: Record<string, unknown> }
    expect(out.snapshot.version).toBe(11)
    expect(out.snapshot.states).toEqual({})
    expect(out.snapshot.rpg).toEqual({ rank: 7, loot: { taken: ['a', 'b'] } })
  })
})
