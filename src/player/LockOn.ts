import { bus } from '@/core/EventBus'
import { clampAngleDiff } from './ThirdPersonController'
import type { PlayerController } from './ThirdPersonController'
import type { Vec3 } from '@/combat/EntityStats'

export interface LockCandidate {
  id: string
  getPos(): Vec3
  get alive(): boolean
  get isBoss(): boolean
  get nameKey(): string
}

export class LockOn {
  target: LockCandidate | null = null
  range = 35
  constructor(private player: PlayerController) {
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
      return d <= this.range
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
      const score = -ang * 2.2 - d * 0.06 + (c.isBoss ? 3 : 0)
      if (score > bestScore) { bestScore = score; best = c }
    }
    this.setTarget(best)
  }

  setTarget(t: LockCandidate | null): void {
    this.target = t
    this.player.lockedTarget = t ? { getPos: () => t.getPos(), radius: 0.6 } : null
    bus.emit('ui.target', t
      ? { pos: null, name: t.nameKey, hpFrac: 1, poiseFrac: 0, isBoss: t.isBoss }
      : { pos: null, name: '', hpFrac: 0, poiseFrac: 0, isBoss: false })
  }

  update(): void {
    if (this.target && !this.target.alive) this.setTarget(null)
    if (this.target) {
      const tp = this.target.getPos()
      const d = Math.hypot(tp.x - this.player.pos.x, tp.z - this.player.pos.z)
      if (d > this.range) this.setTarget(null)
    }
  }
}

declare module '@/core/EventBus' {
  interface GameEvents {
    'ui.target': { pos: { x: number; y: number } | null; name: string; hpFrac: number; poiseFrac: number; isBoss: boolean }
  }
}
