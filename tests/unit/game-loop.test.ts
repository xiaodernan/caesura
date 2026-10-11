import { describe, expect, it, afterEach } from 'vitest'
import { GameLoop, type Updatable } from '@/core/GameLoop'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'

/**
 * GameLoop：rAF 驱动与 headless 步进的交界。
 *
 * 覆盖缺口（start/stop 的 rAF 腿 + fps 窗口）：
 * - start 两次 ⇒ 第二次是空操作（running 守卫），只排一个 rAF
 * - 排到的 step 回调真的推进 tick；stop 后回调不再推进、raf 被取消
 * - 61 帧后 fps 窗口出数（60fps ⇒ 60）
 *
 * rAF 用最薄的替身：记下回调与 id，测试手动调回调（时间用墙钟 performance.now 做基址，
 * 不靠 rAF 自己推进——headless 里它本来就不会自己走）。
 */

function fakeInput(): Input {
  return {
    frame: { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() },
    enabled: true,
    poll: () => {},
    endTick: () => {},
  } as unknown as Input
}

let rafCb: ((now: number) => void) | null = null
let rafIds = 0
const cancelled: number[] = []
const g = globalThis as unknown as Record<string, unknown>
const realRaf = g.requestAnimationFrame
const realCancel = g.cancelAnimationFrame

function installRaf(): void {
  rafCb = null
  cancelled.length = 0
  g.requestAnimationFrame = (cb: (now: number) => void) => { rafCb = cb; return ++rafIds }
  g.cancelAnimationFrame = (id: number) => { cancelled.push(id) }
}

afterEach(() => {
  g.requestAnimationFrame = realRaf
  g.cancelAnimationFrame = realCancel
})

describe('GameLoop：start/stop 的 rAF 腿', () => {
  it('start 两次 ⇒ 第二次空操作；step 回调推进 tick；stop 后回调停摆且 raf 被取消', () => {
    installRaf()
    const time = new GameTime()
    let updates = 0
    let rendered = 0
    const sys: Updatable = { update: () => { updates++ }, render: () => { rendered++ } }
    const loop = new GameLoop(time, fakeInput(), () => {})
    loop.add(sys)
    const t0 = time.tick
    loop.start()
    const firstCb = rafCb!
    expect(loop.running).toBe(true)
    loop.start()
    expect(rafCb, '第二次 start 不该再排 rAF').toBe(firstCb)
    // start 里 last = 当时墙钟：回调时间从墙钟基址往后量，两帧各走 2 tick
    const base = performance.now()
    firstCb(base + 2 * TICK_DT * 1000)
    firstCb(base + 4 * TICK_DT * 1000)
    expect(time.tick - t0, '两帧 × 2 tick').toBe(4)
    expect(updates).toBe(4)
    expect(rendered).toBe(2)
    loop.stop()
    expect(loop.running).toBe(false)
    expect(cancelled.length).toBe(1)
    firstCb(base + 99999)
    expect(time.tick, 'stop 之后排到的回调是空转').toBe(t0 + 4)
  })

  it('61 帧后 fps 窗口出数：每帧 1/60 ⇒ fps 60', () => {
    installRaf()
    const time = new GameTime()
    const loop = new GameLoop(time, fakeInput(), () => {})
    for (let i = 0; i < 61; i++) loop.tickFrame(TICK_DT)
    expect(loop.frameSample.fps).toBe(60)
  })

  it('add(front) ⇒ 后来者排在最前（解析顺序的裁定口：意图要先于战斗跑）', () => {
    const time = new GameTime()
    const order: string[] = []
    const a: Updatable = { update: () => order.push('a') }
    const b: Updatable = { update: () => order.push('b') }
    const loop = new GameLoop(time, fakeInput(), () => {})
    loop.add(a)
    loop.add(b, true) // 意图那一类要插到最前，不能靠"先加它就一定先跑"的巧合
    loop.tickFrame(TICK_DT)
    expect(order).toEqual(['b', 'a'])
  })

  it('postTick 钩子每 tick 一次，且排在所有 update 之后', () => {
    const time = new GameTime()
    const log: string[] = []
    const sys: Updatable = {
      update: () => log.push('update'),
      postTick: () => log.push('post'),
    }
    const loop = new GameLoop(time, fakeInput(), () => {})
    loop.add(sys)
    loop.tickFrame(TICK_DT * 3)
    expect(log, '3 tick × (update 后 postTick)').toEqual(['update', 'post', 'update', 'post', 'update', 'post'])
  })

  it('一帧欠的账有上限：巨长的 realDelta 只补 5 tick，且不把余量留给下一帧', () => {
    const time = new GameTime()
    const loop = new GameLoop(time, fakeInput(), () => {})
    loop.tickFrame(10) // 10s = 600 tick，远超 maxTicksPerFrame
    expect(time.tick, 'catch-up 上限 5 tick（死亡螺旋守卫）').toBe(loop.maxTicksPerFrame)
    // 余量清零 ⇒ 第二帧从零开始记，不会把 595 tick 的债一路还下去
    const afterFirst = time.tick
    loop.tickFrame(TICK_DT)
    expect(time.tick, '第二帧只走自己那一份').toBe(afterFirst + 1)
  })
})
