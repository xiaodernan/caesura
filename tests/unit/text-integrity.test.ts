import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALLOWED_CONTROL, MOJIBAKE_CHAR, findMojibake, findStrayControl, mojibakeFindings, strayControlFindings } from '../../scripts/text-integrity.mjs'
import { CORPUS_DIRS, corpusFindings, decodeUtf8, looksBinary, walkTextCorpus } from '../../scripts/text-corpus.mjs'

/**
 * 数据表「文本完整性」的判据（KI-082）。
 *
 * 起因是一族**不与任何既有判据相交**的坏：本机有一条并行的写盘路径，把中文写回 JSON 时会按别的
 * 代码页编/解码一次，产物是 U+FFFD 替换字符。文件仍然是合法 JSON、字段仍然对得上 `schema.ts`、
 * 数值仍然在范围内 —— 校验器、tsc、运行时三方都看不见它，只有那一句文档悄悄少了几个字。
 * 2026-09-28 实测：`states.json` 里 `§2.3` 被压成 `\uFFFD?.3`（那一处至今躺在 `2300ad1` 里）。
 *
 * 分工与 `battle-table.test.ts` 那一族一致：**合成文本**跑这里（拒的一侧要能逐个数判），
 * **真表**由 `npm run validate:data` 跑；但这一条判据多留了一个真表证人（下面最后一条），
 * 因为它的病是"发生了也全绿"，多一双眼睛比省一次 readdir 值。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

/**
 * 「入库名册 ⇄ 总体」那条跨查要问 `git ls-files` ⇒ 需要 spawn。本仓库的先例（KI-075）是 **vitest worker 内部
 * spawn 一律被宿主拒**（`EBUSY`），照 `ledger-rules.test.ts` 的同一处理方式走：加载时探一次，命中就
 * **响亮地跳过**并把原因打出来，而不是让它静默变成一条绿。
 * 实测订正（2026-10-02）：本机 worker 里 `spawnSync(node -e)` **是能跑的**，所以这条守卫在套件里**真跑过**
 * ——KI-075 那句"spawn 被拒"在这条路上不再复现，但探一次的处理方式留着：换一台被拒的机器它就是跳过而不是红。
 *
 * 第二个跳过条件 `!AT_REPO_ROOT`：`git ls-files` 列的是**当前工作树**的名字，而 `.scratch/plane_*` 那些
 * 冻结平面是 `git archive` 解出来的目录（不是工作树根，`git` 从那里看到的是外层仓库的空子集）。
 * 让它在平面上红，等于让每一次变异见证都背着一条与臂无关的红。
 */
const SPAWN_BLOCKED = (() => {
  const probe = spawnSync(process.execPath, ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8' })
  const code = probe.error ? (probe.error as NodeJS.ErrnoException).code : null
  if (code) console.warn(`[text-integrity] 跳过「入库名册 ⇄ 总体」那条守卫：本环境 spawn 子进程被拒（${code}）—— 换台能 spawn 的机器复验，见 KI-075`)
  return code === 'EBUSY'
})()
const AT_REPO_ROOT = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
  const top = (r.stdout ?? '').trim().replace(/\\/g, '/')
  // 先归一化反斜杠再剥尾斜杠：Windows 上 root 以 `\` 结尾，先剥 `/` 剥不掉它，
  // 转成 `/` 后比较就永远差一个尾巴 —— 这条守卫会在真的工作树根上也响亮跳过（2026-10-07 实测）
  const here = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (top.toLowerCase() !== here.toLowerCase()) console.warn(`[text-integrity] 跳过「入库名册 ⇄ 总体」那条守卫：这里不是工作树根（${top || 'git 没答'} ≠ ${here}）—— 冻结平面里没有可问的名字册`)
  return top.length > 0 && top.toLowerCase() === here.toLowerCase()
})()

