import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, msToTicks } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, reactions, movesetsRaw } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-052①：§8 受击反应分级第一次有**行为**承载体。
 *
 * KI-050 那次只把两个数搬进表里（玩家受击那一行的 R1、破势的 R4），并留下一句诚实的账：
 * 「R0/R2/R3/R5 与招式帧 `reaction` 分级的敌人侧受击硬直没有承载体，所以不入表」。
 * 这一批把那句话反过来说完：**分级有了腿，于是那几行可以有数**。
 *
 * 每条腿负责说出承载体在哪，以及它**不**在哪：
 * - R1（轻击）对敌人**什么都不接管**：不给硬直、不迁移位置——§8 那一行的原文是「不打断重击与蓄力」，
 *   而"每一记轻击推 0.2m"在灰盒里会累加成一笔距离税（实测把 KI-039 的高甲量具从 1.45 顶到 2.10）。
 *   它只兑现"这一记穿进了护层"那一声确认（R0 的材质发光）。
 * - R2（重击 / 战技）把 `stunTicks` 挂上 ⇒ `Enemy.update` 在硬直那一支把 `attack` 收掉。
 * - R3 只能由**招式帧点名**（§4.2 强音大剑跳劈「附加击倒 R3」），kind 轴永远给不出它。
 * - 三条豁免各有证人：Boss（背谱判据）、破势中（R4 是这段时间的主人）、弹体（位移不被弹速放大）。
 *
 * 期望值一律从 `reactions` 现读再换算，不手算；"读到的就是表里那个"由改表法腿钉死。
 */

registerGameData()

const subs: Array<() => void> = []
afterEach(() => { for (const f of subs.splice(0)) f() })

const FOE = 'en_tympanus'
const BOSS = 'en_ostlara'

type Hit = { victimId: string; damage: number; result: string }

function makeWorld(weaponId = 'wp_tuning_sword') {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
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
  subs.push(() => { for (const f of offs) f() })

  function tick(n = 1, each?: () => void): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      each?.()
      rhythm.update(TICK_DT)
    }
  }

  /** 玩家贴到它身前并朝它站着（近战判定锥在身前） */
  const standAt = (e: Enemy, dist = 1.6): void => {
    player.pos.x = e.pos.x
    player.pos.z = e.pos.z + dist
    player.pos.y = e.pos.y
    player.yaw = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, standAt }
}
type W = ReturnType<typeof makeWorld>

/** 命中那一 tick 的读数：位移（表里那格）、硬直格数、材质发光时长 */
interface Landed { moved: number; stun: number; flash: number }

/**
 * 量具口径：默认让它在 `idle` 里站着（这一 tick 不会自己挪步，位移因此全是这一记给的），
 * 玩家走**真出手通道**（`tryStartAction` ⇒ 帧表 ⇒ `playerHitsEnemies`），
 * 在 `combat.hit` 落地的同一 tick 停住读数——下一 tick 硬直就开始倒数了。
 */
function landOn(w: W, e: Enemy, key: 'l1' | 'h' | 'charged', opt: { state?: 'idle' | 'combat'; onEnter?: () => void } = {}): Landed | null {
  w.standAt(e)
  e.alertness = 0
  e.enter(opt.state ?? 'idle')
  opt.onEnter?.()
  w.player.stats.stamina = 100
  w.player.stats.hp = 9_999
  w.player.action = null
  w.player.roll = null
  w.player.stunTicks = 0
  if (!w.player.tryStartAction(key, w.time.tick, w.rhythm)) throw new Error(`出招失败：${key}`)
  const seen = w.hits.length
  let out: Landed | null = null
  for (let i = 0; i < 200 && !out; i++) {
    // 量具：每一 tick 把它按回 `idle`（并把警觉抹平）——它自己那一步（speed×dt≈0.02m）
    // 会混进位移读数里，而这条断言要量的是**表里那一格**。前摇测试不这么做：
    // 那一式得让它自己走完，被测的才是"断没断"。
    if ((opt.state ?? 'idle') === 'idle') { e.alertness = 0; e.enter('idle') }
    const before: Vec3 = { ...e.pos }
    w.tick(1, () => {
      if (out) return
      if (!w.hits.slice(seen).some((h) => h.victimId === e.id && h.result === 'hit')) return
      out = {
        moved: Math.hypot(e.pos.x - before.x, e.pos.z - before.z),
        stun: e.stunTicks,
        flash: e.coreFlash,
      }
    })
  }
  return out
}

