/**
 * KI-013 打磨第三腿：`InteractableGreybox.animate(tick)` 的读方。
 *
 * 三条动画各自钉住"动的是什么、不动的是什么"——**位置是契约**（数据给的点 + LIFT 半高，
 * animate 不许把图标飘起来），动的只有颜色（调音桩呼吸灯）、朝向（采集点绕 Y 慢转）、
 * Y 缩放（NPC 微呼吸）。`animate` 的 tick 是调用方给的显式参数（main.ts 每帧喂一次），
 * 所以这里不需要驱动流送：直接 `syncActive` 落位、再按 tick 直喂。
 *
 * headless：只读实例矩阵与实例色，不建 WebGL 上下文（与 `greybox-nodes.test.ts` 同手法）。
 * 两个量具细节写在这里，免得后来人当成 bug：实例矩阵是 Float32Array（坐标要按近似值比）；
 * three 的 `needsUpdate` 是**只写**的 setter（读回来恒为 undefined），"标没标脏"只能数
 * `InstancedBufferAttribute.version`——它是 needsUpdate=true 的唯一计数器。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { registerGameData, regions } from '@/data'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { InteractableGreybox } from '@/world/InteractableGreybox'
import type { Vec3 } from '@/data/schema'

registerGameData()

const CHUNK = 48

/** 落位到指定格：绕开流送门（`syncActive` 直调 `onChunk`，与 main.ts 首帧那一次同一条路） */
function fixture(stateOk: (req: { key: string; value: string }) => boolean = () => false) {
  const scene = new THREE.Scene()
  const stream = new StreamingSystem(regions)
  const greybox = new InteractableGreybox(scene, regions, (pos) => {
    const c = stream.cellOf(pos)
    return chunkKeyOf(c.cx, c.cy, c.cz)
  }, () => false, stateOk)
  return { scene, stream, greybox, dispose: () => { greybox.dispose(); stream.dispose() } }
}

const poolOf = (scene: THREE.Scene, kind: string): THREE.InstancedMesh =>
  scene.getObjectByName(`greybox_node:${kind}`) as THREE.InstancedMesh

/** HIDDEN 是全零矩阵 ⇒ "有任何一个元素非零"才是可见（不能只看 m[0]：转到 90° 时它恰为 0） */
const isShown = (m: ArrayLike<number>, o: number): boolean => {
  for (let k = 0; k < 16; k++) if (m[o + k] !== 0) return true
  return false
}

/** 按数据坐标找实例（矩阵平移分量 + 实例色一起读回来） */
function slotAt(mesh: THREE.InstancedMesh, p: Vec3) {
  const m = mesh.instanceMatrix.array as ArrayLike<number>
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 16
    if (!isShown(m, o)) continue
    if (Math.abs(m[o + 12] - p.x) < 0.5 && Math.abs(m[o + 13] - p.y) < 0.5 && Math.abs(m[o + 14] - p.z) < 0.5) {
      const c = mesh.instanceColor!.array as ArrayLike<number>
      return { index: i, rgb: [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]] as [number, number, number] }
    }
  }
  return null
}

const colorAt = (mesh: THREE.InstancedMesh, i: number): [number, number, number] => {
  const c = mesh.instanceColor!.array as ArrayLike<number>
  return [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]]
}
const lum = (c: [number, number, number]): number => c[0] + c[1] + c[2]
const cellOf = (p: Vec3): string => `${Math.floor(p.x / CHUNK)},${Math.floor(p.y / CHUNK)},${Math.floor(p.z / CHUNK)}`

/** 实例矩阵的第 i 号平移（Float32 ⇒ 近似比） */
function at(mesh: THREE.InstancedMesh, i: number): [number, number, number] {
  const m = mesh.instanceMatrix.array as ArrayLike<number>
  const o = i * 16
  return [m[o + 12], m[o + 13], m[o + 14]]
}

// 数据里的四个坐标（regions.json）：休垒调音桩 / 闸门 / 铃姨 / 雾语林采集点
const PEG: Vec3 = { x: -12, y: 0, z: 18 }        // st_resthold（checkpoint，LIFT 1.6）
const GATE: Vec3 = { x: 80, y: 0, z: 0 }         // gt_resthold_gate（gate，LIFT 2.5）
const NPC: Vec3 = { x: 8, y: 0, z: 26 }          // npc_belltongue（npc，LIFT 0.9）
const VEIN: Vec3 = { x: 200, y: 0, z: 90 }       // gh_whisperwode_timbite_1（gather，LIFT 0.7）
const PEG_UP: [number, number, number] = [PEG.x, PEG.y + 1.6, PEG.z]
const GATE_UP: [number, number, number] = [GATE.x, GATE.y + 2.5, GATE.z]
const NPC_UP: [number, number, number] = [NPC.x, NPC.y + 0.9, NPC.z]
const VEIN_UP: [number, number, number] = [VEIN.x, VEIN.y + 0.7, VEIN.z]

