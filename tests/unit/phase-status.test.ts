/**
 * tests/unit/phase-status.test.ts —— `npm run status` 与 PHASE-STATUS.md 的对账门。
 *
 * 三族判据，都跑在这份文档身上：
 *   ① 取数工具能跑、输出所有 KEY=VALUE 且退出码 0；文档机读区里每个 `KEY=VALUE` 与现读逐字一致；
 *   ②（KI-438）机读区之外不许有第二份计数——不许出现「有名有姓的 KEY 配一个数」，
 *      而裸计数句要么点名一条账本读得到的 KI/TD/PF 记录，要么不许存在；
 *   ③（KI-438）回填工具 `scripts/phase-status-embed.mjs` 自己的脾气：幂等、行尾跟随文档、键集变化当场拒绝、
 *      `--check` 用退出码说话且不写盘，而 `package.json` 那一格真的指着这份文件。
 *
 * 设计目标：编辑者只能「改取数工具 → 跑 `npm run status:embed`」，手改文档任意一个数字都红。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { describe, it, expect, afterAll } from 'vitest'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { BEGIN, END, eolOf, kvLinesFrom, spliceKv } from '../../scripts/phase-status-embed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const DOC_REL = join(ROOT, 'docs', 'PHASE-STATUS.md')
const SCRIPT_REL = join(ROOT, 'scripts', 'phase-status.mjs')
const EMBED_REL = join(ROOT, 'scripts', 'phase-status-embed.mjs')

const runStatus = () => execFileSync(process.execPath, [SCRIPT_REL], { encoding: 'utf8' })
const parseKv = (text: string) => {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w.]*)=(.*)$/)
    if (m) out.set(m[1], m[2])
  }
  return out
}

describe('PHASE-STATUS 嵌入门', () => {
  it('scripts/phase-status.mjs 退出码 0 且输出键集非空且自洽', () => {
    const out = runStatus()
    const kv = parseKv(out)
    expect(kv.size).toBeGreaterThan(15)
    expect(kv.get('KI.rows')).toBeDefined()
    expect(kv.get('ARCH.sections')).toBeDefined()
    // 无架构空洞与重号时脚本 exit=0
    expect(kv.get('ARCH.holes')).toBe('none')
    expect(kv.get('ARCH.duplicates')).toBe('0')
  })

  it('文档中的每个 KEY=VALUE 与现读逐字一致（防手改）', () => {
    const out = runStatus()
    const kv = parseKv(out)
    const doc = readFileSync(DOC_REL, 'utf8')
    const block = doc.match(/<!-- PHASE-STATUS:BEGIN-KV -->([\s\S]*?)<!-- PHASE-STATUS:END-KV -->/)
    expect(block, 'PHASE-STATUS 里必须有 BEGIN-KV…END-KV 块').toBeTruthy()
    if (!block) return
    const kvInDoc = [...block[1].matchAll(/^([A-Za-z][\w.]*)=([\w.,-]+)\s*$/gm)]
    expect(kvInDoc.length).toBeGreaterThan(10)
    const docKeys = new Set(kvInDoc.map((m) => m[1]))
    expect(docKeys.has('KI.rows')).toBe(true)
    expect(docKeys.has('ARCH.maxSection')).toBe(true)
    for (const m of kvInDoc) {
      const [, k, v] = m
      expect(kv.has(k), `脚本里没有 KEY=${k}：脚本与文档分家了`).toBe(true)
      expect(kv.get(k), `${k}：文档=${v}，脚本现读=${kv.get(k)}`).toBe(v)
    }
  })

  it('PHASE-STATUS.md 显式指引读者跑 npm run status', () => {
    const doc = readFileSync(DOC_REL, 'utf8')
    expect(doc).toMatch(/npm run status/)
    expect(doc).toMatch(/phase-status\.test\.ts/)
  })

  it('嵌入的脚本命令与 deps 数与 package.json 一致', () => {
    const out = runStatus()
    const kv = parseKv(out)
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(Number(kv.get('PKG.scripts'))).toBe(Object.keys(pkg.scripts ?? {}).length)
    expect(Number(kv.get('PKG.deps'))).toBe(Object.keys(pkg.dependencies ?? {}).length)
    expect(Number(kv.get('PKG.devDeps'))).toBe(Object.keys(pkg.devDependencies ?? {}).length)
  })

  it('ARCH 名册自洽：maxSection 等于节号名册的最大值且连续', () => {
    const out = runStatus()
    const kv = parseKv(out)
    expect(Number(kv.get('ARCH.sections'))).toBe(Number(kv.get('ARCH.maxSection')))
    expect(kv.get('ARCH.holes')).toBe('none')
  })

  it('KI 嵌入数字与账本行数一致（不要凭叙冒）', () => {
    const out = runStatus()
    const kv = parseKv(out)
    const sum = Number(kv.get('KI.Implemented')) + Number(kv.get('KI.Partial')) +
      Number(kv.get('KI.Placeholder')) + Number(kv.get('KI.Blocked'))
    expect(sum).toBe(Number(kv.get('KI.rows')))
  })
})

/**
 * KI-438 的两族新腿。前提不是想出来的，是 `.scratch/ki438/census.mjs` 量出来的：
 * 本文档原先在机读区之外另养一张手抄「快照表」，那一张与机器块同时说着两句相反的话
 * （6 处已经不符、4 处只是碰巧对上、另有 11 处计数没有任何读者能核对），而**没有一扇门读过它**。
 * 所以：① 机读区之外不许再出现「有名有姓的 KEY 配一个数」；② 机读区之外的计数句要么点名一条
 * 账本读得到的记录，要么不许存在；③ 回填工具本身要证幂等、行尾跟随文档、键集变化当场拒绝。
 */

