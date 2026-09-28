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
  const surface = new Surface(regions)
  const standAt = (id: string): void => {
    const it = interact.all.find((x) => x.id === id)!
    player.pos = { ...it.pos }
    // main.ts 每帧都用 Surface 按区域层刷新 floorY（休垒 0 / 沉唱堂 -40 / 无耳深窖 -144…），
    // harness 里没有那个循环：不补这一步，y 会被 gravity 拽回默认的 0，地下层的交互全部变成"离得太远"。
    player.floorY = surface.floorAt(player.pos)?.y ?? 0
    player.vy = 0
    player.grounded = true
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

  it('破拍营地的商摊：E 可交易、反复可用——"能不能买"从此取决于人在不在摊前（KI-055②）', () => {
    const w = makeWorld()
    const stall = w.interact.all.find((i) => i.id === 'shop_camp_stall')!
    expect(stall.kind, '它是商摊不是箱子').toBe('shop')
    w.standAt('shop_camp_stall')
    const prompt = w.interact.use('shop_camp_stall', w.player.pos)
    expect(prompt.ok, '在摊前按 E，交易成立').toBe(true)
    expect(prompt.text, '摊主的招呼要说明白').toContain('摊子')
    // 反复可用：交易不是一次性的
    const r2 = w.interact.use('shop_camp_stall', w.player.pos)
    expect(r2.ok, '第二次交易照常成立').toBe(true)
    // 焦点：站在摊前，E 键仲裁会指向它
    expect(w.interact.focus(w.player.pos)?.id, '焦点就是商摊').toBe('shop_camp_stall')
  })

  it('区域的解锁判定也吃同一套广播：立了 unlockFlag，那块区域就参与流送', () => {
    const w = makeWorld()
    const choir = regionOf('rg_drowned_choir')
    expect(w.streaming.isRegionUnlocked(choir), '默认没解锁').toBe(false)
    w.streaming.setFlag(choir.unlockFlag!, true) // 与音壁裂开时走的是同一个 flag 通道
    expect(w.streaming.isRegionUnlocked(choir), 'setFlag 之后区域应立刻参与流送').toBe(true)
  })

  it('沉唱堂侧廊：推开侧廊门是写方（旗立）⇒ 侧廊的封存点解锁 ⇒ 独岚档真能领（KI-087）', () => {
    const w = makeWorld()
    const cache = w.interact.all.find((i) => i.secretId === 'sec_drownedchoir_side_nave')!
    expect(cache, '这条 secret 从此有领取点（KI-041 缺的那半截几何）').toBeTruthy()
    w.standAt(cache.id)
    expect(w.interact.use(cache.id, w.player.pos).state, '还没发现侧廊，封存点锁着').toBe('locked')

    w.standAt('in_drownedchoir_side_nave')
    expect(w.interact.use('in_drownedchoir_side_nave', w.player.pos).ok, '推门是一次真的按 E 的动作').toBe(true)
    expect(w.streaming.hasFlag('flag.side_nave_found'), '推门把旗立了起来（写方落地）').toBe(true)

    w.standAt(cache.id)
    const claim = w.interact.use(cache.id, w.player.pos)
    expect(claim.ok, '旗立了，侧廊的封存点能撬了').toBe(true)
    expect(claim.lootTable, '奖励表来自那条 secret（loot_secret_nave 第一次可达）').toBe('loot_secret_nave')
    const gearsBefore = w.rpg.inv.gears.length
    openLootTable(w.deps, claim.lootTable!)
    expect(w.rpg.inv.gears.length, '真的掉出东西进背包').toBeGreaterThan(gearsBefore)

    // 几何：领取点踩在**可行走层**上（KI-041 那笔账的理由正是"当前 secret 坐标在可行走层之外"）
    const surface = new Surface(regions)
    expect(surface.floorAt(cache.pos)?.y, '封存点踩在沉唱堂的地板上').toBe(-40)
    expect(surface.floorAt(w.interact.all.find((i) => i.id === 'in_drownedchoir_side_nave')!.pos)?.y, '门也踩在地板上').toBe(-40)

    w.standAt(cache.id)
    expect(w.interact.use(cache.id, w.player.pos).state, '封存点是一次性的').toBe('used')
    w.standAt('in_drownedchoir_side_nave')
    expect(w.interact.use('in_drownedchoir_side_nave', w.player.pos).state, '推门也是一次性的').toBe('used')
  })

  it('初句圣所：五环线索链第一次闭合成链——四环读到，井底那扇门才认你（Phase 6-C，KI-091）', () => {
    const w = makeWorld()
    const door = w.interact.all.find((i) => i.id === 'ga_deeps_firstphrase_door')!
    const claim = w.interact.all.find((i) => i.secretId === 'sec_first_phrase')!
    expect(door, '无耳深窖井底那扇门要在数据里').toBeTruthy()
    expect(claim, '这条 secret 从此有领取点（KI-041 缺的那半截几何）').toBeTruthy()

    w.standAt(door.id)
    const closed = w.interact.use(door.id, w.player.pos)
    expect(closed.state, '一环都没读：门不动（这就是"不靠走近解"）。').toBe('locked')
    expect(closed.text, '锁着的时候要说清还差哪几环').toContain('flag.clue_')

    // 四环分散在四个区域，各自按 E 读一次（走真入口，不直接 setFlag）
    const rings = [
      'in_fellcarillon_reverse_score',   // ① 钟坠院：钟舌上的反向谱线
      'in_resthold_dome_reflection',     // ② 休垒：积水里的倒影
      'in_drownedchoir_d5_scratch',      // ③ 沉唱堂：石龛的三连划痕
      'in_deeps_lean_corpses',           // ④ 无耳深窖：遗骸倾斜的朝向
    ]
    // 门的闸门**恰好**是这四环：多一环少一环都会被数据门抓住（
    // 每一环的旗只被这扇门读 —— 把它从列表里摘掉，validator 立刻报"写了没人读"）
    const ringFlags = ['flag.clue_reverse_score', 'flag.clue_dome_reflection', 'flag.clue_d5_scratch', 'flag.clue_lean_corpses']
    expect([...(door.requiresFlags ?? [])].sort(), '合取闸门就是这四环').toEqual([...ringFlags].sort())

    for (let i = 0; i < 3; i++) {
      w.standAt(rings[i])
      expect(w.interact.use(rings[i], w.player.pos).ok, `${rings[i]} 读得动（inspect 是一次真的按 E）`).toBe(true)
      w.standAt(door.id)
      const useRes = w.interact.use(door.id, w.player.pos)
      expect(useRes.state, `读了 ${i + 1} 环还不够：门只认四环齐`).toBe('locked')
    }

    w.standAt(rings[3])
    expect(w.interact.use(rings[3], w.player.pos).ok).toBe(true)
    for (const f of ['flag.clue_reverse_score', 'flag.clue_dome_reflection', 'flag.clue_d5_scratch', 'flag.clue_lean_corpses']) {
      expect(w.streaming.hasFlag(f), `${f} 由规则表立起（写方在 worldstate.json，不在代码里）`).toBe(true)
    }

    w.standAt(door.id)
    const opened = w.interact.use(door.id, w.player.pos)
    expect(opened.ok, '四环齐了，井底的门才开').toBe(true)
    expect(w.streaming.hasFlag('flag.found_first_phrase'), '开门就是那条 secret 的写方（KI-041 白名单上最后一条）').toBe(true)

    w.standAt(claim.id)
    const claimRes = w.interact.use(claim.id, w.player.pos)
    expect(claimRes.ok, '锁开了，石刻前的领取点按得动').toBe(true)
    expect(claimRes.lootTable, '奖励表来自那条 secret，不是箱子上抄的第二份').toBe('loot_secret_firstphrase')
    // 音徽是**装备实例**（`Inventory.add` 对 kind='seal' 走 addGear）：量的是 gears 里那一件，
    // 不是 stacks 的计数——写成 count() 会永远读到 0，那条断言会绿着说谎
    const seals = (): number => w.rpg.inv.gears.filter((g) => g.itemId === 'seal_darkscore').length
    const before = seals()
    openLootTable(w.deps, claimRes.lootTable!)
    expect(seals(), '这一拓要真的把音徽·暗谱锻成一件装备进背包').toBe(before + 1)

    // 几何：门、领取点、secret 自己的坐标都踩在**可行走层**上
    // （KI-041 那笔账的理由正是"当前 secret 坐标在可行走层之外"——它原来悬在 y=-180）
    const surface = new Surface(regions)
    const secret = regionOf('rg_earless_deeps').secrets!.find((s) => s.id === 'sec_first_phrase')!
    expect(surface.floorAt(claim.pos)?.y, '领取点踩在无耳深窖的地板上').toBe(-144)
    expect(surface.floorAt(door.pos)?.y, '门也踩在地板上').toBe(-144)
    expect(surface.floorAt(secret.pos)?.y, 'secret 自己的坐标也落回本层地板').toBe(-144)

    w.standAt(claim.id)
    expect(w.interact.use(claim.id, w.player.pos).state, '封存点是一次性的').toBe('used')
  })

  it('破拍营地：盟军补给点只认收编（`flag.brokenbar_allied` 的唯一读方，KI-087）', () => {
    // 写方在对话里：n6 的 c1（归还给休垒 ⇒ OUTPOST）派生这面旗，那一半由 haltrune.test.ts 在同一批里钉住。
    // 这里量的是另一半——这个读方到底认不认它。
    const w = makeWorld()
    const store = w.interact.all.find((i) => i.secretId === 'sec_brokenbar_ally_path')!
    expect(store, '这条 secret 从此有领取点').toBeTruthy()
    w.standAt(store.id)
    expect(w.interact.use(store.id, w.player.pos).state, '还没结盟 ⇒ 盟军的补给点关着').toBe('locked')

    w.streaming.setFlag('flag.brokenbar_allied', true) // 与收编那条抉择走的是同一个 flag 通道
    w.standAt(store.id)
    const claim = w.interact.use(store.id, w.player.pos)
    expect(claim.ok, '结盟之后补给点开了').toBe(true)
    expect(claim.lootTable, '奖励表来自那条 secret').toBe('loot_camp_store')
    const surface = new Surface(regions)
    expect(surface.floorAt(store.pos)?.y, '补给点踩在营地的地板上').toBe(0)
    w.standAt(store.id)
    expect(w.interact.use(store.id, w.player.pos).state, '一次性').toBe('used')
  })
})
