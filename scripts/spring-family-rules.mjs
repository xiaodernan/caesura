/**
 * scripts/spring-family-rules.mjs — Spring Cloud 微服务族（主干守门人）的判据（KI-422，2026-11-09）
 *
 * 这一族（`services/spring/`）是**主干守门人**：五个服务各管一件事，
 * 但**判定权不在 Java 侧**——判定（什么算红）与**阈值**（一道门跑多久算超时）
 * 的唯一主人仍然是 Node 那边既有的命令与那份名册。
 *
 * **这一格判的正是「唯一主人」这件事有没有被偷走**。因为「判据在一个地方、阈值在另一个地方」
 * 是微服务化最常见的病：Java 侧顺手写一个「超时 30 秒」，Node 侧的名册写 60 秒，
 * 两边谁也不看谁 ⇒ 同一道门有两个主人，而两个主人永远不会同时在场。
 *
 * **这一格判五件事**（每件都能被合成夹具喂）：
 *   ① **名册的形状**：每格必带 id／family／command／args／timeout-sec／blocking；
 *      id 唯一；timeout-sec 是正整数。形状坏了 ⇒ 判据不许"按缺的那格算"。
 *   ② **门 id 不许写死在 Java 里**：Java 按 id 取命令，不按 id 写分支。
 *      一旦 Java 里出现某个门 id，那道门就有了第二个主人（Java 那个分支与名册那一格可以各说各话）。
 *   ③ **阈值不许写死在 Java 里**：名册里每一个 timeout-sec 的值，
 *      不许在 Java 源码里再出现一遍（同一个数出现两遍 = 两个出处）。
 *   ④ **名册指向的命令真的存在**：`npm run <x>` 要在 package.json 的 scripts 里；
 *      `node scripts/<x>` 要真有那份文件。名册指着一道不存在的门 ⇒ 那一格是空头承诺。
 *   ⑤ **拓扑不许少服务**：compose 里的服务 ⇄ 模块目录 ⇄ 期望的五个名字，三方一致。
 *
 * **为什么 ②③ 用「字面量不许出现」这种笨办法，而不是「不许有硬编码」**：因为后者没法判。
 * 硬编码是意图，字面量是**物证**。这道门能证明的是「阈值那个数在 Java 里只出现一次（名册那一次）」，
 * 证不了「Java 心里没有阈值」——那件事得靠人看。它把能证的钉死，把证不了的写在明处。
 *
 * **为什么名册是 YAML 而不是 JSON**：YAML 是这一族（Spring Cloud）自己的形状，
 * 而它必须能被 Node 侧读得懂 —— 所以这里有一份**只认那一种形状**的解析器
 * （`parseGateRoster`）：读不懂就是读不懂，它会把读不懂的地方**逐条点名**，不会猜。
 * 那份解析器本身也被合成夹具喂（喂一份形状不对的名册，看它拒不拒）。
 */

/** 名册文件在仓里的相对路径（判据的「登记处」：它指向**唯一**那份名册） */
export const ROSTER_RELPATH = 'services/spring/config/caesura-gates.yml'

/** 每一格必带的键（顺序＝文档里的顺序） */
export const ROSTER_KEYS = ['id', 'family', 'command', 'args', 'timeout-sec', 'blocking']

/** 这一族期望的服务名（拓扑的名册：compose ⇄ 模块 ⇄ 这张表，三方一致） */
export const SERVICE_NAMES = ['caesura-registry', 'caesura-config', 'caesura-gateway', 'caesura-gate', 'caesura-report']

/**
 * 一条读数：{ key, msg }（与 `scripts/id-rules.mjs` 的 `IdFinding` 同形）
 * @typedef {{ key: string, msg: string }} SpringFinding
 */

