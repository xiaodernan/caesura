import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { VfxLayer } from '@/vfx/VfxLayer'

/** smoke: every vfx key used by combat/movesets must spawn+advance without throwing */
describe('VfxLayer smoke', () => {
  it('consumes all emitted keys and updates over time', () => {
    const scene = new THREE.Scene()
    const layer = new VfxLayer(scene)
    const keys = [
      'hit_ring', 'parry_ring', 'block_spark', 'shock_small', 'death_shatter',
      'ring_dust', 'swing_trail', 'trail_sword', 'trail_thrust', 'ring_echo',
      'spike_chord', 'unknown_key_should_be_ignored'
    ]
    for (const key of keys) {
      bus.emit('vfx.request', { key, pos: { x: 1, y: 0.5, z: -2 }, dir: { x: 0, y: 0, z: 1 }, scale: 1.2 })
    }
    for (let i = 0; i < 240; i++) layer.update(1 / 60)
    expect(scene.children.length).toBeGreaterThan(0)
    layer.dispose?.()
  })
})
