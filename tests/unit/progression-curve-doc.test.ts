/**
 * KI-028 第一半：progression.md §2.3 那张等级曲线表 ⇄ `progression.json > rankCurve` 的机器对账。
 *
 * **为什么立在测试里而不是校验器里**：这条链的一端是 markdown，而 `validate-data.mjs` 不该会读
 * 文档（与 `tests/unit/lighting.test.ts` 的文档对账同一只手、同一个理由）。校验器只管表自己
 * （非空、长度 = maxRank-1、逐行合法），它今天已经在管。
 *
 * **病是什么**：表里 12/15/18/20/30 五行的数字与它自己那句「几何增长 r≈1.25」算不回去，
 * 而实装读的是表——文档写了 21 天没人发现，因为**没有任何东西读那张表**。所以这里的判据不是
 * "文档写得像不像话"，而是"文档里的每一个数都必须能从表里推出来"：推不出来就红，并且点名是哪一级。
 *
 * **口径裁决（见 KI-028 行）**：取实装曲线为唯一主人，改文档不改曲线。调陡曲线要连带重做
 * 里程碑/装备/伤害的经济，而那一半（收入模型 ⇄ VS 分钟）本测试**故意不量**，
 * 并在 L9 里钉住"文档必须自己声明这一栏没有机器读者"。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const docRaw = readFileSync(`${root}docs/progression.md`, 'utf8')
const curve = JSON.parse(readFileSync(`${root}src/data/json/progression.json`, 'utf8')).rankCurve as { rank: number; xp: number }[]

/** 行尾统一成 LF：这一份文档今天是 LF，但判据不许靠这个假设（混行尾会把整段读空） */
const doc = docRaw.replace(/\r\n/g, '\n')

/** §2.3 那一节：从标题起，到下一个 `### ` 止 */
const sectionOf = (marker: string): string => {
  const i = doc.indexOf(marker)
  expect(i, `文档里找不到「${marker}」⇒ 这一节改名或没了，判据在看一个空集合`).toBeGreaterThanOrEqual(0)
  const rest = doc.slice(i + marker.length)
  const j = rest.indexOf('\n### ')
  return j < 0 ? rest : rest.slice(0, j)
}
const SEC = '### 2.3 等级曲线（音级表）'

/** 表推：每一级的「升至本级需」= 表里那一行的 xp；「累计」= 从最低级滚上来的和 */
const derived = (() => {
  const byRank = new Map<number, { xp: number; cum: number }>()
  let cum = 0
  for (const row of [...curve].sort((a, b) => a.rank - b.rank)) {
    cum += row.xp
    byRank.set(row.rank, { xp: row.xp, cum })
  }
  return byRank
})()
const maxRank = Math.max(...[...derived.keys()])

/** 表行：只收首格是纯数字的行（跳过表头与分隔行） */
function docRows(): { rank: number; need: string; cum: string; line: string }[] {
  const sec = sectionOf(SEC)
  return sec
    .split('\n')
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => {
      const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      return { rank: Number(cells[0]), need: cells[1], cum: cells[2], line: l.trim() }
    })
}

describe('KI-028①：progression.md §2.3 的每个数字都必须能从 rankCurve 推出来', () => {
  it('表读得出（地板）：解析器不许把自己读窄到 0 行', () => {
    const rows = docRows()
    expect(rows.length, `§2.3 只读出 ${rows.length} 行 ⇒ 要么表改了形状，要么这一节空了；这两种都不该绿`).toBeGreaterThanOrEqual(10)
    // 首尾都在表里：第一级（2）与封顶级必须点名，否则"逐字锚点"与"数值封顶"两头都没人读
    expect(rows.map((r) => r.rank), '§2.3 必须点名最低那一级').toContain(Math.min(...derived.keys()))
  })

  it('每一级的「升至本级需」是一个整数且等于表里的 xp', () => {
    const offenders: string[] = []
    for (const r of docRows()) {
      if (!/^\d+$/.test(r.need)) {
        offenders.push(`${r.line} ⇒ 「升至本级需」这一格必须是**一个**整数（今天写成 564/705 这种一格两数，就是把两级塞进一行，累计栏跟着错）`)
        continue
      }
      const t = derived.get(r.rank)
      if (!t) offenders.push(`${r.line} ⇒ rankCurve 里没有 rank ${r.rank}（表最高 ${maxRank}）`)
      else if (Number(r.need) !== t.xp) offenders.push(`${r.line} ⇒ rank ${r.rank} 实装需 ${t.xp}，文档写 ${r.need}`)
    }
    expect(offenders, `§2.3 与实装曲线对不上 ${offenders.length} 行：\n${offenders.join('\n')}`).toEqual([])
  })

  it('每一级的「累计」等于从表滚出来的和（不是另一只手抄的数）', () => {
    const offenders: string[] = []
    for (const r of docRows()) {
      const t = derived.get(r.rank)
      if (!t) continue // 上一格已经点过名
      if (Number(r.cum) !== t.cum) offenders.push(`rank ${r.rank}：文档累计 ${r.cum} ≠ 表推 ${t.cum}（差 ${Number(r.cum) - t.cum}）`)
    }
    expect(offenders, `累计栏对不上 ${offenders.length} 行：\n${offenders.join('\n')}`).toEqual([])
  })

  it('封顶那一级必须在表里（maxRank 从数据现推，不手钉）', () => {
    const ranks = docRows().map((r) => r.rank)
    expect(ranks, `rankCurve 最高到 ${maxRank}，而 §2.3 没有点名这一级 ⇒ 数值封顶线没有读者`).toContain(maxRank)
  })

  it('文档那句「r≈」的说法必须量得出：表内逐行比值都落在它的容差里', () => {
    const sec = sectionOf(SEC)
    const m = sec.match(/r≈\s*([\d.]+)/)
    expect(m, '§2.3 没有「r≈<数>」这句 ⇒ 判据读不到口径，宁红不空转').not.toBeNull()
    const claimed = Number(m![1])
    const ordered = [...derived.keys()].sort((a, b) => a - b)
    const devs: { at: number; ratio: number }[] = []
    for (let i = 1; i < ordered.length; i++) {
      const ratio = derived.get(ordered[i])!.xp / derived.get(ordered[i - 1])!.xp
      if (Math.abs(ratio - claimed) / claimed > 0.01) devs.push({ at: ordered[i], ratio: Number(ratio.toFixed(4)) })
    }
    expect(devs, `表内比值越出 r≈${claimed} 的 ±1%：${devs.map((d) => `rank ${d.at}→${d.ratio}`).join('，')}`).toEqual([])
  })

  it('§2.3 里不许再出现「10 级后改 1.22」那一半（从未实装的口径）', () => {
    const sec = sectionOf(SEC)
    expect(sec.length, '§2.3 读空 ⇒ 这条缺席判据在看一个空集合').toBeGreaterThan(200)
    const hits = sec.split('\n').filter((l) => /1\.22/.test(l))
    expect(hits, `§2.3 还写着未实装的斜率口径：\n${hits.join('\n')}`).toEqual([])
  })

  it('「预期到达位置」那一栏必须自己声明它没有机器读者', () => {
    const sec = sectionOf(SEC)
    expect(sec, '§2.3 里没有那句「无机器读者」的声明 ⇒ 要么删了它，要么收入模型已经建起来——后者请连同 KI-028 一起结案').toContain('无机器读者')
  })
})
