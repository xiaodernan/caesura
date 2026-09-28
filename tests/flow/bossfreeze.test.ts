import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { RpgRuntime } from '@/rpg/Runtime'
import { movementConfig } from '@/rpg/Movements'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-037 第二步登记的那件「未评审」：**休止斩把 Boss 的节拍按住 48/60/72 tick，她自己的拍速
 * 与 §2.1 那条唯一硬约束会不会因此打架**（奥斯塔拉 108 / 恩希尔 92 的 `clockOwner` 拍长，加上
 * §14.5 的拍隙走的是**世界**网格、她的谱面走的是**她**的网格）。
 *
 * 结论是量出来的，不是推出来的：两世界同一段交战（一世界不冻、一世界在她出手中途冻一次），
 * 每一招收势帧那一 tick 记一次「离声明拍位差几 tick」。读数（3000 tick 窗口）：
 *   奥斯塔拉 P1：误差 对照 5.6ms / 冻结 5.6ms，出手次数 22 / 22
 *   恩希尔 P1：误差 对照 8.0ms / 冻结 8.0ms，出手次数 10 / 10
 *   恩希尔 P2（夺拍）与万籁（无网格领域）见下面两条用例
 * 也就是：**冻结把她推后了，但没有把她推离拍位**。原因是她的排招不是"上一招收势后立刻接下一招"，
 * 而是去抢一个**拍位槽**（`slotTaken(bar_beat)`），所以时间被拿走之后她等的是下一个空槽，落点仍然
 * 量化在她自己声明的那一拍上；被拿走的 48 tick 是玩家净赚的空白，不会以"她的谱面散掉"为代价。
 * 下面断言的是这个不变量，而不是某一版的巧合数字：容差用 §2.1 的 50ms，并且钉住"冻结那一世界
 * 的误差不超过对照那一世界"。
 */

registerGameData()

const CAESURA = 'mv_caesuracut'
const toMs = (ticks: number): number => (ticks / TICK_HZ) * 1000
/** §2.1 唯一那条硬约束的容差 */
const TOLERANCE_MS = 50

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout()) // 与 main.ts 的 refreshRpg 同一个口径
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999
  const offs = [bus.on('ui.notify', () => { /* 本文件不听提示，只要不泄漏监听 */ })]

  function tick(n = 1, each?: () => void): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset() // 拍钟不跟 hitStop 走（KI-017 第一步的口径）
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      player.stats.hp = player.stats.hpMax
      player.stats.stamina = player.stats.staMax
      player.stunTicks = 0
      player.crumpleTicks = 0
      player.stats.muteTicksLeft = 0 // 闷音会封战技（§11）：本文件要读的是拍位，不是这条
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      each?.()
      rhythm.update(TICK_DT)
    }
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, rpg, player, ai, combat, frame, tick, off }
}
type World = ReturnType<typeof makeWorld>

/** 点亮乐章 IV、装进槽 0、按 main.ts 的口径灌给玩家；返回输入动作名 */
function equipCaesura(w: World): string {
  const book = w.rpg.moves
  const mv = movementConfig().movements.find((m) => m.id === CAESURA)
  if (!mv) throw new Error('movements.json 里没有休止斩：本文件的尺子失效')
  const page = book.page(mv.page)!
  // 乐章 IV 的解锁源是旗标（KI-037 改判）：这里的 harness 只关心休止斩本身，
  // 「恩希尔终段」的写方是 worldstate 的 bossDefeated 规则（数据对账在验证器），此处等价地让它发生
  bus.emit('world.flag', { key: 'flag.hersil_felled', value: true })
  if (page.unlock?.item) w.rpg.inv.add(page.unlock.item, page.unlock.count ?? 0)
  expect(book.unlockPage(page.id, w.rpg.inv).ok).toBe(true)
  for (let i = 0; i < 40 && w.rpg.prog.rank < book.slotRank(0)!; i++) w.rpg.prog.addResonance(400)
  expect(book.equip(0, CAESURA, w.rpg.prog.rank).ok).toBe(true)
  w.player.applyRpg(w.rpg.mods())
  w.player.setSkills(w.rpg.skillLoadout())
  return book.cfg.slots[0].action
}

type Start = { id: string; atTick: number; offTicks: number }

/**
 * 跑一段交战，每次出手在**收势帧那一 tick**记一次离声明拍位的误差。
 * `key` 非空 ⇒ 在她第一次出手的中途真打一发休止斩（走 `tryStartAction`，不是手搓 `frozenTicks`）。
 * 敌人当"死不了的量具"（每 tick 顶满血），因为这条要量的是 3000 tick 的谱面，不是击杀。
 */
