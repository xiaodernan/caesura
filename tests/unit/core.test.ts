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
