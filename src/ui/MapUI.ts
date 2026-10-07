import type { UiIntent } from '@/core/Input'
import type { RegionData, Vec3 } from '@/data/schema'
import { PANEL_CSS } from '@/ui/Stakerite'

/**
 * 区域图（需求 §43）——**TD-002 的结案落点**：`map` 这个虚拟按钮从此开的是地图，
 * 不再是调音桩/商摊面板（「按着地图的名字在调音」那笔账）。
 *
 * 它只做三件事，每一件都从注入的闭包现读，自己不养第二份事实：
 *   ① **几何与名字**全来自 `regions.json`（`bounds / displayName / palette / grid / landmarks`）——
 *      面板里没有一个手抄的区名或坐标（`map-ui.test.ts` 有一条源码门钉着这件事）；
 *   ② **「踏足」只有一个读数**：`StreamingSystem.isExplored`（探索遮罩的真主人，需求 §43
 *      「探索应该逐渐揭示地图」）。区域是几百米的大块，所以扫它自己的 chunk 格再问遮罩——
 *      只问区域中心一个点会漏掉「从边上路过」，而格边长也来自数据（`streaming.chunkSize`），
 *      面板不假设 48；
 *   ③ **通行设施**是 `Interactables` 的现读清单（调音桩/传送点/共鸣井/吊桥/闸门/音壁）+ 每条的
 *      `stateOf`。地图**不**自己读旗标、**不**自己判「我在哪个矩形里」（那是 `streaming.regionAt`）。
 *
 * 开关沿用既有**唯一**那条约定：持有者（`main.ts` 的 `setPanelOpen`）负责世界停摆与输入所有权，
 * 面板只「提出」收起来（`onRequestClose`）——与 Stakerite 同一条纪律：面板自己 hide 自己那条路
 * （KI-061）已经在调音桩上翻过一次车（背景点一下 = 游戏冻在看不见的地冻里），不在这里重开一条。
 */

/**
 * 地图上算「通行设施」的类别（§43「已开通的传送/检查点」那一栏）。
 * 这是**排版口径**（名词），与 `world/Interactables.ts > VERB`（动词：按下去会发生什么）分开：
 * 两处各有一个名字，但它们回答的不是同一个问题，谁也不许替另一方说话。
 */
export const MAP_FACILITY_KINDS = ['checkpoint', 'teleport', 'elevator', 'bridge', 'soundwall', 'gate'] as const
export type MapFacilityKind = (typeof MAP_FACILITY_KINDS)[number]

/** 类别 → 地图上的名词。`Record<MapFacilityKind, …>` 让新增类别时这里编译不过，不会悄悄少一行 */
const FACILITY_LABEL: Record<MapFacilityKind, string> = {
  checkpoint: '调音桩', teleport: '传送点', elevator: '共鸣井', bridge: '吊桥', soundwall: '音壁', gate: '闸门',
}

/** 组合根喂给地图的一条设施读数（`Interactables` 的投影，不是它的替身） */
export interface MapFacility {
  id: string
  kind: string
  /** 就是 `Interactables.stateOf` 的三个值（第三态 = 这条只用得了一次的那些） */
  state: 'ready' | 'locked' | 'used'
  regionId: string
  regionName: string
  pos: Vec3
}

/** 设施状态 → 人话（地图上不许出现 `ready` 这种码） */
const FACILITY_STATE: Record<MapFacility['state'], string> = {
  ready: '已开通', locked: '未开通', used: '已通过',
}

