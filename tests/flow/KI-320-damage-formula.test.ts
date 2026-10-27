import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import type { Rng } from '@/core/Math'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import { CombatManager } from '@/combat/CombatManager'
import { RpgRuntime } from '@/rpg/Runtime'
import type { PlayerMods } from '@/rpg/Runtime'

/**
 * KI-325：§12 伤害公式那四句承诺**第一次在真链上被读数**（KI-320 那一行把四条腿登记了，
 * 但那四条腿全是 `expect(true, '…登记…').toBe(true)`——**恒真式，一条读数都没有**；
 * KI-323 只把那份文件修到能编译，没把它做成真链读数）。
 *
 * 设计的四句话（`docs/combat.md` §12，585–595 行，逐字）：
 *
 * ```text
 * 暴击 = ×1.35 + 泛音 Overtone 每 10 点 +2%；背刺/处决走 §5.4 固定比例不吃暴击
 * 真伤（处决/碎裂/战技起手式的追加真伤）不吃 DR；架势伤害独立通道。
 * 友军伤害：关闭
 * ```
 *
 * ## 与 KI-257 那一格不重不漏
 *
 * `tests/flow/damage-formula.test.ts`（KI-257）量的是 §12 **公式块里**那六项乘子——
 * `rand(0.95,1.05)`／`(1-DR)`／DR 的远程那层（×0.6）／`wScale(attr)`／`onBeatBonus`（无承载体，
 * 只在架势那一侧）／`combo`（`comboStageMul` 在 `src/` 里只有定义没有调用方）。
 * **这四条是公式块下面那三句**：暴击倍率、泛音加成、真伤、友军伤害。
 *
 * ## 读数一律从真链取
 *
 * **真链＝这一整条**：输入边沿 → `PlayerController.update` 出手 → `CombatManager` 那条**唯一**的
 * 「玩家打到敌人」通道（`strikeEnemy`）→ `combat.hit` 事件 → 读那一记的 `damage`。
 * 读数不是抄表、不是抄常数：那一记的伤害是**打出来的**，从事件里读回来。
 *
 * ## 四条量具纪律（都是"不然这条腿会骗人"那一类）
 *
 * ① **抖动要钉死**：伤害里有一项 `rand(0.95,1.05)` 的浮动，不钉死它两次读数就不可比
 *    （而且**暴击那一次比不暴击那次多抽一笔随机** ⇒ 两次连浮动因子都不是同一个）。
 *    ⇒ 把 `CombatManager` 的随机源换成恒 `0.5`：`0.95 + 0.5×0.1 = 1.0` **恰为 1.0**。
 * ② **底数要能逐字对账**：面板属性归零（`attrScale` 恒等）、武器强化倍率与连段倍率归 1、
 *    目标防御归零 ⇒ 那一记的底数就是帧表里那个整数；于是"不暴击那一记"**恰好等于底数**，
 *    "暴击那一记"就恰好是 `round(底数 × 1.35)` ⇒ 倍率可以被逐字对账，而不是"差不多"。
 * ③ **每一格都要有对照组**：没有对照组的读数是空转的——真伤那条若没有"普通那一记确实被 DR
 *    咬了一口"的对照，就会因为"根本没减伤"而假绿；泛音那条若没有"泛音 20 那记确实跨过了
 *    取整的一道坎"的对照，就会因为"倍率根本没接上"而假绿。
 * ④ **每一次读数用一只新靶子**：同一只靶子挨过打之后再挨打，震裂层数／血量／架势都会串味
 *    （震裂那一层是**乘在暴击之后**的 ⇒ 串味会直接把倍率那一格算歪）。⇒ 换靶子的同时把玩家
 *    挪到新靶子的正前方，免得一只锥形命中框把两只都扫进去（真伤那一格尤其致命：追加真伤
 *    在**第一个**受害者身上就兑现了，第二个受害者拿不到）。
 *
 * ## 这一批量出来的两件设计口径上的事
 *
 * ① **「×1.35」是泛音 0 那一格**：出身自带 5 点泛音（`origin_tuner` 的 `ovr = 5`）⇒
 *    开局的实际倍率是 `1.35 + 5×0.002 = **1.36**`，不是 1.35。设计那句话本身没错（它写着
 *    「×1.35 **+ 泛音每 10 点 +2%**」），但"暴击 ×1.35"这句话单拎出来会对不上 ⇒ 腿①把泛音
 *    显式摆到 0 再读那一格。
 * ② **「每 10 点 +2%」在单记伤害上有一格看不出来**：倍率那一格逐格兑现（1.35/1.37/1.39/1.41），
 *    但一记 9 伤的轻击，`×1.35` 与 `×1.37` 取整后都是 12 ⇒ 要到泛音 20（×1.39）才跨过取整的
 *    一道坎（12 → 13）。这不是实现缺了那一格，是**一记轻击的分辨率不够**（2% × 9 伤 = 0.18 伤
 *    ⇒ 落在同一个整数上）。腿②把这件事**如实钉成读数**，而不是拿"倍率对上了"冒充"伤害对上了"。
 */

