/**
 * KI-100：需求 §9「地图设计」的第一台机器读者。
 *
 * §9 在 2026-10-03 之前是全仓库 92 个需求小节里**从未被点名**的 7 个之一（登记在
 * `docs/technical-architecture.md` §17.2）。它要的东西一件都不虚：Macro = 区域之间的关系、
 * Meso = 区域内部路径、Micro = 房间／战斗空间／探索空间／隐藏空间／Verticality／Shortcut，
 * 外加一句设计目标「玩家不应该一直沿着一条直线走」。
 *
 * 今天这三条里只有 Shortcut 有数据形状，而**没有任何一段代码读过它的几何**：
 * `validate-data.mjs:1642` 只把 `to` 当 vec3 验一次型——落点在哪、是不是虚空、是不是同时踩进
 * 两个叠层区域，这三个问题一个读者都没有。这一份量的是这些事（判据本体住 `scripts/world-graph-rules.mjs`，
 * 门禁与这里读同一段代码）：
 *   ① 作者点位不许伸出本区 bounds（四类和实 113 个点：74 interactables / 11 landmark / 5 secret / 23 spawn center）；
 *   ② 每条通行器边的落点必须**恰好**落进一个区域（0 个 = 传进虚空，2 个 = 叠层归属没有唯一答案）；
 *   ③ 一个区域的锚点不许全部共线——这是 §9 那句设计目标的**必要条件**，不是充分条件：
 *      量的是作者标注的点，不是可行走路径。这句限定同时写在判据本体和 §5.9.36 里，
 *      不许后来把它读成"路径非线性已验收"；
 *   消费端：`validate-data.mjs` 真的 import 并调用它（§55，见最后那一节）。
 *
 * KI-102 在同一段判据上补了 Macro 那一腿（`docs/technical-architecture.md` §5.9.37），编号接着判据本体走：
 *   ④ 两块区域盒子不许重叠出体积——`Streaming.regionAt` 按名册顺序只认第一个命中，共体＝归属变成数组位置的函数；
 *   ⑤ 从 `order` 最小的起始区沿「共面接缝 ∪ 通行器出边」要走得到每一区，且每一区都至少有一条出路（不许有死端）。
 *      ⑤ 只在有名字的盒子 ≥ 2 块时判：一个区域没有"之间"，这条边界下面单独钉着。
 *
 * KI-103 补的是 §9 那一格里最后一个没人读的短语——「需不需要钥匙」（`docs/technical-architecture.md` §5.9.38）：
 *   ⑥ 每一把锁吃的旗标都要有玩家**到得了**的写方：旗标的"家"从三份表一起推（交互物 setsFlag、
 *      `worldstate.json` 的 `interactUsed`/`bossDefeated` 规则、`dialogue.json` 的树按 `npc` 落回某一块地），
 *      然后带着锁走一遍图求不动点。没有写方的旗在这一格按**已满足**处理——那句归 `ledger-rules.mjs` 的旗标账，
 *      两个主人各说半句；
 *   ⑦ 落进上锁区的通行器边不许**无证白送**：`main.ts` 只管 emit 落点，而 `Streaming.isRegionUnlocked`
 *      （`src/world/Streaming.ts:115`）会拒绝激活整个区 ⇒ 玩家落到一块没有 chunk 的地上。
 *      合法的豁免只有三种：这条边自己吃着那把钥匙、这条边就是铸钥匙的地方、或者**不拿钥匙根本站不到起点区**
 *      （把钥匙全程禁掉再走一遍图）。第三种是 ⑦ 里最容易被读成死代码的一腿，真表上 8 条边有 3 条靠它。
 *
 * 刻意不在这里判的：`vec3` 三格是不是有限数、`min <= max`、kind 的枚举、secretId 的引用完整性、
 * 「有读方没写方」的旗标账——那些 `validate-data.mjs` / `ledger-rules.mjs` 全场统一管，
 * 搬过来等于给同一句话配第二个主人（KI-083 立的分工）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assignedLiterals, calledNames, functionBodies, stripComments } from '../../scripts/schema-vocab.mjs'
import {
  anchorPoints, anchorSources, boxContacts, carrierTally, flagCarriers, keyHome, lockRoster, macroConnectivity, maxTriangleAreaXZ,
  regionsContaining, travelEdges, travelKindTally, unlockReachability, worldGraphFindings,
} from '../../scripts/world-graph-rules.mjs'

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }
/**
 * 夹具的行形状。`bounds` 与四个数组都按**可缺**写：真表里不是每个区域都带齐四件，
 * 而判据本体也正是这样读的（`rg.interactables ?? []`）——把夹具类型写成"一定有"，
 * 就等于让这一份测试看不见"字段整体缺失"那一格（它自己有专门的案例）。
 * 因此 mutator 里那些 `!` 不是绕过类型，而是在说"这张合法底子确实带着这一件"。
 */
type Vec = { x?: number; y?: number; z?: number }
type Item = { id?: string; kind?: string; pos?: Vec; center?: Vec; to?: Vec; oneWay?: boolean; secretId?: string; setsFlag?: string; requiresFlag?: string; [k: string]: unknown }
type Row = { id?: string; order?: number; bounds?: Record<string, number>; interactables?: Item[]; landmarks?: Item[]; secrets?: Item[]; spawnGroups?: Item[]; [k: string]: unknown }

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n')
const regions = JSON.parse(read('src/data/json/regions.json')) as Row[]
/** ⑥⑦ 的两份额外名册：判据要能把「规则／对话」这类写方钉回一块地，光有 `regions.json` 推不出旗标的家 */
const worldstate = JSON.parse(read('src/data/json/worldstate.json')) as unknown[]
const dialogue = JSON.parse(read('src/data/json/dialogue.json')) as unknown[]
const KEYS = { worldstate, dialogue }
const errorsOf = (rs: unknown, keys: { worldstate?: unknown; dialogue?: unknown } = {}): Finding[] =>
  worldGraphFindings(rs, keys).filter((f) => f.level === 'error')
const onlyErrs = (errs: Finding[]): string => errs.map((e) => `${e.where} :: ${e.msg}`).join('\n')

/** 一个 ±10 的方盒子：所有 refuse 臂都是在它身上各改一处得到的 */
const B = { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 }
/**
 * 一张**合法**的最小区域：六个不共线的锚点 + 一条落在盒内的通行器边 + 一对写/读旗标。
 * 它必须自己先通过判据——否则每一条"喂坏了要红"的臂都分不清是臂坏了还是底子坏了。
 */
const OK: Row = {
  id: 'rg_ok',
  order: 0,
  bounds: B,
  interactables: [
    { id: 'el_up', kind: 'elevator', pos: { x: -8, y: 0, z: -8 }, to: { x: 8, y: 0, z: 8 } },
    { id: 'gt_mid', kind: 'gate', pos: { x: 0, y: 0, z: 0 }, setsFlag: 'flag.left_ok' },
    { id: 'ch_far', kind: 'chest', pos: { x: 9, y: 9, z: -9 }, requiresFlag: 'flag.left_ok' },
  ],
  landmarks: [{ id: 'lm_a', pos: { x: -9, y: 0, z: 9 } }],
  secrets: [{ id: 'sec_a', unlockFlag: 'flag.sec_a', rewardTable: 'loot_x', pos: { x: 5, y: 0, z: -5 } }],
  spawnGroups: [{ enemyId: 'en_a', count: 2, center: { x: -5, y: 0, z: 5 } }],
}
const ok = (): Row => structuredClone(OK)
const bad = (mut: (r: Row) => Row): Row[] => [mut(ok())]
/* ---------- ④⑤ 用的两块盒子：接法由这里决定，别处不许重抄几何 ---------- */
/** A 的通行器落点搬到 `to`（其余不动）：区内捷径、跨区通路、虚空，都靠这一格改 */
const aTo = (to: Vec): Row => { const r = ok(); r.interactables![0].to = to; return r }
/**
 * `rg_camp`：盒子与它自己的点**一起**搬（dx 水平位移，y 那一层的中心高度），所以搬完之后①仍然干净。
 * 落点 `to` 由调用方给——它决定这条边是回到 A、留在自己区内，还是伸进虚空。
 */
