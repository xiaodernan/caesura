import * as THREE from 'three'
import type { Hitbox } from '@/data/schema'
import type { Vec3 } from '@/combat/EntityStats'
import { POINT_BLANK_GRACE } from '@/combat/HitShapes'
import { VFX_PALETTE } from '@/vfx/materials'

/**
 * hitbox 线框（需求 §54 / combat.md §17 调试器那一格，KI-315）。
 *
 * **这批治的病**：§17 那一格列了四格展示，三格有承载体、**「hitbox 线框」零承载体**——
 * KI-300 腿 L13 拿六种拼法（盒辅助／调试绘制／"画出命中框"那几种写法）扫过整个 `src`，
 * 六格读数当时全是 0。文档写「屏幕显示 hitbox 线框」而场里一格都没画，
 * 于是调帧表的人只能靠面板文本猜扇形有多宽——`activeHitbox` 早就把 `box` 交出来了（表现层真在读它），
 * 读的只有「该不该亮」，没有一格把那个框画出来。
 *
 * **两条设计规矩，都是为了让「线框＝判定」这句可以被测**：
 *
 * ① **画的是表里那个框，不是膨胀后的命中区**。`shapeHits` 三条支都把目标体积加在外沿上
 * （`radius + target.radius`／`outer + target.radius`／`radius + target.radius`），而线框在出手那一刻
 * 不认识任何目标——画"含谁"就是替结算做裁决。所以这里画 authored box，那 0.55m 的体积补偿由测试
 * 如实登记（`hitbox-wire.test.ts` 里那条「弧外那一圈里目标中心照样挨打」）。
 * 唯独锥形的贴身豁免圈（`POINT_BLANK_GRACE`）画出来：那是**框自己**的属性、不依赖目标，
 * 不画就等于线框比判定少一块真实存在的命中区。
 *
 * ② **几何住在局部空间，朝向交在对象上**。顶点按"+Z＝出手朝向、原点＝出手点"生成，
 * 于是同一个 box 只建一份几何（缓存按 `boxFingerprint` 复用：帧表里重复出现的同一形状只建一档），每帧只挪对象。这不是为了省：
 * 是为了让「线框＝判定」那句能写成"`matrixWorld` 乘出来的顶点 ⇄ `shapeHits` 读同一批点"的对账，
 * 而不是两边各算各的坐标——三种形状的 yaw 用法本来就不一样（cone 吃角度、sphere 的球心沿
 * `(sin yaw, cos yaw)` 平移、ring 既不读朝向也不读高度）。
 *
 * **默认关着，而且关着的时候一口都不叫**：`sync()` 没被翻开时直接 return，连 `feed()` 都不调用——
 * 那是 F1/F3/F4 那块外壳的同一句纪律（KI-058）搬进三维：每逻辑帧把全场招式变成线段的代价，
 * 不该由"今天没人看"来付。键与名册都由组合根给（`main.ts` 的 DEV 段），所以 `world/` 不 import
 * 战斗/AI 运行时（依赖闸门守着）。
 */

/** 线的一个端点（局部空间：+Z 是出手朝向，原点＝出手点） */
type Pt = readonly [number, number, number]

export interface WireInput {
  /** 复用键：同一个出手者跨帧用同一个键，线框对象就不重建（玩家一个固定串，敌人用 id） */
  key: string
  /** 敌我取色按 art-direction §7.1 分离，线框不该变成第三种颜色 */
  hostile: boolean
  box: Hitbox
  origin: Vec3
  yaw: number
}

/** 圆弧的细分段数：纯视觉量，判定不吃它（判定是解析式，压根没有细分这一说） */
export const ARC_SEGMENTS = 24

const rad = (deg: number): number => (deg * Math.PI) / 180

/** 极坐标落点：`deg` 从正前方（+Z）起算，与 `shapeHits` 那条 `atan2(dx, dz) - yaw` 同一个起算方向 */
const pointAt = (deg: number, radius: number, y: number): Pt => {
  const a = rad(deg)
  return [Math.sin(a) * radius, y, Math.cos(a) * radius]
}

