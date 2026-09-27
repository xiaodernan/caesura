import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyEnv, BELL_CENTS, isSfxKey, playFM, playNoise, playSweep, SFX_KEYS, triggerSfx } from '@/audio/synth'
import { FakeAudioContext, FakeNode, FakeParam } from '../support/fakeAudio'

/**
 * `synth.ts` 那 416 行第一次真的被跑过（KI-065 / TD-006 第一腿）。
 *
 * 这里的断言全部是**结构**断言，不是听感断言——本机没有可被听的输出（与 KI-010 同因），
 * 所以这一套能证明的是"这条音色建了图、图接出去了、调度时刻合法、时长报得出来"，
 * 不能证明"它好听"。后者永远要人戴上耳机实机评审；谁把这份绿当成验收，谁就是在造假绿。
 *
 * 有一条专门冲着真实事故形状去：**每个建出来的节点都必须有出边**。少写一句 `.connect(out)`
 * 不报错、不红，在耳朵里是"这一类事件从来不响"——而"没有声音"和"这个事件设计成静音"分不出来。
 */

function rig(): { ctx: FakeAudioContext; out: FakeNode } {
  const ctx = new FakeAudioContext()
  return { ctx, out: ctx.createGain() }
}

/** 只取 `mark` 之后建出来的节点（`rig()` 自己建的那只 sink 不算被测对象） */
const created = (ctx: FakeAudioContext, mark: number): FakeNode[] => ctx.nodes.slice(mark)
const sourcesOf = (ns: FakeNode[]): FakeNode[] => ns.filter((n) => n.kind === 'osc' || n.kind === 'bufferSource')
/** 一次发声：返回 (这条声音建出来的节点, 报出的时长) */
function fire(key: string, t0 = 0.5, gain = 1): { ctx: FakeAudioContext; out: FakeNode; ns: FakeNode[]; dur: number } {
  const r = rig()
  const mark = r.ctx.nodes.length
  const dur = triggerSfx(r.ctx as unknown as AudioContext, r.out as unknown as AudioNode, key, t0, gain)
  return { ...r, ns: created(r.ctx, mark), dur }
}

function firstFreqOf(n: FakeNode): number {
  const p: FakeParam | undefined = n.params.frequency
  const set = p?.events.find((e) => e.kind === 'set')
  return set ? set.value : -1
}

afterEach(() => { vi.restoreAllMocks() })

describe('包络原语 applyEnv（docs/audio.md §3.1 钟包络通用形态）', () => {
  it('三段形状：起点 1e-4 → attack 末线性到 peak → decay 末指数回 1e-4', () => {
    const p = new FakeParam('gain')
    applyEnv(p as unknown as AudioParam, 2, 0.3, 0.01, 0.4)
    const kinds = p.events.map((e) => e.kind)
    expect(kinds).toEqual(['set', 'lin', 'exp'])
    expect(p.events[0].value).toBeCloseTo(1e-4, 10)
    expect(p.events[0].at).toBeCloseTo(2, 10)
    expect(p.events[1].value).toBeCloseTo(0.3, 10)
    expect(p.events[1].at, 'attack 末').toBeCloseTo(2.01, 6)
    expect(p.events[2].value, '回落到地板而不是 0').toBeCloseTo(1e-4, 10)
    expect(p.events[2].at, 'attack + decay 末').toBeCloseTo(2.41, 6)
  })

  it('peak=0 也不许把指数斜坡的目标写成 0（真 WebAudio 直接抛 = 这一声永远不会响）', () => {
    const p = new FakeParam('gain')
    applyEnv(p as unknown as AudioParam, 0, 0, 0.002, 0.1)
    const exp = p.events.filter((e) => e.kind === 'exp')
    expect(exp.length).toBe(1)
    expect(exp[0].value).toBeGreaterThan(0)
    // attack 那一头吃的是同一个地板：反向探针 S1（`Math.max(1e-4, peak)` → `Math.max(0, peak)`）第一次不红，
    // 就是因为只查了回落那一头——"峰值也要有地板"这半句当时没有证人。
    expect(p.events[1].value, 'attack 峰值被地板抬到 1e-4').toBeCloseTo(1e-4, 10)
  })
})

