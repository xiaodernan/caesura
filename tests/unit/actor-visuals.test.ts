/**
 * 敌人表现层（ActorVisuals）在 node 里能断言的那一半：模的**存在性 / 可见性 / 回收**。
 * 视口截图仍受隐藏标签页限制（KI-010），所以「这块板好不好看」留给 Phase 7；
 * 这里钉住的是「该挂的挂没挂、该掉的掉没掉、往返漏不漏」——这些不需要眼睛。
 */
import { afterAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { ActorVisuals } from '@/world/ActorVisuals'

registerGameData()

const scene = new THREE.Scene()
const playerMesh = new THREE.Group()
scene.add(playerMesh)
const sword = registry.get<WeaponData>('wp_tuning_sword')
const player = new PlayerController(playerBase, sword, registry.get<MovesetData>(`moveset:${sword.movesetId}`))
const ai = new AISystem()
const vis = new ActorVisuals(scene, playerMesh, player)
afterAll(() => {
  // ActorVisuals 没有 dispose()（它自己不留常驻模）：清空名册再同步一次，场景就该回到只有玩家的模
  for (const e of [...ai.enemies]) ai.despawn(e.id)
  vis.sync(ai.enemies, 999)
})

const groupOf = (id: string): THREE.Group => scene.getObjectByName(`actor:${id}`) as THREE.Group
/** children = [身体, 振源核, 钟甲板?]，顺序就是 ActorVisuals 里 add 的顺序 */
const plateOf = (id: string): THREE.Mesh | undefined => groupOf(id)?.children[2] as THREE.Mesh | undefined
const meshCount = (): number => {
  let n = 0
  scene.traverse((o) => { if (o instanceof THREE.Mesh) n++ })
  return n
}

describe('ActorVisuals：钟甲板挂得对、掉得对、回收不漏', () => {
  it('只有写了 ai.armorFront 的敌人多挂一块板', () => {
    const k = ai.spawn('en_hanged_knight', { x: 0, y: 0, z: -20 }, 'k')
    const s = ai.spawn('en_murkshell', { x: 4, y: 0, z: -20 }, 's')
    vis.sync(ai.enemies, 1)
    expect(plateOf(k.id), '悬钟骑士有钟甲板').toBeTruthy()
    expect(plateOf(s.id), '嘈壳没有').toBeUndefined()
  })

  it('碎甲 ⇒ 同一块板隐藏（不重建、不换材质，只是不再挡刀）', () => {
    const k = ai.enemies.find((e) => e.data.id === 'en_hanged_knight')!
    const before = plateOf(k.id)
    expect(before?.visible).toBe(true)
    k.armorBroken = true
    vis.sync(ai.enemies, 2)
    expect(plateOf(k.id), '还是那个对象').toBe(before)
    expect(plateOf(k.id)!.visible, '但已经掉了').toBe(false)
  })

  it('出格回收 / 回格重出：网格数回到同一水位（流送往返不泄漏）', () => {
    for (const e of [...ai.enemies]) ai.despawn(e.id)
    vis.sync(ai.enemies, 3)
    const empty = meshCount()
    expect(scene.children.filter((c) => c.name.startsWith('actor:'))).toHaveLength(0)
    const k = ai.spawn('en_hanged_knight', { x: 0, y: 0, z: -22 }, 'k2')
    const s = ai.spawn('en_murkshell', { x: 3, y: 0, z: -22 }, 's2')
    vis.sync(ai.enemies, 4)
    expect(meshCount() - empty, '一具敌人 = 身体+振源核；带钟甲的多一块板').toBe(5)
    ai.despawn(k.id)
    ai.despawn(s.id)
    vis.sync(ai.enemies, 5)
    expect(meshCount(), '反复横跳之后水位不变 ⇒ 池没漏').toBe(empty)
  })
})
