/**
 * KI-315：`src/world/HitboxWire.ts` 的第一批机器读者——§17 调试器那一格里「hitbox 线框」的承载体。
 *
 * **这个文件存在的唯一一句话**：文档写「屏幕显示 hitbox 线框」而场里一格都没画（KI-300 腿 L13 量的六格读数全 0）。
 * 补上承载体只是半笔账；另外半笔是**「画出来的框＝挨打的框」这句不许留在口头**。那句有三种假绿法，逐条对着打：
 *  ① 线框自己算一套坐标（与 `shapeHits` 分家）⇒ 每条承重腿都拿**同一批点**去问 `shapeHits`，
 *     外沿、角度、高度层、豁免圈四个边界各一条，两边读同一条判据的**开/闭**（三格含等号、一格严格小于）；
 *  ② 线框画的是"膨胀后的命中区"（把目标体积烧进几何）⇒ 判据是「零体积目标打在画出的点上＝命中，
 *     往外 1e-3＝不命中」，另加「0.55 的真体积在弧外那一圈里照样挨打」——两格同时成立才叫画的是 authored box；
 *  ③ 关着的时候还在每帧建线段（默认全关那条纪律漏了）⇒ `feedCalls` 与 `geometryBuilds` 两把尺子在关闭态纹丝不动。
 *
 * **口径**（先量过才落笔，2026-10-24）：
 *  - 局部空间约定 `+Z＝出手朝向、原点＝出手点`，朝向交给 `object.rotation.y`。这与 three.js 自身的 Euler-Y
 *    一致（`(0,0,r)` 绕 Y 转 `yaw` ⇒ `(r·sin yaw, ·, r·cos yaw)`），也正是 `shapeHits` 里
 *    `atan2(dx, dz) - yaw` 与球心 `(sin yaw, cos yaw)` 那两处的同一个约定 ⇒ 才有「matrixWorld ⇄ 解析式」那条腿；
 *  - 顶点存的是 **float32**（`Float32BufferAttribute`），从对象上读回来比对账允差 1e-5；
 *    `wireVertices()` 返回 double ⇒ 形状不变量那一组按精确值读（`uniq` 只把 0.9−0.8 那类浮点尾数归到 6 位）；
 *  - 「零体积目标」= `{radius: 0, height: 0}`，只为把判据的开闭露出来；真实敌人体积（0.44／1.28）单独一条腿登记。
 *
 * **测不到的那一半如实说**：线段宽度、被灰盒遮挡、与特效叠色——本机没有可见视口（KI-010 老账），
 * 本文件测顶点与开关纪律，不测渲染结果。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import {
  HitboxWire, PLAYER_WIRE_KEY, boxFingerprint, wiresFrom, wireVertices,
  type WireInput, type WireSource,
} from '@/world/HitboxWire'
import { POINT_BLANK_GRACE, shapeHits, type HitTarget } from '@/combat/HitShapes'
import { VFX_PALETTE } from '@/vfx/materials'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { playerBase, registerGameData } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { newAttack } from '@/ai/Enemy'
import type { Input } from '@/core/Input'
import { RpgRuntime } from '@/rpg/Runtime'

registerGameData()

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const src = (p: string): string => readFileSync(ROOT + p, 'utf8')
/* 注释里点名一个符号，与代码里用它，是两件不同的事——KI-315 的第一趟就是被这句绊的：
   `POINT_BLANK_GRACE` 的 JSDoc 写着「不到 `target.radius + 0.25`」，于是"裸 0.25 不许再出现"那条判据
   在解释自己为什么存在的散文上红了。散文会解释判据，判据不该读散文 ⇒ 整文件扫之前先把注释剥掉。 */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n]*$/gm, '')

/* ------------------------------------------------------------------ 裸全局键监听的替身 */
/* `HitboxWire` 与三块面板一样用**裸全局** `addEventListener`（node 环境里这两把函数根本不存在，
   不替身就是构造即 ReferenceError——那是"手臂断了怪天气"的那种红）。 */
const hooked: Array<{ type: string; cb: (e: unknown) => void }> = []
const glob = globalThis as unknown as Record<string, unknown>
const realAdd = glob.addEventListener
const realRemove = glob.removeEventListener

