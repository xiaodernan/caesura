import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, FrameData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { Enemy, newAttack } from '@/ai/Enemy'
import { CombatManager } from '@/combat/CombatManager'
import { RpgRuntime } from '@/rpg/Runtime'

/**
 * KI-319：`attack.tick` 那 11 处窗口判定 ⇄「一招在第几拍完成」的对账腿（销 KI-317 的「没做③」）。
 *
 * 「11 处」＝KI-320 改判之后的读数：KI-319 立腿时是 **13** 处，而 KI-320 把前冲那一段的
 * 两处比较（`attack.tick > 0` 与 `attack.tick <= activeEnd`）换成了**算出来的带界**
 * （`Math.min`／`Math.max`）⇒ 直接比较点从 13 变 11，窗口判定的**语义**没变（那两格仍在
 * 决定"这一拍算不算前冲带内"）。账本与 WORKPLAN 里那个数跟着改成 11，理由记在 KI-320 那一行。
 *
 * 在此之前 `frames.startup / activeStart / activeEnd / recovery` 只有**文档侧**的读者
 * （KI-117 那台量的是玩家武器 §4 的表）；敌人 §14/§15 这 39 式没有任何一条腿说过
 * 「运行时第几拍起手、第几拍打到人、第几拍收手」。KI-317 的 B3 臂量到这些判定全住在被降频的
 * `ai.update` 腿上，而那条腿本身没被钉住——所以先立腿。
 *
 * 量法：先让状态机自己走进 combat（Boss 的入场演出不许吃掉招式的第一格），趁手上没招时把要量
 * 那一式挂上去，然后**只跟踪这一个招式实例**（按对象身份），于是每格读数都只能由表驱动。
 * 命中按 `attackerId` 归主，别的个体的结算不许算进这一式。
 */

registerGameData()

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
/** 名册从数据文件现推（新增一只敌人不必改这里）：enemies.json 顶层是数组，一格一个个体 */
const ALL_ENEMIES = JSON.parse(readFileSync(`${ROOT}src/data/json/enemies.json`, 'utf8')) as EnemyData[]
const ENEMY_IDS = ALL_ENEMIES.map((d) => d.id)
/** 本批 harness 的拍长（84 BPM）：`RhythmClock.beatTicks` 的同一条式子，用来把帧换算成「第几拍」 */
const BPM = 84
const BEAT_TICKS = (60 / BPM) * TICK_HZ

type Frames = NonNullable<EnemyData['attacks'][number]['frames']>

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(BPM, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>('moveset:ms_sword'))
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout())
  player.stats.hpMax = 999999
  player.stats.hp = 999999
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
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
  return { time, rhythm, player, ai, combat, tick, pins }
}

/** 盒子外沿（`shapeHits` 把目标体积加在外沿上，所以这里只取形状自己那一格） */
function outerOf(box: FrameData['hitbox']): number {
  if (!box) return 1.6
  return box.shape === 'ring' ? box.outer : box.radius
}

/**
 * 前冲的**全程可走米数**（KI-320 裁决后的口径）：
 * `frames.lunge` 那一格说的是「这一式的前冲总共走多少米」，除数是这条位移带的帧数
 * （第 1..activeEnd 拍）⇒ 净米数 ＝ 表值。老口径的除数写的是判定窗的长度
 * （`activeEnd - startup`），于是净米数被放大 `activeEnd / (activeEnd - startup)` 倍。
 */
function lungeTravel(f: Frames): number {
  if (!f.lunge) return 0
  return f.lunge
}

type Mode = 'in' | 'far' | 'late'
type Opt = { mode?: Mode; lateAt?: number; aura?: boolean; finale?: boolean; noLunge?: boolean }

type Row = {
  enemy: string; atk: string; f: Frames
  startEnd: number; hit: number; hitFrame: number; noise: number; shot: number
  clear: number; clearFrame: number; nHit: number; approach: number
  samples: number[]; ghost: boolean[]
  warm: number; buffMul: number; buffFrom: string; patron: string; patronData: string; phase: number
}

