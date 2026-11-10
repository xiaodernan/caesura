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
export const SERVICE_NAMES = ['caesura-registry', 'caesura-config', 'caesura-gateway', 'caesura-gate', 'caesura-report', 'caesura-client']

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
 * 这一族**只许调仓库既有的入口**（判据④的那条链表，KI-422）。
 *
 * 它是「什么算一道真的门」的判据，所以住在判据这一侧；值只有一个出处：
 * 判据④的兜底报名与判据⑬认「起不来那一格」都用这一张表（两处各抄一遍就是两个主人）。
 *
 * @type {string[]}
 */
export const REPO_ENTRY_COMMANDS = ['npm', 'node']

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
      msg: `这一族只许调仓库既有的入口（${REPO_ENTRY_COMMANDS.join(' / ')}），读到「${command}」⇒ 它会绕开 Node 侧那个判定主人。`
        + '（夹具那一族允许这一格故意起不来：那一条由判据⑬点名，不走这里。）',
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
 * 判据⑩（KI-429）：进程形状——Windows 上 {@code npm} 要经过 {@code cmd /c}。
 *
 * **这道门是被实机读数逼出来的**：第一趟整族跑读数里，五道门有**三道**（都是 npm 那几道）
 * **一出生就死**——{@code Cannot run program "npm" ... error=2}：Windows 上 npm 是批处理文件，
 * {@code CreateProcess} 不能直接起它。
 *
 * **它能证**：门执行器里那个「按平台改进程形状」的那一段还在。
 * **它证不了**：退出码有没有原样传回来（cmd 有可能把它吞掉）——那一条由**实机读数**管。
 *
 * @param {{ javaFiles: {rel: string, text: string}[] }} input
 * @returns {SpringFinding[]}
 */
export function spawnShapeFindings({ javaFiles }) {
  const out = []
  const files = javaFiles ?? []
  const runner = files.find((f) => f.rel.includes('GateRunner.java'))
  if (!runner) {
    out.push({ key: '进程形状', msg: '找不到门执行器那份源码 ⇒ 进程怎么起无从判断' })
    return out
  }
  if (!runner.text.includes('spawnCommand(command')) {
    out.push({
      key: '进程形状',
      msg: '门执行器没有用那个「按平台改进程形状」的函数 ⇒ Windows 上 npm 这类批处理命令起不来'
        + '（实测过：一出生就死，报 Cannot run program "npm"）。'
        + '**认的是调用点**（`spawnCommand(command`），不是方法名——光有那个方法不算接上了。',
    })
  }
  if (!runner.text.includes('"cmd"') || !runner.text.includes('"/c"')) {
    out.push({
      key: '进程形状',
      msg: '门执行器里没有「cmd /c」那一档 ⇒ Windows 上仍然直接 CreateProcess 起 npm ⇒ 起不来。',
    })
  }
  return out
}

/**
 * 取 compose 里某个服务的那一格（从 `  <name>:` 到下一个同缩进的 `  <name>:` 之前）。
 * @param {string} text
 * @param {string} name
 * @returns {string|null}
 */
function composeServiceBlock(text, name) {
  const lines = String(text ?? '').split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`  ${name}:`)) {
      start = i
      break
    }
  }
  if (start < 0) return null
  const out = []
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^ {2}[a-z][\w-]*:\s*$/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

