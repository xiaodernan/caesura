/**
 * chunk 灰盒表现层（Phase 3-B）：只订阅 world.chunk，验证「可见实例数跟着流送走、
 * drawcall 上限恒定、往返不泄漏、板面顶高 = 该层 groundY」。
 * 这里不建 WebGL 上下文：InstancedMesh 的矩阵/颜色操作在 headless 下同样可断言。
 */
import { afterAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { registerGameData, regions } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { ChunkGreybox } from '@/world/ChunkGreybox'

registerGameData()

const ALL_FLAGS = [...new Set(regions.map((r) => r.unlockFlag).filter((f): f is string => !!f))]
const size = regions[0].chunkSize

function system(): StreamingSystem {
  const s = new StreamingSystem(regions)
  for (const f of ALL_FLAGS) s.setFlag(f)
  return s
}

/** 扫描某张 InstancedMesh 的实例矩阵，返回未被压扁（scale>0）的实例 */
function visible(mesh: THREE.InstancedMesh): { x: number; y: number; z: number }[] {
  const arr = mesh.instanceMatrix.array as ArrayLike<number>
  const out: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 16
    if (Math.abs(arr[o]) < 1e-6) continue // 缩放为 0 ⇒ HIDDEN
    out.push({ x: arr[o + 12], y: arr[o + 13], z: arr[o + 14] })
  }
  return out
}

function floorsOf(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.name.startsWith('greybox_floor:'),
  )
}

/**
 * 用 StreamingSystem 的公开认领规则（cell 中心归属谁）独立复算一遍格数，
 * 与表现层自行预算的实例容量交叉核对（两套实现必须给出同一个数）。
 */
function claimed(regionId: string): number {
  const r = regions.find((x) => x.id === regionId)!
  const s = new StreamingSystem(regions)
  const b = r.bounds
  let n = 0
  for (let cx = Math.floor(b.minX / size); cx * size < b.maxX; cx++) {
    for (let cy = Math.floor(b.minY / size); cy * size < b.maxY; cy++) {
      for (let cz = Math.floor(b.minZ / size); cz * size < b.maxZ; cz++) {
        const center = { x: cx * size + size / 2, y: cy * size + size / 2, z: cz * size + size / 2 }
        if (s.regionAt(center)?.id === regionId) n++
      }
    }
  }
  s.dispose()
  return Math.max(n, 1)
}

describe('ChunkGreybox（world.chunk -> 可见几何）', () => {
  const scene = new THREE.Scene()
  const stream = system()
  const greybox = new ChunkGreybox(scene, regions, size)
  afterAll(() => { greybox.dispose(); stream.dispose() })

  const liveChunks = (): number => stream.all().filter((c) => c.state !== 'unloaded').length

  it('构造即建出每区域两张 InstancedMesh，且不再随 chunk 增加 drawcall 对象', () => {
    expect(scene.children.length).toBe(regions.length * 2)
    expect(floorsOf(scene).length).toBe(regions.length)
    stream.teleport(0, { x: 0, y: 0, z: 0 })
    expect(greybox.liveFloors).toBe(liveChunks())
    expect(greybox.liveFloors).toBeGreaterThan(0)
    expect(scene.children.length).toBe(regions.length * 2)
  })

  it('每区域地板实例数 = 该区域在网格下认领的 cell 数（预算刚好，不超发也不缺额）', () => {
    for (const mesh of floorsOf(scene)) {
      const rid = mesh.name.slice('greybox_floor:'.length)
      expect(mesh.count, rid).toBe(claimed(rid))
    }
  })

  it('忽略未知区域的事件（表现层不对 regionId 做强假设）', () => {
    const before = greybox.liveFloors
    bus.emit('world.chunk', {
      key: '99,99,99', regionId: 'rg_not_a_region', cx: 99, cy: 99, cz: 99,
      center: { x: 0, y: 0, z: 0 }, state: 'active', priority: 0, tick: 1,
    })
    expect(greybox.liveFloors).toBe(before)
  })

  it('板面顶高 = 所属层 groundY（+2cm 防 z-fighting），且落在 cell 中心', () => {
    const hub = scene.getObjectByName('greybox_floor:rg_resthold') as THREE.InstancedMesh
    const cells = stream.byState('active').filter((c) => c.regionId === 'rg_resthold')
    expect(cells.length).toBeGreaterThan(0)
    const plates = visible(hub)
    for (const c of cells) {
      const hit = plates.find((p) => Math.abs(p.x - c.center.x) < 1 && Math.abs(p.z - c.center.z) < 1)
      expect(hit, `plate for ${c.key}`).toBeDefined()
      expect(hit!.y).toBeCloseTo(0 - 0.5 + 0.02, 3)
    }
    const upper = scene.getObjectByName('greybox_floor:rg_fellcarillon') as THREE.InstancedMesh
    stream.teleport(100, { x: 150, y: 64, z: -300 })
    for (const p of visible(upper)) expect(p.y).toBeCloseTo(64 - 0.5 + 0.02, 3)
  })

  it('走远后防抖卸载会把实例归还池子（可见数 = 存活 chunk 数）', () => {
    let t = 200
    for (; t < 200 + 600; t++) stream.update(t, { x: 0, y: 0, z: 0 })
    expect(greybox.liveFloors).toBe(liveChunks())
    expect(greybox.liveFloors).toBeLessThan(stream.all().length + 1)
  })

  it('反复横跳不泄漏实例：可见数始终等于存活 chunk 数，回到原点后槽位一致', () => {
    const home = { x: 0, y: 0, z: 0 }
    let t = 1000
    t = settleAt(stream, t, home)
    const first = greybox.liveFloors
    for (const far of [{ x: 200, y: 0, z: -150 }, { x: 300, y: -40, z: 0 }, { x: 150, y: 64, z: -300 }]) {
      stream.teleport(++t, far)
      t = settleAt(stream, t, far)
      expect(greybox.liveFloors, `at ${far.x},${far.y},${far.z}`).toBe(liveChunks())
      stream.teleport(++t, home)
      t = settleAt(stream, t, home)
      expect(greybox.liveFloors, 'back home').toBe(liveChunks())
    }
    // 防抖窗口（120 tick）走完后，远端格子才真正归还槽位
    for (let k = 0; k < 400; k++) { t++; stream.update(t, home) }
    expect(greybox.liveFloors).toBe(first)
    expect(greybox.peak).toBeGreaterThanOrEqual(first)
  })

  it('dispose 之后事件不再改变场景', () => {
    const local = new THREE.Scene()
    const g = new ChunkGreybox(local, regions, size)
    const s2 = system()
    s2.teleport(0, home())
    expect(local.children.length).toBe(regions.length * 2)
    expect(g.liveFloors).toBeGreaterThan(0)
    g.dispose()
    s2.dispose()
    expect(local.children.length).toBe(0)
    const before = g.liveFloors
    bus.emit('world.chunk', {
      key: '0,0,0', regionId: 'rg_resthold', cx: 0, cy: 0, cz: 0,
      center: { x: 24, y: 24, z: 24 }, state: 'active', priority: 0, tick: 9,
    })
    expect(g.liveFloors).toBe(before)
  })
})

function home(): { x: number; y: number; z: number } { return { x: 0, y: 0, z: 0 } }

function settleAt(s: StreamingSystem, fromTick: number, pos: { x: number; y: number; z: number }, max = 4000): number {
  let t = fromTick
  while (t - fromTick < max) {
    t++
    s.update(t, pos)
    if (s.stats().queued === 0 && s.inFlight === 0) return t
  }
  return t
}