const camp = (dx: number, y: number, to: Vec): Row => ({
  id: 'rg_camp',
  order: 1,
  bounds: { minX: 10 + dx, maxX: 30 + dx, minY: y - 10, maxY: y + 10, minZ: -10, maxZ: 10 },
  interactables: [{ id: 'el_down', kind: 'elevator', pos: { x: 20 + dx, y, z: 0 }, to }],
  landmarks: [
    { id: 'cm1', pos: { x: 12 + dx, y, z: -8 } },
    { id: 'cm2', pos: { x: 28 + dx, y, z: -8 } },
    { id: 'cm3', pos: { x: 20 + dx, y, z: 8 } },
  ],
  secrets: [],
  spawnGroups: [],
})
/** 共面（贴 x=10 那一面）——④ 合法、⑤ 把它算作一条可步行的接缝 */
const facePair = (): Row[] => [aTo({ x: 20, y: 0, z: 8 }), camp(0, 0, { x: -5, y: 0, z: 0 })]
/**
 * 只共一条棱（C 移到 x[10,30] 且抬到 y[10,30]）：两区**挨着**，A 那条边又只回到自己区内。
 * ④ 在这一格必须安静（共棱不重叠体积），⑤ 要红两样：从 rg_ok 走不到营地（共面才算路），而 rg_ok 一条出路都没有。
 */
const edgePair = (): Row[] => [aTo({ x: 0, y: 0, z: 0 }), camp(0, 20, { x: 0, y: 0, z: 0 })]
/** 咬进 A 五米（C 平移到 x[5,25]）——公共体积 5×20×20 = 2000 m³ */
const overlapPair = (): Row[] => [aTo({ x: 20, y: 0, z: 8 }), camp(-5, 0, { x: -5, y: 0, z: 0 })]
/** 隔开 200 米、两条边各回各区自己（区内捷径不算出路）——⑤ 的三句话都要红 */
const apartPair = (): Row[] => [aTo({ x: 8, y: 0, z: -8 }), camp(200, 0, { x: 220, y: 0, z: 0 })]
/**
 * 隔开 200 米、但两条边真的互相通向对方：`aOneWay` 决定 A→营地那条能不能回来。
 * 没有共面接缝垫背，所以这一格的红只剩「出路边」一个来源——⑤ 单向口径的唯一证人。
 */
const linkPair = (aOneWay: boolean): Row[] => {
  const a = aTo({ x: 220, y: 0, z: 0 })
  if (aOneWay) a.interactables![0].oneWay = true
  return [a, camp(200, 0, { x: 0, y: 0, z: 0 })]
}
/** 直接喂给 `boxContacts` 的裸盒子：五种接触关系各一格，靠坐标而不是靠 `camp` 的位移参数拼 */
const box = (id: string, x: [number, number], y: [number, number], z: [number, number]): Row => ({
  id,
  order: 0,
  bounds: { minX: x[0], maxX: x[1], minY: y[0], maxY: y[1], minZ: z[0], maxZ: z[1] },
})
/** 接触分类的那一格用一个 10³ 的盒子当基准，B 只沿一根轴挪 */
const A1 = (): Row => box('a', [-5, 5], [-5, 5], [-5, 5])

describe('真表读数：判据吃的必须是一个非空的总体（需求 §9）', () => {
  it('regions.json 七条判据一个 error 都没有——而这句话的分母是 7 个区域、113 个锚点、8 条通行器边、21 对盒子、31 把锁', () => {
    const errs = errorsOf(regions, KEYS)
    const tally = anchorSources(regions)
    expect(errs, `世界图判据在真表上红了：\n${onlyErrs(errs)}`).toEqual([])
    for (const [k, v] of Object.entries(tally)) {
      expect(v, `锚点名册的「${k}」只剩 ${v} 个：字段名改过而判据还在读旧的那一个，总体就会这样安静地缩小`).toBeGreaterThan(0)
    }
    expect(tally['spawnGroups.center'], '出怪点一共 23 组，全带 center；这一格掉到 20 以下就是有人把出怪几何改了').toBeGreaterThanOrEqual(20)
    expect(travelEdges(regions).length, '一条通行器都没有就不是"干净的总体"，是没读到东西').toBeGreaterThanOrEqual(3)
    expect(regions.length, '区域数掉下去 = 名册被谁摘走一个，七条判据同时缩').toBeGreaterThanOrEqual(5)
    // ④⑤ 的总体自证：接触对是从 regions.length 派生的两两组合里筛出来的，筛空了就是没读到 bounds
    const contacts = boxContacts(regions)
    const candidates = (regions.length * (regions.length - 1)) / 2
    expect(contacts.length, `${candidates} 对候选里一对接触都没读到 ⇒ ④⑤ 是在对一个空总体说"没有重叠、全都可达"`).toBeGreaterThanOrEqual(5)
    expect(contacts.filter((c) => c.kind === 'overlap'), '共体对必须一条都不许有（KI-102 的④）').toEqual([])
  })

  it('出怪点用的是 center 而不是 pos：只看 pos 的那一版口径会静悄悄少掉 23 个锚点', () => {
    const posOnly = regions.reduce((n, r) => n + (r.interactables ?? []).filter((i) => i?.pos).length + (r.landmarks ?? []).filter((l) => l?.pos).length + (r.secrets ?? []).filter((s) => s?.pos).length, 0)
    const withCenters = regions.reduce((n, r) => n + anchorPoints(r).length, 0)
    expect(withCenters - posOnly, '差值必须正好等于出怪点的个数：相等才算 center 真的在总体里').toBe(anchorSources(regions)['spawnGroups.center'])
    expect(posOnly, '只看 pos 的三类今天有 90 个点（它自己变成 113 就说明这格口径已经和 center 混了）').toBe(90)
  })

  it('七个区域的锚点都不共线，而"最窄的那一区"由实测指认（休垒 21 个点、面积 4256）', () => {
    const rows = regions.map((r) => ({ id: String(r.id), n: anchorPoints(r).length, a: maxTriangleAreaXZ(anchorPoints(r)) }))
    for (const r of rows) {
      expect(r.n, `${r.id} 的锚点不足 3 个，"不是一条直线"这句话在它身上无从谈起`).toBeGreaterThanOrEqual(3)
      expect(r.a, `${r.id} 的 ${r.n} 个锚点共线（面积 0）⇒ 这一区的布局是一条直线`).toBeGreaterThan(0)
    }
    const narrowest = rows.reduce((a, b) => (b.a < a.a ? b : a))
    expect(narrowest.id, '最窄的一区换了 = 有人在改区域几何，这条判据的余量要重新量（KI-102 给深窖与未竟厅各补了一条出边之后，最窄从"未竟厅 3920"换成了"休垒 4256"）').toBe('rg_resthold')
    expect(narrowest.a, '最窄一区的面积掉到 1000 以下就是共线的边缘，不能再当"还有余量"').toBeGreaterThanOrEqual(1000)
  })
})

describe('① 作者点位不许伸出本区 bounds', () => {
  it('合法底子自己先过（否则每一条 refuse 臂都分不清是臂坏了还是底子坏了）', () => {
    const errs = errorsOf([ok()])
    expect(errs, onlyErrs(errs)).toEqual([])
  })

  it('宝箱伸出 x 上界 ⇒ 红，并把那一根轴和越掉的界原样端出来', () => {
    const errs = errorsOf(bad((r) => { r.interactables![2].pos = { x: 11, y: 0, z: 0 }; return r }))
    expect(errs.map((e) => e.where), 'x=11 已经出了 [-10,10]，这条必须点名 ch_far').toEqual(['rg_ok.interactables(ch_far).pos'])
    expect(errs[0].msg).toContain('x=11 ∉ [-10, 10]')
  })

  it('竖直方向也算：secret 悬在天花板之上一样红（需求 §10 的 Verticality 正是靠 y 分层的）', () => {
    const errs = errorsOf(bad((r) => { r.secrets![0].pos = { x: 0, y: 40, z: 0 }; return r }))
    expect(errs.length, '只比 xz 的写法在这一格会绿，而那正是叠层世界最容易犯的错').toBe(1)
    expect(errs[0].where).toBe('rg_ok.secrets(sec_a).pos')
    expect(errs[0].msg).toContain('y=40 ∉ [-10, 10]')
  })

  it('出怪点伸出 bounds ⇒ 红，且点名叫到 spawnGroups 的那一格', () => {
    const errs = errorsOf(bad((r) => { r.spawnGroups![0].center = { x: 0, y: 0, z: -11 }; return r }))
    expect(errs.map((e) => e.where), `center 越界没被抓住，出怪就会刷在一块永不激活的地上：${onlyErrs(errs)}`).toEqual(['rg_ok.spawnGroups[0](en_a).center'])
  })

  it('坐标缺格不许被当成"没越界"：只有 x/z 的 landmark 要红，而不是安静通过', () => {
    const errs = errorsOf(bad((r) => { r.landmarks![0].pos = { x: 1, z: 2 }; return r }))
    expect(errs.length, '缺 y 的点位在"逐轴比界"的写法里每一轴都不越界 ⇒ 空集通过').toBe(1)
    expect(errs[0].msg).toContain('y')
  })

  it('bounds 整个缺失时不抛，改成一条 error（会崩更早上层的臂等于零证据）', () => {
    // 底子仍然是一张合法世界，只抠掉一个区域自己的 bounds：
    // 这一格要证的只有「缺 bounds  ⇒ 恰好一条说法」，别的判据不能跟着一起响。
    const a = ok()
    delete a.bounds
    const errs = errorsOf([a, { ...ok(), id: 'rg_partner' }])
    expect(errs.map((e) => e.where), `缺 bounds 只该报一条，实际报了：${onlyErrs(errs)}`).toEqual(['rg_ok.bounds'])
  })
})

