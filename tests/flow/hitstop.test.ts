import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, msToTicks } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, statuses } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * §9「命中停顿（hit stop）：冻结攻守双方动画时间」第一次成为**玩法量**（KI-017 第二步）。
 *
 * 落在哪一格不是选出来的，是量出来的。三种候选口径各跑过一遍全量测试：
 * - 给**敌方招式帧**挂同样的账 ⇒ 她的收势帧从自己声明的拍位上被推开一整个停顿长度（实测恩希尔
 *   173ms、奥斯塔拉 133ms，而 §2.1 的容差是 50ms；幽灵八那边还出现两 tick"从隐形段里出手"）。
 *   敌人的招式帧就是那张网格，一按就脱拍 —— 这条否掉。
 * - 给**玩家招式帧**也挂 ⇒ 不违反 §2.1，于是这一步之后把 `gate5.brawl` 的量具重造成了自适应的（按键按玩家
 *   状态排，不再按绝对 tick 排），用公平量具做 A/B：高甲比值 1.45 → **1.60**，仍在 [1, 2] 带内（第一次测出的 2.04 是半套补丁的假读数，
 *   改口写在 KI-017 行）⇒ 数值闸门不反对这一式，拦着它的是一次**手感裁决**：玩家每一记命中多付 3~7 格
 *   去换"刀陷进肉里"，而灰盒阶段这格停顿没有可见收益。下面那两条边界用例按现行口径钉住"出手方不被按停"，
 *   哪天裁决改了，它们会红在那里提醒改账的人。
 * - 只按在**挨打的那一方**（硬直倒数）⇒ 45 files / 484 passed 一条不红。
 *
 * 于是本作的口径写成一句：**停顿按在挨打的那一方身上，不按在出手的那一方身上**。
 *
 * 时长只有一个来源：那一格的 `frames.hitStopMs`（§55）。下面的期望值全部从生产同一个 `msToTicks`
 * 派生；每一把尺子都配一条 `hitStopMs: 0` 的对照腿（两跑只差那一个数），所以"多撑了几格"量的是
 * 停顿本身，不是弹道要飞几 tick、也不是硬直倒数本身多久走一格。
 */

registerGameData()

const subs: Array<() => void> = []
afterEach(() => { for (const f of subs.splice(0)) f() }) // 早退的用例也不要把总线挂到手掌之外

const FOE = 'en_tympanus'
const FOE_POS: Vec3 = { x: 0, y: 0, z: -1.8 }
const STOP = 90 // 尺子只用这一格停顿；期望值一律经 msToTicks 换算，不手算

type Hit = { attackerId: string; victimId: string; damage: number; kind: string; result: string; hitStopMs: number }

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hpMax = 9_999
  player.stats.hp = 9_999
  const hits: Hit[] = []
  const offs = [bus.on('combat.hit', (p) => hits.push(p as unknown as Hit))]
  /** 钉住位置与血量：让"走开/被打死"不污染这几条时序断言 */
  const upkeep: Array<{ e: Enemy; pos: Vec3 }> = []
  const pin = (e: Enemy): Enemy => { upkeep.push({ e, pos: { ...e.pos } }); return e }

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset() // 停顿只吃相机那一半（真实时标），逻辑这侧每 tick 重新计时：rawScale 因此可读
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
      for (const u of upkeep) {
        if (!u.e.alive) continue
        u.e.stats.hp = u.e.stats.hpMax
        u.e.stats.dead = false
        u.e.pos.x = u.pos.x; u.e.pos.y = u.pos.y; u.e.pos.z = u.pos.z
      }
    }
  }
  const off = (): void => { for (const f of offs) f() }
  subs.push(off)
  return { time, rhythm, player, ai, combat, frame, tick, hits, pin, off }
}
type World = ReturnType<typeof makeWorld>

const faceAt = (w: World, p: Vec3): void => {
  w.player.yaw = Math.atan2(p.x - w.player.pos.x, p.z - w.player.pos.z)
  w.player.camYawRef = Math.PI + w.player.yaw
}

/** 一记真出手（弹体 → `strikeEnemy` / `resolveAgainstPlayer`），停顿时长由调用方钉死 */
function shoot(w: World, at: Vec3, hitStopMs: number, hostile = false): void {
  w.combat.projectiles.spawn({
    hostile, ownerId: hostile ? FOE : 'player', kind: 'note',
    origin: { x: at.x, y: at.y + 1.1, z: at.z + (hostile ? 1.4 : -1.4) },
    dir: { x: 0, y: 0, z: hostile ? -1 : 1 },
    speed: 60, range: 20, radius: 1.2, damage: 6, poise: 0, hitStopMs, onBeat: false
  }, w.time.tick)
}

