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

  /** advance unscaled real time; resolves hitstop ramp */
  step(realDelta: number): void {
    this.realSeconds += realDelta
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining -= realDelta
      if (this.hitStopRemaining <= 0) {
        this.hitStopRemaining = 0
        this.scale = 1
      }
    }
  }

  hitStop(durationSec: number, scale = 0.05): void {
    if (this.paused) return
    this.scale = scale
    this.hitStopRemaining = Math.max(this.hitStopRemaining, durationSec)
  }

  reset(): void {
    this.scale = 1
    this.hitStopRemaining = 0
    this.paused = false
  }
}


/** logic ticks since helper: compare/measure in tick units (1 tick = 1/60s) */
export const msToTicks = (ms: number): number => Math.round(ms / (1000 / TICK_HZ))
export const ticksToMs = (t: number): number => t * (1000 / TICK_HZ)
