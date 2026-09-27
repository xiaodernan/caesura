import { afterEach, describe, expect, it } from 'vitest'
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
import { PropSystem } from '@/world/Props'
import { SaveGame, MapStore } from '@/save/Serializer'
import type { Vec3 } from '@/combat/EntityStats'
import { bus } from '@/core/EventBus'

/**
 * 可破坏场景物（KI-023，§15.3 音刺）。
 *
 * 这一层补的是「本仓库没有可破坏场景物实体」的空白：prop 占一个命中靶位、有耐久计数、
 * 碎了有数据声明的后果。所有链路都从生产入口进——玩家真按键出手、真 `sound.source` 流、
 * 真碎裂广播，没有一条是测试自己 emit 出来的。
 *
 * 三条裁决各有断言钉着（§15.3 没写的格子）：
 * - 只有重击家族计次，轻击只敲响（「重击 4 次击碎」的重量语义）；
 * - 同一次数预算：一记对同一根刺只结一次账；
 * - 碎裂状态是**世界状态**（v8 入档）：读档不能把破势窗白还一次。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld(store = new MapStore()) {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1) // 深窖的网格：60BPM 心跳
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const props = new PropSystem(regions, () => true)
  ai.noiseSink = (src) => props.sinkNoise(src)
  combat.props = props
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, s) => ai.spawn(id, pos, s),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, props }, store)
  alive.push(() => streaming.dispose())

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

  const prop = (id: string) => props.all.find((p) => p.id === id)!
  /** 站到 prop 旁 1.2m 处并面向它（KI-020 的教训：朝向 = 同 tick 写 yaw 与 camYawRef） */
  const standBy = (id: string, d = 1.2): void => {
    const p = prop(id)
    player.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z - d }
    const a = Math.atan2(p.pos.x - player.pos.x, p.pos.z - player.pos.z)
    player.yaw = a
    player.camYawRef = Math.PI + a
    tick(1)
  }
  /** 按一下重击：heavy 走 held（按住蓄力、松手出招）——按 1 tick 松开 = 'h'（重击家族，不蓄力）。
   *  出手后等完整个收势（h 总长 63 tick）再返回，调用方拿到的是「一记完整挥完」的世界。 */
  const swingHeavy = (): boolean => {
    if (player.action !== null) return false
    frame.held.add('attackHeavy')
    tick(1)
    frame.held.delete('attackHeavy')
    tick(1)
    const started = player.action !== null
    tick(65)
    return started
  }
  /** 轻击一记并等收势（l1 总长 30 tick） */
  const swingLight = (): boolean => {
    if (player.action !== null) return false
    frame.edges.add('attackLight')
    tick(1)
    const started = player.action !== null
    tick(32)
    return started
  }

  return { time, rhythm, player, ai, combat, streaming, props, saves, store, tick, prop, standBy, swingHeavy, swingLight, input, frame }
}

type World = ReturnType<typeof makeWorld>

/** 把玩家按在原地、血量顶满、受击硬直清零——这条链量的是「碎刺 ⇒ 聋乱窗」，
 *  不是「顶着她的咬合能不能挥刀」（那是手感层的事，咬合打断出手在 combat 流里有自己的腿） */
function anchorPlayer(w: World, at: Vec3): void {
  w.player.pos = { ...at }
  w.player.stats.hp = w.player.stats.hpMax
  w.player.stunTicks = 0
}

