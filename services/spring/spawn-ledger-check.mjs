/**
 * services/spring/spawn-ledger-check.mjs —— **进程账本核对器**（KI-441）。
 *
 * <p>它回答一句以前只能靠推断的话：**这一趟到底起了几个进程？**
 *
 * **为什么表不够用**：KI-429 那份夹具的注释写的是「开闸之后一个进程都不起（那一趟 0 毫秒）」。
 * 那个证据是**父亲的表**——而表量的是「花了多久」，不是「起了几个」。两件事在健康时凑巧同向，
 * 于是那句注释把巧合当成了测量。本批把它们分开量：
 *   ① `probe-unspawnable` 那一趟**什么都没起**，可它的毫秒数不是 0（表会说「跑了」）；
 *   ② `probe-red` 那一趟**真的起了一个进程**（node 报 MODULE_NOT_FOUND），可账本里一笔都没有
 *      （账本对不记账的门是**盲**的，核对器因此不许拿「账本没有」当「没起进程」——这条也是判据）；
 *   ③ 半开那一档要证的是「**恰好一个**孩子」，这件事表根本没有对应的格子。
 *
 * **证人换成孩子自己**：`services/spring/probe/spawn-mark.mjs` 每被真起一次就往账本里追加一行。
 * 核对器把每一行归到它发生时正在跑的那一趟里（窗口来自判决自带的 `ranAt` + `durationMs`），
 * 然后逐条对账：**判决说什么 vs 孩子记了什么**。
 *
 * **导入不动机器**：这一份被测试进程内 import（`tests/unit/spring-family-table.test.ts`），
 * 所以纯函数与「会动 HTTP/会读文件」的那半分开——跑真服务的那一句只在**当命令跑**时才执行。
 *
 * 用法（真服务起来之后；账本路径就是起服务时那个环境变量）：
 *   node services/spring/spawn-ledger-check.mjs --phase open     --base http://127.0.0.1:8083/gate
 *   node services/spring/spawn-ledger-check.mjs --phase halfopen --base http://127.0.0.1:8084/gate
 * 退出码：0 = 对得上；1 = 有红；2 = 用法不对／读不到服务／没有账本文件（**不拿空账本冒充干净**）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 账本路径唯一的出处：起 JVM 的那个人设这个变量，孩子与核对器读**同一个名字**（名字住在这儿，孩子 import 它） */
export const SPAWN_LEDGER_ENV = 'CAESURA_SPAWN_LEDGER'

/** 记账那个孩子的路径（相对仓库根）：名册里那一格的命令行点到它，那一趟才算「会记账的门」 */
export const MARK_SCRIPT_RELPATH = 'services/spring/probe/spawn-mark.mjs'

/**
 * 这一格名册是不是「会记账的门」：命令行里点没点到 `spawn-mark.mjs`。
 * 两种斜杠拼法都认（名册写的是相对仓库根的路径，Windows 上跑起来还是这一个拼法）。
 */
export function isMarking(command) {
  const c = String(command ?? '').replace(/\\/g, '/')
  return c.includes(MARK_SCRIPT_RELPATH)
}

/**
 * 名册里所有「会记账」的门 id。
 * @param {{ id: string, command: string }[]} rows —— `GET /gates` 里那几格
 * @returns {string[]}
 */
export function markingIds(rows) {
  return (rows ?? []).filter((r) => isMarking(r.command)).map((r) => r.id)
}

/**
 * 账本文本 → 行。
 *
 * **读不懂的行报名，不静默跳过**：一笔读不懂的账如果被跳过，「这一趟账本里是 0 笔」
 * 就再也证明不了「没起进程」——它只证明了「我没读出来」。
 * @param {string} text
 * @returns {{ rows: {atMs: number, pid: number, ppid: number|null, argv: string[]|null, lineNo: number}[], bad: {lineNo: number, why: string, text: string}[] }}
 */
export function parseLedger(text) {
  const rows = []
  const bad = []
  const lines = String(text ?? '').split(/\r?\n/)
  lines.forEach((l, idx) => {
    if (l.trim() === '') return
    const lineNo = idx + 1
    let o
    try {
      o = JSON.parse(l)
    } catch {
      bad.push({ lineNo, why: '这一行不是 JSON', text: l.slice(0, 160) })
      return
    }
    if (!o || typeof o !== 'object' || !Number.isFinite(o.atMs)) {
      bad.push({ lineNo, why: '没有可用的 atMs（它决定这一笔归哪一趟）', text: l.slice(0, 160) })
      return
    }
    if (!Number.isInteger(o.pid)) {
      bad.push({ lineNo, why: 'pid 不是整数（一个进程一笔账靠它认）', text: l.slice(0, 160) })
      return
    }
    rows.push({
      atMs: o.atMs,
      pid: o.pid,
      ppid: Number.isInteger(o.ppid) ? o.ppid : null,
      argv: Array.isArray(o.argv) ? o.argv.map(String) : null,
      lineNo,
    })
  })
  return { rows, bad }
}

