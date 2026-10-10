/**
 * scripts/world-graph-rules.mjs — 世界图的几何与钥匙判据本体（KI-100 起，需求 §9「地图设计」；④⑤ 由 KI-102 补上 Macro 那一腿，⑥⑦ 由 KI-103 补上「需不需要钥匙」那一格）
 *
 * 为什么不住在 `validate-data.mjs` 里：那文件一被 import 就去校验真表并 `process.exit`，
 * 于是「喂一条坏边、看它拒不拒」这一半在测试里做不了（`ambience-rules.mjs` / `explore-rules.mjs`
 * 同一个理由，KI-075 记过本沙箱连 spawn 都被宿主拒）。判据搬到这里之后，
 * 门禁与 `tests/unit/world-graph.test.ts` 读的是同一段代码。
 *
 * 这一节量的是**作者写下的坐标与旗标先后**，不是可行走路径。需求 §9 那句
 * 「玩家不应该一直沿着一条直线走」今天只能被读成它的一个必要条件：区域里被标注的锚点
 * 不许全落在一条直线上；真正的路径线性度要等 Phase 7 的连续地形才谈得上，这句话写在
 * `docs/technical-architecture.md` §5.9.36 里，不写成已达成。
 *
 * 七条判据各自的分母都是实测（①②③ 于 2026-10-03、④⑤ 于 2026-10-04、⑥⑦ 于 2026-10-06，
 * 前两组在 `git archive HEAD` 平面，⑥⑦ 在 worktree@`9f49e16`＋本文件的在途改动上重跑；
 * ④⑤ 落地时真表刚补了三处几何：钟坠院 `minY` 40→48、无耳深窖的排水斜道、未竟厅的钟楼折返楼梯）：
 *   · 116 个锚点（92 个 `pos` = 76 interactables + 11 landmark + 5 secret，外加 24 个 spawnGroups 的 `center`）
 *     全在自己区域的 bounds 内（三格轴都比，y 也算）。这一格会随表长，不是恒等式：f4560b3 之后实测
 *     118 = 94 个 `pos`（78 interactables + 11 + 5）+ 24 个 `center`，现推的那一条住在
 *     `tests/unit/world-graph.test.ts` 的「真表读数」那一组，不要把这里的读数当判据；
 *   · 8 条通行器边（唯一判据 = 带 `to`，运行时 `Interactables.ts:179` → `world.travel` → `streaming.teleport` 真吃这个字段）
 *     每一条都恰好落进一个区域的 bounds；
 *   · 七个区域各自的锚点最大三角形面积 4256（休垒，21 点）～ 32600（雾语林，16 点），无一为零；
 *   · 21 对盒子只有一格都不重叠：5 对共面接缝、2 对共棱，重叠 0 对；
 *   · 从 `order` 最小的区（休垒）沿「共面接缝 ∪ 通行器出边」可达 7/7，且每一区都至少有一条出路；
 *   · ⑥⑦ 的总体：63 面有写方的旗标（23 个交互物 setsFlag + 6 条 `interactUsed` 规则 + 2 场 Boss + 31 棵对话树
 *     + 1 条全局事件）、31 把锁（6 个区域 unlockFlag + 16 个交互物 requires + 5 个 secret + 4 条边的 requires，
 *     锁的旗标次数合计 34，全部由 `requiresOf` 派生）、8 条边、7 个区域；
 *     不动点读数 7/7 区开放、63/63 旗可得、0 把锁解不开、0 条无证侧门，整份 findings 为空。
 *
 * 刻意留给校验器的那一半：`vec3` 的三格是不是有限数、bounds 的 `min <= max`、kind 的枚举——
 * 那些由 `report.num` / `INTERACTABLE_KINDS` 全场统一管，搬过来等于给同一句话配第二个主人。
 * ⑥ 的另一半同理：「有读方、没写方」的旗标归 `ledger-rules.mjs` 的 `flagLedgerErrors`，
 * 这一节只报「钥匙有人做，可玩家到不了做钥匙的地方」。
 */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isArr = (v) => Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** 竖直方向也参与归属：`docs/gameplay.md` §5.2 实测雾语林与沉唱堂**共用 xz、只靠 y 分层**（KI-014 那次登记的叠层世界） */
const AXES = ['x', 'y', 'z']

/**
 * 一个交互物吃下的旗标——**这句只写一次**。
 *
 * `Interactables.ts:80` 给带 `secretId` 的箱子换锁：封印点的旗标住在 `secrets[].unlockFlag`，
 * 交互物行上不写第二份。名册（②⑤⑥⑦）与运行时因此吃的是同一个派生，而不是两份手抄。
 */
function requiresOf(rg, it) {
  const secret = typeof it?.secretId === 'string' ? (rg.secrets ?? []).find((s) => s?.id === it.secretId) : null
  return [it?.requiresFlag ?? secret?.unlockFlag, ...(isArr(it?.requiresFlags) ? it.requiresFlags : [])].filter((f) => typeof f === 'string')
}