beforeAll(() => {
  glob.addEventListener = (type: string, cb: (e: unknown) => void): void => { hooked.push({ type, cb }) }
  glob.removeEventListener = (type: string, cb: (e: unknown) => void): void => {
    const i = hooked.findIndex((l) => l.type === type && l.cb === cb)
    if (i >= 0) hooked.splice(i, 1)
  }
})
afterAll(() => {
  if (realAdd === undefined) delete glob.addEventListener
  else glob.addEventListener = realAdd
  if (realRemove === undefined) delete glob.removeEventListener
  else glob.removeEventListener = realRemove
})

/** 敲一把键，返回有几个监听者真的吃了 `preventDefault` */
function press(key: string): number {
  let prevented = 0
  const ev = { key, preventDefault(): void { prevented++ } }
  for (const l of [...hooked]) if (l.type === 'keydown') l.cb(ev)
  return prevented
}

const alive: Array<() => void> = []
afterEach(() => {
  while (alive.length) alive.pop()!()
})

/* ------------------------------------------------------------------ 顶点读回 */

type Pt = readonly [number, number, number]
const EPS = 1e-9

const splitVerts = (flat: ArrayLike<number>): Pt[] => {
  const out: Pt[] = []
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]])
  return out
}
const round6 = (v: number): number => Number(v.toFixed(6))
const radiusOf = (p: Pt): number => Math.hypot(p[0], p[2])
const angleOf = (p: Pt): number => (Math.atan2(p[0], p[2]) * 180) / Math.PI
const uniq = (xs: readonly number[]): number[] => [...new Set(xs.map(round6))].sort((a, b) => a - b)

/** 零体积目标：把判据的开/闭露出来的那把尺子 */
const at = (x: number, y: number, z: number, over: Partial<HitTarget> = {}): HitTarget =>
  ({ pos: { x, y, z }, facingYaw: 0, radius: 0, height: 0, ...over })
const ptTarget = (p: Pt, over: Partial<HitTarget> = {}): HitTarget => at(p[0], p[1], p[2], over)

const ORIGIN = { x: 0, y: 0, z: 0 }

/** 三张合成框：cone 那一张就是调音剑 L1 的表行（下面有名册腿钉着）；sphere 表里零格，只能合成 */
const CONE: WireInput['box'] = { shape: 'cone', angleDeg: 100, radius: 2.1, height: 1.6, offsetY: 0.9 }
const SPHERE: WireInput['box'] = { shape: 'sphere', radius: 1.4, offsetY: 0.7, offsetFwd: 1.8 }
const RING: WireInput['box'] = { shape: 'ring', inner: 1.1, outer: 2.6, forward: 0.4 }

const input = (key: string, box: WireInput['box'], origin = ORIGIN, yaw = 0): WireInput =>
  ({ key, hostile: false, box, origin, yaw })