/**
 * 这个 Dockerfile **真的**把 node 带进镜像了吗？
 *
 * **为什么要专门剥掉注释**（这一条是被反向实测逼出来的，KI-430 第一版）：
 * 第一版判据写的是「文本里出现 `apt install nodejs` 就算有 node」——
 * 而那份 Dockerfile 的**注释里**正好写着「① 在 JRE 镜像里 `apt install nodejs npm`」
 * （那是**另一种做法**的说明，不是实际做的事）⇒ **一句注释就把这道门骗过了**，
 * 真把 `COPY --from=node` 那两行删掉，它还照样绿。
 *
 * **注释不是机制**：能在注释里写出来的东西，不会在镜像里存在。
 * 所以这里先剥掉整行注释，再问「有没有一条**会真的执行**的指令把 node 带进来」。
 *
 * 认得的三条路（每条都得是**会执行**的指令）：
 *   ① `COPY --from=node:22 …`——直接从 node 镜像抄；
 *   ② 一个叫 `node` 的构建阶段，而那个阶段自己**就是** node 镜像，再从它 `COPY --from=node`；
 *   ③ 真的 `apt`/`apt-get install` 了一个 node。
 *
 * @param {string} dockerfile
 * @returns {boolean}
 */
export function imageProvidesNode(dockerfile) {
  const code = String(dockerfile ?? '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
  // ① 直接从 node 镜像抄
  if (/COPY\s+--from=node(?:[:@])/i.test(code)) return true
  // ② 一个真的以 node 镜像为基础、且被 `COPY --from=node` 用上的阶段
  const stage = /^FROM\s+(\S+)\s+AS\s+node\s*$/im.exec(code)
  if (stage && /^node(?:[:@])/i.test(stage[1]) && /COPY\s+--from=node(?![-\w])/i.test(code)) return true
  // ③ 真的装了一个 node
  return /(?:apt-get|apt)\s+[^\n]*\binstall\b[^\n]*\bnode(?:js)?\b/i.test(code)
}

/**
 * 判据⑪（KI-430）：**容器形态**那几件必须成立的事。
 *
 * ① **镜像里必须有 node**——门跑的是仓库既有的 npm／node 入口；镜像里没有 node，
 *    容器里每一道门都会「起不来」（与 Windows 上没有 npm.cmd 是同一种死法）。
 * ② **每一格都得从那个 Dockerfile 构建**——只写 `image:` 的话，跑的是别人给的镜像，
 *    「那个镜像里有没有 node／JRE 对不对」就由 compose 说了算（不是由这份仓库说了算）。
 * ③ **客户端找注册中心要用服务名**：容器里的 `127.0.0.1` 指的是**它自己**。
 * ④ **注册进 Eureka 的主机名也要用服务名**：写 `127.0.0.1` 的话，别的容器会回连到自己身上。
 *
 * **这道门能证什么、不能证什么**：它证的是**形状**（上面四条）；
 * 它证不了「容器里那一族真跑通了」——那一条由**实机读数**管。
 *
 * @param {{ dockerfile: string, composeText: string, serviceNames: string[] }} input
 * @returns {SpringFinding[]}
 */
export function containerShapeFindings({ dockerfile, composeText, serviceNames }) {
  const out = []
  const df = String(dockerfile ?? '')
  const cx = String(composeText ?? '')

  if (!imageProvidesNode(df)) {
    out.push({
      key: '容器镜像',
      msg: 'Dockerfile 里没有 node ⇒ 容器里**每一道门都会「起不来」**（门跑的是仓库既有的 npm／node 入口）。',
    })
  }

  const clients = (serviceNames ?? []).filter((n) => n !== 'caesura-registry' && n !== 'caesura-config')
  for (const name of serviceNames ?? []) {
    const block = composeServiceBlock(cx, name)
    if (block === null) {
      out.push({ key: '容器镜像', msg: `compose 里没有 ${name} 那一格` })
      continue
    }
    if (!/^\s*build:/m.test(block)) {
      out.push({
        key: '容器镜像',
        msg: `compose 里的 ${name} 没有 build: ⇒ 它跑的是别人给的镜像`
          + '（那个镜像里有没有 node、JRE 对不对，就由 compose 说了算而不是这份仓库说了算）。',
      })
    }
  }
  for (const name of clients) {
    const block = composeServiceBlock(cx, name) ?? ''
    if (!/caesura-registry:8761\/eureka\//.test(block)) {
      out.push({
        key: '容器里的地址',
        msg: `compose 里的 ${name} 找注册中心时没有用服务名（caesura-registry:8761）`
          + '⇒ 容器里 `127.0.0.1` 指的是**它自己**，注册中心根本不在那儿。',
      })
    }
    if (!new RegExp(`--eureka\\.instance\\.hostname=${name}\\b`).test(block)) {
      out.push({
        key: '容器里的地址',
        msg: `compose 里的 ${name} 注册进 Eureka 时没有用**自己的服务名**当主机名`
          + '⇒ 别的容器按那个名字回连时，会连到**它自己**身上。',
      })
    }
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

/**
 * 编排参数名册（KI-429）：**谁拥有它**、它住在哪个键上。
 *
 * **值不在这儿**：判据不抄那些数——它从主人那份 YAML 现读。
 * 抄一份就是第二个主人（那一族病：同一个数两处出处，两边慢慢说不同的话）。
 *
 * **为什么编排参数不住配置服务器那份门名册**：名册只装**判定**
 * （门 id／族／命令／参数表／上限／是否阻塞）；编排参数（重试几次、熔断几道、并发几道）
 * 住各服务自己的 `application.yml`——和重试参数同一处置。塞进名册会让「名册」这个词失去意思。
 *
 * @type {{ owner: string, label: string, keys: string[] }[]}
 */
export const ORCHESTRATION_OWNERS = [
  {
    owner: 'services/spring/caesura-gate/src/main/resources/application.yml',
    label: '熔断',
    keys: ['failure-threshold', 'cooldown-sec'],
  },
  {
    owner: 'services/spring/caesura-report/src/main/resources/application.yml',
    label: '汇总',
    keys: ['concurrency'],
  },
]

/**
 * 从一份 YAML 文本里取一个标量（找不到就是 null —— **不猜**）。
 * @param {string} text
 * @param {string} key
 * @returns {string|number|null}
 */
function yamlScalar(text, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`^\\s*${escaped}\\s*:\\s*(\\S+)\\s*$`, 'm').exec(String(text ?? ''))
  if (!m) return null
  const raw = m[1].trim()
  if (/^-?\d+$/.test(raw)) return Number(raw)
  return raw
}

/**
 * 判据⑦（KI-429）：编排参数**各有主人**，而 Java 侧不许再写一遍那个数。
 *
 * **用字面量当物证，不去猜意图**（与判据②③同一把尺）：同一个数在 Java 里出现第二遍 = 两个出处。
 *
 * **为什么只查 Java 那一侧**：两个编排参数**可以合法地同值**（熔断阈值与并发度都可能是 3），
 * 字面量分不出谁是谁 ⇒ 「它也出现在别的 YAML 里」这一条判不了（也不该判）。
 * 能判的是：**主人那一格真的在** ＋ **Java 侧不许再抄一遍**。
 *
 * @param {{ owners: {owner: string, label: string, keys: string[]}[], ymlTexts: Record<string, string>, javaFiles: {rel: string, text: string}[] }} input
 * @returns {SpringFinding[]}
 */
export function orchestrationOwnerFindings({ owners, ymlTexts, javaFiles }) {
  const out = []
  for (const o of owners ?? []) {
    const text = ymlTexts?.[o.owner] ?? ''
    if (!text) {
      out.push({
        key: `编排参数 · ${o.label}`,
        msg: `读不到 ${o.owner} ⇒ ${o.label} 那一族的编排参数没有主人。`,
      })
      continue
    }
    for (const key of o.keys ?? []) {
      const value = yamlScalar(text, key)
      if (value === null) {
        out.push({
          key: `编排参数 · ${key}`,
          msg: `${o.owner} 里没有「${key}」这一格 ⇒ ${o.label} 那个编排参数没有主人`
            + '（Java 侧读不到它 ⇒ 它会用兜底值，而兜底值就是第二个主人）。',
        })
        continue
      }
      if (typeof value !== 'number') continue
      // 前后都不能挨着别的数字/小数点 ⇒ 「3」不会在「30」「0.3」里被误认
      const rx = new RegExp(`(?<![\\d.])${value}(?![\\d.])`)
      for (const f of javaFiles ?? []) {
        if (rx.test(f.text)) {
          out.push({
            key: `编排参数写死在 Java · ${f.rel}`,
            msg: `Java 源码里出现了编排参数「${key}」的值 ${value}（主人是 ${o.owner}）⇒ 这个数有了两个出处。`
              + '修法：Java 只把它从配置里读出来用。',
          })
        }
      }
    }
  }
  return out
}

/**
 * 判据⑧（KI-429）：名册**只装判定** —— 编排参数不许混进去。
 *
 * @param {string} rosterText
 * @returns {SpringFinding[]}
 */
export function rosterScopeFindings(rosterText) {
  const out = []
  const forbidden = ['circuit', 'concurrency', 'retry-attempts', 'retry-delay-ms']
  const lines = String(rosterText ?? '').split(/\r?\n/)
  lines.forEach((l, i) => {
    const m = /^ {2}([A-Za-z][\w-]*)\s*:/.exec(l)
    if (!m) return
    if (!forbidden.includes(m[1])) return
    out.push({
      key: '名册装了编排参数',
      msg: `第 ${i + 1} 行：名册里出现了「${m[1]}」⇒ 名册只装判定（门 id／族／命令／参数表／上限／是否阻塞）；`
        + '编排参数住各服务自己的 application.yml，塞进来会让「名册」这个词失去意思。',
    })
  })
  return out
}

/**
 * 判据⑨（KI-429）：熔断必须**接上了**，不是一个摆在那里的类。
 *
 * **这道门能证什么、不能证什么**（写在明处）：
 *  - 它能证：三态齐、门执行器**在起进程之前**问过熔断器、开闸时它如实说「这一趟没起进程」；
 *  - 它证不了：状态机算得对不对（那一条由 `CircuitBreakerTest.java` 的**真行为**读数管，
 *    冷却期用可换的时钟推进，不用真等）。
 *
 * @param {{ javaFiles: {rel: string, text: string}[] }} input
 * @returns {SpringFinding[]}
 */
export function breakerWiredFindings({ javaFiles }) {
  const out = []
  const files = javaFiles ?? []
  const breaker = files.find((f) => f.rel.includes('CircuitBreaker.java'))
  if (!breaker) {
    out.push({
      key: '熔断',
      msg: '这一族里没有熔断器那个类 ⇒ 名册与 YAML 里写了熔断参数，运行时却没有熔断。',
    })
    return out
  }
  for (const state of ['CLOSED', 'OPEN', 'HALF_OPEN']) {
    if (!breaker.text.includes(state)) {
      out.push({ key: '熔断', msg: `熔断器里没有 ${state} 那一态（三个态缺一个 ⇒ 状态机不完整）` })
    }
  }
  const runner = files.find((f) => f.rel.includes('GateRunner.java'))
  if (!runner) {
    out.push({ key: '熔断', msg: '找不到门执行器那份源码 ⇒ 熔断接在哪儿无从判断' })
    return out
  }
  if (!runner.text.includes('breaker.beforeRun(')) {
    out.push({
      key: '熔断',
      msg: '门执行器没有在起进程之前问熔断器（熔断必须接在**起进程之前**——起完再问就晚了）。'
        + '**认的是调用点**（`breaker.beforeRun(`），不是方法名——光有那个类不算接上了。',
    })
  }
  if (!runner.text.includes('circuit_open')) {
    out.push({
      key: '熔断',
      msg: '门执行器没有「熔断中」那个判决（开闸时它必须如实说这一趟没起进程）。',
    })
  }
  return out
}

/**
 * 判据⑫（KI-441）：**夹具里的编排数字必须与服务读的那一个一致**。
 *
 * 半开那一趟的形状是这样的：连着坏 `failure-threshold` 道 ⇒ 开闸 ⇒ 冷却过去 ⇒ 放一道试探。
 * 「试探必须是绿的」这件事由 `--fail-first N` 那一格决定：孩子从前 N 次退 1、第 N+1 次退 0。
 * 于是 **N 与服务读的阈值是两个出处**——改了 YAML 没改夹具（或反之），那趟就量歪：
 * N 偏大 ⇒ 试探那一趟还是红的，读不到 `OPEN→HALF_OPEN→CLOSED`；N 偏小 ⇒ 闸在试探之前就又开了。
 *
 * 第二格同理：`--sleep-ms S` 是「这一趟还没跑完时第二道请求打进来了」那把锁闩，
 * 它必须**大于这一格自己的 `timeout-sec`**，否则那一趟真的跑完了，`trialInFlight` 从来没被并发读到过。
 *
 * @param {{ gates: Record<string, unknown>[], failureThreshold?: number|null }} input
 * @returns {SpringFinding[]}
 */
export function probeNumbersFindings({ gates, failureThreshold = null }) {
  const out = []
  for (const g of gates ?? []) {
    const id = typeof g.id === 'string' ? g.id : '(无名)'
    const line = joinedCommand(g)
    const failFirst = flagValue(line, '--fail-first')
    if (failFirst !== null) {
      if (failureThreshold === null || typeof failureThreshold !== 'number') {
        out.push({
          key: `夹具数字 · ${id}`,
          msg: `${id} 写了 --fail-first ${failFirst}，而服务那边读不到 failure-threshold ⇒ 这两个数是不是同一个没有证人`
            + '（半开那一趟要的是「坏够了的那一次正好是绿的」，两边各自写一个数就没有「正好」）。',
        })
      } else if (failFirst !== failureThreshold) {
        out.push({
          key: `夹具数字 · ${id}`,
          msg: `${id} 的 --fail-first 是 ${failFirst}，而这台服务读到的 failure-threshold 是 ${failureThreshold} ⇒ `
            + '试探那一趟不是绿的（偏大）就是闸提前又开了（偏小），半开那一档量歪。这两处必须同一个数。',
        })
      }
    }
    const sleepMs = flagValue(line, '--sleep-ms')
    if (sleepMs !== null) {
      const t = g['timeout-sec']
      if (typeof t !== 'number' || !Number.isInteger(t) || t <= 0) {
        out.push({ key: `夹具数字 · ${id}`, msg: `${id} 要睡 ${sleepMs} 毫秒，可它的 timeout-sec 读不出正整数 ⇒ 比不了大小` })
      } else if (sleepMs <= t * 1000) {
        out.push({
          key: `夹具数字 · ${id}`,
          msg: `${id} 睡 ${sleepMs} 毫秒，而它的上限是 ${t} 秒（${t * 1000} 毫秒）⇒ 这一趟会在被杀之前跑完，`
            + '「试探还在跑的时候第二道必须被拒」那一格永远读不到（trialInFlight 只在没跑完的那一段里是真的）。',
        })
      }
    }
  }
  return out
}

/**
 * 判据⑬（KI-441）：**夹具名册第一次有自己的机器读者**。
 *
 * 真名册有判据①②③④盯着；夹具那份（`caesura-gates-probe.yml`）以前**没有读者**——
 * 它是实测时才供出去的，而实测一趟要几分钟，没人会在改坏它之后还跑一遍。
 * KI-441 之后它不再是「一次性道具」：账本核对的三句话（开闸 0 个孩子 / 半开恰好 1 个 /
 * error 那趟 0 个而毫秒数不是 0）全靠这几格**各就各位**。缺任何一格，那句话当天就没有证人。
 *
 * 认角色**不抄门 id**：按命令行上的旗标认（与核对器 `rolesFromRoster` 同一套拼法——
 * 两边是不是同一套由 `tests/unit/spring-family-table.test.ts` 那条对账腿钉住）。
 *
 * @param {{ rosterText: string, scriptFiles: string[], markingRelpath: string, entryCommands?: string[], gateAppYml?: string|null }} input
 * @returns {SpringFinding[]}
 */
export function probeRosterFindings({
  rosterText,
  scriptFiles,
  markingRelpath,
  entryCommands = REPO_ENTRY_COMMANDS,
  gateAppYml = null,
}) {
  const out = []
  const read = parseGateRoster(rosterText)
  out.push(...rosterShapeFindings(read))
  const gates = read.gates ?? []
  if (!gates.length || read.errors.length) return out
  if (typeof markingRelpath !== 'string' || markingRelpath === '') {
    out.push({ key: '夹具读者', msg: '没给记账脚本的路径 ⇒ 分不清哪一格会记账，这一族今天没有读者' })
    return out
  }
  const files = new Set(scriptFiles ?? [])
  const marking = gates.filter((g) => joinedCommand(g).replace(/\\/g, '/').includes(markingRelpath))
  const nonMarking = gates.filter((g) => !joinedCommand(g).replace(/\\/g, '/').includes(markingRelpath))
  const has = (list, flag) => list.some((g) => flagValue(joinedCommand(g), flag) !== null)
  const exitOne = marking.filter((g) => flagValue(joinedCommand(g), '--exit') === 1)

  if (!exitOne.length) {
    out.push({ key: '夹具读者', msg: '没有「记账且退非零」的门 ⇒ 熔断没法被真打开，开闸那一档今天没有读数' })
  }
  if (!marking.some((g) => flagValue(joinedCommand(g), '--exit') === 0)) {
    out.push({ key: '夹具读者', msg: '没有「记账且退零」的门 ⇒ 证不了熔断是按门记的（坏一道不该让别的门跑不了）' })
  }
  if (!has(marking, '--fail-first')) {
    out.push({ key: '夹具读者', msg: '没有「坏够了就转绿」的门 ⇒ 半开到闭合那一档只能靠推断，读不到' })
  }
  if (!has(marking, '--sleep-ms')) {
    out.push({ key: '夹具读者', msg: '没有「跑不完」的门 ⇒ 并发那两下打不到同一个 trialInFlight，「恰好一个孩子」没有证人' })
  }
  const unspawnable = nonMarking.filter((g) => !entryCommands.includes(String(g.command ?? '')))
  if (!unspawnable.length) {
    out.push({
      key: '夹具读者',
      msg: `没有「起不来」的门（每格非记账的命令行首都是 ${entryCommands.join('/')}）⇒ `
        + '第 ③ 句（0 个孩子而毫秒数不是 0）当天没有读数：那种死法只有 error 那一格能造。',
    })
  }
  if (!nonMarking.length) {
    out.push({
      key: '夹具读者',
      msg: '夹具里每一格都记账 ⇒ 账本的**盲区**今天没被走过：「账本里没这一笔」只有在'
        + '存在不记账的门时才是「没起进程」的证据，全记账时它是同一句话的空转。',
    })
  }
  for (const g of marking) {
    const id = typeof g.id === 'string' ? g.id : '(无名)'
    const args = Array.isArray(g.args) ? g.args.map(String) : []
    const target = args.find((a) => String(a).replace(/\\/g, '/').includes(markingRelpath))
    if (!target) continue
    if (!files.has(String(target).replace(/\\/g, '/'))) {
      out.push({
        key: `夹具指向不存在的脚本 · ${id}`,
        msg: `夹具让这一族跑「node ${target}」，而仓里没有这一份文件 ⇒ 那一格一出生就死，`
          + '它留下的不是「0 个孩子」而是「一个进程都没跑到记账」——两种说法在账本里长得一模一样。',
      })
    }
  }
  out.push(...probeNumbersFindings({ gates, failureThreshold: thresholdOf(gateAppYml) }))
  return out
}

/**
 * 从 `caesura-gate` 自己那份 `application.yml` 现读熔断阈值（读不到就是 null ⇒ ⑫ 会报名）。
 *
 * 这里**不抄值**：判据⑦ 已经用同一个 `yamlScalar` 认过这个键，两处同一把尺。
 * @param {string|null|undefined} gateAppYml
 * @returns {number|null}
 */
function thresholdOf(gateAppYml) {
  const v = yamlScalar(gateAppYml ?? '', 'failure-threshold')
  return typeof v === 'number' ? v : null
}

/**
 * 判据⑭（KI-441）：熔断必须问在**起跑之前**——不是「问过」，是**问的位置**。
 *
 * 判据⑨ 钉的是「`breaker.beforeRun(` 这一串在不在」，它读不出**顺序**：
 * 把那一行挪到 `builder.start()` 之后，⑨ 照样绿，而那时进程已经起来了——
 * 「这一趟没有起进程」那句话当场变成谎话，而判决的形状（exit -1 / durationMs 0）一点没变。
 * 本批把证人换成孩子的账本之后，这种谎会被 `闸没关上` 抓住；但抓住它要跑一趟真服务，
 * 而这一条是**源码位置**，进程内就能判——所以把它单独钉住。
 *
 * @param {{ javaFiles: {rel: string, text: string}[] }} input
 * @returns {SpringFinding[]}
 */
export function breakerOrderFindings({ javaFiles }) {
  const out = []
  const runner = (javaFiles ?? []).find((f) => f.rel.includes('GateRunner.java'))
  if (!runner) {
    out.push({ key: '熔断问的时机', msg: '找不到门执行器那份源码 ⇒ 熔断问在起跑之前还是之后无从判断' })
    return out
  }
  const ask = runner.text.indexOf('breaker.beforeRun(')
  const start = runner.text.indexOf('builder.start(')
  const refusal = runner.text.indexOf('"circuit_open"')
  if (ask === -1) {
    out.push({ key: '熔断问的时机', msg: '门执行器里没有 `breaker.beforeRun(` 那个调用点 ⇒ 顺序判不了（先有那一问，才谈得上问得早不早）' })
  }
  if (start === -1) {
    out.push({ key: '熔断问的时机', msg: '门执行器里没有 `builder.start(` 那个起跑点 ⇒ 「之前」没有参照，顺序判不了' })
  }
  if (ask !== -1 && start !== -1 && ask > start) {
    out.push({
      key: '熔断问的时机',
      msg: `熔断器是在起跑**之后**才被问的（` + '`breaker.beforeRun(` 在第 ' + (runner.text.slice(0, ask).split(/\r?\n/).length)
        + ' 行，`builder.start(` 在第 ' + (runner.text.slice(0, start).split(/\r?\n/).length) + ' 行）⇒ '
        + '开闸那一趟**已经起了一个进程**，而判决还会说 circuit_open／0 毫秒：形状对、话是谎。',
    })
  }
  if (ask !== -1 && start !== -1 && refusal !== -1 && refusal > start) {
    out.push({
      key: '熔断问的时机',
      msg: '「circuit_open」那个判决在源码里出现在起跑之后 ⇒ 拒绝那一条路径不再是「什么都不做就回话」（它变成了跑完再改口）。',
    })
  }
  return out
}

/**
 * 名册那一格 → 人读的那一串（与 Java 的 `GateController` 同一拼法：command + 空格 + args）。
 * @param {Record<string, unknown>} gate
 * @returns {string}
 */
function joinedCommand(gate) {
  const args = Array.isArray(gate?.args) ? gate.args.map(String) : []
  return [String(gate?.command ?? ''), ...args].join(' ').trim()
}

/**
 * 从一个命令行串里取 `--flag` 后面的那个整数；没有这个旗标就是 null（**不猜**）。
 * @param {string} line
 * @param {string} flag
 * @returns {number|null}
 */
function flagValue(line, flag) {
  const m = new RegExp(`${flag}\\s+(-?\\d+)(?!\\s*[-\\d])`).exec(String(line ?? ''))
  if (!m) return null
  return Number(m[1])
}
