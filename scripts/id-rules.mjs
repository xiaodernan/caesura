/**
 * scripts/id-rules.mjs — 「号段只有一套」那几道判据（纯函数，零依赖）。
 *
 * 为什么单独一个文件（与 `ledger-rules.mjs` 同一个理由）：判据留在测试文件里就没法被合成夹具喂——
 * 那种门只能证明"作者试过一次"。抽出来之后，合成账本喂单元测试，真表喂真文档。
 *
 * **这一族在管什么**：KI-326 量出来的病不是"某一行写错了一个号"，而是**号段有两套**：
 *   - 架构 §8.2 那条规则句写着「前缀 + **4** 位序号（例 TD-0007）」；
 *   - 而正册 `docs/KNOWN_ISSUES.md` 实测 **249 行 KI 全是 3 位**（首格 4 位的＝0 行）、TD/ENV 也是 3 位、
 *     PF 与 MA 两个前缀**在正册从来没有行**（§3 那张表今天只有一行「暂无」，§4 用的是 ENV- 不是 MA-）；
 *   - 全库 4 位拼写实测 **14 处**（分布在 3 份文件的 8 行上）。
 * 门 B 此前用「4 位归一成 3 位再判能不能读到行」把这件事绕开了——**归一不是裁决**：它替写错的人把号擦掉，
 * 于是"两套号"这件事在机器眼里根本不存在。本文件把归一废掉：**号只许一套，就是正册的 3 位号**。
 *
 * 三道判据（各自都能被合成夹具喂）：
 *   ① 规则句 ↔ 正册实况同形：前缀集合逐字相等、位数相等、规则句举的例子必须是真的一个号；
 *   ② §8.3 的指针表 ↔ 正册行：每个号在正册**恰好一行**（不许 0 行、不许 2 行）；
 *   ③ 全库 4 位拼写只许出现在本文件的「已退役拼写名册」里（那里是它们唯一的家；文档里一个字都不许留）。
 *
 * **为什么"已退役拼写"要留一份名册而不是全删**：历史提交信息与旧架构版本里出现过那些拼写，
 * 读者按号去找账时会撞见它们；名册记着「它今天是什么」（正册里哪一行），并让门 ③ 认得出
 * 「这是登记处」与「这是笔误」。名册里的每一格都要自证：它指的那个号必须真的在正册里有一行。
 */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 正册在用的四个前缀（§8.2 那条规则句必须与它逐字相等） */
export const LEDGER_PREFIXES = ['ENV', 'KI', 'PF', 'TD']

/** 正册的号一律几位（销案的号留号不留行，编号不再复用 ⇒ 位数不会长） */
export const ID_DIGITS = 3

/**
 * 已退役的 4 位拼写 → 它今天是什么。
 *
 * 六格全部来自 2026-10-27 的普查（`.scratch/ki326-census.mjs`）：架构 §8.2 规则句自己举的例子 ＋
 * §8.3 五颗立项种子里的 4 位拼写。每一格都写着「它今天是什么」——因为**号被退役不等于事被丢掉**：
 * 三个种子进了正册（两个新号、一个沿用正册既有的 ENV-002）、一个种子是规则句的空例子。
 *
 * `now` 为 null 的那格（规则句的例子号）必须写清理由，且**不许**指向正册里的任何一行——
 * 它从来不是任何一笔债的号。
 */
