import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { VfxLayer, VFX_BUDGET } from '@/vfx/VfxLayer'
import { VFX_PALETTE } from '@/vfx/materials'

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

/**
 * KI-105② 的 vfx 侧（observeWave / observeMark / observeTrail）：观察系统画在脚下的圈
 * 就是「显形判据」本身（源码注释原话），所以这三个原语的半径、迟滞、色、波形逐格可断言——
 * 谁偷改一个数，显形判据就被挪了。环行数据落在 Float32Array 里，断言一律 toBeCloseTo（float32 精度）。
 */
describe('VfxLayer：KI-105 声纹观察三原语', () => {
  /** rings 池各实例属性（行主序），从 mesh 几何上公开读出 */
  function ringAttrs(vfx: VfxLayer): Map<string, THREE.InstancedBufferAttribute> {
    const geo = ((vfx as any).rings as { mesh: THREE.Mesh }).mesh.geometry
    return new Map(['aOrigin', 'aColor', 'aBirth', 'aDur', 'aR0', 'aR1', 'aWidth', 'aParam'].map(
      (k) => [k, geo.getAttribute(k) as THREE.InstancedBufferAttribute],
    ))
  }
  /** 取 row 行的分量 */
  function row(m: Map<string, THREE.InstancedBufferAttribute>, k: string, r: number): number[] {
    const a = m.get(k)!
    return Array.from(a.array.slice(r * a.itemSize, (r + 1) * a.itemSize))
  }
  function close(got: number[], want: number[]): void {
    expect(got).toHaveLength(want.length)
    want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 5))
  }

  it('observeWave：脚下荡开的主环（银，y+0.05）+ 迟 0.12s 的回声环（金，y+0.06），同一 r1/dur、波形各一组', () => {
    const vfx = makeVfx()
    vfx.observeWave(2, 0, -3, 4.5, 2.5)
    const m = ringAttrs(vfx)
    expect(((vfx as any).rings as { live: number }).live).toBe(2)
    const silver = new THREE.Color(VFX_PALETTE.silver)
    const gold = new THREE.Color(VFX_PALETTE.warmGold)
    // 主环：delay=0（birth=0），r0=0.3 → r1=4.5，dur 原样进 aDur
    close(row(m, 'aOrigin', 0), [2, 0.05, -3])
    close(row(m, 'aColor', 0), [silver.r, silver.g, silver.b])
    close(row(m, 'aBirth', 0), [0])
    close(row(m, 'aDur', 0), [2.5])
    close(row(m, 'aR0', 0), [0.3])
    close(row(m, 'aR1', 0), [4.5])
    close(row(m, 'aWidth', 0), [0.5])
    close(row(m, 'aParam', 0), [0, 0.55, 0.3, 0.5]) // split/fringe/wave/intensity
    // 回声环：迟半步（birth=0.12）、再抬一指（y+0.06）、同半径同时长；split=1、更窄更淡
    close(row(m, 'aOrigin', 1), [2, 0.06, -3])
    close(row(m, 'aColor', 1), [gold.r, gold.g, gold.b])
    close(row(m, 'aBirth', 1), [0.12])
    close(row(m, 'aDur', 1), [2.5])
    close(row(m, 'aR1', 1), [4.5])
    close(row(m, 'aWidth', 1), [0.3])
    close(row(m, 'aParam', 1), [1, 0.8, 0.22, 0.36])
  })

  it('observeMark：敌人金宽环（split=1、r1=1.3、intensity=0.9），交互物银窄环（split=0、r1=0.85、intensity=0.6），同 y/同 dur', () => {
    const vfx = makeVfx()
    vfx.observeMark(0, 0, 0, true)
    vfx.observeMark(1, 0, 1, false)
    const m = ringAttrs(vfx)
    expect(((vfx as any).rings as { live: number }).live).toBe(2)
    const silver = new THREE.Color(VFX_PALETTE.silver)
    const gold = new THREE.Color(VFX_PALETTE.warmGold)
    close(row(m, 'aOrigin', 0), [0, 0.04, 0])
    close(row(m, 'aColor', 0), [gold.r, gold.g, gold.b])
    close(row(m, 'aR0', 0), [0.25])
    close(row(m, 'aR1', 0), [1.3])
    close(row(m, 'aWidth', 0), [0.16])
    close(row(m, 'aParam', 0), [1, 0.7, 0.3, 0.9])
    close(row(m, 'aOrigin', 1), [1, 0.04, 1])
    close(row(m, 'aColor', 1), [silver.r, silver.g, silver.b])
    close(row(m, 'aR0', 1), [0.25])
    close(row(m, 'aR1', 1), [0.85])
    close(row(m, 'aWidth', 1), [0.12])
    close(row(m, 'aParam', 1), [0, 0.7, 0.3, 0.6])
    // 标记是即时信息：delay=0，短命 0.7s——「信息过去这阵风就散」
    close(row(m, 'aBirth', 0), [0])
    close(row(m, 'aBirth', 1), [0])
    close(row(m, 'aDur', 0), [0.7])
    close(row(m, 'aDur', 1), [0.7])
  })

  it('observeTrail：每枚面包屑一枚金环（y+0.045、dur 0.9），age 越老越宽越淡；越过窗口钳在 k=1', () => {
    const vfx = makeVfx()
    vfx.observeTrail([
      { x: 1, z: 2, age: 0 },
      { x: 3, z: 4, age: 60 * 3 },
      { x: 5, z: 6, age: 60 * 300 },
    ], 0, 3)
    const m = ringAttrs(vfx)
    expect(((vfx as any).rings as { live: number }).live).toBe(3)
    const gold = new THREE.Color(VFX_PALETTE.warmGold)
    // 三枚同族：金、贴地、同波形骨架（delay 0 / split 0 / fringe 0.6 / wave 0.25 / width 0.1）
    for (const r of [0, 1, 2]) {
      close(row(m, 'aColor', r), [gold.r, gold.g, gold.b])
      close(row(m, 'aBirth', r), [0])
      close(row(m, 'aDur', r), [0.9])
      close(row(m, 'aWidth', r), [0.1])
      close(row(m, 'aParam', r).slice(0, 3), [0, 0.6, 0.25])
    }
    close(row(m, 'aOrigin', 0), [1, 0.045, 2])
    close(row(m, 'aOrigin', 1), [3, 0.045, 4])
    close(row(m, 'aOrigin', 2), [5, 0.045, 6])
    // k=0 → intensity 0.63、r0 0.12 / r1 0.3；k=1 → intensity 0.08、r0 0.32 / r1 0.55；
    // 第三枚 age 远超窗口：Math.min 钳住 ⇒ 与走满窗口的那枚全同
    const ks = [0, 1, 1]
    ks.forEach((k, r) => {
      close(row(m, 'aParam', r).slice(3), [0.55 * (1 - k) + 0.08])
      close(row(m, 'aR0', r), [0.12 + 0.2 * k])
      close(row(m, 'aR1', r), [0.3 + 0.25 * k])
    })
  })
})

