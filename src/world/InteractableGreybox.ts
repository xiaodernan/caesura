/**
 * 交互物占位模（Phase 3-C3）：让 26 个 `RegionData.interactables` 在灰盒里**看得见**。
 * 依赖方向同 ChunkGreybox：只订阅事件（`world.chunk` / `ui.prompt` / `world.flag`），
 * 不 import 逻辑运行时，因此 arch 闸门里它属于表现层。
 *
 * 预算：按 kind 分池，每种一张 InstancedMesh ⇒ 常驻 drawcall = 数据里出现过的 kind 数
 * （当前 9），与 chunk 数、区域数无关；容量 = 该 kind 的条目数，永不增删对象，
 * 挂/摘用零缩放矩阵（HIDDEN）+ 版本位更新。
 */
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import type { ChunkState } from '@/world/Streaming'
import type { InteractableRef, RegionData, Vec3 } from '@/data/schema'

type Kind = InteractableRef['kind']

interface Entry {
  it: InteractableRef
  kind: Kind
  cellKey: string
}

interface Pool {
  mesh: THREE.InstancedMesh
  geo: THREE.BufferGeometry
  mat: THREE.MeshStandardMaterial
  free: number[]
}

/** kind → 占位形状（只要求「一眼看出这是门还是井」，正式模在 Phase 7 替换） */
const GEOMETRY: Record<Kind, () => THREE.BufferGeometry> = {
  checkpoint: () => new THREE.CylinderGeometry(0.22, 0.5, 3.2, 8),   // 调音桩
  gate: () => new THREE.BoxGeometry(5, 5, 0.8),                      // 闸门框
  elevator: () => new THREE.CylinderGeometry(0.9, 0.9, 7, 10, 1, true), // 井笼（开口筒）
  bridge: () => new THREE.BoxGeometry(9, 0.4, 3),                    // 吊桥板
  soundwall: () => new THREE.BoxGeometry(7, 7, 1.2),                 // 音壁
  gather: () => new THREE.IcosahedronGeometry(0.7, 0),               // 采集点
  chest: () => new THREE.BoxGeometry(1.3, 0.9, 0.9),                 // 箱
  npc: () => new THREE.CapsuleGeometry(0.35, 1.1, 4, 8),             // 人
  teleport: () => new THREE.TorusGeometry(1.6, 0.16, 8, 24),         // 位移环
  bell: () => new THREE.ConeGeometry(1.4, 3.4, 10),                  // 落钟
  inspect: () => new THREE.DodecahedronGeometry(0.9, 0),             // 可研读的碑石（KI-041 石堆）
  shop: () => new THREE.BoxGeometry(2.6, 1.1, 1.2),                  // 商摊（KI-055②）
}

/** kind → 离地高度（形状半高，让条目「站在」数据给的点上而不是陷进去） */
const LIFT: Record<Kind, number> = {
  checkpoint: 1.6, gate: 2.5, elevator: 3.5, bridge: 0.2, soundwall: 3.5,
  gather: 0.7, chest: 0.45, npc: 0.9, teleport: 0.2, bell: 1.7, inspect: 0.9, shop: 0.55,
}