export const RETIRED_SPELLINGS = {
  'KI-0001': {
    now: 'KI-001',
    why: '架构 §8.3 立项时登记的种子（Chromium 外手柄震动失效）——它今天就是正册 KI-001 那一行，语义逐字一致（正册那一行自己就写着这件事的来历）。',
  },
  'TD-0001': {
    now: 'TD-010',
    why: '架构 §8.3 立项时登记的种子（无动态 GI / Lumen 缺失）——它此前**从未进正册**：正册的 TD-001 是另一笔已销案的债（core/Input.ts 的 F1/F3/F4 死绑定，KI-058 结案），两件事同一个号 ⇒ 本批归一成新号 TD-010。',
  },
  'TD-0002': {
    now: 'TD-011',
    why: '架构 §8.3 立项时登记的种子（无全身 IK / Motion Warping）——它此前**从未进正册**：正册的 TD-002 是另一笔已销案的债（map 键开的却是调音桩面板，2026-10-08 结案），两件事同一个号 ⇒ 本批归一成新号 TD-011。',
  },
  'TD-0007': {
    now: null,
    why: '架构 §8.2 那条规则句自己举的例子号——它从来没有对应任何一行（正册当时也没有 TD-007），随规则句改成 3 位而退役。',
  },
  'MA-0001': {
    now: 'ENV-002',
    why: '架构 §8.3 立项时登记的种子（全部美术为程序化/低模占位）——正册一直用 **ENV-** 前缀记这件事（ENV-002「无外部美术资产来源…全部程序化几何+原创 shader+低模占位」），MA- 这个前缀在正册从来没有行 ⇒ 随本批一起退役。',
  },
  'PF-0001': {
    now: 'PF-001',
    why: '架构 §8.3 立项时登记的种子（尚未实测 60fps）——它此前**从未进正册**（§3 那张表当时只有一行「暂无（首次基准测试后登记）」），本批补登成 PF-001。',
  },
}

/** 规则句的形状：`ID 规则：<前缀表> 前缀 + <位数> 位序号（例 <号>）。` */
const RULE_RE = /^ID 规则：([^\s]+) 前缀 \+ (\d+) 位序号（例 ([A-Z]+-\d+)）。/m

/**
 * 解析架构 §8.2 那条规则句。
 * @param archText 架构文档全文
 * @returns `{ prefixes, digits, example }`；读不出来 ⇒ null（**不猜**：读不到就是读不到，让判据红在出处上）
 */
export function parseIdRule(archText) {
  if (typeof archText !== 'string') return null
  const m = RULE_RE.exec(archText)
  if (!m) return null
  const prefixes = m[1]
    .split('/')
    .map((p) => p.replace(/-+$/, ''))
    .filter(Boolean)
  return { prefixes, digits: Number(m[2]), example: m[3] }
}

/**
 * 正册的行：号、所在小节、按竖线切出来的格子（认转义形 `\|`——与门 D 同一把尺子）。
 * @param ledgerText 账本全文
 */
export function ledgerRows(ledgerText) {
  if (typeof ledgerText !== 'string') return []
  const lines = ledgerText.split(/\r?\n/)
  let section = '(表外)'
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,3}\s+(.*)$/.exec(lines[i])
    if (h) {
      section = h[1].trim()
      continue
    }
    const m = /^\|\s*([A-Z]+-\d+)\s*\|/.exec(lines[i])
    if (!m) continue
    out.push({
      id: m[1],
      line: i + 1,
      section,
      cells: lines[i].split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()),
    })
  }
  return out
}

/**
 * 架构 §8.3 那张指针表的行（**只认 §8.3 那一节**，别处长得像表头的行不算）。
 * @param archText 架构文档全文
 */
export function seedRows(archText) {
  if (typeof archText !== 'string') return []
  const lines = archText.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith('### 8.3'))
  if (start < 0) return []
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('### ')) break
    const m = /^\|\s*([A-Z]+-\d+)\s*\|([^|]*)\|/.exec(lines[i])
    if (!m) continue
    out.push({ id: m[1], line: i + 1, title: m[2].trim() })
  }
  return out
}

/**
 * 一个号在正册里只许有一行（跨前缀同号不算重号——那是两件事，各有各的号段）。
 * @param rows 正册行
 * @returns findings
 */