describe('U+FFFD 判据（KI-082）：坏字符是「数据已经写坏了」的证据，不是显示问题', () => {
  it('位置报得准：第几行、第几列都要数出来（一行里两个也不许只报一个）', () => {
    const text = ['第一行干净', '第二行有一个 \uFFFD 在这里', '第三行两个 \uFFFD 和 \uFFFD'].join('\n')
    const hits = findMojibake(text)
    expect(hits.map((h) => [h.line, h.column])).toEqual([[2, 8], [3, 7], [3, 11]])
    expect(hits.map((h) => h.index), 'index 要指回原文，供报告切上下文').toEqual([13, 25, 29])
  })

  it('干净文本一条都不报 —— 判据不是「看着像乱码就抓」', () => {
    // 这些字符各有正当用途（合并音标 / 变体选择符 / emoji 组合），拿它们定罪就是误报机器
    const clean = '钟腔里没有太阳\u0301 声纹\uFE0F 影\u200D像 🜚 ■ …—「」'
    expect(findMojibake(clean)).toEqual([])
    expect(mojibakeFindings([{ file: 'x.json', text: clean }])).toEqual([])
  })

  it('坏字符**不影响 JSON 合法性** ⇒ 只看解析后的对象是看不见它的（这条就是当年漏掉它的原因）', () => {
    const broken = '{\n  "note": "（\uFFFD?.3/§7）"\n}'
    expect(() => JSON.parse(broken), '它仍然是一个能解析的对象：所有既有判据都会放它过去').not.toThrow()
    expect(JSON.parse(broken).note, '解析出来的那一格只是少了两个字').toBe('（\uFFFD?.3/§7）')
    expect(findMojibake(broken).map((h) => h.line)).toEqual([2])
  })

  it('报告：同一行只报一条、点出每一列的列号、带上下文与修法；where 是行号而不是 JSON 路径', () => {
    const [f] = mojibakeFindings([{ file: 'states.json', text: '{\n  "note": "（\uFFFD?.3）"\n}' }])
    expect(f.level).toBe('error')
    expect(f.file).toBe('states.json')
    expect(f.where, '压坏之后连路径自己都可能读不出来，能指路的只有行号').toBe('第 2 行')
    expect(f.msg).toContain('1 个 U+FFFD')
    expect(f.msg).toContain('第 13 列')
    expect(f.msg, '上下文让读报告的人不必先学会 grep').toContain('\uFFFD?.3')
    expect(f.msg, '修法要写在门口，不是留在某个人的脑子里').toContain('按设计原文重新敲回去')
    expect(f.msg).toContain('KI-082')
    const two = mojibakeFindings([{ file: 'x.json', text: '一\uFFFD二\uFFFD三' }])
    expect(two.length, '同一行两处 = 一处手误，报两条反而看不出是同一个地方').toBe(1)
    expect(two[0].msg).toContain('2 个 U+FFFD 替换字符（第 2、4 列）')
  })

  it('上下文按 JSON 转义（原样打印会把「一条一行」的门禁输出撑成一段）', () => {
    const [f] = mojibakeFindings([{ file: 'x.json', text: '{"a":"x\uFFFD\\"y"}' }])
    expect(f.msg).toContain('\\"')
    expect(f.msg, '报告里不许带换行').not.toContain('\n')
  })

  it('入参不成形也不许崩（门禁在最该说话的时候崩，是最糟的一种失败）', () => {
    expect(findMojibake(undefined)).toEqual([])
    expect(findMojibake('')).toEqual([])
    expect(mojibakeFindings(undefined)).toEqual([])
    expect(mojibakeFindings([null, 7, {}])).toEqual([])
    expect(mojibakeFindings([{ text: '\uFFFD' }])[0].file, '没写表名也要给个能读的喊法').toBe('(未命名表)')
  })

  it('判据自己源码里只许留转义写法（真字符要能被 eyeball 成「故意的还是又坏了一处」）', () => {
    expect(MOJIBAKE_CHAR).toBe('\uFFFD')
    const src = readFileSync(root + 'scripts/text-integrity.mjs', 'utf8')
    expect(findMojibake(src), '判据自己的源码带一个真的 U+FFFD，会让后面每一个人都停下来想一秒').toEqual([])
  })

  it('源码门：校验器真的把这条判据接在**每一份表的原文**上（不是只写了个模块放在那儿）', () => {
    const src = readFileSync(root + 'scripts/validate-data.mjs', 'utf8')
    expect(src, '接线要 import 那道判据').toMatch(/import\s*\{[^}]*mojibakeFindings[^}]*\}\s*from\s*'\.\/text-integrity\.mjs'/)
    expect(src, '读到的原文必须留下来（只看 data 是看不见坏字符的）').toMatch(/sourceText\[f\]\s*=\s*text/)
    expect(src, '报告的三个字段一个都不能丢').toMatch(/report\.error\(f\.file,\s*f\.where,\s*f\.msg\)/)
  })

  it('真表：src/data/json 里一个 U+FFFD 都没有（这一条是那个把中文写坏的写盘路径的哨兵）', () => {
    const dir = root + 'src/data/json/'
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    expect(files.length, '表数掉了 = 有人把它指向了别处').toBeGreaterThan(15)
    const dirty = files
      .map((file) => ({ file, hits: findMojibake(readFileSync(dir + file, 'utf8')) }))
      .filter((x) => x.hits.length > 0)
      .map((x) => `${x.file}:${x.hits.map((h) => h.line).join(',')}`)
    expect(dirty, `这些表里躺着 U+FFFD（中文已经被写坏了，机器一直看得见）：${dirty.join(' ')}`).toEqual([])
  })
})