function runScore(w: World, bossId: string, pos: Vec3, key: string | null, ticks: number, toPhase2 = false): { starts: Start[]; froze: boolean; frozenTicksSeen: number; frameAdvanceWhileFrozen: number } {
  const e = w.ai.spawn(bossId, { ...pos }, 'grid')
  e.skipIntro()
  e.alertness = 100
  e.enter('combat')
  const starts: Start[] = []
  let cast = false
  let froze = false
  let p2 = !toPhase2
  let frozenTicksSeen = 0
  let frameAdvanceWhileFrozen = 0
  let frameAtFreezeStart: number | null = null
  w.tick(ticks, () => {
    const a = e.attack
    if (a && a.tick === a.spec.frames.activeStart && a.spec.onGrid !== false) {
      starts.push({ id: a.spec.id, atTick: w.time.tick, offTicks: w.rhythm.offsetFromBeatGrid(a.spec.beat) })
    }
    if (key && !cast && starts.length > 0) {
      // 每一 tick 都重试：她那一招收势的时刻，玩家可能正好挨了她自己的一记而忙于硬直，
      // 那与本次评审无关（要读的是"冻住之后她的拍位还在不在网格上"）
      const p = w.player
      p.stats.hp = p.stats.hpMax
      p.stunTicks = 0; p.crumpleTicks = 0; p.stats.muteTicksLeft = 0
      p.stats.overdrive = 99
      if (p.tryStartAction(key, w.time.tick)) cast = true
    }
    if (e.frozenTicks > 0) {
      froze = true
      frozenTicksSeen++
      if (e.attack) {
        if (frameAtFreezeStart === null) frameAtFreezeStart = e.attack.tick
        else frameAdvanceWhileFrozen += e.attack.tick - frameAtFreezeStart
      }
    } else frameAtFreezeStart = null
    if (!p2 && e.bossPhase >= 1) p2 = true
    e.stats.hp = e.stats.hpMax
    e.stats.dead = false
    if (toPhase2 && !p2 && e.bossPhase === 0 && w.time.tick > 300) e.stats.damage(Math.round(e.stats.hpMax * 0.5))
  })
  if (toPhase2) expect(e.bossPhase, '没推进到 P2：这条读的是夺拍那一段').toBeGreaterThan(0)
  expect(starts.length, `${bossId} 在 ${ticks} tick 里一招收势都没读到：探针失效`).toBeGreaterThan(3)
  if (key) expect(cast, '休止斩始终没出手（被硬直/过载/闷音反复挡掉）：本用例前提失效').toBe(true)
  expect(froze, key ? '休止斩没冻住她：这条量的不是冻结' : '对照组不该出现冻结').toBe(key !== null)
  return { starts, froze, frozenTicksSeen, frameAdvanceWhileFrozen }
}

const worstMs = (starts: Start[]): number => toMs(Math.max(0, ...starts.map((s) => s.offTicks)))

const BOSSES: Array<{ id: string; pos: Vec3; label: string }> = [
  { id: 'en_ostlara', pos: { x: 0, y: -40, z: -6 }, label: 'Mini Boss · 108 私有拍速' },
  { id: 'en_hersil', pos: { x: 0, y: 152, z: -6 }, label: 'Main Boss · 92 私有拍速' },
]