/**
 * 通行器边 = **带 `to` 的交互物**，不是「kind 属于某几个类」。
 *
 * 这条选择是有理由的：`INTERACTABLE_KINDS` 里 gate/elevator/bridge/teleport 之外还有 soundwall 与 bell，
 * 而数据里 `sw_whisperwode_soundwall` 立的是**区域解锁旗**（`flag.choir_entrance_open`）、`to` 一格都没有；
 * 反过来 `gt_brokenbar_backdoor` 与 `gt_drownedchoir_deepstair` 两条 gate 却真的搬人。
 * 所以按 kind 取会同时漏掉一条多出一条，运行时唯一认的字段是 `to`（`Interactables.ts:179` 把它交给 travel）。
 *
 * `requires` 走的是**运行时的同一套派生**（`requiresOf()` 对齐 `Interactables.ts:80`）：带 `secretId` 的交互物不自己写
 * `requiresFlag`，锁它的旗标住在 `secrets[].unlockFlag`。今天 8 条边没有一个 secretId（实测，
 * 五个带 secretId 的全是 chest），所以这一层派生现在是恒等；不写成恒等是因为谁哪天给传送门挂个
 * `secretId`，名册报出的 `requires` 就会和玩家实际撞上的锁不是同一句话。
 */
export function travelEdges(regions) {
  if (!isArr(regions)) return []
  const out = []
  for (const rg of regions) {
    if (!isObj(rg)) continue
    for (const it of rg.interactables ?? []) {
      if (!isObj(it) || it.to === undefined) continue
      out.push({
        regionId: rg.id,
        id: it.id,
        kind: it.kind,
        pos: it.pos,
        to: it.to,
        oneWay: it.oneWay === true,
        requires: requiresOf(rg, it),
        setsFlag: typeof it.setsFlag === 'string' ? it.setsFlag : null,
      })
    }
  }
  return out
}

/** 一个点落进哪些区域（0 / 1 / 多都由 bounds 说话，报错时要把范围原样端出来） */
export function regionsContaining(regions, p) {
  if (!isArr(regions) || !isObj(p)) return []
  const hit = []
  for (const rg of regions) {
    const b = rg?.bounds
    if (!isObj(b)) continue
    const inside = AXES.every((a) => isNum(b[`min${U(a)}`]) && isNum(b[`max${U(a)}`]) && isNum(p[a]) && p[a] >= b[`min${U(a)}`] && p[a] <= b[`max${U(a)}`])
    if (inside) hit.push(rg.id)
  }
  return hit
}

const U = (a) => a[0].toUpperCase() + a.slice(1)

/**
 * 区域被标注的点：interactables / landmarks / secrets 的 `pos`，外加 spawnGroups 的 `center`。
 *
 * 这四类不是随手抓的，是按**需求 §9 自己列的 Micro 项**取的：战斗空间 = `spawnGroups[].center`（23 个）、
 * 隐藏空间 = `secrets[].pos`（5 个）、探索空间 = `landmarks[].pos`（11 个）+ 采集/机关/宝箱那一类
 * interactables（72 个带 pos）。`spawnGroups` 用的字段名是 `center` 而不是 `pos`——这一格差点被漏掉，
 * 漏掉的后果不是报错而是"总体比以为的小"：出怪点全在 bounds 外也没人问。`anchorSources()` 就是它的自证。
 */
export function anchorPoints(rg) {
  const out = []
  if (!isObj(rg)) return out
  for (const it of rg.interactables ?? []) if (isObj(it?.pos)) out.push({ ...pick(it.pos), tag: `interactables(${it.id}).pos` })
  for (const l of rg.landmarks ?? []) if (isObj(l?.pos)) out.push({ ...pick(l.pos), tag: `landmarks(${l.id}).pos` })
  for (const s of rg.secrets ?? []) if (isObj(s?.pos)) out.push({ ...pick(s.pos), tag: `secrets(${s.id}).pos` })
  ;(rg.spawnGroups ?? []).forEach((g, i) => { if (isObj(g?.center)) out.push({ ...pick(g.center), tag: `spawnGroups[${i}](${g.campId ?? g.enemyId ?? '?'}).center` }) })
  return out
}

/** 每类锚点各有多少个点（名册自证用：任何一类归零就说明数据的形状变了，判据正在读一个空集合） */
export function anchorSources(regions) {
  const tally = { 'interactables.pos': 0, 'landmarks.pos': 0, 'secrets.pos': 0, 'spawnGroups.center': 0 }
  const keyOf = (tag) => tag.startsWith('interactables') ? 'interactables.pos' : tag.startsWith('landmarks') ? 'landmarks.pos' : tag.startsWith('secrets') ? 'secrets.pos' : 'spawnGroups.center'
  for (const rg of isArr(regions) ? regions : []) {
    for (const p of anchorPoints(rg)) tally[keyOf(p.tag)]++
  }
  return tally
}

function pick(p) {
  return { x: p.x, y: p.y, z: p.z }
}

