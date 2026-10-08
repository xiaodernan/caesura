import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { Inventory } from '@/rpg/Inventory'

/**
 * KI-046 结案：检视动词——「玩家自行检视断面」从 hasItem 条件变成真的看过。
 * Inventory.inspect 不消耗、返回检视文本、标记为已检视；hasInspected 给对话条件用。
 */
registerGameData()

describe('KI-046 检视动词（Inventory.inspect）', () => {
  it('手持断舌 → inspect 返回文本 + 标记已检视', () => {
    const inv = new Inventory('test-inspect')
    inv.add('it_bell_tongue', 1)
    const text = inv.inspect('it_bell_tongue')
    expect(text, '检视文本来自 item.use.inspect').toContain('从里面炸开的')
    expect(inv.hasInspected('it_bell_tongue'), '已标记').toBe(true)
  })

  it('没持有就不能检视：返回 null 且不标记', () => {
    const inv = new Inventory('test-inspect2')
    expect(inv.inspect('it_bell_tongue')).toBeNull()
    expect(inv.hasInspected('it_bell_tongue')).toBe(false)
  })

  it('没有 inspect 文本的物品：返回 null 不标记（不是每件都要有检视）', () => {
    const inv = new Inventory('test-inspect3')
    inv.add('it_resonance_core', 1)
    expect(inv.inspect('it_resonance_core')).toBeNull()
    expect(inv.hasInspected('it_resonance_core')).toBe(false)
  })

  it('snapshot/restore：检视记录跟着档走', () => {
    const inv = new Inventory('test-inspect4')
    inv.add('it_bell_tongue', 1)
    inv.inspect('it_bell_tongue')
    const snap = inv.snapshot()
    expect(snap.inspected).toContain('it_bell_tongue')
    // 新背包 restore
    const inv2 = new Inventory('test-inspect5')
    inv2.restore(snap)
    expect(inv2.hasInspected('it_bell_tongue'), '检视记录复原').toBe(true)
  })
})
