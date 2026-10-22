import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VFX_PALETTE } from '../../src/vfx/materials'

/**
 * art-direction.md §7.1「敌我特效色相分离表（HSL 色相区间，硬约束）」的第一台机器读者（KI-296）。
 *
 * **病**：那张表自称「硬约束」，`tests/unit/vfx-materials.test.ts` 的 describe 标题也写着
 * 「art-direction §2/§7.1 唯一合法取色」——但那个 describe 只把运行时那五颗 hex **逐字钉在自己身上**，
 * 一个字节都没读文档。于是「运行时取色守不守 §7.1 / §2 那两句」从未被测过：标题承诺的对账是空额。
 *
 * **口径**（三条，全部先量过才落笔，2026-10-22）：
 *  - 色相/饱和/明度用 HSL（文档那一列明写「HSL 色相区间」）；区间回绕按 `350–15°` 那一行处理
 *    （起点 > 终点 ⇒ 跨 0°）；
 *  - §2 那句「只能从本表及其 ±10% 明度变体中取」要能被机器执行就得给死阈值：**色相 ≤ ±2°、
 *    饱和 ≤ ±5 个百分点、明度 0 < |Δ| ≤ 10 个百分点**（明度不动就不是变体，那是"逐字"那一格）；
 *  - 运行时总体只取 `src/vfx/materials.ts` 的 `VFX_PALETTE`：它是 §7.1 唯一**点到了语义身份**的取色载体
 *    （五颗各有名字，`VfxLayer` 逐颗实例化）。`vfx.json` 那 14 颗与 `src/` 里散落的 `0x……` 字面量
 *    **本批不纳入判决**：§7.1 只点名语义、没点名载体（实测全文 0 次出现 decal/trail/emitter/贴花/拖尾/发射器，
 *    且那 14 颗没有一颗在文档全文出现过），
 *    替它们认定"属于哪一行"就是我替设计做裁决 ⇒ 登记为总体边界未立（见账本 KI-296）。
 *  - 两张表都有的一颗按 §2 归（实测 §7.1 那六颗代表色里 4 颗同时也是 §2 的格子，只有 `#DDE6EA`/`#FFD98A`
 *    只住在 §7.1——而"只住 §7.1"那两颗恰好就是下面矛盾的两颗；本门只把这个重合登记成读数，不声称因果）。
 *
 * **读数**（钉进门里，改动任何一边都会红）：
 *  - 文档自己两行不能同时成立：`玩家攻击轨迹/战技` 代表色 `#DDE6EA` 实测 h=198.5，区间写 200–220（差 −2°）；
 *    `玩家弹反/完美格挡` 代表色 `#FFD98A` 实测 h=40.5，区间写 45–55（差 −4°）。
 *  - 运行时五颗按上面那两句分类：逐字在 §2 色板里的**只有 ember 一颗**；silver 逐字=§7.1 代表色、
 *    discordViolet 是 §7.1 代表色的变体；**warmGold 与 parryWhite 两边都不属**（离最近表色 Δh=11°，
 *    比"变体"的 ±2° 宽五倍半）。
 *  - 那句「同屏敌我特效色相距离 ≥ 90°」：文档命名的那一对（冷银 vs 暖红）实测 164° 成立；
 *    没被命名的另一对（弹反金白 vs 暖红）实测 39° **不成立** ⇒ 适用范围是裁决缺口，本批只量不裁。
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const doc = readFileSync(root + 'docs/art-direction.md', 'utf8').replace(/\r\n/g, '\n')

type Band = readonly [number, number]
type DocRow = { readonly semantic: string; readonly bands: readonly Band[]; readonly swatches: readonly string[] }

const isDataRow = (l: string): boolean => l.startsWith('| ') && !/^\|[-\s|]+$/.test(l) && !l.startsWith('| 区域 ') && !l.startsWith('| 语义 ')

const table = (head: string): string[] => doc.split(head)[1]!.split('\n## ')[0]!.split('\n').filter(isDataRow)

const cellsOf = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

const hex6 = (n: number): string => '#' + n.toString(16).toUpperCase().padStart(6, '0')

function hsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: s * 100, l: l * 100 }
}

function inBand(h: number, [a, b]: Band): boolean {
  return a <= b ? h >= a && h <= b : h >= a || h <= b
}

function hueDistance(x: number, y: number): number {
  const d = Math.abs(x - y) % 360
  return d > 180 ? 360 - d : d
}

/** §2 那 41 颗（7 行 × 6 列，减掉文档明写"无天光/无（地下）"的两格，加钟坠院落日渐层的第二个停点） */
const palette2 = new Set<string>()
for (const line of table('## 2. 区域色板')) {
  for (const m of cellsOf(line).join(' ').matchAll(/#([0-9a-fA-F]{6})/g)) palette2.add('#' + m[1]!.toUpperCase())
}

/** §7.1 那 8 行：区间从「色相区间」那一列现推，代表色从「代表色」那一列现推 */
const rows71: DocRow[] = table('### 7.1 敌我特效色相分离表').map((line) => {
  const cells = cellsOf(line)
  const bands = [...cells[1]!.matchAll(/(\d{1,3})\s*[–-]\s*(\d{1,3})\s*°/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
  const swatches = (cells[2]!.match(/#[0-9a-fA-F]{6}/g) ?? []).map((x) => x.toUpperCase())
  return { semantic: cells[0]!, bands, swatches }
})

const swatch71 = new Set(rows71.flatMap((r) => r.swatches))

/** 一颗颜色相对那两句「唯一合法」的分类 */
type Tag = '§2逐字' | '§7.1逐字' | '变体' | '都不属'
function classify(hex: string): { tag: Tag; nearest: string; d: { h: number; s: number; l: number } } {
  const a = hsl(hex)
  if (palette2.has(hex)) return { tag: '§2逐字', nearest: hex, d: { h: 0, s: 0, l: 0 } }
  if (swatch71.has(hex)) return { tag: '§7.1逐字', nearest: hex, d: { h: 0, s: 0, l: 0 } }
  const pool = [...palette2, ...swatch71]
  let best = { hex: pool[0]!, dh: 999, ds: 999, dl: 999 }
  for (const p of pool) {
    const b = hsl(p)
    const cand = { hex: p, dh: hueDistance(a.h, b.h), ds: Math.abs(b.s - a.s), dl: Math.abs(b.l - a.l) }
    if (cand.dh + cand.ds + cand.dl < best.dh + best.ds + best.dl) best = cand
  }
  const isVariant = best.dh <= 2 && best.ds <= 5 && best.dl > 0 && best.dl <= 10
  return { tag: isVariant ? '变体' : '都不属', nearest: best.hex, d: { h: best.dh, s: best.ds, l: best.dl } }
}

const vfxEntries = Object.entries(VFX_PALETTE) as [string, number][]

describe('口径自证：HSL 色相、回绕区间、±10% 明度变体这三把尺子自己得走对', () => {
  it('已知颜色的 h/s/l 读数（文档那一列写的是 HSL，尺子错了后面全是错的）', () => {
    expect(Math.round(hsl('#FF0000').h)).toBe(0)
    expect(Math.round(hsl('#A8322E').h)).toBe(2)
    expect(Math.round(hsl('#DDE6EA').h)).toBe(198)
    expect(Math.round(hsl('#FFB86B').s)).toBe(100)
    expect(Math.round(hsl('#000000').s), '纯黑的饱和必须是 0：否则拿它去撞"变体"会误判').toBe(0)
  })

  it('区间回绕：`350–15°` 那一行两侧都算内，180° 算外', () => {
    const wrap: Band = [350, 15]
    for (const h of [2, 356, 350, 15]) expect(inBand(h, wrap), `${h}°`).toBe(true)
    expect(inBand(180, wrap), '把回绕区间当成 [15,350] 会把半个色环判成合法').toBe(false)
    expect(inBand(200, [200, 220])).toBe(true)
    expect(inBand(198, [200, 220]), '边界是闭区间，但不许吞掉 198：那颗正是本批登记的矛盾').toBe(false)
  })

  it('色相距离取环上短弧：冷银 vs 暖红 = 164° 而不是 196°', () => {
    expect(Math.round(hueDistance(hsl('#DDE6EA').h, hsl('#A8322E').h))).toBe(164)
    expect(hueDistance(0, 359)).toBeCloseTo(1, 6)
  })

  it('「±10% 明度变体」的阈值真能分出变体与另起一色', () => {
    // 只有「两张表都不在」与「变体」这两种读法之间那条线是本口径的全部意义：尺子错了，下面「欠账两颗」就是空话
    expect(classify('#DDE6EA').tag, '文档代表色自己必须算逐字命中，否则变体那一格永远读不到东西').toBe('§7.1逐字')
    expect(classify('#9A4FD0').tag, '失谐紫离 #8E44C8 是 Δh≈1 Δs≈3 Δl≈4 ⇒ 按口径算变体').toBe('变体')
    expect(classify('#C9B458').tag, '暖金离最近表色 Δh≈11° ⇒ 超出 ±2°，不是变体').toBe('都不属')
  })

  it('一颗颜色同时属于两张表时按 §2 归（顺序写进断言，不留在读者脑子里）', () => {
    expect(palette2.has('#8E44C8'), '#8E44C8 得真的两张表都在，否则这一格读的是条空规则').toBe(true)
    expect(swatch71.has('#8E44C8')).toBe(true)
    expect(classify('#8E44C8').tag, '§7.1 的「失谐/敌意」代表色与 §2 未竟厅的 emit 是同一颗 ⇒ 归 §2').toBe('§2逐字')
  })
})

describe('文档侧名册读得到，而且形状钉得住', () => {
  it('§7.1 读到 8 行，其中 6 行同时给了区间与代表色', () => {
    expect(rows71.map((r) => r.semantic), '文档 §7.1 的行数或行名变了 ⇒ 这一节要重新对账').toHaveLength(8)
    expect(rows71.filter((r) => r.bands.length).map((r) => r.semantic)).toEqual([
      '玩家攻击轨迹/战技',
      '玩家弹反/完美格挡',
      '敌人攻击 telegraph',
      '失谐/Corruption 系',
      '友方 NPC/可交互',
      '场景拾取/奖励',
    ])
    expect(rows71.filter((r) => r.swatches.length).length, '代表色写「—」的两行不给色，就不许被当成给了').toBe(6)
  })

  it('§2 那张「唯一合法颜色表」读到 41 颗 hex', () => {
    expect(palette2.size, '§2 的格子数变了 ⇒ lighting.test.ts 那五列逐格对账与本门的名册都要重新量').toBe(41)
    expect([...palette2]).toContain('#FFB86B')
  })

  it('§7.1 那六颗代表色里有四颗同时也是 §2 的格子，只有两颗只住在 §7.1', () => {
    // 读数，不是因果：这两组今天恰好重合（只住 §7.1 的两颗正是矛盾那两颗），但门不声称它们必须重合
    const both = [...swatch71].filter((s) => palette2.has(s)).sort()
    const only71 = [...swatch71].filter((s) => !palette2.has(s)).sort()
    expect(both, '两张表共用的代表色名册').toEqual(['#8E44C8', '#A8322E', '#EFD9A0', '#FFB86B'])
    expect(only71).toEqual(['#DDE6EA', '#FFD98A'])
    expect(swatch71.size, '文档 §7.1 代表色总数（两行写「—」不给色）').toBe(6)
  })

  it('两句自述的原话还在（钉载体，别让门在文档被删之后空转）', () => {
    expect(doc).toContain('唯一合法颜色表')
    expect(doc).toContain('HSL 色相区间，硬约束')
    expect(doc).toContain('同屏敌我特效色相距离 ≥ 90°')
  })
})

describe('承重腿：运行时 VFX 取色 ⇄ 那两句「唯一合法」', () => {
  it('运行时总体就是这五颗（按身份钉，不数数量）', () => {
    expect(vfxEntries.map(([k]) => k).sort()).toEqual(['discordViolet', 'ember', 'parryWhite', 'silver', 'warmGold'])
    expect(vfxEntries.every(([, v]) => Number.isInteger(v) && v >= 0 && v <= 0xffffff), '每颗都得是 24 位颜色').toBe(true)
  })

  it('五颗逐颗分类，读数与本批登记的一致', () => {
    expect(vfxEntries.map(([k, v]) => `${k}:${classify(hex6(v)).tag}`).sort()).toEqual([
      'discordViolet:变体',
      'ember:§2逐字',
      'parryWhite:都不属',
      'silver:§7.1逐字',
      'warmGold:都不属',
    ])
  })

  it('「都不属」的两颗按身份钉死 = 今天的欠账名册；第三颗表外色进来就必须红', () => {
    const off = vfxEntries.filter(([k, v]) => classify(hex6(v)).tag === '都不属').map(([k]) => k).sort()
    expect(off, '欠账少了一颗 ⇒ 有人把颜色修回表内，那要连 §7.1 那两行矛盾一起重新对账；多了 ⇒ 又往 VFX 里丢了表外色').toEqual(['parryWhite', 'warmGold'])
    for (const k of off) {
      const c = classify(hex6(VFX_PALETTE[k as keyof typeof VFX_PALETTE]))
      expect(c.nearest, `${k} 这一格必须真读到一颗最近表色，否则"都不属"是空跑`).toMatch(/^#[0-9A-F]{6}$/)
      expect(Math.round(c.d.h), `${k} 离最近表色的色相差`).toBeGreaterThanOrEqual(11)
    }
  })

  it('ember 逐字在 §2 色板里（reach guard：名册若一条都不命中，上面"只有两颗不属"就是空话）', () => {
    expect(palette2.has(hex6(VFX_PALETTE.ember))).toBe(true)
    expect(hex6(VFX_PALETTE.ember)).toBe('#FFB86B')
  })

  it('silver 是"忠实照抄文档代表色、却落不进任何一行区间"那颗（§7.1 的矛盾已经进了运行时）', () => {
    const h = hsl(hex6(VFX_PALETTE.silver)).h
    const hit = rows71.filter((r) => r.bands.some((b) => inBand(h, b)))
    expect(hit.map((r) => r.semantic), `silver h=${h.toFixed(1)} 竟然落进了某行区间 ⇒ 有人改了区间，那条矛盾要重新裁决`).toEqual([])
    expect(swatch71.has(hex6(VFX_PALETTE.silver)), 'silver 也不再是任何一行的代表色 ⇒ 它被换掉了，本条要跟着改').toBe(true)
  })
})

describe('只量不裁：文档自己那两行矛盾 ＋ 那句 ≥90° 的适用范围', () => {
  const contradicted = rows71
    .filter((r) => r.bands.length && r.swatches.length)
    .filter((r) => !r.bands.some((b) => inBand(hsl(r.swatches[0]!).h, b)))

  it('代表色不在自己区间里的行 = 就这两行（钉的是读数，不是裁决：改区间或改代表色都必须让这里红）', () => {
    expect(contradicted.map((r) => r.semantic)).toEqual(['玩家攻击轨迹/战技', '玩家弹反/完美格挡'])
    const traj = contradicted[0]!
    const parry = contradicted[1]!
    expect(Math.round(hsl(traj.swatches[0]!).h - traj.bands[0]![0]), '#DDE6EA 距 200–220 下界差 2°').toBe(-2)
    expect(Math.round(hsl(parry.swatches[0]!).h - parry.bands[0]![0]), '#FFD98A 距 45–55 下界差 4°').toBe(-4)
  })

  it('≥90° 那句：文档命名的那对成立（164°），没命名的那对不成立（39°）——哪几对受这条约束文档没说 ⇒ 不裁', () => {
    const silver = hsl('#DDE6EA').h
    const telegraph = hsl('#A8322E').h
    const parry = hsl('#FFD98A').h
    expect(Math.round(hueDistance(silver, telegraph)), '「玩家冷银 vs 敌人暖红」文档明说是全局不变量').toBeGreaterThanOrEqual(90)
    expect(Math.round(hueDistance(parry, telegraph)), '弹反金白 vs 敌人暖红：文档把 ≥90° 写成"同屏敌我特效"，这一对就没过').toBeLessThan(90)
    expect(Math.round(hueDistance(silver, hsl(hex6(VFX_PALETTE.discordViolet)).h)), '运行时那一对（冷银 vs 失谐紫）的读数').toBe(76)
  })

  it('登记总体边界：§7.1 没点名任何载体（decal/trail/emitter 一次都没出现）⇒ 本批只判 VFX_PALETTE', () => {
    for (const word of ['decal', 'trail', 'emitter', '贴花', '拖尾', '发射器']) {
      expect(doc.toLowerCase(), `文档今天点名了「${word}」⇒ 载体名册可以立了，把这条改成按名册判定`).not.toContain(word)
    }
    expect(Object.keys(JSON.parse(readFileSync(root + 'src/data/json/vfx.json', 'utf8'))).sort()).toEqual(['decals', 'emitters', 'trails'])
  })

  it('总体边界的另一头：vfx.json 那 14 颗唯一色，没有一颗在文档全文出现过 ⇒ 它们今天不受任何读者判定', () => {
    const raw = readFileSync(root + 'src/data/json/vfx.json', 'utf8')
    const inJson = [...new Set([...raw.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toUpperCase()))]
    expect(inJson.length, 'vfx.json 的色数变了 ⇒ 这一格的分母要重新量，登记里那句「14 颗」也要跟着改').toBe(14)
    const onPaper = inJson.filter((hex) => doc.toUpperCase().includes(hex))
    expect(onPaper, '文档第一次点到 vfx.json 正在用的某颗色 ⇒ 那一句就是这一族的判据来源，这条要换成按那一句对账').toEqual([])
  })
})
