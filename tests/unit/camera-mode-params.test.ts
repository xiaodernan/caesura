import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CameraRig, CameraMode, MODE_CONFIG } from '@/player/CameraRig'
import { bus, type GameEvents } from '@/core/EventBus'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * **相机模式表那几格真的有人读吗**（KI-170）。
 *
 * **病（实测）**：`src/player/CameraRig.ts` 的 `MODE_CONFIG` 是"五种相机"的唯一真源，
 * 可其中两格**没有任何读者**：
 *  · **`fovBase`**（50／48／45／42／50）——`setMode()` 只在 cutscene 明确给了 `fov` 时才动
 *    `baseFov`，于是**相机在所有模式里都是 50°**（实测：五个模式逐个量，fov 全是 50）。
 *    后果是设计写的那一行在运行时是假的：`docs/combat.md` §7「锁定式越肩推轨，**FOV 45°**」
 *    ——锁定时镜头是 50°，越肩那一格从未兑现。
 *  · **`collisionDamp`**（4／6／8／10／0）——**含义从未被裁**（是"进墙的缓动"还是"出墙的缓动"？
 *    设计没说），且没有任何读者 ⇒ 按 §55「无消费方的数据不许入表」**删列**，不替它编一个意思。
 *
 * **这一份做的**：① `fovBase` 有了读者（`setMode` 进哪一格就摆那一格的 FOV；cutscene 明确给的
 * FOV 仍然压过模式那一格——那一格是**演出自己**的镜头）；② **锁定 ⇒ 相机走越肩那一格**
 * （combat.md §7 那一行第一次真的成立：FOV 45°、距离 4.2、target bias 0.35）；
 * ③ 删掉 `collisionDamp` 那一列；④ 一条**护栏**：模式表里**每一列都有人读**
 * （这一条当初就会抓住 `collisionDamp`，也会抓住下一个孤零零的格子）。
 *
 * **一个手钉的数都没有**：每一格都从 `MODE_CONFIG` 现取（模式、FOV、距离、偏置）。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const dt = 1 / 60
const look = { dx: 0, dy: 0 }

/**
 * 玩家替身：`CameraRig.update()` 只读 `pos`／`floorY`／`executing`／`moveSpeed`，
 * 写 `camYawRef`——替身只给这几格（`as unknown as PlayerController`：它不是控制器，
 * 说清这一点比 `as any` 诚实）。
 */
function playerStub(pos = { x: 0, y: 0, z: 0 }): PlayerController {
  return {
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    floorY: 0,
    executing: null,
    camYawRef: 0,
    moveSpeed: 0,
  } as unknown as PlayerController
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.innerWidth = 1920
  g.innerHeight = 1080
  g.devicePixelRatio = 1
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})

/** `bus` 是进程级单例：本文件挂上去的监听器必须在用例结束后摘掉 */
const unsubscribers: Array<() => void> = []
type ModeChangedEvent = GameEvents['camera.modeChanged']
afterEach(() => {
  while (unsubscribers.length > 0) unsubscribers.pop()?.()
})