describe('批18 分支死角：预算截断 / 缺省回落 / 未知键告警去重 / 子帧插值', () => {
  it('impact_sparks / parry_ring / block_spark 各走各的配方；缺 scale 按 1 兜底；dir 全零 ⇒ 折回 +Z', () => {
    const vfx = makeVfx()
    bus.emit('vfx.request', { key: 'impact_sparks', pos: { x: 0, y: 1, z: 0 } }) // 无 scale
    expect(vfx.stats.sparks, 'BURST.impact.count=12，scale 兜底不影响数量').toBe(12)
    bus.emit('vfx.request', { key: 'parry_ring', pos: { x: 0, y: 1, z: 0 }, scale: 1 })
    expect(vfx.stats.rings, '弹反双环').toBe(2)
    expect(vfx.stats.sparks, 'BURST.parry.count=16').toBe(28)
    bus.emit('vfx.request', { key: 'block_spark', pos: { x: 0, y: 1, z: 0 }, scale: 1 })
    expect(vfx.stats.rings, '格挡压扁小环').toBe(3)
    expect(vfx.stats.sparks, 'BURST.block.count=9').toBe(37)
    bus.emit('vfx.request', { key: 'hit_ring', pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 0 } })
    expect(vfx.stats.rings, '零向量 dir 折回 +Z 后照常出双环').toBe(5)
  })

  it('update(alpha, realDelta) 两参调用：绘制时钟在 [prev, now] 内按 alpha 采样（子帧插值腿）', () => {
    const vfx = makeVfx()
    vfx.update(0.5, 0.1) // prev=0，time=0.1 ⇒ draw = 0 + 0.1*0.5
    expect((vfx as any).ringMat.uniforms.uTime.value).toBeCloseTo(0.05, 6)
    vfx.update(0.25, 0.1) // prev=0.1，time=0.2 ⇒ draw = 0.1 + 0.1*0.25
    expect((vfx as any).ringMat.uniforms.uTime.value).toBeCloseTo(0.125, 6)
  })

  it('InstanceBuffer 底座：预算满 spawn=-1、未知属性名 throw、vec 缺省分量按 0 回落', () => {
    const vfx = makeVfx()
    const rings = (vfx as any).rings
    while (rings.spawn() >= 0) { /* 领到 -1 为止：预算满真腿 */ }
    expect(rings.spawn(), '满后再领 ⇒ -1（宁可少发一个特效，也不越预算）').toBe(-1)
    expect(() => rings.num(0, 'nope', 1)).toThrowError(/unknown instance attribute/)
    rings.vec(0, 'aQuat', 0.5) // y/z/w 全缺省 ⇒ 三处 ?? 0 回落
    const q = rings.mesh.geometry.getAttribute('aQuat') as THREE.InstancedBufferAttribute
    expect(Array.from(q.array.slice(0, 4))).toEqual([0.5, 0, 0, 0])
  })

  it('四个池几乎打满（留 1 空位）⇒ 首行成功、次行截断：trail/burst/ring/shards 宁可少发不越预算', () => {
    const vfx = makeVfx()
    const a = vfx as any
    while (a.sparks.live < VFX_BUDGET.sparks - 1) a.sparks.spawn()
    while (a.rings.live < VFX_BUDGET.rings) a.rings.spawn()
    while (a.shards.live < VFX_BUDGET.shards - 1) a.shards.spawn()
    while (a.decals.live < VFX_BUDGET.decals) a.decals.spawn()
    bus.emit('vfx.request', { key: 'trail_sword', pos: { x: 0, y: 1, z: 0 }, scale: 1 }) // 首行成功、spawn 撞满 ⇒ break
    bus.emit('vfx.request', { key: 'impact_sparks', pos: { x: 0, y: 1, z: 0 }, scale: 1 }) // 已满 ⇒ burst break
    bus.emit('vfx.request', { key: 'hit_ring', pos: { x: 0, y: 1, z: 0 }, scale: 1 }) // rings 满 ⇒ ring 早退
    bus.emit('vfx.request', { key: 'death_shatter', pos: { x: 0, y: 1, z: 0 }, scale: 1 }) // 首片成功、次片截断
    expect(vfx.stats.sparks, '只补上 trail 那一行，其余截断').toBe(VFX_BUDGET.sparks)
    expect(vfx.stats.rings).toBe(VFX_BUDGET.rings)
    expect(vfx.stats.shards, '只补上第一片碎核').toBe(VFX_BUDGET.shards)
  })

  it('延迟发射器：池满 schedule 早退（一个都不排）', () => {
    const vfx = makeVfx()
    const pool = (vfx as any).emitterPool
    while (pool.live < VFX_BUDGET.emitters) pool.obtain() // 把池搬空（obtain 耗尽会续造，按 live 计数）
    bus.emit('vfx.request', { key: 'ring_echo', pos: { x: 0, y: 1, z: 0 }, scale: 1 })
    expect(vfx.stats.emitters, '池满 ⇒ schedule 直接早退').toBe(0)
  })

  it('dispose 时未到期的延迟发射器一并释放', () => {
    const vfx = makeVfx()
    bus.emit('vfx.request', { key: 'ring_echo', pos: { x: 0, y: 1, z: 0 }, scale: 1 })
    expect(vfx.stats.emitters).toBe(1)
    vfx.dispose()
    expect(vfx.stats.emitters, 'dispose 释放全部未到期发射器').toBe(0)
  })

  it('未知 key 告警去重：同一 key 只告一次，不同 key 各告各的', () => {
    makeVfx() // 挂一个活的 VfxLayer：warnUnknown 的去重集在实例上
    const warns: string[] = []
    const off = bus.on('log', (l: { level: string; msg: string }) => { if (l.level === 'warn') warns.push(l.msg) })
    bus.emit('vfx.request', { key: 'nope_a', pos: { x: 0, y: 0, z: 0 } })
    bus.emit('vfx.request', { key: 'nope_a', pos: { x: 0, y: 0, z: 0 } })
    bus.emit('vfx.request', { key: 'nope_b', pos: { x: 0, y: 0, z: 0 } })
    off()
    expect(warns.filter((m) => m.includes('nope_a')), '第二次撞上 warned 集 ⇒ 直接返回').toHaveLength(1)
    expect(warns.filter((m) => m.includes('nope_b'))).toHaveLength(1)
  })
})