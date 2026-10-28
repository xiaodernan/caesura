/**
 * KI-339：progression.md §3「武器成长：伤害标尺矩阵」那张六列 × 七行的表第一次被当成字节读。
 *
 * **病是什么**：§3 是「每把武器吃什么属性、吃多少」的唯一人读表，而它此前**一格都没有机器读者**
 * （KI-328／KI-334 各自只顺带量了一行备注里的一个从句）。这一趟把整张表摆到数据旁边，量出五件事：
 *  ① **主标尺那一列 6/6 与数据同向**——六件武器的 `weapons.json.scaling` 里系数最大的那一维，
 *    逐把都对上文档写的「指法／基音／音色」（第七行没有对面，见③）。这是本批唯一一条**正向**读数。
 *  ② **百分比那一列一格都没落到运行时**——文档写了 7 个「%」数（E(0.5%/pt) 那一族），数据里有 14 格系数
 *    （`scaling` 的每一个键），两者**重叠 6 格、相同的 0 格**（0.5↔0.6、1.5↔0.9、2.6↔1.15、2.0↔0.85、
 *    2.3↔1.2、2.8↔1.5），另有 2 个文档数（调律剑/大剑的「音色 D(1.0%)」）在数据里连键都没有，
 *    而 9 格数据系数文档一个字没写。两边的比值没有常数（0.83／1.67／1.87／1.92／2.26／2.35），
 *    所以这不是单位换算，是**两张不同的表**。谁作数要设计给读数（本批只量不裁，§55）。
 *  ③ **音叉巨剑→续章那一行在数据里整行缺席**——六件武器全在表里，第七件连 `weapons.json` 的行都没有
 *    （KI-007 的 `unique` 回退组至今只服务它）。
 *  ④ **备注栏七格：1 格有承载体、1 格半格、5 格没有**——
 *    有：音叉杖「战技射程 +25%」（`skillRangeMul: 1.25`，消费点在弹体出海那一拍，KI-312）；
 *    半格：调律剑「均衡；弹反流底座」（`swingTag` 有 `parryable`，「均衡」是散文）；
 *    没有：大剑「双持需求：基音≥25」（`src/` 里连 `dualWield` 这个标识符都没有）、引针枪「背刺倍率
 *    +0.5%/10 点泛音」与无鸣「背刺倍率再 +泛音×0.1%」（背刺倍率只读 `swingTag` 的 `crit.backstab*` 定值，
 *    泛音一点也进不去）、弓「需 指法≥30」（门只有 rank12，指法 0 与 99 同一个读数，KI-328⑤）、
 *    巨剑「终局件：三系全能」（武器本身缺席）。
 *  ⑤ **progression.md §11 那一格落后于它自己的数据**：写着「弓/杖/无鸣三把武器本体仍未做（KI-007 族）」，
 *    而三件都在 `weapons.json` 与 `items.json`（`gear.weaponId`）里，六件武器**每一件都有可装备件**——
 *    这一格本批改成实情，并立一条腿把「武器 ⇄ 可装备件」的一对一钉住。
 *
 * **口径**：
 *  - **只量不裁**：文档的数字一格不改（那是设计读数），本门钉的是「今天两边各是什么」。
 *  - **两边都红**：文档改一个字、数据改一格系数，这张登记表就得跟着改——判据不猜意图。
 *  - **缺席要有探针**：「没有承载体」不是一句散文，是一条**今天真读不到**的腿（扫 `src/` 的标识符、
 *    跑一遍伤害管线、让指法在 0 与 99 之间跳）。反过来，谁把那一格做出来，腿会红着请他来登记。
 *  - **结构腿的必要性**：背刺那条的行为腿只证明「`DamagePipeline` 不吃泛音」；武器侧（`weaponBackstabMul`）
 *    另一条结构腿钉住它今天也只读标签定值——两格分开，才知道将来红的是哪一边。
 *
 * **还欠**（§78，如实登记）：
 *  - ① §3 与 §2.1「直剑/刺剑/枪/弓 +2.0%」、`weapons.json.scaling` 是**三个主人**；本批只把三者摆在一起
 *    （§2.1 那一格是散文，没有腿），谁作数要设计裁决；
 *  - ② 「混合(取最高维×0.7)」那个读法在 `attrScale` 里没有承载体（本门只证 `Math.max`／`0.7` 不在那里）；
 *  - ③ 音叉巨剑整件武器（数值、招式、掉落）都还欠；
 *  - ④ 备注栏那五格的**风味半句**（「隐藏天花板」「终局件」）不在机器读数的形状里。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { items, registerGameData, weaponsRaw } from '@/data'
import type { ItemData, WeaponData } from '@/data/schema'
import { resolveDamage } from '@/combat/DamagePipeline'
import { Progression } from '@/rpg/Progression'

registerGameData()

const root = fileURLToPath(new URL('../..', import.meta.url))
const DOC = readFileSync(join(root, 'docs/progression.md'), 'utf8')
const PIPELINE_SRC = readFileSync(join(root, 'src/combat/DamagePipeline.ts'), 'utf8')
const COMBAT_SRC = readFileSync(join(root, 'src/combat/CombatManager.ts'), 'utf8')

/** 认转义的竖线切分（与门 D 同一把尺子）：`\|` 是内容，不是分格 */
const cells = (l: string): string[] => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())