/**
 * 读那份名册（只认一种形状）。
 *
 * **读不懂就点名，不猜**：任何一行不是它认识的形状，它就记一条 `errors`，
 * 而门会照着这些 `errors` 报红。返回的 `gates` 里可能缺格 —— 那正是门要报的东西。
 *
 * @param {string} text 名册全文
 * @returns {{ repoRoot: string|null, gates: {id?:string, family?:string, command?:string, args?:string[], 'timeout-sec'?:number, blocking?:boolean}[], errors: string[] }}
 */
export function parseGateRoster(text) {
  const errors = []
  const gates = []
  let repoRoot = null
  if (typeof text !== 'string' || text === '') {
    return { repoRoot, gates, errors: ['名册是空的（或根本不是字符串）⇒ 读不到名册＝读不到门'] }
  }
  const lines = text.split(/\r?\n/)
  /** @type {null | Record<string, unknown>} */
  let current = null
  let inGates = false
  let sawCaesura = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length

    if (indent === 0) {
      if (trimmed !== 'caesura:') {
        errors.push(`第 ${i + 1} 行：顶层只认「caesura:」，读到「${trimmed}」`)
        continue
      }
      sawCaesura = true
      inGates = false
      current = null
      continue
    }
    if (!sawCaesura) {
      errors.push(`第 ${i + 1} 行：在「caesura:」之前就出现了内容（${trimmed}）`)
      continue
    }

    // 门列表项：`- key: value`
    const item = /^-\s+([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(trimmed)
    if (item && indent >= 4) {
      current = {}
      gates.push(current)
      // **`inGates` 不在这里清**：一个列表项仍然**在** gates 列表里面
      // （清掉它 ⇒ 后面 `family:`/`command:` 那些行全都落进「不知道该归谁」那一格，
      // 名册于是读成「一道门都没有」——第一版就是这么错的）。
      const key = item[1]
      const value = item[2]
      if (key === 'args') {
        current.args = parseInlineList(value, i + 1, errors)
      } else {
        current[key] = coerce(value)
      }
      continue
    }

    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(trimmed)
    if (!kv) {
      errors.push(`第 ${i + 1} 行：这一行不是它认识的形状（${trimmed.slice(0, 60)}）`)
      continue
    }
    const key = kv[1]
    const value = kv[2]

    if (indent === 2) {
      if (key === 'repo-root') {
        repoRoot = String(coerce(value))
        inGates = false
        current = null
        continue
      }
      if (key === 'gates') {
        inGates = true
        current = null
        continue
      }
      errors.push(`第 ${i + 1} 行：「caesura:」下面只认 repo-root 与 gates，读到「${key}」`)
      continue
    }

    if (inGates && current && indent >= 4) {
      if (key === 'args') {
        current.args = parseInlineList(value, i + 1, errors)
      } else {
        current[key] = coerce(value)
      }
      continue
    }
    errors.push(`第 ${i + 1} 行：这一格不知道该归谁（缩进 ${indent}，键 ${key}）`)
  }
  return { repoRoot, gates, errors }
}

/**
 * 行内数组：`["run", "lint"]` ⇒ `['run', 'lint']`。
 * 读不懂就记一条并给一个空数组（**不猜**）。
 */
function parseInlineList(value, lineNo, errors) {
  const m = /^\[(.*)\]$/.exec(value.trim())
  if (!m) {
    errors.push(`第 ${lineNo} 行：args 要写成行内数组（["run", "lint"]），读到「${value}」`)
    return []
  }
  const inner = m[1].trim()
  if (inner === '') return []
  const parts = inner.split(',').map((s) => s.trim()).filter((s) => s !== '')
  return parts.map((p) => {
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) return p.slice(1, -1)
    errors.push(`第 ${lineNo} 行：args 的每一项都要带引号（读到「${p}」）`)
    return p
  })
}

/** 值的归一：整数→number，布尔→boolean，其余→去引号的字符串 */
function coerce(value) {
  const v = String(value).trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+$/.test(v)) return Number(v)
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
  return v
}

/**
 * 判据①：名册的形状。
 * @param {{ gates: Record<string, unknown>[], errors: string[] }} roster
 * @returns {SpringFinding[]}
 */
