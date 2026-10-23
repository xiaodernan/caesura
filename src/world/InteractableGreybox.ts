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
/** 呼吸灯的两端（`animate` 的调音桩脉动）：与 `paint` 同一套色，只是脉动要逐通道插值 */
const CP_BASE = new THREE.Color(COLOR.checkpoint)
const CP_FOCUS = new THREE.Color(FOCUS)
/** 没共鸣过的调音桩：**不亮**（"桩亮=可复活"，KI-157）——与 `paint` 里那格 `SPENT` 同一个色 */
const CP_DIM = new THREE.Color(SPENT)

export class InteractableGreybox {
  private readonly pools = new Map<Kind, Pool>()
  private readonly byCell = new Map<string, Entry[]>()
  private readonly shown = new Map<string, { entry: Entry; index: number; active: boolean }>()
  /** 已加载的格 → 是否 active（值域组换要靠它知道"换完该显示给哪几格"） */
  private readonly loaded = new Map<string, boolean>()
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
    /**
     * 值域谓词（`requiresState` 的读方，组合根注入）。**不满足的条目不画**：
     * 组换的三个变体住在同一个点上，把不成立的那两个也画出来就是三张纸叠在一起闪。
     * （旗标那一路是"画着但变灰"，因为旗标只改变一件东西的成色；值域改的是"这儿有没有它"。）
     */
    private readonly stateOk: (req: { key: string; value: string }) => boolean = () => false,
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
        // 不在场旗：立起来的那一刻把它从格子里摘掉（收摊/撤离）。旗只有 on 广播（没有 off），
        // 所以读档态走下面的初次入场判定（hasFlag 是注入的读数，不是事件重放）。
        for (const cur of [...this.shown.values()]) {
          if (cur.entry.it.setsFlag === f.key) this.paint(cur.entry.it.id)
          if (cur.entry.it.absentFlag === f.key && f.value) this.hide(cur.entry.it.id)
        }
      }),
      // 组换发生在"下一格加载"之前也可能（站在原地把钟敲了），所以这里必须自己跟一遍
      bus.on('world.state', () => this.syncStates()),
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
      this.loaded.delete(key)
      for (const e of list) this.hide(e.it.id)
      return
    }
    this.loaded.set(key, state === 'active')
    for (const e of list) this.show(e, state === 'active')
  }

  /**
   * 值域变了 ⇒ 已加载的格里重新过一遍 `requiresState`：该出现的补上、该退场的摘掉。
   * 不等下一次跨格事件，是因为组换往往就发生在玩家脚下那一格（敲完钟，回头看见陈设换了）。
   */
  private syncStates(): void {
    let touched = false
    for (const [key, active] of this.loaded) {
      for (const e of this.byCell.get(key) ?? []) {
        if (!e.it.requiresState) continue
        if (this.stateOk(e.it.requiresState)) { this.show(e, active); touched = true } else this.hide(e.it.id)
      }
    }
    if (touched) bus.emit('log', { level: 'info', msg: `greybox.stateSwap shown=${this.shown.size}` })
  }

  private show(e: Entry, active: boolean): void {
    if (e.it.requiresState && !this.stateOk(e.it.requiresState)) return // 不成立的变体不占格子
    if (e.it.absentFlag && this.hasFlag(e.it.absentFlag)) return // 不在场：读档态与事件态同一判（收摊之后摊位不画）
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
    // **调音桩的旗标语义与其它 kind 相反**（KI-157，gameplay.md §8「重生点｜最近的调音桩
    // （视觉：桩亮=可复活）」）：对箱子/钟来说旗标＝**已消耗** ⇒ 变灰；对调音桩来说旗标＝
    // **已共鸣** ⇒ 亮着（那一面旗就是"这根桩可以复活"的凭证）。今天这两条用同一个颜色表，
    // 于是**玩家刚共鸣过的那根桩正好是变灰的那一根**——"桩亮=可复活"在画面上是反的。
    const hex = this.focused === id
      ? FOCUS
      : cur.entry.kind === 'checkpoint'
        ? (spent ? COLOR.checkpoint : SPENT)
        : (spent ? SPENT : COLOR[cur.entry.kind])
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

  /**
   * KI-013 打磨：调音桩呼吸灯——每 tick 让亮着的 checkpoint 在基色与焦点色之间
   * 做正弦脉动。InstancedMesh 的 setColorAt 走 instanceColor（GPU 端 per-instance），
   * 只影响 checkpoint 池的那几个实例，别的 kind 不动。main.ts 的 update 里每帧调一次。
   */
  animate(tick: number): void {
    let colorDirty = false
    for (const [, cur] of this.shown) {
      const kind = cur.entry.kind
      const pool = this.pools.get(kind)!

      // 调音桩：呼吸灯（基色 ↔ 焦点色正弦脉动）
      if (kind === 'checkpoint') {
        // **只有共鸣过的桩才亮**（KI-157：gameplay.md §8「视觉：桩亮=可复活」）——
        // 没共鸣过的按"未通"压暗，不参与呼吸。**这一条与 `paint` 同源**：两处都读同一个旗标，
        // 一处画底色、一处画脉动，判据不许各写一份。
        const lit = cur.entry.it.setsFlag !== undefined && this.hasFlag(cur.entry.it.setsFlag)
        if (lit) {
          const pulse = 0.5 + Math.sin(tick * 0.045) * 0.5
          // 脉动必须走 `Color.lerp`：在 packed hex 上加减会跨通道进位
          // （`0xd9b46a + (0xfff2c8 - 0xd9b46a) * 0.5` = 0xECE589，绿通道被进位从 180 吃到 28）
          // ⇒ 那一格"提亮"实际上是把调音桩闪成暗红。逐通道插值，两端就是基色与焦点色。
          this.col.copy(CP_BASE).lerp(CP_FOCUS, pulse * 0.5)
        } else {
          this.col.copy(CP_DIM)
        }
        pool.mesh.setColorAt(cur.index, this.col.multiplyScalar(cur.active ? 1 : 0.5))
        colorDirty = true
      }

      // 采集点：慢速 Y 轴旋转（晶体转动=可采集信号）
      if (kind === 'gather') {
        const m = new THREE.Matrix4()
        const pos = cur.entry.it.pos
        m.makeRotationY(tick * 0.015)
        m.setPosition(pos.x, pos.y + LIFT.gather, pos.z)
        pool.mesh.setMatrixAt(cur.index, m)
        pool.mesh.instanceMatrix.needsUpdate = true
      }

      // NPC：微呼吸（Y 缩放 1±0.02，活的）
      if (kind === 'npc') {
        const m = new THREE.Matrix4()
        const pos = cur.entry.it.pos
        const breathe = 1 + Math.sin(tick * 0.03 + pos.x) * 0.02
        m.makeScale(1, breathe, 1)
        m.setPosition(pos.x, pos.y + LIFT.npc, pos.z)
        pool.mesh.setMatrixAt(cur.index, m)
        pool.mesh.instanceMatrix.needsUpdate = true
      }
    }
    if (colorDirty) {
      const cp = this.pools.get('checkpoint')
      if (cp?.mesh.instanceColor) cp.mesh.instanceColor.needsUpdate = true
    }
  }
}
