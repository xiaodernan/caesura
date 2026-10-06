import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { VfxLayer } from '@/vfx/VfxLayer'

/**
 * VfxLayer：视觉特效层（KI-010 同因：headless 无法截图，只能覆盖逻辑分支）
 *
 * 覆盖缺口（cov19 missing 28 行）：
 * - onHitStop：timeScale 切换 0.14 ↔ 1
 * - attachPlayer：声源锚点注入
 * - stats getter：实例计数、drawCalls
 * - decalRings：地面涟漪三环、hasPlayer 时 y 取 min
 * - resolveDir：dir 优先 → 玩家锚点 → +Z 兜底
 *
 * three 在 node 里本就 headless 可用（几何/材质不编译 shader，actor-visuals 同例），
 * 直接用真件——假 THREE mock 赶不上静态 import 的模块加载时机，只会把用例淹进脚手架。
 */

const layers: VfxLayer[] = []
afterEach(() => {
  // 每个 VfxLayer 都在构造时订阅了 vfx.request / time.hitStop：
  // 不 dispose 的话，用例间的每一次 emit 都会打到所有历史实例上
  for (const l of layers) l.dispose()
  layers.length = 0
})

const makeVfx = (): VfxLayer => {
  const vfx = new VfxLayer(new THREE.Scene())
  layers.push(vfx)
  return vfx
}

describe('VfxLayer：hitStop / player 锚点 / 统计 / decal / 方向解析', () => {
  it('onHitStop：active=true ⇒ timeScale=0.14；active=false ⇒ 恢复 1', () => {
    const vfx = makeVfx()
    expect((vfx as any).timeScale).toBe(1)
    bus.emit('time.hitStop', { active: true })
    expect((vfx as any).timeScale).toBe(0.14)
    vfx.update(1 / 60)
    bus.emit('time.hitStop', { active: false })
    expect((vfx as any).timeScale).toBe(1)
    vfx.update(1 / 60)
  })

  it('attachPlayer：hasPlayer 置真、player 锚点记录', () => {
    const vfx = makeVfx()
    vfx.attachPlayer({ x: 10, y: 2, z: -5 })
    const a = vfx as any
    expect(a.hasPlayer).toBe(true)
    expect(a.player.x).toBe(10)
    expect(a.player.y).toBe(2)
    expect(a.player.z).toBe(-5)
  })

  it('stats getter：空层四个池 live=0、emitters=0、drawCalls=4', () => {
    const vfx = makeVfx()
    const s = vfx.stats
    expect(s.rings).toBe(0)
    expect(s.decals).toBe(0)
    expect(s.sparks).toBe(0)
    expect(s.shards).toBe(0)
    expect(s.particles).toBe(0)
    expect(s.emitters).toBe(0)
    expect(s.drawCalls).toBe(4) // 四个 InstancedBuffer 池 = 四次 draw call
    expect(s.peakParticles).toBe(0)
  })

  it('decalRings：一次 decal_rings 请求落三道同心环；attachPlayer 后仍然成立（y 取 min 不动环数）', () => {
    const vfx = makeVfx()
    bus.emit('vfx.request', { key: 'decal_rings', pos: { x: 0, y: 1, z: 0 }, scale: 1 })
    vfx.update(1 / 60)
    expect(vfx.stats.decals).toBe(3)

    vfx.attachPlayer({ x: 0, y: 5, z: 0 })
    bus.emit('vfx.request', { key: 'decal_rings', pos: { x: 0, y: 2, z: 0 }, scale: 1 })
    vfx.update(1 / 60)
    expect(vfx.stats.decals).toBe(6)
  })

  it('resolveDir 回退链：req.dir 优先 → 玩家锚点方向 → +Z 兜底，全部归一化', () => {
    const vfx = makeVfx()
    const resolve = (req: unknown): THREE.Vector3 => (vfx as any).resolveDir(req)

    // 1) req.dir 存在 ⇒ 直接用（归一化）
    const d1 = resolve({ key: 'hit_ring', pos: { x: 0, y: 0, z: 0 }, scale: 1, dir: { x: 2, y: 0, z: 0 } })
    expect(d1.x).toBeCloseTo(1, 6)
    expect(d1.y).toBeCloseTo(0, 6)
    expect(d1.z).toBeCloseTo(0, 6)

    // 2) 无 dir + hasPlayer ⇒ 从玩家锚点指向特效点（(0-10, 0, 0) 归一化）
    vfx.attachPlayer({ x: 10, y: 0, z: 0 })
    const d2 = resolve({ key: 'hit_ring', pos: { x: 0, y: 0, z: 0 }, scale: 1 })
    expect(d2.x).toBeCloseTo(-1, 6)
    expect(d2.y).toBeCloseTo(0, 6)
    expect(d2.z).toBeCloseTo(0, 6)

    // 3) 无 dir + 无 player ⇒ +Z
    const vfx2 = makeVfx()
    const d3 = (vfx2 as any).resolveDir({ key: 'hit_ring', pos: { x: 0, y: 0, z: 0 }, scale: 1 })
    expect(d3.x).toBeCloseTo(0, 6)
    expect(d3.y).toBeCloseTo(0, 6)
    expect(d3.z).toBeCloseTo(1, 6)
  })
})