describe('口径自证：三种形状的顶点装配', () => {
  /* `LineSegments` 吃的是**线段端点对**铺平后的数组：一条线段两个点 ⇒ 每对 6 个数，
     折线的相邻两段各写一遍公共端点（这不是浪费，`LineSegments` 没有"折连续线"这一说）。 */
  it('cone：102 条线段（=612 个数）、三层高度、半径只有 {0, 豁免圈, radius} 三个值', () => {
    const flat = wireVertices(CONE)
    expect(flat.length).toBe(102 * 6)
    const verts = splitVerts(flat)
    expect(verts.length).toBe(102 * 2)
    expect(uniq(verts.map((v) => v[1]))).toEqual([0.1, 0.9, 1.7])
    expect(uniq(verts.map(radiusOf))).toEqual([0, POINT_BLANK_GRACE, 2.1])
  })

  it('cone：扇面只到 ±half，豁免圈却是**整圈**（判据在圈里把角度作废）', () => {
    const verts = splitVerts(wireVertices(CONE))
    const fan = verts.filter((v) => radiusOf(v) > POINT_BLANK_GRACE + EPS)
    expect(round6(Math.max(...fan.map(angleOf)))).toBe(50)
    expect(round6(Math.min(...fan.map(angleOf)))).toBe(-50)
    const grace = verts.filter((v) => Math.abs(radiusOf(v) - POINT_BLANK_GRACE) < EPS)
    expect(grace.length, '整圈 24 段 ⇒ 48 个端点槽').toBe(48)
    expect(new Set(grace.map((v) => v.map(round6).join(','))).size, '25 个采样、首尾重合 ⇒ 圈上 24 个不同位置').toBe(24)
    expect(round6(Math.max(...grace.map(angleOf)))).toBeCloseTo(180, 4)
  })

  it('sphere：72 条线段，每个端点到球心的距离恰为 radius（三条正交大圆，没有一根从出手点牵出去的辐条）', () => {
    const flat = wireVertices(SPHERE)
    expect(flat.length).toBe(72 * 6)
    const center: Pt = [0, 0.7, 1.8]
    const d = splitVerts(flat).map((v) => Math.hypot(v[0] - center[0], v[1] - center[1], v[2] - center[2]))
    expect(round6(Math.min(...d))).toBe(1.4)
    expect(round6(Math.max(...d))).toBe(1.4)
  })

  it('ring：49 条线段，全部端点 y=0（那一支一个字节都不读高度），半径只有 {inner, outer+forward} 两圈', () => {
    const flat = wireVertices(RING)
    expect(flat.length).toBe(49 * 6)
    const verts = splitVerts(flat)
    expect(verts.length).toBe(49 * 2)
    expect(uniq(verts.map((v) => v[1]))).toEqual([0])
    expect(uniq(verts.map(radiusOf))).toEqual([1.1, 3])
  })

  it('segments 只是视觉量：换成 4 段，四个边界读数（最外/最内的水平半径与 y 的上下极值）一个都不动', () => {
    for (const box of [CONE, SPHERE, RING]) {
      const a = splitVerts(wireVertices(box, 24))
      const b = splitVerts(wireVertices(box, 4))
      for (const pick of [(v: Pt): number => radiusOf(v), (v: Pt): number => v[1]]) {
        expect(round6(Math.max(...b.map(pick)))).toBe(round6(Math.max(...a.map(pick))))
        expect(round6(Math.min(...b.map(pick)))).toBe(round6(Math.min(...a.map(pick))))
      }
    }
  })
})

