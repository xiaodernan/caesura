import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import type { MusicGrid } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, RegionData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
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

/** 一拍的鼓点身份只看这两个数：驼鼓从 150Hz 起、军鼓边击从 200Hz 起（ostinato 的音都不撞） */
const KICK = 150
const SNARE = 200

function drumVoice(nodes: FakeNode[], musicBus: FakeNode, ctx: FakeAudioContext): 'kick' | 'snare' | 'none' {
  const f = nodes
    .filter((n) => n.kind === 'osc' && toMusic(n, ctx, musicBus))
    .map((n) => n.params.frequency.events.find((e) => e.kind === 'set')?.value ?? n.params.frequency.value)
  if (f.includes(KICK)) return 'kick'
  if (f.includes(SNARE)) return 'snare'
  return 'none'
}

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
  /**
   * KI-080：战斗层现在**只奏 `battle.json` 里的那一行**（代码里那份 `OSTINATO` 手抄已经拆了），
   * 所以这一条整链要照组合根的样子发同一句 —— 发的就是脚下那一区（休垒）在 `regions.json` 里写的那个 id，
   * 不是测试自己编的：整链腿的意义在于"真表 + 真发射点 + 真调度"三段都走一遍。
   */
  bus.emit('audio.music.battle', { id: registry.get<RegionData>('rg_resthold').music.battle })
  const ctx = made[made.length - 1]
  const musicBus = ctx.nodes.find((n) => n.kind === 'gain' && Math.abs(n.params.gain.value - 0.5) < 1e-9) as FakeNode
  expect(musicBus, '图里没有音乐总线（电平 0.5）').toBeTruthy()

  // KI-068 要的是**发射侧**：真 `CombatManager.checkEncounterMusic()`，不是测试手写一条遭遇事件。
  // 它在 KI-066 的整链里没有位置（那时只有"网格 → 耳朵"这一半），现在落点也要过它一手。
  const combat = new CombatManager(player, ai, time, rhythm)

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

  /**
   * 由真发射侧报一次遭遇，并把落点原样抄回来。
   * 抄回来的目的不是"照这个数去断言"，而是让下面那条**跨两侧的等式**（落点拍号 = 到点那刻钟自己的拍号）
   * 有左右两边：左边是音乐听到的，右边是玩法钟读出来的，两个都由各自的真实现算。
   */
  function encounterAt(): { waitSec: number; beatIndex: number } {
    let seen: { waitSec: number; beatIndex: number } | null = null
    const off = bus.on('audio.music.encounter', (p) => { if (p.enter) seen = p.enter })
    combat.checkEncounterMusic()
    off()
    if (!seen) throw new Error('发射侧没带落点 enter（KI-068）= 整链断在 CombatManager 那一环')
    return seen
  }

  return { rhythm, ai, combat, engine, run, grids, encounterAt, ctx, musicBus, drumVoice: (ns: FakeNode[]) => drumVoice(ns, musicBus, ctx) }
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
    expect({ bpm: w.grids[0].bpm, beatsPerBar: w.grids[0].beatsPerBar }, '第一次发布不是区域基准')
      .toEqual({ bpm: 84, beatsPerBar: 4 })
    expect({ bpm: w.grids[w.grids.length - 1].bpm, beatsPerBar: w.grids[w.grids.length - 1].beatsPerBar },
      '最后一条网格不是她接管后的值').toEqual({ bpm: w.rhythm.bpm, beatsPerBar: w.rhythm.beatsPerBar })
    expect(w.grids.length, `接管过程发了 ${w.grids.length} 条 = syncClock 每 tick 重算在刷总线`).toBeLessThanOrEqual(3)
  })
})

/**
 * KI-068 的整链腿：§2.1「遭遇 → ≤2 拍内进战斗曲」今天走的是**真发射侧**（`CombatManager.checkEncounterMusic`），
 * 而耳朵侧是第一拍的那个时刻。两侧共用同一条时间线，所以这里能问一件 unit 问不到的事：
 * **音乐以为自己是第几拍，与玩法钟到那一刻实际是第几拍，是不是同一拍。**
 * 只有 `barEntry()` 的查询被接上、且落点被夹在 ≤2 拍之内，这句话才成立（它对齐不了 0.1s 那种猜法）。
 */
