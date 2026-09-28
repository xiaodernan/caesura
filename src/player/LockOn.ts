import { bus } from '@/core/EventBus'
import { clampAngleDiff } from './ThirdPersonController'
import type { PlayerController } from './ThirdPersonController'
import type { Vec3 } from '@/combat/EntityStats'
import type { LockOnConfig } from '@/data/schema'

export interface LockCandidate {
  id: string
  getPos(): Vec3
  get alive(): boolean
  get isBoss(): boolean
  get nameKey(): string
}

/**
 * 目标锁定的切换、脱锁与**打分**。
 *
 * 四个数（射程 / 角度权重 / 距离权重 / Boss 加分）自 KI-084 起住在 `player.json > lockOn`，
 * 由组合根注入 —— 这个文件里不再留任何一份（TD-005 的入表腿；此前是 `range = 35` 与
 * `2.2 / 0.06 / +3`）。行为与证人见 `tests/unit/lockon.test.ts`。
 */
export class LockOn {
  target: LockCandidate | null = null
  constructor(private player: PlayerController, private cfg: LockOnConfig) {
    bus.on('entity.died', (e) => {
      if (this.target?.id === e.id) this.setTarget(null)
    })
  }

  candidates: LockCandidate[] = []

  toggle(): void {
    if (this.target) {
      const list = this.liveCandidates()
      if (list.length <= 1) { this.setTarget(null); return }
      const i = list.findIndex((c) => c === this.target)
      this.setTarget(list[(i + 1) % list.length])
      bus.emit('audio.sfx', { key: 'lockon_on', gain: 0.4 })
    } else {
      this.acquireBest()
      bus.emit('audio.sfx', { key: this.target ? 'lockon_on' : 'ui_move', gain: 0.4 })
    }
  }

  private liveCandidates(): LockCandidate[] {
    const p = this.player.pos
    return this.candidates.filter((c) => {
      if (!c.alive) return false
      const d = Math.hypot(c.getPos().x - p.x, c.getPos().z - p.z)
      return d <= this.cfg.range
    })
  }

  acquireBest(): void {
    const p = this.player.pos
    const list = this.liveCandidates()
    let best: LockCandidate | null = null
    let bestScore = -Infinity
    for (const c of list) {
      const d = Math.hypot(c.getPos().x - p.x, c.getPos().z - p.z)
      const ang = Math.abs(clampAngleDiff(this.player.yaw, Math.atan2(c.getPos().x - p.x, c.getPos().z - p.z)))
      const score = -ang * this.cfg.aimWeight - d * this.cfg.distWeight + (c.isBoss ? this.cfg.bossBonus : 0)
      if (score > bestScore) { bestScore = score; best = c }
    }
    this.setTarget(best)
  }

  setTarget(t: LockCandidate | null): void {
    const had = this.target !== null
    this.target = t
    this.player.lockedTarget = t ? { getPos: () => t.getPos(), radius: 0.6 } : null
    // 解除有一张自己的脸（synth 里 `lockon_off` 一直是空号）：换目标不该听到"断开"，所以只在
    // 从有到无那一拍发；走 UI 总线不空间化（AudioEngine 的 UI_KEYS 名单里有它）。
    if (!t && had) bus.emit('audio.sfx', { key: 'lockon_off', gain: 0.4 })
    bus.emit('ui.target', t
      ? { pos: null, name: t.nameKey, hpFrac: 1, poiseFrac: 0, isBoss: t.isBoss }
      : { pos: null, name: '', hpFrac: 0, poiseFrac: 0, isBoss: false })
  }

  update(): void {
    if (this.target && !this.target.alive) this.setTarget(null)
    if (this.target) {
      const tp = this.target.getPos()
      const d = Math.hypot(tp.x - this.player.pos.x, tp.z - this.player.pos.z)
      if (d > this.cfg.range) this.setTarget(null)
    }
  }
}

declare module '@/core/EventBus' {
  interface GameEvents {
    'ui.target': { pos: { x: number; y: number } | null; name: string; hpFrac: number; poiseFrac: number; isBoss: boolean }
  }
}
