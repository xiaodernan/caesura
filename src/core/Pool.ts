export class Pool<T> {
  private free: T[] = []
  live = 0
  peak = 0
  warnedOver = false

  constructor(
    private factory: () => T,
    private resetItem: (item: T) => void,
    private cap = 2048
  ) {}

  obtain(): T {
    const item = this.free.pop() ?? this.factory()
    this.live++
    this.peak = Math.max(this.peak, this.live)
    this.resetItem(item)
    return item
  }

  release(item: T): void {
    this.live--
    if (this.free.length < this.cap) this.free.push(item)
  }

  get stats(): { live: number; free: number; peak: number; cap: number } {
    return { live: this.live, free: this.free.length, peak: this.peak, cap: this.cap }
  }
}
