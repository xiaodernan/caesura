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
 * 刻意不在这里判的：`vec3` 三格是不是有限数、`min <= max`、kind 的枚举、secretId 的引用完整性——
 * 那些 `validate-data.mjs` 全场统一管，搬过来等于给同一句话配第二个主人（KI-083 立的分工）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assignedLiterals, calledNames, functionBodies, stripComments } from '../../scripts/schema-vocab.mjs'
import {
  anchorPoints, anchorSources, boxContacts, macroConnectivity, maxTriangleAreaXZ, regionsContaining, travelEdges, travelKindTally, worldGraphFindings,
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
const errorsOf = (rs: unknown): Finding[] => worldGraphFindings(rs).filter((f) => f.level === 'error')
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
  it('regions.json 五条判据一个 error 都没有——而这句话的分母是 7 个区域、113 个锚点、8 条通行器边、21 对盒子', () => {
    const errs = errorsOf(regions)
    const tally = anchorSources(regions)
    expect(errs, `世界图判据在真表上红了：\n${onlyErrs(errs)}`).toEqual([])
    for (const [k, v] of Object.entries(tally)) {
      expect(v, `锚点名册的「${k}」只剩 ${v} 个：字段名改过而判据还在读旧的那一个，总体就会这样安静地缩小`).toBeGreaterThan(0)
    }
    expect(tally['spawnGroups.center'], '出怪点一共 23 组，全带 center；这一格掉到 20 以下就是有人把出怪几何改了').toBeGreaterThanOrEqual(20)
    expect(travelEdges(regions).length, '一条通行器都没有就不是"干净的总体"，是没读到东西').toBeGreaterThanOrEqual(3)
    expect(regions.length, '区域数掉下去 = 名册被谁摘走一个，五条判据同时缩').toBeGreaterThanOrEqual(5)
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
    expect(errs.map((e) => e.where), `没有起点时不许报"全都可达"，也不许逐区报死胡同（那是同一件事的 N 遍）：${onlyErrs(errs)}`).toEqual(['regions.json'])
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
