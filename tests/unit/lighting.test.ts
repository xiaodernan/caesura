import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { lightingRows, regions } from '@/data'
import type { LightingRow } from '@/data/schema'
import { ColorGrade, gradeFilter } from '@/vfx/ColorGrade'
import { FOG_DARK_SHARE, FOG_SKY_SHARE, hexToRgb, lightingFogRgb, lightingGrade, lightingRow, rgbToHex } from '@/world/Lighting'
import { lightingFindings } from '../../scripts/lighting-rules.mjs'

/**
 * §37 第一腿（KI-094 同族）：`lightingPreset` 这个名字十周来没有任何读者——`regions.json` 七区各写一个
 * `lp_*`，指向一张不存在的表。这一份量的不是"表里有数据"，而是**那条链是通的**：
 *
 *   ① 读数层（`world/Lighting.ts`）：hex 解析、§8 的 70/30 雾色混合、LUT 乘数缺省中性；
 *   ② **文档对账**：art-direction §2 自称「唯一合法颜色表」，那它就必须是可执行的——
 *      从 markdown 现推每一区的六色，与 `lighting.json` 逐格比（改一边不改另一边 ⇒ 红）；
 *   ③ 判据本体可喂：`lightingFindings` 能在合成行上报出悬空引用、孤儿行、坏 hex、写 1 的乘数；
 *   ④ 运行时腿：`ColorGrade` 真的是雾色与 LUT 的写方，且与天气、失谐是**乘在一起**而不是互相覆盖。
 *
 * 不量的那一半写在上面的文件头注里：三层光与跨区过渡带要真几何（KI-008 / Phase 7）。
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const artDoc = readFileSync(root + 'docs/art-direction.md', 'utf8')
const mainSrc = readFileSync(root + 'src/main.ts', 'utf8')
const gradeSrc = readFileSync(root + 'src/vfx/ColorGrade.ts', 'utf8')

/** 假画布：只记被写几次与最后一次的值（与 `color-grade.test.ts` 同一个替身） */
function fakeCanvas(): { el: HTMLCanvasElement; value: () => string } {
  let v = ''
  const style = { get filter(): string { return v }, set filter(next: string) { v = next } }
  return { el: { style } as unknown as HTMLCanvasElement, value: () => v }
}

function fogScene(): { scene: THREE.Scene; fog: THREE.FogExp2 } {
  const fog = new THREE.FogExp2(0x0b0e16, 0.028)
  const scene = new THREE.Scene()
  scene.fog = fog
  return { scene, fog }
}