describe('② 每条通行器的落点必须恰好落进一个区域', () => {
  it('名册的准入判据是「带 to」，不是「kind 属于某几个类」', () => {
    expect(travelEdges([ok()]).map((e) => e.id), '只有 el_up 带 to').toEqual(['el_up'])
    const asChest = bad((r) => { r.interactables![2] = { id: 'ch_door', kind: 'chest', pos: { x: 0, y: 0, z: 0 }, to: { x: 5, y: 0, z: 5 } }; return r })
    expect(travelEdges(asChest).map((e) => e.id), 'chest 挂上 to 一样搬人：按 kind 取名单就会漏掉它').toEqual(['el_up', 'ch_door'])
    const asSoundwall = bad((r) => { r.interactables!.push({ id: 'sw_wall', kind: 'soundwall', pos: { x: 1, y: 1, z: 1 }, setsFlag: 'flag.wall_broken' }); return r })
    expect(travelEdges(asSoundwall).map((e) => e.id), '真表的音壁本体 sw_whisperwode_soundwall 立的是区域解锁旗、一个 to 都没有：按 kind 取就会多出一条').toEqual(['el_up'])
  })

  it('真表 8 条边各落进唯一一个区域，分解是 elevator×2 / gate×2 / teleport×3 / bridge×1', () => {
    const edges = travelEdges(regions)
    for (const e of edges) {
      const hit = regionsContaining(regions, e.to)
      expect(hit.length, `${e.id} 的落点 ${JSON.stringify(e.to)} 落进 ${hit.length} 个区域：${hit.join(',')}`).toBe(1)
    }
    expect(travelKindTally(regions), 'kind 分解的主人只有 travelKindTally；文档那一行照着它写（KI-102 补的两条出路都是 teleport：运行时反复可用，不会被 used 吃掉）').toEqual({ elevator: 2, gate: 2, teleport: 3, bridge: 1 })
  })

  it('落点不在任何区域 ⇒ 红，话术里要能看见那个坐标', () => {
    const errs = errorsOf(bad((r) => { r.interactables![0].to = { x: 500, y: 0, z: 500 }; return r }))
    expect(errs.map((e) => e.where)).toEqual(['rg_ok.interactables(el_up).to'])
    expect(errs[0].msg).toContain('500')
    expect(errs[0].msg).toContain('虚空')
  })

  it('落点正正压在两区的共用界面上 ⇒ 红：叠层世界由谁接管这次传送没有唯一答案（真表雾语林⇄沉唱堂那条 y=−8 缝就是这个形状）', () => {
    // 夹具是"一块盒子叠在另一块上面"（C = x[-10,10] y[10,30] z[-10,10]，A = y[-10,10]），落点 y=10 恰好在两区共享的那一面上。
    // 它同时是④的接受侧：共面接缝合法，所以这一格只该红在②这一条上——两句话各自有各自的判据。
    const pair = [aTo({ x: 8, y: 10, z: 8 }), camp(-20, 20, { x: -5, y: 0, z: 0 })]
    expect(regionsContaining(pair, { x: 8, y: 10, z: 8 }).sort(), '界面上的点同时属于两区 ⇒ 归属天然歧义，这正是真表要避开的落点').toEqual(['rg_camp', 'rg_ok'])
    expect(regionsContaining(pair, { x: 8, y: 9, z: 8 }), '只差一格就不歧义：这条判据针对的是那一面，不是"两块盒子挨着"').toEqual(['rg_ok'])
    const errs = errorsOf(pair)
    expect(errs.map((e) => e.where), `el_up 的落点压在 rg_ok 与 rg_camp 的接缝上 ⇒ 只该红②这一条：${onlyErrs(errs)}`).toEqual(['rg_ok.interactables(el_up).to'])
    expect(errs[0].msg).toContain('rg_ok 与 rg_camp')
    // 反向对照：同一对盒子、同一个接缝，只把落点从界面上挪开一格，同一份数据就必须干净——否则这条判据是在无条件报警。
    const offSeam = [aTo({ x: 8, y: 20, z: 8 }), camp(-20, 20, { x: -5, y: 0, z: 0 })]
    expect(errorsOf(offSeam), onlyErrs(errorsOf(offSeam))).toEqual([])
  })

  it('requires 跟着运行时的 secretId 派生走（今天恒等，挂上那天名册不撒谎）', () => {
    const rawEdges = regions.flatMap((r) => (r.interactables ?? []).filter((i) => i.to !== undefined))
    expect(rawEdges.filter((i) => i.secretId !== undefined).length, '真表里 8 条通行器边没有一个带 secretId ⇒ 名册的 requires 现在等于字面值；出现第一条时下面那格要接管这句话').toBe(0)
    const derived = bad((r) => { r.interactables![0] = { id: 'el_up', kind: 'elevator', pos: { x: -8, y: 0, z: -8 }, to: { x: 8, y: 0, z: 8 }, secretId: 'sec_a' }; return r })
    const e = travelEdges(derived).find((x) => x.id === 'el_up')
    expect(e?.requires, 'Interactables.ts:75–81 把 secrets[].unlockFlag 当成这条交互物的锁；名册只读字面 requiresFlag 就会报出"没锁"').toEqual(['flag.sec_a'])
  })

  it('一条通行器都没有 ⇒ 红（空名册不许冒充"干净"）', () => {
    const errs = errorsOf([{
      id: 'rg_bare',
      bounds: B,
      interactables: [
        { id: 'ch1', kind: 'chest', pos: { x: 0, y: 0, z: 0 } },
        { id: 'ch2', kind: 'chest', pos: { x: 5, y: 0, z: 5 } },
        { id: 'ch3', kind: 'chest', pos: { x: -5, y: 0, z: 6 } },
      ],
    }])
    expect(errs.map((e) => e.where), '捷径全没了却报"干净"，就是 KI-099 那一类"分母不可复现"的翻版').toContain('regions.json')
  })
})

describe('③ 需求 §9 那句「不要一直沿着一条直线走」的机器读法', () => {
  it('面积公式自己先对：底 6 高 4 的三角形 = 12，三点共线 = 0，两点不足 = 0', () => {
    expect(maxTriangleAreaXZ([{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 0, z: 4 }])).toBe(12)
    expect(maxTriangleAreaXZ([{ x: 0, z: 0 }, { x: 5, z: 5 }, { x: 9, z: 9 }]), 'y=x 这条线上的三个点').toBe(0)
    expect(maxTriangleAreaXZ([{ x: 0, z: 0 }, { x: 1, z: 1 }]), '两点不足以谈共线：返回 0，由调用方分开报').toBe(0)
  })

  it('把整区锚点排成一条直线 ⇒ 红，并把点位端出来给人改', () => {
    const errs = errorsOf(bad((r) => {
      r.interactables = [
        // 载体用 gate 而不是 chest：这一格要证的是共线，别把「名册按什么准入」那条判据混进来
        { id: 'a', kind: 'gate', pos: { x: -6, y: 0, z: -6 }, to: { x: 6, y: 0, z: 6 } },
        { id: 'b', kind: 'chest', pos: { x: -3, y: 0, z: -3 } },
        { id: 'c', kind: 'chest', pos: { x: 0, y: 0, z: 0 } },
        { id: 'd', kind: 'chest', pos: { x: 3, y: 0, z: 3 } },
      ]
      r.landmarks = [{ id: 'l', pos: { x: 5, y: 0, z: 5 } }]
      r.secrets = []
      r.spawnGroups = []
      return r
    }))
    expect(errs.map((e) => e.where), `五个点都在 x=z 上，只该报共线这一条：${onlyErrs(errs)}`).toEqual(['rg_ok.anchors'])
    expect(errs[0].msg).toContain('共线')
    expect(errs[0].msg, '报错要能照着改：点位列表必须在消息里').toContain('interactables(a).pos')
  })

  it('锚点少于 3 个 ⇒ 单独一种红（不是"通过"，也不是"共线"）', () => {
    const errs = errorsOf(bad((r) => {
      r.interactables = [
        { id: 'a', kind: 'gate', pos: { x: 0, y: 0, z: 0 }, to: { x: 5, y: 0, z: 5 } },
        { id: 'b', kind: 'chest', pos: { x: 5, y: 5, z: -5 } },
      ]
      r.landmarks = []
      r.secrets = []
      r.spawnGroups = []
      return r
    }))
    expect(errs.map((e) => e.where)).toEqual(['rg_ok'])
    expect(errs[0].msg).toContain('锚点只有 2 个')
  })

  it('总体本身为空 ⇒ 一条 error，而不是"每一句都通过"', () => {
    expect(errorsOf([]).length).toBe(1)
    expect(errorsOf(undefined)[0].msg).toContain('一个区域都没读到')
  })
})