export function rosterShapeFindings(roster) {
  const out = []
  for (const e of roster?.errors ?? []) {
    out.push({ key: '名册读不懂', msg: e })
  }
  const gates = roster?.gates ?? []
  if (!gates.length) {
    out.push({ key: '名册形状', msg: '名册里一道门都没有 ⇒ 这一族今天什么也守不了' })
    return out
  }
  const seen = new Map()
  gates.forEach((g, i) => {
    const at = `第 ${i + 1} 格`
    for (const key of ROSTER_KEYS) {
      if (!(key in g)) out.push({ key: '名册形状', msg: `${at} 少了「${key}」` })
    }
    const id = typeof g.id === 'string' ? g.id : ''
    if (id === '') {
      out.push({ key: '名册形状', msg: `${at} 没有门 id（id 是名册的主键，缺了它 Java 侧就没法按名取命令）` })
    } else if (seen.has(id)) {
      out.push({ key: '名册形状', msg: `门 id「${id}」出现了两次（${seen.get(id)} 与 ${at}）⇒ 两个主人` })
    } else {
      seen.set(id, at)
    }
    const t = g['timeout-sec']
    if (typeof t !== 'number' || !Number.isInteger(t) || t <= 0) {
      out.push({ key: '名册形状', msg: `${at}（${id || '无名'}）的 timeout-sec 要是正整数，读到 ${JSON.stringify(t)}` })
    }
    if (typeof g.args !== 'object' || !Array.isArray(g.args)) {
      out.push({ key: '名册形状', msg: `${at}（${id || '无名'}）的 args 要是一个数组` })
    }
    if (typeof g.blocking !== 'boolean') {
      out.push({ key: '名册形状', msg: `${at}（${id || '无名'}）的 blocking 要写明 true/false（不写就分不出「红了算不算这一族失败」）` })
    }
  })
  return out
}

/**
 * 判据②③：Java 源码里不许出现门 id，也不许出现名册里的阈值。
 *
 * **用字面量当物证，不去猜意图**：同一个数/同一个名字在 Java 里出现第二遍 = 两个出处。
 *
 * @param {{ roster: { gates: Record<string, unknown>[] }, javaFiles: {rel: string, text: string}[] }} input
 * @returns {SpringFinding[]}
 */
export function javaHardcodeFindings({ roster, javaFiles }) {
  const out = []
  const files = javaFiles ?? []
  const gates = roster?.gates ?? []
  for (const g of gates) {
    const id = typeof g.id === 'string' ? g.id : ''
    if (id) {
      for (const f of files) {
        if (f.text.includes(id)) {
          out.push({
            key: `门 id 写死在 Java · ${f.rel}`,
            msg: `Java 源码里出现了门 id「${id}」⇒ 这道门有了第二个主人（Java 那个分支与名册那一格可以各说各话）。`
              + '修法：Java 侧按名册给的 id 去取命令，不按 id 写分支。',
          })
        }
      }
    }
    const t = g['timeout-sec']
    if (typeof t === 'number' && Number.isInteger(t)) {
      // 前后都不能挨着别的数字/小数点 ⇒ 「900」不会在「1900」「0.900」里被误认
      const rx = new RegExp(`(?<![\\d.])${t}(?![\\d.])`)
      for (const f of files) {
        if (rx.test(f.text)) {
          out.push({
            key: `阈值写死在 Java · ${f.rel}`,
            msg: `Java 源码里出现了阈值 ${t}（名册里 timeout-sec 的那个数）⇒ 这个上限有了两个出处（名册一份、Java 一份）。`
              + '修法：上限只住在配置服务器那一份名册里，Java 只把它读出来用。',
          })
        }
      }
    }
  }
  return out
}

/**
 * 判据④：名册指向的命令真的存在。
 *
 * `npm` + `["run", "<x>"]` ⇒ package.json 的 scripts 里要有 `<x>`；
 * `node` + `["scripts/<x>"]` ⇒ 仓里要有那份文件。
 *
 * @param {{ roster: {gates: Record<string, unknown>[]}, packageScripts: Record<string, string>, scriptFiles: string[] }} input
 * @returns {SpringFinding[]}
 */
