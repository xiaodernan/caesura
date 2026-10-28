/**
 * `core/PerfSampler` 的账（§5.7「不要猜性能」那半句的量具，KI-335）。
 *
 * 这块面板最容易的三种假绿，本文件按顺序各有一条腿对着：
 * 1. **分位数是算出来的还是编出来的**——插值法在 n 小的时候会报一个根本没发生过的数当"P99"，
 *    而这一格要的正是"最坏那 1% 到底多坏"，所以这里钉的是**最近秩**（`ceil(p·n)` 那个样本自己）；
 * 2. **窗口是不是真在滚**——只断言"能报 300"证不出淘汰：喂 350 个递增样本，P50 必须是后 300 个
 *    的中位数（200），落在 51..350 之外的那一截必须已经不在账上；
 * 3. **"默认全关"是不是只有注释**——关着时 `performance.now` 的**调用次数**必须为 0，
 *    这条只能靠替身钟数次数，不能靠"读数看起来是 0"（读数为 0 也可能是采了一个 0）。
 *
 * 两道开关（`main.ts` 装没装 ＋ `armed`）里的第一道不住在本文件：那条接线腿在
 * `tests/unit/game-loop.test.ts`（环把帧交给装进来的采样器）与 `tests/flow/debug-panels.test.ts`
 * （F5 的 `onToggle` 开合的就是 `armed`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  BUDGET_CPU_MS, BUDGET_GPU_MS, FRAME_WINDOW, PerfSampler, SPAN_EMA_ALPHA,
} from '@/core/PerfSampler'

const DOC = fileURLToPath(new URL('../../docs/technical-architecture.md', import.meta.url))
const SAMPLER_SRC = fileURLToPath(new URL('../../src/core/PerfSampler.ts', import.meta.url))

/** 一条帧样本：只给要紧的那一格，其余为 0（多数腿只看一格，不把无关的数也带进来） */
const frame = (
  deltaMs: number,
  over: Partial<{ logicMs: number; renderMs: number; ticks: number; truncated: boolean }> = {},
) => ({ deltaMs, logicMs: 0, renderMs: 0, ticks: 1, truncated: false, ...over })

/**
 * 把 `performance.now` 换成"每读一次正好走 `step` 毫秒"的假钟，并把**读数次数**的取数口交给 body，
 * 用完原样归还（`configurable: true` ⇒ 同一个属性可以再定义回去，与 `game-loop.test.ts` 的
 * `freezeClock` 同一手法）。
 *
 * 为什么要假钟而不是真钟：这一格的三条判据里有两条读的是"叫了几次"、一条读的是"两次读数之差"，
 * 真钟的差值在 CI 上是 0.0x 也可能被掐到 1ms——**那不是一个可断言的数**。
 */
function withClock<T>(step: number, body: (calls: () => number) => T): T {
  const real = performance.now.bind(performance)
  let now = 0
  let n = 0
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => { n++; const v = now; now += step; return v },
  })
  try { return body(() => n) } finally {
    Object.defineProperty(performance, 'now', { configurable: true, value: real })
  }
}

describe('PerfSampler · 最近秩分位（钉算法，不钉"平均分位"）', () => {
  it('1..100 递增样本：P50/P90/P99/max ＝ 50/90/99/100，全是**真发生过的那一帧**', () => {
    const s = new PerfSampler()
    s.open()
    for (let i = 1; i <= 100; i++) s.frame(frame(i))
    expect(s.snapshot().frameMs).toEqual({ p50: 50, p90: 90, p99: 99, max: 100 })
  })

  it('窗口只有 10 帧时 P99 不许插值出一个没发生过的数：它等于 max（第 10 个样本自己）', () => {
    const s = new PerfSampler()
    s.open()
    for (let i = 1; i <= 10; i++) s.frame(frame(i))
    const r = s.snapshot().frameMs
    // ceil(0.99×10)=10 ⇒ 第 10 个；线性插值会报 9.91，而"9.91ms"这一帧根本没存在过
    expect(r.p99, '最近秩在 n 小时落在样本自己上').toBe(10)
    expect(r.p90).toBe(9)
    expect(r.p50, 'ceil(0.5×10)=5 ⇒ 第 5 个').toBe(5)
  })

  it('一个样本都没有时不抛、也不编：全是 0，而 samples 那格如实报 0', () => {
    const r = new PerfSampler().snapshot()
    expect(r.samples).toBe(0)
    expect(r.frameMs).toEqual({ p50: 0, p90: 0, p99: 0, max: 0 })
    expect(r.fps, '没有帧就没有 fps：不许报 Infinity，也不许留着上一个现场的数').toBe(0)
    expect(r.ticksPerFrame).toEqual({ avg: 0, max: 0 })
    expect(r.spans).toEqual([])
  })
})

