/**
 * 技术架构 §2 那张 **A 表（「换了载体：表里的路径不存在，职责确实每天都在跑」）** 的第一个机器读者。
 *
 * 为什么要有它（KI-340「还欠④」点名的那一格）：B 表与 C 表在这两天各自有了探针
 * （`arch-gap-table.test.ts` / `arch-c-table.test.ts`），而 **A 表一行探针都没有**。
 * A 表烂掉的方式与 B 表一模一样：**每一行在写下那天是真的**——`combat/AttackSystem.ts` 当年确实
 * 被合进了 `CombatManager.ts`，`ai/StateMachine.ts` 当年确实被 `Enemy.state` 顶掉——然后载体再被
 * 改名/拆走一次，这一行就成了一句没人核过的旧话。B 表的教训是「缺口被填掉时没人回来改它」，
 * A 表的教训是「载体被搬走时也没人回来改它」。
 *
 * **判据只碰机械的那一半**（与 B 表探针同一条口径）：每一行「真载体」列里点名的 `.ts` 文件，
 * 今天必须在 `src/` 下**真的存在**。散文里那句「差在哪一句」不判（那是人的事）。
 *
 * **不判什么**：
 *  - 不判「规划路径不存在」——A 表自己的第 265 行就是反例（`core/RhythmClock.ts` 换了层，**它存在**）。
 *  - 不判行数固定——A 表会随重命名长出新行（与 B 表那张「缺口清单」不同）。
 *    只钉一条地板：行数 ≥ 15 且至少读到 20 个 `.ts` 路径，否则就是解析器瞎了（空集合上的绿是白送的）。
 *
 * **红的时候怎么办**：那一行的载体被改名/删了 ⇒ 回来改这一行（把新载体写进第二列）；
 * 或者那个反引号里的路径**本来就不是承载体**（只是顺带提一句）⇒ 把它从反引号里拿出来。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const ARCH = readFileSync(join(root, 'docs/technical-architecture.md'), 'utf8')

/** 与 `arch-gap-table.test.ts` 同一个切法：转义的竖线不算分隔符 */
const cells = (l: string): string[] => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())

/** A 表：从「**A. 换了载体…**」那一行往下，第一段以 `|` 开头的连续行 */
function aTable(src: string): { head: string[]; rows: Array<{ n: number; cells: string[] }> } {
  const lines = src.split(/\r?\n/)
  const at = lines.findIndex((l) => l.startsWith('**A. 换了载体'))
  if (at < 0) throw new Error('架构里找不到 A 表的小标题（**A. 换了载体…**）')
  const block: Array<{ n: number; l: string }> = []
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith('|')) block.push({ n: i + 1, l: lines[i]! })
    else if (block.length) break
  }
  if (block.length < 3) throw new Error('A 表下面没有一张完整的表')
  return { head: cells(block[0]!.l), rows: block.slice(2).map((b) => ({ n: b.n, cells: cells(b.l) })) }
}

/** 一行「真载体」列里点名的 `.ts` 路径（`src/` 前缀归一掉；反引号外的散文不读） */
function carrierPaths(actual: string): string[] {
  return [...actual.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1]!.trim())
    .filter((t) => t.endsWith('.ts'))
    .map((t) => t.replace(/^src\//, ''))
}

/**
 * 纯判据（测试与反向腿共用一份）：喂一段文档原文与一个「这个相对路径在不在」的探针，
 * 返回 `{ checked, missing }`。抽出来是为了**反向实测不用碰在途的真文档**。
 */
function missingCarriers(docText: string, exists: (rel: string) => boolean): { checked: number; missing: string[] } {
  const A = aTable(docText)
  const missing: string[] = []
  let checked = 0
  for (const row of A.rows) {
    const actual = row.cells[1] ?? ''
    if (/从未存在/.test(actual)) continue // 「从未存在」那行本来就没有载体
    for (const p of carrierPaths(actual)) {
      checked++
      if (!exists(p)) missing.push(`第 ${row.n} 行：src/${p}`)
    }
  }
  return { checked, missing }
}

describe('架构 A 表：每一行点名的「真载体」今天真的还在（KI-340 还欠④）', () => {
  it('表的形状：至少 15 行，且表头是「规划路径 / 真载体 / 差在哪一句」', () => {
    const A = aTable(ARCH)
    expect(A.head, 'A 表表头被改了（列序变了，探针的取列就会错位）').toEqual(['规划路径', '真载体', '差在哪一句'])
    expect(A.rows.length, 'A 表少得可疑：行数掉到 15 以下，先确认是不是解析器瞎了或表被删了').toBeGreaterThanOrEqual(15)
  })

  it('每一行「真载体」列里的 .ts 路径都在 src/ 下存在', () => {
    const { checked, missing } = missingCarriers(ARCH, (p) => existsSync(join(root, 'src', p)))
    expect(checked, '一个 .ts 路径都没读到 ⇒ 解析器瞎了，这一趟的绿是白送的').toBeGreaterThanOrEqual(20)
    expect(
      missing,
      'A 表点名的载体不见了（改名/删掉/拆走）。回来改那一行：把新载体写进第二列；'
        + '或者那个反引号里的路径本来就不是承载体（只是顺带提一句）⇒ 把它从反引号里拿出来。',
    ).toEqual([])
  })

  it('反向：合成文档里放一个不存在的载体 ⇒ 被点名；「从未存在」那一行不误报', () => {
    const doc = [
      '**A. 换了载体：表里的路径不存在，职责确实每天都在跑**',
      '',
      '| 规划路径 | 真载体 | 差在哪一句 |',
      '|---|---|---|',
      '| `x/A.ts` | `combat/Real.ts` | 换了层 |',
      '| `x/B.ts` | **从未存在** | — |',
      '| `x/C.ts` | `combat/Gone.ts` + `world/AlsoGone.ts` | 拆走了 |',
    ].join('\n')
    const { checked, missing } = missingCarriers(doc, (p) => p === 'combat/Real.ts')
    expect(checked, '合成文档里该读到三个载体路径（「从未存在」那行不算）').toBe(3)
    expect(missing.join('\n')).toContain('combat/Gone.ts')
    expect(missing.join('\n')).toContain('world/AlsoGone.ts')
    expect(missing.join('\n'), '存在的那个不许被点名').not.toContain('combat/Real.ts')
  })
})
