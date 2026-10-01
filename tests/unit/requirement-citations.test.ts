/**
 * KI-096：「需求 §NN」引用第一次有机器对账。
 *
 * 载体是仓库根那份需求原文（路径与"冻结输入"的口径登记在 `docs/technical-architecture.md` §17.1）。
 * 这里只做四件事：把名册解析出来、把引用站点数出来、正向钉"每条引用都落在名册上"、反向钉
 * "从未被点名的那几节 = 文档 §17.2 那张表"，最后替那张表当读者（它点名的证据文件必须真的在树里）。
 *
 * 判据语法与 §17.1 写的是同一条：`需求` 紧邻处（允许 § 与空格）的一串由 、 , / ~ – — 连接的整数。
 * 改这条语法必须同时改那一节，否则文档描述的和门执行的两件事。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const CARRIER = '新建 文本文档.txt'
const ARCH = 'docs/technical-architecture.md'
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n')

/** 扫描总体：由目录清单显式定义（旁路目录如 `.workbuddy-ai`、别的 agent 的记忆不进总体） */
const DIRS = ['docs', 'src', 'tests', 'scripts', 'tools']
const SKIP = new Set(['node_modules', 'dist', '.coverage', 'coverage'])
const files: string[] = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(`${dir}/${e.name}`)
    } else if (/\.(ts|md|mjs|json)$/.test(e.name)) {
      const rel = `${dir}/${e.name}`.replace(/\\/g, '/').slice(ROOT.length)
      if (rel !== CARRIER) files.push(rel)
    }
  }
}
for (const d of DIRS) if (existsSync(`${ROOT}${d}`)) walk(`${ROOT}${d}`)
for (const e of readdirSync(ROOT)) if (/\.md$/.test(e)) files.push(e)

const CITE =
  /需求\s*((?:§\s*)?\d+(?:\.\d+)?(?:\s*[、,/~]\s*(?:§\s*)?\d+(?:\.\d+)?|\s*[-–—]\s*(?:§\s*)?\d+(?:\.\d+)?)*)/g
/** 名册：载体自己的 `# NN. 标题`，与 §17.1 声明的那一条语法 */
const roster = [...read(CARRIER).matchAll(/^#{1,4}\s+(\d+)\.\s+[^\n]*$/gm)].map((m) => +m[1])

type Num = { value: number; sub: number | null }
type Site = { where: string; expr: string; nums: Num[] }
const sites: Site[] = []
for (const f of files) {
  read(f)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(CITE)) {
        sites.push({
          where: `${f}:${i + 1}`,
          expr: m[1].replace(/\s+/g, ' '),
          nums: [...m[1].matchAll(/(\d+)(?:\.(\d+))?/g)].map((n) => ({
            value: +n[1],
            sub: n[2] === undefined ? null : +n[2],
          })),
        })
      }
    })
}

/** 被点名的集合：链上每个整数都算，区间（§7–§10）展开成它覆盖的每一节 */
const cited = new Set<number>()
for (const s of sites) {
  for (const n of s.nums) cited.add(n.value)
  for (const r of s.expr.matchAll(/(\d+)\s*[-–—]\s*(\d+)/g)) {
    const [a, b] = [+r[1], +r[2]]
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) cited.add(k)
  }
}
const uncited = roster.filter((n) => !cited.has(n))

const TABLE_MARK = '### 17.2 从未被点名的需求小节'
const docTable = (() => {
  const doc = read(ARCH)
  const at = doc.indexOf(TABLE_MARK)
  if (at < 0) return null
  const next = doc.indexOf('\n## ', at)
  const block = doc.slice(at, next < 0 ? doc.length : next)
  return [...block.matchAll(/^\|\s*§(\d+)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|/gm)].map((m) => ({
    n: +m[1],
    title: m[2].trim(),
    kind: m[3].trim(),
    evidence: m[4].trim(),
    refs: [...m[4].matchAll(/[\w./-]+\.(?:md|ts|json|mjs)/g)].map((r) => r[0]),
  }))
})()