describe('PerfSampler · 滚动窗口', () => {
  it('窗口 ＝ 300 帧，超过就淘汰最老的：喂 1..350 递增 ⇒ P50 是后 300 个的中位数 200', () => {
    const s = new PerfSampler()
    s.open()
    for (let i = 1; i <= 350; i++) s.frame(frame(i))
    const r = s.snapshot()
    expect(r.samples, '窗口不涨').toBe(FRAME_WINDOW)
    expect(r.frames, '但"一共采了几帧"是另一笔账：它不清零').toBe(350)
    expect(r.frameMs.max, '最老那 50 个已被挤出去，最大值是最新的一记').toBe(350)
    expect(r.frameMs.p50, '300 个里 ceil(0.5×300)=150 ⇒ 51..350 的第 150 个 ＝ 200').toBe(200)
  })

  it('四条账各自成环：ticks 与 delta 同一条帧样本、同一次淘汰（不会一个满了一个还留着旧的）', () => {
    const s = new PerfSampler()
    s.open()
    for (let i = 0; i < FRAME_WINDOW + 10; i++) s.frame(frame(10, { ticks: 2 }))
    const r = s.snapshot()
    expect(r.samples).toBe(FRAME_WINDOW)
    expect(r.ticksPerFrame.avg, '窗口里每帧都是 2 拍 ⇒ 平均 2').toBeCloseTo(2, 9)
    expect(r.ticksPerFrame.max).toBe(2)
  })
})

describe('PerfSampler · 默认全关（两道开关里的第二道）', () => {
  it('关着时 `frame()` 一个数都不记：采 50 帧之后快照还是空的', () => {
    const s = new PerfSampler()
    expect(s.armed, '新建即关着：默认值就是这块面板的存在理由').toBe(false)
    for (let i = 0; i < 50; i++) s.frame(frame(33))
    const r = s.snapshot()
    expect(r.samples).toBe(0)
    expect(r.frames).toBe(0)
  })

  it('关着时 `frame()`/`span()` 叫零次钟（"读数为 0"证不了没采，只能数次数）', () => {
    withClock(5, (calls) => {
      const s = new PerfSampler()
      s.frame(frame(16.7))
      const out = s.span('logic.anything', () => 7)
      expect(out, '关着时 span 就是 `fn()` 本身：返回值原样交出去').toBe(7)
      s.snapshot()
      expect(calls(), '一次 `performance.now()` 都不许叫').toBe(0)
    })
  })

  it('关着时 `span()` 只把回调叫一次（不是"包两层各叫一遍"）', () => {
    const s = new PerfSampler()
    let n = 0
    s.span('logic.once', () => { n++; return 'x' })
    expect(n).toBe(1)
  })

  it('开着时 `span()` 叫两下钟（一进一出），fn 仍只叫一次，读数＝两次之差', () => {
    withClock(10, (calls) => {
      const s = new PerfSampler()
      s.open()
      let n = 0
      const v = s.span('logic.ai', () => { n++; return 'y' })
      expect(v).toBe('y')
      expect(n).toBe(1)
      expect(calls(), '一次开始一次结束').toBe(2)
      // 那"两次之差"落在 `max` 上（原始一记，10ms）；`avg` 是 EMA，第一记只走 1/60 步 ⇒ 10/60。
      // 两个数各钉各的：把 avg 也写成 10 就是断言"EMA 不存在"，而下面那条尖峰腿要的正是 EMA 存在。
      const sp = s.snapshot().spans[0]
      expect(sp.maxMs, '假钟步长 10ms ⇒ 这一记原始读数就是 10').toBe(10)
      expect(sp.avgMs, 'EMA 第一步 ⇒ 10/60').toBeCloseTo(10 * SPAN_EMA_ALPHA, 9)
    })
  })

  it('open()/close() 都清窗口：旧样本属于上一现场，混着报会让 P99 说得不是这一次的事', () => {
    const s = new PerfSampler()
    s.open()
    for (let i = 0; i < 20; i++) s.frame(frame(100))
    expect(s.snapshot().samples).toBe(20)
    s.open() // 再开一次（重复按键）
    expect(s.snapshot().samples, '开＝清').toBe(0)
    for (let i = 0; i < 5; i++) s.frame(frame(1))
    s.span('logic.a', () => {})
    s.close()
    const after = s.snapshot()
    expect(s.armed).toBe(false)
    expect(after.samples, '关也清：下一次开不许带着这次的账').toBe(0)
    expect(after.frames).toBe(0)
    expect(after.spans, '分段也一起清（不然关掉再开读到的还是上一次的 EMA）').toEqual([])
    expect(after.truncated).toBe(0)
  })
})