/**
 * 每一趟跑测 → 一个时间窗口 + 这一趟**应该**有几笔账。
 *
 * `allowed` 只认一个拼法：`verdict === 'circuit_open'` 是唯一「没有起跑」的判决
 * （`error` 是跑了但起不来，`timeout` 是起了没跑完——两者都算起了）。
 *
 * **被拒的那一趟窗口不是零宽**：那一趟的 `durationMs` 天生是 0（它什么都没做），
 * 于是 `[from, from]` 这一根针**抓不住**「谎话里的孩子」——孩子真被起起来时记账总是晚几毫秒，
 * 那几笔会落进下一趟的头上（报成一条归因错位的红，而不是「闸没关上」）。
 * 所以零宽窗口一律补到**下一趟起跑之前**（右界取 `下一趟.fromMs - 1`：同一毫秒不能算两家）：
 * 那一段里只有这一趟在场，判据说的还是同一句话。
 * 带 `group` 的那几趟**不补**：并发一组的个数由组那一层数，补长窗口只会把别人的账吸进来。
 * 最后一趟没有下一趟可参照 ⇒ 不补（那种情况下由 `总数对不上` 兜住：个数照样对不上，只是归因粗一点）。
 *
 * @param {{id: string, verdict: string, exitCode: number, durationMs: number, ranAt: string, group?: string|null, circuitState?: string|null, after?: object}[]} rounds
 * @param {{ marking?: string[] }} opts
 * @returns {{i: number, id: string, verdict: string, exitCode: number, circuitState: string|null, durationMs: number|null, fromMs: number|null, toMs: number|null, allowed: boolean, marking: boolean, expectedMarks: number, group: string|null, unreadable: string[], after: object|null}[]}
 */
export function roundWindows(rounds, { marking = [] } = {}) {
  const set = new Set(marking)
  const ws = (rounds ?? []).map((r, i) => {
    const fromMs = Date.parse(String(r.ranAt ?? ''))
    const durationMs = Number.isFinite(r.durationMs) ? r.durationMs : null
    const unreadable = []
    if (!Number.isFinite(fromMs)) unreadable.push(`ranAt「${r.ranAt}」读不出时刻`)
    if (durationMs === null) unreadable.push(`durationMs「${r.durationMs}」不是数`)
    if (typeof r.verdict !== 'string' || r.verdict === '') unreadable.push('判决没有 verdict 那一格')
    const allowed = r.verdict !== 'circuit_open'
    const isMark = set.has(r.id)
    return {
      i,
      id: r.id,
      verdict: r.verdict ?? null,
      exitCode: r.exitCode ?? null,
      circuitState: r.circuitState ?? null,
      durationMs,
      fromMs: Number.isFinite(fromMs) ? fromMs : null,
      toMs: Number.isFinite(fromMs) && durationMs !== null ? fromMs + durationMs : null,
      allowed,
      marking: isMark,
      expectedMarks: isMark && allowed ? 1 : 0,
      group: r.group ?? null,
      unreadable,
      after: r.after ?? null,
    }
  })
  for (const w of ws) {
    // 组里的那几趟**不补**：并发窗口的个数由组那一层数，补出来的长窗口会把后面几趟的账吸进来。
    if (w.group !== null) continue
    if (w.fromMs === null || w.toMs === null || w.toMs > w.fromMs) continue
    const next = ws.find((o) => o.i > w.i && o.fromMs !== null && o.fromMs > w.fromMs)
    // 右界是**下一趟起跑之前**，不是「起跑那一刻」：`<=` 归属会把同一毫秒的笔算进两边，
    // 那一笔就变成「归因错位」而不是「闸没关上」。
    if (next) w.toMs = next.fromMs - 1
  }
  return ws
}

/**
 * 把每一笔账归到**它发生时正在跑的那些趟**。
 *
 * 落进 1 个窗口 ⇒ 记在那一趟上；落进 ≥2 个 ⇒ `ambiguous`（并发那一趟本来就会重叠，
 * 交回组那一层的计数判据）；落进 0 个 ⇒ `outside`（不许丢：它要么属于另一趟，要么这一趟的
 * 窗口读不懂，两种都是要报名的事）。
 * @param {{atMs: number, pid: number}[]} marks
 * @param {{i: number, fromMs: number|null, toMs: number|null, group: string|null}[]} windows
 * @returns {{perRound: {atMs: number, pid: number}[][], ambiguous: {atMs: number, pid: number, in: number[]}[], outside: {atMs: number, pid: number}[]}}
 */
