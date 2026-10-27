import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { FrameData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-320：**玩家侧的前冲落点**第一次有了机器读者（敌人侧那一条在
 * `tests/flow/enemy-attack-frame-ticks.test.ts` 的「前冲那一格」那条腿里）。
 *
 * ## 那一格说的是什么
 *
 * `frames.lunge` 那一格此前**没有定义**（`docs/combat.md` 从没写过它是什么），
 * 而两侧各拿一把不同的尺去读它：敌人侧每拍步长＝`lunge ÷ (activeEnd − startup)`、
 * 却从第 1 拍一路走到第 `activeEnd` 拍 ⇒ 净米数被放大 **2.50×～17.67×**；
 * 玩家侧每拍步长＝`lunge ÷ activeEnd`、而位移带是 `startup .. startup + activeEnd`
 * （共 `activeEnd + 1` 帧）⇒ 落点是表值的 **×(activeEnd+1)/activeEnd**（+2.4%～+6.7%）。
 *
 * **裁决**：`frames.lunge` ＝ **这一式的前冲总共走多少米**；除数＝**这条位移带的帧数**。
 * 于是两侧的净落点都**恰好**是表里那一格。
 *
 * ## 那一把尺子长什么样
 *
 * **位移带**＝这一式真正在往前蹭的那几拍，两侧各按自己那份帧序的约定：
 * - 敌人侧：`1 .. min(activeEnd, recovery)`（前冲从第 1 拍就开始铺）⇒ 带长 = `min(activeEnd, recovery)`；
 * - 玩家侧：`startup .. min(startup + activeEnd, recovery)`（老约定：带比判定窗晚 `startup` 格起算）
 *   ⇒ 带长 = `min(startup + activeEnd, recovery) − startup + 1`。
 *
 * **带尾被这一式自己的收势截断时，带长跟着截断后的长度算**——不截断的话，走不完的那截
 * 就变成整式少走那几帧的距离（表上写着 2m、实走 1.85m）。玩家侧有 **5 式**带尾超过收势
 * （`ms_sword/run`、`ms_greatsword/l1`、`ms_greatsword/h`、`ms_spear/h`、`ms_needlesilence/l1`），
 * 敌人侧 **0 式**（23 式带 lunge 的，收势都晚于判定窗尾）。
 *
 * ## 为什么这一份只管玩家侧
 *
 * 敌人侧那条腿在 KI-319 那份文件里（它量的就是敌人的前冲净额）。这一份管玩家侧，
 * 一份判定一个主人（KI-320 那一族的规矩）。
 *
 * ## 分母从表里现推
 *
 * 名册＝**所有 moveset 的所有 action 里带 `lunge` 那一格的**（`registry.ids('ms_')`
 * × `moveset.actions`），武器由 `weapons.json` 的 `movesetId` 反查 ⇒ 新增一式不必改腿。
 * 跑到的式数必须等于派生名册（少跑一式就红）。
 *
 * ## 两条腿各自挡一种谎
 *
 * ① **自由出手那条腿**：落点必须**分毫不差**等于表值（1e-9）。
 *    它挡的是"除数又变回窗长"——那种写法在挥空时就已经多走一拍。
 * ② **被打断那条腿**：§9 的停顿会**按住**出手方的招式帧几格、随后用**双格步**还债
 *    （`advanceActionFrames`：按住 0 帧、还债 2 帧），而这两件事都落在**位移带里**
 *    （窗尾之后 ⇒ 带内）。带内的帧数因此不许变——变一点点，落点就不是表里那一格了。
 *    打断用的是 `player.freezeAction`（`CombatManager` 命中时调的就是这一个口），
 *    这里直接调它，好让**每一式都在同一格被打断**；命中那一路由
 *    `tests/flow/hitstop.test.ts` 那条腿量（真打中 vs 挥空，落点必须一样）。
 */

registerGameData()

/** 一个只有玩家的小世界：真 `PlayerController` ＋ 真帧序（没有怪 ⇒ 挥空） */
function makeWorld(weaponId: string, movesetId: string) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const moveset = registry.get<MovesetData>(movesetId)
  const player = new PlayerController(playerBase, weapon, moveset)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  function tick(): void {
    time.tick++
    time.step(TICK_DT)
    player.update(TICK_DT, time, input, time.tick, rhythm)
    frame.edges.clear()
    rhythm.update(TICK_DT)
  }
  return { time, rhythm, player, frame, tick }
}

type Row = {
  ms: string
  act: string
  f: FrameData
  weapon: string
  /** 落点＝这一式总共走了多少米 */
  land: number
  /** 这一式实际被打断的格数（0 ＝ 没被打断） */
  held: number
  /** 这一式走了几拍（世界时间里） */
  ticks: number
  /**
   * 这一式实际走的那条位移带**含几帧**（带尾被这一式自己的收势截断过）。
   * 名义带长是 `activeEnd + 1` 帧，而带尾 > `recovery` 的那 5 式走不到名义带尾 ⇒ 落点那条
   * 腿量的就是这一格（除数＝带长，带长随截断变）。
   */
  band: number
}

