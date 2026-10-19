import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerGameData, regions } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { ChunkGreybox } from '@/world/ChunkGreybox'

/**
 * **开局那批 chunk 事件在表现层订阅之前就发完了**（KI-135）。
 *
 * **生产顺序**（`src/main.ts`）：`new StreamingSystem(regions)` → `streaming.teleport(0, player.pos)`
 * → …（一百多行）… → `new ChunkGreybox(...)`。
 * 那次传送**立刻**把开局那批 chunk 事件发出去（state=active），而**那时还没人订阅**
 * ⇒ 那些格子的地板**永远不会被铺上**。
 *
 * **后果不是"少一块地板"**：玩家开局站在 `PlaceholderArena` 那张深色大地面上（`141821`），
 * 整幅画面下半屏是黑的——实机像素读数：修之前 **1.18/255**，修之后 **94.41/255**
 * （用 `?fresh=1` 冷启动 + `gl.readPixels` 量的，见 KI-135 账本行）。
 * 这正是用户报的「场景太黑了，啥都看不清」。
 *
 * **为什么以前没被抓住**：`tests/unit/greybox.test.ts` 的构造顺序是**反的**
 * （先建灰盒、后 teleport）⇒ 它测的那条路径里事件都有人接。
 * 本文件**按生产顺序**复现。
 */
registerGameData()

const size = regions[0].chunkSize
const root = fileURLToPath(new URL('../..', import.meta.url))

/** 实例矩阵里"没有被压扁"（scale>0）的那些 ⇒ 真的铺上去了 */
function visibleFloors(mesh: THREE.InstancedMesh): { x: number; z: number }[] {
  const arr = mesh.instanceMatrix.array as ArrayLike<number>
  const out: { x: number; z: number }[] = []
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 16
    if (Math.abs(arr[o]) < 1e-6) continue // 缩放为 0 ⇒ 那一格还没铺 / 已被收走
    out.push({ x: arr[o + 12], z: arr[o + 14] })
  }
  return out
}

const floorMeshOf = (scene: THREE.Scene, regionId: string): THREE.InstancedMesh =>
  scene.children.find(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.name === `greybox_floor:${regionId}`,
  )!

describe('开局那批 chunk：表现层必须补一次（KI-135）', () => {
  it('生产顺序复现：先 teleport、后建灰盒 ⇒ 不补 syncLoaded 时那些格子的地板**没铺**', () => {
    const scene = new THREE.Scene()
    const stream = new StreamingSystem(regions)
    // ① 生产顺序：传送在先（事件此刻就发出去）
    stream.teleport(0, { x: 0, y: 0, z: 0 })
    // ② 表现层此刻才构造（订阅从这一刻才开始）
    const greybox = new ChunkGreybox(scene, regions, size)
    const mesh = floorMeshOf(scene, 'rg_resthold')
    const placed = visibleFloors(mesh)
    expect(placed.length, '不补 syncLoaded ⇒ 开局那批格子一块地板都没铺').toBe(0)
    expect(greybox.liveFloors, '灰盒连槽位都没拿到（那批事件在它构造之前就发完了）').toBe(0)
    greybox.dispose()
    stream.dispose()
  })

  it('补上 syncLoaded ⇒ 玩家脚下那一格的地板真的铺上了', () => {
    const scene = new THREE.Scene()
    const stream = new StreamingSystem(regions)
    stream.teleport(0, { x: 0, y: 0, z: 0 })
    const greybox = new ChunkGreybox(scene, regions, size)
    // 组合根那一句：问一次"现在有哪些格是加载好的"
    const loaded = ['active', 'resident', 'preloading'].flatMap((s) =>
      stream.byState(s as 'active').map((c) => ({
        key: c.key,
        regionId: c.regionId,
        cx: c.cx, cy: c.cy, cz: c.cz,
        center: c.center,
        state: c.state,
        priority: c.priority,
        tick: 0,
      })),
    )
    greybox.syncLoaded(loaded)
    const mesh = floorMeshOf(scene, 'rg_resthold')
    const placed = visibleFloors(mesh)
    expect(placed.length, '补过之后那批格子的地板都铺上了').toBeGreaterThan(0)
    // 玩家所在格（cell 0,0,0）必须有一块地板在它下面
    const cellCenter = { x: 0 * size + size / 2, z: 0 * size + size / 2 }
    expect(
      placed.some((p) => Math.abs(p.x - cellCenter.x) < size && Math.abs(p.z - cellCenter.z) < size),
      '玩家脚下那一格的地板必须在（不然开局就是站在虚空上）',
    ).toBe(true)
    greybox.dispose()
    stream.dispose()
  })

  it('组合根真的调了它（源码扫描）——不然生产路径上还是黑的', () => {
    const main = readFileSync(root + 'src/main.ts', 'utf8')
    expect(main, 'main.ts 必须有 greybox.syncLoaded(').toContain('greybox.syncLoaded(')
    // 而且要**在** new ChunkGreybox 之后
    const ctor = main.indexOf('new ChunkGreybox(')
    const sync = main.indexOf('greybox.syncLoaded(')
    expect(ctor, '先有构造').toBeGreaterThanOrEqual(0)
    expect(sync, '后有补齐').toBeGreaterThan(ctor)
  })
})
