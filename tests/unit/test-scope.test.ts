import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeScope, matchesFilter, positionalFilters, reconcileRoster, scopeOf } from '../../scripts/test-scope.mjs'

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

describe('reconcileRoster：名册 ⇄ 这一趟真跑到的文件集，两个方向都要拒（KI-099）', () => {
  // 期望集与报告两边都由判据自己折成正斜杠，所以表上的名字也用那个形状（反斜杠的输入另有专门一格钉）。
  const R = ROOT.replace(/\\/g, '/')
  const A = `${R}/tests/unit/a.test.ts`
  const B = `${R}/tests/unit/b.test.ts`
  const C = `${R}/tests/flow/c.test.ts`

  it('两边一致 ⇒ 两个差集都空（这条是新判据的"绿长什么样"）', () => {
    const r = reconcileRoster([A, B], [A, B])
    expect(r).toEqual({ missing: [], extras: [] })
  })

  it('漏跑只进 `missing`，不许同时污染 `extras`', () => {
    const r = reconcileRoster([A, B], [A])
    expect(r.missing).toEqual([B])
    expect(r.extras, '跑到的都是名册里的 ⇒ extras 必须是空集，否则点名会指错方向').toEqual([])
  })

  it('多跑只进 `extras`，而这一格过去**根本没有证人**（旧代码只算 missing）', () => {
    const r = reconcileRoster([A], [A, C])
    expect(r.extras).toEqual([C])
    expect(r.missing).toEqual([])
  })

  it('报告里的反斜杠与磁盘名册的正斜杠是同一份文件（不折形状 = 每一条都算"既漏跑又多跑"）', () => {
    const r = reconcileRoster([A], [A.replace(/\//g, '\\')])
    expect(r, '同一条路径的两种斜杠形状不许产出任何差集').toEqual({ missing: [], extras: [] })
  })

  it('ran 里重复的同一份文件只算一次（去重，否则 extras 会说谎）', () => {
    expect(reconcileRoster([A], [A, A]).extras).toEqual([])
    expect(reconcileRoster([A], [B, B]).extras).toEqual([B])
  })

  it('空名册 + 真跑到 ⇒ 全部是 extras，不许读成"没漏跑就算过"', () => {
    // KI-078 那条"圈空的筛选器必须在开跑前停下来"挡的是期望集为空；这一格挡的是它的孪生：
    // 期望集为空、却真跑了文件时，只看 `missing.length === 0` 的门会绿。
    const r = reconcileRoster([], [A, B])
    expect(r.missing).toEqual([])
    expect(r.extras).toEqual([A, B])
  })

  it('两边皆空 ⇒ 两个差集都空——所以调用方**不能**拿"差集为空"当"这一趟跑过东西"的证据', () => {
    expect(reconcileRoster([], [])).toEqual({ missing: [], extras: [] })
  })

  it('与 `scopeOf` 复合：不带范围时，"跑齐磁盘名册"要求两个方向都空', () => {
    const expected = scopeOf(DISK, [], ROOT).expected
    expect(reconcileRoster(expected, expected)).toEqual({ missing: [], extras: [] })
    const withPlaneCopy = [...expected, `${R}/.scratch/plane_x/tests/unit/a.test.ts`]
    const r = reconcileRoster(expected, withPlaneCopy)
    expect(r.missing, '平面的副本顶不上仓库的那一份 ⇒ 它既该被点名为多余，也不该让仓库那份算"跑到"')
      .toEqual([])
    expect(r.extras).toEqual([`${R}/.scratch/plane_x/tests/unit/a.test.ts`])
  })
})

describe('跑测器真的双向对账（源码门：`test.mjs` 一 import 就跑整套，只能读它的文本）', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'test.mjs'), 'utf8')
  const code = src.split(/[\r\n]+/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  const has = (re: RegExp) => code.some((l) => re.test(l))

  it('双向判据接上了：import 它、调用它、两个差集都读', () => {
    expect(has(/^import \{[^}]*\breconcileRoster\b[^}]*\} from '\.\/test-scope\.mjs'$/), '没 import = 这条判据没人接').toBe(true)
    expect(has(/reconcileRoster\(/), 'import 了却不调用 = 判据是装饰').toBe(true)
    expect(has(/\{ missing, extras \}/), '只解构 missing ⇒ 多跑那一半又被丢掉了').toBe(true)
  })

  it('旧的单向形状不许多留一份（`new Set(res.files)` + `expected.filter(!ran.has)` 正是 KI-099 那个洞）', () => {
    expect(code.filter((l) => /expected\.filter\(\(p\)\s*=>\s*!ran\.has\(p\)\)/.test(l)),
      '手工单向差集与 `reconcileRoster` 并存时，读代码的人不知道哪一条 governs').toEqual([])
  })

  it('extras 的拒绝排在**成功分支之前**，而且**不重试**（重试不会让两份写死的判据相等）', () => {
    const at = code.findIndex((l) => /if\s*\(extras\.length\s*>\s*0\)/.test(l))
    expect(at, '没有这道分支 = 平面副本被无声加进分母').toBeGreaterThanOrEqual(0)
    const ok = code.findIndex((l) => /if\s*\(missing\.length === 0\)/.test(l))
    expect(ok, '成功分支找不到（判据挪了位置，这条门要跟过去）').toBeGreaterThanOrEqual(0)
    expect(at, 'extras 必须在 missing 判绿之前被拒').toBeLessThan(ok)
    const block = code.slice(at, at + 14).join('\n')
    expect(block).toContain('process.exit(1)')
    expect(block.match(/for \(const p of extras\)/g), '要逐条点名，不能只报个数').toHaveLength(1)
    expect(block.includes('lastMissing ='), 'extras 不该走"记下来再重试"那条路').toBe(false)
  })
})

