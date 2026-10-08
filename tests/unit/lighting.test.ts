import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { lightingRows, regions } from '@/data'
import type { LightingRow } from '@/data/schema'
import { ColorGrade, gradeFilter } from '@/vfx/ColorGrade'
import { FOG_DARK_SHARE, FOG_SKY_SHARE, hexToRgb, lightingFogRgb, lightingGrade, lightingLights, lightingRow, rgbToHex } from '@/world/Lighting'
import { lightingFindings, LIGHT_RULINGS } from '../../scripts/lighting-rules.mjs'

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
 *
 * **§37 第二腿（2026-10-09）之后这里多两块**：
 *  ⑤ 三层光读数（`lightingLights`）：颜色从 §2 那六列现推（§8 明写 key=SKY / point=EMIT），
 *     强度与方向从 `lights` 读，缺省一律 0（没有裁决过的光不许亮）；
 *  ⑥ 判据 L1–L5：喂合成行，看"没有裁决理由的数"与"零向量方向"各红各的。
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

describe('§37 第二腿：三层光读数（颜色从六列现推，强度从 lights 读，缺省一律 0）', () => {
  it('§8 的映射照念：key/hemi 天色 = SKY 列，hemi 地色 = DARK 列，point = EMIT 列', () => {
    const r = lightingLights(lightingRow('lp_resthold'))!
    expect(r.hemiSky).toBe('#8A6F55')
    expect(r.hemiGround).toBe('#1A130D')
    expect(r.keyColor).toBe('#8A6F55')
    expect(r.pointColor).toBe('#FFB86B')
    // 七行逐行对账：这三条映射对每一行都成立（有一行不成立就是读者自己加了规则）
    for (const row of lightingRows) {
      const l = lightingLights(row)!
      expect(l.pointColor, `${row.id} 的 point 色`).toBe(row.emit)
      expect(l.hemiGround, `${row.id} 的 hemi 地色`).toBe(row.dark)
      expect(l.keyColor, `${row.id} 的 key 色`).toBe(row.sky ?? row.sec)
      expect(l.hemiSky, `${row.id} 的 hemi 天色与 key 色同源（§5.1 与 §8 指的是同一束极光）`).toBe(l.keyColor)
    }
  })

  it('SKY 列省略的三行按 SEC 走（裁决 L1）：那不是"找个近似色顶上"，是另一条明文规则', () => {
    for (const id of ['lp_fellcarillon', 'lp_earless_deeps', 'lp_drowned_choir']) {
      const row = lightingRow(id)!
      const l = lightingLights(row)!
      expect(row.sky).toBeUndefined()
      expect(l.keyColor).toBe(row.sec)
      // 雾色走的是 DARK（§8 的 70/30 那一半没有天光份额），三层光走的是 SEC——两条退路不同，
      // 因为"没有天光"对雾意味着"只剩暗部"，对方向光意味着"还剩次要色"
      expect(lightingFogRgb(row)).toEqual(hexToRgb(row.dark))
    }
  })

  it('深窖的 keyIntensity 是 0（§8 自己开的例外：唯一光源是矿缝），其余六行都是 1.5', () => {
    expect(lightingLights(lightingRow('lp_earless_deeps'))!.keyIntensity).toBe(0)
    for (const row of lightingRows) {
      if (row.id === 'lp_earless_deeps') continue
      expect(lightingLights(row)!.keyIntensity, `${row.id}`).toBe(1.5)
    }
    // 例外只关方向光：极光与 point 两层在深窖仍然亮着（"没有方向光"≠"没有光"）
    const deeps = lightingLights(lightingRow('lp_earless_deeps'))!
    expect(deeps.hemiIntensity).toBeGreaterThan(0)
    expect(deeps.pointIntensity).toBeGreaterThan(0)
  })

  it('七行全都有 lights：读者对缺失行的退路是三格全 0，而那种黑没有任何别的东西会响', () => {
    for (const row of lightingRows) {
      expect(row.lights, `${row.id} 少了 lights`).toBeTypeOf('object')
      expect(Object.keys(row.lights!).sort()).toEqual(['hemiIntensity', 'keyDir', 'keyIntensity', 'pointIntensity'])
    }
    const bare = { ...lightingRow('lp_resthold')! } as LightingRow
    delete (bare as { lights?: unknown }).lights
    expect(lightingLights(bare)).toEqual({
      hemiSky: '#8A6F55', hemiGround: '#1A130D', hemiIntensity: 0,
      keyColor: '#8A6F55', keyIntensity: 0, keyDir: [0, 0, 0],
      pointColor: '#FFB86B', pointIntensity: 0,
    })
  })

  it('认不出名字 / null / 坏 hex 都不猜：返回 null 由调用方把三盏灯全关掉', () => {
    expect(lightingLights(null)).toBeNull()
    expect(lightingLights(lightingRow('lp_nope'))).toBeNull()
    expect(lightingLights({ ...lightingRow('lp_resthold')!, emit: 'nope' } as LightingRow)).toBeNull()
    // SKY 坏 ⇒ 推导出的 key/hemi 天色也坏 ⇒ 同一道门拦得住（不是只有显式那几格被查）
    expect(lightingLights({ ...lightingRow('lp_resthold')!, sky: '#12345' } as LightingRow)).toBeNull()
  })

  it('每颗强度都在判据的界内，keyDir 不是零向量（真表自己也要过自己那几条界）', () => {
    for (const row of lightingRows) {
      const l = row.lights!
      for (const k of ['hemiIntensity', 'keyIntensity', 'pointIntensity'] as const) {
        expect(Number.isFinite(l[k]), `${row.id}.${k}`).toBe(true)
      }
      expect(l.keyDir.some((v) => v !== 0), `${row.id} 的 keyDir 是零向量`).toBe(true)
    }
  })
})

