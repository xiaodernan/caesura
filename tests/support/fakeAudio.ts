/**
 * 假 WebAudio（TD-006 / KI-065）——给 `src/audio/` 的第一套可断言替身。
 *
 * 为什么要有它：`synth.ts` 的每个原语都以 `AudioContext` 为参数，node 里没有 `window.AudioContext`，
 * 于是那 596 行今天没有任何测试执行过（`npm run coverage` 的按包读数：audio 15.93%）。
 *
 * 它**只保证一件事**：图形状与参数调度是可断言的。它**不能**保证"这个音色好听"——本机没有可被听的
 * 输出（与 KI-010 同因），那一格永远不属于 headless 能承诺的事，谁把这个替身当验收谁就是在造假绿。
 *
 * 记录口径（断言都从这里读）：
 *  - `nodes`：本次创建过的所有节点（含类型与参数事件），**顺序 = 创建顺序**；
 *  - `edges`：所有 `connect` 的目标，既能查"谁接到了总线"也能查"接到了 AudioParam"（FM 那条调制链）；
 *  - `startedAt/stoppedAt`：源节点的调度时刻，用来钉"stop 一定晚于 start""不许往过去调度"。
 */

export type NodeKind =
  | 'gain' | 'osc' | 'bufferSource' | 'constantSource' | 'biquad' | 'compressor' | 'panner' | 'shaper' | 'destination'

export interface ParamEvent {
  kind: 'set' | 'lin' | 'exp' | 'cancel' | 'target'
  value: number
  at: number
  /**
   * `setTargetAtTime` 的时间常数（秒）——只有 `kind === 'target'` 有这一格。
   * KI-092① 起的读者：§8.2 休止那一行写的是"250ms 入 180ms 出"（**到位时长**），
   * 而音频参数收的是时间常数；不记下它，本文件就只能断言"压到了 −12dB"，
   * 断言不了"它是 250ms 压下去的而不是一步跳下去的"。
   */
  tc?: number
}

export class FakeParam {
  value = 0
  events: ParamEvent[] = []
  /** `cancelScheduledValues` 被调了几次（判"斜坡会不会叠上来"就靠这个数，自动化列表本身要保持干净） */
  cancelCount = 0
  constructor(readonly name: string) {}
  private push(kind: ParamEvent['kind'], v: number, at: number, tc?: number): this {
    if (kind === 'cancel') {
      // 真语义：t 时刻及之后排的一切作废（不含 cancel 自己，它不是自动化）
      this.cancelCount++
      this.events = this.events.filter((e) => e.at < at)
      return this
    }
    this.events.push({ kind, value: v, at })
    if (kind === 'set') this.value = v
    return this
  }
  setValueAtTime(v: number, at: number): this { return this.push('set', v, at) }
  linearRampToValueAtTime(v: number, at: number): this { return this.push('lin', v, at) }
  exponentialRampToValueAtTime(v: number, at: number): this { return this.push('exp', v, at) }
  setTargetAtTime(v: number, at: number, tc: number): this { void tc; return this.push('target', v, at) }
  cancelScheduledValues(at: number): this { return this.push('cancel', 0, at) }
  /** 包络里最高的一次自动化值（`peak` 与默认 `setValueAtTime` 的地板 1e-4 都算进去） */
  peakValue(): number {
    return this.events.reduce((a, e) => Math.max(a, e.value), 0)
  }
  /** 最后一条自动化的时刻（用于"斜坡时长"断言） */
  lastAt(): number {
    return this.events.length ? this.events[this.events.length - 1].at : -1
  }
}