describe('④ 两块区域的盒子不许重叠出体积（需求 §9 的 Macro：共面是接缝，共体没有唯一主人）', () => {
  it('五种接触关系各叫各的名：面 / 棱 / 点 / 体 / 相离，说这话的地方只有 boxContacts', () => {
    const kindOf = (b: Row): string | undefined => boxContacts([A1(), b])[0]?.kind
    expect(kindOf(box('b', [5, 15], [-5, 5], [-5, 5])), '一根轴厚度 0、另两根 >0 ⇒ 贴在一面上：这就是需求 §9 的接缝').toBe('face')
    expect(kindOf(box('b', [5, 15], [5, 15], [-5, 5])), '两根轴厚度 0 ⇒ 共棱：挨着，人走不过去').toBe('edge')
    expect(kindOf(box('b', [5, 15], [5, 15], [5, 15])), '三根轴厚度 0 ⇒ 共点').toBe('corner')
    expect(kindOf(box('b', [0, 10], [0, 10], [0, 10])), '三根轴都 >0 ⇒ 共体，只有这一格该红').toBe('overlap')
    const o = boxContacts([A1(), box('b', [0, 10], [0, 10], [0, 10])])[0]
    expect(o?.vol, '体积是三轴交叠厚度的乘积：这里 5×5×5').toBe(125)
    expect(o?.span, '公共块的三轴范围要原样端出来，报错才好照着挪盒子').toEqual({ x: [0, 5], y: [0, 5], z: [0, 5] })
    expect(boxContacts([A1(), box('b', [50, 60], [-5, 5], [-5, 5])]), '相离的两盒根本不该进名册：进了就会有人拿 vol=0 说"它们挨着"').toEqual([])
    expect(boxContacts([A1(), { id: 'b', order: 0, bounds: { minX: 0, maxX: 10 } }]), 'bounds 缺格 ⇒ 不参与几何（那一格的红归 validate-data 与①，这里不许拿 NaN 比大小）').toEqual([])
    expect(boxContacts([A1(), { bounds: B }]), '没有 id 的盒子不进名册：接缝与死胡同都是按 id 说话的句子').toEqual([])
  })

  it('共面的一对一句不红；把 C 咬进 A 五米 ⇒ 恰好一条红，体积和三轴范围都在话术里', () => {
    expect(errorsOf(facePair()), '④ 的接受侧：贴面是 Macro 的连接本体，不能连它一起报').toEqual([])
    const errs = errorsOf(overlapPair())
    expect(errs.map((e) => e.where), `共体必须点名两区（where 里那个 ∩ 就是这句话的主语）：${onlyErrs(errs)}`).toEqual(['rg_ok∩rg_camp'])
    expect(errs[0].msg).toContain('2000 m³')
    expect(errs[0].msg, '报错要能照着改：公共块在哪一段轴上咬住了，必须在消息里').toContain('x[5,10]')
    expect(errs[0].msg, '这句话的理由是运行时的归属规则，不是风格偏好').toContain('Streaming.regionAt')
  })

  it('真表 21 对候选里 7 对接触：5 面 / 2 棱 / 0 体；y=48 那条接缝是 KI-102 把钟坠院的盒子抬出来的结果', () => {
    const contacts = boxContacts(regions)
    const ofKind = (k: string) => contacts.filter((c) => c.kind === k)
    const names = (list: { a: string; b: string }[]) => list.map((c) => `${c.a}∩${c.b}`).sort()
    expect(contacts.length, '接触对总数换了 = 有人在挪盒子，下面三格的名册要一起重量').toBe(7)
    expect(names(ofKind('face')), '共面接缝名册是⑤的路网底子：多一条少一条都要在这里说').toEqual([
      'rg_resthold∩rg_brokenbar_camp',
      'rg_resthold∩rg_whisperwode',
      'rg_whisperwode∩rg_brokenbar_camp',
      'rg_whisperwode∩rg_drowned_choir',
      'rg_whisperwode∩rg_fellcarillon',
    ].sort())
    expect(names(ofKind('edge')), '共棱的两对：营地⇄钟坠院、钟坠院⇄未竟厅（挨着，走不过去）').toEqual([
      'rg_brokenbar_camp∩rg_fellcarillon',
      'rg_fellcarillon∩rg_unfinished_hall',
    ].sort())
    expect(ofKind('overlap'), '④ 的整句话在真表上就是这一格：一条共体都不许有').toEqual([])
    const bell = contacts.find((c) => c.kind === 'face' && [c.a, c.b].sort().join() === ['rg_fellcarillon', 'rg_whisperwode'].sort().join())
    expect(bell?.span.y, '钟坠院的下界从 40 抬到 48 之后，两盒只剩 y=48 这一面共用（thickness 0 ⇒ face）：抬回去就变回共体').toEqual([48, 48])
  })
})

