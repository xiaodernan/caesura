import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { Input } from '@/core/Input'
import { registerGameData, playerBase, regions } from '@/data'
import { registry } from '@/core/Registry'
import { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig, CameraMode, MODE_CONFIG } from '@/player/CameraRig'
import { Interactables } from '@/world/Interactables'
import { OcclusionField } from '@/core/Occlusion'
import type { MovesetData, WeaponData } from '@/data/schema'

/**
 * KI-151：**用摇杆一步步真的走**（WORKPLAN 阶段 5 唯一还挂着 ⬜ 的那一行，KI-010 剩下的那一半）。
 *
 * 病不是"摇杆没接"——`Input` 的摇杆读数早有测试（KI-105① 量按钮、KI-062 量 UI 意图通道），
 * 而是**整条链一次也没被走过**：摇杆读数 → 相机 → 玩家的屏幕前后 → 世界位移 → 交互焦点。
 * 每一段各自绿过，接缝没人量过。所以这里不测任何一段的**内部**，只把一颗可编程的手柄
 * 挂在真 `Input` 上，按真帧序（`poll` → `player.update` → `rig.update`，与 `src/main.ts` 同一次序）
 * 跑帧，读**玩家脚底下的位置**和**焦点里那个东西的 id**。
 *
 * 三条判据是这批的真内容，它们各挡一种不同的谎：
 *  · **死区不漂**：摇杆回中（含 0.15 的残余偏置）时，120 拍里位置**一个字节也不许变**。
 *    这条挡"手柄没回中就在原地滑"——摇杆游戏最常见的一种坏，只有真链路能看见。
 *  · **每拍位移不超上限**（冲刺表速 × dt，留 5% 余量）：这条挡"瞬移当走到了"。
 *    没有它，最后那条"走到铃姨跟前"可以被 `player.pos = 目标` 满足——那什么也没验证。
 *    里程表另钉下界（≥ 直线距离）：不许靠一次回退或一次传送凑出到达。
 *  · **转向吃的是相机不是玩家自己的 yaw**：右摇杆转头之后，同样"推前"落在世界里的方向
 *    必须跟着变（两趟位移向量的夹角 ≥ 20°）。这条挡"摇杆看与摇杆走各有主人"：
 *    镜头转了、人还照旧朝原方向走，就是那种"我以为我在往那边走"的手感灾难。
 *
 * 所有速度、半径、目标位置**全部现推**：`playerBase.moveSpeed/sprintSpeed/sprintCostPerSec`、
 * `Interactables.range`（组合根给的那一格）、铃姨的坐标从 `regions.json` 按 id 查。
 * 一个手钉的数都没有——手钉的数就是下一批的 KI-028。
 */

registerGameData()

class FakeEl {
  addEventListener(): void { /* 本文件只喂手柄，不喂键鼠 */ }
  requestPointerLock(): void { /* 与读数无关 */ }
}

let win: Record<string, ((e: unknown) => void)[]> = {}

/** 一颗可编程的手柄：`axes` = [左x, 左y, 右x, 右y]（标准映射），`buttons` 是被按住的位号 */
function pad(axes: number[] = [0, 0, 0, 0], buttons: number[] = []): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => [{
        axes,
        buttons: Array.from({ length: 19 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })),
        mapping: 'standard', connected: true,
      }],
    },
  })
}

const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))
const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z)

type Run = {
  input: Input
  player: PlayerController
  rig: CameraRig
  time: GameTime
  rhythm: RhythmClock
  /** 改摇杆与按键的读数：下一拍生效 */
  set(left?: [number, number], right?: [number, number], buttons?: number[]): void
  /** 真帧序走一拍 */
  tick(): void
}

/**
 * 一次跑测的四件套：真 `Input`、真 `PlayerController`、真 `CameraRig`、真帧序。
 *
 * 相机**先暖 40 拍**（零输入）：`posSmooth` 从 (0,2,0) 起步，头几拍的 `camYawRef` 读的是一个
 * 还没跟上的机位 ⇒ 方向不准。暖机本身不是免费的假设——"零输入里玩家不许动"由第二条判据量。
 */
