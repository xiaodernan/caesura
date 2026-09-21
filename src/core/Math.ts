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

export class Rng {
  private next: () => number
  constructor(seed: number | string = 0x9e3779b9) {
    this.next = mulberry32(typeof seed === 'string' ? hashString(seed) : seed)
  }
  float(min = 0, max = 1): number { return min + (max - min) * this.next() }
  int(min: number, max: number): number { return Math.floor(this.float(min, max + 1)) }
  pick<T>(arr: readonly T[]): T { return arr[this.int(0, arr.length - 1)] }
  chance(p: number): boolean { return this.next() < p }
  /** weighted pick; weights need not sum to 1 */
  weighted<T>(items: readonly { item: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + i.weight, 0)
    let r = this.next() * total
    for (const i of items) {
      r -= i.weight
      if (r <= 0) return i.item
    }
    return items[items.length - 1].item
  }
}

export const clamp = (v: number, lo: number, hi: number): number => v < lo ? lo : v > hi ? hi : v
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt))
