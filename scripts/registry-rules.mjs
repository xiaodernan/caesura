/**
 * scripts/registry-rules.mjs — 正册（`docs/KNOWN_ISSUES.md`）那四张表的**行形状**判据（纯函数，零依赖）。
 *
 * 为什么单独一个文件（与 `ledger-rules.mjs`、`id-rules.mjs` 同一个理由）：判据留在测试文件里就没法被合成夹具喂。
 *
 * **这一族在管什么**：KI-327 量出来的三件事——
 *   ① **§8.1 承诺与实况不符**：它写着「四张表…状态只允许 `Implemented | Partial | Placeholder | Blocked`」，
 *      而正册里 §2/§3/§4 三张表**根本没有状态列** ⇒ 那三张表里的债／限制没有机器可读的状态，
 *      "这笔销了没有"只能靠散文（TD 表靠那段「留号不留行」的注记，PF/ENV 连那点机制都没有）。
 *   ② **按号引用只判了 KI-**：门 B 扫的是 `KI-\d+`，`TD-`/`PF-`/`ENV-` 的按号引用读不到行**至今没人判**
 *      （今天量到 20 个不同的号、约 220 处引用；悬空的那几个恰好都在登记处 ⇒ 那是运气，不是门）。
 *   ③ **§1.5 有一行按竖线切出五格**：缺口栏里写着 `{item,count}` 与 `{flag}` 两个形状，中间是**裸竖线**
 *      ⇒ 任何按格数解析的读者读出的是垃圾（门 D 的同族；门 D 只看 KI 行，看不见它）。
 *
 * 三道判据：
 *   I1 **行形状按 ID 前缀**：KI/TD/PF 行恰 4 格、ENV 行恰 5 格，末格取自 §78 词表（**从正册第 3 行现推**，不抄第二份）。
 *   I2 **按号引用必须读得到行**：全库 `TD-`/`PF-`/`ENV-` 的引用，要么指到正册里活着的行，要么指到那段注记里已销案的号。
 *   I3 **§1.5 那一行不许多切一格**：那张表的每一行按竖线切必须恰好是表头那么多格。
 *
 * **为什么形状按「ID 前缀」判而不是按「哪张表」判**：§4 那一节底下还住着 134 行 KI 记录
 * （KI-158 那笔债：它们住在「Missing Assets」标题底下，至今没挪）。按表判的话，
 * §4 的表头就得同时描述两种行形状——做不到；按前缀判，每一行的形状是确定的，而 §4 的表头说的是它本家那类行。
 */

/** 认转义的竖线切分（与门 D 同一把尺子）：`\|` 是内容，不是分格 */
const cellsOf = (line) => line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())

/**
 * 每类号的行形状（**判据本身**，所以写死；数据才不许写死）。
 * `cells` 是按竖线切出来的格数，`status` 是末格是不是 §78 状态列。
 */
export const ROW_SHAPES = {
  KI: { cells: 4, status: true },
  TD: { cells: 4, status: true },
  PF: { cells: 4, status: true },
  ENV: { cells: 5, status: true },
}

/**
 * 四张表各自本家的前缀（表头的列数按它判）。
 *
 * **键是表号而不是整段标题**——标题在正册里都带中文后缀（`2. Technical Debt（技术债）`），
 * 而本仓库的纪律是**不许抄第二份**：标题变了（多一句话、换个括号）而名单没跟着改，
 * 那道判据就会**静默地不跑**（第一版就是这么写的，合成夹具那一臂当场把它打出来）。
 * 所以这里按**表号**认表，标题只用来取那个号。
 */
export const TABLE_PREFIX = {
  '1': 'KI',
  '2': 'TD',
  '3': 'PF',
  '4': 'ENV',
}

/** 一张表的小节号（`2. Technical Debt（技术债）` → `2`；`1.5 系统状态总表…` → `1.5`） */
export function tableNumber(title) {
  const m = /^(\d+(?:\.\d+)?)\b/.exec(String(title ?? ''))
  return m ? m[1] : ''
}

