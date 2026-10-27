import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ID_DIGITS,
  LEDGER_PREFIXES,
  RETIRED_SPELLINGS,
  duplicateIdFindings,
  ledgerRows,
  parseIdRule,
  retiredRegisterFindings,
  retiredSpellingFindings,
  ruleSentenceFindings,
  seedPointerFindings,
  seedRows,
} from '../../scripts/id-rules.mjs'

/**
 * 「号段只有一套」那道门（KI-326）。
 *
 * **病**：架构 §8.2 那条规则句写着「前缀 + **4** 位序号（例 …）」，而正册 `docs/KNOWN_ISSUES.md` 实测
 * **249 行 KI 全是 3 位**（首格 4 位的＝0 行）、TD/ENV 也是 3 位；PF 与 MA 两个前缀**在正册从来没有行**
 * （§3 那张表今天只有一行「暂无」，§4 用的是 ENV- 不是 MA-）。全库 4 位拼写实测 **14 处**
 * （3 份文件的 8 行上）。门 B 此前用「4 位归一成 3 位再判能不能读到行」把这件事绕开了——
 * **归一不是裁决**：它替写错的人把号擦掉，于是"两套号"这件事在机器眼里根本不存在。
 *
 * **这道门判三件事**（每件都能被合成夹具喂）：
 *   ① 规则句 ↔ 正册实况同形（前缀集合逐字相等、位数相等、规则句举的例子必须是真的一个号）；
 *   ② §8.3 的指针表 ↔ 正册行（每个号在正册**恰好一行**）；
 *   ③ 全库只许一套号（4 位拼写只许出现在 `scripts/id-rules.mjs` 的「已退役拼写名册」里）。
 *
 * **两条量具纪律**（本仓的老教训）：
 *   - **分母出自同一次扫描**：扫描面塌了、规则句读空了、§8.3 整块没了 ⇒ 红在地板上，不白送一条"0 条命中"的绿；
 *   - **这台门自己不许出现旧拼写**：它扫 `tests/`，所以夹具里的 4 位拼写是**拼出来的**（见 `oldSpell`），
 *     否则门先红在自己身上——那种红没有信息量，还会让"红"这件事变得不值钱。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const archDoc = readFileSync(root + 'docs/technical-architecture.md', 'utf8')
const issues = readFileSync(root + 'docs/KNOWN_ISSUES.md', 'utf8')

/** 名册所在那份文件的相对路径（旧拼写唯一的家；这台门不扫自己那份的"例外"） */
const REGISTER_FILE = 'scripts/id-rules.mjs'

/**
 * 旧拼写是**拼出来**的：这台门扫 `tests/`，而那种 4 位的字面形状一旦落在本文件里，
 * 门会先红在自己身上（红得没有信息量，还会让"红"这件事变得不值钱）。拆开拼，文件里就没有那个 token。
 */
const oldSpell = (prefix: string, digits: string): string => `${prefix}-${digits}`

/** 假号同理：门 B 判「按号引用必须读得到行」，门 I2 判「TD-/PF-/ENV- 的按号引用必须读得到行」⇒ 夹具里那个不存在的号也得拼出来 */
const fakeId = (prefix: string, digits: string): string => `${prefix}-${digits}`
const fakeKi = (digits: string): string => fakeId('KI', digits)

/** 合成一份架构文档：§8.2 的规则句 ＋ §8.3 的指针表（形状与真文件同构） */
const archFixture = (opts: { rule?: string | null; seeds?: string[] } = {}): string => {
  const rule = opts.rule === undefined
    ? 'ID 规则：KI-/TD-/PF-/ENV- 前缀 + 3 位序号（例 KI-001）。'
    : opts.rule
  const seeds = opts.seeds ?? ['KI-001', 'TD-010', 'TD-011', 'ENV-002', 'PF-001']
  return [
    '### 8.2 条目格式约定（四表各自的列）',
    '```',
    rule,
    '```',
    '',
    '### 8.3 首批已知的种子条目与它们今天的家',
    '| 今天的号 | 立项时的内容 |',
    '|---|---|',
    ...seeds.map((s) => `| ${s} | 一颗种子 |`),
    '',
  ].join('\n')
}

/** 合成一份正册（形状与真文件同构：一行一个号） */
const ledgerFixture = (lines: string[]): string => ['# KNOWN_ISSUES', '', ...lines, ''].join('\n')

/** 一份"对得上"的正册：四张表各一行 */
const GOOD_LEDGER = ledgerFixture([
  '| KI-001 | 某事 | P3 | Blocked |',
  '| TD-010 | 某债 | 某点 |',
  '| PF-001 | 某性能项 | — |',
  '| ENV-002 | 某限制 | 某替代 | 某路径 |',
])

