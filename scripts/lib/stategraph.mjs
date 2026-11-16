/**
 * scripts/lib/stategraph.mjs — 零依赖 StateGraph（LangGraph 的 Node 侧真实现）
 *
 * 为什么住在这里：ai-director.mjs（KI-620）与 ai-director-transitions-qa.mjs（KI-624）都是
 * "load → … → writeArtifacts" 的有向管线，共享同一个图内核而不是各抄一份。
 *
 * 语义（与 LangGraph 同形）：
 *   - addNode(name, fn)          —— fn(state) 串行执行；失败被捕获并记录，不中断管线；
 *   - addEdge(from, to)          —— 直接后继；
 *   - addConditionalEdges(from, router, mapping) —— router(state) → key → mapping[key] → 下一个节点；
 *   - checkpoints                —— 每节点 { node, ms, ok }，写盘即证据。
 * 纪律：state 必须是可 JSON 序列化的对象（写 artifacts 时要整体落盘）。
 */
export class StateGraph {
  constructor() { this.nodes = new Map(); this.edges = []; this.conditional = []; this.checkpoints = [] }
  addNode(name, fn) { this.nodes.set(name, fn); return this }
  addEdge(from, to) { this.edges.push([from, to]); return this }
  addConditionalEdges(from, router, mapping) { this.conditional.push({ from, router, mapping }); return this }
  _next(current, state) {
    const c = this.conditional.find((x) => x.from === current)
    if (c) return c.mapping[c.router(state)] ?? null
    const e = this.edges.find(([f]) => f === current)
    return e ? e[1] : null
  }
  async run(entry, state) {
    let current = entry
    while (current) {
      const fn = this.nodes.get(current)
      if (!fn) throw new Error(`StateGraph: 未知节点 ${current}`)
      const t0 = Date.now()
      let ok = true
      try { await fn(state) } catch (e) { ok = false; if (!Array.isArray(state.errors)) state.errors = []; state.errors.push({ node: current, message: String((e && e.message) || e) }) }
      this.checkpoints.push({ node: current, ms: Date.now() - t0, ok })
      current = this._next(current, state)
    }
    return state
  }
}
