import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { refreshPlayer } from '@/rpg/Settlement'
import { SaveGame, MapStore } from '@/save/Serializer'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * §7.3 被动栏第一批（KI-036）：常拍脚（踏音宽限）与厚膜鼓（架势衰减）。
 *
 * 裁决：先做**有真消费方**的两条——常拍脚的踏音判定就是 strikeEnemy 里那三处
 * `rhythm.onBeat(50)`（§11 拍点架势 ×2），厚膜鼓吃 EntityStats 既有衰减通道；
 * 残响耳撞 KI-032（上限在真实帧数据下打不到，抬了等于改一条没压力的规则）；
 * **轻身法（处决演出的取消窗）已在本文件后半段落表**——它等的"处决状态机"就是 `PlayerController.executing`
 * 那段早返回，取消窗只是把末尾一段的操作权还给玩家。数值住数据（values L1-3），
 * 首版填数登记在 KI-036 行，产品可改表不改码。
 *
 * 常拍脚的时序腿是全批最硬的一条：60BPM 下让一记轻击的命中帧落在**拍点后 4 tick
 * （66.7ms）**——50ms 的旧窗判不中、80ms 的新窗判得中，架势 ×2 的差值只能来自宽限。
 */

registerGameData()

const beatTicks = 60 // 60BPM

function makeWorld(store = new MapStore()) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(weapon.movesetId))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, rpg }, store)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

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
  return { time, rhythm, player, ai, combat, streaming, rpg, saves, tick, frame, input }
}

type World = ReturnType<typeof makeWorld>

/** 学常拍脚 L1：点亮序句页 + 塞钱 + 研读 + 灌给玩家（与 main.ts 的 refresh 同口径） */
function learnFeatherRest(w: World): void {
  w.rpg.inv.add('it_resonance_core', 1)
  expect(w.rpg.moves.unlockPage('mvpage_rest', w.rpg.inv).ok, '乐章 IV·休止 点亮').toBe(true)
  w.rpg.inv.add('it_timbite', 100)
  w.rpg.inv.add('it_score_fragment', 100)
  expect(w.rpg.moves.learnPassive('ps_featherrest', w.rpg.inv).ok, '研读成立').toBe(true)
  refreshPlayer(w.rpg, w.player) // 生产口径：refreshPlayer 里那三格（常拍脚/厚膜鼓/轻身法）
}

function learnMetronomeFoot(w: World): void {
  w.rpg.inv.add('it_resonance_core', 1)
  expect(w.rpg.moves.unlockPage('mvpage_prelude', w.rpg.inv).ok, '页点亮').toBe(true)
  w.rpg.inv.add('it_timbite', 100)
  w.rpg.inv.add('it_score_fragment', 100)
    expect(w.rpg.moves.learnPassive('ps_metronomefoot', w.rpg.inv).ok, '研读成立').toBe(true)
    refreshPlayer(w.rpg, w.player) // 走生产口径（Stakerite 的 onApply → refreshRpg），不手抄一份接线
  }

/**
 * 在拍相位 phase 处起手（必要时先翻滚上弦宽限），让命中帧落在**拍点后 4 tick**；
 * 返回第一记 combat.hit 的架势值。时序对齐：edges 在第 T+1 tick 的 update 里被吃 ⇒
 * 「按在 51、命中在 64」= 拍点后 4 tick（66.7ms）。
 */