describe('承重腿：画出来的点 ⇄ shapeHits 判在同一批点上（零体积目标）', () => {
  it('cone 外沿含等号：弧上那一点挨打，往外 1e-3 不挨', () => {
    expect(shapeHits(CONE, ORIGIN, 0, at(0, 0.9, 2.1))).toBe(true)
    expect(shapeHits(CONE, ORIGIN, 0, at(0, 0.9, 2.101))).toBe(false)
    const midArc = splitVerts(wireVertices(CONE)).filter((v) => Math.abs(radiusOf(v) - 2.1) < EPS && Math.abs(v[1] - 0.9) < EPS)
    expect(midArc.length, '中面外沿没画出顶点＝这一格在空跑').toBeGreaterThan(0)
    for (const v of midArc) expect(shapeHits(CONE, ORIGIN, 0, ptTarget(v)), `中面外沿 ${JSON.stringify(v)}`).toBe(true)
  })

  it('cone 角度含等号：±half 那条边线挨打，再多 0.01° 不挨', () => {
    const a = (50 * Math.PI) / 180
    expect(shapeHits(CONE, ORIGIN, 0, at(Math.sin(a) * 2.1, 0.9, Math.cos(a) * 2.1))).toBe(true)
    const b = ((50 + 0.01) * Math.PI) / 180
    expect(shapeHits(CONE, ORIGIN, 0, at(Math.sin(b) * 2.1, 0.9, Math.cos(b) * 2.1))).toBe(false)
    const tip = splitVerts(wireVertices(CONE)).filter((v) => Math.abs(angleOf(v) - 50) < 1e-6 && Math.abs(radiusOf(v) - 2.1) < EPS)
    expect(tip.length, '画出的那条边线自己不在 50° 上＝上面两格读的不是线框').toBeGreaterThan(0)
  })

  it('cone 高度层是**严格小于**：画出的上/下沿那两道弧自己不被判打（边框不是命中区）', () => {
    const yHi = 0.9 + 1.6 / 2
    const yLo = 0.9 - 1.6 / 2
    expect(shapeHits(CONE, ORIGIN, 0, at(0, yHi, 1))).toBe(false)
    expect(shapeHits(CONE, ORIGIN, 0, at(0, yLo, 1))).toBe(false)
    expect(shapeHits(CONE, ORIGIN, 0, at(0, yHi - 1e-3, 1))).toBe(true)
    expect(shapeHits(CONE, ORIGIN, 0, at(0, yLo + 1e-3, 1))).toBe(true)
    const ys = uniq(splitVerts(wireVertices(CONE)).map((v) => v[1]))
    expect([ys[0], ys[ys.length - 1]], '上面两个"不挨打"的 y 恰是画出来的那两条边').toEqual([round6(yLo), round6(yHi)])
    /* 那三道边框得**真的是弧**，不是几根立柱的端点：每一层在半径 2.1 上要有 25 个不同位置
       （24 段折线 ⇒ 25 个采样，扇形弧首尾不重合——与上面豁免圈那一格的"整圈 24 个位置"是两回事）。
       这一格是臂电池逼出来的——A4 只摘掉上沿那道弧，而本腿原来只查 y 的上下极值存在，于是它**看不见**那件事。 */
    for (const y of [yLo, 0.9, yHi]) {
      const arc = splitVerts(wireVertices(CONE)).filter((v) => Math.abs(radiusOf(v) - 2.1) < EPS && Math.abs(v[1] - y) < EPS)
      expect(new Set(arc.map((v) => v.map(round6).join(','))).size, `y=${y} 那一层画的是弧不是三根柱子`).toBe(25)
    }
  })

  it('cone 豁免圈：画出的那一圈正是角度作废的边界（零体积），也是**装不下真体积的那一圈**', () => {
    expect(shapeHits(CONE, ORIGIN, 0, at(0, 0.9, -(POINT_BLANK_GRACE - 1e-6)))).toBe(true)
    expect(shapeHits(CONE, ORIGIN, 0, at(0, 0.9, -(POINT_BLANK_GRACE + 1e-3)))).toBe(false)
    const realBody: HitTarget = { pos: { x: 0, y: 0.9, z: -0.5 }, facingYaw: 0, radius: 0.55, height: 1.28 }
    expect(shapeHits(CONE, ORIGIN, 0, realBody), '0.55 的目标把豁免抬到 0.80：画的是框，不是含谁').toBe(true)
    expect(POINT_BLANK_GRACE + 0.55).toBe(0.8)
  })

  it('sphere：球心沿 (sin yaw, cos yaw) 平移，画出的那一点判在球面以内', () => {
    expect(shapeHits(SPHERE, ORIGIN, 0, at(0, 0.7, 1.8)), '球心本身').toBe(true)
    /* 恰好落在球面上那一点归哪一侧，主人不是那个 `<=`、是 `shapeHits` 里的减法：
       `3.2 - 1.8` 交出 1.4000000000000001，比 1.4 多一粒尘埃 ⇒ 含等号的判据在球面上**判不中**。
       这一格量的是"差 1e-6 算内、超 1e-3 算外"，并把恰好球面那格的读数如实登记，不假装它是命中。 */
    expect(3.2 - 1.8).not.toBe(1.4)
    expect(shapeHits(SPHERE, ORIGIN, 0, at(0, 0.7, 3.2)), '恰好球面：减法多一粒尘埃 ⇒ 判在外').toBe(false)
    expect(shapeHits(SPHERE, ORIGIN, 0, at(0, 0.7, 3.2 - 1e-6))).toBe(true)
    expect(shapeHits(SPHERE, ORIGIN, 0, at(0, 0.7, 3.2 + 1e-3))).toBe(false)
    expect(shapeHits(SPHERE, ORIGIN, 0, at(0, 0.7, -1.8)), '正后方 1.8：球心在前方，够不着').toBe(false)
    expect(shapeHits(SPHERE, ORIGIN, Math.PI / 2, at(1.8, 0.7, 0)), 'yaw=90° 把球心搬到 +X').toBe(true)
  })

  it('ring：内外两条圆各含一侧等号，外沿是 outer+forward（inner 不偏心）', () => {
    expect(shapeHits(RING, ORIGIN, 0, at(0, 0, 3))).toBe(true)
    expect(shapeHits(RING, ORIGIN, 0, at(0, 0, 3.001))).toBe(false)
    expect(shapeHits(RING, ORIGIN, 0, at(0, 0, 1.1))).toBe(true)
    expect(shapeHits(RING, ORIGIN, 0, at(0, 0, 1.099))).toBe(false)
    expect(shapeHits(RING, ORIGIN, 0, at(0, 0, -3))).toBe(true)
  })

  it('ring 的 y 盲区如实登记：画的是平地一圈，判的是无限高的一根柱子', () => {
    expect(shapeHits(RING, ORIGIN, 0, at(0, 999, 2.05))).toBe(true)
    expect(uniq(splitVerts(wireVertices(RING)).map((v) => v[1]))).toEqual([0])
  })
})

