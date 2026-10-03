/**
 * scripts/world-graph-rules.mjs — 世界图的几何判据本体（KI-100，需求 §9「地图设计」）
 *
 * 为什么不住在 `validate-data.mjs` 里：那文件一被 import 就去校验真表并 `process.exit`，
 * 于是「喂一条坏边、看它拒不拒」这一半在测试里做不了（`ambience-rules.mjs` / `explore-rules.mjs`
 * 同一个理由，KI-075 记过本沙箱连 spawn 都被宿主拒）。判据搬到这里之后，
 * 门禁与 `tests/unit/world-graph.test.ts` 读的是同一段代码。
 *
 * 这一节量的是**作者写下的坐标**，不是可行走路径。需求 §9 那句
 * 「玩家不应该一直沿着一条直线走」今天只能被读成它的一个必要条件：区域里被标注的锚点
 * 不许全落在一条直线上；真正的路径线性度要等 Phase 7 的连续地形才谈得上，这句话写在
 * `docs/technical-architecture.md` §5.9.36 里，不写成已达成。
 *
 * 三条判据各自的分母都是实测（2026-10-03，`git archive HEAD` 平面）：
 *   · 111 个锚点（88 个 `pos` = 72 interactables + 11 landmark + 5 secret，外加 23 个 spawnGroups 的 `center`）
 *     全在自己区域的 bounds 内（三格轴都比，y 也算）；
 *   · 6 条通行器边（唯一判据 = 带 `to`，运行时 `Interactables.ts:179` → `world.travel` → `streaming.teleport` 真吃这个字段）
 *     每一条都恰好落进一个区域的 bounds；
 *   · 七个区域各自的锚点最大三角形面积 3920（未竟厅，6 点）～ 32600（雾语林，16 点），无一为零。
 *
 * 刻意留给校验器的那一半：`vec3` 的三格是不是有限数、bounds 的 `min <= max`、kind 的枚举——
 * 那些由 `report.num` / `INTERACTABLE_KINDS` 全场统一管，搬过来等于给同一句话配第二个主人。
 */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isArr = (v) => Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** 竖直方向也参与归属：`docs/gameplay.md` §5.2 实测雾语林与沉唱堂**共用 xz、只靠 y 分层**（KI-014 那次登记的叠层世界） */
const AXES = ['x', 'y', 'z']

/**
 * 通行器边 = **带 `to` 的交互物**，不是「kind 属于某几个类」。
 *
 * 这条选择是有理由的：`INTERACTABLE_KINDS` 里 gate/elevator/bridge/teleport 之外还有 soundwall 与 bell，
 * 而数据里 `sw_whisperwode_soundwall` 立的是**区域解锁旗**（`flag.choir_entrance_open`）、`to` 一格都没有；
 * 反过来 `gt_brokenbar_backdoor` 与 `gt_drownedchoir_deepstair` 两条 gate 却真的搬人。
 * 所以按 kind 取会同时漏掉一条多出一条，运行时唯一认的字段是 `to`（`Interactables.ts:179` 把它交给 travel）。
 *
 * `requires` 走的是**运行时的同一套派生**（`Interactables.ts:75–81`）：带 `secretId` 的交互物不自己写
 * `requiresFlag`，锁它的旗标住在 `secrets[].unlockFlag`。今天 6 条边没有一个 secretId（实测，
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
      const secret = typeof it.secretId === 'string' ? (rg.secrets ?? []).find((s) => s?.id === it.secretId) : null
      const requires = [
        it.requiresFlag ?? secret?.unlockFlag,
        ...(isArr(it.requiresFlags) ? it.requiresFlags : []),
      ].filter((f) => typeof f === 'string')
      out.push({
        regionId: rg.id,
        id: it.id,
        kind: it.kind,
        pos: it.pos,
        to: it.to,
        oneWay: it.oneWay === true,
        requires,
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

/**
 * 世界图 findings（`{ level, file, where, msg }`，与 ambience-rules 同一形状）。
 * 入参是 `regions.json` 的顶层数组；非数组不抛，改成一条 error，让"门在读空集合"这件事自己喊出来。
 */
export function worldGraphFindings(regions) {
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

  return out
}

/** 落点归属的分解（报错之外的第二个用途：文档那一行按 kind 报数，这个函数就是它的唯一主人） */
export function travelKindTally(regions) {
  const t = {}
  for (const e of travelEdges(regions)) t[e.kind] = (t[e.kind] ?? 0) + 1
  return t
}