/** 静止量具：血与架势拉到打不死、破不了势，被测的只有"挨这一记之后它身上多了什么" */
function dummy(w: W, id: string, z = -8, seed = 'rg'): Enemy {
  const e = w.ai.spawn(id, { x: 0, y: 0, z }, seed)
  e.stats.hp = 1e7
  e.stats.poiseMax = 1e7
  e.stats.crumpleTicksLeft = 0
  return e
}

describe('KI-052① 表：§8 的 R0/R1/R2/R3 四档逐格对得上，且只有有腿的行进门', () => {
  it('R0=150ms 发光、R1=200ms/0.2m、R2=350ms/0.5m、R3=600ms/2m（combat.md §8 原数）', () => {
    expect(reactions.R0.flashMs).toBe(150)
    expect([reactions.R1.stunMs, reactions.R2.stunMs, reactions.R3.stunMs]).toEqual([200, 350, 600])
    expect([reactions.R1.displaceM, reactions.R2.displaceM, reactions.R3.displaceM]).toEqual([0.2, 0.5, 2])
    expect([msToTicks(reactions.R1.stunMs), msToTicks(reactions.R2.stunMs), msToTicks(reactions.R3.stunMs)],
      '§8 同一行给的两种单位必须互相对得上（200ms/12f…）').toEqual([12, 21, 36])
    expect(Object.keys(reactions).sort(), 'R5 浮空没有承载体：不许进表（§55）').toEqual(['R0', 'R1', 'R2', 'R3', 'R4'])
  })

  it('玩家架式表里只有强音大剑的跳劈声明了 reaction=R3——§4.2 逐字点名的那一格，别的一律走重量轴默认', () => {
    const declared = movesetsRaw.flatMap((m) => Object.entries(m.actions)
      .filter(([, f]) => f.reaction !== undefined)
      .map(([k, f]) => `${m.id}.${k}:${f.reaction}`))
    expect(declared, '帧上点名档位的格子要数得出来（多一格就得说明是谁点的名）').toEqual(['ms_greatsword.jump:R3'])
  })
})

describe('KI-052① 腿：敌人受击第一次按档进硬直——三档各给各的数', () => {
  it('R1（轻击）：不给硬直、也不迁移位置——「颤身」原地发抖，"击退"才是 R3', () => {
    const w = makeWorld()
    const e = dummy(w, FOE)
    const got = landOn(w, e, 'l1')
    expect(got, '轻击没落到它身上：这条在量空气').toBeTruthy()
    expect(got!.stun, '§8 R1「不打断重击与蓄力」⇒ 轻击不接管这段时间').toBe(0)
    expect(got!.moved, '每一记轻击推 0.2m 会累加成 distance tax（实测把 KI-039 高甲量具顶到 2.10）').toBeCloseTo(0, 9)
    // 这一档的 displaceM 不是没人读：它的读者在玩家受击那一边（KI-050 的 takeDamage 腿）
    expect(reactions.R1.displaceM, 'R1 的米数仍住在表里，等"滑行走"的那条腿（KI-052②）').toBeGreaterThan(0)
    w.ai.despawn(e.id)
  })

  it('R2（重击）：硬直 = msToTicks(350)，位移 = 0.5m，两个数都从表里现读', () => {
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'rg2')
    const got = landOn(w, e, 'h')
    expect(got).toBeTruthy()
    expect(got!.stun).toBe(msToTicks(reactions.R2.stunMs))
    expect(got!.moved).toBeCloseTo(reactions.R2.displaceM, 9)
    w.ai.despawn(e.id)
  })

  it('R3 只能由帧声明给出来：给 l1 写上 reaction=R3，同一记轻击立刻变成 36 格 + 2m', () => {
    const frames = registry.get<MovesetData>('ms_sword').actions
    const saved = frames.l1.reaction
    frames.l1.reaction = 'R3'
    try {
      const w = makeWorld()
      const e = dummy(w, FOE, -8, 'rg3')
      const got = landOn(w, e, 'l1')
      expect(got).toBeTruthy()
      expect(got!.stun, '声明压过 kind 默认：轻击那一档不再生效').toBe(msToTicks(reactions.R3.stunMs))
      expect(got!.moved, 'R3 是唯一由帧点名的"击退"档，它才动位置').toBeCloseTo(reactions.R3.displaceM, 9)
      w.ai.despawn(e.id)
    } finally {
      if (saved === undefined) delete frames.l1.reaction
      else frames.l1.reaction = saved
    }
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'rg3b')
    const back = landOn(w, e, 'l1')
    expect(back!.stun, '还原后轻击重新只是 R1').toBe(0)
    w.ai.despawn(e.id)
  })

  it('改表就改行为：R2.stunMs 500 / displaceM 1.5，读数跟着走；还原回 21 / 0.5', () => {
    const saved = { ...reactions.R2 }
    reactions.R2.stunMs = 500
    reactions.R2.displaceM = 1.5
    try {
      const w = makeWorld()
      const e = dummy(w, FOE, -8, 'mut')
      const got = landOn(w, e, 'h')
      expect(got!.stun, '改了表却没改硬直 ⇒ 21 还藏在代码里').toBe(msToTicks(500))
      expect(got!.moved, '改了表却没改位移 ⇒ 0.5 还藏在代码里').toBeCloseTo(1.5, 9)
      w.ai.despawn(e.id)
    } finally {
      Object.assign(reactions.R2, saved)
    }
    expect(reactions.R2.stunMs).toBe(350)
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'mut2')
    const back = landOn(w, e, 'h')
    expect(back!.stun).toBe(21)
    expect(back!.moved).toBeCloseTo(0.5, 9)
    w.ai.despawn(e.id)
  })
})