function hitAtPhase(w: World, pressPhase: number, withRoll: boolean): number {
  const victim = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, `t${pressPhase}-${withRoll}`)
  victim.pos = { x: 0, y: 0, z: -1.6 }
  // 受击者的时间按住（frozenTicks）：它一旦自己起手，`inStartup` 的 1.5× 就会混进比值
  // （那笔账归 KI-017，不属于这条腿）。sense 照跑 ⇒ state 可以进 chase，
  // 但 Enemy.update 在 frozen 处短路 ⇒ 招式永远不会开始，比值里只剩 onBeat 那一乘。
  victim.frozenTicks = 100000
  let landed = false
  let poiseBase = -1
  let startupAtHit = false
  const off = bus.on('combat.hit', (h) => {
    if (h.result === 'hit') {
      landed = true
      if (poiseBase < 0) poiseBase = h.poiseDamage
      startupAtHit = victim.inStartup
    }
  })
  if (withRoll) {
    while (w.time.tick % beatTicks !== pressPhase) w.tick()
    w.frame.edges.add('dodge')
    w.tick()
    while (w.player.roll) w.tick()
    expect(w.player.beatGraceTicks, '翻滚结束那一刻宽限上弦').toBeGreaterThan(0)
  } else {
    while (w.time.tick % beatTicks !== pressPhase) w.tick()
  }
  const S = (Math.floor(w.time.tick / beatTicks) + 1) * beatTicks - 8 // 按键拍相位 52：实测命中落在拍点后 4 tick（66.7ms）
  while (w.time.tick % beatTicks !== S % beatTicks) w.tick()
  w.player.pos = { x: 0, y: 0, z: -3 }
  w.player.yaw = Math.atan2(victim.pos.x - w.player.pos.x, victim.pos.z - w.player.pos.z)
  w.player.camYawRef = w.player.yaw + Math.PI
  w.player.stats.stamina = w.player.stats.staMax
  w.player.stats.hp = w.player.stats.hpMax
  w.frame.edges.add('attackLight')
  w.tick()

  for (let i = 0; i < 40 && !landed; i++) {
    // 受击者已被 frozenTicks 按住（见上），这里只管玩家别被别的事打断
    w.player.stats.hp = w.player.stats.hpMax
    w.player.stunTicks = 0
    w.tick()
  }
  off()

  expect(landed, '这一记要真的命中').toBe(true)
  expect(startupAtHit, '受击者没在起手：否则 1.5× 会混进比值（fixture 失效的读法）').toBe(false)
  // onBeat 的 ×2 乘在 addPoise 那一格（combat.hit 的 poiseDamage 是乘前底数）⇒ 读比值
  expect(victim.stats.poiseAccum, '架势累积要真的进了账').toBeGreaterThan(0)
  return victim.stats.poiseAccum / poiseBase
}

