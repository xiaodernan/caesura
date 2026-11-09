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
 * **KI-424（2026-11-09）：备注栏那一列第一次有了「子句」这一层**——见下面 `Clause` 那段注释。
 * 一格备注里住着**两样东西**（一条机制承诺 ＋ 半句风味），整格一个判决会把它们混成一句：
 * 「均衡；弹反流底座」＝散文＋机制；「背刺倍率再 +泛音×0.1%（隐藏天花板）」＝机制＋风味；
 * 「满弓分叉枝数 2→3 需 指法≥30」＝**今天真的兑现了的那一半 ＋ 没有兑现的那一半**。
 * 拆开之后：风味半句第一次在机器读数里有了自己的格子，而**兑现了一半的那一格不再被算成「没有」**。
 * 拆开带来的唯一口径变化：**格级判决从「1 carried / 1 partial / 5 absent」变成「1 carried / 2 partial / 4 absent」**
 * （无鸣那一格从 absent 升成 partial——它的背刺倍率 3.5 确实比别家高，缺的是「随泛音长」那一半）。
 *
 * **还欠**（§78，如实登记）：
 *  - ① §3 与 §2.1「直剑/刺剑/枪/弓 +2.0%」、`weapons.json.scaling` 是**三个主人**；本批只把三者摆在一起
 *    （§2.1 那一格是散文，没有腿），谁作数要设计裁决；
 *  - ② 「混合(取最高维×0.7)」那个读法在 `attrScale` 里没有承载体（本门只证 `Math.max`／`0.7` 不在那里）；
 *  - ③ 音叉巨剑整件武器（数值、招式、掉落）都还欠；
 *  - ④ 备注栏那五格的**风味半句**（「隐藏天花板」「终局件」）不在机器读数的形状里 —— **KI-424 已销这一格**：
 *    子句名册把七格拆成 12 条（机械 9／风味 3），风味子句有自己的判决（`flavor`）且**不许带探针**。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { items, movesetsRaw, progressionRaw, registerGameData, weaponsRaw } from '@/data'
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

/** 招式表与里程碑表（只取子句探针要读的那几格；结构自己收窄，不引第二份名册） */
const MOVESETS = movesetsRaw as unknown as Array<{
  id: string
  actions: Record<string, { projectile?: { burst?: { count?: number } } }>
}>
const MILESTONES = (progressionRaw as unknown as {
  milestones: Array<{ rank: number; id: string; grant?: { bowForkBranches?: number } }>
}).milestones

/** 文档那一列 ⇄ `scaling` 的键（§2.1 的六维命名） */
const COL_KEY = [
  ['基音', 'str'],
  ['指法', 'dex'],
  ['音色', 'ton'],
] as const
type Col = (typeof COL_KEY)[number][0]
type SkillCol = '基音' | '指法' | '音色'

/**
 * 一条**子句**的形状（KI-424，2026-11-09）。
 *
 * **为什么要有子句**：一格备注里住着**两样东西**——一条机制承诺与半句风味
 * （「均衡；弹反流底座」＝散文＋机制；「背刺倍率再 +泛音×0.1%（隐藏天花板）」＝机制＋风味）。
 * 整格一个判决 ⇒ 风味半句不在机器读数的形状里（KI-339 还欠④），而且**兑现了一半会被混成「没有」**
 * （弓那一格的「满弓分叉枝数 2→3」今天真的兑现了，「需 指法≥30」才没有）。
 *
 * **判决由探针独立量出来**：`probe` 返回的就是这一条今天的判决，名册里的 `verdict` 只登记
 * 「今天探针读数是什么」⇒ 谁把判决改坏而探针没改，那一格当场红；谁把探针改坏而没改判决，也是红。
 * 风味子句**不许**带探针（带了就说明它其实是一条承诺，只是躲成了风味）。
 *
 * **三档的分工**（`probe` 的返回值就是这一条今天的读数）：
 *  - `carried`：这一整条兑现了；
 *  - `partial`：**一半兑现了**——底座在、增量不在（「背刺倍率 3.5 在，随泛音长不在」）；
 *  - `absent`：一条都没兑现。
 */
