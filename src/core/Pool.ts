export class Pool<T> {
  private free: T[] = []
  live = 0
  peak = 0
  /**
   * §5.7「池命中率」的两格。此前这里只有 `live/free/peak/cap` 那个 getter，而它**全库零读者**
   * ——命中率不是从这四个数能算出来的（它们说的是"此刻"，不是"复用了几次 vs 生了几次"）。
   * 计数挂在 `obtain()` 上：从空闲栈里拿到一个是 reuse（hits），现造一个是 miss。
   */
  hits = 0
  misses = 0

  constructor(
    private factory: () => T,
    private resetItem: (item: T) => void,
    private cap = 2048
  ) {}

  obtain(): T {
    // 先判长度再取：`pop() ?? factory()` 那一句里"空栈"与"存着 undefined 的项"分不开，
    // 而这里的计数要认得出到底是哪一种。
    if (this.free.length > 0) this.hits++
    else this.misses++
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

  get stats(): { live: number; free: number; peak: number; cap: number; hits: number; misses: number } {
    return { live: this.live, free: this.free.length, peak: this.peak, cap: this.cap, hits: this.hits, misses: this.misses }
  }
}