describe('PerfSampler · 分段（EMA + 最坏一记 + 调用数）', () => {
  it('没走过任何一段时清单是空的，而不是"一段都没有的 0ms"', () => {
    const s = new PerfSampler()
    s.open()
    s.frame(frame(16))
    expect(s.snapshot().spans).toEqual([])
  })

  it('EMA 是 1/60 一步：`SPAN_EMA_ALPHA` 与它自己那句"60 帧 ≈ 1 秒"是同一个数', () => {
    expect(SPAN_EMA_ALPHA).toBeCloseTo(1 / 60, 12)
    expect(1 / SPAN_EMA_ALPHA, '一格的平滑宽度 ＝ 60 帧').toBe(60)
  })

  it('名字是主人：同名两段并成一格，不同名各记各的', () => {
    const s = new PerfSampler()
    s.open()
    s.span('logic.ai', () => {})
    s.span('logic.ai', () => {})
    s.span('logic.combat', () => {})
    const r = s.snapshot()
    expect(r.spans.map((x) => x.name).sort()).toEqual(['logic.ai', 'logic.combat'])
    expect(r.spans.length, '同名并不成一格就是第二个主人').toBe(2)
  })

  it('清单按耗时从大到小排（贵的排前面是面板的读法，不是数组碰巧的顺序）', () => {
    const s = new PerfSampler()
    s.open()
    withClock(1, () => s.span('cheap', () => {}))
    withClock(20, () => s.span('expensive', () => {}))
    const names = s.snapshot().spans.map((x) => x.name)
    expect(names[0], '贵的那条在第一行').toBe('expensive')
    expect(names).toEqual(['expensive', 'cheap'])
  })

  it('callsPerWindow 数的是"这一段被叫了几次"：每帧一次的段大约是隔帧一段的两倍', () => {
    const s = new PerfSampler()
    s.open()
    for (let i = 0; i < 60; i++) {
      s.span('render.everyFrame', () => {})
      if (i % 2 === 0) s.span('logic.everyOtherTick', () => {})
    }
    const m = new Map(s.snapshot().spans.map((x) => [x.name, x.callsPerWindow]))
    const a = m.get('render.everyFrame')!
    const b = m.get('logic.everyOtherTick')!
    expect(a, '每帧一次：60 帧后 EMA 已接近 1').toBeGreaterThan(0.6)
    expect(b, '隔帧一次：大约是它的一半').toBeLessThan(a)
    expect(a / b, '两段的调用数比例 ≈ 2').toBeGreaterThan(1.4)
  })

  it('尖峰不被 EMA 抹平：`max` 记的是开窗以来最坏那一记（尖峰才是这一格要找的东西）', () => {
    const s = new PerfSampler()
    s.open()
    withClock(0, () => s.span('a', () => {}))
    withClock(25, () => s.span('a', () => {}))
    const sp = s.snapshot().spans.find((x) => x.name === 'a')!
    expect(sp.maxMs, '最坏一记原样留着：只剩 EMA 就等于把这次尖峰抹掉了').toBe(25)
    expect(sp.avgMs, 'EMA 那边只吃掉 1/60 ⇒ 25/60').toBeCloseTo(25 / 60, 6)
  })
})

