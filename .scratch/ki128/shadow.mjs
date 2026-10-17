/**
 * KI-128 普查：把 `src/quest/Dialogue.ts` + `src/quest/Settlement.ts` 的落点语义在进程外复刻一份，
 * 然后问两张表三层问题——
 * ① 哪些带条件的格子在任何赋值下都**当不上落点**（那一句台词玩家永远读不到，KI-089 那一族的推广）；
 * ② 在同一个赋值里，谁把谁挡在了同一条跳链的下游（遮蔽对，KI-127 那条「n17 抢 n7」的形状）；
 * ③ 抢得着的那些，是**编排**还是**缺陷**？两把尺子各裁一刀：
 *    写方名册（`ungrounded`）先问这个赋值这份数据到底立不立得起来 —— 立不起来的赋值是量具伪影，不是内容锁；
 *    会话闭包（`closure`）再问玩家把上游那一格答完之后，下一口谈能不能读到下游那一格 —— 答得开的是顺序性遮蔽。
 *   两把尺子都放行，才落到「内容锁死」。
 *
 * 判据不是"我觉得语义对不对"，而是量具量出来的两条真引擎读数（`tests/flow/ki128-probe.test.ts` 于干净平面实跑 2/2 绿）：
 * - **选项效果在跨进目标格之前就已写进世界**（`Dialogue.ts:158` 先 `sink?.(e)` 再走链，`Settlement.ts:97` 的 sink 同步落盘）。
 *   漏掉这一条就会把 `n6 / n15 / n16` 三格可达台词误报成死格 —— 这份复刻件的第一版正是这样错的，自检把它揪出来了。
 * - 旗标落地后 `Quests` 当回合顺推（`onFlag` → `settle` 的顺序补判），所以「选项立一面旗 ⇒ 目标格读到的已经是下一步」。
 *
 * 维度：旗标（穷举子集）、任务步（穷举 `quests.json` 里那条线的 steps 顺序 + 未开始）、世界状态（穷举该树
 * 条件里出现过的取值）。`relation` 与 `hasItem` 两束（全库共 3 处，都在选项上、没有一个在格子上）不参与赋值，
 * 一律按"可满足"乐观算：于是①"从未当上落点"是**下界**（真死了才报得出来，不会冤枉），
 * ②的遮蔽对里可能掺入只有把 `hasItem` 也算满足才成立的那些，所以乐观读的槽数原样印出来供核对。
 * `once` 一律按"这一趟还没读过"算（那一格因此算得能落），落点集合同样是放宽后的上界。
 *
 * 自检先行，18 条已知读数必须被这份复刻件逐条复现，任何一条对不上就整份作废：
 * 主干 6（4 条复访落点 + 2 条真引擎量具）、过滤 2（不可能世界必须拒、现实世界必须收）、归因 3（MEG 一跳解 ／
 * HALTRUNE 同一趟的第二跳解 ／ FACELESS 答到底也解不开）、
 * 写方 4（两端各咬两次：真赋值一条判无据、一条判有据，再加两条桩 —— 一面全数据没写方的旗、一面无条件立起的旗）、种桩 3（自相矛盾那格判死、
 * 另有正门那格不许见条件就判死、遮蔽对要抓到）。种桩那棵合成树只考判据，不进总读数。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const ROOT = 'D:/法环游戏'
const show = (rel) => JSON.parse(execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8'))
const trees = (() => { const d = show('src/data/json/dialogue.json'); return Array.isArray(d) ? d : Object.values(d) })()
const questDefs = new Map(show('src/data/json/quests.json').map((q) => [q.id, q]))
const rawRegions = execFileSync('git', ['show', 'HEAD:src/data/json/regions.json'], { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8')
const stepsOf = (id) => questDefs.get(id)?.steps ?? []
const stateOf = (id) => stepsOf(id).map((s) => s.state)

let unassessed = 0

/** 条件求值（参与赋值的三束：flags / quest / state；relation 与 hasItem 见文件头的乐观约定） */
function condPass(c, A) {
  if (!c) return true
  if (c.relation || c.hasItem) unassessed++
  if (c.flags) {
    const all = c.flags.all ?? [], any = c.flags.any ?? [], not = c.flags.not ?? []
    if (!all.every((f) => A.flags.has(f))) return false
    if (any.length > 0 && !any.some((f) => A.flags.has(f))) return false
    if (not.some((f) => A.flags.has(f))) return false
  }
  if (c.quest) {
    const st = A.quest.get(c.quest.id) ?? null
    if (c.quest.in && (st === null || !c.quest.in.includes(st))) return false
    if (c.quest.gte) {
      const want = stateOf(c.quest.id).indexOf(c.quest.gte)
      const cur = st === null ? -1 : stateOf(c.quest.id).indexOf(st)
      if (want < 0 || cur < want) return false
    }
  }
  if (c.state) {
    const v = A.state.get(c.state.key)
    if (c.state.eq !== undefined && v !== c.state.eq) return false
    if (c.state.in && !c.state.in.includes(v)) return false
    if (c.state.notIn && c.state.notIn.includes(v)) return false
  }
  return true
}