describe('VOICES 全表逐条真触发（KI-065：34 条音色第一次全部被执行）', () => {
  it('合成表就是 34 条这张名册的形状（新增音色自动进上面每一条判据）', () => {
    expect(SFX_KEYS.length, '名单短了 = 有音色被删掉而文档没跟上').toBeGreaterThanOrEqual(34)
    expect(new Set(SFX_KEYS).size).toBe(SFX_KEYS.length)
  })

  for (const key of SFX_KEYS) {
    it(`${key}：建得出图、接得出去、调度合法、时长报得出来`, () => {
      const { ctx, out, ns, dur } = fire(key)
      const srcs = sourcesOf(ns)

      expect(dur, '时长 > 0（返回 0 = 引擎侧当成未知音色丢掉）').toBeGreaterThan(0)
      expect(ns.length, '一个节点都没建 = 这条音色是空的').toBeGreaterThan(0)
      expect(srcs.length, '没有发声源 = 这条音色不会响').toBeGreaterThan(0)
      expect(ctx.edgesTo(out).length, '没有任何东西接到输出总线 = 完全静音').toBeGreaterThan(0)

      for (const n of ns) {
        expect(ctx.edges.some((e) => e.from === n), `${n.id} 建出来了却没接出去（少一句 connect ⇒ 静音）`).toBe(true)
      }
      for (const s of srcs) {
        expect(s.startedAt.length, `${s.id} 建了却没 start`).toBeGreaterThan(0)
        expect(s.stoppedAt.length, `${s.id} 没有 stop = 发声体永远留在图里`).toBe(s.startedAt.length)
        s.startedAt.forEach((at, i) => {
          expect(at, `${s.id} 往过去调度`).toBeGreaterThanOrEqual(0.5 - 1e-9)
          expect(s.stoppedAt[i], `${s.id} 的 stop 早于 start`).toBeGreaterThanOrEqual(at)
        })
      }
      for (const n of ns) {
        for (const [name, p] of Object.entries(n.params)) {
          for (const e of p.events) {
            expect(e.at, `${n.id}.${name} 排到了过去`).toBeGreaterThanOrEqual(0.5 - 1e-9)
            if (e.kind === 'exp') expect(e.value, `${n.id}.${name} 指数斜坡目标是 0，真机抛错`).toBeGreaterThan(0)
          }
        }
      }
      const loudest = ns.reduce((a, n) => Math.max(a, n.params.gain ? n.params.gain.peakValue() : 0), 0)
      expect(loudest, '整条音色的包络峰值都是 0 = 静音').toBeGreaterThan(0)

      // 报出来的时长不是装饰：`AudioEngine.play` 用它归还声部配额（`setTimeout(..., dur*1000)`），
      // 报短了 = 声音还在响、配额却已经给下一声腾了位（24 声那条红线的账本对不上）。
      const lastStop = Math.max(...srcs.flatMap((s) => s.stoppedAt))
      expect(dur, `${key} 报出的时长盖不住自己排的最后一次 stop（配额会提前归还）`)
        .toBeGreaterThanOrEqual(lastStop - 0.5 - 1e-9)
    })
  }

  it('节点即用即弃：挂了 onended 的源兑现时，把自己那条链上的处理器断开（synth.ts 文件头的承诺）', () => {
    for (const key of ['hit_flesh', 'swing_1', 'gnash', 'parry_bell', 'death_shatter', 'wail'] as const) {
      const { ns } = fire(key)
      // FM 的调制振器不挂 onended（它跟着载波一起死），所以只要求"挂了的那些"真的把链清了
      const ends = sourcesOf(ns).filter((s) => s.onended !== null)
      expect(ends.length, `${key} 没有任何源挂了 onended`).toBeGreaterThan(0)
      for (const s of ends) s.fireEnded()
      const shaping = ns.filter((n) => n.kind === 'gain' || n.kind === 'biquad')
      const leaked = shaping.filter((n) => n.disconnected === 0).map((n) => n.id)
      expect(leaked, `${key} 有处理器从未被任何 onended 清理`).toEqual([])
    }
  })

  it('钟是钟：泛音比里必须有非整数比（docs §3.1「拒绝弦乐整数比 = 一听即钟」）', () => {
    const { ns } = fire('bell_toll', 0)
    const base = 174.6
    const ratios = ns.filter((n) => n.kind === 'osc').map(firstFreqOf).filter((f) => f > 0).map((f) => f / base)
    expect(ratios.length, '一个分音都没建').toBeGreaterThanOrEqual(6)
    // 每一敲带 ±`BELL_CENTS` 随机失谐（生产侧同一个常数），所以容差**从它推**而不是手填：
    // 旧写法对 3.04 用 0.02，而它的抖动上界是 3.04×8/1200 = 0.02027 ⇒ 这条判据每跑有一次自己红
    // （KI-071 的探针 P2 撞出来的既有间歇红；40 趟实测 1 次，见 §5.9.14）。
    const near = (r: number, x: number): boolean => Math.abs(r - x) <= x * (BELL_CENTS / 1200) + 1e-9
    expect(ratios.some((r) => near(r, 2.4)), `2.4 分音不见了：${ratios.map((r) => r.toFixed(3))}`).toBe(true)
    expect(ratios.some((r) => near(r, 3.04)), '3.04 分音不见了').toBe(true)
    expect(ratios.some((r) => near(r, 5.73)), '5.73 分音不见了').toBe(true)
  })

  it('boss_roar 走 waveshaper 失真，曲线是真算出来的（512 点、两端 ±1、过零）', () => {
    const { ns } = fire('boss_roar', 0)
    const shaper = ns.find((n) => n.kind === 'shaper')
    expect(shaper, '全场唯一一条用失真的音色不见了').toBeTruthy()
    const curve = shaper!.curve
    expect(curve, '没设 curve = waveshaper 是直通，等于没有失真').toBeTruthy()
    expect(curve!.length).toBe(512)
    expect(curve![0]).toBeCloseTo(-1, 3)
    expect(curve![511]).toBeCloseTo(1, 3)
    expect(Math.abs(curve![256]), '过零点两侧应当符号相反').toBeLessThan(0.02)
    expect(curve![255], '折叠曲线要单调').toBeLessThan(curve![256])
  })

  it('每次都不完全一样：钟的失谐是随机的（docs §3.1「禁止两敲完全相同」）', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const { ns } = fire('bell_clang', 0)
      seen.add(ns.filter((n) => n.kind === 'osc').map((n) => firstFreqOf(n).toFixed(6)).join(','))
    }
    expect(seen.size, '六敲生成出完全一样的频率 = 随机化没生效').toBeGreaterThan(1)
  })

  it('钟的衰减序 = dur/(i+1)^1.3（synth.ts 文件头那句「高泛音先死 = 金属感」的原文形状）', () => {
    // 反向探针 S6（1.3 → 0.3）第一次不红，因为当时只断言了"单调递减"——把指数压平到 0.3 照样递减。
    // 这一条钉的是**递减多少**，不是"有没有递减"。
    const { ns } = fire('bell_toll', 0) // dur 4.2、attack 0.002
    const envs = ns.filter((n) => n.kind === 'gain').slice(0, 6).map((g) => g.params.gain.lastAt())
    expect(envs.length, '六条分音的包络不全').toBe(6)
    for (let i = 0; i < 6; i++) {
      expect(envs[i] - 0.002, `第 ${i + 1} 条分音的衰减时长`).toBeCloseTo(4.2 / Math.pow(i + 1, 1.3), 4)
    }
  })

  it('FM：调制深度（f0×index）接在载波的 frequency 参数上，接到 detune 上就只是跑音不是金属味', () => {
    const r = rig()
    const mark = r.ctx.nodes.length
    playFM(r.ctx as unknown as AudioContext, r.out as unknown as AudioNode, 0, { f0: 200, index: 3, dur: 0.2, peak: 0.2 })
    const ns = created(r.ctx, mark)
    const oscs = ns.filter((n) => n.kind === 'osc')
    expect(oscs.length, '载波 + 调制器两支振荡').toBe(2)
    const depth = ns.find((n) => n.kind === 'gain' && Math.abs(n.params.gain.value - 600) < 1e-9)
    expect(depth, '调制深度增益（200×3=600）不见了').toBeTruthy()
    expect(r.ctx.edges.some((e) => e.from === oscs[1] && e.to === depth), '调制器没喂进深度增益').toBe(true)
    expect(r.ctx.edges.some((e) => e.from === depth && e.to === oscs[0].frequency), '深度没接到载波频率上').toBe(true)
    expect(r.ctx.edges.some((e) => e.from === depth && e.to === oscs[0].detune), '深度被接到了 detune 上（那是跑音不是 FM）').toBe(false)
  })

  it('噪声底片一个 ctx 只建一次（WeakMap 缓存），换一只 ctx 才另建', () => {
    const a = rig()
    const mark = a.ctx.nodes.length
    playNoise(a.ctx as unknown as AudioContext, a.out as unknown as AudioNode, 0, { f0: 900, decay: 0.1, peak: 0.1 })
    playNoise(a.ctx as unknown as AudioContext, a.out as unknown as AudioNode, 0.2, { f0: 900, decay: 0.1, peak: 0.1 })
    expect(created(a.ctx, mark).filter((n) => n.kind === 'bufferSource').length).toBe(2)
    expect(a.ctx.buffersMade, '每次发声都重拷一段 2 秒噪声 = 每次挨打卡一下').toBe(1)
    const b = rig()
    playNoise(b.ctx as unknown as AudioContext, b.out as unknown as AudioNode, 0, { f0: 900, decay: 0.1, peak: 0.1 })
    expect(b.ctx.buffersMade, '换一只 ctx 还共用上一只的底片 = 缓存串了').toBe(1)
  })

  it('非法频率被抬回可听域：滤波器 30Hz、振荡器 1Hz（表里写错一个数不该让整声消失）', () => {
    // 今天没有任何一条音色走到这里（最窄的是 38Hz）。这一条钉的是**那道钳本身**：
    // 音色表是手改的，改出一个 5Hz 的低通时，可观察后果必须是"听得出闷"而不是"这一声永不响"。
    const r = rig()
    const mark = r.ctx.nodes.length
    playNoise(r.ctx as unknown as AudioContext, r.out as unknown as AudioNode, 0, { f0: 5, f1: 3, decay: 0.1, peak: 0.1 })
    const f = created(r.ctx, mark).find((n) => n.kind === 'biquad') as FakeNode
    const ev = f.params.frequency.events
    expect(ev[0].value, '起频夹到 30').toBe(30)
    expect(ev[1].value, '扫频目标也要夹（exp 斜坡目标为 0 在真机抛错）').toBe(30)
    const r2 = rig()
    const m2 = r2.ctx.nodes.length
    playSweep(r2.ctx as unknown as AudioContext, r2.out as unknown as AudioNode, 0, { f0: 0, f1: -5, dur: 0.1, peak: 0.1 })
    const o = created(r2.ctx, m2).find((n) => n.kind === 'osc') as FakeNode
    expect(o.params.frequency.events.map((e) => e.value), '振荡器两端都要 ≥1Hz').toEqual([1, 1])
  })

  it('waveshaper 的曲线是折叠而不是恒等（中段就已接近饱和）', () => {
    const { ns } = fire('boss_roar', 0)
    const curve = ns.find((n) => n.kind === 'shaper')!.curve as Float32Array
    // 恒等映射会在 x=-0.5 处给出 -0.5；k=6 的 tanh 折叠在那里已经几乎顶到 ±1
    expect(curve[128], 'x≈-0.5 处折叠曲线应已接近 -1').toBeLessThan(-0.9)
    expect(curve[383], 'x≈+0.5 处对称').toBeGreaterThan(0.9)
  })
})

