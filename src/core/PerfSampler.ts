/**
 * 帧时间与耗时分段的最小采样器（技术架构 §5.7「不要猜性能」的那半句：先有读数，再有结论）。
 *
 * 它是**逻辑层**的：不认识 three、不认识 DOM、不生成一个字（文本装配住在
 * `tools/PerfDebugger.ts`，与 F1/F3/F4 三块面板同一套规矩）。
 *
 * **两道开关是两个不同的东西**，不要混：
 * - `GameLoop` 有没有装采样器（`main.ts` 只在 DEV 构建里装）⇒ 没装时 `tickFrame` 连一次
 *   额外的 `performance.now()` 都不叫；
 * - 装了就等于要采吗 ⇒ 不等于。面板**关着**时 `armed` 是 false，`frame()` 直接 return、
 *   `span()` 只把回调原样叫一遍（一次函数调用，零次计时）。默认全关是这块面板的存在理由，
 *   与 `DebugPanel.refresh()`「关着的时候一个字符串都不生成」同一条纪律。
 *
 * **P50/P90/P99 用的是最近秩（nearest-rank，向上取秩）**：排序后取第 `ceil(p·n)` 个样本**自己**
 * （不做线性插值）。为什么钉这个而不是"平均分位"：插值法在 n 小时会把一个根本没发生过的数报成
 * "P99"，而这一格要读的正是"最坏那 1% 到底多坏"。样本不足时读数如实标 `n`，不许用"窗口没满"
 * 的红字去猜。窗口 `FRAME_WINDOW` ＝ 300 帧（≈5s@60fps）：P99 至少要 100 个样本才谈得上分位。
 */

/** 帧样本的滚动窗口（300 帧 ≈ 5 秒@60fps；见文件头的理由） */
export const FRAME_WINDOW = 300
/** 分段耗时的平滑因子：EMA，60 帧 ≈ 1 秒（分段要的是"现在谁在吃帧"，不是历史总量） */
export const SPAN_EMA_ALPHA = 1 / 60
/** §5.3 的帧预算（16.6ms 里 CPU ≤6ms／GPU ≤12ms）——面板只报读数，超没超由这两格判 */
export const BUDGET_CPU_MS = 6
export const BUDGET_GPU_MS = 12

export interface FrameSample {
  /** 这一帧的真实间隔（ms）：掉帧先看它，不看 fps 那个平均数 */
  deltaMs: number
  /** 逻辑段：time.step ＋ input.poll ＋ 所有 system 的 update/postTick */
  logicMs: number
  /** 渲染段：system 的 render ＋组合根的 onRender */
  renderMs: number
  /** 这一帧补跑了几拍（0＝没有逻辑要跑） */
  ticks: number
  /** 死循环闸门这一次真的落下去了（accumulator 被清零 ⇒ 有拍被丢掉，不是慢慢追） */
  truncated: boolean
}

export interface SpanReading {
  name: string
  /** 每拍（或每帧）这一段的 EMA 毫秒数 */
  avgMs: number
  /** EMA 的"这一段被叫了几次"——AI 每拍一次、渲染每帧一次，不数它就分不开 */
  callsPerWindow: number
  /** 开窗以来的最坏一记（EMA 会把尖峰抹平，尖峰才是这一格要找的东西） */
  maxMs: number
}

export interface PerfSnapshot {
  /** 窗口里现有多少帧样本（没满 300 就是"刚开面板"，读数要跟着 n 一起读） */
  samples: number
  /** 面板开着一共采了几帧（重锚定次数读的是这个总数，不是窗口里那 300 个） */
  frames: number
  /** 窗口内平均帧间隔折算的 fps（与 P50 是两个数：平均值会把尖峰摊平） */
  fps: number
  frameMs: { p50: number; p90: number; p99: number; max: number }
  logicMs: { p50: number; p99: number }
  renderMs: { p50: number; p99: number }
  /** 每帧补跑的拍数：平均与最坏（§5.5 的 catch-up 口径） */
  ticksPerFrame: { avg: number; max: number }
  /** 落后到被截断的次数（重锚定闸门真的落下来了） */
  truncated: number
  spans: SpanReading[]
}

export class PerfSampler {
  /** 面板开着才采样；false 时 `frame()`/`span()` 都只付一次函数调用的钱 */
  armed = false

