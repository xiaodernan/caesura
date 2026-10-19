import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { initDecalSystem, registerDecalSystemBus, getDecalSystem, type DecalConfig } from '@/vfx/Decals'
import { initTrailSystem, registerTrailSystemBus, getTrailSystem, type TrailConfig } from '@/vfx/Trails'
import { initGPUParticles, registerGPUParticlesBus, getGPUParticles, type EmitterConfig } from '@/vfx/GPUParticles'
import { blendingOf } from '@/vfx/VfxConfig'

/**
 * Phase B4 三件套的**其余分支**（KI-149 第二段）。
 *
 * 上一段量的是"能不能用"；这一段量的是**分支**：贴花的贴图、拖尾的贴图、粒子的缎带型、
 * 混合模式的第三种、还有那几条**总线通道的处理函数本体**。
 *
 * **合成配置而不是改真表**：真表里没有哪一行写贴图（本仓没有真资产，KI-008），
 * 而"写了没人用的行"是 §55 禁止的——所以贴图那一格用**临时加进注册表那张表的一行**来跑，
 * 真表一个字都不动（用例结束把它摘掉）。
 */
beforeAll(() => { registerGameData() })

/** 往注册表那张表里临时加一行（用例结束摘掉） */
const withRow = <T>(key: string, row: T): (() => void) => {
  const list = registry.get<T[]>(key)
  list.push(row)
  return () => {
    const i = list.indexOf(row)
    if (i >= 0) list.splice(i, 1)
  }
}

const scenes: THREE.Scene[] = []
const undo: (() => void)[] = []
afterEach(() => {
  for (const u of undo.splice(0)) u()
  for (const s of scenes.splice(0)) {
    getDecalSystem()?.dispose()
    getTrailSystem()?.dispose()
    getGPUParticles()?.dispose()
    s.clear()
  }
})

const newScene = (): THREE.Scene => {
  const s = new THREE.Scene()
  scenes.push(s)
  return s
}

describe('贴花：贴图那一格（KI-149）', () => {
  it('配置里写了贴图 ⇒ 材质上真的挂上（注册表里没有的那张就当没有）', () => {
    const tex = new THREE.Texture()
    registry.register('tex/probe_albedo', tex)
    const cfg: DecalConfig = {
      id: 'decal_probe_tex',
      type: 'impact',
      lifetime: 5,
      fadeIn: 0.1,
      fadeOut: 0.5,
      size: { min: 0.2, max: 0.4 },
      color: { base: new THREE.Color('#ffffff'), opacity: 0.8 },
      normalStrength: 0.2,
      roughnessOffset: 0.1,
      metalnessOffset: 0,
      randomRotation: true,
      randomScale: false,
      maxInstances: 4,
      textures: {
        albedo: 'tex/probe_albedo',
        normal: 'tex/probe_missing',
        roughness: 'tex/probe_missing',
        metalness: 'tex/probe_missing',
      },
    }
    undo.push(withRow('vfx:decals', cfg))
    const decals = initDecalSystem(newScene())!
    decals.spawn('decal_probe_tex', new THREE.Vector3(), new THREE.Vector3(0, 1, 0))
    const inst = (decals as unknown as { decals: Map<string, { mesh: THREE.Mesh }[]> }).decals
    const mesh = inst.get('decal_probe_tex')![0].mesh
    const mat = mesh.material as THREE.MeshStandardMaterial
    expect(mat.map, 'albedo 挂上了').toBe(tex)
    expect(mat.normalMap, '注册表里没有的那张就当没有（不抛）').toBeNull()
  })
})

describe('拖尾：贴图与移除（KI-149）', () => {
  it('配置里写了贴图 ⇒ 材质挂上', () => {
    const tex = new THREE.Texture()
    registry.register('tex/probe_trail', tex)
    const cfg: TrailConfig = {
      id: 'trail_probe_tex',
      segments: 6,
      width: [0.1, 0.02],
      color: [new THREE.Color('#ffffff'), new THREE.Color('#888888')],
      lifetime: 0.3,
      texture: 'tex/probe_trail',
      blending: THREE.AdditiveBlending,
      followRotation: true,
      minEmitDist: 0.01,
    }
    undo.push(withRow('vfx:trails', cfg))
    const trails = initTrailSystem(newScene())!
    trails.updateWeapon('trail_probe_tex', new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1 / 60)
    const inst = (trails as unknown as { trails: Map<string, { material: THREE.MeshBasicMaterial }> }).trails
    expect(inst.get('trail_probe_tex')?.material.map, '贴图挂上了').toBe(tex)
  })
})

