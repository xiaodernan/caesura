import { bus } from './EventBus'

export const TICK_HZ = 60
export const TICK_DT = 1 / TICK_HZ

export class GameTime {
  tick = 0
  realSeconds = 0
  private scale = 1
  private hitStopRemaining = 0
  paused = false

  get rawScale(): number { return this.scale }

  get dt(): number { return this.paused ? 0 : TICK_DT * this.scale }

  get animSeconds(): number { return this.tick * TICK_DT * this.scale }

  /**
   * advance unscaled real time; resolves hitstop ramp.
   *
   * KI-349: 停顿是一条**状态频道**（`time.hitStop`），读方 `vfx/VfxLayer.onHitStop` 按边沿
   * 把着色器时间降到 0.14x。此前这里只改自己的两个字段、谁也没告诉——那条 0.14x 从没发生过。
   * 报的是**边**：归零那一下说一次 false，停着的时候不再说。
   */
  step(realDelta: number): void {
    this.realSeconds += realDelta
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining -= realDelta
      if (this.hitStopRemaining <= 0) {
        this.hitStopRemaining = 0
        this.scale = 1
        bus.emit('time.hitStop', { active: false })
      }
    }
  }

  /**
   * KI-349：零长度的停顿不是一次停顿。旧写法 `hitStop(0)` 把 scale 写成 0.05 却留下
   * `hitStopRemaining = 0`——`step` 的归零分支进不去，时钟被锁在 5% 直到下一次真停顿。
   * 回声重演（`CombatManager.tickEchoes`）与音叉回授（`parryReflect`）都以
   * `hitStopMs: 0` 走到这里；非正数（含 NaN）一律当作没发生。
   *
   * 已经在停顿时再叠一次是**延长**，不是第二次进入——所以只说一次 true。
   */
  hitStop(durationSec: number, scale = 0.05): void {
    if (this.paused || !(durationSec > 0)) return
    const wasActive = this.hitStopRemaining > 0
    this.scale = scale
    this.hitStopRemaining = Math.max(this.hitStopRemaining, durationSec)
    if (!wasActive) bus.emit('time.hitStop', { active: true })
  }

  reset(): void {
    const wasActive = this.hitStopRemaining > 0
    this.scale = 1
    this.hitStopRemaining = 0
    this.paused = false
    if (wasActive) bus.emit('time.hitStop', { active: false })
  }
}


/** logic ticks since helper: compare/measure in tick units (1 tick = 1/60s) */
export const msToTicks = (ms: number): number => Math.round(ms / (1000 / TICK_HZ))
export const ticksToMs = (t: number): number => t * (1000 / TICK_HZ)
