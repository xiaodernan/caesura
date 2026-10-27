import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { corpusFindings, walkTextCorpus } from '../../scripts/text-corpus.mjs'
import { deliverySurface } from '../../scripts/id-scope-rules.mjs'
import { testFilesOnDisk } from '../../scripts/test-scope.mjs'

/**
 * 「走查途中消失的东西」——跳过并点名，不许抛（KI-332，2026-10-28）。
 *
 * **病不是设想**：KI-298 的见证第一版把两份故意红的临时用例写在 `tests/unit/zz-ki298-red-a.test.ts`
 * 与 `tests/unit/zz-ki298-red-b.test.ts`（跑完就删），而与它同时在走的那几道门正好走到那两份文件
 * **在被删掉的那一刻** ⇒ `ENOENT` 抛在收集期 ⇒ 整趟被判成 suite-red：**312 个文件 / 3485 条用例，红 0**，
 * 而判决行不是绿的。红的理由还不在任何一条用例的名字里 ⇒ 按名归因永远归不到它头上。
 *
 * **这一格判四件事**：
 *   ① **走查不抛**：交付总体的走查撞上消失的那一份 ⇒ 不抛（抛了整趟炸掉，判决行都没有 ⇒ 读不懂就是没有读数）；
 *   ② **而且要点名**：跳过却不留名是另一种谎——总体少了一份，那一份里的坏字节／按号引用这一趟没人看，
 *      而没被看过的东西不会变红（**绿是白送的**）⇒ 走查把路径留在 `vanished` 里，读它的门把它变成一条可见的红；
 *   ③ **名册那一侧只许跳过，不许抛**：磁盘名册有第二个读者（vitest 的收集面），两边对不上时
 *      `reconcileRoster` 会点名；交付总体只有一个读者 ⇒ 它的留名不能省；
 *   ④ **顶层不许吞**：顶层读不到 = 这一片树整个不在了 ⇒ 响亮地抛（空名册会读成「该跑 0 个、跑到 0 个」的全绿）。
 *
 * **为什么用「断链」（junction 指向不存在的目标）而不是真删**：真删要竞态——删的时机得正好落在
 * 走查走到它的那一瞬间，不确定 ⇒ 不能当证人。断链是**确定性**的：它在 `statSync` 那里必然撞 ENOENT，
 * 而那正是「被并发车道删掉的那份文件」在走查里撞的东西（同一个 stat、同一个错误码）。
 * Windows 上 junction 不需要管理员权限（`symlinkSync(..., 'junction')`），而 `symlinkSync(..., 'file')` 要。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 一个假仓库根：四棵树都在，每棵树里有一份干净文本，外加一条断链（= 走查途中消失的那一份） */
function makeFakeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ki332-'))
  for (const d of ['docs', 'src', 'tests', 'scripts']) {
    mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, d, 'ok.md'), `# ${d}\n干净的一行中文。\n`, 'utf8')
  }
  // 断链：目标不存在 ⇒ statSync 必然 ENOENT
  symlinkSync(join(root, 'docs', 'nowhere'), join(root, 'docs', 'gone.md'), 'junction')
  return root
}

/** 造一个带错误码的 fs 错误（名册那一侧的合成夹具用） */
function fsError(code: string): NodeJS.ErrnoException {
  const e = new Error(`${code}: fake gone`) as NodeJS.ErrnoException
  e.code = code
  return e
}

describe('交付总体的走查：消失的那一份被跳过并留名（KI-332）', () => {
  let root = ''

  beforeAll(() => {
    root = makeFakeRoot()
  })
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('撞上消失的那一份 ⇒ 不抛，而且它被点名（`vanished` 里有一行）', () => {
    const walk = walkTextCorpus(root)
    expect(walk.vanished, '断链必须被留名：没被读到的东西不会变红（绿是白送的）').toContain('docs/gone.md')
    expect(walk.files.map((f) => f.file), '消失的那一份不在总体里').not.toContain('docs/gone.md')
    expect(walk.files.length, '假根里那四份文本都还在总体里（跳过的只有消失的那一份）').toBe(4)
  })

  it('文本哨兵：消失的那一份变成一条可见的红（点名，不许静默少读）', () => {
    const findings = corpusFindings(root)
    const hit = findings.filter((f) => f.file === 'docs/gone.md')
    expect(hit.length, `消失的那一份没有变成一条 finding：${JSON.stringify(findings.map((f) => `${f.file} ${f.where}`))}`).toBe(1)
    expect(hit[0].level).toBe('error')
    expect(hit[0].where).toBe('走查')
    expect(hit[0].msg, '理由里要点名「走查途中消失」这件事').toContain('走查途中')
  })

  it('交付总体（按号门那一侧）：`vanished` 透传——门读的就是走查读的那一片', () => {
    const surface = deliverySurface(root)
    expect(surface.vanished, '按号门那一侧也得看得见消失的那一份').toContain('docs/gone.md')
    expect(surface.files.map((f) => f.rel)).not.toContain('docs/gone.md')
  })
})

