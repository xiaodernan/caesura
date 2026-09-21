/**
 * 穿行流（§5.5 测试矩阵 · §59 自动化玩法流）：
 * 休垒 → 雾语林（地表大区域入口）→ 沉唱堂（地下垂直跨层）→ 传送回休垒。
 * 断言「流送后 1s 内无 MissingRef 警告」与全程预算不破。
 */
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { registerGameData, regions } from '@/data'
import { StreamingSystem } from '@/world/Streaming'

registerGameData()

const HUB = { x: 0, y: 0, z: 0 }
const FOREST = { x: 320, y: 0, z: 40 }
const CHOIR = { x: 300, y: -40, z: 60 }

/** 沿直线以 2m/帧 走完一段路（≈60m/s 高速移动作弊，测试矩阵第 1 项） */
function run(s: StreamingSystem, from: typeof HUB, to: typeof HUB, tick: number): number {
  const steps = 40
  let t = tick
  for (let i = 1; i <= steps; i++) {
    const f = i / steps
    t++
    s.update(t, {
      x: from.x + (to.x - from.x) * f,
      y: from.y + (to.y - from.y) * f,
      z: from.z + (to.z - from.z) * f,
    })
  }
  return t
}

function drain(s: StreamingSystem, pos: typeof HUB, tick: number, ticks = 600): number {
  let t = tick
  for (let i = 0; i < ticks; i++) { t++; s.update(t, pos) }
  return t
}

describe('world traversal flow (Phase 3-A)', () => {
  it('streams hub → forest → underground without missing refs or budget breaches', () => {
    const warnings: string[] = []
    let maxInFlight = 0
    let maxActive = 0
    const off1 = bus.on('log', (l) => { if (l.level === 'warn') warnings.push(l.msg) })
    const s = new StreamingSystem(regions)
    const off2 = bus.on('world.chunk', () => {
      maxInFlight = Math.max(maxInFlight, s.inFlight)
      maxActive = Math.max(maxActive, s.activeCount)
    })
    s.teleport(0, HUB)
    let t = drain(s, HUB, 0)
    expect(s.regionAt(HUB)?.id).toBe('rg_resthold')
    expect(StreamingSystem.collectMissingRefs(regions, (id) => registry.has(id))).toEqual([])

    bus.emit('world.flag', { key: 'flag.left_resthold', value: true })
    t = run(s, HUB, FOREST, t)
    t = drain(s, FOREST, t)
    expect(s.regionAt(FOREST)?.id).toBe('rg_whisperwode')
    expect(s.activeCount).toBeGreaterThan(0)

    bus.emit('world.flag', { key: 'flag.choir_entrance_open', value: true })
    t = run(s, FOREST, CHOIR, t)
    t = drain(s, CHOIR, t)
    expect(s.regionAt(CHOIR)?.id).toBe('rg_drowned_choir')
    expect(s.byState('active').some((c) => c.regionId === 'rg_drowned_choir')).toBe(true)

    s.teleport(t + 1, HUB)
    t = drain(s, HUB, t + 1)
    expect(s.regionAt(HUB)?.id).toBe('rg_resthold')
    expect(s.stats().queued).toBe(0)

    // 「流送后 1s 内无 MissingRef 警告」：60 tick 静默窗口
    for (let i = 0; i < 60; i++) { t++; s.update(t, HUB) }
    expect(warnings.filter((w) => w.includes('MissingRef'))).toEqual([])
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxActive).toBeLessThanOrEqual(27) // 3D 激活环 3×3×3
    off1(); off2(); s.dispose()
  })

  it('activates every cell of a region the player stands in, whatever the layer', () => {
    const s = new StreamingSystem(regions)
    for (const f of ['flag.left_resthold', 'flag.choir_entrance_open', 'flag.brokenbar_resolved', 'flag.organ_gate_open', 'flag.deeps_entrance_open']) {
      s.setFlag(f)
    }
    const probes: Array<{ pos: { x: number; y: number; z: number }; region: string }> = [
      { pos: HUB, region: 'rg_resthold' },
      { pos: FOREST, region: 'rg_whisperwode' },
      { pos: CHOIR, region: 'rg_drowned_choir' },
      { pos: { x: -80, y: 0, z: -200 }, region: 'rg_brokenbar_camp' },
      { pos: { x: 200, y: 90, z: -220 }, region: 'rg_fellcarillon' },
      { pos: { x: -100, y: -150, z: 200 }, region: 'rg_earless_deeps' },
      { pos: { x: 0, y: 160, z: -200 }, region: 'rg_unfinished_hall' },
    ]
    let tick = 0
    for (const p of probes) {
      s.teleport(tick, p.pos)
      tick = drain(s, p.pos, tick, 300)
      const here = s.chunkAt(p.pos)
      expect(here, `${p.region} cell missing at ${JSON.stringify(p.pos)}`).toBeTruthy()
      expect(here!.state, p.region).toBe('active')
      expect(here!.regionId, p.region).toBe(p.region)
    }
    s.dispose()
  })
})