/** 水平投影上的最大三角形面积：0 ⇒ 所有锚点共线（只看 xz——"一条直线走到底"是水平方向的事） */
export function maxTriangleAreaXZ(points) {
  if (!isArr(points) || points.length < 3) return 0
  let best = 0
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      for (let c = b + 1; c < points.length; c++) {
        const p = points[a], q = points[b], s = points[c]
        if (![p, q, s].every((v) => isNum(v.x) && isNum(v.z))) continue
        const area = Math.abs((q.x - p.x) * (s.z - p.z) - (s.x - p.x) * (q.z - p.z)) / 2
        if (area > best) best = area
      }
    }
  }
  return best
}

/** 只留有名字的区：①②③ 逐区自己报"没有 bounds / 没有 id"，④⑤ 是**区与区之间**的判据，得先有一张名册 */
const namedRegions = (regions) => (isArr(regions) ? regions : []).filter((rg) => isObj(rg) && typeof rg.id === 'string' && isObj(rg.bounds))

/**
 * ④ 的两两盒子接触分类：**共面合法，共体违法**。
 *
 * 三条轴上区间交集的厚度决定一切：三轴都 > 0 ⇒ 重叠出一块体积（`overlap`）；恰一轴为 0 ⇒ 贴在一面上
 * （`face`，这就是需求 §9 的 Macro 连接本体——休垒↔雾语林在 x=96、雾语林↔钟坠院在 y=48，实测 5 对）；
 * 两轴为 0 是共棱、三轴为 0 是共点（实测 2 对），挨着却走不过去。`null` = 不相交，不进名册。
 *
 * 为什么"共体"必须是红而不是提醒：`Streaming.regionAt`（`src/world/Streaming.ts:108`）按名册顺序返回
 * **第一个**命中，所以重叠块里每个坐标的归属由数组位置决定；区域的 music / weatherPresets / lightingPreset
 * 各有一个主人，重叠区里它们会互相盖掉。KI-100 的②只保证"每条边的落点有唯一归属"，看不见整块体积。
 */
export function boxContacts(regions) {
  const rs = namedRegions(regions)
  const out = []
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i].bounds, b = rs[j].bounds
      const lo = {}, hi = {}, thickness = []
      let skip = false
      for (const ax of AXES) {
        const edge = [a[`min${U(ax)}`], a[`max${U(ax)}`], b[`min${U(ax)}`], b[`max${U(ax)}`]]
        if (!edge.every(isNum)) { skip = true; break }
        lo[ax] = Math.max(edge[0], edge[2])
        hi[ax] = Math.min(edge[1], edge[3])
        thickness.push(hi[ax] - lo[ax])
      }
      if (skip || thickness.some((t) => t < 0)) continue
      const vol = thickness.reduce((p, c) => p * c, 1)
      const flat = thickness.filter((t) => t === 0).length
      out.push({
        a: rs[i].id,
        b: rs[j].id,
        kind: vol > 0 ? 'overlap' : flat === 1 ? 'face' : flat === 2 ? 'edge' : 'corner',
        vol,
        span: { x: [lo.x, hi.x], y: [lo.y, hi.y], z: [lo.z, hi.z] },
      })
    }
  }
  return out
}

/**
 * ⑤ 宏观连通：从起始区沿「共面接缝（双向，几何上挨着就能走）∪ 通行器出边（按数据方向）」能不能走遍全图，
 * 以及每一区是否**至少有一条出路**。
 *
 * 三处口径是 deliberate 的，写在这是为了让后来人别把它们读成别的：
 *  · 起始区 = `order` 最小的那一区（**派生**，不写死 id；今天实测是 `rg_resthold`，order 0）。全体缺 `order`
 *    时 `start` 为 `null`，由 findings 报一条红——"没有起点"不能冒充"所有区都可达"。
 *  · 出路 = 共面接缝 ∪ 落点唯一且**不是本区**的出边。区内捷径（实测 `gt_brokenbar_backdoor` 的落点就在营地自己）
 *    不算出路，它只把你从营地的这头挪到那头。
 *  · 单向：只认数据上明写的 `oneWay`。运行时还有一张按 kind 的消耗表（`Interactables.ts:45` 的 REPEATABLE，
 *    elevator/gate/bridge 用一次就消耗），判据**不重抄它**——那会是同一句话的第二个主人（KI-097 一类的名单债）。
 *    所以这一格说的是"数据没有声明此路只走一次"，不是"这条路永远可逆"。
 *  · 接缝不看旗标：`unlockFlag` / `requires` 管的是 chunk 激活与机关锁（时序），这里量的是几何与名册。
 *
 * 只有一个区域时整格**不判**：⑤ 的总体是"区域之间的关系"（需求 §9 的 Macro），一个区域没有"之间"。
 * 这条边界由测试钉着（单区 0 红 / 两区断臂就红），所以它不是漏，是这一格的适用域。
 */
