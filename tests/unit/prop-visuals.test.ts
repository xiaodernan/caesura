/**
 * 可破坏场景物的表现层（`world/PropVisuals`）：逐帧读 `PropSystem` 的状态契约——
 * 完好/碎裂、区域闸门、外露门（`exposedWhen`）、核的余量亮度、挨一记歪一分。
 *
 * 这一层不产生任何状态，只把逻辑层已经算好的那几格画出来；所以断言全是"读方有没有老实照读"：
 * 逻辑说碎了 ⇒ 桩在体不在；逻辑说没外露 ⇒ 整个组不在场；逻辑说血池掉一半 ⇒ 亮度按同一份分数走。
 * headless：只断言可见性与姿态，不建 WebGL 上下文（同 greybox 系列）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { registerGameData, regions } from '@/data'
import { PropSystem, type Prop } from '@/world/Props'
import { PropVisuals } from '@/world/PropVisuals'

registerGameData()

/** 数据里全部 prop（音刺 3 根在深窖、振源核 3 枚在未竟厅）——容量从数据来，不抄常数 */
const ALL_PROPS = regions.flatMap((r) => (r.props ?? []).map((p) => ({ p, regionId: r.id })))

let active: (() => void) | null = null
afterEach(() => { active?.(); active = null })

function rig() {
  const scene = new THREE.Scene()
  /** 两个注入的读方都从这里改：闸门/外露是表现层的输入状态，用例之间不共享 */
  const state = {
    open: true,
    exposed: (_p: Prop): boolean => true,
  }
  const ps = new PropSystem(regions, () => state.open)
  const vis = new PropVisuals(scene, regions, () => state.open, (p) => state.exposed(p))
  const prop = (id: string): Prop => ps.all.find((x) => x.id === id)!
  /** 按数据给的坐标找回那一组（组不设名字，位置就是它的身份——数据不写第二份） */
  const groupOf = (id: string): THREE.Group => {
    const p = prop(id)
    const g = scene.children.find((c) =>
      c.position.x === p.pos.x && c.position.y === p.pos.y && c.position.z === p.pos.z)
    expect(g, `${id} 的占位组必须站在数据给的点上`).toBeDefined()
    return g as THREE.Group
  }
  /** 组内顺序 = 构造顺序：children[0] 残桩、children[1] 主体 */
  const meshes = (id: string): { stub: THREE.Mesh; body: THREE.Mesh } => {
    const g = groupOf(id)
    return { stub: g.children[0] as THREE.Mesh, body: g.children[1] as THREE.Mesh }
  }
  const dispose = (): void => { vis.dispose() }
  active = dispose
  return { scene, ps, vis, state, prop, groupOf, meshes, dispose }
}