describe('粒子：缎带型与轨迹型（KI-149）', () => {
  it('缎带型发射器用 MeshBasicMaterial（顶点色），并记下上一帧的位置', () => {
    const cfg: EmitterConfig = {
      id: 'fx_probe_ribbon',
      type: 'ribbon',
      maxParticles: 8,
      spawnRate: 4,
      spawnShape: 'point',
      spawnSize: new THREE.Vector3(0.1, 0.1, 0.1),
      lifetime: { min: 0.2, max: 0.4 },
      size: { start: 0.1, end: 0 },
      color: { start: new THREE.Color('#ffffff'), end: new THREE.Color('#ffffff') },
      velocity: { min: new THREE.Vector3(), max: new THREE.Vector3() },
      acceleration: new THREE.Vector3(),
      gravity: 0,
      drag: 1,
      blending: THREE.NormalBlending,
      depthWrite: false,
      sizeAttenuation: true,
      trailLength: 4,
      ribbonWidth: 0.1,
    }
    undo.push(withRow('vfx:emitters', cfg))
    const particles = initGPUParticles(newScene())!
    particles.burst('fx_probe_ribbon', new THREE.Vector3(), 3)
    const inst = (particles as unknown as { emitters: Map<string, { particles: { prevPositions?: unknown[] }[]; mesh: THREE.Mesh }> }).emitters
    const em = inst.get('fx_probe_ribbon')!
    expect(em.mesh.material, '缎带型用 MeshBasicMaterial').toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(em.particles.some((p) => (p.prevPositions?.length ?? 0) > 0), '缎带粒子记下了自己的来路').toBe(true)
  })

  it('轨迹型发射器：移动位置时持续补粒子', () => {
    const cfg: EmitterConfig = {
      id: 'fx_probe_trail',
      type: 'trail',
      maxParticles: 8,
      spawnRate: 60,
      spawnShape: 'point',
      spawnSize: new THREE.Vector3(0.1, 0.1, 0.1),
      lifetime: { min: 0.2, max: 0.4 },
      size: { start: 0.1, end: 0 },
      color: { start: new THREE.Color('#ffffff'), end: new THREE.Color('#ffffff') },
      velocity: { min: new THREE.Vector3(), max: new THREE.Vector3() },
      acceleration: new THREE.Vector3(),
      gravity: 0,
      drag: 1,
      blending: THREE.NormalBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }
    undo.push(withRow('vfx:emitters', cfg))
    const particles = initGPUParticles(newScene())!
    particles.stream('fx_probe_trail', new THREE.Vector3())
    const inst = (particles as unknown as { emitters: Map<string, { particles: { active: boolean }[] }> }).emitters
    const live = inst.get('fx_probe_trail')?.particles.filter((p) => p.active).length ?? 0
    expect(live, '轨迹型在移动时补出粒子').toBeGreaterThan(0)
  })
})

describe('混合模式三种（KI-149）', () => {
  it('normal / additive / multiply 各对应一个 three 枚举', () => {
    expect(blendingOf('normal')).toBe(THREE.NormalBlending)
    expect(blendingOf('additive')).toBe(THREE.AdditiveBlending)
    expect(blendingOf('multiply')).toBe(THREE.MultiplyBlending)
  })
})

describe('那几条总线通道的处理函数本体（KI-149）', () => {
  it('贴花三条通道：spawn / batch / clear 都真的动到系统', () => {
    const decals = initDecalSystem(newScene())!
    registerDecalSystemBus()
    bus.emit('vfx.decal.spawn', { configId: 'decal_blood', pos: { x: 1, y: 0, z: 1 }, normal: { x: 0, y: 1, z: 0 } })
    bus.emit('vfx.decal.batch', {
      configId: 'decal_blood',
      positions: [{ x: 2, y: 0, z: 2 }, { x: 3, y: 0, z: 3 }],
      normal: { x: 0, y: 1, z: 0 },
    })
    const inst = (decals as unknown as { decals: Map<string, { active: boolean }[]> }).decals
    const live = (inst.get('decal_blood') ?? []).filter((d) => d.active).length
    expect(live, 'spawn + batch 贴了三处').toBe(3)
    bus.emit('vfx.decal.clear', 'decal_blood')
    expect((inst.get('decal_blood') ?? []).filter((d) => d.active).length, 'clear 之后全没了').toBe(0)
  })

  it('粒子三条通道：burst / stream / remove 都真的动到系统', () => {
    const particles = initGPUParticles(newScene())!
    registerGPUParticlesBus()
    bus.emit('vfx.burst', { id: 'fx_hit_spark', pos: { x: 0, y: 0, z: 0 }, count: 4 })
    const inst = (particles as unknown as { emitters: Map<string, { particles: { active: boolean }[] }> }).emitters
    expect(inst.get('fx_hit_spark')?.particles.filter((p) => p.active).length ?? 0, 'burst 通道炸出了粒子').toBeGreaterThan(0)
    bus.emit('vfx.stream', { id: 'fx_dust', pos: { x: 0, y: 0, z: 0 } })
    expect(inst.has('fx_dust'), 'stream 通道建出了发射器').toBe(true)
    bus.emit('vfx.remove', 'fx_dust')
    expect(inst.has('fx_dust'), 'remove 通道收掉了发射器').toBe(false)
  })

  it('拖尾三条通道：weapon / projectile / hide 都真的动到系统', () => {
    const trails = initTrailSystem(newScene())!
    registerTrailSystemBus()
    bus.emit('vfx.trail.weapon', {
      id: 'trail_blade',
      pos: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
    })
    bus.emit('vfx.trail.projectile', { id: 'trail_arrow', pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 30 } })
    const inst = (trails as unknown as { trails: Map<string, { mesh: THREE.Mesh; points: unknown[] }> }).trails
    expect(inst.get('trail_blade')?.points.length ?? 0, 'weapon 通道攒了点').toBeGreaterThan(0)
    expect(inst.get('trail_arrow')?.points.length ?? 0, 'projectile 通道攒了点').toBeGreaterThan(0)
    bus.emit('vfx.trail.hide', 'trail_blade')
    expect(inst.get('trail_blade')?.mesh.visible, 'hide 通道收起了那一条').toBe(false)
  })
})
