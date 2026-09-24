import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import { Rng } from '@/core/Math'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'

/**
 * Mini Boss 奥斯塔拉（docs/combat.md §15.1 + §16；需求 §22/§24）。
 * 夹具口径同 phantome/elite：rhythm.update(TICK_DT) + 每 tick time.reset()。
 * Boss 战对这条比小怪更敏感——她全部的可读性建立在「命中帧落在小节第 1 拍」上，
 * 而 hitStop 把 time.dt 压到 5%：拍钟若跟着 time.dt 走，帧表与拍网格当场脱钩。
 */

registerGameData()

/** 她的私有拍速：108BPM ⇒ 一拍 = 33.33 tick；3/4 拍 ⇒ 一小节 = 100 tick（§15.1 明文 1667ms） */
const BEAT = (60 / 108) * TICK_HZ
const BAR = BEAT * 3

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const greatsword = registry.get<WeaponData>('wp_fortissimo_greatsword')
  const player = new PlayerController(playerBase, greatsword, msOf(greatsword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  // Boss 战一跑上千 tick，玩家先当沙包：被测的是她的时序与机关，不是玩家的续航
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999

  const hits: Array<{ v: string; d: number }> = []
  const sfx: string[] = []
  const notifies: Array<{ t: string; kind?: string }> = []
  const phases: Array<{ id: string; phase: number; phases: number }> = []
  const muffles: boolean[] = []
  const offs = [
    bus.on('combat.hit', (p) => hits.push({ v: p.victimId, d: p.damage })),
    bus.on('audio.sfx', (p) => sfx.push(p.key)),
    bus.on('ui.notify', (p) => notifies.push({ t: p.text, kind: p.kind })),
    bus.on('boss.phase', (p) => phases.push(p)),
    bus.on('audio.muffle', (p) => muffles.push(p.on))
  ]

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

  /**
   * 站定挨打的一记。先 pin 她：她被击中会打断玩家的挥砍（takeDamage 清 action），
   * 那是另一条规则，别混进「这一记吃不吃壳」的测量里。
   * 方差只来自 combat.rng 的一次 float() ⇒ 种子摆回同一点，两次数就能直接比。
   */
  function strike(e: Enemy, key: 'l1' | 'charged' = 'l1'): number | null {
    pin(e)
    player.stats.stamina = 100
    player.action = null
    player.roll = null
    player.executing = null
    player.stunTicks = 0
    player.pos.x = e.pos.x
    player.pos.z = e.pos.z + 3
    player.pos.y = e.pos.y
    player.yaw = Math.PI
    combat.rng = new Rng('boss-variance')
    if (!player.tryStartAction(key, time.tick, rhythm)) throw new Error('出招失败')
    const seen = hits.length
    for (let i = 0; i < 150; i++) {
      tick()
      const h = hits.slice(seen).find((x) => x.v === e.id)
      if (h) return h.d
      if (!player.action) break
    }
    return null
  }

  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, strike, hits, sfx, notifies, phases, muffles, off }
}
type W = ReturnType<typeof makeWorld>

function ostlara(w: W, z = -3, seed = 'ostlara'): Enemy {
  return w.ai.spawn('en_ostlara', { x: 0, y: -40, z }, seed)
}

/** 真开打：入场演出（§16）由 `bossshow.test.ts` 负责，这里要的是她能立刻按帧表出招 */
function engage(w: W, e: Enemy): void {
  e.alertness = 100
  e.enter('combat')
  e.skipIntro()
}

/** 站定不还手（崩直 + recover）：把变量收敛到「这一记吃不吃壳」 */
function pin(e: Enemy): void {
  e.stats.crumpleTicksLeft = 600
  e.enter('recover')
}

/** 把她的招式摆到指定帧（绕开 RNG 选招，只看机关与结算） */
function forceAt(e: Enemy, id: string, tickIn: number): void {
  const spec = e.data.attacks.find((a) => a.id === id)!
  e.attack = newAttack(spec, tickIn)
}

/** 离「本小节第 1 拍」还有多少 tick（§15.1 的核心可读性就这一句） */
/** §2.1 的容差：50ms = 3 tick；量化是整数 tick，所以真误差应远小于它 */
const TOLERANCE_MS = 50