describe('vite.config.ts 的收集面：锚在 tests/ 下面，且与磁盘名册逐条对账（KI-099）', () => {
  const cfg = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
  const live = cfg.split(/[\r\n]+/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')

  /**
   * 从**配置文件自己**那一条 pattern 解析，不手抄（手抄的那一份会在别人改 pattern 时继续绿）。
   * `include:` 后面的那个数组要按**配对括号**切：pattern 里自己就带方括号（`[jt]s`），
   * 用 `[^]]*` 那种"读到第一个右括号为止"的写法会在字符类中间断掉，于是解析出半截字符串、
   * 引号配对失败，这条门于是读的是一个**空集**——空集在 `every`/`filter` 上全绿（KI-092 那条纪律）。
   */
  const occurrences = [...live.matchAll(/include:/g)]
  const arrayBody = (from: number): string | null => {
    const open = live.indexOf('[', from)
    if (open < 0) return null
    let depth = 0
    for (let i = open; i < live.length; i++) {
      if (live[i] === '[') depth += 1
      else if (live[i] === ']') {
        depth -= 1
        if (depth === 0) return live.slice(open + 1, i)
      }
    }
    return null
  }
  const patterns = occurrences.length === 1
    ? [...(arrayBody(occurrences[0].index as number) ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
    : []

  it('有一条（且只有一条）显式 `test.include`，并且**锚在 `tests/`**', () => {
    expect(occurrences.length, '`include:` 出现 0 次 ⇒ vitest 用仓库级默认 glob，`.scratch` 里的平面副本会被数进来；'
      + '出现 2 次以上 ⇒ 这条门不知道哪一个 governs').toBe(1)
    expect(patterns.length, '数组解不出引号内容 = 解析器坏了，不许当成"没有 pattern"放过去').toBeGreaterThan(0)
    for (const p of patterns) {
      expect(p, `「${p}」以 \`**\` 打头 = 仓库级 walk，平面副本又回来了`).not.toMatch(/^\*\*/)
      expect(p.startsWith('tests/'), `「${p}」没有锚在 tests/ 下面`).toBe(true)
    }
    // 嵌套也要钉住（KI-005 那条纪律：挂在错误的层级会被静默忽略）——`include` 必须住在 `test` 段里面。
    expect(/test:\s*\{[^{}]*include:/.test(live),
      'include 不在 `test: { … }` 段里 ⇒ vitest 读不到它，收集面还是仓库级默认那份').toBe(true)
  })

  /**
   * 这条 pattern 的**专用**读取器，不是 picomatch 复刻：花括号交替展开成词、`?()` 变成可选、
   * 方括号变成字符类、"双星加斜杠"的目录段变成"任意层目录或不留"、单星变成"单层不含斜杠"。
   * 它的正确性由下面那张自证表钉住（真测试名要收、非测试名要拒），所以这里只需要覆盖
   * 这一条 shipped pattern 用到的构造；pattern 将来用了没读到的构造，报错的是那张表而不是这条静默的匹配。
   */
  function compile(glob: string): RegExp {
    let out = ''
    let i = 0
    while (i < glob.length) {
      const rest = glob.slice(i)
      if (rest.startsWith('**/')) { out += '(?:.*/)?'; i += 3; continue }
      if (rest.startsWith('**')) { out += '.*'; i += 2; continue }
      if (rest.startsWith('*')) { out += '[^/]*'; i += 1; continue }
      const alt = rest.match(/^\{([^}]*)\}/)
      if (alt) { out += `(?:${alt[1].split(',').join('|')})`; i += alt[0].length; continue }
      const opt = rest.match(/^\?\(([^)]*)\)/)
      if (opt) { out += `(?:${opt[1]})?`; i += opt[0].length; continue }
      const cls = rest.match(/^\[([^\]]*)\]/)
      if (cls) { out += `[${cls[1]}]`; i += cls[0].length; continue }
      if (rest[0] === '?') { out += '?'; i += 1; continue }
      out += rest[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i += 1
    }
    return new RegExp(`^${out}$`)
  }

  it('自证表：这个读取器认识的正是本仓库用的那几种拼写，而它必须拒掉非测试文件', () => {
    const re = compile(patterns[0])
    const accepted = [
      'tests/unit/a.test.ts', 'tests/flow/b.test.ts', 'tests/unit/c.spec.ts',
      'tests/unit/d.test.tsx', 'tests/unit/e.test.mts', 'tests/support/f.spec.cjs',
    ]
    const rejected = [
      'tests/unit/helper.ts', 'tests/support/fakeAudio.ts', 'src/main.ts',
      'tests/unit/x.test.txt', 'docs/a.test.ts', 'tests/unit/aatests',
    ]
    for (const n of accepted) expect(re.test(n), `「${n}」这种拼写该被收到`).toBe(true)
    for (const n of rejected) expect(re.test(n), `「${n}」不是测试文件，被收到就会污染名册`).toBe(false)
    // `?` 在本仓库这条 pattern 里读成"前面那一个可省"（`.mts` 的点是可省的、`(x)` 是可省的），
    // 而 `*.{test,spec}` 那个点**不可省**：`tests/unit/aatests` 被拒就是这一对读法的证人。
    expect(accepted.filter((n) => /\.(mts|cjs)$/.test(n)).length, '可选点那一支没有例子进表').toBe(2)
  })

  it('pattern 圈到的文件 ⇄ `test.mjs` 的磁盘名册**逐条相等**（少收 = 永远红在 extras，多收 = 永远红在 missing）', () => {
    const re = compile(patterns[0])
    const walk = (dir: string, skipTop: boolean): string[] => {
      const out: string[] = []
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (skipTop && ['node_modules', 'dist', '.git'].includes(e.name)) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) out.push(...walk(p, true))
        else out.push(p)
      }
      return out
    }
    const rel = (p: string) => resolve(p).replace(/\\/g, '/').slice(ROOT.length + 1)
    // 走**整仓**（只跳 node_modules/dist/.git），`.scratch` 里那些平面副本要能被看见——
    // 它们正是这一格要证明"被 pattern 挡在外面"的那一群。
    const everything = walk(ROOT, true).map(rel)
    const byPattern = everything.filter((p) => re.test(p))
    const byRoster = everything.filter((p) => p.startsWith('tests/') && p.endsWith('.test.ts'))
    expect(byPattern.length, '一条测试文件都没圈到 = pattern 或 walk 坏了，不叫"对账通过"').toBeGreaterThan(0)
    expect(byPattern.every((p) => p.startsWith('tests/')), '收集面越出了 tests/ ⇒ 平面副本又会进分母').toBe(true)
    expect(byPattern.filter((p) => p.includes('/.scratch/')), '`.scratch/` 下的副本不该被收集').toEqual([])
    expect(byPattern.sort(), 'pattern 与磁盘名册不一致：要么 vitest 收了跑测器不认的拼写（extras 红），'
      + '要么跑测器期待一个 vitest 永远不收的文件（missing 红，且重试不掉）').toEqual(byRoster.sort())
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