describe('读数层：hex ⇄ 三元组、§8 的 70/30 雾色、LUT 缺省中性', () => {
  it('hexToRgb 吃 #RGB 与 #RRGGBB，大小写不敏感，坏形状返回 null', () => {
    expect(hexToRgb('#3A2C1E')).toEqual([0x3a, 0x2c, 0x1e])
    expect(hexToRgb('#abc')).toEqual([0xaa, 0xbb, 0xcc])
    expect(hexToRgb('#ABC')).toEqual([0xaa, 0xbb, 0xcc])
    // 文档那张表本身大小写混用（#3A2C1E 与 #E8DFCB）——按大小写判合法等于判文档不合法
    for (const bad of ['3A2C1E', '#3A2C1', '#3A2C1EE', '#gggggg', '', '#12 456']) {
      expect(hexToRgb(bad), bad).toBeNull()
    }
  })

  it('rgbToHex 是 hexToRgb 的逆，且把越界夹回 0..255', () => {
    for (const hex of ['#3A2C1E', '#0B0D10', '#FFFFFF', '#000000']) {
      expect(rgbToHex(hexToRgb(hex)!).toUpperCase()).toBe(hex.toUpperCase())
    }
    expect(rgbToHex([300, -5, 12.6])).toBe('#ff000d')
  })

  it('雾色 = DARK×0.7 + SKY×0.3（按通道）：休垒 (26,19,13) 与 (138,111,85) ⇒ (60,47,35)', () => {
    expect(FOG_DARK_SHARE + FOG_SKY_SHARE, '两个份额必须加起来是 1，否则雾色会整体偏亮/偏暗').toBe(1)
    const row = lightingRow('lp_resthold')!
    expect(lightingFogRgb(row)).toEqual([60, 47, 35])
    // 混合是**按通道**的：把两个 hex 拼起来、或取平均值都不该过
    expect(lightingFogRgb(row)).not.toEqual(hexToRgb(row.dark))
    expect(lightingFogRgb(row)).not.toEqual(hexToRgb(row.sky!))
  })

  it('没有天光的行整份取 DARK（深窖/沉唱堂/钟坠院省略 sky）——不是找个近似色顶上', () => {
    for (const id of ['lp_earless_deeps', 'lp_drowned_choir', 'lp_fellcarillon']) {
      const row = lightingRow(id)!
      expect(row.sky, `${id} 省略了 sky`).toBeUndefined()
      expect(lightingFogRgb(row)).toEqual(hexToRgb(row.dark))
      expect(row.note, `${id} 少了一格就必须说为什么`).toBeTypeOf('string')
    }
  })

  it('认不出名字 / null / 坏 hex 都不猜色：返回 null 由调用方落回"不写"', () => {
    expect(lightingRow('lp_nope')).toBeNull()
    expect(lightingRow(null)).toBeNull()
    expect(lightingFogRgb(null)).toBeNull()
    expect(lightingFogRgb({ ...lightingRow('lp_resthold')!, dark: 'nope' } as LightingRow)).toBeNull()
  })

  it('LUT 读数：文档给了数的两格照读，没给的按 1.0 中性（缺省 = 不改那一格，不是猜一个数）', () => {
    expect(lightingGrade(lightingRow('lp_resthold'))).toEqual({ saturateMul: 1.5, contrastMul: 1 })
    expect(lightingGrade(lightingRow('lp_earless_deeps'))).toEqual({ saturateMul: 0.65, contrastMul: 1 })
    expect(lightingGrade(lightingRow('lp_unfinished_hall'))).toEqual({ saturateMul: 1, contrastMul: 1.25 })
    expect(lightingGrade(lightingRow('lp_whisperwode'))).toEqual({ saturateMul: 1, contrastMul: 1 })
    expect(lightingGrade(null)).toEqual({ saturateMul: 1, contrastMul: 1 })
  })
})