type ClauseKind = 'flavor' | 'mechanical'
type ClauseVerdict = 'carried' | 'partial' | 'absent' | 'flavor'
/** 探针能返回的那三档（风味那一档探针量不出来，也不许量） */
type ProbeVerdict = 'carried' | 'partial' | 'absent'
interface Clause {
  /** 子句逐字（必须逐字出现在文档那一格里，且按顺序出现） */
  text: string
  kind: ClauseKind
  /** 今天这一条的判决（＝探针的读数；风味子句恒为 `flavor`） */
  verdict: ClauseVerdict
  /** 承载体符号（carried／partial 必填）：它得在 `src/` 的**≥2 个文件**里出现（声明处＋读者处） */
  carrier?: string
  /** 没兑现那一半的债主号（absent／partial 必填）：正册里那一行得点名 `ref` */
  debtOwner?: string
  /** 债主那一行必须点名的标志串（absent／partial 必填） */
  ref?: string
  /** 探针：今天真的量得到的那件事 ⇒ 返回这一条今天的判决 */
  probe?: () => ProbeVerdict
}

/**
 * 七行的名册：名字是文档那一格的原字，id 是数据里那一行，`null` ＝ 数据里**没有对面**。
 * 加一行表、加一件武器，先来这里登记——这一张是判据的一部分，不是注释。
 *
 * **子句那一层（KI-424）**：每一格拆成若干条，每条各有各的判决与探针。
 * **整格判决不再是手填的**：它由子句里最差的那一档推出来（门里那一条腿钉住这件事）⇒ 两个粒度不会分家。
 *
 * **探针的写法纪律**：探针量的是**今天真读得到的那件事**，不是「我以为它兑现了」——
 * 所以「有没有」要么扫 `src/` 的真实字节，要么跑一次真实行为（泛音 0 与 80 的成交伤害、
 * 指法 0 与 99 的枝数、rank12 的授与与消费点），没有第三条路。
 */
