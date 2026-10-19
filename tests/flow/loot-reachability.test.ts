import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { registerGameData, lootRaw } from '@/data'

/**
 * 掉落表的**可达性**——"表里有这张表" ≠ "有谁会用上它"。
 *
 * 门禁查的是**反方向**（引用方指的 id 必须存在）；**"这张表没人引用"没有任何东西看着** ✗。
 * 一张没人引用的掉落表就是**死数据**：数值写得再讲究，玩家永远见不到它。
 *
 * 判据读的是**全仓文本**（`src/` + `docs/`）里这个 id 的出现次数：
 * 出现 ≤1 次 ⇒ 只有它自己的定义 ⇒ 没人引用。（比"只查 `regions.json` 的 `lootTable` 字段"稳：
 * 箱子/采集点/Boss/任务奖励各有各的挂法，按字段逐个追会漏。）
 *
 * ⚠️ `KNOWN_ORPHANS` 是**待销名单**（项目里 `PENDING_*` 那一族）：它今天确实没人引用，
 * 但"给它接线"是**设计决定**（哪只箱子算 tier 0？休垒与未竟厅今天都没有箱子）。
 * 名单里每一条**必须仍然是孤儿**——一旦有人接了线，这里会红，逼他把名字划掉，而不是让名单烂着。
 */
registerGameData()

const KNOWN_ORPHANS = ['loot_chest_t0']

/** 全仓文本（src/ 与 docs/ 的 .ts/.mjs/.json/.md） */
function corpus(): string {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!/\.(ts|mjs|json|md)$/.test(e.name)) continue
      out.push(readFileSync(full, 'utf8'))
    }
  }
  walk('src')
  walk('docs')
  return out.join('\n')
}

const text = corpus()
const hits = (id: string): number => text.split(`"${id}"`).length - 1

describe('掉落表可达性：每张表都得有人引用', () => {
  it('名册不该是空的（否则这道门在空转）', () => {
    expect((lootRaw as unknown as unknown[]).length).toBeGreaterThan(0)
  })

  it('除了待销名单，**每张掉落表都至少被引用一次**（只出现 1 次 = 只有它自己的定义）', () => {
    const orphans = (lootRaw as unknown as Array<{ id: string }>)
      .map((r) => r.id)
      .filter((id) => hits(id) <= 1)
    const unexpected = orphans.filter((id) => !KNOWN_ORPHANS.includes(id))
    expect(
      unexpected,
      `这些掉落表没人引用（数值写得再讲究，玩家永远见不到）：${unexpected.join(', ')}`,
    ).toEqual([])
  })

  it('待销名单里的每一条**必须仍然是孤儿**（有人接了线就把它划掉，别让名单烂着）', () => {
    const stale = KNOWN_ORPHANS.filter((id) => hits(id) > 1)
    expect(stale, `这些已经有人引用了 ⇒ 请从 KNOWN_ORPHANS 里划掉：${stale.join(', ')}`).toEqual([])
  })
})