/**
 * KI-098：同一条写盘路径的**第二种记号**——这一次坏的不是数据，是**源码里的一个转义**。
 *
 * 实测到的那一件在 `tests/unit/panel-nav.test.ts:186`：想写 `/<button\b[^>]*>/g`，磁盘上落成的却是
 * 一个真 U+0008 退格符。JS 正则里裸的退格表示"匹配一个退格字符"，于是那个模式**永远匹配不到任何 HTML**，
 * `match(...) ?? []` 拿到空集，"焦点框不许落在页签或遮罩上"那条断言拿着一个空串通过了 `not.toMatch`。
 * 全套 8 例照绿——这就是 KI-082 说的"发生了也全绿"的那一族，只是它的受害者是**判据自己**。
 *
 * 与 KI-082 的分工一字未改：合成文本跑这里，真表/真总体由门禁跑；这一次多带一棵**总体**的口径
 * （`scripts/text-corpus.mjs`），因为这一族的病会落在任何一份中文文本上，而 `src/data/json` 只是其中一种载体。
 */

/** 人在键盘上打不出这些字符，所以测试一律用码点造它们（写进源码就成了本次要抓的那种东西） */
const BS = String.fromCharCode(0x08)
const ESC = String.fromCharCode(0x1b)
const NUL = String.fromCharCode(0x00)
const TAB = String.fromCharCode(0x09)
const LF = String.fromCharCode(0x0a)
const CR = String.fromCharCode(0x0d)
const BACKSLASH = String.fromCharCode(0x5c)

