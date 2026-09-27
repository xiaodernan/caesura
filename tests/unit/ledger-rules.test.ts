import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  flagLedgerErrors, hasMilestoneLeg, milestoneLedgerErrors,
  PENDING_FLAG_WRITERS, PENDING_MILESTONE_GRANTS, UI_BOUND_MILESTONES,
} from '../../scripts/ledger-rules.mjs'

/**
 * 「先记账后接线」那三份账本的**销账**判据（KI-073）。
 *
 * 老规则只管一个方向：没腿（或没写方）又不记账 ⇒ ERROR。这一半管反方向——腿或写方出现了、账还挂着。
 * 触发它的是真数据：`PENDING_MILESTONE_GRANTS.ms_deepcellar` 写着「无腿可接」,
 * 而 `progression.json` 那一行早在 KI-054③ 就落了 `grant.corruptionStayPct: 35`。
 *
 * 名单本体住在 `ledger-rules.mjs` 而不是校验脚本里：测试要读**同一份**名单。前一版在这里从
 * `validate-data.mjs` 的源码里切字符串再 `JSON.parse`——单引号加注释直接崩，而"复制一份常量"
 * 更是第二个主人（必漂）。两个都不如把名单搬到判据旁边。
 */

/**
 * 本沙箱里 **vitest worker 内部不允许 spawn 子进程**：`spawnSync` 一律回 `EBUSY`
 * （managed / 系统 / PATH 上的 node 全试过，换二进制没用），于是"跑真校验器"那条判据**跑不起来**。
 * 处理方式是**响亮地跳过**而不是静默绿：模块加载时探一次，命中就 `skipIf`，并把原因打出来
 * （见 KI-075）。判据本身一字未改——在能 spawn 的环境里它照旧会因为"账不自洽"而红。
 */
