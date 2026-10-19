import { describe, expect, it, afterEach } from 'vitest'
import { AudioEngine } from '@/audio/AudioEngine'
import { FakeAudioContext, fakeWindow, type FakeWindow } from '../support/fakeAudio'

/**
 * 音频消费端的**持久音量**（KI-142 补测）。
 *
 * **为什么补**：`setVolume`／`applyOne`／`applyPendingVolumes` 这一路（KI-026 的四条总线 ＋ master）
 * 在覆盖率读数里是**零覆盖**——而它是"玩家在调音桩上拉音量"这条路的唯一实现。
 * 覆盖它顺带把覆盖率地板顶回地板之上（地板是只许涨的棘轮，新代码不测就砸穿）。
 *
 * **用仓库自己的假 AudioContext**（`tests/support/fakeAudio.ts`，`install()` 装窗）：
 * 它保证**图形状与调度可断言**（不保证"好听"——那要人戴耳机实机评审，与 KI-010 同因）。
 *
 * **测的是行为，不是实现**：
 *   · 音量被夹在 0..1（传 2 或 -1 都不许越界——越界的音量会让 WebAudio 抛错）；
 *   · 四条总线各有一格（互不串）；
 *   · 图还没建（没有用户手势 ⇒ 没有 AudioContext）时**先存着**，等图建好再一次性灌进去。
 */
const engines: AudioEngine[] = []
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose()
})

/** 装一只自己的假 window（引擎把手势监听挂在**当时的** window 上 ⇒ 换 window 就等于关掉上一只） */
const installWindow = (): FakeWindow => {
  class Spy extends FakeAudioContext {}
  const w = fakeWindow(Spy)
  w.install()
  return w
}

describe('音频消费端音量（KI-142）', () => {
  it('音量夹在 0..1：越界的值不许过关', () => {
    installWindow()
    const a = new AudioEngine()
    engines.push(a)
    a.setVolume('master', 2)
    expect(a.getVolume('master'), '上限之外夹到 1').toBe(1)
    a.setVolume('master', -1)
    expect(a.getVolume('master'), '下限之外夹到 0').toBe(0)
    a.setVolume('master', 0.42)
    expect(a.getVolume('master'), '区间内的原样存').toBeCloseTo(0.42, 6)
  })

  it('四条总线各有一格（互不串）', () => {
    installWindow()
    const a = new AudioEngine()
    engines.push(a)
    a.setVolume('music', 0.3)
    a.setVolume('sfx', 0.8)
    expect(a.getVolume('music')).toBeCloseTo(0.3, 6)
    expect(a.getVolume('sfx')).toBeCloseTo(0.8, 6)
    expect(a.getVolume('ambience'), '没写过的读默认 1').toBe(1)
  })

  it('图还没建时先存着，建好图之后灌进去（玩家的音量选择不能丢）', () => {
    const w = installWindow()
    const a = new AudioEngine()
    engines.push(a)
    a.setVolume('music', 0.25)
    expect(a.getVolume('music'), '还没有 AudioContext 也要留住这一格').toBeCloseTo(0.25, 6)
    // 首次用户手势 ⇒ 建图 ⇒ 存着的音量被灌进那条总线
    w.dispatch('pointerdown')
    a.start()
    expect(a.getVolume('music'), '建图之后读数不变（灌的是同一个值）').toBeCloseTo(0.25, 6)
    // 图建好之后再设 ⇒ 这一次是**直接**落到那条总线的 gain 上
    a.setVolume('sfx', 0.6)
    expect(a.getVolume('sfx')).toBeCloseTo(0.6, 6)
  })

  it('dispose 之后不再理会音量设置（引擎没了就别再写它的音量）', () => {
    installWindow()
    const a = new AudioEngine()
    engines.push(a)
    a.dispose()
    a.setVolume('master', 0.5)
    expect(a.getVolume('master'), 'dispose 之后的写入应当被忽略').toBe(1)
  })
})
