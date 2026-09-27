/**
 * scripts/schema-vocab.mjs — 「校验器手抄的词表 ↔ `src/data/schema.ts` 的声明」对账（纯函数，零依赖）。
 *
 * 起因（KI-074）：`validate-data.mjs` 顶上那一片 `const X = new Set([...])` 每张都写着
 * 「与 schema.ts 对齐 / 改 schema 时同步这里」——也就是一张张**手抄**。抄的东西不会失败，只会静悄悄地变旧：
 * schema 加一个成员而白名单没加 ⇒ 合法数据被判 ERROR（下一次改表的人被一个不存在的问题挡住）；
 * 白名单加一个成员而 schema 没有 ⇒ 类型根本不认识它，`derive` 那边可能已经在读（TS 看不见）。
 * 本模块把"抄"换成"对账"：读一次 schema.ts，逐张名单比一遍，对不上就 ERROR。
 *
 * 抽取只认**声明本身**（`export type X = ...` / `export interface X { f?: ... }` /
 * 接口里某一行 `kind: 'a' | 'b'`），不认注释、不认第二个来源。读不到就报，不静默跳过——
 * 静默跳过的对账门比没有门更糟（它让所有人都以为有人在看）。
 */

/**
 * 去掉注释。第一版在这里耍了小聪明（"块内遇到第一个 `/**` 就截断"，怕下一条声明的注释被读成词表成员），
 * 结果把**声明自己内部的文档注释**也一起截了——`MilestoneGrant` 的 `overdriveFlat` 与 `corruptionStayPct`
 * 正好都排在一段注释后面，于是对账一开就报五条假红。注释要么整片去掉，要么别去，半吊子最坏。
 */
export function stripComments(text) {
  const noBlocks = String(text).replace(/\/\*[\s\S]*?\*\//g, '')
  // 行注释要连"行尾那种"一起去掉。第一版只去整行注释，于是
  // `export type Fake = 'x' // 注释里有 'y'` 把 'y' 漏成了词表成员（单元测试当场抓到）。
  // 判"这个 // 在不在字符串里"用最朴素的引号计数：前面单引号成对，说明它在字符串外。
  return noBlocks.split('\n').map((line) => {
    const i = line.indexOf('//')
    if (i < 0) return line
    const quotes = (line.slice(0, i).match(/'/g) ?? []).length
    return quotes % 2 === 0 ? line.slice(0, i) : line
  }).join('\n')
}

/** 按顶层 `export type|interface` 的出现位置切块（本仓库的 schema.ts 不写分号，靠分号收尾会越界） */
export function schemaBlocks(text) {
  const src = stripComments(text)
  const marks = [...src.matchAll(/^export (?:type|interface) (\w+)/gm)].map((m) => ({ name: m[1], at: m.index }))
  const out = new Map()
  marks.forEach((m, i) => out.set(m.name, src.slice(m.at, i + 1 < marks.length ? marks[i + 1].at : src.length)))
  return out
}

/** `export type X = 'a' | 'b'` ⇒ ['a','b']；没有这个类型 ⇒ null */
export function unionMembers(text, typeName) {
  const block = text.get(typeName)
  if (!block) return null
  const eq = block.indexOf('=')
  if (eq < 0) return null
  const lits = [...block.slice(eq + 1).matchAll(/'([^']+)'/g)].map((m) => m[1])
  return lits.length ? lits : null
}

/** `export interface X { a?: T; b: T }` ⇒ ['a','b']（只取第一层：嵌套对象在下一行以后，缩进 ≥4） */
export function interfaceFields(text, ifaceName) {
  const block = text.get(ifaceName)
  if (!block) return null
  const fields = [...block.matchAll(/^ {2}(?:readonly )?([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1])
  return fields.length ? fields : null
}

/** 接口里某一行的内联字面量联合：`kind: 'a' | 'b'` ⇒ ['a','b'] */
export function fieldUnion(text, ifaceName, field) {
  const block = text.get(ifaceName)
  if (!block) return null
  const re = new RegExp(`^ {2}(?:readonly )?${field}\\??: ((?:'[^']+'\\s*\\|?\\s*)+)`, 'm')
  const m = block.match(re)
  if (!m) return null
  const lits = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  return lits.length ? lits : null
}

/**
 * 逐张名单对账。
 * @param pairs 每张：`{ at, from, source, copied, allowMissing?, whyMissing? }`
 *        - `at`：载体（'type:SlotKey' / 'interface:MilestoneGrant' / 'field:PropRef.kind'）
 *        - `source`：(blocks) => string[] | null —— 从 schema 侧读出来的那一份
 *        - `copied`：校验器手抄的那一份
 *        - `allowMissing`：允许 schema 有而抄本没有的成员（子集关系），必须配 `whyMissing`
 * @returns 每条 `{ key, msg }`，调用方 report.error
 */
export function vocabDriftErrors({ blocks, pairs }) {
  const out = []
  for (const p of pairs) {
    const declared = p.source(blocks)
    if (!declared) {
      out.push({ key: `schema:${p.at}`, msg: `对账读不到这份声明 ⇒ 这张门在空转（声明改名了？删了？还是抽取不认识它的形状？）${p.hint ? `：${p.hint}` : ''}` })
      continue
    }
    const d = new Set(declared)
    const c = new Set(p.copied ?? [])
    const missing = [...d].filter((x) => !c.has(x))
    const extra = [...c].filter((x) => !d.has(x))
    const allow = new Set(p.allowMissing ?? [])
    const realMissing = missing.filter((x) => !allow.has(x))
    if (p.allowMissing && !p.whyMissing) {
      out.push({ key: `vocab:${p.at}`, msg: `${p.name ?? p.at} 声明了"可以少抄哪几个"却没写理由 ⇒ 子集关系也要有据（KI-074）` })
    }
    if (p.allowMissing) {
      const unused = [...allow].filter((x) => !missing.includes(x))
      if (unused.length) out.push({ key: `vocab:${p.at}`, msg: `${p.name ?? p.at} 登记了"刻意不抄 ${unused.join('/')}"，而今天这份声明里根本没有它们 ⇒ 这条豁免该销了（KI-073 同族）` })
    }
    if (realMissing.length) {
      out.push({ key: `vocab:${p.at}`, msg: `${p.name ?? p.at}：schema.ts 里有 ${realMissing.join('/')} 而校验器的名单没有 ⇒ 改表的人会被一个不存在的问题挡住（名单在 ${p.where ?? 'validate-data.mjs'}）` })
    }
    if (extra.length) {
      out.push({ key: `vocab:${p.at}`, msg: `${p.name ?? p.at}：校验器的名单里有 ${extra.join('/')} 而 schema.ts 不认识 ⇒ 类型侧看不见这一项，它要么该进声明、要么就是死词（KI-047 那一族）` })
    }
  }
  return out
}
