/** `scripts/lib/stategraph.mjs` 的声明：零依赖 StateGraph · LangGraph 同形 · checkpoints。 */

export interface StateGraphCheckpoint {
  node: string
  ms: number
  ok: boolean
}

export class StateGraph {
  nodes: Map<string, (state: Record<string, any>) => Promise<void> | void>
  edges: Array<[string, string]>
  conditional: Array<{ from: string; router: (state: Record<string, any>) => string; mapping: Record<string, string | null> }>
  checkpoints: StateGraphCheckpoint[]
  addNode(name: string, fn: (state: Record<string, any>) => Promise<void> | void): this
  addEdge(from: string, to: string): this
  addConditionalEdges(from: string, router: (state: Record<string, any>) => string, mapping: Record<string, string | null>): this
  _next(current: string, state: Record<string, any>): string | null
  run(entry: string, state: Record<string, any>): Promise<Record<string, any>>
}
