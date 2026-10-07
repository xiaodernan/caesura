/**
 * scripts/text-corpus.mjs — 把 `text-integrity.mjs` 那两句判据**接到整个交付文本总体**上（KI-098，2026-10-02）
 *
 * 为什么 KI-082 那道门只扫了 20 份表，而这一份要扫全库：那一次的病发生在 `src/data/json/states.json`，
 * 于是判据的形状是「表名 + 表的原文」。可同一条写盘路径改的是**任何**中文文本，而它留下的记号不相上下——
 * 本批实测到的那个真件就不在表里，在 `tests/unit/panel-nav.test.ts:186`：一条正则里的 `\b`
 * 落成 U+0008 真退格，于是 `match(...) ?? []` 扫到空集、那条断言拿着空串白过。
 * KI-082 自己在「没做②」里写过这一格（`docs/**` 与 `src/**` 不在门内），也写过要等一个"唯一记号"——
 * 现在有了记号，也终于有了一件。
 *
 * 分工与 `text-integrity.mjs` 一样：判据（纯函数）住那边，**总体**住这里，测试与门禁读的是同一份口径。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { mojibakeFindings, strayControlFindings } from './text-integrity.mjs'

/**
 * 总体 = 这四棵树加仓库根的**具名散文件**：交付的东西都在这里，旁路目录不算交付。
 *
 * 这一张名单原本是五棵树（多一个 `tools`），2026-10-02 实测**它不存在**——而一个不存在的目录名
 * 在这道门里是静默的：它既不进名册也不报错，"总体"就这样少了一棵树而没人知道。所以这里按 §55
 * （没有消费方的格子不留在表上）把它删掉，同时让走查把**名册里声明却不在仓库的目录**报成错误：
 * 那一天要么是真加了素材树（忘了登记就扫不到），要么是 `src` 被改名（门在读一个残缺总体）。
 */
export const CORPUS_DIRS = ['docs', 'src', 'tests', 'scripts']

/**
 * 跳过的目录名。**每一条都要能回答"仓库里还有谁经过它"**，所以这些名字全是构建产物 / 依赖 / 一次性平面，
 * 没有一个是"人写的东西"：`.scratch` 里那些平面副本是被 `git archive` 重新生成的，扫它们等于把同一份
 * 文本数两遍（并且会把已经修好的历史红又报一次）。
 */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.coverage', '.git', '.scratch', 'Temp'])

/**
 * 二进制的判据用**内容**而不是扩展名：含 NUL(0x00) 就当二进制。
 * 理由与 git 自己同一条——扩展名是一张会腐烂的手抄名单（今天全库 0 个二进制，明天加一种素材格式就得改表），
 * 而"文本文件里不该有 NUL"这句话不随素材清单变。
 */
export function looksBinary(bytes) {
  if (!(bytes instanceof Uint8Array)) return false
  for (const b of bytes) if (b === 0x00) return true
  return false
}

/**
 * 严格 UTF-8 解码。坏在这里报出来而不是让它变成 U+FFFD：
 * **非致命解码会自己造出替换字符**——那是判据最坏的假阳性（文件没坏，读它的方式坏了），
 * 而它同时也是那条真病的另一半（代码页错位的文件正是这样落进总体的）。
 * @returns {{ ok: boolean, text: string, error: string }}
 */
export function decodeUtf8(bytes) {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), error: '' }
  } catch (e) {
    return { ok: false, text: '', error: String(e && e.message ? e.message : e) }
  }
}

/**
 * 走一遍总体 → `{ files: [{ file, bytes }], binaries: [路径], missing: [名册里声明却不在仓库的目录] }`
 * （POSIX 风格仓库相对路径，保持目录序）。
 *
 * 根目录的**具名**散文件也进来（`index.html`、`package.json`、需求载体那份 `新建 文本文档.txt`——
 * 它是冻结输入，但它同样是文本：坏了一句都不能改，只能重新取回原件）。
 *
 * 根目录的**点前缀**散文件被排除，这是一处**已命名的洞**，不是疏忽：本机在工作树根上留的一律是
 * 一次性产物（今天实测 38 份：32 份 `.tmp-*.py` 打补丁脚本 + 2 份 `.tmp-*.log` + 4 份 `.tsc*.log`，
 * 那些日志里全是 ANSI ESC，而它们正是 KI-098 要抓的"被某一次写盘解释掉"的高发地），
 * 加 `.gitignore` 一种机器配置。
 * 把这些算进总体，这条哨兵在第一趟（2026-10-02，工作副本平面上）就报 **207 条** findings，
 * 而且全部落在**没人读的东西**上——那样的门会在第一周被关掉。
 * 洞的守卫在 `tests/unit/text-integrity.test.ts` 那条"入库名册 ⇄ 总体"的跨查里：
 * 一个**已入库**的根点文件（今天是且仅是 `.gitignore`）会被逐名点名，不许悄悄长大。
 * 这条跨查只看得见**已入库**的点文件——没入库的（被 gitignore 的）它看不见，走查也看不见它：
 * 这条缝的收口是 {@link rootDotFileFindings}（2026-10-08）：根上每个点文件都得对上一条已声明的形状。
 */
