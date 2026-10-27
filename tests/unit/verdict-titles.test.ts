import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { redTitlesOf, formatReds, summarizeReds } from '../../scripts/report-reds.mjs'
import { parseResultLine, rateOf, resultLine } from '../../scripts/red-rate-scan.mjs'

/**
 * KI-298：**判决行的红名不许被截断**。
 *
 * 病不是设想，是当场量到的：KI-296 的臂电池 A5 那一臂红 **6** 条，而跑测器印的那行判决
 * （`scripts/test.mjs` 里的 `redTitles: …slice(0, 5)`）只给 **5** 个名字 ⇒ 读判决行做归因的量具
 * （`scripts/red-rate-scan.mjs` 的 `byTitle`）把「第 6 条在旋转」读成了「没点名」。
 * **计数与点名是两个分母**：`reds` 仍然数 6 ⇒ 那份读数看着自洽，实际上少了一条。
 *
 * 本批修三件事，各有一只手：
 *   ① **名单的产地唯一**（`scripts/report-reds.mjs` 的 `redTitlesOf`）：它不截断，调用点只负责递出去。
 *   ② **读者侧完整性校验**（`scripts/red-rate-scan.mjs` 的 `parseResultLine`）：点名数必须与 `reds` 相等，
 *      不等就**读不出来** ⇒ 调用方只能算它「不可归因」，不能拿一份少名字的名单做归因。
 *   ③ **调用点不许再截一刀**（下面「调用点」那组腿读跑测器的源码）：单元测试钉的是模块，
 *      模块绿而调用点把名单削短，量具照样会说谎——所以两头各有一只眼。
 *
 * **读源码而不是读 HEAD 的 blob**：这条门问的是「跑测器现在会不会截断判决载荷」，而 CI 跑的就是工作副本；
 * 新鲜克隆的工作副本就是提交进去的字节。读 blob 问的是另一个问题（「新克隆能不能自证」），
 * `tests/unit/red-rate-scan.test.ts` 那几条腿问的正是那件事——两件事各有一只手，别混。
 */

/** 仓库根（带尾分隔符，与本仓其它测试文件同一形状） */
const root = fileURLToPath(new URL('../..', import.meta.url))

/** 跑测器源码（工作副本） */
const runnerSrc = readFileSync(root + 'scripts/test.mjs', 'utf8')

/**
 * 去掉行注释再看结构：注释里写着「原来那句 `.slice(0, 5)`」不该把下面那条判据自己判红。
 * 判据要落在**代码**上，不是落在注释上。
 */
const codeOf = (src: string): string =>
  src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
const runnerCode = codeOf(runnerSrc)

/**
 * 一份合成报告：跨两个文件、**6 条红**（当年那个 `.slice(0, 5)` 恰好切掉第 6 条）＋ 2 条绿的。
 * 合成报告是这套判据能毫秒级反复跑的前提（真跑一趟那一趟是四分钟，见 `tests/unit/gate-report.test.ts` 的头）。
 */
const RED_NAMES = ['甲 红①', '甲 红②', '乙 红③', '乙 红④', '乙 红⑤', '乙 红⑥']
const report = {
  testResults: [
    {
      name: 'D:/repo/tests/unit/who.test.ts',
      assertionResults: [
        { title: '红①', fullName: '甲 红①', status: 'failed', failureMessages: ['boom ①'] },
        { title: '绿', fullName: '甲 绿', status: 'passed', failureMessages: [] },
        { title: '红②', fullName: '甲 红②', status: 'failed', failureMessages: ['boom ②'] },
      ],
    },
    {
      name: 'D:/repo/tests/unit/where.test.ts',
      assertionResults: [
        { title: '红③', fullName: '乙 红③', status: 'failed', failureMessages: ['boom ③'] },
        { title: '红④', fullName: '乙 红④', status: 'failed', failureMessages: ['boom ④'] },
        { title: '红⑤', fullName: '乙 红⑤', status: 'failed', failureMessages: ['boom ⑤'] },
        { title: '红⑥', fullName: '乙 红⑥', status: 'failed', failureMessages: ['boom ⑥'] },
        { title: '绿②', fullName: '乙 绿②', status: 'passed', failureMessages: [] },
      ],
    },
  ],
}
const sum = summarizeReds(report, 'D:/repo')

/** 判决行里那一份载荷（完整的那一份） */
const fullVerdict = () =>
  resultLine({
    kind: 'red',
    reds: sum.nRed,
    total: sum.total,
    ranFiles: sum.ranFiles,
    expectedFiles: sum.ranFiles,
    redTitles: redTitlesOf(sum),
    reportKept: true,
  })