/**
 * §78 状态词表**从正册自己现推**（不许抄第二份——抄的那份一定会漂）。
 * @param ledgerText 正册全文
 * @returns 词表（按正册里出现的顺序）
 */
export function statusVocab(ledgerText) {
  if (typeof ledgerText !== 'string') return []
  const line = ledgerText.split(/\r?\n/).find((l) => l.startsWith('状态词表：'))
  if (!line) return []
  return [...line.matchAll(/\*\*([A-Za-z]+)\*\*/g)].map((m) => m[1])
}

/**
 * 正册的表：按 `## ` 标题切，每张表带表头与数据行。
 * @param ledgerText 正册全文
 */
export function ledgerTables(ledgerText) {
  if (typeof ledgerText !== 'string') return []
  const lines = ledgerText.split(/\r?\n/)
  const tables = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const h = /^##\s+(.*)$/.exec(lines[i])
    if (h) {
      cur = { title: h[1].trim(), headLine: i + 1, head: null, rows: [] }
      tables.push(cur)
      continue
    }
    if (!cur || !lines[i].startsWith('|')) continue
    if (/^\|[\s:|-]+$/.test(lines[i])) continue
    const cells = cellsOf(lines[i])
    if (!cur.head && cells.every((c) => c && !/^[A-Z]+-\d+$/.test(c))) {
      cur.head = { line: i + 1, cells }
      continue
    }
    cur.rows.push({ line: i + 1, cells, id: cells[0] ?? '' })
  }
  return tables
}

/**
 * 判据 I1：非 KI 行按前缀判形状 ＋ 末格状态；每张表的表头列数按它本家那类行判。
 * （KI 行的格数与 P 档由门 D 守着，这里不重复——**不重不漏**。）
 * @param ledgerText 正册全文
 */
export function rowShapeFindings(ledgerText) {
  const out = []
  const vocab = statusVocab(ledgerText)
  if (vocab.length < 3) {
    out.push({
      key: '状态词表',
      msg: `从正册的「状态词表」那一行只推导出 ${vocab.length} 个词 ⇒ 判据在读一个几乎空的集合（不许抄第二份，所以只能从正册现推）。`,
    })
    return out
  }
  for (const t of ledgerTables(ledgerText)) {
    const native = TABLE_PREFIX[tableNumber(t.title)]
    if (native) {
      const want = ROW_SHAPES[native].cells
      const got = t.head ? t.head.cells.length : 0
      if (got !== want) {
        out.push({
          key: `${t.title} 表头`,
          msg: `这张表的表头切出 ${got} 格，而它本家那类行（${native}-）是 ${want} 格 ⇒ 表头与自己的行对不上。` +
            '修法：把表头改成与行同格数（行的形状由门 I1 按 ID 前缀定死）。',
        })
      }
    }
    for (const r of t.rows) {
      const m = /^([A-Z]+)-\d+$/.exec(r.id)
      if (!m) continue
      const prefix = m[1]
      const shape = ROW_SHAPES[prefix]
      if (!shape) continue
      if (r.cells.length !== shape.cells) {
        out.push({
          key: `${r.id}（第 ${r.line} 行）`,
          msg: `${r.id}（第 ${r.line} 行）这一行按竖线切出 ${r.cells.length} 格，而 ${prefix}- 行必须 ${shape.cells} 格（ID ｜ … ｜ 状态）⇒ ` +
            '任何按格数解析的读者读出来的都是错位的格子。修法：把描述栏里的裸竖线写成转义形 `\\|`，或补齐／删掉该格。',
        })
        continue
      }
      if (!shape.status) continue
      const last = r.cells[r.cells.length - 1] ?? ''
      if (!vocab.includes(last)) {
        out.push({
          key: `${r.id}（第 ${r.line} 行）`,
          msg: `${r.id}（第 ${r.line} 行）的末格是「${last.slice(0, 40)}」，不在 §78 词表（${vocab.join(' / ')}）里 ⇒ ` +
            '这一行读不出状态："它还欠着没有"这件事只能靠散文。修法：末格写词表里的那一个词。',
        })
      }
    }
  }
  return out
}