export function walkTextCorpus(root) {
  const files = []
  const binaries = []
  const missing = []
  const rootAbs = root.replace(/\/+$/, '')
  const push = (rel, abs) => {
    const bytes = readFileSync(abs)
    if (looksBinary(bytes)) binaries.push(rel)
    else files.push({ file: rel, bytes })
  }
  for (const dir of CORPUS_DIRS) {
    const abs = `${rootAbs}/${dir}`
    let st
    try {
      st = statSync(abs)
    } catch {
      missing.push(dir)
      continue
    }
    if (!st.isDirectory()) { missing.push(dir); continue }
    const walk = (cur, prefix) => {
      for (const name of readdirSync(cur).sort()) {
        if (SKIP_DIRS.has(name)) continue
        const full = `${cur}/${name}`
        const rel = prefix ? `${prefix}/${name}` : name
        if (statSync(full).isDirectory()) walk(full, rel)
        else push(rel, full)
      }
    }
    walk(abs, dir)
  }
  for (const name of readdirSync(rootAbs).sort()) {
    const full = `${rootAbs}/${name}`
    if (SKIP_DIRS.has(name) || name.startsWith('.') || !statSync(full).isFile()) continue
    push(name, full)
  }
  return { files, binaries, missing }
}

/**
 * 根目录点文件的形状名单（KI-098没做② 的收口，2026-10-08）：洞变结构。
 *
 * 走查对点前缀的根文件是**瞎**的（`walkTextCorpus` 根循环里那句 `name.startsWith('.')`）——这是刻意的：
 * 根上躺着的一次性产物没人读、还全是 ANSI ESC，进总体这道门第一天就报 200+ 条、第一周就被关掉。
 * 而"入库名册 ⇄ 总体"那条跨查只见**已入库**的点文件。两把尺子之间留了一条缝：
 * **一个被 gitignore 的散文文件可以在根上永久隐身**——不入库，跨查看不见它；点前缀，走查看不见它。
 *
 * 封缝的不是让走查睁眼（那等于把门淹死），是让每个点文件都得有名字：对不上一条已声明的形状就点名。
 * 每一条都要能回答"谁经过它"，新增形状是决定不是顺手（§55 同一纪律——白名单也是一种格子）。
 */
export const ROOT_DOT_FILES = [
  { match: /^\.gitignore$/, why: '已入库的机器配置，git 自己读它；"入库名册 ⇄ 总体"那条跨查逐名盯着已入库的点文件' },
  { match: /^\.env(\..+)?$/, why: '机器本地配置，.gitignore 显式挡住（!.env.example 反向放行样例）——从不属于交付，也不进总体' },
  { match: /^\.tmp-.*\.(py|log)$/, why: '各车道的一次性补丁脚本与日志，gitignore 的 .tmp-* 挡着；正是"被某一次写盘解释掉"的高发地，但没人读它们，进总体只会把门淹死' },
  { match: /^\.tsc.*\.log$/, why: 'tsc 的重定向日志，一次性产物；gitignore 没盖住它们（"可提交垃圾"），普查让这一点保持可见' },
]

/** 与普查同一份谓词：测试与生产读同一个判定，不各抄一份 */
export function isDeclaredRootDotFile(name) {
  return ROOT_DOT_FILES.some((r) => r.match.test(name))
}

/**
 * 根目录点文件的普查：名单之外的点名（KI-098没做②）。
 * 地板是 `.gitignore`：根上一个点文件都读不到 = 这条普查在读一个残缺的根（连它自己的排除口径都丢了），
 * 不许拿空 findings 冒充干净。非点文件不归它管——它们走查看得见（那是 walkTextCorpus 的总体）。
 */