export function duplicateIdFindings(rows) {
  const byId = new Map()
  for (const r of rows ?? []) {
    if (!r?.id) continue
    byId.set(r.id, [...(byId.get(r.id) ?? []), r.line])
  }
  const out = []
  for (const [id, ls] of [...byId.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ls.length > 1) {
      out.push({
        key: id,
        msg: `正册里 ${id} 挂着 ${ls.length} 行（第 ${ls.join(' / ')} 行）＝ 一个号两件事，读者按号去找账读到的是哪一笔取决于运气。` +
          `修法：让后落的那一行让号（新号不许复用销案号），并同步全库按号引用。`,
      })
    }
  }
  return out
}

/**
 * 判据①：§8.2 那条规则句必须与正册实况同形。
 * @param input `{ archText, ledgerText }`
 */
export function ruleSentenceFindings({ archText, ledgerText }) {
  const out = []
  const rule = parseIdRule(archText)
  if (!rule) {
    out.push({
      key: '§8.2 ID 规则',
      msg: '架构 §8.2 的那条规则句读不出来（形状是「ID 规则：<前缀表> 前缀 + <位数> 位序号（例 <号>）。」）' +
        '⇒ 这道门在读一个空集合：要么规则句被改写了，要么它从来就不在这一节里。',
    })
    return out
  }
  const rows = ledgerRows(ledgerText)
  const ledgerPrefixes = [...new Set(rows.map((r) => r.id.replace(/-\d+$/, '')))].sort()
  const said = [...new Set(rule.prefixes)].sort()
  if (said.join(',') !== ledgerPrefixes.join(',')) {
    out.push({
      key: '§8.2 ID 规则',
      msg: `规则句说的前缀是 ${said.join('/')}，正册实际在用的是 ${ledgerPrefixes.join('/')} ⇒ ` +
        '**规则句与正册对不上号**：它要么漏了一个前缀（那个前缀的号没有出处），要么多喊了一个（那个前缀的号在正册一行都没有）。' +
        '修法：把规则句改成正册的实况——正册是唯一的号源（§8.1）。',
    })
  }
  const offDigits = rows.filter((r) => r.id.replace(/^\D+-/, '').length !== rule.digits)
  if (offDigits.length) {
    out.push({
      key: '§8.2 ID 规则',
      msg: `规则句说 ${rule.digits} 位，正册里这 ${offDigits.length} 行不是这个位数：` +
        offDigits.slice(0, 8).map((r) => `第 ${r.line} 行 ${r.id}`).join('、') +
        ' ⇒ 位数这一格也是规则与实况的分歧。',
    })
  }
  const hits = rows.filter((r) => r.id === rule.example)
  if (hits.length !== 1) {
    out.push({
      key: '§8.2 ID 规则',
      msg: `规则句举的例子 ${rule.example} 在正册里读到 ${hits.length} 行 ⇒ ` +
        '例子必须是**真的一个号**（读者按它去找账，得找得到）。换成一个在册的号。',
    })
  }
  return out
}

/**
 * 判据②：§8.3 的指针表里每个号，在正册必须**恰好一行**。
 * @param input `{ archText, ledgerText }`
 */
export function seedPointerFindings({ archText, ledgerText }) {
  const out = []
  const seeds = seedRows(archText)
  if (seeds.length < 5) {
    out.push({
      key: '§8.3 种子表',
      msg: `§8.3 那张表只读到 ${seeds.length} 行（地板 5）＝ 这道门在看一个空集合：那张表要么被改成了别的形状，要么整块没了。`,
    })
    return out
  }
  const rows = ledgerRows(ledgerText)
  for (const s of seeds) {
    const hits = rows.filter((r) => r.id === s.id)
    if (hits.length === 1) continue
    out.push({
      key: `§8.3 ${s.id}`,
      msg: hits.length === 0
        ? `§8.3 指的 ${s.id}（第 ${s.line} 行）在正册里**没有那一行** ⇒ 这颗种子至今没有家：读者按号去找账，找到的是空气。` +
          '修法：把它补登进正册（号 + 该表的列），或者把这一行改成它今天真正所在的那一行。'
        : `§8.3 指的 ${s.id}（第 ${s.line} 行）在正册里有 ${hits.length} 行（第 ${hits.map((h) => h.line).join(' / ')} 行）` +
          ' ⇒ 一个号两件事。修法：让其中一行让号（新号不许复用销案号），并同步全库按号引用。',
    })
  }
  return out
}

