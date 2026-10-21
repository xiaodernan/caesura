import { describe, it, expect } from 'vitest'
import { sealSlotFor } from '@/rpg/Equipment'

/**
 * 音徽 A/B 的落格规则（progression.md §5.1，KI-029）。
 *
 * 这条规则只有 `sealSlotFor` 一个主人：装备建议/换装投影（`Equipment.preview`、
 * `equipSeal`）都只读它，不抄第二份。合同是纯函数、无副作用：
 *   - A 槽空 → 落 A
 *   - A 占   → 落 B（现行口径：只看 A 是否占，B 占不占不影响；第三枚覆盖 B，不顶 A，
 *             避免"装第二枚把第一枚静默顶掉"这种玩家会当成 bug 的静默替换）
 *
 * 用具体断言钉死四个象限 + 返回类型恒为合法音徽槽。零直接读者，纯契约锁。
 */
describe('sealSlotFor：音徽 A/B 落格规则（§5.1，KI-029 唯一主人）', () => {
  it('A 槽空 → 落 A', () => {
    expect(sealSlotFor({})).toBe('sealA')
  })

  it('只有 B 占、A 空 → 仍落 A（只看 A 是否占）', () => {
    expect(sealSlotFor({ sealB: 'u2' })).toBe('sealA')
  })

  it('A 占 → 落 B', () => {
    expect(sealSlotFor({ sealA: 'u1' })).toBe('sealB')
  })

  it('A、B 都占 → 落 B（现行口径：A 占即 B，第三枚覆盖 B 而非顶 A）', () => {
    expect(sealSlotFor({ sealA: 'u1', sealB: 'u2' })).toBe('sealB')
  })

  it('返回类型恒为合法音徽槽', () => {
    const r = sealSlotFor({})
    expect(r === 'sealA' || r === 'sealB').toBe(true)
  })
})
