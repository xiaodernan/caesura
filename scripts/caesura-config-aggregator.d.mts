/** `scripts/caesura-config-aggregator.mjs` 的声明：多源配置按优先级合并（Node.js 侧，集大成收口）。 */

export interface ConfigAggregatorOptions {
  override?: Record<string, unknown>
}

/** 创建一只配置聚合器。 */
export function createConfigAggregator(opts?: ConfigAggregatorOptions): {
  addSource(name: string, fetchFn: (() => Record<string, unknown> | Promise<Record<string, unknown>>) | Record<string, unknown>, priority?: number): string
  setOverride(obj: Record<string, unknown>): Record<string, unknown>
  aggregate(): Promise<Record<string, unknown>>
  get(key: string): Promise<unknown>
}
