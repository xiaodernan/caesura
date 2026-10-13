/**
 * scripts/event-rules.mjs — 「主干自证」那条门的判据（纯函数，零依赖）。
 *
 * 立的不是风格，是 KI-114 那一类：**一条特性的发射方提交进了主干，声明方还住在别人的未提交文件里**。
 * 那种切分在开发用的工作副本上是绿的（`tsc` 量的是工作树，别人的字节就在脚边），而干净检出、CI、
 * 任何 detached 平面都红——机器级 pre-commit 恰好就量那种平面，于是整条提交通道被一次"顺手补参"
 * 堵了 26 个提交（`git rev-list --count 11a194e..HEAD`）。类型检查器能发现这件事，但它只在**有全部
 * 未提交字节**的平面上发现；所以这里要一条**只看 `HEAD` 的 blob**、不碰工作副本的判据。
 *
 * 判据形状：`GameEvents` 是事件名的唯一主人（声明可以分散在好几个文件的 `declare module` 合并里，
 * 但名字册只有这一份），主干上每一次**按字面量名**走事件总线的调用都必须落在 HEAD 那份名册里。
 * 不落 ⇒ 要么发射方先上了车（KI-114 的形状），要么声明被删而调用方全瞎。两种都是"提交边界切在一条链的中段"。
 *
 * 为什么判据住在这里而不是测试文件里（与 `*-rules.mjs` 那十三家同一个理由）：`validate-data.mjs`
 * 一被 import 就去校验真表并 `process.exit`，所以"喂一段合成源码、看它认不认"这一半必须在纯模块里量。
 */

/**
 * 吃**字面量事件名**的方法名。名单的手抄是有意的——测试有一条门从 `EventBus` 源码现推那五个泛型方法名
 * （`<K extends keyof E>` 那一排）来双向对账，因为调用点的接收者写法固定而方法名是稳定的那一半。
 */
export const NAMED_EVENT_METHODS = ['emit', 'on', 'once', 'off', 'listenerCount', 'subscribe']

/**
 * 走事件总线的那两个接收者：模块级单例 `bus` 与类内部的 `this`（`EventBus` 自己、`AudioEngine` 的私有
 * `subscribe`）。名单外还有第三种写法时，测试那条"census 相等"的门会先红，而不是悄悄漏掉。
 */
export const BUS_RECEIVERS = ['bus', 'this']

/**
 * 主干此刻**已知**的欠账：事件名 → 那一笔账的说法。**空是目标状态**。
 *
 * 挂在判据旁边而不是测试文件里，与 `ledger-rules.mjs` 那三份"先记账后接线"名单同一个理由：账要有主人，
 * 而销账判据要读得到它。规则（住在 `tests/unit/event-rules.test.ts`）：
 * - HEAD 上每一条"用了却没声明"的 offender 必须恰好等于这里的键集合——多一条 ⇒ 新欠账没登记；
 * - 这里的键被 HEAD 消除（别人把声明提交了）⇒ 该销：删掉那一格，并把理由点名的那行 KI 在账本里结案；
 * - 理由必须点名一个 `KI-NNN` 并长到说得清谁欠谁（一条没有出处的白名单比没有白名单更坏）。
 *
 * @type {Record<string, string>}
 */
export const HEAD_UNDECLARED_LEDGER = {
  'combat.bossTelegraph':
    'KI-114：发射方 `src/ai/Enemy.ts:932` 已随 `11a194e` 进主干，而它的类型前提（`GameEvents` 里那条声明）' +
    '和那条订阅（`AudioEngine.onDuckTrigger`）此刻住在并发会话未提交的 `src/core/EventBus.ts`、' +
    '`src/audio/AudioEngine.ts`、`src/data/json/ducking.json` 里 ⇒ 干净检出过不了它自己的 lint。' +
    '谁先提交那三个文件，谁就当场删掉这一格。',
}

