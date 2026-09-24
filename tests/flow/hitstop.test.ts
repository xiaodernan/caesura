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
 * §9「命中停顿（hit stop）：冻结攻守双方动画时间」——两侧各落在哪一格，是量出来的（KI-017 第二、三步）。
 *
 * 守方那一半（第二步）：被击中者的硬直倒数（`PlayerController.stunStopTicks` / `Enemy.stunStopTicks`）
 * 在 `msToTicks(本行情境时长)` 个逻辑 tick 里不走，之后照走。
 *
 * 攻方那一半（第三步）落在哪一格有三种候选，各跑过一遍全量测试：
 * - **窗内按停出手方的招式帧**（第一版）：全量测试 5 条腿红在 3 个文件——奥斯塔拉那记落点迟
 *   83.33ms（5.0 tick）、恩希尔迟 89.86ms（5.4 tick），而 §2.1 的容差是 50ms。补帧把**收势**那一
 *   tick 找回来了，迟到的却不是收势，是**窗尾**：按停几格就等于把可命中段在世界时间里拉长几格，
 *   而玩家背的正是"落点在第几拍"。这条否掉。
 * - **出手方整侧豁免**（第二步的口径）：§2.1 全绿，但 §9 那半句「冻结攻守双方」只剩守方；而「格挡 45」
 *   「完美格挡 90」两行压根没有守方载体（格挡中的玩家不进硬直），于是那两行只喂了相机一个数。
 * - **窗尾之后按、收势之前用双格步还账**（现行口径）：§2.1 全绿，那两行情境停顿也第一次有了玩法落点。
 *   代价由数据自己报：收势比窗尾晚不到三帧的招式（错拍步那一类）一格也按不住，见 `ActionFrames` 判据 4。
 *
 * 于是本作的口径写成一句：**停顿按在"这一记"的双方身上——守方是硬直倒数，攻方是招式帧；
 * 攻方那几格整段落在判定窗之后、收势之前，所以窗长与净时长都不被改写。**
 *
 * 时长只有一个来源：那一格的 `frames.hitStopMs`（§55）或 §9 情境表里的一个数，与相机吃的是同一个。
 * 第四步（KI-017②，2026-09-25）之后，情境表那四个数住在 `player.json.hitStop` 而不是住在
 * `CombatManager.ts` —— 所以本文件的期望值一律从 `playerBase.hitStop` 读，而"读到的就是表里那个"
 * 由最后那一条 describe 用**改表法**钉死（把表改成别的数，行为跟着变 ⇒ 代码里没有第二个数）。
 * 每一把尺子都配一条 `hitStopMs: 0` 的对照腿（两跑只差那一个数），
 * 所以"多撑了几格"量的是停顿本身，不是弹道要飞几 tick、也不是硬直倒数本身多久走一格。
 * 攻方那几条腿各带一条"账本必须是 0"的反证（挥空、弹体离手），否则"净时长没变"绿在没人被按停上。
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

