/**
 * 区域 chunk 流送（technical-architecture §5.5，需求 §50/§65）。
 * 3D cell 网格（World Partition 近似）：水平相邻与垂直跨层走同一套距离规则。
 * 本文件禁止 import three —— 渲染层只订阅 'world.chunk' 事件按 state 挂载/卸载子场景。
 */
import { bus } from '@/core/EventBus'
import type { RegionData, Vec3 } from '@/data/schema'

import { TRANSITION_HALF_M, TRANSITION_SEAM_W } from './Lighting'

export type ChunkState = 'unloaded' | 'preloading' | 'resident' | 'active'

/** §2 跨区过渡带的读数（`StreamingSystem.paletteBlendAt`） */
export interface PaletteBlend {
  /** 玩家此刻所在的那一区（`regionAt` 的答案） */
  from: RegionData
  /** 带子另一侧的那个邻区 */
  to: RegionData
  /** 邻居 `to` 的占比：0 = 带子外缘（全是 `from`），`TRANSITION_SEAM_W` = 站在接缝上（两区各半） */
  t: number
}

/**
 * 两个区的 AABB 相贴判定容差。0 就够（今天的 bounds 全是精确相接），留一点余量是为了
 * 让手工改 bounds 时差 1e-9 不至于让一条过渡带静默消失——那种消失没有任何东西会报。
 */
const REGION_ADJACENCY_EPS = 1e-6

export interface StreamingOptions {
  /** ring（cell 单位的 Chebyshev 距离）内为玩法激活格 */
  activateRing: number
  /** 预载圈（§5.5「2 圈预载」）：与激活圈共用一条加载队列，只到 resident 态 */
  preloadRing: number
  /** 卸载圈（§5.5「3 圈卸载」）：超出该圈且持续 unloadDebounceTicks 才卸载 */
  unloadRing: number
  /** 2s @60Hz */
  unloadDebounceTicks: number
  /** 单格加载的模拟异步开销（逻辑 tick） */
  loadTicks: number
  /** §5.4 预算：in-flight ≤4 */
  maxInFlight: number
  /** boss arena「整场预载」的观察圈 = unloadRing + 本值 */
  wholeFieldPreloadRings: number
}

export const DEFAULT_OPTIONS: StreamingOptions = {
  activateRing: 1,
  preloadRing: 2,
  unloadRing: 3,
  unloadDebounceTicks: 120,
  loadTicks: 3,
  maxInFlight: 4,
  wholeFieldPreloadRings: 2,
}

/** §5.5 优先级「剧情触发区 > boss arena > 地表 > 地下」= 区域基准分 + 格内加成 */
export const PRIORITY = {
  storyInteractable: 50,
  camp: 20,
  encounter: 10,
  secret: 10,
  bossArenaRegion: 100,
}

export interface Chunk {
  readonly key: string
  readonly regionId: string
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly center: Vec3
  readonly priority: number
  state: ChunkState
  /** unloaded 时 >0 表示「在队待加载」；preloading 时表示剩余加载 tick */
  loadTicksLeft: number
  outsideSince: number | null
  visited: boolean
}

type Cell = { cx: number; cy: number; cz: number }

const STORY_KINDS = new Set(['checkpoint', 'elevator', 'soundwall', 'bridge', 'npc', 'teleport'])

