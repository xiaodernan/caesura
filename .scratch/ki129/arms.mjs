#!/usr/bin/env node
/**
 * KI-129 的变异臂电池：把「谎旗挪错格」这个缺陷在平面上重新造出来，看这道门到底红几条、红在哪几条。
 *
 * 为什么要有这个文件：`dialogue-fields.test.ts` 那三道判据（字段名册 / 旗与散文同源 / 行为腿）加上
 * 已存在的 `bells` `faceless-lost` 两条线，声称自己钉住了"撒谎与诚实各走各路"。**声称不算证据**——
 * 只有把语义改坏、并且是"按每一种坏法"改坏，才能读出哪一格真的有人守着、哪一格是空的。
 *
 * 每一臂的纪律：
 *  · 一次只改一个语义量（不是删代码制造语法红 —— 语法红是零证据）；
 *  · needle 命中数必须等于预期，改完必须真的变字节（否则这一臂什么都没测）；
 *  · 期望红集用**基线收集到的真实标题**解析，每条期望必须恰好命中 1 条用例（命中 0 或 2 都是臂自己的 bug）；
 *  · 红集 = 期望集 ⇒ MATCHED；漏红 = 判据有洞；多红 = 这个语义量还有我没点名的读者（都得停下来查）；
 *  · 每臂跑完原字节还原并逐文件比对，还原失败就整批中止（不把脏平面留给下一臂）。
 *
 * 用法：node .scratch/ki129/arms.mjs <平面根> [--arm NAME]
 * 前提：平面上 `splice.mjs` 已应用（这一批的量词以"挪完之后"为准）。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = process.argv[2]
if (!ROOT) throw new Error('用法：node arms.mjs <平面根> [--arm NAME] [--reset NAME]')
const ONLY = process.argv.slice(3).find((a) => a.startsWith('--arm='))?.slice(6)
const RESET = process.argv.slice(3).find((a) => a.startsWith('--reset='))?.slice(8)

/** 判据宇宙：三道新判据 + 两条已有的无面童线。任何一臂在这个宇宙之外的红都不算，但在里面的多红要报 */
const TESTS = [
  'tests/unit/dialogue-fields.test.ts',
  'tests/unit/dialogue.test.ts',
  'tests/flow/faceless-lost.test.ts',
  'tests/flow/faceless-vessel.test.ts',
  'tests/flow/bells.test.ts',
]

const eolOf = (text) => {
  const lf = text.split('\n').length - 1
  const crlf = text.split('\r\n').length - 1
  if (lf === crlf) return '\r\n'
  if (crlf === 0) return '\n'
  throw new Error('行尾混合 ⇒ 拒绝手术')
}

/** 文本手术：needle 在 LF 空间里匹配，按文件自己的 EOL 写回 */
const applyEdits = (edits) => {
  const backups = new Map()
  for (const e of edits) {
    const path = resolve(ROOT, e.file)
    const raw = backups.get(path) ?? readFileSync(path, 'utf8')
    backups.set(path, raw)
    const eol = eolOf(raw)
    const text = raw.replace(/\r\n/g, '\n')
    const hits = text.split(e.needle).length - 1
    if (hits !== e.hits) {
      throw new Error(`${e.file}：needle 命中 ${hits} 次（预期 ${e.hits}）⇒ 臂的定义过期，不是代码的洞\n  「${e.needle.split('\n')[0].trim()}」`)
    }
    const next = text.split(e.needle).join(e.fix)
    if (next === text) throw new Error(`${e.file}：needle 与 fix 相同 = 这一臂什么也没改`)
    writeFileSync(path, next.replace(/\n/g, eol))
  }
  return backups
}

const restore = (backups) => {
  for (const [path, raw] of backups) {
    // 顺序必须是"先写回再核字节"：变异体还挂在盘上的时候，「当前 == 快照」永远不成立 ——
    // 我第一版把核对写在写回之前，于是每一臂都死在这里（而且死的时候把变异体留在了平面上）。
    writeFileSync(path, raw)
    const now = readFileSync(path)
    if (!now.equals(Buffer.from(raw, 'utf8'))) throw new Error(`还原后字节不符：${path}\n  现在 ${now.length}B，快照 ${Buffer.byteLength(raw, 'utf8')}B ⇒ 中止，不把脏平面交给下一臂`)
  }
}