describe('§9 守方那一半：停顿按在挨打的那一方（KI-017 第二步）', () => {
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
    // §9 是"情境"表：「玩家受击」那一行不看攻击者招式自己那一格（这里传进去的 90 是干扰项）
    expect(hit.reported, '受击那一下的时长住在情境表里，不是招式表里').toBe(playerBase.hitStop.hurtMs)
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

/** 一次出手的完整账：整式走了几 tick、判定窗被采到几格、出手方账本上最多挂过几格、真正停在哪几格 */
type Move = { ticks: number; window: number; holdsAt: number[]; stopped: number; travel?: number }

/**
 * 每 tick 采一次时标。三格账要分开看：
 * - `window` = 判定窗被采到的格数，也就是这一式「露着刀」在世界时间里待了多久；
 * - `holdsAt` = 时标原地不动的那几格，也就是停顿**兑现**的地方；
 * - `stopped` = 账本挂过的最大格数。
 * 后两条不等于一条：账在窗内接触那一格就写上了，兑现排在窗尾之后。只断言「窗内账本非零」会把
 * 现行口径读成"窗内被按停过"，只断言「账本非零」又量不到停顿到底落在哪——两格都要分开看。
 */
function sample(current: () => { tick: number; stopTicks: number; stopDebt: number } | null | undefined, f: { activeStart: number; activeEnd: number }, step: () => void, cap = 400): Move {
  const seen: number[] = []
  let stopped = 0
  for (let i = 0; i < cap && current(); i++) {
    const a = current()!
    seen.push(a.tick)
    stopped = Math.max(stopped, a.stopTicks + a.stopDebt)
    step()
  }
  const inWin = seen.filter((t) => t >= f.activeStart && t <= f.activeEnd)
  const holdsAt: number[] = []
  for (let i = 1; i < seen.length; i++) if (seen[i] === seen[i - 1]) holdsAt.push(seen[i])
  return { ticks: seen.length, window: inWin.length, holdsAt, stopped }
}

describe('§9 攻方那一半：停顿落在窗尾之后，收势之前还清（KI-017 第三步）', () => {
  it('打中人不比挥空多花一 tick —— 而那一记确实被按停过（否则这条绿在空集上）', () => {
    const swing = (hitSomething: boolean): Move => {
      const w = makeWorld()
      let e: Enemy | null = null
      if (hitSomething) e = w.pin(w.ai.spawn(FOE, { ...FOE_POS }, 'in'))
      faceAt(w, e ? e.pos : { x: 0, y: 0, z: -40 })
      w.player.stats.stamina = w.player.stats.staMax
      w.frame.edges.add('attackLight')
      const from = { ...w.player.pos }
      w.tick() // 这一 tick 把那一式起出来
      const started = w.player.action
      expect(started, '这一记根本没出手：量具失效').toBeTruthy()
      const f = started!.f
      const mv = sample(() => w.player.action, f, () => w.tick())
      // 前冲的落点：停顿与还债都落在这条带里，所以带内走过的帧数不该变（§56 那套位移与 §9 对账）
      mv.travel = Math.hypot(w.player.pos.x - from.x, w.player.pos.z - from.z)
      if (hitSomething) expect(w.hits.some((h) => h.victimId === e!.id), '这一记要真落在她身上').toBe(true)
      else expect(w.hits.length, '挥空那条腿必须一个命中都没有').toBe(0)
      w.off()
      return { ...mv }
    }
    const air = swing(false)
    const contact = swing(true)
    expect(air.ticks, '量具失效：挥空都没有时长').toBeGreaterThan(0)
    expect(air.stopped, '挥空没有人可打 ⇒ 出手方一格都不该被按停').toBe(0)
    expect(contact.stopped, '出手方的账本整场是 0 ⇒ freezeAction 没接线，下面两条不变量在自证空集').toBeGreaterThan(0)
    expect(contact.ticks, '打中人把这一记拉长了 ⇒ 欠的债没在收势之前还清（§2.1 收势拍位会跑）').toBe(air.ticks)
    expect(contact.window, '判定窗在世界时间里被拉长 ⇒ 迟到的是窗尾，不是收势').toBe(air.window)
    expect(contact.travel, '命中那一下吃掉了这一式的前冲：停顿与还债没有一起落在前冲带里').toBeCloseTo(air.travel ?? 0, 6)
    expect(air.travel ?? 0, '量具失效：这一记根本没有前冲，上面那条相等是空转').toBeGreaterThan(0)
  })

  it('弹体离手之后没有"正在出的那一记"：射手的招式帧一格不被按停，停顿只归守方', () => {
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
    const mv = sample(() => (e.attack === atk ? atk : null), atk.spec.frames, () => {
      e.stats.hp = e.stats.hpMax
      w.tick()
      if (e.stunStopTicks > 0) sawStop = true
    }, 6)
    expect(sawStop, '这一记根本没给她挂上停顿 ⇒ 上面那六步是空转').toBe(true)
    expect(mv.stopped, '她是这一记的**挨打方**，不是出手方：停顿按在她的硬直倒数上，不按在她正在挥的招式帧上').toBe(0)
    w.off()
  })

  it('盾面卡住那一记：完美格挡把 90ms 按在出手的敌人身上，而她的窗尾不动', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { ...FOE_POS }, 'guard')
    e.alertness = 100
    e.enter('combat')
    let atk: Enemy['attack'] = null
    for (let t = 0; t < 900; t++) {
      const p = w.player.pos
      w.player.yaw = Math.atan2(e.pos.x - p.x, e.pos.z - p.z)
      w.player.stats.hp = w.player.stats.hpMax
      e.stats.hp = e.stats.hpMax
      atk = e.attack
      // 前摇末段才按guard：早了会一直持盾，那条路走的是 `block` 而不是完美格挡窗
      if (atk && atk.tick === atk.spec.frames.startup - 3) w.frame.held.add('guard')
      w.tick()
      if (w.hits.some((h) => h.result === 'perfectBlock' && h.attackerId === e.id)) break
      atk = null
    }
    const blocked = w.hits.find((h) => h.result === 'perfectBlock' && h.attackerId === e.id)
    expect(blocked, '900 tick 没等到一次完美格挡：量具失效').toBeTruthy()
    expect(blocked!.hitStopMs, '§9「完美格挡」那一行读的是情境表').toBe(playerBase.hitStop.perfectBlockMs)
    expect(e.attack, '完美格挡把那一招收掉了 ⇒ 攻方没有载体，这条量具读的是空气').toBe(atk)
    const f = atk!.spec.frames
    // 逐 tick 钉住架势与血量：碎甲会把这一收掉，那条路不是本条要量的东西
    const mv = sample(() => (e.attack === atk ? atk : null), f, () => {
      e.stats.hp = e.stats.hpMax
      e.stats.poiseAccum = 0
      e.stats.crumpleTicksLeft = 0
      w.tick()
    })
    expect(mv.stopped, '那一行的时长没按到她正在挥的那一记上 ⇒ 「完美格挡」仍然只喂了相机').toBe(msToTicks(playerBase.hitStop.perfectBlockMs))
    expect(mv.holdsAt.length, f.recovery - f.activeEnd - 1 + ' 帧的收势装不下 90ms 的债 ⇒ 判据 4 该把这一式整式豁免').toBeGreaterThan(0)
    for (const t of mv.holdsAt) expect(t, '停顿兑现的那一格落在了判定窗里 ⇒ 她的窗尾被推开，而 §2.1 量的正是这一格').toBeGreaterThan(f.activeEnd)
    w.off()
  })
})