const DOC_ROWS: Array<{ name: string; id: string | null; main: SkillCol | '混合'; remark: string; verdict: 'carried' | 'partial' | 'absent'; clauses: Clause[] }> = [
  {
    name: '调律剑', id: 'wp_tuning_sword', main: '指法', remark: '均衡；弹反流底座', verdict: 'partial',
    clauses: [
      { text: '均衡', kind: 'flavor', verdict: 'flavor' },
      {
        // 「弹反」那一半兑现了（这把剑 `parryable`，而弹反机制本身是全仓最老的那套）；
        // 「流」那一半**连定义都没有**——「弹反流」这个词全仓只出现一次（docs/progression.md:95），
        // 没有任何一份文档定义它 ⇒ 量不出来 ⇒ 只能记 partial，并把「缺定义」记成一笔账（KI-428）。
        text: '弹反流底座', kind: 'mechanical', verdict: 'partial', carrier: 'parry',
        debtOwner: 'KI-428', ref: '弹反流',
        probe: () => {
          const base = byId.get('wp_tuning_sword')!.swingTag.includes('parryable')
          const flow = srcCodeLines().some((l) => /parryFlow|parry_flow|parryChain|parryStreak/i.test(l))
          return base && flow ? 'carried' : base ? 'partial' : 'absent'
        },
      },
    ],
  },
  {
    name: '强音大剑', id: 'wp_fortissimo_greatsword', main: '基音', remark: '双持需求：基音≥25', verdict: 'absent',
    clauses: [
      {
        // 底座（双持这个概念）在 src/ 里一个字都没有 ⇒ 一条都没兑现。
        text: '双持需求：基音≥25', kind: 'mechanical', verdict: 'absent',
        debtOwner: 'KI-425', ref: '双持需求',
        probe: () => {
          const shape = srcCodeLines().filter((l) => /dualWield|dualHanded|offhand/i.test(l))
          if (!shape.length) return 'absent'
          const gated = shape.some((l) => /\bstr\b|基音/i.test(l))
          return gated ? 'carried' : 'partial'
        },
      },
    ],
  },
  {
    name: '引针枪', id: 'wp_drawpin_spear', main: '指法', remark: '距离=泛音联动：背刺倍率 +0.5%/10 点泛音', verdict: 'absent',
    clauses: [
      {
        // 「距离=泛音联动」：射程随泛音变 —— src/ 里没有一行同时写着射程与泛音（剥掉注释行之后仍是 0 行）。
        text: '距离=泛音联动', kind: 'mechanical', verdict: 'absent',
        debtOwner: 'KI-426', ref: '距离=泛音联动',
        probe: () => {
          const link = srcCodeLines().some((l) => /range/i.test(l) && /\b(ovr|overtone)\b/i.test(l))
          return link ? 'carried' : 'absent'
        },
      },
      {
        // 「背刺倍率 +0.5%/10 点泛音」：底座在（枪的 swingTag 里有 crit.backstab2.0），
        // 增量不在（weaponBackstabMul 的函数体里没有 ovr／attrs，行为腿实测泛音 0→80 成交伤害不动）⇒ partial。
        text: '背刺倍率 +0.5%/10 点泛音', kind: 'mechanical', verdict: 'partial', carrier: 'crit.backstab',
        debtOwner: 'KI-426', ref: '+0.5%/10 点泛音',
        probe: () => {
          const body = bracedBody(COMBAT_SRC, 'private weaponBackstabMul(')
          const depends = /ovr|overtone|attrs/i.test(body)
          const base = byId.get('wp_drawpin_spear')!.swingTag.some((t) => t.startsWith('crit.backstab'))
          if (!base) return 'absent'
          if (!depends) return 'partial'
          return backstabHit(0, 2) !== backstabHit(80, 2) ? 'carried' : 'partial'
        },
      },
    ],
  },
  {
    name: '泛音弓', id: 'wp_overtone_bow', main: '指法', remark: '满弓分叉枝数 2→3 需 指法≥30', verdict: 'absent',
    clauses: [
      {
        // 底数 2 枝住在 `ms_bow.charged.projectile.burst.count`（含主箭 3 发 ⇒ 枝数 2），
        // rank12 的 ms_bow_split 授与 +1 枝，消费点在 CombatManager.launchPlayerProjectile ⇒ 2→3 兑现。
        text: '满弓分叉枝数 2→3', kind: 'mechanical', verdict: 'carried', carrier: 'bowForkBranches',
        probe: () => {
          const burst = MOVESETS.find((m) => m.id === 'ms_bow')?.actions?.charged?.projectile?.burst
          const base = typeof burst?.count === 'number' ? burst.count - 1 : 0
          const grant = MILESTONES.find((m) => m.rank === 12)?.grant?.bowForkBranches ?? 0
          const wired = /spec\.burst\.count \+ this\.player\.rpg\.bowForkBranches/.test(COMBAT_SRC)
          if (base !== 2) return 'absent'
          if (grant === 1 && wired) return 'carried'
          return grant === 1 ? 'partial' : 'absent'
        },
      },
      {
        // 「需 指法≥30」：门只有 rank12 —— 指法 0 与 99 是同一个读数 ⇒ 一条都没兑现。
        text: '需 指法≥30', kind: 'mechanical', verdict: 'absent',
        debtOwner: 'KI-328', ref: '需 指法≥30',
        probe: () => {
          const p = new Progression()
          p.rank = 12
          p.attrs = { ...p.attrs, dex: 0 }
          const zero = p.derive().bowForkBranches
          p.attrs = { ...p.attrs, dex: 99 }
          return p.derive().bowForkBranches !== zero ? 'carried' : 'absent'
        },
      },
    ],
  },
  {
    name: '律具·音叉杖', id: 'wp_tuningfork_staff', main: '音色', remark: '战技射程 +25%（combat.md §4.5）', verdict: 'carried',
    clauses: [
      {
        // 杖那一格是七格里唯一整条兑现的：数据里的 1.25 ＋ 消费点（弹体出海那一拍）。
        text: '战技射程 +25%（combat.md §4.5）', kind: 'mechanical', verdict: 'carried', carrier: 'skillRangeMul',
        probe: () => {
          const mul = byId.get('wp_tuningfork_staff')!.skillRangeMul
          if (mul === undefined) return 'absent'
          return COMBAT_SRC.includes('skillRangeMul ?? 1') ? 'carried' : 'partial'
        },
      },
    ],
  },
  {
    name: '无鸣', id: 'wp_needlesilence', main: '指法', remark: '背刺倍率再 +泛音×0.1%（隐藏天花板）', verdict: 'partial',
    clauses: [
      {
        // 底座在（无鸣的 crit.backstab3.5 确实比别家的 2.0 高），增量不在（3.5 是写死的定值）⇒ partial。
        text: '背刺倍率再 +泛音×0.1%', kind: 'mechanical', verdict: 'partial', carrier: 'crit.backstab',
        debtOwner: 'KI-427', ref: '+泛音×0.1%',
        probe: () => {
          const tag = byId.get('wp_needlesilence')!.swingTag.find((t) => t.startsWith('crit.backstab'))
          if (!tag) return 'absent'
          const base = Number.parseFloat(tag.slice('crit.backstab'.length))
          if (!Number.isFinite(base)) return 'absent'
          return backstabHit(0, base) !== backstabHit(80, base) ? 'carried' : 'partial'
        },
      },
      // 「隐藏天花板」＝风味半句：它不是一条数值承诺，是对**天花板存在**的承诺。
      // 它不许带探针——带了才说明它其实是一条机制承诺躲成了风味。
      { text: '隐藏天花板', kind: 'flavor', verdict: 'flavor' },
    ],
  },
  {
    name: '音叉巨剑→续章', id: null, main: '混合', remark: '终局件：三系全能', verdict: 'absent',
    clauses: [
      { text: '终局件', kind: 'flavor', verdict: 'flavor' },
      {
        // 「三系全能」：那件武器在 weapons.json 里整行缺席 ⇒ 一条都没兑现。
        text: '三系全能', kind: 'mechanical', verdict: 'absent',
        debtOwner: 'KI-339', ref: '音叉巨剑',
        probe: () => (WEAPONS.some((w) => /giant|sequence|final/i.test(w.id)) ? 'carried' : 'absent'),
      },
    ],
  },
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
 * `src/` 下的**代码行**（注释行剥掉）。
 *
 * **为什么剥注释**：一句「射程随泛音变」的注释不该算承载体——文档里有承诺，
 * 代码注释里有许诺，只有真代码才算兑现。这条纪律是 KI-424 的探针能站住的前提。
 */
function srcCodeLines(): string[] {
  const out: string[] = []
  for (const f of tsFiles(join(root, 'src'))) {
    for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const s = l.trim()
      if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) continue
      out.push(l)
    }
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

  it('备注栏七格逐字与读数登记表一致（格级判决 1 carried / 2 partial / 4 absent；格级由子句最差的一档推出）', () => {
    expect(S3.rows.map((r) => r.cells[5])).toEqual(DOC_ROWS.map((r) => r.remark))
    expect(DOC_ROWS.map((r) => r.verdict)).toEqual(['partial', 'absent', 'absent', 'absent', 'carried', 'partial', 'absent'])
  })

  // ── KI-424：子句那一层 ────────────────────────────────────────────────
  it('子句拆分是穷尽的、有序的，间隙只许是分隔符（没有漏字，也没有多字）', () => {
    const SEP = /^[\s；;：:,，、（）()]*$/
    for (const row of DOC_ROWS) {
      const cell = at(row.name).cells[5]!
      let cursor = 0
      for (const c of row.clauses) {
        const i = cell.indexOf(c.text, cursor)
        expect(i, `${row.name} 的子句「${c.text}」必须逐字出现在备注格里`).toBeGreaterThanOrEqual(0)
        expect(cell.slice(cursor, i), `${row.name} 在「${c.text}」之前的间隙只许是分隔符`).toMatch(SEP)
        cursor = i + c.text.length
      }
      expect(cell.slice(cursor), `${row.name} 的尾巴只许是分隔符`).toMatch(SEP)
    }
  })

  it('风味子句不许带探针（带了就说明它其实是一条承诺，只是躲成了风味）；机械子句必须带探针', () => {
    for (const row of DOC_ROWS) {
      for (const c of row.clauses) {
        if (c.kind === 'flavor') {
          expect(c.probe, `${row.name}「${c.text}」是风味，不许带探针`).toBeUndefined()
          expect(c.verdict, `${row.name}「${c.text}」`).toBe('flavor')
        } else {
          expect(typeof c.probe, `${row.name}「${c.text}」是机械承诺，必须带探针`).toBe('function')
        }
      }
    }
  })

  it('每条机械子句的判决就是它的探针今天的读数（名册登记读数，不登记意图）', () => {
    for (const row of DOC_ROWS) {
      for (const c of row.clauses) {
        if (!c.probe) continue
        expect(c.probe(), `${row.name}「${c.text}」的探针读数`).toBe(c.verdict)
      }
    }
  })

  it('整格判决由子句里最差的那一档推出来（两个粒度不会分家）', () => {
    const RANK: Record<ClauseVerdict, number> = { flavor: 0, carried: 1, partial: 2, absent: 3 }
    for (const row of DOC_ROWS) {
      const worst = row.clauses.reduce<ClauseVerdict>(
        (a, b) => (RANK[b.verdict] > RANK[a] ? b.verdict : a),
        'flavor',
      )
      expect(row.verdict, `${row.name} 的格级判决`).toBe(worst)
    }
  })

  it('承载体符号在 src/ 的 ≥2 个文件里出现（声明处＋读者处，少于两处就只是一句自说自话）', () => {
    for (const row of DOC_ROWS) {
      for (const c of row.clauses) {
        if (c.verdict !== 'carried' && c.verdict !== 'partial') continue
        expect(c.carrier, `${row.name}「${c.text}」必须点名它的承载体`).toBeTruthy()
        const n = tsFiles(join(root, 'src')).filter((f) => readFileSync(f, 'utf8').includes(c.carrier!)).length
        expect(n, `${row.name}「${c.text}」的承载体 ${c.carrier}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('每条没兑现的子句都挂着一笔真账：那一行存在、点名了 ref、且状态还没结', () => {
    const ledger = readFileSync(join(root, 'docs/KNOWN_ISSUES.md'), 'utf8').split(/\r?\n/)
    for (const row of DOC_ROWS) {
      for (const c of row.clauses) {
        if (c.verdict === 'carried' || c.verdict === 'flavor') continue
        const owner = c.debtOwner
        expect(owner, `${row.name}「${c.text}」没兑现 ⇒ 必须挂一笔账`).toBeTruthy()
        const line = ledger.find((l) => l.startsWith(`| ${owner} |`))
        expect(line, `账本正册里没有 ${owner} 那一行`).toBeTruthy()
        expect(line!, `债主 ${owner} 那一行必须点名「${c.ref}」`).toContain(c.ref!)
        const m = /\|\s*(Implemented|Partial|Placeholder|Blocked)\s*\|\s*$/.exec(line!)
        expect(m, `债主 ${owner} 的状态词`).toBeTruthy()
        expect(m![1], `债主 ${owner} 已经结案 ⇒ 这条子句不该还挂在 ${c.verdict} 上`).not.toBe('Implemented')
      }
    }
  })

  it('子句名册的总账：七格 → 12 条（机械 9／风味 3）；判决 2 carried / 3 partial / 4 absent / 3 flavor', () => {
    const all = DOC_ROWS.flatMap((r) => r.clauses)
    expect(all).toHaveLength(12)
    expect(all.filter((c) => c.kind === 'mechanical')).toHaveLength(9)
    expect(all.filter((c) => c.kind === 'flavor')).toHaveLength(3)
    const tally = (v: ClauseVerdict) => all.filter((c) => c.verdict === v).length
    expect([tally('carried'), tally('partial'), tally('absent'), tally('flavor')]).toEqual([2, 3, 4, 3])
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
