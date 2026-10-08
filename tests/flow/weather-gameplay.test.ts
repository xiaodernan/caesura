import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData, quests, regions, statuses } from '@/data'
import type { SpawnGroup, Vec3 } from '@/data/schema'
import { CorruptionMeter } from '@/combat/Statuses'
import { AmbienceField } from '@/audio/ambient-field'
import { spatialize } from '@/audio/spatial'
import { chunkKeyOf, StreamingSystem } from '@/world/Streaming'
import { SpawnDirector, type SpawnHost } from '@/world/SpawnDirector'
import { activeWeather, questTrackedFlags } from '@/world/WeatherSwitch'
import { ambienceGain, concentrationMul, corruptionMul, weatherRowOf } from '@/world/WeatherEffects'
import { FakeAudioContext, FakeNode } from '../support/fakeAudio'

/**
 * §5.9.33③ 三条玩法腿的**接线**（需求 §59 的 gameplay flow 验收）。
 *
 * 这一份不碰 `main.ts`：装配层 0% 覆盖（TD-006④ Blocked），而"组合根把三个数转发给三个系统"
 * 这句话在 headless 里唯一的验法就是**把同一条链在测试里重走一遍**——
 * 区域 + 旗标 ⇒ 天气名（`world/WeatherSwitch`）⇒ 三个乘数（`world/WeatherEffects`）⇒
 * 三个系统各自真的变了。main.ts 那一侧由源码门夹着（`applyWeather(` 的次数、`setWeatherGain(`
 * 的调用点都在 `color-grade.test.ts` 里被数过）。
 *
 * A/B 的底全部是**真表**：天气名从 `regions.json` 与 `quests.json` 推，失谐那一击的数从
 * `statuses.json` 读。抄一份常量进来就等于让实现自证。
 */

registerGameData()

/** 记下每一颗怪精确落点的假 host（浓度腿要量的是坐标，四舍五入会把结论磨掉） */
function posHost(): SpawnHost & { at: Vec3[] } {
  const at: Vec3[] = []
  let n = 0
  return {
    at,
    spawn: (_enemyId, pos) => { at.push({ ...pos }); return { id: `en#${++n}` } },
    despawn: () => true,
    hasFlag: () => true,
  }
}

const cellKeyOf = (): ((p: Vec3) => string) => {
  const s = new StreamingSystem(regions)
  return (p) => { const c = s.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
}

const group = (over: Partial<SpawnGroup> = {}): SpawnGroup => ({
  enemyId: 'en_murkshell', count: 4, center: { x: 150, y: 64, z: -140 }, radius: 12, ...over,
})

/** 真表上"修好钟坠院第一口钟之后"那一格天气（weatherPresets[1]），以及它带来的三个乘数 */
const stormLegs = () => {
  const fell = regions.find((r) => r.id === 'rg_fellcarillon')!
  const tracked = questTrackedFlags(quests)
  const name = activeWeather(fell, (k) => k === 'flag.bell_first_repaired', tracked)
  expect(name, '修好第一口钟之后钟坠院换不到那一格天气：这条链的起点就断了').toBe('dissonant-storm')
  const row = weatherRowOf(name)
  return { concentration: concentrationMul(row), corruption: corruptionMul(row), gain: ambienceGain(row) }
}

describe('§5.9.33③ 天气三腿：从"修好一口钟"到三个系统各变一次', () => {
  it('起点是数据推出来的：修好钟坠院第一口钟 ⇒ dissonant-storm，而它的三腿都 > 1', () => {
    const legs = stormLegs()
    expect(legs.concentration).toBeGreaterThan(1)
    expect(legs.corruption).toBeGreaterThan(1)
    expect(legs.gain).toBeGreaterThan(1)
  })

  it('浓度腿：同一组怪，晴空按数据半径铺开，风暴里向组心收拢（落点真的变了）', () => {
    const cellKey = cellKeyOf()
    const g = group()
    const key = cellKey(g.center)
    const plain = new SpawnDirector([{ ...regions.find((r) => r.id === 'rg_fellcarillon')!, spawnGroups: [g] }], posHost(), cellKey)
    const base = plain.slotsInChunk(key).map((s) => s.pos)
    plain.dispose()

    const h = posHost()
    const d = new SpawnDirector([{ ...regions.find((r) => r.id === 'rg_fellcarillon')!, spawnGroups: [g] }], h, cellKey)
    d.setConcentration(stormLegs().concentration)
    // 进格事件照常发（与流送同一套 key），落位按风暴浓度
    bus.emit('world.chunk', { key, regionId: 'rg_fellcarillon', cx: 0, cy: 0, cz: 0, center: g.center, state: 'active', priority: 0, tick: 1 })
    expect(h.at).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      expect(h.at[i].x).toBeCloseTo(g.center.x + (base[i].x - g.center.x) / stormLegs().concentration, 10)
      expect(h.at[i].z).toBeCloseTo(g.center.z + (base[i].z - g.center.z) / stormLegs().concentration, 10)
    }
    d.dispose()
  })

  it('失谐速率腿：风暴里被悬钟骑士命中，写进身上的失谐按 eliteHit × 乘数（不是 +3 也不是翻倍）', () => {
    const hit = statuses.corruption.eliteHit
    const legs = stormLegs()
    const plain = new CorruptionMeter()
    plain.add(hit)
    const storm = new CorruptionMeter()
    storm.weatherMul = legs.corruption
    storm.add(hit)
    expect(storm.value).toBeCloseTo(hit * legs.corruption, 10)
    expect(plain.value).toBe(hit)
    expect(storm.value).toBeGreaterThan(plain.value)
    expect(storm.value).toBeLessThan(hit * 2)
  })

  it('声景增益腿：风暴里每一声的增益 = 距离衰减 × 乘数，晴空那一格不放大', () => {
    const legs = stormLegs()
    const pose = { x: 0, y: 0, z: 0, yaw: 0 }
    const src = { layer: 'motion' as const, hz: 320, pos: { x: 0, y: 0, z: -16 }, peak: 0.02, attackSec: 0.003, durSec: 0.3, everySec: [0, 0] as [number, number] }
    const gainOf = (mul: number): number => {
      const ctx = new FakeAudioContext()
      const field = new AmbienceField(ctx as unknown as AudioContext, ctx.createGain() as unknown as AudioNode)
      field.setListener(pose)
      field.setBed({ id: 'bed', layers: [], sources: [src], bell: null })
      field.setWeatherGain(mul)
      field.update()
      const panner = ctx.nodes.filter((n) => n.kind === 'panner')[0]
      const gain = ctx.edges.find((e) => e.to === panner)?.from as FakeNode
      return gain.params.gain.value
    }
    const att = spatialize(src.pos, pose).att
    expect(gainOf(1)).toBeCloseTo(att, 10)
    expect(gainOf(legs.gain)).toBeCloseTo(att * legs.gain, 10)
  })

  it('三腿同源：浓度/失谐/增益三个读数来自同一行天气，改表时三条一起动', () => {
    const row = weatherRowOf('dissonant-storm')!
    expect(concentrationMul(row)).toBe(corruptionMul(row))
    expect(corruptionMul(row)).toBe(ambienceGain(row))
  })
})
