/**
 * scripts/phase-status-embed.mjs —— 把 `npm run status` 的现读输出嵌回 `docs/PHASE-STATUS.md` 的机读区。
 *
 * 为什么仓内要有这一份（KI-438）：KI-416 把「回填」这件事派给了每一批落账的人，却没给它一把工具，
 * 于是每一批都在 `.scratch/` 里现写一份一次性的、跑完就丢——KI-437 落账那一趟就因为没人回填而红过一条腿。
 * 判据住在 `tests/unit/phase-status.test.ts`：本文档机读区里每一个 `KEY=VALUE` 必须与现读逐字一致。
 *
 * 三种用法：`--check` 只报不写（不一致 ⇒ 退出码 3，点名是哪几枚 KEY）；默认写；
 * `--doc=` / `--status=` 只给测试用（临时平面与合成读数），生产入口走的是 `npm run status:embed`。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DOC_DEFAULT = join(ROOT, 'docs', 'PHASE-STATUS.md')
export const STATUS_DEFAULT = join(ROOT, 'scripts', 'phase-status.mjs')
export const BEGIN = '<!-- PHASE-STATUS:BEGIN-KV -->'
export const END = '<!-- PHASE-STATUS:END-KV -->'

/** 只认「整行文件自己的行尾」：混着两种行尾的文档不是这份工具该猜的东西 */
export function eolOf(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length
  if (crlf !== 0 && crlf !== lf) throw new Error(`机读区所在文档行尾混着两种（CRLF ${crlf}／总 ${lf}）——先归一再说`)
  return crlf === lf && crlf > 0 ? '\r\n' : '\n'
}

/** 现读输出（或注入的读数文件）→ KEY=VALUE 行；形状不对当场点名，不许退化成空块 */
export function kvLinesFrom(text, source) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const bad = lines.filter((l) => !/^[A-Z][A-Za-z.]*=[^\s|]+$/.test(l))
  if (bad.length) throw new Error(`${source} 里有 ${bad.length} 行不是 KEY=VALUE 形状，第一行：${JSON.stringify(bad[0].slice(0, 60))}`)
  if (!lines.length) throw new Error(`${source} 读出来是空集——空着回填等于把机读区抹掉`)
  const keys = lines.map((l) => l.split('=')[0])
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
  if (dup.length) throw new Error(`${source} 里 KEY 重了：${dup.join(',')}`)
  return lines
}

/**
 * 纯函数：把 kv 行嵌进文档的机读区。
 * KEY 集变了 ⇒ 抛错并点名掉谁/多谁（机读区的形状要连着门一起改，不许静悄悄覆盖）。
 * 返回 `changed` 是逐 KEY 的旧→新，供 --check 报告；无变化时输出与输入逐字节相同（幂等由这条保证）。
 */
export function spliceKv(docText, kvLines) {
  const eol = eolOf(docText)
  const lines = docText.split(/\r?\n/)
  const b = lines.indexOf(BEGIN)
  const e = lines.indexOf(END)
  if (b < 0 || e < 0) throw new Error(`机读区的锚读不到（BEGIN ${b}／END ${e}）`)
  if (lines.filter((l) => l === BEGIN).length !== 1) throw new Error(`${BEGIN} 不止一根`)
  if (lines.filter((l) => l === END).length !== 1) throw new Error(`${END} 不止一根`)
  if (lines[b + 1] !== '```' || lines[e - 1] !== '```')
    throw new Error(`机读区的代码围栏形状不是预期：${JSON.stringify([lines[b + 1], lines[e - 1]])}`)

  const oldKv = lines.slice(b + 2, e - 1)
  const oldKeys = oldKv.map((l) => l.split('=')[0])
  const newKeys = kvLines.map((l) => l.split('=')[0])
  const dropped = oldKeys.filter((k) => !newKeys.includes(k))
  const gained = newKeys.filter((k) => !oldKeys.includes(k))
  if (dropped.length || gained.length)
    throw new Error(`KEY 集变了（掉：${dropped.join(',') || '无'}｜多：${gained.join(',') || '无'}）：机读区的形状要连着 tests/unit/phase-status.test.ts 一起改`)

  const changed = kvLines
    .map((n) => {
      const k = n.split('=')[0]
      const o = oldKv.find((l) => l.split('=')[0] === k)
      return o === n ? null : { key: k, from: o?.split('=').slice(1).join('=') ?? '—', to: n.split('=').slice(1).join('=') }
    })
    .filter(Boolean)

  const next = [...lines.slice(0, b + 2), ...kvLines, ...lines.slice(e - 1)].join(eol)
  // 「一致」按字节判，不按 changed 那格判：同一批 KEY 换了顺序也是机读区动了
  const sameBytes = next === docText
  return { text: next, eol, changed, keys: kvLines.length, sameBytes }
}

/** 跑真取数工具拿现读（测试注入 `--status=` 时不走这里） */
export function liveKvLines(statusScript) {
  return kvLinesFrom(execFileSync(process.execPath, [statusScript], { encoding: 'utf8' }), statusScript)
}

export function main(argv = process.argv.slice(2)) {
  const get = (name) => {
    const m = argv.find((a) => a.startsWith(`--${name}=`))
    return m ? m.slice(name.length + 3) : null
  }
  const docPath = get('doc') ?? DOC_DEFAULT
  const statusPath = get('status') ?? STATUS_DEFAULT
  const kv = get('status')
    ? kvLinesFrom(readFileSync(resolve(ROOT, statusPath), 'utf8'), statusPath)
    : liveKvLines(statusPath)
  const docText = readFileSync(docPath, 'utf8')
  const { text, eol, changed, keys, sameBytes } = spliceKv(docText, kv)

  if (argv.includes('--check')) {
    if (sameBytes) {
      console.log(`[status:check] ${docPath}：机读区 ${keys} 枚 KEY 与现读逐字一致`)
      return 0
    }
    console.error(`[status:check] ${docPath}：机读区与现读不符 —— 跑 npm run status:embed 回填，不要手改`)
    for (const c of changed) console.error(`    ${c.key}: 文档=${c.from} → 现读=${c.to}`)
    if (!changed.length) console.error('    数值一枚没变，是 KEY 的顺序漂了')
    return 3
  }
  if (sameBytes) {
    console.log(`[status:embed] ${docPath}：机读区 ${keys} 枚 KEY 本已一致（幂等：没有写盘，字节不动）`)
    return 0
  }
  writeFileSync(docPath, text)
  console.log(`[status:embed] ${docPath}（行尾 ${JSON.stringify(eol === '\r\n' ? 'CRLF' : 'LF')}）：重落 ${keys} 枚 KEY，其中变了 ${changed.length} 枚`)
  for (const c of changed) console.log(`    ${c.key}: ${c.from} → ${c.to}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main()
