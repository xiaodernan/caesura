import { describe, expect, it } from 'vitest'
import { formatReds, summarizeReds } from '../../scripts/report-reds.mjs'

/**
 * 门禁自己的读数要有断言钉着（KI-072）。
 *
 * 起因是一份读数说谎：`node scripts/test.mjs` 失败时印「N 条用例 / M 个文件」，那个 `M` 取的是
 * vitest 报告里的 `numFailedTestSuites`——它数的**不是文件**。同一份报告实测：88 个文件里含红用例的
 * 只有 5 个，而它报 11；于是每一批红的归属都要再花四分钟跑一趟裸 vitest 才知道是谁，
 * 而那个错数已经进了上一批的文档。
 *
 * 判据全部走**合成报告**（毫秒级、可控到个位数）：真跑一趟的那条证人挂在 `tests/flow` 之外做不了
 * （它要四分钟），所以这里钉的是"数错了没有、点到名没有"，实测部分记在 KNOWN_ISSUES 的 KI-072 行里。
 */

const ROOT = 'D:\\法环游戏'
const red = (name: string, msg: string) => ({
  fullName: name, title: name, status: 'failed', failureMessages: [msg],
})
const ok = (name: string) => ({ fullName: name, title: name, status: 'passed', failureMessages: [] })
const file = (n: number, results: unknown[]) => ({ name: `${ROOT}\\tests\\unit\\f${n}.test.ts`, assertionResults: results })

describe('summarizeReds：红的归属从报告里数出来，不从 suite 计数里猜', () => {
  it('五只文件各红几条 ⇒ 条数与文件数都是数出来的，且点名到用例', () => {
    const json = {
      numFailedTests: 16, numFailedTestSuites: 11,
      testResults: [
        file(1, [red('a 1', 'AssertionError: 第一条'), red('a 2', 'Error\n  at deep/stack')]),
        file(2, [red('b 1', 'AssertionError: x')]),
        file(3, [ok('c 1'), ok('c 2')]),
        file(4, [red('d 1', ''), red('d 2', 'Boom')]),
        file(5, [red('e 1', 'AssertionError: y')]),
        { name: `${ROOT}/tests/unit/f6.test.ts`, status: 'fail', assertionResults: [] }, // 文件级失败：一条用例都没红
      ],
    }
    const s = summarizeReds(json, ROOT)
    expect(s.nRed, '红的条数').toBe(6)
    expect(s.files.length, '含红的文件数：数出来是 4 条红文件 + f6 没红用例 ⇒ 4，而不是 suite 计数那个 11')
      .toBe(4)
    expect(s.total, '跑过的用例总数（含绿的）').toBe(8)
    expect(s.files.map((f) => f.file), '路径要折成仓库相对的、正斜杠的（这份输出要能 grep）')
      .toEqual(['tests/unit/f1.test.ts', 'tests/unit/f2.test.ts', 'tests/unit/f4.test.ts', 'tests/unit/f5.test.ts'])
    expect(s.files[0].reds.map((r) => r.name)).toEqual(['a 1', 'a 2'])
    expect(s.files[0].reds[0].first).toBe('AssertionError: 第一条')
    expect(s.files[1].reds[0].first).toBe('AssertionError: x')
    expect(s.files[2].reds[0].first, '没有 message 也不能崩，给空串').toBe('')
  })

  it('每条读数只取 message 的第一行非空文本、并截到 200 字符（堆栈留在留在原地的那份报告里）', () => {
    const s = summarizeReds({
      testResults: [file(1, [
        red('多行', 'AssertionError: 第一行\n    at D:\\法环游戏\\tests\\unit\\f1.test.ts:9:9\n    at more'),
        red('超长', '开'.repeat(300)),
        red('空 message', ''),
        red('只有空行', '\n\n   \n  at x'),
      ])],
    }, ROOT)
    expect(s.files[0].reds.map((r) => r.first), '四格各自的答案：首行 / 截断 / 空串 / 跳过空行').toEqual([
      'AssertionError: 第一行',
      '开'.repeat(200),
      '',
      '  at x',
    ])
    expect(s.files[0].reds[0].first, '读数里不许出现换行：那会把"一条一行"的门禁输出撑成一段堆栈').not.toContain('\n')
  })

  it('全绿 ⇒ 一条都不点名（那条"文件级失败但没有红用例"的报告不许被读成用例红）', () => {
    const s = summarizeReds({ testResults: [file(1, [ok('a')]), { name: 'x', assertionResults: [] }] }, ROOT)
    expect(s.nRed).toBe(0)
    expect(s.files).toEqual([])
    expect(s.ranFiles, '跑过几只文件是另一件事，不受红不红影响').toBe(2)
  })

  it('报告缺字段也不许崩（门禁在红的时候最不该再添一种崩）', () => {
    expect(summarizeReds(undefined, ROOT).nRed).toBe(0)
    expect(summarizeReds({}, ROOT).total).toBe(0)
    expect(summarizeReds({ testResults: [{}] }, ROOT).nRed, '一条 assertionResults 都没有的文件').toBe(0)
    expect(summarizeReds({ testResults: [file(1, [{ status: 'failed' }])] }, ROOT).files[0].reds[0].name)
      .toBe('(无名用例)')
  })

  it('格式化后的输出把"几条 / 几个文件"放在第一行，并且逐条点到名字', () => {
    const s = summarizeReds({ testResults: [file(1, [red('甲 1', 'AssertionError: 1 应为 2')])] }, ROOT)
    const text = formatReds(s)
    expect(text.split('\n')[0]).toContain('1 条 / 1 个含红文件')
    expect(text, '文件名单独一行').toContain('tests/unit/f1.test.ts — 1 条')
    expect(text, '用例点名').toContain('× 甲 1')
    expect(text, '第一条读数跟着名字走').toContain('AssertionError: 1 应为 2')
    expect(text).not.toMatch(/\\/)
  })
})
