/**
 * scripts/schema-vocab.mjs — 「校验器手抄的词表 ↔ 代码里那条声明」对账（纯函数，零依赖）。
 *
 * 起因（KI-074）：`validate-data.mjs` 顶上那一片 `const X = new Set([...])` 每张都写着
 * 「与 schema.ts 对齐 / 改 schema 时同步这里」——也就是一张张**手抄**。抄的东西不会失败，只会静悄悄地变旧：
 * 声明加了成员而白名单没加 ⇒ 合法数据被判 ERROR（下一次改表的人被一个不存在的问题挡住）；
 * 白名单加了成员而声明没有 ⇒ 代码侧根本不认识它，`derive` 那边可能已经在读（TS 看不见）。
 * 本模块把"抄"换成"对账"：读一次载体，逐张名单比一遍，对不上就 ERROR。
 *
 * KI-076 把**载体**泛化了：主人不一定住在 `src/data/schema.ts`。今天有五种形状——
 * 字面量联合（`export type X = 'a' | 'b'`）、接口字段、接口里的内联联合、
 * `export const X = { 行键: ... }`（震镜表）、`export const X = ['a','b'] as const`（五状态名册），
 * 外加一条"某个方法在代码里被喂过哪些字面量"（被动消费方普查）。
 * 所以 `source` 收到的不再是一叠 schema 块，而是一个 `{ text, blocks }` 的**语料**，
 * 每张名单自己说它住在哪个文件（`from`）；报错也按那个文件分段打印。
 *
 * 抽取只认**声明本身**，不认注释、不认第二个来源。读不到就报，不静默跳过——
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

/**
 * 按顶层 `export type|interface` 的出现位置切块（这些仓库的 TS 不写分号，靠分号收尾会越界）。
 *
 * 接口那块**在配对的那个 `}` 处收尾**，而不是"到下一条顶层声明为止"。KI-076 普查时量出来的：
 * `src/rpg/Equipment.ts` 里 `EquipMods` 后面紧跟 `export const EMPTY_MODS: EquipMods = { ... }`
 * （`export const` 不是切块标记），于是那些初值行被读成了字段——`defense/execMul/bellBonus`
 * 各出现两次。schema.ts 今天躲过这一刀只是因为接口后面恰好紧跟另一条 `export interface`，
 * 属于运气不属于设计。类型别名没有花括号可配对，仍按"到下一条顶层声明为止"切。
 */
export function schemaBlocks(text) {
  const src = stripComments(text)
  const marks = [...src.matchAll(/^export (?:type|interface) (\w+)/gm)].map((m) => ({ name: m[1], at: m.index, kind: m[0].startsWith('export interface') ? 'interface' : 'type' }))
  const out = new Map()
  marks.forEach((m, i) => {
    const until = i + 1 < marks.length ? marks[i + 1].at : src.length
    let end = until
    if (m.kind === 'interface') {
      const open = src.indexOf('{', m.at)
      if (open >= 0 && open < until) {
        const close = matchingBrace(src, open)
        if (close > open) end = close + 1
      }
    }
    out.set(m.name, src.slice(m.at, end))
  })
  return out
}

/** 从 `open`（必为 `{`）走到配对的那个 `}`；走不到返回 -1 */
function matchingBrace(src, open) {
  let depth = 0
  for (let j = open; j < src.length; j++) {
    const c = src[j]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return j }
  }
  return -1
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

/**
 * 接口里某一行的内联字面量联合：`kind: 'a' | 'b'` ⇒ ['a','b']。
 * 两种排版都要认：多行接口里那一行缩进两格，而**单行接口**（`export interface HitboxCone { shape: 'cone'; … }`）
 * 的字段跟在 `{` 后面。KI-076 第一版只认前者，于是 `Hitbox` 那张引用链整个读不到，
 * 门当场按"我在空转"自曝——这条比假绿好，但也不许留着：判据认不了一个形状就是判据的缺口。
 */