/**
 * 跑一段真 AI，统计：出现过哪些读条、每招收势帧落在小节第几拍、离第 1 拍最多多远。
 * 需求验收②「奥斯塔拉全招可被 BeatClock 对齐」就是这张表。
 */
function observe(w: W, e: Enemy, ticks: number): { seen: Set<string>; hitBeats: Record<string, number[]>; worstOff: number } {
  const seen = new Set<string>()
  const hitBeats: Record<string, number[]> = {}
  let worstOff = 0
  let prev: Enemy['attack'] = null
  w.tick(ticks, () => {
    const a = e.attack
    if (a && a !== prev) seen.add(a.spec.id)
    if (a && a.tick === a.spec.frames.activeStart) {
      // 量的是「命中帧离**它自己声明的那条拍网格**有多远」= §2.1 ±50ms 容差的真实量法。
      // 不看 beatInBar：量化取整 ±0.5 tick 会让小节线两侧各读出一个不同的拍号，那是假失败。
      const err = w.rhythm.offsetFromBeatGrid(a.spec.beat)
      hitBeats[a.spec.id] = [...(hitBeats[a.spec.id] ?? []), err]
      worstOff = Math.max(worstOff, err)
    }
    prev = a
  })
  return { seen, hitBeats, worstOff }
}

/** 她某一阶「会」的招式 = 白名单 + 由白名单那招 next 派生出的后续段 */
function closable(d: EnemyData, phase: number): Set<string> {
  const out = new Set<string>()
  for (const id of d.boss!.phases[phase].attacks) {
    out.add(id)
    let cur = d.attacks.find((a) => a.id === id)
    while (cur?.frames.next) {
      const nxt = cur.frames.next
      cur = d.attacks.find((a) => a.id === nxt)
      if (cur) out.add(cur.id)
    }
  }
  return out
}

describe('数据表：§15.1 的三阶段、钟壳与撞钟机关全部在 enemies.json 里', () => {
  const d = registry.get<EnemyData>('en_ostlara')

  it('骨架：miniboss / 420 血 / 120 架势 / 私有拍速 108BPM 3/4', () => {
    expect(d.archetype).toBe('miniboss')
    expect(d.hp).toBe(420)
    expect(d.poise).toBe(120)
    expect(d.boss?.bpm).toBe(108)
    expect(d.boss?.beatsPerBar).toBe(3)
    expect(d.boss?.phases.map((p) => p.id)).toEqual(['bellshell', 'twinfugue', 'greatbell'])
    expect(d.boss?.phases[1].belowHpFrac).toBe(0.6)
    expect(d.boss?.phases[2].belowHpFrac).toBe(0.25)
  })

  it('阶段是招式白名单而不是倍率：三阶互不相同、都指得到真招式', () => {
    const ids = new Set(d.attacks.map((a) => a.id))
    for (const p of d.boss!.phases) {
      for (const a of p.attacks) expect(ids.has(a), p.id + ' 引用了不存在的招式 ' + a).toBe(true)
    }
    const [p1, p2, p3] = d.boss!.phases.map((p) => new Set(p.attacks))
    expect(p1.has('bellsmash'), 'P1 不会拔钟').toBe(false)
    expect(p1.has('combo3a'), 'P1 也不会三连').toBe(false)
    expect(p2.has('pendulum') && p2.has('combo3a'), 'P2 加双剑狂板').toBe(true)
    expect(p3.has('swordchain1'), 'P3 已经不挥小剑').toBe(false)
    const smash = d.attacks.find((a) => a.id === 'bellsmash')!
    expect(smash.frames.startup, '两小节前摇 = 「假慢真远」').toBeGreaterThanOrEqual(Math.round(BAR * 2))
    expect(smash.frames.hitbox, 'r=5m 的落点').toEqual({ shape: 'ring', inner: 0, outer: 5, forward: 0 })
  })

  it('钟壳与机关：0.1 倍伤 + 架势免疫，撞 2 口钟才永久剥掉；残响每拍 4', () => {
    // fissureMul=2 是 combat.md §11 点名的「壳期最怕同频敲击」：碎裂在剥壳之前反而更疼
    expect(d.boss?.phases[0].shell).toEqual({ dmgMul: 0.1, immuneToPoise: true, fissureMul: 2 })
    const g = d.boss!.bells!
    expect(g.positions).toHaveLength(3)
    expect(g.releaseTicks / TICK_HZ, '§15.1「无敌解除 6s」').toBe(6)
    expect(g.breaksAt).toBe(2)
    expect(g.damagePerBeat, '对喧堕者每拍 4，对玩家 0').toBe(4)
    for (const p of g.positions) expect(p.y, '钟也站在本层地板上').toBe(-40)
  })

  it('奖励只挂在重拍那一击上；撞钟冲根本弹不了', () => {
    const by = new Map(d.attacks.map((a) => [a.id, a]))
    expect(by.get('swordchain1')!.parryStunTicks).toBe(72)
    expect(by.get('combo3a')!.parryStunTicks).toBe(72)
    expect(by.get('swordchain2')!.parryStunTicks, '后续段没有这份回报').toBeUndefined()
    expect(by.get('charge')!.parryable, '冲刺只能用场地解，不用反应解').toBe(false)
    expect(by.get('charge')!.frames.flags).toContain('charge')
  })
})