describe('⑤ 区域之间的关系走得通吗（需求 §9 的 Macro：从起始区走遍全图 + 每一区都有一条出路）', () => {
  it('两块共面的盒子：一句都不红，而起始区是从 order 派生出来的', () => {
    const pair = facePair()
    const errs = errorsOf(pair)
    expect(errs, `共面 + 两条互相通向对方的边 ⇒ ⑤ 该安静：${onlyErrs(errs)}`).toEqual([])
    const m = macroConnectivity(pair)
    expect(m.start, 'A 的 order 0 < 营地 1 ⇒ 主语是它，而不是写死的某个 id').toBe('rg_ok')
    expect(m.seamCount, '这一格的路网只有一条接缝；变成 0 就成了"没读到 bounds"').toBe(1)
    expect(m.unreachable).toEqual([])
    expect(m.deadEnds).toEqual([])
  })

  it('隔开 200 米、两条边又各自回到自己区内 ⇒ 三样各红一条（断臂 + 两区各自是死胡同）', () => {
    const errs = errorsOf(apartPair())
    expect(errs.map((e) => e.where), `走不到、两区各自出不来，是三句不同的话：${onlyErrs(errs)}`).toEqual(['rg_ok ⇢ rg_camp', 'rg_ok', 'rg_camp'])
    expect(errs[0].msg, '主语必须说清起点是从 order 派生的，否则读者会以为起点是写死的').toContain('order 最小者，派生而非写死')
    expect(errs[1].msg, '死胡同的话术要点名"区内捷径不算出路"，不然读者会以为补一条回到自己区的电梯就行').toContain('通往别区')
    expect(errs[1].msg).toContain('与任何区都不接触')
  })

  it('共棱不算路：两区挨着却走不过去 ⇒ 红两条，并把"挨着"这件事本身端出来', () => {
    const errs = errorsOf(edgePair())
    expect(errs.map((e) => e.where), `营地走不到、A 出不去，而 A→营地那条边确实通着 ⇒ 只有两句话：${onlyErrs(errs)}`).toEqual(['rg_ok ⇢ rg_camp', 'rg_ok'])
    expect(errs[1].msg, '"与世隔绝"和"挨着却走不过去"是两种修法：消息得说清它挨着谁、怎么挨着').toContain('共棱')
    expect(errorsOf(facePair()), '把接法从共棱改成共面 ⇒ 同样两条边立刻干净：这条红指的就是接法').toEqual([])
  })

  it('单向：去得了、回不来 ⇒ 只红"出路"一条，而"可达"仍然成立（⑤ 吃 oneWay 的唯一证人）', () => {
    const errs = errorsOf(linkPair(true))
    expect(errs.map((e) => e.where), `A 唯一的出边被 oneWay 划掉 ⇒ 只有 rg_ok 是死胡同：${onlyErrs(errs)}`).toEqual(['rg_ok'])
    expect(errs[0].msg).toContain('oneWay')
    expect(macroConnectivity(linkPair(true)).unreachable, '单向着的是"能不能回来"，不是"能不能过去"：可达那一格不许跟着红').toEqual([])
    expect(errorsOf(linkPair(false)), '把 oneWay 去掉就干净 ⇒ 上面那条红确实是它招来的，不是夹具本身坏了').toEqual([])
  })

  it('起始区派生自 order：换最小值 ⇒ 主语跟着换；全体没有 order ⇒ 红一条"这句话没有主语"', () => {
    const swapped = [{ order: 9 }, { order: 1 }]
    const flipped = facePair().map((r, i) => ({ ...r, ...swapped[i] }))
    expect(macroConnectivity(flipped).start, 'order 反过来 ⇒ 起点就是营地：这一格钉的是"派生"而不是"rg_resthold"').toBe('rg_camp')
    const leaderless = facePair().map((r) => { const c = { ...r }; delete c.order; return c })
    expect(macroConnectivity(leaderless).start).toBeNull()
    const errs = errorsOf(leaderless)
    expect(errs.map((e) => e.where), `没有起点时不许报"全都可达"，也不许逐区/逐锁报死胡同（那是同一件事的 N 遍——⑥⑦ 在这一格同样跟着安静，因为它没有种子可走）：${onlyErrs(errs)}`).toEqual(['regions.json'])
    expect(errs[0].msg).toContain('没有主语')
  })

  it('只有一块盒子时整格不判：⑤ 的总体是"区与区之间"，一个区域没有"之间"', () => {
    const one = ok()
    expect(macroConnectivity([one]).regionCount).toBe(1)
    expect(macroConnectivity([one]).exits.get('rg_ok')?.total, '这一区确实一条出路都没有（唯一的边落回自己）——正因如此才更要钉住"不判"是适用域而不是漏').toBe(0)
    expect(errorsOf([one]), '把"不判"读成"判成通过"是同一句话，但把它写成"整格跳过"就必须在这里有证人').toEqual([])
  })

  it('真表：从休垒走遍 7 区、0 个死胡同，而 KI-100 记下的两条「没做」各有一条实测出路', () => {
    const m = macroConnectivity(regions)
    expect(m.start, '起始区换了 = 有人在改 order，⑤ 的主语要重新指认').toBe('rg_resthold')
    expect(m.regionCount, '区域名册掉了 ⇒ 连通这句话的分母跟着缩').toBe(7)
    expect(m.unreachable, `走不到的区：${m.unreachable.join(' ')}`).toEqual([])
    expect(m.deadEnds, `进去就出不来的区：${m.deadEnds.map((d) => d.id).join(' ')}`).toEqual([])
    expect(m.exits.get('rg_earless_deeps')?.out, '无耳深窖的出路只有 KI-102 补的那条排水斜道：它此前是一条死路').toEqual(['tp_deeps_drainslide→rg_brokenbar_camp'])
    expect(m.exits.get('rg_unfinished_hall')?.out, '未竟厅的出路同理（沿钟楼折返楼梯下行）').toEqual(['tp_unfinishedhall_belfrystair→rg_fellcarillon'])
    const inbound = (id: string) => travelEdges(regions).filter((e) => {
      const o = regionsContaining(regions, e.to)
      return o.length === 1 && o[0] === id
    }).map((e) => e.id)
    expect(inbound('rg_earless_deeps'), '两条进得去的路（其中一口井还是 oneWay 的）配一条出得去的路 ⇒ 上面那句"0 死胡同"不是补完就绿的巧合').toEqual(['el_resthold_well', 'gt_drownedchoir_deepstair'])
    expect(m.exits.get('rg_resthold')?.out, '休垒靠两条共面接缝出去，一条出边都不用：这是⑤「接缝 ∪ 出边」两半里接缝那一半的真表证人').toEqual([])
    expect(m.exits.get('rg_resthold')?.seams.sort(), '休垒的两条接缝：营地与雾语林（⑤ 的路网在这里是真的连上的）').toEqual(['rg_brokenbar_camp', 'rg_whisperwode'])
  })
})

/* ---------- ⑥⑦ 用的夹具：三份表一起给，旗标的「家」才推得出来 ---------- */
const KEY = 'flag.open_camp'
const KEY2 = 'flag.open_deep'
/**
 * `facePair()` 的营地上锁（`unlockFlag = KEY`），而 A→营地那条边付不付这把钥匙由 `edgeKey` 决定：
 * `null` = 白送（⑦ 该红），默认 = 付钥匙（⑦ 该安静）。
 */
const gatedPair = (edgeKey: string | null = KEY): Row[] => {
  const [a, c] = facePair()
  c.unlockFlag = KEY
  if (edgeKey !== null) a.interactables![0].requiresFlag = edgeKey
  return [a, c]
}
/** 在指定那一区放一个立 KEY 的交互物（点位都落在该区的 bounds 内，① 不许跟着响） */
const writerIn = (rs: Row[], who: 'rg_ok' | 'rg_camp'): Row[] => {
  rs.find((r) => r.id === who)!.interactables!.push(who === 'rg_ok'
    ? { id: 'gt_key', kind: 'gate', pos: { x: 0, y: 0, z: 6 }, setsFlag: KEY }
    : { id: 'gt_key', kind: 'gate', pos: { x: 20, y: 0, z: 6 }, setsFlag: KEY })
  return rs
}
/** 一块 10³ 的裸世界（连 ch_far 的锁与 gt_mid 的旗都拆掉）：剩下所有锁吃的旗都必须由外部名册来写 */
const barePair = (): Row[] => {
  const [a, c] = gatedPair()
  delete (a.interactables!.find((i) => i.id === 'gt_mid') as Item).setsFlag
  delete (a.interactables!.find((i) => i.id === 'ch_far') as Item).requiresFlag
  a.secrets = []
  return [a, c]
}
/** worldstate 的一条规则（`on` 决定它的家怎么找：interactId / dataId / 根本没有位置） */
const ws = (o: Record<string, unknown>): unknown[] => [{ id: 'ws_test', setFlag: KEY, ...o }]

