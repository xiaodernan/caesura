/**
 * `core/Pool` 的复用 / 容量契约闸门（纯逻辑、零 three、headless 可量）。
 *
 * `tests/unit/core-misc.test.ts` 只钉了 `stats` getter 的形状（live/free/cap），
 * 没锁住两条「一旦悄悄坏掉就会出事」的行为：
 *  ① 复用：池子满了之后 `obtain()` 必须从 `free` 里 pop 复用，而不是无限制地再 `factory()`
 *     ——否则「对象池」退化成「每帧 new」，正是它要挡的那一类 GC 抖动。
 *  ② `resetItem` 必须在每一次 `obtain()`（含复用）都跑——复用不重置 ⇒ 上一任的状态泄露给下一任。
 *  ③ `cap` 上限：池满之后 `release()` 那一项**丢地丢弃**（不 push 回 free），free 长度永远 ≤ cap。
 *     「丢弃」是显式选择（宁可让对象被 GC，也不让 free 数组无限涨），这一格必须有证人，
 *     否则有人「顺手」改成无脑 push，池就失去了上限意义。
 *  ④ `live` 永不为负、`peak` 是见到过的最大 live。
 *
 * 全用内联夹具，不碰任何并行会话在途的数据表 / 源文件（本文件与它 WIP 零冲突）。
 */
import { describe, expect, it } from 'vitest'
import { Pool } from '@/core/Pool'

interface Item { tag: number; resets: number }

/** 构造一个可观测的池：factory/reset 各带计数器，便于断言「真的复用 / 真的重置」 */
function observablePool(cap: number) {
  let created = 0
  let resetCalls = 0
  const pool = new Pool<Item>(
    () => { created++; return { tag: created, resets: 0 } },
    (it) => { resetCalls++; it.resets++ },
    cap
  )
  return {
    pool,
    get created() { return created },
    get resetCalls() { return resetCalls },
  }
}

describe('Pool：复用契约（池满后 obtain 必须复用，不许无限制 factory）', () => {
  it('cap=2：拿到 3 个再还回，第 3 次 obtain 复用而非新建 ⇒ factory 只被叫 2 次', () => {
    const p = observablePool(2)
    const a = p.pool.obtain()
    const b = p.pool.obtain()
    expect(p.created).toBe(2) // 前两发各 new 一次
    p.pool.release(a)
    p.pool.release(b)
    const c = p.pool.obtain() // 池里有，应当 pop 复用
    expect(p.created, '复用 ⇒ factory 调用数不涨').toBe(2)
    expect(c.resets, '复用那一次也走了 resetItem').toBeGreaterThanOrEqual(1)
    expect(p.pool.stats.live).toBe(1)
    expect(p.pool.stats.free).toBe(1)
  })

  it('反复借还：factory 调用数随在途峰值封顶，不随总借出数线性增长', () => {
    const p = observablePool(3)
    for (let round = 0; round < 50; round++) {
      const held = [p.pool.obtain(), p.pool.obtain(), p.pool.obtain()]
      for (const h of held) p.pool.release(h)
    }
    // 在途峰值 = 3（cap），所以无论借出 150 次，factory 最多 new 3 个
    expect(p.created).toBe(3)
    expect(p.pool.stats.live).toBe(0)
    expect(p.pool.stats.free).toBe(3)
    expect(p.pool.stats.peak).toBe(3)
  })
})

describe('Pool：resetItem 在每一次 obtain（含复用）都跑', () => {
  it('借出→归还→再借同一对象：resets 累计 2，证明复用也重置了', () => {
    const p = observablePool(2)
    const a = p.pool.obtain()
    const firstTag = a.tag
    expect(a.resets).toBe(1)
    p.pool.release(a)
    const b = p.pool.obtain() // 复用 a
    expect(b.tag, '确实复用了同一实例').toBe(firstTag)
    expect(b.resets, '复用那一次 resetItem 又跑了一遍').toBe(2)
    expect(p.resetCalls, '两次 obtain 对应两次 reset').toBe(2)
  })
})

describe('Pool：cap 上限——池满后 release 丢弃多余项（free 长度永不超过 cap）', () => {
  it('cap=2：obtain 3 个、release 全部 ⇒ free 停在 2、第 3 个被丢弃（不保留）', () => {
    const p = observablePool(2)
    const a = p.pool.obtain()
    const b = p.pool.obtain()
    const c = p.pool.obtain()
    expect(p.created).toBe(3) // 三发都是 new（池还没东西可复用）
    expect(p.pool.stats.live).toBe(3)
    p.pool.release(a)
    p.pool.release(b)
    p.pool.release(c) // free 已满（2）⇒ 这一项被丢弃
    expect(p.pool.stats.live).toBe(0)
    expect(p.pool.stats.free, 'free 长度被 cap 卡住，多余的被丢').toBe(2)
    expect(p.pool.stats.cap).toBe(2)
    // 再借两发：应该能从 free 里复用那两个，不会再超 cap
    p.pool.obtain()
    p.pool.obtain()
    expect(p.pool.stats.free).toBe(0)
    expect(p.pool.stats.live).toBe(2)
  })

  it('默认 cap=2048：把池推到上限以上，free 仍封顶在 2048', () => {
    const p = observablePool(2048)
    const items = Array.from({ length: 2100 }, () => p.pool.obtain())
    for (const it of items) p.pool.release(it)
    expect(p.pool.stats.free).toBe(2048)
    expect(p.pool.stats.live).toBe(0)
  })
})

describe('Pool：live / peak 计数器契约', () => {
  it('live 随借还正确增减、peak 是见到过的最大 live', () => {
    const p = observablePool(4)
    p.pool.obtain(); p.pool.obtain() // live=2, peak=2
    const x = p.pool.obtain(); p.pool.obtain() // live=4, peak=4
    expect(p.pool.stats.peak).toBe(4)
    p.pool.release(x) // live=3
    expect(p.pool.stats.live).toBe(3)
    expect(p.pool.stats.peak, 'peak 不随回落而变小').toBe(4)
    p.pool.obtain() // live=4, peak 仍是 4（没超过见过的最大值）
    expect(p.pool.stats.peak).toBe(4)
    expect(p.pool.stats.live).toBe(4)
  })
})