describe('私有拍速：她进战接管全场网格，脱战/死亡都得还回去', () => {
  it('84/4 → 交战 108/3；死后归还 84/4（不留「Boss 死了节拍还停在 108」的脏状态）', () => {
    const w = makeWorld()
    expect(w.rhythm.clockOwner).toBe('region')
    const e = ostlara(w)
    engage(w, e)
    w.tick(2)
    expect(w.rhythm.clockOwner, '进战当 tick 就接管').toBe('boss')
    expect(w.rhythm.bpm).toBe(108)
    expect(w.rhythm.beatsPerBar).toBe(3)
    e.stats.damage(9999)
    w.tick(2)
    expect(w.rhythm.clockOwner).toBe('region')
    expect(w.rhythm.bpm).toBe(84)
    expect(w.rhythm.beatsPerBar).toBe(4)
    w.off()
  })

  it('被流送回收（走远）同样归还', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    w.tick(2)
    expect(w.rhythm.bpm).toBe(108)
    w.ai.despawn(e.id)
    w.tick(2)
    expect(w.rhythm.bpm).toBe(84)
    expect(w.rhythm.beatsPerBar).toBe(4)
    w.off()
  })

  it('接管之后按她的拍速走：200 tick 走掉 6 拍（区域基准只够 4 拍半）', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    w.tick(2)
    const b0 = w.rhythm.info().beatIndex
    w.tick(200)
    expect(w.rhythm.info().beatIndex - b0).toBeGreaterThanOrEqual(6)
    w.off()
  })
})

