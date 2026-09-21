import { bus } from '@/core/EventBus'
import type { Input } from '@/core/Input'

/** docs/combat.md §12 rumble tiers — pure data, headless-testable (no DOM/gamepad) */
export interface Rumble { durationMs: number; strong: number; weak: number }

const TABLE: Record<string, Rumble> = {
  graze: { durationMs: 40, strong: 0.15, weak: 0.35 },
  normal: { durationMs: 70, strong: 0.3, weak: 0.5 },
  hurt: { durationMs: 120, strong: 0.5, weak: 0.6 },
  parry: { durationMs: 45, strong: 0.7, weak: 0.2 },
  heavy: { durationMs: 180, strong: 0.8, weak: 0.5 },
  boss: { durationMs: 320, strong: 1.0, weak: 0.8 }
}

export function mapShakeToRumble(key: string): Rumble {
  return TABLE[key] ?? TABLE.graze
}

interface RumbleActuator {
  playEffect(type: string, params: Record<string, number>): unknown
}

/**
 * Gamepad haptics (requirement §64 "手柄振动，支持时"). Feature-detected: when no
 * pad is connected (or the browser lacks vibrationActuator) this is a no-op.
 * All combat feedback already flows through the `shakeKey` on combat.hit, so the
 * parry / hurt / execution / guard-break tiers need no extra wiring here.
 */
export class Haptics {
  private last = 0

  constructor(private input: Input) {
    bus.on('combat.hit', (h) => this.pulse(mapShakeToRumble(h.shakeKey)))
  }

  private pulse(r: Rumble): void {
    const pad = this.input.gamepad
    const act = pad?.vibrationActuator as RumbleActuator | undefined
    if (!act || typeof act.playEffect !== 'function') return
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    if (now - this.last < 16) return // rate-limit stacked hits so the actuator is not thrashed
    this.last = now
    try {
      act.playEffect('dual-rumble', {
        duration: r.durationMs,
        strongMagnitude: r.strong,
        weakMagnitude: r.weak
      })
    } catch {
      /* actuator present but call unsupported — degrade silently */
    }
  }
}