export function macroConnectivity(regions) {
  const rs = namedRegions(regions)
  const ids = rs.map((rg) => rg.id)
  const contacts = boxContacts(rs)
  const seams = new Map(ids.map((id) => [id, new Set()]))
  const nearMisses = new Map(ids.map((id) => [id, []]))
  for (const c of contacts) {
    if (c.kind === 'face') {
      seams.get(c.a).add(c.b)
      seams.get(c.b).add(c.a)
      continue
    }
    nearMisses.get(c.a).push(`${c.b}(共${c.kind === 'edge' ? '棱' : c.kind === 'corner' ? '点' : '体'}${c.kind === 'overlap' ? ` ${c.vol}m³` : ''})`)
    nearMisses.get(c.b).push(`${c.a}(共${c.kind === 'edge' ? '棱' : c.kind === 'corner' ? '点' : '体'}${c.kind === 'overlap' ? ` ${c.vol}m³` : ''})`)
  }
  const edges = travelEdges(rs)
  /** 每条边的落点归属：0 个（虚空）与 2 个（歧义）都不构成一条路，那一格由②单独点名 */
  const lands = edges.map((e) => ({ e, owners: regionsContaining(rs, e.to) }))
  const route = new Map(ids.map((id) => [id, new Set()]))
  for (const { e, owners } of lands) if (owners.length === 1) route.get(e.regionId).add(owners[0])

  const withOrder = rs.filter((rg) => isNum(rg.order))
  const start = withOrder.length === 0 ? null : withOrder.reduce((a, b) => (b.order < a.order ? b : a)).id
  const seen = new Set()
  if (start) {
    seen.add(start)
    const q = [start]
    while (q.length) {
      const cur = q.shift()
      for (const n of [...(seams.get(cur) ?? []), ...(route.get(cur) ?? [])]) if (!seen.has(n)) { seen.add(n); q.push(n) }
    }
  }

  const exits = new Map()
  for (const id of ids) {
    const out = lands
      .filter(({ e, owners }) => e.regionId === id && !e.oneWay && owners.length === 1 && owners[0] !== id)
      .map(({ e, owners }) => `${e.id}→${owners[0]}`)
    exits.set(id, { seams: [...seams.get(id)], out, total: seams.get(id).size + out.length })
  }
  return {
    start,
    regionCount: ids.length,
    unreachable: start ? ids.filter((id) => !seen.has(id)) : ids,
    deadEnds: ids.filter((id) => exits.get(id).total === 0).map((id) => ({ id, near: nearMisses.get(id) })),
    exits,
    seamCount: contacts.filter((c) => c.kind === 'face').length,
  }
}

/** 交互物索引：`id -> { rg, it }`（⑥⑦ 用它把「规则／对话」这类写方钉回一块地） */
function interactableIndex(rs) {
  const idx = new Map()
  for (const rg of rs) for (const it of rg.interactables ?? []) if (isObj(it) && typeof it.id === 'string') idx.set(it.id, { rg, it })
  return idx
}

/**
 * ⑥ 的第一半：每一面旗标**住在哪儿**（钥匙的家）。`regionId: null` = 这句话没有空间位置。
 *
 * 四种带位置的写方，全部从数据现推，一个都不抄：
 *   · `interactable`  交互物自己的 `setsFlag`；
 *   · `rule-interact` `worldstate.json` 里 `on:'interactUsed'` 那条规则——它按 `interactId` 指着某个交互物，
 *     那个交互物的坐标就是这面旗的坐标（四枚首句环、钟腔开口都是这一类）；
 *   · `boss`          `on:'bossDefeated'`——按 `dataId` 在 `spawnGroups[].enemyId` 里找雇主，
 *     一头 Boss 在几个区出怪就住几个区（实测 `en_ostlara` 只在沉唱堂，`en_hersil` 只在未竟厅）；
 *   · `dialogue`      `dialogue.json` 的一棵树按 `npc` 指着某个 `kind:'npc'` 的交互物，
 *     那棵树上任何节点或选项里出现过的 `setFlags` 都算这棵树会立的旗。
 *
 * **乐观口径**（这是这一格的限定，不是漏洞）：对话效果是**带条件**的（要选那一句、要满足那行的 `conditions`），
 * 而这里只问「这棵树的这个 npc 站在哪一块地上」，不问玩家会不会选到那一句。所以 ⑥ 只会把
 * 「连乐观模型都拿不到的钥匙」报成红；一把需要走某条对话分支才立得起来的旗，在这一格里算可得。
 * 反过来，`rule-dangling`／`boss-noloc`／`dialogue-noloc` 三种「写方指不到任何坐标」的 carrier 标成
 * `usable: false`——一条引用悬空的规则永远不发旗，把它当可得就是替数据圆场。
 *
 * `on:'firstParry'` 这类全局事件（实测一面：`ws_parry_first_lesson`）没有空间位置，按可得处理：
 * 这一格量的是**位置与先后**，不是"这个事件会不会发生"。
 */