describe('钟壳：打不动不是数值墙，而是「撞钟才是正解」', () => {
  it('P1 壳在时同一记只吃 10%，而且架势完全打不动（也就没有处决捷径）', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    const hp0 = e.stats.hp
    const poise0 = e.stats.poiseAccum
    const dmg = w.strike(e, 'charged')
    expect(dmg, '打上了').not.toBeNull()
    expect(dmg!).toBeLessThanOrEqual(14)
    expect(e.stats.hp).toBeGreaterThan(hp0 - 20)
    expect(e.stats.poiseAccum, '壳下免疫 ⇒ 这一记一点架势都没堆上').toBe(poise0)
    expect(w.sfx.filter((k) => k === 'bell_clang').length, '每口都被钟壳吃掉，要响').toBeGreaterThan(0)
    w.off()
  })

  it('§16 战长红线：剥壳后 P1 那一段在 90s 内；壳一直挂着就贵一个数量级', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    const shellUp = w.strike(e, 'charged')!
    e.shellLiftTicks = 360
    const lifted = w.strike(e, 'charged')!
    expect(lifted).toBeGreaterThan(shellUp * 6)
    const span = e.stats.hpMax * 0.4 // P1 管 100% → 60%
    const secLifted = (Math.ceil(span / lifted) * 74) / TICK_HZ // 蓄力一轮 ≈74 tick
    expect(secLifted, '看懂机关 ⇒ 单阶承伤时间在预算内').toBeLessThanOrEqual(90)
    expect(secLifted * (lifted / shellUp), '看不懂机关 ⇒ 同一阶贵到 8 倍以上（还得全程躲，实际更久）')
      .toBeGreaterThan(secLifted * 8)
    w.off()
  })

  it('撞一口钟：壳解除 6s、期间架势翻倍、响过的钟变成她的痛处', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    const g = e.data.boss!.bells!
    const bell = g.positions[0]
    const startup = e.data.attacks.find((a) => a.id === 'charge')!.frames.startup
    e.pos.x = bell.x
    e.pos.z = bell.z
    forceAt(e, 'charge', startup - 1)
    w.tick(1)
    expect(e.bellsRung[0], '落地帧正站在钟边 ⇒ 钟响了').toBe(true)
    expect(e.shellLiftTicks).toBeGreaterThanOrEqual(g.releaseTicks - 1)
    expect(e.shellUp).toBe(false)
    expect(w.notifies.some((n) => n.t.includes('立钟鸣响'))).toBe(true)

    const poise0 = e.stats.poiseAccum
    const dmg = w.strike(e, 'l1')
    expect(dmg, '剥壳后同一记不再吃 90%').not.toBeNull()
    expect(dmg!).toBeGreaterThan(20)
    expect(e.stats.poiseAccum - poise0, '而架势是平时的两倍').toBeGreaterThanOrEqual(40)

    e.pos.x = bell.x
    e.pos.z = bell.z
    pin(e) // 残响结算不该被「她会不会还手」干扰
    const hpAtBell = Math.round(e.stats.hp)
    const playerHp0 = w.player.stats.hp
    w.tick(Math.ceil(BAR * 2))
    expect(Math.round(e.stats.hp), '响过的钟每拍敲她 4 点').toBeLessThan(hpAtBell)
    expect(w.player.stats.hp, '玩家站在同一圈里 = 安全平台').toBe(playerHp0)
    w.off()
  })

  it('撞第二口：壳永久碎 + 提前进 P2；阶段单调，血回满也不跳回去', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    const g = e.data.boss!.bells!
    const startup = e.data.attacks.find((a) => a.id === 'charge')!.frames.startup
    for (const idx of [0, 1]) {
      e.pos.x = g.positions[idx].x
      e.pos.z = g.positions[idx].z
      forceAt(e, 'charge', startup - 1)
      w.tick(1)
    }
    expect(e.shellBroken, '撞满 2 口 ⇒ 壳碎').toBe(true)
    expect(e.bossPhase, '§15.1「撞 2 钟 = 提前进 P2 条件」').toBe(1)
    expect(w.phases.at(-1)?.phase, '转阶段演了一次吼').toBe(2)
    e.shellLiftTicks = 0
    expect(e.shellUp, '碎了的壳不会随解除窗口过去而复活').toBe(false)
    const dmg = w.strike(e, 'charged')!
    expect(dmg).toBeGreaterThan(30)
    e.stats.heal(Math.round(e.stats.hpMax * 0.3)) // 回到 80%，仍高于 60% 线
    w.tick(40)
    expect(e.bossPhase, '血线回弹不跳阶').toBe(1)
    w.off()
  })

  it('跳阶那一 tick：boss.phase 事件 + Boss 级提示 + 低音，三样一起到位', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    e.stats.damage(Math.round(e.stats.hpMax * 0.5))
    w.tick(1)
    expect(e.bossPhase).toBe(1)
    expect(w.phases.at(-1)).toMatchObject({ id: e.id, phase: 2, phases: 3 })
    expect(w.notifies.some((n) => n.kind === 'boss'), '提示是 Boss 级文案样式').toBe(true)
    expect(w.sfx.filter((k) => k === 'boss_roar').length).toBe(1)
    // §15.1/§10 的三件套之三：那一嗓子期间世界要塌向 100Hz，且 0.8s 后自己回来
    expect(w.muffles, '跳阶开低通').toEqual([true])
    w.tick(46)
    expect(w.muffles, '0.8s（48 tick）之内一直闷着').toEqual([true])
    let toOpen = 0
    while (!w.muffles.includes(false) && toOpen < 80) { w.tick(); toOpen++ }
    expect(w.muffles, '到点自己解除，不需要谁去关').toEqual([true, false])
    // 起音那一格算第一格 ⇒ 46 格之后还闷着，第 48 格回到开：低通覆盖的正好是 spec 的 0.8s
    expect(toOpen, '低通覆盖的格数 = 0.8s = 48 tick').toBe(48 - 46)
    w.off()
  })

  it('跳阶的低通与处决的低通重叠时不提前解除（两处来源共用一个仲裁者）', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    e.stats.damage(Math.round(e.stats.hpMax * 0.5))
    w.tick(1)
    expect(w.muffles, '跳阶：低通起来了').toEqual([true])
    // 趁那 48 格还没走完，开一次处决（132 格）——先结束的那一方不许把另一方还需要的低通撤掉
    e.stats.crumpleTicksLeft = 400
    e.enter('recover')
    w.player.pos.x = e.pos.x
    w.player.pos.z = e.pos.z + 1.5 // 处决判据是距离 + 破势，先把人放到她跟前
    w.player.stats.overdrive = 99
    w.frame.edges.add('interact')
    w.tick(1)
    expect(w.player.executing, '处决演出没起来：这条在量空气').not.toBeNull()
    w.tick(60)
    expect(w.muffles, '吼声那 48 格走完了，但演出还要它 ⇒ 不该有 false').toEqual([true])
    for (let i = 0; i < 140 && !w.muffles.includes(false); i++) w.tick()
    expect(w.muffles.filter((x) => !x).length, '只解除一次').toBe(1)
    expect(w.player.executing, '解除的时候演出也确实结束了').toBeNull()
    w.off()
  })
})

