import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import * as THREE from 'three'
import { registerGameData } from '@/data'
import { initDecalSystem, getDecalSystem } from '@/vfx/Decals'
import { initTrailSystem, getTrailSystem } from '@/vfx/Trails'
import { initGPUParticles, getGPUParticles } from '@/vfx/GPUParticles'

/**
 * Phase B4 三件套的**核心路径**补测（KI-149）。
 *
 * **为什么补**：KI-133 把这三份文件落进主干时，它们**一行测试都没有**（覆盖率门那三个包
 * 立刻掉到地板下：vfx 75.28%／地板 96.99%，ai 90.66%／地板 98.75%）。而它们是**刚落地的
 * 表现层子系统**——贴花、拖尾、粒子各有自己的生命周期与池子逻辑，"跑起来对不对"至今没人验过。
 *
 * **本文件量什么**（每件各自的"能不能用"）：
 *   · 贴花：配置缺失时不画、画出来是贴地的、生命周期到点会淡出、池子有上限、clear 清得掉；
 *   · 拖尾：逐帧更新攒出轨迹、minEmitDist 抑制过密、hide 收起来、寿命到了会消失；
 *   · 粒子：burst 真的发出粒子、stream 持续补、remove 收掉发射器、update 让粒子老去。
 *
 * **用真 three**（几何/材质在 node 里不编译 shader，`vfx-layer.test.ts` 同例）。
 */
beforeAll(() => { registerGameData() })

const scenes: THREE.Scene[] = []
const after = (): void => {
  for (const s of scenes.splice(0)) {
    getDecalSystem()?.dispose()
    getTrailSystem()?.dispose()
    getGPUParticles()?.dispose()
    s.clear()
  }
}
afterEach(after)

const newScene = (): THREE.Scene => {
  const s = new THREE.Scene()
  scenes.push(s)
  return s
}

describe('贴花系统（KI-149）', () => {
  it('配置缺失时不画（没有那一行配置 ⇒ 不贴）', () => {
    const scene = newScene()
    const decals = initDecalSystem(scene)!
    expect(decals.spawn('decal_not_exist', new THREE.Vector3(), new THREE.Vector3(0, 1, 0)), '没有配置就该返回 null').toBeNull()
  })

  it('贴出来的那一张是贴地的（法线朝上、位置在给定处）', () => {
    const scene = newScene()
    const decals = initDecalSystem(scene)!
    const at = new THREE.Vector3(1, 0, 2)
    const id = decals.spawn('decal_blood', at, new THREE.Vector3(0, 1, 0))
    expect(id, '有配置就该贴得出来').toBeTruthy()
    const inst = (decals as unknown as { decals: Map<string, { position: THREE.Vector3; normal: THREE.Vector3; active: boolean }[]> }).decals
    const pool = inst.get('decal_blood') ?? []
    expect(pool.length).toBeGreaterThan(0)
    expect(pool[0].position.x).toBeCloseTo(1, 6)
    expect(pool[0].normal.y).toBeCloseTo(1, 6)
    expect(pool[0].active).toBe(true)
  })

  it('批量贴花一次给一串位置（每一处都贴）', () => {
    const scene = newScene()
    const decals = initDecalSystem(scene)!
    const ids = decals.spawnBatch('decal_blood', [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
    ], new THREE.Vector3(0, 1, 0))
    expect(ids.length, '三处 ⇒ 三个 id').toBe(3)
  })

  it('生命周期到点会淡出（update 走够时间 ⇒ 那一格不再活着）', () => {
    const scene = newScene()
    const decals = initDecalSystem(scene)!
    decals.spawn('decal_blood', new THREE.Vector3(), new THREE.Vector3(0, 1, 0))
    const inst = (decals as unknown as { decals: Map<string, { active: boolean; age: number }[]> }).decals
    const pool = inst.get('decal_blood')!
    expect(pool[0].active).toBe(true)
    for (let i = 0; i < 60 * 40; i++) decals.update(1 / 60) // 40 秒 > 那张配置的 25 秒寿命
    expect(pool[0].active, '寿命到了就该退场').toBe(false)
  })

  it('clear 清得掉（给 id 清一档，不给 id 全清）', () => {
    const scene = newScene()
    const decals = initDecalSystem(scene)!
    decals.spawn('decal_blood', new THREE.Vector3(), new THREE.Vector3(0, 1, 0))
    decals.spawn('decal_impact', new THREE.Vector3(), new THREE.Vector3(0, 1, 0))
    decals.clear('decal_blood')
    const inst = (decals as unknown as { decals: Map<string, { active: boolean }[]> }).decals
    expect(inst.get('decal_blood')?.[0].active, '指定的那一档被清掉').toBe(false)
    expect(inst.get('decal_impact')?.[0].active, '另一档不动').toBe(true)
    decals.clear()
    expect(inst.get('decal_impact')?.[0].active, '全清').toBe(false)
  })
})

