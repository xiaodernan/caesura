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

/**
 * **把墙钟钉死**（KI-171）：`performance.now` 由测试接管，返回一个**不动**的数。
 * 归还的办法原样留着（`configurable: true` ⇒ 同一个属性可以再定义回去）。
 *
 * 为什么需要它：`GameLoop.start()` 记的 `last` 与测试取的基址若是两次不同的墙钟读数，
 * 两次读数之间卡过一拍（16.7ms）补帧就会多跑一格 ⇒ 那条腿数的是"恰好几格"⇒ 机器一卡就红。
 * 钉死之后基址与 `last` 是同一个数 ⇒ 读数与机器快慢无关。
 */
function freezeClock(at: number): () => void {
  const real = performance.now.bind(performance)
  Object.defineProperty(performance, 'now', { configurable: true, value: () => at })
  return () => {
    Object.defineProperty(performance, 'now', { configurable: true, value: real })
  }
}

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
    /**
     * **墙钟由这条腿自己给**（KI-171）：这条腿数的是"两帧之间推进了几格 tick"，
     * 而 `GameLoop.start()` 记的 `last` 取的是**当时的墙钟**——两者若是两次不同的读数，
     * 中间卡过一拍（16.7ms）补帧就会多跑一格 ⇒ 机器一卡这条腿就红（KI-171 登记的那次红就是它）。
     * ⇒ **把墙钟钉死**（`performance.now` 由测试接管），基址与 `last` 读到的是同一个数 ⇒ 读数确定。
     */
    const restore = freezeClock(1000)
    try {
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
    } finally {
      restore()
    }
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