function newRun(): Run {
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>('ms_sword')
  const player = new PlayerController(playerBase, weapon, moveset)
  const rig = new CameraRig()
  rig.shakeIntensity = 0 // 设置项滑杆的读数会污染断言：这里量的是位移，不是震镜
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  player.floorY = 0
  let left: [number, number] = [0, 0]
  let right: [number, number] = [0, 0]
  let buttons: number[] = []
  const run: Run = {
    input, player, rig, time, rhythm,
    set(l, r, b) {
      if (l) left = l
      if (r) right = r
      if (b) buttons = b
    },
    tick() {
      pad([left[0], left[1], right[0], right[1]], buttons)
      time.tick++
      input.poll(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      rig.update(TICK_DT, player, input.frame.look, null, TICK_DT)
    },
  }
  for (let i = 0; i < 40; i++) run.tick() // 暖机：零输入
  return run
}

/**
 * **把镜头对准某个世界点**（右摇杆转，转的是相机自己的 yaw）。
 *
 * 为什么转的是 `rig.yaw` 而不是 `camYawRef`：`camYawRef` 是相机的**平滑机位**相对玩家的方位角，
 * 镜头从旧机位飞到新机位的那一段里它是**乱读**的——第一版就栽在这里：营地那堵墙离出生点 170m，
 * 镜头飞过去的那几百拍里方位角一路乱转 ⇒ 人歪了 12.5m 撞在墙的**侧面**，量到的根本不是
 * "正对着那面墙停住"这件事（反向实测臂 A 就是这一条：把落位那一步去掉，臂立刻抓住它）。
 * `rig.yaw` 是摇杆积分出来的那个数：它是镜头**要去**的方向，读它不会读乱。
 *
 * **推力是现量的**：先打一格 0.2 的右摇杆，量出镜头转了多少，再按那一格反算"要转到目标该给多少推力"
 * ——生产常数（`Input` 的 2.4、`MODE_CONFIG` 的 `yawDamp`、死区 0.2）一个都不手钉。
 * 于是**一拍正好落到目标**（而不是在死区分辨率附近来回摆：死区外最小的一格是 0.2，
 * 摆一次的残差是 0.024 rad ⇒ 走 4.7m 就是 0.11m 的歪，"正对着那面墙"这件事就量不到了）。
 *
 * 转完还要**等镜头落位**（零输入几拍，等 `posSmooth` 追上机位）：镜头没落位时 `camYawRef`
 * 还指着旧机位 ⇒ 人按的还是旧方向。落位的判据是**机位不再动了**，不是"角度对上了"——
 * 镜头从旧机位飞过来的那一路上会**路过**目标角度，拿角度当落位会提前退出（第一版的第二个坑）。
 */
function aimCamera(r: Run, x: number, z: number): void {
  // 增益现量：一格 0.2 的推力能把镜头转多少（rad / 单位推力）
  const y0 = r.rig.yaw
  r.set([0, 0], [0.2, 0])
  r.tick()
  const gain = Math.abs(r.rig.yaw - y0) / 0.2
  r.set([0, 0], [0, 0])
  for (let i = 0; i < 900; i++) {
    const dx = x - r.player.pos.x
    const dz = z - r.player.pos.z
    const dist = Math.hypot(dx, dz)
    const want = Math.atan2(-dx / dist, -dz / dist)
    const err = wrapPi(want - r.rig.yaw)
    if (Math.abs(err) < 0.005) break
    // 需要的推力 = 误差 / 增益（`yaw -= look.dx * yawDamp * dt` ⇒ 推力与转角反号）
    let push = err / gain
    if (Math.abs(push) < 0.2) push = Math.sign(push) * 0.2 // 死区外最小的一格
    r.set([0, 0], [Math.max(-1, Math.min(1, -push)), 0])
    r.tick()
  }
  r.set([0, 0], [0, 0])
  // 等镜头落位：机位不再动了就是落位了
  let prev = { x: r.rig.cam.position.x, y: r.rig.cam.position.y, z: r.rig.cam.position.z }
  for (let i = 0; i < 900; i++) {
    r.tick()
    const p = r.rig.cam.position
    if (Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) < 0.0005) break
    prev = { x: p.x, y: p.y, z: p.z }
  }
}

