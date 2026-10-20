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
    const reserved = ['F1', 'F2', 'F3', 'F4'].filter((k) => reservedList.includes(`'${k}'`))
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
   * 每条理由必须点名 KI-156（那笔"逐对挪号"的债）并长到说得清谁欠谁；名册非空时 KI-156 不许写 Implemented（同生同死）。
   * 名册为**空**是目标态：号一旦归一，格子当场消失；下一次多出一对重号就红。
   */
  const COLLISION_LEDGER: Record<string, string> = {
    'KI-113':
      '同号两行讲的是两件事：一行是「规则抽取注释里那句 spawn 被宿主拒的前提已被实测否证」的文档债，另一行是「灰盒世界被 Phase 1 练习场遗迹压在身下、用户实机报告场景太黑」的那次修复。' +
        '两半都有活读者（前者被本文件的判据与 module-loader 的注释点名，后者的 ②③ 被 HUD 与 Objectives 的注释点名），所以谁让号不是能就地判的事；逐对裁决与引用同步记在 KI-156。',
    'KI-114':
      '同号两行讲的是两件事：一行是「主干在自己的平面上过不了自己的 lint——发射方进提交面而类型前提住在别人未提交的文件里」，另一行是「无面童线步 3《容器》的圣所环链」。' +
        '前一行的形状被 `scripts/event-rules.mjs`、`tests/unit/{event-rules,module-loader,audio-engine}.test.ts` 与架构 §5.9.48 反复按号引用，改它要连那五处一起改；本批只登记，裁决与挪号记在 KI-156。',
    'KI-135':
      '同号两行讲的是两件事：一行是「玩家开局站在一片黑上——地板灰盒没接到开局那批 chunk 事件，teleport 发完事件时 ChunkGreybox 还没订阅」，另一行是「Phase B4 三件套（贴花／拖尾／发射器）有人听、没人说，三张配置表没有写方」。' +
        '两半都活着且各带一份测试（greybox-boot-order 与 vfx-wiring），源于同一次并发追加时没查在册号；挪号要连 `src/vfx/**`、`src/main.ts` 那二十多处按号引用一起改，全在并发会话手上。裁决记在 KI-156。',
    'KI-136':
      '同号两行讲的是两件事：一行是「交互提示只说区域名、不说你要跟谁说话」的引导缺口，另一行是「`vfx.json` 九行配置里五行还没有读者，正是 §55／KI-047 那条无消费方的数据不许入表」。' +
        '两行各自写着本批完工的读数，读者无法从号判断哪一笔是它，也不许合并成一笔（那会丢掉一半证据）。不代修别人手上的行：挪号得连按号引用逐处同步，那需要单独一批。裁决记在 KI-156。',
    'KI-137':
      '同号两行讲的是两件事：一行是「对话框的视口走查第一次做了，抓到一处内部英文词漏到玩家面前」，另一行是「玩家醒来知道要干什么却不知道往哪走，于是目标指示 Objectives 第一次有承载体」。' +
        '第二行是 `src/quest/Objectives.ts`、`src/ui/Hud.ts`、架构文件地图那一格按号点名的承重行，第一行是视口走查的读数；两行都得活着，所以让号这件事不能就地判。裁决与逐处引用同步记在 KI-156。',
    'KI-138':
      '同号两行讲的是两件事：一行是「调音桩面板六页的视口走查，结论是没找到缺陷但数字从此在账上」，另一行是「§8.2 任一维触及 35 那一行里程碑的机制腿第一次落下来」。' +
        '这一对与 KI-135/136/137 同源于 2026-10-20 那一次并发追加（两个人同时往账本尾部取号），四格的理由同源、删除条件同一条：号归一的那一刻一起删。裁决记在 KI-156。',
    'KI-140':
      '同号两行讲的是两件事：一行是「KI-010 那一格的浏览器半边走完：休垒→破拍营地→钟坠院→未竟厅，每段都有画面、chunk 数不涨、零脚本错误」，另一行是「五条任务线共 25 步，哪一步只有一行 label 而没有台词接它从未被单独量过」。' +
        '两行都带未结案的剩余（走查的像素/听感半边与任务线的台词覆盖各自还有腿），合并会让任一半读数失去出处。逐对挪号与引用同步记在 KI-156，本批只登记。',
  }

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
        `\n要么逐对裁决谁让号（把号改到没被引用过的那一行并同步全部按号引用，见 KI-156），要么在 COLLISION_LEDGER 登记理由；` +
        `名册里有而实际没有的 ⇒ 那一笔已经归一，删格子。`,
    ).toEqual(booked)

    for (const [id, reason] of Object.entries(COLLISION_LEDGER)) {
      expect(reason.length, `${id} 的豁免理由短到说不出谁欠谁（${reason.slice(0, 40)}…）`).toBeGreaterThanOrEqual(120)
      expect(reason, `${id} 的豁免理由没点名 KI-156 = 一笔没有出处的白名单`).toContain('KI-156')
    }
    // 同生同死：名册非空 ⇒ 那笔"逐对挪号"的债必须在册且没结案。
    if (booked.length > 0) {
      const row = ledgerLines.find((l) => /^\|\s*KI-156\s*\|/.test(l))
      expect(row, `名册挂着 ${booked.length} 笔重号，而账本里没有 KI-156 那一行 = 白名单挂在一笔不存在的债上`).toBeTruthy()
      const m = /\|\s*P[0-4]\s*\|\s*([A-Za-z]+)\s*\|\s*$/.exec(row!)
      expect(m, 'KI-156 那一行自己就读不出状态格 = 这笔债没人能销').toBeTruthy()
      expect(m![1], 'KI-156 已写着 Implemented，豁免名册却还挂着 ⇒ 重号早归一了，名册该删').not.toBe('Implemented')
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
})