/**
 * 词法骨架：把块注释与行注释的**体**涂白（长度与换行数不变 ⇒ 行号继续对得上），并标出每个位置
 * 是否落在字符串/模板字面量的**体内**（定界符本身不算）。
 *
 * 为什么两件事都要：
 * - 不涂白注释 ⇒ `src/audio/AudioEngine.ts` 的注释里写着「判据数源码里 `bus.on(` 的处数」，散文会被
 *   读成一个调用点（实测该句在 :12、:122、:202 各出现一次）。
 * - 只涂白注释、不看字符串 ⇒ `tests/unit/audio-engine.test.ts` 里那句 `s.includes('bus.on(')` 同样是散文，
 *   但它不在注释里；第一版就是被它和 `el.emit('mousedown')`（`FakeEl` 的假 DOM，不是总线）一起骗出四条假 offender。
 *
 * @param {string} src
 * @returns {{ code: string, inString: Uint8Array }} code = 注释已涂白、字符串原样；inString[i]=1 表示 i 在字符串体内
 */
export function scanSkeleton(src) {
  const code = new Array(src.length)
  const inString = new Uint8Array(src.length)
  let i = 0
  /** @type {'code'|'line'|'block'|'sq'|'dq'|'tpl'} */
  let state = 'code'
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; code[i] = ' '; code[i + 1] = ' '; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; code[i] = ' '; code[i + 1] = ' '; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') {
        state = c === "'" ? 'sq' : c === '"' ? 'dq' : 'tpl'
        code[i] = c
        i++
        continue
      }
      code[i] = c
      i++
      continue
    }
    if (state === 'line') {
      code[i] = c === '\n' ? '\n' : ' '
      if (c === '\n') state = 'code'
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; code[i] = ' '; code[i + 1] = ' '; i += 2; continue }
      code[i] = c === '\n' ? '\n' : ' '
      i++
      continue
    }
    // 字符串态：定界符保留、体内标记得记，转义对原样带走
    const q = state === 'sq' ? "'" : state === 'dq' ? '"' : '`'
    if (c === '\\') { code[i] = c; code[i + 1] = n; inString[i] = 1; inString[i + 1] = 1; i += 2; continue }
    code[i] = c
    if (c === q) { state = 'code'; i++; continue }
    inString[i] = 1
    if (c === '\n' && q !== '`') { state = 'code'; i++; continue } // 未闭合的引号：按行尾收，别把整份文件读成一个字符串
    i++
  }
  return { code: code.join(''), inString }
}

/** 从 `from`（指向定界符）走到该字面量的末字符之后；找不到收尾时走到行尾（未闭合兜底）。 */
function literalEnd(code, from) {
  const q = code[from]
  let i = from + 1
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue }
    if (code[i] === q) return i + 1
    if (q !== '`' && code[i] === '\n') return i
    i++
  }
  return code.length
}

/**
 * 读 `interface GameEvents { … }` 的**成员名**。可以对任意文件调：声明合并（`declare module` 里那七份
 * `interface GameEvents { 'x': … }`）与主接口用同一个抽取器，名册是所有这些文件的并集。
 *
 * 只认深度 1 的那个位置：`'combat.hit': { … result: 'hit' | 'block' }` 里 `result` 和 `'hit'` 都在深度 2，
 * 把它们当声明就是把下游的类型当成了事件名册（那会让任何真违规都被白名单吸掉）。同一条理由也管圆括号与
 * 方括号：成员写成 `'x': (a: number) => void` 时 `a:` 的括号深度是 1，不收这条闸就把形参名收进名册。
 *
 * @param {string} src 单个 .ts 文件源码（含声明合并那几份）
 * @returns {string[]} 该文件声明的事件名，按出现顺序
 */