/** 走 n 拍并返回这 n 拍里走过的路程 */
function walk(run: Run, n: number): { d: number; odometer: number } {
  const from = { ...run.player.pos }
  let odometer = 0
  let prev = { ...run.player.pos }
  for (let i = 0; i < n; i++) {
    run.tick()
    odometer += dist2(run.player.pos, prev)
    prev = { ...run.player.pos }
  }
  return { d: dist2(run.player.pos, from), odometer }
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) } }
  Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
})

beforeEach(() => { win = {}; pad() })

const BELL = regions.find((r) => r.id === 'rg_resthold')!.interactables.find((i) => i.id === 'npc_belltongue')!

describe('KI-151 摇杆 → 相机 → 位移 → 焦点：整条链真的走得通', () => {
  it('推左摇杆 = 走：60 拍走过的距离 == 表速 × 1 秒，而且朝前不朝后（数从 player.json 现推）', () => {
    const r = newRun()
    r.set([0, -1], [0, 0]) // 左摇杆推到底 = 屏幕向前
    const from = { ...r.player.pos }
    const { d } = walk(r, 60)
    expect(d, `60 拍该走 ${playerBase.moveSpeed}m（表里 ${playerBase.moveSpeed}/s）`)
      .toBeCloseTo(playerBase.moveSpeed, 1)
    // 方向也得钉：只量"走了多远"分不清向前与向后（把 `moveY` 的符号翻过来照样绿）
    const camYaw = r.player.camYawRef ?? r.player.yaw
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw) // 屏幕向前的世界方向（与实装同一支笔）
    const dot = ((r.player.pos.x - from.x) * fx + (r.player.pos.z - from.z) * fz) / Math.max(d, 1e-9)
    expect(dot, '推前必须往屏幕的前方走 —— 符号翻了就是往后退').toBeGreaterThan(0.99)
    expect(r.player.moveSpeed, '走的时候指令速度必须是那一格（相机靠它决定镜头拉多远）')
      .toBeCloseTo(playerBase.moveSpeed, 1)
  })

  it('摇杆回中不漂：四轴都停在死区内（0.15）时，120 拍里位置一个字节也不许变', () => {
    const r = newRun()
    r.set([0.15, -0.15], [0.15, -0.15])
    const before = JSON.stringify(r.player.pos)
    walk(r, 120)
    expect(r.input.frame.move.x + r.input.frame.move.y, '死区内的读数必须折成 0').toBe(0)
    expect(JSON.stringify(r.player.pos), '摇杆回中后位置必须一字不变（漂移 = 手柄没回中就在原地滑）').toBe(before)
    expect(r.player.moveSpeed, '指令速度也得归零：相机拿着一拍前的速度会把镜头往后拉')
      .toBe(0)
  })

  it('松手就停：按住 30 拍再松开，下一拍不再前进（这套积分没有惯性）', () => {
    const r = newRun()
    r.set([0, -1], [0, 0])
    walk(r, 30)
    const at = { ...r.player.pos }
    r.set([0, 0])
    r.tick()
    expect(dist2(r.player.pos, at), '松手那一拍不许再走').toBeLessThan(1e-9)
    expect(r.player.moveSpeed).toBe(0)
  })

  it('按住 LB（键 7）冲刺：单位位移 == 冲刺表速，且体力按 sprintCostPerSec 那一格掉', () => {
    const r = newRun()
    /**
     * 先把体力回复的乘子拧到 0，再量消耗。
     *
     * 不是绕路：`rpg.staminaRegenMul` 是**声明过的通道**（`defaultMods` 的字段，装备词缀与超载惩罚
     * 都写在它上面），而 `stats.update` 每拍按它回一次气。不拧的话满体力那一格根本量不到消耗——
     * 实测净掉只有 0.167 = **恰好一拍的消耗**（10/60）：每一拍的消耗都被上一拍的回复补回去了，
     * 只有最后一拍之后没有下一拍来救。所以那一条读数量的其实是"跑测结束在哪一拍"，不是这张表。
     */
    r.player.rpg.staminaRegenMul = 0
    r.set([0, -1], undefined, [7])
    const st0 = r.player.stats.stamina
    const { d } = walk(r, 60)
    expect(d, `冲刺 1 秒该走 ${playerBase.sprintSpeed}m`).toBeCloseTo(playerBase.sprintSpeed, 1)
    expect(d / playerBase.moveSpeed, '冲刺必须比走快，否则 7 号键是个装饰').toBeGreaterThan(1.2)
    expect(st0 - r.player.stats.stamina, `体力掉的必须是表里的 ${playerBase.sprintCostPerSec}/秒`)
      .toBeCloseTo(playerBase.sprintCostPerSec, 1)
  })

  it('右摇杆转头之后，"推前"落在世界里的方向跟着变（看与走共用同一台相机）', () => {
    const a = newRun()
    a.set([0, -1])
    const fromA = { ...a.player.pos }
    walk(a, 60)
    const dirA = Math.atan2(a.player.pos.x - fromA.x, a.player.pos.z - fromA.z)

    const b = newRun()
    b.set(undefined, [-1, 0]) // 右摇杆推到左：镜头转
    walk(b, 40)
    b.set([0, -1], [0, 0]) // 再推左摇杆向前
    const fromB = { ...b.player.pos }
    walk(b, 60)
    const dirB = Math.atan2(b.player.pos.x - fromB.x, b.player.pos.z - fromB.z)
    expect(wrapPi(b.rig.yaw - a.rig.yaw), '右摇杆必须真把镜头转了').not.toBeCloseTo(0, 2)
    expect(Math.abs(wrapPi(dirB - dirA)), '转头之后的"前"必须是个不同的世界方向（≥20°）')
      .toBeGreaterThan(0.35)
  })

  it('真路线：只用摇杆从落点走到铃姨跟前 —— 焦点读出 npc_belltongue，且一步都不许是瞬移', () => {
    const r = newRun()
    const interact = new Interactables(regions, () => true, 6)
    const maxStep = playerBase.sprintSpeed * TICK_DT * 1.05
    let odometer = 0
    let prev = { ...r.player.pos }
    let ticks = 0
    let reached = false
    while (ticks < 4000) {
      if (interact.focus(r.player.pos)?.id === 'npc_belltongue') { reached = true; break }
      const dx = BELL.pos.x - r.player.pos.x
      const dz = BELL.pos.z - r.player.pos.z
      const dist = Math.hypot(dx, dz)
      // 闭环：只用摇杆。朝向没对上就原地转，对上了就推前。
      const want = Math.atan2(-dx / dist, -dz / dist)
      const err = wrapPi(want - (r.player.camYawRef ?? r.player.yaw))
      if (Math.abs(err) > 0.15) r.set([0, 0], [err > 0 ? -1 : 1, 0])
      else r.set([0, -1], [0, 0])
      r.tick()
      const step = dist2(r.player.pos, prev)
      expect(step, `第 ${ticks} 拍走了 ${step.toFixed(3)}m，超过冲刺上限 —— 到达不是走出来的`)
        .toBeLessThanOrEqual(maxStep)
      odometer += step
      prev = { ...r.player.pos }
      ticks++
    }
    interact.dispose()
    const straight = Math.hypot(BELL.pos.x, BELL.pos.z)
    expect(reached, `${ticks} 拍（${(ticks / 60).toFixed(1)} 秒）也没走到铃姨跟前`).toBe(true)
    expect(dist2(r.player.pos, BELL.pos), '焦点半径读的是组合根给的那一格，不手钉')
      .toBeLessThanOrEqual(interact.range)
    expect(odometer, `走到焦点半径（${interact.range}m）边上就算到了，所以走过的路至少得是直线减去那一圈`)
      .toBeGreaterThanOrEqual(straight - interact.range)
    expect(odometer / straight, '绕路不许超过直线的 2.5 倍（控制器失准的读数）').toBeLessThan(2.5)
    expect(ticks / 60, `这一趟 ${(ticks / 60).toFixed(1)} 秒走完 ${straight.toFixed(1)}m`).toBeLessThan(30)
  })

  /**
   * **碰撞那一半**（KI-154 落地后接上）：前面六条量的是"摇杆 → 相机 → 位移 → 焦点"，
   * 这一条把**墙**也放进链里：**用摇杆顶一堵 authored 的塌墙，人得停在墙前**。
   *
   * 为什么值得单独一条：`gamepad-walk` 此前走的是**空地路线**，于是"撞墙会停"这件事
   * 在这条链上**一次也没被量过**——链的每一段各自绿过，接缝没人走过（与 KI-151 那行同一形状）。
   *
   * 名册是**组合根那一份**（`core/Occlusion` 的 `OcclusionField`，`syncAuthored(region)`）——
   * 玩家侧、箭侧、视线侧、敌人绕路侧读的是同一本（KI-070 那一行的规矩），
   * 这条腿注入的就是它 ⇒ 测的不是"某套假几何"，是**生产用的那一本**。
   */
  it('摇杆顶墙：人停在墙面 + 半径上，没有穿过去（链上第一次量"撞墙会停"）', () => {
    const r = newRun()
    const camp = regions.find((x) => x.id === 'rg_brokenbar_camp')!
    const wall = camp.walls!.find((w) => w.id === 'wb_camp_watch_screen')!
    // 名册：与组合根同一本、同一份注入方式
    const occ = new OcclusionField()
    occ.syncAuthored(camp)
    r.player.occluders = () => occ.list()
    // 站在墙的北侧 6m，**正对着**墙（正对着 ⇒ 打的是**面**，不是墙角）
    r.player.pos.x = wall.pos.x
    r.player.pos.y = wall.pos.y
    r.player.pos.z = wall.pos.z + 6
    r.player.floorY = wall.pos.y
    // **先把镜头转到正对墙**（见 `aimCamera`）：相机的 yaw 不是 0（默认 0.6 ⇒ 屏幕前偏着 20°），
    // 不瞄准就推前，人会斜着撞在墙的**侧面**上 ⇒ 量到的就不是"正对着那面墙停住"这件事了
    // （第一版就栽在这里：歪了 12.5m）。
    aimCamera(r, wall.pos.x, wall.pos.z)
    const radius = r.player.hitTarget().radius
    const stopZ = wall.pos.z + wall.size.z / 2 + radius
    r.set([0, -1], [0, 0])
    // 撞到墙**那一刻**的横向位置：滑行是 KI-154 的设计（MTV 把进墙那一轴推回、切向那一轴保留
    // ⇒ 人贴着墙会**沿着墙滑**），所以"歪不歪"必须在**接触之前**量；接触之后量到的是合法的那条滑。
    let hitX: number | null = null
    for (let i = 0; i < 240; i++) {
      r.tick()
      if (hitX === null && r.player.pos.z <= stopZ + 1e-6) hitX = r.player.pos.x
    }
    expect(hitX, '这一趟该撞到墙（没撞上 ⇒ 后面那几条量的是别的东西）').not.toBeNull()
    expect(Math.abs(hitX! - wall.pos.x), '撞到墙那一刻人该是正对着那面墙的（横向偏差）').toBeLessThan(0.1)
    expect(Math.abs(r.player.pos.z - stopZ), '人该**贴着**墙（墙面 + 半径）停住').toBeLessThan(0.05)
    expect(r.player.pos.z, `人该停在墙前（z = ${stopZ}），不该穿到墙后`).toBeGreaterThan(wall.pos.z)
    expect(Math.abs(r.player.pos.x - wall.pos.x), '人还站在这堵墙的正面（不许滑到墙角那一侧去）')
      .toBeLessThan(wall.size.x / 2)
  })

  it('对照：同一段路但**没有名册** ⇒ 人穿过去（这条钉住"上一条量的是碰撞，不是走路"）', () => {
    const r = newRun()
    const camp = regions.find((x) => x.id === 'rg_brokenbar_camp')!
    const wall = camp.walls!.find((w) => w.id === 'wb_camp_watch_screen')!
    // **不注入名册**（默认注入的就是空清单：没有墙的地方不该有任何阻挡）
    r.player.pos.x = wall.pos.x
    r.player.pos.y = wall.pos.y
    r.player.pos.z = wall.pos.z + 6
    r.player.floorY = wall.pos.y
    aimCamera(r, wall.pos.x, wall.pos.z)
    r.set([0, -1], [0, 0])
    for (let i = 0; i < 240; i++) r.tick()
    expect(r.player.pos.z, '没有名册 ⇒ 人穿过墙（这一条是上一条的反向证人）').toBeLessThan(wall.pos.z)
  })

  /**
   * **镜头那一半**（KI-165）：人背对着墙站 ⇒ 镜头被拉回墙前（不穿到墙后）。
   *
   * 为什么值得单独一条：`CameraRig.collideAndRebound` 那一支**从来没被量过**——组合根把名册
   * 注进镜头（`src/main.ts` 的 `rig.setOccluders(combat.occlusion.list())`，与玩家、箭、视线同一本），
   * 但仓库里没有一条腿问过"镜头到底停在哪"。人站在塌墙背后时，镜头要么穿墙（画面穿帮）
   * 要么被拉回来（画面正常）——今天没人说得清是哪一种。
   *
   * 摆位：**人站在墙的北侧 3m、面朝北**（背对着墙）⇒ 镜头在他身后，也就是墙的南边 ⇒
   * 那条线（视线点到机位）**穿过墙** ⇒ 名册该把它截在墙面上。
   *
   * 偏置与半径**全部现推**：`MODE_CONFIG` 里那一格的 `distBase`／`collisionRadius`／
   * `collier`（`CameraMode.Exploration`），镜头的俯角读 `rig.pitch` 自己那份 ⇒ 一个手钉的数都没有。
   */
  it('人背对着墙站：镜头被拉回墙前，不穿到墙后（镜头那一支第一次被量）', () => {
    const r = newRun()
    const camp = regions.find((x) => x.id === 'rg_brokenbar_camp')!
    const wall = camp.walls!.find((w) => w.id === 'wb_camp_watch_screen')!
    const occ = new OcclusionField()
    occ.syncAuthored(camp)
    // 组合根那两行接线：**同一本**名册，镜头与玩家各拿一份活引用
    r.player.occluders = () => occ.list()
    r.rig.setOccluders(occ.list())
    // 人站在墙的北侧 3m（北 = z 大的那一边），**面朝北** ⇒ 镜头在他身后，也就是墙的南边
    r.player.pos.x = wall.pos.x
    r.player.pos.y = wall.pos.y
    r.player.pos.z = wall.pos.z + 3
    r.player.floorY = wall.pos.y
    // 面朝北：把镜头转向北边那一点（相机在身后 ⇒ 机身偏置落在南边 ⇒ 那条线穿过墙）
    aimCamera(r, wall.pos.x, wall.pos.z + 13)
    const cfg = MODE_CONFIG[CameraMode.Exploration]
    const northFace = wall.pos.z + wall.size.z / 2
    const camZ = r.rig.cam.position.z
    expect(camZ, `镜头该停在墙的北面（z = ${northFace} 那一侧），不该穿到墙后`).toBeGreaterThan(northFace)
    expect(Math.abs(camZ - (northFace + cfg.collisionRadius)), '镜头该贴在墙面上（墙面 + 镜头自己的半径）')
      .toBeLessThan(0.2)
  })

  it('对照：没有名册 ⇒ 镜头穿到墙后（这条钉住"上一条量的是名册，不是相机"）', () => {
    const r = newRun()
    const camp = regions.find((x) => x.id === 'rg_brokenbar_camp')!
    const wall = camp.walls!.find((w) => w.id === 'wb_camp_watch_screen')!
    // **不注入名册**（组合根那两行接线都没接 ⇒ 镜头与玩家都拿空清单）
    r.player.pos.x = wall.pos.x
    r.player.pos.y = wall.pos.y
    r.player.pos.z = wall.pos.z + 3
    r.player.floorY = wall.pos.y
    aimCamera(r, wall.pos.x, wall.pos.z + 13)
    const cfg = MODE_CONFIG[CameraMode.Exploration]
    const northFace = wall.pos.z + wall.size.z / 2
    const camZ = r.rig.cam.position.z
    expect(camZ, '没有名册 ⇒ 镜头穿到墙后（这一条是上一条的反向证人）').toBeLessThan(northFace)
    // 而且它就在它**该在**的地方：自由机位 = 目标 + 机位偏置（偏置现推：俯角读镜头自己那份）
    const freeZ = r.player.pos.z - cfg.distBase * Math.cos(r.rig.pitch)
    expect(Math.abs(camZ - freeZ), '镜头该在它自由机位上（这一条钉住"没名册时相机没在做别的什么"）')
      .toBeLessThan(0.2)
  })
})
