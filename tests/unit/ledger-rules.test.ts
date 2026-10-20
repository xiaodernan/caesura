import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  flagLedgerErrors, hasMilestoneLeg, milestoneLedgerErrors, statusLedgerErrors,
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
 * 这条判据**在进程内跑**校验器，所以它的存废不再取决于宿主让不让 spawn 子进程。
 * KI-075 当年登记的是"本沙箱 vitest worker 内部 spawn 一律回 `EBUSY`"，老写法因此只能探一次再 `skipIf`；
 * 那个前提在 2026-10-11 被当场否证——worker 里 `spawnSync(process.execPath, ['-e', …])`、`git rev-parse`、
 * 乃至 spawn 校验脚本本身，三种全部 `error=none / status=0`（一次性探针，用完即删）。
 * **换路不是为了绕开一条已经不存在的限制**，而是不再让这道门看宿主的脸色：校验脚本一被求值就跑校验、
 * 末尾 `process.exit(errTotal > 0 ? 1 : 0)`，把 `process.exit` 换成"记下退出码再抛"、把 `console.log`
 * 收进缓冲区，拿到的就是命令行上那份读数（一趟约 0.4s）。
 *
 * 一个 worker 里只能跑**一趟**：ESM/Vite 按 URL 缓存模块，同一 URL 第二次 `import()` 不再求值，
 * 于是它读到的是第一趟那一刻的磁盘。给 URL 加 query 击穿缓存在这台机器上**不通**，两种写法都试过：
 * 模板拼 query ⇒ vite 报 `Unknown variable dynamic import`（它去静态解析那个 pattern）；
 * `file://` URL ⇒ vite 不还原百分号，CJK 路径直接 load 不到。所以这里不是"缓存无关紧要"，
 * 是**判据不假设第二趟**——第二趟的读数会谎报"这是此刻的表"。上面那条计数就是给这件事站岗的：
 * 谁将来在这里加第二次调用，当场红，而不是悄悄拿到一份旧报告。要重跑就换进程
 * （`npx vitest run` 一趟一个进程，下面的变异见证正是这么做的）。
 */
const EXIT_SENTINEL = new Error('__validate-data-exit__')
// 走变量而不是字面量：校验脚本是 JS，没有 .d.ts，字面 specifier 会让 `tsc --noEmit` 报 TS7016
// （门就是 lint，红的是这道门而不是这条判据）。路径写错的代价由判据自己收——读不到「总计」那行就是红。
const VALIDATOR_SPEC = '../../scripts/validate-data.mjs'
let validatorRuns = 0

async function runValidator(): Promise<{ code: number | null; out: string }> {
  if (validatorRuns++ > 0) {
    throw new Error('同一个 worker 里第二次 import 校验器 = 读的是 ESM 缓存，不是此刻的磁盘 ⇒ 判据要的是后者')
  }
  const lines: string[] = []
  const realLog = console.log
  const realExit = process.exit
  let code: number | null = null
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')) }
  process.exit = ((c?: number) => {
    code = c ?? 0
    throw EXIT_SENTINEL
  }) as typeof process.exit
  try {
    await import(VALIDATOR_SPEC as string)
  } catch (e) {
    if (e !== EXIT_SENTINEL) throw e // 脚本自己崩了 ⇒ 让它红到底，别冒充"跑过了"
  } finally {
    console.log = realLog
    process.exit = realExit
  }
  return { code, out: lines.join('\n') }
}

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