registerGameData()

/** 真链世界：和仓库里其它 flow 测试同一个骨架（`tests/flow/beat-mechanics.test.ts` 那一份） */
function makeWorld(weaponId = 'wp_tuning_sword') {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>(weaponId)
  const player = new PlayerController(
    playerBase,
    weapon,
    registry.get<MovesetData>(`moveset:${weapon.movesetId}`),
  )
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout())
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  // 量具纪律①：抖动钉死（`CombatManager` 只用 `rng.float()`，替掉它不影响别处）
  combat.rng = { float: () => 0.5 } as unknown as Rng
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const hits: Array<{ attackerId: string; victimId: string; damage: number; result: string; backstab?: boolean; crit?: boolean }> = []
  const off = bus.on('combat.hit', (p) => { hits.push({ ...p }) })
  const pins: Array<() => void> = []
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      for (const pin of pins) pin()
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, rpg, player, ai, combat, frame, tick, hits, off, pins }
}

type World = ReturnType<typeof makeWorld>

/** 量具纪律②：面板摆成"能逐字对账"的那一格（属性归零 ⇒ `attrScale` 恒等；武器/连段倍率 1） */
function neutralPanel(w: World, over: Partial<PlayerMods> = {}): void {
  w.player.rpg = {
    ...w.player.rpg,
    attrs: { str: 0, dex: 0, ton: 0, vig: 0, ovr: 0, fis: 0 },
    weaponDamageMul: 1,
    comboScaling: 0,
    bellBonus: 0,
    ...over,
  }
}

/**
 * 摆一只不还手的靶子，并把玩家挪到它**正前方**。
 *
 * **朝向口径**（这一格量错过一次，值得写下来）：命中锥的方向是 `atan2(dx, dz)` 那一套
 * ⇒ **玩家 yaw=0 时锥子指向 +z**，而 `isBackstab` 又按"攻击者是否在守方背后"判 ⇒ 靶子必须摆在
 * **+z** 那一侧、并且**正对玩家**（yaw = π），否则那一记会被当成背刺（×2.0），读数全歪。
 */
function stage(w: World, id: string, z: number): Enemy {
  const e = w.ai.spawn(id, { x: 0, y: 0, z }, `probe${z}`)
  e.alertness = 0
  e.enter('idle')
  w.pins.push(() => { e.pos.x = 0; e.pos.z = z; e.yaw = Math.PI })
  w.player.pos = { x: 0, y: 0, z: z - 1.5 }
  return e
}

type Hit = { damage: number; crit: boolean; backstab: boolean }