export function attributeMarks(marks, windows) {
  const perRound = (windows ?? []).map(() => [])
  const ambiguous = []
  const outside = []
  for (const m of marks ?? []) {
    const hits = (windows ?? []).filter(
      (w) => w.fromMs !== null && w.toMs !== null && m.atMs >= w.fromMs && m.atMs <= w.toMs,
    )
    if (hits.length === 1) perRound[hits[0].i].push(m)
    else if (hits.length > 1) ambiguous.push({ ...m, in: hits.map((h) => h.i) })
    else outside.push(m)
  }
  return { perRound, ambiguous, outside }
}

/**
 * 对账：判决说什么 ⇄ 孩子记了什么。
 * @param {{windows: ReturnType<typeof roundWindows>, attributed: ReturnType<typeof attributeMarks>, markCount: number, badLines?: {lineNo: number, why: string}[]}} input
 * @returns {{key: string, msg: string}[]}
 */
export function ledgerFindings({ windows, attributed, markCount, badLines = [] }) {
  const out = []
  const ws = windows ?? []
  if (ws.length === 0) {
    out.push({ key: '读数读不懂', msg: '一趟跑测记录都没有 ⇒ 这道核对器正在看一个空集合（不是干净，是没读）' })
    return out
  }
  const unreadable = ws.filter((w) => w.unreadable.length > 0)
  if (unreadable.length) {
    out.push({
      key: '读数读不懂',
      msg: `${unreadable.length} 趟的窗口推不出来：${unreadable.map((w) => `第 ${w.i + 1} 趟 ${w.id}（${w.unreadable.join('；')}）`).join(' / ')}`
        + '⇒ 没有窗口就没有归属，「账本里没这一笔」那句话当天就没有证人。',
    })
  }
  for (const f of badLines) {
    out.push({ key: '账本读不懂', msg: `账本第 ${f.lineNo} 行${f.why} ⇒ 它不能被算进任何一趟的个数` })
  }

  const per = attributed?.perRound ?? []
  // **带 group 的那几趟不由这一层判个数**：并发两笔的窗口本来就重叠，那笔账落进哪个窗口是猜的。
  // 硬要逐窗判，就会在「试探还在跑」那一趟上报一条假红（`判说跑了而孩子没记账`）——
  // 个数的判据交给下面那一条组级判据（整组恰好 1 个 allowed、恰好 1 个孩子）。
  for (const w of ws) {
    const got = (per[w.i] ?? []).length
    if (w.verdict === 'circuit_open' && got > 0) {
      out.push({
        key: '闸没关上',
        msg: `第 ${w.i + 1} 趟（${w.id}）判决是 circuit_open，可孩子的账本里有 ${got} 笔 ⇒ 那一趟真的起了进程，`
          + '「熔断中：这一趟没有起进程」这句话当场是假的。',
      })
    }
    if (w.marking && w.allowed && w.group === null && got === 0) {
      out.push({
        key: '判说跑了而孩子没记账',
        msg: `第 ${w.i + 1} 趟（${w.id}）被放行且判决是 ${w.verdict}，可账本里 0 笔 ⇒ 要么门没起那个进程（判决在撒谎），`
          + '要么孩子没记账（证人不可靠）。两种都要修，且不是修这句话。',
      })
    }
    if (w.marking && w.allowed && w.group === null && got > 1) {
      out.push({
        key: '一趟起了两个孩子',
        msg: `第 ${w.i + 1} 趟（${w.id}）账本里 ${got} 笔 ⇒ 名册里那一格被跑了 ${got} 遍（编排层重复起跑）。`,
      })
    }
    if (!w.marking && got > 0) {
      out.push({
        key: '不记账的门记了一笔',
        msg: `第 ${w.i + 1} 趟（${w.id}）名册里的命令行没点记账脚本，可它留下了 ${got} 笔 ⇒ `
          + '跑着的服务与现在这份名册不是同一份（改了名册没重启？）或者窗口重叠把别人的账算到了它头上。',
      })
    }
  }

  // 并发那一组：整组只许 1 个 allowed、1 笔账
  const groups = new Map()
  for (const w of ws) {
    if (!w.group) continue
    if (!groups.has(w.group)) groups.set(w.group, [])
    groups.get(w.group).push(w)
  }
  for (const [name, list] of groups) {
    const allowed = list.filter((w) => w.allowed)
    const ids = list.map((w) => w.i)
    if (allowed.length !== 1) {
      out.push({
        key: '半开放了两道试探',
        msg: `组「${name}」里 ${list.length} 趟并发，放行的是 ${allowed.length} 趟（要恰好 1）⇒ `
          + '试探在跑的时候第二道必须被拒；放两道出去就不是「放一道试探」了。',
      })
    }
    const marks = list.reduce((n, w) => n + (per[w.i] ?? []).length, 0)
    const extra = (attributed?.ambiguous ?? []).filter((m) => m.in.every((i) => ids.includes(i))).length
    if (marks + extra !== 1) {
      out.push({
        key: '试探的孩子数不对',
        msg: `组「${name}」整组起了 ${marks + extra} 个孩子（要恰好 1）⇒ 这一组要证的不是红绿，是个数。`,
      })
    }
  }
  const crossAmb = (attributed?.ambiguous ?? []).filter(
    (m) => new Set(m.in.map((i) => ws[i]?.group ?? null)).size > 1 || new Set(m.in.map((i) => ws[i]?.id)).size > 1 && !ws[m.in[0]]?.group,
  )
  if (crossAmb.length) {
    out.push({
      key: '走查说自己是 sequential 而窗口重叠了',
      msg: `${crossAmb.length} 笔账同时落进 ${crossAmb.map((m) => `[${m.in.map((i) => i + 1).join(',')}]`).join(' ')} 这些窗口，`
        + '而这些趟没被标成同一组 ⇒ 归属不能靠猜，这一趟的个数没有证人。',
    })
  }

  const dupes = new Map()
  for (const m of attributed?.perRound?.flat() ?? []) dupes.set(m.pid, (dupes.get(m.pid) ?? 0) + 1)
  for (const m of attributed?.ambiguous ?? []) dupes.set(m.pid, (dupes.get(m.pid) ?? 0) + 1)
  const doubled = [...dupes].filter(([, n]) => n > 1)
  if (doubled.length) {
    out.push({
      key: '一个进程记了两笔',
      msg: `pid ${doubled.map(([p, n]) => `${p}×${n}`).join(' ')} ⇒ 一个进程必须恰好一行；两笔就没了「一笔＝一个进程」这把尺。`,
    })
  }

  const expectedTotal = ws.reduce((n, w) => n + w.expectedMarks, 0)
  const gotTotal = markCount ?? 0
  if (gotTotal !== expectedTotal) {
    out.push({
      key: '总数对不上',
      msg: `账本一共 ${gotTotal} 笔，而这些趟按名册应该起 ${expectedTotal} 个孩子 ⇒ `
        + '窗口归属之外还有账（或账丢了）。这一条不看时钟：它只数个数。',
    })
  }
  return out
}

