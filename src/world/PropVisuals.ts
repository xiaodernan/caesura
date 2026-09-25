/**
 * 可破坏场景物的灰盒表现（KI-023 音刺；KI-022② 振源核）。
 * 每根 prop 一个组——全场个位数根，InstancedMesh 的收益为零、逐根状态（歪斜/残桩/外露）的复杂度不为零。
 * - 音刺 = 一根细长黑锥（art-direction.md「刺穿地层的细长黑色尖针」）：灰盒期就用真形状，
 *   因为它的辨识度恰好来自「什么都不像这里」。挨一记歪一分，碎了只剩残桩。
 * - 振源核 = 一枚金色低球（未竟厅色板的 glow 面）：没外露时**整个组都不可见**——
 *   「Finale 场地出 3 个振源核」的意思是它之前不存在。
 * 正式资产来了整组替换，sync() 读的状态契约不变。
 */
import { Group, Mesh, MeshStandardMaterial, ConeGeometry, CylinderGeometry, SphereGeometry } from 'three'
import type { Prop } from './Props'
import type { RegionData } from '@/data/schema'

export class PropVisuals {
  private readonly groups = new Map<string, Group>()
  private readonly bodies = new Map<string, Mesh>()
  private readonly stubs = new Map<string, Mesh>()
  private readonly dark = new MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.35, metalness: 0.6 })
  private readonly coreMat = new MeshStandardMaterial({ color: 0xd8b45a, roughness: 0.25, metalness: 0.2, emissive: 0x8a6d1e, emissiveIntensity: 0.9 })

  constructor(
    private readonly scene: import('three').Scene,
    private readonly regions: readonly RegionData[],
    private readonly isRegionOpen: (r: RegionData) => boolean,
    /** 外露判定（组合根接 PropSystem.isExposed）；未外露的核整个不可见 */
    private readonly isExposed: (p: Prop) => boolean = () => true,
  ) {
    for (const r of regions) {
      for (const p of r.props ?? []) {
        const g = new Group()
        g.position.set(p.pos.x, p.pos.y, p.pos.z)
        const stub = new Mesh(new CylinderGeometry(0.3, 0.38, 0.5, 6), p.kind === 'resonance_core' ? this.coreMat : this.dark)
        stub.position.y = 0.25
        stub.visible = false
        g.add(stub)
        let body: Mesh
        if (p.kind === 'resonance_core') {
          body = new Mesh(new SphereGeometry(0.7, 12, 10), this.coreMat)
          body.position.y = 0.9
        } else {
          // 音刺：细长黑锥，尖朝下=刺穿地层；base 半径 0.35 < 命中靶 0.9（判定宽容于视觉，惯例）
          body = new Mesh(new ConeGeometry(0.35, 4.2, 6), this.dark)
          body.rotation.x = Math.PI
          body.position.y = 4.2 / 2
        }
        body.castShadow = false
        body.receiveShadow = false
        g.add(body)
        scene.add(g)
        this.groups.set(p.id, g)
        this.bodies.set(p.id, body)
        this.stubs.set(p.id, stub)
      }
    }
  }

  /** 每帧读 props 状态：可见性（完好+区域已解锁+外露）、歪斜（耐久越低越歪）、核的余量闪烁 */
  sync(props: readonly Prop[]): void {
    for (const p of props) {
      const g = this.groups.get(p.id)
      const body = this.bodies.get(p.id)
      const stub = this.stubs.get(p.id)
      if (!g || !body || !stub) continue
      const r = this.regions.find((x) => x.id === p.regionId)
      const open = r ? this.isRegionOpen(r) : false
      const intact = p.hitsLeft === undefined ? (p.hpLeft ?? 0) > 0 : p.hitsLeft > 0
      g.visible = open && (intact ? this.isExposed(p) : true) // 碎了的只剩残桩，不再受外露门管
      body.visible = intact
      stub.visible = !intact
      if (!intact) continue
      if (p.kind === 'resonance_core' && p.hpPool !== undefined && p.hpPool > 0) {
        // 余量越低越暗：核的血条用亮度画，不另做 UI
        const frac = (p.hpLeft ?? 0) / p.hpPool
        this.coreMat.emissiveIntensity = 0.3 + frac * 1.1
      } else if (p.hitsToBreak !== undefined) {
        // 挨一记歪一分：上限 0.14 rad ≈ 8°（歪太多会读成「要倒了」而不是「裂了」）
        const dmg = 1 - (p.hitsLeft ?? 0) / Math.max(1, p.hitsToBreak)
        body.rotation.z = dmg * 0.14
      }
    }
  }

  dispose(): void {
    for (const g of this.groups.values()) this.scene.remove(g)
    this.groups.clear()
    this.bodies.clear()
    this.stubs.clear()
    this.dark.dispose()
    this.coreMat.dispose()
  }
}
