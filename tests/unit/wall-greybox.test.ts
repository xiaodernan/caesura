/**
 * authored 墙体灰盒（KI-014②）：`regions.json > walls` 里每一块墙都必须跟着流送挂上/摘下。
 *
 * 这一层存在的理由不是"好看"：**遮挡必须是看得见的**。逻辑名册（`core/Occlusion`）已经会吃墙，
 * 而几何还没出现的话，玩家会挨一发"被空气挡住的箭"、红线会剪在一个看不见的面子上。所以这里的
 * 判据全是"数据里的尺寸有没有被原样搬进实例矩阵"——同一份数据、两套读者（逻辑与表现），
 * 谁也不许自己另算一套尺寸。
 *
 * 格键走**真的** `StreamingSystem`（与组合根注入的那一条同一个函数），不在测试里复算格子归属：
 * 一块墙归哪一格是流送层的事，测试复算一遍就变成两套口径互相抄。每个用例自带一套 rig，
 * 因为"哪些格已加载"是这个类的输入状态，用例之间共享会把上一节的残留读成这一节的结论。
 *
 * 不建 WebGL 上下文：InstancedMesh 的矩阵/颜色操作在 headless 下同样可断言（同 greybox.test.ts）。
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { registerGameData, regions } from '@/data'
import type { RegionData, Vec3, WallRef } from '@/data/schema'
import { StreamingSystem, chunkKeyOf, type ChunkState } from '@/world/Streaming'
import { WallGreybox } from '@/world/WallGreybox'

registerGameData()

const ALL_FLAGS = [...new Set(regions.map((r) => r.unlockFlag).filter((f): f is string => !!f))]
/** 与组合根同一个口径：预载中的格也要画（压暗），"已经知道那儿有墙"就该看得见 */
const LOADED: ChunkState[] = ['active', 'resident', 'preloading']

/** 每一块墙 + 它属于哪一片天（数据是唯一来源，测试不许抄一份位置常数） */
const ALL: { wall: WallRef; regionId: string }[] = regions.flatMap((r) =>
  (r.walls ?? []).map((w) => ({ wall: w, regionId: r.id })))

/** 一片天的中心（贴地面）：拿它当传送落点，不必抄任何具体坐标 */
const centerOf = (r: RegionData): Vec => ({
  x: (r.bounds.minX + r.bounds.maxX) / 2, y: r.groundY, z: (r.bounds.minZ + r.bounds.maxZ) / 2,
})
type Vec = { x: number; y: number; z: number }

function rig(start: RegionData) {
  const scene = new THREE.Scene()
  const stream = new StreamingSystem(regions)
  for (const f of ALL_FLAGS) stream.setFlag(f)
  stream.teleport(0, centerOf(start))
  const keyAt = (pos: Vec3): string => { const c = stream.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz) }
  const g = new WallGreybox(scene, regions, keyAt)
  g.syncLoaded(streamKeys(stream))
  return { scene, stream, keyAt, g }
}

const streamKeys = (s: StreamingSystem): string[] =>
  LOADED.flatMap((st) => s.byState(st).map((c) => c.key))

const meshOf = (scene: THREE.Scene): THREE.InstancedMesh =>
  scene.children.find((c) => c instanceof THREE.InstancedMesh && c.name === 'greybox_walls') as THREE.InstancedMesh

const posOf = (m: THREE.Matrix4): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(m)

/** 按**世界位置**找那块墙的实例：实例序号是分配出来的，测试不该依赖它 */
function instanceOf(mesh: THREE.InstancedMesh, w: WallRef): { slot: number; m: THREE.Matrix4 } | null {
  const m = new THREE.Matrix4()
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m)
    const p = posOf(m)
    if (Math.abs(p.x - w.pos.x) < 1e-4 && Math.abs(p.z - w.pos.z) < 1e-4
      && Math.abs(p.y - (w.pos.y + w.heightM / 2)) < 1e-4) return { slot: i, m: m.clone() }
  }
  return null
}

/** 稳定流送：把这一格的加载/卸载全部跑完（loadTicks 是倒数，不是瞬间） */
function settle(s: StreamingSystem, at: Vec, from = 1): void {
  for (let t = from; t < from + 400; t++) s.update(t, at)
}