/**
 * 「表 vs 账本」那一张对照表——本批要的就是这张表本身。
 *
 * 它**不判红**：`0 毫秒` 与「没起进程」在健康时凑巧同向，所以这不是一个可以当判决的证据，
 * 而是一条要如实摆出来的关系：哪些趟上两者一致、哪些趟上表会多报、哪些趟上账本是盲的。
 * @param {ReturnType<typeof roundWindows>[]} windows
 * @param {ReturnType<typeof attributeMarks>} attributed
 * @returns {{rows: object[], summary: object}}
 */
export function stopwatchTable(windows, attributed) {
  const ws = windows ?? []
  const per = attributed?.perRound ?? []
  const rows = ws.map((w) => {
    const got = (per[w.i] ?? []).length
    const watchSays = w.durationMs === null ? 'unreadable' : w.durationMs === 0 ? 'no-time' : 'time-spent'
    const ledgerSays = !w.marking ? 'blind' : got === 0 ? 'no-child' : `child×${got}`
    let inference = 'blind'
    if (w.marking) {
      if (watchSays === 'no-time' && got > 0) inference = 'watch-underclaims'
      else if (watchSays === 'time-spent' && got === 0) inference = 'watch-overclaims'
      else inference = 'agree'
    }
    return { i: w.i, id: w.id, verdict: w.verdict, durationMs: w.durationMs, marks: got, marking: w.marking, watchSays, ledgerSays, inference }
  })
  const count = (k) => rows.filter((r) => r.inference === k).length
  return {
    rows,
    summary: {
      rounds: rows.length,
      markingRounds: rows.filter((r) => r.marking).length,
      blindRounds: rows.filter((r) => !r.marking).length,
      agree: count('agree'),
      watchOverclaims: count('watch-overclaims'),
      watchUnderclaims: count('watch-underclaims'),
      zeroDurationRounds: rows.filter((r) => r.durationMs === 0).length,
    },
  }
}

/**
 * 状态机那半的对账（KI-441 的第一句：半开那一档第一次被**读**，不是被推断）。
 *
 * 每一趟带一份**跑完之后**的账（`after`：`GET /circuit/{id}`），于是这些句子有了直接证人：
 * 试探失败之后闸是真的重新打开（`openedAtMs` 往前走了）、试探绿了之后是真的闭合（`CLOSED`），
 * 而不是「下一趟看起来像 OPEN」那样的反推。
 * @param {(ReturnType<typeof roundWindows> & {after?: {state: string, consecutiveFailures: number, trialInFlight: boolean, openedAtMs: number, remainingMs: number}})[]} windows
 * @param {{threshold?: number|null, trialExpected?: boolean}} opts —— `trialExpected` 由走查的相位决定：
 *        `open` 那一趟不等冷却（冷却是真钟，120 秒），所以它**不该**看到 HALF_OPEN；
 *        把「没走到半开」当成红，等于要求一趟故意不等钟的走查给出它没等的东西。
 * @returns {{key: string, msg: string}[]}
 */
