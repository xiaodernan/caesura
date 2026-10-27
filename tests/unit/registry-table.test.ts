import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ROW_SHAPES,
  TABLE_PREFIX,
  idReferenceFindings,
  ledgerTables,
  prefixCoverageFindings,
  rowShapeFindings,
  statusOverviewFindings,
  statusVocab,
} from '../../scripts/registry-rules.mjs'
import { deliverySurface } from '../../scripts/id-scope-rules.mjs'

/**
 * 正册那四张表的**行形状**门（KI-327）。
 *
 * **病**：架构 §8.1 写着「四张表…状态只允许 `Implemented | Partial | Placeholder | Blocked`」，
 * 而正册里 §2/§3/§4 三张表**根本没有状态列** ⇒ 那三张表里的债／限制没有机器可读的状态；
 * 门 B 又只扫 `KI-` 的按号引用 ⇒ `TD-`/`PF-`/`ENV-` 的按号引用读不到行**至今没人判**；
 * 而 §1.5「系统状态总表」里有一行的缺口栏写着**裸竖线**（两个形状 `{item,count}` | `{flag}`）
 * ⇒ 任何按格数解析的读者读出的是错位的格子（门 D 看不见它——门 D 只看 KI 记录那些行）。
 *
 * **三道判据**：
 *   I1 行形状按 ID 前缀（KI/TD/PF 恰 4 格、ENV 恰 5 格，末格取自 §78 词表——**词表从正册现推**）；
 *   I2 按号引用必须读得到行（活着的行，或那段「留号不留行」注记里已销案的号）；
 *   I3 §1.5 每一行的格数必须与表头一致。
 *
 * **两条量具纪律**：分母与判据出自同一次扫描；**这台门自己不许出现悬空号**（它扫 `tests/`），
 * 所以夹具里那个"正册没有的号"是**拼出来的**。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const issues = readFileSync(root + 'docs/KNOWN_ISSUES.md', 'utf8')

/** 假号是拼出来的：这台门扫 `tests/`，字面量落在本文件里会先红在自己身上 */
const fakeId = (prefix: string, digits: string): string => `${prefix}-${digits}`

/** 合成一份正册：状态词表行 ＋ 四张表（形状与真文件同构） */
const ledgerFixture = (opts: {
  vocab?: string
  td?: string[]
  pf?: string[]
  env?: string[]
  ki?: string[]
  overview?: string[]
  retired?: string[]
} = {}): string => {
  const vocab = opts.vocab ?? '状态词表：**Implemented** ｜ **Partial** ｜ **Placeholder** ｜ **Blocked**'
  const td = opts.td ?? ['| TD-006 | 某债 | 某清理点 | Partial |']
  const pf = opts.pf ?? ['| PF-001 | 某性能项 | — | Blocked |']
  const env = opts.env ?? ['| ENV-002 | 某限制 | 某替代 | 某路径 | Blocked |']
  const ki = opts.ki ?? ['| KI-001 | 某事 | P3 | Blocked |']
  const overview = opts.overview ?? ['| 某系统 | Partial | 某缺口 | P1 |']
  const retired = opts.retired ?? []
  return [
    '# KNOWN_ISSUES',
    '',
    vocab,
    '',
    '## 1. Known Issues（已知问题）',
    '| ID | 描述 | 严重度 | 状态 |',
    '|---|---|---|---|',
    ...ki,
    '',
    '## 1.5 系统状态总表（需求 §78，每 Phase 出口更新）',
    '| 系统 | 状态 | 缺口 | 优先级 |',
    '|---|---|---|---|',
    ...overview,
    '',
    '## 2. Technical Debt（技术债）',
    '| ID | 描述 | 计划清理点 | 状态 |',
    '|---|---|---|---|',
    ...td,
    '',
    ...(retired.length ? ['> **销案的债留号不留行**：' + retired.join('、'), ''] : []),
    '## 3. Performance Issues（性能问题）',
    '| ID | 描述 | Before/After 记录 | 状态 |',
    '|---|---|---|---|',
    ...pf,
    '',
    '## 4. Missing Assets / Environment Limitations（缺失资产与环境限制，需求 §3）',
    '| ID | 限制 | 替代方案 | 升级路径 | 状态 |',
    '|---|---|---|---|---|',
    ...env,
    '',
  ].join('\n')
}