export function flagCarriers(regions, worldstate, dialogue) {
  const rs = namedRegions(regions)
  const idx = interactableIndex(rs)
  const map = new Map()
  const push = (flag, carrier) => {
    if (typeof flag !== 'string' || !carrier) return
    if (!map.has(flag)) map.set(flag, [])
    map.get(flag).push(carrier)
  }
  for (const rg of rs) for (const it of rg.interactables ?? []) push(it?.setsFlag, { kind: 'interactable', id: it?.id, regionId: rg.id, requires: requiresOf(rg, it) })
  for (const r of isArr(worldstate) ? worldstate : []) {
    if (!isObj(r) || typeof r.setFlag !== 'string') continue
    if (r.on === 'interactUsed') {
      const h = idx.get(r.interactId)
      push(r.setFlag, h
        ? { kind: 'rule-interact', id: r.id, regionId: h.rg.id, requires: requiresOf(h.rg, h.it) }
        : { kind: 'rule-dangling', id: r.id, regionId: null, requires: [], usable: false, via: String(r.interactId ?? '') })
    } else if (r.on === 'bossDefeated') {
      const hosts = rs.filter((rg) => (rg.spawnGroups ?? []).some((g) => g?.enemyId === r.dataId))
      for (const rg of hosts) push(r.setFlag, { kind: 'boss', id: r.id, regionId: rg.id, requires: [] })
      if (hosts.length === 0) push(r.setFlag, { kind: 'boss-noloc', id: r.id, regionId: null, requires: [], usable: false, via: String(r.dataId ?? '') })
    } else {
      push(r.setFlag, { kind: 'event', id: r.id, regionId: null, requires: [] })
    }
  }
  for (const t of isArr(dialogue) ? dialogue : []) {
    if (!isObj(t)) continue
    const flags = new Set()
    for (const n of t.nodes ?? []) {
      if (!isObj(n)) continue
      for (const e of [n.effects, ...(isArr(n.choices) ? n.choices : []).map((c) => (isObj(c) ? c.effects : undefined))]) {
        for (const f of (isObj(e) ? e.setFlags : undefined) ?? []) if (typeof f === 'string') flags.add(f)
      }
    }
    const h = idx.get(t.npc)
    for (const f of flags) push(f, h
      ? { kind: 'dialogue', id: t.id, regionId: h.rg.id, requires: requiresOf(h.rg, h.it) }
      : { kind: 'dialogue-noloc', id: t.id, regionId: null, requires: [], usable: false, via: String(t.npc ?? '') })
  }
  return map
}

/** carrier 的来源分解：kind → 条数（⑥ 的总体自证与文档那一行的唯一主人） */
export function carrierTally(carriers) {
  const out = {}
  for (const cs of carriers.values()) for (const c of cs) out[c.kind] = (out[c.kind] ?? 0) + 1
  return out
}

/** 一面旗的"家"：它的全部写方，一个都没有就是 `[]`（那句归旗标账，不归 ⑥ 说） */
export function keyHome(flag, carriers) {
  return carriers.get(flag) ?? []
}

/**
 * ⑥ 的第二半：全场**谁被什么挡住**。三类锁一次收齐，报错时才有主语。
 * 交互物那一类走 `requiresOf`，所以隐藏空间的箱子（锁住在 `secrets[].unlockFlag`）也在这里，
 * 而不是靠谁去 grep 一遍 `requiresFlag`。
 */
export function lockRoster(regions) {
  const out = []
  for (const rg of namedRegions(regions)) {
    if (typeof rg.unlockFlag === 'string') out.push({ where: `${rg.id}.unlockFlag`, kind: 'region', regionId: rg.id, id: rg.id, flags: [rg.unlockFlag] })
    for (const it of rg.interactables ?? []) {
      const req = requiresOf(rg, it)
      if (req.length > 0) out.push({ where: `${rg.id}.interactables(${it.id}).requires`, kind: it.to === undefined ? 'interactable' : 'edge', regionId: rg.id, id: it.id, flags: req })
    }
    for (const s of rg.secrets ?? []) if (typeof s.unlockFlag === 'string') out.push({ where: `${rg.id}.secrets(${s.id}).unlockFlag`, kind: 'secret', regionId: rg.id, id: s.id, flags: [s.unlockFlag] })
  }
  return out
}

/**
 * ⑥ 的主体：**带着锁走一遍图**，返回不动点 `{ start, open, obtainable }`。
 *
 * 一区开放 = ⑤ 的路（共面接缝 ∪ 落点唯一的通行器出边）走得通，**并且**它的 `unlockFlag` 已经在手里；
 * 一面旗入袋 = 它至少有一个可用写方，那写方 either 没有位置（全局事件），either 住在一个已开放的区，
 * 并且写方自己吃的旗也早已入袋（钥匙套钥匙那一格，实测真表上有：首句四枚环里就有一枚站在深窖自己家里）。
 *
 * `opts.forbid` 是给 ⑦ 用的：同一个模型问第二个问题——「**永远不拿着这面旗**，玩家还能站到哪些区」。
 * 被禁的旗标永不入袋；而**立它的那一条边也不许走**（走过就已经拿着它了，那就不是"不拿着"的状态）。
 *
 * 没有写方的旗标按**已满足**处理：那一格归 `ledger-rules.mjs` 的旗标账（`flagLedgerErrors`：
 * 有读方没写方 ⇒ 欠账或 ERROR）。⑥只报「钥匙有人做，可玩家到不了做钥匙的地方」。
 * 两个主人各说半句，合起来才是完整的一句——这条分工记在 `docs/technical-architecture.md` §5.9.38。
 */