describe('§9「弹反成功」那一行：被弹反的人就是此刻挨打的那一方', () => {
  it('弹反那一下把她失音的硬直多按住 msToTicks(120) 格', () => {
    // 弹反这一路不需要对照腿：情境时长不住在招式帧里，测试也没有办法把它调成 0（改表那一腿在上面）；
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
    expect(reported, '§9「弹反成功」那一行读的是情境表').toBe(playerBase.hitStop.parryMs)
    expect(held, '弹反那一行的时长确实按住了她的硬直（否则这条在自证空集）').toBeGreaterThan(0)
    expect(held, '事件报的那一格就是被按住的格数').toBe(msToTicks(reported))
  })
})

describe('§9 的四行只有一个来源：改表就改行为（KI-017 第四步）', () => {
  /** 表本身先立着：这四行是 combat.md §9 的那四行，改了表就是改了设计（序关系由验证器挡） */
  it('表没被搬空：四行都在，且和 §9 那张表对得上', () => {
    expect(playerBase.hitStop).toEqual({ hurtMs: 80, blockMs: 45, perfectBlockMs: 90, parryMs: 120 })
  })

  /**
   * 「一个数喂四处」最硬的反证不是读数等于表值（那可能两边都写死同一个数），而是
   * **把表改掉，行为跟着改**。这里只动表：同一套出手、同一个敌人、同一个 RNG，
   * 差出来的格数必须正好是两档时长之差。
   */
  it('玩家受击：按住硬直的格数跟着表跑，不跟着代码里那个旧常数跑', () => {
    const run = (hurtMs: number): { reported: number; held: number } => {
      const saved = playerBase.hitStop.hurtMs
      playerBase.hitStop.hurtMs = hurtMs
      try {
        const w = makeWorld()
        w.pin(w.ai.spawn(FOE, { x: 0, y: 0, z: -30 }, 'table'))
        faceAt(w, { x: 0, y: 0, z: -30 })
        // 招式自己那一格（90）故意与表不同：读数是 80/200 而不是 90，才说明情境表赢了招式表
        shoot(w, w.player.pos, STOP, true)
        const moves = ticksUntilStunMoves(w, () => w.player.stunTicks, () => w.hits.some((h) => h.victimId === 'player'))
        const out = { reported: reportedStop(w, (h) => h.victimId === 'player'), held: moves - 1 }
        w.off()
        return out
      } finally {
        playerBase.hitStop.hurtMs = saved
      }
    }
    const asTable = run(80)
    const asEdited = run(200)
    expect(asTable.reported, '读到的就是表里那一格').toBe(playerBase.hitStop.hurtMs)
    expect(asTable.held).toBe(msToTicks(80))
    expect(asEdited.reported, '改了表却没改行为 ⇒ 代码里还藏着第二个数').toBe(200)
    expect(asEdited.held - asTable.held, '按住格数的差 = 两档时长之差').toBe(msToTicks(200) - msToTicks(80))
    expect(playerBase.hitStop.hurtMs, '量具不动生产数据：跑完要还原').toBe(80)
  })

  /**
   * §9「命中被格挡 45ms」这一行到昨天为止只喂了相机一个数：格挡中的玩家不进硬直（守方无载体），
   * 攻方载体是第三步才接上的。所以这条腿量的是**出手那一方**的招式帧账本，同时钉住
   * 「45 短于 80」这一格设计意图在行为上也成立。
   */
  it('盾面吃下那一记：45ms 按在出手的人身上，而硬吃那一记按 80ms', () => {
    const w = makeWorld()
    const e = w.ai.spawn(FOE, { ...FOE_POS }, 'block')
    e.alertness = 100
    e.enter('combat')
    let atk: Enemy['attack'] = null
    for (let t = 0; t < 1500; t++) {
      const p = w.player.pos
      w.player.yaw = Math.atan2(e.pos.x - p.x, e.pos.z - p.z)
      w.player.camYawRef = Math.PI + w.player.yaw
      w.player.stats.hp = w.player.stats.hpMax
      w.player.stats.stamina = w.player.stats.staMax // 盾不该先被掏空：这一腿量的是停顿不是体力
      e.stats.hp = e.stats.hpMax
      // 早按：持盾超过完美格挡窗才落判定 ⇒ 走 `block` 那条出口
      w.frame.held.add('guard')
      atk = e.attack
      w.tick()
      if (w.hits.some((h) => h.result === 'block' && h.attackerId === e.id)) break
      atk = null
    }
    const blocked = w.hits.find((h) => h.result === 'block' && h.attackerId === e.id)
    expect(blocked, '1500 tick 没等到一次格挡：量具失效').toBeTruthy()
    expect(blocked!.hitStopMs, '§9「命中被格挡」那一行读的是表，不是招式帧').toBe(playerBase.hitStop.blockMs)
    expect(atk, '格挡把那一招收掉了 ⇒ 攻方没有载体，这条量具读的是空气').toBeTruthy()
    const f = atk!.spec.frames
    const mv = sample(() => (e.attack === atk ? atk : null), f, () => {
      e.stats.hp = e.stats.hpMax
      e.stats.poiseAccum = 0
      e.stats.crumpleTicksLeft = 0
      w.frame.held.add('guard')
      w.player.stats.stamina = w.player.stats.staMax
      w.tick()
    })
    expect(mv.stopped, '45ms 没按到她正在挥的那一记上 ⇒ 这一行仍然只喂了相机').toBe(msToTicks(playerBase.hitStop.blockMs))
    expect(playerBase.hitStop.blockMs, '这一格的设计意图：盾上那一下比身上那一下短').toBeLessThan(playerBase.hitStop.hurtMs)
    for (const t of mv.holdsAt) expect(t, '停顿兑现的位置：判定窗之后（§2.1 的窗长不动）').toBeGreaterThan(f.activeEnd)
    w.off()
  })
})

