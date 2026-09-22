export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface RngState { seed: number; calls: number }

export class Rng {
  private next: () => number
  /** 归一化后的种子（字符串种子走 hashString）：存档要能把"同一串随机"接回去（需求 §10） */
  private seedValue: number
  /** 已经抽了几笔。存档不写"当前值"而写"第几笔"，因为 mulberry32 的内部状态就是这么推进的 */
  private callsValue = 0
  constructor(seed: number | string = 0x9e3779b9) {
    this.seedValue = typeof seed === 'string' ? hashString(seed) : seed >>> 0
    this.next = mulberry32(this.seedValue)
  }
  /** 唯一取随机数的入口：计数在这里，`state()` 才可能精确复现到第几笔 */
  private draw(): number {
    this.callsValue++
    return this.next()
  }
  float(min = 0, max = 1): number { return min + (max - min) * this.draw() }
  int(min: number, max: number): number { return Math.floor(this.float(min, max + 1)) }
  pick<T>(arr: readonly T[]): T { return arr[this.int(0, arr.length - 1)] }
  chance(p: number): boolean { return this.draw() < p }
  /** weighted pick; weights need not sum to 1 */
  weighted<T>(items: readonly { item: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + i.weight, 0)
    let r = this.draw() * total
    for (const i of items) {
      r -= i.weight
      if (r <= 0) return i.item
    }
    return items[items.length - 1].item
  }

  state(): RngState { return { seed: this.seedValue, calls: this.callsValue } }

  /**
   * 接回某一局抽到的位置：重播 `calls` 笔。O(已抽次数)——一局里掉落掷骰是几百笔的量级，
   * 而读档是一次性动作，所以重播比给 mulberry32 开内部状态口子更便宜也更难写错。
   */
  restore(s: RngState): void {
    this.seedValue = s.seed >>> 0
    this.next = mulberry32(this.seedValue)
    this.callsValue = 0
    for (let i = 0; i < s.calls; i++) this.draw()
  }
}

export const clamp = (v: number, lo: number, hi: number): number => v < lo ? lo : v > hi ? hi : v
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt))
