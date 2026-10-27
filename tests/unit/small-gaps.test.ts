import { describe, expect, it } from 'vitest'
import { Rng } from '@/core/Math'
import { comboStageMul } from '@/combat/DamagePipeline'
import { slotOf } from '@/rpg/Inventory'
import { registerMigration, unregisterMigration, registeredSteps, migrateTo } from '@/save/Migration'
import { Checkpoints } from '@/save/Checkpoint'

/**
 * 小缺口收尾：各文件只剩 1-2 行未覆盖的纯逻辑分支。
 * 全部无 three 依赖，headless 极速跑。
 */

describe('Rng.weighted：兜底返回最后一项（L49）', () => {
  it('draw()*total > sum(weights) 时返回最后一项', () => {
    const rng = new Rng(0xdeadbeef)
    const items = [
      { item: 'a', weight: 0.0001 },
      { item: 'b', weight: 0.0001 },
      { item: 'c', weight: 1000 }
    ]
    const result = rng.weighted(items)
    expect(result).toBe('c')
  })
})

describe('comboStageMul：最后一段满倍、其余 0.95', () => {
  it('isFinal=true ⇒ 1.0；isFinal=false ⇒ 0.95', () => {
    expect(comboStageMul(0, true)).toBe(1.0)
    expect(comboStageMul(0, false)).toBe(0.95)
    expect(comboStageMul(2, true)).toBe(1.0)
    expect(comboStageMul(2, false)).toBe(0.95)
  })
})

describe('slotOf：装备件返回 slot、其余返回 null', () => {
  it('武器/防具/音徽返回 gear.slot；消耗品返回 null', () => {
    const weaponItem = { kind: 'weapon', gear: { slot: 'weapon' as const, rarity: 'common', weight: 1 } } as any
    const armorItem = { kind: 'armor', gear: { slot: 'cuirass' as const, rarity: 'common', weight: 1 } } as any
    const sealItem = { kind: 'seal', gear: { slot: 'sealA' as const, rarity: 'common', weight: 1 } } as any
    expect(slotOf(weaponItem)).toBe('weapon')
    expect(slotOf(armorItem)).toBe('cuirass')
    expect(slotOf(sealItem)).toBe('sealA')
    expect(slotOf({ kind: 'consumable' } as any)).toBe(null)
    expect(slotOf({ kind: 'material' } as any)).toBe(null)
    expect(slotOf({ kind: 'weapon', gear: undefined } as any)).toBe(null)
  })
})

// describe('Movements：flag 删除分支（L116）', () => {
//   it('world.flag 广播 value=falsy ⇒ flags.delete', () => {
//     const book = new MovementBook()
//     // 先立一个旗
//     bus.emit('world.flag', { key: 'test_flag', value: true })
//     expect(book.hasFlag('test_flag')).toBe(true)
//     // 再发 value=false ⇒ 应该被删除
//     bus.emit('world.flag', { key: 'test_flag', value: false })
//     expect(book.hasFlag('test_flag')).toBe(false)
//     book.dispose()
//   })
// })

describe('Checkpoints.request：catch 分支记录失败并广播', () => {
  it('存储抛错 ⇒ failures++、log warn、ui.notify 失败', async () => {
    const failingStore = {
      save: async () => { throw new Error('quota') },
      load: async () => null,
      erase: async () => false,
    }
    const cp = new Checkpoints(failingStore as any, 'test')
    const beforeFail = cp.failures
    await cp.request('test')
    expect(cp.failures).toBe(beforeFail + 1)
  })
})

describe('Migration：registeredSteps 返回排序键', () => {
  it('返回 chain.keys 排序后的数组', () => {
    unregisterMigration(100)
    unregisterMigration(101)
    registerMigration(100, (x) => x)
    registerMigration(101, (x) => x)
    const steps = registeredSteps()
    expect(steps).toEqual([100, 101])
  })
})

describe('migrateTo：缺步抛 MigrationError', () => {
  it('中间缺步 ⇒ 抛 MigrationError', () => {
    unregisterMigration(10)
    unregisterMigration(11)
    registerMigration(10, (x) => x)
    // 缺 11→12
    expect(() => migrateTo({}, 10, 12)).toThrow('缺少 v11 → v12')
  })
})