export function unlockReachability(regions, carriers, opts = {}) {
  const rs = namedRegions(regions)
  const forbid = typeof opts.forbid === 'string' ? opts.forbid : null
  const hasCarriers = (f) => (carriers.get(f)?.length ?? 0) > 0
  const macro = macroConnectivity(rs)
  const lands = travelEdges(rs).map((e) => ({ e, owners: regionsContaining(rs, e.to) }))
  const seamTo = new Map(rs.map((rg) => [rg.id, []]))
  for (const c of boxContacts(rs)) {
    if (c.kind !== 'face') continue
    seamTo.get(c.a).push(c.b)
    seamTo.get(c.b).push(c.a)
  }
  const open = new Set()
  const obtainable = new Set()
  const satisfied = (f) => !hasCarriers(f) || obtainable.has(f)
  for (let round = 0; round <= rs.length + carriers.size + 2; round++) {
    let moved = false
    for (const [f, cs] of carriers) {
      if (f === forbid || obtainable.has(f)) continue
      if (cs.some((c) => c.usable !== false && c.requires.every(satisfied) && (c.regionId === null ? true : open.has(c.regionId)))) { obtainable.add(f); moved = true }
    }
    for (const rg of rs) {
      if (open.has(rg.id)) continue
      if (rg.id === macro.start) { open.add(rg.id); moved = true; continue }
      if (typeof rg.unlockFlag === 'string' && !satisfied(rg.unlockFlag)) continue
      const viaSeam = (seamTo.get(rg.id) ?? []).some((id) => open.has(id))
      const viaEdge = lands.some(({ e, owners }) => owners.length === 1 && owners[0] === rg.id && open.has(e.regionId) &&
        e.requires.every(satisfied) && e.setsFlag !== forbid)
      if (viaSeam || viaEdge) { open.add(rg.id); moved = true }
    }
    if (!moved) break
  }
  return { start: macro.start, open, obtainable, regionCount: rs.length, flagCount: carriers.size }
}

/** 一面旗的写方为什么"拿不到"：把原因拼成一句人能照着改的话（自锁／住在没开放的区／自己还上着锁／引用悬空） */
function carrierSentence(flag, carriers, reach) {
  return (carriers.get(flag) ?? []).map((c) => {
    if (c.usable === false) return `${c.kind}(${c.id}) 指的 '${c.via}' 落不到任何坐标 ⇒ 这面旗永远立不起来`
    const home = c.regionId === null ? '没有空间位置（全局事件）' : c.regionId
    const here = c.regionId === null || reach.open.has(c.regionId)
    const own = c.requires.filter((f) => !reach.obtainable.has(f) && hasCarrier(f, carriers))
    return `${c.kind}(${c.id}) 住在 ${home}${here ? '' : '（那个区本身还没开放）'}${own.length ? `，而它自己还吃着 ${own.join('、')}` : ''}`
  }).join('；')
}

const hasCarrier = (f, carriers) => (carriers.get(f)?.length ?? 0) > 0

/**
 * ⑥＋⑦ 的 findings：需求 §9「区域之间的连接方式：几条、单向还是双向、**需不需要钥匙**」的最后一格。
 * ⑥ 锁的可解性，⑦ 侧门不许白送。两格共用 `unlockReachability`，所以口径只有一份。
 */