/** 从 `fromDeg` 到 `toDeg` 的一圈折线（含首尾两点） */
function arcPolyline(radius: number, y: number, fromDeg: number, toDeg: number, segments: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= segments; i++) {
    out.push(pointAt(fromDeg + ((toDeg - fromDeg) * i) / segments, radius, y))
  }
  return out
}

/** 整圈（首尾各出现一次，画出来是闭合的） */
const circle = (radius: number, y: number, segments: number): Pt[] =>
  arcPolyline(radius, y, 0, 360, segments)

/** 折线 → 线段对；`LineSegments` 的 position 数组就是靠它铺平的 */
function pushPolyline(poly: readonly Pt[], pairs: number[]): void {
  for (let i = 0; i + 1 < poly.length; i++) {
    pairs.push(poly[i][0], poly[i][1], poly[i][2], poly[i + 1][0], poly[i + 1][1], poly[i + 1][2])
  }
}

const pushLine = (a: Pt, b: Pt, pairs: number[]): void => {
  pairs.push(a[0], a[1], a[2], b[0], b[1], b[2])
}

/** 三个轴向的大圆（球只有轮廓，判定是整个球——这条由测试如实登记） */
function sphereCircles(center: Pt, radius: number, segments: number): Pt[][] {
  const eq: Pt[] = []
  const merX: Pt[] = []
  const merZ: Pt[] = []
  for (let i = 0; i <= segments; i++) {
    const a = rad((360 * i) / segments)
    const s = Math.sin(a) * radius
    const k = Math.cos(a) * radius
    eq.push([center[0] + s, center[1], center[2] + k])
    merX.push([center[0] + s, center[1] + k, center[2]])
    merZ.push([center[0], center[1] + s, center[2] + k])
  }
  return [eq, merX, merZ]
}

/**
 * 一个 box 的局部顶点（每六个数一条线段）。三条支各按 `shapeHits` 里那一条读的法子画：
 * - **cone**：中面（`offsetY`）上的 apex→两条边→外弧，再加高度层的上下两道弧与立柱——
 *   `offsetY` 是那一层的**中心**（判据比的是目标球心与 `origin.y + offsetY` 之差），
 *   所以 `yLo/yHi = offsetY ∓ height/2`；贴身豁免圈另画一圈（判据在那一圈里只看高度、角度作废）。
 * - **sphere**：球心 `(0, offsetY, offsetFwd)`，三条正交大圆。
 * - **ring**：两条同心圆，外沿是 `outer + forward`（`shapeHits` 那一行），内沿**不加**——
 *   偏心只朝外单向膨胀；y 恒为 0，因为那一支一个字节都不读高度。
 */
export function wireVertices(box: Hitbox, segments: number = ARC_SEGMENTS): number[] {
  const pairs: number[] = []
  if (box.shape === 'cone') {
    const half = box.angleDeg / 2
    const yLo = box.offsetY - box.height / 2
    const yHi = box.offsetY + box.height / 2
    const lo = pointAt(-half, box.radius, box.offsetY)
    const hi = pointAt(half, box.radius, box.offsetY)
    const apex: Pt = [0, box.offsetY, 0]
    pushLine(apex, lo, pairs)
    pushLine(apex, hi, pairs)
    pushPolyline(arcPolyline(box.radius, box.offsetY, -half, half, segments), pairs)
    pushPolyline(arcPolyline(box.radius, yLo, -half, half, segments), pairs)
    pushPolyline(arcPolyline(box.radius, yHi, -half, half, segments), pairs)
    for (const p of [lo, pointAt(0, box.radius, box.offsetY), hi]) {
      pushLine([p[0], yLo, p[2]], [p[0], yHi, p[2]], pairs)
    }
    pushLine([0, yLo, 0], [0, yHi, 0], pairs)
    pushPolyline(circle(POINT_BLANK_GRACE, box.offsetY, segments), pairs)
    return pairs
  }
  if (box.shape === 'sphere') {
    for (const ring of sphereCircles([0, box.offsetY, box.offsetFwd], box.radius, segments)) {
      pushPolyline(ring, pairs)
    }
    return pairs
  }
  const outer = box.outer + box.forward
  pushPolyline(circle(box.inner, 0, segments), pairs)
  pushPolyline(circle(outer, 0, segments), pairs)
  pushLine([0, 0, box.inner], [0, 0, outer], pairs)
  return pairs
}

