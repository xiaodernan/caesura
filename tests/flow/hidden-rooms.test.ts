import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions, worldstate } from '@/data'
import type { MovesetData, RegionData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { Surface } from '@/world/Surface'
import { SpawnDirector } from '@/world/SpawnDirector'
import { Interactables } from '@/world/Interactables'
import { RpgRuntime } from '@/rpg/Runtime'
import { KillSettlement, openLootTable, refreshPlayer, type SettlementDeps } from '@/rpg/Settlement'
import { WorldState } from '@/quest/WorldState'
import { SaveGame, MapStore } from '@/save/Serializer'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * 隐藏房与闸门旗标的**可达性**（Phase 6-A / KI-041）。
 *
 * KI-041 的原始事实是：`regions.json` 里一批旗标只有读方没有写方，于是它们锁着的箱子与隐藏房
 * **玩家走得再远也拿不到**——逐文件的数据校验全绿，因为读半截和写半截各自都"合法"。
 * 这里跑的正是那条链的另一头：发生了某件游戏内真实的事 ⇒ 旗标被立 ⇒ 锁开了 ⇒ 东西真的能领。
 * 三条链都从生产入口进（真弹反、真敲钟、真击杀 Boss），没有一条是测试自己 emit 出来的。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld(store = new MapStore()) {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner', 'hidden-rooms')
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, s) => ai.spawn(id, pos, s),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const interact = new Interactables(regions, () => true)
  const deps: SettlementDeps = { rpg, refresh: () => refreshPlayer(rpg, player), checkpoint: () => {} }
  // 击杀结算要接着（杀 Boss 那一条链用真通道打死 ⇒ entity.died ⇒ 掉落），所以这套世界也接 KillSettlement
  const settlement = new KillSettlement(deps)
  const worldState = new WorldState(worldstate, {
    hasFlag: (k) => streaming.hasFlag(k),
    setFlag: (k) => streaming.setFlag(k)
  })
  const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, rpg, interact }, store)
  const offs = [() => worldState.dispose(), () => settlement.dispose(), () => interact.dispose(), () => streaming.dispose()]
  alive.push(...offs)

  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  refreshPlayer(rpg, player)

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }

  /** 站到某个交互物跟前，按 E（走 use(id) 这条正式入口，不碰 setFlag 抄近路） */
  const standAt = (id: string): void => {
    const it = interact.all.find((x) => x.id === id)!
    player.pos = { ...it.pos }
    tick(2)
  }

  return { time, rhythm, player, ai, combat, streaming, interact, worldState, rpg, deps, saves, store, tick, standAt, offs }
}

type World = ReturnType<typeof makeWorld>

/** 一次真弹反（§5.2 的防守阶梯），不 emit 事件 */
function parryOnce(w: World): void {
  const e = w.ai.spawn('en_murkshell', { x: w.player.pos.x, y: w.player.pos.y, z: w.player.pos.z - 1.6 }, 'parry-probe')
  e.alertness = 100
  e.enter('chase')
  for (let t = 0; t < 900; t++) {
    const a = Math.atan2(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)
    w.player.yaw = a
    w.player.camYawRef = Math.PI + a
    const atk = e.attack
    if (atk && atk.tick === atk.spec.frames.startup - 3) w.player.parryTicksLeft = w.player.base.parry.activeTicks
    w.player.stats.hp = w.player.stats.hpMax
    w.tick()
    if (w.streaming.hasFlag('flag.parry_taught')) { w.ai.despawn(e.id); return }
  }
  throw new Error('900 tick 里一次弹反都没成，这条链的判据失效了')
}

/** 走真实伤害通道打死目标（弹体 → strikeEnemy → entity.died），测试自己不叫死亡函数 */
function killThroughRealChannel(w: World, target: Enemy): void {
  w.combat.projectiles.spawn({
    hostile: false, ownerId: 'player', kind: 'spear',
    origin: { x: target.pos.x, y: target.pos.y + 1.1, z: target.pos.z }, dir: { x: 0, y: 0, z: 1 },
    speed: 2, range: 5, radius: 1, damage: 9999, poise: 0, hitStopMs: 0
  }, w.time.tick)
  for (let t = 0; t < 12 && target.alive; t++) w.tick()
}

const regionOf = (id: string): RegionData => regions.find((r) => r.id === id)!