describe('文档对账：art-direction §2 那张「唯一合法颜色表」必须是可执行的', () => {
  /** §2 表格的数据行 → `{ 区域中文名, hexes: 六格各自抓到的 hex }`（从 markdown 现推，不手抄） */
  const docRows = artDoc
    .split('## 2. 区域色板')[1]
    .split('\n## ')[0]
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('|--') && !l.startsWith('| 区域 '))
    .map((l) => {
      const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      return { name: cells[0].split(' ')[0], cells }
    })

  it('§2 那张表读到了七行，且每一行都对得上一个真区域（按中文名前缀，不按英文名）', () => {
    expect(docRows.length, '文档 §2 的行数变了 ⇒ 这一节要重新对账').toBe(7)
    const byZh = new Map(regions.map((r) => [r.displayName.split(' ')[0], r]))
    for (const row of docRows) {
      expect(byZh.has(row.name), `文档里的「${row.name}」在 regions.json 里找不到同名区`).toBe(true)
    }
  })

  it('每一行的五色与 §2 逐字相同；SKY 那一格要么单色对上、要么文档自己就没给单色', () => {
    for (const row of docRows) {
      const rg = regions.find((r) => r.displayName.split(' ')[0] === row.name)!
      const data = lightingRow(rg.lightingPreset)!
      expect(data, `${rg.id} 指着 '${rg.lightingPreset}' 而表里没有这一行`).toBeTruthy()
      for (const [idx, key] of [[1, 'base'], [2, 'sec'], [3, 'accent'], [4, 'emit'], [6, 'dark']] as const) {
        const hexes = row.cells[idx].match(/#[0-9a-fA-F]{3,6}/g) ?? []
        expect(hexes.length, `${row.name} 的 ${key} 在文档里不是恰好一个 hex：${row.cells[idx]}`).toBe(1)
        expect((data as unknown as Record<string, string>)[key].toUpperCase(), `${row.name}.${key}`).toBe(hexes[0]!.toUpperCase())
      }
      const skyHexes = row.cells[5].match(/#[0-9a-fA-F]{3,6}/g) ?? []
      if (skyHexes.length === 1) {
        expect(data.sky?.toUpperCase(), `${row.name}.sky`).toBe(skyHexes[0].toUpperCase())
      } else {
        // 文档没给单色（"无天光（纯黑）"/"无（地下）"/ 落日渐层两停）⇒ 数据必须**省略**而不是填一个近似色，
        // 并且必须写明为什么少一格（否则十年后没人知道这是裁决还是漏写）
        expect(data.sky, `${row.name} 的 SKY 文档给的是 ${JSON.stringify(row.cells[5])}，单色格装不下`).toBeUndefined()
        expect(data.note, `${row.name} 少了 sky 却没写 note`).toBeTypeOf('string')
      }
    }
  })

  it('§8 的 LUT 那句也只对三区有数：休垒 +0.5 饱和 / 深窖 −35% 饱和 / 未竟厅 +25% 对比', () => {
    // 这三条是**文档读数**，写死在这里：谁改了 art-direction §8 那一句，这里红。
    expect(lightingGrade(lightingRow('lp_resthold')).saturateMul).toBe(1.5)
    expect(lightingGrade(lightingRow('lp_earless_deeps')).saturateMul).toBe(0.65)
    expect(lightingGrade(lightingRow('lp_unfinished_hall')).contrastMul).toBe(1.25)
    const withGrade = lightingRows.filter((r) => r.grade !== undefined).map((r) => r.id).sort()
    expect(withGrade, '多出来的行说明有人给没给数的区编了读数（§55）').toEqual(['lp_earless_deeps', 'lp_resthold', 'lp_unfinished_hall'])
    // 「冷暖」那一格整个没建：文档只给了定性描述（休垒 +暖），没有数值口径
    expect(artDoc).toContain('冷暖')
    for (const r of lightingRows) expect(Object.keys(r.grade ?? {}).every((k) => k !== 'warmthMul')).toBe(true)
  })
})

describe('判据本体可喂（合成夹具）：链断了要会说，不能静默全绿', () => {
  const good = [
    { id: 'lp_a', base: '#111111', sec: '#222222', accent: '#333333', emit: '#444444', dark: '#555555' },
    { id: 'lp_b', base: '#111111', sec: '#222222', accent: '#333333', emit: '#444444', sky: '#666666', dark: '#555555' },
  ]
  const why = (rows: unknown[], referenced: string[]): string[] =>
    lightingFindings('lighting.json', rows, referenced).filter((f) => f.level === 'error').map((f) => f.msg)

  it('好表 + 两侧引用齐全 ⇒ 零 finding', () => {
    expect(why(good, ['lp_a', 'lp_b'])).toEqual([])
  })

  it('三种断链各红各的：悬空引用、孤儿行、坏 hex、写 1 的乘数', () => {
    expect(why(good, ['lp_a', 'lp_ghost']).join('\n')).toContain("'lp_ghost'")
    expect(why(good, ['lp_a']).join('\n')).toContain('没有任何一区在 lightingPreset 里指它')
    expect(why([{ ...good[0], dark: 'nope' }], ['lp_a']).join('\n')).toContain('合法 hex')
    expect(why([{ ...good[0], sky: '#12345' }], ['lp_a']).join('\n')).toContain('sky')
    expect(why([{ ...good[0], grade: { saturateMul: 1 } }], ['lp_a']).join('\n')).toContain('没有后果的读数')
    expect(why([{ ...good[0], grade: { warmthMul: 1.2 } }], ['lp_a']).join('\n')).toContain('未知乘数')
    expect(why(good, []).join('\n')).toContain('这道门在空转')
  })

  it('真表过判据：七行 ⇄ 七区，一条 finding 都没有', () => {
    const referenced = regions.map((r) => r.lightingPreset)
    expect(lightingFindings('lighting.json', lightingRows, referenced)).toEqual([])
    expect(new Set(referenced).size, '两个区共用一个预设不犯法，但今天七区各自一个').toBe(7)
  })
})

describe('运行时腿：雾色与 LUT 真的被写，而且和天气、失谐乘在一起', () => {
  it('setLighting 写的是 §8 那个 70/30 混色，setLighting(null) 不碰雾色', () => {
    const { scene, fog } = fogScene()
    const grade = new ColorGrade(scene, fakeCanvas().el)
    const before = fog.color.getHexString()
    grade.setLighting(lightingRow('lp_resthold'))
    expect(fog.color.getHexString()).toBe(rgbToHex(lightingFogRgb(lightingRow('lp_resthold')!)!).slice(1))
    expect(fog.color.getHexString()).not.toBe(before)
    grade.setLighting(null)
    expect(fog.color.getHexString(), '没有预设时不猜一个色盖上场景建好时的那个').toBe(rgbToHex(lightingFogRgb(lightingRow('lp_resthold')!)!).slice(1))
  })

  it('合成律三方相乘：失谐 0.5 × 休垒 saturate 1.5 ⇒ saturate(0.75)，谁也没盖掉谁', () => {
    const l = lightingGrade(lightingRow('lp_resthold'))
    expect(gradeFilter(0.5, {}, l)).toBe('saturate(0.75) brightness(0.85)')
    // 对比那一格只有天气与光照两方：§11 的失谐不碰对比度（这是它落地那天起的口径）
    expect(gradeFilter(0.5, { contrastMul: 0.6 }, lightingGrade(lightingRow('lp_unfinished_hall'))))
      .toBe('saturate(0.50) brightness(0.85) contrast(0.75)')
    // 不传第三条腿 = 既有调用点一个字节都不变（回归带）
    expect(gradeFilter(0, {})).toBe('')
    expect(gradeFilter(0.5, { brightnessMul: 0.8 })).toBe('saturate(0.50) brightness(0.68)')
  })

  it('源码门：雾色只有一个写方；光照腿由组合根喂，且开局与换区各读一次', () => {
    // 雾色与雾密度同一条纪律：画面层里只能有一个写方，第二个就是第二个仲裁者
    const writers = (gradeSrc.match(/fog\.color\.set/g) ?? []).length
    expect(writers, 'ColorGrade 里写雾色的地方不止一处').toBe(1)
    expect((mainSrc.match(/grade\.setLighting\(/g) ?? []).length, 'main.ts 里出现了第二处 grade.setLighting(').toBe(1)
    expect((mainSrc.match(/applyLighting\(/g) ?? []).length, '光照腿只该在开局与换区被读两处（定义那一行是 const 赋值，不匹配这个模式）').toBe(2)
    // 光照只听区域：它不听旗标/值域（天气才听），听了也是同一份读数，白算
    expect(mainSrc).not.toMatch(/bus\.on\('world\.flag'[^\n]*applyLighting/)
    expect(mainSrc).not.toMatch(/bus\.on\('world\.state'[^\n]*applyLighting/)
    // 读数层是逻辑层：不许 import three（与 arch-boundaries 那道门同一个理由，这里就近再钉一次）
    const lightingSrc = readFileSync(root + 'src/world/Lighting.ts', 'utf8')
    expect(lightingSrc).not.toMatch(/from 'three'/)
  })
})