/**
 * 一把尺子：**从这一记落地，到硬直倒数第一次动起来，中间过了几格**。
 * 没有停顿时它是 1（下一格就走），有停顿时它是 1 + 停顿格数。所以所有断言都写成
 * `带停顿 - 对照 == msToTicks(那一格)` —— 差值才是停顿吃掉的逻辑时间。
 */
function ticksUntilStunMoves(w: World, read: () => number, landed: () => boolean, cap = 300): number {
  for (let i = 0; i < cap && !landed(); i++) w.tick()
  expect(landed(), '这一记根本没落地：这条断言在量空气').toBe(true)
  const s0 = read()
  const t0 = w.time.tick
  for (let i = 0; i < cap && read() === s0; i++) w.tick()
  expect(read(), '倒数始终没动：停顿没有尽头？').not.toBe(s0)
  return w.time.tick - t0
}

/**
 * 敌人身上的停顿：`stopMs` 是这一记带进结算的时长（对照腿给 0）。返回"倒数第一次动起来前过了几格"。
 * 期望值一律从 `combat.hit` **事件报的那一格**换算 —— 于是这条尺子同时钉住了"事件说的"与
 * "实际按住的"是同一个数（本作的停顿时长有四处住在情境表里，不是住在招式帧里，见 combat.md §9）。
 */
function enemyStop(w: World, e: Enemy, stopMs: number): number {
  e.onParried(w.time.tick) // 走生产那条"挂了硬直"的路（弹反失音），而不是测试手写一个数
  expect(e.stunTicks, '前提：她确实进了一段硬直').toBeGreaterThan(0)
  shoot(w, e.pos, stopMs)
  return ticksUntilStunMoves(w, () => e.stunTicks, () => w.hits.some((h) => h.victimId === e.id))
}

const reportedStop = (w: World, pick: (h: Hit) => boolean): number => {
  const h = w.hits.find(pick)
  expect(h, '这一记没落地：读不到它报的停顿时长').toBeTruthy()
  return h!.hitStopMs
}

describe('§9 停顿按在挨打的那一方（KI-017 第二步）', () => {
  it('她被打中：硬直倒数多撑的格数 == msToTicks(hitStopMs)，松手后照走', () => {
    const a = makeWorld()
    const ea = a.pin(a.ai.spawn(FOE, { ...FOE_POS }, 'hold'))
    const held = enemyStop(a, ea, STOP)
    const ctl = makeWorld()
    const ce = ctl.pin(ctl.ai.spawn(FOE, { ...FOE_POS }, 'ctl'))
    const base = enemyStop(ctl, ce, 0)
    expect(reportedStop(a, (h) => h.victimId === ea.id), '弹体那一记把表里的时长原样报了出来').toBe(STOP)
    expect(held - base, '差值才是这一格停顿吃掉的逻辑时间').toBe(msToTicks(STOP))
    const before = ea.stunTicks
    a.tick()
    expect(ea.stunTicks, '窗口走完就自己接着走：按住不是作废').toBe(before - 1)
    a.off(); ctl.off()
  })

  it('玩家挨打那一侧吃同一条规则：停顿是双方的，不是只给玩家发福利', () => {
    const run = (stopMs: number): { moves: number; stunned: number; reported: number } => {
      const w = makeWorld()
      w.pin(w.ai.spawn(FOE, { x: 0, y: 0, z: -30 }, 'shooter'))
      faceAt(w, { x: 0, y: 0, z: -30 })
      shoot(w, w.player.pos, stopMs, true)
      const moves = ticksUntilStunMoves(w, () => w.player.stunTicks, () => w.hits.some((h) => h.victimId === 'player'))
      return { moves, stunned: w.player.stunTicks, reported: reportedStop(w, (h) => h.victimId === 'player') }
    }
    const hit = run(STOP)
    expect(hit.stunned, '这一记确实把玩家打进了硬直').toBeGreaterThan(0)
    // §9 是"情境"表：「玩家受击 80ms」不看攻击者招式自己那一格（这里传进去的 90 是干扰项）
    expect(hit.reported, '受击那一下的时长住在情境表里，不是招式表里').toBe(80)
    // 尺子读出的格数含"它真正动起来的那一格"，所以被按住的格数是 moves - 1
    expect(hit.moves - 1, '玩家的硬直倒数被按住的就是这一格').toBe(msToTicks(hit.reported))
  })

  it('停顿只停硬直倒数：她被按住的这几格里，人仍然是醒着的（不是 §7.2 那种整只停）', () => {
    const w = makeWorld()
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'awake'))
    e.stunTicks = 60
    shoot(w, e.pos, STOP)
    for (let i = 0; i < 20 && !w.hits.some((h) => h.victimId === e.id); i++) w.tick()
    const state0 = e.stateTick
    const stop0 = e.stunStopTicks
    expect(stop0, '前提：停顿确实挂着').toBeGreaterThan(0)
    w.tick(stop0)
    expect(e.stunStopTicks, '停顿走完了').toBe(0)
    expect(e.stateTick - state0, '这几 tick 里她的状态计时照走：停的只是硬直那一格').toBe(stop0)
    expect(e.frozenTicks, '而这一步没有碰 §7.2 那格账').toBe(0)
    w.off()
  })
})