describe('PerfSampler · 帧账（ticks / truncated / fps）', () => {
  it('truncated 只数"真的丢了整拍"的那几帧，而 ticks 数的是每帧补了几拍', () => {
    const s = new PerfSampler()
    s.open()
    s.frame(frame(50, { ticks: 3 }))
    s.frame(frame(50, { ticks: 0, truncated: true }))
    const r = s.snapshot()
    expect(r.truncated).toBe(1)
    expect(r.ticksPerFrame.max).toBe(3)
    expect(r.ticksPerFrame.avg).toBeCloseTo(1.5, 9)
    expect(r.fps).toBeCloseTo(1000 / 50, 9)
  })

  it('logic 与 render 各自一条分位线（§5.3 的两格预算要分别判，不能合成一条）', () => {
    const s = new PerfSampler()
    s.open()
    for (let i = 1; i <= 10; i++) s.frame(frame(16.7, { logicMs: i, renderMs: i * 2 }))
    const r = s.snapshot()
    expect(r.logicMs).toEqual({ p50: 5, p99: 10 })
    expect(r.renderMs).toEqual({ p50: 10, p99: 20 })
  })
})

describe('PerfSampler · 常数与文档是同一个数（§5.3 / §5.7）', () => {
  it('§5.3 标题里那句「GPU ≤12ms，CPU ≤6ms」与导出的两个常数一致', () => {
    const line = readFileSync(DOC, 'utf8').split('\n').find((l) => l.startsWith('### 5.3 '))
    expect(line, '§5.3 那一行没了：这条腿的对照物消失').toBeTruthy()
    expect(/GPU\s*≤\s*(\d+(?:\.\d+)?)ms/.exec(line!)?.[1]).toBe(String(BUDGET_GPU_MS))
    expect(/CPU\s*≤\s*(\d+(?:\.\d+)?)ms/.exec(line!)?.[1]).toBe(String(BUDGET_CPU_MS))
  })

  it('§5.7 那句「P50/P99」在文档里，而 300 帧窗口确实 ≈5 秒@60fps', () => {
    // 读的是**整节**而不是 `### 5.7` 那一行：P50/P99 那句话在 §5.7 的正文里（标题只有节名），
    // 只读标题那一行会把一条**在的**承诺读成**不在**——那是量具的错，不是文档的错。
    const doc = readFileSync(DOC, 'utf8').split('\n')
    const from = doc.findIndex((l) => l.startsWith('### 5.7 '))
    expect(from, '§5.7 那一节没了').toBeGreaterThan(-1)
    const rest = doc.slice(from + 1)
    const to = rest.findIndex((l) => /^#{2,3} /.test(l))
    const s57 = doc[from] + '\n' + rest.slice(0, to === -1 ? rest.length : to).join('\n')
    expect(s57).toContain('P50')
    expect(s57).toContain('P99')
    expect(s57, 'F 键那一格今天有了具体的键名：文档不许再停在"F 键"这句泛指').toContain('F5')
    expect(FRAME_WINDOW, 'P99 至少要 100 个样本才谈得上分位：300 是它的三倍余量').toBe(300)
    expect(FRAME_WINDOW / 60, '300 帧 @60fps ＝ 5 秒').toBeCloseTo(5, 6)
  })

  it('它是逻辑层的：源码零 import（不认识 three、不认识 DOM、不生成一个字）', () => {
    const code = readFileSync(SAMPLER_SRC, 'utf8').split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
      .join('\n')
    expect(code, '采样器一旦 import 了东西就不再是"纯读数"那一层').not.toMatch(/^\s*import\s/m)
    expect(code).not.toMatch(/document|window\.|HTMLElement|three/)
  })
})
