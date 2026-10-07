import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { registerGameData, worldStates } from '@/data'

/**
 * 值域（`states.json`）的**"写了没人读"**检查——门禁只管**旗标**（`PENDING_FLAG_WRITERS`），
 * 值域这一族今天**没有机器看着**。而它的 `note` 里的"读方"名单我已经抓到过两次写错
 * （2026-10-07：`state.corvin.schism` 写"营地后门"、`state.faceless.identity` 写"初句圣所五环线索链"，
 * 两处都**不读它**）——**名单会写错，计数不会**。
 *
 * 本守卫只查一件最硬的事：**每一格值域至少有一个读方**（对话 / 任务步 / 陈设 / 世界规则里出现过它）。
 * 一格值域要是谁都不读，它就是一根**死杠杆**：写它的人（对话）在演戏，世界不会有任何反应。
 *
 * ⚠️ 本守卫**不查**"读方名单是否与 note 一致"——那件事今天实测**不能自动化**
 * （见技能 §5.2：结构化对账 7 条命中全是假阳性，因为"文档某行的状态词"与"它引用的那条账的状态"
 * 是两件独立的声明）。这里只查**存在性**，那是可判的。
 */
registerGameData()

const SOURCES = ['dialogue.json', 'quests.json', 'regions.json', 'worldstate.json', 'items.json']
const corpus = SOURCES.map((f) => readFileSync(`src/data/json/${f}`, 'utf8')).join('\n')

describe('值域（states.json）：每一格都得有人读（死杠杆检查）', () => {
  it('名册不该是空的（否则这道门在空转）', () => {
    expect(worldStates.length).toBeGreaterThan(0)
  })

  it('每一格值域在四张表里至少被读到一次', () => {
    for (const row of worldStates) {
      const key = String(row.key)
      const hits = corpus.split(key).length - 1
      expect(hits, `值域 ${key} 没有任何读方（写它的人在演戏，世界不会有反应）`).toBeGreaterThan(0)
    }
  })
})
