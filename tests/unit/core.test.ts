import { describe, expect, it } from 'vitest'
import { Rng } from '@/core/Math'
import { GameTime, TICK_HZ } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'

describe('core determinism', () => {
  it('rng reproducible by seed', () => {
    const a = new Rng('seed-x'), b = new Rng('seed-x')
    for (let i = 0; i < 50; i++) expect(a.float()).toBe(b.float())
  })
  it('hitstop decays with real time, anim scale restored', () => {
    const t = new GameTime()
    t.hitStop(0.1, 0.05)
    expect(t.rawScale).toBe(0.05)
    t.step(0.05)
    expect(t.rawScale).toBe(0.05)
    t.step(0.06)
    expect(t.rawScale).toBe(1)
  })
  it('rhythm clock quantizes beats by logic dt', () => {
    const r = new RhythmClock()
    r.setBpm(60, 4)
    for (let i = 0; i < 60; i++) r.update(1 / 60)
    expect(Math.floor(r.beat)).toBe(1)
    expect(r.onBeat(100)).toBe(true)
  })

  /**
   * §14.5 拍隙的两条原语。它们之所以在时钟上而不是在敌人里：
   * 「它此刻在不在拍隙里」必须对所有实体是同一个答案，否则玩家读到的就不是同一张拍网。
   */
  it('ticksFromBeatPoint 是拍点距离的 V 形：一拍里 0 → 21.4 → 回落', () => {
    const r = new RhythmClock()
    r.setBpm(84, 4)
    const bt = (60 / 84) * TICK_HZ
    expect(r.ticksFromBeatPoint(), '正踩拍点').toBe(0)
    for (let i = 1; i <= 21; i++) {
      r.update(1 / 60)
      expect(r.ticksFromBeatPoint(), `第 ${i} tick`).toBeCloseTo(i, 5)
    }
    r.update(1 / 60)
    expect(r.ticksFromBeatPoint(), '越过半拍后回落：「踩点」是一段区间，不是一个时刻').toBeLessThan(bt / 2)
  })

  it('ticksUntilBeatOn 允许小数拍位，且严格向前量化（§2.1 + §14.5 反相的前提）', () => {
    const bt = (60 / 84) * TICK_HZ
    const r = new RhythmClock()
    r.setBpm(84, 4)
    const HALF = [1.5, 2.5, 3.5, 4.5]
    expect(r.ticksUntilBeatOn(HALF), '0 → 最近的 .5 拍位就是半拍').toBe(Math.round(0.5 * bt))
    r.update((2.6 * 60) / 84)
    expect(r.ticksUntilBeatOn(HALF), '多个目标取最近的那个未来拍位').toBe(Math.round(0.9 * bt))
    const r2 = new RhythmClock()
    r2.setBpm(84, 4)
    r2.update((0.6 * 60) / 84) // 本小节唯一的目标拍位（0.5 处）已经过去了
    const wait = r2.ticksUntilBeatOn([1.5])
    expect(wait, '旧实现在这里当场返回 0（立刻出手），命中帧就漂到拍间——反相读感毁在这里')
      .toBe(Math.round(3.9 * bt))
    r2.update(wait / 60)
    const p = ((r2.beat % 0.5) + 0.5) % 0.5
    expect(Math.min(p, 0.5 - p) * bt, '等待之后落在半拍网格上（取整代价 ≤0.5 tick）').toBeLessThanOrEqual(0.5)
  })
})

/**
 * `Rng.weighted` 的读方。注释里那句"weights need not sum to 1"是它的全部契约，
 * 而掉落表从来就不凑 1（三张 Boss 表的 rolls 权重是 40/25/15 一类的数）——
 * 所以这里量的是三件事：比重真的按总和切；`draw()` 的计数让存档接得回去；
 * 以及循环走完时那条兜底（浮点把余量 rounding 成正的那一格，与空名单）。
 */
describe('Rng.weighted：权重不必凑 1', () => {
  const items = [{ item: 'a', weight: 3 }, { item: 'b', weight: 1 }]

  it('权重和不必是 1：按占总和的比重切段，[3,1] 就是 75/25', () => {
    const rng = new Rng('weighted')
    let a = 0
    const N = 4000
    for (let i = 0; i < N; i++) if (rng.weighted(items) === 'a') a++
    expect(a / N, '3:1 ⇒ 三项里中 a 的四分之三').toBeGreaterThan(0.72)
    expect(a / N).toBeLessThan(0.78)
    // 反向：把权重对调，比重也跟着对调——量的确实是权重，不是"第一个"
    const flip = [{ item: 'a', weight: 1 }, { item: 'b', weight: 3 }]
    const r2 = new Rng('weighted')
    let a2 = 0
    for (let i = 0; i < N; i++) if (r2.weighted(flip) === 'a') a2++
    expect(a2 / N, '1:3 ⇒ a 只剩四分之一').toBeGreaterThan(0.22)
    expect(a2 / N).toBeLessThan(0.28)
  })

  it('一次加权只抽一笔：存档接回去 ⇒ 同一个选择（drop 表复现的前提）', () => {
    const a = new Rng('replay')
    a.float()
    a.chance(0.5) // 先走两笔，让快照落在"局中"
    const snap = a.state()
    const first = a.weighted(items)
    const second = a.weighted(items)
    const b = new Rng('另一串完全不同的种子')
    b.restore(snap)
    expect(b.weighted(items), '接回第几笔 ⇒ 之后每一笔都重演').toBe(first)
    expect(b.weighted(items)).toBe(second)
  })

  it('兜底腿：浮点把余量 rounding 成非负时回到最后一项；空名单则当场抛', () => {
    // 权重和为负 ⇒ draw()*total 落在负半轴，逐项减完仍是正的 ⇒ 循环一次都不 return，
    // 走到最后那句。这一格是浮点安全网，正常表（权重和为正）永远走不到它。
    const rng = new Rng('fallback')
    expect(rng.weighted([{ item: 'only', weight: -5 }]), '循环耗尽 ⇒ 最后一项').toBe('only')

    // 空名单没有"最后一项"可回：`items[-1].item` 直接抛。登记这个前提——
    // weighted 不许喂空表（与 addPoise 没上弦就抛同一族：调用方违约时响亮地失败）。
    expect(() => new Rng('empty').weighted([])).toThrow()
  })
})
