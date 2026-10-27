import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  readHeadTree,
  readIndexTree,
  sourceRoots,
  treeCompileErrors,
} from '../../scripts/head-compiles-rules.mjs'

/**
 * 「主干自证」那道门（KI-324）：**把一棵提交树的字节喂给 tsc**，量它编译不过几处。
 *
 * 立的不是风格，是 KI-123／KI-125／KI-321／KI-323 那一族：**主干在编译层是断的，而机器级
 * pre-commit 钩子却绿着**。钩子跑的是 `npm run lint` ＝ `tsc --noEmit`，量的却是
 * **工作树**不是**暂存区** ⇒ 一份文件可以以编译不过的状态被提交，而工作树上留着
 * 编译得过的那一份。KI-323 实测过这个形状：`HEAD` 上 12 条 tsc 红全部住在
 * `tests/flow/KI-320-damage-formula.test.ts` 一个文件里（死导入 ×8、整行未用 ×2、
 * 两个压根不存在的名字 ×2），而钩子当时是绿的。
 *
 * **为什么这条门不能就是 `tsc`**：类型检查器能发现那 12 条，但它只在"有全部未提交字节"的
 * 平面上发现——工作树上那份已经修好了（KI-323 那一批就是修好的），钩子量到的正是修好的
 * 那一份 ⇒ 钩子绿、主干红，谁也看不见。
 *
 * **为什么不用 `git worktree` ＋ 跑 tsc**：① 它要一份依赖（`node_modules`），而给平面挂
 * junction ＋ `git worktree remove --force` 这套组合**会顺着 junction 把目标目录删空**
 * （KI-323 那批踩过，本机 `node_modules` 被删空过一次）；② 它是子进程，跑一趟要几十秒。
 *
 * 这一份的做法：**用 TypeScript 的 compiler API，把那棵树的 blob 当作源文件的字节喂进去**——
 * 根文件名用仓库里的真路径（模块解析照常走真 `node_modules`），宿主只把**内容**换成树上
 * 那一份字节。于是"这一棵树编译不过"有了一台不依赖子进程、不依赖依赖复制的读者。
 *
 * ## 这道门的第一版量的是工作树，而它报的是"主干绿"
 *
 * 第一版用 `execFileSync(..., { encoding: 'utf8' })` 接 `git cat-file --batch`，拿 header 里
 * 的 **size（字节数）**去切那个**已解码的字符串**。中文源码里一个字符占 3 字节 ⇒ 每切一份
 * blob 都会多切进下一份的 header。实测：`files=448 blobs=1` ——**448 份里只读回 1 份**，
 * 其余 447 份在编译时**悄悄从磁盘读**。门于是"量的是工作树，报的是主干绿"，正是它本该抓的
 * 那一族形状，它自己长成了那个形状。
 *
 * 所以下面这几条腿不是"测一下能不能跑"，是**把那次假绿钉成不能再发生**：
 * - `blobs.size === files.size`（读全了没有）；
 * - 抽样几份，blob **逐字等于** `git show` 的真身（切对了没有）；
 * - `trackedMissed === 0`（清单里每一份都真的从树上喂进去了）；
 * - `leaked === 0`（没有工作树的字节漏进来——这一棵树是自足的，新克隆编译得过）。
 *
 * @see scripts/head-compiles-rules.mjs
 */

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/** 问 `git` 之前先探当场环境（KI-075 结案立的方式：跳不跳由当场读数决定，不由旧登记决定）。 */
const GIT = (() => {
  const probe = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const top = String(probe).trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const here = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return { ok: top.toLowerCase() === here.toLowerCase(), top, here }
})()

