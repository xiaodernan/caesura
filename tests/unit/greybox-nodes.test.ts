/**
 * 交互物占位模（Phase 3-C3，修 KI-013）：26 条 interactables 必须在灰盒里看得见，
 * 且可见性跟着流送走、焦点/消耗态变色、往返不泄漏、drawcall 只按 kind 数增长。
 * headless：只断言实例矩阵/颜色，不建 WebGL 上下文。
 *
 * 注意：`world.chunk` 是全局总线，任何 StreamingSystem 的事件都会打到所有表现层实例，
 * 所以每条用例都自带一套 scene/stream/greybox 夹具，不共享、不互相污染。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { registerGameData, regions } from '@/data'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { InteractableGreybox } from '@/world/InteractableGreybox'

registerGameData()

type Pos = { x: number; y: number; z: number }
const ALL_FLAGS = [...new Set(regions.map((r) => r.unlockFlag).filter((f): f is string => !!f))]
const allItems = regions.flatMap((r) => r.interactables)
const kinds = [...new Set(allItems.map((i) => i.kind))]
const HOME: Pos = { x: 0, y: 0, z: 0 }
const LIFT_POS: Pos = { x: 110, y: 64, z: -350 }  // 钟坠院管风琴吊机（最高一层）
const WALL_POS: Pos = { x: 330, y: 0, z: 120 }    // 雾语林音壁（setsFlag = choir_entrance_open）

function fixture(unlockAll = false, flags: Set<string> = new Set()) {
  const scene = new THREE.Scene()
  const stream = new StreamingSystem(regions)
  if (unlockAll) for (const f of ALL_FLAGS) stream.setFlag(f)
  const greybox = new InteractableGreybox(scene, regions, (pos) => {
    const c = stream.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz)
  }, (k) => flags.has(k))
  let tick = 0
  let at: Pos = { x: 0, y: 0, z: 0 }
  const goTo = (pos: Pos): void => {
    at = pos
    stream.teleport(++tick, pos)
    const from = tick
    while (tick - from < 4000) {
      tick++
      stream.update(tick, pos)
      if (stream.stats().queued === 0 && stream.inFlight === 0) break
    }
  }
  /** 原地待 n tick：让 120 tick 卸载防抖走完 */
  const wait = (n: number): void => { for (let k = 0; k < n; k++) { tick++; stream.update(tick, at) } }
  return { scene, stream, greybox, goTo, wait, dispose: () => { greybox.dispose(); stream.dispose() } }
}

/** 未被压扁（scale>0）的实例：矩阵平移分量 + 实例色 */
function visible(mesh: THREE.InstancedMesh): { x: number; y: number; z: number; rgb: [number, number, number] }[] {
  const m = mesh.instanceMatrix.array as ArrayLike<number>
  const col = mesh.instanceColor?.array as ArrayLike<number>
  const out: { x: number; y: number; z: number; rgb: [number, number, number] }[] = []
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 16
    if (Math.abs(m[o]) < 1e-6) continue
    out.push({ x: m[o + 12], y: m[o + 13], z: m[o + 14], rgb: [col[o], col[o + 1], col[o + 2]] })
  }
  return out
}

const sum = (c: [number, number, number]): number => c[0] + c[1] + c[2]

/** 某条目当前可见实例（按 xz 精确匹配） */
function slotOf(scene: THREE.Scene, id: string) {
  const it = allItems.find((i) => i.id === id)!
  const mesh = scene.getObjectByName(`greybox_node:${it.kind}`) as THREE.InstancedMesh
  return visible(mesh).find((p) => Math.abs(p.x - it.pos.x) < 0.5 && Math.abs(p.z - it.pos.z) < 0.5)
}

let active: (() => void) | null = null
afterEach(() => { active?.(); active = null })