describe('入战落点走完真发射侧（KI-068 整链）', () => {
  /** 扫到"落点不是 4/4 小节头"的那一刻入战：`barEntry()` 只用来**挑时刻**，期望值全从事件与钟现读 */
  function encounterAtEntry(w: ReturnType<typeof world>, accept: (beatIndex: number) => boolean) {
    for (let i = 0; i < 400; i++) {
      if (accept(w.rhythm.barEntry().beatIndex)) {
        const t0 = w.ctx.currentTime
        const e = w.encounterAt()
        // **支无关的不变式**（放在这里，三条用例都过它）：事件说的等待，必须等于"从现在走到它报的那一拍"
        // 在当前网格下的秒数。`beatIndex` 来自事件，`beat`/`bpm` 来自此刻的钟——两边各自独立算，
        // 所以它同时钉住：等的是**她的**拍不是区域的拍（接管后 bpm 换成 108，秒数就差 1.286 倍），
        // 以及落点拍号与等待不是两个互不相干的数。
        const beatNow = w.rhythm.beat
        const should = (e.beatIndex - beatNow) * (60 / w.rhythm.bpm)
        expect(e.waitSec, `落点说等 ${e.waitSec.toFixed(4)}s，但从第 ${beatNow.toFixed(4)} 拍走到第 ${e.beatIndex} 拍`
          + `按当前 ${w.rhythm.bpm}BPM 该是 ${should.toFixed(4)}s`).toBeCloseTo(should, 4)
        let first = -1
        let voice = 'none'
        for (let k = 0; k < 240 && first < 0; k++) {
          const n0 = w.ctx.nodes.length
          const ts = w.run(1)
          if (ts.length) {
            first = ts[0]
            voice = w.drumVoice(w.ctx.nodes.slice(n0))
          }
        }
        return { e, t0, first, voice }
      }
      w.run(1)
    }
    throw new Error('扫过 400 tick 没遇到要的落点形状 = 这条判别式从没被执行，量不到东西')
  }

  it('落点：等待 ≤2 拍、第一拍真的等那么多、到点那刻钟自己也认为是同一拍，鼓点身份按钟的小节位置给', () => {
    const w = world()
    // 场上得先有人，`checkEncounterMusic()` 才会报"遭遇"。用不带私有拍速的杂兵：
    // 这一条量的是区域网格下的落点，她那份 3/4 是下面那条的事。
    // `alertness = 100` 是本仓库让杂兵真正照面的既有写法（`combat.test.ts` 同）——只 `enter('chase')`
    // 会被它自己的状态机在下一个 think 里降级成 search，那不是"没有遭遇"，是我没把场景搭起来。
    const foe = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -3 }, 'ki068')
    foe.alertness = 100
    foe.enter('chase')
    w.run(1) // 让第一次网格发布先被听见（KI-066 那条前提不变）
    expect(w.rhythm.clockOwner, '杂兵把全场网格接管了 = 前半句量的就不是区域基准').toBe('region')
    const { e, t0, first, voice } = encounterAtEntry(w, (i) => i % 4 !== 0)
    const beatSec = 60 / w.rhythm.bpm
    expect(e.beatIndex, `落点拍号 ${e.beatIndex} 在当前拍之前 = 让音乐倒着等`).toBeGreaterThan(w.rhythm.beat)
    expect(e.waitSec, `§2.1 的预算是 2 拍，这一条等了 ${e.waitSec}s（${(e.waitSec / beatSec).toFixed(2)} 拍）`)
      .toBeLessThanOrEqual(2 * beatSec + 1e-9)
    expect(first - t0, `第一拍实际在 t0+${(first - t0).toFixed(4)}s，事件说的是 ${e.waitSec.toFixed(4)}s = 落点没走到调度器`)
      .toBeCloseTo(e.waitSec, 4)

    // 玩法钟自己走到那一拍时，它是不是小节头？两侧独立算，等式才不是自证
    for (let i = 0; i < 240 && w.rhythm.info().beatIndex < e.beatIndex; i++) w.run(1)
    const landed = w.rhythm.info()
    expect(landed.beatIndex, '钟走不到事件报的那一拍 = 落点拍号与玩法网格对不上')
      .toBe(e.beatIndex)
    expect(landed.isBarStart, `音乐按第 ${e.beatIndex} 拍打，钟说这一拍的小节位置是 ${landed.beatInBar}`)
      .toBe(e.beatIndex % w.rhythm.beatsPerBar === 0)
    // 第 1、3 拍驼鼓（docs/audio.md §2.1 的重拍定义）：鼓点身份必须由落点拍号推出来
    const headPos = e.beatIndex % w.rhythm.beatsPerBar
    expect(voice, `落点在网格里的位置是第 ${headPos + 1} 拍，鼓点却响的是 "${voice}"`)
      .toBe(headPos === 0 || headPos === 2 ? 'kick' : 'snare')
  })

  it('另一半：预算内等得到小节头时，第一响就是驼鼓（等待必然超过一拍）', () => {
    // `barEntry()` 有两支。上一条从第一个 tick 就落在"夹到下一拍点"那一支（等待 <1 拍），
    // 小节头那一支在整链上没人走过 —— 而 §2.1 要的就是那一支：踩着小节头进曲。
    // 「等待 >1 拍」是这两支的分界：夹住那一支最多等到下一拍点，等得到小节头才可能超过一拍。
    const w = world()
    const foe = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -3 }, 'ki068b')
    foe.alertness = 100
    foe.enter('chase')
    w.run(1)
    const { e, first, voice } = encounterAtEntry(w, (i) => i % 4 === 0)
    const beatSec = 60 / w.rhythm.bpm
    expect(e.beatIndex % 4, '接受条件没生效，量的还是散拍那一支').toBe(0)
    expect(e.waitSec, `等了 ${e.waitSec}s ≤ 一拍（${beatSec}s）= 这一条又走回"夹到下一拍点"那一支了`)
      .toBeGreaterThan(beatSec)
    expect(first, '报了小节头却一拍都没排').toBeGreaterThan(0)
    expect(voice, `落点在 4/4 的第 1 拍，响的却是 "${voice}" = 入场重拍没踩在小节头上`).toBe('kick')
  })

  it('她接管之后才入战：落点踩的是她的 3/4 小节头——在区域 4/4 里那一拍是弱拍，也必须响驼鼓', () => {
    const w = world()
    const foe = w.ai.spawn('en_ostlara', { x: 0, y: -40, z: 0 }, 'ki068')
    foe.enter('chase')
    w.run(60) // 接管与网格发布走完，她的拍成为全场基准
    expect(w.rhythm.clockOwner, '她没接管网格，后半句就只是"网格恰好是 4/4"').toBe('boss')
    expect(w.rhythm.beatsPerBar, '她的拍不是 3/4，这条判别式（3 的倍数 ∉ 4 的倍数）失去意义').toBe(3)

    // 预算在她的网格里**逐相位**量，而不是只量被挑中的那一刻。这是 P5 探针逼出来的写法：
    // 原来的写法只断言"入战那一枪的 waitSec ≤2 拍"，而 3/4 的"等小节头"那一支按构造就 ≤2 拍
    // （小节头离任何相位不超过 3 拍，判别式又只收小节头），于是把 `maxWaitBeats` 从 2 改成 9
    // 这一条照样绿 = 判别式在替预算作弊。扫满几个小节、每个相位都问一次，量的才是预算本身。
    const beatSec = 60 / w.rhythm.bpm
    let sawHead = 0
    let sawClamp = 0
    for (let k = 0; k < 150; k++) {
      const s = w.rhythm.barEntry()
      expect(s.waitSec, `她的第 ${w.rhythm.info().beatIndex} 拍离落点 ${(s.waitSec / beatSec).toFixed(2)} 拍 > 2 拍预算`
        + '（§2.1「≤2 拍内进战斗曲」在这张网格里被破了）').toBeLessThanOrEqual(2 * beatSec + 1e-9)
      if (s.beatIndex % w.rhythm.beatsPerBar === 0) sawHead++
      else sawClamp++
      w.run(1)
    }
    expect(sawHead, '150 tick 没遇到过"等得到小节头"那一支').toBeGreaterThan(0)
    expect(sawClamp, '150 tick 没遇到过"夹到下一拍点"那一支').toBeGreaterThan(0)

    const { e, first, voice } = encounterAtEntry(w, (i) => i % 3 === 0 && i % 4 === 3)
    expect(e.beatIndex % 3, `落点 ${e.beatIndex} 不是她的一个小节头（3/4 的整除没踩中）`).toBe(0)
    expect(first, '报了落点却一拍都没排 = 事件没走到耳朵').toBeGreaterThan(0)
    expect(voice, `她的第 1 拍（区域 4/4 的第 4 拍）响的是 "${voice}" = 音乐还在按 4/4 数她的拍`)
      .toBe('kick')
  })
})

