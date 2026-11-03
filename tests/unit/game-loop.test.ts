import { describe, expect, it, afterEach } from 'vitest'
import { GameLoop, type Updatable } from '@/core/GameLoop'
import { PerfSampler } from '@/core/PerfSampler'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'

/**
 * GameLoop：rAF 驱动与 headless 步进的交界。
 *
 * 覆盖缺口（start/stop 的 rAF 腿 + fps 窗口）：
 * - start 两次 ⇒ 第二次是空操作（running 守卫），只排一个 rAF
 * - 排到的 step 回调真的推进 tick；stop 后回调不再推进、raf 被取消
 * - 61 帧后 fps 窗口出数（60fps ⇒ 60）——KI-335 之后这一格住在采样器里，这里的腿因此变成
 *   「环把数交给装进来的采样器」那条**接线**腿，采样器自己的账在 `perf-sampler.test.ts`
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

  it('61 帧后 fps 窗口出数：每帧 1/60 ⇒ fps 60（KI-335：这一格从 `frameSample` 搬进采样器）', () => {
    installRaf()
    const time = new GameTime()
    const perf = new PerfSampler()
    perf.open()
    const loop = new GameLoop(time, fakeInput(), () => {}, perf)
    for (let i = 0; i < 61; i++) loop.tickFrame(TICK_DT)
    expect(perf.snapshot().fps, '61 帧 × 16.67ms 的窗口平均').toBeCloseTo(60, 6)
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

/**
 * 一帧的账（KI-347）：什么样的 `realDelta` 算走过一拍、抛出算不算把循环结束掉。
 *
 * 这两件事此前没有主人，后果是在真页面上量到的（配方见 `docs/WORKPLAN.md` 的量测配方）：
 * 一次 `tickFrame(NaN)` 之后 `accumulator` 永久是 NaN ⇒ 逻辑钟从此 0 拍，且 HUD 里那一格
 * 派生出的颜色变成 `rgba(...,NaN)` ⇒ 之后**每一帧**都抛；一次 `tickFrame(-5)` 之后连着
 * 120 帧健康帧仍推进 0 拍。而抛出逃出 `tickFrame` 时，`step` 里那句
 * `requestAnimationFrame(step)` 根本执行不到 ⇒ 循环静默死掉，`running` 还挂着 true，
 * `start()` 因此永远拒绝重启。
 */
