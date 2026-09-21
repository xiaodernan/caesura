import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'

/**
 * §64 acceptance ④: frame data is read from the data table (no hardcoded
 * numbers in code). These assert the greatsword + spear 段 timings match the
 * combat.md §4.2/§4.3 spec that was authored into movesets.json.
 */
registerGameData()

const gs = registry.get<MovesetData>('moveset:ms_greatsword').actions
const sp = registry.get<MovesetData>('moveset:ms_spear').actions

describe('weapon frame data comes from the table (§55/§64)', () => {
  it('greatsword 27f startup / 9f active / 24f recovery L1, and charged stacks 震裂×3', () => {
    expect(gs['l1'].startup).toBe(27)
    expect(gs['l1'].activeEnd - gs['l1'].activeStart).toBe(9)
    expect(gs['l1'].recovery).toBe(60) // 27 + 9 + 24
    expect(gs['charged'].fissureLayers).toBe(3)
    expect(gs['charged'].damage).toBe(80)
    expect(gs['l1'].hitbox && 'radius' in gs['l1'].hitbox && gs['l1'].hitbox.radius).toBe(3.0)
  })

  it('spear has a 5-hit light chain and long reach (3.2m)', () => {
    expect(sp['l1'].next).toBe('l2')
    expect(sp['l4'].next).toBe('l5')
    expect(sp['l5']).toBeTruthy()
    expect(sp['l1'].hitbox && 'radius' in sp['l1'].hitbox && sp['l1'].hitbox.radius).toBe(3.2)
    expect(sp['jump'].fissureLayers).toBe(1)
  })

  it('weapons carry archetype + noise scaling used by the sim (greatsword is a noise source)', () => {
    const gw = registry.get<WeaponData>('wp_fortissimo_greatsword')
    const sw = registry.get<WeaponData>('wp_drawpin_spear')
    expect(gw.archetype).toBe('greatsword')
    expect(gw.noiseMul).toBeGreaterThan(1)
    expect(sw.archetype).toBe('spear')
  })
})