/**
 * 出一记，**打到**那只靶子，读回那一记的伤害。
 *
 * 走的是完整真链：输入边沿 → 出手 → `CombatManager` 的唯一伤害通道 → `combat.hit` 事件。
 * `heavy` 走「按住 `attackHeavy` 再松开」那一条（松开时 chargeTicks < 8 ⇒ 起手式 `h`，
 * 而 `h` 的 kind 是 `heavy` ⇒ 全音符斩压在下一记重击上的**追加真伤**就在这一记上兑现）。
 */
function strike(w: World, e: Enemy, kind: 'light' | 'heavy'): Hit | null {
  w.hits.length = 0
  // 等上一记收完（重击的收势有 63 拍 ⇒ 不等就起不了手；`tryStartAction` 要求 `action === null`）
  for (let i = 0; i < 150 && (w.player.action !== null || w.player.charging); i++) w.tick()
  w.player.stats.stamina = w.player.stats.staMax
  if (kind === 'heavy') {
    w.frame.held.add('attackHeavy')
    w.tick()
    w.frame.held.delete('attackHeavy')
  } else {
    w.frame.edges.add('attackLight')
  }
  for (let i = 0; i < 150; i++) {
    w.tick()
    const hit = w.hits.find((h) => h.attackerId === 'player' && h.victimId === e.id && h.result === 'hit')
    if (hit) return { damage: hit.damage, crit: hit.crit === true, backstab: hit.backstab === true }
  }
  return null
}

