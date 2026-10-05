/** `world-graph-rules.mjs` 的声明：判据住 .mjs（校验脚本要能被 node 直接跑），测试要能被 `tsc --noEmit` 检查。 */

/** 校验器报告里那一行的形状（与 `ambience-rules.d.mts` 同一约定） */
export interface WorldGraphFinding {
  level: 'error' | 'warn'
  file: string
  where: string
  msg: string
}

/** 一条通行器边：`regions.json` 里带 `to` 的交互物，`requires` 已按运行时的 secretId 派生算过 */
export interface TravelEdge {
  regionId: string
  id: string
  kind: string
  pos: unknown
  to: { x: number; y: number; z: number }
  oneWay: boolean
  requires: string[]
  setsFlag: string | null
}

/** 一个被标注的点（水平 xz + 竖直 y），tag 用它自己的路径说话 */
export interface AnchorPoint {
  x: number
  y: number
  z: number
  tag: string
}

/** 通行器名册：唯一的准入判据是「带 `to`」，不是 kind 属于某几个类 */
export function travelEdges(regions: unknown): TravelEdge[]
/** 这个点落进哪些区域的 bounds（0 / 1 / 多都是信息，由调用方决定怎么说） */
export function regionsContaining(regions: unknown, p: unknown): string[]
/** 一个区域的锚点：interactables/landmarks/secrets 的 pos + spawnGroups 的 center */
export function anchorPoints(region: unknown): AnchorPoint[]
/** 四类锚点各有几个点：判据读的总体不许是空的，这张计数就是它的自证 */
export function anchorSources(regions: unknown): Record<'interactables.pos' | 'landmarks.pos' | 'secrets.pos' | 'spawnGroups.center', number>
/** 水平投影上的最大三角形面积；0 ⇒ 全部共线，点数不足 3 时同样是 0（由调用方分开报） */
export function maxTriangleAreaXZ(points: unknown): number
/** kind → 条数（文档那一行的分解列唯一的主人） */
export function travelKindTally(regions: unknown): Record<string, number>
/** 两块区域盒子的接触分类：共面是合法接缝，共体（`overlap`）让归属变成数组顺序的函数 */
export interface BoxContact {
  a: string
  b: string
  kind: 'overlap' | 'face' | 'edge' | 'corner'
  /** 公共体积（m³）；`kind !== 'overlap'` 时恒为 0 */
  vol: number
  span: { x: [number, number]; y: [number, number]; z: [number, number] }
}
/** 所有**不相离**的区域对（共面/共棱/共点/共体都进来）；离得远的对不出现，所以总体非空要由调用方自己钉 */
export function boxContacts(regions: unknown): BoxContact[]
/** ⑤ 的读数：起始区（order 最小者，派生）、走不到的区、一条出路都没有的区，外加每区的出路明细与接缝条数 */
export interface MacroReading {
  start: string | null
  /** 有名字也有 bounds 的区域条数：不足 2 时 ⑤ 整格不判（"之间"无从谈起），由调用方分开说 */
  regionCount: number
  unreachable: string[]
  deadEnds: { id: string; near: string[] }[]
  exits: Map<string, { seams: string[]; out: string[]; total: number }>
  seamCount: number
}
export function macroConnectivity(regions: unknown): MacroReading
/** 五条判据的 findings；入参非数组或为空时不抛，改成一条 error */
export function worldGraphFindings(regions: unknown): WorldGraphFinding[]