/**
 * 判据 I2：全库 `TD-`/`PF-`/`ENV-` 的按号引用必须读得到行。
 *
 * **什么算读得到**：① 正册里活着的行；② 正册那段「销案的债留号不留行」注记里点过名的号
 * （它们销案了，但历史叙述还在按号引用它们——把那种引用判成空气才是真的错）。
 * @param input `{ files, ledgerText }`
 */
export function idReferenceFindings({ files, ledgerText }) {
  const out = []
  const live = new Set()
  for (const t of ledgerTables(ledgerText)) {
    for (const r of t.rows) {
      if (/^(TD|PF|ENV)-\d+$/.test(r.id)) live.add(r.id)
    }
  }
  const retired = new Set(
    [...(typeof ledgerText === 'string' ? ledgerText : '').matchAll(/~~(TD-\d+)~~/g)].map((m) => m[1]),
  )
  for (const f of files ?? []) {
    if (!f || typeof f.text !== 'string') continue
    const lines = f.text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(/\b(TD|PF|ENV)-(\d{3})\b/g)) {
        const id = m[0]
        if (live.has(id) || retired.has(id)) continue
        out.push({
          key: `${f.rel}:${i + 1}`,
          msg: `这里按号引用了 ${id}，而正册里没有那一行（活着的行 ${[...live].sort().join(' ') || '一条也没有'}；` +
            `注记里已销案的号 ${[...retired].sort().join(' ') || '一个也没有'}）⇒ 读者按号去找账，找到的是空气。` +
            '修法：要么把它改成真正在册的那个号，要么补登记（号 + 该表的列 + 状态）。',
        })
      }
    }
  }
  return out
}

/**
 * 判据 I3：§1.5「系统状态总表」那张表的每一行按竖线切必须恰好是表头那么多格。
 *
 * 它与门 D 同族但不同片：门 D 看的是**账本里 KI 记录那些行**，而 §1.5 的行首格是系统名、不是号 ⇒ 门 D 看不见它。
 * @param ledgerText 正册全文
 */
export function statusOverviewFindings(ledgerText) {
  const out = []
  const tables = ledgerTables(ledgerText)
  const t = tables.find((x) => x.title.startsWith('1.5'))
  if (!t) {
    out.push({ key: '§1.5', msg: '正册里找不到 §1.5「系统状态总表」⇒ 这道门在读一个不存在的集合。' })
    return out
  }
  if (!t.head) {
    out.push({ key: '§1.5', msg: '§1.5 那张表读不到表头 ⇒ 这道门在读一个空集合。' })
    return out
  }
  const arity = t.head.cells.length
  for (const r of t.rows) {
    if (r.cells.length === arity) continue
    out.push({
      key: `§1.5 第 ${r.line} 行`,
      msg: `这一行按竖线切出 ${r.cells.length} 格，而这张表的表头是 ${arity} 格 ⇒ ` +
        '缺口栏里写着**裸竖线**（常见写法是"两个形状 `{a}` | `{b}`"），任何按格数解析的读者读出的是错位的格子。' +
        '修法：把那个竖线写成转义形 `\\|`（门 D 对账本那些行也是这么修的）。',
    })
  }
  return out
}

/** 名册自证用：这四张表各自的原生前缀在正册里都得真有一行（否则 §8.2 那条规则句喊了一个没人用的前缀） */
export function prefixCoverageFindings(ledgerText) {
  const out = []
  const seen = new Set()
  for (const t of ledgerTables(ledgerText)) {
    for (const r of t.rows) {
      const m = /^([A-Z]+)-\d+$/.exec(r.id)
      if (m) seen.add(m[1])
    }
  }
  for (const [num, prefix] of Object.entries(TABLE_PREFIX)) {
    if (seen.has(prefix)) continue
    out.push({
      key: prefix,
      msg: `§8.2 的规则句喊了 ${prefix}- 前缀，而正册里第 ${num} 张表一条 ${prefix}- 行都没有 ⇒ ` +
        '那个前缀是空的（要么该表真的空着——那规则句该说明；要么前缀该去掉）。',
    })
  }
  return out
}
