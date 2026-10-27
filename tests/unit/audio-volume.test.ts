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
/** 本文件建过的每一只 AudioContext（图建好之后要读 master 那条增益上的排程） */
let made: FakeAudioContext[] = []
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose()
  made = []
})

/** 装一只自己的假 window（引擎把手势监听挂在**当时的** window 上 ⇒ 换 window 就等于关掉上一只） */
const installWindow = (): FakeWindow => {
  class Spy extends FakeAudioContext {
    constructor() {
      super()
      made.push(this)
    }
  }
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

  it('主音量真的落到 master 那条增益上（0.85 × v），不只是记在读数里', () => {
    const w = installWindow()
    const a = new AudioEngine()
    engines.push(a)
    // 图还没建时调 `setVolume` 只是**存着**（上面那条已经证过）；这一条要证的是
    // **图建好之后**主音量真的被排到了 master 的 gain 上——
    // 那条分支（`applyOne` 的 master 那一支）此前**没有任何一条用例走过**：
    // 既有用例调 `setVolume('master', …)` 时图都还没建，于是每次都在
    // 「图/上下文还没有 ⇒ 先存着」那一行就返回了。
    w.dispatch('pointerdown')
    a.start()
    const ctx = made[made.length - 1]
    const master = ctx.nodes.find((n) => n.kind === 'gain' && Math.abs(n.params.gain.value - 0.85) < 1e-9)
    expect(master, '图里没有 0.85 那条 master 增益').toBeTruthy()
    const before = master!.params.gain.events.length
    a.setVolume('master', 0.5)
    const events = master!.params.gain.events
    expect(events.length, '主音量没有被排到 master 的增益上').toBe(before + 1)
    const last = events[events.length - 1]
    expect(last.kind, '主音量应当是**排程**上去的（target），不是硬写一个值').toBe('target')
    expect(last.value, 'master 的目标是它自己的基准电平 × 玩家的主音量').toBeCloseTo(0.85 * 0.5, 6)
  })

  it('图建好之前调的主音量，在图建好时被灌进 master（玩家开局前调的主音量不能丢）', () => {
    const w = installWindow()
    const a = new AudioEngine()
    engines.push(a)
    a.setVolume('master', 0.4)
    w.dispatch('pointerdown')
    a.start()
    const ctx = made[made.length - 1]
    const master = ctx.nodes.find((n) => n.kind === 'gain' && Math.abs(n.params.gain.value - 0.85) < 1e-9)
    expect(master, '图里没有 0.85 那条 master 增益').toBeTruthy()
    const targets = master!.params.gain.events.filter((e) => e.kind === 'target')
    expect(targets.length, '存着的主音量没有被灌进 master').toBeGreaterThanOrEqual(1)
    expect(targets[targets.length - 1].value, '灌下去的目标应当是 0.85 × v').toBeCloseTo(0.85 * 0.4, 6)
  })
})