/** 读一份 git 对象（`maxBuffer` 必须显式给：账本已经涨过 1 MiB，默认 1 MiB 会 ENOBUFS） */
function gitShow(rev: string): string {
  return execFileSync('git', ['show', rev], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/** HEAD 那棵树读一次就够（几条腿共用同一趟读数 ⇒ 地板与读数必然同源） */
let headTreeCache: ReturnType<typeof readHeadTree> | null = null
function headTree() {
  if (!headTreeCache) headTreeCache = readHeadTree(root)
  return headTreeCache
}

/** 昨天那件事的文件：KI-323 记下的 12 条红全住在它里面 */
const BAD_PATH = 'tests/flow/KI-320-damage-formula.test.ts'
/** 昨天那件事的坏字节（`44ae55c` 那一份，主干上它编译不过） */
const BAD_REV = `44ae55c:${BAD_PATH}`

/** 注入一棵只有一份文件的树（清单与 blob 都由调用方给） */
function oneFileTree(path: string, content: string) {
  return { ok: true, why: '', files: [path], blobs: new Map([[path, content]]) }
}

describe('KI-324 主干自证：把一棵提交树的字节喂给 tsc', () => {
  it.skipIf(!GIT.ok)(
    '正读数：主干此刻编译得过（HEAD 的源码 0 条红，且三个诚实读数都是齐的）',
    () => {
      const tree = headTree()
      expect(tree.ok, `树没读成：${tree.why}`).toBe(true)
      expect(tree.files.length, '树上只读到这么些文件 = 清单读空了').toBeGreaterThanOrEqual(300)
      expect(
        tree.blobs.size,
        `树上 ${tree.files.length} 份只读回 ${tree.blobs.size} 份 blob ⇒ 这一读数不完整（第一版正是 448 份只读回 1 份）`,
      ).toBe(tree.files.length)

      const r = treeCompileErrors(root, { tree })
      expect(r.trackedMissed, '清单里有几份没能喂进去 ⇒ 这一读数掺了工作树的字节').toBe(0)
      expect(r.leaked, '工作树里有几份漏进来了 ⇒ 这一棵树不自足（新克隆会缺件）').toBe(0)
      expect(
        r.diagnostics.map((d) => `${d.file}:${d.line} TS${d.code} ${d.text}`),
        '主干编译不过——红消息逐条列在这儿：',
      ).toEqual([])
      expect(r.ok, '主干编译不过').toBe(true)
      expect(r.checked, '根文件份数（源码根）').toBeGreaterThanOrEqual(300)
    },
    180_000,
  )

  it.skipIf(!GIT.ok)('臂A：喂进去的字节说了算（磁盘上那份是好的、树里那份是坏的 ⇒ 门红在那份文件上）', () => {
    // 磁盘上 `src/core/Time.ts` 是好的（`npm run lint` 绿就说明它好），树里那份是坏的
    const tree = oneFileTree('src/core/Time.ts', 'export const x: number = "不是数字"\n')
    const r = treeCompileErrors(root, { tree })
    const inFile = r.diagnostics.filter((d) => d.file === 'src/core/Time.ts')
    expect(inFile.map((d) => d.code), '门没在那份文件上红 ⇒ 喂进去的不是树里那份字节').toContain(2322)
    expect(r.ok, '门把编译不过的树判成了干净').toBe(false)
  })

  it.skipIf(!GIT.ok)('臂B：根文件清单来自树，不是磁盘（注入一份只有一份文件的树 ⇒ checked 就是 1）', () => {
    const tree = oneFileTree('src/core/Time.ts', readFileSync(join(root, 'src/core/Time.ts'), 'utf8'))
    const r = treeCompileErrors(root, { tree })
    expect(r.checked, '磁盘上那 400+ 份混进清单来了').toBe(1)
    expect(r.served, '喂进去的份数').toBe(1)
  })

  it.skipIf(!GIT.ok)('臂C：树读不到时，这道门必须说"没跑成"，不许说"干净"', () => {
    const r = treeCompileErrors(root, { tree: { ok: false, why: 'git 跑不起来', files: [], blobs: new Map() } })
    expect(r.ok, '读不到树却判成了干净').toBe(false)
    expect(r.why, '失败原因被吞了').toContain('git 跑不起来')
    expect(r.diagnostics, '读不到树却报出了"0 条红"这种读数').toEqual([])
  })

  it.skipIf(!GIT.ok)(
    '臂D：把昨天那份坏字节喂回去 ⇒ 门正好报出 KI-323 记下的那 12 条（死导入 ×8 / 整行未用 ×2 / 不存在的导出 ×2）',
    () => {
      const full = headTree()
      expect(full.ok, full.why).toBe(true)
      // 缩减树：`src/` 全留（`GameEvents` 的声明合并文件全在 src/ 下，少一份就会带出假的红），
      // 测试只留昨天那一个文件、且喂的是 44ae55c 那一份坏字节。
      const files = full.files.filter((f) => f.startsWith('src/') || f === BAD_PATH)
      const blobs = new Map(files.filter((f) => full.blobs.has(f)).map((f) => [f, full.blobs.get(f) as string]))
      blobs.set(BAD_PATH, gitShow(BAD_REV))
      const r = treeCompileErrors(root, { tree: { ok: true, why: '', files, blobs } })

      const inFile = r.diagnostics.filter((d) => d.file === BAD_PATH)
      expect(inFile.length, `昨天那份文件上的红是 ${inFile.length} 条，不是 12 条`).toBe(12)
      expect(inFile.filter((d) => d.code === 6133).length, '死导入的条数变了').toBe(8)
      expect(inFile.filter((d) => d.code === 6192).length, '整行未用的条数变了').toBe(2)
      expect(inFile.filter((d) => d.code === 2305).length, '不存在导出的条数变了').toBe(2)
      expect(
        r.diagnostics.filter((d) => d.file !== BAD_PATH),
        '别的文件上不该有红（`src/` 是完整的，`GameEvents` 的声明合并文件都在里面）',
      ).toEqual([])
      expect(r.trackedMissed, '清单里有几份没能喂进去').toBe(0)
      expect(r.leaked, '工作树里有几份漏进来了').toBe(0)
      expect(r.ok, '门把编译不过的树判成了干净').toBe(false)
    },
    180_000,
  )

  it.skipIf(!GIT.ok)('臂E：诚实读数不是摆设（清单里有、树上却没有 ⇒ 门必须说"没能喂进去"）', () => {
    const r = treeCompileErrors(root, { tree: { ok: true, why: '', files: ['src/core/Time.ts'], blobs: new Map() } })
    expect(r.trackedMissed, '清单里有一份却没能喂进去，门却没吭声 ⇒ 这个读数是摆设').toBeGreaterThan(0)
    expect(r.ok, '没能喂进去却判成了干净').toBe(false)
    expect(r.why, '没能喂进去这件事没有被说出来').toContain('没能喂进去')
  })

  it.skipIf(!GIT.ok)('臂F：暂存区那一棵也能拦（旁挂一份临时索引，把暂存内容换成坏字节 ⇒ 门红在那个路径上）', () => {
    // **不碰真索引**：用 `GIT_INDEX_FILE` 旁挂一份，那份索引从空开始、只放一份坏字节。
    // 坏字节用的是仓库里**早就存在**的那个对象（44ae55c 那一份）⇒ 不往对象库里写新东西。
    const tmp = mkdtempSync(join(tmpdir(), 'caesura-index-'))
    const indexFile = join(tmp, 'index')
    const env = { ...process.env, GIT_INDEX_FILE: indexFile }
    execFileSync('git', ['read-tree', '--empty'], { cwd: root, env })
    const badSha = execFileSync('git', ['rev-parse', BAD_REV], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${badSha},src/core/Time.ts`], {
      cwd: root,
      env,
    })

    const tree = readIndexTree(root, { indexFile })
    expect(tree.ok, `暂存区没读成：${tree.why}`).toBe(true)
    expect(tree.files, '临时索引里只有一份，清单却不止一份').toEqual(['src/core/Time.ts'])
    expect(tree.blobs.get('src/core/Time.ts'), '读到的不是暂存区里那份坏字节').toBe(gitShow(BAD_REV))

    const r = treeCompileErrors(root, { tree })
    const inFile = r.diagnostics.filter((d) => d.file === 'src/core/Time.ts')
    expect(inFile.length, '暂存区里那份坏字节没被门看见').toBeGreaterThan(0)
    expect(r.ok, '将要落库的那一堆字节编译不过，门却判成了干净').toBe(false)
  })

  it.skipIf(!GIT.ok)('臂G：树上那份字节逐字等于 git 里的真身（第一版正是这里只有 1/448，于是门量了工作树）', () => {
    const tree = headTree()
    expect(tree.ok, tree.why).toBe(true)
    for (const f of ['src/core/Time.ts', 'src/core/EventBus.ts', 'src/ai/AISystem.ts', 'src/data/index.ts']) {
      expect(tree.blobs.get(f), `${f} 的 blob 没读回来`).toBe(gitShow(`HEAD:${f}`))
    }
  })

  it.skipIf(!GIT.ok)('清单与源码根：根只从 `src/` 与 `tests/` 里取，且取的是树上那份清单', () => {
    const tree = headTree()
    const roots = sourceRoots(tree, root)
    expect(roots.length, '源码根读空了').toBeGreaterThanOrEqual(300)
    expect(roots.every((p) => p.startsWith(join(root, 'src')) || p.startsWith(join(root, 'tests'))), '根里有别处来的文件').toBe(true)
    expect(roots.every((p) => p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.mts') || p.endsWith('.cts')), '根里有不是源码的东西').toBe(true)
    // 清单里有多少份源码，根就得有多少份（不多不少）
    const expectRoots = tree.files.filter(
      (f) =>
        (f.startsWith('src/') || f.startsWith('tests/')) &&
        (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mts') || f.endsWith('.cts')),
    )
    expect(roots.length, '根的份数与清单对不上').toBe(expectRoots.length)
  })
})