export function commandTargetFindings({ roster, packageScripts, scriptFiles }) {
  const out = []
  const files = new Set(scriptFiles ?? [])
  for (const g of roster?.gates ?? []) {
    const id = typeof g.id === 'string' ? g.id : '(无名)'
    const command = String(g.command ?? '')
    const args = Array.isArray(g.args) ? g.args.map(String) : []
    if (command === 'npm') {
      if (args[0] !== 'run') {
        out.push({ key: '命令指向 · ' + id, msg: `npm 后面只认 "run"（读到 ${JSON.stringify(args)}）` })
        continue
      }
      const script = args[1]
      if (!script) {
        out.push({ key: '命令指向 · ' + id, msg: 'npm run 后面没有脚本名' })
        continue
      }
      if (!(script in (packageScripts ?? {}))) {
        out.push({
          key: '命令指向 · ' + id,
          msg: `名册让这一族跑「npm run ${script}」，而 package.json 的 scripts 里没有这一条 ⇒ 这是一道空头承诺（跑起来会 404 退出码）。`,
        })
      }
      continue
    }
    if (command === 'node') {
      const target = args[0] ?? ''
      if (!target) {
        out.push({ key: '命令指向 · ' + id, msg: 'node 后面没有脚本路径' })
        continue
      }
      if (!files.has(target)) {
        out.push({
          key: '命令指向 · ' + id,
          msg: `名册让这一族跑「node ${target}」，而仓里没有这一份文件 ⇒ 这是一道空头承诺。`,
        })
      }
      continue
    }
    out.push({
      key: '命令指向 · ' + id,
      msg: `这一族只许调仓库既有的入口（npm / node），读到「${command}」⇒ 它会绕开 Node 侧那个判定主人。`,
    })
  }
  return out
}

/**
 * 判据⑤：拓扑不许少服务（compose ⇄ 模块 ⇄ 期望名单，三方一致）。
 *
 * @param {{ composeServices: string[], moduleNames: string[], expected: string[] }} input
 * @returns {SpringFinding[]}
 */
export function serviceTopologyFindings({ composeServices, moduleNames, expected }) {
  const out = []
  const want = expected ?? SERVICE_NAMES
  const compose = new Set(composeServices ?? [])
  const modules = new Set(moduleNames ?? [])
  for (const name of want) {
    if (!modules.has(name)) out.push({ key: '拓扑', msg: `模块 ${name} 不在（模块目录少了一个）` })
    if (!compose.has(name)) out.push({ key: '拓扑', msg: `服务 ${name} 不在 compose 里（compose 少了一个）` })
  }
  for (const name of compose) {
    if (!want.includes(name)) out.push({ key: '拓扑', msg: `compose 里多了一个服务「${name}」——它不在名册上 ⇒ 没人知道它是干什么的` })
  }
  for (const name of modules) {
    if (!want.includes(name)) out.push({ key: '拓扑', msg: `多了一个模块「${name}」——它不在名册上` })
  }
  return out
}

/**
 * 判据⑥（附）：Java 侧不许去读仓库的数据表 —— 判定只有一个主人。
 * @param {{ javaFiles: {rel: string, text: string}[] }} input
 * @returns {SpringFinding[]}
 */
export function javaReadsRepoDataFindings({ javaFiles }) {
  const out = []
  for (const f of javaFiles ?? []) {
    for (const needle of ['src/data/json', 'data/json/', 'progression.json', 'weapons.json']) {
      if (f.text.includes(needle)) {
        out.push({
          key: `Java 读了仓库数据 · ${f.rel}`,
          msg: `Java 源码里出现了「${needle}」⇒ 判定（什么算红）有了第二个主人。`
            + '修法：Java 只调用仓库既有的命令拿结论，不自己读表重算一遍。',
        })
      }
    }
  }
  return out
}