describe('状态名册的三张派生表（KI-076）：少一行是崩，多一行是谎', () => {
  const roster = ['fissure', 'mute']
  const fields = { fissure: ['tag'], mute: ['tag'] }
  const specs = { fissure: { maxLayers: { min: 2 } }, mute: {} }

  it('三张表同一批行 ⇒ 一声不响', () => {
    expect(statusLedgerErrors({ roster, fields, specs })).toEqual([])
  })

  it('名册加了态而白名单/取值表没跟上 ⇒ 各报一条，并且说清"不报的话校验器会当场崩在那一格"', () => {
    const e = statusLedgerErrors({ roster: [...roster, 'echo'], fields, specs })
    expect(e.map((x) => x.key)).toEqual(['echo.字段表', 'echo.取值表'])
    expect(e[0].msg, '措辞要说清代价：假红一片，而且在没有兜底的那一版里是整份报告消失').toContain('不认的字段')
  })

  it('白名单/取值表里留着名册没有的态 ⇒ 那是条该销的死派生（KI-073 同族）', () => {
    const e = statusLedgerErrors({ roster, fields: { ...fields, ghost: ['tag'] }, specs: { ...specs, stale: {} } })
    expect(e.map((x) => x.key)).toEqual(['STATUS_FIELDS.ghost', 'STATUS_SPECS.stale'])
    expect(e[0].msg).toContain('该销')
  })

  it('表读成 undefined ⇒ 判据自己不许是那个崩溃点；名册读不到 ⇒ 报"空转"而不是"全部该销"', () => {
    expect(statusLedgerErrors({ roster, fields: undefined as unknown as Record<string, string[]>, specs }).map((x) => x.key))
      .toEqual(['fissure.字段表', 'mute.字段表'])
    const noRoster = statusLedgerErrors({ roster: undefined as unknown as string[], fields, specs })
    expect(noRoster.map((x) => x.key), '主人没了就说主人没了：把三张派生表全判成"该销"是一句谎')
      .toEqual(['STATUS_IDS'])
    expect(noRoster[0].msg).toContain('空转')
  })
})

describe('今天的真账必须自洽（这条响的那天，就是有人该销账的那天）', () => {
  it('里程碑与承载体两份名单必须非空；旗标那份**允许为空**——空就是"没有欠账"', () => {
    // 两份"需求要的效果还没有腿"的账永远有内容（做下去还会一直有），所以它们不设空集豁免。
    for (const [name, ledger] of Object.entries({ PENDING_MILESTONE_GRANTS, UI_BOUND_MILESTONES })) {
      const keys = Object.keys(ledger)
      expect(keys.length, `${name} 读不到条目 = 这一格在空转`).toBeGreaterThan(0)
      for (const k of keys) expect(ledger[k].trim(), `${name}.${k} 的理由是空的`).not.toBe('')
    }
    // 旗标那一份是 KI-041 那批"只有读方、没有写方"的**待办清单**：KI-091 销掉最后一条之后它是空的，
    // 而空就是目标状态（新长出来的条目照样要带理由：上面 `flagLedgerErrors` 那几条用例用的是合成账本，
    // 所以"集合空"不等于"判据在空转"）。这一格故意不设下限：写死"必须为空"会让它变成一句没人敢碰的谎。
    for (const k of Object.keys(PENDING_FLAG_WRITERS)) {
      expect(PENDING_FLAG_WRITERS[k].trim(), `PENDING_FLAG_WRITERS.${k} 的理由是空的`).not.toBe('')
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
   *
   * 三条判据各管一件事，缺一不可：`总计：` 那行证明**读到了报告尾部**（拿不到输出的写法一律不算跑过），
   * 句子名单证明**账自洽**，`code !== null` 证明这趟走到了脚本的**最后一行**而不是中途抛断——
   * 前两条都在内容上说话，只有第三条管"到底跑完没有"。
   *
   * **预算（2026-10-20 补）**：这条真跑一遍校验器，**空载约 4.1 s**，**有并发车道在跑全量与覆盖率时超过 9 s**
   * （实测两次：一次整文件用时 9.4 s、一次默认 5000 ms 预算直接超时红）。**默认预算比它量的活还小**，
   * 于是"别人在干活"会把这条门弄红——**红的不是账，是预算**。按仓库里其它重测的写法（`combat.test.ts`
   * 的 20000/30000）给它一条显式预算：**门红要红在内容上，不许红在排队上**。
   */
  it('跑真校验器（进程内）：输出里没有一条「这条账该销了」（它出现的那天就是有人忘销账的那天）', async () => {
    const { code, out } = await runValidator()
    const total = out.split(/\r?\n/).find((l) => l.includes('总计：'))
    expect(total, '校验器没给出「总计」那行 = 这一趟没跑成，判据不算跑过').toBeTruthy()
    expect(out.split(/\r?\n/).filter((l) => l.includes('这条账该销了') || l.includes('账上挂着表里没有的里程碑')
      || l.includes('.字段表') || l.includes('.取值表')), 'KI-076 起：状态名册那两张派生表也归这条判据管').toEqual([])
    expect(code, `没走到那句 process.exit ⇒ 这趟在半路就断了，读到的东西不算一份报告（读到的总计行：${JSON.stringify(total)}）`).not.toBeNull()
  }, 30000)
})
