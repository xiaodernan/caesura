import { describe, expect, it, vi } from 'vitest'
import { bus } from '@/core/EventBus'
import { Haptics, mapShakeToRumble } from '@/input/Haptics'
import type { Input } from '@/core/Input'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emitHit(shakeKey: string): void {
  bus.emit('combat.hit', {
    attackerId: 'player', victimId: 'x', damage: 1, poiseDamage: 0, kind: 'light',
    point: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 }, result: 'hit',
    hitStopMs: 60, shakeKey, backstab: false, weakpoint: false
  } as any)
}

describe('gamepad haptics (§64)', () => {
  it('maps shake tiers to escalating rumble, unknown -> graze', () => {
    expect(mapShakeToRumble('graze').strong).toBeLessThan(mapShakeToRumble('boss').strong)
    expect(mapShakeToRumble('parry').weak).toBeLessThan(mapShakeToRumble('parry').strong)
    expect(mapShakeToRumble('nope').durationMs).toBe(mapShakeToRumble('graze').durationMs)
  })

  it('drives a connected pad actuator with the right params on combat.hit', () => {
    const playEffect = vi.fn()
    const input = { gamepad: { vibrationActuator: { playEffect } } } as unknown as Input
    new Haptics(input)
    emitHit('heavy')
    expect(playEffect).toHaveBeenCalledTimes(1)
    expect(playEffect.mock.calls[0][0]).toBe('dual-rumble')
    expect(playEffect.mock.calls[0][1]).toMatchObject({ duration: 180, strongMagnitude: 0.8, weakMagnitude: 0.5 })
  })

  it('is a safe no-op when no pad is connected', () => {
    const input = { gamepad: null } as unknown as Input
    new Haptics(input)
    expect(() => emitHit('normal')).not.toThrow()
  })
})
