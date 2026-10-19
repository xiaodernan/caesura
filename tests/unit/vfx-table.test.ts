import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { vfxFindings, vfxConfigIds, isHexColor } from '../../scripts/vfx-rules.mjs'
import { toDecalConfig, toTrailConfig, toEmitterConfig, blendingOf, colorOf } from '@/vfx/VfxConfig'
import type { VfxDecalRow, VfxEmitterRow, VfxTrailRow, VfxTable } from '@/data/schema'

/**
 * Phase B4 配置表（`vfx.json`）的对账门（KI-135）。
 *
 * 判据本体住 `scripts/vfx-rules.mjs`（校验器与测试读同一份实现），这里做三件事：
 * ① 真表**零 findings**；② 合成夹具逐条被抓住（反证判据会响）；③ 转换层把数据翻译成表现层的形状。
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const table = JSON.parse(readFileSync(root + 'src/data/json/vfx.json', 'utf8')) as VfxTable

describe('vfx.json 配置表（Phase B4）', () => {
  it('真表零 findings（贴花 / 拖尾 / 发射器三段）', () => {
    expect(vfxFindings('vfx.json', table)).toEqual([])
  })

  it('判据的判据：三段都非空、id 互不重名、hex 全部合法', () => {
    expect(table.decals.length, '贴花段').toBeGreaterThan(0)
    expect(table.trails.length, '拖尾段').toBeGreaterThan(0)
    expect(table.emitters.length, '发射器段').toBeGreaterThan(0)
    const ids = vfxConfigIds(table)
    expect(new Set(ids).size, '三个 id 段合起来不许重名').toBe(ids.length)
    for (const row of table.decals) expect(isHexColor(row.color.base), `${row.id} 的 base`).toBe(true)
    for (const row of table.trails) for (const c of row.color) expect(isHexColor(c)).toBe(true)
    for (const row of table.emitters) {
      expect(isHexColor(row.color.start), `${row.id} 的 start`).toBe(true)
      expect(isHexColor(row.color.end), `${row.id} 的 end`).toBe(true)
    }
  })

  it('反向实测：合成夹具逐条被抓住（判据会响，不是装饰）', () => {
    const bad = {
      decals: [
        {
          id: 'x', type: 'nope', lifetime: -5, fadeIn: -1, fadeOut: 0,
          size: { min: 2, max: 1 }, color: { base: 'red', opacity: 3 },
          normalStrength: -1, roughnessOffset: 0, metalnessOffset: 0,
          randomRotation: 'yes', randomScale: false, maxInstances: 0,
        } as unknown as VfxDecalRow,
      ],
      trails: [
        { id: 'y', segments: 1, width: [0.1, 0.5], color: ['#fff', 'zzz'], lifetime: 0, blending: 'glow', followRotation: 1, minEmitDist: -1 } as unknown as VfxTrailRow,
      ],
      emitters: [
        {
          id: 'z', type: 'smoke', maxParticles: 0, spawnRate: 0, spawnShape: 'blob', spawnSize: { x: 0, y: 0 },
          lifetime: { min: 2, max: 1 }, size: { start: -1, end: 0 }, color: { start: '#fff', end: '#000' },
          velocity: { min: { x: 1, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, acceleration: { x: 0, y: 0 },
          gravity: 0, drag: -1, blending: 'x', depthWrite: 1, sizeAttenuation: 1,
        } as unknown as VfxEmitterRow,
      ],
    }
    const findings = vfxFindings('vfx.json', bad)
    expect(findings.length, '三条坏配置加起来至少十几条 findings').toBeGreaterThanOrEqual(10)
    const wheres = findings.map((f) => f.where).join(' ')
    for (const want of [
      'decals[0].type', 'decals[0].lifetime', 'decals[0].fadeIn', 'decals[0].size',
      'decals[0].color.base', 'decals[0].color.opacity', 'decals[0].maxInstances',
      'trails[0].segments', 'trails[0].width', 'trails[0].color', 'trails[0].lifetime', 'trails[0].blending',
      'emitters[0].type', 'emitters[0].maxParticles', 'emitters[0].spawnRate', 'emitters[0].spawnShape',
      'emitters[0].lifetime', 'emitters[0].velocity', 'emitters[0].drag', 'emitters[0].blending',
    ]) {
      expect(wheres, `这一格必须被点名：${want}`).toContain(want)
    }
  })

  it('反向实测：跨段重名的 id 被抓住（"这一行指哪种配置"不能靠猜）', () => {
    const dup = {
      decals: [{ ...(table.decals[0] as VfxDecalRow) }],
      trails: [{ ...(table.trails[0] as VfxTrailRow), id: table.decals[0].id }],
      emitters: [],
    }
    const findings = vfxFindings('vfx.json', dup)
    expect(findings.some((f) => f.why.includes('已经在')), '跨段重名必须被点名').toBe(true)
  })

  it('转换层：hex → three 颜色、混合模式名字 → 枚举、向量 → THREE.Vector3', () => {
    expect(colorOf('#ff7a2f').getHex(), 'hex → 颜色').toBe(0xff7a2f)
    expect(blendingOf('additive')).toBe(2)
    expect(blendingOf('normal')).toBe(1)
    expect(blendingOf('不存在的名字'), '认不出的名字回落 normal，不抛').toBe(1)

    const decal = toDecalConfig(table.decals[0])
    expect(decal.id).toBe(table.decals[0].id)
    expect(decal.color.base.getHex()).toBe(Number.parseInt(table.decals[0].color.base.slice(1), 16))
    expect(decal.size.min).toBe(table.decals[0].size.min)

    const trail = toTrailConfig(table.trails[0])
    expect(trail.width).toEqual([table.trails[0].width[0], table.trails[0].width[1]])
    expect(trail.color[0].getHex()).toBe(Number.parseInt(table.trails[0].color[0].slice(1), 16))
    expect(trail.blending).toBe(2)

    const emitter = toEmitterConfig(table.emitters[0])
    expect(emitter.spawnSize.x).toBe(table.emitters[0].spawnSize.x)
    expect(emitter.velocity.min.y).toBe(table.emitters[0].velocity.min.y)
    expect(emitter.color.start.getHex()).toBe(Number.parseInt(table.emitters[0].color.start.slice(1), 16))
  })

  it('表里没有写坏的颜色（每个 hex 都能被解析成有限数）', () => {
    for (const id of vfxConfigIds(table)) {
      const row = [...table.decals, ...table.trails, ...table.emitters].find((r) => r.id === id)
      expect(row, `id ${id} 必须在表里`).toBeDefined()
    }
    for (const row of table.emitters) {
      const c = toEmitterConfig(row)
      expect(Number.isFinite(c.spawnSize.x) && Number.isFinite(c.acceleration.y)).toBe(true)
    }
  })

  it('**每一行配置都要有读者**（无消费方的数据不许入表，§55/KI-047）', () => {
    // 判据：表里的每个 id，必须在 `src/` 下（**代码或数据**）以字面量出现——那就是有人点名它。
    // 读者有两类，缺一不可：① 代码里的字面量（`spawn('decal_blood', …)` 那种直接点名）；
    // ② 数据里的字面量（`weapons.json > trail: "trail_blade"`——拖尾的 id 是**武器表**给的，
    // 代码里读的是 `this.weapon.trail`，不写死任何一个 id）。
    // 这不是"它应该在某个白名单里"——白名单会变成第二个真相；这里量的是"真有人点名它"。
    const srcDir = root + 'src/'
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = dir + '/' + e.name
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.ts') || e.name.endsWith('.json')) files.push(p)
      }
    }
    walk(srcDir)
    const corpus = files.map((f) => readFileSync(f, 'utf8')).join('\n')
    const orphans = vfxConfigIds(table).filter((id) => !corpus.includes(id))
    expect(orphans, `这些配置 id 在 src/ 里没有任何读者（表里不许留没人用的行）：${orphans.join(' ')}`).toEqual([])
  })
})