/**
 * **注释不算读者**（§55 的读法）：一行注释里提到某个格子名，不等于代码读它。
 * 去掉块注释与行注释后再扫——本仓的相机那一段正好写着"collisionDamp 那一列…删列"，
 * 不去掉注释的话那条护栏会被**注释本身**骗过去。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('相机模式表：每一格都有人读（KI-170）', () => {
  it('五种模式的 FOV 就是表里那一行（此前 fovBase 没人读 ⇒ 五个模式全是 50°）', () => {
    for (const mode of Object.values(CameraMode)) {
      const rig = new CameraRig()
      rig.setMode(mode)
      // **越肩那一格由锁定状态拥有**（锁定 ⇒ 那一格；解锁 ⇒ 回到锁定前那一格）⇒
      // 量它的时候得真的有锁定目标，否则 `update()` 会按"没有锁定"把它归位。
      const target = mode === CameraMode.LockOn ? { x: 0, y: 0, z: 8 } : null
      rig.update(dt, playerStub(), look, target, dt)
      expect(rig.getMode(), `模式 ${mode} 该留在自己那一格`).toBe(mode)
      expect(rig.cam.fov, `模式 ${mode} 的 FOV 该是表里那一格`).toBe(MODE_CONFIG[mode].fovBase)
    }
  })

  it('锁定 ⇒ 相机走越肩那一格（combat.md §7「锁定式越肩推轨，FOV 45°」第一次成立）', () => {
    const rig = new CameraRig()
    const target: Vec3 = { x: 0, y: 0, z: 8 }
    rig.update(dt, playerStub(), look, target, dt)
    const lockOn = MODE_CONFIG[CameraMode.LockOn]
    expect(rig.getMode(), '锁定时相机该在越肩那一格').toBe(CameraMode.LockOn)
    expect(rig.cam.fov, '锁定时的 FOV 该是越肩那一格的值（combat.md §7 写的是 45°）').toBe(lockOn.fovBase)
  })

  it('解锁 ⇒ 回到进锁定之前的那一格（锁定不该把人丢回探索格）', () => {
    const rig = new CameraRig()
    rig.update(dt, playerStub(), look, { x: 0, y: 0, z: 8 }, dt)
    expect(rig.getMode()).toBe(CameraMode.LockOn)
    rig.update(dt, playerStub(), look, null, dt)
    expect(rig.getMode(), '解锁后该回到锁定前那一格').toBe(CameraMode.Exploration)
    expect(rig.cam.fov, '解锁后 FOV 回到探索那一格').toBe(MODE_CONFIG[CameraMode.Exploration].fovBase)
  })

  it('cutscene 明确给的 FOV 压过模式那一格；过场结束回到模式那一行', () => {
    const rig = new CameraRig()
    const events: ModeChangedEvent[] = []
    unsubscribers.push(bus.on('camera.modeChanged', (e) => events.push(e)))
    rig.setMode(CameraMode.Cinematic, { fov: 30, duration: 1 })
    rig.update(dt, playerStub(), look, null, dt)
    expect(rig.cam.fov, 'cutscene 给了 FOV 就用它（那一格是演出自己的镜头）').toBe(30)
    rig.setMode(CameraMode.Exploration)
    rig.update(dt, playerStub(), look, null, dt)
    expect(rig.cam.fov, '过场结束回到模式那一行').toBe(MODE_CONFIG[CameraMode.Exploration].fovBase)
    expect(events.length, '同模式不重复发事件的规矩没被这一批改掉').toBe(2)
  })

  it('过场期间镜头归过场管：锁定不夺走它', () => {
    const rig = new CameraRig()
    rig.setMode(CameraMode.Cinematic, { fov: 30, duration: 1 })
    rig.update(dt, playerStub(), look, { x: 0, y: 0, z: 8 }, dt)
    expect(rig.getMode(), '过场模式不被锁定抢走').toBe(CameraMode.Cinematic)
    expect(rig.cam.fov, '过场的 FOV 也不被锁定改写').toBe(30)
  })

  it('模式表里每一列都有人读（§55：数据不许无消费方；这一条当初就会抓住 collisionDamp）', () => {
    const src = stripComments(readFileSync(root + 'src/player/CameraRig.ts', 'utf8'))
    const start = src.indexOf('export const MODE_CONFIG')
    expect(start, '没读到 MODE_CONFIG 的定义（抽取形状坏了 ⇒ 这条会看一个空集合）').toBeGreaterThan(-1)
    const tableEnd = src.indexOf('} as const', start)
    expect(tableEnd, '没读到模式表的结尾').toBeGreaterThan(start)
    const rest = src.slice(tableEnd)
    const keys = Object.keys(MODE_CONFIG[CameraMode.Exploration])
    expect(keys.length, '模式表一行都没有读到 = 分母是空的').toBeGreaterThanOrEqual(5)
    const orphans = keys.filter((k) => !rest.includes(k))
    expect(
      orphans,
      `模式表里这些格子在表以外没有任何读者（注释不算读者）⇒ §55：无消费方的数据不许入表：${orphans.join('、')}`,
    ).toEqual([])
  })
})