/** §3 那张表：表头 + 数据行（分隔行不算）。段落在第一张表之后断开。 */
function sec3(src: string): { head: string[]; rows: Array<{ n: number; cells: string[] }> } {
  const lines = src.split(/\r?\n/)
  const at = lines.findIndex((l) => /^## 3\. 武器成长/.test(l))
  if (at < 0) throw new Error('progression.md 里找不到 §3 的标题行')
  const block: Array<{ n: number; l: string }> = []
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith('|')) block.push({ n: i + 1, l: lines[i]! })
    else if (block.length) break
  }
  if (block.length < 3) throw new Error('§3 下面没有一张完整的表')
  return { head: cells(block[0]!.l), rows: block.slice(2).map((b) => ({ n: b.n, cells: cells(b.l) })) }
}

const S3 = sec3(DOC)
const at = (name: string) => {
  const r = S3.rows.find((x) => x.cells[0] === name)
  if (!r) throw new Error(`§3 里没有「${name}」那一行`)
  return r
}

/** 文档那一格里的百分比数（「E(0.5%/pt)」「D(1.0%)」都认；只有字母的格＝没写数） */
const pctOf = (cell: string): number | null => {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(cell)
  return m ? Number(m[1]) : null
}

const WEAPONS = weaponsRaw as unknown as WeaponData[]
const byId = new Map(WEAPONS.map((w) => [w.id, w]))

/** 文档那一列 ⇄ `scaling` 的键（§2.1 的六维命名） */
const COL_KEY = [
  ['基音', 'str'],
  ['指法', 'dex'],
  ['音色', 'ton'],
] as const
type Col = (typeof COL_KEY)[number][0]
type SkillCol = '基音' | '指法' | '音色'

/**
 * 七行的名册：名字是文档那一格的原字，id 是数据里那一行，`null` ＝ 数据里**没有对面**。
 * 加一行表、加一件武器，先来这里登记——这一张是判据的一部分，不是注释。
 */
const DOC_ROWS: Array<{ name: string; id: string | null; main: SkillCol | '混合'; remark: string; verdict: 'carried' | 'partial' | 'absent' }> = [
  { name: '调律剑', id: 'wp_tuning_sword', main: '指法', remark: '均衡；弹反流底座', verdict: 'partial' },
  { name: '强音大剑', id: 'wp_fortissimo_greatsword', main: '基音', remark: '双持需求：基音≥25', verdict: 'absent' },
  { name: '引针枪', id: 'wp_drawpin_spear', main: '指法', remark: '距离=泛音联动：背刺倍率 +0.5%/10 点泛音', verdict: 'absent' },
  { name: '泛音弓', id: 'wp_overtone_bow', main: '指法', remark: '满弓分叉枝数 2→3 需 指法≥30', verdict: 'absent' },
  { name: '律具·音叉杖', id: 'wp_tuningfork_staff', main: '音色', remark: '战技射程 +25%（combat.md §4.5）', verdict: 'carried' },
  { name: '无鸣', id: 'wp_needlesilence', main: '指法', remark: '背刺倍率再 +泛音×0.1%（隐藏天花板）', verdict: 'absent' },
  { name: '音叉巨剑→续章', id: null, main: '混合', remark: '终局件：三系全能', verdict: 'absent' },
]

