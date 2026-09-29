/**
 * scripts/validator-map-rules.mjs — `FILES` 名册 ⇄ `validateX()` 函数那条缝的判据本体（KI-093）
 *
 * 为什么它要单列一道门：`validate-data.mjs` 里有两张**互相不认识**的名单。上面那张是 `FILES`
 * （加载哪几份 JSON），下面那批是 `function validateX()`（谁去检查它们）。加一张表而忘了写校验函数
 * ⇒ 那份 JSON 只被 `JSON.parse` 了一遍，字段、跨表引用、值域全都没人看，而门禁全绿；反过来写了一个
 * `validateX()` 而忘了在主循环调用它 ⇒ 一整道门彻底哑掉， symptoms 与"这道门从没有过"完全一样。
 * 这两种漂移在 KI-074 那一批里是**靠人眼**挡住的（那次真的抓到一个哑段），所以今天把它换成机器读数。
 * 结案 KI-088 没做①：那条 KI 给 `FILES` 找到了目录这个主人，而"名册里每张表都有人报、报出去的每张表
 * 都在名册里"这一半它明确留着没做。
 *
 * 为什么判据住在这里而不是 `validate-data.mjs`：同一族老理由（KI-075/KI-079）——那文件一被 import
 * 就去校验真表并 `process.exit`，于是"喂一张缺主人的名册、看它拒不拒"这一半腿在测试里做不了，
 * 而本沙箱连 spawn 子进程都被宿主拒。搬出来之后校验器只当"把 findings 报成 ERROR 的那张嘴"。
 *
 * 一条自己也要吃的药：这道门读的正是 `validate-data.mjs` **自己**的源码，所以它的两端都必须由抽取器
 * 现推（`functionBodies`/`assignedLiterals`/`bracketKeys`/`calledNames`/`arrayLiterals`）。这里不接受
 * 任何一份手抄名单——抄一份进来就是第三个主人，而那正是本门要消灭的东西。抽取器读空 ⇒ 报"这道门在空转"，
 * 绝不退成"什么都查不到所以全绿"。
 *
 * 一个刻意允许的合法形状：**一张表可以有两个报告者**（`loot.json` 今天由 `validateLoot` 与
 * `validateGearRarityCoverage` 共同报）。判据是「≥1 个主人」而不是「恰好 1 个」——按稀有度覆盖再设一道
 * 全局闸门是正当的，硬要一对一反而会逼人把判据塞进别的函数里。
 */

/** `SUBJECT_WAIVERS` 那一行的字段白名单：多出来的键没有消费方（§55），而写错的那个键会让理由静默失效 */
export const MAP_WAIVER_FIELDS = ['name', 'why']

const isArr = (v) => Array.isArray(v)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.length > 0

/**
 * 名册 ⇄ 校验函数的对账 → findings（`{ level, file, where, msg }`）。只读不改，也不认识任何文件。
 *
 * @param file 报告用的段名（判据不认识文件，与 `duckFindings` 同一口径）
 * @param roster `FILES` 的读数（`arrayLiterals` 从源码现推）；null/空 ⇒ 空转
 * @param validators 每个顶层校验函数一条：`{ name, bodyOk, subjects, reads, readsVar }`
 *   · `subjects` = 那个函数里 `const file = '…'` 的读数（它报哪张表），null = 一张都不报
 *   · `reads` = 那个函数里 `data['…']` 的键读数，`readsVar` = 它有没有走 `data[file]` 这一种变量式
 * @param calls 主循环里被调用过的 `validateX(` 名字读数（`calledNames` 现推）
 * @param waivers 每张 `{ name, why }`：确实不报任何表的函数（全局对账 / 这道门自己）
 */