export function halfOpenFindings(windows, { threshold = null, trialExpected = false } = {}) {
  const out = []
  const ws = windows ?? []
  const missing = ws.filter((w) => !w.after).length
  if (missing) {
    out.push({ key: '读数读不懂', msg: `${missing} 趟没有跑完之后的账（/circuit 那一格没读到）⇒ 状态机这半没有证人` })
    return out
  }
  for (const w of ws) {
    const a = w.after
    // 被拒那一趟的账**只允许两种形状**：OPEN（冷却还没到）或 HALF_OPEN 且 `trialInFlight=true`
    //（半开时试探正在跑，第二道必须撞在这句话上）。后者不是矛盾，它正是「只放一道试探」的直接证人。
    const trialHeldTheGate = a.state === 'HALF_OPEN' && a.trialInFlight === true
    if (w.verdict === 'circuit_open' && a.state !== 'OPEN' && !trialHeldTheGate) {
      out.push({
        key: '判决与账不符',
        msg: `第 ${w.i + 1} 趟说 circuit_open，可跑完之后这道门的账是 ${a.state}`
          + (a.state === 'HALF_OPEN' ? ' 且没有试探在跑 ⇒ 半开又没试探，那这一道是被什么拒的？' : ''),
      })
    }
    if (w.verdict !== 'circuit_open' && w.circuitState === 'OPEN') {
      out.push({ key: '判决与账不符', msg: `第 ${w.i + 1} 趟放着行（verdict=${w.verdict}）却说问的时候是 OPEN ⇒ OPEN 那一态的定义就是不起进程` })
    }
    if (w.circuitState === 'HALF_OPEN' && !w.allowed && w.after?.trialInFlight !== true) {
      out.push({
        key: '半开放不出试探',
        msg: `第 ${w.i + 1} 趟状态是 HALF_OPEN 却没放行，而跑完之后也没有试探在跑 ⇒ 那一档既没在跑试探也没放试探，`
          + '状态机卡住了。（并发那一趟的第二道被拒**不算**这一条：那时账上写着 `trialInFlight=true`，正是「只放一道」的证据。）',
      })
    }
  }
  // 试探绿 ⇒ CLOSED；试探败 ⇒ OPEN 且 openedAtMs 往前走
  // **被拒的那一趟不算试探**：它没起跑，绿不绿无从谈起（并发那一组的第二道正是这种）。
  const trials = ws.filter((w) => w.circuitState === 'HALF_OPEN' && w.allowed)
  if (trialExpected && !trials.length) {
    out.push({ key: '半开没走到', msg: '整趟走查里一次 HALF_OPEN 都没读到 ⇒ 冷却那一档没被真走过（这一条不是绿，是没测）' })
  }
  for (const t of trials) {
    const green = t.verdict === 'green'
    if (green && t.after.state !== 'CLOSED') {
      out.push({ key: '试探绿了没闭合', msg: `第 ${t.i + 1} 趟是绿试探，可跑完之后是 ${t.after.state}（要 CLOSED）` })
    }
    if (!green && t.after.state !== 'OPEN') {
      out.push({ key: '试探败了没重新开闸', msg: `第 ${t.i + 1} 趟试探没绿（${t.verdict}），可跑完之后是 ${t.after.state}（要 OPEN）` })
    }
  }
  const byGate = new Map()
  for (const w of ws) {
    if (!byGate.has(w.id)) byGate.set(w.id, [])
    byGate.get(w.id).push(w)
  }
  for (const [id, list] of byGate) {
    const opens = list.filter((w) => w.after.state === 'OPEN' && w.after.openedAtMs > 0)
    for (let i = 1; i < opens.length; i++) {
      if (opens[i].after.openedAtMs < opens[i - 1].after.openedAtMs) {
        out.push({ key: '开闸时刻倒退', msg: `${id} 的第 ${opens[i].i + 1} 趟记录的开闸时刻比第 ${opens[i - 1].i + 1} 趟还早 ⇒ 账本自己在撒谎` })
      }
    }
    const refused = list.filter((w) => w.verdict === 'circuit_open')
    for (let i = 1; i < refused.length; i++) {
      const prev = refused[i - 1].after.remainingMs
      const cur = refused[i].after.remainingMs
      if (prev > 0 && cur >= prev) {
        out.push({ key: '冷却没在走', msg: `${id} 连续两次被拒，还差的毫秒数从 ${prev} 变成 ${cur}（没有变小）⇒ 冷却是一个常数而不是钟` })
      }
    }
    if (threshold !== null) {
      // **谁该开闸**：只有「被跑到坏够次数、而这趟又没打算等冷却」的门才有资格被要求拒人。
      // 一直是绿的门（跑仓库真命令那几道）永远不该被拒；只跑了一趟的门也没资格；
      // 而**真等过冷却**的那道门（它的账里出现过 HALF_OPEN）本来就不该有被拒的那一趟——
      // 拿这三类去判「闸没开」是把编排的选择当成机制的判决。
      const opened = list.some((w) => w.verdict === 'circuit_open')
      const trialSeen = list.some((w) => w.circuitState === 'HALF_OPEN' && w.allowed)
      const failedAllowed = list.filter((w) => w.allowed && w.verdict !== 'green')
      if (!opened && !trialSeen) {
        if (failedAllowed.length >= threshold) {
          out.push({
            key: '闸没开',
            msg: `${id} 被跑了 ${list.length} 趟、其中 ${failedAllowed.length} 道是坏的（阈值 ${threshold}），`
              + '既没被拒过也没读到 HALF_OPEN ⇒ 熔断没接上，或者这一趟跑的这台服务根本没读那份 YAML。',
          })
        }
        continue
      }
      // 「连着坏几道开闸」数的不是**第一道被拒**，而是**账里第一次出现 OPEN 的那一趟**：
      // 半开那一档的试探也是「放出去的一道坏门」，把它算进「开闸之前坏了几道」会把阈值读成 4。
      const firstOpen = list.findIndex((w) => w.after.state === 'OPEN')
      if (firstOpen !== -1) {
        const upTo = list.slice(0, firstOpen + 1).filter((w) => w.allowed && w.verdict !== 'green').length
        if (upTo !== threshold) {
          out.push({
            key: '开闸的时机不对',
            msg: `${id} 的账里第一次出现 OPEN 是在第 ${firstOpen + 1} 趟，而「起跑且没绿」到那一趟一共 ${upTo} 道，`
              + `这台服务读到的 failure-threshold 是 ${threshold} ⇒ 阈值不是按这道门自己数的（或者这台服务用的不是那份 YAML）。`,
          })
        }
      }
    }
  }
  return out
}