export function rootDotFileFindings(root) {
  const rootAbs = root.replace(/\/+$/, '')
  let names
  try {
    names = readdirSync(rootAbs)
      .filter((name) => {
        if (SKIP_DIRS.has(name) || !name.startsWith('.')) return false
        try { return statSync(`${rootAbs}/${name}`).isFile() } catch { return false }
      })
      .sort()
  } catch (e) {
    return [{ level: 'error', file: '(总体)', where: '根', msg: `读不到仓库根 ${rootAbs}（${String(e && e.message ? e.message : e)}）——点文件普查无从谈起。` }]
  }
  if (!names.includes('.gitignore')) {
    return [{ level: 'error', file: '(总体)', where: '根', msg: `根上读不到 .gitignore（点文件普查的总体只剩 ${JSON.stringify(names)}）= 这道普查在读一个残缺的根，不许拿空集冒充干净。` }]
  }
  return names
    .filter((name) => !isDeclaredRootDotFile(name))
    .map((name) => ({
      level: 'error',
      file: name,
      where: '根',
      msg: '根上出现名单之外的点文件。走查对点前缀的根文件是瞎的（一次性产物不进总体——否则这道门第一周就被关掉），'
        + '跨查只见已入库的点文件：一个被 gitignore 的散文/配置可以在根上永久隐身，这个普查是那条缝唯一的读者。'
        + '所以每个点文件都得有名字：要么往 ROOT_DOT_FILES 加一条已声明的形状并写清"谁经过它"，'
        + '要么它根本不该住根上——散文住 docs/（走查看得见），一次性产物用名单里已有的名字。',
    }))
}

/**
 * 整个总体的文本完整性 findings：三份判据串起来，一个文件的两处坏不会互相盖掉。
 * 顺序是刻意的——**先验总体自己不是空的、再验没有二进制混进来**，因为后面每一句都在拿空集冒充"干净"的风险上跑。
 */
export function corpusFindings(root) {
  const out = []
  if (typeof root !== 'string' || root === '') {
    return [{ level: 'error', file: '(总体)', where: '入参', msg: 'corpusFindings 要一个仓库根的绝对路径，拿到的是空 ⇒ 总体无从谈起。' }]
  }
  const { files, binaries, missing } = walkTextCorpus(root)
  for (const dir of missing) {
    out.push({
      level: 'error',
      file: '(总体)',
      where: '名册',
      msg: `总体名册里的目录 ${dir} 在仓库里不存在 ⇒ 这道门读的总体比它以为的少一棵树。`
        + '要么它是被改名/删掉了（那这些文本从此没人扫），要么有人真加了新的一棵交付树（那把它登记进名册）。'
        + '这一条不允许靠"把它从名册里划掉"变绿：先回答那棵树的文本去哪了。',
    })
  }
  if (files.length === 0) {
    out.push({ level: 'error', file: '(总体)', where: '名册', msg: `总体里一个文本文件都没读到（目录清单 ${CORPUS_DIRS.join(' ')}）= 这道门在读一个空集合。` })
  }
  for (const b of binaries) {
    out.push({
      level: 'error',
      file: b,
      where: '字节',
      msg: '总体里出现含 NUL 的文件，被当成二进制跳过了。**今天全库一个二进制都没有**，所以这条红是在问「这是谁、为什么进仓库」：'
        + '要么它本该是文本（那它的字节被写坏过，按 KI-082/KI-098 查那条写盘路径），'
        + '要么它是有名分的素材（那就把它登记进 SKIP/二进制口径并写清理由，别让"跳过"变成一个没人看过的洞）。',
    })
  }
  const decodable = []
  for (const f of files) {
    const d = decodeUtf8(f.bytes)
    if (!d.ok) {
      out.push({
        level: 'error',
        file: f.file,
        where: '字节',
        msg: `这份文件不是合法 UTF-8（解码器原话：${JSON.stringify(d.error.slice(0, 160))}）。`
          + '判据刻意用**致命**解码：非致命解码会把坏字节悄悄变成 U+FFFD，那等于判据自己造出自己的假阳性，'
          + '也把真正的代码页错位混进"替换字符"那一格里读不出来了。修法：按原编码重新存成 UTF-8（先确认原文还在）。',
      })
      continue
    }
    decodable.push({ file: f.file, text: d.text })
  }
  out.push(...mojibakeFindings(decodable))
  out.push(...strayControlFindings(decodable))
  return out
}