/** 手工发一条流送事件：payload 其余格由流送层负责，这里只改 state 这一格 */
function emitChunk(key: string, state: ChunkState): void {
  bus.emit('world.chunk', {
    key, regionId: 'test', cx: 0, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 },
    state, priority: 0, tick: 0,
  })
}

const withWalls = regions.filter((r) => (r.walls?.length ?? 0) > 0)

describe('WallGreybox：数据里的每一块墙都跟着流送站住或退场', () => {
  it('容量按数据预算：全场一块 InstancedMesh，实例数 = authored 墙数（drawcall 上限恒定）', () => {
    expect(ALL.length, '数据里 authored 的墙数').toBeGreaterThanOrEqual(8)
    const { scene, g, stream } = rig(withWalls[0])
    expect(ALL.length, '表里的墙数就是灰盒的容量').toBe(g.authored)
    expect(scene.children.filter((c) => c instanceof THREE.InstancedMesh && c.name === 'greybox_walls').length,
      '只有一张网格：墙再加几块也不许多开 drawcall').toBe(1)
    expect(meshOf(scene).count, '实例容量 = 墙数，不随流送增长').toBe(g.authored)
    g.dispose(); stream.dispose()
  })

  it('空场景（没有任何已加载格）⇒ 一块都不站，但容量已经备好', () => {
    const scene = new THREE.Scene()
    const stream = new StreamingSystem(regions)
    const g = new WallGreybox(scene, regions, () => 'never-loaded')
    expect(g.authored).toBe(ALL.length)
    expect(g.live, '没声明加载过的格不该把墙画出来').toBe(0)
    g.syncLoaded([])
    expect(g.live).toBe(0)
    g.dispose(); stream.dispose()
  })

  it('已加载格里的墙一块不落：实例尺寸就是数据里那一格（尺寸不另算一套）', () => {
    const { scene, g, stream, keyAt } = rig(withWalls[0])
    const keys = new Set(streamKeys(stream))
    const expected = ALL.filter((e) => keys.has(keyAt(e.wall.pos)))
    expect(expected.length, '起始那片天的中心至少要带出一块墙').toBeGreaterThan(0)
    expect(g.live, '可见墙数 = 已加载格里的墙数').toBe(expected.length)
    const mesh = meshOf(scene)
    for (const e of expected) {
      const found = instanceOf(mesh, e.wall)
      expect(found, `${e.wall.id} 必须真的站在场上`).not.toBeNull()
      const m = found!.m
      expect(new THREE.Vector3().setFromMatrixColumn(m, 0).length(), '宽：size.x 是全尺寸，直接当缩放').toBeCloseTo(e.wall.size.x, 4)
      expect(new THREE.Vector3().setFromMatrixColumn(m, 1).length(), '高：heightM').toBeCloseTo(e.wall.heightM, 4)
      expect(new THREE.Vector3().setFromMatrixColumn(m, 2).length(), '长：size.z 同上').toBeCloseTo(e.wall.size.z, 4)
      expect(posOf(m).y, `底面在 pos.y（与 boss.covers 同口径），所以中心抬到身高一半`).toBeCloseTo(e.wall.pos.y + e.wall.heightM / 2, 6)
    }
    g.dispose(); stream.dispose()
  })

  it('墙站在自己那片天的 bounds 里、底面贴 groundY：区域是叠层，出界会把墙画到另一层去', () => {
    for (const e of ALL) {
      const r = regions.find((x) => x.id === e.regionId)!
      const b = r.bounds
      expect(e.wall.pos.x >= b.minX && e.wall.pos.x <= b.maxX, `${e.wall.id} 的 x 在 ${e.regionId} 里`).toBe(true)
      expect(e.wall.pos.z >= b.minZ && e.wall.pos.z <= b.maxZ, `${e.wall.id} 的 z 在 ${e.regionId} 里`).toBe(true)
      expect(e.wall.pos.y, '底面 = 该层 groundY：区域层差靠这一格才不串层').toBe(r.groundY)
      expect(e.wall.pos.y + e.wall.heightM, '墙顶不许穿进上层的地面').toBeLessThanOrEqual(b.maxY)
    }
  })

  it('传送换区（真流送事件）⇒ 上一片天的墙退场、新一片天的墙站住，容量与实例数不动', () => {
    const home = withWalls[0]
    const away = withWalls.find((r) => r.id !== home.id)!
    const { scene, stream, keyAt, g } = rig(home)
    const at = centerOf(away)
    stream.teleport(1, at)
    settle(stream, at)
    const keys = new Set(streamKeys(stream))
    const expected = ALL.filter((e) => keys.has(keyAt(e.wall.pos)))
    expect(expected.length, '目标那片天确实有 authored 墙').toBeGreaterThan(0)
    expect(g.live, '可见墙数跟着换区重算：既不多也不漏').toBe(expected.length)
    const mesh = meshOf(scene)
    for (const e of expected) expect(instanceOf(mesh, e.wall), `${e.wall.id} 该站着`).not.toBeNull()
    for (const e of ALL.filter((x) => !keys.has(keyAt(x.wall.pos)))) {
      expect(instanceOf(mesh, e.wall), `${e.wall.id} 在没加载的格里，不该画出来`).toBeNull()
    }
    expect(mesh.count, '换区不许重开网格：容量是数据预算死的').toBe(g.authored)
    expect(g.peakLive, '峰值不超过容量（槽位是复用的）').toBeLessThanOrEqual(g.authored)
    g.dispose(); stream.dispose()
  })

  it('预载格压暗、活动格原色：两种"在那儿但还没到"的读法共用同一张网格', () => {
    const { scene, g, stream, keyAt } = rig(withWalls[0])
    const e = ALL.find((x) => stream.byState('active').some((c) => c.key === keyAt(x.wall.pos)))!
    const mesh = meshOf(scene)
    const found = instanceOf(mesh, e.wall)
    expect(found, '起始格的墙已经站住').not.toBeNull()
    const key = keyAt(e.wall.pos)
    const before = g.live
    const read = (): THREE.Color => { const c = new THREE.Color(); mesh.getColorAt(found!.slot, c); return c }
    const base = new THREE.Color(regions.find((r) => r.id === e.regionId)!.palette.base)
    emitChunk(key, 'preloading')
    const dim = read()
    emitChunk(key, 'active')
    const lit = read()
    expect(lit.r, '活动格用区域底色').toBeCloseTo(base.r, 5)
    expect(lit.g).toBeCloseTo(base.g, 5)
    expect(lit.b).toBeCloseTo(base.b, 5)
    expect(dim.getHex(), '预载格看得出来更暗').not.toBe(lit.getHex())
    expect(Math.max(dim.r, dim.g, dim.b), '而且只暗一档，不是几乎看不见').toBeCloseTo(Math.max(lit.r, lit.g, lit.b) * 0.45, 5)
    expect(g.live, '压暗不是退场：还是那一格墙占那一个槽，不多不少').toBe(before)
    g.dispose(); stream.dispose()
  })

  it('chunk 卸载 ⇒ 该格的墙退场、槽位归还（站住与退场走同一条事件口径）', () => {
    const { scene, g, stream, keyAt } = rig(withWalls[0])
    const keys = new Set(streamKeys(stream))
    const e = ALL.find((x) => keys.has(keyAt(x.wall.pos)))!
    const key = keyAt(e.wall.pos)
    const inCell = ALL.filter((x) => keyAt(x.wall.pos) === key).length
    expect(inCell, '起始格里至少有一块墙').toBeGreaterThan(0)
    const before = g.live
    expect(instanceOf(meshOf(scene), e.wall), '卸载前墙站着').not.toBeNull()
    emitChunk(key, 'unloaded')
    expect(instanceOf(meshOf(scene), e.wall), '卸载后退场（矩阵归零）').toBeNull()
    expect(g.live, '槽位连同该格每一块墙一起归还').toBe(before - inCell)
    emitChunk(key, 'active')
    expect(g.live, '重新加载回来：容量是数据预算死的，槽位只是复用').toBe(before)
    expect(instanceOf(meshOf(scene), e.wall), '且同一块墙回到同一个位置口径').not.toBeNull()
    g.dispose(); stream.dispose()
  })

  it('dispose 之后事件不再改动场景（否则换区会往已销毁的网格上写矩阵）', () => {
    const { scene, stream, keyAt, g } = rig(withWalls[0])
    expect(g.live, '起始格已加载 ⇒ 有墙站着').toBeGreaterThan(0)
    const key = keyAt(ALL[0].wall.pos)
    g.dispose()
    expect(scene.children.length, '网格离开场景树').toBe(0)
    expect(() => emitChunk(key, 'active')).not.toThrow()
    expect(g.live, '退订之后不再接事件').toBe(0)
    stream.dispose()
  })
})
