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
import { BossArenaVisuals } from '@/world/BossArenaVisuals'

registerGameData()

const scene = new THREE.Scene()
const playerMesh = new THREE.Group()
scene.add(playerMesh)
const sword = registry.get<WeaponData>('wp_tuning_sword')
const player = new PlayerController(playerBase, sword, registry.get<MovesetData>(`moveset:${sword.movesetId}`))
const ai = new AISystem()
const vis = new ActorVisuals(scene, playerMesh, player)
afterAll(() => {
  // ActorVisuals 现在常驻的只有手里那几把武器模（构造时一次建好，只翻 visible），
  // 所以这里清空名册再同步一次，场景就该回到"玩家 + 四把武器"的水位
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

describe('BossArenaVisuals：撞钟机关必须看得见（§15.1）', () => {
  const scene2 = new THREE.Scene()
  const boss = new AISystem()
  const arena = new BossArenaVisuals(scene2)
  afterAll(() => arena.dispose())

  const bells = () => (scene2.getObjectByName('boss-arena') as THREE.Group).children as THREE.Mesh[]

  it('带机关的 Boss 出现 ⇒ 每口立钟一个模，位置来自表而不是代码', () => {
    const k = boss.spawn('en_ostlara', { x: 300, y: -40, z: 104 }, 'b')
    arena.sync([k])
    const g = k.data.boss!.bells!
    expect(bells()).toHaveLength(g.positions.length)
    expect(bells().map((m) => m.position.x).sort()).toEqual(g.positions.map((p) => p.x).sort())
    expect(bells()[0].position.y, '钟心站在本层地板上' + g.positions[0].y.toFixed(0)).toBeCloseTo(g.positions[0].y + 1.3, 5)
  })

  it('钟被撞响 ⇒ 同一对象换材质 + 塌成暗桩（残响区还在，钟已经空了）', () => {
    const k = boss.enemies.find((e) => e.data.boss?.bells)!
    const before = bells()[0]
    const matBefore = before.material
    k.bellsRung[0] = true
    arena.sync(boss.enemies)
    const after = bells()[0]
    expect(after, '不重建模型，只换状态').toBe(before)
    expect(after.scale.y, '塌下去').toBeLessThan(1)
    expect(after.material, '换成暗材质（同一对共享材质实例，不多建）').not.toBe(matBefore)
  })

  it('断音柱（§15.2 Main Boss 场地）也来自数据：柱数 = covers.positions 长度', () => {
    const scene3 = new THREE.Scene()
    const boss3 = new AISystem()
    const arena3 = new BossArenaVisuals(scene3)
    const h = boss3.spawn('en_hersil', { x: 0, y: 152, z: -250 }, 'h')
    arena3.sync([h])
    const group = scene3.getObjectByName('boss-arena') as THREE.Group
    // 断音柱立在 152 层，奥斯塔拉的钟在 -40 层 ⇒ 用高度就能把两者分开
    const pillars = group.children.filter((m) => m.position.y > 150)
    expect(pillars.length, '四根断音柱立在 152 层').toBe(h.data.boss!.covers!.positions.length)
    arena3.dispose()
  })

  it('Boss 被流送回收 ⇒ 机关一起摘掉，往返不涨网格数', () => {
    const n0 = bells().length
    expect(n0).toBeGreaterThan(0)
    for (const e of [...boss.enemies]) boss.despawn(e.id)
    arena.sync(boss.enemies)
    expect(bells()).toHaveLength(0)
    const k = boss.spawn('en_ostlara', { x: 300, y: -40, z: 104 }, 'b2')
    arena.sync([k])
    expect(bells()).toHaveLength(n0)
    expect(arena.peakLive, '峰值 = 表里的钟数，不随往返增长').toBe(n0)
  })
})

describe('KI-007 手里的家伙跟着装备走（外观不再是"永远那一根音调叉"）', () => {
  const shown = (): string[] => vis.sword.children.filter((c) => c.visible).map((c) => c.name)
  const give = (id: string): void => {
    const w = registry.get<WeaponData>(id)
    player.equip(w, registry.get<MovesetData>(`moveset:${w.movesetId}`))
    vis.sync(ai.enemies, 1)
  }
  const bladeOf = (kind: string): THREE.BoxGeometry =>
    ((vis.sword.getObjectByName(`weapon:${kind}`) as THREE.Group).children[0] as THREE.Mesh).geometry as THREE.BoxGeometry

  it('每一种 archetype 一组，任何时刻只亮一组，且换装后亮的是新那把', () => {
    expect(vis.sword.children.length, '表里四种形状（含回退用的 unknown）').toBe(4)
    give('wp_drawpin_spear')
    expect(shown(), '每一次 sync 之后只该亮一组').toEqual(['weapon:spear'])
    give('wp_tuning_sword')
    expect(shown()).toEqual(['weapon:straight_sword'])
    give('wp_fortissimo_greatsword')
    expect(shown(), '换到大剑：只翻这一组，上一组必须灭掉').toEqual(['weapon:greatsword'])
    give('wp_drawpin_spear')
    expect(shown()).toEqual(['weapon:spear'])
  })

  it('大剑那组的刃确实比直剑长——外观不是换了个名字而已', () => {
    give('wp_tuning_sword')
    const long1 = bladeOf('straight_sword').parameters.height
    give('wp_fortissimo_greatsword')
    expect(bladeOf('greatsword').parameters.height, '同一把模换个名字交差不算修好外观').toBeGreaterThan(long1)
    give('wp_tuning_sword')
  })

  it('表里没有的形状回退成 "看得见的一把"，而不是空手', () => {
    const w = registry.get<WeaponData>('wp_tuning_sword')
    // id 必须换掉：`equip()` 见到同一把就短路返回（那是换装的常态优化，不是 bug）
    player.equip({ ...w, id: 'wp_probe_bow', archetype: 'bow' }, registry.get<MovesetData>(`moveset:${w.movesetId}`))
    vis.sync(ai.enemies, 2)
    expect(shown(), '手里空了比看着像剑更糟：玩家会以为装备没生效').toEqual(['weapon:unknown'])
    give('wp_tuning_sword')
    expect(shown(), '回退不该留下尾巴').toEqual(['weapon:straight_sword'])
  })
})
