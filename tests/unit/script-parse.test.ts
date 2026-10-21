import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-248：**仓库里没有任何一道门解析过 `scripts/*.mjs`，今天量出来了**。
 *
 * 起因是当场撞上的，不是设想。KI-152 的红率量具 `scripts/red-rate.mjs` 写完后第一次被调用就抛
 * `SyntaxError: missing ) after argument list`（`String(e && e.code ?? e)`——`&&` 与 `??` 混写必须加括号），
 * 而它在此之前**已经被提交面收过一路**：`npx tsc --noEmit` 绿（`tsconfig.json` 的 `include` 只有 `src` 与 `tests`，
 * 而且 `allowJs` 没开），全量套件绿（没有一份测试 import 它），KI-118 那道"进程内脚本必须加载得动"也绿
 * （它只管被测试 import 的那几份，CLI 那一份按设计带着 shebang、走 `node scripts/x.mjs`，不进那张名册）。
 * 于是"这个仓库能跑"这件事对 31 份脚本里的 20 多份**从未被任何机器读者证过**——它们只在被人手动敲起来的那一刻
 * 才第一次被解析。这不是假想的风险：本批就撞上了，而且是**语法**这一层，不是语义。
 *
 * 判据只做一件最小的事：**让 node 自己解析每一份**。`node --check` 用的就是真加载时的解析器，
 * 所以这条门与"跑起来会炸"同源；它不判风格、不判 shebang（那是 KI-118 那一格，两边不重叠也不互替）。
 *
 * 为什么读 HEAD 的 blob 不读工作副本：与 KI-114 / KI-118 同一取舍——要回答的是"新克隆能不能自证"。
 * 写盘再 `--check` 是因为 `--check` 只吃文件；blob 落进 `os.tmpdir()` 的一次性目录，读完即删，
 * 工作副本一根手指都不碰（臂电池要用真文件时另说，见 `.scratch/ki152/`）。
 *
 * 三道地板与判据出自**同一次扫描**：名册长度、被真正 spawn 检查过的份数、带 shebang 的份数。
 * 抽取形状被改坏时红在地板上，不白送一条"0 份失败"的绿。第一条腿是**工具自己走两条**：
 * 合法那份过、非法那份红——否则"全部解析得动"会绿在一个 spawn 不动、或状态码读成 0 的静默工具上。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