export class FakeNode {
  readonly id: string
  type = ''
  curve: Float32Array | null = null
  buffer: { length: number; sampleRate: number; numberOfChannels: number } | null = null
  loop = false
  onended: (() => void) | null = null
  startedAt: number[] = []
  stoppedAt: number[] = []
  params: Record<string, FakeParam> = {}
  disconnected = 0
  constructor(readonly kind: NodeKind, readonly ctx: FakeAudioContext, index: number) {
    this.id = `${kind}#${index}`
    for (const p of FAKE_PARAMS[kind]) this.params[p] = new FakeParam(p)
  }
  get gain(): FakeParam { return this.params.gain }
  get frequency(): FakeParam { return this.params.frequency }
  get Q(): FakeParam { return this.params.Q }
  get detune(): FakeParam { return this.params.detune }
  get pan(): FakeParam { return this.params.pan }
  get threshold(): FakeParam { return this.params.threshold }
  get knee(): FakeParam { return this.params.knee }
  get ratio(): FakeParam { return this.params.ratio }
  get attack(): FakeParam { return this.params.attack }
  get release(): FakeParam { return this.params.release }
  /** `ConstantSourceNode` 的那个常量（哑源用来当"一次性链的寿命"，值恒 0 = 听不见） */
  get offset(): FakeParam { return this.params.offset }
  connect(dst: FakeNode | FakeParam): FakeNode | FakeParam {
    this.ctx.edges.push({ from: this, to: dst })
    return dst
  }
  disconnect(): void {
    this.disconnected++
    // 真语义：`disconnect()` 摘掉的是**这个节点出发**的全部连线。不跟着摘，`live()` 就读不出
    // "一次性链走完有没有把线收回去"这件事（ KI-071 的整表普查全靠这个数）。
    for (let i = this.ctx.edges.length - 1; i >= 0; i--) if (this.ctx.edges[i].from === this) this.ctx.edges.splice(i, 1)
  }
  start(at?: number): void { this.startedAt.push(at ?? this.ctx.currentTime) }
  stop(at?: number): void { this.stoppedAt.push(at ?? this.ctx.currentTime) }
  /** 触发一次"播完"回调（真机上由引擎在 stop 时刻调用；这里由测试手动兑现 onended 那条清理链） */
  fireEnded(): void { this.onended?.() }
}

const FAKE_PARAMS: Record<NodeKind, string[]> = {
  gain: ['gain'],
  osc: ['frequency', 'detune'],
  bufferSource: ['playbackRate'],
  constantSource: ['offset'],
  biquad: ['frequency', 'Q', 'gain'],
  compressor: ['threshold', 'knee', 'ratio', 'attack', 'release'],
  panner: ['pan'],
  shaper: [],
  destination: []
}

export interface FakeEdge { from: FakeNode; to: FakeNode | FakeParam }

export class FakeAudioContext {
  currentTime = 0
  sampleRate = 48000
  state: 'suspended' | 'running' | 'closed' = 'running'
  readonly destination = new FakeNode('destination', this, -1)
  nodes: FakeNode[] = []
  edges: FakeEdge[] = []
  resumes = 0
  buffersMade = 0
  private seq = 0
  /** 每次 new FakeAudioContext() 都从这里拿节点，测试不 import 任何真 WebAudio 类型 */
  private mk(kind: NodeKind): FakeNode {
    const n = new FakeNode(kind, this, this.seq++)
    this.nodes.push(n)
    return n
  }
  createGain(): FakeNode { return this.mk('gain') }
  createOscillator(): FakeNode { return this.mk('osc') }
  createBufferSource(): FakeNode { return this.mk('bufferSource') }
  createConstantSource(): FakeNode { return this.mk('constantSource') }
  createBiquadFilter(): FakeNode { return this.mk('biquad') }
  createDynamicsCompressor(): FakeNode { return this.mk('compressor') }
  createStereoPanner(): FakeNode { return this.mk('panner') }
  createWaveShaper(): FakeNode { return this.mk('shaper') }
  createBuffer(ch: number, len: number, sr: number): { length: number; sampleRate: number; numberOfChannels: number; getChannelData: () => Float32Array } {
    this.buffersMade++
    const data = new Float32Array(len)
    return { length: len, sampleRate: sr, numberOfChannels: ch, getChannelData: () => data }
  }
  resume(): Promise<void> { this.resumes++; this.state = 'running'; return Promise.resolve() }
  /** 只有测试会调：把时间轴往前推一格（真机由硬件时钟推） */
  advance(sec: number): void { this.currentTime += sec }
  /** 读某类节点建了几个（`MAX_VOICES` 那种"配额"账就从这里读） */
  count(kind: NodeKind): number { return this.nodes.filter((n) => n.kind === kind).length }
  sources(): FakeNode[] { return this.nodes.filter((n) => n.kind === 'osc' || n.kind === 'bufferSource') }
  /** connect 到某个具体目标的全部连线 */
  edgesTo(dst: FakeNode | FakeParam): FakeEdge[] { return this.edges.filter((e) => e.to === dst) }
  /** **此刻还连在**某个目标上的连线数（`disconnect` 会摘线，所以这个数读的是"还没回收的节点"） */
  live(dst: FakeNode | FakeParam): number { return this.edges.filter((e) => e.to === dst).length }
  /**
   * 把所有源节点的"生命周期走完"兑现一次（真机由音频线程在 `stop` 时刻回调，这里测试手动）。
   * 一次性音色该不该回收，只有走完整条命才看得出来，所以普查用例都从这里过一遍。
   */
  endAll(): number {
    let n = 0
    for (const x of this.nodes) {
      if (x.kind !== 'osc' && x.kind !== 'bufferSource' && x.kind !== 'constantSource') continue
      if (!x.startedAt.length) continue
      x.fireEnded()
      n++
    }
    return n
  }
}

