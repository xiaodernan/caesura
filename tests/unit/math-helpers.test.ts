/**
 * `core/Math` 的纯函数助手闸门（clamp / lerp / damp / mulberry32 / hashString）。
 *
 * `tests/unit/core.test.ts` 只从 `@/core/Math` 取了 `Rng`，其余纯助手**一个断言都没有**——
 * 其中 `damp` 是被动画/相机/插值各处共用的「帧率无关指数平滑」，它的核心契约是
 * 「把同一段总时间切成不同步数，收敛到（近似）同一处」。一旦有人把它偷写成
 * `lerp(a,b,λ·dt)`，这条性质当场破掉、且肉眼看不出（单步都对，只是帧率一变就飘），
 * 所以必须有证人。clamp/lerp 是它俩的零件，顺手钉端点。mulberry32 / hashString 是
 * `Rng` 的底层，确定性那条已由 `core.test.ts` 锁，这里只补「字符串种子走 hashString、
 * 同一字符串 ⇒ 同一种子」这一格（存档按串接随机的入口，需求 §10）。
 *
 * 全内联、不读数据表、不碰任何并行会话在途文件（新建文件，零冲突）。
 */
import { describe, expect, it } from 'vitest'
import { Rng, clamp, lerp, damp, mulberry32, hashString } from '@/core/Math'

describe('clamp / lerp：零件端点正确', () => {
  it('clamp：低于下界夹到下界、高于上界夹到上界、区间内原样、恰好在边界也夹住', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(0, 0, 10), '恰好落在下界').toBe(0)
    expect(clamp(10, 0, 10), '恰好落在上界').toBe(10)
  })

  it('lerp：t=0 取 a、t=1 取 b、中点取半', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.5)).toBe(5)
    expect(lerp(2, 4, 0.25)).toBeCloseTo(2.5)
  })
})

describe('damp：帧率无关指数平滑（被动画/相机共用的插值腿）', () => {
  it('dt=0 ⇒ 不动（没有时间流逝就不该移动）', () => {
    expect(damp(3, 100, 5, 0)).toBe(3)
    expect(damp(-2, 8, 0.3, 0)).toBe(-2)
  })

  it('lambda=0 ⇒ 永不收敛（停在原地，不漂向 b）', () => {
    expect(damp(1, 50, 0, 0.1)).toBe(1)
  })

  it('单步朝 b 移动一部分，且严格落在 a 与 b 之间', () => {
    const v = damp(0, 10, 5, 0.1)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(10)
    expect(v, '朝 b 走了一截').toBeGreaterThan(1) // λ=5,dt=0.1 ⇒ 1-exp(-0.5)≈0.393 ⇒ ≈3.93
    expect(v).toBeCloseTo(10 * (1 - Math.exp(-0.5)))
  })

  it('步与步之间单调收敛：连续应用严格趋近 b', () => {
    let v = 0
    const b = 10
    for (let i = 0; i < 6; i++) {
      const next = damp(v, b, 5, 0.1)
      expect(next, `第 ${i} 步仍严格朝 b`).toBeGreaterThan(v)
      expect(next).toBeLessThan(b)
      v = next
    }
  })

  it('大 dt ⇒ 几乎到位（1-exp(-大)≈1），不会越过 b', () => {
    expect(damp(0, 10, 5, 10)).toBeCloseTo(10, 5)
    expect(damp(0, 10, 5, 10)).toBeLessThanOrEqual(10)
  })

  it('帧率无关：同一总时长切成不同步数 ⇒ 结果一致（这条是 damp 存在的全部理由）', () => {
    const a = 0, b = 10, lambda = 5
    const oneShot = damp(a, b, lambda, 0.1)
    // 两半
    const half1 = damp(a, b, lambda, 0.05)
    const twoStep = damp(half1, b, lambda, 0.05)
    expect(twoStep, '0.1 = 0.05+0.05，两步走应等于一步走').toBeCloseTo(oneShot, 10)
    // 十份
    let ten = a
    for (let i = 0; i < 10; i++) ten = damp(ten, b, lambda, 0.01)
    expect(ten, '0.1 = 10×0.01，十步走也应等于一步走').toBeCloseTo(oneShot, 6)
    // 反例证明这条不是空断言：若实现是 lerp(a,b,λ·dt)，两步会不同（写到 0.1 与 0.05+0.05 不等）
    const naive = (x: number, dt: number) => lerp(x, b, lambda * dt)
    const naiveOne = naive(a, 0.1)
    const naiveTwo = naive(naive(a, 0.05), 0.05)
    expect(naiveOne, 'naive lerp 形式不帧率无关，两步走 ≠ 一步走（用于证明上面那条真在测）')
      .not.toBeCloseTo(naiveTwo, 10)
  })
})

describe('mulberry32 / hashString：Rng 的底层确定性', () => {
  it('mulberry32 同种子 ⇒ 同序列，异种子 ⇒ 发散', () => {
    const f = mulberry32(12345)
    const g = mulberry32(12345)
    for (let i = 0; i < 5; i++) expect(f()).toBe(g())
    // 不同种子应当发散：5 个抽样里全撞中的概率极低，要求"不全撞"
    const seqA = mulberry32(12345)
    const seqB = mulberry32(99999)
    let same = 0
    for (let i = 0; i < 5; i++) if (seqA() === seqB()) same++
    expect(same, '两个不同种子基本不会前 5 个全撞').toBeLessThan(5)
  })

  it('hashString：同一字符串 ⇒ 同种子（存档按串接随机的入口，需求 §10）', () => {
    expect(hashString('origin_tuner')).toBe(hashString('origin_tuner'))
    expect(hashString('a')).not.toBe(hashString('b'))
    // 与 Rng 的字符串种子口径对账：同串 ⇒ 同第一抽
    const ra = new Rng('seed-z')
    const rb = new Rng('seed-z')
    expect(ra.float()).toBe(rb.float())
  })
})