describe('§9 的边界：停顿不按在出手的那一方', () => {
  it('打中人不比挥空多花一 tick（哪天有人给玩家招式帧挂停顿账，这里就红）', () => {
    const swing = (hitSomething: boolean): number => {
      const w = makeWorld()
      let e: Enemy | null = null
      if (hitSomething) e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'in'))
      faceAt(w, e ? e.pos : { x: 0, y: 0, z: -40 })
      w.player.stats.stamina = w.player.stats.staMax
      w.frame.edges.add('attackLight')
      const t0 = w.time.tick
      w.tick()
      let guard = 0
      while (w.player.action && guard++ < 400) w.tick()
      const duration = w.time.tick - t0
      if (hitSomething) expect(w.hits.some((h) => h.victimId === e!.id), '这一记要真落在她身上').toBe(true)
      else expect(w.hits.length, '挥空那条腿必须一个命中都没有').toBe(0)
      w.off()
      return duration
    }
    const air = swing(false)
    const contact = swing(true)
    expect(air, '量具失效：挥空都没有时长').toBeGreaterThan(0)
    expect(contact, '打中人把这一记拉长了 ⇒ 停顿吃到了出手方').toBe(air)
  })

  it('她正在挥的那一记：挨打之后招式帧仍每 tick 走一格，而停顿确实挂上了', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { ...FOE_POS }, 'swing')
    e.alertness = 100
    e.enter('combat')
    for (let i = 0; i < 900 && !e.attack; i++) {
      e.stats.hp = e.stats.hpMax
      w.tick()
    }
    const atk = e.attack
    if (!atk) throw new Error('900 tick 里她没出过一招：这条用例的前提失效')
    shoot(w, e.pos, STOP)
    let sawStop = false
    for (let i = 0; i < 6; i++) {
      const t0 = atk.tick
      w.tick()
      expect(atk.tick - t0, '她的招式帧每 tick 仍走一格：停顿不碰出手方').toBe(1)
      if (e.stunStopTicks > 0) sawStop = true
    }
    expect(sawStop, '这一记根本没给她挂上停顿 ⇒ 上面那六步是空转').toBe(true)
    w.off()
  })
})

describe('§9「弹反成功 120ms」：被弹反的人就是此刻挨打的那一方', () => {
  it('弹反那一下把她失音的硬直多按住 msToTicks(120) 格', () => {
    // 弹反这一路不需要对照腿：情境时长（120）不住在招式帧里，测试也没有办法把它调成 0；
    // 所以这条量的是"事件报的那一格 == 实际按住的格数"，并用 onParried 那段真硬直当载体。
    const parryAndMeasure = (): { held: number; reported: number } => {
      const w = makeWorld()
      const e = w.ai.spawn(FOE, { x: 0, y: 0, z: -2.2 }, 'parry')
      e.alertness = 100
      e.enter('combat')
      for (let t = 0; t < 1500; t++) {
        const a = Math.atan2(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)
        w.player.yaw = a
        w.player.camYawRef = Math.PI + a
        w.player.stats.hp = w.player.stats.hpMax
        const atk = e.attack
        if (atk && atk.tick === atk.spec.frames.startup - 3) w.player.parryTicksLeft = w.player.base.parry.activeTicks
        w.tick()
        const parried = w.hits.some((h) => h.result === 'parry' && h.attackerId === e.id)
        if (parried) {
          expect(e.stunTicks, '弹反那一下该给她挂上失音硬直（§5.3 那条 onParried）').toBeGreaterThan(0)
          const reported = reportedStop(w, (h) => h.result === 'parry' && h.attackerId === e.id)
          return { held: ticksUntilStunMoves(w, () => e.stunTicks, () => true) - 1, reported }
        }
      }
      throw new Error('1500 tick 里没弹成一次反：这条用例的尺子失效')
    }
    const { held, reported } = parryAndMeasure()
    expect(reported, '§9「弹反成功」那一格说的是 120ms').toBe(120)
    expect(held, '弹反那 120ms 确实按住了她的硬直（否则这条在自证空集）').toBeGreaterThan(0)
    expect(held, '事件报的那一格就是被按住的格数').toBe(msToTicks(reported))
  })
})

