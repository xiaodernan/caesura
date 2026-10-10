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
import { executionPose } from '@/world/ExecutionPose'
import { newAttack } from '@/ai/Enemy'
import type { Enemy } from '@/ai/Enemy'

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
const plateOf = (id: string): THREE.Mesh | undefined => {
  // KI-013 血条加了 bg+fill（PlaneGeometry），不能再用 children[2] 索引——按几何类型找 BoxGeometry
  return groupOf(id)?.children.find(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry instanceof THREE.BoxGeometry
  )
}
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
    expect(meshCount() - empty, '一具敌人 = 身体+振源核+血条(bg+fill)；带钟甲的多一块板（血条 bg+fill 每具都有）').toBe(9)
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
    expect(vis.sword.children.length, '表里形状数 = WEAPON_FORMS 的键数（含回退 unknown）').toBe(7)
    give('wp_drawpin_spear')
    expect(shown(), '每一次 sync 之后只该亮一组').toEqual(['weapon:spear'])
    give('wp_tuning_sword')
    expect(shown()).toEqual(['weapon:straight_sword'])
    give('wp_fortissimo_greatsword')
    expect(shown(), '换到大剑：只翻这一组，上一组必须灭掉').toEqual(['weapon:greatsword'])
    give('wp_overtone_bow')
    expect(shown(), 'KI-037：弓入表 ⇒ 弓臂那组亮（不再是回退 unknown）').toEqual(['weapon:bow'])
    give('wp_tuningfork_staff')
    expect(shown(), 'KI-037：杖入表 ⇒ 长杆那组亮').toEqual(['weapon:staff'])
    give('wp_needlesilence')
    expect(shown(), '无鸣：细长黑刃（KI-023）').toEqual(['weapon:needle'])
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
    // 用 unique（无名音叉巨剑），它在 WEAPON_FORMS 里没有对应组，应回退到 unknown
    player.equip({ ...w, id: 'wp_probe_unique', archetype: 'unique' }, registry.get<MovesetData>(`moveset:${w.movesetId}`))
    vis.sync(ai.enemies, 2)
    expect(shown(), '手里空了比看着像剑更糟：玩家会以为装备没生效').toEqual(['weapon:unknown'])
    give('wp_tuning_sword')
    expect(shown(), '回退不该留下尾巴').toEqual(['weapon:straight_sword'])
  })
})