describe('KI-017③ 裁决：破防不领 §9 的停顿格，领的是 §10 的慢放', () => {
  /**
   * §9 没给破防一行——裁决是**不加**（不把表没给过的数伪装成设计）。破防的时间演出住在
   * §10「破防/被破势」那行的附加格「0.3s 慢放 ×0.75」，这条腿既是它的实现也是它的证人：
   *  spying 读到相机时标被要了一次 `(0.3, 0.75)`，而 §9 自己的三格账（事件的 `hitStopMs`、
   * 守方 `stunStopTicks`、攻方载体）**全是零** —— 谁日后往这条路上塞一次 hitstop，这条先红。
   */
  function driveGuardBreak(w: World): { asked: Array<[number, number]>; event: Hit | undefined } {
    const asked: Array<[number, number]> = []
    const orig = w.time.hitStop.bind(w.time)
    w.time.hitStop = (sec: number, scale = 0.05): void => { asked.push([sec, scale]); orig(sec, scale) }
    w.pin(w.ai.spawn(FOE, { x: 0, y: 0, z: -30 }, 'break'))
    faceAt(w, { x: 0, y: 0, z: -30 })
    w.frame.held.add('guard')
    w.tick(8) // 持盾越过完美格挡窗（5 格）才落判定 ⇒ 走格挡那条出口，而不是完美格挡
    w.player.stats.stamina = 1 // 盾面这一记要 3.6 点体力：掏空 ⇒ 破防
    shoot(w, w.player.pos, STOP, true)
    for (let i = 0; i < 30 && !w.hits.some((h) => h.victimId === 'player'); i++) w.tick()
    return { asked, event: w.hits.find((h) => h.victimId === 'player') }
  }

  it('破防那三格住在表里：600ms 踉跄 + 300ms ×0.75 慢放，与 §5.1/§10 对得上', () => {
    expect(playerBase.guard.breakStunMs).toBe(600)
    expect(playerBase.guard.breakSlowMs).toBe(300)
    expect(playerBase.guard.breakSlowScale).toBe(0.75)
  })

  it('真破防一次：踉跄格数由表派生，相机被要了一次慢放，而 §9 的三格账全是零', () => {
    const w = makeWorld()
    const { asked, event } = driveGuardBreak(w)
    expect(w.player.exhausted, '前提：这一记真的打穿了盾').toBe(true)
    expect(event, '弹体没落到玩家身上：这条在量空气').toBeTruthy()
    expect(w.player.stunTicks, '§5.1 的 600ms 大踉跄 = msToTicks(表值)，不是代码里那个 36').toBe(msToTicks(playerBase.guard.breakStunMs))
    expect(asked, '这一路只有一次时标请求：§10 的那次慢放').toEqual([[playerBase.guard.breakSlowMs / 1000, playerBase.guard.breakSlowScale]])
    expect(event!.hitStopMs, '事件声称有 §9 停顿 ⇒ 与裁决矛盾（慢放不是停顿）').toBe(0)
    expect(w.player.stunStopTicks, '守方那一格停顿压根不该被挂上').toBe(0)
    w.off()
  })

  it('改表就改行为：踉跄格数与慢放的那一(秒, 比例)都跟着 guard 那三格走', () => {
    const saved = { ...playerBase.guard }
    playerBase.guard.breakStunMs = 200
    playerBase.guard.breakSlowMs = 900
    playerBase.guard.breakSlowScale = 0.4
    try {
      const w = makeWorld()
      const { asked, event } = driveGuardBreak(w)
      expect(event, '弹体没落到玩家身上：这条在量空气').toBeTruthy()
      expect(w.player.stunTicks, '改了表却没改踉跄长度 ⇒ 代码里还藏着第二个数').toBe(msToTicks(200))
      expect(asked, '慢放的那一格也要跟着表跑').toEqual([[0.9, 0.4]])
      w.off()
    } finally {
      Object.assign(playerBase.guard, saved)
    }
    expect(playerBase.guard.breakStunMs, '量具不动生产数据：跑完要还原').toBe(600)
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