export interface MapDeps {
  /** 我在哪个区域（`streaming.regionAt`）。一份「点在哪个矩形里」的规则只许有一个主人 */
  regionAt: (pos: Vec3) => RegionData | null
  /** 探索遮罩（`streaming.isExplored`） */
  isExplored: (pos: Vec3) => boolean
  /** 区域格边长（`streaming.chunkSize`，数据侧给的）。惰性读取：`streaming` 在组合根里建得比本面板晚 */
  chunkSize: () => number
  playerPos: () => Vec3
  /** 镜头朝向（世界 XZ 单位向量）：玩家标记「指向镜头朝向」（ui-ux §4.3） */
  viewDir: () => { x: number; z: number }
  /** 通行设施现读清单 */
  facilities: () => readonly MapFacility[]
  /** 面板不自己收自己：把「收起来」交给持有者（见文件头） */
  onRequestClose: () => void
}

/**
 * 缩放档位（ui-ux §4.3「0.5×–4.0×，12 级离散」）。它是**表现参数**不是玩法数值：
 * 所以住在 UI 文件里，不进 `data/json`（§55 那条管的是世界数值/坐标/名字）。
 * `<0.7×` 进「缩略图模式」：只画区色块，隐藏标记与名字（同 §4.3 那半句）。
 */
export const ZOOM_LEVELS = [0.5, 0.6, 0.7, 0.85, 1, 1.2, 1.45, 1.75, 2.1, 2.6, 3.2, 4]
const BASE_ZOOM = ZOOM_LEVELS.indexOf(1)
const THUMBNAIL_BELOW = 0.7

/** 全图外框（**地图坐标 = 世界 XZ 减去这个原点**，单位仍是米 ⇒ 图不会被拉变形）。
 *  `pad` 是留白：贴在边上的区名与刻度尺要有个落脚处 */
export interface Atlas { minX: number; minZ: number; w: number; h: number }

export function atlasOf(regions: readonly RegionData[], pad = 24): Atlas {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const r of regions) {
    minX = Math.min(minX, r.bounds.minX); maxX = Math.max(maxX, r.bounds.maxX)
    minZ = Math.min(minZ, r.bounds.minZ); maxZ = Math.max(maxZ, r.bounds.maxZ)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minZ: 0, w: 1, h: 1 }
  return { minX: minX - pad, minZ: minZ - pad, w: Math.max(1, maxX - minX + pad * 2), h: Math.max(1, maxZ - minZ + pad * 2) }
}

/**
 * 这一片区域被走过吗。**唯一的判据是注入的 `isExplored`**，这里只负责「该问哪些点」：
 * 扫区域自己的 chunk 格（`floor` 半开区间，与 `StreamingSystem.cellOf` 同一个形状），
 * 命中一格就停——区域只要踩到过一角就算踏足（§4.2「踏足」那一行）。
 * 数一遍是几百次查表，而且只在开图/平移时跑；换来的是「从边上路过也算踏足」。
 */
export function regionExplored(region: RegionData, chunkSize: number, isExplored: (pos: Vec3) => boolean): boolean {
  const cs = Math.max(1, chunkSize)
  const b = region.bounds
  const x0 = Math.floor(b.minX / cs), x1 = Math.floor((b.maxX - 1e-6) / cs)
  const y0 = Math.floor(b.minY / cs), y1 = Math.floor((b.maxY - 1e-6) / cs)
  const z0 = Math.floor(b.minZ / cs), z1 = Math.floor((b.maxZ - 1e-6) / cs)
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        if (isExplored({ x: cx * cs + cs / 2, y: cy * cs + cs / 2, z: cz * cs + cs / 2 })) return true
      }
    }
  }
  return false
}

/** 表里那些区域里已经踏足的（id 名册）。遮罩没读到东西时是**空集**，不是「全都亮着」 */
export function exploredRegionIds(
  regions: readonly RegionData[], chunkSize: number, isExplored: (pos: Vec3) => boolean,
): Set<string> {
  const out = new Set<string>()
  for (const r of regions) if (regionExplored(r, chunkSize, isExplored)) out.add(r.id)
  return out
}

