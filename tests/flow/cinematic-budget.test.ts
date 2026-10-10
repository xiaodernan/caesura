import { describe, expect, it } from 'vitest'
import { registerGameData, cinematics, dialogues } from '@/data'
import {
  CINE_MAX_ONE_MS,
  CINE_MAX_TOTAL_MS,
  cinematicBudgetErrors, cinematicReferenceErrors,
  cinematicTotalMs,
} from '../../scripts/cinematic-rules.mjs'

/**
 * §6 Cinematics 清单（需求 §31）的**预算守卫**。
 *
 * `cinematics.json` 已落地（10 行）。合成夹具仍然留着——它锁的是"文档→判据"的抄录，
 * 真表那头由 `validate-data.mjs` 用同一个判据跑（见 `cinematic-rules.mjs` 的注释）。
 *
 * 最要紧的一条是 `§6 自己的那份清单必须守住 §6 自己的预算`——把文档里的数字
 * （9 条 + 1 段蒙太奇 = 148s、单条 ≤25s）变成**可运行的判据**，
 * 而不是留在文档里靠人眼核对。
 */

/** §6 清单的真实时长（毫秒）——照 `docs/narrative.md §6` 那张表逐条抄，**这是被测对象不是判据** */
const DOC_LIST = [
  { id: 'CINE_OPEN', kind: '开场', durationMs: 25_000, lockInput: true },
  { id: 'CINE_OST_INTRO', kind: 'MiniBoss出场', durationMs: 10_000, lockInput: true },
  { id: 'CINE_MYRIAD_INTRO', kind: '隐藏Boss出场', durationMs: 8_000, lockInput: true },
  { id: 'CINE_HERSIL_INTRO', kind: '主Boss出场', durationMs: 18_000, lockInput: true },
  { id: 'CINE_STORY_B5', kind: '剧情', durationMs: 15_000, lockInput: true },
  { id: 'CINE_STORY_B7', kind: '剧情', durationMs: 20_000, lockInput: true },
  { id: 'CINE_WIN', kind: '胜利', durationMs: 14_000, lockInput: true },
  { id: 'CINE_END_A', kind: '结局', durationMs: 22_000, lockInput: true },
  { id: 'CINE_END_B', kind: '结局', durationMs: 22_000, lockInput: true },
  { id: 'CINE_END_MONTAGE', kind: '结局蒙太奇', durationMs: 10_000, lockInput: true },
]

describe('§6 过场预算（需求 §31）：单条 ≤25s、全清单 ≤180s', () => {
  it('§6 自己那份清单守得住自己的预算 —— **但表里的数加不出正文那个和**（实测 164s，正文写 148s）', () => {
    expect(cinematicBudgetErrors(DOC_LIST)).toEqual([])
    // ⚠️ 这条断言第一版写的是 148_000（照 `narrative.md §6` 正文那句"合计 138+10=148s"抄），
    // 当场红了：表里九条逐条相加是 25+10+8+18+15+20+14+22+22 = **154s**，加蒙太奇 10s = **164s**。
    // 差 16s。**两种读法都 ≤180s，所以预算结论不变**，但正文那句和与表不符——
    // 这正是"文档里的数字必须由判据复算"的理由（本文件就是干这个的）。
    expect(cinematicTotalMs(DOC_LIST), '表里逐条相加').toBe(164_000)
    expect(CINE_MAX_TOTAL_MS - cinematicTotalMs(DOC_LIST), '真实余量').toBe(16_000)
  })

  it('单条超上限 ⇒ 恰红一条，并点名是哪一条（不是"清单不合格"这种糊涂话）', () => {
    const rows = [
      { id: 'CINE_OK', kind: '剧情', durationMs: 20_000, lockInput: true },
      { id: 'CINE_TOO_LONG', kind: '剧情', durationMs: 40_000, lockInput: true },
    ]
    const errs = cinematicBudgetErrors(rows)
    expect(errs).toHaveLength(1)
    expect(errs[0].where).toBe('CINE_TOO_LONG')
    expect(errs[0].why).toContain(String(CINE_MAX_ONE_MS))
  })

  it('总时长超预算 ⇒ 恰红一条，并把余量算成负数报出来', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: `CINE_${i}`,
      kind: '剧情',
      durationMs: 24_000,
      lockInput: true,
    })) // 8 × 24s = 192s > 180s，且每条都不超单条上限
    const errs = cinematicBudgetErrors(rows)
    expect(errs).toHaveLength(1)
    expect(errs[0].where).toBe('cinematics')
    expect(errs[0].why).toContain('-12000')
  })

  it('边界：恰好 25s / 恰好 180s 都算守住（"≤"是含端点的）', () => {
    expect(cinematicBudgetErrors([{ id: 'A', kind: 'k', durationMs: CINE_MAX_ONE_MS, lockInput: true }])).toEqual([])
    const exact = Array.from({ length: 9 }, (_, i) => ({ id: `E${i}`, kind: 'k', durationMs: 20_000, lockInput: true }))
    expect(cinematicTotalMs(exact)).toBe(CINE_MAX_TOTAL_MS)
    expect(cinematicBudgetErrors(exact)).toEqual([])
  })

  it('数据自洽：id 重复 / durationMs 非正 / 非数组 各报一条（空转与假绿都不许）', () => {
    expect(cinematicBudgetErrors([{ id: 'X', kind: 'k', durationMs: 1000, lockInput: true }, { id: 'X', kind: 'k', durationMs: 1000, lockInput: true }])[0].why)
      .toContain('id 重复')
    expect(cinematicBudgetErrors([{ id: 'Y', kind: 'k', durationMs: 0, lockInput: true }])[0].why).toContain('为正')
    expect(cinematicBudgetErrors(null as unknown as readonly { id?: unknown }[]).length).toBeGreaterThan(0)
    // 缺字段也要说话（三条 CINE_FIELDS 各一次）
    expect(cinematicBudgetErrors([{}]).length).toBeGreaterThanOrEqual(3)
  })

  it('空清单不报错（"还没有过场"不是违规），但总时长读数是 0 —— 读数与判据不混为一谈', () => {
    expect(cinematicBudgetErrors([])).toEqual([])
    expect(cinematicTotalMs([])).toBe(0)
  })
})