const e_data = registry.get<EnemyData>('en_ostlara')

describe('阶段白名单与命中网格（验收②「全招可被 BeatClock 对齐」）', () => {
  it('P1 出得来的招式全在白名单闭包里，且命中帧落在小节第 1 拍', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    const got = observe(w, e, 1600)
    const allow = closable(e.data, 0)
    for (const id of got.seen) expect(allow.has(id), 'P1 出了不该会的 ' + id).toBe(true)
    expect(got.seen.has('swordchain1'), '白名单真出得来').toBe(true)
    expect(got.seen.has('charge'), '撞钟冲也出得来（机关得有机会触发）').toBe(true)
    expect(got.seen.has('bellsmash'), 'P3 的招不许提前').toBe(false)
    const s1 = got.hitBeats['swordchain1'] ?? []
    expect(s1.length, '一式真的命中过').toBeGreaterThan(0)
    expect((Math.max(...s1) / TICK_HZ) * 1000, '一式命中落在它声明的拍 1 网格上').toBeLessThanOrEqual(TOLERANCE_MS)
    expect((got.worstOff / TICK_HZ) * 1000, '本阶全招命中帧误差都在 §2.1 的 50ms 容差内').toBeLessThanOrEqual(TOLERANCE_MS)
    w.off()
  })

  it('P2 的候选真的换了一批，且三连的第三击永远落在小节第 3 拍（故意破规矩）', () => {
    // 数据层面 P2 换了什么，由上面那条白名单测试负责；这里跑三个 seed 只验两件事：
    // ①她**不会**提前拔出 P3 的招（子集性质，与安全相关）；②P2 招牌三连的命中帧仍然对齐
    // （验收②）。不要求「一次采样里五招全出」——她的读条很长、同小节同拍位只有一个插槽，
    // 单次 2200 tick 平均只有十几次起手，那种断言只会自己抖。
    const allow = closable(e_data, 1)
    const seen = new Set<string>()
    let allowOk = true
    const thirdErr: number[] = []
    const startErr: number[] = []
    for (const seed of ['p2-a', 'p2-b', 'p2-c']) {
      const w = makeWorld()
      const e = ostlara(w, -3, seed)
      engage(w, e)
      e.stats.damage(Math.round(e.stats.hpMax * 0.5))
      w.tick(1)
      expect(e.bossPhase).toBe(1)
      const got = observe(w, e, 2400)
      for (const id of got.seen) {
        seen.add(id)
        if (!allow.has(id)) allowOk = false
      }
      thirdErr.push(...(got.hitBeats['combo3c'] ?? []))
      startErr.push(...(got.hitBeats['combo3a'] ?? []))
      w.off()
    }
    expect(allowOk, `P2 出了不该会的招：[${[...seen]}]`).toBe(true)
    expect(seen.has('swordchain1'), 'P1 的招式留在池子里').toBe(true)
    expect(seen.has('combo3a'), `P2 的三连要出得来：[${[...seen]}]`).toBe(true)
    expect(seen.has('bellsmash'), 'P3 的大招不许提前').toBe(false)
    expect(thirdErr.length, '三连第三击被采到').toBeGreaterThan(0)
    expect(Math.max(...thirdErr), '第三击踩在它自己声明的那一拍（表里写的是拍 3）').toBeLessThanOrEqual(1)
    expect(Math.max(...startErr), '起手仍在拍 1 网格').toBeLessThanOrEqual(1)
  })

  it('P3 只剩大招：一记跨两条血线直接跳阶，命中帧仍在第 1 拍', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    e.stats.damage(Math.round(e.stats.hpMax * 0.8))
    w.tick(1)
    expect(e.bossPhase, '一次跳到最靠后那一阶（不回跳）').toBe(2)
    const got = observe(w, e, 2600)
    const allow = closable(e.data, 2)
    for (const id of got.seen) expect(allow.has(id), 'P3 出了不该会的 ' + id).toBe(true)
    expect(got.seen.has('bellsmash'), 'P3 的招牌要出得来').toBe(true)
    expect(got.seen.has('swordchain1'), 'P3 不再挥小剑').toBe(false)
    const smash = got.hitBeats['bellsmash'] ?? []
    expect(smash.length, '两小节前摇的大招也排得出来').toBeGreaterThan(0)
    expect(Math.max(...smash), '命中帧仍在重拍网格上').toBeLessThanOrEqual(1)
    w.off()
  })

  it('弹反她的重拍剑击 ⇒ 失音硬直 1.2s（§15.1 模式级弱点）', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    e.shellLiftTicks = 360
    e.yaw = Math.PI
    w.player.pos.x = e.pos.x
    w.player.pos.z = e.pos.z - 1.6
    w.player.pos.y = e.pos.y
    w.player.yaw = 0
    const startup = e.data.attacks.find((a) => a.id === 'swordchain1')!.frames.startup
    forceAt(e, 'swordchain1', startup - 6)
    for (let i = 0; i < 16; i++) {
      const a = e.attack
      if (a && a.tick === a.spec.frames.startup - 2) w.player.parryTicksLeft = w.player.base.parry.activeTicks
      w.tick()
      if (!e.attack) break
    }
    expect(e.attack, '读条作废').toBeNull()
    expect(e.stunTicks, '失音 72 tick 减去已经走过的几 tick').toBeGreaterThan(55)
    expect(w.player.stats.hp, '弹反 = 零伤').toBe(9_999_999)
    w.off()
  })
})

