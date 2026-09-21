import { GameTime, TICK_DT } from './Time'
import { Input } from './Input'

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
  frameSample = { fps: 0, logicMs: 0, renderMs: 0 }
  private fpsWindow: number[] = []

  constructor(
    private time: GameTime,
    private input: Input,
    private onRender: (alpha: number, realDelta: number) => void
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
    const t0 = performance.now()
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
    if (ticks === this.maxTicksPerFrame) this.accumulator = 0
    const alpha = this.accumulator / TICK_DT
    for (const s of this.systems) s.render?.(alpha, realDelta)
    this.onRender(alpha, realDelta)
    const t1 = performance.now()
    this.frameSample.logicMs = t1 - t0
    this.fpsWindow.push(realDelta)
    if (this.fpsWindow.length > 60) {
      this.fpsWindow.shift()
      const avg = this.fpsWindow.reduce((a, b) => a + b, 0) / this.fpsWindow.length
      this.frameSample.fps = Math.round(1 / avg)
    }
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }
}
