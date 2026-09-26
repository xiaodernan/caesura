import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { AudioEngine } from '@/audio/AudioEngine'
import { FakeAudioContext, FakeNode, fakeWindow } from '../support/fakeAudio'

/**
 * KI-066 的整链腿：**敌人数据表里的拍速，最后必须变成耳朵里的拍距**。
 *
 * docs/audio.md §2.1 定的方向是"BPM 是敌人攻击网格的来源（不是反过来）"，而代码里这条路今天通了：
 * `en_ostlara` 的私有拍速 → `AISystem.syncClock` → `RhythmClock.overrideTo` → `audio.music.grid`
 * → `AudioEngine` 缓存/转交 → `MusicLayer.scheduleBeat` 的间距。
 * 这里不手填任何 BPM 期望值：判据是"调度出来的拍距 = 钟当前的拍距"，而"钟真的被它接管了"另有断言。
 * （音乐层自己的形状、3/4、accent 周期在 `tests/unit/audio-music.test.ts`。）
 */

registerGameData()

const made: FakeAudioContext[] = []

/** 沿 connect 边向上找：这个节点最终汇进音乐总线吗（sfx 走 sfx 总线，drone 走 ambience 总线） */
function toMusic(n: FakeNode, ctx: FakeAudioContext, musicBus: FakeNode): boolean {
  let frontier: FakeNode[] = [n]
  for (let hop = 0; hop < 5 && frontier.length; hop++) {
    const next: FakeNode[] = []
    for (const f of frontier) {
      for (const e of ctx.edges) {
        if (e.from !== f || !(e.to instanceof FakeNode)) continue
        if (e.to === musicBus) return true
        next.push(e.to)
      }
    }
    frontier = next
  }
  return false
}

function world() {
  class Spy extends FakeAudioContext {
    constructor() { super(); made.push(this) }
  }
  const w = fakeWindow(Spy)
  w.install()

  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4) // 休垒/野外基准（真值在 regions.json > grid）
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, registry.get<MovesetData>(`moveset:${sword.movesetId}`))
  const ai = new AISystem()
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999

  const engine = new AudioEngine()
  engine.start()
  const ctx = made[made.length - 1]
  const musicBus = ctx.nodes.find((n) => n.kind === 'gain' && Math.abs(n.params.gain.value - 0.5) < 1e-9) as FakeNode
  expect(musicBus, '图里没有音乐总线（电平 0.5）').toBeTruthy()

  const grids: Array<{ bpm: number; beatsPerBar: number }> = []
  const offs = [bus.on('audio.music.grid', (g) => grids.push(g)), () => w.uninstall()]
  cleanup.push(...offs)

  /** 走 `n` 个逻辑 tick（钟 + AI + 音频调度共用同一条时间线），返回期间排进音乐总线的拍 */
  function run(ticks: number): number[] {
    const out: number[] = []
    for (let i = 0; i < ticks; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      rhythm.update(TICK_DT)
      const n0 = ctx.nodes.length
      ctx.advance(TICK_DT)
      engine.update(TICK_DT)
      const t = ctx.nodes.slice(n0)
        .filter((n) => (n.kind === 'osc' || n.kind === 'bufferSource') && toMusic(n, ctx, musicBus))
        .flatMap((n) => n.startedAt)
      if (t.length) out.push(Math.min(...t))
    }
    return out
  }
  return { rhythm, ai, engine, run, grids }
}

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

describe('敌人拍速 → 战斗音乐的拍距（整链）', () => {
  it('她没有参战时脉冲按区域基准走；她一接管，间距就换成她的拍（且没人被硬编码的 84 钉住）', () => {
    const w = world()
    bus.emit('audio.music.encounter', { start: true })
    /** 最后一个间距：换网格时"队列里已排好的那一拍"仍走旧间距，所以要看稳下来的那一段 */
    const settledGap = (a: number[]): number => a[a.length - 1] - a[a.length - 2]
    const before = w.run(240) // 4 秒
    expect(before.length, '区域基准下连四拍都没排').toBeGreaterThanOrEqual(4)
    expect(settledGap(before), '区域基准的拍距没跟钟（60/84）').toBeCloseTo(60 / 84, 6)

    const foe = w.ai.spawn('en_ostlara', { x: 0, y: -40, z: 0 }, 'ki066')
    foe.enter('chase') // syncClock 认 combat/chase 两种"正在交战"；这里要的是她的拍，不是她的招式
    w.run(4)
    expect(w.rhythm.clockOwner, '她没有接管全场网格').toBe('boss')
    expect(w.rhythm.bpm, '她接管之后钟还是区域基准 = 前半句会自证，这条量不到东西').not.toBe(84)

    const after = w.run(240)
    expect(after.length, '接管之后音乐停了').toBeGreaterThanOrEqual(4)
    expect(settledGap(after), `拍距没跟到她的 ${w.rhythm.bpm}BPM`).toBeCloseTo(60 / w.rhythm.bpm, 6)
    expect(Math.abs(settledGap(before) - settledGap(after)),
      '接管前后间距没变 = 网格变化从来没走到耳朵').toBeGreaterThan(0.05)

    // 事件序列本身：第一次发布 → 接管那一条，中间没有被逐 tick 重算刷出来
    expect(w.grids[0], '第一次发布不是区域基准').toEqual({ bpm: 84, beatsPerBar: 4 })
    expect(w.grids[w.grids.length - 1], '最后一条网格不是她接管后的值')
      .toEqual({ bpm: w.rhythm.bpm, beatsPerBar: w.rhythm.beatsPerBar })
    expect(w.grids.length, `接管过程发了 ${w.grids.length} 条 = syncClock 每 tick 重算在刷总线`).toBeLessThanOrEqual(3)
  })
})