describe('承载体行为：默认全关，关着一口都不叫', () => {
  it('构造即全关：不建几何、不调 feed、组不可见；连叫五次 sync 两个计数纹丝不动', () => {
    const scene = new THREE.Scene()
    let calls = 0
    const wire = new HitboxWire({ scene, key: 'F6', feed: () => { calls++; return [input('a', CONE)] } })
    alive.push(() => wire.dispose())
    expect({ enabled: wire.enabled, visible: wire.groupVisible(), calls, builds: wire.geometryBuilds, live: wire.live })
      .toEqual({ enabled: false, visible: false, calls: 0, builds: 0, live: 0 })
    for (let i = 0; i < 5; i++) wire.sync()
    expect({ calls, builds: wire.geometryBuilds, live: wire.live }).toEqual({ calls: 0, builds: 0, live: 0 })
    expect(hooked.filter((l) => l.type === 'keydown').length, '一块面板＝一个监听者').toBe(1)
  })

  it('F6 开→画；F6 关→当场清空且此后不再叫 feed；再开同一格不重建档', () => {
    const scene = new THREE.Scene()
    let calls = 0
    const wire = new HitboxWire({ scene, key: 'F6', feed: () => { calls++; return [input('a', CONE)] } })
    alive.push(() => wire.dispose())
    expect(press('F6')).toBe(1)
    wire.sync()
    expect({ calls, builds: wire.geometryBuilds, live: wire.live, visible: wire.groupVisible() })
      .toEqual({ calls: 1, builds: 1, live: 1, visible: true })
    press('F6')
    wire.sync()
    expect({ calls, live: wire.live, visible: wire.groupVisible() }, '关掉之后还叫 feed＝把整场招式又白转一遍线段').toEqual({ calls: 1, live: 0, visible: false })
    const cached = wire.geometryBuilds
    press('F6')
    wire.sync()
    expect({ calls, live: wire.live, builds: wire.geometryBuilds }).toEqual({ calls: 2, live: 1, builds: cached })
  })

  it('别的键一律不理：F7 与 F2 既不翻开这一块，也不吃 preventDefault', () => {
    const scene = new THREE.Scene()
    const wire = new HitboxWire({ scene, key: 'F6', feed: () => [] })
    alive.push(() => wire.dispose())
    expect(press('F7')).toBe(0)
    expect(press('F2')).toBe(0)
    expect(wire.enabled).toBe(false)
    expect(press('F6')).toBe(1)
    expect(wire.enabled).toBe(true)
  })

  it('dispose 零残留：组离开场景、两份几何与两颗材质各收到一次 dispose、监听者摘掉', () => {
    const scene = new THREE.Scene()
    const wire = new HitboxWire({ scene, key: 'F6', feed: () => [input('a', CONE), input('b', RING)] })
    press('F6')
    wire.sync()
    const allyMat = wire.objectOf('a')!.material as THREE.LineBasicMaterial
    const hostileMat = wire.objectOf('b')!.material as THREE.LineBasicMaterial
    const seen: string[] = []
    const geos = wire.geometries()
    expect(geos.length).toBe(2)
    for (const geo of geos) geo.addEventListener('dispose', () => { seen.push('geo') })
    allyMat.addEventListener('dispose', () => { seen.push('allyMat') })
    hostileMat.addEventListener('dispose', () => { seen.push('hostileMat') })
    expect(scene.children.length).toBe(1)
    wire.dispose()
    expect(seen.sort()).toEqual(['allyMat', 'geo', 'geo', 'hostileMat'])
    expect(scene.children.length).toBe(0)
    expect(hooked.length, '监听者没摘＝下一块起来时旧的那块还在吃键').toBe(0)
    expect(press('F6'), 'dispose 之后再敲键不许复活').toBe(0)
  })
})