describe('判决行的红名：全量，且截断过的载荷读不出来（KI-298）', () => {
  it('名单是全量：第 6 条红（当年被切掉的那一条）必须在里面', () => {
    // 独立于 summarizeReds 的那个数：直接从原始报告数一遍 status=failed。
    const rawReds = report.testResults
      .flatMap((r) => r.assertionResults)
      .filter((a) => a.status === 'failed').length
    expect(rawReds, '这份合成报告本身就有 6 条红（分母先钉住）').toBe(6)
    expect(sum.nRed, '工具数出来的红条数要与原始报告一致').toBe(6)
    expect(redTitlesOf(sum), '判决行要点的名字必须与报告里的红一条不差、且一个不少').toEqual(RED_NAMES)
    expect(redTitlesOf(sum).length, '名单不许被截断（6 ≠ 5 就是当年那个病）').toBe(6)
  })

  it('印出来就读得回来：6 个名字一个不少', () => {
    const p = parseResultLine(fullVerdict())
    expect(p, '完整的判决行读不回来').not.toBeNull()
    expect(p!.redTitles, '读回来的名单必须是全量').toEqual(RED_NAMES)
    expect(p!.reds, '点名数与红数必须相等（这正是读者侧要校验的那一格）').toBe(6)
  })

  it('截断过的载荷读不出来：点名 5 个而报 6 条红 ⇒ 不可归因，不是「少红了一条」', () => {
    const truncated = resultLine({
      kind: 'red', reds: 6, total: sum.total, ranFiles: sum.ranFiles, expectedFiles: sum.ranFiles,
      redTitles: RED_NAMES.slice(0, 5), reportKept: true,
    })
    expect(parseResultLine(truncated), '被截断的判决行必须读不出来').toBeNull()
    const over = resultLine({
      kind: 'red', reds: 5, total: sum.total, ranFiles: sum.ranFiles, expectedFiles: sum.ranFiles,
      redTitles: RED_NAMES, reportKept: true,
    })
    expect(parseResultLine(over), '点名比计数多同样是分家').toBeNull()
  })

  it('量具的态度：读不出来的那一趟不许被算成 0 红，也不许留下按名归因的读数', () => {
    const t = rateOf(
      [{ secs: 1, parsed: parseResultLine(resultLine({
        kind: 'red', reds: 6, total: sum.total, ranFiles: sum.ranFiles, expectedFiles: sum.ranFiles,
        redTitles: RED_NAMES.slice(0, 5), reportKept: true,
      })) }],
      { expectTotal: sum.total, expectFiles: sum.ranFiles },
    )
    expect(t.counted, '截断过的那一趟不可归因').toBe(0)
    expect(t.reds, '不可归因 ≠ 0 红').toBe(0)
    expect(t.byTitle, '不可归因的那一趟不许留下按名归因的读数（那正是当年那份少名字的表）').toEqual({})
    expect(t.unusable, '这一格必须点名 reds/0').toContain('reds/0')
    expect(t.voids[0].why, '理由要点名「不可归因」').toContain('不可归因')
  })

  it('人类那句与机器那份名单点的是同一批红（当年病根就在这两份读数分家）', () => {
    // **两份读数**：人类那句是 `formatReds`（逐文件逐条印），机器那份是判决行的 `redTitles`。
    // 当年的病正是这两份**分家**了：人类那句点全部，机器那份只点前 5 ⇒ 同一趟红，
    // 眼睛看到的与脚本读到的不一样。所以这一格不是"多钉一遍"，是钉住那件事本身。
    const human = formatReds(sum)
    const named = [...human.matchAll(/^\s*× (.+)$/gm)].map((m) => m[1].trim())
    expect(named, '人类那句要点出 6 条红的名字').toEqual(RED_NAMES)
    expect(named, '人类那份与机器那份必须逐字同序 —— 两份读数分家就是当年那个病').toEqual(redTitlesOf(sum))
  })

  it('正面读数：完整的载荷下，6 条红的按名归因表六个名字都在', () => {
    const t = rateOf(
      [{ secs: 1, parsed: parseResultLine(fullVerdict()) }],
      { expectTotal: sum.total, expectFiles: sum.ranFiles },
    )
    expect(t.counted, '完整的那一趟可归因').toBe(1)
    expect(t.reds, '红的那一趟数 1').toBe(1)
    expect(Object.keys(t.byTitle).sort(), '按名归因表必须六条都在（以前第 6 条会消失）').toEqual([...RED_NAMES].sort())
    expect(t.unusable, '这一批有读数').toBeNull()
  })
})