function keyLockFindings(regions, carriers, err) {
  const rs = namedRegions(regions)
  const locks = lockRoster(rs)
  const keyed = locks.filter((l) => l.flags.some((f) => hasCarrier(f, carriers)))
  // 名册自证：有锁却一把"有家的钥匙"都没读到 ⇒ 这两格是在对一个空总体说"没有死锁"
  if (locks.length > 0 && keyed.length === 0) {
    err('worldstate.json+dialogue.json', `⑥⑦ 读到 ${locks.length} 把锁，可这些锁要的旗标**一个写方都没读到**（旗标名册一共 ${carriers.size} 条）` +
      ' ⇒ 要么两份名册读空了，要么锁全是指不到任何东西的引用。这道门在空转，不是干净。')
    return
  }
  const reach = unlockReachability(rs, carriers)
  const geo = macroConnectivity(rs)
  // 没有起始区就没有种子：⑤ 已经报了一句"这句话没有主语"，这里再逐锁报"拿不到"就是把一个根因说成 N 遍
  // （`tests/unit/world-graph.test.ts` 的 ⑤「全体没有 order」那一格钉的就是这一句安静）。
  if (geo.start === null) return

  // ⑥-a 区域：⑤ 说走得到，可它的钥匙拿不到 ⇒ 区开不了
  for (const rg of rs) {
    const f = rg.unlockFlag
    if (typeof f !== 'string' || reach.open.has(rg.id) || !hasCarrier(f, carriers)) continue
    if (geo.unreachable.includes(rg.id)) continue
    const selfLocked = (carriers.get(f) ?? []).every((c) => c.regionId === rg.id)
    err(`${rg.id}.unlockFlag`, `这一区的钥匙 '${f}' 有 ${(carriers.get(f) ?? []).length} 个写方，可玩家到不了它们：${carrierSentence(f, carriers, reach)}。` +
      (selfLocked ? '**钥匙锁在它自己开的那扇门后面**（自锁）——把写方挪到区外，或给这区换一面由门外立的旗。' : '') +
      '⑤ 说这一区几何上走得到，所以断的是先后顺序而不是接缝。')
  }
  // ⑥-b 其余锁（区域那一类上面已经说过，同一句话不说第二遍）
  for (const l of locks) {
    if (l.kind === 'region') continue
    for (const f of l.flags) {
      if (reach.obtainable.has(f) || !hasCarrier(f, carriers)) continue
      err(l.where, `这把锁吃 '${f}'，可那面旗永远立不起来：${carrierSentence(f, carriers, reach)}`)
    }
  }

  // ⑦ 侧门：落点在别的区、那个区由一面钥匙锁着，而这条边既不吃钥匙也不是铸它的写方，
  //    并且不拿钥匙也能站到起点区 ⇒ 玩家一按就被送进流送层拒绝激活的区域（脚下没有 chunk）。
  const byId = new Map(rs.map((rg) => [rg.id, rg]))
  for (const e of travelEdges(rs)) {
    const owners = regionsContaining(rs, e.to)
    if (owners.length !== 1) continue
    const dest = byId.get(owners[0])
    const f = dest?.unlockFlag
    if (typeof f !== 'string' || owners[0] === e.regionId || !hasCarrier(f, carriers)) continue
    if (e.requires.includes(f) || e.setsFlag === f) continue
    if (!unlockReachability(rs, carriers, { forbid: f }).open.has(e.regionId)) continue
    err(`${e.regionId}.interactables(${e.id}).to`, `这条边的落点在 ${dest.id}，而那个区由 '${f}' 锁着：` +
      `边自己既不吃这把钥匙（requires=${JSON.stringify(e.requires)}）也不是铸它的写方（setsFlag=${JSON.stringify(e.setsFlag)}），` +
      `并且**不拿 '${f}' 也能站到起点区 ${e.regionId}**（把那面旗全程禁掉再走一遍图，起点区仍然开放）⇒ 玩家一按就落到一个 ` +
      '`Streaming.isRegionUnlocked`（`src/world/Streaming.ts:115`）拒绝激活的区域，脚下没有 chunk。' +
      `修法二选一：给这条边写 requiresFlag='${f}'（像 el_resthold_well 那样付钥匙），或让它自己 setsFlag='${f}'（像 br_brokenbar_gate 那样：门就是钥匙的锻造处）。`)
  }
}

/**
 * 世界图 findings（`{ level, file, where, msg }`，与 ambience-rules 同一形状）。
 * 入参是 `regions.json` 的顶层数组；非数组不抛，改成一条 error，让"门在读空集合"这件事自己喊出来。
 * 第二个参数 `{ worldstate, dialogue }` 是 ⑥⑦ 的两份额外名册：调用方不递，那两格就只能把指不到位置的
 * 旗标当成别人的账跳过（`flagCarriers` 头部写的就是这份工），所以消费端必须递——
 * `tests/unit/world-graph.test.ts` 的「消费端」那一节钉的正是这个。
 * ①②③ 逐区量点位与名册，④⑤ 量**区与区**（需求 §9 的 Macro），⑥⑦ 量**钥匙与门的先后**。
 */