/**
 * 判据③：全库只许有一套号（3 位）。4 位拼写只许出现在本文件的「已退役拼写名册」里。
 * @param input `{ files, registerFile }`：`files` 是 `[{ rel, text }]`，`registerFile` 是名册所在那份文件的相对路径
 */
export function retiredSpellingFindings({ files, registerFile }) {
  const out = []
  const retired = new Set(Object.keys(RETIRED_SPELLINGS))
  for (const f of files ?? []) {
    if (!f || typeof f.text !== 'string') continue
    const lines = f.text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(/\b(ENV|KI|PF|MA|TD)-(\d+)\b/g)) {
        const token = m[0]
        const digits = m[2].length
        if (digits === ID_DIGITS) continue
        if (f.rel === registerFile && retired.has(token)) continue
        out.push({
          key: `${f.rel}:${i + 1}`,
          msg: `这里写着 ${token}（${digits} 位）—— 号段只有一套：正册的号一律 ${ID_DIGITS} 位（${LEDGER_PREFIXES.join('/')}）。` +
            '**归一不是裁决**（把 4 位归一成 3 位再判"读得到行"，等于替写错的人把号擦掉）。' +
            '修法：把它改成正册里那个号真的号；若它指的正是一笔已退役的旧拼写，改用现行的号，' +
            '旧拼写本身留在 `scripts/id-rules.mjs` 的 RETIRED_SPELLINGS 名册里（那里是它们唯一的家）。',
        })
      }
    }
  }
  return out
}

/**
 * 名册自证：每一格都得说得出「它今天是什么」，指的那个号必须真的在正册里有一行。
 * @param input `{ ledgerText }`
 */
export function retiredRegisterFindings({ ledgerText }) {
  const out = []
  const rows = ledgerRows(ledgerText)
  for (const [token, rec] of Object.entries(RETIRED_SPELLINGS)) {
    if (!isObj(rec)) {
      out.push({ key: token, msg: `名册里 ${token} 这一格不是对象 = 名册的形状坏了，下面两条判据在读垃圾。` })
      continue
    }
    const digits = token.replace(/^\D+-/, '').length
    if (digits === ID_DIGITS) {
      out.push({ key: token, msg: `名册里 ${token} 是 ${ID_DIGITS} 位的 —— 它没有退役，仍是现行的号，不该登记在"已退役"里。` })
    }
    if (typeof rec.why !== 'string' || rec.why.length < 40) {
      out.push({ key: token, msg: `名册里 ${token} 的理由短到说不出它今天是什么（${String(rec.why).slice(0, 30)}…）＝ 这格在给一笔没人认领的旧拼写发通行证。` })
    }
    if (rec.now === null) {
      // 这一格是「它本来就不是号」——架构 §8.2 规则句自己举的例子号。
      // **刻意不去查正册有没有同号的行**：将来正册出现一个同前缀同数字的新行是合法的（那不是它），
      // 而这台门若去查，就会在那一天假红。例子号不是债，不该绑在正册的号段上。
      continue
    }
    const hits = rows.filter((r) => r.id === rec.now)
    if (hits.length !== 1) {
      out.push({
        key: token,
        msg: `名册里 ${token} 指着 ${rec.now}，而正册里那个号读到 ${hits.length} 行 ⇒ ` +
          '这张名册的作用是"旧拼写 → 它今天是什么"，指错了就等于把读者送回空气里。',
      })
    }
  }
  return out
}