/** 取 `anchor` 之后第一对花括号里的正文（结构腿用；找不到/没闭合就炸，不静默返回空串） */
function bracedBody(src: string, anchor: string): string {
  const at0 = src.indexOf(anchor)
  if (at0 < 0) throw new Error(`源文件里找不到「${anchor}」`)
  const open = src.indexOf('{', at0)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`「${anchor}」的花括号没有闭合`)
}

/** `src/` 下全部 .ts 的相对路径（扫标识符用；不算 .json——数据里写一个名字不算承载体） */
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) tsFiles(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

/**
 * 背刺那一格的行为读数：泛音从 0 跳到 80，成交伤害一分不动。
 * `critRate: 0` 是**有意**的——暴击那一支本来就吃泛音（§2.1），这里问的是「背刺这一格」本身。
 */
const backstabHit = (ovr: number, mul: number): number =>
  resolveDamage(
    { base: 100, attrs: { ovr }, scaling: {}, defense: 0, variance: 0, backstab: true, backstabMul: mul, critRate: 0 },
    () => 0,
  ).damage

describe('KI-339：progression.md §3 那张武器表的逐格读数', () => {
  it('表仍是 6 列 7 行，七个名字与登记表逐字一致', () => {
    expect(S3.head).toEqual(['武器', '基音', '指法', '音色', '主标尺', '备注'])
    expect(S3.rows).toHaveLength(DOC_ROWS.length)
    for (const r of S3.rows) expect(r.cells, `第 ${r.n} 行的格数`).toHaveLength(6)
    expect(S3.rows.map((r) => r.cells[0])).toEqual(DOC_ROWS.map((r) => r.name))
  })

  it('主标尺那 6 格与数据里系数最大的那一维同向（第七行没有对面）', () => {
    for (const row of DOC_ROWS) {
      const cell = at(row.name).cells[4]!
      expect(cell.split('(')[0], `${row.name} 的主标尺`).toBe(row.main)
      if (!row.id) continue
      const w = byId.get(row.id)!
      const top = Object.entries(w.scaling).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]![0]
      expect(top, `${row.name} 数据里最大的那一维`).toBe(COL_KEY.find(([c]) => c === row.main)![1])
    }
    // 第七行那个「混合」读法本身没有承载体：文档写的是「取最高维×0.7」
    expect(at('音叉巨剑→续章').cells[4]).toBe('混合(取最高维×0.7)')
  })

  it('百分比那一列：文档 7 个数 ⇄ 数据 14 格系数，重叠 6 格、相同的 0 格', () => {
    const measured: Array<[string, Col, number | null, number | null]> = []
    for (const row of DOC_ROWS) {
      const c = at(row.name).cells
      COL_KEY.forEach(([col, key], i) => {
        const doc = pctOf(c[1 + i]!)
        const data = row.id ? (byId.get(row.id)!.scaling[key] ?? null) : null
        measured.push([row.name, col, doc, data])
      })
    }
    // 这一张是今天的实况（只量不裁）：两边任何一格动了，都要回来重新登记
    expect(measured).toEqual([
      ['调律剑', '基音', 0.5, 0.6],
      ['调律剑', '指法', 1.5, 0.9],
      ['调律剑', '音色', 1.0, null],
      ['强音大剑', '基音', 2.6, 1.15],
      ['强音大剑', '指法', null, 0.25],
      ['强音大剑', '音色', null, null],
      ['引针枪', '基音', null, 0.7],
      ['引针枪', '指法', 2.0, 0.85],
      ['引针枪', '音色', null, null],
      ['泛音弓', '基音', null, 0.5],
      ['泛音弓', '指法', 2.3, 1.2],
      ['泛音弓', '音色', null, 0.2],
      ['律具·音叉杖', '基音', null, 0.25],
      ['律具·音叉杖', '指法', null, 0.6],
      ['律具·音叉杖', '音色', 2.8, 1.5],
      ['无鸣', '基音', null, 0.3],
      ['无鸣', '指法', null, 1.2],
      ['无鸣', '音色', null, null],
      ['音叉巨剑→续章', '基音', null, null],
      ['音叉巨剑→续章', '指法', null, null],
      ['音叉巨剑→续章', '音色', null, null],
    ])
    const docNumbers = measured.filter((m) => m[2] !== null)
    const dataCells = measured.filter((m) => m[3] !== null)
    const both = measured.filter((m) => m[2] !== null && m[3] !== null)
    expect(docNumbers).toHaveLength(7)
    expect(dataCells).toHaveLength(14)
    expect(both).toHaveLength(6)
    expect(both.filter((m) => m[2] === m[3])).toEqual([])
    // 比值不是常数 ⇒ 不是单位换算，是两张表（量出来给设计看，本门不裁）
    expect(both.map((m) => Math.round((m[2]! / m[3]!) * 100) / 100)).toEqual([0.83, 1.67, 2.26, 2.35, 1.92, 1.87])
  })

  it('音叉巨剑→续章：七行里唯一在 weapons.json 没有对面的那一行', () => {
    expect(WEAPONS).toHaveLength(6)
    expect(WEAPONS.map((w) => w.id).filter((id) => /giant|sequence|final/i.test(id))).toEqual([])
    expect(byId.has('wp_tuningfork_staff')).toBe(true) // 不是把「音叉」整族都没做，缺的只是巨剑
  })

  it('「混合(取最高维×0.7)」那个读法在 attrScale 里没有承载体', () => {
    const body = bracedBody(PIPELINE_SRC, 'export function attrScale(')
    expect(body).not.toMatch(/Math\.max/)
    expect(body).not.toMatch(/0\.7/)
    expect(body).toMatch(/sum \/ 100/) // 今天只有「系数逐项相乘再相加」这一种读法
  })

  it('备注栏七格逐字与读数登记表一致（1 carried / 1 partial / 5 absent）', () => {
    expect(S3.rows.map((r) => r.cells[5])).toEqual(DOC_ROWS.map((r) => r.remark))
    expect(DOC_ROWS.map((r) => r.verdict)).toEqual(['partial', 'absent', 'absent', 'absent', 'carried', 'absent', 'absent'])
  })

  it('唯一有承载体的一格：音叉杖「战技射程 +25%」＝数据里的 1.25，且消费点仍在弹体出海那一拍', () => {
    const pct = pctOf(at('律具·音叉杖').cells[5]!)
    expect(pct).toBe(25)
    expect(byId.get('wp_tuningfork_staff')!.skillRangeMul).toBeCloseTo(1 + pct! / 100, 10)
    expect(COMBAT_SRC).toMatch(/spec\.range \* \(a\.skill \|\| a\.key === 'charged' \? \(p\.weapon\.skillRangeMul \?\? 1\) : 1\)/)
  })

  it('半格：调律剑「弹反流底座」那半有承载体（swingTag 的 parryable），「均衡」是散文', () => {
    expect(byId.get('wp_tuning_sword')!.swingTag).toContain('parryable')
  })

  it('强音大剑「双持需求：基音≥25」：src 里连这个概念都没有（谁做了谁就得来登记）', () => {
    const hits = tsFiles(join(root, 'src')).filter((f) => /dualWield|dualHanded|offhand/i.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })

  it('引针枪／无鸣那两条「+泛音」：泛音不进背刺那一格（行为腿 ＋ 武器侧结构腿）', () => {
    expect(backstabHit(0, 2)).toBe(backstabHit(80, 2)) // 2.0 那一族（剑/大剑/枪）
    expect(backstabHit(0, 3.5)).toBe(backstabHit(80, 3.5)) // 无鸣的 3.5
    const body = bracedBody(COMBAT_SRC, 'private weaponBackstabMul(')
    expect(body).not.toMatch(/ovr|overtone|attrs/)
    expect(body).toMatch(/crit\.backstab/) // 主人只有标签那一格
  })

  it('泛音弓「需 指法≥30」：门只有 rank12，指法 0 与 99 是同一个读数', () => {
    const p = new Progression()
    p.rank = 11
    const rank11 = p.derive().bowForkBranches
    p.rank = 12
    p.attrs = { ...p.attrs, dex: 0 }
    const zero = p.derive().bowForkBranches
    p.attrs = { ...p.attrs, dex: 99 }
    const max = p.derive().bowForkBranches
    expect([rank11, zero, max]).toEqual([0, 1, 1])
  })

  it('六件武器每一件都有可装备件（§11 那句「弓/杖/无鸣三把本体仍未做」的反面有机器读者）', () => {
    const held = new Map<string, string>()
    for (const item of items as unknown as ItemData[]) {
      const gear = (item as { gear?: { slot?: string; weaponId?: string } }).gear
      if (gear?.weaponId) held.set(gear.weaponId, gear.slot ?? '')
    }
    expect([...held.keys()].sort()).toEqual(WEAPONS.map((w) => w.id).sort())
    for (const slot of held.values()) expect(slot).toBe('weapon')
  })
})
