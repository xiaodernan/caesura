import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { initDecalSystem, registerDecalSystemBus, registerDecalDeathEmitter, getDecalSystem } from '@/vfx/Decals'
import { initGPUParticles, registerGPUParticlesBus, registerHitBurstEmitter, getGPUParticles } from '@/vfx/GPUParticles'
import { initTrailSystem, registerTrailSystemBus, getTrailSystem } from '@/vfx/Trails'

/**
 * Phase B4 的接线门（KI-135）：**三个频道从此有人说话**。
 *
 * 这一格量的不是"文件在不在"，而是"世界事件真的会让表现层动起来"：
 *   · 敌人倒地 ⇒ 地上出现一张血贴花（`vfx.decal.spawn` 的发射方）；
 *   · 命中 ⇒ 命中点炸出粒子（`vfx.burst` 的发射方）；
 *   · 挥击判定窗 ⇒ 武器拖尾逐帧更新（`vfx.trail.weapon` 的发射方在玩家控制器那一侧）。
 *
 * **为什么在测试里直接读表现层的内部状态**：那三套系统今天还没有"玩家看得见"的可断言接口
 * （没有公开的"当前有几张贴花"这种读数），所以这里读它们的内部集合（与 `camera-bus.test.ts`
 * 读 `rig.shakes` 同一族做法）。**先例在前**：那条门先这么读，相机那一族才跟着这么读。
 */
import * as THREE from 'three'

/** 一个够用的场景替身：只给 `add`/`remove`——三套系统建网格时只用到这两个 */
const sceneStub = () => {
  const s = {
    add: () => {},
    remove: () => {},
  }
  return s as unknown as THREE.Scene
}

const decalCount = (): number => {
  const sys = getDecalSystem() as unknown as { decals: Map<string, { active: boolean }[]> } | null
  if (!sys) return -1
  let n = 0
  for (const pool of sys.decals.values()) for (const d of pool) if (d.active) n++
  return n
}

const emitterCount = (): number => {
  const sys = getGPUParticles() as unknown as { emitters: Map<string, { particles: { active: boolean }[] }> } | null
  if (!sys) return -1
  let n = 0
  for (const e of sys.emitters.values()) for (const p of e.particles) if (p.active) n++
  return n
}

const trailPoints = (): number => {
  const sys = getTrailSystem() as unknown as { trails: Map<string, { points: unknown[] }> } | null
  if (!sys) return -1
  let n = 0
  for (const t of sys.trails.values()) n += t.points.length
  return n
}

describe('Phase B4 接线：三个频道真的有人说话（KI-135）', () => {
  beforeAll(() => {
    // **只注册一次**：那三个注册函数没有退订口，而 `bus` 是进程级单例——
    // 在 `beforeEach` 里注册会让监听器越积越多（第二条用例里一次 emit 贴出两张血，
    // 当场被这条断言抓住：那不是"贴花画多了"，是同一个频道被订阅了两遍）。
    registerGameData()
    registerDecalSystemBus()
    registerDecalDeathEmitter()
    registerGPUParticlesBus()
    registerHitBurstEmitter()
    registerTrailSystemBus()
  })

  beforeEach(() => {
    // 每次重开三套系统：内部状态清零，断言读的是"这一趟"的世界
    initDecalSystem(sceneStub())
    initGPUParticles(sceneStub())
    initTrailSystem(sceneStub())
  })

  it('配置真的进了注册表（三个带前缀的键）', () => {
    expect((registry.maybeGet('vfx:decals') as unknown[])?.length, '贴花配置').toBeGreaterThan(0)
    expect((registry.maybeGet('vfx:trails') as unknown[])?.length, '拖尾配置').toBeGreaterThan(0)
    expect((registry.maybeGet('vfx:emitters') as unknown[])?.length, '发射器配置').toBeGreaterThan(0)
  })

  it('敌人倒地 ⇒ 地上多出一张血贴花', () => {
    const before = decalCount()
    bus.emit('entity.died', { id: 'en_1', kind: 'enemy', dataId: 'en_test', position: { x: 1, y: 0, z: 2 } })
    expect(decalCount(), '倒地要贴一张血').toBe(before + 1)
  })

  it('玩家倒地不贴血（玩家的死是叙事线，不在地上留红）', () => {
    const before = decalCount()
    bus.emit('entity.died', { id: 'p1', kind: 'player', position: { x: 0, y: 0, z: 0 } })
    expect(decalCount(), '玩家倒地不贴').toBe(before)
  })

  it('命中 ⇒ 命中点炸出粒子；无敌帧那一记不炸', () => {
    const before = emitterCount()
    bus.emit('combat.hit', {
      attackerId: 'p1', victimId: 'en_1', damage: 10, poiseDamage: 5,
      kind: 'light', point: { x: 1, y: 1, z: 1 }, dir: { x: 0, y: 0, z: 1 },
      result: 'hit', hitStopMs: 0, shakeKey: '', backstab: false, weakpoint: false,
    })
    expect(emitterCount(), '打中了要炸出粒子').toBeGreaterThan(before)

    const afterHit = emitterCount()
    bus.emit('combat.hit', {
      attackerId: 'p1', victimId: 'en_1', damage: 0, poiseDamage: 0,
      kind: 'light', point: { x: 1, y: 1, z: 1 }, dir: { x: 0, y: 0, z: 1 },
      result: 'immune', hitStopMs: 0, shakeKey: '', backstab: false, weakpoint: false,
    })
    expect(emitterCount(), '无敌帧不炸（没打中就不是一次世界事件）').toBe(afterHit)
  })

  it('武器拖尾：一次更新就攒下轨迹点（拖尾要的是路径，不是一个点）', () => {
    bus.emit('vfx.trail.weapon', {
      id: 'trail_blade',
      pos: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
    })
    bus.emit('vfx.trail.weapon', {
      id: 'trail_blade',
      pos: { x: 0, y: 1, z: 1 },
      forward: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
    })
    expect(trailPoints(), '两帧至少两个轨迹点').toBeGreaterThanOrEqual(2)
  })
})