export function mapFindings({ file, roster, validators, calls, waivers }) {
  const out = []
  const err = (where, msg) => out.push({ level: 'error', file, where: where || file, msg })
  const list = isArr(validators) ? validators : []
  const waives = isArr(waivers) ? waivers : []

  // ---- 空转三连：三端里任何一端读不到，后面每一条判据都会退成"查不到东西"的假绿 ----
  if (!isArr(roster) || roster.length === 0) {
    err('', '读不到 FILES 名册（主人：本文件的 `const FILES = [...]`）⇒ 这道门在空转：名册改名了、被挪进别的文件了，还是 arrayLiterals 认不了它今天这个形状？')
    return out
  }
  if (!isArr(validators) || validators.length === 0) {
    err('', '读不到任何 `function validateX()`（主人：本文件的顶层声明）⇒ 这道门在空转：函数改叫别的名字了，还是 functionBodies 认不了它今天这个签名？')
    return out
  }
  if (!isArr(calls) || calls.length === 0) {
    err('', '读不到任何一处 `validateX(` 调用 ⇒ 这道门在空转：主循环挪走了，还是 calledNames 认不了它今天这个形状？')
    return out
  }

  const byName = new Map()
  for (const v of list) {
    if (!isObj(v) || !isStr(v.name)) continue
    byName.set(v.name, v)
  }

  // ---- 豁免表本身的三条 ----
  for (const w of waives) {
    if (!isObj(w)) { err('SUBJECT_WAIVERS', '一张豁免必须是对象（{ name, why }）'); continue }
    for (const k of Object.keys(w)) {
      if (!MAP_WAIVER_FIELDS.includes(k)) err(`SUBJECT_WAIVERS.${k}`, `未知字段 ${k}：一行豁免只有 name/why 两格，多出来的那一格没有消费方（§55）`)
    }
    if (!isStr(w.name)) err('SUBJECT_WAIVERS', '一条豁免没有 name ⇒ 它谁也豁免不了，只是把判据糊住')
    if (!isStr(w.why) || w.why.trim().length === 0) err(`${w.name ?? 'SUBJECT_WAIVERS'}`, '豁免了对账却没写理由 ⇒ 豁免也要有据（KI-074 同族）')
    const v = byName.get(w.name)
    if (!v) {
      err(`SUBJECT_WAIVERS.${w.name}`, `豁免表里还挂着 ${w.name}，而本文件已经没有这个校验函数 ⇒ 这条豁免该销了（KI-073 同族：先记账的名单要能销）`)
    } else if (isArr(v.subjects) && v.subjects.length > 0) {
      err(`SUBJECT_WAIVERS.${w.name}`, `豁免表里挂着 ${w.name}"不报任何表"，而它今天报了 ${v.subjects.join('/')} ⇒ 这条豁免该销了，它已经有主人要管的表`)
    }
  }

  // ---- 逐函数 ----
  const owners = new Map()
  const called = new Set(calls)
  for (const v of list) {
    if (!isObj(v) || !isStr(v.name)) { err('validators', '一个校验函数的读数缺了 name ⇒ 抽取器交出了它自己都认不得的东西'); continue }
    const at = v.name
    if (!v.bodyOk) {
      err(at, '切不出这个函数的体（花括号配不上对，或它不是本模块认的那种顶层声明）⇒ 它报哪张表、读不读得到，全都无从知道。"读不到"必须说出来，不许当成"它什么都不报"')
      continue
    }
    if (!called.has(v.name)) {
      err(at, '声明了而主循环没有调用它 ⇒ 这道门从来没跑过。一个不被调用的校验函数与一个不存在的校验函数在效果上完全相同，而前者还会让人以为它在守着')
    }
    const subjects = isArr(v.subjects) ? v.subjects : []
    if (subjects.length === 0) {
      if (!waives.some((w) => isObj(w) && w.name === v.name)) {
        err(at, '这个校验函数一张表都不报，而它没登记在 SUBJECT_WAIVERS ⇒ 要么写明它管哪张表（`const file = \'x.json\'`），要么记下它为什么是全局对账（并写理由）')
      }
      continue
    }
    const reads = isArr(v.reads) ? v.reads : []
    for (const s of subjects) {
      if (!owners.has(s)) owners.set(s, [])
      owners.get(s).push(v.name)
      if (!roster.includes(s)) {
        err(`${at}>${s}`, `它报 '${s}' 而 FILES 名册里没有这一项 ⇒ '${s}' 的 ERROR 既不打印也不计数（KI-074 那次抓到过的那种哑段）。要么把表进名册，要么这个段名写错了`)
      }
      // "报而不读"：变量式 `data[file]` 也算读了自己那一张。这是一条**明写的近似**——一个函数里如果同时
      // 给两张表写 `const file =`，那 `data[file]` 说不清读的是哪一张，这里会放它过去。今天没有任何函数
      // 有两个 subject（`tests/unit/validator-map.test.ts` 量着这一格），所以近似还没有代价。
      const readIt = v.readsVar === true || reads.includes(s)
      if (!readIt) {
        err(`${at}>${s}`, `它把 ERROR 记在 '${s}' 名下而整个函数没有读过 data['${s}']，也没有走 data[file] 这一种变量式 ⇒ 那个段里的话与那张表无关，或者它读的是另一张表的行（那 ERROR 该记在那一张名下）`)
      }
    }
  }
  for (const name of [...called].sort()) {
    if (!byName.has(name)) err(name, '主循环调用了它，而本文件没有这个顶层声明 ⇒ 拼错的调用、被删掉的函数留下的调用点，或者它搬走时没带上这张门（那条调用今天什么都不做）')
  }

  // ---- 名册一侧：每张表都要有人报 ----
  for (const f of roster) {
    const os = owners.get(f) ?? []
    if (os.length === 0) {
      err(`FILES>${f}`, `名册里有 '${f}' 而没有任何校验函数报它 ⇒ 它只被 JSON.parse 了一遍：字段白名单、跨表引用、值域全没人看。要么给它写一个 validateX（并在里面写下 const file = '${f}'），要么把它移出名册（那张表就不该被门禁读）`)
    }
  }
  return out
}