  private readonly delta: number[] = []
  private readonly logic: number[] = []
  private readonly render: number[] = []
  private readonly ticks: number[] = []
  private truncatedCount = 0
  private frameCount = 0
  /** 分段的 EMA 累加器；`calls` 是"这一段被叫了几次"的 EMA 平滑值 */
  private readonly spans = new Map<string, { avg: number; calls: number; max: number }>()

  /** 面板打开：窗口清空——旧样本属于上一现场，混着报会让 P99 说得不是这一次的事 */
  open(): void {
    this.armed = true
    this.reset()
  }

  /** 面板关闭：一个数也不留（默认全关，见文件头） */
  close(): void {
    this.armed = false
    this.reset()
  }

  private reset(): void {
    this.delta.length = 0
    this.logic.length = 0
    this.render.length = 0
    this.ticks.length = 0
    this.spans.clear()
    this.truncatedCount = 0
    this.frameCount = 0
  }

  /** 每帧一次（`GameLoop.tickFrame` 的唯一出口）。关着时立刻 return，一次计时都不付。 */
  frame(s: FrameSample): void {
    if (!this.armed) return
    this.frameCount++
    pushWindow(this.delta, s.deltaMs)
    pushWindow(this.logic, s.logicMs)
    pushWindow(this.render, s.renderMs)
    pushWindow(this.ticks, s.ticks)
    if (s.truncated) this.truncatedCount++
  }

  /**
   * 分段计时。关着时它就是 `fn()` 本身（不叫 `now()`、不记账）——所以生产热路径上的代价是
   * "一次属性读 ＋ 一次函数调用"，而这一条有腿守着（见 `tests/unit/perf-sampler.test.ts`）。
   */
  span<T>(name: string, fn: () => T): T {
    if (!this.armed) return fn()
    const t0 = performance.now()
    const out = fn()
    const ms = performance.now() - t0
    const cur = this.spans.get(name) ?? { avg: 0, calls: 0, max: 0 }
    cur.avg += (ms - cur.avg) * SPAN_EMA_ALPHA
    cur.calls += (1 - cur.calls) * SPAN_EMA_ALPHA
    cur.max = Math.max(cur.max, ms)
    this.spans.set(name, cur)
    return out
  }

  /** 面板唯一的读数口：纯数，不含任何一个字 */
  snapshot(): PerfSnapshot {
    const n = this.delta.length
    const frame = sorted(this.delta)
    const logic = sorted(this.logic)
    const render = sorted(this.render)
    const mean = n === 0 ? 0 : this.delta.reduce((a, b) => a + b, 0) / n
    const tickMean = this.ticks.length === 0 ? 0
      : this.ticks.reduce((a, b) => a + b, 0) / this.ticks.length
    return {
      samples: n,
      frames: this.frameCount,
      fps: mean === 0 ? 0 : 1000 / mean,
      frameMs: {
        p50: nearestRank(frame, 0.5),
        p90: nearestRank(frame, 0.9),
        p99: nearestRank(frame, 0.99),
        max: n === 0 ? 0 : frame[n - 1],
      },
      logicMs: { p50: nearestRank(logic, 0.5), p99: nearestRank(logic, 0.99) },
      renderMs: { p50: nearestRank(render, 0.5), p99: nearestRank(render, 0.99) },
      ticksPerFrame: { avg: tickMean, max: n === 0 ? 0 : Math.max(...this.ticks) },
      truncated: this.truncatedCount,
      spans: [...this.spans.entries()]
        .map(([name, v]) => ({ name, avgMs: v.avg, callsPerWindow: v.calls, maxMs: v.max }))
        .sort((a, b) => b.avgMs - a.avgMs),
    }
  }
}

/** 环形窗口在这里用数组做：超过 300 个样本再 shift 一次，60Hz 下每帧一次 O(300) 以内，读的人只有面板 */
function pushWindow(w: number[], v: number): void {
  w.push(v)
  if (w.length > FRAME_WINDOW) w.shift()
}

/** 每次都用同一把尺：先排序再按秩取（复制一份，采样数组自己是喂下一个分位的） */
function sorted(w: number[]): number[] {
  return [...w].sort((a, b) => a - b)
}

/** 最近秩（向上取秩）：第 ceil(p·n) 个样本自己 */
function nearestRank(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  return sortedAsc[Math.max(0, Math.ceil(p * n) - 1)]
}