/** 跑一次判据宇宙，返回失败用例的 (文件, 标题) 与全体收集到的用例 */
const runGroup = (label) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'ki129-arms-'))
  const out = resolve(dir, 'report.json')
  const r = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', ...TESTS, '--reporter=json', `--outputFile=${out}`], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000,
  })
  if (r.error) throw new Error(`${label}：vitest 起不来 —— ${r.error.message}`)
  const j = JSON.parse(readFileSync(out, 'utf8'))
  rmSync(dir, { recursive: true, force: true })
  const all = []
  const failed = []
  for (const tr of j.testResults) {
    const f = basename(tr.name)
    for (const a of tr.assertionResults ?? []) {
      const key = `${f} :: ${a.title}`
      all.push(key)
      if (a.status === 'failed') failed.push({ key, msg: (a.failureMessages ?? []).join(' ⏎ ').slice(0, 260) })
    }
  }
  if (!Number.isFinite(j.numTotalTests) || j.numTotalTests !== all.length) {
    throw new Error(`${label}：报告里 numTotalTests=${j.numTotalTests} 与收集到的 ${all.length} 条不符 ⇒ 分母不可信`)
  }
  return { exit: r.status, all, failed, passed: j.numPassedTests, total: j.numTotalTests }
}

const D = 'dialogue-fields.test.ts'
const L = 'faceless-lost.test.ts'
const B = 'bells.test.ts'

const ARMS = [
  {
    name: 'BOTH-CELLS',
    why: '把谎旗同时立在「是孩子」那一格（= KI-129 之前的老数据，"挪一半"）',
    edits: [{
      file: 'src/data/json/dialogue.json',
      needle: `              "setFlags": [
                "flag.faceless_answered"
              ],
              "notify": "它在灰上写了一个字，又立刻擦掉 —— 你瞥见那是「谢」"`,
      fix: `              "setFlags": [
                "flag.faceless_answered",
                "flag.faceless_lied"
              ],
              "notify": "它在灰上写了一个字，又立刻擦掉 —— 你瞥见那是「谢」"`,
      hits: 1,
    }],
    expect: [`${D} :: 谎旗与拆穿句同源：立 \`faceless_lied\` 的那一格自己写着「他骗你」，「是孩子。」那一格不许立它`,
      `${D} :: \`flag.faceless_lied\` 全库一个写方、一个读方，读方就是《同一个音符》那道门`,
      `${L} :: 说实话（是孩子）不立谎旗——失败分支不误伤诚实的人`,
      `${B} :: 无面童线步 2 的诚实路：答案不同、后果不同（同样的"这一步走完"）`],
  },
  {
    name: 'EAR-FLAG-DROPPED',
    why: '撒谎那一格不再立「是耳朵」旗 ⇒ n6（拆穿过场）的门永远不开，LOST 那条链失去入口',
    edits: [{
      file: 'src/data/json/dialogue.json',
      needle: `              "setFlags": [
                "flag.faceless_answered",
                "flag.faceless_lied",
                "flag.faceless_told_it_is_an_ear"
              ],`,
      fix: `              "setFlags": [
                "flag.faceless_answered",
                "flag.faceless_lied"
              ],`,
      hits: 1,
    }],
    expect: [`${L} :: 「是耳朵」是谎：它当场写「他骗你」，旗立、任务照常推进到步 2 完成`,
      `${L} :: 撒过谎的复访落进《同一个音符》（n17）；非共谋只有陪伴一条路（还有救）`,
      `${B} :: 无面童线步 2：修过钟之后它才问得出那句话 —— 撒谎不是免费的（§2.5 步 2）`],
  },
  {
    name: 'NO-READER',
    why: '拆掉 n17 那道门的谎旗前提 ⇒ 任何人都能撞进《同一个音符》（把"挪一半"的另一半造出来）',
    edits: [{
      file: 'src/data/json/dialogue.json',
      needle: `            "all": [
              "flag.faceless_lied"
            ],
            "not": [
              "flag.faceless_clue_ring_complete",`,
      fix: `            "all": [],
            "not": [
              "flag.faceless_clue_ring_complete",`,
      hits: 1,
    }],
    expect: [`${D} :: \`flag.faceless_lied\` 全库一个写方、一个读方，读方就是《同一个音符》那道门`,
      `${L} :: 没撒过谎的复访不落 n17（neutral n15），失败分支不追杀清白玩家`,
      `${B} :: 无面童线步 2 的诚实路：答案不同、后果不同（同样的"这一步走完"）`],
  },
  {
    name: 'STRAY-KEY',
    why: '在某个选项的顶层再写一行没人读的 `notify`（KI-127 被骗的那种形状）',
    edits: [{
      file: 'src/data/json/dialogue.json',
      needle: `              "notify": "它没有写任何字。你听见空气里有一声很轻的笑"
            },
            "next": "n5"`,
      fix: `              "notify": "它没有写任何字。你听见空气里有一声很轻的笑"
            },
            "next": "n5",
            "notify": "（臂 STRAY-KEY：顶层的、schema 没声明的一句话）"`,
      hits: 1,
    }],
    expect: [`${D} :: 每一层的每一个键都是声明过的；实测越界的整库只有一处，就在 n4·c1 那一格`],
  },
  {
    name: 'PROSE-DIVERGES',
    why: '旗留在撒谎那一格，但把拆穿句改掉 ⇒ 旗与散文各说一套（同源判据要抓的就是这个）',
    edits: [{
      file: 'src/data/json/dialogue.json',
      needle: `"notify": "它当场在灰上写下两个字：他骗你。然后它自己擦了"`,
      fix: `"notify": "它当场在灰上写下两个字：他瞒你。然后它自己擦了"`,
      hits: 1,
    }],
    expect: [`${D} :: 谎旗与拆穿句同源：立 \`faceless_lied\` 的那一格自己写着「他骗你」，「是孩子。」那一格不许立它`],
  },
  {
    name: 'DEAD-FIELD-FIRED',
    why: '把探针的 `effects.notify` 拆掉 ⇒ 行为腿唯一该听见的那句没了（判据不能只靠"文本里没人读"）',
    edits: [{
      file: 'tests/unit/dialogue-fields.test.ts',
      needle: `          effects: { notify: '这句来自 effects —— 声明过的通道' },
`,
      fix: `          // 臂 DEAD-FIELD-FIRED：声明过的通道也不再播
`,
      hits: 1,
    }],
    expect: [`${D} :: 行为腿：选项顶层的 \`notify\` 真的一句也不响，玩家听见的那句来自 \`effects.notify\``],
  },
]

