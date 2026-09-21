import { describe, expect, it } from 'vitest'
import { Rng } from '@/core/Math'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'

describe('core determinism', () => {
  it('rng reproducible by seed', () => {
    const a = new Rng('seed-x'), b = new Rng('seed-x')
    for (let i = 0; i < 50; i++) expect(a.float()).toBe(b.float())
  })
  it('hitstop decays with real time, anim scale restored', () => {
    const t = new GameTime()
    t.hitStop(0.1, 0.05)
    expect(t.rawScale).toBe(0.05)
    t.step(0.05)
    expect(t.rawScale).toBe(0.05)
    t.step(0.06)
    expect(t.rawScale).toBe(1)
  })
  it('rhythm clock quantizes beats by logic dt', () => {
    const r = new RhythmClock()
    r.setBpm(60, 4)
    for (let i = 0; i < 60; i++) r.update(1 / 60)
    expect(Math.floor(r.beat)).toBe(1)
    expect(r.onBeat(100)).toBe(true)
  })
})