/* ---------------- 效果结算（复刻 `Settlement.applyEffects` + `Quests` 顺推） ---------------- */

/** 落步并顺序补判：这一步的 advanceOn.flags 里有旗已经立着 ⇒ 继续往前（末步 = 收束，状态停在末步） */
function settle(A, id, i) {
  const st = stepsOf(id)
  for (let guard = 0; guard <= st.length; guard++) {
    A.quest.set(id, st[i].state)
    const flags = st[i].advanceOn?.flags ?? []
    if (!flags.some((f) => A.flags.has(f))) return
    if (i < st.length - 1) { i++; continue }
    return
  }
}

function onFlag(A, key) {
  for (const [id, cur] of [...A.quest]) {
    const st = stateOf(id)
    const idx = st.indexOf(cur)
    if (idx < 0) continue
    if (!stepsOf(id)[idx].advanceOn?.flags?.includes(key)) continue
    if (idx < st.length - 1) settle(A, id, idx + 1)
  }
}

function onState(A, key, value) {
  for (const [id, cur] of [...A.quest]) {
    const st = stateOf(id)
    const idx = st.indexOf(cur)
    if (idx < 0) continue
    const gate = stepsOf(id)[idx].advanceOn?.state
    if (!gate || gate.key !== key || !gate.in.includes(value)) continue
    if (idx < st.length - 1) settle(A, id, idx + 1)
  }
}

/** 结算顺序是语义不是风格：先建/推任务，再写旗，再写值域（见 `Settlement.ts:118` 那段注释） */
function applyEff(A, e) {
  if (!e) return
  if (e.startQuest && !A.quest.has(e.startQuest)) { A.quest.set(e.startQuest, null); settle(A, e.startQuest, 0) }
  if (e.advanceQuest) {
    const id = e.advanceQuest.id, to = e.advanceQuest.to
    const st = stateOf(id), cur = st.indexOf(A.quest.get(id) ?? null)
    if (to && st.includes(to)) { const idx = st.indexOf(to); if (idx > cur) settle(A, id, idx) }
    else if (cur >= 0 && cur < st.length - 1) settle(A, id, cur + 1)
  }
  for (const f of e.setFlags ?? []) { A.flags.add(f); onFlag(A, f) }
  for (const f of e.clearFlags ?? []) A.flags.delete(f)
  if (e.setState) { A.state.set(e.setState.key, e.setState.value); onState(A, e.setState.key, e.setState.value) }
}

const cloneA = (A) => ({ flags: new Set(A.flags), quest: new Map(A.quest), state: new Map(A.state) })

/* ---------------- 会话推进（复刻 `enter()` 的跳链与 `choose()` 的先结算） ---------------- */

/** 从 entryId 走一条跳链；carried 是刚选的那个选项的效果（跨边界那一刻先落地） */
function walk(tree, A0, entryId, carried) {
  const A = cloneA(A0)
  const ids = []
  if (entryId == null) return { A, ids, land: null }
  for (const e of [carried]) applyEff(A, e)
  let id = entryId
  for (let guard = 0; id && guard < 64; guard++) {
    const node = tree.nodes.find((n) => n.id === id)
    if (!node) return { A, ids, land: null }
    ids.push(node.id)
    if (node.conditions && !condPass(node.conditions, A)) { id = node.next ?? null; continue }
    applyEff(A, node.effects) // onEnter 先结算，再求值这一格的选项（`Dialogue.ts:165`）
    return { A, ids, land: node.id }
  }
  return { A, ids, land: null }
}