/** 三档状态色：可用 / 已消耗（setsFlag 已置位）/ 焦点 */
const COLOR: Record<Kind, number> = {
  checkpoint: 0xd9b46a, gate: 0x9fb0b8, elevator: 0x74a8a0, bridge: 0x8a7f74,
  soundwall: 0xa3262b, gather: 0x8fae6d, chest: 0xb08d4f, npc: 0xcfc4b0,
  teleport: 0x6f7fd8, bell: 0xd9b46a, inspect: 0x9db8a8, shop: 0xc98d4f,
}
const SPENT = 0x4a4e55
const FOCUS = 0xfff2c8
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export class InteractableGreybox {
  private readonly pools = new Map<Kind, Pool>()
  private readonly byCell = new Map<string, Entry[]>()
  private readonly shown = new Map<string, { entry: Entry; index: number; active: boolean }>()
  private focused: string | null = null
  private readonly unsub: Array<() => void> = []
  private readonly m4 = new THREE.Matrix4()
  private readonly col = new THREE.Color()
  private peakProps = 0

  constructor(
    private readonly scene: THREE.Scene,
    regions: readonly RegionData[],
    /** 格键格式由组合根注入（同一份 chunkKeyOf），表现层不 import 流送运行时 */
    cellKey: (pos: Vec3) => string,
    /** flag 谓词同样注入：读档后 flag 已经在了，不能只靠事件补色（否则存档态不可见） */
    private readonly hasFlag: (key: string) => boolean,
  ) {
    const entries: Entry[] = []
    for (const r of regions) {
      for (const it of r.interactables) {
        entries.push({ it, kind: it.kind, cellKey: cellKey(it.pos) })
      }
    }
    for (const e of entries) {
      const list = this.byCell.get(e.cellKey)
      if (list) list.push(e); else this.byCell.set(e.cellKey, [e])
    }
    for (const kind of new Set(entries.map((e) => e.kind))) {
      const items = entries.filter((e) => e.kind === kind)
      const geo = GEOMETRY[kind]()
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 })
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(items.length, 1))
      mesh.name = `greybox_node:${kind}`
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.count = Math.max(items.length, 1)
      for (let i = 0; i < mesh.count; i++) {
        mesh.setMatrixAt(i, HIDDEN)
        mesh.setColorAt(i, this.col.setHex(COLOR[kind]))
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.scene.add(mesh)
      this.pools.set(kind, { mesh, geo, mat, free: Array.from({ length: mesh.count }, (_, i) => i).reverse() })
    }

    this.unsub.push(
      bus.on('world.chunk', (c) => this.onChunk(c.key, c.state)),
      bus.on('ui.prompt', (p) => this.onFocus(p.id)),
      bus.on('world.flag', (f) => {
        for (const cur of this.shown.values()) if (cur.entry.it.setsFlag === f.key) this.paint(cur.entry.it.id)
      }),
    )
  }

  get liveProps(): number { return this.shown.size }
  get poolCount(): number { return this.pools.size }
  get peak(): number { return this.peakProps }

  /** 流送层在构造前就已激活的格（组合根用一次，避免等下一次跨格事件） */
  syncActive(keys: Iterable<string>): void {
    for (const k of keys) this.onChunk(k, 'active')
  }

  dispose(): void {
    for (const off of this.unsub) off()
    this.unsub.length = 0
    for (const p of this.pools.values()) {
      this.scene.remove(p.mesh)
      p.mesh.dispose()
      p.geo.dispose()
      p.mat.dispose()
    }
    this.pools.clear()
    this.shown.clear()
  }

  /* ---------------- 内部 ---------------- */

  private onChunk(key: string, state: ChunkState): void {
    const list = this.byCell.get(key)
    if (!list) return
    if (state === 'unloaded') {
      for (const e of list) this.hide(e.it.id)
      return
    }
    for (const e of list) this.show(e, state === 'active')
  }

  private show(e: Entry, active: boolean): void {
    const cur = this.shown.get(e.it.id)
    if (cur) { if (cur.active !== active) { cur.active = active; this.paint(e.it.id) } return }
    const pool = this.pools.get(e.kind)
    const index = pool?.free.pop()
    if (!pool || index === undefined) return // 容量已按条目数预算
    this.m4.identity()
    this.m4.setPosition(e.it.pos.x, e.it.pos.y + LIFT[e.kind], e.it.pos.z)
    pool.mesh.setMatrixAt(index, this.m4)
    pool.mesh.instanceMatrix.needsUpdate = true
    this.shown.set(e.it.id, { entry: e, index, active })
    this.paint(e.it.id)
    this.peakProps = Math.max(this.peakProps, this.shown.size)
  }

  private hide(id: string): void {
    const cur = this.shown.get(id)
    if (!cur) return
    const pool = this.pools.get(cur.entry.kind)!
    pool.mesh.setMatrixAt(cur.index, HIDDEN)
    pool.mesh.instanceMatrix.needsUpdate = true
    pool.free.push(cur.index)
    this.shown.delete(id)
    if (this.focused === id) this.focused = null
  }

  private paint(id: string): void {
    const cur = this.shown.get(id)
    if (!cur) return
    const pool = this.pools.get(cur.entry.kind)!
    const spent = cur.entry.it.setsFlag !== undefined && this.hasFlag(cur.entry.it.setsFlag)
    const hex = this.focused === id ? FOCUS : spent ? SPENT : COLOR[cur.entry.kind]
    pool.mesh.setColorAt(cur.index, this.col.setHex(hex).multiplyScalar(cur.active ? 1 : 0.5))
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true
  }

  private onFocus(id: string | null): void {
    const prev = this.focused
    if (prev === id) return
    this.focused = id
    if (prev) this.paint(prev)
    if (id) this.paint(id)
  }
}
