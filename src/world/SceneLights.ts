import * as THREE from 'three'
import type { LightRig } from '@/world/Lighting'

/**
 * §37 第二腿：**三层光的绘制层**（art-direction §8「每区三层光：极光 hemi + 区域 key + 局部 point」）。
 *
 * 与 `vfx/ColorGrade.ts` 的分工：那一层是"画面调色的唯一仲裁者"（雾密度 + CSS 滤镜），这一层是
 * "场景里的三盏灯"。两者都只吃 `world/Lighting.ts` 出的读数，自己不做任何判断——
 * 判断（哪一列配哪盏灯、缺省怎么办）全部住在那个逻辑层里，这里连一个 hex 都不认。
 *
 * **三盏灯建一次，之后只改参数**：换区不是拆了重建，`Scene` 里的灯对象从头到尾只有这三只。
 * 少一只就是漏光（每次换区漏一盏，十次之后场景里十盏没人认领的灯），多一只就是两个主人。
 *
 * **`setRig(null)` = 全部关掉**，不是"保持上一区的样子"：读不出预设时留一盏别处的灯，比黑着一帧
 * 更难查——黑了你立刻知道，错色的光你要对照两地的色板才发现（这一条与 `ColorGrade.setLighting(null)`
 * 的"不碰"刻意不同：那边碰的是屏幕滤镜，留着只是不换；这边留着的是会照亮错东西的光源）。
 *
 * 本文件是表现层（import three），因此**不进逻辑层清单**（`tests/unit/arch-boundaries.test.ts`）。
 */
export class SceneLights {
  private readonly hemi: THREE.HemisphereLight
  private readonly key: THREE.DirectionalLight
  private readonly point: THREE.PointLight
  /** point 光的照射半径与衰减。文档只说"局部"，这两个数是把"局部"讲成可断言的数 */
  private static readonly POINT_DISTANCE = 24
  private static readonly POINT_DECAY = 2

  constructor(scene: THREE.Scene) {
    // 三盏都从 0 亮度起：还没有任何一行读数的时候，场景不该被一盏没人认领的灯照着
    this.hemi = new THREE.HemisphereLight(0x000000, 0x000000, 0)
    this.key = new THREE.DirectionalLight(0x000000, 0)
    this.key.castShadow = false
    // 阴影视锥跟着 key 光一起搬过来（它本来就是 key 的属性，从前写在 `PlaceholderArena` 里是因为
    // 那一处同时建了 key 光）。2048 / ±40 是灰盒期的口径：整个灰盒场地都进这一张 shadow map。
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.camera.left = -40
    this.key.shadow.camera.right = 40
    this.key.shadow.camera.top = 40
    this.key.shadow.camera.bottom = -40
    this.point = new THREE.PointLight(0x000000, 0, SceneLights.POINT_DISTANCE, SceneLights.POINT_DECAY)
    scene.add(this.hemi, this.key, this.point)
  }

  /**
   * 换上某一行的三层光。`anchor` 是局部 point 的挂点（`main.ts` 传该区第一个 landmark 的位置）；
   * `null` = 这一区没有可挂的地方 ⇒ point 不亮（而不是挂在原点把整个世界照亮）。
   */
  setRig(rig: LightRig | null, anchor: { x: number; y: number; z: number } | null): void {
    if (!rig) {
      this.hemi.intensity = 0
      this.key.intensity = 0
      this.key.castShadow = false
      this.point.intensity = 0
      return
    }
    this.hemi.color.set(rig.hemiSky)
    this.hemi.groundColor.set(rig.hemiGround)
    this.hemi.intensity = rig.hemiIntensity

    this.key.color.set(rig.keyColor)
    this.key.intensity = rig.keyIntensity
    // §8 的深窖例外走这条路：强度 0 的方向光不投影（省一整套 shadow map，也不留一道看不见的投影）
    this.key.castShadow = rig.keyIntensity > 0
    this.key.position.set(rig.keyDir[0], rig.keyDir[1], rig.keyDir[2])

    this.point.color.set(rig.pointColor)
    this.point.intensity = anchor ? rig.pointIntensity : 0
    if (anchor) this.point.position.set(anchor.x, anchor.y, anchor.z)
  }

  /** 三盏灯一起摘掉（`dispose()` 的对称物；几何与材质不归这里管） */
  dispose(): void {
    this.hemi.removeFromParent()
    this.key.removeFromParent()
    this.point.removeFromParent()
  }
}