/** 这一式的位移带含几帧：带 = `startup .. min(startup + activeEnd, recovery)`（两端都含） */
function bandLength(f: FrameData): number {
  return Math.min(f.startup + f.activeEnd, f.recovery) - f.startup + 1
}

/** 派生的名册：所有 moveset 的所有 action 里带 `lunge` 那一格的 */
function roster(): { ms: string; act: string; f: FrameData; weapon: string }[] {
  const weapons = registry.ids('wp_').map((id) => registry.get<WeaponData>(id))
  const out: { ms: string; act: string; f: FrameData; weapon: string }[] = []
  for (const msId of registry.ids('ms_').sort()) {
    const ms = registry.get<MovesetData>(msId)
    const w = weapons.find((x) => x.movesetId === msId)
    if (!w) continue // 这一把没有武器 ⇒ 玩家拿不到这套招式（不进口册）
    for (const [act, f] of Object.entries(ms.actions)) {
      if (!f.lunge) continue
      out.push({ ms: msId, act, f, weapon: w.id })
    }
  }
  return out
}

/**
 * 出一式，量它的落点。
 * `stop` ＝ 在判定窗内那一格把出手方按停（§9 的停顿），走生产上那一个口。
 */
function runOne(ms: string, act: string, weapon: string, f: FrameData, stop: boolean): Row {
  const w = makeWorld(weapon, ms)
  const before = { x: w.player.pos.x, z: w.player.pos.z }
  const started = w.player.tryStartAction(act, w.time.tick + 1, w.rhythm)
  if (!started) throw new Error(`${ms}/${act}：出手失败（量具失效）`)
  let held = 0
  let applied = false
  let ticks = 0
  for (let i = 0; i < 400 && w.player.action; i++) {
    w.tick()
    ticks++
    const a = w.player.action
    if (!a) break
    if (stop && !applied && a.tick >= a.f.activeStart && a.tick <= a.f.activeEnd) {
      held = w.player.freezeAction(a.f.hitStopMs, a)
      applied = true
    }
  }
  return {
    ms,
    act,
    f,
    weapon,
    land: Math.hypot(w.player.pos.x - before.x, w.player.pos.z - before.z),
    held,
    ticks,
    band: bandLength(f),
  }
}

describe('KI-320 玩家侧的前冲落点＝帧表 `lunge` 那一格', () => {
  const list = roster()

  it('自由出手：每一式的落点分毫不差等于表里那一格（分母＝派生的名册）', () => {
    const rows: Row[] = list.map((r) => runOne(r.ms, r.act, r.weapon, r.f, false))
    const lines: string[] = []
    const bad: string[] = []
    for (const r of rows) {
      const diff = Math.abs(r.land - r.f.lunge!)
      if (diff > 1e-9) bad.push(`${r.ms}/${r.act}：落点 ${r.land.toFixed(6)}m ≠ 表值 ${r.f.lunge}m（差 ${diff.toExponential(2)}m）`)
      lines.push(`${r.ms}/${r.act}`.padEnd(26) + `表 ${String(r.f.lunge).padStart(5)}m  落点 ${r.land.toFixed(6)}m  差 ${diff.toExponential(2)}m  带 ${r.band} 帧`)
    }
    console.log(`\n#### 玩家侧前冲落点 ⇄ 表值（${rows.length} 式）\n${lines.join('\n')}`)
    expect(rows.length, '这条腿跑到的式数必须等于派生的名册').toBe(list.length)
    expect(rows.length, '名册不许是空集（空集时下面那条相等是空转）').toBeGreaterThanOrEqual(20)
    expect(bad.join('\n'), '落点必须分毫不差等于表里那一格（除数＝位移带的帧数）').toBe('')
  })

  it('被打断：§9 停顿按住的那几格与还债的双格步不许吃掉带内的帧（落点不变）', () => {
    const rows: Row[] = list.map((r) => runOne(r.ms, r.act, r.weapon, r.f, true))
    const lines: string[] = []
    const bad: string[] = []
    let stopped = 0
    for (const r of rows) {
      if (r.held > 0) stopped++
      const diff = Math.abs(r.land - r.f.lunge!)
      if (diff > 1e-9) bad.push(`${r.ms}/${r.act}：落点 ${r.land.toFixed(6)}m ≠ 表值 ${r.f.lunge}m（差 ${diff.toExponential(2)}m）`)
      lines.push(`${r.ms}/${r.act}`.padEnd(26) + `表 ${String(r.f.lunge).padStart(5)}m  落点 ${r.land.toFixed(6)}m  按住 ${r.held} 格  走了 ${r.ticks} 拍`)
    }
    console.log(`\n#### 玩家侧前冲落点 · 被打断（${rows.length} 式，其中 ${stopped} 式真被按停过）\n${lines.join('\n')}`)
    expect(stopped, '量具失效：没有一式真被按停过 ⇒ 下面那条「落点不变」是空转').toBeGreaterThanOrEqual(10)
    expect(bad.join('\n'), '被打断之后落点必须还是表里那一格（带内帧数不许变）').toBe('')
  })
})
