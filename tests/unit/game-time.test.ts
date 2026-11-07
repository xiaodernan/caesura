import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, msToTicks, ticksToMs, TICK_HZ, TICK_DT } from '@/core/Time'

/**
 * `src/core/Time.ts`：全局时钟（KI-349 起停顿是状态频道，读方写边沿）。
 *
 * 判据：
 * - `paused = true` ⇒ dt 恒 0
 * - `hitStop(d, s)`：非正数时长/暂停中 ⇒ 没发生；否则 scale 设为 s、剩余延长（取 max）
 * - 归零那一刻第一次 step 报 `active: false`；停着的时候不重复报
 * - 叠加一次：延长，不重复报 true
 * - `reset()`：一切归零，若有停顿则报一次 false
 */

describe('msToTicks / ticksToMs / 常量', () => {
  it('msToTicks(100) = 6 拍；ticksToMs(6) = 100ms；TICK_DT = 1/60', () => {
    expect(msToTicks(100)).toBe(6)
    expect(ticksToMs(6)).toBeCloseTo(100, 10)
    expect(TICK_DT).toBeCloseTo(1 / 60, 12)
    expect(TICK_HZ).toBe(60)
  })
})

describe('GameTime：dt / animSeconds / rawScale', () => {
  it('初始：scale=1、dt=TICK_DT、paused=false', () => {
    const t = new GameTime()
    expect(t.dt).toBeCloseTo(TICK_DT, 12)
    expect(t.rawScale).toBe(1)
    expect(t.paused).toBe(false)
    expect(t.animSeconds).toBe(0)
  })

  it('paused=true ⇒ dt 恒 0', () => {
    const t = new GameTime()
    t.paused = true
    expect(t.dt).toBe(0)
  })
})

describe('GameTime：step 与 hitStop 频道', () => {
  it('step 累加 realSeconds；停顿结束后 scale=1 且报一次 false', () => {
    const t = new GameTime()
    let reported = false
    const off = bus.on('time.hitStop', (p) => { if (!p.active) reported = true })
    t.hitStop(0.2, 0.05) // 0.2s 停，scale=0.05
    expect(t.dt).toBeCloseTo(TICK_DT * 0.05, 12)
    t.step(0.1) // 还要 0.1s
    expect(t.dt).toBeCloseTo(TICK_DT * 0.05, 12)
    t.step(0.1) // 归零
    expect(t.rawScale).toBe(1)
    expect(t.dt).toBeCloseTo(TICK_DT, 12)
    expect(reported).toBe(true) // 归零那一下报了 false
    off()
  })

  it('hitStop 非正时长（0 / NaN）⇒ 什么都不发生', () => {
    const t = new GameTime()
    let trueCount = 0
    const off = bus.on('time.hitStop', (p) => { if (p.active) trueCount++ })
    t.hitStop(0)
    t.hitStop(Number.NaN)
    t.hitStop(-0.5)
    expect(t.rawScale).toBe(1)
    expect(trueCount).toBe(0)
    expect(t.dt).toBeCloseTo(TICK_DT, 12)
    off()
  })

  it('paused 时 hitStop 不生效', () => {
    const t = new GameTime()
    t.paused = true
    let trueCount = 0
    const off = bus.on('time.hitStop', (p) => { if (p.active) trueCount++ })
    t.hitStop(1, 0.01)
    expect(t.rawScale).toBe(1)
    expect(trueCount).toBe(0)
    off()
  })

  it('停顿叠加 = 延长（取 max），不重复报 true', () => {
    const t = new GameTime()
    let trueCount = 0
    const off = bus.on('time.hitStop', (p) => { if (p.active) trueCount++ })
    t.hitStop(0.1, 0.05) // 第一次：报 true
    t.hitStop(0.5, 0.05) // 延长到 0.5：不再报
    expect(trueCount).toBe(1)
    t.step(0.3) // 0.2 还没归零（0.5-0.3）
    expect(t.rawScale).toBe(0.05)
    t.step(0.25) // 归零
    expect(t.rawScale).toBe(1)
    off()
  })

  it('reset：归零并停一次（若有停顿，报一次 false）', () => {
    const t = new GameTime()
    let falseCount = 0
    const off = bus.on('time.hitStop', (p) => { if (!p.active) falseCount++ })
    t.hitStop(1, 0.05)
    t.step(0.5) // 还没结束
    t.reset()
    expect(t.rawScale).toBe(1)
    expect(t.paused).toBe(false)
    expect(falseCount).toBe(1) // reset 报了一次 false
    off()
  })
})
