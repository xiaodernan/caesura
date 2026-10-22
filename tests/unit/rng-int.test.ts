import { describe, it, expect } from 'vitest'
import { Rng } from '@/core/Math'

/**
 * `Rng.int(min, max)` 的**闭区间**口径（`core/Math.ts`）。
 *
 * 全测试库此前没有任何一处断言 `int()` 的取值域——`core.test.ts` 锁了确定性与
 * `weighted()`，`math-helpers.test.ts` 锁了 clamp/lerp/damp/mulberry32/hashString。
 *
 * 为什么这条要紧：`rpg/Inventory.ts > rollAffixes` 用 `rng.int(0, pool.length - 1)`
 * 从词缀池里抽签。`int()` 若是「上界开区间」，池子里最后一项永远抽不到；
 * 若是「下界也开」，就会踩到 `pool[-1]` 抽出一个 `undefined` 再在下一行炸。
 * 两种错都不会报错，只会让掉落分布悄悄变形——所以这里用独立口径钉死两端都闭。
 */
describe('Rng.int：闭区间口径（两端都含，词缀池抽签的地基）', () => {
  it('区间两端都够得着：int(0,3) 四值都出现', () => {
    const rng = new Rng('int-range')
    const seen = new Set<number>()
    for (let i = 0; i < 4000; i++) seen.add(rng.int(0, 3))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })

  it('永不越界：int(2,7) 五千抽全部落在 [2,7]', () => {
    const rng = new Rng('int-bounds')
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(2, 7)
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThanOrEqual(7)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('分布大致均匀：int(0,3) 四格各占四分之一左右（不是只会抽头尾）', () => {
    const rng = new Rng('int-spread')
    const counts = [0, 0, 0, 0]
    const N = 8000
    for (let i = 0; i < N; i++) counts[rng.int(0, 3)]++
    for (const c of counts) {
      expect(c / N).toBeGreaterThan(0.2)
      expect(c / N).toBeLessThan(0.3)
    }
  })

  it('退化区间 int(3,3) 恒为 3（单项池的形状）', () => {
    const rng = new Rng('int-single')
    for (let i = 0; i < 200; i++) expect(rng.int(3, 3)).toBe(3)
  })

  it('int(0,0) 恒为 0 —— rollAffixes 抽只剩一件的池子时的真实形状', () => {
    const rng = new Rng('int-pool-one')
    for (let i = 0; i < 200; i++) expect(rng.int(0, 0)).toBe(0)
  })

  it('同种子同序列（确定性不破）', () => {
    const a = new Rng('int-seed')
    const b = new Rng('int-seed')
    for (let i = 0; i < 50; i++) expect(a.int(0, 99)).toBe(b.int(0, 99))
  })

  it('换区间不是恒值：int(0,1) 的 0 与 1 都出现', () => {
    const rng = new Rng('int-binary')
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(rng.int(0, 1))
    expect([...seen].sort()).toEqual([0, 1])
  })
})