/**
 * 从 `caesura-gate/application.yml` 现读那两个编排参数。
 *
 * **缺格就是 null，不回落默认值**：回落就等于核对器自己养了一份名册；
 * 同一个键出现两遍也如实报（`duplicates`），不玩「最后一个赢」。
 * @param {string} text
 * @returns {{failureThreshold: number|null, cooldownSec: number|null, duplicates: string[]}}
 */
export function parseCircuitYml(text) {
  const found = { failureThreshold: null, cooldownSec: null }
  const seen = { failureThreshold: 0, cooldownSec: 0 }
  const lines = String(text ?? '').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('#') || line === '') continue
    const m = /^(failure-threshold|cooldown-sec)\s*:\s*(-?\d+)\s*$/.exec(line)
    if (!m) continue
    const key = m[1] === 'failure-threshold' ? 'failureThreshold' : 'cooldownSec'
    found[key] = Number(m[2])
    seen[key] += 1
  }
  return {
    failureThreshold: found.failureThreshold,
    cooldownSec: found.cooldownSec,
    duplicates: Object.keys(seen).filter((k) => seen[k] > 1),
  }
}

/** 走查要用的角色：全部从**跑着的名册**现推（按命令行上的旗标认），核对器里不抄一份门 id 名单 */
export function rolesFromRoster(rows) {
  const list = rows ?? []
  const marking = list.filter((r) => isMarking(r.command))
  const flip = marking.find((r) => /--fail-first\b/.test(r.command)) ?? null
  const slow = marking.find((r) => /--sleep-ms\b/.test(r.command)) ?? null
  const markRed = marking.find((r) => /--exit\s+1\b/.test(r.command) && r !== flip && r !== slow) ?? null
  const markGreen = marking.find((r) => /--exit\s+0\b/.test(r.command) && r !== flip && r !== slow) ?? null
  const plain = list.filter((r) => !isMarking(r.command) && /^\s*(node|npm)\b/.test(String(r.command ?? '')))
  const unspawnable = list.filter((r) => !isMarking(r.command) && !/^\s*(node|npm)\b/.test(String(r.command ?? '')))
  return { flip, slow, markRed, markGreen, plain, unspawnable, marking, all: list }
}

/** 默认的 HTTP transport（**只有跑真服务时才用**） */
async function defaultRequest(method, path, base) {
  const r = await fetch(base + path, { method })
  const text = await r.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { _raw: text }
  }
  return { status: r.status, body }
}

/**
 * 走一遍（**会动 HTTP 与文件**，所以只有当命令跑时才跑它）。
 *
 * @param {{base: string, phase: 'open'|'halfopen', ledgerPath?: string, request?: Function, sleep?: Function,
 *          readLedger?: Function, truncateLedger?: Function, maxWaitMs?: number, circuitYml?: string}} opts
 */