const CSS = `
#mapui { position:fixed; inset:0; display:none; z-index:20; pointer-events:none;
  font-family: Georgia, "Songti SC", "STSong", "SimSun", serif; color:#e8dfcb; }
#mapui.on { display:block; pointer-events:auto; }
/* 地图要摊开看：比调音桩那张窄面板宽一档，但仍然只盖住画面而不是铺满 */
#mapui .panel { width:min(1120px, 95vw); }
#mapui main.split { display:flex; gap:18px; align-items:stretch; min-height:0; }
#mapui .atlas-wrap { flex:1 1 auto; min-width:0; display:flex; }
#mapui .atlas { width:100%; height:100%; min-height:340px; max-height:62vh; touch-action:none;
  background:radial-gradient(ellipse at 40% 30%, rgba(232,223,203,.05), rgba(0,0,0,.42));
  border:1px solid rgba(201,180,88,.22); cursor:grab; }
#mapui .atlas:active { cursor:grabbing; }
#mapui .side { flex:0 0 320px; width:320px; overflow:auto; max-height:62vh; }
/* 区域色块：填色/描边取该区 palette（数据里的三个颜色）。不透明度那一条是「多层世界」的读法——
   同一个 xz 压着好几层（营地之上还有未竟厅），压暗的是不在我这一层的那几块（ui-ux §4.1） */
#mapui .rg-box { fill:var(--fill); fill-opacity:.18; stroke:var(--edge); stroke-opacity:.55; stroke-width:1.4; }
#mapui .rg-box.fog { fill:url(#mapui-fog); fill-opacity:1; stroke-dasharray:6 5; stroke-opacity:.3; }
#mapui .rg-box.far { opacity:.32; }
#mapui .rg-box.cur { fill-opacity:.34; stroke:#ffb86b; stroke-width:3; stroke-opacity:1; }
#mapui .rlabel { fill:#e8dfcb; font-size:15px; letter-spacing:.08em; }
#mapui .rsub { fill:#e8dfcb; font-size:10px; opacity:.55; }
#mapui .lm { fill:#c9b458; opacity:.75; }
#mapui .fac.ready { fill:#ffb86b; }
#mapui .fac.locked { fill:#e8dfcb; opacity:.3; }
#mapui .fac.used { fill:#8fa7bd; }
#mapui .pl-ring { fill:none; stroke:#b9e6ff; stroke-opacity:.5; stroke-width:1.5; }
#mapui .pl { fill:#b9e6ff; stroke:#0b0d12; stroke-width:1; }
#mapui .scale-line { stroke:rgba(232,223,203,.55); stroke-width:1.5; }
#mapui .side h2 { margin-top:14px; }
#mapui .side .hint { font-size:11.5px; opacity:.5; padding:4px 2px 8px; line-height:1.5; }
`

const r2 = (v: number): string => `${Math.round(v * 100) / 100}`
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** 事件目标 → 命中的那个节点。真 DOM 与测试替身都能走（替身没有 closest 时安静地什么都不做） */
function closestOf(target: unknown, selector: string): HTMLElement | null {
  const el = target as HTMLElement | null
  return el && typeof el.closest === 'function' ? (el.closest(selector) as HTMLElement | null) : null
}

export class MapUI {
  private readonly root: HTMLDivElement
  private readonly atlas: Atlas
  private open = false
  /** 视图中心（地图坐标）与缩放档；每开一次都回到「我在哪」 */
  private cx = 0
  private cz = 0
  private zoom = BASE_ZOOM
  /** 拖拽中的上一帧像素位置 + 那一块屏幕的尺寸（像素 → 米要它） */
  private drag: { x: number; y: number; w: number; h: number } | null = null