export function worldGraphFindings(regions, keys = {}) {
  const file = 'regions.json'
  const out = []
  const err = (where, msg) => out.push({ level: 'error', file, where, msg })

  if (!isArr(regions) || regions.length === 0) {
    err(file, `世界图一个区域都没读到（拿到的是 ${JSON.stringify(regions)?.slice(0, 40)}）⇒ 下面每一句都会变成"空集合都通过"。`)
    return out
  }

  // ① 作者点位不许伸出自己的区域
  for (const rg of regions) {
    if (!isObj(rg.bounds)) {
      err(`${rg.id}.bounds`, '不是对象 ⇒ 这一区的每一条坐标判据都无从比较（形状由 validate-data 统一管，这里只拒绝"拿着它算几何"）')
      continue
    }
    for (const p of anchorPoints(rg)) {
      const bad = AXES.filter((a) => !isNum(p[a]))
      if (bad.length > 0) {
        err(`${rg.id}.${p.tag}`, `坐标缺格或不是有限数（${bad.join('、')}），bounds 无从比较：${JSON.stringify(p)}`)
        continue
      }
      const off = AXES.filter((a) => p[a] < rg.bounds[`min${U(a)}`] || p[a] > rg.bounds[`max${U(a)}`])
      if (off.length > 0) {
        err(`${rg.id}.${p.tag}`, `坐标伸出本区 bounds：${off.map((a) => `${a}=${p[a]} ∉ [${rg.bounds[`min${U(a)}`]}, ${rg.bounds[`max${U(a)}`]}]`).join('，')} ⇒ chunk 流送按区域分块，站在这儿的人根本不会被激活`)
      }
    }
  }

  // ② 每条通行器的落点必须**恰好**落进一个区域
  const edges = travelEdges(regions)
  if (edges.length === 0) err(file, '一条带 `to` 的通行器都没有 ⇒ 名册空了；捷径系统（需求 §9 Micro: Shortcut）今天没有载体，这条红是在问谁把它删了。')
  for (const e of edges) {
    const hit = regionsContaining(regions, e.to)
    if (hit.length === 0) {
      err(`${e.regionId}.interactables(${e.id}).to`, `落点 ${JSON.stringify(e.to)} 不在任何区域的 bounds 内 ⇒ 玩家一按就被传进虚空，而 chunk 流送只会激活"最近的"一片雾。`)
    } else if (hit.length > 1) {
      err(`${e.regionId}.interactables(${e.id}).to`, `落点 ${JSON.stringify(e.to)} 同时落进 ${hit.join(' 与 ')} ⇒ 叠层世界由谁接管这次传送没有唯一答案（区域 bounds 相接处必须留一格缝，或把落点挪离接缝）。`)
    }
  }

  // ③ 锚点不许共线：需求 §9「玩家不应该一直沿着一条直线走」的机器读法（必要条件，不是充分条件）
  for (const rg of regions) {
    const ps = anchorPoints(rg)
    if (ps.length < 3) {
      err(`${rg.id}`, `锚点只有 ${ps.length} 个，"不是一条直线"这句话无从谈起：要么补标注，要么把这一格写进"没做"。`)
      continue
    }
    if (maxTriangleAreaXZ(ps) === 0) {
      err(`${rg.id}.anchors`, `${ps.length} 个锚点全部共线（最大三角形面积 = 0）⇒ 这一区的布局就是一条直线，与需求 §9 的设计目标相反。点位：${ps.map((p) => `${p.tag}(${p.x},${p.z})`).join(' ')}`)
    }
  }

  // ④ 两盒不许重叠出体积：共面是接缝（合法且是 Macro 的路），共体让归属的主人变成数组顺序
  for (const c of boxContacts(regions).filter((x) => x.kind === 'overlap')) {
    err(`${c.a}∩${c.b}`, `bounds 重叠出 ${c.vol} m³ 的公共体积（x[${c.span.x}] y[${c.span.y}] z[${c.span.z}]）⇒ 这一块里每个坐标同时属于两个区域，而 ` +
      '`Streaming.regionAt`（`src/world/Streaming.ts:108`）按名册顺序只认第一个命中：归属的主人变成了数组位置。' +
      '区域的 music / weatherPresets / lightingPreset 各有一个主人，重叠块里它们互相盖。沿缺的那一轴把两盒挪成共面（接缝可以，共体不行）。')
  }

  // ⑤ 区域之间的关系（需求 §9 的 Macro）：从起始区走遍全图 + 每一区都至少有一条出路
  const macro = macroConnectivity(regions)
  if (macro.regionCount >= 2) {
    if (!macro.start) {
      err(file, `${macro.regionCount} 个区域没有一个带有限数 order ⇒ 起始区无从派生，"从起始区能不能走遍全图"这句话今天没有主语——它不能读成"全都可达"。`)
    } else if (macro.unreachable.length > 0) {
      err(`${macro.start} ⇢ ${macro.unreachable.join(' ')}`, `从起始区 ${macro.start}（order 最小者，派生而非写死）沿「共面接缝 ∪ 通行器出边」走不到这些区 ⇒ Macro 断了一截：` +
        '它们要么与谁都只共棱共点（挨着却走不过去），要么出边的方向只进不出。旗标锁不住这一格——这里量的是几何与名册，不是解锁时序。')
    }
    for (const d of macro.deadEnds) {
      err(d.id, `这一区一条出路都没有（共面接缝 0 条、通往别区的非 oneWay 出边 0 条）⇒ 玩家进去就出不来。` +
        `${d.near.length ? `它并非与世隔绝：挨着 ${d.near.join('、')}，只是那种接法走不过去。` : '它与任何区都不接触。'}修法二选一：把盒子挪成与邻区共面，或补一条不带 oneWay、落点在别区的出边（teleport 在运行时的反复可用之列，用完不消耗）。`)
    }
  }

  // ⑥⑦ 钥匙与门的先后（需求 §9「需不需要钥匙」）：两份名册由调用方递进来，这里不猜文件名
  keyLockFindings(regions, flagCarriers(regions, keys.worldstate, keys.dialogue), err)

  return out
}

/** 落点归属的分解（报错之外的第二个用途：文档那一行按 kind 报数，这个函数就是它的唯一主人） */
export function travelKindTally(regions) {
  const t = {}
  for (const e of travelEdges(regions)) t[e.kind] = (t[e.kind] ?? 0) + 1
  return t
}
