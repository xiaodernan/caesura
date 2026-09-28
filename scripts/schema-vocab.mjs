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
 * KI-086 把剩下的两种形状补上，并把"还剩几张没接"变成机器读数：
 * ①**嵌套对象里的内联联合**（`EnemyData.ai.pickOrder` 缩进四格）——`fieldUnion` 原来只认两格，
 *    于是那张名单读成 null；②**模块级 `const X = new Set([...])`**（`src/ai/Enemy.ts > PSEUDO_ACTIONS`，
 *    既不是 export 也不是数组）；③一张名单如果**确实没有代码主人**（`AFFIX_STATS` 那类，主人是另一道门
 *    已经在跑的双向对账），必须进 `VOCAB_UNPAIRED` 写明真主人是谁——由 `vocabCoverageErrors` 逐张交代，不再靠注释。
 *
 * KI-088 承认第六种主人：**一个目录**。`FILES`（校验器读哪几份 JSON）的真主人不是任何一条声明，
 * 而是 `src/data/json/` 里躺着的那些文件，所以 `corpusFor` 收得到以 `/` 结尾的路径（语料 = 目录名逐行拼起来），
 * 由 `dirListing` 读数。两侧的通用措辞在这个载体上说的都不是这件事，于是 `missHint`/`extraHint`
 * 让每张名单自己说"这一侧多了/少了到底意味着什么"——红消息必须陈述它自己那条判据。
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
 *
 * KI-086 补第三种排版：**嵌在嵌套对象里的字段**（`EnemyData.ai.pickOrder` 缩进四格）。
 * 只认两格的那一版把 `PICK_ORDERS` 读成 null——门会喊"空转"，但真正该改的是判据。
 * 缩进下限仍是两格（顶层字段之下才有主人），且 `match` 取**第一处**：同一块里若外层与嵌套各有一行同名，
 * 读到的是外层那一条，与 TS 的可见性一致。
 */
export function fieldUnion(text, ifaceName, field) {
  const block = text.get(ifaceName)
  if (!block) return null
  const re = new RegExp(`(?:^ {2,}(?:readonly )?|[{;]\\s*(?:readonly )?)${field}\\??: ((?:'[^']+'\\s*\\|?\\s*)+)`, 'm')
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
  // KI-088：`export` 不是"这张名册存不存在"的判据——`validate-data.mjs > FILES` 正是一张没导出的数组，
  // 而测试要**从它自己读**而不是再手抄第三份。与 `setLiterals`（KI-086）同一条理由。
  const m = new RegExp(`(?:export )?const ${constName}\\b[^=]*?=\\s*\\[([^\\]]*)\\]`).exec(src)
  if (!m) return null
  const lits = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  return lits.length ? lits : null
}

/**
 * 模块级 `const X = new Set(['a', 'b'])` ⇒ ['a','b']（KI-086）。
 * `arrayLiterals` 管不了这一族：主人既可以不是 `export`（`src/ai/Enemy.ts` 的 `PSEUDO_ACTIONS` 是私有常量），
 * 也可以是一张 `Set` 而不是数组。
 * 要紧的约束：**花括号里必须是字面量**。`new Set(STATUS_IDS)` 那种"从别人派生"的读不到就返回 null，
 * 让调用方报成"门在空转"——把一个派生集合当成"这张词表是空的"，比没有门还糟（它会把所有成员判成非法）。
 */
export function setLiterals(text, constName) {
  const src = stripComments(text)
  const m = new RegExp(`^ {0,2}(?:export )?const ${constName}\\b[^=]*?=\\s*new Set\\(\\[([^\\]]*)\\]`, 'm').exec(src)
  if (!m) return null
  const lits = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  return lits.length ? lits : null
}

/**
 * 一份文件里"住在模块顶层的手抄名单"的名字普查（KI-086）：`const X = new Set([…])` 与 `const X = […]`。
 * 只普查**名字**，不读成员——它的用途是回答"还剩几张名单没入表"，读数由对账那一侧给。
 * 缩进零到两格都算（顶层常量与 `export const`）；函数体里的四格临时集合不算，那是一条语句的局部，不是一张词表。
 */