describe('GameLoop：坏 delta 与抛出的一帧账（KI-347）', () => {
  it('非有限的 realDelta 被吃掉而不是被咽下去：那一帧不进时钟，之后每一帧仍然算数', () => {
    const time = new GameTime()
    const loop = new GameLoop(time, fakeInput(), () => {})
    for (let i = 0; i < 20; i++) expect(loop.tickFrame(TICK_DT)).toBe('ran')
    const t0 = time.tick
    expect(loop.tickFrame(NaN), '拒绝要能被调用方读到，不是悄悄当它没发生').toBe('rejected')
    expect(time.tick, '拒绝那一帧时钟一格都不动').toBe(t0)
    expect([loop.rejectedDeltas, Object.is(loop.lastRejectedDelta, NaN)], 'NaN 那一格要留得下来（它不等于任何数，包括自己）').toEqual([1, true])
    expect(loop.tickFrame(Infinity)).toBe('rejected')
    expect([loop.rejectedDeltas, String(loop.lastRejectedDelta)], '留的是最后那一个').toEqual([2, 'Infinity'])
    for (let i = 0; i < 120; i++) loop.tickFrame(TICK_DT)
    expect(time.tick - t0, '老写法到这里是 0 拍（永久毒化），现在 120 帧走满 120 拍').toBe(120)
  })

  it('负的那一个同样被吃掉：它不是"补帧"，是往回拨钟（一次 -5 会让之后 120 帧 0 拍）', () => {
    const time = new GameTime()
    const loop = new GameLoop(time, fakeInput(), () => {})
    loop.tickFrame(TICK_DT)
    expect(loop.tickFrame(-5)).toBe('rejected')
    expect(loop.lastRejectedDelta, 'NaN 与 -5 是两种病 ⇒ 那一格要留得下负数').toBe(-5)
    expect(loop.rejectedDeltas).toBe(1)
    const t0 = time.tick
    for (let i = 0; i < 120; i++) loop.tickFrame(TICK_DT)
    expect(time.tick - t0).toBe(120)
  })

  it('被吃掉的那一帧不进 fps 窗口：窗口里的每一条都是真走过的帧', () => {
    const time = new GameTime()
    const perf = new PerfSampler()
    perf.open()
    const loop = new GameLoop(time, fakeInput(), () => {}, perf)
    for (const d of [10, 20, 30]) perf.frame({ deltaMs: d, logicMs: 1, renderMs: 2, ticks: 1, truncated: false })
    const before = perf.snapshot().samples
    loop.tickFrame(NaN)
    loop.tickFrame(TICK_DT)
    const s = perf.snapshot()
    expect(s.samples, '一次 NaN 不该在窗口里留下一条假帧').toBe(before + 1)
    expect(Number.isFinite(s.fps), '老写法里 NaN 进窗口 ⇒ fps 永久不是数').toBe(true)
  })

  it('渲染段抛出不是循环结束：记一笔账，下一帧照样排、照样画、照样进窗口', () => {
    installRaf()
    const time = new GameTime()
    const perf = new PerfSampler()
    perf.open()
    let renders = 0
    const sys: Updatable = { update: () => {}, render: () => { renders++; if (renders === 2) throw new TypeError('那一帧画不出来') } }
    const loop = new GameLoop(time, fakeInput(), () => {}, perf)
    loop.add(sys)
    const rafBefore = rafIds
    loop.start()
    const cb = rafCb!
    const base = performance.now()
    cb(base + TICK_DT * 1000)
    cb(base + 2 * TICK_DT * 1000)
    cb(base + 3 * TICK_DT * 1000)
    expect([renders, loop.renderFaults], '抛出之后第三帧仍被画到').toEqual([3, 1])
    expect(loop.lastRenderFault).toBe('TypeError: 那一帧画不出来')
    expect(loop.running, '渲染抛出不许把 running 拨假').toBe(true)
    expect(rafIds, 'RAF 那一串还在续排').toBeGreaterThan(rafBefore + 2)
    expect(perf.snapshot().samples, '坏掉画面的那一帧仍然是一帧（时间真的过去了）').toBe(3)
    loop.stop()
  })

  it('逻辑段抛出停在真话上：往上交、账上留痕、running 改成假，于是 start() 还起得来', () => {
    installRaf()
    const time = new GameTime()
    let faulted = false
    const sys: Updatable = { update: () => { if (!faulted) throw new Error('模拟状态不可信') }, render: () => {} }
    const loop = new GameLoop(time, fakeInput(), () => {})
    loop.add(sys)
    loop.start()
    const cb = rafCb!
    const beforeThrow = rafIds
    expect(() => cb(performance.now() + TICK_DT * 1000), '抛出往上交：这一层不许把它折成"什么都没发生"').toThrow('模拟状态不可信')
    expect([loop.logicFaults, loop.lastLogicFault], '但它同时要在账上留痕').toEqual([1, 'Error: 模拟状态不可信'])
    expect(rafIds, '抛出之后确实没再排帧——停是真的停').toBe(beforeThrow)
    expect(loop.running, '停了就必须说停了 ⇒ 这一格是"还能不能重启"的主人').toBe(false)
    faulted = true
    const beforeRestart = rafIds
    loop.start()
    expect(loop.running).toBe(true)
    expect(rafIds, '老写法到这里是永久不可恢复（running 一直挂着 true ⇒ start 空转）').toBe(beforeRestart + 1)
    rafCb!(performance.now() + TICK_DT * 1000)
    expect(time.tick, '重启之后模拟真的在走').toBeGreaterThan(0)
    loop.stop()
  })

  it('抛出物不是 Error 也要有名字：那一格印的是 String(e)，不是 undefined', () => {
    const time = new GameTime()
    const loop = new GameLoop(time, fakeInput(), () => {})
    loop.add({ update: () => {}, render: () => { throw '一句裸字符串' } })
    loop.tickFrame(TICK_DT)
    expect(loop.lastRenderFault, '`throw "x"` 那种东西也得进账').toBe('一句裸字符串')
    expect(loop.renderFaults).toBe(1)
  })
})
