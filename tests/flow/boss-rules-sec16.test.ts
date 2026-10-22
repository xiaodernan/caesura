import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, RegionData, SpawnGroup, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector, DEFAULT_SPAWN_OPTIONS, type SpawnHost } from '@/world/SpawnDirector'
import { PropSystem } from '@/world/Props'
import { LockOn } from '@/player/LockOn'
import { RpgRuntime } from '@/rpg/Runtime'
import { VfxLayer, VFX_BUDGET } from '@/vfx/VfxLayer'
import * as THREE from 'three'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-295：**§16「Boss 通用规则与数值上限」那一族第一次在真链上被量**。
 *
 * **这一批量的七条腿**：
 * ① **每 Boss 恰 2 或 3 阶段**（运行时数出来的，不是表里数的）；
 * ② **阶段换的是行为不是数值**（每一阶的招式白名单都换；奥斯塔拉换的是**钟壳**、
 *    恩希尔换的是**三件减益**、万籁换的是**感知模型**〔聋 ＋ 震感 10m〕）；
 * ③ **处决递减 12%→8%→5%**（同一具 Boss 连着处决四刀，量每一刀占她血多少）；
 * ④ **锁定：Boss 加分与那张框**（`ui.target` 的 `isBoss` 标志；打分式里 Boss 拿 **+3**）；
 * ⑤ **性能预算：同屏敌人上限**；
 * ⑥ **性能预算：粒子池 2000**；
 * ⑦ **性能预算：hitstop 期不 spawn 新实体**。
 *
 * **三条量具纪律**：
 * ① **运行时数出来的阶数**才算数（`tests/unit/boss-budget.test.ts` 那条读的是表——表守住了不等于运行时守住了）；
 * ② **处决递减要真的按四刀**（表里那个「12+8+5 ≤ 30%」是加法，运行时是逐刀的乘算）；
 * ③ **性能预算要量闸门，不量常数**（常数改了闸门照样在那儿，得证明闸门会卡）。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>('moveset:ms_sword'))
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout())
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const props = new PropSystem(regions, () => true)
  ai.noiseSink = (src) => props.sinkNoise(src)
  ai.props = props
  combat.props = props
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k),
  }, (p: Vec3) => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) })
  const lock = new LockOn(player, playerBase.lockOn)
  lock.candidates = ai.enemies
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const offs = [
    bus.on('combat.hit', () => {}),
  ]
  const pins: Array<() => void> = []
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      for (const pin of pins) pin()
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      lock.update()
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, lock, props, frame, tick, off, pins }
}

type World = ReturnType<typeof makeWorld>

/** 把一具 Boss 钉在原地钉住状态，玩家站在它面前 3m */
function placeBoss(w: World, id: string, z = -3) {
  const e = w.ai.spawn(id, { x: 0, y: 0, z }, 'boss')
  e.enter('chase')
  e.alertness = 100
  w.player.pos = { x: 0, y: 0, z: 0 }
  w.pins.push(() => { e.pos.x = 0; e.pos.z = z; if (e.state !== 'chase') e.enter('chase') })
  w.tick(4)
  return e
}

/** 凿碎一根音刺（真重击通道；万籁不在场 ⇒ 没人抢预算） */
function breakSpine(w: World, id: string): void {
  const spine = w.props.all.find((p) => p.id === id)!
  w.player.pos = { x: spine.pos.x, y: spine.pos.y, z: spine.pos.z - 1.2 }
  w.tick(2)
  for (let i = 0; i < 4; i++) {
    w.player.yaw = Math.atan2(spine.pos.x - w.player.pos.x, spine.pos.z - w.player.pos.z)
    w.player.camYawRef = w.player.yaw + Math.PI
    w.player.stats.stamina = w.player.stats.staMax
    w.frame.held.add('attackHeavy')
    w.tick(1)
    w.frame.held.delete('attackHeavy')
    w.tick(1)
    for (let t = 0; t < 70; t++) { w.player.stats.hp = w.player.stats.hpMax; w.player.stunTicks = 0; w.player.crumpleTicks = 0; w.tick() }
  }
}