export async function runSpawnLedgerCheck(opts) {
  const base = opts.base
  const phase = opts.phase ?? 'open'
  const maxWaitMs = opts.maxWaitMs ?? 15000
  const request = opts.request ?? ((method, path) => defaultRequest(method, path, base))
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const readLedger = opts.readLedger ?? (() => (existsSync(opts.ledgerPath) ? readFileSync(opts.ledgerPath, 'utf8') : null))
  const truncate = opts.truncateLedger ?? ((p) => writeFileSync(p, '', 'utf8'))
  const findings = []
  const readings = { phase, base, blocked: null, skipped: [] }

  if (opts.ledgerPath) truncate(opts.ledgerPath)

  const rosterResp = await request('GET', '/gates')
  const roster = rosterResp.body ?? {}
  const rows = Array.isArray(roster.gates) ? roster.gates : []
  readings.roster = { httpStatus: rosterResp.status, source: roster.source ?? null, count: rows.length, ids: rows.map((r) => r.id) }
  if (rows.length === 0) {
    findings.push({ key: '读数读不懂', msg: `名册读出 0 格（HTTP ${rosterResp.status}）⇒ 服务没起来或 context-path 不对，这一趟什么也没证` })
    return { verdict: 'RED', readings, findings, rounds: [], marks: [] }
  }
  const roles = rolesFromRoster(rows)
  readings.roles = Object.fromEntries(Object.entries(roles).filter(([k]) => !['marking', 'all'].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x.id) : v?.id ?? null]))

  const paramsResp = await request('GET', '/circuit')
  const params = paramsResp.body ?? {}
  const gateRows = Array.isArray(params.gates) ? params.gates : []
  readings.params = {
    httpStatus: paramsResp.status,
    failureThreshold: params.failureThreshold ?? null,
    cooldownSec: params.cooldownSec ?? null,
    cooldownMs: gateRows[0]?.cooldownMs ?? null,
    yaml: opts.circuitYml ? parseCircuitYml(opts.circuitYml) : null,
  }
  if (gateRows.length === 0) {
    findings.push({ key: '读数读不懂', msg: `/circuit 读出 0 道门（HTTP ${paramsResp.status}）⇒ 半开那一档没有证人，状态机这半今天没读数` })
    return { verdict: 'RED', readings, findings, rounds: [], marks: [] }
  }
  const notClean = gateRows.filter((g) => g.state !== 'CLOSED' || g.consecutiveFailures !== 0 || g.trialInFlight)
  if (notClean.length) {
    findings.push({
      key: '不是干净的开始',
      msg: `开跑之前这些门已经有账：${notClean.map((g) => `${g.id}=${g.state}/坏${g.consecutiveFailures}/试探${g.trialInFlight ? 'Y' : 'N'}`).join(' ')} ⇒ `
        + '这台服务不是刚起来的（或者上一趟没走完）。熔断的读数只在干净的进程上作数。',
    })
    return { verdict: 'RED', readings, findings, rounds: [], marks: [] }
  }

  const threshold = typeof params.failureThreshold === 'number' ? params.failureThreshold : null
  const cooldownMs = typeof gateRows[0]?.cooldownMs === 'number' ? gateRows[0].cooldownMs : null
  if (threshold === null || cooldownMs === null) {
    findings.push({ key: '读数读不懂', msg: `这台服务没报出 failure-threshold/cooldown（读到 ${threshold}/${cooldownMs}）⇒ 预言开闸的时机没有依据` })
  }

  /** 一趟：POST 跑门 → 记判决 → 立刻读那道门跑完之后的账 */
  const runOne = async (id, group = null) => {
    const resp = await request('POST', `/gates/${encodeURIComponent(id)}/run`)
    const body = resp.body ?? {}
    const after = await request('GET', `/circuit/${encodeURIComponent(id)}`)
    return { ...body, id: body.id ?? id, group, httpStatus: resp.status, after: after.body ?? null }
  }

  const rounds = []
  /** 真等过冷却那一档：等完之后**下一趟**才会读到 HALF_OPEN（等在自己还没坏的时候是不算的）。 */
  const waitPast = async () => {
    await sleep((cooldownMs ?? 0) + 300)
  }

  if (phase === 'open') {
    if (!roles.markRed) {
      findings.push({ key: '夹具不对', msg: '名册里没有「记账且退非零」的门 ⇒ 熔断没法被真打开，开闸那半今天没有读数' })
    } else {
      const n = (threshold ?? 3) + 2
      for (let i = 0; i < n; i++) rounds.push(await runOne(roles.markRed.id))
    }
    for (const g of roles.plain) rounds.push(await runOne(g.id))
    for (const g of roles.unspawnable) rounds.push(await runOne(g.id))
    if (roles.slow) rounds.push(await runOne(roles.slow.id))
  } else {
    if (!roles.markRed || !roles.flip) {
      findings.push({ key: '夹具不对', msg: `半开这一趟要「记账且退非零」的门与「头三次坏之后绿」的门，读到 markRed=${roles.markRed?.id ?? '无'}／flip=${roles.flip?.id ?? '无'}` })
    } else if (cooldownMs === null || cooldownMs > maxWaitMs) {
      // **先问能不能等**，再决定跑不跑：等不了就整趟作废（一半的读数比没有读数更容易被误当成证据）。
      readings.blocked = 'BLOCKED'
      readings.skipped.push(`半开这一趟要等冷却 ${cooldownMs}ms，超过本趟允许的 ${maxWaitMs}ms ⇒ 换一台把 cooldown-sec 改小的服务再走（不是跳过，是今天没有读数）`)
    } else {
      // 顺序是这三步的**全部意义**：坏够 → 等过钟 → 放一道出去。反过来先等再坏，那一趟读到的还是 OPEN。
      for (let i = 0; i < (threshold ?? 3); i++) rounds.push(await runOne(roles.markRed.id))
      await waitPast()
      rounds.push(await runOne(roles.markRed.id)) // 试探：起了进程、又是红的 ⇒ 重新开闸
      if (roles.slow) {
        for (let i = 0; i < (threshold ?? 3); i++) rounds.push(await runOne(roles.slow.id))
        await waitPast()
        const pair = await Promise.all([runOne(roles.slow.id, 'trial-pair'), runOne(roles.slow.id, 'trial-pair')])
        rounds.push(...pair)
      }
      for (let i = 0; i < (threshold ?? 3); i++) rounds.push(await runOne(roles.flip.id))
      await waitPast()
      rounds.push(await runOne(roles.flip.id)) // 绿试探 ⇒ 闭合
      rounds.push(await runOne(roles.flip.id)) // 闭合之后照跑
    }
  }

  const marking = roles.marking.map((r) => r.id)
  const windows = roundWindows(rounds, { marking })
  const ledgerText = readLedger()
  if (ledgerText === null || typeof ledgerText !== 'string') {
    findings.push({
      key: '没有账本',
      msg: `读不到账本文件${opts.ledgerPath ? `（${opts.ledgerPath}）` : ''} ⇒ 「一个进程都没起」这句话今天没有证人，不许绿。`,
    })
    return { verdict: 'RED', readings: { ...readings, rounds, ledger: 'MISSING' }, findings, rounds: [], marks: [] }
  }
  const parsed = parseLedger(ledgerText)
  const attributed = attributeMarks(parsed.rows, windows)
  findings.push(...ledgerFindings({ windows, attributed, markCount: parsed.rows.length, badLines: parsed.bad }))
  findings.push(...halfOpenFindings(windows, { threshold, trialExpected: phase === 'halfopen' }))
  const table = stopwatchTable(windows, attributed)
  readings.stopwatch = table.summary
  readings.overclaimRows = table.rows.filter((r) => r.inference === 'watch-overclaims').map((r) => ({ id: r.id, verdict: r.verdict, durationMs: r.durationMs }))
  readings.blindRows = table.rows.filter((r) => !r.marking).map((r) => `${r.id}/${r.verdict}`)
  readings.marks = parsed.rows.length
  readings.expected = windows.reduce((n, w) => n + w.expectedMarks, 0)

  const verdict = findings.length ? 'RED' : 'OK'
  return { verdict, readings, findings, rounds, table, marks: parsed.rows, bad: parsed.bad }
}

