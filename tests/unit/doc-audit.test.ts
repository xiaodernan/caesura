import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 文档对账闸门（KI-056）。
 *
 * 这一批修的不是代码，是「表里有 = 项目里有」这条系统性失真：架构文档 §2 那张目录表是 Phase 0 的规划
 * （需求 §56「目录已定不得更改」），十余周没和真实 `src/` 核过，于是 `ai/bt/`、`MontagePlayer`、
 * `vfx/GPUParticles` 这些从未存在的路径被下游读成了事实。§2.1 把两边逐条对上了账，
 * 但**一次性的对账必然会再漂**——所以下面这几条判据要能在"改了树、没改文档"的那一刻变红。
 *
 * 判据刻意选得机械（文件名的存在性、状态标签的枚举、过期自述的字面量）：文档的**内容**对不对
 * 只能靠人读（§82），这里守的是**结构**——一个从没被提到过的模块，一定没人核对过它。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const archDoc = readFileSync(root + 'docs/technical-architecture.md', 'utf8')
const issues = readFileSync(root + 'docs/KNOWN_ISSUES.md', 'utf8')
const planDoc = readFileSync(root + 'docs/WORKPLAN.md', 'utf8')

/** 认转义的竖线切分（与门 D 同一把尺子）：`\|` 是内容，不是分格 */
const planCells = (l: string): string[] => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())
/** WORKPLAN 里行首标记的实测拼法（2026-10-23 现量只有 ✅ 与 ⬜ 两种，其余是防"新写法悄悄不进总体"） */
const PLAN_MARK = /^(✅|⬜|🟡|🔵|⏸|❌)/
/** 连续以 `|` 开头的行 ＝ 一张表；段首是表头，紧随其后的 `|---|` 是分隔行，两者都不算数据行 */
function planTables(src: string): Array<{ headLine: number; arity: number; rows: Array<{ n: number; cells: string[] }> }> {
  const lines = src.split(/\r?\n/)
  const segs: Array<Array<{ n: number; l: string }>> = []
  let seg: Array<{ n: number; l: string }> = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('|')) seg.push({ n: i + 1, l: lines[i] })
    else if (seg.length) {
      segs.push(seg)
      seg = []
    }
  }
  if (seg.length) segs.push(seg)
  return segs.map((s) => {
    const sep = /^\|[\s:|-]+$/.test(s[1]?.l ?? '')
    return {
      headLine: s[0].n,
      arity: planCells(s[0].l).length,
      rows: s.slice(sep ? 2 : 1).map((r) => ({ n: r.n, cells: planCells(r.l) })),
    }
  })
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('文档对账闸门（KI-056）', () => {
  it('真实 src/ 树里每一个文件名都必须在架构文档里出现过（新模块必须同时记账）', () => {
    const files = walk(root + 'src')
    const missing = files.filter((f) => !archDoc.includes(f.slice(f.lastIndexOf('/') + 1)))
    expect(
      files.length,
      'src 文件数是 §2.1 那句"事实基线"的出处，变了要同步那一节',
    ).toBeGreaterThan(60)
    expect(missing, `这些模块从没被文档提到过 = 没人对过账：${missing.join(', ')}`).toEqual([])
  })

  it('§2.1 三张对账表必须在，而且带日期（一次性对账不做，就不叫对账）', () => {
    expect(archDoc).toContain('### 2.1 这张表的对账')
    expect(archDoc).toMatch(/A\. 换了载体[\s\S]*B\. 表里的路径不存在，职责也没落[\s\S]*C\. 真树里有/)
    expect(archDoc).toMatch(/### 2\.1 这张表的对账（\d{4}-\d{2}-\d{2}/)
  })

  it('架构文档不许再出现"代码尚未开工"那一类过期自述', () => {
    for (const stale of ['代码尚未开工', '所有运行时条目均为 Planned']) {
      expect(archDoc, `过期声明又回来了：${stale}`).not.toContain(stale)
    }
  })

  it('KNOWN_ISSUES §1.5 的每一行状态标签都必须是 §78 那四个枚举之一', () => {
    const table = issues.split('## 1.5')[1].split('## 2.')[0]
    const rows = table
      .split(/\r?\n/)
      .filter((l) => l.startsWith('| ') && !l.includes('---') && !l.startsWith('| 系统 '))
    expect(rows.length, '状态表行数掉了 = 有人删了整块而不是改一行').toBeGreaterThan(50)
    const legal = ['Implemented', 'Partial', 'Placeholder', 'Blocked']
    const bad = rows
      .map((l) => ({ sys: l.split('|')[1]?.trim(), status: l.split('|')[2]?.trim() }))
      .filter((r) => !legal.includes(r.status ?? ''))
    expect(bad, `非法状态标签（§78 只允许那四个）：${JSON.stringify(bad)}`).toEqual([])
  })

  it('对账里点名的死绑定：每把被占住的键必须有读者，没有读者就必须留一笔 TD（同生同死）', () => {
    expect(archDoc, 'F1/F3/F4 那三块调试面板必须在 §2.1 里读得到（落没落都算账）').toMatch(/EnemyDebugger[\s\S]{0,400}F1/)
    // 判据锚在 TD 表的 ID 列上：只在正文里提一句 "TD-001" 不算在册（第一版就是这样白送的，被变异探针打出来了）
    const tdTable = issues.split('## 2. Technical Debt')[1].split('## 3.')[0]
    const ids = [...tdTable.matchAll(/^\|\s*(TD-\d+)\s*\|/gm)].map((m) => m[1])
    // "死"的判据不是"键还写在 Input 里"——那份清单是**预留表**（`preventDefault` 不让浏览器抢走），
    // 键出现在那儿是应该的。死的是"占着名字没人读"。所以这里查的是读者，而且读者必须是面板本身：
    // 谁往预留表里加一把 F 键又不接面板，这条就会把 TD-001 叫回来。
    const input = readFileSync(root + 'src/core/Input.ts', 'utf8')
    const panels = readFileSync(root + 'src/main.ts', 'utf8') + readFileSync(root + 'src/tools/CombatDebugger.ts', 'utf8')
    // 两侧都要**结构**判据，不能只看字符串出现过：
    // 预留侧锚在 `e.code` 那份名单上，读者侧锚在**绑定**上（`key: 'F1'` / `e.key !== 'F2'`）。
    // 否则"面板拆了但注释里还写着 'F1'"就能骗过这条——探针 D 第一次正是这么漏的。
    const reservedList = input.match(/\[([^\]]*)\]\.includes\(e\.code\)/)?.[1] ?? ''
    // 名册从**预留表自己**抽（KI-315）。原先这里手抄了一份 `['F1','F2','F3','F4']`，于是
    // 「往预留表里加一把 F6、又不给它接读者」恰好从这条门的指缝里漏掉——而上面那句判决写的
    // 正是"谁加一把不接面板就叫回 TD-001"。手抄的候选表做不到那句话，抽出来的才做得到。
    const reserved = [...new Set([...reservedList.matchAll(/'(F\d)'/g)].map((m) => m[1]))].sort()
    const bound = new Set([...panels.matchAll(/(?:key:\s*|\.key\s*[!=]==\s*)'(F\d)'/g)].map((m) => m[1]))
    const unbound = reserved.filter((k) => !bound.has(k))
    expect(reserved.length, '预留表里的 F 键整批被删了 = 这条判据在空转').toBeGreaterThanOrEqual(4)
    expect([...bound], '这些绑定不在预留表里 = 面板接了一把没预留的键（浏览器会把它抢走）')
      .toEqual(expect.arrayContaining(reserved.filter((k) => bound.has(k))))
    if (unbound.length) expect(ids, `这些键占着预留位却没有面板：${unbound.join(' ')} ⇒ TD-001 必须在册`).toContain('TD-001')
    else expect(ids, '每把预留键都有了读者 ⇒ TD-001 必须同时销案，别让文档留着一笔假债').not.toContain('TD-001')
    // TD-002（「按着地图的名字在调音」）已于 2026-10-08 结案：结案方式是**把地图真的落了**
    // （`ui/MapUI.ts` + `map` 键只开地图），不是改键名。所以它和 TD-001 同一条规矩——
    // 不许留在表里当假债，必须在注记里留号。把下面这句翻回 arrayContaining 就是给假债放行。
    expect(ids, 'TD-002 已结案（§43 地图落地）却还留在 TD 表里 = 一笔假债').not.toContain('TD-002')
  })

  it('销案的 TD 留号不留行：一个编号只能待在 TD 表或那段注记里，两边都在 / 两边都不在都算红', () => {
    // 判据形状与上面那条 F1/F3/F4 的门同一来源（KI-058 立的规矩）：**同生同死**。

    // 只查"表里不许有已销案编号"会漏掉另一半——把注记整段删掉也能白得一条绿。
    const td = issues.split('## 2. Technical Debt')[1].split('## 3.')[0]
    const at = td.indexOf('> **销案的债留号不留行**')
    expect(at, 'TD 表下面那段"留号不留行"注记整块不见了 ⇒ 这条判据在读一个空集合').toBeGreaterThan(-1)
    const table = td.slice(0, at)
    const note = td.slice(at)
    const inTable = [...table.matchAll(/^\|\s*(TD-\d+)\s*\|/gm)].map((m) => m[1])
    const retired = [...new Set([...note.matchAll(/~~(TD-\d+)~~/g)].map((m) => m[1]))]
    // 地板从 2 降到 1：TD-002 结案出表后表里只剩 TD-006 一行。这道判据防的是"分母读空"，
    // 一行也不是空——真正该红的是"一行都没有"（抽取器坏了 / 整块被删）。
    expect(inTable.length, 'TD 表一行都没读到 = 分母是空的').toBeGreaterThanOrEqual(1)
    expect(retired.length, '注记里一个销案编号都没读到 = 分子是空的').toBeGreaterThanOrEqual(4)
    const both = retired.filter((id) => inTable.includes(id))
    expect(both, `这些编号已销案却还留在 TD 表里（假债）：${both.join(' ')}`).toEqual([])
    expect(retired, '已销案的编号必须在那段注记里点名（TD-003 = Milestone tag，2026-10-01 结案；TD-002 = §43 地图落地，2026-10-08 结案）').toEqual(
      expect.arrayContaining(['TD-001', 'TD-002', 'TD-003', 'TD-004', 'TD-005']),
    )
  })

  /**
   * KI-113：**不许把"本沙箱连 spawn 子进程都被宿主拒"当作搬判据的理由**。那句话的前提已于 2026-10-11
   * 被当场否证（KI-075 结案：worker 里 `spawnSync(process.execPath, ['-e', …])`、`git rev-parse`、
   * 乃至 spawn 校验脚本本身，三种全部 `error=none / status=0`）。
   *
   * 那些注释的**结论**大多没错——判据确实该住在 `scripts/*-rules.mjs`——但承重的是另一半：
   * `validate-data.mjs` 一被 import 就去校验真表并 `process.exit`。这半句今天仍成立，而且不欠宿主脸色。
   * 留着错理由的代价是它会被**抄下去**：规则模块之间互相指认"同一族理由"，新增模块从邻居那里抄，
   * 于是一条不存在的宿主限制会世代相传。
   *
   * 总体为什么只圈 `scripts/*.mjs`：这条钉的是那句话的**作者面**。测试与账本里同样含"spawn…拒"的几行
   * 是"当时的事实 + 当场否证"的纠正文（`ledger-rules.test.ts`、`text-integrity.test.ts`、
   * `dist-text-scan.test.ts` 的探针），一条字符串判据分不清"复述一个已被否证的说法"和"拿它当理由"，
   * 把那个总体圈进来只会逼人往句子里加豁免标记——那是给假理由化妆。tests/ 与 docs/ 由 KI-113 行里
   * 那条可复跑的 grep 人工复跑。
   *
   * 三道地板与判据出自**同一次扫描**（不是先定一个数再去凑总体）：读不到文件 / 读不到规则模块 /
   * 读不到行 ⇒ 红在地板上，而不是白送一条"0 条命中"的绿。
   */
  it('规则抽取模块的注释不许把"spawn 被宿主拒"当搬判据的理由（KI-113）', () => {
    const files = readdirSync(root + 'scripts').filter((n) => n.endsWith('.mjs')).sort()
    const ruleModules = files.filter((n) => n.endsWith('-rules.mjs'))
    let lines = 0
    const hits: string[] = []
    for (const f of files) {
      readFileSync(`${root}scripts/${f}`, 'utf8').split(/\r?\n/).forEach((l, i) => {
        lines++
        // 两个词落在**同一行**才算：`spawn` 在本仓库同时是玩法词（`regions.json > spawnGroups`），
        // 单独出现不该红；`EBUSY` 单独出现（真去处理一个 spawn 错误码）也不该红。
        if (/spawn/.test(l) && /(被宿主拒|EBUSY)/.test(l)) hits.push(`${f}:${i + 1}  ${l.trim().slice(0, 100)}`)
      })
    }
    expect(files.length, `scripts/*.mjs 只读到 ${files.length} 个 = 总体空了，这条判据在空转`).toBeGreaterThanOrEqual(20)
    expect(ruleModules.length, `只读到 ${ruleModules.length} 个 *-rules.mjs = 扫的不是规则模块那一片`).toBeGreaterThanOrEqual(12)
    expect(lines, `这一次扫描总共只读到 ${lines} 行 = 没读到东西，0 条命中不代表没病`).toBeGreaterThanOrEqual(5000)
    expect(
      hits,
      `这些注释还在拿一条已被实测否证的宿主限制当理由（真理由是"import 即求值 + process.exit"）：\n${hits.join('\n')}`,
    ).toEqual([])
  })

  /**
   * KI-153：**账本的编号第一次有机器读者**。三道门守的是同一件事的两头——
   * **行要解析得出来**（门 C）与**按号引用要读得到行**（门 B），中间夹着**一个号只许对应一笔债**（门 A）。
   *
   * 为什么编号需要机器守：全仓 2607 处 `KI-NNN` 引用散在代码注释、脚本、四份文档里，而登记册是人写的表格。
   * 人写表格会犯三类病，本批**逐类量出来过**：同一个号被两次登记当不同的事（7 对，读者以为它们是同一笔债）、
   * 引用一个从未存在过的号（6 个号 / 34 处，读者按号去找账，找到的是空气）、行尾那两个格子被追加的散文
   * 埋到行中间（6 行 + 23 行未转义竖线 ⇒ 任何按格数解析的读者读出的是垃圾）。
   * 三道门里**任何一道的分母都出自同一次扫描**（行数 / 文件数 / 命中数 / 唯一号数都当场钉下限）：
   * 抽取形状被改坏时红在地板上，不白送一条"0 条命中"的绿。
   */

  /**
   * 重号豁免名册：**按内容身份键控、自我收缩**，与 `scripts/event-rules.mjs` 的 `HEAD_UNDECLARED_LEDGER` 同一形状。
   * 键是那个**号**，不是行号——行号每被追加一次就漂一格，挂在行号上的豁免等于挂在一个自更新的坐标上。
   * **空是常态**：KI-156（2026-10-21）把七对同号不同文逐对挪号之后，这里七格一起删空。
   * 下一次并发追加再撞出一对重号，门 A 当场红；挂格子的人必须写清两行各讲什么，并以
   * **「裁决记在 KI-NNN」**收尾点名一笔**还没结案的挪号债**——下面的判据就从那句里现推那一行，
   * 名册非空而它点名的行写着 Implemented ⇒ 红（同生同死）。硬指某个号（曾经写死 KI-156）会让这道门
   * 在那笔债结案的那一刻变成永久红：往后每一格都只能点一个已结案的号。
   */
  const COLLISION_LEDGER: Record<string, string> = {}

  const ledgerLines = issues.split(/\r?\n/)

  it('门 C：每一行 KI 记录的行尾必须是「| P0..P4 | 词表值 |」，而词表从账本第 3 行现推（不许抄第二份）', () => {
    const vocabLine = ledgerLines.find((l) => l.startsWith('状态词表：'))
    expect(vocabLine, '账本开头那句「状态词表」不见了 ⇒ 状态值没有出处，这条判据该红在出处上而不是白送绿').toBeTruthy()
    const vocab = [...vocabLine!.matchAll(/\*\*([A-Za-z]+)\*\*/g)].map((m) => m[1])
    expect(vocab.length, `从词表行推导出 ${vocab.length} 个值 = 加粗形状被人改写过（§78 的词表不可能只剩两个）`).toBeGreaterThanOrEqual(3)
    expect(vocab, '词表里必须有 Implemented，否则"这件事落了"没有词可以写').toContain('Implemented')

    const rows = ledgerLines
      .map((l, i) => ({ l, n: i + 1 }))
      .filter((r) => /^\|\s*KI-\d{3,4}\s*\|/.test(r.l))
    expect(rows.length, `只读到 ${rows.length} 行 KI 记录 = 分母读空，这道门在看一个空集合`).toBeGreaterThanOrEqual(140)

    const badTail: string[] = []
    const badStatus: string[] = []
    for (const r of rows) {
      const m = /\|\s*P[0-4]\s*\|\s*([A-Za-z]+)\s*\|\s*$/.exec(r.l)
      if (!m) badTail.push(`第 ${r.n} 行 ${/^\|\s*(KI-\d+)\s*\|/.exec(r.l)![1]} 尾部 = 「${r.l.slice(-70)}」`)
      else if (!vocab.includes(m[1])) badStatus.push(`第 ${r.n} 行 ${/^\|\s*(KI-\d+)\s*\|/.exec(r.l)![1]} = ${m[1]}`)
    }
    expect(
      badTail,
      `这些行读不出严重度/状态两格——登记者的散文被追加到了行尾格子**之后**，任何按格数解析的读者（含本仓的 §1.5 那道门）` +
        `读到的都是垃圾。修法是把格子的内容搬回描述格里、行尾只留「| Pn | 状态 |」：\n${badTail.join('\n')}`,
    ).toEqual([])
    expect(
      badStatus,
      `这些状态值不在账本自己声明的词表里（词表 = ${vocab.join('/')}）：${badStatus.join(' ')}` +
        `——「Closed」「Open」是§78 词表之外的自造值，读数时会被当成"不认识所以跳过"`,
    ).toEqual([])
  })

  /**
   * 门 D：账本每一行 KI 记录**按竖线切格要恰好切出四格**（号／描述／P 档／状态），描述栏里的竖线必须是转义形。
   *
   * 它与门 C 不重复：门 C 是**右锚定**的，只保证行尾那两格读得出来；描述栏里多出的裸竖线会把它左边的内容切成
   * 两半，而那句 `…\s*P[0-4]\s*\|…$` 照样匹配。KI-159 登记的 18 行正是这个形状——门 C 全绿而任何按格数解析的读者
   * （§1.5 那道门、外面的表格渲染）读到的都是垃圾。
   *
   * 登记数是 23、本批实修 18，差别是**登记时那道切分不认转义**：23 行里有 5 行早已写成转义形（反斜杠加竖线），
   * 被朴素切分冤枉了。认转义之后真正的病行 18 条，逐行转义完毕，账本里写用转义形的行共 23 条。
   * 下面"载体下限"那一格钉的就是这个区别：把"跳过转义形"这半边判据摘掉，这道门会当场红在这 23 行上，
   * 所以那半边不是装饰。
   */
  it('门 D：每一行 KI 记录按（认转义的）竖线切出来必须恰好是「号｜描述｜P 档｜状态」四格（KI-159）', () => {
    const rows = ledgerLines
      .map((l, i) => ({ l, n: i + 1 }))
      .filter((r) => /^\|\s*KI-\d{3,4}\s*\|/.test(r.l))
    expect(rows.length, `只读到 ${rows.length} 行 KI 记录 = 分母读空，这道门在看一个空集合`).toBeGreaterThanOrEqual(140)

    // 承重的一半是"跳过转义形"：这一趟必须真读到用着转义竖线的行，否则摘掉那个否定后视也照样白得一条绿。
    // 下限取**本批之前**就有的那个数（5 行早已写成转义形），不取本批实测的 23：
    // 否则整本被还原成病态时，红的是这条人口判据，而它本该让位给下面的格位判据去点名那 18 行（KI-159 反面见证量到过）。
    const carriers = rows.filter((r) => /\\\|/.test(r.l))
    expect(
      carriers.length,
      `只读到 ${carriers.length} 行写着转义竖线 = "认转义"这半边判据在看空集合` +
        `（2026-10-21 KI-159 转义完实测 23 行，本批之前 5 行；一门若读不出任何转义形，它就不是在认转义了）`,
    ).toBeGreaterThanOrEqual(5)

    const bad: string[] = []
    for (const r of rows) {
      const id = /^\|\s*(KI-\d{3,4})\s*\|/.exec(r.l)![1]
      // 不筛掉空格：四格 + 首尾两个空段 = 6 段，任何一段错位都要报出来。
      const parts = r.l.split(/(?<!\\)\|/)
      if (parts.length !== 6 || parts[0] !== '' || parts[parts.length - 1] !== '') {
        bad.push(`第 ${r.n} 行 ${id} 切出 ${parts.length} 段（四格应为 6 段）｜尾部「${r.l.slice(-40)}」`)
      } else if (!/^P[0-4]$/.test(parts[3].trim())) {
        bad.push(`第 ${r.n} 行 ${id} 的第三格是「${parts[3].trim()}」而不是 P0..P4 = 描述栏被裸竖线切开，格子整体错位`)
      }
    }
    expect(
      bad,
      `这些行按竖线切不出四格——描述栏里写了裸竖线，任何按格数解析的读者会把描述读成两格。` +
        `修法：把描述栏里的每一个裸竖线写成转义形（反斜杠 + 竖线），代码联合类型与表格引文都照此办理：\n${bad.join('\n')}`,
    ).toEqual([])
  })

  it('门 A：实测的重号集合必须恰好等于豁免名册（多一个红、少一个红都红；名册空了才叫结案）', () => {
    const byId = new Map<string, number[]>()
    ledgerLines.forEach((l, i) => {
      const m = /^\|\s*(KI-\d{3,4})\s*\|/.exec(l)
      if (!m) return
      const id = `KI-${String(Number(m[1].slice(3))).padStart(3, '0')}`
      byId.set(id, [...(byId.get(id) ?? []), i + 1])
    })
    const ids = [...byId.keys()]
    expect(ids.length, `唯一号只读到 ${ids.length} 个 = 抽取形状坏了，下面的相等判据在看一个几乎空的集合`).toBeGreaterThanOrEqual(100)
    const dupes = [...byId.entries()].filter(([, ls]) => ls.length > 1).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    const actual = dupes.map(([id]) => id)
    const booked = Object.keys(COLLISION_LEDGER).sort()
    expect(
      actual,
      `账本上这些号挂着第二行却没在名册里 = 读者以为"一个号一笔债"，实际读到两件事：\n` +
        dupes.map(([id, ls]) => `  ${id}  ← 第 ${ls.join(' / ')} 行`).join('\n') +
        `\n要么逐对裁决谁让号（按提交先后：先落账本的那一行留原号，后落的让号并同步全部按号引用，见 KI-156 那一行的裁决规则），要么在 COLLISION_LEDGER 登记理由；` +
        `名册里有而实际没有的 ⇒ 那一笔已经归一，删格子。`,
    ).toEqual(booked)

    // 同生同死：每一格自己点名它那笔挪号债（「裁决记在 KI-NNN」），那一行必须在册且没结案。
    for (const [id, reason] of Object.entries(COLLISION_LEDGER)) {
      expect(reason.length, `${id} 的豁免理由短到说不出谁欠谁（${reason.slice(0, 40)}…）`).toBeGreaterThanOrEqual(120)
      const hit = /裁决记在\s*(KI-\d{2,4})/.exec(reason)
      expect(hit, `${id} 的豁免理由没以「裁决记在 KI-NNN」点名一笔挪号债 = 白名单没有出处`).toBeTruthy()
      const debt = `KI-${String(Number(hit![1].slice(3))).padStart(3, '0')}`
      const row = ledgerLines.find((l) => new RegExp(`^\\|\\s*${debt}\\s*\\|`).test(l))
      expect(row, `名册挂着 ${id}，理由点名的 ${debt} 在账本里没有那一行 = 白名单挂在一笔不存在的债上`).toBeTruthy()
      const m = /\|\s*P[0-4]\s*\|\s*([A-Za-z]+)\s*\|\s*$/.exec(row!)
      expect(m, `${debt} 那一行自己就读不出状态格 = 这笔债没人能销`).toBeTruthy()
      expect(m![1], `${debt} 已写着 Implemented，豁免名册却还挂着 ⇒ 重号早归一了，名册该删`).not.toBe('Implemented')
    }
  })

  it('门 B：src/tests/scripts/docs 里每一处 KI- 按号引用都必须能在账本读到行（4 位归一成 3 位）', () => {
    const skipDirs = new Set(['node_modules', '.git', '.scratch', 'dist', 'Python', 'artifacts', 'coverage'])
    function walk(dir: string, out: string[] = []): string[] {
      for (const name of readdirSync(dir)) {
        if (skipDirs.has(name)) continue
        const p = `${dir}/${name}`
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(ts|tsx|mjs|md|json)$/.test(name)) out.push(p)
      }
      return out
    }
    const rowIds = new Set(
      ledgerLines
        .map((l) => /^\|\s*(KI-\d{3,4})\s*\|/.exec(l)?.[1])
        .filter((x): x is string => !!x)
        .map((raw) => `KI-${String(Number(raw.slice(3))).padStart(3, '0')}`),
    )
    const SELF = 'docs/KNOWN_ISSUES.md'
    // `root` 自带结尾分隔符（fileURLToPath 给目录 URL 时带尾），所以 rel 从 `root.length` 切，不是 +1。
    // 差一个字符时 SELF 排除失效 = 账本被算进它自己的引用总体（第一次跑就中招，读数报出 `ocs/...`）。
    const relOf = (f: string) => f.slice(root.length).replace(/^[\\/]/, '').replace(/\\/g, '/')
    const surfaces = ['src', 'tests', 'scripts', 'docs']
    const filesPerSurface = new Map<string, number>()
    const unresolved: string[] = []
    let files = 0
    let hits = 0
    const cited = new Set<string>()
    for (const sub of surfaces) {
      let n = 0
      for (const f of walk(root + sub)) {
        const rel = relOf(f)
        if (rel === SELF) continue
        n++
        const body = readFileSync(f, 'utf8')
        for (const m of body.matchAll(/KI-\d+/g)) {
          hits++
          const id = `KI-${String(Number(m[0].slice(3))).padStart(3, '0')}`
          cited.add(id)
          if (!rowIds.has(id)) unresolved.push(`${rel}:${body.slice(0, m.index).split('\n').length} 引 ${m[0]} → ${id} 无行`)
        }
      }
      filesPerSurface.set(sub, n)
    }
    files = [...filesPerSurface.values()].reduce((a, b) => a + b, 0)
    // 四道地板全部出自这一次扫描：某一片总体被扫空时，"0 处未登记"不代表没病。
    expect(files, `引用总体只读到 ${files} 份文件 = 扫描面塌了`).toBeGreaterThanOrEqual(300)
    expect(hits, `这一次只数到 ${hits} 处 KI- 引用 = 命中数低于地板，抽取器大概瞎了`).toBeGreaterThanOrEqual(2000)
    expect(cited.size, `点到的唯一号只有 ${cited.size} 个 = 分母低于地板`).toBeGreaterThanOrEqual(100)
    for (const sub of surfaces) {
      expect(filesPerSurface.get(sub) ?? 0, `${sub}/ 一份文件都没读到 = 那一片整个没进总体，未登记的号可以藏在里面`).toBeGreaterThanOrEqual(1)
    }
    expect(
      unresolved,
      `这些编号被代码/脚本/文档按号引用，而账本里没有那一行 = 读者按号去找账，找到的是空气。` +
        `要么补登记（号 + 严重度 + §78 状态），要么把引用改成它真正指向的那个号：\n${unresolved.join('\n')}`,
    ).toEqual([])
  })

  /**
   * 门 E1（KI-299）：WORKPLAN 的每一行**最多只能有一格的开头是状态标记**。
   *
   * 病不是设想，是本批自己撞出来的：落盘器 `frag()` 用 `.replace(/\s+$/,'')` 把片段尾部的换行一起削掉了，
   * 插行时又是「片段 + needle」直接相接 ⇒ `✅ KI-296` 那一行与 `⬜ 下一批` 那一行被粘成**同一行**（7 格），
   * 而当时这文件里的 11 条门**没有一条读 WORKPLAN**（门 D 只管 KNOWN_ISSUES 的账本行）⇒ 带着病全绿落了地。
   * WORKPLAN 是「下一批做什么」的唯一入口，粘行之后任何按行解析它的读者把第二行的内容读进了第一行的描述栏。
   *
   * 分母先钉：这一趟必须真读到带标记的行首若干行，否则「违规为 0」是空集合给的免费绿（门 D 的载体下限同形）。
   */
  it('门 E1：WORKPLAN 的每一行最多只能有一格的开头是状态标记（两行被粘成一行＝描述栏里又开了一行）（KI-299）', () => {
    const tables = planTables(planDoc)
    const dataRows = tables.flatMap((t) => t.rows)
    const marked = dataRows.filter((r) => PLAN_MARK.test(r.cells[0] ?? '@'))
    expect(
      marked.length,
      `只读到 ${marked.length} 行「第一格是状态标记」的 WORKPLAN 行 = 分母读空，这道门在看一个空集合` +
        `（2026-10-23 本批那行入账后实测 75 行；地板 60）`,
    ).toBeGreaterThanOrEqual(60)

    const glued = dataRows.filter((r) => r.cells.filter((c) => PLAN_MARK.test(c)).length >= 2)
    expect(
      glued,
      `这些行里有两个及以上的行首标记格 = 两行被粘成了同一行（落盘器把片段尾换行削掉就会这样）。` +
        `修法：在两段之间补一个行尾，而不是去改判据：\n${glued.map((r) => `第 ${r.n} 行｜${r.cells.map((c) => c.slice(0, 14)).join(' ┃ ')}`).join('\n')}`,
    ).toEqual([])
  })

  /**
   * 门 E2（KI-299）：WORKPLAN 里**与所在表表头格数不齐**的行必须恰好是登记那八行。
   *
   * 那一族八行（`✅ KI-257`…`✅ KI-271`）住在进度表里（表头 3 格）却只写了两格——「结论」栏从来没写。
   * 本批**不裁这件事**（补哪一栏是 WORKPLAN 的作者说了算），所以这道门不许把 3 写死在断言里冒充判据：
   * 它钉的是「实测不齐集合 ＝ 登记名册」这个相等，两头都红——新添一行不齐的会红（病），
   * 把名册里某一行补齐了也会红（登记过期，逼人来同步）。粘行那一格也会进这个名册（A1 臂实测它同时打中 E1 与 E2）。
   */
  const MISARITY_BOOKED = ['✅ KI-257', '✅ KI-259', '✅ KI-261', '✅ KI-263', '✅ KI-265', '✅ KI-267', '✅ KI-269', '✅ KI-271']
  it('门 E2：WORKPLAN 里与表头格数不齐的行必须恰好是登记那八行（按第一格身份钉；多一行少一行都红）（KI-299）', () => {
    const tables = planTables(planDoc)
    expect(tables.length, `只读到 ${tables.length} 张表 = WORKPLAN 的表格段抽取塌了，下面的名册相等在对空集合`).toBeGreaterThanOrEqual(7)
    const dataRows = tables.flatMap((t) => t.rows)
    expect(dataRows.length, `数据行只读到 ${dataRows.length} 条 = 分母低于地板（2026-10-23 本批那行入账后实测 105 条）`).toBeGreaterThanOrEqual(80)

    const off = tables.flatMap((t) =>
      t.rows
        .filter((r) => r.cells.length !== t.arity)
        .map((r) => `第 ${r.n} 行｜${JSON.stringify(r.cells[0] ?? '')}｜${r.cells.length} 格而表头（第 ${t.headLine} 行）${t.arity} 格`),
    )
    const ids = tables
      .flatMap((t) => t.rows.filter((r) => r.cells.length !== t.arity))
      .map((r) => r.cells[0] ?? '')
      .sort()
    expect(
      ids,
      `这些行的格数和它所在表的表头不一样，而与登记名册不相等。多出来的＝新病行（把缺的那一格补齐）；` +
        `少掉的＝那一笔登记已经还掉了，要同步名册。逐条读数：\n${off.join('\n')}`,
    ).toEqual([...MISARITY_BOOKED].sort())
  })

  /**
   * 门 F（KI-318）：**已经落过盘的架构节不许凭空消失**——「### 5.9.N」的编号名册必须从 1 连续到最大号，
   * 既不许有空洞，也不许一个号两节。
   *
   * 病不是设想，是 2026-10-25→26 量出来的：两笔并发提交把自己父树之外的内容整片扫掉
   * （「git diff --name-only 09bfa4b be3bd0e」实测 15 件，其中 11 件正是 KI-317 那一批改过的同一套），
   * 于是架构里 §5.9.121／§5.9.123／§5.9.124 三节整节不见，§5.9.122 那一节的标题与正文被同号的别一节
   * **覆盖**掉。而当时这文件里的 13 条门**没有一条能读出这件事**：门 A 只数账本号的重号，门 B 只要求
   * 「按号引用能在账本读到行」——这三节的账本行**一直都在**（扫掉的是 WORKPLAN 行与架构节，不是账本行），
   * 所以「账本有行、架构没节」这一整族形状是绿的。门 F 补的就是这一格。
   *
   * 三条自己钉住的规矩：①**分母出自同一次扫描**——地板取 2026-10-26 本批修档后实测的节数往下留的余量，
   * 判决用的 1..max 与它读同一个数组；②**严格针要先证明它没瞎**——只认「### 5.9.N ＋空格＋标题」这一种形状，
   * 所以另数一次宽松针，两者不等就红（标题写歪的节会被严格针漏掉，而那正好会被误判成空洞）；
   * ③**空洞与重号分开判**——修法不同：缺号要把那一节按原号补回，撞号要按「后来者挪号」并把挪走的号的
   * 全库引用一起同步（同一把尺子见账本号的门 A）。
   */
  it('门 F：架构里已落盘的「### 5.9.N」编号名册必须从 1 连续到最大号，无空洞也无重号（KI-318）', () => {
    const strict = [...archDoc.matchAll(/^### 5\.9\.(\d+) /gm)].map((m) => Number(m[1]))
    const loose = archDoc.match(/^### 5\.9\.\d+/gm) ?? []
    expect(
      strict.length,
      `宽松针读到 ${loose.length} 节「### 5.9.N」而严格针只读到 ${strict.length} 节 ⇒ 有 ${loose.length - strict.length} 节的标题形状不对` +
        `（大概是号后面少了那个空格），这道门的针先瞎了，下面的名册判决不作数`,
    ).toBe(loose.length)
    expect(
      strict.length,
      `只读到 ${strict.length} 节 §5.9.N = 分母读空，这道门在看一个空集合` +
        `（2026-10-26 KI-318 修完档实测 126 节，地板 120 就是从那一次扫描留的余量）`,
    ).toBeGreaterThanOrEqual(120)

    const top = Math.max(...strict)
    const holes: number[] = []
    for (let n = 1; n <= top; n++) if (!strict.includes(n)) holes.push(n)
    expect(
      holes,
      `架构的 §5.9.N 名册在 1..${top} 里缺这些号：[${holes.join(',')}] = 那一节已经落过盘又凭空消失了。` +
        `这一族的成因不是「谁删了它」，而是并发提交拿旧的树写了新的一笔：WORKPLAN 与 KNOWN_ISSUES 的行可能还在，` +
        `所以门 A／门 B 读不出。修法：把那一节按原号补回（不要拿后面的号往前挪填洞——挪号要同步全库按号引用），` +
        `实在该消失的就整节改登进账本并说明为什么`,
    ).toEqual([])

    const dup = [...new Set(strict.filter((n, i) => strict.indexOf(n) !== i))]
    expect(
      dup,
      `这些号在架构里各出现两次：[${dup.join(',')}] = 两批各自把「§5.9.那一号」当成自己的节，` +
        `后来者写下的内容把先到者那一节**覆盖**或并列。裁决按门 A 同一口径：给后落地那一节挪一个新号` +
        `（取 max＋1），并同步它自己那一节内的引用；先落地那一节的字节不许动`,
    ).toEqual([])
  })
})
