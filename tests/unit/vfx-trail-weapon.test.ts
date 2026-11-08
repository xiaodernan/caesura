import { describe, expect, it, afterEach } from 'vitest'
import * as THREE from 'three'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { initTrailSystem, getTrailSystem } from '@/vfx/Trails'

/**
 * §3.1 第二条（docs/roadmap-next.md，2026-11-09）：「Phase 7 的一个最小可落点——
 * 在 `vfx/Trails.ts` 中，给 `trail.weapon` 加一条定向测试（武器挥击时拖尾粒子的长度 ≤ 某常量，超过即 push）」。
 *
 * 拖尾的段数上限有且只有一个主人：`TrailInstance.emit()` 里那道封顶——配置里的 `segments`
 * 决定几何体画几段，索引缓冲只覆盖那几段；超出的点**画不出来**（顶点画了、连线没画），
 * 所以每发射一个点就把超出的丢掉。KI-330 已把 `update()` 里第二道同样的封顶当死代码删掉。
 *
 * 本文件的腿：
 *   ① 每发射一个点，点数 ≤ `segments`（`trail_blade` = 14）；
 *   ② 顶点缓冲区建在构造时按 `segments * 2` 开好，**容量不随点数变化**（没有扩缓冲区）；
 *   ③ `drawRange` 与点数同步（`points * 2` 个顶点），没有画出范围外的东西；
 *   ④ `trail.projectile` 同一族契约（`trail_arrow` = 10）。
 *
 * 世代纪律（KI-149）：出生时间走真 `performance.now()`——所以这里**不睡死** 0.22 秒的
 * 生平滑；而是把每一帧推到 0.2 米的大步，保证发射率压过老化裁剪：老化这一轮根本轮不到
 * 把点从头上丢。**被压住的只有时间维度，被量的永远是段数上限那一维。**
 */

registerGameData()

interface TrailPointsProbe {
  points: { position: THREE.Vector3 }[]
  geometry: THREE.BufferGeometry
}

const scenes: THREE.Scene[] = []
afterEach(() => {
  for (const s of scenes.splice(0)) {
    getTrailSystem()?.dispose()
    s.clear()
  }
})
const newScene = (): THREE.Scene => {
  const s = new THREE.Scene()
  scenes.push(s)
  return s
}

const probe = (sys: ReturnType<typeof initTrailSystem>, id: string): TrailPointsProbe => {
  const trail = sys.getTrail(id)
  if (!trail) throw new Error(`拿不到拖尾 ${id}：vfx.json > trails 里有这条吗？`)
  return trail as unknown as TrailPointsProbe
}

const rowOf = (id: string): { segments: number } => {
  const rows = registry.get<{ id: string; segments: number }[]>('vfx:trails')
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`vfx:trails 里没有 ${id}`)
  return row
}

describe('trail.weapon：拖尾长度的段数上限', () => {
  it('trail_blade（14 段）：每帧点数 ≤ 14，缓冲区容量 28 顶点，drawRange 与点数同步', () => {
    const segCap = rowOf('trail_blade').segments
    const scene = newScene()
    const sys = initTrailSystem(scene)
    const w = probe(sys, 'trail_blade')
    expect(w.geometry.getAttribute('position').count, '缓冲开建时按 segments*2 开好的').toBe(segCap * 2)

    const step = new THREE.Vector3(0.2, 0, 0) // 0.2 米/帧 ≫ minEmitDist 0.04 ⇒ 每帧必发
    const forward = new THREE.Vector3(1, 0, 0)
    const up = new THREE.Vector3(0, 1, 0)
    const weapon = new THREE.Vector3(0, 1, 0)

    for (let i = 0; i < 40; i++) {
      weapon.add(step)
      sys.updateWeapon('trail_blade', weapon, forward, up, 1 / 60)
      expect(w.points.length, `第 ${i + 1} 帧的点数不得超过 ${segCap}`).toBeLessThanOrEqual(segCap)
      // drawRange 只在 ≥2 个点之后才被 update() 写过；第一点落地时它仍是默认的 Infinity（一条边本来就没有）
      expect(w.geometry.drawRange.count, 'drawRange = 点数 × 2 顶点').toBe(w.points.length >= 2 ? w.points.length * 2 : Infinity)
    }
    expect(w.points.length, '40 次发射之后装着的正是段数上限那一档').toBe(segCap)
    expect(w.geometry.getAttribute('position').count, '容量在原地：没有扩缓冲区的第二条路').toBe(segCap * 2)
  })

  it('trail_arrow（10 段）：projectile 那一路同一个契约', () => {
    const segCap = rowOf('trail_arrow').segments
    const scene = newScene()
    const sys = initTrailSystem(scene)
    const w = probe(sys, 'trail_arrow')
    expect(w.geometry.getAttribute('position').count).toBe(segCap * 2)

    const pos = new THREE.Vector3(0, 0, 0)
    const vel = new THREE.Vector3(40, 0, 0) // 高速飞行：每帧位移 0.667 米 ≫ minEmitDist 0.08

    for (let i = 0; i < 30; i++) {
      pos.x += 0.667
      sys.updateProjectile('trail_arrow', pos, vel, 1 / 60)
      expect(w.points.length, `第 ${i + 1} 帧的点数不得超过 ${segCap}`).toBeLessThanOrEqual(segCap)
      expect(w.geometry.drawRange.count).toBe(w.points.length >= 2 ? w.points.length * 2 : Infinity)
    }
    expect(w.points.length).toBe(segCap)
  })
})