const readDoc = () => readFileSync(DOC_REL, 'utf8')
const liveKv = () => kvLinesFrom(runStatus(), 'npm run status（现读）')

/** 机读区（两根锚之间，含锚与围栏）之外的行——下面两族的总体就是这一片 */
function proseLines(text: string) {
  const lines = text.split(/\r?\n/)
  const b = lines.indexOf(BEGIN)
  const e = lines.indexOf(END)
  expect(b, `机读区的 ${BEGIN} 锚读不到（找到第 ${b} 行）`).toBeGreaterThanOrEqual(0)
  expect(e, `机读区的 ${END} 锚读不到（找到第 ${e} 行）`).toBeGreaterThan(b)
  return lines.map((line, i) => ({ no: i + 1, line })).filter((x) => x.no - 1 < b || x.no - 1 > e)
}

/** 「KEY 名 + 紧跟一个数」的形状：名册现推自 `npm run status`，不手抄 */
function keyNumberHits(rows: { no: number; line: string }[], keys: string[]) {
  const hits: { no: number; key: string; doc: string; line: string }[] = []
  for (const { no, line } of rows) {
    for (const k of keys) {
      let idx = line.indexOf(k)
      while (idx !== -1) {
        const rest = line.slice(idx + k.length).replace(/^[\s|=`、:，.。\-—*]+/, '')
        const m = /^([\d.]+)/.exec(rest)
        if (m) hits.push({ no, key: k, doc: m[1], line: line.trim().slice(0, 80) })
        idx = line.indexOf(k, idx + k.length)
      }
    }
  }
  return hits
}

/**
 * 「计数句」的总体：数字紧跟下面这些量词之一（或 `Implemented：N` 那种快照形状）。
 * 总体之外仍有别的计数拼法（「7 区」「10 怪」「15 任务」「60fps」），那些是 §30 那张出口门表的内容，
 * 它们该不该被机器读是 KI-028② 那格没结的事——本族只钉「同一枚计数有两个主人」这一族，
 * 不在这里冒充全库普查（账本 KI-438 的还欠栏登记这一点）。
 */
const COUNT_UNITS = ['条', '行', '文件', '张', '份文本', 'ERROR', 'WARN', 'advisories', 'vulnerabilit']
const COUNT_SHAPE = new RegExp(`[\\d.]+\\s*(?:${COUNT_UNITS.join('|')})|Implemented[：:]\\s*\\d`)
const ledgerIds = new Set(
  [...readFileSync(join(ROOT, 'docs', 'KNOWN_ISSUES.md'), 'utf8').matchAll(/^\|\s*((?:KI|TD|PF)-\d+)\s*\|/gm)].map((m) => m[1]),
)
const citedId = (line: string) => [...line.matchAll(/\b(KI|TD|PF)-(\d{3,4})\b/g)].map((m) => m[0])

const TMP = mkdtempSync(join(tmpdir(), 'caesura-kvembed-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('PHASE-STATUS：机读区之外不许有第二份计数（KI-438）', () => {
  it('判据的判据：正文有可读的行，而插一张快照表就被抓到', () => {
    const rows = proseLines(readDoc())
    expect(rows.length, '机读区之外只读到 0～30 行 ⇒ 下面两族判的是空集，绿不代表没病').toBeGreaterThan(30)
    const keys = liveKv().map((l) => l.split('=')[0])
    expect(keys.length, `现读名册只 ${keys.length} 枚 KEY = 取数工具读空了`).toBeGreaterThan(15)
    const doc = readDoc()
    // 插在 END 锚**之后**：插进两根锚之间就落回机器块，那一块本来就不属于这一族的总体
    const eol = eolOf(doc)
    const planted = doc.replace(`${END}${eol}`, `${END}${eol}| KI.rows | 343 | 手抄快照 |${eol}`)
    expect(planted, '植入没生效（END 锚的写法变了）').not.toBe(doc)
    const hits = keyNumberHits(proseLines(planted), keys)
    expect(hits.length, '植入一行快照表却一个都没抓到 ⇒ 这一族在空转').toBeGreaterThan(0)
    const caught = hits.filter((h) => h.key === 'KI.rows')
    expect(caught.map((h) => h.doc), '抓到的必须是植入的那一格、那个数（只有一处）').toEqual(['343'])
  })

  it('正文里不许出现「有名有姓的 KEY 配一个数」（快照表的形状）', () => {
    const keys = liveKv().map((l) => l.split('=')[0])
    const hits = keyNumberHits(proseLines(readDoc()), keys)
    expect(
      hits.map((h) => `L${h.no}  ${h.key}=${h.doc}  ←  ${h.line}`),
      '这些数在正文里点名了机器块的 KEY，却又不在机器块里——读者无法知道哪一个作数（要改就改机器块的主人 `scripts/phase-status.mjs`，然后 `npm run status:embed`）',
    ).toEqual([])
  })

  it('正文里的计数句要么点名一条账本读得到的记录，要么不许存在', () => {
    const rows = proseLines(readDoc())
    const counted = rows.filter((r) => COUNT_SHAPE.test(r.line))
    expect(counted.length, '本文一条计数句都没读到 = 这一族的总体空了，判据在自证干净').toBeGreaterThanOrEqual(1)
    const unattributed = counted.filter((r) => !citedId(r.line).some((id) => ledgerIds.has(id)))
    expect(
      unattributed.map((r) => `L${r.no}  ${r.line.trim().slice(0, 90)}`),
      `这些计数句没有点任何一条账本读得到的 KI/TD/PF 记录（名册此刻 ${ledgerIds.size} 个号）：要么删掉那个数，要么把它接给一行账`,
    ).toEqual([])
    expect(
      counted.filter((r) => citedId(r.line).some((id) => ledgerIds.has(id))).length,
      '豁免面必须有真读者：正文里至少一条计数句确实点了账本上有的号'
    ).toBeGreaterThan(0)
    // 两面：植入一句无主的计数 ⇒ 多抓一条；植入一句有主的 ⇒ 一条不多抓（否则豁免就成了空话）
    const noOwner = (text: string) =>
      proseLines(text).filter((r) => COUNT_SHAPE.test(r.line) && !citedId(r.line).some((id) => ledgerIds.has(id))).length
    const doc = readDoc()
    const eol = eolOf(doc)
    const orphan = doc.replace(`${END}${eol}`, `${END}${eol}正文里顺手写了 999 条读数。${eol}`)
    const owned = doc.replace(`${END}${eol}`, `${END}${eol}KI-408 那批升级共 999 条。${eol}`)
    expect(orphan, '植入没生效（END 锚的写法变了）').not.toBe(doc)
    expect(owned, '植入没生效（END 锚的写法变了）').not.toBe(doc)
    expect(noOwner(orphan), '植入的无主计数句没被抓到').toBe(unattributed.length + 1)
    expect(noOwner(owned), '点了 KI-408 的那一句被当成了无主计数 ⇒ 豁免那条腿是假的').toBe(unattributed.length)
  })
})

describe('scripts/phase-status-embed.mjs：回填这件事的脾气（KI-438）', () => {
  /**
   * 测试平面：只借现读的那批 KEY，机读区按工具预期的形状自己搭。
   * 为什么要平面而不是真文档（KI-438 臂 A1 实测出来的）：这两族判的是**工具的脾气**（行尾、退出码、拒绝形状），
   * 而「真文档此刻新不新鲜」已经由「幂等」与「npm 那一格」两条腿专管了。让它们读真文档，
   * 改一枚数就会连坐四条形不相干的腿 ⇒ 臂的判决不再指得出是谁的病。
   */
  const planeDoc = (kvLines: string[], eol: '\n' | '\r\n') =>
    ['# 合成的 PHASE-STATUS（测试平面）', '', BEGIN, '```', ...kvLines, '```', END, ''].join(eol)

  it('幂等：机读区已一致时再嵌一次，字节不动', () => {
    const doc = readDoc()
    const kv = liveKv()
    const r = spliceKv(doc, kv)
    expect(r.keys, '回填的 KEY 枚数就是现读的枚数').toBe(kv.length)
    expect(r.changed, '已经一致 ⇒ 不该报告任何一格变了').toEqual([])
    expect(r.sameBytes).toBe(true)
    expect(r.text).toBe(doc)
    // 再跑一趟仍要字节相同（幂等不是一句注释，是能连跑两次的性质）
    expect(spliceKv(r.text, kv).text).toBe(doc)
  })

  it('行尾跟着文档自己走：同一批 KEY 嵌进 CRLF 那份，出来的还是 CRLF', () => {
    const kv = liveKv()
    const rowsLine = kv.find((l) => l.startsWith('KI.rows='))
    expect(rowsLine, '现读里没有 KI.rows = 名册变了而这一族还在钉它').toBeTruthy()
    const staleValue = Number(rowsLine!.split('=')[1]) + 7
    const lf = planeDoc(kv, '\n')
    const crlf = planeDoc(kv, '\r\n')
    expect(eolOf(lf), 'LF 平面读成 LF').toBe('\n')
    expect(eolOf(crlf), '换了行尾就该读成 CRLF，判据不许跟着行尾变窄').toBe('\r\n')
    const stale = crlf.replace(rowsLine!, `KI.rows=${staleValue}`)
    expect(stale, '植入那枚过期数没生效（平面里的写法变了）').not.toBe(crlf)
    const r = spliceKv(stale, kv)
    expect(r.changed.map((c) => `${c.key}:${c.from}→${c.to}`), '只该报告 KI.rows 这一格').toEqual([`KI.rows:${staleValue}→${rowsLine!.split('=')[1]}`])
    expect(r.eol).toBe('\r\n')
    expect(r.text, '改完的 CRLF 文档就该等于原本一致的那份 CRLF').toBe(crlf)
    expect(r.text.match(/(?<!\r)\n/g) ?? [], '输出里不许混进一枚裸 LF').toEqual([])
    // 另一个方向同一件事：LF 平面被改坏，回填不许把它胀成 CRLF（那一族在 Windows 工作树上的同族病）
    const rf = spliceKv(lf.replace(rowsLine!, `KI.rows=${staleValue}`), kv)
    expect(rf.eol).toBe('\n')
    expect(rf.text).toBe(lf)
    expect(() => eolOf('a\r\nb\nc'), '行尾混着两种的时候这份工具要拒绝猜').toThrow(/行尾混着两种/)
  })

  it('键集一变就抛错并点名掉谁／多谁；读数形状不对也在门口就拒', () => {
    const kv = liveKv()
    const plane = planeDoc(kv, '\n')
    expect(() => spliceKv(plane, kv.filter((l) => !l.startsWith('KI.rows=')))).toThrow(/掉：KI\.rows/)
    expect(() => spliceKv(plane, [...kv, 'NEWKITTEN=1'])).toThrow(/多：NEWKITTEN/)
    expect(() => spliceKv(plane, kv.filter((l) => !l.startsWith('KI.rows=')).concat(['NEWKITTEN=1']))).toThrow(/掉：KI\.rows｜多：NEWKITTEN/)
    expect(() => kvLinesFrom('# 一句散文\nKI.rows=1', 'synthetic.txt')).toThrow(/synthetic\.txt 里有 1 行不是 KEY=VALUE/)
    expect(() => kvLinesFrom('', 'synthetic.txt')).toThrow(/synthetic\.txt 读出来是空集/)
    expect(() => kvLinesFrom('KI.rows=1\nKI.rows=2', 'synthetic.txt')).toThrow(/synthetic\.txt 里 KEY 重了：KI\.rows/)
    expect(() => kvLinesFrom('KI.rows=1 2', 'synthetic.txt')).toThrow(/不是 KEY=VALUE/)
    expect(() => spliceKv('没有锚的一份文档', kv)).toThrow(/锚读不到/)
  })

  it('--check 走真子进程：一致的平面退出码 0，手改过一枚数的平面退出码 3 并点名，且都不写盘', () => {
    const kv = liveKv()
    const rowsLine = kv.find((l) => l.startsWith('KI.rows='))!
    const docPath = join(TMP, 'PHASE-STATUS.md')
    const readPath = join(TMP, 'reading.txt')
    writeFileSync(readPath, runStatus())
    writeFileSync(docPath, planeDoc(kv, '\n'))
    const check = () => spawnSync(process.execPath, [EMBED_REL, `--doc=${docPath}`, `--status=${readPath}`, '--check'], { encoding: 'utf8' })
    const ok = check()
    expect(ok.stderr, ok.stderr).toBe('')
    expect(ok.status, `一致却非 0：${ok.stderr}`).toBe(0)
    expect(ok.stdout).toMatch(/机读区 \d+ 枚 KEY 与现读逐字一致/)

    writeFileSync(docPath, planeDoc(kv, '\n').replace(rowsLine, 'KI.rows=999999'))
    const before = readFileSync(docPath, 'utf8')
    const bad = check()
    expect(bad.status, `不一致却返回 ${bad.status}（--check 要的是退出码 3）`).toBe(3)
    expect(bad.stderr, '不一致要点名是哪一枚 KEY、旧值新值各是多少').toMatch(/KI\.rows: 文档=999999 → 现读=\d+/)
    expect(readFileSync(docPath, 'utf8'), '--check 不许写盘').toBe(before)

    // 默认那一趟（不带 --check）才写，而且写完就一致了
    const wrote = spawnSync(process.execPath, [EMBED_REL, `--doc=${docPath}`, `--status=${readPath}`], { encoding: 'utf8' })
    expect(wrote.status, wrote.stderr).toBe(0)
    expect(wrote.stdout).toMatch(/重落 \d+ 枚 KEY，其中变了 1 枚/)
    expect(check().status, '回填之后 --check 就该是 0').toBe(0)
  })

  it('npm 那一格真的指着这份工具（门跑的是命令，不是文件名）', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const cmd = pkg.scripts['status:embed']
    expect(cmd, 'package.json 里没有 status:embed 这一格 = 文档教读者跑一条不存在的命令').toBeTruthy()
    const [word, rel, ...rest] = cmd!.split(/\s+/)
    expect(word, `这一格该用 node 直接起脚本，实际是 ${word}`).toBe('node')
    expect(rest).toEqual([])
    expect(resolve(ROOT, rel), 'npm 那一格指的文件 ≠ 本门进程内 import 的那份').toBe(EMBED_REL)
    const r = spawnSync(process.execPath, [EMBED_REL, '--check'], { encoding: 'utf8' })
    expect(r.stdout + r.stderr, `npm 那一格的命令在真仓库上跑不通：${r.stderr}`).match(/与现读逐字一致/)
    expect(r.status, '真仓库的机读区此刻就该是一致的').toBe(0)
  })
})