  constructor(private readonly regions: readonly RegionData[], private readonly deps: MapDeps) {
    this.atlas = atlasOf(regions)
    const style = document.createElement('style')
    // 外壳那套（`.cxs` 的膜/行距/焦点框）与调音桩面板**同一份**：抄第二份就是让两块面板各漂一遍
    style.textContent = CSS + PANEL_CSS
    document.head.appendChild(style)
    this.root = document.createElement('div')
    this.root.id = 'mapui'
    this.root.classList.add('cxs')
    document.body.appendChild(this.root)
    this.root.addEventListener('click', (e) => this.onClick(e))
    this.root.addEventListener('mousedown', (e) => this.onDown(e))
    this.root.addEventListener('wheel', (e) => this.zoomBy((e as WheelEvent).deltaY < 0 ? 1 : -1))
    // 拖到面板外也要跟手：mousemove/mouseup 挂在 window 上。仍然**不碰键盘**——
    // 菜单读数只有 `uiStep` 一个入口（KI-062），DOM 一条 + 菜单一条就是一次按键被数两遍
    window.addEventListener('mousemove', (e) => this.onMove(e))
    window.addEventListener('mouseup', () => { this.drag = null })
  }

  get isOpen(): boolean { return this.open }

  toggle(): void { this.open ? this.close() : this.show() }

  show(): void {
    this.open = true
    this.recenter()
    this.root.classList.add('on')
    this.render()
  }

  /**
   * 关面板只由持有者调（`setPanelOpen(false)` 同时关两块面板）。视图状态也一并丢掉：
   * 下次打开看到的是「我此刻在哪」，不是上次平移到的某个角落。
   */
  close(): void {
    this.open = false
    this.drag = null
    this.root.classList.remove('on')
  }

  /**
   * 菜单读数的唯一入口（与 Stakerite 同一份约定，KI-062）：意图由 `core/Input.ts` 折好再喂进来。
   * 语义是**地图的**语义——方向键=平移（§4.3「平移：拖拽/摇杆」）、翻页/肩键=缩放、
   * Enter=回中（§4.3「`F` 一键回中到玩家」在菜单里的等价键位；键盘 F 归玩法层）、
   * Back=后退一层（收面板，解冻由持有者做）。这里**不挂任何 keydown 监听器**。
   */
  uiStep(intents: ReadonlySet<UiIntent>): void {
    if (!this.open || intents.size === 0) return
    if (intents.has('back')) { this.deps.onRequestClose(); return }
    if (intents.has('pagePrev')) { this.zoomBy(1); return }
    if (intents.has('pageNext')) { this.zoomBy(-1); return }
    if (intents.has('confirm')) { this.recenter(); this.render(); return }
    const view = this.viewSize()
    let dx = 0
    let dz = 0
    if (intents.has('left')) dx -= 1
    if (intents.has('right')) dx += 1
    if (intents.has('up')) dz -= 1
    if (intents.has('down')) dz += 1
    if (dx === 0 && dz === 0) return //【恒死·批30】UiIntent 值域 8 意图全被上方 if 链吃净：集合非空且不含 back/翻页/confirm ⇒ 必含方向键 ⇒ dx/dz 不同时为 0；新增意图时此腿复活，守门测试会叫
    this.panBy((dx * view.w) / 8, (dz * view.h) / 8)
  }

  /* ------------------------------ 视图 ------------------------------ */

  /** 打开/回中：视图中心 = 玩家，缩放回基准档 */
  private recenter(): void {
    const p = this.deps.playerPos()
    this.cx = p.x - this.atlas.minX
    this.cz = p.z - this.atlas.minZ
    this.zoom = BASE_ZOOM
    this.clampView()
  }

  private viewSize(): { w: number; h: number } {
    const k = ZOOM_LEVELS[this.zoom]
    return { w: this.atlas.w / k, h: this.atlas.h / k }
  }

  /** 视图中心最多甩出去四分之一屏：图可以看边角，但不许整片滑出画面 */
  private clampView(): void {
    const v = this.viewSize()
    this.cx = clamp(this.cx, -v.w * 0.25, this.atlas.w + v.w * 0.25)
    this.cz = clamp(this.cz, -v.h * 0.25, this.atlas.h + v.h * 0.25)
  }

