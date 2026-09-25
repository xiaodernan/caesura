/**
 * 可破坏场景物的灰盒表现（KI-023）。
 * 每根 prop 一个组——全场个位数根，InstancedMesh 的收益为零、逐根状态（歪斜/残桩）的复杂度不为零。
 * 音刺=一根细长黑锥（art-direction.md「刺穿地层的细长黑色尖针」）：灰盒期就用真形状，
 * 因为它的辨识度恰好来自「什么都不像这里」。挨一记歪一分，碎了只剩残桩。
 * 正式资产来了整组替换，sync() 读的状态契约不变。
 */
import { Group, Mesh, MeshStandardMaterial, ConeGeometry, CylinderGeometry } from 'three'
import type { Prop } from './Props'
import type { RegionData } from '@/data/schema'

export class PropVisuals {
  private readonly groups = new Map<string, Group>()
  private readonly spikes = new Map<string, Mesh>()
  private readonly stubs = new Map<string, Mesh>()
  private readonly material = new MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.35, metalness: 0.6 })
  private readonly disposed: Array<() => void> = []

  constructor(
    private readonly scene: import('three').Scene,
    private readonly regions: readonly RegionData[],
    private readonly isRegionOpen: (r: RegionData) => boolean,
  ) {
    for (const r of regions) {
      for (const p of r.props ?? []) {
        const g = new Group()
        g.position.set(p.pos.x, p.pos.y, p.pos.z)
        // 音刺：细长黑锥，略埋进地里（base 半径 0.35 < 命中靶 0.9——判定宽容于视觉，惯例）
        const spike = new Mesh(new ConeGeometry(0.35, 4.2, 6), this.material)
        spike.rotation.x = Math.PI // ConeGeometry 尖朝上；这里让尖朝下=刺穿地层
        spike.position.y = 4.2 / 2
        spike.castShadow = false
        spike.receiveShadow = false
        g.add(spike)
        // 残桩：碎了之后留在原地的那一截（「这里曾经有过一根刺」也是可读信息）
        const stub = new Mesh(new CylinderGeometry(0.3, 0.38, 0.5, 6), this.material)
        stub.position.y = 0.25
        stub.visible = false
        g.add(stub)
        scene.add(g)
        this.groups.set(p.id, g)
        this.spikes.set(p.id, spike)
        this.stubs.set(p.id, stub)
      }
    }
  }

  /** 每帧读 props 状态：可见性（完好+区域已解锁）、歪斜（耐久越低越歪） */
  sync(props: readonly Prop[]): void {
    for (const p of props) {
      const g = this.groups.get(p.id)
      const spike = this.spikes.get(p.id)
      const stub = this.stubs.get(p.id)
      if (!g || !spike || !stub) continue
      const r = this.regions.find((x) => x.id === p.regionId)
      const open = r ? this.isRegionOpen(r) : false
      const intact = p.hitsLeft > 0
      g.visible = open
      spike.visible = intact
      stub.visible = !intact
      if (intact) {
        // 挨一记歪一分：上限 0.14 rad ≈ 8°（歪太多会读成「要倒了」而不是「裂了」）
        const dmg = 1 - p.hitsLeft / Math.max(1, p.hitsToBreak)
        spike.rotation.z = dmg * 0.14
      }
    }
  }

  dispose(): void {
    for (const g of this.groups.values()) this.scene.remove(g)
    this.groups.clear()
    this.spikes.clear()
    this.stubs.clear()
    for (const off of this.disposed.splice(0)) off()
    this.material.dispose()
  }
}
