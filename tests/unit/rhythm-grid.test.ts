import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { RhythmClock } from '@/core/RhythmClock'
import type { MusicGrid } from '@/core/RhythmClock'

/**
 * KI-066：拍网的**发布**侧。
 *
 * `RhythmClock` 的类注释一直写着 "the audio layer phase-locks WebAudio to this clock"，
 * 而 `music.ts` 顶上写着 `const BPM = 84` 从不跟这里走 —— 注释是意图，不是事实。
 * 这一份钉的是"意图现在有人兑现"，两条口径：
 *  ① **只有循环在跑才发**：发布点是 `update()`，不是那三个改网格的方法。
 *     `main.ts` 建钟在 :61、建 `AudioEngine` 在 :104，中间那次 `setBpm(84,4)` 若算"已发布"，
 *     全场战斗音乐就永远等不到拍网（headless 探针按这个顺序实测过：`grids: []` + 一条"没收到拍网"的 warn）。
 *  ② **只在真的变了才发**：`AISystem.syncClock` 每 tick 重算一次接管状态，幂等重算不许刷总线。
 */

let seen: MusicGrid[] = []
let off: (() => void) | null = null

function listen(): void {
  seen = []
  off?.()
  off = bus.on('audio.music.grid', (g) => seen.push({ ...g }))
}
afterEach(() => { off?.(); off = null })

/**
 * KI-069 之后载荷还多带一个 `enter`，而 KI-066 那批断言量的是"网格本身"。
 * 所以它们收窄到这两个字段：新字段不该把旧断言绑架成"必须等于整个对象"，
 * 否则下一格加字段又要再来改一遍。（`enter` 自己另有一组用例。）
 */
const shape = (g: MusicGrid) => ({ bpm: g.bpm, beatsPerBar: g.beatsPerBar })

describe('audio.music.grid：发布点是 update()，且只在真的变化时发', () => {
  it('构造与 setBpm 都不喊（没有循环就没有耳朵）；第一次 update 把当前网格补发出来', () => {
    listen()
    const c = new RhythmClock()
    c.setBpm(84, 4) // main.ts:62 就是这一句：它发生在 AudioEngine 出生之前
    expect(seen.length, '还没人订阅就"发布过"了 = 战斗音乐永远等不到拍网').toBe(0)
    c.update(1 / 60)
    expect(seen.map(shape), '第一次 update 没把网格交出去').toEqual([{ bpm: 84, beatsPerBar: 4 }])
    for (let i = 0; i < 200; i++) c.update(1 / 60)
    expect(seen.length, `步进 200 tick 发了 ${seen.length} 条 = 每 tick 在刷`).toBe(1)
  })

  it('换了网格要等下一次 update 才发；同值重复 setBpm 永远不发', () => {
    listen()
    const c = new RhythmClock()
    c.update(1 / 60)
    c.setBpm(100, 3)
    expect(seen.length, 'setBpm 自己发 = 发布点不止 update()，两处会各说一份').toBe(1)
    c.update(1 / 60)
    expect(shape(seen[1]), '变化没被补发').toEqual({ bpm: 100, beatsPerBar: 3 })
    c.setBpm(100, 3)
    c.update(1 / 60)
    expect(seen.length, '同值再 setBpm 一次又发一条').toBe(2)
  })

  it('Boss 接管与归还各发一条；她期间逐 tick 重算不发（§15.2）', () => {
    listen()
    const c = new RhythmClock()
    c.update(1 / 60)
    expect(c.overrideTo(108, 3)).toBe(true)
    c.update(1 / 60)
    expect(seen.length, '接管没告诉音频').toBe(2)
    expect(shape(seen[1])).toEqual({ bpm: 108, beatsPerBar: 3 })
    for (let i = 0; i < 120; i++) { c.overrideTo(108, 3); c.update(1 / 60) }
    expect(seen.length, `syncClock 那种每 tick 重算发了 ${seen.length - 2} 条 = 总线被刷`).toBe(2)
    expect(c.restoreHome()).toBe(true)
    c.update(1 / 60)
    expect(seen.length, '归还没告诉音频 = 她会一直演到散场').toBe(3)
    expect(shape(seen[2])).toEqual({ bpm: 84, beatsPerBar: 4 })
  })

  it('接管期间 setBpm 改的是基准不是当前网格：归还之后发的必须是新基准', () => {
    listen()
    const c = new RhythmClock()
    c.update(1 / 60)
    c.overrideTo(108, 3)
    c.update(1 / 60)
    c.setBpm(92, 4) // 玩家走进下一块区域，而她还在接管
    c.update(1 / 60)
    expect(seen.length, '耳朵此刻听的是她的拍，区域基准不该插一条').toBe(2)
    c.restoreHome()
    c.update(1 / 60)
    expect(shape(seen[seen.length - 1]), '归还之后没落到新基准 = 区域换 BPM 永远进不了耳朵')
      .toEqual({ bpm: 92, beatsPerBar: 4 })
  })

  it('暂停中也发（网格是"现在是多少"，不是"走没走"）', () => {
    listen()
    const c = new RhythmClock()
    c.paused = true
    c.update(1 / 60)
    expect(seen.length, '暂停时不发 = 开场菜单里定好网格，进战斗时音频还在等').toBe(1)
    expect(c.beat, '暂停却推进了逻辑拍').toBe(0)
  })

  it('`drift`（§15.2 拍寄生的摆动）不算网格变化：发出去的是名义拍速', () => {
    listen()
    const c = new RhythmClock()
    c.update(1 / 60)
    c.drift = 0.08
    for (let i = 0; i < 60; i++) c.update(1 / 60)
    expect(seen.length, 'drift 被当成网格变化发了 = 战斗曲会跟着抖').toBe(1)
    expect(seen[0].bpm, '名义拍速被 drift 改写').toBe(84)
  })
})