describe('隐藏房可达性：发生了什么 ⇒ 立旗 ⇒ 锁开 ⇒ 东西真能领', () => {
  it('第一次真弹反 ⇒ 雾语林的音壁不再挡路（§14 捷径线）', () => {
    const w = makeWorld()
    w.standAt('sw_whisperwode_soundwall')
    expect(w.interact.use('sw_whisperwode_soundwall', w.player.pos).state, '没学过弹反之前它就是锁着的').toBe('locked')
    parryOnce(w)
    expect(w.streaming.hasFlag('flag.parry_taught'), '规则表里的 firstParry 该被真实弹反触发').toBe(true)
    const r = w.interact.use('sw_whisperwode_soundwall', w.player.pos)
    expect(r.ok, '弹反过一次之后，那面壁就该裂开').toBe(true)
    expect(w.streaming.hasFlag('flag.choir_entrance_open'), '裂开之后通向沉唱堂的 flag 要连着立起来').toBe(true)
  })

  it('敲响落钟 ⇒ 钟腔封存点从"上着锁"变成能撬开，撬开拿到的是隐藏房档的装备', () => {
    const w = makeWorld()
    const vault = w.interact.all.find((i) => i.secretId === 'sec_fellcarillon_bell_interior')!
    w.standAt(vault.id)
    expect(w.interact.use(vault.id, w.player.pos).state, '钟还没敲之前，钟腔是锁着的').toBe('locked')
    w.standAt('bl_fellcarillon_fallenbell')
    const bell = w.interact.use('bl_fellcarillon_fallenbell', w.player.pos)
    expect(bell.ok, '钟要真的响过一次（走 Interactables.use）').toBe(true)
    expect(w.streaming.hasFlag('flag.bell_interior_open'), 'interactUsed 规则要把这件事记进世界状态').toBe(true)

    w.standAt(vault.id)
    const open = w.interact.use(vault.id, w.player.pos)
    expect(open.ok, '锁开了就该按得动').toBe(true)
    expect(open.lootTable, '奖励表来自那条 secret，不是箱子上抄的第二份').toBe('loot_secret_bellinterior')
    const gearsBefore = w.rpg.inv.gears.length
    openLootTable(w.deps, open.lootTable!)
    expect(w.rpg.inv.gears.length, '这一撬要真的掉出一件装备进背包').toBe(gearsBefore + 1)
    const order = registry.get<{ rarity: { id: string }[] }>('progression').rarity.map((r) => r.id)
    const got = registry.get<{ gear?: { rarity?: string } }>(w.rpg.inv.gears[gearsBefore].itemId).gear!.rarity!
    expect(order.indexOf(got), `掉出来的是${got}档`).toBeGreaterThanOrEqual(order.indexOf('rareplus'))
    w.standAt(vault.id)
    expect(w.interact.use(vault.id, w.player.pos).state, '同一个封存点不能撬第二次').toBe('used')
  })

  it('杀死奥斯塔拉 ⇒ 沉唱堂那只 T2 箱不再锁着（Boss 死亡的后果要留在世界里）', () => {
    const w = makeWorld()
    const chest = 'ch_drowned_choir_movement'
    w.standAt(chest)
    expect(w.interact.use(chest, w.player.pos).state, '她活着的时候这只箱子是锁着的').toBe('locked')
    const boss = w.ai.spawn('en_ostlara', { x: w.player.pos.x, y: w.player.pos.y, z: w.player.pos.z - 6 }, 'kill-for-flag')
    boss.skipIntro()
    killThroughRealChannel(w, boss)
    expect(boss.alive, '她得真的死在这一串里').toBe(false)
    expect(w.streaming.hasFlag('flag.ostlara_defeated'), 'bossDefeated 规则按 dataId 立旗').toBe(true)
    w.standAt(chest)
    expect(w.interact.use(chest, w.player.pos).ok, '她死了，那间 Movement 室的锁就没人守了').toBe(true)
  })

  it('这些后果跟着存档走：读档后端开过的封存点不会又能撬一次', async () => {
    const w = makeWorld()
    const vault = w.interact.all.find((i) => i.secretId === 'sec_fellcarillon_bell_interior')!
    w.standAt('bl_fellcarillon_fallenbell')
    w.interact.use('bl_fellcarillon_fallenbell', w.player.pos)
    w.standAt(vault.id)
    expect(w.interact.use(vault.id, w.player.pos).ok).toBe(true)
    await w.saves.save('hidden')

    const w2 = makeWorld(w.store)
    await w2.saves.load('hidden')
    expect(w2.streaming.hasFlag('flag.bell_interior_open'), '旗标复原（它是世界状态，不是 UI 态）').toBe(true)
    expect(w2.interact.snapshot(), '撬过的封存点复原').toContain(vault.id)
    w2.standAt(vault.id)
    expect(w2.interact.use(vault.id, w2.player.pos).state, '读档后不能白拿一次隐藏房奖励').toBe('used')
  })

  it('杀死奥斯塔拉 ⇒ 音壁回廊捷径打开且反复可用：从沉唱堂穿回雾语林（§15.1 奖励/§2.4 捷径拍，KI-021①）', () => {
    const w = makeWorld()
    const shortcut = 'tp_choir_soundwall_shortcut'
    w.standAt(shortcut)
    expect(w.interact.use(shortcut, w.player.pos).state, '她活着的时候捷径是锁着的').toBe('locked')
    const boss = w.ai.spawn('en_ostlara', { x: w.player.pos.x, y: w.player.pos.y, z: w.player.pos.z - 6 }, 'shortcut-kill')
    boss.skipIntro()
    killThroughRealChannel(w, boss)
    expect(boss.alive, '她得真的死在这一串里').toBe(false)
    w.standAt(shortcut)
    const r1 = w.interact.use(shortcut, w.player.pos)
    expect(r1.ok, '她死后音壁回廊的捷径开了（flag.ostlara_defeated 的写方在 worldstate）').toBe(true)
    expect(r1.to, '落点在雾语林一侧、音壁的另一边').toEqual({ x: 330, y: 0, z: 106 })
    // 落点必须真的能站：Surface 认账的地板（travel 的 y 契约）
    const surface = new Surface(regions)
    expect(surface.floorAt(r1.to!)?.y, '穿墙落点踩在雾语林的地板上').toBe(0)
    const r2 = w.interact.use(shortcut, w.player.pos)
    expect(r2.ok, '捷径是永久的：第二次穿墙照常可用（teleport 天然反复）').toBe(true)
  })

  it('回音石堆：研读是写方（旗立）⇒ 封存点解锁 ⇒ 石堆档真能领；研读一次性（KI-041）', () => {
    const w = makeWorld()
    w.standAt('ch_echo_cairn_claim')
    expect(w.interact.use('ch_echo_cairn_claim', w.player.pos).state, '没读过石堆之前，封存点锁着').toBe('locked')
    w.standAt('in_echo_cairn')
    const read = w.interact.use('in_echo_cairn', w.player.pos)
    expect(read.ok, '「读石堆」是一次真的按 E 的动作，不是走近就算').toBe(true)
    expect(w.streaming.hasFlag('flag.echo_cairn_read'), '研读这个动作把旗立了起来（写方落地）').toBe(true)
    w.standAt('ch_echo_cairn_claim')
    const claim = w.interact.use('ch_echo_cairn_claim', w.player.pos)
    expect(claim.ok, '旗立了，石堆的封存点能撬了').toBe(true)
    expect(claim.lootTable, '奖励表来自那条 secret（loot_secret_cairn 第一次可达）').toBe('loot_secret_cairn')
    const gearsBefore = w.rpg.inv.gears.length
    openLootTable(w.deps, claim.lootTable!)
    expect(w.rpg.inv.gears.length, '真的掉出东西进背包').toBeGreaterThan(gearsBefore)
    w.standAt('in_echo_cairn')
    expect(w.interact.use('in_echo_cairn', w.player.pos).state, '研读是一次性的：读过就是读过').toBe('used')
  })

  it('区域的解锁判定也吃同一套广播：立了 unlockFlag，那块区域就参与流送', () => {
    const w = makeWorld()
    const choir = regionOf('rg_drowned_choir')
    expect(w.streaming.isRegionUnlocked(choir), '默认没解锁').toBe(false)
    w.streaming.setFlag(choir.unlockFlag!, true) // 与音壁裂开时走的是同一个 flag 通道
    expect(w.streaming.isRegionUnlocked(choir), 'setFlag 之后区域应立刻参与流送').toBe(true)
  })
})