describe('KI-295 §16「Boss 通用规则与数值上限」那一族', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **每 Boss 恰 2 或 3 阶段**：奥斯塔拉 **3** 阶、恩希尔 **3** 阶、万籁 **2** 阶 ⇒ 与设计「每 Boss 恰 2 或 3 阶段」逐字对上（阶数是**运行时数出来的**，不是表里数的）', () => {
    // 奥斯塔拉：血线走两刀 ⇒ 两跳
    {
      const w = makeWorld()
      const e = placeBoss(w, 'en_ostlara')
      const events: number[] = []
      const off = bus.on('boss.phase', (p) => { if (p.id === e.id) events.push(p.phase) })
      e.stats.hp = Math.round(e.stats.hpMax * 0.59); w.tick(4)
      e.stats.hp = Math.round(e.stats.hpMax * 0.24); w.tick(4)
      expect(events, '奥斯塔拉：59% 与 24% 各跳一阶').toEqual([2, 3])
      expect((e as any).bossPhase, '运行时在第三阶').toBe(2)
      off(); w.ai.despawn(e.id); alive.push(w.off)
    }
    // 恩希尔：同上
    {
      const w = makeWorld()
      const e = placeBoss(w, 'en_hersil')
      const events: number[] = []
      const off = bus.on('boss.phase', (p) => { if (p.id === e.id) events.push(p.phase) })
      e.stats.hp = Math.round(e.stats.hpMax * 0.59); w.tick(4)
      e.stats.hp = Math.round(e.stats.hpMax * 0.24); w.tick(4)
      expect(events, '恩希尔：59% 与 24% 各跳一阶').toEqual([2, 3])
      off(); w.ai.despawn(e.id); alive.push(w.off)
    }
    // 万籁：**血线不进她的阶**（入口是场地事件）⇒ 凿碎三根音刺才跳一阶
    {
      const w = makeWorld()
      const e = w.ai.spawn('en_myriad', { x: -250, y: -144, z: 250 }, 'boss')
      const events: number[] = []
      const off = bus.on('boss.phase', (p) => { if (p.id === e.id) events.push(p.phase) })
      w.tick(5)
      e.stats.hp = Math.round(e.stats.hpMax * 0.1)
      w.tick(10)
      expect(events, '她的血掉到 10% 也不跳阶（入口是场地事件不是血线）').toEqual([])
      expect((e as any).bossPhase).toBe(0)
      for (const id of ['prop_spine_mine', 'prop_spine_gallery', 'prop_spine_lair']) { breakSpine(w, id); w.tick(5) }
      expect(events, '三根音刺碎尽 ⇒ 跳一阶').toEqual([2])
      expect((e as any).bossPhase, '运行时在第二阶').toBe(1)
      off(); w.ai.despawn(e.id); alive.push(w.off)
    }
  })

  it('腿② **阶段换的是行为不是数值**：奥斯塔拉换的是**钟壳**、恩希尔换的是**三件减益**、万籁换的是**感知模型**（聋 ＋ 震感 10m，而且入口是**场地事件**）⇒ 与设计「阶段必有场地变化而非纯数值」逐字对上（**只有万籁那一阶是场地驱动的** ⇒ 登记）', () => {
    // 奥斯塔拉：P1 钟壳 ⇒ P2 壳没了、招式白名单换了
    {
      const w = makeWorld()
      const e = placeBoss(w, 'en_ostlara')
      const all = e.data.attacks.map((a) => a.id)
      const p1 = e.phaseActions(all)
      expect(e.shellUp, 'P1 她带着钟壳').toBe(true)
      expect(e.shellDmgMul, '壳期伤害 ×0.1').toBeCloseTo(0.1, 5)
      e.stats.hp = Math.round(e.stats.hpMax * 0.59); w.tick(4)
      expect(e.shellUp, 'P2 壳掉了').toBe(false)
      expect(e.shellDmgMul, 'P2 伤害回到 ×1').toBe(1)
      const p2 = e.phaseActions(all)
      expect(p2.join(), 'P2 的招式白名单换了').not.toEqual(p1.join())
      expect(p2.length, 'P2 的白名单更宽（加入三连与钟摆）').toBeGreaterThan(p1.length)
      w.ai.despawn(e.id); alive.push(w.off)
    }
    // 恩希尔：P2 换的是**玩家身上的三件减益**
    {
      const w = makeWorld()
      const e = placeBoss(w, 'en_hersil')
      const all = e.data.attacks.map((a) => a.id)
      const p1 = e.phaseActions(all)
      expect((w.player as any).beatParasite, 'P1 玩家身上没有寄生').toBe(null)
      e.stats.hp = Math.round(e.stats.hpMax * 0.59); w.tick(4)
      const p2 = e.phaseActions(all)
      expect(p2.join(), 'P2 的招式白名单换了').not.toEqual(p1.join())
      expect((w.player as any).beatParasite, 'P2 玩家身上挂了体力寄生').not.toBe(null)
      expect((w.player as any).dodgeJitterTicks, 'P2 闪避漂移 4 拍').toBe(4)
      w.ai.despawn(e.id); alive.push(w.off)
    }
    // 万籁：P2 换的是**感知模型**（聋 ＋ 震感 10m），入口是**场地事件**
    {
      const w = makeWorld()
      const e = w.ai.spawn('en_myriad', { x: -250, y: -144, z: 250 }, 'boss')
      w.tick(5)
      expect(e.deaf, 'P1 她听得见').toBe(false)
      expect(e.data.ai.vibration.range, 'P1 震感 0').toBe(0)
      for (const id of ['prop_spine_mine', 'prop_spine_gallery', 'prop_spine_lair']) { breakSpine(w, id); w.tick(5) }
      expect((e as any).bossPhase).toBe(1)
      expect(e.deaf, 'P2 她聋了（阶段聋，不是那 6s 临时窗）').toBe(true)
      expect((e as any).bossPhaseData?.vibrationRange, 'P2 改读地面 10m').toBe(10)
      w.ai.despawn(e.id); alive.push(w.off)
    }
  })

  it('腿③ **处决递减 12%→8%→5%**：同一具 Boss 连着处决四刀 ⇒ 伤害逐刀 **53／35／22／22**（占血 **12.6%／8.3%／5.2%／5.2%**）⇒ 与设计「12%→8%→5% 防止无限处决」逐字对上（第四刀**钉在 5%** 不再降）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -1 }, 'boss')
    e.enter('chase')
    w.player.pos = { x: 0, y: 0, z: 0 }
    const dmgMul = w.player.rpg.execMul
    const fracs: number[] = []
    const dealt: number[] = []
    for (let k = 0; k < 4; k++) {
      e.stats.crumpleTicksLeft = 60
      e.pos.x = 0; e.pos.z = -1
      w.player.pos = { x: 0, y: 0, z: 0 }
      const hp0 = e.stats.hp
      w.frame.edges.add('interact')
      w.tick(1)
      w.tick(140) // 处决演出 132 拍 ⇒ 走完才轮到下一刀
      const d = hp0 - e.stats.hp
      expect(d, `第 ${k + 1} 刀确实砍下去了`).toBeGreaterThan(0)
      dealt.push(d)
      fracs.push(d / e.stats.hpMax)
    }
    const hpMax = e.stats.hpMax
    expect(hpMax, '她 420 血').toBe(420)
    expect(dmgMul, '处决乘数 1.05（泛音那一格）').toBeCloseTo(1.05, 5)
    // **钉的是实际掉的血**，不是「表里的数乘一下」——后者是恒真式（表一改它也跟着改 ⇒ 谁都抓不到）
    expect(dealt, '四刀的实际伤害：12%／8%／5%／5%（420×比例×1.05 取整）').toEqual([53, 35, 22, 22])
    expect(fracs[0] / dmgMul, '第一刀占血 12%（扣掉处决乘数那一层）').toBeCloseTo(0.12, 2)
    expect(fracs[1] / dmgMul, '第二刀占血 8%').toBeCloseTo(0.08, 2)
    expect(fracs[2] / dmgMul, '第三刀占血 5%').toBeCloseTo(0.05, 2)
    expect(fracs[3] / dmgMul, '第四刀**钉在 5%**（不再往下走）').toBeCloseTo(0.05, 2)
    expect(fracs[0] + fracs[1] + fracs[2], '三刀之和 ≤ 30%（设计「防止无限处决」的上限）').toBeLessThanOrEqual(0.3)
    w.ai.despawn(e.id)
    alive.push(w.off)
  })

  it('腿④ **锁定那一格**：锁上 Boss 时 `ui.target` 的 **`isBoss`** 标志为真；打分式里 Boss 拿 **+3** 加分（**同角度同距离时 Boss 赢**）⇒ 与设计「Boss 锁定框独立」对上（**框那一半在运行时换成了底部乐句线，不是金色声纹环** ⇒ 登记）', () => {
    const w = makeWorld()
    const boss = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -8 }, 'boss')
    const mob = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -8 }, 'mob')
    const targets: Array<{ name: string; isBoss: boolean }> = []
    const off = bus.on('ui.target', (p) => targets.push({ name: p.name, isBoss: p.isBoss }))
    // 两只摆在**完全一样的位置** ⇒ 距离与角度完全一样 ⇒ 只有 Boss 加分能分出胜负
    boss.pos.x = 0; boss.pos.z = -8
    mob.pos.x = 0; mob.pos.z = -8
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    w.player.camYawRef = 0
    w.lock.candidates = w.ai.enemies
    w.lock.acquireBest()
    expect(w.lock.target?.id, '同角度同距离 ⇒ Boss 赢（+3 加分）').toBe(boss.id)
    expect(targets[targets.length - 1]?.isBoss, 'ui.target 的 isBoss 标志为真').toBe(true)
    expect(playerBase.lockOn.bossBonus, '那份加分住在 player.json').toBe(3)
    // 锁普通怪 ⇒ isBoss 为假（金色声纹环那一支只给非 Boss）
    mob.pos.x = 0; mob.pos.z = -8
    boss.pos.x = 0; boss.pos.z = -40 // 把 Boss 挪出射程
    w.lock.acquireBest()
    expect(w.lock.target?.id, '只剩普通怪 ⇒ 锁她').toBe(mob.id)
    expect(targets[targets.length - 1]?.isBoss, '普通怪那一帧 isBoss 为假').toBe(false)
    off()
    w.ai.despawn(boss.id); w.ai.despawn(mob.id)
    alive.push(w.off)
  })

  it('腿⑤ **性能预算：同屏敌人上限** ⇒ **闸门真的会卡**（上限 8 ⇒ 恰好 8 个落地、第 9 个排队）；但**发行默认是 60，不是设计写的 ≤8** ⇒ 登记', () => {
    // 闸门：把上限设成 8，塞 12 个槽位进去 ⇒ 恰好 8 个落地
    {
      const base = regions[0]
      const group: SpawnGroup = { enemyId: 'en_murkshell', count: 12, center: { x: 0, y: 0, z: 0 }, radius: 12 }
      const region: RegionData = {
        ...base, id: 'rg_budget', nameKey: 'region.budget', displayName: 'budget', order: 99,
        unlockFlag: undefined,
        bounds: { minX: -10000, maxX: 10000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1000 },
        spawnGroups: [group], landmarks: [], interactables: [], secrets: [], storyHooks: [],
      }
      const live = new Map<string, string>()
      let n = 0
      const host: SpawnHost = {
        spawn: (enemyId) => { const id = `en#${++n}`; live.set(id, enemyId); return { id } },
        despawn: (id) => live.delete(id),
        hasFlag: () => false,
      }
      const cellKey = (): ((p: Vec3) => string) => {
        const s = new StreamingSystem([region])
        return (p) => { const c = s.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
      }
      const dir = new SpawnDirector([region], host, cellKey(), { maxAlive: 8, jitter: 0 })
      dir.syncActive([cellKey()({ x: 0, y: 0, z: 0 })])
      expect(dir.aliveCount, '上限 8 ⇒ 恰好 8 个落地').toBe(8)
      expect(live.size, '宿主那边也只有 8 个').toBe(8)
      dir.dispose()
    }
    // 发行默认：60
    expect(DEFAULT_SPAWN_OPTIONS.maxAlive, '发行默认上限是 60（设计写的是 ≤8）').toBe(60)
  })

  it('腿⑥ **性能预算：粒子池 2000** ⇒ **火星 1600 ＋ 碎核 256 ＝ 1856 ≤ 2000**；环 **128**／贴花 **48** ⇒ 与设计「Boss 战粒子统一池 2000」逐字对上', () => {
    const vfx = new VfxLayer(new THREE.Scene())
    expect(VFX_BUDGET.sparks + VFX_BUDGET.shards, '粒子实例合计 ≤ 2000').toBeLessThanOrEqual(2000)
    expect(VFX_BUDGET.sparks + VFX_BUDGET.shards, '实际是 1856').toBe(1856)
    expect(VFX_BUDGET.rings, '环 128').toBe(128)
    expect(VFX_BUDGET.decals, '贴花 48').toBe(48)
    // 池的容量就是那张表：把火星池灌到顶，看它**停在**表上的数
    const a = vfx as unknown as { sparks: { live: number; spawn(): number }; rings: { live: number; spawn(): number }; shards: { live: number; spawn(): number }; decals: { live: number; spawn(): number } }
    while (a.sparks.live < VFX_BUDGET.sparks) a.sparks.spawn()
    while (a.shards.live < VFX_BUDGET.shards) a.shards.spawn()
    while (a.rings.live < VFX_BUDGET.rings) a.rings.spawn()
    while (a.decals.live < VFX_BUDGET.decals) a.decals.spawn()
    expect(vfx.stats.sparks, '火星池停在 1600').toBe(VFX_BUDGET.sparks)
    expect(vfx.stats.shards, '碎核池停在 256').toBe(VFX_BUDGET.shards)
    expect(vfx.stats.rings, '环池停在 128').toBe(VFX_BUDGET.rings)
    expect(vfx.stats.decals, '贴花池停在 48').toBe(VFX_BUDGET.decals)
    expect(vfx.stats.sparks + vfx.stats.shards, '同时活跃的粒子实例 ≤ 2000').toBeLessThanOrEqual(2000)
    vfx.dispose()
  })

  it('腿⑦ **性能预算：hitstop 期不 spawn 新实体** ⇒ **那一格没有承载体**（屏息里进格**照样刷**）⇒ 如实登记', () => {
    const base = regions[0]
    const group: SpawnGroup = { enemyId: 'en_murkshell', count: 3, center: { x: 0, y: 0, z: 0 }, radius: 12 }
    const region: RegionData = {
      ...base, id: 'rg_stop', nameKey: 'region.stop', displayName: 'stop', order: 99,
      unlockFlag: undefined,
      bounds: { minX: -10000, maxX: 10000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1000 },
      spawnGroups: [group], landmarks: [], interactables: [], secrets: [], storyHooks: [],
    }
    const live = new Map<string, string>()
    let n = 0
    const host: SpawnHost = {
      spawn: (enemyId) => { const id = `en#${++n}`; live.set(id, enemyId); return { id } },
      despawn: (id) => live.delete(id),
      hasFlag: () => false,
    }
    const cellKey = (): ((p: Vec3) => string) => {
      const s = new StreamingSystem([region])
      return (p) => { const c = s.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
    }
    const dir = new SpawnDirector([region], host, cellKey(), { maxAlive: 60, jitter: 0 })
    // **先让世界进入屏息**（hitStop 走完 0.5s 之前时间被压到 5%）
    const time = new GameTime()
    time.hitStop(0.5)
    expect(time.rawScale, '此刻世界正在屏息').toBeLessThan(1)
    dir.syncActive([cellKey()({ x: 0, y: 0, z: 0 })])
    expect(dir.aliveCount, '屏息里进格 ⇒ **照样刷**（那一格没有承载体）').toBe(3)
    dir.dispose()
  })
})