describe('P2 的呼吸拍（§15.1「每 2 小节一次换乐句停顿 0.5s」）', () => {
  it('换乐句被排进阶段里：她每 2 小节必须站住 0.5s，那是处决/喝药的窗口', () => {
    const w = makeWorld()
    const e = ostlara(w)
    engage(w, e)
    e.stats.damage(Math.round(e.stats.hpMax * 0.5))
    w.tick(1)
    expect(e.bossPhase, '呼吸拍挂在 P2 的阶段上').toBe(1)
    const bc = e.bossPhaseData?.barCast
    expect(bc?.everyBars, '每 2 小节一次').toBe(2)
    expect(bc?.attackId, '那一拍她就站着').toBe('phrase')
    const phrase = e.data.attacks.find((a) => a.id === 'phrase')!
    expect(phrase.frames.damage, '不痛 —— 它是窗口不是招式').toBe(0)
    expect(phrase.frames.recovery / TICK_HZ, '≈0.5s 的停顿').toBeGreaterThanOrEqual(0.5)
    let breaths = 0
    let prev: Enemy['attack'] = null
    w.tick(2200, () => {
      const a = e.attack
      if (a && a !== prev && a.spec.id === 'phrase') breaths++
      prev = a
    })
    expect(breaths, '2200 tick（约 22 小节）里至少给三次呼吸拍').toBeGreaterThanOrEqual(3)
    w.off()
  })
})