describe('游离控制字符（KI-098）：转义序列被某一次写盘解释掉了一次，留下的记号是控制字符', () => {
  it('被吃掉的转义要报，按字面写的两个字符不许报 —— 这就是当年那个真件的两面', () => {
    const intended = 'html.match(/<button' + BACKSLASH + 'b[^>]*>/g)'
    expect(findStrayControl(intended), '反斜杠＋b 是正则的边界断言，不是损伤').toEqual([])
    const eaten = 'html.match(/<button' + BS + '[^>]*>/g)'
    const hits = findStrayControl(eaten)
    expect(hits.length, '同一个位置落成真退格，就是"这条正则永远扫不到东西"的物证').toBe(1)
    expect([hits[0].line, hits[0].column, hits[0].code], '列号按码元数：`html.match(/<button` 是 19 个字符，退格是第 20 个').toEqual([1, 20, 0x08])
  })

  it('排版不是损伤：TAB/LF/CR 放过，其余 29 个 C0 一个都不放过（名单只有一个主人）', () => {
    expect(ALLOWED_CONTROL, '这三格就是"排版"与"写坏"的分界，改这里等于改判据').toEqual([0x09, 0x0a, 0x0d])
    const layout = ['第一行' + TAB + '有缩进', '第二行' + CR + LF].join(LF)
    expect(findStrayControl(layout)).toEqual([])
    const all = [...Array(32).keys()].filter((c) => !ALLOWED_CONTROL.includes(c))
    const line = all.map((c) => String.fromCharCode(c)).join('')
    const hits = findStrayControl(line)
    expect(hits.length, '32 个 C0 里去掉那三格，剩下的每一格都要被点名').toBe(all.length)
    expect(hits.map((h) => h.code)).toEqual(all)
    expect(hits.map((h) => h.column), '列号要一格不差地指回原文（同一段里连排也不许串行）').toEqual(all.map((_, i) => i + 1))
  })

  it('报告：按码点点名、一行报一条、上下文与 KI-098 的修法都在里面', () => {
    const [f] = strayControlFindings([{ file: 'docs/x.md', text: '一' + BS + '二' + ESC + '三' }])
    expect(f.level).toBe('error')
    expect(f.file).toBe('docs/x.md')
    expect(f.where).toBe('第 1 行')
    expect(f.msg, 'U+0008 与 U+001B 的修法完全不同，合成一句"有控制字符"会把人引去查错的东西').toContain('U+0008（第 2 列）')
    expect(f.msg).toContain('U+001B（第 4 列）')
    expect(f.msg).toContain('KI-098')
    expect(f.msg).not.toContain(String.fromCharCode(10))
    const two = strayControlFindings([{ file: 'x.ts', text: '干净' + LF + '第二行' + BS + '与' + BS }])
    expect(two.length, '同一行两处 = 同一次手误，报两条反而看不出是同一个地方').toBe(1)
    expect(two[0].where, '换行要真的移行，报第 1 行就是把人支到干净的地方').toBe('第 2 行')
    expect(two[0].msg).toContain('2 个不该存在的控制字符')
    expect(strayControlFindings(undefined)).toEqual([])
    expect(strayControlFindings([null, 7, {}])).toEqual([])
    expect(strayControlFindings([{ text: BS }])[0].file).toBe('(未命名文件)')
    expect(findStrayControl(undefined)).toEqual([])
    expect(findStrayControl('')).toEqual([])
  })

  it('判据自己的源码只许留转义写法（这三份文件里躺一个真控制字符，它就是自己那条病的现场）', () => {
    for (const p of ['scripts/text-integrity.mjs', 'scripts/text-corpus.mjs', 'tests/unit/text-integrity.test.ts']) {
      const src = readFileSync(root + p, 'utf8')
      expect(findStrayControl(src), `${p} 里有一个真控制字符：写进去的那一刻就已经被解释掉了一次`).toEqual([])
      expect(findMojibake(src), `${p} 里有 U+FFFD：中文被写坏了`).toEqual([])
    }
  })

  it('总体名册自证：声明的每一棵树都真在仓库里，并且每棵都读到过文件', () => {
    const walk = walkTextCorpus(root)
    expect(walk.missing, '名册里声明却不在仓库的目录 = 这道门读的总体比它以为的少一棵树').toEqual([])
    expect(CORPUS_DIRS.length, '总体只剩一棵树以下就不是总体了').toBeGreaterThan(3)
    const per = new Map<string, number>()
    for (const f of walk.files) per.set(f.file.split('/')[0], (per.get(f.file.split('/')[0]) ?? 0) + 1)
    for (const dir of CORPUS_DIRS) {
      expect(per.get(dir) ?? 0, `总体里 ${dir}/ 一个文件都没读到：要么它被跳过了，要么它不叫这个名字`).toBeGreaterThan(0)
    }
  })

  it('具名载体必须在总体里：需求原文、架构文档、入口、判据本身、这份测试自己', () => {
    const names = new Set(walkTextCorpus(root).files.map((f) => f.file))
    for (const n of [
      '新建 文本文档.txt',
      'docs/technical-architecture.md',
      'src/main.ts',
      'scripts/text-corpus.mjs',
      'tests/unit/text-integrity.test.ts',
    ]) {
      expect(names.has(n), `${n} 不在总体里 = 它的中文没人扫过`).toBe(true)
    }
    const roots = [...names].filter((n) => !n.includes('/'))
    expect(roots.some((n) => n.startsWith('.')), '根的点开头条目是已命名的排除项，出现在总体里就是口径又改了一次').toBe(false)
  })

  it('总体规模钉住：名册收窄时这条先红，而不是让哨兵安静地绿', () => {
    const n = walkTextCorpus(root).files.length
    // 下限与实得都印在消息里：一个写死在标题上的"今天实测 N"会随着别人往仓库里加文件而腐烂（那是抄来的数），
    // 而这条要钉的只是"没人大面积摘树"，所以把两个数都交给这一趟走查自己报。
    expect(n, `总体只有 ${n} 份（下限 250）：比上次量到的少了一大截 = 有人把一棵树或一类文件从名册里摘走了`).toBeGreaterThanOrEqual(250)
  })

  it('按内容认二进制，不按扩展名：NUL 定罪，中文与 JSON 不放进去', () => {
    expect(looksBinary(new TextEncoder().encode('含 NUL' + NUL + '的字节流'))).toBe(true)
    expect(looksBinary(new TextEncoder().encode('{"name":"钟腔"}'))).toBe(false)
    expect(looksBinary(undefined), '入参不成形也不许崩').toBe(false)
    const walk = walkTextCorpus(root)
    expect(walk.binaries, '含 NUL 的文件被跳过了 = 它的中文永远不会被任何判据看过；今天全库实测 0 个').toEqual([])
  })

  it('致命 UTF-8 解码：坏字节报「不是合法 UTF-8」，而不是让判据自己造出一串 U+FFFD', () => {
    const good = decodeUtf8(new TextEncoder().encode('钟腔'))
    expect([good.ok, good.text, good.error]).toEqual([true, '钟腔', ''])
    const bad = new Uint8Array([0xff, 0xfe])
    const d = decodeUtf8(bad)
    expect(d.ok, '这两个字节不可能是 UTF-8 里的任何字符').toBe(false)
    expect(d.error.length, '要说清是解码器拒的，得带它自己的原话').toBeGreaterThan(0)
    const lenient = new TextDecoder('utf-8').decode(bad)
    expect(findMojibake(lenient).length, '非致命解码把同一份字节读成两个 U+FFFD —— 判据会指控一份没坏的文件，而真坏的文件混在里面读不出来')
      .toBe(2)
  })

  it.skipIf(SPAWN_BLOCKED || !AT_REPO_ROOT)('入库名册 ⇄ 总体的跨查：不许有**已入库**的文件落在排除项里（非工作树根/spawn 被拒时响亮跳过）', () => {
    const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    expect(r.error, 'git 跑不起来 = 这条守卫没跑成，不许算通过').toBeUndefined()
    const tracked = r.stdout.split(NUL).filter((s) => s.length > 0).map((s) => s.replace(/\\/g, '/'))
    expect(tracked.length, '一个入库文件都没列出来 = 这一趟没跑成').toBeGreaterThan(200)
    const inTrees = tracked.filter((t) => CORPUS_DIRS.includes(t.split('/')[0]))
    const population = new Set(walkTextCorpus(root).files.map((f) => f.file))
    const hidden = inTrees.filter((t) => !population.has(t))
    expect(hidden, `这些**已入库**的文件落在总体里却没人扫（跳过名单在藏东西）：${hidden.join(' ')}`).toEqual([])
    const rootDots = tracked.filter((t) => !t.includes('/') && t.startsWith('.'))
    expect(rootDots, '根的点开头条目被排除是**已命名的洞**；除 .gitignore 之外每多一个都要先把它接进总体').toEqual(['.gitignore'])
  })

  it('哨兵：整个交付总体（四棵树 + 根的具名散文件）现在一条 findings 都没有', () => {
    const findings = corpusFindings(root)
    expect(findings, `交付文本里有东西被写坏了：${findings.slice(0, 3).map((f) => `${f.file} ${f.where} ${f.msg.slice(0, 90)}`).join('；')}`).toEqual([])
  })

  it('源码门：全库哨兵真的串上了三份判据，而测试真的调用它（写了个没人调的模块不算门）', () => {
    const src = readFileSync(root + 'scripts/text-corpus.mjs', 'utf8')
    const importLine = src.split(/\r?\n/).find((l) => l.startsWith('import') && l.includes('text-integrity.mjs')) ?? ''
    expect(importLine, 'U+FFFD 与游离控制字符两句都要从总体里接上').toContain('mojibakeFindings')
    expect(importLine).toContain('strayControlFindings')
    expect(src, 'import 了不调用，就是又写了个放在那儿没人读的模块').toContain('mojibakeFindings(decodable)')
    expect(src, '同上：这一句被摘掉，总体里的真退格就没人看').toContain('strayControlFindings(decodable)')
    /**
     * 上面两句 `toContain` 只证明**字串在那儿**，不证明**那行活着**：把调用整句前面加 `//` 注释掉，
     * 两句判据都不再跑，而 `toContain` 一字未变地绿着（KI-098 第一轮臂 A11/A12 抓到的就是这个）。
     * 所以再看一遍**去掉注释行以后**的正文——注释掉的调用在那里就不存在了。
     */
    const live = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => !l.startsWith('//')).join('\n')
    expect(live, '两句判据要在**活的那一行**上被调用（注释掉的那一行不算接线）').toContain('out.push(...mojibakeFindings(decodable))')
    expect(live, '同上：这一句被注释掉，全库哨兵就只看得见 U+FFFD 而看不见被吃掉的转义').toContain('out.push(...strayControlFindings(decodable))')
    expect(src, '解码必须是致命的：非致命解码会自己造出 U+FFFD 假阳性').toContain('{ fatal: true }')
    expect(src, '空总体要自己报错，不许拿空清单冒充干净').toContain('files.length === 0')
    expect(src, '名册里缺树也要报错，不许静默少扫一棵').toContain('missing.push(dir)')
    const here = readFileSync(root + 'tests/unit/text-integrity.test.ts', 'utf8')
    expect(here, '哨兵这一例真的调 corpusFindings，而不是自己手抄一份口径').toContain('corpusFindings(root)')
  })
})
