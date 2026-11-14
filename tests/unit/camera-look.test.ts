import { afterEach, describe, expect, it } from 'vitest'
import { CameraRig } from '@/player/CameraRig'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * 3rd-person camera vertical (pitch) axis: mouse down (positive dy) ⇒ pitch ↑ ⇒
 * camera rises over the player's head ⇒ view tilts downward ("look down").
 * Mouse up   (negative dy) ⇒ pitch ↓ ⇒ camera sinks toward eye level ⇒ view tilts upward.
 *
 * This test pins the **current master behavior** (kept after the user tested and reported).
 * It is an executable sign convention — change it in the same commit as the code.
 */

Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
afterEach(() => {
  Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
})

const fp = (over: Record<string, unknown> = {}): PlayerController =>
  ({ pos: { x: 0, y: 0, z: 0 }, executing: null, camYawRef: 0, ...over }) as unknown as PlayerController

describe('CameraRig pitch axis (behind-the-back over-the-shoulder vertical)', () => {
  it('mouse DOWN (dy>0) increases pitch => camera rises => tilts view DOWN', () => {
    const r = new CameraRig()
    const before = r.pitch
    for (let i = 0; i < 40; i++) r.update(0.05, fp(), { dx: 0, dy: 0.1 }, null)
    expect(r.pitch, 'dy>0 逐帧叠加 ⇒ pitch 单调上升').toBeGreaterThan(before)
    expect(r.pitch).toBeLessThan(1.2)
  })

  it('mouse UP (dy<0) decreases pitch => camera sinks => tilts view UP', () => {
    const r = new CameraRig()
    const before = r.pitch
    for (let i = 0; i < 40; i++) r.update(0.05, fp(), { dx: 0, dy: -0.1 }, null)
    expect(r.pitch, 'dy<0 逐帧叠加 ⇒ pitch 单调下降').toBeLessThan(before)
    expect(r.pitch).toBeGreaterThan(-0.18)
  })

  it('pitch clamp is symmetric: it never falls below -0.18 and never exceeds 1.2', () => {
    const up = new CameraRig()
    for (let i = 0; i < 1000; i++) up.update(0.05, fp(), { dx: 0, dy: -0.1 }, null)
    expect(up.pitch).toBeCloseTo(-0.18, 6)
    const down = new CameraRig()
    for (let i = 0; i < 1000; i++) down.update(0.05, fp(), { dx: 0, dy: 0.1 }, null)
    expect(down.pitch).toBeCloseTo(1.2, 6)
  })
})