const GIT = (() => {
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
  const err = probe.error ? (probe.error as NodeJS.ErrnoException).code : null
  const top = (probe.stdout ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const here = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (err || top.toLowerCase() !== here.toLowerCase()) {
    console.warn(`[script-parse] 响亮跳过 HEAD 那几条腿：${err ? `spawn git 被当场实测挡下（${err}）` : `这里不是工作树根（${top || 'git 没答'} ≠ ${here}）`}`)
  }
  return { ok: !err && top.toLowerCase() === here.toLowerCase() }
})()

/** 让 node 用自己的解析器读一份源码；返回"过不过 + 不过的那一句"。 */
function parseCheck(src: string, name = 'probe.mjs', exe = process.execPath): { ok: boolean; why: string } {
  const dir = mkdtempSync(join(tmpdir(), 'caesura-parse-'))
  try {
    const file = join(dir, name)
    writeFileSync(file, src)
    const r = spawnSync(exe, ['--check', file], { encoding: 'utf8' })
    if (r.error) return { ok: false, why: `spawn ${exe} --check 本身跑不起来（${(r.error as NodeJS.ErrnoException).code}）= 这条判据没跑成` }
    if (r.status === 0) return { ok: true, why: '' }
    const line = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
      .split(/\r?\n/)
      .find((l) => /SyntaxError|Error:/.test(l))
    return { ok: false, why: (line ?? `(node 退出 ${r.status}，没给出那句)`).trim().slice(0, 200) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const headList = (prefix: string, suffix: string): string[] => {
  const r = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', prefix], { cwd: root, encoding: 'utf8' })
  expect(r.error, `git ls-tree ${prefix} 跑不起来 = 总体读不到，不许拿空集冒充"全都解析得动"`).toBeUndefined()
  expect(r.status, `git ls-tree ${prefix} 退出 ${r.status}：${(r.stderr ?? '').trim().slice(0, 120)}`).toBe(0)
  return (r.stdout ?? '').split(/\r?\n/).filter((n) => n.endsWith(suffix)).sort()
}

const headBlob = (p: string): string => {
  const r = spawnSync('git', ['show', `HEAD:${p}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  expect(r.error, `git show HEAD:${p} 跑不起来 = 这条判据没跑成`).toBeUndefined()
  expect(r.status, `读不到 HEAD 的 ${p}（${(r.stderr ?? '').trim().slice(0, 120)}）`).toBe(0)
  return r.stdout ?? ''
}

describe('parseCheck 自己要走两条：合法的那份过、非法的那份红', () => {
  it('一条 ESM 源码解析得动 ⇒ ok；本批真实踩过的那条语法错 ⇒ 不 ok 且带出 node 那句', () => {
    expect(parseCheck('export const a = 1\n'), '合法源码被探针判红 = 探针在空转').toEqual({ ok: true, why: '' })
    const bad = parseCheck("const e = { code: 'X' }\nString(e && e.code ?? e)\n")
    expect(bad.ok, `探针没接住 \`&&\` 混 \`??\` 那一型（今天炸掉 red-rate.mjs 的就是它）：${bad.why}`).toBe(false)
    expect(bad.why, '红的理由要带得出 node 那句，不然点名等于没说').toMatch(/SyntaxError/)
  })

  it('带 shebang 的 CLI 那份也要解析得动（这道门判语法，shebang 归 KI-118，两边不许互替）', () => {
    const cli = parseCheck('#!/usr/bin/env node\nimport { x } from "./y.mjs"\nconsole.log(x)\n')
    expect(cli, `node --check 不该因为第 0 字节那句 shebang 判红：${cli.why}`).toEqual({ ok: true, why: '' })
  })

  it('spawn 不动 ⇒ 报"这条判据没跑成"，不许报 ok（判据是 fail-closed：读不到就等于没过）', () => {
    const r = parseCheck('export const a = 1\n', 'probe.mjs', join(root, 'no-such-node-at-all.exe'))
    expect(r.ok, 'spawn 一个不存在的解释器竟然算"解析得动" = 总体那一条门会绿在没人检查过的字节上').toBe(false)
    expect(r.why).toContain('这条判据没跑成')
    const v = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' })
    expect(v.error, `本机连 \`${process.execPath} --version\` 都 spawn 不动 = 上面两条腿在这一台没有证人`).toBeUndefined()
  })
})

describe('真总体（HEAD 的提交面）：每一份 scripts/*.mjs 都要被 node 解析得动', () => {
  it.skipIf(!GIT.ok)('名册不是空的、本批那两个主体也在里面，而且 0 份解析不过', () => {
    const files = headList('scripts', '.mjs')
    expect(files.length, `HEAD 的 scripts/*.mjs 只读到 ${files.length} 份 = 总体空了，0 份失败不代表没病`).toBeGreaterThanOrEqual(20)
    expect(files.map((f) => f.split('/').pop()), '本批那个把判决行印出来的跑测器要在总体里——它就是 KI-152 那条腿的载体').toContain('test.mjs')
    expect(files.map((f) => f.split('/').pop()), '本批量出这个洞的那个 CLI 驱动要在总体里').toContain('red-rate.mjs')
    const checked: string[] = []
    const shebanged: string[] = []
    const bad: string[] = []
    for (const p of files) {
      const src = headBlob(p)
      if (src.startsWith('#!')) shebanged.push(p)
      const r = parseCheck(src, p.split('/').pop() as string)
      checked.push(p)
      if (!r.ok) bad.push(`${p}：${r.why}`)
    }
    expect(checked.length, `实际 spawn 检查了 ${checked.length} 份，名册给了 ${files.length} 份 = 中间有份没被读过`).toBe(files.length)
    expect(shebanged.length, `总体里带 shebang 的 0 份 = 这里读的不是那批"只被命令行跑"的脚本，KI-118 管不着的那一格没人守`).toBeGreaterThanOrEqual(1)
    expect(bad, '这些脚本在 HEAD 上就解析不过：它们不会被任何测试 import，所以今天是第一次有人拿解析器读它们').toEqual([])
  })

  it('反面见证写进门里：那一份今天真炸过的字节形状，探针必须判红', () => {
    const src = headBlob('scripts/red-rate.mjs')
    expect(src.length, '读不到那个驱动 = 这条腿在对空集说话').toBeGreaterThan(1000)
    expect(/String\(\(e && e\.code\) \?\? e\)/.test(src), '修复后的括号形状要在源码里——不在就说明那一行被改写了，这条腿的前提没了').toBe(true)
    const unparenthesised = src.replace('String((e && e.code) ?? e)', 'String(e && e.code ?? e)')
    expect(unparenthesised, '替换没生效（那一行已经不是原形状）').not.toBe(src)
    const r = parseCheck(unparenthesised, 'red-rate-mutated.mjs')
    expect(r.ok, '把括号摘掉竟然还解析得动 = 探针不动作，上面那条"0 份失败"是假的').toBe(false)
    expect(r.why).toMatch(/SyntaxError/)
  })

  it('KI-248 在账本里有且只有一行，而且那一行说的是"没有任何机器读者解析过 scripts/"', () => {
    const rows = readFileSync(`${root}docs/KNOWN_ISSUES.md`, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^\|\s*KI-248\s*\|/.test(l))
    expect(rows.length, '账本里没有 KI-248 那一行 = 这个洞没登记在册（这一格读工作副本，与 KI-114 同一取舍）').toBe(1)
    expect(rows[0], '那一行必须点名"没有门解析过 scripts/"这件事，不能只是引用了编号').toMatch(/解析/)
  })
})