describe('ActorVisuals：受击/拍隙/收束/武器动画的可见分支', () => {
  it('前摇脉冲：攻击处于 startup 内 ⇒ emissiveIntensity 随 prog 上升', () => {
    const e = ai.spawn('en_murkshell', { x: 0, y: 0, z: -10 }, 'a')
    vis.sync(ai.enemies, 1)
    const atk = e.data.attacks[0]
    const startup = atk.frames.startup
    e.attack = newAttack(atk, Math.max(1, Math.floor(startup / 2))) // 0 < tick < startup
    vis.sync(ai.enemies, 2)
    const mat = (vis as any).vis.get(e.id)!.body.material as THREE.MeshStandardMaterial
    expect(mat.emissiveIntensity).toBeGreaterThan(0.5) // base 0.5 + pulse
  })

  it('核心闪光：coreFlash > 0 ⇒ emissiveIntensity = 3.2（压过脉冲）', () => {
    const e = ai.spawn('en_murkshell', { x: 5, y: 0, z: -10 }, 'b')
    vis.sync(ai.enemies, 1)
    e.coreFlash = 5
    vis.sync(ai.enemies, 2)
    const mat = (vis as any).vis.get(e.id)!.body.material as THREE.MeshStandardMaterial
    expect(mat.emissiveIntensity).toBe(3.2)
  })

  it('时停冻结：frozenTicks > 0 且无 coreFlash ⇒ emissiveIntensity = 0.08', () => {
    const e = ai.spawn('en_murkshell', { x: 10, y: 0, z: -10 }, 'c')
    vis.sync(ai.enemies, 1)
    e.frozenTicks = 10
    vis.sync(ai.enemies, 2)
    const mat = (vis as any).vis.get(e.id)!.body.material as THREE.MeshStandardMaterial
    expect(mat.emissiveIntensity).toBe(0.08)
  })

  it('拍隙半透明：intangible = true ⇒ opacity=0.18, transparent=true', () => {
    const e = ai.spawn('en_murkshell', { x: 15, y: 0, z: -10 }, 'd')
    vis.sync(ai.enemies, 1)
    e.intangible = true
    vis.sync(ai.enemies, 2)
    const mat = (vis as any).vis.get(e.id)!.body.material as THREE.MeshStandardMaterial
    expect(mat.opacity).toBe(0.18)
    expect(mat.transparent).toBe(true)
  })

  it('恢复倒地：state === recover ⇒ position.y 下沉、rotation.x 前倾', () => {
    const e = ai.spawn('en_murkshell', { x: 20, y: 0, z: -10 }, 'e')
    vis.sync(ai.enemies, 1)
    e.state = 'recover'
    e.stateTick = 1
    vis.sync(ai.enemies, 2)
    const g = scene.getObjectByName(`actor:${e.id}`) as THREE.Group
    expect(g.position.y).toBeLessThan(0)
    expect(g.rotation.x).toBeGreaterThan(0)
  })

  it('死亡消融：!alive ⇒ 逐帧下沉 + 缩放，k>=1 时从场景移除并删除名册', () => {
    const e = ai.spawn('en_murkshell', { x: 25, y: 0, z: -10 }, 'f')
    vis.sync(ai.enemies, 1)
    e.stats.dead = true // trigger alive = false
    e.stateTick = 90 // k = 1
    vis.sync(ai.enemies, 2)
    expect(scene.getObjectByName(`actor:${e.id}`)).toBeUndefined()
    expect((vis as any).vis.has(e.id)).toBe(false)
  })

  it('animateSword：parryActive → rotation.x=0.6, rotation.z=1.2', () => {
    player.parryTicksLeft = 10
    vis.sync(ai.enemies, 1)
    expect(vis.sword.rotation.x).toBeCloseTo(0.6, 5)
    expect(vis.sword.rotation.z).toBeCloseTo(1.2, 5)
  })

  it('animateSword：guarding → rotation.x=-1.4, rotation.z=0.4', () => {
    player.parryTicksLeft = 0
    player.guardTicks = 999
    vis.sync(ai.enemies, 1)
    expect(vis.sword.rotation.x).toBeCloseTo(-1.4, 5)
    expect(vis.sword.rotation.z).toBeCloseTo(0.4, 5)
  })

  it('animateSword：roll → rotation.x=-2.2', () => {
    player.guardTicks = 0
    player.roll = { tick: 1, dir: { x: 0, y: 0, z: 1 }, dist: 4, total: 12, iframeStart: 0, iframeEnd: 8 }
    vis.sync(ai.enemies, 1)
    expect(vis.sword.rotation.x).toBeCloseTo(-2.2, 5)
  })

  it('animateSword：idle → rotation.x 在 -0.5 周围微动、rotation.z=0', () => {
    player.roll = null
    vis.sync(ai.enemies, 100)
    expect(Math.abs(vis.sword.rotation.x + 0.5)).toBeLessThan(0.1)
    expect(vis.sword.rotation.z).toBe(0)
  })

  it('处决蒙太奇：受刑者按进度坍塌、刀走姿态函数（同一个进度只有一份，两处读同一份）', () => {
    const e = ai.spawn('en_murkshell', { x: 40, y: 0, z: -10 }, 'h')
    vis.sync(ai.enemies, 1)
    const g = groupOf(e.id)
    expect(g.rotation.x, '没在处决里 ⇒ 立着').toBe(0)
    player.executing = { tick: 45, total: 60, pos: { x: 40, y: 0, z: -10 } } // progress 0.75
    vis.sync(ai.enemies, 2)
    const pose = executionPose(0.75)
    expect(g.rotation.x, '受刑者前倾角来自姿态函数').toBeCloseTo(pose.tilt, 5)
    expect(g.position.y, '下沉量同样来自它（不写第二份时长）')
      .toBeCloseTo(0 - pose.sink * (e.data.body?.scale ?? 1), 5)
    expect(vis.sword.rotation.x, '攻击者只有一记高举-落刀').toBeCloseTo(-0.5 + pose.chop, 5)
    expect(vis.sword.rotation.z, '刀不复位').toBe(0)
    player.executing = null
    vis.sync(ai.enemies, 3)
    expect(g.rotation.x, '处决结束回到立姿').toBe(0)
    ai.despawn(e.id)
    vis.sync(ai.enemies, 4)
  })

  it('animateSword：出手三段（起手后摆 → 判定窗横扫 → 收势回位）各走各的插值', () => {
    const f = registry.get<MovesetData>(`moveset:${sword.movesetId}`).actions['l1']
    const act = (tick: number): void => {
      player.action = {
        key: 'l1', f, tick, hitDone: false, shots: 0, hitIds: new Set(),
        skill: null, dir: null, stopTicks: 0, stopDebt: 0,
      }
    }
    // 起手：往后摆，幅度按 tick/startup 线性
    act(Math.floor(f.startup / 2))
    vis.sync(ai.enemies, 1)
    const windup = -1.7 * (Math.floor(f.startup / 2) / Math.max(1, f.startup))
    expect(vis.sword.rotation.x, '起手后摆').toBeCloseTo(-0.5 + windup, 5)
    expect(vis.sword.rotation.z, '后摆带一点侧转').toBeCloseTo(windup * 0.35, 5)
    // 判定窗：从 -1.7 扫到 +1.4
    act(Math.floor((f.startup + f.activeEnd) / 2))
    vis.sync(ai.enemies, 2)
    const k1 = (Math.floor((f.startup + f.activeEnd) / 2) - f.startup) / Math.max(1, f.activeEnd - f.startup)
    expect(vis.sword.rotation.x, '窗中段已经扫过中线附近').toBeCloseTo(-0.5 + (-1.7 + k1 * 3.1), 5)
    // 收势：从 +1.4 回落到 -0.5
    act(Math.floor((f.activeEnd + f.recovery) / 2))
    vis.sync(ai.enemies, 3)
    const k2 = Math.min(1, (Math.floor((f.activeEnd + f.recovery) / 2) - f.activeEnd) / Math.max(1, f.recovery - f.activeEnd))
    expect(vis.sword.rotation.x, '收势回位').toBeCloseTo(-0.5 + 1.4 * (1 - k2), 5)
    expect(vis.sword.rotation.z, '侧转跟着同一份 swing 走').toBeCloseTo((1.4 * (1 - k2)) * 0.35, 5)
    player.action = null
    vis.sync(ai.enemies, 4)
    expect(Math.abs(vis.sword.rotation.x + 0.5), '收工回到 idle').toBeLessThan(0.1)
  })
})

