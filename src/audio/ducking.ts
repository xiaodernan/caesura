/**
 * ducking.ts — docs/audio.md §8.2「Ducking 规则表」的数学与名册（KI-092）。
 *
 * 为什么把这几行单独拆出来，而不是写在 `AudioEngine` 里：`AudioEngine` 本体要一只真的
 * `AudioContext` 才跑得动，而「−6dB 是多少增益」「两次重叠的压法取哪个」这两句话是**表里的读数**，
 * 它们该在不用建图的地方就有断言钉着（与 `muffleRamp()`、`spatialize()` 同一套路子）。
 *
 * 三条口径写在这里，免得下次有人在别处再实现一遍：
 *  · **dB → 增益只有一个换算**：`duckFactor(db) = 10^(db/20)`。文档说的是 dB（§8.2 标题那句
 *    "源→检波→增益目标 dB"），线性增益是引擎的形状，中间这一步只许存在一次。
 *  · **同一条总线上叠了几个请求时取"最深"的那一个**（增益系数取最小），**不做 dB 相加**。
 *    理由：§8.2 每一行各自承诺一个电平，相加就会造出一个表里根本没有的读数（两条 −6dB 相加 =
 *    −12dB，而文档没有任何一行这么写）。这条裁决登记在 KI-092 的「裁决」段。
 *  · **压的是总线基准电平，不是逐个音源**：与 `audio.muffle` 那条同一个理由（一个个源去改就是
 *    给每类声音各写一遍豁免，漏一类就是一次听感 bug）。
 */

/**
 * 图上有哪四条总线，名字**只在这里列一次**：`BUS_BASE` 由这条联合强制穷举（少一格或多一格都编译不过），
 * `AudioEngine` 建图时按 `BUS_BASE` 的条目建节点，校验器从 `BUS_BASE`/这条联合现推合法 `targets`。
 */
export type DuckBusName = 'sfx' | 'music' | 'ambience' | 'ui'

/**
 * 每条总线的基准电平（建图时写进 `gain.value`，也是每次 ducking 弹回去的那个值）。
 * 这四个数原来散在 `ensureGraph()` 的四次 `mk(0.9)`／`mk(0.5)`／… 里——那正是"侧链要弹回基准"
 * 时必须有第二份读数的形状，KI-092 把它们收成一格一名。
 */
export const BUS_BASE: Record<DuckBusName, number> = {
  sfx: 0.9,
  music: 0.5,
  ambience: 0.45,
  ui: 0.8,
}

/**
 * 逼近基准/压下去的时间常数（秒）。**这不是设计读数**：§8.2 只有「休止状态」那一行给了斜率
 * （250ms 入 180ms 出），其余行只给量与时长。这里要一个数是为了不把增益写成阶跃（真机上那是一次
 * 咔哒），20ms 的时间常数在 60ms 内到位、听不出" ramp"也听不出爆音。
 */
export const DUCK_TC_SEC = 0.02

/**
 * 「表里的秒」⇄「`setTargetAtTime` 的时间常数」那一步的换算率。
 *
 * §8.2 休止那一行写的是 `250ms 入 180ms 出`——那是**到位时长**（人耳听到"压下去用了 250ms"），
 * 而 WebAudio 的 `setTargetAtTime(target, start, τ)` 收的是**指数逼近的时间常数**，3τ 才走到 95%。
 * 两个数不是一回事，所以这里把换算钉成一个常量而不是在调用点写 `/ 3`：写在那儿就没人知道那个 3
 * 是 95% 判据，下一个人会把它读成"随便砍一刀"。`DUCK_TC_SEC = 0.02` 与这句是同一把尺子
 * （20ms × 3 = 60ms 到位，与它自己那句注释一字不差）。
 */
export const DUCK_REACH_TC = 3

/** 到位时长（秒）→ 时间常数（秒）。表与文档说的是前者，引擎收的是后者 */
export function tcFromReach(reachSec: number): number { return reachSec / DUCK_REACH_TC }

/** 一次还没过期的压制请求：某条总线在 `until`（音频钟秒）之前压到基准 × `factor` */
export interface DuckRequest {
  bus: string
  factor: number
  until: number
  /**
   * KI-092①：这一行自己的**入 / 出**斜率（到位时长，秒）。缺省走 `DUCK_TC_SEC`——
   * 休止那一行的 250ms 入 / 180ms 出是设计读数（§8.2 / §5），其余行只给量与时长。
   */
  attackSec?: number
  releaseSec?: number
}

/** dB → 线性增益倍数。−6dB ≈ 0.5012，−12dB ≈ 0.2512，0dB = 1（不压） */
export function duckFactor(db: number): number {
  return 10 ** (db / 20)
}

/**
 * 把在场请求折成"每条总线一个当前系数"：同一条取**最深**（最小增益），没请求的总线不出现
 * （调用方按"缺席 = 1 = 基准"处理，所以这里不返回四个 1——返回四个 1 就等于替表里那四条总线
 * 各写了一句"现在要自动化"，第一帧就会往图上贴四条没人要的斜坡）。
 */
export function deepestFactor(requests: DuckRequest[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [bus, r] of Object.entries(deepestRequests(requests))) out[bus] = r.factor
  return out
}

/**
 * 与上面同一个折叠，但**交出那位主人**而不只是它的系数（KI-092①）。
 *
 * 为什么引擎需要它：斜坡不是一条，是两条——压下去用**这一行**的 `attackSec`，弹回来要用
 * **当初把这条总线压下去的那一行**的 `releaseSec`。只拿系数的话，弹回那一刻请求早就过期没了，
 * 引擎无从知道"是休止压的（180ms 出）还是弹反压的（走缺省）"，只能给所有行用同一个缺省斜率——
 * 那正是"表里写了读数而没人读"的形状（§55）。取最深的那位主人同时决定了深度与出入斜率，
 * 一条总线只有一个主人，不会出现"深度归甲、斜率归乙"。
 */
export function deepestRequests(requests: DuckRequest[]): Record<string, DuckRequest> {
  const out: Record<string, DuckRequest> = {}
  for (const r of requests) {
    const prev = out[r.bus]
    if (prev === undefined || r.factor < prev.factor) out[r.bus] = r
  }
  return out
}

/** 剔掉已到期（`now >= until`）的请求；到点那一拍就不算了，弹回基准由调用方在同一帧完成 */
export function activeDucks(requests: DuckRequest[], now: number): DuckRequest[] {
  return requests.filter((r) => r.until > now)
}