describe('磁盘名册：某一层在走查途中没了 ⇒ 跳过，不许抛（KI-332）', () => {
  it('ENOENT 与 ENOTDIR 都算「它没了」：两种都跳过，走查继续往下走', () => {
    const dir = join(ROOT, 'tests', 'unit')
    const readdir = (d: string) => {
      if (d.endsWith('sub-gone')) throw fsError('ENOENT')
      if (d.endsWith('sub-file')) throw fsError('ENOTDIR')
      if (d.endsWith('keep')) return [{ name: 'keep.test.ts', isDirectory: () => false }]
      return [
        { name: 'sub-gone', isDirectory: () => true },
        { name: 'sub-file', isDirectory: () => true },
        { name: 'keep', isDirectory: () => true },
        { name: 'top.test.ts', isDirectory: () => false },
      ]
    }
    let roster: string[] = []
    expect(() => {
      roster = testFilesOnDisk(dir, { readdir })
    }, '消失的两层不许把整个跑测器炸掉（判决行都没有 ⇒ 读不懂就是没有读数）').not.toThrow()
    const names = roster.map((p) => p.replace(/\\/g, '/'))
    expect(names.some((p) => p.endsWith('/top.test.ts')), '跳过的只是消失的那两层，别的照收').toBe(true)
    expect(names.some((p) => p.endsWith('/keep/keep.test.ts')), '跳过的只是消失的那两层，别的照收').toBe(true)
    expect(names.some((p) => p.includes('sub-gone')), '消失的那一层不在名册里').toBe(false)
    expect(names.some((p) => p.includes('sub-file')), '消失的那一层不在名册里').toBe(false)
  })

  it('顶层那一格读不到 ⇒ 仍然抛（空名册会读成「该跑 0 个、跑到 0 个」的全绿）', () => {
    const readdir = () => {
      throw fsError('ENOENT')
    }
    let code = ''
    try {
      testFilesOnDisk(join(ROOT, 'tests'), { readdir })
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code ?? ''
    }
    expect(code, '顶层读不到必须响亮地抛：吞掉它会让跑测器拿到空名册，而 vitest 也一个文件都收不到 ⇒ 全绿').toBe('ENOENT')
  })
})

describe('真库那一腿：此刻仓库里没有走查途中消失的东西', () => {
  it('交付总体的走查：消失的那一份为空（真仓此刻是稳定的）', () => {
    expect(walkTextCorpus(ROOT).vanished, '真仓里出现了走查途中消失的东西 = 那一趟的总体是不确定的').toEqual([])
  })

  it('按号门那一侧：消失的那一份为空（门读的就是走查读的那一片）', () => {
    expect(deliverySurface(ROOT).vanished, '按号门那一侧也得看得见消失的那一份').toEqual([])
  })
})

describe('源码门：两处走查都真的接上了同一把尺子', () => {
  /** 剥掉行注释再看：注释掉的那一行不算接线（KI-098 第一轮臂 A11/A12 的教训） */
  function live(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('//'))
      .join('\n')
  }

  it('交付总体的走查真的问「这是不是 ENOENT／ENOTDIR」', () => {
    expect(live('scripts/text-corpus.mjs'), '走查要真的用上那把尺子（只导出一个没人调的函数不算）').toContain('isGone(e)')
  })

  it('磁盘名册真的接上**同一把**尺子（不许自己抄一份判据）', () => {
    expect(live('scripts/test-scope.mjs'), '名册那一侧也要接同一把尺子').toContain('isGone(e)')
    expect(live('scripts/test-scope.mjs'), '名册那一侧要从走查那一侧 import 那把尺子，不许各抄一份').toContain(
      "from './text-corpus.mjs'",
    )
  })
})
