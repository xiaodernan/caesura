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
/**
 * 一面旗的一个写方（"钥匙的家"）。`regionId: null` = 这句话没有空间位置（全局事件，或下面三种悬空引用）；
 * `usable: false` 只给 `rule-dangling` / `boss-noloc` / `dialogue-noloc`——引用落不到坐标 ⇒ 这面旗永远立不起来，
 * 把它当可得就是替数据圆场。`requires` 是这个写方自己吃的旗（钥匙套钥匙那一格）。
 */
export interface Carrier {
  kind: 'interactable' | 'rule-interact' | 'boss' | 'event' | 'rule-dangling' | 'boss-noloc' | 'dialogue' | 'dialogue-noloc'
  id: string
  regionId: string | null
  requires: string[]
  usable?: boolean
  /** 悬空引用那一格：它指向的那个 id（interactId / dataId / npc），报错时要说出来 */
  via?: string
}
/** 旗标 → 它的写方名册；`regions.json` + `worldstate.json` + `dialogue.json` 三份一起才推得出这张图 */
export function flagCarriers(regions: unknown, worldstate: unknown, dialogue: unknown): Map<string, Carrier[]>
/** carrier 的来源分解：kind → 条数（⑥ 的总体自证与文档那一行的唯一主人） */
export function carrierTally(carriers: Map<string, Carrier[]>): Record<string, number>
/** 一面旗的"家"：它的全部写方，一个都没有就是 `[]`（那句归旗标账，不归 ⑥ 说） */
export function keyHome(flag: string, carriers: Map<string, Carrier[]>): Carrier[]
/** 一把锁：谁被什么挡住。`kind` 决定它在报错里怎么说自己 */
export interface Lock {
  where: string
  kind: 'region' | 'interactable' | 'edge' | 'secret'
  regionId: string
  id: string
  flags: string[]
}
/** 锁名册：区域 unlockFlag + 交互物/边的 `requiresOf`（含 secretId 派生）+ secrets[].unlockFlag */
export function lockRoster(regions: unknown): Lock[]
/** 带着锁走一遍图的不动点读数 */
export interface UnlockReading {
  start: string | null
  open: Set<string>
  obtainable: Set<string>
  regionCount: number
  flagCount: number
}
/** ⑥ 的主体；`opts.forbid` 让 ⑦ 问第二个问题（「永远不拿着这面旗，玩家还能站到哪些区」） */
export function unlockReachability(regions: unknown, carriers: Map<string, Carrier[]>, opts?: { forbid?: string | null }): UnlockReading
/** 七条判据的 findings；入参非数组或为空时不抛，改成一条 error。`keys` 缺省时 ⑥⑦ 只能报「名册读空」 */
export function worldGraphFindings(regions: unknown, keys?: { worldstate?: unknown; dialogue?: unknown }): WorldGraphFinding[]