describe('名册 ⇄ 缓存：谁在场、同一式连打十帧、敌我换色', () => {
  const mk = (feed: () => WireInput[]): { scene: THREE.Scene; wire: HitboxWire } => {
    const scene = new THREE.Scene()
    const wire = new HitboxWire({ scene, key: 'F6', feed })
    press('F6')
    return { scene, wire }
  }

  it('同一个 box 两个出手者＝一份几何（对象各一个，几何同一实例）', () => {
    const { wire } = mk(() => [input('a', CONE), { ...input('b', CONE), hostile: true, origin: { x: 2, y: 0, z: 0 }, yaw: 1 }])
    wire.sync()
    expect(wire.geometryBuilds).toBe(1)
    expect(wire.objectOf('a')!.geometry).toBe(wire.objectOf('b')!.geometry)
    expect({ pa: wire.objectOf('a')!.position.x, pb: wire.objectOf('b')!.position.x, rb: wire.objectOf('b')!.rotation.y }).toEqual({ pa: 0, pb: 2, rb: 1 })
    wire.dispose()
  })

  it('同一格连打十帧不重建：帧数只挪对象；换式＝换几何不换对象', () => {
    let box: WireInput['box'] = CONE
    const { wire } = mk(() => [input('p', box)])
    for (let i = 0; i < 10; i++) wire.sync()
    const obj = wire.objectOf('p')!
    expect({ builds: wire.geometryBuilds, live: wire.live }).toEqual({ builds: 1, live: 1 })
    box = SPHERE
    wire.sync()
    expect({ builds: wire.geometryBuilds, live: wire.live, sameObject: wire.objectOf('p') === obj }).toEqual({ builds: 2, live: 1, sameObject: true })
    expect(wire.objectOf('p')!.geometry.getAttribute('position').count).toBe(72 * 2)
    wire.dispose()
  })

  it('不在场就下线：键从名册消失 ⇒ 组里少一个对象（缓存留着）；再回来不重建档', () => {
    let present = true
    const { scene, wire } = mk(() => (present ? [input('e1', RING)] : []))
    wire.sync()
    const group = scene.children[0] as THREE.Group
    expect(group.children.length).toBe(1)
    present = false
    wire.sync()
    expect({ live: wire.live, groupKids: group.children.length, builds: wire.geometryBuilds }).toEqual({ live: 0, groupKids: 0, builds: 1 })
    present = true
    wire.sync()
    expect({ live: wire.live, builds: wire.geometryBuilds }).toEqual({ live: 1, builds: 1 })
    expect(wire.peakLiveCount).toBe(1)
    wire.dispose()
  })

  it('敌我取色只用 VFX_PALETTE 里已登记的两颗（线框不是第三种颜色，KI-296 的欠账名册不伸长）', () => {
    let hostile = false
    const { wire } = mk(() => [{ ...input('x', CONE), hostile }])
    wire.sync()
    const allyColor = (wire.objectOf('x')!.material as THREE.LineBasicMaterial).color.getHex()
    hostile = true
    wire.sync()
    expect({ allyColor, hostileColor: (wire.objectOf('x')!.material as THREE.LineBasicMaterial).color.getHex(), builds: wire.geometryBuilds })
      .toEqual({ allyColor: VFX_PALETTE.silver, hostileColor: VFX_PALETTE.discordViolet, builds: 1 })
    wire.dispose()
  })

  it('matrixWorld 乘出来的顶点 ⇄ 解析式同一个 yaw', () => {
    const origin = { x: 1.5, y: 0.25, z: -2 }
    const yaw = 0.7
    const { wire } = mk(() => [input('p', CONE, origin, yaw)])
    wire.sync()
    const v = new THREE.Vector3(0, 0.9, 2.1).applyMatrix4(wire.objectOf('p')!.matrixWorld)
    const analytic = { x: origin.x + Math.sin(yaw) * 2.1, y: origin.y + 0.9, z: origin.z + Math.cos(yaw) * 2.1 }
    expect(Math.abs(v.x - analytic.x)).toBeLessThan(1e-5)
    expect(Math.abs(v.z - analytic.z)).toBeLessThan(1e-5)
    expect(Math.abs(v.y - analytic.y)).toBeLessThan(1e-5)
    expect(shapeHits(CONE, origin, yaw, at(v.x, v.y, v.z)), '画出的外沿点必须真挨打').toBe(true)
    const side = { x: origin.x + Math.sin(yaw + Math.PI / 2) * 2.1, y: origin.y + 0.9, z: origin.z + Math.cos(yaw + Math.PI / 2) * 2.1 }
    expect(shapeHits(CONE, origin, yaw, at(side.x, side.y, side.z)), '侧 90° 那一点扇形外 ⇒ 线框不该画到它').toBe(false)
    wire.dispose()
  })
})

