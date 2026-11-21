import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  endlessEchoFlowEntries,
  endlessWorldStudy,
  generateSector,
  generateWorld,
} from '../../scripts/endless-world.mjs'

/** KI-723：无尽世界不是「很大的空地图」——每个深度都必须有真东西，且可无限追加。 */
describe('无尽开放世界生成器（KI-723）', () => {
  it('同 seed 逐字一致；不同 seed 真不同（不是同一张表改标题）', () => {
    const a = generateWorld({ seed: 723, sectors: 6 })
    const b = generateWorld({ seed: 723, sectors: 6 })
    const c = generateWorld({ seed: 724, sectors: 6 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c))
  })

  it('深度可无限追加：任意深度都有 6 处可看、3 根旗标、下一步指针', () => {
    for (const depth of [1, 7, 97, 100000]) {
      const s = generateSector(723, depth)
      expect(s.marks.length).toBeGreaterThanOrEqual(6)
      expect(s.flags.length).toBeGreaterThanOrEqual(3)
      expect(s.nextDepth).toBe(depth + 1)
      expect(s.guideZh.length).toBeGreaterThan(0)
      expect(s.guideEn.length).toBeGreaterThan(0)
      expect(new Set(s.marks.map((m) => m.id)).size).toBe(s.marks.length)
    }
  })

  it('世界线条目与 KI-717 同形状：旗标唯一、双语非空、人工闸字段齐全', () => {
    const world = generateWorld({ seed: 723, sectors: 8 })
    const entries = endlessEchoFlowEntries(world)
    expect(entries).toHaveLength(world.sectors.length * 3)
    expect(new Set(entries.map((e) => e.flag)).size).toBe(entries.length)
    for (const e of entries) {
      expect(e.fromZh && e.fromEn && e.toZh && e.toEn).toBeTruthy()
      expect(e.canonFit).toBe('procedural')
      expect(e.approval.by).toBe('generator:KI-723')
      expect(Array.isArray(e.canonEvidence)).toBe(true)
    }
  })

  it('真值护栏 sound=true，且表中落盘的扇区与现算一致', () => {
    const study = endlessWorldStudy({ seed: 723, sectors: 12 })
    expect(study.sound).toBe(true)
    expect(study.noEmptySector).toBe(true)
    expect(study.deterministic).toBe(true)
    const table = JSON.parse(readFileSync(new URL('../../src/data/json/endless-sectors.json', import.meta.url), 'utf8'))
    expect(JSON.stringify(table)).toBe(JSON.stringify(generateWorld({ seed: 723, sectors: 12 })))
  })

  it('中文叙述不夹英文、英文叙述不夹汉字（两种模式都干净）', () => {
    const world = generateWorld({ seed: 723, sectors: 6 })
    for (const s of world.sectors) {
      expect(s.titleZh + s.guideZh + s.soundZh + s.marks.map((m) => m.zh).join('')).not.toMatch(/[A-Za-z]{2,}/)
      expect(s.titleEn + s.guideEn + s.soundEn + s.marks.map((m) => m.en).join('')).not.toMatch(/[一-鿿]/)
    }
  })
})