/**
 * 一次性链的回收普查（KI-071 / TD-006 第二腿②）。
 *
 * `synth.ts` 顶上那句「所有节点即用即弃（onended 时断开）」在 KI-065 之前从没人量过，今天逐条量一遍：
 * 把一条音色里**所有源**的一生走完，此刻还连在输出总线上的连线必须是 0 根。
 * 这条判据抓的不是"响不响"（KI-065 那条"每个节点都要有出边"已经钉过那一侧），抓的是**另一边**：
 * 一只不会自己消失的非 source 节点挂在总线上——它不静音、不报错，只是每响一次多留一只，
 * 长 Boss 战里攒成一条越来越脏的输出链（登记原话：`boss_roar` 每响一次留一只 `WaveShaper`）。
 */
describe('一次性链必须回收：走完一生之后不许还有节点连在输出上（KI-071）', () => {
  for (const key of SFX_KEYS) {
    it(`${key}：所有源走完之后，连在输出总线上的连线归零`, () => {
      const { ctx, out } = fire(key)
      expect(ctx.edgesTo(out).length, '夹具前提：这一声确实接出去了').toBeGreaterThan(0)
      const fired = ctx.endAll()
      expect(fired, '一个源都没走完 = 这条判据在空转').toBeGreaterThan(0)
      expect(ctx.live(out), `${fired} 个源都走完之后，还有 ${ctx.live(out)} 根线连在输出上（没人回收它）`)
        .toBe(0)
    })
  }

  it('同一个 sink 上连 20 次：走完之后残留不随次数增长（这就是"每响一次留一只"的形状）', () => {
    const { ctx, out } = rig()
    for (let i = 0; i < 20; i++) triggerSfx(ctx as unknown as AudioContext, out as unknown as AudioNode, 'boss_roar', 0.5 + i * 3, 1)
    expect(ctx.live(out), '夹具前提：20 声都挂在输出上').toBeGreaterThan(0)
    ctx.endAll()
    expect(ctx.live(out), `响 20 次攒下 ${ctx.live(out)} 根没收的线 = 长战斗里的输出链只会越来越脏`).toBe(0)
  })
})