describe('KI-052① 打断语义：那一式活没活下来才是 R1 与 R2 的分界', () => {
  /** 把它摆进自己那一式的前摇（挑 startup 最长的那一式，量具才不会自己走完），再看它这一式活没活下来 */
  function intoStartup(w: W, e: Enemy, key: 'l1' | 'h'): { same: boolean; gone: boolean } {
    const spec = [...e.data.attacks].sort((a, b) => b.frames.startup - a.frames.startup)[0]
    let mine: ReturnType<typeof newAttack> | null = null
    const got = landOn(w, e, key, {
      state: 'combat',
      onEnter: () => { mine = newAttack(spec, 2); e.attack = mine },
    })
    expect(got, `${key} 没打到它`).toBeTruthy()
    expect(mine, '前提：它被摆进了自己最长那一式的前摇').not.toBeNull()
    w.tick(2) // 硬直那一支在下一 tick 才把 attack 收掉
    return { same: e.attack === mine, gone: e.attack === null }
  }

  it('轻击打在前摇上：那一式活着（§8 R1「不打断重击与蓄力」）', () => {
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'it1')
    const r = intoStartup(w, e, 'l1')
    expect(r.same, '还是被摆进去的那一式 ⇒ R1 没没收它').toBe(true)
    expect(r.gone).toBe(false)
    w.ai.despawn(e.id)
  })

  it('重击打在前摇上：那一式作废（R2「中断一切非霸体」）——同一只敌人、只差出手的那一档', () => {
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'it2')
    const r = intoStartup(w, e, 'h')
    expect(r.same, 'R2 之后它手里不该还握着被断掉的那一式').toBe(false)
    expect(r.gone, '§7「前摇期间被打＝动作中断」仍没有落点').toBe(true)
    w.ai.despawn(e.id)
  })

  it('R1 的那半句落在读条上：打断警戒读条的硬直也读 R1 行（改表 500ms ⇒ 30 格）', () => {
    const saved = reactions.R1.stunMs
    reactions.R1.stunMs = 500
    try {
      const w = makeWorld()
      const e = dummy(w, 'en_hanged_knight', -14, 'cast')
      e.enter('alert')
      let cut = false
      for (let i = 0; i < 40 && !cut; i++) {
        w.tick(36, () => {
          if (cut) return
          if (e.attack?.spec.id === 'callAlly' && e.inStartup) { e.interruptBroadcast(w.time.tick); cut = true }
        })
      }
      expect(cut, '它一直不开警戒读条 ⇒ 这条在量空气').toBe(true)
      expect(e.stunTicks, '那一格 12 与 200ms 是同一个数的两种单位，写死就是给表造第二个主人')
        .toBe(msToTicks(500))
      w.ai.despawn(e.id)
    } finally {
      reactions.R1.stunMs = saved
    }
    expect(reactions.R1.stunMs).toBe(200)
  }, 20000)
})

