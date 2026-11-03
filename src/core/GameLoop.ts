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

/** 抛出物要落成一格能被面板印出来的账：`throw 'x'` 那种不是 Error 的东西也得有个名字 */
const faultOf = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

export class GameLoop {
  private systems: Updatable[] = []
  private accumulator = 0
  private rafId = 0
  private last = 0
  running = false
  /** max catch-up ticks per frame (death-spiral guard) */
  maxTicksPerFrame = 5
  /**
   * 被边界吃掉的那些帧（`realDelta` 非有限或为负）。这一格与下面五格都是**读数**而不是装饰：
   * F5 面板那一行（`tools/PerfDebugger > frameAccountLine`）是它们的消费者，没有消费者的账本不入。
   */
  rejectedDeltas = 0
  /** 最后一次被吃掉的那个数到底长什么样（NaN 与 -5 是两种病，折成"有一个坏数"就读不出来了） */
  lastRejectedDelta: number | null = null
  /** 渲染段抛出的次数：那一帧的画面坏了，循环照旧 */
  renderFaults = 0
  lastRenderFault: string | null = null
  /** 逻辑段抛出的次数：抛出之后循环停了（`running` 同时被改成假，所以 `start()` 还能把它起来） */
  logicFaults = 0
  lastLogicFault: string | null = null

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
  tickFrame(realDelta: number): 'ran' | 'rejected' {
    /**
     * 边界只有一个主人：什么样的 `realDelta` 才算走过一拍，裁决写在这一格，不摊给每个系统。
     * 拒绝**不是**折成 0 装没事——那一帧被吃掉这件事要能被读数面看见（`rejectedDeltas`／
     * `lastRejectedDelta`，F5 面板那一行读的就是这两格）。
     */
    if (!Number.isFinite(realDelta) || realDelta < 0) {
      this.rejectedDeltas++
      this.lastRejectedDelta = realDelta
      return 'rejected'
    }
    // 只在真的要出数时才叫第二次钟：老口径里 `logicMs ＝ 帧首到帧尾`，那一段其实**把渲染也算进去了**
    const timing = this.perf?.armed ?? false
    const t0 = timing ? performance.now() : 0
    let alpha = 0
    let ticks = 0
    let truncated = false
    try {
      this.time.step(realDelta)
      this.input.poll(realDelta)
      this.accumulator += realDelta
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
      truncated = capHit && this.accumulator >= TICK_DT
      if (capHit) this.accumulator = 0
      alpha = this.accumulator / TICK_DT
    } catch (e) {
      // 逻辑段抛出 ⇒ 模拟状态本身已经不可信，再走下一拍是在坏状态上叠坏状态。停是对的，
      // 但**停要留下读数、且 `running` 必须说真话**：老写法里这一抛把 RAF 那一串永远掐掉，
      // 而 `running` 还挂着 true ⇒ `start()` 拒绝重启，玩家看到的是一张冻住的画面。
      this.logicFaults++
      this.lastLogicFault = faultOf(e)
      this.running = false
      throw e
    }
    const mid = timing ? performance.now() : 0
    try {
      for (const s of this.systems) s.render?.(alpha, realDelta)
      this.onRender(alpha, realDelta)
    } catch (e) {
      // 渲染段与逻辑段是两件事：画面是一帧一帧重画的产物，坏掉这一帧不影响下一拍的模拟 ⇒
      // 这一处抛出**不许**被当成循环结束（记账，续帧）。
      this.renderFaults++
      this.lastRenderFault = faultOf(e)
    }
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
    return 'ran'
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }
}
