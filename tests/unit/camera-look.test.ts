import { afterEach, describe, expect, it } from 'vitest'
import { CameraRig } from '@/player/CameraRig'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * Camera vertical axis (3rd-person behind-the-shoulder).
 * After user feedback at play-test time (Phase 补, 2026-11-14):
 *   mouse DOWN (dy>0)  → pitch decreases → camera sinks → look UP (toward horizon)
 *   mouse UP   (dy<0)  → pitch increases → camera rises  → look DOWN (toward ground)
 *
 * This is exactly the opposite of the previous sign — the user reported the previous
 * direction was inverted for them; flipped once per direct request.
 * This test pins that decision. Reverting `pitch - look.dy` to `pitch + look.dy` will.fail.
 */

Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
afterEach(() => {
  Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
})

const fp = (over: Record<string, unknown> = {}): PlayerController =>
  ({ pos: { x: 0, y: 0, z: 0 }, executing: null, camYawRef: 0, ...over }) as unknown as PlayerController

describe('CameraRig pitch axis (3rd-person behind-the-shoulder vertical) — user-flipped 2026-11-14', () => {
  it('mouse DOWN (dy>0) DECREASES pitch (camera sinks toward eye level)', () => {
    const r = new CameraRig()
    const before = r.pitch
    for (let i = 0; i < 40; i++) r.update(0.05, fp(), { dx: 0, dy: 0.1 }, null)
    expect(r.pitch, 'dy>0 逐帧叠加 ⇒ pitch 下降').toBeLessThan(before)
    expect(r.pitch).toBeGreaterThan(-0.18)
  })

  it('mouse UP (dy<0) INCREASES pitch (camera rises above head)', () => {
    const r = new CameraRig()
    const before = r.pitch
    for (let i = 0; i < 40; i++) r.update(0.05, fp(), { dx: 0, dy: -0.1 }, null)
    expect(r.pitch, 'dy<0 逐帧叠加 ⇒ pitch 上升').toBeGreaterThan(before)
    expect(r.pitch).toBeLessThan(1.2)
  })

  it('pitch clamp is symmetric: it never falls below -0.18 and never exceeds 1.2', () => {
    const up = new CameraRig()
    for (let i = 0; i < 1000; i++) up.update(0.05, fp(), { dx: 0, dy: -0.1 }, null)
    expect(up.pitch).toBeCloseTo(1.2, 6)
    const down = new CameraRig()
    for (let i = 0; i < 1000; i++) down.update(0.05, fp(), { dx: 0, dy: 0.1 }, null)
    expect(down.pitch).toBeCloseTo(-0.18, 6)
  })
})