/**
 * KI-068：§2.1「EncounterTrigger → BeatClock.snapToNextBar()（≤2 拍内进战斗曲）」。
 * 这里做成**只读查询**而不是字面上那句"把钟 snap 到小节头"：移钟会连带挪走场上所有在飞招式的
 * hit-frame 量化（§2.1 同一节给敌人的那条约束），为了音乐的落点去动玩法的拍，代价方向反了。
 */
describe('barEntry()：入战落点是查出来的，不是把钟挪过去', () => {
  /** 小节内位置（第几拍，0 起，含相位）—— 判据都从钟自己的读数推，不手抄浮点 */
  const posOf = (c: RhythmClock): number => {
    const i = c.info()
    return i.beatInBar - 1 + i.phase
  }
  /** 把钟步进到"小节内第 target 拍"附近（每 tick 1/60，落在第一个 ≥target 的位置） */
  const stepTo = (c: RhythmClock, target: number): RhythmClock => {
    let guard = 0
    while (posOf(c) < target && guard++ < 100000) c.update(1 / 60)
    return c
  }

  it('4/4 的后半小节：等到小节头，等待 = 剩下的那一截、落点 beatIndex 真的落在小节头上', () => {
    const c = stepTo(new RhythmClock(), 2.5) // 第 3 拍过半 ⇒ 离小节头不到 2 拍
    const pos = posOf(c)
    expect(pos, `前置没走到后半小节（pos=${pos}），这条量不了"够得着"那一支`).toBeGreaterThanOrEqual(2)
    const e = c.barEntry()
    expect(e.beatIndex % c.beatsPerBar, `落点 ${e.beatIndex} 不在小节头`).toBe(0)
    expect(e.waitSec, `等待 ${e.waitSec} 不等于剩下的 ${4 - pos} 拍`).toBeCloseTo((4 - pos) * (60 / c.bpm), 9)
    expect(e.waitSec, `等了 ${e.waitSec}s > §2.1 那句 ≤2 拍`).toBeLessThanOrEqual(2 * (60 / c.bpm) + 1e-9)
  })

  it('4/4 的前半小节：小节头要等 >2 拍 ⇒ 夹到下一拍点，报的拍号是真拍号（不假装是小节头）', () => {
    const c = stepTo(new RhythmClock(), 0.5)
    const info = c.info()
    const pos = info.beatInBar - 1 + info.phase
    expect(4 - pos, `这条量的是"够不着"那一支，前提要先成立：小节头只剩 ${4 - pos} 拍`).toBeGreaterThan(2)
    const e = c.barEntry()
    expect(e.waitSec, `夹不住时等了 ${e.waitSec}s，应该只等到下一拍点（剩下 ${1 - info.phase} 拍）`)
      .toBeCloseTo((1 - info.phase) * (60 / c.bpm), 9)
    expect(e.beatIndex, '退到下一拍点却报了个假拍号').toBe(info.beatIndex + 1)
    expect(e.beatIndex % 4, '夹住那一支不该报小节头').not.toBe(0)
  })

  it('3/4（奥斯塔拉）里小节头每 3 拍一次：预算守得住，且两支都真的被走到过', () => {
    const beatSec = 60 / 108
    const c = new RhythmClock()
    c.setBpm(108, 3)
    let sawHead = 0
    for (let i = 0; i < 400; i++) {
      const e = c.barEntry()
      expect(e.waitSec, `第 ${i} tick 等了 ${e.waitSec}s > 2 拍（${2 * beatSec}s）`).toBeLessThanOrEqual(2 * beatSec + 1e-9)
      if (e.beatIndex % 3 === 0) sawHead++
      c.update(1 / 60)
    }
    expect(sawHead, '一次都没踩到小节头 = 预算把落点全夹成了散拍').toBeGreaterThan(0)
    expect(sawHead, '400 条全踩小节头不可能（3 拍的小节有 1/3 的时刻离头 >2 拍）').toBeLessThan(400)
  })

  it('深窖那种 1 拍小节（60/1）：头就在下一拍，等待永远 ≤1 拍', () => {
    const c = new RhythmClock()
    c.setBpm(60, 1)
    for (let i = 0; i < 120; i++) {
      const info = c.info()
      const e = c.barEntry()
      expect(e.waitSec, `心跳区等了 ${e.waitSec} > 1 拍`).toBeLessThanOrEqual(60 / 60 + 1e-9)
      // 1 拍小节里"小节头"与"下一拍"是同一个东西，所以落点必须是真的一拍之后
      expect(e.beatIndex, `pos=${info.phase} 时报的拍号 ${e.beatIndex} 不是下一拍`).toBe(info.beatIndex + (info.phase === 0 ? 0 : 1))
      c.update(1 / 60)
    }
  })

  it('钟刚起来（正踩在拍点上）时不等待，落点就是当前这一拍；走一步之后等的是"到下一拍"那一截', () => {
    const c = new RhythmClock()
    const e0 = c.barEntry()
    expect(e0.waitSec, '已经在小节头上还要等').toBe(0)
    expect(e0.beatIndex, '开局报的拍号不是当前这拍').toBe(0)
    c.update(1 / 60) // 走一步：phase>0 且还在第 1 拍里
    const info = c.info()
    expect(info.phase).toBeGreaterThan(0)
    const e1 = c.barEntry()
    expect(e1.waitSec, `等的不是"到下一拍"那一段（phase=${info.phase}）`)
      .toBeCloseTo((1 - info.phase) * (60 / c.bpm), 9)
    expect(e1.beatIndex).toBe(info.beatIndex + 1)
  })

  it('被 Boss 接管之后查的是**她的**网格：等待秒数按她的拍长推，归还之后回到区域的（§2.1 与 KI-066 的同一条所有权）', () => {
    /** 恒等式：等待秒数 = （落点拍号 − 当前连续拍位）× 此刻的拍长。用错拍长就破，所以这条不需要手填数字 */
    const identity = (c: RhythmClock, tag: string): void => {
      const e = c.barEntry()
      expect(e.waitSec, `${tag}：等待 ${e.waitSec}s 对不上落点 ${e.beatIndex} 与当前拍位 ${c.beat} 之间的 ${60 / c.bpm}s/拍`)
        .toBeCloseTo((e.beatIndex - c.beat) * (60 / c.bpm), 9)
    }
    const c = new RhythmClock()
    c.update(1 / 60)
    stepTo(c, 1.2) // 区域 84/4 的第 2 拍里
    identity(c, '区域拍')
    // 小节形状真的参与判断：同一个连续拍位（≈1.5）在 4/4 里离头 2.5 拍（被 2 拍预算夹住），
    // 在 3/4 里离头 1.5 拍（够得着，落点是小节头）
    stepTo(c, 1.49)
    const under4 = c.barEntry()
    c.overrideTo(108, 3)
    c.update(1 / 60)
    const under3 = c.barEntry()
    expect(under4.beatIndex % 4, '4/4 里这个拍位离小节头 2.5 拍，本该被预算夹住').not.toBe(0)
    expect(under3.beatIndex % 3, '换成 3/4 之后同一位置离头只剩 1.5 拍，该踩到小节头').toBe(0)
    identity(c, '接管成 108/3 之后')
    expect(c.restoreHome()).toBe(true)
    c.update(1 / 60)
    identity(c, '归还之后')
  })
})

