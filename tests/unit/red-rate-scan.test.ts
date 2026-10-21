import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KINDS, parseResultLine, rateOf, median, resultLine } from '../../scripts/red-rate-scan.mjs'
import type { VerdictKind } from '../../scripts/red-rate-scan.mjs'
import { formatReds, summarizeReds } from '../../scripts/report-reds.mjs'

/**
 * KI-152 的第一条腿：**红率量具的读数自己要有门**。
 *
 * 起因是当场撞上的假读数，不是设想。登记的那条负载旋转红要量 `reds/N`，第一版量具去读
 * `scripts/test.mjs` 打印的那句 `完整报告留在 <tmp>\report.json`；而绿的那条出口把整个临时目录 `rmSync` 掉了，
 * 于是八趟全部 ENOENT，每趟被数成「0 红」，报出 `reds/0`（读数留在 `.scratch/ki152/red-rate.log`）。
 * **零分母和零红长得一样整齐**——那一批没量出「不复现」，只量出了「我没读到」。
 *
 * 修法不是给量具加 sleep，也不是把「读不到」算成绿，而是让跑测器在**每一条终出口**留一行机器可读判决，
 * 并且把印它与读它放在同一份模块里（`red-rate-scan.mjs`，与 `report-reds.mjs` 的 `summarizeReds` ⇄ `formatReds`
 * 同一把手）。这份文件钉四件事：
 * ① 印出来就读得回来（round-trip）；② 读不懂 ⇒ `null` ⇒ 调用方只能算它「不可归因」，不能算 0 红；
 * ③ `rateOf` 对历史那个签名（N 趟全不可归因）必须**拒绝给读数**；
 * ④ 跑测器那边不许有绕过判决行的出口——那条读 HEAD 的 blob，不读工作副本（与 KI-114 / KI-118 同一取舍：
 *    要回答的是「新克隆能不能自证」，不是「我这台机器现在绿不绿」）。
 *
 * 落地顺序因此是**先提交再全量**：这条门读提交面，所以平面上 HEAD 还是父提交时它必然红一次。
 * 那一次红不是噪声，是反面见证——它证的正是「旧跑测器没有判决行」，读数记在 KI-152 那一行里。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

const GIT = (() => {
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
  const err = probe.error ? (probe.error as NodeJS.ErrnoException).code : null
  const top = (probe.stdout ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const here = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (err || top.toLowerCase() !== here.toLowerCase()) {
    console.warn(`[red-rate-scan] 响亮跳过 HEAD 那几条腿：${err ? `spawn git 被当场拒（${err}）` : `这里不是工作树根（${top || 'git 没答'}）`}`)
  }
  return { ok: !err && top.toLowerCase() === here.toLowerCase() }
})()

const headBlob = (p: string): string => {
  const r = spawnSync('git', ['show', `HEAD:${p}`], { cwd: root, encoding: 'utf8' })
  expect(r.error, `git show HEAD:${p} 跑不起来 = 这条判据没跑成，不许拿空串当"没有那种出口"`).toBeUndefined()
  expect(r.status, `读不到 HEAD 的 ${p}（${(r.stderr ?? '').trim().slice(0, 120)}）`).toBe(0)
  return r.stdout ?? ''
}

const row = (kind: VerdictKind, over: Record<string, unknown> = {}) =>
  parseResultLine(resultLine({ kind, reds: 0, total: 16, ranFiles: 1, expectedFiles: 1, redTitles: [], reportKept: false, ...over }))

describe('resultLine ⇄ parseResultLine：印出来就必须读得回来，读不懂就是 null', () => {
  it('七个种类各走一遍 round-trip，字段一个不丢、一个不猜', () => {
    for (const kind of KINDS) {
      const line = resultLine({ kind, reds: 2, total: 16, ranFiles: 3, expectedFiles: 3, redTitles: ['甲', '乙'], reportKept: kind === 'red' })
      const p = parseResultLine(line)
      expect(p, `${kind} 那份印出来读不回来`).toEqual({ kind, reds: 2, total: 16, ranFiles: 3, expectedFiles: 3, redTitles: ['甲', '乙'], reportKept: kind === 'red' })
    }
    expect(KINDS.length, `KINDS 只剩 ${KINDS.length} 个种类 = 判决的种类被删掉了，跑测器那边的出口会解析不动`).toBe(7)
  })

  it('混在人类输出里也要读得到；多条时取最后一条（重跑循环里先印的那些属于被推翻的那几趟）', () => {
    const text = [
      '其余输出无关',
      resultLine({ kind: 'coverage-void', reds: 0, total: 12, ranFiles: 1, expectedFiles: 2, redTitles: [], reportKept: false }),
      '  [test] 第 1 次只跑到 1/2 个文件，重跑…',
      resultLine({ kind: 'green', reds: 0, total: 16, ranFiles: 2, expectedFiles: 2, redTitles: [], reportKept: false }),
    ].join('\r\n')
    expect(parseResultLine(text)?.kind, '取的是最后一条判决').toBe('green')
    expect(parseResultLine(text)?.total).toBe(16)
  })

  it('缺行／坏 JSON／字段缺或类型不对／种类不在册 ⇒ 一律 null：读不懂不是 0 红', () => {
    expect(parseResultLine(''), '空输出').toBeNull()
    expect(parseResultLine('[test] 覆盖核对通过：240 个文件全部跑到，2876 条用例全绿'), '人类那一句不是判决行').toBeNull()
    expect(parseResultLine('[test] RESULT {不是 JSON'), '坏 JSON').toBeNull()
    expect(parseResultLine('[test] RESULT ' + JSON.stringify({ kind: 'green', total: 16, ranFiles: 1, expectedFiles: 1, redTitles: [], reportKept: false })), '少一格计数（调用方漏传 reds）').toBeNull()
    expect(parseResultLine('[test] RESULT ' + JSON.stringify({ kind: 'green', reds: 'emphasised', total: 16, ranFiles: 1, expectedFiles: 1, redTitles: [], reportKept: false })), '计数不是数').toBeNull()
    expect(parseResultLine('[test] RESULT ' + JSON.stringify({ kind: 'green', reds: 0, total: -3, ranFiles: 1, expectedFiles: 1, redTitles: [], reportKept: false })), '负数不是计数').toBeNull()
    expect(parseResultLine('[test] RESULT ' + JSON.stringify({ kind: 'maybe', reds: 0, total: 16, ranFiles: 1, expectedFiles: 1, redTitles: [], reportKept: false })), '种类不在册就是读不懂').toBeNull()
  })
})

describe('rateOf：分母对不上就不进红率，全批不可归因时必须拒绝给读数', () => {
  it('全绿 + 红 混在一起时，reds 数的是红的那几趟，红过的用例名要带着', () => {
    const rows = [
      { mode: 'idle', secs: 6, parsed: row('green'), exit: 0, firsts: [] },
      { mode: 'idle', secs: 7, parsed: row('red', { reds: 1, redTitles: ['真按一次方向键…'] }), exit: 1, firsts: [] },
      { mode: 'idle', secs: 6, parsed: row('green'), exit: 0, firsts: [] },
    ]
    const t = rateOf(rows, { expectTotal: 16, expectFiles: 1 })
    expect([t.runs, t.counted, t.reds], '3 趟里 1 趟红').toEqual([3, 3, 1])
    expect(t.byTitle['真按一次方向键…'], '红过的用例名要能点名').toBe(1)
    expect(t.unusable, '全部可归因 ⇒ 这批有读数').toBeNull()
    expect(t.secsMedian, '中位用时').toBe(6)
  })

  it('把第一版量具那个签名原样喂进去：八趟读不到判决 ⇒ 拒绝给读数，而不是报 0 红', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ mode: 'idle', secs: i, parsed: null, exit: 0, firsts: [] }))
    const t = rateOf(rows)
    expect([t.runs, t.counted, t.reds, t.voids.length], '八趟全不可归因').toEqual([8, 0, 0, 8])
    expect(t.unusable, 'reds/0 不是「0 红」：这一格必须点名零分母').toContain('reds/0')
  })

  it('绿的那趟分母是 0 ⇒ 不可归因；钉住的分母对不上 ⇒ 也不可归因', () => {
    const zero = rateOf([{ secs: 1, parsed: row('green', { total: 0, ranFiles: 0 }) }])
    expect(zero.counted, '一条用例都没收集的"绿"没有内容').toBe(0)
    expect(zero.voids[0].why, '这一格要说清是零分母，不是 0 红').toMatch(/零分母/)
    const shrunk = rateOf([{ secs: 1, parsed: row('green', { total: 15 }) }], { expectTotal: 16 })
    expect(shrunk.counted, '比钉住的那个数少一条 ⇒ 这一趟不能进红率').toBe(0)
    expect(shrunk.voids[0].why).toMatch(/钉住的 16/)
    const fileMismatch = rateOf([{ secs: 1, parsed: row('green', { expectedFiles: 2, ranFiles: 2 }) }], { expectTotal: 16, expectFiles: 1 })
    expect(fileMismatch.counted, '跑到的文件数与盘上推出来的期望不一致 ⇒ 那不是同一个范围').toBe(0)
  })

  it('五种"既不是绿也不是用例红"的出口全部记成不可归因，绝不折成绿', () => {
    const rows = (['suite-red', 'extras', 'coverage-void', 'scope-unmatched', 'no-report'] as VerdictKind[]).map((kind) => ({ secs: 1, parsed: row(kind), firsts: [] }))
    const t = rateOf(rows, { expectTotal: 16, expectFiles: 1 })
    expect([t.counted, t.reds], '五种非绿出口：既不进分母，也不进红数').toEqual([0, 0])
    expect(t.unusable, '整批不可归因时要拒绝给读数').toContain('reds/0')
    expect(t.voids.map((v) => v.why).join('\n'), '每条出口的理由要点名它的种类').toContain('suite-red')
  })

  it('一部分趟次废掉时，报数必须带着真实分母（counted 不是 runs）', () => {
    const rows = [{ secs: 1, parsed: row('green') }, { secs: 1, parsed: null }]
    const t = rateOf(rows, { expectTotal: 16, expectFiles: 1 })
    expect([t.runs, t.counted], '2 趟里只有 1 趟可用').toEqual([2, 1])
    expect(t.unusable, '分母缩了要把话说在前面').toContain('分母只有 1')
  })

  it('median：空集是 null，不是 0（0 会被读成"负载没生效"）', () => {
    expect(median([])).toBeNull()
    expect(median([2, 9, 4])).toBe(4)
    expect(median([2, 4, 9, 11])).toBe(6.5)
    expect(median([1, null, 3]), '非数的那一格要被丢掉，不是把中位拉走').toBe(2)
  })
})

describe('判决与人类那句必须数同一份报告的同一对数（两条读数不许各说各话）', () => {
  it('同一份合成报告喂给 summarizeReds：formatReds 里的两个数 == RESULT 行里的两个数', () => {
    const report = {
      testResults: [
        {
          name: 'D:/repo/tests/unit/who.test.ts',
          assertionResults: [
            { title: '甲', fullName: 'describe 甲', status: 'failed', failureMessages: ['expected 1 to be 2\n    at …'] },
            { title: '乙', fullName: 'describe 乙', status: 'passed' },
            { title: '丙', fullName: 'describe 丙', status: 'failed', failureMessages: ['boom'] },
          ],
        },
        { name: 'D:/repo/tests/unit/quiet.test.ts', assertionResults: [{ title: '丁', fullName: '丁', status: 'passed' }] },
      ],
    }
    const sum = summarizeReds(report, 'D:/repo')
    const human = formatReds(sum)
    const m = /有失败用例：(\d+) 条[^\n]*?这一趟跑了 (\d+) 条/.exec(human)
    expect(m, `人类那句读不出两个数：${human.split('\n')[0]}`).not.toBeNull()
    const machine = parseResultLine(
      resultLine({
        kind: 'red',
        reds: sum.nRed,
        total: sum.total,
        ranFiles: sum.ranFiles,
        expectedFiles: sum.ranFiles,
        redTitles: sum.files.flatMap((f) => f.reds.map((a) => a.name)),
        reportKept: true,
      }),
    )
    expect(machine, '同一份报告的机器读数解析不动').not.toBeNull()
    expect([machine!.reds, machine!.total], '两条读数说的是同一对数').toEqual([Number(m![1]), Number(m![2])])
    expect([machine!.reds, machine!.total], '而这一对数确实是 2 红 / 4 条').toEqual([2, 4])
    expect(human, '点名那几条红用例这件事仍然归 formatReds').toContain('who.test.ts — 2 条')
  })
})

describe('跑测器的唯一出口（读 HEAD 的 blob）：每条终出口都要留下判决', () => {
  it.skipIf(!GIT.ok)('scripts/test.mjs 里 `process.exit(` 只许出现一次，就在 `finish` 里面', () => {
    const src = headBlob('scripts/test.mjs')
    expect(src.length, 'HEAD 的 scripts/test.mjs 读回来是空的 = 这条判据在对空集自证干净').toBeGreaterThan(2000)
    const exits = (src.match(/process\.exit\(/g) ?? []).length
    expect(exits, `跑测器里有 ${exits} 处 process.exit：判决行的门只认唯一出口那一个，多出来的每一条都可能悄悄不印判决`).toBe(1)
    expect(src, '那个唯一的 exit 必须住在 finish 里，否则"出口"就不是出口').toMatch(/function finish\([\s\S]*?process\.exit\(/)
  })

  it.skipIf(!GIT.ok)('七个种类在跑测器里各有至少一条 `finish(…)` 出口，且没有第二种拼写在册', () => {
    const src = headBlob('scripts/test.mjs')
    const emitted = [...src.matchAll(/finish\('([a-z-]+)'/g)].map((m) => m[1])
    expect(emitted.length, `只读到 ${emitted.length} 条 finish 出口 = 抽取形状变了，这条判据在空转`).toBeGreaterThanOrEqual(7)
    expect([...new Set(emitted)].sort(), '每条终出口的种类要与 KINDS 完全同名单').toEqual([...KINDS].sort())
    const calls = (src.match(/resultLine\(/g) ?? []).length
    expect(calls, `finish 里对 resultLine 的调用只读到 ${calls} 处`).toBeGreaterThanOrEqual(1)
  })

  it('KI-152 在账本里有且只有一行（编号不许只在散文里飘着）', () => {
    const src = headBlob('docs/KNOWN_ISSUES.md')
    const rows = src.split(/\r?\n/).filter((l) => /^\|\s*KI-152\s*\|/.test(l))
    expect(rows.length, '账本里没有 KI-152 那一行 = 这条门判的缺陷没登记在册').toBe(1)
    expect(rows[0], '登记的这一行必须说清红率要两种环境各量一遍').toMatch(/红率/)
  })
})
