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

describe('audio.music.grid：发布点是 update()，且只在真的变化时发', () => {
  it('构造与 setBpm 都不喊（没有循环就没有耳朵）；第一次 update 把当前网格补发出来', () => {
    listen()
    const c = new RhythmClock()
    c.setBpm(84, 4) // main.ts:62 就是这一句：它发生在 AudioEngine 出生之前
    expect(seen.length, '还没人订阅就"发布过"了 = 战斗音乐永远等不到拍网').toBe(0)
    c.update(1 / 60)
    expect(seen, '第一次 update 没把网格交出去').toEqual([{ bpm: 84, beatsPerBar: 4 }])
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
    expect(seen[1], '变化没被补发').toEqual({ bpm: 100, beatsPerBar: 3 })
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
    expect(seen[1]).toEqual({ bpm: 108, beatsPerBar: 3 })
    for (let i = 0; i < 120; i++) { c.overrideTo(108, 3); c.update(1 / 60) }
    expect(seen.length, `syncClock 那种每 tick 重算发了 ${seen.length - 2} 条 = 总线被刷`).toBe(2)
    expect(c.restoreHome()).toBe(true)
    c.update(1 / 60)
    expect(seen.length, '归还没告诉音频 = 她会一直演到散场').toBe(3)
    expect(seen[2]).toEqual({ bpm: 84, beatsPerBar: 4 })
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
    expect(seen[seen.length - 1], '归还之后没落到新基准 = 区域换 BPM 永远进不了耳朵')
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
