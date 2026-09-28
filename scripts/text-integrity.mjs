/**
 * scripts/text-integrity.mjs — 数据表「文本完整性」的判据本体（KI-082，纯函数、零依赖）
 *
 * 为什么单独一个文件（与 `ledger-rules.mjs` / `battle-rules.mjs` 同一条理由）：
 * `validate-data.mjs` 一被 import 就去校验真表并 `process.exit`，而本沙箱连 spawn 子进程都被宿主拒
 * （KI-075）⇒ 判据留在那个文件里，测试就没法"喂一段坏文本看它拒不拒"。搬出来之后，门禁与
 * `tests/unit/text-integrity.test.ts` 读的是**同一份**代码，而不是两份各自手抄的口径。
 *
 * 病是什么：这台机器上有一条并行的写盘路径，把中文写回 JSON 时会按别的代码页编/解码一次，
 * 产物不是"乱码"而是**静默丢字**。2026-09-28 实测：`states.json` 里 `§2.3` 被压成 `\uFFFD?.3`，
 * 文件仍是**合法 JSON**、`validate:data` 一路 OK、游戏照跑——只是那一句设计文档永远读不全了，
 * 而且没有任何机器看得见它。这一族以前全靠人眼撞见（`docs/KNOWN_ISSUES.md > KI-082` 里有完整台账），
 * 所以这里给它一句判据。
 */

/**
 * 唯一的坏字符：**U+FFFD REPLACEMENT CHARACTER**（源码里一律写成转义 `\uFFFD`——真字符只许出现在
 * 被扫的数据里；判据自己的源码带一个真的，会让下一个人分不清「这里是有意的」还是「这里又坏了一处」）。
 *
 * 它是"某个字节在解码时对不上任何字符"留下的记号——UTF-8 数据里出现它，只可能是有人拿别的
 * 代码页把一段合法文本编/解过一次然后写了回来。合并字符、变体选择符、零宽字符那些**不**在此列：
 * 它们各有正当用途，判据不能靠"这个字符中国人不常用"来定罪。
 *
 * 只认这一个（不预先编 U+FFFE/U+FFFF 那一族"UTF-16 字节序错位"）：本机**实测到的**产物只有 U+FFFD，
 * 没有证据的那一族等真见着再加——§55 那条"没有消费方不写进表"的纪律，对判据同样成立。
 */
export const MOJIBAKE_CHAR = '\uFFFD'

/** 报告里往外露多少个字符的上下文：够认出"哪个词坏了"，又不把整行抄进输出 */
const CONTEXT_CHARS = 12

/**
 * 一段文本里所有 U+FFFD 的位置（1 基行号、1 基列号，按文本先后）。
 * 列号是**码元**下标 + 1：只用来让人在编辑器里定位，不用来切片（`\r\n` 里的 `\r` 会占一列）。
 * 入参不是字符串就返回空数组而不是抛——门禁在最该说话的时候崩掉是最糟的一种。
 */
export function findMojibake(text) {
  const out = []
  if (typeof text !== 'string' || text.length === 0) return out
  let line = 1
  let lineStart = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') { line += 1; lineStart = i + 1; continue }
    if (ch === MOJIBAKE_CHAR) out.push({ line, column: i - lineStart + 1, index: i })
  }
  return out
}

/** 命中处那一整行的原文（用来给报告切上下文；不猜行尾风格，`\r` 会留在里面，取上下文时无所谓） */
function lineTextAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end === -1 ? text.length : end)
}

/** 命中处左右各露 `CONTEXT_CHARS` 个字符；两端截过的位置用省略号标出来（读报告的人要知道它不是行首） */
function contextAround(line, column) {
  const at = column - 1
  const from = Math.max(0, at - CONTEXT_CHARS)
  const to = Math.min(line.length, at + 1 + CONTEXT_CHARS)
  return `${from > 0 ? '…' : ''}${line.slice(from, to)}${to < line.length ? '…' : ''}`
}

/**
 * 扫一份「表名 + 原文」的清单 → findings（`{ level, file, where, msg }`，形状与 `battle-rules.mjs` 那一族一致）。
 *
 * 一行报一条（同一行里坏几个就在同一条里把列号都点出来）：一行被压坏通常是一个词、一处手误，
 * 逐字符报会让一次报告里出现一串几乎一样的行，反而看不出"是同一个地方坏的"。
 *
 * `where` 写「第 N 行」而不是 JSON 路径：坏字符是在**文本**层面出现的，压坏之后那条路径自己
 * 都可能读不出（比如一个 key 里的中文），能指路的只有行号 + 上下文。
 */
export function mojibakeFindings(entries) {
  const out = []
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    if (entry === null || typeof entry !== 'object') continue
    const file = typeof entry.file === 'string' ? entry.file : '(未命名表)'
    const hits = findMojibake(entry.text)
    if (hits.length === 0) continue
    /** 行号 → 这一行上的命中，保持文本顺序（同一行报一条） */
    const byLine = new Map()
    for (const hit of hits) byLine.set(hit.line, [...(byLine.get(hit.line) ?? []), hit])
    for (const [line, lineHits] of byLine) {
      const snippet = contextAround(lineTextAt(entry.text, lineHits[0].index), lineHits[0].column)
      const columns = lineHits.map((h) => h.column).join('、')
      out.push({
        level: 'error',
        file,
        where: `第 ${line} 行`,
        msg: `出现 ${lineHits.length} 个 U+FFFD 替换字符（第 ${columns} 列），上下文 ${JSON.stringify(snippet)}。`
          + '这不是"显示成乱码"——**数据已经写坏了**：某个汉字在写盘那一刻被按别的代码页编/解码过一次，'
          + '原文丢了，而文件仍然是合法 JSON（校验器读不出来、游戏照跑，只有那一句文档永远读不全）。'
          + '修法：把这一处的中文按设计原文重新敲回去（改编码设置救不回已经丢掉的字节）；'
          + '这一件事的台账与写盘纪律见 docs/KNOWN_ISSUES.md > KI-082。',
      })
    }
  }
  return out
}
