/**
 * chunk 灰盒表现层（Phase 3-B）：把 StreamingSystem 的 cell 状态变成可见几何。
 * 每区域一张 InstancedMesh（地板）+ 一张（地标棱柱）⇒ 全场常驻 drawcall ≈ 2×区域数。
 * 只订阅 world.chunk 事件，不反向持有流送逻辑（依赖方向：technical-architecture §2）。
 */
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import type { ChunkState } from '@/world/Streaming'
import type { RegionData, Vec3 } from '@/data/schema'

interface ChunkEvent {
  key: string
  regionId: string
  cx: number; cy: number; cz: number
  center: Vec3
  state: ChunkState
  priority: number
  tick: number
}

interface RegionPool {
  region: RegionData
  floor: THREE.InstancedMesh
  props: THREE.InstancedMesh
  freeFloor: number[]
  freeProp: number[]
  lit: THREE.Color
  dim: THREE.Color
}

interface Slot {
  floor: number
  prop: number
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export class ChunkGreybox {
  private readonly pools = new Map<string, RegionPool>()
  private readonly slots = new Map<string, Slot>()
  private readonly unsub: () => void
  private readonly floorGeo: THREE.BoxGeometry
  private readonly propGeo = new THREE.CylinderGeometry(1.8, 3.2, 16, 6)
  private readonly m4 = new THREE.Matrix4()
  private peakFloors = 0

  constructor(
    private readonly scene: THREE.Scene,
    private readonly regionList: readonly RegionData[],
    private readonly chunkSize: number,
  ) {
    this.floorGeo = new THREE.BoxGeometry(chunkSize, 1, chunkSize)
    for (const r of regionList) this.pools.set(r.id, this.buildRegion(r))
    this.unsub = bus.on('world.chunk', (c) => this.apply(c))
  }

  get liveFloors(): number { return this.slots.size }
  get peak(): number { return this.peakFloors }

  dispose(): void {
    this.unsub()
    for (const p of this.pools.values()) {
      this.scene.remove(p.floor, p.props)
      p.floor.dispose()
      p.props.dispose()
    }
    this.pools.clear()
    this.slots.clear()
    this.floorGeo.dispose()
    this.propGeo.dispose()
  }

  /* ---------------- 内部 ---------------- */

  private buildRegion(r: RegionData): RegionPool {
    const cells = this.claimedCells(r)
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.05 })
    const propMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(r.palette.accent),
      emissive: new THREE.Color(r.palette.glow),
      emissiveIntensity: 0.4, roughness: 0.6,
    })
    const floor = new THREE.InstancedMesh(this.floorGeo, floorMat, Math.max(cells, 1))
    const props = new THREE.InstancedMesh(this.propGeo, propMat, Math.max(r.landmarks.length, 1))
    floor.name = `greybox_floor:${r.id}`
    props.name = `greybox_props:${r.id}`
    for (const [mesh, n] of [[floor, Math.max(cells, 1)], [props, Math.max(r.landmarks.length, 1)]] as const) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      mesh.count = n
      for (let i = 0; i < n; i++) {
        mesh.setMatrixAt(i, HIDDEN)
        mesh.setColorAt(i, new THREE.Color(0xffffff))
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.scene.add(mesh)
    }
    const base = new THREE.Color(r.palette.base)
    return {
      region: r,
      floor,
      props,
      freeFloor: Array.from({ length: Math.max(cells, 1) }, (_, i) => i).reverse(),
      freeProp: Array.from({ length: Math.max(r.landmarks.length, 1) }, (_, i) => i).reverse(),
      lit: base,
      dim: base.clone().multiplyScalar(0.45),
    }
  }

  /** 该区域在 48m 网格下认领多少 cell（= 实例池容量上限） */
  private claimedCells(r: RegionData): number {
    const b = r.bounds
    let n = 0
    for (let cx = Math.floor(b.minX / this.chunkSize); cx * this.chunkSize < b.maxX; cx++) {
      for (let cy = Math.floor(b.minY / this.chunkSize); cy * this.chunkSize < b.maxY; cy++) {
        for (let cz = Math.floor(b.minZ / this.chunkSize); cz * this.chunkSize < b.maxZ; cz++) {
          const center = {
            x: cx * this.chunkSize + this.chunkSize / 2,
            y: cy * this.chunkSize + this.chunkSize / 2,
            z: cz * this.chunkSize + this.chunkSize / 2,
          }
          if (this.ownerOf(center) === r.id) n++
        }
      }
    }
    return n
  }

  private ownerOf(center: Vec3): string | null {
    // 与 StreamingSystem.regionAt 同序：先到先得（regions.json 顺序即切片顺序）
    for (const r of this.regionList) if (inBounds(r, center)) return r.id
    return null
  }

  private apply(c: ChunkEvent): void {
    const pool = this.pools.get(c.regionId)
    if (!pool) return
    const held = this.slots.get(c.key)
    if (c.state === 'unloaded') {
      if (held) this.release(c.key, pool, held)
      return
    }
    const entry = held ?? this.acquire(c, pool)
    if (!entry) return
    this.placeFloor(pool, entry.floor, c, c.state === 'active')
    if (entry.prop >= 0) this.placeProp(pool, entry.prop, c)
  }

  private acquire(c: ChunkEvent, pool: RegionPool): { floor: number; prop: number } | null {
    const floor = pool.freeFloor.pop()
    if (floor === undefined) return null // 容量已按认领 cell 数预算
    const prop = pool.freeProp.length > 0 && this.landmarkInCell(pool.region, c) !== null
      ? pool.freeProp.pop()! : -1
    const entry: Slot = { floor, prop }
    this.slots.set(c.key, entry)
    this.peakFloors = Math.max(this.peakFloors, this.slots.size)
    return entry
  }

  private release(key: string, pool: RegionPool, entry: { floor: number; prop: number }): void {
    this.slots.delete(key)
    pool.floor.setMatrixAt(entry.floor, HIDDEN)
    pool.floor.instanceMatrix.needsUpdate = true
    pool.freeFloor.push(entry.floor)
    if (entry.prop >= 0) {
      pool.props.setMatrixAt(entry.prop, HIDDEN)
      pool.props.instanceMatrix.needsUpdate = true
      pool.freeProp.push(entry.prop)
    }
  }

  private placeFloor(pool: RegionPool, index: number, c: ChunkEvent, active: boolean): void {
    const s = 1 - 1e-3 // 留缝，让 chunk 网格本身可读（灰盒阶段这是特性）
    this.m4.makeScale(s, 1, s)
    // 顶面抬高 2cm：与 PlaceholderArena 的地面（同为 groundY）避免 z-fighting
    this.m4.setPosition(c.center.x, pool.region.groundY - 0.5 + 0.02, c.center.z)
    pool.floor.setMatrixAt(index, this.m4)
    pool.floor.setColorAt(index, active ? pool.lit : pool.dim)
    pool.floor.instanceMatrix.needsUpdate = true
    if (pool.floor.instanceColor) pool.floor.instanceColor.needsUpdate = true
  }

  private placeProp(pool: RegionPool, index: number, c: ChunkEvent): void {
    const lm = this.landmarkInCell(pool.region, c)
    if (!lm) { this.m4.makeScale(0, 0, 0) } else { this.m4.identity(); this.m4.setPosition(lm.pos.x, pool.region.groundY + 8, lm.pos.z) }
    pool.props.setMatrixAt(index, this.m4)
    pool.props.instanceMatrix.needsUpdate = true
  }

  private landmarkInCell(r: RegionData, c: ChunkEvent): { pos: Vec3 } | null {
    for (const lm of r.landmarks) {
      if (Math.floor(lm.pos.x / this.chunkSize) === c.cx &&
        Math.floor(lm.pos.y / this.chunkSize) === c.cy &&
        Math.floor(lm.pos.z / this.chunkSize) === c.cz) return lm
    }
    return null
  }
}

function inBounds(r: RegionData, p: Vec3): boolean {
  const b = r.bounds
  return p.x >= b.minX && p.x < b.maxX && p.y >= b.minY && p.y < b.maxY && p.z >= b.minZ && p.z < b.maxZ
}