describe('判据本体可喂（合成夹具）：链断了要会说，不能静默全绿', () => {
  const rig = { hemiIntensity: 0.7, keyIntensity: 1.5, keyDir: [12, 20, 8], pointIntensity: 64 }
  const good = [
    { id: 'lp_a', base: '#111111', sec: '#222222', accent: '#333333', emit: '#444444', dark: '#555555', lights: rig, note: '合成行：无天光' },
    { id: 'lp_b', base: '#111111', sec: '#222222', accent: '#333333', emit: '#444444', sky: '#666666', dark: '#555555', lights: rig },
  ]
  /** 合成行用自己的小账本（真账本只有七个真 id；喂合成 id 会条条撞 L1） */
  const rulings = { lp_a: 'x'.repeat(24), lp_b: 'y'.repeat(24) }
  const why = (rows: unknown[], referenced: string[], withRulings: { [id: string]: string } = rulings): string[] =>
    lightingFindings('lighting.json', rows, referenced, withRulings).filter((f) => f.level === 'error').map((f) => f.msg)

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

  it('§37 第二腿：没有裁决理由的数、假账、写 0 的 hemi、零向量方向、缺 lights、省 sky 不写 note', () => {
    // L1：有数必须有理由（账本读不到 = 一条都没有 ⇒ 每一行都红）
    expect(why(good, ['lp_a', 'lp_b'], {}).join('\n')).toContain('却没有裁决理由')
    // L2：行已不声明而账还挂着 ⇒ 假账该销
    const noLights = good.map((r) => { const c = { ...r }; delete (c as { lights?: unknown }).lights; return c })
    expect(why(noLights, ['lp_a', 'lp_b']).join('\n')).toContain('假账该销')
    // L3：hemi/point 写 0 是没有后果的读数；key 写 0 是 §8 的例外，放行
    expect(why([{ ...good[0], lights: { ...rig, hemiIntensity: 0 } }], ['lp_a']).join('\n')).toContain('没有后果的读数')
    expect(why([{ ...good[0], lights: { ...rig, pointIntensity: 0 } }], ['lp_a']).join('\n')).toContain('没有后果的读数')
    expect(why([{ ...good[0], lights: { ...rig, keyIntensity: 0 } }], ['lp_a'])).toEqual([])
    // L3 的界
    expect(why([{ ...good[0], lights: { ...rig, pointIntensity: 6400 } }], ['lp_a']).join('\n')).toContain('出界')
    // L5：零向量方向
    expect(why([{ ...good[0], lights: { ...rig, keyDir: [0, 0, 0] } }], ['lp_a']).join('\n')).toContain('零向量')
    expect(why([{ ...good[0], lights: { ...rig, keyDir: [12, 20] } }], ['lp_a']).join('\n')).toContain('keyDir')
    // L4：lights 必填
    expect(why(noLights, ['lp_a', 'lp_b'], {}).join('\n')).toContain('lights 必填')
    // 未知子字段
    expect(why([{ ...good[0], lights: { ...rig, warmth: 2 } }], ['lp_a']).join('\n')).toContain('未知字段')
    // 省了 sky 却不写 note ⇒ 那一行的 key/hemi 颜色要按 SEC 走，理由必须落在表里
    const noNote = { ...good[0], note: undefined }
    expect(why([{ ...noNote, sky: undefined }], ['lp_a']).join('\n')).toContain('note 必填')
    expect(why([{ ...noNote, sky: undefined, note: '无天光' }], ['lp_a'])).toEqual([])
  })

  it('裁决账本 ⇄ 真表：七行各有理由，没有一条是假账', () => {
    for (const row of lightingRows) {
      expect(LIGHT_RULINGS[row.id], `${row.id} 没有裁决理由`).toBeTypeOf('string')
      expect(LIGHT_RULINGS[row.id].length, `${row.id} 的理由太短`).toBeGreaterThanOrEqual(20)
    }
    // 深窖那条必须说出自己为什么偏离基线（它是七行里唯一 keyIntensity ≠ 1.5 的）
    expect(LIGHT_RULINGS.lp_earless_deeps).toContain('矿缝')
    expect(LIGHT_RULINGS.lp_earless_deeps.length).toBeGreaterThan(LIGHT_RULINGS.lp_resthold.length)
  })

  it('真表过判据：七行 ⇄ 七区，一条 finding 都没有', () => {
    const referenced = regions.map((r) => r.lightingPreset)
    expect(lightingFindings('lighting.json', lightingRows, referenced, LIGHT_RULINGS)).toEqual([])
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

  it('源码门：三层光只有一个主人，灰盒场地里不再有第二份写死的灯', () => {
    // `PlaceholderArena` 曾经写死 hemi 0x35406b/0.7 与 key 0xd8c37a/1.5——那是雾语林的配色，
    // 而玩家出生在休垒。现在那两盏灯归 `SceneLights`，灰盒里一个 THREE.*Light 都不该再有。
    const arenaSrc = readFileSync(root + 'src/world/PlaceholderArena.ts', 'utf8')
    expect(arenaSrc, '灰盒场地又自己建了灯 = 同一件事有两个主人').not.toMatch(/new THREE\.(Hemisphere|Directional|Point|Ambient|Spot)Light/)
    // 绘制层只认读数，自己不做判断：一个 hex 字面量都不该出现在 SceneLights 里
    const sceneSrc = readFileSync(root + 'src/world/SceneLights.ts', 'utf8')
    expect(sceneSrc, 'SceneLights 里出现了写死的 hex = 判断从读数层漏出来了').not.toMatch(/#[0-9a-fA-F]{3,6}/)
    // main.ts 里三层光只被读一次（开局那次 applyLighting），且 SceneLights 建在 createArena 之后
    expect((mainSrc.match(/lights\.setRig\(/g) ?? []).length, '三层光的写方只该在 applyLighting 里出现一次').toBe(1)
    expect((mainSrc.match(/applyLighting\(/g) ?? []).length, '光照腿只该在开局与换区被读两处').toBe(2)
    expect(mainSrc.indexOf('new SceneLights(')).toBeGreaterThan(mainSrc.indexOf('createArena('))
    // 三层光只听区域：与雾色/LUT 同一条纪律，不听旗标与值域
    expect(mainSrc).not.toMatch(/bus\.on\('world\.flag'[^\n]*applyLighting/)
    expect(mainSrc).not.toMatch(/bus\.on\('world\.state'[^\n]*applyLighting/)
  })
})