describe('§6 清单**落地之后**：真表与文档表必须是同一张（不许漂）', () => {
  it('真表 `cinematics.json` 守得住 §6 的两条预算（判据现在吃的是真数据）', () => {
    registerGameData()
    expect(cinematicBudgetErrors(cinematics as unknown as Array<{ id?: unknown; kind?: unknown; durationMs?: unknown }>)).toEqual([])
  })

  it('真表的 id 与文档表逐条对齐（多一条/少一条/改名 ⇒ 这里红）', () => {
    registerGameData()
    const realIds = (cinematics as unknown as Array<{ id: string }>).map((r) => r.id)
    const docIds = DOC_LIST.map((r) => r.id)
    expect([...realIds].sort()).toEqual([...docIds].sort())
  })

  it('真表的总时长 = 164s（与文档逐条相加一致，余量 16s）', () => {
    registerGameData()
    expect(cinematicTotalMs(cinematics as unknown as Array<{ durationMs?: unknown }>)).toBe(164_000)
  })

})

describe('§6 引用对账：对话里挂的 `cinematic` 名字必须都在清单里（拼错一个字母 = 那一段永远不演）', () => {
  const rows = [{ id: 'CINE_OPEN', kind: 'k', durationMs: 1000 }]

  it('名字在表里 ⇒ 不报（含"这一条没挂过场"的常见情形）', () => {
    const trees = [
      { id: 'T', nodes: [{ id: 'n0', choices: [{ id: 'c1', cinematic: 'CINE_OPEN' }, { id: 'c2' }] }] },
    ]
    expect(cinematicReferenceErrors(rows, trees)).toEqual([])
  })

  it('名字不在表里 ⇒ 报，并且**点名到 树.节点.选项**（不是"有地方挂错了"这种糊涂话）', () => {
    const trees = [
      { id: 'DLG_X', nodes: [{ id: 'n7', choices: [{ id: 'c1', cinematic: 'CINE_TYPO' }] }] },
    ]
    const errs = cinematicReferenceErrors(rows, trees)
    expect(errs).toHaveLength(1)
    expect(errs[0].where).toBe('DLG_X.n7.c1')
    expect(errs[0].why).toContain('CINE_TYPO')
  })

  it('真数据两侧都对得上：`dialogue.json` 今天挂的过场名字全在 `cinematics.json` 里', () => {
    registerGameData()
    const errs = cinematicReferenceErrors(
      cinematics as unknown as Array<{ id?: unknown }>,
      dialogues as unknown as unknown[],
    )
    expect(errs, `对不上的引用：${errs.map((e) => `${e.where} → ${e.why}`).join('；')}`).toEqual([])
  })

  it('反向：真数据里**至少有一条**选择挂着过场（否则这道门在空转——B5 是今天挂上的第一条）', () => {
    registerGameData()
    let n = 0
    for (const t of dialogues as unknown as Array<{ nodes?: Array<{ choices?: Array<{ cinematic?: unknown }> }> }>) {
      for (const node of t.nodes ?? []) {
        for (const c of node.choices ?? []) if (typeof c.cinematic === 'string') n++
      }
    }
    expect(n).toBeGreaterThanOrEqual(1)
  })
})