const keyOf = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`
/** 格键格式对外一致（SpawnDirector 用它把 spawn 组归到所属格） */
export { keyOf as chunkKeyOf }
const ringOf = (a: Cell, b: Cell): number =>
  Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy), Math.abs(a.cz - b.cz))

export class StreamingSystem {
  readonly chunkSize: number
  readonly options: StreamingOptions
  readonly regions: readonly RegionData[]
  private readonly chunks = new Map<string, Chunk>()
  private readonly explored = new Set<string>()
  private readonly flags = new Set<string>()
  private window = new Map<string, Candidate>()
  private playerCell: Cell = { cx: NaN, cy: NaN, cz: NaN }

  constructor(regions: readonly RegionData[], options?: Partial<StreamingOptions>) {
    const sizes = new Set(regions.map((r) => r.chunkSize))
    if (sizes.size !== 1) throw new Error(`Streaming: regions disagree on chunkSize (${[...sizes].join(',')})`)
    this.regions = regions
    this.chunkSize = [...sizes][0]
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.offFlag = bus.on('world.flag', (f) => {
      const truthy = f.value !== false && f.value !== 0 && f.value !== ''
      if (truthy) { if (!this.flags.has(f.key)) { this.flags.add(f.key); this.invalidate() } }
      else if (this.flags.delete(f.key)) this.invalidate()
    })
  }
  private readonly offFlag: () => void

  dispose(): void { this.offFlag() }

  /* ---------------------------- 查询 ---------------------------- */

  cellOf(pos: Vec3): Cell {
    return {
      cx: Math.floor(pos.x / this.chunkSize),
      cy: Math.floor(pos.y / this.chunkSize),
      cz: Math.floor(pos.z / this.chunkSize),
    }
  }

  regionAt(pos: Vec3): RegionData | null {
    for (const r of this.regions) if (containsPos(r, pos)) return r
    return null
  }

  /**
   * §2 跨区过渡带：这一个坐标上的**色板混合**（`{ from, to, t }`）。
   *
   * 文档原句（art-direction §2）：「跨区过渡带（如钟坠院→深窖）色板按 70/30→30/70 线性混合，
   * 过渡长度 ≥ 150m，禁止硬切」。落地口径见 `world/Lighting.ts > TRANSITION_HALF_M` 的裁决注：
   * 带子以接缝为中线向两侧各探 200m，邻居权重从外缘 0 爬到接缝 0.5，于是 70/30 与 30/70 相距 160m。
   *
   * 三个必须讲清的口径：
   * ① **只有共面接缝的区才参与**（AABB 恰一条轴相贴、另两条重叠，见 `borderDistance`）。隔着一整个区的两个地方
   *    不该互相染色——那是"隔山配色"，不是过渡带。
   * ② **只朝最近的那一个邻区混**。同时贴两条边界时（例如休垒的东北角），混两个邻居会得到第三个
   *    谁也没调过的颜色；取最近的那个，平手按 `regions.json` 的行序（确定性，不靠 Map 迭代顺序）。
   * ③ 不在带子里（离每条边界都超过半宽）⇒ 返回 null = 不混合，读 `regionAt` 那一行就够。
   */
  paletteBlendAt(pos: Vec3): PaletteBlend | null {
    const here = this.regionAt(pos)
    if (!here) return null
    let best: { to: RegionData; dist: number } | null = null
    for (const other of this.regions) {
      if (other.id === here.id) continue
      const d = borderDistance(here, other, pos)
      if (d === null || d > TRANSITION_HALF_M) continue
      // 严格小于才替换：平手时保留行序在前的那个（确定性）
      if (!best || d < best.dist) best = { to: other, dist: d }
    }
    if (!best) return null
    // t = 邻居 `to` 的占比：接缝上 0.5（两区各半），带子外缘 0（全是 `from`）
    return { from: here, to: best.to, t: TRANSITION_SEAM_W * (1 - best.dist / TRANSITION_HALF_M) }
  }

  /** 前置 flag 未满足的区域不参与流送（也就不可能被 spawn/渲染） */
  isRegionUnlocked(region: RegionData): boolean {
    return region.unlockFlag === undefined || this.flags.has(region.unlockFlag)
  }

  hasFlag(key: string): boolean { return this.flags.has(key) }
  /** 存档用：当前置位的 flag 名（区域解锁由这些 flag 推导，所以只需要存它们） */
  flagKeys(): string[] { return [...this.flags].sort() }

  /**
   * 写 flag 的**唯一路径就是 bus `world.flag`**（这里也走它，不开第二条）。
   * 之前这里是"直接登记，正式路径走 bus"——两句话合起来的意思是存在两套缓存：
   * 存档 `apply()` 只调了这个直投口，于是读档后流送层认为旗标立了、交互层却还认为没立
   * （表现为：音壁早已裂开，读档后箱子仍说"上着锁"）。emit 之后两个系统各自更新自己的缓存。
   */
  setFlag(key: string, on = true): void {
    bus.emit('world.flag', { key, value: on })
  }

  chunkAt(pos: Vec3): Chunk | null {
    const c = this.cellOf(pos)
    return this.chunks.get(keyOf(c.cx, c.cy, c.cz)) ?? null
  }

  all(): Chunk[] { return [...this.chunks.values()] }
  byState(state: ChunkState): Chunk[] { return this.all().filter((c) => c.state === state) }
  get activeCount(): number { return this.byState('active').length }
  get inFlight(): number { return this.byState('preloading').length }

  /** 地图「已探索遮罩」（需求 §43）：cell key 集合 */
  get exploredCount(): number { return this.explored.size }
  isExplored(pos: Vec3): boolean {
    const c = this.cellOf(pos)
    const key = keyOf(c.cx, c.cy, c.cz)
    return this.explored.has(key) || this.chunks.get(key)?.visited === true
  }

  stats(): Record<ChunkState | 'loaded' | 'queued' | 'inFlight', number> {
    const s = { unloaded: 0, preloading: 0, resident: 0, active: 0, queued: 0 }
    for (const c of this.chunks.values()) {
      s[c.state]++
      if (c.state === 'unloaded' && this.window.has(c.key)) s.queued++
    }
    return { ...s, loaded: s.preloading + s.resident + s.active, inFlight: s.preloading }
  }

  /* ---------------------------- 推进 ---------------------------- */

  /** 每逻辑 tick 调用。窗口只在玩家跨格（或区域解锁）时重算，其余 tick 只走计时器。 */
  update(tick: number, playerPos: Vec3): void {
    const cell = this.cellOf(playerPos)
    if (ringOf(cell, this.playerCell) !== 0) this.rebuildWindow(cell, tick)
    this.reconcileStates(tick)
    this.advanceLoads(tick)
    this.advanceUnloads(tick)
  }

  /** 传送：激活环强制同步加载 + 取消在飞的防抖卸载（渲染层负责黑屏遮蔽） */
  teleport(tick: number, playerPos: Vec3): void {
    const cell = this.cellOf(playerPos)
    this.rebuildWindow(cell, tick)
    this.reconcileStates(tick) // 先把上一层的激活格降级，保证 active 集合始终只含玩家近邻
    for (const cand of this.window.values()) {
      if (cand.ring > this.options.activateRing) continue
      const chunk = this.ensure(cand)
      chunk.loadTicksLeft = 0
      this.setState(chunk, 'active', tick)
    }
    bus.emit('log', { level: 'info', msg: `stream.teleport -> cell ${cell.cx},${cell.cy},${cell.cz}` })
  }

  /** 强制重算窗口 */
  invalidate(): void { this.playerCell = { cx: NaN, cy: NaN, cz: NaN } }

  /* ---------------------------- 内部 ---------------------------- */

  private rebuildWindow(cell: Cell, tick: number): void {
    this.playerCell = cell
    this.window = new Map()
    for (const cand of this.computeCandidates(cell)) this.window.set(keyOf(cand.cx, cand.cy, cand.cz), cand)
    for (const cand of this.window.values()) this.ensure(cand).outsideSince = null
    for (const [key, chunk] of this.chunks) {
      if (chunk.state === 'unloaded') continue
      if (!this.window.has(key) && chunk.outsideSince === null) chunk.outsideSince = tick
    }
  }

  /** 跨格后：出激活圈的 active 立即降级 resident（离窗也一样），进激活圈的 resident 直接激活（无需重载） */
  private reconcileStates(tick: number): void {
    for (const c of this.chunks.values()) {
      const ring = ringOf({ cx: c.cx, cy: c.cy, cz: c.cz }, this.playerCell)
      if (ring > this.options.activateRing) {
        if (c.state === 'active') this.setState(c, 'resident', tick)
      } else if (c.state === 'resident' && this.window.has(c.key)) {
        this.setState(c, 'active', tick)
      }
    }
  }

  private computeCandidates(cell: Cell): Candidate[] {
    const { unloadRing, wholeFieldPreloadRings } = this.options
    const out: Candidate[] = []
    const consider = (c: Cell): void => {
      const center = this.cellCenter(c)
      const region = this.regionAt(center)
      if (!region || !this.isRegionUnlocked(region)) return
      out.push({ ...c, region, ring: ringOf(c, cell), dist: euclid(c, cell), priority: this.priorityOf(region, c) })
    }
    const R = Math.max(unloadRing, this.options.preloadRing)
    for (let dx = -R; dx <= R; dx++) {
      for (let dy = -R; dy <= R; dy++) {
        for (let dz = -R; dz <= R; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) > R) continue
          consider({ cx: cell.cx + dx, cy: cell.cy + dy, cz: cell.cz + dz })
        }
      }
    }
    // boss arena「提前预载整场」：进入观察圈后，其全部格子入候选（ring 大 ⇒ 排在队尾，不抢近处配额）
    const watchRing = R + wholeFieldPreloadRings
    for (const r of this.regions) {
      if (!r.preloadWhole || !this.isRegionUnlocked(r)) continue
      const lo = this.cellOf({ x: r.bounds.minX, y: r.bounds.minY, z: r.bounds.minZ })
      const hi = this.cellOf({ x: r.bounds.maxX - 1e-3, y: r.bounds.maxY - 1e-3, z: r.bounds.maxZ - 1e-3 })
      if (ringOf({ cx: hi.cx, cy: hi.cy, cz: hi.cz }, cell) > watchRing && ringOf(lo, cell) > watchRing) continue
      for (let cx = lo.cx; cx <= hi.cx; cx++) {
        for (let cy = lo.cy; cy <= hi.cy; cy++) {
          for (let cz = lo.cz; cz <= hi.cz; cz++) {
            const c = { cx, cy, cz }
            const ring = ringOf(c, cell)
            if (ring <= R || ring > watchRing) continue // 常规窗口已覆盖 / 超出观察圈
            if (this.regionAt(this.cellCenter(c))?.id !== r.id) continue
            consider(c)
          }
        }
      }
    }
    out.sort((a, b) => a.ring - b.ring || b.priority - a.priority || a.dist - b.dist)
    return out
  }

  /** 加载顺序分：区域基准 + 格内内容加成 */
  private priorityOf(region: RegionData, cell: Cell): number {
    let p = region.streamingPriority
    if (region.preloadWhole) p += PRIORITY.bossArenaRegion
    const inCell = (pos: Vec3): boolean => {
      const c = this.cellOf(pos)
      return c.cx === cell.cx && c.cy === cell.cy && c.cz === cell.cz
    }
    for (const g of region.spawnGroups) if (inCell(g.center)) p += g.campId ? PRIORITY.camp : PRIORITY.encounter
    for (const s of region.secrets) if (inCell(s.pos)) p += PRIORITY.secret
    for (const it of region.interactables) if (inCell(it.pos) && STORY_KINDS.has(it.kind)) return p + PRIORITY.storyInteractable
    return p
  }

  private advanceLoads(tick: number): void {
    for (const c of this.chunks.values()) {
      if (c.state !== 'preloading') continue
      c.loadTicksLeft--
      if (c.loadTicksLeft > 0) continue
      const ring = ringOf({ cx: c.cx, cy: c.cy, cz: c.cz }, this.playerCell)
      this.setState(c, ring <= this.options.activateRing ? 'active' : 'resident', tick)
    }
    let budget = this.options.maxInFlight - this.inFlight
    if (budget <= 0) return
    const queued = this.all()
      .filter((c) => c.state === 'unloaded' && this.window.has(c.key))
      .sort((a, b) =>
        ringOf({ cx: a.cx, cy: a.cy, cz: a.cz }, this.playerCell) - ringOf({ cx: b.cx, cy: b.cy, cz: b.cz }, this.playerCell) ||
        b.priority - a.priority)
    for (const c of queued) {
      if (budget-- <= 0) break
      this.setState(c, 'preloading', tick)
    }
  }

  private advanceUnloads(tick: number): void {
    const { unloadDebounceTicks } = this.options
    for (const c of this.chunks.values()) {
      if (c.state === 'unloaded') continue
      // 窗口已编码「3 圈卸载 + boss arena 观察圈」，出窗即进入防抖，不再重复判圈
      const outside = !this.window.has(c.key)
      if (!outside) { c.outsideSince = null; continue }
      if (c.outsideSince === null) c.outsideSince = tick
      else if (tick - c.outsideSince >= unloadDebounceTicks) this.setState(c, 'unloaded', tick)
    }
  }

  private cellCenter(c: Cell): Vec3 {
    const h = this.chunkSize / 2
    return { x: c.cx * this.chunkSize + h, y: c.cy * this.chunkSize + h, z: c.cz * this.chunkSize + h }
  }

  private ensure(cand: Candidate): Chunk {
    const key = keyOf(cand.cx, cand.cy, cand.cz)
    let c = this.chunks.get(key)
    if (!c) {
      c = {
        key,
        regionId: cand.region.id,
        cx: cand.cx,
        cy: cand.cy,
        cz: cand.cz,
        center: this.cellCenter(cand),
        priority: cand.priority,
        state: 'unloaded',
        loadTicksLeft: 0,
        outsideSince: null,
        visited: false,
      }
      this.chunks.set(key, c)
    }
    return c
  }

  private setState(c: Chunk, state: ChunkState, tick: number): void {
    if (c.state === state) return
    c.state = state
    c.loadTicksLeft = state === 'preloading' ? this.options.loadTicks : 0
    if (state === 'unloaded') {
      // 卸载即从活跃表摘除，防止长时间游玩/传送压力测试下的内存增长（需求 §50）
      if (c.visited || this.isPlayerCell(c)) this.explored.add(c.key)
      this.chunks.delete(c.key)
    } else if (this.isPlayerCell(c)) {
      c.visited = true
    }
    bus.emit('world.chunk', {
      key: c.key, regionId: c.regionId, cx: c.cx, cy: c.cy, cz: c.cz,
      center: c.center, state, priority: c.priority, tick,
    })
  }

  private isPlayerCell(c: Chunk): boolean {
    return c.cx === this.playerCell.cx && c.cy === this.playerCell.cy && c.cz === this.playerCell.cz
  }

  /**
   * §5.5 测试矩阵「流送后 1s 内无 MissingRef 警告」的数据侧前提：
   * 校验区域引用的敌人/掉落表/导航网格确实注册。渲染层可注入自己的判定。
   */
  static collectMissingRefs(regions: readonly RegionData[], isKnown: (id: string) => boolean): string[] {
    const missing: string[] = []
    const check = (where: string, id: string | undefined): void => {
      if (id !== undefined && !isKnown(id)) missing.push(`${where} -> ${id}`)
    }
    for (const r of regions) {
      for (const g of r.spawnGroups) check(`${r.id}.spawnGroups`, g.enemyId)
      for (const s of r.secrets) check(`${r.id}.secrets`, s.rewardTable)
      check(`${r.id}.navmeshRef`, r.navmeshRef)
    }
    return missing
  }
}

interface Candidate extends Cell {
  region: RegionData
  ring: number
  dist: number
  priority: number
}

/**
 * `pos` 到「`here` 与 `other` 共用那张边界面」的距离；两区不共面返回 null。
 *
 * 只在**共面接缝**上有定义：恰一条轴相贴（gap≈0）、另两条轴重叠。距离 = 到共用面的欧氏距离——
 * 相贴轴量到接缝面的垂距，重叠轴量到重叠区间的距离（落在重叠里时该项为 0）。于是站在接缝上恒为 0，
 * 往自己区里走距离线性增长，过渡带的权重才有单调的读数可依。共棱(2)/共点(3)/共体(0)都没有一张可跨的面，
 * 一律返回 null——这与 `scripts/world-graph-rules.mjs > boxContacts` 的 `kind === 'face'` 是同一份名单。
 */
function borderDistance(here: RegionData, other: RegionData, pos: Vec3): number | null {
  const a = here.bounds
  const b = other.bounds
  const axes: Array<['x' | 'y' | 'z', number, number, number, number]> = [
    ['x', a.minX, a.maxX, b.minX, b.maxX],
    ['y', a.minY, a.maxY, b.minY, b.maxY],
    ['z', a.minZ, a.maxZ, b.minZ, b.maxZ],
  ]
  let sum = 0
  let touching = 0
  for (const [axis, aMin, aMax, bMin, bMax] of axes) {
    const gap = Math.max(aMin, bMin) - Math.min(aMax, bMax) // <0 重叠 / ≈0 相贴 / >0 相隔
    if (gap > REGION_ADJACENCY_EPS) return null // 这条轴上两区还隔着一段 ⇒ 根本不相邻
    const v = pos[axis]
    if (Math.abs(gap) <= REGION_ADJACENCY_EPS) {
      // 相贴轴：接缝面就在这儿。玩家在自己那一侧，量到接缝面的垂距。
      touching++
      const seam = aMax <= bMin + REGION_ADJACENCY_EPS ? aMax : aMin
      sum += (v - seam) ** 2
    } else {
      // 重叠轴：量到共享重叠区间的距离（落在重叠里时这项为 0）
      const ovLo = Math.max(aMin, bMin)
      const ovHi = Math.min(aMax, bMax)
      if (v < ovLo) sum += (ovLo - v) ** 2
      else if (v > ovHi) sum += (v - ovHi) ** 2
    }
  }
  // 只有「恰一条轴相贴、另两条重叠」才是共面接缝（有面可跨）。共棱(2)/共点(3)/共体(0)都没有
  // 一条走得过去的缝，一律不算相邻。
  if (touching !== 1) return null
  return Math.sqrt(sum)
}

function containsPos(r: RegionData, pos: Vec3): boolean {
  const b = r.bounds
  return pos.x >= b.minX && pos.x < b.maxX && pos.y >= b.minY && pos.y < b.maxY && pos.z >= b.minZ && pos.z < b.maxZ
}

function euclid(a: Cell, b: Cell): number {
  const dx = a.cx - b.cx, dy = a.cy - b.cy, dz = a.cz - b.cz
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