describe('§7.3 被动栏第一批（KI-036）：常拍脚与厚膜鼓', () => {
  it('研读链：页暗拒学 → 点亮后扣钱升级 → 等级与数值可读 → 满级拒绝', () => {
    const w = makeWorld()
    expect(w.rpg.moves.passiveLevel('ps_metronomefoot')).toBe(0)
    expect(w.rpg.moves.learnPassive('ps_metronomefoot', w.rpg.inv).ok, '页暗的时候学不了').toBe(false)
    learnMetronomeFoot(w)
    expect(w.rpg.moves.passiveLevel('ps_metronomefoot')).toBe(1)
    expect(w.rpg.moves.passiveValue('ps_metronomefoot'), 'L1 = 0.6s 宽限').toBe(0.6)
    // 分数堆叠有上限 ⇒ 逐次注资（一次性大额会被截断到 99）
    w.rpg.inv.add('it_timbite', 90)
    w.rpg.inv.add('it_score_fragment', 90)
    expect(w.rpg.moves.learnPassive('ps_metronomefoot', w.rpg.inv).ok, 'L2 研读').toBe(true)
    w.rpg.inv.add('it_timbite', 100)
    w.rpg.inv.add('it_score_fragment', 100)
    const r3 = w.rpg.moves.learnPassive('ps_metronomefoot', w.rpg.inv)
    expect(r3.ok, 'L3 研读：' + r3.reason).toBe(true)
    expect(w.rpg.moves.passiveValue('ps_metronomefoot'), 'L3 = 1.2s').toBe(1.2)
    expect(w.rpg.moves.passiveLevel('ps_metronomefoot'), '满级').toBe(3)
    expect(w.rpg.moves.learnPassive('ps_metronomefoot', w.rpg.inv).ok, '满级再学是拒绝').toBe(false)
  })

  it('厚膜鼓：refresh 同口径把衰减乘数灌进计量器，架势累积消退 1.3 倍快', () => {
    const w = makeWorld()
    w.rpg.inv.add('it_score_fragment', 2) // 舞曲页的解锁源
    w.rpg.moves.unlockPage('mvpage_dance', w.rpg.inv)
    w.rpg.inv.add('it_timbite', 100)
    w.rpg.inv.add('it_score_fragment', 100)
    expect(w.rpg.moves.learnPassive('ps_tympanicguard', w.rpg.inv).ok, '研读成立').toBe(true)
    refreshPlayer(w.rpg, w.player) // 生产接线：refreshPlayer 里那两格（常拍脚 / 厚膜鼓）
    expect(w.player.stats.poiseDecayMul, 'L1 = +30% 衰减').toBe(1.3)
    // 衰减实测：等过 72 tick 的保护窗，再量同一窗口里两份衰减量
    w.player.stats.poiseAccum = 20
    w.tick(200)
    w.player.stats.poiseAccum = 20
    const before = w.player.stats.poiseAccum
    w.tick(60)
    const drained = before - w.player.stats.poiseAccum
    const control = makeWorld().player
    control.stats.poiseAccum = 20
    const c0 = control.stats.poiseAccum
    for (let i = 0; i < 60; i++) { w.time.tick++; control.update(TICK_DT, w.time, w.input, w.time.tick, w.rhythm) }
    const drainedControl = c0 - control.stats.poiseAccum
    expect(drained / drainedControl, `衰减量恰为 1.3 倍（${drained.toFixed(2)} / ${drainedControl.toFixed(2)}）`).toBeCloseTo(1.3, 5)
  })

  it('常拍脚·时序腿：翻滚后的命中帧落在拍点后 66.7ms —— 旧窗(50ms)判不中、新窗(80ms)架势 ×2', () => {
    const pressPhase = 8 // 翻滚世界的起手拍相位（翻滚在相位 39 结束，宽限 36 tick 覆盖到命中）
    const w0 = makeWorld()
    refreshPlayer(w0.rpg, w0.player) // 两边同一口径（属性/词缀进 poiseDmgMul）：唯一差别只能是宽限
    const poisePlain = hitAtPhase(w0, pressPhase, false)
    const w1 = makeWorld()
    learnMetronomeFoot(w1)
    const poiseGrace = hitAtPhase(w1, pressPhase, true)
    expect(poiseGrace, `宽限内那一乘 = 2（实测 ${poiseGrace}）——50ms 判不中的那一拍被 80ms 接住了`).toBe(2)
    expect(poisePlain, `旧窗下那一乘 = 1（实测 ${poisePlain}）`).toBe(1)
  })

  it('轻身法·取消窗：只有处决演出的**后 30%** 才收得掉，而且取消是真的翻滚起来', () => {
    const total = playerBase.execution.durationTicks // 132（表里的总时长，不手抄）
    const windowStart = Math.floor(total * (1 - 0.3)) // 表里 values[0]=0.3 ⇒ 窗从第 93 tick 起

    // ① 没学：窗内按翻滚也收不掉（被动没学 = 那一段的操作权不归你）
    const w0 = makeWorld()
    refreshPlayer(w0.rpg, w0.player)
    w0.player.beginExecute({ x: 0, y: 0, z: -2 }, total)
    w0.tick(windowStart + 5)
    w0.frame.edges.add('dodge')
    w0.tick()
    expect(w0.player.executing, '没学 ⇒ 演出继续').not.toBeNull()
    expect(w0.player.roll, '而且没有翻滚').toBeNull()

    // ② 学了但在窗外：同样无效（窗是"最后一段"，不是"整场"）
    const w1 = makeWorld()
    learnFeatherRest(w1)
    w1.player.beginExecute({ x: 0, y: 0, z: -2 }, total)
    w1.tick(40)
    w1.frame.edges.add('dodge')
    w1.tick()
    expect(w1.player.executing, '窗外 ⇒ 演出继续').not.toBeNull()

    // ③ 窗内：演出被收掉，且这一 tick 的翻滚真的起（取消换回来的是操作权，不是"提前结束"）
    const w2 = makeWorld()
    learnFeatherRest(w2)
    w2.player.beginExecute({ x: 0, y: 0, z: -2 }, total)
    w2.tick(windowStart + 5)
    expect(w2.player.executing, '先确认还在演出里').not.toBeNull()
    w2.frame.edges.add('dodge')
    w2.tick()
    expect(w2.player.executing, '窗内 ⇒ 演出被收掉').toBeNull()
    expect(w2.player.roll, '而且翻滚当场起来').not.toBeNull()

    // ④ 超载：窗内按也收不掉 —— 与翻滚那条拒判同口径（超载不许被这条新路径静默绕过）
    const w3 = makeWorld()
    learnFeatherRest(w3)
    w3.player.rpg = { ...w3.player.rpg, overloaded: true }
    w3.player.beginExecute({ x: 0, y: 0, z: -2 }, total)
    w3.tick(windowStart + 5)
    w3.frame.edges.add('dodge')
    w3.tick()
    expect(w3.player.executing, '超载 ⇒ 收不掉').not.toBeNull()
    w3.tick(total) // 演出照原时长走完（不按键也不卡住）
    expect(w3.player.executing).toBeNull()
  })

  it('轻身法·数值腿：等级改的是窗口起点，而不是"能不能取消"（0.3 → 0.4 让窗更早开）', () => {
    const total = playerBase.execution.durationTicks
    const w = makeWorld()
    learnFeatherRest(w)
    expect(w.rpg.moves.passiveValue('ps_featherrest'), 'L1 = 0.3').toBe(0.3)
    // L1 的窗从「tick > floor(total×0.7)」起（132 ⇒ 第 93 tick）：0.6 处按无效
    const beforeWindow = Math.floor(total * 0.6)
    w.player.beginExecute({ x: 0, y: 0, z: -2 }, total)
    w.tick(beforeWindow)
    w.frame.edges.add('dodge')
    w.tick()
    expect(w.player.executing, 'L1 在窗开之前收不掉').not.toBeNull()

    // 升到 L3（0.4）⇒ 同一相位就能收掉
    const w2 = makeWorld()
    w2.rpg.inv.add('it_resonance_core', 1)
    w2.rpg.moves.unlockPage('mvpage_rest', w2.rpg.inv)
    w2.rpg.inv.add('it_timbite', 1000)
    w2.rpg.inv.add('it_score_fragment', 1000)
    // 每次研读升一级：L1 → L3 要三次（数值住 data 的 values[0..2] = 0.3/0.35/0.4）
    for (let i = 0; i < 3; i++) expect(w2.rpg.moves.learnPassive('ps_featherrest', w2.rpg.inv).ok).toBe(true)
    expect(w2.rpg.moves.passiveValue('ps_featherrest'), 'L3 = 0.4').toBe(0.4)
    refreshPlayer(w2.rpg, w2.player)
    w2.player.beginExecute({ x: 0, y: 0, z: -2 }, total)
    w2.tick(Math.floor(total * 0.65)) // 0.65 落在 0.6(=1-0.4) 之后
    w2.frame.edges.add('dodge')
    w2.tick()
    expect(w2.player.executing, 'L3 的窗更早开').toBeNull()
    expect(w2.player.roll).not.toBeNull()
  })

  it('被动跟着存档走（v9）：读档后等级与数值都在', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    learnMetronomeFoot(w)
    await w.saves.save('passives')
    const w2 = makeWorld(store)
    await w2.saves.load('passives')
    expect(w2.rpg.moves.passiveLevel('ps_metronomefoot'), '等级复原').toBe(1)
    expect(w2.rpg.moves.passiveValue('ps_metronomefoot'), '数值复原').toBe(0.6)
    // 读档路径的后半段（main.ts：restore 之后 refreshRpg）：数值要真的落到玩家身上——
    // 翻滚结束那一刻上弦的宽限就是它的读法
    refreshPlayer(w2.rpg, w2.player)
    w2.frame.edges.add('dodge')
    w2.tick()
    while (w2.player.roll) w2.tick()
    expect(w2.player.beatGraceTicks, '读档后被动照样生效').toBeGreaterThan(0)
  })
})