/**
 * 只有**当命令跑**才动 HTTP；被 import（测试只要那些纯函数）时一个进程都不起、一个请求都不发。
 * 名册主人是 `container-image-check.mjs` 用的那同一把判据：argv[1] 解析到本文件。
 */
const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (invoked && existsSync(invoked) && invoked === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2)
  const flag = (name, dflt) => {
    const i = argv.indexOf(`--${name}`)
    return i < 0 ? dflt : argv[i + 1]
  }
  const ledgerPath = flag('ledger', process.env[SPAWN_LEDGER_ENV])
  if (!ledgerPath) {
    process.stderr.write(`用法不对：账本路径要么用 --ledger 给，要么设 ${SPAWN_LEDGER_ENV}（与孩子读的那一个同名）\n`)
    process.exit(2)
  }
  const phase = flag('phase', 'open')
  if (phase !== 'open' && phase !== 'halfopen') {
    process.stderr.write(`--phase 只认 open / halfopen，拿到「${phase}」\n`)
    process.exit(2)
  }
  const ymlPath = flag('circuit-yml', resolve(dirname(fileURLToPath(import.meta.url)), 'caesura-gate/src/main/resources/application.yml'))
  const circuitYml = existsSync(ymlPath) ? readFileSync(ymlPath, 'utf8') : null
  const out = await runSpawnLedgerCheck({
    base: flag('base', 'http://127.0.0.1:8083/gate'),
    phase,
    ledgerPath,
    maxWaitMs: Number(flag('max-wait-ms', 15000)),
    circuitYml,
  })
  console.log(JSON.stringify(out, null, 2))
  process.exit(out.verdict === 'OK' ? 0 : 1)
}
