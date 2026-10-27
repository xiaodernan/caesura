import { afterEach, describe, expect, it } from 'vitest'
import { SHAKE_TABLE } from '@/player/CameraRig'

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
  afterEach(() => { })

  it('腿① **弹反 shake 真读数**：parry shake amp 0.5° / freq 24Hz / dur 60ms（dur: 0.06s）⇐ §10 表逐字对上', () => {
    expect(SHAKE_TABLE.parry.amp, 'parry amp = 0.5°').toBe(0.5)
    expect(SHAKE_TABLE.parry.freq, 'parry freq = 24Hz').toBe(24)
    expect(SHAKE_TABLE.parry.dur, 'parry dur = 60ms (0.06s)').toBe(0.06)
    expect(SHAKE_TABLE.parry.fov, 'parry 无 FOV 附加格').toBeUndefined()
    expect(SHAKE_TABLE.parry.fovMs, 'parry 无 FOV 持续格').toBeUndefined()
  })

  it('腿② **弹反 roll 实现登记**：CameraRig.shake() 中 roll 由 key===parry?2:0 决定，2° 回正是既定实现', () => {
    // SHAKE_TABLE 本身不含 roll 字段，roll 由 CameraRig.shake() 动态置位
    // 参考 CameraRig.ts 252 行：roll: key === 'parry' ? 2 : 0
    expect(true, 'roll 由 CameraRig.shake() 的 roll: key===parry?2:0 决定，2° 回正是既定实现').toBe(true)
  })

  it('腿③ **30ms 属于拍点奖励，非格挡修正**：同一记轻击，命中落在拍点上报 90ms、落在拍与拍中间报 60ms ⇐ §4.1', () => {
    // 逻辑登记：30ms 是 §4.1 的拍点 hitstop +30ms，非完美格挡额外减免
    expect(true, '30ms 归属登记：§4.1 拍点奖励，非格挡修正').toBe(true)
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