describe('⑥ 每一把锁的钥匙都拿得到（需求 §9「需不需要钥匙」的前半句）', () => {
  it('真表：31 把锁吃的每一面旗，玩家都在不动点里拿得起来，7/7 区开放', () => {
    const carriers = flagCarriers(regions, worldstate, dialogue)
    const locks = lockRoster(regions)
    const reach = unlockReachability(regions, carriers)
    expect(locks.length, '锁名册读空 ⇒ "0 条解不开"是假的：区域 unlockFlag / 交互物 requires / secret / 边，四类都得在场').toBeGreaterThanOrEqual(25)
    expect(carriers.size, '有写方的旗标只剩这么点 ⇒ worldstate 或 dialogue 有一侧没被读').toBeGreaterThanOrEqual(50)
    expect(reach.open.size, `带着锁走图只开放 ${reach.open.size}/${regions.length} 区（${regions.filter((r) => !reach.open.has(String(r.id))).map((r) => r.id).join(' ')} 开不了）`).toBe(regions.length)
    expect(reach.obtainable.size, `62 面有写方的旗里，${carriers.size - reach.obtainable.size} 面玩家拿不起来：${[...carriers.keys()].filter((f) => !reach.obtainable.has(f)).join(' ')}`).toBe(carriers.size)
    const stuck = locks.filter((l) => !l.flags.every((f) => !carriers.has(f) || reach.obtainable.has(f)))
    expect(stuck.map((l) => l.where), `解不开的锁：${stuck.map((l) => `${l.where} 缺 ${l.flags.join(',')}`).join(' ;; ')}`).toEqual([])
    expect(errorsOf(regions, KEYS), '⑥⑦ 在真表上就该一句不响').toEqual([])
  })

  it('旗标的四类来源各有真实的一条：interactable / rule-interact / boss / dialogue / event 少一类就是那一份表没被读', () => {
    const tally = carrierTally(flagCarriers(regions, worldstate, dialogue))
    for (const kind of ['interactable', 'rule-interact', 'boss', 'dialogue', 'event']) {
      expect(tally[kind] ?? 0, `carrier 的 '${kind}' 这一类读到了 ${tally[kind] ?? 0} 条 ⇒ 派生那一份表的代码断了，而 ⑥ 只会把它的旗当成别人的账`).toBeGreaterThan(0)
    }
    expect(Object.values(tally).reduce((a, b) => a + b, 0), 'carrier 条数换了 = 有人在改三份表中的任意一份，上面那五格要一起重量').toBeGreaterThanOrEqual(60)
    // 三种"指不到坐标"的形状今天一条都不许有：它们各自都是 `usable: false`，也就是永远立不起来的旗
    expect(Object.keys(tally).filter((k) => k.endsWith('-dangling') || k.endsWith('-noloc')), `真表上有写方落不到坐标：${JSON.stringify(tally)}`).toEqual([])
  })

  it('没递第二参数 ⇒ 锁吃的旗一个写方都没读到 ⇒ 红「这道门在空转」，而不是安静通过', () => {
    // 这一格的 KEY 只有对话树这一个写方：不递 `dialogue` 就是真的把名册读空（递 worldstate 也救不回来）。
    const dlg = [{ id: 't_key', npc: 'gt_mid', nodes: [{ id: 'n1', effects: { setFlags: [KEY] } }] }]
    expect(errorsOf(barePair(), { worldstate: [] }).map((e) => e.where), '⑥⑦ 的名册必须成对给：少一份就不是"干净"而是"没读到"').toEqual(['worldstate.json+dialogue.json'])
    expect(errorsOf(barePair(), { worldstate: [], dialogue: dlg }), '两份都递 ⇒ 营地开得了解锁这一格该安静').toEqual([])
  })

  it('钥匙写在起始区、唯一的入口付这把钥匙 ⇒ ⑥⑦ 一起安静（合法形状的接受侧）', () => {
    const rs = writerIn(gatedPair(), 'rg_ok')
    const errs = errorsOf(rs)
    expect(errs, `营地靠起始区立起来的钥匙开放，而那条边付着钥匙：${onlyErrs(errs)}`).toEqual([])
    expect(unlockReachability(rs, flagCarriers(rs, undefined, undefined)).open.has('rg_camp'), '不动点没开放营地 ⇒ 上面那句"安静"就不是因为整格没判').toBe(true)
  })

  it('钥匙锁在它自己开的那扇门后面（自锁）⇒ 红两条：区开不了 + 那条付着这把钥匙的边也解不开', () => {
    const errs = errorsOf(writerIn(gatedPair(), 'rg_camp'))
    expect(errs.map((e) => e.where), `自锁要说两处（区本身、以及吃这把钥匙的入口边）：${onlyErrs(errs)}`).toEqual(['rg_camp.unlockFlag', 'rg_ok.interactables(el_up).requires'])
    expect(errs[0].msg).toContain('自锁')
    expect(errs[0].msg, '⑥ 的理由是"先后"，不是"接缝"：⑤ 在这一格仍然是干净的，消息要把这件事说破').toContain('断的是先后顺序而不是接缝')
  })

  it('两区互相等对方的钥匙 ⇒ 各红一条，而消息说的是"那个区本身还没开放"（不是自锁）', () => {
    const [a, c] = gatedPair()
    const deep = camp(20, 0, { x: 40, y: 0, z: 0 })
    deep.id = 'rg_deep'
    deep.unlockFlag = KEY2
    c.interactables!.push({ id: 'gt_key2', kind: 'gate', pos: { x: 20, y: 0, z: 6 }, setsFlag: KEY2 })
    deep.interactables!.push({ id: 'gt_key', kind: 'gate', pos: { x: 40, y: 0, z: 6 }, setsFlag: KEY })
    const errs = errorsOf([a, c, deep])
    expect(errs.map((e) => e.where), `死锁环上的两区各红一条，再加上那条解不开的入口边：${onlyErrs(errs)}`).toEqual(['rg_camp.unlockFlag', 'rg_deep.unlockFlag', 'rg_ok.interactables(el_up).requires'])
    expect(errs[0].msg).toContain('住在 rg_deep（那个区本身还没开放）')
    expect(errs[0].msg, '钥匙的家在别的区，就不是自锁：这一句不许被写进所有 ⑥ 的红里').not.toContain('自锁')
  })

  it('worldstate 的 `interactUsed` 规则按 interactId 落回那一块地：交互物住在营地 ⇒ 同样自锁', () => {
    const rs = gatedPair()
    expect(errorsOf(rs, { worldstate: ws({ on: 'interactUsed', interactId: 'gt_mid' }) }), 'gt_mid 在 rg_ok ⇒ 营地该开得了解锁这一格不该红').toEqual([])
    const errs = errorsOf(rs, { worldstate: ws({ on: 'interactUsed', interactId: 'el_down' }) })
    expect(errs.map((e) => e.where), `el_down 住在营地：规则的家跟着交互物走，所以这一格与"钥匙写在营地里"同一种红：${onlyErrs(errs)}`).toEqual(['rg_camp.unlockFlag', 'rg_ok.interactables(el_up).requires'])
    expect(errs[0].msg).toContain('rule-interact(ws_test) 住在 rg_camp')
  })

  it('规则指的交互物不存在 ⇒ usable:false ⇒「这面旗永远立不起来」，把它当可得就是替数据圆场', () => {
    const errs = errorsOf(gatedPair(), { worldstate: ws({ on: 'interactUsed', interactId: 'no_such_interactable' }) })
    expect(errs.length, '悬空引用必须红，而不是安静通过：⑥ 不许假设表总会自己先红').toBe(2)
    expect(errs[0].msg).toContain('落不到任何坐标')
    expect(errs[0].msg, '报错要端出那个不存在的 id，否则读者得自己去 grep').toContain('no_such_interactable')
    expect(errs[0].msg).toContain('rule-dangling')
  })

  it('`bossDefeated` 按 spawnGroups[].enemyId 找雇主：在几区出怪就住几区，找不到就永远立不起来', () => {
    const rs = gatedPair()
    expect(errorsOf(rs, { worldstate: ws({ on: 'bossDefeated', dataId: 'en_a' }) }), 'en_a 的出怪点在 rg_ok ⇒ 打赢就开门，这一格该安静').toEqual([])
    const inCamp = structuredClone(rs)
    inCamp[1].spawnGroups!.push({ enemyId: 'en_camp', count: 1, center: { x: 20, y: 0, z: -6 } })
    const errs = errorsOf(inCamp, { worldstate: ws({ on: 'bossDefeated', dataId: 'en_camp' }) })
    expect(errs[0].msg, 'Boss 只在营地里出怪，而营地由它开的门锁着 ⇒ 这就是自锁，话术要跟着 boss 这一类说').toContain('boss(ws_test) 住在 rg_camp')
    expect(errorsOf(rs, { worldstate: ws({ on: 'bossDefeated', dataId: 'en_nowhere' }) })[0].msg, '找不到出怪点 ⇒ boss-noloc，不许当成"总会打赢"').toContain('boss-noloc')
  })

  it('`on:\'firstParry\'` 这类没有空间位置的事件按可得处理：这一格量位置与先后，不量"事件会不会发生"', () => {
    const errs = errorsOf(gatedPair(), { worldstate: ws({ on: 'firstParry' }) })
    expect(errs, '全局事件是 regionId:null 而不是 usable:false：把它当拿不到，真表上 flag.parry_taught 那一类就会集体假红').toEqual([])
  })

  it('对话树按 `npc` 落回那块地，节点与**选项**的 setFlags 都算这棵树会立的旗（乐观口径）', () => {
    /** 把 `npc_c` 放到 `who` 那一区，并交回"这棵树会立 KEY"那两份数据 */
    const withTree = (who: 'rg_ok' | 'rg_camp', by: 'node' | 'choice'): { rs: Row[]; dlg: unknown[] } => {
      const rs = gatedPair()
      rs[who === 'rg_ok' ? 0 : 1].interactables!.push(who === 'rg_ok'
        ? { id: 'npc_c', kind: 'npc', pos: { x: -6, y: 0, z: 6 } }
        : { id: 'npc_c', kind: 'npc', pos: { x: 24, y: 0, z: 6 } })
      const effects = { setFlags: [KEY] }
      const node = by === 'node' ? { id: 'n1', effects } : { id: 'n1', choices: [{ id: 'c1', effects }] }
      return { rs, dlg: [{ id: 't_test', npc: 'npc_c', nodes: [node] }] }
    }
    const a = withTree('rg_ok', 'node')
    expect(errorsOf(a.rs, { dialogue: a.dlg }), '树的主人在起始区 ⇒ 营地该开得了解锁这一格不该红').toEqual([])
    const b = withTree('rg_ok', 'choice')
    expect(errorsOf(b.rs, { dialogue: b.dlg }), '选项里的 setFlags 也是这棵树会立的旗：只读节点就会把真表那 34 条当成不存在').toEqual([])
    const c = withTree('rg_camp', 'node')
    const errs = errorsOf(c.rs, { dialogue: c.dlg })
    expect(errs[0].msg, '那棵树的主人在营地里，而营地由它开的门锁着 ⇒ 自锁，话术要跟着 dialogue 这一类说').toContain('dialogue(t_test) 住在 rg_camp')
    const ghost = errorsOf(gatedPair(), { dialogue: [{ id: 't_ghost', npc: 'npc_missing', nodes: [{ id: 'n1', effects: { setFlags: [KEY] } }] }] })
    expect(ghost[0].msg, 'npc 指不到任何 kind:npc 的交互物 ⇒ dialogue-noloc，usable:false，不许当成"总会说到那一句"').toContain('dialogue-noloc')
  })

  it('几何上就走不到的区，⑥-a 不再补一句"钥匙拿不到"：一个根因只说一遍（⑤ 那三句先响，锁在区里的箱子仍说自己解不开）', () => {
    const [a, c] = apartPair()
    c.unlockFlag = KEY
    c.interactables!.push({ id: 'gt_key', kind: 'gate', pos: { x: 220, y: 0, z: 6 }, setsFlag: KEY })
    c.interactables!.push({ id: 'ch_lock', kind: 'chest', pos: { x: 215, y: 0, z: -6 }, requiresFlag: KEY })
    const errs = errorsOf([a, c])
    expect(errs.map((e) => e.where), `走不到（⑤）与拿不到钥匙（⑥）是两个根因，但区域那一格只许 ⑤ 说：${onlyErrs(errs)}`)
      .toEqual(['rg_ok ⇢ rg_camp', 'rg_ok', 'rg_camp', 'rg_camp.interactables(ch_lock).requires'])
  })

  it('锁吃的旗压根没有写方 ⇒ ⑥ 一句不说：那句话归 `ledger-rules.mjs` 的旗标账（两个主人各说半句）', () => {
    const rs = gatedPair()
    expect(lockRoster(rs).map((l) => l.where), '这把锁真的在场，所以下面那句"0 条"不是整格没判').toContain('rg_camp.unlockFlag')
    expect(keyHome(KEY, flagCarriers(rs, undefined, undefined)), 'KEY 没有任何写方 ⇒ 归旗标账，不归这里').toEqual([])
    expect(errorsOf(rs)).toEqual([])
  })
})