describe('InteractableGreybox（交互物在灰盒里可见）', () => {
  it('只建数据里出现过的 kind 池，容量 = 该 kind 条目数，与 chunk 数无关', () => {
    const f = fixture()
    active = f.dispose
    expect(f.scene.children.length).toBe(kinds.length)
    expect(f.greybox.poolCount).toBe(kinds.length)
    for (const k of kinds) {
      expect((f.scene.getObjectByName(`greybox_node:${k}`) as THREE.InstancedMesh).count, k)
        .toBe(allItems.filter((i) => i.kind === k).length)
    }
    f.goTo(HOME); f.goTo(WALL_POS); f.goTo(HOME)
    expect(f.scene.children.length, '走过三个片区后 drawcall 对象数不变').toBe(kinds.length)
  })

  it('跟着流送走：未解锁区域不放模，解锁并走到高层才出现该格交互物', () => {
    const f = fixture()
    active = f.dispose
    f.goTo(HOME)
    expect(f.greybox.liveProps).toBeGreaterThan(0) // 休垒无 unlockFlag，起始格就摆得出
    expect(slotOf(f.scene, 'el_fellcarillon_organlift'), '未解锁时钟坠院无模').toBeUndefined()
    f.dispose(); active = null
    const g = fixture(true)
    active = g.dispose
    g.goTo(LIFT_POS)
    const lift = slotOf(g.scene, 'el_fellcarillon_organlift')
    expect(lift, '管风琴吊机占位模').toBeDefined()
    expect(lift!.y).toBeGreaterThan(64) // 站在数据给的层上，不陷进地里
  })

  it('焦点变色：ui.prompt(id) 点亮该实例，清空后回到原色', () => {
    const f = fixture()
    active = f.dispose
    f.goTo(HOME)
    const base = slotOf(f.scene, 'gt_resthold_gate')
    expect(base).toBeDefined()
    bus.emit('ui.prompt', { text: '开门 · 休垒', id: 'gt_resthold_gate' })
    expect(sum(slotOf(f.scene, 'gt_resthold_gate')!.rgb)).toBeGreaterThan(sum(base!.rgb))
    bus.emit('ui.prompt', { text: null, id: null })
    expect(slotOf(f.scene, 'gt_resthold_gate')!.rgb).toEqual(base!.rgb)
  })

  it('消耗态由 flag 谓词决定：事件驱动压暗，读档后首帧落位即压暗', () => {
    const flags = new Set<string>()
    const f = fixture(true, flags)
    active = f.dispose
    f.goTo(WALL_POS)
    const bright = slotOf(f.scene, 'sw_whisperwode_soundwall')
    expect(bright, '音壁在激活格里').toBeDefined()
    bus.emit('world.flag', { key: 'flag.bell_toll_rung', value: true })
    expect(sum(slotOf(f.scene, 'sw_whisperwode_soundwall')!.rgb), '无关 flag 不变色').toBe(sum(bright!.rgb))
    flags.add('flag.choir_entrance_open')
    bus.emit('world.flag', { key: 'flag.choir_entrance_open', value: true })
    expect(sum(slotOf(f.scene, 'sw_whisperwode_soundwall')!.rgb), '消耗后压暗').toBeLessThan(sum(bright!.rgb))
    f.dispose(); active = null
    // 新实例（= 读档）：谓词里已有 flag，第一次落位就是消耗态
    const g = fixture(true, new Set(['flag.left_resthold']))
    active = g.dispose
    g.goTo(HOME)
    const spentGate = slotOf(g.scene, 'gt_resthold_gate')!
    const freshPeg = slotOf(g.scene, 'st_resthold')
    expect(freshPeg, '休垒调音桩未消耗').toBeDefined()
    expect(sum(spentGate.rgb)).toBeLessThan(sum(freshPeg!.rgb))
  })

  it('走远卸载归还实例；反复横跳每次都落回同一稳态水位（无槽位泄漏）', () => {
    const f = fixture(true)
    active = f.dispose
    f.goTo(HOME); f.wait(400)
    const first = f.greybox.liveProps
    expect(first).toBeGreaterThan(0)
    for (const far of [{ x: 160, y: 0, z: -100 }, { x: 250, y: -40, z: 20 }, LIFT_POS] as Pos[]) {
      f.goTo(far)
      expect(f.greybox.liveProps, `at ${far.x},${far.y},${far.z}`).toBeGreaterThan(0)
      f.goTo(HOME)
      // 刚回家时远端格还在 120 tick 卸载防抖里 ⇒ 只增不减
      expect(f.greybox.liveProps, 'back home').toBeGreaterThanOrEqual(first)
      f.wait(400)
      expect(f.greybox.liveProps, 'settled home').toBe(first)
    }
    expect(f.greybox.peak).toBeGreaterThanOrEqual(first)
    for (const kind of kinds) {
      const mesh = f.scene.getObjectByName(`greybox_node:${kind}`) as THREE.InstancedMesh
      expect(visible(mesh).length, kind).toBeLessThanOrEqual(mesh.count)
    }
  })

  it('dispose：对象全部离场，之后事件不再改变状态', () => {
    const f = fixture(true)
    f.stream.teleport(0, HOME)
    f.greybox.syncActive(f.stream.byState('active').map((c) => c.key))
    expect(f.greybox.liveProps).toBeGreaterThan(0)
    expect(f.scene.children.length).toBe(kinds.length)
    f.greybox.dispose()
    expect(f.scene.children.length).toBe(0)
    const before = f.greybox.liveProps
    f.stream.teleport(50, { x: 40, y: 0, z: -40 })
    expect(f.greybox.liveProps).toBe(before)
    f.stream.dispose()
  })
})
