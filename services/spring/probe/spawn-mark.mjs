/**
 * services/spring/probe/spawn-mark.mjs —— **孩子自己那一笔账**（KI-441）。
 *
 * <p>它只干一件事：**真的被起起来**的那一趟，往账本里追加一行；然后按名册要求退出。
 * 它不判定、不读仓库数据、不参与任何真实门的工作——它是**见证人**，不是被告。
 *
 * **为什么要它**（这一条是本批的落点）：
 * KI-429 那份夹具的注释里写着「开闸之后一个进程都不起（**那一趟 0 毫秒**）」——
 * 那句话的证据是**父亲的表**。表是被告自己的读数：它量的是「这一趟花了多久」，
 * 不是「这一趟起了几个进程」。而熔断真正要证的三件事全都是**个数**：
 *   ① 开闸那一趟 **0 个**孩子；
 *   ② 半开那一档**恰好 1 个**孩子（并发打两次也只放一道试探）；
 *   ③ 「起不来」（error）那一趟也是 **0 个**孩子——可它的毫秒数不是 0。
 * 第 ③ 条正是表说不清的那一格：`0 毫秒` 既不是「没起进程」的充分证据也不是必要证据。
 *
 * **记账的规矩**（每一条都有腿盯着，见 `tests/unit/spring-family-table.test.ts` 的 KI-441 那一组）：
 *  - 账本路径只有一个出处：环境变量 `SPAWN_LEDGER_ENV` 所代表的那一个——**名字本身住在核对器里**，
 *    这里 import 它，不抄第二遍（抄了就没有机器能查出第二个主人）；
 *  - 环境变量没设 ⇒ **拒绝并退非零**，绝不「没账可记就算了」：那样一来「账本里没有这一笔」
 *    就再也不能证明「没起进程」了（沉默的见证人比没有见证人更坏）；
 *  - 一个进程**恰好一行**：写两行 ⇒ 核对器报「一趟起了两个孩子」；写不下 ⇒ 退非零，不许假装记过了。
 *
 * 用法（名册里那一格就是这么写的）：
 *   node services/spring/probe/spawn-mark.mjs --exit 1
 * 可选：
 *   --sleep-ms <n>   记完账之后再睡 n 毫秒（给「超时那一趟」用：孩子真起了、真被杀了）
 *   --fail-first <n> 头 n 次退 1、之后退 0 ——「次数」从**账本自己**数（同一串 argv 已经记了几笔），
 *                    不另立一个计数器：半开那一档要的正是「连着坏够了、下一次是绿的」那一道门。
 * 退出码：`--exit` 指的那个（0 以外 ⇒ 门红）；用法不对 2；没账本可记 3；写不下 4。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { SPAWN_LEDGER_ENV } from '../spawn-ledger-check.mjs'

/** 取一个 `--flag` 后面的整数；缺省时回 defaultValue；拼错不退 0（退 0 会让一道坏门变绿） */
function intFlag(argv, flag, defaultValue, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const i = argv.indexOf(flag)
  if (i < 0) {
    return defaultValue
  }
  const raw = argv[i + 1]
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    process.stderr.write(`spawn-mark: ${flag} 要一个 ${min}..${max} 的整数，拿到的是「${raw}」\n`)
    process.exit(2)
  }
  return n
}

const ledger = process.env[SPAWN_LEDGER_ENV]
if (!ledger) {
  process.stderr.write(
    `spawn-mark: 环境变量 ${SPAWN_LEDGER_ENV} 没设 ⇒ 没有账本可记。` +
      '我不退 0：「孩子跑过了而账本里没有它」比「孩子没跑」更坏。\n',
  )
  process.exit(3)
}

const argvRest = process.argv.slice(2)

/**
 * 「这一道门以前被起过几次」——从账本里数**同一串 argv** 的行数。
 * 账本不存在 = 还没有过孩子 = 0 次（这一格不许当成错误：第一次跑就是第一次）。
 */
function previousCount(ledgerPath, argv) {
  if (!existsSync(ledgerPath)) return 0
  const mine = JSON.stringify(argv)
  let n = 0
  for (const line of readFileSync(ledgerPath, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      if (JSON.stringify(JSON.parse(line).argv) === mine) n++
    } catch {
      // 读不懂的行由核对器报名，不在这里判；数不着就是数不着
    }
  }
  return n
}


const exitWanted = intFlag(argvRest, '--exit', 0, { max: 255 })
const sleepMs = intFlag(argvRest, '--sleep-ms', 0)
const failFirst = intFlag(argvRest, '--fail-first', -1, { min: 0 })

/** 头 failFirst 次退非零、之后退 0：次数在**记账之前**数，所以第 failFirst+1 次就是第一次绿的 */
let want = exitWanted
if (failFirst >= 0) {
  want = previousCount(ledger, argvRest) < failFirst ? 1 : 0
}

/**
 * 一行＝一个真起起来的过程。
 * `pid` 是**我自己**的：核对器用它证明「一笔账 = 一个过程」；
 * `ppid` 留在这儿是因为 Windows 那一档中间还隔着 `cmd /c` 一层壳——壳不记账，只有被名册点名的那一个记。
 */
const line = JSON.stringify({
  atMs: Date.now(),
  pid: process.pid,
  ppid: process.ppid ?? null,
  node: process.version,
  cwd: process.cwd(),
  argv: argvRest,
})

try {
  appendFileSync(ledger, `${line}\n`, 'utf8')
} catch (e) {
  process.stderr.write(`spawn-mark: 记不下这一笔（${ledger}）⇒ 这一趟不能算起了进程：${e}\n`)
  process.exit(4)
}

process.stdout.write(`spawn-mark pid=${process.pid} exit=${want}\n`)
if (sleepMs > 0) {
  // 睡在记账**之后**：账已经落了，这一趟起了进程这件事已经成了历史；
  // 之后被门杀掉动不了那一笔（超时那一档要证的正是这个）。
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs)
}
process.exit(want)
