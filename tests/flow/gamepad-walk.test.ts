import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
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
 *
 * **帧序照抄 `src/main.ts` 的主循环**（KI-209 补齐了原来缺的两行）：
 * `poll` → **战技键边沿 → `tryStartAction`**（主循环 783-785，在 `player.update` 之前）
 * → `player.update` → **锁定目标 → `faceTowards`**（主循环 833，在 `player.update` 之后）
 * → `rig.update`。原来这个夹具只抄了三段，缺的那两行正好是"战技怎么出手"与
 * "锁定时朝向归谁"——本文件 KI-209 那几条腿量的就是这两件事，缺一行量出来的就是假的。
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
  /**
   * 锁定目标的位置（组合根那一行接线：`lock.target ? lock.target.getPos() : null`）——
   * **null 就是没锁定**（默认）。
   */
  lock: { x: number; y: number; z: number } | null
  /**
   * **玩家自己的锁定目标**（`player.lockedTarget`）：组合根把 `lock.target` 交给玩家，
   * 那一格决定"锁定 + 后向"那两格（翻滚的距离与拍数）与"脸朝哪边"。
   * 形状是结构类型（`{ getPos(); get radius() }`）⇒ 这里喂一个同形的替身，不造敌人。
   */
  playerLock: { getPos(): { x: number; y: number; z: number }; get radius(): number } | null
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
    lock: null,
    playerLock: null,
    set(l, r, b) {
      if (l) left = l
      if (r) right = r
      if (b) buttons = b
    },
    tick() {
      pad([left[0], left[1], right[0], right[1]], buttons)
      time.tick++
      input.poll(TICK_DT)
      // 主循环第 783-785 行：战技键的边沿 → 出手（在 `player.update` **之前**）
      for (const act of ['weaponSkill', 'weaponSkillB'] as const) {
        if (input.frame.edges.has(act)) player.tryStartAction(act, time.tick, rhythm)
      }
      player.lockedTarget = run.playerLock
      player.update(TICK_DT, time, input, time.tick, rhythm)
      // 主循环第 833 行：锁定目标拥有朝向（在 `player.update` 之后、`rig.update` 之前）——KI-209
      if (run.playerLock) player.faceTowards(run.playerLock.getPos())
      rig.update(TICK_DT, player, input.frame.look, run.lock, TICK_DT)
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

/**
 * **目标相对镜头前向的夹角**（越肩构图 ⇒ 目标本来就偏在一边，这一格偏置是 `CameraRig` 里的
 * `+0.35`，真读数约 −0.15 rad）⇒ **量的是"偏角变没变"**，不是"偏角等于多少"：
 * 偏角的那个值是实现常数（不许手钉），而"侧移之后偏角不变"是设计要的那件事
 * （变了 ⇒ 镜头没跟着绕 ⇒ 目标滑出画面）。
 */
/**
 * **人的朝向与镜头前向的夹角**（KI-190）。
 *
 * 两个约定：**人的朝向向量 ＝ (sin yaw, cos yaw)**（与 `moveWithWalls` 那支、
 * `hitTarget().facingYaw` 同一支笔）；**镜头前向 ＝ −(sin camYaw, cos camYaw)**
 * （相机在玩家的 +yaw 那一侧 ⇒ 屏幕前向是它的反方向）。
 */
function facingGap(run: Run): number {
  const camYaw = run.player.camYawRef ?? run.player.yaw
  return wrapPi(run.player.yaw - (camYaw + Math.PI))
}

/**
 * **位移方向与朝向的夹角**（KI-209，度）：朝向向量 ＝ (sin yaw, cos yaw)，
 * 与 `hitTarget().facingYaw`、`moveWithWalls` 那一支同一支笔。
 * 量的是**这一段位移落在朝向的哪一边**——0°＝正对朝向，180°＝正对朝向的反面。
 */
function travelGap(yaw: number, v: { x: number; z: number }): number {
  const l = Math.hypot(v.x, v.z)
  if (l < 1e-9) return 0
  const d = (Math.sin(yaw) * v.x + Math.cos(yaw) * v.z) / l
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI
}
function bearing(run: Run, target: { x: number; z: number }): number {
  const c = run.rig.cam.position
  const b = Math.atan2(target.x - c.x, target.z - c.z)
  return wrapPi(b - (run.rig.yaw + Math.PI)) // 镜头前向 = −(sin yaw, cos yaw) ⇒ 方位角 yaw + π
}

/**
 * **收集 n 拍里玩家脚步的噪声 loudness**（KI-204）：听 `sound.source` 上 id=player 的那些。
 * 脚步是**按步幅间隔**发的（走 3.0m 一响、疾跑 2.2m 一响）⇒ 窗口要够长才采得到。
 */
function collectNoise(run: Run, stick: [number, number], sprint: boolean, ticks: number): number[] {
  const out: number[] = []
  const onSound = (p: { id: string; loudness: number }): void => { if (p.id === 'player') out.push(p.loudness) }
  bus.on('sound.source', onSound)
  run.set(stick, [0, 0], sprint ? [7] : [])
  for (let i = 0; i < ticks; i++) run.tick()
  run.set([0, 0], [0, 0], [])
  bus.off('sound.source', onSound)
  return out
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

  it('按住 LB（键 7）疾跑：单位位移 == 疾跑表速，且体力净掉 sprintCostPerSec 那一格（**不许拧回复乘子**）', () => {
    const r = newRun()
    /**
     * **不许再拧 `staminaRegenMul`**（KI-194）：当年拧它是因为"满体力那一格量不到消耗"——
     * 根因是**回复曲线不知道刚刚消耗过**（快档 38/s 压过疾跑的 10/s ⇒ 疾跑反而回体力）。
     * 拧掉回复等于把遮羞布按住不放；现在消耗走 `EntityStats.drain`（它记「末次消耗」那一格），
     * 所以**这一条在真链上直接量得到**。
     */
    r.set([0, -1], undefined, [7])
    const st0 = r.player.stats.stamina
    const { d } = walk(r, 60)
    expect(d, `疾跑 1 秒该走 ${playerBase.sprintSpeed}m`).toBeCloseTo(playerBase.sprintSpeed, 1)
    expect(d / playerBase.moveSpeed, '疾跑必须比走快，否则 7 号键是个装饰').toBeGreaterThan(1.2)
    expect(st0 - r.player.stats.stamina, `体力净掉的必须是表里的 ${playerBase.sprintCostPerSec}/秒`)
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

  /**
   * **锁定那一半**（KI-175）：锁定时相机走**越肩那一格**（KI-170 把它接上了），
   * 而且**侧移时镜头绕着目标转**——目标在画面里的位置不变。
   *
   * 为什么要单独量：镜头的锁定分支（`rig.update` 里 `aim` 那一条）此前**只被替身走过**
   * （`camYawRef = 0` 的单元腿与 KI-170 那个替身）⇒ "锁定时目标还在画面里"这件事
   * 在**真链**上（真 `Input` ＋ 真 `CameraRig` ＋ 真帧序 ＋ 真的锁定目标）一次也没被量过。
   *
   * 判据是**偏角的变化**：越肩构图 ⇒ 目标本来就偏在一边（那一格偏置是 `CameraRig` 里的
   * `+0.35`，真读数约 −0.15 rad）⇒ **量"侧移之后偏角变没变"，不量"偏角等于多少"**
   * （那个值是实现常数，不许手钉）。
   */
  it('锁定 ⇒ 相机走越肩那一格（真链）：FOV 就是那一格的值', () => {
    const r = newRun()
    r.lock = { x: 0, y: 0, z: 8 }
    for (let i = 0; i < 200; i++) r.tick()
    const lockOn = MODE_CONFIG[CameraMode.LockOn]
    expect(r.rig.getMode(), '锁定时相机该在越肩那一格').toBe(CameraMode.LockOn)
    expect(r.rig.cam.fov, '锁定时的 FOV 该是越肩那一格的值（combat.md §7 写的是 45°）').toBe(lockOn.fovBase)
  })

  it('锁定中侧移 ⇒ 镜头绕着目标转，目标在画面里的偏角不变', () => {
    const r = newRun()
    const target = { x: 0, z: 8 }
    r.lock = { x: target.x, y: 0, z: target.z }
    for (let i = 0; i < 200; i++) r.tick()
    const before = bearing(r, target)
    const yawBefore = r.rig.yaw
    r.set([1, 0]) // 左摇杆推右 = 侧移
    for (let i = 0; i < 120; i++) r.tick()
    const after = bearing(r, target)
    expect(Math.abs(wrapPi(r.rig.yaw - yawBefore)), '侧移时镜头该绕着目标转（不转 ⇒ 目标滑出画面）')
      .toBeGreaterThan(0.3)
    expect(Math.abs(wrapPi(after - before)), '目标在画面里的偏角不许变（变了 ⇒ 构图没跟着绕）')
      .toBeLessThan(0.01)
  })

  it('对照：没有锁定目标 ⇒ 侧移不动机位（镜头不绕，只跟着人走）', () => {
    const r = newRun()
    for (let i = 0; i < 200; i++) r.tick()
    const cfg = MODE_CONFIG[CameraMode.Exploration]
    // **静置时**的距离（人在动的时候镜头会拖后一截——那是跟随阻尼，不是构图变了 ⇒ 静置时量）
    const rest = Math.hypot(r.rig.cam.position.x - r.player.pos.x, r.rig.cam.position.z - r.player.pos.z)
    expect(Math.abs(rest - cfg.distBase * Math.cos(r.rig.pitch)), '没锁定时镜头与人保持探索那一格的距离')
      .toBeLessThan(0.1)
    const yawBefore = r.rig.yaw
    r.set([1, 0])
    for (let i = 0; i < 120; i++) r.tick()
    expect(Math.abs(wrapPi(r.rig.yaw - yawBefore)), '没有锁定目标 ⇒ 镜头不绕（转向只吃右摇杆）')
      .toBeLessThan(1e-6)
  })

  /**
   * **沿墙滑那一半**（KI-173）：斜着撞 ⇒ 人**贴着墙滑过去**（不被钉住，也不进墙里）。
   *
   * KI-154 的单元腿里那一条是**假相机**量的（`camYawRef = 0`）⇒ 这一条是它的真链版：
   * 走的方向由**相机**决定（`aimCamera` 把它转到位），撞墙的解法仍是 MTV
   * （进墙的那一轴被推回，切向那一轴保留 ⇒ 沿墙滑）。
   */
  it('斜着撞 ⇒ 沿墙滑（人被推回墙面，切向那一轴照旧走得动）', () => {
    const r = newRun()
    const camp = regions.find((x) => x.id === 'rg_brokenbar_camp')!
    const wall = camp.walls!.find((w) => w.id === 'wb_camp_watch_screen')!
    const occ = new OcclusionField()
    occ.syncAuthored(camp)
    r.player.occluders = () => occ.list()
    // 从墙的东北角斜着走向墙心 ⇒ 打的是**面**，方向与墙面成 45°
    r.player.pos.x = wall.pos.x + 6
    r.player.pos.y = wall.pos.y
    r.player.pos.z = wall.pos.z + 6
    r.player.floorY = wall.pos.y
    aimCamera(r, wall.pos.x, wall.pos.z)
    const radius = r.player.hitTarget().radius
    const stopZ = wall.pos.z + wall.size.z / 2 + radius
    r.set([0, -1], [0, 0])
    let hitX: number | null = null
    for (let i = 0; i < 180; i++) {
      r.tick()
      if (hitX === null && r.player.pos.z <= stopZ + 1e-6) hitX = r.player.pos.x
    }
    expect(hitX, '这一趟该撞到墙（没撞上 ⇒ 后面那几条量的是别的东西）').not.toBeNull()
    expect(Math.abs(r.player.pos.z - stopZ), '人该**贴着**墙（墙面 + 半径）滑着走').toBeLessThan(0.05)
    expect(hitX! - r.player.pos.x, '切向那一轴照旧走得动 ⇒ 人沿着墙**滑**过去（不是被钉住）')
      .toBeGreaterThan(2)
    expect(r.player.pos.x, '滑动的方向是斜着来的那一边（往 −x）').toBeLessThan(wall.pos.x)
    expect(Math.abs(r.player.pos.x - wall.pos.x), '滑的人还站在这堵墙的正面（不许滑到墙角那一侧去）')
      .toBeLessThan(wall.size.x / 2)
  })

  it('已经贴着墙面时：切向挪一步必须挪得动（贴面即挡会把人钉在墙前）', () => {
    const r = newRun()
    const camp = regions.find((x) => x.id === 'rg_brokenbar_camp')!
    const wall = camp.walls!.find((w) => w.id === 'wb_camp_watch_screen')!
    const occ = new OcclusionField()
    occ.syncAuthored(camp)
    r.player.occluders = () => occ.list()
    const radius = r.player.hitTarget().radius
    // 起点在**面内 5mm**（不是恰好落在面上：恰好落在面上要靠浮点运气的福）
    r.player.pos.x = wall.pos.x
    r.player.pos.y = wall.pos.y
    r.player.pos.z = wall.pos.z + wall.size.z / 2 + radius - 0.005
    r.player.floorY = wall.pos.y
    // 沿着墙往 +x 走（镜头转向 +x 那一边）
    aimCamera(r, wall.pos.x + 10, wall.pos.z)
    r.set([0, -1], [0, 0])
    for (let i = 0; i < 60; i++) r.tick()
    expect(r.player.pos.x, '贴着墙面时切向挪一步必须挪得动').toBeGreaterThan(wall.pos.x + 0.5)
    expect(r.player.pos.z, '切向挪动不许把人推进墙里').toBeGreaterThan(wall.pos.z + wall.size.z / 2 - 0.01)
  })

  /**
   * **人的朝向那一半**（KI-190）：真链上"人是朝哪边走的"与"镜头朝哪边"是**两件事**。
   *
   * `player.yaw` 跟着**移动方向**转（每拍向它拧 25%），而镜头只吃右摇杆 ⇒
   * 侧移时**人转过去、镜头不转** ⇒ 那 90° 就是"看与走各有主人"在手上的样子。
   * 这一族此前只量过相机那一半（KI-151 的第⑤条：转头之后"推前"落在世界里的方向跟着变）
   * ⇒ **人这一半一次也没被量过**。
   *
   * 约定（不许手钉）：人的朝向向量 ＝ (sin yaw, cos yaw)；镜头前向 ＝ −(sin camYaw, cos camYaw)。
   */
  it('推前 ⇒ 人的朝向就是屏幕前方（人与镜头差 0°）', () => {
    const r = newRun()
    r.set([0, -1], [0, 0])
    walk(r, 60)
    expect(Math.abs(facingGap(r)), '推前时人该正对着屏幕前方（与镜头差 0°）').toBeLessThan(0.05)
  })

  it('侧移 ⇒ 人转过去、镜头不转（差 90°：看与走各有主人）', () => {
    const r = newRun()
    r.set([0, -1], [0, 0])
    walk(r, 60)
    const yawBefore = r.rig.yaw
    r.set([1, 0]) // 左摇杆推右 = 侧移
    walk(r, 120)
    expect(Math.abs(wrapPi(r.rig.yaw - yawBefore)), '侧移时镜头不许跟着转（它只吃右摇杆）').toBeLessThan(1e-6)
    expect(Math.abs(facingGap(r)), '侧移时人该转成侧移方向（与镜头差 90°）').toBeCloseTo(Math.PI / 2, 1)
  })

  it('松手 ⇒ 人的朝向停住（不转回镜头方向）', () => {
    const r = newRun()
    r.set([1, 0]) // 一上来就侧移
    walk(r, 120)
    const yaw = r.player.yaw
    r.set([0, 0])
    walk(r, 60)
    expect(Math.abs(wrapPi(r.player.yaw - yaw)), '松手后人的朝向不许自己转（它只在移动时拧）').toBeLessThan(1e-6)
  })

  /**
   * **锁定时的那一滚**（KI-192）：锁定中翻滚 ⇒ 走**锁定那一格**（距离与拍数都换），
   * 没锁定 ⇒ 走自由那一格。
   *
   * **"没有输入时滚的是背面"**（`moveDir()` 在没有输入时回落的是朝向的反方向）⇒
   * 没锁定那一滚走的是 `backDist` 那一格，不是 `dist`（KI-090 那一行的口径）。
   *
   * 拍数的算法：触发那一拍之后，逐拍看位置有没有变 ⇒ **还在动的那一拍** ＋ 触发那一拍
   * ＝ 这一滚的总拍数（与 `rollProfile` 的 `total` 那一格同一支笔）。
   */
  it('锁定中滚 ⇒ 走锁定那一格（距离与拍数都换）', () => {
    const r = newRun()
    const target = { x: 0, y: 0, z: 8 }
    r.playerLock = { getPos: () => target, get radius() { return 2 } }
    const roll = playerBase.roll
    const from = { x: r.player.pos.x, z: r.player.pos.z }
    r.set([0, 0], [0, 0], [0]) // dodge 键（手柄 0 号＝标准映射的 A）
    r.tick()
    r.set([0, 0], [0, 0], [])
    let last = 0
    for (let i = 0; i < 60; i++) {
      const before = { x: r.player.pos.x, z: r.player.pos.z }
      r.tick()
      if (Math.hypot(r.player.pos.x - before.x, r.player.pos.z - before.z) > 1e-9) last = i + 1
    }
    const d = Math.hypot(r.player.pos.x - from.x, r.player.pos.z - from.z)
    expect(Math.abs(d - roll.lockOnDist), '锁定中那一滚该走 `lockOnDist` 那一格').toBeLessThan(0.05)
    expect(last + 1, '锁定中那一滚的总拍数该是 `lockOnTotal` 那一格').toBe(roll.lockOnTotal)
  })

  it('没锁定滚 ⇒ 走自由那一格（没有输入时滚的是背面 ⇒ `backDist`）', () => {
    const r = newRun()
    const roll = playerBase.roll
    const from = { x: r.player.pos.x, z: r.player.pos.z }
    r.set([0, 0], [0, 0], [0])
    r.tick()
    r.set([0, 0], [0, 0], [])
    let last = 0
    for (let i = 0; i < 60; i++) {
      const before = { x: r.player.pos.x, z: r.player.pos.z }
      r.tick()
      if (Math.hypot(r.player.pos.x - before.x, r.player.pos.z - before.z) > 1e-9) last = i + 1
    }
    const d = Math.hypot(r.player.pos.x - from.x, r.player.pos.z - from.z)
    expect(Math.abs(d - roll.backDist), '没锁定那一滚（没有输入 ⇒ 背面）该走 `backDist` 那一格').toBeLessThan(0.05)
    expect(last + 1, '没锁定那一滚的总拍数该是 `total` 那一格').toBe(roll.total)
  })

  it('锁定中滚的方向：由输入/朝向决定（`combat.md` 那一行「1.6m 切线」的『切线』那半句今天读不到）', () => {
    const r = newRun()
    const target = { x: 0, y: 0, z: 8 }
    r.playerLock = { getPos: () => target, get radius() { return 2 } }
    r.player.yaw = 0 // 面朝 +z（也就是正对着目标）
    const from = { x: r.player.pos.x, z: r.player.pos.z }
    r.set([0, 0], [0, 0], [0])
    r.tick()
    r.set([0, 0], [0, 0], [])
    for (let i = 0; i < 60; i++) r.tick()
    const dz = r.player.pos.z - from.z
    const dx = r.player.pos.x - from.x
    expect(Math.abs(dx), '锁定中滚的方向由输入/朝向决定（不是切线）⇒ 不许横向跑').toBeLessThan(0.05)
    expect(Math.abs(dz), '没有输入时滚的是背面（朝向的反方向）⇒ 位移沿朝向那一轴').toBeGreaterThan(1)
  })

  /**
   * **疾跑的体力那一格：必须是净消耗**（KI-194）。
   *
   * 修复前这一格在真链上是**反的**：体力 3 起跑 1 秒 ⇒ 体力 31（净 **+28/s**）——
   * 回复曲线（§6.2「末次消耗动作后」）看不到疾跑在消耗 ⇒ 快档 38/s 压过 10/s。
   *
   * **起手要低于满格**才量得到：满格那一格回复根本不动（`stamina < staMax` 才回），
   * 于是"净掉了多少"读出来的是别的东西（第一版那条腿拧回复乘子就是为了绕过这个）。
   */
  it('体力不到满格时疾跑：体力净减少（不许反而变多——修复前实测净 +28/s）', () => {
    const r = newRun()
    r.player.stats.stamina = playerBase.stamina / 2 // 半格：回复会跑 ⇒ 才量得到"净"
    const st0 = r.player.stats.stamina
    r.set([0, -1], undefined, [7])
    walk(r, 60)
    const st1 = r.player.stats.stamina
    expect(st1, '体力不许变负').toBeGreaterThanOrEqual(0)
    expect(st1, `体力净减少（起手 ${st0} ⇒ 收尾 ${st1}）`).toBeLessThan(st0)
  })

  /**
   * **体力烧到底 ⇒ `exhausted` 那一格起来**（KI-194）：
   * 疾跑不许是"满速白嫖"——体力见底之后按设计（§6「禁止无限攻击」）就该出不了招。
   *
   * 修复前这一格在真链上**永远不起来**：疾跑把体力往上顶 ⇒ 永远烧不干。
   * 秒数是**算出来的**（半格 ÷ 每秒那一格 ＋ 1s 余量），不是手钉的。
   */
  it('疾跑把体力烧到底 ⇒ exhausted 那一格起来（不许满速白嫖）', () => {
    const r = newRun()
    r.player.stats.stamina = playerBase.stamina / 2
    r.set([0, -1], undefined, [7])
    const secs = playerBase.stamina / 2 / playerBase.sprintCostPerSec + 1
    walk(r, Math.ceil(secs / TICK_DT)) // TICK_DT 是那一拍的秒数（这一格现推，不手钉 60）
    expect(r.player.stats.stamina, '体力该见底').toBeLessThanOrEqual(0)
    expect(r.player.exhausted, '体力见底 ⇒ exhausted 那一格起来（不许满速白嫖）').toBe(true)
  })

  /**
   * **回复曲线那三档**（KI-196）：§6.2「时段（末次消耗动作后）」那一行——
   * 0-500ms → **0/s**（硬缓冲，防「消耗-回满」抖振）、500-1200ms → **22/s**、>1200ms → **38/s**。
   *
   * 拍数**现推**：三档的边界在 `player.json > staminaRegen` 里（`hardDelay` 30 拍、
   * `slowTicks` 72 拍），秒与拍的换算用 `TICK_DT`（那一拍的秒数）——一个手钉的数都没有。
   *
   * **怎么起算「末次消耗」**：按一次翻滚（免费那一格，消耗 `playerBase.roll.stamina`）
   * ⇒ 翻滚那一拍就是消耗发生的那一拍（`spendStamina` 记下它）。
   *
   * **起手要低于满格**：满格时回复根本不动（`stamina < staMax` 才回）⇒ 读出来是 0。
   */
  it('消耗之后：硬缓冲那一档（0-500ms）内体力一个字节都不许回', () => {
    const r = newRun()
    r.player.stats.stamina = playerBase.stamina / 2
    r.set([0, 0], [0, 0], [0]) // dodge 键（手柄 0 号＝标准映射的 A）
    r.tick()
    r.set([0, 0], [0, 0], [])
    const st0 = r.player.stats.stamina
    for (let i = 0; i < playerBase.staminaRegen.hardDelay; i++) r.tick()
    expect(r.player.stats.stamina, '硬缓冲那一档（0/s）内体力一个字节都不许回').toBeCloseTo(st0, 6)
  })

  it('消耗之后：第二档（500-1200ms）按 slowPerSec 那一格回', () => {
    const r = newRun()
    const regen = playerBase.staminaRegen
    r.player.stats.stamina = playerBase.stamina / 2
    r.set([0, 0], [0, 0], [0])
    r.tick()
    r.set([0, 0], [0, 0], [])
    for (let i = 0; i < regen.hardDelay; i++) r.tick() // 先走过硬缓冲那一档
    const st1 = r.player.stats.stamina
    r.tick() // 这一拍进第二档
    const perTick = regen.slowPerSec * TICK_DT
    expect(r.player.stats.stamina - st1, `第二档该按 slowPerSec（${regen.slowPerSec}/s）那一格回`)
      .toBeCloseTo(perTick, 6)
  })

  it('消耗之后：第三档（>1200ms）按 fastPerSec 那一格回', () => {
    const r = newRun()
    const regen = playerBase.staminaRegen
    r.player.stats.stamina = playerBase.stamina / 2
    r.set([0, 0], [0, 0], [0])
    r.tick()
    r.set([0, 0], [0, 0], [])
    for (let i = 0; i < regen.slowTicks; i++) r.tick() // 走过前两档
    const st1 = r.player.stats.stamina
    r.tick() // 这一拍进第三档
    const perTick = regen.fastPerSec * TICK_DT
    expect(r.player.stats.stamina - st1, `第三档该按 fastPerSec（${regen.fastPerSec}/s）那一格回`)
      .toBeCloseTo(perTick, 6)
  })

  /**
   * **「格挡中移动」那一格**（KI-198）：combat.md §5.1 那一行写的是
   * 「侧移 **1.4m/s**、不可疾跑；锁定 strafing 可用」。
   *
   * **这一格此前在运行时没有承载体**：代码那一格是 `moveSpeed × 0.35` 的**比例**，
   * 而那个比例是按走路速度 4.0 算的 ⇒ 走路速度改成 4.6 之后它跟着漂成了 **1.61 m/s**
   * ⇒ **设计写的那一格与运行时对不上**。现在那一格住在数据里（`guard.moveSpeed`），
   * 走路速度再改也不会把它带偏。
   *
   * **「侧移」那半句是设计没裁**：那一行同时写着「侧移」与「锁定 strafing 可用」，
   *  ⇒ 「侧移」到底指"格挡中只许横着走"还是"锁定时的侧步"，**没裁** ⇒ 本批只量
   *  今天的行为（格挡中的移动方向跟走路一样，正对镜头前向），**不替设计裁**。
   */
  it('格挡中移动 ⇒ 速度是 `guard.moveSpeed` 那一格（不许是走路那一格，也不许是疾跑那一格）', () => {
    const r = newRun()
    r.set([0, -1], [0, 0], [4]) // 4 号键＝格挡（标准映射的 LB）
    for (let i = 0; i < 30; i++) r.tick() // 先走过起手那一段（§5.1：100ms/6f 之后才进格挡态）
    const from = { x: r.player.pos.x, z: r.player.pos.z }
    walk(r, 60)
    const d = dist2(r.player.pos, from)
    expect(d, `格挡中 1 秒该走 ${playerBase.guard.moveSpeed}m（设计 §5.1 那一行写的数）`)
      .toBeCloseTo(playerBase.guard.moveSpeed, 2)
    expect(d, '格挡中不许是走路那一格').toBeLessThan(playerBase.moveSpeed)
  })

  /**
   * **格挡中不可疾跑**（设计 §5.1 那一行的「不可疾跑」）：按住疾跑键也不许变快。
   */
  it('格挡中按住疾跑键 ⇒ 速度不变（设计 §5.1「不可疾跑」）', () => {
    const a = newRun()
    a.set([0, -1], [0, 0], [4])
    for (let i = 0; i < 30; i++) a.tick()
    const fromA = { x: a.player.pos.x, z: a.player.pos.z }
    walk(a, 60)
    const dA = dist2(a.player.pos, fromA)

    const b = newRun()
    b.set([0, -1], [0, 0], [4, 7]) // 7 号键＝疾跑
    for (let i = 0; i < 30; i++) b.tick()
    const fromB = { x: b.player.pos.x, z: b.player.pos.z }
    walk(b, 60)
    const dB = dist2(b.player.pos, fromB)

    expect(dB, '格挡中按住疾跑键不许变快').toBeCloseTo(dA, 3)
    expect(dB, '格挡中不许是疾跑那一格').toBeLessThan(playerBase.sprintSpeed)
  })

  /**
   * **格挡的起手 100ms/6f**（设计 §5.1「起手」那一行）：按住格挡键，
   * **前 6 拍不进格挡态**（那几拍走的是走路那一格），第 6 拍才进 ⇒ 速度从走路那格
   * 掉到格挡那格。
   *
   * 拍数现推：`playerBase.guard.startupTicks`（6）——设计那行写的是 100ms/6f。
   */
  it('格挡的起手：前 startupTicks 拍不进格挡态（那几拍还是走路那一格）', () => {
    const r = newRun()
    r.set([0, -1], [0, 0], [4])
    const from = { x: r.player.pos.x, z: r.player.pos.z }
    for (let i = 0; i < playerBase.guard.startupTicks - 1; i++) r.tick()
    const early = dist2(r.player.pos, from)
    const ticks = playerBase.guard.startupTicks - 1
    const walkT = playerBase.moveSpeed * ticks * TICK_DT
    const guardT = playerBase.guard.moveSpeed * ticks * TICK_DT
    expect(early, `起手那几拍该还是走路那一格（${playerBase.moveSpeed} m/s），不是格挡那格`)
      .toBeGreaterThan(guardT)
    expect(early, `起手那几拍该还是走路那一格（${playerBase.moveSpeed} m/s）`).toBeCloseTo(walkT, 3)
  })

  /**
   * **弹反的输入窗与落空那一族**（KI-201）：combat.md §5.3 那几行——
   * 「按下后 **100ms（6f）** 判定区激活」「落空后摇 **450ms（27f）**、期间被击伤害 ×1.25」——
   * 与 `player.json > parry` 的 `activeTicks`(6) / `whiffRecovery`(27) / `whiffDmgMul`(1.25) **逐字对上**。
   *
   * **拍数从按下那一拍算起**（窗一关就进后摇）：`parryActive` 是公开 getter（`parryTicksLeft > 0`），
   * `parryWhiffTicks` 是公开字段 ⇒ 两格都能直接读，不用猜。
   */
  it('按下弹反键 ⇒ 窗口从按下那一拍算起亮 parry.activeTicks 拍', () => {
    const r = newRun()
    r.set([0, 0], [0, 0], [2]) // 2 号键＝弹反（标准映射的 X）
    let active = 0
    r.tick()
    if (r.player.parryActive) active++
    r.set([0, 0], [0, 0], [])
    while (r.player.parryActive) { r.tick(); active++ }
    expect(active, `窗口该亮 ${playerBase.parry.activeTicks} 拍（设计 §5.3 的 100ms/6f）`)
      .toBe(playerBase.parry.activeTicks)
  })

  it('落空 ⇒ 后摇 parry.whiffRecovery 拍，且这期间再按弹反键不开窗', () => {
    const r = newRun()
    r.set([0, 0], [0, 0], [2])
    r.tick()
    r.set([0, 0], [0, 0], [])
    while (r.player.parryActive) r.tick() // 窗走完 ⇒ 落空
    expect(r.player.parryWhiffTicks, '窗一关就该进后摇（起手＝whiffRecovery）')
      .toBe(playerBase.parry.whiffRecovery)
    let whiff = 0
    while (r.player.parryWhiffTicks > 0) { r.tick(); whiff++ }
    expect(whiff, `后摇该走 ${playerBase.parry.whiffRecovery} 拍（设计 §5.3 的 450ms/27f）`)
      .toBe(playerBase.parry.whiffRecovery)

    // 再落一次空：后摇期间按弹反键 ⇒ 不开窗（那道 `parryWhiffTicks <= 0` 的闸）
    r.set([0, 0], [0, 0], [2])
    r.tick()
    r.set([0, 0], [0, 0], [])
    while (r.player.parryActive) r.tick()
    const before = r.player.parryWhiffTicks
    r.set([0, 0], [0, 0], [2])
    r.tick()
    r.set([0, 0], [0, 0], [])
    expect(r.player.parryActive, '后摇期间按弹反键不许开窗').toBe(false)
    expect(before, '后摇起手该是 whiffRecovery').toBe(playerBase.parry.whiffRecovery)
  })

  /**
   * **体力门槛那一格**：按弹反键要体力 ≥ 5（设计 §6.1「弹反 0/5」的 5）⇒ 体力不够时按下去不开窗。
   */
  it('体力低于那道 5 的门槛 ⇒ 按弹反键不开窗', () => {
    const r = newRun()
    r.player.stats.stamina = 4
    r.set([0, 0], [0, 0], [2])
    r.tick()
    r.set([0, 0], [0, 0], [])
    r.tick() // 松开那一拍也要过一遍：边沿是按帧算的，不然第二次按下不算"按下"
    expect(r.player.parryActive, '体力不够（< 5）时按弹反键不该开窗').toBe(false)
    expect(r.player.parryTicksLeft, '体力不够时窗口该是 0').toBe(0)
    // 对照：体力够 ⇒ 开窗
    r.player.stats.stamina = playerBase.stamina
    r.set([0, 0], [0, 0], [2])
    r.tick()
    r.set([0, 0], [0, 0], [])
    expect(r.player.parryActive, '体力够时按弹反键该开窗').toBe(true)
  })

  /**
   * **「玩家动词表」对账（KI-204）**：gameplay.md §3.1 那八行——
   * 行走 ✔／疾跑 ✔（KI-194）／静步 ⚠／跳跃 ✔／**攀爬 ✘**／**定弦钩 ✘**／观察 ✔／锁定 ✔（KI-175/190/192）。
   *
   * **没载体的三处（如实登记，见账本）**：
   * ① **攀爬**（§3.1 写「体力 12/s、仅攀爬面」）——`src` 与 `data` 里**一处都没有**；
   * ② **定弦钩**（§3.1 写「体力 10、拉向锚点 8m/s」）——`src` 里只有武器技能
   *    `sk_spear_stringpin_hook` 与任务用的 `storyHooks`，**没有钩点世界几何**；
   * ③ **静步的"更静"那一档**（§3.1 写「脚步声半径 12m→4m」）——实测轻推摇杆的噪声**与"走"同一档**。
   *
   * **腿只用量关系**（疾跑比走更响／轻推与走同一档）⇒ 不手钉数（手钉的数就是下一批的 KI-028）。
   */
  it('脚步噪声：疾跑比走更响（噪声分档）', () => {
    const a = newRun()
    const la = collectNoise(a, [0, -1], false, 240)
    const b = newRun()
    const lb = collectNoise(b, [0, -1], true, 240)
    expect(la.length, '走该有脚步声').toBeGreaterThan(0)
    expect(lb.length, '疾跑该有脚步声').toBeGreaterThan(0)
    expect(Math.max(...lb), '疾跑该比走更响').toBeGreaterThan(Math.max(...la))
  })

  it('静步（轻推摇杆）⇒ 噪声与「走」同一档（设计 §3.1 的「12m→4m」那一档没有承载体）', () => {
    const a = newRun()
    const la = collectNoise(a, [0, -0.3], false, 480)
    const b = newRun()
    const lb = collectNoise(b, [0, -1], false, 480)
    expect(la.length, '轻推该有脚步声').toBeGreaterThan(0)
    expect(Math.max(...la), '轻推的噪声与「走」同一档').toBeCloseTo(Math.max(...lb), 6)
  })

  /**
   * **相机模式表里那两格没有调用方**（KI-207）：`CameraMode.Combat`（48°）与 `CameraMode.Boss`（42°）
   * 在 `src` 里**一次都没被 `setMode` 过**——调用方只有三处：`cinematic.start`（⇒ Cinematic）、
   * `cinematic.end`（⇒ Exploration）、锁定那一支（⇒ LockOn／回锁定前那一格）。
   *
   * **设计没裁「什么时候算战斗／什么时候算 Boss」**⇒ 本批**只量今天的行为**（不代裁、不替它接线）。
   *
   * **接上那两格之后这条腿要改**（它钉的就是"今天没人进"）——账本里写了这一句。
   */
  it('真链上只进过三格：探索／越肩／过场（战斗与 Boss 一次都不出现）', () => {
    const r = newRun()
    const seen = new Set<string>()
    const mark = (): void => { seen.add(r.rig.getMode()) }
    mark()
    r.set([0, -1], [0, 0], [])
    for (let i = 0; i < 60; i++) { r.tick(); mark() }
    r.set([0, 0], [0, 0], [])
    // 锁定（越肩那一格）
    r.lock = { x: 0, y: 0, z: 8 }
    for (let i = 0; i < 30; i++) { r.tick(); mark() }
    // 解锁（回锁定前那一格）
    r.lock = null
    for (let i = 0; i < 30; i++) { r.tick(); mark() }
    // 过场（镜头归过场管）
    bus.emit('cinematic.start', { id: 'probe', durationMs: 500 })
    for (let i = 0; i < 10; i++) { r.tick(); mark() }
    bus.emit('cinematic.end', { id: 'probe' })
    for (let i = 0; i < 10; i++) { r.tick(); mark() }
    const allowed = [CameraMode.Exploration, CameraMode.LockOn, CameraMode.Cinematic]
    expect([...seen].filter((m) => !allowed.includes(m as CameraMode)), '真链上不该出现战斗格或 Boss 格（今天没有调用方）').toEqual([])
    expect(seen.has(CameraMode.Exploration), '这一趟该进过探索格').toBe(true)
    expect(seen.has(CameraMode.LockOn), '这一趟该进过越肩那一格').toBe(true)
    expect(seen.has(CameraMode.Cinematic), '这一趟该进过过场那一格').toBe(true)
  })

  /**
   * **锁定那一支不认「你在哪一格」**（KI-207）：它记的是**锁定前那一格**（`preLockMode`），
   * 不是写死的探索格 ⇒ 从**战斗格**锁定，解锁之后要回到**战斗格**。
   *
   * （那两格今天没人进，但"锁定不夺走你在的那一格"这条规矩**与谁进哪一格无关**——
   * 用战斗格当起点量它，正是为了证明它不是"回探索格"写死的。）
   */
  it('从战斗格锁定 ⇒ 切越肩；解锁 ⇒ 回到战斗格（不是写死的探索格）', () => {
    const r = newRun()
    r.rig.setMode(CameraMode.Combat)
    expect(r.rig.getMode(), '起点该是战斗格').toBe(CameraMode.Combat)
    r.lock = { x: 0, y: 0, z: 8 }
    r.tick()
    expect(r.rig.getMode(), '锁定 ⇒ 切越肩那一格').toBe(CameraMode.LockOn)
    r.lock = null
    r.tick()
    expect(r.rig.getMode(), '解锁 ⇒ 回锁定前那一格（战斗格），不是写死的探索格').toBe(CameraMode.Combat)
  })

  /**
   * **翻滚期间人的朝向冻住**（KI-209 —— KI-190 的「没做②」那半句）：
   * `hitTarget().facingYaw` 在整段翻滚里指着**起手那一拍**的朝向。
   *
   * **谁负责**：没锁定时**没有人负责**——移动那一支的朝向更新
   * （`ThirdPersonController` 里那条 25%/拍追移动方向）住在 `busyMovementLocked()` 的另一侧，
   * 翻滚期间那一支整段不走 ⇒ 朝向冻住是**结构性的**，不是没人写。
   *
   * **顺带量到的一件事**：往后滚那一滚，位移方向与朝向差 **180°**（脸朝前、人往后走），
   * 滚完仍朝前 ⇒ **朝向不跟着位移转**。combat.md §5.5 只写了前/侧/后三行与米数，
   * 「滚起来之后脸该朝哪边」**设计没裁** ⇒ 本批**只量不裁**。
   */
  it('翻滚期间朝向冻住（起手那一拍的 yaw 与滚完那一拍一个字节不变）', () => {
    const r = newRun()
    r.set([0, -1], [0, 0])
    for (let i = 0; i < 30; i++) r.tick() // 先走 30 拍让朝向落定（免得"没变"是因为本来就没方向）
    const yaw0 = r.player.yaw
    const before = { x: r.player.pos.x, z: r.player.pos.z }
    r.set([0, 1], [0, 0], [0]) // 推后 ＋ dodge ⇒ 这一滚走「后向」那一格
    r.tick()
    r.set([0, 0], [0, 0], []) // 松开推杆：这一滚的方向是起手那一拍定死的，之后不再走
    let end = { ...before }
    let moves = 0
    for (let i = 0; i < 60; i++) {
      const p0 = { x: r.player.pos.x, z: r.player.pos.z }
      r.tick()
      const p1 = { x: r.player.pos.x, z: r.player.pos.z }
      if (Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1e-9) { end = p1; moves++ }
    }
    expect(r.player.yaw, '翻滚期间朝向不许动（`hitTarget().facingYaw` 整段指着起手那一格）').toBe(yaw0)
    expect(moves, '这一滚确实动了（前提：不许是"没动所以朝向没变"）').toBeGreaterThan(10)
    const travel = { x: end.x - before.x, z: end.z - before.z }
    expect(Math.hypot(travel.x, travel.z), '后向那一滚该走 `backDist` 那一格').toBeCloseTo(playerBase.roll.backDist, 2)
    expect(travelGap(yaw0, travel), '后向那一滚：位移方向与朝向差 180°（脸朝前、人往后走）⇒ 朝向不跟着位移转')
      .toBeGreaterThan(170)
  })

  /**
   * **出招期间朝向同样冻住；招式前冲沿当时的朝向走**（KI-209）。
   *
   * 前冲那一格是**帧表的 `lunge`**（`movesets.json > ms_sword > actions.l1`），不手钉。
   * **前冲段按老约定是 `startup .. startup + activeEnd`（两端都含）** ⇒ 走了 `activeEnd + 1` 帧，
   * 而每帧走 `lunge / activeEnd` ⇒ 前冲总长 ＝ `lunge × (activeEnd + 1) / activeEnd`
   * （实测 0.369444m —— 与 KI-017 账上那个"前冲落点"读数逐字相同）。
   *
   * **朝向 ≠ 0 是前提**：先走 30 拍让朝向落定，前冲那一格才有方向可量
   * （朝向正好是 0 时，"前冲沿朝向"与"前冲写死 +z"读起来一模一样 ⇒ 那条腿是空的）。
   */
  it('出招期间朝向冻住；招式前冲沿当时的朝向走（帧表 `lunge` 那一格）', () => {
    const r = newRun()
    r.set([0, -1], [0, 0])
    for (let i = 0; i < 30; i++) r.tick() // 朝向落定（yaw ≠ 0：前冲才有方向可量）
    const yaw0 = r.player.yaw
    const before = { x: r.player.pos.x, z: r.player.pos.z }
    r.set([0, 0], [0, 0], [13]) // attackLight（13 号＝标准映射的下）
    r.tick()
    r.set([0, 0], [0, 0], [])
    let end = { ...before }
    for (let i = 0; i < 40; i++) {
      const p0 = { x: r.player.pos.x, z: r.player.pos.z }
      r.tick()
      const p1 = { x: r.player.pos.x, z: r.player.pos.z }
      if (Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1e-9) end = p1
    }
    expect(r.player.yaw, '出招期间朝向不许动（`hitTarget().facingYaw` 整段指着起手那一格）').toBe(yaw0)
    const f = registry.get<MovesetData>('ms_sword').actions.l1
    const lunge = f.lunge ?? 0
    expect(lunge, '前提：轻击那一式自带前冲（帧表 `lunge` 那一格）').toBeGreaterThan(0)
    const travel = { x: end.x - before.x, z: end.z - before.z }
    const want = lunge * ((f.activeEnd + 1) / f.activeEnd)
    expect(Math.hypot(travel.x, travel.z), `前冲该走 ${want}m（帧表 lunge ${lunge} × (activeEnd+1)/activeEnd）`)
      .toBeCloseTo(want, 3)
    expect(travelGap(yaw0, travel), '前冲必须沿当时的朝向（夹角 ≈ 0°）').toBeLessThan(0.5)
  })

  /**
   * **锁定时朝向归锁定目标所有**（KI-209）：主循环每拍 `player.faceTowards(lock.target)`
   * ⇒ **翻滚期间朝向也照转**（35%/拍），不是冻住。
   *
   * 于是这一格有个可测的后果：**翻滚的位移方向是起手那一拍定死的，而脸在滚的过程中转了**
   * ⇒ 滚完之后，脸已经不在位移的方向上了（实测：位移方向与起手时的朝向差 180°，
   * 与滚完时的朝向差 ≈ 0.12°）。
   */
  it('锁定中：翻滚期间朝向也照着目标转（主循环那一行 `faceTowards`）', () => {
    const r = newRun()
    r.playerLock = { getPos: () => ({ x: 0, y: 0, z: 8 }), get radius() { return 2 } }
    r.player.yaw = Math.PI // 背对锁定目标，好让 `faceTowards` 有活干
    const yaw0 = r.player.yaw
    const before = { x: r.player.pos.x, z: r.player.pos.z }
    r.set([0, 0], [0, 0], [0]) // dodge
    r.tick()
    r.set([0, 0], [0, 0], [])
    let end = { ...before }
    for (let i = 0; i < playerBase.roll.lockOnTotal; i++) {
      const p0 = { x: r.player.pos.x, z: r.player.pos.z }
      r.tick()
      const p1 = { x: r.player.pos.x, z: r.player.pos.z }
      if (Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1e-9) end = p1
    }
    const yawAfterRoll = r.player.yaw
    expect(Math.abs(wrapPi(yawAfterRoll - yaw0)), '翻滚期间朝向就该跟着目标转（不是滚完才转）')
      .toBeGreaterThan(0.5)
    expect(Math.abs(wrapPi(yawAfterRoll)), '转完了该指着目标（yaw → 0）').toBeLessThan(0.05)
    const travel = { x: end.x - before.x, z: end.z - before.z }
    expect(Math.hypot(travel.x, travel.z), '锁定那一滚该走 `lockOnDist` 那一格')
      .toBeCloseTo(playerBase.roll.lockOnDist, 2)
  })
})