describe('号段只有一套（KI-326）：合成夹具腿', () => {
  it('规则句读不出来 ⇒ 红在出处上（不猜：读不到就是读不到）', () => {
    const findings = ruleSentenceFindings({ archText: archFixture({ rule: null }), ledgerText: GOOD_LEDGER })
    expect(findings.length, '规则句被整句删掉，这道门却什么都没报').toBeGreaterThanOrEqual(1)
    expect(findings[0]!.msg).toContain('读不出来')
  })

  it('规则句多喊一个前缀 ⇒ 红（那个前缀在正册一行都没有）', () => {
    const rule = 'ID 规则：KI-/TD-/PF-/ENV-/XX- 前缀 + 3 位序号（例 KI-001）。'
    const findings = ruleSentenceFindings({ archText: archFixture({ rule }), ledgerText: GOOD_LEDGER })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('前缀')
  })

  it('规则句少喊一个前缀 ⇒ 红（正册在用的那个前缀在规则句里没有出处）', () => {
    const rule = 'ID 规则：KI-/TD-/ENV- 前缀 + 3 位序号（例 KI-001）。'
    const findings = ruleSentenceFindings({ archText: archFixture({ rule }), ledgerText: GOOD_LEDGER })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('前缀')
  })

  it('规则句的位数与正册实况不符 ⇒ 红', () => {
    const rule = 'ID 规则：KI-/TD-/PF-/ENV- 前缀 + 4 位序号（例 KI-001）。'
    const findings = ruleSentenceFindings({ archText: archFixture({ rule }), ledgerText: GOOD_LEDGER })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('位')
  })

  it('规则句举的例子在正册里没有 ⇒ 红（读者按它去找账，找到的是空气）', () => {
    const rule = `ID 规则：KI-/TD-/PF-/ENV- 前缀 + 3 位序号（例 ${fakeKi('777')}）。`
    const findings = ruleSentenceFindings({ archText: archFixture({ rule }), ledgerText: GOOD_LEDGER })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('例子')
  })

  it('规则句与正册同形 ⇒ 0 条（负例：这一族判据不许见红就红）', () => {
    const findings = ruleSentenceFindings({ archText: archFixture(), ledgerText: GOOD_LEDGER })
    expect(findings.map((f) => f.msg).join('\n')).toBe('')
  })

  it('§8.3 指的号在正册没有那一行 ⇒ 红', () => {
    // 那个"正册没有的号"是拼出来的：门 I2（按号引用必须读得到行）也扫 tests/，
    // 字面量落在本文件里会让**另一道门**先红在自己身上（红得没有信息量）。
    const ghost = fakeId('PF', '009')
    const arch = archFixture({ seeds: ['KI-001', 'TD-010', 'TD-011', 'ENV-002', ghost] })
    const findings = seedPointerFindings({ archText: arch, ledgerText: GOOD_LEDGER })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain(ghost)
  })

  it('§8.3 指的号在正册挂了两行 ⇒ 红（一个号两件事）', () => {
    const arch = archFixture({ seeds: ['KI-001', 'TD-010', 'TD-011', 'ENV-002', 'PF-001'] })
    const twice = ledgerFixture([
      '| KI-001 | 某事 | P3 | Blocked |',
      '| TD-010 | 某债 | 某点 |',
      '| PF-001 | 某性能项 | — |',
      '| PF-001 | 另一件性能项 | — |',
      '| ENV-002 | 某限制 | 某替代 | 某路径 |',
    ])
    const findings = seedPointerFindings({ archText: arch, ledgerText: twice })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('PF-001')
  })

  it('§8.3 那张表整块没了 ⇒ 红在分母（不白送一条"0 条命中"的绿）', () => {
    const arch = ['### 8.2 条目格式约定', 'ID 规则：KI-/TD-/PF-/ENV- 前缀 + 3 位序号（例 KI-001）。', '', '### 8.3 首批已知的种子条目', '', '（这一节被改成了别的形状）', ''].join('\n')
    const findings = seedPointerFindings({ archText: arch, ledgerText: GOOD_LEDGER })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('地板')
  })

  it('正册里同一个号挂了两行 ⇒ 红', () => {
    const rows = ledgerRows(ledgerFixture(['| KI-001 | 一件事 | P3 | Blocked |', '| KI-001 | 另一件事 | P3 | Blocked |']))
    const findings = duplicateIdFindings(rows)
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0]!.key).toBe('KI-001')
  })

  it('4 位拼写出现在普通文件里 ⇒ 红（号只许一套）', () => {
    const files = [{ rel: 'docs/某.md', text: `这里引了一个 ${oldSpell('KI', '0001')} 号。` }]
    const findings = retiredSpellingFindings({ files, registerFile: REGISTER_FILE })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0]!.msg).toContain('位')
  })

  it('4 位拼写出现在名册那份文件里且是名册的键 ⇒ 不红（负例：登记处不是病）', () => {
    const token = oldSpell('KI', '0001')
    const files = [{ rel: REGISTER_FILE, text: `export const RETIRED_SPELLINGS = {\n  '${token}': { now: 'KI-001', why: 'x' },\n}\n` }]
    const findings = retiredSpellingFindings({ files, registerFile: REGISTER_FILE })
    expect(findings.map((f) => f.msg).join('\n')).toBe('')
  })

  it('名册指着的那个号在正册里没有 ⇒ 红（这张名册的作用是"旧拼写 → 它今天是什么"）', () => {
    const findings = retiredRegisterFindings({ ledgerText: ledgerFixture(['| KI-001 | 某事 | P3 | Blocked |']) })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('号')
  })
})