const log = []
const say = (line) => { log.push(line); console.log(line) }

// 崩溃恢复：上一臂如果死在还原之前（我第一次就死在 `Buffer#equals` 吃字符串上），平面上会留着变异体。
// 先把那一臂原样倒回去，再谈基线 —— 否则"基线全绿"这句读的是变异体，后面每一臂的红集都失去依据。
if (RESET) {
  const arm = ARMS.find((a) => a.name === RESET)
  if (!arm) throw new Error(`--reset=${RESET} 名册里没有这一臂`)
  applyEdits(arm.edits.map((e) => ({ ...e, needle: e.fix, fix: e.needle })))
  console.log(`RESET ${RESET}: ${arm.edits.map((e) => e.file).join(' ｜ ')} 已倒回`)
  process.exit(0)
}

// —— 基线：平面必须先"静"（at rest）且全绿，否则后面每一臂的红集都没有依据
const base = runGroup('BASELINE')
say(`BASELINE: ${base.passed}/${base.total} passed, ${base.failed.length} failed, exit=${base.exit}`)
if (base.failed.length !== 0) {
  for (const f of base.failed) say(`  红在基线：${f.key}\n    ${f.msg}`)
  throw new Error('基线不绿 ⇒ 先修平面上的并发写入，再谈臂')
}

const chosen = ONLY ? ARMS.filter((a) => a.name === ONLY) : ARMS
if (chosen.length === 0) throw new Error(`--arm=${ONLY} 名册里没有这一臂：${ARMS.map((a) => a.name).join('/')}`)

let bad = 0
for (const arm of chosen) {
  const ids = arm.expect.map((want) => {
    const hits = base.all.filter((k) => k === want)
    if (hits.length !== 1) throw new Error(`${arm.name}：期望「${want}」在基线收集里命中 ${hits.length} 条（必须恰好 1）⇒ 标题过期`)
    return hits[0]
  })
  const backups = applyEdits(arm.edits)
  let res
  try {
    res = runGroup(arm.name)
  } finally {
    restore(backups)
  }
  const got = res.failed.map((f) => f.key)
  const missed = ids.filter((k) => !got.includes(k))
  const extra = got.filter((k) => !ids.includes(k))
  const match = missed.length === 0 && extra.length === 0
  if (!match) bad++
  say(`ARM ${arm.name}: ${got.length} red ${match ? 'MATCHED' : 'MISMATCH'} —— ${arm.why}`)
  if (res.exit === 0) say('  ⚠️ 退出码却是 0：红了却报绿，跑测器自己的判据有问题')
  for (const k of missed) say(`  漏红（这一格没人守着 = 判据有洞）：${k}`)
  for (const k of extra) {
    const m = res.failed.find((f) => f.key === k)
    say(`  多红（这个语义量还有我没点名的读者）：${k}\n    ${m?.msg ?? ''}`)
  }
}

say(`VERDICT: ${chosen.length - bad}/${chosen.length} arms MATCHED，判据宇宙 ${base.total} 条用例`)
// 日志写到系统 tmp，不落进任何 git 平面：平面上多一个未跟踪文件会被"根上点文件形状普查"那道门算进去
const LOG = resolve(tmpdir(), 'ki129-arms.log')
writeFileSync(LOG, log.join('\n') + '\n', 'utf8')
say(`（完整日志：${LOG}）`)
if (bad !== 0) throw new Error(`${bad} 臂与预期不符 ⇒ 看上面的漏红/多红清单`)
