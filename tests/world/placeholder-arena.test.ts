import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RhythmClock } from '@/core/RhythmClock'
import * as THREE from 'three'

/**
 * `src/world/PlaceholderArena.ts`：主菜单/练习场灰盒——项目里唯二「组合根」级零覆盖文件之一。
 *
 * 本文件的 mock 只 Mock 掉一格：`THREE.WebGLRenderer`（它需要真实的 canvas + WebGL 上下文，
 * 在 headless 里不存在——与 `tests/support/fakeAudio.ts` 同一条思路：mock 掉环境，真执行逻辑）。
 * 其余 `three`（Scene／几何体／材质／相机／雾）全部是真的、可被 node 执行的对象。
 */

const captured = vi.hoisted(() => ({
  renderer: null as unknown as Record<string, unknown>,
  setPx: [] as number[],
  setSize: [] as Array<[number, number]>,
}))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeWebGLRenderer {
    constructor(public opts: unknown) {
      captured.renderer = this as unknown as Record<string, unknown>
      this.shadowMap = { enabled: false, type: 0 }
      this.toneMapping = 0
      this.toneMappingExposure = 1
    }
    shadowMap: { enabled: boolean; type: number }
    toneMapping: number
    toneMappingExposure: number
    setPixelRatio(v: number) { captured.setPx.push(v) }
    setSize(w: number, h: number) { captured.setSize.push([w, h]) }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer }
})

import { createArena } from '@/world/PlaceholderArena'

const g = globalThis as unknown as { innerWidth: number; innerHeight: number; devicePixelRatio: number }

describe('createArena：见证灰盒场的构造一次', () => {
  beforeEach(() => {
    g.innerWidth = 1280
    g.innerHeight = 720
    g.devicePixelRatio = 2
    captured.renderer = null as unknown as Record<string, unknown>
    captured.setPx = []
    captured.setSize = []
  })

  it('renderer 只参数化那两格：不抢品质、不开 MSAA（高性能有限制：powerPreference + 无抗锯齿）', () => {
    const clock = new RhythmClock()
    clock.setBpm(84, 4)
    const arena = createArena({} as HTMLCanvasElement, clock)
    const r = arena.renderer as unknown as Record<string, unknown>
    expect(r.opts).toMatchObject({ antialias: false, powerPreference: 'high-performance' })
    expect(captured.renderer, '假 renderer 被挂上了同一实例').toBe(r)
  })

  it('pixelRatio 与 setSize：devicePixelRatio 2 ⇒ 1.5（夹在 1.5 以下：祖传品质档位）', () => {
    const clock = new RhythmClock()
    clock.setBpm(84, 4)
    createArena({} as HTMLCanvasElement, clock)
    expect(captured.setPx).toEqual([1.5])
    expect(captured.setSize).toEqual([[1280, 720]]) // 唯一一次 setSize
  })

  it('shadowMap / toneMapping / exposure：这套画质开关一次落齐，不许谁忘了拨', () => {
    const clock = new RhythmClock()
    clock.setBpm(84, 4)
    const arena = createArena({} as HTMLCanvasElement, clock)
    const r = arena.renderer as unknown as { shadowMap: { enabled: boolean; type: number }; toneMapping: number; toneMappingExposure: number }
    expect(r.shadowMap.enabled).toBe(true)
    expect(r.shadowMap.type).toBe(THREE.PCFShadowMap)
    expect(r.toneMapping).toBe(THREE.ACESFilmicToneMapping)
    expect(r.toneMappingExposure).toBe(1.05)
  })

  it('camera 与 scene 里的三块地标：大地面降到了 -0.6（不压住 ChunkGreybox 的地板）、天穹（背面着色）、玩家灰盒', () => {
    const clock = new RhythmClock()
    clock.setBpm(84, 4)
    const arena = createArena({} as HTMLCanvasElement, clock)
    expect(arena.scene.background).toBeInstanceOf(THREE.Color)
    expect(arena.scene.fog).toBeInstanceOf(THREE.FogExp2)
    expect((arena.camera as THREE.PerspectiveCamera).position.y).toBeCloseTo(2.2)
    expect((arena.camera as THREE.PerspectiveCamera).position.z).toBeCloseTo(6)

    const ground = arena.scene.children.find((o) => (o as THREE.Mesh).geometry instanceof THREE.PlaneGeometry) as THREE.Mesh
    expect(ground).toBeDefined()
    expect(ground.position.y).toBeCloseTo(-0.6)
    expect(ground.receiveShadow).toBe(true)

    const sky = arena.scene.children.find((o) => (o as THREE.Mesh).geometry instanceof THREE.SphereGeometry) as THREE.Mesh
    const skyMat = sky.material as THREE.ShaderMaterial
    expect(skyMat.depthWrite).toBe(false)
    expect(skyMat.side).toBe(THREE.BackSide)
    expect(skyMat.uniforms.uIntensity.value).toBeCloseTo(1)

    expect(arena.playerVisual.children.length).toBe(2)
    const body = arena.playerVisual.children[0] as THREE.Mesh
    expect(body.castShadow).toBe(true)
    expect(body.geometry).toBeInstanceOf(THREE.CapsuleGeometry)
  })

  it('update(_alpha, realDelta)：天穹均值 uTime 真的走 realDelta；intensity 被写到合法区间', () => {
    const clock = new RhythmClock()
    clock.setBpm(84, 4)
    const arena = createArena({} as HTMLCanvasElement, clock)
    const sky = arena.scene.children.find((o) => (o as THREE.Mesh).geometry instanceof THREE.SphereGeometry) as THREE.Mesh
    const uni = (sky.material as THREE.ShaderMaterial).uniforms
    expect(uni.uTime.value).toBe(0)
    arena.update(0.016, 0.5)
    expect(uni.uTime.value).toBeCloseTo(0.5, 10)
    expect(uni.uIntensity.value).toBeGreaterThanOrEqual(0.85 - 1e-9)
    expect(uni.uIntensity.value).toBeLessThanOrEqual(1.15 + 1e-9)
  })

  it('resize()：camera.aspect 跟着 innerWidth/innerHeight，renderer.setSize 重交一次', () => {
    const clock = new RhythmClock()
    clock.setBpm(84, 4)
    const arena = createArena({} as HTMLCanvasElement, clock)
    const cam = arena.camera as THREE.PerspectiveCamera
    const spy = vi.spyOn(cam, 'updateProjectionMatrix')
    expect(captured.setSize).toEqual([[1280, 720]])

    g.innerWidth = 400
    g.innerHeight = 1000
    arena.resize()
    expect(captured.setSize).toEqual([[1280, 720], [400, 1000]]) // 第二次 setSize
    expect(cam.aspect).toBeCloseTo(0.4, 10)
    expect(spy).toHaveBeenCalled()
  })
})