function runOne(enemyId: string, atkId: string, opt: Opt = {}): Row {
  const mode = opt.mode ?? 'in'
  const w = makeWorld()
  const e = w.ai.spawn(enemyId, { x: 0, y: 0, z: 0 }, 'probe') as Enemy
  const data = registry.get<EnemyData>(enemyId)
  const spec = data.attacks.find((a) => a.id === atkId)!
  const f = spec.frames!
  const reach = outerOf(f.hitbox)
  const farZ = reach + lungeTravel(f) + 3 // 外沿＋前冲全程＋余量：站这里＝这一式怎么冲都够不着
  const nearZ = Math.max(0.7, Math.min(reach * 0.5, 2))
  const putAt = (z: number): void => { w.player.pos = { x: 0, y: 0, z } }
  putAt(mode === 'in' ? nearZ : farZ)

  const row: Row = {
    enemy: enemyId, atk: atkId, f, startEnd: -1, hit: -1, hitFrame: -1, noise: -1, shot: -1,
    clear: -1, clearFrame: -1, nHit: 0, approach: 0, samples: [], ghost: [], warm: -1,
    buffMul: 1, buffFrom: '', patron: '', patronData: '', phase: e.bossPhase
  }

  let patron: Enemy | null = null
  if (opt.aura) {
    // 定调走真链：施主是场里一只活着的叠唱（§14.6 那格 `ai.buffAura`），不是测试替它写的 buff
    const range = data.ai.buffAura?.range ?? 12
    patron = w.ai.spawn('en_refrein', { x: 0, y: 0, z: -(range - 1) }, 'refrein') as Enemy
    patron.stats.hp = patron.stats.hpMax = 999999
    row.patron = patron.id
    row.patronData = patron.data.id
  }
  w.pins.push(() => {
    w.player.stats.hp = 999999
    e.stunTicks = 0
    e.frozenTicks = 0
    e.alertness = 100
    if (opt.finale) {
      // §15.2 过载期走真正的阶段机：把血线压进 `belowHpFrac` 那一格，让 `syncBoss` 自己跳阶
      const gate = data.boss?.phases[2].belowHpFrac ?? 0.25
      e.stats.hp = Math.floor(e.stats.hpMax * (gate - 0.05))
    }
    if (e.state !== 'combat') e.enter('combat')
  })
  for (let i = 0; i < 1200; i++) {
    w.tick(1)
    const phaseOk = !opt.finale || e.bossPhase === 2
    if (e.state === 'combat' && e.introTicksLeft === 0 && !e.attack && phaseOk) { row.warm = i + 1; break }
  }
  e.pos = { x: 0, y: 0, z: 0 } // 预热里它可能已经走近了；挂招前把几何钉回原点，距离才由表说了算
  row.phase = e.bossPhase
  // `noLunge` 是对照腿：同一份表只把 `lunge` 那一格抹掉（几何仍按有前冲那趟算，两次才可比）
  const held = newAttack(opt.noLunge ? { ...spec, frames: { ...f, lunge: undefined } } : spec, 0)
  e.attack = held
  const t0 = w.time.tick
  const mine = (): boolean => e.attack === held
  let shots = w.combat.projectiles.list().length
  let gap = Math.hypot(w.player.pos.x - e.pos.x, w.player.pos.z - e.pos.z)
  const offs = [
    bus.on('combat.hit', (p) => {
      if (p.victimId !== 'player' || p.attackerId !== e.id || !mine()) return
      row.nHit++
      if (row.hit < 0) { row.hit = w.time.tick - t0; row.hitFrame = held.tick }
    }),
    bus.on('sound.source', (p) => { if (p.id === e.id && row.noise < 0 && mine()) row.noise = w.time.tick - t0 })
  ]
  if (mode === 'late') w.pins.push(() => { if (w.time.tick - t0 === (opt.lateAt ?? f.activeEnd + 2)) putAt(nearZ) })
  for (let i = 0; i < 2400; i++) {
    w.tick(1)
    if (!mine()) { row.clear = w.time.tick - t0; row.clearFrame = held.tick; break }
    row.samples.push(held.tick)
    row.ghost.push(e.intangible) // §14.5 虚体拍：`progressAttack` 的前冲分支第一件事就是问这一格
    const nextGap = Math.hypot(w.player.pos.x - e.pos.x, w.player.pos.z - e.pos.z)
    row.approach += gap - nextGap // 带符号：拉近为正、拉开为负 ⇒ 第二移动者（射手背退）自己会现形
    gap = nextGap
    if (row.buffFrom === '' && e.buff) { row.buffMul = e.buff.attackSpeedMul; row.buffFrom = e.buff.fromId }
    if (row.startEnd < 0 && e.inStartup === false) row.startEnd = w.time.tick - t0
    const n = w.combat.projectiles.list().length
    if (n > shots) { if (row.shot < 0) row.shot = w.time.tick - t0 }
    shots = Math.max(n, shots)
  }
  for (const o of offs) o()
  w.ai.despawn(e.id)
  if (patron) w.ai.despawn(patron.id)
  return row
}