/**
 * 几何缓存的键：**同一个 box 只建一份**——形状与那几个数逐字进键，差一个字节就是另一份几何。
 * 用 `JSON.stringify` 而不是手写拼接：手写就是"第二个格式主人"（插槽键那个教训，KI-058）。
 */
export const boxFingerprint = (box: Hitbox): string => JSON.stringify(box)

/**
 * 名册的那两侧（玩家与在场敌人）在这里只按**结构**认领：`pos`/`yaw`/`activeHitbox.box` 三件，
 * 一个都不多点。之所以要有这一格而不是让 `main.ts` 把循环写在闭包里：那段"谁在场、谁敌我、键取什么"
 * 的语义如果有两份（一份给运行时、一份给测试去复刻），它们迟早分叉——而分叉的结局是测试测的是
 * 我抄的那一份，不是真在跑的那一份。结构类型 ⇒ `world/` 依旧不 import `@/ai/AISystem`、
 * `@/player/ThirdPersonController`（依赖闸门守着）。
 */
export interface WireSource {
  readonly id?: string
  readonly pos: Vec3
  readonly yaw: number
  readonly activeHitbox: { readonly box: Hitbox | undefined } | null
}

/** 玩家那一条的复用键（敌人用 `id`，玩家没有 id ⇒ 固定串） */
export const PLAYER_WIRE_KEY = 'player'

export function wiresFrom(player: WireSource, enemies: readonly WireSource[]): WireInput[] {
  const out: WireInput[] = []
  const pbox = player.activeHitbox?.box
  if (pbox) out.push({ key: PLAYER_WIRE_KEY, hostile: false, box: pbox, origin: player.pos, yaw: player.yaw })
  for (const e of enemies) {
    const box = e.activeHitbox?.box
    if (!box || !e.id) continue
    out.push({ key: e.id, hostile: true, box, origin: e.pos, yaw: e.yaw })
  }
  return out
}

export interface HitboxWireSpec {
  scene: THREE.Scene
  /** 呼出键。与 F1/F3/F4 同一套规矩：**键的主人写在构造点**（`main.ts`），这里只认字符串 */
  key: string
  /** 当前在场的出手名册，由组合根给；关着的时候一次都不叫 */
  feed: () => WireInput[]
  segments?: number
}

export class HitboxWire {
  enabled = false
  private readonly group = new THREE.Group()
  private readonly entries = new Map<string, { obj: THREE.LineSegments; fp: string; hostile: boolean }>()
  private readonly geos = new Map<string, THREE.BufferGeometry>()
  private readonly matAlly: THREE.LineBasicMaterial
  private readonly matHostile: THREE.LineBasicMaterial
  private readonly segments: number
  private builds = 0
  private peakLive = 0
  private calls = 0

  constructor(private readonly spec: HitboxWireSpec) {
    this.segments = spec.segments ?? ARC_SEGMENTS
    this.group.name = 'hitbox-wire'
    this.group.visible = false
    spec.scene.add(this.group)
    // 取色只用 `VFX_PALETTE` 里已登记的两颗（冷银＝玩家攻击轨迹，失谐紫＝敌方）：
    // 线框是读数工具，不该往 art-direction §7.1 那张表里添第三颗色（KI-296 的欠账名册因此不伸长）
    this.matAlly = new THREE.LineBasicMaterial({ color: VFX_PALETTE.silver })
    this.matHostile = new THREE.LineBasicMaterial({ color: VFX_PALETTE.discordViolet })
    addEventListener('keydown', this.onKey)
  }