describe('正册四张表的行形状（KI-327）：合成夹具腿', () => {
  it('状态词表读不到 ⇒ 红在地板上（不许抄第二份，只能从正册现推）', () => {
    const findings = rowShapeFindings(ledgerFixture({ vocab: '状态词表：Implemented Partial Placeholder Blocked' }))
    expect(findings.length, '词表行被改了形状，这道门却什么都没报').toBeGreaterThanOrEqual(1)
    expect(findings[0]!.msg).toContain('词表')
  })

  it('TD 行少一格 ⇒ 红', () => {
    const findings = rowShapeFindings(ledgerFixture({ td: ['| TD-006 | 某债 | 某清理点 |'] }))
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('TD-006')
  })

  it('TD 行末格不在词表里 ⇒ 红（"它还欠着没有"读不出来）', () => {
    const findings = rowShapeFindings(ledgerFixture({ td: ['| TD-006 | 某债 | 某清理点 | 还开着 |'] }))
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('词表')
  })

  it('PF 行末格不在词表里 ⇒ 红', () => {
    const findings = rowShapeFindings(ledgerFixture({ pf: ['| PF-001 | 某性能项 | — | 待测 |'] }))
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('词表')
  })

  it('ENV 行格数不对 ⇒ 红', () => {
    const findings = rowShapeFindings(ledgerFixture({ env: ['| ENV-002 | 某限制 | 某替代 | 某路径 |'] }))
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('ENV-002')
  })

  it('表头列数与它本家那类行不符 ⇒ 红', () => {
    const text = ledgerFixture().replace('| ID | 描述 | 计划清理点 | 状态 |', '| ID | 描述 | 计划清理点 |')
    const findings = rowShapeFindings(text)
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('表头')
  })

  it('按号引用读不到行 ⇒ 红', () => {
    const ghost = fakeId('TD', '099')
    const files = [{ rel: 'docs/某.md', text: `这里按号引用了 ${ghost}。` }]
    const findings = idReferenceFindings({ files, ledgerText: ledgerFixture() })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('空气')
  })

  it('按号引用指到注记里已销案的号 ⇒ 不红（负例：销案之后历史叙述还在按号引用它）', () => {
    const files = [{ rel: 'docs/某.md', text: '这里按号引用了 TD-003。' }]
    const findings = idReferenceFindings({ files, ledgerText: ledgerFixture({ retired: ['~~TD-003~~'] }) })
    expect(findings.map((f) => f.msg).join('\n')).toBe('')
  })

  it('§1.5 那一行多切一格 ⇒ 红（缺口栏里的裸竖线）', () => {
    const findings = statusOverviewFindings(ledgerFixture({ overview: ['| 某系统 | Partial | 缺口里有裸竖线 | 优先级也在这里 | P1 |'] }))
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('裸竖线')
  })

  it('规则句喊的前缀在正册一行都没有 ⇒ 红', () => {
    const findings = prefixCoverageFindings(ledgerFixture({ pf: [] }))
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.map((f) => f.msg).join('\n')).toContain('PF')
  })
})

describe('正册四张表的行形状（KI-327）：真库腿', () => {
  /** 扫描面：**交付总体**（口径出自 `scripts/id-scope-rules.mjs`，不手抄第二份「目录 × 后缀」清单） */
  const surface = deliverySurface(root)
  const scanFiles = surface.files

  it('分母没有塌：四张表都在、正册行数够、词表推出四个词', () => {
    const tables = ledgerTables(issues)
    expect(tables.length, `正册只读到 ${tables.length} 张表 = 抽取形状塌了`).toBeGreaterThanOrEqual(4)
    for (const num of Object.keys(TABLE_PREFIX)) {
      expect(tables.some((t) => t.title.startsWith(`${num}.`)), `第 ${num} 张表不在了`).toBe(true)
    }
    const rows = tables.flatMap((t) => t.rows)
    expect(rows.length, `正册只读到 ${rows.length} 行 = 分母读空`).toBeGreaterThanOrEqual(250)
    expect(statusVocab(issues).length, '状态词表推出的词数不对').toBeGreaterThanOrEqual(4)
    expect(scanFiles.length, `扫描面只读到 ${scanFiles.length} 份文件 = 某一片塌了`).toBeGreaterThanOrEqual(500)
    expect(surface.missing, '交付总体少了目录（那一片的文本没人扫）').toEqual([])
    expect(surface.unreadable.length, `总体里有 ${surface.unreadable.length} 份文件读不出来（读不出来的引用不会变红，绿是白送的）`).toBe(0)
  })

  it('行形状：每一行按 ID 前缀恰 N 格 ＋ 末格取自 §78 词表（0 条）', () => {
    const findings = rowShapeFindings(issues)
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('按号引用：TD-/PF-/ENV- 的每一处都读得到行（0 条）', () => {
    const files = scanFiles
    const findings = idReferenceFindings({ files, ledgerText: issues })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('§1.5 系统状态总表：每一行的格数与表头一致（0 条）', () => {
    const findings = statusOverviewFindings(issues)
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('规则句喊的每个前缀在正册都真有一行（0 条）', () => {
    const findings = prefixCoverageFindings(issues)
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('每类号的行形状写死的是四张表，不多不少（这份名册不许漂）', () => {
    expect(Object.keys(ROW_SHAPES).sort(), '判据里的前缀集合变了 ⇒ 门与名册要一起改').toEqual(['ENV', 'KI', 'PF', 'TD'])
  })
})