/** 这一式到底该不该打中人：表里 `damage` 为 0 且没有 hitbox 的那四式（嘶鸣/自鸣/乐句/换气）不许有命中 */
function isDamaging(f: Frames): boolean { return !!f.hitbox && (f.damage ?? 0) > 0 }

const ALL: Array<{ id: string; atk: string; f: Frames }> = []
for (const id of ENEMY_IDS) {
  for (const a of registry.get<EnemyData>(id).attacks) if (a.frames) ALL.push({ id, atk: a.id, f: a.frames })
}
/** 各子名册由同一份表派生：腿测到的条数必须等于这里的条数（少跑一式就红），条数本身另有一张地板 */
const POP_MELEE = ALL.filter((x) => isDamaging(x.f) && !x.f.projectile)
const POP_STOP = POP_MELEE.filter((x) => !!x.f.hitStopMs)
const POP_LUNGE = ALL.filter((x) => !!x.f.lunge)
const POP_QUIET = ALL.filter((x) => !isDamaging(x.f) && !x.f.projectile)
const tag = (id: string, atk: string): string => `${id}/${atk}`

describe('KI-319 招式帧 ⇄ 第几拍完成 的对账腿', () => {
  it('名册：39 式带 frames，四个子名册先把分母定下来', () => {
    console.log(`\n#### KI-319 名册 ${ENEMY_IDS.length} 只敌人 / ${ALL.length} 式带 frames` +
      `｜近战可命中 ${POP_MELEE.length}｜带停顿 ${POP_STOP.length}｜含 lunge ${POP_LUNGE.length}｜无伤害式 ${POP_QUIET.length}`)
    expect(ALL.length, '带 frames 的招式名册（改表就改这条，腿先红再谈）').toBe(39)
    // 地板：子名册塌了说明派生的那几步判据被改了，不许让上面的腿悄悄少跑几式
    expect(POP_MELEE.length).toBeGreaterThanOrEqual(29)
    expect(POP_STOP.length).toBeGreaterThanOrEqual(12)
    expect(POP_LUNGE.length).toBeGreaterThanOrEqual(23)
    expect(POP_QUIET.length).toBeGreaterThanOrEqual(4)
  })

  it('逐招三拍：起手／判定窗第一格／收手，39 式一律落在帧表那一格', () => {
    const lines: string[] = []
    for (const { id, atk } of ALL) {
      const r = runOne(id, atk)
      const f = r.f
      const t = tag(id, atk)
      expect(r.startEnd, `${t}：起手走完那一拍该是表里的 startup=${f.startup}，读到 ${r.startEnd}`).toBe(f.startup)
      expect(r.clear, `${t}：收手那一拍该是表里的 recovery=${f.recovery}，读到 ${r.clear}`).toBe(f.recovery)
      expect(r.clearFrame, `${t}：收手那一刻的**帧**恰好等于 recovery，一拍不 overshoot（不加速时）`).toBe(f.recovery)
      if (isDamaging(f) && !f.projectile) {
        expect(r.nHit, `${t}：玩家站在盒子里，判定窗内一次都不许落空`).toBeGreaterThan(0)
        expect(r.hit, `${t}：命中那一拍该是 activeStart=${f.activeStart}，读到 ${r.hit}`).toBe(f.activeStart)
        expect(r.hitFrame, `${t}：命中发生在窗口**里面**，不是跨过窗口`).toBe(f.activeStart)
        expect(r.noise, `${t}：起手音与落帧同拍（audio §7.2「听见起手」）`).toBe(f.activeStart)
      } else if (f.projectile) {
        expect(r.shot, `${t}：弹体离手那一拍该是 activeStart=${f.activeStart}，读到 ${r.shot}`).toBe(f.activeStart)
      } else {
        expect(r.nHit, `${t}：表里 damage=${f.damage} 且无 hitbox ⇒ 这一式不许打中人`).toBe(0)
        expect(r.noise, `${t}：无伤害式仍然按 activeStart 报声`).toBe(f.activeStart)
      }
      lines.push(`${t} ${f.projectile ? 'P' : 'M'}|S${f.startup}/A${f.activeStart}-${f.activeEnd}/R${f.recovery}` +
        ` ‖ startEnd=${r.startEnd} hit=${r.hit}(${r.hitFrame}) noise=${r.noise} shot=${r.shot}` +
        ` clear=${r.clear}(${r.clearFrame}) nHit=${r.nHit}` +
        ` ｜ 收手在第 ${(f.recovery / BEAT_TICKS).toFixed(2)} 拍`)
    }
    console.log(lines.join('\n'))
  })

  it('窗口是窗口：站在外沿＋前冲全程之外／比窗口尾还晚才跨进来——两种都不许打中人', () => {
    const done: string[] = []
    for (const { id, atk } of POP_MELEE) {
      const f = registry.get<EnemyData>(id).attacks.find((a) => a.id === atk)!.frames!
      const out = runOne(id, atk, { mode: 'far' })
      const slow = runOne(id, atk, { mode: 'late', lateAt: f.activeEnd + 2 })
      const t = tag(id, atk)
      expect(out.nHit, `${t}：站在 ${(outerOf(f.hitbox) + lungeTravel(f) + 3).toFixed(2)}m 外还被打中 ⇒ 够不够得着不由「外沿＋前冲」说了算`).toBe(0)
      expect(slow.nHit, `${t}：第 ${f.activeEnd + 2} 拍才跨进盒子（窗口尾 ${f.activeEnd}）不许补打`).toBe(0)
      expect(out.clear, `${t}：打不着人也不许改变收手拍（还是 recovery=${f.recovery}）`).toBe(f.recovery)
      expect(slow.clear, `${t}：跨进得太晚同样不许改变收手拍`).toBe(f.recovery)
      done.push(t)
    }
    console.log(`\n#### 两面都成立的近战式：${done.length} 式（盒外一站到底 ＋ 过窗尾才跨进来）`)
    expect(done.length, '这条腿跑到的式数必须等于派生的近战名册').toBe(POP_MELEE.length)
  })

  it('§9 停顿：带 hitStopMs 的每一式，欠的帧由窗后还 ⇒ 收手拍一格不挪', () => {
    const done: string[] = []
    for (const { id, atk } of POP_STOP) {
      const f = registry.get<EnemyData>(id).attacks.find((a) => a.id === atk)!.frames!
      const r = runOne(id, atk)
      const t = tag(id, atk)
      expect(r.hit, `${t}：停顿不许改变命中那一拍（activeStart=${f.activeStart}）`).toBe(f.activeStart)
      expect(r.clear, `${t}：停顿欠 ${Math.round(f.hitStopMs! * TICK_HZ / 1000)} 拍，收手拍仍是 recovery=${f.recovery}`).toBe(f.recovery)
      // 判据 1 的敌人侧：停顿是「窗后还债」，不是「窗内少给几拍」。窗在世界时间里的宽度由
      // 逐拍采样的 tick 现数——窗尾那两格若能被按住，这里的读数就多两格（臂 A7 量到的正是这一格）。
      const width = r.samples.filter((v) => v >= f.activeStart && v <= f.activeEnd).length
      expect(width, `${t}：判定窗在世界时间里该占 activeEnd−activeStart+1=${f.activeEnd - f.activeStart + 1} 拍，读到 ${width}`).toBe(f.activeEnd - f.activeStart + 1)
      done.push(`${t} hitStop=${f.hitStopMs}ms/${Math.round(f.hitStopMs! * TICK_HZ / 1000)}拍 hit=${r.hit} clear=${r.clear} 窗宽 ${width}/${f.activeEnd - f.activeStart + 1}`)
    }
    console.log(`\n#### §9 停顿（攻方那一半）${done.length} 式\n${done.join('\n')}`)
    expect(done.length, '这条腿跑到的式数必须等于派生的停顿名册').toBe(POP_STOP.length)
  })

  it('§14.6 定调 1.15×（真叠唱当施主）：能提前落刀，但不许跨过判定窗第一格', () => {
    const aura = registry.get<EnemyData>('en_refrein').ai.buffAura!
    expect(aura.attackSpeedMul, '定调那一格的攻速乘数（表）').toBeCloseTo(1.15, 10)
    for (const [id, atk] of [['en_murkshell', 'bite'], ['en_tympanus', 'mallet'], ['en_hanged_knight', 'sway']] as const) {
      const one = runOne(id, atk)
      const fast = runOne(id, atk, { aura: true })
      const f = fast.f
      const t = tag(id, atk)
      expect(fast.patronData, '施主本身得是一只真叠唱（§14.6 那张 buffAura 表的主人）').toBe('en_refrein')
      expect(fast.buffFrom, `${t}：这一趟没人给它定调（光环没成立，下面全是空判）`).toBe(fast.patron)
      expect(fast.buffMul, `${t}：挂上来的乘数该是表里那一格`).toBeCloseTo(aura.attackSpeedMul, 10)
      expect(fast.clear, `${t}：1.15× 的收手该比 1.0× 那一拍（${one.clear}）早`).toBeLessThan(one.clear)
      const skipped = fast.samples.findIndex((v, i) => i > 0 && fast.samples[i - 1] < f.activeStart && v > f.activeStart)
      expect(skipped, `${t}：第 ${skipped} 拍直接从窗口外跨到窗口后（判定窗被加速扣掉了一格）`).toBe(-1)
      expect(fast.hitFrame, `${t}：命中那一刻的**帧**仍恰好是 activeStart=${f.activeStart}，读到 ${fast.hitFrame}`).toBe(f.activeStart)
      expect(fast.hit, `${t}：命中在世界时间里可以提前（1.0× 是第 ${one.hit} 拍），但不许晚`).toBeLessThanOrEqual(one.hit)
      const live = (x: Row): number => x.samples.filter((v) => v >= f.activeStart && v <= f.activeEnd).length
      console.log(`${t} ‖ 1.0× hit=${one.hit} clear=${one.clear} 窗内 ${live(one)} 拍` +
        ` ｜ 1.15× hit=${fast.hit} noise=${fast.noise} clear=${fast.clear} 窗内 ${live(fast)} 拍` +
        ` 收手提前 ${one.clear - fast.clear} 拍`)
    }
  })

  it('§15.2 过载期前摇 −20%：落刀提前，判定窗与收势一拍不短', () => {
    const atk = 'noBeatLunge' // finale 白名单里的近战式（阶段换的是招式白名单与倍率载体，不是伤害）
    const one = runOne('en_hersil', atk)
    const fast = runOne('en_hersil', atk, { finale: true })
    const f = fast.f
    const phase = registry.get<EnemyData>('en_hersil').boss!.phases[2]
    expect(phase.startupMul, '过载期那一格（表）').toBe(0.8)
    expect(fast.phase, '过载期那条腿必须先真的跳进 P3（阶段机没走成，下面全是空判）').toBe(2)
    expect(fast.startEnd, `过载期的落刀该比 1.0× 的第 ${one.startEnd} 拍早`).toBeLessThan(one.startEnd)
    expect(Math.abs(fast.startEnd - f.startup * phase.startupMul!),
      `前摇 ×0.8 该贴着 startup×0.8=${(f.startup * 0.8).toFixed(2)} 拍（整数攒帧容一拍），读到第 ${fast.startEnd} 拍`).toBeLessThanOrEqual(1)
    expect(fast.clear - fast.startEnd, '判定窗＋收势在世界时间里一格没短（§15.2「更早落刀不该换来更长的破绽窗」）')
      .toBe(f.recovery - f.startup)
    console.log(`en_hersil/${atk} ‖ 1.0× 落刀=${one.startEnd} 收手=${one.clear} 破绽=${one.clear - one.startEnd} 拍` +
      ` ｜ 过载 落刀=${fast.startEnd} 收手=${fast.clear} 破绽=${fast.clear - fast.startEnd} 拍` +
      `（提前 ${one.startEnd - fast.startEnd} 拍，窗口+收势 1.0×=${f.recovery - f.startup}）`)
  })

  it('§2.1 命中帧量化：自己出手的那一串，命中踩在拍点上（量的是命中，不是起手）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: 0 }, 'probe') as Enemy
    e.stats.hpMax = e.stats.hp = 999999
    w.player.pos = { x: 0, y: 0, z: 1.4 }
    const offs: number[] = []
    const stop = bus.on('combat.hit', (p) => {
      if (p.victimId !== 'player' || p.attackerId !== e.id) return
      const spec = e.attack?.spec
      if (!spec?.beat || spec.onGrid === false) return
      offs.push(w.rhythm.offsetFromBeatGrid(spec.beat))
    })
    for (let i = 0; i < 2400; i++) { w.player.stats.hp = 999999; w.tick(1) }
    stop()
    console.log(`\n#### §2.1 命中离拍点（拍）${offs.length} 记：[${offs.map((v) => v.toFixed(4)).join(', ')}]  beatTicks=${BEAT_TICKS.toFixed(4)}`)
    expect(offs.length, '自己出手的命中至少要有几记可量（0 记就是空判）').toBeGreaterThanOrEqual(3)
    expect(Math.max(...offs), `最偏的一记离拍点 ${Math.max(...offs).toFixed(4)} 拍——§2.1 要的是命中帧踩在拍点上`).toBeLessThan(1)
    w.ai.despawn(e.id)
  })

  it('前冲那一格：除数是「位移带的帧数」，铺满第 1..activeEnd 拍 ⇒ 净落点就是表里那一格（对照腿＝把 lunge 那一格抹掉再跑一趟）', () => {
    const rows = POP_LUNGE.map(({ id, atk }) => {
      const data = registry.get<EnemyData>(id)
      const f = data.attacks.find((a) => a.id === atk)!.frames!
      return {
        t: tag(id, atk), data, f,
        on: runOne(id, atk, { mode: 'far' }),
        off: runOne(id, atk, { mode: 'far', noLunge: true })
      }
    })
    const lines: string[] = []
    const bad: string[] = []
    for (const { t, data, f, on, off } of rows) {
      // 带 = `1 .. min(activeEnd, recovery)`（生产上那一条带：带尾被这一式自己的收势截断）
      const bandEnd = Math.min(f.activeEnd, f.recovery)
      const stride = f.lunge! / Math.max(1, bandEnd)
      const elig = on.samples
        .map((tk, i) => ({ tk, g: on.ghost[i] }))
        .filter((x) => x.tk >= 1 && x.tk <= bandEnd && !x.g).length
      // 两次跑只差 `lunge` 那一格 ⇒ 这个差值就是前冲自己拉近的米数，别移动（追击/背退/虚体）自己被减掉
      const net = on.approach - off.approach
      const why: string[] = []
      if (!data.ai.beatGhost && elig !== bandEnd) why.push(`位移带 ${bandEnd} 帧里只有 ${elig} 帧不虚体，虚体闸门不是它的机制`)
      if (Math.abs(net - elig * stride) > 1e-9) {
        why.push(`前冲净额 ${net.toFixed(6)}m ≠ 每帧步长 ${stride.toFixed(6)}m × 带内实走帧数 ${elig}`)
      }
      if (why.length) bad.push(`${t}：${why.join('；')}`)
      lines.push(`${t} 表 lunge=${f.lunge} S${f.startup}/A${f.activeEnd} ⇒ 前冲净 ${net.toFixed(4)}m／${elig} 帧` +
        `（每帧 ${(net / elig).toFixed(4)}，表口径 ${stride.toFixed(4)}）｜对表 ${(net / f.lunge!).toFixed(4)}×` +
        `｜对照腿净 ${off.approach.toFixed(4)}m${data.ai.beatGhost ? '（§14.5 虚体闸关掉的那些帧不计）' : ''}`)
    }
    console.log(`\n#### 含 lunge 的 ${rows.length} 式：前冲净额 ⇄ 表口径（敌人侧的除数是位移带帧数＝带长）\n${lines.join('\n')}`)
    expect(bad.join('\n'), '前冲净额 = lunge/带长 × 带内实走帧数；对不上的式子逐点名见上').toBe('')
    expect(rows.length, '这条腿跑到的式数必须等于派生的 lunge 名册').toBe(POP_LUNGE.length)
    // 每一式的净落点都**恰好**是表里那一格（KI-320 裁决：lunge ＝ 这一式总共走多少米）。
    // 虚体闸（§14.5）会把那些帧的位移吃掉，所以只有不带闸的那几式能要求分毫不差。
    const exact = rows.filter(({ data }) => !data.ai.beatGhost)
    expect(exact.length, '能要求「分毫不差」的式数（带虚体闸的那几只吃掉位移，不在那儿）').toBeGreaterThanOrEqual(10)
    for (const { t, f, on, off } of exact) {
      const net = on.approach - off.approach
      expect(Math.abs(net - f.lunge!),
        `${t}：前冲净落点 ${net.toFixed(6)}m 必须等于表里那一格 ${f.lunge}m（KI-320：除数＝位移带帧数）`).toBeLessThan(1e-9)
    }
  })

  it('账本那个「11 处」有机器读者：attack.tick 的比较点全库普查', () => {
    const CMP = /attack\.tick\s*(?:<=|>=|<|>|===|!==)/g
    const read = (p: string): number => (readFileSync(`${ROOT}${p}`, 'utf8').match(CMP) ?? []).length
    const legFile = 'src/ai/Enemy.ts'
    const cmpLeg = read(legFile)
    const workplan = readFileSync(`${ROOT}docs/WORKPLAN.md`, 'utf8')
    const row = workplan.split(/\r?\n/).find((l) => l.includes('KI-317') && l.includes('attack.tick'))
    expect(row, 'WORKPLAN 里那一格（KI-317 的按拍计数普查）必须还在').toBeTruthy()
    const named = row!.match(/attack\.tick[^\d]{0,24}(\d+)/)
    expect(named, `WORKPLAN 那一格得写出「attack.tick 窗口判定 N」这个数`).toBeTruthy()
    const doc = Number(named![1])
    const visuals = read('src/world/ActorVisuals.ts')
    const debuggerCmp = read('src/tools/AIDebugger.ts')
    console.log(`\n#### attack.tick 比较点普查：${legFile}=${cmpLeg}（ai.update 那条腿） 表现层=${visuals} 面板=${debuggerCmp} WORKPLAN 写=${doc}`)
    expect(cmpLeg, `WORKPLAN 写 ${doc} 处，实装读到 ${cmpLeg} 处——改哪一头都得同时改另一头`).toBe(doc)
    expect(visuals, '表现层那两格读的是同一个 tick（KI-315 线框/亮灭），数目变了要重新点名').toBe(2)
    expect(debuggerCmp, 'F4 面板那一格只是把数打印出来，不参与判定').toBe(0)
  })
})
