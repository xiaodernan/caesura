/**
 * authored 墙体灰盒（KI-014②）：把 `regions.json > walls` 那些塌墙/岩脊/回廊墩画出来。
 *
 * 为什么这一层非做不可：**遮挡必须是看得见的**。判据先落地、几何还没出现的话，玩家会挨一发
 * "被空气挡住的箭"，而红线会剪在一个看不见的面子上——那正是 §14.4 说的"骗人"。所以这张表
 * 与逻辑名册（`core/Occlusion`）读同一份数据，谁也不许自己另算一套尺寸。
 *
 * 依赖方向同 InteractableGreybox：只订阅 `world.chunk`，格键格式由组合根注入
 * （同一份 `chunkKeyOf`），表现层不 import 流送运行时；arch 闸门里它属于表现层。
 *
 * 预算：全场**一张** InstancedMesh（单位立方体 × 每块墙自己的缩放），容量 = 数据里的墙数，
 * 永不增删对象，挂/摘用零缩放矩阵。当前 12 块墙 ⇒ 常驻 1 个 drawcall。
 */
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import type { ChunkState } from '@/world/Streaming'
import type { RegionData, Vec3, WallRef } from '@/data/schema'

interface Entry {
  wall: WallRef
  regionId: string
  cellKey: string
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export class WallGreybox {
  private readonly byCell = new Map<string, Entry[]>()
  private readonly base = new Map<string, string>()
  /** 站住的墙：`wall.id` → 实例序号（与 `free` 互为补集） */
  private readonly index = new Map<string, number>()
  private readonly free: number[]
  private readonly mesh: THREE.InstancedMesh
  private readonly geo = new THREE.BoxGeometry(1, 1, 1)
  private readonly mat: THREE.MeshStandardMaterial
  private readonly unsub: () => void
  private readonly m4 = new THREE.Matrix4()
  private readonly col = new THREE.Color()
  private readonly total: number
  private peak = 0

  constructor(
    scene: THREE.Scene,
    regions: readonly RegionData[],
    /** 格键格式由组合根注入：一块墙归属哪一格是流送层的事，这里只认那个字符串 */
    cellKeyOf: (pos: Vec3) => string,
  ) {
    const entries: Entry[] = []
    for (const r of regions) {
      this.base.set(r.id, r.palette.base)
      for (const wall of r.walls ?? []) entries.push({ wall, regionId: r.id, cellKey: cellKeyOf(wall.pos) })
    }
    this.total = entries.length
    for (const e of entries) {
      const list = this.byCell.get(e.cellKey)
      if (list) list.push(e); else this.byCell.set(e.cellKey, [e])
    }
    this.free = Array.from({ length: Math.max(this.total, 1) }, (_, i) => i).reverse()
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.04 })
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(this.total, 1))
    this.mesh.name = 'greybox_walls'
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    for (let i = 0; i < this.mesh.count; i++) {
      this.mesh.setMatrixAt(i, HIDDEN)
      this.mesh.setColorAt(i, this.col.set('#ffffff'))
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    scene.add(this.mesh)
    this.unsub = bus.on('world.chunk', (c) => this.onChunk(c.key, c.state))
  }

  /** 站住的墙数：等于 `authored` 就说明数据里每一块都挂上了实例 */
  get live(): number { return this.index.size }
  get authored(): number { return this.total }
  get peakLive(): number { return this.peak }

  /** 构造前就已加载的格（组合根用一次，否则第一批要等到下一次跨格事件才现身） */
  syncLoaded(keys: Iterable<string>): void {
    for (const k of keys) this.onChunk(k, 'active')
  }

  dispose(): void {
    this.unsub()
    this.mesh.removeFromParent()
    this.mesh.dispose()
    this.geo.dispose()
    this.mat.dispose()
    this.index.clear()
    this.byCell.clear()
  }

  /* ---------------- 内部 ---------------- */

  private onChunk(key: string, state: ChunkState): void {
    const list = this.byCell.get(key)
    if (!list) return
    for (const e of list) {
      if (state === 'unloaded') this.hide(e.wall.id)
      else this.place(e, state === 'active')
    }
  }

  private place(e: Entry, active: boolean): void {
    let slot = this.index.get(e.wall.id)
    if (slot === undefined) {
      slot = this.free.pop()
      if (slot === undefined) return // 容量已按条目数预算，走到这里说明数据比预算长
      this.index.set(e.wall.id, slot)
      this.peak = Math.max(this.peak, this.index.size)
      const w = e.wall
      this.m4.makeScale(w.size.x, w.heightM, w.size.z)
      // pos.y 是**墙底**（与 boss.covers 同口径），单位立方体的中心在身高一半处
      this.m4.setPosition(w.pos.x, w.pos.y + w.heightM / 2, w.pos.z)
      this.mesh.setMatrixAt(slot, this.m4)
      this.mesh.instanceMatrix.needsUpdate = true
    }
    this.col.setStyle(this.base.get(e.regionId) ?? '#ffffff')
    if (!active) this.col.multiplyScalar(0.45) // 预载格：压暗，与地板同一套"在那儿但还没到"的读法
    this.mesh.setColorAt(slot, this.col)
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  private hide(id: string): void {
    const slot = this.index.get(id)
    if (slot === undefined) return
    this.mesh.setMatrixAt(slot, HIDDEN)
    this.mesh.instanceMatrix.needsUpdate = true
    this.index.delete(id)
    this.free.push(slot)
  }
}