describe('PropVisuals：逻辑层那几格状态有没有被原样画出来', () => {
  it('构造：每个 prop 一个组站在数据点上，形状按 kind 分（刺=锥、核=球），残桩先藏着', () => {
    const r = rig()
    expect(r.scene.children.length, '容量 = 数据里的 prop 数，与区域数无关').toBe(ALL_PROPS.length)
    const spine = r.meshes('prop_spine_mine')
    expect(spine.body.geometry, '音刺是细长黑锥（灰盒期就用真形状）').toBeInstanceOf(THREE.ConeGeometry)
    expect(spine.stub.geometry, '残桩是截短的墩').toBeInstanceOf(THREE.CylinderGeometry)
    expect(spine.stub.visible, '完好的时候残桩不现身').toBe(false)
    expect(spine.body.visible, '完好的时候主体在场').toBe(true)
    const core = r.meshes('prop_core_west')
    expect(core.body.geometry, '振源核是低球').toBeInstanceOf(THREE.SphereGeometry)
    expect(r.groupOf('prop_spine_gallery').position.z, '组站的位置就是数据里的 pos（不另抄一份坐标）')
      .toBe(r.prop('prop_spine_gallery').pos.z)
  })

  it('可见性三态：完好+开+外露 ⇒ 站着；外露门关 ⇒ 完好的核不在场；区域闸门关 ⇒ 一个都不画', () => {
    const r = rig()
    // 血量型的"完好"只看 hpLeft：先把两枚核各打一记把池子物化（否则 hpLeft 未定义＝没进过场）
    r.ps.bossQuery = (id) => (id === 'en_hersil' ? { hpMax: 1000, phase: 2, alive: true } : null)
    for (const id of ['prop_core_west', 'prop_core_east']) {
      expect(r.ps.hitProp(r.prop(id), { heavyFamily: true, rawDamage: 90 }), `${id} 吃一记`).toBe('chip')
    }
    r.state.exposed = (p) => p.id !== 'prop_core_west' // west 那枚还没到 phase 2
    r.vis.sync(r.ps.all)
    expect(r.groupOf('prop_spine_mine').visible, '完好 + 区域开 + 无外露条件 ⇒ 站着').toBe(true)
    expect(r.groupOf('prop_core_west').visible, 'exposedWhen 没成立 ⇒ 完好的核整个不在场（"之前不存在"）').toBe(false)
    expect(r.groupOf('prop_core_east').visible, '谓词只关掉 west 那一枚').toBe(true)
    expect(r.meshes('prop_core_east').body.visible, '开着的那枚连主体都画出来').toBe(true)
    r.state.open = false
    r.vis.sync(r.ps.all)
    expect(r.groupOf('prop_spine_mine').visible, '区域闸门关 ⇒ 整组不可见（与交互物同一条门）').toBe(false)
    expect(r.groupOf('prop_core_east').visible, '核同样吃这条门').toBe(false)
    r.state.open = true
    r.vis.sync(r.ps.all)
    expect(r.groupOf('prop_spine_mine').visible, '门再开回来 ⇒ 恢复').toBe(true)
  })

  it('碎了只剩残桩：主体藏、桩露，且不受外露门管（碎件是事实，不是状态）', () => {
    const r = rig()
    r.state.exposed = () => false // 外露门全关：完好件一律不画
    for (let i = 0; i < 4; i++) r.ps.hitProp(r.prop('prop_spine_mine'), { heavyFamily: true })
    expect(r.prop('prop_spine_mine').hitsLeft, '四记重击打满').toBe(0)
    r.vis.sync(r.ps.all)
    const m = r.meshes('prop_spine_mine')
    expect(r.groupOf('prop_spine_mine').visible, '碎件仍看得见（外露门只管完好件）').toBe(true)
    expect(m.body.visible, '主体没了').toBe(false)
    expect(m.stub.visible, '只剩残桩').toBe(true)
    r.state.open = false
    r.vis.sync(r.ps.all)
    expect(r.groupOf('prop_spine_mine').visible, '但区域闸门是无条件的：没解锁的格子连残桩也不画').toBe(false)
    // 名册里没有的 prop（组合根可能喂进临时件）：跳过而不是抛错
    expect(() => r.vis.sync([{ id: 'ghost', kind: 'soundspine', pos: { x: 0, y: 0, z: 0 }, regionId: 'rg_resthold' } as Prop]))
      .not.toThrow()
  })

  it('姿态与亮度都从状态现算：刺歪 1/4 上限，核的余量走同一份分数', () => {
    const r = rig()
    // 计数型：4 次预算打掉 1 记 ⇒ 歪 1/4×0.14（不另存角度，歪斜是耐久的影子）
    r.ps.hitProp(r.prop('prop_spine_lair'), { heavyFamily: true })
    r.vis.sync(r.ps.all)
    expect(r.meshes('prop_spine_lair').body.rotation.z, '挨一记歪一分').toBeCloseTo((1 - 3 / 4) * 0.14, 5)
    expect(r.meshes('prop_spine_mine').body.rotation.z, '没挨打的那根不歪').toBe(0)
    // 血量型：池子从当前 Boss 的 hpMax 物化（1000×0.18=180），打掉一半 ⇒ 亮度 0.3+0.5×1.1
    r.ps.bossQuery = (id) => (id === 'en_hersil' ? { hpMax: 1000, phase: 2, alive: true } : null)
    const core = r.prop('prop_core_west')
    expect(r.ps.hitProp(core, { heavyFamily: true, rawDamage: 90 }), '血量型按伤害扣池').toBe('chip')
    expect([core.hpPool, core.hpLeft], '池子懒物化 = hpMax×0.18').toEqual([180, 90])
    r.vis.sync(r.ps.all)
    const mat = r.meshes('prop_core_west').body.material as THREE.MeshStandardMaterial
    expect(mat.emissiveIntensity, '核的血条用亮度画，不另做 UI').toBeCloseTo(0.3 + (90 / 180) * 1.1, 5)
  })

  it('dispose：组全部离场，场景树清空', () => {
    const r = rig()
    expect(r.scene.children.length).toBe(ALL_PROPS.length)
    r.dispose()
    active = null
    expect(r.scene.children.length, '一个不留').toBe(0)
  })
})