  /** 构造点写成 `key: 'F6'` 这个形状，`doc-audit` 的"死绑定"判据才读得到这一把键的读者 */
  get key(): string { return this.spec.key }
  get live(): number { return this.entries.size }
  get peakLiveCount(): number { return this.peakLive }
  /** 建了几份几何（缓存命中不加）——「同一式连打十帧只建一份」那条腿读这个数 */
  get geometryBuilds(): number { return this.builds }
  /** `feed()` 被叫了几次：关着的时候这个数必须纹丝不动 */
  get feedCalls(): number { return this.calls }
  get keys(): string[] { return [...this.entries.keys()].sort() }
  objectOf(key: string): THREE.LineSegments | null { return this.entries.get(key)?.obj ?? null }
  /** 组当前的可见性——「默认关」那句的可执行读数（不读私有字段，只答一个问题） */
  groupVisible(): boolean { return this.group.visible }
  /** 缓存里的几何名册（`dispose 零残留` 那条腿要逐颗挂 dispose 监听） */
  geometries(): THREE.BufferGeometry[] { return [...this.geos.values()] }

  /**
   * 每逻辑帧由组合根叫一次。**关着一口都不叫**：连 `feed()` 都不碰，更不建任何几何——
   * 三块面板每帧各拼一遍全场文本那个代价，三维里换成了每帧各建一份线段。
   */
  sync(): void {
    if (!this.enabled) return
    this.calls++
    const seen = new Set<string>()
    for (const input of this.spec.feed()) {
      seen.add(input.key)
      const fp = boxFingerprint(input.box)
      let rec = this.entries.get(input.key)
      if (!rec) {
        const obj = new THREE.LineSegments(this.geometryFor(fp, input.box), this.matOf(input.hostile))
        this.group.add(obj)
        rec = { obj, fp, hostile: input.hostile }
        this.entries.set(input.key, rec)
      } else if (rec.fp !== fp) {
        rec.fp = fp
        rec.obj.geometry = this.geometryFor(fp, input.box)
      }
      if (rec.hostile !== input.hostile) {
        rec.hostile = input.hostile
        rec.obj.material = this.matOf(input.hostile)
      }
      rec.obj.position.set(input.origin.x, input.origin.y, input.origin.z)
      rec.obj.rotation.y = input.yaw
      rec.obj.updateMatrixWorld()
    }
    for (const key of [...this.entries.keys()]) {
      if (seen.has(key)) continue
      this.group.remove(this.entries.get(key)!.obj)
      this.entries.delete(key)
    }
    if (this.entries.size > this.peakLive) this.peakLive = this.entries.size
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey)
    this.clear()
    for (const geo of this.geos.values()) geo.dispose()
    this.geos.clear()
    this.matAlly.dispose()
    this.matHostile.dispose()
    this.spec.scene.remove(this.group)
  }

  private geometryFor(fp: string, box: Hitbox): THREE.BufferGeometry {
    let geo = this.geos.get(fp)
    if (!geo) {
      geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wireVertices(box, this.segments), 3))
      this.geos.set(fp, geo)
      this.builds++
    }
    return geo
  }

  private matOf(hostile: boolean): THREE.LineBasicMaterial {
    return hostile ? this.matHostile : this.matAlly
  }

  private clear(): void {
    for (const rec of this.entries.values()) this.group.remove(rec.obj)
    this.entries.clear()
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== this.spec.key) return
    e.preventDefault()
    this.enabled = !this.enabled
    this.group.visible = this.enabled
    // 关掉那一刻就清空：留一具静止的旧线框在场上比不画更坏——它会被人当成"此刻的判定"
    if (!this.enabled) this.clear()
  }
}