describe('§9 停顿与相邻两套时间：各记各的账', () => {
  it('打空不产生停顿：没有接触就没有人被打断时间', () => {
    const w = makeWorld()
    const e = w.pin(w.ai.spawn(FOE, { x: 0, y: 0, z: -40 }, 'miss'))
    e.stunTicks = 60
    shoot(w, { x: 0, y: 0, z: 4 }, STOP) // 朝空处飞：射程内没有人可打
    w.tick(30)
    expect(w.hits.length, '前提：这一记谁也没打着').toBe(0)
    expect(e.stunStopTicks, '没有被击中的实体').toBe(0)
    expect(e.stunTicks, '硬直倒数照常走').toBe(30)
    w.off()
  })

  it('§11 回声那一记不抢时间：原记挂上停顿，重演那一记不挂', () => {
    const w = makeWorld()
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'echo'))
    faceAt(w, e.pos)
    let heavy: Hit | undefined
    for (let attempt = 0; attempt < 6 && !heavy; attempt++) {
      w.player.stats.stamina = w.player.stats.staMax
      w.player.stats.hp = w.player.stats.hpMax
      faceAt(w, e.pos)
      w.frame.held.add('attackHeavy')
      w.tick(3)
      w.frame.held.delete('attackHeavy')
      for (let i = 0; i < 120 && !heavy; i++) {
        w.tick()
        heavy = w.hits.find((h) => h.victimId === e.id && h.kind === 'heavy')
      }
    }
    expect(heavy, '重击没打上，后面的断言无意义').toBeTruthy()
    expect(heavy!.hitStopMs, '原记这一格表里没写停顿 ⇒ 这条对照失去意义').toBeGreaterThan(0)
    expect(w.time.rawScale, '原记那一下相机停了：对照腿要有东西可比').toBeLessThan(1)
    expect(e.stunStopTicks, '原记那一下也把停顿挂在了她身上').toBeGreaterThan(0)
    expect(w.combat.echoesLive, '§11：重击命中挂出"回声影"').toBe(1)
    const before = w.hits.length
    let landed = false
    for (let i = 0; i < statuses.echo.delayTicks + 40 && !landed; i++) {
      w.tick()
      landed = w.hits.length > before
    }
    const replay = w.hits.slice(before).find((h) => h.victimId === e.id)
    expect(replay, '重演那一记要真的落下来').toBeTruthy()
    expect(replay!.kind, '重演走的是战技那一条通道（否则这条对照的不是回声）').toBe('skill')
    expect(w.time.rawScale, '世界又播一遍：相机不该再停一次').toBe(1)
    expect(e.stunStopTicks, '世界又播一遍，不该再抢她一次时间').toBe(0)
    w.off()
  })

  it('与 §7.2 时停分格：冻结的那十 tick 里停顿计数一格不扣', () => {
    const w = makeWorld()
    const e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'stack'))
    e.stunTicks = 60
    e.stunStopTicks = 5
    e.frozenTicks = 10
    w.tick(10)
    expect(e.frozenTicks, '时停窗口走完').toBe(0)
    expect(e.stunStopTicks, '两格账不互相抵扣：那几十毫秒被时停吃掉了，不该白送给硬直').toBe(5)
    expect(e.stunTicks, '硬直当然也没走').toBe(60)
    w.tick(5)
    expect(e.stunStopTicks, '松开之后停顿才继续走完').toBe(0)
    expect(e.stunTicks, '停顿走完这才开始还硬直的债').toBe(60)
    w.tick(1)
    expect(e.stunTicks).toBe(59)
    w.off()
  })
})