describe('批17 分支死角：body 数据缺列回落 / 判定窗核放大 / 碎甲动画窗 / 蓄力辉光', () => {
  /** 手造最小敌人桩：data 里 body 整个缺或只留空壳，量的是四处 ?? 回落腿 */
  const bareEnemy = (id: string, body?: object): Enemy =>
    ({
      id, pos: { x: -60, y: 0, z: -60 }, yaw: 0,
      data: { ai: {}, ...(body ? { body } : {}) },
      attack: null, coreFlash: 0, frozenTicks: 0, intangible: false,
      activeHitbox: null, armorBroken: false, plateBreakTick: 0,
      state: 'idle', stateTick: 0, alive: true,
    }) as unknown as Enemy
  const visMap = (): Map<string, { core: THREE.Mesh }> => (vis as unknown as { vis: Map<string, { core: THREE.Mesh }> }).vis

  it('body 整缺 / body 空壳：scale·color·emissive·coreColor 四处回落全走灰盒兜底', () => {
    vis.sync([bareEnemy('en_bare_none'), bareEnemy('en_bare_empty', {})] as unknown as Enemy[], 1001)
    const gNone = scene.getObjectByName('actor:en_bare_none') as THREE.Group
    const gEmpty = scene.getObjectByName('actor:en_bare_empty') as THREE.Group
    expect(gNone, 'body 缺列也照出一具模（灰盒兜底）').toBeTruthy()
    expect(gEmpty).toBeTruthy()
    const bodyNone = (gNone.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    const bodyEmpty = (gEmpty.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(bodyNone.color.getHex(), 'color 回落 0x555555').toBe(0x555555)
    expect(bodyNone.emissive.getHex(), 'emissive 回落 0x222222').toBe(0x222222)
    expect(bodyEmpty.color.getHex(), '空壳同走回落：?. 与 ?? 两腿都量到').toBe(0x555555)
    const coreNone = (gNone.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(coreNone.color.getHex(), 'coreColor 回落 0xff4422').toBe(0xff4422)
    vis.sync(ai.enemies, 1002) // 桩不在名册 ⇒ 顺路回收
  })

  it('activeHitbox 展开 ⇒ 振源核放大 1.6（判定窗读得出来）', () => {
    const fake = { ...bareEnemy('en_bare_hb'), activeHitbox: { x: 0, y: 1, z: 0 } } as unknown as Enemy
    vis.sync([fake] as unknown as Enemy[], 1003)
    expect(visMap().get('en_bare_hb')!.core.scale.x, 'hb 真腿：setScalar(1.6)').toBeCloseTo(1.6, 5)
    vis.sync(ai.enemies, 1004)
  })

  it('碎甲动画窗：碎后 30 tick 内板放大+闪烁，之后才永久隐去', () => {
    const k = ai.spawn('en_hanged_knight', { x: 50, y: 0, z: -10 }, 'kb17')
    k.armorBroken = true
    k.plateBreakTick = 100
    vis.sync(ai.enemies, 110) // since = 10 < 30：动画窗内
    const plate = plateOf(k.id)!
    expect(plate.visible, '动画窗内板还在').toBe(true)
    expect(plate.scale.x, '1 + k*0.5，k = since/30').toBeCloseTo(1 + (10 / 30) * 0.5, 5)
    const pm = plate.material as THREE.MeshStandardMaterial
    expect(pm.emissiveIntensity, '闪烁强度 k*4').toBeCloseTo((10 / 30) * 4, 5)
    expect(pm.emissive.getHex()).toBe(0xffdd88)
    vis.sync(ai.enemies, 150) // since = 50 ≥ 30
    expect(plateOf(k.id)!.visible, '30 tick 后永久隐去').toBe(false)
    k.armorBroken = false
    k.plateBreakTick = 0
    vis.sync(ai.enemies, 151)
    expect(plateOf(k.id)!.visible, '复原后板重新亮起（外层 else 腿）').toBe(true)
  })

  it('蓄力反馈：charging ⇒ 刃口辉光随进度变亮、武器举高，满蓄闪一下（KI-002）', () => {
    player.charging = true
    player.chargeTicks = 24 // chargeProgress getter ⇒ 24/48 = 0.5
    vis.sync(ai.enemies, 1)
    expect(vis.sword.rotation.x, '-0.5 - prog*1.2：慢慢举高').toBeCloseTo(-1.1, 5)
    const form = vis.sword.children.find((c) => c.visible) as THREE.Group
    const mat = (form.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(mat.emissive.getHex(), '刃口染上蓄力橙').toBe(0xffaa44)
    expect(mat.emissiveIntensity, 'prog*2.5，未满无闪项').toBeCloseTo(1.25, 5)
    player.chargeTicks = 48 // prog = 1：满蓄
    vis.sync(ai.enemies, 3)
    expect(mat.emissiveIntensity, '满蓄叠闪项：2.5 + sin(tick*0.3)*0.8')
      .toBeCloseTo(2.5 + Math.sin(3 * 0.3) * 0.8, 5)
    player.charging = false
    player.chargeTicks = 0
    vis.sync(ai.enemies, 4)
  })
})
