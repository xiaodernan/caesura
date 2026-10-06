/**
 * KI-096没做② 的第一腿：**带文档锚点的 § 引用**（`<某文档>.md §N`）第一次有机器对账。
 *
 * KI-096 那道门（`requirement-citations.test.ts`）管的是 `需求 §NN` 这一族；它"没做②"里点名的
 * 洞是另一族——项目自己的文档互相点名（`combat.md §14.6`、`audio.md §8.2`、`gameplay.md §254`…）
 * 时，**没有任何人核对过被点名的编号在目标文档里真的存在**。两族的引用形状相同（都是 §数字），
 * 分开它们的只有锚点词，所以这是两道门，不是一道。
 *
 * 本门判两类（口径先量过才定，2026-10-06 全库普查 235 处后落笔）：
 *  - **节号引用**（带点号，或不带点且 < 100）：必须落在目标文档自己的编号标题表里
 *    （`## 3.1` / `### 8.2` 这一族是节号的主人）。例外硬钉在下面：整数 ≥ 100 的编号不可能
 *    是节号——今天没有任何一份文档的节超过 17，哪天有了，"节/行分类"那条会先红。
 *  - **行号引用**（不带点且 ≥ 100，如 `combat.md §595`＝第 595 行）：必须在目标文档的行数之内，
 *    且那一行**非空**（空行让引用无的放矢——`combat.md §9` 是节 9「Hitstop 表」还是第 9 行的
 *    空行？实测所有真行号引用都 ≥ 100，口径因此立得住）。
 *
 * 这道门**有意不做**的三格（登记，不冒充做了）：
 *  - 不带锚点的裸 `§N`（KNOWN_ISSUES.md 里 539 处那一族）：整数版与需求引用形状重叠、点号版又
 *    横跨"本文档节号/他文档节号"两种可能，判它要一条跨文档消歧裁决，另立一格；
 *  - 缩写锚点（`tech-arch §…`、`narrative §4.8`）：不是 `*.md` 字面，正则看不见；
 *  - 锚点指向 `docs/` 之外的 md（今天总体里没有这一族，有了会被"目标文档不在名册"那条喊出来）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n')

/** 扫描总体与 `requirement-citations.test.ts` 同一张清单：两道引用门不各扫各的树 */
const DIRS = ['docs', 'src', 'tests', 'scripts', 'tools']
const SKIP = new Set(['node_modules', 'dist', '.coverage', 'coverage'])
const files: string[] = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(`${dir}/${e.name}`)
    } else if (/\.(ts|md|mjs|json)$/.test(e.name)) {
      files.push(`${dir}/${e.name}`.replace(/\\/g, '/').slice(ROOT.length))
    }
  }
}
for (const d of DIRS) if (existsSync(`${ROOT}${d}`)) walk(`${ROOT}${d}`)
for (const e of readdirSync(ROOT)) if (/\.md$/.test(e)) files.push(e)

/** 锚点引用语法：`<文档名>.md` + 可选空白 + `§` + 一串节/行号（点号分层，到非数字即止） */
const REF = /([\w-]+\.md)\s*§(\d+(?:\.\d+)*)/g

/** 节号表：每份 docs/*.md 自己的编号标题（`## 3.1` / `### 8.2`…）。它就是"这个文档有哪些节"的主人 */
const sectionTable = new Map<string, { secs: Set<string>; lines: string[] }>()
for (const e of readdirSync(`${ROOT}docs`)) {
  if (!e.endsWith('.md')) continue
  const lines = read(`docs/${e}`).split('\n')
  const secs = new Set<string>()
  for (const line of lines) {
    const m = line.match(/^#{1,4}\s+(\d+(?:\.\d+)*)[\.\s：:]/)
    if (m) secs.add(m[1]!)
  }
  sectionTable.set(e, { secs, lines })
}

type Site = { where: string; doc: string; ref: string }
const sites: Site[] = []
for (const f of files) {
  read(f)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(REF)) {
        sites.push({ where: `${f}:${i + 1}`, doc: m[1]!, ref: m[2]! })
      }
    })
}

/** 一处引用按口径分类：行号引用 = 不带点且 ≥ 100；其余（点号或 < 100）= 节号引用 */
const isLineRef = (ref: string): boolean => /^\d+$/.test(ref) && Number(ref) >= 100

const findings: string[] = []
for (const s of sites) {
  const table = sectionTable.get(s.doc)
  if (!table) {
    findings.push(`${s.where} → ${s.doc} §${s.ref}：docs/ 名册里没有这份文档，锚点点了个空名`)
    continue
  }
  if (isLineRef(s.ref)) {
    const line = table.lines[Number(s.ref) - 1]
    if (Number(s.ref) > table.lines.length || !line || !line.trim()) {
      findings.push(`${s.where} → ${s.doc} §${s.ref}（行号引用）：越界或空行——行号的主人 ${s.doc} 今天只有 ${table.lines.length} 行`)
    } else if (table.secs.has(s.ref)) {
      findings.push(`${s.where} → ${s.doc} §${s.ref}：被当行号分类，但它同时是 ${s.doc} 的一个节号——节/行口径在这一格失效，先回来改分类规则`)
    }
  } else if (!table.secs.has(s.ref)) {
    const head = s.ref.split('.')[0]
    const near = [...table.secs].filter((v) => v === head || v.startsWith(`${head}.`))
    findings.push(
      `${s.where} → ${s.doc} §${s.ref}（节号引用）：${s.doc} 的节号表里没有这一节`
        + (near.length ? `（${head}.x 现有：${near.join(' ')}）` : `（${s.doc} 连 ${head}.x 都没有）`),
    )
  }
}

describe('文档锚点引用对账（KI-096没做② 第一腿）', () => {
  it('载体不空转：总体里的锚点引用与节号表都要有量', () => {
    // 探针 N7 那族的教训：不先证"读到了东西"，把扫描关掉这道门也绿着
    expect(sites.length, '全库锚点引用数——引体突然变少说明扫描总体或正则被动了').toBeGreaterThanOrEqual(200)
    expect(sectionTable.size, 'docs/ 的 md 名册').toBeGreaterThanOrEqual(10)
    const referenced = new Set(sites.map((s) => s.doc))
    expect(referenced.size, '被点名的目标文档数').toBeGreaterThanOrEqual(6)
    for (const doc of referenced) {
      expect(sectionTable.get(doc)!.secs.size, `${doc} 的节号表读空了：节号引用全部会判红，门在空转`).toBeGreaterThan(0)
    }
  })

  it('分类口径活着：今天全库确实同时存在两类引用，且行号引用全部 ≥ 100', () => {
    const lineCount = sites.filter((s) => isLineRef(s.ref)).length
    const secCount = sites.length - lineCount
    expect(lineCount, '行号引用（§NNN ≥100）一族的存量').toBeGreaterThanOrEqual(5)
    expect(secCount, '节号引用一族的存量').toBeGreaterThanOrEqual(150)
  })

  it('正向：每一处锚点引用都落在目标文档的节号表／行数之内', () => {
    expect(
      findings,
      `锚点引用判红 ${findings.length} 条（前几条：${findings.slice(0, 3).join(' ／ ')}）`,
    ).toEqual([])
  })
})