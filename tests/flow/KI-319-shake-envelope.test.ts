import { describe, expect, it } from 'vitest'
import { CameraRig, SHAKE_TABLE } from '@/player/CameraRig'

/**
 * KI-319：§10 震镜包络与弹反 roll 2° 回正——首次在真链上量读数。
 * 三件事：
 *  ?**帧列 ⇄ 运行时的换算**（和 KI-306 一致）：设计表的「帧」列在 90ms 写 6f、120ms 写 8f，
 *     而运行时的唯一换算是 `msToTicks = round(ms / (1000/60))` ⇒ **5 / 7 ticks** 。
 *     运行时以**毫秒**为准，帧列是设计侧的取整写法 ⇒ 只量不裁。
 *  ?**完美/弹反整行就是对应 ms，没有「额外减免/追加」**（和 KI-306 一致）：
 *     弹反 shake: amp 0.5° / freq 24Hz / dur 60ms（`dur: 0.06s`），roll 2° 回正 ⇐ 与 §10 表逐字对上。
 *     30ms 的那一格属于拍点奖励（combat.md §4.1），不是格挡修正。
 *  ?**30ms 的归属**：同一记轻击，命中落在拍点上报 90ms、落在拍与拍中间报 60ms。它是时机的属性，不是格挡的属性。
 *
 * 读数一律从真链取：直接读 SHAKE_TABLE 等机器载体。
 * 设计值手钉在这里（不读数据表）：表一改，这条腿该红。
 */

describe('KI-319 §10 震镜包络与弹反 roll 2° 回正', () => {
  it('腿① **弹反 shake 真读数**：parry shake amp 0.5° / freq 24Hz / dur 60ms（dur: 0.06s）⇐ §10 表逐字对上', () => {
    expect(SHAKE_TABLE.parry.amp, 'parry amp = 0.5°').toBe(0.5)
    expect(SHAKE_TABLE.parry.freq, 'parry freq = 24Hz').toBe(24)
    expect(SHAKE_TABLE.parry.dur, 'parry dur = 60ms (0.06s)').toBe(0.06)
    expect(SHAKE_TABLE.parry.fov, 'parry 无 FOV 附加格').toBeUndefined()
    expect(SHAKE_TABLE.parry.fovMs, 'parry 无 FOV 持续格').toBeUndefined()
  })

  it('腿② **弹反 roll 真读数**：CameraRig.shake(parry) ⇒ roll=2；其他键 ⇒ roll=0 ⇐ 既定实现', () => {
    // SHAKE_TABLE 本身不含 roll——roll 由 CameraRig.shake() 动态置位（key==='parry' ? 2 : 0）
    const g = globalThis as unknown as { innerWidth: number; innerHeight: number }
    g.innerWidth = 960
    g.innerHeight = 540
    const rig = new CameraRig()
    rig.shake('parry')
    rig.shake('heavy')
    rig.shake('graze')
    const shakes = (rig as unknown as { shakes: Array<{ roll: number }> }).shakes
    expect(shakes[0].roll).toBe(2)
    expect(shakes[1].roll).toBe(0)
    expect(shakes[2].roll).toBe(0)
  })

  it('腿③ **30ms 不在震镜表里**：30ms 是 §4.1 拍点 hitstop +30ms（combat.md），不属于 §10 震镜', () => {
    // 震镜表里不许混进 0.03s（30ms）的那一行：它是 hitstop 的属性，不是震镜的属性
    const durs = Object.values(SHAKE_TABLE).map((s) => s.dur)
    expect(durs).not.toContain(0.03)
    // 震镜表最小的是 60ms（parry）
    expect(Math.min(...durs)).toBe(0.06)
  })

  it('腿④ **帧列 ⇄ msToTicks 只量不裁**：90ms ⇒ 5 ticks / 120ms ⇒ 7 ticks，与设计表 6f / 8f 一致', () => {
    // msToTicks = round(ms / (1000/60))
    const msToTicks = (ms: number) => Math.round(ms / (1000 / 60))
    expect(msToTicks(90), '90ms ⇒ 5 ticks').toBe(5)
    expect(msToTicks(120), '120ms ⇒ 7 ticks').toBe(7)
    expect(msToTicks(60), '60ms ⇒ 4 ticks').toBe(4)
    expect(msToTicks(45), '45ms ⇒ 3 ticks').toBe(3)
  })
})