/**
 * KI-069 的整链腿：**她在战斗中途接管**（不是入战之前），鼓点有没有跟到她的头。
 * KI-068 那三条量的是"入战那一下"，而真实的一场 Boss 战里战斗层通常早就被杂兵开着了——
 * 她被唤醒时 `AISystem.syncClock` 当场换网格，遭遇事件的上升沿已经过去，于是那一格里
 * 只有拍距跟着她（KI-066），小节位置还留在音乐层自己从入战数下来的那条锚上。
 *
 * 时序在这里是全部：**接管、发布、重锚、排拍都发生在同一个 tick 内**，顺序是
 * `ai.update`（她接管）→ `rhythm.update`（发新网格，`AudioEngine` 同步转发给音乐层重锚）→ `ctx.advance` → `engine.update`（把重锚后的那一拍排出去）。
 * 所以"接管之后第一拍"必须从**接管那一 tick** 起算，晚一帧就把它读丢了；而落点的 `waitSec` 是发布那一刻的钟算的，
 * 音乐层用的 `now` 也是那一刻（同一次同步派发），等式两边才取得同一个时刻。
 */
describe('战斗中途换网格：鼓点跟到新的头，已排的拍一张不抹（KI-069 整链）', () => {
  it('她在交战之中接管 ⇒ 接管那一 tick 排出去的第一拍落在她的头上，接管之前排出去的拍一条没动', () => {
    const w = world()
    const mob = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -3 }, 'ki069')
    mob.alertness = 100
    mob.enter('chase')
    w.run(1)
    expect(w.rhythm.clockOwner, '杂兵把全场网格接管了 = 下面那句"她接管"没有对照').toBe('region')
    w.encounterAt() // 真发射侧把战斗层开着（KI-068 那条路）
    w.run(40) // 让战斗曲先演一段：这一段的拍是"接管之前"的，一条都不许被动过
    const snap = (n: FakeNode): string => `${n.kind}:${n.startedAt.join(',')}`
    const before = w.ctx.nodes.map(snap).join('|')
    expect(before, '四十 tick 里战斗曲一拍都没排 = 场景没搭起来').toContain('osc')

    let atPublish = -1
    let published: MusicGrid | null = null
    const offGrid = bus.on('audio.music.grid', (g) => { atPublish = w.ctx.currentTime; published = g })
    const boss = w.ai.spawn('en_ostlara', { x: 0, y: -40, z: 0 }, 'ki069b')
    boss.alertness = 100
    boss.enter('chase')

    let first = -1
    let voice = 'none'
    for (let k = 0; k < 200 && first < 0; k++) {
      const n0 = w.ctx.nodes.length
      const ts = w.run(1)
      if (!published || w.rhythm.clockOwner !== 'boss') continue // 接管与发布都在这一 tick 里
      if (ts.length) { first = ts[0]; voice = w.drumVoice(w.ctx.nodes.slice(n0)) }
    }
    offGrid()
    const g = published as MusicGrid | null
    expect(g, '她接管却没发出新网格 = 前半句的场景没搭起来').toBeTruthy()
    expect({ bpm: g!.bpm, beatsPerBar: g!.beatsPerBar }, '接管发出的不是她的网格')
      .toEqual({ bpm: w.rhythm.bpm, beatsPerBar: 3 })
    const e = g!.enter
    expect(e, '接管的网格发布没带落点（KI-069）= 战斗曲只换了拍距，小节位置留在旧网格上').toBeTruthy()
    const beatSec = 60 / g!.bpm
    expect(e!.waitSec, `落点等了 ${(e!.waitSec / beatSec).toFixed(2)} 拍 > 2 拍预算`).toBeLessThanOrEqual(2 * beatSec + 1e-9)
    expect(first, '接管之后一拍都没排 = 战斗曲死了').toBeGreaterThan(0)
    // 调度器的那一拍最早也只能排在**它看见的那一刻**之后 20ms（KI-068 的下限），而它看见的那一刻
    // 是 `ctx.advance(TICK_DT)` 之后（`rhythm.update` 里重锚用的却是 advance 之前的 `now`）。
    // 所以可达的最早落点是 `atPublish + TICK_DT + 0.02`：`waitSec` 比这一格还小时会被垫到这里
    // （实测差 12.6ms，在 §2.1 的 ±50ms 容差内）；`waitSec` 大于一格时等式两边仍是同一个数。
    const should = Math.max(e!.waitSec, TICK_DT + 0.02)
    expect(first - atPublish, `接管之后第一拍在 +${(first - atPublish).toFixed(4)}s，落点说的是 ${e!.waitSec.toFixed(4)}s`
      + '（含 lookahead 下限该是 ' + should.toFixed(4) + 's）= 小节位置没跟到她的头').toBeCloseTo(should, 4)
    expect(voice, `落点是她的第 ${e!.beatIndex} 拍（小节内第 ${(e!.beatIndex % 3) + 1} 拍），响的却是 "${voice}"`)
      .toBe(e!.beatIndex % 3 === 0 ? 'kick' : 'snare')

    for (let i = 0; i < 240 && w.rhythm.info().beatIndex < e!.beatIndex; i++) w.run(1)
    expect(w.rhythm.info().beatIndex, `钟没走到落点报的那一拍（停在 ${w.rhythm.info().beatIndex}）`).toBe(e!.beatIndex)
    expect(w.rhythm.info().isBarStart, `落点 ${e!.beatIndex} 的小节位置与钟自己的判断不一致`).toBe(e!.beatIndex % 3 === 0)
    // 不抹历史：接管之前那一段的每一个节点（含时刻）仍在序列开头，之后才是新拍的节点
    expect(w.ctx.nodes.map(snap).join('|').startsWith(before),
      '接管之前排出去的拍被改写或抹掉了（KI-066 那条纪律必须继续成立）').toBe(true)
  })
})