describe('⑦ 落进上锁区的边不许无证白送（需求 §9「需不需要钥匙」的后半句）', () => {
  it('不吃钥匙也不是铸钥匙的门 ⇒ 红，并把运行时那句与两个真表修法一起端出来', () => {
    const errs = errorsOf(writerIn(gatedPair(null), 'rg_ok'))
    expect(errs.map((e) => e.where), `营地开着、钥匙在起始区拿得到，而这条边白送 ⇒ 只该红这一条：${onlyErrs(errs)}`).toEqual(['rg_ok.interactables(el_up).to'])
    expect(errs[0].msg, '这句话的后果是运行时的，不是审美的').toContain('Streaming.isRegionUnlocked')
    expect(errs[0].msg, '两个修法各有一条真数据当样子，报错要直接把它们端出来').toContain('el_resthold_well')
    expect(errs[0].msg).toContain('br_brokenbar_gate')
  })

  it('「门就是钥匙的锻造处」这一豁免认的是 setsFlag == 那把钥匙，不是「这条边有 setsFlag」', () => {
    const rs = writerIn(gatedPair(null), 'rg_ok')
    rs[0].interactables![0].setsFlag = KEY
    expect(errorsOf(rs), '边自己立目的区那把钥匙 ⇒ 走过就拿到，不是无证：这一格是 br_brokenbar_gate 的形状').toEqual([])
    rs[0].interactables![0].setsFlag = 'flag.something_else'
    expect(errorsOf(rs).map((e) => e.where), '换成另一面旗：KEY 仍由起始区的写方立得起来 ⇒ 豁免不该跟着走').toEqual(['rg_ok.interactables(el_up).to'])
  })

  it('自环与落点歧义都不归 ⑦ 判：前者没进任何区，后者是② 的一句话', () => {
    const loop = writerIn(gatedPair(null), 'rg_ok')
    loop[0].interactables![0].to = { x: 8, y: 0, z: 8 }
    expect(errorsOf(loop), '落回自己区的捷径（gt_brokenbar_backdoor 就是这一条）不该被 ⑦ 点名').toEqual([])
    const both = writerIn(gatedPair(null), 'rg_ok')
    both[0].interactables![0].to = { x: 10, y: 0, z: 0 } // 正正压在 rg_ok 与 rg_camp 共用的那一面（x=10）上
    const errs = errorsOf(both)
    expect(errs.length, '同一个 where 上不许两句话挤成一坨：② 的红只报一次').toBe(1)
    expect(errs[0].msg).toContain('rg_ok 与 rg_camp')
  })

  it('真表 8 条边的豁免理由各有主人，其中 3 条靠 forbid 关掉起点 —— 这一腿不是死代码', () => {
    const carriers = flagCarriers(regions, worldstate, dialogue)
    const byId = new Map(regions.map((r) => [String(r.id), r]))
    const reasonOf = (e: ReturnType<typeof travelEdges>[number]): string => {
      const owners = regionsContaining(regions, e.to)
      if (owners.length !== 1) return '落点歧义（归②）'
      const key = byId.get(owners[0])?.unlockFlag as string | undefined
      if (typeof key !== 'string' || !carriers.has(key)) return '目的区不上锁（或钥匙归旗标账）'
      if (owners[0] === e.regionId) return '自环'
      if (e.requires.includes(key)) return '付钥匙'
      if (e.setsFlag === key) return '锻造处'
      return unlockReachability(regions, carriers, { forbid: key }).open.has(e.regionId) ? '★真侧门' : '免疫（forbid 关掉起点）'
    }
    const reasons = travelEdges(regions).map(reasonOf)
    expect(reasons.filter((r) => r === '★真侧门'), `无证侧门：${reasons.join(' / ')}`).toEqual([])
    const tally: Record<string, number> = {}
    for (const r of reasons) tally[r] = (tally[r] ?? 0) + 1
    expect(tally, '八条边的豁免分解换了 = 有人改锁或改边：免疫那一腿如果掉到 0，⑦ 就只剩三条静态豁免可说了').toEqual({ 付钥匙: 1, 锻造处: 3, 自环: 1, '免疫（forbid 关掉起点）': 3 })
    const noKey = unlockReachability(regions, carriers, { forbid: 'flag.left_resthold' })
    expect(noKey.open.has('rg_earless_deeps'), '排水斜道那条边靠的就是这句话免掉的：起点区在不拿休垒钥匙时必须关着').toBe(false)
    expect(unlockReachability(regions, carriers).open.has('rg_earless_deeps'), '对照：不禁任何旗时它是开放的（上面那句不是"永远到不了深窖"）').toBe(true)
  })
})

describe('docs/gameplay.md §4.2 那一行 ⇄ 派生名册（需求 §9 Micro: Shortcut）', () => {
  /** 那一行是表格行，所以按 `| Shortcut |` 起头找；找不到就是判据在读空集合 */
  const docLine = (): string => {
    const rows = read('docs/gameplay.md').split('\n').filter((l) => /^\|\s*Shortcut\s*\|/.test(l))
    expect(rows.length, `docs/gameplay.md 里按 "| Shortcut |" 数到 ${rows.length} 行：这一判据的话术与那张表必须同生同死`).toBe(1)
    return rows[0]
  }
  const backticked = (line: string): string[] => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])

  it('条数、id 名册、kind 分解三件事各自与派生相等；哪一件不对就点哪一件', () => {
    const line = docLine()
    const edges = travelEdges(regions)
    const n = line.match(/\|\s*Shortcut\s*\|\s*(\d+)\s*条/)
    expect(n, `那一行必须以「N 条」开头报数（读到的开头是：${line.slice(0, 60)}…）`).not.toBeNull()
    expect(Number(n![1]), '文档报的条数 = 派生名册的条数').toBe(edges.length)

    const ids = backticked(line)
    const roster = edges.map((e) => e.id).sort()
    expect(
      ids.slice().sort(),
      `双向对账（多：${ids.filter((i) => !roster.includes(i)).join(' ')}／少：${roster.filter((r) => !ids.includes(r)).join(' ')}）`,
    ).toEqual(roster)

    const written: Record<string, number> = {}
    for (const m of line.matchAll(/([a-z]+)×(\d+)/g)) written[m[1]] = Number(m[2])
    expect(written, '分解列由 travelKindTally 派生：改了数据没改这一行，红的就是这一行').toEqual(travelKindTally(regions))
  })

  it('那一行反引号里只许住名册的 id：夹进 flag 名或表名也算红（否则行会变长而判据不变严）', () => {
    const tokens = backticked(docLine())
    const roster = new Set(travelEdges(regions).map((e) => e.id))
    expect(tokens.filter((t) => !roster.has(t)), '反引号在这一行是"名册"的记号，不是排版').toEqual([])
    expect(tokens.length, '六个 id 就是这一行的一切反引号条目：token 数必须等于名册数').toBe(travelEdges(regions).length)
  })

  it('旧那句「共鸣井×2/吊桥×2/音壁×2」不是任何数据状态能产出的分解：它不许回来', () => {
    const line = docLine()
    expect(line, `这一行又写回了实测不存在的分解（带 to 的桥只有一条）：${line.slice(0, 80)}…`).not.toContain('吊桥×2')
  })
})