export function handCopiedLists(text) {
  const src = stripComments(text)
  const names = [...src.matchAll(/^ {0,2}(?:export )?const ([A-Z][A-Z0-9_]*)\s*=\s*(?:new Set\(\[|\[)/gm)].map((m) => m[1])
  return names.length ? [...new Set(names)] : null
}

/** 一份文件从别处 `import { … }` 进来的名字（多行 import 也算）：覆盖普查用它区分"住在本文件"与"住在规则模块" */
export function importedNames(text) {
  const src = stripComments(text)
  const out = [...src.matchAll(/^import \{([^}]*)\} from/gm)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean)
  return out.length ? [...new Set(out)] : null
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
 * 一份**目录名册**语料的读数（KI-088）。`corpusFor('src/data/json/')` 这类主人不是一段声明而是
 * "那个目录里有哪些文件"，调用方把 `readdirSync` 的结果按行拼成语料交给它，这里只管筛选与去空。
 * 读不到（空目录、或那张名册其实一张都不剩）返回 null —— 与别的抽取器同一条规矩：
 * 宁可让调用方喊"门在空转"，也不交出一个空集合冒充"目录里没有多余的表"。
 */
export function dirListing(text, ext) {
  const names = text.split('\n').map((s) => s.trim()).filter(Boolean)
  const picked = ext ? names.filter((n) => n.endsWith(ext)) : names
  return picked.length ? [...new Set(picked)] : null
}

/**
 * 逐张名单对账。
 * @param pairs 每张：`{ at, from, name?, source, copied, allowMissing?, whyMissing?, subset?, whySubset?, where?, hint?, missHint?, extraHint? }`
 *        - `at`：那张声明在这道门里的身份（'SlotKey' / 'MilestoneGrant' / 'SHAKE_TABLE' / 'passiveValue()'）
 *        - `from`：**主人住的文件**（KI-076 起不再只有 schema.ts）——报错按它分段，措辞也用它
 *        - `corpus`：`source` 收到的是 `{ text, blocks }`（前者给 `objectKeys`/`arrayLiterals`/`callArgLiterals` 这类"读整份文件"的判据，后者给 schema 块判据）
 *        - `copied`：校验器手抄的那一份
 *        - `allowMissing`：允许"声明有而抄本没有"的**那几个**成员（子集关系），必须配 `whyMissing`
 *        - `subset`：抄本只是声明的一个**任意小子集**（'ActionName' 20 个动作里战技只占 2 个）——
 *          少抄不报，多抄（声明里没有的）照报；必须配 `whySubset`。和 `allowMissing` 互斥：
 *          一张表同时挂两种豁免，等于谁都不在看。
 *        - `missHint`/`extraHint`（KI-088）：那两个方向在这个载体上**到底意味着什么**。
 *          通用措辞说的是"字段白名单加了一格没抄"，而主人是目录时说的那句是假的——
 *          红消息必须陈述它自己那条判据（缺一条表 ⇒ 那份 JSON 没人校验，§55；多一条 ⇒ 名单里有个不存在的文件名）。
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
        const tail = p.missHint ?? `改表的人会被一个不存在的问题挡住（名单在 ${p.where ?? 'validate-data.mjs'}）`
        out.push({ key: `vocab:${p.at}`, from: p.from, msg: `${name}：${p.from} 里有 ${realMissing.join('/')} 而校验器的名单没有 ⇒ ${tail}` })
      }
    }
    if (extra.length) {
      out.push({ key: `vocab:${p.at}`, from: p.from, msg: `${name}：校验器的名单里有 ${extra.join('/')} 而 ${p.from} 不认识 ⇒ ${p.extraHint ?? '那一侧看不见这一项，它要么该进声明、要么就是死词（KI-047 那一族）'}` })
    }
  }
  return out
}

/**
 * 覆盖面的对账（KI-086）：「还剩几张手抄名单没入表」从此不由散文回答。
 *
 * 存在的理由：KI-074/076 每张都写"先量再接"，可"没接的那几张"只活在注释里——
 * 一批人接了 12 张、下一批人不知道剩下哪 8 张，于是名单既不会被接完，也不会被解释完。
 * 现在每张住在 `validate-data.mjs` 的顶层名单必须由两条路之一交代：
 * **有主人**（进 `VOCAB_PAIRS`）或**没有主人**（进 `VOCAB_UNPAIRED`，并写明为什么、主人其实是谁）。
 *
 * @param file 被普查的文件名（报错的段名，跟着 `from` 走才会打印）
 * @param census `handCopiedLists(text)` 的读数（抽取器自己扫出来的，不是我手写的名单）
 * @param imported `importedNames(text)` 的读数：住在规则模块里的那些名单不算"本文件的抄本"
 * @param pairs 同一份 `VOCAB_PAIRS`
 * @param unpaired 每张：`{ name, why, master? }`——`master` 写"那这张名单的真主人究竟在哪"
 */
export function vocabCoverageErrors({ file, census, imported = [], pairs, unpaired = [] }) {
  const out = []
  const lists = census ?? []
  const from = file
  const at = (n) => `coverage:${n}`
  const registered = new Set(pairs.map((p) => p.where).filter(Boolean))
  const exempt = new Map(unpaired.map((u) => [u.name, u]))
  const holds = new Set([...lists, ...imported])

  for (const n of lists) {
    if (registered.has(n) && exempt.has(n)) {
      out.push({ key: at(n), from, msg: `${n} 既登记了主人（VOCAB_PAIRS）又登记为"没有主人"（VOCAB_UNPAIRED）⇒ 两种交代同时挂，等于谁都不在看（KI-076 的 subset/allowMissing 同族）` })
      continue
    }
    if (!registered.has(n) && !exempt.has(n)) {
      out.push({ key: at(n), from, msg: `${n} 是一张手抄名单而没有任何交代 ⇒ 要么给它登记主人（VOCAB_PAIRS），要么写明它为什么没有主人、真主人其实是谁（VOCAB_UNPAIRED）。手抄的东西不会失败，只会静悄悄变旧（KI-074）` })
      continue
    }
    if (exempt.has(n) && !exempt.get(n).why) {
      out.push({ key: at(n), from, msg: `${n} 豁免了对账却没写理由 ⇒ 豁免也要有据（KI-074）` })
    }
  }

  for (const u of unpaired) {
    if (registered.has(u.name)) continue
    if (!lists.includes(u.name)) {
      out.push({ key: at(u.name), from, msg: `VOCAB_UNPAIRED 里还挂着 ${u.name}，而这份文件里已经没有这张名单 ⇒ 这条豁免该销了（KI-073 同族：先记账的名单要能销）` })
    }
  }

  // 反向：每张入表名单的 `where` 必须真存在（本文件普查到 或 从规则模块 import 进来）。
  // 这条同时是抽取器自己的探测器：census 一旦读空，所有已入表的本地名单都会在这里红，
  // "判据坏了"不会变成静默绿。
  for (const p of pairs) {
    if (!p.where) continue
    if (holds.has(p.where)) continue
    out.push({ key: `coverage:${p.where}`, from, msg: `对账登记了名单 ${p.where}（主人 ${p.at}），而 ${file} 里普查不到它，也不是 import 进来的 ⇒ 名单被改名/删掉了，或者手抄名单的抽取器读不到它今天这个形状（KI-076：认不了一个形状就是判据的缺口）` })
  }
  return out
}