describe('§2.1 跨过一次休止斩仍然成立：Boss 的收势帧不会被推离拍位（KI-037 第二步登记项）', () => {
  for (const b of BOSSES) {
    it(`${b.id}（${b.label}）：冻结那一世界的误差不超过对照那一世界`, () => {
      const cw = makeWorld()
      const clean = runScore(cw, b.id, b.pos, null, 3000)
      const fw = makeWorld()
      const key = equipCaesura(fw)
      const frozen = runScore(fw, b.id, b.pos, key, 3000)
      expect(worstMs(clean.starts), '对照那一世界本来就该踩拍').toBeLessThanOrEqual(TOLERANCE_MS)
      expect(worstMs(frozen.starts), '冻结不能把她的谱面推离拍位').toBeLessThanOrEqual(TOLERANCE_MS)
      // 她的拍长是 108BPM 那种除不尽的数，误差本身带浮点尾差 ⇒ 比"不超过对照"要说得准：差一毫秒以内算一样
      expect(worstMs(frozen.starts) - worstMs(clean.starts), '冻结不能让她比对照更脱拍')
        .toBeLessThan(1)
      // 出手次数：她等的是下一个空槽，不是"少打一招"。允许 ±1 的边界效应（窗口末端那一招被切掉）
      expect(Math.abs(clean.starts.length - frozen.starts.length), '一次 48 tick 的冻结不该改她的出手密度')
        .toBeLessThanOrEqual(1)
      cw.off(); fw.off()
    })
  }

  it('万籁不在这次评审的范围内，而且是数据说过的：她一招收势都不落拍（§15.3 的无拍点身份）', () => {
    const d = registry.get<import('@/data/schema').EnemyData>('en_myriad')
    expect(d.attacks.length, '她有自己的招式表').toBeGreaterThan(0)
    expect(d.attacks.every((a) => a.onGrid === false), '她的每一招都显式声明「不量化到网格」')
      .toBe(true)
    expect(d.boss?.bpm, '她也不接管网格：无网格领域里没有拍速可接管').toBeUndefined()
    // ⇒ "冻结会不会把她的谱面推离拍位"这一问在她身上没有对象。她的时间被拿走之后剩下的仍然是
    // 原来那件唯一要紧的事：她靠声音找人（§15.3，`myriad.test.ts` 那一节钉着）。
  })

  it('恩希尔 P2「夺拍」那一段：冻结也不改他换气拍的落位', () => {
    const cw = makeWorld()
    const clean = runScore(cw, 'en_hersil', { x: 0, y: 152, z: -6 }, null, 3600, true)
    const fw = makeWorld()
    const key = equipCaesura(fw)
    const frozen = runScore(fw, 'en_hersil', { x: 0, y: 152, z: -6 }, key, 3600, true)
    const breath = (s: Start[]): number => s.filter((x) => x.id === 'breath').length
    expect(breath(clean.starts), 'P2 里读到过换气拍（否则这条在量空气）').toBeGreaterThan(0)
    expect(Math.abs(breath(clean.starts) - breath(frozen.starts)), '换气拍窗口的次数不被一次冻结改变').toBeLessThanOrEqual(1)
    expect(worstMs(frozen.starts)).toBeLessThanOrEqual(Math.max(worstMs(clean.starts), TOLERANCE_MS))
    expect(cw.rhythm.bpm, '他接管了全场网格（读的是他的拍长，不是区域基准）').toBe(92)
    expect(fw.rhythm.bpm).toBe(92)
    cw.off(); fw.off()
  })

  it('冻结吃掉的是她自己的帧，不是她的拍位：停顿期间她的招式纹丝不动，节奏词汇也没变', () => {
    /**
     * 这一步真正读出来的东西：休止斩拿走 48 tick，她**少打了这几十 tick 的自己的帧**（下面第一条
     * 断言），但她的排招是去抢一个拍位槽（`slotTaken(bar_beat)`）而不是"收招即出手"，所以谱面只是
     * 被平移、没被改写（第二条断言：两世界的间隔取值集合相同，冻结没有发明出第三种节奏）。
     * 一句话：玩家那 48 tick 是净赚的，付出的代价是她的时间，而不是 §2.1 那条承诺。
     */
    const cw = makeWorld()
    const clean = runScore(cw, 'en_ostlara', { x: 0, y: -40, z: -6 }, null, 2400)
    const fw = makeWorld()
    const key = equipCaesura(fw)
    const frozen = runScore(fw, 'en_ostlara', { x: 0, y: -40, z: -6 }, key, 2400)
    expect(frozen.frozenTicksSeen, '休止斩那一格确实按住了她几十 tick')
      .toBeGreaterThanOrEqual(fw.player.skills[key].cast.freezeTicks)
    expect(frozen.frameAdvanceWhileFrozen, '被按住的期间她的招式帧一格也没走（这才是"时间被拿走"）').toBe(0)
    const g = (r: typeof clean): number[] => r.starts.slice(1).map((x, i) => x.atTick - r.starts[i].atTick)
    const g0 = g(clean)
    const g1 = g(frozen)
    expect(g0.length, '两边都读到足够长的谱面').toBeGreaterThan(6)
    const beat = (60 / 108) * TICK_HZ // 奥斯塔拉的私有拍长：108BPM ⇒ 一拍 33.33 tick
    // 冻结不会让她出手得更早（那才是"时间被还给她"），也不会把她推出整拍之外的节奏
    expect(Math.min(...g1), '没有哪个间隔被压缩：她不可能比自己的谱面更早出手').toBeGreaterThanOrEqual(Math.min(...g0) - 1)
    expect(Math.max(...g1) - Math.max(...g0), '被拉长的那一段最多是她错过一两个槽（整拍的倍数），不是新节奏')
      .toBeLessThanOrEqual(Math.round(beat * 2))
    // 实测到这里：对照 {100,133,167} / 冻结 {100,133,167,200} —— 200 = 167 + 一拍（33.3）
    // 也就是说这一次 48 tick 的冻结让她错过一个槽，代价是一拍，而不是把整张谱面推离拍位。
    expect(Math.abs(g1.length - g0.length), '一次冻结不该改变她的出手次数（超过一格）').toBeLessThanOrEqual(1)
    cw.off(); fw.off()
  })
})