/**
 * 源码里那两个色（`COLOR.checkpoint` / `FOCUS`）与脉动极值。
 * 注意这里也必须逐通道插值：packed hex 上做加减会跨通道进位（那正是被修掉的那个 bug 的形状），
 * 所以"中点"是 `Color.lerp(...,0.5)`，不是 `0xd9b46a + (0xfff2c8-0xd9b46a)*0.5`。
 * pulse∈[0,1] ⇒ 亮度∈[BASE, MID]。
 */
const BASE = new THREE.Color().setHex(0xd9b46a)
const MID = new THREE.Color().setHex(0xd9b46a).lerp(new THREE.Color().setHex(0xfff2c8), 0.5)
const BASE_LUM = lum([BASE.r, BASE.g, BASE.b])
const MID_LUM = lum([MID.r, MID.g, MID.b])

let active: (() => void) | null = null
afterEach(() => { active?.(); active = null })

describe('InteractableGreybox.animate：KI-013 三条动效的读方', () => {
  it('调音桩呼吸灯：颜色在基色与焦点色之间脉动，位置一步不动', () => {
    const f = fixture()
    active = f.dispose
    f.greybox.syncActive([cellOf(PEG)])
    const mesh = poolOf(f.scene, 'checkpoint')
    const peg = slotAt(mesh, { x: PEG_UP[0], y: PEG_UP[1], z: PEG_UP[2] })
    expect(peg, '调音桩已落位').not.toBeNull()

    const samples: [number, number, number][] = []
    for (let t = 0; t <= 300; t += 3) {
      f.greybox.animate(t)
      const p = at(mesh, peg!.index)
      expect(p[0], `tick ${t} x 不许动`).toBeCloseTo(PEG_UP[0], 5)
      expect(p[1], `tick ${t} y 不许动`).toBeCloseTo(PEG_UP[1], 5)
      expect(p[2], `tick ${t} z 不许动`).toBeCloseTo(PEG_UP[2], 5)
      samples.push(colorAt(mesh, peg!.index))
    }

    // 每个样本都落在 [基色, 焦点极值] 这一格里（脉动 = 在两端之间往复，不许漂出带）
    for (const c of samples) {
      expect(c[0]).toBeGreaterThanOrEqual(BASE.r - 1e-6)
      expect(c[1]).toBeGreaterThanOrEqual(BASE.g - 1e-6)
      expect(c[2]).toBeGreaterThanOrEqual(BASE.b - 1e-6)
      expect(c[0]).toBeLessThanOrEqual(MID.r + 1e-6)
      expect(c[1]).toBeLessThanOrEqual(MID.g + 1e-6)
      expect(c[2]).toBeLessThanOrEqual(MID.b + 1e-6)
    }
    // 真的在呼吸：亮度有幅度，且 tick=0 这一格已离开基色（pulse=0.5 ⇒ 介于两端之间）
    const lums = samples.map(lum)
    expect(Math.max(...lums) - Math.min(...lums), '脉动幅度').toBeGreaterThan(0.01)
    expect(lums[0], 'tick=0 已亮过基色').toBeGreaterThan(BASE_LUM + 1e-4)
    expect(lums[0], 'tick=0 未到焦点极值').toBeLessThan(MID_LUM)
  })

  it('呼吸灯真的往复：亮过也暗过，且每帧都把实例色标脏', () => {
    const f = fixture()
    active = f.dispose
    f.greybox.syncActive([cellOf(PEG)])
    const mesh = poolOf(f.scene, 'checkpoint')
    const peg = slotAt(mesh, { x: PEG_UP[0], y: PEG_UP[1], z: PEG_UP[2] })!
    let brighter = false
    let dimmer = false
    for (let t = 0; t <= 300; t += 3) {
      const v = mesh.instanceColor!.version
      f.greybox.animate(t)
      const l = lum(colorAt(mesh, peg.index))
      if (l > (BASE_LUM + MID_LUM) / 2) brighter = true
      if (l < (BASE_LUM + MID_LUM) / 2) dimmer = true
      expect(mesh.instanceColor!.version, `tick ${t} 改过颜色就要标脏`).toBe(v + 1)
    }
    expect(brighter, '正弦上半周期：比中点亮').toBe(true)
    expect(dimmer, '正弦下半周期：比中点暗').toBe(true)
  })

  it('采集点绕 Y 慢转：转的是朝向，位置钉死、不放缩', () => {
    const f = fixture()
    active = f.dispose
    f.greybox.syncActive([cellOf(VEIN)])
    const mesh = poolOf(f.scene, 'gather')
    const vein = slotAt(mesh, { x: VEIN_UP[0], y: VEIN_UP[1], z: VEIN_UP[2] })
    expect(vein, '采集点已落位').not.toBeNull()
    const m = mesh.instanceMatrix.array as ArrayLike<number>
    const o = vein!.index * 16

    f.greybox.animate(0)
    expect(m[o], 'tick=0 时转角为 0（单位旋转）').toBeCloseTo(1, 6)
    expect(m[o + 8]).toBeCloseTo(0, 6)
    expect(m[o + 5], 'Y 轴不放缩').toBe(1)

    f.greybox.animate(100)
    expect(m[o], '转过 1.5rad 后朝向变了').toBeCloseTo(Math.cos(1.5), 6)
    expect(m[o + 8]).toBeCloseTo(Math.sin(1.5), 6)
    expect(m[o + 5], '旋转不放缩').toBe(1)
    expect(m[o + 12], '位置钉在原地 x').toBeCloseTo(VEIN_UP[0], 5)
    expect(m[o + 13], '位置钉在原地 y').toBeCloseTo(VEIN_UP[1], 5)
    expect(m[o + 14], '位置钉在原地 z').toBeCloseTo(VEIN_UP[2], 5)
    expect(mesh.instanceMatrix.version, '改过矩阵就要标脏').toBeGreaterThan(0)
  })

  it('NPC 微呼吸：只有 Y 缩放在 ±2% 内动，相位吃 pos.x，XZ 与位置不动', () => {
    const f = fixture()
    active = f.dispose
    f.greybox.syncActive([cellOf(NPC)])
    const mesh = poolOf(f.scene, 'npc')
    const npc = slotAt(mesh, { x: NPC_UP[0], y: NPC_UP[1], z: NPC_UP[2] })
    expect(npc, 'NPC 已落位').not.toBeNull()
    const m = mesh.instanceMatrix.array as ArrayLike<number>
    const o = npc!.index * 16

    f.greybox.animate(0)
    // 相位用的是 pos.x：忘了它，tick=0 的呼吸就该是恒 1 而不是 sin(pos.x)
    expect(m[o + 5], 'tick=0 的 Y 缩放 = 1 + sin(pos.x)×2%').toBeCloseTo(1 + Math.sin(NPC.x) * 0.02, 6)

    const scales: number[] = []
    for (let t = 0; t <= 300; t += 3) {
      f.greybox.animate(t)
      scales.push(m[o + 5])
      expect(m[o + 5], `tick ${t} 呼吸不超出 ±2%`).toBeGreaterThanOrEqual(1 - 0.02 - 1e-6)
      expect(m[o + 5], `tick ${t} 呼吸不超出 ±2%`).toBeLessThanOrEqual(1 + 0.02 + 1e-6)
      expect(m[o], 'X 轴不放缩').toBe(1)
      expect(m[o + 10], 'Z 轴不放缩').toBe(1)
      expect(m[o + 12], `tick ${t} 的位置 x 不许动`).toBeCloseTo(NPC_UP[0], 5)
      expect(m[o + 13], `tick ${t} 的位置 y 不许动`).toBeCloseTo(NPC_UP[1], 5)
      expect(m[o + 14], `tick ${t} 的位置 z 不许动`).toBeCloseTo(NPC_UP[2], 5)
    }
    expect(Math.max(...scales) - Math.min(...scales), '呼吸有幅度').toBeGreaterThan(0.01)
  })

  it('不相关的 kind 一步不动：animate 只认 checkpoint/gather/npc 三家', () => {
    const f = fixture()
    active = f.dispose
    f.greybox.syncActive([cellOf(GATE)])
    const mesh = poolOf(f.scene, 'gate')
    const gate = slotAt(mesh, { x: GATE_UP[0], y: GATE_UP[1], z: GATE_UP[2] })
    expect(gate, '闸门已落位').not.toBeNull()
    const before = Array.from(mesh.instanceMatrix.array as ArrayLike<number>)
    const beforeV = mesh.instanceMatrix.version
    const beforeColor = colorAt(mesh, gate!.index)

    for (const t of [0, 17, 70, 139, 300]) f.greybox.animate(t)

    expect(Array.from(mesh.instanceMatrix.array as ArrayLike<number>), '闸门矩阵逐字节不变').toEqual(before)
    expect(mesh.instanceMatrix.version, '矩阵没标过脏').toBe(beforeV)
    expect(colorAt(mesh, gate!.index), '闸门颜色不变').toEqual(beforeColor)
  })

  it('colorDirty 闸门：场上没有调音桩就不碰 checkpoint 池的实例色', () => {
    const f = fixture()
    active = f.dispose
    const cp = poolOf(f.scene, 'checkpoint')

    f.greybox.syncActive([cellOf(VEIN)]) // 这一格里只有采集点
    const v0 = cp.instanceColor!.version
    f.greybox.animate(100)
    expect(cp.instanceColor!.version, '没有 checkpoint 在场 ⇒ 不标脏').toBe(v0)

    f.greybox.syncActive([cellOf(PEG)]) // 调音桩落位
    const v1 = cp.instanceColor!.version
    f.greybox.animate(100)
    expect(cp.instanceColor!.version, 'checkpoint 在场 ⇒ 标脏').toBe(v1 + 1)
  })
})