export function fieldUnion(text, ifaceName, field) {
  const block = text.get(ifaceName)
  if (!block) return null
  const re = new RegExp(`(?:^ {2}(?:readonly )?|[{;]\\s*(?:readonly )?)${field}\\??: ((?:'[^']+'\\s*\\|?\\s*)+)`, 'm')
  const m = block.match(re)
  if (!m) return null
  const lits = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  return lits.length ? lits : null
}

/**
 * 一条"引用式"联合的成员集合：`export type Hitbox = HitboxCone | HitboxSphere | HitboxRing`
 * 再说每个被引用的接口里那一行的内联联合，拼起来 ⇒ ['cone','sphere','ring']。
 * 存在的理由：形状的主人不是某一张字面量联合，而是"有哪几个 box 变体"这件事本身——
 * 从引用链现推，才不用再手抄一遍接口名（抄接口名和抄成员是同一个病）。
 * 任一环节读不到就返回 null（宁可报"门在空转"，也不返回一个残缺的集合冒充"没有漂移"）。
 */
export function refFieldUnion(blocks, typeName, field) {
  const block = blocks.get(typeName)
  if (!block) return null
  const eq = block.indexOf('=')
  if (eq < 0) return null
  const refs = [...block.slice(eq + 1).matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map((m) => m[1])
  if (refs.length === 0) return null
  const out = []
  for (const r of refs) {
    const lits = fieldUnion(blocks, r, field)
    if (!lits) return null
    out.push(...lits)
  }
  return out.length ? [...new Set(out)] : null
}

/**
 * `export const X: Record<...> = { a: ..., b: ... }` ⇒ 顶层键 ['a','b']（震镜表那一族）。
 * 花括号要从**赋值号后面**那个开始配，不能从声明里第一个开始——
 * `SHAKE_TABLE: Record<string, { amp: number; … }>` 的类型标注自己就带一对花括号，
 * 普查脚本第一版从 `indexOf('{')` 起步，读回来的"行键"是 `["amp"]`：一门会把全游戏震镜
 * 判成只有一行的门。嵌套对象内部（含同一行里的内层键）不算顶层键。
 */
export function objectKeys(text, constName) {
  const src = stripComments(text)
  const m = new RegExp(`export const ${constName}\\b[^=]*?=\\s*\\{`).exec(src)
  if (!m) return null
  const open = m.index + m[0].length - 1
  const close = matchingBrace(src, open)
  if (close < 0) return null
  const body = src.slice(open + 1, close)
  let depth = 0
  const keys = []
  for (const line of body.split('\n')) {
    if (depth === 0) {
      const k = line.match(/^\s*(?:\.\.\.|[[(])?([A-Za-z0-9_]+)\s*[?:]/)
      if (k) keys.push(k[1])
    }
    depth += (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length
  }
  return keys.length ? [...new Set(keys)] : null
}

/** `export const X = ['a', 'b'] as const` ⇒ ['a','b']（五状态名册那一族：主人是一张数组而不是一条 type） */
export function arrayLiterals(text, constName) {
  const src = stripComments(text)
  const m = new RegExp(`export const ${constName}\\b[^=]*?=\\s*\\[([^\\]]*)\\]`).exec(src)
  if (!m) return null
  const lits = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  return lits.length ? lits : null
}

/**
 * 代码里 `fn('字面量'` 的调用点普查（去重、按出现序）——"这条白名单的成员都有消费方吗"的机器读法。
 * 只认字面量实参：变量传进来的那一条读不到，所以这张对账只登记在**调用点全为字面量**的载体上（KI-076 量过 `passiveValue`）。
 */
export function callArgLiterals(text, fnName) {
  const src = stripComments(text)
  const lits = [...src.matchAll(new RegExp(`\\b${fnName}\\(\\s*'([^']+)'`, 'g'))].map((x) => x[1])
  return lits.length ? [...new Set(lits)] : null
}

/**
 * 逐张名单对账。
 * @param pairs 每张：`{ at, from, name?, source, copied, allowMissing?, whyMissing?, subset?, whySubset?, where?, hint? }`
 *        - `at`：那张声明在这道门里的身份（'SlotKey' / 'MilestoneGrant' / 'SHAKE_TABLE' / 'passiveValue()'）
 *        - `from`：**主人住的文件**（KI-076 起不再只有 schema.ts）——报错按它分段，措辞也用它
 *        - `corpus`：`source` 收到的是 `{ text, blocks }`（前者给 `objectKeys`/`arrayLiterals`/`callArgLiterals` 这类"读整份文件"的判据，后者给 schema 块判据）
 *        - `copied`：校验器手抄的那一份
 *        - `allowMissing`：允许"声明有而抄本没有"的**那几个**成员（子集关系），必须配 `whyMissing`
 *        - `subset`：抄本只是声明的一个**任意小子集**（'ActionName' 20 个动作里战技只占 2 个）——
 *          少抄不报，多抄（声明里没有的）照报；必须配 `whySubset`。和 `allowMissing` 互斥：
 *          一张表同时挂两种豁免，等于谁都不在看。
 * @returns 每条 `{ key, msg, from }`，调用方按 `from` 分段 report.error
 */
export function vocabDriftErrors({ pairs, corpusFor }) {
  const out = []
  const cache = new Map()
  for (const p of pairs) {
    if (!cache.has(p.from)) cache.set(p.from, corpusFor(p.from))
    const corpus = cache.get(p.from)
    if (!corpus) {
      out.push({ key: `carrier:${p.at}`, from: p.from, msg: `${p.name ?? p.at} 的载体 ${p.from} 读不到 ⇒ 这张门在空转（文件改名？移动？还是门的登记表没写对路径？）` })
      continue
    }
    const at = `carrier:${p.at}`
    const declared = p.source(corpus)
    if (!declared) {
      out.push({ key: at, from: p.from, msg: `对账在 ${p.from} 里读不到 ${p.at} 这份声明 ⇒ 这张门在空转（声明改名了？删了？还是抽取不认识它的形状？）${p.hint ? `：${p.hint}` : ''}` })
      continue
    }
    const name = p.name ?? p.at
    const d = new Set(declared)
    const c = new Set(p.copied ?? [])
    const missing = [...d].filter((x) => !c.has(x))
    const extra = [...c].filter((x) => !d.has(x))
    if (p.subset && p.allowMissing) {
      out.push({ key: `vocab:${p.at}`, from: p.from, msg: `${name} 既声明"整张表都可以不抄"（subset）又逐条登记少抄谁（allowMissing）⇒ 两种豁免同时挂，等于谁都不在看（KI-076）` })
    }
    if (p.subset && !p.whySubset) {
      out.push({ key: `vocab:${p.at}`, from: p.from, msg: `${name} 声明了"这张表只抄子集"却没写理由 ⇒ 子集关系也要有据（KI-076）` })
    }
    if (!p.subset) {
      const allow = new Set(p.allowMissing ?? [])
      const realMissing = missing.filter((x) => !allow.has(x))
      if (p.allowMissing && !p.whyMissing) {
        out.push({ key: `vocab:${p.at}`, from: p.from, msg: `${name} 声明了"可以少抄哪几个"却没写理由 ⇒ 子集关系也要有据（KI-074）` })
      }
      if (p.allowMissing) {
        const unused = [...allow].filter((x) => !missing.includes(x))
        if (unused.length) out.push({ key: `vocab:${p.at}`, from: p.from, msg: `${name} 登记了"刻意不抄 ${unused.join('/')}"，而今天这份声明里根本没有它们 ⇒ 这条豁免该销了（KI-073 同族）` })
      }
      if (realMissing.length) {
        out.push({ key: `vocab:${p.at}`, from: p.from, msg: `${name}：${p.from} 里有 ${realMissing.join('/')} 而校验器的名单没有 ⇒ 改表的人会被一个不存在的问题挡住（名单在 ${p.where ?? 'validate-data.mjs'}）` })
      }
    }
    if (extra.length) {
      out.push({ key: `vocab:${p.at}`, from: p.from, msg: `${name}：校验器的名单里有 ${extra.join('/')} 而 ${p.from} 不认识 ⇒ 那一侧看不见这一项，它要么该进声明、要么就是死词（KI-047 那一族）` })
    }
  }
  return out
}