describe('号段只有一套（KI-326）：真库腿', () => {
  /** 扫描面：与门 B 同一片（src/tests/scripts/docs），多加 `.mts` 与 `.py`（登记处的两个漏网后缀） */
  const skipDirs = new Set(['node_modules', '.git', '.scratch', 'dist', 'Python', 'artifacts', 'coverage'])
  const TEXT_EXT = /\.(ts|tsx|mjs|mts|md|json|py)$/
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (skipDirs.has(name)) continue
      const p = `${dir}/${name}`
      if (statSync(p).isDirectory()) walk(p, out)
      else if (TEXT_EXT.test(name)) out.push(p)
    }
    return out
  }
  const relOf = (f: string) => f.slice(root.length).replace(/^[\\/]/, '').replace(/\\/g, '/')
  const scanFiles = ['src', 'tests', 'scripts', 'docs'].flatMap((sub) => walk(`${root}/${sub}`))

  it('扫描面没有塌（分母与判据出自同一次扫描）', () => {
    expect(scanFiles.length, `扫描面只读到 ${scanFiles.length} 份文件 = 某一片塌了，未登记的号可以藏在里面`).toBeGreaterThanOrEqual(400)
    for (const sub of ['src', 'tests', 'scripts', 'docs']) {
      expect(walk(`${root}/${sub}`).length, `${sub}/ 一份文件都没读到`).toBeGreaterThanOrEqual(1)
    }
  })

  it('正册在用的前缀集合 == 名册 LEDGER_PREFIXES，且正册的号一律 3 位', () => {
    const rows = ledgerRows(issues)
    expect(rows.length, `正册只读到 ${rows.length} 行 = 抽取形状坏了`).toBeGreaterThanOrEqual(250)
    const prefixes = [...new Set(rows.map((r) => r.id.replace(/-\d+$/, '')))].sort()
    expect(prefixes, '正册在用的前缀与名册对不上 ⇒ 规则句那份名单也该跟着改').toEqual([...LEDGER_PREFIXES].sort())
    const off = rows.filter((r) => r.id.replace(/^\D+-/, '').length !== ID_DIGITS)
    expect(off.map((r) => `第 ${r.line} 行 ${r.id}`), '正册里有不是 3 位的号').toEqual([])
  })

  it('规则句 ↔ 正册实况同形：前缀集合、位数、例子（0 条）', () => {
    const rule = parseIdRule(archDoc)
    expect(rule, '§8.2 那条规则句读不出来 = 门在读一个空集合').toBeTruthy()
    const findings = ruleSentenceFindings({ archText: archDoc, ledgerText: issues })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('§8.3 的指针表 ↔ 正册行：每个号恰好一行（0 条）', () => {
    const seeds = seedRows(archDoc)
    expect(seeds.length, `§8.3 那张表只读到 ${seeds.length} 行（地板 5）= 门在读一个空集合`).toBeGreaterThanOrEqual(5)
    const findings = seedPointerFindings({ archText: archDoc, ledgerText: issues })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('正册里同一个号只挂一行（0 条）', () => {
    const findings = duplicateIdFindings(ledgerRows(issues))
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('全库 4 位拼写 0 处（旧拼写只许留在名册里）', () => {
    const files = scanFiles.map((f) => ({ rel: relOf(f), text: readFileSync(f, 'utf8') }))
    const findings = retiredSpellingFindings({ files, registerFile: REGISTER_FILE })
    expect(
      findings.map((f) => `【${f.key}】${f.msg}`).join('\n'),
      '这些地方还留着 4 位拼写 —— 号段只有一套（正册的 3 位号）；旧拼写本身留在名册里，文档里一个字都不许留。',
    ).toBe('')
  })

  it('名册自证：每一格说得出它今天是什么，且指的那个号在正册里真有一行（0 条）', () => {
    const findings = retiredRegisterFindings({ ledgerText: issues })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
    expect(Object.keys(RETIRED_SPELLINGS).length, '名册空了 = 旧拼写的来历没人记了').toBeGreaterThanOrEqual(5)
    for (const token of Object.keys(RETIRED_SPELLINGS)) {
      expect(token.replace(/^\D+-/, '').length, `名册里的 ${token} 是 3 位的 —— 它没退役`).toBeGreaterThan(ID_DIGITS)
    }
  })
})