/** 一趟会话能开的所有口：进门（含 fallback）+ 每个**真的落得上**的格子往下（可见选项的 next 与按一下继续的 next） */
function sessions(tree, A0) {
  const out = []
  const seen = new Set()
  const queue = [{ A: A0, entry: entryOf(tree, A0), carried: null, from: null }]
  for (let guard = 0; guard < 4096 && queue.length; guard++) {
    const q = queue.shift()
    const r = walk(tree, q.A, q.entry, q.carried)
    if (!r.land) continue
    out.push(r)
    const key = `${r.land}|${[...r.A.flags].sort().join(',')}|${[...r.A.quest].sort().join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    const node = tree.nodes.find((n) => n.id === r.land)
    const visible = (node.choices ?? []).filter((c) => condPass(c.conditions, r.A))
    if (visible.length === 0) {
      if (node.next) queue.push({ A: r.A, entry: node.next, carried: null, from: r.land })
      continue
    }
    for (const c of visible) if (c.next) queue.push({ A: r.A, entry: c.next, carried: c.effects, from: r.land })
  }
  return out
}

function entryOf(tree, A) {
  const root = tree.nodes.find((n) => n.id === tree.rootNode)
  return root && !condPass(root.conditions, A) && tree.fallbackNode ? tree.fallbackNode : tree.rootNode
}

/* ---------------- 自检：主干六条已知读数 ---------------- */

const F = (names) => new Set(names)
const Q = (pairs) => new Map(pairs)
const faceless = trees.find((t) => t.id === 'DLG_FACELESS')
const belltongue = trees.find((t) => t.id === 'DLG_BELLTONGUE')
const cases = [
  { tree: faceless, name: '诚实路复访（bells:305 实测 n17）', A: { flags: F(['flag.faceless_met', 'flag.faceless_answered', 'flag.faceless_lied']), quest: Q([['q_faceless', 'FACELESS.STEP3_VESSEL']]), state: new Map() }, want: 'n17' },
  { tree: faceless, name: '撒谎路复访（bells:282 实测 n6）', A: { flags: F(['flag.faceless_met', 'flag.faceless_answered', 'flag.faceless_told_it_is_an_ear']), quest: Q([['q_faceless', 'FACELESS.STEP3_VESSEL']]), state: new Map() }, want: 'n6' },
  { tree: faceless, name: '质问出现（faceless-lost:78 实测 n4）', A: { flags: F(['flag.faceless_met', 'flag.bell_first_repaired']), quest: Q([['q_faceless', 'FACELESS.STEP2_ANSWER']]), state: new Map() }, want: 'n4' },
  { tree: faceless, name: '还没修钟的复访（bells:262 实测 n15）', A: { flags: F(['flag.faceless_met']), quest: Q([['q_faceless', 'FACELESS.STEP2_ANSWER']]), state: new Map() }, want: 'n15' },
  // 下面两条来自真引擎量具（干净平面 ki128-probe 2/2 绿）：它们考的是"先结算再求值"那一条腿
  { tree: belltongue, name: '交钟舌那一下落在 n6（量具第一条）', A: { flags: F(['flag.belltongue_met']), quest: Q([['q_bells', 'BELLS.STEP1_OPEN']]), state: new Map() }, entry: 'n6', want: 'n6', carried: { setFlags: ['flag.bell_tongue_examined'] } },
  { tree: belltongue, name: '熔钟那一格在同一回合读到 n15（量具第二条）', A: { flags: F(['flag.belltongue_met']), quest: Q([['q_bells', 'BELLS.STEP4_DECIDE']]), state: new Map([['state.bells.fourth_dumb', 'INTACT']]) }, entry: 'n15', want: 'n15', carried: { setState: { key: 'state.bells.fourth_dumb', value: 'MELTED' } } },
]
const self = cases.map((c) => ({ ...c, got: walk(c.tree, c.A, c.entry ?? entryOf(c.tree, c.A), c.carried ?? null).land }))
for (const r of self) console.log(`自检 ${r.name}：期望 ${r.want} 实得 ${r.got ?? '(无落点)'} ${r.got === r.want ? 'ok' : 'MISMATCH'}`)
if (!self.every((r) => r.got === r.want)) {
  console.log('SELFTEST FAILED ⇒ 这份复刻件不配做普查，整份作废')
  process.exit(1)
}

/** 赋值过滤器自己的两条：一条不可能世界必须拒，一条现实世界必须收 */
const filters = [
  { name: '第二块拼图的旗已立而任务还停在 STEP2（`Quests.settle` 不可能停在这儿）', A: { flags: F(['flag.meg_met', 'flag.meg_first_fragment', 'flag.meg_second_fragment']), quest: Q([['q_meg', 'MEG.STEP2_EXCHANGE']]), state: new Map() }, want: false },
  { name: '两块拼图都交完、任务走到 STEP3（这就是玩家真的会站到的世界）', A: { flags: F(['flag.meg_met', 'flag.meg_first_fragment', 'flag.meg_second_fragment']), quest: Q([['q_meg', 'MEG.STEP3_EXTRACT']]), state: new Map() }, want: true },
]
for (const f of filters) console.log(`过滤 ${f.name}：期望 ${f.want} 实得 ${consistent(f.A)} ${consistent(f.A) === f.want ? 'ok' : 'MISMATCH'}`)
if (!filters.every((f) => consistent(f.A) === f.want)) {
  console.log('FILTER FAILED ⇒ 这道过滤器不配收窄赋值空间，整份作废')
  process.exit(1)
}

/* ---------------- 赋值穷举 ---------------- */

function assignments(tree) {
  const conds = [...tree.nodes, ...tree.nodes.flatMap((n) => n.choices ?? [])].map((o) => o.conditions).filter(Boolean)
  const flags = [...new Set(conds.flatMap((c) => [...(c.flags?.all ?? []), ...(c.flags?.any ?? []), ...(c.flags?.not ?? [])]))]
  const questIds = [...new Set(conds.map((c) => c.quest?.id).filter(Boolean))]
  const stateKeys = [...new Set(conds.map((c) => c.state?.key).filter(Boolean))]
  // 任务机自己读的旗与值域也要进名册：`flag.faceless_first_writing` 这种旗在本树的台词里一个字都没提，
  // 但它立在着与否决定了「任务能不能走到第二步」——漏了它，过滤器会把现实世界全拒掉（第一版就这样把 n4 误判成死格）。
  for (const id of questIds) for (const s of stepsOf(id)) {
    for (const f of s.advanceOn?.flags ?? []) if (!flags.includes(f)) flags.push(f)
    const gate = s.advanceOn?.state
    if (gate && !stateKeys.includes(gate.key)) stateKeys.push(gate.key)
  }
  const stateVals = new Map(stateKeys.map((k) => [k, [...new Set([
    undefined,
    ...conds.filter((c) => c.state?.key === k).flatMap((c) => [c.state.eq, ...(c.state.in ?? []), ...(c.state.notIn ?? [])]),
    ...questIds.flatMap((id) => stepsOf(id)).map((s) => s.advanceOn?.state).filter((g) => g?.key === k).flatMap((g) => g.in),
  ])]]))
  const cart = (base, pairs) => pairs.reduce((acc, [k, vs]) => acc.flatMap((b) => vs.map((v) => [...b, [k, v]])), base)
  const qList = cart([[]], questIds.map((id) => [id, [null, ...stateOf(id)]]))
  const sList = cart([[]], stateKeys.map((k) => [k, stateVals.get(k)]))
  const list = []
  for (let m = 0; m < 2 ** flags.length; m++) {
    const fs = new Set(flags.filter((_, i) => m & (1 << i)))
    for (const q of qList) for (const s of sList) list.push({ flags: fs, quest: new Map(q), state: new Map(s) })
  }
  return { list, flags, questIds, stateKeys }
}

/**
 * 这一步的推进条件是否**已经**满足（`Quests.settle` 的顺序补判用的就是这一句）。
 */
function stepSatisfied(step, A) {
  const flags = step.advanceOn?.flags ?? []
  if (flags.some((f) => A.flags.has(f))) return true
  const gate = step.advanceOn?.state
  if (gate && gate.in.includes(A.state.get(gate.key))) return true
  return false
}

/**
 * 这组赋值是不是**任务机走得进去**的世界。判据来自 `Quests` 自己的规矩：
 * 每一步落地时都会顺序补判（`settle`），所以「第 j 步的推进旗还没立」与「当前步却已经站在 j 之后」不能同时成立，
 * 「当前这一步的推进条件已经满足」也不会停留（末步除外——末步命中是收束，状态就停在末步）。
 * 不加这一道过滤，普查会把「meg_second_fragment 已立但任务还在 STEP2」这类**不可能世界**当成证据（第一版就这样误报了 2 组锁死）。
 */
function consistent(A) {
  for (const [id, st] of A.quest) {
    if (!st) continue
    const steps = stepsOf(id)
    if (!steps.length) continue
    const idx = steps.findIndex((s) => s.state === st)
    if (idx < 0) return false
    for (let j = 0; j < idx; j++) if (!stepSatisfied(steps[j], A)) return false
    if (idx < steps.length - 1 && stepSatisfied(steps[idx], A)) return false
  }
  return true
}

const keyOf = (A) => `${[...A.flags].sort().join(',')}|${[...A.quest].sort().join(',')}|${[...A.state].sort().join(',')}`

/**
 * 这格遮蔽**玩家自己答得开吗**：从锁死的那个赋值出发，只走这条对话里看得见的选项。
 * 一趟会话能到的每个世界都算一步（`sessions` 的 `r.A` 已经把「选这个项所立的那面旗 / 所写的那个值」
 * 落在跨边界那一刻结算过了 —— 见 `Dialogue.ts:158` 与 `Settlement.ts:97`），所以两步以外的解法
 * 也在这张图里：铃姨线之外那条「n5·c2 → 到 n6 → 在 n6 定性营地」正是**同一趟**里的第二跳，
 * 第一版只把「脚下这一格的选项效果」当后继，把这种两跳解法看漏了，于是把顺序性遮蔽误报成锁死。
 *
 * 只有闭包走满还落不上的那一格才是**内容锁死**；能答开的那些是**顺序性遮蔽**（台词排在另一格之后，
 * 属于编排而不是缺陷），必须分开报，否则普查会把 KI-127 那一格和一堆正常排队的话混成一锅。
 * 深度上限 6：世界侧的写方（交互物 / 区域）不在这里模拟，所以 `ok:false` 的含义是
 * 「只靠这条对话解不开」，不是「宇宙里读不到」。
 */
function closure(tree, A0, dn, maxDepth = 6) {
  const seen = new Set([keyOf(A0)])
  let frontier = [{ A: A0, path: [] }]
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = []
    for (const cur of frontier) {
      for (const s of sessions(tree, cur.A)) {
        const A2 = s.A
        if (seen.has(keyOf(A2))) continue
        seen.add(keyOf(A2))
        const path = [...cur.path, s.land]
        if (sessions(tree, A2).some((x) => x.land === dn)) return { ok: true, path, depth, size: seen.size }
        next.push({ A: A2, path })
      }
    }
    frontier = next
  }
  return { ok: false, path: null, depth: null, size: seen.size }
}

/* ---------------- 写方名册（只用于归因，不用于收窄穷举） ---------------- */

/**
 * 锁死那一条要能说清「这个赋值到底由谁立起来的」，否则普查会把**数据自己造不出来的世界**
 * 当成内容锁死报出去（HALTRUNE 那一组第一版就这样：它把 `flag.haltrune_farewell_open` 当成前提，
 * 而这面旗的唯一写方是 n10·c3，闸门要任务 `gte STEP3_LASTWATCH` —— 任务机单调，
 * 已经停在 STEP2 的世界不可能曾经走到过 STEP3）。
 *
 * 三面写方名册：本数据里所有对话树（选项效果 + onEnter，各带自己的闸门）、`regions.json` 的 `setsFlag`
 * （世界侧，先后不归对话管）、`src` 下 `.ts` 里出现的旗名（代码侧裁判，如 `PatrolWatch` 的巡逻判据）。
 * 后两面一律**宽松放过**：普查只读对话的编排，代码与关卡侧的顺序不在它的能力范围内。
 */
const dlgWriters = (() => {
  const m = new Map()
  const push = (f, gate, at) => { const l = m.get(f) ?? []; l.push({ gate, at }); m.set(f, l) }
  for (const t of trees) for (const n of t.nodes) {
    for (const f of n.effects?.setFlags ?? []) push(f, n.conditions, `${t.id}/${n.id} 进场`)
    for (const c of n.choices ?? []) for (const f of c.effects?.setFlags ?? []) push(f, c.conditions, `${t.id}/${n.id}·${c.id}`)
  }
  return m
})()
const worldFlags = new Set((rawRegions.match(/"setsFlag":\s*"([^"]+)"/g) ?? []).map((s) => s.split('"')[3]))
// 名册只认 `.ts` 里的旗名：路径写宽一寸（`src` 而不是 `src/*.ts`）就把 `dialogue.json` 自己读成"代码侧写方"，
// 于是每一面数据里的旗都算有据，判据从此只会说"有据"——上面那条 HALTRUNE 自检咬住的就是这一寸。
const codeFlags = new Set((execFileSync('git', ['grep', '-o', '-h', '-E', 'flag\\.[A-Za-z0-9_]+', 'HEAD', '--', 'src/*.ts'], { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8').match(/flag\.[A-Za-z0-9_]+/g) ?? []))

/** 这个写方的任务闸门在「单调往前走」的世界里有没有可能成立过 */
function gateEverPasses(gate, A) {
  if (!gate?.quest) return true
  const st = stateOf(gate.quest.id)
  const cur = A.quest.has(gate.quest.id) ? st.indexOf(A.quest.get(gate.quest.id)) : -1
  if (gate.quest.gte) return cur >= st.indexOf(gate.quest.gte)
  if (gate.quest.in) return cur >= Math.min(...gate.quest.in.map((s) => st.indexOf(s)).filter((i) => i >= 0))
  return true
}

/** 这组赋值里哪些旗**这份数据立不起来**（返回空数组 = 这组赋值有据） */
function ungrounded(A) {
  const bad = []
  for (const f of A.flags) {
    if (worldFlags.has(f) || codeFlags.has(f)) continue
    const ws = dlgWriters.get(f) ?? []
    if (ws.length === 0) { bad.push(`${f}＝全数据无写方`); continue }
    if (!ws.some((w) => gateEverPasses(w.gate, A))) bad.push(`${f}＝唯一写方 ${ws.map((w) => `${w.at}（闸门 ${JSON.stringify(w.gate?.quest ?? '无任务闸门')}）`).join('、')}，任务机不倒退`)
  }
  return bad
}

/* ---------------- 普查 ---------------- */

const rows = []
const stepShadow = []

/**
 * 扫一棵树：穷举赋值 → 逐赋值求落点集合 → 记下「谁把谁抢在自己下游」。
 * `collect=false` 时不把遮蔽对交回总账（种桩那棵合成树只考判据，不进读数）。
 */
function scanTree(t, collect) {
  const { list: all, flags, questIds, stateKeys } = assignments(t)
  const list = all.filter(consistent)
  const gated = t.nodes.filter((n) => n.conditions)
  const canLand = new Set()
  const shadow = new Map()
  const landsByA = new Map()
  for (const A of list) {
    const ss = sessions(t, A)
    const set = landsByA.get(keyOf(A)) ?? new Set()
    for (const s of ss) set.add(s.land)
    landsByA.set(keyOf(A), set)
  }
  for (const A of list) {
    for (const s of sessions(t, A)) {
      canLand.add(s.land)
      let id = t.nodes.find((n) => n.id === s.land)?.next ?? null
      for (let g = 0; id && g < 40; g++) {
        const dn = t.nodes.find((n) => n.id === id)
        if (!dn) break
        if (dn.conditions && condPass(dn.conditions, s.A)) {
          const k = `${s.land} 抢 ${dn.id}`
          if (!shadow.has(k)) shadow.set(k, `${k}〔旗 ${[...s.A.flags].map((f) => f.replace(/^flag\./, '')).join('+') || '无'}；${[...s.A.quest].filter(([, v]) => v).map(([i, v]) => `${i}:${v}`).join(' ') || '任务未开始'}；状态 ${[...s.A.state].map(([a, b]) => `${a.replace(/^state\./, '')}=${b ?? '未定'}`).join(' ') || '缺省'}〕`)
          const esc = (() => { const kk = keyOf(s.A); let m = landsByA.get(kk); if (!m) { m = new Set(sessions(t, s.A).map((x) => x.land)); landsByA.set(kk, m) } return m.has(dn.id) })()
          const desc = `${[...s.A.flags].map((f) => f.replace(/^flag\./, '')).join('+') || '无'}｜${[...s.A.quest].filter(([, v]) => v).map(([i, v]) => `${i}:${v}`).join(' ') || '未开始'}｜${[...s.A.state].map(([a, b]) => `${a.replace(/^state\./, '')}=${b ?? '未定'}`).join(' ') || '缺省'}`
          if (dn.conditions.quest?.in && collect) {
            const prev = stepShadow.find((p) => p.tree === t.id && p.land === s.land && p.dn === dn.id)
            if (prev) { prev.escapable ||= esc; prev.locked ||= !esc; if (!esc && !prev.lockDesc) { prev.lockDesc = desc; prev.lockA = cloneA(s.A) } }
            else stepShadow.push({ tree: t.id, land: s.land, dn: dn.id, escapable: esc, locked: !esc, lockDesc: !esc ? desc : '', lockA: !esc ? cloneA(s.A) : null, dnQuest: `${dn.conditions.quest.id}:${dn.conditions.quest.in.join('/')}`, landCond: JSON.stringify(t.nodes.find((n) => n.id === s.land)?.conditions), dnCond: JSON.stringify(dn.conditions), A: desc })
          }
        }
        id = dn.next ?? null
      }
    }
  }
  const dead = gated.filter((n) => !canLand.has(n.id))
  return { all, list, flags, questIds, stateKeys, gated, canLand, shadow, dead }
}

for (const t of trees) {
  const r = scanTree(t, true)
  rows.push({ tree: t.id, npc: t.npc, dims: `旗${r.flags.length}/任务${r.questIds.length}/状态${r.stateKeys.length}`, assignments: r.list.length, landed: r.canLand.size, gated: r.gated.map((n) => n.id), dead: r.dead.map((n) => n.id), shadows: [...r.shadow.values()] })
  console.log(`\n${t.id} (${t.npc}) 赋值 ${r.all.length} 种 → 任务机走得到的 ${r.list.length} 种 ｜ 带条件 ${r.gated.length} 格 ｜ 能落的 ${r.canLand.size}/${t.nodes.length} 格`)
  console.log(`  当不上任何落点的死格：${r.dead.length ? r.dead.map((n) => n.id).join(' ') : '（无）'}`)
  console.log(`  遮蔽对 ${r.shadow.size} 组：${[...r.shadow.keys()].slice(0, 16).join(' ｜ ') || '（无）'}`)
  for (const line of [...r.shadow.values()].slice(0, 16)) console.log(`     · ${line}`)
}

/**
 * 「死格合计=0」是一句关于**不存在**的断言，所以判据必须先在一棵种出来的树上报得出非零 ——
 * 这棵合成树把两种洞各埋一个：`z2` 的闸门自相矛盾（要任务停在 STEP2，又要那一步的推进旗 `meg_second_fragment`
 * 已经立起 —— `Quests.settle` 的补判不允许这两件事同时成立，任何赋值都当不上落点），
 * `z4` 另有一条正门（z1·c2）所以它自己能落，但 z3 那格带可见选项、`next` 又指向 z4 ⇒ 走 z1·c1 那一口时它被抢在下游。
 * 判据要同时报出这两件事：**只**死 z2、并抓到 z3 抢 z4。第一版桩把 z4 写成只有一条被抢的路，
 * 于是它跟着 z2 一起被判死 —— 那是复刻件按语义正确推出来的连锁（上游死 ⇒ 只从它进的那格也进不去），
 * 桩的错，不是判据的错。
 */
const PLANT = {
  id: 'DLG_KI128_PLANT', npc: 'plant', rootNode: 'z0', fallbackNode: 'z2',
  nodes: [
    { id: 'z0', conditions: { flags: { not: ['flag.meg_met'] } }, choices: [{ id: 'c1', text: '…', next: 'z1' }] },
    { id: 'z1', choices: [{ id: 'c1', text: '…', next: 'z3', effects: { setFlags: ['flag.meg_met'], startQuest: 'q_meg' } }, { id: 'c2', text: '…', next: 'z4', effects: { setFlags: ['flag.meg_met'], startQuest: 'q_meg' } }] },
    { id: 'z2', next: 'z1', conditions: { flags: { all: ['flag.meg_second_fragment'] }, quest: { id: 'q_meg', in: ['MEG.STEP2_EXCHANGE'] } } },
    { id: 'z3', next: 'z4', conditions: { flags: { all: ['flag.meg_met'] } }, choices: [{ id: 'c1', text: '…', next: null }] },
    { id: 'z4', conditions: { flags: { all: ['flag.meg_met'] }, quest: { id: 'q_meg', in: ['MEG.STEP1_OPEN'] } } },
  ],
}
const plant = scanTree(PLANT, false)
const plantChecks = [
  { name: '自相矛盾那格报成死格', got: plant.dead.map((n) => n.id).join('+'), want: 'z2' },
  { name: '另有正门那格照常能落（判据不许见条件就判死）', got: plant.canLand.has('z4'), want: true },
  { name: '遮蔽对抓到 z3 抢 z4', got: plant.shadow.has('z3 抢 z4'), want: true },
]
for (const c of plantChecks) console.log(`桩检 ${c.name}：期望 ${c.want} 实得 ${JSON.stringify(c.got)} ${String(c.got) === String(c.want) ? 'ok' : 'MISMATCH'}`)
if (!plantChecks.every((c) => String(c.got) === String(c.want))) {
  console.log('PLANT FAILED ⇒ 这台判据没在种出来的洞上证明过自己，读数不作数')
  process.exit(1)
}

writeFileSync(`${ROOT}/.scratch/ki128/census.json`, JSON.stringify({ rows, stepShadow: stepShadow.map((p) => ({ ...p, lockA: undefined, clear: closureOf(p) })) }, null, 2))

/**
 * 遮蔽的两级归因：`locked` 只说明「在被抢的那个赋值里，这一格从别的入口也落不上」。
 * 真正决定它是不是缺陷的是第二级 —— **玩家把这一格答完，下一口谈能不能读到它**。
 */
function closureOf(p) {
  if (!p.lockA) return { ok: null, note: '赋值内另有入口（不是锁）' }
  const r = closure(trees.find((t) => t.id === p.tree), p.lockA, p.dn)
  return { ok: r.ok, path: r.path, depth: r.depth, assignments: r.size }
}

// 归因量具自己的三条已知读数：MEG 答一次就解、HALTRUNE 在同一趟里的第二跳解（第一版把这条看漏成锁死）、
// FACELESS 那一格（KI-127）答到底也解不开。
const probeCases = [
  { name: 'MEG：交出声卷后再谈，第二块拼图那格就落得上', tree: trees.find((t) => t.id === 'DLG_MEG'), dn: 'n3', want: true, A: { flags: F(['flag.meg_met', 'flag.meg_first_fragment', 'flag.meg_whisper_extracted']), quest: Q([['q_meg', 'MEG.STEP2_EXCHANGE']]), state: new Map() } },
  { name: 'HALTRUNE：同一趟里走到 n6 定性营地，再谈就落到 n10（两跳解，第一版看漏）', tree: trees.find((t) => t.id === 'DLG_HALTRUNE'), dn: 'n10', want: true, A: { flags: F(['flag.haltrune_met', 'flag.haltrune_patrol_seen']), quest: Q([['q_haltrune', 'HALTRUNE.STEP2_ROSTER']]), state: new Map([['state.haltrune.camp', 'INTACT']]) } },
  { name: 'FACELESS：谎话那条路上 n17 的两种答法都读不到 n7（KI-127 的形状）', tree: faceless, dn: 'n7', want: false, A: { flags: F(['flag.faceless_met', 'flag.faceless_answered', 'flag.faceless_lied', 'flag.faceless_first_writing']), quest: Q([['q_faceless', 'FACELESS.STEP3_VESSEL']]), state: new Map() } },
]
for (const c of probeCases) {
  const r = closure(c.tree, c.A, c.dn)
  console.log(`归因自检 ${c.name}：期望${c.want ? '答得开' : '答不开'} 实得${r.ok ? `第 ${r.depth} 跳解（${r.path.join('→')}）` : `${r.depth ?? '≤6'} 跳、穷举 ${r.size} 个世界仍答不开`} ${r.ok === c.want ? 'ok' : 'MISMATCH'}`)
}
if (!probeCases.every((c) => closure(c.tree, c.A, c.dn).ok === c.want)) {
  console.log('ATTRIBUTION FAILED ⇒ 归因量具不配分「锁死/顺序」这两档，整份作废')
  process.exit(1)
}

/**
 * 写方名册那张嘴自己的四条：一条必须判"无据"（HALTRUNE 的锁死赋值），一条必须判"有据"（FACELESS 的那一条，
 * 它就是 KI-127 的形状，判错就没法把 KI-128 的读数和已登记的那条对上），
 * 再加两条桩证明这张嘴两端都咬得住 —— 只认得"无据"或只认得"有据"的判据都是空转。
 */
const oracleCases = [
  { name: 'HALTRUNE 的锁死赋值：farewell_open 的唯一写方要 gte STEP3，而现在停在 STEP2', A: { flags: F(['flag.haltrune_met', 'flag.haltrune_patrol_seen', 'flag.haltrune_farewell_open']), quest: Q([['q_haltrune', 'HALTRUNE.STEP2_ROSTER']]), state: new Map([['state.haltrune.camp', 'INTACT']]) }, want: true },
  { name: 'FACELESS 的锁死赋值：四面旗都由本树 n1/n4 的选项立起，闸门没有任务腿', A: { flags: F(['flag.faceless_met', 'flag.faceless_answered', 'flag.faceless_lied', 'flag.faceless_first_writing']), quest: Q([['q_faceless', 'FACELESS.STEP3_VESSEL']]), state: new Map() }, want: false },
  { name: '桩：一面全数据无写方的旗（判据不许只会说"有据"）', A: { flags: F(['flag.ki128_no_writer']), quest: new Map(), state: new Map() }, want: true },
  { name: '桩：盐歌声卷那面旗（本树 n7 三个选项无条件写它）', A: { flags: F(['flag.meg_soundscroll_complete']), quest: Q([['q_meg', 'MEG.STEP4_CONVERGE']]), state: new Map() }, want: false },
]
for (const o of oracleCases) {
  const bad = ungrounded(o.A)
  console.log(`写方自检 ${o.name}：期望${o.want ? '判无据' : '判有据'} 实得${bad.length ? `无据（${bad.join('；')}）` : '有据'} ${!!bad.length === o.want ? 'ok' : 'MISMATCH'}`)
}
if (!oracleCases.every((o) => !!ungrounded(o.A).length === o.want)) {
  console.log('WRITER-ORACLE FAILED ⇒ 写方名册不配给锁死归因，整份作废')
  process.exit(1)
}

console.log(`\n带任务步闸门的遮蔽对 ${stepShadow.length} 组（下游那格是某一步的台词）：`)
const kind = (p) => {
  if (!p.locked) return '赋值内另有入口（不是锁）'
  const ug = ungrounded(p.lockA)
  if (ug.length) return { name: '赋值无据（量具伪影）', why: ug.join('；') }
  const c = closureOf(p)
  return c.ok ? { name: `顺序性遮蔽：第 ${c.depth} 跳答开（经 ${c.path.join('→')} 那格落地后的世界）` } : { name: `内容锁死：只靠这条对话答不开（穷举 ${c.assignments} 个有据世界）` }
}
for (const p of stepShadow) {
  const v = kind(p)
  console.log(`  · ${p.tree} ${p.land} 抢 ${p.dn}〔${p.dnQuest}〕 ${v.name ?? v}${v.why ? `：${v.why}` : ''}${p.locked ? `\n      锁死赋值 ${p.lockDesc}\n      上游条件 ${p.landCond}\n      下游条件 ${p.dnCond}` : ''}`)
}
const lockedPairs = stepShadow.filter((p) => p.locked)
const unfounded = (p) => !!p.lockA && ungrounded(p.lockA).length > 0
const realLocks = lockedPairs.filter((p) => !unfounded(p) && !closureOf(p).ok)
const artifacts = lockedPairs.filter(unfounded)
// 按**被抢的那一格**去重：n6 与 n17 是同一个下游的两条上游，报成两笔会把一处锁数成两处。
const lockedNodes = new Map()
for (const p of realLocks) {
  const k = `${p.tree}/${p.dn}`
  const l = lockedNodes.get(k) ?? []
  if (!l.includes(p.land)) l.push(p.land)
  lockedNodes.set(k, l)
}
console.log(`\n内容锁死的台词格 ${lockedNodes.size} 个（抢它的上游 / 该格的台词闸门）：`)
for (const [k, ups] of lockedNodes) {
  const p = realLocks.find((x) => `${x.tree}/${x.dn}` === k)
  console.log(`  · ${k}〔${p.dnQuest}〕← ${ups.join('、')} ｜ 下游条件 ${p.dnCond}`)
}
console.log(`\nCENSUS DONE 自检 ${self.length + filters.length + probeCases.length + oracleCases.length + plantChecks.length}/${self.length + filters.length + probeCases.length + oracleCases.length + plantChecks.length} 复现（主干 ${self.length} ／ 过滤 ${filters.length} ／ 归因 ${probeCases.length} ／ 写方 ${oracleCases.length} ／ 桩 ${plantChecks.length}）｜ 树=${rows.length} ｜ 乐观读的关系/物品槽=${unassessed} ｜ 死格合计=${rows.reduce((n, r) => n + r.dead.length, 0)} ｜ 遮蔽合计=${rows.reduce((n, r) => n + r.shadows.length, 0)} ｜ 带步闸门=${stepShadow.length} ｜ 赋值内另有入口=${stepShadow.length - lockedPairs.length} ｜ 抢得着=${lockedPairs.length}（顺序性 ${lockedPairs.length - realLocks.length - artifacts.length} ／ 赋值无据 ${artifacts.length} ／ 内容锁死对 ${realLocks.length}，按下游去重成 ${lockedNodes.size} 格）${lockedNodes.size ? `：${[...lockedNodes.keys()].join('、')}` : ''}`)
