import { readFileSync, writeFileSync } from 'node:fs'

const p = 'docs/KNOWN_ISSUES.md'
const lines = readFileSync(p, 'utf8').split(/\r?\n/)

/** 取出以 `| KI-NNN |` 开头的那一行（整段账文都在一行里） */
const takeRow = (id) => {
  const i = lines.findIndex((l) => l.startsWith(`| ${id} |`))
  if (i < 0) throw new Error(`账本里找不到 ${id}`)
  return lines.splice(i, 1)[0]
}

const r129 = takeRow('KI-129')
const r132 = takeRow('KI-132')
const r130 = takeRow('KI-130')

// KI-131：本批的门禁修复，行文重写（原先把 129/131 写在一起，落盘时拆开）
const r131 =
  '| KI-131 | **数据门报 7 条「找不到对应导航网格实体」，而 7 张真网格恰好躺在门没看的目录里：判据的四条 root 没有一条是烘焙器的输出根**（门禁／自相矛盾，2026-10-20 登记并结案）。' +
  '`scripts/bake-navmesh.mjs` 把网格写到 `src/data/json/navmesh/`（运行时由 `src/data/index.ts` 直接 `import`，不是 assets、不进 public），' +
  '而 `scripts/validate-data.mjs` 的 `navmeshExists` 只查 `src/world/navmesh`、`src/data/navmesh`、`assets/navmesh`、`public/navmesh` ' +
  '⇒ `regions.json` 里 7 个 `navmeshRef`（`rg_resthold`／`rg_whisperwode`／`rg_drowned_choir`／`rg_brokenbar_camp`／`rg_fellcarillon`／`rg_earless_deeps`／`rg_unfinished_hall`）全被判成"写了没落"。' +
  'KI-127 的①②（`tests/flow/world.test.ts` 与 `tests/unit/streaming.test.ts` 各数同一批 7 条）与 `validate-data` 那 7 条 ERROR 是**同一件事的三种读数**。' +
  '**落法**：root 名单加上烘焙器与运行时的真落点 `src/data/json`（`regions.json` 写的是相对路径 `navmesh/rg_x.navmesh.json`，拼上这一条正好命中），判据旁注明"为什么必须是这一条"。' +
  '**读数**：`node scripts/validate-data.mjs` 从 **8 ERROR**（7 navmesh + 1 对话风格）到 **0 ERROR / 2 WARN**（两条 WARN 都是既有的、有登记的听感裁决：`bell.everySec` 与 `bl_fellcarillon_fallenbell` 的天气旗）。' +
  '**同批顺出的一条数据自相矛盾已修**：`DLG_MEG`·n7·c1「因为她想让你替她听完。（说服）」的 `style` 写着 `soft`，而 `schema.ts:1770` 与 `validate-data` 的 `CHOICE_STYLES` 都是 `blunt/poetic/silent/provoke` 四值——' +
  '`soft` 是**节点** `emotion` 的合法值却被抄进了**选项** `style`（`docs/narrative.md` §3.2 的表与全表其余 11 处 `poetic` 一致，这一条是笔误），改成 `poetic`；' +
  'UI 那一侧 `STYLE_LABEL[c.style] ?? \'\'` 对未知值**静默吞掉**，所以它在画面上只表现为"这一格没有风格标签"，门却是唯一的证人。| P2 | Implemented |'

const i132 = lines.findIndex((l) => l.startsWith('| KI-132 |'))
lines.splice(i132 + 1, 0, r130, r131)

writeFileSync(p, lines.join('\n'))
const order = readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => /^\| KI-1(29|30|31|32) \|/.test(l)).map((l) => l.slice(0, 9))
console.log(order.join(' '))