describe('KI-325 §12 伤害公式四句：暴击 ×1.35、泛音每 10 点 +2%、真伤不吃 DR、友军伤害关闭', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **暴击伤害乘数 ×1.35**：泛音 0 那一格倍率逐字是 1.35，且真链上那一记恰好是 round(底数 × 1.35)', () => {
    const w = makeWorld()
    alive.push(w.off)

    // (a) 倍率读数：真 `Progression.derive()` 那一格。**泛音必须显式摆到 0**——出身自带 5 点
    //     泛音（`origin_tuner` 的 `ovr = 5`）⇒ 开局的实际倍率是 1.36，不是 1.35（见文件头①）
    w.rpg.prog.attrs.ovr = 0
    const derived = w.rpg.prog.derive().critMul
    expect(derived, '**倍率读数**：泛音 0 时的暴击倍率（`Progression.derive()` 那一格）').toBe(1.35)
    // 反证：把泛音摆回出身那 5 点，开局的倍率就变成 1.36（那句「×1.35」单拎出来会对不上）
    w.rpg.prog.attrs.ovr = 5
    expect(w.rpg.prog.derive().critMul, '**出身那 5 点泛音**让开局倍率变成 1.36（设计那句还含「+每 10 点 2%」）').toBe(1.36)
    w.rpg.prog.attrs.ovr = 0

    // (b) 伤害读数：真链上打两记 —— 一记不暴击、一记必暴击（量具纪律④：两只新靶子）
    const frameBase = registry.get<MovesetData>(`moveset:${w.player.weapon.movesetId}`).actions.l1.damage
    const plainTarget = stage(w, 'en_murkshell', 1.5)
    plainTarget.stats.defense = 0
    neutralPanel(w, { critRate: 0, critMul: derived })
    const plain = strike(w, plainTarget, 'light')
    expect(plain, '那一记没打出去（真链断了）').not.toBeNull()
    expect(plain!.backstab, '那一记成了背刺（×2.0）⇒ 量到的不是普通命中').toBe(false)
    expect(plain!.damage, '不暴击那一记：属性与防御都归零 ⇒ 伤害恰为帧表底数').toBe(frameBase)

    const critTarget = stage(w, 'en_murkshell', 4.5)
    critTarget.stats.defense = 0
    neutralPanel(w, { critRate: 1, critMul: derived })
    const crit = strike(w, critTarget, 'light')
    expect(crit, '暴击那一记没打出去').not.toBeNull()
    expect(crit!.backstab, '暴击那一记成了背刺').toBe(false)
    expect(crit!.crit, '**critRate=1 却没有暴击** ⇒ 暴击那一格没接上').toBe(true)
    expect(crit!.damage, `**暴击那一记**（底数 ${frameBase} × 1.35）`).toBe(Math.round(frameBase * 1.35))
    expect(crit!.damage, '暴击那一记的读数（底数 9 ⇒ 12）').toBe(12)
  })

  it('腿② **泛音每 10 点 +2%**：倍率那一格逐格兑现（1.35/1.37/1.39/1.41）；单记伤害上 0→10 点**看不出来**（取整分辨率不够），要到 20 点才跨过一道坎', () => {
    const w = makeWorld()
    alive.push(w.off)

    // (a) 倍率读数：真 `Progression.derive()`，泛音 0/10/20/30
    w.rpg.prog.attrs.ovr = 0
    const at0 = w.rpg.prog.derive().critMul
    w.rpg.prog.attrs.ovr = 10
    const at10 = w.rpg.prog.derive().critMul
    w.rpg.prog.attrs.ovr = 20
    const at20 = w.rpg.prog.derive().critMul
    w.rpg.prog.attrs.ovr = 30
    const at30 = w.rpg.prog.derive().critMul
    w.rpg.prog.attrs.ovr = 0

    expect(at0, '泛音 0 的倍率').toBe(1.35)
    expect(at10 - at0, '泛音 10 比泛音 0 多的那一截（**每 10 点 +2%** ＝ +0.02）').toBeCloseTo(0.02, 10)
    expect(at20 - at10, '泛音 20 比泛音 10 多的那一截').toBeCloseTo(0.02, 10)
    expect(at30 - at20, '泛音 30 比泛音 20 多的那一截').toBeCloseTo(0.02, 10)

    // (b) 伤害读数：泛音 0/10/20 三记，同一条真链（量具纪律④：三只新靶子）
    const frameBase = registry.get<MovesetData>(`moveset:${w.player.weapon.movesetId}`).actions.l1.damage
    const reading = (mul: number, z: number): number => {
      const target = stage(w, 'en_murkshell', z)
      target.stats.defense = 0
      neutralPanel(w, { critRate: 1, critMul: mul })
      const h = strike(w, target, 'light')
      expect(h, '那一记没打出去').not.toBeNull()
      expect(h!.crit, 'critRate=1 却没有暴击').toBe(true)
      return h!.damage
    }
    const dmg0 = reading(at0, 1.5)
    const dmg10 = reading(at10, 4.5)
    const dmg20 = reading(at20, 7.5)

    expect(dmg0, '泛音 0 那一记（×1.35）').toBe(Math.round(frameBase * 1.35))
    expect(dmg10, '泛音 10 那一记（×1.37）').toBe(Math.round(frameBase * 1.37))
    // **这一行是本条腿的"如实登记"**：0→10 点在**单记伤害**上取整后是同一个数
    expect(dmg10 - dmg0, '泛音 0→10 在**单记伤害**上的差（2% × 9 伤 ＝ 0.18 ⇒ 落在同一个整数上）').toBe(0)
    // 对照组：倍率确实接上了——泛音 20（×1.39）跨过了取整的一道坎
    expect(dmg20 - dmg0, '泛音 20 那一记比泛音 0 多的（**倍率接上了**：×1.39 跨过取整的一道坎）').toBeGreaterThan(0)
  })

  it('腿③ **真伤不吃 DR**：追加真伤那一笔原样进血条（一点不被 DR 减），而同一记的普通伤害确实被 DR 咬了（对照组）', () => {
    const w = makeWorld()
    alive.push(w.off)
    // 带防御的目标：DR = 20/(20+120) = 1/7 ⇒ 普通伤害会被减掉一截（防御值从数据来，不是手钉的）
    const dr = (d: number): number => d / (d + 120)
    const frameHeavy = registry.get<MovesetData>(`moveset:${w.player.weapon.movesetId}`).actions.h.damage

    // (a) 对照组：普通那一记**确实**被 DR 减了
    const controlTarget = stage(w, 'en_tympanus', 1.5)
    expect(controlTarget.stats.defense, '靶子的防御（从数据来的，不是手钉的）').toBeGreaterThan(0)
    neutralPanel(w, { critRate: 0, critMul: 1.35 })
    const control = strike(w, controlTarget, 'heavy')
    expect(control, '对照那一记没打出去').not.toBeNull()
    const expectedPlain = Math.round(frameHeavy * (1 - dr(controlTarget.stats.defense)))
    expect(control!.damage, `对照那一记（底数 ${frameHeavy}、DR = ${dr(controlTarget.stats.defense).toFixed(4)}）`).toBe(expectedPlain)
    expect(control!.damage, '**对照组**：那一记没有被 DR 减 ⇒ 这条腿是空转的').toBeLessThan(frameHeavy)

    // (b) 真伤那一记：起手式压在下一记重击上的**追加真伤**（全音符斩那一格）
    const TRUE_DAMAGE = 18
    const trueTarget = stage(w, 'en_tympanus', 6.5)
    w.player.followup = { layers: 0, trueDamage: TRUE_DAMAGE }
    neutralPanel(w, { critRate: 0, critMul: 1.35 })
    const hit = strike(w, trueTarget, 'heavy')
    expect(hit, '真伤那一记没打出去').not.toBeNull()
    expect(hit!.damage, '真伤那一记的读数').toBe(expectedPlain + TRUE_DAMAGE)
    // 反证：真伤若被 DR 减了，差值就会是 18 × (1 − DR) ≈ 15.43 ⇒ 上面那一行必红
    expect(hit!.damage - control!.damage, '**真伤那一截原样进血条**（不是 18 × (1−DR)）').toBe(TRUE_DAMAGE)
  })

  it('腿④ **友军伤害关闭**：同伴全程不掉血（对照组：玩家确实在掉血）', () => {
    const w = makeWorld()
    alive.push(w.off)
    // 一只挨打的同伴（同伴＝敌人阵营里的另一个；本作没有"玩家的友军"这个种类）
    // **站位有讲究**：同伴必须落在攻击者与玩家**之间**（敌人的近战锥从它那儿扫过去），
    // 否则"同伴没掉血"是因为压根没被扫到 ⇒ 那样这条腿是空转的（反向实测 M5 就是这么咬住的）。
    const ally = w.ai.spawn('en_skewer', { x: 0, y: 0, z: -0.6 }, 'ally')
    ally.alertness = 0
    ally.enter('idle')
    w.pins.push(() => { ally.pos.x = 0; ally.pos.z = -0.6 })
    const allyHp0 = ally.stats.hp
    const playerHp0 = w.player.stats.hp

    // 让一只敌人在近处真的打玩家（对照组：这一记必须真的发生，否则下面"同伴没掉血"是空转的）
    const attacker = w.ai.spawn('en_driftsinger', { x: 0, y: 0, z: -1.5 }, 'probe2')
    attacker.alertness = 100
    attacker.enter('chase')
    w.pins.push(() => { attacker.pos.x = 0; attacker.pos.z = -1.5 })

    let playerHit = 0
    const offHit = bus.on('combat.hit', (p) => {
      if (p.attackerId !== 'player' && p.victimId === 'player') playerHit++
    })
    alive.push(offHit)
    for (let i = 0; i < 600 && playerHit === 0; i++) w.tick()

    expect(playerHit, '**对照组**：敌人那 600 拍里一记也没打中玩家 ⇒ 下面"同伴没掉血"是空转的').toBeGreaterThan(0)
    expect(w.player.stats.hp, '玩家的血确实掉了').toBeLessThan(playerHp0)
    expect(ally.stats.hp, '**同伴的血一根汗毛都没掉**（友军伤害关闭）').toBe(allyHp0)
  })
})
