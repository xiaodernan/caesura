import { GameTime, TICK_DT } from './Time'
import { Input } from './Input'
import type { PerfSampler } from './PerfSampler'

export interface Updatable {
  /** one fixed 60Hz logic tick */
  update(dt: number, time: GameTime, input: Input): void
  /** called after all updates in a tick (resolution order: intent -> movement -> combat -> ai -> camera) */
  postTick?(time: GameTime): void
  /** render-rate interpolation hook (alpha in [0,1)) */
  render?(alpha: number, realDelta: number): void
}

export class GameLoop {
  private systems: Updatable[] = []
  private accumulator = 0
  private rafId = 0
  private last = 0
  running = false
  /** max catch-up ticks per frame (death-spiral guard) */
  maxTicksPerFrame = 5

  constructor(
    private time: GameTime,
    private input: Input,
    private onRender: (alpha: number, realDelta: number) => void,
    /**
     * §5.7 的采样器。**装不装是两道开关的第一道**：`main.ts` 只在 DEV 构建里装它（发布构建里
     * 传 `null`），没装时 `tickFrame` 连一次额外的 `performance.now()` 都不叫
     * （腿见 `tests/unit/perf-sampler.test.ts`）。装了也不等于在采——面板关着时 `armed` 为 false，
     * 采样器自己 return（第二道开关）。
     */
    private perf: PerfSampler | null = null,
  ) {}

  add(s: Updatable, front = false): void {
    front ? this.systems.unshift(s) : this.systems.push(s)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    const step = (now: number) => {
      if (!this.running) return
      const realDelta = Math.min((now - this.last) / 1000, 0.25)
      this.last = now
      this.tickFrame(realDelta)
      this.rafId = requestAnimationFrame(step)
    }
    this.rafId = requestAnimationFrame(step)
  }

  /** manual stepping for headless tests */
  tickFrame(realDelta: number): void {
    // 只在真的要出数时才叫第二次钟：老口径里 `logicMs ＝ 帧首到帧尾`，那一段其实**把渲染也算进去了**
    const timing = this.perf?.armed ?? false
    const t0 = timing ? performance.now() : 0
    this.time.step(realDelta)
    this.input.poll(realDelta)
    this.accumulator += realDelta
    let ticks = 0
    while (this.accumulator >= TICK_DT && ticks < this.maxTicksPerFrame) {
      this.accumulator -= TICK_DT
      this.time.tick++
      if (!this.time.paused) {
        for (const s of this.systems) s.update(TICK_DT, this.time, this.input)
        for (const s of this.systems) s.postTick?.(this.time)
      }
      this.input.endTick()
      ticks++
    }
    // 死循环闸门：到拍数上限就把账清零（老口径，连不足一拍的那一截一起丢——本批不动它的行为）。
    // `truncated` 记的是**更硬的那件事**：清零时账上还剩**整拍** ⇒ 真的有拍被丢掉（老写法里这一格
    // 全仓没人知道它落下来过几次，而 §5.7 要的正是这个数）。
    const capHit = ticks === this.maxTicksPerFrame
    const truncated = capHit && this.accumulator >= TICK_DT
    if (capHit) this.accumulator = 0
    const alpha = this.accumulator / TICK_DT
    const mid = timing ? performance.now() : 0
    for (const s of this.systems) s.render?.(alpha, realDelta)
    this.onRender(alpha, realDelta)
    if (timing && this.perf) {
      const t1 = performance.now()
      this.perf.frame({
        deltaMs: realDelta * 1000,
        logicMs: mid - t0,
        renderMs: t1 - mid,
        ticks,
        truncated,
      })
    }
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }
}