const SPAWN_BLOCKED = (() => {
  const probe = spawnSync(process.execPath, ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8' })
  const code = probe.error ? (probe.error as NodeJS.ErrnoException).code : null
  if (code) console.warn(`[ledger-rules] 跳过"跑真校验器"那条：本环境 spawn 子进程被拒（${code}）—— 换台能 spawn 的机器复验，见 KI-075`)
  return code === 'EBUSY'
})()

const root = fileURLToPath(new URL('../..', import.meta.url))
const readJson = <T>(p: string): T => JSON.parse(readFileSync(root + p, 'utf8')) as T

const MOVEMENT_MS = new Set(['ms_movement_slot', 'ms_movement2', 'ms_slot_leg'])
const ROWS = [
  { id: 'ms_has_grant', rank: 10, grant: { loadFlat: 8 } },
  { id: 'ms_slot_leg', rank: 7 },
  { id: 'ms_no_leg', rank: 12 },
]

describe('里程碑账本：有腿就该销账，挂着的 id 必须还在表里', () => {
  it('`hasMilestoneLeg`：字段 grant 与战技槽引用各自算一条腿，空 grant 不算', () => {
    expect(hasMilestoneLeg({ id: 'ms_has_grant', grant: { loadFlat: 8 } }, MOVEMENT_MS)).toBe(true)
    expect(hasMilestoneLeg({ id: 'ms_slot_leg' }, MOVEMENT_MS), '被战技槽按 id 引用 = 腿是解锁形式存在的').toBe(true)
    expect(hasMilestoneLeg({ id: 'ms_no_leg' }, MOVEMENT_MS)).toBe(false)
    expect(hasMilestoneLeg({ id: 'x', grant: {} }, MOVEMENT_MS), '空对象就是没有腿（校验器另有一条管它）').toBe(false)
    expect(hasMilestoneLeg(undefined, MOVEMENT_MS), '账上的 id 在表里找不到时不该崩').toBe(false)
  })

  it('三份死账各报各的：有腿未销 / 表里没这行 / 承载体名单挂了死 id', () => {
    const errs = milestoneLedgerErrors({
      pending: { ms_has_grant: '理由：还没有腿', ms_vanished: '理由：这行还在的时候欠着' },
      uiBound: { ms_nowhere: 'HUD 某个刻度' },
      rows: ROWS,
      movementMsIds: MOVEMENT_MS,
    })
    expect(errs.map((e) => e.key)).toEqual([
      'PENDING_MILESTONE_GRANTS.ms_has_grant', 'PENDING_MILESTONE_GRANTS.ms_vanished', 'UI_BOUND_MILESTONES.ms_nowhere',
    ])
    expect(errs[0].msg, '理由原文要一起印出来：那句谎才是给人看的东西').toContain('还没有腿')
    expect(errs[0].msg, '把腿本身也印出来（读者要能核对自己的表）').toContain('grant={"loadFlat":8}')
    expect(errs[1].msg).toContain('表里没有')
  })

  it('没有腿而账上挂着 ⇒ 一声不响（这正是名单存在的意义）', () => {
    expect(milestoneLedgerErrors({
      pending: { ms_no_leg: '需求侧尚未定义具体效果' },
      uiBound: { ms_no_leg: 'HUD 刻度' },
      rows: ROWS, movementMsIds: MOVEMENT_MS,
    })).toEqual([])
  })

  it('两份名单的承诺不同 ⇒ 判据也不同：承载体名单允许与字段腿并存', () => {
    expect(milestoneLedgerErrors({ pending: {}, uiBound: { ms_has_grant: 'HUD 刻度' }, rows: ROWS, movementMsIds: MOVEMENT_MS }),
      'ms_has_grant 既有 grant 又被 HUD 引用 ⇒ 不是假理由，不该红').toEqual([])
  })
})

describe('旗标账本：写方一出现，条目就该删', () => {
  it('三种形状：有写方 / 没有写方 / written 为空', () => {
    const written = new Map([['flag.has_writer', 'rg_x.interactables(i1).setsFlag']])
    const errs = flagLedgerErrors({
      pending: { 'flag.has_writer': '还没有 setFlag 的对话步', 'flag.no_writer': '等 Phase 6-C' },
      written,
    })
    expect(errs.map((e) => e.key)).toEqual(['flag.has_writer'])
    expect(errs[0].msg).toContain('已有写方（rg_x.interactables(i1).setsFlag）')
    expect(errs[0].msg).toContain('还没有 setFlag 的对话步')
    expect(flagLedgerErrors({ pending: { 'flag.x': 'y' }, written: new Map() })).toEqual([])
    expect(flagLedgerErrors({ pending: {}, written })).toEqual([])
  })
})

describe('今天的真账必须自洽（这条响的那天，就是有人该销账的那天）', () => {
  it('三份名单都不是空的，且每一条都带着理由（判据不许在空集合上空转）', () => {
    for (const [name, ledger] of Object.entries({ PENDING_MILESTONE_GRANTS, UI_BOUND_MILESTONES, PENDING_FLAG_WRITERS })) {
      const keys = Object.keys(ledger)
      expect(keys.length, `${name} 读不到条目 = 这一格在空转`).toBeGreaterThan(0)
      for (const k of keys) expect(ledger[k].trim(), `${name}.${k} 的理由是空的`).not.toBe('')
    }
  })

  it('拿真表喂判据：里程碑两份名单今天没有一条"该销未销"，也没有死 id', () => {
    const prog = readJson<{ milestones: Array<{ id: string; grant?: Record<string, unknown> }> }>('src/data/json/progression.json')
    const mv = readJson<{ slots?: Array<{ milestone?: string } | null> }>('src/data/json/movements.json')
    const referenced = new Set<string>((mv.slots ?? [])
      .map((s) => (s ? s.milestone : undefined)).filter((x): x is string => typeof x === 'string'))
    expect(milestoneLedgerErrors({
      pending: PENDING_MILESTONE_GRANTS, uiBound: UI_BOUND_MILESTONES, rows: prog.milestones, movementMsIds: referenced,
    }), '账上有假理由 ⇒ 见 KI-073').toEqual([])
  })

  /**
   * 旗标这一格判的是**跑起来的校验器**，不在测试里重抄"谁写了这个旗标"的三个来源
   * （worldstate 规则 / 交互物 setsFlag / 对话 setFlags）——重抄一遍就是第二个主人，
   * 它漂的那天这条测试会绿着说谎。校验器一趟约 1 秒，值得。
   */
  it.skipIf(SPAWN_BLOCKED)('跑真校验器：输出里没有一条「这条账该销了」（它出现的那天就是有人忘销账的那天）', () => {
    const r = spawnSync(process.execPath, ['scripts/validate-data.mjs'], { cwd: root, encoding: 'utf8' })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    expect(out, '校验器没给出「总计」那行 = 这一趟没跑成，判据不算跑过').toContain('总计：')
    expect(out.split(/\r?\n/).filter((l) => l.includes('这条账该销了') || l.includes('账上挂着表里没有的里程碑'))).toEqual([])
  })
})
