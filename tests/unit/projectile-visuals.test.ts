/**
 * 弹道表现层（Phase 4-A）：headless 断言「名单 → 可见模」的同步与复用。
 * 不建 WebGL 上下文：Mesh 的 position/quaternion 操作在 node 里同样可断言。
 * 只喂 ProjectileVisuals 需要的字段（它 import 的是类型，不是运行时）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ProjectileVisuals } from '@/world/ProjectileVisuals'
import type { Projectile } from '@/combat/Projectiles'

function proj(id: number, kind: string, pos: [number, number, number], vel: [number, number, number]): Projectile {
  return {
    id, kind, hostile: false, ownerId: 'player',
    pos: { x: pos[0], y: pos[1], z: pos[2] },
    vel: { x: vel[0], y: vel[1], z: vel[2] }
  } as unknown as Projectile
}

function placed(mesh: THREE.Mesh): { x: number; y: number; z: number } {
  return { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
}

describe('ProjectileVisuals（弹体名单 -> 可见模）', () => {
  const scene = new THREE.Scene()
  const vis = new ProjectileVisuals(scene)
  afterAll(() => vis.dispose())

  const group = () => scene.getObjectByName('projectiles') as THREE.Group

  it('每个活弹体一个模，位置=弹体位置，朝向=速度方向（长轴 +Z 对齐）', () => {
    const a = proj(1, 'spear', [2, 1.1, -3], [0, 0, -26])
    const b = proj(2, 'note', [0, 1.3, 4], [6, 1, 0])
    vis.sync([a, b], 10)
    expect(vis.live).toBe(2)
    expect(group().children.length).toBe(2)
    const [m1, m2] = group().children as THREE.Mesh[]
    expect(placed(m1)).toMatchObject({ x: 2, y: 1.1, z: -3 })
    // 朝 -Z 飞：+Z 轴被旋到 -Z ⇒ 位置分量取反
    const tip = new THREE.Vector3(0, 0, 1).applyQuaternion(m1.quaternion)
    expect(tip.z).toBeCloseTo(-1, 5)
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(m2.quaternion)
    expect(nose.x).toBeGreaterThan(0.9)
  })

  it('弹体消失后模被收回池子复用：场景对象数不随波次增长', () => {
    const before = group().children.length
    vis.sync([proj(1, 'spear', [0, 1, 0], [0, 0, 1])], 11) // 只剩一枚（另一枚已结算）
    expect(vis.live).toBe(1)
    expect(group().children.length).toBe(before) // 隐藏复用，不是反复 new
    vis.sync([], 12)
    expect(vis.live).toBe(0)
    expect(group().children.every((c) => !(c as THREE.Mesh).visible)).toBe(true)
    vis.sync([proj(9, 'spear', [5, 5, 5], [1, 0, 0])], 13)
    expect(group().children.length).toBe(before) // 池子里拿到的就是刚收回来的那枚
    expect(vis.live).toBe(1)
    expect(vis.peakLive).toBe(2) // 峰值记录这一波的最高同时数
  })

  it('非 spear 弹头会随 tick 脉动/自旋，且不会覆盖掉朝向', () => {
    vis.sync([], 0)
    const n = proj(20, 'note', [0, 1, 0], [0, 0, 12])
    vis.sync([n], 30)
    const mesh = (group().children as THREE.Mesh[]).find((m) => m.visible)!
    const s30 = mesh.scale.x
    vis.sync([n], 31)
    expect(mesh.scale.x).not.toBe(s30)
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion)
    expect(nose.z).toBeCloseTo(1, 4) // rotateZ 只绕自身轴转，朝向仍在
  })

  it('未知 kind 走默认弹头而不抛异常', () => {
    expect(() => vis.sync([proj(30, 'mystery', [0, 1, 0], [1, 0, 0])], 40)).not.toThrow()
    expect(vis.live).toBe(1)
  })

  it('峰值只增不减（供 HUD/调试看压力），dispose 拆掉整组', () => {
    const peak = vis.peakLive
    expect(peak).toBeGreaterThanOrEqual(1)
    vis.sync([], 41)
    vis.dispose()
    expect(scene.children.length).toBe(0)
    expect(vis.live).toBe(0)
  })
})

describe('ProjectileVisuals.syncTelegraphs（§14.4 赤线预告）', () => {
  const scene = new THREE.Scene()
  const vis = new ProjectileVisuals(scene)
  afterAll(() => vis.dispose())
  const group = () => scene.getObjectByName('projectiles') as THREE.Group

  const line = (owner: string, to: [number, number, number], ticksLeft: number, total = 48) => ({
    ownerId: owner, kind: 'shard', from: { x: 0, y: 1.25, z: 0 },
    to: { x: to[0], y: to[1], z: to[2] }, ticksLeft, totalTicks: total
  })
  const visible = () => (group().children as THREE.Mesh[]).filter((m) => m.visible)

  it('每根线一枚细长盒：中点落位、长度=线长、越接近出手越亮', () => {
    vis.syncTelegraphs([line('a', [0, 1.25, -10], 40), line('b', [6, 1.25, 0], 8)])
    expect(vis.liveTelegraphs).toBe(2)
    const a = visible().find((m) => Math.abs(m.position.z + 5) < 0.01)!
    expect(a.scale.z).toBeCloseTo(10, 4)
    expect(a.scale.x).toBeLessThan(0.1) // 细，不是一堵墙
    const matA = a.material as THREE.MeshBasicMaterial
    vis.syncTelegraphs([line('a', [0, 1.25, -10], 2), line('b', [6, 1.25, 0], 8)])
    expect(matA.opacity).toBeGreaterThan(0.5) // 只剩 2 拍 ⇒ 亮起来
    vis.syncTelegraphs([line('a', [0, 1.25, -10], 46), line('b', [6, 1.25, 0], 8)])
    expect(matA.opacity).toBeLessThan(0.3) // 刚起手 ⇒ 只是淡淡一条
  })

  it('射手停手后线收回池子：连打几波不会让场景对象数上涨', () => {
    vis.syncTelegraphs([])
    const before = group().children.length
    for (let wave = 0; wave < 4; wave++) {
      vis.syncTelegraphs([line(`w${wave}`, [0, 1.2, -8], 20)])
      vis.syncTelegraphs([])
    }
    expect(group().children.length).toBe(before)
    expect(vis.liveTelegraphs).toBe(0)
    expect(vis.peakTelegraphs).toBe(2) // 峰值=历史上同时存在的最多根数（第一波两根）
  })

  it('同一射手只占一根线：按 ownerId 复用而不是叠加', () => {
    vis.syncTelegraphs([line('solo', [0, 1.2, -6], 30)])
    const n = visible().length
    vis.syncTelegraphs([line('solo', [0, 1.2, -7], 12)])
    expect(visible().length).toBe(n)
    expect(vis.liveTelegraphs).toBe(1)
  })
})