/**
 * KI-069 的发布侧：网格**变了**那一次，除了新数值还要带上"从此刻走到新的头"。
 * 消费方是 `MusicLayer`——战斗正在演的时候 Boss 接管（或归还），拍距跟着新网格（KI-066），
 * 小节位置却还是音乐层从入战那一刻自己数下来的，于是重拍与她的拍点错开，§2.1
 * 「音乐重拍与敌人主攻击对齐」在这一格还是假的。落点这条原语不新写，沿用 `barEntry()`。
 */
describe('发布侧的落点（KI-069）：网格变了就把"还要等多久、那是第几拍"一起交出去', () => {
  /** 小节内位置（0 起，含相位）：`barEntry()` 的两支就是按这个数分的手 */
  const posOf = (c: RhythmClock): number => {
    const i = c.info()
    return i.beatInBar - 1 + i.phase
  }
  /** 走到小节内位置**首次** ≥ `target`（在当前网格之下） */
  function stepToPos(c: RhythmClock, target: number): void {
    let guard = 0
    while (posOf(c) < target && guard++ < 10000) c.update(1 / 60)
  }
  /** 走到**连续拍位** ≥ `target`（跟小节形状无关，用来预告换网格之后的位置） */
  function stepToBeat(c: RhythmClock, target: number): void {
    let guard = 0
    while (c.beat < target && guard++ < 10000) c.update(1 / 60)
  }

  it('每一条发布的 `enter` 都与发布那一刻的钟自洽：等待 = 走到那一拍的秒数、且不超过 2 拍预算', () => {
    // 时刻是**构造**出来的，不是抽出来的（第一版跑 300 tick、在第 100/200 tick 换网格）：
    // `barEntry()` 吃的是**换完之后**的小节形状，同一个连续拍位在 4/4 里离头 3.5 拍（夹住那一支）、
    // 在 3/4 里只离 1.5 拍（等头那一支），手抽的两个时刻完全可能落在同一边，于是那条等式只量到一支
    // —— KI-068 的 P5（预算 2→9 不咬）就是同一类洞。
    // 如实记一句：第一版那条红**不是**因为抽不好，真因是下面订阅里的 `beatsPerBar` 抄错了地方。
    const c = new RhythmClock()
    const shots: Array<{ g: MusicGrid; beat: number; phase: number; beatsPerBar: number }> = []
    // 订阅者是在 `publishGrid()` 里面被同步调用的 ⇒ 这里读到的 `info()` 就是发布那一刻的钟
    const off2 = bus.on('audio.music.grid', (g) => {
      const i = c.info()
      // `beatsPerBar` 不在 `BeatInfo` 上（那里只有 `beatInBar`），它挂在钟本身：
      // 从 `info()` 上抄会拿到 `undefined` ⇒ 下面两个计数器都是 `NaN` 分支，一条也进不去。
      // 这一条不是洁癖：这一格第一版的红（"两支没走全"）真因就是这里，不是抽的时刻不好。
      shots.push({ g, beat: i.beatIndex, phase: i.phase, beatsPerBar: c.beatsPerBar })
    })
    c.update(1 / 60) // 发布 ①：84/4 的第 0 拍，正踩在小节头上（waitSec 0 那一格）
    stepToPos(c, 1.2)
    c.overrideTo(108, 3)
    c.update(1 / 60) // 发布 ②：换到 3/4 之后离头 3−1.2 ≈ 1.8 拍 ≤ 2 拍预算 ⇒ 走"等头"那一支
    stepToBeat(c, 4.5)
    c.restoreHome()
    c.update(1 / 60) // 发布 ③：连续拍位 ≈4.5 换回 4/4 ⇒ pos = 0.5，离头 3.5 拍 > 预算 ⇒ 夹到下一拍
    off2()
    expect(shots.length, `发了 ${shots.length} 条：第一次 + 接管 + 归还 = 3 条，多了就是每 tick 在刷`).toBe(3)
    let heads = 0
    let headsReal = 0
    let clamps = 0
    for (const s of shots) {
      const e = s.g.enter
      expect(e, '网格发布没带落点（KI-069）= 战斗中途换网格时小节位置永远跟不过去').toBeTruthy()
      if (!e) continue
      const beatSec = 60 / s.g.bpm
      expect(Number.isInteger(e.beatIndex), `落点拍号 ${e.beatIndex} 不是整拍`).toBe(true)
      expect(e.beatIndex, `落点 ${e.beatIndex} 在当前拍 ${s.beat} 之前 = 让音乐倒着等`).toBeGreaterThanOrEqual(s.beat)
      const should = (e.beatIndex - (s.beat + s.phase)) * beatSec
      expect(e.waitSec, `等待 ${e.waitSec.toFixed(4)}s 与"走到第 ${e.beatIndex} 拍"该花的 ${should.toFixed(4)}s 不一致`)
        .toBeCloseTo(should, 6)
      expect(e.waitSec, `§2.1 的预算是 2 拍，这一条等了 ${(e.waitSec / beatSec).toFixed(2)} 拍`)
        .toBeLessThanOrEqual(2 * beatSec + 1e-9)
      if (e.beatIndex % s.beatsPerBar === 0) {
        heads++
        if (e.waitSec > 0) headsReal++ // "真的要等上一截才够得着头"，不是恰好在头上那格
      } else clamps++
    }
    expect(heads, '没有一条发布落在小节头上 = 等头那一支从没被走过').toBeGreaterThan(0)
    expect(headsReal, '落在头上的那一条 waitSec 是 0 = 等头那一支只是"刚好踩到"，预算没参与').toBeGreaterThan(0)
    expect(clamps, '没有一条发布被预算夹住 = 夹到下一拍那一支从没被走过').toBeGreaterThan(0)
  })

  it('`enter` 每 tick 都在变，但它不是"网格变了"：幂等重算 100 tick 还是一条', () => {
    // 把落点塞进载荷的最大风险就在这里：`AISystem.syncClock` 每 tick 重算一次接管状态，
    // 若发布条件把 `beatIndex` 也算作变化，总线会被刷成流水账（KI-066 ② 的纪律）。
    listen()
    const c = new RhythmClock()
    c.update(1 / 60)
    c.overrideTo(108, 3)
    c.update(1 / 60)
    expect(seen.length, '接管本身没发').toBe(2)
    for (let i = 0; i < 100; i++) { c.overrideTo(108, 3); c.update(1 / 60) }
    expect(seen.length, `幂等重算发了 ${seen.length - 2} 条 = 变化判断把落点算进去了（它每 tick 都不同）`)
      .toBe(2)
    expect(seen[1].enter, '接管那一条没带落点').toBeTruthy()
  })
})
