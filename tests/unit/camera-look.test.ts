import { afterEach, describe, expect, it } from 'vitest'
import { CameraRig } from '@/player/CameraRig'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * Camera vertical axis (3rd-person behind-the-shoulder).
 * DOM `mousemove` contract: `movementY` positive when the cursor moves downward.
 * The user's explicit wish: mouse-up = look up (camera lower), mouse-down = look down.
 * That is achieved with `pitch += look.dy * …` (default FPS convention):
 *   dy>0 (mouse down) → pitch ↑ → camera rises above target → view tilts DOWN
 *   dy<0 (mouse up)   → pitch ↓ → camera sinks toward eye level → view tilts UP
 */

Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
afterEach(() => {
  Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
})

const fp = (over: Record<string, unknown> = {}): PlayerController =>
  ({ pos: { x: 0, y: 0, z: 0 }, executing: null, camYawRef: 0, ...over }) as unknown as PlayerController

describe('CameraRig pitch axis (3rd-person behind-the-shoulder vertical) — FPS (default)', () => {
  it('mouse DOWN (dy>0) INCREASES pitch — camera rises above target, view tilts DOWN', () => {
    const r = new CameraRig()
    const before = r.pitch
    for (let i = 0; i < 40; i++) r.update(0.05, fp(), { dx: 0, dy: 0.1 }, null)
    expect(r.pitch, 'dy>0 ⇒ pitch ↑').toBeGreaterThan(before)
    expect(r.pitch).toBeLessThan(1.2)
  })

  it('mouse UP (dy<0) DECREASES pitch — camera sinks toward eye level, view tilts UP', () => {
    const r = new CameraRig()
    const before = r.pitch
    for (let i = 0; i < 40; i++) r.update(0.05, fp(), { dx: 0, dy: -0.1 }, null)
    expect(r.pitch, 'dy<0 ⇒ pitch ↓').toBeLessThan(before)
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