describe('需求原文的引用对账（KI-096）', () => {
  it('名册解析得动：载体里读到 92 个小节，编号 1..92 连续且不重复', () => {
    expect(roster.length, `从 ${CARRIER} 只解析到 ${roster.length} 个小节 = 分母是空的，判据无从成立`).toBe(92)
    expect(new Set(roster).size, '名册里有重复编号 ⇒ 区间展开与"从未点名"的集合都会算错').toBe(roster.length)
    const sorted = [...roster].sort((a, b) => a - b)
    expect(
      sorted.filter((n, i) => n !== i + 1),
      '需求小节的编号应当是 1..92 连续整数；出现缺口说明载体被改过或解析语法漂了',
    ).toEqual([])
  })

  it('扫描总体不是空的，而且它包含本文件与架构文档、不包含载体本身', () => {
    expect(files.length, `只扫到 ${files.length} 个文件 ⇒ 判据在读一个几乎为空的集合`).toBeGreaterThanOrEqual(200)
    expect(files, '本测试文件自己也在总体里（它写下的引用同样要落进名册）').toContain(
      'tests/unit/requirement-citations.test.ts',
    )
    expect(files).toContain(ARCH)
    expect(files, '载体不算自己的引用点：它那一千多行里没有一处 "需求 §N" 的写法').not.toContain(CARRIER)
  })

  it('每一处「需求 §N」引用都落在名册上：带小数的子编号与越界编号一律红，并报出 file:line', () => {
    expect(sites.length, `全仓库只数到 ${sites.length} 处需求引用，远低于地板 ⇒ 语法或总体出了问题`).toBeGreaterThanOrEqual(340)
    const bad: string[] = []
    for (const s of sites) {
      for (const n of s.nums) {
        if (n.sub !== null) {
          bad.push(`${s.where}  「需求 ${s.expr}」里的 ${n.value}.${n.sub} 是子编号——载体全文没有一个带小数的标题`)
        } else if (!roster.includes(n.value)) {
          bad.push(`${s.where}  「需求 ${s.expr}」里的 ${n.value} 不在 1..92 的名册里`)
        }
      }
    }
    expect(bad, `这些引用点落不到需求名册上：\n${bad.join('\n')}`).toEqual([])
  })

  it('反向清单与 §17.2 那张表同生同死：多一节、少一节、拼错分类都算红', () => {
    expect(uncited.length, `实测"从未被点名"只剩 ${uncited.length} 节，低于地板 ⇒ 多半是扫描没读到东西`).toBeGreaterThanOrEqual(6)
    expect(docTable, `${ARCH} 里找不到 ${TABLE_MARK} 那张表 ⇒ 判据在读一个空集合`).not.toBeNull()
    const rows = docTable as NonNullable<typeof docTable>
    expect(rows.length, '文档那张表一行都没有').toBeGreaterThanOrEqual(6)
    const measured = [...uncited].sort((a, b) => a - b)
    const written = rows.map((r) => r.n).sort((a, b) => a - b)
    const onlyDoc = written.filter((n) => !measured.includes(n))
    const onlyScan = measured.filter((n) => !written.includes(n))
    expect(
      onlyDoc,
      `文档 §17.2 列了 ${onlyDoc.map((n) => `§${n}`).join(' ')}，可扫描显示这些节其实已被点名（把那一行删掉）`,
    ).toEqual([])
    expect(
      onlyScan,
      `扫描发现 ${onlyScan.map((n) => `§${n}`)} 从未被「需求 §N」点名，文档 §17.2 却没有这一行（补一行，写清它今天靠什么活着）`,
    ).toEqual([])
    const KINDS = ['有产物载体', '过程性·无产物载体', '确实没落地']
    const wrongKind = rows.filter((r) => !KINDS.includes(r.kind))
    expect(
      wrongKind.map((r) => `§${r.n}=${r.kind}`),
      `分类列只许这三种写法（拼错的那一行等于没分类）：${KINDS.join(' / ')}`,
    ).toEqual([])
    expect(rows.filter((r) => r.kind === '有产物载体').length, '一张表里一个"有产物载体"都没有 ⇒ 分类列是装饰').toBeGreaterThanOrEqual(3)
    expect(rows.filter((r) => r.kind !== '有产物载体').length, '没有任何一行承认"载体不在产物树里" ⇒ 那张表在假装全覆盖').toBeGreaterThanOrEqual(1)
  })

  it('§17.2 每一行的证据：有产物载体那几行必须点名至少一个真实存在的文件，且点名的文件都得在树里', () => {
    const rows = docTable as NonNullable<typeof docTable>
    const noEvidence = rows.filter((r) => r.kind === '有产物载体' && r.refs.length === 0).map((r) => `§${r.n}`)
    expect(noEvidence, `这几行说"主题在别处有载体"却没点出一个文件：${noEvidence.join(' ')}`).toEqual([])
    const missing = rows.flatMap((r) => r.refs.filter((f) => !existsSync(`${ROOT}${f}`)).map((f) => `§${r.n} → ${f}`))
    expect(missing, `这几行点名的文件不在树里（引用已腐烂）：\n${missing.join('\n')}`).toEqual([])
  })
})