describe('wiresFrom：在场名册只有一个主人（真实例驱动）', () => {
  function world() {
    const time = new GameTime()
    const rhythm = new RhythmClock()
    rhythm.setBpm(84, 4)
    const rpg = new RpgRuntime()
    const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
    const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
    player.applyRpg(rpg.mods())
    player.setSkills(rpg.skillLoadout())
    const ai = new AISystem()
    const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
    const inp = { frame, enabled: true } as unknown as Input
    player.camYawRef = 0
    const tick = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        time.tick++
        time.step(TICK_DT)
        player.update(TICK_DT, time, inp, time.tick, rhythm)
        rhythm.update(TICK_DT)
      }
    }
    return { weapon, player, ai, frame, tick }
  }

  it('空场：谁都没出手 ⇒ 名册是空的（线框不许凭空画一圈"上一式的残影"）', () => {
    const w = world()
    expect(w.player.activeHitbox).toBeNull()
    expect(wiresFrom(w.player, w.ai.enemies)).toEqual([])
  })

  it('玩家出 L1：表里那一格被逐字交出来（key=player、hostile=false、box===表那一行）', () => {
    const w = world()
    const row = registry.get<MovesetData>(`moveset:${w.weapon.movesetId}`).actions.l1!.hitbox!
    expect(row).toEqual({ shape: 'cone', angleDeg: 100, radius: 2.1, height: 1.6, offsetY: 0.9 })
    w.frame.edges.add('attackLight')
    w.tick(1)
    w.frame.edges.delete('attackLight')
    let started = !!w.player.activeHitbox?.box
    for (let i = 0; !started && i < 40; i++) {
      w.tick(1)
      started = !!w.player.activeHitbox?.box
    }
    expect(started, '41 拍内没进入 active 帧＝这一格读的是别的东西').toBe(true)
    const roster = wiresFrom(w.player, w.ai.enemies)
    expect(roster.map((r) => `${r.key}:${r.hostile}`)).toEqual([`${PLAYER_WIRE_KEY}:false`])
    expect(roster[0].box).toBe(row)
    expect(roster[0].origin).toBe(w.player.pos)
    expect(boxFingerprint(roster[0].box)).toBe(boxFingerprint(CONE))
    const scene = new THREE.Scene()
    const wire = new HitboxWire({ scene, key: 'F6', feed: () => wiresFrom(w.player, w.ai.enemies) })
    press('F6')
    wire.sync()
    expect({ live: wire.live, keys: wire.keys }).toEqual({ live: 1, keys: [PLAYER_WIRE_KEY] })
    expect(splitVerts(wire.objectOf(PLAYER_WIRE_KEY)!.geometry.getAttribute('position').array).length).toBe(102 * 2)
    wire.dispose()
  })

  it('敌我同框：敌人那一格 hostile=true、键就是 id；少了 id 的结构替身不进名册', () => {
    const w = world()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 6 }, 'probe')
    const spec = e.data.attacks![0]
    e.attack = newAttack(spec, spec.frames.activeStart)
    const roster = wiresFrom(w.player, w.ai.enemies)
    expect(roster.map((r) => `${r.key}:${r.hostile}`)).toEqual([`${e.id}:true`])
    expect(roster[0].box).toBe(spec.frames.hitbox)
    /* 「少了 id 就不进名册」测的是**敌人**那一支：把没有 id 的源交给玩家那格，它会拿到 `PLAYER_WIRE_KEY`
       那个固定串——那正是玩家那一支该有的行为（第一趟我就是这么把两格混成一格的）。 */
    const nameless: WireSource = { pos: ORIGIN, yaw: 0, activeHitbox: { box: CONE } }
    const idle: WireSource = { id: 'e2', pos: ORIGIN, yaw: 0, activeHitbox: null }
    expect(wiresFrom(idle, [nameless])).toEqual([])
    expect(wiresFrom(idle, [{ ...nameless, id: 'e3' }]).map((r) => r.key)).toEqual(['e3'])
    expect(wiresFrom(nameless, [nameless]).map((r) => r.key)).toEqual([PLAYER_WIRE_KEY])
    expect(wiresFrom(w.player, w.ai.enemies).length).toBe(1)
  })

  it('过了 activeEnd 或已经打中（hitDone）⇒ activeHitbox 交 null，线框跟着下线', () => {
    const w = world()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 6 }, 'probe')
    const spec = e.data.attacks![0]
    e.attack = newAttack(spec, spec.frames.activeEnd + 1)
    expect({ hit: e.activeHitbox, roster: wiresFrom(w.player, w.ai.enemies).length }).toEqual({ hit: null, roster: 0 })
    e.attack = newAttack(spec, spec.frames.activeStart)
    expect(e.activeHitbox).not.toBeNull()
    e.attack.hitDone = true
    expect(wiresFrom(w.player, w.ai.enemies)).toEqual([])
  })
})

