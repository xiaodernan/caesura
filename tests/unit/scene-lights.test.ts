import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { lightingLights, lightingRow } from '@/world/Lighting'
import { SceneLights } from '@/world/SceneLights'

/**
 * §37 第二腿的**表现层**（`world/SceneLights.ts`）。它 import three，所以能像
 * `tests/unit/vfx-materials.test.ts` 那样在 node 里直接跑——three 的 `Scene`/`Light` 不碰 WebGL，
 * 碰 WebGL 的是 `WebGLRenderer`（那只住在 `PlaceholderArena` 里，本文件一个渲染器都不建）。
 *
 * 量的只有一件事：**读数被原样搬到三盏灯上，而且搬几次都还是那三盏**。
 * 判断（哪一列配哪盏灯、缺省怎么办）住在 `world/Lighting.ts`，由 `lighting.test.ts` 量；
 * 这里连一个 hex 都不认——所有期望值都从 `lightingLights()` 现推，实现自己改规则会两边一起红。
 */

const rig = (id: string) => lightingLights(lightingRow(id))!

/** 场景里的灯，按类型分（顺序无关：判据不依赖 three 的插入次序） */
const lightsOf = (scene: THREE.Scene) => ({
  hemi: scene.children.filter((o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight),
  key: scene.children.filter((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight),
  point: scene.children.filter((o): o is THREE.PointLight => o instanceof THREE.PointLight),
})

describe('SceneLights：三盏灯，建一次，只改参数', () => {
  it('构造即挂上三盏，且全部从 0 亮度起（没有读数之前不该有没人认领的灯）', () => {
    const scene = new THREE.Scene()
    const sl = new SceneLights(scene)
    const { hemi, key, point } = lightsOf(scene)
    expect(hemi).toHaveLength(1)
    expect(key).toHaveLength(1)
    expect(point).toHaveLength(1)
    expect(hemi[0].intensity).toBe(0)
    expect(key[0].intensity).toBe(0)
    expect(point[0].intensity).toBe(0)
    expect(key[0].castShadow, '还没读数就投影 = 白烧一张 shadow map').toBe(false)
    void sl
  })

  it('休垒那一行：颜色逐格等于读数，强度原样搬过去', () => {
    const scene = new THREE.Scene()
    const sl = new SceneLights(scene)
    const r = rig('lp_resthold')
    sl.setRig(r, { x: 0, y: 20, z: 0 })
    const { hemi, key, point } = lightsOf(scene)
    expect(hemi[0].color.getHexString()).toBe(new THREE.Color(r.hemiSky).getHexString())
    expect(hemi[0].groundColor.getHexString()).toBe(new THREE.Color(r.hemiGround).getHexString())
    expect(hemi[0].intensity).toBe(r.hemiIntensity)
    expect(key[0].color.getHexString()).toBe(new THREE.Color(r.keyColor).getHexString())
    expect(key[0].intensity).toBe(r.keyIntensity)
    expect(key[0].castShadow, '有强度的方向光必须投影——§9 那张清单问的就是"三层光齐全"').toBe(true)
    expect(key[0].position.toArray()).toEqual(r.keyDir)
    expect(point[0].color.getHexString()).toBe(new THREE.Color(r.pointColor).getHexString())
    expect(point[0].intensity).toBe(r.pointIntensity)
    expect(point[0].position.toArray()).toEqual([0, 20, 0])
  })

  it('换区不新建灯：连设七次，场景里仍然只有三盏（少一只=漏光，多一只=两个主人）', () => {
    const scene = new THREE.Scene()
    const sl = new SceneLights(scene)
    for (const row of [rig('lp_resthold'), rig('lp_whisperwode'), rig('lp_earless_deeps'), rig('lp_fellcarillon')]) {
      sl.setRig(row, { x: 1, y: 2, z: 3 })
      const { hemi, key, point } = lightsOf(scene)
      expect(hemi).toHaveLength(1)
      expect(key).toHaveLength(1)
      expect(point).toHaveLength(1)
    }
    // 最后一行的读数真的落在同一批对象上（不是建了新的、旧的还挂着）
    const r = rig('lp_fellcarillon')
    const { hemi, key, point } = lightsOf(scene)
    expect(key[0].color.getHexString()).toBe(new THREE.Color(r.keyColor).getHexString())
    expect(point[0].color.getHexString()).toBe(new THREE.Color(r.pointColor).getHexString())
    expect(hemi[0].color.getHexString()).toBe(new THREE.Color(r.hemiSky).getHexString())
  })

  it('深窖：keyIntensity 0 ⇒ 方向光不投影（§8 的例外），另两层照亮', () => {
    const scene = new THREE.Scene()
    const sl = new SceneLights(scene)
    sl.setRig(rig('lp_earless_deeps'), { x: -240, y: -150, z: 140 })
    const { key, hemi, point } = lightsOf(scene)
    expect(key[0].intensity).toBe(0)
    expect(key[0].castShadow, '强度 0 的方向光还开着投影 = 一道看不见的阴影白烧一张 map').toBe(false)
    expect(hemi[0].intensity).toBeGreaterThan(0)
    expect(point[0].intensity).toBeGreaterThan(0)
  })

  it('没有挂点 ⇒ point 不亮，而不是挂在原点把整个世界照亮', () => {
    const scene = new THREE.Scene()
    const sl = new SceneLights(scene)
    sl.setRig(rig('lp_resthold'), null)
    const { point } = lightsOf(scene)
    expect(point[0].intensity).toBe(0)
    // 有挂点时才亮：这条钉住"null 只是不挂点"，不是把整条 point 腿废掉
    sl.setRig(rig('lp_resthold'), { x: 5, y: 6, z: 7 })
    expect(point[0].intensity).toBe(rig('lp_resthold').pointIntensity)
    expect(point[0].position.toArray()).toEqual([5, 6, 7])
  })

  it('setRig(null) = 三盏全关：读不出预设时不留上一区的灯（错色的光比黑帧更难查）', () => {
    const scene = new THREE.Scene()
    const sl = new SceneLights(scene)
    sl.setRig(rig('lp_resthold'), { x: 0, y: 0, z: 0 })
    sl.setRig(null, { x: 0, y: 0, z: 0 })
    const { hemi, key, point } = lightsOf(scene)
    expect(hemi[0].intensity).toBe(0)
    expect(key[0].intensity).toBe(0)
    expect(key[0].castShadow).toBe(false)
    expect(point[0].intensity).toBe(0)
  })

  it('dispose 把三盏都摘掉，且之后 setRig 不再往场景里加东西', () => {
    const scene = new THREE.Scene()
    const sl = new SceneLights(scene)
    sl.setRig(rig('lp_resthold'), { x: 0, y: 0, z: 0 })
    sl.dispose()
    const { hemi, key, point } = lightsOf(scene)
    expect(hemi).toHaveLength(0)
    expect(key).toHaveLength(0)
    expect(point).toHaveLength(0)
    sl.setRig(rig('lp_whisperwode'), { x: 1, y: 1, z: 1 })
    expect(lightsOf(scene).hemi, 'dispose 之后还往场景里加灯 = 没真摘').toHaveLength(0)
  })

  it('point 的距离与衰减是常量级的"局部"：documented 的两个数只有一个家', () => {
    const scene = new THREE.Scene()
    const sl = new SceneLights(scene)
    sl.setRig(rig('lp_resthold'), { x: 0, y: 0, z: 0 })
    const { point } = lightsOf(scene)
    expect(point[0].distance).toBeGreaterThan(0)
    expect(point[0].decay).toBe(2)
    void sl
  })
})