describe('KI-052① 豁免与同一条腿的其他出口', () => {
  it('Boss 整条通道免疫：同一记重击打在奥斯塔拉身上，位置不动、硬直不给（背谱判据）', () => {
    const w = makeWorld()
    const boss = dummy(w, BOSS, -30, 'rgboss')
    const got = landOn(w, boss, 'h')
    expect(got, '重击没落到 Boss 身上：这条在量空气').toBeTruthy()
    expect(got!.stun, '§16/§2.1：她的招式不被逐式打断').toBe(0)
    expect(got!.moved, '把她推 0.5m 会改掉场地机关（撞钟）的距离判据').toBeCloseTo(0, 9)
    w.ai.despawn(boss.id)
  })

  it('破势中不再叠逐式硬直：R4（1.8s）是这段时间的主人，硬直不该把 recover 往后推', () => {
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'rgcrum')
    e.stats.crumpleTicksLeft = 60
    const got = landOn(w, e, 'h')
    expect(got).toBeTruthy()
    expect(got!.stun, '破势里再压 21 格硬直 = 把处决窗口的入场往后推').toBe(0)
    expect(got!.moved).toBeCloseTo(0, 9)
    w.ai.despawn(e.id)
  })

  it('投掷弹体走同一条通道，位移不被弹速放大（dir 里塞的是速度 ⇒ 必须先归一化）', () => {
    const w = makeWorld()
    const e = dummy(w, FOE, -10, 'rgpr')
    const before: Vec3 = { ...e.pos }
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: e.pos.x, y: e.pos.y + 1.0, z: e.pos.z + 6 },
      dir: { x: 0, y: 0, z: -1 }, speed: 28, range: 30, radius: 0.6,
      damage: 12, poise: 20, hitStopMs: 60, onBeat: false,
    }, w.time.tick)
    let hit = false
    for (let i = 0; i < 60 && !hit; i++) {
      w.tick(1, () => { if (w.hits.some((h) => h.victimId === e.id && h.result === 'hit')) hit = true })
    }
    expect(hit, '弹体没命中：这条在量空气').toBe(true)
    const moved = Math.hypot(e.pos.x - before.x, e.pos.z - before.z)
    expect(moved, '弹体走 kind=heavy ⇒ R2 的 0.5m；不归一化这里会是 28×0.5=14m')
      .toBeCloseTo(reactions.R2.displaceM, 6)
    w.ai.despawn(e.id)
  })
})

describe('KI-052① R0：材质发光第一次住在表里，而且看"架势破没破"', () => {
  it('未破势挨一记：coreFlash 恰好 = R0.flashMs 换算的秒数', () => {
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'fl1')
    const got = landOn(w, e, 'l1')
    expect(got).toBeTruthy()
    expect(got!.flash).toBeCloseTo(reactions.R0.flashMs / 1000, 9)
    w.ai.despawn(e.id)
  })

  it('破势那一记不再抖材质光：§8 R0 那格的原文是「架势未破，仅抖动材质发光」', () => {
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'fl2')
    e.stats.crumpleTicksLeft = 60
    const got = landOn(w, e, 'l1')
    expect(got!.flash, '破势里再闪一层光 = 把 R4 的演出抢走一半注意力').toBe(0)
    w.ai.despawn(e.id)
  })

  it('改表就改行为：flashMs 400 ⇒ 发光时长跟着走；还原回 0.15', () => {    const saved = reactions.R0.flashMs
    reactions.R0.flashMs = 400
    try {
      const w = makeWorld()
      const e = dummy(w, FOE, -8, 'fl3')
      const got = landOn(w, e, 'l1')
      expect(got!.flash, '改了表却没改发光 ⇒ 0.15 还写死在 onDamaged 里').toBeCloseTo(0.4, 9)
      w.ai.despawn(e.id)
    } finally {
      reactions.R0.flashMs = saved
    }
    expect(reactions.R0.flashMs).toBe(150)
    const w = makeWorld()
    const e = dummy(w, FOE, -8, 'fl4')
    expect(landOn(w, e, 'l1')!.flash).toBeCloseTo(0.15, 9)
    w.ai.despawn(e.id)
  })
})