describe('音刺：可被攻击、有耐久、会发声（KI-023）', () => {
  it('重击 4 次击碎；轻击只敲响不计数；同一记只结一次账', () => {
    const w = makeWorld()
    const spine = w.prop('prop_spine_mine')
    expect(spine.hitsLeft).toBe(4)
    w.standBy('prop_spine_mine')

    // 轻击 ×4：一声不落账（裁决 1 的反例腿）
    for (let i = 0; i < 4; i++) { w.swingLight() }
    expect(spine.hitsLeft, '轻击不该消耗音刺耐久').toBe(4)

    // 第一记重击：判定窗有 9 tick，多 tick 里只结一次账
    w.swingHeavy()
    expect(spine.hitsLeft, '同一记重击在判定窗里只结一次').toBe(3)

    // 补满三记 ⇒ 碎
    for (let i = 0; i < 3; i++) { w.swingHeavy() }
    expect(spine.hitsLeft).toBe(0)
    expect(w.props.hittable(spine), '碎了的刺没有再被击中的资格').toBe(false)
  })

  it('墙后面的音刺：同一记挥砍被同一堵墙吃掉（KI-070——场地件与敌人吃同一把尺子，不另开判据）', () => {
    const w = makeWorld()
    w.standBy('prop_spine_mine')
    const spine = w.prop('prop_spine_mine')
    const mid = { x: (w.player.pos.x + spine.pos.x) / 2, z: (w.player.pos.z + spine.pos.z) / 2 }
    const wl = {
      id: 'wb_prop_between', pos: { x: mid.x, y: spine.pos.y, z: mid.z },
      size: { x: 6, z: 0.6 }, heightM: 3,
    }
    const before = spine.hitsLeft
    expect(before, '夹具前提：计数型的刺才有"耐久没被扣"这件事可量（血量型的刺走另一条腿）').toBeDefined()
    w.combat.occlusion.syncAuthored({ id: 'rg_ki070', walls: [wl] })
    expect(w.swingHeavy(), '夹具前提：这一记真的出手了').toBe(true)
    expect(spine.hitsLeft, '墙把刃挡在了刺前面，却还照旧计数 = 场地件没吃这条判据').toBe(before)
    w.combat.occlusion.syncAuthored(null)
    expect(w.swingHeavy()).toBe(true)
    expect(spine.hitsLeft, '拆掉同一堵墙、同一个人、同一个位置 ⇒ 判别式在那堵墙上，不是在这条腿的夹具上')
      .toBe((before ?? 0) - 1)
  })

  it('碎裂走真广播：world.propBroken 恰一条，聋乱窗落账在猎手身上', () => {
    const w = makeWorld()
    const broken: unknown[] = []
    const off = bus.on('world.propBroken', (p) => broken.push(p))
    alive.push(off)
    const myriad = w.ai.spawn('en_myriad', { x: -250, y: -144, z: 300 }, 'prop-break')
    w.standBy('prop_spine_mine')
    for (let i = 0; i < 4; i++) { anchorPlayer(w, w.player.pos); w.swingHeavy() }
    expect(w.prop('prop_spine_mine').hitsLeft).toBe(0)
    expect(broken.length, '恰一条碎裂广播').toBe(1)
    const b = broken[0] as { id: string; kind: string; deafTarget?: string; deafTicks?: number }
    expect(b.id).toBe('prop_spine_mine')
    expect(b.kind).toBe('soundspine')
    expect(b.deafTarget).toBe('en_myriad')
    expect(b.deafTicks).toBe(360)
    // 窗在碎裂那一 tick 就开始走：断言时第 4 记的收势已耗掉 ~36 tick（360−36=324），所以只钉下界
    expect(myriad.deafTicks, '聋乱窗挂在她身上且已在走').toBeGreaterThan(300)
  })

  it('汇聚噪音：刺范围内的玩家声源「听上去发生在刺上」——她去刺那儿，不去你真实站位', () => {
    const w = makeWorld()
    // 她 30m 外沉睡；玩家站在刺旁 5m（gatherRadius 10 之内）挥一记空重击
    const spine = w.prop('prop_spine_gallery')
    w.player.pos = { x: spine.pos.x, y: spine.pos.y, z: spine.pos.z - 5 }
    w.player.yaw = 0
    w.player.camYawRef = Math.PI
    const myriad = w.ai.spawn('en_myriad', { x: spine.pos.x, y: spine.pos.y, z: spine.pos.z - 30 }, 'gather-probe')
    const playerAt = { ...w.player.pos }
    w.swingHeavy()
    const dSpine = Math.hypot(myriad.pos.x - spine.pos.x, myriad.pos.z - spine.pos.z)
    const dPlayer = Math.hypot(myriad.pos.x - playerAt.x, myriad.pos.z - playerAt.z)
    expect(dSpine, `她该瞬移到刺上（实测 ${dSpine.toFixed(2)}m）`).toBeLessThan(0.6)
    expect(dPlayer, `她不该出现在玩家的真实站位（实测 ${dPlayer.toFixed(2)}m）`).toBeGreaterThan(4)
  })

  it('范围之外的声源不经汇聚：她照旧朝玩家本位来', () => {
    const w = makeWorld()
    const spine = w.prop('prop_spine_gallery')
    w.player.pos = { x: spine.pos.x + 15, y: spine.pos.y, z: spine.pos.z } // gatherRadius 10 之外
    w.player.yaw = 0
    w.player.camYawRef = Math.PI
    const myriad = w.ai.spawn('en_myriad', { x: spine.pos.x, y: spine.pos.y, z: spine.pos.z - 40 }, 'gather-neg')
    const playerAt = { ...w.player.pos }
    w.swingHeavy()
    const dSpine = Math.hypot(myriad.pos.x - spine.pos.x, myriad.pos.z - spine.pos.z)
    const dPlayer = Math.hypot(myriad.pos.x - playerAt.x, myriad.pos.z - playerAt.z)
    expect(dPlayer, `范围外的声源直接暴露玩家（实测 ${dPlayer.toFixed(2)}m）`).toBeLessThan(0.6)
    expect(dSpine, `刺不该替玩家背锅（实测 ${dSpine.toFixed(2)}m）`).toBeGreaterThan(14)
  })

  it('碎刺 ⇒ 聋乱窗：窗内的响声不再引她瞬移；窗走完（+360 tick）听觉回来', () => {
    const w = makeWorld()
    const spine = w.prop('prop_spine_mine')
    // 她先在 50m 外（hearing.range=40 之外）：碎刺那一下她必须活着，聋乱窗才有人接账，
    // 但不能让她在玩家凿刺时凑过来咬人打断出手——那是 combat 流自己的腿，这里不量它
    const myriad = w.ai.spawn('en_myriad', { x: spine.pos.x, y: spine.pos.y, z: spine.pos.z + 50 }, 'deaf-probe')
    w.standBy('prop_spine_mine')
    for (let i = 0; i < 4; i++) { w.swingHeavy() }
    expect(spine.hitsLeft).toBe(0)
    expect(myriad.deafTicks, '碎裂那一下她的聋乱窗要挂上').toBeGreaterThan(300)

    // 她挪到玩家 20m 外（听程以内）。窗内：响亮地挥一记 ⇒ 不瞬移（hear 整条短路；
    // 「聋乱」不等于定身，她的状态机照跑，所以只断言没瞬移）
    myriad.pos = { x: w.player.pos.x, y: w.player.pos.y, z: w.player.pos.z - 20 }
    anchorPlayer(w, w.player.pos)
    w.swingHeavy()
    const d1 = Math.hypot(myriad.pos.x - w.player.pos.x, myriad.pos.z - w.player.pos.z)
    expect(d1, `聋乱窗内她不该瞬移到玩家这边（实测 ${d1.toFixed(2)}m）`).toBeGreaterThan(10)

    // 窗走完：360 tick 后同一场地、同样的响声 ⇒ 瞬移回来（听觉恢复；刺已碎，汇聚不再收编这一声）
    w.tick(380)
    w.swingHeavy()
    const d2 = Math.hypot(myriad.pos.x - w.player.pos.x, myriad.pos.z - w.player.pos.z)
    expect(d2, `窗走完她重新听得见（实测 ${d2.toFixed(2)}m）`).toBeLessThan(0.6)
  })

  it('碎裂状态是存档的一部分：读档后碎刺仍是碎的，别的刺完好', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.standBy('prop_spine_mine')
    for (let i = 0; i < 4; i++) { w.swingHeavy() }
    expect(w.prop('prop_spine_mine').hitsLeft).toBe(0)
    await w.saves.save('props')

    const w2 = makeWorld(store)
    await w2.saves.load('props')
    expect(w2.props.snapshot(), '碎刺 id 入档').toContain('prop_spine_mine')
    expect(w2.prop('prop_spine_mine').hitsLeft, '耐久也归零（表现层读的是它）').toBe(0)
    expect(w2.props.hittable(w2.prop('prop_spine_mine'))).toBe(false)
    expect(w2.prop('prop_spine_lair').hitsLeft, '别的刺完好如初').toBe(4)
    // 读档回来的世界再挥一记：碎刺不再吃这一记，完好那根照常计数
    w2.standBy('prop_spine_lair')
    const before = w2.prop("prop_spine_lair").hitsLeft ?? 0
    w2.swingHeavy()
    w2.tick(20)
    expect(w2.prop('prop_spine_lair').hitsLeft).toBe(before - 1)
    expect(w2.prop('prop_spine_mine').hitsLeft, '读档不能把破势窗白还一次').toBe(0)
  })
})