describe('接线：组合根、预留表、常量唯一主人', () => {
  const main = src('src/main.ts')
  const inputTs = src('src/core/Input.ts')
  const hitShapes = src('src/combat/HitShapes.ts')

  it('main.ts 的 DEV 段里：键写在构造点、名册交给 wiresFrom、每逻辑帧叫 sync', () => {
    const devAt = main.indexOf('if (import.meta.env.DEV) {')
    const pushAt = main.indexOf('debugWires.push')
    expect(devAt).toBeGreaterThan(-1)
    expect(pushAt).toBeGreaterThan(devAt)
    expect(main.slice(devAt, pushAt), 'DEV 段在 push 之前自己闭合了＝线框被挪出了 import.meta.env.DEV')
      .not.toMatch(/^\}$/m)
    const block = main.slice(pushAt, main.indexOf('\n}\n', pushAt))
    expect(block).toContain("key: 'F6'")
    expect(block).toContain('wiresFrom(player, ai.enemies)')
    expect(main).toContain('for (const w of debugWires) w.sync()')
    expect(main.indexOf('for (const p of debugPanels) p.refresh()')).toBeLessThan(main.indexOf('for (const w of debugWires) w.sync()'))
    expect(main).toMatch(/__caesura = \{[^}]*debugWires/)
  })

  it('F6 进了 Input 的 preventDefault 预留表（不然浏览器先把它抢走）', () => {
    const list = inputTs.match(/\[([^\]]*)\]\.includes\(e\.code\)/)?.[1] ?? ''
    // KI-335 同一形状长一次：F5 是性能面板的呼出键，不进这张表就会被浏览器抢走（刷新）。
    expect([...new Set([...list.matchAll(/'(F\d)'/g)].map((m) => m[1]))].sort()).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6'])
  })

  it('贴身豁免那 0.25 只有一个主人：判据吃常量，代码里不许再出现裸的 radius + 0.25', () => {
    expect(POINT_BLANK_GRACE).toBe(0.25)
    const code = stripComments(hitShapes)
    expect(code).toContain('target.radius + POINT_BLANK_GRACE')
    expect(code, '两处各写一份 0.25 就是两个主人（画出来的框与挨打的框会分家）').not.toMatch(/radius \+ 0\.25/)
    expect(code.match(/POINT_BLANK_GRACE/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('依赖闸门那一侧：线框住在表现层，只认领三件结构、不 import 玩法运行时', () => {
    const code = stripComments(src('src/world/HitboxWire.ts'))
    for (const banned of ['@/ai/AISystem', '@/combat/CombatManager', '@/player/ThirdPersonController', '@/world/Streaming', '@/world/Interactables']) {
      expect(code, `表现层不许认识「${banned}」`).not.toContain(banned)
    }
    expect(code).toContain('@/combat/HitShapes')
    expect(code).toContain('@/vfx/materials')
    expect(src('tests/unit/arch-boundaries.test.ts')).toContain("'world/HitboxWire.ts'")
  })
})