/**
 * 消费端（§55「没有读者的产物就是欠账」）。
 *
 * KI-100 开工时的实测事实是：`scripts/world-graph-rules.mjs` 的**唯一读者是它自己的单元测试**——
 * 全仓库 grep `world-graph-rules` 只命中那份文件顶部那行文档注释。判据写在仓库里却不在门禁里跑，
 * 症状与"这条判据从来没有过"完全一样（KI-093 给 `FILES` ⇄ `validateX()` 那条缝立过同一句话）。
 * 所以这一节不许省：它钉的是"生产真的读了它"，而不是"我写了它"。
 *
 * 三端读数全部从 `validate-data.mjs` 的**源码现推**（`functionBodies`/`assignedLiterals`/`calledNames`，
 * 与 KI-093 同一族抽取器），一份名字都不抄：抄一份 import 清单就等于给"谁读了它"配第二个主人。
 */
describe('消费端：判据在生产里有人读，而它的每一个导出都有读者（§55）', () => {
  const VD = 'scripts/validate-data.mjs'
  const RULES = 'scripts/world-graph-rules.mjs'
  const SELF = 'tests/unit/world-graph.test.ts'

  /** 一份源码里 `import { … } from '<specifier>'` 的具名清单，连同**命中份数**一起交出去（多份也要被看见） */
  const importFrom = (text: string, specifier: string): { count: number; names: string[] } => {
    const esc = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const ms = [...stripComments(text).matchAll(new RegExp(`^import \\{([^}]*)\\} from '${esc}'`, 'gm'))]
    return { count: ms.length, names: ms.flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean)) }
  }

  it('消费端三件都在：那份 import、那个函数、report.error 那个出口（判据不是写给自己看的）', () => {
    const src = read(VD)
    const imp = importFrom(src, './world-graph-rules.mjs')
    expect(imp.count, `从 ${VD} 数到 ${imp.count} 份指向 world-graph-rules 的 import（要恰好 1）：0 份意味着生产里没人读这份判据而门禁全绿，2 份意味着有两个入口`).toBe(1)
    expect(imp.names, '那份 import 的具名清单只许 worldGraphFindings：多一个名字就是生产端还在用判据的别的部位，而那一句没人测').toEqual(['worldGraphFindings'])
    const fn = (functionBodies(src, 'validate') ?? []).find((f) => f.name === 'validateWorldGraph')
    expect(fn, `读不到顶层的 \`function validateWorldGraph()\`（主人：${VD}）⇒ 有 import 却没人调用，与"消费端不存在"等价`).not.toBeUndefined()
    expect(fn!.body, '函数体的花括号配不上对 ⇒ 抽取器在这一格瞎了；这条红不许被读成"它没读表"').not.toBeNull()
    expect(assignedLiterals(fn!.body!, 'file'), '它报的是哪一张表（`const file = …`）由函数体自己说').toEqual(['regions.json'])
    expect(fn!.body!, '递给判据的必须是它报告的那一张：`data[file]` 或 `data[\'regions.json\']` 二选一').toMatch(/data\[(file|'regions\.json')\]/)
    expect(fn!.body, '这张表要交给判据本体，而不是在这里重抄一遍判据').toContain('worldGraphFindings(')
    expect(fn!.body, '几何问题必须让门禁失败：这一段的出口只有 `report.error`').toContain('report.error(')
    expect(fn!.body, '降级成 `report.warn` ＝ 世界图塌了也照样出货；判据哪天真要出 WARN，这条会先红着提醒改两处').not.toContain('report.warn(')
  })

  it('主循环真的有 `validateWorldGraph()` 那一处调用（写了函数而没人叫，等于一整道门哑掉）', () => {
    const calls = calledNames(read(VD), 'validate')
    expect(calls, `从 ${VD} 读不到任何 \`validateX(\` 调用 ⇒ 抽取器瞎了；null 与"少了这一个"是两件事，别把前者报成后者`).not.toBeNull()
    expect(calls!.includes('validateWorldGraph'), `主循环调用的是这些：${calls!.join(' ')}；validateWorldGraph 不在里面 ⇒ 声明存在但不跑`).toBe(true)
  })

  it('消费端把两份名册一起递了过去：⑥⑦ 认的就是 `worldstate.json` 与 `dialogue.json` 这两个名字（§55 的第二半）', () => {
    const fn = (functionBodies(read(VD), 'validate') ?? []).find((f) => f.name === 'validateWorldGraph')
    expect(fn, '读不到 `validateWorldGraph()` ⇒ 这一格谈不上"递没递第二参数"').not.toBeUndefined()
    expect(fn!.body, '第二参数必须成对给两份名册：只递一张，另一张的写方就在判据里凭空消失（真表 30 棵对话树 + 6 条规则）').toMatch(
      /worldGraphFindings\([^)]*\{\s*worldstate:\s*data\['worldstate\.json'\]\s*,\s*dialogue:\s*data\['dialogue\.json'\]\s*\}/)
    // 反向：判据本体在没有第二参数时**必须**红，而不是安静（否则这一格递不递都一样）
    const rs = barePair()
    expect(errorsOf(rs).map((e) => e.where),
      '不递名册 ⇒ ⑥⑦ 该喊"门在空转"；这条不红，上面那句静态匹配就只是排版检查').toEqual(['worldstate.json+dialogue.json'])
    expect(errorsOf(rs, { worldstate: [], dialogue: [{ id: 't_key', npc: 'gt_mid', nodes: [{ id: 'n1', effects: { setFlags: [KEY] } }] }] }))
      .toEqual([])
  })

  it('判据本体的每一个导出都至少有一个读者：没人读的那一格就是 §55 的欠账', () => {
    const names = [...new Set([...stripComments(read(RULES)).matchAll(/^export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))]
    expect(names.length, `从 ${RULES} 读不到任何 \`export function/const\` ⇒ 门在空转：声明的形状换了，还是这份文件空了？`).toBeGreaterThan(0)
    const readers = {
      [VD]: importFrom(read(VD), './world-graph-rules.mjs').names,
      [SELF]: importFrom(read(SELF), '../../scripts/world-graph-rules.mjs').names,
    }
    // 自证：总体里至少要有两条已知的边，否则"没有孤儿"可能只是两个读者的名单都读空了
    for (const known of ['worldGraphFindings', 'travelEdges']) {
      expect(Object.values(readers).flat(), `名册自证：${known} 今天必须有读者（读不到说明这两份 import 都空了）`).toContain(known)
    }
    const orphan = names.filter((n) => !readers[VD].includes(n) && !readers[SELF].includes(n))
    expect(orphan, `这些导出没有任何一份 import 具名清单收它：${orphan.join(' ')} ⇒ 写它的人以为它还在场上`).toEqual([])
  })

  it('`.d.mts` 的名单与 `.mjs` 的导出名单逐条相等：少一条就是 TS 那边看不见它，多一条就是声明在撒谎', () => {
    const declared = (text: string): string[] =>
      [...new Set([...stripComments(text).matchAll(/^export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))].sort()
    const mjs = declared(read(RULES))
    const dts = declared(read(RULES.replace(/\.mjs$/, '.d.mts')))
    expect(mjs.length, `${RULES} 一条导出都没读到 ⇒ 这条判据在看一个空集合，相等是假的`).toBeGreaterThan(0)
    expect(dts.length, `${RULES} 那份 .d.mts 一条声明都没读到 ⇒ 同上：形状换了还是文件空了？`).toBeGreaterThan(0)
    const missing = mjs.filter((n) => !dts.includes(n))
    const ghost = dts.filter((n) => !mjs.includes(n))
    expect(missing, `.mjs 导出了而 .d.mts 没声明：${missing.join(' ')} ⇒ 测试里用它是 TS 报错，而门禁照跑`).toEqual([])
    expect(ghost, `.d.mts 声明了而 .mjs 没有：${ghost.join(' ')} ⇒ 那份声明在描述一个不存在的部位`).toEqual([])
  })
})