describe('调用点：跑测器不许在判决载荷上截一刀（KI-298）', () => {
  /** 红的那个出口的载荷块（`finish('red', { … })`） */
  const redExit = /finish\('red',\s*\{[\s\S]*?\n\s*\}\)/.exec(runnerCode)

  it('红的那个出口在跑测器里找得到（先把总体钉住，否则下面的判据在空集合上自证）', () => {
    expect(runnerSrc.length, '跑测器读回来是空的 = 这条判据在对空集自证干净').toBeGreaterThan(2000)
    expect(redExit, "跑测器里读不到 finish('red', …) 那个出口 = 形状变了，这条判据在空转").not.toBeNull()
  })

  it('名单的产地唯一：跑测器从 report-reds 那个模块拿它', () => {
    expect(runnerSrc, '跑测器没有 import redTitlesOf = 名单的产地散了').toMatch(
      /import\s*\{[^}]*\bredTitlesOf\b[^}]*\}\s*from\s*'\.\/report-reds\.mjs'/,
    )
    expect(redExit![0], "红的那个出口没有把名单交给 redTitlesOf").toMatch(/redTitles:\s*redTitlesOf\(sum\)/)
  })

  it('跑测器里每一处 redTitles 的赋值都必须是 redTitlesOf(sum)（不许有第二个产地）', () => {
    const assigned = [...runnerCode.matchAll(/redTitles\s*:\s*([^\n]*)/g)].map((m) => m[1].trim().replace(/,$/, ''))
    expect(assigned.length, '跑测器里一处 redTitles 赋值都没有 = 形状变了，这条判据在空转').toBeGreaterThan(0)
    for (const a of assigned) {
      expect(a, '判决载荷里的红名必须来自 redTitlesOf(sum)：别的写法就是在名单上再动一刀').toBe('redTitlesOf(sum)')
    }
  })

  it('红的那个出口里不许出现截断（slice／splice／shift：削短名单就是那个病）', () => {
    expect(redExit![0], "红的出口里出现了截断 ⇒ 判决载荷被削短 ⇒ 读判决行的量具会把「没点名」读成「没红」")
      .not.toMatch(/\.slice\(|\.splice\(|\.shift\(|\.pop\(/)
  })
})

describe('真跑一趟：跑测器自己在真红的时候印几个名字（KI-298）', () => {
  /**
   * 这一趟在**隔离的根**里跑，不在本仓的 `tests/` 底下。
   *
   * **为什么必须隔离（这不是洁癖，是撞出来的）**：临时那两份故意红的用例只要落在 `tests/` 下面，
   * 就会与别的门撞车——全量套件实测撞过一次（2026-10-28）：`tests/unit/id-table.test.ts` 走交付总体
   * （`scripts/id-scope-rules.mjs` 的 `deliverySurface`）时 `stat` 那个刚被删掉的临时文件
   * ⇒ **ENOENT 抛在收集期** ⇒ 整趟判成 `suite-red`（文件级红，不是用例红）。
   * 病根不在那道门：**任何在套件运行期间往 `tests/` 里写临时文件的腿**都会与
   * 「边走边读那片树」的门撞车（`doc-section-citations`／`requirement-citations`／`filemap-paths`
   * 三道门都逐份读 `tests/` 下的文件）⇒ 写临时文件的那一趟必须住到交付总体外面去。
   *
   * 隔离的办法：**把跑测器整份复制到 `.scratch/` 下的一个临时根**。跑测器的根是从它自己的
   * `import.meta.url` 推出来的（`scripts/test.mjs` 顶上那句）⇒ 复制到哪儿，根就是哪儿。
   * 复制件与原件的差别**只有一处**：vitest 入口的路径（临时根底下没有 `node_modules`）。
   * 那处替换在这条腿里当众验一遍（把替换换回去必须与原件逐字节相同）⇒ 复制件量的是**今天**的
   * 跑测器，不是某一份抄本。
   *
   * **为什么临时根要住在仓里**（`.scratch/` 而不是 `%TEMP%`）：`import 'vitest'` 是按**导入方所在目录**
   * 往上找 `node_modules` 的 ⇒ 临时根住在仓里，它第一跳就落在本仓的 `node_modules` 上；
   * 住到仓外就得再造一份依赖树（ junction 那种删法在本机有前科，不走）。
   */
  const TMP_ROOT = root + '.scratch/ki298-e2e-' + process.pid + '/'
  const TMP_A = 'tests/unit/zz-red-a.test.ts'
  const TMP_B = 'tests/unit/zz-red-b.test.ts'
  /** 跑测器里那一句 vitest 入口（复制件只许改这一处） */
  const VITEST_NEEDLE = "join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')"
  /** 复制件要带齐的东西：跑测器自己 ＋ 它 import 的三个模块 ＋ vitest 的配置与包说明 */
  const COPIED = [
    'scripts/report-reds.mjs',
    'scripts/red-rate-scan.mjs',
    'scripts/test-scope.mjs',
    'vite.config.ts',
    'package.json',
  ]

  it('6 条红 ⇒ 判决行点 6 个名字（跨两份文件：少一个就是当年那个病）', () => {
    // 上面那组腿钉的是模块与调用点的**文本**；这一趟钉的是**行为**：跑测器在真红的时候到底印了几个名字。
    // 代价是几秒（内层那一趟要起一次 vitest）——临时根只活在这一条腿里，跑完就删（finally）。
    const NAMES_A = ['红①', '红②', '红③']
    const NAMES_B = ['红④', '红⑤', '红⑥']
    const mk = (tag: string, names: string[]) =>
      [
        "import { describe, expect, it } from 'vitest'",
        `describe('KI-298 真跑一趟 ${tag}', () => {`,
        ...names.map((c) => `  it('${c}', () => { expect(1).toBe(2) })`),
        '})',
        '',
      ].join('\r\n')

    // 复制件只许改 vitest 入口那一处；改完把那一处换回去，必须与原件逐字节相同。
    const runnerSrc = readFileSync(root + 'scripts/test.mjs', 'utf8')
    const vitestEntry = JSON.stringify((root + 'node_modules/vitest/vitest.mjs').replace(/\\/g, '/'))
    const patched = runnerSrc.replace(VITEST_NEEDLE, vitestEntry)
    expect(patched, '跑测器里读不到那一处 vitest 入口 = 形状变了，这一步没法证').not.toBe(runnerSrc)
    expect(patched.replace(vitestEntry, VITEST_NEEDLE), '复制件与原件的差别必须只有那一处路径').toBe(runnerSrc)

    mkdirSync(TMP_ROOT + 'scripts', { recursive: true })
    mkdirSync(TMP_ROOT + 'tests/unit', { recursive: true })
    writeFileSync(TMP_ROOT + 'scripts/test.mjs', patched, 'utf8')
    for (const rel of COPIED) copyFileSync(root + rel, TMP_ROOT + rel)
    writeFileSync(TMP_ROOT + TMP_A, mk('甲', NAMES_A), 'utf8')
    writeFileSync(TMP_ROOT + TMP_B, mk('乙', NAMES_B), 'utf8')

    let out = ''
    try {
      execFileSync(process.execPath, ['scripts/test.mjs', TMP_A, TMP_B], {
        cwd: TMP_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      // 跑测器在红的时候退 1（那是**对的**退出码）⇒ 输出要从异常里取。
      out = `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}`
    } finally {
      rmSync(TMP_ROOT, { recursive: true, force: true })
    }
    expect(existsSync(TMP_ROOT), '临时根没删掉 = 它会留在证据区里冒充一份交付件').toBe(false)
    const p = parseResultLine(out)
    expect(p, `跑测器的判决行读不出来（没走到终出口？或载荷里的点名数与红数对不上——那正是本条要防的分家）：${out.slice(-400)}`).not.toBeNull()
    expect(p!.kind, '那一趟是红的').toBe('red')
    expect(p!.reds, '红 6 条').toBe(6)
    expect(p!.redTitles.length, '判决行必须点 6 个名字（少一个就是当年那个病）').toBe(6)
    expect(p!.expectedFiles, '内层那一趟只跑那两份临时文件（不是全仓 ⇒ 这条腿量的是隔离根里的行为）').toBe(2)
    // 两份文件的名字**各自**按声明顺序出现（跨文件的先后由 vitest 决定 ⇒ 不钉那一格）。
    const tail = (n: string) => n.split(' ').pop()
    expect(p!.redTitles.filter((n) => n.includes('甲')).map(tail), '第一份文件的红名一个不少，且顺序不乱').toEqual(NAMES_A)
    expect(p!.redTitles.filter((n) => n.includes('乙')).map(tail), '第二份文件的红名一个不少（跨文件丢名字只有这一格看得见）').toEqual(NAMES_B)
  }, 120000)
})
