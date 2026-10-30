/**
 * scripts/condition-rules.mjs — 条件语言（`flag.x` / `!flag.x` / `state.K==V` / `state.K!=V`，`&&` 连接）
 * 的**读方名册**判据本体（KI-341）。
 *
 * 为什么不住在 `validate-data.mjs` 里：与 `ambience-rules.mjs`／`battle-rules.mjs` 同一个理由——
 * 那个文件一被 import 就去校验真表并 `process.exit`，于是"喂一串坏条件、看它拒不拒"这一半在测试里做不了。
 *
 * 为什么只有**一份**读法：条件语言今天有两个数据宿主（`regions.json > spawnGroups[].condition`
 * 与 `regions.json > music.ambienceVariants[].condition`），而运行时只有一台机器
 * （`src/world/SpawnDirector.ts > evalCondition`）。判据侧每多抄一台小机器，就多一个"改了那边忘了这边"
 * 的缝；这一份是门禁那一侧的唯一主人。
 *
 * **它读的是形状，不是语义**：哪个 `state.KEY` 认识、取值合不合法，由调用方拿着 `states.json` 判——
 * 那属于"跨表对账"，不在语法这一层。
 */

/** `state.K==V` / `state.K!=V` 那一形（与 `SpawnDirector.evalCondition` 里的那条同形，两处改一处就必须两处改） */
export const STATE_TERM_RE = /^(state\.[A-Za-z0-9_.]+)(==|!=)(.+)$/

/**
 * 一串条件 ⇒ 三个桶。
 *
 * - `flags`：旗标读方（`{ name, negated }`）——`name` 是**整个项去掉 `!` 之后的那一段**，
 *   也就是 `evalCondition` 交给 `has(key)` 的那个键。取它进旗标双向对账，拼错的旗名才有写方/读方可查。
 * - `states`：状态读方（`{ key, op, value }`）。
 * - `bad`：形状不合法的项（`{ term, why }`）。运行时对这些的读法是"该项为假"（宁可少刷，不可刷错），
 *   而**恒假与恒真都是死数据**，所以门禁一侧必须点名。
 */
export function readCondition(expr) {
  const flags = []
  const states = []
  const bad = []
  if (typeof expr !== 'string') return { flags, states, bad }
  for (const raw of expr.split('&&')) {
    const term = raw.trim()
    if (term === '') continue
    if (term.startsWith('state.')) {
      const m = STATE_TERM_RE.exec(term)
      if (m) states.push({ key: m[1], op: m[2], value: m[3], term })
      else bad.push({ term, why: '状态两形是 state.KEY==VALUE / state.KEY!=VALUE' })
      continue
    }
    const negated = term.startsWith('!')
    const name = negated ? term.slice(1).trim() : term
    if (!name) { bad.push({ term, why: '旗标取反那一形是 !flag.x，! 后面没有旗名' }); continue }
    // `!state.K==V`：`evalCondition` 先看 `state.` 前缀，带 `!` 的那一串走的是**旗标**分支——
    // 它问出口的键是整串 `'state.K==V'`，而旗名册里不可能有那一格，所以读成**恒假**。
    // 更糟的是普查：那一串既不是状态读方也不是合法旗名 ⇒ 这一项在双向对账里彻底隐形。
    // 测试把两种读数都量了（旗名命中时读假、不命中时读真），见 tests/unit/condition-rules.test.ts。
    if (name.startsWith('state.')) { bad.push({ term, why: '取反只认旗标：!state.… 会被读成"问一面名字叫 state.K==V 的旗"⇒ 恒假，且这一项在旗/状态普查里都隐形' }); continue }
    flags.push({ name, negated, term })
  }
  return { flags, states, bad }
}

/** 一串条件里所有旗标的**读方**（只要名字，给旗标双向对账登记用） */
export function conditionFlagNames(expr) {
  return readCondition(expr).flags.map((f) => f.name)
}

/**
 * 一份 `regions.json` ⇒ 条件语言问出口的**读方名册**两张：`{ flags, states }`（KI-342）。
 *
 * 为什么这一族「走到哪一格」的遍历也搬进来（KI-341 账本「没做①」的那一格）：住在 `validate-data.mjs`
 * 里的那两支循环，门只能数到「外壳与 `conditionFlagNames(` 调用还在」——把往名册里登记那一句挖掉、
 * 外壳原样留着，门是绿的而普查当场又瞎了（`.scratch/ki342_probe.mjs` 2026-10-29 实测：植入一株幻影旗，
 * 芯在 ⇒ 1 条 ERROR 点名它；去芯 ⇒ **0 ERROR 且门 17 条全绿**）。芯搬进这里之后，它第一次能被喂合成陈设
 * 量内容对不对；校验器那一侧只剩下一次调用与一次并入，而那两格都有名字可钉。
 *
 * 登记的**次序口径**由调用方决定（这里只出名册）：每张名册内部「第一次读到它的那一格」赢，
 * 与校验器那两张大 Map 并的时候同样是不覆盖已有条目 —— 名册值就是那句 `where`，两条宿主共用一个形状。
 */
export function conditionReadsOf(regions) {
  const flags = new Map()
  const states = new Map()
  for (const rg of Array.isArray(regions) ? regions : []) {
    if (!rg || typeof rg !== 'object') continue
    /** 这一区里每一个挂着条件的宿主：`[名册值那一段, 表达式]` */
    const hosts = []
    for (const g of Array.isArray(rg.spawnGroups) ? rg.spawnGroups : []) {
      if (g && typeof g === 'object' && typeof g.condition === 'string')
        hosts.push([`spawnGroups(${g.enemyId}).condition`, g.condition])
    }
    for (const v of Array.isArray(rg.music?.ambienceVariants) ? rg.music.ambienceVariants : []) {
      if (v && typeof v === 'object' && typeof v.condition === 'string')
        hosts.push([`music.ambienceVariants(${v.suffix}).condition`, v.condition])
    }
    for (const [cell, expr] of hosts) {
      const where = `${rg.id}.${cell} '${expr}'`
      for (const f of readCondition(expr).flags) if (!flags.has(f.name)) flags.set(f.name, where)
      for (const s of readCondition(expr).states) if (!states.has(s.key)) states.set(s.key, where)
    }
  }
  return { flags, states }
}

/**
 * 把一份名册**并**进普查那一张 Map：那张 Map 里已有的条目赢（别的宿主先登记过就用先那句 `where`）。
 * 返回真正加进去的格数 —— 那是「这一族对这份普查贡献了几格」的读数，不是装饰。
 */
export function mergeConditionReads(target, roster) {
  let added = 0
  for (const [key, where] of roster instanceof Map ? roster : []) {
    if (target.has(key)) continue
    target.set(key, where)
    added++
  }
  return added
}
