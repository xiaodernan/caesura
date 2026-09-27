import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeScope, matchesFilter, positionalFilters, scopeOf } from '../../scripts/test-scope.mjs'

/**
 * 跑测器的**期望集**要有证人（KI-078）。
 *
 * 起因：`scripts/test.mjs` 拿磁盘全量名册当期望集，于是任何带范围的调用都会「跑到 47 / 名册 91 ⇒
 * 判成漏跑」，重跑三次后红，而它给的建议「改用更小的范围」正是同一条会失败的命令。
 * `package.json` 里那条 `test:flow` 从写下来起就没绿过——今天实测复现。
 *
 * 判据全走合成名册（毫秒级、能把边界摆到个位数），再加一条**读真磁盘**的对账：
 * "复刻 vitest 的筛选语义"这件事不能只由我自己说了算，所以要拿真名册量一次形状。
 * vitest 自己同不同意我这份复刻，证人在 KI-078 行的实测里（同一份筛选器跑真 vitest，比对它跑到的文件集）。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const f = (rel: string) => `${ROOT}/tests/${rel}`.replace(/\//g, '\\')
const DISK = [
  f('unit\\gate-report.test.ts'),
  f('unit\\audio-music.test.ts'),
  f('flow\\grid-audio.test.ts'),
  f('flow\\bells.test.ts'),
]

describe('positionalFilters：哪些参数算范围', () => {
  it('裸路径算筛选器，`-` 开头的都不算', () => {
    expect(positionalFilters(['tests/flow'])).toEqual(['tests/flow'])
    expect(positionalFilters(['--watch', 'tests/unit'])).toEqual(['tests/unit'])
    expect(positionalFilters([])).toEqual([])
    expect(positionalFilters(undefined)).toEqual([])
  })

  it('吃值选项后面那一格不是路径（`-t 遮挡` 不许被当成"筛不到文件的范围"）', () => {
    expect(positionalFilters(['-t', '遮挡', 'tests/flow'])).toEqual(['tests/flow'])
    expect(positionalFilters(['--testNamePattern', '名字'])).toEqual([])
    // 等号写法整个 token 都是选项，值不占下一格：后面的路径仍然是筛选器
    expect(positionalFilters(['--reporter=json', 'tests/flow'])).toEqual(['tests/flow'])
    expect(positionalFilters(['--reporter', 'json'])).toEqual([])
  })

  it('多个位置参数一起算（vitest 那边是"任一命中"，不是"逐条收窄"）', () => {
    expect(positionalFilters(['tests/unit', 'tests/flow'])).toEqual(['tests/unit', 'tests/flow'])
  })
})

describe('scopeOf：期望集 = 磁盘名册 ∩ 筛选器', () => {
  it('没有筛选器 ⇒ 全量名册，且明确"这一趟不带范围"', () => {
    const s = scopeOf(DISK, [], ROOT)
    expect(s.scoped).toBe(false)
    expect(s.expected).toEqual(DISK.map((p) => p.replace(/\\/g, '/')))
    expect(s.unmatched).toEqual([])
  })

  it('`tests/flow` 只圈 flow 那两只（子串语义，不是同级通配）', () => {
    const s = scopeOf(DISK, ['tests/flow'], ROOT)
    expect(s.scoped).toBe(true)
    expect(s.expected.map((p) => p.split('/').slice(-2).join('/'))).toEqual(['flow/grid-audio.test.ts', 'flow/bells.test.ts'])
    expect(s.unmatched).toEqual([])
  })

  it('大小写与反斜杠都不影响判定（vitest 在 win32 先把筛选器折成正斜杠）', () => {
    expect(scopeOf(DISK, ['TESTS/FLOW'], ROOT).expected.length).toBe(2)
    expect(scopeOf(DISK, ['tests\\flow'], ROOT).expected.length).toBe(2)
    expect(scopeOf(DISK, ['gate-report'], ROOT).expected.length).toBe(1)
  })

  it('多个筛选器取并集', () => {
    expect(scopeOf(DISK, ['gate-report', 'bells'], ROOT).expected.length).toBe(2)
  })

  it('圈空的筛选器**不静默**：期望集空 + 点名是哪几个', () => {
    const s = scopeOf(DISK, ['tests/nope'], ROOT)
    expect(s.unmatched).toEqual(['tests/nope'])
    expect(s.expected, '圈空了却给一个非空期望集 = 把"没跑任何文件"洗成"跑齐了"').toEqual([])
  })

  it('通配写法今天圈不到东西（因为 vitest 的筛选器是子串而不是 glob）——所以这条路是响亮报错，不是全绿', () => {
    const s = scopeOf(DISK, ['*.test.ts'], ROOT)
    expect(s.unmatched).toEqual(['*.test.ts'])
  })

  it('两个筛选器一个中一个不中 ⇒ 只点名不中的那一个，中那个照常圈', () => {
    const s = scopeOf(DISK, ['bells', 'nope'], ROOT)
    expect(s.unmatched).toEqual(['nope'])
    expect(s.expected, '有一条圈空 ⇒ 整趟先停下来，不许拿半截期望集去判"跑齐了"').toEqual([])
  })
})

describe('matchesFilter：绝对路径的筛选器先折成仓库相对，再走同一条子串判定', () => {
  it('绝对路径筛选器圈得中自己下面的文件（`C:` 那种跨根的分支今天没有证人，见 `test-scope.mjs` 注释）', () => {
    const abs = `${ROOT}\\tests\\flow\\bells.test.ts`.replace(/\//g, '\\')
    expect(matchesFilter(f('flow\\bells.test.ts'), abs, ROOT)).toBe(true)
    expect(matchesFilter(f('unit\\bells.test.ts'), abs, ROOT), '前缀匹配不许越到别的目录').toBe(false)
  })

  it('目录形状带尾斜杠 ⇒ 匹配的是那一层下面，而不是同名文件的字符串包含', () => {
    expect(matchesFilter(f('flow\\bells.test.ts'), 'tests/flow/', ROOT)).toBe(true)
    expect(matchesFilter(f('unit\\bells.test.ts'), 'tests/flow/', ROOT), '尾斜杠那一层不许越到别的目录').toBe(false)
    // 同一只文件在"目录名恰好是文件名前缀"这种形状下也不该被圈进来：`bells` 与 `bells/` 是两回事
    expect(matchesFilter(f('unit\\gate-report.test.ts'), 'tests/unit/gate-report', ROOT)).toBe(true)
  })

  it('比对的是**仓库相对**路径，不是绝对路径 ⇒ 根目录里那一段不许被当成范围', () => {
    // 不折相对的话 `npm run test -- 法环游戏` 会圈中每一个文件（根路径本身就含这三个字），
    // 于是"我筛了个范围"读起来成立、实际跑了全量——这条是 `relTo` 那一步唯一的证人。
    const leaf = ROOT.split(/[\\/]/).filter(Boolean).pop() as string
    expect(leaf.length, '这条证人要吃根目录名，根路径得是能切出末段的绝对路径').toBeGreaterThan(0)
    expect(matchesFilter(f('flow\\bells.test.ts'), leaf, ROOT), `范围写「${leaf}」（仓库名本身）不该圈中任何东西`).toBe(false)
  })
  it('拿仓库目录名当范围 ⇒ 圈空，而不是"把全量都圈进来"（这一步是 `relTo` 的证人）', () => {
    // vitest 比的是相对路径：仓库名本身出现在**绝对**路径里，所以不复刻那一步的判据会
    // 说"这 92 个都该跑"，而 vitest 一个都不跑 ⇒ 好的跑法被误判成漏跑（ KI-078 头里写的那个"宽"方向）。
    const leaf = ROOT.split(/[\\/]/).filter(Boolean).pop() as string
    const s = scopeOf(DISK, [leaf], ROOT)
    expect(s.unmatched, `范围「${leaf}」是仓库目录名，相对路径里不该出现它`).toEqual([leaf])
    expect(s.expected).toEqual([])
  })
})

describe('真磁盘对账：复刻的那份语义要用今天的名册量一次形状', () => {
  function onDisk(dir: string): string[] {
    const out: string[] = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) out.push(...onDisk(p))
      else if (e.name.endsWith('.test.ts')) out.push(p)
    }
    return out
  }
  const real = onDisk(join(ROOT, 'tests')).map((p) => resolve(p))
  const flowCount = onDisk(join(ROOT, 'tests', 'flow')).length

  it('`tests/flow` 圈出来的恰好是磁盘上 flow 目录里那些文件', () => {
    const s = scopeOf(real, ['tests/flow'], ROOT)
    expect(s.unmatched).toEqual([])
    expect(s.expected.length, 'flow 名册对不上：要么复刻的语义偏了，要么磁盘上多了/少了文件')
      .toBe(flowCount)
    expect(s.expected.length, '至少要圈到真东西（0 个文件不叫"跑齐了"）').toBeGreaterThan(0)
    expect(s.expected.every((p) => /\/tests\/flow\//.test(p)), '圈出来的必须都在 tests/flow 下面').toBe(true)
    expect(scopeOf(real, [], ROOT).expected.length, '没有筛选时期望集就是全量名册')
      .toBe(real.length)
    expect(real.length).toBeGreaterThan(flowCount)
  })
})

describe('跑测器真的接了这份判据（源码门：一 import `test.mjs` 就会跑整套，所以只能读它的文本）', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'test.mjs'), 'utf8')
  // 注释行一律先剥掉：KI-062 撞过——把喂线注释掉的那一行照样能通过 `toContain`
  const code = src.split(/[\r\n]+/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  const has = (re: RegExp) => code.some((l) => re.test(l))

  it('期望集来自 `scopeOf`，不是直接抄磁盘全量', () => {
    expect(has(/^import .*from '\.\/test-scope\.mjs'$/), '没 import 这个模块 = 这条判据没人接').toBe(true)
    expect(has(/scopeOf\(/), 'import 了却不调用 = 判据是装饰').toBe(true)
    expect(has(/describeScope\(/), '成功那一行不许再说"全部跑到"而不说范围').toBe(true)
    expect(has(/scope\.expected/), '`expected` 没从 scope 里取 = 判据算了却没人读')
      .toBe(true)
    expect(code.filter((l) => /const expected\s*=\s*testFilesOnDisk/.test(l)),
      '把期望集直接写成磁盘全量正是 KI-078 那个缺陷的形状；磁盘名册只许当分母印出来')
      .toEqual([])
  })

  it('圈空的筛选器走的是**开跑之前**的 exit 1，而不是"照跑然后判没跑齐"', () => {
    const at = code.findIndex((l) => /if\s*\(scope\.unmatched\.length\)/.test(l))
    expect(at, '没有这道分支 = 写错的路径会被洗成"该跑 0 个、跑到 0 个"的全绿').toBeGreaterThanOrEqual(0)
    const block = code.slice(at, at + 8).join('\n')
    expect(block).toContain('process.exit(1)')
    expect(code.slice(at - 2, at).join('\n') + block, '停下来必须在第一次 runOnce 之前').not.toMatch(/runOnce\(/)
  })
})

describe('describeScope：那句话要说"范围是筛选器说的"', () => {
  it('不带范围时不许出现筛选器字样，带范围时必须出现磁盘名册总数', () => {
    expect(describeScope([], 91, 91)).toContain('91 个测试文件全部跑到')
    expect(describeScope([], 91, 91)).not.toContain('筛选器')
    const line = describeScope(['tests/flow'], 47, 91)
    expect(line).toContain('"tests/flow"')
    expect(line).toContain('47 个文件')
    expect(line, '不印全量名册就看不出"这一趟只量了 47/91"').toContain('磁盘名册 91')
  })
})