  private panBy(dx: number, dz: number): void {
    this.cx += dx
    this.cz += dz
    this.clampView()
    this.render()
  }

  private zoomBy(delta: number): void {
    const next = clamp(this.zoom + delta, 0, ZOOM_LEVELS.length - 1)
    if (next === this.zoom) return
    this.zoom = next
    this.clampView()
    this.render()
  }

  private onClick(e: MouseEvent): void {
    const el = closestOf(e.target, '[data-act]')
    if (el?.dataset.act === 'close') this.deps.onRequestClose()
  }

  private onDown(e: MouseEvent): void {
    const el = closestOf(e.target, '[data-map-drag]')
    if (!el) return
    const box = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 }
    this.drag = { x: e.clientX, y: e.clientY, w: box.width, h: box.height }
  }

  private onMove(e: MouseEvent): void {
    const d = this.drag
    if (!d || !this.open) return
    const v = this.viewSize()
    // 像素 → 米：这一块屏幕的宽正对着 viewBox 的宽。按住图往右拖，图跟着手走 ⇒ 中心反向
    this.panBy(-((e.clientX - d.x) / (d.w || 1)) * v.w, -((e.clientY - d.y) / (d.h || 1)) * v.h)
    d.x = e.clientX
    d.y = e.clientY
  }

  /* ------------------------------ 渲染 ------------------------------ */

  private render(): void {
    if (!this.open) return
    const player = this.deps.playerPos()
    const current = this.deps.regionAt(player)
    const revealed = exploredRegionIds(this.regions, this.deps.chunkSize(), this.deps.isExplored)
    const zoom = ZOOM_LEVELS[this.zoom]
    const thumb = zoom < THUMBNAIL_BELOW
    const v = this.viewSize()
    const box = `${r2(this.cx - v.w / 2)} ${r2(this.cz - v.h / 2)} ${r2(v.w)} ${r2(v.h)}`
    this.root.innerHTML = `
      <div class="veil" data-act="close"></div>
      <div class="panel">
        <header>
          <h1>息声领 · 区域图</h1>
          <span class="sub">${current ? current.displayName : '界外'} · 已踏足 ${revealed.size}/${this.regions.length} 区 · 缩放 ×${zoom}${thumb ? ' · 缩略图' : ''}</span>
        </header>
        <main class="split">
          <div class="atlas-wrap">
            <svg class="atlas" data-map-drag viewBox="${box}" preserveAspectRatio="xMidYMid meet">
              <defs>
                <pattern id="mapui-fog" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
                  <line x1="0" y1="0" x2="0" y2="12" stroke="rgba(232,223,203,.10)" stroke-width="3" />
                </pattern>
              </defs>
              <g>${this.regionsHtml(revealed, current, thumb)}</g>
              <g>${thumb ? '' : this.facilityHtml(revealed)}</g>
              <g>${thumb ? '' : this.playerHtml(player)}</g>
              ${thumb ? '' : this.scaleHtml()}
            </svg>
          </div>
          <div class="side">${this.sideHtml(revealed, current)}</div>
        </main>
        <div class="foot">
          <span>拖拽 / ↑↓←→ 平移 · PgUp·PgDn 缩放 · Enter 回中 · Backspace 收起</span>
          <span>${thumb ? '缩略图：只画区色块（&lt;0.7×）' : `1 格 = ${this.deps.chunkSize()}m`}</span>
        </div>
      </div>`
  }

  /** 一个区的色块。名字与地标只给**已踏足**的区（§4.2：未知 = 磨砂遮罩，不许先把细节漏出来） */
  private regionsHtml(revealed: Set<string>, current: RegionData | null, thumb: boolean): string {
    const here = this.deps.playerPos().y
    const k = 1 / ZOOM_LEVELS[this.zoom]
    return [...this.regions].sort((a, b) => a.order - b.order).map((r) => {
      const b = r.bounds
      const lit = revealed.has(r.id)
      const isCur = r.id === current?.id
      // 多层世界：不在我这一层的区压暗（ui-ux §4.1「垂直层用叠层透明度表达」）
      const far = !isCur && (b.minY > here + 8 || b.maxY <= here - 8)
      const cls = `rg-box ${lit ? 'lit' : 'fog'}${isCur ? ' cur' : ''}${far ? ' far' : ''}`
      const x = b.minX - this.atlas.minX
      const y = b.minZ - this.atlas.minZ
      const labels = lit && !thumb ? this.labelsHtml(r, x + 8, y + 18) : ''
      const lms = lit && !thumb
        ? r.landmarks.map((l) => `<circle class="lm" data-lm="${l.id}" cx="${r2(l.pos.x - this.atlas.minX)}" cy="${r2(l.pos.z - this.atlas.minZ)}" r="${r2(2.6 * k)}" />`).join('')
        : ''
      return `<rect class="${cls}" data-region="${r.id}" x="${r2(x)}" y="${r2(y)}" width="${r2(b.maxX - b.minX)}" height="${r2(b.maxZ - b.minZ)}" style="--fill:${r.palette.base};--edge:${r.palette.accent}" />${labels}${lms}`
    }).join('')
  }

  /** 区名与它的数据侧注脚（拍网/垂直层）。文字按 1/zoom 反向缩放 ⇒ 屏幕上的字号恒定 */
  private labelsHtml(r: RegionData, x: number, y: number): string {
    const k = 1 / ZOOM_LEVELS[this.zoom]
    const sub = `${r.grid.bpm}BPM/${r.grid.beatsPerBar}${r.grid.label ? ` · ${r.grid.label}` : ''}`
    return `<g transform="translate(${r2(x)},${r2(y)}) scale(${r2(k)})">
      <text class="rlabel" x="0" y="0">${r.displayName}</text>
      <text class="rsub" x="0" y="14">${sub}</text>
    </g>`
  }

  /** 通行设施的点（颜色分三态；与右栏那一列是双通道读法，图标本身不承载唯一信息） */
  private facilityHtml(revealed: Set<string>): string {
    const k = 1 / ZOOM_LEVELS[this.zoom]
    return this.deps.facilities()
      .filter((f) => isMapFacility(f.kind) && revealed.has(f.regionId))
      .map((f) => `<g transform="translate(${r2(f.pos.x - this.atlas.minX)},${r2(f.pos.z - this.atlas.minZ)}) scale(${r2(k)})">
        <circle class="fac ${f.state}" data-fac="${f.id}" r="3.4" />
      </g>`).join('')
  }

  /** 玩家标记：音叉指针，指向镜头朝向（§4.3）。角度把世界 XZ 的 (dx,dz) 折到 svg 的 (x,y) 上 */
  private playerHtml(p: Vec3): string {
    const k = 1 / ZOOM_LEVELS[this.zoom]
    const dir = this.deps.viewDir()
    const deg = Math.round((Math.atan2(dir.x, -dir.z) * 180) / Math.PI)
    return `<g transform="translate(${r2(p.x - this.atlas.minX)},${r2(p.z - this.atlas.minZ)}) scale(${r2(k)})">
      <circle class="pl-ring" r="13" />
      <g transform="rotate(${deg})"><polygon class="pl" points="0,-9 5,7 0,3 -5,7" /></g>
    </g>`
  }

  /** 刻度尺：一条 = 一个区格（`chunkSize` 米，数据侧给的数）。它是**米的尺子**，所以随缩放变长 */
  private scaleHtml(): string {
    const k = 1 / ZOOM_LEVELS[this.zoom]
    const v = this.viewSize()
    const len = this.deps.chunkSize()
    const x = this.cx - v.w / 2 + 16 * k
    const y = this.cz + v.h / 2 - 16 * k
    return `<g transform="translate(${r2(x)},${r2(y)}) scale(${r2(k)})">
      <line class="scale-line" x1="0" y1="0" x2="${r2(len)}" y2="0" />
      <text class="rsub" x="0" y="-6">${len}m · 1 格</text>
    </g>`
  }

  /** 右栏：区域名册 + 通行设施 + 地标。**只列已踏足的区**（§4.2 不显示未踏足区的内容） */
  private sideHtml(revealed: Set<string>, current: RegionData | null): string {
    const rank = new Map(this.regions.map((r) => [r.id, r.order]))
    const regions = [...this.regions].filter((r) => revealed.has(r.id)).sort((a, b) => a.order - b.order)
    const regionRows = regions.map((r) => {
      const b = r.bounds
      return `<div class="row"><span class="name">${r.displayName}${r.id === current?.id ? ' <span class="tag">当前</span>' : ''}
        <span class="note">${r.grid.bpm}BPM/${r.grid.beatsPerBar} · 层 y ${b.minY}~${b.maxY}</span></span>
        <span class="num">x ${b.minX}~${b.maxX} · z ${b.minZ}~${b.maxZ}</span></div>`
    }).join('') || '<div class="empty">还没有踏足任何区域。</div>'
    const hiddenRegions = this.regions.length - regions.length

    const facilities = this.deps.facilities()
      .filter((f) => isMapFacility(f.kind) && revealed.has(f.regionId))
      .sort((a, b) => (rank.get(a.regionId) ?? 0) - (rank.get(b.regionId) ?? 0) || a.id.localeCompare(b.id)) //【恒死·批30】两侧 ?? 0 均不可达：revealed 由 exploredRegionIds 只认 this.regions 生成 ⊆ rank 键集，filter 保证 regionId 必在册
    const openCount = facilities.filter((f) => f.state !== 'locked').length //【恒死·批30】下方 FACILITY_LABEL[kind] ?? kind 的兜底不可达：isMapFacility 过滤后 kind 必在 MAP_FACILITY_KINDS 六类内，而 FACILITY_LABEL 是全六类 Record
    const facilityRows = facilities.map((f) => `<div class="row">
      <span class="name">${FACILITY_LABEL[f.kind as MapFacilityKind] ?? f.kind}
        <span class="note">${f.regionName} · x ${Math.round(f.pos.x)} z ${Math.round(f.pos.z)}</span></span>
      <span class="num">${FACILITY_STATE[f.state]}</span></div>`).join('')
      || '<div class="empty">这一带还没有可用的机关。</div>'

    // 地标**只有 nameKey**（表里没有显示名）⇒ 名字先不印在屏幕上，把 key 挂在属性里等一张本地化表
    const landmarkRows = regions.flatMap((r) => r.landmarks.map((l) => ({ r, l }))).map(({ r, l }) => `<div class="row">
      <span class="name" data-landmark="${l.id}" data-name-key="${l.nameKey}">地标
        <span class="note">${r.displayName} · x ${Math.round(l.pos.x)} z ${Math.round(l.pos.z)}</span></span>
      <span class="num">远望 ${l.sightRange}m</span></div>`).join('')
      || '<div class="empty">还没有看见任何地标。</div>'

    return `
      <h2>区域 · 已踏足 ${regions.length}/${this.regions.length}</h2>
      ${regionRows}
      ${hiddenRegions > 0 ? `<div class="hint">另有 ${hiddenRegions} 区还没有踏足 —— 未踏足的区不显示名字与内容（§4.2）。</div>` : ''}
      <h2>通行设施 · 已开通 ${openCount}/${facilities.length}</h2>
      ${facilityRows}
      <h2>地标</h2>
      ${landmarkRows}
      <div class="hint">快旅（选中已激活的调音桩直接传送）还没接：这一批只如实列出它们（见 KI-087）。</div>`
  }
}

const isMapFacility = (kind: string): boolean => (MAP_FACILITY_KINDS as readonly string[]).includes(kind)