/** 真正挂到 `globalThis.window` 上的那一只：只有 `AudioEngine` 读到的字段。 */
interface FakeDom {
  handlers: Record<string, Array<(e: unknown) => void>>
  timers: Array<{ fn: () => void; ms: number }>
  addEventListener(type: string, fn: (e: unknown) => void): void
  removeEventListener(type: string, fn: (e: unknown) => void): void
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(): void
  AudioContext?: (new () => FakeAudioContext) | null
  webkitAudioContext?: new () => FakeAudioContext
}

export interface FakeWindow {
  readonly dom: FakeDom
  /** 装到 globalThis 上（`AudioEngine` 在调用点现读 `window`，所以每条用例都能换掉它） */
  install(): void
  uninstall(): void
  /** 派发一次真事件形状（手势恢复那条路的证人） */
  dispatch(type: string, e?: unknown): void
  /** 按登记顺序把当前排着的计时器全部兑现（返回兑现了几个） */
  runTimers(): number
}

/**
 * 假 `window`：只给 `AudioEngine` 用到的那四件事（两个监听、`AudioContext` 构造器、`setTimeout`）。
 * 计时器是**手动兑现**的队列而不是真定时器——`MAX_VOICES` 那类"配额什么时候归还"的断言要的是确定性，
 * 不是等 50ms。
 */
export function fakeWindow(Ctor: (new () => FakeAudioContext) | null): FakeWindow {
  const dom: FakeDom = {
    handlers: {},
    timers: [],
    addEventListener(type, fn) { (dom.handlers[type] ??= []).push(fn) },
    removeEventListener(type, fn) {
      dom.handlers[type] = (dom.handlers[type] ?? []).filter((f) => f !== fn)
    },
    setTimeout(fn, ms) { dom.timers.push({ fn, ms }); return dom.timers.length },
    clearTimeout() { /* 本替身没有取消语义：引擎那两处都是"到点归还"，不取消 */ }
  }
  if (Ctor) dom.AudioContext = Ctor
  return {
    dom,
    install() {
      (globalThis as unknown as Record<string, unknown>).window = dom
    },
    uninstall() {
      const g = globalThis as unknown as Record<string, unknown>
      if (g.window === dom) delete g.window
    },
    dispatch(type, e = {}) {
      for (const fn of [...(dom.handlers[type] ?? [])]) fn(e)
    },
    runTimers() {
      const queued = dom.timers.splice(0, dom.timers.length)
      for (const t of queued) t.fn()
      return queued.length
    }
  }
}

/** `AudioEngine` 里那句 `window.AudioContext ?? window.webkitAudioContext` 的第二条路 */
export function fakeWindowWebkitOnly(Ctor: new () => FakeAudioContext): FakeWindow {
  const w = fakeWindow(null)
  w.dom.webkitAudioContext = Ctor
  return w
}
