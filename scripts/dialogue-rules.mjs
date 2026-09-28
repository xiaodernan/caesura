/**
 * scripts/dialogue-rules.mjs — 对话树"读得到的台词"的判据本体（KI-089）
 *
 * 与 `battle-rules.mjs` / `explore-rules.mjs` / `ambience-rules.mjs` / `lockon-rules.mjs` 同一族理由：
 * 判据留在 `validate-data.mjs` 里就没法在测试里喂一棵合成树看它拒不拒（那文件一被 import 就去校验
 * 真表）。搬出来之后校验器只当"把 findings 报成 ERROR 的那张嘴"，门禁与
 * `tests/unit/dialogue-reach.test.ts` 读的是**同一份代码**。
 *
 * 量的是**一句台词有没有玩家读得到**，不是"这段文案写得好不好"。narrative §3.1 把 NPC 的可见节点
 * 定义成 `Filter(树, f(quest.state, relation, flags))`：条件决定"这一刻演哪一段"，**边**决定"这段还
 * 在不在场上"。KI-089 开工时在真表上量到两种形状：
 *   ①**孤儿节点**：没有任何一条边指向它 —— 当时 5 棵树 56 个节点里有 **19** 个（科温 7、无面童 8、
 *     盐歌 4）。写它的人以为它在场上，写判据的人看不见它：校验器原来只从 root/fallback 顺
 *     **第一条**路走到"落点"，走不到也不作声。
 *   ②**没有出口的环**：环上每个节点都没有选项。引擎的 `enter()` 遇条件不成立就往 `next` 退
 *     （`Dialogue.ts`），退到环上就是同一个节点被反复展示 —— 玩家按"继续"永远出不来。
 *     判据只报**结构上必然**的那种环：环里只要有**一个节点带选项**就是玩家自己的抉择（还困着也是
 *     他选的），不算；`once` **不**算出口 —— 读过一次之后引擎跳过它、接着往 `next` 走，落点还是环里，
 *     所以 `once` 拆不掉环（这一条是写这道门时先写错、被 `tests/unit/dialogue-reach.test.ts` 的
 *     `once` 那一格当场抓住的）。条件是"这一刻看不看得到"、不是"通不通"，所以这里不拿条件当出口：
 *     报告说的不是"这个环有点可疑"，而是"这个环一定转不出来"。
 *
 * 两条判据都只看**边**，不看条件成不成立：够不着的节点是"任何状态下都读不到"，比"某个状态下读不到"
 * 强一档 —— 正因如此它可以当 ERROR 而不是 WARN（WARN 要人解释，ERROR 只要人修）。
 */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'

/** 一个节点的出边：选项指向的 + `next`。两者在引擎里都是真实的"走下去"通路（`enter()` 与 `choose()`） */
export function dialogueEdges(node) {
  const out = []
  for (const c of node.choices ?? []) if (isObj(c) && isStr(c.next)) out.push(c.next)
  if (isStr(node.next)) out.push(node.next)
  return out
}

function nodeMap(tree) {
  const map = new Map()
  for (const n of tree.nodes ?? []) if (isObj(n) && isStr(n.id) && !map.has(n.id)) map.set(n.id, n)
  return map
}

/**
 * 从 root/fallback 出发**沿边**能走到的节点集合。条件一律当作"可能成立"：这是上近似 ——
 * 宁可放过一个"条件永远不成立所以其实读不到"的节点，也不误报一个真的读得到的节点。
 * 读不到 root/fallback（id 拼错等情况）时返回空集：那是别的判据的事，这里不替它说话。
 */
export function reachableNodes(tree) {
  const nodes = nodeMap(tree)
  const seen = new Set()
  const stack = [tree.rootNode, tree.fallbackNode].filter((id) => isStr(id) && nodes.has(id))
  while (stack.length > 0) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    for (const to of dialogueEdges(nodes.get(id))) if (nodes.has(to)) stack.push(to)
  }
  return seen
}

/** 没有任何一条边指向、也不是 root/fallback 的节点（按 id 升序，报告要可读且稳定） */
export function unreachableNodes(tree) {
  const reachable = reachableNodes(tree)
  const ids = [...nodeMap(tree).keys()].filter((id) => !reachable.has(id))
  return ids.sort()
}

/**
 * "没有出口的环"：从每个"只会自动往下走"的节点（没有选项）出发顺着 `next` 走，走回自己就是一只环。
 * 这类节点的出度 ≤ 1，所以环一定是简单的，找起来是函数图上的一次追链。
 * 同一只环会被环上每个节点各报一次 ⇒ 按"从最小的 id 起读"归一化后去重。
 * 只看**够得着**的节点：够不着的环已经以"孤儿"报过一次，同一件事报两遍只会让人看两遍。
 */
export function stuckCycles(tree) {
  const nodes = nodeMap(tree)
  const reachable = reachableNodes(tree)
  const auto = (n) => (n.choices ?? []).length === 0
  const found = new Map()
  for (const start of nodes.keys()) {
    // 够不着的环不在这里报：那些节点已经以"孤儿"的身份各报过一次，同一件事报两遍只会让人看两遍
    if (!reachable.has(start) || !auto(nodes.get(start))) continue
    const seenAt = new Map()
    const path = []
    let cur = start
    while (isStr(cur) && nodes.has(cur) && auto(nodes.get(cur)) && !seenAt.has(cur)) {
      seenAt.set(cur, path.length)
      path.push(cur)
      const next = nodes.get(cur).next
      cur = isStr(next) ? next : null
    }
    if (!isStr(cur) || !seenAt.has(cur)) continue
    const cycle = path.slice(seenAt.get(cur))
    const at = cycle.indexOf([...cycle].sort()[0])
    const canon = [...cycle.slice(at), ...cycle.slice(0, at)]
    found.set(canon.join('>'), canon)
  }
  return [...found.values()]
}

/**
 * 对话表 → findings（`{ key, at, msg }`），调用方按 `at` 报 ERROR。
 * 一棵树报两条：孤儿节点一条、没有出口的环一条（都不与另一条并成一句 —— 它们是两件事，
 * 修法也不同：前者要接线，后者要拆环或给一个出口）。
 */
export function dialogueReachErrors(trees) {
  const out = []
  for (const t of trees ?? []) {
    if (!isObj(t)) continue
    const at = isStr(t.id) ? t.id : 'dialogue'
    const orphans = unreachableNodes(t)
    if (orphans.length > 0) {
      out.push({
        key: `dialogue:${at}:orphan`,
        at,
        msg: `节点 ${orphans.join('/')} 没有任何一条边指向它（从 root/fallback 顺着 next 与选项都走不到）⇒ 这几句台词写得再满也没有玩家读得到；要么接进复访阶梯，要么删掉（§3.1 的树是"读得到的节点的集合"，不是"写下来的节点的集合"）`,
      })
    }
    for (const cycle of stuckCycles(t)) {
      out.push({
        key: `dialogue:${at}:cycle`,
        at,
        msg: `节点 ${cycle.join('，')} 首尾相接成环，且环上每个节点都没有选项 ⇒ 玩家按"继续"会在同几句话之间转不出来（引擎的 \`enter()\` 遇条件不成立就退往 next，\`once\` 只是跳过读过的那一个、接着还是落回环里）；要收束就得让环里至少有一个节点带选项` +
          `（或者把环拆成一条通到落点的链）`,
      })
    }
  }
  return out
}