describe('triggerSfx 的三道钳制', () => {
  it('未知 key：返回 0 而且一个节点都不建（引擎据此发一条 warn，而不是硬响）', () => {
    const r = rig()
    const mark = r.ctx.nodes.length
    expect(triggerSfx(r.ctx as unknown as AudioContext, r.out as unknown as AudioNode, 'nope_not_a_voice', 0, 1)).toBe(0)
    expect(created(r.ctx, mark).length).toBe(0)
    expect(isSfxKey('nope_not_a_voice')).toBe(false)
    expect(isSfxKey(SFX_KEYS[0])).toBe(true)
  })

  it('when 落在过去：一律抬到 currentTime 之后，绝不往过去调度', () => {
    const r = rig()
    r.ctx.advance(5)
    const mark = r.ctx.nodes.length
    triggerSfx(r.ctx as unknown as AudioContext, r.out as unknown as AudioNode, 'parry_bell', 0.1, 1)
    for (const n of created(r.ctx, mark)) {
      for (const at of [...n.startedAt, ...n.stoppedAt]) expect(at).toBeGreaterThanOrEqual(5)
      for (const p of Object.values(n.params)) for (const e of p.events) expect(e.at).toBeGreaterThanOrEqual(5)
    }
  })

  it('gain 钳到 2：传 4 与传 2 建出来的图逐参数相同（一次误传不该把混音炸掉）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const a = fire('death_shatter', 1, 4)
    const b = fire('death_shatter', 1, 2)
    const peaks = (x: { ctx: FakeAudioContext }) =>
      x.ctx.nodes.flatMap((n) => Object.values(n.params).map((p) => p.peakValue()))
    expect(b.dur, '时长与 gain 无关（钳到位的话）').toBe(a.dur)
    expect(peaks(b)).toEqual(peaks(a))
    expect(peaks(a).some((v) => v > 0), '两条都是全 0 = 上面那条相等是空的相等').toBe(true)
  })
})