export function declaredEventNames(src) {
  const { code, inString } = scanSkeleton(src)
  const head = code.match(/interface\s+GameEvents\s*\{/)
  if (!head || head.index === undefined) return []
  const names = []
  let depth = 0
  let paren = 0
  let bracket = 0
  let i = head.index + head[0].length - 1 // 停在开括号的 `{` 上
  while (i < code.length) {
    const c = code[i]
    if (inString[i]) { i++; continue }
    if (c === '{') { depth++; i++; continue }
    if (c === '}') { depth--; i++; if (depth === 0) break; continue }
    if (c === '(') { paren++; i++; continue }
    if (c === ')') { paren--; i++; continue }
    if (c === '[') { bracket++; i++; continue }
    if (c === ']') { bracket--; i++; continue }
    if (depth === 1 && paren === 0 && bracket === 0) {
      // `'name':` / `"name":` / `name:`，允许 `'name'?:`
      const rest = code.slice(i)
      const m = rest.match(/^(['"])([^'"\n]*)\1\s*\??\s*:/) || rest.match(/^([A-Za-z_$][\w$]*)\s*\??\s*:/)
      if (m) {
        const name = m[2] ?? m[1]
        if (name !== 'readonly') names.push(name)
        i += m[0].length
        continue
      }
    }
    // 不是成员名开头：字符串整体跳过（里面有 `{}` 也不许骗到深度计），否则走一步
    if (c === "'" || c === '"' || c === '`') { i = literalEnd(code, i); continue }
    i++
  }
  return names
}

/**
 * 找**按字面量名**走总线的事件点（接收者 ∈ `BUS_RECEIVERS`，方法 ∈ `NAMED_EVENT_METHODS`，名字是引号或
 * 无插值的模板字面量），另数出另外两类——那两类这条判据都看不见名字，所以**必须如实报数而不是当作干净**：
 * - `dynamic`：名字是算出来的（`bus.on(key, fn)`、`bus.on(`${row.trigger}`, fn)`、引号没闭合的那一行）。
 * - `nameless`：**空参数表**的那一类。实测不是总线的调用，而是**退订闭包字段**：`PatrolWatch.ts:50`、
 *   `WorldStates.ts:40`、`Settlement.ts:104` 三处写 `this.off()`，那个 `off` 是
 *   `private readonly off: () => void` ＝ 构造时 `bus.on(...)` 的返回值（`EventBus.on` 在 :124 返回
 *   `() => void`）。它和 `EventBus.off(key, fn)` 撞了个名字，但不带事件名 ⇒ 既不能当 offender，
 *   也不能被吞掉——吞掉就是"census 不等"那条门报的红（总体 309 ⇔ 归类 306，差 3 就是这三处）。
 *
 * @param {string} src 单个 .ts 文件源码
 * @param {string} file 红消息里报的路径
 * @returns {{ sites: {name:string,method:string,line:number,file:string}[], dynamic: {method:string,line:number,file:string}[], nameless: {method:string,line:number,file:string}[] }}
 */
export function eventCallSites(src, file) {
  const { code, inString } = scanSkeleton(src)
  const sites = []
  const dynamic = []
  const nameless = []
  const lineStarts = [0]
  for (let k = 0; k < code.length; k++) if (code[k] === '\n') lineStarts.push(k + 1)
  const lineAt = (idx) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const callRe = new RegExp(
    `\\b(${BUS_RECEIVERS.join('|')})\\.(${NAMED_EVENT_METHODS.join('|')})\\s*\\(`,
    'g',
  )
  let m
  while ((m = callRe.exec(code))) {
    if (inString[m.index]) continue // 散文里写的 `bus.on(`（注释已涂白，字符串里的要看住）
    const line = lineAt(m.index)
    const method = m[2]
    let j = m.index + m[0].length
    while (j < code.length && /\s/.test(code[j])) j++
    // 第一个实参落在别的字面量体内：这条判据读不出它的边界，记成动态而不是当作干净
    if (inString[j]) { dynamic.push({ method, line, file }); continue }
    const q = code[j]
    if (q === "'" || q === '"' || q === '`') {
      const end = literalEnd(code, j)
      if (code[end - 1] !== q) { dynamic.push({ method, line, file }); continue } // 没闭合：不猜名字
      const body = code.slice(j + 1, end - 1)
      if (body.includes('${')) { dynamic.push({ method, line, file }); continue }
      sites.push({ name: body, method, line, file })
      continue
    }
    if (q === ')') { nameless.push({ method, line, file }); continue } // 空参数表：退订闭包字段，不是带名字的总线调用
    dynamic.push({ method, line, file })
  }
  return { sites, dynamic, nameless }
}

/**
 * 名册 ⇄ 调用点的差：**用了却没声明**的那些名字，每个只报第一次出现的位置。
 *
 * @param {{ declared: string[], sites: {name:string,method:string,line:number,file:string}[] }} input
 * @returns {{ name:string, method:string, line:number, file:string }[]} 按事件名排序
 */
export function undeclaredEventNames({ declared, sites }) {
  const set = new Set(declared)
  const seen = new Map()
  for (const s of sites) {
    if (set.has(s.name)) continue
    if (!seen.has(s.name)) seen.set(s.name, s)
  }
  return [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