describe('拖尾系统（KI-149）', () => {
  it('逐帧更新攒出轨迹（两帧 ⇒ 两个点）', () => {
    const scene = newScene()
    const trails = initTrailSystem(scene)!
    trails.updateWeapon('trail_blade', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1 / 60)
    trails.updateWeapon('trail_blade', new THREE.Vector3(0, 1, 1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1 / 60)
    const inst = (trails as unknown as { trails: Map<string, { points: unknown[] }> }).trails
    expect(inst.get('trail_blade')?.points.length ?? 0, '两帧至少两个轨迹点').toBeGreaterThanOrEqual(2)
  })

  it('minEmitDist 抑制过密（同位置反复更新不攒出一长串）', () => {
    const scene = newScene()
    const trails = initTrailSystem(scene)!
    const at = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < 30; i++) {
      trails.updateWeapon('trail_blade', at, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1 / 60)
    }
    const inst = (trails as unknown as { trails: Map<string, { points: unknown[] }> }).trails
    expect(inst.get('trail_blade')?.points.length ?? 0, '同位置反复喂 ⇒ 点数不涨').toBeLessThanOrEqual(2)
  })

  it('hide 收起那一条；超龄的点会掉下来', () => {
    const scene = newScene()
    const trails = initTrailSystem(scene)!
    trails.updateWeapon('trail_blade', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1 / 60)
    trails.setVisible('trail_blade', false)
    const inst = (trails as unknown as { trails: Map<string, { mesh: THREE.Mesh; points: { time: number }[] }> }).trails
    expect(inst.get('trail_blade')?.mesh.visible, 'hide 之后该条不可见').toBe(false)

    // **把最老那一点的时间戳推到很久以前**（拖尾的老化认的是墙上的钟，不是帧数），
    // 下一帧它就该被丢掉——老化从**头**丢（KI-149 修掉的那个永真循环）。
    const pts = inst.get('trail_blade')!.points
    pts[0].time = performance.now() / 1000 - 10
    trails.update(1 / 60)
    expect(pts.length, '超龄的点掉下来了').toBe(0)
  })

  it('点数不超配置的段数（几何体只画得出那几段）', () => {
    const scene = newScene()
    const trails = initTrailSystem(scene)!
    const inst = (trails as unknown as { trails: Map<string, { points: unknown[] }> }).trails
    const segments = 14 // vfx.json > trails > trail_blade.segments
    for (let i = 0; i < segments + 5; i++) {
      trails.updateWeapon('trail_blade', new THREE.Vector3(0, 1, i * 0.2), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1 / 60)
    }
    expect(inst.get('trail_blade')?.points.length ?? 0, '点数被配置截住').toBeLessThanOrEqual(segments)
  })

  it('弹道拖尾另有一份（projectile 那一族）', () => {
    const scene = newScene()
    const trails = initTrailSystem(scene)!
    trails.updateProjectile('trail_arrow', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 30), 1 / 60)
    const inst = (trails as unknown as { trails: Map<string, { points: unknown[] }> }).trails
    expect(inst.get('trail_arrow')?.points.length ?? 0, '弹道也要有轨迹点').toBeGreaterThanOrEqual(1)
  })

  it('收掉一条拖尾（remove 会把它 dispose 掉并从名册里摘掉）', () => {
    const scene = newScene()
    const trails = initTrailSystem(scene)!
    trails.updateWeapon('trail_blade', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1 / 60)
    const inst = (trails as unknown as { trails: Map<string, unknown> }).trails
    expect(inst.has('trail_blade'), '先在').toBe(true)
    ;(trails as unknown as { remove(id: string): void }).remove('trail_blade')
    expect(inst.has('trail_blade'), '收掉之后名册里不该还有它').toBe(false)
  })
})

describe('粒子系统（KI-149）', () => {
  it('burst 真的发出粒子（从池子里取）', () => {
    const scene = newScene()
    const particles = initGPUParticles(scene)!
    particles.burst('fx_hit_spark', new THREE.Vector3(), 12)
    const inst = (particles as unknown as { emitters: Map<string, { particles: { active: boolean }[] }> }).emitters
    const live = inst.get('fx_hit_spark')?.particles.filter((p) => p.active).length ?? 0
    expect(live, 'burst 之后至少有几个活着的粒子').toBeGreaterThan(0)
  })

  it('stream 持续补粒子、remove 收掉发射器', () => {
    const scene = newScene()
    const particles = initGPUParticles(scene)!
    particles.stream('fx_dust', new THREE.Vector3())
    const inst = (particles as unknown as { emitters: Map<string, unknown> }).emitters
    expect(inst.has('fx_dust'), 'stream 那一档要有发射器').toBe(true)
    particles.remove('fx_dust')
    expect(inst.has('fx_dust'), 'remove 之后发射器收掉').toBe(false)
  })

  it('update 让粒子老去（寿命到了就不活了）', () => {
    const scene = newScene()
    const particles = initGPUParticles(scene)!
    particles.burst('fx_hit_spark', new THREE.Vector3(), 5)
    const inst = (particles as unknown as { emitters: Map<string, { particles: { active: boolean }[] }> }).emitters
    const pool = inst.get('fx_hit_spark')?.particles ?? []
    for (let i = 0; i < 60 * 5; i++) particles.update(1 / 60)
    expect(pool.filter((p) => p.active).length, '寿命到了粒子就该死').toBe(0)
  })

  it('不存在的配置不炸（getEmitter 返回 null）', () => {
    const scene = newScene()
    const particles = initGPUParticles(scene)!
    expect(particles.getEmitter('fx_not_exist')).toBeNull()
  })
})
